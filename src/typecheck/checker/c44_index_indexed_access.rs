// checker.go:26803-27549 (layers K-KEYOF, K-INDEXED, K-SUBST): keyof types and the literal types of property names, computed property names, indexed access types with the diagnostics of a failed access, and NoInfer and substitution types.
use crate::ast::{
    Arg, Ast, DiagnosticId, INTERNAL_SYMBOL_NAME_DEFAULT, INTERNAL_SYMBOL_NAME_MISSING, Kind,
    ModifierFlags, NodeId, SymbolFlags, SymbolId, get_first_identifier, get_name_of_declaration,
    get_property_name_for_property_name_node, get_this_container, is_access_expression,
    is_accessor, is_assignment_target, is_binary_expression, is_class_like,
    is_computed_property_name, is_constructor_declaration, is_element_access_expression,
    is_entity_name_expression, is_expression, is_identifier, is_indexed_access_type_node,
    is_interface_declaration, is_namespace_import, is_numeric_literal, is_private_identifier,
    is_property_declaration, is_property_name, is_static, is_type_literal_node, skip_parentheses,
    symbol_name,
};
use crate::checker::{
    AccessFlags, AssignmentKind, CachedTypeKey, CachedTypeKind, Checker, ElementFlags, IndexFlags,
    IndexInfoId, IntersectionFlags, MappedTypeNameTypeKind, ObjectFlags, PropertiesTypesKey,
    SubstitutionTypeKey, ThisAssignmentDeclarationKind, TypeAliasId, TypeFlags, TypeId,
    UnionReduction, append_type_mapping, compare_types, every_type, for_each_type,
    get_assignment_target_kind, get_declaration_modifier_flags_from_symbol, get_indexed_access_key,
    get_property_name_from_type, get_string_literal_value, get_total_fixed_element_count,
    get_type_list_key, is_const_enum_object_type, is_delete_target, is_known_symbol,
    is_numeric_literal_name, is_object_literal_type, is_this_property, is_tuple_type, is_type_any,
    is_type_usable_as_property_name, try_get_property_access_or_identifier_to_string,
};
use crate::core::{
    List, Text, Tristate, get_spelling_suggestion_with_max_candidate_count, or_else,
};
use crate::diagnostics;
use crate::evaluator::any_to_string;
use crate::jsnum;
use crate::scanner::get_text_of_node;
use std::borrow::Cow;

impl<'a> Checker<'a> {
    pub fn get_index_type(&mut self, t: TypeId) -> TypeId {
        self.get_index_type_ex(t, IndexFlags::NONE)
    }

    pub fn get_index_type_ex(&mut self, t: TypeId, index_flags: IndexFlags) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let t = self.get_reduced_type(t);
        if self.is_no_infer_type(t) {
            let base_type = self.as_substitution_type(t).base_type;
            let index_type = self.get_index_type_ex(base_type, index_flags);
            return self.get_no_infer_type(index_type);
        }
        if self.should_defer_index_type(t, index_flags) {
            return self.get_index_type_for_generic_type(t, index_flags);
        }
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::UNION) {
            let types = self.type_types(t);
            let mut index_types: Vec<TypeId> = Vec::with_capacity(types.as_slice().len());
            for &u in types.as_slice() {
                let index_type = self.get_index_type_ex(u, index_flags);
                index_types.push(index_type);
            }
            return self.get_intersection_type(List::from_slice(&index_types));
        }
        if flags.intersects(TypeFlags::INTERSECTION) {
            let types = self.type_types(t);
            let mut index_types: Vec<TypeId> = Vec::with_capacity(types.as_slice().len());
            for &u in types.as_slice() {
                let index_type = self.get_index_type_ex(u, index_flags);
                index_types.push(index_type);
            }
            return self.get_union_type(List::from_slice(&index_types));
        }
        if self.types[t].object_flags.intersects(ObjectFlags::MAPPED) {
            return self.get_index_type_for_mapped_type(t, index_flags);
        }
        if t == self.wildcard_type {
            return self.wildcard_type;
        }
        if flags.intersects(TypeFlags::UNKNOWN) {
            return self.never_type;
        }
        if flags.intersects(TypeFlags::ANY | TypeFlags::NEVER) {
            return self.string_number_symbol_type;
        }
        let include = if index_flags.intersects(IndexFlags::NO_INDEX_SIGNATURES) {
            TypeFlags::STRING_LITERAL
        } else {
            TypeFlags::STRING_LIKE
        } | if index_flags.intersects(IndexFlags::STRINGS_ONLY) {
            TypeFlags::NONE
        } else {
            TypeFlags::NUMBER_LIKE | TypeFlags::ES_SYMBOL_LIKE
        };
        self.get_literal_type_from_properties(t, include, index_flags == IndexFlags::NONE)
    }

    pub fn get_extract_string_type(&mut self, t: TypeId) -> TypeId {
        let extract_type_alias = self.get_global_extract_symbol();
        if !extract_type_alias.is_nil() {
            let string_type = self.string_type;
            return self.get_type_alias_instantiation(
                extract_type_alias,
                List::from_slice(&[t, string_type]),
                TypeAliasId::NIL,
            );
        }
        self.string_type
    }

    pub fn get_literal_type_from_properties(
        &mut self,
        t: TypeId,
        include: TypeFlags,
        include_origin: bool,
    ) -> TypeId {
        let key = PropertiesTypesKey {
            type_id: t,
            include,
            include_origin,
            unresolved_members: self.types[t]
                .object_flags
                .intersects(ObjectFlags::UNRESOLVED_MEMBERS),
        };
        if let Some(cached) = self.properties_types.get_ok(&key) {
            return cached;
        }
        let mut origin = TypeId::NIL;
        if include_origin
            && self.types[t]
                .object_flags
                .intersects(ObjectFlags::CLASS_OR_INTERFACE | ObjectFlags::REFERENCE)
            || !self.types[t].alias.is_nil()
        {
            origin = self.new_index_type(t, IndexFlags::NONE);
        }
        let props = self.get_properties_of_type(t);
        let index_infos = self.get_index_infos_of_type(t);
        let mut types: Vec<TypeId> =
            Vec::with_capacity(props.as_slice().len() + index_infos.as_slice().len());
        for &prop in props.as_slice() {
            let name_type = self.get_literal_type_from_property(prop, include, false);
            types.push(name_type);
        }
        for &info in index_infos.as_slice() {
            let key_type = self.index_infos[info].key_type;
            if info != self.enum_number_index_info && self.is_key_type_included(key_type, include) {
                if key_type == self.string_type && include.intersects(TypeFlags::NUMBER) {
                    types.push(self.string_or_number_type);
                } else {
                    types.push(key_type);
                }
            }
        }
        let result = self.get_union_type_ex(
            List::from_slice(&types),
            UnionReduction::LITERAL,
            TypeAliasId::NIL,
            origin,
        );
        let ok = self.properties_types.set(key, result);
        self.map_set(ok);
        result
    }

    pub fn get_literal_type_from_property(
        &mut self,
        prop: SymbolId,
        include: TypeFlags,
        include_non_public: bool,
    ) -> TypeId {
        let a = self.ast;
        if include_non_public
            || !get_declaration_modifier_flags_from_symbol(a, prop)
                .intersects(ModifierFlags::NON_PUBLIC_ACCESSIBILITY_MODIFIER)
        {
            let late_bound_symbol = self.get_late_bound_symbol(prop);
            let links = self.value_symbol_links_get(late_bound_symbol);
            let mut t = self.value_symbol_links[links].name_type;
            if t.is_nil() {
                if a.sym(prop).name == INTERNAL_SYMBOL_NAME_DEFAULT {
                    t = self.get_string_literal_type(b"default");
                } else {
                    let name = get_name_of_declaration(a, a.sym(prop).value_declaration);
                    if !name.is_nil() {
                        t = self.get_literal_type_from_property_name(name);
                    }
                    if t.is_nil() && !is_known_symbol(a, prop) {
                        t = self.get_string_literal_type(symbol_name(a, prop));
                    }
                }
            }
            if !t.is_nil() && self.types[t].flags.intersects(include) {
                return t;
            }
        }
        self.never_type
    }

    pub fn get_literal_type_from_property_name(&mut self, name: NodeId) -> TypeId {
        let a = self.ast;
        if is_private_identifier(a, name) {
            return self.never_type;
        }
        if is_numeric_literal(a, name) {
            let t = self.check_expression(name);
            return self.get_regular_type_of_literal_type(t);
        }
        if is_computed_property_name(a, name) {
            let t = self.check_computed_property_name(name);
            return self.get_regular_type_of_literal_type(t);
        }
        let property_name = get_property_name_for_property_name_node(a, name);
        if &*property_name != INTERNAL_SYMBOL_NAME_MISSING {
            let property_name = match property_name {
                Cow::Borrowed(property_name) => property_name,
                Cow::Owned(property_name) => self.text(&property_name),
            };
            return self.get_string_literal_type(property_name);
        }
        if is_expression(a, name) {
            let t = self.check_expression(name);
            return self.get_regular_type_of_literal_type(t);
        }
        self.never_type
    }

    pub fn is_key_type_included(&self, key_type: TypeId, include: TypeFlags) -> bool {
        let flags = self.types[key_type].flags;
        if flags.intersects(include) {
            return true;
        }
        if flags.intersects(TypeFlags::INTERSECTION) {
            if !self.stack_check.is_safe_to_recurse() {
                return self.stack_limit();
            }
            for &t in self.type_types(key_type).as_slice() {
                if self.is_key_type_included(t, include) {
                    return true;
                }
            }
        }
        false
    }
}

