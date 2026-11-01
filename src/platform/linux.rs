//! Platform specific APIs for Linux
//!
//! If an API can be implemented on multiple platforms,
//! it does not belong in this namespace.

// LAYERING: `LinuxMemFdAllocator` lives in `bun_runtime::allocators` (it pulls in
// `bun_core`/`bun_sys`/`bun_ptr`); `bun_platform` is below `bun_runtime` so cannot
// re-export it. A re-export here would have no consumers — `Blob`/`Store` already
// path through `crate::allocators::linux_mem_fd_allocator` directly.

/// Raw 6-argument Linux syscall. Returns the kernel return value directly
/// (on error, `-errno` in the range `-4095..=-1`). No libc trampoline, no
/// thread-local `errno` read or write. The C caller in `epoll_kqueue.c`
/// decodes errno from the return value (`ret == -EINTR`, `ret != -ENOSYS`),
/// so the in-band encoding is what it expects. Matches the Zig reference
/// (`std.os.linux.syscall6`), which this replaced.
///
/// # Safety
/// Arguments must be valid for the syscall identified by `nr`.
#[inline(always)]
unsafe fn raw_syscall6(
    nr: usize,
    a1: usize,
    a2: usize,
    a3: usize,
    a4: usize,
    a5: usize,
    a6: usize,
) -> isize {
    #[cfg(target_arch = "x86_64")]
    {
        let ret: isize;
        // SAFETY: Linux x86_64 syscall ABI. `syscall` clobbers rcx and r11;
        // arg4 goes in r10 (not rcx). Memory clobber because the kernel may
        // read/write through the pointer arguments.
        unsafe {
            core::arch::asm!(
                "syscall",
                inlateout("rax") nr as isize => ret,
                in("rdi") a1,
                in("rsi") a2,
                in("rdx") a3,
                in("r10") a4,
                in("r8")  a5,
                in("r9")  a6,
                lateout("rcx") _,
                lateout("r11") _,
                options(nostack),
            );
        }
        return ret;
    }
    #[cfg(target_arch = "aarch64")]
    {
        let ret: isize;
        // SAFETY: Linux aarch64 syscall ABI. Syscall number in x8, args in
        // x0..x5, return in x0. Memory clobber because the kernel may
        // read/write through the pointer arguments.
        unsafe {
            core::arch::asm!(
                "svc #0",
                in("x8") nr,
                inlateout("x0") a1 as isize => ret,
                in("x1") a2,
                in("x2") a3,
                in("x3") a4,
                in("x4") a5,
                in("x5") a6,
                options(nostack),
            );
        }
        return ret;
    }
    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64")))]
    compile_error!("raw_syscall6: unsupported architecture");
}

#[unsafe(no_mangle)]
extern "C" fn sys_epoll_pwait2(
    epfd: i32,
    events: *mut libc::epoll_event,
    maxevents: i32,
    timeout: *const libc::timespec,
    sigmask: *const libc::sigset_t,
) -> isize {
    // SAFETY: direct Linux syscall; arguments mirror the kernel ABI for epoll_pwait2(2).
    unsafe {
        raw_syscall6(
            libc::SYS_epoll_pwait2 as usize,
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
    }
}
