use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_core::ZigString;

use super::Expect;
use super::get_signature;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_throw_error_matching_snapshot(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: Zig `defer this.postMatch(globalThis)` — guard runs post_match on Drop for every
    // exit path (early `return Err`, `?`, fall-through), matching Zig semantics.
    let this = this.post_match_guard(global);

    let this_value = frame.this();
    let _arguments = frame.arguments_old::<2>();
    let arguments: &[JSValue] = _arguments.slice();

    this.increment_expect_call_counter();

    let not = this.flags.get().not();
    if not {
        let signature = get_signature("toThrowErrorMatchingSnapshot", "", true);
        return this.throw_fmt(
            global,
            signature,
            "",
            format_args!("\n\n<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n"),
        );
    }

    let Some(bun_test_strong) = this.bun_test() else {
        let signature = get_signature("toThrowErrorMatchingSnapshot", "", true);
        return this.throw_fmt(
            global,
            signature,
            "",
            format_args!("\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n"),
        );
    };
    // Zig: `defer bunTest_strong.deinit();` — handled by Drop.
    let _ = &bun_test_strong;

    let mut hint_string: ZigString = ZigString::EMPTY;
    match arguments.len() {
        0 => {}
        1 => {
            if arguments[0].is_string() {
                arguments[0].to_zig_string(&mut hint_string, global)?;
            } else {
                return this.throw_fmt(
                    global,
                    "",
                    "",
                    format_args!("\n\nMatcher error: Expected first argument to be a string\n"),
                );
            }
        }
        _ => {
            return this.throw_fmt(
                global,
                "",
                "",
                format_args!("\n\nMatcher error: Expected zero or one arguments\n"),
            );
        }
    }

    let hint = hint_string.to_slice();
    // Zig: `defer hint.deinit();` — handled by Drop.

    let Some(value): Option<JSValue> = this.fn_to_err_string_or_undefined(
        global,
        this.get_value(
            global,
            this_value,
            "toThrowErrorMatchingSnapshot",
            "<green>properties<r><d>, <r>hint",
        )?,
    )?
    else {
        let signature = get_signature("toThrowErrorMatchingSnapshot", "", false);
        return this.throw_fmt(
            global,
            signature,
            "",
            format_args!("\n\n<b>Matcher error<r>: Received function did not throw\n"),
        );
    };

    this.snapshot(global, value, None, hint.slice(), "toThrowErrorMatchingSnapshot")
}

// ported from: src/test_runner/expect/toThrowErrorMatchingSnapshot.zig
