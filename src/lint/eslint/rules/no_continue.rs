use bun_lint::prelude::*;

/// Disallow `continue` statements.
pub struct NoContinue;

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected use of continue statement.");

impl Rule for NoContinue {
    const META: Meta = Meta::eslint("no-continue", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoContinue
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Continue], |_, stmt, cx| {
            cx.report(stmt, UNEXPECTED);
        });
    }
}
