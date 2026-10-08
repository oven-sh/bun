use bun_lint::prelude::*;

/// Disallow deleting variables.
pub struct NoDeleteVar;

const UNEXPECTED: Message = Message::new("unexpected", "Variables should not be deleted.");

impl Rule for NoDeleteVar {
    const META: Meta = Meta::eslint("no-delete-var", Kind::Suggestion).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDeleteVar
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Unary], |_, e, cx| {
            if let ExprKind::Unary {
                op: UnOp::Delete,
                operand,
            } = e.kind()
                && operand.tag() == ExprTag::Ident
            {
                cx.report(e, UNEXPECTED);
            }
        });
    }
}
