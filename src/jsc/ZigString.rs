//! Prefer using bun.String instead of ZigString in new code.

use core::ffi::c_void;
use core::fmt;
use core::slice;

use bun_alloc::{AllocError, NullableAllocator};
use bun_core::fmt as bun_fmt;
use bun_jsc::node::Encoding;
use bun_jsc::webcore::{encoding, DOMExceptionCode};
use bun_jsc::{c_api, JSGlobalObject, JSValue, VM};
use bun_paths::PathBuffer;
use bun_str::{strings, String as BunString, ZStr};

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn ZigString__toValueGC(arg0: *const ZigString, arg1: *const JSGlobalObject) -> JSValue;
    fn ZigString__toJSONObject(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
    fn BunString__toURL(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
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

/// Prefer using `bun_str::String` instead of `ZigString` in new code.
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

    pub fn encode(&self, encoding: Encoding) -> Vec<u8> {
        // PERF(port): was inline-else monomorphization over ByteString × Encoding — profile in Phase B
        match self.as_() {
            ByteString::Latin1(repr) => encoding::construct_from_u8(repr, encoding),
            ByteString::Utf16(repr) => encoding::construct_from_u16(repr, encoding),
        }
    }

    // Zig: encodeWithAllocator — allocator param dropped (global mimalloc)
    pub fn encode_with_allocator(&self, encoding: Encoding) -> Vec<u8> {
        self.encode(encoding)
    }

    pub fn dupe_for_js(utf8: &[u8]) -> Result<ZigString, bun_core::Error> {
        // TODO(port): narrow error set
        if let Some(utf16) = strings::to_utf16_alloc(utf8, false, false)? {
            // PERF(port): leaks Box<[u16]> into raw for global ownership — matches Zig semantics
            let leaked: &'static [u16] = Box::leak(utf16.into_boxed_slice());
            let mut out = ZigString::init_utf16(leaked);
            out.mark_global();
            out.mark_utf16();
            Ok(out)
        } else {
            let duped: &'static [u8] = Box::leak(Box::<[u8]>::from(utf8));
            let mut out = ZigString::init(duped);
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
        let leaked = Box::leak(buffer.into_boxed_slice());
        Slice {
            allocator: NullableAllocator::default_alloc(),
            ptr: leaked.as_ptr(),
            len: leaked.len() as u32,
        }
    }

    pub fn index_of_any(&self, chars: &'static [u8]) -> Option<strings::OptionalUsize> {
        if self.is_16bit() {
            strings::index_of_any16(self.utf16_slice_aligned(), chars)
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
                bytemuck::cast_slice(self.utf16_slice_aligned()),
                bytemuck::cast_slice(other.utf16_slice_aligned()),
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
        bun_jsc::mark_binding!();
        // SAFETY: self points to valid #[repr(C)] data; global_this is a live borrow.
        unsafe { ZigString__toJSONObject(self, global_this) }
    }

    pub fn to_url(&self, global_this: &JSGlobalObject) -> JSValue {
        bun_jsc::mark_binding!();
        // SAFETY: self points to valid #[repr(C)] data; global_this is a live borrow.
        unsafe { BunString__toURL(self, global_this) }
    }

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
            return bun_simdutf::length::utf16_from_utf8(self.slice());
        }
        if self.is_16bit() {
            return self.len * 2;
        }
        let s = self.slice();
        encoding::byte_length_u8(s.as_ptr(), s.len(), Encoding::Utf16le)
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
        let s = self.slice();
        encoding::byte_length_u8(s.as_ptr(), s.len(), Encoding::Utf8)
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

        let mut list: Vec<u8> = Vec::new();
        list = if self.is_16bit() {
            strings::to_utf8_list_with_type(list, self.utf16_slice_aligned())?
        } else {
            strings::allocate_latin1_into_utf8_with_list(list, 0, self.slice())?
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

    pub fn to_owned_slice_z(&self) -> Result<Box<ZStr>, AllocError> {
        // TODO(port): owned NUL-terminated slice type — using Box<ZStr> placeholder
        if self.is_utf8() {
            return Ok(ZStr::from_bytes(self.slice()));
        }

        let mut list: Vec<u8> = Vec::new();
        list = if self.is_16bit() {
            strings::to_utf8_list_with_type(list, self.utf16_slice_aligned())?
        } else {
            strings::allocate_latin1_into_utf8_with_list(list, 0, self.slice())?
        };

        list.push(0);
        // TODO(port): list.toOwnedSliceSentinel(0) — verify ZStr::from_vec_with_nul semantics
        Ok(ZStr::from_vec_with_nul(list))
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

    pub fn from_string_pointer(ptr: StringPointer, buf: &[u8]) -> ZigString {
        // PORT NOTE: reshaped from out-param `to: *ZigString` to return value
        ZigString {
            len: ptr.length,
            _unsafe_ptr_do_not_use: buf[ptr.offset..][..ptr.length].as_ptr(),
        }
    }

    pub fn sort_desc(slice_: &mut [ZigString]) {
        slice_.sort_by(|a, b| {
            if Self::cmp_desc(a, b) { core::cmp::Ordering::Less } else { core::cmp::Ordering::Greater }
        });
        // TODO(port): std.sort.block is stable; sort_by is unstable-order — verify Phase B
    }

    pub fn cmp_desc(a: &ZigString, b: &ZigString) -> bool {
        strings::cmp_strings_desc(a.slice(), b.slice())
    }

    pub fn sort_asc(slice_: &mut [ZigString]) {
        slice_.sort_by(|a, b| {
            if Self::cmp_asc(a, b) { core::cmp::Ordering::Less } else { core::cmp::Ordering::Greater }
        });
    }

    pub fn cmp_asc(a: &ZigString, b: &ZigString) -> bool {
        strings::cmp_strings_asc(a.slice(), b.slice())
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

    pub fn to_base64_data_url(&self) -> Result<Vec<u8>, bun_core::Error> {
        // TODO(port): narrow error set
        let slice_ = self.slice();
        const PREFIX: &[u8] = b"data:;base64,";
        let size = bun_core::base64::standard_encoded_len(slice_.len());
        let mut buf = vec![0u8; size + PREFIX.len()];
        let encoded_len = bun_core::base64::url_safe_encode(&mut buf[PREFIX.len()..], slice_);
        buf[..PREFIX.len()].copy_from_slice(PREFIX);
        buf.truncate(PREFIX.len() + encoded_len);
        Ok(buf)
    }

    pub fn detect_encoding(&mut self) {
        if !strings::is_all_ascii(self.slice()) {
            self.mark_utf16();
        }
    }

    pub fn to_external_u16(ptr: *const u16, len: usize, global: &JSGlobalObject) -> JSValue {
        if len > BunString::max_length() {
            // SAFETY: ptr was allocated by global mimalloc with len u16 elements.
            unsafe { bun_alloc::free_slice(ptr as *mut u16, len) };
            // TODO(port): propagate?
            let _ = global.err(bun_jsc::ErrorCode::STRING_TOO_LONG, "Cannot create a string longer than 2^32-1 characters").throw();
            return JSValue::ZERO;
        }
        // SAFETY: ptr/len describe a globally-allocated UTF-16 buffer; ownership transferred to JSC.
        unsafe { ZigString__toExternalU16(ptr, len, global) }
    }

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
        unsafe { bun_alloc::free_slice(self.slice().as_ptr() as *mut u8, self.slice().len()) };
    }

    #[inline]
    pub fn mark_global(&mut self) {
        self._unsafe_ptr_do_not_use =
            ((self._unsafe_ptr_do_not_use as usize) | (1usize << 62)) as *const u8;
    }

    #[inline]
    pub fn to_ref(slice_: &[u8], global: &JSGlobalObject) -> c_api::JSValueRef {
        Self::init(slice_).to_js(global).as_ref_()
    }

    pub const EMPTY: ZigString = ZigString { _unsafe_ptr_do_not_use: b"".as_ptr(), len: 0 };

    #[inline]
    pub fn untagged(ptr: *const u8) -> *const u8 {
        // this can be null ptr, so long as it's also a 0 length string
        ((ptr as usize) & ((1usize << 53) - 1)) as *const u8
        // PORT NOTE: Zig used @truncate to u53; mask low 53 bits explicitly.
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
            let leaked = Box::leak(buffer.into_boxed_slice());
            return Slice {
                allocator: NullableAllocator::default_alloc(),
                ptr: leaked.as_ptr(),
                len: leaked.len() as u32,
            };
        }

        Slice {
            allocator: NullableAllocator::null(),
            ptr: Self::untagged(self._unsafe_ptr_do_not_use),
            len: self.len as u32,
        }
    }

    /// This function checks if the input is latin1 non-ascii.
    /// It is slow but safer when the input is from JavaScript.
    pub fn to_slice(&self) -> Slice {
        if self.len == 0 {
            return Slice::EMPTY;
        }
        if self.is_16bit() {
            let buffer = self.to_owned_slice().expect("OOM");
            let leaked = Box::leak(buffer.into_boxed_slice());
            return Slice {
                allocator: NullableAllocator::default_alloc(),
                ptr: leaked.as_ptr(),
                len: leaked.len() as u32,
            };
        }

        // SAFETY: untagged ptr valid for self.len bytes.
        let raw = unsafe { slice::from_raw_parts(Self::untagged(self._unsafe_ptr_do_not_use), self.len) };
        if !self.is_utf8() && !strings::is_all_ascii(raw) {
            let buffer = self.to_owned_slice().expect("OOM");
            let leaked = Box::leak(buffer.into_boxed_slice());
            return Slice {
                allocator: NullableAllocator::default_alloc(),
                ptr: leaked.as_ptr(),
                len: leaked.len() as u32,
            };
        }

        Slice {
            allocator: NullableAllocator::null(),
            ptr: Self::untagged(self._unsafe_ptr_do_not_use),
            len: self.len as u32,
        }
    }

    /// The returned slice is always allocated by the default allocator.
    pub fn to_slice_clone(&self) -> Result<Slice, AllocError> {
        if self.len == 0 {
            return Ok(Slice::EMPTY);
        }
        let buffer = self.to_owned_slice()?;
        let leaked = Box::leak(buffer.into_boxed_slice());
        Ok(Slice {
            allocator: NullableAllocator::default_alloc(),
            ptr: leaked.as_ptr(),
            len: leaked.len() as u32,
        })
    }

    pub fn slice_z_buf<'a>(&self, buf: &'a mut PathBuffer) -> Result<&'a ZStr, bun_core::Error> {
        // TODO(port): std.fmt.bufPrintZ with Display formatting into fixed buffer
        use std::io::Write;
        let mut cursor = &mut buf[..];
        let start_len = cursor.len();
        write!(cursor, "{}", self).map_err(|_| bun_core::err!("NoSpaceLeft"))?;
        let written = start_len - cursor.len();
        if written >= buf.len() {
            return Err(bun_core::err!("NoSpaceLeft"));
        }
        buf[written] = 0;
        // SAFETY: buf[written] == 0 written above.
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
        debug_assert!(
            self.len == 0
                || bun_alloc::mimalloc::mi_is_in_heap_region(Self::untagged(self._unsafe_ptr_do_not_use).cast())
                || bun_alloc::mimalloc::mi_check_owned(Self::untagged(self._unsafe_ptr_do_not_use).cast())
        );
    }

    pub fn to_external_value(&self, global: &JSGlobalObject) -> JSValue {
        self.assert_global();
        if self.len > BunString::max_length() {
            // SAFETY: byte_slice() memory was globally allocated.
            unsafe { bun_alloc::free_slice(self.byte_slice().as_ptr() as *mut u8, self.byte_slice().len()) };
            // TODO(port): propagate?
            let _ = global.err(bun_jsc::ErrorCode::STRING_TOO_LONG, "Cannot create a string longer than 2^32-1 characters").throw();
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
            unsafe { callback(ctx, self.byte_slice().as_ptr() as *mut c_void, self.len) };
            // TODO(port): propagate?
            let _ = global.err(bun_jsc::ErrorCode::STRING_TOO_LONG, "Cannot create a string longer than 2^32-1 characters").throw();
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

    pub fn to_js_string_ref(&self) -> c_api::JSStringRef {
        // TODO(port): Zig had `if @hasDecl(bun, "bindgen") return undefined` — bindgen-mode stub dropped
        if self.is_16bit() {
            // SAFETY: untagged ptr is 2-byte aligned UTF-16 data valid for self.len u16s.
            unsafe {
                c_api::JSStringCreateWithCharactersNoCopy(
                    Self::untagged(self._unsafe_ptr_do_not_use).cast::<u16>(),
                    self.len,
                )
            }
        } else {
            // SAFETY: untagged ptr is valid latin1 for self.len bytes.
            unsafe { c_api::JSStringCreateStatic(Self::untagged(self._unsafe_ptr_do_not_use), self.len) }
        }
    }

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
        if let Some(allocator) = self.allocator.get() {
            // Don't report it if the memory is actually owned by jsc.
            if !BunString::is_wtf_allocator(allocator) {
                vm.deprecated_report_extra_memory(self.len as usize);
            }
        }
    }

    pub fn is_wtf_allocated(&self) -> bool {
        match self.allocator.get() {
            Some(a) => BunString::is_wtf_allocator(a),
            None => false,
        }
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
        let duped: &'static [u8] = Box::leak(Box::<[u8]>::from(input));
        Ok(Self::init(duped))
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
        let duped: &'static [u8] = Box::leak(Box::<[u8]>::from(self.slice()));
        Ok(Slice {
            allocator: NullableAllocator::default_alloc(),
            ptr: duped.as_ptr(),
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
                // SAFETY: ptr/len were produced by Box::leak / default allocator.
                let owned = unsafe { Box::from_raw(slice::from_raw_parts_mut(self.ptr as *mut u8, len)) };
                self.ptr = b"".as_ptr();
                self.len = 0;
                return Ok(owned);
            }
        }
        let owned = self.to_owned()?;
        // self drops here, freeing original
        let len = owned.len as usize;
        let ptr = owned.ptr as *mut u8;
        core::mem::forget(owned);
        // SAFETY: to_owned() leaked a Box<[u8]> via default allocator.
        Ok(unsafe { Box::from_raw(slice::from_raw_parts_mut(ptr, len)) })
    }

    /// Same as `into_owned_slice`, but creates a NUL-terminated slice.
    pub fn into_owned_slice_z(self) -> Result<Box<ZStr>, AllocError> {
        // always clones
        Ok(ZStr::from_bytes(self.slice()))
        // self drops here
    }

    /// Note that the returned slice is not guaranteed to be allocated by the default allocator.
    pub fn clone_if_borrowed(self) -> Result<Slice, AllocError> {
        if self.is_allocated() {
            return Ok(self);
        }
        let duped: &'static [u8] = Box::leak(Box::<[u8]>::from(self.slice()));
        Ok(Slice {
            allocator: NullableAllocator::default_alloc(),
            ptr: duped.as_ptr(),
            len: self.len,
        })
    }

    pub fn clone_with_trailing_slash(&self) -> Result<Slice, bun_core::Error> {
        // TODO(port): narrow error set
        let buf = strings::clone_normalizing_separators(self.slice())?;
        let leaked = Box::leak(buf.into_boxed_slice());
        Ok(Slice {
            allocator: NullableAllocator::default_alloc(),
            ptr: leaked.as_ptr(),
            len: leaked.len() as u32,
        })
    }

    pub fn slice(&self) -> &[u8] {
        // SAFETY: ptr/len are kept in sync by all constructors.
        unsafe { slice::from_raw_parts(self.ptr, self.len as usize) }
    }

    pub fn mut_(&mut self) -> &mut [u8] {
        debug_assert!(!self.allocator.is_null(), "cannot mutate a borrowed ZigString.Slice");
        // SAFETY: when allocated, we own the buffer exclusively.
        unsafe { slice::from_raw_parts_mut(self.ptr as *mut u8, self.len as usize) }
    }
}

impl Drop for Slice {
    fn drop(&mut self) {
        // Does nothing if the slice is not allocated
        self.allocator.free(self.ptr, self.len as usize);
    }
}

#[derive(Copy, Clone, Default)]
pub struct StringPointer {
    pub offset: usize,
    pub length: usize,
}

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
    debug_assert!(bun_alloc::mimalloc::mi_is_in_heap_region(ptr.cast()));
    // SAFETY: ptr was allocated by mimalloc with len bytes.
    unsafe { bun_alloc::free_slice(ptr as *mut u8, len) };
}

#[unsafe(no_mangle)]
pub extern "C" fn ZigString__freeGlobal(ptr: *const u8, len: usize) {
    // SAFETY: ptr/len describe a valid slice.
    let s = unsafe { slice::from_raw_parts(ptr, len) };
    let untagged = ZigString::init(s).slice().as_ptr() as *mut c_void;
    #[cfg(debug_assertions)]
    debug_assert!(bun_alloc::mimalloc::mi_is_in_heap_region(ptr.cast()));
    // we must untag the string pointer
    // SAFETY: untagged ptr was allocated by mimalloc.
    unsafe { bun_alloc::mimalloc::mi_free(untagged) };
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/ZigString.zig (865 lines)
//   confidence: medium
//   todos:      18
//   notes:      Slice keeps NullableAllocator to distinguish WTF/mimalloc/borrowed; `static()` needs macro; allocator params dropped per guide but Slice ownership model needs Phase B review
// ──────────────────────────────────────────────────────────────────────────
