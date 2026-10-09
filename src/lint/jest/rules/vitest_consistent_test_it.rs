use crate::jest::{self, Ctx};
use crate::jest_tests::consistent_test_it::ConsistentTestItConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce consistent use of either the `it` or `test` keyword for defining tests.
pub struct ConsistentTestIt(ConsistentTestItConfig);

impl Rule for ConsistentTestIt {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "consistent-test-it", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ConsistentTestIt(ConsistentTestItConfig::new(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::may_have_possible_jest_call_node(file) {
            on.finish(|rule, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                rule.0.run_once(&ctx);
            });
        }
    }
}
