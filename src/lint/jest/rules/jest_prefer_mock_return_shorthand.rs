use crate::jest::{self, Ctx};
use crate::jest_mocks::prefer_mock_return_shorthand;
use bun_lint::prelude::*;

/// When working with mocks of functions that return simple values, Jest provides some API sugar functions to reduce the
/// amount of boilerplate you have to write.
pub struct PreferMockReturnShorthand<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for PreferMockReturnShorthand<VITEST> {
    const META: Meta =
        Meta::oxlint(jest::plugin(VITEST), "prefer-mock-return-shorthand", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferMockReturnShorthand
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        prefer_mock_return_shorthand::should_run(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        prefer_mock_return_shorthand::run_once(&ctx);
    }
}
