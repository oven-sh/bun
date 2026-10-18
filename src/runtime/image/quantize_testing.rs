//! `quantizeRoute` of `bun:internal-for-testing`: how `quantize.rs` counts the colours of an image.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _};

use super::quantize::{self, Route};

/// `quantizeRoute(rgba, colors)`: "exact" when the image fits, else the pixels that the table counted.
pub(crate) fn quantize_route(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let Some(rgba) = frame.argument(0).as_array_buffer(global) else {
        return Err(global.throw(format_args!("quantizeRoute: expected a Uint8Array")));
    };
    let (pixels, _) = rgba.byte_slice().as_chunks::<4>();
    let want = usize::try_from(frame.argument(1).to_int32().clamp(1, 256)).expect("int cast");
    let mut indices = vec![0u8; pixels.len()];
    match quantize::route(pixels, want, &mut indices) {
        Ok(Route::Exact(_)) => bun_core::String::static_("exact").to_js(global),
        Ok(Route::Counted(table)) => Ok(JSValue::js_number_from_uint64(table.counted() as u64)),
        Err(_) => Err(global.throw_out_of_memory()),
    }
}
