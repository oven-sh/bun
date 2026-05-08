use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
#[allow(unused_imports)] use super::{JSValueTestExt, JSGlobalObjectTestExt, BigIntCompare, make_formatter};
use bun_jsc::console_object::Formatter;

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_contain_values(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // defer this.postMatch(globalThis);
        // PORT NOTE: reshaped for borrowck — move `this` into the guard and access via DerefMut.
        let mut this = scopeguard::guard(this, |t| t.post_match(global));

        let this_value = frame.this();
        // TODO(port): arguments_old(1) API shape — confirm slice accessor on the Rust side.
        let arguments_ = frame.arguments_old::<1>();
        let arguments = arguments_.slice();

        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!("toContainValues() takes 1 argument")));
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        if !expected.js_type().is_array() {
            return Err(global.throw_invalid_argument_type("toContainValues", "expected", "array"));
        }
        expected.ensure_still_alive();
        let value: JSValue = this.get_value(global, this_value, "toContainValues", "<green>expected<r>")?;

        let not = this.flags.not();
        let mut pass = true;

        if !value.is_undefined_or_null() {
            let values = value.values(global)?;
            let mut itr = expected.array_iterator(global)?;
            let count = values.get_length(global)?;

            'outer: while let Some(item) = itr.next()? {
                // PORT NOTE: reshaped for borrowck — Zig `while ... else` has no Rust equivalent;
                // tracked via `found` flag instead.
                let mut found = false;
                let mut i: u32 = 0;
                while (i as u64) < count {
                    let key = values.get_index(global, i)?;
                    if key.jest_deep_equals(item, global)? {
                        found = true;
                        break;
                    }
                    i += 1;
                }
                if !found {
                    pass = false;
                    break 'outer;
                }
            }
        }

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(this_value);
        }

        // handle failure
        // PORT NOTE: reshaped for borrowck — `to_fmt` returns an adapter holding `&mut Formatter`,
        // so two live adapters cannot alias one backing formatter. Use a second formatter for the
        // received value (`make_formatter` is a trivial struct init with no shared state between values).
        let mut formatter = super::make_formatter(global);
        let mut formatter2 = super::make_formatter(global);
        // `defer formatter.deinit()` → dropped; Formatter impls Drop.
        let expected_fmt = expected.to_fmt(&mut formatter);
        let value_fmt = value.to_fmt(&mut formatter2);
        if not {
            // Zig's `received_fmt` is `value.toFmt(&formatter)` — identical to `value_fmt`.
            const EXPECTED_LINE: &str = "Expected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n";
            const FMT: &str = concat!("\n\n", "Expected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n");
            let _ = EXPECTED_LINE;
            return this.throw(
                global,
                Expect::get_signature("toContainValues", "<green>expected<r>", true),
                format_args!("\n\nExpected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n", expected_fmt, value_fmt),
            );
            // PORT NOTE: Zig used `comptime` string concat (`++`) for FMT; Rust `format_args!`
            // requires a single literal, so the pieces are inlined above. `FMT` kept for diff parity.
            #[allow(unreachable_code)]
            let _ = FMT;
        }

        const EXPECTED_LINE: &str = "Expected to contain: <green>{}<r>\n";
        const RECEIVED_LINE: &str = "Received: <red>{}<r>\n";
        const FMT: &str = concat!("\n\n", "Expected to contain: <green>{}<r>\n", "Received: <red>{}<r>\n");
        let _ = (EXPECTED_LINE, RECEIVED_LINE, FMT);
        this.throw(
            global,
            Expect::get_signature("toContainValues", "<green>expected<r>", false),
            format_args!("\n\nExpected to contain: <green>{}<r>\nReceived: <red>{}<r>\n", expected_fmt, value_fmt),
        )
    }
}

// ported from: src/test_runner/expect/toContainValues.zig
