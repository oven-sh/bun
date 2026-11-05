use crate::jest::{self, Ctx, Runner};
use crate::jest_tests::prefer_lowercase_title::PreferLowercaseTitleConfig;
use bun_lint::prelude::*;

/// Enforce `it`, `test`, `describe`, and `bench` to have descriptions that begin with a lowercase letter.
pub struct PreferLowercaseTitle<const RUNNER: u8 = { jest::JEST }>(PreferLowercaseTitleConfig);

impl<const RUNNER: u8> Rule for PreferLowercaseTitle<RUNNER> {
    const META: Meta =
        jest::meta(RUNNER, "prefer-lowercase-title", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferLowercaseTitle(PreferLowercaseTitleConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file, RUNNER).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &|node, ctx| self.0.run(node, ctx));
    }
}
