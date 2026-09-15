use bun_core as bstring;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult};

use super::node_assert;

/// ```ts
/// const enum DiffType {
///     Insert = 0,
///     Delete = 1,
///     Equal  = 2,
/// }
/// // `value` is a line, or a char code when `lines` is false.
/// type Diff = { kind: DiffType, value: string | number };
/// declare function myersDiff(
///     actual: string,
///     expected: string,
///     checkCommaDisparity?: boolean,
///     lines?: boolean,
/// ): Diff[];
/// ```
#[bun_jsc::host_fn]
fn myers_diff(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let output = node_assert::Output::List {
        check_comma_disparity: frame.argument(2).is_truthy(),
        lines: frame.argument(3).is_truthy(),
    };
    run(global, frame, "myersDiff", &output)
}

/// `printSimpleMyersDiff(actual, expected, colors)`: char diff rendered to a string.
#[bun_jsc::host_fn]
fn print_simple_myers_diff(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let colors = colors_from_js(global, frame.argument(2))?;
    run(
        global,
        frame,
        "printSimpleMyersDiff",
        &node_assert::Output::Simple(&colors),
    )
}

/// `printMyersDiff(actual, expected, checkCommaDisparity, colors)`: line diff rendered to
/// `{ message, skipped }`.
#[bun_jsc::host_fn]
fn print_myers_diff(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let check_comma_disparity = frame.argument(2).is_truthy();
    let colors = colors_from_js(global, frame.argument(3))?;
    let output = node_assert::Output::Lines {
        colors: &colors,
        check_comma_disparity,
    };
    run(global, frame, "printMyersDiff", &output)
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
        Ok(v.to_bun_string(global)?.to_owned_slice())
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
    output: &node_assert::Output<'_>,
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

    let actual_str = actual_arg.to_bun_string(global)?;
    let expected_str = expected_arg.to_bun_string(global)?;

    debug_assert!(actual_str.tag() != bstring::Tag::Dead);
    debug_assert!(expected_str.tag() != bstring::Tag::Dead);

    node_assert::myers_diff(global, &actual_str, &expected_str, output)
}

// =============================================================================

pub(crate) fn generate(global: &JSGlobalObject) -> JSValue {
    let exports = JSValue::create_empty_object(global, 3);

    exports.put(
        global,
        b"myersDiff",
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
        b"printSimpleMyersDiff",
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
        b"printMyersDiff",
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
