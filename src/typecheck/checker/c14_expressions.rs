// checker.go:7419-8405 (layers E-CORE, E-ACCESS, E-LITERAL, E-CALL): the check of an expression with its cached, contextual and context free forms, the non-null checks, the instantiation of a generic function argument, the switch over the kinds of expressions, and the checks of private identifiers, super, template and regular expression literals, array literals, qualified names, element accesses and import calls.
use crate::ast::{
    Arg, Ast, FindAncestorResult, INTERNAL_SYMBOL_NAME_MISSING, Kind, ModifierFlags, NodeFlags,
    NodeId, SymbolFlags, SymbolId, find_ancestor_or_quit, get_class_extends_heritage_element,
    get_enclosing_block_scope_container, get_first_identifier, get_source_file_of_node,
    is_arrow_function, is_assertion_expression, is_assignment_target, is_await_expression,
    is_binding_pattern, is_boolean_literal, is_call_expression, is_call_or_new_expression,
    is_class_like, is_class_static_block_declaration, is_computed_property_name,
    is_const_type_reference, is_constructor_declaration, is_element_access_expression,
    is_entity_name_expression, is_export_specifier, is_external_or_common_js_module,
    is_for_in_statement, is_function_like_declaration, is_identifier, is_import_call,
    is_jsx_attributes, is_jsx_self_closing_element, is_literal_expression, is_new_expression,
    is_object_literal_expression, is_omitted_expression, is_parameter_declaration,
    is_parenthesized_expression, is_part_of_type_query, is_property_access_expression,
    is_property_assignment, is_property_declaration, is_qualified_name, is_require_call,
    is_source_file, is_spread_element, is_static, is_string_literal_like,
    is_tagged_template_expression, is_this_identifier, is_type_query_node,
    is_valid_type_only_alias_use_site, is_variable_declaration_list, node_kind_is,
    skip_parentheses, walk_up_parenthesized_expressions,
};
use crate::checker::{
    AccessFlags, AssignmentKind, CachedTypeKey, CachedTypeKind, CheckMode, Checker, ContextFlags,
    ElementFlags, IndexFlags, InferenceContextId, InferenceInfoId, InferencePriority, IterationUse,
    LiteralValue, MappedTypeModifiers, MappedTypeNameTypeKind, NodeCheckFlags, ObjectFlags,
    SignatureId, SignatureKind, TupleElementInfo, TypeAliasId, TypeComparer, TypeFacts, TypeFlags,
    TypeId, UnionReduction, entity_name_to_string, every_type, get_assignment_target_kind,
    get_declaration_modifier_flags_from_symbol, get_mapped_type_modifiers, get_super_container,
    has_inference_candidates, has_overlapping_inferences, is_call_chain, is_const_enum_object_type,
    is_in_right_side_of_import_or_export_assignment, is_this_type_parameter, new_inference_info,
    new_type_mapper, some_type,
};
use crate::core::{
    List, LiveList, Map, ScriptTarget, Text, concatenate, first_or_nil, if_else, or_else, some,
};
use crate::diagnostics::{self, MessageId};
use crate::jsnum::{from_string, new_pseudo_big_int, parse_pseudo_big_int};

// strconv.Itoa
fn itoa(value: isize) -> Vec<u8> {
    value.to_string().into_bytes()
}

impl<'a> Checker<'a> {
    pub fn check_expression_statement(&mut self, node: NodeId) {
        let a = self.ast;
        // Grammar checking
        self.check_grammar_statement_in_ambient_context(node);
        self.check_expression(a.expression(node));
    }

    // Returns the type of an expression. Unlike checkExpression, this function is simply concerned with computing the type and may not fully check all contained sub-expressions for errors.
    pub fn get_type_of_expression(&mut self, node: NodeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        // Don't bother caching types that require no flow analysis and are quick to compute.
        let quick_type = self.get_quick_type_of_expression(node);
        if !quick_type.is_nil() {
            return quick_type;
        }
        // If a type has been cached for the node, return it.
        let cached_type = self.flow_type_cache.get(&node);
        if !cached_type.is_nil() {
            return cached_type;
        }
        let start_invocation_count = self.flow_invocation_count;
        let t = self.check_expression_ex(node, CheckMode::TYPE_ONLY);
        // If control flow analysis was required to determine the type, it is worth caching.
        if self.flow_invocation_count != start_invocation_count {
            if self.flow_type_cache.is_nil() {
                self.flow_type_cache = Map::make();
            }
            let ok = self.flow_type_cache.set(node, t);
            self.map_set(ok);
        }
        t
    }

