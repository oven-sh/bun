use crate::jest::Ctx;
use crate::jest_tests::no_test_return_statement;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow explicitly returning from tests.
pub struct NoTestReturnStatement;

impl Rule for NoTestReturnStatement {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-test-return-statement", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoTestReturnStatement
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.mentions("expect") && file.has_stmts([StmtTag::Return]) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                no_test_return_statement::run_once(&ctx);
            });
        }
    }
}
