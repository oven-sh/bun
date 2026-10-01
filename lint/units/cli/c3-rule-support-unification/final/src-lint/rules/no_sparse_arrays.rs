//! Ported from ESLint lib/rules/no-sparse-arrays.js.

use bun_ast::{E, ExprData};

use crate::context::Context;
use crate::rule::{Rule, RuleCategory};

static RULE: Rule = Rule {
    name: "no-sparse-arrays",
    category: RuleCategory::Correctness,
};

/// `node` is an array literal, not a pattern. A hole is at the comma that follows it.
pub(crate) fn e_array(context: &mut Context<'_, '_>, node: &E::Array) {
    for item in node.items.as_slice() {
        if matches!(item.data, ExprData::EMissing(_)) {
            context.report(&RULE, item.loc, b"Unexpected comma in middle of array.");
        }
    }
}
