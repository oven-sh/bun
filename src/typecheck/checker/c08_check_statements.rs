// checker.go:3793-4284 (layer D-STMT): blocks, conditions, loops, return, with, switch, labels, throw, try and binding elements.
use crate::ast::{
    Arg, FunctionFlags, Kind, NodeFlags, NodeId, SymbolFlags, SymbolId, get_function_flags,
    get_source_file_of_node, is_array_literal_expression, is_binary_expression, is_binding_pattern,
    is_call_expression, is_case_clause, is_class_static_block_declaration,
    is_conditional_expression, is_constructor_declaration, is_default_clause, is_empty_statement,
    is_function_like, is_function_or_module_block, is_identifier, is_labeled_statement,
    is_logical_or_coalescing_binary_expression, is_module_exports_access_expression,
    is_object_literal_expression, is_property_access_expression, is_set_accessor_declaration,
    is_variable_declaration_list, skip_parentheses,
};
use crate::checker::{
    CheckMode, Checker, ExternalEmitHelpers, LANGUAGE_FEATURE_MINIMUM_TARGET, SignatureKind,
    TypeFacts, TypeFlags, TypeId, get_containing_function_or_class_static_block, is_type_assertion,
};
use crate::core::Tristate;
use crate::diagnostics::{self, MessageId};
use crate::evaluator::is_truthy;
use crate::scanner::skip_trivia;

impl<'a> Checker<'a> {
    pub fn check_block(&mut self, node: NodeId) {
        let a = self.ast;
        // Grammar checking for SyntaxKind.Block
        if a.kind(node) == Kind::Block {
            self.check_grammar_statement_in_ambient_context(node);
        }
        if is_function_or_module_block(a, node) {
            let save_flow_analysis_disabled = self.flow_analysis_disabled;
            self.check_source_elements(a.statements(node));
            self.flow_analysis_disabled = save_flow_analysis_disabled;
        } else {
            self.check_source_elements(a.statements(node));
        }
        if a.table_len(a.locals(node)) != 0 {
            self.register_for_unused_identifiers_check(node);
        }
    }

    pub fn check_if_statement(&mut self, node: NodeId) {
        let a = self.ast;
        self.check_grammar_statement_in_ambient_context(node);
        let t = self.check_truthiness_expression(a.expression(node), CheckMode::NORMAL);
        let data = a.as_if_statement(node);
        self.check_testing_known_truthy_callable_or_awaitable_or_enum_member_type(
            a.expression(node),
            t,
            data.then_statement,
        );
        self.check_source_element(data.then_statement);
        if is_empty_statement(a, data.then_statement) {
            self.error(
                data.then_statement,
                diagnostics::THE_BODY_OF_AN_IF_STATEMENT_CANNOT_BE_THE_EMPTY_STATEMENT,
                &[],
            );
        }
        self.check_source_element(data.else_statement);
    }

    pub fn check_testing_known_truthy_callable_or_awaitable_or_enum_member_type(
        &mut self,
        cond_expr: NodeId,
        cond_type: TypeId,
        body: NodeId,
    ) {
        if !self.strict_null_checks {
            return;
        }
        self.check_testing_known_truthy_types(cond_expr, cond_type, body);
    }

    pub fn check_testing_known_truthy_types(
        &mut self,
        cond_expr: NodeId,
        cond_type: TypeId,
        body: NodeId,
    ) {
        let a = self.ast;
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let mut cond_expr = skip_parentheses(a, cond_expr);
        self.check_testing_known_truthy_type(cond_expr, cond_type, body);
        while is_binary_expression(a, cond_expr)
            && (a.kind(a.as_binary_expression(cond_expr).operator_token) == Kind::BarBarToken
                || a.kind(a.as_binary_expression(cond_expr).operator_token)
                    == Kind::QuestionQuestionToken)
        {
            cond_expr = skip_parentheses(a, a.as_binary_expression(cond_expr).left);
            self.check_testing_known_truthy_type(cond_expr, cond_type, body);
        }
    }

