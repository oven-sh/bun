use bun_lint::prelude::*;

/// Disallow `with` statements.
pub struct NoWith;

const UNEXPECTED_WITH: Message =
    Message::new("unexpectedWith", "Unexpected use of 'with' statement.");

impl Rule for NoWith {
    const META: Meta = Meta::eslint("no-with", Kind::Suggestion).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoWith
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        // A `with` statement has the tag `Block`.
        on.stmts([StmtTag::Block], |_, stmt, cx| {
            if let StmtKind::With { .. } = stmt.kind() {
                let start = stmt.span().start;
                cx.report(Span::new(start, start + "with".len() as u32), UNEXPECTED_WITH);
            }
        });
    }
}
