// checker.go:27551-28310 (layer K-PRED): the functions of 27729-27793, 27926-27986 and 28278-28280: kind tests over types, const enum tests, the cached union predicates and extractTypesOfKind.
use crate::ast::{Ast, SymbolFlags, SymbolId};
use crate::checker::{Checker, ObjectFlags, TypeFlags, TypeId};
use crate::core::List;

// `s[i]` as a guarded read: the nil id when the index is outside the slice.
fn at(types: &[TypeId], index: usize) -> TypeId {
    types.get(index).copied().unwrap_or(TypeId::NIL)
}

impl<'a> Checker<'a> {
    // Return true if type might be of the given kind. A union or intersection type might be of a given kind if at least one constituent type is of the given kind.
    pub fn maybe_type_of_kind(&self, t: TypeId, kind: TypeFlags) -> bool {
        if self.types[t].flags.intersects(kind) {
            return true;
        }
        if self.types[t]
            .flags
            .intersects(TypeFlags::UNION_OR_INTERSECTION)
        {
            if !self.stack_check.is_safe_to_recurse() {
                return self.stack_limit();
            }
            for &constituent in self.type_types(t).as_slice() {
                if self.maybe_type_of_kind(constituent, kind) {
                    return true;
                }
            }
        }
        false
    }

    pub fn maybe_type_of_kind_considering_base_constraint(
        &mut self,
        t: TypeId,
        kind: TypeFlags,
    ) -> bool {
        if self.maybe_type_of_kind(t, kind) {
            return true;
        }
        let base_constraint = self.get_base_constraint_or_type(t);
        !base_constraint.is_nil() && self.maybe_type_of_kind(base_constraint, kind)
    }

    pub fn all_types_assignable_to_kind(&mut self, source: TypeId, kind: TypeFlags) -> bool {
        self.all_types_assignable_to_kind_ex(source, kind, false)
    }

    pub fn all_types_assignable_to_kind_ex(
        &mut self,
        source: TypeId,
        kind: TypeFlags,
        strict: bool,
    ) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[source].flags.intersects(TypeFlags::UNION) {
            let types = self.type_types(source);
            for &sub_type in types.as_slice() {
                if !self.all_types_assignable_to_kind_ex(sub_type, kind, strict) {
                    return false;
                }
            }
            return true;
        }
        self.is_type_assignable_to_kind_ex(source, kind, strict)
    }

    pub fn is_type_assignable_to_kind(&mut self, source: TypeId, kind: TypeFlags) -> bool {
        self.is_type_assignable_to_kind_ex(source, kind, false)
    }

    pub fn is_type_assignable_to_kind_ex(
        &mut self,
        source: TypeId,
        kind: TypeFlags,
        strict: bool,
    ) -> bool {
        if self.types[source].flags.intersects(kind) {
            return true;
        }
        if strict
            && self.types[source].flags.intersects(
                TypeFlags::ANY_OR_UNKNOWN
                    | TypeFlags::VOID
                    | TypeFlags::UNDEFINED
                    | TypeFlags::NULL,
            )
        {
            return false;
        }
        kind.intersects(TypeFlags::NUMBER_LIKE)
            && self.is_type_assignable_to(source, self.number_type)
            || kind.intersects(TypeFlags::BIG_INT_LIKE)
                && self.is_type_assignable_to(source, self.bigint_type)
            || kind.intersects(TypeFlags::STRING_LIKE)
                && self.is_type_assignable_to(source, self.string_type)
            || kind.intersects(TypeFlags::BOOLEAN_LIKE)
                && self.is_type_assignable_to(source, self.boolean_type)
            || kind.intersects(TypeFlags::VOID)
                && self.is_type_assignable_to(source, self.void_type)
            || kind.intersects(TypeFlags::NEVER)
                && self.is_type_assignable_to(source, self.never_type)
            || kind.intersects(TypeFlags::NULL)
                && self.is_type_assignable_to(source, self.null_type)
            || kind.intersects(TypeFlags::UNDEFINED)
                && self.is_type_assignable_to(source, self.undefined_type)
            || kind.intersects(TypeFlags::ES_SYMBOL)
                && self.is_type_assignable_to(source, self.es_symbol_type)
            || kind.intersects(TypeFlags::NON_PRIMITIVE)
                && self.is_type_assignable_to(source, self.non_primitive_type)
    }
}

