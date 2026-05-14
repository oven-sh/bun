// Transfer all the data between two file descriptors in the most efficient way.
// The copy starts at offset 0, the initial offsets are preserved.
// No metadata is transferred over.

use core::sync::atomic::{AtomicI32, Ordering};

use crate::Tag;
use crate::{E, Fd};

// PORT NOTE: Zig was `const debug = bun.Output.scoped(.copy_file, .hidden)`.
// `declare_scope!` uses the ident as both static name AND tag string, but
// `copy_file` would shadow `pub fn copy_file()` below. Hand-expand with the
// correct env-var tag and a non-colliding static name.
// TODO(port): `scoped_log!` stringifies its scope ident for the `[tag]`
// prefix, so log lines show `[debug]` instead of `[copy_file]`; fix when
// `scoped_log!` grows a path/expr arm.
static debug: bun_core::output::ScopedLogger =
    bun_core::output::ScopedLogger::new("copy_file", bun_core::output::Visibility::Hidden);

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum CopyFileRangeError {
    #[error("FileTooBig")]
    FileTooBig,
    #[error("InputOutput")]
    InputOutput,
    /// `in` is not open for reading; or `out` is not open  for  writing;
    /// or the  `O.APPEND`  flag  is  set  for `out`.
    #[error("FilesOpenedWithWrongFlags")]
    FilesOpenedWithWrongFlags,
    #[error("IsDir")]
    IsDir,
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("NoSpaceLeft")]
    NoSpaceLeft,
    #[error("Unseekable")]
    Unseekable,
    #[error("PermissionDenied")]
    PermissionDenied,
    #[error("FileBusy")]
    FileBusy,
    // TODO(port): Zig unioned `posix.PReadError || posix.PWriteError || posix.UnexpectedError`
    // here; in Rust those collapse into `bun_core::Error` via `From`.
}
bun_core::named_error_set!(CopyFileRangeError);

#[cfg(windows)]
pub type InputType<'a> = &'a bun_core::WStr; // bun.OSPathSliceZ == [:0]const u16
#[cfg(not(windows))]
pub type InputType<'a> = Fd;
// PORT NOTE: lifetime param is unused on posix (Fd is Copy); kept so callers
// can write `InputType<'_>` uniformly across platforms.

/// In a `bun install` with prisma, this reduces the system call count from ~18,000 to ~12,000
///
/// The intended order here is:
/// 1. ioctl_ficlone
/// 2. copy_file_range
/// 3. sendfile()
/// 4. read() write() loop
///
/// copy_file_range is supposed to do all the fast ways. It might be unnecessary
/// to do ioctl_ficlone.
///
/// sendfile() is a good fallback to avoid the read-write loops. sendfile() improves
/// performance by moving the copying step to the kernel.
///
/// On Linux, sendfile() can work between any two file descriptors which can be mmap'd.
/// This means that it cannot work with TTYs and some special devices
/// But it can work with two ordinary files
///
/// on macOS and other platforms, sendfile() only works when one of the ends is a socket
/// and in general on macOS, it doesn't seem to have much performance impact.
// PORT NOTE: `packed struct(u8)` with all-bool fields → bitflags!; field reads/writes
// reshaped to `.contains()`/`.insert()` below.
bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct LinuxCopyFileState: u8 {
        /// This is the most important flag for reducing the system call count
        /// When copying files from one folder to another, if we see EXDEV once
        /// there's a very good chance we will see it for every file thereafter in that folder.
        /// So we should remember whether or not we saw it and keep the state for roughly one directory tree.
        const HAS_SEEN_EXDEV               = 1 << 0;
        const HAS_IOCTL_FICLONE_FAILED     = 1 << 1;
        const HAS_COPY_FILE_RANGE_FAILED   = 1 << 2;
        const HAS_SENDFILE_FAILED          = 1 << 3;
        // _: u4 padding
    }
}
impl Default for LinuxCopyFileState {
    fn default() -> Self {
        Self::empty()
    }
}

