use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_to_contain;
use bun_lint::prelude::*;

/// In order to have a better failure message, `toContain()` should be used upon asserting expectations on an array containing
/// an object.
pub struct PreferToContain<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for PreferToContain<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "prefer-to-contain", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferToContain
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (file.mentions("expect") && file.mentions("includes") && jest::is_test(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_to_contain::run);
    }
}
