//! Making unions and intersections.

use super::*;

/// `TypeFlags`, with the values of types.go: between types of different kinds they are the order of `CompareTypes`.
mod tf {
    pub(super) const ANY: u32 = 1 << 0;
    pub(super) const UNKNOWN: u32 = 1 << 1;
    pub(super) const UNDEFINED: u32 = 1 << 2;
    pub(super) const NULL: u32 = 1 << 3;
    pub(super) const VOID: u32 = 1 << 4;
    pub(super) const STRING: u32 = 1 << 5;
    pub(super) const NUMBER: u32 = 1 << 6;
    pub(super) const BIGINT: u32 = 1 << 7;
    pub(super) const BOOLEAN: u32 = 1 << 8;
    pub(super) const ES_SYMBOL: u32 = 1 << 9;
    pub(super) const STRING_LITERAL: u32 = 1 << 10;
    pub(super) const NUMBER_LITERAL: u32 = 1 << 11;
    pub(super) const BIGINT_LITERAL: u32 = 1 << 12;
    pub(super) const BOOLEAN_LITERAL: u32 = 1 << 13;
    pub(super) const UNIQUE_ES_SYMBOL: u32 = 1 << 14;
    pub(super) const ENUM_LITERAL: u32 = 1 << 15;
    pub(super) const ENUM: u32 = 1 << 16;
    pub(super) const NON_PRIMITIVE: u32 = 1 << 17;
    pub(super) const NEVER: u32 = 1 << 18;
    pub(super) const TYPE_PARAMETER: u32 = 1 << 19;
    pub(super) const OBJECT: u32 = 1 << 20;
    pub(super) const INDEX: u32 = 1 << 21;
    pub(super) const TEMPLATE_LITERAL: u32 = 1 << 22;
    pub(super) const STRING_MAPPING: u32 = 1 << 23;
    pub(super) const SUBSTITUTION: u32 = 1 << 24;
    pub(super) const INDEXED_ACCESS: u32 = 1 << 25;
    pub(super) const CONDITIONAL: u32 = 1 << 26;
    pub(super) const UNION: u32 = 1 << 27;
    pub(super) const INTERSECTION: u32 = 1 << 28;

    pub(super) const NULLABLE: u32 = UNDEFINED | NULL;
    pub(super) const LITERAL: u32 =
        STRING_LITERAL | NUMBER_LITERAL | BIGINT_LITERAL | BOOLEAN_LITERAL;
    pub(super) const UNIT: u32 = ENUM | LITERAL | UNIQUE_ES_SYMBOL | NULLABLE;
    pub(super) const STRING_LIKE: u32 = STRING | STRING_LITERAL | TEMPLATE_LITERAL | STRING_MAPPING;
    pub(super) const NUMBER_LIKE: u32 = NUMBER | NUMBER_LITERAL | ENUM;
    pub(super) const BIGINT_LIKE: u32 = BIGINT | BIGINT_LITERAL;
    pub(super) const BOOLEAN_LIKE: u32 = BOOLEAN | BOOLEAN_LITERAL;
    pub(super) const ENUM_LIKE: u32 = ENUM | ENUM_LITERAL;
    pub(super) const ES_SYMBOL_LIKE: u32 = ES_SYMBOL | UNIQUE_ES_SYMBOL;
    pub(super) const VOID_LIKE: u32 = VOID | UNDEFINED;
    pub(super) const PRIMITIVE: u32 = STRING_LIKE
        | NUMBER_LIKE
        | BIGINT_LIKE
        | BOOLEAN_LIKE
        | ENUM_LIKE
        | ES_SYMBOL_LIKE
        | VOID_LIKE
        | NULL;
    pub(super) const DEFINITELY_NON_NULLABLE: u32 = STRING_LIKE
        | NUMBER_LIKE
        | BIGINT_LIKE
        | BOOLEAN_LIKE
        | ENUM_LIKE
        | ES_SYMBOL_LIKE
        | OBJECT
        | NON_PRIMITIVE;
    pub(super) const DISJOINT_DOMAINS: u32 = NON_PRIMITIVE
        | STRING_LIKE
        | NUMBER_LIKE
        | BIGINT_LIKE
        | BOOLEAN_LIKE
        | ES_SYMBOL_LIKE
        | VOID_LIKE
        | NULL;
    pub(super) const INSTANTIABLE_NON_PRIMITIVE: u32 =
        TYPE_PARAMETER | INDEXED_ACCESS | CONDITIONAL | SUBSTITUTION;
    pub(super) const STRUCTURED_OR_INSTANTIABLE: u32 = OBJECT
        | UNION
        | INTERSECTION
        | INSTANTIABLE_NON_PRIMITIVE
        | INDEX
        | TEMPLATE_LITERAL
        | STRING_MAPPING;

    // What is gathered of the members while an intersection is made. The last three use bits the mask leaves out.
    pub(super) const INCLUDES_MASK: u32 = ANY
        | UNKNOWN
        | PRIMITIVE
        | NEVER
        | OBJECT
        | UNION
        | INTERSECTION
        | NON_PRIMITIVE
        | TEMPLATE_LITERAL
        | STRING_MAPPING;
    pub(super) const INCLUDES_MISSING_TYPE: u32 = TYPE_PARAMETER;
    pub(super) const INCLUDES_EMPTY_OBJECT: u32 = CONDITIONAL;
    pub(super) const INCLUDES_UNRESOLVED: u32 = 1 << 30;
    /// `TypeFlagsIncludesError`
    pub(super) const INCLUDES_ERROR: u32 = 1 << 31;
}

