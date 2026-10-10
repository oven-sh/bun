use bun_lint::prelude::*;

/// Disallow deleting variables.
pub struct NoDeleteVar;

const UNEXPECTED: Message = Message::new("unexpected", "Variables should not be deleted.");

impl Rule for NoDeleteVar {
    const META: Meta = Meta::eslint("no-delete-var", Kind::Suggestion).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Unary]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoDeleteVar
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Unary {
            op: UnOp::Delete,
            operand,
        } = e.kind()
            && operand.tag() == ExprTag::Ident
        {
            cx.report(e, UNEXPECTED);
        }
    }
}
