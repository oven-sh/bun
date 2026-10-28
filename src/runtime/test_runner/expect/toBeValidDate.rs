use bun_jsc::bindgen::{JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::make_formatter;

use super::Expect;
use super::get_signature;
use super::throw;

impl Expect {
    pub(crate) fn to_be_valid_date(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let this_value = this_value.to_js();
        let (this, value, not) = self.matcher_prelude(global, this_value, "toBeValidDate", "")?;
        let mut pass = value.is_date() && !value.get_unix_timestamp().is_nan();
        if not {
            pass = !pass;
        }

        if pass {
            return Ok(this_value);
        }

        let mut formatter = make_formatter(global);
        // `defer formatter.deinit()` → handled by Drop
        let received = value.to_fmt(&mut formatter);

        if not {
            let signature = get_signature("toBeValidDate", "", true);
            return throw!(
                this,
                global,
                signature,
                "\n\nReceived: <red>{}<r>\n", received,
            );
        }

        let signature = get_signature("toBeValidDate", "", false);
        throw!(
            this,
            global,
            signature,
            "\n\nReceived: <red>{}<r>\n", received,
        )
    }
}
