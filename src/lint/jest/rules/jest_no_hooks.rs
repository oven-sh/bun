use crate::jest::{self, Ctx};
use crate::jest_hooks::no_hooks::NoHooksConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows Jest setup and teardown hooks, such as `beforeAll`.
pub struct NoHooks(NoHooksConfig);

impl Rule for NoHooks {
    const META: Meta = Meta::oxlint(Plugin::Jest, "no-hooks", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoHooks(NoHooksConfig::new(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if jest::is_test(file) {
            on.finish(|rule, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                jest::run_on_jest_nodes(&ctx, &|node, ctx| rule.0.run(node, ctx));
            });
        }
    }
}
