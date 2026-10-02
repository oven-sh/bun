//! Whether a value of one type can be used where another is expected.
//!
//! Follows `internal/checker/relater.go` of TypeScript 7.0.2 function by function. The names in `backticks` at the head of
//! a function are the ones there. `REPORT` is `reportErrors`. What only serves error messages is in `explain_relation.rs`. Left out:
//! `isEmptyArrayLiteralType` (the type of `[]` is not told from a `never[]` that is written).
//! A type does not remember the alias it was written with: `alias_of` tells from where its syntax stands.

use super::explain::Related;
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
    /// A subtype, and no less specific: what unions are reduced with.
    StrictSubtype = 1,
    /// Might be the same value: what `===` and casts allow.
    Comparable = 2,
    /// Assignable for some choice of the type parameters.
    Permissive = 3,
    Subtype = 4,
    Identity = 5,
    /// Assignable whatever the type parameters are, whatever they are declared to extend.
    Restrictive = 6,
}

impl Relation {
    /// `relation == assignableRelation || relation == comparableRelation`
    pub(super) fn is_lenient(self) -> bool {
        matches!(
            self,
            Relation::Assignable
                | Relation::Comparable
                | Relation::Permissive
                | Relation::Restrictive
        )
    }

    pub(super) fn is_subtype(self) -> bool {
        matches!(self, Relation::Subtype | Relation::StrictSubtype)
    }
}

/// `Maybe`: on the assumption that a comparison under way comes out true. `Unknown`: while a variance is being measured.
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
/// The source is a part of an intersection.
pub(super) const STATE_SOURCE: u8 = 1;
/// The target is a part of an intersection.
pub(super) const STATE_TARGET: u8 = 2;
/// The source is an object literal that has been looked over for properties nobody asked for.
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
pub(super) type Key = (TypeId, TypeId, u8);

/// Flag of a `Key` for two generic type references. The two ids of such a key are the halves of a hash.
const GENERIC_KEY: u8 = 0x80;

/// The state of `keyBuilder.writeGenericTypeReferences`.
struct GenericKeyBuilder {
    hasher: FxHasher,
    /// The type parameters written by index so far. The source and the target share the list.
    type_params: [TypeId; 8],
    type_param_count: usize,
    /// A constrained type parameter was written by id.
    constrained: bool,
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

/// The variables that `structuredTypeRelatedToWorker` shares with its closure `relateVariances`. The last two are looked at with
/// `reportErrors` only.
#[derive(Default)]
struct WorkerState {
    variance_check_failed: bool,
    original_error_chain: Chain,
    save_error_state: ErrorState,
}

/// What one question, with all the questions it leads to, keeps track of.
pub(super) struct Relater {
    pub(super) relation: Relation,
    /// The two types `check_type_related_to` was called with. `NEVER` in a relater created elsewhere.
    top_source: TypeId,
    top_target: TypeId,
    /// The comparisons under way and those that came out true on the assumption that they do.
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
    /// `related` has been through its own rules with `top_source` and `top_target`: no simple rule relates them, and they are
    /// not an object type and a primitive. The first comparison takes it.
    is_from_related: bool,
    /// The key under which `related` has found nothing kept of `top_source` and `top_target`, with its `constrained`. The
    /// first comparison that needs a key takes it.
    top_key: Option<(Key, bool)>,
    relation_count: i32,
    /// `Checker::cycles` when the question was asked. Once it has moved, nothing found out holds for others.
    cycles: u64,
    steps: u32,
    /// What fails is remembered in `failed` and not in the table: in a run with reports (P2), and in the run without reports that goes
    /// before one where tsgo makes none (`check_type_related_to_ex`), which is to leave the table as tsgo's run finds it.
    pub(super) keeps_failures: bool,
    failed: FxHashSet<Key>,
    /// `errorNode`. An end of `0`: with the token there. It and what follows are looked at with `reportErrors` only.
    pub(super) error_node: Place,
    /// `headMessage` of the first comparison, which takes it.
    pub(super) head_message: Option<u32>,
    /// `errorChain`
    pub(super) error_chain: Chain,
    /// `relatedInfo`
    pub(super) related_info: Vec<Related>,
    /// The two types asked about, if one of them is written as an alias that is not the name it is compared under.
    pub(super) named_otherwise: Option<(TypeId, TypeId)>,
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
            is_from_related: false,
            top_key: None,
            relation_count: 2_000_000,
            cycles,
            steps: 0,
            keeps_failures: false,
            failed: FxHashSet::default(),
            error_node: (FileId(0), 0, 0),
            head_message: None,
            error_chain: None,
            related_info: Vec::new(),
            named_otherwise: None,
        }
    }
}

/// Where `getPropertyOfType` looks for what a type does not have itself: the global types that every function and every object is
/// one of.
pub(super) struct Inherited<'p> {
    globals: [Atom; 3],
    count: usize,
    /// What the first `asked` of `globals` have.
    members: [Option<Members<'p>>; 3],
    asked: usize,
}

/// What instantiations of one declaration have in common.
pub(super) type RecursionId = (u8, u32, u32);

/// In place of a `RecursionId`: whether the type has a given one takes more than a comparison to tell.
const NOT_PLAIN: RecursionId = (u8::MAX, 0, 0);

// The kinds of types, for whoever has the `TypeData` at hand.

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
                | Intrinsic::Unknown
                | Intrinsic::Never
                | Intrinsic::SilentNever
                | Intrinsic::UnreachableNever
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

/// `normalized` gives a type of this kind back as it is.
#[inline]
fn is_normalized_kind(data: &TypeData) -> bool {
    match data {
        TypeData::Union(_)
        | TypeData::Intersection(_)
        | TypeData::IndexedAccess { .. }
        | TypeData::Cond { .. }
        | TypeData::LazyAlias { .. }
        | TypeData::Substitution { .. } => false,
        TypeData::Tuple { .. } => !is_generic_tuple_kind(data),
        _ => !is_fresh_literal_kind(data),
    }
}

impl<'p> Checker<'p> {
    pub fn is_assignable(&mut self, source: TypeId, target: TypeId) -> bool {
        self.related(source, target, Relation::Assignable)
    }

    /// `isTypeAssignableTo` of the `getPermissiveInstantiation` of both. `getObjectTypeInstantiation` maps the type parameters around a
    /// type, not those of a generic signature in it: a type that mentions none from around it is its own instantiation.
    pub fn is_assignable_permissive(&mut self, source: TypeId, target: TypeId) -> bool {
        let relation = if self.has_type_variables(source) || self.has_type_variables(target) {
            Relation::Permissive
        } else {
            Relation::Assignable
        };
        self.related(source, target, relation)
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

    // ───────────────────────────── kinds of types, as the relation sees them ─────────────────────────────

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

    /// `force`, and what the result is.
    #[inline]
    fn forced_as(&mut self, ty: TypeId) -> (TypeId, &'p TypeData) {
        let data = self.data(ty);
        if matches!(data, TypeData::LazyAlias { .. }) {
            let ty = self.force(ty);
            return (ty, self.data(ty));
        }
        (ty, data)
    }

    /// `TypeId::plain`, and what the result is. `data`: what `ty` is.
    #[inline]
    fn plain_as(&self, ty: TypeId, data: &'p TypeData) -> (TypeId, &'p TypeData) {
        let plain = ty.plain();
        if plain == ty {
            (ty, data)
        } else {
            (plain, self.data(plain))
        }
    }

    /// A literal type as an annotation would name it, and what the result is. `data`: what `ty` is.
    #[inline]
    fn regular_as(&self, ty: TypeId, data: &'p TypeData) -> (TypeId, &'p TypeData) {
        if is_fresh_literal_kind(data) {
            let ty = self.with_freshness(ty, false);
            return (ty, self.data(ty));
        }
        (ty, data)
    }

    /// `normalized`, and what the result is. `data`: what `ty` is.
    #[inline]
    fn normalized_as(
        &mut self,
        ty: TypeId,
        data: &'p TypeData,
        writing: bool,
    ) -> (TypeId, &'p TypeData) {
        if is_normalized_kind(data) {
            return (ty, data);
        }
        if let TypeData::Union(parts) = data
            && self.has_no_intersection(ty, parts)
        {
            return (ty, data);
        }
        let normalized = self.normalized(ty, writing);
        if normalized == ty {
            return (ty, data);
        }
        (normalized, self.data(normalized))
    }

    /// The enum a member belongs to; an enum is its own.
    pub(super) fn enum_of(&self, symbol: Sym) -> Sym {
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
            .contains(SymFlags::ENUM)
            .then_some(*alias)
    }

    /// `data`: what `ty` is.
    #[inline]
    fn is_definitely_non_nullable_as(&self, ty: TypeId, data: &TypeData) -> bool {
        (self.has_primitive_flag_as(ty, data) && !self.is_nullish(ty))
            || is_object_kind(data)
            || ty == TypeId::OBJECT
    }

    /// `TypeFlagsSingleton`
    fn is_singleton(&self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::Intrinsic(_) | TypeData::UnresolvedName { .. }
        ) || self.is_boolean(ty)
    }

    /// What has to be the same for two types to be identical, before anything is looked into. The kinds of `undefined` have the
    /// same flags, and so have those of `null`.
    fn flags_for_identity(&self, ty: TypeId) -> u32 {
        match self.data(ty.plain()) {
            // `TypeFlagsAny`
            TypeData::Intrinsic(
                Intrinsic::Error | Intrinsic::Auto | Intrinsic::IntrinsicMarker,
            )
            | TypeData::UnresolvedName { .. } => Intrinsic::Any as u32,
            // `TypeFlagsNever`
            TypeData::Intrinsic(Intrinsic::SilentNever | Intrinsic::UnreachableNever) => {
                Intrinsic::Never as u32
            }
            TypeData::Intrinsic(i) => *i as u32,
            TypeData::StringLit { .. } => 32,
            TypeData::NumberLit { .. } => 33,
            TypeData::BigIntLit { .. } => 34,
            TypeData::BoolLit { .. } => 35,
            TypeData::EnumLit { .. } => 36,
            TypeData::Enum { .. } => 37,
            TypeData::UniqueSymbol { .. } => 38,
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_) => 39,
            // `TypeFlagsBoolean | TypeFlagsUnion`
            TypeData::Union(_) if self.is_boolean(ty) => 48,
            TypeData::Union(_) => 40,
            TypeData::Intersection(_) => 41,
            TypeData::Cond { .. } => 42,
            TypeData::IndexedAccess { .. } => 43,
            TypeData::Keyof(_) => 44,
            TypeData::Template { .. } => 45,
            TypeData::StringMapping { .. } => 46,
            _ => 47,
        }
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

