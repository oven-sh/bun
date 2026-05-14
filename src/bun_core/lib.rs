#![feature(allocator_api)]
#![feature(adt_const_params)]
#![feature(macro_metavar_expr)] // `$$` in define_scoped_log! (nightly-2026-05-06)
#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use, unreachable_pub)]
// AUTOGEN: mod declarations only — real exports added in B-1.

pub mod Global;
pub mod atomic_cell;
pub mod hint;
pub mod result;
pub mod tty;
pub mod util;
pub mod thread_id;
pub use atomic_cell::{Atom, AtomicCell, ThreadCell};

/// Shared state-machine tag for the streaming (de)compressors in
/// `bun_brotli` / `bun_zlib` / `bun_zstd`. Mirrors the identical
/// `pub const State = enum { Uninitialized, Inflating, End, Error }`
/// nested in each Zig reader/compressor struct.
pub mod compress {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum State {
        Uninitialized,
        Inflating,
        End,
        Error,
    }
}
pub mod heap;

pub mod env;
#[cfg(windows)]
pub mod windows_sys;
pub mod wtf;

// ──────────────────────────────────────────────────────────────────────────
// `string` — the former `bun_string` crate, merged in to break the
// `bun_core ↔ bun_string` dep cycle. The `bun_string` crate is now a
// one-line re-export shim over this module.
// ──────────────────────────────────────────────────────────────────────────
pub mod string;
pub use ::bstr::{BStr, BString, ByteSlice};
/// `bun.strings` (the full SIMD-backed `immutable` module). Distinct from the
/// scalar-fallback `crate::strings` shim below — several names
/// (`index_of_char`, `CodepointIterator`, `Encoding`) differ in signature.
/// Callers that previously wrote `bun_core::strings::X` import this.
pub use string::immutable;
pub use string::string_joiner::StringJoiner;
pub use string::{
    ByteString, STRING_ALLOCATION_LIMIT, ZigStringGithubActionFormatter, cheap_prefix_normalizer,
    escape_reg_exp, identifier, lexer, lexer_tables, parse_double, printer, quote_for_json,
    string_joiner, write, zig_string,
};
pub use string::{
    HashedString, MutableString, NodeEncoding, OwnedString, OwnedStringCell, PathString,
    SliceWithUnderlyingString, SmolStr, String, StringBuilder, WTFStringImpl, WTFStringImplExt,
    WTFStringImplStruct, ZigString, ZigStringSlice,
};
pub use string::{StringPointer, Tag, slice_to_nul, slice_to_nul_mut};

// ──────────────────────────────────────────────────────────────────────────
// Low-tier homes for types the merged `string` module needs that previously
// lived in `bun_ptr` / `bun_collections` (both depend on `bun_core`, so the
// merge would otherwise cycle). The original crates re-export these.
// ──────────────────────────────────────────────────────────────────────────
pub mod external_shared;
pub use external_shared::{
    ExternalShared, ExternalSharedDescriptor, ExternalSharedOptional, WTFString,
};
pub mod bounded_array;
pub use bounded_array::{BoundedArray, BoundedArrayAligned};

/// Bit-cast between fn-pointer types. Replaces Zig `@ptrCast` on a function
/// pointer when erasing only the *pointee type* of one or more thin-pointer
/// parameters (e.g. `extern "C" fn(*mut Ctx, …)` ↔ `extern "C" fn(*mut c_void,
/// …)`). Const-generic `transmute` rejects fn types; an as-cast can't change
/// arity. This stays one audited helper and rejects non-pointer-sized
/// `F`/`G` at compile time — it does **not** verify that `F`/`G` are
/// fn-pointer types or that their arity/ABI match (all fn pointers are
/// pointer-sized regardless of arity); those remain caller contract.
///
/// # Safety
/// `F` and `G` must be fn-pointer types with the **same calling convention,
/// arity, and ABI** — they may differ only in the nominal pointee type of
/// thin-pointer parameters that the callee casts back before use.
#[inline(always)]
pub const unsafe fn cast_fn_ptr<F: Copy, G: Copy>(f: F) -> G {
    const {
        assert!(core::mem::size_of::<F>() == core::mem::size_of::<fn()>());
        assert!(core::mem::size_of::<G>() == core::mem::size_of::<fn()>());
        // `read` below pulls a `G` out of a stack slot aligned for `F`; rule
        // out under-alignment so the bitcast stays defined even if a caller
        // smuggles in a non-fn-ptr `Copy` type.
        assert!(core::mem::align_of::<F>() == core::mem::align_of::<fn()>());
        assert!(core::mem::align_of::<G>() == core::mem::align_of::<fn()>());
    }
    // SAFETY: caller contract — `F` and `G` are ABI-identical fn pointers.
    // `read` of a pointer-sized `Copy` value through a same-size cast is the
    // bitwise reinterpretation `@ptrCast` performs.
    unsafe { (&raw const f).cast::<G>().read() }
}

/// Non-owning borrowed slice whose backing storage outlives the holder.
///
/// Runtime sibling of `bun_ast::StoreSlice<T>` for `*const [T]` struct
/// fields. Same contract as `bun_ptr::BackRef`: the slice memory is owned
/// elsewhere (parent struct, leaked `Box`, interned string) and remains valid
/// for the holder's full lifetime. Stores a fat raw pointer (`*const [T]`,
/// `usize` len) so it is a byte-for-byte drop-in for the Phase-A `*const [T]`
/// fields it replaces.
#[repr(transparent)]
pub struct RawSlice<T>(*const [T]);

impl<T> RawSlice<T> {
    /// Empty slice (dangling, len 0). Safe to `.slice()`.
    pub const EMPTY: Self = RawSlice(core::ptr::slice_from_raw_parts(
        core::ptr::NonNull::<T>::dangling().as_ptr(),
        0,
    ));
    /// Wrap a borrowed slice. Safe: stores the raw pointer; the
    /// outlives-holder invariant is the caller's structural guarantee.
    #[inline]
    pub const fn new(s: &[T]) -> Self {
        RawSlice(core::ptr::from_ref(s))
    }
    /// Wrap a raw slice pointer.
    ///
    /// # Safety
    /// `p` must either be a (dangling, len 0) empty slice or point to `len`
    /// initialized `T` that remain live and stable for the lifetime of every
    /// `RawSlice` copied from the result.
    #[inline]
    pub const unsafe fn from_raw(p: *const [T]) -> Self {
        RawSlice(p)
    }
    #[inline]
    pub const fn as_ptr(self) -> *const [T] {
        self.0
    }
    #[inline]
    pub const fn len(self) -> usize {
        self.0.len()
    }
    #[inline]
    pub const fn is_empty(self) -> bool {
        self.0.len() == 0
    }
    /// Re-borrow as `&[T]`.
    ///
    /// # Safety (encapsulated)
    /// Sound under the `RawSlice` invariant: backing storage outlives the
    /// holder, so materialising `&[T]` tied to `&self` is valid. Elements are
    /// initialized and the data pointer is non-null (`EMPTY` uses a dangling
    /// non-null pointer with len 0, which `from_raw_parts` accepts).
    #[inline]
    pub fn slice(&self) -> &[T] {
        // SAFETY: RawSlice invariant — pointer is non-null (real allocation or
        // `NonNull::dangling()` for EMPTY), `len` elements are initialized and
        // live for at least `'_` (the holder's borrow). No exclusive alias is
        // live: `RawSlice` only ever vends shared `&[T]`.
        unsafe { &*self.0 }
    }
}
impl<T> Copy for RawSlice<T> {}
impl<T> Clone for RawSlice<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Default for RawSlice<T> {
    #[inline]
    fn default() -> Self {
        RawSlice::EMPTY
    }
}
impl<T> core::ops::Deref for RawSlice<T> {
    type Target = [T];
    #[inline]
    fn deref(&self) -> &[T] {
        self.slice()
    }
}
impl<T> AsRef<[T]> for RawSlice<T> {
    #[inline]
    fn as_ref(&self) -> &[T] {
        self.slice()
    }
}
impl<T> From<&[T]> for RawSlice<T> {
    #[inline]
    fn from(s: &[T]) -> Self {
        RawSlice::new(s)
    }
}
impl<T: core::fmt::Debug> core::fmt::Debug for RawSlice<T> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.slice().fmt(f)
    }
}
// SAFETY: `RawSlice<T>` only ever vends `&[T]` (never `&mut [T]` / owned `T`),
// so its auto-trait bounds follow `&[T]` exactly: `&[T]: Send ⇔ T: Sync` and
// `&[T]: Sync ⇔ T: Sync`. The wrapped raw pointer carries no ownership.
unsafe impl<T: Sync> Send for RawSlice<T> {}
unsafe impl<T: Sync> Sync for RawSlice<T> {}

/// Port of Zig's `std.os.environ` global (`[][*:0]u8`). On Windows the
/// startup path `bun_sys::windows::env::convert_env_to_wtf8` overwrites this
/// with a WTF-8-encoded envp slice; `getenvZ` and `bun_main` then read it via
/// `os_environ_ptr()`. POSIX builds leave it empty and use libc's `environ`.
#[cfg(windows)]
pub mod os {
    use core::ffi::c_char;

    // Stored as raw (ptr, len) — NOT `&'static mut [_]` — so `environ()` (which
    // hands out a shared `&[_]`) never aliases a live `&mut`. Zig's
    // `std.os.environ` is a plain slice global with no exclusivity guarantee;
    // mirroring that with `&'static mut` would be UB the moment a reader
    // borrows while a writer holds the swapped-out `&mut`.
    static mut ENVIRON: (*mut *mut c_char, usize) = (core::ptr::null_mut(), 0);

    /// Swap in a new envp slice; returns the previous (ptr, len) pair (Zig:
    /// `orig_environ = std.os.environ; std.os.environ = new`).
    /// SAFETY: single-threaded startup only.
    pub unsafe fn take_environ() -> (*mut *mut c_char, usize) {
        // `&raw mut` (no intermediate `&mut`) — `static_mut_refs` is hard-denied
        // under rust_2024_compatibility, and we never need a borrow here.
        unsafe { core::ptr::replace(&raw mut ENVIRON, (core::ptr::null_mut(), 0)) }
    }
    /// SAFETY: single-threaded startup only; `ptr` must be valid for `len`
    /// elements for the process lifetime (leaked allocation).
    pub unsafe fn set_environ(ptr: *mut *mut c_char, len: usize) {
        unsafe {
            core::ptr::write(&raw mut ENVIRON, (ptr, len));
        }
    }
    /// Borrowed view of the current envp slice (read side of `std.os.environ`).
    /// SAFETY: caller must not race with `set_environ`.
    pub unsafe fn environ() -> &'static [*mut c_char] {
        unsafe {
            let (p, n) = core::ptr::read(&raw const ENVIRON);
            if p.is_null() {
                &[]
            } else {
                core::slice::from_raw_parts(p, n)
            }
        }
    }
}

/// `bun.os_environ_ptr()` — pointer to the first element of `std.os.environ`
/// (or null if empty). Windows-only; POSIX uses libc's `environ` symbol.
#[cfg(windows)]
#[inline]
pub fn os_environ_ptr() -> *const *mut core::ffi::c_char {
    // SAFETY: read of a process-global written once at startup.
    let e = unsafe { os::environ() };
    if e.is_empty() {
        core::ptr::null()
    } else {
        e.as_ptr()
    }
}
pub mod deprecated;
pub mod env_var;
pub mod feature_flags;

/// Tier-0 path-separator predicates. Sunk from `bun_paths` so `bun_core::util`
/// (dirname, which) can use them without an upward dep. `bun_paths` re-exports
/// these as the canonical `is_sep_*` set.
pub mod path_sep {
    use crate::strings::PathByte;
    pub use bun_alloc::{SEP, SEP_STR};

    // ─── u8 const fns (kept const for match-guard / const-eval callers) ─────

    /// Zig: `bun.path.isSepAny` — `/` **or** `\` on every target.
    /// Use for parsing user-supplied / cross-platform path strings (tsconfig,
    /// archive entries, Windows drive prefixes).
    #[inline(always)]
    pub const fn is_sep_any(c: u8) -> bool {
        c == b'/' || c == b'\\'
    }

    /// Host-OS-native separator predicate: accepts `\` only when *compiled*
    /// for Windows. Use when matching against real on-disk paths (glob, joins,
    /// `which`, dirname).
    #[inline(always)]
    pub const fn is_sep_native(c: u8) -> bool {
        c == b'/' || (cfg!(windows) && c == b'\\')
    }

    // ─── PathByte-generic forms (u8 / u16) ──────────────────────────────────

    #[inline(always)]
    pub fn is_sep_posix_t<T: PathByte>(c: T) -> bool {
        c == T::from_u8(b'/')
    }

    #[inline(always)]
    pub fn is_sep_win32_t<T: PathByte>(c: T) -> bool {
        c == T::from_u8(b'\\')
    }

    #[inline(always)]
    pub fn is_sep_any_t<T: PathByte>(c: T) -> bool {
        c == T::from_u8(b'/') || c == T::from_u8(b'\\')
    }

    #[inline(always)]
    pub fn is_sep_native_t<T: PathByte>(c: T) -> bool {
        if cfg!(windows) { is_sep_any_t(c) } else { is_sep_posix_t(c) }
    }

    /// Host-OS-native absolute-path predicate (Zig: `std.fs.path.isAbsolute`).
    /// POSIX: leading `/`. Windows: leading `/` or `\`, or 3-byte `X:/`|`X:\`
    /// — faithful to Zig std: **no** alphabetic gate on the drive byte, and a
    /// bare `X:` with no trailing separator is **not** absolute.
    ///
    /// Sunk from `bun_paths::is_absolute` so tier-0 (`util::which`) and
    /// tier-2+ share a single impl.
    #[inline]
    pub const fn is_absolute_native(p: &[u8]) -> bool {
        #[cfg(not(windows))]
        {
            !p.is_empty() && p[0] == b'/'
        }
        #[cfg(windows)]
        {
            if p.is_empty() {
                return false;
            }
            if is_sep_any(p[0]) {
                return true;
            }
            p.len() >= 3 && p[1] == b':' && is_sep_any(p[2])
        }
    }
}

// ─── libm shims ───────────────────────────────────────────────────────────────
// Canonical extern for libm's `powf`/`pow` (Zig: `bun.zig` `pub extern "c" fn
// powf`). Hot CSS color-space conversion paths (gam_srgb, lab, prophoto) call
// the safe wrapper below; keep `#[inline]` so cross-crate use stays a direct
// libm call.
unsafe extern "C" {
    // safe: all args by-value; libm `powf` is defined for all f32 inputs.
    #[link_name = "powf"]
    safe fn libm_powf(x: f32, y: f32) -> f32;
    // safe: all args by-value; libm `pow` is defined for all f64 inputs.
    #[link_name = "pow"]
    safe fn libm_pow(x: f64, y: f64) -> f64;
}

#[inline]
pub fn powf(x: f32, y: f32) -> f32 {
    libm_powf(x, y)
}

#[inline]
pub fn pow(x: f64, y: f64) -> f64 {
    libm_pow(x, y)
}

/// Safe `Vec` growth helpers — consolidate the
/// `reserve(n); spare_capacity_mut(); MaybeUninit::write…; unsafe set_len(n)`
/// pattern (S025) so the single `unsafe { set_len }` lives here behind a
/// locally-proven invariant instead of being open-coded at every fill site.
pub mod vec {
    /// Extend `v` by `n` elements, each produced by `f(i)` for `i in 0..n`.
    ///
    /// Equivalent to `for i in 0..n { v.push(f(i)) }` but reserves once and
    /// writes through `spare_capacity_mut()` so no per-element capacity check
    /// or length bump occurs in the hot loop. Replaces the Zig-ported
    /// `reserve; ptr::write…; set_len` blocks where the fill is a pure
    /// per-index function (constant, default, or `i`-derived).
    ///
    /// Panic-safety: if `f` panics at index `k`, `v.len()` is left at its
    /// original value plus `k` — every exposed element is initialized, and the
    /// partially-written tail stays in spare capacity (never dropped).
    #[inline]
    pub fn extend_from_fn<T>(v: &mut Vec<T>, n: usize, mut f: impl FnMut(usize) -> T) {
        v.reserve(n);
        let prev = v.len();
        let spare = v.spare_capacity_mut();
        debug_assert!(spare.len() >= n);
        for (i, slot) in spare[..n].iter_mut().enumerate() {
            // `MaybeUninit::write` never drops the (uninitialized) prior
            // contents — it is a raw `ptr::write`.
            slot.write(f(i));
        }
        // SAFETY:
        // - `reserve(n)` guarantees `capacity >= prev + n`.
        // - Every slot in `spare[..n]` (i.e. `v[prev .. prev+n]`) was just
        //   initialized via `MaybeUninit::write` in the loop above, so the
        //   newly-exposed range contains only valid `T`.
        // Panic note: if `f` panics mid-loop, `len` is still `prev`, so the
        // already-written prefix stays in spare capacity and is *leaked* (not
        // dropped) — sound, and acceptable for the constant/`Default`/index
        // fills this helper targets.
        unsafe { v.set_len(prev + n) };
    }

    /// Append `n` copies of `value` to `v`. Zig: `std.ArrayList.appendNTimes` —
    /// `ensureUnusedCapacity(n); @memset(unusedCapacitySlice()[0..n], value); len += n`.
    ///
    /// Unlike `v.extend(repeat_n(value, n))` or a `for _ { v.push(value) }` loop,
    /// this reserves once and fills via `[MaybeUninit<T>]::fill` (lowers to
    /// `memset` for byte-sized `T`, vectorized stores for wider `Copy` types) —
    /// no per-element `RawVec` capacity branch in the hot loop.
    #[inline]
    pub fn push_n<T: Copy>(v: &mut Vec<T>, value: T, n: usize) {
        v.reserve(n);
        let prev = v.len();
        v.spare_capacity_mut()[..n].fill(core::mem::MaybeUninit::new(value));
        // SAFETY: `reserve(n)` ⇒ `spare_capacity_mut().len() >= n`, so `[..n]`
        // is in-bounds; every slot in it was just initialized via `fill`, and
        // `T: Copy` means no drop obligations are skipped.
        unsafe { v.set_len(prev + n) };
    }

    /// Extend `v` by `n` `T::default()` elements and return a mutable slice
    /// of the newly-appended tail (`&mut v[prev_len .. prev_len + n]`).
    ///
    /// Replaces the Zig-ported `reserve(n); set_len(len+n); &mut v[len..]`
    /// pattern (S022) where the tail is immediately overwritten by a clone/
    /// fill loop — the default-fill keeps every exposed `T` valid even if the
    /// caller bails partway through writing.
    #[inline]
    pub fn grow_default<T: Default>(v: &mut Vec<T>, n: usize) -> &mut [T] {
        let prev = v.len();
        extend_from_fn(v, n, |_| T::default());
        &mut v[prev..]
    }

