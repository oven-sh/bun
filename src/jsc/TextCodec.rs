use core::ptr::NonNull;

use crate::mark_binding;
use bun_core::String as BunString;

// TODO(port): move to <jsc>_sys
unsafe extern "C" {
    fn Bun__createTextCodec(
        encoding_name: *const u8,
        encoding_name_len: usize,
    ) -> Option<NonNull<TextCodec>>;
    fn Bun__decodeWithTextCodec(
        codec: *mut TextCodec,
        data: *const u8,
        length: usize,
        flush: bool,
        stop_on_error: bool,
        out_saw_error: *mut bool,
    ) -> BunString;
    fn Bun__deleteTextCodec(codec: *mut TextCodec);
    // safe: `TextCodec` is an `opaque_ffi!` ZST handle; `&mut` is ABI-identical
    // to a non-null `*mut` and C++ mutating codec state is interior to the cell.
    safe fn Bun__stripBOMFromTextCodec(codec: &mut TextCodec);
    fn Bun__isEncodingSupported(encoding_name: *const u8, encoding_name_len: usize) -> bool;
    fn Bun__getCanonicalEncodingName(
        encoding_name: *const u8,
        encoding_name_len: usize,
        out_len: *mut usize,
    ) -> Option<NonNull<u8>>;
}

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle to a C++ PAL::TextCodec.
    pub struct TextCodec;
}

pub struct DecodeResult {
    pub result: BunString,
    pub saw_error: bool,
}

impl TextCodec {
    pub fn create(encoding: &[u8]) -> Option<NonNull<TextCodec>> {
        mark_binding!();
        // SAFETY: encoding.ptr is valid for encoding.len bytes.
        unsafe { Bun__createTextCodec(encoding.as_ptr(), encoding.len()) }
    }

    // PORT NOTE: FFI-owned opaque; constructed/destroyed across FFI, so explicit
    // destroy instead of `impl Drop` (cannot own a `TextCodec` by value).
    pub unsafe fn destroy(this: *mut TextCodec) {
        mark_binding!();
        // SAFETY: caller guarantees `this` was returned by `create` and not yet freed.
        unsafe { Bun__deleteTextCodec(this) }
    }

    pub fn decode(&mut self, data: &[u8], flush: bool, stop_on_error: bool) -> DecodeResult {
        mark_binding!();
        let mut saw_error: bool = false;
        // SAFETY: `self` is a valid live codec; `data` valid for `data.len()` bytes;
        // `saw_error` is a valid out-pointer for the duration of the call.
        let result = unsafe {
            Bun__decodeWithTextCodec(
                self,
                data.as_ptr(),
                data.len(),
                flush,
                stop_on_error,
                &raw mut saw_error,
            )
        };

        DecodeResult { result, saw_error }
    }

    pub fn strip_bom(&mut self) {
        mark_binding!();
        Bun__stripBOMFromTextCodec(self)
    }

    pub fn is_supported(encoding: &[u8]) -> bool {
        mark_binding!();
        // SAFETY: encoding.ptr is valid for encoding.len bytes.
        unsafe { Bun__isEncodingSupported(encoding.as_ptr(), encoding.len()) }
    }

    pub fn get_canonical_encoding_name(encoding: &[u8]) -> Option<&'static [u8]> {
        mark_binding!();
        let mut len: usize = 0;
        // SAFETY: encoding.ptr is valid for encoding.len bytes; `len` is a valid out-pointer.
        let name = unsafe {
            Bun__getCanonicalEncodingName(encoding.as_ptr(), encoding.len(), &raw mut len)
        }?;
        // SAFETY: C++ returns a pointer into static encoding-name table data, valid for `len` bytes
        // and for the lifetime of the program.
        Some(unsafe { bun_core::ffi::slice(name.as_ptr(), len) })
    }
}

// ported from: src/jsc/TextCodec.zig
