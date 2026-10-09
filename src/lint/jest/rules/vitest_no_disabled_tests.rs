use crate::jest::{self, Ctx};
use crate::jest_tests::no_disabled_tests;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule raises a warning about disabled tests.
pub struct NoDisabledTests;

impl Rule for NoDisabledTests {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-disabled-tests", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDisabledTests
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                jest::run_on_jest_nodes(&ctx, &no_disabled_tests::run);
            });
        }
    }
}
