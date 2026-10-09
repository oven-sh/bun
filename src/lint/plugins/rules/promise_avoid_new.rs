use bun_lint_oxlint::ast_util::is_reference_to_global_variable;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow creating promises with `new Promise()`.
pub struct AvoidNew;

const AVOID_NEW_PROMISE: Message = Message::new("", "Avoid creating new promises");

impl Rule for AvoidNew {
    const META: Meta = Meta::oxlint(Plugin::Promise, "avoid-new", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        AvoidNew
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("Promise") {
            return;
        }
        on.exprs([ExprTag::New], |_, e, cx| {
            if e.callee().is_some_and(|it| it.is_ident("Promise") && !it.is_parenthesized() && is_reference_to_global_variable(it)) {
                cx.report(e, AVOID_NEW_PROMISE);
            }
        });
    }
}
