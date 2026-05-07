#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! `bun_str` — B-1 minimal compiling surface.
//! Full Phase-A draft preserved in `lib_draft_b1.rs` (gated).
//! B-2: un-gate module-by-module, replace stubs with real impls.

// Small data-structure modules — un-gated in B-2.
#[path = "HashedString.rs"]  pub mod hashed_string;
#[path = "PathString.rs"]    pub mod path_string;
#[path = "SmolStr.rs"]       pub mod smol_str;
#[path = "StringBuilder.rs"] pub mod string_builder;
#[path = "StringJoiner.rs"]  pub mod string_joiner;
#[path = "escapeRegExp.rs"]  pub mod escape_reg_exp;

#[path = "MutableString.rs"] pub mod mutable_string;
pub mod wtf;

// `bun.strings.*` — 132 SIMD-backed scanners over highway/simdutf FFI.
// Submodules (unicode_draft etc.) gated inside; core scalar+highway fns real.
#[path = "immutable.rs"] pub mod immutable;
// Full Phase-A draft of string.zig (the 5-variant String impl). Real
// `String`/`ZigString` already implemented above; this draft is the broader
// surface (encode_with_allocator, ref_count_allocator, etc.) and depends on
// `bun_cpp` (BunString FFI shim crate, not yet wired) plus ~30 ZigString
// methods that haven't been split out from `string.zig` yet. Draft module
// dropped from build (duplicate of live impls above); file kept on disk as
// move-in reference until `bun_cpp` lands.
// #[path = "lib_draft_b1.rs"] mod draft;

use core::sync::atomic::{AtomicPtr, Ordering};
pub use wtf::{WTFStringImpl, WTFStringImplStruct};

