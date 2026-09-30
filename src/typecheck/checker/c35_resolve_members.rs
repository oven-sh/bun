// checker.go:20729-21511 (layers T-SIGINST, T-MEMBERS, T-UIMEMBERS): the functions of 20729-21006 and 21166-21511: instantiation of signatures and index infos, members of anonymous types, instantiated symbols and symbol tables, the test for a member without `this`, default construct signatures, and the members of union and intersection types.
use crate::ast::{
    CheckFlags, INTERNAL_SYMBOL_NAME_CALL, INTERNAL_SYMBOL_NAME_CONSTRUCTOR,
    INTERNAL_SYMBOL_NAME_INDEX, INTERNAL_SYMBOL_NAME_NEW, Kind, ModifierFlags, NodeId, SymbolFlags,
    SymbolId, SymbolTableId, get_class_like_declaration_of_symbol, has_syntactic_modifier,
    is_ambient_module, is_constructor_declaration, is_in_js_file,
};
use crate::checker::{
    Checker, CompositeSignature, IndexInfoId, ObjectFlags, SignatureFlags, SignatureId,
    SignatureKind, Ternary, TypeFlags, TypeId, TypeMapperId, TypePredicateId, UnionReduction,
    get_base_type_node_of_class, new_type_mapper, some_type,
};
use crate::core::{List, every, first_non_nil, last_or_nil, or_else, same, some};

impl<'a> Checker<'a> {
    pub fn instantiate_signature(&mut self, sig: SignatureId, m: TypeMapperId) -> SignatureId {
        self.instantiate_signature_ex(sig, m, m == self.permissive_mapper)
    }

    pub fn instantiate_signature_ex(
        &mut self,
        sig: SignatureId,
        m: TypeMapperId,
        erase_type_parameters: bool,
    ) -> SignatureId {
        let mut m = m;
        let mut fresh_type_parameters: List<'a, TypeId> = List::NIL;
        let type_parameters = self.signatures[sig].type_parameters;
        if type_parameters.len() != 0 && !erase_type_parameters {
            // First create a fresh set of type parameters, then include a mapping from the old to the new type parameters in the mapper function. Finally store this mapper in the new type parameters such that we can use it when instantiating constraints.
            fresh_type_parameters =
                self.map_list(type_parameters, |c, tp| c.clone_type_parameter(tp));
            let fresh_mapper = new_type_mapper(self, type_parameters, fresh_type_parameters);
            m = self.combine_type_mappers(fresh_mapper, m);
            for &tp in fresh_type_parameters.as_slice() {
                self.as_type_parameter_mut(tp).mapper = m;
            }
        }
        // Don't compute resolvedReturnType and resolvedTypePredicate now, because using `mapper` now could trigger inferences to become fixed. (See `createInferenceContext`.) See GH#17600.
        let flags = self.signatures[sig].flags & SignatureFlags::PROPAGATING_FLAGS;
        let declaration = self.signatures[sig].declaration;
        let this_parameter = self.signatures[sig].this_parameter;
        let this_parameter = self.instantiate_symbol(this_parameter, m);
        let parameters = self.signatures[sig].parameters;
        let parameters = self.instantiate_symbols(parameters, m);
        let min_argument_count = self.signatures[sig].min_argument_count as isize;
        let result = self.new_signature(
            flags,
            declaration,
            fresh_type_parameters,
            this_parameter,
            parameters,
            TypeId::NIL,
            TypePredicateId::NIL,
            min_argument_count,
        );
        self.signatures[result].target = sig;
        self.signatures[result].mapper = m;
        result
    }

    pub fn instantiate_index_info(&mut self, info: IndexInfoId, m: TypeMapperId) -> IndexInfoId {
        let value_type = self.index_infos[info].value_type;
        let new_value_type = self.instantiate_type(value_type, m);
        if new_value_type == value_type {
            return info;
        }
        let key_type = self.index_infos[info].key_type;
        let is_readonly = self.index_infos[info].is_readonly;
        let declaration = self.index_infos[info].declaration;
        let components = self.index_infos[info].components;
        self.new_index_info(
            key_type,
            new_value_type,
            is_readonly,
            declaration,
            components,
        )
    }

