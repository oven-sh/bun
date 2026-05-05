// Transfer all the data between two file descriptors in the most efficient way.
// The copy starts at offset 0, the initial offsets are preserved.
// No metadata is transferred over.

use core::sync::atomic::{AtomicI32, Ordering};

use crate::{Fd, E};
// TODO(port): exact module path for syscall tag enum (`.copyfile`, `.copy_file_range`)
use crate::Tag;

bun_output::declare_scope!(copy_file, hidden);

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum CopyFileRangeError {
    FileTooBig,
    InputOutput,
    /// `in` is not open for reading; or `out` is not open  for  writing;
    /// or the  `O.APPEND`  flag  is  set  for `out`.
    FilesOpenedWithWrongFlags,
    IsDir,
    OutOfMemory,
    NoSpaceLeft,
    Unseekable,
    PermissionDenied,
    FileBusy,
    // TODO(port): Zig unioned `posix.PReadError || posix.PWriteError || posix.UnexpectedError`
    // here; in Rust those collapse into `bun_core::Error` via `From`.
}
impl From<CopyFileRangeError> for bun_core::Error {
    fn from(e: CopyFileRangeError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
}

#[cfg(windows)]
pub type InputType<'a> = &'a bun_str::WStr; // bun.OSPathSliceZ == [:0]const u16
#[cfg(not(windows))]
pub type InputType<'a> = Fd;

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

#[cfg(target_os = "linux")]
pub type CopyFileState = LinuxCopyFileState;
#[cfg(not(target_os = "linux"))]
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
        // TODO(port): exact binding for `posix.system.fcopyfile` / `COPYFILE{ .DATA = true }`
        // SAFETY: FFI call; fds are valid open descriptors owned by caller, state ptr is null
        let rc = unsafe {
            crate::darwin::fcopyfile(
                in_.native(),
                out.native(),
                core::ptr::null_mut(),
                crate::darwin::COPYFILE_DATA,
            )
        };

        match crate::get_errno(rc) {
            E::SUCCESS => return Ok(()),
            // The source file is not a directory, symbolic link, or regular file.
            // Try with the fallback path before giving up.
            E::OPNOTSUPP => {}
            _ => return crate::Result::<()>::errno_sys(rc, Tag::copyfile).unwrap(),
        }
    }

    #[cfg(target_os = "linux")]
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
                E::XDEV => {
                    copy_file_state.insert(LinuxCopyFileState::HAS_SEEN_EXDEV);
                }

                // Don't worry about EINTR here.
                E::INTR => {}

                E::ACCES | E::BADF | E::INVAL | E::OPNOTSUPP | E::NOSYS | E::PERM => {
                    bun_output::scoped_log!(copy_file, "ioctl_ficlonerange is NOT supported");
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
            // TODO(port): exact binding for libc::copy_file_range on FreeBSD
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
            crate::syslog!("copy_file_range({}, {}) = {}", in_.native(), out.native(), rc);
            match crate::get_errno(rc) {
                E::SUCCESS => {
                    if rc == 0 {
                        return Ok(());
                    }
                }
                // Cross-filesystem or unsupported fd type — fall back to r/w loop.
                E::XDEV | E::INVAL | E::OPNOTSUPP | E::BADF => break,
                E::INTR => continue,
                e => return Err(crate::Error::from_code(e, Tag::copy_file_range)),
            }
        }
    }

    #[cfg(windows)]
    {
        if let Some(err) = crate::Result::<()>::errno_sys(
            // SAFETY: FFI call; in_/out are NUL-terminated WStr, pointers valid for duration of call
            unsafe { crate::windows::CopyFileW(in_.as_ptr(), out.as_ptr(), 0) },
            Tag::copyfile,
        ) {
            return err;
        }

        return Ok(());
    }

    #[cfg(not(any(target_os = "linux", windows)))]
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
    #[cfg(not(target_os = "linux"))]
    {
        return;
    }
    #[cfg(target_os = "linux")]
    CAN_USE_COPY_FILE_RANGE.store(-1, Ordering::Relaxed);
}

pub fn can_use_copy_file_range_syscall() -> bool {
    let result = CAN_USE_COPY_FILE_RANGE.load(Ordering::Relaxed);
    if result == 0 {
        // This flag mostly exists to make other code more easily testable.
        if bun_core::env_var::BUN_CONFIG_DISABLE_COPY_FILE_RANGE.get() {
            bun_output::scoped_log!(
                copy_file,
                "copy_file_range is disabled by BUN_CONFIG_DISABLE_COPY_FILE_RANGE"
            );
            CAN_USE_COPY_FILE_RANGE.store(-1, Ordering::Relaxed);
            return false;
        }

        let kernel = Platform::kernel_version();
        // TODO(port): exact API for Semver-ish compare `orderWithoutTag(...).compare(.gte)`
        if kernel.at_least(4, 5)
            >= core::cmp::Ordering::Equal
        {
            bun_output::scoped_log!(copy_file, "copy_file_range is supported");
            CAN_USE_COPY_FILE_RANGE.store(1, Ordering::Relaxed);
            return true;
        } else {
            bun_output::scoped_log!(copy_file, "copy_file_range is NOT supported");
            CAN_USE_COPY_FILE_RANGE.store(-1, Ordering::Relaxed);
            return false;
        }
    }

    result == 1
}

