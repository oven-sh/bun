use bun_core::String as BunString;
use bun_jsc::bindgen::JsScope;
use bun_jsc::{JSValue, JsResult};

use super::node_assert;
use crate::generated_bindgen::node_assert_binding::Colors;

/// ```ts
/// const enum DiffType {
///     Insert = 0,
///     Delete = 1,
///     Equal  = 2,
/// }
/// // `value` is a line, or a char code when `lines` is false.
/// type Diff = { kind: DiffType, value: string | number };
/// ```
pub(crate) fn myers_diff(
    cx: &mut JsScope<'_>,
    actual: &BunString,
    expected: &BunString,
    check_comma_disparity: bool,
    lines: bool,
) -> JsResult<JSValue> {
    let output = node_assert::Output::List {
        check_comma_disparity,
        lines,
    };
    node_assert::myers_diff(cx.global(), actual, expected, &output)
}

pub(crate) fn print_simple_myers_diff(
    cx: &mut JsScope<'_>,
    actual: &BunString,
    expected: &BunString,
    colors: &Colors<'_>,
) -> JsResult<JSValue> {
    let output = node_assert::Output::Simple(colors);
    node_assert::myers_diff(cx.global(), actual, expected, &output)
}

/// Returns `{ message, skipped }`.
pub(crate) fn print_myers_diff(
    cx: &mut JsScope<'_>,
    actual: &BunString,
    expected: &BunString,
    check_comma_disparity: bool,
    colors: &Colors<'_>,
) -> JsResult<JSValue> {
    let output = node_assert::Output::Lines {
        colors,
        check_comma_disparity,
    };
    node_assert::myers_diff(cx.global(), actual, expected, &output)
}