// ──────────────────────────────────────────────────────────────────────────
// `bun.String` — 5-variant tagged WTFString-or-ZigString. extern layout
// must match Zig `extern struct { tag: Tag, value: StringImpl }` (= C++
// `BunString` in BunString.cpp), 24 bytes on 64-bit.
// ──────────────────────────────────────────────────────────────────────────
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tag {
    Dead = 0,
    WTFStringImpl = 1,
    ZigString = 2,
    StaticZigString = 3,
    Empty = 4,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub union StringImpl {
    zig: ZigString,
    wtf: WTFStringImpl, // *mut WTFStringImplStruct
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct String {
    tag: Tag,
    // repr(C) inserts 7 bytes padding here (StringImpl is 8-aligned).
    value: StringImpl,
}

const _: () = assert!(core::mem::size_of::<String>() == 24);
const _: () = assert!(core::mem::align_of::<String>() == 8);

// FFI surface from `src/jsc/bindings/BunString.cpp`. All return a fresh
// WTF-backed `String` with refcount = 1; caller must `deref()` (or transfer).
unsafe extern "C" {
    fn BunString__fromBytes(bytes: *const u8, len: usize) -> String;
    fn BunString__fromLatin1(bytes: *const u8, len: usize) -> String;
    fn BunString__fromUTF8(bytes: *const u8, len: usize) -> String;
    fn BunString__fromUTF16(bytes: *const u16, len: usize) -> String;
    fn BunString__fromUTF16ToLatin1(bytes: *const u16, len: usize) -> String;
    fn BunString__fromLatin1Unitialized(len: usize) -> String;
    fn BunString__fromUTF16Unitialized(len: usize) -> String;
    fn BunString__toWTFString(this: *mut String);
    fn BunString__toThreadSafe(this: *mut String);
    fn BunString__createAtom(bytes: *const u8, len: usize) -> String;
    fn BunString__tryCreateAtom(bytes: *const u8, len: usize) -> String;
    fn BunString__createStaticExternal(bytes: *const u8, len: usize, isLatin1: bool) -> String;
    fn BunString__toInt32(this: *const String) -> i64;
    fn BunString__createExternal(
        bytes: *const u8,
        len: usize,
        is_latin1: bool,
        ctx: *mut core::ffi::c_void,
        callback: Option<extern "C" fn(*mut core::ffi::c_void, *mut core::ffi::c_void, u32)>,
    ) -> String;
    fn BunString__createExternalGloballyAllocatedLatin1(bytes: *mut u8, len: usize) -> String;
    fn BunString__createExternalGloballyAllocatedUTF16(bytes: *mut u16, len: usize) -> String;
}

/// `ctx` is the pointer passed into `create_external`; `buffer` is the
/// `[*]u8`/`[*]u16` storage; `len` is the character count.
pub type ExternalStringImplFreeFunction<Ctx> =
    extern "C" fn(ctx: Ctx, buffer: *mut core::ffi::c_void, len: u32);

impl String {
    pub const EMPTY: Self = Self { tag: Tag::Empty, value: StringImpl { zig: ZigString::EMPTY } };
    pub const DEAD: Self = Self { tag: Tag::Dead, value: StringImpl { zig: ZigString::EMPTY } };

    #[inline] pub const fn empty() -> Self { Self::EMPTY }
    #[inline] pub const fn dead() -> Self { Self::DEAD }
    #[inline] pub fn tag(&self) -> Tag { self.tag }

    /// `bun.String.init(anytype)` — polymorphic borrow constructor
    /// (string.zig:331). Mirrors the Zig `switch (@TypeOf(value))` table via
    /// `Into<Self>` impls below: `String` is identity, `ZigString` is wrapped,
    /// byte/str slices go through `ZigString::from_bytes`.
    #[inline]
    pub fn init<T: Into<Self>>(value: T) -> Self {
        value.into()
    }

    /// `bun.String.borrowUTF8` — borrow `s` (no copy, no refcount). Caller
    /// must keep `s` alive for the String's lifetime.
    #[inline]
    pub fn borrow_utf8(s: &[u8]) -> Self {
        Self::init(ZigString::init_utf8(s))
    }
    #[inline]
    pub fn borrow_utf16(s: &[u16]) -> Self {
        Self::init(ZigString::init_utf16(s))
    }
    #[inline]
    pub fn ascii(s: &[u8]) -> Self {
        Self::init(ZigString::init(s))
    }

    /// `bun.String.static` — `'static` slice; converted to JS via
    /// `WTF::ExternalStringImpl` without copying. Generic over `str`/`[u8]`
    /// so call sites may pass either `"lit"` or `b"lit"` (Zig's `[:0]const u8`
    /// literal maps to both in ported code).
    #[inline]
    pub fn static_<S: ?Sized + AsRef<[u8]>>(s: &'static S) -> Self {
        // Zig: ZigString.init(input) — no UTF-8 mark on the static path.
        Self { tag: Tag::StaticZigString, value: StringImpl { zig: ZigString::init(s.as_ref()) } }
    }
    /// Alias of `static_` for callers that spell it `static_str`.
    #[inline]
    pub fn static_str<S: ?Sized + AsRef<[u8]>>(s: &'static S) -> Self {
        Self::static_(s)
    }

    /// `bun.String.cloneUTF8` — copies `s` into a fresh WTF::StringImpl
    /// (refcount = 1). Caller must `deref()` or transfer ownership.
    pub fn clone_utf8(s: &[u8]) -> Self {
        if s.is_empty() { return Self::EMPTY; }
        // BunString__fromBytes auto-detects all-ASCII → Latin1, else UTF-8.
        // SAFETY: s.as_ptr()/len describe a valid byte slice.
        unsafe { BunString__fromBytes(s.as_ptr(), s.len()) }
    }
    pub fn clone_latin1(s: &[u8]) -> Self {
        if s.is_empty() { return Self::EMPTY; }
        unsafe { BunString__fromLatin1(s.as_ptr(), s.len()) }
    }
    /// `bun.String.cloneUTF16` — narrows to Latin-1 if all-ASCII (string.zig:207).
    pub fn clone_utf16(s: &[u16]) -> Self {
        if s.is_empty() { return Self::EMPTY; }
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
        unsafe { BunString__createAtom(s.as_ptr(), s.len()) }
    }
    /// `bun.String.tryCreateAtom` — `None` if `bytes` is non-ASCII or too long
    /// to atomize (string.zig:270).
    pub fn try_create_atom(bytes: &[u8]) -> Option<Self> {
        // SAFETY: bytes describes a valid slice.
        let atom = unsafe { BunString__tryCreateAtom(bytes.as_ptr(), bytes.len()) };
        if atom.tag == Tag::Dead { None } else { Some(atom) }
    }
    /// `bun.String.createAtomIfPossible` — atomized strings are interned in a
    /// thread-local table; falls back to a regular WTF copy if atomization
    /// fails. Cannot be used cross-thread (string.zig:278).
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
    /// borrowed (not copied). If `bytes.len() >= max_length()`, `callback` is
    /// invoked immediately and a `dead` string is returned (string.zig:404).
    ///
    /// `Ctx` must be a pointer-sized type (raw pointer or `&T`); enforced by
    /// the const-assert below to keep the C-ABI transmute sound.
    pub fn create_external<Ctx>(
        bytes: &[u8],
        is_latin1: bool,
        ctx: Ctx,
        callback: ExternalStringImplFreeFunction<Ctx>,
    ) -> Self {
        use core::ffi::c_void;
        // PORT NOTE: Zig asserted `@typeInfo(Ctx) == .pointer` at comptime.
        struct AssertPtrSized<C>(core::marker::PhantomData<C>);
        impl<C> AssertPtrSized<C> {
            const OK: () = assert!(core::mem::size_of::<C>() == core::mem::size_of::<*mut c_void>());
        }
        let () = AssertPtrSized::<Ctx>::OK;
        debug_assert!(!bytes.is_empty());
        if bytes.len() >= Self::max_length() {
            callback(ctx, bytes.as_ptr() as *mut c_void, bytes.len() as u32);
            return Self::DEAD;
        }
        // SAFETY: Ctx is pointer-sized (asserted); the C ABI for the callback
        // is identical with Ctx erased to *mut c_void.
        let ctx_erased: *mut c_void = unsafe { core::mem::transmute_copy(&ctx) };
        // PORT NOTE: Zig asserted `@typeInfo(Ctx) == .pointer` (raw pointer, no
        // destructor). The Rust const-assert only checks size, so an owning
        // pointer-sized `Ctx` (e.g. `Box<T>`) would otherwise be dropped here
        // and later double-freed by the WTF finalizer. Ownership transfers to
        // the external string; suppress the local drop.
        core::mem::forget(ctx);
        let cb_erased: Option<extern "C" fn(*mut c_void, *mut c_void, u32)> =
            // SAFETY: same ABI; first param erased per the const-assert above.
            Some(unsafe { core::mem::transmute::<
                ExternalStringImplFreeFunction<Ctx>,
                extern "C" fn(*mut c_void, *mut c_void, u32),
            >(callback) });
        // SAFETY: bytes describes a valid slice; len < max_length checked.
        let s = unsafe {
            BunString__createExternal(bytes.as_ptr(), bytes.len(), is_latin1, ctx_erased, cb_erased)
        };
        debug_assert!(
            s.tag != Tag::WTFStringImpl || unsafe { (*s.value.wtf).ref_count() } == 1
        );
        s
    }

    /// Max `WTF::StringImpl` length (in characters, not bytes).
    /// Hooked by `bun_runtime` (`STRING_ALLOCATION_LIMIT_HOOK`); falls back to
    /// `i32::MAX` until the runtime installs the limit.
    #[inline]
    pub fn max_length() -> usize {
        let p = STRING_ALLOCATION_LIMIT_HOOK.load(Ordering::Relaxed);
        if p.is_null() {
            i32::MAX as usize
        } else {
            // SAFETY: runtime stores a `fn() -> usize` here during init.
            let f: fn() -> usize = unsafe { core::mem::transmute::<*mut (), fn() -> usize>(p) };
            f()
        }
    }

    /// `bun.String.createStaticExternal` — wraps `bytes` in a
    /// `WTF::ExternalStringImpl` that will **never** be freed. Only use for
    /// dynamically-allocated data with process lifetime (string.zig:427).
    pub fn create_static_external(bytes: &[u8], is_latin1: bool) -> Self {
        debug_assert!(!bytes.is_empty());
        // SAFETY: bytes describes a valid slice; C++ side stores ptr/len
        // without copying and never frees it.
        unsafe { BunString__createStaticExternal(bytes.as_ptr(), bytes.len(), is_latin1) }
    }
    /// `bun.String.createFormat` — formats `args` into a temporary buffer and
    /// copies the result into a fresh WTF-backed string. Port collapses Zig's
    /// `(comptime fmt, args: anytype)` into [`core::fmt::Arguments`].
    pub fn create_format(args: core::fmt::Arguments<'_>) -> Self {
        use core::fmt::Write;
        // PORT NOTE: Zig used a 512-byte stackFallback. SmallVec<512> would be
        // ideal; for B-2 a heap buffer is acceptable (cold path, error msgs).
        if let Some(s) = args.as_str() {
            return Self::clone_utf8(s.as_bytes());
        }
        let mut buf = std::string::String::with_capacity(128);
        let _ = buf.write_fmt(args);
        Self::clone_utf8(buf.as_bytes())
    }
    /// Returns `(String, ptr)` where `ptr` is `len` writable bytes — or
    /// `(dead, null)` if WTF allocation failed (string.zig:128 checks
    /// `tag == .Dead` before using the buffer).
    pub fn create_uninitialized_latin1(len: usize) -> (Self, &'static mut [u8]) {
        let s = unsafe { BunString__fromLatin1Unitialized(len) };
        if s.tag != Tag::WTFStringImpl {
            return (s, &mut []);
        }
        debug_assert_eq!(unsafe { (*s.value.wtf).ref_count() }, 1);
        // SAFETY: WTF tag verified above; impl has a writable latin1 buffer of `len`.
        let ptr = unsafe { (*s.value.wtf).m_ptr.latin1 as *mut u8 };
        // SAFETY: `ptr` points at `len` writable bytes owned by the new WTF
        // impl; the `'static` lifetime mirrors Zig's `[]u8` return (lifetime
        // is actually tied to `s` — caller must not outlive it).
        (s, unsafe { core::slice::from_raw_parts_mut(ptr, len) })
    }
    pub fn create_uninitialized_utf16(len: usize) -> (Self, &'static mut [u16]) {
        let s = unsafe { BunString__fromUTF16Unitialized(len) };
        if s.tag != Tag::WTFStringImpl {
            return (s, &mut []);
        }
        debug_assert_eq!(unsafe { (*s.value.wtf).ref_count() }, 1);
        let ptr = unsafe { (*s.value.wtf).m_ptr.utf16 as *mut u16 };
        // SAFETY: see `create_uninitialized_latin1`.
        (s, unsafe { core::slice::from_raw_parts_mut(ptr, len) })
    }

    /// `bun.String.createExternalGloballyAllocated(.latin1, bytes)` — takes
    /// ownership of a globally-allocated (mimalloc-backed) Latin-1 buffer and
    /// wraps it in a WTF::ExternalStringImpl. On allocation failure, frees the
    /// bytes and returns `String::DEAD`.
    pub fn create_external_globally_allocated_latin1(bytes: Vec<u8>) -> Self {
        if bytes.is_empty() {
            return Self::EMPTY;
        }
        if bytes.len() >= Self::max_length() {
            return Self::DEAD;
        }
        let mut bytes = core::mem::ManuallyDrop::new(bytes.into_boxed_slice());
        // SAFETY: ownership transferred to WTF::ExternalStringImpl, which frees
        // via mimalloc (the global allocator).
        unsafe { BunString__createExternalGloballyAllocatedLatin1(bytes.as_mut_ptr(), bytes.len()) }
    }

    /// `bun.String.createExternalGloballyAllocated(.utf16, bytes)`.
    pub fn create_external_globally_allocated_utf16(bytes: Vec<u16>) -> Self {
        if bytes.is_empty() {
            return Self::EMPTY;
        }
        if bytes.len() >= Self::max_length() {
            return Self::DEAD;
        }
        let mut bytes = core::mem::ManuallyDrop::new(bytes.into_boxed_slice());
        // SAFETY: see `create_external_globally_allocated_latin1`.
        unsafe { BunString__createExternalGloballyAllocatedUTF16(bytes.as_mut_ptr(), bytes.len()) }
    }

    /// `bun.String.createFromOSPath` — clone an OS-native path slice into a
    /// WTF-backed string (UTF-8 on POSIX, UTF-16 on Windows).
    pub fn create_from_os_path(os_path: &bun_paths::OSPathSlice) -> Self {
        #[cfg(not(windows))]
        { Self::clone_utf8(os_path) }
        #[cfg(windows)]
        { Self::clone_utf16(os_path) }
    }
    /// Convert in place to a WTF-backed string (consuming the borrow).
    pub fn to_wtf_string(&mut self) {
        unsafe { BunString__toWTFString(self) }
    }
    /// Zig: `bun.String.init(WTFStringImpl)` / `WTFString.adopt` — wrap a raw
    /// `*mut WTFStringImplStruct`, **adopting** the existing +1 ref (no inc).
    /// Inverse of [`leak_wtf_impl`]. Null → `String::EMPTY`.
    #[inline]
    pub fn adopt_wtf_impl(wtf: WTFStringImpl) -> Self {
        if wtf.is_null() {
            return Self::EMPTY;
        }
        Self { tag: Tag::WTFStringImpl, value: StringImpl { wtf } }
    }
    /// Zig: `bun.String{...}.value.WTFStringImpl` — extract the raw `*mut WTFStringImplStruct`
    /// from a WTF-backed string, transferring ownership of the +1 ref to the caller. Returns
    /// null for non-WTF tags. Used by SQL data-cell paths that hand the impl pointer to C++.
    #[inline]
    pub fn leak_wtf_impl(self) -> WTFStringImpl {
        if self.tag == Tag::WTFStringImpl {
            // SAFETY: tag == WTFStringImpl guarantees `value.wtf` is the active union field.
            unsafe { self.value.wtf }
        } else {
            core::ptr::null_mut()
        }
    }
    pub fn to_thread_safe(&mut self) {
        if self.tag == Tag::WTFStringImpl {
            unsafe { BunString__toThreadSafe(self) }
        }
    }
    pub fn to_int32(&self) -> Option<i32> {
        let v = unsafe { BunString__toInt32(self) };
        if v > i32::MAX as i64 { None } else { Some(v as i32) }
    }

    /// `String.ref()` — increment WTF refcount; no-op for other tags.
    #[inline]
    pub fn ref_(&self) {
        if self.tag == Tag::WTFStringImpl {
            // SAFETY: WTF tag guarantees value.wtf is a valid live impl.
            unsafe { (*self.value.wtf).r#ref() }
        }
    }
    /// `String.deref()` — decrement WTF refcount; no-op for other tags.
    #[inline]
    pub fn deref(&self) {
        if self.tag == Tag::WTFStringImpl {
            unsafe { (*self.value.wtf).deref() }
        }
    }
    /// `String.dupeRef()` — copy + ref.
    #[inline]
    pub fn dupe_ref(&self) -> Self {
        self.ref_();
        *self
    }

    #[inline]
    pub fn length(&self) -> usize {
        match self.tag {
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).length() as usize },
            Tag::ZigString | Tag::StaticZigString => unsafe { self.value.zig.len },
            Tag::Dead | Tag::Empty => 0,
        }
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.tag == Tag::Empty || self.length() == 0
    }
    pub fn is_utf16(&self) -> bool {
        match self.tag {
            Tag::WTFStringImpl => unsafe { !(*self.value.wtf).is_8bit() },
            Tag::ZigString | Tag::StaticZigString => unsafe { self.value.zig.is_16bit() },
            _ => false,
        }
    }
    pub fn is_utf8(&self) -> bool {
        matches!(self.tag, Tag::ZigString | Tag::StaticZigString)
            && unsafe { self.value.zig.is_utf8() }
    }
    pub fn is_8bit(&self) -> bool {
        match self.tag {
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).is_8bit() },
            Tag::ZigString => unsafe { !self.value.zig.is_16bit() },
            _ => true,
        }
    }
    /// Raw byte view (Latin-1 or UTF-16 bytes — NOT necessarily UTF-8).
    pub fn byte_slice(&self) -> &[u8] {
        match self.tag {
            Tag::ZigString | Tag::StaticZigString => unsafe { self.value.zig.byte_slice() },
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).byte_slice() },
            _ => &[],
        }
    }
    /// Latin-1 byte view; debug-asserts `is_8bit()`.
    pub fn latin1(&self) -> &[u8] {
        debug_assert!(self.is_8bit());
        match self.tag {
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).latin1_slice() },
            Tag::ZigString | Tag::StaticZigString => unsafe { self.value.zig.slice() },
            _ => &[],
        }
    }
    pub fn utf16(&self) -> &[u16] {
        debug_assert!(self.is_utf16());
        match self.tag {
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).utf16_slice() },
            Tag::ZigString | Tag::StaticZigString => unsafe { self.value.zig.utf16_slice() },
            _ => &[],
        }
    }
    pub fn ensure_hash(&self) {
        if self.tag == Tag::WTFStringImpl {
            unsafe { (*self.value.wtf).ensure_hash() }
        }
    }

    /// `bun.String.trunc` (string.zig:317) — clamp to `len` code units. The
    /// returned `String` borrows the same storage; for `WTFStringImpl` this
    /// downgrades to a `ZigString` view (no ref taken), so the original must
    /// outlive the result.
    pub fn trunc(&self, len: usize) -> String {
        if self.length() <= len {
            // PORT NOTE: Zig returns `this` by value with no refcount bump;
            // `String` is `Copy` here (POD #[repr(C)]), so a plain copy
            // matches the Zig pass-by-value semantics.
            return *self;
        }
        String::init(self.to_zig_string().trunc(len))
    }

    /// `bun.String.substring` (string.zig:669) — borrowed slice from `start_index`
    /// to end. The returned `String` borrows the same underlying storage; for
    /// `WTFStringImpl` this downgrades to a `ZigString` view (no ref taken), so
    /// the original must outlive the result.
    pub fn substring(&self, start_index: usize) -> String {
        let len = self.length();
        self.substring_with_len(start_index.min(len), len)
    }

    /// `bun.String.substringWithLen` (string.zig:674).
    pub fn substring_with_len(&self, start_index: usize, end_index: usize) -> String {
        match self.tag {
            Tag::ZigString | Tag::StaticZigString => String::init(
                unsafe { self.value.zig }.substring_with_len(start_index, end_index),
            ),
            Tag::WTFStringImpl => unsafe {
                let w = &*self.value.wtf;
                if w.is_8bit() {
                    String::init(ZigString::init(&w.latin1_slice()[start_index..end_index]))
                } else {
                    String::init(ZigString::init_utf16(&w.utf16_slice()[start_index..end_index]))
                }
            },
            _ => *self,
        }
    }

    /// `String.toUTF8` — borrowed-or-owned UTF-8 byte slice.
    /// - `WTFStringImpl`: refs the impl (Latin-1, all-ASCII) or transcodes (Latin-1/UTF-16 → owned).
    /// - `ZigString`: borrows (UTF-8) or transcodes (UTF-16/non-ASCII Latin-1).
    /// - `StaticZigString`: borrows always.
    pub fn to_utf8(&self) -> ZigStringSlice {
        match self.tag {
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).to_utf8() },
            Tag::ZigString => unsafe { self.value.zig.to_slice() },
            Tag::StaticZigString => {
                ZigStringSlice::from_utf8_never_free(unsafe { self.value.zig.slice() })
            }
            _ => ZigStringSlice::EMPTY,
        }
    }
    pub fn to_utf8_without_ref(&self) -> ZigStringSlice {
        match self.tag {
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).to_utf8_without_ref() },
            Tag::ZigString => unsafe { self.value.zig.to_slice() },
            Tag::StaticZigString => {
                ZigStringSlice::from_utf8_never_free(unsafe { self.value.zig.slice() })
            }
            _ => ZigStringSlice::EMPTY,
        }
    }
    /// Returns `Some(utf8_bytes)` only if this is already valid UTF-8 with no
    /// transcoding needed (string.zig:571 `asUTF8`).
    pub fn as_utf8(&self) -> Option<&[u8]> {
        match self.tag {
            Tag::WTFStringImpl => unsafe {
                let w = &*self.value.wtf;
                if w.is_8bit() && strings::is_all_ascii(w.latin1_slice()) {
                    Some(w.latin1_slice())
                } else { None }
            },
            Tag::ZigString | Tag::StaticZigString => {
                // SAFETY: tag guarantees `value.zig` is the active variant.
                let z = unsafe { &self.value.zig };
                if z.is_16bit() { return None; }
                if z.is_utf8() { return Some(z.slice()); }
                if strings::is_all_ascii(z.slice()) { return Some(z.slice()); }
                None
            }
            _ => Some(b""),
        }
    }
    pub fn to_owned_slice(&self) -> Vec<u8> {
        self.to_utf8().into_vec()
    }

    pub fn eql_utf8(&self, other: &[u8]) -> bool {
        // PORT NOTE: no `as_utf8()` fast-path here — for a 16-bit ZigString,
        // `as_utf8()` would call `slice()` (which debug-asserts !is_16bit) and
        // `is_all_ascii` on the wrong byte view. Match Zig's `eqlUTF8` and go
        // straight through encoding-aware `to_utf8_without_ref`.
        self.to_utf8_without_ref().slice() == other
    }
    pub fn eql_comptime<S: ?Sized + AsRef<[u8]>>(&self, lit: &S) -> bool { self.eql_utf8(lit.as_ref()) }

    /// Port of `bun.String.hasPrefixComptime` (string.zig). ASCII-only prefix
    /// check that avoids materialising the whole UTF-8 view when the
    /// underlying encoding is 8-bit; falls back to `to_utf8_without_ref` for
    /// 16-bit / WTF-backed strings.
    pub fn has_prefix_comptime(&self, prefix: &'static [u8]) -> bool {
        if let Some(bytes) = self.as_utf8() {
            return strings::has_prefix_comptime(bytes, prefix);
        }
        strings::has_prefix_comptime(self.to_utf8_without_ref().slice(), prefix)
    }

    #[inline] pub fn is_dead(&self) -> bool { self.tag == Tag::Dead }

    /// `bun.String.static` (alt. spelling for callers that prefer `from_*`).
    #[inline]
    pub fn from_static(s: &'static [u8]) -> Self { Self::static_(s) }

    /// `bun.String.fromBytes` — borrow `value` without copying or refcounting;
    /// auto-tags UTF-8 if `value` contains any non-ASCII byte (string.zig:504).
    #[inline]
    pub fn from_bytes(value: &[u8]) -> Self {
        Self::init(ZigString::from_bytes(value))
    }

    /// `bun.String.clone` — produce an owned, WTF-backed copy of `self`.
    /// WTF-backed inputs just bump the refcount; ZigString inputs are copied
    /// into a fresh WTF::StringImpl (string.zig:244).
    pub fn clone(&self) -> Self {
        if self.tag == Tag::WTFStringImpl {
            return self.dupe_ref();
        }
        if self.is_empty() {
            return Self::EMPTY;
        }
        if self.is_utf16() {
            let len = self.length();
            let (new, chars) = Self::create_uninitialized_utf16(len);
            if new.tag != Tag::Dead {
                // SAFETY: tag ≠ WTFStringImpl is excluded above so
                // `value.zig` is the active variant.
                chars.copy_from_slice(unsafe { self.value.zig.utf16_slice() });
            }
            return new;
        }
        Self::clone_utf8(self.byte_slice())
    }

    /// `bun.String.toZigString` — borrow as a `ZigString` (no ref taken).
    pub fn to_zig_string(&self) -> ZigString {
        match self.tag {
            Tag::ZigString | Tag::StaticZigString => unsafe { self.value.zig },
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).to_zig_string() },
            _ => ZigString::EMPTY,
        }
    }

    /// `bun.String.eql` — encoding-aware equality (string.zig:1014).
    pub fn eql(&self, other: &Self) -> bool {
        self.to_zig_string().eql(other.to_zig_string())
    }

    /// `bun.String.utf8ByteLength` — exact number of UTF-8 bytes needed to
    /// encode `self` (string.zig:292).
    pub fn utf8_byte_length(&self) -> usize {
        match self.tag {
            Tag::WTFStringImpl => unsafe { (*self.value.wtf).utf8_byte_length() },
            Tag::ZigString | Tag::StaticZigString => unsafe { self.value.zig.utf8_byte_length() },
            Tag::Dead | Tag::Empty => 0,
        }
    }

    /// `bun.String.toOwnedSliceZ` — allocate a NUL-terminated UTF-8 copy.
    pub fn to_owned_slice_z(&self) -> bun_core::ZBox {
        self.to_zig_string().to_owned_slice_z()
    }

    /// `bun.String.encodeInto` — encode `self` into `out` using a Node.js
    /// Buffer encoding (string.zig:630). Dispatches to
    /// `jsc.WebCore.encoding.encodeIntoFrom{8,16}` via [`webcore_encoding`]
    /// hooks (tier-6 owns the bodies; per PORTING.md §Dispatch hook pattern).
    ///
    /// Returns bytes written. The Zig version is `comptime enc`-monomorphized;
    /// PERF(port): demoted to runtime `enc` — profile in Phase B.
    pub fn encode_into(
        &self,
        out: &mut [u8],
        enc: encoding::Encoding,
    ) -> Result<usize, bun_core::Error> {
        if self.is_utf16() {
            return Ok(webcore_encoding::encode_into_from16(self.utf16(), out, enc, true));
        }
        if self.is_utf8() {
            // TODO(port): Zig: `@panic("TODO")` — UTF-8 source path was never
            // implemented (string.zig:636). Match the Zig behaviour.
            unreachable!("String.encodeInto from UTF-8 source — unimplemented in Zig");
        }
        Ok(webcore_encoding::encode_into_from8(self.latin1(), out, enc))
    }

    /// `bun.String.visibleWidth` — terminal column width of `self`, including
    /// ANSI escape sequences as visible (string.zig). Dispatches on encoding
    /// to [`strings::visible::width`].
    pub fn visible_width(&self, ambiguous_as_wide: bool) -> usize {
        use crate::strings::visible::width as w;
        if self.is_utf16() {
            return w::utf16(self.utf16(), ambiguous_as_wide);
        }
        if self.is_utf8() {
            // SAFETY: tag is ZigString/StaticZigString and 8-bit; `slice()` is
            // the UTF-8 byte view.
            return w::utf8(unsafe { self.value.zig.slice() });
        }
        w::latin1(self.latin1())
    }

    /// `bun.String.visibleWidthExcludeANSIColors` — terminal column width of
    /// `self`, treating ANSI escape sequences as zero-width (string.zig).
    /// Dispatches on encoding to [`strings::visible::width::exclude_ansi_colors`].
    pub fn visible_width_exclude_ansi_colors(&self, ambiguous_as_wide: bool) -> usize {
        use crate::strings::visible::width::exclude_ansi_colors as w;
        if self.is_utf16() {
            return w::utf16(self.utf16(), ambiguous_as_wide);
        }
        if self.is_utf8() {
            // SAFETY: tag is ZigString/StaticZigString and 8-bit; `slice()` is
            // the UTF-8 byte view.
            return w::utf8(unsafe { self.value.zig.slice() });
        }
        w::latin1(self.latin1())
    }

    // `to_js` / `transfer_to_js` / `create_utf8_for_js` are tier-6 (jsc) — the
    // *_jsc alias pattern: deleted here per PORTING.md, defined as inherent
    // free fns / extension trait in `bun_jsc::string` (would otherwise create
    // a `bun_string ↔ bun_jsc` dependency cycle).
}
// `bun.String.init(anytype)` dispatch table (string.zig:331) — Rust side is
// expressed as `From` impls feeding `String::init<T: Into<Self>>`. The
// `String → String` identity case is covered by the std blanket `From<T> for T`.
impl From<ZigString> for String {
    #[inline]
    fn from(z: ZigString) -> Self {
        Self { tag: Tag::ZigString, value: StringImpl { zig: z } }
    }
}
impl From<&ZigString> for String {
    #[inline]
    fn from(z: &ZigString) -> Self { Self::from(*z) }
}
impl From<&[u8]> for String {
    /// `[]const u8` arm — `ZigString.fromBytes` (auto-marks UTF-8 if non-ASCII).
    #[inline]
    fn from(s: &[u8]) -> Self { Self::from(ZigString::from_bytes(s)) }
}
impl<const N: usize> From<&'static [u8; N]> for String {
    /// `*const [N:0]u8` arm — Zig string literal (string.zig:340-350): empty
    /// → `Tag::Empty`, otherwise `String.static(value)` → `Tag::StaticZigString`.
    /// Restricted to `&'static` so the static-tag invariant holds.
    #[inline]
    fn from(s: &'static [u8; N]) -> Self {
        if N == 0 { Self::EMPTY } else { Self::static_(s) }
    }
}
impl From<&str> for String {
    #[inline]
    fn from(s: &str) -> Self { Self::from(ZigString::from_bytes(s.as_bytes())) }
}
impl From<&[u16]> for String {
    /// `[]const u16` arm — `ZigString.from16Slice` (sets UTF-16 + global bits).
    #[inline]
    fn from(s: &[u16]) -> Self { Self::from(ZigString::from16_slice(s)) }
}
/// `WTFStringImpl` arm of `bun.String.init` (string.zig:331) — wrap an existing
/// `*WTFStringImplStruct` without touching its refcount.
impl From<WTFStringImpl> for String {
    #[inline]
    fn from(wtf: WTFStringImpl) -> Self {
        debug_assert!(!wtf.is_null());
        Self { tag: Tag::WTFStringImpl, value: StringImpl { wtf } }
    }
}

