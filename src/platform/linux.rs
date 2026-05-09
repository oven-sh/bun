//! Platform specific APIs for Linux
//!
//! If an API can be implemented on multiple platforms,
//! it does not belong in this namespace.

use core::ffi::{c_int, c_long};
use core::sync::atomic::{AtomicU8, Ordering};

use bun_core::Fd;

// Zig: `pub const MemFdAllocator = bun.allocators.LinuxMemFdAllocator;`
// LAYERING: `LinuxMemFdAllocator` lives in `bun_runtime::allocators` (it pulls in
// `bun_core`/`bun_sys`/`bun_ptr`); `bun_platform` is below `bun_runtime` so cannot
// re-export it. The alias has no consumers — `Blob`/`Store` already path through
// `crate::allocators::linux_mem_fd_allocator` directly.

/// Re-encode a glibc `syscall(2)` wrapper return into the raw-kernel convention used by
/// Zig's `std.os.linux.syscallN`: on error the kernel returns `-errno` in the result
/// register (i.e. a value in `-4095..=-1`), whereas glibc's wrapper translates that to
/// `-1` and stashes the code in thread-local `errno`. Callers of these functions
/// (`bun.sys.getErrno` for `usize`, and the C `epoll_kqueue.c` loop for `isize`) decode
/// errno *from the return value*, so we must put it back in-band.
#[inline(always)]
fn encode_raw_errno(rc: c_long) -> isize {
    if rc == -1 {
        -(bun_core::ffi::errno() as isize)
    } else {
        rc as isize
    }
}

/// splice() moves data between two file descriptors without copying
/// between kernel address space and user address space.  It
/// transfers up to len bytes of data from the file descriptor fd_in
/// to the file descriptor fd_out, where one of the file descriptors
/// must refer to a pipe.
pub fn splice(
    fd_in: c_int,
    off_in: Option<&mut i64>,
    fd_out: c_int,
    off_out: Option<&mut i64>,
    len: usize,
    flags: u32,
) -> usize {
    // SAFETY: direct Linux syscall; arguments mirror the kernel ABI for splice(2).
    let rc = unsafe {
        libc::syscall(
            libc::SYS_splice,
            fd_in as isize as usize,
            off_in.map_or(0usize, |p| std::ptr::from_mut::<i64>(p) as usize),
            fd_out as isize as usize,
            off_out.map_or(0usize, |p| std::ptr::from_mut::<i64>(p) as usize),
            len,
            flags as usize,
        )
    };
    // Callers (e.g. blob copy_file) feed this through `bun.sys.getErrno(usize)` which
    // expects the raw `-errno`-in-high-range encoding of `std.os.linux.syscall6`.
    encode_raw_errno(rc) as usize
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
        let v = bun_core::linux_kernel_version();
        v.major == 5 && matches!(v.minor, 9 | 10)
    }

    pub fn disable() {
        RWF_BOOL.store(RWFFlagSupport::Unsupported as u8, Ordering::Relaxed);
    }

    /// Workaround for https://github.com/google/gvisor/issues/2601
    pub fn is_maybe_supported() -> bool {
        if !cfg!(any(target_os = "linux", target_os = "android")) {
            return false;
        }
        let current: RWFFlagSupport = match RWF_BOOL.load(Ordering::Relaxed) {
            0 => RWFFlagSupport::Unknown,
            1 => RWFFlagSupport::Supported,
            _ => RWFFlagSupport::Unsupported,
        };
        match current {
            RWFFlagSupport::Unknown => {
                if Self::is_linux_kernel_version_with_buggy_rwf_nonblock()
                    || bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_RWF_NONBLOCK::get()
                        .unwrap_or(false)
                {
                    RWF_BOOL.store(RWFFlagSupport::Unsupported as u8, Ordering::Relaxed);
                    return false;
                }

                RWF_BOOL.store(RWFFlagSupport::Supported as u8, Ordering::Relaxed);
                true
            }
            RWFFlagSupport::Supported => true,
            RWFFlagSupport::Unsupported => false,
        }
    }
}

/// https://man7.org/linux/man-pages/man2/ioctl_ficlone.2.html
///
/// Support for FICLONE is dependent on the filesystem driver.
pub fn ioctl_ficlone(dest_fd: Fd, srcfd: Fd) -> usize {
    // SAFETY: direct Linux ioctl syscall; FICLONE takes the source fd as its argument.
    let rc = unsafe {
        libc::syscall(
            libc::SYS_ioctl,
            dest_fd.native() as usize,
            libc::FICLONE as usize,
            // @intCast(srcfd.native()) — valid fds are non-negative
            usize::try_from(srcfd.native()).expect("int cast"),
        )
    };
    // Callers switch on `getErrno(rc)` for XDEV/NOSYS/OPNOTSUPP — must preserve in-band -errno.
    encode_raw_errno(rc) as usize
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
    let rc = unsafe {
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
        )
    };
    // The C caller (epoll_kqueue.c) checks `ret == -EINTR` / `ret != -ENOSYS` against the
    // raw kernel return; mirror `@bitCast(std.os.linux.syscall6(...))` semantics.
    encode_raw_errno(rc)
}

// ported from: src/platform/linux.zig
