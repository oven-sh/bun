use core::ffi::c_void;

use crate::strings;
use crate::ZigString;
// TODO(port): ZigString.Slice is a nested type in Zig; in Rust it lives alongside ZigString.
use crate::ZigStringSlice;
use crate::ZStr;

pub type WTFStringImpl = *mut WTFStringImplStruct;

#[repr(C)]
#[derive(Clone, Copy)]
pub union WTFStringImplPtr {
    pub latin1: *const u8,
    pub utf16: *const u16,
}

#[repr(C)]
pub struct WTFStringImplStruct {
    pub m_ref_count: u32,
    pub m_length: u32,
    pub m_ptr: WTFStringImplPtr,
    pub m_hash_and_flags: u32,
}

// ---------------------------------------------------------------------
// These details must stay in sync with WTFStringImpl.h in WebKit!
// ---------------------------------------------------------------------
const S_FLAG_COUNT: u32 = 8;

#[allow(dead_code)]
const S_FLAG_MASK: u32 = (1 << S_FLAG_COUNT) - 1;
#[allow(dead_code)]
const S_FLAG_STRING_KIND_COUNT: u32 = 4;
#[allow(dead_code)]
const S_HASH_ZERO_VALUE: u32 = 0;
#[allow(dead_code)]
const S_HASH_FLAG_STRING_KIND_IS_ATOM: u32 = 1u32 << S_FLAG_STRING_KIND_COUNT;
#[allow(dead_code)]
const S_HASH_FLAG_STRING_KIND_IS_SYMBOL: u32 = 1u32 << (S_FLAG_STRING_KIND_COUNT + 1);
#[allow(dead_code)]
const S_HASH_MASK_STRING_KIND: u32 =
    S_HASH_FLAG_STRING_KIND_IS_ATOM | S_HASH_FLAG_STRING_KIND_IS_SYMBOL;
#[allow(dead_code)]
const S_HASH_FLAG_DID_REPORT_COST: u32 = 1u32 << 3;
const S_HASH_FLAG_8BIT_BUFFER: u32 = 1 << 2;
#[allow(dead_code)]
const S_HASH_MASK_BUFFER_OWNERSHIP: u32 = (1 << 0) | (1 << 1);

/// The bottom bit in the ref count indicates a static (immortal) string.
#[allow(dead_code)]
const S_REF_COUNT_FLAG_IS_STATIC_STRING: u32 = 0x1;

/// This allows us to ref / deref without disturbing the static string flag.
const S_REF_COUNT_INCREMENT: u32 = 0x2;

// ---------------------------------------------------------------------

impl WTFStringImplStruct {
    pub const MAX: u32 = u32::MAX;

    pub fn ref_count(&self) -> u32 {
        self.m_ref_count / S_REF_COUNT_INCREMENT
    }

    pub fn memory_cost(&self) -> usize {
        self.byte_length()
    }

    pub fn is_static(&self) -> bool {
        self.m_ref_count & S_REF_COUNT_INCREMENT != 0
    }

    pub fn byte_length(&self) -> usize {
        if self.is_8bit() {
            self.m_length as usize
        } else {
            self.m_length as usize * 2
        }
    }

    pub fn is_thread_safe(&self) -> bool {
        // SAFETY: `self` is a valid &WTFStringImplStruct backed by a live WTF::StringImpl.
        unsafe { WTFStringImpl__isThreadSafe(self) }
    }

    pub fn byte_slice(&self) -> &[u8] {
        // SAFETY: m_ptr.latin1 is always a valid byte pointer regardless of encoding,
        // and byte_length() covers exactly the backing buffer.
        unsafe { core::slice::from_raw_parts(self.m_ptr.latin1, self.byte_length()) }
    }

    #[inline]
    pub fn is_8bit(&self) -> bool {
        (self.m_hash_and_flags & S_HASH_FLAG_8BIT_BUFFER) != 0
    }

    #[inline]
    pub fn length(&self) -> u32 {
        self.m_length
    }

    #[inline]
    pub fn utf16_slice(&self) -> &[u16] {
        debug_assert!(!self.is_8bit());
        // SAFETY: when !is_8bit(), m_ptr.utf16 points to m_length u16 code units.
        unsafe { core::slice::from_raw_parts(self.m_ptr.utf16, self.length() as usize) }
    }

    #[inline]
    pub fn latin1_slice(&self) -> &[u8] {
        debug_assert!(self.is_8bit());
        // SAFETY: when is_8bit(), m_ptr.latin1 points to m_length bytes.
        unsafe { core::slice::from_raw_parts(self.m_ptr.latin1, self.length() as usize) }
    }

    /// Caller must ensure that the string is 8-bit and ASCII.
    #[inline]
    pub fn utf8_slice(&self) -> &[u8] {
        if cfg!(debug_assertions) {
            debug_assert!(self.can_use_as_utf8());
        }
        // SAFETY: caller contract (8-bit + ASCII) guarantees latin1 bytes are valid UTF-8.
        unsafe { core::slice::from_raw_parts(self.m_ptr.latin1, self.length() as usize) }
    }

