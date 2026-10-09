use crate::jest::{self, Ctx};
use crate::jest_tests::prefer_lowercase_title::PreferLowercaseTitleConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce `it`, `test`, `describe`, and `bench` to have descriptions that begin with a lowercase letter.
pub struct PreferLowercaseTitle(PreferLowercaseTitleConfig);

impl Rule for PreferLowercaseTitle {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-lowercase-title", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferLowercaseTitle(PreferLowercaseTitleConfig::new(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) {
            on.finish(|rule, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                jest::run_on_jest_nodes(&ctx, &|node, ctx| rule.0.run(node, ctx));
            });
        }
    }
}
