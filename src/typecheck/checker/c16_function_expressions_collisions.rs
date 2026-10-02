// checker.go:10133-10705 (layers E-CORE, E-FUNC, E-COLLIDE): the parenthesized expression, class and function expressions with their deferred checks, the contextual signature of a function and the contextual types of its parameters, and the checks of a declared name against the names that the emit reserves. checkClassExpressionExternalHelpers of 10171-10197 is in c46_mark_references.rs.
use crate::ast::{
    Arg, CheckFlags, Kind, ModuleInstanceState, NodeFlags, NodeId, SymbolId, SymbolTableId,
    class_element_or_class_element_parameter_is_decorated,
    class_or_constructor_parameter_is_decorated, get_declaration_container,
    get_enclosing_block_scope_container, get_function_flags, get_module_instance_state_exported,
    get_root_declaration, get_source_file_of_node, has_context_sensitive_parameters, is_block,
    is_class_expression, is_class_like, is_class_static_block_declaration, is_enum_declaration,
    is_external_or_common_js_module, is_function_expression, is_identifier, is_import_clause,
    is_import_equals_declaration, is_import_specifier, is_initialized_property,
    is_module_declaration, is_parameter_declaration, is_private_identifier,
    is_private_identifier_class_element_declaration, is_source_file, is_static, is_this_parameter,
    is_type_only_import_or_export_declaration, node_is_missing,
};
use crate::checker::{
    CheckMode, Checker, CompositeSignature, ContextFlags, InferenceContextId, InferencePriority,
    LANGUAGE_FEATURE_MINIMUM_TARGET, NodeCheckFlags, ObjectFlags, SignatureFlags, SignatureId,
    SignatureKind, Ternary, TypeFlags, TypeId, TypeMapperId, TypePredicateId,
    has_dot_dot_dot_token, is_optional_declaration, signature_has_rest_parameter,
};
use crate::core::{List, ModuleKind, ScriptTarget, filter, first_or_nil, last_or_nil};
use crate::diagnostics;
use crate::scanner::declaration_name_to_string;

impl<'a> Checker<'a> {
    pub fn check_parenthesized_expression(
        &mut self,
        node: NodeId,
        check_mode: CheckMode,
    ) -> TypeId {
        let a = self.ast;
        self.check_expression_ex(a.expression(node), check_mode)
    }

    pub fn check_class_expression(&mut self, node: NodeId) -> TypeId {
        self.check_class_like_declaration(node);
        self.check_node_deferred(node);
        self.check_class_expression_external_helpers(node);
        let symbol = self.get_symbol_of_declaration(node);
        self.get_type_of_symbol(symbol)
    }

    pub fn get_first_transformable_static_class_element(&self, node: NodeId) -> NodeId {
        let a = self.ast;
        let will_transform_static_elements_of_decorated_class = !self.legacy_decorators
            && self.language_version
                < LANGUAGE_FEATURE_MINIMUM_TARGET.class_and_class_element_decorators
            && class_or_constructor_parameter_is_decorated(a, false, node);
        let will_transform_private_elements_or_class_static_blocks = self.language_version
            < LANGUAGE_FEATURE_MINIMUM_TARGET.private_names_and_class_static_blocks
            || self.language_version
                < LANGUAGE_FEATURE_MINIMUM_TARGET.class_and_class_element_decorators;
        let will_transform_initializers = !self.emit_standard_class_fields;
        if will_transform_static_elements_of_decorated_class
            || will_transform_private_elements_or_class_static_blocks
        {
            for &member in a.members(node).as_slice() {
                if will_transform_static_elements_of_decorated_class
                    && class_element_or_class_element_parameter_is_decorated(a, false, member, node)
                {
                    let first_decorator = first_or_nil(&a.decorators(node));
                    if !first_decorator.is_nil() {
                        return first_decorator;
                    }
                    return node;
                } else if will_transform_private_elements_or_class_static_blocks {
                    if is_class_static_block_declaration(a, member) {
                        return member;
                    }
                    if is_static(a, member)
                        && (is_private_identifier_class_element_declaration(a, member)
                            || will_transform_initializers && is_initialized_property(a, member))
                    {
                        return member;
                    }
                }
            }
        }
        NodeId::NIL
    }

    pub fn check_class_expression_deferred(&mut self, node: NodeId) {
        let a = self.ast;
        self.check_source_elements(a.members(node));
        self.register_for_unused_identifiers_check(node);
    }

