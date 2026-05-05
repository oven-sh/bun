// Things that maybe should go in Zig standard library at some point
//
// PORT NOTE: This file is almost entirely comptime type reflection (`@typeInfo`,
// `@hasField`, `@hasDecl`, `std.meta.fields`, `bun.trait.*`) used to generically
// construct maps/arrays from heterogeneous inputs. Rust has no runtime/comptime
// type reflection; the idiomatic equivalents are the `From` / `FromIterator` /
// `Extend` traits, plus associated types for `Key`/`Value`/`Of`. The functions
// below preserve the Zig names and intent but delegate to traits that the
// concrete collection types (HashMap, Vec, MultiArrayList, BabyList) must impl.
// Phase B: audit call sites of `bun.from(...)` / `bun.fromEntries(...)` and
// likely replace them with direct `.collect()` / `Vec::from` at the caller.

use core::hash::Hash;

use bun_alloc::AllocError;
// TODO(b0): impls for bun_collections::{BabyList, HashMap, MultiArrayList} move to
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
//   - BabyList-ish (`@hasField "len"`): reserve, set len, memcpy
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
// the `@hasField` / `@hasDecl` probes. Impls for HashMap/BabyList/MultiArrayList
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

// TODO(b0): ArrayLike impls for BabyList<T> and MultiArrayList<T> arrive via
// move-in pass in bun_collections.

// ════════════════════════════════════════════════════════════════════════════
// MOVE-IN: low-tier primitives hoisted into bun_core (CYCLEBREAK §→core)
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
        unsafe { &*(core::slice::from_raw_parts(ptr, len) as *const [u8] as *const ZStr) }
    }
    /// SAFETY: `ptr[len] == 0` and `ptr[..=len]` is writable for `'a`.
    #[inline]
    pub unsafe fn from_raw_mut<'a>(ptr: *mut u8, len: usize) -> &'a mut ZStr {
        unsafe { &mut *(core::slice::from_raw_parts_mut(ptr, len) as *mut [u8] as *mut ZStr) }
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
    // NOTE: there is intentionally no `Box<ZStr>` constructor. `Box<DST>`
    // deallocates using the fat-pointer metadata length, so a `Box<ZStr>` whose
    // `.len()` excludes the NUL would free one byte short. Use `ZBox` (below)
    // for owned NUL-terminated strings.
}

/// Owned, heap-allocated, NUL-terminated byte string. `.len()` / `Deref`
/// **exclude** the trailing NUL — Zig `[:0]u8` semantics. This is the owned
/// counterpart of `&ZStr`; use it where Zig returned an allocated `[:0]u8`.
pub struct ZBox(Box<[u8]>); // invariant: last byte == 0
impl ZBox {
    /// `v` must end with `0`.
    #[inline]
    pub fn from_vec_with_nul(mut v: Vec<u8>) -> ZBox {
        if v.last() != Some(&0) {
            v.push(0);
        }
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
    {
        // Windows env names are case-insensitive. Zig walks `std.os.environ`
        // (`PEB.ProcessParameters.Environment`) and returns a borrowed slice
        // into the WTF-16 block. Box::leak is forbidden (PORTING.md §Forbidden);
        // returning a borrowed UTF-8 slice requires walking the *narrow* C
        // runtime environ, which `_wgetenv`/`GetEnvironmentVariableW` don't
        // expose. Correct port lands with `windows_sys::env_block()` (UTF-16
        // walk) + a process-lifetime intern table OR returning &[u16].
        // TODO(b2-blocked): bun_windows_sys::env_block — until then, no env on
        // Windows via this path (callers use `bun.DotEnv.Loader` instead).
        let _ = key;
        None
    }
}

/// `bun.getenvZAnyCase` — case-insensitive env lookup (used on POSIX for
/// CI-detection vars where casing varies across providers).
pub fn getenv_z_any_case(key: &ZStr) -> Option<&'static [u8]> {
    #[cfg(unix)]
    unsafe {
        // SAFETY: `environ` is the C env block; entries are NUL-terminated `KEY=VALUE`.
        unsafe extern "C" {
            static environ: *const *const core::ffi::c_char;
        }
        let mut p = environ;
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
        unsafe { &*(core::slice::from_raw_parts(ptr, len) as *const [u16] as *const WStr) }
    }
    #[inline] pub const fn as_slice(&self) -> &[u16] { &self.0 }
    #[inline] pub const fn len(&self) -> usize { self.0.len() }
    #[inline] pub const fn as_ptr(&self) -> *const u16 { self.0.as_ptr() }
}
impl core::ops::Deref for WStr {
    type Target = [u16];
    #[inline] fn deref(&self) -> &[u16] { &self.0 }
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

/// Zig: `[MAX_PATH_BYTES]u8` stack buffer. fmt.rs calls `PathBuffer::uninit()`.
#[repr(C)]
pub struct PathBuffer(pub [u8; MAX_PATH_BYTES]);
impl PathBuffer {
    #[inline]
    pub fn uninit() -> core::mem::MaybeUninit<Self> {
        core::mem::MaybeUninit::uninit()
    }
    #[inline] pub fn as_mut_slice(&mut self) -> &mut [u8] { &mut self.0 }
}
#[repr(C)]
pub struct WPathBuffer(pub [u16; PATH_MAX_WIDE]);
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
    // No separator after root: Zig dirnamePosix/dirnameWindows return null for
    // root-only inputs ("/", "C:\", "//") AND for non-root single components.
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

