//! `quantizeRoute` of `bun:internal-for-testing`: which route `quantize.rs` takes for an image.

use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _};

use super::quantize::{self, Route};

/// `quantizeRoute(rgba, colors)`: "exact", "table" or "pixels" for RGBA8 pixels and a palette size.
pub(crate) fn quantize_route(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let Some(rgba) = frame.argument(0).as_array_buffer(global) else {
        return Err(global.throw(format_args!("quantizeRoute: expected a Uint8Array")));
    };
    let (pixels, _) = rgba.byte_slice().as_chunks::<4>();
    let want = usize::try_from(frame.argument(1).to_int32().clamp(1, 256)).expect("int cast");
    let mut indices = vec![0u8; pixels.len()];
    let name = match quantize::route(pixels, want, &mut indices) {
        Ok(Route::Exact(_)) => "exact",
        Ok(Route::Table(_)) => "table",
        Ok(Route::Pixels) => "pixels",
        Err(_) => return Err(global.throw_out_of_memory()),
    };
    bun_core::String::static_(name).to_js(global)
}
