use crate::jest::{self, Ctx};
use crate::jest_hooks::prefer_hooks_on_top;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// While hooks can be setup anywhere in a test file, they are always called in a specific order, which means it can be
/// confusing if they're intermixed with test cases.
pub struct PreferHooksOnTop;

impl Rule for PreferHooksOnTop {
    const META: Meta = Meta::oxlint(Plugin::Jest, "prefer-hooks-on-top", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferHooksOnTop
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::may_have_possible_jest_call_node(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        prefer_hooks_on_top::run_once(&ctx);
    }
}
