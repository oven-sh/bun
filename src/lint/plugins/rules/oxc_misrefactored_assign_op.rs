use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint_oxlint::same_expression::{is_same_expression, is_same_member_expression};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Checks for `a op= a op b` or `a op= b op a` patterns.
pub struct MisrefactoredAssignOp;

const MISREFACTORED_ASSIGN_OP: Message =
    Message::new("", "Misrefactored assign op. Variable appears on both sides of an assignment operation");
const DID_YOU_MEAN: Message = Message::new("", "Did you mean `{{suggestion}}`?");

impl Rule for MisrefactoredAssignOp {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "misrefactored-assign-op", Kind::Problem).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        MisrefactoredAssignOp
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Assign], |_, e, cx| {
            let ExprKind::Assign { op: Some(op), target, value } = e.kind() else {
                return;
            };
            // `a &&= a && b` has no binary expression on the right for oxlint.
            if value.binary_op() != Some(op) || matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish) || value.is_parenthesized() {
                return;
            }
            let ExprKind::Binary { left, right, .. } = value.kind() else {
                return;
            };
            let report = |operand: Expr<'a>| {
                let suggestion = [target.text(), assign_op_text(Some(op)).as_bytes(), cx.slice(operand.outer_span())].join(&b' ');
                cx.report(e, MISREFACTORED_ASSIGN_OP)
                    .data("suggestion", suggestion.clone())
                    .suggest_with(DID_YOU_MEAN, &[("suggestion", &suggestion[..])], |fixer| fixer.replace(e, &suggestion[..]));
            };
            if assignment_target_eq_expr(target, left) {
                report(right);
            }
            if is_commutative_operator(op) && assignment_target_eq_expr(target, right) {
                report(left);
            }
        });
    }
}

fn assignment_target_eq_expr<'a>(assignment_target: Expr<'a>, right_expr: Expr<'a>) -> bool {
    let right_expr = get_inner_expression(right_expr);
    match assignment_target.kind() {
        ExprKind::Ident(name) => right_expr.as_ident() == Some(name),
        ExprKind::Dot { .. } | ExprKind::Index { .. } => {
            matches!(right_expr.tag(), ExprTag::Dot | ExprTag::Index)
                && !right_expr.is_chain_root()
                && is_same_member_expression(assignment_target, right_expr)
        }
        ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => {
            !expr.is_parenthesized() && is_same_expression(expr, right_expr)
        }
        _ => false,
    }
}

fn is_commutative_operator(op: BinOp) -> bool {
    matches!(op, BinOp::Add | BinOp::Mul | BinOp::BitOr | BinOp::BitXor | BinOp::BitAnd)
}
