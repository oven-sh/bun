use bun_lint::prelude::*;
use bun_lint::types::tsutils::{
    self, CompilerOption, intersection_constituents, is_strict_compiler_option_enabled,
    type_constituents,
};
use bun_lint::types::utils::{get_type_flags, is_nullable_type};
use bun_lint::types::{Type, TypeFlags};
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::eslint_utils::{find_variable, is_parenthesized};
use bun_lint::utils::is_sequence_root;
use bun_lint::utils::ts_utils::{
    OperatorPrecedence, get_operator_precedence_for_node, get_text_with_parentheses,
    get_wrapped_code, is_conditional_test, is_logical_or_operator, is_node_equal, is_null_literal,
    is_undefined_identifier,
};
use rustc_hash::FxHashSet;
use smallvec::{SmallVec, smallvec};
use std::borrow::Cow;

/// Enforce using the nullish coalescing operator instead of logical assignments or chaining.
pub struct PreferNullishCoalescing {
    allow_rule_to_run_without_strict_null_checks_i_know_what_i_am_doing: bool,
    ignore_boolean_coercion: bool,
    ignore_conditional_tests: bool,
    ignore_if_statements: bool,
    ignore_mixed_logical_expressions: bool,
    /// What `ignorePrimitives` says, as the flags of the types to ignore.
    ignorable_flags: TypeFlags,
    ignore_ternary_tests: bool,
}

const NO_STRICT_NULL_CHECK: Message = Message::new(
    "noStrictNullCheck",
    "This rule requires the `strictNullChecks` compiler option to be turned on to function correctly.",
);
const PREFER_NULLISH_OVER_ASSIGNMENT: Message = Message::new(
    "preferNullishOverAssignment",
    "Prefer using nullish coalescing operator (`??{{ equals }}`) instead of an assignment expression, as it is simpler to read.",
);
const PREFER_NULLISH_OVER_OR: Message = Message::new(
    "preferNullishOverOr",
    "Prefer using nullish coalescing operator (`??{{ equals }}`) instead of a logical {{ description }} (`||{{ equals }}`), as it is a safer operator.",
);
const PREFER_NULLISH_OVER_TERNARY: Message = Message::new(
    "preferNullishOverTernary",
    "Prefer using nullish coalescing operator (`??{{ equals }}`) instead of a ternary expression, as it is simpler to read.",
);
const SUGGEST_NULLISH: Message = Message::new(
    "suggestNullish",
    "Fix to nullish coalescing operator (`??{{ equals }}`).",
);

/// How a test checks for `null` and `undefined`.
#[derive(Copy, Clone, PartialEq, Eq)]
enum NullishCheckOperator {
    /// `a`
    Truthy,
    /// `!a`
    Not,
    NotEq,
    NotEqEq,
    EqEq,
    EqEqEq,
}

type Nodes<'a> = SmallVec<[Expr<'a>; 4]>;

/// A `ChainExpression`, an `Identifier` or a `MemberExpression`.
fn is_member_access_like(node: Expr) -> bool {
    node.is_chain_root()
        || matches!(
            node.kind(),
            ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. }
        )
}

fn is_null_literal_or_undefined_identifier(node: Expr) -> bool {
    is_null_literal(node) || is_undefined_identifier(node)
}

/// The operator and the operands of a `BinaryExpression`, which a `LogicalExpression` and a
/// `SequenceExpression` are not.
fn as_binary_expression(node: Expr<'_>) -> Option<(BinOp, Expr<'_>, Expr<'_>)> {
    match node.kind() {
        ExprKind::Binary {
            op: BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma,
            ..
        } => None,
        ExprKind::Binary { op, left, right } => Some((op, left, right)),
        _ => None,
    }
}

fn is_built_in_boolean_call(node: Node) -> bool {
    let Node::Expr(expression) = node else {
        return false;
    };
    let ExprKind::Call(call) = expression.kind() else {
        return false;
    };
    call.callee().is_ident("Boolean")
        && !call.args().is_empty()
        && find_variable(node.scope(), "Boolean").is_none()
}

