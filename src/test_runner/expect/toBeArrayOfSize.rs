use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
use bun_jsc::expect::Expect;
use bun_jsc::expect::Expect::get_signature;

#[bun_jsc::host_fn(method)]
pub fn to_be_array_of_size(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // Zig: `defer this.postMatch(globalThis);`
    // PORT NOTE: reshaped for borrowck — scopeguard::defer! would hold &mut *this for the whole fn.
    // TODO(port): ensure post_match runs on every early return (RAII guard on Expect).

    let this_value = frame.this_value();
    let _arguments = frame.arguments_old(1);
    let arguments = &_arguments.ptr[0.._arguments.len];

    if arguments.len() < 1 {
        return global.throw_invalid_arguments("toBeArrayOfSize() requires 1 argument", format_args!(""));
    }

    let value: JSValue = this.get_value(global, this_value, "toBeArrayOfSize", "")?;

    let size = arguments[0];
    size.ensure_still_alive();

    if !size.is_any_int() {
        return global.throw("toBeArrayOfSize() requires the first argument to be a number", format_args!(""));
    }

    this.increment_expect_call_counter();

    let not = this.flags.not;
    let mut pass = value.js_type().is_array()
        && i32::try_from(value.get_length(global)?).unwrap() == size.to_int32();

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    let mut formatter = Formatter {
        global_this: global,
        quote_strings: true,
        ..Default::default()
    };
    // Zig: `defer formatter.deinit();` — handled by Drop.
    let received = value.to_fmt(&mut formatter);

    if not {
        // PERF(port): was comptime getSignature — profile in Phase B
        let signature = get_signature("toBeArrayOfSize", "", true);
        return this.throw(
            global,
            signature,
            concat!("\n\n", "Received: <red>{}<r>\n"),
            format_args!("{}", received),
        );
    }

    // PERF(port): was comptime getSignature — profile in Phase B
    let signature = get_signature("toBeArrayOfSize", "", false);
    this.throw(
        global,
        signature,
        concat!("\n\n", "Received: <red>{}<r>\n"),
        format_args!("{}", received),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeArrayOfSize.zig (50 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer post_match needs borrowck-safe RAII guard; throw/format_args plumbing TBD in Phase B
// ──────────────────────────────────────────────────────────────────────────
