use bun_jsc::console_object::Formatter as ConsoleFormatter;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use crate::expect::Expect;

#[bun_jsc::host_fn(method)]
pub fn to_be_function(
    this: &mut Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // defer this.postMatch(globalThis);
    // PORT NOTE: reshaped for borrowck — defer postMatch hoisted after body (IIFE captures result, post_match runs unconditionally)
    let result: JsResult<JSValue> = (|| {
        let this_value = frame.this();
        let value: JSValue = this.get_value(global, this_value, "toBeFunction", "")?;

        this.increment_expect_call_counter();

        let not = this.flags.not;
        let pass = value.is_callable() != not;

        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        let mut formatter = ConsoleFormatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBeFunction.zig (35 lines)
//   confidence: high
//   todos:      0
//   notes:      defer postMatch reshaped as IIFE+tail call (no raw ptr); get_signature assumed const fn (was comptime call)
// ──────────────────────────────────────────────────────────────────────────
