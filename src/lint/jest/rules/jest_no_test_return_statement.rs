use crate::jest::{self, Ctx};
use crate::jest_tests::no_test_return_statement;
use bun_lint::prelude::*;

/// Disallow explicitly returning from tests.
pub struct NoTestReturnStatement<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for NoTestReturnStatement<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "no-test-return-statement", Kind::Suggestion);
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