    pub fn check_testing_known_truthy_type(
        &mut self,
        cond_expr: NodeId,
        cond_type: TypeId,
        body: NodeId,
    ) {
        let a = self.ast;
        let mut location = cond_expr;
        if is_logical_or_coalescing_binary_expression(a, cond_expr) {
            location = skip_parentheses(a, a.as_binary_expression(cond_expr).right);
        }
        if is_module_exports_access_expression(a, location) {
            return;
        }
        if is_logical_or_coalescing_binary_expression(a, location) {
            self.check_testing_known_truthy_types(location, cond_type, body);
            return;
        }
        let mut t = cond_type;
        if location != cond_expr {
            t = self.check_expression(location);
        }
        if self.types[t].flags.intersects(TypeFlags::ENUM_LITERAL)
            && is_property_access_expression(a, location)
        {
            let mut expression_symbol = self.get_resolved_symbol_or_nil(a.expression(location));
            if expression_symbol.is_nil() {
                expression_symbol = self.unknown_symbol;
            }
            if a.sym(expression_symbol).flags.intersects(SymbolFlags::ENUM) {
                // EnumLiteral type at condition with known value is always truthy or always falsy, likely an error
                let result: &[u8] = if is_truthy(&self.as_literal_type(t).value) {
                    b"true"
                } else {
                    b"false"
                };
                self.error(
                    location,
                    diagnostics::THIS_CONDITION_WILL_ALWAYS_RETURN_0,
                    &[Arg::Str(result)],
                );
                return;
            }
        }
        let is_property_expression_cast = is_property_access_expression(a, location)
            && is_type_assertion(a, a.expression(location));
        if !self.has_type_facts(t, TypeFacts::TRUTHY) || is_property_expression_cast {
            return;
        }
        // While it technically should be invalid for any known-truthy value to be tested, we de-scope to functions and Promises unreferenced in the block as a heuristic to identify the most common bugs. There are too many false positives for values sourced from type definitions without strictNullChecks otherwise.
        let call_signatures = self.get_signatures_of_type(t, SignatureKind::CALL);
        let is_promise = !self.get_awaited_type_of_promise(t).is_nil();
        if call_signatures.len() == 0 && !is_promise {
            return;
        }
        let mut tested_node = NodeId::NIL;
        if is_identifier(a, location) {
            tested_node = location;
        } else if is_property_access_expression(a, location) {
            tested_node = a.name(location);
        }
        let mut tested_symbol = SymbolId::NIL;
        if !tested_node.is_nil() {
            tested_symbol = self.get_symbol_at_location(tested_node, false);
        }
        if tested_symbol.is_nil() && !is_promise {
            return;
        }
        let is_used = !tested_symbol.is_nil()
            && is_binary_expression(a, a.parent(cond_expr))
            && self.is_symbol_used_in_binary_expression_chain(a.parent(cond_expr), tested_symbol)
            || !tested_symbol.is_nil()
                && !body.is_nil()
                && self.is_symbol_used_in_condition_body(
                    cond_expr,
                    body,
                    tested_node,
                    tested_symbol,
                );
        if !is_used {
            if is_promise {
                let type_name = self.get_type_name_for_error_display(t);
                self.error_and_maybe_suggest_await(
                    location,
                    true,
                    diagnostics::THIS_CONDITION_WILL_ALWAYS_RETURN_TRUE_SINCE_THIS_0_IS_ALWAYS_DEFINED,
                    &[Arg::Str(&type_name)],
                );
            } else {
                self.error(location, diagnostics::THIS_CONDITION_WILL_ALWAYS_RETURN_TRUE_SINCE_THIS_FUNCTION_IS_ALWAYS_DEFINED_DID_YOU_MEAN_TO_CALL_IT_INSTEAD, &[]);
            }
        }
    }

    pub fn is_symbol_used_in_binary_expression_chain(
        &mut self,
        mut node: NodeId,
        tested_symbol: SymbolId,
    ) -> bool {
        // The recursive closure `visit` of upstream.
        fn visit(c: &mut Checker<'_>, child: NodeId, tested_symbol: SymbolId) -> bool {
            let a = c.ast;
            if !c.stack_check.is_safe_to_recurse() {
                return c.stack_limit();
            }
            if is_identifier(a, child) {
                let symbol = c.get_symbol_at_location(child, false);
                if !symbol.is_nil() && symbol == tested_symbol {
                    return true;
                }
            }
            a.for_each_child(child, &mut |grandchild| visit(c, grandchild, tested_symbol))
        }
        let a = self.ast;
        while is_binary_expression(a, node)
            && a.kind(a.as_binary_expression(node).operator_token) == Kind::AmpersandAmpersandToken
        {
            let is_used = a.for_each_child(a.as_binary_expression(node).right, &mut |child| {
                visit(self, child, tested_symbol)
            });
            if is_used {
                return true;
            }
            node = a.parent(node);
        }
        false
    }

