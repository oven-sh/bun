use bun_jsc::bindgen::{JsScope, JsWrapper};
use bun_jsc::{JSValue, JsResult};

use super::{throw, Expect};

impl Expect {
    pub(crate) fn to_be_object(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let this_value = this_value.to_js();
        let (this, value, not) = self.matcher_prelude(global, this_value, "toBeObject", "")?;

        let pass = value.is_object() != not;

        if pass {
            return Ok(this_value);
        }

        let mut formatter = super::make_formatter(global);
        let received = value.to_fmt(&mut formatter);

        if not {
            let signature = Expect::get_signature("toBeObject", "", true);
            return throw!(
                this,
                global,
                signature,
                "\n\nExpected value <b>not<r> to be an object\n\nReceived: <red>{}<r>\n",
                received
            );
        }

        let signature = Expect::get_signature("toBeObject", "", false);
        throw!(
            this,
            global,
            signature,
            "\n\nExpected value to be an object\n\nReceived: <red>{}<r>\n",
            received
        )
    }
}

