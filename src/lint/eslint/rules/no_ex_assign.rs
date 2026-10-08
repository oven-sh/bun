use bun_lint::prelude::*;

/// Disallow reassigning exceptions in `catch` clauses.
pub struct NoExAssign;

const UNEXPECTED: Message = Message::new("unexpected", "Do not assign to the exception parameter.");

impl Rule for NoExAssign {
    const META: Meta = Meta::eslint("no-ex-assign", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoExAssign
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Try], |_, stmt, cx| {
            let StmtKind::Try { param: Some(param), .. } = stmt.kind() else {
                return;
            };
            param.pat().for_each_binding(&mut |pat| {
                let Some(symbol) = pat.symbol().filter(|it| it.has_modifying_references()) else {
                    return;
                };
                for reference in ast_utils::get_modifying_references(symbol.references()) {
                    cx.report(reference, UNEXPECTED);
                }
            });
        });
    }
}
