//! Construction of union and intersection types.

use super::*;
use crate::util::{PositionSet, fx_hash};

/// A declaration's sort key for `compareNodes`: library files first, then by file, then by position.
type DeclarationPosition = (bool, FileId, u32);

/// The members of a union or an intersection under construction.
type Flat = smallvec::SmallVec<[TypeId; 16]>;

/// What the flags of an intersection's members say about it.
#[derive(Copy, Clone, Default)]
struct MembersByFlags {
    /// `includes` in `addTypeToIntersection`.
    includes: u32,
    /// The first member that has one of the `tf::UNIT` flags.
    unit: Option<TypeId>,
}

impl MembersByFlags {
    /// `ty`, which has `flags`, as the only member. The missing type is the member `undefined`.
    fn of(ty: TypeId, flags: u32) -> MembersByFlags {
        let unit = match ty {
            TypeId::MISSING => TypeId::UNDEFINED,
            _ => ty,
        };
        MembersByFlags {
            includes: flags & tf::INCLUDES_MASK,
            unit: (flags & tf::UNIT != 0).then_some(unit),
        }
    }

    /// Adds the members of `other`.
    fn add(&mut self, other: MembersByFlags) {
        // No value has two different unit types. Setting the `object` flag next to the unit flags signals that to
        // `has_disjoint_domains`.
        if other.unit.is_some() && other.unit != self.unit && self.includes & tf::UNIT != 0 {
            self.includes |= tf::NON_PRIMITIVE;
        }
        self.includes |= other.includes;
        self.unit = self.unit.or(other.unit);
    }
}

/// How much `create_union` read to build its result.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Inspected {
    /// Only the members. It evaluated nothing, so a second call with the same types has no observable effect.
    Members,
    /// Also whether string literal types match pattern literal types. That depends only on the two types, so the same
    /// types give the same result for any caller.
    Patterns,
    /// Also the constraints of type variables.
    Constraints,
}

/// A member of a union that's being merged, with the data `CompareTypes` looks at first.
#[derive(Copy, Clone)]
struct Ranked<'p> {
    ty: TypeId,
    /// `sort_order_flags`
    flags: u32,
    /// `sort_name`, once `has_name` is set. Most members are never compared with a member of another run that has the
    /// same flags.
    name: Option<&'p [u8]>,
    has_name: bool,
}

type Run<'p> = smallvec::SmallVec<[Ranked<'p>; 16]>;

/// When one run is at least this many times as long as the other, the shorter run's members are inserted one by one
/// with a binary search.
const MUCH_LONGER: usize = 8;

/// More runs than this are sorted as one list. Every member then takes part in a comparison anyway, so every name is
/// looked up, and the standard library's sort exploits runs too.
const MAX_RUNS_TO_MERGE: usize = 8;

/// See `join_by_position`.
const MAX_STEPS_PER_POSITION: usize = 32;

/// `UnionReduction`. `UnionReductionSubtype` compares the members, so calls with it aren't cached.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
enum Reduction {
    None,
    /// See `union_ex`.
    Literal {
        merge_constrained: bool,
    },
}

/// The arguments of `getUnionTypeEx`.
#[derive(Copy, Clone)]
struct UnionArguments<'a> {
    reduction: Reduction,
    types: &'a [TypeId],
    alias: Option<(Sym, &'a [TypeId])>,
}

impl<'a> UnionArguments<'a> {
    fn alias_type_arguments(&self) -> &'a [TypeId] {
        self.alias.map_or(&[][..], |alias| alias.1)
    }

    /// Hashes only the length and both ends of a long list, because a list of hundreds of types is mostly seen once.
    /// `UnionCalls::get` compares the whole list.
    fn hash(&self) -> u64 {
        const END: usize = 16;
        let (first, last) = match self.types.len() > 2 * END {
            true => (&self.types[..END], &self.types[self.types.len() - END..]),
            false => (self.types, &[][..]),
        };
        fx_hash(&(self.reduction, self.alias, self.types.len(), first, last))
    }
}

#[derive(Copy, Clone)]
struct CachedUnionCall {
    /// `UnionArguments::hash`
    hash: u64,
    reduction: Reduction,
    alias: Option<Sym>,
    /// Offset of the types in `UnionCalls::types`. The alias type arguments follow them.
    start: u32,
    /// Number of types. 0 means the slot is empty.
    types: u32,
    alias_type_arguments: u32,
    answer: TypeId,
}

/// FOR SPEED: the most recent `getUnionTypeEx` calls that `recent_unions` and `recent_unreduced_unions`, which only
/// hold pairs, don't cover, with their results. A hit returns before anything is flattened. The types are stored in the
/// order they were passed.
///
/// Only a call that reads nothing but its members is cached (`Inspected::Members`). Such a call creates types only the
/// first time, its marks persist, and it evaluates nothing. So the slow path would find the same type again with no
/// other side effect.
///
/// A direct-mapped cache, like `instantiate::Recent`. It belongs to one checker, and a new call overwrites whatever was
/// in its slot.
#[derive(Default)]
pub(super) struct UnionCalls {
    /// Empty at first, then a power-of-two length.
    slots: Vec<CachedUnionCall>,
    /// A hash shifted right by this amount is an index into `slots`.
    shift: u32,
    /// Number of calls added since `slots` last grew.
    added: usize,
    /// The types of the calls in `slots`, and of calls that were overwritten.
    types: Vec<TypeId>,
}

impl UnionCalls {
    const MAX_SLOTS: usize = 1 << 12;
    /// Everything is dropped once `types` would grow past this. That only costs time.
    const MAX_TYPES: usize = 1 << 20;
    const EMPTY: CachedUnionCall = CachedUnionCall {
        hash: 0,
        reduction: Reduction::None,
        alias: None,
        start: 0,
        types: 0,
        alias_type_arguments: 0,
        answer: TypeId::NEVER,
    };

    #[inline]
    fn slot_index(&self, hash: u64) -> usize {
        (hash.wrapping_mul(0x9E37_79B9_7F4A_7C15) >> self.shift) as usize
    }

    /// `arguments` has at least one type, and `hash` is its hash.
    #[inline]
    fn get(&self, hash: u64, arguments: &UnionArguments) -> Option<TypeId> {
        let call = self.slots.get(self.slot_index(hash))?;
        if call.hash != hash
            || call.types as usize != arguments.types.len()
            || call.reduction != arguments.reduction
            || call.alias != arguments.alias.map(|alias| alias.0)
        {
            return None;
        }
        let len = (call.types + call.alias_type_arguments) as usize;
        let (types, alias_type_arguments) =
            self.types[call.start as usize..][..len].split_at(call.types as usize);
        (types == arguments.types && alias_type_arguments == arguments.alias_type_arguments())
            .then_some(call.answer)
    }

    fn put(&mut self, hash: u64, arguments: &UnionArguments, answer: TypeId) {
        let alias_type_arguments = arguments.alias_type_arguments();
        let len = arguments.types.len() + alias_type_arguments.len();
        if len > Self::MAX_TYPES {
            return;
        }
        if self.types.len() + len > Self::MAX_TYPES {
            self.slots.fill(Self::EMPTY);
            self.types.clear();
            self.added = 0;
        }
        if self.added == self.slots.len() && self.added < Self::MAX_SLOTS {
            self.grow();
        }
        self.added += 1;
        let slot = self.slot_index(hash);
        self.slots[slot] = CachedUnionCall {
            hash,
            reduction: arguments.reduction,
            alias: arguments.alias.map(|alias| alias.0),
            start: self.types.len() as u32,
            types: arguments.types.len() as u32,
            alias_type_arguments: alias_type_arguments.len() as u32,
            answer,
        };
        self.types.extend_from_slice(arguments.types);
        self.types.extend_from_slice(alias_type_arguments);
    }

    #[cold]
    fn grow(&mut self) {
        let len = (self.slots.len() * 4).max(64);
        let old = std::mem::replace(&mut self.slots, vec![Self::EMPTY; len]);
        self.shift = 64 - len.trailing_zeros();
        self.added = 0;
        for call in old {
            if call.types != 0 {
                let slot = self.slot_index(call.hash);
                self.slots[slot] = call;
            }
        }
    }
}

/// `getIntersectionKey`: the set, `IntersectionFlagsNoConstraintReduction`, and the alias if that flag isn't set.
pub(super) type IntersectionKey = (Box<[TypeId]>, bool, Option<(Sym, Box<[TypeId]>)>);

impl crate::util::Windowed for IntersectionKey {
    #[inline]
    fn window(&self) -> crate::util::Window {
        crate::util::Window::of_type(self.0.iter().map(|it| it.0).max().unwrap_or(0))
    }
}

/// `T & P`, as split up by `constrained_type_variable`.
#[derive(Copy, Clone)]
struct ConstrainedTypeVariable {
    /// `T`
    variable: TypeId,
    /// `P`
    primitive: TypeId,
    /// The base constraint of `T`.
    constraint: TypeId,
}

/// A union's pattern literal types, indexed by the text they start with. A string literal can only match a template
/// literal type if it starts with the template's first text, which is the first test in
/// `inferFromLiteralPartsToTemplateLiteral`. With thousands of literals and patterns, testing every pair dominates the
/// check time.
struct PatternsByPrefix<'p> {
    /// Each template literal type's first text and index, sorted.
    sorted: Vec<(&'p [u8], u32)>,
    /// For each entry of `sorted`, the nearest earlier entry whose text is a prefix of its text.
    parent: Vec<u32>,
    /// Indices of the other patterns, which are string mappings.
    others: Vec<u32>,
}

impl<'p> PatternsByPrefix<'p> {
    const MIN_PATTERNS: usize = 16;
    const NONE: u32 = u32::MAX;

    fn new(c: &Checker<'p, '_>, patterns: &[TypeId]) -> Self {
        let atoms = c.atoms();
        let (mut sorted, mut others) = (Vec::with_capacity(patterns.len()), Vec::new());
        for (at, &pattern) in patterns.iter().enumerate() {
            match c.data(pattern) {
                TypeData::Template { texts, .. } => sorted.push((atoms.bytes(texts[0]), at as u32)),
                _ => others.push(at as u32),
            }
        }
        Self::from_texts(sorted, others)
    }

    fn from_texts(mut sorted: Vec<(&'p [u8], u32)>, others: Vec<u32>) -> Self {
        sorted.sort_unstable();
        let mut parent = Vec::with_capacity(sorted.len());
        let mut prefixes: Vec<u32> = Vec::new();
        for (at, &(text, _)) in sorted.iter().enumerate() {
            while prefixes
                .last()
                .is_some_and(|&top| !text.starts_with(sorted[top as usize].0))
            {
                prefixes.pop();
            }
            parent.push(prefixes.last().copied().unwrap_or(Self::NONE));
            prefixes.push(at as u32);
        }
        Self {
            sorted,
            parent,
            others,
        }
    }

    /// Collects the indices of the patterns that `value` may match, in ascending order.
    fn candidates(&self, value: &[u8], into: &mut Vec<u32>) {
        into.clear();
        into.extend_from_slice(&self.others);
        // A text that `value` starts with sorts before `value`, and every text between the two starts with it too. So
        // it's either the last text that sorts before `value` or a prefix of that text.
        let after = self.sorted.partition_point(|&(text, _)| text <= value);
        if let Some(last) = after.checked_sub(1) {
            let text = self.sorted[last].0;
            let common = text.iter().zip(value).take_while(|(a, b)| a == b).count();
            let mut at = last as u32;
            while at != Self::NONE {
                let (text, pattern) = self.sorted[at as usize];
                if text.len() <= common {
                    into.push(pattern);
                }
                at = self.parent[at as usize];
            }
        }
        into.sort_unstable();
    }
}

// `create_union` relies on these id values.
const _: () = assert!(
    TypeId::UNRESOLVED.0 == 0
        && TypeId::ANY.0 == 1
        && TypeId::UNKNOWN.0 == 2
        && TypeId::SYMBOL.0 < 32
);

/// The kinds that can have an alias, a name or a symbol.
const NAMED: u32 = tf::OBJECT
    | tf::UNION
    | tf::INTERSECTION
    | tf::INDEXED_ACCESS
    | tf::CONDITIONAL
    | tf::TYPE_PARAMETER
    | tf::STRING_MAPPING
    | tf::ENUM
    | tf::UNIQUE_ES_SYMBOL;

/// `Some` (a name or a declaration) sorts before `None`.
fn some_first<T: Ord>(a: Option<T>, b: Option<T>) -> std::cmp::Ordering {
    match (a, b) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    }
}

fn sort_by_id(types: &mut [TypeId]) {
    types.sort_unstable_by_key(|ty| ty.arrival_order());
}

/// A stable sort for `CompareTypes`. Comparing two instantiations of one alias is expensive, and the input is often
/// nearly sorted or made of sorted runs, where a binary insertion sort needs twice as many comparisons.
fn merge_sort_by<T: Copy>(
    items: &mut [T],
    compare: &mut impl FnMut(&T, &T) -> std::cmp::Ordering,
    buffer: &mut Vec<T>,
) {
    if items.len() <= 8 {
        for end in 1..items.len() {
            let item = items[end];
            let mut at = end;
            while at > 0 && compare(&items[at - 1], &item).is_gt() {
                items[at] = items[at - 1];
                at -= 1;
            }
            items[at] = item;
        }
        return;
    }
    let middle = items.len() / 2;
    merge_sort_by(&mut items[..middle], compare, buffer);
    merge_sort_by(&mut items[middle..], compare, buffer);
    if compare(&items[middle - 1], &items[middle]).is_le() {
        return;
    }
    buffer.clear();
    buffer.extend_from_slice(&items[..middle]);
    let (mut left, mut right, mut out) = (0, middle, 0);
    while left < buffer.len() && right < items.len() {
        if compare(&items[right], &buffer[left]).is_lt() {
            items[out] = items[right];
            right += 1;
        } else {
            items[out] = buffer[left];
            left += 1;
        }
        out += 1;
    }
    items[out..out + buffer.len() - left].copy_from_slice(&buffer[left..]);
}

impl<'p, 's> Checker<'p, 's> {
    fn add_to_union(&self, out: &mut Flat, ty: TypeId) {
        match self.data(ty) {
            TypeData::Union(members) => out.extend_from_slice(members),
            TypeData::Intrinsic(
                Intrinsic::Never
                | Intrinsic::SilentNever
                | Intrinsic::UnreachableNever
                | Intrinsic::ImplicitNever
                | Intrinsic::UniqueLiteral,
            ) => {}
            // `TypeFlagsAny`: the union is `anyType`.
            TypeData::Intrinsic(
                Intrinsic::Auto | Intrinsic::IntrinsicMarker | Intrinsic::NonInferrableAny,
            ) => out.push(TypeId::ANY),
            _ => out.push(ty),
        }
    }

    /// `A | B | ...`, with literal types removed when a wider member subsumes them.
    pub fn union(&mut self, types: &[TypeId]) -> TypeId {
        self.union_ex(types, true)
    }