/// Where something is declared: the libraries first, then by file, then by position. `compareNodes`
type Place = (bool, FileId, u32);

/// The members of a union that is being put together.
type Flat = smallvec::SmallVec<[TypeId; 16]>;

// `union_anew` goes by these numbers.
const _: () = assert!(
    TypeId::UNRESOLVED.0 == 0
        && TypeId::ANY.0 == 1
        && TypeId::UNKNOWN.0 == 2
        && TypeId::SYMBOL.0 < 32
);

/// What has a name, or a declaration, comes before what has none.
fn some_first<T: Ord>(a: Option<T>, b: Option<T>) -> std::cmp::Ordering {
    match (a, b) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    }
}

impl<'p> Checker<'p> {
    /// `Type.flags`. An enum that is the union of its members has `TypeFlagsEnumLiteral` too, which is not told here. What an
    /// alias that is still being worked out stands for is not known: no flags.
    fn type_flags(&self, ty: TypeId) -> u32 {
        match self.data(ty) {
            TypeData::UnresolvedName { .. } => tf::ANY,
            TypeData::Intrinsic(intrinsic) => match intrinsic {
                Intrinsic::Unresolved | Intrinsic::Any | Intrinsic::Error => tf::ANY,
                Intrinsic::Unknown => tf::UNKNOWN,
                Intrinsic::Undefined | Intrinsic::Missing | Intrinsic::UndefinedDeclared => {
                    tf::UNDEFINED
                }
                Intrinsic::Null | Intrinsic::NullDeclared => tf::NULL,
                Intrinsic::Void => tf::VOID,
                Intrinsic::String => tf::STRING,
                Intrinsic::Number => tf::NUMBER,
                Intrinsic::BigInt => tf::BIGINT,
                Intrinsic::Symbol => tf::ES_SYMBOL,
                Intrinsic::Object => tf::NON_PRIMITIVE,
                Intrinsic::Never => tf::NEVER,
            },
            TypeData::StringLit { .. } => tf::STRING_LITERAL,
            TypeData::NumberLit { .. } => tf::NUMBER_LITERAL,
            TypeData::BigIntLit { .. } => tf::BIGINT_LITERAL,
            TypeData::BoolLit { .. } => tf::BOOLEAN_LITERAL,
            TypeData::UniqueSymbol { .. } => tf::UNIQUE_ES_SYMBOL,
            TypeData::EnumLit {
                value: EnumValue::String(_),
                ..
            } => tf::ENUM_LITERAL | tf::STRING_LITERAL,
            TypeData::EnumLit {
                value: EnumValue::Number(_),
                ..
            } => tf::ENUM_LITERAL | tf::NUMBER_LITERAL,
            TypeData::Enum { .. } => tf::ENUM,
            TypeData::TypeParam(..) | TypeData::ThisParam(_) | TypeData::Marker(_) => {
                tf::TYPE_PARAMETER
            }
            TypeData::Keyof(_) => tf::INDEX,
            TypeData::Template { .. } => tf::TEMPLATE_LITERAL,
            TypeData::StringMapping { .. } => tf::STRING_MAPPING,
            TypeData::Substitution { .. } => tf::SUBSTITUTION,
            TypeData::IndexedAccess { .. } => tf::INDEXED_ACCESS,
            TypeData::Cond { .. } => tf::CONDITIONAL,
            TypeData::Union(_) if ty == TypeId::BOOLEAN => tf::UNION | tf::BOOLEAN,
            TypeData::Union(_) => tf::UNION,
            TypeData::Intersection(_) => tf::INTERSECTION,
            TypeData::LazyAlias { .. } => 0,
            _ => tf::OBJECT,
        }
    }

    fn add_to_union(&self, out: &mut Flat, ty: TypeId) {
        match self.data(ty) {
            TypeData::Union(members) => out.extend_from_slice(members),
            TypeData::Intrinsic(Intrinsic::Never) => {}
            _ => out.push(ty),
        }
    }

    /// `A | B | ...`, with literals that a wider member covers taken out.
    pub fn union(&mut self, types: &[TypeId]) -> TypeId {
        self.union_ex(types, true)
    }

    /// `merge_constrained`: whether `T & P1 | T & P2` comes to `T`. It does not among the intersections made without looking at
    /// what `T` extends, which have no `ObjectFlagsIsConstrainedTypeVariable`.
    fn union_ex(&mut self, types: &[TypeId], merge_constrained: bool) -> TypeId {
        // Two types come to the same in either order.
        let pair = match *types {
            [] => return TypeId::NEVER,
            [one] => return one,
            // `addTypeToUnion` sets `TypeFlagsIncludesError`: only a list of one type is returned as it is.
            [a, b] if a == b && !self.is_error_type(a) => return a,
            [a, b] if merge_constrained => Some(if a < b { (a, b) } else { (b, a) }),
            _ => None,
        };
        if let Some((a, b)) = pair
            && let Some(known) = self.recent_unions.get(a.0, b.0)
        {
            return TypeId(known);
        }
        let (union, is_plain) = self.union_anew(types, merge_constrained);
        if is_plain && let Some((a, b)) = pair {
            self.recent_unions.put(a.0, b.0, union.0);
        }
        union
    }

