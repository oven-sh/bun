use crate::jest::{self, Ctx, Runner};
use crate::jest_tests::no_disabled_tests;
use bun_lint::prelude::*;

/// This rule raises a warning about disabled tests.
pub struct NoDisabledTests<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for NoDisabledTests<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-disabled-tests", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDisabledTests
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file, RUNNER).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &no_disabled_tests::run);
    }
}
