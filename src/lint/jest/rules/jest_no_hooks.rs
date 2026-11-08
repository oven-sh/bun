use crate::jest::{self, Ctx, Runner};
use crate::jest_hooks::{mentions_hook, no_hooks::NoHooksConfig};
use bun_lint::prelude::*;

/// Disallows Jest setup and teardown hooks, such as `beforeAll`.
pub struct NoHooks<const RUNNER: u8 = { jest::JEST }>(NoHooksConfig);

impl<const RUNNER: u8> Rule for NoHooks<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "no-hooks", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoHooks(NoHooksConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (mentions_hook(file) && jest::is_test(file, RUNNER)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &|node, ctx| self.0.run(node, ctx));
    }
}
