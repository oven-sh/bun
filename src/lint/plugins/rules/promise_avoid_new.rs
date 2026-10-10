use bun_lint_oxlint::ast_util::is_reference_to_global_variable;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow creating promises with `new Promise()`.
pub struct AvoidNew;

const AVOID_NEW_PROMISE: Message = Message::new("", "Avoid creating new promises");

impl Rule for AvoidNew {
    const META: Meta = Meta::oxlint(Plugin::Promise, "avoid-new", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::New]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        AvoidNew
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("Promise").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if e.callee().is_some_and(|it| it.is_ident("Promise") && !it.is_parenthesized() && is_reference_to_global_variable(it)) {
            cx.report(e, AVOID_NEW_PROMISE);
        }
    }
}
