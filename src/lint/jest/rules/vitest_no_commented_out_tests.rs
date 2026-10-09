use crate::jest::Ctx;
use crate::jest_tests::no_commented_out_tests;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule raises a warning about commented-out tests.
pub struct NoCommentedOutTests;

impl Rule for NoCommentedOutTests {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-commented-out-tests", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoCommentedOutTests
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.comments().next().is_some() {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                no_commented_out_tests::run_once(&ctx);
            });
        }
    }
}
