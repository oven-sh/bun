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
            let report = cx.report(stmt, UNEXPECTED);
            // oxlint suggests to remove it, or to put a block where a statement has to be.
            if cx.language().is_oxlint {
                let is_body = matches!(stmt.parent(), Node::Stmt(parent) if matches!(
                    parent.tag(),
                    StmtTag::If | StmtTag::While | StmtTag::For | StmtTag::ForIn | StmtTag::ForOf
                ));
                report.fix(|fixer| fixer.replace(stmt, if is_body { "{}" } else { "" }));
            }
        });
    }
}