pub fn is_const_enum_object_type(c: &Checker<'_>, t: TypeId) -> bool {
    c.types[t].object_flags.intersects(ObjectFlags::ANONYMOUS)
        && !c.types[t].symbol.is_nil()
        && is_const_enum_symbol(c.ast, c.types[t].symbol)
}

pub fn is_const_enum_symbol(a: Ast<'_>, symbol: SymbolId) -> bool {
    a.sym(symbol).flags.intersects(SymbolFlags::CONST_ENUM)
}

impl<'a> Checker<'a> {
    pub fn is_unknown_like_union_type(&mut self, t: TypeId) -> bool {
        if self.strict_null_checks && self.types[t].flags.intersects(TypeFlags::UNION) {
            if !self.types[t]
                .object_flags
                .intersects(ObjectFlags::IS_UNKNOWN_LIKE_UNION_COMPUTED)
            {
                self.types[t].object_flags |= ObjectFlags::IS_UNKNOWN_LIKE_UNION_COMPUTED;
                let types = self.type_types(t).as_slice();
                if types.len() >= 3
                    && self.types[at(types, 0)]
                        .flags
                        .intersects(TypeFlags::UNDEFINED)
                    && self.types[at(types, 1)].flags.intersects(TypeFlags::NULL)
                {
                    let mut some_empty = false;
                    for &constituent in types {
                        if self.is_empty_anonymous_object_type(constituent) {
                            some_empty = true;
                            break;
                        }
                    }
                    if some_empty {
                        self.types[t].object_flags |= ObjectFlags::IS_UNKNOWN_LIKE_UNION;
                    }
                }
            }
            return self.types[t]
                .object_flags
                .intersects(ObjectFlags::IS_UNKNOWN_LIKE_UNION);
        }
        false
    }

    // Return true the given type is a primitive union type where no two literal type constituents are comparable. Specifically, that means (a) the union doesn't contain literals from different enum types, and (b) the union doesn't contain both enum literals and string or number literals.
    pub fn is_uniform_union_type(&mut self, t: TypeId) -> bool {
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::PRIMITIVE_UNION)
        {
            if !self.types[t]
                .object_flags
                .intersects(ObjectFlags::IS_UNIFORM_ENUM_COMPUTED)
            {
                let types = self.type_types(t);
                let is_uniform = self.compute_is_uniform_union_type(types);
                let uniform_flags = if is_uniform {
                    ObjectFlags::IS_UNIFORM_ENUM
                } else {
                    ObjectFlags::NONE
                };
                self.types[t].object_flags |= ObjectFlags::IS_UNIFORM_ENUM_COMPUTED | uniform_flags;
            }
            return self.types[t]
                .object_flags
                .intersects(ObjectFlags::IS_UNIFORM_ENUM);
        }
        false
    }

    pub fn compute_is_uniform_union_type(&mut self, types: List<'_, TypeId>) -> bool {
        let mut enum_symbol = SymbolId::NIL;
        let mut has_string_or_number_literal = false;
        for &t in types.as_slice() {
            if self.types[t].flags.intersects(TypeFlags::ENUM_LIKE) {
                if has_string_or_number_literal {
                    return false;
                }
                let symbol = self.types[t].symbol;
                let parent = self.get_parent_of_symbol(symbol);
                if enum_symbol.is_nil() {
                    enum_symbol = parent;
                } else if enum_symbol != parent {
                    return false;
                }
            } else if self.types[t]
                .flags
                .intersects(TypeFlags::STRING_OR_NUMBER_LITERAL)
            {
                if !enum_symbol.is_nil() {
                    return false;
                }
                has_string_or_number_literal = true;
            }
        }
        true
    }

    pub fn contains_undefined_type(&self, t: TypeId) -> bool {
        let mut t = t;
        if self.types[t].flags.intersects(TypeFlags::UNION) {
            t = at(self.type_types(t).as_slice(), 0);
        }
        self.types[t].flags.intersects(TypeFlags::UNDEFINED)
    }

    pub fn type_has_call_or_construct_signatures(&mut self, t: TypeId) -> bool {
        if !self.types[t].flags.intersects(TypeFlags::STRUCTURED_TYPE) {
            return false;
        }
        let resolved = self.resolve_structured_type_members(t);
        !self
            .as_structured_type(resolved)
            .signatures
            .as_slice()
            .is_empty()
    }

    pub fn extract_types_of_kind(&mut self, t: TypeId, kind: TypeFlags) -> TypeId {
        self.filter_type(t, &mut |c, u| c.types[u].flags.intersects(kind))
    }
}
