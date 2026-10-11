use crate::jest::{self, Ctx};
use crate::jest_hooks::{mentions_hook, prefer_hooks_in_order};
use bun_lint::prelude::*;

/// Ensures that hooks are in the order that they are called in.
pub struct PreferHooksInOrder<const VITEST: bool = false>;

impl<const VITEST: bool> Rule for PreferHooksInOrder<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "prefer-hooks-in-order", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferHooksInOrder
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        mentions_hook(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        prefer_hooks_in_order::run_once(&ctx);
    }
}
