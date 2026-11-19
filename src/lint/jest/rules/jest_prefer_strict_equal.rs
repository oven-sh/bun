use crate::jest::{self, Ctx, Runner};
use crate::jest_matchers::prefer_strict_equal;
use bun_lint::prelude::*;

/// This rule triggers a warning if `toEqual()` is used to assert equality.
pub struct PreferStrictEqual<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for PreferStrictEqual<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "prefer-strict-equal", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferStrictEqual
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && file.mentions("toEqual") && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_strict_equal::run);
    }
}
