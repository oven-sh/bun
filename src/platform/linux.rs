//! Platform specific APIs for Linux
//!
//! If an API can be implemented on multiple platforms,
//! it does not belong in this namespace.

use core::ffi::c_long;
use core::sync::atomic::{AtomicU8, Ordering};

use bun_sys::Fd;

pub use bun_alloc::LinuxMemFdAllocator as MemFdAllocator;

/// splice() moves data between two file descriptors without copying
/// between kernel address space and user address space.  It
/// transfers up to len bytes of data from the file descriptor fd_in
/// to the file descriptor fd_out, where one of the file descriptors
/// must refer to a pipe.
pub fn splice(
    fd_in: libc::c_int,
    off_in: Option<&mut i64>,
    fd_out: libc::c_int,
    off_out: Option<&mut i64>,
    len: usize,
    flags: u32,
) -> usize {
    // SAFETY: direct Linux syscall; arguments mirror the kernel ABI for splice(2).
    // TODO(port): confirm whether bun_sys exposes a raw `syscall6` wrapper to use instead of libc::syscall.
    unsafe {
        libc::syscall(
            libc::SYS_splice,
            fd_in as isize as usize,
            off_in.map_or(0usize, |p| p as *mut i64 as usize),
            fd_out as isize as usize,
            off_out.map_or(0usize, |p| p as *mut i64 as usize),
            len,
            flags as usize,
        ) as usize
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum RWFFlagSupport {
    Unknown = 0,
    Unsupported = 2,
    Supported = 1,
}

static RWF_BOOL: AtomicU8 = AtomicU8::new(RWFFlagSupport::Unknown as u8);

impl RWFFlagSupport {
    pub fn is_linux_kernel_version_with_buggy_rwf_nonblock() -> bool {
        bun_core::linux_kernel_version().major == 5
            && matches!(bun_core::linux_kernel_version().minor, 9 | 10)
    }

    pub fn disable() {
        RWF_BOOL.store(RWFFlagSupport::Unsupported as u8, Ordering::Relaxed);
    }

    /// Workaround for https://github.com/google/gvisor/issues/2601
    pub fn is_maybe_supported() -> bool {
        if !cfg!(target_os = "linux") {
            return false;
        }
        // SAFETY: RWF_BOOL only ever stores valid RWFFlagSupport discriminants.
        let current: RWFFlagSupport =
            unsafe { core::mem::transmute::<u8, RWFFlagSupport>(RWF_BOOL.load(Ordering::Relaxed)) };
        match current {
            RWFFlagSupport::Unknown => {
                if Self::is_linux_kernel_version_with_buggy_rwf_nonblock()
                    || bun_core::feature_flag::BUN_FEATURE_FLAG_DISABLE_RWF_NONBLOCK.get()
                {
                    RWF_BOOL.store(RWFFlagSupport::Unsupported as u8, Ordering::Relaxed);
                    return false;
                }

                RWF_BOOL.store(RWFFlagSupport::Supported as u8, Ordering::Relaxed);
                true
            }
            RWFFlagSupport::Supported => true,
            _ => false,
        }
    }
}

/// https://man7.org/linux/man-pages/man2/ioctl_ficlone.2.html
///
/// Support for FICLONE is dependent on the filesystem driver.
pub fn ioctl_ficlone(dest_fd: Fd, srcfd: Fd) -> usize {
    // SAFETY: direct Linux ioctl syscall; FICLONE takes the source fd as its argument.
    unsafe {
        libc::syscall(
            libc::SYS_ioctl,
            dest_fd.native() as usize,
            bun_sys::c::FICLONE as usize,
            // @intCast(srcfd.native()) — valid fds are non-negative
            usize::try_from(srcfd.native()).unwrap(),
        ) as usize
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn sys_epoll_pwait2(
    epfd: i32,
    events: *mut libc::epoll_event,
    maxevents: i32,
    timeout: *const libc::timespec,
    sigmask: *const libc::sigset_t,
) -> isize {
    // SAFETY: direct Linux syscall; arguments mirror the kernel ABI for epoll_pwait2(2).
    unsafe {
        libc::syscall(
            libc::SYS_epoll_pwait2,
            epfd as isize as usize,
            events as usize,
            maxevents as isize as usize,
            timeout as usize,
            sigmask as usize,
            // This is the correct value. glibc claims to pass `sizeof sigset_t` for this argument,
            // which would be 128, but they actually pass 8 which is what the kernel expects.
            // https://github.com/ziglang/zig/issues/12715
            8usize,
        ) as c_long as isize
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/platform/linux.zig (93 lines)
//   confidence: medium
//   todos:      1
//   notes:      raw syscalls via libc::syscall; verify bun_core::{linux_kernel_version, feature_flag} paths in Phase B
// ──────────────────────────────────────────────────────────────────────────