#[derive(Default, Clone, Copy)]
pub struct EmptyCopyFileState;

#[cfg(any(target_os = "linux", target_os = "android"))]
pub type CopyFileState = LinuxCopyFileState;
#[cfg(not(any(target_os = "linux", target_os = "android")))]
pub type CopyFileState = EmptyCopyFileState;

type CopyFileReturnType = crate::Result<()>;

#[allow(unused_variables)]
pub fn copy_file_with_state(
    in_: InputType<'_>,
    out: InputType<'_>,
    copy_file_state: &mut CopyFileState,
) -> CopyFileReturnType {
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            // safe: by-value `c_int` fds + `u32` flags; bad fd → `EBADF`/
            // `EOPNOTSUPP`, never UB. `state` is `Option<NonNull<c_void>>`
            // (FFI-safe via the null-pointer niche → ABI-identical to a
            // nullable `copyfile_state_t`); we never allocate a state.
            safe fn fcopyfile(
                from: libc::c_int,
                to: libc::c_int,
                state: Option<core::ptr::NonNull<core::ffi::c_void>>,
                flags: u32,
            ) -> libc::c_int;
        }
        let rc = fcopyfile(in_.native(), out.native(), None, libc::COPYFILE_DATA);

        match crate::get_errno(rc) {
            E::SUCCESS => return Ok(()),
            // The source file is not a directory, symbolic link, or regular file.
            // Try with the fallback path before giving up.
            E::EOPNOTSUPP => {}
            e => return Err(crate::Error::from_code(e, Tag::copyfile)),
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        if can_use_ioctl_ficlone()
            && !copy_file_state.contains(LinuxCopyFileState::HAS_SEEN_EXDEV)
            && !copy_file_state.contains(LinuxCopyFileState::HAS_IOCTL_FICLONE_FAILED)
        {
            // We only check once if the ioctl is supported, and cache the result.
            // EXT4 does not support FICLONE.
            let rc = crate::linux::ioctl_ficlone(out, in_);
            // the ordering is flipped but it is consistent with other system calls.
            crate::syslog!("ioctl_ficlone({}, {}) = {}", in_, out, rc);
            match crate::get_errno(rc) {
                E::SUCCESS => return Ok(()),
                E::EXDEV => {
                    copy_file_state.insert(LinuxCopyFileState::HAS_SEEN_EXDEV);
                }

                // Don't worry about EINTR here.
                E::EINTR => {}

                // PORT NOTE: Zig matched .OPNOTSUPP; on Linux EOPNOTSUPP == ENOTSUP.
                E::EACCES | E::EBADF | E::EINVAL | E::ENOTSUP | E::ENOSYS | E::EPERM => {
                    bun_core::scoped_log!(debug, "ioctl_ficlonerange is NOT supported");
                    CAN_USE_IOCTL_FICLONE_.store(-1, Ordering::Relaxed);
                    copy_file_state.insert(LinuxCopyFileState::HAS_IOCTL_FICLONE_FAILED);
                }
                _ => {
                    // Failed for some other reason
                    copy_file_state.insert(LinuxCopyFileState::HAS_IOCTL_FICLONE_FAILED);
                }
            }
        }

        // Try copy_file_range first as that works at the FS level and is the
        // most efficient method (if available).
        let mut offset: u64 = 0;
        'cfr_loop: loop {
            // The kernel checks the u64 value `offset+count` for overflow, use
            // a 32 bit value so that the syscall won't return EINVAL except for
            // impossibly large files (> 2^64-1 - 2^32-1).
            let amt = match copy_file_range(
                in_.native(),
                out.native(),
                (i32::MAX - 1) as usize,
                0,
                copy_file_state,
            ) {
                Ok(a) => a,
                Err(err) => return Err(err),
            };
            // Terminate when no data was copied
            if amt == 0 {
                break 'cfr_loop;
            }
            offset += amt as u64;
        }
        let _ = offset;
        return Ok(());
    }

    #[cfg(target_os = "freebsd")]
    {
        // FreeBSD 13+ has copy_file_range(2). Unlike Linux, we don't need
        // kernel-version probing — our minimum is 14.0.
        loop {
            // SAFETY: FFI call; fds are valid, offset ptrs are null (kernel uses file position)
            let rc = unsafe {
                libc::copy_file_range(
                    in_.native(),
                    core::ptr::null_mut(),
                    out.native(),
                    core::ptr::null_mut(),
                    (i32::MAX - 1) as usize,
                    0,
                )
            };
            crate::syslog!(
                "copy_file_range({}, {}) = {}",
                in_.native(),
                out.native(),
                rc
            );
            match crate::get_errno(rc) {
                E::SUCCESS => {
                    if rc == 0 {
                        return Ok(());
                    }
                }
                // Cross-filesystem or unsupported fd type — fall back to r/w loop.
                E::EXDEV | E::EINVAL | E::EOPNOTSUPP | E::EBADF => break,
                E::EINTR => continue,
                e => return Err(crate::Error::from_code(e, Tag::copy_file_range)),
            }
        }
    }

    #[cfg(windows)]
    {
        // SAFETY: FFI call; in_/out are NUL-terminated WStr, pointers valid for duration of call
        let rc = unsafe { crate::windows::CopyFileW(in_.as_ptr(), out.as_ptr(), 0) };
        if rc == 0 {
            return Err(crate::Error::from_code(
                crate::windows::get_last_errno(),
                Tag::copyfile,
            ));
        }
        return Ok(());
    }

    #[cfg(not(any(target_os = "linux", target_os = "android", windows)))]
    {
        loop {
            match copy_file_read_write_loop(in_.native(), out.native(), (i32::MAX - 1) as usize) {
                Err(err) => return Err(err),
                Ok(amt) => {
                    if amt == 0 {
                        break;
                    }
                }
            }
        }

        return Ok(());
    }
}

