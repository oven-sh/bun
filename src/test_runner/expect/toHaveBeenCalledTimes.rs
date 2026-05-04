use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;
use bun_test_runner::expect::Expect;
use bun_test_runner::expect::get_signature;

#[bun_jsc::host_fn(method)]
pub fn to_have_been_called_times(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // jsc.markBinding(@src()) — debug-only tracing; dropped in port.

    let this_value = frame.this();
    let arguments_ = frame.arguments_old(1);
    let arguments: &[JSValue] = arguments_.slice();
    // TODO(port): `defer this.postMatch(globalThis)` — scopeguard here would hold &mut self
    // for the whole body and conflict with later uses. Phase B: reshape (RAII guard on Expect
    // or call post_match before each return).
    let _post_match = scopeguard::guard((), |_| {
        // this.post_match(global);
    });
    let value: JSValue =
        this.get_value(global, this_value, "toHaveBeenCalledTimes", "<green>expected<r>")?;

    this.increment_expect_call_counter();

    let calls = bun_jsc::cpp::JSMockFunction__getCalls(global, value)?;
    if !calls.js_type().is_array() {
        let mut formatter = Formatter {
            global,
            quote_strings: true,
            ..Default::default()
        };
        // `defer formatter.deinit()` — handled by Drop.
        return global.throw(format_args!(
            "Expected value must be a mock function: {}",
            value.to_fmt(&mut formatter)
        ));
    }

    if arguments.len() < 1 || !arguments[0].is_uint32_as_any_int() {
        return global.throw_invalid_arguments(format_args!(
            "toHaveBeenCalledTimes() requires 1 non-negative integer argument"
        ));
    }

    let times = arguments[0].coerce::<i32>(global)?;

    let mut pass = i32::try_from(calls.get_length(global)?).unwrap() == times;

    let not = this.flags.not;
    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    if not {
        const SIGNATURE: &str = get_signature("toHaveBeenCalledTimes", "<green>expected<r>", true);
        return this.throw(
            global,
            SIGNATURE,
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

    const SIGNATURE: &str = get_signature("toHaveBeenCalledTimes", "<green>expected<r>", false);
    this.throw(
        global,
        SIGNATURE,
        concat!(
            "\n\n",
            "Expected number of calls: <green>{d}<r>\n",
            "Received number of calls: <red>{d}<r>\n"
        ),
        format_args!("{}, {}", times, calls.get_length(global)?),
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toHaveBeenCalledTimes.zig (49 lines)
//   confidence: medium
//   todos:      2
//   notes:      defer post_match needs borrowck reshape; Expect.throw fmt-args shape TBD
// ──────────────────────────────────────────────────────────────────────────