    pub fn is_symbol_used_in_condition_body(
        &mut self,
        expr: NodeId,
        body: NodeId,
        tested_node: NodeId,
        tested_symbol: SymbolId,
    ) -> bool {
        // The recursive closure `visit` of upstream.
        fn visit(
            c: &mut Checker<'_>,
            child_node: NodeId,
            expr: NodeId,
            tested_node: NodeId,
            tested_symbol: SymbolId,
        ) -> bool {
            let a = c.ast;
            if !c.stack_check.is_safe_to_recurse() {
                return c.stack_limit();
            }
            if is_identifier(a, child_node) {
                let child_symbol = c.get_symbol_at_location(child_node, false);
                if !child_symbol.is_nil() && child_symbol == tested_symbol {
                    // If the test was a simple identifier, the above check is sufficient
                    if is_identifier(a, expr)
                        || is_identifier(a, tested_node)
                            && is_binary_expression(a, a.parent(tested_node))
                    {
                        return true;
                    }
                    // Otherwise we need to ensure the symbol is called on the same target
                    let mut tested_expression = a.parent(tested_node);
                    let mut child_expression = a.parent(child_node);
                    while !tested_expression.is_nil() && !child_expression.is_nil() {
                        if is_identifier(a, tested_expression) && is_identifier(a, child_expression)
                            || a.kind(tested_expression) == Kind::ThisKeyword
                                && a.kind(child_expression) == Kind::ThisKeyword
                        {
                            let tested_expression_symbol =
                                c.get_symbol_at_location(tested_expression, false);
                            let child_expression_symbol =
                                c.get_symbol_at_location(child_expression, false);
                            return tested_expression_symbol == child_expression_symbol;
                        } else if is_property_access_expression(a, tested_expression)
                            && is_property_access_expression(a, child_expression)
                        {
                            let tested_name_symbol =
                                c.get_symbol_at_location(a.name(tested_expression), false);
                            let child_name_symbol =
                                c.get_symbol_at_location(a.name(child_expression), false);
                            if tested_name_symbol != child_name_symbol {
                                return false;
                            }
                            child_expression = a.expression(child_expression);
                            tested_expression = a.expression(tested_expression);
                        } else if is_call_expression(a, tested_expression)
                            && is_call_expression(a, child_expression)
                        {
                            child_expression = a.expression(child_expression);
                            tested_expression = a.expression(tested_expression);
                        } else {
                            return false;
                        }
                    }
                }
            }
            a.for_each_child(child_node, &mut |grandchild| {
                visit(c, grandchild, expr, tested_node, tested_symbol)
            })
        }
        let a = self.ast;
        a.for_each_child(body, &mut |child| {
            visit(self, child, expr, tested_node, tested_symbol)
        })
    }

    pub fn check_do_statement(&mut self, node: NodeId) {
        let a = self.ast;
        self.check_grammar_statement_in_ambient_context(node);
        self.check_source_element(a.statement(node));
        self.check_truthiness_expression(a.expression(node), CheckMode::NORMAL);
    }

    pub fn check_while_statement(&mut self, node: NodeId) {
        let a = self.ast;
        self.check_grammar_statement_in_ambient_context(node);
        self.check_truthiness_expression(a.expression(node), CheckMode::NORMAL);
        self.check_source_element(a.statement(node));
    }

