use core::sync::atomic::{AtomicU32, Ordering};

use bun_alloc::StdAllocator;

use crate::string::{ZigString, ZigStringSlice};
use crate::strings;

/// Behaves like `WTF::Ref<WTF::StringImpl>`. The
/// [`crate::external_shared::ExternalSharedDescriptor`] impl lives in
/// `bun_core::external_shared` alongside the trait.
pub use crate::external_shared::WTFString;

/// `WTF::RefPtr<T>` — a nullable owning reference into an externally-refcounted
/// object. Generic re-export so callers can write `wtf::RefPtr<StringImpl>`
/// (matching the C++ spelling) without reaching into `bun_ptr` directly.
pub type RefPtr<T> = crate::external_shared::ExternalShared<T>;

/// `WTF::StringImpl` — alias to the layout-mirroring struct so call sites can
/// spell `wtf::StringImpl` (used by `wtf::RefPtr<StringImpl>`).
pub type StringImpl = WTFStringImplStruct;

/// Port of `WTFStringImplStruct` — must match WebKit's `WTF::StringImpl` layout.
///
/// `m_ref_count` / `m_hash_and_flags` are `Cell<u32>` (not bare `u32`) because
/// `r#ref`/`deref`/`ensure_hash` hand a `*const Self` derived from `&self` to
/// C++ FFI that **writes** those fields. Without `UnsafeCell` the struct is
/// `Freeze`, the `&self` borrow asserts the whole pointee is read-only, and
/// the FFI write is a Stacked-Borrows violation (LLVM may also CSE the
/// pre-/post-FFI `ref_count()` loads). `Cell<u32>` is `repr(transparent)` over
/// `UnsafeCell<u32>`, so the C ABI layout is unchanged.
#[repr(C)]
pub struct WTFStringImplStruct {
    pub m_ref_count: core::cell::Cell<u32>,
    pub m_length: u32,
    pub m_ptr: WTFStringImplPtr,
    pub m_hash_and_flags: core::cell::Cell<u32>,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub union WTFStringImplPtr {
    pub latin1: *const u8,
    pub utf16: *const u16,
}

/// `*WTFStringImplStruct` — always non-null when `tag == WTFStringImpl`.
pub type WTFStringImpl = *mut WTFStringImplStruct;

impl WTFStringImplStruct {
    pub const MAX: u32 = u32::MAX;

    // ---------------------------------------------------------------------
    // These details must stay in sync with WTFStringImpl.h in WebKit!
    // ---------------------------------------------------------------------
    pub const S_HASH_FLAG_8BIT_BUFFER: u32 = 1 << 2;
    /// The bottom bit in the ref count indicates a static (immortal) string.
    pub const S_REF_COUNT_FLAG_IS_STATIC_STRING: u32 = 0x1;
    /// This allows us to ref / deref without disturbing the static string flag.
    pub const S_REF_COUNT_INCREMENT: u32 = 0x2;

