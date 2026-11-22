//! Threads for calls that return only when somebody else has done something, which would use up a pool of a fixed size.

use core::cell::Cell;
use core::time::Duration;
use std::os::windows::io::{AsHandle as _, AsRawHandle as _, BorrowedHandle, OwnedHandle};
use std::sync::Arc;

use bun_sys::windows::{self as w, Win32Error};
use bun_threading::Guarded;
use bun_threading::fifo_pool::{Config, FifoPool};

use crate::sys::{self, Packet, Timeout, WaitPacket};

const STACK_SIZE: usize = 256 * 1024;

/// For a `job` that would keep a thread of the pool for good. `false` if the system has no thread to give.
pub fn spawn_endless(job: impl FnOnce() + Send + 'static) -> bool {
    let thread = std::thread::Builder::new().stack_size(STACK_SIZE);
    let run = || {
        bun_core::Output::Source::configure_thread_no_js();
        job();
    };
    thread.name("Watcher".into()).spawn(run).is_ok()
}

/// `job` starts at once, on a thread of its own.
pub fn spawn(job: impl FnOnce() + Send + 'static) {
    static POOL: FifoPool = FifoPool::new(Config {
        name: "Blocking I/O",
        max_threads: usize::MAX,
        stack_size: STACK_SIZE,
        on_thread_start: match cfg!(test) {
            true => || {},
            false => bun_core::Output::Source::configure_thread_no_js,
        },
        has_new_threads: false,
    });
    POOL.go(job);
}

/// Holds a thread back until another one waits, for whatever it is.
/// <https://learn.microsoft.com/en-us/windows/win32/fileio/i-o-completion-ports#threads-and-concurrency>
pub struct Turnstile {
    port: OwnedHandle,
    signal: Option<WaitPacket>,
}

impl Turnstile {
    pub fn new() -> Result<Turnstile, Win32Error> {
        Ok(Turnstile {
            port: sys::create_port(1)?,
            signal: WaitPacket::new().map_err(Win32Error::from_ntstatus)?,
        })
    }

    /// Lets one `wait` end. From now on, none does while this thread runs.
    pub fn admit(&self) {
        for _ in 0..=self.take(Timeout::Now) {
            sys::post(&self.port, 0, 0);
        }
    }

    /// Lets one `wait` end once `object` is signalled. Does nothing if that is still to come from the last time.
    pub fn admit_after(&self, object: BorrowedHandle<'_>) {
        if let Some(signal) = &self.signal {
            let _ = signal.associate(&self.port, object, 0, 0);
        }
    }

    pub fn wait(&self) {
        self.take(Timeout::Never);
    }

    fn take(&self, timeout: Timeout) -> usize {
        sys::remove_packets(&self.port, &[Cell::new(Packet::EMPTY)], timeout)
    }
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
