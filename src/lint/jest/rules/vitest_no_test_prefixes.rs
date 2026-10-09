use crate::jest::{self, Ctx};
use crate::jest_tests::no_test_prefixes;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Require using `.only` and `.skip` over `f` and `x`.
pub struct NoTestPrefixes;

impl Rule for NoTestPrefixes {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-test-prefixes", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoTestPrefixes
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) {
            on.finish(|_, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                jest::run_on_jest_nodes(&ctx, &no_test_prefixes::run);
            });
        }
    }
}
