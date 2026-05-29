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
            (slice.as_ptr() as usize).is_multiple_of(core::mem::align_of::<T>()),
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
            (slice.as_ptr() as usize).is_multiple_of(core::mem::align_of::<T>()),
            "Unaligned::slice_align_cast_mut: pointer is not {}-byte aligned",
            core::mem::align_of::<T>(),
        );
        // SAFETY: see `slice_align_cast`; `&mut` exclusivity is preserved.
        unsafe { core::slice::from_raw_parts_mut(slice.as_mut_ptr().cast::<T>(), slice.len()) }
    }
}

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
    #[inline]
    pub fn from_buf(buf: &[u8], len: usize) -> &ZStr {
        debug_assert!(len < buf.len(), "ZStr::from_buf: NUL must lie within buf");
        debug_assert_eq!(buf[len], 0, "ZStr::from_buf: missing NUL at buf[len]");
        // SAFETY: `buf[..=len]` is in-bounds (debug-asserted above; release
        // relies on caller upholding the documented `buf[len] == 0`
        // precondition, same contract as Zig `[:0]const u8` slicing).
        unsafe { Self::from_raw(buf.as_ptr(), len) }
    }
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
        getenv_z_any_case(key)
    }
}

#[cfg(unix)]
#[inline]
pub fn c_environ() -> *const *const core::ffi::c_char {
    unsafe extern "C" {
        // `safe static` (Rust 2024 `unsafe extern`) discharges the link-time
        // existence proof; `AtomicPtr::load` itself is already safe.
        safe static environ: core::sync::atomic::AtomicPtr<*const core::ffi::c_char>;
    }
    environ.load(core::sync::atomic::Ordering::Relaxed)
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
            if crate::strings::eql_case_insensitive_ascii_check_length(
                &line[..key_end],
                key.as_bytes(),
            ) {
                return Some(&line[(key_end + 1).min(line.len())..]);
            }
            p = p.add(1);
        }
        None
    }
    #[cfg(windows)]
    {
        // Walk `os::environ()` — WTF-8 `KEY=VALUE` C strings populated at
        // startup by `convert_env_to_wtf8`. Same scan as the unix arm above
        // but the block is owned by us (Box::leak'd) instead of libc.
        // SAFETY: env block is process-lifetime; written exactly once at
        // startup before any reader runs.
        let environ = unsafe { crate::os::environ() };
        for &entry in environ {
            if entry.is_null() {
                continue;
            }
            // SAFETY: each entry is a NUL-terminated WTF-8 string into the
            // leaked `WTF8_ENV_BUF` allocation.
            let line = unsafe {
                let mut len = 0usize;
                while *entry.add(len) != 0 {
                    len += 1;
                }
                core::slice::from_raw_parts(entry.cast::<u8>(), len)
            };
            let key_end = line.iter().position(|&b| b == b'=').unwrap_or(line.len());
            if crate::strings::eql_case_insensitive_ascii_check_length(
                &line[..key_end],
                key.as_bytes(),
            ) {
                return Some(&line[(key_end + 1).min(line.len())..]);
            }
        }
        None
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = key;
        None
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

#[macro_export]
macro_rules! opaque_extern {
    ($($t:tt)*) => { ::bun_opaque::opaque_ffi!($($t)*); };
}

/// Poison-free `std::sync::Mutex<T>` wrapper. See module note above for why
/// this is not `bun_threading::Guarded<T>`.
pub struct Mutex<T>(std::sync::Mutex<T>);

/// Guard returned by [`Mutex::lock`] / [`Mutex::try_lock`]. Re-exported so
/// callers can name it in return types (e.g. `rare_data::ProxyEnvStorage::lock`).
pub type MutexGuard<'a, T> = std::sync::MutexGuard<'a, T>;

/// Zig `Guarded(T)` — same wrapper, different spelling.
pub type Guarded<T> = Mutex<T>;

impl<T> Mutex<T> {
    #[inline]
    pub const fn new(value: T) -> Self {
        Self(std::sync::Mutex::new(value))
    }

    #[inline]
    pub fn lock(&self) -> MutexGuard<'_, T> {
        // Poisoning is unreachable (Bun aborts on panic); recover the guard if
        // it ever happens rather than propagating a `Result`.
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[inline]
    pub fn try_lock(&self) -> Option<MutexGuard<'_, T>> {
        match self.0.try_lock() {
            Ok(g) => Some(g),
            Err(std::sync::TryLockError::Poisoned(e)) => Some(e.into_inner()),
            Err(std::sync::TryLockError::WouldBlock) => None,
        }
    }

    #[inline]
    pub fn get_mut(&mut self) -> &mut T {
        self.0
            .get_mut()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[inline]
    pub fn into_inner(self) -> T {
        self.0
            .into_inner()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl<T: Default> Default for Mutex<T> {
    fn default() -> Self {
        Self::new(T::default())
    }
}

/// Poison-free `std::sync::RwLock<T>` wrapper. See module note on [`Mutex`].
pub struct RwLock<T>(std::sync::RwLock<T>);

pub type RwLockReadGuard<'a, T> = std::sync::RwLockReadGuard<'a, T>;
pub type RwLockWriteGuard<'a, T> = std::sync::RwLockWriteGuard<'a, T>;

impl<T> RwLock<T> {
    #[inline]
    pub const fn new(value: T) -> Self {
        Self(std::sync::RwLock::new(value))
    }

    #[inline]
    pub fn read(&self) -> RwLockReadGuard<'_, T> {
        self.0
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[inline]
    pub fn write(&self) -> RwLockWriteGuard<'_, T> {
        self.0
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    #[inline]
    pub fn get_mut(&mut self) -> &mut T {
        self.0
            .get_mut()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

impl<T: Default> Default for RwLock<T> {
    fn default() -> Self {
        Self::new(T::default())
    }
}

// ─── Path primitives (from bun_paths) ─────────────────────────────────────
// Zig: src/paths/paths.zig lines 13-20.
// Zig uses `std.fs.max_path_bytes` which is platform-dependent.
pub const MAX_PATH_BYTES: usize = if cfg!(target_arch = "wasm32") {
    1024
} else if cfg!(windows) {
    // std.os.windows.PATH_MAX_WIDE * 3 + 1 (UTF-8 worst-case from UTF-16).
    32767 * 3 + 1
} else if cfg!(any(target_os = "linux", target_os = "android")) {
    4096 // Linux libc::PATH_MAX
} else {
    // macOS / iOS / FreeBSD / OpenBSD / NetBSD / DragonFly / Solaris (std/c.zig PATH_MAX)
    1024
};
pub const PATH_MAX_WIDE: usize = 32767;

#[cfg(windows)]
pub type OSPathChar = u16;
#[cfg(not(windows))]
pub type OSPathChar = u8;

pub type OSPathSlice<'a> = &'a [OSPathChar];
#[cfg(windows)]
pub type OSPathSliceZ = WStr;
#[cfg(not(windows))]
pub type OSPathSliceZ = ZStr;

pub use bun_alloc::SEP;

#[repr(transparent)]
pub struct PathBuffer(pub [u8; MAX_PATH_BYTES]);
impl PathBuffer {
    pub const ZEROED: Self = Self([0; MAX_PATH_BYTES]);
    #[inline]
    #[allow(invalid_value, clippy::uninit_assumed_init)]
    pub fn uninit() -> Self {
        // SAFETY: `PathBuffer` is `repr(transparent)` over `[u8; N]`; every bit
        // pattern is a valid `u8`, and callers treat this as a write-only
        // scratch buffer (length-tracked) exactly like Zig
        // `var buf: bun.PathBuffer = undefined`. No byte is read before being
        // written by the consuming syscall / encoder.
        unsafe { core::mem::MaybeUninit::uninit().assume_init() }
    }
    #[inline]
    pub fn as_mut_slice(&mut self) -> &mut [u8] {
        &mut self.0
    }
    #[inline]
    pub fn as_slice(&self) -> &[u8] {
        &self.0
    }
}
impl Default for PathBuffer {
    #[inline]
    fn default() -> Self {
        Self::uninit()
    }
}
impl core::ops::Deref for PathBuffer {
    type Target = [u8];
    #[inline]
    fn deref(&self) -> &[u8] {
        &self.0
    }
}
impl core::ops::DerefMut for PathBuffer {
    #[inline]
    fn deref_mut(&mut self) -> &mut [u8] {
        &mut self.0
    }
}

/// Zig: `[PATH_MAX_WIDE]u16`. Same newtype shape as [`PathBuffer`].
#[repr(transparent)]
pub struct WPathBuffer(pub [u16; PATH_MAX_WIDE]);
impl WPathBuffer {
    pub const ZEROED: Self = Self([0; PATH_MAX_WIDE]);
    #[inline]
    #[allow(invalid_value, clippy::uninit_assumed_init)]
    pub fn uninit() -> Self {
        // SAFETY: `repr(transparent)` over `[u16; N]`; every bit pattern is a
        // valid `u16`. Callers treat this as a write-only scratch buffer and
        // track the written length out-of-band — mirrors Zig
        // `var wbuf: bun.WPathBuffer = undefined`.
        unsafe { core::mem::MaybeUninit::uninit().assume_init() }
    }
    /// Inherent `as_slice` so `wbuf.as_slice()` resolves here instead of the
    /// unstable `<[u16]>::as_slice` (`str_as_str` feature) via `Deref`.
    #[inline]
    pub fn as_slice(&self) -> &[u16] {
        &self.0
    }
    #[inline]
    pub fn as_mut_slice(&mut self) -> &mut [u16] {
        &mut self.0
    }
}
impl Default for WPathBuffer {
    #[inline]
    fn default() -> Self {
        Self::uninit()
    }
}
impl core::ops::Deref for WPathBuffer {
    type Target = [u16];
    #[inline]
    fn deref(&self) -> &[u16] {
        &self.0
    }
}
impl core::ops::DerefMut for WPathBuffer {
    #[inline]
    fn deref_mut(&mut self) -> &mut [u16] {
        &mut self.0
    }
}
#[cfg(windows)]
pub type OSPathBuffer = WPathBuffer;
#[cfg(not(windows))]
pub type OSPathBuffer = PathBuffer;

/// Zig: `bun.Dirname.dirname(u8, path)` → `std.fs.path.dirnamePosix` /
/// `dirnameWindows`. Faithful port (handles trailing-sep stripping and root).
pub fn dirname(path: &[u8]) -> Option<&[u8]> {
    use crate::path_sep::is_sep_native as is_sep;

    if path.is_empty() {
        return None;
    }
    // Strip trailing separators.
    let mut end = path.len();
    while end > 1 && is_sep(path[end - 1]) {
        end -= 1;
    }
    // Windows: skip drive prefix `X:` so `C:\foo` → `C:\`, `C:foo` → None.
    let root_end: usize =
        if cfg!(windows) && end >= 2 && path[1] == b':' && path[0].is_ascii_alphabetic() {
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
            return Some(&path[..i]);
        }
    }
    if root_end > 0 && end > root_end && is_sep(path[root_end - 1]) {
        return Some(&path[..root_end]);
    }
    None
}

// Zig backing_int (fd.zig:1): c_int on posix, u64 on Windows.
#[cfg(not(windows))]
type FdBacking = i32;
#[cfg(windows)]
type FdBacking = u64;

#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Fd(pub FdBacking);

// Zig packed struct(u64) { value: u63, kind: u1 } — fields are LSB-first, so
// `value` is bits 0..63, `kind` is bit 63. (.system=0, .uv=1)
#[cfg(windows)]
const FD_KIND_BIT: u64 = 1u64 << 63;
#[cfg(windows)]
const FD_VALUE_MASK: u64 = FD_KIND_BIT - 1;

impl Fd {
    /// Zig fd.zig:33-35: { kind=.system, value.as_system = minInt(field_type) }.
    /// posix: minInt(c_int); windows: minInt(u63) = 0, kind=0 → all-zero u64.
    #[cfg(not(windows))]
    pub const INVALID: Fd = Fd(i32::MIN);
    #[cfg(windows)]
    pub const INVALID: Fd = Fd(0);

    /// Zig `bun.invalid_fd` / `FD.invalid` — function form of [`Fd::INVALID`]
    /// for call sites that read better as a constructor (`Fd::invalid()`).
    #[inline]
    pub const fn invalid() -> Fd {
        Fd::INVALID
    }

    #[inline]
    pub const fn from_native(v: FdBacking) -> Fd {
        Fd(v)
    }
    /// libuv fd (== posix fd on non-windows; uv-tagged on windows).
    #[inline]
    pub const fn from_uv(v: i32) -> Fd {
        #[cfg(windows)]
        // kind=.uv (bit 63 = 1); uv_file is i32, store sign-extended into low 63.
        {
            Fd(FD_KIND_BIT | ((v as i64 as u64) & FD_VALUE_MASK))
        }
        #[cfg(not(windows))]
        {
            Fd(v)
        }
    }
    #[cfg(windows)]
    #[inline]
    pub fn from_system(h: *mut core::ffi::c_void) -> Fd {
        // kind=.system (bit 63 = 0); WindowsHandleNumber is u63.
        // Zig fd.zig:48 asserts `@intFromPtr(value) <= maxInt(u63)`.
        debug_assert!((h as u64) <= FD_VALUE_MASK);
        Fd((h as u64) & FD_VALUE_MASK)
    }
    #[cfg(not(windows))]
    #[inline]
    pub const fn native(self) -> FdNative {
        self.0
    }
    #[cfg(windows)]
    #[inline]
    pub fn native(self) -> FdNative {
        match self.decode_windows() {
            DecodeWindows::Windows(handle) => handle,
            DecodeWindows::Uv(file_number) => fd::uv_get_osfhandle(file_number),
        }
    }
    #[cfg(unix)]
    #[inline]
    pub fn as_borrowed_fd(&self) -> std::os::fd::BorrowedFd<'_> {
        let raw = self.native();
        assert!(raw != -1, "Fd::as_borrowed_fd on raw fd -1");
        // SAFETY: `raw != -1` (asserted above, satisfying `BorrowedFd`'s
        // niche). The "remains open for the borrow's lifetime" invariant is
        // the `Fd` type's contract — every API taking `Fd` requires the
        // caller to keep the descriptor open for the call, and the returned
        // borrow cannot outlive `&self`.
        unsafe { std::os::fd::BorrowedFd::borrow_raw(raw) }
    }
    #[cfg(not(windows))]
    #[inline]
    pub const fn uv(self) -> i32 {
        self.0
    }
    #[cfg(windows)]
    pub fn uv(self) -> i32 {
        match self.decode_windows() {
            DecodeWindows::Uv(v) => v,
            DecodeWindows::Windows(handle) => {
                if Some(self) == fd::WINDOWS_CACHED_STDIN.get().copied() {
                    return 0;
                }
                if Some(self) == fd::WINDOWS_CACHED_STDOUT.get().copied() {
                    return 1;
                }
                if Some(self) == fd::WINDOWS_CACHED_STDERR.get().copied() {
                    return 2;
                }
                if fd::is_stdio_handle(fd::STD_INPUT_HANDLE, handle) {
                    return 0;
                }
                if fd::is_stdio_handle(fd::STD_OUTPUT_HANDLE, handle) {
                    return 1;
                }
                if fd::is_stdio_handle(fd::STD_ERROR_HANDLE, handle) {
                    return 2;
                }
                panic!(
                    "Cast bun.FD.uv({}) makes closing impossible!\n\n\
                     The supplier of fd FD should call 'FD.makeLibUVOwned',\n\
                     probably where open() was called.",
                    self,
                );
            }
        }
    }

    #[cfg(not(windows))]
    #[inline]
    pub const fn stdin() -> Fd {
        Fd(0)
    }
    #[cfg(not(windows))]
    #[inline]
    pub const fn stdout() -> Fd {
        Fd(1)
    }
    #[cfg(not(windows))]
    #[inline]
    pub const fn stderr() -> Fd {
        Fd(2)
    }
    #[cfg(not(windows))]
    #[inline]
    pub fn cwd() -> Fd {
        Fd(libc::AT_FDCWD)
    }

    #[cfg(windows)]
    #[inline]
    pub fn stdin() -> Fd {
        fd::WINDOWS_CACHED_STDIN
            .get()
            .copied()
            .unwrap_or(Fd::INVALID)
    }
    #[cfg(windows)]
    #[inline]
    pub fn stdout() -> Fd {
        fd::WINDOWS_CACHED_STDOUT
            .get()
            .copied()
            .unwrap_or(Fd::INVALID)
    }
    #[cfg(windows)]
    #[inline]
    pub fn stderr() -> Fd {
        fd::WINDOWS_CACHED_STDERR
            .get()
            .copied()
            .unwrap_or(Fd::INVALID)
    }
    #[cfg(windows)]
    #[inline]
    pub fn cwd() -> Fd {
        Fd::from_system(fd::windows_current_directory_handle())
    }

    /// Whether this is the process's stdin/stdout/stderr.
    #[cfg(not(windows))]
    #[inline]
    pub const fn is_stdio(self) -> bool {
        matches!(self.0, 0..=2)
    }
    #[cfg(windows)]
    pub fn is_stdio(self) -> bool {
        // Cache check first (matches `to_uv_index`): the cache reflects what the
        // process saw at startup, even after `SetStdHandle`/`AllocConsole`.
        if self == Self::stdin() || self == Self::stdout() || self == Self::stderr() {
            return true;
        }
        // Cache may not be populated yet; fall back to a live `GetStdHandle`.
        let handle = self.native();
        fd::is_stdio_handle(fd::STD_INPUT_HANDLE, handle)
            || fd::is_stdio_handle(fd::STD_OUTPUT_HANDLE, handle)
            || fd::is_stdio_handle(fd::STD_ERROR_HANDLE, handle)
    }

    // ── Kind tag (Windows: bit 63 = uv/system) ───────────────────────────
    #[cfg(not(windows))]
    #[inline]
    pub const fn kind(self) -> FdKind {
        FdKind::System
    }
    #[cfg(windows)]
    #[inline]
    pub const fn kind(self) -> FdKind {
        if self.0 & FD_KIND_BIT == 0 {
            FdKind::System
        } else {
            FdKind::Uv
        }
    }

    #[cfg(windows)]
    #[inline]
    const fn value_as_system(self) -> u64 {
        self.0 & FD_VALUE_MASK
    }

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
    pub fn make_libuv_owned(self) -> Result<Fd, ()> {
        debug_assert!(self.is_valid());
        #[cfg(not(windows))]
        {
            Ok(self)
        }
        #[cfg(windows)]
        match self.kind() {
            FdKind::Uv => Ok(self),
            FdKind::System => {
                let crt_fd = fd::uv_open_osfhandle(self.native());
                if crt_fd == -1 {
                    Err(())
                } else {
                    Ok(Fd::from_uv(crt_fd))
                }
            }
        }
    }

    #[inline]
    pub fn is_valid(self) -> bool {
        #[cfg(not(windows))]
        {
            self.0 != Fd::INVALID.0
        }
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
    #[inline]
    pub fn cast(self) -> FdNative {
        self.native()
    }

    /// Properly converts `Fd::INVALID` into `FdOptional::NONE`.
    #[inline]
    pub const fn to_optional(self) -> FdOptional {
        FdOptional(self.0)
    }

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
                    let p = fd::windows_process_parameters();
                    if handle == p.hStdInput {
                        Some(Stdio::StdIn)
                    } else if handle == p.hStdOutput {
                        Some(Stdio::StdOut)
                    } else if handle == p.hStdError {
                        Some(Stdio::StdErr)
                    } else {
                        None
                    }
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
#[cfg(not(windows))]
pub type FdNative = i32;
#[cfg(windows)]
pub type FdNative = *mut core::ffi::c_void;

/// Zig `Kind` — tag in bit 63 on Windows, `enum(u0)` (zero-width) on POSIX.
#[cfg(not(windows))]
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum FdKind {
    System = 0,
}
#[cfg(windows)]
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum FdKind {
    System = 0,
    Uv = 1,
}

#[cfg(windows)]
pub enum DecodeWindows {
    Windows(*mut core::ffi::c_void),
    Uv(i32),
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Stdio {
    StdIn = 0,
    StdOut = 1,
    StdErr = 2,
}
impl Stdio {
    #[inline]
    pub fn fd(self) -> Fd {
        match self {
            Stdio::StdIn => Fd::stdin(),
            Stdio::StdOut => Fd::stdout(),
            Stdio::StdErr => Fd::stderr(),
        }
    }
    #[inline]
    pub fn from_int(v: i32) -> Option<Stdio> {
        match v {
            0 => Some(Stdio::StdIn),
            1 => Some(Stdio::StdOut),
            2 => Some(Stdio::StdErr),
            _ => None,
        }
    }
    #[inline]
    pub fn to_int(self) -> i32 {
        self as i32
    }
}

/// Niche-packed `Option<Fd>` (`enum(backing_int) { none = @bitCast(invalid), _ }`).
/// Use instead of encoding the invalid value directly.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct FdOptional(FdBacking);
impl FdOptional {
    pub const NONE: FdOptional = FdOptional(Fd::INVALID.0);
    #[inline]
    pub const fn init(maybe: Option<Fd>) -> FdOptional {
        match maybe {
            Some(fd) => fd.to_optional(),
            None => FdOptional::NONE,
        }
    }
    #[inline]
    pub const fn unwrap(self) -> Option<Fd> {
        if self.0 == FdOptional::NONE.0 {
            None
        } else {
            Some(Fd(self.0))
        }
    }
    #[inline]
    pub fn take(&mut self) -> Option<Fd> {
        let r = self.unwrap();
        *self = FdOptional::NONE;
        r
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
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let mut proc = [0u8; 32];
        use std::io::Write as _;
        let mut c = std::io::Cursor::new(&mut proc[..]);
        let _ = write!(c, "/proc/self/fd/{}\0", fd.0);
        // SAFETY: proc is NUL-terminated above; buf has cap bytes.
        let n = unsafe { libc::readlink(proc.as_ptr().cast(), buf.cast(), cap) };
        if n < 0 {
            let e = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
            return if e == libc::ENOENT || e == libc::EBADF {
                -1
            } else {
                0
            };
        }
        return n;
    }
    #[cfg(target_os = "macos")]
    {
        let _ = cap;
        // SAFETY: F_GETPATH expects buf with at least MAXPATHLEN bytes; callers
        // pass ≥1024 which is the platform MAXPATHLEN on Darwin.
        let rc = unsafe { libc::fcntl(fd.0, libc::F_GETPATH, buf) };
        if rc < 0 {
            let e = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
            return if e == libc::ENOENT || e == libc::EBADF {
                -1
            } else {
                0
            };
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
            return if e == libc::ENOENT || e == libc::EBADF {
                -1
            } else {
                0
            };
        }
        // SAFETY: kernel wrote a NUL-terminated path into kf_path.
        let path = unsafe { addr_of!((*kif.as_ptr()).kf_path) } as *const u8;
        let len = unsafe { libc::strlen(path.cast()) };
        let n = len.min(cap);
        // SAFETY: path has `len` initialized bytes; buf has `cap` bytes.
        unsafe { core::ptr::copy_nonoverlapping(path, buf, n) };
        return n as isize;
    }
    #[cfg(not(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        target_os = "freebsd"
    )))]
    {
        let _ = (fd, buf, cap);
        0
    }
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
        if n == 0 || n >= cap {
            return -1;
        }
        // Strip the `\\?\` prefix if present so callers see a plain DOS path
        // (matches `bun_sys::windows::GetFinalPathNameByHandle` post-processing).
        // Work entirely through raw-pointer reads/writes — never form a `&[u16]`
        // or `&mut [u16]` over `buf` while the memmove runs, or the write through
        // `buf` would invalidate that borrow's tag under Stacked Borrows.
        // SAFETY: kernel32 wrote `n` u16s into `buf`; every `.add(i)` below is
        // bounds-checked against `n` first.
        let at = |i: usize| -> u16 { unsafe { *buf.add(i) } };
        let bs = b'\\' as u16;
        let off: usize =
            if n >= 4 && at(0) == bs && at(1) == bs && at(2) == b'?' as u16 && at(3) == bs {
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
    {
        let _ = (fd, buf, cap);
        0
    }
}

impl core::fmt::Display for Fd {
    fn fmt(&self, w: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let fd = *self;
        if !fd.is_valid() {
            return w.write_str("[invalid_fd]");
        }
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
    #[cfg(windows)]
    use core::ffi::{c_int, c_void};

    // Written once in windows_stdio::init() during single-threaded startup
    // (S015: write-once → `Once`; readers fall back to `Fd::INVALID`).
    pub static WINDOWS_CACHED_STDIN: crate::Once<Fd> = crate::Once::new();
    pub static WINDOWS_CACHED_STDOUT: crate::Once<Fd> = crate::Once::new();
    pub static WINDOWS_CACHED_STDERR: crate::Once<Fd> = crate::Once::new();
    #[cfg(debug_assertions)]
    pub static WINDOWS_CACHED_FD_SET: core::sync::atomic::AtomicBool =
        core::sync::atomic::AtomicBool::new(false);

    #[cfg(windows)]
    unsafe extern "C" {
        pub safe fn uv_get_osfhandle(fd: c_int) -> *mut c_void;
        pub safe fn uv_open_osfhandle(os_fd: *mut c_void) -> c_int;
    }
    #[cfg(windows)]
    pub use crate::windows_sys::{STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};
    #[cfg(windows)]
    pub fn is_stdio_handle(id: u32, handle: *mut c_void) -> bool {
        match crate::windows_sys::GetStdHandle(id) {
            Some(h) => handle == h,
            None => false,
        }
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
    pub fn windows_process_parameters() -> ProcessParametersStdio {
        // PEB → ProcessParameters → {hStdInput,hStdOutput,hStdError}. Snapshot
        // the three handles by value (raw-pointer reads — no `&` formed over
        // OS-mutable memory) so the call site is safe.
        // SAFETY: PEB and ProcessParameters are process-lifetime; the three
        // handle fields are at fixed asserted offsets (`windows_sys`). Reading
        // a `*mut c_void` is `Copy` and atomic on x64.
        unsafe {
            let pp = (*crate::windows_sys::peb()).ProcessParameters;
            ProcessParametersStdio {
                hStdInput: (*pp).hStdInput as *mut c_void,
                hStdOutput: (*pp).hStdOutput as *mut c_void,
                hStdError: (*pp).hStdError as *mut c_void,
            }
        }
    }
    #[cfg(windows)]
    pub fn windows_current_directory_handle() -> *mut c_void {
        // Zig spec (`fd.zig:70`): `FD.cwd() = .fromNative(std.fs.cwd().fd)`,
        // and Zig's `std.fs.cwd()` on Windows reads
        // `peb().ProcessParameters.CurrentDirectory.Handle`. Offset 0x48 on
        // x64, asserted in `bun_core::windows_sys`. The OS updates this handle
        // on `SetCurrentDirectoryW`, so re-read on every call rather than
        // caching.
        // SAFETY: PEB and ProcessParameters are process-lifetime; raw-pointer
        // read because the OS mutates the struct out-of-band (see `peb()` doc).
        unsafe {
            let pp = (*crate::windows_sys::peb()).ProcessParameters;
            (*pp).CurrentDirectory.Handle
        }
    }
}

// ─── FileKind / Mode / kind_from_mode (from bun_sys) ──────────────────────
// Zig: src/sys/sys.zig — pure S_IFMT arithmetic, no syscalls (libarchive_sys req).
pub type Mode = u32; // std.posix.mode_t

#[allow(non_snake_case)]
pub mod S {
    use super::Mode;

    pub const IFMT: Mode = 0o170000;
    pub const IFSOCK: Mode = 0o140000;
    pub const IFLNK: Mode = 0o120000;
    pub const IFREG: Mode = 0o100000;
    pub const IFBLK: Mode = 0o060000;
    pub const IFDIR: Mode = 0o040000;
    pub const IFCHR: Mode = 0o020000;
    pub const IFIFO: Mode = 0o010000;
    pub const IFWHT: Mode = 0o160000; // BSD/Darwin whiteout

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

    #[inline]
    pub const fn ISREG(m: Mode) -> bool {
        m & IFMT == IFREG
    }
    #[inline]
    pub const fn ISDIR(m: Mode) -> bool {
        m & IFMT == IFDIR
    }
    #[inline]
    pub const fn ISCHR(m: Mode) -> bool {
        m & IFMT == IFCHR
    }
    #[inline]
    pub const fn ISBLK(m: Mode) -> bool {
        m & IFMT == IFBLK
    }
    #[inline]
    pub const fn ISFIFO(m: Mode) -> bool {
        m & IFMT == IFIFO
    }
    #[inline]
    pub const fn ISLNK(m: Mode) -> bool {
        m & IFMT == IFLNK
    }
    #[inline]
    pub const fn ISSOCK(m: Mode) -> bool {
        m & IFMT == IFSOCK
    }
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
        pub flush: unsafe fn(*mut Writer) -> Result<(), crate::Error>,
    }
    impl Writer {
        #[inline]
        pub fn write_all(&mut self, bytes: &[u8]) -> Result<(), crate::Error> {
            // SAFETY: `Writer` is the `repr(C)` head of every concrete adapter
            // (see type doc); `self` was produced by upcasting `&mut Adapter`,
            // so the vtable fn receives the same pointer it was registered with.
            unsafe { (self.write_all)(std::ptr::from_mut(self), bytes) }
        }
        #[inline]
        pub fn flush(&mut self) -> Result<(), crate::Error> {
            // SAFETY: `Writer` is the `repr(C)` head of every concrete adapter;
            // `self` is the same pointer the adapter registered its vtable with,
            // so the callee's downcast back to the concrete type is sound.
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
                    if self.1.is_err() {
                        Err(core::fmt::Error)
                    } else {
                        Ok(())
                    }
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

    use core::fmt;

    pub trait Write {
        /// Write the entire buffer. Zig: `writeAll`.
        fn write_all(&mut self, buf: &[u8]) -> Result<(), crate::Error>;

        /// Flush any internal buffer to the underlying sink. Zig: `flush`.
        /// Unbuffered sinks leave the default no-op.
        #[inline]
        fn flush(&mut self) -> Result<(), crate::Error> {
            Ok(())
        }

        #[inline]
        fn written_len(&self) -> usize {
            panic!("io::Write::written_len: writer does not track bytes written");
        }

        // ── provided helpers ────────────────────────────────────────────────

        /// Zig: `writeByte`.
        #[inline]
        fn write_byte(&mut self, byte: u8) -> Result<(), crate::Error> {
            self.write_all(core::slice::from_ref(&byte))
        }

        /// Convenience for UTF-8 string slices.
        #[inline]
        fn write_str(&mut self, s: &str) -> Result<(), crate::Error> {
            self.write_all(s.as_bytes())
        }

        /// Write `n` copies of `byte`. Zig: `splatByteAll` / `writeByteNTimes`.
        fn splat_byte_all(&mut self, byte: u8, n: usize) -> Result<(), crate::Error> {
            let chunk = [byte; 256];
            let mut remain = n;
            while remain > 0 {
                let take = remain.min(chunk.len());
                self.write_all(&chunk[..take])?;
                remain -= take;
            }
            Ok(())
        }

        /// Formatted write. Zig: `print(fmt, args)`. Enables `write!(w, ...)`.
        fn write_fmt(&mut self, args: fmt::Arguments<'_>) -> Result<(), crate::Error> {
            struct Bridge<'a, W: ?Sized> {
                sink: &'a mut W,
                err: Option<crate::Error>,
            }
            impl<W: Write + ?Sized> fmt::Write for Bridge<'_, W> {
                #[inline]
                fn write_str(&mut self, s: &str) -> fmt::Result {
                    match self.sink.write_all(s.as_bytes()) {
                        Ok(()) => Ok(()),
                        Err(e) => {
                            self.err = Some(e);
                            Err(fmt::Error)
                        }
                    }
                }
            }
            let mut bridge = Bridge {
                sink: self,
                err: None,
            };
            match fmt::write(&mut bridge, args) {
                Ok(()) => Ok(()),
                Err(_) => Err(bridge.err.unwrap_or_else(|| crate::err!("FmtError"))),
            }
        }

        /// Alias for [`write_fmt`](Write::write_fmt) under the Zig spelling.
        #[inline]
        fn print(&mut self, args: fmt::Arguments<'_>) -> Result<(), crate::Error> {
            self.write_fmt(args)
        }

        /// Write an integer in little-endian byte order.
        /// Zig: `writeInt(T, val, .little)`.
        #[inline]
        fn write_int_le<I: IntLe>(&mut self, val: I) -> Result<(), crate::Error>
        where
            Self: Sized,
        {
            self.write_all(val.to_le_bytes().as_ref())
        }
    }

    // ── blanket / std impls ─────────────────────────────────────────────────

    /// Forward through `&mut W` so `&mut dyn Write` / `&mut impl Write` nest.
    impl<W: Write + ?Sized> Write for &mut W {
        #[inline]
        fn write_all(&mut self, buf: &[u8]) -> Result<(), crate::Error> {
            (**self).write_all(buf)
        }
        #[inline]
        fn flush(&mut self) -> Result<(), crate::Error> {
            (**self).flush()
        }
        #[inline]
        fn write_byte(&mut self, byte: u8) -> Result<(), crate::Error> {
            (**self).write_byte(byte)
        }
        #[inline]
        fn splat_byte_all(&mut self, byte: u8, n: usize) -> Result<(), crate::Error> {
            (**self).splat_byte_all(byte, n)
        }
        #[inline]
        fn write_fmt(&mut self, args: fmt::Arguments<'_>) -> Result<(), crate::Error> {
            (**self).write_fmt(args)
        }
        #[inline]
        fn written_len(&self) -> usize {
            (**self).written_len()
        }
    }

    impl<W: Write + ?Sized> Write for Box<W> {
        #[inline]
        fn write_all(&mut self, buf: &[u8]) -> Result<(), crate::Error> {
            (**self).write_all(buf)
        }
        #[inline]
        fn flush(&mut self) -> Result<(), crate::Error> {
            (**self).flush()
        }
        #[inline]
        fn written_len(&self) -> usize {
            (**self).written_len()
        }
    }

    /// In-memory growable sink. Zig: `std.Io.Writer.Allocating`.
    impl<A: core::alloc::Allocator> Write for Vec<u8, A> {
        #[inline]
        fn write_all(&mut self, buf: &[u8]) -> Result<(), crate::Error> {
            self.extend_from_slice(buf);
            Ok(())
        }
        #[inline]
        fn written_len(&self) -> usize {
            self.len()
        }
    }

    impl<'a> Write for bun_alloc::BabyVec<'a, u8> {
        #[inline]
        fn write_all(&mut self, buf: &[u8]) -> Result<(), crate::Error> {
            self.extend_from_slice(buf);
            Ok(())
        }
        #[inline]
        fn written_len(&self) -> usize {
            self.len()
        }
    }

    /// Bridge the type-erased vtable header into the generic `Write` trait so
    /// printers taking `W: io::Write` accept process stdout/stderr sinks.
    impl Write for Writer {
        #[inline]
        fn write_all(&mut self, buf: &[u8]) -> Result<(), crate::Error> {
            // SAFETY: `self` is the `repr(C)` adapter head; the vtable fn
            // receives the same pointer it was registered with (see type doc).
            unsafe { (self.write_all)(core::ptr::from_mut(self), buf) }
        }
        #[inline]
        fn flush(&mut self) -> Result<(), crate::Error> {
            // SAFETY: `self` is the `repr(C)` adapter head; the vtable fn
            // receives the same pointer it was registered with (see type doc).
            unsafe { (self.flush)(core::ptr::from_mut(self)) }
        }
    }

    // ── IntLe — little-endian integer encoding helper ───────────────────────

    /// Integers that can be written little-endian via [`Write::write_int_le`].
    pub trait IntLe: Copy {
        type Bytes: AsRef<[u8]> + AsMut<[u8]> + Default;
        fn to_le_bytes(self) -> Self::Bytes;
        fn from_le_bytes(bytes: Self::Bytes) -> Self;
    }

    macro_rules! impl_int_le {
        ($($t:ty),* $(,)?) => {$(
            impl IntLe for $t {
                type Bytes = [u8; core::mem::size_of::<$t>()];
                #[inline]
                fn to_le_bytes(self) -> Self::Bytes { <$t>::to_le_bytes(self) }
                #[inline]
                fn from_le_bytes(bytes: Self::Bytes) -> Self { <$t>::from_le_bytes(bytes) }
            }
        )*};
    }
    impl_int_le!(
        u8, u16, u32, u64, u128, usize, i8, i16, i32, i64, i128, isize
    );
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

impl Version {
    pub const ZERO: Self = Self {
        major: 0,
        minor: 0,
        patch: 0,
    };

    pub const fn parse_dotted(bytes: &[u8]) -> Self {
        let mut nums = [0u32; 3];
        let mut idx = 0usize;
        let mut i = 0usize;
        while idx < 3 {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                nums[idx] = nums[idx]
                    .wrapping_mul(10)
                    .wrapping_add((bytes[i] - b'0') as u32);
                i += 1;
            }
            if i == start {
                break;
            }
            idx += 1;
            if i < bytes.len() && bytes[i] == b'.' {
                i += 1;
            } else {
                break;
            }
        }
        Self {
            major: nums[0],
            minor: nums[1],
            patch: nums[2],
        }
    }
}

#[repr(transparent)]
pub struct RacyCell<T: ?Sized>(core::cell::Cell<T>);
// SAFETY: by construction, callers promise external synchronization or
// single-thread access. Unlike std's nightly `SyncUnsafeCell` (which gates
// `Sync` on `T: Sync`), this impl is intentionally unconditional: many
// payloads ported from `static mut` are `!Sync` only by auto-trait inference
// (raw pointers, `MaybeUninit<T>` over FFI handles) yet are sound to share
// because all access is single-threaded or externally synchronized — the
// exact contract `static mut` already imposed. **Do not** wrap *payloads*
// whose `!Sync` is load-bearing (`Cell<U>`, `Rc<U>`, `RefCell<U>`); use
// `thread_local!` or a real lock for those. (The inner storage here is
// `Cell<T>` purely so `read`/`write` bodies are safe code — the cross-thread
// hazard is fully accounted for by this `unsafe impl Sync`.)
unsafe impl<T: ?Sized> Sync for RacyCell<T> {}
// SAFETY: `RacyCell<T>` owns a `T` by value via `Cell<T>`; sending the cell to
// another thread is sound exactly when sending `T` itself is (`T: Send`).
unsafe impl<T: ?Sized + Send> Send for RacyCell<T> {}

impl<T> RacyCell<T> {
    #[inline]
    pub const fn new(value: T) -> Self {
        Self(core::cell::Cell::new(value))
    }
    /// Raw pointer to the contained value. Never produces a reference; callers
    /// deref per-access (`unsafe { *X.get() }` / `unsafe { (*X.get()).field }`).
    #[inline]
    pub const fn get(&self) -> *mut T {
        self.0.as_ptr()
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
        self.0.get()
    }
    /// Convenience: overwrite the value.
    ///
    /// # Safety
    /// Caller guarantees no concurrent reader/writer on another thread.
    #[inline]
    pub unsafe fn write(&self, value: T) {
        self.0.set(value)
    }
}
impl<T: Default> Default for RacyCell<T> {
    fn default() -> Self {
        Self::new(T::default())
    }
}

pub struct ThreadLock {
    #[cfg(debug_assertions)]
    owning_thread: core::sync::atomic::AtomicU64,
    #[cfg(debug_assertions)]
    locked_at: core::cell::Cell<crate::StoredTrace>,
}
// SAFETY: `locked_at` is only written after `owning_thread.swap` proves the
// current thread is the unique acquirer; concurrent access panics first. The
// `Cell` is `!Sync` but the AcqRel `swap` on `owning_thread` is the lock that
// serializes its non-atomic load/store across threads.
unsafe impl Sync for ThreadLock {}
#[cfg(debug_assertions)]
const INVALID_THREAD_ID: u64 = 0;
impl ThreadLock {
    pub const fn init_unlocked() -> Self {
        Self {
            #[cfg(debug_assertions)]
            owning_thread: core::sync::atomic::AtomicU64::new(INVALID_THREAD_ID),
            #[cfg(debug_assertions)]
            locked_at: core::cell::Cell::new(crate::StoredTrace::EMPTY),
        }
    }
    #[inline]
    pub fn init_locked() -> Self {
        let s = Self::init_unlocked();
        s.lock();
        s
    }
    /// Zig `initLockedIfNonComptime` — Zig comptime evaluation has no thread;
    /// in Rust there is no comptime execution, so this is just `init_locked`.
    #[inline]
    pub fn init_locked_if_non_comptime() -> Self {
        Self::init_locked()
    }
    #[inline]
    pub fn guard(&self) -> ThreadLockGuard {
        self.lock();
        ThreadLockGuard(core::ptr::from_ref::<Self>(self))
    }
    /// Zig `lockOrAssert` — acquire if unlocked, else assert this thread holds it.
    #[inline]
    pub fn lock_or_assert(&self) {
        #[cfg(debug_assertions)]
        {
            let held = self
                .owning_thread
                .load(core::sync::atomic::Ordering::Acquire);
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
            let prev = self
                .owning_thread
                .swap(cur, core::sync::atomic::Ordering::AcqRel);
            if prev != INVALID_THREAD_ID {
                // Prior holder wrote `locked_at` after its `swap`; our AcqRel
                // swap observes it. Debug-only diagnostic on the panic path.
                let stored = self.locked_at.get();
                crate::dump_stack_trace(
                    &stored.trace(),
                    crate::DumpStackTraceOptions {
                        frame_count: 10,
                        stop_at_jsc_llint: true,
                        ..Default::default()
                    },
                );
                panic!("ThreadLock: thread {cur} tried to lock, already held by {prev}");
            }
            // swap above proved we are the unique acquirer (prev was INVALID);
            // no other thread can be in this branch concurrently.
            self.locked_at.set(crate::StoredTrace::capture(None));
        }
    }
    #[inline]
    pub fn unlock(&self) {
        #[cfg(debug_assertions)]
        {
            self.assert_locked(); // Zig: assert current thread holds it before reset.
            self.owning_thread
                .store(INVALID_THREAD_ID, core::sync::atomic::Ordering::Release);
            // assert_locked above proved we are the unique holder.
            self.locked_at.set(crate::StoredTrace::EMPTY);
        }
    }
    #[inline]
    pub fn assert_locked(&self) {
        #[cfg(debug_assertions)]
        {
            // Spec uses `bun.assertf` (always-on under ci_assert). Body is
            // already cfg-gated, so plain `assert!` — `debug_assert!` would be
            // redundant gating.
            let held = self
                .owning_thread
                .load(core::sync::atomic::Ordering::Acquire);
            assert!(held != INVALID_THREAD_ID, "`ThreadLock` is not locked");
            let current = thread_id();
            assert!(
                held == current,
                "`ThreadLock` is locked by thread {held}, not thread {current}",
            );
        }
    }
}

#[must_use = "dropping immediately unlocks the ThreadLock"]
pub struct ThreadLockGuard(*const ThreadLock);

impl Drop for ThreadLockGuard {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: `self.0` was `&ThreadLock` at `ThreadLock::guard()` and the
        // lock is a field of a struct the caller holds for the entire guard
        // scope; the pointee outlives the guard. `unlock` takes `&self`.
        unsafe { (*self.0).unlock() }
    }
}

/// OS thread id for debug-only ownership assertions (`ThreadLock`,
/// `ThreadCell`). `pub(crate)` so `atomic_cell` can reuse it; `#[doc(hidden)]`
/// because it is not part of `bun_core`'s public surface.
#[cfg(debug_assertions)]
#[doc(hidden)]
#[inline]
pub(crate) fn debug_thread_id() -> u64 {
    crate::thread_id::current() as u64
}

#[cfg(debug_assertions)]
#[inline]
fn thread_id() -> u64 {
    crate::thread_id::current() as u64
}

// ─── StackCheck (from bun.zig) ───────────────────────────────────────────
// Thin FFI wrapper; configure_thread() is all output.rs needs.
#[derive(Clone, Copy)]
pub struct StackCheck {
    cached_stack_end: usize,
}
unsafe extern "C" {
    /// No preconditions; initializes thread-local stack bookkeeping.
    safe fn Bun__StackCheck__initialize();
    /// No preconditions; returns the cached stack-bound pointer for this thread.
    safe fn Bun__StackCheck__getMaxStack() -> *mut core::ffi::c_void;
    #[cfg(unix)]
    safe fn clock_gettime(clk_id: libc::clockid_t, tp: &mut libc::timespec) -> core::ffi::c_int;
}
impl Default for StackCheck {
    /// Zig `.{}` — `cached_stack_end` defaults to `0`, so
    /// `is_safe_to_recurse()` always reports true until `init`/`update`.
    #[inline]
    fn default() -> Self {
        Self {
            cached_stack_end: 0,
        }
    }
}
impl StackCheck {
    #[inline]
    pub fn configure_thread() {
        Bun__StackCheck__initialize()
    }
    #[inline]
    pub fn init() -> Self {
        Self {
            cached_stack_end: Bun__StackCheck__getMaxStack() as usize,
        }
    }
    #[inline]
    pub fn update(&mut self) {
        self.cached_stack_end = Bun__StackCheck__getMaxStack() as usize;
    }
    /// Is there enough stack space to safely recurse?
    /// Zig: `> 256K` on Windows, `> 128K` elsewhere (bun.zig:3762).
    #[inline]
    pub fn is_safe_to_recurse(self) -> bool {
        // Zig uses `-|` (saturating sub): if probe < end (already past limit),
        // result saturates to 0 → "not safe". wrapping_sub would yield a huge
        // positive and incorrectly return true.
        let remaining = Self::frame_address().saturating_sub(self.cached_stack_end);
        let threshold: usize = if cfg!(windows) {
            256 * 1024
        } else {
            128 * 1024
        };
        remaining > threshold
    }

    #[inline]
    pub fn is_safe_to_recurse_with_extra(self, extra: usize) -> bool {
        let remaining = Self::frame_address().saturating_sub(self.cached_stack_end);
        let threshold: usize = if cfg!(windows) {
            256 * 1024
        } else {
            128 * 1024
        };
        remaining > threshold.saturating_add(extra)
    }

    #[inline(always)]
    fn frame_address() -> usize {
        #[cfg(target_arch = "x86_64")]
        {
            let sp: usize;
            // SAFETY: reading rsp is side-effect-free.
            unsafe {
                core::arch::asm!("mov {}, rsp", out(reg) sp, options(nomem, nostack, preserves_flags))
            };
            sp
        }
        #[cfg(target_arch = "aarch64")]
        {
            let sp: usize;
            // SAFETY: reading sp is side-effect-free.
            unsafe {
                core::arch::asm!("mov {}, sp", out(reg) sp, options(nomem, nostack, preserves_flags))
            };
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
// Small helpers from src/bun.zig that downstream crates need.
// ──────────────────────────────────────────────────────────────────────────

/// Zig `bun.Generation` (bun.zig:1926) — bumped each rebuild/rescan to
/// invalidate stale cache entries.
pub type Generation = u16;

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
    #[inline]
    pub const fn zero_based(self) -> core::ffi::c_int {
        self.0
    }
    #[inline]
    pub const fn one_based(self) -> core::ffi::c_int {
        self.0 + 1
    }
    /// Add two ordinal numbers together. Both are converted to zero-based before addition.
    #[inline]
    pub const fn add(self, b: Self) -> Self {
        Self::from_zero_based(self.0 + b.0)
    }
    /// Add a scalar value to an ordinal number.
    #[inline]
    pub const fn add_scalar(self, inc: core::ffi::c_int) -> Self {
        Self::from_zero_based(self.0 + inc)
    }
    #[inline]
    pub const fn is_valid(self) -> bool {
        self.0 >= 0
    }
}
impl Default for Ordinal {
    #[inline]
    fn default() -> Self {
        Self::INVALID
    }
}

const ONCE_UNINIT: u8 = 0;
const ONCE_BUSY: u8 = 1;
const ONCE_DONE: u8 = 2;

pub struct Once<T, F = ()> {
    state: core::sync::atomic::AtomicU8,
    cell: core::cell::UnsafeCell<core::mem::MaybeUninit<T>>,
    f: F,
}

// SAFETY: `T` is published behind a Release store / Acquire load pair; once
// DONE the cell is immutable and only `&T` is handed out, so the bounds match
// `std::sync::OnceLock` (`T: Send` because init may happen on a different
// thread than the reader; `T: Sync` because `&T` crosses threads).
unsafe impl<T: Send + Sync, F: Sync> Sync for Once<T, F> {}
// SAFETY: `Once<T, F>` owns a `T` (in `UnsafeCell<MaybeUninit<T>>`) and an
// `F` by value; sending the whole struct to another thread is sound exactly
// when sending its owned fields is (`T: Send`, `F: Send`).
unsafe impl<T: Send, F: Send> Send for Once<T, F> {}
impl<T: core::panic::RefUnwindSafe, F: core::panic::RefUnwindSafe> core::panic::RefUnwindSafe
    for Once<T, F>
{
}

#[cold]
#[inline(never)]
fn once_claim_slow(state: &core::sync::atomic::AtomicU8) -> bool {
    use core::sync::atomic::Ordering::Acquire;
    loop {
        match state.compare_exchange_weak(ONCE_UNINIT, ONCE_BUSY, Acquire, Acquire) {
            Ok(_) => return true,
            Err(ONCE_DONE) => return false,
            // BUSY (or spurious weak failure) — another thread is mid-init.
            // Startup is single-threaded in practice; spin-yield instead of
            // pulling in libstd's futex machinery.
            Err(_) => std::thread::yield_now(),
        }
    }
}

impl<T, F> Once<T, F> {
    /// Fast path: already initialised?
    #[inline(always)]
    pub fn get(&self) -> Option<&T> {
        if self.state.load(core::sync::atomic::Ordering::Acquire) == ONCE_DONE {
            // SAFETY: DONE is only stored after `cell` has been fully written;
            // the Acquire load synchronises with that Release store. The cell
            // is never mutated again for the process lifetime.
            Some(unsafe { (*self.cell.get()).assume_init_ref() })
        } else {
            None
        }
    }

    #[inline(always)]
    pub fn done(&self) -> bool {
        self.state.load(core::sync::atomic::Ordering::Acquire) == ONCE_DONE
    }

    /// `OnceLock::get_or_init` equivalent. Hot path is the inlined DONE check;
    /// the init closure runs at most once.
    #[inline(always)]
    pub fn get_or_init(&self, f: impl FnOnce() -> T) -> &T {
        if let Some(v) = self.get() {
            return v;
        }
        self.init_slow(f)
    }

    #[inline(never)]
    fn init_slow(&self, f: impl FnOnce() -> T) -> &T {
        if once_claim_slow(&self.state) {
            // Reset to UNINIT if `f` unwinds so a later retry isn't deadlocked
            // on a permanently-BUSY slot (Zig has no poisoning; neither do we).
            struct Reset<'a>(&'a core::sync::atomic::AtomicU8);
            impl Drop for Reset<'_> {
                #[inline]
                fn drop(&mut self) {
                    self.0
                        .store(ONCE_UNINIT, core::sync::atomic::Ordering::Release);
                }
            }
            let guard = Reset(&self.state);
            let v = f();
            // SAFETY: we hold BUSY exclusively (CAS won); no other thread can
            // be reading or writing `cell` until we publish DONE below.
            unsafe { (*self.cell.get()).write(v) };
            let _ = core::mem::ManuallyDrop::new(guard);
            self.state
                .store(ONCE_DONE, core::sync::atomic::Ordering::Release);
        }
        // SAFETY: either we just stored DONE, or `once_claim_slow` observed
        // DONE from another thread (Acquire in the CAS failure path).
        unsafe { (*self.cell.get()).assume_init_ref() }
    }

    #[inline]
    pub fn set(&self, value: T) -> Result<(), T> {
        use core::sync::atomic::Ordering::{Acquire, Release};
        if self
            .state
            .compare_exchange(ONCE_UNINIT, ONCE_BUSY, Acquire, Acquire)
            .is_ok()
        {
            // SAFETY: we hold BUSY exclusively; see `init_slow`.
            unsafe { (*self.cell.get()).write(value) };
            self.state.store(ONCE_DONE, Release);
            Ok(())
        } else {
            Err(value)
        }
    }
}

impl<T, F> Drop for Once<T, F> {
    #[inline]
    fn drop(&mut self) {
        if *self.state.get_mut() == ONCE_DONE {
            // SAFETY: DONE ⇒ cell holds a valid `T`; we have `&mut self`.
            unsafe { self.cell.get_mut().assume_init_drop() };
        }
    }
}

impl<T> Once<T, ()> {
    pub const fn new() -> Self {
        Self {
            state: core::sync::atomic::AtomicU8::new(ONCE_UNINIT),
            cell: core::cell::UnsafeCell::new(core::mem::MaybeUninit::uninit()),
            f: (),
        }
    }
    /// Run `f` exactly once; subsequent calls return the cached payload.
    #[inline(always)]
    pub fn call(&self, f: impl FnOnce() -> T) -> T
    where
        T: Copy,
    {
        *self.get_or_init(f)
    }
}
impl<T, A> Once<T, fn(A) -> T> {
    pub const fn with_fn(f: fn(A) -> T) -> Self {
        Self {
            state: core::sync::atomic::AtomicU8::new(ONCE_UNINIT),
            cell: core::cell::UnsafeCell::new(core::mem::MaybeUninit::uninit()),
            f,
        }
    }
    /// Run the stored fn exactly once with `arg`; returns a borrow of the cached
    /// payload. Bound to `&'static self` because every call site is a `static`.
    #[inline(always)]
    pub fn call(&'static self, arg: A) -> &'static T {
        let f = self.f;
        self.get_or_init(|| f(arg))
    }
}
impl<T> Default for Once<T, ()> {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

#[macro_export]
macro_rules! run_once {
    ($body:block) => {{
        static __ONCE: ::std::sync::Once = ::std::sync::Once::new();
        __ONCE.call_once(|| $body);
    }};
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Pollable {
    Ready,
    NotReady,
    Hup,
}
/// Zig `bun.PollFlag` — original name kept as an alias.
pub type PollFlag = Pollable;

impl Pollable {
    /// Zig `@tagName(rc)` — lowercase tag name for the `[sys]` debug log.
    #[inline]
    pub const fn tag_name(self) -> &'static str {
        match self {
            Pollable::Ready => "ready",
            Pollable::NotReady => "not_ready",
            Pollable::Hup => "hup",
        }
    }
}

// Zig `global_scope_log = sys.syslog` (bun.zig:636) → `Output.scoped(.SYS, .visible)`.
// bun_core sits below bun_sys, so we re-declare the scope locally instead of
// pulling `bun_sys::syslog!` (tier inversion). Same `[sys]` tag at runtime.
crate::declare_scope!(SYS, visible);

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
    let n = unsafe { libc::poll(polls.as_mut_ptr(), 1, 0) };
    let result = n > 0;
    let rc = if result && (polls[0].revents & (libc::POLLHUP | libc::POLLERR)) != 0 {
        Pollable::Hup
    } else if result {
        Pollable::Ready
    } else {
        Pollable::NotReady
    };
    crate::scoped_log!(
        SYS,
        "poll({}, .readable): {} ({}{})",
        fd,
        result,
        rc.tag_name(),
        if polls[0].revents & libc::POLLERR != 0 {
            " ERR "
        } else {
            ""
        },
    );
    rc
}
#[cfg(windows)]
pub fn is_readable(_fd: Fd) -> Pollable {
    // Zig bun.zig:639 — `@panic("TODO on Windows")`; no callers reach this on Windows.
    panic!("TODO on Windows");
}

/// Non-blocking `poll(fd, POLLOUT)` (or `WSAPoll` on Windows); reports writability.
#[cfg(not(windows))]
pub fn is_writable(fd: Fd) -> Pollable {
    debug_assert!(fd.is_valid());
    // bun.zig:692 — POLLOUT | POLLERR | POLLHUP.
    let mut polls = [libc::pollfd {
        fd: fd.native(),
        events: libc::POLLOUT | libc::POLLERR | libc::POLLHUP,
        revents: 0,
    }];
    // SAFETY: polls is a valid 1-element array; timeout 0 = non-blocking.
    let n = unsafe { libc::poll(polls.as_mut_ptr(), 1, 0) };
    let result = n > 0;
    let rc = if result && (polls[0].revents & (libc::POLLHUP | libc::POLLERR)) != 0 {
        Pollable::Hup
    } else if result {
        Pollable::Ready
    } else {
        Pollable::NotReady
    };
    crate::scoped_log!(
        SYS,
        "poll({}, .writable): {} ({}{})",
        fd,
        result,
        rc.tag_name(),
        if polls[0].revents & libc::POLLERR != 0 {
            " ERR "
        } else {
            ""
        },
    );
    rc
}
#[cfg(windows)]
pub fn is_writable(fd: Fd) -> Pollable {
    // Zig bun.zig:668-685 — WSAPoll(POLLWRNORM). bun_core can't depend on
    // bun_sys (tier inversion), so go to bun_windows_sys::ws2_32 directly.
    use bun_windows_sys::ws2_32;
    let mut polls = [ws2_32::WSAPOLLFD {
        // HANDLE → SOCKET pointer reinterpretation; matches Zig `fd.asSocketFd()`.
        fd: fd.native() as usize,
        events: ws2_32::POLLWRNORM,
        revents: 0,
    }];
    // SAFETY: polls is a valid 1-element WSAPOLLFD array; len=1 matches the buffer.
    let rc = unsafe { ws2_32::WSAPoll(polls.as_mut_ptr(), 1, 0) };
    let result = rc != ws2_32::SOCKET_ERROR && rc != 0;
    crate::scoped_log!(
        SYS,
        "poll({}) writable: {} ({})",
        fd,
        result,
        polls[0].revents
    );
    // PORT NOTE: faithful port of bun.zig:679 — yes, the `WRNORM`-set branch
    // returns `.hup` (not `.ready`). Kept verbatim to match upstream behaviour.
    if result && (polls[0].revents & ws2_32::POLLWRNORM) != 0 {
        Pollable::Hup
    } else if result {
        Pollable::Ready
    } else {
        Pollable::NotReady
    }
}

pub fn csprng(bytes: &mut [u8]) {
    #[cfg(any(target_os = "linux", target_os = "android"))]
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
                if err == libc::EINTR {
                    continue;
                }
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
            if rc != 0 {
                panic!("getentropy failed");
            }
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
            if ok == 0 {
                panic!("RtlGenRandom failed");
            }
        }
    }
}

// ── self_exe_path ─────────────────────────────────────────────────────────
// Port of `bun.selfExePath` (bun.zig:3011). Memoized into a process-lifetime
// static buffer; thread-safe via `Once`. Returns a `&'static ZStr`.
pub fn self_exe_path() -> Result<&'static ZStr, crate::Error> {
    static CELL: Once<Result<ZBox, crate::Error>> = Once::new();
    let r = CELL.get_or_init(|| {
        let path = std::env::current_exe().map_err(crate::Error::from)?;
        #[cfg(any(target_vendor = "apple", windows))]
        let path = path.canonicalize().unwrap_or(path);
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
            let mut s = path
                .into_os_string()
                .into_string()
                .unwrap_or_else(|os| os.to_string_lossy().into_owned());
            if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
                s = format!(r"\\{}", rest);
            } else if let Some(rest) = s.strip_prefix(r"\\?\") {
                s = rest.to_owned();
            }
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
    static CELL: Once<u16> = Once::new();
    *CELL.get_or_init(|| {
        const MAX: u16 = 1024;
        const MIN: u16 = 2;
        let from_env = || -> Option<u16> {
            for key in [
                crate::zstr!("UV_THREADPOOL_SIZE"),
                crate::zstr!("GOMAXPROCS"),
            ] {
                if let Some(v) = getenv_z(key) {
                    if let Ok(n) = crate::fmt::parse_int::<u16>(v.trim_ascii(), 10) {
                        if n >= MIN {
                            return Some(n.min(MAX));
                        }
                    }
                }
                #[cfg(windows)]
                if let Ok(s) = std::env::var(
                    // SAFETY: keys above are ASCII literals.
                    unsafe { core::str::from_utf8_unchecked(key.as_bytes()) },
                ) {
                    if let Ok(n) = s.trim().parse::<u16>() {
                        if n >= MIN {
                            return Some(n.min(MAX));
                        }
                    }
                }
            }
            None
        };
        let raw = from_env().unwrap_or_else(|| {
            unsafe extern "C" {
                safe fn WTF__numberOfProcessorCores() -> core::ffi::c_int;
            }
            WTF__numberOfProcessorCores().max(1) as u16
        });
        raw.clamp(MIN, MAX)
    })
}

#[inline]
pub fn errno_to_zig_err(errno: i32) -> crate::Error {
    debug_assert!(errno != 0);
    crate::Error::from_errno(errno)
}

pub mod time {
    // ns
    pub const NS_PER_US: u64 = 1_000;
    pub const NS_PER_MS: u64 = 1_000_000;
    pub const NS_PER_S: u64 = 1_000_000_000;
    pub const NS_PER_MIN: u64 = 60 * NS_PER_S;
    pub const NS_PER_HOUR: u64 = 60 * NS_PER_MIN;
    pub const NS_PER_DAY: u64 = 24 * NS_PER_HOUR;
    pub const NS_PER_WEEK: u64 = 7 * NS_PER_DAY;
    // us
    pub const US_PER_MS: u64 = 1_000;
    pub const US_PER_S: u64 = 1_000_000;
    // ms
    pub const MS_PER_S: u64 = 1_000;
    pub const MS_PER_DAY: u64 = 86_400_000;
    // s
    pub const S_PER_DAY: u32 = 86_400;

    /// `std.time.nanoTimestamp()` — wall-clock nanoseconds since the Unix epoch.
    #[inline]
    pub fn nano_timestamp() -> i128 {
        #[cfg(unix)]
        {
            let mut ts = libc::timespec {
                tv_sec: 0,
                tv_nsec: 0,
            };
            super::clock_gettime(libc::CLOCK_REALTIME, &mut ts);
            (ts.tv_sec as i128) * NS_PER_S as i128 + (ts.tv_nsec as i128)
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
    #[inline]
    pub fn milli_timestamp() -> i64 {
        (nano_timestamp() / NS_PER_MS as i128) as i64
    }
    /// `std.time.timestamp()` — wall-clock seconds since the Unix epoch.
    #[inline]
    pub fn timestamp() -> i64 {
        (nano_timestamp() / NS_PER_S as i128) as i64
    }

    /// `std.time.Timer` — monotonic stopwatch.
    #[derive(Clone, Copy, Debug)]
    pub struct Timer {
        start: std::time::Instant,
    }
    impl Timer {
        #[inline]
        pub fn start() -> Result<Self, crate::Error> {
            Ok(Self {
                start: std::time::Instant::now(),
            })
        }
        #[inline]
        pub fn read(&self) -> u64 {
            self.start.elapsed().as_nanos() as u64
        }
        #[inline]
        pub fn lap(&mut self) -> u64 {
            let now = std::time::Instant::now();
            let ns = now.duration_since(self.start).as_nanos() as u64;
            self.start = now;
            ns
        }
        #[inline]
        pub fn reset(&mut self) {
            self.start = std::time::Instant::now();
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EmbedKind {
    Codegen,
    CodegenEager,
    Src,
    SrcEager,
}

pub fn runtime_embed_file(_root: EmbedKind, sub_path: &'static str) -> &'static str {
    panic!(
        "runtime_embed_file({sub_path}): non-embedded debug load requires a per-site \
         static cache — migrate this call to `bun_core::runtime_embed_file!` or rebuild \
         with codegen_embed",
    );
}

#[doc(hidden)]
pub fn __runtime_embed_load(kind: EmbedKind, sub: &'static str) -> String {
    // SAFETY: CODEGEN_PATH/BASE_PATH originate from `option_env!` (`&'static str`
    // → bytes), so the bytes are valid UTF-8 by construction.
    let from = |b: &'static [u8]| unsafe { ::core::str::from_utf8_unchecked(b) };
    let mut p = match kind {
        EmbedKind::Codegen | EmbedKind::CodegenEager => {
            ::std::path::PathBuf::from(from(crate::build_options::CODEGEN_PATH))
        }
        EmbedKind::Src | EmbedKind::SrcEager => {
            let mut b = ::std::path::PathBuf::from(from(crate::build_options::BASE_PATH));
            b.push("src");
            b
        }
    };
    p.push(sub);
    ::std::fs::read_to_string(&p).unwrap_or_else(|e| {
        panic!(
            "Failed to load '{}': {e}\n\nTo improve iteration speed, some files are not embedded but loaded at runtime, at the cost of making the binary non-portable. To fix this, build with codegen_embed.",
            p.display(),
        )
    })
}

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
        static __CELL: $crate::Once<String> = $crate::Once::new();
        __CELL.get_or_init(|| $crate::__runtime_embed_load($kind, $sub)).as_str()
    }};
}

#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct StringPointer {
    pub offset: u32,
    pub length: u32,
}
impl StringPointer {
    #[inline]
    pub fn slice<'a>(self, buf: &'a [u8]) -> &'a [u8] {
        &buf[self.offset as usize..(self.offset + self.length) as usize]
    }
    #[inline]
    pub fn is_empty(self) -> bool {
        self.length == 0
    }
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

pub trait Hasher {
    fn update(&mut self, bytes: &[u8]);
}
// Blanket: anything that already is a `core::hash::Hasher` also satisfies
// Bun's Hasher (its `.write` IS the byte-feed).
impl<H: core::hash::Hasher> Hasher for H {
    #[inline]
    fn update(&mut self, bytes: &[u8]) {
        self.write(bytes)
    }
}

/// Re-export so downstream crates can write `T: bun_core::NoUninit` without a
/// direct `bytemuck` dep.
pub use bytemuck::NoUninit;

#[inline]
pub fn bytes_of<T: bytemuck::NoUninit>(v: &T) -> &[u8] {
    bytemuck::bytes_of(v)
}

#[inline]
pub fn bytes_of_mut<T: bytemuck::Pod>(v: &mut T) -> &mut [u8] {
    bytemuck::bytes_of_mut(v)
}

#[inline]
pub fn cast_slice<A: bytemuck::NoUninit, B: bytemuck::AnyBitPattern>(a: &[A]) -> &[B] {
    bytemuck::cast_slice(a)
}

#[inline]
pub fn cast_slice_mut<A: bytemuck::Pod, B: bytemuck::Pod>(a: &mut [A]) -> &mut [B] {
    bytemuck::cast_slice_mut(a)
}

#[inline]
pub fn slice_as_bytes<T: bytemuck::NoUninit>(s: &[T]) -> &[u8] {
    bytemuck::cast_slice(s)
}

#[macro_export]
macro_rules! extern_union_accessors {
    (
        tag: $tag_field:ident as $TagTy:ident, value: $value_field:ident;
        $($arms:tt)*
    ) => {
        $crate::extern_union_accessors!(@arms [$tag_field, $TagTy, $value_field] $($arms)*);
    };

    // arm: accessor name == union-field name, ro only
    (@arms [$tf:ident, $TT:ident, $vf:ident]
        $Variant:ident => $field:ident: $Ty:ty;
        $($rest:tt)*
    ) => {
        $crate::extern_union_accessors!(@emit_ro [$tf, $TT, $vf] $Variant, $field, $field, $Ty);
        $crate::extern_union_accessors!(@arms [$tf, $TT, $vf] $($rest)*);
    };
    // arm: accessor name == union-field name, ro + rw
    (@arms [$tf:ident, $TT:ident, $vf:ident]
        $Variant:ident => $field:ident: $Ty:ty, mut $field_mut:ident;
        $($rest:tt)*
    ) => {
        $crate::extern_union_accessors!(@emit_ro [$tf, $TT, $vf] $Variant, $field, $field, $Ty);
        $crate::extern_union_accessors!(@emit_rw [$tf, $TT, $vf] $Variant, $field, $field_mut, $Ty);
        $crate::extern_union_accessors!(@arms [$tf, $TT, $vf] $($rest)*);
    };
    // arm: accessor name ≠ union-field name (`accessor @ ufield`), ro only
    (@arms [$tf:ident, $TT:ident, $vf:ident]
        $Variant:ident => $accessor:ident @ $ufield:ident: $Ty:ty;
        $($rest:tt)*
    ) => {
        $crate::extern_union_accessors!(@emit_ro [$tf, $TT, $vf] $Variant, $ufield, $accessor, $Ty);
        $crate::extern_union_accessors!(@arms [$tf, $TT, $vf] $($rest)*);
    };
    // arm: accessor name ≠ union-field name, ro + rw
    (@arms [$tf:ident, $TT:ident, $vf:ident]
        $Variant:ident => $accessor:ident @ $ufield:ident: $Ty:ty, mut $accessor_mut:ident;
        $($rest:tt)*
    ) => {
        $crate::extern_union_accessors!(@emit_ro [$tf, $TT, $vf] $Variant, $ufield, $accessor, $Ty);
        $crate::extern_union_accessors!(@emit_rw [$tf, $TT, $vf] $Variant, $ufield, $accessor_mut, $Ty);
        $crate::extern_union_accessors!(@arms [$tf, $TT, $vf] $($rest)*);
    };
    (@arms [$tf:ident, $TT:ident, $vf:ident]) => {};

    (@emit_ro [$tf:ident, $TT:ident, $vf:ident] $Variant:ident, $ufield:ident, $accessor:ident, $Ty:ty) => {
        #[inline]
        pub fn $accessor(&self) -> &$Ty {
            debug_assert!(self.$tf == $TT::$Variant);
            // SAFETY: tag-guarded; `addr_of!` projects without forming an
            // intermediate `&Union`. Cast is identity for plain fields and
            // unwraps `ManuallyDrop<$Ty>` (repr(transparent)).
            unsafe { &*(::core::ptr::addr_of!(self.$vf.$ufield) as *const $Ty) }
        }
    };
    (@emit_rw [$tf:ident, $TT:ident, $vf:ident] $Variant:ident, $ufield:ident, $accessor_mut:ident, $Ty:ty) => {
        #[inline]
        pub fn $accessor_mut(&mut self) -> &mut $Ty {
            debug_assert!(self.$tf == $TT::$Variant);
            // SAFETY: tag-guarded; `&mut self` exclusive over union storage.
            unsafe { &mut *(::core::ptr::addr_of_mut!(self.$vf.$ufield) as *mut $Ty) }
        }
    };
}

#[inline]
pub fn write_any_to_hasher<H: Hasher + ?Sized, T: AsBytes>(hasher: &mut H, thing: T) {
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
                bytemuck::bytes_of(self)
            }
        }
    )* }
}
as_bytes_pod!(
    u8, i8, u16, i16, u32, i32, u64, i64, usize, isize, u128, i128
);
impl<T: AsBytes> AsBytes for &T {
    #[inline]
    fn as_bytes_for_hash(&self) -> &[u8] {
        (**self).as_bytes_for_hash()
    }
}

