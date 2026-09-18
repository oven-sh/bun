use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::Expect;
use super::get_signature;
use super::throw;

// Free fn (this module can't open `impl Expect`); bridged into `impl Expect` by the
// `__forward_matcher!` macro in expect.rs, where the JsClass codegen host_fn shim picks it up.
pub(crate) fn to_be_array_of_size(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // scopeguard::defer! would hold &mut *this for the whole fn, so use the
    // post-match guard instead.
    let this = this.post_match_guard(global);

    let this_value = frame.this();
    let arguments = frame.arguments();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!("toBeArrayOfSize() requires 1 argument")));
    }

    let value: JSValue = this.get_value(global, this_value, "toBeArrayOfSize", "")?;

    let size = arguments[0];
    size.ensure_still_alive();

    if !size.is_any_int() {
        return Err(global.throw(format_args!("toBeArrayOfSize() requires the first argument to be a number")));
    }

    this.increment_expect_call_counter();

    let not = this.flags.get().not();
    let mut pass = value.js_type().is_array()
        && value.get_length(global)? as i64 == size.to_int64();

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    let mut formatter = super::make_formatter(global);
    let received = value.to_fmt(&mut formatter);

    if not {
        let signature = get_signature("toBeArrayOfSize", "", true);
        return throw!(
            this,
            global,
            signature,
            concat!("\n\n", "Received: <red>{}<r>\n"),
            received,
        );
    }

    let signature = get_signature("toBeArrayOfSize", "", false);
    throw!(
        this,
        global,
        signature,
        concat!("\n\n", "Received: <red>{}<r>\n"),
        received,
    )
}