pub fn is_invalid_computed_property_name(a: Ast<'_>, node: NodeId) -> bool {
    let parent = a.parent(node);
    let grand_parent = a.parent(parent);
    (is_type_literal_node(a, grand_parent)
        || is_class_like(a, grand_parent)
        || is_interface_declaration(a, grand_parent))
        && is_binary_expression(a, a.expression(node))
        && a.kind(a.as_binary_expression(a.expression(node)).operator_token) == Kind::InKeyword
        && !is_accessor(a, parent)
}

impl<'a> Checker<'a> {
    pub fn check_computed_property_name(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            self.type_node_links[links].resolved_type = self.circular_constraint_type;
            if is_invalid_computed_property_name(a, node) {
                self.type_node_links[links].resolved_type = self.error_type;
                return self.type_node_links[links].resolved_type;
            }
            let resolved_type = self.check_expression(a.expression(node));
            self.type_node_links[links].resolved_type = resolved_type;
            // This will allow types number, string, symbol or any. It will also allow enums, the unknown type, and any union of these types (like string | number).
            if self.types[resolved_type]
                .flags
                .intersects(TypeFlags::NULLABLE)
                || !self.is_type_assignable_to_kind(
                    resolved_type,
                    TypeFlags::STRING_LIKE | TypeFlags::NUMBER_LIKE | TypeFlags::ES_SYMBOL_LIKE,
                ) && !self.is_type_assignable_to(resolved_type, self.string_number_symbol_type)
            {
                self.error(
                    node,
                    diagnostics::A_COMPUTED_PROPERTY_NAME_MUST_BE_OF_TYPE_STRING_NUMBER_SYMBOL_OR_ANY,
                    &[],
                );
            }
        }
        self.type_node_links[links].resolved_type
    }

    pub fn is_no_infer_type(&self, t: TypeId) -> bool {
        // A NoInfer<T> type is represented as a substitution type with a TypeFlags.Unknown constraint.
        self.types[t].flags.intersects(TypeFlags::SUBSTITUTION)
            && self.types[self.as_substitution_type(t).constraint]
                .flags
                .intersects(TypeFlags::UNKNOWN)
    }

    pub fn get_substitution_intersection(&mut self, t: TypeId) -> TypeId {
        if self.is_no_infer_type(t) {
            return self.as_substitution_type(t).base_type;
        }
        let constraint = self.as_substitution_type(t).constraint;
        let base_type = self.as_substitution_type(t).base_type;
        self.get_intersection_type(List::from_slice(&[constraint, base_type]))
    }

    pub fn should_defer_index_type(&mut self, t: TypeId, index_flags: IndexFlags) -> bool {
        let flags = self.types[t].flags;
        flags.intersects(TypeFlags::INSTANTIABLE_NON_PRIMITIVE)
            || self.is_generic_tuple_type(t)
            || self.is_generic_mapped_type(t) && !self.get_name_type_from_mapped_type(t).is_nil()
            || flags.intersects(TypeFlags::UNION)
                && !index_flags.intersects(IndexFlags::NO_REDUCIBLE_CHECK)
                && self.is_generic_reducible_type(t)
            || flags.intersects(TypeFlags::INTERSECTION)
                && self.maybe_type_of_kind(t, TypeFlags::INSTANTIABLE)
                && self
                    .type_types(t)
                    .as_slice()
                    .iter()
                    .any(|&u| self.is_empty_anonymous_object_type(u))
    }

    pub fn get_mapped_type_name_type_kind(&mut self, t: TypeId) -> MappedTypeNameTypeKind {
        let name_type = self.get_name_type_from_mapped_type(t);
        if name_type.is_nil() {
            return MappedTypeNameTypeKind::NONE;
        }
        let type_parameter = self.get_type_parameter_from_mapped_type(t);
        if self.is_type_assignable_to(name_type, type_parameter) {
            return MappedTypeNameTypeKind::FILTERING;
        }
        MappedTypeNameTypeKind::REMAPPING
    }

    pub fn get_index_type_for_generic_type(
        &mut self,
        t: TypeId,
        index_flags: IndexFlags,
    ) -> TypeId {
        let key = CachedTypeKey {
            kind: if index_flags.intersects(IndexFlags::STRINGS_ONLY) {
                CachedTypeKind::STRING_INDEX_TYPE
            } else {
                CachedTypeKind::INDEX_TYPE
            },
            type_id: t,
        };
        let index_type = self.cached_types.get(&key);
        if !index_type.is_nil() {
            return index_type;
        }
        let index_type = self.new_index_type(t, index_flags & IndexFlags::STRINGS_ONLY);
        let ok = self.cached_types.set(key, index_type);
        self.map_set(ok);
        index_type
    }

    // This roughly mirrors `resolveMappedTypeMembers` in the nongeneric case, except only reports a union of the keys calculated, rather than manufacturing the properties. We can't just fetch the `constraintType` since that would ignore mappings and mapping the `constraintType` directly ignores how mapped types map _properties_ and not keys (thus ignoring subtype reduction in the constraintType) when possible. IndexFlagsNoIndexSignatures indicates if _string_ index signatures should be elided (other index signatures are always reported).
    pub fn get_index_type_for_mapped_type(&mut self, t: TypeId, index_flags: IndexFlags) -> TypeId {
        let type_parameter = self.get_type_parameter_from_mapped_type(t);
        let constraint_type = self.get_constraint_type_from_mapped_type(t);
        let target = self.as_mapped_type(t).target;
        let name_type = self.get_name_type_from_mapped_type(or_else(target, t));
        if name_type.is_nil() && !index_flags.intersects(IndexFlags::NO_INDEX_SIGNATURES) {
            // no mapping and no filtering required, just quickly bail to returning the constraint in the common case
            return constraint_type;
        }
        let mut key_types: Vec<TypeId> = Vec::new();
        let mut add_member_for_key_type = |c: &mut Checker<'a>, key_type: TypeId| {
            let mut prop_name_type = key_type;
            if !name_type.is_nil() {
                let mapper = c.as_mapped_type(t).mapper;
                let mapper = append_type_mapping(c, mapper, type_parameter, key_type);
                prop_name_type = c.instantiate_type(name_type, mapper);
            }
            // `keyof` currently always returns `string | number` for concrete `string` index signatures - the below ternary keeps that behavior for mapped types. See `getLiteralTypeFromProperties` where there's a similar ternary to cause the same behavior.
            key_types.push(if prop_name_type == c.string_type {
                c.string_or_number_type
            } else {
                prop_name_type
            });
        };
        // Calling getApparentType on the `T` of a `keyof T` in the constraint type of a generic mapped type can trigger a circularity. For example, `T extends { [P in keyof T & string as Captitalize<P>]: any }` is a circular definition. For this reason, we only eagerly manifest the keys if the constraint is non-generic.
        if self.is_generic_index_type(constraint_type) {
            if self.is_mapped_type_with_keyof_constraint_declaration(t) {
                // We have a generic index and a homomorphic mapping and a key remapping - we need to defer the whole `keyof whatever` for later since it's not safe to resolve the shape of modifier type.
                return self.get_index_type_for_generic_type(t, index_flags);
            }
            // Include the generic component in the resulting type.
            for_each_type(self, constraint_type, &mut add_member_for_key_type);
        } else if self.is_mapped_type_with_keyof_constraint_declaration(t) {
            let modifiers_type = self.get_modifiers_type_from_mapped_type(t);
            let modifiers_type = self.get_apparent_type(modifiers_type);
            // The 'T' in 'keyof T'
            self.for_each_mapped_type_property_key_type_and_index_signature_key_type(
                modifiers_type,
                TypeFlags::STRING_OR_NUMBER_LITERAL_OR_UNIQUE,
                index_flags.intersects(IndexFlags::STRINGS_ONLY),
                &mut add_member_for_key_type,
            );
        } else {
            let lower_bound = self.get_lower_bound_of_key_type(constraint_type);
            for_each_type(self, lower_bound, &mut add_member_for_key_type);
        }
        // We had to pick apart the constraintType to potentially map/filter it - compare the final resulting list with the original constraintType, so we can return the union that preserves aliases/origin data if possible.
        let result = if index_flags.intersects(IndexFlags::NO_INDEX_SIGNATURES) {
            let union = self.get_union_type(List::from_slice(&key_types));
            self.filter_type(union, &mut |c, t| {
                !c.types[t]
                    .flags
                    .intersects(TypeFlags::ANY | TypeFlags::STRING)
            })
        } else {
            self.get_union_type(List::from_slice(&key_types))
        };
        if self.types[result].flags.intersects(TypeFlags::UNION)
            && self.types[constraint_type]
                .flags
                .intersects(TypeFlags::UNION)
            && get_type_list_key(self.type_types(result))
                == get_type_list_key(self.type_types(constraint_type))
        {
            return constraint_type;
        }
        result
    }

    pub fn get_indexed_access_type(&mut self, object_type: TypeId, index_type: TypeId) -> TypeId {
        self.get_indexed_access_type_ex(
            object_type,
            index_type,
            AccessFlags::NONE,
            NodeId::NIL,
            TypeAliasId::NIL,
        )
    }

    pub fn get_indexed_access_type_ex(
        &mut self,
        object_type: TypeId,
        index_type: TypeId,
        access_flags: AccessFlags,
        access_node: NodeId,
        alias: TypeAliasId,
    ) -> TypeId {
        let mut result = self.get_indexed_access_type_or_undefined(
            object_type,
            index_type,
            access_flags,
            access_node,
            alias,
        );
        if result.is_nil() {
            result = if !access_node.is_nil() {
                self.error_type
            } else {
                self.unknown_type
            };
        }
        result
    }

    pub fn get_indexed_access_type_or_undefined(
        &mut self,
        object_type: TypeId,
        index_type: TypeId,
        access_flags: AccessFlags,
        access_node: NodeId,
        alias: TypeAliasId,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if object_type == self.wildcard_type || index_type == self.wildcard_type {
            return self.wildcard_type;
        }
        let object_type = self.get_reduced_type(object_type);
        let mut index_type = index_type;
        let mut access_flags = access_flags;
        // If the object type has a string index signature and no other members we know that the result will always be the type of that index signature and we can simplify accordingly.
        if self.is_string_index_signature_only_type(object_type)
            && !self.types[index_type].flags.intersects(TypeFlags::NULLABLE)
            && self.is_type_assignable_to_kind(index_type, TypeFlags::STRING | TypeFlags::NUMBER)
        {
            index_type = self.string_type;
        }
        // In noUncheckedIndexedAccess mode, indexed access operations that occur in an expression in a read position and resolve to an index signature have 'undefined' included in their type.
        if self.compiler_options.no_unchecked_indexed_access == Tristate::TRUE
            && access_flags.intersects(AccessFlags::EXPRESSION_POSITION)
        {
            access_flags |= AccessFlags::INCLUDE_UNDEFINED;
        }
        // If the index type is generic, or if the object type is generic and doesn't originate in an expression and the operation isn't exclusively indexing the fixed (non-variadic) portion of a tuple type, we are performing a higher-order index access where we cannot meaningfully access the properties of the object type. Note that for a generic T and a non-generic K, we eagerly resolve T[K] if it originates in an expression. This is to preserve backwards compatibility. For example, an element access 'this["foo"]' has always been resolved eagerly using the constraint type of 'this' at the given location.
        if self.should_defer_indexed_access_type(object_type, index_type, access_node) {
            if self.types[object_type]
                .flags
                .intersects(TypeFlags::ANY_OR_UNKNOWN)
            {
                return object_type;
            }
            // Defer the operation by creating an indexed access type.
            let persistent_access_flags = access_flags & AccessFlags::PERSISTENT;
            let key = get_indexed_access_key(self, object_type, index_type, access_flags, alias);
            let mut t = self.indexed_access_types.get(&key);
            if t.is_nil() {
                t = self.new_indexed_access_type(object_type, index_type, persistent_access_flags);
                self.types[t].alias = alias;
                let ok = self.indexed_access_types.set(key, t);
                self.map_set(ok);
            }
            return t;
        }
        // In the following we resolve T[K] to the type of the property in T selected by K. We treat boolean as different from other unions to improve errors; skipping straight to getPropertyTypeForIndexType gives errors with 'boolean' instead of 'true'.
        let apparent_object_type = self.get_reduced_apparent_type(object_type);
        let index_type_flags = self.types[index_type].flags;
        if index_type_flags.intersects(TypeFlags::UNION)
            && !index_type_flags.intersects(TypeFlags::BOOLEAN)
        {
            let mut prop_types: Vec<TypeId> = Vec::new();
            let mut was_missing_prop = false;
            let types = self.type_types(index_type);
            for &t in types.as_slice() {
                let flags = if was_missing_prop {
                    access_flags | AccessFlags::SUPPRESS_NO_IMPLICIT_ANY_ERROR
                } else {
                    access_flags
                };
                let prop_type = self.get_property_type_for_index_type(
                    object_type,
                    apparent_object_type,
                    t,
                    index_type,
                    access_node,
                    flags,
                );
                if !prop_type.is_nil() {
                    prop_types.push(prop_type);
                } else if access_node.is_nil() {
                    // If there's no error node, we can immediately stop, since error reporting is off
                    return TypeId::NIL;
                } else {
                    // Otherwise we set a flag and return at the end of the loop so we still mark all errors
                    was_missing_prop = true;
                }
            }
            if was_missing_prop {
                return TypeId::NIL;
            }
            if access_flags.intersects(AccessFlags::WRITING) {
                return self.get_intersection_type_ex(
                    List::from_slice(&prop_types),
                    IntersectionFlags::NONE,
                    alias,
                );
            }
            return self.get_union_type_ex(
                List::from_slice(&prop_types),
                UnionReduction::LITERAL,
                alias,
                TypeId::NIL,
            );
        }
        self.get_property_type_for_index_type(
            object_type,
            apparent_object_type,
            index_type,
            index_type,
            access_node,
            access_flags | AccessFlags::CACHE_SYMBOL | AccessFlags::REPORT_DEPRECATED,
        )
    }

    pub fn get_property_type_for_index_type(
        &mut self,
        original_object_type: TypeId,
        object_type: TypeId,
        index_type: TypeId,
        full_index_type: TypeId,
        access_node: NodeId,
        access_flags: AccessFlags,
    ) -> TypeId {
        let a = self.ast;
        let mut access_expression = NodeId::NIL;
        if !access_node.is_nil() && is_element_access_expression(a, access_node) {
            access_expression = access_node;
        }
        let mut prop_name: Vec<u8> = Vec::new();
        let mut has_prop_name = false;
        if access_node.is_nil() || !is_private_identifier(a, access_node) {
            prop_name = self.get_property_name_from_index(index_type, access_node);
            has_prop_name = prop_name.as_slice() != INTERNAL_SYMBOL_NAME_MISSING;
        }
        if has_prop_name {
            if access_flags.intersects(AccessFlags::CONTEXTUAL) {
                let mut t = self.get_type_of_property_of_contextual_type(object_type, &prop_name);
                if t.is_nil() {
                    t = self.any_type;
                }
                return t;
            }
            let prop = self.get_property_of_type(object_type, &prop_name);
            if !prop.is_nil() {
                if access_flags.intersects(AccessFlags::REPORT_DEPRECATED)
                    && !access_node.is_nil()
                    && a.sym(prop).declarations.len() != 0
                    && self.is_deprecated_symbol(prop)
                    && self.is_uncalled_function_reference(access_node, prop)
                {
                    let deprecated_node = if !access_expression.is_nil() {
                        a.as_element_access_expression(access_expression)
                            .argument_expression
                    } else if is_indexed_access_type_node(a, access_node) {
                        a.as_indexed_access_type_node(access_node).index_type
                    } else {
                        access_node
                    };
                    self.add_deprecated_suggestion(
                        deprecated_node,
                        a.sym(prop).declarations,
                        &prop_name,
                    );
                }
                if !access_expression.is_nil() {
                    let object_symbol = self.types[object_type].symbol;
                    let is_self_type_access =
                        self.is_self_type_access(a.expression(access_expression), object_symbol);
                    self.mark_property_as_referenced(prop, access_expression, is_self_type_access);
                    if self.is_assignment_to_readonly_entity(
                        access_expression,
                        prop,
                        get_assignment_target_kind(a, access_expression),
                    ) {
                        let prop_text = self.symbol_to_string(prop);
                        self.error(
                            a.as_element_access_expression(access_expression)
                                .argument_expression,
                            diagnostics::CANNOT_ASSIGN_TO_0_BECAUSE_IT_IS_A_READ_ONLY_PROPERTY,
                            &[Arg::Str(&prop_text)],
                        );
                        return TypeId::NIL;
                    }
                    if access_flags.intersects(AccessFlags::CACHE_SYMBOL) {
                        let links = self.symbol_node_links.get(access_node);
                        self.symbol_node_links[links].resolved_symbol = prop;
                    }
                    if self.is_this_property_access_in_constructor(access_expression, prop) {
                        return self.auto_type;
                    }
                }
                let prop_type = if access_flags.intersects(AccessFlags::WRITING) {
                    self.get_write_type_of_symbol(prop)
                } else {
                    self.get_type_of_symbol(prop)
                };
                if !access_expression.is_nil()
                    && get_assignment_target_kind(a, access_expression) != AssignmentKind::DEFINITE
                {
                    return self.get_flow_type_of_reference(access_expression, prop_type);
                }
                if !access_node.is_nil()
                    && is_indexed_access_type_node(a, access_node)
                    && self.contains_missing_type(prop_type)
                {
                    let undefined_type = self.undefined_type;
                    return self.get_union_type(List::from_slice(&[prop_type, undefined_type]));
                }
                return prop_type;
            }
            if every_type(self, object_type, &mut |c, t| is_tuple_type(c, t))
                && is_numeric_literal_name(&prop_name)
            {
                let index = jsnum::from_string(&prop_name);
                if !access_node.is_nil()
                    && every_type(self, object_type, &mut |c, t| {
                        !c.type_target_tuple_type(t)
                            .combined_flags
                            .intersects(ElementFlags::VARIABLE)
                    })
                    && !access_flags.intersects(AccessFlags::ALLOW_MISSING)
                {
                    let index_node = get_index_node_for_access_expression(a, access_node);
                    if is_tuple_type(self, object_type) {
                        if index.0 < 0.0 {
                            self.error(
                                index_node,
                                diagnostics::A_TUPLE_TYPE_CANNOT_BE_INDEXED_WITH_A_NEGATIVE_VALUE,
                                &[],
                            );
                            return self.undefined_type;
                        }
                        let object_text = self.type_to_string_exported(object_type);
                        let arity = self.get_type_reference_arity(object_type);
                        self.error(
                            index_node,
                            diagnostics::TUPLE_TYPE_0_OF_LENGTH_1_HAS_NO_ELEMENT_AT_INDEX_2,
                            &[
                                Arg::Str(&object_text),
                                Arg::Int(arity as i64),
                                Arg::Str(&prop_name),
                            ],
                        );
                    } else {
                        let object_text = self.type_to_string_exported(object_type);
                        self.error(
                            index_node,
                            diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1,
                            &[Arg::Str(&prop_name), Arg::Str(&object_text)],
                        );
                    }
                }
                if index.0 >= 0.0 {
                    let index_info = self.get_index_info_of_type(object_type, self.number_type);
                    self.error_if_writing_to_readonly_index(
                        index_info,
                        object_type,
                        access_expression,
                    );
                    let undefined_like_type =
                        if access_flags.intersects(AccessFlags::INCLUDE_UNDEFINED) {
                            self.missing_type
                        } else {
                            TypeId::NIL
                        };
                    return self.get_tuple_element_type_out_of_start_count(
                        object_type,
                        index,
                        undefined_like_type,
                    );
                }
            }
        }
        let index_type_flags = self.types[index_type].flags;
        if !index_type_flags.intersects(TypeFlags::NULLABLE)
            && self.is_type_assignable_to_kind(
                index_type,
                TypeFlags::STRING_LIKE | TypeFlags::NUMBER_LIKE | TypeFlags::ES_SYMBOL_LIKE,
            )
        {
            if self.types[object_type]
                .flags
                .intersects(TypeFlags::ANY | TypeFlags::NEVER)
            {
                return object_type;
            }
            // If no index signature is applicable, we default to the string index signature. In effect, this means the string index signature applies even when accessing with a symbol-like type.
            let mut index_info = self.get_applicable_index_info(object_type, index_type);
            if index_info.is_nil() {
                index_info = self.get_index_info_of_type(object_type, self.string_type);
            }
            if !index_info.is_nil() {
                let key_type = self.index_infos[index_info].key_type;
                let value_type = self.index_infos[index_info].value_type;
                if access_flags.intersects(AccessFlags::NO_INDEX_SIGNATURES)
                    && key_type != self.number_type
                {
                    if !access_expression.is_nil() {
                        if access_flags.intersects(AccessFlags::WRITING) {
                            let object_text = self.type_to_string_exported(original_object_type);
                            self.error(
                                access_expression,
                                diagnostics::TYPE_0_IS_GENERIC_AND_CAN_ONLY_BE_INDEXED_FOR_READING,
                                &[Arg::Str(&object_text)],
                            );
                        } else {
                            let index_text = self.type_to_string_exported(index_type);
                            let object_text = self.type_to_string_exported(original_object_type);
                            self.error(
                                access_expression,
                                diagnostics::TYPE_0_CANNOT_BE_USED_TO_INDEX_TYPE_1,
                                &[Arg::Str(&index_text), Arg::Str(&object_text)],
                            );
                        }
                    }
                    return TypeId::NIL;
                }
                if !access_node.is_nil()
                    && key_type == self.string_type
                    && !self.is_type_assignable_to_kind(
                        index_type,
                        TypeFlags::STRING | TypeFlags::NUMBER,
                    )
                {
                    let index_node = get_index_node_for_access_expression(a, access_node);
                    let index_text = self.type_to_string_exported(index_type);
                    self.error(
                        index_node,
                        diagnostics::TYPE_0_CANNOT_BE_USED_AS_AN_INDEX_TYPE,
                        &[Arg::Str(&index_text)],
                    );
                    if access_flags.intersects(AccessFlags::INCLUDE_UNDEFINED) {
                        let missing_type = self.missing_type;
                        return self.get_union_type(List::from_slice(&[value_type, missing_type]));
                    }
                    return value_type;
                }
                self.error_if_writing_to_readonly_index(index_info, object_type, access_expression);
                // When accessing an enum object with its own type, e.g. E[E.A] for enum E { A }, undefined shouldn't be included in the result type
                if access_flags.intersects(AccessFlags::INCLUDE_UNDEFINED) {
                    let object_symbol = self.types[object_type].symbol;
                    let index_symbol = self.types[index_type].symbol;
                    let is_member_of_indexed_enum = !object_symbol.is_nil()
                        && a.sym(object_symbol)
                            .flags
                            .intersects(SymbolFlags::REGULAR_ENUM | SymbolFlags::CONST_ENUM)
                        && !index_symbol.is_nil()
                        && index_type_flags.intersects(TypeFlags::ENUM_LITERAL)
                        && self.get_parent_of_symbol(index_symbol) == object_symbol;
                    if !is_member_of_indexed_enum {
                        let missing_type = self.missing_type;
                        return self.get_union_type(List::from_slice(&[value_type, missing_type]));
                    }
                }
                return value_type;
            }
            if index_type_flags.intersects(TypeFlags::NEVER) {
                return self.never_type;
            }
            if self.is_js_literal_type(object_type) {
                return self.any_type;
            }
            if !access_expression.is_nil() && !is_const_enum_object_type(self, object_type) {
                let argument_expression = a
                    .as_element_access_expression(access_expression)
                    .argument_expression;
                if is_object_literal_type(self, object_type) {
                    if self.no_implicit_any
                        && index_type_flags
                            .intersects(TypeFlags::STRING_LITERAL | TypeFlags::NUMBER_LITERAL)
                    {
                        let value = any_to_string(&self.as_literal_type(index_type).value);
                        let object_text = self.type_to_string_exported(object_type);
                        let diagnostic = self.create_diagnostic_for_node(
                            access_expression,
                            diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1,
                            &[Arg::Str(&value), Arg::Str(&object_text)],
                        );
                        self.add_diagnostic(diagnostic);
                        return self.undefined_type;
                    } else if index_type_flags.intersects(TypeFlags::NUMBER | TypeFlags::STRING) {
                        let properties = self.as_structured_type(object_type).properties;
                        let mut types: Vec<TypeId> =
                            Vec::with_capacity(properties.as_slice().len() + 1);
                        for &prop in properties.as_slice() {
                            let prop_type = self.get_type_of_symbol(prop);
                            types.push(prop_type);
                        }
                        types.push(self.undefined_type);
                        return self.get_union_type(List::from_slice(&types));
                    }
                }
                let global_this_symbol = self.global_this_symbol;
                let global_this_exports = a.sym(global_this_symbol).exports;
                if self.types[object_type].symbol == global_this_symbol
                    && has_prop_name
                    && !a.table_get(global_this_exports, &prop_name).is_nil()
                    && a.sym(a.table_get(global_this_exports, &prop_name))
                        .flags
                        .intersects(SymbolFlags::BLOCK_SCOPED)
                {
                    let object_text = self.type_to_string_exported(object_type);
                    self.error(
                        access_expression,
                        diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1,
                        &[Arg::Str(&prop_name), Arg::Str(&object_text)],
                    );
                } else if self.no_implicit_any
                    && !access_flags.intersects(AccessFlags::SUPPRESS_NO_IMPLICIT_ANY_ERROR)
                {
                    if has_prop_name && self.type_has_static_property(&prop_name, object_type) {
                        let type_name = self.type_to_string_exported(object_type);
                        let argument_text = get_text_of_node(a, argument_expression);
                        let mut static_member: Vec<u8> =
                            Vec::with_capacity(type_name.len() + argument_text.len() + 2);
                        static_member.extend_from_slice(&type_name);
                        static_member.push(b'[');
                        static_member.extend_from_slice(&argument_text);
                        static_member.push(b']');
                        self.error(
                            access_expression,
                            diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1_DID_YOU_MEAN_TO_ACCESS_THE_STATIC_MEMBER_2_INSTEAD,
                            &[
                                Arg::Str(&prop_name),
                                Arg::Str(&type_name),
                                Arg::Str(&static_member),
                            ],
                        );
                    } else if !self
                        .get_index_type_of_type(object_type, self.number_type)
                        .is_nil()
                    {
                        self.error(
                            argument_expression,
                            diagnostics::ELEMENT_IMPLICITLY_HAS_AN_ANY_TYPE_BECAUSE_INDEX_EXPRESSION_IS_NOT_OF_TYPE_NUMBER,
                            &[],
                        );
                    } else {
                        let mut suggestion: Vec<u8> = Vec::new();
                        if has_prop_name {
                            suggestion = self
                                .get_suggestion_for_nonexistent_property(&prop_name, object_type);
                        }
                        if !suggestion.is_empty() {
                            let object_text = self.type_to_string_exported(object_type);
                            self.error(
                                argument_expression,
                                diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1_DID_YOU_MEAN_2,
                                &[
                                    Arg::Str(&prop_name),
                                    Arg::Str(&object_text),
                                    Arg::Str(&suggestion),
                                ],
                            );
                        } else {
                            suggestion = self.get_suggestion_for_nonexistent_index_signature(
                                object_type,
                                access_expression,
                                index_type,
                            );
                            if !suggestion.is_empty() {
                                let object_text = self.type_to_string_exported(object_type);
                                self.error(
                                    access_expression,
                                    diagnostics::ELEMENT_IMPLICITLY_HAS_AN_ANY_TYPE_BECAUSE_TYPE_0_HAS_NO_INDEX_SIGNATURE_DID_YOU_MEAN_TO_CALL_1,
                                    &[Arg::Str(&object_text), Arg::Str(&suggestion)],
                                );
                            } else {
                                let mut diagnostic = DiagnosticId::NIL;
                                if index_type_flags.intersects(TypeFlags::ENUM_LITERAL) {
                                    let index_text = self.type_to_string_exported(index_type);
                                    let name = [b"[".as_slice(), &index_text, b"]"].concat();
                                    let object_text = self.type_to_string_exported(object_type);
                                    diagnostic = self.new_diagnostic_for_node(
                                        access_expression,
                                        diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1,
                                        &[Arg::Str(&name), Arg::Str(&object_text)],
                                    );
                                } else if index_type_flags.intersects(TypeFlags::UNIQUE_ES_SYMBOL) {
                                    let index_symbol = self.types[index_type].symbol;
                                    let symbol_name = self
                                        .get_fully_qualified_name(index_symbol, access_expression);
                                    let name = [b"[".as_slice(), &symbol_name, b"]"].concat();
                                    let object_text = self.type_to_string_exported(object_type);
                                    diagnostic = self.new_diagnostic_for_node(
                                        access_expression,
                                        diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1,
                                        &[Arg::Str(&name), Arg::Str(&object_text)],
                                    );
                                } else if index_type_flags.intersects(
                                    TypeFlags::STRING_LITERAL | TypeFlags::NUMBER_LITERAL,
                                ) {
                                    // Upstream has one case for a string literal and one for a number literal, with the same body.
                                    let value =
                                        any_to_string(&self.as_literal_type(index_type).value);
                                    let object_text = self.type_to_string_exported(object_type);
                                    diagnostic = self.new_diagnostic_for_node(
                                        access_expression,
                                        diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1,
                                        &[Arg::Str(&value), Arg::Str(&object_text)],
                                    );
                                } else if index_type_flags
                                    .intersects(TypeFlags::NUMBER | TypeFlags::STRING)
                                {
                                    let index_text = self.type_to_string_exported(index_type);
                                    let object_text = self.type_to_string_exported(object_type);
                                    diagnostic = self.new_diagnostic_for_node(
                                        access_expression,
                                        diagnostics::NO_INDEX_SIGNATURE_WITH_A_PARAMETER_OF_TYPE_0_WAS_FOUND_ON_TYPE_1,
                                        &[Arg::Str(&index_text), Arg::Str(&object_text)],
                                    );
                                }
                                let full_index_text = self.type_to_string_exported(full_index_type);
                                let object_text = self.type_to_string_exported(object_type);
                                let chain = self.new_diagnostic_chain_for_node(
                                    diagnostic,
                                    access_expression,
                                    diagnostics::ELEMENT_IMPLICITLY_HAS_AN_ANY_TYPE_BECAUSE_EXPRESSION_OF_TYPE_0_CAN_T_BE_USED_TO_INDEX_TYPE_1,
                                    &[Arg::Str(&full_index_text), Arg::Str(&object_text)],
                                );
                                self.add_diagnostic(chain);
                            }
                        }
                    }
                }
                return TypeId::NIL;
            }
        }
        if access_flags.intersects(AccessFlags::ALLOW_MISSING)
            && is_object_literal_type(self, object_type)
        {
            return self.undefined_type;
        }
        if self.is_js_literal_type(object_type) {
            return self.any_type;
        }
        if !access_node.is_nil() {
            let index_node = get_index_node_for_access_expression(a, access_node);
            if a.kind(index_node) != Kind::BigIntLiteral
                && index_type_flags
                    .intersects(TypeFlags::STRING_LITERAL | TypeFlags::NUMBER_LITERAL)
            {
                let value = any_to_string(&self.as_literal_type(index_type).value);
                let object_text = self.type_to_string_exported(object_type);
                self.error(
                    index_node,
                    diagnostics::PROPERTY_0_DOES_NOT_EXIST_ON_TYPE_1,
                    &[Arg::Str(&value), Arg::Str(&object_text)],
                );
            } else if index_type_flags.intersects(TypeFlags::STRING | TypeFlags::NUMBER) {
                let object_text = self.type_to_string_exported(object_type);
                let index_text = self.type_to_string_exported(index_type);
                self.error(
                    index_node,
                    diagnostics::TYPE_0_HAS_NO_MATCHING_INDEX_SIGNATURE_FOR_TYPE_1,
                    &[Arg::Str(&object_text), Arg::Str(&index_text)],
                );
            } else {
                let type_string = if a.kind(index_node) == Kind::BigIntLiteral {
                    b"bigint".to_vec()
                } else {
                    self.type_to_string_exported(index_type)
                };
                self.error(
                    index_node,
                    diagnostics::TYPE_0_CANNOT_BE_USED_AS_AN_INDEX_TYPE,
                    &[Arg::Str(&type_string)],
                );
            }
        }
        if is_type_any(self, index_type) {
            return index_type;
        }
        TypeId::NIL
    }

    pub fn type_has_static_property(&mut self, prop_name: &[u8], containing_type: TypeId) -> bool {
        let a = self.ast;
        let symbol = self.types[containing_type].symbol;
        if !symbol.is_nil() {
            let symbol_type = self.get_type_of_symbol(symbol);
            let prop = self.get_property_of_type(symbol_type, prop_name);
            return !prop.is_nil()
                && !a.sym(prop).value_declaration.is_nil()
                && is_static(a, a.sym(prop).value_declaration);
        }
        false
    }

    pub fn get_suggestion_for_nonexistent_property(
        &mut self,
        name: &[u8],
        containing_type: TypeId,
    ) -> Vec<u8> {
        let properties = self.get_properties_of_type(containing_type);
        let symbol =
            self.get_spelling_suggestion_for_name(name, properties.as_slice(), SymbolFlags::VALUE);
        if !symbol.is_nil() {
            return self.ast.sym(symbol).name.to_vec();
        }
        Vec::new()
    }

    pub fn get_suggestion_for_nonexistent_index_signature(
        &mut self,
        object_type: TypeId,
        expr: NodeId,
        keyed_type: TypeId,
    ) -> Vec<u8> {
        let a = self.ast;
        // check if object type has setter or getter
        let has_prop = |c: &mut Checker<'a>, name: &[u8]| -> bool {
            let prop = c.get_property_of_object_type(object_type, name);
            if !prop.is_nil() {
                let prop_type = c.get_type_of_symbol(prop);
                let s = c.get_single_call_signature(prop_type);
                if s.is_nil() || c.get_min_argument_count(s) < 1 {
                    return false;
                }
                let parameter_type = c.get_type_at_position(s, 0);
                return c.is_type_assignable_to(keyed_type, parameter_type);
            }
            false
        };
        let suggested_method: &[u8] = if is_assignment_target(a, expr) {
            b"set"
        } else {
            b"get"
        };
        if !has_prop(self, suggested_method) {
            return Vec::new();
        }
        let suggestion = try_get_property_access_or_identifier_to_string(a, a.expression(expr));
        if suggestion.is_empty() {
            return suggested_method.to_vec();
        }
        let mut result: Vec<u8> = Vec::with_capacity(suggestion.len() + 1 + suggested_method.len());
        result.extend_from_slice(&suggestion);
        result.push(b'.');
        result.extend_from_slice(suggested_method);
        result
    }

    pub fn get_suggested_type_for_nonexistent_string_literal_type(
        &mut self,
        source: TypeId,
        target: TypeId,
    ) -> TypeId {
        // A candidate carries its name: the comparer holds the checker while the names are read.
        let types = self.type_types(target);
        let mut candidates: Vec<(TypeId, Text<'a>)> = Vec::new();
        for &t in types.as_slice() {
            if self.types[t].flags.intersects(TypeFlags::STRING_LITERAL) {
                candidates.push((t, get_string_literal_value(self, t)));
            }
        }
        let source_value = get_string_literal_value(self, source);
        let (suggestion, _) = get_spelling_suggestion_with_max_candidate_count(
            source_value,
            candidates,
            |(_, value)| value,
            |(t1, _), (t2, _)| compare_types(self, t1, t2),
            1000,
        );
        suggestion
    }
}

