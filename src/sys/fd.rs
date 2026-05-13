use core::ffi::{c_int, c_void};
use core::fmt;

use bun_core::Output;
// `Fd` (the packed handle struct + pure-data accessors) is canonical in
// bun_core. This file adds the syscall-touching surface as an extension trait.
pub use bun_core::{Fd, FdKind, FdNative, FdOptional as Optional, Stdio, fd};
/// Platform-native fd integer (`c_int` on POSIX, `HANDLE` on Windows). Alias
/// for callers porting Zig's `std.posix.fd_t` / `bun.FD.native()`.
pub type RawFd = FdNative;
#[cfg(windows)]
pub use bun_core::DecodeWindows;

use crate as sys;

// `log` in the Zig is `bun.sys.syslog`
bun_core::define_scoped_log!(log, SYS, visible);

/// `std.posix.fd_t` — `c_int` on POSIX, `HANDLE` on Windows. Same as `FdNative`.
pub type FdT = FdNative;
/// `bun.windows.libuv.uv_file` (c-runtime file descriptor); on POSIX this is also `c_int`.
pub type UvFile = c_int;

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum ErrorCase {
    CloseOnFail,
    LeakFdOnFail,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum MakeLibUvOwnedError {
    #[error("SystemFdQuotaExceeded")]
    SystemFdQuotaExceeded,
}
bun_core::named_error_set!(MakeLibUvOwnedError);

// ──────────────────────────────────────────────────────────────────────────
// FdExt — syscall-touching methods on `bun_core::Fd`.
//
// In Zig these were inherent methods on `bun.FD` (Zig allows `pub const close
// = bun.sys.close` aliasing). Rust can't impl inherent methods on a foreign
// type, so they live behind an extension trait. Import via
// `use bun_sys::FdExt;` at call sites; or call `bun_sys::close(fd)` directly.
// ──────────────────────────────────────────────────────────────────────────
pub trait FdExt: Copy + Sized {
    /// fd function will NOT CLOSE stdin/stdout/stderr.
    /// Expects a VALID file descriptor object.
    ///
    /// Do not use fd on JS-provided file descriptors (e.g. in `fs.closeSync`).
    /// For those cases, the developer may provide a faulty value, and we must
    /// forward EBADF to them. For internal situations, we should never hit
    /// EBADF since it means we could have replaced the file descriptor,
    /// closing something completely unrelated; fd would cause weird behavior
    /// as you see EBADF errors in unrelated places.
    fn close(self);
    /// fd function will NOT CLOSE stdin/stdout/stderr.
    /// Use fd API to implement `node:fs` close.
    /// Prefer asserting that EBADF does not happen with `.close()`.
    fn close_allowing_bad_file_descriptor(
        self,
        return_address: Option<usize>,
    ) -> Option<sys::Error>;
    /// fd allows you to close standard io. It also returns the error.
    /// Consider fd the raw close method.
    fn close_allowing_standard_io(self, return_address: Option<usize>) -> Option<sys::Error>;
    /// Assumes given a valid file descriptor. If error, the handle has not been closed.
    fn make_lib_uv_owned(self) -> Result<Fd, MakeLibUvOwnedError>;
    fn make_lib_uv_owned_for_syscall(
        self,
        syscall_tag: sys::Tag,
        error_case: ErrorCase,
    ) -> sys::Result<Fd>;
    fn make_path_u8(self, subpath: &[u8]) -> sys::Maybe<()>;
    fn delete_tree(self, subpath: &[u8]) -> Result<(), bun_core::Error>;
    fn as_socket_fd(self) -> sys::SocketT;
}

impl FdExt for Fd {
    fn close(self) {
        let err = self.close_allowing_bad_file_descriptor(None);
        debug_assert!(err.is_none()); // use after close!
    }

    fn close_allowing_bad_file_descriptor(
        self,
        return_address: Option<usize>,
    ) -> Option<sys::Error> {
        if self.stdio_tag().is_some() {
            log!("close({}) SKIPPED", self);
            return None;
        }
        self.close_allowing_standard_io(return_address)
    }

    fn close_allowing_standard_io(self, return_address: Option<usize>) -> Option<sys::Error> {
        debug_assert!(self.is_valid()); // probably a UAF

        // Format the file descriptor for logging BEFORE closing it.
        // Otherwise the file descriptor is always invalid after closing it.
        #[cfg(debug_assertions)]
        let mut fd_fmt_buf = [0u8; 1050];
        #[cfg(debug_assertions)]
        let fd_fmt: &[u8] = {
            // Zig: `std.fmt.bufPrint(&buf, "{f}", .{fd})` — stack slice, no heap.
            use std::io::Write as _;
            let mut cursor = std::io::Cursor::new(&mut fd_fmt_buf[..]);
            let _ = write!(cursor, "{}", self);
            let len = cursor.position() as usize;
            &fd_fmt_buf[..len]
        };

        let result: Option<sys::Error> = {
            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                debug_assert!(self.native() >= 0);
                // Raw `SYS_close` via rustix — no glibc wrapper (which is a
                // pthread cancellation point). fd.zig:266: never retry on EINTR.
                match sys::linux_syscall::close(self.native()) {
                    Err(e) if e == libc::EBADF => Some(sys::Error {
                        errno: sys::E::EBADF as _,
                        syscall: sys::Tag::close,
                        fd: self,
                        ..Default::default()
                    }),
                    _ => None,
                }
            }
            #[cfg(target_os = "freebsd")]
            {
                debug_assert!(self.native() >= 0);
                match sys::get_errno(sys::safe_libc::close(self.native())) {
                    sys::E::EBADF => Some(sys::Error {
                        errno: sys::E::EBADF as _,
                        syscall: sys::Tag::close,
                        fd: self,
                        ..Default::default()
                    }),
                    _ => None,
                }
            }
            #[cfg(target_os = "macos")]
            {
                debug_assert!(self.native() >= 0);
                match sys::get_errno(close_nocancel(self.native())) {
                    sys::E::EBADF => Some(sys::Error {
                        errno: sys::E::EBADF as _,
                        syscall: sys::Tag::close,
                        fd: self,
                        ..Default::default()
                    }),
                    _ => None,
                }
            }
            #[cfg(windows)]
            {
                use sys::windows::{NTSTATUS, Win32Error, Win32ErrorExt as _, libuv as uv};
                match self.decode_windows() {
                    DecodeWindows::Uv(file_number) => {
                        let mut req = uv::fs_t::uninitialized();
                        // SAFETY: synchronous libuv fs call (cb = None); req lives on the
                        // stack for the duration of the call.
                        let rc = unsafe {
                            uv::uv_fs_close(uv::Loop::get(), &mut req, file_number, None)
                        };
                        // Zig: `defer req.deinit();` — fs_t has no Drop impl, so cleanup
                        // must be explicit (uv_fs_req_cleanup).
                        req.deinit();
                        if let Some(errno) = rc.errno() {
                            Some(sys::Error {
                                errno,
                                syscall: sys::Tag::close,
                                fd: self,
                                from_libuv: true,
                                ..Default::default()
                            })
                        } else {
                            None
                        }
                    }
                    DecodeWindows::Windows(handle) => {
                        unsafe extern "system" {
                            // safe: by-value `HANDLE` only; bad/stale handle →
                            // `STATUS_INVALID_HANDLE`, never UB (mirrors POSIX
                            // `close(fd)` → `EBADF`, which is `safe fn` in
                            // `safe_libc`).
                            safe fn NtClose(Handle: bun_windows_sys::HANDLE) -> NTSTATUS;
                        }
                        match NtClose(handle) {
                            NTSTATUS::SUCCESS => None,
                            rc => Some(sys::Error {
                                errno: Win32Error::from_nt_status(rc)
                                    .to_system_errno()
                                    .map_or(1, |e| e as _),
                                syscall: sys::Tag::CloseHandle,
                                fd: self,
                                ..Default::default()
                            }),
                        }
                    }
                }
            }
        };

        #[cfg(debug_assertions)]
        {
            if let Some(ref err) = result {
                if err.errno == sys::E::EBADF as _ {
                    Output::debug_warn(&format_args!(
                        "close({}) = EBADF. This is an indication of a file descriptor UAF",
                        bstr::BStr::new(fd_fmt),
                    ));
                    bun_core::dump_current_stack_trace(
                        return_address,
                        bun_core::DumpStackTraceOptions {
                            frame_count: 4,
                            stop_at_jsc_llint: true,
                            ..Default::default()
                        },
                    );
                } else {
                    log!("close({}) = {}", bstr::BStr::new(fd_fmt), err);
                }
            } else {
                log!("close({})", bstr::BStr::new(fd_fmt));
            }
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = return_address;
        }
        result
    }

    fn make_lib_uv_owned(self) -> Result<Fd, MakeLibUvOwnedError> {
        debug_assert!(self.is_valid());
        #[cfg(not(windows))]
        {
            Ok(self)
        }
        #[cfg(windows)]
        {
            match self.kind() {
                FdKind::System => {
                    let n = uv_open_osfhandle(self.native())?;
                    Ok(Fd::from_uv(n))
                }
                FdKind::Uv => Ok(self),
            }
        }
    }

    fn make_lib_uv_owned_for_syscall(
        self,
        // PERF(port): was comptime monomorphization — profile in Phase B
        syscall_tag: sys::Tag,
        error_case: ErrorCase,
    ) -> sys::Result<Fd> {
        #[cfg(not(windows))]
        {
            let _ = (syscall_tag, error_case);
            Ok(self)
        }
        #[cfg(windows)]
        {
            match self.make_lib_uv_owned() {
                Ok(fd) => Ok(fd),
                Err(MakeLibUvOwnedError::SystemFdQuotaExceeded) => {
                    if matches!(error_case, ErrorCase::CloseOnFail) {
                        self.close();
                    }
                    Err(sys::Error {
                        errno: sys::E::EMFILE as _,
                        syscall: syscall_tag,
                        ..Default::default()
                    })
                }
            }
        }
    }

    fn make_path_u8(self, subpath: &[u8]) -> sys::Maybe<()> {
        // Port of `bun.makePath` — `mkdirat` walking up parents on ENOENT.
        sys::mkdir_recursive_at(self, subpath)
    }

    fn delete_tree(self, subpath: &[u8]) -> Result<(), bun_core::Error> {
        sys::Dir::from_fd(self).delete_tree(subpath)
    }

    #[inline]
    fn as_socket_fd(self) -> sys::SocketT {
        #[cfg(windows)]
        // SAFETY: HANDLE → SOCKET pointer reinterpretation; matches Zig @ptrCast.
        {
            self.native() as sys::SocketT
        }
        #[cfg(not(windows))]
        {
            self.native()
        }
    }
}

