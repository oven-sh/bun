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
    // SAFETY: `b"\0"` is a 'static 1-byte allocation with `ptr[0] == 0`, so
    // `ptr[len] == 0` holds for `len = 0` and `ptr[..0]` is trivially readable.
    pub const EMPTY: &'static ZStr = unsafe { Self::from_raw(c"".as_ptr().cast::<u8>(), 0) };

    /// SAFETY: `ptr[len] == 0` and `ptr[..len]` is readable for `'a`.
    #[inline]
    pub const unsafe fn from_raw<'a>(ptr: *const u8, len: usize) -> &'a ZStr {
        // SAFETY: caller upholds `ptr[..len]` readable for `'a`; `ZStr` is
        // `repr(transparent)` over `[u8]` so the fat-pointer cast preserves layout.
        unsafe {
            &*(std::ptr::from_ref::<[u8]>(core::slice::from_raw_parts(ptr, len)) as *const ZStr)
        }
    }
    /// SAFETY: `ptr[len] == 0` and `ptr[..=len]` is writable for `'a`.
    #[inline]
    pub unsafe fn from_raw_mut<'a>(ptr: *mut u8, len: usize) -> &'a mut ZStr {
        // SAFETY: caller contract above; `repr(transparent)` over `[u8]`.
        unsafe {
            &mut *(std::ptr::from_mut::<[u8]>(core::slice::from_raw_parts_mut(ptr, len))
                as *mut ZStr)
        }
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
        debug_assert_eq!(
            buf[buf.len() - 1],
            0,
            "ZStr::from_slice_with_nul: missing trailing NUL"
        );
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
    #[inline]
    pub const fn as_bytes(&self) -> &[u8] {
        &self.0
    }
    #[inline]
    pub const fn len(&self) -> usize {
        self.0.len()
    }
    #[inline]
    pub const fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    #[inline]
    pub const fn as_ptr(&self) -> *const core::ffi::c_char {
        self.0.as_ptr().cast()
    }
    /// Includes the trailing NUL.
    #[inline]
    pub fn as_bytes_with_nul(&self) -> &[u8] {
        // SAFETY: invariant — byte at `len` is NUL and owned by the same allocation.
        unsafe { core::slice::from_raw_parts(self.0.as_ptr(), self.0.len() + 1) }
    }
    /// View as `&CStr`. Safe-surface bridge for FFI sites that need a
    /// `*const c_char` via `CStr` — funnels the ~dozen open-coded
    /// `CStr::from_bytes_with_nul_unchecked` call sites through one audited
    /// `unsafe`. Debug-asserts no interior NUL (CStr's extra invariant over
    /// ZStr); release relies on the construction-site contract (path/host
    /// bytes never embed NUL — same assumption Zig `[:0]const u8` → C makes).
    #[inline]
    pub fn as_cstr(&self) -> &core::ffi::CStr {
        debug_assert!(
            !self.0.contains(&0),
            "ZStr::as_cstr: interior NUL would truncate the C view",
        );
        // SAFETY: `as_bytes_with_nul()` is `[.., 0]` by the ZStr invariant;
        // no interior NUL is debug-asserted above (caller contract in release).
        unsafe { core::ffi::CStr::from_bytes_with_nul_unchecked(self.as_bytes_with_nul()) }
    }
    /// Borrow a `&CStr` as `&ZStr` — both are NUL-terminated, len excludes NUL.
    #[inline]
    pub fn from_cstr(s: &core::ffi::CStr) -> &ZStr {
        // SAFETY: `CStr` guarantees `bytes[count] == 0` and the whole range is
        // readable for the borrow lifetime — exactly the ZStr invariant.
        unsafe { Self::from_raw(s.as_ptr().cast::<u8>(), s.count_bytes()) }
    }
    /// Borrow a NUL-terminated FFI C string as `&ZStr`, or `EMPTY` if `p` is
    /// null. Single audited funnel for the `strlen`-then-`from_raw` shape that
    /// previously appeared as ad-hoc local helpers in libarchive / uSockets /
    /// HTTPCertError. Returns `&'a ZStr` so the *caller* picks the lifetime.
    ///
    /// # Safety
    /// If `p` is non-null it must point to a valid NUL-terminated byte sequence
    /// readable for `'a`. Null is explicitly allowed (→ `ZStr::EMPTY`).
    #[inline]
    pub unsafe fn from_c_ptr<'a>(p: *const core::ffi::c_char) -> &'a ZStr {
        if p.is_null() {
            return Self::EMPTY;
        }
        // SAFETY: caller contract — `p` is non-null, NUL-terminated, valid for `'a`.
        let len = unsafe { libc::strlen(p) };
        // SAFETY: `p[len] == 0` (strlen postcondition) and `p[..len]` readable.
        unsafe { Self::from_raw(p.cast::<u8>(), len) }
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
    fn default() -> Self {
        ZBox(Box::new([0u8; 1]))
    }
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
    #[inline]
    pub fn len(&self) -> usize {
        self.0.len() - 1
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
    #[inline]
    pub fn as_bytes(&self) -> &[u8] {
        &self.0[..self.len()]
    }
    #[inline]
    pub fn as_bytes_with_nul(&self) -> &[u8] {
        &self.0
    }
    #[inline]
    pub fn as_ptr(&self) -> *const core::ffi::c_char {
        self.0.as_ptr().cast()
    }
    #[inline]
    pub fn as_zstr(&self) -> &ZStr {
        // SAFETY: invariant — `self.0[len] == 0`.
        unsafe { ZStr::from_raw(self.0.as_ptr(), self.len()) }
    }
    #[inline]
    pub fn into_vec_with_nul(self) -> Vec<u8> {
        self.0.into_vec()
    }
    /// Unwrap to the raw `Box<[u8]>` storage (trailing NUL at index `len()-1`).
    /// For call sites that must store sentinel and non-sentinel payloads in the
    /// same `Box<[u8]>` shape (e.g. GlobWalker's `MatchedPath`).
    #[inline]
    pub fn into_boxed_slice_with_nul(self) -> Box<[u8]> {
        self.0
    }
}
impl core::ops::Deref for ZBox {
    type Target = ZStr;
    #[inline]
    fn deref(&self) -> &ZStr {
        self.as_zstr()
    }
}
impl core::ops::Deref for ZStr {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        &self.0
    }
}

/// Borrowed `[:0]const u16` (Windows wide string).
#[repr(transparent)]
pub struct WStr([u16]);

impl WStr {
    // SAFETY: `[0u16]` is a 'static 1-unit allocation with `ptr[0] == 0`, so
    // `ptr[len] == 0` holds for `len = 0` and `ptr[..0]` is trivially readable.
    pub const EMPTY: &'static WStr = unsafe { Self::from_raw([0u16].as_ptr(), 0) };
    /// SAFETY: `ptr[len] == 0` and `ptr[..len]` is readable for `'a`.
    #[inline]
    pub const unsafe fn from_raw<'a>(ptr: *const u16, len: usize) -> &'a WStr {
        // SAFETY: caller upholds `ptr[..len]` readable for `'a`; `WStr` is
        // `repr(transparent)` over `[u16]` so the fat-pointer cast preserves layout.
        unsafe {
            &*(std::ptr::from_ref::<[u16]>(core::slice::from_raw_parts(ptr, len)) as *const WStr)
        }
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
        debug_assert_eq!(
            buf[buf.len() - 1],
            0,
            "WStr::from_slice_with_nul: missing trailing NUL"
        );
        // SAFETY: `buf[buf.len()-1] == 0` (debug-asserted; caller contract in
        // release) and `buf[..buf.len()-1]` is in-bounds by slice invariant.
        unsafe { Self::from_raw(buf.as_ptr(), buf.len() - 1) }
    }
    /// Borrow a NUL-terminated FFI wide string as `&WStr`, or [`EMPTY`] if
    /// `p` is null. UTF-16 mirror of [`ZStr::from_c_ptr`]; single audited
    /// funnel for the `wcslen`-then-`from_raw` shape at libarchive `_w`
    /// accessors and Windows path-API ingestion points.
    ///
    /// # Safety
    /// If non-null, `p` must point to a NUL-terminated u16 sequence readable
    /// for `'a`. Null is explicitly allowed (→ `WStr::EMPTY`).
    #[inline]
    pub unsafe fn from_ptr<'a>(p: *const u16) -> &'a WStr {
        if p.is_null() {
            return Self::EMPTY;
        }
        // SAFETY: non-null and NUL-terminated per caller contract.
        unsafe { Self::from_raw(p, crate::ffi::wcslen(p)) }
    }
    #[inline]
    pub const fn as_slice(&self) -> &[u16] {
        &self.0
    }
    #[inline]
    pub const fn len(&self) -> usize {
        self.0.len()
    }
    #[inline]
    pub const fn as_ptr(&self) -> *const u16 {
        self.0.as_ptr()
    }
    /// SAFETY: `ptr[len] == 0` and `ptr[..=len]` is writable for `'a`.
    /// Mirrors [`ZStr::from_raw_mut`] so callers can rewrite UTF-16 path
    /// chars in place (Windows tar path-escape pass) without round-tripping
    /// through an owned buffer.
    #[inline]
    pub unsafe fn from_raw_mut<'a>(ptr: *mut u16, len: usize) -> &'a mut WStr {
        // SAFETY: caller upholds `ptr[..=len]` writable for `'a`; `WStr` is
        // `repr(transparent)` over `[u16]` so the fat-pointer cast preserves layout.
        unsafe {
            &mut *(std::ptr::from_mut::<[u16]>(core::slice::from_raw_parts_mut(ptr, len))
                as *mut WStr)
        }
    }
    #[inline]
    pub fn as_mut_slice(&mut self) -> &mut [u16] {
        &mut self.0
    }
}
impl core::ops::Deref for WStr {
    type Target = [u16];
    #[inline]
    fn deref(&self) -> &[u16] {
        &self.0
    }
}
impl core::ops::DerefMut for WStr {
    #[inline]
    fn deref_mut(&mut self) -> &mut [u16] {
        &mut self.0
    }
}
impl AsRef<[u16]> for WStr {
    #[inline]
    fn as_ref(&self) -> &[u16] {
        &self.0
    }
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

// ── ZStr trait sugar (downstream ergonomics) ──────────────────────────────
impl AsRef<ZStr> for ZStr {
    #[inline]
    fn as_ref(&self) -> &ZStr {
        self
    }
}
impl AsRef<[u8]> for ZStr {
    #[inline]
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}
impl PartialEq<[u8]> for ZStr {
    #[inline]
    fn eq(&self, other: &[u8]) -> bool {
        &self.0 == other
    }
}
impl<const N: usize> PartialEq<&[u8; N]> for ZStr {
    #[inline]
    fn eq(&self, other: &&[u8; N]) -> bool {
        &self.0 == *other
    }
}

// ── dupe_z / free_sensitive ───────────────────────────────────────────────
/// `bun.default_allocator.dupeZ(u8, bytes)` → heap-allocated NUL-terminated
/// copy. Returns a raw `*const c_char` because the SSLConfig FFI surface
/// stores C-strings. Caller frees via [`free_sensitive`].
///
/// Allocated via the default allocator (`bun_alloc::default_alloc` —
/// mimalloc, or `std::alloc::System` under `cfg(bun_asan)`), so the
/// allocation is visible to ASAN's interceptor and LeakSanitizer like every
/// other heap allocation. Pairs with [`free_sensitive`], which frees through
/// the same `default_alloc::free`.
pub fn dupe_z(bytes: &[u8]) -> *const core::ffi::c_char {
    let p = bun_alloc::default_alloc::malloc(bytes.len() + 1).cast::<u8>();
    if p.is_null() {
        crate::out_of_memory();
    }
    // SAFETY: `p` is a fresh allocation of `len + 1` writable bytes.
    unsafe {
        core::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
        *p.add(bytes.len()) = 0;
    }
    p as *const core::ffi::c_char
}

/// Port of `bun.freeSensitive(bun.default_allocator, slice)` for the C-string
/// case used by http SSLConfig — re-exported from `bun_alloc` so the
/// secure-zero core stays single-sourced. Pairs with [`dupe_z`].
pub use bun_alloc::free_sensitive_cstr as free_sensitive;
/// Port of `std.crypto.secureZero` — re-exported from `bun_alloc`.
pub use bun_alloc::secure_zero;
