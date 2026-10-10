use crate::jest::{self, Ctx};
use crate::jest_matchers::no_unneeded_async_expect_function;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows unnecessary async function wrapper for expected promises.
pub struct NoUnneededAsyncExpectFunction;

impl Rule for NoUnneededAsyncExpectFunction {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-unneeded-async-expect-function", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnneededAsyncExpectFunction
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_test(file) && file.has_exprs([ExprTag::Await])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &no_unneeded_async_expect_function::run);
    }
}