    // Returns the type of an expression. Unlike checkExpression, this function is simply concerned with computing the type and may not fully check all contained sub-expressions for errors.
    pub fn get_quick_type_of_expression(&mut self, node: NodeId) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let expr = skip_parentheses(a, node);
        if is_await_expression(a, expr) {
            let t = self.get_quick_type_of_expression(a.expression(expr));
            if !t.is_nil() {
                return self.get_awaited_type(t);
            }
            return TypeId::NIL;
        }
        // Optimize for the common case of a call to a function with a single non-generic call signature where we can just fetch the return type without checking the arguments.
        if is_call_expression(a, expr)
            && a.kind(a.expression(expr)) != Kind::SuperKeyword
            && !is_require_call(a, expr, true)
            && !self.is_symbol_or_symbol_for_call(expr)
            && !is_import_call(a, expr)
        {
            if is_call_chain(a, expr) {
                return self.get_return_type_of_single_non_generic_signature_of_call_chain(expr);
            }
            let func_type = self.check_non_null_expression(a.expression(expr));
            return self
                .get_return_type_of_single_non_generic_signature(func_type, SignatureKind::CALL);
        }
        if is_new_expression(a, expr) {
            let func_type = self.check_non_null_expression(a.expression(expr));
            return self.get_return_type_of_single_non_generic_signature(
                func_type,
                SignatureKind::CONSTRUCT,
            );
        }
        if is_assertion_expression(a, expr) && !is_const_type_reference(a, a.type_node(expr)) {
            return self.get_type_from_type_node(a.type_node(expr));
        }
        if is_literal_expression(a, node) || is_boolean_literal(a, node) {
            return self.check_expression(node);
        }
        TypeId::NIL
    }

    pub fn get_return_type_of_single_non_generic_signature(
        &mut self,
        func_type: TypeId,
        kind: SignatureKind,
    ) -> TypeId {
        let signature = self.get_single_signature(func_type, kind, true);
        if !signature.is_nil() && self.signatures[signature].type_parameters.len() == 0 {
            return self.get_return_type_of_signature(signature);
        }
        TypeId::NIL
    }

    pub fn get_return_type_of_single_non_generic_signature_of_call_chain(
        &mut self,
        expr: NodeId,
    ) -> TypeId {
        let a = self.ast;
        let func_type = self.check_expression(a.expression(expr));
        let non_optional_type = self.get_optional_expression_type(func_type, a.expression(expr));
        let return_type =
            self.get_return_type_of_single_non_generic_signature(func_type, SignatureKind::CALL);
        if !return_type.is_nil() {
            return self.propagate_optional_type_marker(
                return_type,
                expr,
                non_optional_type != func_type,
            );
        }
        TypeId::NIL
    }

    pub fn check_non_null_expression(&mut self, node: NodeId) -> TypeId {
        let t = self.check_expression(node);
        self.check_non_null_type(t, node)
    }

    pub fn check_non_null_type(&mut self, t: TypeId, node: NodeId) -> TypeId {
        self.check_non_null_type_with_reporter(
            t,
            node,
            Self::report_object_possibly_null_or_undefined_error,
        )
    }

    pub fn check_non_null_type_with_reporter(
        &mut self,
        t: TypeId,
        node: NodeId,
        report_error: impl FnOnce(&mut Checker<'a>, NodeId, TypeFacts),
    ) -> TypeId {
        let a = self.ast;
        if self.strict_null_checks && self.types[t].flags.intersects(TypeFlags::UNKNOWN) {
            if is_entity_name_expression(a, node) {
                let node_text = entity_name_to_string(a, node);
                if node_text.len() < 100 {
                    self.error(
                        node,
                        diagnostics::X_0_IS_OF_TYPE_UNKNOWN,
                        &[Arg::Str(&node_text)],
                    );
                    return self.error_type;
                }
            }
            self.error(node, diagnostics::OBJECT_IS_OF_TYPE_UNKNOWN, &[]);
            return self.error_type;
        }
        let facts = self.get_type_facts(t, TypeFacts::IS_UNDEFINED_OR_NULL);
        if facts.intersects(TypeFacts::IS_UNDEFINED_OR_NULL) {
            report_error(self, node, facts);
            let non_nullable = self.get_non_nullable_type(t);
            if self.types[non_nullable]
                .flags
                .intersects(TypeFlags::NULLABLE | TypeFlags::NEVER)
            {
                return self.error_type;
            }
            return non_nullable;
        }
        t
    }

    pub fn check_non_null_non_void_type(&mut self, t: TypeId, node: NodeId) -> TypeId {
        let a = self.ast;
        let non_null_type = self.check_non_null_type(t, node);
        if self.types[non_null_type].flags.intersects(TypeFlags::VOID) {
            if is_entity_name_expression(a, node) {
                let node_text = entity_name_to_string(a, node);
                if is_identifier(a, node) && node_text == b"undefined" {
                    self.error(
                        node,
                        diagnostics::THE_VALUE_0_CANNOT_BE_USED_HERE,
                        &[Arg::Str(&node_text)],
                    );
                    return non_null_type;
                }
                if node_text.len() < 100 {
                    self.error(
                        node,
                        diagnostics::X_0_IS_POSSIBLY_UNDEFINED,
                        &[Arg::Str(&node_text)],
                    );
                    return non_null_type;
                }
            }
            self.error(node, diagnostics::OBJECT_IS_POSSIBLY_UNDEFINED, &[]);
        }
        non_null_type
    }

    pub fn report_object_possibly_null_or_undefined_error(
        &mut self,
        node: NodeId,
        facts: TypeFacts,
    ) {
        let a = self.ast;
        let mut node_text: Vec<u8> = Vec::new();
        if is_entity_name_expression(a, node) {
            node_text = entity_name_to_string(a, node);
        }
        if a.kind(node) == Kind::NullKeyword {
            self.error(
                node,
                diagnostics::THE_VALUE_0_CANNOT_BE_USED_HERE,
                &[Arg::Str(b"null")],
            );
            return;
        }
        if !node_text.is_empty() && node_text.len() < 100 {
            if is_identifier(a, node) && node_text == b"undefined" {
                self.error(
                    node,
                    diagnostics::THE_VALUE_0_CANNOT_BE_USED_HERE,
                    &[Arg::Str(b"undefined")],
                );
                return;
            }
            let message = if_else(
                facts.intersects(TypeFacts::IS_UNDEFINED),
                if_else(
                    facts.intersects(TypeFacts::IS_NULL),
                    diagnostics::X_0_IS_POSSIBLY_NULL_OR_UNDEFINED,
                    diagnostics::X_0_IS_POSSIBLY_UNDEFINED,
                ),
                diagnostics::X_0_IS_POSSIBLY_NULL,
            );
            self.error(node, message, &[Arg::Str(&node_text)]);
        } else {
            let message = if_else(
                facts.intersects(TypeFacts::IS_UNDEFINED),
                if_else(
                    facts.intersects(TypeFacts::IS_NULL),
                    diagnostics::OBJECT_IS_POSSIBLY_NULL_OR_UNDEFINED,
                    diagnostics::OBJECT_IS_POSSIBLY_UNDEFINED,
                ),
                diagnostics::OBJECT_IS_POSSIBLY_NULL,
            );
            self.error(node, message, &[]);
        }
    }

    pub fn check_expression_with_contextual_type(
        &mut self,
        node: NodeId,
        contextual_type: TypeId,
        inference_context: InferenceContextId,
        check_mode: CheckMode,
    ) -> TypeId {
        let context_node = self.get_context_node(node);
        self.push_contextual_type(context_node, contextual_type, false);
        self.push_inference_context(context_node, inference_context);
        let mut t = self.check_expression_ex(
            node,
            check_mode
                | CheckMode::CONTEXTUAL
                | if_else(
                    !inference_context.is_nil(),
                    CheckMode::INFERENTIAL,
                    CheckMode::NONE,
                ),
        );
        // In CheckMode.Inferential we collect intra-expression inference sites to process before fixing any type parameters. This information is no longer needed after the call to checkExpression.
        if !inference_context.is_nil()
            && !self.inference_contexts[inference_context]
                .intra_expression_inference_sites
                .is_empty()
        {
            self.inference_contexts[inference_context].intra_expression_inference_sites =
                Vec::new();
        }
        // We strip literal freshness when an appropriate contextual type is present such that contextually typed literals always preserve their literal types (otherwise they might widen during type inference). An alternative here would be to not mark contextually typed literals as fresh in the first place.
        if self.maybe_type_of_kind(t, TypeFlags::LITERAL) {
            let instantiated_type =
                self.instantiate_contextual_type(contextual_type, node, ContextFlags::NONE);
            if self.is_literal_of_contextual_type(t, instantiated_type) {
                t = self.get_regular_type_of_literal_type(t);
            }
        }
        self.pop_inference_context();
        self.pop_contextual_type();
        t
    }

    pub fn get_context_node(&self, node: NodeId) -> NodeId {
        let a = self.ast;
        if is_jsx_attributes(a, node) && !is_jsx_self_closing_element(a, a.parent(node)) {
            // Needs to be the root JsxElement, so it encompasses the attributes _and_ the children (which are essentially part of the attributes)
            return a.parent(a.parent(node));
        }
        node
    }

    pub fn check_expression_cached(&mut self, node: NodeId) -> TypeId {
        self.check_expression_cached_ex(node, CheckMode::NORMAL)
    }

    pub fn check_expression_cached_ex(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        if check_mode != CheckMode::NORMAL {
            return self.check_expression_ex(node, check_mode);
        }
        let links = self.type_node_links.get(node);
        if self.type_node_links[links].resolved_type.is_nil() {
            // When computing a type that we're going to cache, we need to ignore any ongoing control flow analysis because variables may have transient types in indeterminable states. Moving flowLoopStart to the top of the stack ensures all transient types are computed from a known point.
            let save_flow_loop_stack = std::mem::take(&mut self.flow_loop_stack);
            let save_flow_type_cache = std::mem::take(&mut self.flow_type_cache);
            let resolved_type = self.check_expression_ex(node, check_mode);
            self.type_node_links[links].resolved_type = resolved_type;
            self.flow_type_cache = save_flow_type_cache;
            self.flow_loop_stack = save_flow_loop_stack;
        }
        self.type_node_links[links].resolved_type
    }

    // Returns the type of an expression. Unlike checkExpression, this function is simply concerned with computing the type and may not fully check all contained sub-expressions for errors. It is intended for uses where you know there is no contextual type, and requesting the contextual type might cause a circularity or other bad behaviour. It sets the contextual type of the node to any before calling getTypeOfExpression.
    pub fn get_context_free_type_of_expression(&mut self, node: NodeId) -> TypeId {
        let cached = self.context_free_types.get(&node);
        if !cached.is_nil() {
            return cached;
        }
        let any_type = self.any_type;
        self.push_contextual_type(node, any_type, false);
        let t = self.check_expression_ex(node, CheckMode::SKIP_CONTEXT_SENSITIVE);
        let ok = self.context_free_types.set(node, t);
        self.map_set(ok);
        self.pop_contextual_type();
        t
    }

    pub fn check_expression(&mut self, node: NodeId) -> TypeId {
        self.check_expression_ex(node, CheckMode::NORMAL)
    }

    pub fn check_expression_ex(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let save_current_node = self.current_node;
        self.current_node = node;
        self.instantiation_count = 0;
        let uninstantiated_type = self.check_expression_worker(node, check_mode);
        let t = self.instantiate_type_with_single_generic_call_signature(
            node,
            uninstantiated_type,
            check_mode,
        );
        if is_const_enum_object_type(self, t) {
            self.check_const_enum_access(node, t);
        }
        self.current_node = save_current_node;
        t
    }

    pub fn check_const_enum_access(&mut self, node: NodeId, t: TypeId) {
        let a = self.ast;
        let parent = a.parent(node);
        // enum object type for const enums are only permitted in: 'left' in property access, 'object' in indexed access, target in rhs of import statement. We allow reexporting const enums.
        let ok = is_property_access_expression(a, parent) && a.expression(parent) == node
            || is_element_access_expression(a, parent) && a.expression(parent) == node
            || ((is_identifier(a, node) || is_qualified_name(a, node))
                && is_in_right_side_of_import_or_export_assignment(a, node)
                || is_type_query_node(a, parent) && a.as_type_query_node(parent).expr_name == node)
            || is_export_specifier(a, parent);
        if !ok {
            self.error(
                node,
                diagnostics::X_CONST_ENUMS_CAN_ONLY_BE_USED_IN_PROPERTY_OR_INDEX_ACCESS_EXPRESSIONS_OR_THE_RIGHT_HAND_SIDE_OF_AN_IMPORT_DECLARATION_OR_EXPORT_ASSIGNMENT_OR_TYPE_QUERY,
                &[],
            );
        }
        // --verbatimModuleSyntax only gets checked here when the enum usage does not resolve to an import, because imports of ambient const enums get checked separately in `checkAliasSymbol`.
        if self.compiler_options.isolated_modules.is_true()
            || self.compiler_options.verbatim_module_syntax.is_true()
                && ok
                && self
                    .resolve_name(
                        node,
                        a.text(get_first_identifier(a, node)),
                        SymbolFlags::ALIAS,
                        MessageId::NIL,
                        false,
                        true,
                    )
                    .is_nil()
        {
            let symbol = self.types[t].symbol;
            self.assert(
                a.sym(symbol).flags.intersects(SymbolFlags::CONST_ENUM),
                "t.symbol.Flags&ast.SymbolFlagsConstEnum != 0",
            );
            let const_enum_declaration = a.sym(symbol).value_declaration;
            if const_enum_declaration.is_nil() {
                // Upstream reads the file and the flags of the value declaration without a nil test.
                let _: () =
                    self.fail("nil ValueDeclaration of a const enum in checkConstEnumAccess");
                return;
            }
            let redirect =
                self.program
                    .get_project_reference_from_output_dts(get_source_file_of_node(
                        a,
                        const_enum_declaration,
                    ));
            if a.flags(const_enum_declaration)
                .intersects(NodeFlags::AMBIENT)
                && !is_valid_type_only_alias_use_site(a, node)
                && match redirect {
                    None => true,
                    Some(redirect) => match redirect.resolved {
                        Some(resolved) => {
                            !resolved.compiler_options().should_preserve_const_enums()
                        }
                        None => !self.fail::<bool>(
                            "nil CompilerOptions of a project reference in checkConstEnumAccess",
                        ),
                    },
                }
            {
                let flag_name = self.get_isolated_modules_like_flag_name();
                self.error(
                    node,
                    diagnostics::CANNOT_ACCESS_AMBIENT_CONST_ENUMS_WHEN_0_IS_ENABLED,
                    &[Arg::Str(flag_name)],
                );
            }
        }
    }

    pub fn instantiate_type_with_single_generic_call_signature(
        &mut self,
        node: NodeId,
        t: TypeId,
        check_mode: CheckMode,
    ) -> TypeId {
        if !check_mode.intersects(CheckMode::INFERENTIAL | CheckMode::SKIP_GENERIC_FUNCTIONS) {
            return t;
        }
        let call_signature = self.get_single_signature(t, SignatureKind::CALL, true);
        let construct_signature = self.get_single_signature(t, SignatureKind::CONSTRUCT, true);
        let signature = or_else(call_signature, construct_signature);
        if signature.is_nil() || self.signatures[signature].type_parameters.len() == 0 {
            return t;
        }
        let contextual_type =
            self.get_apparent_type_of_contextual_type(node, ContextFlags::NO_CONSTRAINTS);
        if contextual_type.is_nil() {
            return t;
        }
        let non_nullable_type = self.get_non_nullable_type(contextual_type);
        let contextual_signature = self.get_single_signature(
            non_nullable_type,
            if_else(
                !call_signature.is_nil(),
                SignatureKind::CALL,
                SignatureKind::CONSTRUCT,
            ),
            false,
        );
        if contextual_signature.is_nil()
            || self.signatures[contextual_signature].type_parameters.len() != 0
        {
            return t;
        }
        if check_mode.intersects(CheckMode::SKIP_GENERIC_FUNCTIONS) {
            self.skipped_generic_function(node, check_mode);
            return self.any_function_type;
        }
        let context = self.get_inference_context(node);
        // We have an expression that is an argument of a generic function for which we are performing type argument inference. The expression is of a function type with a single generic call signature and a contextual function type with a single non-generic call signature. Now check if the outer function returns a function type with a single non-generic call signature and if some of the outer function type parameters have no inferences so far. If so, we can potentially add inferred type parameters to the outer function return type.
        let mut return_signature = SignatureId::NIL;
        let context_signature = self.inference_contexts[context].signature;
        if !context_signature.is_nil() {
            let return_type = self.get_return_type_of_signature(context_signature);
            if !return_type.is_nil() {
                return_signature = self.get_single_call_or_construct_signature(return_type);
            }
        }
        if !return_signature.is_nil()
            && self.signatures[return_signature].type_parameters.len() == 0
            && !self.inference_contexts[context]
                .inferences
                .iter()
                .all(|info| has_inference_candidates(self, info))
        {
            // Instantiate the signature with its own type parameters as type arguments, possibly renaming the type parameters to ensure they have unique names.
            let type_parameters = self.signatures[signature].type_parameters;
            let unique_type_parameters = self.get_unique_type_parameters(context, type_parameters);
            let instantiated_signature = self
                .get_signature_instantiation_without_filling_in_type_arguments(
                    signature,
                    unique_type_parameters,
                );
            // Infer from the parameters of the instantiated signature to the parameters of the contextual signature starting with an empty set of inference candidates.
            let context_inferences = self.inference_contexts[context].inferences;
            let inferences: LiveList<'a, InferenceInfoId> = if context_inferences.is_nil() {
                LiveList::NIL
            } else {
                let mut infos: Vec<InferenceInfoId> = Vec::new();
                for info in context_inferences.iter() {
                    let type_parameter = self.inference_infos[info].type_parameter;
                    infos.push(new_inference_info(self, type_parameter));
                }
                self.live_list(&infos)
            };
            self.apply_to_parameter_types(
                instantiated_signature,
                contextual_signature,
                &mut |c, source, target| {
                    c.infer_types(inferences, source, target, InferencePriority::NONE, true);
                },
            );
            if inferences
                .iter()
                .any(|info| has_inference_candidates(self, info))
            {
                // We have inference candidates, indicating that one or more type parameters are referenced in the parameter types of the contextual signature. Now also infer from the return type.
                self.apply_to_return_types(
                    instantiated_signature,
                    contextual_signature,
                    &mut |c, source, target| {
                        c.infer_types(inferences, source, target, InferencePriority::NONE, false);
                    },
                );
                // If the type parameters for which we produced candidates do not have any inferences yet, we adopt the new inference candidates and add the type parameters of the expression type to the set of inferred type parameters for the outer function return type.
                let context_inferences = self.inference_contexts[context].inferences;
                if !has_overlapping_inferences(self, context_inferences, inferences) {
                    self.merge_inferences(context_inferences, inferences);
                    let inferred_type_parameters =
                        self.inference_contexts[context].inferred_type_parameters;
                    let inferred_type_parameters =
                        self.concatenate(inferred_type_parameters, unique_type_parameters);
                    self.inference_contexts[context].inferred_type_parameters =
                        inferred_type_parameters;
                    return self.get_or_create_type_from_signature(instantiated_signature);
                }
            }
        }
        // The signature may reference any outer inference contexts, but we map pop off and then apply new inference contexts, and thus get different inferred types. That this is cached on the *first* such attempt is not currently an issue, since expression types *also* get cached on the first pass. If we ever properly speculate, though, the cached "isolatedSignatureType" signature field absolutely needs to be included in the list of speculative caches.
        let instantiated_signature = self.instantiate_signature_in_context_of(
            signature,
            contextual_signature,
            context,
            TypeComparer::Nil,
        );
        self.get_or_create_type_from_signature(instantiated_signature)
    }

    pub fn get_outer_inference_type_parameters(&self) -> List<'a, TypeId> {
        let mut result: Vec<TypeId> = Vec::new();
        for info in &self.inference_context_infos {
            let context = info.context;
            if !context.is_nil() {
                for inference in self.inference_contexts[context].inferences.iter() {
                    result.push(self.inference_infos[inference].type_parameter);
                }
            }
        }
        self.list(&result)
    }

    pub fn get_unique_type_parameters(
        &mut self,
        context: InferenceContextId,
        type_parameters: List<'_, TypeId>,
    ) -> List<'a, TypeId> {
        let a = self.ast;
        let mut old_type_parameters: Vec<TypeId> = Vec::new();
        let mut new_type_parameters: Vec<TypeId> = Vec::new();
        let mut result: Vec<TypeId> = Vec::with_capacity(type_parameters.as_slice().len());
        for &tp in type_parameters.as_slice() {
            let name = a.sym(self.types[tp].symbol).name;
            let inferred_type_parameters =
                self.inference_contexts[context].inferred_type_parameters;
            if has_type_parameter_by_name(self, inferred_type_parameters.as_slice(), name)
                || has_type_parameter_by_name(self, &result, name)
            {
                let existing = concatenate(inferred_type_parameters.as_slice(), &result);
                let new_name = get_unique_type_parameter_name(self, &existing, name);
                let new_name = self.text(&new_name);
                let symbol = self.new_symbol(SymbolFlags::TYPE_PARAMETER, new_name);
                let new_type_parameter = self.new_type_parameter(symbol);
                self.as_type_parameter_mut(new_type_parameter).target = tp;
                old_type_parameters.push(tp);
                new_type_parameters.push(new_type_parameter);
                result.push(new_type_parameter);
            } else {
                result.push(tp);
            }
        }
        if !new_type_parameters.is_empty() {
            let sources = self.list_of(&old_type_parameters);
            let targets = self.list_of(&new_type_parameters);
            let mapper = new_type_mapper(self, sources, targets);
            for &tp in &new_type_parameters {
                self.as_type_parameter_mut(tp).mapper = mapper;
            }
        }
        self.list_of(&result)
    }
}