fn is_boolean_constructor_context(mut node: Expr) -> bool {
    loop {
        let parent = node.parent();
        let Node::Expr(expression) = parent else {
            return false;
        };
        let is_passed_on = match expression.kind() {
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                ..
            } => true,
            ExprKind::Cond { yes, no, .. } => yes == node || no == node,
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => right == node && is_sequence_root(expression),
            _ => false,
        };
        if !is_passed_on {
            return is_built_in_boolean_call(parent);
        }
        node = expression;
    }
}

/// Whether [`is_conditional_test`] and [`is_boolean_constructor_context`] say of `at` what they say of `parent`.
fn is_passed_on<'a>(at: Node<'a>, parent: Node<'a>) -> bool {
    let (Node::Expr(at), Node::Expr(parent)) = (at, parent) else {
        return false;
    };
    match parent.kind() {
        ExprKind::Binary {
            op: BinOp::And | BinOp::Or | BinOp::Nullish,
            ..
        } => true,
        ExprKind::Cond { test, .. } => test != at,
        _ => false,
    }
}

/// `ask(node)`, where `ask` is one of these two. It is asked about the outermost expression that `node` is passed on to: to
/// walk up from each link of `a || a || ..` takes quadratic time.
fn ask_outermost<'a>(
    node: Expr<'a>,
    known: &mut AncestorMemo<'a, bool>,
    ask: fn(Expr<'a>) -> bool,
) -> bool {
    let decide = |at: Node<'a>, parent: Node<'a>| match at {
        _ if is_passed_on(at, parent) => None,
        Node::Expr(at) => Some(ask(at)),
        _ => Some(false),
    };
    known.find(Node::Expr(node), decide).unwrap_or(false)
}

/// [`is_mixed_logical_expression`]. It is the same for all the `||` that are operands of each other, so it is found out for the
/// outermost of them.
fn is_in_mixed_logical_expression<'a>(
    (node, left, right): (Expr<'a>, Expr<'a>, Expr<'a>),
    known: &mut AncestorMemo<'a, bool>,
) -> bool {
    if !is_logical_or_operator(node) {
        return is_mixed_logical_expression(node, left, right);
    }
    let decide = |at: Node<'a>, parent: Node<'a>| match (at, parent) {
        (_, Node::Expr(parent)) if is_logical_or_operator(parent) => None,
        (Node::Expr(at), _) => match at.kind() {
            ExprKind::Binary { left, right, .. } => {
                Some(is_mixed_logical_expression(at, left, right))
            }
            _ => Some(false),
        },
        _ => Some(false),
    };
    known.find(Node::Expr(node), decide).unwrap_or(false)
}

/// What is known from the walks up from other nodes.
#[derive(Default)]
pub struct Walks<'a> {
    /// [`is_conditional_test`]
    conditional_tests: AncestorMemo<'a, bool>,
    /// [`is_boolean_constructor_context`]
    boolean_contexts: AncestorMemo<'a, bool>,
    /// [`is_in_mixed_logical_expression`]
    mixed: AncestorMemo<'a, bool>,
}

/// `left`, `right`: the operands of `node`, which is an `a || b` or an `a ||= b`.
fn is_mixed_logical_expression<'a>(node: Expr<'a>, left: Expr<'a>, right: Expr<'a>) -> bool {
    let mut seen = FxHashSet::default();
    let mut queue: Vec<Expr<'a>> = Vec::new();
    queue.extend(node.parent().as_expr());
    queue.extend([left, right]);
    let mut next = 0;
    while let Some(&current) = queue.get(next) {
        next += 1;
        if !seen.insert(current) {
            continue;
        }
        match current.kind() {
            ExprKind::Binary { op: BinOp::And, .. } => return true,
            // The pieces of the node, to catch `a || b || c && d`.
            ExprKind::Binary {
                op: BinOp::Or,
                left,
                right,
            } => {
                queue.extend(current.parent().as_expr());
                queue.extend([left, right]);
            }
            _ => {}
        }
    }
    false
}