    pub fn check_function_expression_or_object_literal_method(
        &mut self,
        node: NodeId,
        check_mode: CheckMode,
    ) -> TypeId {
        let a = self.ast;
        self.check_node_deferred(node);
        if is_function_expression(a, node) {
            self.check_collisions_for_declaration_name(node, a.name(node));
        }
        if check_mode.intersects(CheckMode::SKIP_CONTEXT_SENSITIVE)
            && self.is_context_sensitive(node)
        {
            // Skip parameters, return signature with return type that retains noncontextual parts so inferences can still be drawn in an early stage
            if a.type_node(node).is_nil() && !has_context_sensitive_parameters(a, node) {
                // Return plain anyFunctionType if there is no possibility we'll make inferences from the return type
                let contextual_signature = self.get_contextual_signature(node);
                if !contextual_signature.is_nil() && {
                    let contextual_return_type =
                        self.get_return_type_of_signature(contextual_signature);
                    self.could_contain_type_variables(contextual_return_type)
                } {
                    if let Some(cached) = self.context_free_types.get_ok(&node) {
                        return cached;
                    }
                    let return_type = self.get_return_type_from_body(node, check_mode);
                    let return_only_signature = self.new_signature(
                        SignatureFlags::IS_NON_INFERRABLE,
                        NodeId::NIL,
                        List::NIL,
                        SymbolId::NIL,
                        List::NIL,
                        return_type,
                        TypePredicateId::NIL,
                        0,
                    );
                    let call_signatures = self.list_of(&[return_only_signature]);
                    let return_only_type = self.new_anonymous_type(
                        a.symbol(node),
                        SymbolTableId::NIL,
                        call_signatures,
                        List::NIL,
                        List::NIL,
                    );
                    self.types[return_only_type].object_flags |= ObjectFlags::NON_INFERRABLE_TYPE;
                    let ok = self.context_free_types.set(node, return_only_type);
                    self.map_set(ok);
                    return return_only_type;
                }
            }
            return self.any_function_type;
        }
        // Grammar checking
        let has_grammar_error = self.check_grammar_function_like_declaration(node);
        if !has_grammar_error && is_function_expression(a, node) {
            self.check_grammar_for_generator(node);
        }
        let full_signature = a
            .function_like_data(node)
            .map_or(NodeId::NIL, |data| data.full_signature);
        if !full_signature.is_nil() {
            let full_signature_type = self.get_type_from_type_node(full_signature);
            if self
                .get_contextual_call_signature(full_signature_type, node)
                .is_nil()
            {
                self.error(full_signature, diagnostics::A_JSDOC_TYPE_TAG_ON_A_FUNCTION_MUST_HAVE_A_SIGNATURE_WITH_THE_CORRECT_NUMBER_OF_ARGUMENTS, &[]);
            }
        }
        self.contextually_check_function_expression_or_object_literal_method(node, check_mode);
        let symbol = self.get_symbol_of_declaration(node);
        self.get_type_of_symbol(symbol)
    }