    /// Reserve `additional`, advance `len` by `additional`, and return the
    /// newly-exposed (uninitialized) tail. Zig `ArrayList.addManyAsSlice`.
    /// Generic free-fn form of `bun_collections::VecExt::writable_slice` so
    /// `bun_core::string` can call it without a `bun_collections` edge.
    ///
    /// # Safety
    /// Caller must fully write the returned slice before any read of
    /// `v[prev_len..]` (the slots are uninitialized on entry).
    #[inline]
    pub unsafe fn writable_slice<T>(v: &mut Vec<T>, additional: usize) -> &mut [T] {
        v.reserve(additional);
        let prev = v.len();
        // SAFETY: caller contract — slice is fully written before any read.
        unsafe { v.set_len(prev + additional) };
        &mut v[prev..]
    }

    /// As [`writable_slice`] but skips `reserve`; caller must guarantee
    /// `len + additional <= capacity` (debug-asserted). Zig:
    /// `ArrayList.addManyAsSliceAssumeCapacity`.
    ///
    /// # Safety
    /// `v.len() + additional <= v.capacity()`, and the returned slice must be
    /// fully written before any read.
    #[inline]
    pub unsafe fn writable_slice_assume_capacity<T>(v: &mut Vec<T>, additional: usize) -> &mut [T] {
        debug_assert!(v.len() + additional <= v.capacity());
        let prev = v.len();
        // SAFETY: caller contract — capacity asserted; slice fully written before any read.
        unsafe { v.set_len(prev + additional) };
        &mut v[prev..]
    }

    /// Drop the first `n` elements of `v` in place via overlapping memmove
    /// (`copy_within(n.., 0)`) + `truncate`, retaining capacity. Equivalent
    /// to `v.drain(..n)` for `T: Copy` but without the iterator machinery.
    ///
    /// `n == 0` is a no-op; `n >= len` degenerates to `clear()` (capacity
    /// retained). All current callers are `Vec<u8>` ring/line buffers
    /// shifting a consumed prefix down after a partial write/parse — the Zig
    /// port open-coded `std.mem.copyForwards` + `items.len -= n` at every
    /// site.
    #[inline]
    pub fn drain_front<T: Copy, A: core::alloc::Allocator>(v: &mut Vec<T, A>, n: usize) {
        if n == 0 {
            return;
        }
        let len = v.len();
        if n >= len {
            v.clear();
            return;
        }
        v.copy_within(n.., 0);
        v.truncate(len - n);
    }

    // ── Zig `ArrayList(u8).unusedCapacitySlice()` family ──────────────────
    // The Zig stdlib has ONE helper and ~30 call sites; the Rust port had
    // grown 11 hand-rolled `spare_capacity_mut().as_mut_ptr().cast::<u8>()`
    // + `set_len(len+n)` copies because `spare_capacity_mut` returns
    // `MaybeUninit<u8>` and every C-ABI fill site (read/recv/pread, simdutf,
    // zlib, zstd, libdeflate, base64) needs `*mut u8` / `&mut [u8]`.

    /// View `v[len..capacity]` as a write-only `&mut [u8]` for an FFI /
    /// syscall producer to fill. Pair with [`commit_spare`] (or use
    /// [`fill_spare`] which does both).
    ///
    /// # Safety
    /// The returned bytes are **uninitialized**. Treat the slice as
    /// write-only: do not read it, and do not hand it to safe code that
    /// might. After the producer writes `n` bytes to the front of this
    /// slice, call [`commit_spare`]`(v, n)` to expose them.
    #[inline]
    pub unsafe fn spare_bytes_mut(v: &mut Vec<u8>) -> &mut [u8] {
        unsafe {
            let spare = v.spare_capacity_mut();
            // SAFETY: `MaybeUninit<u8>` and `u8` have identical layout; the slice
            // covers exactly `[len, capacity)` of `v`'s allocation. Caller upholds
            // the write-only contract above.
            core::slice::from_raw_parts_mut(spare.as_mut_ptr().cast::<u8>(), spare.len())
        }
    }

    /// `reserve(n)` then [`spare_bytes_mut`] — the libuv `uv_alloc_cb` shape
    /// (and the dominant call pattern at every C-ABI fill site that wants "at
    /// least `n` bytes of headroom"). Prefer this over `fill_spare` when the
    /// commit must happen on a separate control-flow arm from the obtain
    /// (e.g. across an `await`, or after an error-early-return).
    ///
    /// # Safety
    /// Same as [`spare_bytes_mut`].
    #[inline]
    pub unsafe fn reserve_spare_bytes(v: &mut Vec<u8>, n: usize) -> &mut [u8] {
        unsafe {
            v.reserve(n);
            spare_bytes_mut(v)
        }
    }

    /// View the **entire** allocation `v[0..capacity]` as `&mut [u8]` (Zig:
    /// `ArrayList.allocatedSlice()`). For the spare-only `[len..capacity]`
    /// view use [`spare_bytes_mut`].
    ///
    /// # Safety
    /// Bytes in `[len, capacity)` are uninitialized; treat that tail as
    /// write-only (same contract as [`spare_bytes_mut`]). The caller must not
    /// rely on the tail's prior contents.
    #[inline]
    pub unsafe fn allocated_bytes_mut(v: &mut Vec<u8>) -> &mut [u8] {
        let cap = v.capacity();
        // SAFETY: `as_mut_ptr()` returns a pointer valid for `cap` bytes of
        // the backing allocation; caller upholds the write-only contract on
        // the uninitialized tail.
        unsafe { core::slice::from_raw_parts_mut(v.as_mut_ptr(), cap) }
    }

    /// Advance `v.len()` by `n` after a producer has initialized the first
    /// `n` bytes of [`spare_bytes_mut`]`(v)`.
    ///
    /// # Safety
    /// `n <= v.capacity() - v.len()` and `v[len .. len+n]` must have been
    /// fully initialized (typically by the FFI/syscall that just returned `n`).
    #[inline]
    pub unsafe fn commit_spare(v: &mut Vec<u8>, n: usize) {
        unsafe {
            debug_assert!(n <= v.capacity() - v.len());
            v.set_len(v.len() + n);
        }
    }

    /// One-shot "reserve → hand spare bytes to producer → commit" combinator.
    ///
    /// If `min_spare > 0`, reserves at least that many spare bytes first.
    /// Calls `f` with the spare-capacity slice; `f` must return
    /// `(bytes_written, payload)` — `bytes_written` is committed via
    /// [`commit_spare`] and `payload` is returned to the caller. Return
    /// `(0, payload)` to commit nothing (e.g. on a producer error).
    ///
    /// # Safety
    /// Same as [`spare_bytes_mut`]: `f` receives a slice over uninitialized
    /// bytes and must treat it as write-only. The `bytes_written` it reports
    /// must not exceed the slice length and must cover only bytes `f`
    /// actually initialized.
    #[inline]
    pub unsafe fn fill_spare<R>(
        v: &mut Vec<u8>,
        min_spare: usize,
        f: impl FnOnce(&mut [u8]) -> (usize, R),
    ) -> R {
        unsafe {
            if min_spare > 0 {
                v.reserve(min_spare);
            }
            let (n, r) = f(spare_bytes_mut(v));
            commit_spare(v, n);
            r
        }
    }
}

// ── B-2 gate ── remaining heavy modules ────────────────────────────────────
#[path = "Progress.rs"]
pub mod Progress;
pub mod fmt;
#[path = "output.rs"]
pub mod output;

// `bun_core` (T0) cannot name `bun_sys` I/O primitives. Single-variant
// link-interface (owner is unused / null); `bun_sys` provides the `Sys` arm.
bun_dispatch::link_interface! {
    pub OutputSink[Sys] {
        fn stderr() -> output::File;
        fn make_path(cwd: Fd, dir: &[u8]) -> core::result::Result<(), Error>;
        fn create_file(cwd: Fd, path: &[u8]) -> core::result::Result<Fd, Error>;
        fn quiet_writer_from_fd(fd: Fd) -> output::QuietWriter;
        fn quiet_writer_adapt(qw: output::QuietWriter, buf: *mut u8, len: usize) -> output::QuietWriterAdapter;
        fn quiet_writer_flush(qw: &mut output::QuietWriter);
        fn quiet_writer_write_all(qw: &mut output::QuietWriter, bytes: &[u8]) -> bool;
        fn quiet_writer_fd(qw: &output::QuietWriter) -> Fd;
        fn tty_winsize(fd: Fd) -> Option<Winsize>;
        fn is_terminal(fd: Fd) -> bool;
        fn read(fd: Fd, buf: &mut [u8]) -> core::result::Result<usize, Error>;
    }
}

impl OutputSink {
    pub const SYS: Self = Self {
        kind: OutputSinkKind::Sys,
        owner: core::ptr::null_mut(),
    };
}

// `bun_core` (T0) cannot name `bun_errno` (cycle). Single-variant link-interface
// (owner is unused / null); `bun_errno` provides the `Sys` arm. Gives `result.rs`
// access to the per-OS `SystemErrno` strum table without duplicating it here.
bun_dispatch::link_interface! {
    pub ErrnoNames[Sys] {
        fn name(errno: i32) -> Option<&'static str>;
        fn max_dense() -> u32;
    }
}

impl ErrnoNames {
    pub const SYS: Self = Self {
        kind: ErrnoNamesKind::Sys,
        owner: core::ptr::null_mut(),
    };
}

/// Compile-time `<tag>` → ANSI rewrite (proc-macro). Re-exported at crate root
/// so `$crate::pretty_fmt!` resolves from the wrapper macros in `output.rs`.
pub use bun_core_macros::{EnumTag, pretty_fmt};

/// Stand-in for Zig's `@import("build_options")`. Real values are emitted by
/// `build.rs` via `env!()` in Phase C (link). Placeholder values let env.rs
/// const-evaluate cleanly.
pub mod build_options {
    /// `option_env!` with a fallback literal — same shape as Zig's
    /// `b.option(...) orelse default` in build.zig.
    macro_rules! build_opt {
        ($name:literal, $default:expr) => {
            match option_env!($name) {
                Some(v) => v,
                None => $default,
            }
        };
    }
    macro_rules! build_opt_bool {
        ($name:literal, $default:expr) => {
            match option_env!($name) {
                Some(v) => matches!(v.as_bytes(), b"true" | b"1"),
                None => $default,
            }
        };
    }

    /// `true` for the `release-assertions` profile (Zig: ReleaseSafe).
    pub const RELEASE_SAFE: bool = build_opt_bool!("BUN_RELEASE_SAFE", false);
    pub const REPORTED_NODEJS_VERSION: &str = build_opt!("BUN_REPORTED_NODEJS_VERSION", "24.0.0");
    pub const BASELINE: bool = build_opt_bool!("BUN_BASELINE", false);
    pub const SHA: &str = build_opt!("BUN_GIT_SHA", "0000000000000000000000000000000000000000");
    pub const IS_CANARY: bool = build_opt_bool!("BUN_IS_CANARY", false);
    pub const CANARY_REVISION: &str = build_opt!("BUN_CANARY_REVISION", "0");
    /// Repo root. Zig's build.zig passes `b.pathFromRoot(".")` (already
    /// normalized, native separators) — there is *no* fallback in the spec.
    /// `scripts/build/rust.ts` exports `BUN_BASE_PATH` for every build.
    ///
    /// The POSIX fallback derives it from this crate's manifest dir
    /// (`<repo>/src/bun_core`) so a bare `cargo check` still works for
    /// `runtime_embed_file!` (which goes through `PathBuf`, so the OS resolves
    /// `..`). On Windows that fallback is *wrong*: `CARGO_MANIFEST_DIR` is
    /// backslash-separated and concatenating `/../..` yields a mixed-separator,
    /// unnormalized path that crash_handler's byte-wise `starts_with` (which
    /// appends `SEP_STR` and compares against debug-info file paths) can never
    /// match — so require the env var there, matching the Zig contract.
    pub const BASE_PATH: &[u8] = match option_env!("BUN_BASE_PATH") {
        Some(v) => v.as_bytes(),
        // The fallback is correct on POSIX. On Windows it is mixed-separator
        // + unnormalized and crash_handler's byte-wise `starts_with` will
        // never match it — but real Windows builds always go through
        // `scripts/build/rust.ts` (which sets the env var). Kept so that bare
        // `cargo check --target *-windows-*` from a non-Windows host compiles.
        None => concat!(env!("CARGO_MANIFEST_DIR"), "/../..").as_bytes(),
    };
    pub const ENABLE_LOGS: bool = cfg!(debug_assertions);
    pub const ENABLE_ASAN: bool = cfg!(bun_asan);
    pub const ENABLE_FUZZILLI: bool = false;
    /// Whether `libtcc.a` is built and linked. Mirrors `cfg.tinycc` in
    /// `scripts/build/config.ts`: TinyCC is disabled on Windows/aarch64
    /// (TinyCC has no aarch64-pe-coff backend), Android, and FreeBSD (the
    /// vendored fork doesn't support those targets and the dep is skipped).
    /// Has to be a *compile-time* `false` on those targets — `ffi_body.rs`
    /// gates its `bun_tcc_sys::*` calls behind `if !ENABLE_TINYCC { return }`,
    /// and rustc only DCEs the `tcc_*` extern refs when the const folds; a
    /// runtime check would still leave undefined symbols at link.
    pub const ENABLE_TINYCC: bool = !cfg!(any(
        all(windows, target_arch = "aarch64"),
        target_os = "android",
        target_os = "freebsd",
    ));
    /// `<build>/codegen`. `scripts/build/rust.ts` exports `BUN_CODEGEN_DIR` to
    /// every crate's rustc env. POSIX fallback for bare `cargo check`; on
    /// Windows the `/../../` fallback is mixed-separator + unnormalized (see
    /// `BASE_PATH` above), so require the env var there.
    pub const CODEGEN_PATH: &[u8] = match option_env!("BUN_CODEGEN_DIR") {
        Some(v) => v.as_bytes(),
        // See BASE_PATH note re: Windows fallback being mixed-separator. Real
        // Windows builds set the env var; this only fires for cross-target
        // `cargo check`.
        None => concat!(env!("CARGO_MANIFEST_DIR"), "/../../build/debug/codegen").as_bytes(),
    };
    /// `cfg.version` from package.json, split by `scripts/build/rust.ts`.
    pub const VERSION: crate::Version = crate::Version {
        major: crate::const_parse_u32(build_opt!("BUN_VERSION_MAJOR", "1").as_bytes()),
        minor: crate::const_parse_u32(build_opt!("BUN_VERSION_MINOR", "3").as_bytes()),
        patch: crate::const_parse_u32(build_opt!("BUN_VERSION_PATCH", "0").as_bytes()),
    };
    /// Zig: `build_options.fallback_html_version` — hex-string hash of the
    /// fallback HTML bundle, injected by the build system. Placeholder until
    /// Phase C wires the real value via `env!()` in `build.rs`.
    pub const FALLBACK_HTML_VERSION: &str = match option_env!("BUN_FALLBACK_HTML_VERSION") {
        Some(v) => v,
        None => "0000000000000000",
    };
}

// ── re-exports (the tier-0 surface downstream crates need) ────────────────
pub use bun_alloc::oom_from_alloc;
pub use bun_alloc::{
    Alignment, AllocError, Allocator, is_slice_in_buffer, is_slice_in_buffer_t, out_of_memory,
    page_size, range_of_slice_in_buffer,
};
// FFI ABI-safety primitives — `bun_opaque` is the zero-dep `#![no_std]` crate
// that hosts both the opaque-handle macro and the layout-assert macro, so all
// "FFI shape invariant" tooling lives in one file. Re-exported here so callers
// can write `bun_core::assert_ffi_layout!(...)` without naming `bun_opaque`.
pub use Global::*;
pub use bun_opaque::{FfiLayout, assert_ffi_discr, assert_ffi_layout};
pub use ffi::{Zeroable, boxed_zeroed, boxed_zeroed_unchecked};
pub use result::*;
pub use tty::Winsize;
pub use util::*;

// ── intrusive-container parent recovery ───────────────────────────────────
//
// Port of Zig's parent-from-field intrinsic. Intrusive data structures (task
// queues, timer heaps, linked lists) hand callbacks a `*mut Field` and expect
// the callee to walk back to the owning `*mut Parent`. Phase-A open-coded this
// at ~150 sites as `ptr.cast::<u8>().sub(offset_of!(P, f)).cast::<P>()`; the
// helpers below are the single canonical spelling. Re-exported from `bun_ptr`.

/// Recover `*mut P` from a pointer to one of its fields.
///
/// Accepts `*const F` so both `*mut` and `*const` field pointers coerce in;
/// returns `*mut P` (which itself coerces to `*const P` at the binding site)
/// so callers pick mutability at the use, not here.
///
/// Prefer the [`from_field_ptr!`] macro, which computes `offset` via
/// `core::mem::offset_of!` so the field name is type-checked.
///
/// # Safety
/// - `field` must have been derived from a live `P` via
///   `addr_of!((*p).field)` / `addr_of_mut!` (or equivalent), so its
///   provenance covers the entire `P` allocation — a `&mut field` reborrow
///   does **not** suffice.
/// - `offset` must equal `offset_of!(P, <that field>)`.
#[inline(always)]
pub const unsafe fn container_of<P, F>(field: *const F, offset: usize) -> *mut P {
    // SAFETY: per fn contract — `field` is interior to a `P`; `byte_sub`
    // preserves provenance and yields the allocation base.
    unsafe { field.byte_sub(offset).cast::<P>().cast_mut() }
}

/// `*const`-out variant of [`container_of`]. Same safety contract.
#[inline(always)]
pub const unsafe fn container_of_const<P, F>(field: *const F, offset: usize) -> *const P {
    // SAFETY: per fn contract.
    unsafe { field.byte_sub(offset).cast::<P>() }
}

/// Recover a typed `&mut T` from a C-callback's opaque user-data pointer.
///
/// This is the canonical spelling for the ubiquitous trampoline pattern where
/// a C library (libarchive, c-ares, uWS, libuv, lol-html, BoringSSL, …) round-
/// trips a Rust object through a `void *user_data` slot and hands it back to
/// an `extern "C" fn` thunk. Phase-A open-coded this as
/// `unsafe { &mut *ctx.cast::<T>() }` at every site; centralising it here
/// makes the pattern grep-able, attaches a uniform safety contract, and
/// debug-asserts the non-null precondition the C side guarantees.
///
/// Re-exported from `bun_ptr` so callers can spell `bun_ptr::callback_ctx`.
///
/// # Safety
/// - `ctx` must be non-null, properly aligned, and point to a live, fully
///   initialised `T` for the entire returned lifetime `'a` (i.e. the body of
///   the callback). The C library round-tripped the exact `*mut T` the Rust
///   side registered, so type and provenance are correct by construction.
/// - No other `&mut T` (or `&T` overlapping a mutated field) may be live for
///   `'a`. C-callback user-data satisfies this on the runtime's single-
///   threaded event loop: the callback is the unique re-entry point for `*ctx`
///   while it runs. **Do not** use this for arbitrary pointer reinterpretation
///   (struct-layout punning, lifetime laundering) — that is not the contract.
#[inline(always)]
#[track_caller]
pub unsafe fn callback_ctx<'a, T>(ctx: *mut core::ffi::c_void) -> &'a mut T {
    debug_assert!(!ctx.is_null(), "callback_ctx: null user-data pointer");
    // SAFETY: per fn contract — `ctx` is the `*mut T` the caller registered as
    // C user-data, non-null, live, and exclusively accessed for `'a`.
    unsafe { &mut *ctx.cast::<T>() }
}

