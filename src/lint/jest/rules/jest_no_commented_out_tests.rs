use crate::jest::{self, Ctx, Runner};
use crate::jest_tests::no_commented_out_tests;
use bun_lint::prelude::*;

/// This rule raises a warning about commented-out tests.
pub struct NoCommentedOutTests<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for NoCommentedOutTests<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-commented-out-tests", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoCommentedOutTests
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && file.comments().next().is_some()).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        no_commented_out_tests::run_once(&ctx);
    }
}
