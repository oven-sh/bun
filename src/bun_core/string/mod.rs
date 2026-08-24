//! `bun_core::string` — `bun.String` and friends.
//!
//! `String` is the FFI-compatible 5-variant tagged union shared with C++
//! (`BunString` in `src/jsc/bindings/BunString.cpp`). `EncodedSlice<'a>` is
//! the pointer-tagged borrowed view; `Utf8Bytes<'a>` is the borrowed-or-owned
//! UTF-8 byte slice.

pub use crate::w;

#[path = "escapeRegExp.rs"]
pub mod escape_reg_exp;
#[path = "HashedString.rs"]
pub mod hashed_string;
#[path = "SmolStr.rs"]
pub mod smol_str;
#[path = "StringBuilder.rs"]
pub mod string_builder;
#[path = "StringJoiner.rs"]
pub mod string_joiner;

#[path = "MutableString.rs"]
pub mod mutable_string;
pub mod wtf;

// Canonical byte-oriented `Write` trait — re-exported by `bun_io::write`.
pub mod write;
pub use write::Write;

// `bun.strings.*` — SIMD-backed scanners over highway/simdutf FFI. Public as
// `bun_core::strings` (the alias in lib.rs); `immutable` is the module name.
#[path = "immutable.rs"]
pub mod immutable;
use crate::strings;

// Unicode ID-Start/ID-Continue two-stage tables.
// Pure data with no upward deps; hosted here so [`lexer`], [`mutable_string`],
// and [`immutable::unicode`] get full Unicode coverage without depending on
// `bun_js_parser`. `bun_js_parser::lexer::identifier` re-exports this module.
#[path = "identifier.rs"]
pub mod identifier;

use crate::RawSlice;
use core::marker::PhantomData;
use core::sync::atomic::{AtomicUsize, Ordering};
pub use wtf::{WTFStringImpl, WTFStringImplExt, WTFStringImplStruct};

// ──────────────────────────────────────────────────────────────────────────
// `bun.String` — 5-variant tagged WTFString-or-EncodedSlice, 24 bytes on 64-bit.
//
// Three types, one layout (all 24 bytes, identical ABI to C++ `BunString`):
// - `String`: OWNS one ref when WTF-backed. Not `Copy`. `Drop` = `deref()`,
//   `Clone` = `ref()`; for the `EncodedSlice`/`Static`/`Empty`/`Dead` tags both
//   are a tag compare and nothing else. Every +1 producer returns this —
//   including `extern "C"` declarations: a by-value `String` in an FFI
//   signature means ownership crosses (C++ `Bun::toStringRef` return, or a
//   Rust return that C++ `transferToWTFString()`s), exactly like `Box<T>`.
// - `&String` is the borrow. `StringView<'a>` is the by-value borrow (C++
//   `Bun::toString`/`toStringView` results, property-iterator names,
//   sub-slices of a WTF string).
// `bun_alloc::String` is the `Copy` POD underneath; nothing outside this
// module needs it.
// ──────────────────────────────────────────────────────────────────────────
pub use bun_alloc::{StringImpl, Tag};

#[repr(transparent)]
pub struct String(bun_alloc::String);

// C++ mirror: `struct BunString { BunStringTag tag; BunStringImpl impl; }`
// (`headers-handwritten.h`); returned **by value** from every `BunString__*`
// FFI below, so size/align drift is silent ABI corruption.
crate::assert_ffi_layout!(String, 24, 8);
// FFI surface from `src/jsc/bindings/BunString.cpp`. Constructors return an
// owned +1 (declared `-> String`).
unsafe extern "C" {
    fn BunString__fromBytes(bytes: *const u8, len: usize) -> String;
    fn BunString__fromLatin1(bytes: *const u8, len: usize) -> String;
    fn BunString__fromUTF16(bytes: *const u16, len: usize) -> String;
    fn BunString__fromUTF16ToLatin1(bytes: *const u16, len: usize) -> String;
    safe fn BunString__fromLatin1Unitialized(len: usize) -> String;
    safe fn BunString__fromUTF16Unitialized(len: usize) -> String;
    // `&mut String` / `&String` are ABI-identical to the C++ `BunString*`
    // (thin non-null pointer to a `#[repr(C)]` struct, asserted by
    // `assert_ffi_layout!` above). C++ reads/writes only the `tag`/`value`
    // fields in place; the type encodes the sole pointer-validity precondition,
    // so `safe fn` discharges the link-time proof here.
    safe fn BunString__toThreadSafe(this: &mut String);
    fn BunString__createAtom(bytes: *const u8, len: usize) -> String;
    fn BunString__tryCreateAtom(bytes: *const u8, len: usize) -> String;
    fn BunString__createStaticExternal(bytes: *const u8, len: usize, isLatin1: bool) -> String;
    fn BunString__createExternal(
        bytes: *const u8,
        len: usize,
        is_latin1: bool,
        ctx: *mut core::ffi::c_void,
        callback: Option<extern "C" fn(*mut core::ffi::c_void, *mut core::ffi::c_void, usize)>,
    ) -> String;
    fn BunString__createExternalGloballyAllocatedLatin1(bytes: *mut u8, len: usize) -> String;
    fn BunString__createExternalGloballyAllocatedUTF16(bytes: *mut u16, len: usize) -> String;
}

/// `ctx` is the pointer passed into `create_external`; `buffer` is the
/// `[*]u8`/`[*]u16` storage; `len` is the character count.
///
/// C++ signature (`BunString.cpp` `BunString__createExternal`):
/// `void (*)(void*, void*, size_t)` — the third arg is `size_t`, **not**
/// `unsigned`. A `u32` here would truncate on 64-bit and (worse) shift the
/// stack/register layout for the callee on Win64 where `size_t` ≠ `unsigned`.
pub(crate) type ExternalStringImplFreeFunction<Ctx> =
    extern "C" fn(ctx: Ctx, buffer: *mut core::ffi::c_void, len: usize);

impl String {
    pub const EMPTY: Self = Self(bun_alloc::String::EMPTY);
    pub const DEAD: Self = Self(bun_alloc::String::DEAD);

    #[inline]
    fn into_raw(self) -> bun_alloc::String {
        core::mem::ManuallyDrop::new(self).0
    }

    #[inline]
    pub const fn empty() -> Self {
        Self::EMPTY
    }
    #[inline]
    pub const fn dead() -> Self {
        Self::DEAD
    }
    #[inline]
    pub fn tag(&self) -> Tag {
        self.0.tag
    }

    /// Wrap `z` under `tag`, erasing its lifetime: the caller keeps the
    /// bytes alive for the `String`'s lifetime.
    #[inline(always)]
    fn wrap(tag: Tag, z: EncodedSlice<'_>) -> Self {
        Self(bun_alloc::String {
            tag,
            value: StringImpl { encoded: z.0 },
        })
    }

