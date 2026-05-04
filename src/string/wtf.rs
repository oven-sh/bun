use core::ffi::c_void;

use crate::strings;
use crate::ZigString;
// TODO(port): ZigString.Slice is a nested type in Zig; in Rust it lives alongside ZigString.
use crate::zig_string::Slice as ZigStringSlice;
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
        ZigStringSlice::init(self.ref_count_allocator(), self.latin1_slice())
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

    pub fn to_owned_slice_z(&self) -> Box<ZStr> {
        // TODO(port): return type was [:0]u8 (owned NUL-terminated mutable slice).
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1_z(self.latin1_slice()) {
                // Zig: utf8.items[0 .. utf8.items.len - 1 :0]
                // SAFETY: to_utf8_from_latin1_z guarantees a trailing NUL byte.
                return unsafe { ZStr::from_vec_with_nul_unchecked(utf8) };
            }

            return ZStr::from_bytes(self.latin1_slice());
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
                // TODO(port): jsc.WebCore.encoding.byteLengthU8 lives in src/runtime/webcore/;
                // referencing across crates here. Phase B: confirm path.
                bun_runtime::webcore::encoding::byte_length_u8(
                    input.as_ptr(),
                    input.len(),
                    bun_runtime::webcore::encoding::Encoding::Utf8,
                )
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

    pub fn ref_count_allocator(&self) -> &dyn bun_alloc::Allocator {
        // TODO(port): Zig built a std.mem.Allocator { ptr: self, vtable: StringImplAllocator }.
        // In Rust, ZigStringSlice should hold an enum/trait object that knows how to deref the
        // WTFStringImpl on Drop instead of faking an allocator. See StringImplAllocator below.
        StringImplAllocator::for_impl(self)
    }

    pub fn has_prefix(&self, text: &[u8]) -> bool {
        // SAFETY: `self` is a valid WTF::StringImpl; text.ptr/len describe a valid slice.
        unsafe { Bun__WTFStringImpl__hasPrefix(self, text.as_ptr(), text.len()) }
    }
}

// TODO(port): Zig's `external_shared_descriptor` nested struct provided ref/deref fn pointers
// for `bun.ptr.ExternalShared`. In Rust this is a trait impl.
impl bun_ptr::ExternalSharedDescriptor for WTFStringImplStruct {
    fn r#ref(&self) {
        WTFStringImplStruct::r#ref(self)
    }
    fn deref(&self) {
        WTFStringImplStruct::deref(self)
    }
}

/// Behaves like `WTF::Ref<WTF::StringImpl>`.
pub type WTFString = bun_ptr::ExternalShared<WTFStringImplStruct>;

// TODO(port): StringImplAllocator is a Zig std.mem.Allocator vtable trick — alloc() does ref(),
// free() does deref(), so a ZigString.Slice holding this "allocator" will deref the StringImpl
// when freed. Rust ZigStringSlice should carry an explicit ownership tag instead. Kept here as
// a thin shim so to_latin1_slice/ref_count_allocator have something to call; Phase B should
// replace with the real ZigStringSlice ownership design.
pub struct StringImplAllocator;

impl StringImplAllocator {
    // TODO(port): signature/semantics depend on bun_alloc::Allocator trait shape.
    pub fn for_impl(_this: &WTFStringImplStruct) -> &'static dyn bun_alloc::Allocator {
        unimplemented!("StringImplAllocator: replace with ZigStringSlice ownership tag")
    }

    fn alloc(ptr: *mut c_void, len: usize) -> Option<*mut u8> {
        // SAFETY: ptr was constructed from a &WTFStringImplStruct in ref_count_allocator().
        let this = unsafe { &*(ptr as *const WTFStringImplStruct) };
        let len_ = this.byte_length();

        if len_ != len {
            // we don't actually allocate, we just reference count
            return None;
        }

        this.r#ref();

        // we should never actually allocate
        // SAFETY: returning the (immutable) backing buffer; callers never write through it.
        Some(unsafe { this.m_ptr.latin1 } as *mut u8)
    }

    pub fn free(ptr: *mut c_void, buf: &mut [u8]) {
        // SAFETY: ptr was constructed from a &WTFStringImplStruct in ref_count_allocator().
        let this = unsafe { &*(ptr as *const WTFStringImplStruct) };
        debug_assert!(this.latin1_slice().as_ptr() == buf.as_ptr());
        debug_assert!(this.latin1_slice().len() == buf.len());
        this.deref();
    }
}

// TODO(port): move to bun_str_sys (or bun_jsc_sys — these are WebKit C++ shims).
unsafe extern "C" {
    fn WTFStringImpl__isThreadSafe(this: *const WTFStringImplStruct) -> bool;
    fn Bun__WTFStringImpl__deref(this: *const WTFStringImplStruct);
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