impl bun_core::OptionsEnvArg for String {
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
    #[inline] fn default() -> Self { Self::EMPTY }
}
// `String` is just a tag + raw ptr; thread-safety of the underlying WTF impl
// is gated by `to_thread_safe()` at the call site (matches Zig).
unsafe impl Send for String {}
unsafe impl Sync for String {}

// ──────────────────────────────────────────────────────────────────────────
// `OwnedString` — RAII `defer s.deref()`.
//
// `String` is intentionally `#[derive(Copy)]` so it stays bit-identical to the
// C++ `BunString` for FFI by-value passing (matching Zig's value-type
// `bun.String`). That precludes `impl Drop for String`. Instead, sites that
// receive a +1 ref (any `clone*`/`create*`/`to_bun_string` constructor) wrap
// it in `OwnedString` to get scope-exit `deref()` — the Rust spelling of Zig's
// pervasive `defer s.deref()`.
//
// Prefer this over ad-hoc `scopeguard::guard(s, |s| s.deref())` so the
// pattern is greppable and `?`-early-returns can't skip the release.
// ──────────────────────────────────────────────────────────────────────────
#[repr(transparent)]
pub struct OwnedString(String);

impl OwnedString {
    #[inline]
    pub const fn new(s: String) -> Self {
        Self(s)
    }
    /// Disarm: return the inner `String` without `deref()`ing it (transfers
    /// the +1 to the caller — Zig's "no defer, returned by value").
    #[inline]
    pub fn into_inner(self) -> String {
        let s = self.0;
        core::mem::forget(self);
        s
    }
    /// Borrow the inner `String` by value (it's `Copy`) without bumping the
    /// refcount. Do NOT `deref()` the result.
    #[inline]
    pub fn get(&self) -> String {
        self.0
    }
}
impl core::ops::Deref for OwnedString {
    type Target = String;
    #[inline]
    fn deref(&self) -> &String {
        &self.0
    }
}
impl core::ops::DerefMut for OwnedString {
    #[inline]
    fn deref_mut(&mut self) -> &mut String {
        &mut self.0
    }
}
impl Drop for OwnedString {
    #[inline]
    fn drop(&mut self) {
        self.0.deref();
    }
}
impl From<String> for OwnedString {
    #[inline]
    fn from(s: String) -> Self {
        Self(s)
    }
}
impl core::fmt::Display for OwnedString {
    #[inline]
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        core::fmt::Display::fmt(&self.0, f)
    }
}