pub fn has_type_parameter_by_name(
    c: &Checker<'_>,
    type_parameters: &[TypeId],
    name: &[u8],
) -> bool {
    let a = c.ast;
    some(type_parameters, |tp| a.sym(c.types[tp].symbol).name == name)
}

pub fn get_unique_type_parameter_name(
    c: &Checker<'_>,
    type_parameters: &[TypeId],
    base_name: &[u8],
) -> Vec<u8> {
    let mut base_name = base_name;
    while base_name.len() > 1 {
        match base_name.split_last() {
            Some((last, rest)) if last.is_ascii_digit() => base_name = rest,
            _ => break,
        }
    }
    let mut index: isize = 1;
    loop {
        let augmented_name = [base_name, itoa(index).as_slice()].concat();
        if !has_type_parameter_by_name(c, type_parameters, &augmented_name) {
            return augmented_name;
        }
        index += 1;
    }
}

impl<'a> Checker<'a> {
    pub fn check_expression_worker(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let a = self.ast;
        match a.kind(node) {
            Kind::Identifier => self.check_identifier(node, check_mode),
            Kind::PrivateIdentifier => self.check_private_identifier_expression(node),
            Kind::ThisKeyword => self.check_this_expression(node),
            Kind::SuperKeyword => self.check_super_expression(node),
            Kind::NullKeyword => self.null_widening_type,
            Kind::StringLiteral | Kind::NoSubstitutionTemplateLiteral => {
                if self.is_skip_direct_inference_node(node) {
                    return self.blocked_string_type;
                }
                let t = self.get_string_literal_type(a.text(node));
                self.get_fresh_type_of_literal_type(t)
            }
            Kind::NumericLiteral => {
                self.check_grammar_numeric_literal(node);
                let t = self.get_number_literal_type(from_string(a.text(node)));
                self.get_fresh_type_of_literal_type(t)
            }
            Kind::BigIntLiteral => {
                self.check_grammar_big_int_literal(node);
                let value = match parse_pseudo_big_int(a.text(node)) {
                    Ok(digits) => new_pseudo_big_int(&digits, false),
                    Err(message) => return self.fail(message),
                };
                let t = self.get_big_int_literal_type(value);
                self.get_fresh_type_of_literal_type(t)
            }
            Kind::TrueKeyword => self.true_type,
            Kind::FalseKeyword => self.false_type,
            Kind::TemplateExpression => self.check_template_expression(node),
            Kind::RegularExpressionLiteral => self.check_regular_expression_literal(node),
            Kind::ArrayLiteralExpression => self.check_array_literal(node, check_mode),
            Kind::ObjectLiteralExpression => self.check_object_literal(node, check_mode),
            Kind::PropertyAccessExpression => {
                self.check_property_access_expression(node, check_mode, false)
            }
            Kind::QualifiedName => self.check_qualified_name(node, check_mode),
            Kind::ElementAccessExpression => self.check_indexed_access(node, check_mode),
            Kind::CallExpression => {
                if is_import_call(a, node) {
                    return self.check_import_call_expression(node);
                }
                self.check_call_expression(node, check_mode)
            }
            Kind::NewExpression => self.check_call_expression(node, check_mode),
            Kind::TaggedTemplateExpression => self.check_tagged_template_expression(node),
            Kind::ParenthesizedExpression => self.check_parenthesized_expression(node, check_mode),
            Kind::ClassExpression => self.check_class_expression(node),
            Kind::FunctionExpression | Kind::ArrowFunction => {
                self.check_function_expression_or_object_literal_method(node, check_mode)
            }
            Kind::TypeAssertionExpression | Kind::AsExpression => {
                self.check_assertion(node, check_mode)
            }
            Kind::TypeOfExpression => self.check_type_of_expression(node),
            Kind::NonNullExpression => self.check_non_null_assertion(node),
            Kind::ExpressionWithTypeArguments => self.check_expression_with_type_arguments(node),
            Kind::SatisfiesExpression => self.check_satisfies_expression(node),
            Kind::MetaProperty => self.check_meta_property(node),
            Kind::DeleteExpression => self.check_delete_expression(node),
            Kind::VoidExpression => self.check_void_expression(node),
            Kind::AwaitExpression => self.check_await_expression(node),
            Kind::PrefixUnaryExpression => self.check_prefix_unary_expression(node),
            Kind::PostfixUnaryExpression => self.check_postfix_unary_expression(node),
            Kind::BinaryExpression => self.check_binary_expression(node, check_mode),
            Kind::ConditionalExpression => self.check_conditional_expression(node, check_mode),
            Kind::SpreadElement => self.check_spread_expression(node, check_mode),
            Kind::OmittedExpression => self.undefined_widening_type,
            Kind::YieldExpression => self.check_yield_expression(node),
            Kind::SyntheticExpression => self.check_synthetic_expression(node),
            Kind::JsxExpression => self.check_jsx_expression(node, check_mode),
            Kind::JsxElement => self.check_jsx_element(node, check_mode),
            Kind::JsxSelfClosingElement => self.check_jsx_self_closing_element(node, check_mode),
            Kind::JsxFragment => self.check_jsx_fragment(node),
            Kind::JsxAttributes => self.check_jsx_attributes(node, check_mode),
            Kind::JsxOpeningElement => self.fail("Should never directly check a JsxOpeningElement"),
            _ => self.error_type,
        }
    }

