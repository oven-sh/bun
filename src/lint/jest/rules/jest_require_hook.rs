use crate::jest::{self, Ctx};
use crate::jest_hooks::require_hook::RequireHookConfig;
use bun_lint::prelude::*;

/// This rule flags any expression that is either at the toplevel of a test file or directly within the body of a `describe`,
/// _except_ for the following
pub struct RequireHook<const VITEST: bool = false>(RequireHookConfig);

impl<const VITEST: bool> Rule for RequireHook<VITEST> {
    const META: Meta = Meta::oxlint(jest::plugin(VITEST), "require-hook", Kind::Suggestion);
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
