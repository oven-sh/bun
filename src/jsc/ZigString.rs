//! Prefer using bun.String instead of ZigString in new code.

use core::ffi::c_void;
use core::fmt;
use core::slice;

use bun_alloc::AllocError;
use bun_core::fmt as bun_fmt;
use crate::DOMExceptionCode;
#[allow(unused_imports)]
use crate::{c_api, JSGlobalObject, JSValue, VM};
// `node::Encoding` is the Node.js Buffer encoding tag; canonical home is
// `bun_string::encoding::Encoding` (re-exported there as `NodeEncoding`).
#[allow(unused_imports)]
use bun_string::encoding::Encoding;
use bun_paths::PathBuffer;
use bun_simdutf_sys::simdutf;
use bun_string::{strings, String as BunString, ZStr};

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn ZigString__toValueGC(arg0: *const ZigString, arg1: *const JSGlobalObject) -> JSValue;
    fn ZigString__toJSONObject(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
    fn ZigString__toAtomicValue(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
    fn ZigString__toExternalU16(ptr: *const u16, len: usize, global: *const JSGlobalObject) -> JSValue;
    fn ZigString__toExternalValue(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
    fn ZigString__toExternalValueWithCallback(
        this: *const ZigString,
        global: *const JSGlobalObject,
        callback: unsafe extern "C" fn(ctx: *mut c_void, ptr: *mut c_void, len: usize),
    ) -> JSValue;
    fn ZigString__external(
        this: *const ZigString,
        global: *const JSGlobalObject,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(ctx: *mut c_void, ptr: *mut c_void, len: usize),
    ) -> JSValue;
    fn ZigString__to16BitValue(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
    fn ZigString__toErrorInstance(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
    fn ZigString__toTypeErrorInstance(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
    fn ZigString__toDOMExceptionInstance(this: *const ZigString, global: *const JSGlobalObject, code: u8) -> JSValue;
    fn ZigString__toSyntaxErrorInstance(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
    fn ZigString__toRangeErrorInstance(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
}

// `OpaqueJSString` / `JSStringRef` retained for type-level compatibility with
// the JSC C API surface; the `to_js_string_ref` constructor wrappers were dead
// code (no C++ body for `JSStringCreateStatic` in Bun's link image — Zig's
// `toJSStringRef` is unreachable behind `@hasDecl(bun, "bindgen")`).
#[repr(C)]
pub struct OpaqueJSString {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}
pub type JSStringRef = *mut OpaqueJSString;

/// Prefer using `bun_string::String` instead of `ZigString` in new code.
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ZigString {
    /// This can be a UTF-16, Latin1, or UTF-8 string.
    /// The pointer itself is tagged, so it cannot be used without untagging it first.
    /// Accessing it directly is unsafe.
    _unsafe_ptr_do_not_use: *const u8,
    pub len: usize,
}

pub enum ByteString<'a> {
    Latin1(&'a [u8]),
    Utf16(&'a [u16]),
}

/// `ZigString.Slice` re-export for `crate::zig_string::Slice` callers.
pub use bun_string::ZigStringSlice as Slice;

/// `ZigString.static(comptime s)` — borrow a static ASCII/Latin-1 literal.
/// Spec (`ZigString.static`, ZigString.zig:499-506) constructs the string with
/// the raw literal pointer and NO encoding tag. Callers who need UTF-8
/// semantics must use `init_utf8` / `from_utf8` explicitly.
#[inline]
pub fn static_(s: &'static [u8]) -> bun_string::ZigString {
    bun_string::ZigString::init(s)
}

// ──────────────────────────────────────────────────────────────────────────
// Un-gated JSC-side surface — small helpers that need `JSGlobalObject`/
// `JSValue` and so live here rather than in `bun_string`. These are inherent
// on the *local* `ZigString` struct (which is `repr(C)`-identical to
// `bun_string::ZigString`); callers that imported `bun_str::ZigString` reach
// these via [`to_external_u16`] (free fn) instead.
// ──────────────────────────────────────────────────────────────────────────

impl ZigString {
    /// `ZigString.toExternalU16` (ZigString.zig:571) — hand a globally-allocated
    /// UTF-16 buffer to JSC as an external string. Ownership of `ptr[0..len]`
    /// transfers to JSC on success; on the too-long path the buffer is freed
    /// here, a `STRING_TOO_LONG` error is thrown, and `.zero` is returned.
    ///
    /// SAFETY: `ptr` must have been allocated by the global mimalloc allocator
    /// (via `heap::alloc`/`Vec::into_raw_parts`/`bun.default_allocator`) and
    /// must not be used by the caller after this returns.
    pub fn to_external_u16(ptr: *const u16, len: usize, global: &JSGlobalObject) -> JSValue {
        to_external_u16(ptr, len, global)
    }
}

/// Free-function form of [`ZigString::to_external_u16`] for callers that
/// imported `bun_str::ZigString` (which cannot grow inherent methods from this
/// crate).
pub fn to_external_u16(ptr: *const u16, len: usize, global: &JSGlobalObject) -> JSValue {
    if len > BunString::max_length() {
        // SAFETY: caller contract — `ptr` came from the global mimalloc
        // allocator. `mi_free` accepts the raw block pointer regardless of
        // element size.
        unsafe { bun_alloc::mimalloc::mi_free(ptr.cast_mut().cast::<core::ffi::c_void>()) };
        // TODO(port): Zig used `global.ERR(.STRING_TOO_LONG, msg).throw()`;
        // the codegen'd `ErrorCode::ERR_STRING_TOO_LONG` builder hasn't landed
        // yet, so throw a plain RangeError with the same message. Propagation
        // is swallowed (matches Zig's `catch {}`).
        let err = global.create_range_error_instance(format_args!(
            "Cannot create a string longer than 2^32-1 characters"
        ));
        let _ = global.throw_value(err);
        return JSValue::ZERO;
    }
    // SAFETY: ptr/len describe a globally-allocated UTF-16 buffer; ownership
    // transfers to JSC (freed via the external-string finalizer).
    unsafe { ZigString__toExternalU16(ptr, len, global) }
}

// LAYERING: `bun_string::String::init` (and friends) accept `bun_string::ZigString`;
// this crate's `ZigString` is `#[repr(C)]`-identical (same `{ *const u8, usize }`
// layout, same tag-bit scheme). Provide the lossless cast so JSC-side views can be
// fed straight into `bun_string::String` without an extra copy.
impl From<ZigString> for bun_string::ZigString {
    #[inline]
    fn from(z: ZigString) -> Self {
        // SAFETY: both are `#[repr(C)] struct { *const u8, usize }` with identical
        // pointer-tag encoding (see `bun_string::ZigString` and the struct above).
        unsafe { core::mem::transmute::<ZigString, bun_string::ZigString>(z) }
    }
}
impl From<bun_string::ZigString> for ZigString {
    #[inline]
    fn from(z: bun_string::ZigString) -> Self {
        // SAFETY: both are `#[repr(C)] struct { *const u8, usize }` with identical
        // pointer-tag encoding (see `bun_string::ZigString` and the struct above).
        unsafe { core::mem::transmute::<bun_string::ZigString, ZigString>(z) }
    }
}
impl From<ZigString> for bun_string::String {
    #[inline]
    fn from(z: ZigString) -> Self {
        bun_string::String::init(bun_string::ZigString::from(z))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `JSValue` / `JSGlobalObject` surface has landed; bytemuck +
// `bun_string::encoding::Encoding` + simdutf are in the dep graph. The
// `Slice` ownership model uses the enum-based `bun_string::ZigStringSlice`
// (re-exported above); the original `NullableAllocator`-backed struct is
// preserved below in `_slice_struct` for FFI-shaped callers.
// ──────────────────────────────────────────────────────────────────────────
pub use self::_body::GithubActionFormatter;
mod _body {
use super::*;

impl ZigString {
    pub fn from_bytes(slice_: &[u8]) -> ZigString {
        if !strings::is_all_ascii(slice_) {
            return Self::init_utf8(slice_);
        }
        Self::init(slice_)
    }

    #[inline]
    pub fn as_(&self) -> ByteString<'_> {
        if self.is_16bit() {
            ByteString::Utf16(self.utf16_slice_aligned())
        } else {
            ByteString::Latin1(self.slice())
        }
    }

    // `encode` / `encodeWithAllocator` — moved UP to
    // `bun_runtime::webcore::encoding::ZigStringEncode`. The encoder bodies
    // (`jsc.WebCore.encoding.constructFrom{U8,U16}`) live in `bun_runtime`;
    // defining them here would be a forward dep.

    pub fn dupe_for_js(utf8: &[u8]) -> Result<ZigString, strings::ToUTF16Error> {
        if let Some(utf16) = strings::to_utf16_alloc(utf8, false, false)? {
            // Ownership transfers to JSC (freed via `deinit_global` /
            // external-string finalizer). Convert to a raw mimalloc block.
            let len = utf16.len();
            let ptr = bun_core::heap::leak(utf16.into_boxed_slice()).cast::<u16>();
            // SAFETY: ptr/len describe a valid globally-allocated UTF-16 buffer.
            let mut out =
                ZigString::init_utf16(unsafe { slice::from_raw_parts(ptr, len) });
            out.mark_global();
            out.mark_utf16();
            Ok(out)
        } else {
            let len = utf8.len();
            let ptr = bun_core::heap::leak(Box::<[u8]>::from(utf8)).cast::<u8>();
            // SAFETY: ptr/len describe a valid globally-allocated byte buffer.
            let mut out = ZigString::init(unsafe { slice::from_raw_parts(ptr, len) });
            out.mark_global();
            Ok(out)
        }
    }

    pub fn to_js(&self, ctx: &JSGlobalObject) -> JSValue {
        if self.is_globally_allocated() {
            return self.to_external_value(ctx);
        }
        // SAFETY: self is a valid #[repr(C)] ZigString; ctx is a live JSGlobalObject borrow.
        unsafe { ZigString__toValueGC(self, ctx) }
    }

    /// This function is not optimized!
    pub fn eql_case_insensitive(&self, other: &ZigString) -> bool {
        // PERF(port): was stack-fallback allocator (1024 bytes)
        let utf16_slice = self.to_slice_lowercase();
        let latin1_slice = other.to_slice_lowercase();
        strings::eql_long(utf16_slice.slice(), latin1_slice.slice(), true)
    }

    pub fn to_slice_lowercase(&self) -> Slice {
        if self.len == 0 {
            return Slice::EMPTY;
        }
        // PERF(port): was stack-fallback allocator (512 bytes)
        let uppercase_buffer = self.to_owned_slice().expect("unreachable");
        let mut buffer = vec![0u8; uppercase_buffer.len()];
        let out_len = strings::copy_lowercase(&uppercase_buffer, &mut buffer).len();
        buffer.truncate(out_len);
        Slice::Owned(buffer)
    }

    // TODO(port): `index_of_any16` takes `&'static [u16]` but Zig callers pass
    // ASCII char sets as `[]const u8`. Needs a widening adapter (or comptime
    // string-to-u16-array as in Zig). Gated until adapter lands.
    
    pub fn index_of_any(&self, chars: &'static [u8]) -> Option<strings::OptionalUsize> {
        if self.is_16bit() {
            // PORT NOTE: Zig comptime-widened the `[]const u8` charset to u16.
            // Rust has no comptime-array widening; do the scalar scan inline
            // (matches `strings::index_of_any_t` which is also scalar for u16).
            for (i, c) in self.utf16_slice_aligned().iter().enumerate() {
                if chars.iter().any(|&a| u16::from(a) == *c) {
                    return Some(i as strings::OptionalUsize);
                }
            }
            None
        } else {
            strings::index_of_any(self.slice(), chars)
        }
    }

    pub fn char_at(&self, offset: usize) -> u8 {
        if self.is_16bit() {
            self.utf16_slice_aligned()[offset] as u8
        } else {
            self.slice()[offset] as u8
        }
    }

    pub fn eql(&self, other: &ZigString) -> bool {
        if self.len == 0 || other.len == 0 {
            return self.len == other.len;
        }

        let left_utf16 = self.is_16bit();
        let right_utf16 = other.is_16bit();

        if left_utf16 == right_utf16 && left_utf16 {
            return strings::eql_long(
                bytemuck::cast_slice::<u16, u8>(self.utf16_slice_aligned()),
                bytemuck::cast_slice::<u16, u8>(other.utf16_slice_aligned()),
                true,
            );
        } else if left_utf16 == right_utf16 {
            return strings::eql_long(self.slice(), other.slice(), true);
        }

        let utf16: &ZigString = if left_utf16 { self } else { other };
        let latin1: &ZigString = if left_utf16 { other } else { self };

        if latin1.is_all_ascii() {
            return strings::utf16_eql_string(utf16.utf16_slice_aligned(), latin1.slice());
        }

        // slow path
        let utf16_slice = utf16.to_slice();
        let latin1_slice = latin1.to_slice();
        strings::eql_long(utf16_slice.slice(), latin1_slice.slice(), true)
    }

    pub fn is_all_ascii(&self) -> bool {
        if self.is_16bit() {
            return strings::first_non_ascii16(self.utf16_slice_aligned()).is_none();
        }
        strings::is_all_ascii(self.slice())
    }

    pub fn to_json_object(&self, global_this: &JSGlobalObject) -> JSValue {
        crate::mark_binding!();
        // SAFETY: self points to valid #[repr(C)] data; global_this is a live borrow.
        unsafe { ZigString__toJSONObject(self, global_this) }
    }

    // PORT NOTE: `BunString__toURL` (Zig `ZigString.toURL`) has no C++ body in
    // bindings.cpp — the only DOMURL constructor exported is
    // `BunString__toJSDOMURL(*BunString)`, which takes a `bun.String`, not a
    // `ZigString`. The Zig wrapper is dead code; route URL construction through
    // `bun_str::String::to_js_dom_url` instead.

    pub fn has_prefix_char(&self, char: u8) -> bool {
        if self.len == 0 {
            return false;
        }
        if self.is_16bit() {
            return self.utf16_slice_aligned()[0] == char as u16;
        }
        self.slice()[0] == char
    }

    pub fn substring_with_len(&self, start_index: usize, end_index: usize) -> ZigString {
        if self.is_16bit() {
            return ZigString::from16_slice_maybe_global(
                &self.utf16_slice_aligned()[start_index..end_index],
                self.is_globally_allocated(),
            );
        }

        let mut out = ZigString::init(&self.slice()[start_index..end_index]);
        if self.is_utf8() {
            out.mark_utf8();
        }
        if self.is_globally_allocated() {
            out.mark_global();
        }
        out
    }

    pub fn substring(&self, start_index: usize) -> ZigString {
        self.substring_with_len(self.len.min(start_index), self.len)
    }

    pub fn max_utf8_byte_length(&self) -> usize {
        if self.is_utf8() {
            return self.len;
        }
        if self.is_16bit() {
            return self.utf16_slice_aligned().len() * 3;
        }
        // latin1
        self.len * 2
    }

    pub fn utf16_byte_length(&self) -> usize {
        if self.is_utf8() {
            return simdutf::length::utf16::from::utf8(self.slice());
        }
        if self.is_16bit() {
            return self.len * 2;
        }
        // Latin-1 → UTF-16 byte length (encoding.zig:byteLengthU8(.utf16le)
        // returns `strings.elementLengthUTF8IntoUTF16(input) * 2`, which is
        // `simdutf.length.utf16.from.utf8(input) * 2`).
        simdutf::length::utf16::from::utf8(self.slice()) * 2
    }

    pub fn latin1_byte_length(&self) -> usize {
        if self.is_utf8() {
            panic!("TODO");
        }
        self.len
    }

    /// Count the number of bytes in the UTF-8 version of the string.
    /// This function is slow. Use max_utf8_byte_length() to get a quick estimate
    pub fn utf8_byte_length(&self) -> usize {
        if self.is_utf8() {
            return self.len;
        }
        if self.is_16bit() {
            return strings::element_length_utf16_into_utf8(self.utf16_slice_aligned());
        }
        // Latin-1 → UTF-8 byte length (encoding.zig:byteLengthU8(.utf8) is
        // `simdutf.length.utf8.from.latin1(input)`).
        simdutf::length::utf8::from::latin1(self.slice())
    }

    pub fn to_owned_slice(&self) -> Result<Vec<u8>, AllocError> {
        if self.is_utf8() {
            // Zig: allocator.dupeZ — keep trailing NUL capacity
            let mut v = Vec::with_capacity(self.slice().len() + 1);
            v.extend_from_slice(self.slice());
            v.push(0);
            v.pop();
            return Ok(v);
        }

        let list: Vec<u8> = Vec::new();
        let mut list = if self.is_16bit() {
            strings::to_utf8_list_with_type(list, self.utf16_slice_aligned())?
        } else {
            strings::allocate_latin1_into_utf8_with_list(list, 0, self.slice())
        };

        if list.capacity() > list.len() {
            // SAFETY: index is within capacity; writing a sentinel NUL into spare capacity.
            unsafe { *list.as_mut_ptr().add(list.len()) = 0 };
        }

        if list.capacity() > 0 && list.is_empty() {
            return Ok(Vec::new());
        }

        Ok(list)
    }

    pub fn to_owned_slice_z(&self) -> Result<bun_core::ZBox, AllocError> {
        if self.is_utf8() {
            let mut v = self.slice().to_vec();
            v.push(0);
            return Ok(bun_core::ZBox::from_vec_with_nul(v));
        }

        let list: Vec<u8> = Vec::new();
        let mut list = if self.is_16bit() {
            strings::to_utf8_list_with_type(list, self.utf16_slice_aligned())?
        } else {
            strings::allocate_latin1_into_utf8_with_list(list, 0, self.slice())
        };

        list.push(0);
        Ok(bun_core::ZBox::from_vec_with_nul(list))
    }

    pub fn trunc(&self, len: usize) -> ZigString {
        ZigString {
            _unsafe_ptr_do_not_use: self._unsafe_ptr_do_not_use,
            len: len.min(self.len),
        }
    }

    pub fn eql_comptime(&self, other: &'static [u8]) -> bool {
        if self.is_16bit() {
            return strings::eql_comptime_utf16(self.utf16_slice_aligned(), other);
        }

        // TODO(port): comptime strings.isAllASCII(other) check + @compileError for non-ASCII latin1
        if self.len != other.len() {
            return false;
        }
        strings::eql_comptime_ignore_len(self.slice(), other)
    }

    #[inline]
    pub fn length(&self) -> usize {
        self.len
    }

    pub fn byte_slice(&self) -> &[u8] {
        if self.is_16bit() {
            return bytemuck::cast_slice(self.utf16_slice_aligned());
        }
        self.slice()
    }

    pub fn mark_static(&mut self) {
        self._unsafe_ptr_do_not_use =
            ((self._unsafe_ptr_do_not_use as usize) | (1usize << 60)) as *const u8;
    }

    pub fn is_static(&self) -> bool {
        (self._unsafe_ptr_do_not_use as usize) & (1usize << 60) != 0
    }

    #[inline]
    pub fn is_16bit(&self) -> bool {
        (self._unsafe_ptr_do_not_use as usize) & (1usize << 63) != 0
    }

    #[inline]
    pub fn utf16_slice(&self) -> &[u16] {
        // TODO(port): Zig returns []align(1) const u16 — Rust slice requires alignment; callers must ensure alignment or use raw ptr reads
        #[cfg(debug_assertions)]
        if self.len > 0 && !self.is_16bit() {
            panic!("ZigString.utf16_slice() called on a latin1 string.\nPlease use .to_slice() instead or carefully check that .is_16bit() is false first.");
        }
        // SAFETY: pointer is tagged as 16-bit; untagged ptr is valid for len u16 reads.
        unsafe { slice::from_raw_parts(Self::untagged(self._unsafe_ptr_do_not_use).cast::<u16>(), self.len) }
    }

    #[inline]
    pub fn utf16_slice_aligned(&self) -> &[u16] {
        #[cfg(debug_assertions)]
        if self.len > 0 && !self.is_16bit() {
            panic!("ZigString.utf16_slice_aligned() called on a latin1 string.\nPlease use .to_slice() instead or carefully check that .is_16bit() is false first.");
        }
        // SAFETY: pointer is tagged as 16-bit and 2-byte aligned; untagged ptr is valid for len u16 reads.
        unsafe { slice::from_raw_parts(Self::untagged(self._unsafe_ptr_do_not_use).cast::<u16>(), self.len) }
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub fn from_string_pointer(ptr: bun_string::StringPointer, buf: &[u8]) -> ZigString {
        // PORT NOTE: reshaped from out-param `to: *ZigString` to return value
        ZigString {
            len: ptr.length as usize,
            _unsafe_ptr_do_not_use: buf[ptr.offset as usize..][..ptr.length as usize].as_ptr(),
        }
    }

    /// `ZigString.static` — borrow a `&'static` string literal. Mirrors
    /// `bun_string::ZigString::static_str` so callers can stay agnostic to
    /// which `ZigString` they imported.
    #[inline]
    pub fn static_str<S: ?Sized + AsRef<[u8]>>(s: &'static S) -> ZigString {
        ZigString::init(s.as_ref())
    }

    pub fn sort_desc(slice_: &mut [ZigString]) {
        // PORT NOTE: std.sort.block is stable; slice::sort_by is also stable.
        slice_.sort_by(|a, b| b.slice().cmp(a.slice()));
    }

    pub fn cmp_desc(a: &ZigString, b: &ZigString) -> bool {
        strings::cmp_strings_desc(&(), a.slice(), b.slice())
    }

    pub fn sort_asc(slice_: &mut [ZigString]) {
        slice_.sort_by(|a, b| a.slice().cmp(b.slice()));
    }

    pub fn cmp_asc(a: &ZigString, b: &ZigString) -> bool {
        strings::cmp_strings_asc(&(), a.slice(), b.slice())
    }

    #[inline]
    pub fn init(slice_: &[u8]) -> ZigString {
        ZigString { _unsafe_ptr_do_not_use: slice_.as_ptr(), len: slice_.len() }
    }

    pub fn init_utf8(slice_: &[u8]) -> ZigString {
        let mut out = Self::init(slice_);
        out.mark_utf8();
        out
    }

    pub fn from_utf8(slice_: &[u8]) -> ZigString {
        let mut out = Self::init(slice_);
        if !strings::is_all_ascii(slice_) {
            out.mark_utf8();
        }
        out
    }

    // TODO(port): `static(comptime slice_: [:0]const u8) -> *const ZigString` requires
    // per-literal const statics — needs a `zig_string_static!("...")` macro in Phase B.

    pub fn github_action(self) -> GithubActionFormatter {
        GithubActionFormatter { text: self }
    }

    pub fn to_atomic_value(&self, global_this: &JSGlobalObject) -> JSValue {
        // SAFETY: FFI call with valid #[repr(C)] pointer and live global borrow.
        unsafe { ZigString__toAtomicValue(self, global_this) }
    }

    pub fn init_utf16(items: &[u16]) -> ZigString {
        let mut out = ZigString {
            _unsafe_ptr_do_not_use: items.as_ptr().cast::<u8>(),
            len: items.len(),
        };
        out.mark_utf16();
        out
    }

    pub fn from16_slice(slice_: &[u16]) -> ZigString {
        Self::from16(slice_.as_ptr(), slice_.len())
    }

    fn from16_slice_maybe_global(slice_: &[u16], global: bool) -> ZigString {
        // SAFETY: reinterpret u16 ptr as u8 ptr for len u16 elements (tagged as utf16 below).
        let bytes = unsafe { slice::from_raw_parts(slice_.as_ptr().cast::<u8>(), slice_.len()) };
        let mut str = Self::init(bytes);
        str.mark_utf16();
        if global {
            str.mark_global();
        }
        str
    }

    /// Globally-allocated memory only
    pub fn from16(slice_: *const u16, len: usize) -> ZigString {
        // SAFETY: caller guarantees slice_ points to len valid u16s in global heap.
        let bytes = unsafe { slice::from_raw_parts(slice_.cast::<u8>(), len) };
        let mut str = Self::init(bytes);
        str.mark_utf16();
        str.mark_global();
        str.assert_global();
        str
    }

    // TODO(port): `bun_core::base64` module not yet exported. Gated.
    
    pub fn to_base64_data_url(&self) -> Result<Vec<u8>, bun_core::Error> {
        // TODO(port): narrow error set
        let slice_ = self.slice();
        const PREFIX: &[u8] = b"data:;base64,";
        let size = bun_core::base64::standard_encoder_calc_size(slice_.len());
        let mut buf = vec![0u8; size + PREFIX.len()];
        let encoded_len = bun_base64::encode_url_safe(&mut buf[PREFIX.len()..], slice_);
        buf[..PREFIX.len()].copy_from_slice(PREFIX);
        buf.truncate(PREFIX.len() + encoded_len);
        Ok(buf)
    }

    pub fn detect_encoding(&mut self) {
        if !strings::is_all_ascii(self.slice()) {
            self.mark_utf16();
        }
    }

    // `to_external_u16` is defined un-gated at module scope above (free fn +
    // inherent wrapper) — no duplicate here.

    pub fn is_utf8(&self) -> bool {
        (self._unsafe_ptr_do_not_use as usize) & (1usize << 61) != 0
    }

    pub fn mark_utf8(&mut self) {
        self._unsafe_ptr_do_not_use =
            ((self._unsafe_ptr_do_not_use as usize) | (1usize << 61)) as *const u8;
    }

    pub fn mark_utf16(&mut self) {
        self._unsafe_ptr_do_not_use =
            ((self._unsafe_ptr_do_not_use as usize) | (1usize << 63)) as *const u8;
    }

    pub fn set_output_encoding(&mut self) {
        if !self.is_16bit() {
            self.detect_encoding();
        }
        if self.is_16bit() {
            self.mark_utf8();
        }
    }

    #[inline]
    pub fn is_globally_allocated(&self) -> bool {
        (self._unsafe_ptr_do_not_use as usize) & (1usize << 62) != 0
    }

    #[inline]
    pub fn deinit_global(&self) {
        // SAFETY: slice() returns memory owned by global mimalloc when is_globally_allocated.
        // `mi_free` is size-agnostic (mimalloc tracks allocation metadata).
        unsafe { bun_alloc::mimalloc::mi_free(self.slice().as_ptr().cast_mut().cast::<c_void>()) };
    }

    #[inline]
    pub fn mark_global(&mut self) {
        self._unsafe_ptr_do_not_use =
            ((self._unsafe_ptr_do_not_use as usize) | (1usize << 62)) as *const u8;
    }

    // TODO(port): `JSValue::as_ref_()` (JSValueRef cast) not in JSValue.rs yet.
    
    #[inline]
    pub fn to_ref(slice_: &[u8], global: &JSGlobalObject) -> c_api::JSValueRef {
        Self::init(slice_).to_js(global).as_ref()
    }

    pub const EMPTY: ZigString = ZigString { _unsafe_ptr_do_not_use: b"".as_ptr(), len: 0 };

    #[inline]
    pub fn untagged(ptr: *const u8) -> *const u8 {
        // this can be null ptr, so long as it's also a 0 length string
        // PORT NOTE: Zig used @truncate to u53; mask low 53 bits explicitly.
        // Rust `slice::from_raw_parts` requires non-null even for len==0, so
        // map a null masked address to a dangling (non-null, aligned) pointer.
        let addr = (ptr as usize) & ((1usize << 53) - 1);
        if addr == 0 {
            core::ptr::NonNull::<u8>::dangling().as_ptr()
        } else {
            addr as *const u8
        }
    }

    pub fn slice(&self) -> &[u8] {
        #[cfg(debug_assertions)]
        if self.len > 0 && self.is_16bit() {
            panic!("ZigString.slice() called on a UTF-16 string.\nPlease use .to_slice() instead or carefully check that .is_16bit() is false first.");
        }
        let len = self.len.min(u32::MAX as usize);
        // SAFETY: untagged pointer is valid for len bytes when not 16-bit.
        unsafe { slice::from_raw_parts(Self::untagged(self._unsafe_ptr_do_not_use), len) }
    }

    pub fn to_slice_fast(&self) -> Slice {
        if self.len == 0 {
            return Slice::EMPTY;
        }
        if self.is_16bit() {
            let buffer = self.to_owned_slice().expect("OOM"); // bun.handleOom
            return Slice::Owned(buffer);
        }

        Slice::Static(Self::untagged(self._unsafe_ptr_do_not_use), self.len)
    }

    /// This function checks if the input is latin1 non-ascii.
    /// It is slow but safer when the input is from JavaScript.
    pub fn to_slice(&self) -> Slice {
        if self.len == 0 {
            return Slice::EMPTY;
        }
        if self.is_16bit() {
            let buffer = self.to_owned_slice().expect("OOM");
            return Slice::Owned(buffer);
        }

        // SAFETY: untagged ptr valid for self.len bytes.
        let raw = unsafe { slice::from_raw_parts(Self::untagged(self._unsafe_ptr_do_not_use), self.len) };
        if !self.is_utf8() && !strings::is_all_ascii(raw) {
            let buffer = self.to_owned_slice().expect("OOM");
            return Slice::Owned(buffer);
        }

        Slice::Static(Self::untagged(self._unsafe_ptr_do_not_use), self.len)
    }

    /// The returned slice is always allocated by the default allocator.
    pub fn to_slice_clone(&self) -> Result<Slice, AllocError> {
        if self.len == 0 {
            return Ok(Slice::EMPTY);
        }
        Ok(Slice::Owned(self.to_owned_slice()?))
    }

    pub fn slice_z_buf<'a>(&self, buf: &'a mut PathBuffer) -> Result<&'a ZStr, bun_core::Error> {
        // TODO(port): std.fmt.bufPrintZ with Display formatting into fixed buffer
        use std::io::Write as _;
        let buf_slice: &mut [u8] = &mut buf[..];
        let start_len = buf_slice.len();
        let mut cursor: &mut [u8] = buf_slice;
        write!(cursor, "{}", self).map_err(|_| bun_core::err!("NoSpaceLeft"))?;
        let written = start_len - cursor.len();
        if written >= buf.len() {
            return Err(bun_core::err!("NoSpaceLeft"));
        }
        buf[written] = 0;
        // SAFETY: buf[written] == 0 written above; bytes [0..written] initialized.
        Ok(unsafe { ZStr::from_raw(buf.as_ptr(), written) })
    }

    #[inline]
    pub fn full(&self) -> &[u8] {
        // SAFETY: untagged ptr valid for self.len bytes.
        unsafe { slice::from_raw_parts(Self::untagged(self._unsafe_ptr_do_not_use), self.len) }
    }

    pub fn trimmed_slice(&self) -> &[u8] {
        strings::trim(self.full(), b" \r\n")
    }

    #[inline]
    fn assert_global_if_needed(&self) {
        #[cfg(debug_assertions)]
        if self.is_globally_allocated() {
            self.assert_global();
        }
    }

    #[inline]
    fn assert_global(&self) {
        #[cfg(debug_assertions)]
        // SAFETY: read-only mimalloc probes; untagged ptr may be null when len==0.
        debug_assert!(
            self.len == 0
                || unsafe { bun_alloc::mimalloc::mi_is_in_heap_region(Self::untagged(self._unsafe_ptr_do_not_use).cast()) }
                || unsafe { bun_alloc::mimalloc::mi_check_owned(Self::untagged(self._unsafe_ptr_do_not_use).cast()) }
        );
    }

    pub fn to_external_value(&self, global: &JSGlobalObject) -> JSValue {
        self.assert_global();
        if self.len > BunString::max_length() {
            // SAFETY: byte_slice() memory was globally allocated by mimalloc.
            unsafe { bun_alloc::mimalloc::mi_free(self.byte_slice().as_ptr().cast_mut().cast::<c_void>()) };
            // TODO(port): propagate?
            let _ = global
                .err(
                    crate::ErrorCode::STRING_TOO_LONG,
                    format_args!("Cannot create a string longer than 2^32-1 characters"),
                )
                .throw();
            return JSValue::ZERO;
        }
        // SAFETY: self points to globally-allocated string; ownership transferred to JSC.
        unsafe { ZigString__toExternalValue(self, global) }
    }

    pub fn to_external_value_with_callback(
        &self,
        global: &JSGlobalObject,
        callback: unsafe extern "C" fn(ctx: *mut c_void, ptr: *mut c_void, len: usize),
    ) -> JSValue {
        // SAFETY: FFI call; callback frees the external buffer.
        unsafe { ZigString__toExternalValueWithCallback(self, global, callback) }
    }

    pub fn external(
        &self,
        global: &JSGlobalObject,
        ctx: *mut c_void,
        callback: unsafe extern "C" fn(ctx: *mut c_void, ptr: *mut c_void, len: usize),
    ) -> JSValue {
        if self.len > BunString::max_length() {
            // SAFETY: invoking caller-provided destructor on the buffer.
            unsafe { callback(ctx, self.byte_slice().as_ptr().cast_mut().cast::<c_void>(), self.len) };
            // TODO(port): propagate?
            let _ = global
                .err(
                    crate::ErrorCode::STRING_TOO_LONG,
                    format_args!("Cannot create a string longer than 2^32-1 characters"),
                )
                .throw();
            return JSValue::ZERO;
        }
        // SAFETY: FFI call; ownership of buffer transferred to JSC with ctx/callback.
        unsafe { ZigString__external(self, global, ctx, callback) }
    }

    pub fn to_16bit_value(&self, global: &JSGlobalObject) -> JSValue {
        self.assert_global();
        // SAFETY: FFI call with globally-allocated string.
        unsafe { ZigString__to16BitValue(self, global) }
    }

    pub fn with_encoding(&self) -> ZigString {
        let mut out = *self;
        out.set_output_encoding();
        out
    }

    // PORT NOTE: `to_js_string_ref` (Zig `toJSStringRef`) is dead code — the
    // Zig body is gated behind `@hasDecl(bun, "bindgen")` (always-false at
    // runtime) and `JSStringCreateStatic` has no exported body in Bun's link
    // image. No callers in either tree; dropped.

    pub fn to_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        // SAFETY: FFI call with valid pointers.
        unsafe { ZigString__toErrorInstance(self, global) }
    }

    pub fn to_type_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        // SAFETY: FFI call with valid pointers.
        unsafe { ZigString__toTypeErrorInstance(self, global) }
    }

    pub fn to_dom_exception_instance(&self, global: &JSGlobalObject, code: DOMExceptionCode) -> JSValue {
        // SAFETY: FFI call with valid pointers.
        unsafe { ZigString__toDOMExceptionInstance(self, global, code as u8) }
    }

    pub fn to_syntax_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        // SAFETY: FFI call with valid pointers.
        unsafe { ZigString__toSyntaxErrorInstance(self, global) }
    }

    pub fn to_range_error_instance(&self, global: &JSGlobalObject) -> JSValue {
        // SAFETY: FFI call with valid pointers.
        unsafe { ZigString__toRangeErrorInstance(self, global) }
    }
}

impl fmt::Display for ZigString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.is_utf8() {
            return write!(f, "{}", bstr::BStr::new(self.slice()));
        }
        if self.is_16bit() {
            return bun_fmt::format_utf16_type(self.utf16_slice_aligned(), f);
        }
        bun_fmt::format_latin1(self.slice(), f)
    }
}

pub struct GithubActionFormatter {
    pub text: ZigString,
}

impl fmt::Display for GithubActionFormatter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let bytes = self.text.to_slice();
        bun_fmt::github_action_writer(f, bytes.slice())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `NullableAllocator`-backed `Slice` struct port — the `#[repr(C)]`-shaped
// counterpart to the enum-based `bun_string::ZigStringSlice` (re-exported as
// `super::Slice`). Kept for FFI surfaces that need the raw `{allocator, ptr,
// len}` layout; the enum form is preferred for pure-Rust callers.
// ──────────────────────────────────────────────────────────────────────────

mod _slice_struct {
use super::*;
use bun_alloc::NullableAllocator;

/// A maybe-owned byte slice. Tracks its allocator so it can free on drop and so
/// callers can ask `is_wtf_allocated()`.
// TODO(port): NullableAllocator semantics — in Rust the global allocator is implicit, but
// Slice must distinguish WTF-backed vs mimalloc-backed vs borrowed for reportExtraMemory.
pub struct Slice {
    pub allocator: NullableAllocator,
    pub ptr: *const u8,
    pub len: u32,
}

impl Default for Slice {
    fn default() -> Self {
        Self { allocator: NullableAllocator::null(), ptr: b"".as_ptr(), len: 0 }
    }
}

impl Slice {
    pub const EMPTY: Slice = Slice { allocator: NullableAllocator::NULL, ptr: b"".as_ptr(), len: 0 };

    pub fn report_extra_memory(&self, vm: &VM) {
        // Don't report it if the memory is actually owned by jsc.
        if !self.allocator.is_null() && !self.allocator.is_wtf_allocator() {
            vm.report_extra_memory(self.len as usize);
        }
    }

    pub fn is_wtf_allocated(&self) -> bool {
        self.allocator.is_wtf_allocator()
    }

    pub fn init(input: &[u8]) -> Slice {
        // PORT NOTE: allocator param dropped; records default allocator
        Slice {
            ptr: input.as_ptr(),
            len: input.len() as u32,
            allocator: NullableAllocator::default_alloc(),
        }
    }

    pub fn init_dupe(input: &[u8]) -> Result<Slice, AllocError> {
        let len = input.len();
        let ptr = bun_core::heap::leak(Box::<[u8]>::from(input)).cast::<u8>();
        // SAFETY: ptr/len describe a freshly-allocated default-allocator block;
        // ownership moves into `Slice` (freed by its `Drop`).
        Ok(Self::init(unsafe { slice::from_raw_parts(ptr, len) }))
    }

    pub fn byte_length(&self) -> usize {
        self.len as usize
    }

    pub fn to_zig_string(&self) -> ZigString {
        if self.is_allocated() {
            return ZigString::init_utf8(self.slice());
        }
        ZigString::init(self.slice())
    }

    #[inline]
    pub fn length(&self) -> usize {
        self.len as usize
    }

    #[inline]
    pub fn byte_slice(&self) -> &[u8] {
        self.slice()
    }

    pub fn from_utf8_never_free(input: &[u8]) -> Slice {
        Slice {
            ptr: input.as_ptr(),
            len: input.len() as u32,
            allocator: NullableAllocator::null(),
        }
    }

    #[inline]
    pub fn is_allocated(&self) -> bool {
        !self.allocator.is_null()
    }

    pub fn to_owned(&self) -> Result<Slice, AllocError> {
        let ptr = bun_core::heap::leak(Box::<[u8]>::from(self.slice())).cast::<u8>();
        Ok(Slice {
            allocator: NullableAllocator::default_alloc(),
            ptr,
            len: self.len,
        })
    }

    /// Converts this `Slice` into a `Box<[u8]>` guaranteed to be allocated by the
    /// default allocator.
    ///
    /// This method consumes `self`. If you don't need the original string,
    /// this method may be more efficient than `to_owned`, which always allocates memory.
    pub fn into_owned_slice(mut self) -> Result<Box<[u8]>, AllocError> {
        // TODO(port): Zig compared allocator vtables to skip dupe when already default-allocated.
        // With global mimalloc this collapses to: if allocated by default → take ownership; else dupe.
        if let Some(a) = self.allocator.get() {
            if NullableAllocator::is_default(a) {
                let len = self.len as usize;
                self.allocator = NullableAllocator::null();
                // SAFETY: ptr/len were produced by heap::alloc / default allocator.
                let owned = unsafe { bun_core::heap::take(slice::from_raw_parts_mut(self.ptr.cast_mut(), len)) };
                self.ptr = b"".as_ptr();
                self.len = 0;
                return Ok(owned);
            }
        }
        let mut owned = self.to_owned()?;
        // self drops here, freeing original
        let len = owned.len as usize;
        let ptr = owned.ptr.cast_mut();
        // Disarm `owned`'s Drop (ownership moves into the returned Box).
        owned.allocator = NullableAllocator::null();
        owned.ptr = b"".as_ptr();
        owned.len = 0;
        // SAFETY: to_owned() produced a default-allocator Box<[u8]>; reconstruct it.
        Ok(unsafe { bun_core::heap::take(slice::from_raw_parts_mut(ptr, len)) })
    }

    /// Same as `into_owned_slice`, but creates a NUL-terminated slice.
    pub fn into_owned_slice_z(self) -> Result<bun_core::ZBox, AllocError> {
        // always clones — `Box<ZStr>` is intentionally unsupported (see
        // `bun_core::ZStr` docs); `ZBox` is the owned `[:0]u8` counterpart.
        Ok(bun_core::ZBox::from_vec_with_nul(self.slice().to_vec()))
        // self drops here
    }

    /// Note that the returned slice is not guaranteed to be allocated by the default allocator.
    pub fn clone_if_borrowed(self) -> Result<Slice, AllocError> {
        if self.is_allocated() {
            return Ok(self);
        }
        let len = self.len;
        let ptr = bun_core::heap::leak(Box::<[u8]>::from(self.slice())).cast::<u8>();
        Ok(Slice {
            allocator: NullableAllocator::default_alloc(),
            ptr,
            len,
        })
    }

    pub fn clone_with_trailing_slash(&self) -> Result<Slice, bun_core::Error> {
        // TODO(port): narrow error set
        let buf = strings::paths::clone_normalizing_separators(self.slice());
        let len = buf.len() as u32;
        let ptr = bun_core::heap::leak(buf.into_boxed_slice()).cast::<u8>();
        Ok(Slice {
            allocator: NullableAllocator::default_alloc(),
            ptr,
            len,
        })
    }

    pub fn slice(&self) -> &[u8] {
        // SAFETY: ptr/len are kept in sync by all constructors.
        unsafe { slice::from_raw_parts(self.ptr, self.len as usize) }
    }

    pub fn mut_(&mut self) -> &mut [u8] {
        debug_assert!(!self.allocator.is_null(), "cannot mutate a borrowed ZigString.Slice");
        // SAFETY: when allocated, we own the buffer exclusively.
        unsafe { slice::from_raw_parts_mut(self.ptr.cast_mut(), self.len as usize) }
    }
}

impl Drop for Slice {
    fn drop(&mut self) {
        // Does nothing if the slice is not allocated
        // SAFETY: ptr/len are kept in sync by all constructors.
        self.allocator
            .free(unsafe { slice::from_raw_parts(self.ptr, self.len as usize) });
    }
}
} // mod _slice_struct

#[unsafe(no_mangle)]
pub extern "C" fn ZigString__free(raw: *const u8, len: usize, allocator_: *mut c_void) {
    let Some(allocator_) = core::ptr::NonNull::new(allocator_) else { return };
    // TODO(port): Zig dereferenced *std.mem.Allocator from opaque ptr — Rust uses global mimalloc;
    // verify no callers pass a non-default allocator here.
    let _ = allocator_;
    // SAFETY: raw/len describe a valid slice allocated by the caller-provided allocator.
    let s = unsafe { slice::from_raw_parts(raw, len) };
    let ptr = ZigString::init(s).slice().as_ptr();
    #[cfg(debug_assertions)]
    // SAFETY: read-only heap-region probe.
    debug_assert!(unsafe { bun_alloc::mimalloc::mi_is_in_heap_region(ptr.cast()) });
    let _ = len;
    // SAFETY: ptr was allocated by mimalloc; mi_free is size-agnostic.
    unsafe { bun_alloc::mimalloc::mi_free(ptr.cast_mut().cast::<c_void>()) };
}

#[unsafe(no_mangle)]
pub extern "C" fn ZigString__freeGlobal(ptr: *const u8, len: usize) {
    // SAFETY: ptr/len describe a valid slice.
    let s = unsafe { slice::from_raw_parts(ptr, len) };
    let untagged = ZigString::init(s).slice().as_ptr().cast_mut().cast::<c_void>();
    #[cfg(debug_assertions)]
    // SAFETY: read-only heap-region probe.
    debug_assert!(unsafe { bun_alloc::mimalloc::mi_is_in_heap_region(ptr.cast()) });
    // we must untag the string pointer
    // SAFETY: untagged ptr was allocated by mimalloc.
    unsafe { bun_alloc::mimalloc::mi_free(untagged) };
}
} // mod _body

// ported from: src/jsc/ZigString.zig
