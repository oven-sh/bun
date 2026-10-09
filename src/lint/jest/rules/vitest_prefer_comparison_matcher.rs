use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_comparison_matcher;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule checks for comparisons in tests that could be replaced with one of the following built-in comparison matchers
pub struct PreferComparisonMatcher;

impl Rule for PreferComparisonMatcher {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-comparison-matcher", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferComparisonMatcher
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                jest::run_on_jest_nodes(&ctx, &prefer_comparison_matcher::run);
            });
        }
    }
}
