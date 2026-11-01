use crate::jest::{self, Ctx, Runner};
use crate::jest_tests::valid_title::ValidTitleConfig;
use bun_lint::prelude::*;

/// Checks that the titles of Jest and Vitest blocks are valid.
pub struct ValidTitle<const RUNNER: u8 = { jest::JEST }>(ValidTitleConfig);

impl<const RUNNER: u8> Rule for ValidTitle<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "valid-title", Kind::Problem).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        ValidTitle(ValidTitleConfig::new(options, Runner::of(RUNNER)))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file, RUNNER).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &|node, ctx| self.0.run(node, ctx));
    }
}