    /// The active `EncodedSlice` variant; callers branch on `self.tag` first.
    #[inline(always)]
    fn encoded(&self) -> EncodedSlice<'_> {
        debug_assert!(matches!(
            self.0.tag,
            Tag::EncodedSlice | Tag::StaticEncodedSlice
        ));
        // SAFETY: `tag` is `EncodedSlice`/`StaticEncodedSlice` ⇒ `encoded` is
        // the active union field (`Copy` POD).
        EncodedSlice(unsafe { self.0.value.encoded }, PhantomData)
    }

    /// Borrow the live `WTF::StringImpl`. Every caller branches on
    /// `self.tag == WTFStringImpl` first; centralising the union read +
    /// pointer deref here removes ~25 per-site `unsafe` blocks.
    #[inline(always)]
    fn as_wtf(&self) -> &WTFStringImplStruct {
        debug_assert_eq!(self.0.tag, Tag::WTFStringImpl);
        // SAFETY: `tag == WTFStringImpl` ⇒ `wtf_string_impl` is the active
        // union field and a non-null, live `*mut WTFStringImplStruct`
        // (refcount ≥ 1).
        unsafe { &*self.0.value.wtf_string_impl }
    }

    /// `bun.String.init` — polymorphic borrow constructor, expressed via the
    /// `Into<Self>` impls below.
    #[inline]
    pub fn init<T: Into<Self>>(value: T) -> Self {
        value.into()
    }

    /// `bun.String.borrowUTF8` — borrow `s` (no copy, no refcount). Caller
    /// must keep `s` alive for the String's lifetime.
    #[inline]
    pub fn borrow_utf8(s: &[u8]) -> Self {
        Self::wrap(Tag::EncodedSlice, EncodedSlice::init_utf8(s))
    }
    #[inline]
    pub fn borrow_utf16(s: &[u16]) -> Self {
        Self::wrap(Tag::EncodedSlice, EncodedSlice::init_utf16(s))
    }
    #[inline]
    pub fn ascii(s: &[u8]) -> Self {
        Self::wrap(Tag::EncodedSlice, EncodedSlice::init(s))
    }

    /// `bun.String.static` — `'static` slice; converted to JS via
    /// `WTF::ExternalStringImpl` without copying. Generic over `str`/`[u8]`
    /// so call sites may pass either `"lit"` or `b"lit"`.
    #[inline]
    pub fn static_<S: ?Sized + AsRef<[u8]>>(s: &'static S) -> Self {
        // No UTF-8 mark on the static path.
        Self::wrap(Tag::StaticEncodedSlice, EncodedSlice::init(s.as_ref()))
    }
    /// `clone_utf8(other)`, unless `other` is byte-equal to `self`, in which
    /// case another ref to `self`.
    #[inline]
    pub fn create_if_different(&self, other: &[u8]) -> Self {
        if self.eql_utf8(other) {
            return self.clone();
        }
        Self::clone_utf8(other)
    }

    /// `bun.String.cloneUTF8` — copies `s` into a fresh WTF::StringImpl.
    pub fn clone_utf8(s: &[u8]) -> Self {
        if s.is_empty() {
            return Self::EMPTY;
        }
        // BunString__fromBytes auto-detects all-ASCII → Latin1, else UTF-8.
        // SAFETY: s.as_ptr()/len describe a valid byte slice.
        unsafe { BunString__fromBytes(s.as_ptr(), s.len()) }
    }
    pub fn clone_latin1(s: &[u8]) -> Self {
        if s.is_empty() {
            return Self::EMPTY;
        }
        // SAFETY: s.as_ptr()/len describe a valid byte slice.
        unsafe { BunString__fromLatin1(s.as_ptr(), s.len()) }
    }
    /// `bun.String.cloneUTF16` — narrows to Latin-1 if all-ASCII.
    pub fn clone_utf16(s: &[u16]) -> Self {
        if s.is_empty() {
            return Self::EMPTY;
        }
        // SAFETY: s.as_ptr()/len describe a valid u16 slice.
        unsafe {
            if strings::first_non_ascii16(s).is_none() {
                BunString__fromUTF16ToLatin1(s.as_ptr(), s.len())
            } else {
                BunString__fromUTF16(s.as_ptr(), s.len())
            }
        }
    }
    pub fn create_atom(s: &[u8]) -> Self {
        // SAFETY: s.as_ptr()/len describe a valid byte slice.
        unsafe { BunString__createAtom(s.as_ptr(), s.len()) }
    }
    /// `bun.String.tryCreateAtom` — `None` if `bytes` is non-ASCII or too long
    /// to atomize.
    pub fn try_create_atom(bytes: &[u8]) -> Option<Self> {
        // SAFETY: bytes describes a valid slice.
        let atom = unsafe { BunString__tryCreateAtom(bytes.as_ptr(), bytes.len()) };
        if atom.0.tag == Tag::Dead {
            None
        } else {
            Some(atom)
        }
    }
    /// `bun.String.createAtomIfPossible` — atomized strings are interned in a
    /// thread-local table; falls back to a regular WTF copy if atomization
    /// fails. Cannot be used cross-thread.
    pub fn create_atom_if_possible(bytes: &[u8]) -> Self {
        if bytes.is_empty() {
            return Self::EMPTY;
        }
        if bytes.len() < 64 {
            if let Some(atom) = Self::try_create_atom(bytes) {
                return atom;
            }
        }
        Self::clone_utf8(bytes)
    }
    /// `bun.String.createExternal` — wraps `bytes` in a `WTF::ExternalStringImpl`
    /// that calls `callback(ctx, buffer, len)` when the impl is destroyed.
    ///
    /// External strings are WTF strings whose bytes live elsewhere; `bytes` is
    /// borrowed (not copied). If `bytes.len() > max_length()`, `callback` is
    /// invoked immediately and a `dead` string is returned.
    ///
    /// `Ctx` must be a pointer-sized type (raw pointer or `&T`); enforced by
    /// the const-assert below to keep the C-ABI cast sound.
    pub fn create_external<Ctx>(
        bytes: &[u8],
        is_latin1: bool,
        ctx: Ctx,
        callback: ExternalStringImplFreeFunction<Ctx>,
    ) -> Self {
        use core::ffi::c_void;
        // `Ctx` must be a pointer-sized, pointer-aligned handle.
        struct AssertPtrSized<C>(core::marker::PhantomData<C>);
        impl<C> AssertPtrSized<C> {
            const OK: () = {
                assert!(core::mem::size_of::<C>() == core::mem::size_of::<*mut c_void>());
                // The bit-reinterpret below reads `*mut c_void` out of a stack
                // slot aligned for `Ctx`; rule out a `Ctx` like `[u8; 8]`
                // (align 1) which would make that read under-aligned.
                assert!(core::mem::align_of::<C>() >= core::mem::align_of::<*mut c_void>());
            };
        }
        let () = AssertPtrSized::<Ctx>::OK;
        debug_assert!(!bytes.is_empty());
        if bytes.len() > Self::max_length() {
            callback(ctx, bytes.as_ptr().cast_mut().cast::<c_void>(), bytes.len());
            return Self::DEAD;
        }
        // The const-assert above only checks size/alignment, so an owning
        // pointer-sized `Ctx` (e.g.
        // `Box<T>`) would otherwise be dropped here and later double-freed by
        // the WTF finalizer. Ownership transfers to the external string;
        // suppress the local drop.
        let ctx = core::mem::ManuallyDrop::new(ctx);
        // SAFETY: Ctx is pointer-sized and pointer-aligned (const-asserted
        // above); read the bits as `*mut c_void`.
        let ctx_erased: *mut c_void = unsafe {
            core::ptr::from_ref::<Ctx>(&*ctx)
                .cast::<*mut c_void>()
                .read()
        };
        let cb_erased: Option<extern "C" fn(*mut c_void, *mut c_void, usize)> =
            // SAFETY: same ABI; first param erased per the const-assert above.
            Some(unsafe { crate::cast_fn_ptr::<
                ExternalStringImplFreeFunction<Ctx>,
                extern "C" fn(*mut c_void, *mut c_void, usize),
            >(callback) });
        // SAFETY: bytes describes a valid slice; len <= max_length checked.
        let s = unsafe {
            BunString__createExternal(
                bytes.as_ptr(),
                bytes.len(),
                is_latin1,
                ctx_erased,
                cb_erased,
            )
        };
        debug_assert!(s.0.tag != Tag::WTFStringImpl || s.as_wtf().ref_count() == 1);
        s
    }

    /// Max `WTF::StringImpl` length (in characters, not bytes):
    /// [`STRING_ALLOCATION_LIMIT`] clamped to [`WTF_STRING_MAX_LENGTH`].
    #[inline]
    pub fn max_length() -> usize {
        STRING_ALLOCATION_LIMIT
            .load(Ordering::Relaxed)
            .min(WTF_STRING_MAX_LENGTH)
    }

    /// `bun.String.createStaticExternal` — wraps `bytes` in a
    /// `WTF::ExternalStringImpl` that will **never** be freed. Only use for
    /// dynamically-allocated data with process lifetime.
    pub fn create_static_external(bytes: &[u8], is_latin1: bool) -> Self {
        debug_assert!(!bytes.is_empty());
        // SAFETY: bytes describes a valid slice; C++ side stores ptr/len
        // without copying and never frees it.
        unsafe { BunString__createStaticExternal(bytes.as_ptr(), bytes.len(), is_latin1) }
    }
    /// UTF-16 form of [`Self::create_static_external`]: `units` must be
    /// 2-byte aligned and live for the rest of the process.
    pub fn create_static_external_utf16(units: &[u16]) -> Self {
        debug_assert!(!units.is_empty());
        // SAFETY: the C++ side takes the length in code units and stores
        // ptr/len without copying or freeing.
        unsafe { BunString__createStaticExternal(units.as_ptr().cast::<u8>(), units.len(), false) }
    }
    /// `bun.String.createFormat` — formats `args` into a temporary buffer and
    /// copies the result into a fresh WTF-backed string.
    pub fn create_format(args: core::fmt::Arguments<'_>) -> Self {
        use core::fmt::Write;
        // Cold path (error messages), so a heap buffer is fine.
        if let Some(s) = args.as_str() {
            return Self::clone_utf8(s.as_bytes());
        }
        let mut buf = std::string::String::with_capacity(128);
        let _ = buf.write_fmt(args);
        Self::clone_utf8(buf.as_bytes())
    }
    /// Returns `(String, ptr)` where `ptr` is `len` writable bytes — or
    /// `(dead, null)` if WTF allocation failed (check `tag == .Dead` before
    /// using the buffer).
    pub fn create_uninitialized_latin1(len: usize) -> (Self, &'static mut [u8]) {
        let s = BunString__fromLatin1Unitialized(len);
        if s.0.tag != Tag::WTFStringImpl {
            return (s, &mut []);
        }
        debug_assert_eq!(s.as_wtf().ref_count(), 1);
        // SAFETY: WTF tag verified above; impl has a writable latin1 buffer of
        // `len`. `ptr` points at `len` writable bytes owned by the new WTF
        // impl; the `'static` lifetime is actually tied to `s` — caller must
        // not outlive it.
        let buf = unsafe {
            let ptr = (*s.0.value.wtf_string_impl).m_ptr.latin1.cast_mut();
            core::slice::from_raw_parts_mut(ptr, len)
        };
        (s, buf)
    }
    pub fn create_uninitialized_utf16(len: usize) -> (Self, &'static mut [u16]) {
        let s = BunString__fromUTF16Unitialized(len);
        if s.0.tag != Tag::WTFStringImpl {
            return (s, &mut []);
        }
        debug_assert_eq!(s.as_wtf().ref_count(), 1);
        // SAFETY: see `create_uninitialized_latin1`.
        let buf = unsafe {
            let ptr = (*s.0.value.wtf_string_impl).m_ptr.utf16.cast_mut();
            core::slice::from_raw_parts_mut(ptr, len)
        };
        (s, buf)
    }

    /// `bun.String.createExternalGloballyAllocated(.latin1, bytes)` — takes
    /// ownership of a globally-allocated (mimalloc-backed) Latin-1 buffer and
    /// wraps it in a WTF::ExternalStringImpl. On allocation failure, frees the
    /// bytes and returns `String::DEAD`.
    pub fn create_external_globally_allocated_latin1(bytes: Vec<u8>) -> Self {
        if bytes.is_empty() {
            return Self::EMPTY;
        }
        if bytes.len() > Self::max_length() {
            return Self::DEAD;
        }
        // Do NOT call `into_boxed_slice()` — when `len < capacity` it issues a
        // shrink_to_fit realloc. mimalloc's `mi_free` only needs the original
        // base pointer (capacity is recovered from the heap), so leaking the
        // spare capacity to the ExternalStringImpl finalizer is correct.
        let mut bytes = core::mem::ManuallyDrop::new(bytes);
        let (ptr, len) = (bytes.as_mut_ptr(), bytes.len());
        // SAFETY: ownership transferred to WTF::ExternalStringImpl, which frees
        // via mimalloc (the global allocator).
        unsafe { BunString__createExternalGloballyAllocatedLatin1(ptr, len) }
    }

    /// `bun.String.createExternalGloballyAllocated(.utf16, bytes)`.
    pub fn create_external_globally_allocated_utf16(bytes: Vec<u16>) -> Self {
        if bytes.is_empty() {
            return Self::EMPTY;
        }
        if bytes.len() > Self::max_length() {
            return Self::DEAD;
        }
        // See `create_external_globally_allocated_latin1` — avoid the
        // `into_boxed_slice()` shrink-realloc when `len < capacity`.
        let mut bytes = core::mem::ManuallyDrop::new(bytes);
        let (ptr, len) = (bytes.as_mut_ptr(), bytes.len());
        // SAFETY: see `create_external_globally_allocated_latin1`.
        unsafe { BunString__createExternalGloballyAllocatedUTF16(ptr, len) }
    }

    /// `bun.String.createFromOSPath` — clone an OS-native path slice into a
    /// WTF-backed string (UTF-8 on POSIX, UTF-16 on Windows).
    pub fn create_from_os_path(os_path: crate::OSPathSlice<'_>) -> Self {
        #[cfg(not(windows))]
        {
            Self::clone_utf8(os_path)
        }
        #[cfg(windows)]
        {
            Self::clone_utf16(os_path)
        }
    }
    /// `WTF::adoptRef` — wrap a raw `*mut WTFStringImplStruct`, **adopting**
    /// an existing +1 ref (no inc). Inverse of [`leak_wtf_impl`]. Null → `EMPTY`.
    #[inline]
    pub fn adopt_wtf_impl(wtf: WTFStringImpl) -> Self {
        if wtf.is_null() {
            return Self::EMPTY;
        }
        Self(bun_alloc::String {
            tag: Tag::WTFStringImpl,
            value: StringImpl {
                wtf_string_impl: wtf,
            },
        })
    }
    /// `WTF::RefPtr(ptr)` — wrap a raw `*mut WTFStringImplStruct` someone else
    /// keeps alive, taking a **new** ref for the returned `String`.
    #[inline]
    pub fn retain_wtf_impl(wtf: WTFStringImpl) -> Self {
        let s = Self::adopt_wtf_impl(wtf);
        s.ref_();
        s
    }
    /// Extract the raw `*mut WTFStringImplStruct`
    /// from a WTF-backed string, transferring ownership of the +1 ref to the caller. Returns
    /// null for non-WTF tags. Used by SQL data-cell paths that hand the impl pointer to C++.
    #[inline]
    pub fn leak_wtf_impl(self) -> WTFStringImpl {
        let raw = self.into_raw();
        if raw.tag == Tag::WTFStringImpl {
            // SAFETY: tag checked.
            unsafe { raw.value.wtf_string_impl }
        } else {
            core::ptr::null_mut()
        }
    }
    pub fn to_thread_safe(&mut self) {
        if self.0.tag == Tag::WTFStringImpl {
            BunString__toThreadSafe(self)
        }
        debug_assert!(self.is_thread_safe());
    }
    /// True iff this `String` may be sent to / shared with another thread
    /// without racing the WTF `StringImpl`'s non-atomic refcount: every tag
    /// except `WTFStringImpl` is inert (raw slice / static / dead), and a
    /// WTF-backed string is safe iff its impl reports `isThreadSafe()`.
    ///
    /// Call sites that move a `String` across a thread boundary must ensure
    /// this holds (typically by calling [`to_thread_safe`] first); see the
    /// `Send`/`Sync` SAFETY comment for the full contract.
    #[inline]
    pub(crate) fn is_thread_safe(&self) -> bool {
        if self.0.tag == Tag::WTFStringImpl {
            // SAFETY: WTF tag guarantees `value.wtf` is a valid live impl.
            self.as_wtf().is_thread_safe()
        } else {
            true
        }
    }

    #[inline]
    fn ref_(&self) {
        if self.0.tag == Tag::WTFStringImpl {
            self.as_wtf().r#ref()
        }
    }
    #[inline]
    fn deref(&self) {
        if self.0.tag == Tag::WTFStringImpl {
            self.as_wtf().deref()
        }
    }

    #[inline]
    pub fn length(&self) -> usize {
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().length() as usize,
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().len,
            Tag::Dead | Tag::Empty => 0,
        }
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.0.tag == Tag::Empty || self.length() == 0
    }
    pub fn is_utf16(&self) -> bool {
        match self.0.tag {
            Tag::WTFStringImpl => !self.as_wtf().is_8bit(),
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().is_16bit(),
            _ => false,
        }
    }
    pub fn is_utf8(&self) -> bool {
        matches!(self.0.tag, Tag::EncodedSlice | Tag::StaticEncodedSlice)
            && self.encoded().is_utf8()
    }
    pub fn is_8bit(&self) -> bool {
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().is_8bit(),
            Tag::EncodedSlice => !self.encoded().is_16bit(),
            _ => true,
        }
    }
    /// Raw byte view (Latin-1 or UTF-16 bytes — NOT necessarily UTF-8).
    pub fn byte_slice(&self) -> &[u8] {
        match self.0.tag {
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().byte_slice(),
            Tag::WTFStringImpl => self.as_wtf().byte_slice(),
            _ => &[],
        }
    }
    /// Latin-1 byte view; debug-asserts `is_8bit()`.
    pub fn latin1(&self) -> &[u8] {
        debug_assert!(self.is_8bit());
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().latin1_slice(),
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().slice(),
            _ => &[],
        }
    }
    pub fn utf16(&self) -> &[u16] {
        debug_assert!(self.is_utf16());
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().utf16_slice(),
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().utf16_slice(),
            _ => &[],
        }
    }
    pub fn ensure_hash(&self) {
        if self.0.tag == Tag::WTFStringImpl {
            self.as_wtf().ensure_hash()
        }
    }

    /// Narrow this string into `dst` iff it is non-empty, fits, and every code
    /// unit is ASCII (`< 0x80`). UTF-16 narrows via
    /// [`strings::narrow_ascii_u16`]; 8-bit copies after rejecting any high
    /// Latin-1 byte. Returns `Some(&mut dst[..len])` on success.
    pub(crate) fn ascii_into<'a>(&self, dst: &'a mut [u8]) -> Option<&'a mut [u8]> {
        let len = self.length();
        if len == 0 || len > dst.len() {
            return None;
        }
        if self.is_utf16() {
            crate::strings::narrow_ascii_u16(self.utf16(), dst)
        } else {
            let src = self.byte_slice();
            if strings::first_non_ascii(src).is_some() {
                return None;
            }
            let dst = &mut dst[..len];
            dst.copy_from_slice(src);
            Some(dst)
        }
    }

    /// `bun.String.inMapCaseInsensitive` — case-insensitive ASCII
    /// lookup against a comptime string map whose keys are lowercase ASCII.
    /// UTF-16 inputs are narrowed (non-ASCII code unit ⇒ miss); 8-bit inputs
    /// delegate straight to [`strings::in_map_case_insensitive`].
    pub fn in_map_case_insensitive<M: crate::comptime_string_map::ComptimeStringMap>(
        &self,
        map: &M,
    ) -> Option<M::Value>
    where
        M::Value: Copy,
    {
        if self.is_utf16() {
            let mut buf = [0u8; 256];
            strings::in_map_case_insensitive(self.ascii_into(&mut buf)?, map)
        } else {
            strings::in_map_case_insensitive(self.byte_slice(), map)
        }
    }

    /// `bun.String.trunc` — clamp to `len` code units. Borrows `self`'s
    /// storage; for `WTFStringImpl` longer than `len` this is an `EncodedSlice`
    /// view into the impl's buffer.
    #[inline]
    pub fn trunc(&self, len: usize) -> StringView<'_> {
        if self.length() <= len {
            return StringView::new(self);
        }
        StringView::from_encoded(self.to_encoded_slice().trunc(len))
    }

    /// `bun.String.substring` — borrowed slice from `start_index` to end.
    pub fn substring(&self, start_index: usize) -> StringView<'_> {
        let len = self.length();
        self.substring_with_len(start_index.min(len), len)
    }

    /// `bun.String.substringWithLen`.
    pub fn substring_with_len(&self, start_index: usize, end_index: usize) -> StringView<'_> {
        match self.0.tag {
            Tag::EncodedSlice | Tag::StaticEncodedSlice => {
                StringView::from_encoded(self.encoded().substring_with_len(start_index, end_index))
            }
            Tag::WTFStringImpl => {
                let w = self.as_wtf();
                if w.is_8bit() {
                    StringView::from_encoded(EncodedSlice::init(
                        &w.latin1_slice()[start_index..end_index],
                    ))
                } else {
                    StringView::from_encoded(EncodedSlice::init_utf16(
                        &w.utf16_slice()[start_index..end_index],
                    ))
                }
            }
            _ => StringView::new(self),
        }
    }

    /// UTF-8 bytes of `self`: borrowed when already UTF-8 (incl. 8-bit
    /// all-ASCII), otherwise a transcoded copy. Never takes a ref.
    #[inline]
    pub fn to_utf8(&self) -> Utf8Bytes<'_> {
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().to_utf8(),
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().to_utf8(),
            _ => Utf8Bytes::EMPTY,
        }
    }
    /// Consuming [`to_utf8`] for storing the result: moves `self`'s ref into
    /// a `Shared` slice (8-bit all-ASCII WTF), transcodes, or copies a
    /// borrowed `EncodedSlice` so the result never depends on `self`'s backing.
    ///
    /// [`to_utf8`]: Self::to_utf8
    pub fn into_utf8(self) -> Utf8Bytes<'static> {
        match self.0.tag {
            Tag::WTFStringImpl => {
                let wtf = self.as_wtf();
                if !wtf.is_8bit() {
                    return Utf8Bytes::Owned(strings::to_utf8_alloc(wtf.utf16_slice()));
                }
                if let Some(utf8) = strings::to_utf8_from_latin1(wtf.latin1_slice()) {
                    return Utf8Bytes::Owned(utf8);
                }
                let bytes = RawSlice::new(wtf.latin1_slice());
                Utf8Bytes::Shared {
                    string_impl: self.leak_wtf_impl(),
                    bytes,
                }
            }
            Tag::EncodedSlice => self.encoded().to_utf8().into_owned(),
            Tag::StaticEncodedSlice => {
                let utf8 = self.encoded().to_utf8();
                // SAFETY: `StaticEncodedSlice` bytes are `'static` by construction.
                unsafe { core::mem::transmute::<Utf8Bytes<'_>, Utf8Bytes<'static>>(utf8) }
            }
            _ => Utf8Bytes::EMPTY,
        }
    }
    /// Returns `Some(utf8_bytes)` only if this is already valid UTF-8 with no
    /// transcoding needed.
    pub fn as_utf8(&self) -> Option<&[u8]> {
        match self.0.tag {
            Tag::WTFStringImpl => {
                let w = self.as_wtf();
                if w.is_8bit() && strings::is_all_ascii(w.latin1_slice()) {
                    Some(w.latin1_slice())
                } else {
                    None
                }
            }
            Tag::EncodedSlice | Tag::StaticEncodedSlice => {
                let z = self.encoded();
                if z.is_16bit() {
                    return None;
                }
                if z.is_utf8() {
                    return Some(z.slice());
                }
                if strings::is_all_ascii(z.slice()) {
                    return Some(z.slice());
                }
                None
            }
            _ => Some(b""),
        }
    }
    pub fn to_owned_slice(&self) -> Vec<u8> {
        self.to_utf8().into_vec()
    }

    pub fn eql_utf8(&self, other: &[u8]) -> bool {
        self.to_utf8().slice() == other
    }
    /// Equality against an ASCII literal. Dispatches on encoding so only
    /// `lit.len()` units are touched; never scans or transcodes `self`.
    pub fn eql_comptime<S: ?Sized + AsRef<[u8]>>(&self, lit: &S) -> bool {
        let lit = lit.as_ref();
        debug_assert!(lit.is_ascii(), "eql_comptime expects an ASCII literal");
        if self.is_utf16() {
            return strings::eql_comptime_utf16(self.utf16(), lit);
        }
        let bytes = self.latin1();
        bytes.len() == lit.len() && strings::eql_comptime_ignore_len(bytes, lit)
    }

    /// `bun.String.hasPrefixComptime` — ASCII prefix check. Dispatches on
    /// encoding so only `prefix.len()` units are touched; never scans or
    /// transcodes `self`.
    pub fn has_prefix_comptime(&self, prefix: &'static [u8]) -> bool {
        debug_assert!(prefix.is_ascii(), "has_prefix_comptime expects ASCII");
        if self.is_utf16() {
            return strings::has_prefix_comptime_utf16(self.utf16(), prefix);
        }
        strings::has_prefix_comptime(self.latin1(), prefix)
    }

    #[inline]
    pub fn is_dead(&self) -> bool {
        self.0.tag == Tag::Dead
    }

    /// `bun.String.fromBytes` — borrow `value` without copying or refcounting;
    /// auto-tags UTF-8 if `value` contains any non-ASCII byte.
    #[inline]
    pub fn from_bytes(value: &[u8]) -> Self {
        Self::wrap(Tag::EncodedSlice, EncodedSlice::from_bytes(value))
    }

    /// Borrow as an `EncodedSlice` (any tag; no ref taken).
    pub fn to_encoded_slice(&self) -> EncodedSlice<'_> {
        match self.0.tag {
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded(),
            Tag::WTFStringImpl => EncodedSlice(self.as_wtf().to_encoded_slice(), PhantomData),
            _ => EncodedSlice::EMPTY,
        }
    }

    /// `bun.String.eql` — encoding-aware equality.
    pub fn eql(&self, other: &Self) -> bool {
        self.to_encoded_slice().eql(other.to_encoded_slice())
    }

    /// `bun.String.utf8ByteLength` — exact number of UTF-8 bytes needed to
    /// encode `self`.
    pub fn utf8_byte_length(&self) -> usize {
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().utf8_byte_length(),
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().utf8_byte_length(),
            Tag::Dead | Tag::Empty => 0,
        }
    }

    /// `bun.String.utf16ByteLength` — number of bytes the UTF-16LE encoding of
    /// `self` would occupy.
    pub fn utf16_byte_length(&self) -> usize {
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().utf16_byte_length(),
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().utf16_byte_length(),
            Tag::Dead | Tag::Empty => 0,
        }
    }

    /// `bun.String.toOwnedSliceZ` — allocate a NUL-terminated UTF-8 copy.
    pub fn to_owned_slice_z(&self) -> crate::ZBox {
        self.to_encoded_slice().to_owned_slice_z()
    }

    // `bun.String.encodeInto` / `bun.String.encode` — moved UP to
    // `bun_runtime::webcore::encoding::BunStringEncode` (extension trait).
    // The encoder bodies (`jsc.WebCore.encoding.{encodeIntoFrom8,16,
    // constructFromU8,U16}`) live in `bun_runtime`; defining the methods here
    // would invert the crate graph. See PORTING.md §Dep-cycle.

    /// `bun.String.visibleWidthExcludeANSIColors` — terminal column width of
    /// `self`, treating ANSI escape sequences as zero-width.
    /// Dispatches on encoding to [`strings::visible::width::exclude_ansi_colors`].
    pub fn visible_width_exclude_ansi_colors(&self, ambiguous_as_wide: bool) -> usize {
        use crate::strings::visible::width::exclude_ansi_colors as w;
        if self.is_utf16() {
            return w::utf16(self.utf16(), ambiguous_as_wide);
        }
        if self.is_utf8() {
            return w::utf8(self.encoded().slice());
        }
        w::latin1(self.latin1(), ambiguous_as_wide)
    }

    /// `bun.String.encoding` — coarse encoding classifier.
    pub fn encoding(&self) -> strings::EncodingNonAscii {
        if self.is_utf16() {
            strings::EncodingNonAscii::Utf16
        } else if self.is_utf8() {
            strings::EncodingNonAscii::Utf8
        } else {
            strings::EncodingNonAscii::Latin1
        }
    }

    /// Encode `self` into `buf` as NUL-terminated UTF-16, returning the unit
    /// count (excluding the NUL), or `None` when `self`'s UTF-16 form plus the
    /// NUL would not fit. Bounds-checked for all three backing encodings; the
    /// caller owns mapping `None` to an error (e.g. `ENAMETOOLONG`).
    pub fn encode_into_utf16_buf_z(&self, buf: &mut [u16]) -> Option<usize> {
        let cap = buf.len().checked_sub(1)?;
        let len = match self.encoding() {
            strings::EncodingNonAscii::Utf8 => {
                strings::try_convert_utf8_to_utf16_in_buffer(&mut buf[..cap], self.utf8())?.len()
            }
            strings::EncodingNonAscii::Utf16 => {
                let src = self.utf16();
                if src.len() > cap {
                    return None;
                }
                buf[..src.len()].copy_from_slice(src);
                src.len()
            }
            strings::EncodingNonAscii::Latin1 => {
                let src = self.latin1();
                if src.len() > cap {
                    return None;
                }
                strings::copy_latin1_into_utf16(&mut buf[..src.len()], src);
                src.len()
            }
        };
        buf[len] = 0;
        Some(len)
    }

    /// `bun.String.canBeUTF8` — true iff `self`'s 8-bit bytes
    /// are valid UTF-8 (i.e. either UTF-8-tagged or all-ASCII).
    pub(crate) fn can_be_utf8(&self) -> bool {
        match self.0.tag {
            Tag::WTFStringImpl => {
                let w = self.as_wtf();
                w.is_8bit() && strings::is_all_ascii(w.latin1_slice())
            }
            Tag::EncodedSlice | Tag::StaticEncodedSlice => {
                let z = self.encoded();
                if z.is_utf8() {
                    return true;
                }
                !z.is_16bit() && strings::is_all_ascii(z.slice())
            }
            Tag::Empty => true,
            Tag::Dead => false,
        }
    }

    /// `bun.String.utf8` — raw UTF-8 byte slice. Debug-asserts
    /// `self` is a UTF-8-safe `EncodedSlice`/`StaticEncodedSlice` (use [`as_utf8`] for
    /// the checked variant).
    #[inline]
    pub(crate) fn utf8(&self) -> &[u8] {
        debug_assert!(matches!(
            self.0.tag,
            Tag::EncodedSlice | Tag::StaticEncodedSlice
        ));
        debug_assert!(self.can_be_utf8());
        self.encoded().slice()
    }

    /// `bun.String.toSlice` — consume `self` into a [`SliceWithUnderlyingString`].
    #[inline]
    pub fn into_slice(self) -> SliceWithUnderlyingString {
        let utf8 = {
            let mut utf8 = self.to_utf8();
            if let Utf8Bytes::Owned(v) = &mut utf8 {
                Some(core::mem::take(v))
            } else {
                None
            }
        };
        SliceWithUnderlyingString {
            utf8,
            underlying: self,
            #[cfg(debug_assertions)]
            did_report_extra_memory_debug: false,
        }
    }

    /// `bun.String.toThreadSafeSlice` — like [`into_slice`] but
    /// guarantees the resulting buffer is safe to send to another thread.
    ///
    /// [`into_slice`]: Self::into_slice
    pub fn into_thread_safe_slice(self) -> SliceWithUnderlyingString {
        let mut sliced = self.into_slice();
        if sliced.underlying.0.tag == Tag::WTFStringImpl {
            if sliced.utf8.is_none() {
                // 8-bit all-ASCII: a thread-safe `underlying` keeps backing the bytes.
                if sliced.underlying.is_thread_safe() {
                    return sliced;
                }
                sliced.utf8 = Some(sliced.slice().to_vec());
            }
            // Transcoded or copied; drop the WTF backing to release memory.
            sliced.underlying = String::EMPTY;
        }
        sliced
    }

    /// `bun.String.charAt` — code unit at `index`, widened to
    /// `u16` regardless of encoding. Caller must ensure `index < self.length()`.
    #[inline]
    pub fn char_at(&self, index: usize) -> u16 {
        debug_assert!(index < self.length());
        match self.0.tag {
            Tag::WTFStringImpl => {
                let w = self.as_wtf();
                if w.is_8bit() {
                    w.latin1_slice()[index] as u16
                } else {
                    w.utf16_slice()[index]
                }
            }
            Tag::EncodedSlice | Tag::StaticEncodedSlice => self.encoded().char_at(index),
            _ => 0,
        }
    }

    /// `bun.String.indexOfAsciiChar`.
    pub fn index_of_ascii_char(&self, chr: u8) -> Option<usize> {
        debug_assert!(chr < 128);
        if self.is_utf16() {
            self.utf16().iter().position(|&c| c == chr as u16)
        } else {
            strings::index_of_char_usize(self.byte_slice(), chr)
        }
    }

    /// `bun.String.estimatedSize` — owned allocation size in
    /// bytes (not character count). `0` for static/empty/dead.
    pub fn estimated_size(&self) -> usize {
        match self.0.tag {
            Tag::Dead | Tag::Empty | Tag::StaticEncodedSlice => 0,
            Tag::EncodedSlice => self.encoded().len,
            Tag::WTFStringImpl => self.as_wtf().byte_length(),
        }
    }

    // `to_js` / `into_js` / `create_utf8_for_js` are tier-6 (jsc) — the
    // *_jsc alias pattern: deleted here per PORTING.md, defined as inherent
    // free fns / extension trait in `bun_jsc::string` (would otherwise create
    // a `bun_string ↔ bun_jsc` dependency cycle).
}
// `bun.String.init` dispatch table —
// expressed as `From` impls feeding `String::init<T: Into<Self>>`. The
// `String → String` identity case is covered by the std blanket `From<T> for T`.
impl From<EncodedSlice<'static>> for String {
    #[inline]
    fn from(z: EncodedSlice<'static>) -> Self {
        Self::wrap(Tag::EncodedSlice, z)
    }
}
impl From<&[u8]> for String {
    /// Byte-slice arm — `EncodedSlice::from_bytes` (auto-marks UTF-8 if non-ASCII).
    #[inline]
    fn from(s: &[u8]) -> Self {
        Self::from_bytes(s)
    }
}
impl<const N: usize> From<&'static [u8; N]> for String {
    /// `&'static [u8; N]` arm — string literal: empty
    /// → `Tag::Empty`, otherwise `String.static(value)` → `Tag::StaticEncodedSlice`.
    /// Restricted to `&'static` so the static-tag invariant holds.
    #[inline]
    fn from(s: &'static [u8; N]) -> Self {
        if N == 0 {
            Self::EMPTY
        } else {
            Self::static_(s)
        }
    }
}
impl From<&str> for String {
    #[inline]
    fn from(s: &str) -> Self {
        Self::from_bytes(s.as_bytes())
    }
}
impl crate::OptionsEnvArg for String {
    #[inline]
    fn from_slice(s: &[u8]) -> Self {
        String::clone_utf8(s)
    }
    #[inline]
    fn from_buf(buf: Vec<u8>) -> Self {
        String::clone_utf8(&buf)
    }
}

