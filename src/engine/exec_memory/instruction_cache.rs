//! Makes written instructions visible to the part of the processor that fetches them.

#[cfg(target_arch = "x86_64")]
pub(crate) fn flush(_start: usize, _len: usize) {}

#[cfg(all(target_arch = "aarch64", target_os = "macos"))]
pub(crate) fn flush(start: usize, len: usize) {
    unsafe extern "C" {
        safe fn sys_icache_invalidate(start: usize, len: usize);
    }
    sys_icache_invalidate(start, len);
}

#[cfg(all(target_arch = "aarch64", windows))]
pub(crate) fn flush(start: usize, len: usize) {
    const CURRENT_PROCESS: isize = -1;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        safe fn FlushInstructionCache(process: isize, start: usize, len: usize) -> i32;
    }
    FlushInstructionCache(CURRENT_PROCESS, start, len);
}

#[cfg(all(target_arch = "aarch64", not(any(target_os = "macos", windows))))]
pub(crate) fn flush(start: usize, len: usize) {
    use core::arch::asm;

    let cache_type: u64;
    // SAFETY: the register is readable in user mode on these systems.
    unsafe {
        asm!("mrs {}, ctr_el0", out(reg) cache_type, options(nomem, nostack, preserves_flags))
    };
    let lines = |log2_words: u64| {
        let size = 4 << (log2_words & 15);
        (start & !(size - 1)..start + len).step_by(size)
    };
    let data_is_coherent = cache_type >> 28 & 1 != 0;
    let instructions_are_coherent = cache_type >> 29 & 1 != 0;
    if !data_is_coherent {
        for line in lines(cache_type >> 16) {
            // SAFETY: the pages of the range are mapped, and their contents do not change.
            unsafe { asm!("dc cvau, {}", in(reg) line, options(nostack, preserves_flags)) };
        }
    }
    // SAFETY: a barrier.
    unsafe { asm!("dsb ish", options(nostack, preserves_flags)) };
    if !instructions_are_coherent {
        for line in lines(cache_type) {
            // SAFETY: as above.
            unsafe { asm!("ic ivau, {}", in(reg) line, options(nostack, preserves_flags)) };
        }
        // SAFETY: a barrier.
        unsafe { asm!("dsb ish", options(nostack, preserves_flags)) };
    }
    synchronize_instructions();
}

/// For a thread that is about to run code which another thread wrote.
#[inline]
pub fn synchronize_instructions() {
    #[cfg(target_arch = "aarch64")]
    // SAFETY: a barrier.
    unsafe {
        core::arch::asm!("isb", options(nostack, preserves_flags));
    }
}

/// Before other threads can get at new code by no more than loading its address.
#[cfg(target_arch = "x86_64")]
#[inline]
pub fn synchronize_instructions_of_all_threads() {}

/// Old kernels and some sandboxes refuse. Then the invalidation of the caches, which all processors obey, has to do.
#[cfg(all(target_arch = "aarch64", not(any(target_os = "macos", windows))))]
pub fn synchronize_instructions_of_all_threads() {
    const SYNCHRONIZE: i32 = 1 << 5;
    const REGISTER: i32 = 1 << 6;
    #[cfg(target_os = "freebsd")]
    unsafe extern "C" {
        safe fn membarrier(command: i32, flags: u32, processor: i32) -> i32;
    }
    #[cfg(not(target_os = "freebsd"))]
    fn membarrier(command: i32, flags: u32, processor: i32) -> libc::c_long {
        // SAFETY: no pointers.
        unsafe { libc::syscall(libc::SYS_membarrier, command, flags, processor) }
    }
    static IS_REGISTERED: std::sync::LazyLock<bool> =
        std::sync::LazyLock::new(|| membarrier(REGISTER, 0, 0) == 0);
    if *IS_REGISTERED {
        membarrier(SYNCHRONIZE, 0, 0);
    }
}

/// A thread whose registers are read passes through the kernel.
#[cfg(all(target_arch = "aarch64", target_os = "macos"))]
pub fn synchronize_instructions_of_all_threads() {
    const THREAD_STATE: i32 = 6;
    const STATE_WORDS: u32 = 68;
    const ABORTED: i32 = 14;
    unsafe extern "C" {
        static mach_task_self_: u32;
        fn thread_get_state(thread: u32, flavor: i32, state: *mut u32, count: *mut u32) -> i32;
        fn mach_port_deallocate(task: u32, name: u32) -> i32;
    }
    let (mut threads, mut count) = (core::ptr::null_mut(), 0);
    let mut state = [0; STATE_WORDS as usize];
    // SAFETY: the list has `count` names, each of which is given back, and then the list itself.
    unsafe {
        let task = mach_task_self_;
        if libc::task_threads(task, &raw mut threads, &raw mut count) != 0 {
            return;
        }
        let this_thread = libc::pthread_mach_thread_np(libc::pthread_self());
        for &thread in core::slice::from_raw_parts(threads, count as usize) {
            let mut read_state = || {
                let mut words = STATE_WORDS;
                thread_get_state(thread, THREAD_STATE, state.as_mut_ptr(), &raw mut words)
            };
            while thread != this_thread && read_state() == ABORTED {}
            mach_port_deallocate(task, thread);
        }
        libc::vm_deallocate(task, threads.addr(), count as usize * size_of::<u32>());
    }
}

/// It interrupts every processor that runs a thread of the process.
#[cfg(all(target_arch = "aarch64", windows))]
pub fn synchronize_instructions_of_all_threads() {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        safe fn FlushProcessWriteBuffers();
    }
    FlushProcessWriteBuffers();
}
