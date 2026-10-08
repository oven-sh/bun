use bun_lint::prelude::*;

/// Disallow `Object` constructors.
pub struct NoNewObject;

const PREFER_LITERAL: Message =
    Message::new("preferLiteral", "The object literal notation {} is preferable.");

impl Rule for NoNewObject {
    const META: Meta = Meta::eslint("no-new-object", Kind::Suggestion).deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewObject
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::New], |_, e, cx| {
            let ExprKind::New(call) = e.kind() else {
                return;
            };
            if !call.callee().is_ident("Object") {
                return;
            }
            let variable = ast_utils::get_variable_by_name(Node::Expr(e).scope(), "Object");
            if variable.is_some_and(|it| it.declarations().next().is_some()) {
                return;
            }
            cx.report(e, PREFER_LITERAL);
        });
    }
}