    pub fn check_for_statement(&mut self, node: NodeId) {
        let a = self.ast;
        if !self.check_grammar_statement_in_ambient_context(node) {
            let init = a.initializer(node);
            if !init.is_nil() && a.kind(init) == Kind::VariableDeclarationList {
                self.check_grammar_variable_declaration_list(init);
            }
        }
        let data = a.as_for_statement(node);
        if !data.initializer.is_nil() {
            if is_variable_declaration_list(a, data.initializer) {
                self.check_variable_declaration_list(data.initializer);
            } else {
                self.check_expression(data.initializer);
            }
        }
        if !data.condition.is_nil() {
            self.check_truthiness_expression(data.condition, CheckMode::NORMAL);
        }
        if !data.incrementor.is_nil() {
            self.check_expression(data.incrementor);
        }
        self.check_source_element(data.statement);
        if !a.locals(node).is_nil() {
            self.register_for_unused_identifiers_check(node);
        }
    }

    pub fn check_for_in_statement(&mut self, node: NodeId) {
        let a = self.ast;
        let data = a.as_for_in_or_of_statement(node);
        self.check_grammar_for_in_or_for_of_statement(node);
        let expression_type = self.check_expression(data.expression);
        let right_type = self.get_non_nullable_type_if_needed(expression_type);
        // TypeScript 1.0 spec (April 2014): 5.4 In a 'for-in' statement of the form `for (let VarDecl in Expr) Statement`, VarDecl must be a variable declaration without a type annotation that declares a variable of type Any, and Expr must be an expression of type Any, an object type, or a type parameter type.
        if is_variable_declaration_list(a, data.initializer) {
            let declarations = a.nodes(
                a.as_variable_declaration_list(data.initializer)
                    .declarations,
            );
            if declarations.len() != 0 && is_binding_pattern(a, a.name(declarations.at(0usize))) {
                self.error(
                    a.name(declarations.at(0usize)),
                    diagnostics::THE_LEFT_HAND_SIDE_OF_A_FOR_IN_STATEMENT_CANNOT_BE_A_DESTRUCTURING_PATTERN,
                    &[],
                );
            }
            self.check_variable_declaration_list(data.initializer);
        } else {
            // In a 'for-in' statement of the form `for (Var in Expr) Statement`, Var must be an expression classified as a reference of type Any or the String primitive type, and Expr must be an expression of type Any, an object type, or a type parameter type.
            let var_expr = data.initializer;
            let left_type = self.check_expression(var_expr);
            if is_array_literal_expression(a, var_expr) || is_object_literal_expression(a, var_expr)
            {
                self.error(
                    var_expr,
                    diagnostics::THE_LEFT_HAND_SIDE_OF_A_FOR_IN_STATEMENT_CANNOT_BE_A_DESTRUCTURING_PATTERN,
                    &[],
                );
            } else {
                let index_type = self.get_index_type_or_string(right_type);
                if !self.is_type_assignable_to(index_type, left_type) {
                    self.error(
                        var_expr,
                        diagnostics::THE_LEFT_HAND_SIDE_OF_A_FOR_IN_STATEMENT_MUST_BE_OF_TYPE_STRING_OR_ANY,
                        &[],
                    );
                } else {
                    // run check only former check succeeded to avoid cascading errors
                    self.check_reference_expression(
                        var_expr,
                        diagnostics::THE_LEFT_HAND_SIDE_OF_A_FOR_IN_STATEMENT_MUST_BE_A_VARIABLE_OR_A_PROPERTY_ACCESS,
                        diagnostics::THE_LEFT_HAND_SIDE_OF_A_FOR_IN_STATEMENT_MAY_NOT_BE_AN_OPTIONAL_PROPERTY_ACCESS,
                    );
                }
            }
        }
        // unknownType is returned i.e. if node.expression is identifier whose name cannot be resolved: in this case error about missing name is already reported - do not report extra one
        if right_type == self.never_type
            || !self.is_type_assignable_to_kind(
                right_type,
                TypeFlags::NON_PRIMITIVE | TypeFlags::INSTANTIABLE_NON_PRIMITIVE,
            )
        {
            let type_name = self.type_to_string_exported(right_type);
            self.error(data.expression, diagnostics::THE_RIGHT_HAND_SIDE_OF_A_FOR_IN_STATEMENT_MUST_BE_OF_TYPE_ANY_AN_OBJECT_TYPE_OR_A_TYPE_PARAMETER_BUT_HERE_HAS_TYPE_0, &[Arg::Str(&type_name)]);
        }
        self.check_source_element(data.statement);
        if !a.locals(node).is_nil() {
            self.register_for_unused_identifiers_check(node);
        }
    }

