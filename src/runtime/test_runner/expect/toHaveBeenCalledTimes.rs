use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;
use super::Expect;
use super::get_signature;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_have_been_called_times(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arguments_ = frame.arguments_old::<1>();
    let arguments: &[JSValue] = arguments_.slice();
    let (this, calls, _value) = this.mock_prologue(
        global,
        frame.this(),
        "toHaveBeenCalledTimes",
        "<green>expected<r>",
        super::mock::MockKind::Calls,
    )?;

    if arguments.len() < 1 || !arguments[0].is_uint32_as_any_int() {
        return Err(global.throw_invalid_arguments(format_args!(
            "toHaveBeenCalledTimes() requires 1 non-negative integer argument"
        )));
    }

    let times = arguments[0].coerce::<i32>(global)?;

    let mut pass = i32::try_from(calls.get_length(global)?).unwrap() == times;

    let not = this.flags.get().not();
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