impl Default for String {
    #[inline]
    fn default() -> Self {
        Self::EMPTY
    }
}
// SAFETY: `String` is a tag + raw ptr to a `WTF::StringImpl` (or a borrowed
// `EncodedSlice` slice / static / dead sentinel). All non-WTF tags are trivially
// `Send + Sync` (no interior mutability, no refcount). The WTF tag is the
// hazard: `WTF::StringImpl`'s refcount is non-atomic unless the impl was
// created thread-safe, so sending/sharing a non-thread-safe impl across
// threads and then `ref_()`/`deref()`ing it is a data race.
//
// We keep the blanket impls to match the C++ `BunString`
// FFI contract (the type must round-trip by value through `extern "C"` and sit
// in `Send + Sync` containers), and instead enforce the invariant at the
// boundary: any code that moves a `String` to another thread MUST first call
// [`String::to_thread_safe`] (or otherwise guarantee [`String::is_thread_safe`]
// returns `true`). [`String::debug_assert_thread_safe`] is the debug-build
// checkpoint for that hand-off; `to_thread_safe()` itself asserts its own
// postcondition. A `ThreadSafeString` newtype split would make this static,
// but is deferred until the FFI surface can be reshaped.
unsafe impl Send for String {}
// SAFETY: same contract as the `Send` impl above — sharing requires
// `is_thread_safe()`; non-WTF tags are inert and trivially `Sync`.
unsafe impl Sync for String {}

