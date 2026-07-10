use core::ptr::NonNull;

use crate::mark_binding;
use bun_core::String as BunString;

/// The C++ object itself. Only the extern declarations below name this type;
/// all Rust code uses the owning [`TextCodec`] handle.
pub mod sys {
    bun_opaque::opaque_ffi! {
        /// `PAL::TextCodec`. `&Self` is ABI-identical to a non-null
        /// `PAL::TextCodec*` (C++ spells it `void*`), and carries no
        /// `noalias`/`readonly` — C++ mutates the codec's streaming state
        /// (lead byte, ISO-2022-JP mode, GB18030 bytes) through it.
        pub struct TextCodec;
    }
}

// C++ `newTextCodec(encoding).release()` hands back the sole owning pointer;
// `Bun__deleteTextCodec` `delete`s it. One handle owns exactly one codec.
bun_opaque::foreign_handle! {
    /// Owned handle to a C++ `PAL::TextCodec`.
    ///
    /// `Drop` deletes the codec. Every method takes `&self`: C++ mutates the codec
    /// through the same pointer, and giving the object back is not exclusive
    /// access, so there is no `&mut self` and no `DerefMut`.
    pub struct TextCodec(sys::TextCodec) via Bun__deleteTextCodec;
}

// `&sys::TextCodec` is ABI-identical to the `void*` the C++ shims declare. Shims
// that also take raw `*const u8` / out-pointers stay `unsafe fn`: safe Rust can
// forge those.
unsafe extern "C" {
    fn Bun__createTextCodec(
        encoding_name: *const u8,
        encoding_name_len: usize,
    ) -> *mut sys::TextCodec;
    fn Bun__decodeWithTextCodec(
        codec: &sys::TextCodec,
        data: *const u8,
        length: usize,
        flush: bool,
        stop_on_error: bool,
        out_saw_error: *mut bool,
    ) -> BunString;
    // safe: C++ `delete`s the codec. Handing the object back is not exclusive
    // access as Rust sees it, so the receiver is `&`, not `&mut`.
    safe fn Bun__deleteTextCodec(codec: &sys::TextCodec);
    safe fn Bun__stripBOMFromTextCodec(codec: &sys::TextCodec);
    fn Bun__isEncodingSupported(encoding_name: *const u8, encoding_name_len: usize) -> bool;
    fn Bun__getCanonicalEncodingName(
        encoding_name: *const u8,
        encoding_name_len: usize,
        out_len: *mut usize,
    ) -> Option<NonNull<u8>>;
}

pub struct DecodeResult {
    pub result: BunString,
    pub saw_error: bool,
}

impl TextCodec {
    /// `None` when `encoding` does not name a valid WebKit encoding.
    pub fn create(encoding: &[u8]) -> Option<Self> {
        mark_binding!();
        // SAFETY: encoding.ptr is valid for encoding.len bytes; C++
        // `newTextCodec(encoding).release()` transfers us the sole owning
        // pointer, or null.
        unsafe { Self::adopt_ptr(Bun__createTextCodec(encoding.as_ptr(), encoding.len())) }
    }

    pub fn decode(&self, data: &[u8], flush: bool, stop_on_error: bool) -> DecodeResult {
        mark_binding!();
        let mut saw_error: bool = false;
        // SAFETY: `data` valid for `data.len()` bytes; `saw_error` is a valid
        // out-pointer for the duration of the call.
        let result = unsafe {
            Bun__decodeWithTextCodec(
                self.raw(),
                data.as_ptr(),
                data.len(),
                flush,
                stop_on_error,
                &raw mut saw_error,
            )
        };

        DecodeResult { result, saw_error }
    }

    pub fn strip_bom(&self) {
        mark_binding!();
        Bun__stripBOMFromTextCodec(self.raw())
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
