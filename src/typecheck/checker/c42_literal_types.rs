// checker.go:25396-25723 (layers K-LIT, K-UNION): literal types, their regular, fresh, base and widened forms, and mapType.
use crate::ast::{SymbolFlags, SymbolId};
use crate::checker::{
    CachedTypeKey, CachedTypeKind, Checker, EnumLiteralKey, EnumLiteralValueKey, LiteralValue,
    TypeAliasId, TypeFlags, TypeId, UnionReduction,
};
use crate::core::Text;
use crate::jsnum::{Number, PseudoBigInt, parse_valid_big_int};

impl<'a> Checker<'a> {
    pub fn get_regular_type_of_literal_type(&mut self, t: TypeId) -> TypeId {
        if self.types[t].flags.intersects(TypeFlags::FRESHABLE) {
            return self.as_literal_type(t).regular_type;
        }
        if self.types[t].flags.intersects(TypeFlags::UNION) {
            if self.as_union_type(t).regular_type.is_nil() {
                let regular_type =
                    self.map_type(t, &mut |c, s| c.get_regular_type_of_literal_type(s));
                self.as_union_type_mut(t).regular_type = regular_type;
            }
            return self.as_union_type(t).regular_type;
        }
        t
    }

    pub fn get_fresh_type_of_literal_type(&mut self, t: TypeId) -> TypeId {
        if self.types[t].flags.intersects(TypeFlags::FRESHABLE) {
            if self.as_literal_type(t).fresh_type.is_nil() {
                let flags = self.types[t].flags;
                let value = self.as_literal_type(t).value.clone();
                let f = self.new_literal_type(flags, value, t);
                let symbol = self.types[t].symbol;
                self.types[f].symbol = symbol;
                self.as_literal_type_mut(f).fresh_type = f;
                self.as_literal_type_mut(t).fresh_type = f;
            }
            return self.as_literal_type(t).fresh_type;
        }
        t
    }
}

pub fn is_fresh_literal_type(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t].flags.intersects(TypeFlags::FRESHABLE) && c.as_literal_type(t).fresh_type == t
}

// A Go map compares float keys with `==`: both zeros are one key, and NaN never reaches the map.
fn number_literal_key(value: Number) -> u64 {
    if value.0 == 0.0 { 0 } else { value.0.to_bits() }
}

impl<'a> Checker<'a> {
    pub fn get_string_literal_type(&mut self, value: Text<'a>) -> TypeId {
        let mut t = self.string_literal_types.get(&value);
        if t.is_nil() {
            t = self.new_literal_type(
                TypeFlags::STRING_LITERAL,
                LiteralValue::String(value),
                TypeId::NIL,
            );
            let ok = self.string_literal_types.set(value, t);
            self.map_set(ok);
        }
        t
    }

    pub fn get_number_literal_type(&mut self, value: Number) -> TypeId {
        // NaN cannot be used as a map key because NaN != NaN in IEEE 754, so map lookups for NaN always miss: the NaN type is cached separately.
        if value.is_nan() {
            if self.nan_type.is_nil() {
                self.nan_type = self.new_literal_type(
                    TypeFlags::NUMBER_LITERAL,
                    LiteralValue::Number(value.0),
                    TypeId::NIL,
                );
            }
            return self.nan_type;
        }
        let key = number_literal_key(value);
        let mut t = self.number_literal_types.get(&key);
        if t.is_nil() {
            t = self.new_literal_type(
                TypeFlags::NUMBER_LITERAL,
                LiteralValue::Number(value.0),
                TypeId::NIL,
            );
            let ok = self.number_literal_types.set(key, t);
            self.map_set(ok);
        }
        t
    }

    pub fn get_big_int_literal_type(&mut self, value: PseudoBigInt) -> TypeId {
        let mut t = self.bigint_literal_types.get(&value);
        if t.is_nil() {
            t = self.new_literal_type(
                TypeFlags::BIG_INT_LITERAL,
                LiteralValue::BigInt(value.clone()),
                TypeId::NIL,
            );
            let ok = self.bigint_literal_types.set(value, t);
            self.map_set(ok);
        }
        t
    }

