use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_strict_equal;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule triggers a warning if `toEqual()` is used to assert equality.
pub struct PreferStrictEqual;

impl Rule for PreferStrictEqual {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-strict-equal", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferStrictEqual
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_test(file) && file.mentions("toEqual")).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &prefer_strict_equal::run);
    }
}
