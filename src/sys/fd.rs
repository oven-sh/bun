#[cfg(any(target_os = "macos", windows))]
use core::ffi::c_int;
#[cfg(windows)]
use core::ffi::c_void;

// `Fd` (the packed handle struct + pure-data accessors) is canonical in
// bun_core. This file adds the syscall-touching surface as an extension trait.
pub use bun_core::{Fd, FdKind, FdNative, Stdio, fd};
/// Platform-native fd integer (`c_int` on POSIX, `HANDLE` on Windows). Alias
/// for callers that want the `bun.FD.native()` shape.
pub type RawFd = FdNative;
#[cfg(windows)]
pub use bun_core::DecodeWindows;

use crate as sys;

bun_core::define_scoped_log!(log, SYS, visible);

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum ErrorCase {
    CloseOnFail,
    LeakFdOnFail,
}

#[derive(thiserror::Error, Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum MakeLibUvOwnedError {
    #[error("SystemFdQuotaExceeded")]
    SystemFdQuotaExceeded,
}

// ──────────────────────────────────────────────────────────────────────────
// FdExt — syscall-touching methods on `bun_core::Fd`.
//
// Rust can't impl inherent methods on a foreign
// type, so they live behind an extension trait. Import via
// `use bun_sys::FdExt;` at call sites; or call `bun_sys::close(fd)` directly.
// ──────────────────────────────────────────────────────────────────────────
pub trait FdExt: Copy + Sized {
    /// The owner's close. POSIX closes any number, fd 0-2 included. Windows will NOT CLOSE stdin/stdout/stderr.
    /// Expects a VALID file descriptor object.
    ///
    /// Do not use fd on JS-provided file descriptors (e.g. in `fs.closeSync`).
    /// For those cases, the developer may provide a faulty value, and we must
    /// forward EBADF to them. For internal situations, we should never hit
    /// EBADF since it means we could have replaced the file descriptor,
    /// closing something completely unrelated; fd would cause weird behavior
    /// as you see EBADF errors in unrelated places.
    fn close(self);
    /// The owner's close, as `.close()`, but EBADF is returned to the caller.
    /// Prefer asserting that EBADF does not happen with `.close()`.
    fn close_allowing_bad_file_descriptor(
        self,
        return_address: Option<usize>,
    ) -> Option<sys::Error>;
    /// fd allows you to close standard io. It also returns the error.
    /// Use fd API to implement `node:fs` close: stdio must actually close and
    /// EBADF must surface to the caller. Consider fd the raw close method.
    fn close_allowing_standard_io(self, return_address: Option<usize>) -> Option<sys::Error>;
    /// Assumes given a valid file descriptor. If error, the handle has not been closed.
    fn make_lib_uv_owned(self) -> Result<Fd, MakeLibUvOwnedError>;
    fn make_lib_uv_owned_for_syscall(
        self,
        syscall_tag: sys::Tag,
        error_case: ErrorCase,
    ) -> sys::Result<Fd>;
    fn make_path_u8(self, subpath: &[u8]) -> sys::Maybe<()>;
    fn delete_tree(self, subpath: &[u8]) -> sys::Maybe<()>;
}

impl FdExt for Fd {
    fn close(self) {
        let err = self.close_allowing_bad_file_descriptor(None);
        // EBADF is a use after close, except on POSIX fd 0, 1 or 2: the program can close that number again while Bun owns a descriptor there, as in Node.
        debug_assert!(err.is_none() || (cfg!(unix) && self.stdio_tag().is_some()));
    }

    fn close_allowing_bad_file_descriptor(
        self,
        return_address: Option<usize>,
    ) -> Option<sys::Error> {
        #[cfg(all(unix, debug_assertions))]
        startup_stdio::assert_not_closing(self);
        #[cfg(windows)]
        if self.stdio_tag().is_some() {
            log!("close({}) SKIPPED", self);
            return None;
        }
        self.close_allowing_standard_io(return_address)
    }

