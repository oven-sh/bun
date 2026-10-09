use crate::jest::Ctx;
use crate::jest_hooks::require_hook::RequireHookConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule flags any expression that is either at the toplevel of a test file or directly within the body of a `describe`,
/// _except_ for the following
pub struct RequireHook(RequireHookConfig);

impl Rule for RequireHook {
    const META: Meta = Meta::oxlint(Plugin::Vitest, "require-hook", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        RequireHook(RequireHookConfig::new(options))
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if file.has_exprs([ExprTag::Call]) || file.has_stmts([StmtTag::Var]) {
            on.finish(|rule, cx| {
                let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
                rule.0.run_once(&ctx);
            });
        }
    }
}