    pub fn check_private_identifier_expression(&mut self, node: NodeId) -> TypeId {
        self.check_grammar_private_identifier_expression(node);
        let symbol = self.get_symbol_for_private_identifier_expression(node);
        if !symbol.is_nil() {
            self.mark_property_as_referenced(symbol, NodeId::NIL, false);
        }
        self.any_type
    }

    pub fn get_symbol_for_private_identifier_expression(&mut self, node: NodeId) -> SymbolId {
        let a = self.ast;
        let links = self.symbol_node_links.get(node);
        if self.symbol_node_links[links].resolved_symbol.is_nil() {
            let resolved_symbol =
                self.lookup_symbol_for_private_identifier_declaration(a.text(node), node);
            self.symbol_node_links[links].resolved_symbol = resolved_symbol;
        }
        self.symbol_node_links[links].resolved_symbol
    }

    pub fn check_super_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let is_call_expression =
            is_call_expression(a, a.parent(node)) && a.expression(a.parent(node)) == node;
        let immediate_container = get_super_container(a, node, true);
        let mut container = immediate_container;
        // adjust the container reference in case if super is used inside arrow functions with arbitrarily deep nesting
        if !is_call_expression {
            while !container.is_nil() && is_arrow_function(a, container) {
                container = get_super_container(a, container, true);
            }
        }
        let is_legal_usage_of_super_expression = || -> bool {
            if is_call_expression {
                // TS 1.0 SPEC (April 2014): 4.8.1 Super calls are only permitted in constructors of derived classes
                return is_constructor_declaration(a, container);
            }
            // TS 1.0 SPEC (April 2014): 'super' property access is allowed in a constructor, instance member function, instance member accessor, or instance member variable initializer where this references a derived class instance, and in a static member function or static member accessor; topmost container must be something that is directly nested in the class declaration\object literal expression
            if is_class_like(a, a.parent(container))
                || is_object_literal_expression(a, a.parent(container))
            {
                if is_static(a, container) {
                    return node_kind_is(
                        a,
                        container,
                        &[
                            Kind::MethodDeclaration,
                            Kind::MethodSignature,
                            Kind::GetAccessor,
                            Kind::SetAccessor,
                            Kind::PropertyDeclaration,
                            Kind::ClassStaticBlockDeclaration,
                        ],
                    );
                }
                return node_kind_is(
                    a,
                    container,
                    &[
                        Kind::MethodDeclaration,
                        Kind::MethodSignature,
                        Kind::GetAccessor,
                        Kind::SetAccessor,
                        Kind::PropertyDeclaration,
                        Kind::PropertySignature,
                        Kind::Constructor,
                    ],
                );
            }
            false
        };
        if container.is_nil() || !is_legal_usage_of_super_expression() {
            // issue more specific error if super is used in computed property name: class A { foo() { return "1" }} class B { [super.foo()]() {} }
            let current = find_ancestor_or_quit(a, node, |n| {
                if n == container {
                    return FindAncestorResult::QUIT;
                }
                if is_computed_property_name(a, n) {
                    return FindAncestorResult::TRUE;
                }
                FindAncestorResult::FALSE
            });
            if !current.is_nil() && is_computed_property_name(a, current) {
                self.error(
                    node,
                    diagnostics::X_SUPER_CANNOT_BE_REFERENCED_IN_A_COMPUTED_PROPERTY_NAME,
                    &[],
                );
            } else if is_call_expression {
                self.error(
                    node,
                    diagnostics::SUPER_CALLS_ARE_NOT_PERMITTED_OUTSIDE_CONSTRUCTORS_OR_IN_NESTED_FUNCTIONS_INSIDE_CONSTRUCTORS,
                    &[],
                );
            } else if container.is_nil()
                || a.parent(container).is_nil()
                || !(is_class_like(a, a.parent(container))
                    || is_object_literal_expression(a, a.parent(container)))
            {
                self.error(
                    node,
                    diagnostics::X_SUPER_CAN_ONLY_BE_REFERENCED_IN_MEMBERS_OF_DERIVED_CLASSES_OR_OBJECT_LITERAL_EXPRESSIONS,
                    &[],
                );
            } else {
                self.error(
                    node,
                    diagnostics::X_SUPER_PROPERTY_ACCESS_IS_PERMITTED_ONLY_IN_A_CONSTRUCTOR_MEMBER_FUNCTION_OR_MEMBER_ACCESSOR_OF_A_DERIVED_CLASS,
                    &[],
                );
            }
            return self.error_type;
        }
        if !is_call_expression && is_constructor_declaration(a, immediate_container) {
            self.check_this_before_super(
                node,
                container,
                diagnostics::X_SUPER_MUST_BE_CALLED_BEFORE_ACCESSING_A_PROPERTY_OF_SUPER_IN_THE_CONSTRUCTOR_OF_A_DERIVED_CLASS,
            );
        }
        if a.kind(a.parent(container)) == Kind::ObjectLiteralExpression {
            // for object literal assume that type of 'super' is 'any'
            return self.any_type;
        }
        // at this point the only legal case for parent is ClassLikeDeclaration
        let class_like_declaration = a.parent(container);
        if get_class_extends_heritage_element(a, class_like_declaration).is_nil() {
            self.error(
                node,
                diagnostics::X_SUPER_CAN_ONLY_BE_REFERENCED_IN_A_DERIVED_CLASS,
                &[],
            );
            return self.error_type;
        }
        if self.class_declaration_extends_null(class_like_declaration) {
            if is_call_expression {
                return self.error_type;
            }
            return self.null_widening_type;
        }
        let class_symbol = self.get_symbol_of_declaration(class_like_declaration);
        let class_type = self.get_declared_type_of_symbol(class_symbol);
        let mut base_class_type = TypeId::NIL;
        if !class_type.is_nil() {
            base_class_type = first_or_nil(self.get_base_types(class_type).as_slice());
        }
        if base_class_type.is_nil() {
            return self.error_type;
        }
        if is_constructor_declaration(a, container)
            && self.is_in_constructor_argument_initializer(node, container)
        {
            // issue custom error message for super property access in constructor arguments (to be aligned with old compiler)
            self.error(
                node,
                diagnostics::X_SUPER_CANNOT_BE_REFERENCED_IN_CONSTRUCTOR_ARGUMENTS,
                &[],
            );
            return self.error_type;
        }
        if is_static(a, container) || is_call_expression {
            if !is_call_expression
                && self.language_version <= ScriptTarget::ES2021
                && (is_property_declaration(a, container)
                    || is_class_static_block_declaration(a, container))
            {
                // for `super.x` or `super[x]` in a static initializer, mark all enclosing block scope containers so that we can report potential collisions with `Reflect`.
                let mut current = get_enclosing_block_scope_container(a, a.parent(node));
                while !current.is_nil() {
                    if !is_source_file(a, current) || is_external_or_common_js_module(a, current) {
                        let links = self.node_links.get(current);
                        self.node_links[links].flags |=
                            NodeCheckFlags::CONTAINS_SUPER_PROPERTY_IN_STATIC_INITIALIZER;
                    }
                    current = get_enclosing_block_scope_container(a, current);
                }
            }
            return self.get_base_constructor_type_of_class(class_type);
        }
        let this_type = self.as_interface_type(class_type).this_type;
        self.get_type_with_this_argument(base_class_type, this_type, false)
    }

    pub fn is_in_constructor_argument_initializer(
        &self,
        node: NodeId,
        constructor_decl: NodeId,
    ) -> bool {
        let a = self.ast;
        !find_ancestor_or_quit(a, node, |n| {
            if is_function_like_declaration(a, n) {
                return FindAncestorResult::QUIT;
            }
            if is_parameter_declaration(a, n) && a.parent(n) == constructor_decl {
                return FindAncestorResult::TRUE;
            }
            FindAncestorResult::FALSE
        })
        .is_nil()
    }

    pub fn check_template_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let expr = a.as_template_expression(node);
        let spans = a.nodes(expr.template_spans);
        let length = spans.as_slice().len();
        let mut texts: Vec<&[u8]> = Vec::with_capacity(length + 1);
        let mut types: Vec<TypeId> = Vec::with_capacity(length);
        texts.push(a.text(expr.head));
        for &span in spans.as_slice() {
            let t = self.check_expression(a.expression(span));
            if self.maybe_type_of_kind_considering_base_constraint(t, TypeFlags::ES_SYMBOL_LIKE) {
                self.error(
                    a.expression(span),
                    diagnostics::IMPLICIT_CONVERSION_OF_A_SYMBOL_TO_A_STRING_WILL_FAIL_AT_RUNTIME_CONSIDER_WRAPPING_THIS_EXPRESSION_IN_STRING,
                    &[],
                );
            }
            texts.push(a.text(a.as_template_span(span).literal));
            let template_constraint_type = self.template_constraint_type;
            let assignable = self.is_type_assignable_to(t, template_constraint_type);
            types.push(if_else(assignable, t, self.string_type));
        }
        let mut evaluated = LiteralValue::Nil;
        if !is_tagged_template_expression(a, a.parent(node)) {
            evaluated = self.evaluate(node, node).value;
        }
        if !matches!(evaluated, LiteralValue::Nil) {
            // `evaluated.(string)` is a type assertion: another kind of value is a fault.
            let value: Text<'a> = match evaluated {
                LiteralValue::String(value) => value,
                _ => {
                    self.bad_cast("evaluated.(string)");
                    b""
                }
            };
            let t = self.get_string_literal_type(value);
            return self.get_fresh_type_of_literal_type(t);
        }
        if self.is_const_context(node) || self.is_template_literal_context(node) || {
            let contextual_type = self.get_contextual_type(node, ContextFlags::NONE);
            let contextual_type = or_else(contextual_type, self.unknown_type);
            some_type(self, contextual_type, &mut |c, t| {
                c.is_template_literal_contextual_type(t)
            })
        } {
            return self.get_template_literal_type(&texts, List::from_slice(&types));
        }
        self.string_type
    }

    pub fn is_template_literal_context(&self, node: NodeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let parent = a.parent(node);
        is_parenthesized_expression(a, parent) && self.is_template_literal_context(parent)
            || is_element_access_expression(a, parent)
                && a.as_element_access_expression(parent).argument_expression == node
    }

    pub fn is_template_literal_contextual_type(&mut self, t: TypeId) -> bool {
        let flags = self.types[t].flags;
        flags.intersects(TypeFlags::STRING_LITERAL | TypeFlags::TEMPLATE_LITERAL)
            || flags.intersects(TypeFlags::INSTANTIABLE_NON_PRIMITIVE) && {
                let constraint = self.get_base_constraint_of_type(t);
                self.maybe_type_of_kind(
                    or_else(constraint, self.unknown_type),
                    TypeFlags::STRING_LIKE,
                )
            }
    }

    pub fn check_regular_expression_literal(&mut self, node: NodeId) -> TypeId {
        let node_links = self.node_links.get(node);
        if !self.node_links[node_links]
            .flags
            .intersects(NodeCheckFlags::TYPE_CHECKED)
        {
            self.node_links[node_links].flags |= NodeCheckFlags::TYPE_CHECKED;
            self.check_grammar_regular_expression_literal(node);
        }
        self.global_reg_exp_type
    }

    pub fn check_array_literal(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let a = self.ast;
        let elements = a.elements(node);
        let mut element_types: Vec<TypeId> = Vec::with_capacity(elements.as_slice().len());
        let mut element_infos: Vec<TupleElementInfo> =
            Vec::with_capacity(elements.as_slice().len());
        self.push_cached_contextual_type(node);
        let in_destructuring_pattern = is_assignment_target(a, node);
        let in_const_context = self.is_const_context(node);
        let contextual_type = self.get_apparent_type_of_contextual_type(node, ContextFlags::NONE);
        let in_tuple_context = is_spread_into_call_or_new(a, node)
            || !contextual_type.is_nil()
                && some_type(self, contextual_type, &mut |c, t| {
                    if c.is_tuple_like_type(t) {
                        return true;
                    }
                    if !c.is_generic_mapped_type(t) || !c.as_mapped_type(t).name_type.is_nil() {
                        return false;
                    }
                    let target = or_else(c.as_mapped_type(t).target, t);
                    !c.get_homomorphic_type_variable(target).is_nil()
                });
        let mut has_omitted_expression = false;
        for &e in elements.as_slice() {
            if is_spread_element(a, e) {
                let spread_type = self.check_expression_ex(a.expression(e), check_mode);
                if self.is_array_like_type(spread_type) {
                    element_types.push(spread_type);
                    element_infos.push(TupleElementInfo {
                        flags: ElementFlags::VARIADIC,
                        labeled_declaration: NodeId::NIL,
                    });
                } else if in_destructuring_pattern {
                    // Given the following situation: `var c: {}; [...c] = ["", 0];` c is represented in the tree as a spread element in an array literal. But c really functions as a rest element, and its purpose is to provide a contextual type for the right hand side of the assignment. Therefore, instead of calling checkExpression on "...c", which will give an error if c is not iterable/array-like, we need to act as if we are trying to get the contextual element type from it. So we do something similar to getContextualTypeForElementExpression, which will crucially not error if there is no index type / iterated type.
                    let number_type = self.number_type;
                    let mut rest_element_type =
                        self.get_index_type_of_type(spread_type, number_type);
                    if rest_element_type.is_nil() {
                        let undefined_type = self.undefined_type;
                        rest_element_type = self.get_iterated_type_or_element_type(
                            IterationUse::DESTRUCTURING,
                            spread_type,
                            undefined_type,
                            NodeId::NIL,
                            false,
                        );
                        if rest_element_type.is_nil() {
                            rest_element_type = self.unknown_type;
                        }
                    }
                    element_types.push(rest_element_type);
                    element_infos.push(TupleElementInfo {
                        flags: ElementFlags::REST,
                        labeled_declaration: NodeId::NIL,
                    });
                } else {
                    let undefined_type = self.undefined_type;
                    let iterated_type = self.check_iterated_type_or_element_type(
                        IterationUse::SPREAD,
                        spread_type,
                        undefined_type,
                        a.expression(e),
                    );
                    element_types.push(iterated_type);
                    element_infos.push(TupleElementInfo {
                        flags: ElementFlags::REST,
                        labeled_declaration: NodeId::NIL,
                    });
                }
            } else if self.exact_optional_property_types && is_omitted_expression(a, e) {
                has_omitted_expression = true;
                element_types.push(self.undefined_or_missing_type);
                element_infos.push(TupleElementInfo {
                    flags: ElementFlags::OPTIONAL,
                    labeled_declaration: NodeId::NIL,
                });
            } else {
                let t = self.check_expression_for_mutable_location(e, check_mode);
                let element_type = self.add_optionality_ex(t, true, has_omitted_expression);
                element_types.push(element_type);
                element_infos.push(TupleElementInfo {
                    flags: if_else(
                        has_omitted_expression,
                        ElementFlags::OPTIONAL,
                        ElementFlags::REQUIRED,
                    ),
                    labeled_declaration: NodeId::NIL,
                });
                if in_tuple_context
                    && check_mode.intersects(CheckMode::INFERENTIAL)
                    && !check_mode.intersects(CheckMode::SKIP_CONTEXT_SENSITIVE)
                    && self.is_context_sensitive(e)
                {
                    let inference_context = self.get_inference_context(node);
                    // In CheckMode.Inferential we should always have an inference context
                    self.add_intra_expression_inference_site(inference_context, e, t);
                }
            }
        }
        self.pop_contextual_type();
        if in_destructuring_pattern {
            let element_types = self.list_of(&element_types);
            return self.create_tuple_type_ex(
                element_types,
                List::from_slice(&element_infos),
                false,
            );
        }
        if check_mode.intersects(CheckMode::FORCE_TUPLE) || in_const_context || in_tuple_context {
            let readonly = in_const_context
                && !(!contextual_type.is_nil()
                    && some_type(self, contextual_type, &mut |c, t| {
                        c.is_mutable_array_like_type(t)
                    }));
            let element_types = self.list_of(&element_types);
            let tuple_type = self.create_tuple_type_ex(
                element_types,
                List::from_slice(&element_infos),
                readonly,
            );
            return self.create_array_literal_type(tuple_type);
        }
        let element_type = if !element_types.is_empty() {
            for (t, info) in element_types.iter_mut().zip(element_infos.iter()) {
                if info.flags.intersects(ElementFlags::VARIADIC) {
                    let number_type = self.number_type;
                    let indexed_access_type = self.get_indexed_access_type_or_undefined(
                        *t,
                        number_type,
                        AccessFlags::NONE,
                        NodeId::NIL,
                        TypeAliasId::NIL,
                    );
                    *t = or_else(indexed_access_type, self.any_type);
                }
            }
            self.get_union_type_ex(
                List::from_slice(&element_types),
                UnionReduction::SUBTYPE,
                TypeAliasId::NIL,
                TypeId::NIL,
            )
        } else {
            if_else(
                self.strict_null_checks,
                self.implicit_never_type,
                self.undefined_widening_type,
            )
        };
        let array_type = self.create_array_type_ex(element_type, in_const_context);
        self.create_array_literal_type(array_type)
    }

    pub fn create_array_literal_type(&mut self, t: TypeId) -> TypeId {
        if !self.types[t]
            .object_flags
            .intersects(ObjectFlags::REFERENCE)
        {
            return t;
        }
        let key = CachedTypeKey {
            kind: CachedTypeKind::ARRAY_LITERAL_TYPE,
            type_id: t,
        };
        if let Some(cached) = self.cached_types.get_ok(&key) {
            return cached;
        }
        let literal_type = self.clone_type_reference(t);
        self.types[literal_type].object_flags |=
            ObjectFlags::ARRAY_LITERAL | ObjectFlags::CONTAINS_OBJECT_OR_ARRAY_LITERAL;
        let ok = self.cached_types.set(key, literal_type);
        self.map_set(ok);
        literal_type
    }
}

