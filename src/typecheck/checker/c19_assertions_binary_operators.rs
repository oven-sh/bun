// checker.go:12378-13233 (layers E-CORE, E-OPER): the check of a type assertion with its deferred comparability test, binary expressions with the arithmetic, comparison, equality, logical, assignment and comma operators, destructuring assignments to object and array literals, the errors of an operator, NaN comparisons, the syntactic truthiness and nullishness of an operand, instanceof and in, and reference expressions. getExactOptionalUnassignableProperties and isExactOptionalPropertyMismatch of 13208-13219 are in relater.rs.
use crate::ast::{
    Arg, JSDeclarationKind, Kind, NodeFlags, NodeId, NodeListId, OuterExpressionKinds,
    get_assignment_declaration_kind, get_containing_class, get_source_file_of_node,
    is_access_expression, is_array_literal_expression, is_assignment_operator,
    is_binary_expression, is_call_expression, is_compound_assignment, is_declaration_node,
    is_entity_name_expression, is_enum_member, is_identifier, is_if_statement, is_in_js_file,
    is_logical_binary_operator, is_logical_or_coalescing_binary_expression,
    is_logical_or_coalescing_binary_operator, is_numeric_literal, is_object_literal_expression,
    is_omitted_expression, is_parenthesized_expression, is_private_identifier,
    is_property_access_expression, is_property_assignment, is_shorthand_property_assignment,
    is_spread_assignment, is_spread_element, is_tagged_template_expression,
    skip_outer_expressions, skip_parentheses, walk_up_parenthesized_expressions,
};
use crate::checker::types::checker_flags;
use crate::checker::{
    AccessFlags, CheckMode, Checker, ExternalEmitHelpers, IterationUse,
    LANGUAGE_FEATURE_MINIMUM_TARGET, LiteralValue, TypeAliasId, TypeFacts, TypeFlags, TypeId,
    UnionReduction, entity_name_to_string, every_type, get_property_name_from_type,
    is_const_type_reference, is_literal_expression_of_object, is_tuple_type, is_type_any,
    is_type_usable_as_property_name, some_type,
};
use crate::core::{List, ScriptTarget, Tristate, if_else, new_text_range, or_else, some};
use crate::diagnostics::{self, MessageId};
use crate::jsnum::Number;
use crate::scanner::{get_text_of_node, skip_trivia, token_to_string};
use crate::tspath::{EXTENSION_CTS, EXTENSION_MTS, file_extension_is_one_of};

impl<'a> Checker<'a> {
    pub fn check_assertion(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let a = self.ast;
        if a.kind(node) == Kind::TypeAssertionExpression {
            let file = get_source_file_of_node(a, node);
            if !file.is_nil()
                && file_extension_is_one_of(
                    a.as_source_file(file).file_name(),
                    &[EXTENSION_MTS, EXTENSION_CTS],
                )
            {
                self.grammar_error_on_node(
                    node,
                    diagnostics::THIS_SYNTAX_IS_RESERVED_IN_FILES_WITH_THE_MTS_OR_CTS_EXTENSION_USE_AN_AS_EXPRESSION_INSTEAD,
                    &[],
                );
            }
            if self.should_check_erasable_syntax(node) {
                let source_file = get_source_file_of_node(a, node);
                let start = skip_trivia(a.as_source_file(source_file).text(), a.pos(node));
                let diagnostic = self.diagnostic_store.new_diagnostic(
                    source_file,
                    new_text_range(start, a.pos(a.expression(node))),
                    diagnostics::THIS_SYNTAX_IS_NOT_ALLOWED_WHEN_ERASABLESYNTAXONLY_IS_ENABLED,
                    &[],
                );
                self.add_diagnostic(diagnostic);
            }
        }
        let type_node = a.type_node(node);
        let expr_type = self.check_expression_ex(a.expression(node), check_mode);
        // Always check the type node so its identifiers are resolved. resolveName knows not to resolve (or report an error for) the `const` in a `const` assertion, so this is safe even for `x as const` and keeps diagnostics stable regardless of traversal order.
        self.check_source_element(type_node);
        if is_const_type_reference(a, type_node) {
            if !self.is_valid_const_assertion_argument(a.expression(node)) {
                self.error(
                    a.expression(node),
                    diagnostics::A_CONST_ASSERTION_CAN_ONLY_BE_APPLIED_TO_REFERENCES_TO_ENUM_MEMBERS_OR_STRING_NUMBER_BOOLEAN_ARRAY_OR_OBJECT_LITERALS,
                    &[],
                );
            }
            return self.get_regular_type_of_literal_type(expr_type);
        }
        let links = self.assertion_links.get(node);
        self.assertion_links[links].expr_type = expr_type;
        self.check_node_deferred(node);
        self.get_type_from_type_node(type_node)
    }