/// Whether two nodes access the same members in the same order, whatever is optional: `a.b.c`,
/// `a?.b.c`, `a.b?.c`, `(a?.b).c` and `(a.b)?.c` are similar.
fn are_nodes_similar_member_access<'a>(mut a: Expr<'a>, mut b: Expr<'a>) -> bool {
    let is_private = |name: Ident<'a>| name.bytes().starts_with(b"#");
    loop {
        (a, b) = match (a.kind(), b.kind()) {
            (
                ExprKind::Dot { obj: a, name, .. },
                ExprKind::Dot {
                    obj: b,
                    name: other,
                    ..
                },
            ) => {
                if is_private(name) || is_private(other) || name.name() != other.name() {
                    return false;
                }
                (a, b)
            }
            (
                ExprKind::Index { obj: a, index, .. },
                ExprKind::Index {
                    obj: b,
                    index: other,
                    ..
                },
            ) => {
                if !is_node_equal(index, other) {
                    return false;
                }
                (a, b)
            }
            (ExprKind::Dot { obj: a, name, .. }, ExprKind::Index { obj: b, index, .. })
            | (ExprKind::Index { obj: a, index, .. }, ExprKind::Dot { obj: b, name, .. }) => {
                if is_private(name) || index.as_string() != Some(name.name()) {
                    return false;
                }
                (a, b)
            }
            _ => return is_node_equal(a, b),
        };
    }
}

/// `test`: of a conditional expression or an `if` statement.
fn get_operator_and_nodes_inside_test_expression(
    test: Expr<'_>,
) -> (Nodes<'_>, Option<NullishCheckOperator>) {
    use NullishCheckOperator as Operator;
    if is_member_access_like(test) {
        return (Nodes::new(), Some(Operator::Truthy));
    }
    match test.kind() {
        ExprKind::Unary {
            op: UnOp::Not,
            operand,
        } if is_member_access_like(operand) => (Nodes::new(), Some(Operator::Not)),
        ExprKind::Binary {
            op: logical @ (BinOp::And | BinOp::Or),
            left,
            right,
        } => {
            let (Some(left), Some(right)) =
                (as_binary_expression(left), as_binary_expression(right))
            else {
                return (Nodes::new(), None);
            };
            let is_nullish_comparison = |(_, left, right): (BinOp, Expr, Expr)| {
                is_null_literal_or_undefined_identifier(left)
                    && is_null_literal_or_undefined_identifier(right)
            };
            if is_nullish_comparison(left) || is_nullish_comparison(right) {
                return (Nodes::new(), None);
            }
            let (strict, loose, strict_operator, loose_operator) = match logical {
                BinOp::Or => (BinOp::EqEqEq, BinOp::EqEq, Operator::EqEqEq, Operator::EqEq),
                _ => (
                    BinOp::NotEqEq,
                    BinOp::NotEq,
                    Operator::NotEqEq,
                    Operator::NotEq,
                ),
            };
            let is_either = |op: BinOp| left.0 == op || right.0 == op;
            let operator = if left.0 == strict && right.0 == strict {
                Some(strict_operator)
            } else if (is_either(strict) && is_either(loose))
                || (left.0 == loose && right.0 == loose)
            {
                Some(loose_operator)
            } else {
                None
            };
            (smallvec![left.1, left.2, right.1, right.2], operator)
        }
        _ => match as_binary_expression(test) {
            Some((op, left, right)) => {
                let operator = match op {
                    BinOp::EqEq => Some(Operator::EqEq),
                    BinOp::NotEq => Some(Operator::NotEq),
                    BinOp::EqEqEq => Some(Operator::EqEqEq),
                    BinOp::NotEqEq => Some(Operator::NotEqEq),
                    _ => None,
                };
                (smallvec![left, right], operator)
            }
            None => (Nodes::new(), None),
        },
    }
}

/// Each comment as it is written, followed by `separator`.
fn format_comments(comments: Tokens, separator: u8) -> Vec<u8> {
    let mut out = Vec::new();
    for comment in comments {
        out.extend_from_slice(comment.text());
        out.push(separator);
    }
    out
}

impl PreferNullishCoalescing {
    /// Whether a type that is tested for truthiness is eligible for conversion to a check for
    /// nullishness.
    fn is_type_eligible_for_prefer_nullish(&self, ty: Type) -> bool {
        if !is_nullable_type(ty) || ty.is_unresolved() {
            return false;
        }
        if self.ignorable_flags.is_empty() {
            return true;
        }
        // A value of type `any` or `unknown` could be any primitive.
        if tsutils::is_type_flag_set(ty, TypeFlags::ANY | TypeFlags::UNKNOWN) {
            return false;
        }
        !type_constituents(ty).iter().any(|t| {
            intersection_constituents(t)
                .iter()
                .any(|t| tsutils::is_type_flag_set(t, self.ignorable_flags))
        })
    }

