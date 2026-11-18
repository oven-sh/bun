use bun_engine_macros::direct_form;
use bun_engine_text::StringBuilder;

use super::operand::Undefined;
use super::outcome::Flat;
use crate::{Cx, Gc, JsResult, JsString, Value, json};

#[direct_form(writes(TRANSITIONS), gives_new)]
fn json_parse(cx: &Cx, text: Gc<JsString>, _: Undefined) -> JsResult<Value> {
    json::parse(cx, text.view(cx)?.text().into())
}

#[direct_form(pure, only_lacks_room)]
fn json_quote(cx: &Cx, string: Gc<JsString>, _: Undefined, _: Undefined) -> JsResult<Flat> {
    const BYTES_ON_STACK: usize = 256;
    let view = string.view(cx)?;
    let quoted = StringBuilder::on_stack::<BYTES_ON_STACK, _>(|out| {
        out.push_json_quoted(view.text());
        out.take()
    });
    Ok(Flat::new(cx, cx.or_out_of_memory(quoted)?))
}
