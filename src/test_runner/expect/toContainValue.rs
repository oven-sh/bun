use bun_jsc::{CallFrame, ConsoleObject, JSGlobalObject, JSValue, JsResult};

use super::Expect;

impl Expect {
    #[bun_jsc::host_fn(method)]
    pub fn to_contain_value(
        &mut self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // PORT NOTE: reshaped for borrowck — Zig `defer this.postMatch(globalObject)` becomes a
        // scopeguard owning `&mut self` so post_match runs on every exit path.
        let this = scopeguard::guard(self, |t| t.post_match(global));

        let this_value = frame.this();
        let arguments_ = frame.arguments_old::<1>();
        let arguments = arguments_.as_slice();

        if arguments.len() < 1 {
            return global
                .throw_invalid_arguments(format_args!("toContainValue() takes 1 argument"));
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        expected.ensure_still_alive();
        let value: JSValue =
            this.get_value(global, this_value, "toContainValue", "<green>expected<r>")?;

        let not = this.flags.not;
        let mut pass = false;

        if !value.is_undefined_or_null() {
            let values = value.values(global)?;
            let mut itr = values.array_iterator(global)?;
            while let Some(item) = itr.next()? {
                if item.jest_deep_equals(expected, global)? {
                    pass = true;
                    break;
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
        // TODO(port): ConsoleObject::Formatter field init — other fields rely on Zig defaults
        let mut formatter = ConsoleObject::Formatter {
            global_this: global,
            quote_strings: true,
            ..Default::default()
        };
        let value_fmt = value.to_fmt(&mut formatter);
        let expected_fmt = expected.to_fmt(&mut formatter);
        if not {
            let received_fmt = value.to_fmt(&mut formatter);
            return this.throw(
                global,
                Expect::get_signature("toContainValue", "<green>expected<r>", true),
                format_args!(
                    "\n\nExpected to not contain: <green>{}<r>\nReceived: <red>{}<r>\n",
                    expected_fmt, received_fmt,
                ),
            );
        }

        this.throw(
            global,
            Expect::get_signature("toContainValue", "<green>expected<r>", false),
            format_args!(
                "\n\nExpected to contain: <green>{}<r>\nReceived: <red>{}<r>\n",
                expected_fmt, value_fmt,
            ),
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toContainValue.zig (64 lines)
//   confidence: medium
//   todos:      1
//   notes:      scopeguard wraps &mut self for defer postMatch; Formatter init defaults and get_signature const-ness need Phase B verification
// ──────────────────────────────────────────────────────────────────────────
