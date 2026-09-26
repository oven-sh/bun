//! Threads that the portable image did not create.
//!
//! The image's C library gives a thread it creates a thread pointer, where thread-locals, `errno`, the
//! state of the allocator and of locks are found. Windows and libuv run callbacks of the image on threads
//! of their own: a thread of libuv's pool, of the pool of Windows, the thread of a console control
//! handler, a thread that waits for `RegisterWaitForSingleObject`. Such a thread enters the image without
//! a thread pointer.
//!
//! [`enter`] is the first thing a function does that the host OS calls (`bun_portable_macros::win_abi`
//! writes the call): it reads the slot of the thread pointer, and a thread whose slot is empty is adopted
//! by the C library, which gives it a thread structure. The host tells the C library when the thread ends
//! (a fiber local storage callback on Windows, the destructor of a pthread key elsewhere), and the
//! structure is freed.

unsafe extern "C" {
    /// The C library of the image: where the slot of the thread pointer is, from the thread register.
    static __bun_tp_offset: usize;
    /// The C library of the image: gives the calling thread, which has none, a thread pointer.
    safe fn __bun_thread_adopt();
    /// The C library of the image: how many adopted threads there are, and how many there were.
    fn __bun_adopted_threads(ever: *mut core::ffi::c_ulong) -> core::ffi::c_ulong;
}

/// For a thread that has a thread pointer: the load of the offset of the slot, the load of the slot,
/// and a branch that is not taken.
#[cfg(target_arch = "x86_64")]
#[inline(always)]
pub fn enter() {
    let thread_pointer: usize;
    // SAFETY: `__bun_tp_offset` is written once, before `main`. On every host gs is the base of memory
    // that holds the slot at this offset: the TEB on Windows, the keys of the thread on macOS, a word
    // of the C library on Linux, where every thread is the image's and the word is not 0.
    unsafe {
        core::arch::asm!(
            "mov {thread_pointer}, qword ptr [rip + {offset}]",
            "mov {thread_pointer}, qword ptr gs:[{thread_pointer}]",
            offset = sym __bun_tp_offset,
            thread_pointer = out(reg) thread_pointer,
            options(nostack, readonly, preserves_flags),
        );
    }
    if thread_pointer == 0 {
        adopt();
    }
}

#[cfg(target_arch = "x86_64")]
#[cold]
#[inline(never)]
fn adopt() {
    __bun_thread_adopt();
}

/// The threads that were adopted and have not ended, and every thread that was adopted.
pub fn adopted() -> (u64, u64) {
    let mut ever: core::ffi::c_ulong = 0;
    // SAFETY: `ever` is valid for the write.
    let now = unsafe { __bun_adopted_threads(&mut ever) };
    (now as u64, ever as u64)
}
