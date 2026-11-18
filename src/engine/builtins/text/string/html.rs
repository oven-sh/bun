//! The methods of Annex B that wrap a string in an HTML element.

use bun_engine_text::{MAX_LENGTH, StringBuilder, Text};

use super::this_string;
use crate::prelude::*;

/// CreateHTML
fn create_html(
    cx: &mut Cx,
    frame: &CallFrame,
    message: &'static str,
    tag: &str,
    attribute: Option<&str>,
) -> JsResult<Value> {
    let string = this_string(cx, frame, message)?;
    let value = match attribute {
        Some(_) => frame.argument(0).to_string(cx)?,
        None => cx.small_strings.empty(),
    };
    let markup =
        "<></>".len() + 2 * tag.len() + attribute.map_or(0, |it| " =\"\"".len() + it.len());
    let shortest = markup + string.len() as usize + value.len() as usize;
    if shortest > MAX_LENGTH {
        return Err(cx.throw_out_of_memory());
    }
    let mut out = StringBuilder::with_capacity(shortest);
    out.push_latin1(b'<');
    out.push_ascii(tag);
    if let Some(attribute) = attribute {
        out.push_latin1(b' ');
        out.push_ascii(attribute);
        out.push_ascii("=\"");
        let (value, mut done) = (value.view(cx)?, 0);
        for quote in value.text().matches(Text::from_ascii("\"")) {
            out.push_text(value.text().slice(done..quote));
            out.push_ascii("&quot;");
            done = quote + 1;
        }
        out.push_text(value.text().slice_from(done));
        out.push_latin1(b'"');
    }
    out.push_latin1(b'>');
    string.append_to(&mut out);
    out.push_ascii("</");
    out.push_ascii(tag);
    out.push_latin1(b'>');
    cx.finish_string(out).map(Into::into)
}

macro_rules! methods {
    ($($name:ident => $tag:literal, $attribute:expr;)*) => {$(
        #[native_abi]
        pub(super) fn $name(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
            let message = concat!(
                "String.prototype.", stringify!($name), " requires that |this| not be null or undefined"
            );
            create_html(cx, frame, message, $tag, $attribute)
        }
    )*};
}

methods! {
    anchor => "a", Some("name");
    big => "big", None;
    blink => "blink", None;
    bold => "b", None;
    fixed => "tt", None;
    fontcolor => "font", Some("color");
    fontsize => "font", Some("size");
    italics => "i", None;
    link => "a", Some("href");
    small => "small", None;
    strike => "strike", None;
    sub => "sub", None;
    sup => "sup", None;
}
