// Things that maybe should go in Zig standard library at some point
//
// PORT NOTE: This file is almost entirely comptime type reflection (`@typeInfo`,
// `@hasField`, `@hasDecl`, `std.meta.fields`, `bun.trait.*`) used to generically
// construct maps/arrays from heterogeneous inputs. Rust has no runtime/comptime
// type reflection; the idiomatic equivalents are the `From` / `FromIterator` /
// `Extend` traits, plus associated types for `Key`/`Value`/`Of`. The functions
// below preserve the Zig names and intent but delegate to traits that the
// concrete collection types (HashMap, Vec, MultiArrayList, Vec) must impl.
// Phase B: audit call sites of `bun.from(...)` / `bun.fromEntries(...)` and
// likely replace them with direct `.collect()` / `Vec::from` at the caller.

use core::hash::Hash;

use bun_alloc::AllocError;
// TODO(b0): impls for bun_collections::{VecExt, HashMap, MultiArrayList} move to
// bun_collections (move-in pass) — orphan rule lets the higher-tier crate impl
// MapLike/ArrayLike for its own types.

// ─── Key / Value ──────────────────────────────────────────────────────────────
// Zig: `pub fn Key(comptime Map: type) type { return FieldType(Map.KV, "key").?; }`
// Zig: `pub fn Value(comptime Map: type) type { return FieldType(Map.KV, "value").?; }`
//
// Rust has no `fn -> type`; these become associated types on a trait that all
// map-like collections implement.
pub trait MapLike {
    type Key;
    type Value;

    fn ensure_unused_capacity(&mut self, additional: usize) -> Result<(), AllocError>;
    fn put_assume_capacity(&mut self, key: Self::Key, value: Self::Value);
    fn put_assume_capacity_no_clobber(&mut self, key: Self::Key, value: Self::Value);
}

// Convenience aliases mirroring the Zig `Key(Map)` / `Value(Map)` call sites.
pub type Key<M> = <M as MapLike>::Key;
pub type Value<M> = <M as MapLike>::Value;

// ─── fromEntries ──────────────────────────────────────────────────────────────
// Zig dispatches on `@typeInfo(EntryType)`:
//   - indexable tuple/array of `[k, v]` pairs  → reserve + putAssumeCapacity
//   - container with `.count()` + `.iterator()` → reserve + iterate
//   - struct with fields                        → reserve(fields.len) + inline for
//   - *const struct with fields                 → same, deref'd
//   - else: @compileError
//
// In Rust the first two arms collapse to `IntoIterator<Item = (K, V)>` with an
// `ExactSizeIterator` bound for the reserve; the "struct fields as entries"
// arms have no equivalent (would need a derive) and are TODO'd.
pub fn from_entries<M, I>(entries: I) -> Result<M, AllocError>
where
    M: MapLike + Default,
    I: IntoIterator<Item = (M::Key, M::Value)>,
    I::IntoIter: ExactSizeIterator,
{
    // Zig: `if (@hasField(Map, "allocator")) Map.init(allocator) else Map{}`
    // Allocator param dropped (non-AST crate); both arms become `Default`.
    let mut map = M::default();

    let iter = entries.into_iter();

    // Zig: `try map.ensureUnusedCapacity([allocator,] entries.len)` — the
    // `needsAllocator` check vanishes because the allocator param is gone.
    map.ensure_unused_capacity(iter.len())?;

    for (k, v) in iter {
        // PERF(port): was putAssumeCapacity — profile in Phase B
        map.put_assume_capacity(k, v);
    }

    // TODO(port): the Zig `bun.trait.isContainer(EntryType) && fields.len > 0`
    // and `isConstPtr(EntryType) && fields(Child).len > 0` arms iterated *struct
    // fields* as entries (anonymous-struct-literal init). No Rust equivalent
    // without a proc-macro; callers should pass an array/iterator of tuples.

    Ok(map)
}

// ─── fromMapLike ──────────────────────────────────────────────────────────────
// Zig: takes `[]const struct { K, V }` and `putAssumeCapacityNoClobber`s each.
pub fn from_map_like<M>(entries: &[(M::Key, M::Value)]) -> Result<M, AllocError>
where
    M: MapLike + Default,
    M::Key: Clone,
    M::Value: Clone,
{
    // Zig: `if (@hasField(Map, "allocator")) Map.init(allocator) else Map{}`
    let mut map = M::default();

    map.ensure_unused_capacity(entries.len())?;

    for entry in entries {
        map.put_assume_capacity_no_clobber(entry.0.clone(), entry.1.clone());
    }

    Ok(map)
}

// ─── FieldType ────────────────────────────────────────────────────────────────
// Zig: `pub fn FieldType(comptime Map: type, comptime name: []const u8) ?type`
// TODO(port): no Rust equivalent for `std.meta.fieldIndex` / `.field_type`.
// Callers should use associated types (`MapLike::Key`, `ArrayLike::Elem`)
// directly. Left as a doc-only marker so cross-file grep finds it.
#[doc(hidden)]
pub enum FieldType {} // unconstructible; reflection placeholder

// ─── Of ───────────────────────────────────────────────────────────────────────
// Zig: element type of an array-like, probed via isSlice / @hasDecl("Elem") /
// @hasField("items") / @hasField("ptr").
//
// Rust: associated type on a trait the array-like containers implement.
pub trait ArrayLike {
    type Elem;

    fn ensure_unused_capacity(&mut self, additional: usize) -> Result<(), AllocError>;
    fn append_assume_capacity(&mut self, elem: Self::Elem);
    /// Set `len` to `n` (caller has already reserved) and return the now-live
    /// slice for bulk memcpy. Mirrors the Zig `map.items.len = n; slice = map.items`.
    fn set_len_and_slice(&mut self, n: usize) -> &mut [Self::Elem];
}

pub type Of<A> = <A as ArrayLike>::Elem;

// ─── from ─────────────────────────────────────────────────────────────────────
// Zig: generic dispatcher that inspects `@TypeOf(default)` and routes to
// fromSlice / fromMapLike / fromEntries. The dispatch is pure comptime
// reflection on the *shape* of the input type.
//
// TODO(port): Rust cannot introspect "is this a slice / does it have .items /
// does it have .put". Phase B should delete this fn and have each call site
// call `from_slice` / `from_entries` / `from_map_like` directly (the caller
// always statically knows which one it wants). Kept as a thin slice-only
// forwarder so existing `bun.from(Array, alloc, &[...])` call sites compile.
#[inline]
pub fn from<A>(default: &[A::Elem]) -> Result<A, AllocError>
where
    A: ArrayLike + Default,
    A::Elem: Copy,
{
    from_slice(default)
}

// ─── fromSlice ────────────────────────────────────────────────────────────────
// Zig branches on the *target* type:
//   - MultiArrayList (`@hasField "bytes"`): reserve + appendAssumeCapacity loop
//   - ArrayList (`@hasField "items"`): reserve, set items.len, memcpy
//   - Vec-ish (`@hasField "len"`): reserve, set len, memcpy
//   - raw slice: allocator.alloc + memcpy, return slice
//   - has `.ptr`: alloc + build `{ptr,len,cap}`
pub fn from_slice<A>(default: &[A::Elem]) -> Result<A, AllocError>
where
    A: ArrayLike + Default,
    A::Elem: Copy,
{
    // Zig: `if (isSlice) {} else if (@hasField "allocator") init(a) else Array{}`
    let mut map = A::default();

    // TODO(port): the Zig MultiArrayList arm (`@hasField(Array, "bytes")`)
    // appended element-by-element because SoA storage cannot be memcpy'd as one
    // block. The trait impl for `MultiArrayList<T>` must override
    // `set_len_and_slice` to panic and instead route through
    // `append_assume_capacity`. For now we take the memcpy path and rely on the
    // impl to do the right thing.

    map.ensure_unused_capacity(default.len())?;

    let slice = map.set_len_and_slice(default.len());

    // Zig: `@memcpy(out[0..in.len], in)` over `sliceAsBytes`
    slice.copy_from_slice(default);

    Ok(map)
}

/// The "target is a plain `[]T`" arm of Zig `fromSlice`: `allocator.alloc` +
/// memcpy + return the slice. In Rust this is just `Box<[T]>::from`.
pub fn from_slice_boxed<T: Copy>(default: &[T]) -> Box<[T]> {
    // Zig: `slice = try allocator.alloc(Of(Array), default.len); @memcpy(...)`
    Box::<[T]>::from(default)
}

// ─── std.mem.bytesAsSlice / sliceAsBytes ─────────────────────────────────────
/// Zig `std.mem.bytesAsSlice(T, bytes)` for `&mut [u8]` → `&mut [T]`.
///
/// SAFETY (caller-upheld):
/// * `bytes.as_ptr()` must be aligned to `align_of::<T>()` — Zig spells this
///   as `@alignCast`, which is a *checked* operation (illegal-behavior trap in
///   safe builds). We mirror that with a hard `assert!` rather than
///   `debug_assert!`: forming a misaligned `&mut [T]` is instant UB in Rust
///   even if never dereferenced, so this must not be silently elided in
///   release. The check is a single AND+CMP and every current call site is
///   immediately followed by a syscall, so the cost is negligible.
/// * `T` must be plain-old-data — every byte pattern in `bytes[..len/size]`
///   must be a valid `T` (callers use `u16`/`u32` only),
/// * the trailing `len % size_of::<T>()` bytes are silently dropped from the
///   reinterpreted view, matching Zig's `bytesAsSlice` semantics.
#[inline]
pub unsafe fn bytes_as_slice_mut<T>(bytes: &mut [u8]) -> &mut [T] {
    assert!(
        bytes.as_ptr().cast::<T>().is_aligned(),
        "bytes_as_slice_mut: misaligned for {}",
        core::any::type_name::<T>(),
    );
    let len = bytes.len() / core::mem::size_of::<T>();
    // SAFETY: alignment + validity preconditions documented above.
    unsafe { core::slice::from_raw_parts_mut(bytes.as_mut_ptr().cast::<T>(), len) }
}

/// Same as [`bytes_as_slice_mut`] — alias kept for call sites ported from
/// `bun.reinterpretSlice(T, &buf)` (Zig) which is spelled differently but is
/// identical to `std.mem.bytesAsSlice` for the `&mut [u8]` → `&mut [T]` shape.
#[inline]
pub unsafe fn reinterpret_slice<T>(bytes: &mut [u8]) -> &mut [T] {
    // SAFETY: forwarded to bytes_as_slice_mut; caller upholds its contract.
    unsafe { bytes_as_slice_mut::<T>(bytes) }
}

// ─── Unaligned<T> ─────────────────────────────────────────────────────────────
/// Port of Zig's `align(1) T` element type. Rust references and slices require
/// natural alignment for `T`; producing a `&[u16]` from an odd address is
/// instant UB even if never dereferenced. `#[repr(packed)]` on this wrapper
/// drops the alignment requirement to 1, so `&[Unaligned<T>]` is the sound
/// translation of `[]align(1) T`. Reads/writes go through `ptr::read_unaligned`
/// / `ptr::write_unaligned` (the compiler emits byte-wise or unaligned-load
/// instructions as appropriate for the target).
#[repr(C, packed)]
#[derive(Copy, Clone)]
pub struct Unaligned<T: Copy>(T);

impl<T: Copy> Unaligned<T> {
    #[inline(always)]
    pub const fn new(value: T) -> Self {
        Self(value)
    }

    #[inline(always)]
    pub fn get(self) -> T {
        // `self` is by-value (already moved into an aligned local), so a plain
        // field read is fine; the `packed` repr only affects in-place borrows.
        self.0
    }

    #[inline(always)]
    pub fn set(&mut self, value: T) {
        // SAFETY: `self` points to `size_of::<T>()` writable bytes; alignment
        // is 1 by `#[repr(packed)]`, hence `write_unaligned`.
        unsafe { core::ptr::addr_of_mut!(self.0).write_unaligned(value) }
    }

    /// Reinterpret `&[Unaligned<T>]` as `&[T]` once the caller has proven
    /// `ptr` is naturally aligned (Zig `@alignCast`). Panics in debug if not.
    #[inline]
    pub fn slice_align_cast(slice: &[Unaligned<T>]) -> &[T] {
        debug_assert!(
            (slice.as_ptr() as usize) % core::mem::align_of::<T>() == 0,
            "Unaligned::slice_align_cast: pointer is not {}-byte aligned",
            core::mem::align_of::<T>(),
        );
        // SAFETY: same address, same length, same element size; alignment
        // precondition asserted above. `Unaligned<T>` is `repr(C, packed)`
        // around a single `T`, so layout is byte-identical.
        unsafe { core::slice::from_raw_parts(slice.as_ptr().cast::<T>(), slice.len()) }
    }

    /// Mutable counterpart of [`slice_align_cast`].
    #[inline]
    pub fn slice_align_cast_mut(slice: &mut [Unaligned<T>]) -> &mut [T] {
        debug_assert!(
            (slice.as_ptr() as usize) % core::mem::align_of::<T>() == 0,
            "Unaligned::slice_align_cast_mut: pointer is not {}-byte aligned",
            core::mem::align_of::<T>(),
        );
        // SAFETY: see `slice_align_cast`; `&mut` exclusivity is preserved.
        unsafe { core::slice::from_raw_parts_mut(slice.as_mut_ptr().cast::<T>(), slice.len()) }
    }
}

// ─── needsAllocator ───────────────────────────────────────────────────────────
// Zig: `fn needsAllocator(comptime Fn: anytype) bool { ArgsTuple(Fn).len > 2 }`
// Used only to decide whether to pass `allocator` to `ensureUnusedCapacity`.
// Allocator params are dropped in Rust (non-AST crate), so this is dead.
// TODO(port): delete once all callers are migrated.
#[doc(hidden)]
#[inline(always)]
const fn needs_allocator() -> bool {
    false
}

// ─── trait impls for concrete collections ─────────────────────────────────────
// PORT NOTE: these did not exist in the Zig — they are the Rust replacement for
// the `@hasField` / `@hasDecl` probes. Impls for HashMap/Vec/MultiArrayList
// live in `bun_collections` (move-in pass) to respect crate tiering.

impl<T> ArrayLike for Vec<T> {
    type Elem = T;

    fn ensure_unused_capacity(&mut self, additional: usize) -> Result<(), AllocError> {
        self.reserve(additional);
        Ok(())
    }
    fn append_assume_capacity(&mut self, elem: T) {
        // PERF(port): was appendAssumeCapacity
        self.push(elem);
    }
    fn set_len_and_slice(&mut self, n: usize) -> &mut [T] {
        debug_assert!(self.capacity() >= n);
        // SAFETY: capacity reserved above; caller immediately memcpy-fills [0..n].
        // Matches Zig `map.items.len = default.len; slice = map.items;` which
        // also exposes uninitialized memory until the subsequent @memcpy.
        unsafe { self.set_len(n) };
        self.as_mut_slice()
    }
}

// TODO(b0): ArrayLike impls for Vec<T> and MultiArrayList<T> arrive via
// move-in pass in bun_collections.

// ════════════════════════════════════════════════════════════════════════════
// Low-tier primitives hoisted into bun_core.
// Forward-referenced as `crate::X` by Global.rs / output.rs / fmt.rs / env.rs.
// Source bodies extracted from the corresponding .zig (ground truth).
// ════════════════════════════════════════════════════════════════════════════

// ─── ZStr / WStr / zstr! (from bun_str) ───────────────────────────────────
// Zig: `[:0]const u8` / `[:0]const u16` — slice with sentinel. Rust models the
// borrowed forms as DSTs over the byte/u16 slice (NUL not counted in len).
// TYPE_ONLY move-down; full impls (from_raw, as_cstr, …) live in bun_str which
// re-exports these via `pub use bun_core::{ZStr, WStr}`.

/// Borrowed `[:0]const u8` — bytes are valid UTF-8-ish, len excludes the NUL.
#[repr(transparent)]
pub struct ZStr([u8]);

impl ZStr {
    pub const EMPTY: &'static ZStr = unsafe { Self::from_raw(b"\0".as_ptr(), 0) };

    /// SAFETY: `ptr[len] == 0` and `ptr[..len]` is readable for `'a`.
    #[inline]
    pub const unsafe fn from_raw<'a>(ptr: *const u8, len: usize) -> &'a ZStr {
        unsafe { &*(std::ptr::from_ref::<[u8]>(core::slice::from_raw_parts(ptr, len)) as *const ZStr) }
    }
    /// SAFETY: `ptr[len] == 0` and `ptr[..=len]` is writable for `'a`.
    #[inline]
    pub unsafe fn from_raw_mut<'a>(ptr: *mut u8, len: usize) -> &'a mut ZStr {
        unsafe { &mut *(std::ptr::from_mut::<[u8]>(core::slice::from_raw_parts_mut(ptr, len)) as *mut ZStr) }
    }
    /// Wrap a `&'static [u8]` literal that already includes the trailing
    /// `\0` (e.g. `b".\0"`). The returned `&ZStr` excludes the NUL from
    /// `len()` per the type invariant. Panics in debug if no trailing NUL.
    #[inline]
    pub const fn from_static(s: &'static [u8]) -> &'static ZStr {
        debug_assert!(!s.is_empty() && s[s.len() - 1] == 0);
        // SAFETY: caller-supplied literal ends in NUL; lifetime is 'static.
        unsafe { Self::from_raw(s.as_ptr(), s.len() - 1) }
    }
    /// Borrow `buf[..len]` as a `&ZStr`, where `buf[len] == 0`. This is the
    /// safe-surface form of [`from_raw`] for the dominant call shape in the
    /// install pipeline: a stack `PathBuffer` filled to `len` with a NUL
    /// written at `buf[len]`. The slice bound proves `buf[..=len]` is in the
    /// same allocation; the NUL is debug-asserted.
    #[inline]
    pub fn from_buf(buf: &[u8], len: usize) -> &ZStr {
        debug_assert!(len < buf.len(), "ZStr::from_buf: NUL must lie within buf");
        debug_assert_eq!(buf[len], 0, "ZStr::from_buf: missing NUL at buf[len]");
        // SAFETY: `buf[..=len]` is in-bounds (debug-asserted above; release
        // relies on caller upholding the documented `buf[len] == 0`
        // precondition, same contract as Zig `[:0]const u8` slicing).
        unsafe { Self::from_raw(buf.as_ptr(), len) }
    }
    /// Borrow `buf[..buf.len()-1]` as a `&ZStr`, where the last byte of `buf`
    /// is the NUL terminator. This is [`from_buf`] specialized for the second
    /// most common call shape: a slice that already includes its trailing NUL
    /// (e.g. a `Vec<u8>` with `0` pushed, or `CStr::to_bytes_with_nul`).
    /// Debug-asserts the trailing NUL; release relies on the documented
    /// precondition (same contract as Zig `[:0]const u8` slicing).
    #[inline]
    pub fn from_slice_with_nul(buf: &[u8]) -> &ZStr {
        debug_assert!(!buf.is_empty(), "ZStr::from_slice_with_nul: empty slice");
        debug_assert_eq!(buf[buf.len() - 1], 0, "ZStr::from_slice_with_nul: missing trailing NUL");
        // SAFETY: `buf[buf.len()-1] == 0` (debug-asserted; caller contract in
        // release) and `buf[..buf.len()-1]` is in-bounds by slice invariant.
        unsafe { Self::from_raw(buf.as_ptr(), buf.len() - 1) }
    }
    /// Mutable variant of [`from_buf`].
    #[inline]
    pub fn from_buf_mut(buf: &mut [u8], len: usize) -> &mut ZStr {
        debug_assert!(len < buf.len());
        debug_assert_eq!(buf[len], 0);
        // SAFETY: see `from_buf`.
        unsafe { Self::from_raw_mut(buf.as_mut_ptr(), len) }
    }
    #[inline] pub const fn as_bytes(&self) -> &[u8] { &self.0 }
    #[inline] pub const fn len(&self) -> usize { self.0.len() }
    #[inline] pub const fn is_empty(&self) -> bool { self.0.is_empty() }
    #[inline] pub const fn as_ptr(&self) -> *const core::ffi::c_char { self.0.as_ptr().cast() }
    /// Includes the trailing NUL.
    #[inline]
    pub fn as_bytes_with_nul(&self) -> &[u8] {
        // SAFETY: invariant — byte at `len` is NUL and owned by the same allocation.
        unsafe { core::slice::from_raw_parts(self.0.as_ptr(), self.0.len() + 1) }
    }
    // NOTE: prefer `ZBox` for owned NUL-terminated strings. `Box<ZStr>` is
    // supported only as a transitional shim for ported fields that were typed
    // `Box<ZStr>` before `ZBox` existed (e.g. `PackageManager.cache_directory_path`).
    // The slice metadata of the returned `Box<ZStr>` covers `bytes.len() + 1`
    // (i.e. INCLUDES the trailing NUL) so `Drop` deallocates the full
    // allocation; `as_bytes()` will therefore include the trailing NUL.
    // TODO(port): retire once all `Box<ZStr>` fields are migrated to `ZBox`.
    pub fn boxed(bytes: &[u8]) -> Box<ZStr> {
        let mut v = Vec::with_capacity(bytes.len() + 1);
        v.extend_from_slice(bytes);
        v.push(0);
        let b: Box<[u8]> = v.into_boxed_slice();
        // SAFETY: `ZStr` is a transparent newtype over `[u8]`; the fat-pointer
        // metadata (len = bytes.len()+1) is preserved by the `as *mut ZStr` cast.
        unsafe { crate::heap::take(crate::heap::into_raw(b) as *mut ZStr) }
    }
}

/// Owned, heap-allocated, NUL-terminated byte string. `.len()` / `Deref`
/// **exclude** the trailing NUL — Zig `[:0]u8` semantics. This is the owned
/// counterpart of `&ZStr`; use it where Zig returned an allocated `[:0]u8`.
#[derive(Clone)]
pub struct ZBox(Box<[u8]>); // invariant: last byte == 0
impl Default for ZBox {
    /// Zig: `[:0]const u8 = ""` field default — an empty NUL-terminated string.
    #[inline]
    fn default() -> Self { ZBox(Box::new([0u8; 1])) }
}
impl ZBox {
    /// `v` must end with `0`.
    #[inline]
    pub fn from_vec_with_nul(mut v: Vec<u8>) -> ZBox {
        if v.last() != Some(&0) {
            v.push(0);
        }
        ZBox(v.into_boxed_slice())
    }
    /// Copy `bytes` into a new NUL-terminated allocation. Port of Zig
    /// `allocator.dupeZ(u8, bytes)`.
    #[inline]
    pub fn from_bytes(bytes: impl AsRef<[u8]>) -> ZBox {
        let bytes = bytes.as_ref();
        let mut v = Vec::with_capacity(bytes.len() + 1);
        v.extend_from_slice(bytes);
        v.push(0);
        ZBox(v.into_boxed_slice())
    }
    /// Take ownership of `v` and append a trailing NUL. Port of Zig
    /// `list.toOwnedSliceSentinel(0)`.
    #[inline]
    pub fn from_vec(mut v: Vec<u8>) -> ZBox {
        v.push(0);
        ZBox(v.into_boxed_slice())
    }
    #[inline] pub fn len(&self) -> usize { self.0.len() - 1 }
    #[inline] pub fn is_empty(&self) -> bool { self.len() == 0 }
    #[inline] pub fn as_bytes(&self) -> &[u8] { &self.0[..self.len()] }
    #[inline] pub fn as_bytes_with_nul(&self) -> &[u8] { &self.0 }
    #[inline] pub fn as_ptr(&self) -> *const core::ffi::c_char { self.0.as_ptr().cast() }
    #[inline]
    pub fn as_zstr(&self) -> &ZStr {
        // SAFETY: invariant — `self.0[len] == 0`.
        unsafe { ZStr::from_raw(self.0.as_ptr(), self.len()) }
    }
    #[inline] pub fn into_vec_with_nul(self) -> Vec<u8> { self.0.into_vec() }
}
impl core::ops::Deref for ZBox {
    type Target = ZStr;
    #[inline] fn deref(&self) -> &ZStr { self.as_zstr() }
}
impl core::ops::Deref for ZStr {
    type Target = [u8];
    #[inline] fn deref(&self) -> &[u8] { &self.0 }
}

/// `bun.getenvZ` — read an environment variable. Returns the value as borrowed
/// process-static bytes (env block lives for the process). On POSIX wraps
/// `libc::getenv`; on Windows scans `environ` case-insensitively.
///
/// Port of `bun.zig:getenvZ` / `getenvZAnyCase`.
pub fn getenv_z(key: &ZStr) -> Option<&'static [u8]> {
    #[cfg(not(any(unix, windows)))]
    {
        let _ = key;
        return None;
    }
    #[cfg(unix)]
    unsafe {
        // SAFETY: key is NUL-terminated by ZStr invariant; getenv reads until NUL.
        let p = libc::getenv(key.as_ptr());
        if p.is_null() {
            return None;
        }
        // SAFETY: getenv returns a pointer into the process env block, valid for
        // process lifetime (modulo setenv races — same caveat as Zig original).
        let len = libc::strlen(p);
        return Some(core::slice::from_raw_parts(p.cast::<u8>(), len));
    }
    #[cfg(windows)]
    unsafe {
        // Windows env names are case-insensitive. Zig walks `std.os.environ`
        // (`PEB.ProcessParameters.Environment`) and returns a borrowed slice
        // into the WTF-16 block. Returning a borrowed UTF-8 slice from the
        // wide env would require an intern table; instead use the narrow CRT
        // `getenv`, which on msvcrt/ucrt is case-insensitive and points into
        // the process-lifetime narrow environ block. This covers the ASCII
        // keys actually queried via this path (`UV_THREADPOOL_SIZE`,
        // `GOMAXPROCS`, `BUN_*`). Non-ASCII keys/values go through
        // `bun.DotEnv.Loader` instead.
        // SAFETY: key is NUL-terminated by ZStr invariant; getenv reads until NUL.
        let p = libc::getenv(key.as_ptr());
        if p.is_null() {
            return None;
        }
        // SAFETY: msvcrt getenv returns a pointer into the CRT's narrow environ
        // block, valid for process lifetime (modulo _putenv races — same caveat
        // as Zig original).
        let len = libc::strlen(p);
        Some(core::slice::from_raw_parts(p.cast::<u8>(), len))
    }
}

