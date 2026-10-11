use crate::jest::{self, Ctx};
use crate::jest_tests::no_commented_out_tests;
use bun_lint::prelude::*;

/// This rule raises a warning about commented-out tests.
pub struct NoCommentedOutTests<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for NoCommentedOutTests<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "no-commented-out-tests", Kind::Problem);
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