    pub fn to_zig_string(&self) -> ZigString {
        if self.is_8bit() {
            ZigString::init(self.latin1_slice())
        } else {
            ZigString::init_utf16(self.utf16_slice())
        }
    }

    #[inline]
    pub fn deref(&self) {
        // TODO(port): jsc.markBinding(@src()) — debug-only binding tracer
        let current_count = self.ref_count();
        debug_assert!(self.has_at_least_one_ref()); // do not use current_count, it breaks for static strings
        // SAFETY: `self` is a valid &WTFStringImplStruct backed by a live WTF::StringImpl.
        unsafe { Bun__WTFStringImpl__deref(self) };
        if cfg!(debug_assertions) {
            if current_count > 1 {
                debug_assert!(self.ref_count() < current_count || self.is_static());
            }
        }
    }

    #[inline]
    pub fn r#ref(&self) {
        // TODO(port): jsc.markBinding(@src()) — debug-only binding tracer
        let current_count = self.ref_count();
        debug_assert!(self.has_at_least_one_ref()); // do not use current_count, it breaks for static strings
        // SAFETY: `self` is a valid &WTFStringImplStruct backed by a live WTF::StringImpl.
        unsafe { Bun__WTFStringImpl__ref(self) };
        debug_assert!(self.ref_count() > current_count || self.is_static());
        let _ = current_count;
    }

    #[inline]
    pub fn has_at_least_one_ref(&self) -> bool {
        // WTF::StringImpl::hasAtLeastOneRef
        self.m_ref_count > 0
    }

    pub fn to_latin1_slice(&self) -> ZigStringSlice {
        self.r#ref();
        let s = self.latin1_slice();
        // ZigStringSlice::WTF derefs `self` on Drop — replaces the Zig
        // StringImplAllocator vtable trick with explicit ownership.
        // SAFETY: `self` is a live WTF::StringImpl with refcount just bumped above;
        // we store only a `*const` (never materialize `&mut`) and the matching
        // deref happens via FFI on Drop. Mutation of m_ref_count is C++-side
        // interior mutability, same as `r#ref`/`deref` already rely on.
        ZigStringSlice::WTF {
            string_impl: std::ptr::from_ref::<Self>(self),
            ptr: s.as_ptr(),
            len: s.len(),
        }
    }

    /// Compute the hash() if necessary
    pub fn ensure_hash(&self) {
        // TODO(port): jsc.markBinding(@src()) — debug-only binding tracer
        // SAFETY: `self` is a valid &WTFStringImplStruct backed by a live WTF::StringImpl.
        unsafe { Bun__WTFStringImpl__ensureHash(self) };
    }

    pub fn to_utf8(&self) -> ZigStringSlice {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1(self.latin1_slice()) {
                return ZigStringSlice::init_owned(utf8);
            }

            return self.to_latin1_slice();
        }

        ZigStringSlice::init_owned(strings::to_utf8_alloc(self.utf16_slice()))
    }

    pub fn to_utf8_without_ref(&self) -> ZigStringSlice {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1(self.latin1_slice()) {
                return ZigStringSlice::init_owned(utf8);
            }

            return ZigStringSlice::from_utf8_never_free(self.latin1_slice());
        }

        ZigStringSlice::init_owned(strings::to_utf8_alloc(self.utf16_slice()))
    }

    /// Allocates a NUL-terminated UTF-8 copy. Port of `toOwnedSliceZ`.
    /// `.len()` excludes the sentinel (Zig `[:0]u8` semantics).
    pub fn to_owned_slice_z(&self) -> bun_core::ZBox {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1_z(self.latin1_slice()) {
                return utf8;
            }
            // ASCII: copy bytes; ZBox appends the NUL.
            return bun_core::ZBox::from_vec_with_nul(self.latin1_slice().to_vec());
        }
        strings::to_utf8_alloc_z(self.utf16_slice())
    }

    pub fn to_utf8_if_needed(&self) -> Option<ZigStringSlice> {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1(self.latin1_slice()) {
                return Some(ZigStringSlice::init_owned(utf8));
            }

            return None;
        }

        Some(ZigStringSlice::init_owned(strings::to_utf8_alloc(
            self.utf16_slice(),
        )))
    }

    /// Avoid using this in code paths that are about to get the string as a UTF-8
    /// In that case, use to_utf8_if_needed instead.
    pub fn can_use_as_utf8(&self) -> bool {
        self.is_8bit() && strings::is_all_ascii(self.latin1_slice())
    }

    pub fn utf16_byte_length(&self) -> usize {
        if self.is_8bit() {
            self.length() as usize * 2
        } else {
            self.length() as usize
        }
    }

    pub fn utf8_byte_length(&self) -> usize {
        if self.is_8bit() {
            let input = self.latin1_slice();
            if !input.is_empty() {
                // Port: latin1→utf8 length is just elementLengthLatin1IntoUTF8
                // (each high byte becomes 2 utf8 bytes). The Zig went through
                // jsc.WebCore.encoding.byteLengthU8 but for Utf8 target that
                // reduces to the same arithmetic.
                strings::element_length_latin1_into_utf8(input)
            } else {
                0
            }
        } else {
            let input = self.utf16_slice();
            if !input.is_empty() {
                strings::element_length_utf16_into_utf8(input)
            } else {
                0
            }
        }
    }

    pub fn latin1_byte_length(&self) -> usize {
        // Not all UTF-16 characters fit are representable in latin1.
        // Those get truncated?
        self.length() as usize
    }

    pub fn has_prefix(&self, text: &[u8]) -> bool {
        // SAFETY: `self` is a valid WTF::StringImpl; text.ptr/len describe a valid slice.
        unsafe { Bun__WTFStringImpl__hasPrefix(self, text.as_ptr(), text.len()) }
    }
}

