use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;
use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_have_been_called(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    let this_value = frame.this();
    let first_argument = frame.arguments_as_array::<1>()[0];
    // Zig: `defer this.postMatch(globalThis);`
    // PORT NOTE: reshaped for borrowck — wrap `this` in a scopeguard and re-borrow through
    // the guard's DerefMut so post_match runs at every exit without a raw-pointer alias.
    let mut this = scopeguard::guard(this, |t| t.post_match(global));
    let this: &mut Expect = &mut *this;

    if !first_argument.is_undefined() {
        return Err(global.throw_invalid_arguments(format_args!(
            "toHaveBeenCalled() must not have an argument"
        )));
    }

    let value: JSValue = this.get_value(global, this_value, "toHaveBeenCalled", "")?;

    // TODO(port): verify crate path for `bun.cpp.JSMockFunction__getCalls` extern binding
    let calls = super::mock::JSMockFunction__getCalls(global, value)?;
    this.increment_expect_call_counter();
    if !calls.js_type().is_array() {
        let mut formatter = super::make_formatter(global);
        // `defer formatter.deinit()` → Drop
        return Err(global.throw(format_args!(
            "Expected value must be a mock function: {}",
            value.to_fmt(&mut formatter)
        )));
    }

    let calls_length = calls.get_length(global)?;
    let mut pass = calls_length > 0;

    let not = this.flags.not();
    if not {
        pass = !pass;
    }
    if pass {
        return Ok(JSValue::UNDEFINED);
    }

    // handle failure
    if not {
        // TODO(port): `comptime getSignature(...)` — ensure Expect::get_signature is `const fn`
        let signature = Expect::get_signature("toHaveBeenCalled", "", true);
        return this.throw(
            global,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected number of calls: <green>0<r>\n",
                    "Received number of calls: <red>{}<r>\n",
                ),
                calls_length
            ),
        );
    }

    let signature = Expect::get_signature("toHaveBeenCalled", "", false);
    this.throw(
        global,
        signature,
        format_args!(
            concat!(
                "\n\n",
                "Expected number of calls: \\>= <green>1<r>\n",
                "Received number of calls: <red>{}<r>\n",
            ),
            calls_length
        ),
    )
}

// ported from: src/test_runner/expect/toHaveBeenCalled.zig
