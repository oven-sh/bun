// checker.go:16495-17139 (layers T-SYMTYPE, T-SIGSHAPE): the functions of 16495-16585, 16658-17028 and 17132-17139: types of deferred, written and located symbols, the type of a variable, parameter or property from its declaration, padding of destructured initializers, types of functions, classes, enums and modules, and the type of a parameter.
use crate::ast::{
    CheckFlags, INTERNAL_SYMBOL_NAME_MISSING, INTERNAL_SYMBOL_NAME_THIS, Kind, ModifierFlags,
    NodeFlags, NodeId, SymbolFlags, SymbolId, find_constructor_declaration,
    get_declaration_of_kind, get_root_declaration, has_accessor_modifier, has_static_modifier,
    is_assignment_target, is_binding_element, is_binding_pattern,
    is_catch_clause_variable_declaration_or_binding_element, is_class_static_block_declaration,
    is_declaration_name, is_expression_node, is_identifier, is_in_js_file, is_json_source_file,
    is_jsx_attribute, is_jsx_namespaced_name, is_jsx_tag_name, is_omitted_expression,
    is_parameter_declaration, is_private_identifier, is_property_declaration,
    is_property_signature_declaration, is_right_side_of_qualified_name_or_property_access,
    is_set_accessor_declaration, is_source_file, is_variable_declaration, is_write_access,
    walk_up_binding_elements_and_patterns,
};
use crate::checker::{
    CheckMode, Checker, ElementFlags, InferenceContextId, ObjectFlags, SignatureFlags, SignatureId,
    TupleElementInfo, TypeFlags, TypeId, TypeSystemEntity, TypeSystemPropertyName, WideningKind,
    get_property_name_from_type, has_dot_dot_dot_token, is_declaration_readonly,
    is_empty_array_literal, is_object_literal_type, is_optional_declaration,
    is_right_side_of_access_expression, is_shorthand_ambient_module_symbol, is_tuple_type,
    is_type_usable_as_property_name,
};
use crate::core::{List, Text};

impl<'a> Checker<'a> {
    pub fn get_type_of_symbol_with_deferred_type(&mut self, symbol: SymbolId) -> TypeId {
        let links = self.value_symbol_links_get(symbol);
        if self.value_symbol_links[links].resolved_type.is_nil() {
            let deferred = self.deferred_symbol_links.get(symbol);
            let parent = self.deferred_symbol_links[deferred].parent;
            let constituents = self.deferred_symbol_links[deferred].constituents;
            let resolved_type = if self.types[parent].flags.intersects(TypeFlags::UNION) {
                self.get_union_type(constituents)
            } else {
                self.get_intersection_type(constituents)
            };
            self.value_symbol_links[links].resolved_type = resolved_type;
        }
        self.value_symbol_links[links].resolved_type
    }

    pub fn get_write_type_of_symbol_with_deferred_type(&mut self, symbol: SymbolId) -> TypeId {
        let links = self.value_symbol_links_get(symbol);
        if self.value_symbol_links[links].write_type.is_nil() {
            let deferred = self.deferred_symbol_links.get(symbol);
            let write_constituents = self.deferred_symbol_links[deferred].write_constituents;
            let write_type = if write_constituents.len() != 0 {
                let parent = self.deferred_symbol_links[deferred].parent;
                if self.types[parent].flags.intersects(TypeFlags::UNION) {
                    self.get_union_type(write_constituents)
                } else {
                    self.get_intersection_type(write_constituents)
                }
            } else {
                self.get_type_of_symbol_with_deferred_type(symbol)
            };
            self.value_symbol_links[links].write_type = write_type;
        }
        self.value_symbol_links[links].write_type
    }

