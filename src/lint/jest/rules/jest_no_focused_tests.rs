use crate::jest::{self, Ctx, Runner};
use crate::jest_tests::no_focused_tests;
use bun_lint::prelude::*;

/// This rule reminds you to remove `.only` from your tests by raising a warning whenever you are using the exclusivity
/// feature.
pub struct NoFocusedTests<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for NoFocusedTests<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-focused-tests", Kind::Problem).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoFocusedTests
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::mentions_any(file, &const { jest::mention_bits(["only", "fit", "fdescribe"]) }) && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &no_focused_tests::run);
    }
}