impl core::fmt::Display for String {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let s = self.to_utf8_without_ref();
        f.write_str(unsafe { core::str::from_utf8_unchecked(s.slice()) })
    }
}

impl core::fmt::Display for ZigString {
    // ZigString.zig `format()` — encoding-aware `{f}` formatter.
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if self.is_utf8() {
            return write!(f, "{}", bstr::BStr::new(self.slice()));
        }
        if self.is_16bit() {
            return bun_core::fmt::format_utf16_type(self.utf16_slice_aligned(), f);
        }
        bun_core::fmt::format_latin1(self.slice(), f)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `ZigString` — `{ ptr: *const u8, len: usize }` with flag bits in the
// POINTER's high bits (NOT len): bit 63 = is16Bit, 62 = isGloballyAllocated,
// 61 = isUTF8. `untagged()` truncates to 53 bits (matches ZigString.zig:629).
// ──────────────────────────────────────────────────────────────────────────
#[repr(C)]
#[derive(Clone, Copy)]
pub struct ZigString {
    ptr: *const u8,
    pub len: usize,
}
const ZS_UTF8_BIT: usize = 1usize << 61;
const ZS_GLOBAL_BIT: usize = 1usize << 62;
const ZS_16BIT_BIT: usize = 1usize << 63;
const ZS_UNTAG_MASK: usize = (1usize << 53) - 1;

impl Default for ZigString {
    #[inline]
    fn default() -> Self { Self::EMPTY }
}

impl ZigString {
    pub const EMPTY: Self = Self { ptr: b"".as_ptr(), len: 0 };

    #[inline]
    pub const fn is_empty(&self) -> bool { self.len == 0 }

