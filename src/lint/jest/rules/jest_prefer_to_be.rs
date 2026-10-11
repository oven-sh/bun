use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_to_be;
use bun_lint::prelude::*;

/// Recommends using `toBe` matcher for primitive literals and specific matchers for `null`, `undefined`, and `NaN`.
pub struct PreferToBe<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for PreferToBe<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "prefer-to-be", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferToBe
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions("expect") && jest::is_test(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_to_be::run);
    }
}