    // text is a valid bigint string excluding a trailing `n`, but including a possible prefix `-`: use `isValidBigIntString(text, roundTripOnly)` before calling this function.
    pub fn parse_big_int_literal_type(&mut self, text: &[u8]) -> TypeId {
        match parse_valid_big_int(text) {
            Ok(value) => self.get_big_int_literal_type(value),
            Err(message) => self.fail(message),
        }
    }
}

pub fn get_string_literal_value<'a>(c: &Checker<'a>, t: TypeId) -> Text<'a> {
    match c.as_literal_type(t).value {
        LiteralValue::String(value) => value,
        _ => c.fail("getStringLiteralValue: the value is not a string"),
    }
}

pub fn get_number_literal_value(c: &Checker<'_>, t: TypeId) -> Number {
    match c.as_literal_type(t).value {
        LiteralValue::Number(value) => Number(value),
        _ => {
            let _: () = c.fail("getNumberLiteralValue: the value is not a number");
            Number(0.0)
        }
    }
}

pub fn get_big_int_literal_value(c: &Checker<'_>, t: TypeId) -> PseudoBigInt {
    match &c.as_literal_type(t).value {
        LiteralValue::BigInt(value) => value.clone(),
        _ => {
            let _: () = c.fail("getBigIntLiteralValue: the value is not a bigint");
            PseudoBigInt::default()
        }
    }
}

pub fn get_boolean_literal_value(c: &Checker<'_>, t: TypeId) -> bool {
    match c.as_literal_type(t).value {
        LiteralValue::Boolean(value) => value,
        _ => c.fail("getBooleanLiteralValue: the value is not a boolean"),
    }
}

impl<'a> Checker<'a> {
    pub fn get_enum_literal_type(
        &mut self,
        value: LiteralValue<'a>,
        enum_symbol: SymbolId,
        symbol: SymbolId,
    ) -> TypeId {
        let flags;
        match value {
            LiteralValue::String(_) => {
                flags = TypeFlags::ENUM_LITERAL | TypeFlags::STRING_LITERAL;
            }
            LiteralValue::Number(v) => {
                flags = TypeFlags::ENUM_LITERAL | TypeFlags::NUMBER_LITERAL;
                // NaN cannot be used as a map key because NaN != NaN in IEEE 754, so map lookups for NaN always miss: NaN enum types are cached separately by enum symbol.
                if v.is_nan() {
                    let mut t = self.enum_nan_literal_types.get(&enum_symbol);
                    if t.is_nil() {
                        t = self.new_literal_type(flags, value.clone(), TypeId::NIL);
                        self.types[t].symbol = symbol;
                        let ok = self.enum_nan_literal_types.set(enum_symbol, t);
                        self.map_set(ok);
                    }
                    return t;
                }
            }
            _ => return self.fail("Unhandled case in getEnumLiteralType"),
        }
        let key = EnumLiteralKey {
            enum_symbol,
            value: EnumLiteralValueKey::of(value.clone()),
        };
        let mut t = self.enum_literal_types.get(&key);
        if t.is_nil() {
            t = self.new_literal_type(flags, value, TypeId::NIL);
            self.types[t].symbol = symbol;
            let ok = self.enum_literal_types.set(key, t);
            self.map_set(ok);
        }
        t
    }
}

pub fn is_literal_type(c: &Checker<'_>, t: TypeId) -> bool {
    let flags = c.types[t].flags;
    if flags.intersects(TypeFlags::BOOLEAN) {
        return true;
    }
    if flags.intersects(TypeFlags::UNION) {
        if flags.intersects(TypeFlags::ENUM_LITERAL) {
            return true;
        }
        return c
            .type_types(t)
            .as_slice()
            .iter()
            .all(|&constituent| is_unit_type(c, constituent));
    }
    is_unit_type(c, t)
}

