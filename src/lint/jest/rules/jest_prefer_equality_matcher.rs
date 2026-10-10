use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_equality_matcher;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Jest has built-in matchers for expecting equality, which allow for more readable tests and error messages if an
/// expectation fails.
pub struct PreferEqualityMatcher;

impl Rule for PreferEqualityMatcher {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-equality-matcher", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferEqualityMatcher
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_equality_matcher::run);
    }
}
