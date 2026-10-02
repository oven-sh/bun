// checker.go:10707-11130 (layers E-CORE, E-OPER, E-AWAIT): the checks of typeof, non-null, instantiation, satisfies, meta property, delete, void, await, prefix and postfix unary, conditional, spread, yield and synthetic expressions, and the type of an instantiation expression.
use crate::ast::{
    Arg, FunctionFlags, Kind, NodeFlags, NodeId, SymbolFlags, SymbolId, get_containing_function,
    get_function_flags, get_new_target_container, get_node_id, get_source_file_of_node,
    is_access_expression, is_binary_expression, is_call_expression, is_constructor_declaration,
    is_expression_with_type_arguments, is_in_js_file, is_private_identifier,
    is_property_access_expression, is_this_identifier, skip_parentheses,
    walk_up_parenthesized_expressions,
};
use crate::checker::{
    CheckMode, Checker, ContextFlags, ExternalEmitHelpers, InstantiationExpressionKey,
    IterationTypeKind, IterationTypes, IterationUse, LANGUAGE_FEATURE_MINIMUM_TARGET, ObjectFlags,
    SignatureId, TypeAliasId, TypeFacts, TypeFlags, TypeId, UnionReduction,
    expression_result_is_unused, is_node_descendant_of, is_type_any,
};
use crate::core::{List, ModuleKind, if_else, new_text_range, or_else, same};
use crate::diagnostics::{self, MessageId};
use crate::jsnum::{from_string, new_pseudo_big_int, parse_pseudo_big_int};
use crate::scanner::{skip_trivia, token_to_string};

// What the closures of getInstantiationExpressionType capture: the node, its type arguments, and the two results that getInstantiatedType writes.
struct InstantiationExpressionState<'a> {
    node: NodeId,
    type_arguments: List<'a, NodeId>,
    has_some_applicable_signature: bool,
    non_applicable_type: TypeId,
}

// The locals of getInstantiatedType that its closure getInstantiatedTypePart writes.
#[derive(Default)]
struct InstantiatedTypeState {
    has_signatures: bool,
    has_applicable_signature: bool,
}