    pub fn get_index_type_or_string(&mut self, t: TypeId) -> TypeId {
        let index = self.get_index_type(t);
        let index_type = self.get_extract_string_type(index);
        if self.types[index_type].flags.intersects(TypeFlags::NEVER) {
            self.string_type
        } else {
            index_type
        }
    }

    pub fn check_for_of_statement(&mut self, node: NodeId) {
        let a = self.ast;
        let data = a.as_for_in_or_of_statement(node);
        self.check_grammar_for_in_or_for_of_statement(node);
        let container = get_containing_function_or_class_static_block(a, node);
        if !data.await_modifier.is_nil() {
            if !container.is_nil() && is_class_static_block_declaration(a, container) {
                self.grammar_error_on_node(
                    data.await_modifier,
                    diagnostics::X_FOR_AWAIT_LOOPS_CANNOT_BE_USED_INSIDE_A_CLASS_STATIC_BLOCK,
                    &[],
                );
            } else {
                let function_flags = get_function_flags(a, container);
                if function_flags & (FunctionFlags::INVALID | FunctionFlags::ASYNC)
                    == FunctionFlags::ASYNC
                    && self.language_version < LANGUAGE_FEATURE_MINIMUM_TARGET.for_await_of
                {
                    // for..await..of in an async function or async generator function prior to ESNext requires the __asyncValues helper
                    self.check_external_emit_helpers(
                        node,
                        ExternalEmitHelpers::FOR_AWAIT_OF_INCLUDES,
                    );
                }
            }
        }
        // Check the LHS and RHS: if the LHS is a declaration, just check it as a variable declaration, which will in turn check the RHS via checkRightHandSideOfForOf. If the LHS is an expression, check the LHS, as a destructuring assignment or as a reference. Then check that the RHS is assignable to it.
        if is_variable_declaration_list(a, data.initializer) {
            self.check_variable_declaration_list(data.initializer);
        } else {
            let var_expr = data.initializer;
            let iterated_type = self.check_right_hand_side_of_for_of(node);
            // There may be a destructuring assignment on the left side
            if is_array_literal_expression(a, var_expr) || is_object_literal_expression(a, var_expr)
            {
                // iteratedType may be undefined. In this case, we still want to check the structure of varExpr, in particular making sure it's a valid LeftHandSideExpression. But we'd like to short circuit the type relation checking as much as possible, so we pass the unknownType.
                let source_type = if iterated_type.is_nil() {
                    self.error_type
                } else {
                    iterated_type
                };
                self.check_destructuring_assignment(
                    var_expr,
                    source_type,
                    CheckMode::NORMAL,
                    false,
                );
            } else {
                let left_type = self.check_expression(var_expr);
                self.check_reference_expression(
                    var_expr,
                    diagnostics::THE_LEFT_HAND_SIDE_OF_A_FOR_OF_STATEMENT_MUST_BE_A_VARIABLE_OR_A_PROPERTY_ACCESS,
                    diagnostics::THE_LEFT_HAND_SIDE_OF_A_FOR_OF_STATEMENT_MAY_NOT_BE_AN_OPTIONAL_PROPERTY_ACCESS,
                );
                // iteratedType will be undefined if the rightType was missing properties/signatures required to get its iteratedType (like [Symbol.iterator] or next). This may be because we accessed properties from anyType, or it may have led to an error inside getElementTypeOfIterable.
                if !iterated_type.is_nil() {
                    self.check_type_assignable_to_and_optionally_elaborate(
                        iterated_type,
                        left_type,
                        var_expr,
                        data.expression,
                        MessageId::NIL,
                        None,
                    );
                }
            }
        }
        self.check_source_element(data.statement);
        if !a.locals(node).is_nil() {
            self.register_for_unused_identifiers_check(node);
        }
    }

    pub fn check_break_or_continue_statement(&mut self, node: NodeId) {
        if !self.check_grammar_statement_in_ambient_context(node) {
            self.check_grammar_break_or_continue_statement(node);
        }
    }