#[repr(transparent)]
pub struct GenericIndex<I, M = ()>(I, core::marker::PhantomData<M>);

impl<I: Copy, M> Clone for GenericIndex<I, M> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<I: Copy, M> Copy for GenericIndex<I, M> {}
impl<I: PartialEq, M> PartialEq for GenericIndex<I, M> {
    #[inline]
    fn eq(&self, o: &Self) -> bool {
        self.0 == o.0
    }
}
impl<I: Eq, M> Eq for GenericIndex<I, M> {}
impl<I: core::hash::Hash, M> core::hash::Hash for GenericIndex<I, M> {
    #[inline]
    fn hash<H: core::hash::Hasher>(&self, h: &mut H) {
        self.0.hash(h)
    }
}
impl<I: core::fmt::Display, M> core::fmt::Display for GenericIndex<I, M> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.0.fmt(f)
    }
}
impl<I: core::fmt::Debug, M> core::fmt::Debug for GenericIndex<I, M> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.0.fmt(f)
    }
}
/// `Default` = index 0 (matches the hand-rolled `#[derive(Default)]` newtypes
/// this replaced). NOT the `Optional::none` sentinel.
impl<I: Default, M> Default for GenericIndex<I, M> {
    #[inline]
    fn default() -> Self {
        Self(I::default(), core::marker::PhantomData)
    }
}

