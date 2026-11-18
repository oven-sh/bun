use bun_engine_text::{MAX_LENGTH, Text};
use bun_engine_vm::{StringJoiner, with_element_type};

use super::prototype::valid_this;
use crate::prelude::*;

#[native_abi]
pub(super) fn join(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let (this, length) = valid_this(cx, frame)?;
    let view = match frame.argument(0) {
        Value::UNDEFINED => None,
        separator => Some(separator.to_string_view(cx)?),
    };
    let separator = view.as_ref().map_or(Text::Latin1(b","), |it| it.text());
    let present = length.min(this.length());
    if present + length.saturating_sub(1).saturating_mul(separator.len()) > MAX_LENGTH {
        return Err(cx.throw_out_of_memory());
    }
    if length == 1
        && let Some(element) = this.get_element(cx, 0)
    {
        return element.primitive_to_string(cx).map(Into::into);
    }
    StringJoiner::join(cx, separator, |cx, joiner| {
        with_element_type!(this.element_type(), T => {
            let no_gc = cx.no_gc();
            joiner.push_numbers(this.typed::<T>().elements(&no_gc).slice(0..present).iter());
        });
        joiner.push_empty(length - present);
        Ok(())
    })
    .map(Into::into)
}
