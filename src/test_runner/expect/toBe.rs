use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::console_object::Formatter;

use crate::diff_format::DiffFormatter;
use crate::expect::Expect;

impl Expect {
    /// Object.is()
    #[bun_jsc::host_fn(method)]
    pub fn to_be(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // TODO(port): `defer this.postMatch(globalThis)` — scopeguard captures &mut this for the
        // whole fn body; reshape for borrowck in Phase B (e.g. guard owning a *mut Self, or call
        // post_match before every return).
        scopeguard::defer! { this.post_match(global_this); }

        let this_value = callframe.this();
        let arguments_ = callframe.arguments_old(2);
        let arguments = arguments_.slice();

        if arguments.len() < 1 {
            return global_this
                .throw_invalid_arguments(format_args!("toBe() takes 1 argument"));
        }

        this.increment_expect_call_counter();
        let right = arguments[0];
        right.ensure_still_alive();
        let left = this.get_value(global_this, this_value, "toBe", "<green>expected<r>")?;

        let not = this.flags.not;
        let mut pass = right.is_same_value(left, global_this)?;

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        let mut formatter = Formatter {
            global_this,
            quote_strings: true,
            ..Default::default()
        };
        // `defer formatter.deinit()` — handled by Drop

        // Zig: `switch (this.custom_label.isEmpty()) { inline else => |has_custom_label| { ... } }`
        // The comptime bool is only used to select a literal format string; demote to runtime.
        // PERF(port): was comptime bool dispatch — profile in Phase B
        let has_custom_label = this.custom_label.is_empty();

        if not {
            let signature = Expect::get_signature("toBe", "<green>expected<r>", true);
            return this.throw(
                global_this,
                signature,
                format_args!("\n\nExpected: not <green>{}<r>\n", right.to_fmt(&mut formatter)),
            );
        }

        let signature = Expect::get_signature("toBe", "<green>expected<r>", false);
        if left.deep_equals(right, global_this)? || left.strict_deep_equals(right, global_this)? {
            // Zig builds `fmt` via comptime `++` on `has_custom_label`; Rust format strings must
            // be literals, so branch the call instead.
            if !has_custom_label {
                return this.throw(
                    global_this,
                    signature,
                    format_args!(
                        concat!(
                            "\n\n<d>If this test should pass, replace \"toBe\" with \"toEqual\" or \"toStrictEqual\"<r>",
                            "\n\nExpected: <green>{}<r>\n",
                            "Received: serializes to the same string\n",
                        ),
                        right.to_fmt(&mut formatter),
                    ),
                );
            } else {
                return this.throw(
                    global_this,
                    signature,
                    format_args!(
                        concat!(
                            "\n\nExpected: <green>{}<r>\n",
                            "Received: serializes to the same string\n",
                        ),
                        right.to_fmt(&mut formatter),
                    ),
                );
            }
        }

        if right.is_string() && left.is_string() {
            let diff_format = DiffFormatter {
                expected: right,
                received: left,
                global_this,
                not,
            };
            return this.throw(global_this, signature, format_args!("\n\n{}\n", diff_format));
        }

        return this.throw(
            global_this,
            signature,
            format_args!(
                "\n\nExpected: <green>{}<r>\nReceived: <red>{}<r>\n",
                right.to_fmt(&mut formatter),
                left.to_fmt(&mut formatter),
            ),
        );
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect/toBe.zig (74 lines)
//   confidence: medium
//   todos:      1
//   notes:      defer postMatch needs borrowck reshape; throw() assumed to take fmt::Arguments
// ──────────────────────────────────────────────────────────────────────────