    pub fn contextually_check_function_expression_or_object_literal_method(
        &mut self,
        node: NodeId,
        check_mode: CheckMode,
    ) {
        let a = self.ast;
        let links = self.node_links.get(node);
        // Check if function expression is contextually typed and assign parameter types if so.
        if !self.node_links[links]
            .flags
            .intersects(NodeCheckFlags::CONTEXT_CHECKED)
        {
            let contextual_signature = self.get_contextual_signature(node);
            // If a type check is started at a function expression that is an argument of a function call, obtaining the contextual type may recursively get back to here during overload resolution of the call. If so, we will have already assigned contextual types.
            if !self.node_links[links]
                .flags
                .intersects(NodeCheckFlags::CONTEXT_CHECKED)
            {
                self.node_links[links].flags |= NodeCheckFlags::CONTEXT_CHECKED;
                let symbol = self.get_symbol_of_declaration(node);
                let function_type = self.get_type_of_symbol(symbol);
                let signature = first_or_nil(
                    self.get_signatures_of_type(function_type, SignatureKind::CALL)
                        .as_slice(),
                );
                if signature.is_nil() {
                    return;
                }
                if self.is_context_sensitive(node) {
                    if !contextual_signature.is_nil() {
                        let inference_context = self.get_inference_context(node);
                        let mut instantiated_contextual_signature = SignatureId::NIL;
                        if check_mode.intersects(CheckMode::INFERENTIAL) {
                            self.infer_from_annotated_parameters_and_return(
                                signature,
                                contextual_signature,
                                inference_context,
                            );
                            let rest_type = self.get_effective_rest_type(contextual_signature);
                            if !rest_type.is_nil()
                                && self.types[rest_type]
                                    .flags
                                    .intersects(TypeFlags::TYPE_PARAMETER)
                            {
                                let non_fixing_mapper =
                                    self.inference_contexts[inference_context].non_fixing_mapper;
                                instantiated_contextual_signature = self
                                    .instantiate_signature(contextual_signature, non_fixing_mapper);
                            }
                        }
                        if instantiated_contextual_signature.is_nil() {
                            if !inference_context.is_nil() {
                                let mapper = self.inference_contexts[inference_context].mapper;
                                instantiated_contextual_signature =
                                    self.instantiate_signature(contextual_signature, mapper);
                            } else {
                                instantiated_contextual_signature = contextual_signature;
                            }
                        }
                        self.assign_contextual_parameter_types(
                            signature,
                            instantiated_contextual_signature,
                        );
                    } else {
                        // Force resolution of all parameter types such that the absence of a contextual type is consistently reflected.
                        self.assign_non_contextual_parameter_types(signature);
                    }
                } else if !contextual_signature.is_nil()
                    && a.type_parameters(node).is_nil()
                    && self.signatures[contextual_signature].parameters.len()
                        > a.parameters(node).len()
                {
                    let inference_context = self.get_inference_context(node);
                    if check_mode.intersects(CheckMode::INFERENTIAL) {
                        self.infer_from_annotated_parameters_and_return(
                            signature,
                            contextual_signature,
                            inference_context,
                        );
                    }
                }
                if !contextual_signature.is_nil()
                    && self.get_return_type_from_annotation(node).is_nil()
                    && self.signatures[signature].resolved_return_type.is_nil()
                {
                    let return_type = self.get_return_type_from_body(node, check_mode);
                    if self.signatures[signature].resolved_return_type.is_nil() {
                        self.signatures[signature].resolved_return_type = return_type;
                    }
                }
                self.check_signature_declaration(node);
            }
        }
    }

    pub fn check_function_expression_or_object_literal_method_deferred(&mut self, node: NodeId) {
        let a = self.ast;
        let function_flags = get_function_flags(a, node);
        let return_type = self.get_return_type_from_annotation(node);
        self.check_all_code_paths_in_non_void_function_return_or_throw(node, return_type);
        let body = a.body(node);
        if !body.is_nil() {
            if a.type_node(node).is_nil() {
                // There are some checks that are only performed in getReturnTypeFromBody, that may produce errors we need. An example is the noImplicitAny errors resulting from widening the return expression of a function. Because checking of function expression bodies is deferred, there was never an appropriate time to do this during the main walk of the file (see the comment at the top of checkFunctionExpressionBodies). So it must be done now.
                let signature = self.get_signature_from_declaration(node);
                self.get_return_type_of_signature(signature);
            }
            if is_block(a, body) {
                self.check_source_element(body);
            } else {
                // From within an async function you can return either a non-promise value or a promise. Any Promise/A+ compatible implementation will always assimilate any foreign promise, so we should not be checking assignability of a promise to the return type. Instead, we need to check assignability of the awaited type of the expression body against the promised type of its return type annotation.
                let expr_type = self.check_expression(body);
                if !return_type.is_nil() {
                    let return_or_promised_type =
                        self.unwrap_return_type(return_type, function_flags);
                    if !return_or_promised_type.is_nil() {
                        self.check_return_expression(
                            node,
                            return_or_promised_type,
                            body,
                            body,
                            expr_type,
                            false,
                        );
                    }
                }
            }
        }
    }