    pub fn check_return_statement(&mut self, node: NodeId) {
        let a = self.ast;
        // Always check the return expression so its identifiers are resolved even when the return statement is misplaced (grammar error), keeping diagnostics stable regardless of traversal order.
        let expr_node = a.expression(node);
        let mut expr_type = self.undefined_type;
        if !expr_node.is_nil() {
            expr_type = self.check_expression_cached(expr_node);
        }
        if self.check_grammar_statement_in_ambient_context(node) {
            return;
        }
        let container = get_containing_function_or_class_static_block(a, node);
        if !container.is_nil() && is_class_static_block_declaration(a, container) {
            self.grammar_error_on_first_token(
                node,
                diagnostics::A_RETURN_STATEMENT_CANNOT_BE_USED_INSIDE_A_CLASS_STATIC_BLOCK,
                &[],
            );
            return;
        }
        if container.is_nil() {
            self.grammar_error_on_first_token(
                node,
                diagnostics::A_RETURN_STATEMENT_CAN_ONLY_BE_USED_WITHIN_A_FUNCTION_BODY,
                &[],
            );
            return;
        }
        let signature = self.get_signature_from_declaration(container);
        let return_type = self.get_return_type_of_signature(signature);
        let function_flags = get_function_flags(a, container);
        if self.strict_null_checks
            || !expr_node.is_nil()
            || self.types[return_type].flags.intersects(TypeFlags::NEVER)
        {
            if is_set_accessor_declaration(a, container) {
                if !expr_node.is_nil() {
                    self.error(node, diagnostics::SETTERS_CANNOT_RETURN_A_VALUE, &[]);
                }
            } else if is_constructor_declaration(a, container) {
                if !expr_node.is_nil()
                    && !self.check_type_assignable_to_and_optionally_elaborate(
                        expr_type,
                        return_type,
                        node,
                        expr_node,
                        MessageId::NIL,
                        None,
                    )
                {
                    self.error(node, diagnostics::RETURN_TYPE_OF_CONSTRUCTOR_SIGNATURE_MUST_BE_ASSIGNABLE_TO_THE_INSTANCE_TYPE_OF_THE_CLASS, &[]);
                }
            } else if !self.get_return_type_from_annotation(container).is_nil() {
                let mut unwrapped_return_type =
                    self.unwrap_return_type(return_type, function_flags);
                if unwrapped_return_type.is_nil() {
                    unwrapped_return_type = return_type;
                }
                self.check_return_expression(
                    container,
                    unwrapped_return_type,
                    node,
                    a.expression(node),
                    expr_type,
                    false,
                );
            }
        } else if !is_constructor_declaration(a, container)
            && self.compiler_options.no_implicit_returns.is_true()
            && !self.is_unwrapped_return_type_undefined_void_or_any(container, return_type)
        {
            // The function has a return type, but the return statement doesn't have an expression.
            self.error(node, diagnostics::NOT_ALL_CODE_PATHS_RETURN_A_VALUE, &[]);
        }
    }

    // When checking an arrow expression such as `(x) => exp`, then `node` is the expression `exp`. Otherwise, `node` is a return statement.
    pub fn check_return_expression(
        &mut self,
        container: NodeId,
        unwrapped_return_type: TypeId,
        node: NodeId,
        expr: NodeId,
        expr_type: TypeId,
        in_conditional_expression: bool,
    ) {
        let a = self.ast;
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let mut unwrapped_expr_type = expr_type;
        let function_flags = get_function_flags(a, container);
        if !expr.is_nil() {
            let unwrapped_expr = skip_parentheses(a, expr);
            if is_conditional_expression(a, unwrapped_expr) {
                let when_true = a.as_conditional_expression(unwrapped_expr).when_true;
                let when_false = a.as_conditional_expression(unwrapped_expr).when_false;
                let when_true_type = self.check_expression(when_true);
                self.check_return_expression(
                    container,
                    unwrapped_return_type,
                    node,
                    when_true,
                    when_true_type,
                    true,
                );
                let when_false_type = self.check_expression(when_false);
                self.check_return_expression(
                    container,
                    unwrapped_return_type,
                    node,
                    when_false,
                    when_false_type,
                    true,
                );
                return;
            }
        }
        let in_return_statement = a.kind(node) == Kind::ReturnStatement;
        if function_flags.intersects(FunctionFlags::ASYNC) {
            unwrapped_expr_type = self.check_awaited_type(expr_type, false, node, diagnostics::THE_RETURN_TYPE_OF_AN_ASYNC_FUNCTION_MUST_EITHER_BE_A_VALID_PROMISE_OR_MUST_NOT_CONTAIN_A_CALLABLE_THEN_MEMBER);
        }
        // The effective expression for diagnostics purposes.
        let mut effective_expr = expr;
        if !expr.is_nil() {
            effective_expr = self.get_effective_check_node(expr);
        }
        let error_node = if in_return_statement && !in_conditional_expression {
            node
        } else {
            effective_expr
        };
        self.check_type_assignable_to_and_optionally_elaborate(
            unwrapped_expr_type,
            unwrapped_return_type,
            error_node,
            effective_expr,
            MessageId::NIL,
            None,
        );
    }