    #[inline]
    pub const fn init(s: &[u8]) -> Self {
        Self { ptr: s.as_ptr(), len: s.len() }
    }
    /// `ZigString.init` for `'static` literals — alias for callers spelling it
    /// `init_static` (matches Zig `ZigString.init` with comptime-known string).
    #[inline]
    pub const fn init_static(s: &'static [u8]) -> Self {
        Self { ptr: s.as_ptr(), len: s.len() }
    }
    /// `ZigString.fromUTF8` — alias of [`init_utf8`].
    #[inline]
    pub fn from_utf8(s: &[u8]) -> Self { Self::init_utf8(s) }
    /// `ZigString.dupeForJS` — duplicates `utf8` into a globally-allocated
    /// buffer suitable for handing to JSC. Widens to UTF-16 if `utf8` contains
    /// any non-ASCII byte; otherwise leaves as 8-bit. Marks the result global
    /// so JSC frees it via mimalloc.
    pub fn dupe_for_js(utf8: &[u8]) -> Result<ZigString, strings::ToUTF16Error> {
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
    /// `ZigString.initUTF8` — borrow UTF-8 bytes (sets the UTF-8 ptr-tag).
    #[inline]
    pub fn init_utf8(s: &[u8]) -> Self {
        let mut z = Self::init(s);
        z.mark_utf8();
        z
    }
    /// `ZigString.initUTF16` — borrow UTF-16 code units (sets the 16-bit ptr-tag).
    #[inline]
    pub fn init_utf16(s: &[u16]) -> Self {
        let mut z = Self { ptr: s.as_ptr().cast(), len: s.len() };
        z.mark_utf16();
        z
    }

    /// `ZigString.from16Slice` — wraps a globally-allocated UTF-16 buffer
    /// (sets both the 16-bit and global ptr-tags). ZigString.zig:533.
    #[inline]
    pub fn from16_slice(slice: &[u16]) -> Self {
        Self::from16(slice.as_ptr(), slice.len())
    }

    /// `ZigString.from16` — globally-allocated memory only (ZigString.zig:547).
    /// Marks UTF-16 + global; caller must ensure the buffer was allocated by
    /// `bun.default_allocator` (mimalloc) since `deinitGlobal` will free it.
    #[inline]
    pub fn from16(ptr: *const u16, len: usize) -> Self {
        let mut z = Self { ptr: ptr.cast(), len };
        z.mark_utf16();
        z.mark_global();
        z
    }

    #[inline] pub fn is_utf8(self) -> bool { (self.ptr as usize & ZS_UTF8_BIT) != 0 }
    #[inline] pub fn is_16bit(self) -> bool { (self.ptr as usize & ZS_16BIT_BIT) != 0 }
    /// Alias of [`is_16bit`] (Zig spelled it `is16Bit`; per PORTING.md acronym
    /// rule that becomes `is_16_bit`).
    #[inline] pub fn is_16_bit(self) -> bool { self.is_16bit() }
    #[inline] pub fn is_globally_allocated(self) -> bool { (self.ptr as usize & ZS_GLOBAL_BIT) != 0 }
    #[inline] pub fn mark_utf8(&mut self) { self.ptr = (self.ptr as usize | ZS_UTF8_BIT) as *const u8; }
    #[inline] pub fn mark_utf16(&mut self) { self.ptr = (self.ptr as usize | ZS_16BIT_BIT) as *const u8; }
    #[inline] pub fn mark_global(&mut self) { self.ptr = (self.ptr as usize | ZS_GLOBAL_BIT) as *const u8; }

    /// `ZigString.fromBytes` — borrow `slice`; if it contains any non-ASCII
    /// byte, sets the UTF-8 ptr-tag (ZigString.zig:14).
    #[inline]
    pub fn from_bytes(slice: &[u8]) -> Self {
        if !strings::is_all_ascii(slice) {
            Self::init_utf8(slice)
        } else {
            Self::init(slice)
        }
    }

    /// `ZigString.static` — wraps a `'static` ASCII literal. Zig returned a
    /// `*const ZigString` to a comptime-interned holder; Rust callers consume
    /// the value directly (ZigString is `Copy`), so we return by value.
    /// Generic over `str`/`[u8]` so either `"lit"` or `b"lit"` is accepted.
    #[inline]
    pub fn static_<S: ?Sized + AsRef<[u8]>>(slice: &'static S) -> Self {
        let bytes = slice.as_ref();
        Self { ptr: bytes.as_ptr(), len: bytes.len() }
    }
    /// Alias of `static_` for callers that spell it `static_str`.
    #[inline]
    pub fn static_str<S: ?Sized + AsRef<[u8]>>(slice: &'static S) -> Self { Self::static_(slice) }

    /// `ZigString.utf8ByteLength` — exact UTF-8 byte length needed to encode
    /// this string (ZigString.zig:221). UTF-16 → simdutf length; Latin-1
    /// → simdutf utf8-from-latin1 length; UTF-8 → `len`.
    pub fn utf8_byte_length(self) -> usize {
        if self.is_utf8() {
            return self.len;
        }
        if self.is_16bit() {
            return bun_core::strings::element_length_utf16_into_utf8(self.utf16_slice());
        }
        // Latin-1 path (ZigString.zig delegates to encoding.byteLengthU8(.utf8),
        // which is `simdutf.length.utf8.from.latin1` for the latin1 case).
        let s = self.slice();
        // SAFETY: s describes a valid byte slice.
        unsafe { bun_simdutf_sys::simdutf::simdutf__utf8_length_from_latin1(s.as_ptr(), s.len()) }
    }

    /// `ZigString.toOwnedSliceZ` — allocate a NUL-terminated UTF-8 copy.
    pub fn to_owned_slice_z(self) -> bun_core::ZBox {
        if self.is_utf8() {
            let mut v = self.slice().to_vec();
            v.push(0);
            return bun_core::ZBox::from_vec_with_nul(v);
        }
        let mut list = if self.is_16bit() {
            bun_core::strings::to_utf8_alloc(self.utf16_slice())
        } else {
            bun_core::strings::allocate_latin1_into_utf8_with_list(Vec::new(), 0, self.slice())
        };
        list.push(0);
        bun_core::ZBox::from_vec_with_nul(list)
    }

    /// `ZigString.charAt` — first/nth code unit, widened to `u16` regardless
    /// of encoding (ZigString.zig:615). Caller must ensure `i < self.len`.
    #[inline]
    pub fn char_at(self, i: usize) -> u16 {
        debug_assert!(i < self.len);
        if self.is_16bit() {
            self.utf16_slice()[i]
        } else {
            self.slice()[i] as u16
        }
    }

    /// `ZigString.eqlComptime` — encoding-aware equality against a `'static`
    /// ASCII literal (ZigString.zig:272). UTF-16 inputs go through the
    /// per-unit `eql_comptime_utf16` path; 8-bit inputs compare bytes
    /// directly. The Zig version `@compileError`s on non-ASCII `other`; in
    /// Rust we cannot enforce that at compile time, so it falls through to
    /// the byte compare (caller is expected to pass ASCII).
    pub fn eql_comptime<S: ?Sized + AsRef<[u8]>>(self, other: &S) -> bool {
        let other = other.as_ref();
        if self.is_16bit() {
            return strings::eql_comptime_utf16(self.utf16_slice(), other);
        }
        // PORT NOTE: Zig branched on `comptime strings.isAllASCII(other)`;
        // demoted to runtime length-check + byte compare.
        if self.len != other.len() {
            return false;
        }
        strings::eql_comptime_ignore_len(self.slice(), other)
    }

    /// `ZigString.eql` — encoding-aware equality (ZigString.zig).
    pub fn eql(self, other: Self) -> bool {
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
        // Mixed encoding — go through the UTF-8 view (matches Zig's slow path).
        self.to_slice().slice() == other.to_slice().slice()
    }

    #[inline]
    pub fn untagged(ptr: *const u8) -> *const u8 {
        // Zig: @truncate(u53, @intFromPtr(ptr)) — strips top 11 bits.
        (ptr as usize & ZS_UNTAG_MASK) as *const u8
    }

    /// 8-bit byte slice (asserts !is16Bit in debug — matches Zig `slice()`).
    pub fn slice(&self) -> &[u8] {
        if self.len == 0 { return &[]; }
        // ZigString.zig:637 — only panics when `len > 0 and is16Bit()`.
        debug_assert!(!self.is_16bit(), "ZigString::slice() on UTF-16 string; use to_slice()");
        // Zig caps at u32::MAX (ZigString.zig:642).
        let len = self.len.min(u32::MAX as usize);
        // SAFETY: constructor stored a valid ptr/len; flag bits stripped.
        unsafe { core::slice::from_raw_parts(Self::untagged(self.ptr), len) }
    }
    pub fn utf16_slice(&self) -> &[u16] {
        if self.len == 0 { return &[]; }
        // ZigString.zig:436 — only panics when `len > 0 and !is16Bit()`.
        debug_assert!(self.is_16bit());
        unsafe { core::slice::from_raw_parts(Self::untagged(self.ptr).cast(), self.len) }
    }
    /// `ZigString.utf16SliceAligned` — same as `utf16_slice`; the Zig variant
    /// added an `@alignCast` (ZigString.zig:444). The Rust `.cast::<u16>()`
    /// already requires the caller-established 2-byte alignment, so this is
    /// just a name alias for port-diff parity.
    #[inline]
    pub fn utf16_slice_aligned(&self) -> &[u16] {
        self.utf16_slice()
    }
    /// Raw bytes regardless of encoding (`len * 2` for UTF-16).
    pub fn byte_slice(&self) -> &[u8] {
        if self.len == 0 { return &[]; }
        let bytes = if self.is_16bit() { self.len * 2 } else { self.len };
        unsafe { core::slice::from_raw_parts(Self::untagged(self.ptr), bytes) }
    }
    /// `ZigString.substringWithLen` (ZigString.zig:166) — re-wrap a sub-range
    /// of the underlying storage, preserving the UTF-8/16-bit/global tag bits.
    pub fn substring_with_len(self, start_index: usize, end_index: usize) -> ZigString {
        if self.is_16bit() {
            let mut out = ZigString::init_utf16(&self.utf16_slice()[start_index..end_index]);
            if self.is_globally_allocated() { out.mark_global(); }
            return out;
        }
        let mut out = ZigString::init(&self.slice()[start_index..end_index]);
        if self.is_utf8() { out.mark_utf8(); }
        if self.is_globally_allocated() { out.mark_global(); }
        out
    }
    /// `ZigString.substring` (ZigString.zig:183).
    #[inline]
    pub fn substring(self, start_index: usize) -> ZigString {
        self.substring_with_len(start_index.min(self.len), self.len)
    }
    /// `ZigString.trunc` (ZigString.zig:268) — clamp `len`, preserving the
    /// pointer (and its tag bits) verbatim.
    #[inline]
    pub fn trunc(self, len: usize) -> ZigString {
        ZigString { ptr: self.ptr, len: self.len.min(len) }
    }
    /// `ZigString.toSlice` — borrowed-or-owned UTF-8.
    pub fn to_slice(&self) -> ZigStringSlice {
        if self.len == 0 { return ZigStringSlice::EMPTY; }
        if self.is_16bit() {
            return ZigStringSlice::Owned(bun_core::strings::to_utf8_alloc(self.utf16_slice()));
        }
        let bytes = self.slice();
        if !self.is_utf8() {
            // Non-UTF-8 ZigString = Latin-1; transcode if any byte ≥ 0x80.
            if let Some(v) = bun_core::strings::to_utf8_from_latin1(bytes) {
                return ZigStringSlice::Owned(v);
            }
            // None ⇒ all-ASCII; safe to borrow as-is.
        }
        ZigStringSlice::Static(Self::untagged(self.ptr), self.len)
    }

    /// `ZigString.toOwnedSlice` — allocate a fresh UTF-8 `Vec<u8>` regardless
    /// of the source encoding (ZigString.zig:239). UTF-16 → transcode; UTF-8 →
    /// copy; Latin-1 → transcode (or copy if all-ASCII).
    ///
    /// The returned buffer is NUL-terminated one byte past `len()` (the
    /// terminator is *not* included in `len()`), matching ZigString.zig:243-245
    /// so `sliceZBuf` / C-string consumers can read `as_ptr()` directly.
    pub fn to_owned_slice(&self) -> Vec<u8> {
        // Write a NUL sentinel at `v[len]` without bumping `len` (mirrors
        // ZigString.zig:243-245 / `dupeZ`).
        #[inline]
        fn with_sentinel(mut v: Vec<u8>) -> Vec<u8> {
            v.reserve_exact(1);
            // SAFETY: `reserve_exact(1)` guarantees `cap >= len + 1`; the byte
            // at `len` is inside the allocation.
            unsafe { *v.as_mut_ptr().add(v.len()) = 0; }
            v
        }
        if self.len == 0 { return Vec::new(); }
        // PORT NOTE: order matches ZigString.zig:233-253 — `isUTF8()` is tested
        // before `is16Bit()` so a string with both tags set takes the UTF-8 arm.
        if self.is_utf8() {
            return with_sentinel(self.slice().to_vec());
        }
        if self.is_16bit() {
            return with_sentinel(bun_core::strings::to_utf8_alloc(self.utf16_slice()));
        }
        // Latin-1: transcode non-ASCII, else byte-copy.
        let bytes = self.slice();
        with_sentinel(
            bun_core::strings::to_utf8_from_latin1(bytes).unwrap_or_else(|| bytes.to_vec()),
        )
    }

    /// `ZigString.toSliceClone` — the returned slice is *always* heap-owned
    /// (ZigString.zig:693). Unlike `to_slice`, this never borrows the source
    /// bytes, so the result outlives a GC'd `JSString` that produced `self`.
    ///
    /// PORT NOTE: Zig returned `OOM!Slice`; with mimalloc as the global
    /// allocator OOM aborts the process, so this is infallible.
    pub fn to_slice_clone(&self) -> ZigStringSlice {
        if self.len == 0 { return ZigStringSlice::EMPTY; }
        ZigStringSlice::Owned(self.to_owned_slice())
    }

    /// `ZigString.toSliceZ` — heap-owned UTF-8 with a NUL sentinel one past
    /// the end (`slice().as_ptr()` is a valid C string of length `slice().len()`).
    /// `slice()` itself does *not* include the terminator.
    ///
    /// PORT NOTE: the Zig method this targets was never instantiated (lazy
    /// compilation); JSString/JSValue callers reached for it but no `.zig`
    /// caller forced codegen. Semantics here match `toOwnedSliceZ` wrapped in
    /// a `Slice` so `JSValue::to_slice_z` / `JSString::to_slice_z` get the
    /// `[:0]` guarantee they document.
    pub fn to_slice_z(&self) -> ZigStringSlice {
        if self.len == 0 {
            // Static "" already points at a NUL byte.
            return ZigStringSlice::Static(b"\0".as_ptr(), 0);
        }
        let mut v = self.to_owned_slice();
        v.reserve_exact(1);
        // SAFETY: `reserve_exact(1)` guarantees `cap >= len + 1`; the byte at
        // `len` is inside the allocation. We write the sentinel without
        // bumping `len` so `slice()` excludes it while `as_ptr()` stays
        // NUL-terminated.
        unsafe { *v.as_mut_ptr().add(v.len()) = 0; }
        ZigStringSlice::Owned(v)
    }
}

/// `ZigString.Slice` — a borrowed-or-owned UTF-8 byte slice. Replaces the
/// Zig allocator-vtable trick (`StringImplAllocator` etc.) with explicit ownership.
pub enum ZigStringSlice {
    /// Borrowed; never freed (`fromUTF8NeverFree`).
    Static(*const u8, usize),
    /// Heap-owned; Drop frees via global mimalloc.
    Owned(Vec<u8>),
    /// Backed by a WTFStringImpl ref; Drop derefs it. Stored as raw ptr to
    /// avoid wtf-module cycle; `wtf::to_latin1_slice` constructs this.
    /// `*const` because we only ever hand it back to `Bun__WTFStringImpl__deref`
    /// (which takes `*const`); refcount mutation happens on the C++ side.
    WTF { string_impl: *const wtf::WTFStringImplStruct, ptr: *const u8, len: usize },
}
impl Default for ZigStringSlice {
    fn default() -> Self { Self::EMPTY }
}
impl ZigStringSlice {
    pub const EMPTY: Self = Self::Static(core::ptr::null(), 0);
    pub fn from_utf8_never_free(s: &[u8]) -> Self { Self::Static(s.as_ptr(), s.len()) }
    pub fn init_owned(v: Vec<u8>) -> Self { Self::Owned(v) }
    /// `ZigString.Slice.initDupe` — allocate an owned copy of `input`.
    pub fn init_dupe(input: &[u8]) -> Result<Self, bun_core::AllocError> {
        Ok(Self::Owned(input.to_vec()))
    }
    pub fn slice(&self) -> &[u8] {
        match self {
            Self::Static(p, l) if *l == 0 => &[],
            // SAFETY: constructor guarantees ptr/len describe a valid slice for self's lifetime.
            Self::Static(p, l) => unsafe { core::slice::from_raw_parts(*p, *l) },
            Self::Owned(v) => v.as_slice(),
            Self::WTF { ptr, len, .. } if *len == 0 => &[],
            // SAFETY: WTF variant holds a ref; latin1 buffer valid while ref held.
            Self::WTF { ptr, len, .. } => unsafe { core::slice::from_raw_parts(*ptr, *len) },
        }
    }
}
impl ZigStringSlice {
    /// Consume into an owned `Vec<u8>` — moves out the buffer if `Owned`,
    /// allocates a copy otherwise. WTF-backed slices deref the impl.
    pub fn into_vec(self) -> Vec<u8> {
        // Suppress Drop; we run the variant-specific cleanup ourselves.
        let mut this = core::mem::ManuallyDrop::new(self);
        match &mut *this {
            // SAFETY: `this` is ManuallyDrop so the Vec's destructor won't
            // double-run; we read it out exactly once and never use `this` again.
            Self::Owned(v) => unsafe { core::ptr::read(v) },
            Self::Static(p, l) if *l == 0 => Vec::new(),
            Self::Static(p, l) => unsafe { core::slice::from_raw_parts(*p, *l).to_vec() },
            Self::WTF { string_impl, ptr, len } => {
                let v = if *len == 0 {
                    Vec::new()
                } else {
                    // SAFETY: WTF ref held; latin1/utf8 bytes valid for `len`.
                    unsafe { core::slice::from_raw_parts(*ptr, *len).to_vec() }
                };
                // SAFETY: paired with the ref taken in `to_latin1_slice` (wtf.rs); pointer is live until this deref.
                unsafe { wtf::Bun__WTFStringImpl__deref(*string_impl) };
                v
            }
        }
    }
}
impl Drop for ZigStringSlice {
    fn drop(&mut self) {
        if let Self::WTF { string_impl, .. } = *self {
            // SAFETY: constructor took a ref; we now release it.
            unsafe { wtf::Bun__WTFStringImpl__deref(string_impl) }
        }
    }
}

impl ZigStringSlice {
    /// `ZigString.Slice.length()` — byte length of the slice payload.
    #[inline]
    pub fn length(&self) -> usize {
        match self {
            Self::Static(_, l) => *l,
            Self::Owned(v) => v.len(),
            Self::WTF { len, .. } => *len,
        }
    }

    /// True iff this slice owns a heap allocation that would be freed on
    /// `Drop`. Replaces the Zig `slice.allocator.get().is_some()` idiom: in
    /// Rust the allocator is implicit in the variant.
    #[inline]
    pub fn is_allocated(&self) -> bool {
        matches!(self, Self::Owned(_) | Self::WTF { .. })
    }

    /// True iff this slice is backed by a `WTF::StringImpl` ref (the Zig
    /// `String.isWTFAllocator(slice.allocator)` check).
    #[inline]
    pub fn is_wtf_allocated(&self) -> bool {
        matches!(self, Self::WTF { .. })
    }

    /// Consume an `Owned` slice into the raw `(ptr, len)` pair without freeing,
    /// for hand-off to a foreign owner (JSC external string). Any other
    /// variant returns `None` and leaves `self` untouched.
    pub fn take_owned_raw(&mut self) -> Option<(*const u8, usize)> {
        let Self::Owned(v) = self else { return None };
        let mut v = core::mem::ManuallyDrop::new(core::mem::take(v));
        *self = Self::default();
        // Shrink so the foreign `mi_free(ptr)` releases exactly this block.
        v.shrink_to_fit();
        Some((v.as_ptr(), v.len()))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SliceWithUnderlyingString
// ──────────────────────────────────────────────────────────────────────────

/// `bun.SliceWithUnderlyingString` — a UTF-8 byte view (`utf8`) optionally
/// pinned by a refcounted `bun.String` (`underlying`). When `underlying` is
/// live the bytes alias its storage; when dead the bytes are independently
/// owned (or static). JSC bridge methods (`toJS`, `transferToJS`) live in
/// `bun_jsc::bun_string_jsc` to keep this crate free of `JSValue`.
pub struct SliceWithUnderlyingString {
    pub utf8: ZigStringSlice,
    pub underlying: String,

    #[cfg(debug_assertions)]
    pub did_report_extra_memory_debug: bool,
}

impl Default for SliceWithUnderlyingString {
    fn default() -> Self {
        Self {
            utf8: ZigStringSlice::EMPTY,
            underlying: String::DEAD,
            #[cfg(debug_assertions)]
            did_report_extra_memory_debug: false,
        }
    }
}

impl SliceWithUnderlyingString {
    pub fn dupe_ref(&self) -> SliceWithUnderlyingString {
        SliceWithUnderlyingString {
            utf8: ZigStringSlice::EMPTY,
            underlying: self.underlying.dupe_ref(),
            #[cfg(debug_assertions)]
            did_report_extra_memory_debug: false,
        }
    }

    #[inline]
    pub fn slice(&self) -> &[u8] {
        self.utf8.slice()
    }

    #[inline]
    pub fn is_wtf_allocated(&self) -> bool {
        self.utf8.is_wtf_allocated()
    }
}

impl Drop for SliceWithUnderlyingString {
    fn drop(&mut self) {
        // `utf8` has its own Drop; `underlying` carries an intrusive refcount
        // that must be released explicitly (matching Zig's `deinit`).
        self.underlying.deref();
    }
}

// PORTING.md: ZStr/WStr are length-carrying NUL-terminated slices.
// bun_core re-exports these; we are the canonical home.
pub use bun_core::{ZStr, WStr};

/// `bun_str::zig_string` — module path so callers can spell `ZigString.Slice`
/// as `zig_string::Slice` (matches the Zig namespace `ZigString.Slice`).
pub mod zig_string {
    pub use super::ZigString;
    pub use super::ZigStringSlice as Slice;
    impl super::ZigStringSlice {
        /// `ZigString.Slice.empty` — Rust idiom is `EMPTY`, but several
        /// dependents call `.empty()` (matching Zig's `.empty`).
        #[inline]
        pub const fn empty() -> Self { Self::Static(core::ptr::null(), 0) }
    }
}

/// `bun.schema.api.StringPointer` — `(offset, length)` into an external buffer.
/// Widely used as a flat span descriptor (lockfile, HTTP headers, etc.).
#[repr(C)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct StringPointer {
    pub offset: u32,
    pub length: u32,
}

impl StringPointer {
    /// View into `buf[offset .. offset+length]`.
    #[inline]
    pub fn slice(self, buf: &[u8]) -> &[u8] {
        &buf[self.offset as usize..self.offset as usize + self.length as usize]
    }
    #[inline]
    pub fn is_empty(self) -> bool { self.length == 0 }
}

pub use path_string::PathString;
pub use mutable_string::MutableString;
pub use hashed_string::HashedString;
pub use smol_str::SmolStr;
pub use string_builder::StringBuilder;

// ──────────────────────────────────────────────────────────────────────────
// `encoding` — Node.js Buffer encoding tag. Self-contained.
// ──────────────────────────────────────────────────────────────────────────
pub mod encoding {
    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Debug, Default)]
    pub enum Encoding {
        #[default] Utf8 = 0, Ucs2, Utf16le, Latin1, Ascii, Base64, Base64url, Hex, Buffer,
    }
    impl Encoding {
        pub fn is_binary_to_text(self) -> bool {
            matches!(self, Self::Hex | Self::Base64 | Self::Base64url)
        }
    }
}
pub use encoding::Encoding as NodeEncoding;

// `strings` is the canonical Zig namespace name; alias to the real module.
pub use immutable as strings;

// ──────────────────────────────────────────────────────────────────────────
// `lexer` — identifier predicates (ASCII fast path + hook for Unicode).
// ──────────────────────────────────────────────────────────────────────────
pub mod lexer {
    use core::sync::atomic::{AtomicPtr, Ordering};
    pub static ID_START_ESNEXT_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());
    pub static ID_CONTINUE_ESNEXT_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());
    #[inline] pub fn is_identifier_start(c: u32) -> bool {
        (c as u8 as u32 == c) && ((c as u8).is_ascii_alphabetic() || c == b'_' as u32 || c == b'$' as u32)
        // TODO(b2): non-ASCII via ID_START_ESNEXT_HOOK
    }
    #[inline] pub fn is_identifier_continue(c: u32) -> bool {
        is_identifier_start(c) || (c as u8 as u32 == c && (c as u8).is_ascii_digit())
    }
    #[inline] pub fn is_identifier_part(c: u32) -> bool { is_identifier_continue(c) }
    /// Whole-string check. Port of `js_lexer.isIdentifier`. ASCII-only fast path;
    /// non-ASCII via hook (ES_NEXT tables installed by bun_js_parser at startup).
    pub fn is_identifier(s: &[u8]) -> bool {
        if s.is_empty() { return false; }
        let mut iter = crate::strings::CodepointIterator::init(s);
        let mut cur = crate::strings::Cursor::default();
        if !iter.next(&mut cur) || !is_identifier_start(cur.c as u32) { return false; }
        while iter.next(&mut cur) {
            if !is_identifier_continue(cur.c as u32) { return false; }
        }
        true
    }
}