impl<I: GenericIndexInt, M> GenericIndex<I, M> {
    /// Prefer over a raw cast — asserts `int != MAX` (would alias `.none`).
    #[inline]
    pub fn init(int: I) -> Self {
        debug_assert!(
            int != I::NULL_VALUE,
            "GenericIndex::init: maxInt is reserved for Optional::none"
        );
        Self(int, core::marker::PhantomData)
    }
    #[inline]
    pub fn get(self) -> I {
        debug_assert!(
            self.0 != I::NULL_VALUE,
            "GenericIndex::get: corrupted (== none sentinel)"
        );
        self.0
    }
    /// `get()` widened to `usize` for slice indexing — covers the common
    /// `idx.get() as usize` site shape.
    #[inline]
    pub fn get_usize(self) -> usize {
        I::to_usize(self.get())
    }
    /// `init()` from a `usize` source (Vec length etc.). Debug-panics on
    /// truncation, mirroring Zig `@intCast`.
    #[inline]
    pub fn from_usize(n: usize) -> Self {
        Self::init(I::from_usize(n))
    }
    #[inline]
    pub fn to_optional(self) -> GenericIndexOptional<I, M> {
        GenericIndexOptional(self.0, core::marker::PhantomData)
    }
    #[inline]
    pub fn sort_fn_asc(_: (), a: &Self, b: &Self) -> bool {
        a.0 < b.0
    }
}
impl<I: GenericIndexInt, M> GenericIndexOptional<I, M> {
    #[inline]
    pub fn is_none(self) -> bool {
        self.0 == I::NULL_VALUE
    }
    #[inline]
    pub fn is_some(self) -> bool {
        !self.is_none()
    }
}

