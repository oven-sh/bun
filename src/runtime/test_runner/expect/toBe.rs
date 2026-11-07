use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

use super::throw;
use super::DiffFormatter;
use super::Expect;

impl Expect {
    /// Object.is()
    pub(crate) fn to_be(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global_this = cx.global();
        let (this, left, not) =
            self.matcher_prelude(global_this, this_value.to_js(), "toBe", "<green>expected<r>")?;

        let right = expected.to_js();
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
        // Like Jest, the hint names the strictest check that passes.
        let passing_matcher = if left.jest_strict_deep_equals(right, global_this)? {
            Some("toStrictEqual")
        } else if left.jest_deep_equals(right, global_this)? {
            Some("toEqual")
        } else {
            None
        };
        if let Some(matcher) = passing_matcher {
            return this.throw_to_be_deep_equal(global_this, signature, matcher, right, left);
        }

        if right.is_string() && left.is_string() {
            let diff_format = DiffFormatter::new(global_this, left, right, not)?;
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

    /// Deep-equal values can print differently: an asymmetric matcher, a hole against `undefined`.
    #[cold]
    #[inline(never)]
    #[optimize(size)]
    fn throw_to_be_deep_equal(
        &self,
        global_this: &JSGlobalObject,
        signature: &'static str,
        matcher: &'static str,
        expected: JSValue,
        received: JSValue,
    ) -> JsResult<JSValue> {
        let expected_text = print_for_message(global_this, expected)?;
        // An Error prints the source frame and stack of where it was made, which deep equality ignores.
        let printed_differently = if expected.is_error() && received.is_error() {
            None
        } else {
            Some(print_for_message(global_this, received)?).filter(|text| *text != expected_text)
        };

        let Some(received_text) = printed_differently else {
            return throw!(
                self,
                global_this,
                signature,
                concat!(
                    "\n\n<d>If this test should pass, replace \"toBe\" with \"{}\"<r>",
                    "\n\nExpected: <green>{}<r>\n",
                    "Received: serializes to the same string\n",
                ),
                matcher,
                expected_text,
            );
        };
        throw!(
            self,
            global_this,
            signature,
            concat!(
                "\n\n<d>If this test should pass, replace \"toBe\" with \"{}\"<r>",
                "\n\nExpected: <green>{}<r>\n",
                "Received: <red>{}<r>\n",
            ),
            matcher,
            expected_text,
            received_text,
        )
    }
}

/// The text of `value` as a failure message shows it.
fn print_for_message(global_this: &JSGlobalObject, value: JSValue) -> JsResult<String> {
    let mut text = String::new();
    super::make_formatter(global_this)
        .format_value::<false>(value, &mut bun_io::FmtAdapter::new(&mut text))?;
    Ok(text)
}

