use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Checks for erasing operations, e.g., `x * 0`.
pub struct ErasingOp;

const ERASING_OP: Message = Message::new("", "Unexpected erasing operation. This expression will always evaluate to zero.");

impl Rule for ErasingOp {
    const META: Meta = Meta::oxlint(Plugin::Oxc, "erasing-op", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().binaries(&[BinOp::Mul, BinOp::BitAnd, BinOp::Div]);
    no_state!();

    fn new(_: &Options) -> Self {
        ErasingOp
    }

    fn binary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Binary { op, left, right } = e.kind() else {
            return;
        };
        let is_division = op == BinOp::Div;
        if is_division && is_number_0(right) {
            return;
        }
        for _ in [left, right].into_iter().take(if is_division { 1 } else { 2 }).filter(|it| is_number_0(*it)) {
            cx.report(e, ERASING_OP).fix_dangerously(|fixer| fixer.replace(e, "0"));
        }
    }
}

fn is_number_0(e: Expr) -> bool {
    matches!(get_inner_expression(e).kind(), ExprKind::Number(value) if value == 0.0)
}