pub fn get_index_node_for_access_expression(a: Ast<'_>, access_node: NodeId) -> NodeId {
    match a.kind(access_node) {
        Kind::ElementAccessExpression => {
            a.as_element_access_expression(access_node)
                .argument_expression
        }
        Kind::IndexedAccessType => a.as_indexed_access_type_node(access_node).index_type,
        Kind::ComputedPropertyName => a.expression(access_node),
        _ => access_node,
    }
}

impl<'a> Checker<'a> {
    pub fn error_if_writing_to_readonly_index(
        &mut self,
        index_info: IndexInfoId,
        object_type: TypeId,
        access_expression: NodeId,
    ) {
        let a = self.ast;
        if !index_info.is_nil()
            && self.index_infos[index_info].is_readonly
            && !access_expression.is_nil()
            && (is_assignment_target(a, access_expression)
                || is_delete_target(a, access_expression))
        {
            let object_text = self.type_to_string_exported(object_type);
            self.error(
                access_expression,
                diagnostics::INDEX_SIGNATURE_IN_TYPE_0_ONLY_PERMITS_READING,
                &[Arg::Str(&object_text)],
            );
        }
    }

    pub fn is_self_type_access(&mut self, name: NodeId, parent: SymbolId) -> bool {
        let a = self.ast;
        a.kind(name) == Kind::ThisKeyword
            || !parent.is_nil()
                && is_entity_name_expression(a, name)
                && parent == self.get_resolved_symbol(get_first_identifier(a, name))
    }