pub fn copy_file(in_: InputType<'_>, out: InputType<'_>) -> CopyFileReturnType {
    let mut state: CopyFileState = CopyFileState::default();
    copy_file_with_state(in_, out, &mut state)
}

static CAN_USE_COPY_FILE_RANGE: AtomicI32 = AtomicI32::new(0);

#[inline]
pub fn disable_copy_file_range_syscall() {
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        return;
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    CAN_USE_COPY_FILE_RANGE.store(-1, Ordering::Relaxed);
}

pub fn can_use_copy_file_range_syscall() -> bool {
    let result = CAN_USE_COPY_FILE_RANGE.load(Ordering::Relaxed);
    if result == 0 {
        // This flag mostly exists to make other code more easily testable.
        if bun_core::env_var::BUN_CONFIG_DISABLE_COPY_FILE_RANGE
            .get()
            .unwrap_or(false)
        {
            bun_core::scoped_log!(
                debug,
                "copy_file_range is disabled by BUN_CONFIG_DISABLE_COPY_FILE_RANGE"
            );
            CAN_USE_COPY_FILE_RANGE.store(-1, Ordering::Relaxed);
            return false;
        }

        // Zig: `kernel.orderWithoutTag(.{ .major = 4, .minor = 5 }).compare(.gte)`
        if kernel_at_least(4, 5) {
            bun_core::scoped_log!(debug, "copy_file_range is supported");
            CAN_USE_COPY_FILE_RANGE.store(1, Ordering::Relaxed);
            return true;
        } else {
            bun_core::scoped_log!(debug, "copy_file_range is NOT supported");
            CAN_USE_COPY_FILE_RANGE.store(-1, Ordering::Relaxed);
            return false;
        }
    }

    result == 1
}