/// Read the C `environ` global (`*const *const c_char`, NUL-terminated array of
/// NUL-terminated `KEY=VALUE` entries). Single decl for all POSIX call sites.
/// `#[inline]` and allocation-free so it stays async-signal-safe for the
/// post-fork crash-handler child path.
#[cfg(unix)]
#[inline]
pub fn c_environ() -> *const *const core::ffi::c_char {
    unsafe extern "C" {
        static environ: *const *const core::ffi::c_char;
    }
    // SAFETY: `environ` is the libc-managed process env block.
    unsafe { environ }
}

/// `bun.getenvZAnyCase` — case-insensitive env lookup (used on POSIX for
/// CI-detection vars where casing varies across providers).
pub fn getenv_z_any_case(key: &ZStr) -> Option<&'static [u8]> {
    #[cfg(unix)]
    unsafe {
        // SAFETY: `environ` is the C env block; entries are NUL-terminated `KEY=VALUE`.
        let mut p = c_environ();
        while !(*p).is_null() {
            let line = core::slice::from_raw_parts((*p).cast::<u8>(), libc::strlen(*p));
            let key_end = line.iter().position(|&b| b == b'=').unwrap_or(line.len());
            if line[..key_end].len() == key.len()
                && line[..key_end]
                    .iter()
                    .zip(key.as_bytes())
                    .all(|(a, b)| a.eq_ignore_ascii_case(b))
            {
                return Some(&line[(key_end + 1).min(line.len())..]);
            }
            p = p.add(1);
        }
        None
    }
    #[cfg(not(unix))]
    {
        getenv_z(key)
    }
}

/// Borrowed `[:0]const u16` (Windows wide string).
#[repr(transparent)]
pub struct WStr([u16]);

impl WStr {
    pub const EMPTY: &'static WStr = unsafe { Self::from_raw([0u16].as_ptr(), 0) };
    /// SAFETY: `ptr[len] == 0` and `ptr[..len]` is readable for `'a`.
    #[inline]
    pub const unsafe fn from_raw<'a>(ptr: *const u16, len: usize) -> &'a WStr {
        unsafe { &*(std::ptr::from_ref::<[u16]>(core::slice::from_raw_parts(ptr, len)) as *const WStr) }
    }
    /// Borrow `buf[..len]` as a `&WStr`, where `buf[len] == 0`. Safe-surface
    /// form of [`from_raw`] for the dominant call shape: a stack `WPathBuffer`
    /// filled to `len` with a NUL written at `buf[len]`. The slice bound proves
    /// `buf[..=len]` lies in one allocation; the NUL is debug-asserted (release
    /// relies on the documented `buf[len] == 0` precondition — same contract as
    /// Zig `[:0]const u16` slicing). Mirrors [`ZStr::from_buf`].
    #[inline]
    pub fn from_buf(buf: &[u16], len: usize) -> &WStr {
        debug_assert!(len < buf.len(), "WStr::from_buf: NUL must lie within buf");
        debug_assert_eq!(buf[len], 0, "WStr::from_buf: missing NUL at buf[len]");
        // SAFETY: `buf[..=len]` is in-bounds (debug-asserted above; caller
        // contract in release).
        unsafe { Self::from_raw(buf.as_ptr(), len) }
    }
    /// Borrow `buf[..buf.len()-1]` as a `&WStr`, where the last unit of `buf`
    /// is the NUL terminator. Mirrors [`ZStr::from_slice_with_nul`].
    #[inline]
    pub fn from_slice_with_nul(buf: &[u16]) -> &WStr {
        debug_assert!(!buf.is_empty(), "WStr::from_slice_with_nul: empty slice");
        debug_assert_eq!(buf[buf.len() - 1], 0, "WStr::from_slice_with_nul: missing trailing NUL");
        // SAFETY: `buf[buf.len()-1] == 0` (debug-asserted; caller contract in
        // release) and `buf[..buf.len()-1]` is in-bounds by slice invariant.
        unsafe { Self::from_raw(buf.as_ptr(), buf.len() - 1) }
    }
    #[inline] pub const fn as_slice(&self) -> &[u16] { &self.0 }
    #[inline] pub const fn len(&self) -> usize { self.0.len() }
    #[inline] pub const fn as_ptr(&self) -> *const u16 { self.0.as_ptr() }
    /// SAFETY: `ptr[len] == 0` and `ptr[..=len]` is writable for `'a`.
    /// Mirrors [`ZStr::from_raw_mut`] so callers can rewrite UTF-16 path
    /// chars in place (Windows tar path-escape pass) without round-tripping
    /// through an owned buffer.
    #[inline]
    pub unsafe fn from_raw_mut<'a>(ptr: *mut u16, len: usize) -> &'a mut WStr {
        unsafe { &mut *(core::slice::from_raw_parts_mut(ptr, len) as *mut [u16] as *mut WStr) }
    }
    #[inline] pub fn as_mut_slice(&mut self) -> &mut [u16] { &mut self.0 }
}
impl core::ops::Deref for WStr {
    type Target = [u16];
    #[inline] fn deref(&self) -> &[u16] { &self.0 }
}
impl core::ops::DerefMut for WStr {
    #[inline] fn deref_mut(&mut self) -> &mut [u16] { &mut self.0 }
}
impl AsRef<[u16]> for WStr {
    #[inline] fn as_ref(&self) -> &[u16] { &self.0 }
}

/// `wstr!("lit")` → `&'static [u16; N+1]` (NUL-terminated). Compile-time
/// ASCII→UTF-16LE widening for Windows path / API literals; mirrors Zig
/// `bun.strings.w("lit")` / `std.unicode.utf8ToUtf16LeStringLiteral`.
///
/// Restricted to ASCII (`debug_assert` in the const evaluator) — every call
/// site is a hard-coded path component (`"node_modules"`, `".git"`, etc.).
#[macro_export]
macro_rules! wstr {
    ($lit:literal) => {{
        const __BYTES: &[u8] = $lit.as_bytes();
        const __N: usize = __BYTES.len();
        const __W: [u16; __N + 1] = {
            let mut out = [0u16; __N + 1];
            let mut i = 0;
            while i < __N {
                debug_assert!(__BYTES[i].is_ascii(), "wstr!() literal must be ASCII");
                out[i] = __BYTES[i] as u16;
                i += 1;
            }
            out
        };
        &__W
    }};
}

/// `zstr!("lit")` → `&'static ZStr`. Mirrors Zig `"lit"` which is `*const [N:0]u8`.
#[macro_export]
macro_rules! zstr {
    ($s:literal) => {{
        const __B: &[u8] = ::core::concat!($s, "\0").as_bytes();
        // SAFETY: literal is NUL-terminated; len excludes the NUL.
        unsafe { $crate::ZStr::from_raw(__B.as_ptr(), __B.len() - 1) }
    }};
}

/// Nomicon-style opaque FFI handle. Expands to a zero-sized `#[repr(C)]`
/// struct whose address is the only thing Rust ever observes.
///
/// `_p: UnsafeCell<[u8; 0]>` makes the type `!Freeze`, so a `&T` does **not**
/// carry `readonly`/`noalias` at the ABI boundary — the C side mutates through
/// these handles regardless of whether Rust holds `&` or `&mut`, and a
/// `readonly` attribute would license LLVM to cache loads across the FFI call.
/// `PhantomData<(*mut u8, PhantomPinned)>` makes the type `!Send + !Sync +
/// !Unpin`, matching the conservative defaults for foreign-owned state.
///
/// Thin re-export of [`bun_opaque::opaque_ffi!`] under the legacy name. The
/// canonical macro lives in the zero-dep `bun_opaque` crate so tier-0 `*_sys`
/// leaves (`mimalloc_sys`, `brotli_sys`, …) can reach it without pulling
/// `bun_core` into their build graph; this alias just keeps existing
/// `bun_core::opaque_extern!(...)` callers compiling.
#[macro_export]
macro_rules! opaque_extern {
    ($($t:tt)*) => { ::bun_opaque::opaque_ffi!($($t)*); };
}

// ─── Mutex / Guarded (from bun_threading) ─────────────────────────────────
// PORTING.md §Concurrency: Zig `Mutex` + adjacent data → `parking_lot::Mutex<T>`
// (owns T). `Guarded(T)` was already exactly that wrapper.
pub type Mutex<T> = parking_lot::Mutex<T>;
pub type Guarded<T> = parking_lot::Mutex<T>;
pub type RawMutex = parking_lot::RawMutex; // for the rare bare-lock sites (output.rs flush lock)

// ─── Path primitives (from bun_paths) ─────────────────────────────────────
// Zig: src/paths/paths.zig lines 13-20.
// Zig uses `std.fs.max_path_bytes` which is platform-dependent.
pub const MAX_PATH_BYTES: usize = if cfg!(target_arch = "wasm32") {
    1024
} else if cfg!(windows) {
    // std.os.windows.PATH_MAX_WIDE * 3 + 1 (UTF-8 worst-case from UTF-16).
    32767 * 3 + 1
} else if cfg!(target_os = "macos") {
    1024 // libc::PATH_MAX
} else {
    4096 // Linux libc::PATH_MAX
};
pub const PATH_MAX_WIDE: usize = 32767;

#[cfg(windows)] pub type OSPathChar = u16;
#[cfg(not(windows))] pub type OSPathChar = u8;

pub type OSPathSlice<'a> = &'a [OSPathChar];
#[cfg(windows)] pub type OSPathSliceZ = WStr;
#[cfg(not(windows))] pub type OSPathSliceZ = ZStr;

#[cfg(windows)] pub const SEP: u8 = b'\\';
#[cfg(not(windows))] pub const SEP: u8 = b'/';

/// Zig: `[MAX_PATH_BYTES]u8` stack buffer (`var buf: bun.PathBuffer = undefined`).
///
/// Canonical definition; `bun_paths::PathBuffer` re-exports this so the two
/// crates share ONE nominal type and callers can pass a `bun_paths` buffer to
/// `bun_core::getcwd`/`which` without a pointer cast.
///
/// NOTE on alignment: `os_path_kernel32` (Windows) reinterprets a
/// `&mut PathBuffer` as `&mut [u16]` via [`bytes_as_slice_mut`]. The language
/// only guarantees align=1 for `[u8; N]`, so that reinterpret is guarded by a
/// hard `assert!` (mirroring Zig `@alignCast`). We do *not* bump this struct
/// to `#[repr(align(2))]` because several call sites reinterpret an arbitrary
/// `&mut [u8]` *as* `PathBuffer`, and raising the nominal alignment would
/// make *those* casts unsound instead. In practice every `PathBuffer` fed to
/// the `[u16]` view is a fresh stack local or a pooled heap allocation, both
/// of which are ≥8-byte aligned on every supported target.
#[repr(transparent)]
pub struct PathBuffer(pub [u8; MAX_PATH_BYTES]);
impl PathBuffer {
    pub const ZEROED: Self = Self([0; MAX_PATH_BYTES]);
    /// Zig `= undefined`. Returns a zero-initialised buffer (cheap, avoids
    /// `MaybeUninit` ceremony at every call site; the bytes are immediately
    /// overwritten by the syscall that fills it).
    #[inline]
    pub fn uninit() -> Self { Self::ZEROED }
    #[inline] pub fn as_mut_slice(&mut self) -> &mut [u8] { &mut self.0 }
    #[inline] pub fn as_slice(&self) -> &[u8] { &self.0 }
}
impl Default for PathBuffer {
    #[inline] fn default() -> Self { Self::ZEROED }
}
impl core::ops::Deref for PathBuffer {
    type Target = [u8];
    #[inline] fn deref(&self) -> &[u8] { &self.0 }
}
impl core::ops::DerefMut for PathBuffer {
    #[inline] fn deref_mut(&mut self) -> &mut [u8] { &mut self.0 }
}

/// Zig: `[PATH_MAX_WIDE]u16`. Same newtype shape as [`PathBuffer`].
#[repr(transparent)]
pub struct WPathBuffer(pub [u16; PATH_MAX_WIDE]);
impl WPathBuffer {
    pub const ZEROED: Self = Self([0; PATH_MAX_WIDE]);
    #[inline]
    pub fn uninit() -> Self { Self::ZEROED }
    /// Inherent `as_slice` so `wbuf.as_slice()` resolves here instead of the
    /// unstable `<[u16]>::as_slice` (`str_as_str` feature) via `Deref`.
    #[inline]
    pub fn as_slice(&self) -> &[u16] { &self.0 }
    #[inline]
    pub fn as_mut_slice(&mut self) -> &mut [u16] { &mut self.0 }
}
impl Default for WPathBuffer {
    #[inline] fn default() -> Self { Self::ZEROED }
}
impl core::ops::Deref for WPathBuffer {
    type Target = [u16];
    #[inline] fn deref(&self) -> &[u16] { &self.0 }
}
impl core::ops::DerefMut for WPathBuffer {
    #[inline] fn deref_mut(&mut self) -> &mut [u16] { &mut self.0 }
}
#[cfg(windows)] pub type OSPathBuffer = WPathBuffer;
#[cfg(not(windows))] pub type OSPathBuffer = PathBuffer;

/// Zig: `bun.Dirname.dirname(u8, path)` → `std.fs.path.dirnamePosix` /
/// `dirnameWindows`. Faithful port (handles trailing-sep stripping and root).
pub fn dirname(path: &[u8]) -> Option<&[u8]> {
    #[inline]
    fn is_sep(b: u8) -> bool { b == b'/' || (cfg!(windows) && b == b'\\') }

    if path.is_empty() {
        return None;
    }
    // Strip trailing separators.
    let mut end = path.len();
    while end > 1 && is_sep(path[end - 1]) {
        end -= 1;
    }
    // Windows: skip drive prefix `X:` so `C:\foo` → `C:\`, `C:foo` → None.
    let root_end: usize = if cfg!(windows)
        && end >= 2
        && path[1] == b':'
        && path[0].is_ascii_alphabetic()
    {
        if end >= 3 && is_sep(path[2]) { 3 } else { 2 }
    } else if is_sep(path[0]) {
        1
    } else {
        0
    };
    // Scan back for last separator after the root.
    let mut i = end;
    while i > root_end {
        i -= 1;
        if is_sep(path[i]) {
            // Strip any run of separators that ends here, but never past root.
            let mut j = i;
            while j > root_end && is_sep(path[j - 1]) {
                j -= 1;
            }
            return Some(&path[..j.max(root_end)]);
        }
    }
    // No separator AFTER root, but content past it (e.g. "/foo", "C:\foo"):
    // Zig returns the root prefix. Root-only inputs ("/", "C:\") have
    // `end == root_end` and fall through to None.
    if root_end > 0 && end > root_end {
        return Some(&path[..root_end]);
    }
    None
}

// ─── Fd + fd module (from bun_sys::fd) ────────────────────────────────────
// TYPE_ONLY: bun_core needs only the handle wrapper + stdin/out/err/cwd ctors.
// Full method set (close, makeLibUVOwned, …) stays in bun_sys which re-exports
// `pub use bun_core::Fd as FD;` and adds inherent impls there.

// Zig backing_int (fd.zig:1): c_int on posix, u64 on Windows.
#[cfg(not(windows))] type FdBacking = i32;
#[cfg(windows)] type FdBacking = u64;

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Fd(pub FdBacking);

// Zig packed struct(u64) { value: u63, kind: u1 } — fields are LSB-first, so
// `value` is bits 0..63, `kind` is bit 63. (.system=0, .uv=1)
#[cfg(windows)] const FD_KIND_BIT: u64 = 1u64 << 63;
#[cfg(windows)] const FD_VALUE_MASK: u64 = FD_KIND_BIT - 1;

impl Fd {
    /// Zig fd.zig:33-35: { kind=.system, value.as_system = minInt(field_type) }.
    /// posix: minInt(c_int); windows: minInt(u63) = 0, kind=0 → all-zero u64.
    #[cfg(not(windows))]
    pub const INVALID: Fd = Fd(i32::MIN);
    #[cfg(windows)]
    pub const INVALID: Fd = Fd(0);

    /// Zig `bun.invalid_fd` / `FD.invalid` — function form of [`Fd::INVALID`]
    /// for call sites that read better as a constructor (`Fd::invalid()`).
    #[inline] pub const fn invalid() -> Fd { Fd::INVALID }