    #[inline] pub const fn from_native(v: FdBacking) -> Fd { Fd(v) }
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
                    if self == fd::WINDOWS_CACHED_STDIN { return 0; }
                    if self == fd::WINDOWS_CACHED_STDOUT { return 1; }
                    if self == fd::WINDOWS_CACHED_STDERR { return 2; }
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

    #[cfg(windows)] #[inline] pub fn stdin()  -> Fd { unsafe { fd::WINDOWS_CACHED_STDIN } }
    #[cfg(windows)] #[inline] pub fn stdout() -> Fd { unsafe { fd::WINDOWS_CACHED_STDOUT } }
    #[cfg(windows)] #[inline] pub fn stderr() -> Fd { unsafe { fd::WINDOWS_CACHED_STDERR } }
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
#[repr(u8)] #[derive(Copy, Clone, Eq, PartialEq)]
pub enum FdKind { System = 0 }
#[cfg(windows)]
#[repr(u8)] #[derive(Copy, Clone, Eq, PartialEq)]
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

/// Debug-only hook: bun_sys installs a fn that resolves an FD to its path
/// (readlink `/proc/self/fd/N` on Linux, `F_GETPATH` on macOS). Display calls
/// it when set so T0 doesn't depend on bun_paths.
pub static FD_PATH_HOOK: core::sync::atomic::AtomicPtr<()> =
    core::sync::atomic::AtomicPtr::new(core::ptr::null_mut());
type FdPathHookFn = unsafe fn(Fd, buf: *mut u8, cap: usize) -> isize;

impl core::fmt::Display for Fd {
    fn fmt(&self, w: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let fd = *self;
        if !fd.is_valid() { return w.write_str("[invalid_fd]"); }
        #[cfg(not(windows))]
        {
            write!(w, "{}", fd.0)?;
            #[cfg(debug_assertions)]
            if fd.0 >= 3 {
                let hook = FD_PATH_HOOK.load(core::sync::atomic::Ordering::Acquire);
                if !hook.is_null() {
                    // SAFETY: hook was installed by bun_sys with FdPathHookFn signature.
                    let f: FdPathHookFn = unsafe { core::mem::transmute(hook) };
                    let mut buf = [0u8; 1024];
                    // SAFETY: buf is 1024 bytes, passed with matching cap.
                    let n = unsafe { f(fd, buf.as_mut_ptr(), buf.len()) };
                    if n > 0 {
                        write!(w, "[{}]", bstr::BStr::new(&buf[..n as usize]))?;
                    } else if n == -1 {
                        w.write_str("[BADF]")?;
                    }
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

    // SAFETY: written once in windows_stdio::init() during single-threaded startup.
    pub static mut WINDOWS_CACHED_STDIN:  Fd = Fd::INVALID;
    pub static mut WINDOWS_CACHED_STDOUT: Fd = Fd::INVALID;
    pub static mut WINDOWS_CACHED_STDERR: Fd = Fd::INVALID;
    #[cfg(debug_assertions)]
    pub static mut WINDOWS_CACHED_FD_SET: bool = false;

    #[cfg(windows)]
    unsafe extern "C" {
        // libuv: convert C-runtime fd → OS HANDLE.
        pub fn uv_get_osfhandle(fd: c_int) -> *mut c_void;
    }
    #[cfg(windows)]
    unsafe extern "system" {
        fn GetStdHandle(n: u32) -> *mut c_void;
    }
    #[cfg(windows)] pub const STD_INPUT_HANDLE:  u32 = (-10i32) as u32;
    #[cfg(windows)] pub const STD_OUTPUT_HANDLE: u32 = (-11i32) as u32;
    #[cfg(windows)] pub const STD_ERROR_HANDLE:  u32 = (-12i32) as u32;
    #[cfg(windows)]
    pub fn is_stdio_handle(id: u32, handle: *mut c_void) -> bool {
        // SAFETY: GetStdHandle is always safe to call.
        let h = unsafe { GetStdHandle(id) };
        // Zig: `getStdHandle catch return false; handle == h`. INVALID_HANDLE_VALUE
        // (failure) won't equal a valid handle, so the equality check suffices.
        !h.is_null() && handle == h
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
        // TODO(b2-windows): PEB → ProcessParameters → {hStdInput,hStdOutput,hStdError}
        // via bun_windows_sys::peb(). Until that crate is real, return cached values.
        static FALLBACK: ProcessParametersStdio = ProcessParametersStdio {
            hStdInput: core::ptr::null_mut(),
            hStdOutput: core::ptr::null_mut(),
            hStdError: core::ptr::null_mut(),
        };
        &FALLBACK
    }
    #[cfg(windows)]
    pub unsafe fn windows_current_directory_handle() -> *mut c_void {
        // TODO(b2-windows): PEB().ProcessParameters.CurrentDirectory.Handle
        core::ptr::null_mut()
    }
}

// ─── FileKind / Mode / kind_from_mode (from bun_sys) ──────────────────────
// Zig: src/sys/sys.zig — pure S_IFMT arithmetic, no syscalls (libarchive_sys req).
pub type Mode = u32; // std.posix.mode_t

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
    const IFMT:  u32 = 0o170000;
    const IFBLK: u32 = 0o060000;
    const IFCHR: u32 = 0o020000;
    const IFDIR: u32 = 0o040000;
    const IFIFO: u32 = 0o010000;
    const IFLNK: u32 = 0o120000;
    const IFREG: u32 = 0o100000;
    const IFSOCK: u32 = 0o140000;
    match mode & IFMT {
        IFBLK => FileKind::BlockDevice,
        IFCHR => FileKind::CharacterDevice,
        IFDIR => FileKind::Directory,
        IFIFO => FileKind::NamedPipe,
        IFLNK => FileKind::SymLink,
        IFREG => FileKind::File,
        IFSOCK => FileKind::UnixDomainSocket,
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
            unsafe { (self.write_all)(self as *mut _, bytes) }
        }
        #[inline]
        pub fn flush(&mut self) -> Result<(), crate::Error> {
            unsafe { (self.flush)(self as *mut _) }
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
    // TODO(port): std::thread::current().id() is not u64-convertible on stable.
    // Use the OS tid via libc; matches Zig `Thread.getCurrentId()` semantics.
    #[cfg(target_os = "linux")]
    unsafe { libc::syscall(libc::SYS_gettid) as u64 }
    #[cfg(not(target_os = "linux"))]
    { std::thread::current().id().as_u64().into() } // PERF(port): unstable; Phase B
}

// ─── StackCheck (from bun.zig) ───────────────────────────────────────────
// Thin FFI wrapper; configure_thread() is all output.rs needs.
#[derive(Clone, Copy)]
pub struct StackCheck { cached_stack_end: usize }
unsafe extern "C" {
    fn Bun__StackCheck__initialize();
    fn Bun__StackCheck__getMaxStack() -> *mut core::ffi::c_void;
}
impl StackCheck {
    #[inline] pub fn configure_thread() { unsafe { Bun__StackCheck__initialize() } }
    #[inline] pub fn init() -> Self { Self { cached_stack_end: unsafe { Bun__StackCheck__getMaxStack() } as usize } }
    #[inline] pub fn update(&mut self) { self.cached_stack_end = unsafe { Bun__StackCheck__getMaxStack() } as usize; }
    /// Is there enough stack space to safely recurse?
    /// Zig: `> 256K` on Windows, `> 128K` elsewhere (bun.zig:3762).
    #[inline]
    pub fn is_safe_to_recurse(&self) -> bool {
        // PORT NOTE: @frameAddress() → intrinsic; approximate with a stack local's addr.
        let probe = 0u8;
        let probe_addr = &probe as *const u8 as usize;
        // Zig uses `-|` (saturating sub): if probe < end (already past limit),
        // result saturates to 0 → "not safe". wrapping_sub would yield a huge
        // positive and incorrectly return true.
        let remaining = probe_addr.saturating_sub(self.cached_stack_end);
        let threshold: usize = if cfg!(windows) { 256 * 1024 } else { 128 * 1024 };
        remaining > threshold
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
// SAFETY: OnceLock<T> handles the Sync; F is only read under its lock.
unsafe impl<T: Send + Sync, F: Send + Sync> Sync for Once<T, F> {}

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
    pub const fn new(f: fn(A) -> T) -> Self { Self { cell: std::sync::OnceLock::new(), f } }
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
                let err = unsafe { *libc::__errno_location() };
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
        let path = std::env::current_exe().map_err(crate::Error::from)?;
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
// `errno_map: [N]anyerror`; the Rust `bun_core::Error` already carries the raw
// errno, so the mapping is identity (and `Error::name()` recovers the tag).
#[inline]
pub fn errno_to_zig_err(errno: i32) -> crate::Error {
    let n = if cfg!(windows) { errno.unsigned_abs() as i32 } else { errno };
    debug_assert!(n != 0);
    crate::Error::from_errno(n)
}

// ── time ──────────────────────────────────────────────────────────────────
// Ports of `std.time.{nanoTimestamp,milliTimestamp,timestamp}` plus the
// constants the install/http crates reference. Using libc clock_gettime keeps
// this consistent with the Zig stdlib (which does the same on POSIX).
pub mod time {
    pub const NS_PER_MS: i128 = 1_000_000;
    pub const NS_PER_S: i128 = 1_000_000_000;
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
            unsafe { libc::clock_gettime(libc::CLOCK_REALTIME, &mut ts) };
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

/// Per-call-site cached file load. `($root, $sub_path)` mirrors the Zig
/// signature; `$sub_path` must be a string literal.
#[macro_export]
macro_rules! runtime_embed_file {
    ($root:expr, $sub_path:literal) => {{
        static __CELL: ::std::sync::OnceLock<String> = ::std::sync::OnceLock::new();
        let _ = $root; // type-checked but unused at this tier (resolveSourcePath wires later)
        __CELL.get_or_init(|| {
            let base: &[u8] = match $root {
                $crate::EmbedKind::Codegen | $crate::EmbedKind::CodegenEager => {
                    $crate::build_options::CODEGEN_PATH
                }
                $crate::EmbedKind::Src | $crate::EmbedKind::SrcEager => {
                    $crate::build_options::BASE_PATH
                }
            };
            let mut p = ::std::path::PathBuf::from(::std::str::from_utf8(base).unwrap_or(""));
            p.push($sub_path);
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
// `StringPointer` (see install/hosted_git_info.rs). The append methods here
// therefore return `StringPointer`, not `&[u8]`.
#[derive(Default)]
pub struct StringBuilder {
    pub len: usize,
    pub cap: usize,
    pub ptr: Option<Box<[u8]>>,
}

#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct StringPointer { pub offset: u32, pub length: u32 }
impl StringPointer {
    #[inline] pub fn slice<'a>(&self, buf: &'a [u8]) -> &'a [u8] {
        &buf[self.offset as usize..(self.offset + self.length) as usize]
    }
}

impl StringBuilder {
    pub fn init_capacity(cap: usize) -> Result<Self, AllocError> {
        Ok(Self { len: 0, cap, ptr: Some(vec![0u8; cap].into_boxed_slice()) })
    }
    #[inline] pub fn count(&mut self, slice: &[u8]) { self.cap += slice.len(); }
    #[inline] pub fn count_z(&mut self, slice: &[u8]) { self.cap += slice.len() + 1; }
    #[inline]
    pub fn count16(&mut self, slice: &[u16]) {
        self.cap += crate::strings::element_length_utf16_into_utf8(slice);
    }
    /// `std.fmt.count` — measures the formatted byte length.
    #[inline]
    pub fn fmt_count(&mut self, args: core::fmt::Arguments<'_>) {
        struct Counter(usize);
        impl core::fmt::Write for Counter {
            fn write_str(&mut self, s: &str) -> core::fmt::Result { self.0 += s.len(); Ok(()) }
        }
        let mut c = Counter(0);
        let _ = core::fmt::write(&mut c, args);
        self.cap += c.0;
    }
    pub fn allocate(&mut self) -> Result<(), AllocError> {
        self.ptr = Some(vec![0u8; self.cap].into_boxed_slice());
        self.len = 0;
        Ok(())
    }
    pub fn deinit(&mut self) { self.ptr = None; self.len = 0; self.cap = 0; }
    #[inline]
    pub fn allocated_slice(&mut self) -> &mut [u8] {
        match &mut self.ptr { Some(p) => &mut p[..], None => &mut [] }
    }
    #[inline]
    pub fn writable(&mut self) -> &mut [u8] {
        let len = self.len;
        match &mut self.ptr { Some(p) => &mut p[len..], None => &mut [] }
    }
    pub fn append(&mut self, slice: &[u8]) -> StringPointer {
        debug_assert!(self.ptr.is_some(), "StringBuilder::append: must allocate() first");
        debug_assert!(self.len + slice.len() <= self.cap, "StringBuilder::append: didn't count() everything");
        let off = self.len;
        self.writable()[..slice.len()].copy_from_slice(slice);
        self.len += slice.len();
        StringPointer { offset: off as u32, length: slice.len() as u32 }
    }
    pub fn append_z(&mut self, slice: &[u8]) -> StringPointer {
        let sp = self.append(slice);
        self.writable()[0] = 0;
        self.len += 1;
        sp
    }
    pub fn add(&mut self, len: usize) -> StringPointer {
        debug_assert!(self.len + len <= self.cap);
        let off = self.len;
        self.len += len;
        StringPointer { offset: off as u32, length: len as u32 }
    }
    /// `std.fmt.bufPrint` into the writable region.
    pub fn fmt(&mut self, args: core::fmt::Arguments<'_>) -> StringPointer {
        struct Cursor<'a> { buf: &'a mut [u8], pos: usize }
        impl core::fmt::Write for Cursor<'_> {
            fn write_str(&mut self, s: &str) -> core::fmt::Result {
                let b = s.as_bytes();
                self.buf[self.pos..self.pos + b.len()].copy_from_slice(b);
                self.pos += b.len();
                Ok(())
            }
        }
        let off = self.len;
        let mut c = Cursor { buf: self.writable(), pos: 0 };
        let _ = core::fmt::write(&mut c, args);
        let written = c.pos;
        self.len += written;
        StringPointer { offset: off as u32, length: written as u32 }
    }
    /// Transfer ownership of the underlying buffer; resets self.
    pub fn move_to_slice(&mut self) -> Box<[u8]> {
        core::mem::take(&mut self.ptr).unwrap_or_default()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bun_core/util.zig (235 lines)
//   confidence: low
//   todos:      7
//   notes:      pure comptime-reflection helpers; mapped to MapLike/ArrayLike traits — Phase B should inline call sites to .collect()/Vec::from and likely delete this module
// ──────────────────────────────────────────────────────────────────────────
