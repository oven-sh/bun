//! Process-wide, per-fd, reentrant lock around "one message to fd 1 / fd 2".
//!
//! Every JS thread has its own stdio sink for stdout and stderr (poll
//! registration, `'drain'` delivery and keep-alive are event-loop-affine), but
//! they all end at the same two file descriptors. Holding this lock for the
//! duration of one console message / one synchronous drain is what keeps a
//! worker's `console.log` from landing in the middle of the main thread's.
//! Reentrant per thread because formatting can re-enter (`console.log` inside
//! a getter that `console.log`s).

use core::cell::Cell;

use bun_sys::Fd;
use bun_threading::Mutex;

static STDOUT_MUTEX: Mutex = Mutex::new();
static STDERR_MUTEX: Mutex = Mutex::new();

thread_local! {
    static DEPTH: [Cell<u16>; 2] = const { [Cell::new(0), Cell::new(0)] };
}

#[inline]
fn slot(fd: Fd) -> Option<usize> {
    if fd == Fd::stdout() {
        Some(0)
    } else if fd == Fd::stderr() {
        Some(1)
    } else {
        None
    }
}

#[inline]
fn mutex(slot: usize) -> &'static Mutex {
    if slot == 0 {
        &STDOUT_MUTEX
    } else {
        &STDERR_MUTEX
    }
}

/// RAII guard; no-op for fds other than 1 and 2.
pub struct StdioLock(Option<usize>);

impl StdioLock {
    #[inline]
    pub fn acquire(fd: Fd) -> Self {
        let slot = slot(fd);
        if let Some(i) = slot {
            DEPTH.with(|d| {
                if d[i].get() == 0 {
                    mutex(i).lock();
                }
                d[i].set(d[i].get() + 1);
            });
        }
        Self(slot)
    }
}

impl Drop for StdioLock {
    #[inline]
    fn drop(&mut self) {
        if let Some(i) = self.0 {
            DEPTH.with(|d| {
                d[i].set(d[i].get() - 1);
                if d[i].get() == 0 {
                    mutex(i).unlock();
                }
            });
        }
    }
}
