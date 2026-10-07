//! Construction of union and intersection types.

use super::*;

/// The sort key of a declaration: library files first, then by file, then by position.
/// `compareNodes`
type Place = (bool, FileId, u32);

/// The members of a union or an intersection under construction.
type Flat = smallvec::SmallVec<[TypeId; 16]>;

/// `T & P` as `constrained_type_variable` takes it apart.
#[derive(Copy, Clone)]
struct ConstrainedTypeVariable {
    /// `T`
    variable: TypeId,
    /// `P`
    primitive: TypeId,
    /// The base constraint of `T`.
    constraint: TypeId,
}

/// The pattern literal types of a union by the text they start with. A string literal only matches
/// a template literal type whose first text it starts with: that is the first test of
/// `inferFromLiteralPartsToTemplateLiteral`. With thousands of literals and of patterns, testing
/// every pair dominates the time of the check.
struct PatternsByPrefix<'p> {
    /// The first text and the index of each template literal type, sorted.
    sorted: Vec<(&'p [u8], u32)>,
    /// For each entry of `sorted`, the nearest earlier entry whose text is a prefix of its text.
    parent: Vec<u32>,
    /// The indices of the other patterns, which are string mappings.
    others: Vec<u32>,
}

impl<'p> PatternsByPrefix<'p> {
    const WORTHWHILE: usize = 16;
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

    /// The indices of the patterns that `value` may match, ascending.
    fn candidates(&self, value: &[u8], into: &mut Vec<u32>) {
        into.clear();
        into.extend_from_slice(&self.others);
        // A text that `value` starts with sorts before `value`, and every text between the two
        // starts with it too. So it is the last text that sorts before `value`, or a prefix of it.
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

/// The other kinds have no alias, no name and no symbol.
const NAMED: u32 = tf::OBJECT
    | tf::UNION
    | tf::INTERSECTION
    | tf::INDEXED_ACCESS
    | tf::CONDITIONAL
    | tf::TYPE_PARAMETER
    | tf::STRING_MAPPING
    | tf::ENUM
    | tf::UNIQUE_ES_SYMBOL;

/// `Some`, a name or a declaration, sorts before `None`.
fn some_first<T: Ord>(a: Option<T>, b: Option<T>) -> std::cmp::Ordering {
    match (a, b) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    }
}

/// A stable sort for `CompareTypes`, which is not a total order: `slice::sort_by` may panic.
/// A comparison of two instantiations of one alias is expensive, and what is sorted is often nearly
/// in order or made of sorted runs. A binary insertion sort compares twice as often there.
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