/// Close `Optional` if present.
pub trait FdOptionalExt {
    fn close(self);
}
impl FdOptionalExt for Optional {
    #[inline]
    fn close(self) {
        if let Some(fd) = self.unwrap() {
            fd.close();
        }
    }
}

// `fromJS` / `fromJSValidated` / `toJS` / `toJSWithoutMakingLibUVOwned` are
// `*_jsc` aliases — deleted per PORTING.md; they live as extension-trait
// methods in `bun_sys_jsc`.

// `fromStdFile` / `fromStdDir` / `stdFile` / `stdDir` wrap `std.fs.File`/`Dir`.
// TODO(port): no Rust equivalent (std::fs is banned). Callers use
// `Fd::from_native(handle)` / `fd.native()` directly.

// The following functions are from bun.sys but with the 'f' prefix dropped
// where it is relevant. In Zig they are aliased onto `FD` as inherent methods.
// In Rust, callers use the free fns in `bun_sys` directly:
//   chmod→fchmod, chmodat→fchmodat, chown→fchown, directoryExistsAt, dup,
//   dupWithFlags, existsAt, existsAtType, fcntl, getFcntlFlags, getFileSize,
//   linkat, linkatTmpfile, lseek, mkdirat, mkdiratA, mkdiratW, mkdiratZ,
//   openat, pread, preadv, pwrite, pwritev, read, readNonblocking, readlinkat,
//   readv, recv, recvNonBlock, renameat, renameat2, send, sendNonBlock,
//   sendfile, stat→fstat, statat→fstatat, symlinkat, truncate→ftruncate,
//   unlinkat, updateNonblocking, write, writeNonblocking, writev,
//   getFdPath, getFdPathW, getFdPathZ.
// TODO: move these methods defined in bun.sys.File to bun.sys, then delete
// bun.sys.File. (Zig comment carried over.)