    pub fn infer_from_annotated_parameters_and_return(
        &mut self,
        sig: SignatureId,
        context: SignatureId,
        inference_context: InferenceContextId,
    ) {
        let a = self.ast;
        let parameters = self.signatures[sig].parameters;
        let length = parameters.len()
            - if signature_has_rest_parameter(self, sig) {
                1
            } else {
                0
            };
        for i in 0..length {
            let declaration = a.sym(parameters.at(i)).value_declaration;
            let type_node = a.type_node(declaration);
            if !type_node.is_nil() {
                let annotated_type = self.get_type_from_type_node(type_node);
                let source = self.add_optionality_ex(
                    annotated_type,
                    false,
                    is_optional_declaration(a, declaration),
                );
                let target = self.get_type_at_position(context, i);
                let inferences = self.inference_contexts[inference_context].inferences;
                self.infer_types(inferences, source, target, InferencePriority::NONE, false);
            }
        }
        let declaration = self.signatures[sig].declaration;
        if !declaration.is_nil() {
            let return_type_node = a.type_node(declaration);
            if !return_type_node.is_nil() {
                let source = self.get_type_from_type_node(return_type_node);
                let target = self.get_return_type_of_signature(context);
                let inferences = self.inference_contexts[inference_context].inferences;
                self.infer_types(inferences, source, target, InferencePriority::NONE, false);
            }
        }
    }

    // Return the contextual signature for a given expression node. A contextual type provides a contextual signature if it has a single call signature and if that call signature is non-generic. If the contextual type is a union type, get the signature from each type possible and if they are all identical ignoring their return type, the result is same signature but with return type as union type of return types from these signatures
    pub fn get_contextual_signature(&mut self, node: NodeId) -> SignatureId {
        let t = self.get_apparent_type_of_contextual_type(node, ContextFlags::SIGNATURE);
        if t.is_nil() {
            return SignatureId::NIL;
        }
        if !self.types[t].flags.intersects(TypeFlags::UNION) {
            return self.get_contextual_call_signature(t, node);
        }
        let mut signature_list: Vec<SignatureId> = Vec::new();
        let types = self.type_types(t);
        for &current in types.as_slice() {
            let signature = self.get_contextual_call_signature(current, node);
            if !signature.is_nil() {
                if !signature_list.is_empty()
                    && self.compare_signatures_identical(
                        first_or_nil(&signature_list),
                        signature,
                        false,
                        true,
                        true,
                        &mut Checker::compare_types_identical,
                    ) == Ternary::FALSE
                {
                    // Signatures aren't identical, do not use
                    return SignatureId::NIL;
                }
                // Use this signature for contextual union signature
                signature_list.push(signature);
            }
        }
        match signature_list.len() {
            0 => return SignatureId::NIL,
            1 => return first_or_nil(&signature_list),
            _ => {}
        }
        // Result is union of signatures collected (return type is union of return types of this signature set)
        let union_signatures = self.list_of(&signature_list);
        self.create_union_signature(first_or_nil(&signature_list), union_signatures)
    }

    pub fn create_union_signature(
        &mut self,
        sig: SignatureId,
        union_signatures: List<'a, SignatureId>,
    ) -> SignatureId {
        let result = self.clone_signature(sig);
        let composite = self.composite_signatures.alloc(CompositeSignature {
            is_union: true,
            signatures: union_signatures,
        });
        self.signatures[result].composite = composite;
        self.signatures[result].target = SignatureId::NIL;
        self.signatures[result].mapper = TypeMapperId::NIL;
        result
    }

    // If the given type is an object or union type with a single signature, and if that signature has at least as many parameters as the given function, return the signature. Otherwise return undefined.
    pub fn get_contextual_call_signature(&mut self, t: TypeId, node: NodeId) -> SignatureId {
        let signatures = self.get_signatures_of_type(t, SignatureKind::CALL);
        let applicable_by_arity =
            filter(signatures.as_slice(), |s| !self.is_arity_smaller(s, node));
        if applicable_by_arity.len() == 1 {
            return first_or_nil(&applicable_by_arity);
        }
        self.get_intersected_signatures(&applicable_by_arity)
    }

    pub fn get_intersected_signatures(&mut self, signatures: &[SignatureId]) -> SignatureId {
        if !self.no_implicit_any {
            return SignatureId::NIL;
        }
        let mut combined = SignatureId::NIL;
        for &sig in signatures {
            if combined == sig || combined.is_nil() {
                combined = sig;
            } else if self.compare_type_parameters_identical(
                self.signatures[combined].type_parameters,
                self.signatures[sig].type_parameters,
            ) {
                combined =
                    self.combine_union_or_intersection_member_signatures(combined, sig, false);
            } else {
                return SignatureId::NIL;
            }
        }
        combined
    }

