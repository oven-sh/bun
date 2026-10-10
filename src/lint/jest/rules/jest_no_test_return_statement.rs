use crate::jest::Ctx;
use crate::jest_tests::no_test_return_statement;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow explicitly returning from tests.
pub struct NoTestReturnStatement;

impl Rule for NoTestReturnStatement {
    const META: Meta = Meta::oxlint(Plugin::Jest, "no-test-return-statement", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoTestReturnStatement
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && file.has_stmts([StmtTag::Return])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        no_test_return_statement::run_once(&ctx);
    }
}
