// checker.go:18960-20113 (layers T-LOOKUP, T-MEMBERS, T-BASE, T-SIGINST, T-SIGDECL): properties, signatures and index infos of types, resolution of the members of structured types, base types of classes and interfaces, instantiations, clones, erasures and canonical forms of signatures, the single signature of a type, inherited and declared members, index infos of symbols, signatures of symbols and declarations, and late-bindable names.
use crate::ast::{
    Arg, Ast, DiagnosticId, INTERNAL_SYMBOL_NAME_CALL, INTERNAL_SYMBOL_NAME_INDEX,
    INTERNAL_SYMBOL_NAME_NEW, INTERNAL_SYMBOL_NAME_THIS, Kind, ModifierFlags, NodeFlags, NodeId,
    SymbolFlags, SymbolId, SymbolTableId, get_class_extends_heritage_element,
    get_class_like_declaration_of_symbol, get_declaration_of_kind,
    get_extends_heritage_clause_elements, get_immediately_invoked_function_expression,
    get_name_of_declaration, get_this_parameter, has_dynamic_name, has_modifier,
    has_syntactic_modifier, is_arrow_function, is_binary_expression, is_binding_pattern,
    is_class_declaration, is_computed_property_name, is_construct_signature_declaration,
    is_constructor_declaration, is_constructor_type_node, is_element_access_expression,
    is_entity_name_expression, is_function_declaration, is_function_expression, is_function_like,
    is_get_accessor_declaration, is_in_js_file, is_index_signature_declaration,
    is_interface_declaration, is_method_or_accessor, is_set_accessor_declaration,
};
use crate::checker::{
    CachedSignatureKey, Checker, ContextFlags, ElementFlags, IndexInfoId, InferenceContextId,
    InferenceFlags, InferencePriority, ObjectFlags, SignatureFlags, SignatureId, SignatureKind,
    TypeAliasId, TypeComparer, TypeFlags, TypeFormatFlags, TypeId, TypeMapperId, TypePredicateId,
    TypeSystemEntity, TypeSystemPropertyName, UnionReduction, for_each_type,
    get_string_literal_value, get_type_list_key, has_readonly_modifier, has_rest_parameter,
    is_known_symbol, is_late_bound_name, is_numeric_literal_name, is_optional_declaration,
    is_rest_parameter, is_static_private_identifier_property, is_type_usable_as_property_name,
    new_array_to_single_type_mapper, new_type_mapper, signature_key_base, signature_key_canonical,
    signature_key_erased,
};
use crate::collections::Set;
use crate::core::{List, Text, append_if_unique, every, last_or_nil, same, some};
use crate::diagnostics::{self, MessageId};

