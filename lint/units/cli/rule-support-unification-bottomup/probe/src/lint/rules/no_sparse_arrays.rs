//! Ported from ESLint lib/rules/no-sparse-arrays.js.

use bun_ast::{E, ExprData};

use crate::lint::context::Context;
use crate::lint::rule::{Category, Rule};

static RULE: Rule = Rule {
    name: "no-sparse-arrays",
    category: Category::Correctness,
};

/// `node` is an array literal, not a pattern. A hole is at the comma that follows it.
pub(crate) fn e_array(context: &mut Context<'_, '_>, node: &E::Array) {
    for item in node.items.as_slice() {
        if let (ExprData::EMissing(_), Ok(comma)) = (&item.data, u32::try_from(item.loc.start)) {
            context.report(
                &RULE,
                comma,
                1,
                b"Unexpected comma in middle of array.".to_vec(),
            );
        }
    }
}
