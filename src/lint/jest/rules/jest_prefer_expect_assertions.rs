use crate::jest::{self, Ctx};
use crate::jest_expect::prefer_expect_assertions::PreferExpectAssertionsConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforces that every test has either `expect.assertions(<number>)` or `expect.hasAssertions()` as its first expression.
pub struct PreferExpectAssertions(PreferExpectAssertionsConfig);

impl Rule for PreferExpectAssertions {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-expect-assertions", Kind::Suggestion).has_suggestions();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferExpectAssertions(PreferExpectAssertionsConfig::new(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::may_have_possible_jest_call_node(file) {
            on.finish(|rule, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                rule.0.run_once(&ctx, false);
            });
        }
    }
}
