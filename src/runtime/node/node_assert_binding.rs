use bun_core as bstring;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult};

use super::node_assert;

/// ```ts
/// const enum DiffType {
///     Insert = 0,
///     Delete = 1,
///     Equal  = 2,
/// }
/// type Diff = { operation: DiffType, text: string };
/// declare function myersDiff(actual: string, expected: string): Diff[];
/// ```
#[bun_jsc::host_fn]
fn myers_diff(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let check_comma_disparity = frame.argument(2).is_truthy();
    let lines = frame.argument(3).is_truthy();
    run(
        global,
        frame,
        "myersDiff",
        check_comma_disparity,
        lines,
        node_assert::Output::List,
    )
}

/// `printSimpleMyersDiff(actual, expected, colors)`: char diff rendered to a string.
#[bun_jsc::host_fn]
fn print_simple_myers_diff(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let colors = colors_from_js(global, frame.argument(2))?;
    run(
        global,
        frame,
        "printSimpleMyersDiff",
        false,
        false,
        node_assert::Output::Simple(&colors),
    )
}

/// `printMyersDiff(actual, expected, checkCommaDisparity, colors)`: line diff rendered to
/// `{ message, skipped }`.
#[bun_jsc::host_fn]
fn print_myers_diff(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let check_comma_disparity = frame.argument(2).is_truthy();
    let colors = colors_from_js(global, frame.argument(3))?;
    run(
        global,
        frame,
        "printMyersDiff",
        check_comma_disparity,
        true,
        node_assert::Output::Lines(&colors),
    )
}

/// Reads `{ green, red, white, blue }` (internal/util/colors) as ASCII escape sequences.
fn colors_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<node_assert::Colors> {
    let get = |name: &'static str| -> JsResult<Vec<u8>> {
        if !value.is_object() {
            return Ok(Vec::new());
        }
        let Some(v) = value.get(global, name)? else {
            return Ok(Vec::new());
        };
        if !v.is_string() {
            return Ok(Vec::new());
        }
        let s = bstring::OwnedString::new(v.to_bun_string(global)?);
        Ok(s.to_utf8_without_ref().slice().to_vec())
    };
    Ok(node_assert::Colors {
        green: get("green")?,
        red: get("red")?,
        white: get("white")?,
        blue: get("blue")?,
    })
}

fn run(
    global: &JSGlobalObject,
    frame: &CallFrame,
    name: &'static str,
    check_comma_disparity: bool,
    lines: bool,
    output: node_assert::Output<'_>,
) -> JsResult<JSValue> {
    let nargs = frame.arguments_count();
    if nargs < 2 {
        return Err(global.throw_not_enough_arguments(name, 2, nargs as usize));
    }

    let actual_arg: JSValue = frame.argument(0);
    let expected_arg: JSValue = frame.argument(1);

    if !actual_arg.is_string() {
        return Err(global.throw_invalid_argument_type_value("actual", "string", actual_arg));
    }
    if !expected_arg.is_string() {
        return Err(global.throw_invalid_argument_type_value("expected", "string", expected_arg));
    }

    // `defer .deref()` — `bun_core::String` is `Copy` (no `Drop`), so wrap in
    // `OwnedString` for the scope-exit ref-drop.
    let actual_str = bstring::OwnedString::new(actual_arg.to_bun_string(global)?);
    let expected_str = bstring::OwnedString::new(expected_arg.to_bun_string(global)?);

    debug_assert!(actual_str.tag() != bstring::Tag::Dead);
    debug_assert!(expected_str.tag() != bstring::Tag::Dead);

    node_assert::myers_diff(
        global,
        &actual_str,
        &expected_str,
        check_comma_disparity,
        lines,
        output,
    )
}

// =============================================================================

pub(crate) fn generate(global: &JSGlobalObject) -> JSValue {
    let exports = JSValue::create_empty_object(global, 3);

    exports.put(
        global,
        bstring::String::static_(b"myersDiff"),
        JSFunction::create(
            global,
            "myersDiff",
            __jsc_host_myers_diff,
            2,
            Default::default(),
        ),
    );
    exports.put(
        global,
        bstring::String::static_(b"printSimpleMyersDiff"),
        JSFunction::create(
            global,
            "printSimpleMyersDiff",
            __jsc_host_print_simple_myers_diff,
            3,
            Default::default(),
        ),
    );
    exports.put(
        global,
        bstring::String::static_(b"printMyersDiff"),
        JSFunction::create(
            global,
            "printMyersDiff",
            __jsc_host_print_myers_diff,
            4,
            Default::default(),
        ),
    );

    exports
}