    pub fn is_assignment_to_readonly_entity(
        &mut self,
        expr: NodeId,
        symbol: SymbolId,
        assignment_kind: AssignmentKind,
    ) -> bool {
        let a = self.ast;
        if assignment_kind == AssignmentKind::NONE {
            // no assignment means it doesn't matter whether the entity is readonly
            return false;
        }
        if is_access_expression(a, expr) {
            let node = skip_parentheses(a, a.expression(expr));
            if is_identifier(a, node) {
                let expression_symbol = self.get_resolved_symbol(node);
                // CommonJS module.exports is never readonly
                if a.sym(expression_symbol)
                    .flags
                    .intersects(SymbolFlags::MODULE_EXPORTS)
                {
                    return false;
                }
            }
        }
        if self.is_readonly_symbol(symbol) {
            // Allow assignments to readonly properties within constructors of the same class declaration.
            if a.sym(symbol).flags.intersects(SymbolFlags::PROPERTY)
                && is_access_expression(a, expr)
                && a.kind(a.expression(expr)) == Kind::ThisKeyword
            {
                // Look for if this is the constructor for the class that `symbol` is a property of.
                let ctor = self.get_control_flow_container(expr);
                if ctor.is_nil() || !is_constructor_declaration(a, ctor) {
                    return true;
                }
                let value_declaration = a.sym(symbol).value_declaration;
                if !value_declaration.is_nil() {
                    let is_assignment_declaration = is_binary_expression(a, value_declaration);
                    let is_local_property_declaration =
                        a.parent(ctor) == a.parent(value_declaration);
                    let is_local_parameter_property = ctor == a.parent(value_declaration);
                    let is_local_this_property_assignment = is_assignment_declaration
                        && a.sym(a.sym(symbol).parent).value_declaration == a.parent(ctor);
                    let is_local_this_property_assignment_constructor_function =
                        is_assignment_declaration
                            && a.sym(a.sym(symbol).parent).value_declaration == ctor;
                    let is_writeable_symbol = is_local_property_declaration
                        || is_local_parameter_property
                        || is_local_this_property_assignment
                        || is_local_this_property_assignment_constructor_function;
                    return !is_writeable_symbol;
                }
            }
            return true;
        }
        if is_access_expression(a, expr) {
            // references through namespace import should be readonly
            let node = skip_parentheses(a, a.expression(expr));
            if is_identifier(a, node) {
                let expression_symbol = self.get_resolved_symbol(node);
                if a.sym(expression_symbol)
                    .flags
                    .intersects(SymbolFlags::ALIAS)
                {
                    let declaration = self.get_declaration_of_alias_symbol(expression_symbol);
                    return !declaration.is_nil() && is_namespace_import(a, declaration);
                }
            }
        }
        false
    }

