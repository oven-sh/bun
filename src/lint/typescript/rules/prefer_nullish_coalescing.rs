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
    /// `ignorePrimitives`, as the flags of the types to ignore.
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

/// The operator and operands of a `BinaryExpression`. A `LogicalExpression` or a `SequenceExpression` isn't one.
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
    // tsgolint doesn't treat a parenthesized callee as an identifier.
    call.callee().is_ident("Boolean")
        && !(call.callee().is_parenthesized() && expression.file().language().is_oxlint)
        && !call.args().is_empty()
        // tsgolint requires every declaration of the callee's symbol to be in a declaration file.
        && match expression.file().language().is_oxlint {
            true => call.callee().ts_symbol().is_none_or(|symbol| {
                symbol.declarations().all(|it| it.get_source_file().is_declaration_file())
            }),
            false => find_variable(node.scope(), "Boolean").is_none(),
        }
}

/// typescript-go's `IsLogicalExpression`: a `&&`, `||` or `??` behind any number of `!`.
fn is_logical_expression(mut node: Expr) -> bool {
    while let ExprKind::Unary {
        op: UnOp::Not,
        operand,
    } = node.kind()
    {
        node = operand;
    }
    matches!(
        node.binary_op(),
        Some(BinOp::And | BinOp::Or | BinOp::Nullish)
    )
}

fn is_boolean_constructor_context(mut node: Expr) -> bool {
    let is_oxlint = node.file().language().is_oxlint;
    loop {
        let parent = node.parent();
        let Node::Expr(expression) = parent else {
            return false;
        };
        let defers_to_parent = match expression.kind() {
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                ..
            } => true,
            ExprKind::Cond { yes, no, .. } => yes == node || no == node,
            // tsgolint calls `ast.IsLogicalExpression` on the parent, which looks through `!`.
            ExprKind::Unary { op: UnOp::Not, .. } => is_oxlint && is_logical_expression(expression),
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => right == node && is_sequence_root(expression),
            _ => false,
        };
        if !defers_to_parent {
            return is_built_in_boolean_call(parent);
        }
        node = expression;
    }
}

/// True if [`is_conditional_test`] and [`is_boolean_constructor_context`] return the same for `at` as for `parent`.
fn defers_to_parent<'a>(at: Node<'a>, parent: Node<'a>) -> bool {
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

/// Returns `ask(node)`, where `ask` is one of those two functions. It calls `ask` on the outermost expression that has
/// the same answer and caches the result, because walking up from each link of `a || a || ..` takes quadratic time.
fn ask_outermost<'a>(
    node: Expr<'a>,
    known: &mut AncestorMemo<'a, bool>,
    ask: fn(Expr<'a>) -> bool,
) -> bool {
    let decide = |at: Node<'a>, parent: Node<'a>| match at {
        Node::Expr(at) if at.with_jsdoc_cast() != at => Some(false),
        _ if defers_to_parent(at, parent) => None,
        Node::Expr(at) => Some(ask(at)),
        _ => Some(false),
    };
    known.find(Node::Expr(node), decide).unwrap_or(false)
}

