use crate::jest::{self, Ctx, Runner};
use crate::jest_tests::no_test_return_statement;
use bun_lint::prelude::*;

/// Disallow explicitly returning from tests.
pub struct NoTestReturnStatement<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for NoTestReturnStatement<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-test-return-statement", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoTestReturnStatement
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && file.mentions("expect") && file.has_stmts([StmtTag::Return])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        no_test_return_statement::run_once(&ctx);
    }
}