pub fn is_spread_into_call_or_new(a: Ast<'_>, node: NodeId) -> bool {
    let parent = walk_up_parenthesized_expressions(a, a.parent(node));
    is_spread_element(a, parent) && is_call_or_new_expression(a, a.parent(parent))
}

impl<'a> Checker<'a> {
    pub fn check_qualified_name(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let a = self.ast;
        let left = a.as_qualified_name(node).left;
        let left_type = if is_part_of_type_query(a, node) && is_this_identifier(a, left) {
            let this_type = self.check_this_expression(left);
            self.check_non_null_type(this_type, left)
        } else {
            self.check_non_null_expression(left)
        };
        self.check_property_access_expression_or_qualified_name(
            node,
            left,
            left_type,
            a.as_qualified_name(node).right,
            check_mode,
            false,
        )
    }

    pub fn check_indexed_access(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let a = self.ast;
        if a.flags(node).intersects(NodeFlags::OPTIONAL_CHAIN) {
            return self.check_element_access_chain(node, check_mode);
        }
        let expr_type = self.check_non_null_expression(a.expression(node));
        self.check_element_access_expression(node, expr_type, check_mode)
    }

    pub fn check_element_access_chain(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let a = self.ast;
        let expr_type = self.check_expression(a.expression(node));
        let non_optional_type = self.get_optional_expression_type(expr_type, a.expression(node));
        let non_null_type = self.check_non_null_type(non_optional_type, a.expression(node));
        let element_type = self.check_element_access_expression(node, non_null_type, check_mode);
        self.propagate_optional_type_marker(element_type, node, non_optional_type != expr_type)
    }

