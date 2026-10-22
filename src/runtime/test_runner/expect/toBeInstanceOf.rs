use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};

use super::Expect;
use super::get_signature;
use super::throw;

impl Expect {
    pub(crate) fn to_be_instance_of(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        expected: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let this = self.post_match_guard(global);
        let this_value = this_value.to_js();

        this.increment_expect_call_counter();
        let mut formatter = super::make_formatter(global);
        // `defer formatter.deinit()` → handled by Drop.

        let expected = expected.to_js();
        if !expected.is_constructor() {
            return Err(global.throw(format_args!(
                "Expected value must be a function: {}",
                expected.to_fmt(&mut formatter),
            )));
        }

        let value: JSValue =
            this.get_value(global, this_value, "toBeInstanceOf", "<green>expected<r>")?;

        let not = this.flags.get().not();
        let mut pass = value.is_instance_of(global, expected)?;
        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        let mut formatter2 = super::make_formatter(global);
        let expected_fmt = expected.to_fmt(&mut formatter);
        let value_fmt = value.to_fmt(&mut formatter2);
        if not {
            let signature = get_signature("toBeInstanceOf", "<green>expected<r>", true);
            return throw!(
                this,
                global,
                signature,
                "\n\nExpected constructor: not <green>{}<r>\nReceived value: <red>{}<r>\n",
                expected_fmt, value_fmt,
            );
        }

        let signature = get_signature("toBeInstanceOf", "<green>expected<r>", false);
        throw!(
            this,
            global,
            signature,
            "\n\nExpected constructor: <green>{}<r>\nReceived value: <red>{}<r>\n",
            expected_fmt, value_fmt,
        )
    }
}

