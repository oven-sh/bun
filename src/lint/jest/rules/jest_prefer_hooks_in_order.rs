use crate::jest::Ctx;
use crate::jest_hooks::{HOOKS, prefer_hooks_in_order};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Ensures that hooks are in the order that they are called in.
pub struct PreferHooksInOrder;

impl Rule for PreferHooksInOrder {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-hooks-in-order", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferHooksInOrder
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions_any(&HOOKS).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        prefer_hooks_in_order::run_once(&ctx);
    }
}