    pub fn resolve_anonymous_type_members(&mut self, t: TypeId) {
        let a = self.ast;
        let target = self.as_object_type(t).target;
        if !target.is_nil() {
            self.set_structured_type_members(
                t,
                SymbolTableId::NIL,
                List::NIL,
                List::NIL,
                List::NIL,
            );
            let mapper = self.as_object_type(t).mapper;
            let properties = self.get_properties_of_object_type(target);
            let members = self.create_instantiated_symbol_table(properties, mapper);
            let call_signatures = self.get_signatures_of_type(target, SignatureKind::CALL);
            let call_signatures = self.instantiate_signatures(call_signatures, mapper);
            let construct_signatures =
                self.get_signatures_of_type(target, SignatureKind::CONSTRUCT);
            let construct_signatures = self.instantiate_signatures(construct_signatures, mapper);
            let index_infos = self.get_index_infos_of_type(target);
            let index_infos = self.instantiate_index_infos(index_infos, mapper);
            self.set_structured_type_members(
                t,
                members,
                call_signatures,
                construct_signatures,
                index_infos,
            );
            return;
        }
        let symbol = self.get_merged_symbol(self.types[t].symbol);
        if a.sym(symbol).flags.intersects(SymbolFlags::TYPE_LITERAL) {
            self.set_structured_type_members(
                t,
                SymbolTableId::NIL,
                List::NIL,
                List::NIL,
                List::NIL,
            );
            let members = self.get_members_of_symbol(symbol);
            let call_signatures =
                self.get_signatures_of_symbol(a.table_get(members, INTERNAL_SYMBOL_NAME_CALL));
            let construct_signatures =
                self.get_signatures_of_symbol(a.table_get(members, INTERNAL_SYMBOL_NAME_NEW));
            let index_infos = self.get_index_infos_of_symbol(symbol);
            self.set_structured_type_members(
                t,
                members,
                call_signatures,
                construct_signatures,
                index_infos,
            );
            return;
        }
        // Combinations of function, class, enum and module
        let mut members = self.get_exports_of_symbol(symbol);
        if symbol == self.global_this_symbol {
            let vars_only = a.new_table();
            // Upstream ranges over the members, a map: the table is walked in insertion order.
            let mut position = 0;
            while let Some((_, p)) = a.table_entry_at(members, position) {
                position += 1;
                let p_data = a.sym(p);
                if !p_data.flags.intersects(SymbolFlags::BLOCK_SCOPED)
                    && !(p_data.flags.intersects(SymbolFlags::VALUE_MODULE)
                        && p_data.declarations.len() != 0
                        && every(p_data.declarations.as_slice(), |d| is_ambient_module(a, d)))
                {
                    a.table_set(vars_only, p_data.name, p);
                }
            }
            members = vars_only;
        }
        let mut base_constructor_index_info = IndexInfoId::NIL;
        self.set_structured_type_members(t, members, List::NIL, List::NIL, List::NIL);
        if a.sym(symbol).flags.intersects(SymbolFlags::CLASS) {
            let class_type = self.get_declared_type_of_class_or_interface(symbol);
            let base_constructor_type = self.get_base_constructor_type_of_class(class_type);
            if self.types[base_constructor_type]
                .flags
                .intersects(TypeFlags::OBJECT | TypeFlags::INTERSECTION | TypeFlags::TYPE_VARIABLE)
            {
                members = a.table_clone(members);
                let base_properties = self.get_properties_of_type(base_constructor_type);
                // Upstream drops the result: the clone is extended in place, and a nil table stays nil.
                let _ = self.add_inherited_members(members, base_properties);
                self.set_structured_type_members(t, members, List::NIL, List::NIL, List::NIL);
            } else if base_constructor_type == self.any_type {
                base_constructor_index_info = self.any_base_type_index_info;
            }
        }
        let index_symbol = a.table_get(members, INTERNAL_SYMBOL_NAME_INDEX);
        let index_infos = if !index_symbol.is_nil() {
            // Upstream collects the values of the members, a map: the table is read in insertion order.
            let mut sibling_symbols: Vec<SymbolId> = Vec::new();
            let mut position = 0;
            while let Some((_, sibling)) = a.table_entry_at(members, position) {
                position += 1;
                sibling_symbols.push(sibling);
            }
            self.get_index_infos_of_index_symbol(index_symbol, &sibling_symbols)
        } else {
            let mut appended: Vec<IndexInfoId> = Vec::new();
            if !base_constructor_index_info.is_nil() {
                appended.push(base_constructor_index_info);
            }
            if a.sym(symbol).flags.intersects(SymbolFlags::ENUM) {
                let declared_type = self.get_declared_type_of_symbol(symbol);
                let mut has_number_index =
                    self.types[declared_type].flags.intersects(TypeFlags::ENUM);
                if !has_number_index {
                    let properties = self.as_structured_type(t).properties;
                    has_number_index = some(properties.as_slice(), |prop| {
                        let prop_type = self.get_type_of_symbol(prop);
                        self.types[prop_type]
                            .flags
                            .intersects(TypeFlags::NUMBER_LIKE)
                    });
                }
                if has_number_index {
                    appended.push(self.enum_number_index_info);
                }
            }
            self.list(&appended)
        };
        self.as_structured_type_mut(t).index_infos = index_infos;
        // We resolve the members before computing the signatures because a signature may use typeof with a qualified name expression that circularly references the type we are in the process of resolving (see issue #6072). The temporarily empty signature list will never be observed because a qualified name can't reference signatures.
        if a.sym(symbol)
            .flags
            .intersects(SymbolFlags::FUNCTION | SymbolFlags::METHOD)
        {
            let signatures = self.get_signatures_of_symbol(symbol);
            self.as_structured_type_mut(t).signatures = signatures;
            self.as_structured_type_mut(t).call_signature_count = signatures.len();
        }
        // And likewise for construct signatures for classes
        if a.sym(symbol).flags.intersects(SymbolFlags::CLASS) {
            let class_type = self.get_declared_type_of_class_or_interface(symbol);
            let constructor_symbol =
                a.table_get(a.sym(symbol).members, INTERNAL_SYMBOL_NAME_CONSTRUCTOR);
            let mut construct_signatures = self.get_signatures_of_symbol(constructor_symbol);
            if construct_signatures.len() == 0 {
                construct_signatures = self.get_default_construct_signatures(class_type);
            }
            // `append(d.signatures, constructSignatures...)`: the list itself when nothing is appended.
            if construct_signatures.len() != 0 {
                let mut signatures: Vec<SignatureId> =
                    self.as_structured_type(t).signatures.as_slice().to_vec();
                signatures.extend_from_slice(construct_signatures.as_slice());
                let signatures = self.list_of(&signatures);
                self.as_structured_type_mut(t).signatures = signatures;
            }
        }
    }

