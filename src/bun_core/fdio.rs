//! Raw fd I/O for `output.rs`/`Progress.rs`. Tier-0 twin of the bun_sys
//! syscall wrappers, restricted to the operations terminal/log output needs;
//! errors collapse to `crate::Error` (interned code, no syscall tag).

use crate::{Error, Fd, Winsize};

#[cfg(windows)]
use crate::errno::{Win32Error, Win32ErrorExt};

/// Largest byte count handed to a single read/write syscall (matches the
/// kernel's per-call limits; bun_sys uses the same clamp).
#[cfg(any(target_os = "linux", target_os = "android"))]
const MAX_COUNT: usize = 0x7ffff000;
#[cfg(all(unix, not(any(target_os = "linux", target_os = "android"))))]
const MAX_COUNT: usize = i32::MAX as usize;
#[cfg(windows)]
const MAX_COUNT: usize = u32::MAX as usize;

#[cfg(windows)]
#[inline]
fn win32_error_to_error(er: Win32Error) -> Error {
    let e = er.to_e();
    Error::from_errno(e as u16 as i32)
}

/// `write(2)` with EINTR retry. Errors collapse to the interned
/// `crate::Error`; the quiet callers discard it.
#[cfg(not(windows))]
pub(crate) fn write(fd: Fd, buf: &[u8]) -> Result<usize, Error> {
    let len = buf.len().min(MAX_COUNT);
    loop {
        // SAFETY: `fd` is a live descriptor; `buf` is valid for `len` reads.
        let rc = unsafe { libc::write(fd.native(), buf.as_ptr().cast(), len) };
        if rc >= 0 {
            return Ok(rc as usize);
        }
        let errno = crate::ffi::errno();
        if errno == libc::EINTR {
            continue;
        }
        return Err(Error::from_errno(errno));
    }
}

/// kernel32 `WriteFile` directly (NOT via libuv — output runs before libuv
/// init). `ERROR_ACCESS_DENIED` → `EBADF` ("fd not open for writing").
#[cfg(windows)]
pub(crate) fn write(fd: Fd, buf: &[u8]) -> Result<usize, Error> {
    let adjusted_len = buf.len().min(MAX_COUNT) as crate::windows_sys::DWORD;
    let mut bytes_written: crate::windows_sys::DWORD = 0;
    // SAFETY: FFI; `fd.native()` is a valid HANDLE, buf valid for `adjusted_len`.
    let rc = unsafe {
        bun_windows_sys::kernel32::WriteFile(
            fd.native(),
            buf.as_ptr(),
            adjusted_len,
            &mut bytes_written,
            core::ptr::null_mut(),
        )
    };
    if rc == 0 {
        let er = Win32Error::get();
        if er == Win32Error::ACCESS_DENIED {
            return Err(Error::from_errno(crate::errno::E::EBADF as u16 as i32));
        }
        return Err(win32_error_to_error(er));
    }
    Ok(bytes_written as usize)
}

/// Best-effort write-all loop. Returns `false` on I/O error / zero-write so
/// `ScopedLogger::log` can disable the scope; "quiet" callers discard the bool.
pub(crate) fn write_all_quiet(fd: Fd, mut bytes: &[u8]) -> bool {
    while !bytes.is_empty() {
        match write(fd, bytes) {
            Ok(0) => return false, // short write → give up
            Ok(n) => bytes = &bytes[n..],
            Err(_) => return false,
        }
    }
    true
}

/// `read(2)` with EINTR retry. (macOS `bun_sys::read` uses a single
/// `read$NOCANCEL` with no retry; the stdin readers here tolerate the retry.)
#[cfg(not(windows))]
pub(crate) fn read(fd: Fd, buf: &mut [u8]) -> Result<usize, Error> {
    let len = buf.len().min(MAX_COUNT);
    loop {
        // SAFETY: `fd` is a live descriptor; `buf` is valid for `len` writes.
        let rc = unsafe { libc::read(fd.native(), buf.as_mut_ptr().cast(), len) };
        if rc >= 0 {
            return Ok(rc as usize);
        }
        let errno = crate::ffi::errno();
        if errno == libc::EINTR {
            continue;
        }
        return Err(Error::from_errno(errno));
    }
}

