//! Type relations: whether a value of one type can be used where another type is expected.
//!
//! Follows `internal/checker/relater.go` of TypeScript 7.0.2 function by function. The names in
//! `backticks` at the head of a function are the names used there. `REPORT` is `reportErrors`. Code
//! that only serves error elaboration is in `explain_relation.rs`.

use super::explain_relation::{
    Chain, ErrorState, chain_depth, is_same_chain, visibility_to_string,
};
use super::related::Place;
use super::*;
use crate::util::{FxHashSet, FxHasher};
use smallvec::SmallVec;
use std::hash::Hasher;
use std::ops::{BitAnd, BitAndAssign};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Relation {
    Assignable = 0,
    /// A subtype that is also no less specific. Used for union subtype reduction.
    StrictSubtype = 1,
    /// The two types may share a value. Used for `===` and type assertions.
    Comparable = 2,
    Subtype = 4,
    Identity = 5,
}

impl Relation {
    /// `relation == assignableRelation || relation == comparableRelation`
    pub(super) fn is_lenient(self) -> bool {
        matches!(self, Relation::Assignable | Relation::Comparable)
    }

    pub(super) fn is_subtype(self) -> bool {
        matches!(self, Relation::Subtype | Relation::StrictSubtype)
    }
}

/// `Maybe`: true assuming that a comparison in progress succeeds. `Unknown`: during a variance
/// computation.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct Ternary(u8);

impl Ternary {
    pub(super) const FALSE: Ternary = Ternary(0);
    pub(super) const UNKNOWN: Ternary = Ternary(1);
    pub(super) const MAYBE: Ternary = Ternary(3);
    pub(super) const TRUE: Ternary = Ternary(0xff);

    #[inline]
    pub(super) fn holds(self) -> bool {
        self.0 != 0
    }

    #[inline]
    pub(super) fn of(value: bool) -> Ternary {
        if value { Ternary::TRUE } else { Ternary::FALSE }
    }
}

impl BitAnd for Ternary {
    type Output = Ternary;
    #[inline]
    fn bitand(self, other: Ternary) -> Ternary {
        Ternary(self.0 & other.0)
    }
}

impl BitAndAssign for Ternary {
    #[inline]
    fn bitand_assign(&mut self, other: Ternary) {
        self.0 &= other.0;
    }
}

// IntersectionState
pub(super) const STATE_NONE: u8 = 0;
/// The source is a constituent of an intersection.
pub(super) const STATE_SOURCE: u8 = 1;
/// The target is a constituent of an intersection.
pub(super) const STATE_TARGET: u8 = 2;
/// The source is an object literal that has already been checked for excess properties.
pub(super) const STATE_REGULAR: u8 = 4;

// RecursionFlags and ExpandingFlags
pub(super) const REC_SOURCE: u8 = 1;
pub(super) const REC_TARGET: u8 = 2;
pub(super) const REC_BOTH: u8 = 3;

// RelationComparisonResult
pub(super) const SUCCEEDED: u8 = 1;
pub(super) const FAILED: u8 = 2;
const REPORTS_UNMEASURABLE: u8 = 8;
const REPORTS_UNRELIABLE: u8 = 16;
pub(super) const COMPLEXITY_OVERFLOW: u8 = 32;
pub(super) const STACK_DEPTH_OVERFLOW: u8 = 64;
const OVERFLOW: u8 = COMPLEXITY_OVERFLOW | STACK_DEPTH_OVERFLOW;

// VarianceFlags
pub(super) const INVARIANT: u8 = 0;
pub(super) const COVARIANT: u8 = 1;
pub(super) const CONTRAVARIANT: u8 = 2;
pub(super) const BIVARIANT: u8 = 3;
pub(super) const INDEPENDENT: u8 = 4;
pub(super) const VARIANCE_MASK: u8 = 7;
pub(super) const UNMEASURABLE: u8 = 8;
const UNRELIABLE: u8 = 16;
pub(super) const ALLOWS_STRUCTURAL_FALLBACK: u8 = UNMEASURABLE | UNRELIABLE;

// SignatureCheckMode
pub(super) const BIVARIANT_CALLBACK: u8 = 1;
pub(super) const STRICT_CALLBACK: u8 = 2;
const IGNORE_RETURN_TYPES: u8 = 4;
pub(super) const STRICT_ARITY: u8 = 8;
pub(super) const STRICT_TOP_SIGNATURE: u8 = 16;
pub(super) const CALLBACK: u8 = BIVARIANT_CALLBACK | STRICT_CALLBACK;
/// `incompatibleErrorReporter` is `reportIncompatibleConstructSignatureReturn`. Set with `reportErrors` only.
const CONSTRUCT_SIGNATURE: u8 = 32;

/// `getRelationKey`: the source, the target, and flags. The flags hold the relation in the low four bits and the intersection
/// state above it.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub(super) struct Key(TypeId, TypeId, u8);

/// Flag of a `Key` for two generic type references. The two ids of such a key are the halves of a
/// hash. `LOCAL` in the first half: the hash includes a task-local id.
const GENERIC_KEY: u8 = 0x80;

impl Key {
    /// After the merge at the barrier the same two references hash differently, so the entry is
    /// useless to other tasks.
    #[inline]
    fn is_hash_of_own_ids(self) -> bool {
        self.2 & GENERIC_KEY != 0 && self.0.is_local()
    }
}

impl MaybeLocal for Key {
    #[inline]
    fn is_local(&self) -> bool {
        self.0.is_local() || self.1.is_local()
    }
}

/// Not the tuple's implementation: the halves of a hash are not ids.
impl Follow for Key {
    fn visit<V: Visitor>(&self, visitor: &mut V) {
        let Key(source, target, flags) = *self;
        if flags & GENERIC_KEY == 0 {
            visitor.ty(source);
            visitor.ty(target);
        } else {
            visitor.plain(&(source.0, target.0));
        }
        visitor.plain(&flags);
    }

    fn follow(&mut self, link: &Link) {
        if self.2 & GENERIC_KEY == 0 {
            self.0.follow(link);
            self.1.follow(link);
        }
    }

    fn is_bound(&self, own: &OwnStore) -> bool {
        if self.2 & GENERIC_KEY == 0 {
            (self.0, self.1).is_bound(own)
        } else {
            self.is_hash_of_own_ids()
        }
    }
}

/// The state of `keyBuilder.writeGenericTypeReferences`.
struct GenericKeyBuilder {
    hasher: FxHasher,
    /// The type parameters written by index so far. The source and the target share the list.
    type_params: [TypeId; 8],
    type_param_count: usize,
    /// A constrained type parameter was written by id.
    constrained: bool,
    /// An id with `LOCAL` was written.
    has_own_id: bool,
}

impl GenericKeyBuilder {
    /// The index of `param` in `type_params`, appended if it is new. `None` if the list is full.
    fn type_param_index(&mut self, param: TypeId) -> Option<usize> {
        if let Some(index) = self.type_params[..self.type_param_count]
            .iter()
            .position(|&known| known == param)
        {
            return Some(index);
        }
        *self.type_params.get_mut(self.type_param_count)? = param;
        self.type_param_count += 1;
        Some(self.type_param_count - 1)
    }
}

/// The variables that `structuredTypeRelatedToWorker` shares with its closure `relateVariances`.
/// The last two are read only under `reportErrors`.
#[derive(Default)]
struct WorkerState {
    variance_check_failed: bool,
    original_error_chain: Chain,
    save_error_state: ErrorState,
}

/// State of one top-level relation check and all the comparisons nested in it.
pub(super) struct Relater {
    pub(super) relation: Relation,
    /// The two types `check_type_related_to` was called with. `NEVER` in a relater created elsewhere.
    top_source: TypeId,
    top_target: TypeId,
    /// The comparisons in progress and those that succeeded assuming the ones in progress succeed.
    pub(super) maybe_keys: Vec<Key>,
    /// `maybeKeysSet`: the keys in `maybe_keys`.
    pub(super) maybe_keys_set: FxHashSet<Key>,
    pub(super) source_stack: Vec<TypeId>,
    pub(super) target_stack: Vec<TypeId>,
    /// See `is_last_deeply_nested`.
    source_identities: Vec<(TypeId, RecursionId)>,
    target_identities: Vec<(TypeId, RecursionId)>,
    pub(super) expanding: u8,
    pub(super) overflow: bool,
    /// A cached `COMPLEXITY_OVERFLOW` entry answered one of the comparisons.
    hit_cached_overflow: bool,
    /// `len(r.sourceStack)` or `len(r.targetStack)` reached 100, which is why `overflow` is set.
    is_too_deep: bool,
    /// `related` has already applied its own rules to `top_source` and `top_target`: no simple rule
    /// relates them, and they are not an object type and a primitive. Consumed by the first
    /// comparison.
    is_from_related: bool,
    /// The key with which `related` missed the cache for `top_source` and `top_target`, with its
    /// `constrained`. Consumed by the first comparison that needs a key.
    top_key: Option<(Key, bool)>,
    relation_count: i32,
    /// `Checker::cycles` at the start of the check. Once it has changed, no result is cacheable.
    cycles: u64,
    /// Failures are recorded in `failed` instead of the relation cache: in a reporting run (P2),
    /// and in the non-reporting run that precedes one where tsgo has no such run
    /// (`check_type_related_to_ex`), which must leave the cache as tsgo's run would find it.
    pub(super) caches_failures: bool,
    failed: FxHashSet<Key>,
    /// `errorNode`. An end of `0` means the end of the token at the start. This field and the
    /// following ones are read only under `reportErrors`.
    pub(super) error_node: Place,
    /// `headMessage` of the first comparison, which consumes it.
    pub(super) head_message: Option<u32>,
    /// `errorChain`
    pub(super) error_chain: Chain,
    /// `relatedInfo`
    pub(super) related_info: Vec<Reported>,
}

impl Relater {
    pub(super) fn new(relation: Relation, cycles: u64) -> Relater {
        Relater {
            relation,
            top_source: TypeId::NEVER,
            top_target: TypeId::NEVER,
            maybe_keys: Vec::new(),
            maybe_keys_set: FxHashSet::default(),
            source_stack: Vec::new(),
            target_stack: Vec::new(),
            source_identities: Vec::new(),
            target_identities: Vec::new(),
            expanding: 0,
            overflow: false,
            hit_cached_overflow: false,
            is_too_deep: false,
            is_from_related: false,
            top_key: None,
            relation_count: 2_000_000,
            cycles,
            caches_failures: false,
            failed: FxHashSet::default(),
            error_node: (FileId(0), 0, 0),
            head_message: None,
            error_chain: None,
            related_info: Vec::new(),
        }
    }
}

/// Where `getPropertyOfType` falls back for properties a type does not have itself: the global
/// types that every function and every object is an instance of.
pub(super) struct Inherited<'p> {
    globals: [Atom; 3],
    count: usize,
    /// The members of the first `requested` entries of `globals`.
    members: [Option<Members<'p>>; 3],
    requested: usize,
}

/// Identity shared by all instantiations of one declaration.
pub(super) type RecursionId = (u8, u32, u32);

/// Sentinel `RecursionId`: deciding whether the type has a given identity takes more than an
/// equality test.
const NOT_PLAIN: RecursionId = (u8::MAX, 0, 0);

// Type kind predicates for callers that already have the `TypeData`.

/// `Checker::is_object_type`
#[inline]
fn is_object_kind(data: &TypeData) -> bool {
    matches!(
        data,
        TypeData::Ref { .. }
            | TypeData::Tuple { .. }
            | TypeData::Anon { .. }
            | TypeData::Fns { .. }
            | TypeData::Synth(_)
            | TypeData::ReverseMapped { .. }
    )
}

#[inline]
fn is_type_param_kind(data: &TypeData) -> bool {
    matches!(
        data,
        TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_)
    )
}

#[inline]
fn is_union_or_intersection_kind(data: &TypeData) -> bool {
    matches!(data, TypeData::Union(_) | TypeData::Intersection(_))
}

/// `TypeFlagsInstantiable`
#[inline]
fn is_instantiable_kind(data: &TypeData) -> bool {
    matches!(
        data,
        TypeData::TypeParam(..)
            | TypeData::ThisParam(_)
            | TypeData::Marker(_)
            | TypeData::IndexedAccess { .. }
            | TypeData::Cond { .. }
            | TypeData::Substitution { .. }
            | TypeData::Keyof(_)
            | TypeData::Template { .. }
            | TypeData::StringMapping { .. }
    )
}

/// `TypeFlagsStructuredOrInstantiable`
#[inline]
fn is_structured_or_instantiable_kind(data: &TypeData) -> bool {
    is_object_kind(data) || is_union_or_intersection_kind(data) || is_instantiable_kind(data)
}

/// `Checker::is_primitive`
#[inline]
fn is_primitive_kind(data: &TypeData) -> bool {
    match data {
        TypeData::Intrinsic(intrinsic) => !matches!(
            intrinsic,
            Intrinsic::Unresolved
                | Intrinsic::Any
                | Intrinsic::Error
                | Intrinsic::Auto
                | Intrinsic::IntrinsicMarker
                | Intrinsic::Wildcard
                | Intrinsic::Unknown
                | Intrinsic::Never
                | Intrinsic::SilentNever
                | Intrinsic::UnreachableNever
                | Intrinsic::ImplicitNever
                | Intrinsic::Object
        ),
        TypeData::StringLit { .. }
        | TypeData::NumberLit { .. }
        | TypeData::BigIntLit { .. }
        | TypeData::BoolLit { .. }
        | TypeData::EnumLit { .. }
        | TypeData::Enum { .. }
        | TypeData::UniqueSymbol { .. }
        | TypeData::Template { .. }
        | TypeData::StringMapping { .. } => true,
        _ => false,
    }
}

/// `Checker::is_fresh_literal`
#[inline]
fn is_fresh_literal_kind(data: &TypeData) -> bool {
    matches!(
        *data,
        TypeData::StringLit { fresh: true, .. }
            | TypeData::NumberLit { fresh: true, .. }
            | TypeData::BigIntLit { fresh: true, .. }
            | TypeData::BoolLit { fresh: true, .. }
            | TypeData::EnumLit { fresh: true, .. }
            | TypeData::Enum { fresh: true, .. }
    )
}

#[inline]
fn is_generic_tuple_kind(data: &TypeData) -> bool {
    matches!(data, TypeData::Tuple { flags, .. } if flags.iter().any(|f| f.contains(ElemFlags::VARIADIC)))
}

#[inline]
fn is_mapped_kind(data: &TypeData) -> bool {
    matches!(
        data,
        TypeData::Anon {
            origin: Origin::Mapped(..),
            ..
        }
    )
}

/// `Checker::is_object_literal_type`
#[inline]
fn is_object_literal_kind(data: &TypeData) -> bool {
    match data {
        TypeData::Anon {
            origin: Origin::ObjectLiteral(..),
            ..
        } => true,
        TypeData::Synth(shape) => shape.literal.is_of_expression(),
        _ => false,
    }
}

/// `Checker::is_fresh_object_literal_type`
#[inline]
fn is_fresh_object_literal_kind(data: &TypeData) -> bool {
    match data {
        TypeData::Anon {
            origin: Origin::ObjectLiteral(.., is_fresh),
            ..
        } => *is_fresh,
        TypeData::Synth(shape) => shape.literal.is_of_expression() && !shape.is_regular,
        _ => false,
    }
}

/// `normalized` returns a type of this kind unchanged.
#[inline]
fn is_normalized_kind(data: &TypeData) -> bool {
    match data {
        TypeData::Union(_)
        | TypeData::Intersection(_)
        | TypeData::IndexedAccess { .. }
        | TypeData::Cond { .. }
        | TypeData::Substitution { .. } => false,
        // `t.AsTypeReference().node != nil`
        TypeData::Ref { args, .. } => args.as_deferred().is_none(),
        TypeData::Tuple { elems, .. } => {
            elems.as_deferred().is_none() && !is_generic_tuple_kind(data)
        }
        _ => !is_fresh_literal_kind(data),
    }
}

impl<'p> Checker<'p> {
    pub fn is_assignable(&mut self, source: TypeId, target: TypeId) -> bool {
        self.related(source, target, Relation::Assignable)
    }

    pub fn is_strict_subtype(&mut self, source: TypeId, target: TypeId) -> bool {
        self.related(source, target, Relation::StrictSubtype)
    }

    pub fn is_subtype(&mut self, source: TypeId, target: TypeId) -> bool {
        self.related(source, target, Relation::Subtype)
    }

    pub fn is_comparable(&mut self, source: TypeId, target: TypeId) -> bool {
        self.related(source, target, Relation::Comparable)
    }

    pub fn are_comparable(&mut self, a: TypeId, b: TypeId) -> bool {
        self.is_comparable(a, b) || self.is_comparable(b, a)
    }

    pub(super) fn is_identical(&mut self, a: TypeId, b: TypeId) -> bool {
        self.related(a, b, Relation::Identity)
    }

    // ───────────────────────────── type kinds, as the relation classifies them
    // ─────────────────────────────

