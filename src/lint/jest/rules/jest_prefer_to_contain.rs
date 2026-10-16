use crate::jest::{self, Ctx, Runner};
use crate::jest_matchers::prefer_to_contain;
use bun_lint::prelude::*;

/// In order to have a better failure message, `toContain()` should be used upon asserting expectations on an array containing
/// an object.
pub struct PreferToContain<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for PreferToContain<RUNNER> {
    const META: Meta = jest::meta_with_risky_fix(RUNNER, "prefer-to-contain", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferToContain
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (file.mentions("expect") && file.mentions("includes") && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_to_contain::run);
    }
}