/// kernel32 `ReadFile` on a HANDLE-backed fd. The stdin callers route through
/// here, so the BROKEN_PIPE/HANDLE_EOF → 0 (EOF) mapping and the
/// OPERATION_ABORTED retry live here.
#[cfg(windows)]
pub(crate) fn read(fd: Fd, buf: &mut [u8]) -> Result<usize, Error> {
    // Stdio fds reach here as System-kind (HANDLE) Fds; a Uv-kind fd still
    // yields a HANDLE via `native()` (uv_get_osfhandle), but pipe semantics
    // may differ from the libuv path.
    debug_assert!(fd.kind() == crate::FdKind::System);
    let adjusted_len = buf.len().min(MAX_COUNT) as crate::windows_sys::DWORD;
    loop {
        let mut amount_read: crate::windows_sys::DWORD = 0;
        // SAFETY: FFI; `fd.native()` is a valid HANDLE, buf valid for `adjusted_len`.
        let rc = unsafe {
            bun_windows_sys::kernel32::ReadFile(
                fd.native(),
                buf.as_mut_ptr(),
                adjusted_len,
                &mut amount_read,
                core::ptr::null_mut(),
            )
        };
        if rc == 0 {
            let er = Win32Error::get();
            match er {
                Win32Error::BROKEN_PIPE | Win32Error::HANDLE_EOF => return Ok(0),
                Win32Error::OPERATION_ABORTED => continue,
                _ => return Err(win32_error_to_error(er)),
            }
        }
        return Ok(amount_read as usize);
    }
}

/// Whether `fd` refers to a terminal. Matches the libuv
/// `uv_guess_handle() == UV_TTY` probe for stdio fds: `isatty()` on POSIX,
/// `GetConsoleMode` succeeding on Windows.
#[cfg(not(windows))]
pub(crate) fn is_terminal(fd: Fd) -> bool {
    // SAFETY: takes a plain int; bad fds report ENOTTY/EBADF, never UB.
    unsafe { libc::isatty(fd.native()) == 1 }
}
#[cfg(windows)]
pub(crate) fn is_terminal(fd: Fd) -> bool {
    let mut mode: crate::windows_sys::DWORD = 0;
    // SAFETY: FFI; `fd.native()` is a HANDLE (bad handles just fail the call).
    unsafe { bun_windows_sys::kernel32::GetConsoleMode(fd.native(), &mut mode) != 0 }
}

#[cfg(unix)]
pub(crate) fn tty_winsize(fd: Fd) -> Option<Winsize> {
    // SAFETY: POD, zero-valid — libc::winsize is all-integer; ioctl writes it.
    let mut ws: libc::winsize = crate::ffi::zeroed();
    // SAFETY: TIOCGWINSZ writes exactly `sizeof(winsize)` into the stack-local
    // `ws`; `fd` is a plain int (bad fd → ENOTTY/EBADF, never UB).
    let rc = unsafe { libc::ioctl(fd.native(), libc::TIOCGWINSZ, &raw mut ws) };
    if rc != 0 {
        return None;
    }
    Some(Winsize {
        row: ws.ws_row,
        col: ws.ws_col,
        xpixel: ws.ws_xpixel,
        ypixel: ws.ws_ypixel,
    })
}
#[cfg(not(unix))]
pub(crate) fn tty_winsize(_fd: Fd) -> Option<Winsize> {
    // TODO(windows): GetConsoleScreenBufferInfo.
    None
}

/// NUL-terminate `bytes` for a C path argument.
#[cfg(not(windows))]
fn to_cstr(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len() + 1);
    out.extend_from_slice(bytes);
    out.push(0);
    out
}

