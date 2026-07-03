use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use super::Expect;
use super::get_signature;
use super::ready_or_defer;

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

    let _arguments = frame.arguments_old::<1>();
    let arguments = &_arguments.ptr[0.._arguments.len];

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!("toBeArrayOfSize() requires 1 argument")));
    }

    // Argument validation stays ahead of `get_value`: a `Deferred` result has already
    // registered a pending deferral, so nothing fallible may sit between it and its unwrap.
    let size = arguments[0];
    size.ensure_still_alive();

    if !size.is_any_int() {
        return Err(global.throw(format_args!("toBeArrayOfSize() requires the first argument to be a number")));
    }

    this.increment_expect_call_counter();
    let value = ready_or_defer!(this.get_value(global, frame, "toBeArrayOfSize", "")?);

    let not = this.flags.get().not();
    let mut pass = value.js_type().is_array()
        && i32::try_from(value.get_length(global)?).unwrap() == size.to_int32();

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
        return this.throw_fmt(
            global,
            signature,
            concat!("\n\n", "Received: <red>{}<r>\n"),
            format_args!("{}", received),
        );
    }

    let signature = get_signature("toBeArrayOfSize", "", false);
    this.throw_fmt(
        global,
        signature,
        concat!("\n\n", "Received: <red>{}<r>\n"),
        format_args!("{}", received),
    )
}

