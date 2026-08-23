//! Per-thread alternate signal stack for the crash handler.
//!
//! A native stack overflow faults on the thread's guard page. The kernel has
//! no room to push a signal frame on that stack, so a handler runs only when
//! the signal is delivered on an alternate stack: `SA_ONSTACK` on the handler
//! and `sigaltstack(2)` on the faulting thread. Without both, the default
//! action runs instead and the process dies with SIGSEGV and no output.
//!
//! The main thread gets its alternate stack from `bun_crash_handler::init`
//! (a static buffer). Every other thread bun creates gets one here, from
//! `Output::Source::configure_thread`, and frees it when the thread exits.

use core::cell::Cell;

/// Size of one alternate signal stack, excluding the guard page below it.
/// The crash handler formats the report and walks the faulting frames on it.
pub const ALT_STACK_SIZE: usize = 512 * 1024;

/// The mapping behind this thread's alternate stack. The thread-local
/// destructor drops it when the thread exits.
struct Mapping {
    base: *mut libc::c_void,
    len: usize,
}

impl Drop for Mapping {
    fn drop(&mut self) {
        let mut disable: libc::stack_t = crate::ffi::zeroed();
        disable.ss_flags = libc::SS_DISABLE;
        // SAFETY: `disable` is a valid `stack_t`; a null `old_ss` is permitted.
        unsafe { libc::sigaltstack(&raw const disable, core::ptr::null_mut()) };
        // SAFETY: `base`/`len` describe the mapping `install_for_current_thread`
        // created, and the kernel no longer uses it as a signal stack.
        unsafe { libc::munmap(self.base, self.len) };
    }
}

thread_local! {
    static MAPPING: Cell<Option<Mapping>> = const { Cell::new(None) };
}

/// Register an alternate signal stack for the calling thread.
///
/// No-op when the thread already has one: the main thread (static buffer from
/// the crash handler), a thread that called this before, or a thread ASAN set
/// up. Failure is silent: the thread then behaves as before this existed.
pub fn install_for_current_thread() {
    let mut current: libc::stack_t = crate::ffi::zeroed();
    // SAFETY: a null `ss` only queries; `current` is a valid out-pointer.
    if unsafe { libc::sigaltstack(core::ptr::null(), &raw mut current) } != 0
        || current.ss_flags & libc::SS_DISABLE == 0
    {
        return;
    }

    // SAFETY: `sysconf` has no preconditions.
    let page = match usize::try_from(unsafe { libc::sysconf(libc::_SC_PAGESIZE) }) {
        Ok(page) if page > 0 => page,
        _ => 4096,
    };
    let len = ALT_STACK_SIZE + page;
    // SAFETY: anonymous private mapping; no file, no fixed address.
    let base = unsafe {
        libc::mmap(
            core::ptr::null_mut(),
            len,
            libc::PROT_READ | libc::PROT_WRITE,
            libc::MAP_PRIVATE | libc::MAP_ANONYMOUS,
            -1,
            0,
        )
    };
    if base == libc::MAP_FAILED {
        return;
    }
    // Guard page at the low end: if the handler itself overflows, it faults
    // here instead of writing into whatever the kernel mapped below.
    // SAFETY: `base` is page-aligned and the first page belongs to the mapping.
    unsafe { libc::mprotect(base, page, libc::PROT_NONE) };

    let mut stack: libc::stack_t = crate::ffi::zeroed();
    // SAFETY: `page` is within the mapping of `len` bytes.
    stack.ss_sp = unsafe { base.byte_add(page) };
    stack.ss_size = ALT_STACK_SIZE;
    // SAFETY: `stack` describes a live, writable mapping; a null `old_ss` is
    // permitted.
    if unsafe { libc::sigaltstack(&raw const stack, core::ptr::null_mut()) } != 0 {
        // SAFETY: the mapping was never registered; nothing else references it.
        unsafe { libc::munmap(base, len) };
        return;
    }
    MAPPING.with(|slot| slot.set(Some(Mapping { base, len })));
}