    // If the contextual signature has fewer parameters than the function expression, do not use it
    pub fn is_arity_smaller(&mut self, signature: SignatureId, target: NodeId) -> bool {
        let a = self.ast;
        let parameters = a.parameters(target);
        let mut target_parameter_count: isize = 0;
        while target_parameter_count < parameters.len() {
            let param = parameters.at(target_parameter_count);
            if !a.initializer(param).is_nil()
                || !a.question_token(param).is_nil()
                || has_dot_dot_dot_token(a, param)
            {
                break;
            }
            target_parameter_count += 1;
        }
        if parameters.len() != 0 && is_this_parameter(a, parameters.at(0usize)) {
            target_parameter_count -= 1;
        }
        !self.has_effective_rest_parameter(signature)
            && self.get_parameter_count(signature) < target_parameter_count
    }

    pub fn assign_contextual_parameter_types(&mut self, sig: SignatureId, context: SignatureId) {
        let a = self.ast;
        if self.signatures[context].type_parameters.len() != 0 {
            if self.signatures[sig].type_parameters.len() != 0 {
                // This signature has already has a contextual inference performed and cached on it
                return;
            }
            let type_parameters = self.signatures[context].type_parameters;
            self.signatures[sig].type_parameters = type_parameters;
        }
        if !self.signatures[context].this_parameter.is_nil() {
            let parameter = self.signatures[sig].this_parameter;
            if parameter.is_nil()
                || !a.sym(parameter).value_declaration.is_nil()
                    && a.type_node(a.sym(parameter).value_declaration).is_nil()
            {
                if parameter.is_nil() {
                    let context_this_parameter = self.signatures[context].this_parameter;
                    let this_parameter =
                        self.create_symbol_with_type(context_this_parameter, TypeId::NIL);
                    self.signatures[sig].this_parameter = this_parameter;
                }
                let this_parameter = self.signatures[sig].this_parameter;
                let context_this_parameter = self.signatures[context].this_parameter;
                let this_type = self.get_type_of_symbol(context_this_parameter);
                self.assign_parameter_type(this_parameter, this_type);
            }
        }
        let parameters = self.signatures[sig].parameters;
        let length = parameters.len()
            - if signature_has_rest_parameter(self, sig) {
                1
            } else {
                0
            };
        for i in 0..length {
            let parameter = parameters.at(i);
            let declaration = a.sym(parameter).value_declaration;
            if a.type_node(declaration).is_nil() {
                let mut t = self.try_get_type_at_position(context, i);
                if !t.is_nil() && !a.initializer(declaration).is_nil() {
                    let mut initializer_type = self.check_declaration_initializer(
                        declaration,
                        CheckMode::NORMAL,
                        TypeId::NIL,
                    );
                    if !self.is_type_assignable_to(initializer_type, t) {
                        initializer_type = self
                            .widen_type_inferred_from_initializer(declaration, initializer_type);
                        if self.is_type_assignable_to(t, initializer_type) {
                            t = initializer_type;
                        }
                    }
                }
                self.assign_parameter_type(parameter, t);
            }
        }
        if signature_has_rest_parameter(self, sig) {
            // parameter might be a transient symbol generated by use of `arguments` in the function body.
            let parameter = last_or_nil(parameters.as_slice());
            let parameter_symbol = a.sym(parameter);
            if !parameter_symbol.value_declaration.is_nil()
                && a.type_node(parameter_symbol.value_declaration).is_nil()
                || parameter_symbol.value_declaration.is_nil()
                    && parameter_symbol
                        .check_flags
                        .intersects(CheckFlags::DEFERRED_TYPE)
            {
                let contextual_parameter_type =
                    self.get_rest_type_at_position(context, length, false);
                self.assign_parameter_type(parameter, contextual_parameter_type);
            }
        }
    }

    pub fn assign_non_contextual_parameter_types(&mut self, signature: SignatureId) {
        let this_parameter = self.signatures[signature].this_parameter;
        if !this_parameter.is_nil() {
            self.assign_parameter_type(this_parameter, TypeId::NIL);
        }
        let parameters = self.signatures[signature].parameters;
        for &parameter in parameters.as_slice() {
            self.assign_parameter_type(parameter, TypeId::NIL);
        }
    }

