use crate::jest::Ctx;
use crate::jest_hooks::require_hook::RequireHookConfig;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule flags any expression that is either at the toplevel of a test file or directly within the body of a `describe`,
/// _except_ for the following
pub struct RequireHook(RequireHookConfig);

impl Rule for RequireHook {
    const META: Meta = Meta::oxlint(Plugin::Jest, "require-hook", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        RequireHook(RequireHookConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (file.has_exprs([ExprTag::Call]) || file.has_stmts([StmtTag::Var])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), report: &|at, message| cx.report(at, message) };
        self.0.run_once(&ctx);
    }
}
