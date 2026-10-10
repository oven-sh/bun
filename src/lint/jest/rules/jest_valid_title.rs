use crate::jest::{self, Ctx};
use crate::jest_tests::valid_title::ValidTitleConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Checks that the titles of Jest and Vitest blocks are valid.
pub struct ValidTitle(ValidTitleConfig);

impl Rule for ValidTitle {
    const META: Meta = Meta::oxlint(Plugin::Jest, "valid-title", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ValidTitle(ValidTitleConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &|node, ctx| self.0.run(node, ctx));
    }
}
