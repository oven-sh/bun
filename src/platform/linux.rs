//! Platform specific APIs for Linux
//!
//! If an API can be implemented on multiple platforms,
//! it does not belong in this namespace.

use core::ffi::c_long;

// LAYERING: `LinuxMemFdAllocator` lives in `bun_runtime::allocators` (it pulls in
// `bun_core`/`bun_sys`/`bun_ptr`); `bun_platform` is below `bun_runtime` so cannot
// re-export it. A re-export here would have no consumers — `Blob`/`Store` already
// path through `crate::allocators::linux_mem_fd_allocator` directly.

/// Re-encode a glibc `syscall(2)` wrapper return into the raw-kernel
/// convention: on error the kernel returns `-errno` in the result
/// register (i.e. a value in `-4095..=-1`), whereas glibc's wrapper translates that to
/// `-1` and stashes the code in thread-local `errno`. The caller (the C
/// `epoll_kqueue.c` loop) decodes errno *from the return value*, so we must put it
/// back in-band.
#[inline(always)]
fn encode_raw_errno(rc: c_long) -> isize {
    if rc == -1 {
        -(bun_core::ffi::errno() as isize)
    } else {
        rc as isize
    }
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn sys_epoll_pwait2(
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
            // which would be 128, but they actually pass 8 which is what the kernel expects:
            // the raw syscall validates sigsetsize against the kernel's sigset_t (sizeof(u64)),
            // not glibc's 128-byte userspace sigset_t. See epoll_pwait2(2).
            8usize,
        )
    };
    // The C caller (epoll_kqueue.c) checks `ret == -EINTR` / `ret != -ENOSYS` against the
    // raw kernel return, so encode errno back in-band.
    encode_raw_errno(rc)
}
