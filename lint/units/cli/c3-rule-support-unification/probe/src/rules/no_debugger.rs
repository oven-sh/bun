//! ESLint: lib/rules/no-debugger.js
use crate::context::Context;
use bun_ast::Loc;

const NAME: &str = "no-debugger";

pub(crate) fn s_debugger(cx: &mut Context<'_, '_>, loc: Loc) {
    cx.report(NAME, loc, format_args!("Unexpected 'debugger' statement."));
}