    pub fn check_assertion_deferred(&mut self, node: NodeId) {
        let a = self.ast;
        let type_node = a.type_node(node);
        let links = self.assertion_links.get(node);
        let links_expr_type = self.assertion_links[links].expr_type;
        let base_type = self.get_base_type_of_literal_type(links_expr_type);
        let expr_type = self.get_regular_type_of_object_literal(base_type);
        let target_type = self.get_type_from_type_node(type_node);
        if !self.is_error_type(target_type) {
            let widened_type = self.get_widened_type(expr_type);
            if !self.is_type_comparable_to(target_type, widened_type) {
                let mut err_node = node;
                if a.flags(type_node).intersects(NodeFlags::REPARSED) {
                    err_node = type_node;
                }
                self.check_type_comparable_to(
                    expr_type,
                    target_type,
                    err_node,
                    diagnostics::CONVERSION_OF_TYPE_0_TO_TYPE_1_MAY_BE_A_MISTAKE_BECAUSE_NEITHER_TYPE_SUFFICIENTLY_OVERLAPS_WITH_THE_OTHER_IF_THIS_WAS_INTENTIONAL_CONVERT_THE_EXPRESSION_TO_UNKNOWN_FIRST,
                );
            }
        }
    }

    pub fn check_binary_expression(&mut self, node: NodeId, check_mode: CheckMode) -> TypeId {
        let binary = self.ast.as_binary_expression(node);
        self.check_binary_like_expression(
            binary.left,
            binary.operator_token,
            binary.right,
            check_mode,
            node,
        )
    }

