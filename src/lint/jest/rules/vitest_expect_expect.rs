use crate::jest::{self, Ctx};
use crate::jest_expect::expect_expect::ExpectExpectConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule triggers when there is no call made to `expect` in a test, ensure that there is at least one `expect` call made
/// in a test.
pub struct ExpectExpect(ExpectExpectConfig);

impl Rule for ExpectExpect {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "expect-expect", Kind::Problem);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ExpectExpect(ExpectExpectConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        self.0.run_once(&ctx, true);
    }
}