pub fn is_neither_unit_type_nor_never(c: &Checker<'_>, t: TypeId) -> bool {
    !c.types[t]
        .flags
        .intersects(TypeFlags::UNIT | TypeFlags::NEVER)
}

pub fn is_unit_type(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t].flags.intersects(TypeFlags::UNIT)
}

impl<'a> Checker<'a> {
    pub fn is_unit_like_type(&mut self, t: TypeId) -> bool {
        // Intersections that reduce to 'never' (e.g. 'T & null' where 'T extends {}') are not unit types.
        let t = self.get_base_constraint_or_type(t);
        // Scan intersections such that tagged literal types are considered unit types.
        if self.types[t].flags.intersects(TypeFlags::INTERSECTION) {
            let types = self.as_union_or_intersection_type(t).types;
            return types
                .as_slice()
                .iter()
                .any(|&constituent| is_unit_type(self, constituent));
        }
        is_unit_type(self, t)
    }

    pub fn extract_unit_type(&self, t: TypeId) -> TypeId {
        if self.types[t].flags.intersects(TypeFlags::INTERSECTION) {
            let types = self.as_union_or_intersection_type(t).types;
            let u = types
                .as_slice()
                .iter()
                .find(|&&constituent| is_unit_type(self, constituent));
            if let Some(&u) = u {
                return u;
            }
        }
        t
    }