    // Distinct write types come only from set accessors, but synthetic union and intersection properties deriving from set accessors will either pre-compute or defer the union or intersection of the writeTypes of their constituents.
    pub fn get_write_type_of_symbol(&mut self, symbol: SymbolId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let check_flags = a.sym(symbol).check_flags;
        if check_flags.intersects(CheckFlags::SYNTHETIC_PROPERTY) {
            if check_flags.intersects(CheckFlags::DEFERRED_TYPE) {
                return self.get_write_type_of_symbol_with_deferred_type(symbol);
            }
            let links = self.value_symbol_links_get(symbol);
            let write_type = self.value_symbol_links[links].write_type;
            if !write_type.is_nil() {
                return write_type;
            }
            return self.value_symbol_links[links].resolved_type;
        }
        if a.sym(symbol).flags.intersects(SymbolFlags::PROPERTY) {
            let t = self.get_type_of_symbol(symbol);
            let is_optional = a.sym(symbol).flags.intersects(SymbolFlags::OPTIONAL);
            return self.remove_missing_type(t, is_optional);
        }
        if a.sym(symbol).flags.intersects(SymbolFlags::ACCESSOR) {
            if a.sym(symbol)
                .check_flags
                .intersects(CheckFlags::INSTANTIATED)
            {
                return self.get_write_type_of_instantiated_symbol(symbol);
            }
            return self.get_write_type_of_accessors(symbol);
        }
        self.get_type_of_symbol(symbol)
    }

    pub fn get_type_of_symbol_at_location(&mut self, symbol: SymbolId, location: NodeId) -> TypeId {
        let a = self.ast;
        let symbol = self.get_export_symbol_of_value_symbol_if_exported(symbol);
        let mut location = location;
        if !location.is_nil() {
            // If we have an identifier or a property access at the given location, if the location is an dotted name expression, and if the location is not an assignment target, obtain the type of the expression (which will reflect control flow analysis). If the expression indeed resolved to the given symbol, return the narrowed type.
            if (is_identifier(a, location) || is_private_identifier(a, location))
                && !(is_jsx_tag_name(a, location)
                    || is_jsx_attribute(a, a.parent(location))
                    || is_jsx_namespaced_name(a, a.parent(location)))
            {
                if is_right_side_of_qualified_name_or_property_access(a, location) {
                    location = a.parent(location);
                }
                if is_expression_node(a, location)
                    && (!is_assignment_target(a, location) || is_write_access(a, location))
                {
                    let t = if is_write_access(a, location)
                        && a.kind(location) == Kind::PropertyAccessExpression
                    {
                        self.check_property_access_expression(location, CheckMode::NORMAL, true)
                    } else {
                        self.get_type_of_expression(location)
                    };
                    let links = self.symbol_node_links.get(location);
                    let resolved_symbol = self.symbol_node_links[links].resolved_symbol;
                    if self.get_export_symbol_of_value_symbol_if_exported(resolved_symbol) == symbol
                    {
                        return self.remove_optional_type_marker(t);
                    }
                }
            }
            if is_declaration_name(a, location)
                && is_set_accessor_declaration(a, a.parent(location))
                && !self
                    .get_annotated_accessor_type_node(a.parent(location))
                    .is_nil()
            {
                return self.get_write_type_of_accessors(a.symbol(a.parent(location)));
            }
            // The location isn't a reference to the given symbol, meaning we're being asked a hypothetical question of what type the symbol would have if there was a reference to it at the given location. Since we have no control flow information for the hypothetical reference (control flow information is created and attached by the binder), we simply return the declared type of the symbol.
            if is_right_side_of_access_expression(a, location)
                && is_write_access(a, a.parent(location))
            {
                return self.get_write_type_of_symbol(symbol);
            }
        }
        self.get_non_missing_type_of_symbol(symbol)
    }

    pub fn is_parameter_of_context_sensitive_signature(&mut self, symbol: SymbolId) -> bool {
        let a = self.ast;
        let mut decl = a.sym(symbol).value_declaration;
        if decl.is_nil() {
            return false;
        }
        if is_binding_element(a, decl) {
            decl = walk_up_binding_elements_and_patterns(a, decl);
        }
        if is_parameter_declaration(a, decl) {
            return self.is_context_sensitive_function_or_object_literal_method(a.parent(decl));
        }
        false
    }

