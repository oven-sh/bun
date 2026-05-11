use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::{Expect, get_signature};

// TODO(port): #[bun_jsc::host_fn(method)] — must be inside `impl Expect`; shim wired by JsClass codegen
pub fn to_contain_all_keys(
    this: &Expect,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    // Zig: `defer this.postMatch(globalObject);`
    // PORT NOTE: reshaped for borrowck — scopeguard owns the `&mut Expect` borrow so `post_match`
    // runs on every exit path; method calls go through DerefMut on the guard.
    let this = scopeguard::guard(this, |this| this.post_match(global));

    let this_value = frame.this();
    let arguments_ = frame.arguments_old::<1>();
    let arguments = arguments_.slice();

    if arguments.len() < 1 {
        return Err(global.throw_invalid_arguments(format_args!(
            "toContainAllKeys() takes 1 argument"
        )));
    }

    this.increment_expect_call_counter();

    let expected = arguments[0];
    expected.ensure_still_alive();
    let value: JSValue =
        this.get_value(global, this_value, "toContainAllKeys", "<green>expected<r>")?;

    if !expected.js_type().is_array() {
        return Err(global.throw_invalid_argument_type("toContainAllKeys", "expected", "array"));
    }

    let not = this.flags.get().not();
    let mut pass = false;

    let count = expected.get_length(global)?;

    let keys = value.keys(global)?;
    if keys.get_length(global)? == count {
        let mut itr = keys.array_iterator(global)?;
        'outer: {
            while let Some(item) = itr.next()? {
                // PORT NOTE: Zig `while ... else break :outer` → explicit `found` flag (Rust has no while-else).
                let mut found = false;
                let mut i: u32 = 0;
                while u64::from(i) < count {
                    let key = expected.get_index(global, i)?;
                    if item.jest_deep_equals(key, global)? {
                        found = true;
                        break;
                    }
                    i += 1;
                }
                if !found {
                    break 'outer;
                }
            }
            pass = true;
        }
    }

    if not {
        pass = !pass;
    }
    if pass {
        return Ok(this_value);
    }

    // handle failure
    // PORT NOTE: Zig shares one `*Formatter` across both `to_fmt` calls; in Rust each `to_fmt`
    // mutably borrows the formatter for the lifetime of the returned wrapper, so use two.
    let mut formatter = super::make_formatter(global);
    let mut formatter2 = super::make_formatter(global);
    // Zig: `defer formatter.deinit();` — handled by Drop.
    let value_fmt = keys.to_fmt(&mut formatter);
    let expected_fmt = expected.to_fmt(&mut formatter2);
    if not {
        // Zig's `received_fmt` is `keys.toFmt(&formatter)` — identical to `value_fmt` above.
        return this.throw(
            global,
            get_signature("toContainAllKeys", "<green>expected<r>", true),
            format_args!(
                concat!(
                    "\n\n",
                    "Expected to not contain all keys: <green>{}<r>\nReceived: <red>{}<r>\n",
                ),
                expected_fmt, value_fmt,
            ),
        );
    }

    this.throw(
        global,
        get_signature("toContainAllKeys", "<green>expected<r>", false),
        format_args!(
            concat!(
                "\n\n",
                "Expected to contain all keys: <green>{}<r>\n",
                "Received: <red>{}<r>\n",
            ),
            expected_fmt, value_fmt,
        ),
    )
}

// ported from: src/test_runner/expect/toContainAllKeys.zig