    #[inline]
    pub fn length(&self) -> u32 {
        self.m_length
    }
    #[inline]
    pub fn is_8bit(&self) -> bool {
        (self.m_hash_and_flags.get() & Self::S_HASH_FLAG_8BIT_BUFFER) != 0
    }
    #[inline]
    pub fn byte_length(&self) -> usize {
        if self.is_8bit() {
            self.m_length as usize
        } else {
            (self.m_length as usize) * 2
        }
    }
    #[inline]
    pub fn memory_cost(&self) -> usize {
        self.byte_length()
    }
    #[inline]
    pub fn ref_count(&self) -> u32 {
        self.m_ref_count.get() / Self::S_REF_COUNT_INCREMENT
    }
    #[inline]
    pub fn is_static(&self) -> bool {
        self.m_ref_count.get() & Self::S_REF_COUNT_FLAG_IS_STATIC_STRING != 0
    }
    #[inline]
    pub fn has_at_least_one_ref(&self) -> bool {
        // WTF::StringImpl::hasAtLeastOneRef
        self.m_ref_count.get() > 0
    }
    /// Atomic view of `m_ref_count`. The C++ field is
    /// `std::atomic<uint32_t> m_refCount` (StringImpl.h:163); we model it as
    /// `Cell<u32>` for the read-only accessors above but `ref`/`deref` must
    /// issue real atomic RMWs to match `WTF::StringImpl::ref`/`deref` exactly.
    /// `Cell<u32>` is `repr(transparent)` over `UnsafeCell<u32>` and
    /// `AtomicU32` is `repr(C, align(4))` over `UnsafeCell<u32>`: same size,
    /// same alignment (`m_ref_count` is the first field of a `#[repr(C)]`
    /// struct so it is 4-aligned), so the in-place reborrow is sound.
    #[inline(always)]
    fn ref_count_atomic(&self) -> &AtomicU32 {
        // SAFETY: layout-compatible reborrow of `UnsafeCell<u32>` as
        // `AtomicU32`; see doc comment above.
        unsafe { AtomicU32::from_ptr(self.m_ref_count.as_ptr()) }
    }
    /// Inline port of `WTF::StringImpl::ref()` (StringImpl.h:1181).
    ///
    /// Cross-language LTO does not inline the `Bun__WTFStringImpl__ref` C++
    /// shim into Rust callers (2151 out-of-line `callq` sites in the release
    /// binary), so the one-instruction body is reimplemented here.
    /// `Relaxed` matches WebKit's
    /// `m_refCount.fetch_add(s_refCountIncrement, std::memory_order_relaxed)`.
    #[inline]
    pub fn r#ref(&self) {
        let old = self
            .ref_count_atomic()
            .fetch_add(Self::S_REF_COUNT_INCREMENT, Ordering::Relaxed);
        debug_assert!(old > 0); // hasAtLeastOneRef — also true for static (flag bit set)
        debug_assert!(
            old.wrapping_add(Self::S_REF_COUNT_INCREMENT) / Self::S_REF_COUNT_INCREMENT
                > old / Self::S_REF_COUNT_INCREMENT
                || old & Self::S_REF_COUNT_FLAG_IS_STATIC_STRING != 0
        );
        let _ = old;
    }
    /// Inline port of `WTF::StringImpl::deref()` (StringImpl.h:1193).
    ///
    /// Hot path is a single `lock xadd`; only the last-ref branch crosses FFI
    /// to `StringImpl::destroy`. `Relaxed` matches WebKit's
    /// `m_refCount.fetch_sub(s_refCountIncrement, std::memory_order_relaxed)`;
    /// WTF relies on the static-string flag bit (0x1) to keep static strings'
    /// counters from ever equalling `s_refCountIncrement`, so no separate
    /// `isStatic()` check is needed.
    #[inline]
    pub fn deref(&self) {
        let old = self
            .ref_count_atomic()
            .fetch_sub(Self::S_REF_COUNT_INCREMENT, Ordering::Relaxed);
        debug_assert!(old > 0); // hasAtLeastOneRef
        if old != Self::S_REF_COUNT_INCREMENT {
            return;
        }
        // Cold path: last reference dropped — hand the impl to C++ for
        // destruction (handles substring/symbol/external buffer ownership).
        // SAFETY: `old == s_refCountIncrement` ⇒ count is now 0 and we held
        // the sole ref; `self` is not touched again after this call.
        unsafe { Bun__WTFStringImpl__destroy(self) };
    }
    #[inline]
    pub fn ref_count_allocator(self: *mut Self) -> StdAllocator {
        StdAllocator {
            ptr: self.cast(),
            vtable: StringImplAllocator::VTABLE_PTR,
        }
    }
    /// Borrow `len` raw bytes from `m_ptr`. The `latin1` arm of the `repr(C)`
    /// union is a valid byte pointer regardless of encoding (both arms share
    /// the same offset). Centralises the `from_raw_parts(m_ptr.latin1, …)` used
    /// by `byte_slice` / `latin1_slice` / `utf8_slice`.
    #[inline(always)]
    pub fn raw_bytes(&self, len: usize) -> &[u8] {
        // SAFETY: `m_ptr.latin1` points at the impl's character buffer for the
        // lifetime of `self`; every caller passes `len ≤ byte_length()`.
        unsafe { core::slice::from_raw_parts(self.m_ptr.latin1, len) }
    }
    #[inline]
    pub fn byte_slice(&self) -> &[u8] {
        self.raw_bytes(self.byte_length())
    }
    #[inline]
    pub fn latin1_slice(&self) -> &[u8] {
        debug_assert!(self.is_8bit());
        self.raw_bytes(self.m_length as usize)
    }
    #[inline]
    pub fn utf16_slice(&self) -> &[u16] {
        debug_assert!(!self.is_8bit());
        // SAFETY: WebKit guarantees m_ptr.utf16 valid for m_length u16s when !8-bit.
        unsafe { core::slice::from_raw_parts(self.m_ptr.utf16, self.m_length as usize) }
    }
    #[inline]
    pub fn utf16_byte_length(&self) -> usize {
        if self.is_8bit() {
            self.m_length as usize * 2
        } else {
            self.m_length as usize
        }
    }
    #[inline]
    pub fn latin1_byte_length(&self) -> usize {
        // Not all UTF-16 characters fit are representable in latin1.
        // Those get truncated?
        self.m_length as usize
    }
    #[inline]
    pub fn is_thread_safe(&self) -> bool {
        WTFStringImpl__isThreadSafe(self)
    }
    /// Compute the hash() if necessary
    #[inline]
    pub fn ensure_hash(&self) {
        Bun__WTFStringImpl__ensureHash(self);
    }
    #[inline]
    pub fn has_prefix(&self, text: &[u8]) -> bool {
        // SAFETY: `self` is a valid WTF::StringImpl; text.ptr/len describe a valid slice.
        unsafe { Bun__WTFStringImpl__hasPrefix(self, text.as_ptr(), text.len()) }
    }
    #[inline]
    pub fn to_zig_string(&self) -> ZigString {
        if self.is_8bit() {
            ZigString::init(self.latin1_slice())
        } else {
            ZigString::init_utf16(self.utf16_slice())
        }
    }
}

