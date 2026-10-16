use crate::jest::{self, Ctx, Runner};
use crate::jest_tests::no_conditional_in_test;
use bun_lint::prelude::*;

/// Disallow conditional statements in tests.
pub struct NoConditionalInTest<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for NoConditionalInTest<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-conditional-in-test", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoConditionalInTest
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && jest::mentions_test(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        no_conditional_in_test::run_once(&ctx);
    }
}
