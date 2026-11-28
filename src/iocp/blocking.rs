//! Threads for calls that can block indefinitely, which would exhaust a fixed-size pool.

use core::cell::Cell;
use core::time::Duration;
use std::os::windows::io::{AsHandle as _, AsRawHandle as _, BorrowedHandle, OwnedHandle};
use std::sync::Arc;

use bun_sys::windows::{self as w, Win32Error};
use bun_threading::Guarded;
use bun_threading::fifo_pool::{Config, FifoPool};

use crate::sys::{self, Packet, Timeout, WaitPacket};

const STACK_SIZE: usize = 256 * 1024;

/// For a `job` that would occupy a pool thread forever.
pub fn try_spawn_dedicated(job: impl FnOnce() + Send + 'static) -> bool {
    let builder = std::thread::Builder::new().stack_size(STACK_SIZE);
    let run = || {
        bun_core::Output::Source::configure_thread_no_js();
        job();
    };
    builder.name("Watcher".into()).spawn(run).is_ok()
}

/// `job` does not queue behind other jobs: the pool has no thread limit.
pub fn spawn(job: impl FnOnce() + Send + 'static) {
    static POOL: FifoPool = FifoPool::new(Config {
        name: "Blocking I/O",
        max_threads: usize::MAX,
        stack_size: STACK_SIZE,
        on_thread_start: if cfg!(test) {
            || {}
        } else {
            bun_core::Output::Source::configure_thread_no_js
        },
        has_warmup: false,
        keeps_idle_threads: false,
    });
    POOL.go(job);
}

/// Blocks one thread until another thread enters a wait of any kind.
/// <https://learn.microsoft.com/en-us/windows/win32/fileio/i-o-completion-ports#threads-and-concurrency>
pub struct ConcurrencyGate {
    port: OwnedHandle,
    wait_packet: Option<WaitPacket>,
}

impl ConcurrencyGate {
    pub fn new() -> Result<ConcurrencyGate, Win32Error> {
        Ok(ConcurrencyGate {
            port: sys::create_port(1)?,
            wait_packet: WaitPacket::new().map_err(Win32Error::from_ntstatus)?,
        })
    }

    /// Releases one `wait`. From now on no `wait` returns while the calling thread is running.
    pub fn post(&self) {
        // The dequeue associates this thread with the port. A packet that it removes is posted again.
        for _ in 0..=self.dequeue(Timeout::Zero) {
            sys::post_packet(&self.port, 0, 0);
        }
    }

    /// Releases one `wait` once `object` is signaled. Does nothing while the previous call is still pending.
    pub fn post_on_signal(&self, object: BorrowedHandle<'_>) {
        if let Some(wait_packet) = &self.wait_packet {
            let _ = wait_packet.associate(&self.port, object, 0, 0);
        }
    }

    pub fn wait(&self) {
        self.dequeue(Timeout::Infinite);
    }

    fn dequeue(&self, timeout: Timeout) -> usize {
        sys::dequeue_packets(&self.port, &[Cell::new(Packet::EMPTY)], timeout)
    }
}

struct InterruptibleThread {
    handle: OwnedHandle,
    interrupt_event: OwnedHandle,
}

impl InterruptibleThread {
    fn current() -> Option<Arc<InterruptibleThread>> {
        let handle = sys::open_current_thread()?;
        let interrupt_event = w::CreateEventW().ok()?;
        Some(Arc::new(InterruptibleThread {
            handle,
            interrupt_event,
        }))
    }
}

#[derive(Default)]
struct CancelState {
    is_cancelled: bool,
    has_retry_job: bool,
    thread: Option<Arc<InterruptibleThread>>,
}

/// Interrupts the blocking I/O of another thread.
#[derive(Clone, Default)]
pub struct CancelToken(Arc<Guarded<CancelState>>);

impl CancelToken {
    /// Returns `None` if the token was cancelled before `io` started.
    pub fn run<R>(&self, io: impl FnOnce() -> R) -> Option<R> {
        thread_local! {
            static THREAD: Option<Arc<InterruptibleThread>> = InterruptibleThread::current();
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
        let result = w::with_interrupt_event(thread.interrupt_event.as_handle(), io);
        let mut state = self.0.lock();
        state.thread = None;
        if state.is_cancelled {
            w::reset_event(&thread.interrupt_event);
        }
        Some(result)
    }

    pub fn is_cancelled(&self) -> bool {
        self.0.lock().is_cancelled
    }

    /// Does not interrupt I/O that has already started.
    pub fn mark_cancelled(&self) {
        self.0.lock().is_cancelled = true;
    }

    /// `run` has usually returned when this returns. Otherwise a background job keeps retrying.
    pub fn cancel(&self) {
        for _ in 0..16 {
            if self.try_cancel() {
                return;
            }
            std::thread::yield_now();
        }
        // There is nothing to cancel yet while the thread waits for another process's I/O on the same file.
        if core::mem::replace(&mut self.0.lock().has_retry_job, true) {
            return;
        }
        let this = self.clone();
        spawn(move || {
            let mut backoff = Duration::from_micros(500);
            while !this.try_cancel() {
                std::thread::sleep(backoff);
                backoff = (backoff * 2).min(Duration::from_millis(250));
            }
        });
    }

    /// Returns `true` once the thread has left `run`. The lock keeps it from starting unrelated I/O meanwhile.
    fn try_cancel(&self) -> bool {
        let mut state = self.0.lock();
        state.is_cancelled = true;
        let Some(thread) = &state.thread else {
            return true;
        };
        w::set_event(&thread.interrupt_event);
        sys::cancel_synchronous_io(thread.handle.as_raw_handle());
        false
    }
}
