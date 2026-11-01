use crate::jest::{self, Ctx, Runner};
use crate::jest_matchers::prefer_equality_matcher;
use bun_lint::prelude::*;

/// Jest has built-in matchers for expecting equality, which allow for more readable tests and error messages if an
/// expectation fails.
pub struct PreferEqualityMatcher<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for PreferEqualityMatcher<RUNNER> {
    const META: Meta =
        jest::meta(RUNNER, "prefer-equality-matcher", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferEqualityMatcher
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && jest::mentions_any(file, &const { jest::mention_bits(["toBe", "toEqual", "toStrictEqual"]) }) && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_equality_matcher::run);
    }
}
