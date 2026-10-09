use crate::jest::{self, Ctx};
use crate::jest_tests::no_focused_tests;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule reminds you to remove `.only` from your tests by raising a warning whenever you are using the exclusivity
/// feature.
pub struct NoFocusedTests;

impl Rule for NoFocusedTests {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-focused-tests", Kind::Problem).has_suggestions();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoFocusedTests
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                jest::run_on_jest_nodes(&ctx, &no_focused_tests::run);
            });
        }
    }
}
