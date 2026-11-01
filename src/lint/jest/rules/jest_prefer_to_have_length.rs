use crate::jest::{self, Ctx, Runner};
use crate::jest_matchers::prefer_to_have_length;
use bun_lint::prelude::*;

/// In order to have a better failure message, `toHaveLength()` should be used upon asserting expectations on objects length
/// property.
pub struct PreferToHaveLength<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for PreferToHaveLength<RUNNER> {
    const META: Meta =
        jest::meta(RUNNER, "prefer-to-have-length", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferToHaveLength
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (file.mentions("expect") && file.mentions("length") && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_to_have_length::run);
    }
}
