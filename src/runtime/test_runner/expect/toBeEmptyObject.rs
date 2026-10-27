use bun_jsc::bindgen::{JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};
use super::Expect;
use super::throw;

impl Expect {
    pub(crate) fn to_be_empty_object(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let this_value = this_value.to_js();
        let (this, value, not) = self.matcher_prelude(global, this_value, "toBeEmptyObject", "")?;
        let mut pass = value.is_object_empty(global)?;

        if not {
            pass = !pass;
        }
        if pass {
            return Ok(this_value);
        }

        let mut formatter = super::make_formatter(global);
        // `defer formatter.deinit()` → handled by Drop.
        let received = value.to_fmt(&mut formatter);

        if not {
            let signature = Expect::get_signature("toBeEmptyObject", "", true);
            return throw!(
                this,
                global,
                signature,
                "\n\nReceived: <red>{}<r>\n", received,
            );
        }

        let signature = Expect::get_signature("toBeEmptyObject", "", false);
        throw!(
            this,
            global,
            signature,
            "\n\nReceived: <red>{}<r>\n", received,
        )
    }
}