    pub fn check_binary_like_expression(
        &mut self,
        left: NodeId,
        operator_token: NodeId,
        right: NodeId,
        check_mode: CheckMode,
        error_node: NodeId,
    ) -> TypeId {
        let a = self.ast;
        let operator = a.kind(operator_token);
        if operator == Kind::EqualsToken
            && (a.kind(left) == Kind::ObjectLiteralExpression
                || a.kind(left) == Kind::ArrayLiteralExpression)
        {
            let right_type = self.check_expression_ex(right, check_mode);
            return self.check_destructuring_assignment(
                left,
                right_type,
                check_mode,
                a.kind(right) == Kind::ThisKeyword,
            );
        }
        let mut left_type = self.check_expression_ex(left, check_mode);
        let mut right_type = self.check_expression_ex(right, check_mode);
        if is_logical_or_coalescing_binary_operator(operator) {
            let mut parent = a.parent(a.parent(left));
            while is_parenthesized_expression(a, parent)
                || is_logical_or_coalescing_binary_expression(a, parent)
            {
                parent = a.parent(parent);
            }
            if operator == Kind::AmpersandAmpersandToken || is_if_statement(a, parent) {
                let mut body = NodeId::NIL;
                if is_if_statement(a, parent) {
                    body = a.as_if_statement(parent).then_statement;
                }
                self.check_testing_known_truthy_callable_or_awaitable_or_enum_member_type(
                    left, left_type, body,
                );
            }
            if is_logical_binary_operator(operator) {
                self.check_truthiness_of_type(left_type, left);
            }
        }
        match operator {
            Kind::AsteriskToken
            | Kind::AsteriskAsteriskToken
            | Kind::AsteriskEqualsToken
            | Kind::AsteriskAsteriskEqualsToken
            | Kind::SlashToken
            | Kind::SlashEqualsToken
            | Kind::PercentToken
            | Kind::PercentEqualsToken
            | Kind::MinusToken
            | Kind::MinusEqualsToken
            | Kind::LessThanLessThanToken
            | Kind::LessThanLessThanEqualsToken
            | Kind::GreaterThanGreaterThanToken
            | Kind::GreaterThanGreaterThanEqualsToken
            | Kind::GreaterThanGreaterThanGreaterThanToken
            | Kind::GreaterThanGreaterThanGreaterThanEqualsToken
            | Kind::BarToken
            | Kind::BarEqualsToken
            | Kind::CaretToken
            | Kind::CaretEqualsToken
            | Kind::AmpersandToken
            | Kind::AmpersandEqualsToken => {
                if left_type == self.silent_never_type || right_type == self.silent_never_type {
                    return self.silent_never_type;
                }
                left_type = self.check_non_null_type(left_type, left);
                right_type = self.check_non_null_type(right_type, right);
                // if a user tries to apply a bitwise operator to 2 boolean operands try and return them a helpful suggestion
                if self.types[left_type]
                    .flags
                    .intersects(TypeFlags::BOOLEAN_LIKE)
                    && self.types[right_type]
                        .flags
                        .intersects(TypeFlags::BOOLEAN_LIKE)
                {
                    let suggested_operator = self.get_suggested_boolean_operator(operator);
                    if suggested_operator != Kind::Unknown {
                        self.error(
                            operator_token,
                            diagnostics::THE_0_OPERATOR_IS_NOT_ALLOWED_FOR_BOOLEAN_TYPES_CONSIDER_USING_1_INSTEAD,
                            &[
                                Arg::Str(token_to_string(a.kind(operator_token))),
                                Arg::Str(token_to_string(suggested_operator)),
                            ],
                        );
                        return self.number_type;
                    }
                }
                // otherwise just check each operand separately and report errors as normal
                let left_ok = self.check_arithmetic_operand_type(
                    left,
                    left_type,
                    diagnostics::THE_LEFT_HAND_SIDE_OF_AN_ARITHMETIC_OPERATION_MUST_BE_OF_TYPE_ANY_NUMBER_BIGINT_OR_AN_ENUM_TYPE,
                    true,
                );
                let right_ok = self.check_arithmetic_operand_type(
                    right,
                    right_type,
                    diagnostics::THE_RIGHT_HAND_SIDE_OF_AN_ARITHMETIC_OPERATION_MUST_BE_OF_TYPE_ANY_NUMBER_BIGINT_OR_AN_ENUM_TYPE,
                    true,
                );
                // If both are any or unknown, allow operation; assume it will resolve to number
                let result_type = if self
                    .is_type_assignable_to_kind(left_type, TypeFlags::ANY_OR_UNKNOWN)
                    && self.is_type_assignable_to_kind(right_type, TypeFlags::ANY_OR_UNKNOWN)
                    || !self.maybe_type_of_kind(left_type, TypeFlags::BIG_INT_LIKE)
                        && !self.maybe_type_of_kind(right_type, TypeFlags::BIG_INT_LIKE)
                {
                    self.number_type
                } else if self.both_are_big_int_like(left_type, right_type) {
                    match operator {
                        Kind::GreaterThanGreaterThanGreaterThanToken
                        | Kind::GreaterThanGreaterThanGreaterThanEqualsToken => {
                            self.report_operator_error(
                                left_type, operator, right_type, error_node, None,
                            );
                        }
                        Kind::AsteriskAsteriskToken | Kind::AsteriskAsteriskEqualsToken => {
                            if self.language_version < ScriptTarget::ES2016 {
                                self.error(
                                    error_node,
                                    diagnostics::EXPONENTIATION_CANNOT_BE_PERFORMED_ON_BIGINT_VALUES_UNLESS_THE_TARGET_OPTION_IS_SET_TO_ES2016_OR_LATER,
                                    &[],
                                );
                            }
                        }
                        _ => {}
                    }
                    self.bigint_type
                } else {
                    self.report_operator_error(
                        left_type,
                        operator,
                        right_type,
                        error_node,
                        Some(&mut |c: &mut Checker<'a>, left: TypeId, right: TypeId| {
                            c.both_are_big_int_like(left, right)
                        }),
                    );
                    self.error_type
                };
                if left_ok && right_ok {
                    self.check_assignment_operator(left, operator, right, left_type, result_type);
                    match operator {
                        Kind::LessThanLessThanToken
                        | Kind::LessThanLessThanEqualsToken
                        | Kind::GreaterThanGreaterThanToken
                        | Kind::GreaterThanGreaterThanEqualsToken
                        | Kind::GreaterThanGreaterThanGreaterThanToken
                        | Kind::GreaterThanGreaterThanGreaterThanEqualsToken => {
                            let rhs_eval = self.evaluate(right, right);
                            if let LiteralValue::Number(value) = rhs_eval.value {
                                let num_value = Number(value);
                                if num_value.abs() >= Number(32.0) {
                                    // Elevate from suggestion to error within an enum member
                                    let left_text = get_text_of_node(a, left);
                                    let remainder = num_value.remainder(Number(32.0)).string();
                                    self.error_or_suggestion(
                                        is_enum_member(
                                            a,
                                            walk_up_parenthesized_expressions(
                                                a,
                                                a.parent(a.parent(right)),
                                            ),
                                        ),
                                        error_node,
                                        diagnostics::THIS_OPERATION_CAN_BE_SIMPLIFIED_THIS_SHIFT_IS_IDENTICAL_TO_0_1_2,
                                        &[
                                            Arg::Str(&left_text),
                                            Arg::Str(token_to_string(operator)),
                                            Arg::Str(&remainder),
                                        ],
                                    );
                                }
                            }
                        }
                        _ => {}
                    }
                }
                result_type
            }
            Kind::PlusToken | Kind::PlusEqualsToken => {
                if left_type == self.silent_never_type || right_type == self.silent_never_type {
                    return self.silent_never_type;
                }
                if !self.is_type_assignable_to_kind(left_type, TypeFlags::STRING_LIKE)
                    && !self.is_type_assignable_to_kind(right_type, TypeFlags::STRING_LIKE)
                {
                    left_type = self.check_non_null_type(left_type, left);
                    right_type = self.check_non_null_type(right_type, right);
                }
                let mut result_type = TypeId::NIL;
                if self.is_type_assignable_to_kind_ex(left_type, TypeFlags::NUMBER_LIKE, true)
                    && self.is_type_assignable_to_kind_ex(right_type, TypeFlags::NUMBER_LIKE, true)
                {
                    // Operands of an enum type are treated as having the primitive type Number. If both operands are of the Number primitive type, the result is of the Number primitive type.
                    result_type = self.number_type;
                } else if self.is_type_assignable_to_kind_ex(
                    left_type,
                    TypeFlags::BIG_INT_LIKE,
                    true,
                ) && self.is_type_assignable_to_kind_ex(
                    right_type,
                    TypeFlags::BIG_INT_LIKE,
                    true,
                ) {
                    // If both operands are of the BigInt primitive type, the result is of the BigInt primitive type.
                    result_type = self.bigint_type;
                } else if self.is_type_assignable_to_kind_ex(left_type, TypeFlags::STRING_LIKE, true)
                    || self.is_type_assignable_to_kind_ex(right_type, TypeFlags::STRING_LIKE, true)
                {
                    // If one or both operands are of the String primitive type, the result is of the String primitive type.
                    result_type = self.string_type;
                } else if is_type_any(self, left_type) || is_type_any(self, right_type) {
                    // Otherwise, the result is of type Any. NOTE: unknown type here denotes error type. Old compiler treated this case as any type so do we.
                    if self.is_error_type(left_type) || self.is_error_type(right_type) {
                        result_type = self.error_type;
                    } else {
                        result_type = self.any_type;
                    }
                }
                // Symbols are not allowed at all in arithmetic expressions
                if !result_type.is_nil()
                    && !self.check_for_disallowed_es_symbol_operand(
                        left, right, left_type, right_type, operator,
                    )
                {
                    return result_type;
                }
                if result_type.is_nil() {
                    // Types that have a reasonably good chance of being a valid operand type. If both types have an awaited type of one of these, we'll assume the user might be missing an await without doing an exhaustive check that inserting await(s) will actually be a completely valid binary expression.
                    let close_enough_kind = TypeFlags::NUMBER_LIKE
                        | TypeFlags::BIG_INT_LIKE
                        | TypeFlags::STRING_LIKE
                        | TypeFlags::ANY_OR_UNKNOWN;
                    self.report_operator_error(
                        left_type,
                        operator,
                        right_type,
                        error_node,
                        Some(&mut |c: &mut Checker<'a>, left: TypeId, right: TypeId| {
                            c.is_type_assignable_to_kind(left, close_enough_kind)
                                && c.is_type_assignable_to_kind(right, close_enough_kind)
                        }),
                    );
                    return self.any_type;
                }
                if operator == Kind::PlusEqualsToken {
                    self.check_assignment_operator(left, operator, right, left_type, result_type);
                }
                result_type
            }
            Kind::LessThanToken
            | Kind::GreaterThanToken
            | Kind::LessThanEqualsToken
            | Kind::GreaterThanEqualsToken => {
                if self.check_for_disallowed_es_symbol_operand(
                    left, right, left_type, right_type, operator,
                ) {
                    let non_null_left_type = self.check_non_null_type(left_type, left);
                    left_type =
                        self.get_base_type_of_literal_type_for_comparison(non_null_left_type);
                    let non_null_right_type = self.check_non_null_type(right_type, right);
                    right_type =
                        self.get_base_type_of_literal_type_for_comparison(non_null_right_type);
                    self.report_operator_error_unless(
                        left_type,
                        operator,
                        right_type,
                        error_node,
                        &mut |c, left, right| {
                            if is_type_any(c, left) || is_type_any(c, right) {
                                return true;
                            }
                            let left_assignable_to_number =
                                c.is_type_assignable_to(left, c.number_or_big_int_type);
                            let right_assignable_to_number =
                                c.is_type_assignable_to(right, c.number_or_big_int_type);
                            left_assignable_to_number && right_assignable_to_number
                                || !left_assignable_to_number
                                    && !right_assignable_to_number
                                    && c.are_types_comparable(left, right)
                        },
                    );
                }
                self.boolean_type
            }
            Kind::EqualsEqualsToken
            | Kind::ExclamationEqualsToken
            | Kind::EqualsEqualsEqualsToken
            | Kind::ExclamationEqualsEqualsToken => {
                // We suppress errors in CheckMode.TypeOnly (meaning the invocation came from getTypeOfExpression). During control flow analysis it is possible for operands to temporarily have narrower types, and those narrower types may cause the operands to not be comparable. We don't want such errors reported.
                if !check_mode.intersects(CheckMode::TYPE_ONLY) {
                    // only report for === and !== in JS, not == or !=
                    if (is_literal_expression_of_object(a, left)
                        || is_literal_expression_of_object(a, right))
                        && (!is_in_js_file(a, left)
                            || (operator == Kind::EqualsEqualsEqualsToken
                                || operator == Kind::ExclamationEqualsEqualsToken))
                    {
                        let eq_type = operator == Kind::EqualsEqualsToken
                            || operator == Kind::EqualsEqualsEqualsToken;
                        self.error(
                            error_node,
                            diagnostics::THIS_CONDITION_WILL_ALWAYS_RETURN_0_SINCE_JAVASCRIPT_COMPARES_OBJECTS_BY_REFERENCE_NOT_VALUE,
                            &[Arg::Str(if_else(
                                eq_type,
                                b"false".as_slice(),
                                b"true".as_slice(),
                            ))],
                        );
                    }
                    self.check_nan_equality(error_node, operator, left, right);
                    self.report_operator_error_unless(
                        left_type,
                        operator,
                        right_type,
                        error_node,
                        &mut |c, left, right| {
                            c.is_type_equality_comparable_to(left, right)
                                || c.is_type_equality_comparable_to(right, left)
                        },
                    );
                }
                self.boolean_type
            }
            Kind::InstanceOfKeyword => {
                self.check_instance_of_expression(left, right, left_type, right_type, check_mode)
            }
            Kind::InKeyword => self.check_in_expression(left, right, left_type, right_type),
            Kind::AmpersandAmpersandToken | Kind::AmpersandAmpersandEqualsToken => {
                let mut result_type = left_type;
                if self.has_type_facts(left_type, TypeFacts::TRUTHY) {
                    let mut t = left_type;
                    if !self.strict_null_checks {
                        t = self.get_base_type_of_literal_type(right_type);
                    }
                    let falsy_type = self.extract_definitely_falsy_types(t);
                    result_type = self.get_union_type(List::from_slice(&[falsy_type, right_type]));
                }
                if operator == Kind::AmpersandAmpersandEqualsToken {
                    self.check_assignment_operator(left, operator, right, left_type, right_type);
                }
                result_type
            }
            Kind::BarBarToken | Kind::BarBarEqualsToken => {
                let mut result_type = left_type;
                if self.has_type_facts(left_type, TypeFacts::FALSY) {
                    let truthy_type = self.remove_definitely_falsy_types(left_type);
                    let non_nullable_type = self.get_non_nullable_type(truthy_type);
                    result_type = self.get_union_type_ex(
                        List::from_slice(&[non_nullable_type, right_type]),
                        UnionReduction::SUBTYPE,
                        TypeAliasId::NIL,
                        TypeId::NIL,
                    );
                }
                if operator == Kind::BarBarEqualsToken {
                    self.check_assignment_operator(left, operator, right, left_type, right_type);
                }
                result_type
            }
            Kind::QuestionQuestionToken | Kind::QuestionQuestionEqualsToken => {
                if operator == Kind::QuestionQuestionToken {
                    self.check_nullish_coalesce_operands(left, right);
                }
                let mut result_type = left_type;
                if self.has_type_facts(left_type, TypeFacts::EQ_UNDEFINED_OR_NULL) {
                    let non_nullable_type = self.get_non_nullable_type(left_type);
                    result_type = self.get_union_type_ex(
                        List::from_slice(&[non_nullable_type, right_type]),
                        UnionReduction::SUBTYPE,
                        TypeAliasId::NIL,
                        TypeId::NIL,
                    );
                }
                if operator == Kind::QuestionQuestionEqualsToken {
                    self.check_assignment_operator(left, operator, right, left_type, right_type);
                }
                result_type
            }
            Kind::EqualsToken => {
                self.check_assignment_operator(left, operator, right, left_type, right_type);
                right_type
            }
            Kind::CommaToken => {
                if !self.compiler_options.allow_unreachable_code.is_true()
                    && self.is_side_effect_free(left)
                    && !self.is_indirect_call(a.parent(left))
                {
                    let sf = a.as_source_file(get_source_file_of_node(a, left));
                    let start = skip_trivia(sf.text(), a.pos(left));
                    // The parse diagnostics of a file are ids of the store of its parser.
                    let is_in_diag2657 = match sf.diagnostic_store() {
                        Some(store) => some(sf.diagnostics(), |d| {
                            if store[d].code()
                                != diagnostics::JSX_EXPRESSIONS_MUST_HAVE_ONE_PARENT_ELEMENT.code()
                            {
                                return false;
                            }
                            store[d].loc().contains(start)
                        }),
                        None => false,
                    };
                    if !is_in_diag2657 {
                        self.error(
                            left,
                            diagnostics::LEFT_SIDE_OF_COMMA_OPERATOR_IS_UNUSED_AND_HAS_NO_SIDE_EFFECTS,
                            &[],
                        );
                    }
                }
                right_type
            }
            _ => self.fail_detail(
                "Unhandled case in checkBinaryLikeExpression",
                operator as u32,
            ),
        }
    }

    pub fn check_destructuring_assignment(
        &mut self,
        node: NodeId,
        mut source_type: TypeId,
        check_mode: CheckMode,
        right_is_this: bool,
    ) -> TypeId {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let mut target = if is_shorthand_property_assignment(a, node) {
            let initializer = a
                .as_shorthand_property_assignment(node)
                .object_assignment_initializer;
            if !initializer.is_nil() {
                // In strict null checking mode, if a default value of a non-undefined type is specified, remove undefined from the final type.
                if self.strict_null_checks {
                    let initializer_type = self.check_expression(initializer);
                    if !self.has_type_facts(initializer_type, TypeFacts::IS_UNDEFINED) {
                        source_type = self.get_type_with_facts(source_type, TypeFacts::NE_UNDEFINED);
                    }
                }
                self.check_binary_like_expression(
                    a.name(node),
                    a.as_shorthand_property_assignment(node).equals_token,
                    initializer,
                    check_mode,
                    NodeId::NIL,
                );
            }
            a.name(node)
        } else {
            node
        };
        if is_binary_expression(a, target)
            && a.kind(a.as_binary_expression(target).operator_token) == Kind::EqualsToken
        {
            self.check_binary_expression(target, check_mode);
            target = a.as_binary_expression(target).left;
            // A default value is specified, so remove undefined from the final type.
            if self.strict_null_checks {
                source_type = self.get_type_with_facts(source_type, TypeFacts::NE_UNDEFINED);
            }
        }
        if is_object_literal_expression(a, target) {
            return self.check_object_literal_assignment(target, source_type, right_is_this);
        }
        if is_array_literal_expression(a, target) {
            return self.check_array_literal_assignment(target, source_type, check_mode);
        }
        self.check_reference_assignment(target, source_type, check_mode)
    }

    pub fn check_object_literal_assignment(
        &mut self,
        node: NodeId,
        source_type: TypeId,
        right_is_this: bool,
    ) -> TypeId {
        let a = self.ast;
        let properties = a.property_list(node);
        if self.strict_null_checks && a.nodes(properties).len() == 0 {
            return self.check_non_null_type(source_type, node);
        }
        for i in 0..a.nodes(properties).len() {
            self.check_object_literal_destructuring_property_assignment(
                node,
                source_type,
                i,
                properties,
                right_is_this,
            );
        }
        source_type
    }

    // Note: If property cannot be a SpreadAssignment, then allProperties does not need to be provided
    pub fn check_object_literal_destructuring_property_assignment(
        &mut self,
        node: NodeId,
        object_literal_type: TypeId,
        property_index: isize,
        all_properties: NodeListId,
        right_is_this: bool,
    ) -> TypeId {
        let a = self.ast;
        let properties = a.properties(node);
        let property = properties.at(property_index);
        if is_property_assignment(a, property) || is_shorthand_property_assignment(a, property) {
            let name = a.name(property);
            let expr_type = self.get_literal_type_from_property_name(name);
            if is_type_usable_as_property_name(self, expr_type) {
                let text = get_property_name_from_type(self, expr_type);
                let prop = self.get_property_of_type(object_literal_type, &text);
                if !prop.is_nil() {
                    self.mark_property_as_referenced(prop, property, right_is_this);
                    self.check_property_accessibility(
                        property,
                        false,
                        true,
                        object_literal_type,
                        prop,
                    );
                }
            }
            let access_flags = AccessFlags::EXPRESSION_POSITION
                | if_else(
                    self.has_default_value(property),
                    AccessFlags::ALLOW_MISSING,
                    AccessFlags::NONE,
                );
            let element_type = self.get_indexed_access_type_ex(
                object_literal_type,
                expr_type,
                access_flags,
                name,
                TypeAliasId::NIL,
            );
            let t = self.get_flow_type_of_destructuring(property, element_type);
            let mut expr = property;
            if is_property_assignment(a, property) {
                expr = a.initializer(property);
            }
            return self.check_destructuring_assignment(expr, t, CheckMode::NORMAL, false);
        }
        if is_spread_assignment(a, property) {
            if property_index < properties.len() - 1 {
                self.error(
                    property,
                    diagnostics::A_REST_ELEMENT_MUST_BE_LAST_IN_A_DESTRUCTURING_PATTERN,
                    &[],
                );
                return TypeId::NIL;
            }
            if self.language_version < LANGUAGE_FEATURE_MINIMUM_TARGET.object_spread_rest {
                self.check_external_emit_helpers(property, ExternalEmitHelpers::REST);
            }
            let mut non_rest_names: Vec<NodeId> = Vec::new();
            if !all_properties.is_nil() {
                for &other_property in a.nodes(all_properties).as_slice() {
                    if !is_spread_assignment(a, other_property) {
                        non_rest_names.push(a.name(other_property));
                    }
                }
            }
            let symbol = self.types[object_literal_type].symbol;
            let t = self.get_rest_type(
                object_literal_type,
                List::from_slice(&non_rest_names),
                symbol,
            );
            self.check_grammar_for_disallowed_trailing_comma(
                all_properties,
                diagnostics::A_REST_PARAMETER_OR_BINDING_PATTERN_MAY_NOT_HAVE_A_TRAILING_COMMA,
            );
            return self.check_destructuring_assignment(
                a.expression(property),
                t,
                CheckMode::NORMAL,
                false,
            );
        }
        self.error(property, diagnostics::PROPERTY_ASSIGNMENT_EXPECTED, &[]);
        TypeId::NIL
    }

    // C19-PART-6
}