    #[cfg(not(windows))]
    #[inline] pub const fn from_native(v: FdBacking) -> Fd { Fd(v) }
    #[cfg(windows)]
    #[inline] pub const fn from_native(v: FdBacking) -> Fd {
        // Zig fd.zig:43-50 `fromNative` on Windows takes a HANDLE and stores
        // `{ kind=.system, value=handleToNumber(value) }` — bit 63 forced to 0.
        // Mask here so callers passing a raw handle integer never accidentally
        // produce a Uv-kind Fd.
        Fd(v & FD_VALUE_MASK)
    }
    /// libuv fd (== posix fd on non-windows; uv-tagged on windows).
    #[inline] pub const fn from_uv(v: i32) -> Fd {
        #[cfg(windows)]
        // kind=.uv (bit 63 = 1); uv_file is i32, store sign-extended into low 63.
        { Fd(FD_KIND_BIT | ((v as i64 as u64) & FD_VALUE_MASK)) }
        #[cfg(not(windows))]
        { Fd(v) }
    }
    #[cfg(windows)]
    #[inline] pub fn from_system(h: *mut core::ffi::c_void) -> Fd {
        // kind=.system (bit 63 = 0); WindowsHandleNumber is u63.
        // Zig fd.zig:48 asserts `@intFromPtr(value) <= maxInt(u63)`.
        debug_assert!((h as u64) <= FD_VALUE_MASK);
        Fd((h as u64) & FD_VALUE_MASK)
    }
    /// Native OS file descriptor (`fd_t`). On POSIX this is just the backing
    /// `c_int`. On Windows, when `kind == Uv`, calls `uv_get_osfhandle` to
    /// obtain the underlying HANDLE — so the returned value may not be safely
    /// closed via libc; use `FdExt::close()` instead.
    #[cfg(not(windows))]
    #[inline] pub const fn native(self) -> FdNative { self.0 }
    #[cfg(windows)]
    #[inline] pub fn native(self) -> FdNative {
        match self.decode_windows() {
            DecodeWindows::Windows(handle) => handle,
            // SAFETY: FFI call into libuv; file_number came from _open_osfhandle.
            DecodeWindows::Uv(file_number) => unsafe { fd::uv_get_osfhandle(file_number) },
        }
    }
    /// libuv c_int file number. On POSIX this equals `native()`. On Windows,
    /// when kind=uv this extracts the stored uv_file; when kind=system this
    /// maps stdio handles to 0/1/2 (checking both the cached statics and the
    /// live `GetStdHandle` result) and **panics** otherwise — converting an
    /// arbitrary HANDLE to a uv fd makes closing impossible. The supplier
    /// should call `make_lib_uv_owned()` near where `open()` was called.
    #[cfg(not(windows))]
    #[inline] pub const fn uv(self) -> i32 { self.0 }
    #[cfg(windows)]
    pub fn uv(self) -> i32 {
        match self.decode_windows() {
            DecodeWindows::Uv(v) => v,
            DecodeWindows::Windows(handle) => {
                // `.stdin()`/`.stdout()`/`.stderr()` hand out the cached
                // `WINDOWS_CACHED_STD{IN,OUT,ERR}` (snapshotted at startup),
                // so round-trip against those first. Comparing only against
                // the live `GetStdHandle` result panics if the process std
                // handle was swapped after startup via `SetStdHandle`,
                // `AllocConsole`, `AttachConsole`, etc.
                // SAFETY: cached statics written once at startup.
                unsafe {
                    if self == fd::WINDOWS_CACHED_STDIN.read() { return 0; }
                    if self == fd::WINDOWS_CACHED_STDOUT.read() { return 1; }
                    if self == fd::WINDOWS_CACHED_STDERR.read() { return 2; }
                }
                if fd::is_stdio_handle(fd::STD_INPUT_HANDLE, handle) { return 0; }
                if fd::is_stdio_handle(fd::STD_OUTPUT_HANDLE, handle) { return 1; }
                if fd::is_stdio_handle(fd::STD_ERROR_HANDLE, handle) { return 2; }
                panic!(
                    "Cast bun.FD.uv({}) makes closing impossible!\n\n\
                     The supplier of fd FD should call 'FD.makeLibUVOwned',\n\
                     probably where open() was called.",
                    self,
                );
            }
        }
    }

    #[cfg(not(windows))] #[inline] pub const fn stdin()  -> Fd { Fd(0) }
    #[cfg(not(windows))] #[inline] pub const fn stdout() -> Fd { Fd(1) }
    #[cfg(not(windows))] #[inline] pub const fn stderr() -> Fd { Fd(2) }
    #[cfg(not(windows))] #[inline] pub fn cwd() -> Fd { Fd(libc::AT_FDCWD) }

    // SAFETY: cached statics written once at startup before any reader.
    #[cfg(windows)] #[inline] pub fn stdin()  -> Fd { unsafe { fd::WINDOWS_CACHED_STDIN.read() } }
    #[cfg(windows)] #[inline] pub fn stdout() -> Fd { unsafe { fd::WINDOWS_CACHED_STDOUT.read() } }
    #[cfg(windows)] #[inline] pub fn stderr() -> Fd { unsafe { fd::WINDOWS_CACHED_STDERR.read() } }
    #[cfg(windows)] #[inline] pub fn cwd() -> Fd {
        // SAFETY: PEB is process-global; only reading the cached cwd handle.
        Fd::from_system(unsafe { fd::windows_current_directory_handle() })
    }

    // ── Kind tag (Windows: bit 63 = uv/system) ───────────────────────────
    #[cfg(not(windows))] #[inline] pub const fn kind(self) -> FdKind { FdKind::System }
    #[cfg(windows)]
    #[inline] pub const fn kind(self) -> FdKind {
        if self.0 & FD_KIND_BIT == 0 { FdKind::System } else { FdKind::Uv }
    }

    #[cfg(windows)]
    #[inline] const fn value_as_system(self) -> u64 { self.0 & FD_VALUE_MASK }

    /// Perform different logic for each kind of windows file descriptor.
    #[cfg(windows)]
    #[inline]
    pub fn decode_windows(self) -> DecodeWindows {
        match self.kind() {
            FdKind::System => {
                // Zig `numberToHandle`: `if (handle == 0) return INVALID_HANDLE_VALUE`.
                let n = self.value_as_system();
                let h = if n == 0 { usize::MAX } else { n as usize };
                DecodeWindows::Windows(h as *mut core::ffi::c_void)
            }
            // Direct extract — do NOT recurse into self.uv() (which calls decode_windows).
            FdKind::Uv => DecodeWindows::Uv((self.0 & FD_VALUE_MASK) as u32 as i32),
        }
    }

    /// Zig `FD.makeLibUVOwned` (`fd.zig`): on Windows, convert a system-kind
    /// `Fd` (raw `HANDLE`) into a libuv-kind `Fd` (CRT `_open_osfhandle`-backed
    /// `int`) so libuv `uv_fs_*` APIs can consume it. uv-kind passes through.
    /// On POSIX this is the identity (libuv fd == posix fd).
    ///
    /// Returns `Err(())` (= Zig's `error.SystemFdQuotaExceeded`) when
    /// `uv_open_osfhandle` returns `-1`; the caller decides whether to close
    /// the original handle (see `make_libuv_owned_for_syscall`).
    #[inline]
    pub fn make_libuv_owned(self) -> Result<Fd, ()> {
        debug_assert!(self.is_valid());
        #[cfg(not(windows))]
        { Ok(self) }
        #[cfg(windows)]
        match self.kind() {
            FdKind::Uv => Ok(self),
            FdKind::System => {
                // SAFETY: FFI; `uv_open_osfhandle` wraps `_open_osfhandle(h, 0)`.
                let crt_fd = unsafe { fd::uv_open_osfhandle(self.native()) };
                if crt_fd == -1 { Err(()) } else { Ok(Fd::from_uv(crt_fd)) }
            }
        }
    }

    #[inline]
    pub fn is_valid(self) -> bool {
        #[cfg(not(windows))]
        { self.0 != Fd::INVALID.0 }
        #[cfg(windows)]
        {
            match self.kind() {
                FdKind::System => self.value_as_system() != 0, // INVALID_VALUE = minInt(u63) = 0
                FdKind::Uv => true,
            }
        }
    }
    #[inline]
    pub fn unwrap_valid(self) -> Option<Fd> {
        if self.is_valid() { Some(self) } else { None }
    }

    /// Deprecated: renamed to `native` because it is unclear what `cast` would cast to.
    #[deprecated = "use native()"]
    #[inline] pub fn cast(self) -> FdNative { self.native() }

    /// Properly converts `Fd::INVALID` into `FdOptional::NONE`.
    #[inline] pub const fn to_optional(self) -> FdOptional { FdOptional(self.0) }

    pub fn stdio_tag(self) -> Option<Stdio> {
        #[cfg(not(windows))]
        {
            match self.0 {
                0 => Some(Stdio::StdIn),
                1 => Some(Stdio::StdOut),
                2 => Some(Stdio::StdErr),
                _ => None,
            }
        }
        #[cfg(windows)]
        {
            match self.decode_windows() {
                DecodeWindows::Windows(handle) => {
                    // SAFETY: PEB is process-global, read-only access.
                    let p = unsafe { fd::windows_process_parameters() };
                    if handle == p.hStdInput { Some(Stdio::StdIn) }
                    else if handle == p.hStdOutput { Some(Stdio::StdOut) }
                    else if handle == p.hStdError { Some(Stdio::StdErr) }
                    else { None }
                }
                DecodeWindows::Uv(n) => match n {
                    0 => Some(Stdio::StdIn),
                    1 => Some(Stdio::StdOut),
                    2 => Some(Stdio::StdErr),
                    _ => None,
                },
            }
        }
    }
}

/// `std.posix.fd_t` — `c_int` on POSIX, `HANDLE` (`*anyopaque`) on Windows.
#[cfg(not(windows))] pub type FdNative = i32;
#[cfg(windows)] pub type FdNative = *mut core::ffi::c_void;

/// Zig `Kind` — tag in bit 63 on Windows, `enum(u0)` (zero-width) on POSIX.
#[cfg(not(windows))]
#[repr(u8)] #[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum FdKind { System = 0 }
#[cfg(windows)]
#[repr(u8)] #[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum FdKind { System = 0, Uv = 1 }

#[cfg(windows)]
pub enum DecodeWindows {
    Windows(*mut core::ffi::c_void),
    Uv(i32),
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Stdio { StdIn = 0, StdOut = 1, StdErr = 2 }
impl Stdio {
    #[inline] pub fn fd(self) -> Fd {
        match self {
            Stdio::StdIn => Fd::stdin(),
            Stdio::StdOut => Fd::stdout(),
            Stdio::StdErr => Fd::stderr(),
        }
    }
    #[inline] pub fn from_int(v: i32) -> Option<Stdio> {
        match v { 0 => Some(Stdio::StdIn), 1 => Some(Stdio::StdOut), 2 => Some(Stdio::StdErr), _ => None }
    }
    #[inline] pub fn to_int(self) -> i32 { self as i32 }
}

/// Niche-packed `Option<Fd>` (`enum(backing_int) { none = @bitCast(invalid), _ }`).
/// Use instead of encoding the invalid value directly.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct FdOptional(FdBacking);
impl FdOptional {
    pub const NONE: FdOptional = FdOptional(Fd::INVALID.0);
    #[inline] pub const fn init(maybe: Option<Fd>) -> FdOptional {
        match maybe { Some(fd) => fd.to_optional(), None => FdOptional::NONE }
    }
    #[inline] pub const fn unwrap(self) -> Option<Fd> {
        if self.0 == FdOptional::NONE.0 { None } else { Some(Fd(self.0)) }
    }
    #[inline] pub fn take(&mut self) -> Option<Fd> {
        let r = self.unwrap(); *self = FdOptional::NONE; r
    }
}

/// Best-effort fd → path. Returns bytes written (>0), 0 on misc failure,
/// -1 on EBADF/ENOENT (caller may render `[BADF]`). Body is libc-only
/// (`readlink("/proc/self/fd/N")` on Linux, `fcntl(F_GETPATH)` on macOS,
/// `fcntl(F_KINFO)` on FreeBSD), so it lives at T0 — moved down from
/// `bun_sys::fd` per PORTING.md (no cross-crate extern).
///
/// SAFETY: `buf` must be valid for `cap` writable bytes.
pub unsafe fn fd_path_raw(fd: Fd, buf: *mut u8, cap: usize) -> isize {
    #[cfg(target_os = "linux")]
    {
        let mut proc = [0u8; 32];
        use std::io::Write as _;
        let mut c = std::io::Cursor::new(&mut proc[..]);
        let _ = write!(c, "/proc/self/fd/{}\0", fd.0);
        // SAFETY: proc is NUL-terminated above; buf has cap bytes.
        let n = unsafe { libc::readlink(proc.as_ptr().cast(), buf.cast(), cap) };
        if n < 0 {
            let e = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
            return if e == libc::ENOENT || e == libc::EBADF { -1 } else { 0 };
        }
        return n;
    }
    #[cfg(target_os = "macos")]
    {
        // SAFETY: F_GETPATH expects buf with at least MAXPATHLEN bytes; callers
        // pass ≥1024 which is the platform MAXPATHLEN on Darwin.
        let rc = unsafe { libc::fcntl(fd.0, libc::F_GETPATH, buf) };
        if rc < 0 {
            let e = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
            return if e == libc::ENOENT || e == libc::EBADF { -1 } else { 0 };
        }
        // SAFETY: kernel wrote a NUL-terminated path.
        return unsafe { libc::strlen(buf.cast()) as isize };
    }
    #[cfg(target_os = "freebsd")]
    {
        use core::ptr::{addr_of, addr_of_mut};
        let mut kif = core::mem::MaybeUninit::<libc::kinfo_file>::zeroed();
        // SAFETY: kif is zeroed; kf_structsize is a c_int at a valid offset.
        unsafe {
            addr_of_mut!((*kif.as_mut_ptr()).kf_structsize)
                .write(core::mem::size_of::<libc::kinfo_file>() as libc::c_int);
        }
        // SAFETY: F_KINFO expects a *mut kinfo_file with kf_structsize set.
        let rc = unsafe { libc::fcntl(fd.0, libc::F_KINFO, kif.as_mut_ptr()) };
        if rc < 0 {
            let e = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
            return if e == libc::ENOENT || e == libc::EBADF { -1 } else { 0 };
        }
        // SAFETY: kernel wrote a NUL-terminated path into kf_path.
        let path = unsafe { addr_of!((*kif.as_ptr()).kf_path) } as *const u8;
        let len = unsafe { libc::strlen(path.cast()) };
        let n = len.min(cap);
        // SAFETY: path has `len` initialized bytes; buf has `cap` bytes.
        unsafe { core::ptr::copy_nonoverlapping(path, buf, n) };
        return n as isize;
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "freebsd")))]
    { let _ = (fd, buf, cap); 0 }
}

/// Wide-char fd → path (Windows `GetFinalPathNameByHandleW`). Returns code
/// units written (>0), <0 on error, 0 on non-Windows. Body is a single
/// kernel32 call, so it lives at T0 — moved down from `bun_sys` per
/// PORTING.md (no cross-crate extern).
///
/// SAFETY: `buf` must be valid for `cap` writable `u16` units.
pub unsafe fn fd_path_raw_w(fd: Fd, buf: *mut u16, cap: usize) -> isize {
    #[cfg(windows)]
    {
        unsafe extern "system" {
            fn GetFinalPathNameByHandleW(
                hFile: *mut core::ffi::c_void,
                lpszFilePath: *mut u16,
                cchFilePath: u32,
                dwFlags: u32,
            ) -> u32;
        }
        // VOLUME_NAME_DOS (0) — matches `bun_sys::windows::GetFinalPathNameByHandle` default.
        // SAFETY: buf has `cap` u16 units; handle from Fd::native().
        let n = unsafe { GetFinalPathNameByHandleW(fd.native(), buf, cap as u32, 0) } as usize;
        if n == 0 || n > cap { return -1; }
        // Strip the `\\?\` prefix if present so callers see a plain DOS path
        // (matches `bun_sys::windows::GetFinalPathNameByHandle` post-processing).
        // Work entirely through raw-pointer reads/writes — never form a `&[u16]`
        // or `&mut [u16]` over `buf` while the memmove runs, or the write through
        // `buf` would invalidate that borrow's tag under Stacked Borrows.
        // SAFETY: kernel32 wrote `n` u16s into `buf`; every `.add(i)` below is
        // bounds-checked against `n` first.
        let at = |i: usize| -> u16 { unsafe { *buf.add(i) } };
        let bs = b'\\' as u16;
        let off: usize = if n >= 4 && at(0) == bs && at(1) == bs && at(2) == b'?' as u16 && at(3) == bs {
            if n >= 8
                && (at(4) == b'U' as u16 || at(4) == b'u' as u16)
                && (at(5) == b'N' as u16 || at(5) == b'n' as u16)
                && (at(6) == b'C' as u16 || at(6) == b'c' as u16)
                && at(7) == bs
            {
                // `\\?\UNC\server\share` → `\\server\share`
                // SAFETY: index 6 < n (checked above).
                unsafe { *buf.add(6) = bs };
                6
            } else {
                // `\\?\C:\...` → `C:\...`
                4
            }
        } else {
            0
        };
        let out_len = n - off;
        if off != 0 {
            // SAFETY: src = buf+off and dst = buf both derive from the same
            // raw `*mut u16` provenance (no intervening reference), src > dst,
            // and `out_len` units fit within the `n` initialized units.
            unsafe { core::ptr::copy(buf.add(off), buf, out_len) };
        }
        return out_len as isize;
    }
    #[cfg(not(windows))]
    { let _ = (fd, buf, cap); 0 }
}

impl core::fmt::Display for Fd {
    fn fmt(&self, w: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let fd = *self;
        if !fd.is_valid() { return w.write_str("[invalid_fd]"); }
        #[cfg(not(windows))]
        {
            write!(w, "{}", fd.0)?;
            #[cfg(debug_assertions)]
            if fd.0 >= 3 {
                let mut buf = [0u8; 1024];
                // SAFETY: buf is 1024 bytes, passed with matching cap.
                let n = unsafe { fd_path_raw(fd, buf.as_mut_ptr(), buf.len()) };
                if n > 0 {
                    write!(w, "[{}]", bstr::BStr::new(&buf[..n as usize]))?;
                } else if n == -1 {
                    w.write_str("[BADF]")?;
                }
            }
            Ok(())
        }
        #[cfg(windows)]
        {
            match fd.decode_windows() {
                DecodeWindows::Windows(_) => write!(w, "{}[handle]", fd.value_as_system()),
                DecodeWindows::Uv(n) => write!(w, "{}[libuv]", n),
            }
        }
    }
}

/// Zig fd.zig module-level statics + Windows libuv/PEB FFI shims (T0 → no
/// crate dep, just `extern` symbols; libuv is linked into the final binary).
pub mod fd {
    use super::Fd;
    use core::ffi::{c_int, c_void};

    // Written once in windows_stdio::init() during single-threaded startup.
    pub static WINDOWS_CACHED_STDIN: super::RacyCell<Fd> = super::RacyCell::new(Fd::INVALID);
    pub static WINDOWS_CACHED_STDOUT: super::RacyCell<Fd> = super::RacyCell::new(Fd::INVALID);
    pub static WINDOWS_CACHED_STDERR: super::RacyCell<Fd> = super::RacyCell::new(Fd::INVALID);
    #[cfg(debug_assertions)]
    pub static WINDOWS_CACHED_FD_SET: core::sync::atomic::AtomicBool =
        core::sync::atomic::AtomicBool::new(false);

    #[cfg(windows)]
    unsafe extern "C" {
        // libuv: convert C-runtime fd → OS HANDLE.
        pub fn uv_get_osfhandle(fd: c_int) -> *mut c_void;
        /// libuv: `_open_osfhandle(os_fd, 0)` — wraps a HANDLE in a CRT fd so
        /// libuv `uv_fs_*` (which speak `uv_file == int`) can use it. Returns
        /// `-1` on `EMFILE` (CRT fd table full).
        pub fn uv_open_osfhandle(os_fd: *mut c_void) -> c_int;
    }
    #[cfg(windows)]
    pub use crate::windows_sys::{STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE};
    #[cfg(windows)]
    pub fn is_stdio_handle(id: u32, handle: *mut c_void) -> bool {
        // Zig fd.zig:568-571: `std.os.windows.GetStdHandle(id) catch return false;
        // return handle == h;` — the Zig wrapper maps BOTH `INVALID_HANDLE_VALUE`
        // (failure) and `NULL` (no device) to an error. The raw kernel32 call
        // returns INVALID_HANDLE_VALUE on failure, which `decode_windows()` also
        // produces for `Fd::INVALID`, so a null-only guard would mis-classify an
        // invalid Fd as stdio. Use the safe wrapper that filters both sentinels.
        crate::windows_sys::GetStdHandle(id).is_some_and(|h| handle == h)
    }

    /// PEB ProcessParameters subset for stdio/cwd handle lookup.
    /// Full struct lives in `bun_windows_sys::PEB`; only the handle fields are
    /// read here, so a minimal view is exposed via accessor fns.
    #[cfg(windows)]
    #[repr(C)]
    pub struct ProcessParametersStdio {
        pub hStdInput: *mut c_void,
        pub hStdOutput: *mut c_void,
        pub hStdError: *mut c_void,
    }
    #[cfg(windows)]
    pub unsafe fn windows_process_parameters() -> &'static ProcessParametersStdio {
        // PEB → ProcessParameters → {hStdInput,hStdOutput,hStdError}. The
        // `crate::windows_sys::ProcessParameters` layout places the three
        // handles at the same consecutive offsets as this view, so a pointer
        // cast is sound.
        // SAFETY: PEB is process-lifetime; handle fields are at fixed offsets.
        unsafe {
            let pp = (*crate::windows_sys::peb()).ProcessParameters;
            &*(core::ptr::addr_of!((*pp).hStdInput) as *const ProcessParametersStdio)
        }
    }
    #[cfg(windows)]
    pub unsafe fn windows_current_directory_handle() -> *mut c_void {
        // Zig `std.fs.cwd().fd` on Windows reads
        // `peb().ProcessParameters.CurrentDirectory.Handle`.
        // SAFETY: PEB is process-lifetime; the CURDIR handle field is at a
        // fixed offset and is kept valid by the loader for the process duration.
        unsafe { (*(*crate::windows_sys::peb()).ProcessParameters).CurrentDirectoryHandle }
    }
}

// ─── FileKind / Mode / kind_from_mode (from bun_sys) ──────────────────────
// Zig: src/sys/sys.zig — pure S_IFMT arithmetic, no syscalls (libarchive_sys req).
pub type Mode = u32; // std.posix.mode_t

/// `stat` mode-flag constants and predicates (Zig: `std.posix.S`).
///
/// Values are POSIX-standard octal — frozen since 1988 and identical across
/// linux/darwin/freebsd. Typed against the cross-platform `Mode` (= `u32`)
/// rather than each platform's native `mode_t`, so `Mode`-typed expressions
/// like `S::IRUSR | S::IWUSR` and `(st_mode as u32) & S::IFMT` compile
/// uniformly; the libc-boundary cast to native `mode_t` happens in `bun_sys`.
///
/// Canonical home for the per-OS `bun_errno::posix::S` re-exports (errno
/// depends on bun_core, not vice-versa). Darwin/Windows keep local `mode_t`-
/// typed constant copies for integer-type inference at existing call sites.
#[allow(non_snake_case)]
pub mod S {
    use super::Mode;

    pub const IFMT:   Mode = 0o170000;
    pub const IFSOCK: Mode = 0o140000;
    pub const IFLNK:  Mode = 0o120000;
    pub const IFREG:  Mode = 0o100000;
    pub const IFBLK:  Mode = 0o060000;
    pub const IFDIR:  Mode = 0o040000;
    pub const IFCHR:  Mode = 0o020000;
    pub const IFIFO:  Mode = 0o010000;
    pub const IFWHT:  Mode = 0o160000; // BSD/Darwin whiteout

