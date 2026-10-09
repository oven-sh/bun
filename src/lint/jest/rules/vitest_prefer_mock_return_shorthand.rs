use crate::jest::Ctx;
use crate::jest_mocks::prefer_mock_return_shorthand;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// When working with mocks of functions that return simple values, Jest provides some API sugar functions to reduce the
/// amount of boilerplate you have to write.
pub struct PreferMockReturnShorthand;

impl Rule for PreferMockReturnShorthand {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-mock-return-shorthand", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferMockReturnShorthand
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if prefer_mock_return_shorthand::should_run(file) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                prefer_mock_return_shorthand::run_once(&ctx);
            });
        }
    }
}