/// `GenericIndex::Optional` — `MAX` is `none`.
#[repr(transparent)]
pub struct GenericIndexOptional<I, M = ()>(I, core::marker::PhantomData<M>);
impl<I: Copy, M> Clone for GenericIndexOptional<I, M> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<I: Copy, M> Copy for GenericIndexOptional<I, M> {}
impl<I: PartialEq, M> PartialEq for GenericIndexOptional<I, M> {
    #[inline]
    fn eq(&self, o: &Self) -> bool {
        self.0 == o.0
    }
}
impl<I: Eq, M> Eq for GenericIndexOptional<I, M> {}
impl<I: core::fmt::Debug, M> core::fmt::Debug for GenericIndexOptional<I, M> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.0.fmt(f)
    }
}
impl<I: GenericIndexInt, M> GenericIndexOptional<I, M> {
    pub const NONE: Self = Self(I::NULL_VALUE, core::marker::PhantomData);
    #[inline]
    pub fn some(i: GenericIndex<I, M>) -> Self {
        i.to_optional()
    }
    /// Alias for `unwrap()` matching the local-newtype API that pre-existed in
    /// `bun_bundler::output_file::IndexOptional`.
    #[inline]
    pub fn get(self) -> Option<GenericIndex<I, M>> {
        self.unwrap()
    }
    #[inline]
    pub fn init(maybe: Option<I>) -> Self {
        match maybe {
            Some(i) => GenericIndex::<I, M>::init(i).to_optional(),
            None => Self::NONE,
        }
    }
    #[inline]
    pub fn unwrap(self) -> Option<GenericIndex<I, M>> {
        if self.0 == I::NULL_VALUE {
            None
        } else {
            Some(GenericIndex(self.0, core::marker::PhantomData))
        }
    }
    #[inline]
    pub fn unwrap_get(self) -> Option<I> {
        if self.0 == I::NULL_VALUE {
            None
        } else {
            Some(self.0)
        }
    }
}