    pub fn is_this_property_access_in_constructor(&mut self, node: NodeId, prop: SymbolId) -> bool {
        let a = self.ast;
        let mut constructor = NodeId::NIL;
        let (kind, location) = self.is_constructor_declared_this_property(prop);
        if kind == ThisAssignmentDeclarationKind::CONSTRUCTOR {
            constructor = location;
        } else if is_this_property(a, node) && self.is_auto_typed_property(prop) {
            constructor = self.get_declaring_constructor(prop);
        }
        get_this_container(a, node, true, false) == constructor
    }

    pub fn is_auto_typed_property(&self, symbol: SymbolId) -> bool {
        let a = self.ast;
        // A property is auto-typed when its declaration has no type annotation or initializer and we're in noImplicitAny mode or a .js file.
        let declaration = a.sym(symbol).value_declaration;
        !declaration.is_nil()
            && is_property_declaration(a, declaration)
            && a.type_node(declaration).is_nil()
            && a.initializer(declaration).is_nil()
            && self.no_implicit_any
    }

    pub fn get_declaring_constructor(&self, symbol: SymbolId) -> NodeId {
        let a = self.ast;
        for &declaration in a.sym(symbol).declarations.as_slice() {
            let container = get_this_container(a, declaration, false, false);
            if !container.is_nil() && is_constructor_declaration(a, container) {
                return container;
            }
        }
        NodeId::NIL
    }