/// `mkdir -p` relative to the process cwd. Used only by the `BUN_DEBUG`
/// log-file feature; existing components are not an error.
#[cfg(not(windows))]
pub(crate) fn make_path(dir: &[u8]) -> Result<(), Error> {
    let mut last: Result<(), Error> = Ok(());
    let mut i = 0usize;
    while i <= dir.len() {
        if i == dir.len() || dir[i] == b'/' {
            if i != 0 {
                let prefix = to_cstr(&dir[..i]);
                // SAFETY: `prefix` is a live NUL-terminated byte buffer.
                let rc = unsafe { libc::mkdir(prefix.as_ptr().cast(), 0o755) };
                last = if rc == 0 {
                    Ok(())
                } else {
                    let errno = crate::ffi::errno();
                    if errno == libc::EEXIST {
                        Ok(())
                    } else {
                        Err(Error::from_errno(errno))
                    }
                };
            }
            if i == dir.len() {
                break;
            }
        }
        i += 1;
    }
    last
}
#[cfg(windows)]
pub(crate) fn make_path(dir: &[u8]) -> Result<(), Error> {
    let mut last: Result<(), Error> = Ok(());
    let mut i = 0usize;
    while i <= dir.len() {
        if i == dir.len() || dir[i] == b'/' || dir[i] == b'\\' {
            if i != 0 {
                let wide = crate::strings::to_utf16_alloc_for_real(&dir[..i], false, true)
                    .map_err(Error::from)?;
                // SAFETY: FFI; `wide` is a live NUL-terminated UTF-16 buffer.
                let rc = unsafe {
                    bun_windows_sys::kernel32::CreateDirectoryW(
                        wide.as_ptr(),
                        core::ptr::null_mut(),
                    )
                };
                last = if rc != 0 {
                    Ok(())
                } else {
                    let er = Win32Error::get();
                    if er == Win32Error::ALREADY_EXISTS {
                        Ok(())
                    } else {
                        Err(win32_error_to_error(er))
                    }
                };
            }
            if i == dir.len() {
                break;
            }
        }
        i += 1;
    }
    last
}

/// Create (truncating) a writable file at `path` (relative to the process
/// cwd). Used only by the `BUN_DEBUG` log-file feature.
#[cfg(not(windows))]
pub(crate) fn create_file(path: &[u8]) -> Result<Fd, Error> {
    let cpath = to_cstr(path);
    loop {
        // SAFETY: `cpath` is a live NUL-terminated byte buffer; mode is passed
        // as the third (variadic) `open` argument because O_CREAT is set.
        let rc = unsafe {
            libc::open(
                cpath.as_ptr().cast(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_TRUNC | libc::O_CLOEXEC,
                0o664 as libc::c_uint,
            )
        };
        if rc >= 0 {
            return Ok(Fd::from_native(rc));
        }
        let errno = crate::ffi::errno();
        if errno == libc::EINTR {
            continue;
        }
        return Err(Error::from_errno(errno));
    }
}
#[cfg(windows)]
pub(crate) fn create_file(path: &[u8]) -> Result<Fd, Error> {
    let wide = crate::strings::to_utf16_alloc_for_real(path, false, true).map_err(Error::from)?;
    // SAFETY: FFI; `wide` is a live NUL-terminated UTF-16 buffer.
    let handle = unsafe {
        bun_windows_sys::kernel32::CreateFileW(
            wide.as_ptr(),
            bun_windows_sys::GENERIC_WRITE,
            0,
            core::ptr::null_mut(),
            bun_windows_sys::CREATE_ALWAYS,
            bun_windows_sys::FILE_ATTRIBUTE_NORMAL,
            core::ptr::null_mut(),
        )
    };
    if handle == crate::windows_sys::INVALID_HANDLE_VALUE || handle.is_null() {
        return Err(win32_error_to_error(Win32Error::get()));
    }
    Ok(Fd::from_system(handle))
}
