#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use, unreachable_pub)]
//! `bun_string` — port of `src/string/string.zig` (`bun.String` and friends).
//!
//! `String` is the FFI-compatible 5-variant tagged union shared with C++
//! (`BunString` in `src/jsc/bindings/BunString.cpp`). `ZigString` is the
//! pointer-tagged borrowed view; `ZigStringSlice` is the owned-or-borrowed
//! UTF-8 byte slice that replaces Zig's allocator-vtable trick.

#[path = "HashedString.rs"]  pub mod hashed_string;
#[path = "PathString.rs"]    pub mod path_string;
#[path = "SmolStr.rs"]       pub mod smol_str;
#[path = "StringBuilder.rs"] pub mod string_builder;
#[path = "StringJoiner.rs"]  pub mod string_joiner;
#[path = "escapeRegExp.rs"]  pub mod escape_reg_exp;

#[path = "MutableString.rs"] pub mod mutable_string;
pub mod wtf;

// `bun.strings.*` — SIMD-backed scanners over highway/simdutf FFI.
#[path = "immutable.rs"] pub mod immutable;

// Unicode ID-Start/ID-Continue two-stage tables (`js_lexer/identifier_data.zig`).
// Pure data with no upward deps; hosted here so [`lexer`], [`mutable_string`],
// and [`immutable::unicode`] get full Unicode coverage without depending on
// `bun_js_parser`. `bun_js_parser::lexer::identifier` re-exports this module.
#[path = "identifier.rs"] pub mod identifier;

use core::sync::atomic::{AtomicUsize, Ordering};
pub use wtf::{WTFStringImpl, WTFStringImplExt, WTFStringImplStruct};

// ──────────────────────────────────────────────────────────────────────────
// `bun.String` — 5-variant tagged WTFString-or-ZigString. extern layout
// must match Zig `extern struct { tag: Tag, value: StringImpl }` (= C++
// `BunString` in BunString.cpp), 24 bytes on 64-bit.
// ──────────────────────────────────────────────────────────────────────────
// Canonical layout lives in `bun_alloc` (T0 TYPE_ONLY landing for
// `bun.String`); re-exported so existing `bun_string::{Tag, StringImpl}` paths
// keep working. `String` is a `#[repr(transparent)]` newtype over
// `bun_alloc::String` so the FFI layout has ONE source of truth while this
// crate retains its inherent impl block (toJS/toUTF8/WTF refcounting).
pub use bun_alloc::{StringImpl, Tag};

// ── Debug-only Rust-side WTF ref balance ───────────────────────────────────
//
// Tracks the *net* +1s the Rust side holds against `WTF::StringImpl`
// refcounts: every Rust-visible creation (`BunString__from*` returns a +1)
// and every explicit `.ref_()` increments; every `.deref()` decrements. If
// Rust correctly pairs every create/ref with a deref (or hands ownership to
// C++ via FFI without further touching the value), this stays bounded.
// Linear growth per iteration of a leak test = forgotten `.deref()` on the
// Rust side (the BunString-RAII hypothesis). C++-side leaks do NOT show up
// here; use macOS `leaks` for that.
//
// Always compiled; one relaxed atomic add per ref op is below noise. Read
// via `bun_string::rust_wtf_ref_balance()` → exposed as
// `Bun.unsafe.heapStats().bunStringRefBalance`.
pub static RUST_WTF_REF_BALANCE: core::sync::atomic::AtomicIsize =
    core::sync::atomic::AtomicIsize::new(0);

#[inline]
pub fn rust_wtf_ref_balance() -> isize {
    RUST_WTF_REF_BALANCE.load(core::sync::atomic::Ordering::Relaxed)
}

// ── Debug-only per-callsite ref trace ──────────────────────────────────────
//
// When `BUN_DEBUG_WTF_REF_TRACE=1`, every balance bump records its
// `#[track_caller]` Location. `rust_wtf_ref_trace_drain()` aggregates by
// (file:line, sign) and returns a sorted `Vec<(net, "file:line")>` so the
// instrument harness can diff which callsites contribute to the per-iter +6.
// One Mutex<Vec> push per ref op; only paid when the env var is set.
#[cfg(debug_assertions)]
static RUST_WTF_REF_TRACE_ENABLED: core::sync::atomic::AtomicBool =
    core::sync::atomic::AtomicBool::new(false);
#[cfg(debug_assertions)]
static RUST_WTF_REF_TRACE: std::sync::Mutex<Vec<(i8, &'static core::panic::Location<'static>)>> =
    std::sync::Mutex::new(Vec::new());

#[cfg(debug_assertions)]
#[inline]
pub fn rust_wtf_ref_trace_enable(on: bool) {
    RUST_WTF_REF_TRACE_ENABLED.store(on, core::sync::atomic::Ordering::Relaxed);
}

#[cfg(debug_assertions)]
#[cold]
fn rust_wtf_ref_trace_push(sign: i8, loc: &'static core::panic::Location<'static>) {
    if let Ok(mut v) = RUST_WTF_REF_TRACE.lock() {
        v.push((sign, loc));
    }
}

#[cfg(debug_assertions)]
#[inline(always)]
fn trace_ref(sign: i8, loc: &'static core::panic::Location<'static>) {
    if RUST_WTF_REF_TRACE_ENABLED.load(core::sync::atomic::Ordering::Relaxed) {
        rust_wtf_ref_trace_push(sign, loc);
    }
}
#[cfg(not(debug_assertions))]
#[inline(always)]
fn trace_ref(_sign: i8, _loc: &'static core::panic::Location<'static>) {}

/// Drain and aggregate the trace: returns `[(net_count, "file:line"), ...]`
/// sorted by |net| descending. Clears the buffer.
#[cfg(debug_assertions)]
pub fn rust_wtf_ref_trace_drain() -> Vec<(isize, std::string::String)> {
    use std::collections::BTreeMap;
    let entries = core::mem::take(&mut *RUST_WTF_REF_TRACE.lock().unwrap());
    let mut by_site: BTreeMap<(&str, u32), isize> = BTreeMap::new();
    for (sign, loc) in entries {
        *by_site.entry((loc.file(), loc.line())).or_default() += sign as isize;
    }
    let mut out: Vec<_> = by_site
        .into_iter()
        .map(|((f, l), n)| (n, format!("{f}:{l}")))
        .collect();
    out.sort_by_key(|(n, _)| core::cmp::Reverse(n.abs()));
    out
}
#[cfg(not(debug_assertions))]
pub fn rust_wtf_ref_trace_drain() -> Vec<(isize, std::string::String)> {
    Vec::new()
}
#[cfg(not(debug_assertions))]
#[inline]
pub fn rust_wtf_ref_trace_enable(_on: bool) {}

#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct String(pub bun_alloc::String);

// C++ mirror: `struct BunString { BunStringTag tag; BunStringImpl impl; }`
// (`headers-handwritten.h`); returned **by value** from every `BunString__*`
// FFI below, so size/align drift is silent ABI corruption.
bun_core::assert_ffi_layout!(String, 24, 8);
// The `as_zig()` accessor reinterprets `&bun_alloc::ZigString` as
// `&crate::ZigString`; both are `#[repr(C)] { *const u8, usize }` with the
// same pointer-tag-bit scheme.
const _: () = assert!(
    core::mem::size_of::<bun_alloc::ZigString>() == core::mem::size_of::<ZigString>()
        && core::mem::align_of::<bun_alloc::ZigString>() == core::mem::align_of::<ZigString>()
);