    /// `merge_constrained`: true if `T & P1 | T & P2` reduces to `T`. It doesn't for intersections created without
    /// inspecting `T`'s constraint, which lack `ObjectFlagsIsConstrainedTypeVariable`.
    fn union_ex(&mut self, types: &[TypeId], merge_constrained: bool) -> TypeId {
        self.union_ex_inspecting(types, merge_constrained).0
    }

    /// `union_ex`, which also returns true if the call is known to be `Inspected::Members`.
    fn union_ex_inspecting(&mut self, types: &[TypeId], merge_constrained: bool) -> (TypeId, bool) {
        // The union of two types is the same in either order.
        let pair = match *types {
            [] => return (TypeId::NEVER, true),
            [one] => return (one, true),
            // `addTypeToUnion` sets `TypeFlagsIncludesError`, so the error type is returned unchanged only from a list
            // of one.
            [a, b]
                if a == b
                    && !self.is_error_type(a)
                    && !matches!(
                        a,
                        TypeId::AUTO
                            | TypeId::INTRINSIC_MARKER
                            | TypeId::NON_INFERRABLE_ANY
                            | TypeId::SILENT_NEVER
                            | TypeId::UNREACHABLE_NEVER
                            | TypeId::IMPLICIT_NEVER
                            | TypeId::UNIQUE_LITERAL
                    ) =>
            {
                return (a, true);
            }
            [a, b] if merge_constrained => Some(if a.arrival_order() < b.arrival_order() {
                (a, b)
            } else {
                (b, a)
            }),
            _ => None,
        };
        if let Some((a, b)) = pair {
            if let Some(known) = self.recent_unions.get(a.0, b.0) {
                return (TypeId(known), false);
            }
            let (union, inspected) = self.create_union(types, merge_constrained);
            if inspected != Inspected::Constraints {
                self.recent_unions.put(a.0, b.0, union.0);
            }
            return (union, inspected == Inspected::Members);
        }

        let call = UnionArguments {
            reduction: Reduction::Literal { merge_constrained },
            types,
            alias: None,
        };
        let hash = call.hash();
        if let Some(known) = self.union_calls.get(hash, &call) {
            return (known, true);
        }
        let (union, inspected) = self.create_union(types, merge_constrained);
        if inspected == Inspected::Members {
            self.union_calls.put(hash, &call, union);
        }
        (union, inspected == Inspected::Members)
    }

    /// `getUnionType(types, UnionReductionNone)`: `A | B | ...` with every member preserved,
    /// including `any` and `unknown` next to other members. `string | "a"` shows that the literal
    /// type is accepted and `keyof T | unknown` that a generic type is, which is what matters in a
    /// contextual type.
    pub fn union_unreduced(&mut self, types: &[TypeId]) -> TypeId {
        if let [one] = types {
            return *one;
        }
        // For the contextual type `Commands[T] | undefined`, every property of an argument requests the union of the
        // constraint, which has hundreds of object types, and `undefined`.
        if let [a, b] = *types {
            if let Some(known) = self.recent_unreduced_unions.get(a.0, b.0) {
                return TypeId(known);
            }
            let union = self.create_unreduced_union(types);
            self.recent_unreduced_unions.put(a.0, b.0, union.0);
            return union;
        }
        if types.is_empty() {
            return self.create_unreduced_union(types);
        }
        let call = UnionArguments {
            reduction: Reduction::None,
            types,
            alias: None,
        };
        let hash = call.hash();
        if let Some(known) = self.union_calls.get(hash, &call) {
            return known;
        }
        let union = self.create_unreduced_union(types);
        self.union_calls.put(hash, &call, union);
        union
    }

    fn create_unreduced_union(&mut self, types: &[TypeId]) -> TypeId {
        let mut members = Flat::new();
        let is_sorted = self.add_in_order(&mut members, types);
        if !is_sorted {
            self.add_in_id_order(&mut members, types);
        }
        if members.first() == Some(&TypeId::UNRESOLVED) {
            return TypeId::UNRESOLVED;
        }
        // `addTypeToUnion`: without strictNullChecks, null and undefined are never members. If there are no other
        // members, the result is never.
        if !self.p.files.options.strict_null_checks {
            members.retain(|m| !m.is_undefined() && !m.is_null());
        }
        self.union_of_type_set(types, members, is_sorted, FirstRequest::NONE)
    }

    /// Adds the members of `types`, deduplicated and sorted by id.
    fn add_in_id_order(&self, members: &mut Flat, types: &[TypeId]) {
        for &ty in types {
            self.add_to_union(members, ty);
        }
        sort_by_id(members);
        members.dedup();
    }

    /// The end of `getUnionTypeWorker`. Returns the union of `members`, which is what's left of the `typeSet` of
    /// `actual`. `first_request`: see `Types::as_first_request`.
    fn union_of_type_set(
        &mut self,
        actual: &[TypeId],
        mut members: Flat,
        is_sorted: bool,
        first_request: FirstRequest,
    ) -> TypeId {
        if !is_sorted {
            self.sort_types(&mut members);
        }
        if members.is_empty() {
            return TypeId::NEVER;
        }
        (self.types()).as_first_request(first_request, || {
            self.union_of_named_unions(actual, &members)
        })
    }

    /// `getUnionTypeWorker` with `UnionReductionLiteral`.
    #[inline(never)]
    fn create_union(&mut self, actual: &[TypeId], merge_constrained: bool) -> (TypeId, Inspected) {
        let mut members = Flat::new();
        // If so, no member is `any` or `unknown`.
        let mut is_sorted = self.add_in_order(&mut members, actual);
        if !is_sorted {
            self.add_in_id_order(&mut members, actual);
        }
        // `TypeFlagsIncludesWildcard`
        if !is_sorted && members.contains(&TypeId::WILDCARD) {
            return (TypeId::WILDCARD, Inspected::Members);
        }
        // `TypeFlagsIncludesError`: the error type takes precedence over `any` and `unknown`.
        if !is_sorted
            && members.first() != Some(&TypeId::UNRESOLVED)
            && members.iter().any(|&member| self.is_error_type(member))
        {
            return (TypeId::ERROR, Inspected::Members);
        }
        match members[..] {
            [] => return (TypeId::NEVER, Inspected::Members),
            // The unresolved type, `any` and `unknown`, in this order of precedence, absorb all
            // other members. They have the lowest ids.
            [TypeId::UNRESOLVED, TypeId::ANY, ..] => return (TypeId::ANY, Inspected::Members),
            [
                first @ (TypeId::UNRESOLVED | TypeId::ANY | TypeId::UNKNOWN),
                ..,
            ] => {
                return (first, Inspected::Members);
            }
            [only] => return (only, Inspected::Members),
            _ => {}
        }
        // `addTypeToUnion`: without strictNullChecks, every type includes null and undefined, and they are never
        // members. If there are no other members, the result is null in preference to undefined, in its non-widening
        // form if any input was non-widening (`TypeFlagsIncludesNonWideningType`).
        if !self.p.files.options.strict_null_checks {
            let null = members.iter().any(|m| m.is_null());
            let not_widened = members
                .iter()
                .any(|&m| matches!(m, TypeId::NULL | TypeId::UNDEFINED | TypeId::MISSING));
            members.retain(|m| !m.is_undefined() && !m.is_null());
            if members.is_empty() {
                let left = match (null, not_widened) {
                    (true, true) => TypeId::NULL,
                    (true, false) => TypeId::NULL_WIDENING,
                    (false, true) => TypeId::UNDEFINED,
                    (false, false) => TypeId::UNDEFINED_WIDENING,
                };
                return (left, Inspected::Members);
            }
        }
        // One bit for each member among the types with the lowest ids. In id order these come first.
        let mut low = 0u32;
        for m in members.iter() {
            if m.arrival_order() < 32 {
                low |= 1 << m.arrival_order();
            } else if !is_sorted {
                break;
            }
        }
        let has = |t: TypeId| low & 1 << t.arrival_order() != 0;
        // The missing type is redundant next to the regular `undefined`.
        if has(TypeId::MISSING) && has(TypeId::UNDEFINED) {
            members.retain(|m| *m != TypeId::MISSING);
        }
        let mut inspected = Inspected::Members;
        // `includes&TypeFlagsIncludesInstantiable`, set by a member that gets removed.
        let mut includes_removed_pattern = false;
        if members.len() > 1 {
            let (mut any_fresh, mut has_pattern, mut has_constrained) = (false, false, false);
            for &m in members.iter() {
                match self.data(m) {
                    TypeData::StringLit { fresh: true, .. }
                    | TypeData::NumberLit { fresh: true, .. }
                    | TypeData::BigIntLit { fresh: true, .. }
                    | TypeData::BoolLit { fresh: true, .. }
                    | TypeData::EnumLit { fresh: true, .. }
                    | TypeData::Enum { fresh: true, .. } => any_fresh = true,
                    TypeData::Template { .. } | TypeData::StringMapping { .. } => {
                        has_pattern = true
                    }
                    // `constrained_type_variable` returns `None` for any other form of intersection.
                    TypeData::Intersection(parts) => {
                        if let [a, b] = parts[..]
                            && (self.is_type_variable(a) || self.is_type_variable(b))
                        {
                            has_constrained = true;
                        }
                    }
                    _ => {}
                }
            }
            // `removeRedundantLiteralTypes`. It tests the type flags, and an enum member has the
            // flags of its value.
            let (string, number, bigint, symbol) = (
                has(TypeId::STRING),
                has(TypeId::NUMBER),
                has(TypeId::BIGINT),
                has(TypeId::SYMBOL),
            );
            if string || number || bigint || symbol || any_fresh {
                let mut snapshot = if any_fresh {
                    Flat::from_slice(&members[..])
                } else {
                    Flat::new()
                };
                if is_sorted {
                    sort_by_id(&mut snapshot);
                }
                members.retain(|m| {
                    let m = *m;
                    match self.data(m) {
                        TypeData::StringLit { .. }
                        | TypeData::Template { .. }
                        | TypeData::StringMapping { .. }
                            if string =>
                        {
                            false
                        }
                        TypeData::NumberLit { .. } if number => false,
                        TypeData::EnumLit {
                            value: EnumValue::String(_),
                            ..
                        } if string => false,
                        TypeData::EnumLit {
                            value: EnumValue::Number(_),
                            ..
                        } if number => false,
                        TypeData::BigIntLit { .. } if bigint => false,
                        TypeData::UniqueSymbol { .. } if symbol => false,
                        _ if any_fresh && self.is_fresh_literal(m) => {
                            let regular = self.with_freshness(m, false).arrival_order();
                            snapshot
                                .binary_search_by_key(&regular, |m| m.arrival_order())
                                .is_err()
                        }
                        _ => true,
                    }
                });
            }
            includes_removed_pattern = has_pattern && string;
            if members.len() > 1 {
                // `string` has already removed the patterns.
                let has_pattern = has_pattern && !string;
                let has_constrained = has_constrained && merge_constrained;
                if has_pattern || has_constrained {
                    inspected = match has_constrained {
                        true => Inspected::Constraints,
                        false => Inspected::Patterns,
                    };
                    // Both evaluate something for each member, and evaluation order determines the
                    // creation order of types. tsgo keeps the set sorted from the start.
                    if !is_sorted {
                        self.sort_types(&mut members);
                    }
                }
                if has_pattern {
                    self.remove_string_literals_matched_by_template_literals(&mut members);
                }
                if has_constrained {
                    self.remove_constrained_type_variables(&mut members);
                    // This may have added a type variable, which leaves the members sorted by id.
                    is_sorted = false;
                }
            }
        }

        let first_request = match includes_removed_pattern {
            true => FirstRequest::WITHOUT_PRIMITIVE_UNION,
            false => FirstRequest::NONE,
        };
        // Members that aren't sorted have been in id order up to here.
        let union = self.union_of_type_set(actual, members, is_sorted, first_request);
        (union, inspected)
    }

    /// The end of `getUnionTypeWorker`. Returns the union of `members`, which are sorted, non-empty, and built from
    /// `actual`. The union gets a denormalized `origin` if some of `actual` are named unions, or were built from named
    /// unions, and no member belongs to two of them. If one named union contains all the members, it's the result, even
    /// if a reduction left only one of its members.
    fn union_of_named_unions(&self, actual: &[TypeId], members: &[TypeId]) -> TypeId {
        let mut named: smallvec::SmallVec<[TypeId; 4]> = smallvec::SmallVec::new();
        self.add_named_unions(&mut named, actual);
        if named.is_empty() {
            if let [only] = members {
                return *only;
            }
            // One of `actual` may already be the whole union.
            let whole = actual
                .iter()
                .copied()
                .find(|&ty| matches!(self.data(ty), TypeData::Union(all) if all[..] == *members));
            return match whole {
                Some(whole) => whole,
                None => self.intern_key(TypeKey::Union(members)),
            };
        }
        // `containsType` tests identity.
        let mut in_named: Vec<TypeId> = Vec::new();
        for &u in &named {
            in_named.extend_from_slice(self.parts(u));
        }
        in_named.sort_unstable_by_key(|m| m.arrival_order());
        let is_in_named = |m: &TypeId| {
            in_named
                .binary_search_by_key(&m.arrival_order(), |n| n.arrival_order())
                .is_ok()
        };
        let mut origin: Flat = members
            .iter()
            .copied()
            .filter(|m| !is_in_named(m))
            .collect();
        if let [only] = named[..]
            && origin.is_empty()
        {
            return only;
        }
        // `getUnionTypeFromSortedList`
        if let [only] = members {
            return *only;
        }
        let origin = if in_named.len() + origin.len() == members.len() {
            for &union in &named {
                self.insert_type(&mut origin, union);
            }
            OriginKey::Union(&origin)
        } else {
            OriginKey::None
        };
        self.types().intern_key_with(
            TypeKey::Union(members),
            &ProvenanceKey {
                alias: None,
                origin,
                is_enum: false,
                stored_under: None,
                is_array_literal: false,
                is_array_pattern: false,
                has_other_instantiation: false,
            },
        )
    }

    /// `addNamedUnions`. `boolean` has no alias, even if an alias refers to it.
    fn add_named_unions(&self, named: &mut smallvec::SmallVec<[TypeId; 4]>, types: &[TypeId]) {
        for &t in types {
            if t == TypeId::BOOLEAN || !self.is_union(t) {
                continue;
            }
            match self.origin(t) {
                UnionOrigin::Union(origin) if self.stored_alias(t).is_none() => {
                    self.add_named_unions(named, origin)
                }
                UnionOrigin::None if self.stored_alias(t).is_none() => {}
                _ => {
                    if !named.contains(&t) {
                        named.push(t);
                    }
                }
            }
        }
    }