pub static CAN_USE_IOCTL_FICLONE_: AtomicI32 = AtomicI32::new(0);

#[inline]
pub fn disable_ioctl_ficlone() {
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        return;
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    CAN_USE_IOCTL_FICLONE_.store(-1, Ordering::Relaxed);
}

pub fn can_use_ioctl_ficlone() -> bool {
    let result = CAN_USE_IOCTL_FICLONE_.load(Ordering::Relaxed);
    if result == 0 {
        // This flag mostly exists to make other code more easily testable.
        if bun_core::env_var::BUN_CONFIG_DISABLE_ioctl_ficlonerange
            .get()
            .unwrap_or(false)
        {
            bun_core::scoped_log!(
                debug,
                "ioctl_ficlonerange is disabled by BUN_CONFIG_DISABLE_ioctl_ficlonerange"
            );
            CAN_USE_IOCTL_FICLONE_.store(-1, Ordering::Relaxed);
            return false;
        }

        // Zig: `kernel.orderWithoutTag(.{ .major = 4, .minor = 5 }).compare(.gte)`
        if kernel_at_least(4, 5) {
            bun_core::scoped_log!(debug, "ioctl_ficlonerange is supported");
            CAN_USE_IOCTL_FICLONE_.store(1, Ordering::Relaxed);
            return true;
        } else {
            bun_core::scoped_log!(debug, "ioctl_ficlonerange is NOT supported");
            CAN_USE_IOCTL_FICLONE_.store(-1, Ordering::Relaxed);
            return false;
        }
    }

    result == 1
}

// TODO(port): `fd_t` is `std.posix.fd_t` (c_int on posix, HANDLE on windows). Only the
// posix paths call the fns below, so c_int is sufficient here.
#[allow(non_camel_case_types)]
type fd_t = core::ffi::c_int;

#[cfg(any(target_os = "linux", target_os = "android"))]
pub fn copy_file_range(
    in_: fd_t,
    out: fd_t,
    len: usize,
    flags: u32,
    copy_file_state: &mut CopyFileState,
) -> crate::Result<usize> {
    if can_use_copy_file_range_syscall()
        && !copy_file_state.contains(LinuxCopyFileState::HAS_SEEN_EXDEV)
        && !copy_file_state.contains(LinuxCopyFileState::HAS_COPY_FILE_RANGE_FAILED)
    {
        loop {
            // TODO(port): raw syscall binding `std.os.linux.copy_file_range`
            // SAFETY: raw syscall; fds valid, offset ptrs null
            let rc = unsafe {
                crate::linux::copy_file_range(
                    in_,
                    core::ptr::null_mut(),
                    out,
                    core::ptr::null_mut(),
                    len,
                    flags,
                )
            };
            crate::syslog!("copy_file_range({}, {}, {}) = {}", in_, out, len, rc);
            match crate::get_errno(rc) {
                E::SUCCESS => return Ok(rc as usize),
                // these may not be regular files, try fallback
                E::EINVAL => {
                    copy_file_state.insert(LinuxCopyFileState::HAS_COPY_FILE_RANGE_FAILED);
                }
                // support for cross-filesystem copy added in Linux 5.3
                // and even then, it is frequently not supported.
                E::EXDEV => {
                    copy_file_state.insert(LinuxCopyFileState::HAS_SEEN_EXDEV);
                    copy_file_state.insert(LinuxCopyFileState::HAS_COPY_FILE_RANGE_FAILED);
                }
                // syscall added in Linux 4.5, use fallback
                // PORT NOTE: Zig matched .OPNOTSUPP; on Linux EOPNOTSUPP == ENOTSUP.
                E::ENOTSUP | E::ENOSYS => {
                    copy_file_state.insert(LinuxCopyFileState::HAS_COPY_FILE_RANGE_FAILED);
                    bun_core::scoped_log!(debug, "copy_file_range is NOT supported");
                    CAN_USE_COPY_FILE_RANGE.store(-1, Ordering::Relaxed);
                }
                E::EINTR => continue,
                _ => {
                    // failed for some other reason
                    copy_file_state.insert(LinuxCopyFileState::HAS_COPY_FILE_RANGE_FAILED);
                }
            }
            break;
        }
    }

    while !copy_file_state.contains(LinuxCopyFileState::HAS_SENDFILE_FAILED) {
        // TODO(port): raw syscall binding `std.os.linux.sendfile`
        // SAFETY: raw syscall; fds valid, offset ptr null
        let rc = unsafe { crate::linux::sendfile(out, in_, core::ptr::null_mut(), len) };
        crate::syslog!("sendfile({}, {}, {}) = {}", in_, out, len, rc);
        match crate::get_errno(rc) {
            E::SUCCESS => return Ok(rc as usize),
            E::EINTR => continue,
            // these may not be regular files, try fallback
            E::EINVAL => {
                copy_file_state.insert(LinuxCopyFileState::HAS_SENDFILE_FAILED);
            }
            // This shouldn't happen?
            E::EXDEV => {
                copy_file_state.insert(LinuxCopyFileState::HAS_SEEN_EXDEV);
                copy_file_state.insert(LinuxCopyFileState::HAS_SENDFILE_FAILED);
            }
            // they might not support it
            // PORT NOTE: Zig matched .OPNOTSUPP; on Linux EOPNOTSUPP == ENOTSUP.
            E::ENOTSUP | E::ENOSYS => {
                copy_file_state.insert(LinuxCopyFileState::HAS_SENDFILE_FAILED);
            }
            _ => {
                // failed for some other reason, fallback to read-write loop
                copy_file_state.insert(LinuxCopyFileState::HAS_SENDFILE_FAILED);
            }
        }
        break;
    }

    copy_file_read_write_loop(in_, out, len)
}