impl<'a> Checker<'a> {
    pub fn check_type_of_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        self.check_expression(a.expression(node));
        self.typeof_type
    }

    pub fn check_non_null_assertion(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        if a.flags(node).intersects(NodeFlags::OPTIONAL_CHAIN) {
            // checkNonNullChain checks the same operand expression (node.Expression()), so the child is still visited on this branch.
            return self.check_non_null_chain(node);
        }
        let t = self.check_expression(a.expression(node));
        self.get_non_nullable_type(t)
    }

    pub fn check_non_null_chain(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let left_type = self.check_expression(a.expression(node));
        let non_optional_type = self.get_optional_expression_type(left_type, a.expression(node));
        let non_nullable_type = self.get_non_nullable_type(non_optional_type);
        self.propagate_optional_type_marker(non_nullable_type, node, non_optional_type != left_type)
    }

    pub fn check_expression_with_type_arguments(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        self.check_grammar_expression_with_type_arguments(node);
        self.check_source_elements(a.type_arguments(node));
        if is_expression_with_type_arguments(a, node) {
            let parent = walk_up_parenthesized_expressions(a, a.parent(node));
            if is_binary_expression(a, parent)
                && a.kind(a.as_binary_expression(parent).operator_token) == Kind::InstanceOfKeyword
                && is_node_descendant_of(a, node, a.as_binary_expression(parent).right)
            {
                self.error(
                    node,
                    diagnostics::THE_RIGHT_HAND_SIDE_OF_AN_INSTANCEOF_EXPRESSION_MUST_NOT_BE_AN_INSTANTIATION_EXPRESSION,
                    &[],
                );
            }
        }
        let expr_type = if is_expression_with_type_arguments(a, node) {
            self.check_expression(a.expression(node))
        } else {
            let expr_name = a.as_type_query_node(node).expr_name;
            if is_this_identifier(a, expr_name) {
                self.check_this_expression(expr_name)
            } else {
                self.check_expression(expr_name)
            }
        };
        self.get_instantiation_expression_type(expr_type, node)
    }

    pub fn get_instantiation_expression_type(&mut self, expr_type: TypeId, node: NodeId) -> TypeId {
        // The closure getInstantiatedSignatures of upstream.
        fn get_instantiated_signatures<'a>(
            c: &mut Checker<'a>,
            type_arguments: List<'a, NodeId>,
            signatures: List<'a, SignatureId>,
        ) -> List<'a, SignatureId> {
            let applicable_signatures = c.filter(signatures, |c, sig| {
                c.signatures[sig].type_parameters.len() != 0
                    && c.has_correct_type_argument_arity(sig, type_arguments)
            });
            c.same_map(applicable_signatures, |c, sig| {
                let type_argument_types =
                    c.check_type_arguments(sig, type_arguments, true, MessageId::NIL);
                if !type_argument_types.is_nil() {
                    let is_java_script = is_in_js_file(c.ast, c.signatures[sig].declaration);
                    return c.get_signature_instantiation(
                        sig,
                        type_argument_types,
                        is_java_script,
                        List::NIL,
                    );
                }
                sig
            })
        }

        // The closure getInstantiatedType of upstream.
        fn get_instantiated_type<'a>(
            c: &mut Checker<'a>,
            state: &mut InstantiationExpressionState<'a>,
            t: TypeId,
        ) -> TypeId {
            let mut locals = InstantiatedTypeState::default();
            let result = get_instantiated_type_part(c, state, &mut locals, t);
            state.has_some_applicable_signature =
                state.has_some_applicable_signature || locals.has_applicable_signature;
            if locals.has_signatures && !locals.has_applicable_signature {
                if state.non_applicable_type.is_nil() {
                    state.non_applicable_type = t;
                }
            }
            result
        }

        // The closure getInstantiatedTypePart of upstream. The type comes back as it came in where Go's stack grows.
        fn get_instantiated_type_part<'a>(
            c: &mut Checker<'a>,
            state: &mut InstantiationExpressionState<'a>,
            locals: &mut InstantiatedTypeState,
            t: TypeId,
        ) -> TypeId {
            if !c.stack_check.is_safe_to_recurse() {
                c.stack_limit::<()>();
                return t;
            }
            let flags = c.types[t].flags;
            if flags.intersects(TypeFlags::OBJECT) {
                let resolved = c.resolve_structured_type_members(t);
                let resolved_call_signatures = c.as_structured_type(resolved).call_signatures();
                let resolved_construct_signatures =
                    c.as_structured_type(resolved).construct_signatures();
                let call_signatures =
                    get_instantiated_signatures(c, state.type_arguments, resolved_call_signatures);
                let construct_signatures = get_instantiated_signatures(
                    c,
                    state.type_arguments,
                    resolved_construct_signatures,
                );
                locals.has_signatures = locals.has_signatures
                    || resolved_call_signatures.len() != 0
                    || resolved_construct_signatures.len() != 0;
                locals.has_applicable_signature = locals.has_applicable_signature
                    || call_signatures.len() != 0
                    || construct_signatures.len() != 0;
                if !same(
                    call_signatures.as_slice(),
                    resolved_call_signatures.as_slice(),
                ) || !same(
                    construct_signatures.as_slice(),
                    resolved_construct_signatures.as_slice(),
                ) {
                    let symbol = c.types[t].symbol;
                    let result = c.new_object_type(
                        ObjectFlags::ANONYMOUS | ObjectFlags::INSTANTIATION_EXPRESSION_TYPE,
                        symbol,
                    );
                    let members = c.as_structured_type(resolved).members;
                    let index_infos = c.as_structured_type(resolved).index_infos;
                    c.set_structured_type_members(
                        result,
                        members,
                        call_signatures,
                        construct_signatures,
                        index_infos,
                    );
                    c.as_instantiation_expression_type_mut(result).node = state.node;
                    return result;
                }
            } else if flags.intersects(TypeFlags::INSTANTIABLE_NON_PRIMITIVE) {
                let constraint = c.get_base_constraint_of_type(t);
                if !constraint.is_nil() {
                    let instantiated = get_instantiated_type_part(c, state, locals, constraint);
                    if instantiated != constraint {
                        return instantiated;
                    }
                }
            } else if flags.intersects(TypeFlags::UNION) {
                return c.map_type(t, &mut |c, t| get_instantiated_type(c, state, t));
            } else if flags.intersects(TypeFlags::INTERSECTION) {
                let types = c.as_intersection_type(t).types;
                let parts = c.same_map(types, |c, t| {
                    get_instantiated_type_part(c, state, locals, t)
                });
                return c.get_intersection_type(parts);
            }
            t
        }

        let a = self.ast;
        let type_arguments = a.type_argument_list(node);
        if expr_type == self.silent_never_type
            || self.is_error_type(expr_type)
            || type_arguments.is_nil()
        {
            return expr_type;
        }
        let key = InstantiationExpressionKey {
            node_id: get_node_id(node),
            type_id: expr_type,
        };
        let cached = self.instantiation_expression_types.get(&key);
        if !cached.is_nil() {
            return cached;
        }
        let mut state = InstantiationExpressionState {
            node,
            type_arguments: a.nodes(type_arguments),
            has_some_applicable_signature: false,
            non_applicable_type: TypeId::NIL,
        };
        let result = get_instantiated_type(self, &mut state, expr_type);
        let ok = self.instantiation_expression_types.set(key, result);
        self.map_set(ok);
        let error_type = if state.has_some_applicable_signature {
            state.non_applicable_type
        } else {
            expr_type
        };
        if !error_type.is_nil() {
            let source_file = get_source_file_of_node(a, node);
            let loc = new_text_range(
                skip_trivia(
                    a.as_source_file(source_file).text(),
                    a.list_pos(type_arguments),
                ),
                a.list_end(type_arguments),
            );
            let type_name = self.type_to_string_exported(error_type);
            let diagnostic = self.diagnostic_store.new_diagnostic(
                source_file,
                loc,
                diagnostics::TYPE_0_HAS_NO_SIGNATURES_FOR_WHICH_THE_TYPE_ARGUMENT_LIST_IS_APPLICABLE,
                &[Arg::Str(&type_name)],
            );
            self.add_diagnostic(diagnostic);
        }
        result
    }

    pub fn check_satisfies_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let type_node = a.type_node(node);
        self.check_source_element(type_node);
        let expr_type = self.check_expression(a.expression(node));
        let target_type = self.get_type_from_type_node(type_node);
        if self.is_error_type(target_type) {
            return target_type;
        }
        self.check_type_assignable_to_and_optionally_elaborate(
            expr_type,
            target_type,
            node,
            a.expression(node),
            diagnostics::TYPE_0_DOES_NOT_SATISFY_THE_EXPECTED_TYPE_1,
            None,
        );
        expr_type
    }

    pub fn check_meta_property(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        self.check_grammar_meta_property(node);
        match a.as_meta_property(node).keyword_token {
            Kind::NewKeyword => self.check_new_target_meta_property(node),
            Kind::ImportKeyword => {
                if a.text(a.name(node)) == b"defer" {
                    self.assert(
                        !is_call_expression(a, a.parent(node))
                            || a.expression(a.parent(node)) != node,
                        "Trying to get the type of `import.defer` in `import.defer(...)`",
                    );
                    return self.error_type;
                }
                self.check_import_meta_property(node)
            }
            keyword_token => {
                self.fail_detail("Unhandled case in checkMetaProperty", keyword_token as u32)
            }
        }
    }

    pub fn check_new_target_meta_property(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let container = get_new_target_container(a, node);
        if container.is_nil() {
            self.error(
                node,
                diagnostics::META_PROPERTY_0_IS_ONLY_ALLOWED_IN_THE_BODY_OF_A_FUNCTION_DECLARATION_FUNCTION_EXPRESSION_OR_CONSTRUCTOR,
                &[Arg::Str(b"new.target")],
            );
            return self.error_type;
        }
        if is_constructor_declaration(a, container) {
            let symbol = self.get_symbol_of_declaration(a.parent(container));
            return self.get_type_of_symbol(symbol);
        }
        let symbol = self.get_symbol_of_declaration(container);
        self.get_type_of_symbol(symbol)
    }

    pub fn check_import_meta_property(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        if ModuleKind::NODE16 <= self.module_kind && self.module_kind <= ModuleKind::NODE_NEXT {
            let source_file_meta_data = self
                .program
                .get_source_file_meta_data(get_source_file_of_node(a, node));
            if source_file_meta_data.implied_node_format != ModuleKind::ES_NEXT {
                self.error(
                    node,
                    diagnostics::THE_IMPORT_META_META_PROPERTY_IS_NOT_ALLOWED_IN_FILES_WHICH_WILL_BUILD_INTO_COMMONJS_OUTPUT,
                    &[],
                );
            }
        } else if self.module_kind < ModuleKind::ES2020 && self.module_kind != ModuleKind::SYSTEM {
            self.error(
                node,
                diagnostics::THE_IMPORT_META_META_PROPERTY_IS_ONLY_ALLOWED_WHEN_THE_MODULE_OPTION_IS_ES2020_ES2022_ESNEXT_SYSTEM_NODE16_NODE18_NODE20_OR_NODENEXT,
                &[],
            );
        }
        let file = get_source_file_of_node(a, node);
        self.assert(
            a.flags(file)
                .intersects(NodeFlags::POSSIBLY_CONTAINS_IMPORT_META),
            "Containing file is missing import meta node flag.",
        );
        if a.text(a.name(node)) == b"meta" {
            return self.get_global_import_meta_type();
        }
        self.error_type
    }

    pub fn check_meta_property_keyword(&self, _node: NodeId) -> TypeId {
        // This is effectively a helper for GetSymbolAtLocation and GetTypeAtLocation
        self.error_type
    }

    pub fn check_delete_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        self.check_expression(a.expression(node));
        let expr = skip_parentheses(a, a.expression(node));
        if !is_access_expression(a, expr) {
            self.error(
                expr,
                diagnostics::THE_OPERAND_OF_A_DELETE_OPERATOR_MUST_BE_A_PROPERTY_REFERENCE,
                &[],
            );
            return self.boolean_type;
        }
        if is_property_access_expression(a, expr) && is_private_identifier(a, a.name(expr)) {
            self.error(
                expr,
                diagnostics::THE_OPERAND_OF_A_DELETE_OPERATOR_CANNOT_BE_A_PRIVATE_IDENTIFIER,
                &[],
            );
        }
        let resolved_symbol = self.get_resolved_symbol_or_nil(expr);
        let symbol = self.get_export_symbol_of_value_symbol_if_exported(resolved_symbol);
        if !symbol.is_nil() {
            if self.is_readonly_symbol(symbol) {
                self.error(
                    expr,
                    diagnostics::THE_OPERAND_OF_A_DELETE_OPERATOR_CANNOT_BE_A_READ_ONLY_PROPERTY,
                    &[],
                );
            } else {
                self.check_delete_expression_must_be_optional(expr, symbol);
            }
        }
        self.boolean_type
    }

    pub fn check_delete_expression_must_be_optional(&mut self, expr: NodeId, symbol: SymbolId) {
        let a = self.ast;
        let t = self.get_type_of_symbol(symbol);
        if self.strict_null_checks
            && !self.types[t]
                .flags
                .intersects(TypeFlags::ANY_OR_UNKNOWN | TypeFlags::NEVER)
        {
            let is_optional = if self.exact_optional_property_types {
                a.sym(symbol).flags.intersects(SymbolFlags::OPTIONAL)
            } else {
                self.has_type_facts(t, TypeFacts::IS_UNDEFINED)
            };
            if !is_optional {
                self.error(
                    expr,
                    diagnostics::THE_OPERAND_OF_A_DELETE_OPERATOR_MUST_BE_OPTIONAL,
                    &[],
                );
            }
        }
    }

    pub fn check_void_expression(&mut self, node: NodeId) -> TypeId {
        self.check_node_deferred(node);
        self.undefined_widening_type
    }

    pub fn check_await_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        self.check_grammar_await_or_await_using(node);
        let operand_type = self.check_expression(a.expression(node));
        let awaited_type = self.check_awaited_type(
            operand_type,
            true,
            node,
            diagnostics::TYPE_OF_AWAIT_OPERAND_MUST_EITHER_BE_A_VALID_PROMISE_OR_MUST_NOT_CONTAIN_A_CALLABLE_THEN_MEMBER,
        );
        if awaited_type == operand_type
            && !self.is_error_type(awaited_type)
            && !self.types[operand_type]
                .flags
                .intersects(TypeFlags::ANY_OR_UNKNOWN)
        {
            let diagnostic = self.create_diagnostic_for_node(
                node,
                diagnostics::X_AWAIT_HAS_NO_EFFECT_ON_THE_TYPE_OF_THIS_EXPRESSION,
                &[],
            );
            self.add_error_or_suggestion(false, diagnostic);
        }
        awaited_type
    }

    pub fn check_prefix_unary_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let expr = a.as_prefix_unary_expression(node);
        let operand_type = self.check_expression(expr.operand);
        if operand_type == self.silent_never_type {
            return self.silent_never_type;
        }
        match a.kind(expr.operand) {
            Kind::NumericLiteral => match expr.operator {
                Kind::MinusToken => {
                    let t = self.get_number_literal_type(-from_string(a.text(expr.operand)));
                    return self.get_fresh_type_of_literal_type(t);
                }
                Kind::PlusToken => {
                    let t = self.get_number_literal_type(from_string(a.text(expr.operand)));
                    return self.get_fresh_type_of_literal_type(t);
                }
                _ => {}
            },
            Kind::BigIntLiteral => {
                if expr.operator == Kind::MinusToken {
                    let value = match parse_pseudo_big_int(a.text(expr.operand)) {
                        Ok(digits) => new_pseudo_big_int(&digits, true),
                        Err(message) => return self.fail(message),
                    };
                    let t = self.get_big_int_literal_type(value);
                    return self.get_fresh_type_of_literal_type(t);
                }
            }
            _ => {}
        }
        match expr.operator {
            Kind::PlusToken | Kind::MinusToken | Kind::TildeToken => {
                self.check_non_null_type(operand_type, expr.operand);
                if self.maybe_type_of_kind_considering_base_constraint(
                    operand_type,
                    TypeFlags::ES_SYMBOL_LIKE,
                ) {
                    self.error(
                        expr.operand,
                        diagnostics::THE_0_OPERATOR_CANNOT_BE_APPLIED_TO_TYPE_SYMBOL,
                        &[Arg::Str(token_to_string(expr.operator))],
                    );
                }
                if expr.operator == Kind::PlusToken {
                    if self.maybe_type_of_kind_considering_base_constraint(
                        operand_type,
                        TypeFlags::BIG_INT_LIKE,
                    ) {
                        let base_type = self.get_base_type_of_literal_type(operand_type);
                        let type_name = self.type_to_string_exported(base_type);
                        self.error(
                            expr.operand,
                            diagnostics::OPERATOR_0_CANNOT_BE_APPLIED_TO_TYPE_1,
                            &[
                                Arg::Str(token_to_string(expr.operator)),
                                Arg::Str(&type_name),
                            ],
                        );
                    }
                    return self.number_type;
                }
                self.get_unary_result_type(operand_type)
            }
            Kind::ExclamationToken => {
                self.check_truthiness_of_type(operand_type, expr.operand);
                let facts = self.get_type_facts(operand_type, TypeFacts::TRUTHY | TypeFacts::FALSY);
                if facts == TypeFacts::TRUTHY {
                    self.false_type
                } else if facts == TypeFacts::FALSY {
                    self.true_type
                } else {
                    self.boolean_type
                }
            }
            Kind::PlusPlusToken | Kind::MinusMinusToken => {
                let non_null_type = self.check_non_null_type(operand_type, expr.operand);
                let ok = self.check_arithmetic_operand_type(
                    expr.operand,
                    non_null_type,
                    diagnostics::AN_ARITHMETIC_OPERAND_MUST_BE_OF_TYPE_ANY_NUMBER_BIGINT_OR_AN_ENUM_TYPE,
                    false,
                );
                if ok {
                    // run check only if former checks succeeded to avoid reporting cascading errors
                    self.check_reference_expression(
                        expr.operand,
                        diagnostics::THE_OPERAND_OF_AN_INCREMENT_OR_DECREMENT_OPERATOR_MUST_BE_A_VARIABLE_OR_A_PROPERTY_ACCESS,
                        diagnostics::THE_OPERAND_OF_AN_INCREMENT_OR_DECREMENT_OPERATOR_MAY_NOT_BE_AN_OPTIONAL_PROPERTY_ACCESS,
                    );
                }
                self.get_unary_result_type(operand_type)
            }
            _ => self.error_type,
        }
    }

    pub fn check_postfix_unary_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let expr = a.as_postfix_unary_expression(node);
        let operand_type = self.check_expression(expr.operand);
        if operand_type == self.silent_never_type {
            return self.silent_never_type;
        }
        let non_null_type = self.check_non_null_type(operand_type, expr.operand);
        let ok = self.check_arithmetic_operand_type(
            expr.operand,
            non_null_type,
            diagnostics::AN_ARITHMETIC_OPERAND_MUST_BE_OF_TYPE_ANY_NUMBER_BIGINT_OR_AN_ENUM_TYPE,
            false,
        );
        if ok {
            // run check only if former checks succeeded to avoid reporting cascading errors
            self.check_reference_expression(
                expr.operand,
                diagnostics::THE_OPERAND_OF_AN_INCREMENT_OR_DECREMENT_OPERATOR_MUST_BE_A_VARIABLE_OR_A_PROPERTY_ACCESS,
                diagnostics::THE_OPERAND_OF_AN_INCREMENT_OR_DECREMENT_OPERATOR_MAY_NOT_BE_AN_OPTIONAL_PROPERTY_ACCESS,
            );
        }
        self.get_unary_result_type(operand_type)
    }

    pub fn get_unary_result_type(&mut self, operand_type: TypeId) -> TypeId {
        if self.maybe_type_of_kind(operand_type, TypeFlags::BIG_INT_LIKE) {
            if self.is_type_assignable_to_kind(operand_type, TypeFlags::ANY_OR_UNKNOWN)
                || self.maybe_type_of_kind(operand_type, TypeFlags::NUMBER_LIKE)
            {
                return self.number_or_big_int_type;
            }
            return self.bigint_type;
        }
        // If it's not a bigint type, implicit coercion will result in a number
        self.number_type
    }

    pub fn check_conditional_expression(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let a = self.ast;
        let cond = a.as_conditional_expression(node);
        let t = self.check_truthiness_expression(cond.condition, check_mode);
        self.check_testing_known_truthy_callable_or_awaitable_or_enum_member_type(
            cond.condition,
            t,
            cond.when_true,
        );
        let type1 = self.check_expression_ex(cond.when_true, check_mode);
        let type2 = self.check_expression_ex(cond.when_false, check_mode);
        self.get_union_type_ex(
            List::from_slice(&[type1, type2]),
            UnionReduction::SUBTYPE,
            TypeAliasId::NIL,
            TypeId::NIL,
        )
    }

    pub fn check_truthiness_expression(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let t = self.check_expression_ex(node, check_mode);
        self.check_truthiness_of_type(t, node)
    }

    pub fn check_spread_expression(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let a = self.ast;
        let array_or_iterable_type = self.check_expression_ex(a.expression(node), check_mode);
        self.check_iterated_type_or_element_type(
            IterationUse::SPREAD,
            array_or_iterable_type,
            self.undefined_type,
            a.expression(node),
        )
    }

    pub fn check_yield_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        self.check_grammar_yield_expression(node);
        // Always check the operand so its identifiers are resolved even when the yield is outside a generator, keeping diagnostics stable regardless of traversal order.
        let yield_expression_type = if !a.expression(node).is_nil() {
            self.check_expression(a.expression(node))
        } else {
            self.undefined_widening_type
        };
        let func = get_containing_function(a, node);
        if func.is_nil() {
            return self.any_type;
        }
        let function_flags = get_function_flags(a, func);
        if !function_flags.intersects(FunctionFlags::GENERATOR) {
            // If the user's code is syntactically correct, the func should always have a star. After all, we are in a yield context.
            return self.any_type;
        }
        let is_async = function_flags.intersects(FunctionFlags::ASYNC);
        if !a.as_yield_expression(node).asterisk_token.is_nil() {
            // Async generator functions prior to ES2018 require the __await, __asyncDelegator, and __asyncValues helpers
            if is_async && self.language_version < LANGUAGE_FEATURE_MINIMUM_TARGET.async_generators
            {
                self.check_external_emit_helpers(
                    node,
                    ExternalEmitHelpers::ASYNC_DELEGATOR_INCLUDES,
                );
            }
        }
        // There is no point in doing an assignability check if the function has no explicit return type because the return type is directly computed from the yield expressions.
        let mut return_type = self.get_return_type_from_annotation(func);
        if !return_type.is_nil() && self.types[return_type].flags.intersects(TypeFlags::UNION) {
            return_type = self.filter_type(return_type, &mut |c, t| {
                c.check_generator_instantiation_assignability_to_return_type(
                    t,
                    function_flags,
                    NodeId::NIL,
                )
            });
        }
        let mut iteration_types = IterationTypes::default();
        if !return_type.is_nil() {
            iteration_types =
                self.get_iteration_types_of_generator_function_return_type(return_type, is_async);
        }
        let signature_yield_type = or_else(iteration_types.yield_type, self.any_type);
        let signature_next_type = or_else(iteration_types.next_type, self.any_type);
        let yielded_type = self.get_yielded_type_of_yield_expression(
            node,
            yield_expression_type,
            signature_next_type,
            is_async,
        );
        if !return_type.is_nil() && !yielded_type.is_nil() {
            self.check_type_assignable_to_and_optionally_elaborate(
                yielded_type,
                signature_yield_type,
                or_else(a.expression(node), node),
                a.expression(node),
                MessageId::NIL,
                None,
            );
        }
        if !a.as_yield_expression(node).asterisk_token.is_nil() {
            let use_ = if_else(
                is_async,
                IterationUse::ASYNC_YIELD_STAR,
                IterationUse::YIELD_STAR,
            );
            let t = self.get_iteration_type_of_iterable(
                use_,
                IterationTypeKind::RETURN,
                yield_expression_type,
                a.expression(node),
            );
            return or_else(t, self.any_type);
        }
        if !return_type.is_nil() {
            let t = self.get_iteration_type_of_generator_function_return_type(
                IterationTypeKind::NEXT,
                return_type,
                is_async,
            );
            return or_else(t, self.any_type);
        }
        let mut t = self.get_contextual_iteration_type(IterationTypeKind::NEXT, func);
        if t.is_nil() {
            t = self.any_type;
            if self.no_implicit_any && !expression_result_is_unused(a, node) {
                let contextual_type = self.get_contextual_type(node, ContextFlags::NONE);
                if contextual_type.is_nil() || is_type_any(self, contextual_type) {
                    self.error(
                        node,
                        diagnostics::X_YIELD_EXPRESSION_IMPLICITLY_RESULTS_IN_AN_ANY_TYPE_BECAUSE_ITS_CONTAINING_GENERATOR_LACKS_A_RETURN_TYPE_ANNOTATION,
                        &[],
                    );
                }
            }
        }
        t
    }

    pub fn get_yielded_type_of_yield_expression(
        &mut self,
        node: NodeId,
        expression_type: TypeId,
        sent_type: TypeId,
        is_async: bool,
    ) -> TypeId {
        let a = self.ast;
        let error_node = or_else(a.expression(node), node);
        let is_yield_star = !a.as_yield_expression(node).asterisk_token.is_nil();
        // A `yield*` expression effectively yields everything that its operand yields
        let mut yielded_type = expression_type;
        if is_yield_star {
            yielded_type = self.check_iterated_type_or_element_type(
                if_else(
                    is_async,
                    IterationUse::ASYNC_YIELD_STAR,
                    IterationUse::YIELD_STAR,
                ),
                expression_type,
                sent_type,
                error_node,
            );
        }
        if !is_async {
            return yielded_type;
        }
        self.get_awaited_type_ex(
            yielded_type,
            error_node,
            if_else(
                is_yield_star,
                diagnostics::TYPE_OF_ITERATED_ELEMENTS_OF_A_YIELD_ASTERISK_OPERAND_MUST_EITHER_BE_A_VALID_PROMISE_OR_MUST_NOT_CONTAIN_A_CALLABLE_THEN_MEMBER,
                diagnostics::TYPE_OF_YIELD_OPERAND_IN_AN_ASYNC_GENERATOR_MUST_EITHER_BE_A_VALID_PROMISE_OR_MUST_NOT_CONTAIN_A_CALLABLE_THEN_MEMBER,
            ),
            &[],
        )
    }

    pub fn check_synthetic_expression(&mut self, node: NodeId) -> TypeId {
        let a = self.ast;
        let data = a.as_synthetic_expression(node);
        // The type of a synthetic expression is the id of the type: the nil id is the nil interface of upstream, whose type assertion panics.
        let t = TypeId(data.type_node);
        if t.is_nil() {
            return self.fail("nil Type of a synthetic expression in checkSyntheticExpression");
        }
        if data.is_spread {
            return self.get_indexed_access_type(t, self.number_type);
        }
        t
    }
}
