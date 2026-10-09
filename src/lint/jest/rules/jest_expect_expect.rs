use crate::jest::{self, Ctx};
use crate::jest_expect::expect_expect::ExpectExpectConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule triggers when there is no call made to `expect` in a test, ensure that there is at least one `expect` call made
/// in a test.
pub struct ExpectExpect(ExpectExpectConfig);

impl Rule for ExpectExpect {
    const META: Meta = Meta::oxlint(Plugin::Jest, "expect-expect", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ExpectExpect(ExpectExpectConfig::new(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) {
            on.finish(|rule, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                rule.0.run_once(&ctx, false);
            });
        }
    }
}
