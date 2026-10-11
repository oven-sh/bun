use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_comparison_matcher;
use bun_lint::prelude::*;

/// This rule checks for comparisons in tests that could be replaced with one of the following built-in comparison matchers
pub struct PreferComparisonMatcher<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for PreferComparisonMatcher<VITEST> {
    const META: Meta =
        Meta::oxlint(jest::plugin(VITEST), "prefer-comparison-matcher", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferComparisonMatcher
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && jest::mentions_any(file, &const { jest::mention_bits(["toBe", "toEqual", "toStrictEqual"]) }) && jest::is_test(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_comparison_matcher::run);
    }
}