    #[inline]
    pub(super) fn is_type_param(&self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_)
        )
    }

    #[inline]
    pub(super) fn is_intersection(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Intersection(_))
    }

    #[inline]
    pub(super) fn is_union_or_intersection(&self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::Union(_) | TypeData::Intersection(_)
        )
    }

    /// `TypeFlagsInstantiable`
    #[inline]
    pub(super) fn is_instantiable(&self, ty: TypeId) -> bool {
        is_instantiable_kind(self.data(ty))
    }

    /// `TypeFlagsPrimitive`, which `boolean` and an enum have though they are unions.
    #[inline]
    pub(super) fn has_primitive_flag(&self, ty: TypeId) -> bool {
        self.has_primitive_flag_as(ty, self.data(ty))
    }

    /// `data`: what `ty` is.
    #[inline]
    fn has_primitive_flag_as(&self, ty: TypeId, data: &TypeData) -> bool {
        match data {
            TypeData::Union(_) => self.is_boolean(ty) || self.union_enum_symbol(ty).is_some(),
            _ => is_primitive_kind(data),
        }
    }

    /// `TypeId::plain`, with the `TypeData` of the result. `data`: the `TypeData` of `ty`.
    #[inline]
    fn plain_as(&self, ty: TypeId, data: &'p TypeData) -> (TypeId, &'p TypeData) {
        let plain = ty.plain();
        if plain == ty {
            (ty, data)
        } else {
            (plain, self.data(plain))
        }
    }

    /// A literal type as an annotation would denote it, with the `TypeData` of the result. `data`:
    /// the `TypeData` of `ty`.
    #[inline]
    fn regular_as(&self, ty: TypeId, data: &'p TypeData) -> (TypeId, &'p TypeData) {
        if is_fresh_literal_kind(data) {
            let ty = self.with_freshness(ty, false);
            return (ty, self.data(ty));
        }
        (ty, data)
    }

    /// `normalized`, with the `TypeData` of the result. `data`: the `TypeData` of `ty`.
    #[inline]
    fn normalized_as(
        &mut self,
        ty: TypeId,
        data: &'p TypeData,
        writing: bool,
    ) -> (TypeId, &'p TypeData) {
        // FOR SPEED: `len(getMembersOfSymbol(t.symbol)) != 0` first. The binder creates the table
        // with the first member (`GetMembers`).
        if is_normalized_kind(data)
            && !matches!(data, TypeData::Ref { target, .. } if self.files().symbol(*target).members.is_none())
        {
            return (ty, data);
        }
        if matches!(data, TypeData::Union(_)) && !self.may_be_reduced(ty) {
            return (ty, data);
        }
        let normalized = self.normalized(ty, writing);
        if normalized == ty {
            return (ty, data);
        }
        (normalized, self.data(normalized))
    }

    /// The enum that a member belongs to. An enum maps to itself.
    fn enum_of(&self, symbol: Sym) -> Sym {
        if self.files().flags(symbol).contains(SymFlags::ENUM_MEMBER) {
            self.files()
                .sym(symbol.file, self.files().symbol(symbol).parent)
        } else {
            symbol
        }
    }

    /// `t.symbol` of a union that has `TypeFlagsEnumLiteral`: the enum it is the declared type of (`getDeclaredTypeOfEnum`).
    pub(super) fn union_enum_symbol(&self, ty: TypeId) -> Option<Sym> {
        let (alias, _) = self.stored_alias(ty)?;
        self.files()
            .flags(*alias)
            .intersects(SymFlags::ENUM)
            .then_some(*alias)
    }

    /// `data`: what `ty` is.
    #[inline]
    fn is_definitely_non_nullable_as(&self, ty: TypeId, data: &TypeData) -> bool {
        (self.has_primitive_flag_as(ty, data) && !self.is_nullish(ty))
            || is_object_kind(data)
            || ty == TypeId::OBJECT
    }

    pub(super) fn is_generic_mapped_type(&mut self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::Anon {
                origin: Origin::Mapped(..),
                ..
            }
        ) && self.is_generic(ty)
    }

    pub(super) fn is_generic_tuple_type(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Tuple { flags, .. } if flags.iter().any(|f| f.contains(ElemFlags::VARIADIC)))
    }

    /// `isGenericObjectType`
    pub(super) fn is_generic_object_type(&mut self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                parts.iter().any(|&p| self.is_generic_object_type(p))
            }
            &TypeData::Substitution { base, constraint } => {
                self.is_generic_object_type(base) || self.is_generic_object_type(constraint)
            }
            TypeData::TypeParam(..)
            | TypeData::ThisParam(_)
            | TypeData::Marker(_)
            | TypeData::IndexedAccess { .. }
            | TypeData::Cond { .. } => true,
            data => is_mapped_kind(data) && self.is_generic(ty) || is_generic_tuple_kind(data),
        }
    }

    /// `isGenericIndexType`
    pub(super) fn is_generic_index_type(&mut self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                parts.iter().any(|&p| self.is_generic_index_type(p))
            }
            &TypeData::Substitution { base, constraint } => {
                self.is_generic_index_type(base) || self.is_generic_index_type(constraint)
            }
            TypeData::Template { .. } | TypeData::StringMapping { .. } => {
                !self.is_pattern_literal(ty)
            }
            _ => self.is_deferred(ty),
        }
    }

    /// `anyFunctionType`: the type of a context sensitive function under `CheckModeSkipContextSensitive`.
    pub(super) fn any_function_type(&self) -> TypeId {
        self.synth(Shape {
            literal: Literalness::Partial,
            ..Shape::default()
        })
    }

    pub(super) fn is_any_function_type(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Synth(shape) if Self::is_any_function_shape(shape))
    }

    fn is_any_function_shape(shape: &Shape) -> bool {
        shape.literal == Literalness::Partial
            && shape.props.is_empty()
            && shape.call.is_empty()
            && shape.construct.is_empty()
            && shape.index.is_empty()
    }

    /// `isEmptyResolvedType` of the resolved members of `ty`.
    fn is_empty_resolved_type(&mut self, ty: TypeId) -> bool {
        !self.is_any_function_type(ty)
            && self.members(ty).is_some_and(|m| {
                let s = m.shape();
                s.props.is_empty()
                    && s.call.is_empty()
                    && s.construct.is_empty()
                    && s.index.is_empty()
            })
    }

    /// `isEmptyObjectType`
    pub(super) fn is_empty_object_type(&mut self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Union(parts) => parts.iter().any(|&p| self.is_empty_object_type(p)),
            TypeData::Intersection(parts) => parts.iter().all(|&p| self.is_empty_object_type(p)),
            _ if ty == TypeId::OBJECT => true,
            data => {
                is_object_kind(data)
                    && !(is_mapped_kind(data) && self.is_generic(ty))
                    && self.is_empty_resolved_type(ty)
            }
        }
    }

    /// `IsEmptyAnonymousObjectType`
    pub(super) fn is_empty_anonymous_object_type(&mut self, ty: TypeId) -> bool {
        if ty == TypeId::EMPTY_OBJECT {
            return true;
        }
        match self.data(ty) {
            // `getTypeWithSyntheticDefaultImportType` gives its result the symbol of a type literal without members.
            TypeData::Synth(shape) => {
                shape.literal == Literalness::SyntheticDefault || self.is_empty_resolved_type(ty)
            }
            TypeData::Anon {
                origin:
                    Origin::TypeLiteral(..) | Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..),
                ..
            } => self.is_empty_resolved_type(ty),
            _ => false,
        }
    }

    /// `isUnknownLikeUnionType`: `undefined | null | {}`
    fn is_unknown_like_union_type(&mut self, ty: TypeId) -> bool {
        let parts = self.parts(ty);
        if !self.p.files.options.strict_null_checks || parts.len() < 3 {
            return false;
        }
        // The constituents are in the order of `CompareTypes`, which starts with the flags.
        let (mut has_undefined, mut has_null) = (false, false);
        for p in parts.iter().take_while(|p| self.flags(**p) <= tf::NULL) {
            has_undefined |= p.is_undefined();
            has_null |= p.is_null();
        }
        has_undefined
            && has_null
            && parts
                .iter()
                .any(|&p| self.is_empty_anonymous_object_type(p))
    }

    fn has_call_or_construct_signatures(&mut self, ty: TypeId) -> bool {
        self.members(ty)
            .is_some_and(|m| !(m.shape().call.is_empty() && m.shape().construct.is_empty()))
    }

    /// `getNonMissingTypeOfSymbol`: the type of a property as used in comparisons. It includes
    /// `undefined` when the property is optional, unless exactOptionalPropertyTypes distinguishes
    /// the two.
    pub(super) fn type_of_prop_as_read(&mut self, prop: &Prop, mapper: MapperId) -> TypeId {
        let ty = self.type_of_prop(prop, mapper);
        if !prop.flags.contains(PropFlags::OPTIONAL) {
            ty
        } else if self.p.files.options.exact_optional_property_types {
            self.remove_missing_type(ty, true)
        } else {
            self.cached_optional_property(ty)
        }
    }

    /// `getTypeOfSymbol` of a property: with the missing type, the placeholder for an omitted
    /// property.
    pub(super) fn type_of_prop_with_missing(&mut self, prop: &Prop, mapper: MapperId) -> TypeId {
        let ty = self.type_of_prop(prop, mapper);
        if prop.flags.contains(PropFlags::OPTIONAL) {
            self.optional_property(ty)
        } else {
            ty
        }
    }

    /// `getPropertyOfType`: includes the properties that every function and every object has.
    pub(super) fn property_of_type(
        &mut self,
        members: &Members,
        name: Atom,
    ) -> Option<(Prop, MapperId)> {
        if let Some(prop) = members.resolved.prop(name) {
            return Some((prop.clone(), members.mapper));
        }
        let mut inherited = self.inherited_of(members.shape());
        self.inherited_property(&mut inherited, name)
            .map(|(prop, mapper)| (prop.clone(), mapper))
    }

    /// `property_of_type`, by reference.
    pub(super) fn property_in(
        &mut self,
        members: &Members<'p>,
        name: Atom,
    ) -> Option<(&'p Prop, MapperId)> {
        if let Some(prop) = members.resolved.prop(name) {
            return Some((prop, members.mapper));
        }
        let mut inherited = self.inherited_of(members.shape());
        self.inherited_property(&mut inherited, name)
    }

    /// `property_in`, for looking up several names in sequence. `inherited`: `inherited_of` the
    /// shape of `members`.
    #[inline]
    pub(super) fn property_among(
        &mut self,
        members: &Members<'p>,
        inherited: &mut Inherited<'p>,
        name: Atom,
    ) -> Option<(&'p Prop, MapperId)> {
        match members.resolved.prop(name) {
            Some(prop) => Some((prop, members.mapper)),
            None => self.inherited_property(inherited, name),
        }
    }

    pub(super) fn inherited_of(&self, shape: &Shape) -> Inherited<'p> {
        let mut globals = [known::Object; 3];
        let mut count = 0;
        if Self::is_any_function_shape(shape) {
            // `anyFunctionType` has the properties of `Function`.
            globals[0] = known::Function;
            count = 1;
        } else if !(shape.call.is_empty() && shape.construct.is_empty()) {
            if self.p.files.options.strict_bind_call_apply {
                globals[0] = if shape.call.is_empty() {
                    known::NewableFunction
                } else {
                    known::CallableFunction
                };
                count = 1;
            }
            globals[count] = known::Function;
            count += 1;
        }
        Inherited {
            globals,
            count: count + 1,
            members: [None; 3],
            requested: 0,
        }
    }

    /// `global_ref` without type arguments.
    #[inline]
    fn plain_global_ref(&mut self, name: Atom) -> TypeId {
        if let Some(known) = self.p.plain_global_refs.get(&mut self.task, &name) {
            return known;
        }
        let scope = self.begin_scope();
        let global = self.global_ref(name, &[]);
        match self.end_scope_as(scope, false) {
            Ok(stored) => (self.p.plain_global_refs).insert(&mut self.task, name, global, stored),
            Err(_) => global,
        }
    }

    /// `Checker::inherited_names`. Left unchanged if one of the four does not exist, or not yet.
    #[cold]
    fn note_inherited_names(&mut self) {
        let before = self.non_cacheable_mark();
        let mut names = [0; 4];
        for global in [
            known::Object,
            known::Function,
            known::CallableFunction,
            known::NewableFunction,
        ] {
            let global = self.plain_global_ref(global);
            let Some(members) = self.members(global) else {
                return;
            };
            for prop in &members.shape().props {
                names[prop.name.0 as usize / 64 % 4] |= 1 << (prop.name.0 % 64);
            }
        }
        if self.non_cacheable_mark() == before {
            self.inherited_names = names;
        }
    }

    fn inherited_property(
        &mut self,
        from: &mut Inherited<'p>,
        name: Atom,
    ) -> Option<(&'p Prop, MapperId)> {
        if self.inherited_names == [0; 4] {
            self.note_inherited_names();
        }
        let n = name.0 as usize;
        if self.inherited_names != [0; 4] && self.inherited_names[n / 64 % 4] & 1 << (n % 64) == 0 {
            return None;
        }
        for i in 0..from.count {
            if i == from.requested {
                let global = self.plain_global_ref(from.globals[i]);
                from.members[i] = self.members(global);
                from.requested += 1;
            }
            if let Some(members) = from.members[i]
                && let Some(prop) = members.resolved.prop(name)
            {
                return Some((prop, members.mapper));
            }
        }
        None
    }

    // ───────────────────────────── the question ─────────────────────────────

    /// `isTypeRelatedTo`
    pub(super) fn related(&mut self, source: TypeId, target: TypeId, relation: Relation) -> bool {
        let is_marker_comparison = std::mem::take(&mut self.is_marker_comparison);
        let is_trial = std::mem::take(&mut self.is_trial_comparison);
        if source == target {
            return true;
        }
        // A relation check made while a type is being simplified does not go through `enter`.
        if self.is_stack_low() {
            self.bailed_out();
            return false;
        }
        let (sd, td) = (self.data(source), self.data(target));
        // Every rule uses the flags, which all variants of `undefined` and of `null` share.
        let ((source, sd), (target, td)) = (self.plain_as(source, sd), self.plain_as(target, td));
        let ((source, sd), (target, td)) =
            (self.regular_as(source, sd), self.regular_as(target, td));
        if source == target {
            return true;
        }
        if relation != Relation::Identity {
            if relation == Relation::Comparable
                && !target.is_never()
                && self.is_simple_type_related_to(target, td, source, sd, relation, None)
                || self.is_simple_type_related_to(source, sd, target, td, relation, None)
            {
                return true;
            }
        } else if (self.flags(source) | self.flags(target))
            & (tf::UNION_OR_INTERSECTION | tf::INDEXED_ACCESS | tf::CONDITIONAL | tf::SUBSTITUTION)
            == 0
        {
            // Types that may simplify to another form are excluded, so the flags are the same.
            if self.flags(source) != self.flags(target) {
                return false;
            }
            if self.flags(source) & tf::SINGLETON != 0 {
                return true;
            }
        }
        // `isRelatedToEx`: an object type is related to a primitive by a simple rule or not at all.
        if relation != Relation::Identity
            && is_object_kind(sd)
            && self.has_primitive_flag_as(target, td)
        {
            return false;
        }
        let mut missed = None;
        if is_object_kind(sd) && is_object_kind(td) {
            let key = self.relation_key_as(source, sd, target, td, relation, STATE_NONE);
            if let Some(entry) = self.p.relations.get(&mut self.task, &key.0) {
                // The cache is shared between threads, so another thread measuring the same symbol may have stored this
                // comparison already. Without its flags the variances would lack `UNMEASURABLE` or `UNRELIABLE`.
                if is_marker_comparison {
                    self.reliability |= entry & (REPORTS_UNMEASURABLE | REPORTS_UNRELIABLE);
                }
                // The comparison of these two types was aborted when it ran.
                if entry & COMPLEXITY_OVERFLOW != 0 {
                    self.relation_too_complex = true;
                }
                return entry & SUCCEEDED != 0;
            }
            missed = Some(key);
        }
        if is_structured_or_instantiable_kind(sd) || is_structured_or_instantiable_kind(td) {
            return self.check_type_related_to(source, target, relation, missed, is_trial);
        }
        false
    }

    /// `checkTypeRelatedToEx`, without error reporting. `relation_too_complex` tells the caller to
    /// report 2859.
    /// `related` has found no simple rule for the two types. `missed`: the key of its cache miss,
    /// if it did a lookup.
    /// `is_trial`: see `Relater::caches_failures`.
    fn check_type_related_to(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        missed: Option<(Key, bool)>,
        is_trial: bool,
    ) -> bool {
        let (cuts, outermost) = (
            self.cuts(),
            self.frames.first().map_or(0, |frame| frame.serial),
        );
        if cuts != 0 && !is_trial {
            let (key, _) = self.relation_key(source, target, relation, STATE_NONE, false);
            if let Some(&(under, is_related)) = self.relations_cut_short.get(&key)
                && under == outermost
            {
                self.cut_short_again();
                return is_related;
            }
        }
        let mut r = self
            .free_relaters
            .pop()
            .unwrap_or_else(|| Relater::new(relation, self.cycles));
        r.relation = relation;
        r.top_source = source;
        r.top_target = target;
        r.relation_count = 2_000_000;
        r.cycles = self.cycles;
        // Under the identity relation `related` uses other rules.
        r.is_from_related = relation != Relation::Identity;
        r.top_key = missed;
        r.caches_failures = is_trial;
        let result = self.is_related_to_ex::<false>(&mut r, source, target, REC_BOTH, STATE_NONE);
        let overflow = r.overflow;
        // `relationCount <= 0`. Running out of nesting depth or native stack is not a complexity overflow.
        let is_too_complex = overflow && r.relation_count <= 0 && self.cycles == r.cycles;
        let hit_cached_overflow = r.hit_cached_overflow;
        let is_too_deep = overflow && std::mem::take(&mut r.is_too_deep) && !is_trial;
        r.is_from_related = false;
        r.top_key = None;
        r.maybe_keys.clear();
        r.maybe_keys_set.clear();
        r.source_stack.clear();
        r.target_stack.clear();
        r.expanding = 0;
        r.overflow = false;
        r.hit_cached_overflow = false;
        if is_trial {
            r.caches_failures = false;
            r.failed.clear();
        }
        self.free_relaters.push(r);
        if is_too_complex {
            // Recorded as failed so that the comparison is not attempted again.
            let (key, _) = self.relation_key(source, target, relation, STATE_NONE, false);
            let scope = self.begin_scope();
            if let Ok(stored) = self.end_scope_as(scope, false) {
                self.insert_relation(key, FAILED | COMPLEXITY_OVERFLOW, stored);
            }
            self.relation_too_complex = true;
        } else if is_too_deep {
            let (key, _) = self.relation_key(source, target, relation, STATE_NONE, false);
            let scope = self.begin_scope();
            if let Ok(stored) = self.end_scope_as(scope, false) {
                self.insert_relation(key, FAILED | STACK_DEPTH_OVERFLOW, stored);
            }
            // There is no error node: `errorNode = c.currentNode`.
            self.error_at_current_expression(2321, &[Arg::Type(source), Arg::Type(target)]);
        } else if hit_cached_overflow && !overflow && !result.holds() {
            // `reportRelationError`: the overflow replaces the relation error only if it was recorded for `source` and `target`.
            let (key, _) = self.relation_key(source, target, relation, STATE_NONE, false);
            if self
                .p
                .relations
                .get(&mut self.task, &key)
                .is_some_and(|entry| entry & COMPLEXITY_OVERFLOW != 0)
            {
                self.relation_too_complex = true;
            }
        }
        let is_related = !overflow && result.holds();
        // `checkTypeRelatedToEx` records an overflow "such that we don't attempt the overflowing operation again". Where these limits are hit
        // depends on the caller, so the record is private to this checker.
        if self.cuts() != cuts && !is_trial {
            let (key, _) = self.relation_key(source, target, relation, STATE_NONE, false);
            self.relations_cut_short
                .insert(key, (outermost, is_related));
        }
        is_related
    }

    /// `isSimpleTypeRelatedTo`. `sd`, `td`: the `TypeData` of `s` and `t`.
    #[inline]
    fn is_simple_type_related_to(
        &mut self,
        s: TypeId,
        sd: &'p TypeData,
        t: TypeId,
        td: &'p TypeData,
        relation: Relation,
        error_reporter: Option<&mut Relater>,
    ) -> bool {
        // No rule has an object type on both sides.
        if is_object_kind(sd) && is_object_kind(td) {
            return false;
        }
        self.is_simple_type_related_to_by_rule(s, t, relation, error_reporter)
    }

    /// The rules of `is_simple_type_related_to`: `isSimpleTypeRelatedTo`, over `s` and `t` as there.
    fn is_simple_type_related_to_by_rule(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        error_reporter: Option<&mut Relater>,
    ) -> bool {
        let (s, t) = (self.flags(source), self.flags(target));
        if t & tf::ANY != 0
            || s & tf::NEVER != 0
            || source == TypeId::UNRESOLVED
            || source == TypeId::WILDCARD
        {
            return true;
        }
        if t & tf::UNKNOWN != 0 && !(relation == Relation::StrictSubtype && s & tf::ANY != 0) {
            return true;
        }
        if t & tf::NEVER != 0 {
            return false;
        }
        if s & tf::STRING_LIKE != 0 && t & tf::STRING != 0
            || s & tf::NUMBER_LIKE != 0 && t & tf::NUMBER != 0
            || s & tf::BIGINT_LIKE != 0 && t & tf::BIGINT != 0
            || s & tf::BOOLEAN_LIKE != 0 && t & tf::BOOLEAN != 0
            || s & tf::ES_SYMBOL_LIKE != 0 && t & tf::ES_SYMBOL != 0
        {
            return true;
        }
        // `source.AsLiteralType().value == target.AsLiteralType().value`, of two strings or two numbers.
        let is_same_value = s & t & (tf::STRING_LITERAL | tf::NUMBER_LITERAL) != 0
            && self.literal_value(source) == self.literal_value(target);
        if is_same_value && s & tf::ENUM_LITERAL != 0 && t & tf::ENUM_LITERAL == 0 {
            return true;
        }
        if s & t & tf::ENUM_LIKE != 0
            && let (Some(a), Some(b)) = (
                self.symbol_of_enum_like(source),
                self.symbol_of_enum_like(target),
            )
            && (s & t & tf::ENUM != 0 && self.files().symbol(a).name == self.files().symbol(b).name
                || s & t & tf::ENUM_LITERAL != 0 && (s & t & tf::UNION != 0 || is_same_value))
            && self.is_enum_type_related_to(a, b, error_reporter)
        {
            return true;
        }
        // Without strictNullChecks they are assignable to anything but `never`, which a union or an
        // intersection may reduce to.
        let is_lax = !self.p.files.options.strict_null_checks && t & tf::UNION_OR_INTERSECTION == 0;
        if s & tf::UNDEFINED != 0 && (is_lax || t & (tf::UNDEFINED | tf::VOID) != 0)
            || s & tf::NULL != 0 && (is_lax || t & tf::NULL != 0)
        {
            return true;
        }
        if s & tf::OBJECT != 0
            && t & tf::NON_PRIMITIVE != 0
            && !(relation == Relation::StrictSubtype
                && !self.is_fresh_object_literal_type(source)
                && self.is_empty_anonymous_object_type(source))
        {
            return true;
        }
        if !relation.is_lenient() {
            return false;
        }
        // So that enums can be used as bit flags.
        let is_numeric_member = t & tf::NUMBER_LITERAL != 0 && t & tf::ENUM_LITERAL != 0;
        s & tf::ANY != 0
            || s & tf::NUMBER != 0 && (t & tf::ENUM != 0 || is_numeric_member)
            || s & tf::NUMBER_LITERAL != 0
                && s & tf::ENUM_LITERAL == 0
                && (t & tf::ENUM != 0 || is_numeric_member && is_same_value)
            || t & tf::UNION != 0 && self.is_unknown_like_union_type(target)
    }

    /// `t.AsLiteralType().value`, of a string or a number.
    fn literal_value(&self, ty: TypeId) -> Option<EnumValue> {
        match *self.data(ty) {
            TypeData::StringLit { value, .. } => Some(EnumValue::String(value)),
            TypeData::NumberLit { bits, .. } => Some(EnumValue::Number(bits)),
            TypeData::EnumLit { value, .. } => Some(value),
            _ => None,
        }
    }

    /// `t.symbol`, of a type with `TypeFlagsEnumLike`.
    fn symbol_of_enum_like(&self, ty: TypeId) -> Option<Sym> {
        match *self.data(ty) {
            TypeData::Enum { symbol, .. } | TypeData::EnumLit { member: symbol, .. } => {
                Some(symbol)
            }
            _ => self.union_enum_symbol(ty),
        }
    }

    /// `isEnumTypeRelatedTo`
    fn is_enum_type_related_to(
        &mut self,
        source: Sym,
        target: Sym,
        error_reporter: Option<&mut Relater>,
    ) -> bool {
        let (source, target) = (self.enum_of(source), self.enum_of(target));
        if source == target {
            return true;
        }
        // `SymbolFlagsRegularEnum`: a `const enum` is related to itself alone.
        let is_regular = |c: &Self, sym: Sym| {
            c.files().decls(sym).iter().any(|&(file, decl)| matches!(decl, crate::bind::Decl::Enum(e) if !c.hir(file)[e].flags.contains(Flags::CONST)))
        };
        if self.files().symbol(source).name != self.files().symbol(target).name
            || !is_regular(self, source)
            || !is_regular(self, target)
        {
            return false;
        }
        let theirs = self.exports_in_order(target);
        for (name, member) in self.exports_in_order(source) {
            // An export of a namespace merged with the enum is not an enum member.
            if !self.files().flags(member).contains(SymFlags::ENUM_MEMBER) {
                continue;
            }
            let other = theirs
                .iter()
                .find(|(n, _)| *n == name)
                .map(|&(_, other)| other)
                .filter(|&other| self.files().flags(other).contains(SymFlags::ENUM_MEMBER));
            let Some(other) = other else {
                if let Some(r) = error_reporter {
                    let declared = self.enum_type(target);
                    let declared = self.type_to_string_fully_qualified(declared);
                    let args = [Arg::Sym(member), Arg::Bytes(&declared)];
                    self.report_error(r, 2324, &args);
                }
                return false;
            };
            let (a, b) = (self.enum_member_type(member), self.enum_member_type(other));
            let value = |c: &Self, ty: TypeId| match c.data(ty) {
                TypeData::EnumLit { value, .. } => Some(*value),
                _ => None,
            };
            // `NaN` differs from itself.
            let is_nan = |value: EnumValue| matches!(value, EnumValue::Number(bits) if f64::from_bits(bits).is_nan());
            let (code, values) = match (value(self, a), value(self, b)) {
                (Some(actual), Some(expected)) if actual != expected || is_nan(actual) => {
                    (4125, [Some(expected), Some(actual)])
                }
                (Some(known @ EnumValue::String(_)), None)
                | (None, Some(known @ EnumValue::String(_))) => (4126, [Some(known), None]),
                _ => continue,
            };
            if let Some(r) = error_reporter {
                let count = 2 + values.iter().flatten().count();
                let values = values.map(|v| v.map(|v| self.enum_value_text(v)).unwrap_or_default());
                let [first, second] = values.each_ref().map(|v| Arg::Bytes(v));
                self.report_error(
                    r,
                    code,
                    &[Arg::Sym(target), Arg::Sym(other), first, second][..count],
                );
            }
            return false;
        }
        true
    }

    // ───────────────────────────── simpler forms ─────────────────────────────

    /// `getNormalizedType`
    pub(super) fn normalized(&mut self, ty: TypeId, writing: bool) -> TypeId {
        let mut t = ty;
        loop {
            let n = match self.data(t) {
                // A union only changes if one of its members is an intersection.
                TypeData::Union(_) if !self.may_be_reduced(t) => return t,
                TypeData::Union(_) | TypeData::Intersection(_) => {
                    self.normalized_union_or_intersection(t, writing)
                }
                TypeData::IndexedAccess { .. } | TypeData::Cond { .. } => {
                    self.simplified(t, writing)
                }
                TypeData::Tuple {
                    flags, readonly, ..
                } if flags.iter().any(|f| f.contains(ElemFlags::VARIADIC)) => {
                    let elems = self.type_arguments(t);
                    let simpler: SmallVec<[TypeId; 8]> =
                        elems.iter().map(|&e| self.simplified(e, writing)).collect();
                    if simpler[..] == elems[..] {
                        t
                    } else {
                        self.normalized_tuple(&simpler, flags, *readonly)
                    }
                }
                &TypeData::Substitution { base, .. } if writing => base,
                &TypeData::Substitution { base, constraint } => {
                    self.substitution_intersection(base, constraint)
                }
                // `createTypeReference(t.Target(), getTypeArguments(t))`, of a deferred type reference.
                TypeData::Tuple { .. } => return self.without_alias_of_reference(t),
                TypeData::Ref { .. } => match self.without_alias_of_reference(t) {
                    n if n != t => n,
                    _ => self.single_base_for_non_augmenting_subtype(t).unwrap_or(t),
                },
                data if is_fresh_literal_kind(data) => self.with_freshness(t, false),
                _ => return t,
            };
            if n == t {
                return t;
            }
            t = n;
        }
    }

    /// `getNormalizedUnionOrIntersectionType`
    fn normalized_union_or_intersection(&mut self, t: TypeId, writing: bool) -> TypeId {
        let reduced = self.reduced(t);
        if reduced != t {
            return reduced;
        }
        if let TypeData::Intersection(parts) = self.data(t) {
            // `Partial<T>[K] & {}` is `T[K] & {}`.
            let has_instantiable = parts.iter().any(|&p| self.is_instantiable(p));
            let has_nullable_or_empty = parts.iter().any(|&p| {
                p.is_null() || p.is_undefined() || self.is_empty_anonymous_object_type(p)
            });
            if has_instantiable && has_nullable_or_empty {
                let normalized: Vec<TypeId> =
                    parts.iter().map(|&p| self.normalized(p, writing)).collect();
                if normalized[..] != parts[..] {
                    return self.intersection(&normalized);
                }
            }
        }
        t
    }

    /// `getSimplifiedType`
    pub(super) fn simplified(&mut self, t: TypeId, writing: bool) -> TypeId {
        match self.data(t) {
            TypeData::IndexedAccess { .. } => self.simplified_indexed_access(t, writing),
            TypeData::Cond { .. } => self.simplified_conditional(t, writing),
            _ => t,
        }
    }

    /// `getSimplifiedIndexedAccessType`
    fn simplified_indexed_access(&mut self, t: TypeId, writing: bool) -> TypeId {
        if let Some(&known) = self.simplified.get(&(t, writing)) {
            return known;
        }
        let cycles_before = self.cycles;
        self.simplified.insert((t, writing), t);
        let mut result = self.simplified_indexed_access_worker(t, writing);
        if result != t {
            result = self.filter(result, |_, m| m != t);
        }
        // A result computed while a resolution cycle was hit is not cacheable.
        if self.cycles != cycles_before {
            self.simplified.remove(&(t, writing));
        } else if result != t {
            self.simplified.insert((t, writing), result);
        }
        result
    }

    fn simplified_indexed_access_worker(&mut self, t: TypeId, writing: bool) -> TypeId {
        let TypeData::IndexedAccess { obj, index, .. } = *self.data(t) else {
            return t;
        };
        let object = obj;
        let object = self.simplified(object, writing);
        let index_ty = self.simplified(index, writing);
        // T[A | B] is T[A] | T[B] for reading, T[A] & T[B] for writing.
        if let TypeData::Union(parts) = self.data(index_ty) {
            let types: Vec<TypeId> = parts
                .iter()
                .map(|&p| {
                    let one = self.indexed_access(object, p);
                    self.simplified(one, writing)
                })
                .collect();
            return if writing {
                self.intersection(&types)
            } else {
                self.union(&types)
            };
        }
        if !self.is_instantiable(index_ty) {
            // (T | U)[K] is T[K] | U[K] for reading, T[K] & U[K] for writing. (T & U)[K] is T[K] &
            // U[K].
            let parts = match self.data(object) {
                TypeData::Union(parts) => Some((parts, false)),
                TypeData::Intersection(parts)
                    if !(parts.iter().any(|&p| self.is_instantiable(p))
                        && parts
                            .iter()
                            .any(|&p| self.is_empty_anonymous_object_type(p))) =>
                {
                    Some((parts, true))
                }
                _ => None,
            };
            if let Some((parts, is_intersection)) = parts {
                let types: Vec<TypeId> = parts
                    .iter()
                    .map(|&p| {
                        let one = self.indexed_access(p, index_ty);
                        self.simplified(one, writing)
                    })
                    .collect();
                return if is_intersection || writing {
                    self.intersection(&types)
                } else {
                    self.union(&types)
                };
            }
        }
        // A tuple with a `...T` element, at an index that is not one of the fixed elements: the
        // union of all its element types for `number`, otherwise of those from the first non-fixed
        // element on. `getElementTypeOfSliceOfTupleType`
        if let TypeData::Tuple { flags, .. } = self.data(object)
            && self.is_generic_tuple_type(object)
            && self.is_number_like(index_ty)
        {
            let elems = self.type_arguments(object);
            let from = if index_ty == TypeId::NUMBER {
                0
            } else {
                Self::fixed_length(flags)
            };
            if from < elems.len() {
                let types: Vec<TypeId> = (from..elems.len())
                    .map(|i| {
                        if flags[i].contains(ElemFlags::VARIADIC) {
                            self.indexed_access(elems[i], TypeId::NUMBER)
                        } else {
                            elems[i]
                        }
                    })
                    .collect();
                return if writing {
                    self.intersection(&types)
                } else {
                    self.union(&types)
                };
            }
        }
        // { [P in K]: Box<T[P]> }[X] is Box<T[X]>.
        if self.is_generic_mapped_type(object)
            && let Some(substituted) = self.substitute_indexed_generic_mapped(object, index)
        {
            return self.map_type(substituted, |c, m| c.simplified(m, writing));
        }
        t
    }

    /// `distributeIndexOverObjectType`: (T | U)[K] is T[K] | U[K] for reading, T[K] & U[K] for
    /// writing. (T & U)[K] is T[K] & U[K].
    pub(super) fn distribute_index_over_object_type(
        &mut self,
        object: TypeId,
        index: TypeId,
        writing: bool,
    ) -> Option<TypeId> {
        let (parts, is_intersection) = match self.data(object) {
            TypeData::Union(parts) => (parts, false),
            TypeData::Intersection(parts)
                if !(parts.iter().any(|&p| self.is_instantiable(p))
                    && parts
                        .iter()
                        .any(|&p| self.is_empty_anonymous_object_type(p))) =>
            {
                (parts, true)
            }
            _ => return None,
        };
        let types: Vec<TypeId> = parts
            .iter()
            .map(|&p| {
                let one = self.indexed_access(p, index);
                self.simplified(one, writing)
            })
            .collect();
        Some(if is_intersection || writing {
            self.intersection(&types)
        } else {
            self.union(&types)
        })
    }

    /// `substituteIndexedMappedType`, for a mapped type whose keys are not resolved yet. `None`:
    /// its `as` clause renames them (`MappedTypeNameTypeKindRemapping`).
    pub(super) fn substitute_indexed_generic_mapped(
        &mut self,
        object: TypeId,
        index: TypeId,
    ) -> Option<TypeId> {
        let (file, node, mapper) = self.mapped_origin(object)?;
        let mapped = self.mapped_decl(file, node);
        // `getMappedTypeNameTypeKind`: a name type that always yields the key itself, or no key,
        // only filters keys.
        if let Some(name) = self.mapped_name_type(object) {
            let key = self.mapped_type_param(object);
            if !self.is_assignable(name, key) {
                return None;
            }
        }
        if mapped.ty.is_none() {
            return Some(TypeId::ERROR);
        }
        let param = self.type_param(file, mapped.param);
        let mut pairs = self.types().mapping(mapper).to_vec();
        pairs.push((param, index));
        let with_key = self.types().mapper(pairs);
        let template = self.type_from_node(file, mapped.ty);
        let template = self.instantiate(template, with_key);
        // Unless it declares `?` itself, the optionality comes from its modifiers type, with or
        // without `-?`.
        let optional = mapped.optional == MappedModifier::Add || {
            let modifiers = self.mapped_modifiers_type(object);
            modifiers.is_some_and(|m| self.combined_mapped_optionality(m) > 0)
        };
        Some(if optional {
            self.optional_property(template)
        } else {
            template
        })
    }

    /// `getSimplifiedConditionalType`: `T extends U ? T : never` and `T extends U ? never : T`.
    fn simplified_conditional(&mut self, t: TypeId, writing: bool) -> TypeId {
        if let Some(&known) = self.simplified.get(&(t, writing)) {
            return known;
        }
        let cycles_before = self.cycles;
        let result = self.simplified_conditional_worker(t, writing);
        // A result computed while a resolution cycle was hit is not cacheable.
        if self.cycles == cycles_before {
            self.simplified.insert((t, writing), result);
        }
        result
    }

    fn simplified_conditional_worker(&mut self, t: TypeId, writing: bool) -> TypeId {
        let (check, extends) = (self.cond_check(t), self.cond_extends(t));
        let (yes, no) = (self.cond_true(t), self.cond_false(t));
        let checked = self.actual_type_variable(check);
        if no.is_never() && self.actual_type_variable(yes) == checked {
            if self.has_any_flag(check) || self.is_assignable_restrictive(check, extends) {
                return self.simplified(yes, writing);
            }
            if self.intersection(&[check, extends]).is_never() {
                return TypeId::NEVER;
            }
        } else if yes.is_never() && self.actual_type_variable(no) == checked {
            if !self.has_any_flag(check) && self.is_assignable_restrictive(check, extends) {
                return TypeId::NEVER;
            }
            if self.has_any_flag(check) || self.intersection(&[check, extends]).is_never() {
                return self.simplified(no, writing);
            }
        }
        t
    }

    /// `getSimplifiedTypeOrConstraint`
    pub(super) fn simplified_or_constraint(&mut self, t: TypeId) -> Option<TypeId> {
        let simplified = self.simplified(t, false);
        if simplified != t {
            Some(simplified)
        } else {
            self.constraint_of(t)
        }
    }

    // ───────────────────────────── constraints ─────────────────────────────

    /// `getConstraintOfType`
    pub(super) fn constraint_of(&mut self, t: TypeId) -> Option<TypeId> {
        match *self.data(t) {
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_) => {
                self.constraint_of_type_param(t)
            }
            // `getConstraintOfIndexedAccess`: an indexed access whose base constraint is circular has no constraint.
            TypeData::IndexedAccess {
                obj,
                index,
                undefined,
            } => {
                if !self.has_non_circular_base_constraint(t) {
                    return None;
                }
                self.constraint_of_indexed_access(obj, index, undefined)
            }
            // `getConstraintOfConditionalType`
            TypeData::Cond { .. } => (self.has_non_circular_base_constraint(t))
                .then(|| self.constraint_from_conditional(t)),
            _ => self.base_constraint_of(t),
        }
    }

    /// `getConstraintFromConditionalType`
    pub(super) fn constraint_from_conditional(&mut self, t: TypeId) -> TypeId {
        match self.constraint_of_distributive_conditional(t) {
            Some(constraint) => constraint,
            None => self.default_constraint_of_conditional(t),
        }
    }

    /// `getConstraintFromIndexedAccess`. `undefined`: the part of `accessFlags` that the indexed
    /// access type stores.
    fn constraint_of_indexed_access(
        &mut self,
        obj: TypeId,
        index: TypeId,
        undefined: bool,
    ) -> Option<TypeId> {
        if let Some(substituted) = self.substitute_indexed_mapped(obj, index) {
            return Some(substituted);
        }
        if let Some(constraint) = self.simplified_or_constraint(index)
            && constraint != index
            && let Some(access) = self.indexed_access_flagged(obj, constraint, undefined, None)
        {
            return Some(access);
        }
        if let Some(constraint) = self.simplified_or_constraint(obj)
            && constraint != obj
        {
            return self.indexed_access_flagged(constraint, index, undefined, None);
        }
        None
    }

    /// `hasNonCircularBaseConstraint`
    pub(super) fn has_non_circular_base_constraint(&mut self, t: TypeId) -> bool {
        self.base_constraint(t);
        // `circularConstraintType`: marked while the computation is in progress, stored with the
        // value afterwards. The read always hits: every caller passes a type of a kind that has an
        // entry.
        !self.constraints_marked_circular.contains(&t)
            && !(self.p.constraints.get(&mut self.task, &t))
                .is_some_and(|(_, is_circular)| is_circular)
    }

    /// `getBaseConstraintOfType`. `None`: there is none.
    pub(super) fn base_constraint_of(&mut self, t: TypeId) -> Option<TypeId> {
        self.base_constraint_of_as(t, false)
    }

    /// `nested`: the caller is `computeBaseConstraint`, which passes its stack on
    /// (`getNextBaseConstraint`).
    pub(super) fn base_constraint_of_as(&mut self, t: TypeId, nested: bool) -> Option<TypeId> {
        match self.data(t) {
            TypeData::Template { texts, types } => {
                let constraints: Vec<TypeId> = types
                    .iter()
                    .map(|&ty| self.base_constraint_of_as(ty, nested).unwrap_or(ty))
                    .collect();
                // Any string, if some placeholder has no known constraint. A placeholder that is
                // not generic is used as is.
                if constraints
                    .iter()
                    .any(|&c| c == TypeId::UNKNOWN || self.is_deferred(c))
                {
                    return Some(TypeId::STRING);
                }
                if constraints[..] == types[..] {
                    return Some(t);
                }
                Some(self.template_type(texts, &constraints))
            }
            TypeData::StringMapping { kind, ty } => {
                let constraint = self.base_constraint_of_as(*ty, nested).unwrap_or(*ty);
                Some(if constraint != *ty && constraint != TypeId::UNKNOWN {
                    self.string_mapping(*kind, constraint)
                } else {
                    TypeId::STRING
                })
            }
            // `noConstraintType`, `circularConstraintType`: no constraint. A union has no
            // constraint if some member has none, an intersection if no member has one.
            data if is_union_or_intersection_kind(data)
                || is_instantiable_kind(data)
                || is_generic_tuple_kind(data) =>
            {
                Some(if nested {
                    self.next_base_constraint(t)
                } else {
                    self.base_constraint(t)
                })
                .filter(|&c| c != TypeId::UNKNOWN)
            }
            _ => None,
        }
    }

    /// `getBaseConstraintOrType`
    pub(super) fn base_constraint_or_type(&mut self, t: TypeId) -> TypeId {
        self.base_constraint_of(t).unwrap_or(t)
    }

    /// `getEffectiveConstraintOfIntersection`
    fn effective_constraint_of_intersection(
        &mut self,
        types: &[TypeId],
        target_is_union: bool,
    ) -> Option<TypeId> {
        let mut constraints: Vec<TypeId> = Vec::new();
        let mut has_disjoint_domain_type = false;
        let is_disjoint = |c: &mut Self, t: TypeId| {
            c.has_primitive_flag(t) || t == TypeId::OBJECT || c.is_empty_anonymous_object_type(t)
        };
        for &t in types {
            if self.is_instantiable(t) {
                // Only while it is known not to be circular, hence not through `T[K]`.
                let mut constraint = self.constraint_of(t);
                let mut steps = 0;
                while let Some(c) = constraint
                    && (self.is_type_param(c)
                        || matches!(self.data(c), TypeData::Keyof(_) | TypeData::Cond { .. }))
                    && steps < 32
                {
                    constraint = self.constraint_of(c);
                    steps += 1;
                }
                if let Some(c) = constraint {
                    constraints.push(c);
                    if target_is_union {
                        constraints.push(t);
                    }
                }
            } else if is_disjoint(self, t) {
                has_disjoint_domain_type = true;
            }
        }
        if constraints.is_empty() || !(target_is_union || has_disjoint_domain_type) {
            return None;
        }
        if has_disjoint_domain_type {
            for &t in types {
                if is_disjoint(self, t) {
                    constraints.push(t);
                }
            }
        }
        let whole = self.intersection_without_constraint_reduction(&constraints);
        Some(self.normalized(whole, false))
    }

    // ───────────────────────────── conditional types ─────────────────────────────

    pub(super) fn cond_origin(&self, t: TypeId) -> (FileId, TypeNodeId, MapperId, [TypeNodeId; 4]) {
        let TypeData::Cond {
            file, node, mapper, ..
        } = *self.data(t)
        else {
            unreachable!()
        };
        let TypeNodeKind::Cond {
            check,
            extends,
            yes,
            no,
        } = self.hir(file)[node].kind
        else {
            unreachable!()
        };
        (file, node, mapper, [check, extends, yes, no])
    }

    pub(super) fn cond_piece(&mut self, t: TypeId, which: usize) -> TypeId {
        let (file, _, mapper, nodes) = self.cond_origin(t);
        let declared = self.type_from_node(file, nodes[which]);
        self.instantiate(declared, mapper)
    }

    pub(super) fn cond_check(&mut self, t: TypeId) -> TypeId {
        self.cond_piece(t, 0)
    }

    pub(super) fn cond_extends(&mut self, t: TypeId) -> TypeId {
        self.cond_piece(t, 1)
    }

    /// `getTrueTypeFromConditionalType`
    pub(super) fn cond_true(&mut self, t: TypeId) -> TypeId {
        self.cond_piece(t, 2)
    }

    /// `getFalseTypeFromConditionalType`
    pub(super) fn cond_false(&mut self, t: TypeId) -> TypeId {
        self.cond_piece(t, 3)
    }

    pub(super) fn cond_infer_params(&mut self, t: TypeId) -> Vec<TypeId> {
        let (file, _, _, nodes) = self.cond_origin(t);
        let mut params = Vec::new();
        self.collect_infer_params(file, nodes[1], &mut params);
        params
            .into_iter()
            .map(|p| self.type_param(file, p))
            .collect()
    }

    /// The check type, if it is a naked type parameter: the conditional type then distributes over
    /// union members.
    fn cond_distributes_over(&mut self, t: TypeId) -> Option<TypeId> {
        let (file, _, _, nodes) = self.cond_origin(t);
        let declared = self.type_from_node(file, nodes[0]);
        matches!(self.data(declared), TypeData::TypeParam(..)).then_some(declared)
    }

    /// `getInferredTrueTypeFromConditionalType`: the true branch instantiated with
    /// `combinedMapper`, that is with the inferences `getConditionalType` made before it deferred
    /// the conditional type. Nothing is inferred from a type that is itself deferred: the inferred
    /// type parameters are then as wide as possible.
    fn cond_inferred_true(&mut self, t: TypeId) -> TypeId {
        let params = self.cond_infer_params(t);
        let (file, _, mapper, nodes) = self.cond_origin(t);
        if params.is_empty() {
            return self.cond_true(t);
        }
        let check = self.cond_check(t);
        // `isDeferredType(checkType, checkTuples)`
        let hir = self.hir(file);
        let simple_tuple_len = |node: TypeNodeId| match hir[node].kind {
            TypeNodeKind::Tuple(elems)
                if !elems.is_empty() && elems.iter().all(|e| !hir[e].optional && !hir[e].rest) =>
            {
                Some(elems.iter().count())
            }
            _ => None,
        };
        let check_tuples =
            simple_tuple_len(nodes[0]).is_some_and(|len| simple_tuple_len(nodes[1]) == Some(len));
        let check_is_deferred = self.is_generic(check)
            || check_tuples
                && self.is_tuple(check)
                && self
                    .type_arguments(check)
                    .iter()
                    .any(|&e| self.is_generic(e));
        let mut pairs = self.types().mapping(mapper).to_vec();
        if check_is_deferred {
            for &param in &params {
                let widest = match self.constraint_of_type_param(param) {
                    Some(constraint) => self.instantiate(constraint, mapper),
                    None => TypeId::UNKNOWN,
                };
                pairs.push((param, widest));
            }
        } else {
            let extends = self.cond_extends(t);
            let inferred = self.infer_from_types(&params, check, extends, mapper);
            pairs.extend(params.iter().copied().zip(inferred));
        }
        let combined = self.types().mapper(pairs);
        let declared = self.type_from_node(file, nodes[2]);
        self.instantiate(declared, combined)
    }

    /// `getDefaultConstraintOfConditionalType`
    pub(super) fn default_constraint_of_conditional(&mut self, t: TypeId) -> TypeId {
        let (yes, no) = (self.cond_inferred_true(t), self.cond_false(t));
        // A branch that is `any` would make the whole assignable to anything.
        if self.is_any(yes) {
            no
        } else if self.is_any(no) {
            yes
        } else {
            self.union(&[yes, no])
        }
    }

    /// `getConstraintOfDistributiveConditionalType`, computed once (`resolvedConstraintOfDistributive`).
    pub(super) fn constraint_of_distributive_conditional(&mut self, t: TypeId) -> Option<TypeId> {
        // A type that `getRestrictiveInstantiation` returned has none. A conditional type inside
        // one has.
        if self
            .restrictive_operands
            .last()
            .is_some_and(|&(source, target)| t == source || t == target)
        {
            return None;
        }
        if let Some(&cached) = self.cond_distributive_memo.get(&t) {
            return cached;
        }
        let cycles_before = self.cycles;
        let result = self.constraint_of_distributive_conditional_worker(t);
        // A result computed while a resolution cycle was hit may be incomplete, so it is not cached.
        if self.cycles == cycles_before {
            self.cond_distributive_memo.insert(t, result);
        }
        result
    }

    fn constraint_of_distributive_conditional_worker(&mut self, t: TypeId) -> Option<TypeId> {
        let param = self.cond_distributes_over(t)?;
        let (file, node, mapper, _) = self.cond_origin(t);
        let check = self.cond_check(t);
        let mut constraint = self.simplified(check, false);
        if constraint == check {
            constraint = self.constraint_of(check)?;
        }
        if constraint == check {
            return None;
        }
        let mut pairs = self.types().mapping(mapper).to_vec();
        pairs.retain(|p| p.0 != param);
        pairs.push((param, constraint));
        let with_constraint = self.types().mapper(pairs);
        let instantiated = self.conditional_type_uncached(file, node, with_constraint, true, None);
        (!instantiated.is_never()).then_some(instantiated)
    }

    /// `isDistributionDependent`
    fn is_distribution_dependent(&mut self, t: TypeId) -> bool {
        let Some(param) = self.cond_distributes_over(t) else {
            return false;
        };
        let (file, _, _, nodes) = self.cond_origin(t);
        let probe = self.mapper_from(&[param], &[TypeId::MARKER_OTHER]);
        [nodes[2], nodes[3]].into_iter().any(|node| {
            let declared = self.type_from_node(file, node);
            self.instantiate(declared, probe) != declared
        })
    }

    // ───────────────────────────── mapped types ─────────────────────────────

    pub(super) fn mapped_origin(&self, t: TypeId) -> Option<(FileId, TypeNodeId, MapperId)> {
        match *self.data(t) {
            TypeData::Anon {
                origin: Origin::Mapped(file, node),
                mapper,
            } => Some((file, node, mapper)),
            _ => None,
        }
    }

    /// `getTemplateTypeFromMappedType`: with the missing type added when the mapped type makes
    /// properties optional.
    pub(super) fn mapped_template(&mut self, t: TypeId) -> TypeId {
        let Some((file, node, _)) = self.mapped_origin(t) else {
            return TypeId::UNRESOLVED;
        };
        let mapped = self.mapped_decl(file, node);
        if mapped.ty.is_none() {
            return TypeId::ERROR;
        }
        let declared = self.type_from_node(file, mapped.ty);
        let declared = if mapped.optional == MappedModifier::Add {
            self.optional_property(declared)
        } else {
            declared
        };
        let mapper = self.mapped_mapper(t);
        self.instantiate(declared, mapper)
    }

    /// `getTypeParameterFromMappedType`. An instantiated mapped type has a fresh type parameter,
    /// which ranges over the instantiated keys (`instantiateAnonymousType`).
    pub(super) fn mapped_type_param(&mut self, t: TypeId) -> TypeId {
        let Some((file, node, mapper)) = self.mapped_origin(t) else {
            return TypeId::UNRESOLVED;
        };
        let param = self.mapped_decl(file, node).param;
        self.cloned_type_param(file, param, mapper)
    }

    /// `MappedType.mapper`: maps the outer type parameters of the mapped type `t`, and the declared
    /// type parameter to the one of `t`.
    fn mapped_mapper(&mut self, t: TypeId) -> MapperId {
        let Some((file, node, mapper)) = self.mapped_origin(t) else {
            return MapperId::IDENTITY;
        };
        let declared = self.type_param(file, self.mapped_decl(file, node).param);
        let own = self.mapped_type_param(t);
        if own == declared {
            return mapper;
        }
        let mut pairs = self.types().mapping(mapper).to_vec();
        pairs.retain(|p| p.0 != declared);
        pairs.push((declared, own));
        self.types().mapper(pairs)
    }

    pub(super) fn mapped_keys(&mut self, t: TypeId) -> TypeId {
        let Some((file, node, mapper)) = self.mapped_origin(t) else {
            return TypeId::UNRESOLVED;
        };
        self.mapped_constraint(file, node, mapper)
    }

    /// `getNameTypeFromMappedType`
    pub(super) fn mapped_name_type(&mut self, t: TypeId) -> Option<TypeId> {
        let (file, node, _) = self.mapped_origin(t)?;
        let name = self.mapped_decl(file, node).name_ty;
        if name.is_none() {
            return None;
        }
        let declared = self.type_from_node(file, name);
        let mapper = self.mapped_mapper(t);
        Some(self.instantiate(declared, mapper))
    }

    pub(super) fn mapped_optional_modifier(&self, t: TypeId) -> MappedModifier {
        match self.mapped_origin(t) {
            Some((file, node, _)) => self.mapped_decl(file, node).optional,
            None => MappedModifier::None,
        }
    }

    /// `getModifiersTypeFromMappedType`
    fn mapped_modifiers_type(&mut self, t: TypeId) -> Option<TypeId> {
        let (file, node, mapper) = self.mapped_origin(t)?;
        let (declared, _) = self.mapped_modifiers_source(file, node)?;
        Some(self.instantiate(declared, mapper))
    }

    /// `getApparentMappedTypeKeys` for `{ [P in keyof X as N]: .. }`: `N` (`name`) applied to the
    /// known keys of `X`.
    /// `None`: the constraint is not declared with `keyof`
    /// (`isMappedTypeWithKeyofConstraintDeclaration`).
    pub(super) fn apparent_mapped_type_keys(
        &mut self,
        name: TypeId,
        mapped: TypeId,
    ) -> Option<TypeId> {
        let (file, node, mapper) = self.mapped_origin(mapped)?;
        let (declared, true) = self.mapped_modifiers_source(file, node)? else {
            return None;
        };
        let modifiers = self.instantiate(declared, mapper);
        let apparent = self.apparent_type(modifiers);
        let param = self.mapped_type_param(mapped);
        // `forEachMappedTypePropertyKeyTypeAndIndexSignatureKeyType`. A non-public property has the
        // key type `never`.
        let mut key_types: Vec<TypeId> = Vec::new();
        if self.is_any(apparent) {
            key_types.push(TypeId::STRING);
        } else if let Some(members) = self.members(apparent) {
            for prop in &members.shape().props {
                let is_public = !prop
                    .flags
                    .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED);
                key_types.push(if is_public {
                    self.key_type_of_name(prop.name).unwrap_or(TypeId::NEVER)
                } else {
                    TypeId::NEVER
                });
            }
            key_types.extend(members.shape().index.iter().map(|i| i.key));
        }
        let mut keys = Vec::with_capacity(key_types.len());
        for key in key_types {
            let one = self.mapper_from(&[param], &[key]);
            keys.push(self.instantiate(name, one));
        }
        Some(self.union(&keys))
    }

    /// `getCombinedMappedTypeOptionality`: -1 optionality is stripped, 1 it is added.
    pub(super) fn combined_mapped_optionality(&mut self, t: TypeId) -> i32 {
        if self.mapped_origin(t).is_some() {
            return match self.mapped_optional_modifier(t) {
                MappedModifier::Remove => -1,
                MappedModifier::Add => 1,
                MappedModifier::None => match self.mapped_modifiers_type(t) {
                    Some(of) if of != t => self.combined_mapped_optionality(of),
                    _ => 0,
                },
            };
        }
        if let TypeData::Intersection(parts) = self.data(t) {
            let first = self.combined_mapped_optionality(parts[0]);
            return if parts[1..]
                .iter()
                .all(|&p| self.combined_mapped_optionality(p) == first)
            {
                first
            } else {
                0
            };
        }
        0
    }

    /// `isMappedTypeGenericIndexedAccess`
    pub(super) fn is_mapped_type_generic_indexed_access(&mut self, t: TypeId) -> bool {
        let TypeData::IndexedAccess { obj, index, .. } = *self.data(t) else {
            return false;
        };
        let Some((file, node, _)) = self.mapped_origin(obj) else {
            return false;
        };
        let mapped = self.mapped_decl(file, node);
        mapped.optional != MappedModifier::Remove
            && mapped.name_ty.is_none()
            && !self.is_generic_mapped_type(obj)
            && self.is_generic_index_type(index)
    }

    // ───────────────────────────── variance ─────────────────────────────

    /// A marker type parameter of a variance computation was inspected in a way that the variance
    /// does not account for. `instantiateType(t, reportUnreliableMapper)`
    fn report_unreliable(&mut self, t: TypeId) {
        if self
            .types()
            .object_flags(t)
            .contains(ObjectFlags::HAS_MARKER)
        {
            self.reliability |= REPORTS_UNRELIABLE;
        }
    }

    fn report_unmeasurable(&mut self, t: TypeId) {
        if self
            .types()
            .object_flags(t)
            .contains(ObjectFlags::HAS_MARKER)
        {
            self.reliability |= REPORTS_UNMEASURABLE;
        }
    }

    /// `isMarkerType` for a reference to a class or an interface.
    pub(super) fn is_marker_type(&mut self, t: TypeId) -> bool {
        // `getVariances`: arrays are never measured.
        if !self
            .types()
            .object_flags(t)
            .contains(ObjectFlags::HAS_MARKER)
            || self.is_array(t)
        {
            return false;
        }
        let TypeData::Ref { target, .. } = self.data(t) else {
            return false;
        };
        let params = self.all_type_params_of_symbol(*target);
        let args = self.type_arguments(t);
        self.are_marker_arguments(*target, &params, args)
    }

    /// Whether the instantiation of `sym`, whose type parameters are `params`, with `args` was
    /// created by `createMarkerType`: each parameter maps to itself, except one that is replaced by
    /// a marker. `variances_of` creates these once it has started on `sym`. Until then such an
    /// instantiation uses the variances of `sym` like any other, which is what starts the
    /// computation.
    pub(super) fn are_marker_arguments(
        &mut self,
        sym: Sym,
        params: &[TypeId],
        args: &[TypeId],
    ) -> bool {
        if params.len() != args.len() {
            return false;
        }
        let mut measured = None;
        for (&arg, &param) in args.iter().zip(params) {
            if self
                .types()
                .object_flags(arg)
                .contains(ObjectFlags::HAS_MARKER)
                && self.is_type_param(arg)
            {
                if measured.replace((param, arg)).is_some() {
                    return false;
                }
            } else if arg != param {
                return false;
            }
        }
        let Some((param, marker)) = measured else {
            return false;
        };
        let modifiers = self.type_param_modifiers(sym, param) & (Flags::IN | Flags::OUT);
        // `checkTypeParameterDeferred` creates marker types with its own two markers, for a parameter declared `in` or `out` but not both.
        if marker == TypeId::MARKER_SUPER_FOR_CHECK || marker == TypeId::MARKER_SUB_FOR_CHECK {
            return modifiers == Flags::IN || modifiers == Flags::OUT;
        }
        // `getVariancesWorker` takes the variance of a parameter declared `in` or `out` from the modifiers and creates no marker type.
        if !modifiers.is_empty() {
            return false;
        }
        self.variances_in_progress.contains(&sym)
            || self.p.variances.get(&mut self.task, &sym).is_some()
    }

    /// `getTypeParameterModifiers`: the modifiers that any declaration of `sym` has on its type
    /// parameter `param`.
    pub(super) fn type_param_modifiers(&self, sym: Sym, param: TypeId) -> Flags {
        let TypeData::TypeParam(of, id, ..) = *self.data(param) else {
            return Flags::empty();
        };
        let own = &self.hir(of)[id];
        let lists: Vec<_> = self
            .files()
            .decls(sym)
            .into_iter()
            .filter_map(|(file, decl)| match decl {
                crate::bind::Decl::Class(c) => Some((file, self.hir(file)[c].type_params)),
                crate::bind::Decl::Interface(i) => Some((file, self.hir(file)[i].type_params)),
                crate::bind::Decl::Alias(a) => Some((file, self.hir(file)[a].type_params)),
                _ => None,
            })
            .collect();
        // An outer type parameter of `sym` has a single declaration.
        if !lists
            .iter()
            .any(|&(file, params)| file == of && params.range().contains(&id.idx()))
        {
            return own.flags;
        }
        let mut modifiers = own.flags;
        for &(file, params) in &lists {
            for tp in params.iter() {
                let other = &self.hir(file)[tp];
                if other.name == own.name {
                    modifiers |= other.flags;
                }
            }
        }
        modifiers
    }

    /// `createMarkerType`: `sym` instantiated with its type parameters `params`, with `marker`
    /// substituted for the one at `index`.
    pub(super) fn create_marker_type(
        &mut self,
        sym: Sym,
        params: &[TypeId],
        index: usize,
        marker: TypeId,
    ) -> TypeId {
        let mut args = params.to_vec();
        args[index] = marker;
        let flags = self.files().flags(sym);
        if flags.contains(SymFlags::TYPE_ALIAS)
            && !flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE)
        {
            self.type_reference(sym, &args)
        } else {
            self.intern(TypeData::Ref {
                target: sym,
                args: args.into(),
            })
        }
    }

    /// `getVariances`, `getAliasVariances`: how instantiations of `sym` relate, given how their
    /// type arguments relate. Empty while the computation is in progress.
    pub(super) fn variances_of(&mut self, sym: Sym) -> Arc<[u8]> {
        if let Some(known) = self.p.variances.get(&mut self.task, &sym) {
            return known;
        }
        self.variances_worker(sym)
    }

    /// `getVariancesWorker`. The caller's cache lookup of `sym` missed.
    fn variances_worker(&mut self, sym: Sym) -> Arc<[u8]> {
        if Some(sym) == self.global_type_symbol(known::Array)
            || Some(sym) == self.global_type_symbol(known::ReadonlyArray)
        {
            let scope = self.begin_scope();
            let variances: Arc<[u8]> = Arc::from([COVARIANT]);
            return match self.end_scope_as(scope, false) {
                Ok(stored) => self
                    .p
                    .variances
                    .insert(&mut self.task, sym, variances, stored),
                Err(_) => variances,
            };
        }
        if self.variances_in_progress.contains(&sym) {
            self.variance_cycles += 1;
            return Arc::from([]);
        }
        // The value of the first task in serial order, for a task that is retried (`Program::validate`).
        let serial = self.p.serial_variances.lock().get(&sym).cloned();
        if let Some(variances) = serial {
            let scope = self.begin_scope();
            return match self.end_scope_as(scope, false) {
                Ok(stored) => self
                    .p
                    .variances
                    .insert(&mut self.task, sym, variances, stored),
                Err(_) => variances,
            };
        }
        let (cuts, outermost) = (
            self.cuts(),
            self.frames.first().map_or(0, |frame| frame.serial),
        );
        if cuts != 0
            && let Some((under, known)) = self.variances_cut_short.get(&sym)
            && *under == outermost
        {
            let known = known.clone();
            self.cut_short_again();
            return known;
        }
        self.variances_in_progress.push(sym);
        let was_computing = std::mem::replace(&mut self.in_variance_computation, true);
        let variance_cycles = self.variance_cycles;
        if !was_computing {
            self.variances_measured.clear();
        }
        // `resolutionStart`: resolutions in progress when the outermost variance computation began
        // are restarted if needed, and the computation in progress stops them from recursing
        // forever.
        let resolution_start = self.resolution_start;
        if !was_computing {
            self.resolution_start = self.stack.len();
        }
        let scope = self.begin_scope();
        let flags = self.files().flags(sym);
        let is_alias = flags.contains(SymFlags::TYPE_ALIAS)
            && !flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE);
        // `getAliasVariances`: the type parameters the alias declares. `getVariances`: the outer
        // type parameters of the declaration are included.
        let params = if is_alias {
            self.type_params_of_symbol(sym)
        } else {
            self.all_type_params_of_symbol(sym)
        };
        let mut variances = Vec::with_capacity(params.len());
        for (i, &param) in params.iter().enumerate() {
            let modifiers = self.type_param_modifiers(sym, param);
            let variance = if modifiers.contains(Flags::OUT) {
                if modifiers.contains(Flags::IN) {
                    INVARIANT
                } else {
                    COVARIANT
                }
            } else if modifiers.contains(Flags::IN) {
                CONTRAVARIANT
            } else {
                let saved = std::mem::replace(&mut self.reliability, 0);
                let with_super = self.create_marker_type(sym, &params, i, TypeId::MARKER_SUPER);
                let with_sub = self.create_marker_type(sym, &params, i, TypeId::MARKER_SUB);
                let mut variance = if self.is_marker_assignable(with_sub, with_super) {
                    COVARIANT
                } else {
                    0
                };
                if self.is_marker_assignable(with_super, with_sub) {
                    variance |= CONTRAVARIANT;
                }
                // Related both ways: possibly because the type parameter is not used at all.
                if variance == BIVARIANT {
                    let with_other = self.create_marker_type(sym, &params, i, TypeId::MARKER_OTHER);
                    if self.is_marker_assignable(with_other, with_super) {
                        variance = INDEPENDENT;
                    }
                }
                if self.reliability & REPORTS_UNMEASURABLE != 0 {
                    variance |= UNMEASURABLE;
                }
                if self.reliability & REPORTS_UNRELIABLE != 0 {
                    variance |= UNRELIABLE;
                }
                self.reliability = saved;
                variance
            };
            variances.push(variance);
        }
        self.in_variance_computation = was_computing;
        self.resolution_start = resolution_start;
        self.variances_in_progress.pop();
        let variances: Arc<[u8]> = variances.into();
        let variances = match self.end_scope(scope) {
            Ok(stored) => {
                self.variances_measured.push((sym, variances.clone()));
                self.p
                    .variances
                    .insert(&mut self.task, sym, variances, stored)
            }
            Err(_) => {
                if self.cuts() != cuts {
                    self.variances_cut_short
                        .insert(sym, (outermost, variances.clone()));
                }
                variances
            }
        };
        if !was_computing && self.variance_cycles != variance_cycles {
            for (sym, variances) in self.variances_measured.drain(..) {
                let at = self.task.order_dependent_variances.len() as u32;
                self.order_dependent.insert(sym, at);
                self.order_dependent_filter |= Self::order_dependent_bit(sym);
                self.task.order_dependent_variances.push(OrderDependent {
                    sym,
                    variances,
                    compared: 0,
                    failed: 0,
                    void_targets: 0,
                    inferred: 0,
                });
            }
        }
        variances
    }

    #[inline]
    fn order_dependent_bit(sym: Sym) -> u64 {
        1 << ((sym.id.0 ^ sym.file.0) & 63)
    }

    /// Call right after `relate_variances` on the type arguments `sources` and `targets` of `sym`. `holds`: they are related.
    #[inline]
    fn note_compared_by_variances<const REPORT: bool>(
        &mut self,
        sym: Sym,
        sources: &[TypeId],
        targets: &[TypeId],
        holds: bool,
    ) {
        if self.order_dependent_filter & Self::order_dependent_bit(sym) != 0
            && let Some(&at) = self.order_dependent.get(&sym)
        {
            // How many pairs were compared.
            let count = match holds {
                true => sources.len().min(targets.len()),
                false => self.failed_type_argument as usize,
            };
            let pairs = || sources.iter().zip(targets).enumerate();
            let bits = |bits: u32, i: usize| bits | 1 << i.min(31);
            // During a variance computation, every variance that is read can set `reliability`.
            let is_measuring = self.in_variance_computation;
            let passed = (pairs().take(count))
                .filter(|(_, (source, target))| is_measuring || source != target)
                .fold(0, |so_far, (i, _)| bits(so_far, i));
            let noted = &mut self.task.order_dependent_variances[at as usize];
            // With other variances an earlier pair could fail first. That changes only the error elaboration.
            if holds || REPORT || is_measuring {
                noted.compared |= passed;
            }
            if !holds {
                noted.failed |= bits(0, count);
                noted.void_targets |= (pairs().filter(|(_, pair)| *pair.1 == TypeId::VOID))
                    .fold(0, |so_far, (i, _)| bits(so_far, i));
            }
        }
    }

    /// `infer_from_type_arguments` has read the variances of the first `count` type parameters of `sym`.
    #[inline]
    pub(super) fn note_inferred_by_variances(&mut self, sym: Sym, count: usize) {
        if self.order_dependent_filter & Self::order_dependent_bit(sym) != 0
            && let Some(&at) = self.order_dependent.get(&sym)
        {
            let all = u32::MAX.checked_shr(32 - count.min(32) as u32).unwrap_or(0);
            self.task.order_dependent_variances[at as usize].inferred |= all;
        }
    }

    fn is_marker_assignable(&mut self, source: TypeId, target: TypeId) -> bool {
        self.is_marker_comparison = true;
        let result = self.is_assignable(source, target);
        self.is_marker_comparison = false;
        result
    }

    /// `variances_of`, as a list.
    fn variances_list(&mut self, sym: Sym) -> List<'p, u8> {
        match self.p.variances.get_ref(&mut self.task, &sym) {
            Some(known) => List::Kept(known),
            None => List::Own(self.variances_worker(sym).to_vec()),
        }
    }

    /// `hasCovariantVoidArgument`
    pub(super) fn has_covariant_void_argument(&self, args: &[TypeId], variances: &[u8]) -> bool {
        variances
            .iter()
            .zip(args)
            .any(|(&v, &a)| v & VARIANCE_MASK == COVARIANT && a == TypeId::VOID)
    }

    // ───────────────────────────── one comparison ─────────────────────────────

    #[inline]
    pub(super) fn is_related_to(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        recursion: u8,
    ) -> Ternary {
        self.is_related_to_ex::<false>(r, source, target, recursion, STATE_NONE)
    }

    /// `isRelatedToEx`. `REPORT` is `reportErrors`, here and in every function that has it.
    pub(super) fn is_related_to_ex<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        original_source: TypeId,
        original_target: TypeId,
        recursion: u8,
        state: u8,
    ) -> Ternary {
        if original_source == original_target {
            return Ternary::TRUE;
        }
        let head = if REPORT { r.head_message.take() } else { None };
        let (original_sd, original_td) = (self.data(original_source), self.data(original_target));
        let relation = r.relation;
        let is_from_related = std::mem::take(&mut r.is_from_related)
            && original_source == r.top_source
            && original_target == r.top_target;
        if !is_from_related
            && is_object_kind(original_sd)
            && self.has_primitive_flag_as(original_target, original_td)
        {
            let is_related = relation == Relation::Comparable
                && !original_target.is_never()
                && self.is_simple_type_related_to(
                    original_target,
                    original_td,
                    original_source,
                    original_sd,
                    relation,
                    None,
                )
                || self.is_simple_type_related_to(
                    original_source,
                    original_sd,
                    original_target,
                    original_td,
                    relation,
                    None,
                );
            if REPORT && !is_related {
                self.report_error_results(
                    r,
                    original_source,
                    original_target,
                    original_source,
                    original_target,
                    head,
                );
            }
            return Ternary::of(is_related);
        }
        // The recursion stops here.
        if REPORT && self.is_stack_low() {
            self.report_error_results(
                r,
                original_source,
                original_target,
                original_source,
                original_target,
                head,
            );
            return Ternary::FALSE;
        }
        let (source, sd) = self.normalized_as(original_source, original_sd, false);
        let (mut target, mut td) = self.normalized_as(original_target, original_td, true);
        // `getRegularTypeOfObjectLiteral` recurses only into properties that are object literals
        // themselves.
        let state = if state & STATE_REGULAR != 0 && !is_object_literal_kind(sd) {
            state & !STATE_REGULAR
        } else {
            state
        };
        if source == target {
            return Ternary::TRUE;
        }
        if relation == Relation::Identity {
            if self.flags(source) != self.flags(target) {
                return Ternary::FALSE;
            }
            if self.flags(source) & tf::SINGLETON != 0 {
                return Ternary::TRUE;
            }
            return self.recursive_type_related_to::<false>(
                r, source, sd, target, td, STATE_NONE, recursion,
            );
        }
        // A type parameter compared with exactly its constraint: very common.
        if is_type_param_kind(sd) && self.constraint_of_type_param(source) == Some(target) {
            return Ternary::TRUE;
        }
        // A source that is never null or undefined, compared with `X | null | undefined`, is
        // compared with `X`.
        if let TypeData::Union(types) = td
            && matches!(types.len(), 2 | 3)
            && self.is_definitely_non_nullable_as(source, sd)
        {
            // In tsgo `undefined` and `null` come first in a union. Here `void` comes before them.
            let mut others = types
                .iter()
                .copied()
                .filter(|t| !t.is_null() && !t.is_undefined());
            if let (Some(candidate), None) = (others.next(), others.next()) {
                target = self.normalized(candidate, true);
                if source == target {
                    return Ternary::TRUE;
                }
                td = self.data(target);
            }
        }
        let error_reporter = REPORT.then_some(&mut *r);
        if !(is_from_related && source == original_source && target == original_target)
            && (relation == Relation::Comparable
                && !target.is_never()
                && self.is_simple_type_related_to(target, td, source, sd, relation, None)
                || self.is_simple_type_related_to(source, sd, target, td, relation, error_reporter))
        {
            return Ternary::TRUE;
        }
        let source_is_structured_or_instantiable = is_structured_or_instantiable_kind(sd);
        if source_is_structured_or_instantiable || is_structured_or_instantiable_kind(td) {
            if state & (STATE_TARGET | STATE_REGULAR) == 0
                && is_fresh_object_literal_kind(sd)
                && self.has_excess_properties::<REPORT>(r, source, target)
            {
                if REPORT {
                    let shown = if self.has_alias(original_target) {
                        original_target
                    } else {
                        target
                    };
                    self.report_relation_error(r, head, source, shown);
                }
                return Ternary::FALSE;
            }
            let is_performing_common_property_checks = state & STATE_TARGET == 0
                && (is_object_kind(td) || matches!(td, TypeData::Intersection(_)))
                && (is_object_kind(sd)
                    || matches!(sd, TypeData::Intersection(_))
                    || self.has_primitive_flag_as(source, sd))
                && (relation != Relation::Comparable || self.is_unit(source))
                && !(matches!(sd, TypeData::Ref { .. })
                    && self.is_reference_to_global(source, known::Object))
                && self.is_weak_type(target)
                && {
                    let apparent = self.apparent_type(source);
                    self.members(apparent).is_some_and(|m| {
                        let s = m.shape();
                        !(s.props.is_empty() && s.call.is_empty() && s.construct.is_empty())
                    })
                };
            if is_performing_common_property_checks && !self.has_common_properties(source, target) {
                if REPORT {
                    let shown_source = if self.has_alias(original_source) {
                        original_source
                    } else {
                        source
                    };
                    let shown_target = if self.has_alias(original_target) {
                        original_target
                    } else {
                        target
                    };
                    let mut is_intended_to_be_called = false;
                    for construct in [false, true] {
                        if !is_intended_to_be_called
                            && let Some(&first) = self.signatures(source, construct).first()
                        {
                            let returned = self.sig_return(first);
                            is_intended_to_be_called =
                                self.is_related_to(r, returned, target, REC_SOURCE).holds();
                        }
                    }
                    let code = if is_intended_to_be_called { 2560 } else { 2559 };
                    self.report_error(r, code, &[Arg::Type(shown_source), Arg::Type(shown_target)]);
                }
                return Ternary::FALSE;
            }
            // `typeRelatedToSomeType`: each member of a union is related to the union. An object
            // literal is searched for by its regular (non-fresh) type. Cases where
            // `recursive_type_related_to` might give a different result are left to it.
            if let TypeData::Union(types) = td
                && !matches!(sd, TypeData::Union(_))
                && !is_object_literal_kind(sd)
                && !r.overflow
                && r.expanding == 0
                && r.relation_count > 0
                && r.source_stack.len() < 100
                && r.target_stack.len() < 100
                && self.contains_type(types, source)
            {
                return Ternary::TRUE;
            }
            let skip_caching = match (sd, td) {
                (TypeData::Union(s), t) if s.len() < 4 && !matches!(t, TypeData::Union(_)) => true,
                (_, TypeData::Union(t)) if t.len() < 4 && !source_is_structured_or_instantiable => {
                    true
                }
                _ => false,
            };
            let result = if skip_caching {
                self.union_or_intersection_related_to_as::<REPORT>(r, source, sd, target, td, state)
            } else {
                self.recursive_type_related_to::<REPORT>(
                    r, source, sd, target, td, state, recursion,
                )
            };
            if result.holds() {
                return result;
            }
        }
        if REPORT {
            self.report_error_results(r, original_source, original_target, source, target, head);
        }
        Ternary::FALSE
    }

    // ───────────────────────────── object literals and weak types ─────────────────────────────

    /// `isImplementationCompatibleWithOverload`
    pub(super) fn is_implementation_compatible_with_overload(
        &mut self,
        implementation: SigId,
        overload: SigId,
    ) -> bool {
        let (source, target) = (self.erased_sig(implementation), self.erased_sig(overload));
        let (source_return, target_return) = (self.sig_return(source), self.sig_return(target));
        // Their return types must be related in one direction or the other.
        if target_return != TypeId::VOID
            && !self.is_assignable(target_return, source_return)
            && !self.is_assignable(source_return, target_return)
        {
            return false;
        }
        let mut r = Relater::new(Relation::Assignable, self.cycles);
        self.compare_signatures_related::<false>(
            &mut r,
            source,
            target,
            (implementation, overload),
            IGNORE_RETURN_TYPES,
            0,
        )
        .holds()
    }

    /// `findMatchingDiscriminantType`, called from outside a relation check.
    pub(super) fn matching_discriminant_type(
        &mut self,
        source: TypeId,
        target: TypeId,
    ) -> Option<TypeId> {
        let mut r = Relater::new(Relation::Assignable, self.cycles);
        self.find_matching_discriminant_type(&mut r, source, target)
    }

    /// `hasExcessProperties`
    pub(super) fn has_excess_properties<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
    ) -> bool {
        if !self.is_excess_property_check_target(target) {
            return false;
        }
        let (sd, td) = (self.data(source), self.data(target));
        // `ObjectFlagsJSLiteral` on the target itself: without noImplicitAny a JS literal accepts any property.
        if !self.p.files.options.no_implicit_any && self.has_js_literal_flag(target) {
            return false;
        }
        // A target that accepts anything accepts any object literal, but not any JSX attribute.
        let is_jsx =
            matches!(sd, TypeData::Synth(shape) if shape.literal == Literalness::JsxAttributes);
        if r.relation.is_lenient()
            && (self.contains_global_object_type(target)
                || !is_jsx && self.is_empty_object_type(target))
        {
            return false;
        }
        // The type of an object literal checked under `CheckModeSkipContextSensitive` is fresh. It reaches the strict subtype relation
        // through `removeSubtypes`. `chooseOverload` compares its `getRegularTypeOfObjectLiteral`, under the other relations.
        let is_fresh_partial = r.relation == Relation::StrictSubtype
            && matches!(sd, TypeData::Synth(shape) if shape.literal == Literalness::Partial);
        let mut reduced_target = target;
        let is_union = matches!(td, TypeData::Union(_));
        if is_union {
            reduced_target = match self.find_matching_discriminant_type(r, source, target) {
                Some(found) => found,
                None => self.filter_primitives_if_contains_non_primitive(target),
            };
        }
        let literal = match *sd {
            TypeData::Anon {
                origin: Origin::ObjectLiteral(file, e, ..),
                ..
            } => Some((file, e)),
            _ => None,
        };
        let Some(sm) = self.members(source) else {
            return false;
        };
        for prop in &sm.shape().props {
            // `isIgnoredJsxProperty`
            if is_jsx && self.atoms().bytes(prop.name).contains(&b'-') {
                continue;
            }
            // `shouldCheckAsExcessProperty`: properties copied by a spread are not checked.
            let written_here = match (&prop.source, literal) {
                (PropSource::Literal(file, p), Some((of, e))) => {
                    *file == of && self.bound(of).prop_owner[p.idx()] == e
                }
                (PropSource::Literal(..), None) => true,
                // The synthesized children property is declared in the attributes node, so it is
                // checked like an explicit attribute. Children alone do not make the attributes
                // type fresh (`createJsxAttributesTypeFromAttributesProperty`), so an explicit
                // attribute is required. A property copied by a spread is declared elsewhere.
                // A `Partial` shape holds only properties declared in the literal.
                (PropSource::Type(_) | PropSource::Copy(..), None) => {
                    is_fresh_partial
                        || prop.flags.contains(PropFlags::WRITTEN)
                        || is_jsx
                            && prop.flags.contains(PropFlags::JSX_CHILDREN)
                            && sm.shape().props.iter().any(|p| {
                                matches!(p.source, PropSource::Literal(..))
                                    || p.flags.contains(PropFlags::WRITTEN)
                            })
                }
                _ => false,
            };
            if !written_here {
                continue;
            }
            if !self.is_known_property(reduced_target, prop.name) {
                if REPORT {
                    let error_target =
                        self.filter(reduced_target, |c, m| c.is_excess_property_check_target(m));
                    let args = [Arg::Prop(prop), Arg::Type(error_target)];
                    if is_jsx {
                        if let Some(&PropSource::Literal(file, p)) = Self::value_declaration(prop)
                            && r.error_node.0 == file
                        {
                            let end = self.end_of_jsx_attr_name(file, p);
                            r.error_node = (file, self.hir(file)[p].pos, end);
                        }
                        self.report_unknown_jsx_attribute(r, prop, error_target);
                        return true;
                    }
                    // Only a name that is an identifier in the current file is treated as a
                    // possible misspelling.
                    // `prop.ValueDeclaration`
                    let is_identifier = match Self::value_declaration(prop) {
                        Some(&PropSource::Literal(file, p)) if r.error_node.0 == file => {
                            let (hir, written) = (self.hir(file), &self.hir(file)[p]);
                            r.error_node = (file, written.pos, self.end_of_prop_name(file, p));
                            matches!(written.key, PropKey::Name(_))
                                && !matches!(
                                    hir.text.get(written.pos as usize),
                                    Some(b'"' | b'\'' | b'.' | b'[' | b'0'..=b'9')
                                )
                        }
                        _ => false,
                    };
                    let mut suggestion = None;
                    if is_identifier {
                        let properties = self.properties_of_type(error_target);
                        let written = self.atoms().bytes(prop.name);
                        suggestion = self
                            .suggested_property(written, &properties)
                            .map(|i| Arg::Atom(properties[i].name));
                    }
                    match suggestion {
                        Some(name) => self.report_error(r, 2561, &[args[0], args[1], name]),
                        None => self.report_error(r, 2353, &args),
                    }
                }
                return true;
            }
            if is_union {
                let actual = self.type_of_prop(prop, sm.mapper);
                let expected: SmallVec<[TypeId; 8]> = self
                    .parts(reduced_target)
                    .iter()
                    .map(|&t| self.type_of_property_in_type(t, prop.name))
                    .collect();
                let expected = self.union(&expected);
                if !self
                    .is_related_to_ex::<REPORT>(r, actual, expected, REC_BOTH, STATE_NONE)
                    .holds()
                {
                    if REPORT {
                        self.report_error(r, 2326, &[Arg::Prop(prop)]);
                    }
                    return true;
                }
            }
        }
        false
    }

    /// `isTypeSubsetOf(globalObjectType, target)`
    pub(super) fn contains_global_object_type(&self, target: TypeId) -> bool {
        self.parts(target)
            .iter()
            .any(|&p| self.is_reference_to_global(p, known::Object))
    }

    /// `getTypeOfPropertyInType`
    pub(super) fn type_of_property_in_type(&mut self, t: TypeId, name: Atom) -> TypeId {
        let t = self.apparent_type(t);
        let Some(members) = self.members(t) else {
            return TypeId::UNDEFINED;
        };
        if let Some(prop) = members.resolved.prop(name) {
            return self.type_of_prop_with_missing(prop, members.mapper);
        }
        self.applicable_index_info_for_name(&members, name)
            .map(|info| info.value)
            .unwrap_or(TypeId::UNDEFINED)
    }

    /// `isExcessPropertyCheckTarget`
    pub(super) fn is_excess_property_check_target(&self, t: TypeId) -> bool {
        match self.data(t) {
            TypeData::Union(parts) => parts
                .iter()
                .any(|&p| self.is_excess_property_check_target(p)),
            TypeData::Intersection(parts) => parts
                .iter()
                .all(|&p| self.is_excess_property_check_target(p)),
            TypeData::Substitution { base, .. } => self.is_excess_property_check_target(*base),
            // `ObjectFlagsObjectLiteralPatternWithComputedProperties`: its other properties are
            // unknown.
            TypeData::Synth(shape) => shape.literal != Literalness::PatternWithComputedNames,
            data => t == TypeId::OBJECT || is_object_kind(data),
        }
    }

    /// `isKnownProperty`
    pub(super) fn is_known_property(&mut self, t: TypeId, name: Atom) -> bool {
        match self.data(t) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                self.is_excess_property_check_target(t)
                    && parts.iter().any(|&p| self.is_known_property(p, name))
            }
            TypeData::Substitution { base, .. } => self.is_known_property(*base, name),
            data => {
                if !is_object_kind(data) {
                    return false;
                }
                let Some(members) = self.members(t) else {
                    return true;
                };
                if members.resolved.prop(name).is_some()
                    || self
                        .applicable_index_info_for_name(&members, name)
                        .map(|info| info.value)
                        .is_some()
                {
                    return true;
                }
                // A name derived from a symbol is accepted by a string index signature.
                self.atoms().is_symbol_name(name)
                    && members
                        .shape()
                        .index
                        .iter()
                        .any(|i| i.key == TypeId::STRING)
            }
        }
    }

    /// `isWeakType`: properties, all of them optional, and nothing else.
    pub(super) fn is_weak_type(&mut self, t: TypeId) -> bool {
        let data = self.data(t);
        if let TypeData::Intersection(parts) = data {
            return parts.iter().all(|&p| self.is_weak_type(p));
        }
        if let TypeData::Substitution { base, .. } = data {
            return self.is_weak_type(*base);
        }
        if !is_object_kind(data) || is_mapped_kind(data) && self.is_generic(t) {
            return false;
        }
        self.members(t).is_some_and(|m| {
            let s = m.shape();
            !s.props.is_empty()
                && s.call.is_empty()
                && s.construct.is_empty()
                && s.index.is_empty()
                && s.props
                    .iter()
                    .all(|p| p.flags.contains(PropFlags::OPTIONAL))
        })
    }

    /// `hasCommonProperties`
    pub(super) fn has_common_properties(&mut self, source: TypeId, target: TypeId) -> bool {
        let apparent = self.apparent_type(source);
        let Some(sm) = self.members(apparent) else {
            return false;
        };
        // An attribute with a hyphen in its name is treated as known.
        let is_jsx = matches!(self.data(source), TypeData::Synth(shape) if shape.literal == Literalness::JsxAttributes);
        sm.shape().props.iter().any(|p| {
            is_jsx && self.atoms().bytes(p.name).contains(&b'-')
                || self.is_known_property(target, p.name)
        })
    }

    /// `filterPrimitivesIfContainsNonPrimitive`
    pub(super) fn filter_primitives_if_contains_non_primitive(&mut self, union: TypeId) -> TypeId {
        if self.some_type(union, |_, m| m == TypeId::OBJECT) {
            let result = self.filter(union, |c, m| !c.has_primitive_flag(m));
            if !result.is_never() {
                return result;
            }
        }
        union
    }

    /// `findMatchingDiscriminantType`
    pub(super) fn find_matching_discriminant_type(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
    ) -> Option<TypeId> {
        if !self.is_union(target) || !(self.is_object_type(source) || self.is_intersection(source))
        {
            return None;
        }
        if let Some(matching) = self.matching_union_constituent_for_type(target, source) {
            return Some(matching);
        }
        let sm = self.members(source)?;
        let telling: SmallVec<[&Prop; 4]> = sm
            .shape()
            .props
            .iter()
            .filter(|p| self.is_discriminant_property(target, p.name))
            .collect();
        if telling.is_empty() {
            return None;
        }
        // `discriminateTypeByDiscriminableItems`
        let types = self.parts(target);
        let mut include: SmallVec<[Ternary; 16]> = types
            .iter()
            .map(|&t| Ternary::of(!self.has_primitive_flag(t) && !self.reduced(t).is_never()))
            .collect();
        for prop in telling {
            let actual = self.type_of_prop(prop, sm.mapper);
            // Non-matching members are removed only if some member matches: a discriminant that
            // matches nothing excludes nothing.
            let mut matched = false;
            for (i, &t) in types.iter().enumerate() {
                if !include[i].holds() {
                    continue;
                }
                let Some(expected) = self.property_or_index_signature_type(t, prop.name) else {
                    continue;
                };
                if self
                    .parts(actual)
                    .iter()
                    .any(|&s| self.is_related_to(r, s, expected, REC_BOTH).holds())
                {
                    matched = true;
                } else {
                    include[i] = Ternary::MAYBE;
                }
            }
            for slot in &mut include {
                if *slot == Ternary::MAYBE {
                    *slot = Ternary::of(!matched);
                }
            }
        }
        if !include.contains(&Ternary::FALSE) {
            return None;
        }
        let kept: SmallVec<[TypeId; 8]> = types
            .iter()
            .zip(&include)
            .filter(|(_, i)| **i == Ternary::TRUE)
            .map(|(&t, _)| t)
            .collect();
        let filtered = self.union(&kept);
        (!filtered.is_never()).then_some(filtered)
    }

    /// `getTypeOfPropertyOrIndexSignatureOfType`
    fn property_or_index_signature_type(&mut self, t: TypeId, name: Atom) -> Option<TypeId> {
        let apparent = self.apparent_type(t);
        let members = self.members(apparent)?;
        if let Some((prop, mapper)) = self.property_in(&members, name) {
            return Some(self.type_of_prop_with_missing(prop, mapper));
        }
        // The property may not exist.
        let value = self
            .applicable_index_info_for_name(&members, name)
            .map(|info| info.value)?;
        Some(self.optional_property(value))
    }

    // ───────────────────────────── unions and intersections ─────────────────────────────

    /// `unionOrIntersectionRelatedTo`. The order matters: unions before intersections, "each"
    /// before "some". `sd`, `td`: the `TypeData` of `source` and `target`.
    fn union_or_intersection_related_to_as<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        sd: &'p TypeData,
        target: TypeId,
        td: &'p TypeData,
        state: u8,
    ) -> Ternary {
        let target_is_union = matches!(td, TypeData::Union(_));
        if matches!(sd, TypeData::Union(_)) {
            // `A & B` is related to `A`: the source was distributed from an intersection that contains the target.
            if target_is_union
                && let UnionOrigin::Intersection(origin) = self.origin(source)
                && self.stored_alias(target).is_some()
                && origin.contains(&target)
            {
                return Ternary::TRUE;
            }
            // `A` is related to `A | B`: the list of unions the target was built from is often much
            // shorter than its resolved member list.
            if target_is_union
                && let UnionOrigin::Union(origin) = self.origin(target)
                && self.stored_alias(source).is_some()
                && origin.contains(&source)
            {
                return Ternary::TRUE;
            }
            // `TypeFlagsPrimitive`: `boolean` and an enum have it, some of the members of an enum have not.
            if REPORT && !self.is_boolean(source) && self.union_enum_symbol(source).is_none() {
                return if r.relation == Relation::Comparable {
                    self.some_type_related_to_type::<true>(r, source, target, state)
                } else {
                    self.each_type_related_to_type::<true>(r, source, target, state)
                };
            }
            return if r.relation == Relation::Comparable {
                self.some_type_related_to_type::<false>(r, source, target, state)
            } else {
                self.each_type_related_to_type::<false>(r, source, target, state)
            };
        }
        if target_is_union {
            // `getRegularTypeOfObjectLiteral`: the regular type is no longer fresh but is still an
            // object literal type, which is what allows a subtype to omit optional properties, and
            // still a JSX attributes type, where a name with a hyphen is always known. Nothing in
            // it is widened: alternatives do not get each other's properties.
            let state = if is_object_literal_kind(sd) {
                state | STATE_REGULAR
            } else {
                state
            };
            if REPORT && !self.has_primitive_flag(source) && !self.has_primitive_flag(target) {
                return self.type_related_to_some_type::<true>(r, source, target, state);
            }
            return self.type_related_to_some_type::<false>(r, source, target, state);
        }
        if matches!(td, TypeData::Intersection(_)) {
            return self.type_related_to_each_type::<REPORT>(r, source, target, STATE_TARGET);
        }
        // The source is an intersection. `T & 1` with `T extends 1 | 2` must not be comparable to
        // `2`.
        let mut source = source;
        if r.relation == Relation::Comparable && self.has_primitive_flag_as(target, td) {
            let types = self.parts_of_intersection(source);
            let constraints: SmallVec<[TypeId; 8]> = types
                .iter()
                .map(|&t| {
                    if self.is_instantiable(t) {
                        self.base_constraint_of(t).unwrap_or(TypeId::UNKNOWN)
                    } else {
                        t
                    }
                })
                .collect();
            if constraints[..] != types[..] {
                source = self.intersection(&constraints);
                if source.is_never() {
                    return Ternary::FALSE;
                }
                if !self.is_intersection(source) {
                    let result = self.is_related_to(r, source, target, REC_SOURCE);
                    if result.holds() {
                        return result;
                    }
                    return self.is_related_to(r, target, source, REC_SOURCE);
                }
            }
        }
        // Not reported: whether some member of it is related gives no useful elaboration.
        self.some_type_related_to_type::<false>(r, source, target, STATE_SOURCE)
    }

    fn parts_of_intersection(&self, t: TypeId) -> &'p [TypeId] {
        match self.data(t) {
            TypeData::Intersection(parts) => parts,
            _ => self.parts(t),
        }
    }

    pub(super) fn constituents(&self, t: TypeId) -> &'p [TypeId] {
        match self.data(t) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => parts,
            _ => &[],
        }
    }

    /// `constituents`, and whether `t` is a union.
    #[inline]
    fn constituents_and_is_union(&self, t: TypeId) -> (&'p [TypeId], bool) {
        match self.data(t) {
            TypeData::Union(parts) => (parts, true),
            TypeData::Intersection(parts) => (parts, false),
            _ => (&[], false),
        }
    }

    /// `someTypeRelatedToType`: the failure of the last member is reported.
    fn some_type_related_to_type<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        state: u8,
    ) -> Ternary {
        let (types, is_union) = self.constituents_and_is_union(source);
        if is_union && self.contains_type(types, target) {
            return Ternary::TRUE;
        }
        for (i, &t) in types.iter().enumerate() {
            let related = if REPORT && i + 1 == types.len() {
                self.is_related_to_ex::<true>(r, t, target, REC_SOURCE, state)
            } else {
                self.is_related_to_ex::<false>(r, t, target, REC_SOURCE, state)
            };
            if related.holds() {
                return related;
            }
        }
        Ternary::FALSE
    }

    /// `eachTypeRelatedToType`: the failure of the first unrelated member is reported.
    fn each_type_related_to_type<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        state: u8,
    ) -> Ternary {
        let mut result = Ternary::TRUE;
        let sources = self.constituents(source);
        let targets: &[TypeId] = match self.data(target) {
            TypeData::Union(parts) => parts,
            _ => &[],
        };
        // `getUndefinedStrippedTargetIfNeeded`: `undefined`, which optionality adds, would break
        // the positional correspondence. Its position in a union: the constituents are in the order
        // of `CompareTypes`, which starts with the flags.
        let undefined_in = |types: &[TypeId]| {
            let is_before = |t: &&TypeId| self.flags(**t) < tf::UNDEFINED;
            let from = types.iter().take_while(is_before).count();
            from..from
                + types[from..]
                    .iter()
                    .take_while(|t| t.is_undefined())
                    .count()
        };
        let skipped = if undefined_in(sources).is_empty() {
            undefined_in(targets)
        } else {
            0..0
        };
        let count = targets.len() - skipped.len();
        let corresponds =
            count > 1 && sources.len() >= count && sources.len().is_multiple_of(count);
        for (i, &t) in sources.iter().enumerate() {
            // Many unions are mappings of one another: the members at the same index are related.
            if corresponds {
                let at = i % count;
                let at = if at < skipped.start {
                    at
                } else {
                    at + skipped.len()
                };
                let related = self.is_related_to_ex::<false>(r, t, targets[at], REC_BOTH, state);
                if related.holds() {
                    result &= related;
                    continue;
                }
            }
            let related = self.is_related_to_ex::<REPORT>(r, t, target, REC_SOURCE, state);
            if !related.holds() {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    /// `getMatchingUnionConstituentForType`
    pub(super) fn matching_union_constituent_for_type(
        &mut self,
        union: TypeId,
        ty: TypeId,
    ) -> Option<TypeId> {
        let (name, constituents) = self.key_property(union)?;
        let key = self.type_of_property(ty, *name)?;
        // `getConstituentTypeForKeyType`
        let found = constituents.get(&self.regular(key)).copied();
        found.filter(|&member| member != TypeId::UNKNOWN)
    }

    /// `typeRelatedToSomeType`
    fn type_related_to_some_type<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        state: u8,
    ) -> Ternary {
        let (types, is_union) = self.constituents_and_is_union(target);
        if is_union {
            if self.contains_type(types, source) {
                return Ternary::TRUE;
            }
            // A literal is related to a union of primitives only if the union contains it, in its
            // fresh or its regular form, or contains its primitive type.
            let sd = self.data(source);
            let is_such_a_literal = match sd {
                TypeData::StringLit { .. }
                | TypeData::BoolLit { .. }
                | TypeData::BigIntLit { .. } => true,
                TypeData::NumberLit { .. } => r.relation.is_subtype(),
                _ => false,
            };
            if r.relation != Relation::Comparable
                && is_such_a_literal
                && types.iter().all(|&t| is_primitive_kind(self.data(t)))
            {
                let alternate = self.with_freshness(source, !is_fresh_literal_kind(sd));
                let primitive = match sd {
                    TypeData::StringLit { .. } => Some(TypeId::STRING),
                    TypeData::NumberLit { .. } => Some(TypeId::NUMBER),
                    TypeData::BigIntLit { .. } => Some(TypeId::BIGINT),
                    _ => None,
                };
                // Pattern literal types are primitives too, and need a full comparison.
                if !types.iter().any(|&t| {
                    matches!(
                        self.data(t),
                        TypeData::Template { .. } | TypeData::StringMapping { .. }
                    )
                }) {
                    return Ternary::of(
                        primitive.is_some_and(|p| self.contains_type(types, p))
                            || self.contains_type(types, alternate),
                    );
                }
            }
            if let Some(matching) = self.matching_union_constituent_for_type(target, source) {
                let related =
                    self.is_related_to_ex::<false>(r, source, matching, REC_TARGET, state);
                if related.holds() {
                    return related;
                }
            }
        }
        for &t in types {
            let related = self.is_related_to_ex::<false>(r, source, t, REC_TARGET, state);
            if related.holds() {
                return related;
            }
        }
        // Elaborates only against the best matching member.
        if REPORT && let Some(best) = self.best_matching_type(source, target) {
            self.is_related_to_ex::<true>(r, source, best, REC_TARGET, state);
        }
        Ternary::FALSE
    }

    /// `typeRelatedToEachType`
    fn type_related_to_each_type<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        state: u8,
    ) -> Ternary {
        let mut result = Ternary::TRUE;
        for &t in self.constituents(target) {
            let related = self.is_related_to_ex::<REPORT>(r, source, t, REC_TARGET, state);
            if !related.holds() {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    /// `eachTypeRelatedToSomeType`
    fn each_type_related_to_some_type(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
    ) -> Ternary {
        let mut result = Ternary::TRUE;
        for &t in self.constituents(source) {
            let related = self.type_related_to_some_type::<false>(r, t, target, STATE_NONE);
            if !related.holds() {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    // ───────────────────────────── recursive types ─────────────────────────────

    /// `isTypeReferenceWithGenericArguments`. A tuple is a reference to its tuple target. A marker does not count as a type
    /// parameter: the reliability flags cached with a comparison depend on its markers, so it must not share a key with a
    /// comparison that has type parameters in their place.
    #[inline]
    fn is_type_reference_with_generic_arguments(&self, t: TypeId) -> bool {
        self.has_type_variables(t) && self.has_generic_arguments(t)
    }

    fn has_generic_arguments(&self, t: TypeId) -> bool {
        // `isNonDeferredTypeReference`
        let (TypeData::Ref {
            args: TypeArguments::Given(args),
            ..
        }
        | TypeData::Tuple {
            elems: TypeArguments::Given(args),
            ..
        }) = self.data(t)
        else {
            return false;
        };
        args.iter().any(|&arg| {
            matches!(
                self.data(arg),
                TypeData::TypeParam(..) | TypeData::ThisParam(_)
            ) || self.is_type_reference_with_generic_arguments(arg)
        })
    }

    /// `getTupleKey`: the element flags, the labels and `readonly` identify a tuple target. A label
    /// is hashed by its text: the id of an atom of a HIR depends on which parser thread came first.
    fn write_tuple_target(&self, hasher: &mut FxHasher, flags: &[ElemFlags], readonly: bool) {
        hasher.write_u8(if readonly { b'!' } else { b't' });
        hasher.write_usize(flags.len());
        for flag in flags {
            hasher.write_u32(flag.with_label(Atom::NONE).bits());
            let label = flag.label();
            if !label.is_none() {
                hasher.write(self.atoms().bytes(label));
            }
        }
    }

    /// The `writeTypeReference` closure of `writeGenericTypeReferences`.
    fn write_type_reference(
        &mut self,
        key: &mut GenericKeyBuilder,
        reference: TypeId,
        depth: u32,
        ignore_constraints: bool,
    ) {
        match self.data(reference) {
            TypeData::Ref { target, .. } => {
                key.hasher.write_u8(b'r');
                key.hasher.write_u32(target.file.0);
                key.hasher.write_u32(target.id.0);
            }
            TypeData::Tuple {
                flags, readonly, ..
            } => self.write_tuple_target(&mut key.hasher, flags, *readonly),
            _ => return,
        }
        for &arg in self.type_arguments(reference) {
            let is_this = matches!(self.data(arg), TypeData::ThisParam(_));
            if is_this || matches!(self.data(arg), TypeData::TypeParam(..)) {
                // The constraint of a `this` type is the class or interface it belongs to.
                let is_unconstrained = ignore_constraints
                    || !is_this && {
                        // The constraint is resolved only to build the key, so a cycle through here is not an error.
                        self.eager.push(self.stack.len());
                        let constraint = self.constraint_of_type_param(arg);
                        self.eager.pop();
                        constraint.is_none()
                    };
                if !is_unconstrained {
                    key.constrained = true;
                } else if let Some(index) = key.type_param_index(arg) {
                    key.hasher.write_u8(b'=');
                    key.hasher.write_usize(index);
                    continue;
                }
            } else if depth < 4 && self.is_type_reference_with_generic_arguments(arg) {
                key.hasher.write_u8(b'<');
                self.write_type_reference(key, arg, depth + 1, ignore_constraints);
                key.hasher.write_u8(b'>');
                continue;
            }
            key.hasher.write_u8(b'-');
            key.hasher.write_u32(arg.0);
            key.has_own_id |= arg.is_local();
        }
    }

    /// `getRelationKey`. The second value is `constrained`: a constrained type parameter was written by id.
    #[inline]
    pub(super) fn relation_key(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        state: u8,
        ignore_constraints: bool,
    ) -> (Key, bool) {
        let flags = relation as u8 | state << 4;
        // tsgo orders the pair by id. The order decides how `generic_relation_key` numbers the type parameters.
        let is_swapped =
            relation == Relation::Identity && self.creation_order(source, target).is_gt();
        let (source, target) = if is_swapped {
            (target, source)
        } else {
            (source, target)
        };
        if !self.is_type_reference_with_generic_arguments(source)
            || !self.is_type_reference_with_generic_arguments(target)
        {
            return (Key(source, target, flags), false);
        }
        self.generic_relation_key(source, target, flags, ignore_constraints)
    }

    /// `relation_key` that does not ignore constraints. `sd`, `td`: the `TypeData` of `source` and
    /// `target`.
    #[inline]
    fn relation_key_as(
        &mut self,
        source: TypeId,
        sd: &TypeData,
        target: TypeId,
        td: &TypeData,
        relation: Relation,
        state: u8,
    ) -> (Key, bool) {
        // Nothing else has type arguments.
        let is_reference =
            |data: &TypeData| matches!(data, TypeData::Ref { .. } | TypeData::Tuple { .. });
        if is_reference(sd) && is_reference(td) {
            return self.relation_key(source, target, relation, state, false);
        }
        let flags = relation as u8 | state << 4;
        if relation == Relation::Identity && self.creation_order(source, target).is_gt() {
            (Key(target, source, flags), false)
        } else {
            (Key(source, target, flags), false)
        }
    }

    /// `writeGenericTypeReferences`. `flags`: those of the key.
    fn generic_relation_key(
        &mut self,
        source: TypeId,
        target: TypeId,
        flags: u8,
        ignore_constraints: bool,
    ) -> (Key, bool) {
        let cycles_before = self.cycles;
        let mut key = GenericKeyBuilder {
            hasher: FxHasher::default(),
            type_params: [TypeId::NEVER; 8],
            type_param_count: 0,
            constrained: false,
            has_own_id: false,
        };
        self.write_type_reference(&mut key, source, 0, ignore_constraints);
        key.hasher.write_u8(b',');
        self.write_type_reference(&mut key, target, 0, ignore_constraints);
        // A constraint that could not be resolved does not tell whether its type parameter is constrained.
        if self.cycles != cycles_before {
            return (Key(source, target, flags), false);
        }
        let hash = key.hasher.finish();
        // In a hash the bit `LOCAL` is noise. Symbols, indices and published ids are the same for every task, now and later.
        let local = match key.has_own_id {
            true => crate::local::LOCAL,
            false => 0,
        };
        (
            Key(
                TypeId(hash as u32 & !crate::local::LOCAL | local),
                TypeId((hash >> 32) as u32 & !crate::local::LOCAL),
                flags | GENERIC_KEY,
            ),
            key.constrained,
        )
    }

    /// `recursiveTypeRelatedTo`: the cached result if there is one; `Maybe` if the comparison is in
    /// progress or if both types expand infinitely; otherwise a structural comparison. `sd`, `td`:
    /// the `TypeData` of `source` and `target`.
    #[allow(clippy::too_many_arguments)]
    fn recursive_type_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        sd: &'p TypeData,
        target: TypeId,
        td: &'p TypeData,
        state: u8,
        recursion: u8,
    ) -> Ternary {
        if r.overflow {
            return Ternary::FALSE;
        }
        // `related` has already done the cache lookup.
        let missed = r
            .top_key
            .take()
            .filter(|_| state == STATE_NONE && source == r.top_source && target == r.top_target);
        let (key, constrained) = match missed {
            Some(key) => key,
            None => self.relation_key_as(source, sd, target, td, r.relation, state),
        };
        if missed.is_none()
            && let Some(entry) = self.p.relations.get(&mut self.task, &key)
            // A cached failure is recomputed to produce its error elaboration.
            && !(REPORT && entry & FAILED != 0 && entry & OVERFLOW == 0)
        {
            self.reliability |= entry & (REPORTS_UNMEASURABLE | REPORTS_UNRELIABLE);
            if REPORT && entry & OVERFLOW != 0 {
                let code = if entry & COMPLEXITY_OVERFLOW != 0 {
                    2859
                } else {
                    2321
                };
                self.report_error(r, code, &[Arg::Type(source), Arg::Type(target)]);
            }
            if entry & COMPLEXITY_OVERFLOW != 0 {
                // The comparison was aborted when it ran.
                r.hit_cached_overflow = true;
            }
            return Ternary::of(entry & SUCCEEDED != 0);
        }
        if !REPORT && r.caches_failures && r.failed.contains(&key) {
            return Ternary::FALSE;
        }
        if r.relation_count <= 0 {
            r.overflow = true;
            return Ternary::FALSE;
        }
        // The key is inserted into the set here, and removed on every path that does not start the
        // comparison after all.
        if !r.maybe_keys_set.insert(key) {
            return Ternary::MAYBE;
        }
        // `broadestEquivalentId`: the key the comparison would have if no type parameter had a constraint.
        if constrained {
            let (broadest, _) = self.relation_key(source, target, r.relation, state, true);
            if broadest != key && r.maybe_keys_set.contains(&broadest) {
                r.maybe_keys_set.remove(&key);
                return Ternary::MAYBE;
            }
        }
        let is_too_deep = r.source_stack.len() == 100 || r.target_stack.len() == 100;
        if is_too_deep || self.is_stack_low() {
            if is_too_deep {
                self.relations_too_deep.push((r.top_source, r.top_target));
                r.is_too_deep = true;
            }
            r.maybe_keys_set.remove(&key);
            r.overflow = true;
            return Ternary::FALSE;
        }
        let maybe_start = r.maybe_keys.len();
        let scope = self.begin_scope();
        r.maybe_keys.push(key);
        let save_expanding = r.expanding;
        if recursion & REC_SOURCE != 0 {
            r.source_stack.push(source);
            if r.expanding & REC_SOURCE == 0
                && r.source_stack.len() >= 3
                && self.is_last_deeply_nested(&r.source_stack, &mut r.source_identities, 3)
            {
                r.expanding |= REC_SOURCE;
            }
        }
        if recursion & REC_TARGET != 0 {
            r.target_stack.push(target);
            if r.expanding & REC_TARGET == 0
                && r.target_stack.len() >= 3
                && self.is_last_deeply_nested(&r.target_stack, &mut r.target_identities, 3)
            {
                r.expanding |= REC_TARGET;
            }
        }
        let save_reliability = std::mem::replace(&mut self.reliability, 0);
        let result = if r.expanding == REC_BOTH {
            Ternary::MAYBE
        } else {
            self.structured_type_related_to::<REPORT>(r, source, sd, target, td, state)
        };
        // With reporting the result can differ (`relate_variances`), so it is not cached.
        let stored = self.end_scope(scope).ok().filter(|_| !REPORT);
        let propagating = self.reliability;
        self.reliability |= save_reliability;
        if recursion & REC_SOURCE != 0 {
            r.source_stack.pop();
        }
        if recursion & REC_TARGET != 0 {
            r.target_stack.pop();
        }
        r.expanding = save_expanding;
        if result.holds() {
            if result == Ternary::TRUE || r.source_stack.is_empty() && r.target_stack.is_empty() {
                // Results that were true under assumptions are definite now that no assumption is
                // left. Unknown results stay unknown.
                self.reset_maybe_stack(
                    r,
                    maybe_start,
                    propagating,
                    result == Ternary::TRUE || result == Ternary::MAYBE,
                    stored,
                );
            }
        } else {
            // A result that is false under assumptions is false without them. A failure caused by
            // an aborted comparison is not cached.
            let is_cut_short = r.overflow || r.hit_cached_overflow;
            if r.caches_failures {
                if !is_cut_short {
                    r.failed.insert(key);
                }
            } else if let Some(stored) = stored
                && !is_cut_short
            {
                self.insert_relation(key, FAILED | propagating, stored);
            }
            r.relation_count -= 1;
            self.reset_maybe_stack(r, maybe_start, propagating, false, stored);
        }
        result
    }

    #[inline]
    fn insert_relation(&mut self, key: Key, entry: u8, stored: Stored) {
        self.generic_relation_entries_not_published += u64::from(key.is_hash_of_own_ids());
        self.p.relations.insert(&mut self.task, key, entry, stored);
    }

    /// `resetMaybeStack`
    fn reset_maybe_stack(
        &mut self,
        r: &mut Relater,
        maybe_start: usize,
        propagating: u8,
        mark_all_as_succeeded: bool,
        stored: Option<Stored>,
    ) {
        while r.maybe_keys.len() > maybe_start {
            let Some(key) = r.maybe_keys.pop() else {
                break;
            };
            r.maybe_keys_set.remove(&key);
            if mark_all_as_succeeded {
                if let Some(stored) = stored {
                    self.insert_relation(key, SUCCEEDED | propagating, stored);
                }
                r.relation_count -= 1;
            }
        }
    }

    /// `isDeeplyNestedType`: `stack` contains `max_depth` instantiations of the declaration that
    /// `t` is an instantiation of, each created later than the previous one. A homomorphic mapped
    /// type is as deeply nested as the type it is applied to.
    pub(super) fn is_deeply_nested_type(
        &mut self,
        t: TypeId,
        stack: &[TypeId],
        max_depth: usize,
    ) -> bool {
        if stack.len() < max_depth {
            return false;
        }
        let (t, data) = self.mapped_target_with_symbol(t);
        if let TypeData::Intersection(parts) = data
            && parts
                .iter()
                .any(|&p| self.is_deeply_nested_type(p, stack, max_depth))
        {
            return true;
        }
        let identity = self.recursion_identity_as(t, data);
        let mut count = 0;
        let mut last = None;
        for &on_stack in stack {
            if self.has_matching_recursion_identity(on_stack, identity) {
                // `t.id >= lastTypeId`
                if last.is_none_or(|last| self.creation_order(on_stack, last).is_ge()) {
                    count += 1;
                    if count >= max_depth {
                        return true;
                    }
                }
                last = Some(on_stack);
            }
        }
        false
    }

    /// `is_deeply_nested_type` of the last entry of `stack`. `identities`: for a prefix of the
    /// stack as of the previous call, the type and its `plain_recursion_identity`.
    fn is_last_deeply_nested(
        &mut self,
        stack: &[TypeId],
        identities: &mut Vec<(TypeId, RecursionId)>,
        max_depth: usize,
    ) -> bool {
        if stack.len() < max_depth {
            return false;
        }
        for (i, &on_stack) in stack.iter().enumerate() {
            if identities.get(i).is_none_or(|known| known.0 != on_stack) {
                identities.truncate(i);
                identities.push((on_stack, self.plain_recursion_identity(on_stack)));
            }
        }
        let identities = &identities[..stack.len()];
        let Some(&(t, kept)) = identities.last() else {
            return false;
        };
        if kept == NOT_PLAIN {
            return self.is_deeply_nested_type(t, stack, max_depth);
        }
        let identity = self.recursion_identity_by_now(t, kept);
        let mut count = 0;
        let mut last = None;
        for &(on_stack, kept) in identities {
            let matches = if kept == NOT_PLAIN {
                self.has_matching_recursion_identity(on_stack, identity)
            } else {
                (kept == identity || identity == (0, on_stack.0, 0))
                    && self.recursion_identity_by_now(on_stack, kept) == identity
            };
            if matches {
                // `t.id >= lastTypeId`
                if last.is_none_or(|last| self.creation_order(on_stack, last).is_ge()) {
                    count += 1;
                    if count >= max_depth {
                        return true;
                    }
                }
                last = Some(on_stack);
            }
        }
        false
    }

    /// `recursion_identity`. `NOT_PLAIN` for a mapped type, which uses the type it is applied to,
    /// and for an intersection, which uses its members.
    fn plain_recursion_identity(&self, t: TypeId) -> RecursionId {
        let data = self.data(t);
        if is_mapped_kind(data) || matches!(data, TypeData::Intersection(_)) {
            NOT_PLAIN
        } else {
            self.recursion_identity_as(t, data)
        }
    }

    /// `recursion_identity` of `t`, given the identity `kept` computed earlier. `mark_from_type_node` may have run since then, and a
    /// reference or tuple with the flag is its own identity.
    #[inline]
    fn recursion_identity_by_now(&self, t: TypeId, kept: RecursionId) -> RecursionId {
        if matches!(kept.0, 1 | 5) && self.types().is_from_type_node(t) {
            (0, t.0, 0)
        } else {
            kept
        }
    }

    /// `getMappedTargetWithSymbol`: the type a homomorphic mapped type is applied to, through any
    /// number of nested ones, provided that type has a symbol. `Id<{ x: .. }>` is then
    /// distinguished by the type literal it is applied to. Returned with its `TypeData`.
    #[inline]
    fn mapped_target_with_symbol(&mut self, t: TypeId) -> (TypeId, &'p TypeData) {
        let data = self.data(t);
        if is_mapped_kind(data) {
            let t = self.target_with_symbol_of_mapped(t);
            (t, self.data(t))
        } else {
            (t, data)
        }
    }

    fn target_with_symbol_of_mapped(&mut self, of: TypeId) -> TypeId {
        if let Some(known) = self.p.mapped_targets.get(&mut self.task, &of) {
            return known;
        }
        let scope = self.begin_scope();
        let mut t = of;
        let has_symbol = |c: &Self, ty: TypeId| {
            matches!(
                c.data(ty),
                TypeData::Ref { .. }
                    | TypeData::Anon { .. }
                    | TypeData::Fns { .. }
                    | TypeData::TypeParam(..)
                    | TypeData::ThisParam(_)
            ) || matches!(
                c.data(ty),
                // The symbol of an object literal.
                TypeData::Synth(shape) if shape.symbol_declared_at.is_some()
                    || matches!(
                        shape.literal,
                        Literalness::Literal
                            | Literalness::WithSpread
                            | Literalness::JsxAttributes
                            | Literalness::Partial
                    )
            )
        };
        // Circular aliases are reported elsewhere. Here the loop must terminate.
        for _ in 0..64 {
            let Some((_, _, mapper)) = self.mapped_origin(t) else {
                break;
            };
            // `ObjectFlagsInstantiatedMapped`: not the declared mapped type.
            if self.types().mapping(mapper).iter().all(|p| p.0 == p.1) {
                break;
            }
            let Some(target) = self.mapped_modifiers_type(t) else {
                break;
            };
            let found = match self.data(target) {
                TypeData::Intersection(parts) => parts.iter().any(|&p| has_symbol(self, p)),
                _ => has_symbol(self, target),
            };
            if !found || target == t {
                break;
            }
            t = target;
        }
        match self.end_scope_by_counters(scope) {
            Ok(stored) => (self.p.mapped_targets).insert(&mut self.task, of, t, stored),
            Err(_) => t,
        }
    }

    /// `hasMatchingRecursionIdentity`
    fn has_matching_recursion_identity(&mut self, t: TypeId, identity: RecursionId) -> bool {
        let (t, data) = self.mapped_target_with_symbol(t);
        match data {
            TypeData::Intersection(parts) => parts
                .iter()
                .any(|&p| self.has_matching_recursion_identity(p, identity)),
            // Fast path: the identity of a reference is either the type itself or its target symbol.
            TypeData::Ref { target, .. }
                if identity != (0, t.0, 0) && identity != (1, target.file.0, target.id.0) =>
            {
                false
            }
            data => self.recursion_identity_as(t, data) == identity,
        }
    }

    /// The type of an array literal that contains object literals, unwidened or widened. Here the
    /// members of an object literal are resolved lazily, in tsgo eagerly, where
    /// `isDeeplyNestedType` therefore never treats the inner array type as newer than the enclosing
    /// one. `data`: the `TypeData` of `t`.
    fn holds_object_literals(&self, t: TypeId, data: &TypeData) -> bool {
        let inside: &[TypeId] = match data {
            // A type declared by a type node is not the type of an array literal.
            TypeData::Tuple {
                elems: TypeArguments::Given(elems),
                ..
            } => elems,
            TypeData::Ref {
                args: TypeArguments::Given(args),
                ..
            } if !args.is_empty() && self.is_array(t) => args,
            _ => return false,
        };
        inside.iter().any(|&e| {
            self.some_type(e, |c, m| match c.data(m) {
                TypeData::Anon {
                    origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..),
                    ..
                } => true,
                TypeData::Synth(shape) => shape.literal.is_of_expression(),
                _ => false,
            })
        })
    }

    /// `getRecursionIdentity`
    pub(super) fn recursion_identity(&self, t: TypeId) -> RecursionId {
        self.recursion_identity_as(t, self.data(t))
    }

    /// `data`: the `TypeData` of `t`.
    fn recursion_identity_as(&self, t: TypeId, data: &TypeData) -> RecursionId {
        match data {
            // `ObjectFlagsFromTypeNode`, `isObjectOrArrayLiteralType`
            TypeData::Ref { .. } | TypeData::Tuple { .. }
                if self.types().is_from_type_node(t) || self.holds_object_literals(t, data) =>
            {
                (0, t.0, 0)
            }
            TypeData::Ref { target, .. } => (1, target.file.0, target.id.0),
            TypeData::Anon {
                origin: Origin::TypeLiteral(file, node) | Origin::Mapped(file, node),
                ..
            } => (2, file.0, node.0),
            // `getWidenedTypeOfObjectLiteral` creates an anonymous object type with the symbol of the literal.
            TypeData::Anon {
                origin: Origin::WidenedLiteral(file, e, ..),
                ..
            } => (6, file.0, e.0),
            TypeData::Anon {
                origin: Origin::Function(sym) | Origin::EnumObject(sym) | Origin::Module(sym),
                ..
            } => (3, sym.file.0, sym.id.0),
            TypeData::Fns { decls, .. } => (4, decls[0].0.0, decls[0].1.0),
            TypeData::Tuple {
                flags, readonly, ..
            } => {
                let mut hasher = FxHasher::default();
                self.write_tuple_target(&mut hasher, flags, *readonly);
                (5, flags.len() as u32, hasher.finish() as u32)
            }
            TypeData::Cond { file, node, .. } => (2, file.0, node.0),
            TypeData::IndexedAccess { obj, .. } => {
                // The leftmost object type: `A` in `A[P1][P2][P3]`.
                let mut of = *obj;
                while let TypeData::IndexedAccess { obj, .. } = self.data(of) {
                    of = *obj;
                }
                (0, of.0, 0)
            }
            _ => (0, t.0, 0),
        }
    }

    /// `structuredTypeRelatedTo`. `sd`, `td`: the `TypeData` of `source` and `target`.
    fn structured_type_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        sd: &'p TypeData,
        target: TypeId,
        td: &'p TypeData,
        state: u8,
    ) -> Ternary {
        let saved = REPORT.then(|| r.get_error_state());
        let mut result =
            self.structured_type_related_to_worker::<REPORT>(r, source, sd, target, td, state);
        if r.relation == Relation::Identity {
            return result;
        }
        let source_is_intersection = matches!(sd, TypeData::Intersection(_));
        let target_is_union = matches!(td, TypeData::Union(_));
        // The constraint of an intersection is the intersection of the constraints of its
        // constituents, and may resolve to a type that none of them resolves to: `T & U`, each
        // extending `string | number`; `V & number`.
        if !result.holds() && (source_is_intersection || is_type_param_kind(sd) && target_is_union)
        {
            let one = [source];
            let types: &[TypeId] = match sd {
                TypeData::Intersection(parts) => parts,
                _ => &one,
            };
            if let Some(constraint) =
                self.effective_constraint_of_intersection(types, target_is_union)
                && self.every_type(constraint, |_, c| c != source)
            {
                result = self.is_related_to_ex::<false>(r, constraint, target, REC_SOURCE, state);
            }
        }
        if result.holds()
            && state & STATE_TARGET == 0
            && matches!(td, TypeData::Intersection(_))
            && !self.is_generic_object_type(target)
            && (is_object_kind(sd) || source_is_intersection)
        {
            // A constituent-by-constituent comparison does not detect excess or missing properties
            // in nested types. The properties of a literal that is no longer fresh are not fresh
            // either (`getRegularTypeOfObjectLiteral`).
            result &= self.properties_of_apparent_type_related_to::<REPORT>(
                r,
                source,
                target,
                false,
                state & STATE_REGULAR,
            );
            if result.holds()
                && state & STATE_REGULAR == 0
                && self.is_fresh_object_literal_type(source)
            {
                result &= self
                    .index_signatures_related_to::<REPORT>(r, source, target, false, STATE_NONE);
            }
        } else if result.holds()
            && is_object_kind(td)
            && !(is_mapped_kind(td) && self.is_generic(target))
            && source_is_intersection
            && !self.is_array_or_tuple(target)
            && self.is_source_intersection_needing_extra_check(source, target)
        {
            // `T & { a: boolean }` is related to `{ a?: string }` through its first constituent.
            result &= self
                .properties_of_apparent_type_related_to::<REPORT>(r, source, target, true, state);
        }
        if let Some(saved) = &saved
            && result.holds()
        {
            r.restore_error_state(saved);
        }
        result
    }

    /// `propertiesRelatedTo`, as `structuredTypeRelatedTo` calls it. `getPropertyOfType` reads the apparent type, which is a union for
    /// an intersection with a member whose constraint is a union.
    pub(super) fn properties_of_apparent_type_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        optionals_only: bool,
        state: u8,
    ) -> Ternary {
        if !self.is_intersection(source) {
            return self.properties_related_to::<REPORT>(
                r,
                source,
                target,
                &[],
                optionals_only,
                state,
            );
        }
        let apparent = self.apparent_type(source);
        // `createUnionOrIntersectionProperty` reads the apparent type of each member.
        let mut members: SmallVec<[TypeId; 8]> = self
            .parts(apparent)
            .iter()
            .map(|&member| self.apparent_type(member))
            .collect();
        // `!c.isErrorType(t) && t.flags&TypeFlagsNever == 0`
        members.retain(|member| !self.is_error_type(*member) && !member.is_never());
        if members.len() < 2 {
            let apparent = members.first().copied().unwrap_or(source);
            // `getPropertyOfType` finds nothing in a type that is not an object type: `any`, which
            // `T & U` resolves to where `U` extends `any`.
            if self.members(apparent).is_none() {
                let none = self.synth(Shape::default());
                return self.properties_related_to_noting::<REPORT>(
                    r,
                    source,
                    Some(none),
                    target,
                    &[],
                    optionals_only,
                    state,
                    &mut None,
                );
            }
            return self.properties_related_to::<REPORT>(
                r,
                apparent,
                target,
                &[],
                optionals_only,
                state,
            );
        }
        // `getPropertiesOfUnionOrIntersectionType`: "The properties of a union type are those that are present in all constituent
        // types, so we only need to check the properties of the first type without index signature".
        let mut props: Vec<Prop> = Vec::new();
        for &current in &members {
            let Some(of_current) = self.members(current) else {
                continue;
            };
            for prop in &of_current.shape().props {
                if props.iter().all(|it| it.name != prop.name)
                    && let Some((combined, mapper)) = self.get_property_of_type(apparent, prop.name)
                {
                    let mut combined = combined.clone();
                    self.instantiate_prop(&mut combined, mapper);
                    props.push(combined);
                }
            }
            if of_current.shape().index.is_empty() {
                break;
            }
        }
        let properties = self.synth(Shape {
            props,
            ..Shape::default()
        });
        self.properties_related_to_noting::<REPORT>(
            r,
            source,
            Some(properties),
            target,
            &[],
            optionals_only,
            state,
            &mut None,
        )
    }

    /// `isSourceIntersectionNeedingExtraCheck`
    pub(super) fn is_source_intersection_needing_extra_check(
        &mut self,
        source: TypeId,
        target: TypeId,
    ) -> bool {
        if !self.is_intersection(source) {
            return false;
        }
        let apparent = self.apparent_type(source);
        // `Literalness::Partial` is `ObjectFlagsNonInferrableType`.
        (self.is_object_type(apparent) || self.is_union_or_intersection(apparent))
            && !self
                .constituents(source)
                .iter()
                .any(|&t| t == target || matches!(self.data(t), TypeData::Synth(shape) if shape.literal == Literalness::Partial))
    }

    /// The `relateVariances` closure of `structuredTypeRelatedToWorker`. `Some`: the final result.
    fn relate_variances<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        sources: &[TypeId],
        targets: &[TypeId],
        variances: &[u8],
        state: u8,
        shared: &mut WorkerState,
    ) -> Option<Ternary> {
        let result =
            self.type_arguments_related_to::<REPORT>(r, sources, targets, variances, state);
        if result.holds() {
            return Some(result);
        }
        // The comparison failed assuming that the type arguments fully determine the relation,
        // which may not be true.
        if variances
            .iter()
            .any(|v| v & ALLOWS_STRUCTURAL_FALLBACK != 0)
        {
            // The errors from the type arguments may be unhelpful: the type parameter was assumed
            // to be the same on both sides.
            if REPORT {
                shared.original_error_chain = None;
                r.restore_error_state(&shared.save_error_state);
            }
            return None;
        }
        // A `void` type argument in a covariant position accepts anything.
        let allow_structural_fallback = self.has_covariant_void_argument(targets, variances);
        shared.variance_check_failed = !allow_structural_fallback;
        if !variances.is_empty() && !allow_structural_fallback {
            // With an invariant type parameter the structural comparison shows why it is invariant.
            if !(REPORT && variances.iter().any(|v| v & VARIANCE_MASK == INVARIANT)) {
                return Some(Ternary::FALSE);
            }
            shared.original_error_chain = r.error_chain.clone();
            r.restore_error_state(&shared.save_error_state);
        }
        None
    }

    /// `structuredTypeRelatedToWorker`. `sd`, `td`: the `TypeData` of `source` and `target`.
    pub(super) fn structured_type_related_to_worker<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        sd: &'p TypeData,
        target: TypeId,
        td: &'p TypeData,
        state: u8,
    ) -> Ternary {
        let relation = r.relation;
        let mut shared = WorkerState::default();
        if REPORT {
            shared.save_error_state = r.get_error_state();
        }
        if relation == Relation::Identity {
            match (sd, td) {
                (TypeData::Union(_), _) | (TypeData::Intersection(_), _) => {
                    let mut result = self.each_type_related_to_some_type(r, source, target);
                    if result.holds() {
                        result &= self.each_type_related_to_some_type(r, target, source);
                    }
                    return result;
                }
                (TypeData::Keyof(s), TypeData::Keyof(t)) => {
                    return self.is_related_to(r, *s, *t, REC_BOTH);
                }
                (
                    TypeData::IndexedAccess {
                        obj: so, index: si, ..
                    },
                    TypeData::IndexedAccess {
                        obj: to, index: ti, ..
                    },
                ) => {
                    let mut result = self.is_related_to(r, *so, *to, REC_BOTH);
                    if result.holds() {
                        result &= self.is_related_to(r, *si, *ti, REC_BOTH);
                        if result.holds() {
                            return result;
                        }
                    }
                }
                (
                    TypeData::Substitution {
                        base: sb,
                        constraint: sc,
                    },
                    TypeData::Substitution {
                        base: tb,
                        constraint: tc,
                    },
                ) => {
                    let mut result = self.is_related_to(r, *sb, *tb, REC_BOTH);
                    if result.holds() {
                        result &= self.is_related_to(r, *sc, *tc, REC_BOTH);
                        if result.holds() {
                            return result;
                        }
                    }
                }
                (TypeData::Cond { .. }, TypeData::Cond { .. }) => {
                    if self.cond_distributes_over(source).is_some()
                        == self.cond_distributes_over(target).is_some()
                    {
                        let mut result = Ternary::TRUE;
                        for which in 0..4 {
                            let (s, t) = (
                                self.cond_piece(source, which),
                                self.cond_piece(target, which),
                            );
                            result &= self.is_related_to(r, s, t, REC_BOTH);
                            if !result.holds() {
                                break;
                            }
                        }
                        if result.holds() {
                            return result;
                        }
                    }
                }
                (
                    TypeData::Template {
                        texts: st,
                        types: sy,
                    },
                    TypeData::Template {
                        texts: tt,
                        types: ty,
                    },
                ) => {
                    if st == tt {
                        let mut result = Ternary::TRUE;
                        for (&s, &t) in sy.iter().zip(ty.iter()) {
                            result &= self.is_related_to(r, s, t, REC_BOTH);
                            if !result.holds() {
                                return result;
                            }
                        }
                        return result;
                    }
                }
                (
                    TypeData::StringMapping { kind: sk, ty: s },
                    TypeData::StringMapping { kind: tk, ty: t },
                ) => {
                    if sk == tk {
                        return self.is_related_to(r, *s, *t, REC_BOTH);
                    }
                }
                _ => {}
            }
            if !is_object_kind(sd) {
                return Ternary::FALSE;
            }
        } else if is_union_or_intersection_kind(sd) || is_union_or_intersection_kind(td) {
            let result = self
                .union_or_intersection_related_to_as::<REPORT>(r, source, sd, target, td, state);
            if result.holds() {
                return result;
            }
            // Decomposing unions and intersections in order does not cover: a generic source; an
            // object type compared with a union (`{ a, b: boolean }` and `{ a, b: true } | { a, b:
            // false }`); an intersection compared with an object type, a union, or a generic type.
            let target_is_union = matches!(td, TypeData::Union(_));
            if !(is_instantiable_kind(sd)
                || is_object_kind(sd) && target_is_union
                || matches!(sd, TypeData::Intersection(_))
                    && (is_object_kind(td) || target_is_union || is_instantiable_kind(td)))
            {
                return Ternary::FALSE;
            }
        }
        // Two instantiations of the same generic alias: relate the type arguments by variance. tsgo
        // limits alias variance probing to object and conditional source types; the target can be
        // any type with that alias, including a union.
        if self.flags(source) & (tf::OBJECT | tf::CONDITIONAL) != 0
            && let Some((alias, source_args, target_args, true)) = self.same_alias(source, target)
            && {
                let params = self.type_params_of_symbol(alias);
                !self.are_marker_arguments(alias, &params, &source_args)
                    && !self.are_marker_arguments(alias, &params, &target_args)
            }
        {
            let variances = self.variances_list(alias);
            // Being measured.
            if variances.is_empty() {
                return Ternary::UNKNOWN;
            }
            let result = self.relate_variances::<REPORT>(
                r,
                &source_args,
                &target_args,
                &variances,
                state,
                &mut shared,
            );
            let holds = result.is_some_and(Ternary::holds);
            self.note_compared_by_variances::<REPORT>(alias, &source_args, &target_args, holds);
            if let Some(result) = result {
                return result;
            }
        }
        // `[...U]` is related to `T` if `U` is; `U` is related to `readonly [...T]`, and to
        // `[...T]` if `U` is a mutable array or tuple.
        if let TypeData::Tuple {
            flags, readonly, ..
        } = sd
            && flags.len() == 1
            && flags[0].contains(ElemFlags::VARIADIC)
            && !*readonly
        {
            let element = self.type_arguments(source)[0];
            let result = self.is_related_to(r, element, target, REC_SOURCE);
            if result.holds() {
                return result;
            }
        }
        if let TypeData::Tuple {
            flags, readonly, ..
        } = td
            && flags.len() == 1
            && flags[0].contains(ElemFlags::VARIADIC)
            && (*readonly || {
                let constraint = self.base_constraint_or_type(source);
                self.is_mutable_array_or_tuple(constraint)
            })
        {
            let element = self.type_arguments(target)[0];
            let result = self.is_related_to(r, source, element, REC_TARGET);
            if result.holds() {
                return result;
            }
        }

        // ── by kind of target ──
        match *td {
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_) => {
                // `{ [P in Q]: X }` is related to `T` if `keyof T` is related to `Q` and `X` is
                // related to `T[Q]`.
                if is_mapped_kind(sd) && self.mapped_name_type(source).is_none() {
                    let (keys, covered) = (self.keyof(target), self.mapped_keys(source));
                    if self.is_related_to(r, keys, covered, REC_BOTH).holds()
                        && self.mapped_optional_modifier(source) != MappedModifier::Add
                    {
                        let template = self.mapped_template(source);
                        let param = self.mapped_type_param(source);
                        let expected = self.indexed_access(target, param);
                        let result = self.is_related_to_ex::<REPORT>(
                            r, template, expected, REC_BOTH, STATE_NONE,
                        );
                        if result.holds() {
                            return result;
                        }
                    }
                }
                if relation == Relation::Comparable && self.is_type_param(source) {
                    // Two type parameters are comparable only if one is constrained to the other.
                    if let Some(constraint) = self.constraint_of_type_param(source)
                        && self.some_type(constraint, |c, m| c.is_type_param(m))
                    {
                        return self.is_related_to(r, constraint, target, REC_SOURCE);
                    }
                    return Ternary::FALSE;
                }
            }
            TypeData::IndexedAccess {
                obj: object, index, ..
            } => {
                if let TypeData::IndexedAccess {
                    obj: so, index: si, ..
                } = *self.data(source)
                {
                    // `S[K]` is related to `T[J]` if `S` is related to `T` and `K` is related to
                    // `J`.
                    let mut result =
                        self.is_related_to_ex::<REPORT>(r, so, object, REC_BOTH, STATE_NONE);
                    if result.holds() {
                        result &=
                            self.is_related_to_ex::<REPORT>(r, si, index, REC_BOTH, STATE_NONE);
                    }
                    if result.holds() {
                        return result;
                    }
                    if REPORT {
                        shared.original_error_chain = r.error_chain.clone();
                    }
                }
                // `S` is related to `T[K]` if it is related to the type that can be written to
                // `T[K]` for any `T` and `K`. That type is computed from their constraints.
                if relation.is_lenient() {
                    let (base_object, base_index) = (
                        self.base_constraint_or_type(object),
                        self.base_constraint_or_type(index),
                    );
                    if !self.is_generic_object_type(base_object)
                        && !self.is_generic_index_type(base_index)
                        && let Some(constraint) = self.indexed_access_with_flags(
                            base_object,
                            base_index,
                            if base_object != object {
                                AccessFlags::WRITING | AccessFlags::NO_INDEX_SIGNATURES
                            } else {
                                AccessFlags::WRITING
                            },
                        )
                    {
                        if REPORT && shared.original_error_chain.is_some() {
                            r.restore_error_state(&shared.save_error_state);
                        }
                        let result = self
                            .is_related_to_ex::<REPORT>(r, source, constraint, REC_TARGET, state);
                        if result.holds() {
                            return result;
                        }
                        // The shorter of the two error chains.
                        if REPORT
                            && shared.original_error_chain.is_some()
                            && r.error_chain.is_some()
                            && chain_depth(&shared.original_error_chain)
                                <= chain_depth(&r.error_chain)
                        {
                            r.error_chain = shared.original_error_chain.clone();
                        }
                    }
                }
                if REPORT {
                    shared.original_error_chain = None;
                }
            }
            TypeData::Keyof(of) => {
                // `keyof S` is related to `keyof T` if `T` is related to `S`.
                if let TypeData::Keyof(s) = *self.data(source) {
                    let result = self.is_related_to(r, of, s, REC_BOTH);
                    if result.holds() {
                        return result;
                    }
                }
                if let TypeData::Tuple {
                    flags, readonly, ..
                } = self.data(of)
                {
                    // Only with variadic elements.
                    let known = self.known_keys_of_tuple_type(flags, *readonly);
                    let result =
                        self.is_related_to_ex::<REPORT>(r, source, known, REC_TARGET, STATE_NONE);
                    if result.holds() {
                        return result;
                    }
                } else {
                    if let Some(constraint) = self.simplified_or_constraint(of) {
                        // Only a definite result counts, or `T extends { [K in keyof T]: string }`
                        // would accept anything.
                        // `IndexFlagsNoReducibleCheck`: a union is its own constraint, and its
                        // `keyof` must not be deferred again.
                        let keys =
                            self.get_index_type_ex(constraint, IndexFlags::NO_REDUCIBLE_CHECK);
                        if self.is_related_to_ex::<REPORT>(r, source, keys, REC_TARGET, STATE_NONE)
                            == Ternary::TRUE
                        {
                            return Ternary::TRUE;
                        }
                    } else if self.is_generic_mapped_type(of) {
                        let keys = match self.mapped_name_type(of) {
                            // The known keys, and the keys that are still generic.
                            Some(name) => match self.apparent_mapped_type_keys(name, of) {
                                Some(known) => self.union(&[known, name]),
                                None => name,
                            },
                            None => self.mapped_keys(of),
                        };
                        if self.is_related_to_ex::<REPORT>(r, source, keys, REC_TARGET, STATE_NONE)
                            == Ternary::TRUE
                        {
                            return Ternary::TRUE;
                        }
                    }
                }
            }
            TypeData::Cond { file, node, .. } => {
                if self.is_deeply_nested_type(target, &r.target_stack, 10) {
                    return Ternary::MAYBE;
                }
                // Only without `infer`, when the result does not depend on distribution, and when
                // the source is not instantiated from the same conditional type.
                let same_root = matches!(*self.data(source), TypeData::Cond { file: sf, node: sn, .. } if (sf, sn) == (file, node));
                if self.cond_infer_params(target).is_empty()
                    && !self.is_distribution_dependent(target)
                    && !same_root
                {
                    let (check, extends) = (self.cond_check(target), self.cond_extends(target));
                    // It may always take one branch and be deferred anyway.
                    let skip_true = !self.is_assignable_permissive(check, extends);
                    let skip_false = !skip_true && self.is_assignable_restrictive(check, extends);
                    let mut result = if skip_true {
                        Ternary::TRUE
                    } else {
                        let yes = self.cond_true(target);
                        self.is_related_to_ex::<false>(r, source, yes, REC_TARGET, state)
                    };
                    if result.holds() {
                        if !skip_false {
                            let no = self.cond_false(target);
                            result &=
                                self.is_related_to_ex::<false>(r, source, no, REC_TARGET, state);
                        }
                        if result.holds() {
                            return result;
                        }
                    }
                }
            }
            TypeData::Template { .. } => {
                let TypeData::Template { texts, types } = self.data(target) else {
                    unreachable!()
                };
                if let TypeData::Template { texts: st, .. } = self.data(source) {
                    if relation == Relation::Comparable {
                        return Ternary::of(!self.templates_definitely_unrelated(st, texts));
                    }
                    // `foo-${number}` is related to `foo-${string}` though `number` is not related
                    // to `string`.
                    self.report_unreliable(source);
                }
                if self.is_type_matched_by_template_literal_type(source, texts, types) {
                    return Ternary::TRUE;
                }
            }
            TypeData::StringMapping { .. } => {
                if !matches!(self.data(source), TypeData::StringMapping { .. })
                    && self.is_member_of_string_mapping(source, target)
                {
                    return Ternary::TRUE;
                }
            }
            _ if relation != Relation::Identity
                && is_mapped_kind(td)
                && self.is_generic(target) =>
            {
                // `S` against `{ [P in Q]: T }` or `{ [P in Q as R]: T }`.
                let name_type = self.mapped_name_type(target);
                let keys_remapped = name_type.is_some();
                let template = self.mapped_template(target);
                let modifier = self.mapped_optional_modifier(target);
                let param = self.mapped_type_param(target);
                if modifier != MappedModifier::Remove {
                    // `S` fits `{ [P in Q]: S[P] }`.
                    if !keys_remapped
                        && *self.data(template)
                            == (TypeData::IndexedAccess {
                                obj: source,
                                index: param,
                                undefined: false,
                            })
                    {
                        return Ternary::TRUE;
                    }
                    if !self.is_generic_mapped_type(source) {
                        let target_keys = match name_type {
                            Some(name) => name,
                            None => self.mapped_keys(target),
                        };
                        let source_keys =
                            self.get_index_type_ex(source, IndexFlags::NO_INDEX_SIGNATURES);
                        let include_optional = modifier == MappedModifier::Add;
                        let filtered = if include_optional {
                            Some(self.intersection(&[target_keys, source_keys]))
                        } else {
                            None
                        };
                        let keys_do = match filtered {
                            Some(filtered) => !filtered.is_never(),
                            None => self
                                .is_related_to(r, target_keys, source_keys, REC_BOTH)
                                .holds(),
                        };
                        if keys_do {
                            // `Obj[P]`: comparing `S` with `Obj` suffices, and creates no new
                            // types.
                            let non_null =
                                self.filter(template, |_, m| !m.is_null() && !m.is_undefined());
                            if !keys_remapped
                                && let TypeData::IndexedAccess { obj, index, .. } =
                                    *self.data(non_null)
                                && index == param
                            {
                                let result = self.is_related_to_ex::<REPORT>(
                                    r, source, obj, REC_TARGET, STATE_NONE,
                                );
                                if result.holds() {
                                    return result;
                                }
                            } else {
                                let indexing = if keys_remapped {
                                    filtered.unwrap_or(target_keys)
                                } else {
                                    match filtered {
                                        Some(filtered) => self.intersection(&[filtered, param]),
                                        None => param,
                                    }
                                };
                                let access = self.indexed_access(source, indexing);
                                let result = self.is_related_to_ex::<REPORT>(
                                    r, access, template, REC_BOTH, STATE_NONE,
                                );
                                if result.holds() {
                                    return result;
                                }
                            }
                        }
                        if REPORT {
                            shared.original_error_chain = r.error_chain.clone();
                            r.restore_error_state(&shared.save_error_state);
                        }
                    }
                }
            }
            _ => {}
        }

        // ── by kind of source ──
        match *sd {
            TypeData::TypeParam(..)
            | TypeData::ThisParam(_)
            | TypeData::Marker(_)
            | TypeData::IndexedAccess { .. } => {
                // `S[K]` against `T[J]` was handled above.
                if !(matches!(self.data(source), TypeData::IndexedAccess { .. })
                    && matches!(self.data(target), TypeData::IndexedAccess { .. }))
                {
                    let constraint = self.constraint_of(source).unwrap_or(TypeId::UNKNOWN);
                    let result =
                        self.is_related_to_ex::<false>(r, constraint, target, REC_SOURCE, state);
                    if result.holds() {
                        return result;
                    }
                    // `getTypeWithThisArgument`: in the members it has through its constraint,
                    // `this` is the type variable itself.
                    let with_this = self.type_with_this_argument(constraint, source);
                    if REPORT
                        && constraint != TypeId::UNKNOWN
                        && !(self.is_type_param(target) && self.is_type_param(source))
                    {
                        let result =
                            self.is_related_to_ex::<true>(r, with_this, target, REC_SOURCE, state);
                        if result.holds() {
                            return result;
                        }
                    } else if with_this != constraint {
                        let result =
                            self.is_related_to_ex::<false>(r, with_this, target, REC_SOURCE, state);
                        if result.holds() {
                            return result;
                        }
                    }
                    if self.is_mapped_type_generic_indexed_access(source)
                        && let TypeData::IndexedAccess { obj, index, .. } = *self.data(source)
                        && let Some(index_constraint) = self.constraint_of(index)
                    {
                        // `{ [P in K]: E }[X]`: `E` with `X` substituted for `P` was tried; now
                        // with the constraint of `X`.
                        let access = self.indexed_access(obj, index_constraint);
                        let result = self
                            .is_related_to_ex::<REPORT>(r, access, target, REC_SOURCE, STATE_NONE);
                        if result.holds() {
                            return result;
                        }
                    }
                }
            }
            TypeData::Keyof(of) => {
                let any_key = self.union(&[TypeId::STRING, TypeId::NUMBER, TypeId::SYMBOL]);
                let result = if REPORT && !self.is_generic_mapped_type(of) {
                    self.is_related_to_ex::<true>(r, any_key, target, REC_SOURCE, STATE_NONE)
                } else {
                    self.is_related_to(r, any_key, target, REC_SOURCE)
                };
                if result.holds() {
                    return result;
                }
                if self.is_generic_mapped_type(of) {
                    let keys = match self.mapped_name_type(of) {
                        // Without the generic keys: they refer to a type parameter that is not in
                        // scope outside the mapped type.
                        Some(name) => self.apparent_mapped_type_keys(name, of).unwrap_or(name),
                        None => self.mapped_keys(of),
                    };
                    let result =
                        self.is_related_to_ex::<REPORT>(r, keys, target, REC_SOURCE, STATE_NONE);
                    if result.holds() {
                        return result;
                    }
                }
            }
            TypeData::Cond { .. } => {
                if self.is_deeply_nested_type(source, &r.source_stack, 10) {
                    return Ternary::MAYBE;
                }
                if matches!(self.data(target), TypeData::Cond { .. }) {
                    // `T1 extends U1 ? X1 : Y1` is related to `T2 extends U2 ? X2 : Y2` if one of
                    // `T1` and `T2` is related to the other, `U1` and `U2` are identical, `X1` is
                    // related to `X2` and `Y1` is related to `Y2`.
                    let source_params = self.cond_infer_params(source);
                    let mut source_extends = self.cond_extends(source);
                    let target_extends = self.cond_extends(target);
                    let mut mapper = MapperId::IDENTITY;
                    // Instantiated from one declaration, both sides have the same `infer` type
                    // parameters: each maps to itself.
                    if !source_params.is_empty() && source_extends != target_extends {
                        let around = self.cond_origin(source).2;
                        let inferred = self.infer_from_types(
                            &source_params,
                            target_extends,
                            source_extends,
                            around,
                        );
                        mapper = self.mapper_from(&source_params, &inferred);
                        source_extends = self.instantiate(source_extends, mapper);
                    }
                    if self.is_identical(source_extends, target_extends) {
                        let (sc, tc) = (self.cond_check(source), self.cond_check(target));
                        if self.is_related_to(r, sc, tc, REC_BOTH).holds()
                            || self.is_related_to(r, tc, sc, REC_BOTH).holds()
                        {
                            let (sy, ty) = (self.cond_true(source), self.cond_true(target));
                            let sy = self.instantiate(sy, mapper);
                            let mut result =
                                self.is_related_to_ex::<REPORT>(r, sy, ty, REC_BOTH, STATE_NONE);
                            if result.holds() {
                                let (sn, tn) = (self.cond_false(source), self.cond_false(target));
                                result &= self
                                    .is_related_to_ex::<REPORT>(r, sn, tn, REC_BOTH, STATE_NONE);
                            }
                            if result.holds() {
                                return result;
                            }
                        }
                    }
                }
                // It is one of its branches.
                let default_constraint = self.default_constraint_of_conditional(source);
                let result = self.is_related_to_ex::<REPORT>(
                    r,
                    default_constraint,
                    target,
                    REC_SOURCE,
                    STATE_NONE,
                );
                if result.holds() {
                    return result;
                }
                // Not against another conditional type: the check type is replaced by its
                // constraint, and too much would be related.
                if !matches!(self.data(target), TypeData::Cond { .. })
                    && self.has_non_circular_base_constraint(source)
                {
                    if let Some(distributive) = self.constraint_of_distributive_conditional(source)
                    {
                        if REPORT {
                            r.restore_error_state(&shared.save_error_state);
                        }
                        let result = self.is_related_to_ex::<REPORT>(
                            r,
                            distributive,
                            target,
                            REC_SOURCE,
                            STATE_NONE,
                        );
                        if result.holds() {
                            return result;
                        }
                    }
                }
            }
            TypeData::Template { .. } if !self.is_object_type(target) => {
                if !matches!(self.data(target), TypeData::Template { .. })
                    && let Some(constraint) = self.base_constraint_of(source)
                    && constraint != source
                {
                    let result = self
                        .is_related_to_ex::<REPORT>(r, constraint, target, REC_SOURCE, STATE_NONE);
                    if result.holds() {
                        return result;
                    }
                }
            }
            TypeData::StringMapping { kind, ty } => {
                if let TypeData::StringMapping { kind: tk, ty: tt } = *self.data(target) {
                    if kind != tk {
                        return Ternary::FALSE;
                    }
                    let result = self.is_related_to_ex::<REPORT>(r, ty, tt, REC_BOTH, STATE_NONE);
                    if result.holds() {
                        return result;
                    }
                } else if let Some(constraint) = self.base_constraint_of(source) {
                    let result = self
                        .is_related_to_ex::<REPORT>(r, constraint, target, REC_SOURCE, STATE_NONE);
                    if result.holds() {
                        return result;
                    }
                }
            }
            _ => {
                return self.objects_related_to::<REPORT>(
                    r,
                    source,
                    sd,
                    target,
                    td,
                    state,
                    &mut shared,
                );
            }
        }
        Ternary::FALSE
    }

    /// The `default` case of the second `switch` of `structuredTypeRelatedToWorker`. `sd`, `td`:
    /// the `TypeData` of `source` and `target`.
    #[allow(clippy::too_many_arguments)]
    fn objects_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        sd: &'p TypeData,
        target: TypeId,
        td: &'p TypeData,
        state: u8,
        shared: &mut WorkerState,
    ) -> Ternary {
        let relation = r.relation;
        let target_is_mapped = is_mapped_kind(td);
        // `isPartialMappedType(target) && isEmptyObjectType(source)`
        if !relation.is_subtype()
            && target_is_mapped
            && self.mapped_optional_modifier(target) == MappedModifier::Add
            && self.is_empty_object_type(source)
        {
            return Ternary::TRUE;
        }
        if target_is_mapped && self.is_generic(target) {
            if self.is_generic_mapped_type(source) {
                let result = self.mapped_type_related_to::<REPORT>(r, source, target);
                if result.holds() {
                    return result;
                }
            }
            return Ternary::FALSE;
        }
        let source_is_primitive = self.has_primitive_flag_as(source, sd);
        // The type that represents `object` has no declaration: it is not known to have no other
        // members.
        let source_is_object_keyword = !is_object_kind(sd) && self.is_object_keyword_like(source);
        let (mut source, mut sd) = (source, sd);
        if relation != Relation::Identity {
            // An object type other than a mapped one is its own apparent type.
            if !is_object_kind(sd) || is_mapped_kind(sd) {
                source = self.apparent_type_for_relation(source);
                // Only for reporting: the diagnostic prints this type.
                if REPORT {
                    source = self.apparent_type_of_intersection(source);
                }
                sd = self.data(source);
            }
        } else if self.is_generic_mapped_type(source) {
            return Ternary::FALSE;
        }
        match (sd, td) {
            (TypeData::Ref { target: st, .. }, TypeData::Ref { target: tt, .. })
                if st == tt && !self.is_marker_type(source) && !self.is_marker_type(target) =>
            {
                // "When strictNullChecks is disabled, the element type of the empty array literal is
                // undefinedWideningType, and an empty array literal wouldn't be assignable to a
                // `never[]` without this check."
                if self.is_empty_array_literal_type(source) {
                    return Ternary::TRUE;
                }
                // Two instantiations of one generic type: relate the type arguments by variance.
                let variances = self.variances_list(*st);
                // The variance computation is in progress. So only occurrences that are not inside
                // instantiations of the type itself count.
                if variances.is_empty() {
                    return Ternary::UNKNOWN;
                }
                let (sa, ta) = (self.type_arguments(source), self.type_arguments(target));
                let result = self.relate_variances::<REPORT>(r, sa, ta, &variances, state, shared);
                let holds = result.is_some_and(Ternary::holds);
                self.note_compared_by_variances::<REPORT>(*st, sa, ta, holds);
                if let Some(result) = result {
                    return result;
                }
            }
            (_, TypeData::Ref { .. })
                if self.is_array(target)
                    && (self.is_reference_to_global(target, known::ReadonlyArray)
                        && self.every_type(source, |c, m| c.is_array_or_tuple(m))
                        || self.every_type(source, |c, m| {
                            matches!(
                                c.data(m),
                                TypeData::Tuple {
                                    readonly: false,
                                    ..
                                }
                            )
                        })) =>
            {
                if relation != Relation::Identity {
                    let (s, t) = (
                        self.index_type_of_type(source, TypeId::NUMBER)
                            .unwrap_or(TypeId::ANY),
                        self.index_type_of_type(target, TypeId::NUMBER)
                            .unwrap_or(TypeId::ANY),
                    );
                    return self.is_related_to_ex::<REPORT>(r, s, t, REC_BOTH, STATE_NONE);
                }
                return Ternary::FALSE;
            }
            (TypeData::Tuple { .. }, TypeData::Tuple { .. })
                if is_generic_tuple_kind(sd) && !is_generic_tuple_kind(td) =>
            {
                let constraint = self.base_constraint_or_type(source);
                if constraint != source {
                    return self
                        .is_related_to_ex::<REPORT>(r, constraint, target, REC_SOURCE, STATE_NONE);
                }
            }
            _ if relation.is_subtype()
                && self.is_fresh_object_literal_type(target)
                && self.is_empty_object_type(target)
                && !self.is_empty_object_type(source) =>
            {
                return Ternary::FALSE;
            }
            _ => {}
        }
        // Regardless of the union, intersection and type argument comparisons, a structural
        // comparison may succeed. An intersection counts as one object type.
        let source_is_object_or_intersection =
            is_object_kind(sd) || matches!(sd, TypeData::Intersection(_));
        if source_is_object_or_intersection && is_object_kind(td) {
            // `reportStructuralErrors`: only if nothing has been reported yet.
            let primitive_or_keyword = (source_is_primitive, source_is_object_keyword);
            let result = if REPORT
                && is_same_chain(&r.error_chain, &shared.save_error_state.chain)
                && !source_is_primitive
            {
                self.object_members_related_to::<true>(
                    r,
                    source,
                    sd,
                    target,
                    td,
                    state,
                    primitive_or_keyword,
                )
            } else {
                self.object_members_related_to::<false>(
                    r,
                    source,
                    sd,
                    target,
                    td,
                    state,
                    primitive_or_keyword,
                )
            };
            if result.holds() {
                if !shared.variance_check_failed {
                    return result;
                }
                // The structural comparison has nothing to report: the errors from the type
                // arguments stand.
                if REPORT {
                    if shared.original_error_chain.is_some() {
                        r.error_chain = shared.original_error_chain.clone();
                    } else if r.error_chain.is_none() {
                        r.error_chain = shared.save_error_state.chain.clone();
                    }
                }
            }
        }
        // An object type is related to a discriminated union if every combination of its
        // discriminant values matches some member.
        if source_is_object_or_intersection && matches!(td, TypeData::Union(_)) {
            let object_only = self.filter(target, |c, m| {
                c.is_object_type(m)
                    || matches!(
                        c.data(m),
                        TypeData::Intersection(_) | TypeData::Substitution { .. }
                    )
            });
            if self.is_union(object_only) {
                let result = self.type_related_to_discriminated_type(
                    r,
                    source,
                    object_only,
                    state & STATE_REGULAR,
                );
                if result.holds() {
                    return result;
                }
            }
        }
        Ternary::FALSE
    }

    /// The four comparisons of `structuredTypeRelatedToWorker` under `reportStructuralErrors`,
    /// which is `REPORT` here.
    /// `primitive_or_keyword`: `sourceIsPrimitive`, and whether `source` represents `object`.
    #[allow(clippy::too_many_arguments)]
    #[inline]
    fn object_members_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        sd: &'p TypeData,
        target: TypeId,
        td: &'p TypeData,
        state: u8,
        primitive_or_keyword: (bool, bool),
    ) -> Ternary {
        let (source_is_primitive, source_is_object_keyword) = primitive_or_keyword;
        let mut both = None;
        let mut result = self.properties_related_to_noting::<REPORT>(
            r,
            source,
            None,
            target,
            &[],
            false,
            state,
            &mut both,
        );
        if result.holds() {
            result &= self.signatures_related_to_among::<REPORT>(
                r, source, sd, target, td, false, state, both,
            );
            if result.holds() {
                result &= self.signatures_related_to_among::<REPORT>(
                    r, source, sd, target, td, true, state, both,
                );
                if result.holds() {
                    // tsgo compares, and prints, `{}`.
                    if REPORT && source_is_object_keyword {
                        return result
                            & self.report_index_signature_missing_in_object(r, source, target);
                    }
                    let source = if source_is_object_keyword {
                        TypeId::OBJECT
                    } else {
                        source
                    };
                    result &= self.index_signatures_related_to_among::<REPORT>(
                        r,
                        source,
                        target,
                        source_is_primitive,
                        state,
                        both,
                    );
                }
            }
        }
        result
    }

    /// `getApparentType`, except that a missing constraint yields `unknown` and not `{}`.
    pub(super) fn apparent_type_for_relation(&mut self, t: TypeId) -> TypeId {
        if self.is_deferred(t) {
            return match self.base_constraint_of(t) {
                Some(constraint) => self.apparent_type(constraint),
                None => TypeId::UNKNOWN,
            };
        }
        self.apparent_type(t)
    }

    /// The type that `getPropertiesOfType`, `getPropertyOfType` and `getIndexInfosOfType` use:
    /// `getReducedApparentType(ty)`, and for a union the properties common to all its members
    /// (`getPropertiesOfUnionOrIntersectionType`).
    pub(super) fn reduced_apparent_type_as_object(&mut self, ty: TypeId) -> TypeId {
        let ty = self.reduced_apparent_type(ty);
        if self.is_union(ty) {
            self.union_as_object(ty)
        } else {
            ty
        }
    }

    pub(super) fn is_mutable_array_or_tuple(&self, t: TypeId) -> bool {
        self.is_reference_to_global(t, known::Array)
            || matches!(
                self.data(t),
                TypeData::Tuple {
                    readonly: false,
                    ..
                }
            )
    }

    /// `typeArgumentsRelatedTo`
    pub(super) fn type_arguments_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        sources: &[TypeId],
        targets: &[TypeId],
        variances: &[u8],
        state: u8,
    ) -> Ternary {
        if sources.len() != targets.len() && r.relation == Relation::Identity {
            self.failed_type_argument = 0;
            return Ternary::FALSE;
        }
        let mut result = Ternary::TRUE;
        for i in 0..sources.len().min(targets.len()) {
            // Covariant when the variance is unknown: while the variance of a recursive type is
            // being computed.
            let flags = variances.get(i).copied().unwrap_or(COVARIANT);
            let variance = flags & VARIANCE_MASK;
            // The type argument of an independent type parameter is never observed.
            if variance == INDEPENDENT {
                continue;
            }
            let (s, t) = (sources[i], targets[i]);
            let related = if flags & UNMEASURABLE != 0 {
                // Not just invariant: with `-?` in a mapped type the outputs may be unrelated
                // however the inputs relate.
                if r.relation == Relation::Identity {
                    self.is_related_to(r, s, t, REC_BOTH)
                } else {
                    Ternary::of(self.is_identical(s, t))
                }
            } else {
                if self.in_variance_computation && flags & UNRELIABLE != 0 {
                    self.report_unreliable(s);
                }
                match variance {
                    COVARIANT => self.is_related_to_ex::<REPORT>(r, s, t, REC_BOTH, state),
                    CONTRAVARIANT => self.is_related_to_ex::<REPORT>(r, t, s, REC_BOTH, state),
                    BIVARIANT => {
                        let related = self.is_related_to(r, t, s, REC_BOTH);
                        if related.holds() {
                            related
                        } else {
                            self.is_related_to_ex::<REPORT>(r, s, t, REC_BOTH, state)
                        }
                    }
                    _ => {
                        let mut related = self.is_related_to_ex::<REPORT>(r, s, t, REC_BOTH, state);
                        if related.holds() {
                            related &= self.is_related_to_ex::<REPORT>(r, t, s, REC_BOTH, state);
                        }
                        related
                    }
                }
            };
            if !related.holds() {
                self.failed_type_argument = i as u32;
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    /// `mappedTypeRelatedTo`: `[P in S]: X` is related to `[Q in T]: Y` if `T` is related to `S`
    /// and `X`, with `Q` substituted for `P`, is related to `Y`.
    pub(super) fn mapped_type_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
    ) -> Ternary {
        let modifiers_related = match r.relation {
            Relation::Comparable => true,
            Relation::Identity => {
                let modifiers = |c: &Self, t: TypeId| {
                    c.mapped_origin(t).map(|(f, n, _)| {
                        (c.mapped_decl(f, n).optional, c.mapped_decl(f, n).readonly)
                    })
                };
                modifiers(self, source) == modifiers(self, target)
            }
            _ => {
                self.combined_mapped_optionality(source) <= self.combined_mapped_optionality(target)
            }
        };
        if !modifiers_related {
            return Ternary::FALSE;
        }
        let target_keys = self.mapped_keys(target);
        let source_keys = self.mapped_keys(source);
        if self.combined_mapped_optionality(source) < 0 {
            self.report_unmeasurable(source_keys);
        } else {
            self.report_unreliable(source_keys);
        }
        let result =
            self.is_related_to_ex::<REPORT>(r, target_keys, source_keys, REC_BOTH, STATE_NONE);
        if !result.holds() {
            return Ternary::FALSE;
        }
        let (sp, tp) = (
            self.mapped_type_param(source),
            self.mapped_type_param(target),
        );
        let mapper = self.mapper_from(&[sp], &[tp]);
        let name =
            |c: &mut Self, t: TypeId| c.mapped_name_type(t).map(|n| c.instantiate(n, mapper));
        if name(self, source) != name(self, target) {
            return Ternary::FALSE;
        }
        let (st, tt) = (self.mapped_template(source), self.mapped_template(target));
        let st = self.instantiate(st, mapper);
        result & self.is_related_to_ex::<REPORT>(r, st, tt, REC_BOTH, STATE_NONE)
    }

    /// `typeRelatedToDiscriminatedType`. `state`: `STATE_REGULAR` if `source` is an object literal that is no longer fresh.
    fn type_related_to_discriminated_type(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        state: u8,
    ) -> Ternary {
        let Some(sm) = self.members(source) else {
            return Ternary::FALSE;
        };
        // The discriminant properties of the union, each with its type in the source.
        let mut telling: Vec<(&Prop, TypeId)> = Vec::new();
        let mut combinations = 1usize;
        for prop in &sm.shape().props {
            if !self.is_discriminant_property(target, prop.name) {
                continue;
            }
            let ty = self.type_of_prop_as_read(prop, sm.mapper);
            combinations *= self.parts(ty).len();
            if combinations > 25 || combinations == 0 {
                return Ternary::FALSE;
            }
            telling.push((prop, ty));
        }
        if telling.is_empty() {
            return Ternary::FALSE;
        }
        let excluded: Vec<Atom> = telling.iter().map(|(p, _)| p.name).collect();
        // Every query on a member uses `getReducedApparentType`.
        let types: SmallVec<[TypeId; 8]> = self
            .parts(target)
            .iter()
            .map(|&t| self.reduced_apparent_type_as_object(t))
            .collect();
        // Every combination must match some member.
        let mut matching = vec![false; types.len()];
        let skip_optional =
            self.p.files.options.strict_null_checks || r.relation == Relation::Comparable;
        for combination in 0..combinations {
            let mut has_match = false;
            'members: for (m, &t) in types.iter().enumerate() {
                let Some(tm) = self.members(t) else { continue };
                let mut n = combination;
                for (prop, ty) in telling.iter().rev() {
                    let alternatives = self.parts(*ty);
                    let chosen = alternatives[n % alternatives.len()];
                    n /= alternatives.len();
                    let Some((target_prop, target_mapper)) = self.property_in(&tm, prop.name)
                    else {
                        continue 'members;
                    };
                    if !self
                        .property_related_to::<false>(
                            r,
                            (source, t),
                            prop,
                            |_| chosen,
                            target_prop,
                            target_mapper,
                            state,
                            skip_optional,
                        )
                        .holds()
                    {
                        continue 'members;
                    }
                }
                matching[m] = true;
                has_match = true;
            }
            if !has_match {
                return Ternary::FALSE;
            }
        }
        // The remaining properties must be related to each of the matched members.
        let mut result = Ternary::TRUE;
        for (m, &t) in types.iter().enumerate() {
            if !matching[m] {
                continue;
            }
            result &= self.properties_related_to::<false>(r, source, t, &excluded, false, state);
            if result.holds() {
                result &= self.signatures_related_to::<false>(r, source, t, false, STATE_NONE);
                if result.holds() {
                    result &= self.signatures_related_to::<false>(r, source, t, true, STATE_NONE);
                    if result.holds() && !(self.is_tuple(source) && self.is_tuple(t)) {
                        result &=
                            self.index_signatures_related_to::<false>(r, source, t, false, state);
                    }
                }
            }
            if !result.holds() {
                return result;
            }
        }
        result
    }

    // ───────────────────────────── properties ─────────────────────────────

    /// `propertiesRelatedTo`
    pub(super) fn properties_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        excluded: &[Atom],
        optionals_only: bool,
        state: u8,
    ) -> Ternary {
        self.properties_related_to_noting::<REPORT>(
            r,
            source,
            None,
            target,
            excluded,
            optionals_only,
            state,
            &mut None,
        )
    }

    /// `properties`: an object type with the properties `getPropertiesOfType(source)` returns,
    /// where `members(source)` lacks them.
    /// `both`: set to the `members` of `source` and of `target`, if they were requested and are
    /// final.
    #[allow(clippy::too_many_arguments)]
    fn properties_related_to_noting<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        properties: Option<TypeId>,
        target: TypeId,
        excluded: &[Atom],
        optionals_only: bool,
        state: u8,
        both: &mut Option<(Members<'p>, Members<'p>)>,
    ) -> Ternary {
        if r.relation == Relation::Identity {
            return self.properties_identical_to(r, source, target, excluded);
        }
        let mut result = Ternary::TRUE;
        let td = self.data(target);
        if let TypeData::Tuple {
            flags: target_flags,
            readonly: target_readonly,
            ..
        } = td
        {
            let target_elems = self.type_arguments(target);
            let variable = ElemFlags::REST | ElemFlags::VARIADIC;
            let target_has_rest_element = target_flags.iter().any(|f| f.intersects(variable));
            if self.is_array_or_tuple(source) {
                let one_element;
                let (source_elems, source_flags, source_readonly): (&[TypeId], &[ElemFlags], bool) =
                    match self.data(source) {
                        TypeData::Tuple {
                            flags, readonly, ..
                        } => (self.type_arguments(source), flags, *readonly),
                        _ => {
                            one_element = [self.array_element(source).unwrap_or(TypeId::ANY)];
                            (
                                &one_element,
                                &[ElemFlags::REST],
                                self.is_reference_to_global(source, known::ReadonlyArray),
                            )
                        }
                    };
                if !*target_readonly && source_readonly {
                    return Ternary::FALSE;
                }
                let is_required =
                    |f: &&ElemFlags| f.intersects(ElemFlags::REQUIRED | ElemFlags::VARIADIC);
                let (source_arity, target_arity) = (source_elems.len(), target_elems.len());
                let source_rest = source_flags.iter().any(|f| f.contains(ElemFlags::REST));
                let source_min_length = if self.is_tuple(source) {
                    source_flags.iter().filter(is_required).count()
                } else {
                    0
                };
                let target_min_length = target_flags.iter().filter(is_required).count();
                if !source_rest && source_arity < target_min_length {
                    if REPORT {
                        let args = [Arg::Number(source_arity), Arg::Number(target_min_length)];
                        self.report_error(r, 2618, &args);
                    }
                    return Ternary::FALSE;
                }
                if !target_has_rest_element && target_arity < source_min_length {
                    if REPORT {
                        let args = [Arg::Number(source_min_length), Arg::Number(target_arity)];
                        self.report_error(r, 2619, &args);
                    }
                    return Ternary::FALSE;
                }
                if !target_has_rest_element && (source_rest || target_arity < source_arity) {
                    if REPORT {
                        if source_min_length < target_min_length {
                            self.report_error(r, 2620, &[Arg::Number(target_min_length)]);
                        } else {
                            self.report_error(r, 2621, &[Arg::Number(target_arity)]);
                        }
                    }
                    return Ternary::FALSE;
                }
                let is_rest = |f: &ElemFlags| f.contains(ElemFlags::REST);
                let target_start_count = target_flags
                    .iter()
                    .position(is_rest)
                    .unwrap_or(target_arity);
                let target_end_count = target_flags
                    .iter()
                    .rev()
                    .position(is_rest)
                    .unwrap_or(target_arity);
                let mut can_exclude_discriminants = !excluded.is_empty();
                for source_position in 0..source_arity {
                    let source_flag = source_flags[source_position];
                    let source_position_from_end = source_arity - 1 - source_position;
                    let target_position =
                        if target_has_rest_element && source_position >= target_start_count {
                            (target_arity - 1)
                                .checked_sub(source_position_from_end.min(target_end_count))
                        } else {
                            Some(source_position)
                        };
                    let Some(target_position) = target_position.filter(|&p| p < target_arity)
                    else {
                        return Ternary::FALSE;
                    };
                    let target_flag = target_flags[target_position];
                    if target_flag.contains(ElemFlags::VARIADIC)
                        && !source_flag.contains(ElemFlags::VARIADIC)
                    {
                        if REPORT {
                            self.report_error(r, 2624, &[Arg::Number(target_position)]);
                        }
                        return Ternary::FALSE;
                    }
                    if source_flag.contains(ElemFlags::VARIADIC)
                        && !target_flag.intersects(variable)
                    {
                        if REPORT {
                            let args = [Arg::Number(source_position), Arg::Number(target_position)];
                            self.report_error(r, 2625, &args);
                        }
                        return Ternary::FALSE;
                    }
                    if target_flag.contains(ElemFlags::REQUIRED)
                        && !source_flag.contains(ElemFlags::REQUIRED)
                    {
                        if REPORT {
                            self.report_error(r, 2623, &[Arg::Number(target_position)]);
                        }
                        return Ternary::FALSE;
                    }
                    // "We can only exclude discriminant properties if we have not yet encountered a
                    // variable-length element."
                    if can_exclude_discriminants {
                        if source_flag.intersects(variable) || target_flag.intersects(variable) {
                            can_exclude_discriminants = false;
                        }
                        if can_exclude_discriminants
                            && excluded.contains(&self.number_name(source_position as f64))
                        {
                            continue;
                        }
                    }
                    // An optional element includes the missing type (`tuple`).
                    let source_type = self.remove_missing_type(
                        source_elems[source_position],
                        (source_flag & target_flag).contains(ElemFlags::OPTIONAL),
                    );
                    let target_type = target_elems[target_position];
                    let target_check_type = if source_flag.contains(ElemFlags::VARIADIC)
                        && target_flag.contains(ElemFlags::REST)
                    {
                        self.array_of(target_type)
                    } else {
                        self.remove_missing_type(
                            target_type,
                            target_flag.contains(ElemFlags::OPTIONAL),
                        )
                    };
                    let related = self.is_related_to_ex::<REPORT>(
                        r,
                        source_type,
                        target_check_type,
                        REC_BOTH,
                        state,
                    );
                    if !related.holds() {
                        if REPORT && (target_arity > 1 || source_arity > 1) {
                            if target_has_rest_element
                                && source_position >= target_start_count
                                && source_position_from_end >= target_end_count
                                && target_start_count != source_arity - target_end_count - 1
                            {
                                let args = [
                                    Arg::Number(target_start_count),
                                    Arg::Number(source_arity - target_end_count - 1),
                                    Arg::Number(target_position),
                                ];
                                self.report_error(r, 2627, &args);
                            } else {
                                let args =
                                    [Arg::Number(source_position), Arg::Number(target_position)];
                                self.report_error(r, 2626, &args);
                            }
                        }
                        return Ternary::FALSE;
                    }
                    result &= related;
                }
                return result;
            }
            if target_has_rest_element {
                return Ternary::FALSE;
            }
        }
        let provisional = self.provisional_shapes.len();
        let (Some(sm), Some(tm)) = (
            self.members(properties.unwrap_or(source)),
            self.members(target),
        ) else {
            return Ternary::FALSE;
        };
        // A cached shape does not change.
        if self.provisional_shapes.len() == provisional {
            *both = Some((sm, tm));
        }
        // `anyFunctionType` has no `ObjectFlagsObjectLiteral`.
        let require_optional_properties = r.relation.is_subtype()
            && (!self.is_object_literal_type(source) || self.is_any_function_type(source))
            && !self.is_tuple(source);
        let mut inherited = self.inherited_of(sm.shape());
        // `getUnmatchedProperty`
        for tp in &tm.shape().props {
            if !(require_optional_properties || !tp.flags.contains(PropFlags::OPTIONAL))
                || sm.resolved.prop(tp.name).is_some()
                // `isStaticPrivateIdentifierProperty`
                || self.is_static_private_name(tp)
            {
                continue;
            }
            if self.inherited_property(&mut inherited, tp.name).is_none() {
                // `shouldReportUnmatchedPropertyError`: a function type that lacks the properties
                // of an object type is a mismatch of kind, not a missing property.
                let (s, t) = (sm.shape(), tm.shape());
                if REPORT
                    && (s.call.is_empty() && s.construct.is_empty()
                        || !s.props.is_empty() && self.is_object_type(source)
                        || !t.call.is_empty() && !s.call.is_empty()
                        || !t.construct.is_empty() && !s.construct.is_empty())
                {
                    // `getUnmatchedProperties`
                    let mut unmatched: Vec<&Prop> = Vec::new();
                    for tp in &t.props {
                        if !self.is_static_private_name(tp)
                            && (require_optional_properties
                                || !tp.flags.contains(PropFlags::OPTIONAL))
                            && self.property_of_type(&sm, tp.name).is_none()
                        {
                            unmatched.push(tp);
                        }
                    }
                    self.report_unmatched_property(r, source, target, &sm, &unmatched);
                }
                return Ternary::FALSE;
            }
        }
        if is_object_literal_kind(td) {
            for sp in &sm.shape().props {
                if !excluded.contains(&sp.name) && tm.resolved.prop(sp.name).is_none() {
                    if REPORT {
                        self.report_error(r, 2339, &[Arg::Prop(sp), Arg::Type(target)]);
                    }
                    return Ternary::FALSE;
                }
            }
        }
        // `SymbolFlagsPrototype`: the instance type of a class is compared through its construct
        // signatures.
        let target_is_class = matches!(
            td,
            TypeData::Anon {
                origin: Origin::ClassStatic(_),
                ..
            }
        );
        // `getNamedMembers`: members without a declaration, the elements and the length of a tuple,
        // come last, sorted by name. The order decides which one is reported.
        let mut in_order: Vec<&Prop> = Vec::new();
        if REPORT && matches!(td, TypeData::Tuple { .. }) {
            in_order.extend(&tm.shape().props);
            let atoms = &self.atoms();
            let place = |tp: &Prop| match tp.source {
                PropSource::Type(_) => (true, atoms.bytes(tp.name)),
                _ => (false, &[][..]),
            };
            in_order.sort_by(|a, b| place(a).cmp(&place(b)));
        }
        for (i, tp) in tm.shape().props.iter().enumerate() {
            let tp = if REPORT {
                in_order.get(i).copied().unwrap_or(tp)
            } else {
                tp
            };
            if excluded.contains(&tp.name)
                || optionals_only && !tp.flags.contains(PropFlags::OPTIONAL)
                || target_is_class && tp.name == known::prototype
            {
                continue;
            }
            let Some((sp, source_mapper)) = self.property_among(&sm, &mut inherited, tp.name)
            else {
                continue;
            };
            if sp.source == tp.source {
                if (sp.mapper, source_mapper) == (tp.mapper, tm.mapper) {
                    continue;
                }
                let a = self.compose(sp.mapper, source_mapper);
                let b = self.compose(tp.mapper, tm.mapper);
                // A mapper stores `H.this -> H.this`, which maps nothing.
                let types = &self.types();
                let moved = |m| types.mapping(m).iter().filter(|pair| pair.0 != pair.1);
                if a == b || moved(a).eq(moved(b)) {
                    continue;
                }
            }
            let related = self.property_related_to::<REPORT>(
                r,
                (source, target),
                sp,
                |c| c.type_of_prop_as_read(sp, source_mapper),
                tp,
                tm.mapper,
                state,
                r.relation == Relation::Comparable,
            );
            if !related.holds() {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    /// `propertyRelatedTo`. `of`: `source` and `target`, the two types that own the properties.
    #[allow(clippy::too_many_arguments)]
    fn property_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        of: (TypeId, TypeId),
        source_prop: &Prop,
        get_type_of_source_property: impl FnOnce(&mut Self) -> TypeId,
        target_prop: &Prop,
        target_mapper: MapperId,
        state: u8,
        skip_optional: bool,
    ) -> Ternary {
        let (source, target) = of;
        let (sf, tf) = (source_prop.flags, target_prop.flags);
        if sf.contains(PropFlags::PRIVATE) || tf.contains(PropFlags::PRIVATE) {
            if Self::value_declaration(source_prop) != Self::value_declaration(target_prop) {
                if REPORT {
                    let name = Arg::Prop(target_prop);
                    if sf.contains(PropFlags::PRIVATE) && tf.contains(PropFlags::PRIVATE) {
                        self.report_error(r, 2442, &[name]);
                    } else {
                        let (private_in, other) = if sf.contains(PropFlags::PRIVATE) {
                            (source, target)
                        } else {
                            (target, source)
                        };
                        let args = [name, Arg::Type(private_in), Arg::Type(other)];
                        self.report_error(r, 2325, &args);
                    }
                }
                return Ternary::FALSE;
            }
        } else if tf.contains(PropFlags::PROTECTED) {
            if !self.is_valid_override_of(source_prop, target_prop) {
                if REPORT {
                    // `getDeclaringClass`
                    let source_type = match self.declaring_class(source_prop) {
                        Some(class) => self.declared_type(class),
                        None => source,
                    };
                    let target_type = match self.declaring_class(target_prop) {
                        Some(class) => self.declared_type(class),
                        None => target,
                    };
                    let types = [source_type, target_type].map(Arg::Type);
                    self.report_error(r, 2443, &[Arg::Prop(target_prop), types[0], types[1]]);
                }
                return Ternary::FALSE;
            }
        } else if sf.contains(PropFlags::PROTECTED) {
            if REPORT {
                let args = [Arg::Prop(target_prop), Arg::Type(source), Arg::Type(target)];
                self.report_error(r, 2444, &args);
            }
            return Ternary::FALSE;
        }
        // So that which of `{ readonly a }` and `{ a }` stays in a union does not depend on their
        // source order.
        if r.relation == Relation::StrictSubtype
            && sf.contains(PropFlags::READONLY)
            && !tf.contains(PropFlags::READONLY)
        {
            return Ternary::FALSE;
        }
        // `isPropertySymbolTypeRelated`
        let expected = self.type_of_prop_as_read(target_prop, target_mapper);
        let related = if self.has_any_flag(expected)
            || expected == TypeId::UNRESOLVED
            || expected == TypeId::UNKNOWN && r.relation != Relation::StrictSubtype
        {
            Ternary::TRUE
        } else {
            let actual = get_type_of_source_property(self);
            self.is_related_to_ex::<REPORT>(r, actual, expected, REC_BOTH, state)
        };
        if !related.holds() {
            if REPORT {
                self.report_error(r, 2326, &[Arg::Prop(target_prop)]);
            }
            return Ternary::FALSE;
        }
        // `SymbolFlagsClassMember`: an export of a module, a namespace or an enum is not a member.
        if !skip_optional
            && sf.contains(PropFlags::OPTIONAL)
            && !tf.contains(PropFlags::OPTIONAL)
            && !matches!(target_prop.source, PropSource::Symbol(sym) if !self.is_member_symbol(sym))
        {
            if REPORT {
                let args = [Arg::Prop(target_prop), Arg::Type(source), Arg::Type(target)];
                self.report_error(r, 2327, &args);
            }
            return Ternary::FALSE;
        }
        related
    }

    /// `getDeclaringClass`
    pub(super) fn declaring_class(&self, prop: &Prop) -> Option<Sym> {
        match prop.source {
            PropSource::Symbol(sym) => self.declaring_class_of_symbol(sym),
            _ => None,
        }
    }

    /// The parent of `sym` if it is a class: `s.Parent != nil && s.Parent.Flags&SymbolFlagsClass != 0`.
    pub(super) fn declaring_class_of_symbol(&self, sym: Sym) -> Option<Sym> {
        let parent = self.files().parent_of_symbol(sym)?;
        (self.files().flags(parent).contains(SymFlags::CLASS)).then_some(parent)
    }

    /// `isValidOverrideOf`
    pub(super) fn is_valid_override_of(&mut self, source_prop: &Prop, target_prop: &Prop) -> bool {
        if source_prop.source == target_prop.source {
            return true;
        }
        let (mut sources, mut targets) = (Vec::new(), Vec::new());
        for_each_property(source_prop, &mut |p| sources.push(p));
        for_each_property(target_prop, &mut |p| targets.push(p));
        for target in targets {
            if !target.flags.contains(PropFlags::PROTECTED) {
                continue;
            }
            let Some(base_class) = self.declaring_class(target) else {
                return false;
            };
            // `isPropertyInClassDerivedFrom`
            let mut is_derived = false;
            for &source in &sources {
                let Some(source_class) = self.declaring_class(source) else {
                    continue;
                };
                let declared = self.declared_type(source_class);
                if source_class == base_class || self.has_base(declared, base_class, 0) {
                    is_derived = true;
                    break;
                }
            }
            if !is_derived {
                return false;
            }
        }
        true
    }

    /// `propertiesIdenticalTo`
    fn properties_identical_to(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        excluded: &[Atom],
    ) -> Ternary {
        if !self.is_object_type(source) || !self.is_object_type(target) {
            return Ternary::FALSE;
        }
        let (Some(sm), Some(tm)) = (self.members(source), self.members(target)) else {
            return Ternary::FALSE;
        };
        let count = |m: &Members| {
            m.shape()
                .props
                .iter()
                .filter(|p| !excluded.contains(&p.name))
                .count()
        };
        if count(&sm) != count(&tm) {
            return Ternary::FALSE;
        }
        let mut result = Ternary::TRUE;
        for sp in &sm.shape().props {
            if excluded.contains(&sp.name) {
                continue;
            }
            let Some(tp) = tm.resolved.prop(sp.name) else {
                return Ternary::FALSE;
            };
            // `compareProperties`
            let same = PropFlags::PRIVATE
                | PropFlags::PROTECTED
                | PropFlags::OPTIONAL
                | PropFlags::READONLY;
            if sp.flags & same != tp.flags & same
                || sp
                    .flags
                    .intersects(PropFlags::PRIVATE | PropFlags::PROTECTED)
                    && Self::value_declaration(sp) != Self::value_declaration(tp)
            {
                return Ternary::FALSE;
            }
            let (st, tt) = (
                self.type_of_prop_as_read(sp, sm.mapper),
                self.type_of_prop_as_read(tp, tm.mapper),
            );
            let related = self.is_related_to(r, st, tt, REC_BOTH);
            if !related.holds() {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    // ───────────────────────────── signatures ─────────────────────────────

    /// `SignatureFlagsAbstract`
    pub(super) fn is_abstract_signature(&self, sig: SigId) -> bool {
        match *self.types().sig(sig) {
            // `getDefaultConstructSignatures`, `getSignatureFromDeclaration`: of several class
            // declarations with one name the first is used.
            SigData::Construct { class, .. } | SigData::DefaultConstruct { class, .. } => self
                .files()
                .decls(class)
                .iter()
                .find_map(|&(file, decl)| match decl {
                    crate::bind::Decl::Class(c) => {
                        Some(self.hir(file)[c].flags.contains(Flags::ABSTRACT))
                    }
                    _ => None,
                })
                .unwrap_or(false),
            SigData::Decl { file, func, .. } => {
                self.hir(file)[func].flags.contains(Flags::ABSTRACT)
            }
            // `someSignature`: a union signature is abstract if the signature of some member is.
            SigData::Synth { ref of, .. } => {
                of.iter().any(|&part| self.is_abstract_signature(part))
            }
            // `cloneSignature` preserves the flags.
            SigData::WithReturn { sig, .. } => self.is_abstract_signature(sig),
        }
    }

    /// The `private` or `protected` modifier, or neither, of the constructor declaration of `sig`.
    /// `None`: it has no declaration.
    pub(super) fn constructor_accessibility(&mut self, sig: SigId) -> Option<Flags> {
        let mut sig = sig;
        for _ in 0..64 {
            match *self.types().sig(self.types().sig_origin(sig)) {
                SigData::Construct { file, func, .. } | SigData::Decl { file, func, .. } => {
                    return Some(self.hir(file)[func].flags & (Flags::PRIVATE | Flags::PROTECTED));
                }
                // `getDefaultConstructSignatures`: a clone of a signature of the base class, with
                // the same declaration.
                SigData::DefaultConstruct { base, .. } => sig = base?,
                _ => return None,
            }
        }
        None
    }

    /// `signaturesRelatedTo`
    pub(super) fn signatures_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        construct: bool,
        state: u8,
    ) -> Ternary {
        let (sd, td) = (self.data(source), self.data(target));
        self.signatures_related_to_among::<REPORT>(
            r, source, sd, target, td, construct, state, None,
        )
    }

    /// `sd`, `td`: the `TypeData` of `source` and `target`. `both`: their `members`, if known.
    #[allow(clippy::too_many_arguments)]
    fn signatures_related_to_among<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        sd: &'p TypeData,
        target: TypeId,
        td: &'p TypeData,
        construct: bool,
        state: u8,
        both: Option<(Members<'p>, Members<'p>)>,
    ) -> Ternary {
        // With respect to signatures, `anyFunctionType` is a subtype of every other function type.
        if r.relation != Relation::Identity {
            if matches!(sd, TypeData::Synth(shape) if Self::is_any_function_shape(shape)) {
                return Ternary::TRUE;
            }
            if matches!(td, TypeData::Synth(shape) if Self::is_any_function_shape(shape)) {
                return Ternary::FALSE;
            }
        }
        let (sm, tm) = match both {
            Some(both) => both,
            None => match (self.members(source), self.members(target)) {
                (Some(sm), Some(tm)) => (sm, tm),
                _ => return Ternary::FALSE,
            },
        };
        let pick = |m: &Members| {
            if construct {
                m.shape().construct.len()
            } else {
                m.shape().call.len()
            }
        };
        if r.relation == Relation::Identity && pick(&sm) != pick(&tm) {
            return Ternary::FALSE;
        }
        if pick(&tm) == 0 {
            return Ternary::TRUE;
        }
        // Whatever can be called is a `Function`.
        let list =
            |c: &mut Self, ty: TypeId, data: &TypeData, m: &Members<'p>| -> List<'p, SigId> {
                let sigs: &'p [SigId] = if construct {
                    &m.shape().construct
                } else {
                    &m.shape().call
                };
                match sigs {
                    _ if sigs.is_empty() || m.mapper == MapperId::IDENTITY => List::Kept(sigs),
                    // An object type other than a mapped one is its own reduced apparent type.
                    _ if is_object_kind(data) && !is_mapped_kind(data) => {
                        c.signatures(ty, construct)
                    }
                    [only] => List::One(c.instantiate_sig(*only, m.mapper)),
                    _ => List::Own(
                        sigs.iter()
                            .map(|&s| c.instantiate_sig(s, m.mapper))
                            .collect(),
                    ),
                }
            };
        let (source_sigs, target_sigs) = (list(self, source, sd, &sm), list(self, target, td, &tm));
        if r.relation == Relation::Identity {
            let mut result = Ternary::TRUE;
            for (&s, &t) in source_sigs.iter().zip(&target_sigs) {
                let mut is_related_to = |c: &mut Self, s, t| c.is_related_to(r, s, t, REC_BOTH);
                let related = self.compare_signatures_identical(
                    s,
                    t,
                    false,
                    false,
                    false,
                    &mut is_related_to,
                );
                if !related.holds() {
                    return Ternary::FALSE;
                }
                result &= related;
            }
            return result;
        }
        if construct && !source_sigs.is_empty() {
            // Or an abstract class could be instantiated.
            if self.is_abstract_signature(source_sigs[0])
                && !self.is_abstract_signature(target_sigs[0])
            {
                if REPORT {
                    self.report_error(r, 2517, &[]);
                }
                return Ternary::FALSE;
            }
            // `constructorVisibilitiesAreCompatible`
            if let (Some(s), Some(t)) = (
                self.constructor_accessibility(source_sigs[0]),
                self.constructor_accessibility(target_sigs[0]),
            ) {
                let compatible = t == Flags::PRIVATE
                    || t == Flags::PROTECTED && s != Flags::PRIVATE
                    || t != Flags::PROTECTED && s.is_empty();
                if !compatible {
                    if REPORT {
                        let args = [s, t].map(|flags| Arg::Bytes(visibility_to_string(flags)));
                        self.report_error(r, 2672, &args);
                    }
                    return Ternary::FALSE;
                }
            }
        }
        let mut result = Ternary::TRUE;
        // `ObjectFlagsInstantiated`: not the declared type.
        let is_instantiated =
            |c: &Self, mapper: MapperId| c.types().mapping(mapper).iter().any(|p| p.0 != p.1);
        let same_origin = match (sd, td) {
            (
                TypeData::Anon {
                    origin: a,
                    mapper: s,
                },
                TypeData::Anon {
                    origin: b,
                    mapper: t,
                },
            ) => a == b && is_instantiated(self, *s) && is_instantiated(self, *t),
            (
                TypeData::Fns {
                    decls: a,
                    mapper: s,
                },
                TypeData::Fns {
                    decls: b,
                    mapper: t,
                },
            ) => a == b && is_instantiated(self, *s) && is_instantiated(self, *t),
            (TypeData::Ref { target: a, .. }, TypeData::Ref { target: b, .. }) => a == b,
            _ => false,
        };
        if same_origin && source_sigs.len() == target_sigs.len() {
            // Instantiations of one type: signature by signature. Their type parameters are the same.
            for (&s, &t) in source_sigs.iter().zip(&target_sigs) {
                let related = self.signature_related_to::<REPORT>(r, s, t, true, construct, state);
                if !related.holds() {
                    return Ternary::FALSE;
                }
                result &= related;
            }
        } else if source_sigs.len() == 1 && target_sigs.len() == 1 {
            // A generic source is instantiated in the context of the target. With more signatures that would cost too much.
            result = self.signature_related_to::<REPORT>(
                r,
                source_sigs[0],
                target_sigs[0],
                r.relation == Relation::Comparable,
                construct,
                state,
            );
        } else {
            'targets: for &t in &target_sigs {
                let saved = REPORT.then(|| r.get_error_state());
                // Only the failure of the first is elaborated.
                let mut should_elaborate = REPORT;
                for &s in &source_sigs {
                    let related = if REPORT && should_elaborate {
                        self.signature_related_to::<true>(r, s, t, true, construct, state)
                    } else {
                        self.signature_related_to::<false>(r, s, t, true, construct, state)
                    };
                    if related.holds() {
                        result &= related;
                        if let Some(saved) = &saved {
                            r.restore_error_state(saved);
                        }
                        continue 'targets;
                    }
                    should_elaborate = false;
                }
                if REPORT && should_elaborate {
                    self.report_error(r, 2658, &[Arg::Type(source), Arg::Sig(t)]);
                }
                return Ternary::FALSE;
            }
        }
        result
    }

    /// `signatureRelatedTo`. `construct`: selects the `incompatibleReporter` passed to it.
    fn signature_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: SigId,
        target: SigId,
        erase: bool,
        construct: bool,
        state: u8,
    ) -> Ternary {
        let check_mode = match r.relation {
            Relation::Subtype => STRICT_TOP_SIGNATURE,
            Relation::StrictSubtype => STRICT_TOP_SIGNATURE | STRICT_ARITY,
            _ => 0,
        };
        let check_mode = if REPORT && construct {
            check_mode | CONSTRUCT_SIGNATURE
        } else {
            check_mode
        };
        let (actual, expected) = (source, target);
        let (source, target) = if erase {
            (self.erased_sig(source), self.erased_sig(target))
        } else {
            (source, target)
        };
        self.compare_signatures_related::<REPORT>(
            r,
            source,
            target,
            (actual, expected),
            check_mode,
            state,
        )
    }

    /// With every type parameter of its own replaced by `any`. `getErasedSignature`
    pub fn erased_sig(&mut self, sig: SigId) -> SigId {
        let params = self.sig_type_params(sig);
        if params.is_empty() {
            return sig;
        }
        let anys: SmallVec<[TypeId; 8]> = SmallVec::from_elem(TypeId::ANY, params.len());
        self.with_own_type_params(sig, &params, &anys)
    }

    /// `sig` with its own type parameters `params` replaced by `values`, and nothing else: the type
    /// arguments already substituted for its outer type parameters may mention the same
    /// declarations (`then` of the return type of `then`), but refer to other instances.
    pub(super) fn with_own_type_params(
        &mut self,
        sig: SigId,
        params: &[TypeId],
        values: &[TypeId],
    ) -> SigId {
        let extended = |c: &mut Self, own: MapperId| {
            let mut pairs = c.types().mapping(own).to_vec();
            for (&param, &value) in params.iter().zip(values) {
                // In an instantiation it is a clone, represented by the declared one
                // (`cloneTypeParameter`). A mapper has one pair for a parameter, so the order of
                // the pairs does not matter.
                let declared = match *c.data(param) {
                    TypeData::TypeParam(file, tp, around) if around != MapperId::IDENTITY => {
                        let declared = c.type_param(file, tp);
                        pairs.iter().position(|pair| *pair == (declared, param))
                    }
                    _ => None,
                };
                match declared {
                    Some(i) => pairs[i].1 = value,
                    None => pairs.push((param, value)),
                }
            }
            c.types().mapper(pairs)
        };
        let data = match *self.types().sig(sig) {
            SigData::Decl { file, func, mapper } => SigData::Decl {
                file,
                func,
                mapper: extended(self, mapper),
            },
            SigData::Construct {
                class,
                file,
                func,
                mapper,
            } => SigData::Construct {
                class,
                file,
                func,
                mapper: extended(self, mapper),
            },
            // `cloneSignature`: the same signature, with its return type carried over.
            SigData::WithReturn { sig: inner, ret } => {
                let inner = self.with_own_type_params(inner, params, values);
                let mapper = self.mapper_from(params, values);
                SigData::WithReturn {
                    sig: inner,
                    ret: self.instantiate(ret, mapper),
                }
            }
            _ => {
                let mapper = self.mapper_from(params, values);
                return self.instantiate_sig(sig, mapper);
            }
        };
        self.types().intern_sig(data)
    }

    /// `isTopSignature`: `(...args: any[]) => any`, `(...args: never) => unknown`: signatures that
    /// every function matches.
    pub(super) fn is_top_signature(&mut self, sig: SigId) -> bool {
        if !self.sig_type_params(sig).is_empty()
            || self.sig_this_type(sig).is_some_and(|t| !self.is_any(t))
        {
            return false;
        }
        let params = self.sig_params(sig);
        let [only] = &params[..] else { return false };
        if !only.rest {
            return false;
        }
        let rest = self.array_element(only.ty).unwrap_or(only.ty);
        if !self.has_any_flag(rest) && !rest.is_never() {
            return false;
        }
        let ret = self.sig_return(sig);
        self.has_any_flag(ret) || ret == TypeId::UNKNOWN
    }

    /// `isInstantiatedGenericParameter`. `target`: `Signature.target` of `sig`, once it has been
    /// requested.
    fn is_instantiated_generic_parameter_of(
        &mut self,
        target: &mut Option<Option<SigId>>,
        sig: SigId,
        index: usize,
    ) -> bool {
        let declared = match *target {
            Some(known) => known,
            None => {
                let found = self.sig_instantiated_from(sig);
                *target = Some(found);
                found
            }
        };
        let Some(declared) = declared else {
            return false;
        };
        let params = self.sig_params(declared);
        self.param_type_at(&params, index)
            .is_some_and(|ty| self.is_generic(ty))
    }

    /// The declared signature that `sig` is an instantiation of.
    fn sig_instantiated_from(&mut self, sig: SigId) -> Option<SigId> {
        // `cloneSignature` preserves the target.
        let sig = self.types().sig_origin(sig);
        let (file, func, _) = self.sig_decl(sig)?;
        let declared = self.sig_of_fn(file, func);
        (declared != sig).then_some(declared)
    }

    /// `elementInfos` of the tuple type of the rest parameter, if it has one.
    fn rest_tuple(&self, params: &[SigParam]) -> Option<&'p [ElemFlags]> {
        let last = params.last().filter(|p| p.rest)?;
        match self.data(last.ty) {
            TypeData::Tuple { flags, .. } => Some(flags),
            _ => None,
        }
    }

    pub(super) fn fixed_length(flags: &[ElemFlags]) -> usize {
        flags
            .iter()
            .position(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
            .unwrap_or(flags.len())
    }

    /// `getParameterCount`: a rest parameter counts as one, a rest parameter of tuple type as its
    /// number of elements.
    pub(super) fn parameter_count(&self, params: &[SigParam]) -> usize {
        match self.rest_tuple(params) {
            Some(flags) => {
                let fixed = Self::fixed_length(flags);
                params.len() + fixed - usize::from(fixed == flags.len())
            }
            None => params.len(),
        }
    }

    /// `hasEffectiveRestParameter`
    pub(super) fn has_effective_rest_parameter(&self, params: &[SigParam]) -> bool {
        match params.last() {
            Some(last) if last.rest => self
                .rest_tuple(params)
                .is_none_or(|flags| Self::fixed_length(flags) != flags.len()),
            _ => false,
        }
    }

    /// `getMinArgumentCount`
    pub(super) fn min_argument_count(&mut self, params: &[SigParam]) -> usize {
        let mut count = None;
        if let Some(flags) = self.rest_tuple(params) {
            let required = flags
                .iter()
                .position(|f| !f.contains(ElemFlags::REQUIRED))
                .unwrap_or_else(|| Self::fixed_length(flags));
            if required > 0 {
                count = Some(params.len() - 1 + required);
            }
        }
        let mut count = count.unwrap_or_else(|| Self::min_args(params));
        // Trailing parameters that accept `void` are optional.
        while count > 0 {
            let ty = match params.get(count - 1) {
                Some(param) if !param.rest => param.ty,
                _ => self.param_type_at(params, count - 1).unwrap_or(TypeId::ANY),
            };
            if !self.some_type(ty, |_, m| m == TypeId::VOID) {
                break;
            }
            count -= 1;
        }
        count
    }

    /// `getEffectiveRestType`
    pub(super) fn effective_rest_type(&mut self, params: &[SigParam]) -> Option<TypeId> {
        let last = params.last().filter(|p| p.rest)?;
        match self.data(last.ty) {
            TypeData::Tuple { flags, .. } => {
                let elems = self.type_arguments(last.ty);
                let fixed = Self::fixed_length(flags);
                (fixed != flags.len()).then(|| self.tuple(&elems[fixed..], &flags[fixed..], false))
            }
            _ if self.is_any(last.ty) => Some(self.array_of(TypeId::ANY)),
            _ => Some(last.ty),
        }
    }

    /// `getNonArrayRestType`
    pub(super) fn non_array_rest_type(&mut self, params: &[SigParam]) -> Option<TypeId> {
        self.effective_rest_type(params)
            .filter(|&rest| !self.is_array(rest) && !self.is_any(rest))
    }

    /// `getRestOrAnyTypeAtPosition`
    pub(super) fn rest_or_any_type_at_position(
        &mut self,
        params: &[SigParam],
        pos: usize,
    ) -> TypeId {
        let rest = self.rest_type_at_position(params, pos, false);
        match self.array_element(rest) {
            Some(element) if self.is_any(element) => TypeId::ANY,
            _ => rest,
        }
    }

    /// `compareSignaturesRelated`. `as_passed`: the two signatures before type parameter erasure.
    pub(super) fn compare_signatures_related<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: SigId,
        target: SigId,
        as_passed: (SigId, SigId),
        check_mode: u8,
        state: u8,
    ) -> Ternary {
        if source == target {
            return Ternary::TRUE;
        }
        let strict_top = check_mode & STRICT_TOP_SIGNATURE != 0;
        let (source_is_top, target_is_top) = (
            strict_top && self.is_top_signature(source),
            self.is_top_signature(target),
        );
        if !source_is_top && target_is_top {
            return Ternary::TRUE;
        }
        if source_is_top && !target_is_top {
            return Ternary::FALSE;
        }
        let mut source = source;
        let tp = self.sig_params(target);
        let target_count = self.parameter_count(&tp);
        {
            let sp = self.sig_params(source);
            let source_has_more_parameters = !self.has_effective_rest_parameter(&tp)
                && if check_mode & STRICT_ARITY != 0 {
                    self.has_effective_rest_parameter(&sp)
                        || self.parameter_count(&sp) > target_count
                } else {
                    self.min_argument_count(&sp) > target_count
                };
            if source_has_more_parameters {
                if REPORT && check_mode & STRICT_ARITY == 0 {
                    let least = self.min_argument_count(&sp);
                    self.report_error(r, 2849, &[Arg::Number(least), Arg::Number(target_count)]);
                }
                return Ternary::FALSE;
            }
        }
        let source_type_params = self.sig_type_params(source);
        if !source_type_params.is_empty() && source_type_params != self.sig_type_params(target) {
            source = self.instantiate_sig_in_context(source, target, true);
        }
        let sp = self.sig_params(source);
        let source_count = self.parameter_count(&sp);
        let (source_rest, target_rest) =
            (self.non_array_rest_type(&sp), self.non_array_rest_type(&tp));
        if let Some(rest) = source_rest.or(target_rest) {
            self.report_unreliable(rest);
        }
        // Method parameters are compared bivariantly, all other parameters contravariantly.
        let is_method = match self.sig_decl(target) {
            Some((file, func, _)) => matches!(
                self.hir(file)[func].kind,
                FnKind::Method | FnKind::Constructor
            ),
            None => false,
        };
        let strict_variance =
            check_mode & CALLBACK == 0 && self.p.files.options.strict_function_types && !is_method;
        let mut result = Ternary::TRUE;
        if let Some(source_this) = self.sig_this_type(source)
            && source_this != TypeId::VOID
            && let Some(target_this) = self.sig_this_type(target)
        {
            let mut related = if strict_variance {
                Ternary::FALSE
            } else {
                self.is_related_to_ex::<false>(r, source_this, target_this, REC_BOTH, state)
            };
            if !related.holds() {
                related =
                    self.is_related_to_ex::<REPORT>(r, target_this, source_this, REC_BOTH, state);
            }
            if !related.holds() {
                if REPORT {
                    self.report_error(r, 2685, &[]);
                }
                return Ternary::FALSE;
            }
            result &= related;
        }
        let has_rest = source_rest.is_some() || target_rest.is_some();
        let param_count = if has_rest {
            source_count.min(target_count)
        } else {
            source_count.max(target_count)
        };
        let rest_index = if has_rest {
            param_count.checked_sub(1)
        } else {
            None
        };
        let mut actual_from = (None, None);
        for i in 0..param_count {
            let (source_type, target_type) = if Some(i) == rest_index {
                (
                    Some(self.rest_or_any_type_at_position(&sp, i)),
                    Some(self.rest_or_any_type_at_position(&tp, i)),
                )
            } else {
                (self.param_type_at(&sp, i), self.param_type_at(&tp, i))
            };
            let (Some(source_type), Some(target_type)) = (source_type, target_type) else {
                continue;
            };
            if source_type == target_type && check_mode & STRICT_ARITY == 0 {
                continue;
            }
            // Parameters are compared bivariantly, so that `Foo<T>` is at least covariant in `T`
            // however it uses it. Two callback parameters are compared signature to signature in
            // the reverse direction: the parameters of a callback are outputs, like a return value.
            // That keeps `Promise<T>` covariant and not bivariant.
            let mut callbacks = None;
            if check_mode & CALLBACK == 0
                && !self.is_instantiated_generic_parameter_of(&mut actual_from.0, as_passed.0, i)
                && !self.is_instantiated_generic_parameter_of(&mut actual_from.1, as_passed.1, i)
            {
                let nullish = |c: &Self, ty: TypeId| {
                    (
                        c.some_type(ty, |_, m| m.is_undefined()),
                        c.some_type(ty, |_, m| m.is_null()),
                    )
                };
                if nullish(self, source_type) == nullish(self, target_type) {
                    let (a, b) = (
                        self.non_nullable(source_type),
                        self.non_nullable(target_type),
                    );
                    if let (Some(a), Some(b)) = (
                        self.single_call_signature(a, false),
                        self.single_call_signature(b, false),
                    ) && self.sig_predicate(a).is_none()
                        && self.sig_predicate(b).is_none()
                    {
                        callbacks = Some((a, b));
                    }
                }
            }
            let mut related = match callbacks {
                Some((source_sig, target_sig)) => {
                    let mode = check_mode & STRICT_ARITY
                        | if strict_variance {
                            STRICT_CALLBACK
                        } else {
                            BIVARIANT_CALLBACK
                        };
                    self.compare_signatures_related::<REPORT>(
                        r,
                        target_sig,
                        source_sig,
                        (target_sig, source_sig),
                        mode,
                        state,
                    )
                }
                None => {
                    let mut related = if check_mode & CALLBACK == 0 && !strict_variance {
                        self.is_related_to_ex::<false>(r, source_type, target_type, REC_BOTH, state)
                    } else {
                        Ternary::FALSE
                    };
                    if !related.holds() {
                        related = self.is_related_to_ex::<REPORT>(
                            r,
                            target_type,
                            source_type,
                            REC_BOTH,
                            state,
                        );
                    }
                    related
                }
            };
            // `(x: number | undefined) => void` is a subtype of `(x?: number | undefined) => void`, and not the other way round.
            if related.holds()
                && check_mode & STRICT_ARITY != 0
                && i >= self.min_argument_count(&sp)
                && i < self.min_argument_count(&tp)
                && self
                    .is_related_to_ex::<false>(r, source_type, target_type, REC_BOTH, state)
                    .holds()
            {
                related = Ternary::FALSE;
            }
            if !related.holds() {
                if REPORT {
                    let names = [
                        Arg::Atom(self.labeled_parameter_name_at_position(source, &sp, i)),
                        Arg::Atom(self.labeled_parameter_name_at_position(target, &tp, i)),
                    ];
                    self.report_error(r, 2328, &names);
                }
                return Ternary::FALSE;
            }
            result &= related;
        }
        if check_mode & IGNORE_RETURN_TYPES != 0 {
            return result;
        }
        // A return type whose resolution is in progress is provisionally `any`, and no error is
        // reported for that.
        let target_return = if self.is_resolving_return_type(target) {
            TypeId::ANY
        } else {
            self.sig_return(target)
        };
        if target_return == TypeId::VOID || target_return == TypeId::ANY {
            return result;
        }
        let source_return = if self.is_resolving_return_type(source) {
            TypeId::ANY
        } else {
            self.sig_return(source)
        };
        if let Some(expected) = self.sig_predicate(target) {
            match self.sig_predicate(source) {
                Some(actual) => {
                    result &= self.compare_type_predicate_related_to::<REPORT>(
                        r,
                        (&actual, &sp[..]),
                        (&expected, &tp[..]),
                        state,
                    );
                }
                // Only a type predicate is related to a target that has a type predicate.
                None if !expected.asserts => {
                    if REPORT {
                        self.report_error(r, 1224, &[Arg::Sig(source)]);
                    }
                    return Ternary::FALSE;
                }
                None => {}
            }
        } else {
            // The return types of callbacks are compared bivariantly too, or `interface Foo<T> {
            // add(cb: () => T): void }` would not be covariant in `T`.
            let mut related = if check_mode & BIVARIANT_CALLBACK != 0 {
                self.is_related_to_ex::<false>(r, target_return, source_return, REC_BOTH, state)
            } else {
                Ternary::FALSE
            };
            if !related.holds() {
                related = self.is_related_to_ex::<REPORT>(
                    r,
                    source_return,
                    target_return,
                    REC_BOTH,
                    state,
                );
            }
            result &= related;
            // `incompatibleErrorReporter`
            if REPORT && !result.holds() {
                let construct = check_mode & CONSTRUCT_SIGNATURE != 0;
                let marker = match (sp.is_empty() && tp.is_empty(), construct) {
                    (true, true) => 2205,
                    (true, false) => 2204,
                    (false, true) => 2203,
                    (false, false) => 2202,
                };
                self.report_error(r, marker, &[]);
            }
        }
        result
    }

    /// `compareTypePredicateRelatedTo`. Each predicate comes with the parameters of its signature.
    fn compare_type_predicate_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: (&super::decl::Predicate, &[SigParam]),
        target: (&super::decl::Predicate, &[SigParam]),
        state: u8,
    ) -> Ternary {
        let (actual, expected) = (source.0, target.0);
        let mut related = Ternary::FALSE;
        if (actual.asserts, actual.param.is_none()) != (expected.asserts, expected.param.is_none())
        {
            if REPORT {
                self.report_error(r, 2518, &[]);
            }
        } else if actual.param != expected.param {
            if REPORT {
                let names = [
                    Arg::Atom(self.parameter_name_at_position(source.1, actual.param.unwrap_or(0))),
                    Arg::Atom(
                        self.parameter_name_at_position(target.1, expected.param.unwrap_or(0)),
                    ),
                ];
                self.report_error(r, 1227, &names);
            }
        } else {
            related = match (actual.ty, expected.ty) {
                (a, b) if a == b => Ternary::TRUE,
                (Some(a), Some(b)) => self.is_related_to_ex::<REPORT>(r, a, b, REC_BOTH, state),
                _ => Ternary::FALSE,
            };
        }
        if REPORT && !related.holds() {
            let actual = self.type_predicate_text(actual, source.1);
            let expected = self.type_predicate_text(expected, target.1);
            self.report_error(r, 1226, &[Arg::Bytes(&actual), Arg::Bytes(&expected)]);
        }
        related
    }

    // ───────────────────────────── index signatures ─────────────────────────────

    /// `indexSignaturesRelatedTo`
    pub(super) fn index_signatures_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        source_is_primitive: bool,
        state: u8,
    ) -> Ternary {
        self.index_signatures_related_to_among::<REPORT>(
            r,
            source,
            target,
            source_is_primitive,
            state,
            None,
        )
    }

    /// `both`: the `members` of `source` and of `target`, if known.
    fn index_signatures_related_to_among<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        source_is_primitive: bool,
        state: u8,
        both: Option<(Members<'p>, Members<'p>)>,
    ) -> Ternary {
        let tm = match both {
            Some((_, tm)) => tm,
            None => match self.members(target) {
                Some(tm) => tm,
                None => return Ternary::FALSE,
            },
        };
        if r.relation == Relation::Identity {
            // `indexSignaturesIdenticalTo`
            let Some(sm) = self.members(source) else {
                return Ternary::FALSE;
            };
            if sm.shape().index.len() != tm.shape().index.len() {
                return Ternary::FALSE;
            }
            for info in &tm.shape().index {
                let Some(other) = sm.shape().index.iter().find(|i| i.key == info.key) else {
                    return Ternary::FALSE;
                };
                let (s, t) = (
                    self.instantiate(other.value, sm.mapper),
                    self.instantiate(info.value, tm.mapper),
                );
                if other.readonly != info.readonly || !self.is_related_to(r, s, t, REC_BOTH).holds()
                {
                    return Ternary::FALSE;
                }
            }
            return Ternary::TRUE;
        }
        if tm.shape().index.is_empty() {
            return Ternary::TRUE;
        }
        let target_has_string_index = tm.shape().index.iter().any(|i| i.key == TypeId::STRING);
        let mut result = Ternary::TRUE;
        for info in &tm.shape().index {
            let expected = self.instantiate(info.value, tm.mapper);
            let related = if r.relation != Relation::StrictSubtype
                && !source_is_primitive
                && target_has_string_index
                && self.is_any(expected)
            {
                Ternary::TRUE
            } else if target_has_string_index && self.is_generic_mapped_type(source) {
                let template = self.mapped_template(source);
                self.is_related_to_ex::<REPORT>(r, template, expected, REC_BOTH, STATE_NONE)
            } else {
                self.type_related_to_index_info::<REPORT>(r, source, info.key, expected, state)
            };
            if !related.holds() {
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    /// `typeRelatedToIndexInfo`
    fn type_related_to_index_info<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        key: TypeId,
        expected: TypeId,
        state: u8,
    ) -> Ternary {
        let Some(sm) = self.members(source) else {
            return Ternary::FALSE;
        };
        if let Some(actual) = self.applicable_index_info(&sm, key).map(|info| info.value) {
            // `getApplicableIndexInfo`: the index signature with the same key type, or else the
            // string index signature.
            let source_key = if !REPORT || sm.shape().index.iter().any(|i| i.key == key) {
                key
            } else {
                TypeId::STRING
            };
            let (source, target) = ((source_key, actual), (key, expected));
            return self.index_info_related_to::<REPORT>(r, source, target, state);
        }
        // A constituent of an intersection never gets an implicit index signature from its
        // properties. Under the strict subtype relation only a fresh object literal does, so that
        // `{ [x: string]: X }` is a strict subtype of `{}` and not also the reverse.
        if state & STATE_SOURCE == 0
            && (r.relation != Relation::StrictSubtype || self.is_fresh_object_literal_type(source))
        {
            let looks = self.apparent_type_of_intersection(source);
            if self.is_object_type_with_inferable_index(looks) {
                return self.members_related_to_index_info::<REPORT>(r, &sm, key, expected, state);
            }
        }
        if REPORT {
            self.report_error(r, 2329, &[Arg::Type(key), Arg::Type(source)]);
        }
        Ternary::FALSE
    }

    /// `indexInfoRelatedTo`. Each index signature is its key type and its value type.
    fn index_info_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: (TypeId, TypeId),
        target: (TypeId, TypeId),
        state: u8,
    ) -> Ternary {
        // `getRegularTypeOfObjectLiteral` leaves the index signatures unchanged.
        let state = state & !STATE_REGULAR;
        let related = self.is_related_to_ex::<REPORT>(r, source.1, target.1, REC_BOTH, state);
        if REPORT && !related.holds() {
            if source.0 == target.0 {
                self.report_error(r, 2634, &[Arg::Type(source.0)]);
            } else {
                self.report_error(r, 2330, &[Arg::Type(source.0), Arg::Type(target.0)]);
            }
        }
        related
    }

    /// `getApparentTypeOfIntersectionType`: the intersection of the apparent types of the members
    /// of `ty`. `apparent_type` returns an intersection whose members all have object apparent
    /// types unchanged, and `members` builds its shape from those apparent types.
    /// `getTypeWithThisArgument` also replaces a member that is a reference with a `this` type. The
    /// new reference prints like the old one, and the new intersection has no alias.
    pub(super) fn apparent_type_of_intersection(&mut self, ty: TypeId) -> TypeId {
        let TypeData::Intersection(parts) = self.data(ty) else {
            return ty;
        };
        if !parts.iter().any(|&p| {
            self.intersection_member_has_other_apparent_type(p) || self.takes_this_argument(p)
        }) {
            return ty;
        }
        let looks: Vec<TypeId> = parts
            .iter()
            .map(|&p| {
                if self.intersection_member_has_other_apparent_type(p) {
                    self.apparent_type(p)
                } else {
                    p
                }
            })
            .collect();
        self.intersection(&looks)
    }

    /// Whether `apparent_type_of_intersection` replaces the member `p` by another type.
    fn intersection_member_has_other_apparent_type(&self, p: TypeId) -> bool {
        p == TypeId::OBJECT || self.is_deferred(p) || self.has_primitive_flag(p)
    }

    /// Whether `getApparentType(ty)` is `emptyObjectType`, which is the apparent type of `object`.
    /// It has no symbol, unlike a `{}` in the source, and here the two are one type. Of the types
    /// that count as `{}` in an intersection `addTypeToIntersection` keeps the first.
    pub(super) fn is_object_keyword_like(&mut self, ty: TypeId) -> bool {
        let ty = if self.is_deferred(ty) {
            self.base_constraint(ty)
        } else {
            ty
        };
        let TypeData::Intersection(parts) = self.data(ty) else {
            return ty == TypeId::OBJECT
                || ty == TypeId::UNKNOWN && !self.p.files.options.strict_null_checks;
        };
        let mut first = None;
        for &p in parts.iter() {
            let look = if p == TypeId::OBJECT || self.is_deferred(p) {
                self.apparent_type(p)
            } else {
                p
            };
            if look == TypeId::EMPTY_OBJECT {
                first = first.or(Some(p));
            } else if look != TypeId::UNKNOWN {
                return false;
            }
        }
        first.is_some_and(|p| self.is_object_keyword_like(p))
    }

    /// `isObjectTypeWithInferableIndex`: known to have no properties other than the visible ones.
    pub(super) fn is_object_type_with_inferable_index(&mut self, t: TypeId) -> bool {
        match self.data(t) {
            // It has no symbol.
            TypeData::Synth(shape)
                if matches!(
                    shape.literal,
                    Literalness::OfUnknown | Literalness::AutoArray | Literalness::OfLiteralKeyof
                ) =>
            {
                false
            }
            TypeData::Intersection(parts) => parts
                .iter()
                .all(|&p| self.is_object_type_with_inferable_index(p)),
            // `cloneTypeAsModuleType`: its symbol has the flags of the imported symbol, and the
            // signatures are dropped.
            TypeData::Anon {
                origin: Origin::Namespace { module, .. },
                ..
            } => {
                let flags = self.files().flags(*module);
                flags.intersects(SymFlags::ENUM | SymFlags::VALUE_MODULE)
                    && !flags.contains(SymFlags::CLASS)
            }
            // Determined by its source type.
            TypeData::ReverseMapped { source, .. } => {
                self.is_object_type_with_inferable_index(*source)
            }
            TypeData::Anon {
                origin:
                    Origin::ObjectLiteral(..)
                    | Origin::WidenedLiteral(..)
                    | Origin::TypeLiteral(..)
                    | Origin::Mapped(..)
                    | Origin::EnumObject(_)
                    | Origin::Module(_)
                    | Origin::GlobalThis,
                ..
            }
            | TypeData::Synth(_) => !self.has_call_or_construct_signatures(t),
            _ => false,
        }
    }

    /// `isApplicableIndexType`, for the name of a property.
    pub(super) fn is_name_applicable_to_index(&mut self, name: Atom, key: TypeId) -> bool {
        if self.atoms().is_symbol_name(name) {
            return key == TypeId::SYMBOL;
        }
        if key == TypeId::STRING {
            return true;
        }
        if key == TypeId::NUMBER {
            return self.is_numeric_name(name);
        }
        if key == TypeId::SYMBOL {
            return false;
        }
        let literal = self.string_literal(name, false);
        self.is_assignable(literal, key)
    }

    /// `membersRelatedToIndexInfo`
    fn members_related_to_index_info<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        sm: &Members,
        key: TypeId,
        expected: TypeId,
        state: u8,
    ) -> Ternary {
        let mut result = Ternary::TRUE;
        let is_jsx = sm.shape().literal == Literalness::JsxAttributes;
        for prop in &sm.shape().props {
            // `isIgnoredJsxProperty`
            if is_jsx && self.atoms().bytes(prop.name).contains(&b'-') {
                continue;
            }
            if !self.is_name_applicable_to_index(prop.name, key) {
                continue;
            }
            // An optional property is compared with the index signature by its type when present.
            let declared = self.type_of_prop_as_read(prop, sm.mapper);
            let actual = if self.p.files.options.exact_optional_property_types
                || declared.is_undefined()
                || key == TypeId::NUMBER
                || !prop.flags.contains(PropFlags::OPTIONAL)
            {
                declared
            } else {
                self.without_undefined(declared)
            };
            let related = self.is_related_to_ex::<REPORT>(r, actual, expected, REC_BOTH, state);
            if !related.holds() {
                if REPORT {
                    self.report_error(r, 2530, &[Arg::Prop(prop)]);
                }
                return Ternary::FALSE;
            }
            result &= related;
        }
        for info in &sm.shape().index {
            // `isApplicableIndexType`
            let applies = info.key == key
                || key == TypeId::STRING && info.key != TypeId::SYMBOL
                || key == TypeId::NUMBER && self.is_numeric_string_type(info.key)
                || self.is_assignable(info.key, key);
            if applies {
                let actual = self.instantiate(info.value, sm.mapper);
                let (source, target) = ((info.key, actual), (key, expected));
                let related = self.index_info_related_to::<REPORT>(r, source, target, state);
                if !related.holds() {
                    return Ternary::FALSE;
                }
                result &= related;
            }
        }
        result
    }

    // ───────────────────────────── pattern literal types ─────────────────────────────

    /// `templateLiteralTypesDefinitelyUnrelated`: they start or end differently.
    fn templates_definitely_unrelated(&self, source: &[Atom], target: &[Atom]) -> bool {
        let atoms = &self.atoms();
        let (ss, ts) = (atoms.bytes(source[0]), atoms.bytes(target[0]));
        let (se, te) = (
            atoms.bytes(source[source.len() - 1]),
            atoms.bytes(target[target.len() - 1]),
        );
        let (start, end) = (ss.len().min(ts.len()), se.len().min(te.len()));
        ss[..start] != ts[..start] || se[se.len() - end..] != te[te.len() - end..]
    }

    /// `isTypeMatchedByTemplateLiteralType`
    pub(super) fn is_type_matched_by_template_literal_type(
        &mut self,
        source: TypeId,
        texts: &[Atom],
        types: &[TypeId],
    ) -> bool {
        let Some(inferences) = self.infer_types_from_template_literal_type(source, texts, types)
        else {
            return false;
        };
        inferences.into_iter().zip(types).all(|(inference, &t)| {
            self.is_valid_type_for_template_literal_placeholder(inference, t)
        })
    }

    /// `inferTypesFromTemplateLiteralType`
    pub(super) fn infer_types_from_template_literal_type(
        &mut self,
        source: TypeId,
        texts: &[Atom],
        types: &[TypeId],
    ) -> Option<Vec<TypeId>> {
        match self.data(source) {
            // `TypeFlagsStringLiteral`, which a string enum member has too.
            TypeData::StringLit { value, .. }
            | TypeData::EnumLit {
                value: EnumValue::String(value),
                ..
            } => self.infer_from_literal_parts_to_template_literal(&[*value], &[], texts),
            TypeData::Template {
                texts: st,
                types: sy,
            } if st[..] == *texts => {
                let mut pieces = Vec::with_capacity(sy.len());
                for (&s, &t) in sy.iter().zip(types) {
                    let (sb, tb) = (self.constraint_or_self(s), self.constraint_or_self(t));
                    // An `infer` in a template represents a substring, though it declares no such
                    // constraint.
                    let tb = if tb == TypeId::UNKNOWN {
                        TypeId::STRING
                    } else {
                        tb
                    };
                    pieces.push(
                        if self.is_assignable(sb, tb)
                            || self.is_any(s)
                            || self.every_type(s, Self::is_string_like)
                        {
                            s
                        } else {
                            let empty = self.atoms().intern(b"");
                            self.template_type(&[empty, empty], &[s])
                        },
                    );
                }
                Some(pieces)
            }
            TypeData::Template {
                texts: st,
                types: sy,
            } => self.infer_from_literal_parts_to_template_literal(st, sy, texts),
            _ => None,
        }
    }

    /// `isMemberOfStringMapping`
    fn is_member_of_string_mapping(&mut self, source: TypeId, target: TypeId) -> bool {
        match *self.data(target) {
            _ if self.is_any(target) => true,
            TypeData::Intrinsic(Intrinsic::String) | TypeData::Template { .. } => {
                self.is_assignable(source, target)
            }
            TypeData::StringMapping { .. } => {
                // Applying the same string mappings leaves it unchanged, and it is related to the
                // type that is mapped.
                let (mapped, inner) = self.apply_target_string_mapping_to_source(source, target);
                mapped == source && self.is_member_of_string_mapping(source, inner)
            }
            _ => false,
        }
    }

    fn apply_target_string_mapping_to_source(
        &mut self,
        source: TypeId,
        target: TypeId,
    ) -> (TypeId, TypeId) {
        let TypeData::StringMapping { kind, ty } = *self.data(target) else {
            return (source, target);
        };
        let (mut source, mut inner) = (source, ty);
        if matches!(self.data(inner), TypeData::StringMapping { .. }) {
            (source, inner) = self.apply_target_string_mapping_to_source(source, inner);
        }
        (self.string_mapping(kind, source), inner)
    }

    /// `inferFromLiteralPartsToTemplateLiteral`
    fn infer_from_literal_parts_to_template_literal(
        &mut self,
        texts: &[Atom],
        types: &[TypeId],
        target_texts: &[Atom],
    ) -> Option<Vec<TypeId>> {
        let atoms = &self.atoms();
        let last_source = texts.len() - 1;
        let last_target = target_texts.len() - 1;
        let (start, end) = (atoms.bytes(texts[0]), atoms.bytes(texts[last_source]));
        let (target_start, target_end) = (
            atoms.bytes(target_texts[0]),
            atoms.bytes(target_texts[last_target]),
        );
        if (last_source == 0 && start.len() < target_start.len() + target_end.len())
            || !start.starts_with(target_start)
            || !end.ends_with(target_end)
        {
            return None;
        }
        let remaining_end = &end[..end.len() - target_end.len()];
        let text_of = |index: usize| {
            if index < last_source {
                atoms.bytes(texts[index])
            } else {
                remaining_end
            }
        };
        // (from segment, from position, to segment, to position)
        let mut spans: Vec<(usize, usize, usize, usize)> = Vec::with_capacity(last_target);
        let (mut seg, mut pos) = (0, target_start.len());
        for &delimiter in &target_texts[1..last_target.max(1)] {
            let delimiter = atoms.bytes(delimiter);
            let (s, p) = if !delimiter.is_empty() {
                let (mut s, mut p) = (seg, pos);
                loop {
                    let text = text_of(s);
                    if let Some(at) = text
                        .get(p..)
                        .and_then(|rest| bun_core::strings::index_of(rest, delimiter))
                    {
                        p += at;
                        break;
                    }
                    s += 1;
                    if s == texts.len() {
                        return None;
                    }
                    p = 0;
                }
                (s, p)
            } else if pos < text_of(seg).len() {
                let first_byte = text_of(seg)[pos];
                (
                    seg,
                    pos + usize::from(bun_core::strings::wtf8_byte_sequence_length(first_byte)),
                )
            } else if seg < last_source {
                (seg + 1, 0)
            } else {
                return None;
            };
            spans.push((seg, pos, s, p));
            seg = s;
            pos = p + delimiter.len();
        }
        spans.push((seg, pos, last_source, text_of(last_source).len()));
        let mut pieces = Vec::with_capacity(spans.len());
        for (from, at, to, until) in spans {
            if from == to {
                let literal = atoms.intern(text_of(from).get(at..until)?);
                pieces.push(self.string_literal(literal, false));
                continue;
            }
            let mut piece_texts = Vec::with_capacity(to - from + 1);
            piece_texts.push(atoms.intern(atoms.bytes(texts[from]).get(at..)?));
            piece_texts.extend_from_slice(&texts[from + 1..to]);
            piece_texts.push(atoms.intern(text_of(to).get(..until)?));
            pieces.push(self.template_type(&piece_texts, &types[from..to]));
        }
        Some(pieces)
    }

    fn constraint_or_self(&mut self, ty: TypeId) -> TypeId {
        if self.is_deferred(ty) {
            self.base_constraint(ty)
        } else {
            ty
        }
    }

    /// `isValidTypeForTemplateLiteralPlaceholder`
    pub(super) fn is_valid_type_for_template_literal_placeholder(
        &mut self,
        piece: TypeId,
        hole: TypeId,
    ) -> bool {
        if let TypeData::Intersection(parts) = self.data(hole) {
            return parts.iter().all(|&p| {
                p == TypeId::EMPTY_OBJECT
                    || self.is_valid_type_for_template_literal_placeholder(piece, p)
            });
        }
        if hole == TypeId::STRING || self.is_assignable(piece, hole) {
            return true;
        }
        match self.data(piece) {
            TypeData::StringLit { value, .. } => {
                let text = self.atoms().bytes(*value);
                match self.data(hole) {
                    TypeData::Intrinsic(Intrinsic::Number) => is_valid_number_string(text),
                    TypeData::Intrinsic(Intrinsic::BigInt) => is_valid_bigint_string(text),
                    TypeData::BoolLit { value, .. } => {
                        text == if *value { &b"true"[..] } else { &b"false"[..] }
                    }
                    _ if hole.is_undefined() => text == b"undefined",
                    _ if hole.is_null() => text == b"null",
                    // A string mapping or a template literal type that it is a member of accepts it
                    // as is, which was checked above.
                    _ => false,
                }
            }
            TypeData::Template { texts, types } => {
                texts.len() == 2
                    && texts.iter().all(|&t| self.atoms().bytes(t).is_empty())
                    && self.is_assignable(types[0], hole)
            }
            _ => false,
        }
    }
}

