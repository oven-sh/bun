use crate::jest::{self, Ctx};
use crate::jest_tests::valid_title::ValidTitleConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Checks that the titles of Jest and Vitest blocks are valid.
pub struct ValidTitle(ValidTitleConfig);

impl Rule for ValidTitle {
    const META: Meta = Meta::oxlint(Plugin::Jest, "valid-title", Kind::Problem).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ValidTitle(ValidTitleConfig::new(options))
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