    pub fn get_type_of_variable_or_parameter_or_property_worker(
        &mut self,
        symbol: SymbolId,
    ) -> TypeId {
        let a = self.ast;
        // Handle prototype property
        if a.sym(symbol).flags.intersects(SymbolFlags::PROTOTYPE) {
            return self.get_type_of_prototype_property(symbol);
        }
        // CommonsJS require and module both have type any.
        if symbol == self.require_symbol {
            return self.any_type;
        }
        let declaration = a.sym(symbol).value_declaration;
        self.assert(!declaration.is_nil(), "symbol.ValueDeclaration != nil");
        if is_source_file(a, declaration) && is_json_source_file(a, declaration) {
            let statements = a.statements(declaration);
            if statements.len() == 0 {
                return self.empty_object_type;
            }
            let expression_type = self.check_expression(a.expression(statements.at(0usize)));
            let widened_literal_type = self.get_widened_literal_type(expression_type);
            return self.get_widened_type(widened_literal_type);
        }
        // Handle variable, parameter or property
        if !self.push_type_resolution(
            TypeSystemEntity::Symbol(symbol),
            TypeSystemPropertyName::Type,
        ) {
            return self.report_circularity_error(symbol);
        }
        if a.sym(symbol).flags.intersects(SymbolFlags::MODULE_EXPORTS) {
            // Upstream leaves through these two returns without popTypeResolution: the entry of this symbol stays on the resolution stack.
            if a.sym(symbol).name == b"exports" {
                let module_symbol = a.symbol(a.sym(symbol).value_declaration);
                let resolved = self.resolve_external_module_symbol(module_symbol, false);
                return self.get_type_of_symbol(resolved);
            }
            let members = a.sym(symbol).members;
            return self.new_anonymous_type(symbol, members, List::NIL, List::NIL, List::NIL);
        }
        let result = match a.kind(declaration) {
            Kind::Parameter
            | Kind::PropertyDeclaration
            | Kind::PropertySignature
            | Kind::VariableDeclaration
            | Kind::BindingElement => {
                // only report diagnostics for context-insensitive parameters - context-sensitive ones may have their type fixed to something else
                let report_errors = !self.is_parameter_of_context_sensitive_signature(symbol);
                self.get_widened_type_for_variable_like_declaration(declaration, report_errors)
            }
            Kind::PropertyAssignment => {
                self.check_property_assignment(declaration, CheckMode::NORMAL)
            }
            Kind::ShorthandPropertyAssignment => {
                self.check_shorthand_property_assignment(declaration, true, CheckMode::NORMAL)
            }
            Kind::MethodDeclaration => {
                self.check_object_literal_method(declaration, CheckMode::NORMAL)
            }
            Kind::ExportAssignment => {
                if !a.type_node(declaration).is_nil() {
                    self.get_type_from_type_node(a.type_node(declaration))
                } else {
                    let expression_type = self.check_expression_cached(a.expression(declaration));
                    self.widen_type_for_variable_like_declaration(
                        expression_type,
                        declaration,
                        false,
                    )
                }
            }
            Kind::BinaryExpression | Kind::CallExpression => {
                self.get_widened_type_for_assignment_declaration(symbol)
            }
            Kind::JsxAttribute => self.check_jsx_attribute(declaration, CheckMode::NORMAL),
            Kind::EnumMember => self.get_type_of_enum_member(symbol),
            kind => self.fail_detail(
                "Unhandled case in getTypeOfVariableOrParameterOrPropertyWorker: ",
                kind as u32,
            ),
        };
        if !self.pop_type_resolution() {
            return self.report_circularity_error(symbol);
        }
        result
    }

    // Return the type associated with a variable, parameter, or property declaration. In the simple case this is the type specified in a type annotation or inferred from an initializer. However, in the case of a destructuring declaration it is a bit more involved. For example: `var [x, s = ""] = [1, "one"];`. Here, the array literal [1, "one"] is contextually typed by the type [any, string], which is the implied type of the binding pattern [x, s = ""]. Because the contextual type is a tuple type, the resulting type of [1, "one"] is the tuple type [number, string]. Thus, the type inferred for 'x' is number and the type inferred for 's' is string.
    pub fn get_widened_type_for_variable_like_declaration(
        &mut self,
        declaration: NodeId,
        report_errors: bool,
    ) -> TypeId {
        let t = self.get_type_for_variable_like_declaration(declaration, true, CheckMode::NORMAL);
        self.widen_type_for_variable_like_declaration(t, declaration, report_errors)
    }

