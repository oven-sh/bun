//! `get-string-if-constant.mjs`

use super::get_static_value::get_static_value;
use crate::ast::Expr;
use crate::semantic::Scope;
use std::borrow::Cow;

/// eslint-utils' `getStringIfConstant`: `String(value)` of the static value of `expr`.
///
/// A regular expression is `/pattern/flags`, with the flags in the order of `regex.flags`. A
/// `bigint` is its decimal digits.
pub fn get_string_if_constant<'a>(
    expr: Expr<'a>,
    scope: Option<Scope<'a>>,
) -> Option<Cow<'a, [u8]>> {
    get_static_value(expr, scope)?.to_js_string()
}