impl<'a> Checker<'a> {
    pub fn get_properties_of_type(&mut self, t: TypeId) -> List<'a, SymbolId> {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let t = self.get_reduced_apparent_type(t);
        if self.types[t]
            .flags
            .intersects(TypeFlags::UNION_OR_INTERSECTION)
        {
            return self.get_properties_of_union_or_intersection_type(t);
        }
        self.get_properties_of_object_type(t)
    }

    pub fn get_properties_of_object_type(&mut self, t: TypeId) -> List<'a, SymbolId> {
        if self.types[t].flags.intersects(TypeFlags::OBJECT) {
            let resolved = self.resolve_structured_type_members(t);
            return self.as_structured_type(resolved).properties;
        }
        List::NIL
    }

    pub fn get_properties_of_union_or_intersection_type(
        &mut self,
        t: TypeId,
    ) -> List<'a, SymbolId> {
        let a = self.ast;
        if self
            .as_union_or_intersection_type(t)
            .resolved_properties
            .is_nil()
        {
            let mut checked: Set<Text<'a>> = Set::default();
            let mut props: Vec<SymbolId> = Vec::new();
            let types = self.as_union_or_intersection_type(t).types;
            for &current in types.as_slice() {
                let properties = self.get_properties_of_type(current);
                for &prop in properties.as_slice() {
                    let name = a.sym(prop).name;
                    if !checked.has(&name) {
                        checked.add(name);
                        let skip_object_function_property_augment =
                            self.types[t].flags.intersects(TypeFlags::INTERSECTION);
                        let combined_prop = self.get_property_of_union_or_intersection_type(
                            t,
                            name,
                            skip_object_function_property_augment,
                        );
                        if !combined_prop.is_nil() {
                            props.push(combined_prop);
                        }
                    }
                }
                // The properties of a union type are those that are present in all constituent types, so we only need to check the properties of the first type without index signature
                if self.types[t].flags.intersects(TypeFlags::UNION)
                    && self.get_index_infos_of_type(current).len() == 0
                {
                    break;
                }
            }
            // The computed list is never nil: nil is the state before the properties are resolved.
            let props = self.list_of(&props);
            self.as_union_or_intersection_type_mut(t)
                .resolved_properties = props;
        }
        self.as_union_or_intersection_type(t).resolved_properties
    }

    pub fn get_property_of_type(&mut self, t: TypeId, name: &[u8]) -> SymbolId {
        self.get_property_of_type_ex(t, name, false, false)
    }

    // Return the symbol for the property with the given name in the given type. Creates synthetic union properties when necessary, maps primitive types and type parameters are to their apparent types, and augments with properties from Object and Function as appropriate.
    pub fn get_property_of_type_ex(
        &mut self,
        t: TypeId,
        name: &[u8],
        skip_object_function_property_augment: bool,
        include_type_only_members: bool,
    ) -> SymbolId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let t = self.get_reduced_apparent_type(t);
        let flags = self.types[t].flags;
        if flags.intersects(TypeFlags::OBJECT) {
            let resolved = self.resolve_structured_type_members(t);
            let members = self.as_structured_type(resolved).members;
            let mut symbol = a.table_get(members, name);
            if !symbol.is_nil() {
                let type_symbol = self.types[t].symbol;
                if !include_type_only_members
                    && !type_symbol.is_nil()
                    && a.sym(type_symbol)
                        .flags
                        .intersects(SymbolFlags::VALUE_MODULE)
                {
                    let links = self.module_symbol_links.get(type_symbol);
                    if !self.module_symbol_links[links]
                        .type_only_export_star_map
                        .get(&name)
                        .is_nil()
                    {
                        // If this is the type of a module, `resolved.members.get(name)` might have effectively skipped over an `export type * from './foo'`, leaving `symbolIsValue` unable to see that the symbol is being viewed through a type-only export.
                        return SymbolId::NIL;
                    }
                }
                if self.symbol_is_value_ex(symbol, include_type_only_members) {
                    return symbol;
                }
            }
            if skip_object_function_property_augment {
                return SymbolId::NIL;
            }
            let mut function_type = TypeId::NIL;
            if t == self.any_function_type {
                function_type = self.global_function_type;
            } else if self.as_structured_type(resolved).call_signatures().len() != 0 {
                function_type = self.global_callable_function_type;
            } else if self
                .as_structured_type(resolved)
                .construct_signatures()
                .len()
                != 0
            {
                function_type = self.global_newable_function_type;
            }
            if !function_type.is_nil() {
                symbol = self.get_property_of_object_type(function_type, name);
                if !symbol.is_nil() {
                    return symbol;
                }
            }
            return self.get_property_of_object_type(self.global_object_type, name);
        }
        if flags.intersects(TypeFlags::INTERSECTION) {
            let prop = self.get_property_of_union_or_intersection_type(t, name, true);
            if !prop.is_nil() {
                return prop;
            }
            if !skip_object_function_property_augment {
                return self.get_property_of_union_or_intersection_type(
                    t,
                    name,
                    skip_object_function_property_augment,
                );
            }
            return SymbolId::NIL;
        }
        if flags.intersects(TypeFlags::UNION) {
            return self.get_property_of_union_or_intersection_type(
                t,
                name,
                skip_object_function_property_augment,
            );
        }
        SymbolId::NIL
    }

    // Return the type of the given property in the given type, or nil if no such property exists
    pub fn get_type_of_property_of_type(&mut self, t: TypeId, name: &[u8]) -> TypeId {
        let prop = self.get_property_of_type(t, name);
        if !prop.is_nil() {
            return self.get_type_of_symbol(prop);
        }
        TypeId::NIL
    }

    pub fn get_signatures_of_type(
        &mut self,
        t: TypeId,
        kind: SignatureKind,
    ) -> List<'a, SignatureId> {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let t = self.get_reduced_apparent_type(t);
        self.get_signatures_of_structured_type(t, kind)
    }

    pub fn get_signatures_of_structured_type(
        &mut self,
        t: TypeId,
        kind: SignatureKind,
    ) -> List<'a, SignatureId> {
        if !self.types[t].flags.intersects(TypeFlags::STRUCTURED_TYPE) {
            return List::NIL;
        }
        let resolved = self.resolve_structured_type_members(t);
        if kind == SignatureKind::CALL {
            return self.as_structured_type(resolved).call_signatures();
        }
        self.as_structured_type(resolved).construct_signatures()
    }

    pub fn get_index_infos_of_type(&mut self, t: TypeId) -> List<'a, IndexInfoId> {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let t = self.get_reduced_apparent_type(t);
        self.get_index_infos_of_structured_type(t)
    }

    pub fn get_index_infos_of_structured_type(&mut self, t: TypeId) -> List<'a, IndexInfoId> {
        if self.types[t].flags.intersects(TypeFlags::STRUCTURED_TYPE) {
            let resolved = self.resolve_structured_type_members(t);
            return self.as_structured_type(resolved).index_infos;
        }
        List::NIL
    }

    // Return the indexing info of the given kind in the given type. Creates synthetic union index types when necessary and maps primitive types and type parameters are to their apparent types.
    pub fn get_index_info_of_type(&mut self, t: TypeId, key_type: TypeId) -> IndexInfoId {
        let index_infos = self.get_index_infos_of_type(t);
        find_index_info(self, index_infos, key_type)
    }

    // Return the index type of the given kind in the given type. Creates synthetic union index types when necessary and maps primitive types and type parameters are to their apparent types.
    pub fn get_index_type_of_type(&mut self, t: TypeId, key_type: TypeId) -> TypeId {
        let info = self.get_index_info_of_type(t, key_type);
        if !info.is_nil() {
            return self.index_infos[info].value_type;
        }
        TypeId::NIL
    }

    pub fn get_index_type_of_type_ex(
        &mut self,
        t: TypeId,
        key_type: TypeId,
        default_type: TypeId,
    ) -> TypeId {
        let result = self.get_index_type_of_type(t, key_type);
        if !result.is_nil() {
            return result;
        }
        default_type
    }

    pub fn get_applicable_index_info(&mut self, t: TypeId, key_type: TypeId) -> IndexInfoId {
        let index_infos = self.get_index_infos_of_type(t);
        self.find_applicable_index_info(index_infos, key_type)
    }

    pub fn get_applicable_index_info_for_name(&mut self, t: TypeId, name: &[u8]) -> IndexInfoId {
        if is_late_bound_name(name) {
            return self.get_applicable_index_info(t, self.es_symbol_type);
        }
        // The name is copied into the arena only when it has no string literal type yet.
        let mut key_type = self.string_literal_types.get(&name);
        if key_type.is_nil() {
            let name = self.text(name);
            key_type = self.get_string_literal_type(name);
        }
        self.get_applicable_index_info(t, key_type)
    }

    pub fn find_applicable_index_info(
        &mut self,
        index_infos: List<'_, IndexInfoId>,
        key_type: TypeId,
    ) -> IndexInfoId {
        // Index signatures for type 'string' are considered only when no other index signatures apply.
        let mut string_index_info = IndexInfoId::NIL;
        let mut applicable_infos: Vec<IndexInfoId> = Vec::with_capacity(8);
        for &info in index_infos.as_slice() {
            let info_key_type = self.index_infos[info].key_type;
            if info_key_type == self.string_type {
                string_index_info = info;
            } else if self.is_applicable_index_type(key_type, info_key_type) {
                applicable_infos.push(info);
            }
        }
        // When more than one index signature is applicable we create a synthetic IndexInfo. Instead of computing the intersected key type, we just use unknownType for the key type as nothing actually depends on the keyType property of the returned IndexInfo.
        match applicable_infos.as_slice() {
            [] => {
                if !string_index_info.is_nil()
                    && self.is_applicable_index_type(key_type, self.string_type)
                {
                    return string_index_info;
                }
                IndexInfoId::NIL
            }
            &[info] => info,
            infos => {
                let mut is_readonly = true;
                let mut types: Vec<TypeId> = Vec::with_capacity(infos.len());
                for &info in infos {
                    types.push(self.index_infos[info].value_type);
                    if !self.index_infos[info].is_readonly {
                        is_readonly = false;
                    }
                }
                let value_type = self.get_intersection_type(List::from_slice(&types));
                self.new_index_info(
                    self.unknown_type,
                    value_type,
                    is_readonly,
                    NodeId::NIL,
                    List::NIL,
                )
            }
        }
    }

    pub fn is_applicable_index_type(&mut self, source: TypeId, target: TypeId) -> bool {
        // A 'string' index signature applies to types assignable to 'string' or 'number', and a 'number' index signature applies to types assignable to 'number', `${number}` and numeric string literal types.
        self.is_type_assignable_to(source, target)
            || target == self.string_type && self.is_type_assignable_to(source, self.number_type)
            || target == self.number_type
                && (source == self.numeric_string_type
                    || self.types[source]
                        .flags
                        .intersects(TypeFlags::STRING_LITERAL)
                        && is_numeric_literal_name(get_string_literal_value(self, source)))
    }

    pub fn resolve_structured_type_members(&mut self, t: TypeId) -> TypeId {
        if !self.types[t]
            .object_flags
            .intersects(ObjectFlags::MEMBERS_RESOLVED)
        {
            if !self.stack_check.is_safe_to_recurse() {
                let _: () = self.stack_limit();
                return t;
            }
            let flags = self.types[t].flags;
            let object_flags = self.types[t].object_flags;
            if flags.intersects(TypeFlags::OBJECT) {
                if object_flags.intersects(ObjectFlags::REFERENCE) {
                    self.resolve_type_reference_members(t);
                } else if object_flags.intersects(ObjectFlags::CLASS_OR_INTERFACE) {
                    self.resolve_class_or_interface_members(t);
                } else if object_flags.intersects(ObjectFlags::REVERSE_MAPPED) {
                    self.resolve_reverse_mapped_type_members(t);
                } else if object_flags.intersects(ObjectFlags::ANONYMOUS) {
                    self.resolve_anonymous_type_members(t);
                } else if object_flags.intersects(ObjectFlags::MAPPED) {
                    self.resolve_mapped_type_members(t);
                } else {
                    // Upstream panics: the type is given empty members so that it counts as resolved.
                    let _: () = self.fail("Unhandled case in resolveStructuredTypeMembers");
                    self.set_structured_type_members(
                        t,
                        SymbolTableId::NIL,
                        List::NIL,
                        List::NIL,
                        List::NIL,
                    );
                }
            } else if flags.intersects(TypeFlags::UNION) {
                self.resolve_union_type_members(t);
            } else if flags.intersects(TypeFlags::INTERSECTION) {
                self.resolve_intersection_type_members(t);
            } else {
                let _: () = self.fail("Unhandled case in resolveStructuredTypeMembers");
            }
        }
        t
    }

    pub fn resolve_class_or_interface_members(&mut self, t: TypeId) {
        self.resolve_object_type_members(t, t, List::NIL, List::NIL);
    }

    pub fn resolve_type_reference_members(&mut self, t: TypeId) {
        let source = self.type_target(t);
        let type_parameters = self.as_interface_type(source).all_type_parameters;
        let type_arguments = self.get_type_arguments(t);
        let mut padded_type_arguments = type_arguments;
        if type_arguments.len() == type_parameters.len() - 1 {
            let this_argument = self.list_of(&[t]);
            padded_type_arguments = self.concatenate(type_arguments, this_argument);
        }
        self.resolve_object_type_members(t, source, type_parameters, padded_type_arguments);
    }

    pub fn resolve_object_type_members(
        &mut self,
        t: TypeId,
        source: TypeId,
        type_parameters: List<'a, TypeId>,
        type_arguments: List<'a, TypeId>,
    ) {
        let a = self.ast;
        let mut mapper = TypeMapperId::NIL;
        let mut members;
        let mut call_signatures;
        let mut construct_signatures;
        let mut index_infos;
        let mut instantiated = false;
        let resolved = self.resolve_declared_members(source);
        if type_parameters.as_slice() == type_arguments.as_slice() {
            members = self.as_interface_type(resolved).declared_members;
            call_signatures = self.as_interface_type(resolved).declared_call_signatures;
            construct_signatures = self
                .as_interface_type(resolved)
                .declared_construct_signatures;
            index_infos = self.as_interface_type(resolved).declared_index_infos;
        } else {
            instantiated = true;
            mapper = new_type_mapper(self, type_parameters, type_arguments);
            let declared_members = self.as_interface_type(resolved).declared_members;
            members = self.instantiate_symbol_table(declared_members, mapper);
            let declared_call_signatures =
                self.as_interface_type(resolved).declared_call_signatures;
            call_signatures = self.instantiate_signatures(declared_call_signatures, mapper);
            let declared_construct_signatures = self
                .as_interface_type(resolved)
                .declared_construct_signatures;
            construct_signatures =
                self.instantiate_signatures(declared_construct_signatures, mapper);
            let declared_index_infos = self.as_interface_type(resolved).declared_index_infos;
            index_infos = self.instantiate_index_infos(declared_index_infos, mapper);
        }
        let base_types = self.get_base_types(source);
        if base_types.len() != 0 {
            if !instantiated {
                members = a.table_clone(members);
            }
            self.set_structured_type_members(
                t,
                members,
                call_signatures,
                construct_signatures,
                index_infos,
            );
            let this_argument = last_or_nil(type_arguments.as_slice());
            self.types[t].object_flags |= ObjectFlags::UNRESOLVED_MEMBERS;
            for &base_type in base_types.as_slice() {
                let mut instantiated_base_type = base_type;
                if !this_argument.is_nil() {
                    let instantiated = self.instantiate_type(base_type, mapper);
                    instantiated_base_type =
                        self.get_type_with_this_argument(instantiated, this_argument, false);
                }
                let base_properties = self.get_properties_of_type(instantiated_base_type);
                members = self.add_inherited_members(members, base_properties);
                let base_call_signatures =
                    self.get_signatures_of_type(instantiated_base_type, SignatureKind::CALL);
                call_signatures = self.concatenate(call_signatures, base_call_signatures);
                let base_construct_signatures =
                    self.get_signatures_of_type(instantiated_base_type, SignatureKind::CONSTRUCT);
                construct_signatures =
                    self.concatenate(construct_signatures, base_construct_signatures);
                let inherited_index_infos = if instantiated_base_type != self.any_type {
                    self.get_index_infos_of_type(instantiated_base_type)
                } else {
                    self.list_of(&[self.any_base_type_index_info])
                };
                let own_index_infos = index_infos;
                let inherited_index_infos = self.filter(inherited_index_infos, |c, info| {
                    find_index_info(c, own_index_infos, c.index_infos[info].key_type).is_nil()
                });
                index_infos = self.concatenate(index_infos, inherited_index_infos);
            }
            let object_flags = self.types[t]
                .object_flags
                .without(ObjectFlags::UNRESOLVED_MEMBERS);
            self.types[t].object_flags = object_flags;
        }
        self.set_structured_type_members(
            t,
            members,
            call_signatures,
            construct_signatures,
            index_infos,
        );
    }
}

