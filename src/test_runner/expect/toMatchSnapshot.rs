use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_str::ZigString;

use super::Expect;
use super::Expect::get_signature;

#[bun_jsc::host_fn(method)]
pub fn to_match_snapshot(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: reshaped for borrowck — `defer this.postMatch(globalThis)` is expressed by
    // wrapping `this` in a scopeguard so `post_match` runs on every exit path while we still
    // deref through the guard for the body.
    let mut this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = frame.this();
    let _arguments = frame.arguments_old(2);
    let arguments: &[JSValue] = &_arguments.ptr[0.._arguments.len];

    this.increment_expect_call_counter();

    let not = this.flags.not;
    if not {
        // PERF(port): was `comptime getSignature(...)` — requires `get_signature` be `const fn` in Phase B.
        let signature = const { get_signature("toMatchSnapshot", "", true) };
        return this.throw(
            global,
            signature,
            "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used with <b>not<r>\n",
            format_args!(""),
        );
    }

    let Some(buntest_strong) = this.bun_test() else {
        // PERF(port): was `comptime getSignature(...)` — requires `get_signature` be `const fn` in Phase B.
        let signature = const { get_signature("toMatchSnapshot", "", true) };
        return this.throw(
            global,
            signature,
            "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n",
            format_args!(""),
        );
    };
    let _ = buntest_strong; // Drop at scope exit replaces `defer buntest_strong.deinit()`.

    let mut hint_string: ZigString = ZigString::EMPTY;
    let mut property_matchers: Option<JSValue> = None;
    match arguments.len() {
        0 => {}
        1 => {
            if arguments[0].is_string() {
                arguments[0].to_zig_string(&mut hint_string, global)?;
            } else if arguments[0].is_object() {
                property_matchers = Some(arguments[0]);
            } else {
                return this.throw(
                    global,
                    "",
                    "\n\nMatcher error: Expected first argument to be a string or object\n",
                    format_args!(""),
                );
            }
        }
        _ => {
            if !arguments[0].is_object() {
                // PERF(port): was `comptime getSignature(...)` — requires `get_signature` be `const fn` in Phase B.
                let signature =
                    const { get_signature("toMatchSnapshot", "<green>properties<r><d>, <r>hint", false) };
                return this.throw(
                    global,
                    signature,
                    "\n\nMatcher error: Expected <green>properties<r> must be an object\n",
                    format_args!(""),
                );
            }

            property_matchers = Some(arguments[0]);

            if arguments[1].is_string() {
                arguments[1].to_zig_string(&mut hint_string, global)?;
            } else {
                return this.throw(
                    global,
                    "",
                    "\n\nMatcher error: Expected second argument to be a string\n",
                    format_args!(""),
                );
            }
        }
    }

    let hint = hint_string.to_slice();
    // `defer hint.deinit()` — Drop handles it.

    let value: JSValue = this.get_value(
        global,
        this_value,
        "toMatchSnapshot",
        "<green>properties<r><d>, <r>hint",
    )?;

    this.snapshot(global, value, property_matchers, hint.slice(), "toMatchSnapshot")
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toMatchSnapshot.zig (68 lines)
//   confidence: medium
//   todos:      0
//   notes:      `defer this.postMatch` expressed via scopeguard wrapping `&mut Expect`; `get_signature` assumed const-evaluable in Phase B; `frame.arguments_old(2)` shape (ptr/len) may need adjustment.
// ──────────────────────────────────────────────────────────────────────────