// ──────────────────────────────────────────────────────────────────────────
// HashMapContext — identity hash for Fd keys (matches Zig).
// ──────────────────────────────────────────────────────────────────────────
pub struct HashMapContext;
impl HashMapContext {
    #[inline]
    pub fn hash(fd: Fd) -> u64 {
        // a file descriptor is i32 on linux, u64 on windows
        // the goal here is to do zero work and widen the 32 bit type to 64
        #[cfg(not(windows))]
        {
            fd.0 as u32 as u64
        } // @bitCast c_int → u32, then widen
        #[cfg(windows)]
        {
            fd.0
        }
    }
    #[inline]
    pub fn eql(a: Fd, b: Fd) -> bool {
        a == b
    }
    #[inline]
    pub fn pre(input: Fd) -> Prehashed {
        Prehashed {
            value: Self::hash(input),
            input,
        }
    }
}
pub struct Prehashed {
    pub value: u64,
    pub input: Fd,
}
impl Prehashed {
    #[inline]
    pub fn hash(&self, fd: Fd) -> u64 {
        if fd == self.input {
            return self.value;
        }
        // Zig: `return fd;` — implicit coercion of FD (packed struct) to u64.
        HashMapContext::hash(fd)
    }
    #[inline]
    pub fn eql(&self, a: Fd, b: Fd) -> bool {
        a == b
    }
}