pub fn find_index_info(
    c: &Checker<'_>,
    index_infos: List<'_, IndexInfoId>,
    key_type: TypeId,
) -> IndexInfoId {
    for &info in index_infos.as_slice() {
        if c.index_infos[info].key_type == key_type {
            return info;
        }
    }
    IndexInfoId::NIL
}

impl<'a> Checker<'a> {
    pub fn get_base_types(&mut self, t: TypeId) -> List<'a, TypeId> {
        if !self.types[t]
            .object_flags
            .intersects(ObjectFlags::CLASS_OR_INTERFACE | ObjectFlags::TUPLE)
        {
            return List::NIL;
        }
        let a = self.ast;
        if !self.as_interface_type(t).base_types_resolved {
            if !self.stack_check.is_safe_to_recurse() {
                return self.stack_limit();
            }
            if !self.push_type_resolution(
                TypeSystemEntity::Type(t),
                TypeSystemPropertyName::ResolvedBaseTypes,
            ) {
                return self.as_interface_type(t).resolved_base_types;
            }
            let symbol = self.types[t].symbol;
            if self.types[t].object_flags.intersects(ObjectFlags::TUPLE) {
                let tuple_base_type = self.get_tuple_base_type(t);
                let resolved_base_types = self.list_of(&[tuple_base_type]);
                self.as_interface_type_mut(t).resolved_base_types = resolved_base_types;
            } else if a
                .sym(symbol)
                .flags
                .intersects(SymbolFlags::CLASS | SymbolFlags::INTERFACE)
            {
                if a.sym(symbol).flags.intersects(SymbolFlags::CLASS) {
                    self.resolve_base_types_of_class(t);
                }
                if a.sym(symbol).flags.intersects(SymbolFlags::INTERFACE) {
                    self.resolve_base_types_of_interface(t);
                }
            } else {
                let _: () = self.fail("Unhandled case in getBaseTypes");
            }
            if !self.pop_type_resolution() && !a.sym(symbol).declarations.is_nil() {
                for &declaration in a.sym(symbol).declarations.as_slice() {
                    if is_class_declaration(a, declaration)
                        || is_interface_declaration(a, declaration)
                    {
                        self.report_circular_base_type(declaration, t);
                    }
                }
            }
            // In general, base type resolution always precedes member resolution. However, it is possible for resolution of type parameter defaults to cause circularity errors, possibly leaving members partially resolved. Here we ensure any such partial resolution is reset. See https://github.com/microsoft/TypeScript/issues/16861 for an example.
            let object_flags = self.types[t]
                .object_flags
                .without(ObjectFlags::MEMBERS_RESOLVED);
            self.types[t].object_flags = object_flags;
            self.as_interface_type_mut(t).base_types_resolved = true;
        }
        self.as_interface_type(t).resolved_base_types
    }

    pub fn get_tuple_base_type(&mut self, t: TypeId) -> TypeId {
        let type_parameters = self.as_interface_type(t).type_parameters();
        let element_infos = self.as_tuple_type(t).element_infos;
        let mut element_types: Vec<TypeId> = Vec::with_capacity(type_parameters.as_slice().len());
        for (i, &tp) in type_parameters.as_slice().iter().enumerate() {
            if element_infos.at(i).flags.intersects(ElementFlags::VARIADIC) {
                let element_type = self.get_indexed_access_type(tp, self.number_type);
                element_types.push(element_type);
            } else {
                element_types.push(tp);
            }
        }
        let element_type = self.get_union_type(List::from_slice(&element_types));
        let readonly = self.as_tuple_type(t).readonly;
        self.create_array_type_ex(element_type, readonly)
    }

    pub fn resolve_base_types_of_class(&mut self, t: TypeId) {
        let a = self.ast;
        let base_constructor_type = self.get_base_constructor_type_of_class(t);
        let base_constructor_type = self.get_apparent_type(base_constructor_type);
        if !self.types[base_constructor_type]
            .flags
            .intersects(TypeFlags::OBJECT | TypeFlags::INTERSECTION | TypeFlags::ANY)
        {
            return;
        }
        let base_type_node = get_base_type_node_of_class(self, t);
        let mut original_base_type = TypeId::NIL;
        let base_constructor_symbol = self.types[base_constructor_type].symbol;
        if !base_constructor_symbol.is_nil() {
            original_base_type = self.get_declared_type_of_symbol(base_constructor_symbol);
        }
        let base_type = if !base_constructor_symbol.is_nil()
            && a.sym(base_constructor_symbol)
                .flags
                .intersects(SymbolFlags::CLASS)
            && self.are_all_outer_type_parameters_applied(original_base_type)
        {
            // When base constructor type is a class with no captured type arguments we know that the constructors all have the same type parameters as the class and all return the instance type of the class. There is no need for further checks and we can apply the type arguments in the same manner as a type reference to get the same error reporting experience.
            self.get_type_from_class_or_interface_reference(base_type_node, base_constructor_symbol)
        } else if self.types[base_constructor_type]
            .flags
            .intersects(TypeFlags::ANY)
        {
            base_constructor_type
        } else {
            // The class derives from a "class-like" constructor function, check that we have at least one construct signature with a matching number of type parameters and use the return type of the first instantiated signature. Elsewhere we check that all instantiated signatures return the same type.
            let constructors = self.get_instantiated_constructors_for_type_arguments(
                base_constructor_type,
                a.type_arguments(base_type_node),
                base_type_node,
            );
            if constructors.len() == 0 {
                self.error(
                    a.expression(base_type_node),
                    diagnostics::NO_BASE_CONSTRUCTOR_HAS_THE_SPECIFIED_NUMBER_OF_TYPE_ARGUMENTS,
                    &[],
                );
                return;
            }
            self.get_return_type_of_signature(constructors.at(0usize))
        };
        if self.is_error_type(base_type) {
            return;
        }
        let reduced_base_type = self.get_reduced_type(base_type);
        if !self.is_valid_base_type(reduced_base_type) {
            let error_node = a.expression(base_type_node);
            let diagnostic =
                self.elaborate_never_intersection(DiagnosticId::NIL, error_node, base_type);
            let type_name = self.type_to_string_exported(reduced_base_type);
            let diagnostic = self.new_diagnostic_chain_for_node(diagnostic, error_node, diagnostics::BASE_CONSTRUCTOR_RETURN_TYPE_0_IS_NOT_AN_OBJECT_TYPE_OR_INTERSECTION_OF_OBJECT_TYPES_WITH_STATICALLY_KNOWN_MEMBERS, &[Arg::Str(&type_name)]);
            self.add_diagnostic(diagnostic);
            return;
        }
        if t == reduced_base_type || self.has_base_type(reduced_base_type, t) {
            let symbol = self.types[t].symbol;
            let type_name = self.type_to_string_exported(t);
            self.error(
                a.sym(symbol).value_declaration,
                diagnostics::TYPE_0_RECURSIVELY_REFERENCES_ITSELF_AS_A_BASE_TYPE,
                &[Arg::Str(&type_name)],
            );
            return;
        }
        let resolved_base_types = self.list_of(&[reduced_base_type]);
        self.as_interface_type_mut(t).resolved_base_types = resolved_base_types;
    }
}

