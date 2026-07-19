use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};

use super::throw;
use super::DiffFormatter;
use super::Expect;

impl Expect {
    /// Object.is()
    #[bun_jsc::host_fn(method)]
    pub fn to_be(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (this, left, not) =
            self.matcher_prelude(global_this, callframe.this(), "toBe", "<green>expected<r>")?;

        let arguments_ = callframe.arguments_old::<2>();
        let arguments = arguments_.slice();

        if arguments.len() < 1 {
            return Err(global_this.throw_invalid_arguments(format_args!("toBe() takes 1 argument")));
        }

        let right = arguments[0];
        right.ensure_still_alive();
        let mut pass = right.is_same_value(left, global_this)?;

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // handle failure
        let mut formatter = super::make_formatter(global_this);
        // formatter cleanup handled by Drop

        // The bool is only used to select a literal format string.
        let has_custom_label = this.custom_label.is_empty();

        if not {
            let signature = Expect::get_signature("toBe", "<green>expected<r>", true);
            return throw!(
                this,
                global_this,
                signature,
                "\n\nExpected: not <green>{}<r>\n", right.to_fmt(&mut formatter),
            );
        }

        let signature = Expect::get_signature("toBe", "<green>expected<r>", false);
        if left.jest_deep_equals(right, global_this)? || left.jest_strict_deep_equals(right, global_this)? {
            // Rust format strings must be literals, so branch the call on
            // `has_custom_label` instead.
            if !has_custom_label {
                return throw!(
                    this,
                    global_this,
                    signature,
                    concat!(
                        "\n\n<d>If this test should pass, replace \"toBe\" with \"toEqual\" or \"toStrictEqual\"<r>",
                        "\n\nExpected: <green>{}<r>\n",
                        "Received: serializes to the same string\n",
                    ),
                    right.to_fmt(&mut formatter),
                );
            } else {
                return throw!(
                    this,
                    global_this,
                    signature,
                    concat!(
                        "\n\nExpected: <green>{}<r>\n",
                        "Received: serializes to the same string\n",
                    ),
                    right.to_fmt(&mut formatter),
                );
            }
        }

        if right.is_string() && left.is_string() {
            let diff_format = DiffFormatter { expected: Some(right), received: Some(left), expected_string: None, received_string: None, global_this: Some(global_this), not };
            return throw!(this, global_this, signature, "\n\n{}\n", diff_format);
        }

        // The `ZigFormatter` adapter holds `&'a mut Formatter`, so two live adapters
        // cannot alias the same backing formatter. Use a second formatter for the
        // received value — `make_formatter` is a trivial struct init with no shared
        // state between values.
        let mut formatter2 = super::make_formatter(global_this);
        return throw!(
            this,
            global_this,
            signature,
            "\n\nExpected: <green>{}<r>\nReceived: <red>{}<r>\n",
            right.to_fmt(&mut formatter),
            left.to_fmt(&mut formatter2),
        );
    }
}