unsafe extern "C" {
    // `&WTFStringImplStruct` is ABI-identical to the C++ `StringImpl*` (thin
    // non-null pointer to a `#[repr(C)]` struct). C++-side mutation lands in
    // `m_ref_count` / `m_hash_and_flags`, both `Cell<u32>`, so writes through
    // a `&`-derived pointer are sound. The type encodes the only validity
    // precondition, so `safe fn` discharges the link-time proof.
    // `ref`/`deref` are inlined in Rust above; only the cold last-ref
    // `destroy` path crosses FFI. `*const` + `unsafe`: it frees the
    // allocation backing the pointer.
    pub fn Bun__WTFStringImpl__destroy(this: *const WTFStringImplStruct);
    // Rust no longer calls these.
    pub safe fn Bun__WTFStringImpl__ref(this: &WTFStringImplStruct);
    pub fn Bun__WTFStringImpl__deref(this: *const WTFStringImplStruct);
    safe fn WTFStringImpl__isThreadSafe(this: &WTFStringImplStruct) -> bool;
    safe fn Bun__WTFStringImpl__ensureHash(this: &WTFStringImplStruct);
    fn Bun__WTFStringImpl__hasPrefix(
        this: *const WTFStringImplStruct,
        text_ptr: *const u8,
        text_len: usize,
    ) -> bool;
}

/// An [`AllocatorVTable`](bun_alloc::AllocatorVTable) whose ctx `ptr` is a
/// `WTFStringImpl`; `alloc` bumps the refcount, `free` derefs. Allocator code
/// recognises it via the `wtf_string_refcount` vtable flag rather than by
/// vtable identity, so `bun_alloc` never needs to name the string types.
#[allow(non_snake_case)]
pub mod StringImplAllocator {
    use bun_alloc::{Alignment, AllocatorVTable};

    use super::WTFStringImplStruct;

    unsafe fn alloc(ptr: *mut core::ffi::c_void, len: usize, _: Alignment, _: usize) -> *mut u8 {
        // SAFETY: vtable contract — `ptr` is the non-null `WTFStringImpl` passed
        // to `ref_count_allocator`, live with refcount ≥ 1 for this call. Single
        // deref site (nonnull-asref reduction) — `byte_length`/`r#ref` are safe
        // `&self` methods.
        let this = unsafe { &*ptr.cast::<WTFStringImplStruct>() };
        if this.byte_length() != len {
            // we don't actually allocate, we just reference count
            return core::ptr::null_mut();
        }
        this.r#ref();
        // we should never actually allocate
        // SAFETY: `m_ptr.latin1` is the byte-view union arm (both arms share
        // offset 0); valid for `byte_length()` bytes.
        unsafe { this.m_ptr.latin1 }.cast_mut()
    }