    /// `getUnionType(types, UnionReductionNone)`: `A | B | ...` with everything left in, `any` and `unknown` next to others too.
    /// `string | "a"` says that there is room for the literal and `keyof T | unknown` that there is for something generic, which
    /// is what matters in what an expression is expected to be.
    pub fn union_unreduced(&mut self, types: &[TypeId]) -> TypeId {
        if let [one] = types {
            return *one;
        }
        let mut members = Flat::new();
        for &ty in types {
            self.add_to_union(&mut members, ty);
        }
        members.sort_unstable();
        members.dedup();
        if members.first() == Some(&TypeId::UNRESOLVED) {
            return TypeId::UNRESOLVED;
        }
        // `addTypeToUnion`: without strictNullChecks null and undefined are never members. With nothing else there it is never.
        if !self.p.files.options.strict_null_checks {
            members.retain(|m| !m.is_undefined() && !m.is_null());
        }
        match members[..] {
            [] => TypeId::NEVER,
            [only] => only,
            _ => self.intern(TypeData::Union(Box::from(&members[..]))),
        }
    }

    /// `getUnionTypeWorker` with `UnionReductionLiteral`. With it, whether nothing but the members was looked at: then the same types
    /// come to the same whoever asks.
    #[inline(never)]
    fn union_anew(&mut self, given: &[TypeId], merge_constrained: bool) -> (TypeId, bool) {
        self.time_trap();
        self.guard("union");
        let mut members = Flat::new();
        for &ty in given {
            self.add_to_union(&mut members, ty);
        }
        members.sort_unstable();
        members.dedup();
        // `TypeFlagsIncludesError`: `any` and `unknown` give way to the error type.
        if members.first() != Some(&TypeId::UNRESOLVED)
            && members.iter().any(|&member| self.is_error_type(member))
        {
            return (TypeId::ERROR, true);
        }
        match members[..] {
            [] => return (TypeId::NEVER, true),
            // What is not known, `any` and `unknown`, in this order, leave nothing of the others. Theirs are the lowest numbers.
            [first, ..] if first <= TypeId::UNKNOWN => return (first, true),
            [only] => return (only, true),
            _ => {}
        }
        // `addTypeToUnion`: without strictNullChecks everything can be null or undefined, and they are never members. With nothing
        // else there it is null before undefined, and the kind that is not widened if any of them was
        // (`TypeFlagsIncludesNonWideningType`).
        if !self.p.files.options.strict_null_checks {
            let null = members.iter().any(|m| m.is_null());
            let not_widened = members.iter().any(|&m| {
                matches!(
                    m,
                    TypeId::NULL_DECLARED | TypeId::UNDEFINED_DECLARED | TypeId::MISSING
                )
            });
            members.retain(|m| !m.is_undefined() && !m.is_null());
            if members.is_empty() {
                let left = match (null, not_widened) {
                    (true, true) => TypeId::NULL_DECLARED,
                    (true, false) => TypeId::NULL,
                    (false, true) => TypeId::UNDEFINED_DECLARED,
                    (false, false) => TypeId::UNDEFINED,
                };
                return (left, true);
            }
        }
        // A bit for each of the types with the lowest numbers that is there. They come first.
        let mut low = 0u32;
        for m in members.iter().take_while(|m| m.0 < 32) {
            low |= 1 << m.0;
        }
        let has = |t: TypeId| low & 1 << t.0 != 0;
        // The `undefined` of what is not there says nothing next to the real one.
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
                    // `constrained_type_variable` makes nothing of any other.
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
            // `removeRedundantLiteralTypes`. It goes by the flags, and a member of an enum has those of its value.
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
                        _ if any_fresh && self.is_fresh_literal(m) => snapshot
                            .binary_search(&self.with_freshness(m, false))
                            .is_err(),
                        _ => true,
                    }
                });
            }
            if members.len() > 1 {
                // `string` has taken the patterns out.
                if has_pattern && !string {
                    is_plain = false;
                    self.remove_string_literals_matched_by_template_literals(&mut members);
                }
                if has_constrained && merge_constrained {
                    is_plain = false;
                    self.remove_constrained_type_variables(&mut members);
                }
            }
        }
        let union = match members[..] {
            [] => TypeId::NEVER,
            [only] => only,
            _ => self.union_of_named_unions(given, &members),
        };
        (union, is_plain)
    }

    /// The end of `getUnionTypeWorker`: the union of `members`, which was made of `given`. It has a denormalized `origin` where some of
    /// `given` are unions that have a name, or were made of such, and no member is in two of them.
    fn union_of_named_unions(&self, given: &[TypeId], members: &[TypeId]) -> TypeId {
        let mut named: smallvec::SmallVec<[TypeId; 4]> = smallvec::SmallVec::new();
        self.add_named_unions(&mut named, given);
        if named.is_empty() {
            // One of those given may be all of it.
            let whole = given
                .iter()
                .copied()
                .find(|&ty| matches!(self.data(ty), TypeData::Union(all) if all[..] == *members));
            return match whole {
                Some(whole) => whole,
                None => self.intern(TypeData::Union(Box::from(members))),
            };
        }
        let mut origin: Vec<TypeId> = members
            .iter()
            .copied()
            .filter(|m| {
                !named
                    .iter()
                    .any(|&u| self.parts(u).binary_search(m).is_ok())
            })
            .collect();
        if let [only] = named[..]
            && origin.is_empty()
        {
            return only;
        }
        let in_named: usize = named.iter().map(|&u| self.parts(u).len()).sum();
        let origin = if in_named + origin.len() == members.len() {
            // The order they were given in is no part of what the union is.
            named.sort_unstable();
            origin.extend_from_slice(&named);
            UnionOrigin::Union(origin.into())
        } else {
            UnionOrigin::None
        };
        self.p.types.intern_with(
            TypeData::Union(Box::from(members)),
            Provenance {
                alias: None,
                origin,
            },
        )
    }

    /// `addNamedUnions`. `boolean` has no alias, whatever alias stands for it.
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
        for m in std::mem::take(members) {
            // Of what has `TypeFlagsStringLiteral`: the value, and whether it is the string literal type of that value itself.
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
            // `isTypeMatchedByTemplateLiteralOrStringMapping`: a template goes by the value. `isMemberOfStringMapping` wants what
            // the mapping makes of the type to be the type, and it makes the plain literal.
            let matched = patterns.iter().any(|&pattern| match self.data(pattern) {
                TypeData::Template { texts, types } => {
                    self.is_matched_by_template(literal, texts, types)
                }
                _ => is_plain && self.is_assignable(m, pattern),
            });
            if !matched {
                members.push(m);
            }
        }
    }

    /// `isPrimitiveOrObjectOrEmptyType`
    fn is_primitive_or_object_or_empty(&self, ty: TypeId) -> bool {
        self.type_flags(ty) & (tf::PRIMITIVE | tf::NON_PRIMITIVE) != 0
            || self.is_empty_anonymous(ty)
    }

    /// Of `T & P` or `P & T`, where `T` is a type variable that extends nothing but primitives, `object` and `{}` and `P` is one
    /// of those: `T`, `P` and what `T` extends. Such an intersection that `getIntersectionTypeEx` lets stand is the one it
    /// marks `ObjectFlagsIsConstrainedTypeVariable`. `includes_empty_object`: there is or was a `{}` among what is intersected,
    /// and then `P` may be anything.
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
        let flags = self.type_flags(primitive);
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

    /// `removeConstrainedTypeVariables`: `T & P1 | T & P2` is `T` once the `P`s are all that `T` extends.
    fn remove_constrained_type_variables(&mut self, members: &mut Flat) {
        // (member, T, P, what T extends)
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
            members.sort_unstable();
            members.dedup();
        }
    }

    /// A union in which no member is a subtype of another. `UnionReductionSubtype`
    pub fn union_reduced(&mut self, types: &[TypeId]) -> TypeId {
        // A union that is there already is left as it is.
        if let [only] = types {
            return *only;
        }
        let mut union = self.union(types);
        let TypeData::Union(members) = self.data(union) else {
            return union;
        };
        // `removeRedundantLiteralTypes`, reduceVoidUndefined: `undefined` is one of the things `void` can be.
        if members.contains(&TypeId::VOID) && members.iter().any(|m| m.is_undefined()) {
            union = self.filter(union, |_, m| !m.is_undefined());
        }
        let TypeData::Union(members) = self.data(union) else {
            return union;
        };
        // Primitives and literals were dealt with above.
        if !members
            .iter()
            .any(|&m| self.type_flags(m) & tf::STRUCTURED_OR_INSTANTIABLE != 0)
        {
            return union;
        }
        // Many are not compared each with each, unless they are so many that the count below can be reached.
        let len = members.len();
        if len > 40 && len * (len - 1) <= 100_000 {
            return union;
        }
        let mut members: Vec<TypeId> = members.to_vec();
        let mut given: Vec<TypeId> = Vec::with_capacity(len);
        for &ty in types {
            given.extend_from_slice(self.parts(ty));
        }
        let is_made_by_expression = |c: &Self, m: TypeId| {
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
        // `removeSubtypes` goes through the members from the last in the order of `CompareTypes`, which so decides which of two
        // that are subtypes of each other goes. Where that order comes down to ids, which depend on the thread here: what is
        // declared before what expressions make, and those in the order given.
        let key = |c: &Self, m: TypeId| {
            let made_by_expression = match c.data(m) {
                // `{ ...t, a: 1 }`
                TypeData::Intersection(parts) => parts.iter().any(|&p| is_made_by_expression(c, p)),
                _ => is_made_by_expression(c, m),
            };
            (
                made_by_expression,
                given.iter().position(|&g| g == m).unwrap_or(usize::MAX),
            )
        };
        members.sort_by(|&x, &y| {
            self.compare_types_without_ids(x, y)
                .then_with(|| key(self, x).cmp(&key(self, y)))
        });
        // hasEmptyObject: next to an object type with nothing in it primitives are up for it too: `{} | 0` is `{}`.
        let has_empty_object = members.iter().any(|&m| {
            m == TypeId::EMPTY_OBJECT || self.is_object_type(m) && self.is_empty_object_type(m)
        });
        const HAS_PROPERTIES: u32 = tf::OBJECT | tf::INTERSECTION | tf::INSTANTIABLE_NON_PRIMITIVE;
        let mut keep = vec![true; len];
        let mut count = 0usize;
        for i in (0..len).rev() {
            let source = members[i];
            let source_flags = self.type_flags(source);
            if !has_empty_object && source_flags & tf::STRUCTURED_OR_INSTANTIABLE == 0 {
                continue;
            }
            // A type parameter that extends a union may be a subtype of the others together and of none of them alone.
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
            // The first property with a unit type. Members that differ in it need no comparing.
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
                if count == 100_000 {
                    // At this rate more than a million comparisons in all: too complex to represent (2590), the error type.
                    if (count / (len - i)) * len > 1_000_000 {
                        self.union_too_complex = true;
                        return TypeId::ERROR;
                    }
                    // TypeScript goes on. Here it is as with the many above.
                    return union;
                }
                count += 1;
                if let Some((name, unit)) = key_property
                    && self.type_flags(target) & HAS_PROPERTIES != 0
                    && let Some(other) = self.type_of_property(target, name)
                    && self.is_unit(other)
                    && self.with_freshness(other, false) != unit
                {
                    continue;
                }
                // `emptyObjectType`, which has no symbol, does not go for the type of an object literal with nothing in it.
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
                // Of two classes, one goes only for one it is derived from, however alike they are.
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
        let kept: Vec<TypeId> = members
            .iter()
            .zip(&keep)
            .filter(|(_, k)| **k)
            .map(|(&m, _)| m)
            .collect();
        match kept[..] {
            [] => TypeId::NEVER,
            [only] => only,
            _ => self.union_of_named_unions(types, &kept),
        }
    }

    /// `removeSubtypes`, keyProperty: the first property of `ty` whose type is a unit type, and that type. The types of the
    /// properties before it are asked for on the way, as they are there.
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
                        // What is left of a denormalized origin, unless something inside one of the unions in it went.
                        let mut new_origin = UnionOrigin::None;
                        if let UnionOrigin::Union(origin) = self.origin(ty) {
                            let left: Vec<TypeId> = origin
                                .iter()
                                .copied()
                                .filter(|u| self.is_union(*u) || kept.binary_search(u).is_ok())
                                .collect();
                            if origin.len() - left.len() == members.len() - kept.len() {
                                if let [only] = left[..] {
                                    return only;
                                }
                                new_origin = UnionOrigin::Union(left.into());
                            }
                        }
                        self.p.types.intern_with(
                            TypeData::Union(Box::from(&kept[..])),
                            Provenance {
                                alias: None,
                                origin: new_origin,
                            },
                        )
                    }
                }
            }
            TypeData::Intrinsic(Intrinsic::Never) => ty,
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
            TypeData::Intrinsic(Intrinsic::Never) => ty,
            _ => f(self, ty),
        }
    }

    /// `isPatternLiteralPlaceholderType`
    pub(super) fn is_pattern_literal_placeholder(&self, ty: TypeId) -> bool {
        if let TypeData::Intersection(parts) = self.data(ty) {
            // One placeholder or more, and object types that only tag it.
            let mut seen_placeholder = false;
            for &part in parts.iter() {
                let flags = self.type_flags(part);
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

    /// A template or the like with nothing generic in it: `a${string}`, `Uppercase<string>`. `isPatternLiteralType`
    pub(super) fn is_pattern_literal(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Template { types, .. } => types
                .iter()
                .all(|&t| self.is_pattern_literal_placeholder(t)),
            TypeData::StringMapping { ty, .. } => self.is_pattern_literal_placeholder(*ty),
            _ => false,
        }
    }

    /// `IsEmptyAnonymousObjectType`. Like it, it asks for no members that are not worked out: it goes by what is written. A type
    /// literal with nothing in it is `TypeId::EMPTY_OBJECT`.
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

    /// The same, but `T & P` does not go by what `T` extends. `IntersectionFlagsNoConstraintReduction`
    pub(super) fn intersection_without_constraint_reduction(&mut self, types: &[TypeId]) -> TypeId {
        self.intersection_ex(types, true)
    }

    /// `addTypesToIntersection`, `addTypeToIntersection`: the order stays, for the sake of overloads, and only repeats go. Gives
    /// `includes` with what the types have added to it.
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
            // Of what counts as `{}` only the first is taken.
            if self.is_empty_anonymous(ty) {
                if includes & tf::INCLUDES_EMPTY_OBJECT == 0 {
                    includes |= tf::INCLUDES_EMPTY_OBJECT;
                    set.push(ty);
                }
                continue;
            }
            let flags = self.type_flags(ty);
            if flags & (tf::ANY | tf::UNKNOWN) != 0 {
                if ty == TypeId::UNRESOLVED {
                    includes |= tf::INCLUDES_UNRESOLVED;
                }
                if self.is_error_type(ty) {
                    includes |= tf::INCLUDES_ERROR;
                }
            } else if self.p.files.options.strict_null_checks || flags & tf::NULLABLE == 0 {
                let ty = if ty == TypeId::MISSING {
                    includes |= tf::INCLUDES_MISSING_TYPE;
                    TypeId::UNDEFINED
                } else {
                    ty
                };
                if !set.contains(&ty) {
                    // Nothing is two different unit types. `object` next to them says so further on.
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
            ((made, true), Some((alias, type_arguments))) => {
                self.with_alias(made, alias, type_arguments)
            }
            ((made, _), _) => made,
        }
    }

    /// `getUnionTypeEx`, with an alias.
    pub(super) fn union_with_alias(
        &mut self,
        types: &[TypeId],
        alias: Option<(Sym, &[TypeId])>,
    ) -> TypeId {
        let made = self.union(types);
        match alias {
            Some((alias, type_arguments)) if self.is_union(made) => {
                self.with_alias(made, alias, type_arguments)
            }
            _ => made,
        }
    }

    /// `getIntersectionTypeEx`. The flag: it is made here, so that the alias given, if any, is its alias. One of `types` that is
    /// all that is left is not.
    fn intersection_worker(
        &mut self,
        types: &[TypeId],
        no_constraint_reduction: bool,
    ) -> (TypeId, bool) {
        self.guard("intersection");
        self.time_trap();
        let mut set: Vec<TypeId> = Vec::with_capacity(types.len());
        let includes = self.add_types_to_intersection(&mut set, 0, types);
        if includes & tf::NEVER != 0 {
            return (TypeId::NEVER, false);
        }
        if includes & tf::INCLUDES_UNRESOLVED != 0 {
            return (TypeId::UNRESOLVED, false);
        }
        let strict = self.p.files.options.strict_null_checks;
        // Nothing is an object and null or undefined, or in two of the domains that have nothing in common.
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
            let any = if includes & tf::INCLUDES_ERROR != 0 {
                TypeId::ERROR
            } else {
                TypeId::ANY
            };
            return (any, false);
        }
        // Without strictNullChecks null and undefined were not taken into the set, and are all that is left of it.
        if !strict && includes & tf::NULLABLE != 0 {
            let left = if includes & tf::INCLUDES_EMPTY_OBJECT != 0 {
                TypeId::NEVER
            } else if includes & tf::UNDEFINED != 0 {
                TypeId::UNDEFINED_DECLARED
            } else {
                TypeId::NULL_DECLARED
            };
            return (left, false);
        }
        // `{}` goes next to what cannot be null or undefined (`TypeFlagsDefinitelyNonNullable`), which a union is not known to be.
        // `U & {}` with a union `U` of nothing else is `U` once it is distributed over: no need to.
        let is_non_nullable = includes & tf::DEFINITELY_NON_NULLABLE != 0
            || includes & tf::INCLUDES_EMPTY_OBJECT != 0
                && set.len() == 2
                && set.iter().any(|&t| {
                    self.is_union(t)
                        && self
                            .parts(t)
                            .iter()
                            .all(|&p| self.type_flags(p) & tf::DEFINITELY_NON_NULLABLE != 0)
                });
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
            1 => return (set[0], false),
            _ => {}
        }
        // `T & P` goes by what `T` extends.
        if !no_constraint_reduction
            && let [a, b] = set[..]
            && let Some((variable, primitive, constraint)) =
                self.constrained_type_variable(a, b, includes & tf::INCLUDES_EMPTY_OBJECT != 0)
        {
            // `T & string` with `T extends "a" | "b"` is `T`.
            if self.is_strict_subtype(constraint, primitive) {
                return (variable, false);
            }
            // `T & number` is never: nothing `T` extends is a subtype of `P`, nor `P` of what `T` extends.
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
        // `intersectionTypes`: what the same types came to before.
        let key = (Box::<[TypeId]>::from(&set[..]), no_constraint_reduction);
        if let Some(known) = self.p.distributed_intersections.get(&key) {
            return known;
        }
        let before = self.what_only_holds_for_now();
        let was_too_complex = std::mem::take(&mut self.union_too_complex);
        let result = self.distribute_intersection(types.len(), set, no_constraint_reduction);
        // Whoever asks for one that is too complex is to be told so each time.
        if !self.union_too_complex && self.what_only_holds_for_now() == before {
            self.p.distributed_intersections.insert(key, result);
        }
        self.union_too_complex |= was_too_complex;
        result
    }

    /// `getIntersectionType`, of types some of which are unions. `given`: how many types were asked for.
    fn distribute_intersection(
        &mut self,
        given: usize,
        mut set: Vec<TypeId>,
        no_constraint_reduction: bool,
    ) -> (TypeId, bool) {
        if self.intersect_unions_of_primitive_types(&mut set) {
            // Once only: no more than one such union is left.
            return self.intersection_worker(&set, no_constraint_reduction);
        }
        // `(A | undefined) & (B | undefined)` is `A & B | undefined`, and the same of `null`.
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
        // `A & B & C & D` is `(A & B) & (C & D)`: much of a half may come to never. Not from two types, which would go on for ever.
        if set.len() >= 3 && given > 2 {
            let middle = set.len() / 2;
            let left = self.intersection_ex(&set[..middle], no_constraint_reduction);
            let right = self.intersection_ex(&set[middle..], no_constraint_reduction);
            return self.intersection_worker(&[left, right], no_constraint_reduction);
        }
        // `X & (A | B) & (C | D)` is `X & A & C | X & A & D | X & B & C | X & B & D`.
        // `checkCrossProductUnion`: from 100,000 on it is too complex to represent (2590), the error type.
        let size = set.iter().fold(1usize, |n, &t| {
            if self.is_union(t) {
                n.saturating_mul(self.parts(t).len())
            } else {
                n
            }
        });
        if size >= 100_000 {
            self.union_too_complex = true;
            return (TypeId::ERROR, false);
        }
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
            if one != TypeId::NEVER {
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

    /// `extractRedundantTemplateLiterals`: `get${T}` next to `"getX"` says nothing more. `false`: nothing is both, as
    /// `get${string}` and `"setX"`.
    fn extract_redundant_template_literals(&mut self, set: &mut Vec<TypeId>) -> bool {
        let literals: Vec<TypeId> = set
            .iter()
            .copied()
            .filter(|&t| self.type_flags(t) & tf::STRING_LITERAL != 0)
            .collect();
        let mut i = set.len();
        while i > 0 {
            i -= 1;
            let pattern = set[i];
            if self.type_flags(pattern) & (tf::TEMPLATE_LITERAL | tf::STRING_MAPPING) == 0 {
                continue;
            }
            for &literal in &literals {
                let fits = match *self.data(literal) {
                    // A member of an enum fits a template by its value, and is no member of a string mapping.
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

    /// `ObjectFlagsPrimitiveUnion`: a union with nothing of `TypeFlagsNotPrimitiveUnion` in it. `object` may be, `void`, templates
    /// and `keyof T` may not.
    fn is_primitive_union(&self, ty: TypeId) -> bool {
        let TypeData::Union(parts) = self.data(ty) else {
            return false;
        };
        parts.iter().all(|&p| {
            let flags = self.type_flags(p);
            flags & (tf::PRIMITIVE | tf::NON_PRIMITIVE) != 0
                && flags & (tf::VOID | tf::TEMPLATE_LITERAL | tf::STRING_MAPPING) == 0
        })
    }

    /// `intersectUnionsOfPrimitiveTypes`: several unions of primitives, which is what `keyof (A | B | C)` is made of, are
    /// intersected as sets. What is in all of them takes the place of the first, and the others go. `false`: there are not several.
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
                // Looked at with an earlier union.
                if unions[..k]
                    .iter()
                    .any(|&earlier| self.parts(earlier).binary_search(&t).is_ok())
                {
                    continue;
                }
                if !self.each_union_contains(&unions, t) {
                    continue;
                }
                // Of `undefined` and the `undefined` of what is not there, which match each other, the latter stays.
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
            let has = |wanted: TypeId| self.parts(union).binary_search(&wanted).is_ok();
            if has(t) {
                continue;
            }
            if t == TypeId::MISSING {
                return has(TypeId::UNDEFINED);
            }
            if t == TypeId::UNDEFINED {
                return has(TypeId::MISSING);
            }
            let flags = self.type_flags(t);
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

    /// `ty` without `undefined`, that of what is not there included.
    pub fn without_undefined(&mut self, ty: TypeId) -> TypeId {
        self.filter(ty, |_, m| !m.is_undefined())
    }

    pub fn contains_undefined(&self, ty: TypeId) -> bool {
        self.parts(ty).iter().any(|m| m.is_undefined())
    }

    // ───────────────────────────── the order of the members of a union ─────────────────────────────

    /// `getSortOrderFlags`
    fn sort_order_flags(&self, ty: TypeId) -> u32 {
        let flags = self.type_flags(ty);
        if flags & tf::ENUM_LIKE != 0 && flags & tf::UNION == 0 {
            return tf::ENUM;
        }
        if matches!(self.data(ty), TypeData::LazyAlias { .. }) {
            tf::OBJECT
        } else {
            flags
        }
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
            files.atoms.bytes(name)
        })
    }

    /// Where the first declaration of `sym` is. `compareSymbols`
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

    /// Where the symbol of `ty`, or the syntax it is the type of, is declared. What is made up has no such place here.
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
                .and_then(|&(file, func)| at(file, self.hir(file)[func].pos)),
            TypeData::Synth(ref shape) => shape
                .symbol_declared_at
                .and_then(|(file, pos)| at(file, pos)),
            TypeData::TypeParam(file, tp, _) => at(file, self.hir(file)[tp].pos),
            TypeData::Cond { file, node, .. } => at(file, self.hir(file)[node].pos),
            TypeData::UniqueSymbol { symbol, .. } => match symbol {
                UniqueSymbolDeclaration::Variable(variable) => self.symbol_place(variable),
                UniqueSymbolDeclaration::Member(file, member) => {
                    at(file, self.hir(file)[member].pos)
                }
                UniqueSymbolDeclaration::SymbolConstructor => None,
            },
            _ => None,
        }
    }

    /// What `compareNodes` orders a node at `pos` of `file` by: the index of the file in the program (`fileIndexMap`), then the
    /// position. The libraries come first.
    pub(super) fn place_in_program_order(&self, file: FileId, pos: u32) -> (bool, u32, u32) {
        let files = self.files();
        (!files.module(file).is_lib, files.rank_of_file(file), pos)
    }

    /// `t.symbol.Declarations[0]` of an object type: the file and the position.
    pub(super) fn symbol_declaration_of_object_type(&self, ty: TypeId) -> Option<(FileId, u32)> {
        self.sort_place(ty).map(|place| (place.1, place.2))
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

    /// `compareTypeNames`
    fn compare_type_names(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        let (x, y) = (self.alias_of_type(a), self.alias_of_type(b));
        let symbol = |alias: &Option<(Sym, Vec<TypeId>)>| alias.as_ref().map(|alias| alias.0);
        some_first(self.type_name(a, symbol(&x)), self.type_name(b, symbol(&y))).then_with(
            || match (&x, &y) {
                (Some((s, x)), Some((t, y))) if s == t => self.compare_type_lists(x, y),
                _ => std::cmp::Ordering::Equal,
            },
        )
    }

    /// `compareTypeMappers`, of instantiations of one declaration: by what they put for the type parameters, in the order those are
    /// declared.
    fn compare_type_mappers(&self, x: MapperId, y: MapperId) -> std::cmp::Ordering {
        let targets = |mapper: MapperId| -> Vec<TypeId> {
            let mut pairs = self.p.types.mapping(mapper).to_vec();
            pairs.sort_by_key(|pair| match *self.data(pair.0) {
                TypeData::TypeParam(file, tp, _) => (0u8, file.0, tp.0),
                _ => (1, 0, pair.0.0),
            });
            pairs.into_iter().map(|pair| pair.1).collect()
        };
        self.compare_type_lists(&targets(x), &targets(y))
    }

    /// `CompareTypes` without its last resort, the ids, which depend on which thread came first here. Not compared either: where a
    /// deferred reference is written.
    fn compare_types_without_ids(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        use std::cmp::Ordering::Equal;
        if a == b {
            return Equal;
        }
        let by_flags = self.sort_order_flags(a).cmp(&self.sort_order_flags(b));
        if by_flags.is_ne() {
            return by_flags;
        }
        let atoms = &self.files().atoms;
        let types = |x: TypeId, y: TypeId| self.compare_types_without_ids(x, y);
        let lists = |x: &[TypeId], y: &[TypeId]| self.compare_type_lists(x, y);
        let place = |t: TypeId| {
            let (_, file, pos) = self.sort_place(t)?;
            Some(self.place_in_program_order(file, pos))
        };
        // `compareSymbols`, of a symbol and what `cloneTypeAsModuleType` makes of it, comes down to the ids of the symbols. Here the
        // symbol comes first, then the copies in the order of the imports.
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
        // Of object types with the same symbol, or none, references come first. A tuple is one, and has no symbol.
        let is_no_reference =
            |t: TypeId| !matches!(self.data(t), TypeData::Ref { .. } | TypeData::Tuple { .. });
        let are_of_one_symbol = matches!(
            (self.data(a), self.data(b)),
            (TypeData::Ref { target: s, .. }, TypeData::Ref { target: t, .. }) if s == t
        );
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
        match (self.data(a), self.data(b)) {
            (TypeData::Ref { target: s, args: x }, TypeData::Ref { target: t, args: y }) => {
                s.cmp(t).then_with(|| lists(x, y))
            }
            // `compareTupleTypes`, `compareElementLabels`: what has no label comes first.
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
                    .then_with(|| x.len().cmp(&y.len()))
                    .then_with(|| f.iter().map(bits).cmp(g.iter().map(bits)))
                    .then_with(|| f.iter().map(label).cmp(g.iter().map(label)))
                    .then_with(|| lists(x, y))
            }
            // What has an `origin` comes first, and origins compare as the types they are: a `keyof`, a union, an intersection.
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
                    (UnionOrigin::Union(x), UnionOrigin::Union(y)) => {
                        lists(&self.in_order(x), &self.in_order(y))
                    }
                    (UnionOrigin::Intersection(x), UnionOrigin::Intersection(y)) => lists(x, y),
                    _ => lists(&self.parts_in_order(a), &self.parts_in_order(b)),
                })
            }
            // Its members are as written.
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
            // Ordered by id, and `zeroBigIntType` is made with the checker.
            (TypeData::BigIntLit { text: x, .. }, TypeData::BigIntLit { text: y, .. }) => {
                let is_zero =
                    |text: Atom| atoms.bytes(text).iter().all(|&c| c == b'0' || c == b'n');
                is_zero(*y).cmp(&is_zero(*x))
            }
            (TypeData::Marker(x), TypeData::Marker(y)) => x.cmp(y),
            (TypeData::Keyof(x), TypeData::Keyof(y))
            | (TypeData::Substitution { base: x, .. }, TypeData::Substitution { base: y, .. })
            | (TypeData::StringMapping { ty: x, .. }, TypeData::StringMapping { ty: y, .. }) => {
                types(*x, *y)
            }
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
            (TypeData::Anon { mapper: x, .. }, TypeData::Anon { mapper: y, .. })
            | (TypeData::Fns { mapper: x, .. }, TypeData::Fns { mapper: y, .. })
            | (TypeData::Cond { mapper: x, .. }, TypeData::Cond { mapper: y, .. }) => {
                self.compare_type_mappers(*x, *y)
            }
            _ => Equal,
        }
    }

    /// `CompareTypes`: the order TypeScript keeps the members of a union in.
    pub fn compare_types(&self, a: TypeId, b: TypeId) -> std::cmp::Ordering {
        self.compare_types_without_ids(a, b).then(a.cmp(&b))
    }

    /// The members of a union in the order TypeScript goes through them. They are stored by id.
    pub fn parts_in_order(&self, ty: TypeId) -> Vec<TypeId> {
        self.in_order(self.parts(ty))
    }

    /// `types` in that order.
    pub(super) fn in_order(&self, types: &[TypeId]) -> Vec<TypeId> {
        let mut types = types.to_vec();
        if types.len() > 1 {
            types.sort_by(|&a, &b| self.compare_types(a, b));
        }
        types
    }
}
