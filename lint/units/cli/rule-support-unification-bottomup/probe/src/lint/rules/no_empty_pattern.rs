//! Ported from ESLint lib/rules/no-empty-pattern.js.

use bun_ast::{B, E, Loc};

use crate::lint::context::Context;
use crate::lint::rule::{Category, Rule};

static RULE: Rule = Rule {
    name: "no-empty-pattern",
    category: Category::Correctness,
};

fn report(context: &mut Context<'_, '_>, loc: Loc, text: &'static [u8]) {
    if let Ok(start) = u32::try_from(loc.start) {
        context.report(&RULE, start, 1, text.to_vec());
    }
}

pub(crate) fn b_array(context: &mut Context<'_, '_>, node: &B::Array, loc: Loc) {
    if node.items.slice().is_empty() {
        report(context, loc, b"Unexpected empty array pattern.");
    }
}

pub(crate) fn b_object(context: &mut Context<'_, '_>, node: &B::Object, loc: Loc) {
    if node.properties.slice().is_empty() {
        report(context, loc, b"Unexpected empty object pattern.");
    }
}

/// `node` is the target of an assignment.
pub(crate) fn e_array(context: &mut Context<'_, '_>, node: &E::Array, loc: Loc) {
    if node.items.as_slice().is_empty() {
        report(context, loc, b"Unexpected empty array pattern.");
    }
}

/// `node` is the target of an assignment.
pub(crate) fn e_object(context: &mut Context<'_, '_>, node: &E::Object, loc: Loc) {
    if node.properties.as_slice().is_empty() {
        report(context, loc, b"Unexpected empty object pattern.");
    }
}