    /// `isEmptyResolvedType` of what `ty` has.
    fn has_nothing(&mut self, ty: TypeId) -> bool {
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
                    && self.has_nothing(ty)
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
                shape.literal == Literalness::SyntheticDefault || self.has_nothing(ty)
            }
            TypeData::Anon {
                origin:
                    Origin::TypeLiteral(..) | Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..),
                ..
            } => self.has_nothing(ty),
            _ => false,
        }
    }

    /// `isUnknownLikeUnionType`: `undefined | null | {}`. `parts`: the members of the union.
    fn is_unknown_like_union(&mut self, parts: &[TypeId]) -> bool {
        if !self.p.files.options.strict_null_checks || parts.len() < 3 {
            return false;
        }
        // Members are in the order of their ids, and few ids are lower than those of the kinds of `undefined` and of `null`.
        let (mut has_undefined, mut has_null) = (false, false);
        for p in parts.iter().take_while(|p| **p <= TypeId::NULL_DECLARED) {
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

    /// `getNonMissingTypeOfSymbol`: the type of a property as it is compared. `undefined` is in it when it can be left out, unless
    /// exactOptionalPropertyTypes tells the two apart.
    pub(super) fn type_of_prop_as_read(&mut self, prop: &Prop, mapper: MapperId) -> TypeId {
        let ty = self.type_of_prop(prop, mapper);
        if !prop.flags.contains(PropFlags::OPTIONAL) {
            ty
        } else if self.p.files.options.exact_optional_property_types {
            self.remove_missing_type(ty, true)
        } else {
            self.optional_kept(ty)
        }
    }

    /// `optional`. It is kept where `union` goes by nothing but what the members are.
    fn optional_kept(&mut self, ty: TypeId) -> TypeId {
        if let Some(known) = self.p.optional_types.get(&ty) {
            return known;
        }
        let optional = self.optional(ty);
        let asks_something = self.parts(ty).iter().any(|&p| {
            matches!(
                self.data(p),
                TypeData::Intersection(_)
                    | TypeData::Template { .. }
                    | TypeData::StringMapping { .. }
            )
        });
        if !asks_something {
            self.p.optional_types.insert(ty, optional);
        }
        optional
    }

    /// `getTypeOfSymbol` of a property: with what stands for its being left out.
    fn type_of_prop_with_missing(&mut self, prop: &Prop, mapper: MapperId) -> TypeId {
        let ty = self.type_of_prop(prop, mapper);
        if prop.flags.contains(PropFlags::OPTIONAL) {
            self.optional_property(ty)
        } else {
            ty
        }
    }

    /// `getPropertyOfType`: what every function and every object has counts.
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

    /// `property_in`, for one name after the other. `inherited`: `inherited_of` the shape of `members`.
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
            asked: 0,
        }
    }

    /// `global_ref` without type arguments.
    #[inline]
    fn plain_global_ref(&mut self, name: Atom) -> TypeId {
        if let Some(known) = self.p.plain_global_refs.get(&name) {
            return known;
        }
        let global = self.global_ref(name, &[]);
        self.p.plain_global_refs.insert(name, global)
    }

    fn inherited_property(
        &mut self,
        from: &mut Inherited<'p>,
        name: Atom,
    ) -> Option<(&'p Prop, MapperId)> {
        for i in 0..from.count {
            if i == from.asked {
                let global = self.plain_global_ref(from.globals[i]);
                from.members[i] = self.members(global);
                from.asked += 1;
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
        if relation == Relation::Restrictive
            && self.restrictive_operands.last() != Some(&(source, target))
        {
            self.restrictive_operands.push((source, target));
            let result = self.related(source, target, relation);
            self.restrictive_operands.pop();
            return result;
        }
        // `getPermissiveInstantiation` of the two replaces the type parameters of the signatures around as well.
        if relation == Relation::Permissive && !self.own_of_compared_sigs.is_empty() {
            let around = std::mem::take(&mut self.own_of_compared_sigs);
            let result = self.related(source, target, relation);
            self.own_of_compared_sigs = around;
            return result;
        }
        let is_stack_low = self.is_stack_low();
        if is_stack_low {
            self.guard("related");
        }
        // A question asked while a type is being simplified passes no `enter`: what does not end has to be cut off here too.
        if self.is_out_of_time() || is_stack_low {
            self.gave_up();
            return false;
        }
        let ((source, sd), (target, td)) = (self.forced_as(source), self.forced_as(target));
        // Every rule goes by the flags, which the kinds of `undefined` and of `null` share.
        let ((source, sd), (target, td)) = (self.plain_as(source, sd), self.plain_as(target, td));
        let ((source, sd), (target, td)) =
            (self.regular_as(source, sd), self.regular_as(target, td));
        if source == target {
            return true;
        }
        if relation != Relation::Identity {
            if relation == Relation::Comparable
                && !target.is_never()
                && self.is_simple_type_related_to(target, td, source, sd, relation)
                || self.is_simple_type_related_to(source, sd, target, td, relation)
            {
                return true;
            }
        } else if !(self.may_simplify(source) || self.may_simplify(target)) {
            if self.flags_for_identity(source) != self.flags_for_identity(target) {
                return false;
            }
            if self.is_singleton(source) {
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
        if !self.retracing && is_object_kind(sd) && is_object_kind(td) {
            let key = self.relation_key_as(source, sd, target, td, relation, STATE_NONE);
            if let Some(entry) = self.p.relations.get(&key.0) {
                // The cache is shared between threads, so another thread measuring the same symbol may have stored this
                // comparison already. Without its flags the variances would lack `UNMEASURABLE` or `UNRELIABLE`.
                if is_marker_comparison {
                    self.reliability |= entry & (REPORTS_UNMEASURABLE | REPORTS_UNRELIABLE);
                }
                // The comparison of these two types was cut short when it was made.
                if entry & COMPLEXITY_OVERFLOW != 0 {
                    self.relation_gave_up = true;
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

    fn may_simplify(&self, ty: TypeId) -> bool {
        matches!(
            self.data(ty),
            TypeData::Union(_)
                | TypeData::Intersection(_)
                | TypeData::IndexedAccess { .. }
                | TypeData::Cond { .. }
                | TypeData::Substitution { .. }
        )
    }

    /// `checkTypeRelatedToEx`, without the errors. `relation_too_complex` tells the caller to report 2859.
    /// `related` has found no simple rule for the two. `missed`: the key under which it has found nothing kept, if it looked.
    /// `is_trial`: see `Relater::keeps_failures`.
    fn check_type_related_to(
        &mut self,
        source: TypeId,
        target: TypeId,
        relation: Relation,
        missed: Option<(Key, bool)>,
        is_trial: bool,
    ) -> bool {
        let mut r = self
            .free_relaters
            .pop()
            .unwrap_or_else(|| Relater::new(relation, self.cycles));
        r.relation = relation;
        r.top_source = source;
        r.top_target = target;
        r.relation_count = 2_000_000;
        r.cycles = self.cycles;
        r.steps = 0;
        // Under the identity relation `related` goes by other rules.
        r.is_from_related = relation != Relation::Identity;
        r.top_key = missed;
        r.keeps_failures = is_trial;
        let result = self.is_related_to_ex::<false>(&mut r, source, target, REC_BOTH, STATE_NONE);
        if r.steps > 20_000 && self.trace_slow_relations {
            let mut describer = crate::describe::Describer::new(self);
            let (a, b) = (describer.describe(source), describer.describe(target));
            eprintln!(
                "SLOW {} steps, {relation:?}, in variance {}: {:.150} TO {:.150}",
                r.steps, self.in_variance_computation, a, b
            );
        }
        let overflow = r.overflow;
        // `relationCount <= 0`. Running out of nesting depth, native stack or time is not a complexity overflow.
        let is_too_complex =
            overflow && r.relation_count <= 0 && self.cycles == r.cycles && !self.timed_out();
        let hit_cached_overflow = r.hit_cached_overflow;
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
            r.keeps_failures = false;
            r.failed.clear();
        }
        self.free_relaters.push(r);
        if is_too_complex {
            // Recorded as failed so that the comparison is not attempted again.
            let (key, _) = self.relation_key(source, target, relation, STATE_NONE, false);
            self.p.relations.insert(key, FAILED | COMPLEXITY_OVERFLOW);
            self.relation_too_complex = true;
        } else if hit_cached_overflow && !overflow && !result.holds() {
            // `reportRelationError`: the overflow replaces the relation error only if it was recorded for `source` and `target`.
            let (key, _) = self.relation_key(source, target, relation, STATE_NONE, false);
            if self
                .p
                .relations
                .get(&key)
                .is_some_and(|entry| entry & COMPLEXITY_OVERFLOW != 0)
            {
                self.relation_too_complex = true;
            }
        }
        if overflow {
            self.relation_gave_up = true;
            return false;
        }
        result.holds()
    }

    /// `isSimpleTypeRelatedTo`. `sd`, `td`: what `s` and `t` are.
    #[inline]
    fn is_simple_type_related_to(
        &mut self,
        s: TypeId,
        sd: &'p TypeData,
        t: TypeId,
        td: &'p TypeData,
        relation: Relation,
    ) -> bool {
        // But for the wildcard, no rule has an object type on both sides.
        if is_object_kind(sd) && is_object_kind(td) && relation != Relation::Permissive {
            return false;
        }
        self.is_simple_type_related_to_by_rule(s, sd, t, td, relation)
    }

    /// The rules of `is_simple_type_related_to`.
    fn is_simple_type_related_to_by_rule(
        &mut self,
        s: TypeId,
        sd: &'p TypeData,
        t: TypeId,
        td: &'p TypeData,
        relation: Relation,
    ) -> bool {
        // It goes by the flags, which the kinds of `undefined` and of `null` share.
        let ((s, sd), (t, td)) = (self.plain_as(s, sd), self.plain_as(t, td));
        if self.is_any(t) || s.is_never() || s == TypeId::UNRESOLVED {
            return true;
        }
        // The wildcard the permissive instantiation puts for type parameters, and for what is worked out from one.
        if relation == Relation::Permissive
            && (self.is_permissive_wildcard(s, 0) || self.is_permissive_wildcard(t, 0))
        {
            return true;
        }
        if t == TypeId::UNKNOWN && !(relation == Relation::StrictSubtype && self.has_any_flag(s)) {
            return true;
        }
        if t.is_never() {
            return false;
        }
        // `TypeFlagsStringLike` and so on.
        let is_like = match t {
            TypeId::STRING => matches!(
                sd,
                TypeData::Intrinsic(Intrinsic::String)
                    | TypeData::StringLit { .. }
                    | TypeData::Template { .. }
                    | TypeData::StringMapping { .. }
                    | TypeData::EnumLit {
                        value: EnumValue::String(_),
                        ..
                    }
            ),
            TypeId::NUMBER => matches!(
                sd,
                TypeData::Intrinsic(Intrinsic::Number)
                    | TypeData::NumberLit { .. }
                    | TypeData::EnumLit {
                        value: EnumValue::Number(_),
                        ..
                    }
                    | TypeData::Enum { .. }
            ),
            TypeId::BIGINT => matches!(
                sd,
                TypeData::Intrinsic(Intrinsic::BigInt) | TypeData::BigIntLit { .. }
            ),
            _ if self.is_boolean(t) => matches!(sd, TypeData::BoolLit { .. }),
            TypeId::SYMBOL => matches!(
                sd,
                TypeData::Intrinsic(Intrinsic::Symbol) | TypeData::UniqueSymbol { .. }
            ),
            _ => false,
        };
        if is_like {
            return true;
        }
        match (sd, td) {
            (
                TypeData::EnumLit {
                    value: EnumValue::String(a),
                    ..
                },
                TypeData::StringLit { value: b, .. },
            ) if a == b => return true,
            (
                TypeData::EnumLit {
                    value: EnumValue::Number(a),
                    ..
                },
                TypeData::NumberLit { bits: b, .. },
            ) if a == b => return true,
            // Two computed members, or two enums without members, go by the same name. A literal member is no computed one.
            (TypeData::Enum { symbol: a, .. }, TypeData::Enum { symbol: b, .. })
                if self.files().symbol(*a).name == self.files().symbol(*b).name =>
            {
                let (a, b) = (self.enum_of(*a), self.enum_of(*b));
                if self.is_enum_type_related_to(a, b) {
                    return true;
                }
            }
            (
                TypeData::EnumLit {
                    member: a,
                    value: av,
                    ..
                },
                TypeData::EnumLit {
                    member: b,
                    value: bv,
                    ..
                },
            ) if av == bv => {
                let (a, b) = (self.enum_of(*a), self.enum_of(*b));
                if self.is_enum_type_related_to(a, b) {
                    return true;
                }
            }
            (TypeData::Union(_), TypeData::Union(_)) => {
                if let (Some(a), Some(b)) = (self.union_enum_symbol(s), self.union_enum_symbol(t))
                    && self.is_enum_type_related_to(a, b)
                {
                    return true;
                }
            }
            _ => {}
        }
        let strict = self.p.files.options.strict_null_checks;
        if s == TypeId::UNDEFINED
            && (!strict && !is_union_or_intersection_kind(td)
                || t == TypeId::UNDEFINED
                || t == TypeId::VOID)
        {
            return true;
        }
        if s == TypeId::NULL && (!strict && !is_union_or_intersection_kind(td) || t == TypeId::NULL)
        {
            return true;
        }
        if t == TypeId::OBJECT
            && is_object_kind(sd)
            && !(relation == Relation::StrictSubtype
                && !self.is_fresh_object_literal_type(s)
                && self.is_empty_anonymous_object_type(s))
        {
            return true;
        }
        if relation.is_lenient() {
            if self.has_any_flag(s) {
                return true;
            }
            // So that enums can be used as bit flags.
            match (sd, td) {
                (
                    TypeData::Intrinsic(Intrinsic::Number),
                    TypeData::Enum { .. }
                    | TypeData::EnumLit {
                        value: EnumValue::Number(_),
                        ..
                    },
                ) => return true,
                (TypeData::NumberLit { .. }, TypeData::Enum { .. }) => return true,
                (
                    TypeData::NumberLit { bits, .. },
                    TypeData::EnumLit {
                        value: EnumValue::Number(v),
                        ..
                    },
                ) if bits == v => return true,
                _ => {}
            }
            if let TypeData::Union(parts) = td
                && self.is_unknown_like_union(parts)
            {
                return true;
            }
        }
        false
    }

    /// What `getPermissiveInstantiation` makes the wildcard of: a type parameter, and what is worked out from one. `T[K]`,
    /// `keyof T`, a conditional type that checks it or checks against it, a mapped type over it, a union or an intersection with
    /// it, a template literal type with it. Not a string mapping: `Uppercase<any>` is a type of its own.
    /// `depth`: how far `ty` is inside the type that is instantiated.
    fn is_permissive_wildcard(&mut self, ty: TypeId, depth: u32) -> bool {
        if !self.has_type_variables(ty) {
            return false;
        }
        // tsgo has no depth limit. Past this one the answer is unknown, and a wildcard never makes a comparison definitely false.
        if depth > 8 {
            return true;
        }
        match *self.data(ty) {
            // `getObjectTypeInstantiation` maps the type parameters around a type. Those of a generic signature in it stay.
            TypeData::TypeParam(..) => !self.own_of_compared_sigs.contains(&ty),
            TypeData::ThisParam(_) | TypeData::Marker(_) => true,
            // `getTemplateLiteralType`. `getPermissiveInstantiation` returns a primitive unchanged, and a template literal type is one.
            TypeData::Template { ref types, .. } => {
                depth > 0
                    && types
                        .iter()
                        .any(|&t| self.is_permissive_wildcard(t, depth + 1))
            }
            TypeData::IndexedAccess { obj, index, .. } => {
                self.is_permissive_wildcard(obj, depth + 1)
                    || self.is_permissive_wildcard(index, depth + 1)
            }
            TypeData::Keyof(of) | TypeData::Substitution { base: of, .. } => {
                self.is_permissive_wildcard(of, depth + 1)
            }
            TypeData::Cond { .. } => {
                let (check, extends) = (self.cond_check(ty), self.cond_extends(ty));
                self.is_permissive_wildcard(check, depth + 1)
                    || self.is_permissive_wildcard(extends, depth + 1)
            }
            TypeData::Anon {
                origin: Origin::Mapped(..),
                ..
            } => {
                let keys = self.mapped_keys(ty);
                self.is_permissive_wildcard(keys, depth + 1)
            }
            TypeData::Union(_) | TypeData::Intersection(_) => self
                .constituents(ty)
                .iter()
                .any(|&p| self.is_permissive_wildcard(p, depth + 1)),
            _ => false,
        }
    }

    /// `isTypeIdenticalTo`, of two parts of permissive instantiations. The wildcard has the flags of `any`, which is what the identity
    /// relation goes by.
    fn is_identical_with_wildcards(&mut self, a: TypeId, b: TypeId) -> bool {
        let (mut open, mut seen) = (Vec::new(), FxHashSet::default());
        if !self.collect_open_type_params(a, &mut open, &mut seen)
            || !self.collect_open_type_params(b, &mut open, &mut seen)
        {
            return true;
        }
        let wildcards = self
            .p
            .types
            .mapper(open.into_iter().map(|param| (param, TypeId::ANY)).collect());
        let (a, b) = (
            self.instantiate(a, wildcards),
            self.instantiate(b, wildcards),
        );
        self.is_identical(a, b)
    }

    /// Adds the type parameters in `ty` that `is_permissive_wildcard` takes for wildcards to `open`. `false`: something in `ty` is
    /// worked out from one, or it cannot be told. The wildcard makes a wildcard of that, `any` something else.
    fn collect_open_type_params(
        &self,
        ty: TypeId,
        open: &mut Vec<TypeId>,
        seen: &mut FxHashSet<TypeId>,
    ) -> bool {
        if !self.has_type_variables(ty) || !seen.insert(ty) {
            return true;
        }
        match self.data(ty) {
            TypeData::TypeParam(..) | TypeData::ThisParam(_) => {
                if !self.own_of_compared_sigs.contains(&ty) {
                    open.push(ty);
                }
                true
            }
            TypeData::Union(types)
            | TypeData::Intersection(types)
            | TypeData::Ref { args: types, .. }
            | TypeData::Tuple { elems: types, .. } => types
                .iter()
                .all(|&t| self.collect_open_type_params(t, open, seen)),
            TypeData::Anon {
                origin: Origin::Mapped(..),
                ..
            } => false,
            TypeData::Anon { mapper, .. } | TypeData::Fns { mapper, .. } => self
                .p
                .types
                .mapping(*mapper)
                .iter()
                .all(|pair| self.collect_open_type_params(pair.1, open, seen)),
            _ => false,
        }
    }

    /// `isEnumTypeRelatedTo`: two declarations of what is by all appearances the same enum.
    fn is_enum_type_related_to(&mut self, source: Sym, target: Sym) -> bool {
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
            // What a namespace merged with the enum exports is no member of it.
            if !self.files().flags(member).contains(SymFlags::ENUM_MEMBER) {
                continue;
            }
            let Some(&(_, other)) = theirs.iter().find(|(n, _)| *n == name) else {
                return false;
            };
            if !self.files().flags(other).contains(SymFlags::ENUM_MEMBER) {
                return false;
            }
            let (a, b) = (self.enum_member_type(member), self.enum_member_type(other));
            let value = |c: &Self, ty: TypeId| match c.data(ty) {
                TypeData::EnumLit { value, .. } => Some(*value),
                _ => None,
            };
            match (value(self, a), value(self, b)) {
                (Some(a), Some(b)) if a != b => return false,
                // `NaN` differs from itself.
                (Some(EnumValue::Number(bits)), Some(_)) if f64::from_bits(bits).is_nan() => {
                    return false;
                }
                (Some(EnumValue::String(_)), None) | (None, Some(EnumValue::String(_))) => {
                    return false;
                }
                _ => {}
            }
        }
        true
    }

    // ───────────────────────────── simpler forms ─────────────────────────────

    /// `getNormalizedType`
    pub(super) fn normalized(&mut self, ty: TypeId, writing: bool) -> TypeId {
        let mut t = ty;
        loop {
            let n = match self.data(t) {
                // Only an intersection among its members makes another type of a union.
                TypeData::Union(parts) if self.has_no_intersection(t, parts) => return t,
                TypeData::Union(_) | TypeData::Intersection(_) => {
                    self.normalized_union_or_intersection(t, writing)
                }
                TypeData::IndexedAccess { .. } | TypeData::Cond { .. } => {
                    self.simplified(t, writing)
                }
                TypeData::Tuple {
                    elems,
                    flags,
                    readonly,
                } if flags.iter().any(|f| f.contains(ElemFlags::VARIADIC)) => {
                    let simpler: SmallVec<[TypeId; 8]> =
                        elems.iter().map(|&e| self.simplified(e, writing)).collect();
                    if simpler[..] == elems[..] {
                        t
                    } else {
                        self.normalized_tuple(&simpler, flags, *readonly)
                    }
                }
                TypeData::LazyAlias { .. } => self.force(t),
                &TypeData::Substitution { base, .. } if writing => base,
                &TypeData::Substitution { base, constraint } => {
                    self.substitution_intersection(base, constraint)
                }
                // `createTypeReference(t.Target(), getTypeArguments(t))`, of a deferred type reference.
                TypeData::Ref { .. } | TypeData::Tuple { .. } => {
                    return self.without_alias_of_reference(t);
                }
                data if is_fresh_literal_kind(data) => self.with_freshness(t, false),
                _ => return t,
            };
            if n == t {
                return t;
            }
            t = n;
        }
    }

    /// Whether none of `parts`, the members of the union `t`, is an intersection.
    fn has_no_intersection(&self, t: TypeId, parts: &[TypeId]) -> bool {
        let is_intersection = |p: &TypeId| matches!(self.data(*p), TypeData::Intersection(_));
        if parts.len() < 4 {
            return !parts.iter().any(is_intersection);
        }
        if self.p.unions_without_intersections.get(&t).is_some() {
            return true;
        }
        if parts.iter().any(is_intersection) {
            return false;
        }
        self.p.unions_without_intersections.insert(t, ());
        true
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
        // An access that waits on an alias is looked into, cached or not: see `force_reference`.
        if let TypeData::IndexedAccess { obj, .. } = *self.data(t)
            && matches!(self.data(obj), TypeData::LazyAlias { .. })
        {
            self.force(obj);
        }
        if let Some(&known) = self.simplified.get(&(t, writing)) {
            return known;
        }
        let cycles_before = self.cycles;
        self.simplified.insert((t, writing), t);
        let mut result = self.simplified_indexed_access_worker(t, writing);
        if result != t {
            result = self.filter(result, |_, m| m != t);
        }
        // What is found out while the resolver runs into itself holds for nobody else.
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
        let object = self.force(obj);
        let object = self.simplified(object, writing);
        let index_ty = self.simplified(index, writing);
        // T[A | B] is T[A] | T[B] to read, T[A] & T[B] to write.
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
            // (T | U)[K] is T[K] | U[K] to read, T[K] & U[K] to write. (T & U)[K] is T[K] & U[K].
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
        // A tuple with `...T` in it, at a place that is none of the fixed ones: any of its elements for `number`, else any from the
        // first that is not fixed on. `getElementTypeOfSliceOfTupleType`
        if let TypeData::Tuple { elems, flags, .. } = self.data(object)
            && self.is_generic_tuple_type(object)
            && self.is_number_like(index_ty)
        {
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

    /// `distributeIndexOverObjectType`: (T | U)[K] is T[K] | U[K] to read, T[K] & U[K] to write. (T & U)[K] is T[K] & U[K].
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

    /// `substituteIndexedMappedType`, for a mapped type whose keys are not known yet. `None`: its `as` clause renames them
    /// (`MappedTypeNameTypeKindRemapping`).
    pub(super) fn substitute_indexed_generic_mapped(
        &mut self,
        object: TypeId,
        index: TypeId,
    ) -> Option<TypeId> {
        let (file, node, mapper) = self.mapped_origin(object)?;
        let mapped = self.mapped_decl(file, node);
        // `getMappedTypeNameTypeKind`: a name that is always the key itself, or nothing, only leaves keys out.
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
        let mut pairs = self.p.types.mapping(mapper).to_vec();
        pairs.push((param, index));
        let with_key = self.p.types.mapper(pairs);
        let template = self.type_from_node(file, mapped.ty);
        let template = self.instantiate(template, with_key);
        // Unless it says `?` itself, what it takes its modifiers from says, `-?` or not.
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
        let (check, extends) = (self.cond_check(t), self.cond_extends(t));
        let (yes, no) = (self.cond_true(t), self.cond_false(t));
        let checked = self.actual_type_variable(check);
        if no.is_never() && self.actual_type_variable(yes) == checked {
            if self.has_any_flag(check) || self.related(check, extends, Relation::Restrictive) {
                return self.simplified(yes, writing);
            }
            if self.intersection(&[check, extends]).is_never() {
                return TypeId::NEVER;
            }
        } else if yes.is_never() && self.actual_type_variable(no) == checked {
            if !self.has_any_flag(check) && self.related(check, extends, Relation::Restrictive) {
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
                self.base_constraint(t);
                if self.p.circular_constraints.get(&t).is_some() {
                    return None;
                }
                self.constraint_of_indexed_access(obj, index, undefined)
            }
            TypeData::Cond { .. } => match self.constraint_of_distributive_conditional(t) {
                Some(constraint) => Some(constraint),
                None => Some(self.default_constraint_of_conditional(t)),
            },
            _ => self.base_constraint_of(t),
        }
    }

    /// Whether `param` is the key of a mapped type inside the two types `getRestrictiveInstantiation` was called with.
    /// `getObjectTypeInstantiation` maps the type parameters around a mapped type only, so the key keeps its constraint. A key that
    /// is free in the two types is replaced like any other type parameter.
    /// Limit: the type parameters of a generic signature inside the two types keep their constraints too. They count as replaced.
    fn is_bound_mapped_key(&mut self, param: TypeId) -> bool {
        let TypeData::TypeParam(file, tp, _) = *self.data(param) else {
            return false;
        };
        let Some(&(source, target)) = self.restrictive_operands.last() else {
            return false;
        };
        self.hir(file).mapped.iter().any(|m| m.param == tp)
            && !self.references_type_variable(source, param)
            && !self.references_type_variable(target, param)
    }

    /// `getConstraintOfType`, of a part of a restrictive instantiation (`getRestrictiveInstantiation`): the type parameters it
    /// replaced extend nothing. An indexed access and a conditional type still go by what their parts extend.
    fn restrictive_constraint_of(&mut self, t: TypeId) -> Option<TypeId> {
        if self.is_bound_mapped_key(t) {
            return self.constraint_of_type_param(t);
        }
        match *self.data(t) {
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_) => None,
            TypeData::IndexedAccess {
                obj,
                index,
                undefined,
            } => {
                self.base_constraint(t);
                if self.p.circular_constraints.get(&t).is_some() {
                    return None;
                }
                if let Some(substituted) = self.substitute_indexed_mapped(obj, index) {
                    return Some(substituted);
                }
                if let Some(constraint) = self.restrictive_simplified_or_constraint(index)
                    && constraint != index
                    && let Some(access) =
                        self.indexed_access_flagged(obj, constraint, undefined, None)
                {
                    return Some(access);
                }
                if let Some(constraint) = self.restrictive_simplified_or_constraint(obj)
                    && constraint != obj
                {
                    return self.indexed_access_flagged(constraint, index, undefined, None);
                }
                None
            }
            TypeData::Cond { .. } => {
                match self.constraint_of_distributive_conditional_worker(t, true) {
                    Some(constraint) => Some(constraint),
                    None => Some(self.default_constraint_of_conditional(t)),
                }
            }
            _ => self.base_constraint_of(t),
        }
    }

    /// `getSimplifiedTypeOrConstraint`, of the same.
    fn restrictive_simplified_or_constraint(&mut self, t: TypeId) -> Option<TypeId> {
        let simplified = self.simplified(t, false);
        if simplified != t {
            Some(simplified)
        } else {
            self.restrictive_constraint_of(t)
        }
    }

    /// `getBaseConstraintOrType`, of the same: through conditional types and indexed accesses. A type parameter is its own base
    /// constraint, and so is whatever else is come to.
    fn restrictive_base_constraint_or_type(&mut self, t: TypeId) -> TypeId {
        let mut base = t;
        for _ in 0..8 {
            if !matches!(
                self.data(base),
                TypeData::Cond { .. } | TypeData::IndexedAccess { .. }
            ) {
                break;
            }
            match self.restrictive_constraint_of(base) {
                Some(constraint) if constraint != base => base = constraint,
                _ => break,
            }
        }
        base
    }

    /// `getConstraintFromIndexedAccess`. `undefined`: what the access has kept of how it was made (`accessFlags`).
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
        self.p.circular_constraints.get(&t).is_none()
    }

    /// `getBaseConstraintOfType`. `None`: there is none.
    pub(super) fn base_constraint_of(&mut self, t: TypeId) -> Option<TypeId> {
        self.base_constraint_of_as(t, false)
    }

    /// `nested`: it is `computeBaseConstraint` that asks, which hands its stack on (`getNextBaseConstraint`).
    pub(super) fn base_constraint_of_as(&mut self, t: TypeId, nested: bool) -> Option<TypeId> {
        match self.data(t) {
            TypeData::Template { texts, types } => {
                let constraints: Vec<TypeId> = types
                    .iter()
                    .map(|&ty| self.base_constraint_of_as(ty, nested).unwrap_or(ty))
                    .collect();
                // Any string, if there is no telling what some placeholder can be. One that waits for nothing is what it is.
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
            // `noConstraintType`, `circularConstraintType`: none. A union has none if some member has none, an intersection if no
            // member has one.
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

    /// `restrictive`: see `restrictive_constraint_of`.
    fn effective_constraint_of_intersection_ex(
        &mut self,
        types: &[TypeId],
        target_is_union: bool,
        restrictive: bool,
    ) -> Option<TypeId> {
        let constraint_of = |c: &mut Self, t: TypeId| {
            if restrictive {
                c.restrictive_constraint_of(t)
            } else {
                c.constraint_of(t)
            }
        };
        let mut constraints: Vec<TypeId> = Vec::new();
        let mut has_disjoint_domain_type = false;
        let is_disjoint = |c: &mut Self, t: TypeId| {
            c.has_primitive_flag(t) || t == TypeId::OBJECT || c.is_empty_anonymous_object_type(t)
        };
        for &t in types {
            if self.is_instantiable(t) {
                // As long as it is known not to go round in circles, hence not through `T[K]`.
                let mut constraint = constraint_of(self, t);
                let mut steps = 0;
                while let Some(c) = constraint
                    && (self.is_type_param(c)
                        || matches!(self.data(c), TypeData::Keyof(_) | TypeData::Cond { .. }))
                    && steps < 32
                {
                    constraint = constraint_of(self, c);
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
        let TypeData::Cond { file, node, mapper } = *self.data(t) else {
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

    /// The type parameter that is checked, if it is one on its own: the test then goes member by member.
    fn cond_distributes_over(&mut self, t: TypeId) -> Option<TypeId> {
        let (file, _, _, nodes) = self.cond_origin(t);
        let declared = self.type_from_node(file, nodes[0]);
        matches!(self.data(declared), TypeData::TypeParam(..)).then_some(declared)
    }

    /// Whether instantiating `ty` replaces the type variable `variable` anywhere in it.
    fn references_type_variable(&mut self, ty: TypeId, variable: TypeId) -> bool {
        if !self.has_type_variables(ty) {
            return false;
        }
        let probe = self.mapper_from(&[variable], &[TypeId::MARKER_OTHER]);
        // The probe belongs to no comparison, so it must not affect a variance measurement in progress.
        let reliability = self.reliability;
        let is_referenced = self.instantiate(ty, probe) != ty;
        self.reliability = reliability;
        is_referenced
    }

    /// `getInferredTrueTypeFromConditionalType`: the true branch under `combinedMapper`, that is with what `getConditionalType`
    /// inferred before it put the test off. From what waits itself nothing is inferred: what is to be inferred is then as wide
    /// as it can be.
    fn cond_inferred_true(&mut self, t: TypeId) -> TypeId {
        let params = self.cond_infer_params(t);
        let (file, _, mapper, nodes) = self.cond_origin(t);
        if params.is_empty() {
            return self.cond_true(t);
        }
        let check = self.cond_check(t);
        let check = self.force(check);
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
                && matches!(self.data(check), TypeData::Tuple { elems, .. } if elems.iter().any(|&e| self.is_generic(e)));
        let mut pairs = self.p.types.mapping(mapper).to_vec();
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
        let combined = self.p.types.mapper(pairs);
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
        if let Some(&cached) = self.cond_distributive_memo.get(&t) {
            return cached;
        }
        let cycles_before = self.cycles;
        let result = self.constraint_of_distributive_conditional_worker(t, false);
        // A result computed while a resolution cycle was hit may be incomplete, so it is not cached.
        if self.cycles == cycles_before {
            self.cond_distributive_memo.insert(t, result);
        }
        result
    }

    /// `restrictive`: see `restrictive_constraint_of`.
    fn constraint_of_distributive_conditional_worker(
        &mut self,
        t: TypeId,
        restrictive: bool,
    ) -> Option<TypeId> {
        // A type that `getRestrictiveInstantiation` returned has none.
        if restrictive
            && self
                .restrictive_operands
                .last()
                .is_some_and(|&(source, target)| t == source || t == target)
        {
            return None;
        }
        let param = self.cond_distributes_over(t)?;
        let (file, node, mapper, _) = self.cond_origin(t);
        let check = self.cond_check(t);
        let mut constraint = self.simplified(check, false);
        if constraint == check {
            constraint = if restrictive {
                self.restrictive_constraint_of(check)?
            } else {
                self.constraint_of(check)?
            };
        }
        if constraint == check {
            return None;
        }
        let mut pairs = self.p.types.mapping(mapper).to_vec();
        pairs.retain(|p| p.0 != param);
        pairs.push((param, constraint));
        let with_constraint = self.p.types.mapper(pairs);
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

    /// `getTemplateTypeFromMappedType`: with what stands for a property left out when the mapping makes properties optional.
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

    /// `getTypeParameterFromMappedType`. That of an instantiated mapped type is a fresh one, which ranges over the keys as they
    /// are there (`instantiateAnonymousType`).
    pub(super) fn mapped_type_param(&mut self, t: TypeId) -> TypeId {
        let Some((file, node, mapper)) = self.mapped_origin(t) else {
            return TypeId::UNRESOLVED;
        };
        let param = self.mapped_decl(file, node).param;
        self.cloned_type_param(file, param, mapper)
    }

    /// `MappedType.mapper`: what stands for the type parameters around the mapped type `t`, and its own for the one declared.
    fn mapped_mapper(&mut self, t: TypeId) -> MapperId {
        let Some((file, node, mapper)) = self.mapped_origin(t) else {
            return MapperId::IDENTITY;
        };
        let declared = self.type_param(file, self.mapped_decl(file, node).param);
        let own = self.mapped_type_param(t);
        if own == declared {
            return mapper;
        }
        let mut pairs = self.p.types.mapping(mapper).to_vec();
        pairs.retain(|p| p.0 != declared);
        pairs.push((declared, own));
        self.p.types.mapper(pairs)
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

    /// `getApparentMappedTypeKeys`, of `{ [P in keyof X as N]: .. }`: what `N` (`name`) makes of the keys `X` is known to have.
    /// `None`: it is not written with `keyof` (`isMappedTypeWithKeyofConstraintDeclaration`).
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
        // `forEachMappedTypePropertyKeyTypeAndIndexSignatureKeyType`. A property that is not public goes by `never`.
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

    /// A type parameter that stands in for another while a variance is measured was looked at in a way that the variance
    /// does not account for. `instantiateType(t, reportUnreliableMapper)`
    fn report_unreliable(&mut self, t: TypeId) {
        if self.p.types.flags(t).contains(TypeFlags::HAS_MARKER) {
            self.reliability |= REPORTS_UNRELIABLE;
        }
    }

    fn report_unmeasurable(&mut self, t: TypeId) {
        if self.p.types.flags(t).contains(TypeFlags::HAS_MARKER) {
            self.reliability |= REPORTS_UNMEASURABLE;
        }
    }

    /// `isMarkerType`, of a reference to a class or an interface.
    pub(super) fn is_marker_type(&mut self, t: TypeId) -> bool {
        // `getVariances`: arrays are never measured.
        if !self.p.types.flags(t).contains(TypeFlags::HAS_MARKER) || self.is_array(t) {
            return false;
        }
        let TypeData::Ref { target, args } = self.data(t) else {
            return false;
        };
        let params = self.all_type_params_of_symbol(*target);
        self.are_marker_arguments(*target, &params, args)
    }

    /// Whether `createMarkerType` has made the instantiation of `sym`, whose type parameters are `params`, with `args`: each
    /// parameter for itself, but for one that a marker stands for. `variances_of` makes them once it has set about `sym`. Until
    /// then such an instantiation goes by the variances of `sym` like any other, which is what sets about it.
    pub(super) fn are_marker_arguments(
        &self,
        sym: Sym,
        params: &[TypeId],
        args: &[TypeId],
    ) -> bool {
        if params.len() != args.len() {
            return false;
        }
        let mut measured = None;
        for (&arg, &param) in args.iter().zip(params) {
            if matches!(self.data(arg), TypeData::Marker(_)) {
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
        self.variances_in_progress.contains(&sym) || self.p.variances.get(&sym).is_some()
    }

    /// `t.alias`, if it has type arguments. While the alias is being worked out a reference to it is a mere name, and nothing can be
    /// measured.
    pub(super) fn alias_of(&self, t: TypeId) -> Option<(Sym, Vec<TypeId>)> {
        self.alias_of_type(t).filter(|(alias, type_arguments)| {
            !type_arguments.is_empty() && !self.stack.contains(&Query::Declared(*alias))
        })
    }

    /// `getTypeParameterModifiers`: what any of the declarations of `sym` says of its type parameter `param`.
    fn type_param_modifiers(&self, sym: Sym, param: TypeId) -> Flags {
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
                _ => None,
            })
            .collect();
        // One that is declared around `sym`, or by an alias, is declared once.
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

    /// `getVariances`, `getAliasVariances`: how instantiations of `sym` compare, going by how their type arguments do. Empty while
    /// it is measured.
    pub(super) fn variances_of(&mut self, sym: Sym) -> Arc<[u8]> {
        if let Some(known) = self.p.variances.get(&sym) {
            return known;
        }
        if Some(sym) == self.global_type_symbol(known::Array)
            || Some(sym) == self.global_type_symbol(known::ReadonlyArray)
        {
            return self.p.variances.insert(sym, Arc::from([COVARIANT]));
        }
        if self.variances_in_progress.contains(&sym) {
            return Arc::from([]);
        }
        self.variances_in_progress.push(sym);
        let was_computing = std::mem::replace(&mut self.in_variance_computation, true);
        // `resolutionStart`: what was under way when the outermost measurement began is asked afresh if it is needed, with the
        // measurement under way to stop it from going round for ever.
        let resolution_start = self.resolution_start;
        if !was_computing {
            self.resolution_start = self.stack.len();
        }
        let taint_scope = self.begin_taint_scope();
        let flags = self.files().flags(sym);
        let is_alias = flags.contains(SymFlags::TYPE_ALIAS)
            && !flags.intersects(SymFlags::CLASS | SymFlags::INTERFACE);
        // `getAliasVariances`: those the alias declares. `getVariances`: those around the declaration count too.
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
                let with = |c: &mut Self, marker: TypeId| {
                    let mut args = params.to_vec();
                    args[i] = marker;
                    // `createMarkerType`
                    if is_alias {
                        c.type_reference(sym, &args)
                    } else {
                        c.intern(TypeData::Ref {
                            target: sym,
                            args: args.into(),
                        })
                    }
                };
                let (with_super, with_sub) = (
                    with(self, TypeId::MARKER_SUPER),
                    with(self, TypeId::MARKER_SUB),
                );
                let mut variance = if self.is_marker_assignable(with_sub, with_super) {
                    COVARIANT
                } else {
                    0
                };
                if self.trace_slow_relations && variance == 0 {
                    let why = self.explain_not_assignable(with_sub, with_super);
                    eprintln!(
                        "NOT COVARIANT {} because {why:.300}",
                        self.files().atoms.text(self.files().symbol(sym).name)
                    );
                }
                if self.is_marker_assignable(with_super, with_sub) {
                    variance |= CONTRAVARIANT;
                }
                // Either way: perhaps because it is nowhere to be seen.
                if variance == BIVARIANT {
                    let with_other = with(self, TypeId::MARKER_OTHER);
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
        let is_tainted = self.end_taint_scope(taint_scope);
        if self.trace_slow_relations {
            eprintln!(
                "VARIANCE {} {:?} kept {}",
                self.files().atoms.text(self.files().symbol(sym).name),
                variances,
                !is_tainted
            );
        }
        if !is_tainted {
            self.p.variances.insert(sym, variances)
        } else {
            variances
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
        match self.p.variances.get_ref(&sym) {
            Some(known) => List::Kept(known),
            None => List::Own(self.variances_of(sym).to_vec()),
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

    /// `isRelatedToEx`. `REPORT` is `reportErrors`, here and in all that takes it.
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
        let ((original_source, original_sd), (original_target, original_td)) = (
            self.forced_as(original_source),
            self.forced_as(original_target),
        );
        let relation = r.relation;
        let is_from_related = std::mem::take(&mut r.is_from_related)
            && original_source == r.top_source
            && original_target == r.top_target;
        // `getPermissiveInstantiation` is called with `top_source` and `top_target`. Any other type is a part of one of them, where a
        // template literal type is instantiated too.
        if relation == Relation::Permissive
            && (original_source != r.top_source && self.is_permissive_wildcard(original_source, 1)
                || original_target != r.top_target
                    && self.is_permissive_wildcard(original_target, 1))
        {
            return Ternary::TRUE;
        }
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
                )
                || self.is_simple_type_related_to(
                    original_source,
                    original_sd,
                    original_target,
                    original_td,
                    relation,
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
        // It goes no further.
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
        let ((source, sd), (mut target, mut td)) = if REPORT {
            let source = self.normalized_for_report(original_source, false);
            let target = self.normalized_for_report(original_target, true);
            ((source, self.data(source)), (target, self.data(target)))
        } else {
            (
                self.normalized_as(original_source, original_sd, false),
                self.normalized_as(original_target, original_td, true),
            )
        };
        // `getRegularTypeOfObjectLiteral` goes into the properties that are object literals themselves and no further.
        let state = if state & STATE_REGULAR != 0 && !is_object_literal_kind(sd) {
            state & !STATE_REGULAR
        } else {
            state
        };
        if source == target {
            return Ternary::TRUE;
        }
        if relation == Relation::Identity {
            if self.flags_for_identity(source) != self.flags_for_identity(target) {
                return Ternary::FALSE;
            }
            if self.is_singleton(source) {
                return Ternary::TRUE;
            }
            return self.recursive_type_related_to::<false>(
                r, source, sd, target, td, STATE_NONE, recursion,
            );
        }
        // A type parameter against exactly what it extends: very common.
        if relation != Relation::Restrictive
            && is_type_param_kind(sd)
            && self.constraint_of_type_param(source) == Some(target)
        {
            return Ternary::TRUE;
        }
        // Something that is never null or undefined against `X | null | undefined`: against `X`.
        if let TypeData::Union(types) = td
            && matches!(types.len(), 2 | 3)
            && self.is_definitely_non_nullable_as(source, sd)
        {
            // There `undefined` and `null` come first in a union. Here `void` comes before them.
            let mut others = types
                .iter()
                .copied()
                .filter(|t| !t.is_null() && !t.is_undefined());
            if let (Some(candidate), None) = (others.next(), others.next()) {
                target = if REPORT {
                    self.normalized_for_report(candidate, true)
                } else {
                    self.normalized(candidate, true)
                };
                if source == target {
                    return Ternary::TRUE;
                }
                td = self.data(target);
            }
        }
        if !(is_from_related && source == original_source && target == original_target)
            && (relation == Relation::Comparable
                && !target.is_never()
                && self.is_simple_type_related_to(target, td, source, sd, relation)
                || self.is_simple_type_related_to(source, sd, target, td, relation))
        {
            return Ternary::TRUE;
        }
        // `isSimpleTypeRelatedTo`, with an `errorReporter`
        if REPORT {
            self.report_enum_relation(r, source, target);
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
                    self.report_relation_error(r, head, source, shown, false);
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
                    && self.is_global_ref(source, known::Object).is_some())
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
                    let source_string = self.type_to_string(shown_source);
                    let target_string = self.type_to_string(shown_target);
                    let mut is_meant_to_be_called = false;
                    for construct in [false, true] {
                        if !is_meant_to_be_called
                            && let Some(&first) = self.signatures(source, construct).first()
                        {
                            let returned = self.sig_return(first);
                            is_meant_to_be_called =
                                self.is_related_to(r, returned, target, REC_SOURCE).holds();
                        }
                    }
                    let code = if is_meant_to_be_called { 2560 } else { 2559 };
                    r.report_error(code, vec![source_string, target_string]);
                }
                return Ternary::FALSE;
            }
            // `typeRelatedToSomeType`: a union has room for each of its members. An object literal is looked for as what it is
            // once it is no longer fresh. Where `recursive_type_related_to` might say something else it is left to say it.
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

    // ───────────────────────────── object literals and types that ask for nothing ─────────────────────────────

    /// `isImplementationCompatibleWithOverload`. `None`: it cannot be told.
    pub(super) fn is_implementation_compatible_with_overload(
        &mut self,
        implementation: SigId,
        overload: SigId,
    ) -> Option<bool> {
        let (source, target) = (self.erased_sig(implementation), self.erased_sig(overload));
        let (source_return, target_return) = (self.sig_return(source), self.sig_return(target));
        let is_known =
            |c: &Self, t: TypeId| !c.p.types.flags(t).contains(TypeFlags::HAS_UNRESOLVED);
        if !is_known(self, source_return)
            || !is_known(self, target_return)
            || self
                .sig_params(source)
                .iter()
                .chain(self.sig_params(target).iter())
                .any(|p| !is_known(self, p.ty))
        {
            return None;
        }
        // What they return has to do with each other, one way or the other.
        if target_return != TypeId::VOID
            && !self.is_assignable(target_return, source_return)
            && !self.is_assignable(source_return, target_return)
        {
            return Some(false);
        }
        let mut r = Relater::new(Relation::Assignable, self.cycles);
        Some(
            self.compare_signatures_related::<false>(
                &mut r,
                source,
                target,
                (implementation, overload),
                IGNORE_RETURN_TYPES,
                0,
            )
            .holds(),
        )
    }

    /// `findMatchingDiscriminantType`, asked from outside a relation.
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
        // What takes anything takes any object literal, but not any attribute.
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
            if is_jsx && self.files().atoms.bytes(prop.name).contains(&b'-') {
                continue;
            }
            // `shouldCheckAsExcessProperty`: what a spread brought along is nobody's mistake.
            let written_here = match (&prop.source, literal) {
                (PropSource::Literal(file, p), Some((of, e))) => {
                    *file == of && self.bound(of).prop_owner[p.idx()] == e
                }
                (PropSource::Literal(..), None) => true,
                // The synthesized children property is declared in the attributes node, so it is checked like a written attribute.
                // Children alone do not make the attributes type fresh (`createJsxAttributesTypeFromAttributesProperty`), so a
                // written attribute is required. A property copied by a spread is declared elsewhere.
                // A `Partial` shape holds only properties written in the literal.
                (PropSource::Type(_) | PropSource::Copy(..), None) => {
                    is_fresh_partial
                        || prop.flags.contains(PropFlags::WRITTEN)
                        || is_jsx
                            && prop.flags.contains(PropFlags::JSX_CHILDREN)
                            && sm
                                .shape()
                                .props
                                .iter()
                                .any(|p| matches!(p.source, PropSource::Literal(..)))
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
                    let name = self.prop_to_string(prop);
                    let in_type = self.type_to_string(error_target);
                    if is_jsx {
                        if let PropSource::Literal(file, p) = prop.source
                            && r.error_node.0 == file
                        {
                            let end = self.end_of_jsx_attr_name(file, p);
                            r.error_node = (file, self.hir(file)[p].pos, end);
                        }
                        self.report_unknown_jsx_attribute(r, name, error_target, in_type);
                        return true;
                    }
                    // Only a name written as an identifier in the file at hand is taken for a slip of the pen.
                    let is_identifier = match prop.source {
                        PropSource::Literal(file, p) if r.error_node.0 == file => {
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
                        let properties = self.properties_for_suggestion(error_target);
                        let written = self.atom_text(prop.name);
                        suggestion = self
                            .suggested_property(&written, &properties)
                            .map(|i| self.atom_text(properties[i].name));
                    }
                    match suggestion {
                        Some(suggestion) => r.report_error(2561, vec![name, in_type, suggestion]),
                        None => r.report_error(2353, vec![name, in_type]),
                    }
                }
                return true;
            }
            if is_union {
                let given = self.type_of_prop(prop, sm.mapper);
                let wanted: SmallVec<[TypeId; 8]> = self
                    .parts(reduced_target)
                    .iter()
                    .map(|&t| self.type_of_property_in_type(t, prop.name))
                    .collect();
                let wanted = self.union(&wanted);
                if !self
                    .is_related_to_ex::<REPORT>(r, given, wanted, REC_BOTH, STATE_NONE)
                    .holds()
                {
                    if REPORT {
                        let name = self.prop_to_string(prop);
                        r.report_error(2326, vec![name]);
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
            .any(|&p| self.is_global_ref(p, known::Object).is_some())
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
            .unwrap_or(TypeId::UNDEFINED)
    }

    /// `getApplicableIndexInfoForName`
    fn applicable_index_info_for_name(&mut self, members: &Members, name: Atom) -> Option<TypeId> {
        if members.shape().index.is_empty() {
            return None;
        }
        if self.files().atoms.is_symbol_name(name) {
            return members
                .shape()
                .index
                .iter()
                .find(|i| i.key == TypeId::SYMBOL)
                .map(|i| i.value)
                .map(|v| self.instantiate(v, members.mapper));
        }
        let key = self.string_literal(name, false);
        self.applicable_index_info(members, key, Some(name))
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
            // `ObjectFlagsObjectLiteralPatternWithComputedProperties`: there is no telling what else it takes.
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
                        .is_some()
                {
                    return true;
                }
                // A name made from a symbol is let through by an index signature for strings.
                self.files().atoms.is_symbol_name(name)
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
        // An attribute with a hyphen in its name is taken to be known.
        let is_jsx = matches!(self.data(source), TypeData::Synth(shape) if shape.literal == Literalness::JsxAttributes);
        sm.shape().props.iter().any(|p| {
            is_jsx && self.files().atoms.bytes(p.name).contains(&b'-')
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
            let given = self.type_of_prop(prop, sm.mapper);
            // Those that do not match go only if some do: a discriminant that is wrong rules nothing out.
            let mut matched = false;
            for (i, &t) in types.iter().enumerate() {
                if !include[i].holds() {
                    continue;
                }
                let Some(wanted) = self.property_or_index_signature_type(t, prop.name) else {
                    continue;
                };
                if self
                    .parts(given)
                    .iter()
                    .any(|&s| self.is_related_to(r, s, wanted, REC_BOTH).holds())
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
        // There may be nothing under the name.
        let value = self.applicable_index_info_for_name(&members, name)?;
        Some(self.optional_property(value))
    }

    // ───────────────────────────── unions and intersections ─────────────────────────────

    /// `unionOrIntersectionRelatedTo`. The order matters: unions before intersections, "each" before "some". `sd`, `td`: what `source`
    /// and `target` are.
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
            // `A` is related to `A | B`: the list of unions the target was made of is often much shorter than what it comes to.
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
            // `getRegularTypeOfObjectLiteral`: no longer fresh, it is an object literal still, which is what a subtype may leave
            // optional properties out for, and the attributes of a JSX element still, where a name with a hyphen is always known.
            // Nothing in it is widened: alternatives do not get each other's properties.
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
        // The source is an intersection. `T & 1` with `T extends 1 | 2` is not to seem comparable to `2`.
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
        // Whether some member of it is related says nothing worth telling.
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

    /// `someTypeRelatedToType`: what is wrong with the last member is said.
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

    /// `eachTypeRelatedToType`: what is wrong with the first member that is not related is said.
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
        // `getUndefinedStrippedTargetIfNeeded`: `undefined`, which optionality adds, would spoil the correspondence. Where it
        // stands in a union: members are in the order of their ids, and its kinds come one after the other.
        let undefined_in = |types: &[TypeId]| {
            let from = types.partition_point(|&t| t < TypeId::UNDEFINED);
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
        let corresponds = count > 1 && sources.len() >= count && sources.len() % count == 0;
        for (i, &t) in sources.iter().enumerate() {
            // Many unions are mappings of one another: the members at the same place fit.
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
            // A literal is in a union of primitives, in one form or the other, or its primitive is; or it does not fit.
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
                // Patterns of strings are primitives too, and take looking into.
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
        }
        for &t in types {
            let related = self.is_related_to_ex::<false>(r, source, t, REC_TARGET, state);
            if related.holds() {
                return related;
            }
        }
        // Only against the member it is most likely meant for.
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

    // ───────────────────────────── types that lead back to themselves ─────────────────────────────

    /// `isTypeReferenceWithGenericArguments`. A tuple is a reference to its tuple target. A marker does not count as a type
    /// parameter: the reliability flags cached with a comparison depend on its markers, so it must not share a key with a
    /// comparison that has type parameters in their place.
    #[inline]
    fn is_type_reference_with_generic_arguments(&self, t: TypeId) -> bool {
        self.has_type_variables(t) && self.has_generic_arguments(t)
    }

    fn has_generic_arguments(&self, t: TypeId) -> bool {
        let args: &[TypeId] = match self.data(t) {
            TypeData::Ref { args, .. } => args,
            TypeData::Tuple { elems, .. } => elems,
            _ => return false,
        };
        args.iter().any(|&arg| {
            matches!(
                self.data(arg),
                TypeData::TypeParam(..) | TypeData::ThisParam(_)
            ) || self.is_type_reference_with_generic_arguments(arg)
        })
    }

    /// The `writeTypeReference` closure of `writeGenericTypeReferences`.
    fn write_type_reference(
        &mut self,
        key: &mut GenericKeyBuilder,
        reference: TypeId,
        depth: u32,
        ignore_constraints: bool,
    ) {
        let args: &'p [TypeId] = match self.data(reference) {
            TypeData::Ref { target, args } => {
                key.hasher.write_u8(b'r');
                key.hasher.write_u32(target.file.0);
                key.hasher.write_u32(target.id.0);
                args
            }
            // `getTupleKey`: the element flags and `readonly` identify a tuple target.
            TypeData::Tuple {
                elems,
                flags,
                readonly,
            } => {
                key.hasher.write_u8(if *readonly { b'!' } else { b't' });
                key.hasher.write_usize(flags.len());
                for flag in flags.iter() {
                    key.hasher.write_u32(flag.bits());
                }
                elems
            }
            _ => return,
        };
        for &arg in args {
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
        let flags = self.relation_key_flags(relation, state);
        let (source, target) = if relation == Relation::Identity && source > target {
            (target, source)
        } else {
            (source, target)
        };
        // tsgo compares permissive and restrictive instantiations, which do not have the declared type parameters. Here the declared
        // ones stand in for them, and their constraints must not be resolved.
        if matches!(relation, Relation::Permissive | Relation::Restrictive)
            || !self.is_type_reference_with_generic_arguments(source)
            || !self.is_type_reference_with_generic_arguments(target)
        {
            return ((source, target, flags), false);
        }
        self.generic_relation_key(source, target, flags, ignore_constraints)
    }

    /// The flags of a `Key`. Inside a generic signature the permissive relation goes by which type parameters are the signature's.
    #[inline]
    fn relation_key_flags(&self, relation: Relation, state: u8) -> u8 {
        let is_inside = relation == Relation::Permissive && !self.own_of_compared_sigs.is_empty();
        relation as u8 | u8::from(is_inside) << 3 | state << 4
    }

    /// `relation_key` that heeds constraints. `sd`, `td`: what `source` and `target` are.
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
        let flags = self.relation_key_flags(relation, state);
        if relation == Relation::Identity && source > target {
            ((target, source, flags), false)
        } else {
            ((source, target, flags), false)
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
        };
        self.write_type_reference(&mut key, source, 0, ignore_constraints);
        key.hasher.write_u8(b',');
        self.write_type_reference(&mut key, target, 0, ignore_constraints);
        // A constraint that could not be resolved does not tell whether its type parameter is constrained.
        if self.cycles != cycles_before {
            return ((source, target, flags), false);
        }
        let hash = key.hasher.finish();
        (
            (
                TypeId(hash as u32),
                TypeId((hash >> 32) as u32),
                flags | GENERIC_KEY,
            ),
            key.constrained,
        )
    }

    /// `recursiveTypeRelatedTo`: the answer if it is known; yes, for now, if it is being worked out, or if both types go on
    /// unfolding for ever; otherwise a look at what is in them. `sd`, `td`: what `source` and `target` are.
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
        r.steps += 1;
        // `related` has looked already.
        let missed = r
            .top_key
            .take()
            .filter(|_| state == STATE_NONE && source == r.top_source && target == r.top_target);
        let (key, constrained) = match missed {
            Some(key) => key,
            None => self.relation_key_as(source, sd, target, td, r.relation, state),
        };
        if missed.is_none()
            && !self.retracing
            && let Some(entry) = self.p.relations.get(&key)
            // A failure that is remembered is gone through again for what there is to say about it.
            && !(REPORT && entry & FAILED != 0 && entry & COMPLEXITY_OVERFLOW == 0)
        {
            self.reliability |= entry & (REPORTS_UNMEASURABLE | REPORTS_UNRELIABLE);
            if REPORT && entry & COMPLEXITY_OVERFLOW != 0 {
                let (source, target) = (self.type_to_string(source), self.type_to_string(target));
                r.report_error(2859, vec![source, target]);
            }
            if entry & COMPLEXITY_OVERFLOW != 0 {
                // The comparison was cut short when it was made.
                self.relation_gave_up = true;
                r.hit_cached_overflow = true;
            }
            return Ternary::of(entry & SUCCEEDED != 0);
        }
        if !REPORT && r.keeps_failures && r.failed.contains(&key) {
            return Ternary::FALSE;
        }
        if r.relation_count <= 0 {
            r.overflow = true;
            return Ternary::FALSE;
        }
        // The key goes into the set here, and out again wherever the comparison is not begun after all.
        if !r.maybe_keys_set.insert(key) {
            if self.retracing {
                eprintln!(
                    "{:w$}assumed: {} to {}",
                    "",
                    source.0,
                    target.0,
                    w = r.maybe_keys.len() * 2
                );
            }
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
        if self.retracing && r.maybe_keys.len() < 40 {
            self.retracing = false;
            let (a, b) = (
                crate::describe::Describer::new(self).describe(source),
                crate::describe::Describer::new(self).describe(target),
            );
            self.retracing = true;
            eprintln!(
                "{:w$}{} to {} state {state}: {a:.70} TO {b:.70}",
                "",
                source.0,
                target.0,
                w = r.maybe_keys.len() * 2
            );
        }
        let is_too_deep = r.source_stack.len() == 100 || r.target_stack.len() == 100;
        if is_too_deep || self.is_stack_low() || self.is_out_of_time() {
            if is_too_deep {
                self.relations_too_deep.push((r.top_source, r.top_target));
            }
            r.maybe_keys_set.remove(&key);
            r.overflow = true;
            return Ternary::FALSE;
        }
        let maybe_start = r.maybe_keys.len();
        let taint_scope = self.begin_taint_scope();
        let events_before = self.deep_events;
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
        let is_tainted = self.end_taint_scope(taint_scope);
        let propagating = self.reliability;
        self.reliability |= save_reliability;
        if recursion & REC_SOURCE != 0 {
            r.source_stack.pop();
        }
        if recursion & REC_TARGET != 0 {
            r.target_stack.pop();
        }
        r.expanding = save_expanding;
        if self.retracing && r.maybe_keys.len() <= 40 {
            eprintln!(
                "{:w$}=> {} to {}: {}{}",
                "",
                source.0,
                target.0,
                result.0,
                if r.overflow { " OVERFLOW" } else { "" },
                w = (r.maybe_keys.len() - 1) * 2
            );
        }
        if self.retracing {
            let kept = maybe_start + usize::from(result.holds() && result != Ternary::TRUE);
            for dropped in r.maybe_keys.drain(kept..) {
                r.maybe_keys_set.remove(&dropped);
            }
            return result;
        }
        // tsgo reports an instantiation limit at the node that is current when the comparison is first made. A comparison that hit one
        // that could not be reported is made again, so that `check_excessive_depth` comes to the limit.
        // With reports the answer can be another (`relate_variances`): it is nobody else's.
        let is_cacheable = !REPORT && !is_tainted && self.unreported_event <= events_before;
        if result.holds() {
            if result == Ternary::TRUE || r.source_stack.is_empty() && r.target_stack.is_empty() {
                // What held on assumptions holds now that there are none left. What is not known stays so.
                self.reset_maybe_stack(
                    r,
                    maybe_start,
                    propagating,
                    result == Ternary::TRUE || result == Ternary::MAYBE,
                    is_cacheable,
                );
            }
        } else {
            // What is false on assumptions is false without. A failure that follows from a comparison that was cut short is not kept.
            let is_cut_short = r.overflow || r.hit_cached_overflow;
            if r.keeps_failures {
                if !is_cut_short {
                    r.failed.insert(key);
                }
            } else if is_cacheable && !is_cut_short {
                self.p.relations.insert(key, FAILED | propagating);
            }
            r.relation_count -= 1;
            self.reset_maybe_stack(r, maybe_start, propagating, false, is_cacheable);
        }
        result
    }

    /// `resetMaybeStack`
    fn reset_maybe_stack(
        &mut self,
        r: &mut Relater,
        maybe_start: usize,
        propagating: u8,
        mark_all_as_succeeded: bool,
        is_cacheable: bool,
    ) {
        while r.maybe_keys.len() > maybe_start {
            let Some(key) = r.maybe_keys.pop() else {
                break;
            };
            r.maybe_keys_set.remove(&key);
            if mark_all_as_succeeded {
                if is_cacheable {
                    self.p.relations.insert(key, SUCCEEDED | propagating);
                }
                r.relation_count -= 1;
            }
        }
    }

    /// `isDeeplyNestedType`: `stack` has been through `max_depth` instantiations of what `t` is an instantiation of, each made
    /// later than the one before. A homomorphic mapped type is as deeply nested as what it is applied to.
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
        let mut last = TypeId(0);
        for &on_stack in stack {
            if self.has_matching_recursion_identity(on_stack, identity) {
                if on_stack >= last {
                    count += 1;
                    if count >= max_depth {
                        return true;
                    }
                }
                last = on_stack;
            }
        }
        false
    }

    /// `is_deeply_nested_type` of the last of `stack`. `identities`: for the first so many of what was on the stack when it was
    /// last looked at, the type and its `plain_recursion_identity`.
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
        let mut last = TypeId(0);
        for &(on_stack, kept) in identities {
            let matches = if kept == NOT_PLAIN {
                self.has_matching_recursion_identity(on_stack, identity)
            } else {
                (kept == identity || identity == (0, on_stack.0, 0))
                    && self.recursion_identity_by_now(on_stack, kept) == identity
            };
            if matches {
                if on_stack >= last {
                    count += 1;
                    if count >= max_depth {
                        return true;
                    }
                }
                last = on_stack;
            }
        }
        false
    }

    /// `recursion_identity`. `NOT_PLAIN` for a mapped type, which goes by what it is applied to, and for an intersection, which
    /// goes by its members.
    fn plain_recursion_identity(&self, t: TypeId) -> RecursionId {
        let data = self.data(t);
        if is_mapped_kind(data) || matches!(data, TypeData::Intersection(_)) {
            NOT_PLAIN
        } else {
            self.recursion_identity_as(t, data)
        }
    }

    /// `recursion_identity` of `t`, given that it was `kept` at some time. A reference or a tuple may have been written out as a
    /// type since (`mark_manifest`), and then it has one of its own.
    #[inline]
    fn recursion_identity_by_now(&self, t: TypeId, kept: RecursionId) -> RecursionId {
        if matches!(kept.0, 1 | 5) && self.p.types.is_manifest(t) {
            (0, t.0, 0)
        } else {
            kept
        }
    }

    /// `getMappedTargetWithSymbol`: what a homomorphic mapped type is applied to, through as many of them as there are, as long as
    /// that is something declared. `Id<{ x: .. }>` is then told apart by the type literal it is applied to. With it, what it is.
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
        if let Some(known) = self.p.mapped_targets.get(&of) {
            return known;
        }
        let before = self.what_only_holds_for_now();
        // What an alias stands for while it is being worked out depends on who asks.
        let mut met_alias = false;
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
                // That of an object literal.
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
        // Aliases that go round in a circle are an error somewhere else. Here they have to end.
        for _ in 0..64 {
            let Some((_, _, mapper)) = self.mapped_origin(t) else {
                break;
            };
            // `ObjectFlagsInstantiatedMapped`: not the mapped type as it is declared.
            if self.p.types.mapping(mapper).iter().all(|p| p.0 == p.1) {
                break;
            }
            let Some(target) = self.mapped_modifiers_type(t) else {
                break;
            };
            met_alias |= matches!(self.data(target), TypeData::LazyAlias { .. });
            let target = self.force(target);
            let found = match self.data(target) {
                TypeData::Intersection(parts) => parts.iter().any(|&p| has_symbol(self, p)),
                _ => has_symbol(self, target),
            };
            if !found || target == t {
                break;
            }
            t = target;
        }
        if !met_alias && self.what_only_holds_for_now() == before {
            self.p.mapped_targets.insert(of, t);
        }
        t
    }

    /// `hasMatchingRecursionIdentity`
    fn has_matching_recursion_identity(&mut self, t: TypeId, identity: RecursionId) -> bool {
        let (t, data) = self.mapped_target_with_symbol(t);
        match data {
            TypeData::Intersection(parts) => parts
                .iter()
                .any(|&p| self.has_matching_recursion_identity(p, identity)),
            // The identity of a reference is its own or that of what it refers to.
            TypeData::Ref { target, .. }
                if identity != (0, t.0, 0) && identity != (1, target.file.0, target.id.0) =>
            {
                false
            }
            data => self.recursion_identity_as(t, data) == identity,
        }
    }

    /// The type of an array literal with object literals in it, as it stands or widened. What is in an object literal is worked
    /// out when it is asked for here, and beforehand there, where `isDeeplyNestedType` therefore never takes the list inside for
    /// newer than the one around it. `data`: what `t` is.
    fn holds_object_literals(&self, t: TypeId, data: &TypeData) -> bool {
        let inside: &[TypeId] = match data {
            TypeData::Tuple { elems, .. } => elems,
            TypeData::Ref { args, .. } if !args.is_empty() && self.is_array(t) => args,
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

    /// `data`: what `t` is.
    fn recursion_identity_as(&self, t: TypeId, data: &TypeData) -> RecursionId {
        match data {
            // Written out as a type, or the type of an array literal: not made by instantiation (`ObjectFlagsFromTypeNode`,
            // `isObjectOrArrayLiteralType`).
            TypeData::Ref { .. } | TypeData::Tuple { .. }
                if self.p.types.is_manifest(t) || self.holds_object_literals(t, data) =>
            {
                (0, t.0, 0)
            }
            TypeData::Ref { target, .. } => (1, target.file.0, target.id.0),
            TypeData::Anon {
                origin: Origin::TypeLiteral(file, node) | Origin::Mapped(file, node),
                ..
            } => (2, file.0, node.0),
            // `getWidenedTypeOfObjectLiteral`: an ordinary object type that has the symbol of the literal.
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
            } => (
                5,
                flags.len() as u32,
                flags.iter().fold(*readonly as u32, |h, f| {
                    h.wrapping_mul(31).wrapping_add(f.bits())
                }),
            ),
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

    /// `structuredTypeRelatedTo`. `sd`, `td`: what `source` and `target` are.
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
        // The constraint of an intersection is the intersection of the constraints of its parts, and may come to something
        // that none of them does: `T & U`, each extending `string | number`; `V & number`.
        if !result.holds() && (source_is_intersection || is_type_param_kind(sd) && target_is_union)
        {
            let one = [source];
            let types: &[TypeId] = match sd {
                TypeData::Intersection(parts) => parts,
                _ => &one,
            };
            let restrictive = r.relation == Relation::Restrictive;
            if let Some(constraint) =
                self.effective_constraint_of_intersection_ex(types, target_is_union, restrictive)
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
            // Part by part, nothing sees what is too much, or too little, further in. What is in a literal that is no longer fresh
            // is not fresh either (`getRegularTypeOfObjectLiteral`).
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
            // `T & { a: boolean }` fits `{ a?: string }` by its first part.
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
    /// an intersection with a type parameter that has a union constraint. A union has the properties that all of its members have
    /// (`CheckFlagsReadPartial`), each with the union of their types.
    pub(super) fn properties_of_apparent_type_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
        target: TypeId,
        optionals_only: bool,
        state: u8,
    ) -> Ternary {
        // The type parameters of a restrictive instantiation extend nothing.
        if !self.is_intersection(source) || r.relation == Relation::Restrictive {
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
            let source = members.first().copied().unwrap_or(source);
            return self.properties_related_to::<REPORT>(
                r,
                source,
                target,
                &[],
                optionals_only,
                state,
            );
        }
        let mut partial: SmallVec<[Atom; 4]> = SmallVec::new();
        if let Some(wanted) = self.members(target) {
            for prop in &wanted.shape().props {
                if prop.flags.contains(PropFlags::OPTIONAL)
                    && members
                        .iter()
                        .any(|&member| self.prop_ref(member, prop.name).is_none())
                {
                    partial.push(prop.name);
                }
            }
        }
        let mut result = Ternary::TRUE;
        for &member in &members {
            result &= self.properties_related_to::<REPORT>(
                r,
                member,
                target,
                &partial,
                optionals_only,
                state,
            );
            if !result.holds() {
                break;
            }
        }
        result
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

    /// The `relateVariances` closure of `structuredTypeRelatedToWorker`. `Some`: that settles it.
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
        // It did not work out on the assumption that the arguments are all there is to it, and they may not be.
        if variances
            .iter()
            .any(|v| v & ALLOWS_STRUCTURAL_FALLBACK != 0)
        {
            // What the type arguments had to say may not help: the type parameter was taken to be the same on both sides.
            if REPORT {
                shared.original_error_chain = None;
                r.restore_error_state(&shared.save_error_state);
            }
            return None;
        }
        // A `void` argument for something that is only ever given back lets anything through.
        let allow_structural_fallback = self.has_covariant_void_argument(targets, variances);
        shared.variance_check_failed = !allow_structural_fallback;
        if !variances.is_empty() && !allow_structural_fallback {
            // With an invariant type parameter what is in the two types shows why it is one.
            if !(REPORT && variances.iter().any(|v| v & VARIANCE_MASK == INVARIANT)) {
                return Some(Ternary::FALSE);
            }
            shared.original_error_chain = r.error_chain.clone();
            r.restore_error_state(&shared.save_error_state);
        }
        None
    }

    /// The alias probe of `structuredTypeRelatedToWorker` under the assignable relation, for two instantiations of the generic
    /// alias `alias` that are known by their type arguments only. `None`: the variances do not settle it.
    pub(super) fn alias_arguments_related(
        &mut self,
        alias: Sym,
        sources: &[TypeId],
        targets: &[TypeId],
    ) -> Option<bool> {
        let variances = self.variances_of(alias);
        // Being measured.
        if variances.is_empty() {
            return None;
        }
        let mut r = self
            .free_relaters
            .pop()
            .unwrap_or_else(|| Relater::new(Relation::Assignable, self.cycles));
        r.relation = Relation::Assignable;
        r.top_source = TypeId::NEVER;
        r.top_target = TypeId::NEVER;
        r.relation_count = 2_000_000;
        r.cycles = self.cycles;
        r.steps = 0;
        let result = self.relate_variances::<false>(
            &mut r,
            sources,
            targets,
            &variances,
            STATE_NONE,
            &mut WorkerState::default(),
        );
        let overflow = r.overflow;
        r.maybe_keys.clear();
        r.maybe_keys_set.clear();
        r.source_stack.clear();
        r.target_stack.clear();
        r.expanding = 0;
        r.overflow = false;
        r.hit_cached_overflow = false;
        self.free_relaters.push(r);
        if overflow {
            self.relation_gave_up = true;
            return None;
        }
        result.map(Ternary::holds)
    }

    /// `structuredTypeRelatedToWorker`. `sd`, `td`: what `source` and `target` are.
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
            // Taking them apart in order does not cover: a source that waits for type parameters; an object against a union
            // (`{ a, b: boolean }` and `{ a, b: true } | { a, b: false }`); an intersection against an object, a union, or
            // something that waits.
            let target_is_union = matches!(td, TypeData::Union(_));
            if !(is_instantiable_kind(sd)
                || is_object_kind(sd) && target_is_union
                || matches!(sd, TypeData::Intersection(_))
                    && (is_object_kind(td) || target_is_union || is_instantiable_kind(td)))
            {
                return Ternary::FALSE;
            }
        }
        // Two instantiations of one generic alias: go by how it varies with its type parameters.
        let same_body = match (sd, td) {
            (TypeData::Anon { origin: s, .. }, TypeData::Anon { origin: t, .. }) => s == t,
            (TypeData::Fns { decls: s, .. }, TypeData::Fns { decls: t, .. }) => s == t,
            (
                TypeData::Cond {
                    file: sf, node: sn, ..
                },
                TypeData::Cond {
                    file: tf, node: tn, ..
                },
            ) => (sf, sn) == (tf, tn),
            _ => false,
        };
        if same_body
            && let Some((alias, source_args, target_args, true)) = self.same_alias(source, target)
            // With a wildcard for every type parameter there are no marker types left.
            && (relation == Relation::Permissive || {
                let params = self.type_params_of_symbol(alias);
                !self.are_marker_arguments(alias, &params, &source_args) && !self.are_marker_arguments(alias, &params, &target_args)
            })
        {
            let variances = self.variances_list(alias);
            // Being measured.
            if variances.is_empty() {
                return Ternary::UNKNOWN;
            }
            if let Some(result) = self.relate_variances::<REPORT>(
                r,
                &source_args,
                &target_args,
                &variances,
                state,
                &mut shared,
            ) {
                return result;
            }
        }
        // `[...U]` fits `T` if `U` does; `U` fits `readonly [...T]`, and `[...T]` if `U` is a mutable array or tuple.
        if let TypeData::Tuple {
            elems,
            flags,
            readonly,
        } = sd
            && elems.len() == 1
            && flags[0].contains(ElemFlags::VARIADIC)
            && !*readonly
        {
            let result = self.is_related_to(r, elems[0], target, REC_SOURCE);
            if result.holds() {
                return result;
            }
        }
        if let TypeData::Tuple {
            elems,
            flags,
            readonly,
        } = td
            && elems.len() == 1
            && flags[0].contains(ElemFlags::VARIADIC)
            && (*readonly || {
                let constraint = self.base_constraint_or_type(source);
                self.is_mutable_array_or_tuple(constraint)
            })
        {
            let result = self.is_related_to(r, source, elems[0], REC_TARGET);
            if result.holds() {
                return result;
            }
        }

        // ── by what the target is ──
        match *td {
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_) => {
                // `getNormalizedType`: a class that adds nothing to its base type is compared as that type. `normalized` leaves it as
                // it is.
                if matches!(sd, TypeData::Ref { .. })
                    && let Some(base) = self.single_base_for_non_augmenting_subtype(source)
                {
                    return self
                        .is_related_to_ex::<REPORT>(r, base, target, REC_SOURCE, STATE_NONE);
                }
                // `{ [P in Q]: X }` fits `T` if `keyof T` fits `Q` and `X` fits `T[Q]`.
                if is_mapped_kind(sd) && self.mapped_name_type(source).is_none() {
                    let (keys, covered) = (self.keyof(target), self.mapped_keys(source));
                    if self.is_related_to(r, keys, covered, REC_BOTH).holds()
                        && self.mapped_optional_modifier(source) != MappedModifier::Add
                    {
                        let template = self.mapped_template(source);
                        let param = self.mapped_type_param(source);
                        let wanted = self.indexed_access(target, param);
                        let result = self
                            .is_related_to_ex::<REPORT>(r, template, wanted, REC_BOTH, STATE_NONE);
                        if result.holds() {
                            return result;
                        }
                    }
                }
                if relation == Relation::Comparable && self.is_type_param(source) {
                    // Two type parameters may be the same value only if one extends the other.
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
                    // `S[K]` fits `T[J]` if `S` fits `T` and `K` fits `J`.
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
                // `S` fits `T[K]` if it fits what can be written to it whatever `T` and `K` are. That goes by what they extend.
                if relation.is_lenient() {
                    let (base_object, base_index) = if relation == Relation::Restrictive {
                        (
                            self.restrictive_base_constraint_or_type(object),
                            self.restrictive_base_constraint_or_type(index),
                        )
                    } else {
                        (
                            self.base_constraint_or_type(object),
                            self.base_constraint_or_type(index),
                        )
                    };
                    if !self.is_generic_object_type(base_object)
                        && !self.is_generic_index_type(base_index)
                        && let Some(constraint) = self.indexed_access_for_writing(
                            base_object,
                            base_index,
                            base_object != object,
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
                        // Of the two chains the shorter.
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
                // `keyof S` fits `keyof T` if `T` fits `S`.
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
                    let constraint = if relation == Relation::Restrictive {
                        self.restrictive_simplified_or_constraint(of)
                    } else {
                        self.simplified_or_constraint(of)
                    };
                    if let Some(constraint) = constraint {
                        // For certain, or `T extends { [K in keyof T]: string }` would let anything through.
                        // `IndexFlagsNoReducibleCheck`: a union is its own constraint, and its `keyof` must not be deferred again.
                        let keys = self.keyof_ex(constraint, true);
                        if self.is_related_to_ex::<REPORT>(r, source, keys, REC_TARGET, STATE_NONE)
                            == Ternary::TRUE
                        {
                            return Ternary::TRUE;
                        }
                    } else if self.is_generic_mapped_type(of) {
                        let keys = match self.mapped_name_type(of) {
                            // The keys it is sure to have, and those that wait.
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
                // Only without `infer`, when the results do not depend on going member by member, and when the source is not
                // made from the same conditional type.
                let same_root = matches!(*self.data(source), TypeData::Cond { file: sf, node: sn, .. } if (sf, sn) == (file, node));
                if self.cond_infer_params(target).is_empty()
                    && !self.is_distribution_dependent(target)
                    && !same_root
                {
                    let (check, extends) = (self.cond_check(target), self.cond_extends(target));
                    // It may always go one way, and wait all the same.
                    let skip_true = !self.related(check, extends, Relation::Permissive);
                    let skip_false =
                        !skip_true && self.related(check, extends, Relation::Restrictive);
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
                    // `foo-${number}` fits `foo-${string}` though `number` does not fit `string`.
                    self.report_unreliable(source);
                }
                if self.is_matched_by_template(source, texts, types) {
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
                        let source_keys = self.keyof_without_index_signatures(source);
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
                            // `Obj[P]`: `S` against `Obj` will do, and makes no new types.
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

        // ── by what the source is ──
        match *sd {
            TypeData::TypeParam(..)
            | TypeData::ThisParam(_)
            | TypeData::Marker(_)
            | TypeData::IndexedAccess { .. } => {
                // `S[K]` against `T[J]` was seen to above.
                if !(matches!(self.data(source), TypeData::IndexedAccess { .. })
                    && matches!(self.data(target), TypeData::IndexedAccess { .. }))
                {
                    let constraint = if relation != Relation::Restrictive {
                        self.constraint_of(source)
                    } else {
                        self.restrictive_constraint_of(source)
                    };
                    let constraint = constraint.unwrap_or(TypeId::UNKNOWN);
                    let result =
                        self.is_related_to_ex::<false>(r, constraint, target, REC_SOURCE, state);
                    if result.holds() {
                        return result;
                    }
                    // `getTypeWithThisArgument`: in what it has through what it extends, `this` is the type variable itself.
                    let with_this = self.reference_with_this(constraint, source);
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
                    if relation != Relation::Restrictive
                        && self.is_mapped_type_generic_indexed_access(source)
                        && let TypeData::IndexedAccess { obj, index, .. } = *self.data(source)
                        && let Some(index_constraint) = self.constraint_of(index)
                    {
                        // `{ [P in K]: E }[X]`: `E` with `X` for `P` was tried; now with what `X` extends.
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
                        // Without the keys that wait: they are in terms of a type parameter nobody outside knows.
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
                    // `T1 extends U1 ? X1 : Y1` fits `T2 extends U2 ? X2 : Y2` if `T1` and `T2` have to do with each other, `U1`
                    // and `U2` are the same, `X1` fits `X2` and `Y1` fits `Y2`.
                    let source_params = self.cond_infer_params(source);
                    let mut source_extends = self.cond_extends(source);
                    let target_extends = self.cond_extends(target);
                    let mut mapper = MapperId::IDENTITY;
                    // Made from one declaration, what is to be inferred is the same on both sides: it stands for itself.
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
                    let is_same = if relation == Relation::Permissive {
                        self.is_identical_with_wildcards(source_extends, target_extends)
                    } else {
                        self.is_identical(source_extends, target_extends)
                    };
                    if is_same {
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
                // Not against another conditional type: what is checked is replaced by what it extends, and too much fits.
                if !matches!(self.data(target), TypeData::Cond { .. })
                    && self.has_non_circular_base_constraint(source)
                {
                    let distributive = if relation == Relation::Restrictive {
                        self.constraint_of_distributive_conditional_worker(source, true)
                    } else {
                        self.constraint_of_distributive_conditional(source)
                    };
                    if let Some(distributive) = distributive {
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

    /// The `default` case of the second `switch` of `structuredTypeRelatedToWorker`. `sd`, `td`: what `source` and `target` are.
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
        // Nothing fits what asks for nothing in particular.
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
        // What stands for `object` is nobody's declaration: it is not known to have nothing else in it.
        let source_is_object_keyword = !is_object_kind(sd)
            && self.looks_like_the_object_keyword(source, relation == Relation::Restrictive);
        let (mut source, mut sd) = (source, sd);
        if relation != Relation::Identity {
            // An object type other than a mapped one is its own apparent type.
            if !is_object_kind(sd) || is_mapped_kind(sd) {
                source = self.apparent_type_for_relation(source);
                // It is named.
                if REPORT {
                    source = self.apparent_type_of_intersection(source);
                }
                sd = self.data(source);
            }
        } else if self.is_generic_mapped_type(source) {
            return Ternary::FALSE;
        }
        match (sd, td) {
            (TypeData::Ref { target: st, args: sa }, TypeData::Ref { target: tt, args: ta })
                // With a wildcard for every type parameter there are no marker types left.
                if st == tt && (relation == Relation::Permissive || !self.is_marker_type(source) && !self.is_marker_type(target)) =>
            {
                // Two instantiations of one generic type: go by how it varies with its type parameters.
                let variances = self.variances_list(*st);
                // Being measured. So only occurrences that are not inside instantiations of the type itself count.
                if variances.is_empty() {
                    return Ternary::UNKNOWN;
                }
                if let Some(result) = self.relate_variances::<REPORT>(r, sa, ta, &variances, state, shared) {
                    return result;
                }
            }
            (_, TypeData::Ref { args, .. }) if !args.is_empty() && self.is_array(target)
                && (self.is_global_ref(target, known::ReadonlyArray).is_some() && self.every_type(source, |c, m| c.is_array_or_tuple(m))
                    || self.every_type(source, |c, m| matches!(c.data(m), TypeData::Tuple { readonly: false, .. }))) =>
            {
                if relation != Relation::Identity {
                    let (s, t) = (self.number_index_type_or_any(source), self.number_index_type_or_any(target));
                    return self.is_related_to_ex::<REPORT>(r, s, t, REC_BOTH, STATE_NONE);
                }
                return Ternary::FALSE;
            }
            (TypeData::Tuple { .. }, TypeData::Tuple { .. }) if is_generic_tuple_kind(sd) && !is_generic_tuple_kind(td) => {
                let constraint = self.base_constraint_or_type(source);
                if constraint != source {
                    return self.is_related_to_ex::<REPORT>(r, constraint, target, REC_SOURCE, STATE_NONE);
                }
            }
            _ if relation.is_subtype() && self.is_fresh_object_literal_type(target) && self.is_empty_object_type(target) && !self.is_empty_object_type(source) => {
                return Ternary::FALSE;
            }
            _ => {}
        }
        // Whatever unions, intersections and type arguments said, what is in them may do. An intersection counts as one object.
        let source_is_object_or_intersection =
            is_object_kind(sd) || matches!(sd, TypeData::Intersection(_));
        if source_is_object_or_intersection && is_object_kind(td) {
            // `reportStructuralErrors`: only if nothing has been said yet.
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
                // There is nothing to say of what is in them: what the type arguments had to say stands.
                if REPORT {
                    if shared.original_error_chain.is_some() {
                        r.error_chain = shared.original_error_chain.clone();
                    } else if r.error_chain.is_none() {
                        r.error_chain = shared.save_error_state.chain.clone();
                    }
                }
            }
        }
        // An object fits a union told apart by some properties if every way it can be is some member's.
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

    /// The four comparisons of `structuredTypeRelatedToWorker` under `reportStructuralErrors`, which is `REPORT` here.
    /// `primitive_or_keyword`: `sourceIsPrimitive`, and whether `source` stands for `object`.
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
                    // tsgo compares, and names, `{}`.
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

    /// `getApparentType`, where nothing to go by is `unknown` and not `{}`.
    pub(super) fn apparent_type_for_relation(&mut self, t: TypeId) -> TypeId {
        if self.is_deferred(t) {
            return match self.base_constraint_of(t) {
                Some(constraint) => self.apparent_type(constraint),
                None => TypeId::UNKNOWN,
            };
        }
        self.apparent_type(t)
    }

    /// `getTypeWithThisArgument`: `t` with `this_argument` for `this` in its members. As there, it goes after the type arguments
    /// of a reference to a class or an interface, where `members` finds it.
    pub(super) fn reference_with_this(&mut self, t: TypeId, this_argument: TypeId) -> TypeId {
        match self.data(t) {
            TypeData::Ref { target, args } => {
                if self.all_type_params_of_symbol(*target).len() != args.len() {
                    return t;
                }
                let mut with_this = args.to_vec();
                with_this.push(this_argument);
                self.intern(TypeData::Ref {
                    target: *target,
                    args: with_this.into(),
                })
            }
            TypeData::Intersection(parts) => {
                let with_this: Vec<TypeId> = parts
                    .iter()
                    .map(|&p| self.reference_with_this(p, this_argument))
                    .collect();
                if with_this[..] == parts[..] {
                    t
                } else {
                    self.intersection(&with_this)
                }
            }
            _ => t,
        }
    }

    pub(super) fn is_mutable_array_or_tuple(&self, t: TypeId) -> bool {
        self.is_global_ref(t, known::Array).is_some()
            || matches!(
                self.data(t),
                TypeData::Tuple {
                    readonly: false,
                    ..
                }
            )
    }

    /// `getIndexTypeOfTypeEx(t, numberType, anyType)`
    pub(super) fn number_index_type_or_any(&mut self, t: TypeId) -> TypeId {
        if let Some(element) = self.array_element(t) {
            return element;
        }
        if let TypeData::Tuple { elems, flags, .. } = self.data(t) {
            return self.tuple_element_union(elems, flags);
        }
        if let TypeData::Union(parts) = self.data(t) {
            let types: Vec<TypeId> = parts
                .iter()
                .map(|&p| self.number_index_type_or_any(p))
                .collect();
            return self.union(&types);
        }
        match self.members(t) {
            Some(members) => self
                .applicable_index_info(&members, TypeId::NUMBER, None)
                .unwrap_or(TypeId::ANY),
            None => TypeId::ANY,
        }
    }

    /// `getIndexTypeEx(t, IndexFlagsNoIndexSignatures)`
    pub(super) fn keyof_without_index_signatures(&mut self, t: TypeId) -> TypeId {
        self.get_index_type_ex(t, false, true)
    }

    /// `getIndexedAccessTypeOrUndefined(object, index, AccessFlagsWriting | ...)`: what can be written whichever key it is.
    pub(super) fn indexed_access_for_writing(
        &mut self,
        object: TypeId,
        index: TypeId,
        no_index_signatures: bool,
    ) -> Option<TypeId> {
        let (object, index) = (self.force(object), self.force(index));
        let object = self.reduced(object);
        let index = self.key_into_string_index_only(object, index);
        // `getReducedApparentType`: a type parameter answers with what it extends.
        let object = self.apparent_type(object);
        let object = self.reduced(object);
        // Only the keys are gone through one by one.
        if !self.is_union(index) {
            return self.property_type_for_writing(object, index, no_index_signatures);
        }
        // `indexType.Types()`: in the order of `CompareTypes`. An intersection keeps the order it is given.
        let keys = self.parts(index);
        let mut types = Vec::with_capacity(keys.len());
        for &key in keys.iter() {
            types.push(self.property_type_for_writing(object, key, no_index_signatures)?);
        }
        Some(self.intersection(&types))
    }

    /// `getPropertyTypeForIndexType`, to write: what `object`, which waits for nothing, takes under `key`, which is no union.
    fn property_type_for_writing(
        &mut self,
        object: TypeId,
        key: TypeId,
        no_index_signatures: bool,
    ) -> Option<TypeId> {
        let objects = self.parts(object);
        let name = self.property_name_of_type(key);
        if let Some(name) = name {
            // `getPropertyOfType`. A union is asked as a whole: it has what some member has and the others have something to stand
            // in for, and that is any of theirs (`createUnionOrIntersectionProperty`).
            let mut of_each = Vec::with_capacity(objects.len());
            let mut is_property = false;
            for &one in objects {
                let apparent = self.apparent_type(one);
                let Some(members) = self.members(apparent) else {
                    break;
                };
                if let Some((prop, mapper)) = self.property_in(&members, name) {
                    is_property = true;
                    // `getWriteTypeOfSymbol`
                    let ty = self.write_type_of_prop(prop, mapper);
                    let takes_undefined = prop.flags.contains(PropFlags::OPTIONAL)
                        && !self.p.files.options.exact_optional_property_types;
                    of_each.push(if takes_undefined {
                        self.optional(ty)
                    } else {
                        ty
                    });
                } else if let TypeData::Tuple { elems, flags, .. } = self.data(apparent)
                    && self.is_numeric_name(name)
                {
                    // `getRestTypeOfTupleType`
                    let fixed = Self::fixed_length(flags);
                    of_each.push(if fixed < flags.len() {
                        self.tuple_element_union(&elems[fixed..], &flags[fixed..])
                    } else {
                        self.undefined_as_declared()
                    });
                } else if let Some(value) = self.applicable_index_info_for_name(&members, name) {
                    of_each.push(value);
                } else if self.is_closed_object_literal_type(apparent) {
                    of_each.push(self.undefined_as_declared());
                } else {
                    break;
                }
            }
            // `getTupleElementTypeOutOfStartCount`: a place past those that tuples have of their own is any of what follows them.
            let is_past_tuples = !is_property
                && self.is_numeric_name(name)
                && !self.files().atoms.bytes(name).starts_with(b"-")
                && objects.iter().all(|&one| self.is_tuple(one));
            if !objects.is_empty()
                && of_each.len() == objects.len()
                && (is_property || is_past_tuples)
            {
                return Some(self.union(&of_each));
            }
        }
        if self.is_any(object) || object.is_never() {
            return Some(object);
        }
        // `any` and `never` are assignable to the key type of every index signature. Where there is none they index to themselves.
        let fits_every_key = self.has_any_flag(key) || key.is_never();
        let members = match objects {
            [one] => {
                let apparent = self.apparent_type(*one);
                self.members(apparent)
            }
            _ => {
                let index = self.union_index_infos(objects);
                let whole = self.synth(Shape {
                    index,
                    ..Shape::default()
                });
                self.members(whole)
            }
        };
        let Some(members) = members else {
            return fits_every_key.then_some(key);
        };
        // Through what a type parameter extends only the index signature for numbers is written to.
        if no_index_signatures {
            let infos = &members.shape().index;
            if fits_every_key && infos.is_empty() {
                return Some(key);
            }
            // `getApplicableIndexInfo`: the signature for strings applies only if no other does, and several that apply are not the
            // one for numbers.
            let is_numeric = self.is_number_like(key)
                || name.is_some_and(|n| self.is_numeric_name(n))
                || fits_every_key && infos.iter().filter(|i| i.key != TypeId::STRING).count() == 1;
            let info = infos
                .iter()
                .find(|i| i.key == TypeId::NUMBER)
                .copied()
                .filter(|_| is_numeric)?;
            return Some(self.instantiate(info.value, members.mapper));
        }
        let mut value = self.applicable_index_info(&members, key, name);
        // Where none applies the one for strings stands in, which is to say for symbols.
        if value.is_none() && self.is_symbol_like(key) {
            value = self.applicable_index_info(&members, TypeId::STRING, None);
        }
        value.or_else(|| (key.is_never() || self.has_any_flag(key)).then_some(key))
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
            return Ternary::FALSE;
        }
        let mut result = Ternary::TRUE;
        for i in 0..sources.len().min(targets.len()) {
            // Covariant when nothing is known: while the variance of a recursive type is measured.
            let flags = variances.get(i).copied().unwrap_or(COVARIANT);
            let variance = flags & VARIANCE_MASK;
            // Nobody ever sees what an independent type parameter stands for.
            if variance == INDEPENDENT {
                continue;
            }
            let (s, t) = (sources[i], targets[i]);
            let related = if flags & UNMEASURABLE != 0 {
                // Not simply invariant: with `-?` in a mapped type, however the inputs compare, the outputs may not.
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
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    /// `mappedTypeRelatedTo`: `[P in S]: X` fits `[Q in T]: Y` if `T` fits `S` and `X`, with `Q` for `P`, fits `Y`.
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
        // The properties that tell the members of the union apart, and what each can be in the source.
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
        let types = self.parts(target);
        // Every combination has to be some member's.
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
                            chosen,
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
        // The rest has to fit each of the members that came up.
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
            target,
            excluded,
            optionals_only,
            state,
            &mut None,
        )
    }

    /// `both`: left with what `members` says of `source` and of `target`, if it was asked and will say the same from now on.
    #[allow(clippy::too_many_arguments)]
    fn properties_related_to_noting<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: TypeId,
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
            elems: target_elems,
            flags: target_flags,
            readonly: target_readonly,
        } = td
        {
            let variable = ElemFlags::REST | ElemFlags::VARIADIC;
            let target_has_rest_element = target_flags.iter().any(|f| f.intersects(variable));
            if self.is_array_or_tuple(source) {
                let one_element;
                let (source_elems, source_flags, source_readonly): (&[TypeId], &[ElemFlags], bool) =
                    match self.data(source) {
                        TypeData::Tuple {
                            elems,
                            flags,
                            readonly,
                        } => (elems, flags, *readonly),
                        _ => {
                            one_element = [self.array_element(source).unwrap_or(TypeId::ANY)];
                            (
                                &one_element,
                                &[ElemFlags::REST],
                                self.is_global_ref(source, known::ReadonlyArray).is_some(),
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
                        let args = vec![source_arity.to_string(), target_min_length.to_string()];
                        r.report_error(2618, args);
                    }
                    return Ternary::FALSE;
                }
                if !target_has_rest_element && target_arity < source_min_length {
                    if REPORT {
                        let args = vec![source_min_length.to_string(), target_arity.to_string()];
                        r.report_error(2619, args);
                    }
                    return Ternary::FALSE;
                }
                if !target_has_rest_element && (source_rest || target_arity < source_arity) {
                    if REPORT {
                        if source_min_length < target_min_length {
                            r.report_error(2620, vec![target_min_length.to_string()]);
                        } else {
                            r.report_error(2621, vec![target_arity.to_string()]);
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
                            r.report_error(2624, vec![target_position.to_string()]);
                        }
                        return Ternary::FALSE;
                    }
                    if source_flag.contains(ElemFlags::VARIADIC)
                        && !target_flag.intersects(variable)
                    {
                        if REPORT {
                            let args =
                                vec![source_position.to_string(), target_position.to_string()];
                            r.report_error(2625, args);
                        }
                        return Ternary::FALSE;
                    }
                    if target_flag.contains(ElemFlags::REQUIRED)
                        && !source_flag.contains(ElemFlags::REQUIRED)
                    {
                        if REPORT {
                            r.report_error(2623, vec![target_position.to_string()]);
                        }
                        return Ternary::FALSE;
                    }
                    // Only as long as positions are what they seem.
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
                    // An element that can be left out holds what stands for that (`tuple`).
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
                                let args = vec![
                                    target_start_count.to_string(),
                                    (source_arity - target_end_count - 1).to_string(),
                                    target_position.to_string(),
                                ];
                                r.report_error(2627, args);
                            } else {
                                let args =
                                    vec![source_position.to_string(), target_position.to_string()];
                                r.report_error(2626, args);
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
        let for_now = self.shapes_for_now.len();
        let (Some(sm), Some(tm)) = (self.members(source), self.members(target)) else {
            return Ternary::FALSE;
        };
        // A shape that is kept stays as it is.
        if self.shapes_for_now.len() == for_now {
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
                // `shouldReportUnmatchedPropertyError`: a function that lacks what an object has is not that kind of thing.
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
                        let (name, in_type) =
                            (self.prop_to_string(sp), self.type_to_string(target));
                        r.report_error(2339, vec![name, in_type]);
                    }
                    return Ternary::FALSE;
                }
            }
        }
        // `SymbolFlagsPrototype`: what a class makes is seen to by its construct signatures.
        let target_is_class = matches!(
            td,
            TypeData::Anon {
                origin: Origin::ClassStatic(_),
                ..
            }
        );
        // `getNamedMembers`: what nothing declares, the elements and the length of a tuple, comes last, by name. It decides which one
        // is reported.
        let mut in_order: Vec<&Prop> = Vec::new();
        if REPORT && matches!(td, TypeData::Tuple { .. }) {
            in_order.extend(&tm.shape().props);
            let atoms = &self.files().atoms;
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
            if source_mapper == tm.mapper && sp.mapper == tp.mapper && sp.source == tp.source {
                continue;
            }
            let given = self.type_of_prop_as_read(sp, source_mapper);
            let related = self.property_related_to::<REPORT>(
                r,
                (source, target),
                sp,
                given,
                tp,
                tm.mapper,
                state,
                r.relation == Relation::Comparable,
            );
            if !related.holds() {
                if self.trace_relations {
                    let depth = r.source_stack.len();
                    eprintln!(
                        "{:depth$}not related at .{}",
                        "",
                        self.p.files.atoms.text(tp.name)
                    );
                }
                return Ternary::FALSE;
            }
            result &= related;
        }
        result
    }

    /// `propertyRelatedTo`. `of`: `source` and `target`, the two types the properties are of. `given`: the type of the source property, or
    /// the one of its alternatives that is looked at.
    #[allow(clippy::too_many_arguments)]
    fn property_related_to<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        of: (TypeId, TypeId),
        source_prop: &Prop,
        given: TypeId,
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
                    let name = self.prop_to_string(target_prop);
                    if sf.contains(PropFlags::PRIVATE) && tf.contains(PropFlags::PRIVATE) {
                        r.report_error(2442, vec![name]);
                    } else {
                        let (private_in, other) = if sf.contains(PropFlags::PRIVATE) {
                            (source, target)
                        } else {
                            (target, source)
                        };
                        let (private_in, other) =
                            (self.type_to_string(private_in), self.type_to_string(other));
                        r.report_error(2325, vec![name, private_in, other]);
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
                    let args = vec![
                        self.prop_to_string(target_prop),
                        self.type_to_string(source_type),
                        self.type_to_string(target_type),
                    ];
                    r.report_error(2443, args);
                }
                return Ternary::FALSE;
            }
        } else if sf.contains(PropFlags::PROTECTED) {
            if REPORT {
                let args = vec![
                    self.prop_to_string(target_prop),
                    self.type_to_string(source),
                    self.type_to_string(target),
                ];
                r.report_error(2444, args);
            }
            return Ternary::FALSE;
        }
        // So that which of `{ readonly a }` and `{ a }` stays in a union does not depend on the order they are written in.
        if r.relation == Relation::StrictSubtype
            && sf.contains(PropFlags::READONLY)
            && !tf.contains(PropFlags::READONLY)
        {
            return Ternary::FALSE;
        }
        // `isPropertySymbolTypeRelated`
        let wanted = self.type_of_prop_as_read(target_prop, target_mapper);
        let related = if self.has_any_flag(wanted)
            || wanted == TypeId::UNRESOLVED
            || wanted == TypeId::UNKNOWN && r.relation != Relation::StrictSubtype
        {
            Ternary::TRUE
        } else {
            self.is_related_to_ex::<REPORT>(r, given, wanted, REC_BOTH, state)
        };
        if !related.holds() {
            if REPORT {
                let name = self.prop_to_string(target_prop);
                r.report_error(2326, vec![name]);
            }
            return Ternary::FALSE;
        }
        // `SymbolFlagsClassMember`: what a module, a namespace or an enum exports is no member.
        if !skip_optional
            && sf.contains(PropFlags::OPTIONAL)
            && !tf.contains(PropFlags::OPTIONAL)
            && !matches!(target_prop.source, PropSource::Symbol(_))
        {
            if REPORT {
                let args = vec![
                    self.prop_to_string(target_prop),
                    self.type_to_string(source),
                    self.type_to_string(target),
                ];
                r.report_error(2327, args);
            }
            return Ternary::FALSE;
        }
        related
    }

    /// The class a property is declared in.
    pub(super) fn declaring_class(&self, prop: &Prop) -> Option<Sym> {
        let (file, member) = match &prop.source {
            PropSource::Members(members) => *members.first()?,
            PropSource::Parameter(file, param) => {
                let bound = self.bound(*file);
                match bound.fns[bound.param_fn[param.idx()].idx()].owner {
                    crate::bind::FnOwner::Member(member) => (*file, member),
                    _ => return None,
                }
            }
            // `this.name = value` in a member of a class.
            PropSource::Assigned(file, assignments) => {
                let first = *assignments.first()?;
                let bound = self.bound(*file);
                let class = bound.this_property(self.hir(*file), first)?.0;
                return Some(self.files().sym(*file, bound.class_symbol[class.idx()]));
            }
            _ => return None,
        };
        match self.bound(file).member_owner[member.idx()] {
            crate::bind::MemberOwner::Class(c) => Some(
                self.files()
                    .sym(file, self.bound(file).class_symbol[c.idx()]),
            ),
            _ => None,
        }
    }

    /// `isValidOverrideOf`
    pub(super) fn is_valid_override_of(&mut self, source_prop: &Prop, target_prop: &Prop) -> bool {
        if source_prop.source == target_prop.source {
            return true;
        }
        let (mut sources, mut targets) = (Vec::new(), Vec::new());
        push_underlying_props(source_prop, &mut sources);
        push_underlying_props(target_prop, &mut targets);
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
        match *self.p.types.sig(sig) {
            // `getDefaultConstructSignatures`, `getSignatureFromDeclaration`: of several classes of one name the first is the class.
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
            // `someSignature`: that of a union is if that of some member is.
            SigData::Synth { ref of, .. } => {
                of.iter().any(|&part| self.is_abstract_signature(part))
            }
            // `cloneSignature` keeps the flags.
            SigData::WithReturn { sig, .. } => self.is_abstract_signature(sig),
        }
    }

    /// `private`, `protected` or neither, of the constructor `sig` is declared as. `None`: it has no declaration.
    pub(super) fn constructor_accessibility(&mut self, sig: SigId) -> Option<Flags> {
        let mut sig = sig;
        for _ in 0..64 {
            match *self.p.types.sig(self.p.types.sig_origin(sig)) {
                SigData::Construct { file, func, .. } | SigData::Decl { file, func, .. } => {
                    return Some(self.hir(file)[func].flags & (Flags::PRIVATE | Flags::PROTECTED));
                }
                // `getDefaultConstructSignatures`: a clone of one of the base class, declared where that one is.
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

    /// `sd`, `td`: what `source` and `target` are. `both`: what `members` says of them, if that is known.
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
                let related = self.signatures_identical_to(r, s, t);
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
                    r.report_error(2517, Vec::new());
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
                        let args = vec![visibility_to_string(s), visibility_to_string(t)];
                        r.report_error(2672, args);
                    }
                    return Ternary::FALSE;
                }
            }
        }
        let mut result = Ternary::TRUE;
        // `ObjectFlagsInstantiated`: not the type as it is declared.
        let is_instantiated =
            |c: &Self, mapper: MapperId| c.p.types.mapping(mapper).iter().any(|p| p.0 != p.1);
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
                // Only what is wrong with the first is said.
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
                    let (source, signature) =
                        (self.type_to_string(source), self.signature_to_string(t));
                    r.report_error(2658, vec![source, signature]);
                }
                return Ternary::FALSE;
            }
        }
        result
    }

    /// `signatureRelatedTo`. `construct`: which `incompatibleReporter` it is given.
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
        let (given, wanted) = (source, target);
        let (source, target) = if erase {
            (self.erased_sig(source), self.erased_sig(target))
        } else {
            (source, target)
        };
        self.compare_signatures_related::<REPORT>(
            r,
            source,
            target,
            (given, wanted),
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

    /// `sig` with its own type parameters `params` replaced by `values`, and nothing else: what has been filled in for the
    /// type parameters around it may mention the same declarations (`then` of what `then` returns), and means others.
    pub(super) fn with_own_type_params(
        &mut self,
        sig: SigId,
        params: &[TypeId],
        values: &[TypeId],
    ) -> SigId {
        let declared_as = |c: &Self, t: TypeId| match *c.data(t) {
            TypeData::TypeParam(file, tp, ..) => Some((file, tp)),
            _ => None,
        };
        let extended = |c: &mut Self, own: MapperId| {
            let mut pairs = c.p.types.mapping(own).to_vec();
            for (&param, &value) in params.iter().zip(values) {
                // In something instantiated it is a clone, which the declared one stands for (`cloneTypeParameter`).
                let declared = pairs.iter().position(|pair| {
                    pair.1 == param
                        && pair.0 != param
                        && declared_as(c, pair.0) == declared_as(c, param)
                });
                match declared {
                    Some(i) => pairs[i].1 = value,
                    None => pairs.push((param, value)),
                }
            }
            c.p.types.mapper(pairs)
        };
        let data = match *self.p.types.sig(sig) {
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
            // `cloneSignature`: the same signature, and what it returns goes along.
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
        self.p.types.intern_sig(data)
    }

    /// `isTopSignature`: `(...args: any[]) => any`, `(...args: never) => unknown`: what every function is.
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

    /// `isInstantiatedGenericParameter`. `target`: `Signature.target` of `sig`, once it has been asked for.
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

    /// The signature as declared that `sig` is an instantiation of.
    fn sig_instantiated_from(&mut self, sig: SigId) -> Option<SigId> {
        // `cloneSignature` keeps the target.
        let sig = self.p.types.sig_origin(sig);
        let (file, func, _) = self.sig_decl(sig)?;
        let declared = self.sig_of_fn(file, func);
        (declared != sig).then_some(declared)
    }

    /// The tuple a rest parameter is declared as, if it is one.
    fn rest_tuple(&self, params: &[SigParam]) -> Option<(&'p [TypeId], &'p [ElemFlags])> {
        let last = params.last().filter(|p| p.rest)?;
        match self.data(last.ty) {
            TypeData::Tuple { elems, flags, .. } => Some((elems, flags)),
            _ => None,
        }
    }

    fn fixed_length(flags: &[ElemFlags]) -> usize {
        flags
            .iter()
            .position(|f| f.intersects(ElemFlags::REST | ElemFlags::VARIADIC))
            .unwrap_or(flags.len())
    }

    /// `getParameterCount`: a rest parameter counts as one, a tuple for what is in it.
    pub(super) fn parameter_count(&self, params: &[SigParam]) -> usize {
        match self.rest_tuple(params) {
            Some((_, flags)) => {
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
                .is_none_or(|(_, flags)| Self::fixed_length(flags) != flags.len()),
            _ => false,
        }
    }

    /// `getMinArgumentCount`
    pub(super) fn min_argument_count(&mut self, params: &[SigParam]) -> usize {
        let mut count = None;
        if let Some((_, flags)) = self.rest_tuple(params) {
            let required = flags
                .iter()
                .position(|f| !f.contains(ElemFlags::REQUIRED))
                .unwrap_or(Self::fixed_length(flags));
            if required > 0 {
                count = Some(params.len() - 1 + required);
            }
        }
        let mut count = count.unwrap_or_else(|| Self::min_args(params));
        // What takes `void` last can go without.
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
            TypeData::Tuple { elems, flags, .. } => {
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
        let rest = self.params_as_tuple(params, pos);
        match self.array_element(rest) {
            Some(element) if self.is_any(element) => TypeId::ANY,
            _ => rest,
        }
    }

    /// `compareSignaturesRelated`. `as_given`: the two before their type parameters were erased.
    pub(super) fn compare_signatures_related<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: SigId,
        target: SigId,
        as_given: (SigId, SigId),
        check_mode: u8,
        state: u8,
    ) -> Ternary {
        if r.relation != Relation::Permissive {
            return self.compare_signatures_inside::<REPORT>(
                r, source, target, as_given, check_mode, state,
            );
        }
        let around = self.own_of_compared_sigs.len();
        let own = self.sig_type_params(target);
        self.own_of_compared_sigs.extend_from_slice(&own);
        let result = self
            .compare_signatures_inside::<REPORT>(r, source, target, as_given, check_mode, state);
        self.own_of_compared_sigs.truncate(around);
        result
    }

    fn compare_signatures_inside<const REPORT: bool>(
        &mut self,
        r: &mut Relater,
        source: SigId,
        target: SigId,
        as_given: (SigId, SigId),
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
        let has_generic_params = {
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
                    r.report_error(2849, vec![least.to_string(), target_count.to_string()]);
                }
                return Ternary::FALSE;
            }
            sp.iter().any(|p| self.has_type_variables(p.ty))
        };
        // `assignContextualParameterTypes`: a context-sensitive function expression adopts the type parameters of a generic
        // contextual signature. They only matter when a parameter type mentions them.
        if has_generic_params {
            source = self.with_adopted_type_params(source);
        }
        let source_type_params = self.sig_type_params(source);
        if !source_type_params.is_empty() && source_type_params != self.sig_type_params(target) {
            // tsgo compares permissive and restrictive instantiations. Here the declared type parameters stand in for theirs.
            let stand_ins = Some(r.relation).filter(|relation| {
                matches!(relation, Relation::Permissive | Relation::Restrictive)
            });
            source = self.instantiate_sig_in_context_under(source, target, true, stand_ins);
        }
        let sp = self.sig_params(source);
        let source_count = self.parameter_count(&sp);
        let (source_rest, target_rest) =
            (self.non_array_rest_type(&sp), self.non_array_rest_type(&tp));
        if let Some(rest) = source_rest.or(target_rest) {
            self.report_unreliable(rest);
        }
        // What a method takes may be more or less than what is asked for; anything else has to take all of it.
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
                    r.report_error(2685, Vec::new());
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
        let mut given_from = (None, None);
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
            // Parameters are compared both ways, so that `Foo<T>` is at least covariant in `T` however it uses it. Two callbacks
            // are compared signature to signature the other way round: what a callback takes is given, like a result. That
            // keeps `Promise<T>` covariant and not bivariant.
            let mut callbacks = None;
            if check_mode & CALLBACK == 0
                && !self.is_instantiated_generic_parameter_of(&mut given_from.0, as_given.0, i)
                && !self.is_instantiated_generic_parameter_of(&mut given_from.1, as_given.1, i)
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
                if self.trace_relations {
                    let depth = r.source_stack.len();
                    eprintln!(
                        "{:depth$}parameter {i} (strict {strict_variance}, callbacks {})",
                        "",
                        callbacks.is_some()
                    );
                }
                if REPORT {
                    let names = vec![
                        self.labeled_parameter_name_at_position(source, &sp, i),
                        self.labeled_parameter_name_at_position(target, &tp, i),
                    ];
                    r.report_error(2328, names);
                }
                return Ternary::FALSE;
            }
            result &= related;
        }
        if check_mode & IGNORE_RETURN_TYPES != 0 {
            return result;
        }
        // What is being worked out is anything for now, and that is nobody's error.
        let target_return = if self.is_resolving_return_type(target) {
            TypeId::ANY
        } else {
            self.sig_return(target)
        };
        if target_return == TypeId::VOID || self.is_any(target_return) {
            return result;
        }
        let source_return = if self.is_resolving_return_type(source) {
            TypeId::ANY
        } else {
            self.sig_return(source)
        };
        if let Some(wanted) = self.sig_predicate(target) {
            match self.sig_predicate(source) {
                Some(given) => {
                    result &= self.compare_type_predicate_related_to::<REPORT>(
                        r,
                        (&given, &sp[..]),
                        (&wanted, &tp[..]),
                        state,
                    );
                }
                // Only a type guard does where one is asked for.
                None if !wanted.asserts => {
                    if REPORT {
                        let signature = self.signature_to_string(source);
                        r.report_error(1224, vec![signature]);
                    }
                    return Ternary::FALSE;
                }
                None => {}
            }
        } else {
            // What callbacks return is compared both ways too, or `interface Foo<T> { add(cb: () => T): void }` would not be
            // covariant in `T`.
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
            if !related.holds() && self.trace_relations {
                let depth = r.source_stack.len();
                eprintln!("{:depth$}what is returned", "");
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
                r.report_error(marker, Vec::new());
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
        let (given, wanted) = (source.0, target.0);
        let mut related = Ternary::FALSE;
        if (given.asserts, given.param.is_none()) != (wanted.asserts, wanted.param.is_none()) {
            if REPORT {
                r.report_error(2518, Vec::new());
            }
        } else if given.param != wanted.param {
            if REPORT {
                let names = vec![
                    self.parameter_name_at_position(source.1, given.param.unwrap_or(0)),
                    self.parameter_name_at_position(target.1, wanted.param.unwrap_or(0)),
                ];
                r.report_error(1227, names);
            }
        } else {
            related = match (given.ty, wanted.ty) {
                (a, b) if a == b => Ternary::TRUE,
                (Some(a), Some(b)) => self.is_related_to_ex::<REPORT>(r, a, b, REC_BOTH, state),
                _ => Ternary::FALSE,
            };
        }
        if REPORT && !related.holds() {
            let predicates = vec![
                self.type_predicate_text(given, source.1),
                self.type_predicate_text(wanted, target.1),
            ];
            r.report_error(1226, predicates);
        }
        related
    }

    /// What stands for the type parameters around `sig` where it was found.
    fn sig_around(&self, sig: SigId) -> MapperId {
        match *self.p.types.sig(sig) {
            SigData::Decl { mapper, .. }
            | SigData::Construct { mapper, .. }
            | SigData::DefaultConstruct { mapper, .. } => mapper,
            SigData::WithReturn { sig, .. } => self.sig_around(sig),
            _ => MapperId::IDENTITY,
        }
    }

    /// `compareSignaturesIdentical`
    fn signatures_identical_to(
        &mut self,
        r: &mut Relater,
        source: SigId,
        target: SigId,
    ) -> Ternary {
        if source == target {
            return Ternary::TRUE;
        }
        let (sp, tp) = (self.sig_params(source), self.sig_params(target));
        // `isMatchingSignature`
        if self.parameter_count(&sp) != self.parameter_count(&tp)
            || self.min_argument_count(&sp) != self.min_argument_count(&tp)
            || self.has_effective_rest_parameter(&sp) != self.has_effective_rest_parameter(&tp)
        {
            return Ternary::FALSE;
        }
        let (source_type_params, target_type_params) =
            (self.sig_type_params(source), self.sig_type_params(target));
        if source_type_params.len() != target_type_params.len() {
            return Ternary::FALSE;
        }
        let mut source = source;
        if !target_type_params.is_empty() {
            // What the type parameters extend and default to has to be the same, those of the one in terms of those of the other.
            // A fresh one (`cloneTypeParameter`) says it as seen from where its signature was found. A declared one says it as
            // declared, whatever its signature was found in: that is filled in here, in the one step in which it is renamed.
            let (source_around, target_around) = (self.sig_around(source), self.sig_around(target));
            let renaming = self.mapper_from(&source_type_params, &target_type_params);
            let mut pairs = self.p.types.mapping(source_around).to_vec();
            pairs.extend(
                source_type_params
                    .iter()
                    .copied()
                    .zip(target_type_params.iter().copied()),
            );
            let renaming_as_declared = self.p.types.mapper(pairs);
            let is_declared = |c: &Self, param: TypeId| matches!(*c.data(param), TypeData::TypeParam(_, _, around) if around == MapperId::IDENTITY);
            for (&s, &t) in source_type_params.iter().zip(&target_type_params) {
                if s == t && source_around == target_around {
                    continue;
                }
                let source_mapper = if is_declared(self, s) {
                    renaming_as_declared
                } else {
                    renaming
                };
                let target_mapper = if is_declared(self, t) {
                    target_around
                } else {
                    MapperId::IDENTITY
                };
                let bounds = [
                    (
                        self.constraint_of_type_param(s),
                        self.constraint_of_type_param(t),
                    ),
                    (self.default_of_type_param(s), self.default_of_type_param(t)),
                ];
                for (a, b) in bounds {
                    let a = self.instantiate(a.unwrap_or(TypeId::UNKNOWN), source_mapper);
                    let b = self.instantiate(b.unwrap_or(TypeId::UNKNOWN), target_mapper);
                    // What is not known makes no difference.
                    if self.is_known(a)
                        && self.is_known(b)
                        && !self.is_related_to(r, a, b, REC_BOTH).holds()
                    {
                        return Ternary::FALSE;
                    }
                }
            }
            if source_type_params != target_type_params {
                source =
                    self.with_own_type_params(source, &source_type_params, &target_type_params);
            }
        }
        let mut result = Ternary::TRUE;
        if let (Some(s), Some(t)) = (self.sig_this_type(source), self.sig_this_type(target)) {
            let related = self.is_related_to(r, s, t, REC_BOTH);
            if !related.holds() {
                return Ternary::FALSE;
            }
            result &= related;
        }
        let sp = self.sig_params(source);
        for i in 0..self.parameter_count(&tp) {
            let s = self.param_type_at(&sp, i).unwrap_or(TypeId::ANY);
            let t = self.param_type_at(&tp, i).unwrap_or(TypeId::ANY);
            let related = self.is_related_to(r, t, s, REC_BOTH);
            if !related.holds() {
                return Ternary::FALSE;
            }
            result &= related;
        }
        // `compareTypePredicatesIdentical`
        match (self.sig_predicate(source), self.sig_predicate(target)) {
            (None, None) => {
                let (sr, tr) = (self.sig_return(source), self.sig_return(target));
                result & self.is_related_to(r, sr, tr, REC_BOTH)
            }
            (Some(s), Some(t)) if s.param == t.param && s.asserts == t.asserts => {
                match (s.ty, t.ty) {
                    (a, b) if a == b => result,
                    (Some(a), Some(b)) => result & self.is_related_to(r, a, b, REC_BOTH),
                    _ => Ternary::FALSE,
                }
            }
            _ => Ternary::FALSE,
        }
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

    /// `both`: what `members` says of `source` and of `target`, if that is known.
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
            let wanted = self.instantiate(info.value, tm.mapper);
            let related = if r.relation != Relation::StrictSubtype
                && !source_is_primitive
                && target_has_string_index
                && self.is_any(wanted)
            {
                Ternary::TRUE
            } else if target_has_string_index && self.is_generic_mapped_type(source) {
                let template = self.mapped_template(source);
                self.is_related_to_ex::<REPORT>(r, template, wanted, REC_BOTH, STATE_NONE)
            } else {
                self.type_related_to_index_info::<REPORT>(r, source, info.key, wanted, state)
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
        wanted: TypeId,
        state: u8,
    ) -> Ternary {
        let Some(sm) = self.members(source) else {
            return Ternary::FALSE;
        };
        if let Some(given) = self.applicable_index_info(&sm, key, None) {
            // `getApplicableIndexInfo`: the signature for the same keys, or else the one for strings.
            let source_key = if !REPORT || sm.shape().index.iter().any(|i| i.key == key) {
                key
            } else {
                TypeId::STRING
            };
            let (source, target) = ((source_key, given), (key, wanted));
            return self.index_info_related_to::<REPORT>(r, source, target, state);
        }
        // A part of an intersection is never taken to have an index signature for what it has. For a strict subtype only an
        // object literal as written is, so that `{ [x: string]: X }` is one of `{}` and not the other way round as well.
        if state & STATE_SOURCE == 0
            && (r.relation != Relation::StrictSubtype || self.is_fresh_object_literal_type(source))
        {
            let looks = self.apparent_type_of_intersection(source);
            if self.is_object_type_with_inferable_index(looks) {
                return self.members_related_to_index_info::<REPORT>(r, &sm, key, wanted, state);
            }
        }
        if REPORT {
            let (key, source) = (self.type_to_string(key), self.type_to_string(source));
            r.report_error(2329, vec![key, source]);
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
        // `getRegularTypeOfObjectLiteral` leaves the index signatures as they are.
        let state = state & !STATE_REGULAR;
        let related = self.is_related_to_ex::<REPORT>(r, source.1, target.1, REC_BOTH, state);
        if REPORT && !related.holds() {
            let source_key = self.type_to_string(source.0);
            if source.0 == target.0 {
                r.report_error(2634, vec![source_key]);
            } else {
                let target_key = self.type_to_string(target.0);
                r.report_error(2330, vec![source_key, target_key]);
            }
        }
        related
    }

    /// `getApparentTypeOfIntersectionType`: the intersection of what the members of `ty` look like. `apparent_type` leaves an
    /// intersection whose members all look like objects as it is, and `members` puts its shape together from what they look like.
    pub(super) fn apparent_type_of_intersection(&mut self, ty: TypeId) -> TypeId {
        let TypeData::Intersection(parts) = self.data(ty) else {
            return ty;
        };
        if !parts
            .iter()
            .any(|&p| self.intersection_member_looks_otherwise(p))
        {
            return ty;
        }
        let looks: Vec<TypeId> = parts
            .iter()
            .map(|&p| {
                if self.intersection_member_looks_otherwise(p) {
                    self.apparent_type(p)
                } else {
                    p
                }
            })
            .collect();
        self.intersection(&looks)
    }

    /// Whether `apparent_type_of_intersection` puts something else for the member `p`.
    fn intersection_member_looks_otherwise(&self, p: TypeId) -> bool {
        p == TypeId::OBJECT || self.is_deferred(p) || self.has_primitive_flag(p)
    }

    /// Whether `getApparentType(ty)` is `emptyObjectType`, which is what `object` looks like. It has no symbol, unlike a `{}` that
    /// is written, and here the two are one type. Of what counts as `{}` in an intersection `addTypeToIntersection` takes the
    /// first. `restrictive`: `ty` stands for its restrictive instantiation, whose type parameters extend nothing.
    pub(super) fn looks_like_the_object_keyword(&mut self, ty: TypeId, restrictive: bool) -> bool {
        let ty = if restrictive && is_type_param_kind(self.data(ty)) {
            TypeId::UNKNOWN
        } else if self.is_deferred(ty) {
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
            let look = if restrictive && is_type_param_kind(self.data(p)) {
                self.apparent_type(TypeId::UNKNOWN)
            } else if p == TypeId::OBJECT || self.is_deferred(p) {
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
        first.is_some_and(|p| self.looks_like_the_object_keyword(p, restrictive))
    }

    /// `isObjectTypeWithInferableIndex`: known to have nothing but what is seen.
    pub(super) fn is_object_type_with_inferable_index(&mut self, t: TypeId) -> bool {
        match self.data(t) {
            // It has no symbol.
            TypeData::Synth(shape)
                if matches!(
                    shape.literal,
                    Literalness::OfUnknown | Literalness::AutoArray
                ) =>
            {
                false
            }
            TypeData::Intersection(parts) => parts
                .iter()
                .all(|&p| self.is_object_type_with_inferable_index(p)),
            // `cloneTypeAsModuleType`: its symbol has the flags of what is imported, and no signatures are left.
            TypeData::Anon {
                origin: Origin::Namespace { module, .. },
                ..
            } => {
                let flags = self.files().flags(*module);
                flags.intersects(SymFlags::ENUM | SymFlags::VALUE_MODULE)
                    && !flags.contains(SymFlags::CLASS)
            }
            // What it was made from says.
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
        if self.files().atoms.is_symbol_name(name) {
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
        wanted: TypeId,
        state: u8,
    ) -> Ternary {
        let mut result = Ternary::TRUE;
        let is_jsx = sm.shape().literal == Literalness::JsxAttributes;
        for prop in &sm.shape().props {
            // `isIgnoredJsxProperty`
            if is_jsx && self.files().atoms.bytes(prop.name).contains(&b'-') {
                continue;
            }
            if !self.is_name_applicable_to_index(prop.name, key) {
                continue;
            }
            // A property that can be left out is held to the index signature for what it is when it is there.
            let declared = self.type_of_prop_as_read(prop, sm.mapper);
            let given = if self.p.files.options.exact_optional_property_types
                || declared.is_undefined()
                || key == TypeId::NUMBER
                || !prop.flags.contains(PropFlags::OPTIONAL)
            {
                declared
            } else {
                self.without_undefined(declared)
            };
            let related = self.is_related_to_ex::<REPORT>(r, given, wanted, REC_BOTH, state);
            if !related.holds() {
                if REPORT {
                    let name = self.prop_to_string(prop);
                    r.report_error(2530, vec![name]);
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
                let given = self.instantiate(info.value, sm.mapper);
                let (source, target) = ((info.key, given), (key, wanted));
                let related = self.index_info_related_to::<REPORT>(r, source, target, state);
                if !related.holds() {
                    return Ternary::FALSE;
                }
                result &= related;
            }
        }
        result
    }

    // ───────────────────────────── patterns of strings ─────────────────────────────

    /// `templateLiteralTypesDefinitelyUnrelated`: they start or end differently.
    fn templates_definitely_unrelated(&self, source: &[Atom], target: &[Atom]) -> bool {
        let atoms = &self.files().atoms;
        let (ss, ts) = (atoms.bytes(source[0]), atoms.bytes(target[0]));
        let (se, te) = (
            atoms.bytes(source[source.len() - 1]),
            atoms.bytes(target[target.len() - 1]),
        );
        let (start, end) = (ss.len().min(ts.len()), se.len().min(te.len()));
        ss[..start] != ts[..start] || se[se.len() - end..] != te[te.len() - end..]
    }

    /// `isTypeMatchedByTemplateLiteralType`
    pub(super) fn is_matched_by_template(
        &mut self,
        source: TypeId,
        texts: &[Atom],
        types: &[TypeId],
    ) -> bool {
        match self.data(source) {
            // `TypeFlagsStringLiteral`, which a member of an enum that is a string has too.
            TypeData::StringLit { value, .. }
            | TypeData::EnumLit {
                value: EnumValue::String(value),
                ..
            } => self.matches_template(*value, texts, types),
            TypeData::Template {
                texts: st,
                types: sy,
            } => {
                let Some(pieces) = self.template_pieces(st, sy, texts, types) else {
                    return false;
                };
                pieces
                    .into_iter()
                    .zip(types.iter())
                    .all(|(piece, &hole)| self.fits_placeholder(piece, hole))
            }
            _ => false,
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
                // The same mappings leave it as it is, and it fits what is mapped.
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

    /// What each placeholder of the template `target_texts`/`target_types` stands for in a string made of `texts` with
    /// `types` in between, if such a string can be of that form at all.
    pub(super) fn template_pieces(
        &mut self,
        texts: &[Atom],
        types: &[TypeId],
        target_texts: &[Atom],
        target_types: &[TypeId],
    ) -> Option<Vec<TypeId>> {
        if texts == target_texts {
            let mut pieces = Vec::with_capacity(types.len());
            for (&s, &t) in types.iter().zip(target_types) {
                let (sb, tb) = (self.constraint_or_self(s), self.constraint_or_self(t));
                // An `infer` in a template stands for a piece of a string, though it does not say so.
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
                        let empty = self.files().atoms.intern(b"");
                        self.template_type(&[empty, empty], &[s])
                    },
                );
            }
            return Some(pieces);
        }
        let atoms = &self.files().atoms;
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
                        .and_then(|rest| rest.windows(delimiter.len()).position(|w| w == delimiter))
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
                (seg, pos + first_char_len(&text_of(seg)[pos..]))
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

    /// `isValidTypeForTemplateLiteralPlaceholder`: whether `piece` can be what is written for a placeholder of type `hole`.
    pub(super) fn fits_placeholder(&mut self, piece: TypeId, hole: TypeId) -> bool {
        if let TypeData::Intersection(parts) = self.data(hole) {
            return parts
                .iter()
                .all(|&p| p == TypeId::EMPTY_OBJECT || self.fits_placeholder(piece, p));
        }
        if hole == TypeId::STRING || self.is_assignable(piece, hole) {
            return true;
        }
        match self.data(piece) {
            TypeData::StringLit { value, .. } => {
                let text = self.files().atoms.bytes(*value);
                match self.data(hole) {
                    TypeData::Intrinsic(Intrinsic::Number) => is_valid_number_string(text),
                    TypeData::Intrinsic(Intrinsic::BigInt) => is_valid_bigint_string(text),
                    TypeData::BoolLit { value, .. } => {
                        text == if *value { &b"true"[..] } else { &b"false"[..] }
                    }
                    _ if hole.is_undefined() => text == b"undefined",
                    _ if hole.is_null() => text == b"null",
                    // A string mapping or a template it is a member of takes it as it is, which was asked above.
                    _ => false,
                }
            }
            TypeData::Template { texts, types } => {
                texts.len() == 2
                    && texts
                        .iter()
                        .all(|&t| self.files().atoms.bytes(t).is_empty())
                    && self.is_assignable(types[0], hole)
            }
            _ => false,
        }
    }

    /// `isTypeMatchedByTemplateLiteralType` of the string `value`: `inferFromLiteralPartsToTemplateLiteral` of one text, piece by
    /// piece.
    fn matches_template(&mut self, value: Atom, texts: &[Atom], types: &[TypeId]) -> bool {
        let text = self.files().atoms.bytes(value);
        let first = self.files().atoms.bytes(texts[0]);
        let last = self.files().atoms.bytes(texts[texts.len() - 1]);
        if text.len() < first.len() + last.len()
            || !text.starts_with(first)
            || !text.ends_with(last)
        {
            return false;
        }
        let mut rest = &text[first.len()..text.len() - last.len()];
        for (i, &ty) in types.iter().enumerate() {
            let is_last = i + 1 == types.len();
            let piece: &[u8] = if is_last {
                std::mem::take(&mut rest)
            } else {
                let delimiter = self.files().atoms.bytes(texts[i + 1]);
                let at = if !delimiter.is_empty() {
                    match rest.windows(delimiter.len()).position(|w| w == delimiter) {
                        Some(at) => at,
                        None => return false,
                    }
                } else if !rest.is_empty() {
                    // With nothing in between, a placeholder takes one character.
                    first_char_len(rest)
                } else {
                    return false;
                };
                let piece = &rest[..at];
                rest = &rest[at + delimiter.len()..];
                piece
            };
            // Whatever the piece is. No type need be made of it.
            if ty == TypeId::STRING || self.is_any(ty) {
                continue;
            }
            let literal = self.files().atoms.intern(piece);
            let literal = self.string_literal(literal, false);
            if !self.fits_placeholder(literal, ty) {
                return false;
            }
        }
        true
    }
}

/// `forEachProperty`: appends the properties `prop` stands for. A property of an intersection stands for the properties of the
/// constituents, any other property for itself.
fn push_underlying_props<'a>(prop: &'a Prop, out: &mut Vec<&'a Prop>) {
    match &prop.source {
        PropSource::Intersected(_, parts) => parts
            .iter()
            .for_each(|part| push_underlying_props(part, out)),
        _ => out.push(prop),
    }
}

/// How many bytes the character `text` starts with takes.
fn first_char_len(text: &[u8]) -> usize {
    let len = match text.first().copied() {
        None => 0,
        Some(0xF0..) => 4,
        Some(0xE0..=0xEF) => 3,
        Some(0xC0..=0xDF) => 2,
        Some(_) => 1,
    };
    len.min(text.len())
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
    let unsigned = s.strip_prefix(['+', '-']).unwrap_or(s);
    // Rust takes `inf`, `infinity` and `nan` too.
    unsigned.starts_with(|c: char| c.is_ascii_digit() || c == '.')
        && unsigned
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'e' | b'E' | b'+' | b'-'))
        && unsigned.parse::<f64>().is_ok_and(f64::is_finite)
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
