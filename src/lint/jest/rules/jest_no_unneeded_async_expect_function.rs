use crate::jest::{self, Ctx, Runner};
use crate::jest_matchers::no_unneeded_async_expect_function;
use bun_lint::prelude::*;

/// Disallows unnecessary async function wrapper for expected promises.
pub struct NoUnneededAsyncExpectFunction<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for NoUnneededAsyncExpectFunction<RUNNER> {
    const META: Meta =
        jest::meta(RUNNER, "no-unneeded-async-expect-function", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnneededAsyncExpectFunction
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && jest::is_test(file, RUNNER) && file.has_exprs([ExprTag::Await])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &no_unneeded_async_expect_function::run);
    }
}
