use bun_lint_oxlint::ast_util::is_specific_id;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Warn about calling `new` on `require`.
pub struct NoNewRequire;

const NO_NEW_REQUIRE: Message = Message::new("", "Unexpected use of `new` operator with `require`");

impl Rule for NoNewRequire {
    const META: Meta = Meta::oxlint(Plugin::Node, "no-new-require", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNewRequire
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("require").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if e.callee().is_some_and(|it| is_specific_id(it, "require")) {
            cx.report(e, NO_NEW_REQUIRE);
        }
    }
}
