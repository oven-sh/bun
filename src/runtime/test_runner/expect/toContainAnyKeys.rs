use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_contain_any_keys(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // PORT NOTE: reshaped for borrowck — Zig `defer this.postMatch(global)` becomes a
    // scopeguard that owns the &mut and DerefMut's it for the body.
    let this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = frame.this();
    let arguments_ = frame.arguments_old::<1>();
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!("toContainAnyKeys() takes 1 argument")));
    }

    this.increment_expect_call_counter();

    let expected = arguments[0];
    expected.ensure_still_alive();
    let value: JSValue = this.get_value(global, this_value, "toContainAnyKeys", "<green>expected<r>")?;

    if !expected.js_type().is_array() {
        return Err(global.throw_invalid_argument_type("toContainAnyKeys", "expected", "array"));
    }

    let not = this.flags.get().not();
    let mut pass = false;

    let count = expected.get_length(global)?;

    if value.is_object() {
        let mut i: u32 = 0;

        while u64::from(i) < count {
            let key = expected.get_index(global, i)?;

            if value.has_own_property_value(global, key)? {
                pass = true;
                break;
            }
            i += 1;
        }
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(this_value);
    }

    // handle failure
    // PORT NOTE: Zig held two `to_fmt(&formatter)` results live at once; in Rust each
    // `to_fmt` borrows `&mut Formatter` for the lifetime of the returned adapter, so allocate
    // a second formatter for the other value.
    let mut formatter = super::make_formatter(global);
    let mut formatter2 = super::make_formatter(global);
    if not {
        let expected_fmt = expected.to_fmt(&mut formatter);
        let received_fmt = value.to_fmt(&mut formatter2);
        let signature = Expect::get_signature("toContainAnyKeys", "<green>expected<r>", true);
        return this.throw(
            global,
            signature,
            format_args!(
                concat!(
                    "\n\n",
                    "Expected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n",
                ),
                expected_fmt,
                received_fmt,
            ),
        );
    }

    let expected_fmt = expected.to_fmt(&mut formatter);
    let value_fmt = value.to_fmt(&mut formatter2);
    let signature = Expect::get_signature("toContainAnyKeys", "<green>expected<r>", false);
    this.throw(
        global,
        signature,
        format_args!(
            concat!(
                "\n\n",
                "Expected to contain: <green>{}<r>\n",
                "Received: <red>{}<r>\n",
            ),
            expected_fmt,
            value_fmt,
        ),
    )
}

// ported from: src/test_runner/expect/toContainAnyKeys.zig