/// Backing-integer bound for `GenericIndex` (replaces Zig's `comptime backing_int: type`).
pub trait GenericIndexInt: Copy + Eq + PartialOrd {
    const NULL_VALUE: Self;
    fn to_usize(self) -> usize;
    fn from_usize(n: usize) -> Self;
}
macro_rules! generic_index_int { ($($t:ty),*) => { $(
    impl GenericIndexInt for $t {
        const NULL_VALUE: Self = <$t>::MAX;
        #[inline] fn to_usize(self) -> usize { self as usize }
        #[inline] fn from_usize(n: usize) -> Self {
            debug_assert!(n as u128 <= <$t>::MAX as u128, "GenericIndex::from_usize: truncation");
            n as Self
        }
    }
)* } }
generic_index_int!(u8, u16, u32, u64, usize, i32, i64);

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
    pub struct DefaultPrng {
        s: [u64; 4],
    }
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
        let mut prng = p
            .take()
            .unwrap_or_else(|| rand::DefaultPrng::init(random_seed()));
        let v = prng.next_u64();
        p.set(Some(prng));
        v
    })
}

// ── hash ──────────────────────────────────────────────────────────────────
// `bun.hash` (Wyhash) lives in deprecated.rs as RapidHash; this module adds
// the xxhash64 entry point that ETag/bundler need.
pub mod hash {
    pub use bun_hash::XxHash64;
    /// `std.hash.XxHash64.hash(seed, bytes)`.
    #[inline]
    pub fn xxhash64(seed: u64, bytes: &[u8]) -> u64 {
        bun_hash::XxHash64::hash(seed, bytes)
    }
    /// Wyhash one-shot (Zig `bun.hash`).
    #[inline]
    pub fn wyhash(bytes: &[u8]) -> u64 {
        crate::deprecated::RapidHash::hash(0, bytes)
    }
}

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
        source_len.div_ceil(3) * 4
    }

    /// `std.base64.standard.Encoder.encode` returning the written sub-slice.
    pub fn standard_encode<'a>(dest: &'a mut [u8], source: &[u8]) -> &'a [u8] {
        let n = encode(dest, source);
        &dest[..n]
    }

    /// Result of a decode-into-buffer call.
    #[derive(Clone, Copy, Debug)]
    pub struct DecodeResult {
        pub written: usize,
        pub fail: bool,
    }

    /// `bun.base64.decode`. Scalar fallback (PERF(port): simdutf path in
    /// bun_base64). Tolerates missing padding; stops at first invalid char.
    pub fn decode(dest: &mut [u8], source: &[u8]) -> DecodeResult {
        const INV: u8 = 0xFF;
        static LUT: [u8; 256] = {
            let mut t = [INV; 256];
            let mut i = 0u8;
            while i < 26 {
                t[(b'A' + i) as usize] = i;
                i += 1;
            }
            let mut i = 0u8;
            while i < 26 {
                t[(b'a' + i) as usize] = 26 + i;
                i += 1;
            }
            let mut i = 0u8;
            while i < 10 {
                t[(b'0' + i) as usize] = 52 + i;
                i += 1;
            }
            t[b'+' as usize] = 62;
            t[b'/' as usize] = 63;
            t
        };
        let mut w = 0usize;
        let mut acc: u32 = 0;
        let mut bits: u32 = 0;
        for &c in source {
            if c == b'=' || c == b'\n' || c == b'\r' {
                continue;
            }
            let v = LUT[c as usize];
            if v == INV {
                return DecodeResult {
                    written: w,
                    fail: true,
                };
            }
            acc = (acc << 6) | v as u32;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                if w >= dest.len() {
                    return DecodeResult {
                        written: w,
                        fail: true,
                    };
                }
                dest[w] = (acc >> bits) as u8;
                w += 1;
            }
        }
        DecodeResult {
            written: w,
            fail: false,
        }
    }
}

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

