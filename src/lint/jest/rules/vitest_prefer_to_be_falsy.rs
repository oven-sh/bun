use crate::jest::{self, Ctx};
use crate::jest_matchers::prefer_to_be_simply_bool;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer `toBeFalsy()` over `toBe(false)`.
pub struct PreferToBeFalsy;

impl Rule for PreferToBeFalsy {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "prefer-to-be-falsy", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferToBeFalsy
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &|node, ctx| prefer_to_be_simply_bool::run(node, ctx, false));
    }
}