/// `from_field_ptr!(Parent, field, ptr)` → `*mut Parent`.
///
/// Type-checked wrapper over [`container_of`]: expands to
/// `container_of::<Parent, _>(ptr, offset_of!(Parent, field))`. The call is
/// `unsafe` (caller asserts `ptr` points at `Parent.field` with whole-`Parent`
/// provenance) and must appear inside an `unsafe` block.
#[macro_export]
macro_rules! from_field_ptr {
    ($Parent:ty, $field:ident, $ptr:expr $(,)?) => {
        $crate::container_of::<$Parent, _>($ptr, ::core::mem::offset_of!($Parent, $field))
    };
}

/// Stamp `@fieldParentPtr`-style back-reference accessors on a child type that
/// is **only ever constructed as the `$field` field of `$Parent`**.
///
/// Five forms (mix-and-match is not supported; pick the one matching the call
/// site's receiver/return contract):
/// ```ignore
/// // (1) ref + raw-mut pair         (&self -> &P ; &mut self -> *mut P)
/// bun_core::impl_field_parent! { Assets => DevServer.assets; pub fn owner; fn owner_mut; }
///
/// // (2) ref-only                   (&self -> &P)
/// bun_core::impl_field_parent! { SubscriptionCtx => JSValkeyClient._subscription_ctx; fn parent; }
///
/// // (3) mut-only                   (&mut self -> *mut P)
/// bun_core::impl_field_parent! { DirectoryWatchStore => DevServer.directory_watchers; fn mut owner; }
///
/// // (4) nonnull                    (&mut self -> NonNull<P>)
/// bun_core::impl_field_parent! { Execution => BunTest.execution; fn nonnull bun_test; }
///
/// // (5) raw                        (&self -> *mut P)
/// bun_core::impl_field_parent! { FileReader => Source.context; pub fn raw parent; }
/// ```
///
/// The mut accessor returns `*mut $Parent` (NOT `&mut`) because `self` is a
/// field of `$Parent` — materializing `&mut $Parent` while `&mut self` is live
/// would alias. Callers dereference under `unsafe` and must only touch fields
/// disjoint from `$field`.
///
/// # Safety
/// Expanding this macro asserts that **every** `$Child` instance lives at
/// `$Parent.$field` for its entire lifetime. If `$Child` can exist
/// standalone, the generated accessors are unsound; keep a hand-rolled
/// `pub unsafe fn` instead.
#[macro_export]
macro_rules! impl_field_parent {
    // ref + raw-mut pair
    ($Child:ty => $Parent:ident . $field:ident ; $v:vis fn $ref_name:ident ; $vm:vis fn $mut_name:ident ;) => {
        impl $Child {
            #[inline]
            $v fn $ref_name(&self) -> &$Parent {
                // SAFETY: macro contract — `self` is the `$field` field of a
                // live `$Parent`; recovering the parent and reborrowing as `&`
                // for the lifetime of `&self` is sound.
                unsafe { &*$crate::from_field_ptr!($Parent, $field, ::core::ptr::from_ref(self)) }
            }
            #[inline]
            $vm fn $mut_name(&mut self) -> *mut $Parent {
                // SAFETY: macro contract — pointer arithmetic only; no
                // reference is formed here.
                unsafe { $crate::from_field_ptr!($Parent, $field, ::core::ptr::from_mut(self)) }
            }
        }
    };
    // ref-only
    ($Child:ty => $Parent:ident . $field:ident ; $v:vis fn $ref_name:ident ;) => {
        impl $Child {
            #[inline]
            $v fn $ref_name(&self) -> &$Parent {
                // SAFETY: macro contract — see two-arm form above.
                unsafe { &*$crate::from_field_ptr!($Parent, $field, ::core::ptr::from_ref(self)) }
            }
        }
    };
    // mut-only:  (&mut self) -> *mut $Parent
    ($Child:ty => $Parent:ident . $field:ident ; $v:vis fn mut $name:ident ;) => {
        impl $Child {
            #[inline]
            $v fn $name(&mut self) -> *mut $Parent {
                // SAFETY: macro contract — pointer arithmetic only.
                unsafe { $crate::from_field_ptr!($Parent, $field, ::core::ptr::from_mut(self)) }
            }
        }
    };
    // nonnull:  (&mut self) -> NonNull<$Parent>
    ($Child:ty => $Parent:ident . $field:ident ; $v:vis fn nonnull $name:ident ;) => {
        impl $Child {
            #[inline]
            $v fn $name(&mut self) -> ::core::ptr::NonNull<$Parent> {
                // SAFETY: macro contract — `self` is non-null, so the
                // recovered parent pointer is too.
                unsafe {
                    ::core::ptr::NonNull::new_unchecked(
                        $crate::from_field_ptr!($Parent, $field, ::core::ptr::from_mut(self)),
                    )
                }
            }
        }
    };
    // raw:  (&self) -> *mut $Parent  (read-only receiver, raw out — for FFI
    // callback shapes that round-trip through `*const Self` but need a
    // `*mut Parent` without forming an aliased `&mut`)
    ($Child:ty => $Parent:ident . $field:ident ; $v:vis fn raw $name:ident ;) => {
        impl $Child {
            #[inline]
            $v fn $name(&self) -> *mut $Parent {
                // SAFETY: macro contract — pointer arithmetic only; the
                // returned pointer is not dereferenced here.
                unsafe {
                    $crate::from_field_ptr!($Parent, $field, ::core::ptr::from_ref(self).cast_mut())
                }
            }
        }
    };
}

// ─── IntrusiveField<F> ──────────────────────────────────────────────────────

/// Declares that `Self` embeds exactly one intrusive `F` field at byte
/// [`OFFSET`](IntrusiveField::OFFSET). This is the single Rust analogue of
/// Zig's `@fieldParentPtr` builtin: every per-module `const X_OFFSET: usize`
/// trait the Phase-A port grew (`TASK_OFFSET`, `MIXIN_OFFSET`,
/// `CHANNEL_OFFSET`, `LazyBool<_, const OFFSET>`, `from_task`, …) is the same
/// `(Parent, Field, OFFSET)` triple plus [`container_of`] arithmetic — this
/// trait is exactly that triple, with both directions provided.
///
/// Implement via [`intrusive_field!`]; the trait is `unsafe` because
/// [`from_field_ptr`](IntrusiveField::from_field_ptr) trusts the offset to
/// recover a `*mut Self` from a `*mut F` without any runtime check.
pub unsafe trait IntrusiveField<F>: Sized {
    /// `offset_of!(Self, <field>)`.
    const OFFSET: usize;

    /// Project `&mut self` → `&mut self.<field>`.
    #[inline(always)]
    fn field_mut(&mut self) -> &mut F {
        // SAFETY: `OFFSET` is `offset_of!(Self, <field>)` per impl contract;
        // `&mut self` covers the whole `Self`, so the field reborrow is in-bounds
        // and uniquely borrowed for the returned lifetime.
        unsafe { &mut *core::ptr::from_mut(self).byte_add(Self::OFFSET).cast::<F>() }
    }

    /// `*mut Self` → `*mut self.<field>` (Zig: `&self.<field>` from raw `*Self`).
    ///
    /// # Safety
    /// `this` must point at (or one-past) a valid `Self` allocation so the
    /// `byte_add` stays in-bounds.
    #[inline(always)]
    unsafe fn field_of(this: *mut Self) -> *mut F {
        // SAFETY: per fn contract.
        unsafe { this.byte_add(Self::OFFSET).cast::<F>() }
    }

    /// Recover `*mut Self` from a pointer to its embedded `F` (Zig:
    /// `@fieldParentPtr`). Thin wrapper over [`container_of`].
    ///
    /// # Safety
    /// `field` must point at the `<field>` of a live `Self` with
    /// whole-`Self` provenance.
    #[inline(always)]
    unsafe fn from_field_ptr(field: *mut F) -> *mut Self {
        // SAFETY: per fn contract.
        unsafe { container_of::<Self, F>(field, Self::OFFSET) }
    }
}

/// Stamp `unsafe impl IntrusiveField<$F> for $T { const OFFSET = offset_of!($T, $field); }`.
///
/// ```ignore
/// bun_core::intrusive_field!(ShellCpTask, task: ShellTask);
/// bun_core::intrusive_field!([T: Send] Wrapper<T>, inner: Mixin<Wrapper<T>>);
/// ```
#[macro_export]
macro_rules! intrusive_field {
    // Bracketed-generics arm MUST come first: the bare `$T:ty` arm below would
    // otherwise try to parse `['a]` as a slice type and hard-error on the
    // lifetime before backtracking to this arm.
    ([$($gen:tt)*] $T:ty, $field:ident : $F:ty) => {
        unsafe impl<$($gen)*> $crate::IntrusiveField<$F> for $T {
            const OFFSET: usize = ::core::mem::offset_of!($T, $field);
        }
    };
    ($T:ty, $field:ident : $F:ty) => {
        unsafe impl $crate::IntrusiveField<$F> for $T {
            const OFFSET: usize = ::core::mem::offset_of!($T, $field);
        }
    };
}

/// `bun_core::OOM` per PORTING.md type map (`OOM!T` → `Result<T, OOM>`).
pub type OOM = AllocError;

/// `bun.JSError` — the canonical JS error union (`error{JSError, OutOfMemory, JSTerminated}`
/// in Zig). Tier-0 so every layer of the runtime can name it directly; `bun_jsc` re-exports
/// it as `bun_jsc::JsError` and `bun_event_loop` re-exports it as `ErasedJsError` for
/// historical call sites.
///
/// `#[repr(u8)]` with explicit discriminants: `AnyTask` stores
/// `fn(*mut c_void) -> Result<(), JsError>` and the dispatcher relies on the 1-byte layout
/// surviving the type-erased round-trip.
#[repr(u8)]
#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub enum JsError {
    /// A JavaScript exception is pending in the VM's exception scope.
    Thrown = 0,
    /// Allocation failure; caller must throw an `OutOfMemoryError`.
    OutOfMemory = 1,
    /// The VM is terminating (worker shutdown / `process.exit`).
    Terminated = 2,
}

bun_alloc::oom_from_alloc!(JsError);

impl From<crate::Error> for JsError {
    fn from(_: crate::Error) -> Self {
        // PORT NOTE: Zig coerces arbitrary `anyerror` into the JS error union by
        // throwing a generic Error; the throw happens at the call site. Mapping
        // to `Thrown` here lets `?` propagate while the actual throw is handled
        // by the host-fn wrapper.
        JsError::Thrown
    }
}

impl From<JsError> for crate::Error {
    /// Widen a `bun.JSError` value back into the `anyerror` newtype. Preserves
    /// the exact Zig tag (`@errorName`) so call sites that round-trip through
    /// `bun_core::Error` (e.g. the `bun_bundler::dispatch::DevServerVTable`
    /// boundary) keep `error.OutOfMemory` distinguishable from `error.JSError`.
    #[inline]
    fn from(e: JsError) -> Self {
        match e {
            JsError::OutOfMemory => crate::err!("OutOfMemory"),
            // `Terminated` is a Rust-port addition (worker shutdown); it has no
            // distinct Zig `error.` tag, so collapse into `JSError` like every
            // other thrown JS exception.
            JsError::Thrown | JsError::Terminated => crate::err!("JSError"),
        }
    }
}

/// Zig `bun.concat(T, dest, &.{ a, b, ... })` — write `parts` consecutively
/// into `dest` and return the written prefix as a mutable slice. Panics if
/// `sum(parts.len()) > dest.len()` (matches Zig `@memcpy` length assert).
#[inline]
pub fn concat_into<'b, T: Copy>(dest: &'b mut [T], parts: &[&[T]]) -> &'b mut [T] {
    let mut off = 0;
    for p in parts {
        dest[off..off + p.len()].copy_from_slice(p);
        off += p.len();
    }
    &mut dest[..off]
}

/// Zig `std.mem.concat(allocator, T, &.{...})` / `bun.strings.concat` — allocate
/// a fresh `Box<[T]>` holding all `parts` joined. No zero-init: `extend_from_slice`
/// is `memcpy`-specialized for `T: Copy`, so no `Default` bound is required.
#[inline]
pub fn concat_boxed<T: Copy>(parts: &[&[T]]) -> Box<[T]> {
    let len: usize = parts.iter().map(|p| p.len()).sum();
    let mut v: Vec<T> = Vec::with_capacity(len);
    for p in parts {
        v.extend_from_slice(p);
    }
    v.into_boxed_slice()
}

/// Back-compat alias for the original `u8`-only buffer-concat. New code should
/// call [`concat_into`] directly.
#[inline]
pub fn concat<'b>(buf: &'b mut [u8], parts: &[&[u8]]) -> &'b [u8] {
    concat_into(buf, parts)
}

/// Zig `bun.assertf(cond, fmt, args)` — debug-only formatted assert.
#[macro_export]
macro_rules! assertf {
    ($cond:expr, $($arg:tt)*) => { ::core::debug_assert!($cond, $($arg)*) };
}

/// Zig `union(enum)` field projection — `data.file`, `chunk.content.javascript`.
///
/// In safety-checked Zig builds, reading a tagged-union field on the wrong
/// active variant panics at runtime. The Rust port hand-wrote ~20 identical
/// `match self { Self::V(x) => x, _ => unreachable!() }` accessors across
/// `jsc` / `bundler` / `ini` / `resolver` / `ast` / `install`; this macro is
/// the 1:1 analogue. Invoke it *inside* an `impl Enum { ... }` block:
///
/// ```ignore
/// impl Data {
///     bun_core::enum_unwrap!(pub Data, File  => fn as_file  / as_file_mut  -> File);
///     bun_core::enum_unwrap!(pub Data, Bytes => fn as_bytes / as_bytes_mut -> Bytes);
/// }
/// impl<'b> PrepareResult<'b> {
///     bun_core::enum_unwrap!(PrepareResult, Value => into fn into_value -> Expr);
/// }
/// ```
///
/// The `&`/`&mut` arm returns `&$Out` / `&mut $Out`, so when the variant
/// payload is itself a reference (e.g. `Entries(&'static mut DirEntry)`),
/// auto-deref/reborrow coerces `&&mut T` → `&T` and `&mut &mut T` → `&mut T`
/// to satisfy the declared return type.
#[macro_export]
macro_rules! enum_unwrap {
    ($vis:vis $Enum:ident, $Variant:ident => fn $get:ident / $get_mut:ident -> $Out:ty) => {
        #[inline]
        #[track_caller]
        $vis fn $get(&self) -> &$Out {
            match self {
                $Enum::$Variant(__x) => __x,
                #[allow(unreachable_patterns)]
                _ => ::core::unreachable!(
                    ::core::concat!(::core::stringify!($Enum), "::", ::core::stringify!($get),
                                    " on non-", ::core::stringify!($Variant), " variant")
                ),
            }
        }
        #[inline]
        #[track_caller]
        $vis fn $get_mut(&mut self) -> &mut $Out {
            match self {
                $Enum::$Variant(__x) => __x,
                #[allow(unreachable_patterns)]
                _ => ::core::unreachable!(
                    ::core::concat!(::core::stringify!($Enum), "::", ::core::stringify!($get_mut),
                                    " on non-", ::core::stringify!($Variant), " variant")
                ),
            }
        }
    };
    ($vis:vis $Enum:ident, $Variant:ident => into fn $into:ident -> $Out:ty) => {
        #[inline]
        #[track_caller]
        $vis fn $into(self) -> $Out {
            match self {
                $Enum::$Variant(__x) => __x,
                #[allow(unreachable_patterns)]
                _ => ::core::unreachable!(
                    ::core::concat!(::core::stringify!($Enum), "::", ::core::stringify!($into),
                                    " on non-", ::core::stringify!($Variant), " variant")
                ),
            }
        }
    };
}

/// Zig: `bun.handleOom(expr)` — unwrap a `Result`, calling `outOfMemory()` on
/// `Err`. The full multi-arm version (which narrows mixed error sets) lives in
/// `bun_crash_handler::handle_oom`; that crate sits *above* `bun_core` in the
/// dep graph, so this tier-0 alias is the OOM-only arm — sufficient for the
/// `Result<T, AllocError>` / `Result<T, Error>` callers in `js_parser`,
/// `bake/DevServer`, etc. that spell it `bun_core::handle_oom`.
#[inline]
#[track_caller]
pub fn handle_oom<T, E>(r: core::result::Result<T, E>) -> T {
    match r {
        Ok(v) => v,
        Err(_) => out_of_memory(),
    }
}

/// Extension-method form of [`handle_oom`]: `.unwrap_or_oom()` on any
/// `Result<T, E>`. Zig: `expr catch bun.outOfMemory()` — the *loose* idiom
/// that panics on **any** `Err`, not just OOM-only error sets. For the
/// Zig-faithful narrowing version (`bun.handleOom` with comptime error-set
/// reflection) see `bun_crash_handler::HandleOom`.
///
/// PORT NOTE: this is intentionally a blanket `impl<T, E>` — it matches the
/// existing `bun_core::handle_oom` free fn and the two pre-existing local
/// blanket impls in `run_command.rs` / `valkey.rs`. Callers that want a strict
/// `error{OutOfMemory}`-only whitelist should use `bun_crash_handler::HandleOom`
/// instead.
pub trait UnwrapOrOom {
    type Output;
    fn unwrap_or_oom(self) -> Self::Output;
}
impl<T, E> UnwrapOrOom for core::result::Result<T, E> {
    type Output = T;
    #[inline]
    #[track_caller]
    fn unwrap_or_oom(self) -> T {
        handle_oom(self)
    }
}

/// Zig: `bun.handleErrorReturnTrace(err, @errorReturnTrace())` — captures the
/// Zig error-return trace for crash reporting. Rust has no `@errorReturnTrace()`
/// builtin (panics already carry a backtrace), so this tier-0 shim is a no-op
/// that keeps call-site shape; the real reporter lives above in
/// `bun_crash_handler::handle_error_return_trace`.
#[inline(always)]
pub fn handle_error_return_trace<E>(_err: E) {}

// Real `declare_scope!`/`scoped_log!`/`pretty*!`/`warn!`/`note!` are
// `#[macro_export]`ed from output.rs.