pub fn copy_file_read_write_loop(in_: fd_t, out: fd_t, len: usize) -> crate::Result<usize> {
    // PERF(port): Zig used `undefined` (uninitialized) 32 KiB stack buffer — profile in Phase B
    let mut buf = [0u8; 8 * 4096];
    let adjusted_count = buf.len().min(len);
    match crate::read(Fd::from_native(in_ as _), &mut buf[0..adjusted_count]) {
        Ok(amt_read) => {
            let mut amt_written: usize = 0;
            if amt_read == 0 {
                return Ok(0);
            }

            while amt_written < amt_read {
                match crate::write(Fd::from_native(out as _), &buf[amt_written..amt_read]) {
                    Ok(wrote) => {
                        if wrote == 0 {
                            return Ok(amt_written);
                        }

                        amt_written += wrote;
                    }
                    Err(err) => return Err(err),
                }
            }
            if amt_read == 0 {
                return Ok(0);
            }
            Ok(amt_read)
        }
        Err(err) => Err(err),
    }
}

/// `Platform.kernelVersion().orderWithoutTag(.{ major, minor }).compare(.gte)`.
/// PORT NOTE: `bun_analytics::generate_header::Platform` (T6) is the canonical
/// source; T1 routes through `bun_core::linux_kernel_version()` (TYPE_ONLY
/// move-down) so this crate stays leaf. Compare matches Zig
/// `std.SemanticVersion.orderWithoutTag` (lexicographic on major→minor→patch,
/// patch defaults to 0 in the comparand).
#[inline]
fn kernel_at_least(major: u32, minor: u32) -> bool {
    let v = bun_core::linux_kernel_version();
    (v.major, v.minor, v.patch) >= (major, minor, 0)
}

/// Map a raw `copy_file`-path errno to `bun_core::Error` (kept for B-1 callers).
#[inline]
pub fn copy_file_error_convert(e: crate::Error) -> bun_core::Error {
    e.into()
}

// ported from: src/sys/copy_file.zig
