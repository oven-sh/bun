use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;
use super::Expect;
use super::get_signature;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_have_been_called_once(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    let (this, calls, _value) = this.mock_prologue(
        global,
        frame.this(),
        "toHaveBeenCalledOnce",
        "<green>expected<r>",
        super::mock::MockKind::Calls,
    )?;

    let calls_length = calls.get_length(global)?;
    let mut pass = calls_length == 1;

    let not = this.flags.get().not();
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

// ported from: src/test_runner/expect/toHaveBeenCalledOnce.zig
