use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult};
use bun_str as bstring;

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
        return global.throw_not_enough_arguments("printMyersDiff", 2, frame.arguments_count());
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
        return global.throw_invalid_argument_type_value("actual", "string", actual_arg);
    }
    if !expected_arg.is_string() {
        return global.throw_invalid_argument_type_value("expected", "string", expected_arg);
    }

    let actual_str = actual_arg.to_bun_string(global)?;
    // `defer actual_str.deref()` — handled by Drop on bun_str::String
    let expected_str = expected_arg.to_bun_string(global)?;
    // `defer expected_str.deref()` — handled by Drop on bun_str::String

    debug_assert!(actual_str.tag != bstring::Tag::Dead);
    debug_assert!(expected_str.tag != bstring::Tag::Dead);

    node_assert::myers_diff(
        // allocator param dropped (was arena-backed; non-AST crate uses global mimalloc)
        global,
        &actual_str,
        &expected_str,
        check_comma_disparity,
        lines,
    )
}

// TODO(port): `[]const u8` payload type for DiffList — exact Rust element type
// depends on DiffList port in assert/myers_diff.rs (likely Box<[u8]> or &'bump [u8]).
type StrDiffList = DiffList<Box<[u8]>>;

#[allow(dead_code)]
fn diff_list_to_js(global: &JSGlobalObject, diff_list: StrDiffList) -> JsResult<JSValue> {
    // todo: replace with toJS
    let array = JSValue::create_empty_array(global, diff_list.as_slice().len())?;
    for (i, line) in diff_list.as_slice().iter().enumerate() {
        let obj = JSValue::create_empty_object_with_null_prototype(global);
        if obj.is_empty() {
            return global.throw_out_of_memory();
        }
        obj.put(
            global,
            bstring::String::static_(b"kind"),
            JSValue::js_number(line.kind as u32),
        );
        obj.put(
            global,
            bstring::String::static_(b"value"),
            // TODO(port): JSValue.fromAny(global, []const u8, line.value) — generic
            // comptime-type dispatch; map to the concrete &[u8] → JSValue helper.
            JSValue::from_any(global, &line.value),
        );
        array.put_index(global, i as u32, obj);
    }
    Ok(array)
}

// =============================================================================

pub fn generate(global: &JSGlobalObject) -> JSValue {
    let exports = JSValue::create_empty_object(global, 1);

    exports.put(
        global,
        bstring::String::static_(b"myersDiff"),
        JSFunction::create(global, "myersDiff", myers_diff, 2, Default::default()),
    );

    exports
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_assert_binding.zig (85 lines)
//   confidence: medium
//   todos:      2
//   notes:      DiffList<T> element type & JSValue::from_any signature need confirmation in Phase B; bun.String.static mapped to String::static_ (keyword collision).
// ──────────────────────────────────────────────────────────────────────────
