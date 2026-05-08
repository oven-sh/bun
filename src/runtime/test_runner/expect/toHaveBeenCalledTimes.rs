use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;
use super::Expect;
use super::get_signature;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_have_been_called_times(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // jsc.markBinding(@src()) — debug-only tracing; dropped in port.

    // `defer this.postMatch(globalThis)` — RAII guard owns the `&mut Expect` borrow and
    // runs post_match on drop for every exit path.
    let mut this = this.post_match_guard(global);

    let this_value = frame.this();
    let arguments_ = frame.arguments_old::<1>();
    let arguments: &[JSValue] = arguments_.slice();
    let value: JSValue =
        this.get_value(global, this_value, "toHaveBeenCalledTimes", "<green>expected<r>")?;

    this.increment_expect_call_counter();

    let calls = super::mock::JSMockFunction__getCalls(global, value)?;
    if !calls.js_type().is_array() {
        let mut formatter = super::make_formatter(global);
        // `defer formatter.deinit()` — handled by Drop.
        return Err(global.throw(format_args!(
            "Expected value must be a mock function: {}",
            value.to_fmt(&mut formatter)
        )));
    }

    if arguments.len() < 1 || !arguments[0].is_uint32_as_any_int() {
        return Err(global.throw_invalid_arguments(format_args!(
            "toHaveBeenCalledTimes() requires 1 non-negative integer argument"
        )));
    }

    let times = arguments[0].coerce::<i32>(global)?;

    let mut pass = i32::try_from(calls.get_length(global)?).unwrap() == times;

    let not = this.flags.not();
    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    if not {
        let signature: &str = get_signature("toHaveBeenCalledTimes", "<green>expected<r>", true);
        return this.throw_fmt(
            global,
            signature,
            concat!(
                "\n\n",
                "Expected number of calls: not <green>{d}<r>\n",
                "Received number of calls: <red>{d}<r>\n"
            ),
            format_args!("{}, {}", times, calls.get_length(global)?),
        );
        // TODO(port): Expect.throw signature — Zig passes (fmt_literal, args_tuple); Rust side
        // likely wants a single format_args!. Reconcile in Phase B.
    }

    let signature: &str = get_signature("toHaveBeenCalledTimes", "<green>expected<r>", false);
    this.throw_fmt(
        global,
        signature,
        concat!(
            "\n\n",
            "Expected number of calls: <green>{d}<r>\n",
            "Received number of calls: <red>{d}<r>\n"
        ),
        format_args!("{}, {}", times, calls.get_length(global)?),
    )
}

// ported from: src/test_runner/expect/toHaveBeenCalledTimes.zig
