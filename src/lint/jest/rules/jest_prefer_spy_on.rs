use crate::jest::{self, Ctx, Runner};
use crate::jest_mocks::prefer_spy_on;
use bun_lint::prelude::*;

/// When mocking a function by overwriting a property you have to manually restore the original implementation when cleaning
/// up.
pub struct PreferSpyOn<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for PreferSpyOn<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "prefer-spy-on", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferSpyOn
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && prefer_spy_on::should_run(file, Runner::of(RUNNER))).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        prefer_spy_on::run_once(&ctx);
    }
}