// ──────────────────────────────────────────────────────────────────────────
// MovableIfWindowsFd — represents an FD that may be moved into libuv ownership.
//
// On Windows we use libuv and often pass file descriptors to functions like
// `uv_pipe_open`, `uv_tty_init`. But `uv_pipe` and `uv_tty` **take ownership
// of the file descriptor**. This can easily cause use-after-frees, double
// closing the FD, etc. So this type represents an FD that could possibly be
// moved to libuv. On POSIX this is just a wrapper over Fd and does nothing.
// ──────────────────────────────────────────────────────────────────────────
pub struct MovableIfWindowsFd {
    #[cfg(windows)]
    inner: Option<Fd>,
    #[cfg(not(windows))]
    inner: Fd,
}
impl MovableIfWindowsFd {
    #[inline]
    pub fn init(fd: Fd) -> Self {
        #[cfg(windows)]
        {
            Self { inner: Some(fd) }
        }
        #[cfg(not(windows))]
        {
            Self { inner: fd }
        }
    }
    #[inline]
    pub fn get(&self) -> Option<Fd> {
        #[cfg(windows)]
        {
            self.inner
        }
        #[cfg(not(windows))]
        {
            Some(self.inner)
        }
    }
    #[cfg(not(windows))]
    #[inline]
    pub fn get_posix(&self) -> Fd {
        self.inner
    }
    // Windows: `getPosix` is a `@compileError` — not provided.

    pub fn close(&mut self) {
        #[cfg(not(windows))]
        {
            self.inner.close();
            self.inner = Fd::INVALID;
        }
        #[cfg(windows)]
        {
            if let Some(fd) = self.inner {
                fd.close();
                self.inner = None;
            }
        }
    }
    #[inline]
    pub fn is_valid(&self) -> bool {
        #[cfg(not(windows))]
        {
            self.inner.is_valid()
        }
        #[cfg(windows)]
        {
            self.inner.is_some_and(|fd| fd.is_valid())
        }
    }
    #[inline]
    pub fn is_owned(&self) -> bool {
        #[cfg(not(windows))]
        {
            true
        }
        #[cfg(windows)]
        {
            self.inner.is_some()
        }
    }
    /// Takes the FD, leaving `self` in a "moved-from" state. Only on Windows.
    #[cfg(windows)]
    pub fn take(&mut self) -> Option<Fd> {
        self.inner.take()
    }
    // POSIX: `take` is a `@compileError` — not provided.
}
impl fmt::Display for MovableIfWindowsFd {
    fn fmt(&self, w: &mut fmt::Formatter<'_>) -> fmt::Result {
        #[cfg(not(windows))]
        {
            write!(w, "{}", self.inner)
        }
        #[cfg(windows)]
        {
            match self.inner {
                Some(fd) => write!(w, "{}", fd),
                None => w.write_str("[moved]"),
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Platform helpers (Windows libuv / macOS close_nocancel).
// ──────────────────────────────────────────────────────────────────────────
#[cfg(target_os = "macos")]
unsafe extern "C" {
    // Darwin libc: close that doesn't get interrupted by pthread cancellation.
    // By-value `c_int` only; bad fd → `EBADF`, no UB.
    #[link_name = "close$NOCANCEL"]
    safe fn close_nocancel(fd: c_int) -> c_int;
}

#[cfg(windows)]
pub fn uv_open_osfhandle(in_: *mut c_void) -> Result<c_int, MakeLibUvOwnedError> {
    // SAFETY: FFI call into libuv. Raw extern lives in `bun_core::fd` (T0).
    let out = unsafe { bun_core::fd::uv_open_osfhandle(in_) };
    debug_assert!(out >= -1);
    if out == -1 {
        return Err(MakeLibUvOwnedError::SystemFdQuotaExceeded);
    }
    Ok(out)
}

// fd → path bodies moved down to `bun_core::fd_path_raw[_w]` (libc/kernel32-
// only; PORTING.md "move storage down"). `bun_sys` keeps the richer
// `get_fd_path[_w]` returning `Maybe<&mut [u8/u16]>` for callers that want
// `bun_sys::Error` with a syscall tag.

// ported from: src/sys/fd.zig