    pub fn get_property_name_from_index(
        &mut self,
        index_type: TypeId,
        access_node: NodeId,
    ) -> Vec<u8> {
        let a = self.ast;
        if is_type_usable_as_property_name(self, index_type) {
            let name = get_property_name_from_type(self, index_type);
            let mut result: Vec<u8> = Vec::with_capacity(name.len());
            result.extend_from_slice(&name);
            return result;
        }
        if !access_node.is_nil() && is_property_name(a, access_node) {
            return get_property_name_for_property_name_node(a, access_node).into_owned();
        }
        INTERNAL_SYMBOL_NAME_MISSING.to_vec()
    }

    // The field `isStringIndexSignatureOnlyType` of upstream's Checker holds the method value `isStringIndexSignatureOnlyTypeWorker` (checker.go:1260).
    pub fn is_string_index_signature_only_type(&mut self, t: TypeId) -> bool {
        self.is_string_index_signature_only_type_worker(t)
    }

    pub fn is_string_index_signature_only_type_worker(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let flags = self.types[t].flags;
        flags.intersects(TypeFlags::OBJECT)
            && !self.is_generic_mapped_type(t)
            && self.get_properties_of_type(t).len() == 0
            && self.get_index_infos_of_type(t).len() == 1
            && !self.get_index_info_of_type(t, self.string_type).is_nil()
            || flags.intersects(TypeFlags::UNION_OR_INTERSECTION)
                && self
                    .type_types(t)
                    .as_slice()
                    .iter()
                    .all(|&u| self.is_string_index_signature_only_type(u))
    }

