use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_expect_resolves;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer `await expect(...).resolves` over `expect(await ...)` when testing promises.
pub struct PreferExpectResolves;

impl Rule for PreferExpectResolves {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-expect-resolves", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferExpectResolves
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_test(file) && file.has_exprs([ExprTag::Await])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_expect_resolves::run);
    }
}