/// Cached [`is_mixed_logical_expression`]. The answer is the same for every `||` in a chain of nested `||` operands, so
/// it's computed once, for the outermost one.
fn is_in_mixed_logical_expression<'a>(
    (node, left, right): (Expr<'a>, Expr<'a>, Expr<'a>),
    known: &mut AncestorMemo<'a, bool>,
) -> bool {
    if !is_logical_or_operator(node) {
        return is_mixed_logical_expression(node, left, right);
    }
    let decide = |at: Node<'a>, parent: Node<'a>| match (at, parent) {
        (Node::Expr(at), Node::Expr(parent)) if at.with_jsdoc_cast() == at && is_logical_or_operator(parent) => None,
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

/// Cached results of walking up from earlier nodes.
#[derive(Default)]
pub struct Walks<'a> {
    /// [`is_conditional_test`]
    conditional_tests: AncestorMemo<'a, bool>,
    /// [`is_boolean_constructor_context`]
    boolean_contexts: AncestorMemo<'a, bool>,
    /// [`is_in_mixed_logical_expression`]
    mixed: AncestorMemo<'a, bool>,
}

/// `left` and `right` are the operands of `node`, which is an `a || b` or an `a ||= b`.
fn is_mixed_logical_expression<'a>(node: Expr<'a>, left: Expr<'a>, right: Expr<'a>) -> bool {
    let mut seen = FxHashSet::default();
    let mut queue: Vec<Expr<'a>> = Vec::new();
    let parent_of = |it: Expr<'a>| it.parent().as_expr().filter(|_| it.with_jsdoc_cast() == it);
    // In tsgolint the parent of an `a ||= b` operand is a `ParenthesizedExpression`, which isn't a logical expression,
    // so tsgolint only searches below the `||=`.
    if is_logical_or_operator(node) || !node.file().language().is_oxlint {
        queue.extend(parent_of(node));
    }
    queue.extend([left.with_jsdoc_cast(), right.with_jsdoc_cast()]);
    let mut next = 0;
    while let Some(&current) = queue.get(next) {
        next += 1;
        if !seen.insert(current) {
            continue;
        }
        match current.kind() {
            ExprKind::Binary { op: BinOp::And, .. } => return true,
            // Also search the operands, to catch `a || b || c && d`.
            ExprKind::Binary {
                op: BinOp::Or,
                left,
                right,
            } => {
                queue.extend(parent_of(current));
                queue.extend([left.with_jsdoc_cast(), right.with_jsdoc_cast()]);
            }
            _ => {}
        }
    }
    false
}

/// True if two nodes access the same members in the same order, ignoring optional chaining: `a.b.c`, `a?.b.c`,
/// `a.b?.c`, `(a?.b).c` and `(a.b)?.c` are similar.
fn are_nodes_similar_member_access<'a>(mut a: Expr<'a>, mut b: Expr<'a>) -> bool {
    if a.file().language().is_oxlint {
        return tsgolint_are_nodes_similar_member_access(a, b);
    }
    let is_private = |name: Ident<'a>| name.bytes().starts_with(b"#");
    loop {
        (a, b) = (a.with_jsdoc_cast(), b.with_jsdoc_cast());
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

/// tsgolint's `getPropertyNameFromAccess`: the name of `a.b`, `a.#b`, `a['b']` and ``a[`b`]``. Empty for anything else.
fn tsgolint_get_property_name_from_access(node: Expr<'_>) -> &[u8] {
    match node.kind() {
        ExprKind::Dot { name, .. } => name.bytes(),
        ExprKind::Index { index, .. } if !index.is_parenthesized() => match index.kind() {
            ExprKind::String(value) => value.bytes(),
            ExprKind::Template(template) => match template.as_static() {
                Some(value) => value.bytes(),
                None => b"",
            },
            _ => b"",
        },
        _ => b"",
    }
}

/// tsgolint's `isNodeEqual` for two nodes, not counting the parentheses around them. Inside them, a parenthesized node
/// never equals anything, and neither do two `a.#b`, two `true` or two `a!`. `a?.b` equals `a.b`, and `a.b` doesn't
/// equal `a[b]`.
fn tsgolint_is_node_equal<'a>(mut a: Expr<'a>, mut b: Expr<'a>) -> bool {
    loop {
        (a, b) = match (a.kind(), b.kind()) {
            (ExprKind::This, ExprKind::This) | (ExprKind::Null, ExprKind::Null) => return true,
            (ExprKind::Ident(a), ExprKind::Ident(b))
            | (ExprKind::String(a), ExprKind::String(b))
            | (ExprKind::BigInt(a), ExprKind::BigInt(b)) => return a == b,
            (ExprKind::Number(a), ExprKind::Number(b)) => return a == b,
            (ExprKind::Template(a), ExprKind::Template(b)) => {
                return matches!((a.as_static(), b.as_static()), (Some(a), Some(b)) if a == b);
            }
            (
                ExprKind::Dot { obj: a, name, .. },
                ExprKind::Dot {
                    obj: b,
                    name: other,
                    ..
                },
            ) => {
                if name.bytes().starts_with(b"#") || name.name() != other.name() {
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
                if index.is_parenthesized()
                    || other.is_parenthesized()
                    || !tsgolint_is_node_equal(index, other)
                {
                    return false;
                }
                (a, b)
            }
            _ => return false,
        };
        if a.is_parenthesized() || b.is_parenthesized() {
            return false;
        }
    }
}

/// tsgolint's `areNodesSimilarMemberAccess`. It strips one `!` from each node, compares accesses by name, and compares
/// those without a name with [`tsgolint_is_node_equal`].
fn tsgolint_are_nodes_similar_member_access<'a>(mut a: Expr<'a>, mut b: Expr<'a>) -> bool {
    loop {
        (a, b) = (a.with_jsdoc_cast(), b.with_jsdoc_cast());
        for node in [&mut a, &mut b] {
            if let ExprKind::NonNull(operand) = node.kind() {
                // Stripping one `!` from `a!!` or `(a)!` leaves a node that never equals anything.
                if node.non_null_count() > 1 || operand.is_parenthesized() {
                    return false;
                }
                *node = operand;
            }
        }
        let (
            ExprKind::Dot { obj: a_object, .. } | ExprKind::Index { obj: a_object, .. },
            ExprKind::Dot { obj: b_object, .. } | ExprKind::Index { obj: b_object, .. },
        ) = (a.kind(), b.kind())
        else {
            return tsgolint_is_node_equal(a, b);
        };
        let (a_name, b_name) = (
            tsgolint_get_property_name_from_access(a),
            tsgolint_get_property_name_from_access(b),
        );
        let is_same_property = match (a.kind(), b.kind()) {
            _ if !a_name.is_empty() && !b_name.is_empty() => a_name == b_name,
            (ExprKind::Index { index: a_index, .. }, ExprKind::Index { index: b_index, .. }) => {
                !a_index.is_parenthesized()
                    && !b_index.is_parenthesized()
                    && tsgolint_is_node_equal(a_index, b_index)
            }
            (ExprKind::Dot { .. }, ExprKind::Dot { .. }) => a_name == b_name,
            _ => false,
        };
        if !is_same_property {
            return false;
        }
        (a, b) = (a_object, b_object);
    }
}