impl Drop for String {
    #[inline]
    fn drop(&mut self) {
        self.deref();
    }
}
impl Clone for String {
    /// +1 on the same `WTF::StringImpl` (bitwise for the non-WTF tags).
    #[inline]
    fn clone(&self) -> Self {
        self.ref_();
        Self(self.0)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `StringView<'a>` — a by-value *borrow* of a `String`. Holds the same 24
// bytes but never owns a ref; the lifetime ties it to the `String` (or byte
// slice) it was derived from. Derefs to `&String`.
// ──────────────────────────────────────────────────────────────────────────
#[repr(transparent)]
pub struct StringView<'a>(
    core::mem::ManuallyDrop<String>,
    core::marker::PhantomData<&'a String>,
);

impl<'a> StringView<'a> {
    pub const EMPTY: StringView<'static> = StringView(
        core::mem::ManuallyDrop::new(String::EMPTY),
        core::marker::PhantomData,
    );
    pub const DEAD: StringView<'static> = StringView(
        core::mem::ManuallyDrop::new(String::DEAD),
        core::marker::PhantomData,
    );

    #[inline]
    pub fn new(s: &'a String) -> Self {
        Self(
            core::mem::ManuallyDrop::new(String(s.0)),
            core::marker::PhantomData,
        )
    }
    /// Borrow `bytes` (no copy); scans and tags UTF-8 if any byte is non-ASCII.
    #[inline]
    pub fn from_bytes(bytes: &'a [u8]) -> Self {
        Self::from_encoded(EncodedSlice::from_bytes(bytes))
    }
    /// Borrow `bytes` as UTF-8 (no copy, no scan).
    #[inline]
    pub fn borrow_utf8(bytes: &'a [u8]) -> Self {
        Self::from_encoded(EncodedSlice::init_utf8(bytes))
    }
    /// Borrow `units` as UTF-16 (no copy).
    #[inline]
    pub fn borrow_utf16(units: &'a [u16]) -> Self {
        Self::from_encoded(EncodedSlice::init_utf16(units))
    }
    /// `'static` ASCII/Latin-1 literal (no scan).
    #[inline]
    pub fn static_<S: ?Sized + AsRef<[u8]>>(s: &'static S) -> StringView<'static> {
        StringView(
            core::mem::ManuallyDrop::new(String::static_(s)),
            core::marker::PhantomData,
        )
    }
    #[inline]
    pub fn from_encoded(z: EncodedSlice<'a>) -> Self {
        Self(
            core::mem::ManuallyDrop::new(String::wrap(Tag::EncodedSlice, z)),
            core::marker::PhantomData,
        )
    }
    /// UTF-8 bytes of the viewed storage; borrows for ASCII/UTF-8, allocates
    /// otherwise. Tied to `'a` (the owner), not to this view.
    #[inline]
    pub fn to_utf8(&self) -> Utf8Bytes<'a> {
        let utf8 = self.0.to_utf8();
        // SAFETY: the bytes belong to the `'a` owner this view borrows, not to
        // the 24-byte view itself.
        unsafe { core::mem::transmute::<Utf8Bytes<'_>, Utf8Bytes<'a>>(utf8) }
    }
}
impl core::ops::Deref for StringView<'_> {
    type Target = String;
    #[inline]
    fn deref(&self) -> &String {
        &self.0
    }
}
impl core::fmt::Display for StringView<'_> {
    #[inline]
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        core::fmt::Display::fmt(&**self, f)
    }
}