// SAFETY: ref/deref delegate to JSC's WTF::StringImpl atomic refcount via FFI;
// the pointee remains valid while count > 0 (JSC contract).
unsafe impl bun_ptr::ExternalSharedDescriptor for WTFStringImplStruct {
    unsafe fn ext_ref(this: *mut Self) {
        // SAFETY: caller guarantees `this` is a live WTFStringImpl.
        unsafe { (*this).r#ref() }
    }
    unsafe fn ext_deref(this: *mut Self) {
        // SAFETY: caller guarantees `this` is a live WTFStringImpl.
        unsafe { (*this).deref() }
    }
}

/// Behaves like `WTF::Ref<WTF::StringImpl>`.
pub type WTFString = bun_ptr::ExternalShared<WTFStringImplStruct>;

/// `WTF::RefPtr<T>` — a nullable owning reference into an externally-refcounted
/// object. Generic re-export so callers can write `wtf::RefPtr<StringImpl>`
/// (matching the C++ spelling) without reaching into `bun_ptr` directly.
pub type RefPtr<T> = bun_ptr::ExternalShared<T>;

/// `WTF::StringImpl` — alias to the layout-mirroring struct so call sites can
/// spell `wtf::StringImpl` (used by `wtf::RefPtr<StringImpl>`).
pub type StringImpl = WTFStringImplStruct;

// PORT NOTE: Zig's `StringImplAllocator` was a `std.mem.Allocator` vtable trick
// (alloc() bumped ref, free() dropped it) so a `ZigString.Slice` would deref the
// WTFStringImpl when freed. Replaced by `ZigStringSlice::WTF { .. }` explicit
// ownership variant — see `to_latin1_slice` above. No allocator trait needed.

// ──────────────────────────────────────────────────────────────────────────
// move-in: parse_double (MOVE_DOWN ← src/jsc/WTF.zig `WTF.parseDouble`)
//
// Thin wrapper around WebKit's WTF__parseDouble. Lives here so
// `bun_interchange` (yaml) and `bun_js_parser::lexer` can call it without
// depending on `bun_jsc`.
// ──────────────================================================────────────

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub struct InvalidCharacter;

pub fn parse_double(buf: &[u8]) -> Result<f64, InvalidCharacter> {
    if buf.is_empty() {
        return Err(InvalidCharacter);
    }
    let mut count: usize = 0;
    // SAFETY: buf is a valid slice; WTF__parseDouble reads at most `length` bytes.
    let res = unsafe { WTF__parseDouble(buf.as_ptr(), buf.len(), &raw mut count) };
    if count == 0 {
        return Err(InvalidCharacter);
    }
    Ok(res)
}

// TODO(port): move to bun_str_sys (or bun_jsc_sys — these are WebKit C++ shims).
unsafe extern "C" {
    fn WTF__parseDouble(bytes: *const u8, length: usize, counted: *mut usize) -> f64;
    fn WTFStringImpl__isThreadSafe(this: *const WTFStringImplStruct) -> bool;
    pub(crate) fn Bun__WTFStringImpl__deref(this: *const WTFStringImplStruct);
    fn Bun__WTFStringImpl__ref(this: *const WTFStringImplStruct);
    fn Bun__WTFStringImpl__ensureHash(this: *const WTFStringImplStruct);
    fn Bun__WTFStringImpl__hasPrefix(
        this: *const WTFStringImplStruct,
        text_ptr: *const u8,
        text_len: usize,
    ) -> bool;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/string/wtf.zig (272 lines)
//   confidence: medium
//   todos:      11
//   notes:      StringImplAllocator vtable trick needs redesign around ZigStringSlice ownership; ref/deref use r#ref raw ident; utf8_byte_length reaches into bun_runtime::webcore.
// ──────────────────────────────────────────────────────────────────────────