    /// `merge_constrained`: whether `T & P1 | T & P2` reduces to `T`. It does not for intersections
    /// created without inspecting the constraint of `T`, which lack
    /// `ObjectFlagsIsConstrainedTypeVariable`.
    fn union_ex(&mut self, types: &[TypeId], merge_constrained: bool) -> TypeId {
        // The union of two types is the same in either order.
        let pair = match *types {
            [] => return TypeId::NEVER,
            [one] => return one,
            // `addTypeToUnion` sets `TypeFlagsIncludesError`: only a list of one type is returned
            // unchanged.
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
                return a;
            }
            [a, b] if merge_constrained => Some(if a.arrival_order() < b.arrival_order() {
                (a, b)
            } else {
                (b, a)
            }),
            _ => None,
        };
        if let Some((a, b)) = pair
            && let Some(known) = self.recent_unions.get(a.0, b.0)
        {
            return TypeId(known);
        }
        let (union, is_plain) = self.create_union(types, merge_constrained);
        if is_plain && let Some((a, b)) = pair {
            self.recent_unions.put(a.0, b.0, union.0);
        }
        union
    }

    /// `getUnionType(types, UnionReductionNone)`: `A | B | ...` with every member preserved,
    /// including `any` and `unknown` next to other members. `string | "a"` shows that the literal
    /// type is accepted and `keyof T | unknown` that a generic type is, which is what matters in a
    /// contextual type.
    pub fn union_unreduced(&mut self, types: &[TypeId]) -> TypeId {
        if let [one] = types {
            return *one;
        }
        // The contextual type `Commands[T] | undefined` becomes the constraint, a union of
        // hundreds of object types, next to `undefined`, for every property of an argument.
        if let [a, b] = *types {
            if let Some(known) = self.recent_unreduced_unions.get(a.0, b.0) {
                return TypeId(known);
            }
            let union = self.create_unreduced_union(types);
            self.recent_unreduced_unions.put(a.0, b.0, union.0);
            return union;
        }
        self.create_unreduced_union(types)
    }

    fn create_unreduced_union(&mut self, types: &[TypeId]) -> TypeId {
        let mut members = Flat::new();
        for &ty in types {
            self.add_to_union(&mut members, ty);
        }
        members.sort_unstable_by_key(|m| m.arrival_order());
        members.dedup();
        if members.first() == Some(&TypeId::UNRESOLVED) {
            return TypeId::UNRESOLVED;
        }
        // `addTypeToUnion`: without strictNullChecks null and undefined are never members. If there
        // are no other members the result is never.
        if !self.p.files.options.strict_null_checks {
            members.retain(|m| !m.is_undefined() && !m.is_null());
        }
        self.sort_type_set(types, &mut members);
        match members[..] {
            [] => TypeId::NEVER,
            [only] => only,
            _ => self.union_of_named_unions(types, &members),
        }
    }

    /// `getUnionTypeWorker` with `UnionReductionLiteral`. Also returns whether only the members
    /// were inspected, in which case the same types give the same result for any caller.
    #[inline(never)]
    fn create_union(&mut self, actual: &[TypeId], merge_constrained: bool) -> (TypeId, bool) {
        let mut members = Flat::new();
        for &ty in actual {
            self.add_to_union(&mut members, ty);
        }
        members.sort_unstable_by_key(|m| m.arrival_order());
        members.dedup();
        // `TypeFlagsIncludesWildcard`
        if members.contains(&TypeId::WILDCARD) {
            return (TypeId::WILDCARD, true);
        }
        // `TypeFlagsIncludesError`: the error type takes precedence over `any` and `unknown`.
        if members.first() != Some(&TypeId::UNRESOLVED)
            && members.iter().any(|&member| self.is_error_type(member))
        {
            return (TypeId::ERROR, true);
        }
        match members[..] {
            [] => return (TypeId::NEVER, true),
            // The unresolved type, `any` and `unknown`, in this order of precedence, absorb all
            // other members. They have the lowest ids.
            [TypeId::UNRESOLVED, TypeId::ANY, ..] => return (TypeId::ANY, true),
            [
                first @ (TypeId::UNRESOLVED | TypeId::ANY | TypeId::UNKNOWN),
                ..,
            ] => {
                return (first, true);
            }
            [only] => return (only, true),
            _ => {}
        }
        // `addTypeToUnion`: without strictNullChecks every type includes null and undefined, and
        // they are never members. If there are no other members the result is null in preference to
        // undefined, in its non-widening form if any input was non-widening
        // (`TypeFlagsIncludesNonWideningType`).
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
                return (left, true);
            }
        }
        // A bit for each type that is present among those with the lowest ids. They sort first.
        let mut low = 0u32;
        for m in members.iter().take_while(|m| m.arrival_order() < 32) {
            low |= 1 << m.arrival_order();
        }
        let has = |t: TypeId| low & 1 << t.arrival_order() != 0;
        // The missing type is redundant next to the regular `undefined`.
        if has(TypeId::MISSING) && has(TypeId::UNDEFINED) {
            members.retain(|m| *m != TypeId::MISSING);
        }
        let mut is_plain = true;
        // `includes&TypeFlagsIncludesInstantiable`, of a member that is removed.
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
                    // `constrained_type_variable` returns nothing for an intersection of any other
                    // form.
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
                let snapshot = if any_fresh {
                    Flat::from_slice(&members[..])
                } else {
                    Flat::new()
                };
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
                    // Whether a pattern matches a literal depends on the two alone.
                    is_plain = !has_constrained;
                    // Both evaluate something for each member, and evaluation order determines the
                    // creation order of types. tsgo keeps the set sorted from the start.
                    self.sort_type_set(actual, &mut members);
                }
                if has_pattern {
                    self.remove_string_literals_matched_by_template_literals(&mut members);
                }
                if has_constrained {
                    self.remove_constrained_type_variables(&mut members);
                }
            }
        }
        // Up to here they were ordered by id.
        self.sort_type_set(actual, &mut members);
        let first_new_type_id = self.types().first_new_type_id();
        let union = match members[..] {
            [] => TypeId::NEVER,
            [only] => only,
            _ => self.union_of_named_unions(actual, &members),
        };
        if includes_removed_pattern && self.types().is_new_since(union, first_new_type_id) {
            self.types().mark_without_primitive_union(union);
        }
        (union, is_plain)
    }

    /// The end of `getUnionTypeWorker`: the union of `members`, in order, which was built from
    /// `actual`. It has a denormalized `origin` if some of `actual` are named unions, or were built
    /// from named unions, and no member belongs to two of them.
    fn union_of_named_unions(&self, actual: &[TypeId], members: &[TypeId]) -> TypeId {
        let mut named: smallvec::SmallVec<[TypeId; 4]> = smallvec::SmallVec::new();
        self.add_named_unions(&mut named, actual);
        if named.is_empty() {
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
        let by_prefix = (patterns.len() >= PatternsByPrefix::WORTHWHILE)
            .then(|| PatternsByPrefix::new(self, &patterns));
        let mut candidates: Vec<u32> = Vec::new();
        for m in std::mem::take(members) {
            // For a type with `TypeFlagsStringLiteral`: the value, and whether it is the plain
            // string literal type of that value.
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

    /// For `T & P` or `P & T`, where `T` is a type variable whose constraint consists only of
    /// primitives, `object` and `{}`, and `P` is one of those: `T`, `P` and the constraint of `T`.
    /// An intersection of this form that `getIntersectionTypeEx` does not reduce is the one it
    /// marks `ObjectFlagsIsConstrainedTypeVariable`. `includes_empty_object`: the intersected types
    /// include or included a `{}`, in which case `P` may be any type.
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

    /// `ObjectFlagsIsConstrainedTypeVariable` of `ty`, the intersection of `a` and `b`. Where no
    /// request of `getIntersectionTypeEx` is on record, the flag that a request for `a & b` gives.
    fn is_constrained_type_variable(&mut self, ty: TypeId, a: TypeId, b: TypeId) -> bool {
        if let Some(known) = self.types().is_constrained_type_variable(ty) {
            return known;
        }
        let includes_empty_object =
            self.is_empty_anonymous_object_type(a) || self.is_empty_anonymous_object_type(b);
        self.constrained_type_variable(a, b, includes_empty_object)
            .is_some()
    }

    /// `removeConstrainedTypeVariables`: `T & P1 | T & P2` reduces to `T` once the `P`s cover the
    /// whole constraint of `T`.
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

    /// A union in which no member is a subtype of another. `UnionReductionSubtype`
    pub fn union_reduced(&mut self, types: &[TypeId]) -> TypeId {
        // `unionOfUnionTypes`: the error type is stored too, and is reported once.
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
        let mut union = self.union(types);
        let TypeData::Union(members) = self.data(union) else {
            return union;
        };
        // `removeRedundantLiteralTypes`, reduceVoidUndefined: `void` includes `undefined`.
        if members.contains(&TypeId::VOID) && members.iter().any(|m| m.is_undefined()) {
            union = self.filter(union, |_, m| !m.is_undefined());
        }
        let TypeData::Union(members) = self.data(union) else {
            return union;
        };
        // Primitives and literals were handled above.
        if !members
            .iter()
            .any(|&m| self.flags(m) & tf::STRUCTURED_OR_INSTANTIABLE != 0)
        {
            return union;
        }
        let len = members.len();
        let mut members: Vec<TypeId> = members.to_vec();
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
        // `removeSubtypes` iterates over the members from last to first in `CompareTypes` order,
        // which therefore decides which of two mutual subtypes is removed. Where that order falls
        // back to ids, which depend on the thread here, declared types come before types created by
        // expressions, and the latter keep the given order.
        let key = |c: &Self, m: TypeId| {
            let created_by_expression = match c.data(m) {
                // `{ ...t, a: 1 }`
                TypeData::Intersection(parts) => {
                    parts.iter().any(|&p| is_created_by_expression(c, p))
                }
                _ => is_created_by_expression(c, m),
            };
            (
                created_by_expression,
                actual.iter().position(|&g| g == m).unwrap_or(usize::MAX),
            )
        };
        let mut compare = |&x: &TypeId, &y: &TypeId| {
            self.compare_types_without_ids(x, y)
                .then_with(|| key(self, x).cmp(&key(self, y)))
        };
        merge_sort_by(&mut members, &mut compare, &mut Vec::new());
        // hasEmptyObject: next to an empty object type, primitives are candidates for removal too:
        // `{} | 0` is `{}`.
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
            // The first property with a unit type. Members that differ in it need no comparison.
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
                // At this rate the total exceeds a million comparisons: too complex to represent, so
                // the result is the error type.
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
                // `emptyObjectType`, which has no symbol, is not removed in favor of an empty type
                // that has one.
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
                // An object type is a subtype of no primitive.
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
        if keep.iter().all(|&k| k) {
            return union;
        }
        let mut kept: Flat = members
            .iter()
            .zip(&keep)
            .filter(|(_, k)| **k)
            .map(|(&m, _)| m)
            .collect();
        self.sort_type_set(types, &mut kept);
        match kept[..] {
            [] => TypeId::NEVER,
            [only] => only,
            _ => self.union_of_named_unions(types, &kept),
        }
    }

    /// `removeSubtypes`, keyProperty: the first property of `ty` whose type is a unit type, and
    /// that type. The types of the preceding properties are resolved on the way, as
    /// `removeSubtypes` does.
    fn first_unit_property(&mut self, ty: TypeId) -> Option<(Atom, TypeId)> {
        let apparent = self.apparent_type(ty);
        let members = self.members(apparent)?;
        for prop in &members.shape().props {
            let of_prop = self.type_of_prop(prop, members.mapper);
            if self.is_unit(of_prop) {
                return Some((prop.name, self.with_freshness(of_prop, false)));
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
                        // The remainder of a denormalized origin, unless a member inside one of its
                        // unions was removed.
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
                        let first_new_type_id = self.types().first_new_type_id();
                        let filtered = self.types().intern_key_with(
                            TypeKey::Union(&kept),
                            &ProvenanceKey {
                                alias: None,
                                origin: new_origin,
                                is_enum: false,
                                stored_under: None,
                                is_array_literal: false,
                            },
                        );
                        // `ObjectFlagsPrimitiveUnion` is forwarded.
                        if self.types().is_new_since(filtered, first_new_type_id)
                            && !self.is_primitive_union(ty)
                        {
                            self.types().mark_without_primitive_union(filtered);
                        }
                        filtered
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
                } else if let Some(kept) = self.union_of_kept_members(types, &mapped) {
                    debug_assert!({
                        let union = match no_reductions {
                            true => self.union_unreduced(&mapped),
                            false => self.union(&mapped),
                        };
                        kept == union || self.has_compared_without_total_order.get()
                    });
                    kept
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

    /// FOR SPEED: the union of `mapped`, if each is the member of `types` it was mapped from or
    /// `never`, as when a type guard narrows a union of object types. What is kept is in order, and
    /// no reduction applies to object types, so there is nothing to sort or to remove.
    fn union_of_kept_members(&self, types: &[TypeId], mapped: &[TypeId]) -> Option<TypeId> {
        let is_object = |t: TypeId| self.flags(t) & tf::OBJECT != 0;
        let mut kept: smallvec::SmallVec<[TypeId; 8]> = smallvec::SmallVec::new();
        for (&from, &to) in types.iter().zip(mapped) {
            if to == TypeId::NEVER {
                continue;
            }
            let is_reduced = match self.data(to) {
                TypeData::Intersection(parts) => parts.iter().all(|&part| is_object(part)),
                _ => is_object(to),
            };
            if to != from || !is_reduced {
                return None;
            }
            kept.push(to);
        }
        Some(match kept[..] {
            [] => TypeId::NEVER,
            [only] => only,
            _ => self.union_of_named_unions(mapped, &kept),
        })
    }

    /// `isPatternLiteralPlaceholderType`
    pub(super) fn is_pattern_literal_placeholder(&self, ty: TypeId) -> bool {
        if let TypeData::Intersection(parts) = self.data(ty) {
            // One placeholder or more, and object types that only tag it.
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

    /// A template literal or string mapping type with no generic part: `a${string}`,
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
        self.intersection_ex(types, false)
    }

    /// The same, but `T & P` is not reduced using the constraint of `T`.
    /// `IntersectionFlagsNoConstraintReduction`
    pub(super) fn intersection_without_constraint_reduction(&mut self, types: &[TypeId]) -> TypeId {
        self.intersection_ex(types, true)
    }

    /// `addTypesToIntersection`, `addTypeToIntersection`: order is preserved, because it matters
    /// for overloads, and only duplicates are removed. Returns `includes` with the flags the types
    /// add to it.
    fn add_types_to_intersection(
        &mut self,
        set: &mut Flat,
        mut includes: u32,
        types: &[TypeId],
    ) -> u32 {
        for &ty in types {
            let ty = self.regular(ty);
            if let TypeData::Intersection(inner) = self.data(ty) {
                includes = self.add_types_to_intersection(set, includes, inner);
                continue;
            }
            // Only the first of the types that count as `{}` is added.
            if self.is_empty_anonymous_object_type(ty) {
                if includes & tf::INCLUDES_EMPTY_OBJECT == 0 {
                    includes |= tf::INCLUDES_EMPTY_OBJECT;
                    set.push(ty);
                }
                continue;
            }
            let flags = self.flags(ty);
            if flags & (tf::ANY | tf::UNKNOWN) != 0 {
                if ty == TypeId::UNRESOLVED {
                    includes |= tf::INCLUDES_UNRESOLVED;
                }
                if self.is_error_type(ty) {
                    includes |= tf::INCLUDES_ERROR;
                }
                if ty == TypeId::WILDCARD {
                    includes |= tf::INCLUDES_WILDCARD;
                }
            } else if self.p.files.options.strict_null_checks || flags & tf::NULLABLE == 0 {
                let ty = if ty == TypeId::MISSING {
                    includes |= tf::INCLUDES_MISSING_TYPE;
                    TypeId::UNDEFINED
                } else {
                    ty
                };
                if !set.contains(&ty) {
                    // No value has two different unit types. The `object` flag next to the unit
                    // flags signals that to the code further on.
                    if flags & tf::UNIT != 0 && includes & tf::UNIT != 0 {
                        includes |= tf::NON_PRIMITIVE;
                    }
                    set.push(ty);
                }
            }
            includes |= flags & tf::INCLUDES_MASK;
        }
        includes
    }

    /// `getIntersectionTypeEx`
    fn intersection_ex(&mut self, types: &[TypeId], no_constraint_reduction: bool) -> TypeId {
        self.intersection_worker(types, no_constraint_reduction).0
    }

    /// `getIntersectionTypeEx`, with an alias.
    pub(super) fn intersection_with_alias(
        &mut self,
        types: &[TypeId],
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        match (self.intersection_worker(types, false), alias) {
            ((created, true), Some((alias, type_arguments))) => {
                // `getIntersectionKey`
                self.get_symbol_id(alias);
                let aliased = self.with_alias(created, alias, type_arguments);
                if let Some(flag) = self.types().is_constrained_type_variable(created) {
                    self.types().set_constrained_type_variable(aliased, flag);
                }
                aliased
            }
            ((created, _), _) => created,
        }
    }

    /// `getUnionTypeEx`, with an alias.
    pub(super) fn union_with_alias(
        &mut self,
        types: &[TypeId],
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        if let [only] = types {
            return *only;
        }
        // `UnionOfUnionKey`
        if let (Some((alias, _)), &[a, b]) = (alias, types)
            && (self.is_union(a) || self.is_union(b))
        {
            self.get_symbol_id(alias);
        }
        let created = self.union(types);
        match alias {
            Some((alias, type_arguments)) if self.is_union(created) => {
                self.union_type_with_alias(created, alias, type_arguments)
            }
            _ => created,
        }
    }

    /// `getIntersectionTypeEx`. The flag: the result was created here, so the given alias, if any,
    /// is its alias. A result that is the one remaining member of `types` was not.
    fn intersection_worker(
        &mut self,
        types: &[TypeId],
        no_constraint_reduction: bool,
    ) -> (TypeId, bool) {
        let mut set = Flat::with_capacity(types.len());
        let includes = self.add_types_to_intersection(&mut set, 0, types);
        if includes & tf::NEVER != 0 {
            let never = if set.contains(&TypeId::SILENT_NEVER) {
                TypeId::SILENT_NEVER
            } else {
                TypeId::NEVER
            };
            return (never, false);
        }
        if includes & tf::INCLUDES_UNRESOLVED != 0 {
            return (TypeId::UNRESOLVED, false);
        }
        let strict = self.p.files.options.strict_null_checks;
        // No value is both an object and null or undefined, or belongs to two disjoint domains.
        let is_in_another_too = |domain: u32| {
            includes & domain != 0 && includes & (tf::DISJOINT_DOMAINS & !domain) != 0
        };
        if strict
            && includes & tf::NULLABLE != 0
            && includes & (tf::OBJECT | tf::NON_PRIMITIVE | tf::INCLUDES_EMPTY_OBJECT) != 0
            || is_in_another_too(tf::NON_PRIMITIVE)
            || is_in_another_too(tf::STRING_LIKE)
            || is_in_another_too(tf::NUMBER_LIKE)
            || is_in_another_too(tf::BIGINT_LIKE)
            || is_in_another_too(tf::ES_SYMBOL_LIKE)
            || is_in_another_too(tf::VOID_LIKE)
        {
            return (TypeId::NEVER, false);
        }
        if includes & (tf::TEMPLATE_LITERAL | tf::STRING_MAPPING) != 0
            && includes & tf::STRING_LITERAL != 0
            && !self.extract_redundant_template_literals(&mut set)
        {
            return (TypeId::NEVER, false);
        }
        if includes & tf::ANY != 0 {
            let any = if includes & tf::INCLUDES_WILDCARD != 0 {
                TypeId::WILDCARD
            } else if includes & tf::INCLUDES_ERROR != 0 {
                TypeId::ERROR
            } else {
                TypeId::ANY
            };
            return (any, false);
        }
        // Without strictNullChecks null and undefined were not added to the set, and the
        // intersection reduces to them.
        if !strict && includes & tf::NULLABLE != 0 {
            let left = if includes & tf::INCLUDES_EMPTY_OBJECT != 0 {
                TypeId::NEVER
            } else if includes & tf::UNDEFINED != 0 {
                TypeId::UNDEFINED
            } else {
                TypeId::NULL
            };
            return (left, false);
        }
        // `{}` is removed next to a type that cannot be null or undefined
        // (`TypeFlagsDefinitelyNonNullable`), which is not known of a union. `U & {}`, where `U` is
        // a union of only such types, is `U` after distribution, so distribution is skipped.
        // `boolean` and enum unions have such a flag themselves, and are not distributed over.
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
            0 => return (TypeId::UNKNOWN, false),
            // `getUnionTypeEx(constituents, UnionReductionLiteral, alias, nil)`: a separate union.
            1 if is_distributed_over && self.is_union(set[0]) => {
                let members = self.parts(set[0]);
                return (self.union(members), true);
            }
            1 => return (set[0], false),
            _ => {}
        }
        // `T & P` is reduced using the constraint of `T`.
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
                return (variable, false);
            }
            // `T & number` is never: no member of the constraint of `T` is a subtype of `P`, and
            // `P` is not a subtype of the constraint of `T`.
            let parts = self.parts(constraint);
            if !(parts.len() > 1 && parts.iter().any(|&p| self.is_strict_subtype(p, primitive)))
                && !self.is_strict_subtype(primitive, constraint)
            {
                return (TypeId::NEVER, false);
            }
            is_constrained_type_variable = true;
        }
        if includes & tf::UNION == 0 {
            let created = self.intern_key(TypeKey::Intersection(&set));
            if !no_constraint_reduction && set.len() == 2 {
                self.types()
                    .set_constrained_type_variable(created, is_constrained_type_variable);
            }
            return (created, true);
        }
        // `intersectionTypes`: the cached result for the same types. The number of `types` is not
        // in the key: the first request decides whether the set is split in halves.
        let key = (Box::<[TypeId]>::from(&set[..]), no_constraint_reduction);
        let table = &self.p.distributed_intersections;
        if let Some(known) = table.get(&self.task, &key) {
            return known;
        }
        let scope = self.begin_scope();
        let result = self.distribute_intersection(types.len(), set, no_constraint_reduction);
        match (result, self.end_scope_by_counters(scope)) {
            // `return c.errorType`, before the result is stored: the next request reports again.
            (None, _) => (TypeId::ERROR, false),
            (Some(result), Ok(stored)) => table.insert(&self.task, key, result, stored),
            (Some(result), Err(_)) => result,
        }
    }

    /// `checkCrossProductUnion`
    pub(super) fn check_cross_product_union(&mut self, types: &[TypeId]) -> bool {
        self.checked_cross_product_union_size(types).is_some()
    }

    /// `getCrossProductUnionSize`, if `checkCrossProductUnion` accepts it.
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

    /// `getIntersectionType` for types some of which are unions. `actual`: the number of types in
    /// the request. `None`: `checkCrossProductUnion` has refused the set.
    fn distribute_intersection(
        &mut self,
        actual: usize,
        mut set: Flat,
        no_constraint_reduction: bool,
    ) -> Option<(TypeId, bool)> {
        if self.intersect_unions_of_primitive_types(&mut set) {
            // Happens only once: at most one such union is left.
            return Some(self.intersection_worker(&set, no_constraint_reduction));
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
            let rest = self.intersection_ex(&set, no_constraint_reduction);
            let union = self.union_ex(&[rest, undefined], !no_constraint_reduction);
            return Some((union, self.is_union(union)));
        }
        if set
            .iter()
            .all(|&t| self.is_union(t) && self.parts(t).iter().any(|m| m.is_null()))
        {
            for t in &mut set {
                *t = self.filter(*t, |_, m| !m.is_null());
            }
            let rest = self.intersection_ex(&set, no_constraint_reduction);
            let union = self.union_ex(&[rest, TypeId::NULL], !no_constraint_reduction);
            return Some((union, self.is_union(union)));
        }
        // `A & B & C & D` is `(A & B) & (C & D)`: much of a half may reduce to never. Not applied
        // to two types, which would recurse forever.
        if set.len() >= 3 && actual > 2 {
            let middle = set.len() / 2;
            let left = self.intersection_ex(&set[..middle], no_constraint_reduction);
            let right = self.intersection_ex(&set[middle..], no_constraint_reduction);
            return Some(self.intersection_worker(&[left, right], no_constraint_reduction));
        }
        // `X & (A | B) & (C | D)` is `X & A & C | X & A & D | X & B & C | X & B & D`.
        let size = self.checked_cross_product_union_size(&set)?;
        // `getCrossProductIntersections`
        let mut intersections: Vec<TypeId> = Vec::with_capacity(size);
        let mut constituents = set.to_vec();
        for i in 0..size {
            let mut n = i;
            for j in (0..set.len()).rev() {
                if let TypeData::Union(alternatives) = self.data(set[j]) {
                    constituents[j] = alternatives[n % alternatives.len()];
                    n /= alternatives.len();
                }
            }
            let one = self.intersection_ex(&constituents, no_constraint_reduction);
            if !one.is_never() {
                intersections.push(one);
            }
        }
        let union = self.union_ex(&intersections, !no_constraint_reduction);
        // The denormalized `origin`: where a constituent is an intersection and the origin has fewer constituents than the union.
        if self.is_union(union)
            && intersections.iter().any(|&t| self.is_intersection(t))
            && self.constituent_count_of_types(&intersections)
                > self.constituent_count_of_types(&set)
        {
            return Some((self.with_origin(union, OriginKey::Intersection(&set)), true));
        }
        Some((union, self.is_union(union)))
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

    /// `extractRedundantTemplateLiterals`: `get${T}` is redundant next to `"getX"`. `false`: the
    /// intersection is empty, as for `get${string}` and `"setX"`.
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
                let fits = match *self.data(literal) {
                    // An enum member matches a template literal type by its value, and is not a
                    // member of a string mapping type.
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
                if fits {
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

    /// `ObjectFlagsPrimitiveUnion`: a union with no member that has `TypeFlagsNotPrimitiveUnion`.
    /// `object` is allowed. `void`, template literal types and `keyof T` are not. `filterType`
    /// forwards the flag, so what it is the first to create from another union lacks it.
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

    /// `intersectUnionsOfPrimitiveTypes`: multiple unions of primitives, which is what `keyof (A |
    /// B | C)` produces, are intersected as sets. The common members replace the first union, and
    /// the other unions are removed. `false`: there are fewer than two.
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
                // `undefined` and the missing type match each other. The missing type is the one
                // that stays.
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

    /// `eachUnionContains`: `"a"` is in a union that has `string`.
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

    /// `ty` without `undefined`, including the missing type.
    pub fn without_undefined(&mut self, ty: TypeId) -> TypeId {
        self.filter(ty, |_, m| !m.is_undefined())
    }

    pub fn contains_undefined(&self, ty: TypeId) -> bool {
        self.parts(ty).iter().any(|m| m.is_undefined())
    }

    // ───────────────────────────── the order of the members of a union ─────────────────────────────

    /// `getSortOrderFlags`
    fn sort_order_flags(&self, ty: TypeId) -> u32 {
        let flags = self.flags(ty);
        if flags & tf::ENUM_LIKE != 0 && flags & tf::UNION == 0 {
            return tf::ENUM;
        }
        flags
    }

    /// `getTypeNameSymbol`, its name. `alias`: `t.alias.symbol`.
    fn type_name(&self, ty: TypeId, alias: Option<Sym>) -> Option<&'p [u8]> {
        let files = self.files();
        let name = match (alias, self.data(ty)) {
            (Some(alias), _) => files.symbol(alias).name,
            // The `this` type has the symbol of its class.
            (None, &TypeData::Ref { target: sym, .. } | &TypeData::ThisParam(sym)) => {
                files.symbol(sym).name
            }
            (None, &TypeData::TypeParam(file, tp, _)) => self.hir(file)[tp].name,
            (None, &TypeData::StringMapping { kind, .. }) => {
                return Some(super::print::string_mapping_name(kind));
            }
            _ => return None,
        };
        // `InternalSymbolNameClass`, of a class expression without a name.
        Some(if name.is_none() {
            &b"\xFEclass"[..]
        } else if name == known::missing {
            &b"\xFEmissing"[..]
        } else {
            self.atoms().bytes(name)
        })
    }

    /// The position of the first declaration of `sym`. `compareSymbols`
    fn symbol_place(&self, sym: Sym) -> Option<Place> {
        let files = self.files();
        let (file, decl) = if files.flags(sym).contains(SymFlags::MERGED) {
            files.decls(sym).first().copied()?
        } else {
            (sym.file, files.symbol(sym).decls.first().copied()?)
        };
        let pos = self.files().start_of_declaration(file, decl);
        Some((!files.module(file).is_lib, file, pos))
    }

    /// The declaration position of the symbol of `ty`, or of the syntax it is the type of. A
    /// synthesized type has none here.
    fn sort_place(&self, ty: TypeId) -> Option<Place> {
        let at = |file: FileId, pos: u32| -> Option<Place> {
            Some((!self.files().module(file).is_lib, file, pos))
        };
        match *self.data(ty) {
            TypeData::Ref { target: sym, .. }
            | TypeData::ThisParam(sym)
            | TypeData::Enum { symbol: sym, .. }
            | TypeData::EnumLit { member: sym, .. } => self.symbol_place(sym),
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
                | Origin::Namespace { module: sym, .. } => self.symbol_place(sym),
                _ => None,
            },
            TypeData::Fns { ref decls, .. } => decls
                .first()
                .and_then(|&(file, func)| at(file, self.hir(file)[func].start)),
            TypeData::Synth(ref shape) => match shape.symbol_declared_at {
                Some((file, pos, _)) => at(file, pos),
                // `getOrCreateTypeFromSignature`: the symbol has the declaration of the signature.
                // That of `getInstantiatedTypePart` has none, and comes after those that have one.
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
                UniqueSymbolDeclaration::Variable(variable) => self.symbol_place(variable),
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

    /// The sort key `compareNodes` uses for a node at `pos` of `file`: the index of the file in the
    /// program (`fileIndexMap`), then the position. Library files come first.
    pub(super) fn place_in_program_order(&self, file: FileId, pos: u32) -> (bool, u32, u32) {
        let files = self.files();
        (!files.module(file).is_lib, files.rank_of_file(file), pos)
    }

    /// `t.symbol.Declarations[0]` of an object type: the file and the position.
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
        self.sort_place(ty).map(|place| (place.1, place.2, literal))
    }

    /// `Shape::mapper` for a type that gets `t.symbol`, the symbol of an object literal
    /// (`newAnonymousType(t.symbol, ..)`): what the outer type parameters of the literal are mapped
    /// to in `ty`.
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

    /// `compareSymbols`, limited to the comparison of the first declarations.
    fn compare_symbols(&self, s: Sym, t: Sym) -> std::cmp::Ordering {
        let place = |symbol: Sym| {
            let (_, file, pos) = self.symbol_place(symbol)?;
            Some(self.place_in_program_order(file, pos))
        };
        some_first(place(s), place(t))
    }

    /// `compareTypeNames`
    fn compare_type_names(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        // FOR SPEED: the alias type arguments are computed only for two instantiations of one alias.
        let (x, y) = (self.alias_symbol_of_type(a), self.alias_symbol_of_type(b));
        some_first(self.type_name(a, x), self.type_name(b, y)).then_with(|| match (x, y) {
            (Some(s), Some(t)) if s == t => {
                let arguments = |ty: TypeId| self.alias_of_type(ty).map_or(Vec::new(), |it| it.1);
                self.compare_type_lists(&arguments(a), &arguments(b))
            }
            (None, None) => std::cmp::Ordering::Equal,
            // Two symbols of one name. What follows orders the two, but it does not order two
            // instantiations of one alias, so the order of three types can be a cycle.
            _ => {
                let has_arguments =
                    |ty: TypeId| self.alias_of_type(ty).is_some_and(|it| !it.1.is_empty());
                if has_arguments(a) || has_arguments(b) {
                    self.has_compared_without_total_order.set(true);
                }
                std::cmp::Ordering::Equal
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

    /// `compareTypeMappers` for a `SimpleTypeMapper` or an `ArrayTypeMapper` of instantiations of
    /// the same declaration, which have the same sources. A declared type has no mapper, which
    /// comes last. Here it has one of identity pairs.
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
        let place = |t: TypeId| {
            let (_, file, pos) = self.sort_place(t)?;
            Some(self.place_in_program_order(file, pos))
        };
        // A synthesized type does not always say where its symbol is declared.
        let has_symbol = |t: TypeId| match self.data(t) {
            TypeData::Synth(shape) => Self::shape_has_symbol(shape),
            _ => false,
        };
        // `compareSymbols` of a symbol and its `cloneTypeAsModuleType` clone falls back to the
        // symbol ids. Here the symbol comes first, then the clones in the order of the imports.
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
        let is_no_reference =
            |t: TypeId| !matches!(self.data(t), TypeData::Ref { .. } | TypeData::Tuple { .. });
        let are_of_one_symbol = matches!(
            (self.data(a), self.data(b)),
            (TypeData::Ref { target: s, .. }, TypeData::Ref { target: t, .. }) if s == t
        );
        if flags & NAMED != 0 {
            let by_symbol = self
                .compare_type_names(a, b)
                .then_with(|| match are_of_one_symbol {
                    true => Equal,
                    false => some_first(place(a), place(b))
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
                .then_with(|| is_no_reference(a).cmp(&is_no_reference(b)));
            if by_symbol.is_ne() {
                return by_symbol;
            }
        }
        // References that are not deferred are ordered by their type arguments. Deferred ones with
        // the same target are ordered by the source position of the reference, and instantiations
        // of the same reference by their mappers, never by their type arguments, which may be the
        // references themselves. One that is not deferred has no node and comes last
        // (`compareNodes`).
        let arguments = |x: &TypeArguments, y: &TypeArguments| match (x, y) {
            (TypeArguments::Given(x), TypeArguments::Given(y)) => lists(x, y),
            _ => {
                let (x, y) = (x.as_deferred(), y.as_deferred());
                let node = |deferred: Option<&DeferredTypeArguments>| {
                    let deferred = deferred?;
                    let pos = self.hir(deferred.file)[deferred.node].pos;
                    Some(self.place_in_program_order(deferred.file, pos))
                };
                some_first(node(x), node(y)).then_with(|| match (x, y) {
                    (Some(x), Some(y)) => self.compare_type_mappers(x.mapper, y.mapper),
                    _ => Equal,
                })
            }
        };
        // Where one type is always created from the other, the order of their ids in tsgo is a function of the two types.
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
            // `createArrayLiteralType`
            TypeData::Ref { .. } | TypeData::Tuple { .. } => {
                u8::from(self.types().is_array_literal(t))
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
            // Its members are in source order.
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
            // tsgo orders them by id, and creates `zeroBigIntType` with the checker.
            (TypeData::BigIntLit { text: x, .. }, TypeData::BigIntLit { text: y, .. }) => {
                let is_zero =
                    |text: Atom| atoms.bytes(text).iter().all(|&c| c == b'0' || c == b'n');
                is_zero(*y).cmp(&is_zero(*x))
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
            // tsgo: by name, then by id. The ids of intrinsic types are constants: `TypeStore::new` interns them in the order of
            // `well_known!`.
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
            // iterates over the left operand, and for each of its members over the right.
            (TypeData::Synth(x), TypeData::Synth(y)) => match (x.spread_of, y.spread_of) {
                (Some((l, r)), Some((m, s))) => (x.spread_rank.cmp(&y.spread_rank))
                    .then_with(|| types(l, m))
                    .then_with(|| types(r, s)),
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
            // `ObjectFlagsObjectTypeKindMask`, then `compareTypeMappers`: a type without a mapper
            // comes last.
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
                let kind_of_both_is_mapped = kind(x) == 1 && kind(y) == 1;
                let mapper = |data: &TypeData| match *data {
                    TypeData::Anon { mapper, .. } | TypeData::Fns { mapper, .. } => Some(mapper),
                    _ => None,
                };
                kind(x)
                    .cmp(&kind(y))
                    .then_with(|| match (mapper(x), mapper(y)) {
                        // `instantiateAnonymousType` combines the mapper of a mapped type with one
                        // for its fresh type parameter, and `compareTypeMappers` does not order a
                        // `CompositeTypeMapper`, so the ids decide.
                        (Some(x), Some(y)) if kind_of_both_is_mapped => {
                            self.is_instantiating(y).cmp(&self.is_instantiating(x))
                        }
                        (Some(x), Some(y)) => self.compare_type_mappers(x, y),
                        (x, y) => y.is_some().cmp(&x.is_some()),
                    })
            }
        };
        by_structure.then_with(|| creation_step(a).cmp(&creation_step(b)))
    }

    /// `CompareTypes`: the order of the constituents of a union, and of an origin that is a union. Where tsgo falls back to the type ids,
    /// this falls back to `creation_order`.
    #[inline]
    pub fn compare_types(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        match (self.data(a), self.data(b)) {
            // FOR SPEED: the members of `keyof` of a large type, and of a template literal type.
            // They have the same flags and no name: the text decides, then the freshness.
            (
                &TypeData::StringLit { value: x, fresh: f },
                &TypeData::StringLit { value: y, fresh: g },
            ) if x != y || f != g => {
                let atoms = &self.atoms();
                match atoms.bytes(x).cmp(atoms.bytes(y)).then_with(|| f.cmp(&g)) {
                    std::cmp::Ordering::Equal => self.compare_types_ordered_by(a, b, a, b),
                    order => order,
                }
            }
            // Likewise: the value decides (`cmp.Compare`: NaN first), then the freshness.
            (
                &TypeData::NumberLit { bits: x, fresh: f },
                &TypeData::NumberLit { bits: y, fresh: g },
            ) if x != y || f != g => {
                let (x, y) = (f64::from_bits(x), f64::from_bits(y));
                let by_value = (y.is_nan().cmp(&x.is_nan()))
                    .then_with(|| x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal));
                match by_value.then_with(|| f.cmp(&g)) {
                    std::cmp::Ordering::Equal => self.compare_types_ordered_by(a, b, a, b),
                    order => order,
                }
            }
            // The members of an enum. They have the same flags, no alias and no name: the
            // declarations decide.
            (&TypeData::EnumLit { member: s, .. }, &TypeData::EnumLit { member: t, .. })
                if s != t =>
            {
                match self.compare_symbols(s, t) {
                    std::cmp::Ordering::Equal => self.compare_types_ordered_by(a, b, a, b),
                    order => order,
                }
            }
            (TypeData::Intersection(_), TypeData::Intersection(_)) => {
                let (s, t) = self.members_that_order_intersections(a, b);
                self.compare_types_ordered_by(a, b, s, t)
            }
            _ => self.compare_types_ordered_by(a, b, a, b),
        }
    }

    /// `compareTypeLists` calls `CompareTypes`: of two intersections, the first pair of distinct
    /// members decides, by the ids if nothing else orders the two.
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

    /// `compare_types(a, b)`. `s`, `t`: see `members_that_order_intersections`.
    fn compare_types_ordered_by(
        &self,
        a: TypeId,
        b: TypeId,
        s: TypeId,
        t: TypeId,
    ) -> std::cmp::Ordering {
        let types = self.types();
        types.take_has_ordered_by_own_id();
        let order = self
            .compare_types_without_ids(s, t)
            .then_with(|| types.creation_order(s, t));
        // Here, or further in: `mapping_in_declaration_order`.
        if types.take_has_ordered_by_own_id() {
            types.mark_ordered_by_id(a);
            types.mark_ordered_by_id(b);
        }
        order
    }

    /// See `Types::creation_order`.
    #[inline]
    pub(super) fn creation_order(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        self.types().creation_order(a, b)
    }

    /// `slices.BinarySearchFunc(types, t, CompareTypes)`, with its probes: where the order is not
    /// total, the place that is found depends on them.
    fn binary_search_types(&self, types: &[TypeId], t: TypeId) -> (usize, bool) {
        let (mut i, mut j) = (0, types.len());
        while i < j {
            let h = (i + j) / 2;
            if self.compare_types(types[h], t).is_lt() {
                i = h + 1;
            } else {
                j = h;
            }
        }
        // Only a type and itself compare equal.
        (i, types.get(i) == Some(&t))
    }

    /// `insertType`
    fn insert_type(&self, types: &mut Flat, t: TypeId) {
        if let (index, false) = self.binary_search_types(types, t) {
            types.insert(index, t);
        }
    }

    /// `addTypesToUnion`, without `includes`.
    fn add_types_to_union(&self, type_set: &mut Flat, types: &[TypeId]) {
        let mut last_type = None;
        for &t in types {
            if last_type == Some(t) {
                continue;
            }
            match self.data(t) {
                TypeData::Union(members) => self.add_types_to_union(type_set, members),
                _ => self.add_type_to_union(type_set, t),
            }
            last_type = Some(t);
        }
    }

    /// `addTypeToUnion`, without `includes`.
    fn add_type_to_union(&self, type_set: &mut Flat, t: TypeId) {
        let flags = self.flags(t);
        if flags & tf::NEVER == 0
            && (self.p.files.options.strict_null_checks || flags & tf::NULLABLE == 0)
        {
            self.insert_type(type_set, t);
        }
    }

    /// Puts `members`, what is left of the `typeSet` of `getUnionTypeWorker(actual, ..)`, into the
    /// order of that set.
    fn sort_type_set(&self, actual: &[TypeId], members: &mut Flat) {
        // FOR SPEED: a total order gives one result, however it is reached.
        self.sort_types(members);
        if !self.has_compared_without_total_order.get() {
            return;
        }
        // A type that the search does not find again is a member twice.
        let mut type_set = Flat::new();
        self.add_types_to_union(&mut type_set, actual);
        type_set.retain(|t| members.contains(t));
        // `removeConstrainedTypeVariables` inserts the type variable.
        for &member in members.iter() {
            if !type_set.contains(&member) {
                self.insert_type(&mut type_set, member);
            }
        }
        *members = type_set;
    }

    /// Sorts by `CompareTypes`. `has_compared_without_total_order` tells whether that is an order
    /// of `types`.
    pub(super) fn sort_types(&self, types: &mut [TypeId]) {
        self.has_compared_without_total_order.set(false);
        if types.len() < 3 {
            return types.sort_by(|&a, &b| self.compare_types(a, b));
        }
        // FOR SPEED: `CompareTypes` orders by the flags, then by the names. tsgo reads both from
        // the type. Here the alias of a type is found through its declaration, so the name of each
        // type is looked up once, not for every comparison. String literals have one value of the
        // flags and no name: their text decides.
        let atoms = self.atoms();
        let mut keys: smallvec::SmallVec<[(u32, Option<&[u8]>, TypeId); 16]> = types
            .iter()
            .map(|&ty| {
                let flags = self.sort_order_flags(ty);
                let name = match *self.data(ty) {
                    TypeData::StringLit { value, .. } => Some(atoms.bytes(value)),
                    _ if flags & NAMED != 0 => self.type_name(ty, self.alias_symbol_of_type(ty)),
                    _ => None,
                };
                (flags, name, ty)
            })
            .collect();
        keys.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| some_first(a.1, b.1)));
        let mut buffer = Vec::new();
        for of_one_name in keys.chunk_by_mut(|a, b| (a.0, a.1) == (b.0, b.1)) {
            let mut compare = |a: &(_, _, TypeId), b: &(_, _, TypeId)| self.compare_types(a.2, b.2);
            merge_sort_by(of_one_name, &mut compare, &mut buffer);
        }
        for (ty, key) in types.iter_mut().zip(keys) {
            *ty = key.2;
        }
        debug_assert!(
            self.has_compared_without_total_order.get()
                || types.is_sorted_by(|&a, &b| self.compare_types(a, b).is_le())
        );
    }

    /// `containsType` for the members of a union. It tests identity, and a comparison of two types
    /// costs more than a linear scan over hundreds of ids.
    pub(super) fn contains_type(&self, types: &[TypeId], t: TypeId) -> bool {
        if types.len() <= 512 {
            return types.contains(&t);
        }
        self.binary_search_types(types, t).1
    }
}

#[cfg(test)]
mod tests {
    use super::PatternsByPrefix;

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
        // Every third text is left out, every fifth is there twice, and two patterns have no text.
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
}