    pub const ISUID: Mode = 0o4000;
    pub const ISGID: Mode = 0o2000;
    pub const ISVTX: Mode = 0o1000;
    pub const IRWXU: Mode = 0o0700;
    pub const IRUSR: Mode = 0o0400;
    pub const IWUSR: Mode = 0o0200;
    pub const IXUSR: Mode = 0o0100;
    pub const IRWXG: Mode = 0o0070;
    pub const IRGRP: Mode = 0o0040;
    pub const IWGRP: Mode = 0o0020;
    pub const IXGRP: Mode = 0o0010;
    pub const IRWXO: Mode = 0o0007;
    pub const IROTH: Mode = 0o0004;
    pub const IWOTH: Mode = 0o0002;
    pub const IXOTH: Mode = 0o0001;

    #[inline] pub const fn ISREG(m: Mode)  -> bool { m & IFMT == IFREG }
    #[inline] pub const fn ISDIR(m: Mode)  -> bool { m & IFMT == IFDIR }
    #[inline] pub const fn ISCHR(m: Mode)  -> bool { m & IFMT == IFCHR }
    #[inline] pub const fn ISBLK(m: Mode)  -> bool { m & IFMT == IFBLK }
    #[inline] pub const fn ISFIFO(m: Mode) -> bool { m & IFMT == IFIFO }
    #[inline] pub const fn ISLNK(m: Mode)  -> bool { m & IFMT == IFLNK }
    #[inline] pub const fn ISSOCK(m: Mode) -> bool { m & IFMT == IFSOCK }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum FileKind {
    BlockDevice,
    CharacterDevice,
    Directory,
    NamedPipe,
    SymLink,
    File,
    UnixDomainSocket,
    Whiteout,
    Door,
    EventPort,
    Unknown,
}

#[inline]
pub fn kind_from_mode(mode: Mode) -> FileKind {
    match mode & S::IFMT {
        S::IFBLK => FileKind::BlockDevice,
        S::IFCHR => FileKind::CharacterDevice,
        S::IFDIR => FileKind::Directory,
        S::IFIFO => FileKind::NamedPipe,
        S::IFLNK => FileKind::SymLink,
        S::IFREG => FileKind::File,
        S::IFSOCK => FileKind::UnixDomainSocket,
        _ => FileKind::Unknown,
    }
}

// ─── io::Writer (from bun_io) ─────────────────────────────────────────────
// TYPE_ONLY: output.rs holds `*mut io::Writer` opaquely (erased adapter head);
// real write/flush/print dispatch lives in bun_sys via the OutputSinkVTable.
pub mod io {
    /// Opaque writer interface header. bun_sys guarantees this is the first
    /// `repr(C)` field of every concrete adapter, so `&mut Adapter as &mut Writer`
    /// is sound (see output.rs `QuietWriterAdapter::new_interface`).
    #[repr(C)]
    pub struct Writer {
        pub write_all: unsafe fn(*mut Writer, &[u8]) -> Result<(), crate::Error>,
        pub flush:     unsafe fn(*mut Writer) -> Result<(), crate::Error>,
    }
    impl Writer {
        #[inline]
        pub fn write_all(&mut self, bytes: &[u8]) -> Result<(), crate::Error> {
            unsafe { (self.write_all)(std::ptr::from_mut(self), bytes) }
        }
        #[inline]
        pub fn flush(&mut self) -> Result<(), crate::Error> {
            unsafe { (self.flush)(std::ptr::from_mut(self)) }
        }
        /// Alias for `print` so `write!(w, ...)` works.
        #[inline]
        pub fn write_fmt(&mut self, args: core::fmt::Arguments<'_>) -> Result<(), crate::Error> {
            self.print(args)
        }
        #[inline]
        pub fn print(&mut self, args: core::fmt::Arguments<'_>) -> Result<(), crate::Error> {
            use core::fmt::Write;
            struct A<'a>(&'a mut Writer, Result<(), crate::Error>);
            impl core::fmt::Write for A<'_> {
                fn write_str(&mut self, s: &str) -> core::fmt::Result {
                    self.1 = self.0.write_all(s.as_bytes());
                    if self.1.is_err() { Err(core::fmt::Error) } else { Ok(()) }
                }
            }
            let mut a = A(self, Ok(()));
            let _ = a.write_fmt(args);
            a.1
        }
    }
    /// WASM-only StreamType (output.rs `#[cfg(wasm32)]`).
    #[repr(C)]
    pub struct FixedBufferStream {
        pub buf: *mut u8,
        pub len: usize,
        pub pos: usize,
    }
}

// ─── Version (from bun_semver, TYPE_ONLY for env.rs::VERSION const) ───────
// Only the scalar fields env.rs reads (major/minor/patch). Full Version with
// tag/pre/build stays in bun_semver.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Version {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

// ─── RacyCell ─────────────────────────────────────────────────────────────
/// Stable equivalent of `core::cell::SyncUnsafeCell<T>` (nightly-only as of
/// 1.79). A `static`-safe interior-mutability cell with **no** synchronization.
///
/// This exists to replace `static mut` (banned per docs/PORTING.md §Global
/// mutable state). Unlike `static mut`, taking `&RACY` does not assert
/// uniqueness; callers stay in raw-ptr land via `.get()` and only deref for
/// the duration of a single statement.
///
/// **Invariant the caller upholds:** all access is either single-threaded
/// (e.g. HTTP-thread-only buffers, main-thread-only CLI state) or externally
/// synchronized. For anything actually shared across threads, use
/// `Atomic*` / `OnceLock` / `Mutex` instead — `RacyCell` is the last resort
/// for scratch buffers and FFI-shaped globals where the Zig already proved
/// thread-affinity.
#[repr(transparent)]
pub struct RacyCell<T: ?Sized>(core::cell::UnsafeCell<T>);
// SAFETY: by construction, callers promise external synchronization or
// single-thread access. Unlike std's nightly `SyncUnsafeCell` (which gates
// `Sync` on `T: Sync`), this impl is intentionally unconditional: many
// payloads ported from `static mut` are `!Sync` only by auto-trait inference
// (raw pointers, `MaybeUninit<T>` over FFI handles) yet are sound to share
// because all access is single-threaded or externally synchronized — the
// exact contract `static mut` already imposed. **Do not** wrap types whose
// `!Sync` is load-bearing (`Cell<T>`, `Rc<T>`, `RefCell<T>`); use
// `thread_local!` or a real lock for those.
unsafe impl<T: ?Sized> Sync for RacyCell<T> {}
unsafe impl<T: ?Sized + Send> Send for RacyCell<T> {}

impl<T> RacyCell<T> {
    #[inline]
    pub const fn new(value: T) -> Self {
        Self(core::cell::UnsafeCell::new(value))
    }
    /// Raw pointer to the contained value. Never produces a reference; callers
    /// deref per-access (`unsafe { *X.get() }` / `unsafe { (*X.get()).field }`).
    #[inline]
    pub const fn get(&self) -> *mut T {
        self.0.get()
    }
    /// Convenience: read a `Copy` value. Single load, no aliasing assertion.
    ///
    /// # Safety
    /// Caller guarantees no concurrent writer on another thread.
    #[inline]
    pub unsafe fn read(&self) -> T
    where
        T: Copy,
    {
        unsafe { *self.0.get() }
    }
    /// Convenience: overwrite the value.
    ///
    /// # Safety
    /// Caller guarantees no concurrent reader/writer on another thread.
    #[inline]
    pub unsafe fn write(&self, value: T) {
        unsafe { *self.0.get() = value; }
    }
}
impl<T: Default> Default for RacyCell<T> {
    fn default() -> Self {
        Self::new(T::default())
    }
}

// ─── ThreadLock (from bun_safety) ─────────────────────────────────────────
// Debug-only re-entrancy guard. Release builds compile to a ZST.
//
// `locked_at` is `UnsafeCell` so `lock()`/`lock_or_assert()` can take `&self`
// (callers like `RefCount::assert_single_threaded` only have `&self`). The
// whole point of ThreadLock is asserting single-threaded access, so the
// unsynchronized write to `locked_at` is exactly the Zig semantics — if two
// threads race here, the `owning_thread.swap` panic fires first.
pub struct ThreadLock {
    #[cfg(debug_assertions)] owning_thread: core::sync::atomic::AtomicU64,
    #[cfg(debug_assertions)] locked_at: core::cell::UnsafeCell<crate::StoredTrace>,
}
// SAFETY: `locked_at` is only written after `owning_thread.swap` proves the
// current thread is the unique acquirer; concurrent access panics first.
unsafe impl Sync for ThreadLock {}
const INVALID_THREAD_ID: u64 = 0;
impl ThreadLock {
    pub const fn init_unlocked() -> Self {
        Self {
            #[cfg(debug_assertions)] owning_thread: core::sync::atomic::AtomicU64::new(INVALID_THREAD_ID),
            #[cfg(debug_assertions)] locked_at: core::cell::UnsafeCell::new(crate::StoredTrace::EMPTY),
        }
    }
    #[inline] pub fn init_locked() -> Self { let s = Self::init_unlocked(); s.lock(); s }
    /// Zig `initLockedIfNonComptime` — Zig comptime evaluation has no thread;
    /// in Rust there is no comptime execution, so this is just `init_locked`.
    #[inline] pub fn init_locked_if_non_comptime() -> Self { Self::init_locked() }
    /// Zig `lockOrAssert` — acquire if unlocked, else assert this thread holds it.
    #[inline]
    pub fn lock_or_assert(&self) {
        #[cfg(debug_assertions)]
        {
            let held = self.owning_thread.load(core::sync::atomic::Ordering::Acquire);
            if held == INVALID_THREAD_ID {
                self.lock();
            } else {
                self.assert_locked();
            }
        }
    }
    #[inline]
    pub fn lock(&self) {
        #[cfg(debug_assertions)]
        {
            let cur = thread_id();
            let prev = self.owning_thread.swap(cur, core::sync::atomic::Ordering::AcqRel);
            if prev != INVALID_THREAD_ID {
                // SAFETY: read-only path; the prior holder wrote `locked_at`
                // before its `swap` released, and we observe via AcqRel above.
                let trace = unsafe { (*self.locked_at.get()).trace() };
                crate::dump_stack_trace(&trace, crate::DumpStackTraceOptions {
                    frame_count: 10, stop_at_jsc_llint: true, ..Default::default()
                });
                panic!("ThreadLock: thread {cur} tried to lock, already held by {prev}");
            }
            // SAFETY: swap above proved we are the unique acquirer (prev was
            // INVALID); no other thread can be in this branch concurrently.
            unsafe { *self.locked_at.get() = crate::StoredTrace::capture(None); }
        }
    }
    #[inline]
    pub fn unlock(&self) {
        #[cfg(debug_assertions)]
        {
            self.assert_locked(); // Zig: assert current thread holds it before reset.
            self.owning_thread.store(INVALID_THREAD_ID, core::sync::atomic::Ordering::Release);
            // SAFETY: assert_locked above proved we are the unique holder.
            unsafe { *self.locked_at.get() = crate::StoredTrace::EMPTY; }
        }
    }
    #[inline]
    pub fn assert_locked(&self) {
        #[cfg(debug_assertions)]
        debug_assert_eq!(self.owning_thread.load(core::sync::atomic::Ordering::Acquire), thread_id());
    }
}
#[cfg(debug_assertions)]
#[inline]
fn thread_id() -> u64 {
    // Use the OS tid; matches Zig `Thread.getCurrentId()` semantics per-platform.
    #[cfg(target_os = "linux")]
    // SAFETY: `gettid` has no preconditions.
    unsafe { libc::syscall(libc::SYS_gettid) as u64 }
    #[cfg(target_os = "macos")]
    unsafe {
        // Darwin: pthread_threadid_np(NULL, &tid) — same call Zig std uses.
        let mut tid: u64 = 0;
        libc::pthread_threadid_np(0, &mut tid);
        tid
    }
    #[cfg(target_os = "freebsd")]
    // SAFETY: pthread_getthreadid_np() is infallible and returns the kernel LWP id.
    unsafe { libc::pthread_getthreadid_np() as u64 }
    #[cfg(all(unix, not(any(target_os = "linux", target_os = "macos", target_os = "freebsd"))))]
    // Fallback: pthread_self() handle as u64 (opaque but stable per-thread).
    // On the BSDs `pthread_t` is a raw pointer, which must route through usize.
    unsafe { libc::pthread_self() as usize as u64 }
    #[cfg(windows)]
    unsafe {
        unsafe extern "system" { fn GetCurrentThreadId() -> u32; }
        GetCurrentThreadId() as u64
    }
}

// ─── StackCheck (from bun.zig) ───────────────────────────────────────────
// Thin FFI wrapper; configure_thread() is all output.rs needs.
#[derive(Clone, Copy)]
pub struct StackCheck { cached_stack_end: usize }
unsafe extern "C" {
    fn Bun__StackCheck__initialize();
    fn Bun__StackCheck__getMaxStack() -> *mut core::ffi::c_void;
}
impl Default for StackCheck {
    /// Zig `.{}` — `cached_stack_end` defaults to `0`, so
    /// `is_safe_to_recurse()` always reports true until `init`/`update`.
    #[inline] fn default() -> Self { Self { cached_stack_end: 0 } }
}
impl StackCheck {
    #[inline] pub fn configure_thread() { unsafe { Bun__StackCheck__initialize() } }
    #[inline] pub fn init() -> Self { Self { cached_stack_end: unsafe { Bun__StackCheck__getMaxStack() } as usize } }
    #[inline] pub fn update(&mut self) { self.cached_stack_end = unsafe { Bun__StackCheck__getMaxStack() } as usize; }
    /// Is there enough stack space to safely recurse?
    /// Zig: `> 256K` on Windows, `> 128K` elsewhere (bun.zig:3762).
    #[inline]
    pub fn is_safe_to_recurse(&self) -> bool {
        // Zig uses `-|` (saturating sub): if probe < end (already past limit),
        // result saturates to 0 → "not safe". wrapping_sub would yield a huge
        // positive and incorrectly return true.
        let remaining = Self::frame_address().saturating_sub(self.cached_stack_end);
        let threshold: usize = if cfg!(windows) { 256 * 1024 } else { 128 * 1024 };
        remaining > threshold
    }

    /// Approximate the current stack position. Reads the stack-pointer
    /// register so the result is on the real machine stack — taking the
    /// address of a local lands on ASAN's heap-backed fake stack when
    /// use-after-return detection is on, which makes the comparison against
    /// `cached_stack_end` useless.
    ///
    /// Zig uses `@frameAddress()` (rbp/x29), but Zig builds always keep frame
    /// pointers. Rust release builds omit them, leaving rbp/x29 as a
    /// general-purpose register with arbitrary contents — reading it there
    /// makes `is_safe_to_recurse()` spuriously fail at depth 0. The stack
    /// pointer is always valid and is what we actually want to measure.
    #[inline(always)]
    fn frame_address() -> usize {
        #[cfg(target_arch = "x86_64")]
        {
            let sp: usize;
            // SAFETY: reading rsp is side-effect-free.
            unsafe { core::arch::asm!("mov {}, rsp", out(reg) sp, options(nomem, nostack, preserves_flags)) };
            sp
        }
        #[cfg(target_arch = "aarch64")]
        {
            let sp: usize;
            // SAFETY: reading sp is side-effect-free.
            unsafe { core::arch::asm!("mov {}, sp", out(reg) sp, options(nomem, nostack, preserves_flags)) };
            sp
        }
        #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
        {
            let probe = 0u8;
            core::ptr::from_ref::<u8>(&probe) as usize
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// B-2 Track A — small helpers from src/bun.zig that downstream crates need.
// ──────────────────────────────────────────────────────────────────────────

/// Zig `bun.Generation` (bun.zig:1926) — bumped each rebuild/rescan to
/// invalidate stale cache entries.
pub type Generation = u16;

// ── Ordinal ───────────────────────────────────────────────────────────────
// Port of `OrdinalT(c_int)` (bun.zig:3421). ABI-equivalent of WTF::OrdinalNumber:
// a zero-based index where -1 means "invalid". Represented as a transparent
// newtype rather than a Rust enum so the full `c_int` range round-trips across
// FFI without UB.
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub struct Ordinal(pub core::ffi::c_int);

impl Ordinal {
    pub const INVALID: Self = Self(-1);
    pub const START: Self = Self(0);

    #[inline]
    pub const fn from_zero_based(int: core::ffi::c_int) -> Self {
        debug_assert!(int >= 0);
        Self(int)
    }
    #[inline]
    pub const fn from_one_based(int: core::ffi::c_int) -> Self {
        debug_assert!(int > 0);
        Self(int - 1)
    }
    #[inline] pub const fn zero_based(self) -> core::ffi::c_int { self.0 }
    #[inline] pub const fn one_based(self) -> core::ffi::c_int { self.0 + 1 }
    /// Add two ordinal numbers together. Both are converted to zero-based before addition.
    #[inline] pub const fn add(self, b: Self) -> Self { Self::from_zero_based(self.0 + b.0) }
    /// Add a scalar value to an ordinal number.
    #[inline] pub const fn add_scalar(self, inc: core::ffi::c_int) -> Self { Self::from_zero_based(self.0 + inc) }
    #[inline] pub const fn is_valid(self) -> bool { self.0 >= 0 }
}
impl Default for Ordinal {
    #[inline] fn default() -> Self { Self::INVALID }
}

// ── Once ──────────────────────────────────────────────────────────────────
// Port of `bun.Once(f)` (bun.zig:3637). Zig parameterizes over a comptime fn
// and stores the payload; Rust callers use two shapes:
//   * `Once<T>` — fn supplied at `.call(f)` time (resolver/fs.rs)
//   * `Once<T, fn(A) -> T>` — fn supplied at construction (PackageManagerDirectories.rs)
// Backed by `std::sync::OnceLock` per PORTING.md §Concurrency.
pub struct Once<T, F = ()> {
    cell: std::sync::OnceLock<T>,
    f: F,
}
// `Once<T, F>` is auto-`Sync` when `T: Send + Sync, F: Sync` via
// `OnceLock<T>: Sync` — no `unsafe impl` needed.

impl<T> Once<T, ()> {
    pub const fn new() -> Self { Self { cell: std::sync::OnceLock::new(), f: () } }
    /// Run `f` exactly once; subsequent calls return the cached payload.
    #[inline]
    pub fn call(&self, f: impl FnOnce() -> T) -> T where T: Copy {
        *self.cell.get_or_init(f)
    }
    #[inline] pub fn get(&self) -> Option<&T> { self.cell.get() }
    #[inline] pub fn done(&self) -> bool { self.cell.get().is_some() }
}
impl<T, A> Once<T, fn(A) -> T> {
    pub const fn with_fn(f: fn(A) -> T) -> Self { Self { cell: std::sync::OnceLock::new(), f } }
    /// Run the stored fn exactly once with `arg`; returns a borrow of the cached
    /// payload. Bound to `&'static self` because every call site is a `static`.
    #[inline]
    pub fn call(&'static self, arg: A) -> &'static T {
        let f = self.f;
        self.cell.get_or_init(|| f(arg))
    }
    #[inline] pub fn get(&self) -> Option<&T> { self.cell.get() }
    #[inline] pub fn done(&self) -> bool { self.cell.get().is_some() }
}

// ── Pollable / is_readable ────────────────────────────────────────────────
// Port of `bun.PollFlag` + `bun.isReadable` (bun.zig:637). Named `Pollable` to
// match the Phase-A draft callers (io/PipeReader.rs).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Pollable { Ready, NotReady, Hup }
/// Zig `bun.PollFlag` — original name kept as an alias.
pub type PollFlag = Pollable;

/// Non-blocking poll for readability. POSIX-only (Zig panics on Windows).
#[cfg(not(windows))]
pub fn is_readable(fd: Fd) -> Pollable {
    debug_assert!(fd.is_valid());
    let mut polls = [libc::pollfd {
        fd: fd.native(),
        events: libc::POLLIN | libc::POLLERR | libc::POLLHUP,
        revents: 0,
    }];
    // SAFETY: polls is a valid 1-element array; timeout 0 = non-blocking.
    let rc = unsafe { libc::poll(polls.as_mut_ptr(), 1, 0) };
    let result = rc > 0;
    if result && (polls[0].revents & (libc::POLLHUP | libc::POLLERR)) != 0 {
        Pollable::Hup
    } else if result {
        Pollable::Ready
    } else {
        Pollable::NotReady
    }
}
#[cfg(windows)]
pub fn is_readable(_fd: Fd) -> Pollable {
    // Zig: @panic("TODO on Windows")
    unreachable!("is_readable: TODO on Windows");
}

/// Non-blocking poll for writability. POSIX-only (Zig panics on Windows).
#[cfg(not(windows))]
pub fn is_writable(fd: Fd) -> Pollable {
    debug_assert!(fd.is_valid());
    // bun.zig:657 — POLLOUT only; HUP/ERR detected via revents.
    let mut polls = [libc::pollfd {
        fd: fd.native(),
        events: libc::POLLOUT,
        revents: 0,
    }];
    // SAFETY: polls is a valid 1-element array; timeout 0 = non-blocking.
    let rc = unsafe { libc::poll(polls.as_mut_ptr(), 1, 0) };
    let result = rc > 0;
    if result && (polls[0].revents & (libc::POLLHUP | libc::POLLERR)) != 0 {
        Pollable::Hup
    } else if result {
        Pollable::Ready
    } else {
        Pollable::NotReady
    }
}
#[cfg(windows)]
pub fn is_writable(_fd: Fd) -> Pollable {
    unreachable!("is_writable: TODO on Windows");
}

// ── csprng ────────────────────────────────────────────────────────────────
// Zig calls `BoringSSL.c.RAND_bytes` (bun.zig:621). bun_core sits below
// boringssl_sys in the crate graph, so we go to the OS CSPRNG directly:
// getrandom(2) on Linux, SecRandomCopyBytes/getentropy on Darwin,
// RtlGenRandom on Windows. All are the same entropy source BoringSSL seeds
// from. PERF(port): if a hot path needs the BoringSSL DRBG, install a
// vtable hook from bun_runtime at startup.
pub fn csprng(bytes: &mut [u8]) {
    #[cfg(target_os = "linux")]
    {
        let mut filled = 0usize;
        while filled < bytes.len() {
            // SAFETY: writes at most len-filled bytes into the slice.
            let rc = unsafe {
                libc::getrandom(
                    bytes.as_mut_ptr().add(filled).cast(),
                    bytes.len() - filled,
                    0,
                )
            };
            if rc < 0 {
                let err = crate::ffi::errno();
                if err == libc::EINTR { continue; }
                panic!("getrandom failed: errno {err}");
            }
            filled += rc as usize;
        }
    }
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
    {
        // getentropy caps at 256 bytes per call.
        for chunk in bytes.chunks_mut(256) {
            // SAFETY: chunk is a valid writable slice ≤ 256 bytes.
            let rc = unsafe { libc::getentropy(chunk.as_mut_ptr().cast(), chunk.len()) };
            if rc != 0 { panic!("getentropy failed"); }
        }
    }
    #[cfg(windows)]
    {
        unsafe extern "system" {
            // advapi32!SystemFunction036 a.k.a. RtlGenRandom — what BoringSSL uses on Windows.
            #[link_name = "SystemFunction036"]
            fn RtlGenRandom(buf: *mut u8, len: u32) -> u8;
        }
        for chunk in bytes.chunks_mut(u32::MAX as usize) {
            // SAFETY: chunk fits in u32; RtlGenRandom writes exactly that many bytes.
            let ok = unsafe { RtlGenRandom(chunk.as_mut_ptr(), chunk.len() as u32) };
            if ok == 0 { panic!("RtlGenRandom failed"); }
        }
    }
}

// ── self_exe_path ─────────────────────────────────────────────────────────
// Port of `bun.selfExePath` (bun.zig:3011). Memoized into a process-lifetime
// static buffer; thread-safe via OnceLock. Returns a `&'static ZStr`.
pub fn self_exe_path() -> Result<&'static ZStr, crate::Error> {
    static CELL: std::sync::OnceLock<Result<ZBox, crate::Error>> = std::sync::OnceLock::new();
    let r = CELL.get_or_init(|| {
        #[allow(unused_mut)]
        let mut path = std::env::current_exe().map_err(crate::Error::from)?;
        // PORT NOTE: Zig's `std.fs.selfExePath` resolves symlinks. Rust's
        // `current_exe()` already does on Linux (`readlink /proc/self/exe`) and
        // Windows, but on Darwin it returns the raw `_NSGetExecutablePath`
        // result without `realpath`, so a symlinked argv0 leaks through to
        // `process.execPath`. Canonicalize here to match Node/Zig semantics
        // (test/js/node/test/parallel/test-process-execpath.js).
        #[cfg(target_vendor = "apple")]
        if let Ok(real) = path.canonicalize() {
            path = real;
        }
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStringExt;
            Ok(ZBox::from_vec_with_nul(path.into_os_string().into_vec()))
        }
        #[cfg(windows)]
        {
            // PORT NOTE: Zig stored the WTF-8 form. `into_string()` rejects unpaired
            // surrogates; fall back to the lossy form (Windows exe paths are valid
            // Unicode in practice).
            let s = path.into_os_string().into_string()
                .unwrap_or_else(|os| os.to_string_lossy().into_owned());
            Ok(ZBox::from_vec_with_nul(s.into_bytes()))
        }
    });
    match r {
        Ok(z) => Ok(z.as_zstr()),
        Err(e) => Err(*e),
    }
}

// ── get_thread_count ──────────────────────────────────────────────────────
// Port of `bun.getThreadCount` (bun.zig:3597). Clamped to [2, 1024]; honours
// UV_THREADPOOL_SIZE / GOMAXPROCS overrides.
pub fn get_thread_count() -> u16 {
    static CELL: std::sync::OnceLock<u16> = std::sync::OnceLock::new();
    *CELL.get_or_init(|| {
        const MAX: u16 = 1024;
        const MIN: u16 = 2;
        let from_env = || -> Option<u16> {
            for key in [crate::zstr!("UV_THREADPOOL_SIZE"), crate::zstr!("GOMAXPROCS")] {
                if let Some(v) = getenv_z(key) {
                    if let Ok(s) = core::str::from_utf8(v) {
                        if let Ok(n) = s.trim().parse::<u16>() {
                            if n >= MIN { return Some(n.min(MAX)); }
                        }
                    }
                }
            }
            None
        };
        let raw = from_env().unwrap_or_else(|| {
            // Zig calls `jsc.wtf.numberOfProcessorCores()`; that crate is above
            // bun_core, so use std (same value: sysconf/_SC_NPROCESSORS_ONLN).
            std::thread::available_parallelism().map(|n| n.get() as u16).unwrap_or(MIN)
        });
        raw.clamp(MIN, MAX)
    })
}

// ── errno_to_zig_err ──────────────────────────────────────────────────────
// Port of `bun.errnoToZigErr` (bun.zig:2854). Zig indexes into a comptime
// `errno_map: [N]anyerror`; the Rust intern table reproduces that mapping in
// `Error::from_errno` (errno → tag name → interned code).
#[inline]
pub fn errno_to_zig_err(errno: i32) -> crate::Error {
    debug_assert!(errno != 0);
    crate::Error::from_errno(errno)
}

// ── time ──────────────────────────────────────────────────────────────────
// Ports of `std.time.{nanoTimestamp,milliTimestamp,timestamp}` plus the
// constants the install/http crates reference. Using libc clock_gettime keeps
// this consistent with the Zig stdlib (which does the same on POSIX).
pub mod time {
    pub const NS_PER_MS: i128 = 1_000_000;
    pub const NS_PER_S: i128 = 1_000_000_000;
    pub const NS_PER_US: u64 = 1_000;
    pub const US_PER_MS: u64 = 1_000;
    pub const US_PER_S: u64 = 1_000_000;
    pub const MS_PER_S: i64 = 1_000;
    pub const S_PER_DAY: u32 = 86_400;
    pub const MS_PER_DAY: u64 = 86_400_000;

    /// `std.time.nanoTimestamp()` — wall-clock nanoseconds since the Unix epoch.
    #[inline]
    pub fn nano_timestamp() -> i128 {
        #[cfg(unix)]
        {
            let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
            // SAFETY: ts is valid for write.
            unsafe { libc::clock_gettime(libc::CLOCK_REALTIME, &raw mut ts) };
            (ts.tv_sec as i128) * NS_PER_S + (ts.tv_nsec as i128)
        }
        #[cfg(not(unix))]
        {
            // SystemTime is backed by GetSystemTimePreciseAsFileTime on Windows.
            match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
                Ok(d) => d.as_nanos() as i128,
                Err(e) => -(e.duration().as_nanos() as i128),
            }
        }
    }
    /// `std.time.milliTimestamp()`
    #[inline] pub fn milli_timestamp() -> i64 { (nano_timestamp() / NS_PER_MS) as i64 }
    /// `std.time.timestamp()` — wall-clock seconds since the Unix epoch.
    #[inline] pub fn timestamp() -> i64 { (nano_timestamp() / NS_PER_S) as i64 }

    /// `std.time.Timer` — monotonic stopwatch.
    #[derive(Clone, Copy, Debug)]
    pub struct Timer { start: std::time::Instant }
    impl Timer {
        #[inline] pub fn start() -> Result<Self, crate::Error> { Ok(Self { start: std::time::Instant::now() }) }
        #[inline] pub fn read(&self) -> u64 { self.start.elapsed().as_nanos() as u64 }
        #[inline] pub fn lap(&mut self) -> u64 {
            let now = std::time::Instant::now();
            let ns = now.duration_since(self.start).as_nanos() as u64;
            self.start = now;
            ns
        }
        #[inline] pub fn reset(&mut self) { self.start = std::time::Instant::now(); }
    }
}