    pub fn create_instantiated_symbol_table(
        &mut self,
        symbols: List<'_, SymbolId>,
        m: TypeMapperId,
    ) -> SymbolTableId {
        let a = self.ast;
        if symbols.len() == 0 {
            return SymbolTableId::NIL;
        }
        let result = a.new_table();
        for &symbol in symbols.as_slice() {
            let instantiated = self.instantiate_symbol(symbol, m);
            a.table_set(result, a.sym(symbol).name, instantiated);
        }
        result
    }

    pub fn instantiate_symbol_table(
        &mut self,
        symbols: SymbolTableId,
        m: TypeMapperId,
    ) -> SymbolTableId {
        let a = self.ast;
        if a.table_len(symbols) == 0 {
            return SymbolTableId::NIL;
        }
        let result = a.new_table();
        // Upstream ranges over the symbols, a map: the table is walked in insertion order.
        let mut position = 0;
        while let Some((id, symbol)) = a.table_entry_at(symbols, position) {
            position += 1;
            if self.is_named_member(symbol, id) {
                let instantiated = self.instantiate_symbol(symbol, m);
                a.table_set(result, id, instantiated);
            }
        }
        result
    }

    pub fn instantiate_symbol(&mut self, symbol: SymbolId, m: TypeMapperId) -> SymbolId {
        if symbol.is_nil() {
            return SymbolId::NIL;
        }
        let a = self.ast;
        let mut symbol = symbol;
        let mut m = m;
        let links = self.value_symbol_links_get(symbol);
        if !m.is_nil() && self.maps_this_only(m) && is_thisless(self, symbol) {
            return symbol;
        }
        // If the type of the symbol is already resolved, and if that type could not possibly be affected by instantiation, simply return the symbol itself.
        let resolved_type = self.value_symbol_links[links].resolved_type;
        if !resolved_type.is_nil() && !self.could_contain_type_variables(resolved_type) {
            if !a.sym(symbol).flags.intersects(SymbolFlags::SET_ACCESSOR) {
                return symbol;
            }
            // If we're a setter, check writeType.
            let write_type = self.value_symbol_links[links].write_type;
            if !write_type.is_nil() && !self.could_contain_type_variables(write_type) {
                return symbol;
            }
        }
        if a.sym(symbol)
            .check_flags
            .intersects(CheckFlags::INSTANTIATED)
        {
            // If symbol being instantiated is itself a instantiation, fetch the original target and combine the type mappers. This ensures that original type identities are properly preserved and that aliases always reference a non-aliases.
            symbol = self.value_symbol_links[links].target;
            let links_mapper = self.value_symbol_links[links].mapper;
            m = self.combine_type_mappers(links_mapper, m);
        }
        // Keep the flags from the symbol we're instantiating.  Mark that is instantiated, and also transient so that we can just store data on it directly.
        let s = a.sym(symbol);
        let result = self.new_symbol(s.flags, s.name);
        a.update_symbol(result, |r| {
            r.check_flags = CheckFlags::INSTANTIATED
                | (s.check_flags
                    & (CheckFlags::READONLY
                        | CheckFlags::LATE
                        | CheckFlags::OPTIONAL_PARAMETER
                        | CheckFlags::REST_PARAMETER));
            r.declarations = s.declarations;
            r.parent = s.parent;
            r.value_declaration = s.value_declaration;
        });
        let result_links = self.value_symbol_links_get(result);
        self.value_symbol_links[result_links].target = symbol;
        self.value_symbol_links[result_links].mapper = m;
        let name_type = self.value_symbol_links[links].name_type;
        self.value_symbol_links[result_links].name_type = name_type;
        result
    }
}

// Returns true if the parameter or class/interface member given by the symbol is free of "this" references. The function may return false for symbols that are actually free of "this" references because it is not feasible to perform a complete analysis in all cases. In particular, property members with types inferred from their initializers and function members with inferred return types are conservatively assumed not to be free of "this" references.
pub fn is_thisless(c: &Checker<'_>, symbol: SymbolId) -> bool {
    let a = c.ast;
    let declarations = a.sym(symbol).declarations;
    if declarations.len() == 1 {
        let declaration = declarations.at(0usize);
        if !declaration.is_nil() {
            match a.kind(declaration) {
                Kind::Parameter => return is_thisless_variable_like_declaration(c, declaration),
                Kind::PropertyDeclaration | Kind::PropertySignature => {
                    return is_thisless_variable_like_declaration(c, declaration);
                }
                Kind::MethodDeclaration
                | Kind::MethodSignature
                | Kind::Constructor
                | Kind::GetAccessor
                | Kind::SetAccessor => {
                    return is_thisless_function_like_declaration(c, declaration);
                }
                _ => {}
            }
        }
    }
    false
}

// A variable-like declaration is free of this references if it has a type annotation that is thisless, or if it has no type annotation and no initializer (and is thus of type any).
pub fn is_thisless_variable_like_declaration(c: &Checker<'_>, node: NodeId) -> bool {
    let a = c.ast;
    let type_node = a.type_node(node);
    if !type_node.is_nil() {
        return is_thisless_type(c, type_node);
    }
    a.initializer(node).is_nil()
}

