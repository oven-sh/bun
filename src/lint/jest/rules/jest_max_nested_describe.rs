use crate::jest::{self, Ctx, Runner};
use crate::jest_tests::max_nested_describe;
use bun_lint::prelude::*;

/// This rule enforces a maximum depth to nested `describe()` calls.
pub struct MaxNestedDescribe<const RUNNER: u8 = { jest::JEST }>(u32);

impl<const RUNNER: u8> Rule for MaxNestedDescribe<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "max-nested-describe", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        MaxNestedDescribe(jest::max_of(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && jest::mentions_describe(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        max_nested_describe::run_once(self.0, &ctx);
    }
}
