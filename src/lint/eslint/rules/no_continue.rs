use bun_lint::prelude::*;

/// Disallow `continue` statements.
pub struct NoContinue;

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected use of continue statement.");

impl Rule for NoContinue {
    const META: Meta = Meta::eslint("no-continue", Kind::Suggestion);
    const ON: On = On::new().stmts(&[StmtTag::Continue]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoContinue
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let whole = stmt.span();
        // oxlint points at the keyword.
        let end = if cx.language().is_oxlint { whole.start + "continue".len() as u32 } else { whole.end };
        cx.report(Span::new(whole.start, end), UNEXPECTED);
    }
}
