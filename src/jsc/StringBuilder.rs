use core::ffi::c_void;

use bun_jsc::{JSGlobalObject, JSValue, JsResult, TopExceptionScope};
use bun_str::String;

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
        unsafe { StringBuilder__appendLatin1(self.bytes.as_mut_ptr().cast(), value.as_ptr(), value.len()) }
    }

    pub fn append_utf16(&mut self, value: &[u16]) {
        // SAFETY: forwards a valid (ptr,len) slice to C++.
        unsafe { StringBuilder__appendUtf16(self.bytes.as_mut_ptr().cast(), value.as_ptr(), value.len()) }
    }

    pub fn append_double(&mut self, value: f64) {
        // SAFETY: self.bytes is a live StringBuilder.
        unsafe { StringBuilder__appendDouble(self.bytes.as_mut_ptr().cast(), value) }
    }

    pub fn append_int(&mut self, value: i32) {
        // SAFETY: self.bytes is a live StringBuilder.
        unsafe { StringBuilder__appendInt(self.bytes.as_mut_ptr().cast(), value) }
    }

    pub fn append_usize(&mut self, value: usize) {
        // SAFETY: self.bytes is a live StringBuilder.
        unsafe { StringBuilder__appendUsize(self.bytes.as_mut_ptr().cast(), value) }
    }

    pub fn append_string(&mut self, value: String) {
        // SAFETY: self.bytes is a live StringBuilder; bun_str::String is #[repr(C)].
        unsafe { StringBuilder__appendString(self.bytes.as_mut_ptr().cast(), value) }
    }

    pub fn append_lchar(&mut self, value: u8) {
        // SAFETY: self.bytes is a live StringBuilder.
        unsafe { StringBuilder__appendLChar(self.bytes.as_mut_ptr().cast(), value) }
    }

    pub fn append_uchar(&mut self, value: u16) {
        // SAFETY: self.bytes is a live StringBuilder.
        unsafe { StringBuilder__appendUChar(self.bytes.as_mut_ptr().cast(), value) }
    }

    pub fn append_quoted_json_string(&mut self, value: String) {
        // SAFETY: self.bytes is a live StringBuilder; bun_str::String is #[repr(C)].
        unsafe { StringBuilder__appendQuotedJsonString(self.bytes.as_mut_ptr().cast(), value) }
    }

    pub fn to_string(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        // TODO(port): @src() — TopExceptionScope wants a source location; Phase B
        // should provide a `bun_jsc::src_location!()` macro or equivalent.
        let mut scope = TopExceptionScope::init(global);
        // `defer scope.deinit()` → handled by Drop on TopExceptionScope.

        // SAFETY: self.bytes is a live StringBuilder; global is a valid borrow.
        let result = unsafe { StringBuilder__toString(self.bytes.as_mut_ptr().cast(), global) };
        scope.return_if_exception()?;
        Ok(result)
    }

    pub fn ensure_unused_capacity(&mut self, additional: usize) {
        // SAFETY: self.bytes is a live StringBuilder.
        unsafe { StringBuilder__ensureUnusedCapacity(self.bytes.as_mut_ptr().cast(), additional) }
    }
}

impl Drop for StringBuilder {
    fn drop(&mut self) {
        // SAFETY: self.bytes was initialized by StringBuilder__init and has not
        // been deinitialized (Rust ownership guarantees Drop runs once).
        unsafe { StringBuilder__deinit(self.bytes.as_mut_ptr().cast()) }
    }
}

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn StringBuilder__init(this: *mut c_void);
    fn StringBuilder__deinit(this: *mut c_void);
    fn StringBuilder__appendLatin1(this: *mut c_void, str: *const u8, len: usize);
    fn StringBuilder__appendUtf16(this: *mut c_void, str: *const u16, len: usize);
    fn StringBuilder__appendDouble(this: *mut c_void, num: f64);
    fn StringBuilder__appendInt(this: *mut c_void, num: i32);
    fn StringBuilder__appendUsize(this: *mut c_void, num: usize);
    fn StringBuilder__appendString(this: *mut c_void, str: String);
    fn StringBuilder__appendLChar(this: *mut c_void, c: u8);
    fn StringBuilder__appendUChar(this: *mut c_void, c: u16);
    fn StringBuilder__appendQuotedJsonString(this: *mut c_void, str: String);
    fn StringBuilder__toString(this: *mut c_void, global: *const JSGlobalObject) -> JSValue;
    fn StringBuilder__ensureUnusedCapacity(this: *mut c_void, additional: usize);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/StringBuilder.zig (91 lines)
//   confidence: medium
//   todos:      2
//   notes:      comptime Append enum split into per-variant append_* methods; TopExceptionScope @src() needs Phase B macro
// ──────────────────────────────────────────────────────────────────────────
