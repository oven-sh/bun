use crate::jest::{self, Ctx, Runner};
use crate::jest_matchers::prefer_to_be;
use bun_lint::prelude::*;

/// Recommends using `toBe` matcher for primitive literals and specific matchers for `null`, `undefined`, and `NaN`.
pub struct PreferToBe<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for PreferToBe<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "prefer-to-be", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferToBe
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_to_be::run);
    }
}
