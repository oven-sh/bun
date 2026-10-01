//! Ported from ESLint lib/rules/no-sparse-arrays.js.

use bun_ast::{E, ExprData};

use crate::context::Context;
use crate::rule::{Rule, RuleCategory};

static RULE: Rule = Rule {
    name: "no-sparse-arrays",
    category: RuleCategory::Correctness,
};

/// The `ArrayExpression` handler, for an array literal that is no pattern. The `loc` of a hole is the comma that ends it: ESLint's `commaToken`.
pub(crate) fn e_array(context: &mut Context<'_, '_>, node: &E::Array) {
    for item in node.items.as_slice() {
        if matches!(item.data, ExprData::EMissing(_)) {
            context.report(&RULE, item.loc, b"Unexpected comma in middle of array.");
        }
    }
}
