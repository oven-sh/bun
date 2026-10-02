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
    is_spread_assignment, is_spread_element, is_tagged_template_expression, skip_outer_expressions,
    skip_parentheses, walk_up_parenthesized_expressions,
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
                } else if self.is_type_assignable_to_kind_ex(
                    left_type,
                    TypeFlags::STRING_LIKE,
                    true,
                ) || self.is_type_assignable_to_kind_ex(
                    right_type,
                    TypeFlags::STRING_LIKE,
                    true,
                ) {
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
                        source_type =
                            self.get_type_with_facts(source_type, TypeFacts::NE_UNDEFINED);
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

    pub fn check_array_literal_assignment(
        &mut self,
        node: NodeId,
        source_type: TypeId,
        check_mode: CheckMode,
    ) -> TypeId {
        let a = self.ast;
        let elements = a.elements(node);
        // This elementType will be used if the specific property corresponding to this index is not present (aka the tuple element property). This call also checks that the parentType is in fact an iterable or array (depending on target language).
        let iterated_type = self.check_iterated_type_or_element_type(
            IterationUse::DESTRUCTURING | IterationUse::POSSIBLY_OUT_OF_BOUNDS,
            source_type,
            self.undefined_type,
            node,
        );
        let possibly_out_of_bounds_type = or_else(iterated_type, self.error_type);
        let mut in_bounds_type = if_else(
            self.compiler_options.no_unchecked_indexed_access == Tristate::TRUE,
            TypeId::NIL,
            possibly_out_of_bounds_type,
        );
        for i in 0..elements.len() {
            let mut t = possibly_out_of_bounds_type;
            if a.kind(elements.at(i)) == Kind::SpreadElement {
                if in_bounds_type.is_nil() {
                    let iterated_type = self.check_iterated_type_or_element_type(
                        IterationUse::DESTRUCTURING,
                        source_type,
                        self.undefined_type,
                        node,
                    );
                    in_bounds_type = or_else(iterated_type, self.error_type);
                }
                t = in_bounds_type;
            }
            self.check_array_literal_destructuring_element_assignment(
                node,
                source_type,
                i,
                t,
                check_mode,
            );
        }
        source_type
    }

    pub fn check_array_literal_destructuring_element_assignment(
        &mut self,
        node: NodeId,
        source_type: TypeId,
        element_index: isize,
        element_type: TypeId,
        check_mode: CheckMode,
    ) -> TypeId {
        let a = self.ast;
        let elements = a.element_list(node);
        let element = a.nodes(elements).at(element_index);
        if !is_omitted_expression(a, element) {
            if !is_spread_element(a, element) {
                let index_type = self.get_number_literal_type(Number(element_index as f64));
                if self.is_array_like_type(source_type) {
                    // We create a synthetic expression so that getIndexedAccessType doesn't get confused when the element is a SyntaxKind.ElementAccessExpression.
                    let access_flags = AccessFlags::EXPRESSION_POSITION
                        | if_else(
                            self.has_default_value(element),
                            AccessFlags::ALLOW_MISSING,
                            AccessFlags::NONE,
                        );
                    let access_node =
                        self.create_synthetic_expression(element, index_type, false, NodeId::NIL);
                    let indexed_access_type = self.get_indexed_access_type_or_undefined(
                        source_type,
                        index_type,
                        access_flags,
                        access_node,
                        TypeAliasId::NIL,
                    );
                    let element_type = or_else(indexed_access_type, self.error_type);
                    let mut assigned_type = element_type;
                    if self.has_default_value(element) {
                        assigned_type =
                            self.get_type_with_facts(element_type, TypeFacts::NE_UNDEFINED);
                    }
                    let t = self.get_flow_type_of_destructuring(element, assigned_type);
                    return self.check_destructuring_assignment(element, t, check_mode, false);
                }
                return self.check_destructuring_assignment(
                    element,
                    element_type,
                    check_mode,
                    false,
                );
            }
            if element_index < a.nodes(elements).len() - 1 {
                self.error(
                    element,
                    diagnostics::A_REST_ELEMENT_MUST_BE_LAST_IN_A_DESTRUCTURING_PATTERN,
                    &[],
                );
            } else {
                let rest_expression = a.expression(element);
                if is_binary_expression(a, rest_expression)
                    && a.kind(a.as_binary_expression(rest_expression).operator_token)
                        == Kind::EqualsToken
                {
                    self.error(
                        a.as_binary_expression(rest_expression).operator_token,
                        diagnostics::A_REST_ELEMENT_CANNOT_HAVE_AN_INITIALIZER,
                        &[],
                    );
                } else {
                    self.check_grammar_for_disallowed_trailing_comma(
                        elements,
                        diagnostics::A_REST_PARAMETER_OR_BINDING_PATTERN_MAY_NOT_HAVE_A_TRAILING_COMMA,
                    );
                    let t = if every_type(self, source_type, &mut |c, t| is_tuple_type(c, t)) {
                        self.map_type(source_type, &mut |c, t| {
                            c.slice_tuple_type(t, element_index, 0)
                        })
                    } else {
                        self.create_array_type(element_type)
                    };
                    return self.check_destructuring_assignment(
                        rest_expression,
                        t,
                        check_mode,
                        false,
                    );
                }
            }
        }
        TypeId::NIL
    }

    pub fn check_reference_assignment(
        &mut self,
        target: NodeId,
        source_type: TypeId,
        check_mode: CheckMode,
    ) -> TypeId {
        let a = self.ast;
        let target_type = self.check_expression_ex(target, check_mode);
        let message = if_else(
            is_spread_assignment(a, a.parent(target)),
            diagnostics::THE_TARGET_OF_AN_OBJECT_REST_ASSIGNMENT_MUST_BE_A_VARIABLE_OR_A_PROPERTY_ACCESS,
            diagnostics::THE_LEFT_HAND_SIDE_OF_AN_ASSIGNMENT_EXPRESSION_MUST_BE_A_VARIABLE_OR_A_PROPERTY_ACCESS,
        );
        let optional_message = if_else(
            is_spread_assignment(a, a.parent(target)),
            diagnostics::THE_TARGET_OF_AN_OBJECT_REST_ASSIGNMENT_MAY_NOT_BE_AN_OPTIONAL_PROPERTY_ACCESS,
            diagnostics::THE_LEFT_HAND_SIDE_OF_AN_ASSIGNMENT_EXPRESSION_MAY_NOT_BE_AN_OPTIONAL_PROPERTY_ACCESS,
        );
        if self.check_reference_expression(target, message, optional_message) {
            self.check_type_assignable_to_and_optionally_elaborate(
                source_type,
                target_type,
                target,
                target,
                MessageId::NIL,
                None,
            );
        }
        source_type
    }

    // `isRelated` of upstream can be nil, and it reads types through the checker, which the callback gets.
    pub fn report_operator_error(
        &mut self,
        left_type: TypeId,
        operator: Kind,
        right_type: TypeId,
        error_node: NodeId,
        mut is_related: Option<&mut dyn FnMut(&mut Checker<'a>, TypeId, TypeId) -> bool>,
    ) {
        let mut would_work_with_await = false;
        if let Some(is_related) = is_related.as_deref_mut() {
            let awaited_left_type = self.get_awaited_type_no_alias(left_type);
            let awaited_right_type = self.get_awaited_type_no_alias(right_type);
            would_work_with_await = !(awaited_left_type == left_type
                && awaited_right_type == right_type)
                && !awaited_left_type.is_nil()
                && !awaited_right_type.is_nil()
                && is_related(self, awaited_left_type, awaited_right_type);
        }
        let mut effective_left = left_type;
        let mut effective_right = right_type;
        if !would_work_with_await {
            if let Some(is_related) = is_related {
                (effective_left, effective_right) =
                    self.get_base_types_if_unrelated(left_type, right_type, is_related);
            }
        }
        let (left_str, right_str) =
            self.get_type_names_for_error_display(effective_left, effective_right);
        match operator {
            Kind::EqualsEqualsEqualsToken
            | Kind::EqualsEqualsToken
            | Kind::ExclamationEqualsEqualsToken
            | Kind::ExclamationEqualsToken => {
                self.error_and_maybe_suggest_await(
                    error_node,
                    would_work_with_await,
                    diagnostics::THIS_COMPARISON_APPEARS_TO_BE_UNINTENTIONAL_BECAUSE_THE_TYPES_0_AND_1_HAVE_NO_OVERLAP,
                    &[Arg::Str(&left_str), Arg::Str(&right_str)],
                );
            }
            _ => {
                self.error_and_maybe_suggest_await(
                    error_node,
                    would_work_with_await,
                    diagnostics::OPERATOR_0_CANNOT_BE_APPLIED_TO_TYPES_1_AND_2,
                    &[
                        Arg::Str(token_to_string(operator)),
                        Arg::Str(&left_str),
                        Arg::Str(&right_str),
                    ],
                );
            }
        }
    }

    pub fn report_operator_error_unless(
        &mut self,
        left_type: TypeId,
        operator: Kind,
        right_type: TypeId,
        error_node: NodeId,
        types_are_compatible: &mut dyn FnMut(&mut Checker<'a>, TypeId, TypeId) -> bool,
    ) {
        if !types_are_compatible(self, left_type, right_type) {
            self.report_operator_error(
                left_type,
                operator,
                right_type,
                error_node,
                Some(types_are_compatible),
            );
        }
    }

    pub fn get_base_types_if_unrelated(
        &mut self,
        left_type: TypeId,
        right_type: TypeId,
        is_related: &mut dyn FnMut(&mut Checker<'a>, TypeId, TypeId) -> bool,
    ) -> (TypeId, TypeId) {
        let mut effective_left = left_type;
        let mut effective_right = right_type;
        let left_base = self.get_base_type_of_literal_type(left_type);
        let right_base = self.get_base_type_of_literal_type(right_type);
        if !is_related(self, left_base, right_base) {
            effective_left = left_base;
            effective_right = right_base;
        }
        (effective_left, effective_right)
    }

    pub fn check_assignment_operator(
        &mut self,
        left: NodeId,
        operator: Kind,
        right: NodeId,
        mut left_type: TypeId,
        right_type: TypeId,
    ) {
        let a = self.ast;
        if is_assignment_operator(operator) {
            // We ignore assignments of undefined to CommonJS exports when there are multiple assignment declarations
            if is_declaration_node(a, a.parent(left))
                && get_assignment_declaration_kind(a, a.parent(left))
                    == JSDeclarationKind::EXPORTS_PROPERTY
            {
                let links = self.symbol_node_links.get(left);
                let symbol = self.symbol_node_links[links].resolved_symbol;
                if !symbol.is_nil()
                    && a.sym(symbol).declarations.len() > 1
                    && self.types[right_type]
                        .flags
                        .intersects(TypeFlags::UNDEFINED)
                {
                    return;
                }
            }
            // getters can be a subtype of setters, so to check for assignability we use the setter's type instead
            if is_compound_assignment(operator) && is_property_access_expression(a, left) {
                left_type = self.check_property_access_expression(left, CheckMode::NORMAL, true);
            }
            if self.check_reference_expression(
                left,
                diagnostics::THE_LEFT_HAND_SIDE_OF_AN_ASSIGNMENT_EXPRESSION_MUST_BE_A_VARIABLE_OR_A_PROPERTY_ACCESS,
                diagnostics::THE_LEFT_HAND_SIDE_OF_AN_ASSIGNMENT_EXPRESSION_MAY_NOT_BE_AN_OPTIONAL_PROPERTY_ACCESS,
            ) {
                let mut head_message = MessageId::NIL;
                if self.exact_optional_property_types
                    && is_property_access_expression(a, left)
                    && self.maybe_type_of_kind(right_type, TypeFlags::UNDEFINED)
                {
                    let object_type = self.get_type_of_expression(a.expression(left));
                    let target =
                        self.get_type_of_property_of_type(object_type, a.text(a.name(left)));
                    if self.is_exact_optional_property_mismatch(right_type, target) {
                        head_message = diagnostics::TYPE_0_IS_NOT_ASSIGNABLE_TO_TYPE_1_WITH_EXACTOPTIONALPROPERTYTYPES_COLON_TRUE_CONSIDER_ADDING_UNDEFINED_TO_THE_TYPE_OF_THE_TARGET;
                    }
                }
                // to avoid cascading errors check assignability only if 'isReference' check succeeded and no errors were reported
                self.check_type_assignable_to_and_optionally_elaborate(
                    right_type,
                    left_type,
                    left,
                    right,
                    head_message,
                    None,
                );
            }
        }
    }

    pub fn both_are_big_int_like(&mut self, left: TypeId, right: TypeId) -> bool {
        self.is_type_assignable_to_kind(left, TypeFlags::BIG_INT_LIKE)
            && self.is_type_assignable_to_kind(right, TypeFlags::BIG_INT_LIKE)
    }

    pub fn get_suggested_boolean_operator(&self, operator: Kind) -> Kind {
        match operator {
            Kind::BarToken | Kind::BarEqualsToken => Kind::BarBarToken,
            Kind::CaretToken | Kind::CaretEqualsToken => Kind::ExclamationEqualsEqualsToken,
            Kind::AmpersandToken | Kind::AmpersandEqualsToken => Kind::AmpersandAmpersandToken,
            _ => Kind::Unknown,
        }
    }

    pub fn check_arithmetic_operand_type(
        &mut self,
        operand: NodeId,
        t: TypeId,
        diagnostic: MessageId,
        is_await_valid: bool,
    ) -> bool {
        if !self.is_type_assignable_to(t, self.number_or_big_int_type) {
            let mut awaited_type = TypeId::NIL;
            if is_await_valid {
                awaited_type = self.get_awaited_type_of_promise(t);
            }
            let maybe_missing_await = !awaited_type.is_nil()
                && self.is_type_assignable_to(awaited_type, self.number_or_big_int_type);
            self.error_and_maybe_suggest_await(operand, maybe_missing_await, diagnostic, &[]);
            return false;
        }
        true
    }

    // Return true if there was no error, false if there was an error.
    pub fn check_for_disallowed_es_symbol_operand(
        &mut self,
        left: NodeId,
        right: NodeId,
        left_type: TypeId,
        right_type: TypeId,
        operator: Kind,
    ) -> bool {
        let mut offending_symbol_operand = NodeId::NIL;
        if self.maybe_type_of_kind_considering_base_constraint(left_type, TypeFlags::ES_SYMBOL_LIKE)
        {
            offending_symbol_operand = left;
        } else if self
            .maybe_type_of_kind_considering_base_constraint(right_type, TypeFlags::ES_SYMBOL_LIKE)
        {
            offending_symbol_operand = right;
        }
        if !offending_symbol_operand.is_nil() {
            self.error(
                offending_symbol_operand,
                diagnostics::THE_0_OPERATOR_CANNOT_BE_APPLIED_TO_TYPE_SYMBOL,
                &[Arg::Str(token_to_string(operator))],
            );
            return false;
        }
        true
    }

    pub fn check_nan_equality(
        &mut self,
        error_node: NodeId,
        operator: Kind,
        left: NodeId,
        right: NodeId,
    ) {
        let a = self.ast;
        let is_left_nan = self.is_global_nan(skip_parentheses(a, left));
        let is_right_nan = self.is_global_nan(skip_parentheses(a, right));
        if is_left_nan || is_right_nan {
            let err = self.error(
                error_node,
                diagnostics::THIS_CONDITION_WILL_ALWAYS_RETURN_0,
                &[Arg::Str(token_to_string(if_else(
                    operator == Kind::EqualsEqualsEqualsToken
                        || operator == Kind::EqualsEqualsToken,
                    Kind::FalseKeyword,
                    Kind::TrueKeyword,
                )))],
            );
            if is_left_nan && is_right_nan {
                return;
            }
            let mut operator_string: &[u8] = b"";
            if operator == Kind::ExclamationEqualsEqualsToken
                || operator == Kind::ExclamationEqualsToken
            {
                operator_string = token_to_string(Kind::ExclamationToken);
            }
            let mut location = left;
            if is_left_nan {
                location = right;
            }
            let expression = skip_parentheses(a, location);
            let mut entity_name: Vec<u8> = b"...".to_vec();
            if is_entity_name_expression(a, expression) {
                entity_name = entity_name_to_string(a, expression);
            }
            let suggestion = [
                operator_string,
                b"Number.isNaN(".as_slice(),
                entity_name.as_slice(),
                b")".as_slice(),
            ]
            .concat();
            let related = self.create_diagnostic_for_node(
                location,
                diagnostics::DID_YOU_MEAN_0,
                &[Arg::Str(&suggestion)],
            );
            self.diagnostic_store.add_related_info(err, related);
        }
    }

    pub fn is_global_nan(&mut self, expr: NodeId) -> bool {
        let a = self.ast;
        if is_identifier(a, expr) && a.text(expr) == b"NaN" {
            let global_nan_symbol = self.get_global_nan_symbol_or_nil();
            return !global_nan_symbol.is_nil()
                && global_nan_symbol == self.get_resolved_symbol(expr);
        }
        false
    }

    pub fn is_type_equality_comparable_to(&mut self, source: TypeId, target: TypeId) -> bool {
        self.types[target].flags.intersects(TypeFlags::NULLABLE)
            || self.is_type_comparable_to(source, target)
    }

    pub fn check_truthiness_of_type(&mut self, t: TypeId, node: NodeId) -> TypeId {
        if self.types[t].flags.intersects(TypeFlags::VOID) {
            self.error(
                node,
                diagnostics::AN_EXPRESSION_OF_TYPE_VOID_CANNOT_BE_TESTED_FOR_TRUTHINESS,
                &[],
            );
            return t;
        }
        let semantics = self.get_syntactic_truthy_semantics(node);
        if semantics != PredicateSemantics::SOMETIMES {
            self.error(
                node,
                if_else(
                    semantics == PredicateSemantics::ALWAYS,
                    diagnostics::THIS_KIND_OF_EXPRESSION_IS_ALWAYS_TRUTHY,
                    diagnostics::THIS_KIND_OF_EXPRESSION_IS_ALWAYS_FALSY,
                ),
                &[],
            );
        }
        t
    }
}

checker_flags!(PredicateSemantics: u32 {
    ALWAYS = 1 << 0,
    NEVER = 1 << 1,
    SOMETIMES = Self::ALWAYS.0 | Self::NEVER.0,
});

impl<'a> Checker<'a> {
    pub fn get_syntactic_truthy_semantics(&mut self, node: NodeId) -> PredicateSemantics {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return PredicateSemantics::SOMETIMES;
        }
        let a = self.ast;
        let node = skip_outer_expressions(a, node, OuterExpressionKinds::ALL);
        match a.kind(node) {
            Kind::NumericLiteral => {
                // Allow `while(0)` or `while(1)`
                if a.text(node) == b"0" || a.text(node) == b"1" {
                    return PredicateSemantics::SOMETIMES;
                }
                return PredicateSemantics::ALWAYS;
            }
            Kind::ArrayLiteralExpression
            | Kind::ArrowFunction
            | Kind::BigIntLiteral
            | Kind::ClassExpression
            | Kind::FunctionExpression
            | Kind::JsxElement
            | Kind::JsxSelfClosingElement
            | Kind::ObjectLiteralExpression
            | Kind::RegularExpressionLiteral => return PredicateSemantics::ALWAYS,
            Kind::VoidExpression | Kind::NullKeyword => return PredicateSemantics::NEVER,
            Kind::NoSubstitutionTemplateLiteral | Kind::StringLiteral => {
                if !a.text(node).is_empty() {
                    return PredicateSemantics::ALWAYS;
                }
                return PredicateSemantics::NEVER;
            }
            Kind::ConditionalExpression => {
                let conditional = a.as_conditional_expression(node);
                let when_true = self.get_syntactic_truthy_semantics(conditional.when_true);
                let when_false = self.get_syntactic_truthy_semantics(conditional.when_false);
                return when_true | when_false;
            }
            Kind::Identifier => {
                if self.get_resolved_symbol(node) == self.undefined_symbol {
                    return PredicateSemantics::NEVER;
                }
            }
            _ => {}
        }
        PredicateSemantics::SOMETIMES
    }

    pub fn check_nullish_coalesce_operands(&mut self, left: NodeId, right: NodeId) {
        let a = self.ast;
        if is_binary_expression(a, a.parent(a.parent(left))) {
            let grandparent_left = a.as_binary_expression(a.parent(a.parent(left))).left;
            let grandparent_operator_token = a
                .as_binary_expression(a.parent(a.parent(left)))
                .operator_token;
            if is_binary_expression(a, grandparent_left)
                && a.kind(grandparent_operator_token) == Kind::BarBarToken
            {
                self.grammar_error_on_node(
                    grandparent_left,
                    diagnostics::X_0_AND_1_OPERATIONS_CANNOT_BE_MIXED_WITHOUT_PARENTHESES,
                    &[
                        Arg::Str(token_to_string(Kind::QuestionQuestionToken)),
                        Arg::Str(token_to_string(a.kind(grandparent_operator_token))),
                    ],
                );
            }
        } else if is_binary_expression(a, left) {
            let operator_token = a.as_binary_expression(left).operator_token;
            if a.kind(operator_token) == Kind::BarBarToken
                || a.kind(operator_token) == Kind::AmpersandAmpersandToken
            {
                self.grammar_error_on_node(
                    left,
                    diagnostics::X_0_AND_1_OPERATIONS_CANNOT_BE_MIXED_WITHOUT_PARENTHESES,
                    &[
                        Arg::Str(token_to_string(a.kind(operator_token))),
                        Arg::Str(token_to_string(Kind::QuestionQuestionToken)),
                    ],
                );
            }
        } else if is_binary_expression(a, right) {
            let operator_token = a.as_binary_expression(right).operator_token;
            if a.kind(operator_token) == Kind::AmpersandAmpersandToken {
                self.grammar_error_on_node(
                    right,
                    diagnostics::X_0_AND_1_OPERATIONS_CANNOT_BE_MIXED_WITHOUT_PARENTHESES,
                    &[
                        Arg::Str(token_to_string(Kind::QuestionQuestionToken)),
                        Arg::Str(token_to_string(a.kind(operator_token))),
                    ],
                );
            }
        }
        self.check_nullish_coalesce_operand_left(left);
    }

    pub fn check_nullish_coalesce_operand_left(&mut self, left: NodeId) {
        let a = self.ast;
        let left_target = skip_outer_expressions(a, left, OuterExpressionKinds::ALL);
        let nullish_semantics = self.get_syntactic_nullishness_semantics(left_target);
        if nullish_semantics != PredicateSemantics::SOMETIMES {
            if nullish_semantics == PredicateSemantics::ALWAYS {
                self.error(
                    left_target,
                    diagnostics::THIS_EXPRESSION_IS_ALWAYS_NULLISH,
                    &[],
                );
            } else {
                self.error(
                    left_target,
                    diagnostics::RIGHT_OPERAND_OF_IS_UNREACHABLE_BECAUSE_THE_LEFT_OPERAND_IS_NEVER_NULLISH,
                    &[],
                );
            }
        }
    }

    pub fn get_syntactic_nullishness_semantics(&mut self, node: NodeId) -> PredicateSemantics {
        if !self.stack_check.is_safe_to_recurse() {
            let _: () = self.stack_limit();
            return PredicateSemantics::SOMETIMES;
        }
        let a = self.ast;
        let node = skip_outer_expressions(a, node, OuterExpressionKinds::ALL);
        match a.kind(node) {
            Kind::AwaitExpression
            | Kind::CallExpression
            | Kind::TaggedTemplateExpression
            | Kind::ElementAccessExpression
            | Kind::MetaProperty
            | Kind::NewExpression
            | Kind::PropertyAccessExpression
            | Kind::YieldExpression
            | Kind::ThisKeyword => return PredicateSemantics::SOMETIMES,
            Kind::BinaryExpression => {
                // List of operators that can produce null/undefined: || ||= && &&= ?? ??=
                let binary = a.as_binary_expression(node);
                match a.kind(binary.operator_token) {
                    Kind::BarBarToken
                    | Kind::BarBarEqualsToken
                    | Kind::AmpersandAmpersandToken
                    | Kind::AmpersandAmpersandEqualsToken => return PredicateSemantics::SOMETIMES,
                    // For these operator kinds, the right operand is effectively controlling
                    Kind::CommaToken | Kind::EqualsToken => {
                        return self.get_syntactic_nullishness_semantics(binary.right);
                    }
                    // For nullish coalescing: result is the left operand when left is non-null, or the right operand when left is null/undefined. The nullishness of the result combines both paths: the left's non-null path contributes Never, and when left can be null, the right's semantics are also included.
                    Kind::QuestionQuestionToken | Kind::QuestionQuestionEqualsToken => {
                        let left_semantics = self.get_syntactic_nullishness_semantics(binary.left);
                        // The non-null path (left is non-null): left branch taken, result has Never bit
                        let mut result = left_semantics & PredicateSemantics::NEVER;
                        // The null path (left is null/undefined): right branch taken, result inherits right's semantics
                        if left_semantics.intersects(PredicateSemantics::ALWAYS) {
                            result |= self.get_syntactic_nullishness_semantics(binary.right);
                        }
                        return result;
                    }
                    _ => {}
                }
                return PredicateSemantics::NEVER;
            }
            Kind::ConditionalExpression => {
                let conditional = a.as_conditional_expression(node);
                let when_true = self.get_syntactic_nullishness_semantics(conditional.when_true);
                let when_false = self.get_syntactic_nullishness_semantics(conditional.when_false);
                return when_true | when_false;
            }
            Kind::NullKeyword => return PredicateSemantics::ALWAYS,
            Kind::Identifier => {
                if self.get_resolved_symbol(node) == self.undefined_symbol {
                    return PredicateSemantics::ALWAYS;
                }
                return PredicateSemantics::SOMETIMES;
            }
            _ => {}
        }
        PredicateSemantics::NEVER
    }

    // This is a *shallow* check: An expression is side-effect-free if the evaluation of the expression *itself* cannot produce side effects. For example, x++ / 3 is side-effect free because the / operator does not have side effects. The intent is to "smell test" an expression for correctness in positions where its value is discarded (e.g. the left side of the comma operator).
    pub fn is_side_effect_free(&self, node: NodeId) -> bool {
        if !self.stack_check.is_safe_to_recurse() {
            return self.stack_limit();
        }
        let a = self.ast;
        let node = skip_parentheses(a, node);
        match a.kind(node) {
            Kind::Identifier
            | Kind::StringLiteral
            | Kind::RegularExpressionLiteral
            | Kind::TaggedTemplateExpression
            | Kind::TemplateExpression
            | Kind::NoSubstitutionTemplateLiteral
            | Kind::NumericLiteral
            | Kind::BigIntLiteral
            | Kind::TrueKeyword
            | Kind::FalseKeyword
            | Kind::NullKeyword
            | Kind::UndefinedKeyword
            | Kind::FunctionExpression
            | Kind::ClassExpression
            | Kind::ArrowFunction
            | Kind::ArrayLiteralExpression
            | Kind::ObjectLiteralExpression
            | Kind::TypeOfExpression
            | Kind::NonNullExpression
            | Kind::JsxSelfClosingElement
            | Kind::JsxElement => return true,
            Kind::ConditionalExpression => {
                let conditional = a.as_conditional_expression(node);
                return self.is_side_effect_free(conditional.when_true)
                    && self.is_side_effect_free(conditional.when_false);
            }
            Kind::BinaryExpression => {
                let binary = a.as_binary_expression(node);
                if is_assignment_operator(a.kind(binary.operator_token)) {
                    return false;
                }
                return self.is_side_effect_free(binary.left)
                    && self.is_side_effect_free(binary.right);
            }
            Kind::PrefixUnaryExpression => {
                // Unary operators ~, !, +, and - have no side effects. The rest do.
                if matches!(
                    a.as_prefix_unary_expression(node).operator,
                    Kind::ExclamationToken | Kind::PlusToken | Kind::MinusToken | Kind::TildeToken
                ) {
                    return true;
                }
            }
            _ => {}
        }
        false
    }

    // Return true for "indirect calls", (i.e. `(0, x.f)(...)` or `(0, eval)(...)`), which prevents passing `this`.
    pub fn is_indirect_call(&self, node: NodeId) -> bool {
        let a = self.ast;
        let left = a.as_binary_expression(node).left;
        let right = a.as_binary_expression(node).right;
        is_parenthesized_expression(a, a.parent(node))
            && is_numeric_literal(a, left)
            && a.text(left) == b"0"
            && (is_call_expression(a, a.parent(a.parent(node)))
                && a.expression(a.parent(a.parent(node))) == a.parent(node)
                || is_tagged_template_expression(a, a.parent(a.parent(node))))
            && (is_access_expression(a, right)
                || is_identifier(a, right) && a.text(right) == b"eval")
    }

    pub fn check_instance_of_expression(
        &mut self,
        left: NodeId,
        right: NodeId,
        left_type: TypeId,
        right_type: TypeId,
        check_mode: CheckMode,
    ) -> TypeId {
        let a = self.ast;
        if left_type == self.silent_never_type || right_type == self.silent_never_type {
            return self.silent_never_type;
        }
        // TypeScript 1.0 spec (April 2014): 4.15.4 The instanceof operator requires the left operand to be of type Any, an object type, or a type parameter type, and the right operand to be of type Any, a subtype of the 'Function' interface type, or have a call or construct signature. The result is always of the Boolean primitive type. NOTE: do not raise error if leftType is unknown as related error was already reported
        if !is_type_any(self, left_type)
            && self.all_types_assignable_to_kind(left_type, TypeFlags::PRIMITIVE)
        {
            self.error(
                left,
                diagnostics::THE_LEFT_HAND_SIDE_OF_AN_INSTANCEOF_EXPRESSION_MUST_BE_OF_TYPE_ANY_AN_OBJECT_TYPE_OR_A_TYPE_PARAMETER,
                &[],
            );
        }
        let signature = self.get_resolved_signature(a.parent(left), None, check_mode);
        if signature == self.resolving_signature {
            // CheckMode.SkipGenericFunctions is enabled and this is a call to a generic function that returns a function type. We defer checking and return silentNeverType.
            return self.silent_never_type;
        }
        // If rightType has a `[Symbol.hasInstance]` method that is not `(value: unknown) => boolean`, we must check the expression as if it were a call to `right[Symbol.hasInstance](left)`. The call to `getResolvedSignature`, below, will check that leftType is assignable to the type of the first parameter.
        let return_type = self.get_return_type_of_signature(signature);
        // We also verify that the return type of the `[Symbol.hasInstance]` method is assignable to `boolean`. According to the spec, the runtime will actually perform `ToBoolean` on the result, but this is more type-safe.
        self.check_type_assignable_to(
            return_type,
            self.boolean_type,
            right,
            diagnostics::AN_OBJECT_S_SYMBOL_HASINSTANCE_METHOD_MUST_RETURN_A_BOOLEAN_VALUE_FOR_IT_TO_BE_USED_ON_THE_RIGHT_HAND_SIDE_OF_AN_INSTANCEOF_EXPRESSION,
        );
        self.boolean_type
    }

    pub fn check_in_expression(
        &mut self,
        left: NodeId,
        right: NodeId,
        left_type: TypeId,
        right_type: TypeId,
    ) -> TypeId {
        let a = self.ast;
        if left_type == self.silent_never_type || right_type == self.silent_never_type {
            return self.silent_never_type;
        }
        if is_private_identifier(a, left) {
            if self.language_version
                < LANGUAGE_FEATURE_MINIMUM_TARGET.private_names_and_class_static_blocks
                || self.language_version
                    < LANGUAGE_FEATURE_MINIMUM_TARGET.class_and_class_element_decorators
                || !self.compiler_options.get_use_define_for_class_fields()
            {
                self.check_external_emit_helpers(left, ExternalEmitHelpers::CLASS_PRIVATE_FIELD_IN);
            }
            // Unlike in 'checkPrivateIdentifierExpression' we now have access to the RHS type which provides us with the opportunity to emit more detailed errors
            let links = self.symbol_node_links.get(left);
            if self.symbol_node_links[links].resolved_symbol.is_nil()
                && !get_containing_class(a, left).is_nil()
            {
                let is_unchecked_js =
                    self.is_unchecked_js_suggestion(left, self.types[right_type].symbol, true);
                self.report_nonexistent_property(left, right_type, is_unchecked_js);
            }
        } else {
            // The type of the left operand must be assignable to string, number, or symbol.
            let non_null_left_type = self.check_non_null_type(left_type, left);
            self.check_type_assignable_to(
                non_null_left_type,
                self.string_number_symbol_type,
                left,
                MessageId::NIL,
            );
        }
        // The type of the right operand must be assignable to 'object'.
        let non_null_right_type = self.check_non_null_type(right_type, right);
        if self.check_type_assignable_to(
            non_null_right_type,
            self.non_primitive_type,
            right,
            MessageId::NIL,
        ) {
            // The {} type is assignable to the object type, yet {} might represent a primitive type. Here we detect and error on {} that results from narrowing the unknown type, as well as intersections that include {} (we know that the other types in such intersections are assignable to object since we already checked for that).
            if self.has_empty_object_intersection(right_type) {
                let type_text = self.type_to_string_exported(right_type);
                self.error(
                    right,
                    diagnostics::TYPE_0_MAY_REPRESENT_A_PRIMITIVE_VALUE_WHICH_IS_NOT_PERMITTED_AS_THE_RIGHT_OPERAND_OF_THE_IN_OPERATOR,
                    &[Arg::Str(&type_text)],
                );
            }
        }
        // The result is always of the Boolean primitive type.
        self.boolean_type
    }

    pub fn has_empty_object_intersection(&mut self, t: TypeId) -> bool {
        some_type(self, t, &mut |c, t| {
            t == c.unknown_empty_object_type
                || c.types[t].flags.intersects(TypeFlags::INTERSECTION) && {
                    let base_type = c.get_base_constraint_or_type(t);
                    c.is_empty_anonymous_object_type(base_type)
                }
        })
    }

    pub fn check_reference_expression(
        &mut self,
        expr: NodeId,
        invalid_reference_message: MessageId,
        invalid_optional_chain_message: MessageId,
    ) -> bool {
        let a = self.ast;
        // References are combinations of identifiers, parentheses, and property accesses.
        let node = skip_outer_expressions(
            a,
            expr,
            OuterExpressionKinds::ASSERTIONS | OuterExpressionKinds::PARENTHESES,
        );
        if a.kind(node) != Kind::Identifier && !is_access_expression(a, node) {
            self.error(expr, invalid_reference_message, &[]);
            return false;
        }
        if a.flags(node).intersects(NodeFlags::OPTIONAL_CHAIN) {
            self.error(expr, invalid_optional_chain_message, &[]);
            return false;
        }
        true
    }
}