static ARGV_STORAGE: Once<Vec<ZBox>> = Once::new();
static ARGV_VIEW: Once<Vec<&'static ZStr>> = Once::new();
static ARGV: RacyCell<&'static [&'static ZStr]> = RacyCell::new(&[]);
static ARGV_INIT: std::sync::Once = std::sync::Once::new();

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
/// [`argv()`] has been observed is a logic error — the `Once` slot will
/// already have been populated from the fallback path.
pub unsafe fn init_argv(argc: core::ffi::c_int, argv: *const *const core::ffi::c_char) {
    OS_ARGC.store(argc.max(0) as usize, core::sync::atomic::Ordering::Relaxed);
    OS_ARGV.store(argv.cast_mut(), core::sync::atomic::Ordering::Relaxed);
}

/// Kernel-provided argv slice if [`init_argv`] was called, else `None`.
#[inline]
#[cfg(not(windows))]
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
        #[cfg(windows)]
        {
            use bun_windows_sys::externs::{CommandLineToArgvW, GetCommandLineW};
            let mut argc: core::ffi::c_int = 0;
            // SAFETY: `GetCommandLineW` returns a process-static buffer;
            // `CommandLineToArgvW` allocates its own array (lifetime managed
            // by the system per Zig spec — intentionally not `LocalFree`d, the
            // argv strings are referenced for the process lifetime).
            let argvw = unsafe { CommandLineToArgvW(GetCommandLineW(), &mut argc) };
            if !argvw.is_null() {
                let argc = argc.max(0) as usize;
                // SAFETY: `CommandLineToArgvW` returned `argc` valid `LPWSTR`s.
                let argvw = unsafe { core::slice::from_raw_parts(argvw, argc) };
                return argvw
                    .iter()
                    .map(|&p| {
                        // SAFETY: each entry is a NUL-terminated UTF-16 string
                        // owned by the `CommandLineToArgvW` allocation.
                        let arg = unsafe { crate::ffi::wstr_units(p) };
                        ZBox::from_vec(crate::strings::to_utf8_alloc(arg))
                    })
                    .collect();
            }
            // Fall through to `args_os` if `CommandLineToArgvW` failed (OOM /
            // INVAL) — Zig returns an error there; we degrade to libstd's
            // own `GetCommandLineW`-backed parser instead of aborting.
        }
        #[cfg(not(windows))]
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
        std::env::args_os()
            .map(|a| ZBox::from_vec_with_nul(a.into_encoded_bytes()))
            .collect()
    })
}

#[cold]
#[inline(never)]
fn argv_view_init() {
    let storage: &'static [ZBox] = argv_storage();
    // ARGV_STORAGE is process-static via `Once`; `as_zstr` borrows for `'static`.
    let mut view: Vec<&'static ZStr> = storage.iter().map(ZBox::as_zstr).collect();
    // Zig `initArgv`: splice BUN_OPTIONS tokens after argv[0].
    if let Some(opts) = crate::env_var::BUN_OPTIONS.get() {
        let original_len = view.len();
        append_options_env::<&'static ZStr>(opts, &mut view);
        set_bun_options_argc(view.len() - original_len);
    }
    let view: &'static [&'static ZStr] = ARGV_VIEW.get_or_init(move || view);
    // SAFETY: single-threaded lazy init guarded by Once.
    unsafe { ARGV.write(view) };
}

#[inline]
fn argv_view() -> &'static [&'static ZStr] {
    ARGV_INIT.call_once(argv_view_init);
    // SAFETY: ARGV is a Copy fat-pointer; only mutated via `set_argv` during
    // single-threaded startup or by the Once above.
    unsafe { ARGV.read() }
}

#[derive(Clone, Copy)]
pub struct Argv(&'static [&'static ZStr]);
impl Argv {
    #[inline]
    pub fn len(&self) -> usize {
        self.0.len()
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    #[inline]
    pub fn get(&self, i: usize) -> Option<&'static ZStr> {
        self.0.get(i).copied()
    }
    #[inline]
    pub fn iter(&self) -> ArgvIter {
        ArgvIter {
            inner: self.0,
            i: 0,
        }
    }
    /// Borrow the underlying `[&ZStr]` view (Zig: `bun.argv[..]`).
    #[inline]
    pub fn as_slice(&self) -> &'static [&'static ZStr] {
        self.0
    }
    /// Owned `Vec` copy of the view — used by call sites that need to append
    /// (e.g. `--compile` exec-argv splicing) before leaking + `set_argv`.
    #[inline]
    pub fn to_vec(&self) -> Vec<&'static ZStr> {
        self.0.to_vec()
    }
}
impl IntoIterator for Argv {
    type Item = &'static [u8];
    type IntoIter = ArgvIter;
    #[inline]
    fn into_iter(self) -> ArgvIter {
        self.iter()
    }
}
pub struct ArgvIter {
    inner: &'static [&'static ZStr],
    i: usize,
}
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
#[inline]
pub fn argv() -> Argv {
    Argv(argv_view())
}

// ─── BUN_OPTIONS argv injection (bun.zig: bun_options_argc / appendOptionsEnv) ──
/// Number of arguments injected into `argv` by the `BUN_OPTIONS` environment
/// variable. Set once during single-threaded startup (`init_argv`).
static BUN_OPTIONS_ARGC: core::sync::atomic::AtomicUsize = core::sync::atomic::AtomicUsize::new(0);

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
/// `comptime ArgType` in `bun.appendOptionsEnv`). Impl'd for `bun_core::String`
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
        ZStr::from_slice_with_nul(z)
    }
    fn from_buf(mut buf: Vec<u8>) -> Self {
        buf.push(0);
        let z: &'static [u8] = buf.leak();
        ZStr::from_slice_with_nul(z)
    }
}