// ── runtime_embed_file ────────────────────────────────────────────────────
// Port of `bun.runtimeEmbedFile` (bun.zig:2938). The Zig version comptime-
// captures `sub_path` to manufacture a per-call-site `static once` cache; Rust
// can't do that from a plain fn without leaking, so the canonical port is the
// `runtime_embed_file!` macro below (per-site `OnceLock<String>` — sanctioned
// by PORTING.md §Forbidden, "true process-lifetime singleton"). The fn form is
// kept so existing Phase-A drafts type-check; it's only reachable when the
// `codegen_embed` feature is off (debug fast-iteration), where panicking with a
// migration hint is the same UX as the Zig `Output.panic` on read failure.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EmbedKind { Codegen, CodegenEager, Src, SrcEager }
/// Phase-A drafts spelled this both ways; alias keeps both compiling.
pub type EmbedDir = EmbedKind;

pub fn runtime_embed_file(_root: EmbedKind, sub_path: &'static str) -> &'static str {
    debug_assert!(crate::Environment::IS_DEBUG);
    panic!(
        "runtime_embed_file({sub_path}): non-embedded debug load requires a per-site \
         static cache — migrate this call to `bun_core::runtime_embed_file!` or rebuild \
         with codegen_embed",
    );
}

/// Per-call-site embedded file. `($root, $sub_path)` mirrors the Zig
/// signature; `$root` must be one of the bare idents `Codegen` /
/// `CodegenEager` / `Src` / `SrcEager` and `$sub_path` a string literal.
///
/// The `cfg(bun_codegen_embed)` split lives **inside** the macro so call
/// sites never repeat the `#[cfg]`/`#[cfg(not)]` pair (which is error-prone
/// — a missed pair leaves a release binary that panics with "Failed to load
/// '<build-machine-path>/…'"). Under the cfg, the file is `include_str!`-ed
/// at compile time; otherwise it's read once at runtime into a per-site
/// `OnceLock<String>` for fast iteration.
///
/// `Src` paths are relative to `<repo>/src/`; `Codegen` paths are relative
/// to `BUN_CODEGEN_DIR`. The embed arm resolves both via the *call-site
/// crate's* `CARGO_MANIFEST_DIR` / `BUN_CODEGEN_DIR` (every workspace crate
/// lives at `src/<crate>/`, so `../../src/` is the repo `src/`;
/// `BUN_CODEGEN_DIR` is exported to every rustc by `scripts/build/rust.ts`
/// whenever `bun_codegen_embed` is set).
#[macro_export]
macro_rules! runtime_embed_file {
    (Codegen,      $sub:literal) => { $crate::__runtime_embed_impl!(@codegen $sub) };
    (CodegenEager, $sub:literal) => { $crate::__runtime_embed_impl!(@codegen $sub) };
    (Src,          $sub:literal) => { $crate::__runtime_embed_impl!(@src     $sub) };
    (SrcEager,     $sub:literal) => { $crate::__runtime_embed_impl!(@src     $sub) };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __runtime_embed_impl {
    (@codegen $sub:literal) => {{
        // `bun_codegen_embed` is set via RUSTFLAGS by scripts/build/rust.ts;
        // plain `cargo check` doesn't pass `--check-cfg` for it.
        #[allow(unexpected_cfgs)]
        let __s: &'static str = {
            #[cfg(bun_codegen_embed)]
            { ::core::include_str!(::core::concat!(::core::env!("BUN_CODEGEN_DIR"), "/", $sub)) }
            #[cfg(not(bun_codegen_embed))]
            { $crate::__runtime_embed_impl!(@load $crate::EmbedKind::Codegen, $sub) }
        };
        __s
    }};
    (@src $sub:literal) => {{
        #[allow(unexpected_cfgs)]
        let __s: &'static str = {
            #[cfg(bun_codegen_embed)]
            {
                // Every workspace crate's manifest is at `<repo>/src/<crate>/`,
                // so `../../src/` is `<repo>/src/` regardless of call site.
                ::core::include_str!(::core::concat!(
                    ::core::env!("CARGO_MANIFEST_DIR"), "/../../src/", $sub
                ))
            }
            #[cfg(not(bun_codegen_embed))]
            { $crate::__runtime_embed_impl!(@load $crate::EmbedKind::Src, $sub) }
        };
        __s
    }};
    (@load $kind:expr, $sub:literal) => {{
        static __CELL: ::std::sync::OnceLock<String> = ::std::sync::OnceLock::new();
        __CELL.get_or_init(|| {
            let mut p = match $kind {
                $crate::EmbedKind::Codegen | $crate::EmbedKind::CodegenEager => {
                    ::std::path::PathBuf::from(
                        ::std::str::from_utf8($crate::build_options::CODEGEN_PATH).unwrap_or(""),
                    )
                }
                $crate::EmbedKind::Src | $crate::EmbedKind::SrcEager => {
                    let mut b = ::std::path::PathBuf::from(
                        ::std::str::from_utf8($crate::build_options::BASE_PATH).unwrap_or(""),
                    );
                    b.push("src");
                    b
                }
            };
            p.push($sub);
            ::std::fs::read_to_string(&p).unwrap_or_else(|e| {
                panic!(
                    "Failed to load '{}': {e}\n\n\
                     To improve iteration speed, some files are not embedded but loaded \
                     at runtime, at the cost of making the binary non-portable. To fix \
                     this, build with codegen_embed.",
                    p.display(),
                )
            })
        }).as_str()
    }};
}

// ── StringBuilder ─────────────────────────────────────────────────────────
// Port of src/string/StringBuilder.zig. Count-then-allocate-then-append arena
// for building a single contiguous buffer. Allocator param dropped per
// PORTING.md §Allocators (always `bun.default_allocator`).
//
// PORT NOTE: returned sub-slices borrow `*self`, but in Zig they alias the
// final `allocated_slice()` and outlive the builder. To keep that pattern
// without self-referential lifetimes, callers stash `(offset, len)` via
// `StringPointer` (see install/hosted_git_info.rs).
//
// Canonical `StringBuilder` lives in `bun_string::StringBuilder`
// (src/string/StringBuilder.rs). Cannot re-export here (`bun_string` depends
// on `bun_core` → cycle); callers import `bun_string::StringBuilder` directly.
// `StringPointer` stays here as the layered #[repr(C)] ABI type re-exported by
// `bun_string` et al.

/// `bun.schema.api.StringPointer` — `(offset, length)` span into an external
/// buffer. Canonical definition; re-exported by `bun_string`, `bun_http_types`,
/// and `bun_url` (formerly each had a structurally-identical copy). Layout MUST
/// match `extern struct { offset: u32, length: u32 }` — C++ (`WebCore::FetchHeaders`)
/// and on-disk formats (lockfile, npm manifest cache) read it directly.
#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct StringPointer { pub offset: u32, pub length: u32 }
impl StringPointer {
    #[inline] pub fn slice<'a>(&self, buf: &'a [u8]) -> &'a [u8] {
        &buf[self.offset as usize..(self.offset + self.length) as usize]
    }
    #[inline] pub fn is_empty(self) -> bool { self.length == 0 }
}

// ── ZStr trait sugar (downstream ergonomics) ──────────────────────────────
impl AsRef<ZStr> for ZStr { #[inline] fn as_ref(&self) -> &ZStr { self } }
impl AsRef<[u8]> for ZStr { #[inline] fn as_ref(&self) -> &[u8] { &self.0 } }
impl PartialEq<[u8]> for ZStr { #[inline] fn eq(&self, other: &[u8]) -> bool { &self.0 == other } }
impl<const N: usize> PartialEq<&[u8; N]> for ZStr {
    #[inline] fn eq(&self, other: &&[u8; N]) -> bool { &self.0 == *other }
}

// ── Hasher trait (Zig "anytype with .update([]const u8)") ─────────────────
// Used by `bun_core::write_any_to_hasher` and bundler/css hashing. Mirrors
// the minimal Zig hasher protocol — *not* `core::hash::Hasher` because Bun's
// hashers (Wyhash, XxHash64, sha1) expose `.update(&[u8])` + `.final()`.
pub trait Hasher {
    fn update(&mut self, bytes: &[u8]);
}
// Blanket: anything that already is a `core::hash::Hasher` also satisfies
// Bun's Hasher (its `.write` IS the byte-feed).
impl<H: core::hash::Hasher> Hasher for H {
    #[inline] fn update(&mut self, bytes: &[u8]) { self.write(bytes) }
}

/// Port of `bun.writeAnyToHasher`. Zig fed `std.mem.asBytes(&thing)`; Rust
/// can't take a generic by-value-as-bytes safely without `bytemuck`, so this
/// accepts anything that is itself viewable as bytes (covers the actual call
/// sites: `u8` tags, `usize` lengths, `Index` newtypes).
#[inline]
pub fn write_any_to_hasher<H: Hasher + ?Sized, T: AsBytes + ?Sized>(hasher: &mut H, thing: T)
where T: Sized {
    hasher.update(thing.as_bytes_for_hash());
}

/// Helper trait for `write_any_to_hasher` — "viewable as raw bytes".
/// Blanket-implemented for all `Copy` plain-data ints and references-to-slices.
pub trait AsBytes {
    fn as_bytes_for_hash(&self) -> &[u8];
}
macro_rules! as_bytes_pod {
    ($($t:ty),* $(,)?) => { $(
        impl AsBytes for $t {
            #[inline] fn as_bytes_for_hash(&self) -> &[u8] {
                // SAFETY: POD integer; size_of::<Self> readable bytes.
                unsafe { core::slice::from_raw_parts(
                    core::ptr::from_ref::<Self>(self).cast::<u8>(),
                    core::mem::size_of::<Self>(),
                ) }
            }
        }
    )* }
}
as_bytes_pod!(u8, i8, u16, i16, u32, i32, u64, i64, usize, isize, u128, i128);
impl<T: AsBytes> AsBytes for &T {
    #[inline] fn as_bytes_for_hash(&self) -> &[u8] { (**self).as_bytes_for_hash() }
}

// ── GenericIndex ──────────────────────────────────────────────────────────
// Port of `bun.GenericIndex(backing_int, uid)` (bun.zig:3513). Zig used a
// distinct enum-per-uid for nominal typing; Rust gets that via a phantom
// marker. `MAX` is reserved as the "none" sentinel for `Optional`.
#[repr(transparent)]
pub struct GenericIndex<I, M = ()>(I, core::marker::PhantomData<M>);

impl<I: Copy, M> Clone for GenericIndex<I, M> { #[inline] fn clone(&self) -> Self { *self } }
impl<I: Copy, M> Copy for GenericIndex<I, M> {}
impl<I: PartialEq, M> PartialEq for GenericIndex<I, M> {
    #[inline] fn eq(&self, o: &Self) -> bool { self.0 == o.0 }
}
impl<I: Eq, M> Eq for GenericIndex<I, M> {}
impl<I: core::hash::Hash, M> core::hash::Hash for GenericIndex<I, M> {
    #[inline] fn hash<H: core::hash::Hasher>(&self, h: &mut H) { self.0.hash(h) }
}
impl<I: core::fmt::Display, M> core::fmt::Display for GenericIndex<I, M> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result { self.0.fmt(f) }
}
impl<I: core::fmt::Debug, M> core::fmt::Debug for GenericIndex<I, M> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result { self.0.fmt(f) }
}

impl<I: GenericIndexInt, M> GenericIndex<I, M> {
    /// Prefer over a raw cast — asserts `int != MAX` (would alias `.none`).
    #[inline] pub fn init(int: I) -> Self {
        debug_assert!(int != I::NULL_VALUE, "GenericIndex::init: maxInt is reserved for Optional::none");
        Self(int, core::marker::PhantomData)
    }
    #[inline] pub fn get(self) -> I {
        debug_assert!(self.0 != I::NULL_VALUE, "GenericIndex::get: corrupted (== none sentinel)");
        self.0
    }
    #[inline] pub fn to_optional(self) -> GenericIndexOptional<I, M> {
        GenericIndexOptional(self.0, core::marker::PhantomData)
    }
    #[inline] pub fn sort_fn_asc(_: &(), a: &Self, b: &Self) -> bool { a.0 < b.0 }
}

/// `GenericIndex::Optional` — `MAX` is `none`.
#[repr(transparent)]
pub struct GenericIndexOptional<I, M = ()>(I, core::marker::PhantomData<M>);
impl<I: Copy, M> Clone for GenericIndexOptional<I, M> { #[inline] fn clone(&self) -> Self { *self } }
impl<I: Copy, M> Copy for GenericIndexOptional<I, M> {}
impl<I: GenericIndexInt, M> GenericIndexOptional<I, M> {
    pub const NONE: Self = Self(I::NULL_VALUE, core::marker::PhantomData);
    #[inline] pub fn init(maybe: Option<I>) -> Self {
        match maybe { Some(i) => GenericIndex::<I, M>::init(i).to_optional(), None => Self::NONE }
    }
    #[inline] pub fn unwrap(self) -> Option<GenericIndex<I, M>> {
        if self.0 == I::NULL_VALUE { None } else { Some(GenericIndex(self.0, core::marker::PhantomData)) }
    }
    #[inline] pub fn unwrap_get(self) -> Option<I> {
        if self.0 == I::NULL_VALUE { None } else { Some(self.0) }
    }
}

/// Backing-integer bound for `GenericIndex` (replaces Zig's `comptime backing_int: type`).
pub trait GenericIndexInt: Copy + Eq + PartialOrd {
    const NULL_VALUE: Self;
}
macro_rules! generic_index_int { ($($t:ty),*) => { $(
    impl GenericIndexInt for $t { const NULL_VALUE: Self = <$t>::MAX; }
)* } }
generic_index_int!(u8, u16, u32, u64, usize);

/// Generic-integer bound replacing Zig's `comptime T: type` + `@typeInfo(T).Int`
/// in `validateIntegerRange` / `validateBigIntRange` / `getInteger`
/// (src/jsc/JSGlobalObject.zig). Provides the small surface those callers need:
/// signedness, range as `i128`, and lossy/wrapping casts from the JSC numeric
/// carriers (i32 / f64 / i64 / u64).
pub trait Integer: Copy + Default {
    const SIGNED: bool;
    const MIN_I128: i128;
    const MAX_I128: i128;
    const ZERO: Self;
    fn from_i32(v: i32) -> Self;
    fn from_f64(v: f64) -> Self;
    fn from_i64(v: i64) -> Self;
    fn from_u64(v: u64) -> Self;
    fn to_f64(self) -> f64;
}
macro_rules! impl_integer {
    ($($t:ty: $signed:expr),* $(,)?) => { $(
        impl Integer for $t {
            const SIGNED: bool = $signed;
            const MIN_I128: i128 = <$t>::MIN as i128;
            const MAX_I128: i128 = <$t>::MAX as i128;
            const ZERO: Self = 0;
            #[inline] fn from_i32(v: i32) -> Self { v as Self }
            #[inline] fn from_f64(v: f64) -> Self { v as Self }
            #[inline] fn from_i64(v: i64) -> Self { v as Self }
            #[inline] fn from_u64(v: u64) -> Self { v as Self }
            #[inline] fn to_f64(self) -> f64 { self as f64 }
        }
    )* };
}
impl_integer!(
    i8: true, i16: true, i32: true, i64: true, isize: true,
    u8: false, u16: false, u32: false, u64: false, usize: false,
);