    fn close_allowing_standard_io(self, return_address: Option<usize>) -> Option<sys::Error> {
        debug_assert!(self.is_valid()); // probably a UAF
        #[cfg(all(unix, debug_assertions))]
        startup_stdio::mark_released(self);

        // Format the file descriptor for logging BEFORE closing it.
        // Otherwise the file descriptor is always invalid after closing it.
        #[cfg(debug_assertions)]
        let mut fd_fmt_buf = [0u8; 1050];
        #[cfg(debug_assertions)]
        let fd_fmt: &[u8] = {
            // Stack slice, no heap.
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
                // pthread cancellation point). Never retry on EINTR.
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
                use sys::ReturnCodeExt as _;
                use sys::windows::{NTSTATUS, libuv as uv};
                match self.decode_windows() {
                    // It decodes to ntdll's handle; `close(AT_FDCWD)` is EBADF too.
                    _ if self == Fd::cwd() => Some(sys::Error {
                        errno: sys::E::EBADF as _,
                        syscall: sys::Tag::CloseHandle,
                        fd: self,
                        ..Default::default()
                    }),
                    DecodeWindows::Uv(file_number) => {
                        let mut req = uv::fs_t::uninitialized();
                        // SAFETY: synchronous libuv fs call (cb = None); req lives on the
                        // stack for the duration of the call.
                        let rc = unsafe {
                            uv::uv_fs_close(uv::Loop::get(), &mut req, file_number, None)
                        };
                        // fs_t has no Drop impl, so cleanup
                        // must be explicit (uv_fs_req_cleanup).
                        req.deinit();
                        rc.to_error(sys::Tag::close).map(|e| e.with_fd(self))
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
                            rc => Some(sys::Error::new(rc, sys::Tag::CloseHandle).with_fd(self)),
                        }
                    }
                }
            }
        };

        #[cfg(debug_assertions)]
        {
            if let Some(ref err) = result {
                if err.errno == sys::E::EBADF as _ {
                    bun_core::debug_warn!(
                        "close({}) = EBADF. This is an indication of a file descriptor UAF",
                        bstr::BStr::new(fd_fmt),
                    );
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

    fn delete_tree(self, subpath: &[u8]) -> sys::Maybe<()> {
        // Non-owning view: `self` is the caller's fd; we must not close it.
        sys::Dir::borrow(&self).delete_tree(subpath)
    }
}

/// Debug builds: an internal close must not be handed fd 0, 1 or 2 while it is the descriptor the process started with.
#[cfg(all(unix, debug_assertions))]
pub mod startup_stdio {
    use bun_core::Fd;
    use core::sync::atomic::{AtomicU8, Ordering};
    use std::sync::OnceLock;

    /// `(st_dev, st_ino)` of fd 0, 1 and 2. Unset in a process that never calls [`record`]: nothing is checked there.
    static IDENTITY: OnceLock<[Option<(u64, u64)>; 3]> = OnceLock::new();
    /// Bit `n`: fd `n` was closed since, so the number names another file or none.
    static RELEASED: AtomicU8 = AtomicU8::new(0);

    fn identity(fd: Fd) -> Option<(u64, u64)> {
        let stat = crate::fstat(fd).ok()?;
        Some((stat.st_dev as u64, stat.st_ino as u64))
    }

    /// Call once fd 0, 1 and 2 are open and before the first thread starts.
    pub fn record() {
        let _ = IDENTITY.set([Fd::stdin(), Fd::stdout(), Fd::stderr()].map(identity));
    }

    /// Call before the close(2): once it returns, another thread's open can be given the number.
    pub(crate) fn mark_released(fd: Fd) {
        if let n @ 0..=2 = fd.native() {
            RELEASED.fetch_or(1 << n, Ordering::SeqCst);
        }
    }

    /// A false alarm takes a close outside bun_sys and then an owned descriptor on the same file (`/dev/null`, a shared tty).
    pub(crate) fn assert_not_closing(fd: Fd) {
        let n @ 0..=2 = fd.native() else { return };
        let Some(startup) = IDENTITY.get() else {
            return;
        };
        if RELEASED.load(Ordering::SeqCst) & (1 << n) != 0 {
            return;
        }
        let now = identity(fd);
        if now.is_some() && now == startup[n as usize] {
            panic!("internal close of a descriptor the process started with");
        }
        mark_released(fd);
    }
}

// `fromJS` / `fromJSValidated` / `toJS` / `toJSWithoutMakingLibUVOwned` are
// `*_jsc` aliases — deleted per PORTING.md; they live as extension-trait
// methods in `bun_sys_jsc`.

// There are deliberately no `std::fs::File`/`Dir` conversion helpers
// (std::fs is banned). Callers use
// `Fd::from_native(handle)` / `fd.native()` directly.

// The following functions are from bun.sys but with the 'f' prefix dropped
// where it is relevant. Callers use the free fns in `bun_sys` directly:
//   chmod→fchmod, chmodat→fchmodat, chown→fchown, directoryExistsAt, dup,
//   dupWithFlags, existsAt, existsAtType, fcntl, getFcntlFlags, getFileSize,
//   linkat, linkatTmpfile, lseek, mkdirat, mkdiratA, mkdiratW, mkdiratZ,
//   openat, pread, preadv, pwrite, pwritev, read, readNonblocking, readlinkat,
//   readv, recv, recvNonBlock, renameat, renameat2, send, sendNonBlock,
//   sendfile, stat→fstat, statat→fstatat, symlinkat, truncate→ftruncate,
//   unlinkat, updateNonblocking, write, writeNonblocking, writev,
//   getFdPath, getFdPathW, getFdPathZ.
// TODO: move these methods defined in bun.sys.File to bun.sys, then delete
// bun.sys.File.

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
fn uv_open_osfhandle(in_: *mut c_void) -> Result<c_int, MakeLibUvOwnedError> {
    let out = bun_core::fd::uv_open_osfhandle(in_);
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
