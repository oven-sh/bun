use crate::jest::{self, Ctx, Runner};
use crate::jest_hooks::{mentions_hook, prefer_hooks_in_order};
use bun_lint::prelude::*;

/// Ensures that hooks are in the order that they are called in.
pub struct PreferHooksInOrder<const RUNNER: u8 = { jest::JEST }>;

impl<const RUNNER: u8> Rule for PreferHooksInOrder<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "prefer-hooks-in-order", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferHooksInOrder
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (jest::is_for(file, RUNNER) && mentions_hook(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        prefer_hooks_in_order::run_once(&ctx);
    }
}