pub fn get_base_type_node_of_class(c: &Checker<'_>, t: TypeId) -> NodeId {
    let a = c.ast;
    let decl = get_class_like_declaration_of_symbol(a, c.types[t].symbol);
    if !decl.is_nil() {
        return get_class_extends_heritage_element(a, decl);
    }
    NodeId::NIL
}

impl<'a> Checker<'a> {
    pub fn get_instantiated_constructors_for_type_arguments(
        &mut self,
        t: TypeId,
        type_argument_nodes: List<'_, NodeId>,
        location: NodeId,
    ) -> List<'a, SignatureId> {
        let a = self.ast;
        let signatures = self.get_constructors_for_type_arguments(t, type_argument_nodes, location);
        let type_arguments = self.map_list(type_argument_nodes, |c, type_node| {
            c.get_type_from_type_node(type_node)
        });
        self.same_map(signatures, |c, sig| {
            if c.signatures[sig].type_parameters.len() != 0 {
                return c.get_signature_instantiation(
                    sig,
                    type_arguments,
                    is_in_js_file(a, location),
                    List::NIL,
                );
            }
            sig
        })
    }

    pub fn get_constructors_for_type_arguments(
        &mut self,
        t: TypeId,
        type_argument_nodes: List<'_, NodeId>,
        _location: NodeId,
    ) -> List<'a, SignatureId> {
        let type_arg_count = type_argument_nodes.len();
        let signatures = self.get_signatures_of_type(t, SignatureKind::CONSTRUCT);
        self.filter(signatures, |c, sig| {
            let type_parameters = c.signatures[sig].type_parameters;
            type_arg_count >= c.get_min_type_argument_count(type_parameters)
                && type_arg_count <= type_parameters.len()
        })
    }

    pub fn get_signature_instantiation(
        &mut self,
        sig: SignatureId,
        type_arguments: List<'a, TypeId>,
        is_java_script: bool,
        inferred_type_parameters: List<'a, TypeId>,
    ) -> SignatureId {
        let type_parameters = self.signatures[sig].type_parameters;
        let min_type_argument_count = self.get_min_type_argument_count(type_parameters);
        let filled_type_arguments = self.fill_missing_type_arguments(
            type_arguments,
            type_parameters,
            min_type_argument_count,
            is_java_script,
        );
        let instantiated_signature = self
            .get_signature_instantiation_without_filling_in_type_arguments(
                sig,
                filled_type_arguments,
            );
        if inferred_type_parameters.len() != 0 {
            let return_type = self.get_return_type_of_signature(instantiated_signature);
            let return_signature = self.get_single_call_or_construct_signature(return_type);
            if !return_signature.is_nil() {
                let new_return_signature = self.clone_signature(return_signature);
                self.signatures[new_return_signature].type_parameters = inferred_type_parameters;
                let new_return_type = self.get_or_create_type_from_signature(new_return_signature);
                let mapper = self.signatures[instantiated_signature].mapper;
                self.as_object_type_mut(new_return_type).mapper = mapper;
                let new_instantiated_signature = self.clone_signature(instantiated_signature);
                self.signatures[new_instantiated_signature].resolved_return_type = new_return_type;
                return new_instantiated_signature;
            }
        }
        instantiated_signature
    }

    pub fn clone_signature(&mut self, sig: SignatureId) -> SignatureId {
        let flags = self.signatures[sig].flags & SignatureFlags::PROPAGATING_FLAGS;
        let declaration = self.signatures[sig].declaration;
        let type_parameters = self.signatures[sig].type_parameters;
        let this_parameter = self.signatures[sig].this_parameter;
        let parameters = self.signatures[sig].parameters;
        let min_argument_count = self.signatures[sig].min_argument_count as isize;
        let result = self.new_signature(
            flags,
            declaration,
            type_parameters,
            this_parameter,
            parameters,
            TypeId::NIL,
            TypePredicateId::NIL,
            min_argument_count,
        );
        let target = self.signatures[sig].target;
        let mapper = self.signatures[sig].mapper;
        let composite = self.signatures[sig].composite;
        self.signatures[result].target = target;
        self.signatures[result].mapper = mapper;
        self.signatures[result].composite = composite;
        result
    }

    pub fn get_signature_instantiation_without_filling_in_type_arguments(
        &mut self,
        sig: SignatureId,
        type_arguments: List<'a, TypeId>,
    ) -> SignatureId {
        let key = CachedSignatureKey {
            sig,
            key: get_type_list_key(type_arguments),
        };
        let mut instantiation = self.cached_signatures.get(&key);
        if instantiation.is_nil() {
            instantiation = self.create_signature_instantiation(sig, type_arguments);
            let ok = self.cached_signatures.set(key, instantiation);
            self.map_set(ok);
        }
        instantiation
    }

    pub fn create_signature_instantiation(
        &mut self,
        sig: SignatureId,
        type_arguments: List<'a, TypeId>,
    ) -> SignatureId {
        let mapper = self.create_signature_type_mapper(sig, type_arguments);
        self.instantiate_signature_ex(sig, mapper, true)
    }

    pub fn create_signature_type_mapper(
        &mut self,
        sig: SignatureId,
        type_arguments: List<'a, TypeId>,
    ) -> TypeMapperId {
        let type_parameters = self.get_type_parameters_for_mapper(sig);
        new_type_mapper(self, type_parameters, type_arguments)
    }

    pub fn get_type_parameters_for_mapper(&mut self, sig: SignatureId) -> List<'a, TypeId> {
        let type_parameters = self.signatures[sig].type_parameters;
        self.same_map(type_parameters, |c, tp| {
            let mapper = c.type_mapper(tp);
            c.instantiate_type(tp, mapper)
        })
    }

    // If type has a single call signature and no other members, return that signature. Otherwise, return nil.
    pub fn get_single_call_signature(&mut self, t: TypeId) -> SignatureId {
        self.get_single_signature(t, SignatureKind::CALL, false)
    }

    pub fn get_single_call_or_construct_signature(&mut self, t: TypeId) -> SignatureId {
        let call_sig = self.get_single_signature(t, SignatureKind::CALL, false);
        if !call_sig.is_nil() {
            return call_sig;
        }
        self.get_single_signature(t, SignatureKind::CONSTRUCT, false)
    }

    pub fn get_single_signature(
        &mut self,
        t: TypeId,
        kind: SignatureKind,
        allow_members: bool,
    ) -> SignatureId {
        if self.types[t].flags.intersects(TypeFlags::OBJECT) {
            let resolved = self.resolve_structured_type_members(t);
            let resolved = self.as_structured_type(resolved);
            if allow_members || resolved.properties.len() == 0 && resolved.index_infos.len() == 0 {
                let call_signatures = resolved.call_signatures();
                let construct_signatures = resolved.construct_signatures();
                if kind == SignatureKind::CALL
                    && call_signatures.len() == 1
                    && construct_signatures.len() == 0
                {
                    return call_signatures.at(0usize);
                }
                if kind == SignatureKind::CONSTRUCT
                    && construct_signatures.len() == 1
                    && call_signatures.len() == 0
                {
                    return construct_signatures.at(0usize);
                }
            }
        }
        SignatureId::NIL
    }

    pub fn get_or_create_type_from_signature(&mut self, sig: SignatureId) -> TypeId {
        // There are two ways to declare a construct signature, one is by declaring a class constructor using the constructor keyword, and the other is declaring a bare construct signature in an object type literal or interface (using the new keyword). Each way of declaring a constructor will result in a different declaration kind.
        if self.signatures[sig].isolated_signature_type.is_nil() {
            let a = self.ast;
            let declaration = self.signatures[sig].declaration;
            let mut kind = Kind::Unknown;
            if !declaration.is_nil() {
                kind = a.kind(declaration);
            }
            // If declaration is undefined, it is likely to be the signature of the default constructor.
            let is_constructor = kind == Kind::Unknown
                || kind == Kind::Constructor
                || kind == Kind::ConstructSignature
                || kind == Kind::ConstructorType;
            let mut symbol = SymbolId::NIL;
            if !declaration.is_nil() {
                symbol = a.symbol(declaration);
            }
            let t = self.new_object_type(
                ObjectFlags::ANONYMOUS | ObjectFlags::SINGLE_SIGNATURE_TYPE,
                symbol,
            );
            let signatures = self.list_of(&[sig]);
            if is_constructor {
                self.set_structured_type_members(
                    t,
                    SymbolTableId::NIL,
                    List::NIL,
                    signatures,
                    List::NIL,
                );
            } else {
                self.set_structured_type_members(
                    t,
                    SymbolTableId::NIL,
                    signatures,
                    List::NIL,
                    List::NIL,
                );
            }
            self.signatures[sig].isolated_signature_type = t;
        }
        self.signatures[sig].isolated_signature_type
    }

    pub fn get_erased_signature(&mut self, signature: SignatureId) -> SignatureId {
        let type_parameters = self.signatures[signature].type_parameters;
        if type_parameters.len() == 0 {
            return signature;
        }
        let key = CachedSignatureKey {
            sig: signature,
            key: signature_key_erased(),
        };
        let mut erased = self.cached_signatures.get(&key);
        if erased.is_nil() {
            let any_type = self.any_type;
            let mapper = new_array_to_single_type_mapper(self, type_parameters, any_type);
            erased = self.instantiate_signature_ex(signature, mapper, true);
            let ok = self.cached_signatures.set(key, erased);
            self.map_set(ok);
        }
        erased
    }

    pub fn get_canonical_signature(&mut self, signature: SignatureId) -> SignatureId {
        if self.signatures[signature].type_parameters.len() == 0 {
            return signature;
        }
        let key = CachedSignatureKey {
            sig: signature,
            key: signature_key_canonical(),
        };
        let mut canonical = self.cached_signatures.get(&key);
        if canonical.is_nil() {
            canonical = self.create_canonical_signature(signature);
            let ok = self.cached_signatures.set(key, canonical);
            self.map_set(ok);
        }
        canonical
    }

    pub fn create_canonical_signature(&mut self, signature: SignatureId) -> SignatureId {
        // Create an instantiation of the signature where each unconstrained type parameter is replaced with its original. When a generic class or interface is instantiated, each generic method in the class or interface is instantiated with a fresh set of cloned type parameters (which we need to handle scenarios where different generations of the same type parameter are in scope). This leads to a lot of new type identities, and potentially a lot of work comparing those identities, so here we create an instantiation that uses the original type identities for all unconstrained type parameters.
        let type_parameters = self.signatures[signature].type_parameters;
        let type_arguments = self.map_list(type_parameters, |c, tp| {
            let target = c.type_target(tp);
            if !target.is_nil() && c.get_constraint_of_type_parameter(target).is_nil() {
                return target;
            }
            tp
        });
        let is_java_script = is_in_js_file(self.ast, self.signatures[signature].declaration);
        self.get_signature_instantiation(signature, type_arguments, is_java_script, List::NIL)
    }

    pub fn get_base_signature(&mut self, signature: SignatureId) -> SignatureId {
        let type_parameters = self.signatures[signature].type_parameters;
        if type_parameters.len() == 0 {
            return signature;
        }
        let key = CachedSignatureKey {
            sig: signature,
            key: signature_key_base(),
        };
        let cached = self.cached_signatures.get(&key);
        if !cached.is_nil() {
            return cached;
        }
        let constraints = self.map_list(type_parameters, |c, tp| {
            let constraint = c.get_constraint_of_type_parameter(tp);
            if !constraint.is_nil() {
                return constraint;
            }
            c.unknown_type
        });
        let base_constraint_mapper = new_type_mapper(self, type_parameters, constraints);
        let mut base_constraints = self.map_list(type_parameters, |c, tp| {
            c.instantiate_type(tp, base_constraint_mapper)
        });
        // Run the immediate constraint mapper N-1 times so non-circular interdependent type parameters resolve to their external dependencies without adding an extra expansion step for self-recursive constraints.
        let mut i = 0;
        while i < type_parameters.len() - 1 {
            base_constraints = self.instantiate_types(base_constraints, base_constraint_mapper);
            i += 1;
        }
        // and then apply a type eraser to remove any remaining circularly dependent type parameters
        let any_type = self.any_type;
        let eraser = new_array_to_single_type_mapper(self, type_parameters, any_type);
        base_constraints = self.instantiate_types(base_constraints, eraser);
        let mapper = new_type_mapper(self, type_parameters, base_constraints);
        let result = self.instantiate_signature_ex(signature, mapper, true);
        let ok = self.cached_signatures.set(key, result);
        self.map_set(ok);
        result
    }

    // Instantiate a generic signature in the context of a non-generic signature (section 3.8.5 in TypeScript spec)
    pub fn instantiate_signature_in_context_of(
        &mut self,
        signature: SignatureId,
        contextual_signature: SignatureId,
        inference_context: InferenceContextId,
        compare_types: TypeComparer,
    ) -> SignatureId {
        let type_parameters = self.get_type_parameters_for_mapper(signature);
        let context = self.new_inference_context(
            type_parameters,
            signature,
            InferenceFlags::NONE,
            compare_types,
        );
        // We clone the inferenceContext to avoid fixing. For example, when the source signature is <T>(x: T) => T[] and the contextual signature is (...args: A) => B, we want to infer the element type of A's constraint (say 'any') for T but leave it possible to later infer '[any]' back to A.
        let rest_type = self.get_effective_rest_type(contextual_signature);
        let mut mapper = TypeMapperId::NIL;
        if !inference_context.is_nil() {
            if !rest_type.is_nil()
                && self.types[rest_type]
                    .flags
                    .intersects(TypeFlags::TYPE_PARAMETER)
            {
                mapper = self.inference_contexts[inference_context].non_fixing_mapper;
            } else {
                mapper = self.inference_contexts[inference_context].mapper;
            }
        }
        let source_signature = if !mapper.is_nil() {
            self.instantiate_signature(contextual_signature, mapper)
        } else {
            contextual_signature
        };
        self.apply_to_parameter_types(source_signature, signature, &mut |c, source, target| {
            // Type parameters from outer context referenced by source type are fixed by instantiation of the source type
            let inferences = c.inference_contexts[context].inferences;
            c.infer_types(inferences, source, target, InferencePriority::NONE, false);
        });
        if inference_context.is_nil() {
            self.apply_to_return_types(
                contextual_signature,
                signature,
                &mut |c, source, target| {
                    let inferences = c.inference_contexts[context].inferences;
                    c.infer_types(
                        inferences,
                        source,
                        target,
                        InferencePriority::RETURN_TYPE,
                        false,
                    );
                },
            );
        }
        let inferred_types = self.get_inferred_types(context);
        let is_java_script =
            is_in_js_file(self.ast, self.signatures[contextual_signature].declaration);
        self.get_signature_instantiation(signature, inferred_types, is_java_script, List::NIL)
    }

    pub fn resolve_base_types_of_interface(&mut self, t: TypeId) {
        let a = self.ast;
        let symbol = self.types[t].symbol;
        for &declaration in a.sym(symbol).declarations.as_slice() {
            if is_interface_declaration(a, declaration) {
                for &node in get_extends_heritage_clause_elements(a, declaration) {
                    let base_type = self.get_type_from_type_node(node);
                    let base_type = self.get_reduced_type(base_type);
                    if !self.is_error_type(base_type) {
                        if self.is_valid_base_type(base_type) {
                            if t != base_type && !self.has_base_type(base_type, t) {
                                // `append(data.resolvedBaseTypes, baseType)`: a holder of the list as it was keeps seeing the bases resolved so far.
                                let mut resolved_base_types: Vec<TypeId> = self
                                    .as_interface_type(t)
                                    .resolved_base_types
                                    .as_slice()
                                    .to_vec();
                                resolved_base_types.push(base_type);
                                let resolved_base_types = self.list_of(&resolved_base_types);
                                self.as_interface_type_mut(t).resolved_base_types =
                                    resolved_base_types;
                            } else {
                                self.report_circular_base_type(declaration, t);
                            }
                        } else {
                            self.error(node, diagnostics::AN_INTERFACE_CAN_ONLY_EXTEND_AN_OBJECT_TYPE_OR_INTERSECTION_OF_OBJECT_TYPES_WITH_STATICALLY_KNOWN_MEMBERS, &[]);
                        }
                    }
                }
            }
        }
    }

    pub fn are_all_outer_type_parameters_applied(&mut self, t: TypeId) -> bool {
        // An unapplied type parameter has its symbol still the same as the matching argument symbol. Since parameters are applied outer-to-inner, only the last outer parameter needs to be checked.
        let outer_type_parameters = self.as_interface_type(t).outer_type_parameters();
        if outer_type_parameters.len() != 0 {
            let last = outer_type_parameters.len() - 1;
            let type_arguments = self.get_type_arguments(t);
            return self.types[outer_type_parameters.at(last)].symbol
                != self.types[type_arguments.at(last)].symbol;
        }
        true
    }

    pub fn report_circular_base_type(&mut self, node: NodeId, t: TypeId) {
        let type_name = self.type_to_string_ex(
            t,
            NodeId::NIL,
            TypeFormatFlags::WRITE_ARRAY_AS_GENERIC_TYPE,
            None,
        );
        self.error(
            node,
            diagnostics::TYPE_0_RECURSIVELY_REFERENCES_ITSELF_AS_A_BASE_TYPE,
            &[Arg::Str(&type_name)],
        );
    }

    // A valid base type is `any`, an object type or intersection of object types.
    pub fn is_valid_base_type(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if self.types[t].flags.intersects(TypeFlags::TYPE_PARAMETER) {
            let constraint = self.get_base_constraint_of_type(t);
            if !constraint.is_nil() {
                return self.is_valid_base_type(constraint);
            }
        }
        // TODO: Given that we allow type parameters here now, is this `!isGenericMappedType(type)` check really needed? There's no reason a `T` should be allowed while a `Readonly<T>` should not.
        self.types[t]
            .flags
            .intersects(TypeFlags::OBJECT | TypeFlags::NON_PRIMITIVE | TypeFlags::ANY)
            && !self.is_generic_mapped_type(t)
            || self.types[t].flags.intersects(TypeFlags::INTERSECTION)
                && every(self.type_types(t).as_slice(), |u| {
                    self.is_valid_base_type(u)
                })
    }

    // TODO: GH#18217 If `checkBase` is undefined, we should not call this because this will always return false.
    pub fn has_base_type(&mut self, t: TypeId, check_base: TypeId) -> bool {
        fn check(c: &mut Checker<'_>, t: TypeId, check_base: TypeId) -> bool {
            if c.types[t]
                .object_flags
                .intersects(ObjectFlags::CLASS_OR_INTERFACE | ObjectFlags::REFERENCE)
            {
                let target = get_target_type(c, t);
                if target == check_base {
                    return true;
                }
                let base_types = c.get_base_types(target);
                return some(base_types.as_slice(), |base| check(c, base, check_base));
            }
            if c.types[t].flags.intersects(TypeFlags::INTERSECTION) {
                let types = c.type_types(t);
                return some(types.as_slice(), |u| check(c, u, check_base));
            }
            false
        }
        check(self, t, check_base)
    }
}