/// Zig: `bun.todoPanic(@src(), fmt, args)`. Intentional *runtime* "feature not
/// yet implemented" path that the Zig source ships with — distinct from a
/// porting placeholder. Captures file/line via `file!()`/`line!()` (the
/// `@src()` equivalent) and routes through `Output::panic`.
// TODO(port): wire `bun_analytics::Features::todo_panic` once the analytics
// crate is reachable from bun_core without a dep cycle.
#[macro_export]
macro_rules! todo_panic {
    ($($arg:tt)*) => {{
        $crate::output::panic(::core::format_args!(
            "TODO: {} ({}:{})",
            ::core::format_args!($($arg)*),
            ::core::file!(),
            ::core::line!(),
        ))
    }};
}

// `err!(Name)` / `err!("Name")` — Zig `error.Name` literal.
//
// Expands to a per-site `AtomicU16` slot that interns the stringified name on
// first hit, then hands back the cached `NonZeroU16` forever after. Two
// `err!(Foo)` at different sites resolve to the *same* code (the table is
// process-global), so `e == err!(Foo)` is a plain u16 compare — the property
// h2 `error_code_for`, install retry loops, etc. were blocked on.
//
// Layout: `AtomicU16::new(0)` is 2 bytes of all-zeros (vs `OnceLock<Error>` at
// 8+), so the ~1.3k call-site statics shrink and land in `.bss` for free. On
// ELF targets they're additionally clustered into a dedicated `.bun_err`
// section so the whole set occupies one page. The cold miss path is a single
// non-generic `#[cold]` function (`intern_cached`) — no per-closure
// `get_or_init` monomorphization, one `.text` body instead of thousands.
#[macro_export]
macro_rules! err {
    ($name:ident) => { $crate::err!(@__cached ::core::stringify!($name)) };
    ($name:literal) => { $crate::err!(@__cached $name) };
    // `err!(from e)` — convert a strum::IntoStaticStr enum error to bun_core::Error.
    (from $e:expr) => { $crate::Error::intern(<&'static str>::from(&$e)) };
    (@__cached $name:expr) => {{
        #[cfg_attr(target_os = "linux", unsafe(link_section = ".bun_err"))]
        static __E: ::core::sync::atomic::AtomicU16 = ::core::sync::atomic::AtomicU16::new(0);
        let __v = __E.load(::core::sync::atomic::Ordering::Relaxed);
        if __v != 0 {
            $crate::Error::from_raw(__v)
        } else {
            $crate::intern_cached(&__E, $name)
        }
    }};
}
// `mark_binding!` and `zstr!` are defined in Global.rs / util.rs respectively.

pub use env as Environment;
/// Zig: `pub const FeatureFlags = @import("./bun_core/feature_flags.zig")`.
pub use feature_flags as FeatureFlags;
/// Process start time in nanoseconds. Written once during single-threaded
/// startup (`main`/`Cli::start`) and read freely thereafter.
static START_TIME: Once<i128> = Once::new();
#[inline]
pub fn start_time() -> i128 {
    START_TIME.get().copied().unwrap_or(0)
}
#[inline]
pub fn set_start_time(ns: i128) {
    let _ = START_TIME.set(ns);
}

/// `bun.Timer` / `std.time.Timer` — minimal monotonic stopwatch. Mirrors Zig's
/// `std.time.Timer.{start,read}` so callers ported verbatim (e.g.
/// `Lockfile::clean_with_logger`, `LifecycleScriptSubprocess`) compile against
/// the tier-0 surface without pulling in `bun_perf`.
pub mod time {
    // `std.time.*` — defined in `util::time`; re-exported so `bun_core::time::*` resolves uniformly.
    pub use crate::util::time::{
        MS_PER_DAY, MS_PER_S, NS_PER_DAY, NS_PER_HOUR, NS_PER_MIN, NS_PER_MS, NS_PER_S, NS_PER_US,
        NS_PER_WEEK, S_PER_DAY, US_PER_MS, US_PER_S, milli_timestamp, nano_timestamp, timestamp,
    };

    #[derive(Clone, Copy)]
    pub struct Timer {
        started: std::time::Instant,
    }
    impl Timer {
        #[inline]
        pub fn start() -> core::result::Result<Self, crate::Error> {
            Ok(Self {
                started: std::time::Instant::now(),
            })
        }
        #[inline]
        pub fn read(&self) -> u64 {
            self.started.elapsed().as_nanos() as u64
        }
    }
}

/// `bun.schema` — `src/options_types/schema.zig`. The full generated API
/// types live in `bun_api` (tier-2); tier-0 only needs the namespace to
/// exist so `bun_core::schema::api::StringPointer` etc. resolve as re-exports
/// once that crate un-gates. For now expose the one type tier-0 itself owns.
pub mod schema {
    pub mod api {
        pub use crate::util::StringPointer;
        // Remaining schema types re-exported from bun_api in Phase B-2.
    }
}

pub use output as Output;

// `crate::js_lexer` / `crate::js_printer` resolve to fmt.rs's local subsets.
pub use fmt::{
    InvalidCharacter, ParseIntError, js_lexer, js_printer, parse_decimal, parse_int, parse_unsigned,
};

// ──────────────────────────────────────────────────────────────────────────
// Flattened top-level string/fmt API.
//
// `string_immutable` is the full ported `bun.strings` namespace (was the
// `bun_core::immutable` module before the crate merge). The former
// `pub mod strings { … }` cycle-breaker shim is now an internal
// `strings_impl` module whose items are glob-re-exported at crate root, and
// `pub mod strings { pub use super::*; }` keeps `bun_core::strings::X`
// resolving for callers that haven't been rewritten yet.
// ──────────────────────────────────────────────────────────────────────────
pub use crate::string::immutable as string_immutable;

pub use crate::string::immutable::{
    CodePoint, DecodeHexError, LineRange, OptionalUsize, PercentEncodeError,
    QuoteEscapeFormatFlags, SplitIterator, StringOrTinyString, UNICODE_REPLACEMENT,
    UNICODE_REPLACEMENT_STR, UUID_LEN, WHITESPACE_CHARS, append, cat, concat_alloc_t,
    concat_with_length, contains_char, contains_scalar, copy, count_char, decode_hex_to_bytes,
    decode_hex_to_bytes_truncate, encode_bytes_to_hex, ends_with_any, ends_with_char,
    ends_with_char_or_is_zero_length, ends_with_comptime, eql_any_comptime, eql_comptime,
    eql_comptime_utf16, format_escapes, has_prefix, has_prefix_case_insensitive,
    has_prefix_comptime, has_prefix_comptime_utf16, has_suffix_comptime, index_of, index_of_scalar,
    index_of_t, is_all_whitespace, is_ip_address, is_npm_package_name,
    is_npm_package_name_ignore_length, is_on_char_boundary, is_utf8_char_boundary, is_valid_utf8,
    join, last_index_of, last_index_of_t, length_of_leading_whitespace_ascii, memmem, order,
    order_t, percent_encode_write, sort_asc, sort_desc, split, starts_with_case_insensitive_ascii,
    starts_with_char, str_utf8, to_ascii_hex_value, to_utf16_alloc, trim_leading_char, trim_prefix,
    trim_prefix_comptime, trim_spaces, trim_suffix, trim_suffix_comptime,
    utf8_byte_sequence_length, utf16_eql_string, without_prefix, without_prefix_comptime,
    without_suffix_comptime, without_utf8_bom,
};

#[allow(deprecated)]
pub use crate::fmt::{
    DigitCount, DoubleFormatter, FormatDouble, FormatOSPath, FormatUTF8, FormatUTF16,
    HEX_DECODE_TABLE, HEX_INVALID, LOWER_HEX_TABLE, PathFormatOptions, QuotedFormatter, Raw,
    SizeFormatter, SizeFormatterOptions, SliceCursor, TruncatedHash32, UPPER_HEX_TABLE, VecWriter,
    buf_print, buf_print_infallible, buf_print_len, buf_print_z, buf_print_z_infallible, bytes,
    bytes_to_hex_lower, bytes_to_hex_lower_string, count, count_float, count_int, digit_count,
    digit_count_i64, digit_count_u64, double, fast_digit_count, fmt_os_path, fmt_path, fmt_path_u8,
    fmt_path_u16, format_ip, format_latin1, format_utf16_type, hex_byte_lower, hex_byte_upper,
    hex_char_lower, hex_char_upper, hex_digit_value, hex_lower, hex_pair_value, hex_u8, hex_u16,
    hex_upper, hex2_lower, hex2_upper, hex4_lower, hex4_upper, int_as_bytes, parse_ascii, parse_f32,
    parse_f64, parse_hex4, parse_hex_prefix, parse_hex_to_int, parse_int as parse_int_radix,
    parse_num, print_int, quote, raw, s, size, size_f64, size_i64, truncated_hash32,
    truncated_hash32_bytes, utf16,
};

/// Surrogate/transcode primitives + scalar-fallback string helpers that
/// predate the `string::immutable` merge. Glob-re-exported at crate root so
/// `crate::strings::X` (via the alias module below) and `bun_core::X` both
/// resolve. Do NOT add a `pub use string::immutable::*` glob here — several
/// names (`first_non_ascii`, `index_of_char`, `Encoding`, `CodepointIterator`)
/// have intentionally-different signatures in the two layers.
pub(crate) mod strings_impl {
    // ─── UTF-16 surrogate-pair encoding (ICU U16_LEAD / U16_TRAIL) ─────────────
    // Zig parity: src/string/immutable/unicode.zig:1480 `u16Lead`/`u16Trail`,
    // re-exported as `strings.u16Lead`/`strings.u16Trail`. Defined here in
    // bun_core (not bun_string) so the WTF-8 fallback transcoder below and any
    // other tier-0 caller can use it without a dep cycle.
    //
    // Precondition: `supplementary` is in U+10000..=U+10FFFF. Out-of-range input
    // is not checked in release (matches the ICU C macros' truncating cast).

    /// ICU `U16_LEAD`: high surrogate for a supplementary code point.
    #[inline]
    pub const fn u16_lead(supplementary: u32) -> u16 {
        debug_assert!(supplementary >= 0x10000 && supplementary <= 0x10FFFF);
        ((supplementary >> 10) + 0xD7C0) as u16
    }

    /// ICU `U16_TRAIL`: low surrogate for a supplementary code point.
    #[inline]
    pub const fn u16_trail(supplementary: u32) -> u16 {
        debug_assert!(supplementary >= 0x10000 && supplementary <= 0x10FFFF);
        ((supplementary & 0x3FF) | 0xDC00) as u16
    }

    /// `[U16_LEAD(c), U16_TRAIL(c)]` for a supplementary code point.
    #[inline]
    pub const fn encode_surrogate_pair(supplementary: u32) -> [u16; 2] {
        [u16_lead(supplementary), u16_trail(supplementary)]
    }

    /// Append `cp` to `buf` as 1 or 2 UTF-16 code units (BMP vs surrogate
    /// pair). Lone-surrogate code points pass through unchanged (WTF-16).
    #[inline]
    pub fn push_codepoint_utf16(buf: &mut Vec<u16>, cp: u32) {
        if cp <= 0xFFFF {
            buf.push(cp as u16);
        } else {
            buf.extend_from_slice(&encode_surrogate_pair(cp));
        }
    }

    #[inline]
    pub fn includes(h: &[u8], n: &[u8]) -> bool {
        ::bstr::ByteSlice::find(h, n).is_some()
    }
    #[inline]
    pub fn contains(h: &[u8], n: &[u8]) -> bool {
        includes(h, n)
    }
    #[inline]
    pub fn index_of_char(h: &[u8], c: u8) -> Option<usize> {
        h.iter().position(|&b| b == c)
    }
    #[inline]
    pub fn starts_with(h: &[u8], p: &[u8]) -> bool {
        h.starts_with(p)
    }
    #[inline]
    pub fn ends_with(h: &[u8], p: &[u8]) -> bool {
        h.ends_with(p)
    }
    #[inline]
    pub fn eql(a: &[u8], b: &[u8]) -> bool {
        a == b
    }
    pub use ::bun_alloc::{
        ascii_lowercase_buf, copy_lowercase, copy_lowercase_if_needed, trim, trim_left, trim_right,
    };

    /// `std.mem.replacementSize` — byte length of `input` after replacing every
    /// occurrence of `needle` with `replacement`. Empty `needle` ⇒ `input.len()`
    /// (lenient vs Zig's assert; matches every existing Rust caller's expectation).
    pub fn replacement_size(input: &[u8], needle: &[u8], replacement: &[u8]) -> usize {
        if needle.is_empty() {
            return input.len();
        }
        let mut size = input.len();
        let mut i = 0usize;
        while let Some(pos) = ::bstr::ByteSlice::find(&input[i..], needle) {
            size = size - needle.len() + replacement.len();
            i += pos + needle.len();
        }
        size
    }

    /// `std.mem.replace` — write `input` into `output` replacing every `needle`
    /// with `replacement`; returns the number of replacements made. `output`
    /// must be at least [`replacement_size`]`(input, needle, replacement)` bytes.
    pub fn replace(input: &[u8], needle: &[u8], replacement: &[u8], output: &mut [u8]) -> usize {
        if needle.is_empty() {
            output[..input.len()].copy_from_slice(input);
            return 0;
        }
        let mut i = 0usize;
        let mut o = 0usize;
        let mut count = 0usize;
        loop {
            match ::bstr::ByteSlice::find(&input[i..], needle) {
                Some(pos) => {
                    output[o..o + pos].copy_from_slice(&input[i..i + pos]);
                    o += pos;
                    output[o..o + replacement.len()].copy_from_slice(replacement);
                    o += replacement.len();
                    i += pos + needle.len();
                    count += 1;
                }
                None => {
                    output[o..o + (input.len() - i)].copy_from_slice(&input[i..]);
                    return count;
                }
            }
        }
    }

    /// Allocating replace-all — `std.mem.replacementSize` + `std.mem.replace`
    /// fused. Returns a fresh `Vec` (sized exactly to the result; no realloc).
    pub fn replace_owned(input: &[u8], needle: &[u8], replacement: &[u8]) -> Vec<u8> {
        if needle.is_empty() {
            return input.to_vec();
        }
        let mut out = Vec::with_capacity(replacement_size(input, needle, replacement));
        let mut i = 0usize;
        while let Some(pos) = ::bstr::ByteSlice::find(&input[i..], needle) {
            out.extend_from_slice(&input[i..i + pos]);
            out.extend_from_slice(replacement);
            i += pos + needle.len();
        }
        out.extend_from_slice(&input[i..]);
        out
    }
    /// Zig: `strings.eqlCaseInsensitiveASCII` (src/string/immutable.zig).
    /// Spec-faithful port: defers to libc `strncasecmp`/`_strnicmp` for the
    /// hot path (CSS parser, HTTP header matching). When `check_len` is false
    /// the caller guarantees `a.len() <= b.len()` and both are non-empty
    /// (matches Zig's `bun.unsafeAssert`).
    #[inline]
    pub fn eql_case_insensitive_ascii(a: &[u8], b: &[u8], check_len: bool) -> bool {
        if check_len {
            if a.len() != b.len() {
                return false;
            }
            if a.is_empty() {
                return true;
            }
        }

        debug_assert!(!b.is_empty());
        debug_assert!(!a.is_empty());

        // SAFETY: a and b are non-empty; strncasecmp reads up to a.len() bytes from each.
        #[cfg(not(windows))]
        unsafe {
            libc::strncasecmp(a.as_ptr().cast(), b.as_ptr().cast(), a.len()) == 0
        }
        // Windows MSVC libc has no `strncasecmp`; `_strnicmp` is the equivalent.
        #[cfg(windows)]
        unsafe {
            unsafe extern "C" {
                fn _strnicmp(
                    a: *const core::ffi::c_char,
                    b: *const core::ffi::c_char,
                    n: usize,
                ) -> core::ffi::c_int;
            }
            _strnicmp(a.as_ptr().cast(), b.as_ptr().cast(), a.len()) == 0
        }
    }
    /// Zig: `strings.containsCaseInsensitiveASCII` — naive O(n·m) windowed
    /// case-insensitive ASCII substring search (matches the Zig scalar impl;
    /// callers are cold path-lookup on macOS/Windows where the FS is
    /// case-insensitive).
    #[inline]
    pub fn contains_case_insensitive_ascii(haystack: &[u8], needle: &[u8]) -> bool {
        if needle.len() > haystack.len() {
            return false;
        }
        let mut start = 0usize;
        while start + needle.len() <= haystack.len() {
            if eql_case_insensitive_ascii(&haystack[start..start + needle.len()], needle, false) {
                return true;
            }
            start += 1;
        }
        false
    }
    /// `bun.strings.isWindowsAbsolutePathMissingDriveLetter` (immutable/paths.zig)
    /// — true for `\foo`-style absolute paths that lack a `C:` / `\\?\` /
    /// `\\server\` prefix and therefore need the cwd's drive prepended.
    /// Generic over `u8`/`u16` to mirror the Zig comptime `T: type` param.
    pub fn is_windows_absolute_path_missing_drive_letter<T: crate::strings::PathByte>(
        chars: &[T],
    ) -> bool {
        // Zig asserts non-empty + windows-absolute; release-mode callers may
        // still pass `""`, so bail instead of indexing OOB.
        debug_assert!(!chars.is_empty());
        if chars.is_empty() {
            return false;
        }
        let sep = crate::path_sep::is_sep_any_t::<T>;

        // 'C:\hello' -> false — most common case, check first.
        if !sep(chars[0]) {
            debug_assert!(chars.len() > 2);
            debug_assert!(chars[1] == T::from_u8(b':'));
            return false;
        }

        if chars.len() > 4 {
            // '\??\hello' -> false (NT object prefix)
            if chars[1] == T::from_u8(b'?') && chars[2] == T::from_u8(b'?') && sep(chars[3]) {
                return false;
            }
            // '\\?\hello' -> false (other NT object prefix)
            // '\\.\hello' -> false (NT device prefix)
            if sep(chars[1])
                && (chars[2] == T::from_u8(b'?') || chars[2] == T::from_u8(b'.'))
                && sep(chars[3])
            {
                return false;
            }
        }

        // Zig: `bun.path.windowsFilesystemRootT(T, chars).len == 1`. With
        // `chars[0]` already known to be a separator, that fn returns len > 1
        // only via its UNC/device branch (`len >= 5 && sep[0] && sep[1] &&
        // !sep[2]`); every other separator-led path resolves to a single-char
        // root. Inlined here because `bun_paths` would be a tier-0 cycle.
        //
        // '\\Server\Share'  -> false (UNC)
        // '\\Server\\Share' -> true  (extra separator — not UNC)
        // '\Server\Share'   -> true  (posix-style)
        !(chars.len() >= 5 && sep(chars[1]) && !sep(chars[2]))
    }
    /// `strings.eqlComptimeIgnoreLen` — caller has already checked `a.len() ==
    /// b.len()` (the "ignore len" means "don't re-check"). PERF(port): the Zig
    /// version generates length-specialized SWAR loads at comptime; this scalar
    /// fallback is fine for the only T0/T1 caller (ComptimeStringMap, where
    /// `b` is a small static).
    #[inline]
    pub fn eql_comptime_ignore_len(a: &[u8], b: &'static [u8]) -> bool {
        debug_assert_eq!(a.len(), b.len());
        a == b
    }

    /// `const fn` byte-slice equality — slice `==` is not `const` on stable, so
    /// const-context callers (clap param-name lookup, MultiArrayList field-name
    /// reflection, host-fn error-set parsing) need the manual len-check + while
    /// loop. Zig precedent: a single `std.mem.eql(u8, a, b)`; the per-crate
    /// duplication was a Rust-port artifact, not a design choice. Runtime
    /// callers should prefer plain `==` (lowers to `memcmp`).
    #[inline]
    pub const fn const_bytes_eq(a: &[u8], b: &[u8]) -> bool {
        if a.len() != b.len() {
            return false;
        }
        let mut i = 0;
        while i < a.len() {
            if a[i] != b[i] {
                return false;
            }
            i += 1;
        }
        true
    }

    /// `const fn` `&str` equality via [`const_bytes_eq`].
    #[inline]
    pub const fn const_str_eq(a: &str, b: &str) -> bool {
        const_bytes_eq(a.as_bytes(), b.as_bytes())
    }

    // ──────────────────────────────────────────────────────────────────────
    // Transcoding (from src/string/immutable/unicode.zig). Lives in T0 so
    // collections::Vec<u8> can call it without depending on bun_string.
    // Allocator params dropped per PORTING.md §Allocators.
    // ──────────────────────────────────────────────────────────────────────
    use bun_simdutf_sys::simdutf;

    #[inline]
    pub fn is_all_ascii(slice: &[u8]) -> bool {
        // Short-string fast path: for ≤32 bytes the scalar loop wins. Without
        // cross-LTO the FFI path is Rust → `simdutf__validate_ascii` shim
        // (push/mov/pop/jmp) → `simdutf::validate_ascii` (runtime CPU-dispatch
        // vtable load + indirect call) → impl; on the `path.dirname` micro the
        // 2-hop dispatch was ~60% of the SIMD work for 14-byte inputs.
        if slice.len() <= 32 {
            return slice.iter().all(|&b| b < 0x80);
        }
        // SAFETY: FFI reads exactly slice.len() bytes.
        unsafe { simdutf::simdutf__validate_ascii(slice.as_ptr(), slice.len()) }
    }

    /// Index of first non-ASCII byte, or None if all-ASCII. simdutf-backed.
    #[inline]
    pub fn first_non_ascii(slice: &[u8]) -> Option<usize> {
        // Short-string fast path: see is_all_ascii() above for the FFI-dispatch
        // cost rationale. position() autovectorizes; ≤32B beats the shim.
        if slice.len() <= 32 {
            return slice.iter().position(|&b| b >= 0x80);
        }
        // SAFETY: FFI reads exactly slice.len() bytes.
        let r =
            unsafe { simdutf::simdutf__validate_ascii_with_errors(slice.as_ptr(), slice.len()) };
        if r.status == simdutf::Status::SUCCESS {
            None
        } else {
            Some(r.count)
        }
    }

    /// Encode a code point as WTF-8 (UTF-8 that permits unpaired surrogates).
    /// Returns bytes written (1..=4). Port of `encodeWTF8Rune`.
    #[inline]
    pub fn encode_wtf8_rune(out: &mut [u8; 4], cp: u32) -> usize {
        if cp < 0x80 {
            out[0] = cp as u8;
            1
        } else if cp < 0x800 {
            out[0] = 0xC0 | (cp >> 6) as u8;
            out[1] = 0x80 | (cp & 0x3F) as u8;
            2
        } else if cp < 0x10000 {
            out[0] = 0xE0 | (cp >> 12) as u8;
            out[1] = 0x80 | ((cp >> 6) & 0x3F) as u8;
            out[2] = 0x80 | (cp & 0x3F) as u8;
            3
        } else {
            out[0] = 0xF0 | (cp >> 18) as u8;
            out[1] = 0x80 | ((cp >> 12) & 0x3F) as u8;
            out[2] = 0x80 | ((cp >> 6) & 0x3F) as u8;
            out[3] = 0x80 | (cp & 0x3F) as u8;
            4
        }
    }

    // ── UTF-16 surrogate primitives (ICU `utf16.h` macros) ────────────────────
    // Canonical home is bun_core (not bun_string) because bun_core::strings itself
    // needs these for the simdutf scalar-fallback paths (append_wtf8_from_utf16,
    // copy_utf16_into_utf8, util::getcwd on Windows) and bun_string already
    // depends on bun_core. bun_string re-exports the full set via
    // `pub use bun_core::strings::{u16_is_lead, ...}`.
    //
    // DO NOT add a one-size `Utf16CodepointIter` here: unpaired-surrogate policy
    // is caller-specific and load-bearing (WTF-8 pass-through vs U+FFFD replace
    // vs js_printer's unchecked-trail combine). Callers compose the primitives.

    /// ICU `U16_SURROGATE_OFFSET` = `(0xD800 << 10) + 0xDC00 - 0x10000`.
    pub const U16_SURROGATE_OFFSET: u32 = (0xD800u32 << 10) + 0xDC00 - 0x10000;

    /// ICU `U16_IS_LEAD` — high (lead) surrogate `0xD800..=0xDBFF`.
    #[inline]
    pub const fn u16_is_lead(c: u16) -> bool {
        (c & 0xFC00) == 0xD800
    }

    /// ICU `U16_IS_TRAIL` — low (trail) surrogate `0xDC00..=0xDFFF`.
    #[inline]
    pub const fn u16_is_trail(c: u16) -> bool {
        (c & 0xFC00) == 0xDC00
    }

    /// ICU `U16_IS_SURROGATE` — either half, `0xD800..=0xDFFF`.
    #[inline]
    pub const fn u16_is_surrogate(c: u16) -> bool {
        (c & 0xF800) == 0xD800
    }

    /// ICU `U16_GET_SUPPLEMENTARY` — combine a *known-valid* lead+trail into a
    /// supplementary code point. Caller must have already checked
    /// [`u16_is_lead`]/[`u16_is_trail`].
    #[inline]
    pub const fn u16_get_supplementary(lead: u16, trail: u16) -> u32 {
        ((lead as u32) << 10) + trail as u32 - U16_SURROGATE_OFFSET
    }

    /// Validate-then-combine: `Some(supplementary)` iff `lead` is a high
    /// surrogate **and** `trail` is a low surrogate.
    #[inline]
    pub const fn decode_surrogate_pair(lead: u16, trail: u16) -> Option<u32> {
        if u16_is_lead(lead) && u16_is_trail(trail) {
            Some(u16_get_supplementary(lead, trail))
        } else {
            None
        }
    }

    /// Decode one code point from `input[0..]`, replacing any unpaired
    /// surrogate with U+FFFD. Returns `(code_point, units_consumed ∈ {1,2})`.
    /// `input` must be non-empty.
    #[inline]
    pub fn decode_utf16_with_fffd(input: &[u16]) -> (u32, u8) {
        let c0 = input[0];
        if u16_is_lead(c0) {
            match input.get(1) {
                Some(&c1) if u16_is_trail(c1) => (u16_get_supplementary(c0, c1), 2),
                _ => (0xFFFD, 1),
            }
        } else if u16_is_trail(c0) {
            (0xFFFD, 1)
        } else {
            (c0 as u32, 1)
        }
    }

    /// Decode one code point from `input[0..]` with **WTF-16 pass-through**:
    /// well-formed pairs are combined; *unpaired* surrogates are returned
    /// verbatim (so the caller can re-encode them as 3-byte WTF-8).
    /// Returns `(code_point, units_consumed ∈ {1,2})`. `input` must be non-empty.
    #[inline]
    pub fn decode_wtf16_raw(input: &[u16]) -> (u32, u8) {
        let c0 = input[0];
        if u16_is_lead(c0) {
            if let Some(&c1) = input.get(1) {
                if u16_is_trail(c1) {
                    return (u16_get_supplementary(c0, c1), 2);
                }
            }
        }
        (c0 as u32, 1)
    }

    #[inline]
    pub fn latin1_to_codepoint_bytes_assume_not_ascii(c: u8) -> [u8; 2] {
        debug_assert!(c >= 0x80);
        let cp = c as u32;
        [0xC0 | (cp >> 6) as u8, 0x80 | (cp & 0x3F) as u8]
    }

    /// Port of `allocateLatin1IntoUTF8WithList`.
    /// PERF(port): Zig hand-rolls a SWAR/@Vector ASCII-span scanner; here we use
    /// `first_non_ascii` (simdutf SIMD) for the span scan — equivalent throughput.
    pub fn allocate_latin1_into_utf8_with_list(
        mut list: Vec<u8>,
        offset_into_list: usize,
        latin1: &[u8],
    ) -> Vec<u8> {
        list.truncate(offset_into_list);
        list.reserve(latin1.len());
        let mut rest = latin1;
        while !rest.is_empty() {
            match first_non_ascii(rest) {
                None => {
                    list.extend_from_slice(rest);
                    break;
                }
                Some(i) => {
                    list.extend_from_slice(&rest[..i]);
                    rest = &rest[i..];
                    while let Some(&c) = rest.first() {
                        if c < 0x80 {
                            break;
                        }
                        list.reserve(2);
                        let [a, b] = latin1_to_codepoint_bytes_assume_not_ascii(c);
                        list.push(a);
                        list.push(b);
                        rest = &rest[1..];
                    }
                }
            }
        }
        list
    }

    /// Port of `toUTF8FromLatin1` — None if input is already ASCII.
    pub fn to_utf8_from_latin1(latin1: &[u8]) -> Option<Vec<u8>> {
        if is_all_ascii(latin1) {
            return None;
        }
        Some(allocate_latin1_into_utf8_with_list(
            Vec::with_capacity(latin1.len()),
            0,
            latin1,
        ))
    }

    /// Slow-path fallback for unpaired surrogates (port of `toUTF8ListWithTypeBun` core loop).
    /// Unpaired surrogates are replaced with U+FFFD, matching `utf16CodepointWithFFFDAndFirstInputChar`.
    fn append_wtf8_from_utf16(list: &mut Vec<u8>, utf16: &[u16]) {
        let mut i = 0usize;
        let mut buf = [0u8; 4];
        while i < utf16.len() {
            let (cp, adv) = decode_utf16_with_fffd(&utf16[i..]);
            i += adv as usize;
            let n = encode_wtf8_rune(&mut buf, cp);
            list.extend_from_slice(&buf[..n]);
        }
    }

    /// Port of `convertUTF16ToUTF8Append`. Caller must reserve
    /// `simdutf::length::utf8::from::utf16::le(utf16)` spare bytes for the fast path.
    pub fn convert_utf16_to_utf8_append(list: &mut Vec<u8>, utf16: &[u16]) {
        // SAFETY: simdutf writes only initialized bytes into the spare slice and
        // reports the count; on SURROGATE we commit 0 and fall back below.
        let r = unsafe {
            crate::vec::fill_spare(list, 0, |spare| {
                let r = simdutf::simdutf__convert_utf16le_to_utf8_with_errors(
                    utf16.as_ptr(),
                    utf16.len(),
                    spare.as_mut_ptr(),
                );
                (
                    if r.status == simdutf::Status::SURROGATE {
                        0
                    } else {
                        r.count
                    },
                    r,
                )
            })
        };
        if r.status == simdutf::Status::SURROGATE {
            append_wtf8_from_utf16(list, utf16);
        }
    }

    pub fn convert_utf16_to_utf8(mut list: Vec<u8>, utf16: &[u16]) -> Vec<u8> {
        let need = simdutf::length::utf8::from::utf16::le(utf16);
        list.reserve(need + 16);
        convert_utf16_to_utf8_append(&mut list, utf16);
        list
    }

    #[inline]
    pub fn to_utf8_alloc(utf16: &[u16]) -> Vec<u8> {
        convert_utf16_to_utf8(Vec::new(), utf16)
    }

    /// Transcode raw UTF-16-LE *bytes* (no alignment requirement) to a fresh
    /// UTF-8 `Vec`.
    ///
    /// `to_utf8_alloc` takes `&[u16]`, but constructing a `&[u16]` from a
    /// `&[u8]` whose pointer is not 2-byte-aligned is immediate language-level
    /// UB (`core::slice::from_raw_parts` requires `data` be aligned for `T`),
    /// regardless of how the consumer reads the memory. Callers that hold a
    /// `Vec<u8>` / `&[u8]` of LE bytes (e.g. BOM-stripping a file buffer) MUST
    /// route through this helper instead of casting.
    ///
    /// The bytes are first copied into a freshly-allocated, properly-aligned
    /// `Vec<u16>` via a raw byte `memcpy` (no per-element decode — simdutf
    /// interprets the buffer as little-endian and Bun targets only LE hosts),
    /// then handed to `to_utf8_alloc`. An odd trailing byte is dropped, which
    /// matches the prior `len() / 2` truncation.
    pub fn to_utf8_alloc_from_le_bytes(le_bytes: &[u8]) -> Vec<u8> {
        let n_u16 = le_bytes.len() / 2;
        if n_u16 == 0 {
            return Vec::new();
        }
        let mut aligned: Vec<u16> = Vec::with_capacity(n_u16);
        // SAFETY: `aligned.as_mut_ptr()` is a fresh `Vec<u16>` allocation, so it
        // is 2-byte-aligned and has `n_u16 * 2` writable bytes of capacity. We
        // copy exactly that many bytes from `le_bytes` (which has at least
        // `n_u16 * 2` readable bytes) into it as raw `u8`, then expose them as
        // initialized `u16` via `set_len`. No `&[u16]` is ever formed over the
        // possibly-misaligned source.
        unsafe {
            core::ptr::copy_nonoverlapping(
                le_bytes.as_ptr(),
                aligned.as_mut_ptr().cast::<u8>(),
                n_u16 * 2,
            );
            aligned.set_len(n_u16);
        }
        to_utf8_alloc(&aligned)
    }

    pub fn to_utf8_append_to_list(list: &mut Vec<u8>, utf16: &[u16]) {
        let need = simdutf::length::utf8::from::utf16::le(utf16);
        list.reserve(need + 16);
        convert_utf16_to_utf8_append(list, utf16);
    }

    /// Result of an encode-into-fixed-buffer operation. Port of `EncodeIntoResult`.
    #[derive(Clone, Copy, Default, Debug)]
    pub struct EncodeIntoResult {
        pub read: u32,
        pub written: u32,
    }

    /// Port of `elementLengthUTF16IntoUTF8` — exact UTF-8 byte length of a UTF-16
    /// (LE) input. simdutf-backed; falls back to scalar would be in unicode_draft.
    #[inline]
    pub fn element_length_utf16_into_utf8(utf16: &[u16]) -> usize {
        simdutf::length::utf8::from::utf16::le(utf16)
    }

    /// Port of `elementLengthLatin1IntoUTF8`.
    pub fn element_length_latin1_into_utf8(latin1: &[u8]) -> usize {
        let mut len = latin1.len();
        let mut rest = latin1;
        while let Some(i) = first_non_ascii(rest) {
            rest = &rest[i..];
            while let Some(&c) = rest.first() {
                if c < 0x80 {
                    break;
                }
                len += 1; // each high-latin1 byte → 2 utf8 bytes
                rest = &rest[1..];
            }
        }
        len
    }

    /// Port of `copyUTF16IntoUTF8` — encode UTF-16 into a fixed-size UTF-8 buffer.
    /// Unpaired surrogates are replaced with U+FFFD (matches `utf16CodepointWithFFFD`).
    /// Returns units read / bytes written. Caller is responsible for sizing `buf`.
    pub fn copy_utf16_into_utf8(buf: &mut [u8], utf16: &[u16]) -> EncodeIntoResult {
        if utf16.is_empty() || buf.is_empty() {
            return EncodeIntoResult::default();
        }
        // Fast path: if buf can definitely hold the whole conversion, try simdutf.
        let need = simdutf::length::utf8::from::utf16::le(utf16);
        if need > 0 && need <= buf.len() {
            // SAFETY: buf has `need` writable bytes; simdutf reads exactly utf16.len() u16.
            let r = unsafe {
                simdutf::simdutf__convert_utf16le_to_utf8_with_errors(
                    utf16.as_ptr(),
                    utf16.len(),
                    buf.as_mut_ptr(),
                )
            };
            if r.status == simdutf::Status::SUCCESS {
                return EncodeIntoResult {
                    read: utf16.len() as u32,
                    written: r.count as u32,
                };
            }
        }
        // Scalar path (handles unpaired surrogates + partial-buffer fill).
        let mut read = 0usize;
        let mut written = 0usize;
        let mut tmp = [0u8; 4];
        while read < utf16.len() {
            let (cp, adv) = decode_utf16_with_fffd(&utf16[read..]);
            let n = encode_wtf8_rune(&mut tmp, cp);
            if written + n > buf.len() {
                break;
            }
            buf[written..written + n].copy_from_slice(&tmp[..n]);
            written += n;
            read += adv as usize;
        }
        EncodeIntoResult {
            read: read as u32,
            written: written as u32,
        }
    }

    /// Port of `copyLatin1IntoUTF8` — encode Latin-1 into a fixed-size UTF-8 buffer.
    #[inline]
    pub fn copy_latin1_into_utf8(buf: &mut [u8], latin1: &[u8]) -> EncodeIntoResult {
        copy_latin1_into_utf8_stop_on_non_ascii::<false>(buf, latin1)
    }

    /// Port of `copyLatin1IntoUTF8StopOnNonASCII`. The Zig original hand-rolled a
    /// `@Vector(16,u8)` max-reduce + two SWAR `u64` mask/ctz ladders to find each
    /// non-ASCII byte; in Rust that work is exactly [`first_non_ascii`] (simdutf
    /// `validate_ascii_with_errors`, with a ≤32B scalar fast path), so the body
    /// reduces to "scan the next ASCII span, memcpy it, encode one high byte,
    /// repeat". Speculative 8-byte over-write is dropped (callers only read
    /// `buf[..written]`).
    pub fn copy_latin1_into_utf8_stop_on_non_ascii<const STOP: bool>(
        buf_: &mut [u8],
        latin1_: &[u8],
    ) -> EncodeIntoResult {
        let buf_total = buf_.len();
        let latin1_total = latin1_.len();
        let mut buf: &mut [u8] = buf_;
        let mut latin1: &[u8] = latin1_;

        while !buf.is_empty() && !latin1.is_empty() {
            // Find the longest pure-ASCII prefix that fits in `buf` and copy it
            // in one shot. simdutf provides the index; the subsequent
            // `copy_from_slice` is a single memcpy.
            let limit = buf.len().min(latin1.len());
            let span = first_non_ascii(&latin1[..limit]).unwrap_or(limit);
            buf[..span].copy_from_slice(&latin1[..span]);
            buf = &mut buf[span..];
            latin1 = &latin1[span..];

            // Either we filled `buf`, drained `latin1`, or hit a non-ASCII byte.
            if latin1.is_empty() || latin1[0] < 0x80 {
                break;
            }
            if STOP {
                return EncodeIntoResult {
                    written: u32::MAX,
                    read: u32::MAX,
                };
            }
            if buf.len() < 2 {
                break;
            }
            buf[..2].copy_from_slice(&latin1_to_codepoint_bytes_assume_not_ascii(latin1[0]));
            latin1 = &latin1[1..];
            buf = &mut buf[2..];
        }

        EncodeIntoResult {
            written: (buf_total - buf.len()) as u32,
            read: (latin1_total - latin1.len()) as u32,
        }
    }

    /// Null-terminated variant of `to_utf8_from_latin1`. Returns `ZBox` so
    /// `.len()` excludes the sentinel (Zig `[:0]u8` semantics).
    pub fn to_utf8_from_latin1_z(latin1: &[u8]) -> Option<crate::ZBox> {
        let v = to_utf8_from_latin1(latin1)?;
        Some(crate::ZBox::from_vec_with_nul(v))
    }

    /// Null-terminated variant of `to_utf8_alloc`. Returns `ZBox` so `.len()`
    /// excludes the sentinel.
    pub fn to_utf8_alloc_z(utf16: &[u16]) -> crate::ZBox {
        crate::ZBox::from_vec_with_nul(to_utf8_alloc(utf16))
    }

    /// Port of `firstNonASCII16`: index of the first u16 codeunit `>= 0x80`, or
    /// `None` if all-ASCII. Single SIMD-upgrade target — Zig uses `@Vector(8,u16)`
    /// max-reduce + `@ctz` bitmask (immutable.zig:1720); simdutf exposes no
    /// u16-ASCII-index fn and WTF's `charactersAreAllASCII<UChar>` is bool-only,
    /// so scalar until portable_simd lands.
    #[inline]
    pub fn first_non_ascii16(utf16: &[u16]) -> Option<usize> {
        utf16.iter().position(|&u| u >= 0x80)
    }

    /// Narrow ASCII-only `src` into `dst`. Returns `Some(&mut dst[..src.len()])`
    /// iff every unit is `< 0x80` and `dst.len() >= src.len()`; otherwise `None`
    /// (partial writes to `dst` are not rolled back). Composes `firstNonASCII16`
    /// + `copyU16IntoU8` — Zig has no single helper and open-codes this per site
    /// (e.g. string.zig `inMapCaseInsensitive`).
    #[inline]
    pub fn narrow_ascii_u16<'a>(src: &[u16], dst: &'a mut [u8]) -> Option<&'a mut [u8]> {
        let dst = dst.get_mut(..src.len())?;
        for (d, &u) in dst.iter_mut().zip(src) {
            if u >= 0x80 {
                return None;
            }
            *d = u as u8;
        }
        Some(dst)
    }

    // ──────────────────────────────────────────────────────────────────────
    // Generic-T helpers used by bun_paths (must live at T0).
    // ──────────────────────────────────────────────────────────────────────

    #[inline]
    pub fn index_of_any_t<T: Copy + Eq>(s: &[T], chars: &[T]) -> Option<usize> {
        s.iter().position(|c| chars.contains(c))
    }

    // Bound relaxed Eq → PartialEq to match core::slice::<[T]>::starts_with /
    // ends_with exactly. Bodies are semantically identical to the stdlib
    // methods; kept as named free fns so Zig-port call sites that read
    // `strings::has_prefix_t(a, b)` stay 1:1 with `bun.strings.hasPrefixComptime`
    // / `std.mem.startsWith`. Rust already lowers slice `==` on integer T to
    // memcmp, so the `eql_long`/`reinterpret_to_u8` perf path from
    // immutable.rs is unnecessary.
    #[inline]
    pub fn has_prefix_t<T: PartialEq>(s: &[T], prefix: &[T]) -> bool {
        s.len() >= prefix.len() && s[..prefix.len()] == *prefix
    }

    #[inline]
    pub fn has_suffix_t<T: PartialEq>(s: &[T], suffix: &[T]) -> bool {
        s.len() >= suffix.len() && s[s.len() - suffix.len()..] == *suffix
    }

    /// `std.mem.lastIndexOfScalar(T, slice, value)` — generic reverse scan.
    /// For `T = u8` prefer `bun_core::strings::last_index_of_char` (glibc
    /// `memrchr` on Linux).
    #[inline]
    pub fn last_index_of_char_t<T: Eq>(s: &[T], c: T) -> Option<usize> {
        s.iter().rposition(|x| *x == c)
    }
    #[doc(hidden)]
    #[inline]
    pub fn last_index_of_char<T: Eq>(s: &[T], c: T) -> Option<usize> {
        last_index_of_char_t(s, c)
    }

    #[inline]
    pub fn eql_long(a: &[u8], b: &[u8]) -> bool {
        a == b
    }

    #[inline]
    pub fn eql_case_insensitive_ascii_check_length(a: &[u8], b: &[u8]) -> bool {
        eql_case_insensitive_ascii(a, b, true)
    }

    /// Zig: open-coded `or`-chains over `eqlCaseInsensitiveASCII` at every site
    /// (custom.zig:1526, ident.zig:278, WebSocketUpgradeClient.zig:1426 — the
    /// `css.todo_stuff.match_ignore_ascii_case` markers). Haystacks are 6-12
    /// const literals; `#[inline]` lets LLVM unroll back to the original
    /// short-circuit chain. For key→value dispatch use `in_map_case_insensitive`.
    #[inline]
    pub fn eql_any_case_insensitive_ascii(needle: &[u8], haystack: &[&[u8]]) -> bool {
        haystack
            .iter()
            .any(|h| eql_case_insensitive_ascii(needle, h, true))
    }

    // ──────────────────────────────────────────────────────────────────────
    // Scanners / sniffers used by fmt.rs (URL redaction, path quoting, etc.).
    // Formerly a duplicate `mod strings` in fmt.rs; merged here so the crate
    // has a single `bun_core::strings` and fmt.rs picks up the simdutf-backed
    // `first_non_ascii`/`is_all_ascii` instead of scalar shims.
    // ──────────────────────────────────────────────────────────────────────

    #[inline]
    pub fn index_of_any(s: &[u8], chars: &[u8]) -> Option<usize> {
        s.iter().position(|b| chars.contains(b))
    }

    // ──────────────────────────────────────────────────────────────────────
    // IP-literal predicates. Spec (immutable.zig:1984-2004) calls
    // `bun.c_ares.ares_inet_pton`, the vendored c-ares implementation.
    // Do NOT call the system `inet_pton` here: on Windows that resolves into
    // ws2_32.dll and fails with WSANOTINITIALISED whenever it runs before
    // `WSAStartup()`, which URL/host parsing can. c-ares' impl is pure C, no
    // preconditions. bun_core sits below bun_cares_sys in the dep graph, so we
    // re-declare the extern locally (zero new deps; `libc` is already here).
    // ──────────────────────────────────────────────────────────────────────
    unsafe extern "C" {
        pub fn ares_inet_pton(
            af: core::ffi::c_int,
            src: *const core::ffi::c_char,
            dst: *mut core::ffi::c_void,
        ) -> core::ffi::c_int;
    }
    // dep-graph: bun_core < bun_sys, so cannot import the canonical
    // `bun_sys::posix::AF`. Keep a thin libc/ws2def passthrough instead. The
    // previous hand-rolled cfg ladder hardcoded `10` for the BSD fallback,
    // which is wrong (FreeBSD AF_INET6 == 28); routing through `libc` fixes that.
    const AF_INET: core::ffi::c_int = 2;
    #[cfg(not(windows))]
    const AF_INET6: core::ffi::c_int = libc::AF_INET6 as core::ffi::c_int;
    #[cfg(windows)]
    const AF_INET6: core::ffi::c_int = 23; // ws2def.h

    /// Zig: `bun.strings.isIPAddress` — `ares_inet_pton(AF_INET || AF_INET6) > 0`.
    pub fn is_ip_address(input: &[u8]) -> bool {
        let mut buf = [0u8; 512];
        if input.len() >= buf.len() {
            return false;
        }
        buf[..input.len()].copy_from_slice(input);
        let mut dst = [0u8; 28];
        // SAFETY: buf is NUL-terminated; dst ≥ sizeof(in6_addr).
        unsafe {
            ares_inet_pton(AF_INET, buf.as_ptr().cast(), dst.as_mut_ptr().cast()) > 0
                || ares_inet_pton(AF_INET6, buf.as_ptr().cast(), dst.as_mut_ptr().cast()) > 0
        }
    }

    /// Zig: `bun.strings.isIPV6Address` — `ares_inet_pton(AF_INET6, …) > 0`.
    /// Must be a strict parse, not a `contains(':')` heuristic: on Windows a
    /// unix-socket path like `C:/Windows/Temp/…` contains a colon and the old
    /// heuristic mis-bracketed it as `unix://[C:/…]`, which fails URL parsing.
    pub fn is_ipv6_address(input: &[u8]) -> bool {
        let mut buf = [0u8; 512];
        if input.len() >= buf.len() {
            return false;
        }
        buf[..input.len()].copy_from_slice(input);
        let mut dst = [0u8; 28];
        // SAFETY: buf is NUL-terminated; dst ≥ sizeof(in6_addr).
        unsafe { ares_inet_pton(AF_INET6, buf.as_ptr().cast(), dst.as_mut_ptr().cast()) > 0 }
    }

    pub fn starts_with_uuid(s: &[u8]) -> bool {
        // 8-4-4-4-12 hex with dashes
        if s.len() < 36 {
            return false;
        }
        for (i, &b) in s[..36].iter().enumerate() {
            let ok = match i {
                8 | 13 | 18 | 23 => b == b'-',
                _ => b.is_ascii_hexdigit(),
            };
            if !ok {
                return false;
            }
        }
        true
    }
    #[inline]
    pub fn is_uuid(s: &[u8]) -> bool {
        s.len() == 36 && starts_with_uuid(s)
    }
    pub fn starts_with_npm_secret(s: &[u8]) -> usize {
        // Port of bun.strings.startsWithNpmSecret (immutable.zig): case-insensitive
        // `npm`, then `_` or `s_`/`S_`, then 36..=48 alnum. Returns consumed length or 0.
        if s.len() < 3 {
            return 0;
        }
        if !(s[0] == b'n' || s[0] == b'N') {
            return 0;
        }
        if !(s[1] == b'p' || s[1] == b'P') {
            return 0;
        }
        if !(s[2] == b'm' || s[2] == b'M') {
            return 0;
        }
        let mut i = 3usize;
        if i < s.len() && (s[i] == b's' || s[i] == b'S') {
            i += 1;
        }
        if i >= s.len() || s[i] != b'_' {
            return 0;
        }
        i += 1;
        let prefix_len = i;
        while i < s.len() && (i - prefix_len) < 48 && s[i].is_ascii_alphanumeric() {
            i += 1;
        }
        if i - prefix_len < 36 {
            return 0;
        }
        i
    }
    fn starts_with_redacted_item(text: &[u8], item: &'static [u8]) -> Option<(usize, usize)> {
        if text.len() < item.len() || &text[..item.len()] != item {
            return None;
        }

        let mut whitespace = false;
        let mut offset = item.len();
        while offset < text.len() && text[offset].is_ascii_whitespace() {
            offset += 1;
            whitespace = true;
        }
        if offset == text.len() {
            return None;
        }
        let cont = crate::js_lexer::is_identifier_continue(text[offset] as i32);

        // must be another identifier
        if !whitespace && cont {
            return None;
        }

        // `null` is not returned after this point. Redact to the next
        // newline if anything is unexpected
        if cont {
            let rest = &text[offset..];
            return Some((offset, index_of_char(rest, b'\n').unwrap_or(rest.len())));
        }
        offset += 1;

        let mut end = offset;
        while end < text.len() && text[end].is_ascii_whitespace() {
            end += 1;
        }

        if end == text.len() {
            return Some((offset, text.len() - offset));
        }

        match text[end] {
            q @ (b'\'' | b'"' | b'`') => {
                // attempt to find closing
                let opening = end;
                end += 1;
                while end < text.len() {
                    match text[end] {
                        b'\\' => {
                            // skip
                            end += 1;
                            end += 1;
                        }
                        c if c == q => {
                            // closing
                            return Some((opening + 1, (end - 1) - opening));
                        }
                        _ => end += 1,
                    }
                }

                let rest = &text[offset..];
                Some((offset, index_of_char(rest, b'\n').unwrap_or(rest.len())))
            }
            _ => {
                let rest = &text[offset..];
                Some((offset, index_of_char(rest, b'\n').unwrap_or(rest.len())))
            }
        }
    }

    /// Returns offset and length of first secret found.
    pub fn starts_with_secret(str: &[u8]) -> Option<(usize, usize)> {
        if let Some(r) = starts_with_redacted_item(str, b"_auth") {
            return Some(r);
        }
        if let Some(r) = starts_with_redacted_item(str, b"_authToken") {
            return Some(r);
        }
        if let Some(r) = starts_with_redacted_item(str, b"email") {
            return Some(r);
        }
        if let Some(r) = starts_with_redacted_item(str, b"_password") {
            return Some(r);
        }
        if let Some(r) = starts_with_redacted_item(str, b"token") {
            return Some(r);
        }

        if starts_with_uuid(str) {
            return Some((0, 36));
        }

        let npm_secret_len = starts_with_npm_secret(str);
        if npm_secret_len > 0 {
            return Some((0, npm_secret_len));
        }

        if let Some(r) = find_url_password(str) {
            return Some(r);
        }

        None
    }

    /// Port of `bun.fmt.URLFormatter.findUrlPassword` — returns
    /// `(offset, len)` of the password segment, or None.
    /// Zig only matches http:// and https:// schemes and rejects empty pw.
    pub fn find_url_password(s: &[u8]) -> Option<(usize, usize)> {
        // Zig uses case-sensitive `hasPrefixComptime` and truncates the search
        // region at the first '\n' before scanning for '@'/':'.
        let scheme_end = if s.starts_with(b"http://") {
            7
        } else if s.starts_with(b"https://") {
            8
        } else {
            return None;
        };
        let mut rest = &s[scheme_end..];
        if let Some(nl) = rest.iter().position(|&b| b == b'\n') {
            rest = &rest[..nl];
        }
        let at = rest.iter().position(|&b| b == b'@')?;
        let userinfo = &rest[..at];
        let colon = userinfo.iter().position(|&b| b == b':')?;
        // Reject empty password (`user:@host`).
        if colon == at - 1 {
            return None;
        }
        Some((scheme_end + colon + 1, at - colon - 1))
    }

    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum Encoding {
        Ascii,
        Latin1,
        Utf8,
        Utf16,
    }

    /// Port of `bun.strings.utf8ByteSequenceLength` (unicode.zig:1509).
    /// Returns the UTF-8/WTF-8 sequence length implied by a *leading* byte,
    /// or **0** if the byte is not a valid lead (continuation 0x80-0xBF, or 0xF8-0xFF).
    #[inline]
    pub const fn utf8_byte_sequence_length(first_byte: u8) -> u8 {
        match first_byte {
            0x00..=0x7F => 1,
            0xC0..=0xDF => 2,
            0xE0..=0xEF => 3,
            0xF0..=0xF7 => 4,
            _ => 0,
        }
    }

    /// Port of `bun.strings.wtf8ByteSequenceLength` (unicode.zig:1954).
    /// Same table as [`utf8_byte_sequence_length`] but returns **1** for an invalid
    /// lead byte, so callers can always advance ≥1 (replacement-char semantics).
    #[inline]
    pub const fn wtf8_byte_sequence_length(first_byte: u8) -> u8 {
        match first_byte {
            0x00..=0x7F => 1,
            0xC0..=0xDF => 2,
            0xE0..=0xEF => 3,
            0xF0..=0xF7 => 4,
            _ => 1,
        }
    }

    /// Zig: `wtf8ByteSequenceLengthWithInvalid` — alias of
    /// [`wtf8_byte_sequence_length`] (kept distinct for spec-faithful naming).
    #[inline]
    pub const fn wtf8_byte_sequence_length_with_invalid(first_byte: u8) -> u8 {
        wtf8_byte_sequence_length(first_byte)
    }

    /// Port of `bun.strings.codepointSize` — UTF-8 byte length for an
    /// already-decoded code point (NOT a lead byte). Returns 0 for >U+10FFFF.
    #[inline]
    pub fn codepoint_size<R: Into<u32> + Copy>(r: R) -> u8 {
        match r.into() {
            0x0000..=0x007F => 1,
            0x0080..=0x07FF => 2,
            0x0800..=0xFFFF => 3,
            0x1_0000..=0x10_FFFF => 4,
            _ => 0,
        }
    }

    // ─── CodepointIterator (fmt.rs identifier formatter) ──────────────────
    #[derive(Default, Clone, Copy)]
    pub struct CodepointIteratorCursor {
        pub i: usize,
        pub c: i32,
        pub width: u8,
    }
    pub struct CodepointIterator<'a> {
        bytes: &'a [u8],
    }
    impl<'a> CodepointIterator<'a> {
        #[inline]
        pub fn init(bytes: &'a [u8]) -> Self {
            Self { bytes }
        }
        pub fn next(&self, cursor: &mut CodepointIteratorCursor) -> bool {
            let i = cursor.i + cursor.width as usize;
            if i >= self.bytes.len() {
                return false;
            }
            let b = self.bytes[i];
            // TODO(port): full UTF-8 decode — bun_str owns the table-driven impl.
            let (cp, w) = if b < 0x80 {
                (b as i32, 1u8)
            } else {
                (b as i32, 1u8)
            };
            cursor.i = i;
            cursor.c = cp;
            cursor.width = w;
            true
        }
    }

    /// `strings.convertUTF16ToUTF8InBuffer` — write UTF-8 into `out`, return
    /// the written sub-slice. Infallible: Zig's `![]const u8` has an empty
    /// inferred error set, so every `catch` at call sites is dead code. The
    /// caller is responsible for sizing `out` for the worst case (≤ 3× input
    /// code units).
    ///
    /// PORT NOTE: Zig passes `out` straight to simdutf with no bounds check
    /// (UB if undersized). We assert in release too — one extra SIMD length
    /// scan is cheap, and a panic beats heap corruption if a future caller
    /// gets the sizing wrong. All current callers (~10, Windows wide-path
    /// code) size `out` at `3 * utf16.len()` or `MAX_PATH * 3`, so this never
    /// fires in practice.
    pub fn convert_utf16_to_utf8_in_buffer<'a>(out: &'a mut [u8], utf16: &[u16]) -> &'a mut [u8] {
        if utf16.is_empty() {
            return &mut out[..0];
        }
        let need = simdutf::length::utf8::from::utf16::le(utf16);
        assert!(
            need <= out.len(),
            "convert_utf16_to_utf8_in_buffer: out too small (need {need}, have {})",
            out.len(),
        );
        let result = simdutf::convert::utf16::to::utf8::le(utf16, out);
        &mut out[..result]
    }
    // ─── path basename (std.fs.path.basename{Posix,Windows}) ──────────────────
    // Minimal code-unit trait so the generic basename impls can live at T0
    // without pulling `bun_paths::PathChar` (T1) down. `PathChar` and
    // `PathUnit` both add `: PathByte` as a supertrait and inherit `from_u8`.
    pub trait PathByte: Copy + Eq + 'static {
        fn from_u8(b: u8) -> Self;
    }
    impl PathByte for u8 {
        #[inline(always)]
        fn from_u8(b: u8) -> Self {
            b
        }
    }
    impl PathByte for u16 {
        #[inline(always)]
        fn from_u8(b: u8) -> Self {
            b as u16
        }
    }

    /// `std.fs.path.basenamePosix` — strip trailing `/` then return the final
    /// component. `\` is NOT a separator. Empty / all-`/` input → `&[]`.
    pub fn basename_posix<T: PathByte>(p: &[T]) -> &[T] {
        let mut end = p.len();
        while end > 0 && p[end - 1] == T::from_u8(b'/') {
            end -= 1;
        }
        if end == 0 {
            return &p[..0];
        }
        let mut start = end;
        while start > 0 && p[start - 1] != T::from_u8(b'/') {
            start -= 1;
        }
        &p[start..end]
    }

    /// `std.fs.path.basenameWindows` — strips trailing `/`/`\`, treats a drive
    /// designator `X:` at index 1 as a root delimiter (`"C:"` → `""`,
    /// `"C:foo"` → `"foo"`, `"C:\\"` → `""`), then returns the final component.
    pub fn basename_windows<T: PathByte>(p: &[T]) -> &[T] {
        if p.is_empty() {
            return &p[..0];
        }
        let mut end = p.len();
        loop {
            let c = p[end - 1];
            if c == T::from_u8(b'/') || c == T::from_u8(b'\\') {
                end -= 1;
                if end == 0 {
                    return &p[..0];
                }
                continue;
            }
            if c == T::from_u8(b':') && end == 2 {
                return &p[..0];
            }
            break;
        }
        let mut start = end;
        while start > 0
            && p[start - 1] != T::from_u8(b'/')
            && p[start - 1] != T::from_u8(b'\\')
            && !(p[start - 1] == T::from_u8(b':') && start - 1 == 1)
        {
            start -= 1;
        }
        &p[start..end]
    }

    /// `bun.strings.basename` — comptime-dispatches to `basenameWindows` on
    /// Windows and `basenamePosix` elsewhere.
    #[inline]
    pub fn basename(path: &[u8]) -> &[u8] {
        if cfg!(windows) {
            basename_windows(path)
        } else {
            basename_posix(path)
        }
    }
    /// `bun.strings.removeLeadingDotSlash` (immutable/paths.zig). Hosted at T0
    /// so `crate::string` (and `bun_paths::string_paths`) can reach it
    /// without a `bun_paths` edge.
    #[inline(always)]
    pub fn remove_leading_dot_slash(slice: &[u8]) -> &[u8] {
        if slice.len() >= 2 {
            // PERF(port): Zig bitcast slice[0..2] to u16; direct 2-byte slice
            // comparison compiles to the same thing.
            if &slice[..2] == b"./" || (cfg!(windows) && &slice[..2] == b".\\") {
                return &slice[2..];
            }
        }
        slice
    }

    pub fn without_trailing_slash(s: &[u8]) -> &[u8] {
        let mut e = s.len();
        while e > 1 && (s[e - 1] == b'/' || s[e - 1] == b'\\') {
            e -= 1;
        }
        &s[..e]
    }
}
pub use strings_impl::*;
pub use crate::string::immutable::convert_utf8_to_utf16_in_buffer;