    // Return the inferred type for a variable, parameter, or property declaration
    pub fn get_type_for_variable_like_declaration(
        &mut self,
        declaration: NodeId,
        include_optionality: bool,
        check_mode: CheckMode,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        // A variable declared in a for..in statement is of type string, or of type keyof T when the right hand expression is of a type parameter type.
        if is_variable_declaration(a, declaration) {
            let grand_parent = a.parent(a.parent(declaration));
            match a.kind(grand_parent) {
                Kind::ForInStatement => {
                    let expression_type =
                        self.check_expression_ex(a.expression(grand_parent), check_mode);
                    let non_nullable_type = self.get_non_nullable_type_if_needed(expression_type);
                    let index_type = self.get_index_type(non_nullable_type);
                    if self.types[index_type]
                        .flags
                        .intersects(TypeFlags::TYPE_PARAMETER | TypeFlags::INDEX)
                    {
                        return self.get_extract_string_type(index_type);
                    }
                    return self.string_type;
                }
                Kind::ForOfStatement => {
                    // checkRightHandSideOfForOf will return undefined if the for-of expression type was missing properties/signatures required to get its iteratedType (like [Symbol.iterator] or next). This may be because we accessed properties from anyType, or it may have led to an error inside getElementTypeOfIterable.
                    return self.check_right_hand_side_of_for_of(grand_parent);
                }
                _ => {}
            }
        } else if is_binding_element(a, declaration) {
            return self.get_type_for_binding_element(declaration);
        }
        let is_property = is_property_declaration(a, declaration)
            && !has_accessor_modifier(a, declaration)
            || is_property_signature_declaration(a, declaration);
        let is_optional = include_optionality && is_optional_declaration(a, declaration);
        // Use type from type annotation if one is present
        let declared_type = self.try_get_type_from_type_node(declaration);
        if is_catch_clause_variable_declaration_or_binding_element(a, declaration) {
            if !declared_type.is_nil() {
                // If the catch clause is explicitly annotated with any or unknown, accept it, otherwise error.
                if self.types[declared_type]
                    .flags
                    .intersects(TypeFlags::ANY_OR_UNKNOWN)
                {
                    return declared_type;
                }
                return self.error_type;
            }
            // If the catch clause is not explicitly annotated, treat it as though it were explicitly annotated with unknown or any, depending on useUnknownInCatchVariables.
            if self.use_unknown_in_catch_variables {
                return self.unknown_type;
            } else {
                return self.any_type;
            }
        }
        if !declared_type.is_nil() {
            return self.add_optionality_ex(declared_type, is_property, is_optional);
        }
        if self.no_implicit_any
            && is_variable_declaration(a, declaration)
            && !is_binding_pattern(a, a.name(declaration))
            && !self
                .get_combined_modifier_flags_cached(declaration)
                .intersects(ModifierFlags::EXPORT)
            && !a.flags(declaration).intersects(NodeFlags::AMBIENT)
        {
            // If --noImplicitAny is on or the declaration is in a Javascript file, use control flow tracked 'any' type for non-ambient, non-exported var or let variables with no initializer or a 'null' or 'undefined' initializer.
            let initializer = a.initializer(declaration);
            if !self
                .get_combined_node_flags_cached(declaration)
                .intersects(NodeFlags::CONSTANT)
                && (initializer.is_nil() || self.is_null_or_undefined(initializer))
            {
                return self.auto_type;
            }
            // Use control flow tracked 'any[]' type for non-ambient, non-exported variables with an empty array literal initializer.
            if !initializer.is_nil() && is_empty_array_literal(a, initializer) {
                return self.auto_array_type;
            }
        }
        if is_parameter_declaration(a, declaration) {
            if a.symbol(declaration).is_nil() {
                // parameters of function types defined in JSDoc in TS files don't have symbols
                return TypeId::NIL;
            }
            let func = a.parent(declaration);
            // For a parameter of a set accessor, use the type of the get accessor if one is present
            if is_set_accessor_declaration(a, func) && self.has_bindable_name(func) {
                let accessor_symbol = self.get_symbol_of_declaration(a.parent(declaration));
                let getter = get_declaration_of_kind(a, accessor_symbol, Kind::GetAccessor);
                if !getter.is_nil() {
                    let getter_signature = self.get_signature_from_declaration(getter);
                    let this_parameter = self.get_accessor_this_parameter(func);
                    if !this_parameter.is_nil() && declaration == this_parameter {
                        // Use the type from the *getter*
                        self.assert(
                            a.type_node(this_parameter).is_nil(),
                            "thisParameter.Type() == nil",
                        );
                        let getter_this_parameter =
                            self.signatures[getter_signature].this_parameter;
                        return self.get_type_of_symbol(getter_this_parameter);
                    }
                    return self.get_return_type_of_signature(getter_signature);
                }
            }
            let full_signature_type = self.get_parameter_type_of_full_signature(func, declaration);
            if !full_signature_type.is_nil() {
                return full_signature_type;
            }
            // Use contextual parameter type if one is available
            let t = if a.sym(a.symbol(declaration)).name == INTERNAL_SYMBOL_NAME_THIS {
                self.get_contextual_this_parameter_type(func)
            } else {
                self.get_contextually_typed_parameter_type(declaration)
            };
            if !t.is_nil() {
                return self.add_optionality_ex(t, false, is_optional);
            }
        }
        // Use the type of the initializer expression if one is present and the declaration is not a parameter of a contextually typed function
        if !a.initializer(declaration).is_nil() {
            let initializer_type =
                self.check_declaration_initializer(declaration, check_mode, TypeId::NIL);
            let t = self.widen_type_inferred_from_initializer(declaration, initializer_type);
            return self.add_optionality_ex(t, is_property, is_optional);
        }
        if self.no_implicit_any && is_property_declaration(a, declaration) {
            // We have a property declaration with no type annotation or initializer, in noImplicitAny mode or a .js file. Use control flow analysis of this.xxx assignments in the constructor or static block to determine the type of the property.
            if !has_static_modifier(a, declaration) {
                let constructor = find_constructor_declaration(a, a.parent(declaration));
                let mut t = TypeId::NIL;
                if !constructor.is_nil() {
                    t = self.get_flow_type_in_constructor(a.symbol(declaration), constructor);
                } else if a
                    .modifier_flags(declaration)
                    .intersects(ModifierFlags::AMBIENT)
                {
                    t = self.get_type_of_property_in_base_class(a.symbol(declaration));
                }
                if t.is_nil() {
                    return TypeId::NIL;
                }
                return self.add_optionality_ex(t, true, is_optional);
            } else {
                let static_blocks: Vec<NodeId> = a
                    .members(a.parent(declaration))
                    .as_slice()
                    .iter()
                    .copied()
                    .filter(|&member| is_class_static_block_declaration(a, member))
                    .collect();
                let mut t = TypeId::NIL;
                if !static_blocks.is_empty() {
                    t = self.get_flow_type_in_static_blocks(
                        a.symbol(declaration),
                        List::from_slice(&static_blocks),
                    );
                } else if a
                    .modifier_flags(declaration)
                    .intersects(ModifierFlags::AMBIENT)
                {
                    t = self.get_type_of_property_in_base_class(a.symbol(declaration));
                }
                if t.is_nil() {
                    return TypeId::NIL;
                }
                return self.add_optionality_ex(t, true, is_optional);
            }
        }
        if is_jsx_attribute(a, declaration) {
            // if JSX attribute doesn't have initializer, by default the attribute will have boolean value of true. I.e <Elem attr /> is sugar for <Elem attr={true} />
            return self.true_type;
        }
        // If the declaration specifies a binding pattern and is not a parameter of a contextually typed function, use the type implied by the binding pattern
        if is_binding_pattern(a, a.name(declaration)) {
            return self.get_type_from_binding_pattern(a.name(declaration), false, true);
        }
        // No type specified and nothing can be inferred
        TypeId::NIL
    }