    pub fn assign_parameter_type(&mut self, parameter: SymbolId, contextual_type: TypeId) {
        let a = self.ast;
        let links = self.value_symbol_links_get(parameter);
        if !self.value_symbol_links[links].resolved_type.is_nil() {
            return;
        }
        let declaration = a.sym(parameter).value_declaration;
        let mut t = contextual_type;
        if t.is_nil() {
            if !declaration.is_nil() {
                t = self.get_widened_type_for_variable_like_declaration(declaration, true);
            } else {
                t = self.get_type_of_symbol(parameter);
            }
        }
        let resolved_type = self.add_optionality_ex(
            t,
            false,
            !declaration.is_nil()
                && a.initializer(declaration).is_nil()
                && is_optional_declaration(a, declaration),
        );
        self.value_symbol_links[links].resolved_type = resolved_type;
        if !declaration.is_nil() && !is_identifier(a, a.name(declaration)) {
            // if inference didn't come up with anything but unknown, fall back to the binding pattern if present.
            if self.value_symbol_links[links].resolved_type == self.unknown_type {
                let pattern_type =
                    self.get_type_from_binding_pattern(a.name(declaration), false, false);
                self.value_symbol_links[links].resolved_type = pattern_type;
            }
            let parent_type = self.value_symbol_links[links].resolved_type;
            self.assign_binding_element_types(a.name(declaration), parent_type);
        }
    }

    // When contextual typing assigns a type to a parameter that contains a binding pattern, we also need to push the destructured type into the contained binding elements.
    pub fn assign_binding_element_types(&mut self, pattern: NodeId, parent_type: TypeId) {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        for &element in a.elements(pattern).as_slice() {
            let name = a.name(element);
            if !name.is_nil() {
                let t = self.get_binding_element_type_from_parent_type(element, parent_type, false);
                if is_identifier(a, name) {
                    let symbol = self.get_symbol_of_declaration(element);
                    let links = self.value_symbol_links_get(symbol);
                    self.value_symbol_links[links].resolved_type = t;
                } else {
                    self.assign_binding_element_types(name, t);
                }
            }
        }
    }

    pub fn check_collisions_for_declaration_name(&mut self, node: NodeId, name: NodeId) {
        let a = self.ast;
        if name.is_nil() {
            return;
        }
        self.check_collision_with_require_exports_in_generated_code(node, name);
        self.check_collision_with_global_object_in_generated_code(node, name);
        self.check_collision_with_global_promise_in_generated_code(node, name);
        self.record_potential_collision_with_weak_map_set_in_generated_code(node, name);
        self.record_potential_collision_with_reflect_in_generated_code(node, name);
        if is_class_like(a, node) {
            self.check_type_name_is_reserved(name, diagnostics::CLASS_NAME_CANNOT_BE_0);
            if !a.flags(node).intersects(NodeFlags::AMBIENT) {
                self.check_class_name_collision_with_object(name);
            }
        } else if is_enum_declaration(a, node) {
            self.check_type_name_is_reserved(name, diagnostics::ENUM_NAME_CANNOT_BE_0);
        }
    }

    pub fn check_collision_with_require_exports_in_generated_code(
        &mut self,
        node: NodeId,
        name: NodeId,
    ) {
        let a = self.ast;
        // No need to check for require or exports for ES6 modules and later
        if self
            .program
            .get_emit_module_format_of_file(get_source_file_of_node(a, node))
            >= ModuleKind::ES2015
        {
            return;
        }
        if name.is_nil()
            || !self.need_collision_check_for_identifier(node, name, b"require")
                && !self.need_collision_check_for_identifier(node, name, b"exports")
        {
            return;
        }
        // Uninstantiated modules shouldnt do this check
        if is_module_declaration(a, node)
            && get_module_instance_state_exported(a, node) != ModuleInstanceState::INSTANTIATED
        {
            return;
        }
        // In case of variable declaration, node.parent is variable statement so look at the variable statement's parent
        let parent = get_declaration_container(a, node);
        if is_source_file(a, parent) && is_external_or_common_js_module(a, parent) {
            // If the declaration happens to be in external module, report error that require and exports are reserved keywords
            let name_text = declaration_name_to_string(a, name);
            self.error_skipped_on_no_emit(
                name,
                diagnostics::DUPLICATE_IDENTIFIER_0_COMPILER_RESERVES_NAME_1_IN_TOP_LEVEL_SCOPE_OF_A_MODULE,
                &[Arg::Str(&name_text), Arg::Str(&name_text)],
            );
        }
    }