    pub fn should_defer_indexed_access_type(
        &mut self,
        object_type: TypeId,
        index_type: TypeId,
        access_node: NodeId,
    ) -> bool {
        let a = self.ast;
        if self.is_generic_index_type(index_type) {
            return true;
        }
        if !access_node.is_nil() && !is_indexed_access_type_node(a, access_node) {
            return self.is_generic_tuple_type(object_type) && {
                let limit = get_total_fixed_element_count(self.type_target_tuple_type(object_type));
                !index_type_less_than(self, index_type, limit)
            };
        }
        self.is_generic_object_type(object_type)
            && !(is_tuple_type(self, object_type) && {
                let limit = get_total_fixed_element_count(self.type_target_tuple_type(object_type));
                index_type_less_than(self, index_type, limit)
            })
            || self.is_generic_reducible_type(object_type)
    }
}

pub fn index_type_less_than(c: &mut Checker<'_>, index_type: TypeId, limit: isize) -> bool {
    every_type(c, index_type, &mut |c, t| {
        if c.types[t]
            .flags
            .intersects(TypeFlags::STRING_OR_NUMBER_LITERAL)
        {
            let prop_name = get_property_name_from_type(c, t);
            if is_numeric_literal_name(&prop_name) {
                let index = jsnum::from_string(&prop_name);
                return index.0 >= 0.0 && index.0 < limit as f64;
            }
        }
        false
    })
}