    pub fn check_declaration_initializer(
        &mut self,
        declaration: NodeId,
        check_mode: CheckMode,
        contextual_type: TypeId,
    ) -> TypeId {
        let a = self.ast;
        let initializer = a.initializer(declaration);
        let mut t = self.get_quick_type_of_expression(initializer);
        if t.is_nil() {
            if !contextual_type.is_nil() {
                t = self.check_expression_with_contextual_type(
                    initializer,
                    contextual_type,
                    InferenceContextId::NIL,
                    check_mode,
                );
            } else {
                t = self.check_expression_cached_ex(initializer, check_mode);
            }
        }
        if is_parameter_declaration(a, get_root_declaration(a, declaration)) {
            let name = a.name(declaration);
            match a.kind(name) {
                Kind::ObjectBindingPattern => {
                    if is_object_literal_type(self, t) {
                        return self.pad_object_literal_type(t, name);
                    }
                }
                Kind::ArrayBindingPattern => {
                    if is_tuple_type(self, t) {
                        return self.pad_tuple_type(t, name);
                    }
                }
                _ => {}
            }
        }
        t
    }

    pub fn pad_object_literal_type(&mut self, t: TypeId, pattern: NodeId) -> TypeId {
        let a = self.ast;
        let mut missing_elements: Vec<NodeId> = Vec::new();
        for &e in a.elements(pattern).as_slice() {
            if !a.initializer(e).is_nil() {
                let name = self.get_property_name_from_binding_element(e);
                if name != INTERNAL_SYMBOL_NAME_MISSING
                    && self.get_property_of_type(t, name).is_nil()
                {
                    missing_elements.push(e);
                }
            }
        }
        if missing_elements.is_empty() {
            return t;
        }
        let members = a.new_table();
        let properties = self.get_properties_of_object_type(t);
        for &prop in properties.as_slice() {
            a.table_set(members, a.sym(prop).name, prop);
        }
        for &e in &missing_elements {
            let name = self.get_property_name_from_binding_element(e);
            let symbol = self.new_symbol(SymbolFlags::PROPERTY | SymbolFlags::OPTIONAL, name);
            let links = self.value_symbol_links_get(symbol);
            let resolved_type = self.get_type_from_binding_element(e, false, false);
            self.value_symbol_links[links].resolved_type = resolved_type;
            a.table_set(members, a.sym(symbol).name, symbol);
        }
        let symbol = self.types[t].symbol;
        let index_infos = self.get_index_infos_of_type(t);
        let result = self.new_anonymous_type(symbol, members, List::NIL, List::NIL, index_infos);
        let object_flags = self.types[t].object_flags;
        self.types[result].object_flags = object_flags;
        result
    }