impl core::fmt::Display for String {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let s = self.to_utf8();
        // SAFETY: `to_utf8` always yields valid UTF-8 — it transcodes
        // Latin-1/UTF-16 and borrows already-UTF-8 inputs.
        f.write_str(unsafe { core::str::from_utf8_unchecked(s.slice()) })
    }
}

/// `Display` adapter for [`EncodedSlice::github_action`]; delegates to
/// `crate::fmt::github_action_writer` over the UTF-8 bytes.
pub struct EncodedSliceGithubActionFormatter<'a> {
    text: EncodedSlice<'a>,
}
impl core::fmt::Display for EncodedSliceGithubActionFormatter<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let utf8 = self.text.to_utf8();
        crate::fmt::github_action_writer(f, utf8.slice())
    }
}

impl core::fmt::Display for EncodedSlice<'_> {
    // Encoding-aware `Display` formatter.
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if self.is_utf8() {
            return write!(f, "{}", crate::fmt::s(self.slice()));
        }
        if self.is_16bit() {
            return crate::fmt::format_utf16_type(self.utf16_slice(), f);
        }
        crate::fmt::format_latin1(self.slice(), f)
    }
}

/// `{ptr, len}` plus encoding bits (Latin-1 / UTF-8 / UTF-16); borrows `'a`.
/// The pointer-tag accessors (`is_*` / `mark_*` / `len`) are reached via
/// `Deref` to [`bun_alloc::EncodedSliceRaw`].
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct EncodedSlice<'a>(bun_alloc::EncodedSliceRaw, PhantomData<&'a [u8]>);

impl core::ops::Deref for EncodedSlice<'_> {
    type Target = bun_alloc::EncodedSliceRaw;
    #[inline(always)]
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl core::ops::DerefMut for EncodedSlice<'_> {
    #[inline(always)]
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl Default for EncodedSlice<'_> {
    #[inline]
    fn default() -> Self {
        Self::EMPTY
    }
}

impl<'a> EncodedSlice<'a> {
    pub const EMPTY: Self = Self(bun_alloc::EncodedSliceRaw::EMPTY, PhantomData);

    /// Construct from an already-tagged pointer + length pair. `ptr` is stored
    /// verbatim — tag bits are not touched. Caller vouches for `'a`.
    #[inline]
    pub(crate) const fn from_tagged_ptr(ptr: *const u8, len: usize) -> Self {
        Self(
            bun_alloc::EncodedSliceRaw::from_tagged_ptr(ptr, len),
            PhantomData,
        )
    }

    /// Borrow `s` as Latin-1/ASCII (no encoding tag).
    #[inline]
    pub const fn init(s: &'a [u8]) -> Self {
        Self(bun_alloc::EncodedSliceRaw::init(s), PhantomData)
    }
    /// Borrow UTF-8 bytes (sets the UTF-8 ptr-tag).
    #[inline]
    pub fn init_utf8(s: &'a [u8]) -> Self {
        let mut z = Self::init(s);
        z.mark_utf8();
        z
    }
    /// Borrow UTF-16 code units (sets the 16-bit ptr-tag).
    #[inline]
    pub fn init_utf16(s: &'a [u16]) -> Self {
        Self(bun_alloc::EncodedSliceRaw::init_utf16(s), PhantomData)
    }

    /// Wrap a globally-allocated (mimalloc) UTF-16 buffer whose ownership is
    /// being handed to C++: sets the 16-bit and global ptr-tags.
    #[inline]
    pub fn init_utf16_global(s: &'a [u16]) -> Self {
        let mut z = Self::init_utf16(s);
        z.mark_global();
        z
    }

    /// Borrow `slice`; if it contains any non-ASCII byte, sets the UTF-8
    /// ptr-tag.
    #[inline]
    pub fn from_bytes(slice: &'a [u8]) -> Self {
        if !strings::is_all_ascii(slice) {
            Self::init_utf8(slice)
        } else {
            Self::init(slice)
        }
    }

