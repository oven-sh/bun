use super::make_formatter;
use bun_jsc::JsResult;
use bun_jsc::bindgen::{JsScope, JsWrapper};

use super::Expect;
use super::get_signature;
use super::throw;

impl Expect {
    pub(crate) fn to_be_valid_date<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        let global = cx.global();
        let (this, value, not) =
            self.matcher_prelude(global, this_value.to_js(), "toBeValidDate", "")?;
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