pub static CAN_USE_IOCTL_FICLONE_: AtomicI32 = AtomicI32::new(0);

#[inline]
pub fn disable_ioctl_ficlone() {
    #[cfg(not(target_os = "linux"))]
    {
        return;
    }
    #[cfg(target_os = "linux")]
    CAN_USE_IOCTL_FICLONE_.store(-1, Ordering::Relaxed);
}

pub fn can_use_ioctl_ficlone() -> bool {
    let result = CAN_USE_IOCTL_FICLONE_.load(Ordering::Relaxed);
    if result == 0 {
        // This flag mostly exists to make other code more easily testable.
        if bun_core::env_var::BUN_CONFIG_DISABLE_ioctl_ficlonerange.get() {
            bun_output::scoped_log!(
                copy_file,
                "ioctl_ficlonerange is disabled by BUN_CONFIG_DISABLE_ioctl_ficlonerange"
            );
            CAN_USE_IOCTL_FICLONE_.store(-1, Ordering::Relaxed);
            return false;
        }

        let kernel = Platform::kernel_version();
        // TODO(port): exact API for Semver-ish compare `orderWithoutTag(...).compare(.gte)`
        if kernel.at_least(4, 5)
            >= core::cmp::Ordering::Equal
        {
            bun_output::scoped_log!(copy_file, "ioctl_ficlonerange is supported");
            CAN_USE_IOCTL_FICLONE_.store(1, Ordering::Relaxed);
            return true;
        } else {
            bun_output::scoped_log!(copy_file, "ioctl_ficlonerange is NOT supported");
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

#[cfg(target_os = "linux")]
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
                crate::linux::copy_file_range(in_, core::ptr::null_mut(), out, core::ptr::null_mut(), len, flags)
            };
            crate::syslog!("copy_file_range({}, {}, {}) = {}", in_, out, len, rc);
            match crate::get_errno(rc) {
                E::SUCCESS => return Ok(rc as usize),
                // these may not be regular files, try fallback
                E::INVAL => {
                    copy_file_state.insert(LinuxCopyFileState::HAS_COPY_FILE_RANGE_FAILED);
                }
                // support for cross-filesystem copy added in Linux 5.3
                // and even then, it is frequently not supported.
                E::XDEV => {
                    copy_file_state.insert(LinuxCopyFileState::HAS_SEEN_EXDEV);
                    copy_file_state.insert(LinuxCopyFileState::HAS_COPY_FILE_RANGE_FAILED);
                }
                // syscall added in Linux 4.5, use fallback
                E::OPNOTSUPP | E::NOSYS => {
                    copy_file_state.insert(LinuxCopyFileState::HAS_COPY_FILE_RANGE_FAILED);
                    bun_output::scoped_log!(copy_file, "copy_file_range is NOT supported");
                    CAN_USE_COPY_FILE_RANGE.store(-1, Ordering::Relaxed);
                }
                E::INTR => continue,
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
            E::INTR => continue,
            // these may not be regular files, try fallback
            E::INVAL => {
                copy_file_state.insert(LinuxCopyFileState::HAS_SENDFILE_FAILED);
            }
            // This shouldn't happen?
            E::XDEV => {
                copy_file_state.insert(LinuxCopyFileState::HAS_SEEN_EXDEV);
                copy_file_state.insert(LinuxCopyFileState::HAS_SENDFILE_FAILED);
            }
            // they might not support it
            E::OPNOTSUPP | E::NOSYS => {
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
    match crate::read(Fd::from_native(in_), &mut buf[0..adjusted_count]) {
        Ok(amt_read) => {
            let mut amt_written: usize = 0;
            if amt_read == 0 {
                return Ok(0);
            }

            while amt_written < amt_read {
                match crate::write(Fd::from_native(out), &buf[amt_written..amt_read]) {
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

// TODO(port): `bun.analytics.GenerateHeader.GeneratePlatform` crate path
use bun_analytics::generate_header::GeneratePlatform as Platform;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys/copy_file.zig (324 lines)
//   confidence: medium
//   todos:      9
//   notes:      raw syscall bindings (fcopyfile/copy_file_range/sendfile/CopyFileW), errno_sys helper, and Platform::kernel_version compare API need wiring; LinuxCopyFileState reshaped to bitflags
// ──────────────────────────────────────────────────────────────────────────
