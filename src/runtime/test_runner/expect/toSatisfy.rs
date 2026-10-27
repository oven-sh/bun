use bun_jsc::bindgen::{JsLocal, JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};

use super::Expect;
use super::get_signature;
use super::throw;

impl Expect {
    pub(crate) fn to_satisfy(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        predicate: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        // Not `matcher_prelude`: toSatisfy bypasses `get_value` (no .resolves/.rejects handling).
        let this = self.post_match_guard(global);

        let this_value = this_value.to_js();

        this.increment_expect_call_counter();

        let predicate = predicate.to_js();

        if !predicate.is_callable() {
            return Err(global.throw(format_args!("toSatisfy() argument must be a function")));
        }

        let Some(value) = super::js::captured_value_get_cached(this_value) else {
            return Err(global.throw(format_args!(
                "Internal consistency error: the expect(value) was garbage collected but it should not have been!"
            )));
        };
        value.ensure_still_alive();

        let result = predicate.call(global, JSValue::UNDEFINED, &[value])?;

        let not = this.flags.get().not();
        let pass = (result.is_boolean() && result.to_boolean()) != not;

        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        // Formatter impls Drop.
        let mut formatter = super::make_formatter(global);

        if not {
            let signature = get_signature("toSatisfy", "<green>expected<r>", true);
            return throw!(
                this,
                global,
                signature,
                "\n\nExpected: not <green>{}<r>\n", predicate.to_fmt(&mut formatter),
            );
        }

        let signature = get_signature("toSatisfy", "<green>expected<r>", false);

        let mut formatter2 = super::make_formatter(global);
        throw!(
            this,
            global,
            signature,
            "\n\nExpected: <green>{}<r>\nReceived: <red>{}<r>\n",
            predicate.to_fmt(&mut formatter),
            value.to_fmt(&mut formatter2),
        )
    }
}