    pub fn get_base_type_of_literal_type(&mut self, t: TypeId) -> TypeId {
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::ENUM_LIKE) {
            return self.get_base_type_of_enum_like_type(t);
        }
        if flags.intersects(
            TypeFlags::STRING_LITERAL | TypeFlags::TEMPLATE_LITERAL | TypeFlags::STRING_MAPPING,
        ) {
            return self.string_type;
        }
        if flags.intersects(TypeFlags::NUMBER_LITERAL) {
            return self.number_type;
        }
        if flags.intersects(TypeFlags::BIG_INT_LITERAL) {
            return self.bigint_type;
        }
        if flags.intersects(TypeFlags::BOOLEAN_LITERAL) {
            return self.boolean_type;
        }
        if flags.intersects(TypeFlags::UNION) {
            return self.get_base_type_of_literal_type_union(t);
        }
        t
    }

    // This like getBaseTypeOfLiteralType, but instead treats enum literals as strings/numbers instead of returning their enum base type (which depends on the types of other literals in the enum).
    pub fn get_base_type_of_literal_type_for_comparison(&mut self, t: TypeId) -> TypeId {
        let flags = self.types[t].flags;
        if flags.intersects(
            TypeFlags::STRING_LITERAL | TypeFlags::TEMPLATE_LITERAL | TypeFlags::STRING_MAPPING,
        ) {
            return self.string_type;
        }
        if flags.intersects(TypeFlags::NUMBER_LITERAL | TypeFlags::ENUM) {
            return self.number_type;
        }
        if flags.intersects(TypeFlags::BIG_INT_LITERAL) {
            return self.bigint_type;
        }
        if flags.intersects(TypeFlags::BOOLEAN_LITERAL) {
            return self.boolean_type;
        }
        if flags.intersects(TypeFlags::UNION) {
            return self.map_type(t, &mut |c, s| {
                c.get_base_type_of_literal_type_for_comparison(s)
            });
        }
        t
    }

    pub fn get_base_type_of_enum_like_type(&mut self, t: TypeId) -> TypeId {
        let symbol = self.types[t].symbol;
        if self.types[t].flags.intersects(TypeFlags::ENUM_LIKE)
            && self
                .ast
                .sym(symbol)
                .flags
                .intersects(SymbolFlags::ENUM_MEMBER)
        {
            let parent = self.get_parent_of_symbol(symbol);
            return self.get_declared_type_of_symbol(parent);
        }
        t
    }

    pub fn get_base_type_of_literal_type_union(&mut self, t: TypeId) -> TypeId {
        let key = CachedTypeKey {
            kind: CachedTypeKind::LITERAL_UNION_BASE_TYPE,
            type_id: t,
        };
        if let Some(cached) = self.cached_types.get_ok(&key) {
            return cached;
        }
        let result = self.map_type(t, &mut |c, s| c.get_base_type_of_literal_type(s));
        let ok = self.cached_types.set(key, result);
        self.map_set(ok);
        result
    }

    pub fn get_widened_literal_type(&mut self, t: TypeId) -> TypeId {
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::ENUM_LIKE) && is_fresh_literal_type(self, t) {
            return self.get_base_type_of_enum_like_type(t);
        }
        if flags.intersects(TypeFlags::STRING_LITERAL) && is_fresh_literal_type(self, t) {
            return self.string_type;
        }
        if flags.intersects(TypeFlags::NUMBER_LITERAL) && is_fresh_literal_type(self, t) {
            return self.number_type;
        }
        if flags.intersects(TypeFlags::BIG_INT_LITERAL) && is_fresh_literal_type(self, t) {
            return self.bigint_type;
        }
        if flags.intersects(TypeFlags::BOOLEAN_LITERAL) && is_fresh_literal_type(self, t) {
            return self.boolean_type;
        }
        if flags.intersects(TypeFlags::UNION) {
            return self.map_type(t, &mut |c, s| c.get_widened_literal_type(s));
        }
        t
    }

    pub fn get_widened_unique_es_symbol_type(&mut self, t: TypeId) -> TypeId {
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::UNIQUE_ES_SYMBOL) {
            return self.es_symbol_type;
        }
        if flags.intersects(TypeFlags::UNION) {
            return self.map_type(t, &mut |c, s| c.get_widened_unique_es_symbol_type(s));
        }
        t
    }

    pub fn get_widened_literal_like_type_for_contextual_type(
        &mut self,
        t: TypeId,
        contextual_type: TypeId,
    ) -> TypeId {
        let mut t = t;
        if !self.is_literal_of_contextual_type(t, contextual_type) {
            let widened = self.get_widened_literal_type(t);
            t = self.get_widened_unique_es_symbol_type(widened);
        }
        self.get_regular_type_of_literal_type(t)
    }

    pub fn is_literal_of_contextual_type(
        &mut self,
        candidate_type: TypeId,
        contextual_type: TypeId,
    ) -> bool {
        if !contextual_type.is_nil() {
            if !self.stack_check.is_safe_to_recurse() {
                return self.stack_limit();
            }
            let flags = self.types[contextual_type].flags;
            if flags.intersects(TypeFlags::UNION_OR_INTERSECTION) {
                let types = self.type_types(contextual_type);
                for &t in types.as_slice() {
                    if self.is_literal_of_contextual_type(candidate_type, t) {
                        return true;
                    }
                }
                return false;
            }
            if flags.intersects(TypeFlags::INSTANTIABLE_NON_PRIMITIVE) {
                // If the contextual type is a type variable constrained to a primitive type, consider this a literal context for literals of that primitive type: given a type parameter 'T extends string', infer string literal types for T.
                let mut constraint = self.get_base_constraint_of_type(contextual_type);
                if constraint.is_nil() {
                    constraint = self.unknown_type;
                }
                return self.maybe_type_of_kind(constraint, TypeFlags::STRING)
                    && self.maybe_type_of_kind(candidate_type, TypeFlags::STRING_LITERAL)
                    || self.maybe_type_of_kind(constraint, TypeFlags::NUMBER)
                        && self.maybe_type_of_kind(candidate_type, TypeFlags::NUMBER_LITERAL)
                    || self.maybe_type_of_kind(constraint, TypeFlags::BIG_INT)
                        && self.maybe_type_of_kind(candidate_type, TypeFlags::BIG_INT_LITERAL)
                    || self.maybe_type_of_kind(constraint, TypeFlags::ES_SYMBOL)
                        && self.maybe_type_of_kind(candidate_type, TypeFlags::UNIQUE_ES_SYMBOL)
                    || self.is_literal_of_contextual_type(candidate_type, constraint);
            }
            // If the contextual type is a literal of a particular primitive type, we consider this a literal context for all literals of that primitive type.
            return flags.intersects(
                TypeFlags::STRING_LITERAL
                    | TypeFlags::INDEX
                    | TypeFlags::TEMPLATE_LITERAL
                    | TypeFlags::STRING_MAPPING,
            ) && self.maybe_type_of_kind(candidate_type, TypeFlags::STRING_LITERAL)
                || flags.intersects(TypeFlags::NUMBER_LITERAL)
                    && self.maybe_type_of_kind(candidate_type, TypeFlags::NUMBER_LITERAL)
                || flags.intersects(TypeFlags::BIG_INT_LITERAL)
                    && self.maybe_type_of_kind(candidate_type, TypeFlags::BIG_INT_LITERAL)
                || flags.intersects(TypeFlags::BOOLEAN_LITERAL)
                    && self.maybe_type_of_kind(candidate_type, TypeFlags::BOOLEAN_LITERAL)
                || flags.intersects(TypeFlags::UNIQUE_ES_SYMBOL)
                    && self.maybe_type_of_kind(candidate_type, TypeFlags::UNIQUE_ES_SYMBOL);
        }
        false
    }

    pub fn map_type_with_alias(
        &mut self,
        t: TypeId,
        f: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> TypeId,
        alias: TypeAliasId,
    ) -> TypeId {
        if self.types[t].flags.intersects(TypeFlags::UNION) && !alias.is_nil() {
            let types = self.type_types(t);
            let mut mapped_types: Vec<TypeId> = Vec::with_capacity(types.as_slice().len());
            for &s in types.as_slice() {
                mapped_types.push(f(self, s));
            }
            let mapped_types = self.list_of(&mapped_types);
            return self.get_union_type_ex(
                mapped_types,
                UnionReduction::LITERAL,
                alias,
                TypeId::NIL,
            );
        }
        self.map_type(t, f)
    }

    pub fn map_type(
        &mut self,
        t: TypeId,
        f: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> TypeId,
    ) -> TypeId {
        self.map_type_ex(t, f, false)
    }

    pub fn map_type_ex(
        &mut self,
        t: TypeId,
        f: &mut dyn FnMut(&mut Checker<'a>, TypeId) -> TypeId,
        no_reductions: bool,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[t].flags.intersects(TypeFlags::NEVER) {
            return t;
        }
        if !self.types[t].flags.intersects(TypeFlags::UNION) {
            return f(self, t);
        }
        let mut types = self.as_union_or_intersection_type(t).types;
        let origin = self.as_union_type(t).origin;
        if !origin.is_nil() && self.types[origin].flags.intersects(TypeFlags::UNION) {
            types = self.type_types(origin);
        }
        let mut mapped_types: Vec<TypeId> = Vec::with_capacity(16);
        let mut changed = false;
        for &s in types.as_slice() {
            let mapped = if self.types[s].flags.intersects(TypeFlags::UNION) {
                self.map_type_ex(s, f, no_reductions)
            } else {
                f(self, s)
            };
            if mapped != s {
                changed = true;
            }
            if !mapped.is_nil() {
                mapped_types.push(mapped);
            }
        }
        if changed {
            if mapped_types.is_empty() {
                return TypeId::NIL;
            }
            let reduction = if no_reductions {
                UnionReduction::NONE
            } else {
                UnionReduction::LITERAL
            };
            let mapped_types = self.list_of(&mapped_types);
            return self.get_union_type_ex(mapped_types, reduction, TypeAliasId::NIL, TypeId::NIL);
        }
        t
    }
}
