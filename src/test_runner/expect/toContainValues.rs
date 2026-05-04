use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use crate::expect::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_contain_values(
        this: &mut Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // TODO(port): `defer this.postMatch(global)` — scopeguard::defer! captures `&mut self`
        // for the whole scope and conflicts with later uses under borrowck. Phase B may need a
        // raw-ptr guard or to restructure exits.
        scopeguard::defer! { this.post_match(global); }

        let this_value = frame.this_value();
        // TODO(port): arguments_old(1) API shape — confirm slice accessor on the Rust side.
        let arguments_ = frame.arguments_old(1);
        let arguments = arguments_.as_slice();

        if arguments.len() < 1 {
            return global.throw_invalid_arguments(format_args!("toContainValues() takes 1 argument"));
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        if !expected.js_type().is_array() {
            return global.throw_invalid_argument_type("toContainValues", "expected", "array");
        }
        expected.ensure_still_alive();
        let value: JSValue = this.get_value(global, this_value, "toContainValues", "<green>expected<r>")?;

        let not = this.flags.not;
        let mut pass = true;

        if !value.is_undefined_or_null() {
            let values = value.values(global)?;
            let mut itr = expected.array_iterator(global)?;
            let count = values.get_length(global)?;

            'outer: while let Some(item) = itr.next(global)? {
                // PORT NOTE: reshaped for borrowck — Zig `while ... else` has no Rust equivalent;
                // tracked via `found` flag instead.
                let mut found = false;
                let mut i: u32 = 0;
                while (i as usize) < count {
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
        // TODO(port): Formatter struct-init shape — confirm field names / Default impl in bun_jsc.
        let mut formatter = Formatter { global_this: global, quote_strings: true, ..Default::default() };
        // `defer formatter.deinit()` → dropped; Formatter impls Drop.
        let value_fmt = value.to_fmt(&mut formatter);
        let expected_fmt = expected.to_fmt(&mut formatter);
        if not {
            let received_fmt = value.to_fmt(&mut formatter);
            const EXPECTED_LINE: &str = "Expected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n";
            const FMT: &str = concat!("\n\n", "Expected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n");
            let _ = EXPECTED_LINE;
            return this.throw(
                global,
                Expect::get_signature("toContainValues", "<green>expected<r>", true),
                format_args!("\n\nExpected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n", expected_fmt, received_fmt),
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toContainValues.zig (73 lines)
//   confidence: medium
//   todos:      3
//   notes:      defer postMatch needs borrowck reshape; Zig while-else flattened to `found` flag; {f} fmt specifier mapped to Display {}
// ──────────────────────────────────────────────────────────────────────────
