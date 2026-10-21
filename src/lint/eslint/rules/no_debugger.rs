use bun_lint::prelude::*;

/// Disallow the use of `debugger`.
pub struct NoDebugger;

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected 'debugger' statement.");

impl Rule for NoDebugger {
    const META: Meta = Meta::eslint("no-debugger", Kind::Problem).recommended();
    const ON: On = On::new().stmts(&[StmtTag::Debugger]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoDebugger
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let report = cx.report(stmt, UNEXPECTED);
        // oxlint suggests removing it, or replacing it with a block where a statement is required.
        if cx.language().is_oxlint {
            let is_body = matches!(stmt.parent(), Node::Stmt(parent) if matches!(
                parent.tag(),
                StmtTag::If | StmtTag::While | StmtTag::For | StmtTag::ForIn | StmtTag::ForOf
            ));
            report.fix(|fixer| fixer.replace(stmt, if is_body { "{}" } else { "" }));
        }
    }
}
