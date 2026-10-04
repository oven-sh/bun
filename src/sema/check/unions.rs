//! Construction of union and intersection types.

use super::*;

/// The sort key of a declaration: library files first, then by file, then by position.
/// `compareNodes`
type Place = (bool, FileId, u32);

/// The members of a union under construction.
type Flat = smallvec::SmallVec<[TypeId; 16]>;

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

    fn new(c: &Checker<'p>, patterns: &[TypeId]) -> Self {
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

/// `Some`, a name or a declaration, sorts before `None`.
fn some_first<T: Ord>(a: Option<T>, b: Option<T>) -> std::cmp::Ordering {
    match (a, b) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    }
}

impl<'p> Checker<'p> {
    fn add_to_union(&self, out: &mut Flat, ty: TypeId) {
        match self.data(ty) {
            TypeData::Union(members) => out.extend_from_slice(members),
            TypeData::Intrinsic(
                Intrinsic::Never
                | Intrinsic::SilentNever
                | Intrinsic::UnreachableNever
                | Intrinsic::ImplicitNever,
            ) => {}
            // `TypeFlagsAny`: the union is `anyType`.
            TypeData::Intrinsic(Intrinsic::Auto | Intrinsic::IntrinsicMarker) => {
                out.push(TypeId::ANY)
            }
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
                            | TypeId::SILENT_NEVER
                            | TypeId::UNREACHABLE_NEVER
                            | TypeId::IMPLICIT_NEVER
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
        self.sort_types(&mut members);
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
            if members.len() > 1 {
                // `string` has already removed the patterns.
                let has_pattern = has_pattern && !string;
                let has_constrained = has_constrained && merge_constrained;
                if has_pattern || has_constrained {
                    is_plain = false;
                    // Both evaluate something for each member, and evaluation order determines the
                    // creation order of types. tsgo keeps the set sorted from the start.
                    self.sort_types(&mut members);
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
        self.sort_types(&mut members);
        let union = match members[..] {
            [] => TypeId::NEVER,
            [only] => only,
            _ => self.union_of_named_unions(actual, &members),
        };
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
                None => self.intern(TypeData::Union(Box::from(members))),
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
        let mut origin: Vec<TypeId> = members
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
            // `insertType`
            origin.extend_from_slice(&named);
            self.sort_types(&mut origin);
            UnionOrigin::Union(origin.into())
        } else {
            UnionOrigin::None
        };
        self.types().intern_with(
            TypeData::Union(Box::from(members)),
            Provenance {
                origin,
                ..Provenance::default()
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
    fn is_primitive_or_object_or_empty(&self, ty: TypeId) -> bool {
        self.flags(ty) & (tf::PRIMITIVE | tf::NON_PRIMITIVE) != 0 || self.is_empty_anonymous(ty)
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
    ) -> Option<(TypeId, TypeId, TypeId)> {
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
        .then_some((variable, primitive, constraint))
    }

    /// `removeConstrainedTypeVariables`: `T & P1 | T & P2` reduces to `T` once the `P`s cover the
    /// whole constraint of `T`.
    fn remove_constrained_type_variables(&mut self, members: &mut Flat) {
        // (member, T, P, constraint of T)
        let mut constrained: Vec<(TypeId, TypeId, TypeId, TypeId)> = Vec::new();
        for &m in members.iter() {
            if let TypeData::Intersection(parts) = self.data(m)
                && let [a, b] = parts[..]
                && let Some((variable, primitive, constraint)) = self.constrained_type_variable(
                    a,
                    b,
                    self.is_empty_anonymous(a) || self.is_empty_anonymous(b),
                )
            {
                constrained.push((m, variable, primitive, constraint));
            }
        }
        let mut changed = false;
        for i in 0..constrained.len() {
            let (_, variable, _, constraint) = constrained[i];
            if constrained[..i].iter().any(|c| c.1 == variable) {
                continue;
            }
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
        members.sort_by(|&x, &y| {
            self.compare_types_without_ids(x, y)
                .then_with(|| key(self, x).cmp(&key(self, y)))
        });
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
                // `emptyObjectType`, which has no symbol, is not removed in favor of the type of an
                // empty object literal.
                if (source == TypeId::EMPTY_OBJECT || self.is_unknown_empty_object(source))
                    && matches!(self.data(target), TypeData::Anon { .. })
                    && self.is_empty_anonymous(target)
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
        let mut kept: Vec<TypeId> = members
            .iter()
            .zip(&keep)
            .filter(|(_, k)| **k)
            .map(|(&m, _)| m)
            .collect();
        self.sort_types(&mut kept);
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
                        let mut new_origin = UnionOrigin::None;
                        if let UnionOrigin::Union(origin) = self.origin(ty) {
                            let left: Vec<TypeId> = origin
                                .iter()
                                .copied()
                                .filter(|u| self.is_union(*u) || kept.contains(u))
                                .collect();
                            if origin.len() - left.len() == members.len() - kept.len() {
                                if let [only] = left[..] {
                                    return only;
                                }
                                new_origin = UnionOrigin::Union(left.into());
                            }
                        }
                        self.types().intern_with(
                            TypeData::Union(Box::from(&kept[..])),
                            Provenance {
                                origin: new_origin,
                                ..Provenance::default()
                            },
                        )
                    }
                }
            }
            TypeData::Intrinsic(
                Intrinsic::Never
                | Intrinsic::SilentNever
                | Intrinsic::UnreachableNever
                | Intrinsic::ImplicitNever,
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
                | Intrinsic::ImplicitNever,
            ) => ty,
            _ => f(self, ty),
        }
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

    /// `IsEmptyAnonymousObjectType`. Like it, this does not resolve members that are not resolved
    /// yet: it inspects the syntax. An empty type literal is `TypeId::EMPTY_OBJECT`.
    fn is_empty_anonymous(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Synth(shape) => match shape.literal {
                Literalness::SyntheticDefault => true,
                // `anyFunctionType`
                Literalness::Partial => false,
                _ => {
                    shape.props.is_empty()
                        && shape.call.is_empty()
                        && shape.construct.is_empty()
                        && shape.index.is_empty()
                }
            },
            TypeData::Anon {
                origin: Origin::ObjectLiteral(file, e, ..) | Origin::WidenedLiteral(file, e, ..),
                ..
            } => {
                matches!(self.hir(*file)[*e].kind, ExprKind::Object(props) if props.is_empty())
            }
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
        set: &mut Vec<TypeId>,
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
            if self.is_empty_anonymous(ty) {
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
                self.with_alias(created, alias, type_arguments)
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
        let created = self.union(types);
        match alias {
            Some((alias, type_arguments)) if self.is_union(created) => {
                self.with_alias(created, alias, type_arguments)
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
        let mut set: Vec<TypeId> = Vec::with_capacity(types.len());
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
        set.retain(|&t| {
            !(t == TypeId::STRING
                && includes & (tf::STRING_LITERAL | tf::TEMPLATE_LITERAL | tf::STRING_MAPPING) != 0
                || t == TypeId::NUMBER && includes & tf::NUMBER_LITERAL != 0
                || t == TypeId::BIGINT && includes & tf::BIGINT_LITERAL != 0
                || t == TypeId::SYMBOL && includes & tf::UNIQUE_ES_SYMBOL != 0
                || t == TypeId::VOID && includes & tf::UNDEFINED != 0
                || is_non_nullable && self.is_empty_anonymous(t))
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
        if !no_constraint_reduction
            && let [a, b] = set[..]
            && let Some((variable, primitive, constraint)) =
                self.constrained_type_variable(a, b, includes & tf::INCLUDES_EMPTY_OBJECT != 0)
        {
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
        }
        if includes & tf::UNION == 0 {
            return (
                self.intern(TypeData::Intersection(set.into_boxed_slice())),
                true,
            );
        }
        // `intersectionTypes`: the cached result for the same types.
        // `len(typeSet) >= 3 && len(types) > 2`. tsgo omits it from the key, so there the first
        // caller decides for all.
        let is_split = set.len() >= 3 && types.len() > 2;
        let key = (
            Box::<[TypeId]>::from(&set[..]),
            no_constraint_reduction,
            is_split,
        );
        let table = &self.p.distributed_intersections;
        if let Some(known) = table.get(&mut self.task, &key) {
            return known;
        }
        let scope = self.begin_scope();
        let result = self.distribute_intersection(types.len(), set, no_constraint_reduction);
        match self.end_scope_by_counters(scope) {
            Ok(stored) => table.insert(&mut self.task, key, result, stored),
            Err(_) => result,
        }
    }

    /// `checkCrossProductUnion`
    pub(super) fn check_cross_product_union(&mut self, types: &[TypeId]) -> bool {
        let is_representable = self.get_cross_product_union_size(types) < 100_000;
        if !is_representable {
            self.error_at_current_node(2590);
        }
        is_representable
    }

    /// `getCrossProductUnionSize`
    fn get_cross_product_union_size(&self, types: &[TypeId]) -> usize {
        (types.iter()).fold(1, |size, &t| size.saturating_mul(self.parts(t).len()))
    }

    /// `getIntersectionType` for types some of which are unions. `actual`: the number of types in
    /// the request.
    fn distribute_intersection(
        &mut self,
        actual: usize,
        mut set: Vec<TypeId>,
        no_constraint_reduction: bool,
    ) -> (TypeId, bool) {
        if self.intersect_unions_of_primitive_types(&mut set) {
            // Happens only once: at most one such union is left.
            return self.intersection_worker(&set, no_constraint_reduction);
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
            return (union, self.is_union(union));
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
            return (union, self.is_union(union));
        }
        // `A & B & C & D` is `(A & B) & (C & D)`: much of a half may reduce to never. Not applied
        // to two types, which would recurse forever.
        if set.len() >= 3 && actual > 2 {
            let middle = set.len() / 2;
            let left = self.intersection_ex(&set[..middle], no_constraint_reduction);
            let right = self.intersection_ex(&set[middle..], no_constraint_reduction);
            return self.intersection_worker(&[left, right], no_constraint_reduction);
        }
        // `X & (A | B) & (C | D)` is `X & A & C | X & A & D | X & B & C | X & B & D`.
        if !self.check_cross_product_union(&set) {
            return (TypeId::ERROR, false);
        }
        let size = self.get_cross_product_union_size(&set);
        // `getCrossProductIntersections`
        let mut intersections: Vec<TypeId> = Vec::with_capacity(size);
        let mut constituents = set.clone();
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
            return (
                self.with_origin(union, UnionOrigin::Intersection(set.into())),
                true,
            );
        }
        (union, self.is_union(union))
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
    fn extract_redundant_template_literals(&mut self, set: &mut Vec<TypeId>) -> bool {
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
    /// `object` is allowed. `void`, template literal types and `keyof T` are not.
    fn is_primitive_union(&self, ty: TypeId) -> bool {
        let TypeData::Union(parts) = self.data(ty) else {
            return false;
        };
        parts.iter().all(|&p| {
            let flags = self.flags(p);
            flags & (tf::PRIMITIVE | tf::NON_PRIMITIVE) != 0
                && flags & (tf::VOID | tf::TEMPLATE_LITERAL | tf::STRING_MAPPING) == 0
        })
    }

    /// `intersectUnionsOfPrimitiveTypes`: multiple unions of primitives, which is what `keyof (A |
    /// B | C)` produces, are intersected as sets. The common members replace the first union, and
    /// the other unions are removed. `false`: there are fewer than two.
    fn intersect_unions_of_primitive_types(&mut self, set: &mut Vec<TypeId>) -> bool {
        let unions: Vec<TypeId> = set
            .iter()
            .copied()
            .filter(|&t| self.is_primitive_union(t))
            .collect();
        if unions.len() < 2 {
            return false;
        }
        let mut common: Vec<TypeId> = Vec::new();
        for (k, &union) in unions.iter().enumerate() {
            for &t in self.parts(union) {
                // Already checked with an earlier union.
                if unions[..k]
                    .iter()
                    .any(|&earlier| self.contains_type(self.parts(earlier), t))
                {
                    continue;
                }
                if !self.each_union_contains(&unions, t) {
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
                return Some(match kind {
                    StringMappingKind::Uppercase => &b"Uppercase"[..],
                    StringMappingKind::Lowercase => &b"Lowercase"[..],
                    StringMappingKind::Capitalize => &b"Capitalize"[..],
                    StringMappingKind::Uncapitalize => &b"Uncapitalize"[..],
                });
            }
            _ => return None,
        };
        // `InternalSymbolNameClass`, of a class expression without a name.
        Some(if name.is_none() {
            &b"\xFEclass"[..]
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
            TypeData::Synth(ref shape) => shape
                .symbol_declared_at
                .and_then(|(file, pos, _)| at(file, pos)),
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

    /// `compareTypeNames`. Two aliases with the same name are ordered by their symbols, and an
    /// alias sorts before another symbol with its name. In those cases `CompareTypes` falls through
    /// to the structure of the types, and is not a valid ordering.
    fn compare_type_names(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        let (x, y) = (self.alias_of_type(a), self.alias_of_type(b));
        let symbol = |alias: &Option<(Sym, Vec<TypeId>)>| alias.as_ref().map(|alias| alias.0);
        some_first(self.type_name(a, symbol(&x)), self.type_name(b, symbol(&y))).then_with(
            || match (&x, &y) {
                (Some((s, x)), Some((t, y))) if s == t => self.compare_type_lists(x, y),
                (Some((s, _)), Some((t, _))) => self.compare_symbols(*s, *t),
                _ => y.is_some().cmp(&x.is_some()),
            },
        )
    }

    /// `compareTypeMappers` for instantiations of the same declaration: by the types they map the
    /// type parameters to, in the declaration order of the type parameters.
    fn compare_type_mappers(&self, x: MapperId, y: MapperId) -> std::cmp::Ordering {
        let targets = |mapper: MapperId| -> Vec<TypeId> {
            let pairs = self.mapping_in_declaration_order(mapper);
            pairs.iter().map(|pair| pair.1).collect()
        };
        self.compare_type_lists(&targets(x), &targets(y))
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
        // The other kinds have no alias, no name and no symbol.
        const NAMED: u32 = tf::OBJECT
            | tf::UNION
            | tf::INTERSECTION
            | tf::INDEXED_ACCESS
            | tf::CONDITIONAL
            | tf::TYPE_PARAMETER
            | tf::STRING_MAPPING
            | tf::ENUM
            | tf::UNIQUE_ES_SYMBOL;
        if flags & NAMED != 0 {
            let by_symbol = self
                .compare_type_names(a, b)
                .then_with(|| match are_of_one_symbol {
                    true => Equal,
                    false => some_first(place(a), place(b)),
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
                let bits = |e: &ElemFlags| e.with_label(Atom::NONE).bits();
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
            },
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
                    TypeData::Anon { mapper, .. }
                    | TypeData::Fns { mapper, .. }
                    | TypeData::Cond { mapper, .. }
                    | TypeData::TypeParam(_, _, mapper) => Some(mapper),
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
    pub fn compare_types(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        let types = self.types();
        types.take_has_ordered_by_own_id();
        let order = self
            .compare_types_without_ids(a, b)
            .then_with(|| types.creation_order(a, b));
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

    pub(super) fn sort_types(&self, types: &mut [TypeId]) {
        types.sort_by(|&a, &b| self.compare_types(a, b));
    }

    /// `containsType` for the members of a union. It tests identity, and a comparison of two types
    /// costs more than a linear scan over hundreds of ids.
    pub(super) fn contains_type(&self, types: &[TypeId], t: TypeId) -> bool {
        if types.len() <= 512 {
            return types.contains(&t);
        }
        types
            .binary_search_by(|&member| self.compare_types(member, t))
            .is_ok()
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
            assert_eq!(found, expected, "{:?}", String::from_utf8_lossy(value));
        }
    }
}