/// `test` is the test of a conditional expression or an `if` statement.
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
            // tsgolint doesn't treat a parenthesized operand as a comparison.
            if (left.is_parenthesized() || right.is_parenthesized())
                && test.file().language().is_oxlint
            {
                return (Nodes::new(), None);
            }
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

/// Each comment's source text, followed by `separator`.
fn format_comments(comments: Tokens, separator: u8) -> Vec<u8> {
    let mut out = Vec::new();
    for comment in comments {
        out.extend_from_slice(comment.text());
        out.push(separator);
    }
    out
}

impl PreferNullishCoalescing {
    /// True if a type that's tested for truthiness can be converted to a nullishness check.
    fn is_type_eligible_for_prefer_nullish(&self, ty: Type) -> bool {
        // tsgolint doesn't treat `void` as nullable.
        let is_nullable = match ty.file().language().is_oxlint {
            true => get_type_flags(ty).intersects(
                TypeFlags::ANY | TypeFlags::UNKNOWN | TypeFlags::NULL | TypeFlags::UNDEFINED,
            ),
            false => is_nullable_type(ty),
        };
        if !is_nullable || ty.is_unresolved() {
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

    /// True if a construct that uses the truthiness of `test_node` can be converted: it's in a permitted position and
    /// the tested type is eligible.
    ///
    /// `node` is the `a || b`, `a ||= b` or `a ? a : b` to convert, or `None` for an `if` statement, whose position
    /// never matters.
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
                    // In tsgolint the parent of a parenthesized node isn't the call.
                    && !(node.is_parenthesized() && node.file().language().is_oxlint)
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

    /// `left` and `right` are `node`'s operands.
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
                // Parentheses are nodes in tsgolint.
                let is_oxlint = fixer.file().language().is_oxlint;
                let is_in_logical_or = node.parent().as_expr().is_some_and(is_logical_or_operator)
                    && !(is_oxlint && node.is_parenthesized());
                if is_in_logical_or {
                    // `&&` and `??` can't be mixed without parentheses.
                    fixes.push(match left.kind() {
                        ExprKind::Binary {
                            op: BinOp::And | BinOp::Or | BinOp::Nullish,
                            left: left_of_left,
                            right: right_of_left,
                        } if !is_logical_or_operator(left_of_left) && !(is_oxlint && left.is_parenthesized()) => {
                            fixer.insert_before(right_of_left, "(")
                        }
                        _ if is_oxlint => fixer.insert_before(left.outer_span(), "("),
                        _ => fixer.insert_before(left, "("),
                    });
                    fixes.push(fixer.insert_after(right, ")"));
                }
                // tsgolint also parenthesizes an operand that's a logical expression.
                for (it, is_checked) in [(left, !is_in_logical_or), (right, true)] {
                    if is_oxlint
                        && is_checked
                        && equals.is_empty()
                        && !it.is_parenthesized()
                        && matches!(it.binary_op(), Some(BinOp::And | BinOp::Or | BinOp::Nullish))
                    {
                        fixes.extend([fixer.insert_before(it, "("), fixer.insert_after(it, ")")]);
                    }
                }
                fixes.push(fixer.replace(bar_bar_operator, ["??", equals].concat()));
                fixes
            });
    }

    /// Returns the left operand of the `??` that can replace a conditional expression or an `if` statement, or `None`
    /// if there's no such replacement.
    ///
    /// `node` is as in `is_truthiness_check_eligible_for_prefer_nullish`, and `test` is its test.
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
                // The first one has at least the optional chaining operators the others need:
                // `a?.b?.c !== undefined && a.b.c !== null ? a.b.c : 'foo'`.
                nullish_coalescing_left_node.get_or_insert(test_node);
            } else {
                return None;
            }
        }
        let nullish_coalescing_left_node = nullish_coalescing_left_node?;

        let is_fixable = if has_undefined_check == has_null_check {
            // Both are checked, or neither.
            has_undefined_check
        } else if matches!(
            operator,
            NullishCheckOperator::EqEq | NullishCheckOperator::NotEq
        ) {
            true
        } else {
            // For an `if`, tsgolint uses the type of the assignment target at the assignment.
            let is_assigned_to = node.is_none() && test.file().language().is_oxlint;
            let checked_node = if is_assigned_to { non_nullish_node } else { nullish_coalescing_left_node };
            let flags = get_type_flags(checked_node.ty());
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
                // tsgolint keeps the source text from the first comment before the assignment on, and drops everything
                // after it.
                let is_oxlint = file.language().is_oxlint;
                let mut text = match file.comments_before(assignment_expression).next().filter(|_| is_oxlint) {
                    Some(first) => file.slice(Span::before(first.start(), assignment_expression.span())).to_vec(),
                    None => format_comments(file.comments_before(assignment_expression), separator),
                };
                text.extend_from_slice(get_text_with_parentheses(nullish_coalescing_left_node));
                text.extend_from_slice(b" ??= ");
                text.extend_from_slice(get_text_with_parentheses(nullish_coalescing_right_node));
                text.push(b';');
                if is_consequent_node_block_statement && !is_oxlint {
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
    const ON: On = On::new()
        .exprs(&[ExprTag::Assign, ExprTag::Binary, ExprTag::Cond])
        .stmts(&[StmtTag::If])
        .finish();
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

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new().exprs(&[ExprTag::Assign, ExprTag::Binary]);
        let compiler_options = file.type_checker().compiler_options();
        if !is_strict_compiler_option_enabled(compiler_options, CompilerOption::StrictNullChecks)
            && !self.allow_rule_to_run_without_strict_null_checks_i_know_what_i_am_doing
        {
            on = on.finish();
        }
        if !self.ignore_ternary_tests {
            on = on.exprs(&[ExprTag::Cond]);
        }
        if !self.ignore_if_statements {
            on = on.stmts(&[StmtTag::If]);
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Walks<'a>> {
        Some(Walks::default())
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match node.tag() {
            ExprTag::Assign => {
                if let ExprKind::Assign {
                    op: Some(BinOp::Or),
                    target,
                    value,
                } = node.kind()
                {
                    self.check_and_fix_with_prefer_nullish_over_or(
                        cx,
                        (node, target, value),
                        "assignment",
                        "=",
                    );
                }
            }
            ExprTag::Binary => {
                if let ExprKind::Binary {
                    op: BinOp::Or,
                    left,
                    right,
                } = node.kind()
                {
                    self.check_and_fix_with_prefer_nullish_over_or(
                        cx,
                        (node, left, right),
                        "or",
                        "",
                    );
                }
            }
            ExprTag::Cond => self.check_conditional_expression(node, cx),
            _ => {}
        }
    }

    fn stmt<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        self.check_if_statement(node, cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        ts_utils::report_at_line_zero(cx, NO_STRICT_NULL_CHECK);
    }
}