    pub fn check_element_access_expression(
        &mut self,
        node: NodeId,
        expr_type: TypeId,
        check_mode: CheckMode,
    ) -> TypeId {
        let a = self.ast;
        let mut object_type = expr_type;
        if get_assignment_target_kind(a, node) != AssignmentKind::NONE
            || self.is_method_access_for_call(node)
        {
            object_type = self.get_widened_type(object_type);
        }
        let index_expression = a.as_element_access_expression(node).argument_expression;
        let index_type = self.check_expression(index_expression);
        if self.is_error_type(object_type) || object_type == self.silent_never_type {
            return object_type;
        }
        if is_const_enum_object_type(self, object_type)
            && !is_string_literal_like(a, index_expression)
        {
            self.error(
                index_expression,
                diagnostics::A_CONST_ENUM_MEMBER_CAN_ONLY_BE_ACCESSED_USING_A_STRING_LITERAL,
                &[],
            );
            return self.error_type;
        }
        let mut effective_index_type = index_type;
        if self.is_for_in_variable_for_numeric_property_names(index_expression) {
            effective_index_type = self.number_type;
        }
        let assignment_target_kind = get_assignment_target_kind(a, node);
        let access_flags = if assignment_target_kind == AssignmentKind::NONE {
            AccessFlags::EXPRESSION_POSITION
        } else {
            AccessFlags::WRITING
                | if_else(
                    assignment_target_kind == AssignmentKind::COMPOUND,
                    AccessFlags::EXPRESSION_POSITION,
                    AccessFlags::NONE,
                )
                | if_else(
                    self.is_generic_object_type(object_type)
                        && !is_this_type_parameter(self, object_type),
                    AccessFlags::NO_INDEX_SIGNATURES,
                    AccessFlags::NONE,
                )
        };
        let indexed_access_type = self.get_indexed_access_type_or_undefined(
            object_type,
            effective_index_type,
            access_flags,
            node,
            TypeAliasId::NIL,
        );
        let indexed_access_type = or_else(indexed_access_type, self.error_type);
        let resolved_symbol = self.get_resolved_symbol_or_nil(node);
        let flow_type = self.get_flow_type_of_access_expression(
            node,
            resolved_symbol,
            indexed_access_type,
            index_expression,
            check_mode,
        );
        self.check_indexed_access_index_type(flow_type, node)
    }

