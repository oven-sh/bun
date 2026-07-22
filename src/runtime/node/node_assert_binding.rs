use bun_core as bstring;
use bun_jsc::{CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult, Local, Scope};

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
#[bun_jsc::host_fn(scoped)]
pub(crate) fn myers_diff<'s>(scope: &mut Scope<'s>, frame: &CallFrame) -> JsResult<Local<'s>> {
    let nargs = frame.arguments_count();
    if nargs < 2 {
        return Err(scope.throw_not_enough_arguments("printMyersDiff", 2, nargs as usize));
    }

    let actual_arg = frame.scoped_argument(scope, 0);
    let expected_arg = frame.scoped_argument(scope, 1);
    let (check_comma_disparity, lines): (bool, bool) = match nargs {
        0 | 1 => unreachable!(),
        2 => (false, false),
        3 => (frame.scoped_argument(scope, 2).to_boolean(), false),
        _ => (
            frame.scoped_argument(scope, 2).to_boolean(),
            frame.scoped_argument(scope, 3).to_boolean(),
        ),
    };

    if !actual_arg.is_string() {
        return Err(scope.throw_invalid_argument_type_value("actual", "string", actual_arg));
    }
    if !expected_arg.is_string() {
        return Err(scope.throw_invalid_argument_type_value("expected", "string", expected_arg));
    }

    // `defer .deref()` — `bun_core::String` is `Copy` (no `Drop`), so wrap in
    // `OwnedString` for the scope-exit ref-drop.
    let actual_str = bstring::OwnedString::new(actual_arg.to_bun_string(scope)?);
    let expected_str = bstring::OwnedString::new(expected_arg.to_bun_string(scope)?);

    debug_assert!(actual_str.tag() != bstring::Tag::Dead);
    debug_assert!(expected_str.tag() != bstring::Tag::Dead);

    let v = node_assert::myers_diff(
        // allocator param dropped (was arena-backed; non-AST crate uses global mimalloc)
        scope.unscoped_global(),
        &actual_str,
        &expected_str,
        check_comma_disparity,
        lines,
    )?;
    Ok(scope.local(v))
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
