use bun_core as bstring;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult};

use super::assert::myers_diff::DiffList;
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
pub fn myers_diff(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // PERF(port): was stack-fallback (2KB) + ArenaAllocator bulk-free — profile in Phase B

    let nargs = frame.arguments_count();
    if nargs < 2 {
        return Err(global.throw_not_enough_arguments("printMyersDiff", 2, nargs as usize));
    }

    let actual_arg: JSValue = frame.argument(0);
    let expected_arg: JSValue = frame.argument(1);
    let (check_comma_disparity, lines): (bool, bool) = match nargs {
        0 | 1 => unreachable!(),
        2 => (false, false),
        3 => (frame.argument(2).is_truthy(), false),
        _ => (frame.argument(2).is_truthy(), frame.argument(3).is_truthy()),
    };

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
        // allocator param dropped (was arena-backed; non-AST crate uses global mimalloc)
        global,
        &actual_str,
        &expected_str,
        check_comma_disparity,
        lines,
    )
}

type StrDiffList<'a> = DiffList<&'a [u8]>;

#[allow(dead_code)]
fn diff_list_to_js(global: &JSGlobalObject, diff_list: StrDiffList<'_>) -> JsResult<JSValue> {
    // todo: replace with toJS
    JSValue::create_array_from_iter(global, diff_list.iter(), |line| {
        let obj = JSValue::create_empty_object_with_null_prototype(global);
        if obj.is_empty() {
            return Err(global.throw_out_of_memory());
        }
        obj.put(
            global,
            bstring::String::static_(b"kind"),
            JSValue::js_number(line.kind as u32 as f64),
        );
        obj.put(
            global,
            bstring::String::static_(b"value"),
            JSValue::from_any(global, line.value)?,
        );
        Ok(obj)
    })
}

// =============================================================================

pub fn generate(global: &JSGlobalObject) -> JSValue {
    let exports = JSValue::create_empty_object(global, 1);

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

    exports
}

// ported from: src/runtime/node/node_assert_binding.zig