/// Back-compat alias: `bun_core::strings::X` → `bun_core::X`. The full
/// `bun.strings` namespace is `bun_core::immutable` (formerly
/// `bun_core::strings`); this alias keeps the ~200 existing
/// `bun_core::strings::` / `crate::strings::` call sites compiling.
///
/// NOTE: a handful of names (`index_of_char`, `eql_long`, `first_non_ascii`,
/// `Encoding`, `CodepointIterator`) have a different signature here than in
/// `bun_core::immutable`. Callers that need the Zig-spec
/// `bun.strings.*` form import `bun_core::immutable as strings` instead.
pub mod strings {
    // `bun_core::strings` is the union of the crate-root surface (`super::*`,
    // which carries the scalar-fallback `strings_impl::*` glob plus every
    // `bun_core::Foo`) and the full Zig-spec `bun.strings.*` namespace
    // (`string::immutable::*`). Names that exist in BOTH layers — same
    // identifier, different signature — are explicitly disambiguated below
    // in favour of `immutable` (matches every former `bun_core::strings::X`
    // caller). Internal `bun_core` code that needs the scalar form spells
    // `crate::strings_impl::X` directly.
    pub use super::*;
    pub use crate::string::immutable::*;
    pub use crate::string::immutable::{
        CodepointIterator, Cursor, Encoding, codepoint_size, concat, contains,
        contains_newline_or_non_ascii_or_quote, convert_utf8_to_utf16_in_buffer,
        convert_utf16_to_utf8_in_buffer, ends_with, eql, eql_case_insensitive_ascii,
        eql_comptime_ignore_len, eql_long, first_non_ascii, first_non_ascii16, includes,
        index_of_char, index_of_newline_or_non_ascii_or_ansi, is_ipv6_address, last_index_of_char,
        last_index_of_char_t, remove_leading_dot_slash, starts_with, without_trailing_slash,
    };
    // Disambiguate vs the scalar tier-0 versions in `crate::strings_impl` (now
    // dedup-hoisted) — `immutable` is the Zig-spec impl callers expect.
    pub use crate::string::immutable::{ares_inet_pton, copy_lowercase_if_needed};
    // `index_of_any{,_t}` keep the scalar `Option<usize>` form (Zig-spec
    // `immutable` returns `Option<OptionalUsize>` which no caller wants here).
    pub use crate::strings_impl::{index_of_any, index_of_any_t};
}

