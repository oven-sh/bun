use bun_lint::prelude::*;

/// Disallow `with` statements.
pub struct NoWith;

const UNEXPECTED_WITH: Message =
    Message::new("unexpectedWith", "Unexpected use of 'with' statement.");

impl Rule for NoWith {
    const META: Meta = Meta::eslint("no-with", Kind::Suggestion).recommended();
    // A `with` statement has the tag `Block`.
    const ON: On = On::new().stmts(&[StmtTag::Block]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoWith
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if let StmtKind::With { .. } = stmt.kind() {
            let start = stmt.span().start;
            // Before ESLint 10 it is the whole statement.
            let end = if cx.language().eslint_major < 10 { stmt.span().end } else { start + "with".len() as u32 };
            cx.report(Span::new(start, end), UNEXPECTED_WITH);
        }
    }
}
