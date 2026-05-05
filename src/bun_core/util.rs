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
        // Windows: env names are case-insensitive. Scan std::env (which decodes
        // the wide env block) and return a leaked byte copy. Zig avoids the leak
        // by walking `std.os.environ` directly; the Win32 wide-walk port lands
        // when `windows_sys::env_block()` is real.
        // PERF(port): leaks one Box<[u8]> per first-read of each var on Windows.
        for (k, v) in std::env::vars_os() {
            let kb = k.as_encoded_bytes();
            if kb.len() == key.len()
                && kb.iter().zip(key.as_bytes()).all(|(a, b)| a.eq_ignore_ascii_case(b))
            {
                let bytes: Box<[u8]> = v.as_encoded_bytes().to_vec().into_boxed_slice();
                return Some(Box::leak(bytes));
            }
        }
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
    // No separator after root: return the root if there is one, else None.
    if root_end > 0 { Some(&path[..root_end]) } else { None }
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
    #[inline] pub const fn native(self) -> FdBacking { self.0 }

    #[cfg(not(windows))] #[inline] pub const fn stdin()  -> Fd { Fd(0) }
    #[cfg(not(windows))] #[inline] pub const fn stdout() -> Fd { Fd(1) }
    #[cfg(not(windows))] #[inline] pub const fn stderr() -> Fd { Fd(2) }
    #[cfg(not(windows))] #[inline] pub fn cwd() -> Fd { Fd(libc::AT_FDCWD) }

    #[cfg(windows)] #[inline] pub fn stdin()  -> Fd { unsafe { fd::WINDOWS_CACHED_STDIN } }
    #[cfg(windows)] #[inline] pub fn stdout() -> Fd { unsafe { fd::WINDOWS_CACHED_STDOUT } }
    #[cfg(windows)] #[inline] pub fn stderr() -> Fd { unsafe { fd::WINDOWS_CACHED_STDERR } }
    #[cfg(windows)] #[inline] pub fn cwd() -> Fd { Fd::INVALID /* AT_FDCWD unsupported; callers use "." */ }
}

/// Zig fd.zig module-level statics (windows std-handle cache).
pub mod fd {
    use super::Fd;
    // SAFETY: written once in windows_stdio::init() during single-threaded startup.
    #[cfg(windows)] pub static mut WINDOWS_CACHED_STDIN:  Fd = Fd::INVALID;
    #[cfg(windows)] pub static mut WINDOWS_CACHED_STDOUT: Fd = Fd::INVALID;
    #[cfg(windows)] pub static mut WINDOWS_CACHED_STDERR: Fd = Fd::INVALID;
    #[cfg(windows)] pub static mut WINDOWS_CACHED_FD_SET: bool = false;
    // Non-windows: no statics; module exists so `use crate::fd as fd_internals` resolves.
    #[cfg(not(windows))] #[allow(dead_code)] const _PLACEHOLDER: () = ();
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
pub struct ThreadLock {
    #[cfg(debug_assertions)] owning_thread: core::sync::atomic::AtomicU64,
    #[cfg(debug_assertions)] locked_at: crate::StoredTrace,
}
const INVALID_THREAD_ID: u64 = 0;
impl ThreadLock {
    pub const fn init_unlocked() -> Self {
        Self {
            #[cfg(debug_assertions)] owning_thread: core::sync::atomic::AtomicU64::new(INVALID_THREAD_ID),
            #[cfg(debug_assertions)] locked_at: crate::StoredTrace::EMPTY,
        }
    }
    #[inline] pub fn init_locked() -> Self { let mut s = Self::init_unlocked(); s.lock(); s }
    /// Zig `initLockedIfNonComptime` — Zig comptime evaluation has no thread;
    /// in Rust there is no comptime execution, so this is just `init_locked`.
    #[inline] pub fn init_locked_if_non_comptime() -> Self { Self::init_locked() }
    /// Zig `lockOrAssert` — acquire if unlocked, else assert this thread holds it.
    #[inline]
    pub fn lock_or_assert(&mut self) {
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
    pub fn lock(&mut self) {
        #[cfg(debug_assertions)]
        {
            let cur = thread_id();
            let prev = self.owning_thread.swap(cur, core::sync::atomic::Ordering::AcqRel);
            if prev != INVALID_THREAD_ID {
                crate::dump_stack_trace(&self.locked_at.trace(), crate::DumpStackTraceOptions {
                    frame_count: 10, stop_at_jsc_llint: true, ..Default::default()
                });
                panic!("ThreadLock: thread {cur} tried to lock, already held by {prev}");
            }
            self.locked_at = crate::StoredTrace::capture(None);
        }
    }
    #[inline]
    pub fn unlock(&mut self) {
        #[cfg(debug_assertions)]
        self.owning_thread.store(INVALID_THREAD_ID, core::sync::atomic::Ordering::Release);
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
// PORT STATUS
//   source:     src/bun_core/util.zig (235 lines)
//   confidence: low
//   todos:      7
//   notes:      pure comptime-reflection helpers; mapped to MapLike/ArrayLike traits — Phase B should inline call sites to .collect()/Vec::from and likely delete this module
// ──────────────────────────────────────────────────────────────────────────
