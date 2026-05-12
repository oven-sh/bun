use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;
use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_have_been_called(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    let (this, calls, _value) =
        this.mock_prologue(global, frame.this(), "toHaveBeenCalled", "", super::mock::MockKind::Calls)?;
    // arg-check after prologue: counter bump + post_match still fire on bad-arity (matches Zig defer order).
    if !frame.arguments_as_array::<1>()[0].is_undefined() {
        return Err(global.throw_invalid_arguments(format_args!(
            "toHaveBeenCalled() must not have an argument"
        )));
    }

    let calls_length = calls.get_length(global)?;
    let mut pass = calls_length > 0;

    let not = this.flags.get().not();
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