    pub fn check_collision_with_global_object_in_generated_code(
        &mut self,
        node: NodeId,
        name: NodeId,
    ) {
        let a = self.ast;
        if name.is_nil()
            || is_class_like(a, node)
            || !self.need_collision_check_for_identifier(node, name, b"Object")
        {
            return;
        }
        // Uninstantiated modules shouldn't do this check
        if is_module_declaration(a, node)
            && get_module_instance_state_exported(a, node) != ModuleInstanceState::INSTANTIATED
        {
            return;
        }
        // In case of variable declaration, node.parent is variable statement so look at the variable statement's parent
        let parent = get_declaration_container(a, node);
        if is_source_file(a, parent)
            && is_external_or_common_js_module(a, parent)
            && self.program.get_emit_module_format_of_file(parent) == ModuleKind::COMMON_JS
        {
            // If the declaration happens to be in external module, report error that Object is a reserved identifier.
            let name_text = declaration_name_to_string(a, name);
            self.error_skipped_on_no_emit(
                name,
                diagnostics::DUPLICATE_IDENTIFIER_0_COMPILER_RESERVES_NAME_1_IN_TOP_LEVEL_SCOPE_OF_A_MODULE,
                &[Arg::Str(&name_text), Arg::Str(&name_text)],
            );
        }
    }

    pub fn need_collision_check_for_identifier(
        &self,
        node: NodeId,
        identifier: NodeId,
        name: &[u8],
    ) -> bool {
        let a = self.ast;
        if !identifier.is_nil() && a.text(identifier) != name {
            return false;
        }
        if matches!(
            a.kind(node),
            Kind::PropertyDeclaration
                | Kind::PropertySignature
                | Kind::MethodDeclaration
                | Kind::MethodSignature
                | Kind::GetAccessor
                | Kind::SetAccessor
                | Kind::PropertyAssignment
        ) {
            // it is ok to have member named '_super', '_this', `Promise`, etc. - member access is always qualified
            return false;
        }
        if a.flags(node).intersects(NodeFlags::AMBIENT) {
            // ambient context - no codegen impact
            return false;
        }
        if is_import_clause(a, node)
            || is_import_equals_declaration(a, node)
            || is_import_specifier(a, node)
        {
            // type-only imports do not require collision checks against runtime values.
            if is_type_only_import_or_export_declaration(a, node) {
                return false;
            }
        }
        let root = get_root_declaration(a, node);
        if is_parameter_declaration(a, root) && node_is_missing(a, a.body(a.parent(root))) {
            // just an overload - no codegen impact
            return false;
        }
        true
    }

    pub fn set_node_links_for_private_identifier_scope(&mut self, node: NodeId) {
        let a = self.ast;
        let name = a.name(node);
        if is_private_identifier(a, name) {
            if self.language_version
                < LANGUAGE_FEATURE_MINIMUM_TARGET.private_names_and_class_static_blocks
                || self.language_version
                    < LANGUAGE_FEATURE_MINIMUM_TARGET.class_and_class_element_decorators
                || !self.compiler_options.get_use_define_for_class_fields()
            {
                let mut lexical_scope = get_enclosing_block_scope_container(a, node);
                while !lexical_scope.is_nil() {
                    let links = self.node_links.get(lexical_scope);
                    self.node_links[links].flags |=
                        NodeCheckFlags::CONTAINS_CLASS_WITH_PRIVATE_IDENTIFIERS;
                    lexical_scope = get_enclosing_block_scope_container(a, lexical_scope);
                }
            }
        }
    }

