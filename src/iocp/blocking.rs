//! Threads for calls that return only when somebody else has done something, which would use up a pool of a fixed size.

use core::time::Duration;
use std::os::windows::io::{AsHandle as _, AsRawHandle as _, OwnedHandle};
use std::sync::Arc;

use bun_sys::windows as w;
use bun_threading::Guarded;
use bun_threading::fifo_pool::{Config, FifoPool};

use crate::sys;

/// `job` starts at once, on a thread of its own.
pub fn spawn(job: impl FnOnce() + Send + 'static) {
    static POOL: FifoPool = FifoPool::new(Config {
        name: "Blocking I/O",
        max_threads: usize::MAX,
        stack_size: 256 * 1024,
        on_thread_start: match cfg!(test) {
            true => || {},
            false => bun_core::Output::Source::configure_thread_no_js,
        },
        has_new_threads: false,
    });
    POOL.go(job);
}

struct Thread {
    handle: OwnedHandle,
    interrupt: OwnedHandle,
}

impl Thread {
    fn current() -> Option<Arc<Thread>> {
        let (handle, interrupt) = (sys::open_current_thread()?, w::CreateEventW().ok()?);
        Some(Arc::new(Thread { handle, interrupt }))
    }
}

#[derive(Default)]
struct CancelState {
    is_cancelled: bool,
    is_retried: bool,
    thread: Option<Arc<Thread>>,
}

/// Interrupts the I/O that another thread waits for.
#[derive(Clone, Default)]
pub struct Cancel(Arc<Guarded<CancelState>>);

impl Cancel {
    /// `None` if it was cancelled before it started.
    pub fn run<R>(&self, io: impl FnOnce() -> R) -> Option<R> {
        thread_local! {
            static THREAD: Option<Arc<Thread>> = Thread::current();
        }
        let thread = THREAD.with(Clone::clone);
        {
            let mut state = self.0.lock();
            if state.is_cancelled {
                return None;
            }
            state.thread.clone_from(&thread);
        }
        let Some(thread) = thread else {
            return Some(io());
        };
        let result = w::interruptible(thread.interrupt.as_handle(), io);
        let mut state = self.0.lock();
        state.thread = None;
        if state.is_cancelled {
            w::reset_event(&thread.interrupt);
        }
        Some(result)
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.lock().is_cancelled
    }

    /// Leaves I/O that has started alone.
    pub fn cancel_unless_started(&self) {
        self.0.lock().is_cancelled = true;
    }

    /// `run` has most likely returned when this does.
    pub fn cancel(&self) {
        for _ in 0..16 {
            if self.try_cancel() {
                return;
            }
            std::thread::yield_now();
        }
        // There is nothing to cancel yet while the thread waits for the I/O of another process on the same file.
        if core::mem::replace(&mut self.0.lock().is_retried, true) {
            return;
        }
        let this = self.clone();
        spawn(move || {
            let mut pause = Duration::from_micros(500);
            while !this.try_cancel() {
                std::thread::sleep(pause);
                pause = (pause * 2).min(Duration::from_millis(250));
            }
        });
    }

    /// `true` once the thread is out of `run`. The lock keeps it from starting I/O for somebody else.
    fn try_cancel(&self) -> bool {
        let mut state = self.0.lock();
        state.is_cancelled = true;
        let Some(thread) = &state.thread else {
            return true;
        };
        w::set_event(&thread.interrupt);
        sys::cancel_synchronous_io(thread.handle.as_raw_handle());
        false
    }
}
