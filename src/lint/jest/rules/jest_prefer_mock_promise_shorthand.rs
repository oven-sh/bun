use crate::jest::{self, Ctx, Runner};
use crate::jest_mocks::prefer_mock_promise_shorthand;
use bun_lint::prelude::*;

/// When working with mocks of functions that return promises, Jest provides some API sugar functions to reduce the amount of
/// boilerplate you have to write.
pub struct PreferMockPromiseShorthand<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for PreferMockPromiseShorthand<RUNNER> {
    const META: Meta =
        jest::meta(RUNNER, "prefer-mock-promise-shorthand", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferMockPromiseShorthand
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && prefer_mock_promise_shorthand::should_run(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        prefer_mock_promise_shorthand::run_once(&ctx);
    }
}
