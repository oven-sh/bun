use crate::jest::Ctx;
use crate::jest_mocks::prefer_mock_promise_shorthand;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// When working with mocks of functions that return promises, Jest provides some API sugar functions to reduce the amount of
/// boilerplate you have to write.
pub struct PreferMockPromiseShorthand;

impl Rule for PreferMockPromiseShorthand {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-mock-promise-shorthand", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferMockPromiseShorthand
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        prefer_mock_promise_shorthand::should_run(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        prefer_mock_promise_shorthand::run_once(&ctx);
    }
}