    /// Wrap a `'static` ASCII literal. Generic over `str`/`[u8]` so either
    /// `"lit"` or `b"lit"` is accepted.
    #[inline]
    pub fn static_<S: ?Sized + AsRef<[u8]>>(slice: &'static S) -> EncodedSlice<'static> {
        EncodedSlice(
            bun_alloc::EncodedSliceRaw::init(slice.as_ref()),
            PhantomData,
        )
    }

    /// 8-bit byte view (Latin-1 or UTF-8). Caller must ensure `!is_16bit()`.
    #[inline]
    pub fn slice(self) -> &'a [u8] {
        let s: *const [u8] = self.0.slice();
        // SAFETY: the bytes live for `'a` (constructor contract), not for the
        // `Copy` wrapper `self`.
        unsafe { &*s }
    }
    /// UTF-16 code-unit view. Caller must ensure `is_16bit()`.
    #[inline]
    pub fn utf16_slice(self) -> &'a [u16] {
        let s: *const [u16] = self.0.utf16_slice();
        // SAFETY: see `slice`.
        unsafe { &*s }
    }
    /// Raw bytes regardless of encoding (`len * 2` for UTF-16).
    pub fn byte_slice(self) -> &'a [u8] {
        if self.len == 0 {
            return &[];
        }
        let bytes = if self.is_16bit() {
            self.len * 2
        } else {
            self.len
        };
        // SAFETY: constructor stored a valid ptr for `len` elements of the
        // tagged width; `bytes` is exactly that element count times element
        // size. Flag bits stripped by `untagged`.
        unsafe { core::slice::from_raw_parts(Self::untagged(self.tagged_ptr()), bytes) }
    }

    /// Exact UTF-8 byte length needed to encode this string.
    pub(crate) fn utf8_byte_length(self) -> usize {
        if self.is_utf8() {
            return self.len;
        }
        if self.is_16bit() {
            return crate::strings::element_length_utf16_into_utf8(self.utf16_slice());
        }
        let s = self.slice();
        // SAFETY: s describes a valid byte slice.
        unsafe { bun_simdutf_sys::simdutf::simdutf__utf8_length_from_latin1(s.as_ptr(), s.len()) }
    }

    /// Number of bytes the UTF-16LE encoding of this string would occupy.
    pub(crate) fn utf16_byte_length(self) -> usize {
        if self.is_utf8() {
            let s = self.slice();
            // SAFETY: s describes a valid byte slice.
            return unsafe {
                bun_simdutf_sys::simdutf::simdutf__utf16_length_from_utf8(s.as_ptr(), s.len())
            } * 2;
        }
        if self.is_16bit() {
            return self.len * 2;
        }
        // Latin-1 → one UTF-16 code unit per byte.
        self.len * 2
    }

    /// `Display` formatter that escapes the string for GitHub Actions
    /// annotation output (`%0A` for newlines, ANSI stripped).
    #[inline]
    pub fn github_action(self) -> EncodedSliceGithubActionFormatter<'a> {
        EncodedSliceGithubActionFormatter { text: self }
    }

    /// Allocate a NUL-terminated UTF-8 copy.
    pub fn to_owned_slice_z(self) -> crate::ZBox {
        if self.is_utf8() {
            let mut v = self.slice().to_vec();
            v.push(0);
            return crate::ZBox::from_vec_with_nul(v);
        }
        let mut list = if self.is_16bit() {
            crate::strings::to_utf8_alloc(self.utf16_slice())
        } else {
            crate::strings::allocate_latin1_into_utf8_with_list(Vec::new(), 0, self.slice())
        };
        list.push(0);
        crate::ZBox::from_vec_with_nul(list)
    }

    /// First index whose code unit matches any byte in `chars`. The 16-bit
    /// branch narrows each unit to the Latin-1 range before comparing.
    pub fn index_of_any(self, chars: &'static [u8]) -> Option<usize> {
        if self.is_16bit() {
            self.utf16_slice()
                .iter()
                .position(|&c| c < 256 && chars.contains(&(c as u8)))
        } else {
            crate::strings::index_of_any(self.slice(), chars)
        }
    }

    /// Code unit at `i`, widened to `u16` regardless of encoding. Caller must
    /// ensure `i < self.len`.
    #[inline]
    pub fn char_at(self, i: usize) -> u16 {
        debug_assert!(i < self.len);
        if self.is_16bit() {
            self.utf16_slice()[i]
        } else {
            self.slice()[i] as u16
        }
    }

    /// Encoding-aware equality against an ASCII literal.
    pub fn eql_comptime<S: ?Sized + AsRef<[u8]>>(self, other: &S) -> bool {
        let other = other.as_ref();
        if self.is_16bit() {
            return strings::eql_comptime_utf16(self.utf16_slice(), other);
        }
        if self.len != other.len() {
            return false;
        }
        strings::eql_comptime_ignore_len(self.slice(), other)
    }

    /// Encoding-aware equality.
    pub(crate) fn eql(self, other: EncodedSlice<'_>) -> bool {
        if self.len == 0 || other.len == 0 {
            return self.len == other.len;
        }
        let l16 = self.is_16bit();
        let r16 = other.is_16bit();
        if l16 && r16 {
            return self.utf16_slice() == other.utf16_slice();
        }
        if !l16 && !r16 {
            return self.slice() == other.slice();
        }
        // Mixed encoding — go through the UTF-8 view.
        self.to_utf8().slice() == other.to_utf8().slice()
    }

    /// If the (currently-untagged) bytes contain any non-ASCII, mark the
    /// pointer as UTF-16 (assumes the bytes were sourced from a JS-produced
    /// 8-bit string and need re-widening on non-ASCII).
    #[inline]
    pub(crate) fn detect_encoding(&mut self) {
        if !strings::is_all_ascii(self.slice()) {
            self.mark_utf16();
        }
    }

    /// For `toJS`/`toExternalValue` callers: if 8-bit, run `detect_encoding`;
    /// if (now) 16-bit, mark UTF-8 so the C++ side decodes the bytes as UTF-8
    /// instead of Latin-1.
    #[inline]
    pub fn set_output_encoding(&mut self) {
        if !self.is_16bit() {
            self.detect_encoding();
        }
        if self.is_16bit() {
            self.mark_utf8();
        }
    }

    /// `Display`-format into `buf`, NUL-terminate, and return the borrowed
    /// `[:0]u8`. Errors if the formatted output (plus NUL) would not fit.
    pub fn slice_z_buf(self, buf: &mut crate::PathBuffer) -> crate::CrateResult<&ZStr> {
        use std::io::Write as _;
        let buf_slice: &mut [u8] = &mut buf[..];
        let start_len = buf_slice.len();
        let mut cursor: &mut [u8] = buf_slice;
        write!(cursor, "{}", self).map_err(|_| crate::CrateError::NoSpaceLeft)?;
        let written = start_len - cursor.len();
        if written >= buf.len() {
            return Err(crate::CrateError::NoSpaceLeft);
        }
        buf[written] = 0;
        Ok(ZStr::from_buf(&buf[..], written))
    }

    #[inline]
    pub(crate) fn untagged(ptr: *const u8) -> *const u8 {
        bun_alloc::EncodedSliceRaw::untagged(ptr)
    }

    /// Re-wrap a sub-range of the underlying storage, preserving the
    /// UTF-8/16-bit/global tag bits.
    pub fn substring_with_len(self, start_index: usize, end_index: usize) -> Self {
        if self.is_16bit() {
            let mut out = Self::init_utf16(&self.utf16_slice()[start_index..end_index]);
            if self.is_globally_allocated() {
                out.mark_global();
            }
            return out;
        }
        let mut out = Self::init(&self.slice()[start_index..end_index]);
        if self.is_utf8() {
            out.mark_utf8();
        }
        if self.is_globally_allocated() {
            out.mark_global();
        }
        out
    }
    #[inline]
    pub fn substring(self, start_index: usize) -> Self {
        self.substring_with_len(start_index.min(self.len), self.len)
    }
    /// Clamp `len`, preserving the pointer (and its tag bits) verbatim.
    #[inline]
    pub(crate) fn trunc(self, len: usize) -> Self {
        Self::from_tagged_ptr(self.tagged_ptr(), self.len.min(len))
    }
    /// Borrowed-or-owned UTF-8: borrows when UTF-8-tagged or all-ASCII 8-bit,
    /// transcodes UTF-16 and Latin-1 with high bytes.
    ///
    /// `#[inline]` so the 32-byte `Utf8Bytes` enum return is constructed
    /// directly in the caller's slot (NRVO-ish) instead of being assembled in a
    /// local and AVX-memcpy'd out — measurable in `path.join` per-arg loops.
    #[inline]
    pub fn to_utf8(self) -> Utf8Bytes<'a> {
        if self.len == 0 {
            return Utf8Bytes::EMPTY;
        }
        if self.is_16bit() {
            return Utf8Bytes::Owned(crate::strings::to_utf8_alloc(self.utf16_slice()));
        }
        let bytes = self.slice();
        if !self.is_utf8() {
            // Non-UTF-8 = Latin-1; transcode if any byte ≥ 0x80.
            if let Some(v) = crate::strings::to_utf8_from_latin1(bytes) {
                return Utf8Bytes::Owned(v);
            }
        }
        Utf8Bytes::Borrowed(bytes)
    }

    /// Allocate a fresh UTF-8 `Vec<u8>` regardless of the source encoding.
    /// UTF-16 → transcode; UTF-8 → copy; Latin-1 → transcode (or copy if
    /// all-ASCII).
    ///
    /// The returned buffer is NUL-terminated one byte past `len()` (the
    /// terminator is *not* included in `len()`) so `sliceZBuf` / C-string
    /// consumers can read `as_ptr()` directly.
    pub fn to_owned_slice(self) -> Vec<u8> {
        // Write a NUL sentinel at `v[len]` without bumping `len`.
        #[inline]
        fn with_sentinel(mut v: Vec<u8>) -> Vec<u8> {
            v.reserve_exact(1);
            // `reserve_exact(1)` guarantees `cap >= len + 1`; write the
            // sentinel into spare capacity without bumping `len`.
            v.spare_capacity_mut()[0].write(0);
            v
        }
        if self.len == 0 {
            return Vec::new();
        }
        // Order matters — `isUTF8()` is tested
        // before `is16Bit()` so a string with both tags set takes the UTF-8 arm.
        if self.is_utf8() {
            return with_sentinel(self.slice().to_vec());
        }
        if self.is_16bit() {
            return with_sentinel(crate::strings::to_utf8_alloc(self.utf16_slice()));
        }
        // Latin-1: transcode non-ASCII, else byte-copy.
        let bytes = self.slice();
        with_sentinel(crate::strings::to_utf8_from_latin1(bytes).unwrap_or_else(|| bytes.to_vec()))
    }
}

