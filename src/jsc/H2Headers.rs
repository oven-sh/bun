//! `Bun__h2__materializeHeaders` (H2HeadersMaterializer.cpp): one-call
//! materialization of a decoded HTTP/2 header block.

use bun_core::ffi::FfiSlice;

use crate::{JSGlobalObject, JSValue, JsResult};

unsafe extern "C" {
    /// `packed` must hold at least the bytes `meta`'s lengths describe.
    fn Bun__h2__materializeHeaders(
        global_object: &JSGlobalObject,
        packed: FfiSlice<'_, u8>,
        meta: FfiSlice<'_, u32>,
    ) -> JSValue;
}

/// Build the `[rawHeadersArray, headersObject, sensitiveArray | undefined]`
/// tuple for one header block. `packed` is every name then value, back to back;
/// `meta` holds two u32s per field (`[nameLen | sensitive << 31, valueLen]`).
#[track_caller]
pub fn materialize(global: &JSGlobalObject, packed: &[u8], meta: &[u32]) -> JsResult<JSValue> {
    let described: usize = meta
        .as_chunks::<2>()
        .0
        .iter()
        .map(|m| (m[0] & 0x7fff_ffff) as usize + m[1] as usize)
        .sum();
    assert!(
        described <= packed.len(),
        "h2 header block shorter than its field lengths"
    );
    crate::call_zero_is_throw(global, || {
        // SAFETY: every field `meta` describes lies inside `packed` (checked above); both are
        // live borrows for the call.
        unsafe { Bun__h2__materializeHeaders(global, FfiSlice::new(packed), FfiSlice::new(meta)) }
    })
}