/// Primitive integers transcodable as native-endian raw bytes.
///
/// Replaces Zig's `comptime T: type` + `std.mem.readIntSliceNative` /
/// `std.mem.asBytes` / `@bitCast` reflection pattern with an explicit trait
/// bound. Shared by the peechy wire codec (`bun_analytics::SchemaInt`) and the
/// MySQL protocol reader (`bun_sql::ReadableInt`), which re-export this under
/// their local names.
pub trait NativeEndianInt: Copy + 'static {
    const SIZE: usize;
    /// Reinterpret `b[..SIZE]` as `Self` (native endian).
    fn from_ne_slice(b: &[u8]) -> Self;
    /// Write `self.to_ne_bytes()` into `out[..SIZE]`.
    fn encode_ne(self, out: &mut [u8]);
}

macro_rules! impl_native_endian_int {
    ($($t:ty),* $(,)?) => {$(
        impl NativeEndianInt for $t {
            const SIZE: usize = core::mem::size_of::<$t>();
            #[inline]
            fn from_ne_slice(b: &[u8]) -> Self {
                let mut a = [0u8; core::mem::size_of::<$t>()];
                a.copy_from_slice(&b[..core::mem::size_of::<$t>()]);
                <$t>::from_ne_bytes(a)
            }
            #[inline]
            fn encode_ne(self, out: &mut [u8]) {
                out[..core::mem::size_of::<$t>()].copy_from_slice(&self.to_ne_bytes());
            }
        }
    )*};
}
impl_native_endian_int!(u8, i8, u16, i16, u32, i32, u64, i64);

// ── mach_port ─────────────────────────────────────────────────────────────
// Zig: `if (Environment.isMac) std.c.mach_port_t else u32`.
#[cfg(target_os = "macos")]
pub type mach_port = libc::mach_port_t;
#[cfg(not(target_os = "macos"))]
pub type mach_port = u32;

// ── rand ──────────────────────────────────────────────────────────────────
// `std.Random.DefaultPrng` is xoshiro256++ in Zig stdlib. Port the exact
// algorithm so `bun.fastRandom()` output is reproducible across the rewrite.
pub mod rand {
    /// xoshiro256++ — `std.Random.DefaultPrng`.
    #[derive(Clone, Copy)]
    pub struct DefaultPrng { s: [u64; 4] }
    impl DefaultPrng {
        /// Seed via splitmix64 (matches Zig stdlib `Xoshiro256.init`).
        pub fn init(seed: u64) -> Self {
            let mut sm = seed;
            let mut s = [0u64; 4];
            for slot in &mut s {
                sm = sm.wrapping_add(0x9e3779b97f4a7c15);
                let mut z = sm;
                z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
                z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
                *slot = z ^ (z >> 31);
            }
            Self { s }
        }
        #[inline]
        pub fn next_u64(&mut self) -> u64 {
            let r = self.s[0]
                .wrapping_add(self.s[3])
                .rotate_left(23)
                .wrapping_add(self.s[0]);
            let t = self.s[1] << 17;
            self.s[2] ^= self.s[0];
            self.s[3] ^= self.s[1];
            self.s[1] ^= self.s[2];
            self.s[0] ^= self.s[3];
            self.s[2] ^= t;
            self.s[3] = self.s[3].rotate_left(45);
            r
        }
    }
}

/// Port of `bun.fastRandom()`. Thread-local xoshiro256++ seeded once per
/// process from the OS CSPRNG (or `BUN_DEBUG_HASH_RANDOM_SEED` in debug).
pub fn fast_random() -> u64 {
    use core::cell::Cell;
    use core::sync::atomic::{AtomicU64, Ordering as O};
    static SEED: AtomicU64 = AtomicU64::new(0);
    fn random_seed() -> u64 {
        let mut v = SEED.load(O::Relaxed);
        while v == 0 {
            // Spec (bun.zig:575) gates on `Environment.isDebug or Environment.is_canary`;
            // bun_core has no `canary` cargo feature yet, so debug-only for now (no
            // regression vs. either pre-dedup copy — tracked separately).
            #[cfg(debug_assertions)]
            if let Some(n) = crate::env_var::BUN_DEBUG_HASH_RANDOM_SEED.get() {
                SEED.store(n, O::Relaxed);
                return n;
            }
            let mut buf = [0u8; 8];
            csprng(&mut buf);
            v = u64::from_ne_bytes(buf);
            SEED.store(v, O::Relaxed);
            v = SEED.load(O::Relaxed);
        }
        v
    }
    thread_local! {
        static PRNG: Cell<Option<rand::DefaultPrng>> = const { Cell::new(None) };
    }
    PRNG.with(|p| {
        let mut prng = p.take().unwrap_or_else(|| rand::DefaultPrng::init(random_seed()));
        let v = prng.next_u64();
        p.set(Some(prng));
        v
    })
}

// ── hash ──────────────────────────────────────────────────────────────────
// `bun.hash` (Wyhash) lives in deprecated.rs as RapidHash; this module adds
// the xxhash64 entry point that ETag/bundler need.
pub mod hash {
    unsafe extern "C" {
        // Provided by vendor/zstd's bundled xxhash (XXH64). Linked at Phase C.
        fn XXH64(input: *const core::ffi::c_void, len: usize, seed: u64) -> u64;
    }
    /// `std.hash.XxHash64.hash(seed, bytes)`.
    #[inline]
    pub fn xxhash64(seed: u64, bytes: &[u8]) -> u64 {
        // SAFETY: FFI reads exactly `bytes.len()` bytes.
        unsafe { XXH64(bytes.as_ptr().cast(), bytes.len(), seed) }
    }
    /// Wyhash one-shot (Zig `bun.hash`).
    #[inline]
    pub fn wyhash(bytes: &[u8]) -> u64 { crate::deprecated::RapidHash::hash(0, bytes) }
}

// ── base64 ────────────────────────────────────────────────────────────────
// Thin simdutf-backed encoders + scalar decoder. Port of the subset of
// `src/base64/base64.zig` that tier-0/1 callers need (npm auth, sourcemaps,
// ansi_renderer). Full URL-safe / streaming variants stay in bun_base64.
pub mod base64 {
    use bun_simdutf_sys::simdutf;

    /// Max encoded length for `source.len()` input bytes (standard alphabet,
    /// padded). Port of `bun.base64.encodeLen`.
    #[inline]
    pub const fn encode_len(source: &[u8]) -> usize {
        // simdutf::base64_length_from_binary(len, default)
        standard_encoder_calc_size(source.len())
    }

    /// `bun.base64.encode` — standard alphabet, padded. Returns bytes written.
    pub fn encode(dest: &mut [u8], source: &[u8]) -> usize {
        debug_assert!(dest.len() >= encode_len(source));
        simdutf::base64::encode(source, dest, false)
    }

    /// `std.base64.standard.Encoder.calcSize` — alias of `encode_len` taking a length.
    #[inline]
    pub const fn standard_encoder_calc_size(source_len: usize) -> usize {
        ((source_len + 2) / 3) * 4
    }

    /// `std.base64.standard.Encoder.encode` returning the written sub-slice.
    pub fn standard_encode<'a>(dest: &'a mut [u8], source: &[u8]) -> &'a [u8] {
        let n = encode(dest, source);
        &dest[..n]
    }

    /// Upper bound on decoded length (standard, may be 0..2 bytes over).
    #[inline]
    pub fn decode_len(source: &[u8]) -> usize { (source.len() / 4) * 3 + 3 }

    /// Result of a decode-into-buffer call.
    #[derive(Clone, Copy, Debug)]
    pub struct DecodeResult { pub written: usize, pub fail: bool }

    /// `bun.base64.decode`. Scalar fallback (PERF(port): simdutf path in
    /// bun_base64). Tolerates missing padding; stops at first invalid char.
    pub fn decode(dest: &mut [u8], source: &[u8]) -> DecodeResult {
        const INV: u8 = 0xFF;
        static LUT: [u8; 256] = {
            let mut t = [INV; 256];
            let mut i = 0u8;
            while i < 26 { t[(b'A' + i) as usize] = i; i += 1; }
            let mut i = 0u8;
            while i < 26 { t[(b'a' + i) as usize] = 26 + i; i += 1; }
            let mut i = 0u8;
            while i < 10 { t[(b'0' + i) as usize] = 52 + i; i += 1; }
            t[b'+' as usize] = 62;
            t[b'/' as usize] = 63;
            t
        };
        let mut w = 0usize;
        let mut acc: u32 = 0;
        let mut bits: u32 = 0;
        for &c in source {
            if c == b'=' || c == b'\n' || c == b'\r' { continue; }
            let v = LUT[c as usize];
            if v == INV { return DecodeResult { written: w, fail: true }; }
            acc = (acc << 6) | v as u32;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                if w >= dest.len() { return DecodeResult { written: w, fail: true }; }
                dest[w] = (acc >> bits) as u8;
                w += 1;
            }
        }
        DecodeResult { written: w, fail: false }
    }
}

// ── dupe_z / free_sensitive ───────────────────────────────────────────────
/// `bun.default_allocator.dupeZ(u8, bytes)` → heap-allocated NUL-terminated
/// copy. Returns a raw `*const c_char` because the SSLConfig FFI surface
/// stores C-strings. Caller frees via [`free_sensitive`].
///
/// Allocated via mimalloc (the process-global default allocator), NOT
/// `libc::malloc`. Under ASAN, libc malloc/free are intercepted and freed
/// buffers sit in a ~256 MiB quarantine; routing the per-connection cert/key
/// dups through libc made the SSLConfig leak test (`websocket.test.js`
/// "bounded RSS growth") observe ~250 MiB RSS growth even though every
/// allocation was correctly freed. Matching the Zig spec
/// (`bun.default_allocator`) keeps these in mimalloc and out of quarantine.
pub fn dupe_z(bytes: &[u8]) -> *const core::ffi::c_char {
    // SAFETY: mimalloc FFI; returns null on OOM or a writable region of
    // ≥len+1 bytes (alignment ≤ MI_MAX_ALIGN_SIZE for u8).
    unsafe {
        let p = bun_alloc::mimalloc::mi_malloc(bytes.len() + 1).cast::<u8>();
        if p.is_null() { crate::out_of_memory(); }
        core::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
        *p.add(bytes.len()) = 0;
        p as *const core::ffi::c_char
    }
}

/// Port of `bun.freeSensitive(bun.default_allocator, slice)` for the C-string
/// case used by http SSLConfig. Zeros the allocation before freeing
/// (defence-in-depth for keys/passphrases). `p` must have been allocated by
/// [`dupe_z`] (i.e. mimalloc, NUL-terminated).
pub fn free_sensitive(p: *const core::ffi::c_char) {
    if p.is_null() { return; }
    // SAFETY: p is a NUL-terminated mimalloc'd buffer per `dupe_z` contract.
    unsafe {
        let len = libc::strlen(p);
        secure_zero(p as *mut u8, len);
        // `mi_free` is size-agnostic (mimalloc tracks the allocation size in
        // page metadata), so an interior NUL truncating `strlen` only shortens
        // the zero pass — the free is still exact.
        bun_alloc::basic::free_without_size(p as *mut core::ffi::c_void);
    }
}

/// Port of `std.crypto.secureZero` — `@memset(@volatileCast(s), 0)`. Zeros
/// `len` bytes at `p` in a way the optimizer cannot elide. Uses bulk
/// `write_bytes` (lowers to `memset`) instead of a per-byte volatile loop so
/// debug builds don't pay O(len) iteration overhead — the SSLConfig leak test
/// secure-zeros ~300 MiB of cert material across 1200 iterations and the
/// per-byte loop alone took ~3 s in debug. `black_box` on the pointer after
/// the memset forces the compiler to assume the zeroed region is observed,
/// preventing dead-store elimination in release builds.
///
/// # Safety
/// `p` must be valid for writes of `len` bytes.
#[inline]
pub unsafe fn secure_zero(p: *mut u8, len: usize) {
    // SAFETY: caller contract.
    unsafe { core::ptr::write_bytes(p, 0, len) };
    // Treat `p` as escaped so the preceding stores cannot be eliminated.
    core::hint::black_box(p);
    core::sync::atomic::compiler_fence(core::sync::atomic::Ordering::SeqCst);
}

// ── argv ──────────────────────────────────────────────────────────────────
// `bun.argv` — process argv as a slice of NUL-terminated byte strings.
// Zig: `pub var argv: [][:0]const u8`. The owned `ZBox` backing for the
// initial OS argv lives in `ARGV_STORAGE`; `ARGV` is the mutable *view*
// slice that call sites read (and that `set_argv` swaps for the
// `--compile` exec-argv splicing path in `cli.zig`). Exposed via a tiny
// `Argv` wrapper so call sites can use it both as a slice (`.get(0)`,
// `.iter()`, `.len()`, `.as_slice()`) and as an `IntoIterator<Item = &[u8]>`
// for `for arg in argv()`.
static ARGV_STORAGE: std::sync::OnceLock<Vec<ZBox>> = std::sync::OnceLock::new();
static ARGV: RacyCell<&'static [&'static ZStr]> = RacyCell::new(&[]);
static ARGV_INIT: std::sync::Once = std::sync::Once::new();

/// Raw `(argc, argv)` as passed to `main` by the C runtime. Captured by
/// [`init_argv`] before any other code runs. On glibc / macOS / Windows,
/// libstd captures argv independently via a `.init_array` constructor /
/// `_NSGetArgv` / `GetCommandLineW`, so `std::env::args_os()` works without
/// this; on **musl-static** the `.init_array` constructor is invoked with no
/// arguments (musl's `__libc_start_main` does not forward `(argc,argv,envp)`
/// to constructors), so `std::env::args_os()` returns empty and we must read
/// the kernel-provided block ourselves. Zig's `_start` writes `std.os.argv`
/// directly from the stack — this is the equivalent for a clang-linked
/// `extern "C" fn main`.
static OS_ARGC: core::sync::atomic::AtomicUsize = core::sync::atomic::AtomicUsize::new(0);
static OS_ARGV: core::sync::atomic::AtomicPtr<*const core::ffi::c_char> =
    core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());

/// Capture the raw `argc`/`argv` passed to `main` by the C runtime. Must be
/// the very first call in `main`, before the crash handler (whose panic path
/// dumps the command line) or anything else that might call [`argv()`].
///
/// Matches Zig `bun.initArgv` which on POSIX wraps `std.os.argv` (set by
/// Zig's own `_start` from the kernel-provided argv block).
///
/// # Safety
/// `argv` must point to `argc` valid NUL-terminated C strings that live for
/// the entire process (the kernel/crt argv block does). Calling this after
/// [`argv()`] has been observed is a logic error — the `OnceLock` will
/// already have been populated from the fallback path.
pub unsafe fn init_argv(argc: core::ffi::c_int, argv: *const *const core::ffi::c_char) {
    OS_ARGC.store(argc.max(0) as usize, core::sync::atomic::Ordering::Relaxed);
    OS_ARGV.store(argv as *mut _, core::sync::atomic::Ordering::Relaxed);
}

/// Kernel-provided argv slice if [`init_argv`] was called, else `None`.
#[inline]
fn raw_os_argv() -> Option<&'static [*const core::ffi::c_char]> {
    let p = OS_ARGV.load(core::sync::atomic::Ordering::Relaxed);
    if p.is_null() {
        return None;
    }
    let n = OS_ARGC.load(core::sync::atomic::Ordering::Relaxed);
    // SAFETY: `init_argv` contract — `p` points to `n` C-string pointers that
    // live for the process lifetime.
    Some(unsafe { core::slice::from_raw_parts(p, n) })
}

fn argv_storage() -> &'static [ZBox] {
    ARGV_STORAGE.get_or_init(|| {
        if let Some(raw) = raw_os_argv() {
            return raw
                .iter()
                .map(|&p| {
                    // SAFETY: kernel argv entries are NUL-terminated and live
                    // for the process; `init_argv` guarantees `p` is valid.
                    let s = unsafe { core::ffi::CStr::from_ptr(p) };
                    ZBox::from_bytes(s.to_bytes())
                })
                .collect();
        }
        // Fallback for entry points that don't go through `extern "C" fn main`
        // (e.g. `cargo test` harness, Rust `fn main()` via `lang_start`). On
        // glibc/macOS/Windows this also works for the real binary — only
        // musl-static needs the `raw_os_argv` path above.
        std::env::args_os()
            .map(|a| ZBox::from_vec_with_nul(a.into_encoded_bytes()))
            .collect()
    })
}

#[inline]
fn argv_view() -> &'static [&'static ZStr] {
    ARGV_INIT.call_once(|| {
        let storage: &'static [ZBox] = argv_storage();
        // ARGV_STORAGE is process-static via OnceLock; `as_zstr` borrows for `'static`.
        let mut view: Vec<&'static ZStr> = storage.iter().map(ZBox::as_zstr).collect();
        // Zig `initArgv`: splice BUN_OPTIONS tokens after argv[0].
        if let Some(opts) = crate::env_var::BUN_OPTIONS.get() {
            let original_len = view.len();
            append_options_env::<&'static ZStr>(opts, &mut view);
            set_bun_options_argc(view.len() - original_len);
        }
        // SAFETY: single-threaded lazy init guarded by Once.
        unsafe { ARGV.write(Vec::leak(view)) };
    });
    // SAFETY: ARGV is a Copy fat-pointer; only mutated via `set_argv` during
    // single-threaded startup or by the Once above.
    unsafe { ARGV.read() }
}

#[derive(Clone, Copy)]
pub struct Argv(&'static [&'static ZStr]);
impl Argv {
    #[inline] pub fn len(&self) -> usize { self.0.len() }
    #[inline] pub fn is_empty(&self) -> bool { self.0.is_empty() }
    #[inline] pub fn get(&self, i: usize) -> Option<&'static ZStr> { self.0.get(i).copied() }
    #[inline] pub fn iter(&self) -> ArgvIter { ArgvIter { inner: self.0, i: 0 } }
    /// Borrow the underlying `[&ZStr]` view (Zig: `bun.argv[..]`).
    #[inline] pub fn as_slice(&self) -> &'static [&'static ZStr] { self.0 }
    /// Owned `Vec` copy of the view — used by call sites that need to append
    /// (e.g. `--compile` exec-argv splicing) before leaking + `set_argv`.
    #[inline] pub fn to_vec(&self) -> Vec<&'static ZStr> { self.0.to_vec() }
}
impl IntoIterator for Argv {
    type Item = &'static [u8];
    type IntoIter = ArgvIter;
    #[inline] fn into_iter(self) -> ArgvIter { self.iter() }
}
pub struct ArgvIter { inner: &'static [&'static ZStr], i: usize }
impl Iterator for ArgvIter {
    type Item = &'static [u8];
    #[inline]
    fn next(&mut self) -> Option<&'static [u8]> {
        let z = *self.inner.get(self.i)?;
        self.i += 1;
        Some(z.as_bytes())
    }
}

/// `bun.argv` accessor.
#[inline] pub fn argv() -> Argv { Argv(argv_view()) }

// ─── BUN_OPTIONS argv injection (bun.zig: bun_options_argc / appendOptionsEnv) ──
/// Number of arguments injected into `argv` by the `BUN_OPTIONS` environment
/// variable. Set once during single-threaded startup (`init_argv`).
static BUN_OPTIONS_ARGC: core::sync::atomic::AtomicUsize =
    core::sync::atomic::AtomicUsize::new(0);

/// Zig: `bun.bun_options_argc` — read accessor.
///
/// Forces the lazy `argv_view()` init before reading: in Zig `initArgv()`
/// runs eagerly in `main()` so `bun.bun_options_argc` is always populated by
/// the time `cli.zig` reads it; here `argv()` is lazy, so a caller that reads
/// `bun_options_argc()` *before* `argv()` (e.g. the standalone-executable
/// path in `Command::start`) would otherwise see 0 and miscount the
/// BUN_OPTIONS-injected args when computing the passthrough offset.
#[inline]
pub fn bun_options_argc() -> usize {
    let _ = argv_view();
    BUN_OPTIONS_ARGC.load(core::sync::atomic::Ordering::Relaxed)
}
/// Zig: `bun.bun_options_argc = n` — write accessor (single-threaded startup).
#[inline]
pub fn set_bun_options_argc(n: usize) {
    BUN_OPTIONS_ARGC.store(n, core::sync::atomic::Ordering::Relaxed);
}

/// Trait for arg types accepted by [`append_options_env`] (replaces Zig
/// `comptime ArgType` in `bun.appendOptionsEnv`). Impl'd for `bun_string::String`
/// and `Box<ZStr>` in their owning crates.
pub trait OptionsEnvArg {
    fn from_slice(s: &[u8]) -> Self;
    fn from_buf(buf: Vec<u8>) -> Self;
}

/// Zig `[:0]const u8` arm of `appendOptionsEnv`: `default_allocator.allocSentinel`
/// + never freed (process-lifetime argv storage). The leaked allocation matches
/// the Zig alloc/free pairing exactly — argv entries live for the process.
impl OptionsEnvArg for &'static ZStr {
    fn from_slice(s: &[u8]) -> Self {
        let mut v = Vec::with_capacity(s.len() + 1);
        v.extend_from_slice(s);
        v.push(0);
        let z: &'static [u8] = v.leak();
        // SAFETY: `z[len-1] == 0` (just pushed) and `z` is process-static.
        unsafe { ZStr::from_raw(z.as_ptr(), z.len() - 1) }
    }
    fn from_buf(mut buf: Vec<u8>) -> Self {
        buf.push(0);
        let z: &'static [u8] = buf.leak();
        // SAFETY: `z[len-1] == 0` (just pushed) and `z` is process-static.
        unsafe { ZStr::from_raw(z.as_ptr(), z.len() - 1) }
    }
}