/// `forEachProperty`: a property of an intersection represents the properties of the constituents,
/// any other property itself.
pub(super) fn for_each_property<'a>(prop: &'a Prop, callback: &mut impl FnMut(&'a Prop)) {
    match &prop.source {
        PropSource::Intersected(_, parts) => parts
            .iter()
            .for_each(|part| for_each_property(part, callback)),
        _ => callback(prop),
    }
}

/// `isValidNumberString(s, false)`: `Number(s)` is a number, and not an infinite one (`jsnum.FromString`).
fn is_valid_number_string(s: &[u8]) -> bool {
    if s.is_empty() {
        return false;
    }
    let Ok(s) = std::str::from_utf8(s) else {
        return false;
    };
    // `isStrWhiteSpace`: NEL is white space to Rust and not to JavaScript, the byte order mark the other way round.
    let s = s.trim_matches(|c: char| c.is_whitespace() && c != '\u{85}' || c == '\u{feff}');
    // `Number(" ")` is 0.
    if s.is_empty() {
        return true;
    }
    if let Some(digits) = s.get(2..)
        && s.as_bytes()[0] == b'0'
    {
        let radix: u32 = match s.as_bytes()[1] | 0x20 {
            b'x' => 16,
            b'o' => 8,
            b'b' => 2,
            _ => 0,
        };
        if radix != 0 {
            let value = digits.chars().try_fold(0f64, |value, c| {
                c.to_digit(radix)
                    .map(|digit| value * f64::from(radix) + f64::from(digit))
            });
            return !digits.is_empty() && value.is_some_and(f64::is_finite);
        }
    }
    bun_core::fmt::parse_f64(s.as_bytes()).is_some_and(f64::is_finite)
}

/// `isValidBigIntString(s, false)`: with an `n` after it, it is scanned as a bigint literal without separators, or `-` and one.
fn is_valid_bigint_string(s: &[u8]) -> bool {
    match s.strip_prefix(b"-").unwrap_or(s) {
        [] => false,
        [b'0'] => true,
        [b'0', prefix, digits @ ..] => {
            let radix: u32 = match prefix | 0x20 {
                b'x' => 16,
                b'o' => 8,
                b'b' => 2,
                // A decimal literal does not start with a zero.
                _ => return false,
            };
            !digits.is_empty() && digits.iter().all(|&b| char::from(b).is_digit(radix))
        }
        digits => digits.iter().all(u8::is_ascii_digit),
    }
}
