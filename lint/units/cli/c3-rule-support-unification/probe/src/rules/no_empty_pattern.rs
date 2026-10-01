//! ESLint: lib/rules/no-empty-pattern.js
use crate::context::Context;
use bun_ast::{B, E, Loc};

const NAME: &str = "no-empty-pattern";

pub(crate) fn b_object(cx: &mut Context<'_, '_>, node: &B::Object, loc: Loc) {
    if node.properties.slice().is_empty() {
        cx.report(NAME, loc, format_args!("Unexpected empty object pattern."));
    }
}

pub(crate) fn b_array(cx: &mut Context<'_, '_>, node: &B::Array, loc: Loc) {
    if node.items.is_empty() {
        cx.report(NAME, loc, format_args!("Unexpected empty array pattern."));
    }
}

pub(crate) fn e_object(cx: &mut Context<'_, '_>, node: &E::Object, loc: Loc, is_target: bool) {
    if is_target && node.properties.is_empty() {
        cx.report(NAME, loc, format_args!("Unexpected empty object pattern."));
    }
}

pub(crate) fn e_array(cx: &mut Context<'_, '_>, node: &E::Array, loc: Loc, is_target: bool) {
    if is_target && node.items.is_empty() {
        cx.report(NAME, loc, format_args!("Unexpected empty array pattern."));
    }
}