    pub fn check_with_statement(&mut self, node: NodeId) {
        let a = self.ast;
        if !self.check_grammar_statement_in_ambient_context(node) {
            if a.flags(node).intersects(NodeFlags::AWAIT_CONTEXT) {
                self.grammar_error_on_first_token(
                    node,
                    diagnostics::X_WITH_STATEMENTS_ARE_NOT_ALLOWED_IN_AN_ASYNC_FUNCTION_BLOCK,
                    &[],
                );
            }
        }
        self.check_expression(a.expression(node));
        let source_file = get_source_file_of_node(a, node);
        if !self.has_parse_diagnostics(source_file) {
            let start = skip_trivia(a.as_source_file(source_file).text(), a.pos(node));
            let end = a.pos(a.statement(node));
            self.grammar_error_at_pos(source_file, start, end - start, diagnostics::THE_WITH_STATEMENT_IS_NOT_SUPPORTED_ALL_SYMBOLS_IN_A_WITH_BLOCK_WILL_HAVE_TYPE_ANY, &[]);
        }
    }

    pub fn check_switch_statement(&mut self, node: NodeId) {
        let a = self.ast;
        // Grammar checking
        self.check_grammar_statement_in_ambient_context(node);
        let mut first_default_clause = NodeId::NIL;
        let mut has_duplicate_default_clause = false;
        let expression_type = self.check_expression(a.expression(node));
        let case_block = a.as_switch_statement(node).case_block;
        for &clause in a.nodes(a.as_case_block(case_block).clauses).as_slice() {
            // Grammar check for duplicate default clauses, skip if we already report duplicate default clause
            if is_default_clause(a, clause) && !has_duplicate_default_clause {
                if first_default_clause.is_nil() {
                    first_default_clause = clause;
                } else {
                    self.grammar_error_on_node(
                        clause,
                        diagnostics::A_DEFAULT_CLAUSE_CANNOT_APPEAR_MORE_THAN_ONCE_IN_A_SWITCH_STATEMENT,
                        &[],
                    );
                    has_duplicate_default_clause = true;
                }
            }
            if is_case_clause(a, clause) {
                let case_type = self.check_expression(a.expression(clause));
                if !self.is_type_equality_comparable_to(expression_type, case_type) {
                    // expressionType is not comparable to caseType, try the reversed check and report errors if it fails
                    self.check_type_comparable_to(
                        case_type,
                        expression_type,
                        a.expression(clause),
                        MessageId::NIL,
                    );
                }
            }
            self.check_source_elements(a.statements(clause));
            if self
                .compiler_options
                .no_fallthrough_cases_in_switch
                .is_true()
            {
                let flow_node = a.as_case_or_default_clause(clause).fallthrough_flow_node;
                if !flow_node.is_nil() && self.is_reachable_flow_node(flow_node) {
                    self.error(clause, diagnostics::FALLTHROUGH_CASE_IN_SWITCH, &[]);
                }
            }
        }
        if !a.locals(case_block).is_nil() {
            self.register_for_unused_identifiers_check(case_block);
        }
    }