pub mod lexer_tables {
    pub static STRICT_MODE_RESERVED_WORDS_REMAP: phf::Map<&'static [u8], &'static [u8]> = phf::phf_map! {
        b"implements" => b"_implements".as_slice(),
        b"interface" => b"_interface".as_slice(),
        b"let" => b"_let".as_slice(),
        b"package" => b"_package".as_slice(),
        b"private" => b"_private".as_slice(),
        b"protected" => b"_protected".as_slice(),
        b"public" => b"_public".as_slice(),
        b"static" => b"_static".as_slice(),
        b"yield" => b"_yield".as_slice(),
    };
}

// Hook slot: bun_runtime sets the WTFString allocation cap.
pub static STRING_ALLOCATION_LIMIT_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

// ──────────────────────────────────────────────────────────────────────────
// move-in: webcore_encoding (HOOK ← src/runtime/webcore/encoding.zig)
//
// `String::encode_into` dispatches to `jsc.WebCore.encoding.encodeIntoFrom{8,16}`
// (tier-6 — base64/hex/simdutf bodies). Per PORTING.md §Dispatch (debug/crash
// hooks), expose fn-ptr hooks that `bun_runtime::init()` populates.
// ──────────────────────────────────────────────────────────────────────────
pub mod webcore_encoding {
    use super::encoding::Encoding;
    use core::sync::atomic::{AtomicPtr, Ordering};