// bun_alloc stubs Global.rs expects (real consts deferred to B-2 ungate of bun_alloc::basic)
pub const USE_MIMALLOC: bool = true;
pub mod debug_allocator_data {
    #[inline]
    pub fn deinit_ok() -> bool {
        true
    }
}

/// `bun.feature_flag.*` runtime env-var getters (real impl in env_var.rs, still gated).
/// feature_flags.rs (compile-time consts) is now real; this stub provides the
/// `.get()` accessor surface that env_var.rs will replace.
pub mod feature_flag {
    macro_rules! flag { ($($name:ident),* $(,)?) => { $(
        #[allow(non_camel_case_types)] pub struct $name;
        impl $name { #[inline] pub fn get(&self) -> bool { false } }
    )* } }
    flag!(
        BUN_FEATURE_FLAG_NO_LIBDEFLATE,
        BUN_FEATURE_FLAG_EXPERIMENTAL_BAKE
    );
}
/// Port of `bun.linuxKernelVersion()` (src/bun.zig) → `analytics.GeneratePlatform.kernelVersion()`.
/// Lives in T1 because `bun_sys` calls it from feature probes (copy_file_range,
/// ioctl_ficlone, RWF_NONBLOCK) and cannot depend on `bun_analytics`. Parses
/// `uname(2).release` major.minor.patch directly; the full Semver parse with
/// pre/build tags stays in `bun_analytics`.
#[cfg(any(target_os = "linux", target_os = "android"))]
pub fn linux_kernel_version() -> Version {
    use core::sync::atomic::{AtomicU32, Ordering};
    // Packed u32: u32::MAX = uninit, otherwise (major<<20)|(minor<<10)|patch.
    // (Using MAX, not 0, as the sentinel so a parse that yields {0,0,0} caches
    // as 0 and round-trips to {0,0,0} on every call — the previous 0-sentinel
    // stored 1 in that case, returning {0,0,1} on subsequent calls.)
    static CACHE: AtomicU32 = AtomicU32::new(u32::MAX);
    let packed = CACHE.load(Ordering::Relaxed);
    if packed != u32::MAX {
        return Version {
            major: (packed >> 20) & 0x3ff,
            minor: (packed >> 10) & 0x3ff,
            patch: packed & 0x3ff,
        };
    }
    let uts = crate::ffi::uname();
    let release = crate::ffi::c_field_bytes(&uts.release);
    let v = Version::parse_dotted(release);
    // Cache; clamp components to 10 bits (kernel versions fit comfortably).
    let p = ((v.major & 0x3ff) << 20) | ((v.minor & 0x3ff) << 10) | (v.patch & 0x3ff);
    CACHE.store(p, Ordering::Relaxed);
    v
}
#[cfg(not(any(target_os = "linux", target_os = "android")))]
#[inline]
pub fn linux_kernel_version() -> Version {
    Version {
        major: 0,
        minor: 0,
        patch: 0,
    }
}

/// Port of `bun.assertWithLocation` (src/bun_core/bun.zig) — `bun.assert` plus
/// the caller's source location for the failure message. In release builds the
/// Zig version logs and continues; here it panics under `debug_assertions` and
/// is a no-op otherwise (matching `bun.assert`'s release-safe behaviour).
#[track_caller]
#[inline]
pub fn assert_with_location(cond: bool, loc: &'static core::panic::Location<'static>) {
    if cfg!(debug_assertions) && !cond {
        panic!("assertion failed at {}:{}", loc.file(), loc.line());
    }
}

/// FFI helpers shared by `#[uws_callback]` thunks and raw C-string call sites.
///
/// The former `catch_unwind_ffi` / `abort_on_panic` panic barrier was removed:
/// the workspace builds with `panic = "abort"`, so Rust panics terminate inside
/// `bun_crash_handler`'s `std::panic` hook before any unwind starts —
/// `catch_unwind` always returns `Ok` and the wrapper was dead weight. JSC does
/// not throw C++ exceptions across its public API, so there is no foreign
/// unwind to catch either. Macro-generated `extern "C"` thunks now call the
/// user body directly (same end state as Zig `@panic` → `bun.crash_handler`).
pub mod ffi {
    // `core`-only primitives shared with the freestanding `bun_shim_impl` PE
    // (which cannot link `bun_core`'s `#[no_mangle]` C-ABI surface). Single
    // audited copy lives in `bun_opaque::ffi`; re-exported here so existing
    // `bun_core::ffi::{wcslen,wstr_units,slice,slice_mut}` call paths are
    // unchanged.
    pub use bun_opaque::ffi::{slice, slice_mut, wcslen, wstr_units};

