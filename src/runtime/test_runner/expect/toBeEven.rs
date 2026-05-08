use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_be_even(
    this: &mut Expect,
    global_this: &JSGlobalObject,
    call_frame: &CallFrame,
) -> JsResult<JSValue> {
    // Zig: `defer this.postMatch(globalThis);`
    // PORT NOTE: reshaped for borrowck — scopeguard would hold a borrow of `this` across the whole
    // body, conflicting with `&mut self` uses below. Run the match in an inner closure and call
    // post_match once on the way out (covers both Ok and Err paths).
    let res = (|| -> JsResult<JSValue> {
        let this_value = call_frame.this();

        let value: JSValue = this.get_value(global_this, this_value, "toBeEven", "")?;

        this.increment_expect_call_counter();

        let not = this.flags.not();
        let mut pass = false;

        if value.is_any_int() {
            let _value = value.to_int64();
            pass = _value.rem_euclid(2) == 0;
            if _value == 0 {
                // negative zero is even
                pass = true;
            }
        } else if value.is_big_int() || value.is_big_int32() {
            let _value = value.to_int64();
            pass = if _value == 0 {
                // negative zero is even
                true
            } else {
                _value & 1 == 0
            };
        } else if value.is_number() {
            let _value = value.as_number();
            if _value.rem_euclid(1.0) == 0.0 && _value.rem_euclid(2.0) == 0.0 {
                // if the fraction is all zeros and even
                pass = true;
            } else {
                pass = false;
            }
        } else {
            pass = false;
        }

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        let mut formatter = super::make_formatter(global_this);
        // `defer formatter.deinit()` — handled by Drop
        let value_fmt = value.to_fmt(&mut formatter);
        if not {
            let signature = Expect::get_signature("toBeEven", "", true);
            return this.throw(
                global_this,
                signature,
                format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
            );
        }

        let signature = Expect::get_signature("toBeEven", "", false);
        this.throw(
            global_this,
            signature,
            format_args!("\n\nReceived: <red>{}<r>\n", value_fmt),
        )
    })();
    this.post_match(global_this);
    res
}

// ported from: src/test_runner/expect/toBeEven.zig
