//! Stops another thread of the process wherever it is, to look at its registers and its stack.

#[cfg_attr(target_os = "macos", path = "mach.rs")]
#[cfg_attr(windows, path = "windows.rs")]
#[cfg_attr(all(unix, not(target_os = "macos")), path = "signal.rs")]
mod system;

use std::sync::Arc;

use bun_threading::guarded::GuardedLock;
use bun_threading::{Guarded, Mutex, MutexGuard};

#[cfg(all(unix, not(target_os = "macos")))]
pub use system::SIGNAL;

static LOCK: Mutex = Mutex::new();

/// No thread is suspended but by the holder, so two threads cannot stop each other.
pub struct SuspendLock {
    _guard: MutexGuard,
}

impl SuspendLock {
    pub fn lock() -> SuspendLock {
        SuspendLock {
            _guard: LOCK.lock_guard(),
        }
    }
}

/// Before the first `ThreadHandle`. Does nothing the second time.
pub fn initialize() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(system::initialize);
}

#[derive(Clone, Copy, Debug)]
pub struct Registers {
    pub program_counter: usize,
    pub stack_pointer: usize,
    pub frame_pointer: usize,
    /// `r12` or `x20`, where the interpreter has it.
    pub bytecode_pointer: usize,
    #[cfg(target_arch = "aarch64")]
    pub link_register: usize,
}

struct Thread {
    system: system::Thread,
    id: u64,
    has_ended: Guarded<bool>,
}

struct EndsWithThread(Arc<Thread>);

impl Drop for EndsWithThread {
    fn drop(&mut self) {
        *self.0.has_ended.lock() = true;
    }
}

thread_local! {
    static CURRENT: EndsWithThread = EndsWithThread(Arc::new(Thread {
        system: system::Thread::current(),
        id: bun_threading::current_thread_id(),
        has_ended: Guarded::new(false),
    }));
}

#[derive(Clone)]
pub struct ThreadHandle(Arc<Thread>);

impl ThreadHandle {
    pub fn current() -> ThreadHandle {
        initialize();
        CURRENT.with(|current| ThreadHandle(Arc::clone(&current.0)))
    }

    /// `None` if the thread has ended. It may hold any lock, those of the allocator too, so the caller must wait for none.
    /// Panics if it is the current thread.
    pub fn suspend<'a>(&'a self, _: &'a mut SuspendLock) -> Option<Suspended<'a>> {
        let has_ended = self.0.has_ended.lock();
        if *has_ended {
            return None;
        }
        assert!(self.0.id != bun_threading::current_thread_id());
        // SAFETY: the thread cannot end while the result has the guard, and the borrow of the lock keeps other requests out.
        let registers = unsafe { self.0.system.suspend() }?;
        Some(Suspended {
            thread: &self.0.system,
            registers,
            _has_ended: has_ended,
        })
    }
}

/// The thread goes on when this is dropped.
pub struct Suspended<'a> {
    thread: &'a system::Thread,
    registers: Registers,
    _has_ended: GuardedLock<'a, bool, Mutex>,
}

impl Suspended<'_> {
    /// They describe another stack than that of the thread if it was handling a signal there.
    pub fn registers(&self) -> &Registers {
        &self.registers
    }
}

impl Drop for Suspended<'_> {
    fn drop(&mut self) {
        // SAFETY: this has suspended it.
        unsafe { self.thread.resume() }
    }
}