    pub fn check_labeled_statement(&mut self, node: NodeId) {
        let a = self.ast;
        let labeled_statement = a.as_labeled_statement(node);
        let label_node = labeled_statement.label;
        let label_text = a.text(label_node);
        if !self.check_grammar_statement_in_ambient_context(node) {
            let mut current = a.parent(node);
            while !current.is_nil() && !is_function_like(a, current) {
                if is_labeled_statement(a, current) && a.text(a.label(current)) == label_text {
                    self.grammar_error_on_node(
                        label_node,
                        diagnostics::DUPLICATE_LABEL_0,
                        &[Arg::Str(label_text)],
                    );
                    break;
                }
                current = a.parent(current);
            }
        }
        if a.flags(label_node).intersects(NodeFlags::UNREACHABLE)
            && self.compiler_options.allow_unused_labels != Tristate::TRUE
        {
            self.error_or_suggestion(
                self.compiler_options.allow_unused_labels == Tristate::FALSE,
                label_node,
                diagnostics::UNUSED_LABEL,
                &[],
            );
        }
        self.check_source_element(labeled_statement.statement);
    }

    pub fn check_throw_statement(&mut self, node: NodeId) {
        let a = self.ast;
        let throw_expr = a.expression(node);
        if !self.check_grammar_statement_in_ambient_context(node) {
            if is_identifier(a, throw_expr) && a.text(throw_expr).is_empty() {
                self.grammar_error_at_pos(
                    node,
                    a.pos(throw_expr),
                    0,
                    diagnostics::LINE_BREAK_NOT_PERMITTED_HERE,
                    &[],
                );
            }
        }
        self.check_expression(throw_expr);
    }

    pub fn check_try_statement(&mut self, node: NodeId) {
        let a = self.ast;
        self.check_grammar_statement_in_ambient_context(node);
        let data = a.as_try_statement(node);
        self.check_block(data.try_block);
        if !data.catch_clause.is_nil() {
            self.check_catch_clause(data.catch_clause);
        }
        if !data.finally_block.is_nil() {
            self.check_block(data.finally_block);
        }
    }

    pub fn check_catch_clause(&mut self, node: NodeId) {
        let a = self.ast;
        let declaration = a.as_catch_clause(node).variable_declaration;
        if !declaration.is_nil() {
            self.check_variable_like_declaration(declaration);
            let type_node = a.type_node(declaration);
            if !type_node.is_nil() {
                let t = self.get_type_from_type_node(type_node);
                if !t.is_nil() && !self.types[t].flags.intersects(TypeFlags::ANY_OR_UNKNOWN) {
                    self.grammar_error_on_first_token(type_node, diagnostics::CATCH_CLAUSE_VARIABLE_TYPE_ANNOTATION_MUST_BE_ANY_OR_UNKNOWN_IF_SPECIFIED, &[]);
                }
            } else if !a.initializer(declaration).is_nil() {
                self.grammar_error_on_first_token(
                    a.initializer(declaration),
                    diagnostics::CATCH_CLAUSE_VARIABLE_CANNOT_HAVE_AN_INITIALIZER,
                    &[],
                );
            } else {
                let block_locals = a.locals(a.as_catch_clause(node).block);
                if !block_locals.is_nil() {
                    // Upstream ranges over the locals of the clause (a map): the table is walked in its own order.
                    let mut position = 0;
                    while let Some((caught_name, _)) = a.table_entry_at(a.locals(node), position) {
                        position += 1;
                        let block_local = a.table_get(block_locals, caught_name);
                        if block_local.is_nil() {
                            continue;
                        }
                        let block_local_data = a.sym(block_local);
                        if !block_local_data.value_declaration.is_nil()
                            && block_local_data
                                .flags
                                .intersects(SymbolFlags::BLOCK_SCOPED_VARIABLE)
                        {
                            self.grammar_error_on_node(
                                block_local_data.value_declaration,
                                diagnostics::CANNOT_REDECLARE_IDENTIFIER_0_IN_CATCH_CLAUSE,
                                &[Arg::Str(caught_name)],
                            );
                        }
                    }
                }
            }
        }
        self.check_block(a.as_catch_clause(node).block);
    }

    pub fn check_binding_element(&mut self, node: NodeId) {
        self.check_grammar_binding_element(node);
        self.check_variable_like_declaration(node);
    }
}
