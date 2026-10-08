use bun_lint::prelude::*;

/// Disallow the use of `debugger`.
pub struct NoDebugger;

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected 'debugger' statement.");

impl Rule for NoDebugger {
    const META: Meta = Meta::eslint("no-debugger", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDebugger
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Debugger], |_, stmt, cx| {
            cx.report(stmt, UNEXPECTED);
        });
    }
}
