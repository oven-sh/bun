use core::ffi::c_void;

use crate::{JSGlobalObject, JSValue, JsResult};
use bun_core::String;

const SIZE: usize = 24;
// alignment = 8 is encoded in #[repr(align(8))] below.

/// Opaque inline storage for a C++ `WTF::StringBuilder`.
#[repr(C, align(8))]
pub struct StringBuilder {
    bytes: [u8; SIZE],
}

impl StringBuilder {
    #[inline]
    pub fn init() -> StringBuilder {
        let mut this = core::mem::MaybeUninit::<StringBuilder>::uninit();
        // SAFETY: StringBuilder__init writes the full SIZE bytes of the C++
        // object into `this.bytes`; after the call the value is fully
        // initialized.
        unsafe {
            StringBuilder__init(this.as_mut_ptr().cast::<c_void>());
            this.assume_init()
        }
    }

    // PORT NOTE: Zig's `append(comptime append_type: Append, value: append_type.Type())`
    // dispatches on a comptime enum to pick the value's *type*. Rust const
    // generics cannot vary a parameter's type by enum value, and a trait would
    // collide (e.g. `String` is used for both `.string` and `.quoted_json_string`).
    // Each comptime arm is therefore a separate method below; callers that wrote
    // `sb.append(.latin1, s)` now write `sb.append_latin1(s)`.

    pub fn append_latin1(&mut self, value: &[u8]) {
        // SAFETY: forwards a valid (ptr,len) slice to C++.
        unsafe { StringBuilder__appendLatin1(self, value.as_ptr(), value.len()) }
    }

    pub fn append_utf16(&mut self, value: &[u16]) {
        // SAFETY: forwards a valid (ptr,len) slice to C++.
        unsafe { StringBuilder__appendUtf16(self, value.as_ptr(), value.len()) }
    }

    pub fn append_double(&mut self, value: f64) {
        StringBuilder__appendDouble(self, value)
    }

    pub fn append_int(&mut self, value: i32) {
        StringBuilder__appendInt(self, value)
    }

    pub fn append_usize(&mut self, value: usize) {
        StringBuilder__appendUsize(self, value)
    }

    pub fn append_string(&mut self, value: String) {
        StringBuilder__appendString(self, value)
    }

    pub fn append_lchar(&mut self, value: u8) {
        StringBuilder__appendLChar(self, value)
    }

    pub fn append_uchar(&mut self, value: u16) {
        StringBuilder__appendUChar(self, value)
    }

    pub fn append_quoted_json_string(&mut self, value: String) {
        StringBuilder__appendQuotedJsonString(self, value)
    }

    pub fn to_string(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        // PORT NOTE: Zig wraps this in a TopExceptionScope. `from_js_host_call`
        // is the equivalent shape (call FFI → check pending exception); using it
        // here avoids the in-place-init / pinning dance TopExceptionScope needs.
        crate::from_js_host_call(global, || StringBuilder__toString(self, global))
    }

    pub fn ensure_unused_capacity(&mut self, additional: usize) {
        StringBuilder__ensureUnusedCapacity(self, additional)
    }
}

impl Drop for StringBuilder {
    fn drop(&mut self) {
        StringBuilder__deinit(self)
    }
}

// TODO(port): move to jsc_sys
//
// `StringBuilder` is `#[repr(C, align(8))]` with a single `[u8; SIZE]` field,
// so `&mut StringBuilder` is ABI-identical to a non-null aligned `void*` to the
// inline `WTF::StringBuilder` storage. The shims that take only that handle
// plus by-value scalars/`bun.String` are declared `safe fn` — the validity
// proof is in the type signature. `__init` keeps a raw `*mut c_void` (writes
// into a `MaybeUninit`); `__appendLatin1`/`__appendUtf16` keep `unsafe fn`
// because the C++ side dereferences the `(ptr, len)` slice.
unsafe extern "C" {
    fn StringBuilder__init(this: *mut c_void);
    safe fn StringBuilder__deinit(this: &mut StringBuilder);
    fn StringBuilder__appendLatin1(this: &mut StringBuilder, str: *const u8, len: usize);
    fn StringBuilder__appendUtf16(this: &mut StringBuilder, str: *const u16, len: usize);
    safe fn StringBuilder__appendDouble(this: &mut StringBuilder, num: f64);
    safe fn StringBuilder__appendInt(this: &mut StringBuilder, num: i32);
    safe fn StringBuilder__appendUsize(this: &mut StringBuilder, num: usize);
    safe fn StringBuilder__appendString(this: &mut StringBuilder, str: String);
    safe fn StringBuilder__appendLChar(this: &mut StringBuilder, c: u8);
    safe fn StringBuilder__appendUChar(this: &mut StringBuilder, c: u16);
    safe fn StringBuilder__appendQuotedJsonString(this: &mut StringBuilder, str: String);
    safe fn StringBuilder__toString(this: &mut StringBuilder, global: &JSGlobalObject) -> JSValue;
    safe fn StringBuilder__ensureUnusedCapacity(this: &mut StringBuilder, additional: usize);
}

// ported from: src/jsc/StringBuilder.zig