impl<'a> Checker<'a> {
    pub fn get_no_infer_type(&mut self, t: TypeId) -> TypeId {
        if self.is_no_infer_target_type(t) {
            return self.get_or_create_substitution_type(t, self.unknown_type);
        }
        t
    }

    pub fn is_no_infer_target_type(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        // This is effectively a more conservative and predictable form of couldContainTypeVariables. We want to preserve NoInfer<T> only for types that could contain type variables, but we don't want to exhaustively examine all object type members.
        let flags = self.types[t].flags;
        flags.intersects(TypeFlags::UNION_OR_INTERSECTION)
            && self
                .as_union_or_intersection_type(t)
                .types
                .as_slice()
                .iter()
                .any(|&u| self.is_no_infer_target_type(u))
            || flags.intersects(TypeFlags::SUBSTITUTION)
                && !self.is_no_infer_type(t)
                && self.is_no_infer_target_type(self.as_substitution_type(t).base_type)
            || flags.intersects(TypeFlags::OBJECT) && !self.is_empty_anonymous_object_type(t)
            || flags.intersects(TypeFlags::INSTANTIABLE.without(TypeFlags::SUBSTITUTION))
                && !self.is_pattern_literal_type(t)
    }

    pub fn get_substitution_type(&mut self, base_type: TypeId, constraint: TypeId) -> TypeId {
        if self.types[constraint]
            .flags
            .intersects(TypeFlags::ANY_OR_UNKNOWN)
            || constraint == base_type
            || self.types[base_type].flags.intersects(TypeFlags::ANY)
        {
            return base_type;
        }
        self.get_or_create_substitution_type(base_type, constraint)
    }

    pub fn get_or_create_substitution_type(
        &mut self,
        base_type: TypeId,
        constraint: TypeId,
    ) -> TypeId {
        let key = SubstitutionTypeKey {
            base_id: base_type,
            constraint_id: constraint,
        };
        let cached = self.substitution_types.get(&key);
        if !cached.is_nil() {
            return cached;
        }
        let result = self.new_substitution_type(base_type, constraint);
        let ok = self.substitution_types.set(key, result);
        self.map_set(ok);
        result
    }
}