    // Return true if given node is an expression consisting of an identifier (possibly parenthesized) that references a for-in variable for an object with numeric property names.
    pub fn is_for_in_variable_for_numeric_property_names(&mut self, expr: NodeId) -> bool {
        let a = self.ast;
        let e = skip_parentheses(a, expr);
        if is_identifier(a, e) {
            let symbol = self.get_resolved_symbol(e);
            if a.sym(symbol).flags.intersects(SymbolFlags::VARIABLE) {
                let mut child = expr;
                let mut node = a.parent(expr);
                while !node.is_nil() {
                    if is_for_in_statement(a, node)
                        && child == a.as_for_in_or_of_statement(node).statement
                        && self.get_for_in_variable_symbol(node) == symbol
                        && {
                            let expression_type = self.get_type_of_expression(a.expression(node));
                            self.has_numeric_property_names(expression_type)
                        }
                    {
                        return true;
                    }
                    child = node;
                    node = a.parent(node);
                }
            }
        }
        false
    }

    // Return the symbol of the for-in variable declared or referenced by the given for-in statement.
    pub fn get_for_in_variable_symbol(&mut self, node: NodeId) -> SymbolId {
        let a = self.ast;
        let initializer = a.initializer(node);
        if is_variable_declaration_list(a, initializer) {
            let declarations = a.nodes(a.as_variable_declaration_list(initializer).declarations);
            if declarations.len() > 0 {
                let variable = declarations.at(0);
                if !variable.is_nil() && !is_binding_pattern(a, a.name(variable)) {
                    return self.get_symbol_of_declaration(variable);
                }
            }
        } else if is_identifier(a, initializer) {
            return self.get_resolved_symbol(initializer);
        }
        SymbolId::NIL
    }

