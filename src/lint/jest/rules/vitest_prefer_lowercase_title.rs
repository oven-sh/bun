use crate::jest::{self, Ctx};
use crate::jest_tests::prefer_lowercase_title::PreferLowercaseTitleConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce `it`, `test`, `describe`, and `bench` to have descriptions that begin with a lowercase letter.
pub struct PreferLowercaseTitle(PreferLowercaseTitleConfig);

impl Rule for PreferLowercaseTitle {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-lowercase-title", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferLowercaseTitle(PreferLowercaseTitleConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file).then_some(())
    }

    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &|node, ctx| self.0.run(node, ctx));
    }
}
