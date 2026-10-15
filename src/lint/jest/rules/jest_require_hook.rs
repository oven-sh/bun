use crate::jest::{self, Ctx, Runner};
use crate::jest_hooks::require_hook::RequireHookConfig;
use bun_lint::prelude::*;

/// This rule flags any expression that is either at the toplevel of a test file or directly within the body of a `describe`,
/// _except_ for the following
pub struct RequireHook<const RUNNER: u8 = { jest::JEST }>(RequireHookConfig);

impl<const RUNNER: u8> Rule for RequireHook<RUNNER> {
    const META: Meta = jest::meta(RUNNER, "require-hook", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        RequireHook(RequireHookConfig::new(options))
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (jest::is_for(file, RUNNER) && (file.has_exprs([ExprTag::Call]) || file.has_stmts([StmtTag::Var]))).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let ctx = Ctx { file: cx.file(), runner: Runner::of(RUNNER), report: &|at, message| cx.report(at, message) };
        self.0.run_once(&ctx);
    }
}
