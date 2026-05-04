use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
use bun_test_runner::expect::Expect;
use bun_test_runner::expect::get_signature;

#[bun_jsc::host_fn(method)]
pub fn to_have_been_called_once(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();

    let this_value = frame.this();
    // PORT NOTE: reshaped for borrowck — `defer this.postMatch(globalThis)` becomes a scopeguard
    // that owns the &mut Expect for the rest of the body.
    let mut this = scopeguard::guard(this, |this| this.post_match(global));
    let value: JSValue =
        this.get_value(global, this_value, "toHaveBeenCalledOnce", "<green>expected<r>")?;

    this.increment_expect_call_counter();

    // TODO(port): bun.cpp.* FFI shim location — assuming bun_jsc::cpp re-exports generated bindings
    let calls = bun_jsc::cpp::JSMockFunction__getCalls(global, value)?;
    if !calls.js_type().is_array() {
        let mut formatter = Formatter {
            global,
            quote_strings: true,
            ..Default::default()
        };
        return global.throw(format_args!(
            "Expected value must be a mock function: {}",
            value.to_fmt(&mut formatter),
        ));
    }

    let calls_length = calls.get_length(global)?;
    let mut pass = calls_length == 1;

    let not = this.flags.not;
    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    if not {
        let signature = get_signature("toHaveBeenCalledOnce", "<green>expected<r>", true);
        return this.throw(
            global,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected number of calls: not <green>1<r>\n",
                    "Received number of calls: <red>{}<r>\n",
                ),
                calls_length,
            ),
        );
    }

    let signature = get_signature("toHaveBeenCalledOnce", "<green>expected<r>", false);
    this.throw(
        global,
        signature,
        format_args!(
            concat!(
                "\n\n",
                "Expected number of calls: <green>1<r>\n",
                "Received number of calls: <red>{}<r>\n",
            ),
            calls_length,
        ),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toHaveBeenCalledOnce.zig (42 lines)
//   confidence: medium
//   todos:      1
//   notes:      scopeguard owns &mut Expect for post_match defer; bun.cpp FFI path guessed
// ──────────────────────────────────────────────────────────────────────────