pub fn get_target_type(c: &Checker<'_>, t: TypeId) -> TypeId {
    if c.types[t].object_flags.intersects(ObjectFlags::REFERENCE) {
        return c.type_target(t);
    }
    t
}

impl<'a> Checker<'a> {
    pub fn get_type_with_this_argument(
        &mut self,
        t: TypeId,
        this_argument: TypeId,
        need_apparent_type: bool,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return t;
        }
        if self.types[t]
            .object_flags
            .intersects(ObjectFlags::REFERENCE)
        {
            let target = self.type_target(t);
            let type_arguments = self.get_type_arguments(t);
            if self.as_interface_type(target).type_parameters().len() == type_arguments.len() {
                let mut this_argument = this_argument;
                if this_argument.is_nil() {
                    this_argument = self.as_interface_type(target).this_type;
                }
                let this_argument = self.list_of(&[this_argument]);
                let type_arguments = self.concatenate(type_arguments, this_argument);
                return self.create_type_reference(target, type_arguments);
            }
            return t;
        } else if self.types[t].flags.intersects(TypeFlags::INTERSECTION) {
            let types = self.type_types(t);
            let new_types = self.same_map(types, |c, u| {
                c.get_type_with_this_argument(u, this_argument, need_apparent_type)
            });
            if same(new_types.as_slice(), types.as_slice()) {
                return t;
            }
            return self.get_intersection_type(new_types);
        }
        if need_apparent_type {
            return self.get_apparent_type(t);
        }
        t
    }

    pub fn add_inherited_members(
        &self,
        symbols: SymbolTableId,
        base_symbols: List<'_, SymbolId>,
    ) -> SymbolTableId {
        let a = self.ast;
        let mut symbols = symbols;
        for &base in base_symbols.as_slice() {
            if !is_static_private_identifier_property(a, base) {
                let name = a.sym(base).name;
                let s = a.table_get(symbols, name);
                if s.is_nil() || !a.sym(s).flags.intersects(SymbolFlags::VALUE) {
                    if symbols.is_nil() {
                        symbols = a.new_table();
                    }
                    a.table_set(symbols, name, base);
                }
            }
        }
        symbols
    }

    pub fn resolve_declared_members(&mut self, t: TypeId) -> TypeId {
        let a = self.ast;
        if !self.as_interface_type(t).declared_members_resolved {
            let symbol = self.types[t].symbol;
            let members = self.get_members_of_symbol(symbol);
            self.as_interface_type_mut(t).declared_members_resolved = true;
            self.as_interface_type_mut(t).declared_members = members;
            let declared_call_signatures =
                self.get_signatures_of_symbol(a.table_get(members, INTERNAL_SYMBOL_NAME_CALL));
            self.as_interface_type_mut(t).declared_call_signatures = declared_call_signatures;
            let declared_construct_signatures =
                self.get_signatures_of_symbol(a.table_get(members, INTERNAL_SYMBOL_NAME_NEW));
            self.as_interface_type_mut(t).declared_construct_signatures =
                declared_construct_signatures;
            let declared_index_infos = self.get_index_infos_of_symbol(symbol);
            self.as_interface_type_mut(t).declared_index_infos = declared_index_infos;
        }
        t
    }

    pub fn get_index_infos_of_symbol(&mut self, symbol: SymbolId) -> List<'a, IndexInfoId> {
        let a = self.ast;
        let index_symbol = self.get_index_symbol(symbol);
        if !index_symbol.is_nil() {
            let members = self.get_members_of_symbol(symbol);
            // Upstream collects the values of the members, a map: the table is read in insertion order.
            let mut sibling_symbols: Vec<SymbolId> = Vec::new();
            let mut position = 0;
            while let Some((_, sibling)) = a.table_entry_at(members, position) {
                position += 1;
                sibling_symbols.push(sibling);
            }
            return self.get_index_infos_of_index_symbol(index_symbol, &sibling_symbols);
        }
        List::NIL
    }

    // note intentional similarities to index signature building in `checkObjectLiteral` for parity
    pub fn get_index_infos_of_index_symbol(
        &mut self,
        index_symbol: SymbolId,
        sibling_symbols: &[SymbolId],
    ) -> List<'a, IndexInfoId> {
        let a = self.ast;
        let mut index_infos: Vec<IndexInfoId> = Vec::new();
        let mut has_computed_string_property = false;
        let mut has_computed_number_property = false;
        let mut has_computed_symbol_property = false;
        let mut readonly_computed_string_property = true;
        let mut readonly_computed_number_property = true;
        let mut readonly_computed_symbol_property = true;
        let mut property_symbols: Vec<SymbolId> = Vec::new();
        for &declaration in a.sym(index_symbol).declarations.as_slice() {
            if is_index_signature_declaration(a, declaration) {
                let parameters = a.parameters(declaration);
                let return_type_node = a.type_node(declaration);
                if parameters.len() == 1 {
                    let type_node = a.type_node(parameters.at(0usize));
                    if !type_node.is_nil() {
                        let mut value_type = self.any_type;
                        if !return_type_node.is_nil() {
                            value_type = self.get_type_from_type_node(return_type_node);
                        }
                        let key_types = self.get_type_from_type_node(type_node);
                        for_each_type(self, key_types, &mut |c, key_type| {
                            if c.is_valid_index_key_type(key_type)
                                && find_index_info(c, List::from_slice(&index_infos), key_type)
                                    .is_nil()
                            {
                                let index_info = c.new_index_info(
                                    key_type,
                                    value_type,
                                    has_modifier(a, declaration, ModifierFlags::READONLY),
                                    declaration,
                                    List::NIL,
                                );
                                index_infos.push(index_info);
                            }
                        });
                    }
                }
            } else if self.has_late_bindable_index_signature(declaration) {
                let decl_name = if is_binary_expression(a, declaration) {
                    a.as_binary_expression(declaration).left
                } else {
                    a.name(declaration)
                };
                let key_type = if is_element_access_expression(a, decl_name) {
                    self.check_expression_cached(
                        a.as_element_access_expression(decl_name)
                            .argument_expression,
                    )
                } else {
                    self.check_computed_property_name(decl_name)
                };
                if !find_index_info(self, List::from_slice(&index_infos), key_type).is_nil() {
                    // Explicit index for key type takes priority
                    continue;
                }
                if self.is_type_assignable_to(key_type, self.string_number_symbol_type) {
                    if self.is_type_assignable_to(key_type, self.number_type) {
                        has_computed_number_property = true;
                        if !has_readonly_modifier(a, declaration) {
                            readonly_computed_number_property = false;
                        }
                    } else if self.is_type_assignable_to(key_type, self.es_symbol_type) {
                        has_computed_symbol_property = true;
                        if !has_readonly_modifier(a, declaration) {
                            readonly_computed_symbol_property = false;
                        }
                    } else {
                        has_computed_string_property = true;
                        if !has_readonly_modifier(a, declaration) {
                            readonly_computed_string_property = false;
                        }
                    }
                    property_symbols.push(a.symbol(declaration));
                }
            }
        }
        if has_computed_string_property
            || has_computed_number_property
            || has_computed_symbol_property
        {
            for &sym in sibling_symbols {
                if sym != index_symbol {
                    property_symbols.push(sym);
                }
            }
            // aggregate similar index infos implied to be the same key to the same combined index info
            if has_computed_string_property
                && find_index_info(self, List::from_slice(&index_infos), self.string_type).is_nil()
            {
                let index_info = self.get_object_literal_index_info(
                    readonly_computed_string_property,
                    &property_symbols,
                    self.string_type,
                );
                index_infos.push(index_info);
            }
            if has_computed_number_property
                && find_index_info(self, List::from_slice(&index_infos), self.number_type).is_nil()
            {
                let index_info = self.get_object_literal_index_info(
                    readonly_computed_number_property,
                    &property_symbols,
                    self.number_type,
                );
                index_infos.push(index_info);
            }
            if has_computed_symbol_property
                && find_index_info(self, List::from_slice(&index_infos), self.es_symbol_type)
                    .is_nil()
            {
                let index_info = self.get_object_literal_index_info(
                    readonly_computed_symbol_property,
                    &property_symbols,
                    self.es_symbol_type,
                );
                index_infos.push(index_info);
            }
        }
        self.list(&index_infos)
    }

    // NOTE: currently does not make pattern literal indexers, eg `${number}px`
    pub fn get_object_literal_index_info(
        &mut self,
        is_readonly: bool,
        properties: &[SymbolId],
        key_type: TypeId,
    ) -> IndexInfoId {
        let a = self.ast;
        let mut prop_types: Vec<TypeId> = Vec::new();
        let mut components: Vec<NodeId> = Vec::new();
        for &prop in properties {
            if key_type == self.string_type && !self.is_symbol_with_symbol_name(prop)
                || key_type == self.number_type && self.is_symbol_with_numeric_name(prop)
                || key_type == self.es_symbol_type && self.is_symbol_with_symbol_name(prop)
            {
                let prop_type = self.get_type_of_symbol(prop);
                prop_types.push(prop_type);
                if self.is_symbol_with_computed_name(prop) {
                    components.push(a.sym(prop).declarations.at(0usize));
                }
            }
        }
        let mut union_type = self.undefined_type;
        if !prop_types.is_empty() {
            union_type = self.get_union_type_ex(
                List::from_slice(&prop_types),
                UnionReduction::SUBTYPE,
                TypeAliasId::NIL,
                TypeId::NIL,
            );
        }
        let components = self.list(&components);
        self.new_index_info(key_type, union_type, is_readonly, NodeId::NIL, components)
    }

    pub fn is_symbol_with_symbol_name(&mut self, symbol: SymbolId) -> bool {
        let a = self.ast;
        if is_known_symbol(a, symbol) {
            return true;
        }
        let declarations = a.sym(symbol).declarations;
        if declarations.len() != 0 {
            let name = a.name(declarations.at(0usize));
            if name.is_nil() || !is_computed_property_name(a, name) {
                return false;
            }
            let name_type = self.check_computed_property_name(name);
            return self.is_type_assignable_to_kind(name_type, TypeFlags::ES_SYMBOL);
        }
        false
    }

    pub fn is_symbol_with_numeric_name(&mut self, symbol: SymbolId) -> bool {
        let a = self.ast;
        if is_numeric_literal_name(a.sym(symbol).name) {
            return true;
        }
        let declarations = a.sym(symbol).declarations;
        if declarations.len() != 0 {
            let name = a.name(declarations.at(0usize));
            return !name.is_nil() && self.is_numeric_name(name);
        }
        false
    }

    pub fn is_symbol_with_computed_name(&self, symbol: SymbolId) -> bool {
        let a = self.ast;
        let declarations = a.sym(symbol).declarations;
        if declarations.len() != 0 {
            let name = a.name(declarations.at(0usize));
            return !name.is_nil() && is_computed_property_name(a, name);
        }
        false
    }

    pub fn is_numeric_name(&mut self, name: NodeId) -> bool {
        let a = self.ast;
        match a.kind(name) {
            Kind::ComputedPropertyName => self.is_numeric_computed_name(name),
            Kind::Identifier | Kind::NumericLiteral | Kind::StringLiteral => {
                is_numeric_literal_name(a.text(name))
            }
            _ => false,
        }
    }

    pub fn is_numeric_computed_name(&mut self, name: NodeId) -> bool {
        // It seems odd to consider an expression of type Any to result in a numeric name, but this behavior is consistent with checkIndexedAccess
        let name_type = self.check_computed_property_name(name);
        self.is_type_assignable_to_kind(name_type, TypeFlags::NUMBER_LIKE)
    }

    pub fn is_valid_index_key_type(&mut self, t: TypeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        self.types[t]
            .flags
            .intersects(TypeFlags::STRING | TypeFlags::NUMBER | TypeFlags::ES_SYMBOL)
            || self.is_pattern_literal_type(t)
            || self.types[t].flags.intersects(TypeFlags::INTERSECTION)
                && !self.is_generic_type(t)
                && some(self.type_types(t).as_slice(), |u| {
                    self.is_valid_index_key_type(u)
                })
    }

    pub fn find_index_info(
        &self,
        index_infos: List<'_, IndexInfoId>,
        key_type: TypeId,
    ) -> IndexInfoId {
        for &info in index_infos.as_slice() {
            if self.index_infos[info].key_type == key_type {
                return info;
            }
        }
        IndexInfoId::NIL
    }

    pub fn get_index_symbol(&mut self, symbol: SymbolId) -> SymbolId {
        let members = self.get_members_of_symbol(symbol);
        self.ast.table_get(members, INTERNAL_SYMBOL_NAME_INDEX)
    }

    pub fn get_signatures_of_symbol(&mut self, symbol: SymbolId) -> List<'a, SignatureId> {
        if symbol.is_nil() {
            return List::NIL;
        }
        let a = self.ast;
        let declarations = a.sym(symbol).declarations;
        let mut result: Vec<SignatureId> = Vec::new();
        for (i, &decl) in declarations.as_slice().iter().enumerate() {
            if !is_function_like(a, decl) {
                continue;
            }
            // Don't include signature if node is the implementation of an overloaded function. A node is considered an implementation node if it has a body and the previous node is of the same kind and immediately precedes the implementation node (i.e. has the same parent and ends where the implementation starts).
            if i > 0 && !a.body(decl).is_nil() {
                let previous = declarations.at(i - 1);
                if a.parent(decl) == a.parent(previous)
                    && a.kind(decl) == a.kind(previous)
                    && (a.pos(decl) == a.end(previous)
                        || a.flags(previous).intersects(NodeFlags::REPARSED))
                {
                    continue;
                }
            }
            // If this is a function or method declaration, get the signature from the @type tag for the sake of optional parameters. Exclude contextually-typed kinds because we already apply the @type tag to the context, plus applying it here to the initializer would suppress checks that the two are compatible.
            let mut sig = self.get_signature_of_full_signature_type(decl);
            if sig.is_nil() {
                sig = self.get_signature_from_declaration(decl);
            }
            result.push(sig);
        }
        if result.is_empty() {
            return List::NIL;
        }
        self.list_of(&result)
    }

    pub fn get_signature_from_declaration(&mut self, declaration: NodeId) -> SignatureId {
        let a = self.ast;
        let links = self.signature_links.get(declaration);
        if !self.signature_links[links].resolved_signature.is_nil() {
            return self.signature_links[links].resolved_signature;
        }
        let mut parameters: Vec<SymbolId> = Vec::new();
        let mut flags = SignatureFlags::NONE;
        let mut this_parameter = SymbolId::NIL;
        let mut min_argument_count: isize = 0;
        let mut has_this_parameter = false;
        let iife = get_immediately_invoked_function_expression(a, declaration);
        let is_untyped_signature_in_js_file = iife.is_nil()
            && is_in_js_file(a, declaration)
            && (is_function_expression(a, declaration)
                || is_arrow_function(a, declaration)
                || is_method_or_accessor(a, declaration)
                || is_function_declaration(a, declaration)
                || is_constructor_declaration(a, declaration))
            && a.parameters(declaration)
                .as_slice()
                .iter()
                .all(|&param| a.type_node(param).is_nil())
            && self
                .get_contextual_type(declaration, ContextFlags::SIGNATURE)
                .is_nil();
        if is_untyped_signature_in_js_file {
            flags |= SignatureFlags::IS_UNTYPED_SIGNATURE_IN_JS_FILE;
        }
        for (i, &param) in a.parameters(declaration).as_slice().iter().enumerate() {
            let mut param_symbol = a.symbol(param);
            let type_node = a.type_node(param);
            // Include parameter symbol instead of property symbol in the signature
            if !param_symbol.is_nil()
                && a.sym(param_symbol).flags.intersects(SymbolFlags::PROPERTY)
                && !is_binding_pattern(a, a.name(param))
            {
                let resolved_symbol = self.resolve_name(
                    param,
                    a.sym(param_symbol).name,
                    SymbolFlags::VALUE,
                    MessageId::NIL,
                    false,
                    false,
                );
                param_symbol = resolved_symbol;
            }
            if i == 0 && a.sym(param_symbol).name == INTERNAL_SYMBOL_NAME_THIS {
                has_this_parameter = true;
                this_parameter = a.symbol(param);
            } else {
                parameters.push(param_symbol);
            }
            if !type_node.is_nil() && a.kind(type_node) == Kind::LiteralType {
                flags |= SignatureFlags::HAS_LITERAL_TYPES;
            }
            // Record a new minimum argument count if this is not an optional parameter
            let is_optional_parameter = is_optional_declaration(a, param)
                || !a.initializer(param).is_nil()
                || is_rest_parameter(a, param)
                || !iife.is_nil()
                    && parameters.len() > a.arguments(iife).as_slice().len()
                    && type_node.is_nil();
            if !is_optional_parameter {
                min_argument_count = parameters.len() as isize;
            }
        }
        // If only one accessor includes a this-type annotation, the other behaves as if it had the same type annotation
        if (is_get_accessor_declaration(a, declaration)
            || is_set_accessor_declaration(a, declaration))
            && self.has_bindable_name(declaration)
            && (!has_this_parameter || this_parameter.is_nil())
        {
            let other_kind = if is_get_accessor_declaration(a, declaration) {
                Kind::SetAccessor
            } else {
                Kind::GetAccessor
            };
            let symbol = self.get_symbol_of_declaration(declaration);
            let other = get_declaration_of_kind(a, symbol, other_kind);
            if !other.is_nil() {
                this_parameter = self.get_annotated_accessor_this_parameter(other);
            }
        }
        let mut class_type = TypeId::NIL;
        if is_constructor_declaration(a, declaration) {
            let class_symbol = self.get_merged_symbol(a.symbol(a.parent(declaration)));
            class_type = self.get_declared_type_of_class_or_interface(class_symbol);
        }
        let type_parameters = if !class_type.is_nil() {
            self.as_interface_type(class_type).local_type_parameters()
        } else {
            self.get_type_parameters_from_declaration(declaration)
        };
        if has_rest_parameter(a, declaration) {
            flags |= SignatureFlags::HAS_REST_PARAMETER;
        }
        if is_constructor_type_node(a, declaration)
            || is_constructor_declaration(a, declaration)
            || is_construct_signature_declaration(a, declaration)
        {
            flags |= SignatureFlags::CONSTRUCT;
        }
        if is_constructor_type_node(a, declaration)
            && has_syntactic_modifier(a, declaration, ModifierFlags::ABSTRACT)
            || is_constructor_declaration(a, declaration)
                && has_syntactic_modifier(a, a.parent(declaration), ModifierFlags::ABSTRACT)
        {
            flags |= SignatureFlags::ABSTRACT;
        }
        let parameters = if parameters.is_empty() {
            List::NIL
        } else {
            self.list_of(&parameters)
        };
        let signature = self.new_signature(
            flags,
            declaration,
            type_parameters,
            this_parameter,
            parameters,
            TypeId::NIL,
            TypePredicateId::NIL,
            min_argument_count,
        );
        self.signature_links[links].resolved_signature = signature;
        self.signature_links[links].resolved_signature
    }

    pub fn get_type_parameters_from_declaration(
        &mut self,
        declaration: NodeId,
    ) -> List<'a, TypeId> {
        let a = self.ast;
        let sig = self.get_signature_of_full_signature_type(declaration);
        if !sig.is_nil() {
            return self.signatures[sig].type_parameters;
        }
        let mut result: Vec<TypeId> = Vec::new();
        for &node in a.type_parameters(declaration).as_slice() {
            let type_parameter = self.get_declared_type_of_type_parameter(a.symbol(node));
            result = append_if_unique(result, type_parameter);
        }
        if result.is_empty() {
            return List::NIL;
        }
        self.list_of(&result)
    }

    pub fn get_annotated_accessor_this_parameter(&self, accessor: NodeId) -> SymbolId {
        let parameter = self.get_accessor_this_parameter(accessor);
        if !parameter.is_nil() {
            return self.ast.symbol(parameter);
        }
        SymbolId::NIL
    }

    pub fn get_accessor_this_parameter(&self, accessor: NodeId) -> NodeId {
        let a = self.ast;
        let expected_count = if is_get_accessor_declaration(a, accessor) {
            1
        } else {
            2
        };
        if a.parameters(accessor).len() == expected_count {
            return get_this_parameter(a, accessor);
        }
        NodeId::NIL
    }

    // Indicates whether a declaration has an early-bound name or a dynamic name that can be late-bound.
    pub fn has_bindable_name(&mut self, node: NodeId) -> bool {
        !has_dynamic_name(self.ast, node) || self.has_late_bindable_name(node)
    }

    // Indicates whether a declaration has a late-bindable dynamic name.
    pub fn has_late_bindable_name(&mut self, node: NodeId) -> bool {
        let name = get_name_of_declaration(self.ast, node);
        !name.is_nil() && self.is_late_bindable_name(name)
    }

    // Indicates whether a declaration name is definitely late-bindable. A declaration name is only late-bindable if: it is a `ComputedPropertyName`; its expression is an `Identifier` or either a `PropertyAccessExpression` an `ElementAccessExpression` consisting only of these same three types of nodes; the type of its expression is a string or numeric literal type, or is a `unique symbol` type.
    pub fn is_late_bindable_name(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if !is_late_bindable_ast(a, node) {
            return false;
        }
        if is_computed_property_name(a, node) {
            let name_type = self.check_computed_property_name(node);
            return is_type_usable_as_property_name(self, name_type);
        }
        let argument_type =
            self.check_expression_cached(a.as_element_access_expression(node).argument_expression);
        is_type_usable_as_property_name(self, argument_type)
    }

    pub fn has_late_bindable_index_signature(&mut self, node: NodeId) -> bool {
        let name = get_name_of_declaration(self.ast, node);
        !name.is_nil() && self.is_late_bindable_index_signature(name)
    }

    pub fn is_late_bindable_index_signature(&mut self, node: NodeId) -> bool {
        let a = self.ast;
        if !is_late_bindable_ast(a, node) {
            return false;
        }
        if is_computed_property_name(a, node) {
            let name_type = self.check_computed_property_name(node);
            return self.is_type_usable_as_index_signature_declaration(name_type);
        }
        let argument_type =
            self.check_expression_cached(a.as_element_access_expression(node).argument_expression);
        self.is_type_usable_as_index_signature_declaration(argument_type)
    }

    pub fn is_type_usable_as_index_signature_declaration(&mut self, t: TypeId) -> bool {
        self.is_type_assignable_to(t, self.string_number_symbol_type)
    }
}

pub fn is_late_bindable_ast(a: Ast<'_>, node: NodeId) -> bool {
    let mut expr = NodeId::NIL;
    if is_computed_property_name(a, node) {
        expr = a.expression(node);
    } else if is_element_access_expression(a, node) {
        expr = a.as_element_access_expression(node).argument_expression;
    }
    !expr.is_nil() && is_entity_name_expression(a, expr)
}