    /// Whether a construct that uses the truthiness of `test_node` is eligible for conversion:
    /// whether it is in a permitted place, and whether the type of what is tested is eligible.
    ///
    /// `node`: the `a || b`, `a ||= b` or `a ? a : b` to be converted. `None` for an `if` statement,
    /// which is in no place that matters.
    fn is_truthiness_check_eligible_for_prefer_nullish<'a>(
        &self,
        node: Option<Expr<'a>>,
        test_node: Expr<'a>,
        walks: &mut Walks<'a>,
    ) -> bool {
        if let Some(node) = node {
            if self.ignore_conditional_tests
                && ask_outermost(node, &mut walks.conditional_tests, is_conditional_test)
            {
                return false;
            }
            let is_argument = || {
                matches!(node.kind(), ExprKind::Cond { .. })
                    && matches!(node.parent(), Node::Expr(parent) if matches!(parent.kind(), ExprKind::Call(_)))
            };
            if self.ignore_boolean_coercion
                && ask_outermost(
                    node,
                    &mut walks.boolean_contexts,
                    is_boolean_constructor_context,
                )
                && !is_argument()
            {
                return false;
            }
        }
        self.is_type_eligible_for_prefer_nullish(test_node.ty())
    }

    /// `left`, `right`: the operands of `node`.
    fn check_and_fix_with_prefer_nullish_over_or<'a>(
        &self,
        cx: &mut Cx<'a, Self>,
        (node, left, right): (Expr<'a>, Expr<'a>, Expr<'a>),
        description: &'static str,
        equals: &'static str,
    ) {
        if self.ignore_mixed_logical_expressions
            && is_in_mixed_logical_expression((node, left, right), &mut cx.state.mixed)
        {
            return;
        }
        if !self.is_truthiness_check_eligible_for_prefer_nullish(Some(node), left, &mut cx.state) {
            return;
        }
        let Some(bar_bar_operator) = node.operator_span() else {
            return;
        };
        cx.report(bar_bar_operator, PREFER_NULLISH_OVER_OR)
            .data("description", description)
            .data("equals", equals)
            .suggest_with(SUGGEST_NULLISH, &[("equals", equals.as_bytes())], |fixer| {
                let mut fixes = Vec::new();
                if node.parent().as_expr().is_some_and(is_logical_or_operator) {
                    // `&&` and `??` cannot be mixed without parentheses.
                    fixes.push(match left.kind() {
                        ExprKind::Binary {
                            op: BinOp::And | BinOp::Or | BinOp::Nullish,
                            left: left_of_left,
                            right: right_of_left,
                        } if !is_logical_or_operator(left_of_left) => {
                            fixer.insert_before(right_of_left, "(")
                        }
                        _ => fixer.insert_before(left, "("),
                    });
                    fixes.push(fixer.insert_after(right, ")"));
                }
                fixes.push(fixer.replace(bar_bar_operator, ["??", equals].concat()));
                fixes
            });
    }

    /// The left operand of the `??` that can replace a conditional expression or an `if` statement.
    /// `None` if none can.
    ///
    /// `node`: as for `is_truthiness_check_eligible_for_prefer_nullish`. `test`: its test.
    fn get_nullish_coalescing_left_node<'a>(
        &self,
        node: Option<Expr<'a>>,
        test: Expr<'a>,
        non_nullish_node: Expr<'a>,
        nodes_inside_test_expression: &Nodes<'a>,
        operator: NullishCheckOperator,
        walks: &mut Walks<'a>,
    ) -> Option<Expr<'a>> {
        if nodes_inside_test_expression.is_empty() {
            let nullish_coalescing_left_node = match (operator, test.kind()) {
                (NullishCheckOperator::Not, ExprKind::Unary { operand, .. }) => operand,
                _ => test,
            };
            let is_fixable =
                are_nodes_similar_member_access(nullish_coalescing_left_node, non_nullish_node)
                    && self.is_truthiness_check_eligible_for_prefer_nullish(
                        node,
                        nullish_coalescing_left_node,
                        walks,
                    );
            return is_fixable.then_some(nullish_coalescing_left_node);
        }

        let mut nullish_coalescing_left_node = None;
        let (mut has_null_check, mut has_undefined_check) = (false, false);
        // The test may only contain `null`, `undefined` and the identifier.
        for &test_node in nodes_inside_test_expression {
            if is_null_literal(test_node) {
                has_null_check = true;
            } else if is_undefined_identifier(test_node) {
                has_undefined_check = true;
            } else if are_nodes_similar_member_access(test_node, non_nullish_node) {
                // The first has at least the optional chaining operators that the others need:
                // `a?.b?.c !== undefined && a.b.c !== null ? a.b.c : 'foo'`.
                nullish_coalescing_left_node.get_or_insert(test_node);
            } else {
                return None;
            }
        }
        let nullish_coalescing_left_node = nullish_coalescing_left_node?;

        let is_fixable = if has_undefined_check == has_null_check {
            // Both are checked for, or neither.
            has_undefined_check
        } else if matches!(
            operator,
            NullishCheckOperator::EqEq | NullishCheckOperator::NotEq
        ) {
            true
        } else {
            let flags = get_type_flags(nullish_coalescing_left_node.ty());
            if flags.intersects(TypeFlags::ANY | TypeFlags::UNKNOWN) {
                false
            } else if has_undefined_check && !flags.intersects(TypeFlags::NULL) {
                true
            } else {
                has_null_check && !flags.intersects(TypeFlags::UNDEFINED)
            }
        };
        is_fixable.then_some(nullish_coalescing_left_node)
    }

    fn check_conditional_expression<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Cond { test, yes, no } = node.kind() else {
            return;
        };
        let (nodes_inside_test_expression, Some(operator)) =
            get_operator_and_nodes_inside_test_expression(test)
        else {
            return;
        };
        let (non_nullish_branch, nullish_branch) = match operator {
            NullishCheckOperator::Truthy
            | NullishCheckOperator::NotEq
            | NullishCheckOperator::NotEqEq => (yes, no),
            _ => (no, yes),
        };
        let Some(nullish_coalescing_left_node) = self.get_nullish_coalescing_left_node(
            Some(node),
            test,
            non_nullish_branch,
            &nodes_inside_test_expression,
            operator,
            &mut cx.state,
        ) else {
            return;
        };
        cx.report(node, PREFER_NULLISH_OVER_TERNARY)
            .data("equals", "")
            .suggest_with(SUGGEST_NULLISH, &[("equals", "".as_bytes())], |fixer| {
                let nullish_branch_text = get_text_with_parentheses(nullish_branch);
                let right_operand_replacement = match is_parenthesized(nullish_branch) {
                    true => Cow::Borrowed(nullish_branch_text),
                    false => get_wrapped_code(
                        nullish_branch_text,
                        get_operator_precedence_for_node(nullish_branch),
                        OperatorPrecedence::COALESCE,
                    ),
                };
                let left_operand = get_text_with_parentheses(nullish_coalescing_left_node);
                fixer.replace(
                    node,
                    [left_operand, b" ?? ", &*right_operand_replacement].concat(),
                )
            });
    }

    fn check_if_statement<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::If {
            test,
            yes: consequent,
            no: None,
        } = node.kind()
        else {
            return;
        };
        let (statement, is_consequent_node_block_statement) = match consequent.kind() {
            StmtKind::Block(body) => match (body.first(), body.len()) {
                (Some(only), 1) => (only, true),
                _ => return,
            },
            _ => (consequent, false),
        };
        let StmtKind::Expr(assignment_expression) = statement.kind() else {
            return;
        };
        let ExprKind::Assign {
            target: nullish_coalescing_left_node,
            value: nullish_coalescing_right_node,
            ..
        } = assignment_expression.kind()
        else {
            return;
        };
        if !is_member_access_like(nullish_coalescing_left_node) {
            return;
        }
        let (
            nodes_inside_test_expression,
            Some(
                operator @ (NullishCheckOperator::Not
                | NullishCheckOperator::EqEq
                | NullishCheckOperator::EqEqEq),
            ),
        ) = get_operator_and_nodes_inside_test_expression(test)
        else {
            return;
        };
        let is_fixable = self
            .get_nullish_coalescing_left_node(
                None,
                test,
                nullish_coalescing_left_node,
                &nodes_inside_test_expression,
                operator,
                &mut cx.state,
            )
            .is_some();
        if !is_fixable {
            return;
        }
        cx.report(node, PREFER_NULLISH_OVER_ASSIGNMENT)
            .data("equals", "=")
            .suggest_with(SUGGEST_NULLISH, &[("equals", "=".as_bytes())], |fixer| {
                let file = fixer.file();
                let separator = if is_consequent_node_block_statement {
                    b'\n'
                } else {
                    b' '
                };
                let mut text =
                    format_comments(file.comments_before(assignment_expression), separator);
                text.extend_from_slice(get_text_with_parentheses(nullish_coalescing_left_node));
                text.extend_from_slice(b" ??= ");
                text.extend_from_slice(get_text_with_parentheses(nullish_coalescing_right_node));
                text.push(b';');
                if is_consequent_node_block_statement {
                    let mut comments_after = format_comments(file.comments_after(statement), b'\n');
                    if comments_after.pop().is_some() {
                        text.push(b' ');
                        text.extend_from_slice(&comments_after);
                    }
                }
                fixer.replace(node, text)
            });
    }
}