/// UTF-8 bytes derived from a string: borrowed when the source is already
/// UTF-8 (incl. 8-bit all-ASCII), otherwise a transcoded copy, or a view kept
/// alive by a `WTF::StringImpl` ref it holds.
pub enum Utf8Bytes<'a> {
    Borrowed(&'a [u8]),
    Owned(Vec<u8>),
    /// 8-bit ASCII buffer of `string_impl`, on which this holds a ref.
    Shared {
        string_impl: *const wtf::WTFStringImplStruct,
        bytes: RawSlice<u8>,
    },
}
impl Default for Utf8Bytes<'_> {
    fn default() -> Self {
        Self::EMPTY
    }
}
impl From<Vec<u8>> for Utf8Bytes<'_> {
    #[inline]
    fn from(v: Vec<u8>) -> Self {
        Self::Owned(v)
    }
}
impl<'a> Utf8Bytes<'a> {
    pub const EMPTY: Self = Self::Borrowed(b"");
    #[inline]
    pub const fn empty() -> Self {
        Self::EMPTY
    }
    /// Allocate an owned copy of `input`.
    pub fn init_dupe(input: &[u8]) -> Result<Self, crate::AllocError> {
        Ok(Self::Owned(input.to_vec()))
    }
    /// Detach from any `'a` borrow: `Borrowed` is copied; `Owned`/`Shared`
    /// pass through.
    pub fn into_owned(self) -> Utf8Bytes<'static> {
        match self {
            Self::Borrowed(b) => Utf8Bytes::Owned(b.to_vec()),
            // SAFETY: `Owned`/`Shared` hold no `'a` borrow.
            owned => unsafe { core::mem::transmute::<Utf8Bytes<'a>, Utf8Bytes<'static>>(owned) },
        }
    }
    #[inline]
    pub fn slice(&self) -> &[u8] {
        match self {
            Self::Borrowed(b) => b,
            Self::Owned(v) => v.as_slice(),
            Self::Shared { bytes, .. } => bytes.slice(),
        }
    }
    #[inline]
    pub fn length(&self) -> usize {
        self.slice().len()
    }
    /// Consume into an owned `Vec<u8>` — moves out the buffer if `Owned`,
    /// allocates a copy otherwise.
    pub fn into_vec(mut self) -> Vec<u8> {
        if let Self::Owned(v) = &mut self {
            return core::mem::take(v);
        }
        self.slice().to_vec()
    }
    /// True iff this owns memory (`Owned` buffer or `Shared` ref) released on
    /// `Drop`; `Borrowed` views someone else's storage.
    #[inline]
    pub fn is_allocated(&self) -> bool {
        matches!(self, Self::Owned(_) | Self::Shared { .. })
    }
    /// True iff this is a ref-holding view into a `WTF::StringImpl`.
    #[inline]
    pub fn is_shared(&self) -> bool {
        matches!(self, Self::Shared { .. })
    }
    /// Consume an `Owned` slice into the raw `(ptr, len)` pair without freeing,
    /// for hand-off to a foreign owner (JSC external string). Any other
    /// variant returns `None` and leaves `self` untouched.
    pub fn take_owned_raw(&mut self) -> Option<(*const u8, usize)> {
        let Self::Owned(v) = self else {
            return None;
        };
        let mut v = core::mem::ManuallyDrop::new(core::mem::take(v));
        *self = Self::EMPTY;
        // Shrink so the foreign `mi_free(ptr)` releases exactly this block.
        v.shrink_to_fit();
        Some((v.as_ptr(), v.len()))
    }
}
impl Clone for Utf8Bytes<'_> {
    /// Views the same bytes: `Borrowed` copies the borrow, `Shared` takes
    /// another ref, `Owned` deep-copies.
    fn clone(&self) -> Self {
        match self {
            Self::Borrowed(b) => Self::Borrowed(b),
            Self::Owned(v) => Self::Owned(v.clone()),
            Self::Shared { string_impl, bytes } => {
                // SAFETY: `Shared` holds a ref, so `string_impl` is live;
                // the clone's `Drop` pairs with this ref.
                unsafe { (**string_impl).r#ref() };
                Self::Shared {
                    string_impl: *string_impl,
                    bytes: *bytes,
                }
            }
        }
    }
}
impl Drop for Utf8Bytes<'_> {
    fn drop(&mut self) {
        if let Self::Shared { string_impl, .. } = *self {
            // SAFETY: constructor took a ref; we now release it.
            unsafe { (*string_impl).deref() }
        }
    }
}
impl core::ops::Deref for Utf8Bytes<'_> {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        self.slice()
    }
}
impl AsRef<[u8]> for Utf8Bytes<'_> {
    #[inline]
    fn as_ref(&self) -> &[u8] {
        self.slice()
    }
}

/// A UTF-8 view of `underlying`: `utf8` holds a transcoded copy when
/// `underlying` is not already UTF-8 (or when there is no `underlying`);
/// otherwise the bytes are read from `underlying` on demand.
pub struct SliceWithUnderlyingString {
    pub utf8: Option<Vec<u8>>,
    pub underlying: String,
    #[cfg(debug_assertions)]
    pub did_report_extra_memory_debug: bool,
}

impl Default for SliceWithUnderlyingString {
    #[inline]
    fn default() -> Self {
        Self {
            utf8: None,
            underlying: String::DEAD,
            #[cfg(debug_assertions)]
            did_report_extra_memory_debug: false,
        }
    }
}

impl SliceWithUnderlyingString {
    /// True iff the UTF-8 bytes are read straight out of a WTF-backed
    /// `underlying` (no transcoded copy).
    #[inline]
    pub fn is_shared(&self) -> bool {
        self.utf8.is_none() && self.underlying.0.tag == Tag::WTFStringImpl
    }

    /// Another ref to `underlying` with no UTF-8 copy (callers re-derive it).
    pub fn dupe_ref(&self) -> SliceWithUnderlyingString {
        SliceWithUnderlyingString {
            utf8: None,
            underlying: self.underlying.clone(),
            #[cfg(debug_assertions)]
            did_report_extra_memory_debug: false,
        }
    }

    /// The UTF-8 bytes.
    #[inline]
    pub fn slice(&self) -> &[u8] {
        if let Some(utf8) = &self.utf8 {
            return utf8;
        }
        match self.underlying.0.tag {
            Tag::WTFStringImpl => {
                let wtf = self.underlying.as_wtf();
                if wtf.is_8bit() {
                    wtf.latin1_slice()
                } else {
                    b""
                }
            }
            Tag::EncodedSlice | Tag::StaticEncodedSlice => {
                let z = self.underlying.encoded();
                if z.is_16bit() { b"" } else { z.slice() }
            }
            Tag::Dead | Tag::Empty => b"",
        }
    }

    /// Detach the UTF-8 bytes for storing: moves the transcoded copy out, or
    /// moves `underlying`'s ref into a `Shared` slice.
    pub fn into_utf8(self) -> Utf8Bytes<'static> {
        match self.utf8 {
            Some(utf8) => Utf8Bytes::Owned(utf8),
            None => self.underlying.into_utf8(),
        }
    }

    /// If `underlying` is WTF-backed, migrate it to a thread-safe impl.
    pub fn to_thread_safe(&mut self) {
        self.underlying.to_thread_safe();
    }
}

impl Clone for SliceWithUnderlyingString {
    fn clone(&self) -> Self {
        Self {
            utf8: self.utf8.clone(),
            underlying: self.underlying.clone(),
            #[cfg(debug_assertions)]
            did_report_extra_memory_debug: self.did_report_extra_memory_debug,
        }
    }
}

impl core::fmt::Display for SliceWithUnderlyingString {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match &self.utf8 {
            Some(utf8) => write!(f, "{}", crate::fmt::s(utf8)),
            None => self.underlying.fmt(f),
        }
    }
}

// PORTING.md: ZStr/WStr are length-carrying NUL-terminated slices.
// bun_core re-exports these; we are the canonical home.
pub use crate::{WStr, ZStr};

/// `bun.schema.api.StringPointer` — canonical definition lives in `bun_core`
/// (lowest tier); re-exported here so existing `bun_core::StringPointer`
/// callers (FFI sigs in `bun_jsc::FetchHeaders`, lockfile, sourcemap) keep
/// resolving.
pub use crate::StringPointer;

pub use hashed_string::HashedString;
pub use mutable_string::MutableString;
pub use smol_str::SmolStr;
pub use string_builder::StringBuilder;

// ──────────────────────────────────────────────────────────────────────────
// `encoding` — Node.js Buffer encoding tag. Self-contained.
// ──────────────────────────────────────────────────────────────────────────
pub mod encoding {
    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    pub enum Encoding {
        #[default]
        Utf8 = 0,
        Ucs2,
        Utf16le,
        Latin1,
        Ascii,
        Base64,
        Base64url,
        Hex,
        Buffer,
    }
}
pub use encoding::Encoding as NodeEncoding;

// ──────────────────────────────────────────────────────────────────────────
// `lexer` — identifier predicates. Thin `u32`-taking wrapper over the
// [`identifier`] two-stage Unicode tables (moved down from `bun_js_parser`).
// ──────────────────────────────────────────────────────────────────────────
pub mod lexer {
    #[inline]
    pub fn is_identifier_start(c: u32) -> bool {
        crate::string::identifier::is_identifier_start(c as i32)
    }
    #[inline]
    pub(crate) fn is_identifier_continue(c: u32) -> bool {
        crate::string::identifier::is_identifier_part(c as i32)
    }
    #[inline]
    pub fn is_identifier_part(c: u32) -> bool {
        is_identifier_continue(c)
    }
    pub use crate::string::identifier::{is_identifier, is_identifier_utf16};
}

pub mod lexer_tables {
    crate::comptime_string_map! {
        /// The 9 strict-mode reserved words (ES2015 §11.6.2.2) mapped to the
        /// underscore-prefixed replacement used by
        /// `MutableString::ensure_valid_identifier` to mangle a name that is
        /// already a syntactically valid identifier but would collide with a
        /// strict-mode reserved word. Single source of truth —
        /// [`STRICT_MODE_RESERVED_WORDS`], [`is_strict_mode_reserved_word`],
        /// and [`strict_mode_reserved_word_remap`] all derive from it.
        static STRICT_MODE_RESERVED_WORD_REMAP: &'static [u8] = {
            b"implements" => b"_implements",
            b"interface" => b"_interface",
            b"let" => b"_let",
            b"package" => b"_package",
            b"private" => b"_private",
            b"protected" => b"_protected",
            b"public" => b"_public",
            b"static" => b"_static",
            b"yield" => b"_yield",
        };
    }

    /// The 9 strict-mode reserved words as a plain array, for callers that
    /// only need `.len()` / `.iter()`.
    pub const STRICT_MODE_RESERVED_WORDS: [&[u8]; 9] = {
        let entries = __ComptimeStringMap_STRICT_MODE_RESERVED_WORD_REMAP::ENTRIES;
        assert!(entries.len() == 9);
        let mut out: [&[u8]; 9] = [&[]; 9];
        let mut i = 0;
        while i < out.len() {
            out[i] = entries[i].0;
            i += 1;
        }
        out
    };

    /// Hot-path strict-mode reserved-word membership check.
    #[inline]
    pub fn is_strict_mode_reserved_word(s: &[u8]) -> bool {
        STRICT_MODE_RESERVED_WORD_REMAP.contains_key(s)
    }

    /// Underscore-prefixed replacement for a strict-mode reserved word
    /// (`b"let"` → `b"_let"`); `None` for any other input.
    #[inline]
    pub fn strict_mode_reserved_word_remap(s: &[u8]) -> Option<&'static [u8]> {
        STRICT_MODE_RESERVED_WORD_REMAP.get(s).copied()
    }
}

/// `jsc::VirtualMachine::string_allocation_limit` —
/// process-wide WTF::StringImpl character-count cap, exported for C++ as
/// `Bun__stringSyntheticAllocationLimit`. The value lives here (not `bun_jsc`)
/// because [`String::max_length`] / `create_external*` need it without an
/// upward dep; `bun_jsc::VirtualMachine` writes it during init / via the
/// `setSyntheticAllocationLimitForTesting` hook.
#[unsafe(export_name = "Bun__stringSyntheticAllocationLimit")]
pub static STRING_ALLOCATION_LIMIT: AtomicUsize = AtomicUsize::new(u32::MAX as usize);

