//! The bytes of a module, or of a name in it, that a script passes.

use bun_engine_text::Text;
use bun_engine_vm::{JsArrayBuffer, JsArrayBufferView, errors};

use crate::prelude::*;

/// A copy of what a `BufferSource` holds.
pub fn copy_bytes(cx: &mut Cx, value: Value) -> JsResult<Vec<u8>> {
    let copy = if let Some(view) = value.downcast::<JsArrayBufferView>() {
        if view.is_out_of_bounds() {
            return Err(JsArrayBufferView::throw_out_of_bounds(cx));
        }
        view.bytes(&cx.no_gc()).try_to_vec()
    } else if let Some(buffer) = value.downcast::<JsArrayBuffer>() {
        if buffer.is_detached() {
            return Err(JsArrayBufferView::throw_out_of_bounds(cx));
        }
        buffer.bytes(&cx.no_gc()).try_to_vec()
    } else {
        let message = "first argument must be an ArrayBufferView or an ArrayBuffer";
        return Err(errors::throw_type_error_with_source(cx, message));
    };
    cx.or_out_of_memory(copy)
}

/// In UTF-8. `None` if it has a lone surrogate, as no name has.
pub(crate) fn name_in_module(cx: &Cx, text: Text<'_>) -> JsResult<Option<Vec<u8>>> {
    let bytes = text.is_well_formed().then(|| text.try_to_utf8());
    cx.or_out_of_memory(bytes.transpose())
}