    pub fn get_property_name_from_binding_element(&mut self, e: NodeId) -> Text<'a> {
        let expr_type = self.get_literal_type_from_property_name(self.ast.property_name_or_name(e));
        if is_type_usable_as_property_name(self, expr_type) {
            let name = get_property_name_from_type(self, expr_type);
            return self.text(&name);
        }
        INTERNAL_SYMBOL_NAME_MISSING
    }

    pub fn pad_tuple_type(&mut self, t: TypeId, pattern: NodeId) -> TypeId {
        let a = self.ast;
        let pattern_elements = a.elements(pattern);
        if self
            .type_target_tuple_type(t)
            .combined_flags
            .intersects(ElementFlags::VARIABLE)
            || self.get_type_reference_arity(t) >= pattern_elements.len()
        {
            return t;
        }
        let mut element_types: Vec<TypeId> = self.get_element_types(t).as_slice().to_vec();
        let mut element_infos: Vec<TupleElementInfo> = self
            .type_target_tuple_type(t)
            .element_infos
            .as_slice()
            .to_vec();
        let mut i = self.get_type_reference_arity(t);
        while i < pattern_elements.len() {
            let e = pattern_elements.at(i);
            if i < pattern_elements.len() - 1
                || !(is_binding_element(a, e) && has_dot_dot_dot_token(a, e))
            {
                let mut element_type = self.any_type;
                if !is_omitted_expression(a, e) && self.has_default_value(e) {
                    element_type = self.get_type_from_binding_element(e, false, false);
                }
                element_types.push(element_type);
                element_infos.push(TupleElementInfo {
                    flags: ElementFlags::OPTIONAL,
                    labeled_declaration: NodeId::NIL,
                });
                if !is_omitted_expression(a, e) && !self.has_default_value(e) {
                    self.report_implicit_any(e, self.any_type, WideningKind::NORMAL);
                }
            }
            i += 1;
        }
        let readonly = self.type_target_tuple_type(t).readonly;
        let element_types = self.list_of(&element_types);
        self.create_tuple_type_ex(element_types, List::from_slice(&element_infos), readonly)
    }

    pub fn widen_type_inferred_from_initializer(
        &mut self,
        declaration: NodeId,
        t: TypeId,
    ) -> TypeId {
        let widened = self.get_widened_literal_type_for_initializer(declaration, t);
        if is_in_js_file(self.ast, declaration) {
            if self.is_empty_literal_type(widened) {
                self.report_implicit_any(declaration, self.any_type, WideningKind::NORMAL);
                return self.any_type;
            }
            if self.is_empty_array_literal_type(widened) {
                self.report_implicit_any(declaration, self.any_array_type, WideningKind::NORMAL);
                return self.any_array_type;
            }
        }
        widened
    }

    pub fn get_widened_literal_type_for_initializer(
        &mut self,
        declaration: NodeId,
        t: TypeId,
    ) -> TypeId {
        if self
            .get_combined_node_flags_cached(declaration)
            .intersects(NodeFlags::CONSTANT)
            || is_declaration_readonly(self.ast, declaration)
        {
            return t;
        }
        self.get_widened_literal_type(t)
    }

    pub fn get_type_of_func_class_enum_module(&mut self, symbol: SymbolId) -> TypeId {
        let links = self.value_symbol_links_get(symbol);
        if self.value_symbol_links[links].resolved_type.is_nil() {
            let resolved_type = self.get_type_of_func_class_enum_module_worker(symbol);
            self.value_symbol_links[links].resolved_type = resolved_type;
        }
        self.value_symbol_links[links].resolved_type
    }

    pub fn get_type_of_func_class_enum_module_worker(&mut self, symbol: SymbolId) -> TypeId {
        let a = self.ast;
        let value_declaration = a.sym(symbol).value_declaration;
        if a.sym(symbol).flags.intersects(SymbolFlags::MODULE)
            && is_shorthand_ambient_module_symbol(a, symbol)
        {
            return self.any_type;
        } else if a.sym(symbol).flags.intersects(SymbolFlags::VALUE_MODULE)
            && !value_declaration.is_nil()
            && is_source_file(a, value_declaration)
            && !a
                .as_source_file(value_declaration)
                .common_js_module_indicator
                .is_nil()
        {
            let resolved_module = self.resolve_external_module_symbol(symbol, false);
            if resolved_module != symbol {
                return self.get_type_of_symbol(resolved_module);
            }
        }
        let t = self.new_object_type(ObjectFlags::ANONYMOUS, symbol);
        if a.sym(symbol).flags.intersects(SymbolFlags::CLASS) {
            let base_type_variable = self.get_base_type_variable_of_class(symbol);
            if !base_type_variable.is_nil() {
                return self.get_intersection_type(List::from_slice(&[t, base_type_variable]));
            }
            return t;
        }
        if self.strict_null_checks && a.sym(symbol).flags.intersects(SymbolFlags::OPTIONAL) {
            return self.get_optional_type(t, true);
        }
        t
    }
}

pub fn signature_has_rest_parameter(c: &Checker<'_>, sig: SignatureId) -> bool {
    c.signatures[sig]
        .flags
        .intersects(SignatureFlags::HAS_REST_PARAMETER)
}

impl<'a> Checker<'a> {
    pub fn get_type_of_parameter(&mut self, symbol: SymbolId) -> TypeId {
        let a = self.ast;
        let declaration = a.sym(symbol).value_declaration;
        let t = self.get_type_of_symbol(symbol);
        let is_optional = !declaration.is_nil()
            && (!a.initializer(declaration).is_nil() || is_optional_declaration(a, declaration));
        self.add_optionality_ex(t, false, is_optional)
    }
}