/// Owned `Box<ZStr>` arm of `appendOptionsEnv` — used by `bun::init_argv`'s
/// BUN_OPTIONS splice path, which stores argv entries as `Box<ZStr>`.
impl OptionsEnvArg for Box<ZStr> {
    fn from_slice(s: &[u8]) -> Self {
        ZStr::boxed(s)
    }
    fn from_buf(mut buf: Vec<u8>) -> Self {
        buf.push(0);
        let b: Box<[u8]> = buf.into_boxed_slice();
        // SAFETY: `ZStr` is `#[repr(transparent)]` over `[u8]`; the fat-pointer
        // metadata (len includes the trailing NUL) is preserved by the cast —
        // identical to `ZStr::boxed` but consuming the Vec without re-copying.
        unsafe { crate::heap::take(crate::heap::into_raw(b) as *mut ZStr) }
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

pub fn intern_argv(v: Vec<&'static ZStr>) -> &'static [&'static ZStr] {
    static SLOT: Once<Box<[&'static ZStr]>> = Once::new();
    SLOT.get_or_init(move || v.into_boxed_slice())
}

// ── getcwd ────────────────────────────────────────────────────────────────
/// Port of `bun.getcwd(buf)` → `Maybe([:0]u8)`. Writes into the caller's
/// `PathBuffer` and returns the NUL-terminated slice on success.
pub fn getcwd(buf: &mut PathBuffer) -> Result<&ZStr, crate::Error> {
    #[cfg(unix)]
    // SAFETY: `buf` provides `MAX_PATH_BYTES` writable bytes for `getcwd`; on
    // success the returned pointer aliases `buf` and is NUL-terminated, so
    // `strlen` reads in-bounds.
    unsafe {
        let p = libc::getcwd(buf.0.as_mut_ptr().cast(), buf.0.len());
        if p.is_null() {
            return Err(std::io::Error::last_os_error().into());
        }
        let len = libc::strlen(p);
        Ok(ZStr::from_buf(&buf.0, len))
    }
    #[cfg(windows)]
    {
        // Zig `bun.getcwd` → `std.posix.getcwd`, which on Windows wraps
        // `kernel32.GetCurrentDirectoryW` and transcodes WTF-16 → WTF-8.
        unsafe extern "system" {
            fn GetCurrentDirectoryW(nBufferLength: u32, lpBuffer: *mut u16) -> u32;
        }
        let mut wbuf = WPathBuffer::ZEROED;
        // SAFETY: `wbuf` has `PATH_MAX_WIDE` writable u16 units.
        let n = unsafe { GetCurrentDirectoryW(wbuf.0.len() as u32, wbuf.0.as_mut_ptr()) } as usize;
        if n == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        if n >= wbuf.0.len() {
            return Err(crate::err!(NameTooLong));
        }
        // WTF-16 → WTF-8 into the caller's `PathBuffer`. Surrogate pairs are
        // combined; unpaired surrogates are encoded as 3-byte WTF-8 (matches
        // Zig's `std.unicode.wtf16LeToWtf8`).
        let src = &wbuf.0[..n];
        let out = &mut buf.0;
        let mut wi = 0usize;
        let mut bi = 0usize;
        while wi < src.len() {
            let (cp, adv) = crate::strings::decode_wtf16_raw(&src[wi..]);
            wi += adv as usize;
            let mut tmp = [0u8; 4];
            let nb = crate::strings::encode_wtf8_rune(&mut tmp, cp);
            if bi + nb >= out.len() {
                return Err(crate::err!(NameTooLong));
            }
            out[bi..bi + nb].copy_from_slice(&tmp[..nb]);
            bi += nb;
        }
        out[bi] = 0;
        Ok(ZStr::from_buf(&buf.0[..], bi))
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = buf;
        Err(crate::err!(Unexpected))
    }
}

pub fn which<'a>(buf: &'a mut PathBuffer, path: &[u8], cwd: &[u8], bin: &[u8]) -> Option<&'a ZStr> {
    if bin.is_empty() {
        return None;
    }
    // If `bin` contains a separator, resolve relative to cwd only.
    let has_sep = bin.iter().copied().any(crate::path_sep::is_sep_native);
    let check = |buf: &mut PathBuffer, dir: &[u8], bin: &[u8]| -> Option<usize> {
        let mut n = 0usize;
        if !dir.is_empty() {
            if dir.len() + 1 + bin.len() + 1 > buf.0.len() {
                return None;
            }
            buf.0[..dir.len()].copy_from_slice(dir);
            n = dir.len();
            if buf.0[n - 1] != b'/' {
                buf.0[n] = b'/';
                n += 1;
            }
        }
        if n + bin.len() + 1 > buf.0.len() {
            return None;
        }
        buf.0[n..n + bin.len()].copy_from_slice(bin);
        n += bin.len();
        buf.0[n] = 0;
        #[cfg(unix)]
        // SAFETY: `buf.0[n] == 0` was just written, so `buf.0.as_ptr()` is a
        // valid NUL-terminated C string for `access(2)`.
        unsafe {
            if libc::access(buf.0.as_ptr().cast(), libc::X_OK) == 0 {
                return Some(n);
            }
        }
        #[cfg(not(unix))]
        {
            // TODO(port): Windows X_OK via GetFileAttributesW; defer to bun_which.
        }
        None
    };
    // Absolute `bin` → probe it directly without joining `cwd` (which.zig:35-42).
    if crate::path_sep::is_absolute_native(bin) {
        return check(buf, b"", bin).map(|n| ZStr::from_buf(&buf.0, n));
    }
    if has_sep {
        // Relative with separator → resolve against cwd only. Zig trims
        // trailing '/' from cwd and strips a leading "./" from bin.
        let cwd = {
            let mut c = cwd;
            while let [rest @ .., b'/'] = c {
                c = rest;
            }
            c
        };
        let bin = bin.strip_prefix(b"./").unwrap_or(bin);
        return check(buf, cwd, bin).map(|n| ZStr::from_buf(&buf.0, n));
    }
    // Bare names go straight to PATH (which.zig:44-63) — do NOT consult cwd.
    let delim: u8 = if cfg!(windows) { b';' } else { b':' };
    for dir in path.split(|&b| b == delim) {
        if dir.is_empty() {
            continue;
        }
        if let Some(n) = check(buf, dir, bin) {
            return Some(ZStr::from_buf(&buf.0, n));
        }
    }
    None
}

use core::sync::atomic::{AtomicBool, Ordering as AOrdering};
static AUTO_RELOAD_ON_CRASH: AtomicBool = AtomicBool::new(false);
static RELOAD_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
thread_local! {
    static RELOAD_IN_PROGRESS_ON_CURRENT_THREAD: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

#[inline]
pub fn auto_reload_on_crash() -> bool {
    AUTO_RELOAD_ON_CRASH.load(AOrdering::Relaxed)
}
#[inline]
pub fn set_auto_reload_on_crash(v: bool) {
    AUTO_RELOAD_ON_CRASH.store(v, AOrdering::Relaxed)
}

#[inline]
pub fn is_process_reload_in_progress_on_another_thread() -> bool {
    RELOAD_IN_PROGRESS.load(AOrdering::Relaxed)
        && !RELOAD_IN_PROGRESS_ON_CURRENT_THREAD.with(|c| c.get())
}

/// Zig: `bun.exitThread()` — terminate the current OS thread without unwinding.
/// POSIX `pthread_exit`; Windows `ExitThread`. Called from worker `shutdown()`.
pub fn exit_thread() -> ! {
    #[cfg(unix)]
    {
        unsafe extern "C" {
            safe fn pthread_exit(retval: *mut core::ffi::c_void) -> !;
        }
        pthread_exit(core::ptr::null_mut());
    }
    #[cfg(windows)]
    // `ExitThread` is declared `safe fn` in `bun_windows_sys::kernel32`.
    crate::windows_sys::kernel32::ExitThread(0);
    #[cfg(not(any(unix, windows)))]
    loop {
        core::hint::spin_loop();
    }
}

static THREAD_EXIT_POOL_DESTRUCTORS: Mutex<Vec<fn()>> = Mutex::new(Vec::new());

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
        exit_thread();
    }
    // Spin if pthread_exit was a no-op (pathological).
    while is_process_reload_in_progress_on_another_thread() {
        core::hint::spin_loop();
        #[cfg(unix)]
        {
            unsafe extern "C" {
                #[link_name = "nanosleep"]
                safe fn libc_nanosleep(
                    req: &libc::timespec,
                    rem: Option<&mut libc::timespec>,
                ) -> core::ffi::c_int;
            }
            let _ = libc_nanosleep(
                &libc::timespec {
                    tv_sec: 1,
                    tv_nsec: 0,
                },
                None,
            );
        }
    }
}

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
        use crate::windows_sys::kernel32::{GetCurrentProcess, GetLastError};
        unsafe extern "system" {
            // `h` is an opaque kernel HANDLE (never dereferenced in-process);
            // the kernel validates it and returns FALSE on a bad handle. No
            // memory-safety preconditions.
            safe fn TerminateProcess(h: *mut core::ffi::c_void, code: u32) -> i32;
        }
        // = 3224497970, bun.windows.watcher_reload_exit (windows.zig). Parent
        // watcher-manager compares the child's exit code against exactly this.
        const WATCHER_RELOAD_EXIT: u32 = 0xC031_EF32;
        let rc = TerminateProcess(GetCurrentProcess(), WATCHER_RELOAD_EXIT);
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
    // SAFETY: the FFI calls below (`on_before_reload_process_linux`, `execve`)
    // receive only locally-built NUL-terminated argv/envp arrays terminated by
    // a null pointer; on success `execve` never returns, on failure errno is
    // read. No borrowed Rust state is observed after the exec.
    unsafe {
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        {
            unsafe extern "C" {
                safe fn on_before_reload_process_linux();
            }
            on_before_reload_process_linux();
        }

        // We clone argv so that the memory address isn't the same as the libc one
        // (mirrors Zig `allocator.dupeZ` per entry).
        let args = argv_storage();
        let dupe_argv: Vec<ZBox> = args
            .iter()
            .map(|z| ZBox::from_vec_with_nul(z.as_bytes().to_vec()))
            .collect();
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
        let mut envp: Vec<*const core::ffi::c_char> = dupe_env.iter().map(|z| z.as_ptr()).collect();
        envp.push(core::ptr::null());

        // we must clone selfExePath in case argv[0] was not an absolute path
        let exec_path = self_exe_path().expect("unreachable").as_ptr();

        libc::execve(exec_path, newargv.as_ptr().cast(), envp.as_ptr().cast());
        // execve only returns on error.
        let errno = std::io::Error::last_os_error().raw_os_error().unwrap_or(-1);
        if may_return {
            crate::output::pretty_errorln(format_args!(
                "error: Failed to reload process: errno {}",
                errno
            ));
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

#[derive(Debug, Clone, Copy)]
pub struct SpawnStatus {
    pub code: i32,
}
impl SpawnStatus {
    #[inline]
    pub fn is_ok(self) -> bool {
        self.code == 0
    }
}

pub mod spawn_ffi {
    use core::ffi::{c_char, c_int};

    /// Matches `bun_spawn_request_file_action_t::kind`.
    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, Default)]
    pub enum FileActionType {
        #[default]
        None = 0,
        Close = 1,
        Dup2 = 2,
        Open = 3,
    }

    #[repr(C)]
    pub struct Action {
        pub kind: FileActionType,
        pub path: *const c_char,
        pub fds: [c_int; 2],
        pub flags: c_int,
        pub mode: c_int,
    }

    impl Default for Action {
        fn default() -> Self {
            Self {
                kind: FileActionType::None,
                path: core::ptr::null(),
                fds: [0; 2],
                flags: 0,
                mode: 0,
            }
        }
    }

    /// Matches `bun_spawn_file_action_list_t`.
    #[repr(C)]
    pub struct ActionsList {
        pub ptr: *const Action,
        pub len: usize,
    }

    impl Default for ActionsList {
        fn default() -> Self {
            Self {
                ptr: core::ptr::null(),
                len: 0,
            }
        }
    }

    /// Matches `bun_spawn_request_t`.
    #[repr(C)]
    pub struct BunSpawnRequest {
        pub chdir_buf: *const c_char,
        pub detached: bool,
        pub new_process_group: bool,
        pub actions: ActionsList,
        pub pty_slave_fd: c_int,
        pub linux_pdeathsig: c_int,
    }

    impl Default for BunSpawnRequest {
        fn default() -> Self {
            Self {
                chdir_buf: core::ptr::null(),
                detached: false,
                new_process_group: false,
                actions: ActionsList::default(),
                pty_slave_fd: -1,
                linux_pdeathsig: 0,
            }
        }
    }

    #[cfg(unix)]
    unsafe extern "C" {
        pub fn posix_spawn_bun(
            pid: *mut c_int,
            path: *const c_char,
            request: *const BunSpawnRequest,
            argv: *const *const c_char,
            envp: *const *const c_char,
        ) -> isize;
    }
}

pub fn spawn_sync_inherit(argv: &[impl AsRef<[u8]>]) -> Result<SpawnStatus, crate::Error> {
    #[cfg(unix)]
    // SAFETY: argv strings are owned `ZBox`es (NUL-terminated) kept alive in
    // `cargs` for the duration of the spawn; `ptrs`/`environ` are null-
    // terminated `*const c_char` arrays as required by `posix_spawn_bun` /
    // `posix_spawnp`. `waitpid` is passed a valid `&mut c_int` out-param.
    unsafe {
        let cargs: Vec<ZBox> = argv
            .iter()
            .map(|a| ZBox::from_vec_with_nul(a.as_ref().to_vec()))
            .collect();
        let mut ptrs: Vec<*const core::ffi::c_char> = cargs.iter().map(|z| z.as_ptr()).collect();
        ptrs.push(core::ptr::null());

        let environ = c_environ();

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

            // dup2(n, n) for fds 0..=2 — posix_spawn_bun's Dup2 same-fd path
            // clears CLOEXEC and bumps the close-range floor past stdio. An
            // empty actions list would start the close-range at fd 1.
            let inherit_stdio: [spawn_ffi::Action; 3] =
                core::array::from_fn(|fd| spawn_ffi::Action {
                    kind: spawn_ffi::FileActionType::Dup2,
                    fds: [fd as core::ffi::c_int, fd as core::ffi::c_int],
                    ..Default::default()
                });
            let req = spawn_ffi::BunSpawnRequest {
                actions: spawn_ffi::ActionsList {
                    ptr: inherit_stdio.as_ptr(),
                    len: inherit_stdio.len(),
                },
                ..Default::default()
            };
            let mut pid: core::ffi::c_int = 0;
            // SAFETY: exe/ptrs/environ are NUL-terminated; req layout matches C.
            let rc = spawn_ffi::posix_spawn_bun(
                &raw mut pid,
                exe,
                &raw const req,
                ptrs.as_ptr(),
                environ,
            );
            if rc != 0 {
                return Err(crate::Error::from_errno(rc as i32));
            }
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
            if rc != 0 {
                return Err(crate::Error::from_errno(rc));
            }
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
                if e == libc::EINTR {
                    continue;
                }
                return Err(crate::Error::from_errno(e));
            }
            break;
        }
        let code = if libc::WIFEXITED(status) {
            libc::WEXITSTATUS(status)
        } else {
            -1
        };
        Ok(SpawnStatus { code })
    }
    #[cfg(windows)]
    {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;

        // argv is WTF-8 (selfExePath etc.); decode to WTF-16 for CreateProcessW.
        fn to_os(b: &[u8]) -> OsString {
            let mut wbuf = vec![0u16; b.len() + 1];
            let n = crate::strings::convert_utf8_to_utf16_in_buffer(&mut wbuf, b).len();
            OsString::from_wide(&wbuf[..n])
        }

        let mut iter = argv.iter();
        let argv0 = iter.next().ok_or(crate::err!("FileNotFound"))?;
        let mut cmd = std::process::Command::new(to_os(argv0.as_ref()));
        for arg in iter {
            cmd.arg(to_os(arg.as_ref()));
        }
        // Inherit stdio + environ (Command default), matching Zig `.Inherit`.
        let status = cmd.status().map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => crate::err!("FileNotFound"),
            std::io::ErrorKind::PermissionDenied => crate::err!("AccessDenied"),
            _ => crate::Error::from(e),
        })?;
        let code = status.code().unwrap_or(-1);
        Ok(SpawnStatus { code })
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = argv;
        Err(crate::err!(Unexpected))
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Timespec {
    pub sec: i64,
    pub nsec: i64,
}
// SAFETY: two `i64` fields; all-zero is the epoch.
unsafe impl crate::ffi::Zeroable for Timespec {}
// SAFETY: `#[repr(C)]` with two `i64` fields → size 16, align 8, no padding,
// no interior mutability, `Copy + 'static`. Every byte is initialized.
unsafe impl bytemuck::NoUninit for Timespec {}