/// Zig: `bun.appendOptionsEnv` — parse a `BUN_OPTIONS`-style string
/// (`--flag=value --flag2 "quoted value" bare`) and insert each token into
/// `args` starting at index 1 (Zig callers prepend a placeholder at [0]).
pub fn append_options_env<A: OptionsEnvArg>(env: &[u8], args: &mut Vec<A>) {
    let mut i: usize = 0;
    let mut offset_in_args: usize = 1;
    while i < env.len() {
        // skip whitespace
        while i < env.len() && env[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= env.len() {
            break;
        }

        // Handle all command-line arguments with quotes preserved
        let start = i;
        let mut j = i;

        // Check if this is an option (starts with --)
        let is_option = j + 2 <= env.len() && env[j] == b'-' && env[j + 1] == b'-';

        if is_option {
            // Find the end of the option flag (--flag)
            while j < env.len() && !env[j].is_ascii_whitespace() && env[j] != b'=' {
                j += 1;
            }

            let end_of_flag = j;
            let mut found_equals = false;

            // Check for equals sign
            if j < env.len() && env[j] == b'=' {
                found_equals = true;
                j += 1; // Move past the equals sign
            } else if j < env.len() && env[j].is_ascii_whitespace() {
                j += 1; // Move past the space
                while j < env.len() && env[j].is_ascii_whitespace() {
                    j += 1;
                }
            }

            // Handle quoted values
            if j < env.len() && (env[j] == b'\'' || env[j] == b'"') {
                let quote_char = env[j];
                j += 1; // Move past opening quote
                while j < env.len() && env[j] != quote_char {
                    j += 1;
                }
                if j < env.len() {
                    j += 1; // Move past closing quote
                }
            } else if found_equals {
                // If we had --flag=value (no quotes), find next whitespace
                while j < env.len() && !env[j].is_ascii_whitespace() {
                    j += 1;
                }
            } else {
                // No value found after flag (e.g., `--flag1 --flag2`).
                j = end_of_flag;
            }

            // Copy the entire argument including quotes
            args.insert(offset_in_args, A::from_slice(&env[start..j]));
            offset_in_args += 1;

            i = j;
            continue;
        }

        // Non-option arguments or standalone values
        let mut buf: Vec<u8> = Vec::new();

        let mut in_single = false;
        let mut in_double = false;
        let mut escape = false;
        while i < env.len() {
            let ch = env[i];
            if escape {
                buf.push(ch);
                escape = false;
                i += 1;
                continue;
            }
            if ch == b'\\' {
                escape = true;
                i += 1;
                continue;
            }
            if in_single {
                if ch == b'\'' {
                    in_single = false;
                } else {
                    buf.push(ch);
                }
                i += 1;
                continue;
            }
            if in_double {
                if ch == b'"' {
                    in_double = false;
                } else {
                    buf.push(ch);
                }
                i += 1;
                continue;
            }
            if ch == b'\'' {
                in_single = true;
            } else if ch == b'"' {
                in_double = true;
            } else if ch.is_ascii_whitespace() {
                break;
            } else {
                buf.push(ch);
            }
            i += 1;
        }

        args.insert(offset_in_args, A::from_buf(buf));
        offset_in_args += 1;
    }
}

/// `bun.argv = slice` — swap the global argv view. Zig assigns the slice
/// directly (`bun.argv = full_argv[0..n]`); call sites are single-threaded
/// startup (CLI parsing in the `--compile` path), so this writes the static
/// without synchronization.
///
/// # Safety
/// Caller must ensure no concurrent reads of `argv()` are in flight.
#[inline]
pub unsafe fn set_argv(v: &'static [&'static ZStr]) {
    // Prevent the lazy OS-argv init from later clobbering a manually-set view.
    ARGV_INIT.call_once(|| {});
    // SAFETY: see fn doc — single-threaded startup.
    unsafe { ARGV.write(v) };
}

/// Park an owned argv `Vec` in process-static storage and return the
/// now-`'static` slice. Used by the `--compile` exec-argv splice path
/// (`cli_body.rs`) which needs to extend argv beyond the original
/// OS-provided storage and then hand sub-slices to [`set_argv`]. Single-shot:
/// the slot is a `OnceLock`, so a second call drops `v` and returns the
/// first-stored slice.
pub fn intern_argv(v: Vec<&'static ZStr>) -> &'static [&'static ZStr] {
    static SLOT: std::sync::OnceLock<Box<[&'static ZStr]>> = std::sync::OnceLock::new();
    SLOT.get_or_init(move || v.into_boxed_slice())
}

// ── getcwd ────────────────────────────────────────────────────────────────
/// Port of `bun.getcwd(buf)` → `Maybe([:0]u8)`. Writes into the caller's
/// `PathBuffer` and returns the NUL-terminated slice on success.
pub fn getcwd(buf: &mut PathBuffer) -> Result<&ZStr, crate::Error> {
    #[cfg(unix)]
    unsafe {
        let p = libc::getcwd(buf.0.as_mut_ptr().cast(), buf.0.len());
        if p.is_null() {
            return Err(std::io::Error::last_os_error().into());
        }
        let len = libc::strlen(p);
        Ok(ZStr::from_raw(buf.0.as_ptr(), len))
    }
    #[cfg(windows)]
    unsafe {
        unsafe extern "system" {
            fn GetCurrentDirectoryW(nBufferLength: u32, lpBuffer: *mut u16) -> u32;
        }
        let mut wbuf = WPathBuffer::uninit();
        // SAFETY: lpBuffer points to PATH_MAX_WIDE u16s; nBufferLength matches.
        let n = GetCurrentDirectoryW(wbuf.0.len() as u32, wbuf.0.as_mut_ptr());
        if n == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        if n as usize >= wbuf.0.len() {
            // Buffer too small (return value is required size incl. NUL).
            return Err(crate::err!(NameTooLong));
        }
        let utf16 = &wbuf.0[..n as usize];
        // Reserve 1 byte for the trailing NUL.
        let cap = buf.0.len().saturating_sub(1);
        let written = match crate::strings::convert_utf16_to_utf8_in_buffer(&mut buf.0[..cap], utf16) {
            Ok(s) => s.len(),
            Err(_) => return Err(crate::err!(NameTooLong)),
        };
        buf.0[written] = 0;
        Ok(ZStr::from_raw(buf.0.as_ptr(), written))
    }
    #[cfg(not(any(unix, windows)))]
    { let _ = buf; Err(crate::err!(Unexpected)) }
}

// ── which ─────────────────────────────────────────────────────────────────
/// Port of `bun.which` (`src/which/which.zig`). Searches `cwd` then each
/// `PATH` entry for an executable named `bin`; returns the NUL-terminated
/// match written into `buf`. POSIX semantics; Windows `PATHEXT` handling
/// stays in `bun_which` (tier-2).
pub fn which<'a>(
    buf: &'a mut PathBuffer,
    path: &[u8],
    cwd: &[u8],
    bin: &[u8],
) -> Option<&'a ZStr> {
    if bin.is_empty() { return None; }
    // If `bin` contains a separator, resolve relative to cwd only.
    let has_sep = bin.iter().any(|&b| b == b'/' || (cfg!(windows) && b == b'\\'));
    #[inline]
    fn is_absolute(p: &[u8]) -> bool {
        if p.first() == Some(&b'/') { return true; }
        if cfg!(windows) {
            if p.first() == Some(&b'\\') { return true; }
            if p.len() >= 2 && p[1] == b':' && p[0].is_ascii_alphabetic() { return true; }
        }
        false
    }
    #[inline]
    fn is_sep(b: u8) -> bool { b == b'/' || (cfg!(windows) && b == b'\\') }
    let check = |buf: &mut PathBuffer, dir: &[u8], bin: &[u8]| -> Option<usize> {
        let mut n = 0usize;
        if !dir.is_empty() {
            if dir.len() + 1 + bin.len() + 1 > buf.0.len() { return None; }
            buf.0[..dir.len()].copy_from_slice(dir);
            n = dir.len();
            if !is_sep(buf.0[n - 1]) { buf.0[n] = SEP; n += 1; }
        }
        if n + bin.len() + 1 > buf.0.len() { return None; }
        buf.0[n..n + bin.len()].copy_from_slice(bin);
        n += bin.len();
        buf.0[n] = 0;
        #[cfg(unix)]
        unsafe {
            if libc::access(buf.0.as_ptr().cast(), libc::X_OK) == 0 { return Some(n); }
        }
        #[cfg(not(unix))]
        {
            // TODO(port): Windows X_OK via GetFileAttributesW; defer to bun_which.
        }
        None
    };
    // Absolute `bin` → probe it directly without joining `cwd` (which.zig:35-42).
    if is_absolute(bin) {
        return check(buf, b"", bin).map(|n| unsafe { ZStr::from_raw(buf.0.as_ptr(), n) });
    }
    if has_sep {
        // Relative with separator → resolve against cwd only. Zig trims
        // trailing sep from cwd and strips a leading "./" (or ".\") from bin.
        let cwd = {
            let mut c = cwd;
            while let [rest @ .., last] = c {
                if is_sep(*last) { c = rest; } else { break; }
            }
            c
        };
        let bin = match bin {
            [b'.', s, rest @ ..] if is_sep(*s) => rest,
            _ => bin,
        };
        // SAFETY: n < buf.len, buf[n]==0.
        return check(buf, cwd, bin).map(|n| unsafe { ZStr::from_raw(buf.0.as_ptr(), n) });
    }
    // Bare names go straight to PATH (which.zig:44-63) — do NOT consult cwd.
    let delim: u8 = if cfg!(windows) { b';' } else { b':' };
    for dir in path.split(|&b| b == delim) {
        if dir.is_empty() { continue; }
        if let Some(n) = check(buf, dir, bin) {
            return Some(unsafe { ZStr::from_raw(buf.0.as_ptr(), n) });
        }
    }
    None
}

// ── auto_reload_on_crash / reload_process group ───────────────────────────
// Port of `bun.zig:1527-1686`. Full body of `reloadProcess` depends on
// `bun.spawn` (tier-4); the crash-handler only needs the flag + the
// thread-coordination helpers + a best-effort POSIX `execve` path.
use core::sync::atomic::{AtomicBool, Ordering as AOrdering};
static AUTO_RELOAD_ON_CRASH: AtomicBool = AtomicBool::new(false);
static RELOAD_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
thread_local! {
    static RELOAD_IN_PROGRESS_ON_CURRENT_THREAD: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

#[inline] pub fn auto_reload_on_crash() -> bool { AUTO_RELOAD_ON_CRASH.load(AOrdering::Relaxed) }
#[inline] pub fn set_auto_reload_on_crash(v: bool) { AUTO_RELOAD_ON_CRASH.store(v, AOrdering::Relaxed) }

#[inline]
pub fn is_process_reload_in_progress_on_another_thread() -> bool {
    RELOAD_IN_PROGRESS.load(AOrdering::Relaxed)
        && !RELOAD_IN_PROGRESS_ON_CURRENT_THREAD.with(|c| c.get())
}

/// Zig: `bun.exitThread()` — terminate the current OS thread without unwinding.
/// POSIX `pthread_exit`; Windows `ExitThread`. Called from worker `shutdown()`.
pub fn exit_thread() -> ! {
    #[cfg(unix)]
    // SAFETY: `pthread_exit` is always safe to call on the current thread; it
    // never returns.
    unsafe {
        libc::pthread_exit(core::ptr::null_mut());
    }
    #[cfg(windows)]
    // SAFETY: `ExitThread` is the documented Windows API for terminating the
    // calling thread; it never returns.
    unsafe {
        crate::windows_sys::kernel32::ExitThread(0);
    }
    #[allow(unreachable_code)]
    loop {
        core::hint::spin_loop();
    }
}

/// Zig: `bun.deleteAllPoolsForThreadExit()` — release thread-local pooled
/// buffers (PathBuffer pool, ObjectPool, …) before the thread terminates so
/// the backing storage is returned to mimalloc rather than leaked with the
/// TLS block.
///
/// LAYERING: the actual pool registries live in higher-tier crates
/// (`bun_paths`, `bun_collections`). They register a destructor here at init
/// via [`register_thread_exit_pool_destructor`]; this fn just walks the list.
static THREAD_EXIT_POOL_DESTRUCTORS: parking_lot::Mutex<Vec<fn()>> =
    parking_lot::Mutex::new(Vec::new());

pub fn register_thread_exit_pool_destructor(f: fn()) {
    THREAD_EXIT_POOL_DESTRUCTORS.lock().push(f);
}

pub fn delete_all_pools_for_thread_exit() {
    // Snapshot under the lock so a destructor can't deadlock by
    // re-registering.
    let snapshot: Vec<fn()> = THREAD_EXIT_POOL_DESTRUCTORS.lock().clone();
    for f in snapshot {
        f();
    }
}

/// Port of `bun.maybeHandlePanicDuringProcessReload`.
#[inline(never)]
pub fn maybe_handle_panic_during_process_reload() {
    if is_process_reload_in_progress_on_another_thread() {
        crate::output::flush();
        #[cfg(debug_assertions)]
        crate::output::debug_warn("panic() called during process reload, ignoring\n");
        // Zig: `bun.exitThread()`. POSIX `pthread_exit`; Windows `ExitThread`.
        #[cfg(unix)]
        unsafe { libc::pthread_exit(core::ptr::null_mut()); }
        #[cfg(windows)]
        unsafe { crate::windows_sys::kernel32::ExitThread(0); }
    }
    // Spin if pthread_exit was a no-op (pathological).
    while is_process_reload_in_progress_on_another_thread() {
        core::hint::spin_loop();
        #[cfg(unix)]
        unsafe { libc::nanosleep(&libc::timespec { tv_sec: 1, tv_nsec: 0 }, core::ptr::null_mut()); }
    }
}

/// Port of `bun.reloadProcess`. Allocator param dropped (uses libc malloc via
/// `dupe_z`). `may_return == true` → returns on failure; `false` → panics.
/// macOS posix_spawn path is deferred to bun_spawn (tier-4); tier-0 falls
/// back to plain `execve` on all POSIX which is correct on Linux/BSD and
/// best-effort on macOS (CLOEXEC handled by `on_before_reload_process_linux`
/// hook on Linux; Darwin gets the simpler path until tier-4 wires spawn).
pub fn reload_process(clear_terminal: bool, may_return: bool) {
    RELOAD_IN_PROGRESS.store(true, AOrdering::Relaxed);
    RELOAD_IN_PROGRESS_ON_CURRENT_THREAD.with(|c| c.set(true));

    if clear_terminal {
        crate::output::flush();
        crate::output::disable_buffering();
        crate::output::reset_terminal_all();
    }
    crate::output::stdio::restore();

    #[cfg(windows)]
    {
        // Signal the watcher-manager parent via magic exit code.
        unsafe extern "system" {
            fn TerminateProcess(h: *mut core::ffi::c_void, code: u32) -> i32;
            // No preconditions; pseudo-handle / thread-local error slot.
            safe fn GetCurrentProcess() -> *mut core::ffi::c_void;
            safe fn GetLastError() -> u32;
        }
        // = 3224497970, bun.windows.watcher_reload_exit (windows.zig). Parent
        // watcher-manager compares the child's exit code against exactly this.
        const WATCHER_RELOAD_EXIT: u32 = 0xC031_EF32;
        let rc = unsafe { TerminateProcess(GetCurrentProcess(), WATCHER_RELOAD_EXIT) };
        if rc == 0 {
            let err = GetLastError();
            if may_return {
                crate::output::err_generic("Failed to reload process: {}", (err,));
                return;
            }
            panic!("Error while reloading process: {}", err);
        } else {
            if may_return {
                crate::output::err_generic("Failed to reload process", ());
                return;
            }
            panic!("Unexpected error while reloading process\n");
        }
    }

    #[cfg(unix)]
    unsafe {
        #[cfg(any(target_os = "linux", target_os = "freebsd"))]
        { unsafe extern "C" { fn on_before_reload_process_linux(); } on_before_reload_process_linux(); }

        // We clone argv so that the memory address isn't the same as the libc one
        // (mirrors Zig `allocator.dupeZ` per entry).
        let args = argv_storage();
        let dupe_argv: Vec<ZBox> =
            args.iter().map(|z| ZBox::from_vec_with_nul(z.as_bytes().to_vec())).collect();
        let mut newargv: Vec<*const core::ffi::c_char> =
            dupe_argv.iter().map(|z| z.as_ptr()).collect();
        newargv.push(core::ptr::null());

        // We clone envp so that the memory address of environment variables isn't
        // the same as the libc one (mirrors Zig `allocSentinel` + `dupeZ` loop).
        let mut dupe_env: Vec<ZBox> = Vec::new();
        let mut p = c_environ();
        while !p.is_null() && !(*p).is_null() {
            let s = crate::ffi::cstr(*p);
            dupe_env.push(ZBox::from_vec_with_nul(s.to_bytes().to_vec()));
            p = p.add(1);
        }
        let mut envp: Vec<*const core::ffi::c_char> =
            dupe_env.iter().map(|z| z.as_ptr()).collect();
        envp.push(core::ptr::null());

        // we must clone selfExePath in case argv[0] was not an absolute path
        let exec_path = self_exe_path().expect("unreachable").as_ptr();

        libc::execve(exec_path, newargv.as_ptr().cast(), envp.as_ptr().cast());
        // execve only returns on error.
        let errno = std::io::Error::last_os_error().raw_os_error().unwrap_or(-1);
        if may_return {
            crate::output::pretty_errorln(&format_args!("error: Failed to reload process: errno {}", errno));
            return;
        }
        panic!("Unexpected error while reloading: errno {}", errno);
    }

    #[cfg(not(any(unix, windows)))]
    {
        // Zig: `else @compileError("unsupported platform for reloadProcess")`.
        // Faithful port — Bun only targets POSIX + Windows; any other target
        // is a build-time error, not a runtime panic.
        let _ = (clear_terminal, may_return);
        compile_error!("unsupported platform for reload_process");
    }
}

// ── spawn_sync_inherit ────────────────────────────────────────────────────
/// Minimal "spawn argv, inherit stdio, wait" used by crash_handler's
/// symbolizer. Port of the subset of `bun.spawnSync` needed at tier-0.
/// Full `bun.spawnSync` (with buffered stdio, env, cwd) is in bun_spawn.
#[derive(Debug, Clone, Copy)]
pub struct SpawnStatus { pub code: i32 }
impl SpawnStatus { #[inline] pub fn is_ok(&self) -> bool { self.code == 0 } }

// ── posix_spawn_bun FFI (tier-0 minimal mirror) ───────────────────────────
// RULE: libc `posix_spawn`/`posix_spawnp` must NEVER be called directly on
// Linux/FreeBSD. Bun ships its own vfork-based spawner in
// `src/jsc/bindings/bun-spawn.cpp` (`posix_spawn_bun`) which is async-signal-
// safe, supports CLOEXEC sweeps, pdeathsig, PTY setup, and writes the exec
// errno back through a pipe. glibc's posix_spawn forks (not vfork) on some
// configurations and musl's has had signal-mask bugs; ours is the audited
// path. macOS keeps libc `posix_spawnp` for the non-PTY case because Apple's
// implementation is a true kernel fast-path (no fork at all).
//
// `bun_core` is tier-0 and cannot depend on `bun_spawn`/`spawn_sys`, so the
// request struct is re-declared here with the exact C layout. KEEP IN SYNC
// with `bun-spawn.cpp::bun_spawn_request_t` and
// `spawn_sys::posix_spawn::BunSpawnRequest`.
#[cfg(any(target_os = "linux", target_os = "freebsd"))]
mod bun_spawn_ffi {
    use core::ffi::{c_char, c_int};

    // Matches `bun_spawn_request_file_action_t`. Unused here (we pass an empty
    // action list — stdio inherits by default) but the pointer type must agree.
    #[repr(C)]
    pub(super) struct Action {
        pub kind: u8,
        pub path: *const c_char,
        pub fds: [c_int; 2],
        pub flags: c_int,
        pub mode: c_int,
    }

    // Matches `bun_spawn_file_action_list_t`.
    #[repr(C)]
    pub(super) struct ActionsList {
        pub ptr: *const Action,
        pub len: usize,
    }

    // Matches `bun_spawn_request_t`.
    #[repr(C)]
    pub(super) struct Request {
        pub chdir: *const c_char,
        pub detached: bool,
        pub new_process_group: bool,
        pub actions: ActionsList,
        pub pty_slave_fd: c_int,
        pub linux_pdeathsig: c_int,
    }

    unsafe extern "C" {
        pub(super) fn posix_spawn_bun(
            pid: *mut c_int,
            path: *const c_char,
            request: *const Request,
            argv: *const *const c_char,
            envp: *const *const c_char,
        ) -> isize;
    }
}

pub fn spawn_sync_inherit(argv: &[impl AsRef<[u8]>]) -> Result<SpawnStatus, crate::Error> {
    #[cfg(unix)]
    unsafe {
        let cargs: Vec<ZBox> = argv.iter().map(|a| ZBox::from_vec_with_nul(a.as_ref().to_vec())).collect();
        let mut ptrs: Vec<*const core::ffi::c_char> = cargs.iter().map(|z| z.as_ptr()).collect();
        ptrs.push(core::ptr::null());

        let environ = c_environ();

        // Linux/FreeBSD: route through Bun's vfork-based posix_spawn_bun.
        // It uses execve (no PATH search), so resolve argv[0] via $PATH first
        // to preserve the `posix_spawnp`-like contract callers expect (e.g.
        // crash_handler spawning `llvm-symbolizer` by bare name).
        #[cfg(any(target_os = "linux", target_os = "freebsd"))]
        let pid: libc::pid_t = {
            let arg0 = argv[0].as_ref();
            let mut pathbuf = PathBuffer::uninit();
            let exe: *const core::ffi::c_char = if arg0.contains(&b'/') {
                // Contains a separator → use as-is (execve resolves relative
                // to cwd, matching posix_spawnp semantics for non-bare names).
                ptrs[0]
            } else {
                let path_env = getenv_z(ZStr::from_static(b"PATH\0")).unwrap_or(b"");
                match which(&mut pathbuf, path_env, b".", arg0) {
                    Some(z) => z.as_ptr(),
                    None => return Err(crate::Error::from_errno(libc::ENOENT)),
                }
            };

            let req = bun_spawn_ffi::Request {
                chdir: core::ptr::null(),
                detached: false,
                new_process_group: false,
                actions: bun_spawn_ffi::ActionsList { ptr: core::ptr::null(), len: 0 },
                pty_slave_fd: -1,
                linux_pdeathsig: 0,
            };
            let mut pid: core::ffi::c_int = 0;
            // SAFETY: exe/ptrs/environ are NUL-terminated; req layout matches C.
            let rc = bun_spawn_ffi::posix_spawn_bun(
                &raw mut pid,
                exe,
                &raw const req,
                ptrs.as_ptr(),
                environ,
            );
            if rc != 0 { return Err(crate::Error::from_errno(rc as i32)); }
            pid as libc::pid_t
        };
        // macOS: Apple's posix_spawnp is a kernel fast-path (no fork); keep it
        // for the non-PTY inherit case. PTY spawns go through spawn_sys.
        #[cfg(target_os = "macos")]
        let pid: libc::pid_t = {
            let mut pid: libc::pid_t = 0;
            let rc = libc::posix_spawnp(
                &raw mut pid,
                ptrs[0],
                core::ptr::null(),
                core::ptr::null(),
                ptrs.as_ptr().cast::<*mut core::ffi::c_char>(),
                environ.cast::<*mut core::ffi::c_char>(),
            );
            if rc != 0 { return Err(crate::Error::from_errno(rc)); }
            pid
        };
        // Android: bionic only added posix_spawnp at API 28 and the `libc`
        // crate doesn't bind it for `target_os = "android"`; bun-spawn.cpp is
        // gated to LINUX/DARWIN/FREEBSD. Fall back to fork+execvp.
        #[cfg(target_os = "android")]
        let pid: libc::pid_t = {
            let _ = environ;
            let pid = libc::fork();
            if pid < 0 {
                let e = std::io::Error::last_os_error().raw_os_error().unwrap_or(-1);
                return Err(crate::Error::from_errno(e));
            }
            if pid == 0 {
                // Child. execvp inherits stdio + environ, which is exactly the
                // "inherit" contract this helper promises. On failure, _exit
                // (no destructors / atexit hooks in a forked child).
                libc::execvp(ptrs[0], ptrs.as_ptr());
                libc::_exit(127);
            }
            pid
        };
        // Other unix (e.g. NetBSD/OpenBSD if ever targeted): not a Bun
        // platform. Fail loudly rather than silently fork.
        #[cfg(not(any(
            target_os = "linux",
            target_os = "freebsd",
            target_os = "macos",
            target_os = "android",
        )))]
        let pid: libc::pid_t = {
            let _ = (&ptrs, environ);
            return Err(crate::err!(Unexpected));
        };

        let mut status: i32 = 0;
        loop {
            let r = libc::waitpid(pid, &raw mut status, 0);
            if r == -1 {
                let e = std::io::Error::last_os_error().raw_os_error().unwrap_or(-1);
                if e == libc::EINTR { continue; }
                return Err(crate::Error::from_errno(e));
            }
            break;
        }
        let code = if libc::WIFEXITED(status) { libc::WEXITSTATUS(status) } else { -1 };
        Ok(SpawnStatus { code })
    }
    #[cfg(not(unix))]
    {
        // TODO(port): Windows path via CreateProcessW in bun_spawn.
        let _ = argv;
        Err(crate::err!(Unexpected))
    }
}

