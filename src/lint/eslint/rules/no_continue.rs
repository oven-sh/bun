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
            let whole = stmt.span();
            // oxlint points at the keyword.
            let end = if cx.language().is_oxlint { whole.start + "continue".len() as u32 } else { whole.end };
            cx.report(Span::new(whole.start, end), UNEXPECTED);
        });
    }
}
