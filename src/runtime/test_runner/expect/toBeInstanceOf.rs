use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::Expect;
use super::get_signature;
use super::throw;

// Free fn (this module can't open `impl Expect`); bridged into `impl Expect` by the
// `__forward_matcher!` macro in expect.rs, where the JsClass codegen host_fn shim picks it up.
pub(crate) fn to_be_instance_of(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // Reshaped for borrowck (was `defer this.postMatch(globalThis)`).
    // Run the matcher body in an inner closure so `this` is released when it returns,
    // then call `post_match` exactly once on every exit path (success or throw).
    let res = (|| -> JsResult<JSValue> {
    let this_value = frame.this();
    let arguments: &[JSValue] = frame.arguments();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!(
            "toBeInstanceOf() requires 1 argument"
        )));
    }

    this.increment_expect_call_counter();
    let mut formatter = super::make_formatter(global);
    // `defer formatter.deinit()` → handled by Drop.

    let expected_value = arguments[0];
    if !expected_value.is_constructor() {
        return Err(global.throw(format_args!(
            "Expected value must be a function: {}",
            expected_value.to_fmt(&mut formatter),
        )));
    }
    expected_value.ensure_still_alive();

    let value: JSValue =
        this.get_value(global, this_value, "toBeInstanceOf", "<green>expected<r>")?;

    let not = this.flags.get().not();
    let mut pass = value.is_instance_of(global, expected_value)?;
    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    // Two live `to_fmt(&mut Formatter)` wrappers alias the same formatter under
    // borrowck — use a second Formatter for the second value (matches toBe.rs / toInclude.rs).
    let mut formatter2 = super::make_formatter(global);
    let expected_fmt = expected_value.to_fmt(&mut formatter);
    let value_fmt = value.to_fmt(&mut formatter2);
    if not {
        // `expected_line`/`received_line` are inlined here because Rust `concat!`
        // only accepts literals (and `format_args!` needs a literal anyway).
        let signature = get_signature("toBeInstanceOf", "<green>expected<r>", true);
        return throw!(
            this,
            global,
            signature,
            "\n\nExpected constructor: not <green>{}<r>\nReceived value: <red>{}<r>\n",
            expected_fmt, value_fmt,
        );
    }

    let signature = get_signature("toBeInstanceOf", "<green>expected<r>", false);
    throw!(
        this,
        global,
        signature,
        "\n\nExpected constructor: <green>{}<r>\nReceived value: <red>{}<r>\n",
        expected_fmt, value_fmt,
    )
    })();
    this.post_match(global);
    res
}