// ── Timespec ──────────────────────────────────────────────────────────────
// Port of `bun.timespec` (bun.zig:3257). `extern struct { sec: i64, nsec: i64 }`.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Timespec { pub sec: i64, pub nsec: i64 }
// SAFETY: two `i64` fields; all-zero is the epoch.
unsafe impl crate::ffi::Zeroable for Timespec {}

/// Lowercase alias (Zig spells it `bun.timespec`).
#[allow(non_camel_case_types)]
pub type timespec = Timespec;

impl Timespec {
    pub const EPOCH: Timespec = Timespec { sec: 0, nsec: 0 };
    const NS_PER_S: i64 = 1_000_000_000;
    const NS_PER_MS: i64 = 1_000_000;

    #[inline]
    pub const fn new(sec: i64, nsec: i64) -> Self { Self { sec, nsec } }

    #[inline] pub fn eql(&self, other: &Timespec) -> bool { self == other }

    /// `self - other` (Zig: `duration`). Mimics C wrapping behaviour.
    pub fn duration(&self, other: &Timespec) -> Timespec {
        let mut sec = self.sec.wrapping_sub(other.sec);
        let mut nsec = self.nsec.wrapping_sub(other.nsec);
        if nsec < 0 { sec = sec.wrapping_sub(1); nsec = nsec.wrapping_add(Self::NS_PER_S); }
        Timespec { sec, nsec }
    }

    pub fn order(&self, other: &Timespec) -> core::cmp::Ordering {
        match self.sec.cmp(&other.sec) {
            core::cmp::Ordering::Equal => self.nsec.cmp(&other.nsec),
            o => o,
        }
    }

    /// Nanoseconds (saturating at `u64::MAX`).
    pub fn ns(&self) -> u64 {
        if self.sec <= 0 { return self.nsec.max(0) as u64; }
        let s_ns = (self.sec as u64).checked_mul(Self::NS_PER_S as u64).unwrap_or(u64::MAX);
        s_ns.checked_add(self.nsec.max(0) as u64).unwrap_or(u64::MAX)
    }

    /// Signed nanoseconds (wrapping). Port of `bun.timespec.nsSigned`.
    #[inline] pub fn ns_signed(&self) -> i64 {
        let ns_per_sec = self.sec.wrapping_mul(Self::NS_PER_S);
        let ns_from_nsec = self.nsec.div_euclid(Self::NS_PER_MS);
        ns_per_sec.wrapping_add(ns_from_nsec)
    }

    /// Milliseconds (signed, wrapping).
    #[inline] pub fn ms(&self) -> i64 {
        self.sec.wrapping_mul(1000).wrapping_add(self.nsec.div_euclid(Self::NS_PER_MS))
    }
    #[inline] pub fn ms_unsigned(&self) -> u64 { self.ns() / Self::NS_PER_MS as u64 }

    #[inline] pub fn greater(&self, other: &Timespec) -> bool { self.order(other).is_gt() }

    pub fn add_ms(&self, interval: i64) -> Timespec {
        let sec_inc = interval / 1000;
        let nsec_inc = (interval % 1000) * Self::NS_PER_MS;
        let mut t = *self;
        t.sec = t.sec.wrapping_add(sec_inc);
        t.nsec = t.nsec.wrapping_add(nsec_inc);
        if t.nsec >= Self::NS_PER_S { t.sec = t.sec.wrapping_add(1); t.nsec -= Self::NS_PER_S; }
        t
    }

    /// Advance by a fractional millisecond count, preserving sub-ms precision
    /// as nanoseconds (matches sinon/fake-timers `tick(msFloat)` semantics).
    pub fn add_ms_float(&self, interval_ms: f64) -> Timespec {
        const MS_PER_S: i64 = 1000;
        let ns_per_ms_f = Self::NS_PER_MS as f64;
        let mut t = *self;
        let ms_inc = interval_ms.floor() as i64;
        // nanoRemainder: floor((msFloat * 1e6) % 1e6)
        let nsec_inc = (interval_ms * ns_per_ms_f).rem_euclid(ns_per_ms_f).floor() as i64;
        let sec_inc = ms_inc / MS_PER_S;
        let ms_remainder = ms_inc.rem_euclid(MS_PER_S);
        t.sec = t.sec.wrapping_add(sec_inc);
        t.nsec = t.nsec.wrapping_add(ms_remainder * Self::NS_PER_MS + nsec_inc);
        if t.nsec >= Self::NS_PER_S {
            t.sec = t.sec.wrapping_add(1);
            t.nsec -= Self::NS_PER_S;
        } else if t.nsec < 0 {
            t.sec = t.sec.wrapping_sub(1);
            t.nsec += Self::NS_PER_S;
        }
        t
    }

    #[inline] pub fn min(a: Timespec, b: Timespec) -> Timespec { if a.order(&b).is_lt() { a } else { b } }
    #[inline] pub fn max(a: Timespec, b: Timespec) -> Timespec { if a.order(&b).is_gt() { a } else { b } }

    /// `bun.timespec.now(.allow_mocked_time)` — monotonic-ish "rough tick".
    /// Real impl routes through `getRoughTickCount` (jsc); tier-0 reads the
    /// monotonic clock directly. Test-runner fake-timers write the mocked
    /// nanosecond value via `mock_time::set` / `mock_time::clear`.
    #[inline]
    pub fn now(mode: TimespecMockMode) -> Timespec {
        if matches!(mode, TimespecMockMode::AllowMockedTime) {
            if let Some(ns) = mock_time::get() { return Timespec::from_ns(ns); }
        }
        Self::now_real()
    }
    /// Convenience for `now(AllowMockedTime)` (downstream short-name).
    #[inline] pub fn now_allow_mocked_time() -> Timespec { Self::now(TimespecMockMode::AllowMockedTime) }

    fn now_real() -> Timespec {
        #[cfg(unix)]
        unsafe {
            let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
            libc::clock_gettime(libc::CLOCK_MONOTONIC, &raw mut ts);
            Timespec { sec: ts.tv_sec as i64, nsec: ts.tv_nsec as i64 }
        }
        #[cfg(not(unix))]
        {
            let n = crate::time::nano_timestamp();
            Timespec { sec: (n / 1_000_000_000) as i64, nsec: (n % 1_000_000_000) as i64 }
        }
    }

    #[inline] pub fn since_now(&self, mode: TimespecMockMode) -> u64 { Self::now(mode).duration(self).ns() }
    #[inline] pub fn ms_from_now(mode: TimespecMockMode, interval: i64) -> Timespec { Self::now(mode).add_ms(interval) }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TimespecMockMode { AllowMockedTime, ForceRealTime }

/// `bun_core::timespec::Mode` namespace shim — Zig nested it under the struct;
/// Rust can't do inherent associated types stably, so expose a module with the
/// same path. Callers write `bun_core::timespec_mode::AllowMockedTime` or use
/// the `Timespec::now_allow_mocked_time()` helper.
pub mod timespec_mode {
    pub use super::TimespecMockMode::*;
    pub type Mode = super::TimespecMockMode;
}

/// Mocked-time storage. The data lives at T0 so `Timespec::now` reads it
/// directly; the test-runner (`useFakeTimers`) writes via `set`/`clear`
/// from `bun_runtime::test_runner::timers::FakeTimers::CurrentTime`.
/// Sentinel `i64::MIN` ⇒ not mocked.
pub mod mock_time {
    use core::sync::atomic::{AtomicI64, Ordering};

    static MOCKED_TIME_NS: AtomicI64 = AtomicI64::new(i64::MIN);

    /// Set the mocked monotonic time (nanoseconds). Called by fake-timers.
    #[inline] pub fn set(ns: i64) { MOCKED_TIME_NS.store(ns, Ordering::Relaxed); }
    /// Clear the mocked time so `Timespec::now(AllowMockedTime)` reads the
    /// real clock again.
    #[inline] pub fn clear() { MOCKED_TIME_NS.store(i64::MIN, Ordering::Relaxed); }
    /// Current mocked time, or `None` if not mocked.
    #[inline] pub fn get() -> Option<i64> {
        let v = MOCKED_TIME_NS.load(Ordering::Relaxed);
        if v == i64::MIN { None } else { Some(v) }
    }
}

impl Timespec {
    /// Construct from a signed nanosecond count. Euclidean division keeps
    /// `nsec ∈ [0, 1e9)` for negative inputs so `ns()`/`order()` round-trip.
    #[inline]
    pub const fn from_ns(ns: i64) -> Timespec {
        Timespec { sec: ns.div_euclid(Self::NS_PER_S), nsec: ns.rem_euclid(Self::NS_PER_S) }
    }
}

// ── f16 ───────────────────────────────────────────────────────────────────
// Zig's native `f16` (IEEE-754 binary16). Rust's `f16` is still nightly-only,
// so model it as a transparent `u16` bit-container with `f64` widening for the
// one hot caller (ConsoleObject Float16Array printing). PERF(port): scalar
// soft-float decode; revisit once `core::f16` stabilizes.
#[allow(non_camel_case_types)]
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Default, Debug)]
pub struct f16(pub u16);

impl f16 {
    #[inline] pub const fn from_bits(bits: u16) -> Self { Self(bits) }
    #[inline] pub const fn to_bits(self) -> u16 { self.0 }

    /// Widen to `f64` (exact). Port of Zig `@floatCast(f64, h)`.
    pub fn to_f64(self) -> f64 {
        let h = self.0 as u32;
        let sign = (h >> 15) & 1;
        let exp = (h >> 10) & 0x1F;
        let frac = h & 0x3FF;
        let signf = if sign != 0 { -1.0 } else { 1.0 };
        if exp == 0 {
            if frac == 0 { return signf * 0.0; }
            // subnormal: 2^-14 * (frac / 1024)
            return signf * (frac as f64) * 2.0_f64.powi(-24);
        }
        if exp == 0x1F {
            return if frac == 0 { signf * f64::INFINITY } else { f64::NAN };
        }
        signf * (1.0 + (frac as f64) / 1024.0) * 2.0_f64.powi(exp as i32 - 15)
    }
}
impl From<f16> for f64 { #[inline] fn from(h: f16) -> f64 { h.to_f64() } }
impl From<f16> for f32 { #[inline] fn from(h: f16) -> f32 { h.to_f64() as f32 } }
impl core::fmt::Display for f16 {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.to_f64().fmt(f)
    }
}

// ── perf ──────────────────────────────────────────────────────────────────
// Port of `bun.perf` (src/perf/perf.zig). The Linux ftrace backend is
// libc-only, so it folds in directly and `bun_core::perf::trace("X")` is real
// instrumentation on Linux. macOS: the Zig backend wraps `Bun__signpost_emit`
// (c-bindings.cpp) which keys on the codegen `PerfEvent` int — that table
// lives in `bun_perf` (T2, owns generated_perf_trace_events), so T0 reports
// disabled on macOS. **No functional divergence today**: `bun_perf`'s Darwin
// arm currently routes through the `bun_sys::darwin::os_log::signpost::Interval`
// stub whose `end()` is a no-op, so neither tier emits signposts yet. When
// `Bun__signpost_emit` is wired, callers above T0 use `bun_perf::trace`; T0
// callsites (audited r5) are bundler/parser hot paths where Linux ftrace is
// the profiling target. Windows/other platforms are no-ops in Zig too.
pub mod perf {
    use core::sync::atomic::{AtomicU8, Ordering};
    #[cfg(target_os = "linux")]
    use core::sync::atomic::AtomicBool;
    #[cfg(target_os = "linux")]
    use std::sync::Once;

    /// Per-span state returned by `trace()`. `end()` is idempotent; `Drop`
    /// calls it so `let _t = trace("x");` works as a scope guard.
    #[must_use = "bind to a local (`let _t = perf::trace(..)`) so the span has nonzero duration"]
    pub struct Ctx {
        #[cfg(target_os = "linux")]
        linux: Option<Linux>,
    }
    impl Ctx {
        pub const DISABLED: Ctx = Ctx {
            #[cfg(target_os = "linux")]
            linux: None,
        };
        #[inline]
        pub fn end(&mut self) {
            #[cfg(target_os = "linux")]
            if let Some(l) = self.linux.take() { l.end(); }
        }
    }
    impl Drop for Ctx { #[inline] fn drop(&mut self) { self.end(); } }

    // Tri-state so the disabled fast path is a single Relaxed load (this sits
    // on every `trace()` call across the bundler/parser hot paths). The flag
    // is write-once-at-init so Relaxed is sufficient; a benign init race just
    // re-runs the env probe.
    const UNSET: u8 = 0;
    const DISABLED: u8 = 1;
    const ENABLED: u8 = 2;
    static IS_ENABLED: AtomicU8 = AtomicU8::new(UNSET);

    #[cold]
    fn is_enabled_init() -> bool {
        #[cfg(target_os = "linux")]
        let on = crate::env_var::feature_flag::BUN_TRACE.get().unwrap_or(false) && Linux::is_supported();
        // macOS: os_signpost requires `bun_sys::darwin::OSLog` (above T0).
        // **`bun_perf` is the canonical entry point** (it drives both the
        // ftrace and signpost backends via `PerfEvent`); `bun_core::perf` is
        // the T0 subset for low-tier callers that cannot reach `bun_perf` and
        // only need Linux ftrace. T0 therefore reports disabled on macOS.
        #[cfg(not(target_os = "linux"))]
        let on = false;
        IS_ENABLED.store(if on { ENABLED } else { DISABLED }, Ordering::Relaxed);
        on
    }

    #[inline]
    pub fn is_enabled() -> bool {
        match IS_ENABLED.load(Ordering::Relaxed) {
            DISABLED => false,
            ENABLED => true,
            _ => is_enabled_init(),
        }
    }

    /// `bun.perf.trace("Event.name")`. Emits an ftrace span on Linux when
    /// `BUN_TRACE=1`; no-op elsewhere (macOS signposts live in `bun_perf`).
    #[inline]
    pub fn trace(name: &'static str) -> Ctx {
        if !is_enabled() {
            let _ = name;
            return Ctx::DISABLED;
        }
        #[cfg(target_os = "linux")]
        { return Ctx { linux: Some(Linux::init(name)) }; }
        #[allow(unreachable_code)]
        { let _ = name; Ctx::DISABLED }
    }

    // ── Linux ftrace backend (folded from src/perf/lib.rs) ────────────────
    #[cfg(target_os = "linux")]
    struct Linux { start_time: u64, name: &'static str }

    #[cfg(target_os = "linux")]
    impl Linux {
        fn is_supported() -> bool {
            static INIT_ONCE: Once = Once::new();
            static IS_INITIALIZED: AtomicBool = AtomicBool::new(false);
            INIT_ONCE.call_once(|| {
                // SAFETY: FFI; Bun__linux_trace_init has no preconditions.
                let r = unsafe { Bun__linux_trace_init() };
                IS_INITIALIZED.store(r != 0, Ordering::Relaxed);
            });
            IS_INITIALIZED.load(Ordering::Relaxed)
        }
        #[inline]
        fn init(name: &'static str) -> Self {
            Self {
                start_time: crate::Timespec::now(crate::TimespecMockMode::ForceRealTime).ns(),
                name,
            }
        }
        fn end(self) {
            if !Self::is_supported() { return; }
            let duration = crate::Timespec::now(crate::TimespecMockMode::ForceRealTime)
                .ns()
                .saturating_sub(self.start_time);
            // Zig passed `@tagName(event).ptr` (NUL-terminated). Build a small
            // stack CString from the &'static str literal.
            let mut buf = [0u8; 96];
            let n = self.name.len().min(buf.len() - 1);
            buf[..n].copy_from_slice(&self.name.as_bytes()[..n]);
            // SAFETY: FFI; pointer is NUL-terminated within `buf`.
            let _ = unsafe {
                Bun__linux_trace_emit(
                    buf.as_ptr() as *const core::ffi::c_char,
                    i64::try_from(duration).unwrap_or(i64::MAX),
                )
            };
        }
    }

    #[cfg(target_os = "linux")]
    unsafe extern "C" {
        fn Bun__linux_trace_init() -> core::ffi::c_int;
        fn Bun__linux_trace_emit(
            event_name: *const core::ffi::c_char,
            duration_ns: i64,
        ) -> core::ffi::c_int;
    }
}

// ── form_data ─────────────────────────────────────────────────────────────
// Port of `bun.FormData.{Encoding, AsyncFormData, getBoundary}` (src/runtime/
// webcore/FormData.zig:16-95). The JSC-touching parts (`toJS`, the field map,
// multipart parser) stay in `bun_runtime::webcore::form_data`; T0 owns only
// the encoding-detection types so `Request`/`Response`/`Body` can name them
// without a runtime→core cycle. Per PORTING.md §JSC: `to_js` is an extension
// method that lives in the higher-tier crate.
pub mod form_data {
    /// `FormData.Encoding` — `union(enum) { URLEncoded, Multipart: []const u8 }`.
    /// `Multipart` owns its boundary (Zig `AsyncFormData.init` duped it; here
    /// the Box moves in directly).
    #[derive(Debug)]
    pub enum Encoding {
        URLEncoded,
        /// boundary
        Multipart(Box<[u8]>),
    }

    impl Encoding {
        pub fn get(content_type: &[u8]) -> Option<Encoding> {
            if crate::strings::includes(content_type, b"application/x-www-form-urlencoded") {
                return Some(Encoding::URLEncoded);
            }
            if !crate::strings::includes(content_type, b"multipart/form-data") {
                return None;
            }
            let boundary = get_boundary(content_type)?;
            Some(Encoding::Multipart(Box::from(boundary)))
        }
    }

    /// `FormData.getBoundary` — borrow the `boundary=` value out of a
    /// `Content-Type` header. Returns `None` on malformed quoting.
    pub fn get_boundary(content_type: &[u8]) -> Option<&[u8]> {
        let idx = ::bstr::ByteSlice::find(content_type, b"boundary=")?;
        let begin = &content_type[idx + b"boundary=".len()..];
        if begin.is_empty() {
            return None;
        }
        let end = crate::strings::index_of_char(begin, b';').unwrap_or(begin.len());
        if begin[0] == b'"' {
            if end > 1 && begin[end - 1] == b'"' {
                return Some(&begin[1..end - 1]);
            }
            // Opening quote with no matching closing quote — malformed.
            return None;
        }
        Some(&begin[..end])
    }

    /// `FormData.AsyncFormData` — heap-allocated, owns its `Encoding`.
    /// PORT NOTE: Zig stored `std.mem.Allocator param`; deleted (non-AST
    /// crate, global mimalloc per §Allocators). `deinit` becomes `Drop` on the
    /// `Box`/`Box<[u8]>` fields — no explicit impl needed.
    #[derive(Debug)]
    pub struct AsyncFormData {
        pub encoding: Encoding,
    }

    impl AsyncFormData {
        #[inline]
        pub fn init(encoding: Encoding) -> Box<AsyncFormData> {
            // Zig duped `encoding.Multipart` here so the struct owned its
            // boundary; with `Box<[u8]>` ownership has already transferred.
            Box::new(AsyncFormData { encoding })
        }
    }
}
/// Zig `bun.FormData` namespace — capitalized alias for callers that ported
/// `bun.FormData.AsyncFormData` verbatim.
pub use form_data as FormData;

// ported from: src/bun_core/util.zig