// FFI surface from `src/jsc/bindings/BunString.cpp`. All return a fresh
// WTF-backed `String` with refcount = 1; caller must `deref()` (or transfer).
unsafe extern "C" {
    fn BunString__fromBytes(bytes: *const u8, len: usize) -> String;
    fn BunString__fromLatin1(bytes: *const u8, len: usize) -> String;
    fn BunString__fromUTF8(bytes: *const u8, len: usize) -> String;
    fn BunString__fromUTF16(bytes: *const u16, len: usize) -> String;
    fn BunString__fromUTF16ToLatin1(bytes: *const u16, len: usize) -> String;
    safe fn BunString__fromLatin1Unitialized(len: usize) -> String;
    safe fn BunString__fromUTF16Unitialized(len: usize) -> String;
    // `&mut String` / `&String` are ABI-identical to the C++ `BunString*`
    // (thin non-null pointer to a `#[repr(C)]` struct, asserted by
    // `assert_ffi_layout!` above). C++ reads/writes only the `tag`/`value`
    // fields in place; the type encodes the sole pointer-validity precondition,
    // so `safe fn` discharges the link-time proof here.
    safe fn BunString__toWTFString(this: &mut String);
    safe fn BunString__toThreadSafe(this: &mut String);
    fn BunString__createAtom(bytes: *const u8, len: usize) -> String;
    fn BunString__tryCreateAtom(bytes: *const u8, len: usize) -> String;
    fn BunString__createStaticExternal(bytes: *const u8, len: usize, isLatin1: bool) -> String;
    safe fn BunString__toInt32(this: &String) -> i64;
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
pub type ExternalStringImplFreeFunction<Ctx> =
    extern "C" fn(ctx: Ctx, buffer: *mut core::ffi::c_void, len: usize);

impl String {
    pub const EMPTY: Self = Self(bun_alloc::String::EMPTY);
    pub const DEAD: Self = Self(bun_alloc::String::DEAD);

    #[inline] pub const fn empty() -> Self { Self::EMPTY }
    #[inline] pub const fn dead() -> Self { Self::DEAD }
    #[inline] pub fn tag(&self) -> Tag { self.0.tag }

    /// Wrap a `bun_string::ZigString` under `tag`. Converts to the
    /// layout-identical `bun_alloc::ZigString` for storage in the canonical
    /// union (both `#[repr(C)] { *const u8, usize }`, same tag-bit scheme).
    #[inline(always)]
    fn wrap_zig(tag: Tag, z: ZigString) -> Self {
        // Field-by-field (not `transmute`) so a future field reorder in either
        // struct fails at compile time, not at runtime. Both are
        // `#[repr(C)] { *const u8, usize }` with identical tag-bit semantics.
        let zig_string = bun_alloc::ZigString {
            _unsafe_ptr_do_not_use: z.tagged_ptr(),
            len: z.len,
        };
        Self(bun_alloc::String { tag, value: StringImpl { zig_string } })
    }

    /// Borrow the active `ZigString` variant. Every caller branches on
    /// `self.tag` first; centralising the union read here collapses ~25
    /// per-site `unsafe` union-field reads into one.
    #[inline(always)]
    fn as_zig(&self) -> &ZigString {
        debug_assert!(matches!(self.0.tag, Tag::ZigString | Tag::StaticZigString));
        // SAFETY: `tag` is `ZigString`/`StaticZigString` ⇒ `zig_string` is the
        // active union field. `ZigString` is `Copy`/POD so reading it is always
        // sound. The cast reinterprets `&bun_alloc::ZigString` as
        // `&crate::ZigString` (both `#[repr(C)] { *const u8, usize }`, asserted
        // above).
        unsafe { &*(core::ptr::addr_of!(self.0.value.zig_string) as *const ZigString) }
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

    /// Read the raw `*mut WTFStringImplStruct` without dereferencing. Used
    /// where the pointer value itself is needed (identity comparison,
    /// hand-off to C++) rather than the struct fields.
    #[inline(always)]
    pub(crate) fn wtf_ptr(&self) -> WTFStringImpl {
        debug_assert_eq!(self.0.tag, Tag::WTFStringImpl);
        // SAFETY: `tag == WTFStringImpl` ⇒ `wtf_string_impl` is the active
        // union field; reading the pointer (not dereferencing) is always sound
        // for the POD `*mut` union arm.
        unsafe { self.0.value.wtf_string_impl }
    }

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
        Self(bun_alloc::String {
            tag: Tag::StaticZigString,
            value: StringImpl { zig_string: bun_alloc::ZigString::init(s.as_ref()) },
        })
    }
    /// Alias of `static_` for callers that spell it `static_str`.
    #[inline]
    pub fn static_str<S: ?Sized + AsRef<[u8]>>(s: &'static S) -> Self {
        Self::static_(s)
    }

    /// `bun.String.cloneUTF8` — copies `s` into a fresh WTF::StringImpl
    /// (refcount = 1). Caller must `deref()` or transfer ownership.
    #[track_caller]
    pub fn clone_utf8(s: &[u8]) -> Self {
        if s.is_empty() { return Self::EMPTY; }
        // BunString__fromBytes auto-detects all-ASCII → Latin1, else UTF-8.
        // SAFETY: s.as_ptr()/len describe a valid byte slice.
        unsafe { BunString__fromBytes(s.as_ptr(), s.len()) }.track_create()
    }
    #[track_caller]
    pub fn clone_latin1(s: &[u8]) -> Self {
        if s.is_empty() { return Self::EMPTY; }
        unsafe { BunString__fromLatin1(s.as_ptr(), s.len()) }.track_create()
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
        .track_create()
    }
    pub fn create_atom(s: &[u8]) -> Self {
        unsafe { BunString__createAtom(s.as_ptr(), s.len()) }.track_create()
    }
    /// `bun.String.tryCreateAtom` — `None` if `bytes` is non-ASCII or too long
    /// to atomize (string.zig:270).
    pub fn try_create_atom(bytes: &[u8]) -> Option<Self> {
        // SAFETY: bytes describes a valid slice.
        let atom = unsafe { BunString__tryCreateAtom(bytes.as_ptr(), bytes.len()) };
        if atom.0.tag == Tag::Dead { None } else { Some(atom.track_create()) }
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
    /// the const-assert below to keep the C-ABI cast sound.
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
        if bytes.len() >= Self::max_length() {
            callback(ctx, bytes.as_ptr().cast_mut().cast::<c_void>(), bytes.len());
            return Self::DEAD;
        }
        // PORT NOTE: Zig asserted `@typeInfo(Ctx) == .pointer` (raw pointer, no
        // destructor). The Rust const-assert only checks size, so an owning
        // pointer-sized `Ctx` (e.g. `Box<T>`) would otherwise be dropped here
        // and later double-freed by the WTF finalizer. Ownership transfers to
        // the external string; suppress the local drop.
        let ctx = core::mem::ManuallyDrop::new(ctx);
        // SAFETY: Ctx is pointer-sized and pointer-aligned (const-asserted
        // above); read the bits as `*mut c_void`.
        let ctx_erased: *mut c_void =
            unsafe { core::ptr::from_ref::<Ctx>(&*ctx).cast::<*mut c_void>().read() };
        let cb_erased: Option<extern "C" fn(*mut c_void, *mut c_void, usize)> =
            // SAFETY: same ABI; first param erased per the const-assert above.
            Some(unsafe { bun_ptr::cast_fn_ptr::<
                ExternalStringImplFreeFunction<Ctx>,
                extern "C" fn(*mut c_void, *mut c_void, usize),
            >(callback) });
        // SAFETY: bytes describes a valid slice; len < max_length checked.
        let s = unsafe {
            BunString__createExternal(bytes.as_ptr(), bytes.len(), is_latin1, ctx_erased, cb_erased)
        };
        debug_assert!(s.0.tag != Tag::WTFStringImpl || s.as_wtf().ref_count() == 1);
        s.track_create()
    }

    /// Max `WTF::StringImpl` length (in characters, not bytes).
    /// Reads the process-wide [`STRING_ALLOCATION_LIMIT`] data slot
    /// (`jsc::VirtualMachine::string_allocation_limit` in Zig).
    #[inline]
    pub fn max_length() -> usize {
        STRING_ALLOCATION_LIMIT.load(Ordering::Relaxed)
    }

    /// `bun.String.createStaticExternal` — wraps `bytes` in a
    /// `WTF::ExternalStringImpl` that will **never** be freed. Only use for
    /// dynamically-allocated data with process lifetime (string.zig:427).
    pub fn create_static_external(bytes: &[u8], is_latin1: bool) -> Self {
        debug_assert!(!bytes.is_empty());
        // SAFETY: bytes describes a valid slice; C++ side stores ptr/len
        // without copying and never frees it.
        unsafe { BunString__createStaticExternal(bytes.as_ptr(), bytes.len(), is_latin1) }
            .track_create()
    }
    /// `bun.String.createFormat` — formats `args` into a temporary buffer and
    /// copies the result into a fresh WTF-backed string. Port collapses Zig's
    /// `(comptime fmt, args: anytype)` into [`core::fmt::Arguments`].
    pub fn create_format(args: core::fmt::Arguments<'_>) -> Self {
        use core::fmt::Write;
        // PORT NOTE: Zig used a 512-byte stackFallback; this is a cold path
        // (error messages), so a heap buffer is fine.
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
        let s = BunString__fromLatin1Unitialized(len).track_create();
        if s.0.tag != Tag::WTFStringImpl {
            return (s, &mut []);
        }
        debug_assert_eq!(s.as_wtf().ref_count(), 1);
        // SAFETY: WTF tag verified above; impl has a writable latin1 buffer of
        // `len`. `ptr` points at `len` writable bytes owned by the new WTF
        // impl; the `'static` lifetime mirrors Zig's `[]u8` return (lifetime
        // is actually tied to `s` — caller must not outlive it).
        let buf = unsafe {
            let ptr = (*s.0.value.wtf_string_impl).m_ptr.latin1.cast_mut();
            core::slice::from_raw_parts_mut(ptr, len)
        };
        (s, buf)
    }
    pub fn create_uninitialized_utf16(len: usize) -> (Self, &'static mut [u16]) {
        let s = BunString__fromUTF16Unitialized(len).track_create();
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
        if bytes.len() >= Self::max_length() {
            return Self::DEAD;
        }
        let mut bytes = core::mem::ManuallyDrop::new(bytes.into_boxed_slice());
        // SAFETY: ownership transferred to WTF::ExternalStringImpl, which frees
        // via mimalloc (the global allocator).
        unsafe { BunString__createExternalGloballyAllocatedLatin1(bytes.as_mut_ptr(), bytes.len()) }
            .track_create()
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
            .track_create()
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
        BunString__toWTFString(self)
    }
    /// Zig: `bun.String.init(WTFStringImpl)` / `WTFString.adopt` — wrap a raw
    /// `*mut WTFStringImplStruct`, **adopting** the existing +1 ref (no inc).
    /// Inverse of [`leak_wtf_impl`]. Null → `String::EMPTY`.
    #[inline]
    pub fn adopt_wtf_impl(wtf: WTFStringImpl) -> Self {
        if wtf.is_null() {
            return Self::EMPTY;
        }
        Self(bun_alloc::String { tag: Tag::WTFStringImpl, value: StringImpl { wtf_string_impl: wtf } })
    }
    /// Zig: `bun.String{...}.value.WTFStringImpl` — extract the raw `*mut WTFStringImplStruct`
    /// from a WTF-backed string, transferring ownership of the +1 ref to the caller. Returns
    /// null for non-WTF tags. Used by SQL data-cell paths that hand the impl pointer to C++.
    #[inline]
    pub fn leak_wtf_impl(self) -> WTFStringImpl {
        if self.0.tag == Tag::WTFStringImpl {
            self.wtf_ptr()
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
    pub fn is_thread_safe(&self) -> bool {
        if self.0.tag == Tag::WTFStringImpl {
            // SAFETY: WTF tag guarantees `value.wtf` is a valid live impl.
            self.as_wtf().is_thread_safe()
        } else {
            true
        }
    }
    /// Debug-only guard for the `Send`/`Sync` contract: panics if this
    /// `String` wraps a non-thread-safe `WTF::StringImpl`. Intended for the
    /// hand-off point where a `String` is stored into a value that will cross
    /// threads (worker task payloads, channel sends, `Arc`-shared state) —
    /// the Rust spelling of Zig's `bun.assert(str.isThreadSafe())` before a
    /// thread-pool dispatch.
    #[inline(always)]
    #[track_caller]
    pub fn debug_assert_thread_safe(&self) {
        debug_assert!(
            self.is_thread_safe(),
            "bun_string::String crosses thread boundary with non-thread-safe \
             WTF::StringImpl (non-atomic refcount); call `to_thread_safe()` first"
        );
    }
    pub fn to_int32(&self) -> Option<i32> {
        let v = BunString__toInt32(self);
        if v > i32::MAX as i64 { None } else { Some(v as i32) }
    }

    /// Funnel for newly-created WTF strings returned +1 from C++. Bumps
    /// [`RUST_WTF_REF_BALANCE`] so leak tests can see how many +1 refs the
    /// Rust side currently holds. Idempotent for non-WTF tags.
    ///
    /// `pub` so out-of-crate FFI ctors (e.g. `bun_jsc::bun_string_jsc::from_js`)
    /// can funnel through it. **Do not** call on a `String` that wasn't just
    /// returned +1 from C++ — that would double-count.
    #[inline(always)]
    #[track_caller]
    pub fn track_create(self) -> Self {
        if self.0.tag == Tag::WTFStringImpl {
            RUST_WTF_REF_BALANCE.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
            trace_ref(1, core::panic::Location::caller());
        }
        self
    }

    /// Account for a +1 leaving Rust's books via FFI without a Rust-side
    /// `.deref()`. **Does not touch the refcount** — call this only when C++
    /// adopts ownership (i.e. will `BunString::deref()` it). Mirrors
    /// [`track_create`] in reverse so [`RUST_WTF_REF_BALANCE`] stays
    /// meaningful per-iteration. Idempotent for non-WTF tags.
    ///
    /// Use at every site that writes a +1 `String` into an out-param C++
    /// owns (e.g. `*ret = ErrorableString::ok(s.track_ffi_transfer())`) or
    /// that hands a `ResolvedSource` to C++ (`OwnedResolvedSource::into_ffi`).
    #[inline(always)]
    #[track_caller]
    pub fn track_ffi_transfer(self) -> Self {
        if self.0.tag == Tag::WTFStringImpl {
            RUST_WTF_REF_BALANCE.fetch_sub(1, core::sync::atomic::Ordering::Relaxed);
            trace_ref(-1, core::panic::Location::caller());
        }
        self
    }

    /// `String.ref()` — increment WTF refcount; no-op for other tags.
    #[inline]
    #[track_caller]
    pub fn ref_(&self) {
        if self.0.tag == Tag::WTFStringImpl {
            RUST_WTF_REF_BALANCE.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
            trace_ref(1, core::panic::Location::caller());
            self.as_wtf().r#ref()
        }
    }
    /// `String.deref()` — decrement WTF refcount; no-op for other tags.
    #[inline]
    #[track_caller]
    pub fn deref(&self) {
        if self.0.tag == Tag::WTFStringImpl {
            RUST_WTF_REF_BALANCE.fetch_sub(1, core::sync::atomic::Ordering::Relaxed);
            trace_ref(-1, core::panic::Location::caller());
            self.as_wtf().deref()
        }
    }
    /// `String.dupeRef()` — copy + ref.
    #[inline]
    #[track_caller]
    pub fn dupe_ref(&self) -> Self {
        self.ref_();
        *self
    }

    #[inline]
    pub fn length(&self) -> usize {
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().length() as usize,
            Tag::ZigString | Tag::StaticZigString => self.as_zig().len,
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
            Tag::ZigString | Tag::StaticZigString => self.as_zig().is_16bit(),
            _ => false,
        }
    }
    pub fn is_utf8(&self) -> bool {
        matches!(self.0.tag, Tag::ZigString | Tag::StaticZigString)
            && self.as_zig().is_utf8()
    }
    pub fn is_8bit(&self) -> bool {
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().is_8bit(),
            Tag::ZigString => !self.as_zig().is_16bit(),
            _ => true,
        }
    }
    /// Raw byte view (Latin-1 or UTF-16 bytes — NOT necessarily UTF-8).
    pub fn byte_slice(&self) -> &[u8] {
        match self.0.tag {
            Tag::ZigString | Tag::StaticZigString => self.as_zig().byte_slice(),
            Tag::WTFStringImpl => self.as_wtf().byte_slice(),
            _ => &[],
        }
    }
    /// Latin-1 byte view; debug-asserts `is_8bit()`.
    pub fn latin1(&self) -> &[u8] {
        debug_assert!(self.is_8bit());
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().latin1_slice(),
            Tag::ZigString | Tag::StaticZigString => self.as_zig().slice(),
            _ => &[],
        }
    }
    pub fn utf16(&self) -> &[u16] {
        debug_assert!(self.is_utf16());
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().utf16_slice(),
            Tag::ZigString | Tag::StaticZigString => self.as_zig().utf16_slice(),
            _ => &[],
        }
    }
    pub fn ensure_hash(&self) {
        if self.0.tag == Tag::WTFStringImpl {
            self.as_wtf().ensure_hash()
        }
    }

    /// `bun.String.inMapCaseInsensitive` (string.zig) — case-insensitive ASCII
    /// lookup against a phf map. The Zig version dispatches through
    /// `ComptimeStringMap.getWithEqlList`; here we lowercase into a stack
    /// buffer and probe the phf map directly. Keys longer than 64 bytes or
    /// containing non-ASCII code units never match (all callers' maps have
    /// short ASCII keys).
    pub fn in_map_case_insensitive<V: Copy>(
        &self,
        map: &'static phf::Map<&'static [u8], V>,
    ) -> Option<V> {
        let len = self.length();
        if len == 0 || len > 64 {
            return None;
        }
        let mut buf = [0u8; 64];
        if self.is_utf16() {
            for (i, &c) in self.utf16().iter().enumerate() {
                if c >= 0x80 {
                    return None;
                }
                buf[i] = (c as u8).to_ascii_lowercase();
            }
        } else {
            for (i, &b) in self.byte_slice().iter().enumerate() {
                if b >= 0x80 {
                    return None;
                }
                buf[i] = b.to_ascii_lowercase();
            }
        }
        map.get(&buf[..len]).copied()
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
        match self.0.tag {
            Tag::ZigString | Tag::StaticZigString => String::init(
                self.as_zig().substring_with_len(start_index, end_index),
            ),
            Tag::WTFStringImpl => {
                let w = self.as_wtf();
                if w.is_8bit() {
                    String::init(ZigString::init(&w.latin1_slice()[start_index..end_index]))
                } else {
                    String::init(ZigString::init_utf16(&w.utf16_slice()[start_index..end_index]))
                }
            }
            _ => *self,
        }
    }

    /// `String.toUTF8` — borrowed-or-owned UTF-8 byte slice.
    /// - `WTFStringImpl`: refs the impl (Latin-1, all-ASCII) or transcodes (Latin-1/UTF-16 → owned).
    /// - `ZigString`: borrows (UTF-8) or transcodes (UTF-16/non-ASCII Latin-1).
    /// - `StaticZigString`: borrows always.
    pub fn to_utf8(&self) -> ZigStringSlice {
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().to_utf8(),
            Tag::ZigString => self.as_zig().to_slice(),
            Tag::StaticZigString => {
                ZigStringSlice::from_utf8_never_free(self.as_zig().slice())
            }
            _ => ZigStringSlice::EMPTY,
        }
    }
    pub fn to_utf8_without_ref(&self) -> ZigStringSlice {
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().to_utf8_without_ref(),
            Tag::ZigString => self.as_zig().to_slice(),
            Tag::StaticZigString => {
                ZigStringSlice::from_utf8_never_free(self.as_zig().slice())
            }
            _ => ZigStringSlice::EMPTY,
        }
    }
    /// Returns `Some(utf8_bytes)` only if this is already valid UTF-8 with no
    /// transcoding needed (string.zig:571 `asUTF8`).
    pub fn as_utf8(&self) -> Option<&[u8]> {
        match self.0.tag {
            Tag::WTFStringImpl => {
                let w = self.as_wtf();
                if w.is_8bit() && strings::is_all_ascii(w.latin1_slice()) {
                    Some(w.latin1_slice())
                } else { None }
            }
            Tag::ZigString | Tag::StaticZigString => {
                let z = self.as_zig();
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

    /// Port of `bun.String.githubAction` (string.zig). Returns a `Display`
    /// formatter that escapes the string for GitHub Actions annotation output
    /// (`%0A` for newlines, ANSI stripped). Encoding-aware: materialises a
    /// UTF-8 view inside `fmt` so 16-bit / WTF-backed strings are handled.
    #[inline]
    pub fn github_action(&self) -> StringGithubActionFormatter<'_> {
        StringGithubActionFormatter { text: self }
    }

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

    #[inline] pub fn is_dead(&self) -> bool { self.0.tag == Tag::Dead }

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
        if self.0.tag == Tag::WTFStringImpl {
            return self.dupe_ref();
        }
        if self.is_empty() {
            return Self::EMPTY;
        }
        if self.is_utf16() {
            let len = self.length();
            let (new, chars) = Self::create_uninitialized_utf16(len);
            if new.0.tag != Tag::Dead {
                // SAFETY: tag ≠ WTFStringImpl is excluded above so
                // `value.zig` is the active variant.
                chars.copy_from_slice(self.as_zig().utf16_slice());
            }
            return new;
        }
        Self::clone_utf8(self.byte_slice())
    }

    /// `bun.String.toZigString` — borrow as a `ZigString` (no ref taken).
    pub fn to_zig_string(&self) -> ZigString {
        match self.0.tag {
            Tag::ZigString | Tag::StaticZigString => *self.as_zig(),
            Tag::WTFStringImpl => {
                // Inherent `WTFStringImplStruct::to_zig_string` lives in
                // `bun_alloc` and returns the lower-tier `bun_alloc::ZigString`.
                // Both are `#[repr(C)] { *const u8, usize }` with identical
                // tag-bit semantics, so convert field-by-field.
                let z = self.as_wtf().to_zig_string();
                ZigString::from_tagged_ptr(z._unsafe_ptr_do_not_use, z.len)
            }
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
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().utf8_byte_length(),
            Tag::ZigString | Tag::StaticZigString => self.as_zig().utf8_byte_length(),
            Tag::Dead | Tag::Empty => 0,
        }
    }

    /// `bun.String.utf16ByteLength` — number of bytes the UTF-16LE encoding of
    /// `self` would occupy (string.zig:301).
    pub fn utf16_byte_length(&self) -> usize {
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().utf16_byte_length(),
            Tag::ZigString | Tag::StaticZigString => self.as_zig().utf16_byte_length(),
            Tag::Dead | Tag::Empty => 0,
        }
    }

    /// `bun.String.latin1ByteLength` — number of bytes the Latin-1 encoding of
    /// `self` would occupy (string.zig:309).
    pub fn latin1_byte_length(&self) -> usize {
        match self.0.tag {
            Tag::WTFStringImpl => self.as_wtf().latin1_byte_length(),
            Tag::ZigString | Tag::StaticZigString => self.as_zig().latin1_byte_length(),
            Tag::Dead | Tag::Empty => 0,
        }
    }

    /// `bun.String.toOwnedSliceZ` — allocate a NUL-terminated UTF-8 copy.
    pub fn to_owned_slice_z(&self) -> bun_core::ZBox {
        self.to_zig_string().to_owned_slice_z()
    }

    // `bun.String.encodeInto` / `bun.String.encode` — moved UP to
    // `bun_runtime::webcore::encoding::BunStringEncode` (extension trait).
    // The encoder bodies (`jsc.WebCore.encoding.{encodeIntoFrom8,16,
    // constructFromU8,U16}`) live in `bun_runtime`; defining the methods here
    // would invert the crate graph. See PORTING.md §Dep-cycle.

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
            return w::utf8(self.as_zig().slice());
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
            return w::utf8(self.as_zig().slice());
        }
        w::latin1(self.latin1())
    }

    /// `bun.String.isGlobal` (string.zig:63) — true iff this is a `ZigString`
    /// whose pointer is tagged as globally-allocated (mimalloc heap).
    #[inline]
    pub fn is_global(&self) -> bool {
        self.0.tag == Tag::ZigString && self.as_zig().is_globally_allocated()
    }

    /// `bun.String.createIfDifferent` (string.zig:117) — if `other` already
    /// holds `utf8_slice` verbatim (and is WTF-backed), return a `dupe_ref`;
    /// otherwise allocate a fresh WTF-backed copy of `utf8_slice`.
    pub fn create_if_different(other: &String, utf8_slice: &[u8]) -> String {
        if other.0.tag == Tag::WTFStringImpl && other.eql_utf8(utf8_slice) {
            return other.dupe_ref();
        }
        Self::clone_utf8(utf8_slice)
    }

    /// `bun.String.createAtomASCII` — same as [`create_atom`]; the Zig name
    /// documents the ASCII-only precondition (string.zig:265).
    #[inline]
    pub fn create_atom_ascii(s: &[u8]) -> Self { Self::create_atom(s) }

    /// `bun.String.initLatin1OrASCIIView` — borrow `value` as a Latin-1/ASCII
    /// 8-bit `ZigString` view without UTF-8-tagging it (string.zig:491).
    #[inline]
    pub fn init_latin1_or_ascii_view(value: &[u8]) -> Self {
        Self::init(ZigString::init(value))
    }

    /// `bun.String.encoding` (string.zig:594) — coarse encoding classifier.
    pub fn encoding(&self) -> strings::EncodingNonAscii {
        if self.is_utf16() {
            strings::EncodingNonAscii::Utf16
        } else if self.is_utf8() {
            strings::EncodingNonAscii::Utf8
        } else {
            strings::EncodingNonAscii::Latin1
        }
    }

    /// `bun.String.canBeUTF8` (string.zig:654) — true iff `self`'s 8-bit bytes
    /// are valid UTF-8 (i.e. either UTF-8-tagged or all-ASCII).
    pub fn can_be_utf8(&self) -> bool {
        match self.0.tag {
            Tag::WTFStringImpl => {
                let w = self.as_wtf();
                w.is_8bit() && strings::is_all_ascii(w.latin1_slice())
            }
            Tag::ZigString | Tag::StaticZigString => {
                let z = self.as_zig();
                if z.is_utf8() { return true; }
                !z.is_16bit() && strings::is_all_ascii(z.slice())
            }
            Tag::Empty => true,
            Tag::Dead => false,
        }
    }

    /// `bun.String.utf8` (string.zig:646) — raw UTF-8 byte slice. Debug-asserts
    /// `self` is a UTF-8-safe `ZigString`/`StaticZigString` (use [`as_utf8`] for
    /// the checked variant).
    #[inline]
    pub fn utf8(&self) -> &[u8] {
        debug_assert!(matches!(self.0.tag, Tag::ZigString | Tag::StaticZigString));
        debug_assert!(self.can_be_utf8());
        self.as_zig().slice()
    }

    /// `bun.String.toUTF8Owned` — like [`to_utf8_without_ref`] but guarantees
    /// the returned slice owns its buffer (string.zig:724).
    pub fn to_utf8_owned(&self) -> ZigStringSlice {
        self.to_utf8_without_ref().clone_if_borrowed()
    }

    /// `bun.String.toUTF8Bytes` — owned `Vec<u8>` of `self` as UTF-8
    /// (string.zig:729).
    #[inline]
    pub fn to_utf8_bytes(&self) -> Vec<u8> {
        self.to_utf8_owned().into_vec()
    }

    /// `bun.String.toOwnedSliceReturningAllASCII` (string.zig:81) — returns
    /// `(utf8_bytes, is_all_ascii)`. `false` means at least one non-ASCII byte.
    pub fn to_owned_slice_returning_all_ascii(&self) -> (Vec<u8>, bool) {
        match self.0.tag {
            Tag::ZigString | Tag::StaticZigString => {
                let bytes = self.as_zig().to_owned_slice();
                let ascii = strings::is_all_ascii(&bytes);
                (bytes, ascii)
            }
            Tag::WTFStringImpl => {
                let slice = self.as_wtf().to_utf8_without_ref();
                let ascii_status = match &slice {
                    // No allocation ⇒ 8-bit and all-ASCII (borrowed latin1).
                    ZigStringSlice::Static(..) => Some(true),
                    _ if self.as_wtf().is_8bit() => Some(false),
                    _ => None,
                };
                let bytes = slice.into_vec();
                let is_ascii = ascii_status.unwrap_or_else(|| strings::is_all_ascii(&bytes));
                (bytes, is_ascii)
            }
            Tag::Dead | Tag::Empty => (Vec::new(), true),
        }
    }

    /// `bun.String.toSlice` (string.zig:734) — consume `self` into a
    /// [`SliceWithUnderlyingString`], leaving `self` as [`EMPTY`].
    pub fn to_slice(&mut self) -> SliceWithUnderlyingString {
        let utf8 = self.to_utf8();
        let underlying = core::mem::replace(self, Self::EMPTY);
        SliceWithUnderlyingString {
            utf8,
            underlying,
            #[cfg(debug_assertions)]
            did_report_extra_memory_debug: false,
        }
    }

    /// `bun.String.toThreadSafeSlice` (string.zig:742) — like [`to_slice`] but
    /// guarantees the resulting buffer is safe to send to another thread.
    pub fn to_thread_safe_slice(&mut self) -> SliceWithUnderlyingString {
        if self.0.tag == Tag::WTFStringImpl {
            let wtf = self.as_wtf();
            let slice = wtf.to_utf8_without_ref();
            if !wtf.is_thread_safe() {
                // Either borrowed-ASCII (Static) or freshly-transcoded Owned —
                // in both cases we want an Owned copy detached from the impl.
                return SliceWithUnderlyingString {
                    utf8: slice.clone_if_borrowed(),
                    underlying: String::EMPTY,
                    #[cfg(debug_assertions)]
                    did_report_extra_memory_debug: false,
                };
            }
            // Thread-safe impl. If `slice` is borrowed (all-ASCII Latin-1),
            // re-use the impl's storage by taking two refs (one for `utf8`,
            // one for `underlying`).
            if let ZigStringSlice::Static(ptr, len) = slice {
                self.ref_();
                self.ref_();
                let string_impl = self.wtf_ptr();
                return SliceWithUnderlyingString {
                    utf8: ZigStringSlice::WTF { string_impl, ptr, len },
                    underlying: *self,
                    #[cfg(debug_assertions)]
                    did_report_extra_memory_debug: false,
                };
            }
            // Already cloned (Owned); drop the WTF backing to release memory.
            return SliceWithUnderlyingString {
                utf8: slice,
                underlying: String::EMPTY,
                #[cfg(debug_assertions)]
                did_report_extra_memory_debug: false,
            };
        }
        self.to_slice()
    }

    /// `bun.String.charAt` (string.zig:831) — code unit at `index`, widened to
    /// `u16` regardless of encoding. Caller must ensure `index < self.length()`.
    #[inline]
    pub fn char_at(&self, index: usize) -> u16 {
        debug_assert!(index < self.length());
        match self.0.tag {
            Tag::WTFStringImpl => {
                let w = self.as_wtf();
                if w.is_8bit() { w.latin1_slice()[index] as u16 } else { w.utf16_slice()[index] }
            }
            Tag::ZigString | Tag::StaticZigString => self.as_zig().char_at(index),
            _ => 0,
        }
    }

    /// `bun.String.indexOfAsciiChar` (string.zig:842).
    pub fn index_of_ascii_char(&self, chr: u8) -> Option<usize> {
        debug_assert!(chr < 128);
        if self.is_utf16() {
            self.utf16().iter().position(|&c| c == chr as u16)
        } else {
            strings::index_of_char_usize(self.byte_slice(), chr)
        }
    }

    /// `bun.String.eqlBytes` (string.zig:983) — raw byte-slice equality
    /// (encoding-unaware).
    #[inline]
    pub fn eql_bytes(&self, value: &[u8]) -> bool {
        strings::eql_long(self.byte_slice(), value, true)
    }

    /// `bun.String.toThreadSafeEnsureRef` (string.zig:1001) — like
    /// [`to_thread_safe`] but leaves the result with one extra ref.
    pub fn to_thread_safe_ensure_ref(&mut self) {
        if self.0.tag == Tag::WTFStringImpl {
            BunString__toThreadSafe(self);
            self.as_wtf().r#ref();
        }
    }

    /// `bun.String.estimatedSize` (string.zig:1021) — owned allocation size in
    /// bytes (not character count). `0` for static/empty/dead.
    pub fn estimated_size(&self) -> usize {
        match self.0.tag {
            Tag::Dead | Tag::Empty | Tag::StaticZigString => 0,
            Tag::ZigString => self.as_zig().len,
            Tag::WTFStringImpl => self.as_wtf().byte_length(),
        }
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
        Self::wrap_zig(Tag::ZigString, z)
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
        Self(bun_alloc::String { tag: Tag::WTFStringImpl, value: StringImpl { wtf_string_impl: wtf } })
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
// SAFETY: `String` is a tag + raw ptr to a `WTF::StringImpl` (or a borrowed
// `ZigString` slice / static / dead sentinel). All non-WTF tags are trivially
// `Send + Sync` (no interior mutability, no refcount). The WTF tag is the
// hazard: `WTF::StringImpl`'s refcount is non-atomic unless the impl was
// created thread-safe, so sending/sharing a non-thread-safe impl across
// threads and then `ref_()`/`deref()`ing it is a data race.
//
// We keep the blanket impls to match the Zig `bun.String` / C++ `BunString`
// FFI contract (the type must round-trip by value through `extern "C"` and sit
// in `Send + Sync` containers), and instead enforce the invariant at the
// boundary: any code that moves a `String` to another thread MUST first call
// [`String::to_thread_safe`] (or otherwise guarantee [`String::is_thread_safe`]
// returns `true`). [`String::debug_assert_thread_safe`] is the debug-build
// checkpoint for that hand-off; `to_thread_safe()` itself asserts its own
// postcondition. A `ThreadSafeString` newtype split would make this static,
// but is deferred until the FFI surface can be reshaped.
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
    /// View `&[OwnedString]` as `&[String]` for FFI sites that take a raw
    /// `*const BunString` array (e.g. `BunString__createArray`). Sound because
    /// `OwnedString` is `#[repr(transparent)]` over `String`; the borrow keeps
    /// every element alive for the call, and `Drop` still runs on the owning
    /// slice afterwards — the Rust spelling of Zig's
    /// `defer { for (items) |s| s.deref(); }` around `toJSArray`.
    #[inline]
    pub fn as_raw_slice(owned: &[OwnedString]) -> &[String] {
        // SAFETY: `#[repr(transparent)]` guarantees identical size/align/ABI
        // with the inner `String`; we only reborrow, never transfer ownership.
        unsafe { core::slice::from_raw_parts(owned.as_ptr().cast::<String>(), owned.len()) }
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
impl Default for OwnedString {
    #[inline]
    fn default() -> Self {
        Self(String::EMPTY)
    }
}
impl Clone for OwnedString {
    /// Bumps the WTF refcount (or copies a `ZigString` into a fresh
    /// WTF::StringImpl) and wraps the resulting +1 in a new `OwnedString`.
    /// Mirrors Zig's `s.clone()` followed by an implicit `defer deref` on the
    /// new value.
    #[inline]
    fn clone(&self) -> Self {
        Self(self.0.clone())
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

/// `Display` adapter for [`String::github_action`]. Converts to UTF-8 on the
/// fly (handles 16-bit / WTF-backed strings) and delegates to
/// `bun_core::fmt::github_action_writer`.
pub struct StringGithubActionFormatter<'a> {
    text: &'a String,
}
impl core::fmt::Display for StringGithubActionFormatter<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let utf8 = self.text.to_utf8_without_ref();
        bun_core::fmt::github_action_writer(f, utf8.slice())
    }
}

/// `Display` adapter for [`ZigString::github_action`]. Converts to UTF-8 on
/// the fly (handles 16-bit / latin-1 encodings) and delegates to
/// `bun_core::fmt::github_action_writer`.
pub struct ZigStringGithubActionFormatter {
    text: ZigString,
}
impl core::fmt::Display for ZigStringGithubActionFormatter {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let utf8 = self.text.to_slice();
        bun_core::fmt::github_action_writer(f, utf8.slice())
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
const ZS_STATIC_BIT: usize = 1usize << 60;
const ZS_UTF8_BIT: usize = 1usize << 61;
const ZS_GLOBAL_BIT: usize = 1usize << 62;
const ZS_16BIT_BIT: usize = 1usize << 63;
const ZS_UNTAG_MASK: usize = (1usize << 53) - 1;

/// `ZigString.as_()` — encoding-dispatched borrow.
pub enum ByteString<'a> {
    Latin1(&'a [u8]),
    Utf16(&'a [u16]),
}

impl Default for ZigString {
    #[inline]
    fn default() -> Self { Self::EMPTY }
}

impl ZigString {
    pub const EMPTY: Self = Self { ptr: b"".as_ptr(), len: 0 };

    #[inline]
    pub const fn is_empty(&self) -> bool { self.len == 0 }

    /// Construct from an already-tagged pointer + length pair. Exists so the
    /// `bun_jsc::ZigString` mirror (identical `#[repr(C)] { *const u8, usize }`,
    /// same tag-bit scheme) can convert field-by-field instead of `transmute`.
    /// `ptr` is stored verbatim — tag bits are not touched.
    #[inline]
    pub const fn from_tagged_ptr(ptr: *const u8, len: usize) -> Self {
        Self { ptr, len }
    }
    /// Raw tagged pointer (top-bit flags intact). Pair with
    /// [`from_tagged_ptr`]; do **not** dereference without [`untagged`].
    #[inline]
    pub const fn tagged_ptr(&self) -> *const u8 { self.ptr }

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
            // Ownership transferred to JSC: `mark_global()` tags the buffer so
            // `Zig::toString*` adopts it into a WTF string and `mi_free`s it on
            // string death. `heap::release` is the hand-off-to-foreign-owner
            // spelling (Zig `ZigString.dupeForJS` never frees `utf16` locally).
            let leaked: &'static mut [u16] = bun_core::heap::release(utf16.into_boxed_slice());
            let mut out = ZigString::init_utf16(leaked);
            out.mark_global();
            out.mark_utf16();
            Ok(out)
        } else {
            // Same hand-off: JSC owns the bytes, freed via `mi_free` on string death.
            let duped: &'static mut [u8] = bun_core::heap::release(Box::<[u8]>::from(utf8));
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
    #[inline] pub fn is_static(self) -> bool { (self.ptr as usize & ZS_STATIC_BIT) != 0 }
    #[inline] pub fn mark_utf8(&mut self) { self.ptr = (self.ptr as usize | ZS_UTF8_BIT) as *const u8; }
    #[inline] pub fn mark_utf16(&mut self) { self.ptr = (self.ptr as usize | ZS_16BIT_BIT) as *const u8; }
    #[inline] pub fn mark_global(&mut self) { self.ptr = (self.ptr as usize | ZS_GLOBAL_BIT) as *const u8; }
    #[inline] pub fn mark_static(&mut self) { self.ptr = (self.ptr as usize | ZS_STATIC_BIT) as *const u8; }

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

    /// `ZigString.utf16ByteLength` — number of bytes the UTF-16LE encoding of
    /// this string would occupy (ZigString.zig:199).
    pub fn utf16_byte_length(self) -> usize {
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

    /// `ZigString.latin1ByteLength` (ZigString.zig:211).
    pub fn latin1_byte_length(self) -> usize {
        if self.is_utf8() {
            // PORT NOTE: Zig: `@panic("TODO")` — never implemented for UTF-8
            // sources. Match Zig behaviour.
            unreachable!("ZigString.latin1ByteLength from UTF-8 — unimplemented in Zig");
        }
        self.len
    }

    // `ZigString.encodeWithAllocator` — moved UP to
    // `bun_runtime::webcore::encoding::ZigStringEncode` (extension trait); the
    // encoder bodies live in `bun_runtime`.

    /// Port of `ZigString.githubAction` (ZigString.zig). Returns a `Display`
    /// formatter that escapes the string for GitHub Actions annotation output
    /// (`%0A` for newlines, ANSI stripped). Encoding-aware via `to_slice`.
    #[inline]
    pub fn github_action(self) -> ZigStringGithubActionFormatter {
        ZigStringGithubActionFormatter { text: self }
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

    /// `ZigString.indexOfAny` (ZigString.zig:89) — first index whose code unit
    /// matches any byte in `chars`. The 16-bit branch narrows each unit to the
    /// Latin-1 range before comparing (mirrors Zig's comptime widening of the
    /// `[]const u8` needle to `u16` inside `strings.indexOfAny16`).
    pub fn index_of_any(self, chars: &'static [u8]) -> Option<usize> {
        if self.is_16bit() {
            self.utf16_slice()
                .iter()
                .position(|&c| c < 256 && chars.contains(&(c as u8)))
        } else {
            crate::strings::index_of_any(self.slice(), chars).map(|i| i as usize)
        }
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

    /// `ZigString.length` — alias for `len` field (matches Zig method).
    #[inline]
    pub const fn length(&self) -> usize { self.len }

    /// `ZigString.as` — encoding-dispatched borrow as either Latin-1 bytes or
    /// UTF-16 code units.
    #[inline]
    pub fn as_(&self) -> ByteString<'_> {
        if self.is_16bit() {
            ByteString::Utf16(self.utf16_slice_aligned())
        } else {
            ByteString::Latin1(self.slice())
        }
    }

    /// `ZigString.isAllASCII` — true iff every code unit is < 0x80.
    pub fn is_all_ascii(&self) -> bool {
        if self.is_16bit() {
            return strings::first_non_ascii16(self.utf16_slice_aligned()).is_none();
        }
        strings::is_all_ascii(self.slice())
    }

    /// `ZigString.hasPrefixChar` (ZigString.zig).
    pub fn has_prefix_char(&self, char: u8) -> bool {
        if self.len == 0 {
            return false;
        }
        if self.is_16bit() {
            return self.utf16_slice_aligned()[0] == char as u16;
        }
        self.slice()[0] == char
    }

    /// `ZigString.maxUTF8ByteLength` — upper bound on UTF-8 byte length
    /// (cheap; does not scan the string). UTF-16 → ×3, Latin-1 → ×2.
    pub fn max_utf8_byte_length(&self) -> usize {
        if self.is_utf8() {
            return self.len;
        }
        if self.is_16bit() {
            return self.utf16_slice_aligned().len() * 3;
        }
        self.len * 2
    }

    /// `ZigString.detectEncoding` — if the (currently-untagged) bytes contain
    /// any non-ASCII, mark the pointer as UTF-16. Mirrors ZigString.zig's
    /// `detectEncoding` (which assumes the bytes were sourced from a
    /// JS-produced 8-bit string and need re-widening on non-ASCII).
    #[inline]
    pub fn detect_encoding(&mut self) {
        if !strings::is_all_ascii(self.slice()) {
            self.mark_utf16();
        }
    }

    /// `ZigString.setOutputEncoding` — for `toJS`/`toExternalValue` callers:
    /// if 8-bit, run `detect_encoding`; if (now) 16-bit, mark UTF-8 so the
    /// C++ side decodes the bytes as UTF-8 instead of Latin-1.
    #[inline]
    pub fn set_output_encoding(&mut self) {
        if !self.is_16bit() {
            self.detect_encoding();
        }
        if self.is_16bit() {
            self.mark_utf8();
        }
    }

    /// `ZigString.deinitGlobal` — free the underlying buffer via mimalloc.
    /// Only valid when `is_globally_allocated()`.
    #[inline]
    pub fn deinit_global(&self) {
        // SAFETY: caller contract — `slice()` was allocated by global mimalloc.
        unsafe {
            bun_alloc::mimalloc::mi_free(
                self.slice().as_ptr().cast_mut().cast::<core::ffi::c_void>(),
            )
        };
    }

    /// `ZigString.full` — raw 8-bit byte view without the `u32::MAX` length
    /// clamp `slice()` applies.
    #[inline]
    pub fn full(&self) -> &[u8] {
        if self.len == 0 { return &[]; }
        // SAFETY: untagged ptr valid for `self.len` bytes (constructor invariant).
        unsafe { core::slice::from_raw_parts(Self::untagged(self.ptr), self.len) }
    }

    /// `ZigString.trimmedSlice` — `full()` with leading/trailing
    /// space/CR/LF stripped.
    #[inline]
    pub fn trimmed_slice(&self) -> &[u8] {
        strings::trim(self.full(), b" \r\n")
    }

    /// `ZigString.toSliceFast` — like `to_slice` but skips the Latin-1-to-UTF-8
    /// rescan for 8-bit inputs (caller asserts bytes are already valid UTF-8 /
    /// ASCII). 16-bit inputs still allocate a UTF-8 copy.
    pub fn to_slice_fast(&self) -> ZigStringSlice {
        if self.len == 0 {
            return ZigStringSlice::EMPTY;
        }
        if self.is_16bit() {
            return ZigStringSlice::Owned(self.to_owned_slice());
        }
        ZigStringSlice::Static(Self::untagged(self.ptr), self.len)
    }

    /// `ZigString.fromStringPointer` — borrow a sub-range of `buf` described by
    /// a `StringPointer` (offset + length).
    #[inline]
    pub fn from_string_pointer(ptr: StringPointer, buf: &[u8]) -> ZigString {
        ZigString {
            len: ptr.length as usize,
            ptr: buf[ptr.offset as usize..][..ptr.length as usize].as_ptr(),
        }
    }

    /// `ZigString.sortAsc` / `sortDesc` — in-place stable sort by 8-bit bytes.
    pub fn sort_asc(slice_: &mut [ZigString]) {
        slice_.sort_by(|a, b| a.slice().cmp(b.slice()));
    }
    pub fn sort_desc(slice_: &mut [ZigString]) {
        slice_.sort_by(|a, b| b.slice().cmp(a.slice()));
    }
    #[inline]
    pub fn cmp_asc(a: &ZigString, b: &ZigString) -> bool {
        strings::cmp_strings_asc(&(), a.slice(), b.slice())
    }
    #[inline]
    pub fn cmp_desc(a: &ZigString, b: &ZigString) -> bool {
        strings::cmp_strings_desc(&(), a.slice(), b.slice())
    }

    /// `ZigString.toSliceLowercase` — allocate a lowercased UTF-8 copy.
    pub fn to_slice_lowercase(&self) -> ZigStringSlice {
        if self.len == 0 {
            return ZigStringSlice::EMPTY;
        }
        let upper = self.to_owned_slice();
        let mut buffer = vec![0u8; upper.len()];
        let out_len = strings::copy_lowercase(&upper, &mut buffer).len();
        buffer.truncate(out_len);
        ZigStringSlice::Owned(buffer)
    }

    /// `ZigString.eqlCaseInsensitive` — slow path; allocates lowercased copies
    /// of both sides.
    pub fn eql_case_insensitive(&self, other: &ZigString) -> bool {
        let a = self.to_slice_lowercase();
        let b = other.to_slice_lowercase();
        strings::eql_long(a.slice(), b.slice(), true)
    }

    /// `ZigString.sliceZBuf` — `Display`-format into `buf`, NUL-terminate, and
    /// return the borrowed `[:0]u8`. Errors if the formatted output (plus NUL)
    /// would not fit.
    pub fn slice_z_buf<'a>(
        &self,
        buf: &'a mut bun_paths::PathBuffer,
    ) -> Result<&'a ZStr, bun_core::Error> {
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
        Ok(ZStr::from_buf(&buf[..], written))
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
            // `reserve_exact(1)` guarantees `cap >= len + 1`; write the
            // sentinel into spare capacity without bumping `len`.
            v.spare_capacity_mut()[0].write(0);
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
        // `reserve_exact(1)` guarantees `cap >= len + 1`; write the sentinel
        // into spare capacity without bumping `len` so `slice()` excludes it
        // while `as_ptr()` stays NUL-terminated.
        v.spare_capacity_mut()[0].write(0);
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
    /// `ZigString.Slice.cloneIfBorrowed` — if this slice borrows external
    /// storage (`Static`/`WTF`), allocate an owned copy; otherwise return
    /// `self` unchanged. The result is always safe to outlive the original
    /// backing.
    pub fn clone_if_borrowed(self) -> Self {
        match &self {
            Self::Owned(_) => self,
            _ => Self::Owned(self.slice().to_vec()),
        }
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
    pub fn into_vec(mut self) -> Vec<u8> {
        // For `Owned`, move the buffer out (leaving an empty Vec to drop
        // harmlessly). For `Static`/`WTF`, allocate a copy of the borrowed
        // bytes; the subsequent `Drop` of `self` releases the WTF ref (paired
        // with the ref taken in `to_latin1_slice`). Equivalent to the prior
        // `ManuallyDrop` + per-variant raw-read dance without any unsafe.
        if let Self::Owned(v) = &mut self {
            return core::mem::take(v);
        }
        self.slice().to_vec()
    }
}
impl Drop for ZigStringSlice {
    fn drop(&mut self) {
        if let Self::WTF { string_impl, .. } = *self {
            // SAFETY: constructor took a ref; we now release it.
            unsafe { (*string_impl).deref() }
        }
    }
}

/// `bun.SliceWithUnderlyingString` (string.zig:1035) — a UTF-8 byte view paired
/// with the `bun.String` that may back it. `utf8` is either a borrowed/owned
/// byte slice or empty; `underlying` is the `String` whose ref keeps `utf8`
/// alive when WTF-backed.
pub struct SliceWithUnderlyingString {
    pub utf8: ZigStringSlice,
    pub underlying: String,
    #[cfg(debug_assertions)]
    pub did_report_extra_memory_debug: bool,
}

impl Default for SliceWithUnderlyingString {
    #[inline]
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
    /// `isWTFAllocated` — true iff `utf8`'s allocator is the WTFStringImpl
    /// allocator (i.e. it borrows latin1 bytes out of a refcounted impl).
    #[inline]
    pub fn is_wtf_allocated(&self) -> bool {
        self.utf8.is_wtf_allocated()
    }

    /// `dupeRef` — bump `underlying`'s refcount; the new value's `utf8` is
    /// left empty (callers re-derive the slice from `underlying`).
    pub fn dupe_ref(&self) -> SliceWithUnderlyingString {
        SliceWithUnderlyingString {
            utf8: ZigStringSlice::EMPTY,
            underlying: self.underlying.dupe_ref(),
            #[cfg(debug_assertions)]
            did_report_extra_memory_debug: false,
        }
    }

    /// `fromUTF8` — wrap a borrowed UTF-8 slice (caller keeps it alive).
    /// Zig assumed `default_allocator`; Rust port uses `Static` (no free).
    #[inline]
    pub fn from_utf8(utf8: &[u8]) -> SliceWithUnderlyingString {
        SliceWithUnderlyingString {
            utf8: ZigStringSlice::from_utf8_never_free(utf8),
            underlying: String::DEAD,
            #[cfg(debug_assertions)]
            did_report_extra_memory_debug: false,
        }
    }

    /// `slice` — the UTF-8 byte view.
    #[inline]
    pub fn slice(&self) -> &[u8] {
        self.utf8.slice()
    }

    /// `deinit` — release `utf8`'s allocation (if any) and deref `underlying`.
    /// Explicit for parity with Zig call sites; `Drop` is intentionally not
    /// implemented because `underlying: String` is `Copy` (matches Zig manual
    /// `defer .deinit()` pattern).
    pub fn deinit(self) {
        // `utf8` drops via ZigStringSlice::Drop.
        self.underlying.deref();
    }

    /// `toThreadSafe` — if `underlying` is WTF-backed, migrate it to a
    /// thread-safe impl and re-derive `utf8` if it was a ref-counted view
    /// into the old impl (string.zig:1090).
    pub fn to_thread_safe(&mut self) {
        if self.underlying.0.tag == Tag::WTFStringImpl {
            let orig = self.underlying.wtf_ptr();
            self.underlying.to_thread_safe();
            let new = self.underlying.wtf_ptr();
            if new != orig {
                if self.utf8.is_wtf_allocated() {
                    self.utf8 = ZigStringSlice::EMPTY;
                    // `as_wtf()` derefs the live impl just installed by
                    // `to_thread_safe`; `to_latin1_slice` takes a ref for the view.
                    self.utf8 = self.underlying.as_wtf().to_latin1_slice();
                }
            }
        }
    }
}

impl core::fmt::Display for SliceWithUnderlyingString {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if self.utf8.length() == 0 {
            return self.underlying.fmt(f);
        }
        f.write_str(&std::string::String::from_utf8_lossy(self.utf8.slice()))
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

    /// `ZigString.Slice.cloneRef` — produce an independently-droppable copy
    /// of this slice that views the *same bytes*: `Static` is bitwise-copied,
    /// `WTF` bumps the StringImpl refcount, `Owned` deep-copies the buffer.
    ///
    /// Used by `PathLike::clone()` so a cloned path returns identical bytes
    /// from `slice()` (unlike `SliceWithUnderlyingString::dupe_ref`, which
    /// drops the utf8 view).
    pub fn clone_ref(&self) -> Self {
        match self {
            Self::Static(p, l) => Self::Static(*p, *l),
            Self::Owned(v) => Self::Owned(v.clone()),
            Self::WTF { string_impl, ptr, len } => {
                // SAFETY: invariant of the WTF variant is that `string_impl`
                // points at a live `WTF::StringImpl` for as long as `self`
                // exists; bumping its refcount yields a second owner whose
                // `Drop` will pair with this ref.
                unsafe { (**string_impl).r#ref() };
                Self::WTF { string_impl: *string_impl, ptr: *ptr, len: *len }
            }
        }
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

/// `bun.schema.api.StringPointer` — canonical definition lives in `bun_core`
/// (lowest tier); re-exported here so existing `bun_string::StringPointer`
/// callers (FFI sigs in `bun_jsc::FetchHeaders`, lockfile, sourcemap) keep
/// resolving.
pub use bun_core::StringPointer;

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
// `lexer` — identifier predicates. Thin `u32`-taking wrapper over the
// [`identifier`] two-stage Unicode tables (moved down from `bun_js_parser`).
// ──────────────────────────────────────────────────────────────────────────
pub mod lexer {
    #[inline]
    pub fn is_identifier_start(c: u32) -> bool {
        crate::identifier::is_identifier_start(c as i32)
    }
    #[inline]
    pub fn is_identifier_continue(c: u32) -> bool {
        crate::identifier::is_identifier_part(c as i32)
    }
    #[inline]
    pub fn is_identifier_part(c: u32) -> bool {
        is_identifier_continue(c)
    }
    /// Whole-string check. Port of `js_lexer.isIdentifier`.
    pub fn is_identifier(s: &[u8]) -> bool {
        if s.is_empty() {
            return false;
        }
        let iter = crate::strings::CodepointIterator::init(s);
        let mut cur = crate::strings::Cursor::default();
        if !iter.next(&mut cur) || !is_identifier_start(cur.c as u32) {
            return false;
        }
        while iter.next(&mut cur) {
            if !is_identifier_continue(cur.c as u32) {
                return false;
            }
        }
        true
    }
}

pub mod lexer_tables {
    /// Remap a strict-mode reserved word to its `_`-prefixed identifier, or
    /// `None` if `s` is not reserved.
    ///
    /// PERF(port): replaces the former `phf::Map<&[u8], &[u8]>`. 9 keys with
    /// ≤2 per length bucket — a `match` on `len()` then exact bytes rejects
    /// the overwhelming miss case on a single `usize` compare, vs. phf's
    /// hash + index + verify. See clap::find_param (12577e958d71) for the
    /// reference length-gated pattern.
    #[inline]
    pub fn strict_mode_reserved_words_remap(s: &[u8]) -> Option<&'static [u8]> {
        match s.len() {
            3 if s == b"let" => Some(b"_let"),
            5 if s == b"yield" => Some(b"_yield"),
            6 => match s {
                b"public" => Some(b"_public"),
                b"static" => Some(b"_static"),
                _ => None,
            },
            7 => match s {
                b"package" => Some(b"_package"),
                b"private" => Some(b"_private"),
                _ => None,
            },
            9 => match s {
                b"interface" => Some(b"_interface"),
                b"protected" => Some(b"_protected"),
                _ => None,
            },
            10 if s == b"implements" => Some(b"_implements"),
            _ => None,
        }
    }
}

/// `jsc::VirtualMachine::string_allocation_limit` (VirtualMachine.zig:14) —
/// process-wide WTF::StringImpl character-count cap, exported for C++ as
/// `Bun__stringSyntheticAllocationLimit`. The value lives here (not `bun_jsc`)
/// because [`String::max_length`] / `create_external*` need it without an
/// upward dep; `bun_jsc::VirtualMachine` writes it during init / via the
/// `setSyntheticAllocationLimitForTesting` hook.
#[unsafe(export_name = "Bun__stringSyntheticAllocationLimit")]
pub static STRING_ALLOCATION_LIMIT: AtomicUsize = AtomicUsize::new(u32::MAX as usize);

// ──────────────────────────────────────────────────────────────────────────
// move-in: printer (MOVE_DOWN ← src/js_printer/js_printer.zig)
//
// Self-contained string-quoting helpers used by `strings::format_escapes`,
// `bun_sourcemap::Chunk` (JSON serialization), and `bun_ast::Expr`.
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
        // Callers pass 2-byte-aligned even-length input for Utf16; `cast_slice`
        // panics (rather than UB) if that contract is violated.
        let text16: &[u16] = if encoding == StrEncoding::Utf16 {
            bun_core::cast_slice::<u8, u16>(text_in)
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
/// Sunk to `bun_core::ffi` so tier-1 crates (cares_sys, sys) can share it;
/// re-exported here for the existing `bun_string::slice_to_nul` callers.
pub use bun_core::ffi::{slice_to_nul, slice_to_nul_mut};

/// move-in: `cheap_prefix_normalizer` (MOVE_DOWN ← `bundle_v2.zig`).
///
/// Pure path-string helper used by the bundler chunk writer and `css::printer`.
/// Returns `[prefix', suffix']` such that concatenating them produces a
/// reasonably-normalized path (collapses `./` leading and avoids `//`).
/// Matches the .zig spec `[2]string` return shape so bundler call-sites can
/// index it directly.
pub fn cheap_prefix_normalizer<'a>(prefix: &'a [u8], suffix: &'a [u8]) -> [&'a [u8]; 2] {
    if prefix.is_empty() {
        let suffix_no_slash = strings::remove_leading_dot_slash(suffix);
        return [
            if strings::has_prefix_comptime(suffix_no_slash, b"../") { b"" } else { b"./" },
            suffix_no_slash,
        ];
    }

    // ["https://example.com/", "/out.js"]  => "https://example.com/out.js"
    // ["/foo/", "/bar.js"]                 => "/foo/bar.js"
    let win = bun_core::Environment::IS_WINDOWS;
    if strings::ends_with_char(prefix, b'/') || (win && strings::ends_with_char(prefix, b'\\')) {
        if strings::starts_with_char(suffix, b'/')
            || (win && strings::starts_with_char(suffix, b'\\'))
        {
            return [prefix, &suffix[1..]];
        }
        // It gets really complicated if we try to deal with URLs more than this
        // (see bundle_v2.zig comment block).
    }

    [prefix, strings::remove_leading_dot_slash(suffix)]
}

// Re-export `wtf::parse_double` at crate root (callers spell it `bun_str::parse_double`).
pub use wtf::parse_double;

/// [`Cell`]-shaped interior-mutable owned `BunString` slot. Layout-identical
/// to `Cell<String>` (`#[repr(transparent)]`) so it's a drop-in field
/// replacement in `#[repr(C)]` FFI structs (`Blob.name`, `Request.url`).
///
/// Unlike `Cell<String>`, [`set`] derefs the previous value and [`replace`]
/// returns an [`OwnedString`] — so the only way to leak a refcount is to
/// `mem::forget` the cell or its `replace` result. The R-2 `&self` migrations
/// introduced `Cell<String>::set(..)` calls that silently leaked the old +1.
///
/// [`get`] returns a bitwise `String` copy with **borrow** semantics (no ref
/// bump). Do NOT `.deref()` the returned value.
#[repr(transparent)]
#[derive(Default)]
pub struct OwnedStringCell(core::cell::Cell<String>);

impl OwnedStringCell {
    #[inline]
    pub const fn new(s: String) -> Self { Self(core::cell::Cell::new(s)) }
    #[inline]
    pub fn get(&self) -> String { self.0.get() }
    #[inline]
    pub fn set(&self, new: String) { self.0.replace(new).deref(); }
    #[inline]
    pub fn replace(&self, new: String) -> OwnedString { OwnedString(self.0.replace(new)) }
    #[inline]
    pub fn take(&self) -> OwnedString { OwnedString(self.0.replace(String::dead())) }
}

impl Drop for OwnedStringCell {
    #[inline]
    fn drop(&mut self) { self.0.get_mut().deref(); }
}

impl Clone for OwnedStringCell {
    #[inline]
    fn clone(&self) -> Self { Self::new(self.0.get().dupe_ref()) }
}
