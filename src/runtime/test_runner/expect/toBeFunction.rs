use bun_jsc::console_object::Formatter as ConsoleFormatter;
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_be_function(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // defer this.postMatch(globalThis);
    // PORT NOTE: reshaped for borrowck — defer postMatch hoisted after body (IIFE captures result, post_match runs unconditionally)
    let result: JsResult<JSValue> = (|| {
        let this_value = frame.this();
        let value: JSValue = this.get_value(global, this_value, "toBeFunction", "")?;

        this.increment_expect_call_counter();

        let not = this.flags.get().not();
        let pass = value.is_callable() != not;

        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        let mut formatter = super::make_formatter(global);
        // defer formatter.deinit(); — handled by Drop
        let received = value.to_fmt(&mut formatter);

        if not {
            let signature = Expect::get_signature("toBeFunction", "", true);
            return this.throw(
                global,
                signature,
                format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
            );
        }

        let signature = Expect::get_signature("toBeFunction", "", false);
        this.throw(
            global,
            signature,
            format_args!(concat!("\n\n", "Received: <red>{}<r>\n"), received),
        )
    })();
    this.post_match(global);
    result
}

// ported from: src/test_runner/expect/toBeFunction.zig
