use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_expect_resolves;
use bun_lint::prelude::*;

/// Prefer `await expect(...).resolves` over `expect(await ...)` when testing promises.
pub struct PreferExpectResolves<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for PreferExpectResolves<VITEST> {
    const META: Meta =
        Meta::oxlint(jest::plugin(VITEST), "prefer-expect-resolves", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferExpectResolves
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && jest::is_test(file) && file.has_exprs([ExprTag::Await])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_expect_resolves::run);
    }
}