    unsafe fn free(ptr: *mut core::ffi::c_void, buf: &mut [u8], _: Alignment, _: usize) {
        // SAFETY: see `alloc` — single deref site for the vtable's `WTFStringImpl`
        // ctx pointer; `byte_slice`/`byte_length`/`deref` are safe `&self` methods.
        let this = unsafe { &*ptr.cast::<WTFStringImplStruct>() };
        debug_assert!(this.byte_slice().as_ptr() == buf.as_ptr());
        // The buffer length is `byte_length()` (i.e. `m_length * 2` for
        // UTF-16), not the code-unit count.
        debug_assert!(this.byte_length() == buf.len());
        this.deref();
    }

    pub static VTABLE: AllocatorVTable = AllocatorVTable {
        alloc,
        resize: AllocatorVTable::NO_RESIZE,
        remap: AllocatorVTable::NO_REMAP,
        free,
        ptr_is_identity: false,
        wtf_string_refcount: true,
    };

    pub const VTABLE_PTR: &AllocatorVTable = &VTABLE;
}

impl WTFStringImplStruct {
    #[inline]
    pub fn to_latin1_slice(&self) -> ZigStringSlice {
        self.r#ref();
        let s = self.latin1_slice();
        // ZigStringSlice::WTF derefs `self` on Drop.
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

    #[inline]
    pub fn to_utf8(&self) -> ZigStringSlice {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1(self.latin1_slice()) {
                return ZigStringSlice::init_owned(utf8);
            }

            return self.to_latin1_slice();
        }

        ZigStringSlice::init_owned(strings::to_utf8_alloc(self.utf16_slice()))
    }

    #[inline]
    pub fn to_utf8_without_ref(&self) -> ZigStringSlice {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1(self.latin1_slice()) {
                return ZigStringSlice::init_owned(utf8);
            }

            return ZigStringSlice::from_utf8_never_free(self.latin1_slice());
        }

        ZigStringSlice::init_owned(strings::to_utf8_alloc(self.utf16_slice()))
    }

    /// Like [`to_utf8`] but the 8-bit all-ASCII fast path returns a non-owning
    /// [`ZigStringSlice::WtfBorrowed`] view (no `r#ref`/`deref` pair) instead of
    /// the ref-holding [`ZigStringSlice::WTF`]. The caller MUST keep this impl
    /// alive for the lifetime of the returned slice — `bun.String::to_slice`
    /// does so via `SliceWithUnderlyingString.underlying`. `WtfBorrowed` still
    /// records `self` so a later thread-safe migration can re-derive the view.
    ///
    /// [`to_utf8`]: Self::to_utf8
    #[inline]
    pub fn to_utf8_borrowed(&self) -> ZigStringSlice {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1(self.latin1_slice()) {
                return ZigStringSlice::init_owned(utf8);
            }

            // All-ASCII Latin-1: borrow the impl's own bytes, no refcount bump.
            let s = self.latin1_slice();
            return ZigStringSlice::WtfBorrowed {
                string_impl: std::ptr::from_ref::<Self>(self),
                ptr: s.as_ptr(),
                len: s.len(),
            };
        }

        ZigStringSlice::init_owned(strings::to_utf8_alloc(self.utf16_slice()))
    }

    /// Allocates a NUL-terminated UTF-8 copy.
    /// `.len()` excludes the sentinel.
    pub fn to_owned_slice_z(&self) -> crate::ZBox {
        if self.is_8bit() {
            if let Some(utf8) = strings::to_utf8_from_latin1_z(self.latin1_slice()) {
                return utf8;
            }
            // ASCII: copy bytes; ZBox appends the NUL.
            return crate::ZBox::from_vec_with_nul(self.latin1_slice().to_vec());
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

    pub fn utf8_byte_length(&self) -> usize {
        if self.is_8bit() {
            let input = self.latin1_slice();
            if !input.is_empty() {
                // latin1→utf8 length: each high byte becomes 2 utf8 bytes.
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

    /// Caller must ensure that the string is 8-bit and ASCII.
    #[inline]
    pub fn utf8_slice(&self) -> &[u8] {
        if cfg!(debug_assertions) {
            debug_assert!(self.can_use_as_utf8());
        }
        self.raw_bytes(self.length() as usize)
    }
}

// `WTF.parseDouble` canonical now lives in bun_core::fmt (tier-0) so
// `bun_interchange` (yaml/toml) and `bun_js_parser::lexer` can call it without
// any string/jsc dep. Re-exported here for back-compat.
pub use crate::fmt::{InvalidCharacter, parse_double};