    /// `removeStringLiteralsMatchedByTemplateLiterals`
    fn remove_string_literals_matched_by_template_literals(&mut self, members: &mut Flat) {
        let patterns: Vec<TypeId> = members
            .iter()
            .copied()
            .filter(|&m| self.is_pattern_literal(m))
            .collect();
        if patterns.is_empty() {
            return;
        }
        let by_prefix = (patterns.len() >= PatternsByPrefix::MIN_PATTERNS)
            .then(|| PatternsByPrefix::new(self, &patterns));
        let mut candidates: Vec<u32> = Vec::new();
        for m in std::mem::take(members) {
            // For a type with `TypeFlagsStringLiteral`: its value, and whether it's the plain string literal type of
            // that value.
            let (value, is_plain) = match *self.data(m) {
                TypeData::StringLit { value, fresh } => (value, !fresh),
                TypeData::EnumLit {
                    value: EnumValue::String(value),
                    ..
                } => (value, false),
                _ => {
                    members.push(m);
                    continue;
                }
            };
            let literal = self.string_literal(value, false);
            let text = self.atoms().bytes(value);
            // `isTypeMatchedByTemplateLiteralOrStringMapping`: a template literal type matches by
            // value. `isMemberOfStringMapping` requires that applying the mapping to the type
            // yields the type itself, and the mapping yields the plain literal.
            let mut is_matched_by = |pattern: TypeId| match self.data(pattern) {
                TypeData::Template { texts, types } => self
                    .is_type_matched_by_template_literal_type(
                        literal,
                        texts,
                        types,
                        &mut |c, s, t| c.is_assignable(s, t),
                    ),
                _ => is_plain && self.is_assignable(m, pattern),
            };
            let matched = match &by_prefix {
                Some(index) => {
                    index.candidates(text, &mut candidates);
                    (candidates.iter()).any(|&at| is_matched_by(patterns[at as usize]))
                }
                None => patterns.iter().any(|&pattern| is_matched_by(pattern)),
            };
            if !matched {
                members.push(m);
            }
        }
    }

    /// `isPrimitiveOrObjectOrEmptyType`
    fn is_primitive_or_object_or_empty(&mut self, ty: TypeId) -> bool {
        self.flags(ty) & (tf::PRIMITIVE | tf::NON_PRIMITIVE) != 0
            || self.is_empty_anonymous_object_type(ty)
    }

    /// For `T & P` or `P & T`, where `T` is a type variable whose constraint consists only of primitives, `object` and
    /// `{}`, and `P` is one of those, returns `T`, `P` and `T`'s constraint. `getIntersectionTypeEx` marks an
    /// intersection of this form that it doesn't reduce with `ObjectFlagsIsConstrainedTypeVariable`.
    /// `includes_empty_object`: the intersected types include or included a `{}`, in which case `P` may be any type.
    fn constrained_type_variable(
        &mut self,
        a: TypeId,
        b: TypeId,
        includes_empty_object: bool,
    ) -> Option<ConstrainedTypeVariable> {
        let (variable, primitive) = if self.is_type_variable(a) {
            (a, b)
        } else {
            (b, a)
        };
        if !self.is_type_variable(variable) {
            return None;
        }
        let flags = self.flags(primitive);
        // `isGenericStringLikeType`
        let is_generic_string_like = flags & (tf::TEMPLATE_LITERAL | tf::STRING_MAPPING) != 0
            && !self.is_pattern_literal(primitive);
        if !(flags & (tf::PRIMITIVE | tf::NON_PRIMITIVE) != 0 && !is_generic_string_like
            || includes_empty_object)
        {
            return None;
        }
        let constraint = self.base_constraint_of(variable)?;
        let parts = self.parts(constraint);
        (!parts.is_empty()
            && parts
                .iter()
                .all(|&p| self.is_primitive_or_object_or_empty(p)))
        .then_some(ConstrainedTypeVariable {
            variable,
            primitive,
            constraint,
        })
    }

    /// `ObjectFlagsIsConstrainedTypeVariable` of `ty`, the intersection of `a` and `b`. If no `getIntersectionTypeEx`
    /// request was recorded for it, returns the flag that a request for `a & b` would set.
    fn is_constrained_type_variable(&mut self, ty: TypeId, a: TypeId, b: TypeId) -> bool {
        if let Some(known) = self.types().is_constrained_type_variable(ty) {
            return known;
        }
        let includes_empty_object =
            self.is_empty_anonymous_object_type(a) || self.is_empty_anonymous_object_type(b);
        self.constrained_type_variable(a, b, includes_empty_object)
            .is_some()
    }

    /// `removeConstrainedTypeVariables`: `T & P1 | T & P2` reduces to `T` once the `P`s cover `T`'s whole constraint.
    fn remove_constrained_type_variables(&mut self, members: &mut Flat) {
        // (member, T, P)
        let mut constrained: Vec<(TypeId, TypeId, TypeId)> = Vec::new();
        for &m in members.iter() {
            if let TypeData::Intersection(parts) = self.data(m)
                && let [a, b] = parts[..]
                && self.is_constrained_type_variable(m, a, b)
            {
                constrained.push(if self.is_type_variable(a) {
                    (m, a, b)
                } else {
                    (m, b, a)
                });
            }
        }
        let mut changed = false;
        for i in 0..constrained.len() {
            let (_, variable, _) = constrained[i];
            if constrained[..i].iter().any(|c| c.1 == variable) {
                continue;
            }
            let Some(constraint) = self.base_constraint_of(variable) else {
                continue;
            };
            if self
                .parts(constraint)
                .iter()
                .all(|&p| constrained.iter().any(|c| c.1 == variable && c.2 == p))
            {
                members.retain(|m| !constrained.iter().any(|c| c.0 == *m && c.1 == variable));
                members.push(variable);
                changed = true;
            }
        }
        if changed {
            members.sort_unstable_by_key(|m| m.arrival_order());
            members.dedup();
        }
    }

    /// Returns a union in which no member is a subtype of another. `UnionReductionSubtype`
    pub fn union_reduced(&mut self, types: &[TypeId]) -> TypeId {
        // `unionOfUnionTypes`. The error type is cached too, so the error is reported once.
        let key = match *types {
            [a, b] if !self.is_union(a) && !self.is_union(b) => None,
            [a, b] if a.arrival_order() < b.arrival_order() => Some((a, b)),
            [a, b] => Some((b, a)),
            _ => None,
        };
        let Some(key) = key else {
            return self.create_reduced_union(types);
        };
        if let Some(&known) = self.unions_of_union_types.get(&key) {
            return known;
        }
        let before = self.non_cacheable_mark();
        let union = self.create_reduced_union(types);
        if before == self.non_cacheable_mark() {
            self.unions_of_union_types.insert(key, union);
        }
        union
    }

