use crate::jest::Ctx;
use crate::jest_tests::no_commented_out_tests;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule raises a warning about commented-out tests.
pub struct NoCommentedOutTests;

impl Rule for NoCommentedOutTests {
    const META: Meta = Meta::oxlint(Plugin::Jest, "no-commented-out-tests", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoCommentedOutTests
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.comments().next().is_some().then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        no_commented_out_tests::run_once(&ctx);
    }
}