    pub type EncodeInto16 =
        unsafe fn(*const u16, usize, *mut u8, usize, Encoding, bool) -> usize;
    pub type EncodeInto8 = unsafe fn(*const u8, usize, *mut u8, usize, Encoding) -> usize;

    pub static ENCODE_INTO_FROM16_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());
    pub static ENCODE_INTO_FROM8_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

    /// `bun_runtime::init()` calls this once with real impls.
    pub fn install_hooks(encode16: EncodeInto16, encode8: EncodeInto8) {
        ENCODE_INTO_FROM16_HOOK.store(encode16 as *mut (), Ordering::Release);
        ENCODE_INTO_FROM8_HOOK.store(encode8 as *mut (), Ordering::Release);
    }

    // ──────────────────────────────────────────────────────────────────────
    // construct_from{u8,u16} hooks — used by `ZigString::encode` (bun_jsc).
    // Real impls live in `src/runtime/webcore/encoding.rs` (forward-dep on
    // bun_jsc). Same hook pattern as `encode_into_from*` above.
    // ──────────────────────────────────────────────────────────────────────
    pub type ConstructFromU8 = unsafe fn(*const u8, usize, Encoding) -> Vec<u8>;
    pub type ConstructFromU16 = unsafe fn(*const u16, usize, Encoding) -> Vec<u8>;

    pub static CONSTRUCT_FROM_U8_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());
    pub static CONSTRUCT_FROM_U16_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

    pub fn install_construct_hooks(from_u8: ConstructFromU8, from_u16: ConstructFromU16) {
        CONSTRUCT_FROM_U8_HOOK.store(from_u8 as *mut (), Ordering::Release);
        CONSTRUCT_FROM_U16_HOOK.store(from_u16 as *mut (), Ordering::Release);
    }

    #[inline]
    pub fn construct_from_u8(input: &[u8], enc: Encoding) -> Vec<u8> {
        let f = CONSTRUCT_FROM_U8_HOOK.load(Ordering::Acquire);
        debug_assert!(!f.is_null(), "webcore_encoding construct hooks not installed");
        // SAFETY: hook installed by runtime init; input describes a valid slice.
        unsafe {
            core::mem::transmute::<*mut (), ConstructFromU8>(f)(input.as_ptr(), input.len(), enc)
        }
    }

    #[inline]
    pub fn construct_from_u16(input: &[u16], enc: Encoding) -> Vec<u8> {
        let f = CONSTRUCT_FROM_U16_HOOK.load(Ordering::Acquire);
        debug_assert!(!f.is_null(), "webcore_encoding construct hooks not installed");
        // SAFETY: hook installed by runtime init; input describes a valid slice.
        unsafe {
            core::mem::transmute::<*mut (), ConstructFromU16>(f)(input.as_ptr(), input.len(), enc)
        }
    }

    #[inline]
    pub fn encode_into_from16(
        input: &[u16],
        out: &mut [u8],
        enc: Encoding,
        allow_partial_write: bool,
    ) -> usize {
        let f = ENCODE_INTO_FROM16_HOOK.load(Ordering::Acquire);
        debug_assert!(!f.is_null(), "webcore_encoding hooks not installed");
        // SAFETY: hook installed by runtime init; input/out describe valid slices.
        unsafe {
            core::mem::transmute::<*mut (), EncodeInto16>(f)(
                input.as_ptr(), input.len(), out.as_mut_ptr(), out.len(), enc, allow_partial_write,
            )
        }
    }

    #[inline]
    pub fn encode_into_from8(input: &[u8], out: &mut [u8], enc: Encoding) -> usize {
        let f = ENCODE_INTO_FROM8_HOOK.load(Ordering::Acquire);
        debug_assert!(!f.is_null(), "webcore_encoding hooks not installed");
        // SAFETY: hook installed by runtime init; input/out describe valid slices.
        unsafe {
            core::mem::transmute::<*mut (), EncodeInto8>(f)(
                input.as_ptr(), input.len(), out.as_mut_ptr(), out.len(), enc,
            )
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// move-in: printer (MOVE_DOWN ← src/js_printer/js_printer.zig)
//
// Self-contained string-quoting helpers used by `strings::format_escapes`,
// `bun_sourcemap::Chunk` (JSON serialization), and `bun_js_parser::ast::Expr`.
// Breaking the `bun_js_printer → bun_sourcemap` cycle by hosting the
// pure-string `quoteForJSON` here.
// ──────────────────────────────────────────────────────────────────────────
pub mod printer {
    use crate::immutable::{self as strings, Encoding as StrEncoding};
    use crate::mutable_string::MutableString;

    const HEX_CHARS: &[u8; 16] = b"0123456789ABCDEF";
    const FIRST_ASCII: i32 = 0x20;
    const LAST_ASCII: i32 = 0x7E;
    const FIRST_HIGH_SURROGATE: i32 = 0xD800;
    const FIRST_LOW_SURROGATE: i32 = 0xDC00;
    const LAST_LOW_SURROGATE: i32 = 0xDFFF;

    /// Minimal byte-sink so `write_pre_quoted_string` works for both
    /// `core::fmt::Formatter` and `MutableString` without an `io::Write` bound.
    pub trait PrinterWriter {
        fn write_all(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error>;
    }
    impl PrinterWriter for MutableString {
        #[inline]
        fn write_all(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error> {
            self.append(bytes).map_err(Into::into)
        }
    }
    impl PrinterWriter for Vec<u8> {
        #[inline]
        fn write_all(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error> {
            self.extend_from_slice(bytes);
            Ok(())
        }
    }

    #[inline]
    pub fn can_print_without_escape(c: i32, ascii_only: bool) -> bool {
        if c <= LAST_ASCII {
            c >= FIRST_ASCII
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
                && (c < FIRST_HIGH_SURROGATE || c > LAST_LOW_SURROGATE)
        }
    }

    /// Port of `js_printer.writePreQuotedString`.
    /// PERF(port): was comptime-monomorphized over (quote_char, ascii_only, json,
    /// encoding); demoted to runtime params — profile in Phase B.
    pub fn write_pre_quoted_string<W: PrinterWriter + ?Sized>(
        text_in: &[u8],
        writer: &mut W,
        quote_char: u8,
        ascii_only: bool,
        json: bool,
        encoding: StrEncoding,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(!json || quote_char == b'"');
        // utf16 view over the same bytes (only used when encoding == Utf16).
        // SAFETY: callers pass 2-byte-aligned even-length input for Utf16.
        let text16: &[u16] = if encoding == StrEncoding::Utf16 {
            unsafe {
                core::slice::from_raw_parts(text_in.as_ptr() as *const u16, text_in.len() / 2)
            }
        } else {
            &[]
        };
        let n: usize = if encoding == StrEncoding::Utf16 { text16.len() } else { text_in.len() };
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
                    strings::decode_wtf8_rune_t::<i32>(&buf, width, 0)
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
                        if let Some(j) =
                            strings::index_of_needs_escape_for_java_script_string(remain, quote_char)
                        {
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
                0x07 => { writer.write_all(b"\\x07")?; i += 1; }
                0x08 => { writer.write_all(b"\\b")?; i += 1; }
                0x0C => { writer.write_all(b"\\f")?; i += 1; }
                0x0A => {
                    writer.write_all(if quote_char == b'`' { b"\n" } else { b"\\n" })?;
                    i += 1;
                }
                0x0D => { writer.write_all(b"\\r")?; i += 1; }
                0x0B => { writer.write_all(b"\\v")?; i += 1; }
                0x5C => { writer.write_all(b"\\\\")?; i += 1; }
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
                        let k = c as usize;
                        writer.write_all(&[
                            b'\\', b'x',
                            HEX_CHARS[(k >> 4) & 0xF],
                            HEX_CHARS[k & 0xF],
                        ])?;
                    } else if c <= 0xFFFF {
                        let k = c as usize;
                        writer.write_all(&[
                            b'\\', b'u',
                            HEX_CHARS[(k >> 12) & 0xF],
                            HEX_CHARS[(k >> 8) & 0xF],
                            HEX_CHARS[(k >> 4) & 0xF],
                            HEX_CHARS[k & 0xF],
                        ])?;
                    } else {
                        let k = c - 0x10000;
                        let lo = (FIRST_HIGH_SURROGATE + ((k >> 10) & 0x3FF)) as usize;
                        let hi = (FIRST_LOW_SURROGATE + (k & 0x3FF)) as usize;
                        writer.write_all(&[
                            b'\\', b'u',
                            HEX_CHARS[lo >> 12],
                            HEX_CHARS[(lo >> 8) & 15],
                            HEX_CHARS[(lo >> 4) & 15],
                            HEX_CHARS[lo & 15],
                            b'\\', b'u',
                            HEX_CHARS[hi >> 12],
                            HEX_CHARS[(hi >> 8) & 15],
                            HEX_CHARS[(hi >> 4) & 15],
                            HEX_CHARS[hi & 15],
                        ])?;
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
    ) -> Result<(), bun_core::Error> {
        // PERF(port): Zig pre-grew via estimateLengthForUTF8 — profile in Phase B.
        bytes.append_char(b'"')?;
        write_pre_quoted_string(text, bytes, b'"', ascii_only, true, StrEncoding::Utf8)?;
        bytes.append_char(b'"').expect("unreachable");
        Ok(())
    }
}
pub use printer::quote_for_json;

// ──────────────────────────────────────────────────────────────────────────
// Top-level free helpers (move-ins from misc Zig namespaces).
// ──────────────────────────────────────────────────────────────────────────

/// `bun.sliceTo(buf, 0)` — slice up to (not including) the first NUL byte,
/// or the whole buffer if none. Port of `std.mem.sliceTo` for `u8`/`0`.
#[inline]
pub fn slice_to_nul(buf: &[u8]) -> &[u8] {
    match buf.iter().position(|&b| b == 0) {
        Some(i) => &buf[..i],
        None => buf,
    }
}

/// move-in: `cheap_prefix_normalizer` (MOVE_DOWN ← `bundle_v2.zig`).
///
/// Pure path-string helper used by the bundler chunk writer and `css::printer`.
/// Returns `(prefix', suffix')` such that concatenating them produces a
/// reasonably-normalized path (collapses `./` leading and avoids `//`).
pub fn cheap_prefix_normalizer<'a>(prefix: &'a [u8], suffix: &'a [u8]) -> (&'a [u8], &'a [u8]) {
    if prefix.is_empty() {
        let suffix_no_slash = strings::remove_leading_dot_slash(suffix);
        return (
            if strings::has_prefix_comptime(suffix_no_slash, b"../") { b"" } else { b"./" },
            suffix_no_slash,
        );
    }

    // ["https://example.com/", "/out.js"]  => "https://example.com/out.js"
    // ["/foo/", "/bar.js"]                 => "/foo/bar.js"
    let win = bun_core::Environment::IS_WINDOWS;
    if strings::ends_with_char(prefix, b'/') || (win && strings::ends_with_char(prefix, b'\\')) {
        if strings::starts_with_char(suffix, b'/')
            || (win && strings::starts_with_char(suffix, b'\\'))
        {
            return (prefix, &suffix[1..]);
        }
        // It gets really complicated if we try to deal with URLs more than this
        // (see bundle_v2.zig comment block).
    }

    (prefix, strings::remove_leading_dot_slash(suffix))
}

// Re-export `wtf::parse_double` at crate root (callers spell it `bun_str::parse_double`).
pub use wtf::parse_double;
