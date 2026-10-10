use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint_oxlint::same_expression::{is_same_expression, is_same_inner_expression};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;

/// This rule finds ternary expressions that can be simplified to a logical operator.
pub struct PreferLogicalOperatorOverTernary;

const PREFER_LOGICAL_OPERATOR_OVER_TERNARY: Message =
    Message::new("", "Prefer using a logical operator over a ternary.");
const SUGGESTION: Message = Message::new("", "Switch to \"||\" or \"??\" operator");

impl Rule for PreferLogicalOperatorOverTernary {
    const META: Meta =
        Meta::oxlint(Plugin::Unicorn, "prefer-logical-operator-over-ternary", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Cond]);
    no_state!();

    fn new(_: &Options) -> Self {
        PreferLogicalOperatorOverTernary
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Cond { test, yes: consequent, no: alternate } = e.kind() else {
            return;
        };
        // What is on the left of the `||` and what is on the right, each with whether its parentheses stay.
        let (left, right) = if is_same_node(test, consequent, 0) {
            // `foo ? foo : bar`
            let preferred = if test.is_parenthesized() { consequent } else { test };
            ((get_inner_expression(preferred), false), (alternate, true))
        } else if let ExprKind::Unary { op: UnOp::Not, operand: argument } = test.kind()
            && !test.is_parenthesized()
            && is_same_node(argument, alternate, 0)
        {
            // `!bar ? foo : bar`. Of `!!bar ? foo : !bar` it is `bar`.
            let preferred = match argument.kind() {
                ExprKind::Unary { op: UnOp::Not, operand } if !argument.is_parenthesized() => operand,
                _ => alternate,
            };
            ((preferred, true), (consequent, true))
        } else {
            return;
        };
        cx.report(e, PREFER_LOGICAL_OPERATOR_OVER_TERNARY).suggest(SUGGESTION, |fixer| {
            let mut replacement = Vec::new();
            for (i, (expr, keeps_parentheses)) in [left, right].into_iter().enumerate() {
                replacement.extend_from_slice(if i == 0 { b"" } else { b" || " });
                let is_in_parentheses = keeps_parentheses && expr.is_parenthesized();
                // `a ?? b || c` is an error.
                let wraps = !is_in_parentheses && expr.binary_op() == Some(BinOp::Nullish);
                replacement.extend_from_slice(if wraps { b"(" } else { b"" });
                replacement.extend_from_slice(fixer.file().slice(if is_in_parentheses {
                    expr.outer_span()
                } else {
                    expr.span()
                }));
                replacement.extend_from_slice(if wraps { b")" } else { b"" });
            }
            fixer.replace(e, replacement)
        });
    }
}

/// What two expressions are, if both are the same: what is in them is compared.
enum Both<'a> {
    /// `a && b`, `a || b`, `a ?? b`: whether the operator is the same, and the `b`s.
    Logical(bool, Expr<'a>, Expr<'a>),
    /// `!a`, `-a`: whether the operator is the same.
    Unary(bool),
    Await,
}

fn is_logical(op: BinOp) -> bool {
    matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish)
}

fn is_update(op: UnOp) -> bool {
    matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec)
}

/// oxlint asks `is_same_expression` at every level on the way down, which takes quadratic time for `a && a && ..` and
/// `!!!..a`. Here it is asked at the bottom, and the answer for each level is made of the one below. `depth`: of the
/// operands on the right, which are nested only by precedence and by parentheses.
fn is_same_node<'a>(left: Expr<'a>, right: Expr<'a>, depth: u32) -> bool {
    let mut levels: SmallVec<[Both<'a>; 8]> = SmallVec::new();
    let (mut left, mut right) = (left, right);
    loop {
        if left.is_chain_root() || right.is_chain_root() {
            break;
        }
        (left, right) = match (left.kind(), right.kind()) {
            (ExprKind::Binary { op, left: a, right: b }, ExprKind::Binary { op: other_op, left: c, right: d })
                if is_logical(op) && is_logical(other_op) =>
            {
                levels.push(Both::Logical(op == other_op, b, d));
                (a, c)
            }
            (ExprKind::Unary { op, operand: a }, ExprKind::Unary { op: other_op, operand: b })
                if !is_update(op) && !is_update(other_op) =>
            {
                levels.push(Both::Unary(op == other_op));
                (a, b)
            }
            (ExprKind::Await(a), ExprKind::Await(b)) => {
                levels.push(Both::Await);
                (a, b)
            }
            _ => break,
        };
    }
    let are_updates = matches!((left.kind(), right.kind()), (ExprKind::Unary { .. }, ExprKind::Unary { .. }));
    // `is_same_node`, and `is_same_expression` of what is in `as T` and the like.
    let mut is_same = is_same_expression(left, right) || !are_updates && left.text() == right.text();
    let mut is_same_inner = !levels.is_empty() && is_same_inner_expression(left, right);
    while let Some(level) = levels.pop() {
        is_same_inner = match level {
            Both::Logical(is_same_operator, a, b) => {
                let is_same_level = is_same_operator && is_same_inner && is_same_inner_expression(a, b);
                is_same = is_same_level || is_same && depth < 64 && is_same_node(a, b, depth + 1);
                is_same_level
            }
            Both::Unary(is_same_operator) => is_same_operator && is_same_inner,
            Both::Await => false,
        };
        is_same |= is_same_inner;
    }
    is_same
}
