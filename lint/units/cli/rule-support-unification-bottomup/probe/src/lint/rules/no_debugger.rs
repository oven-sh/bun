//! Ported from ESLint lib/rules/no-debugger.js.

use bun_ast::Loc;

use crate::lint::context::Context;
use crate::lint::rule::{Category, Rule};

static RULE: Rule = Rule {
    name: "no-debugger",
    category: Category::Correctness,
};

pub(crate) fn s_debugger(context: &mut Context<'_, '_>, loc: Loc) {
    let Ok(start) = u32::try_from(loc.start) else {
        return;
    };
    context.report(
        &RULE,
        start,
        8,
        b"Unexpected 'debugger' statement.".to_vec(),
    );
}
