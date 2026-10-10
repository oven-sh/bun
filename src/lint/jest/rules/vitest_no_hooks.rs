use crate::jest::{self, Ctx};
use crate::jest_hooks::no_hooks::NoHooksConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows Jest setup and teardown hooks, such as `beforeAll`.
pub struct NoHooks(NoHooksConfig);

impl Rule for NoHooks {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "no-hooks", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoHooks(NoHooksConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        jest::is_test(file).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        jest::run_on_jest_nodes(&ctx, &|node, ctx| self.0.run(node, ctx));
    }
}