    pub fn record_potential_collision_with_weak_map_set_in_generated_code(
        &mut self,
        node: NodeId,
        name: NodeId,
    ) {
        if self.language_version <= ScriptTarget::ES2021
            && (self.need_collision_check_for_identifier(node, name, b"WeakMap")
                || self.need_collision_check_for_identifier(node, name, b"WeakSet"))
        {
            self.add_deferred_diagnostic(Box::new(move |c: &mut Checker<'a>| {
                c.check_weak_map_set_collision(node);
            }));
        }
    }

    pub fn check_weak_map_set_collision(&mut self, node: NodeId) {
        let a = self.ast;
        let enclosing_block_scope = get_enclosing_block_scope_container(a, node);
        let links = self.node_links.get(enclosing_block_scope);
        if self.node_links[links]
            .flags
            .intersects(NodeCheckFlags::CONTAINS_CLASS_WITH_PRIVATE_IDENTIFIERS)
        {
            let name = a.name(node);
            if !name.is_nil() && is_identifier(a, name) {
                self.error_skipped_on_no_emit(
                    node,
                    diagnostics::COMPILER_RESERVES_NAME_0_WHEN_EMITTING_PRIVATE_IDENTIFIER_DOWNLEVEL,
                    &[Arg::Str(a.text(name))],
                );
            }
        }
    }

    pub fn check_collision_with_global_promise_in_generated_code(
        &mut self,
        node: NodeId,
        name: NodeId,
    ) {
        let a = self.ast;
        if name.is_nil()
            || self.language_version >= ScriptTarget::ES2017
            || !self.need_collision_check_for_identifier(node, name, b"Promise")
        {
            return;
        }
        // Uninstantiated modules shouldn't do this check
        if is_module_declaration(a, node)
            && get_module_instance_state_exported(a, node) != ModuleInstanceState::INSTANTIATED
        {
            return;
        }
        // In case of variable declaration, node.parent is variable statement so look at the variable statement's parent
        let parent = get_declaration_container(a, node);
        if is_source_file(a, parent)
            && is_external_or_common_js_module(a, parent)
            && a.flags(parent).intersects(NodeFlags::HAS_ASYNC_FUNCTIONS)
        {
            // If the declaration happens to be in external module, report error that Promise is a reserved identifier.
            let name_text = declaration_name_to_string(a, name);
            self.error_skipped_on_no_emit(
                name,
                diagnostics::DUPLICATE_IDENTIFIER_0_COMPILER_RESERVES_NAME_1_IN_TOP_LEVEL_SCOPE_OF_A_MODULE_CONTAINING_ASYNC_FUNCTIONS,
                &[Arg::Str(&name_text), Arg::Str(&name_text)],
            );
        }
    }

    pub fn record_potential_collision_with_reflect_in_generated_code(
        &mut self,
        node: NodeId,
        name: NodeId,
    ) {
        if !name.is_nil()
            && self.language_version <= ScriptTarget::ES2021
            && self.need_collision_check_for_identifier(node, name, b"Reflect")
        {
            self.add_deferred_diagnostic(Box::new(move |c: &mut Checker<'a>| {
                c.check_reflect_collision(node);
            }));
        }
    }

    pub fn check_reflect_collision(&mut self, node: NodeId) {
        let a = self.ast;
        let mut has_collision = false;
        if is_class_expression(a, node) {
            // ClassExpression names don't contribute to their containers, but do matter for any of their block-scoped members.
            for &member in a.members(node).as_slice() {
                let links = self.node_links.get(member);
                if self.node_links[links]
                    .flags
                    .intersects(NodeCheckFlags::CONTAINS_SUPER_PROPERTY_IN_STATIC_INITIALIZER)
                {
                    has_collision = true;
                    break;
                }
            }
        } else if is_function_expression(a, node) {
            // FunctionExpression names don't contribute to their containers, but do matter for their contents
            let links = self.node_links.get(node);
            if self.node_links[links]
                .flags
                .intersects(NodeCheckFlags::CONTAINS_SUPER_PROPERTY_IN_STATIC_INITIALIZER)
            {
                has_collision = true;
            }
        } else {
            let container = get_enclosing_block_scope_container(a, node);
            if !container.is_nil() && {
                let links = self.node_links.get(container);
                self.node_links[links]
                    .flags
                    .intersects(NodeCheckFlags::CONTAINS_SUPER_PROPERTY_IN_STATIC_INITIALIZER)
            } {
                has_collision = true;
            }
        }
        if has_collision {
            let name = a.name(node);
            if !name.is_nil() && is_identifier(a, name) {
                let name_text = declaration_name_to_string(a, name);
                self.error_skipped_on_no_emit(
                    node,
                    diagnostics::DUPLICATE_IDENTIFIER_0_COMPILER_RESERVES_NAME_1_WHEN_EMITTING_SUPER_REFERENCES_IN_STATIC_INITIALIZERS,
                    &[Arg::Str(&name_text), Arg::Str(b"Reflect")],
                );
            }
        }
    }

    pub fn check_class_name_collision_with_object(&mut self, name: NodeId) {
        let a = self.ast;
        if a.text(name) == b"Object"
            && self
                .program
                .get_emit_module_format_of_file(get_source_file_of_node(a, name))
                < ModuleKind::ES2015
        {
            let module_kind_name = self.module_kind.string();
            self.error(
                name,
                diagnostics::CLASS_NAME_CANNOT_BE_OBJECT_WHEN_TARGETING_ES5_AND_ABOVE_WITH_MODULE_0,
                &[Arg::Str(&module_kind_name)],
            );
        }
    }
}
