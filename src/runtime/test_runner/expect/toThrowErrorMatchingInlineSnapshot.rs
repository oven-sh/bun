use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_str::ZigString;

use super::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_throw_error_matching_inline_snapshot(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // Zig: `defer this.postMatch(globalThis);`
    // PORT NOTE: reshaped for borrowck — guard owns the &mut and Derefs to it.
    let mut this = scopeguard::guard(this, |t| t.post_match(global));

    let this_value = frame.this();
    let _arguments = frame.arguments_old(2);
    let arguments: &[JSValue] = _arguments.as_slice();

    this.increment_expect_call_counter();

    let not = this.flags.not;
    if not {
        let signature = Expect::get_signature("toThrowErrorMatchingInlineSnapshot", "", true);
        return this.throw(
            global,
            signature,
            format_args!("\n\n<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n"),
        );
    }

    let mut has_expected = false;
    let mut expected_string: ZigString = ZigString::EMPTY;
    match arguments.len() {
        0 => {}
        1 => {
            if arguments[0].is_string() {
                has_expected = true;
                // TODO(port): Zig uses out-param `toZigString(&expected_string, globalThis)`; reshaped to return value.
                expected_string = arguments[0].to_zig_string(global)?;
            } else {
                return this.throw(
                    global,
                    "",
                    format_args!("\n\nMatcher error: Expected first argument to be a string\n"),
                );
            }
        }
        _ => {
            return this.throw(
                global,
                "",
                format_args!("\n\nMatcher error: Expected zero or one arguments\n"),
            );
        }
    }

    // Zig: `expected_string.toSlice(default_allocator)` + `defer expected.deinit()`.
    // Allocator param dropped; the returned slice owns its buffer and frees on Drop.
    let expected = expected_string.to_slice();

    let expected_slice: Option<&[u8]> = if has_expected { Some(expected.slice()) } else { None };

    // PORT NOTE: reshaped for borrowck — hoist get_value out so the two &mut self
    // receivers don't overlap.
    let received = this.get_value(
        global,
        this_value,
        "toThrowErrorMatchingInlineSnapshot",
        "<green>properties<r><d>, <r>hint",
    )?;
    let Some(value) = this.fn_to_err_string_or_undefined(global, received)? else {
        let signature = Expect::get_signature("toThrowErrorMatchingInlineSnapshot", "", false);
        return this.throw(
            global,
            signature,
            format_args!("\n\n<b>Matcher error<r>: Received function did not throw\n"),
        );
    };

    this.inline_snapshot(
        global,
        frame,
        value,
        None,
        expected_slice,
        "toThrowErrorMatchingInlineSnapshot",
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toThrowErrorMatchingInlineSnapshot.zig (53 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match via scopeguard owning &mut Expect; throw() collapsed (fmt,args)→format_args!
// ──────────────────────────────────────────────────────────────────────────