    // Return true if the given type is considered to have numeric property names.
    pub fn has_numeric_property_names(&mut self, t: TypeId) -> bool {
        let number_type = self.number_type;
        self.get_index_infos_of_type(t).len() == 1
            && !self.get_index_info_of_type(t, number_type).is_nil()
    }

    pub fn check_indexed_access_index_type(&mut self, t: TypeId, access_node: NodeId) -> TypeId {
        let a = self.ast;
        if !self.types[t].flags.intersects(TypeFlags::INDEXED_ACCESS) {
            return t;
        }
        // Check if the index type is assignable to 'keyof T' for the object type.
        let object_type = self.as_indexed_access_type(t).object_type;
        let index_type = self.as_indexed_access_type(t).index_type;
        // skip index type deferral on remapping mapped types
        let object_index_type = if self.is_generic_mapped_type(object_type)
            && self.get_mapped_type_name_type_kind(object_type) == MappedTypeNameTypeKind::REMAPPING
        {
            self.get_index_type_for_mapped_type(object_type, IndexFlags::NONE)
        } else {
            self.get_index_type_ex(object_type, IndexFlags::NONE)
        };
        let number_type = self.number_type;
        let has_number_index_info = !self
            .get_index_info_of_type(object_type, number_type)
            .is_nil();
        if every_type(self, index_type, &mut |c, t| {
            c.is_type_assignable_to(t, object_index_type)
                || has_number_index_info && c.is_applicable_index_type(t, number_type)
        }) {
            if a.kind(access_node) == Kind::ElementAccessExpression
                && is_assignment_target(a, access_node)
                && self.types[object_type]
                    .object_flags
                    .intersects(ObjectFlags::MAPPED)
                && get_mapped_type_modifiers(self, object_type)
                    .intersects(MappedTypeModifiers::INCLUDE_READONLY)
            {
                let object_type_name = self.type_to_string_exported(object_type);
                self.error(
                    access_node,
                    diagnostics::INDEX_SIGNATURE_IN_TYPE_0_ONLY_PERMITS_READING,
                    &[Arg::Str(&object_type_name)],
                );
            }
            return t;
        }
        if self.is_generic_object_type(object_type) {
            let property_name = self.get_property_name_from_index(index_type, access_node);
            if property_name != INTERNAL_SYMBOL_NAME_MISSING {
                let property_symbol = self.get_constituent_property(object_type, &property_name);
                if !property_symbol.is_nil()
                    && get_declaration_modifier_flags_from_symbol(a, property_symbol)
                        .intersects(ModifierFlags::NON_PUBLIC_ACCESSIBILITY_MODIFIER)
                {
                    self.error(
                        access_node,
                        diagnostics::PRIVATE_OR_PROTECTED_MEMBER_0_CANNOT_BE_ACCESSED_ON_A_TYPE_PARAMETER,
                        &[Arg::Str(&property_name)],
                    );
                    return self.error_type;
                }
            }
        }
        let index_type_name = self.type_to_string_exported(index_type);
        let object_type_name = self.type_to_string_exported(object_type);
        self.error(
            access_node,
            diagnostics::TYPE_0_CANNOT_BE_USED_TO_INDEX_TYPE_1,
            &[Arg::Str(&index_type_name), Arg::Str(&object_type_name)],
        );
        self.error_type
    }

    pub fn get_constituent_property(
        &mut self,
        object_type: TypeId,
        property_name: &[u8],
    ) -> SymbolId {
        let apparent_type = self.get_apparent_type(object_type);
        let types = self.type_distributed(apparent_type);
        for &t in types.as_slice() {
            let prop = self.get_property_of_type(t, property_name);
            if !prop.is_nil() {
                return prop;
            }
        }
        SymbolId::NIL
    }

    pub fn check_import_call_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        // Check grammar of dynamic import
        self.check_grammar_import_call_expression(node);
        let args = a.arguments(node);
        if args.len() == 0 {
            // No call arguments exist, so there are no child expressions to check.
            let any_type = self.any_type;
            return self.create_promise_return_type(node, any_type);
        }
        let specifier = args.at(0);
        let specifier_type = self.check_expression_cached(specifier);
        let mut options_type = TypeId::NIL;
        if args.len() > 1 {
            options_type = self.check_expression_cached(args.at(1));
        }
        // Even though multiple arguments is grammatically incorrect, type-check extra arguments for completion
        for &arg in args.as_slice().iter().skip(2) {
            self.check_expression_cached(arg);
        }
        let string_type = self.string_type;
        if self.types[specifier_type]
            .flags
            .intersects(TypeFlags::NULLABLE)
            || !self.is_type_assignable_to(specifier_type, string_type)
        {
            let specifier_type_name = self.type_to_string_exported(specifier_type);
            self.error(
                specifier,
                diagnostics::DYNAMIC_IMPORT_S_SPECIFIER_MUST_BE_OF_TYPE_STRING_BUT_HERE_HAS_TYPE_0,
                &[Arg::Str(&specifier_type_name)],
            );
        }
        if !options_type.is_nil() {
            let import_call_options_type = self.get_global_import_call_options_type_checked();
            if import_call_options_type != self.empty_object_type {
                let target = self.get_nullable_type(import_call_options_type, TypeFlags::UNDEFINED);
                self.check_type_assignable_to(options_type, target, args.at(1), MessageId::NIL);
            }
            if is_object_literal_expression(a, args.at(1)) {
                let properties = a.nodes(a.as_object_literal_expression(args.at(1)).properties);
                for &prop in properties.as_slice() {
                    if is_property_assignment(a, prop)
                        && is_identifier(a, a.name(prop))
                        && a.text(a.name(prop)) == b"assert"
                    {
                        self.error(
                            a.name(prop),
                            diagnostics::IMPORT_ASSERTIONS_HAVE_BEEN_REPLACED_BY_IMPORT_ATTRIBUTES_USE_WITH_INSTEAD_OF_ASSERT,
                            &[],
                        );
                        break;
                    }
                }
            }
        }
        // resolveExternalModuleName will return undefined if the moduleReferenceExpression is not a string literal
        let module_symbol = self.resolve_external_module_name(node, specifier, false);
        if !module_symbol.is_nil() {
            let es_module_symbol = self.resolve_external_module_symbol(module_symbol, true);
            if !es_module_symbol.is_nil() {
                let es_module_type = self.get_type_of_symbol(es_module_symbol);
                let mut synthetic_type = self.get_type_with_synthetic_default_only(
                    es_module_type,
                    es_module_symbol,
                    module_symbol,
                    specifier,
                );
                if synthetic_type.is_nil() {
                    let es_module_type = self.get_type_of_symbol(es_module_symbol);
                    synthetic_type = self.get_type_with_synthetic_default_import_type(
                        es_module_type,
                        es_module_symbol,
                        module_symbol,
                        specifier,
                    );
                }
                return self.create_promise_return_type(node, synthetic_type);
            }
        }
        let any_type = self.any_type;
        self.create_promise_return_type(node, any_type)
    }
}
