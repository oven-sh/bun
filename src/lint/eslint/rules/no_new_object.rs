use bun_lint::prelude::*;

/// Disallow `Object` constructors.
pub struct NoNewObject;

const PREFER_LITERAL: Message =
    Message::new("preferLiteral", "The object literal notation {} is preferable.");

impl Rule for NoNewObject {
    const META: Meta = Meta::eslint("no-new-object", Kind::Suggestion).deprecated();
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewObject
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("Object").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
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
    }
}
