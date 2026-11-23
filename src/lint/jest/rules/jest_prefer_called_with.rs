use crate::jest::{self, Ctx, Runner};
use crate::jest_matchers::prefer_called_with;
use bun_lint::prelude::*;

/// Suggest using `toBeCalledWith()` or `toHaveBeenCalledWith()`
pub struct PreferCalledWith<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for PreferCalledWith<RUNNER> {
    const META: Meta = jest::meta_with_risky_fix(RUNNER, "prefer-called-with", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferCalledWith
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && jest::mentions_any(file, &const { jest::mention_bits(["toBeCalled", "toHaveBeenCalled"]) }) && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_called_with::run);
    }
}