/// Mirror of `WTF::StringImpl::MaxLength` (`INT32_MAX`), which C++ enforces
/// with `RELEASE_ASSERT` in the `StringImplShape` constructors.
pub const WTF_STRING_MAX_LENGTH: usize = i32::MAX as usize;

// ──────────────────────────────────────────────────────────────────────────
// move-in: printer (MOVE_DOWN ← `bun_js_printer`)
//
// Self-contained string-quoting helpers used by `strings::format_escapes`,
// `bun_sourcemap::Chunk` (JSON serialization), and `bun_ast::Expr`.
// Breaking the `bun_js_printer → bun_sourcemap` cycle by hosting the
// pure-string `quoteForJSON` here.
// ──────────────────────────────────────────────────────────────────────────
pub mod printer {
    use crate::string::immutable::{self as strings, Encoding as StrEncoding};
    use crate::string::mutable_string::MutableString;

    use crate::fmt::{hex2_upper, hex4_upper};

    pub const FIRST_ASCII: u32 = 0x20;
    pub const LAST_ASCII: u32 = 0x7E;
    pub const FIRST_HIGH_SURROGATE: u32 = 0xD800;
    pub const LAST_LOW_SURROGATE: u32 = 0xDFFF;

    /// Encode a BMP code unit (`c <= 0xFFFF`, including lone surrogates) as the
    /// 6-byte sequence `\uHHHH` (uppercase hex). Caller feeds the result to its
    /// own byte sink.
    #[inline]
    pub const fn bmp_escape(c: u32) -> [u8; 6] {
        let h = hex4_upper(c as u16);
        [b'\\', b'u', h[0], h[1], h[2], h[3]]
    }

    /// Encode a supplementary code point (`c > 0xFFFF`) as a 12-byte UTF-16
    /// surrogate-pair `\uHHHH\uHHHH` escape (uppercase hex).
    #[inline]
    pub const fn surrogate_pair_escape(c: u32) -> [u8; 12] {
        let [lo, hi] = crate::strings::encode_surrogate_pair(c);
        let l = hex4_upper(lo);
        let h = hex4_upper(hi);
        [
            b'\\', b'u', l[0], l[1], l[2], l[3], b'\\', b'u', h[0], h[1], h[2], h[3],
        ]
    }

    /// Byte-sink alias so `write_pre_quoted_string` works for `Vec<u8>`,
    /// `MutableString`, and any other `crate::io::Write` sink.
    pub use crate::io::Write as PrinterWriter;

    #[inline]
    fn can_print_without_escape(c: i32, ascii_only: bool) -> bool {
        if c <= LAST_ASCII as i32 {
            c >= FIRST_ASCII as i32
                && c != b'\\' as i32
                && c != b'"' as i32
                && c != b'\'' as i32
                && c != b'`' as i32
                && c != b'$' as i32
        } else {
            !ascii_only
                && c != 0xFEFF
                && c != 0x2028
                && c != 0x2029
                && (c < FIRST_HIGH_SURROGATE as i32 || c > LAST_LOW_SURROGATE as i32)
        }
    }

    /// Same algorithm as `bun_js_printer::write_pre_quoted_string`.
    /// PERF: (quote_char, ascii_only, json, encoding) are runtime params —
    /// profile if it shows up on a hot path.
    pub fn write_pre_quoted_string<W: PrinterWriter + ?Sized>(
        text_in: &[u8],
        writer: &mut W,
        quote_char: u8,
        ascii_only: bool,
        json: bool,
        encoding: StrEncoding,
    ) -> crate::CrateResult<()> {
        debug_assert!(!json || quote_char == b'"');
        // utf16 view over the same bytes (only used when encoding == Utf16).
        // Callers pass 2-byte-aligned even-length input for Utf16; `cast_slice`
        // panics (rather than UB) if that contract is violated.
        let text16: &[u16] = if encoding == StrEncoding::Utf16 {
            crate::cast_slice::<u8, u16>(text_in)
        } else {
            &[]
        };
        let n: usize = if encoding == StrEncoding::Utf16 {
            text16.len()
        } else {
            text_in.len()
        };
        let mut i: usize = 0;

        while i < n {
            let width: u8 = match encoding {
                StrEncoding::Latin1 | StrEncoding::Ascii | StrEncoding::Utf16 => 1,
                StrEncoding::Utf8 => strings::wtf8_byte_sequence_length_with_invalid(text_in[i]),
            };
            let clamped_width = (width as usize).min(n.saturating_sub(i));
            let c: i32 = match encoding {
                StrEncoding::Utf8 => {
                    let mut buf = [0u8; 4];
                    buf[..clamped_width].copy_from_slice(&text_in[i..i + clamped_width]);
                    strings::decode_wtf8_rune_t::<i32>(buf, width, 0)
                }
                StrEncoding::Ascii => {
                    debug_assert!(text_in[i] <= 0x7F);
                    text_in[i] as i32
                }
                StrEncoding::Latin1 => text_in[i] as i32,
                StrEncoding::Utf16 => text16[i] as i32,
            };

            if can_print_without_escape(c, ascii_only) {
                match encoding {
                    StrEncoding::Ascii | StrEncoding::Utf8 => {
                        let remain = &text_in[i + clamped_width..];
                        if let Some(j) = strings::index_of_needs_escape_for_java_script_string(
                            remain, quote_char,
                        ) {
                            writer.write_all(&text_in[i..i + clamped_width])?;
                            i += clamped_width;
                            writer.write_all(&remain[..j as usize])?;
                            i += j as usize;
                        } else {
                            writer.write_all(&text_in[i..])?;
                            break;
                        }
                    }
                    StrEncoding::Latin1 | StrEncoding::Utf16 => {
                        let mut cp = [0u8; 4];
                        let cp_len = strings::encode_wtf8_rune(&mut cp, c as u32);
                        writer.write_all(&cp[..cp_len])?;
                        i += clamped_width;
                    }
                }
                continue;
            }

            match c {
                0x07 => {
                    writer.write_all(if json { b"\\u0007" } else { b"\\x07" })?;
                    i += 1;
                }
                0x08 => {
                    writer.write_all(b"\\b")?;
                    i += 1;
                }
                0x0C => {
                    writer.write_all(b"\\f")?;
                    i += 1;
                }
                0x0A => {
                    writer.write_all(if quote_char == b'`' { b"\n" } else { b"\\n" })?;
                    i += 1;
                }
                0x0D => {
                    writer.write_all(b"\\r")?;
                    i += 1;
                }
                0x0B => {
                    writer.write_all(if json { b"\\u000B" } else { b"\\v" })?;
                    i += 1;
                }
                0x5C => {
                    writer.write_all(b"\\\\")?;
                    i += 1;
                }
                0x22 => {
                    writer.write_all(if quote_char == b'"' { b"\\\"" } else { b"\"" })?;
                    i += 1;
                }
                0x27 => {
                    writer.write_all(if quote_char == b'\'' { b"\\'" } else { b"'" })?;
                    i += 1;
                }
                0x60 => {
                    writer.write_all(if quote_char == b'`' { b"\\`" } else { b"`" })?;
                    i += 1;
                }
                0x24 => {
                    if quote_char == b'`' {
                        let next_is_brace = match encoding {
                            StrEncoding::Utf16 => i + 1 < n && text16[i + 1] == b'{' as u16,
                            _ => i + 1 < n && text_in[i + 1] == b'{',
                        };
                        writer.write_all(if next_is_brace { b"\\$" } else { b"$" })?;
                    } else {
                        writer.write_all(b"$")?;
                    }
                    i += 1;
                }
                0x09 => {
                    writer.write_all(if quote_char == b'`' { b"\t" } else { b"\\t" })?;
                    i += 1;
                }
                _ => {
                    i += width as usize;
                    if c <= 0xFF && !json {
                        let h = hex2_upper(c as u8);
                        writer.write_all(&[b'\\', b'x', h[0], h[1]])?;
                    } else if c <= 0xFFFF {
                        writer.write_all(&bmp_escape(c as u32))?;
                    } else {
                        writer.write_all(&surrogate_pair_escape(c as u32))?;
                    }
                }
            }
        }
        Ok(())
    }

    /// Port of `js_printer.quoteForJSON`. MOVE_DOWN so `bun_sourcemap` /
    /// `bun_js_parser` can call it without depending on `bun_js_printer`.
    pub fn quote_for_json(
        text: &[u8],
        bytes: &mut MutableString,
        ascii_only: bool,
    ) -> crate::CrateResult<()> {
        // PERF: consider pre-growing via an estimated UTF-8 length — profile if it shows up on a hot path.
        bytes.append_char(b'"')?;
        write_pre_quoted_string(text, bytes, b'"', ascii_only, true, StrEncoding::Utf8)?;
        bytes.append_char(b'"').expect("unreachable");
        Ok(())
    }
}
pub use printer::quote_for_json;

// ──────────────────────────────────────────────────────────────────────────
// Top-level free helpers.
// ──────────────────────────────────────────────────────────────────────────

/// `bun.sliceTo(buf, 0)` — slice up to (not including) the first NUL byte,
/// or the whole buffer if none.
/// Sunk to `crate::ffi` so tier-1 crates (cares_sys, sys) can share it;
/// re-exported here for the existing `bun_core::slice_to_nul` callers.
pub use crate::ffi::slice_to_nul;

/// Pure path-string helper used by the bundler chunk writer and `css::printer`.
/// Returns `[prefix', suffix']` such that concatenating them produces a
/// reasonably-normalized path (collapses `./` leading and avoids `//`).
/// The two-element-array return shape lets bundler call-sites index it
/// directly.
pub fn cheap_prefix_normalizer<'a>(prefix: &'a [u8], suffix: &'a [u8]) -> [&'a [u8]; 2] {
    if prefix.is_empty() {
        let suffix_no_slash = strings::remove_leading_dot_slash(suffix);
        return [
            if strings::has_prefix_comptime(suffix_no_slash, b"../") {
                b""
            } else {
                b"./"
            },
            suffix_no_slash,
        ];
    }

    // ["https://example.com/", "/out.js"]  => "https://example.com/out.js"
    // ["/foo/", "/bar.js"]                 => "/foo/bar.js"
    let win = crate::Environment::IS_WINDOWS;
    if strings::ends_with_char(prefix, b'/') || (win && strings::ends_with_char(prefix, b'\\')) {
        if strings::starts_with_char(suffix, b'/')
            || (win && strings::starts_with_char(suffix, b'\\'))
        {
            return [prefix, &suffix[1..]];
        }
        // It gets really complicated if we try to deal with URLs more than this.
    }

    [prefix, strings::remove_leading_dot_slash(suffix)]
}

// Re-export `wtf::parse_double` at crate root (callers spell it `bun_core::parse_double`).
pub use wtf::parse_double;
