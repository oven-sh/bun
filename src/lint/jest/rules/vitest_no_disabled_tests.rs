use crate::jest::{self, Ctx};
use crate::jest_tests::no_disabled_tests;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule raises a warning about disabled tests.
pub struct NoDisabledTests;

impl Rule for NoDisabledTests {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-disabled-tests", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDisabledTests
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &no_disabled_tests::run);
    }
}