impl Rule for PreferNullishCoalescing {
    const META: Meta = Meta::typescript("prefer-nullish-coalescing", Kind::Suggestion)
        .has_suggestions()
        .presets(Presets::STYLISTIC_TYPE_CHECKED)
        .requires_types();
    type State<'a> = Walks<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let ignores_all_primitives = options.bool("ignorePrimitives") == Some(true);
        let ignore_primitives = options.object("ignorePrimitives");
        let mut ignorable_flags = TypeFlags::empty();
        for (primitive, flags) in [
            ("bigint", TypeFlags::BIG_INT_LIKE),
            ("boolean", TypeFlags::BOOLEAN_LIKE),
            ("number", TypeFlags::NUMBER_LIKE),
            ("string", TypeFlags::STRING_LIKE),
        ] {
            if ignores_all_primitives || ignore_primitives.bool_or(primitive, false) {
                ignorable_flags |= flags;
            }
        }
        PreferNullishCoalescing {
            allow_rule_to_run_without_strict_null_checks_i_know_what_i_am_doing: options.bool_or(
                "allowRuleToRunWithoutStrictNullChecksIKnowWhatIAmDoing",
                false,
            ),
            ignore_boolean_coercion: options.bool_or("ignoreBooleanCoercion", false),
            ignore_conditional_tests: options.bool_or("ignoreConditionalTests", true),
            ignore_if_statements: options.bool_or("ignoreIfStatements", false),
            ignore_mixed_logical_expressions: options
                .bool_or("ignoreMixedLogicalExpressions", false),
            ignorable_flags,
            ignore_ternary_tests: options.bool_or("ignoreTernaryTests", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Walks<'a> {
        let compiler_options = file.type_checker().compiler_options();
        if !is_strict_compiler_option_enabled(compiler_options, CompilerOption::StrictNullChecks)
            && !self.allow_rule_to_run_without_strict_null_checks_i_know_what_i_am_doing
        {
            on.finish(|_, cx| {
                // tsgolint points at the start of the file.
                if cx.language().is_oxlint {
                    cx.report(Span::empty(0), NO_STRICT_NULL_CHECK);
                    return;
                }
                let line_zero = Position { line: 0, column: 0 };
                cx.report(Span::empty(0), NO_STRICT_NULL_CHECK)
                    .start_at(line_zero)
                    .end_at(line_zero);
            });
        }
        on.exprs([ExprTag::Assign], |rule, node, cx| {
            if let ExprKind::Assign {
                op: Some(BinOp::Or),
                target,
                value,
            } = node.kind()
            {
                rule.check_and_fix_with_prefer_nullish_over_or(
                    cx,
                    (node, target, value),
                    "assignment",
                    "=",
                );
            }
        });
        on.exprs([ExprTag::Binary], |rule, node, cx| {
            if let ExprKind::Binary {
                op: BinOp::Or,
                left,
                right,
            } = node.kind()
            {
                rule.check_and_fix_with_prefer_nullish_over_or(cx, (node, left, right), "or", "");
            }
        });
        if !self.ignore_ternary_tests {
            on.exprs([ExprTag::Cond], Self::check_conditional_expression);
        }
        if !self.ignore_if_statements {
            on.stmts([StmtTag::If], Self::check_if_statement);
        }
        Walks::default()
    }
}