    /// Borrow a NUL-terminated C string from an FFI pointer.
    ///
    /// Single audited wrapper over `CStr::from_ptr` so the ~180 raw call
    /// sites in the tree funnel through one `unsafe` block. Adds a
    /// `debug_assert!(!p.is_null())` — `CStr::from_ptr(null)` is instant UB
    /// and the Zig originals (`bun.span`, `std.mem.span`) likewise assume a
    /// valid sentinel pointer, so a null here is always a caller bug.
    ///
    /// # Safety
    /// `p` must be non-null, point to a valid NUL-terminated byte sequence,
    /// and the returned borrow must not outlive that allocation. The caller
    /// chooses `'a` — keep it as tight as the source buffer's lifetime.
    #[inline(always)]
    pub unsafe fn cstr<'a>(p: *const core::ffi::c_char) -> &'a core::ffi::CStr {
        debug_assert!(!p.is_null(), "ffi::cstr: null pointer");
        // SAFETY: caller contract above — non-null, NUL-terminated, valid for 'a.
        unsafe { core::ffi::CStr::from_ptr(p) }
    }

    /// Convenience: `cstr(p).to_bytes()`. Dominant shape at call sites
    /// (Zig `bun.span(p)` / `std.mem.span(p)` port).
    ///
    /// # Safety
    /// Same contract as [`cstr`].
    #[inline(always)]
    pub unsafe fn cstr_bytes<'a>(p: *const core::ffi::c_char) -> &'a [u8] {
        // SAFETY: forwarded to `cstr`.
        unsafe { cstr(p) }.to_bytes()
    }

    #[cfg(unix)]
    static UTSNAME: crate::Once<libc::utsname> = crate::Once::new();

    /// Process-lifetime cached `uname(2)` result. Several callers
    /// (analytics version probe, crash-handler, kernel-version checks) read
    /// the same struct; cache so the binary issues exactly one syscall.
    #[cfg(unix)]
    #[inline]
    pub fn cached_uname() -> &'static libc::utsname {
        UTSNAME.get_or_init(uname)
    }

    /// Slice up to (excluding) the first NUL byte. Port of Zig `bun.sliceTo(b, 0)`;
    /// re-exported as `bun_core::slice_to_nul`.
    #[inline]
    pub fn slice_to_nul(buf: &[u8]) -> &[u8] {
        &buf[..buf.iter().position(|&b| b == 0).unwrap_or(buf.len())]
    }

    /// Mutable variant of [`slice_to_nul`].
    #[inline]
    pub fn slice_to_nul_mut(buf: &mut [u8]) -> &mut [u8] {
        let n = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        &mut buf[..n]
    }

    /// Heap-allocate a `T` filled with zero bytes. Safe by virtue of the
    /// [`Zeroable`] bound (the all-zero bit pattern is a valid `T`).
    #[inline]
    pub fn boxed_zeroed<T: Zeroable>() -> Box<T> {
        // SAFETY: `T: Zeroable` asserts the all-zero bit pattern is a valid `T`.
        unsafe { Box::<T>::new_zeroed().assume_init() }
    }

    /// Heap-allocate a `T` filled with zero bytes without the [`Zeroable`]
    /// bound. Prefer [`boxed_zeroed`]; this is for orphan-rule cases where the
    /// caller cannot `unsafe impl Zeroable` for a foreign type.
    ///
    /// # Safety
    /// `T` must be valid at the all-zero bit pattern.
    #[inline]
    pub unsafe fn boxed_zeroed_unchecked<T>() -> Box<T> {
        // SAFETY: caller guarantees T is valid at the all-zero bit pattern.
        unsafe { Box::<T>::new_zeroed().assume_init() }
    }

    /// Safe `uname(2)` wrapper: zero-init a `utsname`, call `libc::uname`, return
    /// it by value. On the (theoretical) error path the struct stays all-zero,
    /// so every `c_char[]` field reads as an empty NUL-terminated string.
    #[cfg(unix)]
    #[inline]
    pub fn uname() -> libc::utsname {
        // `&mut libc::utsname` is ABI-identical to libc's `struct utsname *`
        // (thin non-null pointer to a `#[repr(C)]` struct); the type encodes
        // the only pointer-validity precondition, so `safe fn` discharges the
        // link-time proof and the call needs no `unsafe` block.
        unsafe extern "C" {
            #[link_name = "uname"]
            safe fn libc_uname(buf: &mut libc::utsname) -> core::ffi::c_int;
        }
        let mut u: libc::utsname = zeroed();
        let _ = libc_uname(&mut u);
        u
    }

    /// Borrow a fixed-size `[c_char; N]` C-struct field as `&[u8]`, truncated at
    /// the first NUL (or full length if none). This is the `&[c_char]` analogue
    /// of [`cstr_bytes`] for inline arrays like `utsname::release`.
    #[inline]
    pub fn c_field_bytes(s: &[core::ffi::c_char]) -> &[u8] {
        // `c_char` is a type alias for `i8`/`u8`; both are `bytemuck::Pod`, so
        // the byte-sized reinterpretation is a safe `cast_slice`.
        let b: &[u8] = bytemuck::cast_slice(s);
        &b[..b.iter().position(|&c| c == 0).unwrap_or(b.len())]
    }

    /// All-bits-zero value of `T` for `#[repr(C)]` FFI structs.
    ///
    /// Single audited wrapper over `core::mem::zeroed()` so libc/uv/c-ares
    /// out-param init sites (`let mut x: libc::sigaction = zeroed();`) don't
    /// each open-code an `unsafe` block. This is the Rust spelling of Zig's
    /// `std.mem.zeroes(T)` / `= .{}` for `extern struct`.
    ///
    /// The `T: Zeroable` bound discharges the `mem::zeroed` safety obligation
    /// once per type (at the `unsafe impl`), so callers need no `unsafe`
    /// block. Prefer `T::default()` when `T` implements (or can derive)
    /// `Default` — reserve this for foreign POD where the orphan rule blocks a
    /// `Default` impl (libc, bindgen output) or where `Default` would be wrong
    /// but zero-init matches the C API contract.
    #[inline(always)]
    pub const fn zeroed<T: Zeroable>() -> T {
        // SAFETY: `T: Zeroable` is exactly the assertion that the all-zero bit
        // pattern is a valid `T` (no `NonNull`/`NonZero`/ref/fn-ptr fields, no
        // niche enums). `core::mem::zeroed` is therefore sound for `T`.
        unsafe { core::mem::zeroed() }
    }

    /// Marker: the all-zero bit pattern is a valid value of `Self`.
    ///
    /// Local re-spelling of `bytemuck::Zeroable` so we can blanket-`impl` it
    /// for foreign `libc` POD (orphan rule blocks impl-ing the upstream trait
    /// on `libc::sigaction` et al.). Once a type carries this marker,
    /// [`zeroed`] is a *safe* call — the audit happens once at the `unsafe
    /// impl`, not at every out-param init site.
    ///
    /// # Safety
    /// `Self` must be inhabited at the all-zero bit pattern: no non-nullable
    /// pointers (`&T`, `Box<T>`, `NonNull<T>`, fn ptrs), no `bool`/`char`
    /// outside their valid range, no niche-optimised enums. `#[repr(C)]`
    /// structs of integers, raw pointers, and nested `Zeroable` POD satisfy
    /// this. Padding bytes are fine (zero is a valid padding value).
    pub unsafe trait Zeroable: Sized {}

    /// Unchecked all-bits-zero — escape hatch for types not yet proven
    /// [`Zeroable`] (libuv handles, bindgen structs in `_sys` crates that
    /// don't depend on `bun_core`, generic `T` where the bound can't be
    /// threaded). Prefer [`zeroed`] + an `unsafe impl Zeroable` whenever the
    /// type is reachable.
    ///
    /// # Safety
    /// `T` must be inhabited at the all-zero bit pattern (same contract as
    /// [`Zeroable`], but asserted per-call instead of per-type).
    #[inline(always)]
    pub const unsafe fn zeroed_unchecked<T>() -> T {
        // SAFETY: caller guarantees T is valid at the all-zero bit pattern.
        unsafe { core::mem::zeroed() }
    }

    // ── Zeroable impls ──────────────────────────────────────────────────────
    // Primitives, raw pointers, arrays — match `bytemuck::Zeroable` blankets.
    macro_rules! zeroable_prim {
        ($($t:ty),* $(,)?) => { $( unsafe impl Zeroable for $t {} )* };
    }
    zeroable_prim!(
        (),
        u8,
        u16,
        u32,
        u64,
        u128,
        usize,
        i8,
        i16,
        i32,
        i64,
        i128,
        isize,
        f32,
        f64,
    );
    // SAFETY: null is a valid raw pointer.
    unsafe impl<T: ?Sized> Zeroable for *const T {}
    // SAFETY: null is a valid raw pointer.
    unsafe impl<T: ?Sized> Zeroable for *mut T {}
    // SAFETY: array of zero-valid elements is zero-valid.
    unsafe impl<T: Zeroable, const N: usize> Zeroable for [T; N] {}

