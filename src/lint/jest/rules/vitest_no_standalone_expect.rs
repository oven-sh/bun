use crate::jest::{self, Ctx};
use crate::jest_expect::no_standalone_expect::NoStandaloneExpectConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevents `expect` statements outside of a `test` or `it` block.
pub struct NoStandaloneExpect(NoStandaloneExpectConfig);

impl Rule for NoStandaloneExpect {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-standalone-expect", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoStandaloneExpect(NoStandaloneExpectConfig::new(options))
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
