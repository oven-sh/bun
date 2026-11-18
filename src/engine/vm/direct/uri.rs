use bun_engine_macros::direct_form;
use bun_engine_text::{StringRef, Text, UriError, UriSet};

use super::outcome::FlatOrFirst;
use crate::{Cx, ErrorType, Gc, JsResult, JsString};

#[direct_form(pure, only_lacks_room)]
pub fn escape(cx: &Cx, string: Gc<JsString>) -> JsResult<FlatOrFirst> {
    let escaped = string.converted(cx, |text| text.escape())?;
    Ok(FlatOrFirst::new(escaped, string))
}

#[direct_form(pure, only_lacks_room)]
pub fn unescape(cx: &Cx, string: Gc<JsString>) -> JsResult<FlatOrFirst> {
    let unescaped = string.converted(cx, |text| text.unescape())?;
    Ok(FlatOrFirst::new(unescaped, string))
}

#[inline(always)]
fn convert(
    cx: &Cx,
    string: Gc<JsString>,
    convert: impl FnOnce(Text<'_>) -> Result<Option<StringRef>, UriError>,
) -> JsResult<FlatOrFirst> {
    match convert(string.view(cx)?.text()) {
        Ok(None) => Ok(FlatOrFirst::new(string, string)),
        Ok(Some(converted)) => Ok(FlatOrFirst::new(JsString::new(cx, converted), string)),
        Err(UriError::OutOfMemory) => Err(cx.throw_out_of_memory()),
        Err(error) => Err(cx.throw_error(ErrorType::UriError, error.message())),
    }
}

macro_rules! conversions {
    ($($name:ident = $method:ident($set:ident),)*) => {$(
        #[direct_form(pure)]
        pub fn $name(cx: &Cx, string: Gc<JsString>) -> JsResult<FlatOrFirst> {
            convert(cx, string, |text| text.$method(UriSet::$set))
        }
    )*};
}

conversions! {
    decode_uri = decode_uri(Uri),
    decode_uri_component = decode_uri(Component),
    encode_uri = encode_uri(Uri),
    encode_uri_component = encode_uri(Component),
}