// A type is free of this references if it's the any, string, number, boolean, symbol, or void keyword, a string literal type, an array with an element type that is free of this references, or a type reference that is free of this references.
pub fn is_thisless_type(c: &Checker<'_>, node: NodeId) -> bool {
    if !c.stack_check.is_safe_to_recurse() {
        return c.stack_limit();
    }
    let a = c.ast;
    match a.kind(node) {
        Kind::AnyKeyword
        | Kind::UnknownKeyword
        | Kind::StringKeyword
        | Kind::NumberKeyword
        | Kind::BigIntKeyword
        | Kind::BooleanKeyword
        | Kind::SymbolKeyword
        | Kind::ObjectKeyword
        | Kind::VoidKeyword
        | Kind::UndefinedKeyword
        | Kind::NeverKeyword
        | Kind::LiteralType => true,
        Kind::ArrayType => is_thisless_type(c, a.as_array_type_node(node).element_type),
        Kind::TypeReference => every(a.type_arguments(node).as_slice(), |type_argument| {
            is_thisless_type(c, type_argument)
        }),
        _ => false,
    }
}

// A function-like declaration is considered free of `this` references if it has a return type annotation that is free of this references and if each parameter is thisless and if each type parameter (if present) is thisless.
pub fn is_thisless_function_like_declaration(c: &Checker<'_>, node: NodeId) -> bool {
    let a = c.ast;
    let return_type = a.type_node(node);
    (is_constructor_declaration(a, node)
        || !return_type.is_nil() && is_thisless_type(c, return_type))
        && every(a.parameters(node).as_slice(), |parameter| {
            is_thisless_variable_like_declaration(c, parameter)
        })
        && every(a.type_parameters(node).as_slice(), |type_parameter| {
            is_thisless_type_parameter(c, type_parameter)
        })
}

// A type parameter is thisless if its constraint is thisless, or if it has no constraint.
pub fn is_thisless_type_parameter(c: &Checker<'_>, node: NodeId) -> bool {
    let constraint = c.ast.as_type_parameter_declaration(node).constraint;
    constraint.is_nil() || is_thisless_type(c, constraint)
}

