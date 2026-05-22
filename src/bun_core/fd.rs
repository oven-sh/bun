// ─── Fd + fd module (from bun_sys::fd) ────────────────────────────────────
// TYPE_ONLY: bun_core needs only the handle wrapper + stdin/out/err/cwd ctors.
// Full method set (close, makeLibUVOwned, …) stays in bun_sys which re-exports
// `pub use bun_core::Fd as FD;` and adds inherent impls there.

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
    /// Native OS file descriptor (`fd_t`). On POSIX this is just the backing
    /// `c_int`. On Windows, when `kind == Uv`, calls `uv_get_osfhandle` to
    /// obtain the underlying HANDLE — so the returned value may not be safely
    /// closed via libc; use `FdExt::close()` instead.
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
            DecodeWindows::Uv(file_number) => uv_get_osfhandle(file_number),
        }
    }
    /// Borrow this `Fd` as a [`std::os::fd::BorrowedFd`] for handing to APIs
    /// (e.g. `rustix`) that speak the std I/O-safety types.
    ///
    /// The returned borrow is tied to `&self`'s lifetime. `Fd` is a plain
    /// `Copy` integer wrapper, so this does *not* by itself prevent the
    /// underlying descriptor from being closed elsewhere — it encodes the
    /// same "caller keeps the fd open for the duration of the call" contract
    /// every `bun_sys` syscall wrapper already relies on when accepting `Fd`
    /// by value.
    #[cfg(unix)]
    #[inline]
    pub fn as_borrowed_fd(&self) -> std::os::fd::BorrowedFd<'_> {
        let raw = self.native();
        // `BorrowedFd`'s niche is `-1`; constructing one with that value is
        // immediate UB regardless of later use. `Fd::INVALID` (i32::MIN) and
        // `Fd::cwd()` (AT_FDCWD, -100) are both ≠ -1, so the only way to hit
        // this is a caller explicitly wrapping a raw `-1`.
        assert!(raw != -1, "Fd::as_borrowed_fd on raw fd -1");
        // SAFETY: `raw != -1` (asserted above, satisfying `BorrowedFd`'s
        // niche). The "remains open for the borrow's lifetime" invariant is
        // the `Fd` type's contract — every API taking `Fd` requires the
        // caller to keep the descriptor open for the call, and the returned
        // borrow cannot outlive `&self`.
        unsafe { std::os::fd::BorrowedFd::borrow_raw(raw) }
    }
    /// libuv c_int file number. On POSIX this equals `native()`. On Windows,
    /// when kind=uv this extracts the stored uv_file; when kind=system this
    /// maps stdio handles to 0/1/2 (checking both the cached statics and the
    /// live `GetStdHandle` result) and **panics** otherwise — converting an
    /// arbitrary HANDLE to a uv fd makes closing impossible. The supplier
    /// should call `make_lib_uv_owned()` near where `open()` was called.
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
                // `.stdin()`/`.stdout()`/`.stderr()` hand out the cached
                // `WINDOWS_CACHED_STD{IN,OUT,ERR}` (snapshotted at startup),
                // so round-trip against those first. Comparing only against
                // the live `GetStdHandle` result panics if the process std
                // handle was swapped after startup via `SetStdHandle`,
                // `AllocConsole`, `AttachConsole`, etc.
                if Some(self) == WINDOWS_CACHED_STDIN.get().copied() {
                    return 0;
                }
                if Some(self) == WINDOWS_CACHED_STDOUT.get().copied() {
                    return 1;
                }
                if Some(self) == WINDOWS_CACHED_STDERR.get().copied() {
                    return 2;
                }
                if is_stdio_handle(STD_INPUT_HANDLE, handle) {
                    return 0;
                }
                if is_stdio_handle(STD_OUTPUT_HANDLE, handle) {
                    return 1;
                }
                if is_stdio_handle(STD_ERROR_HANDLE, handle) {
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
        WINDOWS_CACHED_STDIN.get().copied().unwrap_or(Fd::INVALID)
    }
    #[cfg(windows)]
    #[inline]
    pub fn stdout() -> Fd {
        WINDOWS_CACHED_STDOUT.get().copied().unwrap_or(Fd::INVALID)
    }
    #[cfg(windows)]
    #[inline]
    pub fn stderr() -> Fd {
        WINDOWS_CACHED_STDERR.get().copied().unwrap_or(Fd::INVALID)
    }
    #[cfg(windows)]
    #[inline]
    pub fn cwd() -> Fd {
        Fd::from_system(windows_current_directory_handle())
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
        is_stdio_handle(STD_INPUT_HANDLE, handle)
            || is_stdio_handle(STD_OUTPUT_HANDLE, handle)
            || is_stdio_handle(STD_ERROR_HANDLE, handle)
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
        {
            Ok(self)
        }
        #[cfg(windows)]
        match self.kind() {
            FdKind::Uv => Ok(self),
            FdKind::System => {
                let crt_fd = uv_open_osfhandle(self.native());
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
                    let p = windows_process_parameters();
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
        // Zig `bun.windows.GetFinalPathNameByHandle`: `if (return_length >=
        // out_buffer.len) return error.NameTooLong;` — `>=` because a return
        // value equal to `cap` is the buffer-too-small sentinel (required size
        // including NUL), not a successful write of `cap` chars.
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
    /// libuv: convert C-runtime fd → OS HANDLE. By-value `c_int` in, opaque
    /// HANDLE out — wraps `_get_osfhandle`, which validates the fd and
    /// returns `INVALID_HANDLE_VALUE` on a bad index. No memory-safety
    /// preconditions.
    pub safe fn uv_get_osfhandle(fd: c_int) -> *mut c_void;
    /// libuv: `_open_osfhandle(os_fd, 0)` — wraps a HANDLE in a CRT fd so
    /// libuv `uv_fs_*` (which speak `uv_file == int`) can use it. Returns
    /// `-1` on `EMFILE` (CRT fd table full) or invalid handle. The `*mut
    /// c_void` is an opaque kernel HANDLE, never dereferenced; no
    /// memory-safety preconditions.
    pub safe fn uv_open_osfhandle(os_fd: *mut c_void) -> c_int;
}
#[cfg(windows)]
pub use crate::windows_sys::{STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};
#[cfg(windows)]
pub fn is_stdio_handle(id: u32, handle: *mut c_void) -> bool {
    // Zig: `const h = std.os.windows.GetStdHandle(id) catch return false;
    // return handle == h;` — the Zig wrapper maps both NULL and
    // INVALID_HANDLE_VALUE to an error, so use the Option-returning
    // wrapper here. Without the INVALID_HANDLE_VALUE filter, a detached
    // console (GetStdHandle → INVALID_HANDLE_VALUE) compared against
    // `Fd::INVALID.native()` (= INVALID_HANDLE_VALUE) would spuriously
    // report a stdio match.
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
