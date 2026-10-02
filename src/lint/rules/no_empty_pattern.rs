//! Ported from ESLint lib/rules/no-empty-pattern.js, with its default: an empty object pattern as a parameter is reported.

use bun_ast::{B, E, Loc};

use crate::context::Context;
use crate::rule::{Rule, RuleCategory};

static RULE: Rule = Rule {
    name: "no-empty-pattern",
    category: RuleCategory::Correctness,
};

/// The `ArrayPattern` handler for a binding, reported at its `[`. A hole is an item: `[,]` is not empty.
pub(crate) fn b_array(context: &mut Context<'_, '_>, node: &B::Array, loc: Loc) {
    if node.items.slice().is_empty() {
        context.report(&RULE, loc, b"Unexpected empty array pattern.");
    }
}

/// The `ObjectPattern` handler for a binding, reported at its `{`.
pub(crate) fn b_object(context: &mut Context<'_, '_>, node: &B::Object, loc: Loc) {
    if node.properties.slice().is_empty() {
        context.report(&RULE, loc, b"Unexpected empty object pattern.");
    }
}

/// The `ArrayPattern` handler for the target of an assignment, which Bun's tree writes as an array literal.
pub(crate) fn e_array(context: &mut Context<'_, '_>, node: &E::Array, loc: Loc) {
    if node.items.as_slice().is_empty() {
        context.report(&RULE, loc, b"Unexpected empty array pattern.");
    }
}

/// The `ObjectPattern` handler for the target of an assignment, which Bun's tree writes as an object literal.
pub(crate) fn e_object(context: &mut Context<'_, '_>, node: &E::Object, loc: Loc) {
    if node.properties.as_slice().is_empty() {
        context.report(&RULE, loc, b"Unexpected empty object pattern.");
    }
}