    /// `getUnionTypeWorker` with `UnionReductionSubtype`.
    fn create_reduced_union(&mut self, types: &[TypeId]) -> TypeId {
        // An existing union is left unchanged.
        if let [only] = types {
            return *only;
        }
        let union = self.union(types);
        let TypeData::Union(members) = self.data(union) else {
            return union;
        };
        let mut members: Vec<TypeId> = members.to_vec();
        // `removeRedundantLiteralTypes`, reduceVoidUndefined: `void` includes `undefined`.
        if members.contains(&TypeId::VOID) {
            members.retain(|m| !m.is_undefined());
        }
        let is_reduced = members.len() != self.parts(union).len();
        // Primitives and literals were handled above.
        if !members
            .iter()
            .any(|&m| self.flags(m) & tf::STRUCTURED_OR_INSTANTIABLE != 0)
        {
            if !is_reduced {
                return union;
            }
            return self.union_of_named_unions(types, &members);
        }
        let len = members.len();
        let mut actual: Vec<TypeId> = Vec::with_capacity(len);
        for &ty in types {
            actual.extend_from_slice(self.parts(ty));
        }
        let is_created_by_expression = |c: &Self, m: TypeId| {
            matches!(
                c.data(m),
                TypeData::Anon {
                    origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..),
                    ..
                } | TypeData::Synth(_)
                    | TypeData::ReverseMapped { .. }
                    | TypeData::Fns { .. }
                    | TypeData::Tuple { .. }
            )
        };
        // `removeSubtypes` iterates over the members from last to first in `CompareTypes` order, so that order decides
        // which of two mutual subtypes is removed. Where it falls back to ids, declared types stay in id order, which
        // is how `members` has them, and come before types created by expressions, which keep the order they were
        // passed in.
        let key = |c: &Self, m: TypeId| {
            let created_by_expression = match c.data(m) {
                // `{ ...t, a: 1 }`
                TypeData::Intersection(parts) => {
                    parts.iter().any(|&p| is_created_by_expression(c, p))
                }
                _ => is_created_by_expression(c, m),
            };
            let position = || actual.iter().position(|&g| g == m).unwrap_or(usize::MAX);
            created_by_expression.then(position)
        };
        let mut compare = |&x: &TypeId, &y: &TypeId| {
            self.compare_types_without_ids(x, y)
                .then_with(|| key(self, x).cmp(&key(self, y)))
        };
        merge_sort_by(&mut members, &mut compare, &mut Vec::new());
        // hasEmptyObject: next to an empty object type, primitives are candidates for removal too. `{} | 0` is `{}`.
        let has_empty_object = members.iter().any(|&m| {
            m == TypeId::EMPTY_OBJECT || self.is_object_type(m) && self.is_empty_object_type(m)
        });
        const HAS_PROPERTIES: u32 = tf::OBJECT | tf::INTERSECTION | tf::INSTANTIABLE_NON_PRIMITIVE;
        let mut keep = vec![true; len];
        let mut count = 0usize;
        for i in (0..len).rev() {
            let source = members[i];
            let source_flags = self.flags(source);
            if !has_empty_object && source_flags & tf::STRUCTURED_OR_INSTANTIABLE == 0 {
                continue;
            }
            // A type parameter whose constraint is a union may be a subtype of the other members
            // combined without being a subtype of any single one.
            if source_flags & tf::TYPE_PARAMETER != 0 {
                let constraint = self.base_constraint(source);
                if self.is_union(constraint) {
                    let others: Vec<TypeId> = (0..len)
                        .filter(|&j| j != i && keep[j])
                        .map(|j| members[j])
                        .collect();
                    let rest = self.union(&others);
                    if self.is_strict_subtype(source, rest) {
                        keep[i] = false;
                    }
                    continue;
                }
            }
            // The first property with a unit type. Members that differ in it don't need a comparison.
            let key_property = if source_flags & HAS_PROPERTIES != 0 {
                self.first_unit_property(source)
            } else {
                None
            };
            for j in 0..len {
                if i == j || !keep[j] {
                    continue;
                }
                let target = members[j];
                // At this rate the total would exceed a million comparisons. That's too complex to represent, so the
                // result is the error type.
                if count == 100_000 && (count / (len - i)) * len > 1_000_000 {
                    self.error_at_current_node(2590);
                    return TypeId::ERROR;
                }
                count += 1;
                if let Some((name, unit)) = key_property
                    && self.flags(target) & HAS_PROPERTIES != 0
                    && let Some(other) = self.type_of_property(target, name)
                    && self.is_unit(other)
                    && self.with_freshness(other, false) != unit
                {
                    continue;
                }
                // `emptyObjectType`, which has no symbol, isn't removed in favor of an empty type that has one.
                if (source == TypeId::EMPTY_OBJECT || self.is_unknown_empty_object(source))
                    && match self.data(target) {
                        TypeData::Anon { .. } => true,
                        TypeData::Synth(shape) => Self::shape_has_symbol(shape),
                        _ => false,
                    }
                    && self.is_empty_anonymous_object_type(target)
                {
                    continue;
                }
                // An object type is never a subtype of a primitive.
                if source_flags & tf::OBJECT != 0 && self.is_primitive(target) {
                    continue;
                }
                // A class type is removed only in favor of a class it derives from, regardless of
                // structural similarity.
                if self.is_strict_subtype(source, target)
                    && (!self.is_class_instance(source)
                        || !self.is_class_instance(target)
                        || self.is_type_derived_from(source, target))
                {
                    keep[i] = false;
                    break;
                }
            }
        }
        if !is_reduced && keep.iter().all(|&k| k) {
            return union;
        }
        let kept: Flat = members
            .iter()
            .zip(&keep)
            .filter(|(_, k)| **k)
            .map(|(&m, _)| m)
            .collect();
        self.union_of_type_set(types, kept, false, FirstRequest::NONE)
    }

    /// `removeSubtypes`, keyProperty: returns the first property of `ty` whose type is a unit type, and that type.
    /// Resolves the types of the preceding properties on the way, like `removeSubtypes`.
    fn first_unit_property(&mut self, ty: TypeId) -> Option<(Atom, TypeId)> {
        // `getPropertiesOfType`
        let apparent = self.reduced_apparent_type(ty);
        let apparent = match self.is_union(apparent) {
            true => self.union_as_object(apparent),
            false => apparent,
        };
        let members = self.members(apparent)?;
        for prop in &members.shape().props {
            let prop_type = self.type_of_prop(prop, members.mapper);
            if self.is_unit(prop_type) {
                return Some((prop.name, self.with_freshness(prop_type, false)));
            }
        }
        None
    }

    fn is_class_instance(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Ref { target, .. } if self.files().flags(*target).contains(SymFlags::CLASS))
    }

    /// `filterType`
    pub fn filter(
        &mut self,
        ty: TypeId,
        mut keep: impl FnMut(&mut Self, TypeId) -> bool,
    ) -> TypeId {
        match self.data(ty) {
            TypeData::Union(members) => {
                let Some(first_out) = members.iter().position(|&m| !keep(self, m)) else {
                    return ty;
                };
                let mut kept: smallvec::SmallVec<[TypeId; 8]> =
                    smallvec::SmallVec::from_slice(&members[..first_out]);
                for &m in &members[first_out + 1..] {
                    if keep(self, m) {
                        kept.push(m);
                    }
                }
                match kept[..] {
                    [] => TypeId::NEVER,
                    [only] => only,
                    _ => {
                        // Keeps what remains of a denormalized origin, unless a member inside one of its unions was
                        // removed.
                        let mut new_origin = OriginKey::None;
                        let left: Vec<TypeId>;
                        if let UnionOrigin::Union(origin) = self.origin(ty) {
                            left = origin
                                .iter()
                                .copied()
                                .filter(|u| self.is_union(*u) || kept.contains(u))
                                .collect();
                            if origin.len() - left.len() == members.len() - kept.len() {
                                if let [only] = left[..] {
                                    return only;
                                }
                                new_origin = OriginKey::Union(&left);
                            }
                        }
                        // `ObjectFlagsPrimitiveUnion` is forwarded.
                        let first_request = match self.is_primitive_union(ty) {
                            true => FirstRequest::NONE,
                            false => FirstRequest::WITHOUT_PRIMITIVE_UNION,
                        };
                        let types = self.types();
                        types.as_first_request(first_request, || {
                            types.intern_key_with(
                                TypeKey::Union(&kept),
                                &ProvenanceKey {
                                    alias: None,
                                    origin: new_origin,
                                    is_enum: false,
                                    stored_under: None,
                                    is_array_literal: false,
                                    is_array_pattern: false,
                                    has_other_instantiation: false,
                                },
                            )
                        })
                    }
                }
            }
            TypeData::Intrinsic(
                Intrinsic::Never
                | Intrinsic::SilentNever
                | Intrinsic::UnreachableNever
                | Intrinsic::ImplicitNever
                | Intrinsic::UniqueLiteral,
            ) => ty,
            _ => {
                if keep(self, ty) {
                    ty
                } else {
                    TypeId::NEVER
                }
            }
        }
    }

    /// `mapType`
    pub fn map_type(
        &mut self,
        ty: TypeId,
        mut f: impl FnMut(&mut Self, TypeId) -> TypeId,
    ) -> TypeId {
        self.map_type_ex(ty, &mut f, false)
    }

    /// `mapTypeWithAlias`
    pub(super) fn map_type_with_alias(
        &mut self,
        ty: TypeId,
        mut f: impl FnMut(&mut Self, TypeId) -> TypeId,
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        match self.data(ty) {
            TypeData::Union(members) if alias.is_some() => {
                let mut mapped: smallvec::SmallVec<[TypeId; 8]> = smallvec::SmallVec::new();
                for &member in members.iter() {
                    mapped.push(f(self, member));
                }
                self.union_with_alias(&mapped, alias)
            }
            _ => self.map_type(ty, f),
        }
    }

    /// `mapTypeEx` with `noReductions`: `any`, `unknown` and literals next to their base type stay members.
    pub(super) fn map_type_unreduced(
        &mut self,
        ty: TypeId,
        mut f: impl FnMut(&mut Self, TypeId) -> TypeId,
    ) -> TypeId {
        self.map_type_ex(ty, &mut f, true)
    }

    /// `mapTypeEx`
    fn map_type_ex<F: FnMut(&mut Self, TypeId) -> TypeId>(
        &mut self,
        ty: TypeId,
        f: &mut F,
        no_reductions: bool,
    ) -> TypeId {
        match self.data(ty) {
            TypeData::Union(members) => {
                let types: &[TypeId] = match self.origin(ty) {
                    UnionOrigin::Union(origin) => origin,
                    _ => members,
                };
                let mut mapped: smallvec::SmallVec<[TypeId; 8]> = smallvec::SmallVec::new();
                for &s in types {
                    mapped.push(if self.is_union(s) {
                        self.map_type_ex(s, f, no_reductions)
                    } else {
                        f(self, s)
                    });
                }
                if mapped[..] == *types {
                    ty
                } else if no_reductions {
                    self.union_unreduced(&mapped)
                } else {
                    self.union(&mapped)
                }
            }
            TypeData::Intrinsic(
                Intrinsic::Never
                | Intrinsic::SilentNever
                | Intrinsic::UnreachableNever
                | Intrinsic::ImplicitNever
                | Intrinsic::UniqueLiteral,
            ) => ty,
            _ => f(self, ty),
        }
    }

    /// `isPatternLiteralPlaceholderType`
    pub(super) fn is_pattern_literal_placeholder(&self, ty: TypeId) -> bool {
        if let TypeData::Intersection(parts) = self.data(ty) {
            // At least one placeholder, plus object types that only tag it.
            let mut seen_placeholder = false;
            for &part in parts.iter() {
                let flags = self.flags(part);
                if flags & (tf::LITERAL | tf::NULLABLE) != 0
                    || self.is_pattern_literal_placeholder(part)
                {
                    seen_placeholder = true;
                } else if flags & tf::OBJECT == 0 {
                    return false;
                }
            }
            return seen_placeholder;
        }
        self.has_any_flag(ty)
            || matches!(ty, TypeId::STRING | TypeId::NUMBER | TypeId::BIGINT)
            || self.is_pattern_literal(ty)
    }

    /// True for a template literal or string mapping type with no generic part, like `a${string}` or
    /// `Uppercase<string>`. `isPatternLiteralType`
    pub(super) fn is_pattern_literal(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Template { types, .. } => types
                .iter()
                .all(|&t| self.is_pattern_literal_placeholder(t)),
            TypeData::StringMapping { ty, .. } => self.is_pattern_literal_placeholder(*ty),
            _ => false,
        }
    }

    /// `A & B & ...`
    pub fn intersection(&mut self, types: &[TypeId]) -> TypeId {
        self.intersection_ex(types, false, None)
    }

    /// Like `intersection`, but `T & P` isn't reduced using `T`'s constraint. `IntersectionFlagsNoConstraintReduction`
    pub(super) fn intersection_without_constraint_reduction(&mut self, types: &[TypeId]) -> TypeId {
        self.intersection_ex(types, true, None)
    }

    /// `addTypesToIntersection`, `addTypeToIntersection`. Preserves the order, which matters for overloads, and only
    /// removes duplicates. Returns `found` plus what the types add.
    fn add_types_to_intersection(
        &mut self,
        set: &mut Flat,
        mut found: MembersByFlags,
        types: &[TypeId],
    ) -> MembersByFlags {
        for &ty in types {
            let ty = self.regular(ty);
            if let TypeData::Intersection(inner) = self.data(ty) {
                found = self.add_types_to_intersection(set, found, inner);
                continue;
            }
            // Only the first of the types that count as `{}` is added.
            if self.is_empty_anonymous_object_type(ty) {
                if found.includes & tf::INCLUDES_EMPTY_OBJECT == 0 {
                    found.includes |= tf::INCLUDES_EMPTY_OBJECT;
                    set.push(ty);
                }
                continue;
            }
            let flags = self.flags(ty);
            let one = MembersByFlags::of(ty, flags);
            if flags & (tf::ANY | tf::UNKNOWN) != 0 {
                if ty == TypeId::UNRESOLVED {
                    found.includes |= tf::INCLUDES_UNRESOLVED;
                }
                if self.is_error_type(ty) {
                    found.includes |= tf::INCLUDES_ERROR;
                }
                if ty == TypeId::WILDCARD {
                    found.includes |= tf::INCLUDES_WILDCARD;
                }
            } else if self.p.files.options.strict_null_checks || flags & tf::NULLABLE == 0 {
                let member = one.unit.unwrap_or(ty);
                if member != ty {
                    found.includes |= tf::INCLUDES_MISSING_TYPE;
                }
                if !set.contains(&member) {
                    set.push(member);
                }
                found.add(one);
                continue;
            }
            found.includes |= one.includes;
        }
        found
    }

    /// `getIntersectionTypeEx`, with an alias.
    pub(super) fn intersection_with_alias(
        &mut self,
        types: &[TypeId],
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        self.intersection_ex(types, false, alias)
    }

    /// `getUnionTypeEx`, with an alias.
    pub(super) fn union_with_alias(
        &mut self,
        types: &[TypeId],
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        self.union_ex_with_alias(types, true, alias)
    }

    /// `union_ex`, with an alias.
    fn union_ex_with_alias(
        &mut self,
        types: &[TypeId],
        merge_constrained: bool,
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        if let [only] = types {
            return *only;
        }
        let Some((alias, type_arguments)) = alias else {
            return self.union_ex(types, merge_constrained);
        };
        let call = UnionArguments {
            reduction: Reduction::Literal { merge_constrained },
            types,
            alias: Some((alias, type_arguments)),
        };
        let hash = (!types.is_empty()).then(|| call.hash());
        if let Some(hash) = hash
            && let Some(known) = self.union_calls.get(hash, &call)
        {
            return known;
        }
        let (union, is_kept) = self.create_union_with_alias(&call, alias, merge_constrained);
        if is_kept && let Some(hash) = hash {
            self.union_calls.put(hash, &call, union);
        }
        union
    }

    /// `union_ex_inspecting` with an alias. `alias` is `call`'s alias.
    fn create_union_with_alias(
        &mut self,
        call: &UnionArguments,
        alias: Sym,
        merge_constrained: bool,
    ) -> (TypeId, bool) {
        let (created, inspects_members) = self.union_ex_inspecting(call.types, merge_constrained);
        if !self.is_union(created) {
            return (created, inspects_members);
        }
        let union = self.union_type_with_alias(created, alias, call.alias_type_arguments());
        (union, inspects_members)
    }

    /// `getIntersectionTypeEx`
    fn intersection_ex(
        &mut self,
        types: &[TypeId],
        no_constraint_reduction: bool,
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        let mut set = Flat::with_capacity(types.len());
        let found = self.add_types_to_intersection(&mut set, MembersByFlags::default(), types);
        let includes = found.includes;
        if includes & tf::NEVER != 0 {
            return if set.contains(&TypeId::SILENT_NEVER) {
                TypeId::SILENT_NEVER
            } else {
                TypeId::NEVER
            };
        }
        if includes & tf::INCLUDES_UNRESOLVED != 0 {
            return TypeId::UNRESOLVED;
        }
        let strict = self.p.files.options.strict_null_checks;
        if Self::has_disjoint_domains(includes, strict) {
            return TypeId::NEVER;
        }
        if includes & (tf::TEMPLATE_LITERAL | tf::STRING_MAPPING) != 0
            && includes & tf::STRING_LITERAL != 0
            && !self.extract_redundant_template_literals(&mut set)
        {
            return TypeId::NEVER;
        }
        if includes & tf::ANY != 0 {
            return if includes & tf::INCLUDES_WILDCARD != 0 {
                TypeId::WILDCARD
            } else if includes & tf::INCLUDES_ERROR != 0 {
                TypeId::ERROR
            } else {
                TypeId::ANY
            };
        }
        // Without strictNullChecks, null and undefined weren't added to the set, and the intersection reduces to them.
        if !strict && includes & tf::NULLABLE != 0 {
            return if includes & tf::INCLUDES_EMPTY_OBJECT != 0 {
                TypeId::NEVER
            } else if includes & tf::UNDEFINED != 0 {
                TypeId::UNDEFINED
            } else {
                TypeId::NULL
            };
        }
        // `{}` is removed next to a type that can't be null or undefined (`TypeFlagsDefinitelyNonNullable`). A union
        // doesn't have that flag. `U & {}`, where `U` is a union of only such types, is `U` after distribution, so
        // distribution is skipped. `boolean` and enum unions have such a flag themselves and aren't distributed over.
        let is_distributed_over = includes & tf::INCLUDES_EMPTY_OBJECT != 0
            && includes & tf::DEFINITELY_NON_NULLABLE == 0
            && set.len() == 2
            && set.iter().any(|&t| {
                self.is_union(t)
                    && self
                        .parts(t)
                        .iter()
                        .all(|&p| self.flags(p) & tf::DEFINITELY_NON_NULLABLE != 0)
            });
        let is_non_nullable = includes & tf::DEFINITELY_NON_NULLABLE != 0 || is_distributed_over;
        // `removeRedundantSupertypes`
        set.retain(|&mut t| {
            !(t == TypeId::STRING
                && includes & (tf::STRING_LITERAL | tf::TEMPLATE_LITERAL | tf::STRING_MAPPING) != 0
                || t == TypeId::NUMBER && includes & tf::NUMBER_LITERAL != 0
                || t == TypeId::BIGINT && includes & tf::BIGINT_LITERAL != 0
                || t == TypeId::SYMBOL && includes & tf::UNIQUE_ES_SYMBOL != 0
                || t == TypeId::VOID && includes & tf::UNDEFINED != 0
                || is_non_nullable && self.is_empty_anonymous_object_type(t))
        });
        if includes & tf::INCLUDES_MISSING_TYPE != 0
            && let Some(at) = set.iter().position(|&t| t == TypeId::UNDEFINED)
        {
            set[at] = TypeId::MISSING;
        }
        match set.len() {
            0 => return TypeId::UNKNOWN,
            // `getUnionTypeEx(constituents, UnionReductionLiteral, alias, nil)`: a separate union.
            1 if is_distributed_over && self.is_union(set[0]) => {
                let members = self.parts(set[0]);
                return self.union_with_alias(members, alias);
            }
            1 => return set[0],
            _ => {}
        }
        // `T & P` is reduced using `T`'s constraint.
        let mut is_constrained_type_variable = false;
        if !no_constraint_reduction
            && let [a, b] = set[..]
            && let Some(found) =
                self.constrained_type_variable(a, b, includes & tf::INCLUDES_EMPTY_OBJECT != 0)
        {
            let ConstrainedTypeVariable {
                variable,
                primitive,
                constraint,
            } = found;
            // `T & string` with `T extends "a" | "b"` is `T`.
            if self.is_strict_subtype(constraint, primitive) {
                return variable;
            }
            // `T & number` is never, because no member of `T`'s constraint is a subtype of `P` and `P` isn't a subtype
            // of `T`'s constraint.
            let parts = self.parts(constraint);
            if !(parts.len() > 1 && parts.iter().any(|&p| self.is_strict_subtype(p, primitive)))
                && !self.is_strict_subtype(primitive, constraint)
            {
                return TypeId::NEVER;
            }
            is_constrained_type_variable = true;
        }
        let alias_in_key = alias.filter(|_| !no_constraint_reduction);
        if includes & tf::UNION == 0 {
            let first_request = match is_constrained_type_variable {
                _ if no_constraint_reduction || set.len() != 2 => FirstRequest::NONE,
                true => FirstRequest::CONSTRAINED_TYPE_VARIABLE,
                false => FirstRequest::NO_CONSTRAINED_TYPE_VARIABLE,
            };
            let created = (self.types()).as_first_request(first_request, || {
                self.intern_key_with_alias(TypeKey::Intersection(&set), alias, OriginKey::None)
            });
            if !no_constraint_reduction && set.len() == 2 {
                self.types()
                    .set_constrained_type_variable(created, is_constrained_type_variable);
            }
            return created;
        }
        // `intersectionTypes`: the cached result for the same types and alias. The length of `types` isn't in the key,
        // so the first request decides whether the set is split in halves.
        let key: IntersectionKey = (
            Box::from(&set[..]),
            no_constraint_reduction,
            alias_in_key.map(|(alias, type_arguments)| (alias, Box::from(type_arguments))),
        );
        let table = &self.p.distributed_intersections;
        if let Some(known) = table.get(&self.task, &key) {
            return known;
        }
        let scope = self.begin_scope();
        let result = self.distribute_intersection(types.len(), set, no_constraint_reduction, alias);
        match (result, self.end_scope_by_counters(scope)) {
            // `return c.errorType`, before the result is stored, so the next request reports again.
            (None, _) => TypeId::ERROR,
            (Some(result), Ok(stored)) => table.insert(&self.task, key, result, stored),
            (Some(result), Err(_)) => result,
        }
    }

    /// True if no value is in all the types that have added `includes`: none is both an object and null or undefined, or
    /// belongs to two disjoint domains.
    #[inline]
    fn has_disjoint_domains(includes: u32, strict_null_checks: bool) -> bool {
        let overlaps_another_domain = |domain: u32| {
            includes & domain != 0 && includes & (tf::DISJOINT_DOMAINS & !domain) != 0
        };
        strict_null_checks
            && includes & tf::NULLABLE != 0
            && includes & (tf::OBJECT | tf::NON_PRIMITIVE | tf::INCLUDES_EMPTY_OBJECT) != 0
            || overlaps_another_domain(tf::NON_PRIMITIVE)
            || overlaps_another_domain(tf::STRING_LIKE)
            || overlaps_another_domain(tf::NUMBER_LIKE)
            || overlaps_another_domain(tf::BIGINT_LIKE)
            || overlaps_another_domain(tf::ES_SYMBOL_LIKE)
            || overlaps_another_domain(tf::VOID_LIKE)
    }

    /// Returns `None` if `add_types_to_intersection` does more with `ty` than read flags: it replaces a fresh literal
    /// type, asks an object type that can count as `{}` for its members, or meets `any`, `unknown` or `never`.
    fn members_by_flags(&self, ty: TypeId) -> Option<MembersByFlags> {
        if !self.has_no_fresh_literal(ty) {
            return None;
        }
        let members = match self.data(ty) {
            TypeData::Intersection(members) => &members[..],
            _ => std::slice::from_ref(&ty),
        };
        let mut found = MembersByFlags::default();
        for &member in members {
            let flags = self.flags(member);
            let is_read_by_flags = match self.data(member) {
                TypeData::Intersection(_) => false,
                TypeData::Ref { .. } | TypeData::Tuple { .. } => true,
                _ => flags & (tf::OBJECT | tf::ANY | tf::UNKNOWN | tf::NEVER) == 0,
            };
            if !is_read_by_flags {
                return None;
            }
            found.add(MembersByFlags::of(member, flags));
        }
        Some(found)
    }

    /// `checkCrossProductUnion`
    pub(super) fn check_cross_product_union(&mut self, types: &[TypeId]) -> bool {
        self.checked_cross_product_union_size(types).is_some()
    }

    /// `getCrossProductUnionSize`, or `None` if `checkCrossProductUnion` rejects it.
    fn checked_cross_product_union_size(&mut self, types: &[TypeId]) -> Option<usize> {
        let size = self.get_cross_product_union_size(types);
        if size >= 100_000 {
            self.error_at_current_node(2590);
            return None;
        }
        Some(size)
    }

    /// `getCrossProductUnionSize`
    fn get_cross_product_union_size(&self, types: &[TypeId]) -> usize {
        (types.iter()).fold(1, |size, &t| size.saturating_mul(self.parts(t).len()))
    }

    /// `getIntersectionType` for types some of which are unions. `actual`: the number of types in the request. Returns
    /// `None` if `checkCrossProductUnion` rejected the set.
    fn distribute_intersection(
        &mut self,
        actual: usize,
        mut set: Flat,
        no_constraint_reduction: bool,
        alias: Option<(Sym, &[TypeId])>,
    ) -> Option<TypeId> {
        if self.intersect_unions_of_primitive_types(&mut set) {
            // This recurses only once, because at most one such union is left.
            return Some(self.intersection_ex(&set, no_constraint_reduction, alias));
        }
        // `(A | undefined) & (B | undefined)` is `A & B | undefined`, and likewise for `null`.
        if set
            .iter()
            .all(|&t| self.is_union(t) && self.contains_undefined(t))
        {
            let undefined = if set.iter().any(|&t| self.contains_missing_type(t)) {
                TypeId::MISSING
            } else {
                TypeId::UNDEFINED
            };
            for t in &mut set {
                *t = self.filter(*t, |_, m| !m.is_undefined());
            }
            let rest = self.intersection_ex(&set, no_constraint_reduction, None);
            let types = [rest, undefined];
            return Some(self.union_ex_with_alias(&types, !no_constraint_reduction, alias));
        }
        if set
            .iter()
            .all(|&t| self.is_union(t) && self.parts(t).iter().any(|m| m.is_null()))
        {
            for t in &mut set {
                *t = self.filter(*t, |_, m| !m.is_null());
            }
            let rest = self.intersection_ex(&set, no_constraint_reduction, None);
            let types = [rest, TypeId::NULL];
            return Some(self.union_ex_with_alias(&types, !no_constraint_reduction, alias));
        }
        // `A & B & C & D` is `(A & B) & (C & D)`, because much of a half may reduce to never. Not applied to two types,
        // which would recurse forever.
        if set.len() >= 3 && actual > 2 {
            let middle = set.len() / 2;
            let left = self.intersection_ex(&set[..middle], no_constraint_reduction, None);
            let right = self.intersection_ex(&set[middle..], no_constraint_reduction, None);
            return Some(self.intersection_ex(&[left, right], no_constraint_reduction, alias));
        }
        // `X & (A | B) & (C | D)` is `X & A & C | X & A & D | X & B & C | X & B & D`.
        let size = self.checked_cross_product_union_size(&set)?;
        // `getCrossProductIntersections`
        let mut intersections: Vec<TypeId> = Vec::with_capacity(size);
        let mut constituents = set.to_vec();
        // `("a" & keyof T | "b" & keyof T | ..) & ("a" & keyof U | "b" & keyof U | ..)`: nearly every combination has two
        // different literal types, and the flags say so. `members_by_flags` of the alternatives of each of `set`, and
        // where those of each begin.
        let strict = self.p.files.options.strict_null_checks;
        let mut by_flags: smallvec::SmallVec<[Option<MembersByFlags>; 16]> = Default::default();
        let mut starts: smallvec::SmallVec<[usize; 4]> = Default::default();
        for &ty in set.iter().filter(|_| strict) {
            starts.push(by_flags.len());
            let alternatives = self.parts(ty).iter();
            by_flags.extend(alternatives.map(|&it| self.members_by_flags(it)));
        }
        for i in 0..size {
            let mut n = i;
            // `add_types_to_intersection` of the combination, or `None` if it takes more than the flags.
            let mut combined = strict.then(MembersByFlags::default);
            for j in (0..set.len()).rev() {
                let mut chosen = 0;
                if let TypeData::Union(alternatives) = self.data(set[j]) {
                    chosen = n % alternatives.len();
                    constituents[j] = alternatives[chosen];
                    n /= alternatives.len();
                }
                let start = starts.get(j).copied().unwrap_or(0);
                let one = by_flags.get(start + chosen).copied().flatten();
                combined = combined.zip(one).map(|(mut all, one)| {
                    all.add(one);
                    all
                });
            }
            if combined.is_some_and(|it| Self::has_disjoint_domains(it.includes, strict)) {
                continue;
            }
            let one = self.intersection_ex(&constituents, no_constraint_reduction, None);
            if !one.is_never() {
                intersections.push(one);
            }
        }
        // The union gets a denormalized `origin` if a constituent is an intersection and the origin has fewer
        // constituents than the union.
        if !(intersections.iter().any(|&t| self.is_intersection(t))
            && self.constituent_count_of_types(&intersections)
                > self.constituent_count_of_types(&set))
        {
            return Some(self.union_ex_with_alias(&intersections, !no_constraint_reduction, alias));
        }
        let union = self.union_ex(&intersections, !no_constraint_reduction);
        if !self.is_union(union) {
            return Some(union);
        }
        let members = TypeKey::Data(self.data(union));
        Some(self.intern_key_with_alias(members, alias, OriginKey::Intersection(&set)))
    }

    /// `getConstituentCount`
    fn constituent_count(&self, ty: TypeId) -> usize {
        match self.data(ty) {
            TypeData::Union(_) | TypeData::Intersection(_) if self.stored_alias(ty).is_some() => 1,
            TypeData::Union(members) => match self.origin(ty) {
                UnionOrigin::Union(origin) | UnionOrigin::Intersection(origin) => {
                    self.constituent_count_of_types(origin)
                }
                UnionOrigin::Keyof(_) => 1,
                UnionOrigin::None => self.constituent_count_of_types(members),
            },
            TypeData::Intersection(members) => self.constituent_count_of_types(members),
            _ => 1,
        }
    }

    /// `getConstituentCountOfTypes`
    fn constituent_count_of_types(&self, types: &[TypeId]) -> usize {
        types.iter().map(|&t| self.constituent_count(t)).sum()
    }

    /// `extractRedundantTemplateLiterals`: `get${T}` is redundant next to `"getX"`. Returns false if the intersection
    /// is empty, as for `get${string}` and `"setX"`.
    fn extract_redundant_template_literals(&mut self, set: &mut Flat) -> bool {
        let literals: Vec<TypeId> = set
            .iter()
            .copied()
            .filter(|&t| self.flags(t) & tf::STRING_LITERAL != 0)
            .collect();
        let mut i = set.len();
        while i > 0 {
            i -= 1;
            let pattern = set[i];
            if self.flags(pattern) & (tf::TEMPLATE_LITERAL | tf::STRING_MAPPING) == 0 {
                continue;
            }
            for &literal in &literals {
                let is_matched = match *self.data(literal) {
                    // An enum member matches a template literal type by its value, and is never a member of a string
                    // mapping type.
                    TypeData::EnumLit {
                        value: EnumValue::String(value),
                        ..
                    } => {
                        let plain = self.string_literal(value, false);
                        matches!(self.data(pattern), TypeData::Template { .. })
                            && self.is_subtype(plain, pattern)
                    }
                    _ => self.is_subtype(literal, pattern),
                };
                if is_matched {
                    set.remove(i);
                    break;
                }
                if self.is_pattern_literal(pattern) {
                    return false;
                }
            }
        }
        true
    }

    /// `ObjectFlagsPrimitiveUnion`: a union with no member that has `TypeFlagsNotPrimitiveUnion`. `object` is allowed.
    /// `void`, template literal types and `keyof T` aren't. `filterType` forwards the flag, so a union that it's the
    /// first to create from a union without the flag lacks it too.
    fn is_primitive_union(&self, ty: TypeId) -> bool {
        let TypeData::Union(parts) = self.data(ty) else {
            return false;
        };
        if self.types().is_without_primitive_union(ty) {
            return false;
        }
        parts.iter().all(|&p| {
            let flags = self.flags(p);
            flags & (tf::PRIMITIVE | tf::NON_PRIMITIVE) != 0
                && flags & (tf::VOID | tf::TEMPLATE_LITERAL | tf::STRING_MAPPING) == 0
        })
    }

    /// `intersectUnionsOfPrimitiveTypes`: intersects multiple unions of primitives, which is what `keyof (A | B | C)`
    /// produces, as sets. The common members replace the first union, and the other unions are removed. Returns false
    /// if there are fewer than two.
    fn intersect_unions_of_primitive_types(&mut self, set: &mut Flat) -> bool {
        let unions: Vec<TypeId> = set
            .iter()
            .copied()
            .filter(|&t| self.is_primitive_union(t))
            .collect();
        if unions.len() < 2 {
            return false;
        }
        let mut common: Vec<TypeId> = Vec::new();
        let mut checked = crate::util::FxHashSet::default();
        for &union in &unions {
            for &t in self.parts(union) {
                if !checked.insert(t) || !self.each_union_contains(&unions, t) {
                    continue;
                }
                // `undefined` and the missing type match each other. The missing type wins.
                if t == TypeId::UNDEFINED && common.contains(&TypeId::MISSING) {
                    continue;
                }
                if t == TypeId::MISSING
                    && let Some(at) = common.iter().position(|&c| c == TypeId::UNDEFINED)
                {
                    common[at] = TypeId::MISSING;
                    continue;
                }
                common.push(t);
            }
        }
        let common = self.union(&common);
        let first = unions[0];
        set.retain(|t| *t == first || !unions.contains(t));
        if let Some(at) = set.iter().position(|&t| t == first) {
            set[at] = common;
        }
        true
    }

    /// `eachUnionContains`. A union that has `string` contains `"a"`.
    fn each_union_contains(&self, unions: &[TypeId], t: TypeId) -> bool {
        for &union in unions {
            let has = |expected: TypeId| self.contains_type(self.parts(union), expected);
            if has(t) {
                continue;
            }
            if t == TypeId::MISSING {
                return has(TypeId::UNDEFINED);
            }
            if t == TypeId::UNDEFINED {
                return has(TypeId::MISSING);
            }
            let flags = self.flags(t);
            let primitive = if flags & tf::STRING_LITERAL != 0 {
                TypeId::STRING
            } else if flags & (tf::ENUM | tf::NUMBER_LITERAL) != 0 {
                TypeId::NUMBER
            } else if flags & tf::BIGINT_LITERAL != 0 {
                TypeId::BIGINT
            } else if flags & tf::UNIQUE_ES_SYMBOL != 0 {
                TypeId::SYMBOL
            } else {
                return false;
            };
            if !has(primitive) {
                return false;
            }
        }
        true
    }

    pub(super) fn is_unknown_empty_object(&self, ty: TypeId) -> bool {
        matches!(self.data(ty), TypeData::Synth(shape) if shape.literal == Literalness::OfUnknown)
    }

    /// Returns `ty` without `undefined` and the missing type.
    pub fn without_undefined(&mut self, ty: TypeId) -> TypeId {
        self.filter(ty, |_, m| !m.is_undefined())
    }

    pub fn contains_undefined(&self, ty: TypeId) -> bool {
        self.is_some_type_of_kind(ty, tf::UNDEFINED)
    }

    // ───────────────────────────── union member order ─────────────────────────────

    /// `getSortOrderFlags`
    fn sort_order_flags(&self, ty: TypeId) -> u32 {
        let flags = self.flags(ty);
        if flags & tf::ENUM_LIKE != 0 && flags & tf::UNION == 0 {
            return tf::ENUM;
        }
        flags
    }

    /// The name of the symbol that `getTypeNameSymbol` returns. `alias`: `t.alias.symbol`.
    fn type_name(&self, ty: TypeId, alias: Option<Sym>) -> Option<&'p [u8]> {
        let files = self.files();
        let name = match (alias, self.data(ty)) {
            (Some(alias), _) => files.symbol(alias).name,
            // The `this` type has its class's symbol.
            (None, &TypeData::Ref { target: sym, .. } | &TypeData::ThisParam(sym)) => {
                files.symbol(sym).name
            }
            (None, &TypeData::TypeParam(file, tp, _)) => self.hir(file)[tp].name,
            (None, &TypeData::StringMapping { kind, .. }) => {
                return Some(super::print::string_mapping_name(kind));
            }
            _ => return None,
        };
        // `InternalSymbolNameClass`, for a class expression without a name.
        Some(if name.is_none() {
            &b"\xFEclass"[..]
        } else if name == known::missing {
            &b"\xFEmissing"[..]
        } else {
            self.atoms().bytes(name)
        })
    }

    /// The position of `sym`'s first declaration. `compareSymbols`
    fn symbol_position(&self, sym: Sym) -> Option<DeclarationPosition> {
        let files = self.files();
        let (file, decl) = if files.flags(sym).contains(SymFlags::MERGED) {
            files.decls_of(sym).first().copied()?
        } else {
            (sym.file, files.symbol(sym).decls.first().copied()?)
        };
        let pos = self.files().start_of_declaration(file, decl);
        Some((!files.module(file).is_lib, file, pos))
    }

    /// The declaration position of `ty`'s symbol, or of the syntax it's the type of. A synthesized type has none here.
    fn sort_position(&self, ty: TypeId) -> Option<DeclarationPosition> {
        let at = |file: FileId, pos: u32| -> Option<DeclarationPosition> {
            Some((!self.files().module(file).is_lib, file, pos))
        };
        match *self.data(ty) {
            TypeData::Ref { target: sym, .. }
            | TypeData::ThisParam(sym)
            | TypeData::Enum { symbol: sym, .. }
            | TypeData::EnumLit { member: sym, .. } => self.symbol_position(sym),
            TypeData::Anon { origin, .. } => match origin {
                Origin::TypeLiteral(file, node) | Origin::Mapped(file, node) => {
                    at(file, self.hir(file)[node].pos)
                }
                Origin::ObjectLiteral(file, e, ..) | Origin::WidenedLiteral(file, e, ..) => {
                    at(file, self.hir(file)[e].pos)
                }
                Origin::ClassStatic(sym)
                | Origin::Function(sym)
                | Origin::EnumObject(sym)
                | Origin::Module(sym)
                | Origin::Namespace { module: sym, .. } => self.symbol_position(sym),
                _ => None,
            },
            TypeData::Fns { ref decls, .. } => decls
                .first()
                .and_then(|&(file, func)| at(file, self.hir(file)[func].start)),
            TypeData::Synth(ref shape) => match shape.symbol_declared_at {
                Some((file, pos, _)) => at(file, pos),
                // `getOrCreateTypeFromSignature`: the symbol has the signature's declaration. The symbol of
                // `getInstantiatedTypePart` has none, and sorts after those that have one.
                None if shape.literal == Literalness::No
                    && shape.instantiation_expression.is_none()
                    && shape.props.is_empty()
                    && shape.index.is_empty() =>
                {
                    match (&shape.call[..], &shape.construct[..]) {
                        ([sig], []) | ([], [sig]) => {
                            let (file, func, _) = self.sig_decl(*sig)?;
                            at(file, self.hir(file)[func].start)
                        }
                        _ => None,
                    }
                }
                None => None,
            },
            TypeData::TypeParam(file, tp, _) => at(file, self.hir(file)[tp].pos),
            TypeData::Cond { file, node, .. } => at(file, self.hir(file)[node].pos),
            TypeData::UniqueSymbol { symbol, .. } => match symbol {
                UniqueSymbolDeclaration::Variable(variable) => self.symbol_position(variable),
                UniqueSymbolDeclaration::Member(file, member) => {
                    at(file, self.hir(file)[member].name_pos)
                }
                UniqueSymbolDeclaration::SymbolConstructor => None,
            },
            _ => None,
        }
    }

    /// `t.symbol.Name` of an object type whose symbol has no declarations. `compareSymbols` puts
    /// such a symbol after those that have one and before nil.
    fn name_of_symbol_without_declarations(&self, ty: TypeId) -> Option<&'static [u8]> {
        match self.data(ty) {
            TypeData::Synth(shape) if shape.instantiation_expression.is_some() => {
                Some(&b"\xFEinstantiationExpression"[..])
            }
            TypeData::Synth(shape) => matches!(
                shape.literal,
                Literalness::EmptyTypeLiteral | Literalness::SyntheticDefault
            )
            .then_some(&b"\xFEtype"[..]),
            TypeData::Anon {
                origin: Origin::GlobalThis,
                ..
            } => Some(&b"globalThis"[..]),
            _ => None,
        }
    }

    /// The sort key `compareNodes` uses for a node at `pos` in `file`: the file's index in the program
    /// (`fileIndexMap`), then the position. Library files come first.
    pub(super) fn position_in_program_order(&self, file: FileId, pos: u32) -> (bool, u32, u32) {
        let files = self.files();
        (!files.module(file).is_lib, files.rank_of_file(file), pos)
    }

    /// `t.symbol.Declarations[0]` of an object type, as a file and a position.
    pub(super) fn symbol_declaration_of_object_type(
        &self,
        ty: TypeId,
    ) -> Option<(FileId, u32, ExprId)> {
        let literal = match *self.data(ty) {
            TypeData::Anon {
                origin: Origin::ObjectLiteral(_, e, ..) | Origin::WidenedLiteral(_, e, ..),
                ..
            } => e,
            TypeData::Synth(ref shape) => shape.symbol_declared_at.map_or(ExprId::NONE, |it| it.2),
            _ => ExprId::NONE,
        };
        self.sort_position(ty)
            .map(|sort_key| (sort_key.1, sort_key.2, literal))
    }

    /// `Shape::mapper` for a type that gets `t.symbol`, the symbol of an object literal (`newAnonymousType(t.symbol,
    /// ..)`). It's what `ty` maps the literal's outer type parameters to.
    pub(super) fn mapper_of_object_literal_type(&self, ty: TypeId) -> MapperId {
        match *self.data(ty) {
            TypeData::Anon {
                origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..),
                mapper,
            } => mapper,
            TypeData::Synth(ref shape) => shape.mapper,
            _ => MapperId::IDENTITY,
        }
    }

    /// `compareTypeLists`
    fn compare_type_lists(&self, x: &[TypeId], y: &[TypeId]) -> std::cmp::Ordering {
        x.len().cmp(&y.len()).then_with(|| {
            x.iter()
                .zip(y)
                .map(|(&a, &b)| self.compare_types_without_ids(a, b))
                .find(|o| o.is_ne())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    }

    /// `compareSymbols`, limited to comparing the first declarations.
    pub(super) fn compare_symbols(&self, s: Sym, t: Sym) -> std::cmp::Ordering {
        let program_position = |symbol: Sym| {
            let (_, file, pos) = self.symbol_position(symbol)?;
            Some(self.position_in_program_order(file, pos))
        };
        some_first(program_position(s), program_position(t))
    }

    /// `compareTypeNames`
    fn compare_type_names(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        // FOR SPEED: the alias type arguments are computed only for two instantiations of one alias.
        let (x, y) = (self.alias_symbol_of_type(a), self.alias_symbol_of_type(b));
        some_first(self.type_name(a, x), self.type_name(b, y)).then_with(|| match (x, y) {
            (Some(s), Some(t)) if s == t => {
                let arguments =
                    |ty: TypeId| self.alias_of_type(ty).map(|it| it.1).unwrap_or_default();
                self.compare_type_lists(&arguments(a), &arguments(b))
            }
            (None, None) => std::cmp::Ordering::Equal,
            // TypeScript 7.1: two symbols with the same name are ordered by their declarations. In 7.0 they're equal.
            _ => {
                let declaration = |ty: TypeId, alias: Option<Sym>| {
                    let (_, file, pos) = match alias {
                        Some(alias) => self.symbol_position(alias),
                        None => self.sort_position(ty),
                    }?;
                    Some(self.position_in_program_order(file, pos))
                };
                some_first(declaration(a, x), declaration(b, y))
            }
        })
    }

    /// `compareTypeLists` of the types that two mappers map to, in the declaration order of the
    /// type parameters.
    fn compare_targets_of_type_mappers(&self, x: MapperId, y: MapperId) -> std::cmp::Ordering {
        let targets = |mapper: MapperId| -> Vec<TypeId> {
            let pairs = self.mapping_in_declaration_order(mapper);
            pairs.iter().map(|pair| pair.1).collect()
        };
        self.compare_type_lists(&targets(x), &targets(y))
    }

    /// `compareTypeMappers` for a `SimpleTypeMapper` or an `ArrayTypeMapper` of instantiations of the same declaration,
    /// which have the same sources. In tsgo a declared type has no mapper, which sorts last. Here it has a mapper of
    /// identity pairs.
    fn compare_type_mappers(&self, x: MapperId, y: MapperId) -> std::cmp::Ordering {
        match (self.is_instantiating(x), self.is_instantiating(y)) {
            (true, true) => self.compare_targets_of_type_mappers(x, y),
            (is_x, is_y) => is_y.cmp(&is_x),
        }
    }

    /// `compareTypeMappers` for the mappers of two conditional types of the same root, each with
    /// `TypeData::Cond::distributed_over`. A `MergedTypeMapper` comes after the other kinds.
    fn compare_type_mappers_of_conditional_types(
        &self,
        (x, x_over): (MapperId, MapperId),
        (y, y_over): (MapperId, MapperId),
    ) -> std::cmp::Ordering {
        let kind = |mapper: MapperId, over: MapperId| match self.is_instantiating(mapper) {
            true => u8::from(over != MapperId::IDENTITY),
            false => 2,
        };
        let by_kind = kind(x, x_over).cmp(&kind(y, y_over));
        if by_kind.is_ne() || x_over == MapperId::IDENTITY {
            return by_kind.then_with(|| self.compare_type_mappers(x, y));
        }
        // `m1`: the check type, mapped to the member of the union.
        let member = |mapper: MapperId, over: MapperId| {
            let mut pairs = self.types().mapping(mapper).iter();
            pairs.find(|pair| self.types().map(over, pair.0) != Some(pair.1))
        };
        let by_member = match (member(x, x_over), member(y, y_over)) {
            (Some(s), Some(t)) => self.compare_types_without_ids(s.1, t.1),
            _ => std::cmp::Ordering::Equal,
        };
        by_member.then_with(|| self.compare_type_mappers(x_over, y_over))
    }

    /// `CompareTypes` without its final fallback, the ids.
    fn compare_types_without_ids(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        use std::cmp::Ordering::Equal;
        if a == b {
            return Equal;
        }
        let flags = self.sort_order_flags(a);
        let by_flags = flags.cmp(&self.sort_order_flags(b));
        if by_flags.is_ne() {
            return by_flags;
        }
        let atoms = &self.atoms();
        let types = |x: TypeId, y: TypeId| self.compare_types_without_ids(x, y);
        let lists = |x: &[TypeId], y: &[TypeId]| self.compare_type_lists(x, y);
        let program_position = |t: TypeId| {
            let (_, file, pos) = self.sort_position(t)?;
            Some(self.position_in_program_order(file, pos))
        };
        // A synthesized type doesn't always record where its symbol is declared.
        let has_symbol = |t: TypeId| match self.data(t) {
            TypeData::Synth(shape) => Self::shape_has_symbol(shape),
            _ => false,
        };
        // `compareSymbols` of a symbol and its `cloneTypeAsModuleType` clone falls back to the symbol ids. Here the
        // symbol comes first, then the clones in import order.
        let originating_import = |t: TypeId| match *self.data(t) {
            TypeData::Anon {
                origin:
                    Origin::Namespace {
                        originating_import, ..
                    },
                ..
            } => Some(originating_import),
            _ => None,
        };
        // Among object types with the same symbol, or none, type references come first. A tuple is
        // a type reference and has no symbol.
        let is_not_reference =
            |t: TypeId| !matches!(self.data(t), TypeData::Ref { .. } | TypeData::Tuple { .. });
        let have_same_target = matches!(
            (self.data(a), self.data(b)),
            (TypeData::Ref { target: s, .. }, TypeData::Ref { target: t, .. }) if s == t
        );
        if flags & NAMED != 0 {
            let by_symbol = self
                .compare_type_names(a, b)
                .then_with(|| match have_same_target {
                    true => Equal,
                    false => some_first(program_position(a), program_position(b))
                        .then_with(|| {
                            some_first(
                                self.name_of_symbol_without_declarations(a),
                                self.name_of_symbol_without_declarations(b),
                            )
                        })
                        // nil comes last.
                        .then_with(|| has_symbol(b).cmp(&has_symbol(a))),
                })
                .then_with(|| originating_import(a).cmp(&originating_import(b)))
                .then_with(|| is_not_reference(a).cmp(&is_not_reference(b)));
            if by_symbol.is_ne() {
                return by_symbol;
            }
        }
        // References that aren't deferred are ordered by their type arguments. Deferred ones with the same target are
        // ordered by the reference's source position, and instantiations of the same reference by their mappers, never
        // by their type arguments, which may be the references themselves. A reference that isn't deferred has no node
        // and comes last (`compareNodes`).
        let arguments = |x: &TypeArguments, y: &TypeArguments| match (x, y) {
            (TypeArguments::Given(x), TypeArguments::Given(y)) => lists(x, y),
            _ => {
                let (x, y) = (x.as_deferred(), y.as_deferred());
                let node = |deferred: Option<&DeferredTypeArguments>| {
                    let deferred = deferred?;
                    let pos = self.hir(deferred.file)[deferred.node].pos;
                    Some(self.position_in_program_order(deferred.file, pos))
                };
                some_first(node(x), node(y)).then_with(|| match (x, y) {
                    (Some(x), Some(y)) => self.compare_type_mappers(x.mapper, y.mapper),
                    _ => Equal,
                })
            }
        };
        // Where one type is always created from the other, the order of their ids in tsgo is a function of the two
        // types.
        let creation_step = |t: TypeId| match *self.data(t) {
            // `getFreshTypeOfLiteralType`
            TypeData::StringLit { fresh, .. }
            | TypeData::NumberLit { fresh, .. }
            | TypeData::BigIntLit { fresh, .. }
            | TypeData::BoolLit { fresh, .. }
            | TypeData::EnumLit { fresh, .. }
            | TypeData::Enum { fresh, .. } => u8::from(fresh),
            // `checkObjectLiteral`, `getRegularTypeOfObjectLiteral`, `getWidenedTypeOfObjectLiteral`
            TypeData::Anon {
                origin: Origin::ObjectLiteral(.., is_fresh),
                ..
            } => u8::from(!is_fresh),
            TypeData::Anon {
                origin: Origin::WidenedLiteral(..),
                ..
            } => 2,
            TypeData::Synth(ref shape) => u8::from(shape.is_regular),
            // `createArrayLiteralType`, `getTypeFromArrayBindingPattern`
            TypeData::Ref { .. } | TypeData::Tuple { .. } => {
                u8::from(self.types().is_array_literal(t))
                    + 2 * u8::from(self.types().is_array_pattern(t))
            }
            _ => 0,
        };
        let by_structure = match (self.data(a), self.data(b)) {
            (TypeData::Ref { target: s, args: x }, TypeData::Ref { target: t, args: y }) => {
                s.cmp(t).then_with(|| arguments(x, y))
            }
            // `compareTupleTypes`, `compareElementLabels`: an element without a label comes first.
            (
                TypeData::Tuple {
                    elems: x,
                    flags: f,
                    readonly: r,
                },
                TypeData::Tuple {
                    elems: y,
                    flags: g,
                    readonly: q,
                },
            ) => {
                let bits = |e: &ElemFlags| e.with_label(LabeledDeclaration::NONE).bits();
                let label = |e: &ElemFlags| e.label().is_some().then(|| atoms.bytes(e.label()));
                r.cmp(q)
                    .then_with(|| f.len().cmp(&g.len()))
                    .then_with(|| f.iter().map(bits).cmp(g.iter().map(bits)))
                    .then_with(|| f.iter().map(label).cmp(g.iter().map(label)))
                    .then_with(|| arguments(x, y))
            }
            // A union with an `origin` comes first, and origins compare as the types they are: a
            // `keyof`, a union, an intersection.
            (TypeData::Union(_), TypeData::Union(_)) => {
                let flags = |origin: &UnionOrigin| match origin {
                    UnionOrigin::Keyof(_) => tf::INDEX,
                    UnionOrigin::Union(_) => tf::UNION,
                    UnionOrigin::Intersection(_) => tf::INTERSECTION,
                    UnionOrigin::None => u32::MAX,
                };
                let (o, p) = (self.origin(a), self.origin(b));
                flags(o).cmp(&flags(p)).then_with(|| match (o, p) {
                    (UnionOrigin::Keyof(x), UnionOrigin::Keyof(y)) => types(*x, *y),
                    (UnionOrigin::Union(x), UnionOrigin::Union(y))
                    | (UnionOrigin::Intersection(x), UnionOrigin::Intersection(y)) => lists(x, y),
                    _ => lists(self.parts(a), self.parts(b)),
                })
            }
            // An intersection's members are in source order.
            (TypeData::Intersection(x), TypeData::Intersection(y)) => lists(x, y),
            (TypeData::StringLit { value: x, .. }, TypeData::StringLit { value: y, .. })
            | (TypeData::UniqueSymbol { name: x, .. }, TypeData::UniqueSymbol { name: y, .. }) => {
                atoms.bytes(*x).cmp(atoms.bytes(*y))
            }
            // `cmp.Compare`: NaN before everything else.
            (TypeData::NumberLit { bits: x, .. }, TypeData::NumberLit { bits: y, .. }) => {
                let (x, y) = (f64::from_bits(*x), f64::from_bits(*y));
                y.is_nan()
                    .cmp(&x.is_nan())
                    .then_with(|| x.partial_cmp(&y).unwrap_or(Equal))
            }
            (TypeData::BoolLit { value: x, .. }, TypeData::BoolLit { value: y, .. }) => x.cmp(y),
            // TypeScript 7.1: by value.
            (
                TypeData::BigIntLit {
                    text: x,
                    negative: is_x_negative,
                    ..
                },
                TypeData::BigIntLit {
                    text: y,
                    negative: is_y_negative,
                    ..
                },
            ) => {
                let digits = |text: Atom| {
                    let text = atoms.bytes(text);
                    let text = text.strip_suffix(b"n").unwrap_or(text);
                    &text[text.iter().take_while(|&&c| c == b'0').count()..]
                };
                let (x, y) = (digits(*x), digits(*y));
                let by_magnitude = x.len().cmp(&y.len()).then_with(|| x.cmp(y));
                match (
                    *is_x_negative && !x.is_empty(),
                    *is_y_negative && !y.is_empty(),
                ) {
                    (true, true) => by_magnitude.reverse(),
                    (false, false) => by_magnitude,
                    (is_x_negative, is_y_negative) => is_y_negative.cmp(&is_x_negative),
                }
            }
            (
                TypeData::Marker(Marker::Restrictive(x)),
                TypeData::Marker(Marker::Restrictive(y)),
            ) => types(*x, *y),
            (TypeData::Marker(x), TypeData::Marker(y)) => {
                let rank = |marker: &Marker| match *marker {
                    Marker::Super => (0, 0),
                    Marker::Sub => (1, 0),
                    Marker::Other => (2, 0),
                    Marker::SuperForCheck => (3, 0),
                    Marker::SubForCheck => (4, 0),
                    Marker::Restrictive(_) => (5, 0),
                    Marker::TupleElement(index) => (6, index),
                    Marker::TupleThis => (7, 0),
                };
                rank(x).cmp(&rank(y))
            }
            // tsgo: by name, then by id. The ids of intrinsic types are constants, because `TypeStore::new` interns
            // them in the order of `well_known!`.
            (TypeData::Intrinsic(_), TypeData::Intrinsic(_)) => {
                a.arrival_order().cmp(&b.arrival_order())
            }
            (TypeData::Keyof(x), TypeData::Keyof(y))
            | (TypeData::EvolvingArray(x), TypeData::EvolvingArray(y))
            | (TypeData::StringMapping { ty: x, .. }, TypeData::StringMapping { ty: y, .. }) => {
                types(*x, *y)
            }
            (
                TypeData::Substitution {
                    base: x,
                    constraint: c,
                },
                TypeData::Substitution {
                    base: y,
                    constraint: d,
                },
            ) => types(*x, *y).then_with(|| types(*c, *d)),
            (
                TypeData::IndexedAccess {
                    obj: o, index: i, ..
                },
                TypeData::IndexedAccess {
                    obj: p, index: j, ..
                },
            ) => types(*o, *p).then_with(|| types(*i, *j)),
            (
                TypeData::Template { texts: s, types: x },
                TypeData::Template { texts: t, types: y },
            ) => {
                let text = |&text: &Atom| atoms.bytes(text);
                s.iter()
                    .map(text)
                    .cmp(t.iter().map(text))
                    .then_with(|| lists(x, y))
            }
            // TypeScript orders them by id, in the order `getSpreadType` created them: `mapType`
            // iterates over the left operand, and for each of its members over the right. Likewise
            // `getInstantiationExpressionType`, one expression after the other.
            (TypeData::Synth(x), TypeData::Synth(y)) => match (x.created_from, y.created_from) {
                (Some((l, r)), Some((m, s))) => {
                    let node = |shape: &Shape| {
                        let (file, pos) = match shape.instantiation_expression? {
                            InstantiationExpression::Expr(file, e) => (file, self.hir(file)[e].pos),
                            InstantiationExpression::TypeNode(file, node) => {
                                (file, self.hir(file)[node].pos)
                            }
                        };
                        Some(self.position_in_program_order(file, pos))
                    };
                    some_first(node(x), node(y))
                        .then_with(|| x.spread_rank.cmp(&y.spread_rank))
                        .then_with(|| types(l, m))
                        .then_with(|| types(r, s))
                }
                _ => match (x.single_signature_arguments, y.single_signature_arguments) {
                    (Some(x), Some(y)) => types(x, y),
                    (x, y) => y.is_some().cmp(&x.is_some()),
                },
            }
            .then_with(|| self.compare_type_mappers(x.mapper, y.mapper)),
            (
                TypeData::Cond {
                    mapper: x,
                    distributed_over: m,
                    ..
                },
                TypeData::Cond {
                    mapper: y,
                    distributed_over: n,
                    ..
                },
            ) => self.compare_type_mappers_of_conditional_types((*x, *m), (*y, *n)),
            // tsgo orders a type parameter and its clones by id. The declared one comes first.
            (TypeData::TypeParam(_, _, x), TypeData::TypeParam(_, _, y)) => {
                self.compare_targets_of_type_mappers(*x, *y)
            }
            // TypeScript 7.1: by source, mapped type and constraint. 7.0 falls back to the ids.
            (
                TypeData::ReverseMapped {
                    source: s,
                    mapped: m,
                    of: c,
                },
                TypeData::ReverseMapped {
                    source: t,
                    mapped: n,
                    of: d,
                },
            ) => types(*s, *t)
                .then_with(|| types(*m, *n))
                .then_with(|| types(*c, *d)),
            // `ObjectFlagsObjectTypeKindMask`, then `compareTypeMappers`, where a type without a mapper comes last.
            (x, y) => {
                let kind = |data: &TypeData| match data {
                    TypeData::Anon {
                        origin: Origin::Mapped(..),
                        ..
                    } => 1u8,
                    TypeData::ReverseMapped { .. } => 2,
                    TypeData::EvolvingArray(_) => 3,
                    _ => 0,
                };
                let mapper = |data: &TypeData| match *data {
                    TypeData::Anon { mapper, .. } | TypeData::Fns { mapper, .. } => Some(mapper),
                    _ => None,
                };
                kind(x)
                    .cmp(&kind(y))
                    .then_with(|| match (mapper(x), mapper(y)) {
                        // TypeScript 7.1: also for two mapped types, without the mapper for the fresh type parameter.
                        (Some(x), Some(y)) => self.compare_type_mappers(x, y),
                        (x, y) => y.is_some().cmp(&x.is_some()),
                    })
            }
        };
        // The `checkObjectLiteral` calls for one literal, in the order they return.
        let check_of_literal = |t: TypeId| match *self.data(t) {
            TypeData::Anon {
                origin:
                    Origin::ObjectLiteral(_, _, _, _, created_by, ..)
                    | Origin::WidenedLiteral(_, _, _, _, created_by, ..),
                ..
            } => match created_by {
                // The call for a member contains those for the members after it.
                ObjectLiteralCheck::ForThisParameter(member) => (0u8, !member.0),
                ObjectLiteralCheck::ForParent | ObjectLiteralCheck::ForAssignmentDeclaration => {
                    (1, 0)
                }
                ObjectLiteralCheck::ForThis => (2, 0),
            },
            _ => (1, 0),
        };
        by_structure
            .then_with(|| check_of_literal(a).cmp(&check_of_literal(b)))
            .then_with(|| creation_step(a).cmp(&creation_step(b)))
    }

    /// `CompareTypes`: the order of a union's constituents, and of an origin that is a union. Where tsgo falls back to
    /// the type ids, this falls back to `content_order`.
    #[inline]
    pub fn compare_types(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        match (self.data(a), self.data(b)) {
            (TypeData::Intersection(_), TypeData::Intersection(_)) => {
                let (s, t) = self.members_that_order_intersections(a, b);
                self.compare_types_ordered_by(s, t)
            }
            _ => self.compare_types_ordered_by(a, b),
        }
    }

    /// `compareTypeLists` calls `CompareTypes`, so the first pair of distinct members decides the order of two
    /// intersections, by id if nothing else orders that pair.
    fn members_that_order_intersections(&self, a: TypeId, b: TypeId) -> (TypeId, TypeId) {
        let (mut s, mut t) = (a, b);
        while let (TypeData::Intersection(x), TypeData::Intersection(y)) =
            (self.data(s), self.data(t))
            && x.len() == y.len()
            && self.compare_type_names(s, t).is_eq()
            && let Some((&first, &second)) = x.iter().zip(y.iter()).find(|pair| pair.0 != pair.1)
        {
            (s, t) = (first, second);
        }
        (s, t)
    }

    /// `CompareTypes` for `s` and `t`, which decide the order of two types. See `members_that_order_intersections`.
    fn compare_types_ordered_by(&self, s: TypeId, t: TypeId) -> std::cmp::Ordering {
        self.compare_types_without_ids(s, t)
            .then_with(|| self.content_order(s, t))
    }

    /// See `Types::content_order`.
    #[inline]
    pub(super) fn content_order(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        self.types().content_order(a, b)
    }

    /// `slices.BinarySearchFunc(types, t, CompareTypes)`. Only a type and itself compare equal.
    fn binary_search_types(&self, types: &[TypeId], t: TypeId) -> Result<usize, usize> {
        types.binary_search_by(|&member| self.compare_types(member, t))
    }

    /// `insertType`
    fn insert_type(&self, types: &mut Flat, t: TypeId) {
        if let Err(index) = self.binary_search_types(types, t) {
            types.insert(index, t);
        }
    }

    /// The name, which is the first thing `CompareTypes` orders types with the same `sort_order_flags` by. All string
    /// literals have the same flags and no name, so their text decides.
    fn sort_name(&self, ty: TypeId, flags: u32) -> Option<&'p [u8]> {
        match *self.data(ty) {
            TypeData::StringLit { value, .. } => Some(self.atoms().bytes(value)),
            _ if flags & NAMED != 0 => self.type_name(ty, self.alias_symbol_of_type(ty)),
            _ => None,
        }
    }

    /// Sorts by `CompareTypes`.
    fn sort_types(&self, types: &mut [TypeId]) {
        if types.len() < 3 {
            return types.sort_by(|&a, &b| self.compare_types(a, b));
        }
        let mut ranked: Run<'p> = types.iter().map(|&ty| self.ranked(ty)).collect();
        self.sort_ranked(&mut ranked);
        for (ty, sorted) in types.iter_mut().zip(ranked) {
            *ty = sorted.ty;
        }
        debug_assert!(types.is_sorted_by(|&a, &b| self.compare_types(a, b).is_le()));
    }

    fn ranked(&self, ty: TypeId) -> Ranked<'p> {
        Ranked {
            ty,
            flags: self.sort_order_flags(ty),
            name: None,
            has_name: false,
        }
    }

    #[inline]
    fn look_up_name(&self, ranked: &mut Ranked<'p>) {
        if !ranked.has_name {
            ranked.name = self.sort_name(ranked.ty, ranked.flags);
            ranked.has_name = true;
        }
    }

    /// Sorts by `CompareTypes`. Duplicates end up next to each other.
    ///
    /// FOR SPEED: `CompareTypes` orders by the flags, then by the names. tsgo reads both from the type. Here a type's
    /// alias is found through its declaration, so each type's name is looked up once instead of for every comparison.
    fn sort_ranked(&self, types: &mut [Ranked<'p>]) {
        for ranked in types.iter_mut() {
            self.look_up_name(ranked);
        }
        types.sort_by(|a, b| {
            a.flags
                .cmp(&b.flags)
                .then_with(|| some_first(a.name, b.name))
        });
        let mut buffer = Vec::new();
        for same_name_group in types.chunk_by_mut(|a, b| (a.flags, a.name) == (b.flags, b.name)) {
            let mut compare = |a: &Ranked<'p>, b: &Ranked<'p>| match a.ty == b.ty {
                true => std::cmp::Ordering::Equal,
                false => self.compare_types(a.ty, b.ty),
            };
            merge_sort_by(same_name_group, &mut compare, &mut buffer);
        }
    }

    /// FOR SPEED: fills the empty `members` with the deduplicated members of `actual` in `CompareTypes` order, without
    /// sorting what's already sorted. Returns false if `members` is still empty and the caller has to sort.
    ///
    /// Most of the types a union is built from are unions, whose members are sorted. The caller also has to look at
    /// the members if one of them is `any` or `unknown`, which absorb the whole union.
    fn add_in_order(&self, members: &mut Flat, actual: &[TypeId]) -> bool {
        let mut runs = 0;
        for &ty in actual {
            // `any` and `unknown` have the lowest flags, so they come first.
            if let Some(&first) = self.parts(ty).first()
                && self.flags(first) & (tf::ANY | tf::UNKNOWN) != 0
            {
                return false;
            }
            runs += usize::from(self.is_union(ty));
        }
        // Two types that aren't unions take one comparison either way.
        if runs == 0 && actual.len() < 3 {
            return false;
        }
        // Next to a single union, the search for a type's position also tells whether the union already has it.
        if runs < 2 || !self.join_by_position(members, actual) {
            self.merge_sorted_runs(members, actual);
        }
        true
    }

    /// FOR SPEED: narrowing removes members from a union, and where the branches join, the remaining members are
    /// combined again. If the members of each of `actual` are a subsequence of one union's members, then their union
    /// has the members at all those positions, in that order, and nothing needs to be compared. The longest of `actual` is
    /// tried. Returns false if `members` is still empty.
    fn join_by_position(&self, members: &mut Flat, actual: &[TypeId]) -> bool {
        let (mut total, mut all) = (0, &[][..]);
        for &ty in actual {
            let parts = self.parts(ty);
            total += parts.len();
            if parts.len() > all.len() {
                all = parts;
            }
        }
        // Each of `actual` is searched for from the start of `all`, which isn't worth it if `all` is much longer than
        // the requested union.
        if actual.len() * all.len() > MAX_STEPS_PER_POSITION * total {
            return false;
        }
        let Some(positions) = self.positions_in(all, actual) else {
            return false;
        };
        members.extend(positions.iter().map(|at| all[at]));
        true
    }

    /// Returns the positions of the members of `actual` in `all`, the members of a union, if `all` has every one of
    /// them. A type that isn't a union counts as its only member.
    fn positions_in(&self, all: &[TypeId], actual: &[TypeId]) -> Option<PositionSet> {
        let mut positions = PositionSet::new(all.len());
        for &ty in actual {
            let mut after = 0;
            for member in self.parts(ty) {
                after += all[after..].iter().position(|it| it == member)? + 1;
                positions.insert(after - 1);
            }
        }
        Some(positions)
    }

    /// Merges the members of `actual`.
    fn merge_sorted_runs(&self, members: &mut Flat, actual: &[TypeId]) {
        let mut unions: smallvec::SmallVec<[&'p [TypeId]; 4]> = smallvec::SmallVec::new();
        // The types that aren't unions form one run. They're sorted unless they're already in order.
        let (mut singles, mut are_in_order) = (Run::new(), true);
        for &ty in actual {
            let parts = self.parts(ty);
            match *parts {
                [] => {}
                [only] => {
                    let mut single = self.ranked(only);
                    if are_in_order && let Some(last) = singles.last_mut() {
                        are_in_order = self.compare_ranked(last, &mut single).is_lt();
                    }
                    singles.push(single);
                }
                _ => unions.push(parts),
            }
        }
        if !are_in_order {
            self.sort_ranked(&mut singles);
            singles.dedup_by_key(|it| it.ty);
        }
        match unions[..] {
            [] => members.extend(singles.iter().map(|it| it.ty)),
            [run] if singles.len() <= 1 || singles.len() * MUCH_LONGER <= run.len() => {
                self.insert_into_run(members, run, &mut singles);
            }
            _ => {
                let merged = self.merge_runs(&unions, &singles);
                members.extend(merged.iter().map(|it| it.ty));
            }
        }
    }

    /// Adds the members of `run` and `singles`, two sorted runs, to `members`, deduplicated and in order.
    /// Binary-searches for the position of each of `singles` and copies the rest.
    fn insert_into_run(&self, members: &mut Flat, run: &[TypeId], singles: &mut [Ranked<'p>]) {
        let mut from = 0;
        for single in singles {
            let (mut low, mut high) = (from, run.len());
            while low < high {
                let middle = (low + high) / 2;
                let mut member = self.ranked(run[middle]);
                if self.compare_ranked(&mut member, single).is_lt() {
                    low = middle + 1;
                } else {
                    high = middle;
                }
            }
            members.extend_from_slice(&run[from..low]);
            if run.get(low) != Some(&single.ty) {
                members.push(single.ty);
            }
            from = low;
        }
        members.extend_from_slice(&run[from..]);
    }

    /// Merges `unions` and `singles`, all of them sorted runs, into one deduplicated sorted run.
    fn merge_runs(&self, unions: &[&[TypeId]], singles: &[Ranked<'p>]) -> Run<'p> {
        let (mut runs, mut merged) = (Run::new(), Run::new());
        // Where each run ends.
        let mut ends: smallvec::SmallVec<[usize; 8]> = smallvec::SmallVec::new();
        for at in 0..unions.len() + usize::from(!singles.is_empty()) {
            let start = runs.len();
            match unions.get(at) {
                Some(run) => runs.extend(run.iter().map(|&ty| self.ranked(ty))),
                None => runs.extend_from_slice(singles),
            }
            // A run that begins after the end of the previous run extends it.
            let (before, added) = runs.split_at_mut(start);
            if let Some(last) = before.last_mut()
                && self.compare_ranked(last, &mut added[0]).is_lt()
            {
                ends.pop();
            }
            ends.push(runs.len());
        }
        if ends.len() > MAX_RUNS_TO_MERGE {
            self.sort_ranked(&mut runs);
            runs.dedup_by_key(|it| it.ty);
            return runs;
        }
        // So far no run begins after the end of the previous one.
        let mut may_follow = false;
        while ends.len() > 1 {
            merged.clear();
            let mut merged_ends: smallvec::SmallVec<[usize; 8]> = smallvec::SmallVec::new();
            let mut start = 0;
            for pair in ends.chunks(2) {
                let end = pair[pair.len() - 1];
                match *pair {
                    [middle, _] => {
                        let (left, right) = runs[start..end].split_at_mut(middle - start);
                        self.merge_two_runs(left, right, may_follow, &mut merged);
                    }
                    _ => merged.extend_from_slice(&runs[start..end]),
                }
                merged_ends.push(merged.len());
                start = end;
            }
            std::mem::swap(&mut runs, &mut merged);
            ends = merged_ends;
            may_follow = true;
        }
        runs
    }

    /// Merges `left` and `right` into `merged`, deduplicated and in order. Neither is empty. `may_follow`: `right` may
    /// begin after the end of `left`.
    fn merge_two_runs(
        &self,
        left: &mut [Ranked<'p>],
        right: &mut [Ranked<'p>],
        may_follow: bool,
        merged: &mut Run<'p>,
    ) {
        let last = left.len() - 1;
        if may_follow && self.compare_ranked(&mut left[last], &mut right[0]).is_lt() {
            merged.extend_from_slice(left);
            merged.extend_from_slice(right);
            return;
        }
        let (long, short) = match left.len() >= right.len() {
            true => (left, right),
            false => (right, left),
        };
        if short.len() * MUCH_LONGER <= long.len() {
            // Each search starts at the position found for the previous item.
            let mut from = 0;
            for item in short.iter_mut() {
                let (mut low, mut high) = (from, long.len());
                while low < high {
                    let middle = (low + high) / 2;
                    if self.compare_ranked(&mut long[middle], item).is_lt() {
                        low = middle + 1;
                    } else {
                        high = middle;
                    }
                }
                merged.extend_from_slice(&long[from..low]);
                if long.get(low).is_none_or(|it| it.ty != item.ty) {
                    merged.push(*item);
                }
                from = low;
            }
            merged.extend_from_slice(&long[from..]);
            return;
        }
        let (mut i, mut j) = (0, 0);
        while i < long.len() && j < short.len() {
            match self.compare_ranked(&mut long[i], &mut short[j]) {
                std::cmp::Ordering::Less => {
                    merged.push(long[i]);
                    i += 1;
                }
                // Only a type and itself compare equal.
                std::cmp::Ordering::Equal => j += 1,
                std::cmp::Ordering::Greater => {
                    merged.push(short[j]);
                    j += 1;
                }
            }
        }
        merged.extend_from_slice(&long[i..]);
        merged.extend_from_slice(&short[j..]);
    }

    /// `compare_types`. As in `sort_types`, a type's name is looked up once.
    fn compare_ranked(&self, a: &mut Ranked<'p>, b: &mut Ranked<'p>) -> std::cmp::Ordering {
        if a.ty == b.ty {
            return std::cmp::Ordering::Equal;
        }
        if a.flags != b.flags {
            return a.flags.cmp(&b.flags);
        }
        self.look_up_name(a);
        self.look_up_name(b);
        some_first(a.name, b.name).then_with(|| self.compare_types(a.ty, b.ty))
    }

    /// `containsType` for the members of a union. It tests identity, and comparing two types costs more than a linear
    /// scan over hundreds of ids.
    pub(super) fn contains_type(&self, types: &[TypeId], t: TypeId) -> bool {
        if types.len() <= 512 {
            return types.contains(&t);
        }
        self.binary_search_types(types, t).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::{PatternsByPrefix, Reduction, UnionArguments, UnionCalls};
    use crate::bind::SymbolId;
    use crate::program::{FileId, Sym};
    use crate::types::TypeId;

    /// Every string over `ab` of at most `len` bytes.
    fn strings(len: usize) -> Vec<Vec<u8>> {
        let mut all = vec![Vec::new()];
        let mut from = 0;
        for _ in 0..len {
            let until = all.len();
            for at in from..until {
                for byte in *b"ab" {
                    let mut longer = all[at].clone();
                    longer.push(byte);
                    all.push(longer);
                }
            }
            from = until;
        }
        all
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn candidates_are_the_patterns_whose_first_text_is_a_prefix() {
        let (texts, values) = (strings(4), strings(6));
        // Every third text is skipped, every fifth appears twice, and two patterns have no text.
        let mut patterns: Vec<(&[u8], u32)> = Vec::new();
        for (at, text) in texts.iter().enumerate().filter(|(at, _)| at % 3 != 0) {
            for _ in 0..1 + usize::from(at % 5 == 0) {
                patterns.push((text, patterns.len() as u32 + 2));
            }
        }
        let index = PatternsByPrefix::from_texts(patterns.clone(), vec![0, 1]);
        let mut found = Vec::new();
        for value in &values {
            index.candidates(value, &mut found);
            let mut expected = vec![0, 1];
            expected.extend(
                patterns
                    .iter()
                    .filter(|p| value.starts_with(p.0))
                    .map(|p| p.1),
            );
            assert_eq!(found, expected, "{:?}", bstr::BStr::new(value));
        }
    }

    fn get(calls: &UnionCalls, call: &UnionArguments) -> Option<TypeId> {
        calls.get(call.hash(), call)
    }

    #[test]
    fn cached_call_matches_only_identical_arguments() {
        let alias = |id: u32| Sym {
            file: FileId(0),
            id: SymbolId(id),
        };
        let literal = Reduction::Literal {
            merge_constrained: true,
        };
        let (types, answer) = ([TypeId(40), TypeId(50), TypeId(60)], TypeId(70));
        let call = UnionArguments {
            reduction: literal,
            types: &types,
            alias: Some((alias(1), &types[..1])),
        };
        let mut calls = UnionCalls::default();
        assert_eq!(get(&calls, &call), None);
        calls.put(call.hash(), &call, answer);
        assert_eq!(get(&calls, &call), Some(answer));
        let others = [
            UnionArguments {
                types: &[TypeId(50), TypeId(40), TypeId(60)],
                ..call
            },
            UnionArguments {
                types: &types[..2],
                ..call
            },
            // The same ids, split differently between types and alias type arguments.
            UnionArguments {
                types: &[TypeId(40), TypeId(50), TypeId(60), TypeId(40)],
                alias: Some((alias(1), &[])),
                ..call
            },
            UnionArguments {
                reduction: Reduction::None,
                ..call
            },
            UnionArguments {
                reduction: Reduction::Literal {
                    merge_constrained: false,
                },
                ..call
            },
            UnionArguments {
                alias: None,
                ..call
            },
            UnionArguments {
                alias: Some((alias(2), &types[..1])),
                ..call
            },
            UnionArguments {
                alias: Some((alias(1), &types[1..2])),
                ..call
            },
            UnionArguments {
                alias: Some((alias(1), &types[..2])),
                ..call
            },
        ];
        for (at, other) in others.iter().enumerate() {
            assert_eq!(get(&calls, other), None, "{at}");
        }
        for (at, other) in others.iter().enumerate() {
            calls.put(other.hash(), other, TypeId(at as u32));
            assert_eq!(get(&calls, other), Some(TypeId(at as u32)));
        }
    }

    #[test]
    #[cfg_attr(miri, ignore)]
    fn cached_calls_are_evicted_but_never_mixed_up() {
        let mut calls = UnionCalls::default();
        let types_of = |at: u32, len: usize| -> Vec<TypeId> {
            (0..len as u32).map(|i| TypeId(at * 7 + i)).collect()
        };
        // Long enough for `slots` to reach its full size, and for `types` to be dropped a few times.
        let lens = [2, 3, 8, 9, 100, 5000];
        let count = 3 * UnionCalls::MAX_SLOTS as u32;
        let mut found = 0;
        for at in 0..count {
            let types = types_of(at, lens[at as usize % lens.len()]);
            let call = UnionArguments {
                reduction: Reduction::None,
                types: &types,
                alias: None,
            };
            calls.put(call.hash(), &call, TypeId(at));
            assert_eq!(get(&calls, &call), Some(TypeId(at)));
            assert!(calls.types.len() <= UnionCalls::MAX_TYPES);
            // An earlier call either still has its own answer or is gone.
            let earlier = at / 2;
            let types = types_of(earlier, lens[earlier as usize % lens.len()]);
            let call = UnionArguments {
                types: &types,
                ..call
            };
            let known = get(&calls, &call);
            assert!(known.is_none() || known == Some(TypeId(earlier)));
            found += u32::from(known.is_some());
        }
        assert!(found > 0 && found < count);
        assert_eq!(calls.slots.len(), UnionCalls::MAX_SLOTS);
        let too_long = vec![TypeId(1); UnionCalls::MAX_TYPES + 1];
        let call = UnionArguments {
            reduction: Reduction::None,
            types: &too_long,
            alias: None,
        };
        calls.put(call.hash(), &call, TypeId(1));
        assert_eq!(get(&calls, &call), None);
    }

    #[test]
    fn long_lists_differing_in_the_middle_are_distinct() {
        fn call(types: &[TypeId]) -> UnionArguments<'_> {
            UnionArguments {
                reduction: Reduction::None,
                types,
                alias: None,
            }
        }
        for len in [32, 33, 100] {
            let types: Vec<TypeId> = (0..len).map(TypeId).collect();
            let mut other = types.clone();
            other[len as usize / 2] = TypeId(1000);
            // Only a list of more than 32 has a middle that its hash skips.
            assert_eq!(call(&types).hash() == call(&other).hash(), len > 32);
            let mut calls = UnionCalls::default();
            calls.put(call(&types).hash(), &call(&types), TypeId(1));
            assert_eq!(get(&calls, &call(&types)), Some(TypeId(1)));
            assert_eq!(get(&calls, &call(&other)), None);
            calls.put(call(&other).hash(), &call(&other), TypeId(2));
            assert_eq!(get(&calls, &call(&other)), Some(TypeId(2)));
        }
    }
}