    // libc POD — every field is an integer / raw pointer / nested C POD; the
    // C API contract for each is "zero-init before the kernel/libc fills it".
    // SAFETY: each `unsafe impl` below was audited against the libc crate's
    // struct definition for that target; none contain `NonNull`/`NonZero`/
    // references/fn-ptrs (bare `extern fn` fields in `sigaction` are stored as
    // `usize` sighandler_t on every libc target).
    #[cfg(unix)]
    unsafe impl Zeroable for libc::sigaction {}
    // `sigset_t` is a `u32` typedef on Darwin (covered by the primitive
    // blanket → E0119 if re-impl'd) but a real struct on Linux/Android
    // (`__val: [c_ulong; 16]`) and FreeBSD (`__bits: [u32; 4]`). Gate the
    // explicit impl to everywhere it's NOT already a primitive.
    #[cfg(all(unix, not(target_vendor = "apple")))]
    unsafe impl Zeroable for libc::sigset_t {}
    #[cfg(unix)]
    unsafe impl Zeroable for libc::utsname {}
    #[cfg(unix)]
    unsafe impl Zeroable for libc::winsize {}
    #[cfg(unix)]
    unsafe impl Zeroable for libc::rlimit {}
    #[cfg(unix)]
    unsafe impl Zeroable for libc::passwd {}
    #[cfg(unix)]
    unsafe impl Zeroable for libc::stat {}
    #[cfg(unix)]
    unsafe impl Zeroable for libc::rusage {}
    #[cfg(unix)]
    unsafe impl Zeroable for libc::timespec {}
    #[cfg(unix)]
    unsafe impl Zeroable for libc::timeval {}
    #[cfg(unix)]
    unsafe impl Zeroable for libc::pollfd {}
    #[cfg(unix)]
    unsafe impl Zeroable for libc::Dl_info {}
    #[cfg(unix)]
    unsafe impl Zeroable for libc::sockaddr {}
    #[cfg(unix)]
    unsafe impl Zeroable for libc::sockaddr_in {}
    #[cfg(unix)]
    unsafe impl Zeroable for libc::sockaddr_in6 {}
    #[cfg(unix)]
    unsafe impl Zeroable for libc::sockaddr_storage {}
    #[cfg(unix)]
    unsafe impl Zeroable for libc::addrinfo {}
    #[cfg(any(target_os = "linux", target_os = "android"))]
    unsafe impl Zeroable for libc::sysinfo {}
    #[cfg(any(target_os = "linux", target_os = "android"))]
    unsafe impl Zeroable for libc::epoll_event {}
    #[cfg(any(target_os = "linux", target_os = "android"))]
    unsafe impl Zeroable for libc::signalfd_siginfo {}
    #[cfg(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        target_os = "freebsd"
    ))]
    unsafe impl Zeroable for libc::statfs {}
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd"
    ))]
    unsafe impl Zeroable for libc::kevent {}
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    unsafe impl Zeroable for libc::kevent64_s {}
    #[cfg(target_os = "freebsd")]
    unsafe impl Zeroable for libc::_umtx_time {}

    // Windows POD — `bun_windows_sys` `#[repr(C)]` out-param structs that are
    // zero-init before the kernel fills them. All fields are integers / raw
    // pointers / nested POD; audited against the Win32 SDK headers (S016).
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::IO_STATUS_BLOCK {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::FILE_BASIC_INFORMATION {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::BY_HANDLE_FILE_INFORMATION {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::WIN32_FILE_ATTRIBUTE_DATA {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::OBJECT_ATTRIBUTES {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::UNICODE_STRING {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::SECURITY_ATTRIBUTES {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::FILETIME {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::ws2_32::WSADATA {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::ws2_32::sockaddr_storage {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::ws2_32::sockaddr_in {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::ws2_32::sockaddr_in6 {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::ws2_32::addrinfo {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::IO_COUNTERS {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::JOBOBJECT_BASIC_LIMIT_INFORMATION {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::JOBOBJECT_EXTENDED_LIMIT_INFORMATION {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::OVERLAPPED {}
    #[cfg(windows)]
    unsafe impl Zeroable for bun_windows_sys::externs::PROCESS_INFORMATION {}

    /// Conjure a value of a zero-sized type without `unsafe` at the call site.
    ///
    /// This is the monomorphised-ZST-handler trick: a fn item or capture-less
    /// closure has `size_of == 0`, so the empty bit-pattern is its only
    /// (trivially valid) value. The size constraint is a `const { assert! }`,
    /// so passing a non-ZST `H` is a *compile* error at the monomorphisation
    /// site rather than runtime UB — which is what makes this fn safe (S016).
    ///
    /// Replaces the `// SAFETY: H is a ZST → mem::zeroed()` comment repeated
    /// at every callback trampoline that smuggles a generic `H: Fn*` through C
    /// (`uws_sys::thunk`, `sql_jsc::IntoJSHostFn`, `server_body::route_thunk`).
    #[inline(always)]
    pub fn conjure_zst<H>() -> H {
        const {
            assert!(
                core::mem::size_of::<H>() == 0,
                "conjure_zst: H must be a ZST (fn item or capture-less closure)"
            )
        };
        // SAFETY: `size_of::<H>() == 0` (compile-time asserted above), so the
        // value occupies no bytes and `zeroed()` writes nothing. Every call
        // site bounds `H: Fn*` (fn items / capture-less closures), and those
        // are always inhabited — uninhabited ZSTs (`!`, `Infallible`) do not
        // implement the `Fn` traits and so cannot reach a real instantiation.
        unsafe { core::mem::zeroed() }
    }

    /// Pointer to the calling thread's libc `errno` (Zig: `std.c._errno()`).
    ///
    /// Single audited cfg-ladder over the per-libc TLS accessor symbol so the
    /// tree has ONE place that knows glibc/musl spell it `__errno_location()`,
    /// bionic spells it `__errno()`, Darwin/BSD spell it `__error()`, and the
    /// Windows CRT spells it `_errno()`. Every higher-tier crate routes through
    /// this — `bun_errno::posix::errno`, `bun_sys::last_errno`,
    /// `bun_sys::c::errno_location`, `bun_platform::linux` — instead of each
    /// re-deriving the same target_os→symbol mapping.
    ///
    /// Obtaining the pointer has no preconditions (the per-libc TLS accessor
    /// takes no args and never returns null); the deref obligation lives at
    /// the call site. The returned pointer is valid for the calling thread's
    /// lifetime — `*mut c_int` is `!Send`, so the cross-thread hazard is
    /// already type-enforced.
    #[inline(always)]
    pub fn errno_ptr() -> *mut core::ffi::c_int {
        // Per-libc TLS errno accessor: no args, never null, no preconditions.
        // `safe fn` discharges the link-time proof so the body is a plain
        // call; only the per-platform symbol *name* varies, expressed via
        // `#[cfg_attr(.., link_name = ..)]` on a single declaration.
        unsafe extern "C" {
            #[cfg_attr(
                any(
                    target_os = "macos",
                    target_os = "ios",
                    target_os = "freebsd",
                    target_os = "dragonfly"
                ),
                link_name = "__error"
            )]
            #[cfg_attr(target_os = "android", link_name = "__errno")]
            #[cfg_attr(windows, link_name = "_errno")]
            #[cfg_attr(
                all(
                    unix,
                    not(any(
                        target_os = "macos",
                        target_os = "ios",
                        target_os = "freebsd",
                        target_os = "dragonfly",
                        target_os = "android"
                    ))
                ),
                link_name = "__errno_location"
            )]
            safe fn errno_location() -> *mut core::ffi::c_int;
        }
        errno_location()
    }

    /// Read the calling thread's libc `errno` (Zig: `std.c._errno().*`).
    /// Safe wrapper over `*errno_ptr()`.
    #[inline(always)]
    pub fn errno() -> core::ffi::c_int {
        // SAFETY: `errno_ptr()` returns a valid thread-local int* for the
        // calling thread's lifetime on every supported target.
        unsafe { *errno_ptr() }
    }
}

pub mod asan {
    //! Low-tier mirror of `src/safety/asan.zig`. `bun_safety` depends on
    //! `bun_core`, so the implementation lives here and `bun_safety::asan`
    //! re-uses the same `cfg(bun_asan)` gate. Callers in `bun_jsc`,
    //! `bun_runtime`, and `bun_collections` reach the real LSAN/ASAN runtime
    //! through this module — it must NOT be a no-op stub or LSAN root-region
    //! registration (`VirtualMachine::rare_data`, `Listener.group`) silently
    //! does nothing and every malloc-backed `us_socket_t` reachable only via a
    //! mimalloc page is reported as a leak.
    use core::ffi::c_void;

    pub const ENABLED: bool = cfg!(bun_asan);

    #[cfg(bun_asan)]
    unsafe extern "C" {
        // The ASAN/LSAN runtime never dereferences `ptr` — it indexes shadow
        // memory by address value (poison/unpoison/is_poisoned/describe) or
        // records the range in an internal table (LSAN root regions). Misuse
        // produces a controlled abort, not UB, so `safe fn` discharges the
        // link-time proof and callers need no `unsafe` block. The *logical*
        // "you own this region" precondition is advisory only — violating it
        // trips an ASAN report (controlled abort), never language-level UB —
        // so the public wrappers below are likewise safe `fn`s.
        safe fn __asan_poison_memory_region(ptr: *const c_void, size: usize);
        safe fn __asan_unpoison_memory_region(ptr: *const c_void, size: usize);
        safe fn __asan_address_is_poisoned(ptr: *const c_void) -> bool;
        safe fn __asan_describe_address(ptr: *const c_void);
        safe fn __lsan_register_root_region(ptr: *const c_void, size: usize);
        safe fn __lsan_unregister_root_region(ptr: *const c_void, size: usize);
    }

    #[inline]
    pub fn poison(ptr: *const u8, size: usize) {
        #[cfg(bun_asan)]
        __asan_poison_memory_region(ptr.cast(), size);
        #[cfg(not(bun_asan))]
        let _ = (ptr, size);
    }
    #[inline]
    pub fn unpoison(ptr: *const u8, size: usize) {
        #[cfg(bun_asan)]
        __asan_unpoison_memory_region(ptr.cast(), size);
        #[cfg(not(bun_asan))]
        let _ = (ptr, size);
    }
    #[inline]
    pub fn poison_slice<T>(s: &[T]) {
        poison(s.as_ptr().cast(), core::mem::size_of_val(s))
    }
    #[inline]
    pub fn unpoison_slice<T>(s: &[T]) {
        unpoison(s.as_ptr().cast(), core::mem::size_of_val(s))
    }
    #[inline]
    pub fn assert_unpoisoned<T>(ptr: *const T) {
        #[cfg(bun_asan)]
        if __asan_address_is_poisoned(ptr.cast()) {
            __asan_describe_address(ptr.cast());
            panic!("Address is poisoned");
        }
        #[cfg(not(bun_asan))]
        let _ = ptr;
    }
    /// Tell LSAN to scan `[ptr, ptr+size)` for live pointers during leak
    /// checking. Needed when a malloc-backed object is reachable only through
    /// a pointer that itself lives inside a mimalloc page (which LSAN does not
    /// scan).
    #[inline]
    pub fn register_root_region(ptr: *const c_void, size: usize) {
        #[cfg(bun_asan)]
        __lsan_register_root_region(ptr, size);
        #[cfg(not(bun_asan))]
        let _ = (ptr, size);
    }
    /// Undo a prior `register_root_region(ptr, size)` with identical arguments.
    #[inline]
    pub fn unregister_root_region(ptr: *const c_void, size: usize) {
        #[cfg(bun_asan)]
        __lsan_unregister_root_region(ptr, size);
        #[cfg(not(bun_asan))]
        let _ = (ptr, size);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// PHASE-C: glibc-compat / link wraps. Zig: src/workaround_missing_symbols.zig.
// build.ninja links with `-Wl,--wrap=gettid` so libc/std references land here.
// ────────────────────────────────────────────────────────────────────────────
#[cfg(target_os = "linux")]
#[unsafe(no_mangle)]
pub extern "C" fn __wrap_gettid() -> libc::pid_t {
    // SAFETY: SYS_gettid takes no arguments and never fails.
    unsafe { libc::syscall(libc::SYS_gettid) as libc::pid_t }
}

/// `bun.getTotalMemorySize()` (bun.zig:3498) — process-wide RAM budget,
/// cgroup/jetsam-aware. Backed by the linked C++ `Bun__ramSize()`
/// (src/jsc/bindings/c-bindings.cpp). Lives in `bun_core` so both
/// `bun_runtime` (node:fs preallocation guard) and the binary root can
/// call it without re-declaring the C ABI.
pub fn get_total_memory_size() -> usize {
    unsafe extern "C" {
        // Pure FFI into Bun's C++ bindings; no arguments, no invariants.
        safe fn Bun__ramSize() -> usize;
    }
    Bun__ramSize()
}

/// PHASE-C: stack capture for `Global::StoredTrace` / `bun_crash_handler`.
/// Zig used `std.debug.captureStackTrace`; route through libc `backtrace()`.
///
/// Only platforms whose libc actually exports `backtrace()` go through it:
/// glibc, macOS, the BSDs. musl and Android's bionic don't have `<execinfo.h>`
/// (the `libc` crate doesn't expose `backtrace` for them at all), so those
/// targets — and Windows — fall back to reporting an empty trace. The crash
/// handler already tolerates a 0-frame capture (it prints what it has), and
/// the symbolizer path is glibc/macOS-only anyway.
#[cfg(any(
    all(target_os = "linux", target_env = "gnu"),
    target_os = "macos",
    target_os = "freebsd",
    target_os = "dragonfly",
    target_os = "netbsd",
    target_os = "openbsd",
))]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__captureStackTrace(begin: usize, out: *mut usize, cap: usize) -> usize {
    if out.is_null() || cap == 0 {
        return 0;
    }
    unsafe {
        // FreeBSD's libexecinfo backtrace() takes/returns size_t; glibc/macOS use int.
        #[cfg(any(
            target_os = "freebsd",
            target_os = "dragonfly",
            target_os = "netbsd",
            target_os = "openbsd"
        ))]
        let n = libc::backtrace(out.cast::<*mut core::ffi::c_void>(), cap) as usize;
        #[cfg(not(any(
            target_os = "freebsd",
            target_os = "dragonfly",
            target_os = "netbsd",
            target_os = "openbsd"
        )))]
        let n = libc::backtrace(
            out.cast::<*mut core::ffi::c_void>(),
            cap as core::ffi::c_int,
        );
        #[cfg(not(any(
            target_os = "freebsd",
            target_os = "dragonfly",
            target_os = "netbsd",
            target_os = "openbsd"
        )))]
        let n = if n < 0 { 0 } else { n as usize };
        if begin > 0 && begin < n {
            core::ptr::copy(out.add(begin), out, n - begin);
            return n - begin;
        }
        n
    }
}

/// Windows: `RtlCaptureStackBackTrace` (kernel32/ntdll). Zig's
/// `std.debug.captureStackTrace` uses this on Windows. No DbgHelp dependency
/// for capture; symbolization happens later in `dump_stack_trace`.
#[cfg(windows)]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__captureStackTrace(begin: usize, out: *mut usize, cap: usize) -> usize {
    if out.is_null() || cap == 0 {
        return 0;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn RtlCaptureStackBackTrace(
            FramesToSkip: u32,
            FramesToCapture: u32,
            BackTrace: *mut *mut core::ffi::c_void,
            BackTraceHash: *mut u32,
        ) -> u16;
    }
    // `FramesToCapture` is bounded at `u16::MAX` by the API; clamp.
    let cap_u32 = cap.min(u16::MAX as usize) as u32;
    // SAFETY: FFI; `out` is valid for `cap` writes, hash ptr may be null.
    let n = unsafe {
        RtlCaptureStackBackTrace(
            0,
            cap_u32,
            out as *mut *mut core::ffi::c_void,
            core::ptr::null_mut(),
        )
    } as usize;
    // Match the unix arm's `begin` semantics: treat `begin` as a small skip
    // count when in `[1, n)`, otherwise ignore (callers also pass an address
    // here, which is always > n and so a no-op).
    if begin > 0 && begin < n {
        // SAFETY: `begin < n ≤ cap`; copying `n - begin` words within `out[..n]`.
        unsafe {
            core::ptr::copy(out.add(begin), out, n - begin);
        }
        return n - begin;
    }
    n
}

/// Fallback for targets without `libc::backtrace` (musl, Android, …).
/// Returns 0 frames so callers degrade to a frame-less crash report instead of
/// failing to compile.
#[cfg(not(any(
    all(target_os = "linux", target_env = "gnu"),
    target_os = "macos",
    target_os = "freebsd",
    target_os = "dragonfly",
    target_os = "netbsd",
    target_os = "openbsd",
    windows,
)))]
#[unsafe(no_mangle)]
pub extern "C" fn Bun__captureStackTrace(begin: usize, out: *mut usize, cap: usize) -> usize {
    let _ = (begin, out, cap);
    0
}

/// Safe wrapper over the cfg-gated `Bun__captureStackTrace` definitions above.
/// Single canonical entry point — `StoredTrace::capture` and
/// `bun_crash_handler::debug::capture_stack_trace` both route through this so
/// no caller re-declares the `extern "C"` import.
#[inline]
pub fn capture_stack_trace(begin: usize, addrs: &mut [usize]) -> usize {
    // Direct Rust call into the same-crate `extern "C" fn` above (not an FFI
    // import), so no `unsafe` needed; the impl writes at most `addrs.len()` words.
    Bun__captureStackTrace(begin, addrs.as_mut_ptr(), addrs.len())
}

/// Zig `@returnAddress()` placeholder. Rust has no stable equivalent; `0` tells
/// `capture_stack_trace` "start from here". Lives in bun_core so the canonical
/// `StoredTrace::capture` can call it; once wired to a real intrinsic, every
/// caller (incl. `bun_crash_handler::debug::return_address`) picks it up.
#[inline(always)]
pub fn return_address() -> usize {
    0
}

/// Ports of `std.debug.{SourceLocation,SymbolInfo}` — pure data structs shared by
/// crash_handler's stub `debug` mod and btjs's `zig_std_debug`. Neither of those
/// crates can depend on the other, so the canonical home is here (alongside
/// `capture_stack_trace`/`return_address`) pending a dedicated `bun_debug` crate.
pub mod debug {
    /// Zig: `std.debug.SourceLocation`.
    #[derive(Clone)]
    pub struct SourceLocation {
        pub file_name: Box<[u8]>,
        pub line: u32,
        pub column: u32,
    }

    /// Zig: `std.debug.SymbolInfo`.
    pub struct SymbolInfo {
        pub name: Box<[u8]>,
        pub compile_unit_name: Box<[u8]>,
        pub source_location: Option<SourceLocation>,
    }
}