/// Lowercase alias (Zig spells it `bun.timespec`).
#[allow(non_camel_case_types)]
pub type timespec = Timespec;

impl Timespec {
    pub const EPOCH: Timespec = Timespec { sec: 0, nsec: 0 };
    const NS_PER_S: i64 = crate::time::NS_PER_S as i64;
    const NS_PER_MS: i64 = crate::time::NS_PER_MS as i64;

    #[inline]
    pub const fn new(sec: i64, nsec: i64) -> Self {
        Self { sec, nsec }
    }

    #[inline]
    pub fn eql(&self, other: &Timespec) -> bool {
        self == other
    }

    /// `self - other` (Zig: `duration`). Mimics C wrapping behaviour.
    pub fn duration(&self, other: &Timespec) -> Timespec {
        let mut sec = self.sec.wrapping_sub(other.sec);
        let mut nsec = self.nsec.wrapping_sub(other.nsec);
        if nsec < 0 {
            sec = sec.wrapping_sub(1);
            nsec = nsec.wrapping_add(Self::NS_PER_S);
        }
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
        if self.sec <= 0 {
            return self.nsec.max(0) as u64;
        }
        let s_ns = (self.sec as u64).saturating_mul(Self::NS_PER_S as u64);
        // Zig-exact (bun.zig:3313 returns maxInt(i64))
        s_ns.checked_add(self.nsec.max(0) as u64)
            .unwrap_or(i64::MAX as u64)
    }

    /// Signed nanoseconds (wrapping). Port of `bun.timespec.nsSigned`.
    #[inline]
    pub fn ns_signed(&self) -> i64 {
        let ns_per_sec = self.sec.wrapping_mul(Self::NS_PER_S);
        let ns_from_nsec = self.nsec.div_euclid(Self::NS_PER_MS);
        ns_per_sec.wrapping_add(ns_from_nsec)
    }

    /// Milliseconds (signed, wrapping).
    #[inline]
    pub fn ms(&self) -> i64 {
        self.sec
            .wrapping_mul(1000)
            .wrapping_add(self.nsec.div_euclid(Self::NS_PER_MS))
    }
    #[inline]
    pub fn ms_unsigned(&self) -> u64 {
        self.ns() / Self::NS_PER_MS as u64
    }

    #[inline]
    pub fn greater(&self, other: &Timespec) -> bool {
        self.order(other).is_gt()
    }

    pub fn add_ms(&self, interval: i64) -> Timespec {
        let sec_inc = interval / 1000;
        let nsec_inc = (interval % 1000) * Self::NS_PER_MS;
        let mut t = *self;
        t.sec = t.sec.wrapping_add(sec_inc);
        t.nsec = t.nsec.wrapping_add(nsec_inc);
        if t.nsec >= Self::NS_PER_S {
            t.sec = t.sec.wrapping_add(1);
            t.nsec -= Self::NS_PER_S;
        }
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
        t.nsec = t
            .nsec
            .wrapping_add(ms_remainder * Self::NS_PER_MS + nsec_inc);
        if t.nsec >= Self::NS_PER_S {
            t.sec = t.sec.wrapping_add(1);
            t.nsec -= Self::NS_PER_S;
        } else if t.nsec < 0 {
            t.sec = t.sec.wrapping_sub(1);
            t.nsec += Self::NS_PER_S;
        }
        t
    }

    #[inline]
    pub fn min(a: Timespec, b: Timespec) -> Timespec {
        if a.order(&b).is_lt() { a } else { b }
    }
    #[inline]
    pub fn max(a: Timespec, b: Timespec) -> Timespec {
        if a.order(&b).is_gt() { a } else { b }
    }

    /// `bun.timespec.orderIgnoreEpoch` (bun.zig:3405) — EPOCH = "no timeout", treated as +∞.
    pub fn order_ignore_epoch(a: Timespec, b: Timespec) -> core::cmp::Ordering {
        if a == b {
            return core::cmp::Ordering::Equal;
        }
        if a == Self::EPOCH {
            return core::cmp::Ordering::Greater;
        }
        if b == Self::EPOCH {
            return core::cmp::Ordering::Less;
        }
        a.order(&b)
    }
    /// `bun.timespec.minIgnoreEpoch` (bun.zig:3411).
    #[inline]
    pub fn min_ignore_epoch(self, b: Timespec) -> Timespec {
        if Self::order_ignore_epoch(self, b).is_lt() {
            self
        } else {
            b
        }
    }

    /// Construct from a signed nanosecond count. Euclidean division keeps
    /// `nsec ∈ [0, 1e9)` for negative inputs so `ns()`/`order()` round-trip.
    #[inline]
    pub const fn from_ns(ns: i64) -> Timespec {
        Timespec {
            sec: ns.div_euclid(Self::NS_PER_S),
            nsec: ns.rem_euclid(Self::NS_PER_S),
        }
    }

    #[inline]
    pub fn now(mode: TimespecMockMode) -> Timespec {
        if matches!(mode, TimespecMockMode::AllowMockedTime) {
            if let Some(ns) = mock_time::get() {
                return Timespec::from_ns(ns);
            }
        }
        Self::now_real()
    }
    /// Convenience for `now(AllowMockedTime)` (downstream short-name).
    #[inline]
    pub fn now_allow_mocked_time() -> Timespec {
        Self::now(TimespecMockMode::AllowMockedTime)
    }

    fn now_real() -> Timespec {
        #[cfg(unix)]
        {
            let mut ts = libc::timespec {
                tv_sec: 0,
                tv_nsec: 0,
            };
            clock_gettime(libc::CLOCK_MONOTONIC, &mut ts);
            Timespec {
                sec: ts.tv_sec,
                nsec: ts.tv_nsec,
            }
        }
        #[cfg(not(unix))]
        {
            let n = crate::time::nano_timestamp();
            Timespec {
                sec: (n / 1_000_000_000) as i64,
                nsec: (n % 1_000_000_000) as i64,
            }
        }
    }

    #[inline]
    pub fn since_now(&self, mode: TimespecMockMode) -> u64 {
        Self::now(mode).duration(self).ns()
    }
    #[inline]
    pub fn ms_from_now(mode: TimespecMockMode, interval: i64) -> Timespec {
        Self::now(mode).add_ms(interval)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TimespecMockMode {
    AllowMockedTime,
    ForceRealTime,
}

pub mod timespec_mode {
    pub use super::TimespecMockMode::*;
    pub type Mode = super::TimespecMockMode;
}

pub mod mock_time {
    use core::sync::atomic::{AtomicI64, Ordering};

    static MOCKED_TIME_NS: AtomicI64 = AtomicI64::new(i64::MIN);

    /// Set the mocked monotonic time (nanoseconds). Called by fake-timers.
    #[inline]
    pub fn set(ns: i64) {
        MOCKED_TIME_NS.store(ns, Ordering::Relaxed);
    }
    /// Clear the mocked time so `Timespec::now(AllowMockedTime)` reads the
    /// real clock again.
    #[inline]
    pub fn clear() {
        MOCKED_TIME_NS.store(i64::MIN, Ordering::Relaxed);
    }
    /// Current mocked time, or `None` if not mocked.
    #[inline]
    pub fn get() -> Option<i64> {
        let v = MOCKED_TIME_NS.load(Ordering::Relaxed);
        if v == i64::MIN { None } else { Some(v) }
    }
}

#[allow(non_camel_case_types)]
#[repr(transparent)]
#[derive(Clone, Copy, PartialEq, Eq, Default, Debug)]
pub struct f16(pub u16);

impl f16 {
    #[inline]
    pub const fn from_bits(bits: u16) -> Self {
        Self(bits)
    }
    #[inline]
    pub const fn to_bits(self) -> u16 {
        self.0
    }

    /// Widen to `f64` (exact). Port of Zig `@floatCast(f64, h)`.
    pub fn to_f64(self) -> f64 {
        let h = self.0 as u32;
        let sign = (h >> 15) & 1;
        let exp = (h >> 10) & 0x1F;
        let frac = h & 0x3FF;
        let signf = if sign != 0 { -1.0 } else { 1.0 };
        if exp == 0 {
            if frac == 0 {
                return signf * 0.0;
            }
            // subnormal: 2^-14 * (frac / 1024)
            return signf * (frac as f64) * 2.0_f64.powi(-24);
        }
        if exp == 0x1F {
            return if frac == 0 {
                signf * f64::INFINITY
            } else {
                f64::NAN
            };
        }
        signf * (1.0 + (frac as f64) / 1024.0) * 2.0_f64.powi(exp as i32 - 15)
    }
}
impl From<f16> for f64 {
    #[inline]
    fn from(h: f16) -> f64 {
        h.to_f64()
    }
}
impl From<f16> for f32 {
    #[inline]
    fn from(h: f16) -> f32 {
        h.to_f64() as f32
    }
}
// SAFETY: `#[repr(transparent)]` over `u16` — every bit pattern is a valid
// `f16`, no padding, `Copy + 'static`. Enables safe `bytemuck::cast_slice`
// from `&[u8]` for Float16Array printing (ConsoleObject).
unsafe impl bytemuck::Zeroable for f16 {}
// SAFETY: `#[repr(transparent)]` over `u16` — no padding, every bit pattern is
// valid, `Copy + Zeroable + 'static`; satisfies all `bytemuck::Pod` invariants.
unsafe impl bytemuck::Pod for f16 {}
impl core::fmt::Display for f16 {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        self.to_f64().fmt(f)
    }
}

pub mod perf {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    use core::sync::atomic::AtomicBool;
    use core::sync::atomic::{AtomicU8, Ordering};
    #[cfg(any(target_os = "linux", target_os = "android"))]
    use std::sync::Once;

    /// Per-span state returned by `trace()`. `end()` is idempotent; `Drop`
    /// calls it so `let _t = trace("x");` works as a scope guard.
    #[must_use = "bind to a local (`let _t = perf::trace(..)`) so the span has nonzero duration"]
    pub struct Ctx {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        linux: Option<Linux>,
    }
    impl Ctx {
        pub const DISABLED: Ctx = Ctx {
            #[cfg(any(target_os = "linux", target_os = "android"))]
            linux: None,
        };
        #[inline]
        pub fn end(&mut self) {
            #[cfg(any(target_os = "linux", target_os = "android"))]
            if let Some(l) = self.linux.take() {
                l.end();
            }
        }
    }
    impl Drop for Ctx {
        #[inline]
        fn drop(&mut self) {
            self.end();
        }
    }

    const UNSET: u8 = 0;
    const DISABLED: u8 = 1;
    const ENABLED: u8 = 2;
    static IS_ENABLED: AtomicU8 = AtomicU8::new(UNSET);

    #[cold]
    fn is_enabled_init() -> bool {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let on = crate::env_var::feature_flag::BUN_TRACE
            .get()
            .unwrap_or(false)
            && Linux::is_supported();
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
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
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            return Ctx {
                linux: Some(Linux::init(name)),
            };
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            let _ = name;
            Ctx::DISABLED
        }
    }

    // ── Linux ftrace backend (folded from src/perf/lib.rs) ────────────────
    #[cfg(any(target_os = "linux", target_os = "android"))]
    struct Linux {
        start_time: u64,
        name: &'static str,
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    impl Linux {
        fn is_supported() -> bool {
            static INIT_ONCE: Once = Once::new();
            static IS_INITIALIZED: AtomicBool = AtomicBool::new(false);
            INIT_ONCE.call_once(|| {
                let r = sys::Bun__linux_trace_init();
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
            if !Self::is_supported() {
                return;
            }
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
                sys::Bun__linux_trace_emit(
                    buf.as_ptr().cast::<core::ffi::c_char>(),
                    i64::try_from(duration).unwrap_or(i64::MAX),
                )
            };
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub mod sys {
        unsafe extern "C" {
            /// No preconditions; returns 0/1 based on tracefs availability.
            pub safe fn Bun__linux_trace_init() -> core::ffi::c_int;
            /// No preconditions.
            pub safe fn Bun__linux_trace_close();
            pub fn Bun__linux_trace_emit(
                event_name: *const core::ffi::c_char,
                duration_ns: i64,
            ) -> core::ffi::c_int;
        }
    }
}

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
            if crate::strings_impl::includes(content_type, b"application/x-www-form-urlencoded") {
                return Some(Encoding::URLEncoded);
            }
            if !crate::strings_impl::includes(content_type, b"multipart/form-data") {
                return None;
            }
            let boundary = get_boundary(content_type)?;
            Some(Encoding::Multipart(Box::from(boundary)))
        }
    }

    pub fn get_boundary(content_type: &[u8]) -> Option<&[u8]> {
        let mut rest = content_type;
        loop {
            let semi = index_of_unquoted_semicolon(rest)?;
            rest = &rest[semi + 1..];
            let Some(begin) =
                crate::strings_impl::trim_left(rest, b" \t").strip_prefix(b"boundary=")
            else {
                continue;
            };
            if begin.is_empty() {
                return None;
            }
            let end = crate::strings_impl::index_of_char(begin, b';').unwrap_or(begin.len());
            if begin[0] == b'"' {
                if end > 1 && begin[end - 1] == b'"' {
                    return Some(&begin[1..end - 1]);
                }
                // Opening quote with no matching closing quote — malformed.
                return None;
            }
            return Some(&begin[..end]);
        }
    }

    /// Index of the next `;` in `s` that is not inside an RFC 7230
    /// quoted-string (`\` escapes the following byte inside quotes).
    fn index_of_unquoted_semicolon(s: &[u8]) -> Option<usize> {
        let mut in_quotes = false;
        let mut i = 0;
        while i < s.len() {
            match s[i] {
                b'"' => in_quotes = !in_quotes,
                b'\\' if in_quotes => i += 1,
                b';' if !in_quotes => return Some(i),
                _ => {}
            }
            i += 1;
        }
        None
    }

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