impl<'a> Checker<'a> {
    pub fn get_default_construct_signatures(
        &mut self,
        class_type: TypeId,
    ) -> List<'a, SignatureId> {
        let a = self.ast;
        let base_constructor_type = self.get_base_constructor_type_of_class(class_type);
        let base_signatures =
            self.get_signatures_of_type(base_constructor_type, SignatureKind::CONSTRUCT);
        let declaration = get_class_like_declaration_of_symbol(a, self.types[class_type].symbol);
        let is_abstract = !declaration.is_nil()
            && has_syntactic_modifier(a, declaration, ModifierFlags::ABSTRACT);
        if base_signatures.len() == 0 {
            let flags = if is_abstract {
                SignatureFlags::CONSTRUCT | SignatureFlags::ABSTRACT
            } else {
                SignatureFlags::CONSTRUCT
            };
            let local_type_parameters = self.as_interface_type(class_type).local_type_parameters();
            let signature = self.new_signature(
                flags,
                NodeId::NIL,
                local_type_parameters,
                SymbolId::NIL,
                List::NIL,
                class_type,
                TypePredicateId::NIL,
                0,
            );
            return self.list_of(&[signature]);
        }
        let base_type_node = get_base_type_node_of_class(self, class_type);
        let is_java_script = !declaration.is_nil() && is_in_js_file(a, declaration);
        let type_arguments = self.get_type_arguments_from_node(base_type_node);
        let type_arg_count = type_arguments.len();
        let mut result: Vec<SignatureId> = Vec::new();
        for &base_sig in base_signatures.as_slice() {
            let base_type_parameters = self.signatures[base_sig].type_parameters;
            let min_type_argument_count = self.get_min_type_argument_count(base_type_parameters);
            let type_param_count = base_type_parameters.len();
            if is_java_script
                || type_arg_count >= min_type_argument_count && type_arg_count <= type_param_count
            {
                let sig = if type_param_count != 0 {
                    let filled_type_arguments = self.fill_missing_type_arguments(
                        type_arguments,
                        base_type_parameters,
                        min_type_argument_count,
                        is_java_script,
                    );
                    self.create_signature_instantiation(base_sig, filled_type_arguments)
                } else {
                    self.clone_signature(base_sig)
                };
                let local_type_parameters =
                    self.as_interface_type(class_type).local_type_parameters();
                self.signatures[sig].type_parameters = local_type_parameters;
                self.signatures[sig].resolved_return_type = class_type;
                if is_abstract {
                    self.signatures[sig].flags |= SignatureFlags::ABSTRACT;
                } else {
                    let flags = self.signatures[sig].flags.without(SignatureFlags::ABSTRACT);
                    self.signatures[sig].flags = flags;
                }
                result.push(sig);
            }
        }
        self.list(&result)
    }

    pub fn resolve_union_type_members(&mut self, t: TypeId) {
        // The members and properties collections are empty for union types. To get all properties of a union type use getPropertiesOfType (only the language service uses this).
        let types = self.type_types(t);
        let mut call_signature_lists: Vec<List<'a, SignatureId>> =
            Vec::with_capacity(types.as_slice().len());
        for &u in types.as_slice() {
            let signatures = if u == self.global_function_type {
                self.list_of(&[self.unknown_signature])
            } else {
                self.get_signatures_of_type(u, SignatureKind::CALL)
            };
            call_signature_lists.push(signatures);
        }
        let mut call_signatures = self.get_union_signatures(&call_signature_lists);
        if call_signatures.len() == 0 {
            call_signatures = self.get_array_member_call_signatures(t);
        }
        let mut construct_signature_lists: Vec<List<'a, SignatureId>> =
            Vec::with_capacity(types.as_slice().len());
        for &u in types.as_slice() {
            let signatures = self.get_signatures_of_type(u, SignatureKind::CONSTRUCT);
            construct_signature_lists.push(signatures);
        }
        let construct_signatures = self.get_union_signatures(&construct_signature_lists);
        let index_infos = self.get_union_index_infos(types);
        self.set_structured_type_members(
            t,
            SymbolTableId::NIL,
            call_signatures,
            construct_signatures,
            index_infos,
        );
    }

    pub fn get_array_member_call_signatures(&mut self, t: TypeId) -> List<'a, SignatureId> {
        let a = self.ast;
        // Check if union is exclusively instantiations of a member of the global Array or ReadonlyArray type.
        let mut member_name: &[u8] = b"";
        let types = self.type_types(t);
        for (i, &u) in types.as_slice().iter().enumerate() {
            let symbol = self.types[u].symbol;
            if !self.types[u]
                .object_flags
                .intersects(ObjectFlags::INSTANTIATED)
                || symbol.is_nil()
                || a.sym(symbol).parent.is_nil()
                || !self.is_array_or_tuple_symbol(a.sym(symbol).parent)
            {
                return List::NIL;
            }
            if i == 0 {
                member_name = a.sym(symbol).name;
            } else if member_name != a.sym(symbol).name {
                return List::NIL;
            }
        }
        // Transform the type from `(A[] | B[])["member"]` to `(A | B)[]["member"]` (since we pretend array is covariant anyway).
        let array_arg = self.map_type(t, &mut |c, u| {
            let mapper = c.type_mapper(u);
            let parent = c.ast.sym(c.types[u].symbol).parent;
            let array_type = if c.is_readonly_array_symbol(parent) {
                c.global_readonly_array_type
            } else {
                c.global_array_type
            };
            let type_parameter = c.as_interface_type(array_type).type_parameters().at(0usize);
            c.map(mapper, type_parameter)
        });
        let readonly = some_type(self, t, &mut |c, u| {
            let parent = c.ast.sym(c.types[u].symbol).parent;
            c.is_readonly_array_symbol(parent)
        });
        let array_type = self.create_array_type_ex(array_arg, readonly);
        let member_type = self.get_type_of_property_of_type(array_type, member_name);
        self.get_signatures_of_type(member_type, SignatureKind::CALL)
    }

    pub fn is_array_or_tuple_symbol(&mut self, symbol: SymbolId) -> bool {
        if symbol.is_nil()
            || self.types[self.global_array_type].symbol.is_nil()
            || self.types[self.global_readonly_array_type].symbol.is_nil()
        {
            return false;
        }
        let global_array_symbol = self.types[self.global_array_type].symbol;
        let global_readonly_array_symbol = self.types[self.global_readonly_array_type].symbol;
        !self
            .get_symbol_if_same_reference(symbol, global_array_symbol)
            .is_nil()
            || !self
                .get_symbol_if_same_reference(symbol, global_readonly_array_symbol)
                .is_nil()
    }

    pub fn is_readonly_array_symbol(&mut self, symbol: SymbolId) -> bool {
        if symbol.is_nil() || self.types[self.global_readonly_array_type].symbol.is_nil() {
            return false;
        }
        let global_readonly_array_symbol = self.types[self.global_readonly_array_type].symbol;
        !self
            .get_symbol_if_same_reference(symbol, global_readonly_array_symbol)
            .is_nil()
    }

    // The signatures of a union type are those signatures that are present in each of the constituent types. Generic signatures must match exactly, but non-generic signatures are allowed to have extra optional parameters and may differ in return types. When signatures differ in return types, the resulting return type is the union of the constituent return types.
    pub fn get_union_signatures(
        &mut self,
        signature_lists: &[List<'a, SignatureId>],
    ) -> List<'a, SignatureId> {
        // `result` of upstream is nil until the first signature is appended.
        let mut result: Option<Vec<SignatureId>> = None;
        let mut index_with_length_over_one = 0;
        let mut count_length_over_one = 0;
        for (i, &list) in signature_lists.iter().enumerate() {
            if list.len() == 0 {
                return List::NIL;
            }
            if list.len() > 1 {
                index_with_length_over_one = i;
                count_length_over_one += 1;
            }
            for &signature in list.as_slice() {
                // Only process signatures with parameter lists that aren't already in the result list
                let is_new = match &result {
                    None => true,
                    Some(existing) => self
                        .find_matching_signature(existing, signature, false, false, true)
                        .is_nil(),
                };
                if is_new {
                    let union_signatures =
                        self.find_matching_signatures(signature_lists, signature, i as isize);
                    if !union_signatures.is_nil() {
                        let mut s = signature;
                        // Union the result types when more than one signature matches
                        if union_signatures.len() > 1 {
                            let mut this_parameter = self.signatures[signature].this_parameter;
                            let first_this_parameter_of_union_signatures =
                                first_non_nil(union_signatures.as_slice(), |sig| {
                                    self.signatures[sig].this_parameter
                                });
                            if !first_this_parameter_of_union_signatures.is_nil() {
                                let mut this_types: Vec<TypeId> = Vec::new();
                                for &sig in union_signatures.as_slice() {
                                    let sig_this_parameter = self.signatures[sig].this_parameter;
                                    if !sig_this_parameter.is_nil() {
                                        let this_type = self.get_type_of_symbol(sig_this_parameter);
                                        if !this_type.is_nil() {
                                            this_types.push(this_type);
                                        }
                                    }
                                }
                                let this_type =
                                    self.get_intersection_type(List::from_slice(&this_types));
                                this_parameter = self.create_symbol_with_type(
                                    first_this_parameter_of_union_signatures,
                                    this_type,
                                );
                            }
                            s = self.create_union_signature(signature, union_signatures);
                            self.signatures[s].this_parameter = this_parameter;
                        }
                        result.get_or_insert_with(Vec::new).push(s);
                    }
                }
            }
        }
        if result.as_ref().is_none_or(Vec::is_empty) && count_length_over_one <= 1 {
            // No sufficiently similar signature existed to subsume all the other signatures in the union - time to see if we can make a single signature that handles all of them. We only do this when there are overloads in only one constituent. (Overloads are conditional in nature and having overloads in multiple constituents would necessitate making a power set of signatures from the type, whose ordering would be non-obvious)
            let master_list = signature_lists
                .get(index_with_length_over_one)
                .copied()
                .unwrap_or(List::NIL);
            let mut results: Option<Vec<SignatureId>> = if master_list.is_nil() {
                None
            } else {
                Some(master_list.as_slice().to_vec())
            };
            for &signatures in signature_lists {
                if !same(signatures.as_slice(), master_list.as_slice()) {
                    let signature = signatures.at(0usize);
                    self.assert(!signature.is_nil(), "getUnionSignatures bails early on empty signature lists and should not have empty lists on second pass");
                    if signature.is_nil() {
                        continue;
                    }
                    let type_parameters = self.signatures[signature].type_parameters;
                    let mut mismatch = false;
                    if type_parameters.len() != 0 {
                        for &s in results.as_deref().unwrap_or(&[]) {
                            let s_type_parameters = self.signatures[s].type_parameters;
                            if s_type_parameters.len() != 0
                                && !self.compare_type_parameters_identical(
                                    type_parameters,
                                    s_type_parameters,
                                )
                            {
                                mismatch = true;
                                break;
                            }
                        }
                    }
                    if mismatch {
                        results = None;
                    } else if let Some(current) = results.take() {
                        let mut combined: Vec<SignatureId> = Vec::with_capacity(current.len());
                        for sig in current {
                            let combined_signature = self
                                .combine_union_or_intersection_member_signatures(
                                    sig, signature, true,
                                );
                            combined.push(combined_signature);
                        }
                        results = Some(combined);
                    }
                    if results.is_none() {
                        break;
                    }
                }
            }
            result = results;
        }
        match result {
            Some(result) => self.list_of(&result),
            None => List::NIL,
        }
    }

    pub fn combine_union_or_intersection_member_signatures(
        &mut self,
        left: SignatureId,
        right: SignatureId,
        is_union: bool,
    ) -> SignatureId {
        let a = self.ast;
        let left_type_parameters = self.signatures[left].type_parameters;
        let right_type_parameters = self.signatures[right].type_parameters;
        let mut type_params = left_type_parameters;
        if type_params.len() == 0 {
            type_params = right_type_parameters;
        }
        let mut param_mapper = TypeMapperId::NIL;
        if left_type_parameters.len() != 0 && right_type_parameters.len() != 0 {
            // We just use the type parameter defaults from the first signature
            param_mapper = new_type_mapper(self, right_type_parameters, left_type_parameters);
        }
        let mut flags = (self.signatures[left].flags | self.signatures[right].flags)
            & SignatureFlags::PROPAGATING_FLAGS.without(SignatureFlags::HAS_REST_PARAMETER);
        let declaration = self.signatures[left].declaration;
        let params =
            self.combine_union_or_intersection_parameters(left, right, param_mapper, is_union);
        let last_param = last_or_nil(params.as_slice());
        if !last_param.is_nil()
            && a.sym(last_param)
                .check_flags
                .intersects(CheckFlags::REST_PARAMETER)
        {
            flags |= SignatureFlags::HAS_REST_PARAMETER;
        }
        let left_this_parameter = self.signatures[left].this_parameter;
        let right_this_parameter = self.signatures[right].this_parameter;
        let this_param = self.combine_union_or_intersection_this_param(
            left_this_parameter,
            right_this_parameter,
            param_mapper,
            is_union,
        );
        let min_arg_count = self.signatures[left]
            .min_argument_count
            .max(self.signatures[right].min_argument_count) as isize;
        let result = self.new_signature(
            flags,
            declaration,
            type_params,
            this_param,
            params,
            TypeId::NIL,
            TypePredicateId::NIL,
            min_arg_count,
        );
        let left_composite = self.signatures[left].composite;
        let mut signatures: Vec<SignatureId> =
            if !left_composite.is_nil() && self.composite_signatures[left_composite].is_union {
                self.composite_signatures[left_composite]
                    .signatures
                    .as_slice()
                    .to_vec()
            } else {
                vec![left]
            };
        signatures.push(right);
        let signatures = self.list_of(&signatures);
        let composite = self.composite_signatures.alloc(CompositeSignature {
            is_union,
            signatures,
        });
        self.signatures[result].composite = composite;
        let left_mapper = self.signatures[left].mapper;
        if !param_mapper.is_nil() {
            if !left_composite.is_nil()
                && self.composite_signatures[left_composite].is_union == is_union
                && !left_mapper.is_nil()
            {
                let mapper = self.combine_type_mappers(left_mapper, param_mapper);
                self.signatures[result].mapper = mapper;
            } else {
                self.signatures[result].mapper = param_mapper;
            }
        } else if !left_composite.is_nil()
            && self.composite_signatures[left_composite].is_union == is_union
        {
            self.signatures[result].mapper = left_mapper;
        }
        result
    }

    pub fn combine_union_or_intersection_parameters(
        &mut self,
        left: SignatureId,
        right: SignatureId,
        mapper: TypeMapperId,
        is_union: bool,
    ) -> List<'a, SymbolId> {
        let left_count = self.get_parameter_count(left);
        let right_count = self.get_parameter_count(right);
        let (longest_count, longest, shorter) = if left_count >= right_count {
            (left_count, left, right)
        } else {
            (right_count, right, left)
        };
        let either_has_effective_rest =
            self.has_effective_rest_parameter(left) || self.has_effective_rest_parameter(right);
        let needs_extra_rest_element =
            either_has_effective_rest && !self.has_effective_rest_parameter(longest);
        let mut params: Vec<SymbolId> = Vec::with_capacity(
            usize::try_from(longest_count).unwrap_or(0) + usize::from(needs_extra_rest_element),
        );
        let mut i: isize = 0;
        while i < longest_count {
            let mut longest_param_type = self.try_get_type_at_position(longest, i);
            if longest == right {
                longest_param_type = self.instantiate_type(longest_param_type, mapper);
            }
            let shorter_type_at_position = self.try_get_type_at_position(shorter, i);
            let mut shorter_param_type = or_else(shorter_type_at_position, self.unknown_type);
            if shorter == right {
                shorter_param_type = self.instantiate_type(shorter_param_type, mapper);
            }
            let combined_param_type = self.get_union_or_intersection_type(
                List::from_slice(&[longest_param_type, shorter_param_type]),
                !is_union,
                UnionReduction::LITERAL,
            );
            let is_rest_param =
                either_has_effective_rest && !needs_extra_rest_element && i == longest_count - 1;
            let is_optional = i >= self.get_min_argument_count(longest)
                && i >= self.get_min_argument_count(shorter);
            let left_name = if i < left_count {
                self.get_parameter_name_at_position(left, i)
            } else {
                Vec::new()
            };
            let right_name = if i < right_count {
                self.get_parameter_name_at_position(right, i)
            } else {
                Vec::new()
            };
            let mut param_name = if left_name == right_name || right_name.is_empty() {
                left_name
            } else if left_name.is_empty() {
                right_name
            } else {
                Vec::new()
            };
            if param_name.is_empty() {
                param_name = b"arg".to_vec();
                param_name.extend_from_slice(i.to_string().as_bytes());
            }
            let mut symbol_flags = SymbolFlags::FUNCTION_SCOPED_VARIABLE;
            if is_optional && !is_rest_param {
                symbol_flags |= SymbolFlags::OPTIONAL;
            }
            let check_flags = if is_rest_param {
                CheckFlags::REST_PARAMETER
            } else if is_optional {
                CheckFlags::OPTIONAL_PARAMETER
            } else {
                CheckFlags::NONE
            };
            let param_name = self.text(&param_name);
            let param_symbol = self.new_symbol_ex(symbol_flags, param_name, check_flags);
            let links = self.value_symbol_links_get(param_symbol);
            let resolved_type = if is_rest_param {
                self.create_array_type(combined_param_type)
            } else {
                combined_param_type
            };
            self.value_symbol_links[links].resolved_type = resolved_type;
            params.push(param_symbol);
            i += 1;
        }
        if needs_extra_rest_element {
            let rest_param_symbol = self.new_symbol_ex(
                SymbolFlags::FUNCTION_SCOPED_VARIABLE,
                b"args",
                CheckFlags::REST_PARAMETER,
            );
            let links = self.value_symbol_links_get(rest_param_symbol);
            let type_at_position = self.get_type_at_position(shorter, longest_count);
            let resolved_type = self.create_array_type(type_at_position);
            self.value_symbol_links[links].resolved_type = resolved_type;
            if shorter == right {
                let instantiated = self.instantiate_type(resolved_type, mapper);
                self.value_symbol_links[links].resolved_type = instantiated;
            }
            params.push(rest_param_symbol);
        }
        self.list_of(&params)
    }

    pub fn combine_union_or_intersection_this_param(
        &mut self,
        left: SymbolId,
        right: SymbolId,
        mapper: TypeMapperId,
        is_union: bool,
    ) -> SymbolId {
        if left.is_nil() {
            return right;
        }
        if right.is_nil() {
            return left;
        }
        // A signature `this` type might be a read or a write position... It's very possible that it should be invariant and we should refuse to merge signatures if there are `this` types and they do not match. However, so as to be permissive when calling, for now, we'll intersect the `this` types just like we do for param types in union signatures.
        let left_type = self.get_type_of_symbol(left);
        let right_type = self.get_type_of_symbol(right);
        let right_type = self.instantiate_type(right_type, mapper);
        let this_type = self.get_union_or_intersection_type(
            List::from_slice(&[left_type, right_type]),
            !is_union,
            UnionReduction::LITERAL,
        );
        self.create_symbol_with_type(left, this_type)
    }

    pub fn resolve_intersection_type_members(&mut self, t: TypeId) {
        // The members and properties collections are empty for intersection types. To get all properties of an intersection type use getPropertiesOfType (only the language service uses this).
        let mut call_signatures: Vec<SignatureId> = Vec::new();
        let mut construct_signatures: Vec<SignatureId> = Vec::new();
        let mut index_infos: Vec<IndexInfoId> = Vec::new();
        let types = self.type_types(t);
        let (mixin_flags, mixin_count) = self.find_mixins(types);
        for (i, &u) in types.as_slice().iter().enumerate() {
            // When an intersection type contains mixin constructor types, the construct signatures from those types are discarded and their return types are mixed into the return types of all other construct signatures in the intersection type. For example, the intersection type '{ new(...args: any[]) => A } & { new(s: string) => B }' has a single construct signature 'new(s: string) => A & B'.
            if !mixin_flags.get(i).copied().unwrap_or(false) {
                let mut signatures = self.get_signatures_of_type(u, SignatureKind::CONSTRUCT);
                if signatures.len() != 0 && mixin_count > 0 {
                    signatures = self.map_list(signatures, |c, s| {
                        let clone = c.clone_signature(s);
                        let return_type = c.get_return_type_of_signature(s);
                        let resolved_return_type =
                            c.include_mixin_type(return_type, types, &mixin_flags, i as isize);
                        c.signatures[clone].resolved_return_type = resolved_return_type;
                        clone
                    });
                }
                construct_signatures = self.append_signatures(construct_signatures, signatures);
            }
            let signatures = self.get_signatures_of_type(u, SignatureKind::CALL);
            call_signatures = self.append_signatures(call_signatures, signatures);
            let infos = self.get_index_infos_of_type(u);
            for &info in infos.as_slice() {
                index_infos = self.append_index_info(index_infos, info, false);
            }
        }
        let call_signatures = self.list(&call_signatures);
        let construct_signatures = self.list(&construct_signatures);
        let index_infos = self.list(&index_infos);
        self.set_structured_type_members(
            t,
            SymbolTableId::NIL,
            call_signatures,
            construct_signatures,
            index_infos,
        );
    }

    pub fn append_signatures(
        &mut self,
        signatures: Vec<SignatureId>,
        new_signatures: List<'_, SignatureId>,
    ) -> Vec<SignatureId> {
        let mut signatures = signatures;
        for &sig in new_signatures.as_slice() {
            let mut all_different = true;
            for &s in &signatures {
                if self.compare_signatures_identical(
                    s,
                    sig,
                    false,
                    false,
                    false,
                    &mut Checker::compare_types_identical,
                ) != Ternary::FALSE
                {
                    all_different = false;
                    break;
                }
            }
            if all_different {
                signatures.push(sig);
            }
        }
        signatures
    }

    // Upstream replaces the element in place and returns the slice: the caller owns the list, so it is passed and returned by value.
    pub fn append_index_info(
        &mut self,
        index_infos: Vec<IndexInfoId>,
        new_info: IndexInfoId,
        union: bool,
    ) -> Vec<IndexInfoId> {
        let mut index_infos = index_infos;
        let mut i = 0;
        while let Some(&info) = index_infos.get(i) {
            if self.index_infos[info].key_type == self.index_infos[new_info].key_type {
                let info_value_type = self.index_infos[info].value_type;
                let new_value_type = self.index_infos[new_info].value_type;
                let (value_type, is_readonly) = if union {
                    let value_type =
                        self.get_union_type(List::from_slice(&[info_value_type, new_value_type]));
                    let is_readonly = self.index_infos[info].is_readonly
                        || self.index_infos[new_info].is_readonly;
                    (value_type, is_readonly)
                } else {
                    let value_type = self.get_intersection_type(List::from_slice(&[
                        info_value_type,
                        new_value_type,
                    ]));
                    let is_readonly = self.index_infos[info].is_readonly
                        && self.index_infos[new_info].is_readonly;
                    (value_type, is_readonly)
                };
                let key_type = self.index_infos[info].key_type;
                let replaced =
                    self.new_index_info(key_type, value_type, is_readonly, NodeId::NIL, List::NIL);
                if let Some(slot) = index_infos.get_mut(i) {
                    *slot = replaced;
                }
                return index_infos;
            }
            i += 1;
        }
        index_infos.push(new_info);
        index_infos
    }

    pub fn find_mixins(&mut self, types: List<'_, TypeId>) -> (Vec<bool>, isize) {
        let mut mixin_flags: Vec<bool> = Vec::with_capacity(types.as_slice().len());
        for &t in types.as_slice() {
            let is_mixin = self.is_mixin_constructor_type(t);
            mixin_flags.push(is_mixin);
        }
        let mut constructor_type_count = 0;
        let mut mixin_count = 0;
        let mut first_mixin_index = None;
        for (i, &t) in types.as_slice().iter().enumerate() {
            if self
                .get_signatures_of_type(t, SignatureKind::CONSTRUCT)
                .len()
                > 0
            {
                constructor_type_count += 1;
            }
            if mixin_flags.get(i).copied().unwrap_or(false) {
                if first_mixin_index.is_none() {
                    first_mixin_index = Some(i);
                }
                mixin_count += 1;
            }
        }
        if constructor_type_count > 0 && constructor_type_count == mixin_count {
            if let Some(flag) = first_mixin_index.and_then(|index| mixin_flags.get_mut(index)) {
                *flag = false;
            }
            mixin_count -= 1;
        }
        (mixin_flags, mixin_count)
    }

    pub fn include_mixin_type(
        &mut self,
        t: TypeId,
        types: List<'_, TypeId>,
        mixin_flags: &[bool],
        index: isize,
    ) -> TypeId {
        let mut mixed_types: Vec<TypeId> = Vec::new();
        for (i, &u) in types.as_slice().iter().enumerate() {
            if i as isize == index {
                mixed_types.push(t);
            } else if mixin_flags.get(i).copied().unwrap_or(false) {
                let signatures = self.get_signatures_of_type(u, SignatureKind::CONSTRUCT);
                let return_type = self.get_return_type_of_signature(signatures.at(0usize));
                mixed_types.push(return_type);
            }
        }
        self.get_intersection_type(List::from_slice(&mixed_types))
    }
}
