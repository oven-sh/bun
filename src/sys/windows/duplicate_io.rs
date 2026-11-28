//! Pool jobs use a duplicate of the caller's descriptor. An `origin` is the `fd_identity` of that descriptor.

use core::cell::Cell;
use core::ptr;
use core::sync::atomic::{AtomicU64, Ordering};
use std::collections::BTreeSet;

use bun_core::Mutex;
use bun_windows_sys::externs::IO_STATUS_BLOCK;

use super::kernel32::{CancelIoEx, ResetEvent, SetEvent};
use super::sync_io::Event;
use super::{HANDLE, fd_table, nt};
use crate::Fd;

thread_local! {
    static READ_ORIGIN: Cell<Option<u64>> = const { Cell::new(None) };
    static FIRST_LATER_WRITE: Cell<Option<u64>> = const { Cell::new(None) };
}

/// Ties the reads of a job to the caller's descriptor.
pub struct ReadOrigin {
    origin: u64,
    /// For the job's first read. The others let one write go first.
    first_later_write: Cell<Option<u64>>,
}

impl ReadOrigin {
    /// Call before `fd` is duplicated.
    pub fn new(fd: Fd) -> ReadOrigin {
        ReadOrigin {
            origin: fd_table::fd_identity(fd),
            first_later_write: Cell::new(Some(NEXT_WRITE.load(Ordering::Relaxed))),
        }
    }

    /// `io` reads from the duplicate.
    pub fn run<T>(&self, io: impl FnOnce() -> T) -> T {
        READ_ORIGIN.set(Some(self.origin));
        FIRST_LATER_WRITE.set(self.first_later_write.take());
        let result = io();
        READ_ORIGIN.set(None);
        result
    }
}

/// A read on an overlapped handle. Closing its origin ends it, as closing the only handle does.
#[derive(Clone, Copy, PartialEq)]
pub(super) struct PendingRead {
    origin: u64,
    file: usize,
    request: usize,
}

/// Each `file` stays open while it is listed.
static PENDING_READS: Mutex<Vec<PendingRead>> = Mutex::new(Vec::new());

impl PendingRead {
    pub(super) fn register(file: HANDLE, request: *mut IO_STATUS_BLOCK) -> Option<PendingRead> {
        let read = PendingRead {
            origin: READ_ORIGIN.get()?,
            file: file.addr(),
            request: request.addr(),
        };
        let mut reads = PENDING_READS.lock();
        if fd_table::was_closed(read.origin) {
            read.cancel();
        }
        reads.push(read);
        Some(read)
    }

    /// Returns whether the origin was closed.
    pub(super) fn unregister(self) -> bool {
        PENDING_READS.lock().retain(|read| *read != self);
        fd_table::was_closed(self.origin)
    }

    fn cancel(self) {
        let file = ptr::without_provenance_mut(self.file);
        // SAFETY: `CancelIoEx` only compares the address of the request.
        unsafe { CancelIoEx(file, ptr::without_provenance_mut(self.request)) };
    }
}

/// Call once `fd_table::was_closed(origin)` holds.
pub(super) fn end_reads(origin: u64) {
    for read in PENDING_READS.lock().iter() {
        if read.origin == origin {
            read.cancel();
        }
    }
}

/// A synchronous handle runs one request at a time, and lets a new read pass a write that waits for its turn. This holds later reads back until it is dropped.
pub struct QueuedWrite {
    origin: u64,
    id: u64,
}

struct WaitingRead {
    origin: u64,
    first_later_write: u64,
    /// Stays open while it is listed.
    event: usize,
}

struct Turns {
    /// `(origin, id)`
    writes: BTreeSet<(u64, u64)>,
    reads: Vec<WaitingRead>,
}

static TURNS: Mutex<Turns> = Mutex::new(Turns {
    writes: BTreeSet::new(),
    reads: Vec::new(),
});

/// Relaxed: only calls on one thread have an order.
static NEXT_WRITE: AtomicU64 = AtomicU64::new(0);

fn first_write(writes: &BTreeSet<(u64, u64)>, origin: u64) -> Option<u64> {
    let mut writes = writes.range((origin, 0)..=(origin, u64::MAX));
    writes.next().map(|&(_, id)| id)
}

impl QueuedWrite {
    pub fn new(origin: u64) -> Option<QueuedWrite> {
        if !fd_table::is_closable(origin) {
            return None;
        }
        let id = NEXT_WRITE.fetch_add(1, Ordering::Relaxed);
        TURNS.lock().writes.insert((origin, id));
        Some(QueuedWrite { origin, id })
    }
}

impl Drop for QueuedWrite {
    fn drop(&mut self) {
        let mut turns = TURNS.lock();
        turns.writes.remove(&(self.origin, self.id));
        let next_write = first_write(&turns.writes, self.origin).unwrap_or(u64::MAX);
        turns.reads.retain(|read| {
            let is_released = read.origin == self.origin && read.first_later_write <= next_write;
            if is_released {
                SetEvent(ptr::without_provenance_mut(read.event));
            }
            !is_released
        });
    }
}

pub(super) fn wait_for_queued_writes(file: HANDLE) {
    let Some(origin) = READ_ORIGIN.get() else {
        return;
    };
    let first_later_write = FIRST_LATER_WRITE.take();
    let Some(next_write) = first_write(&TURNS.lock().writes, origin) else {
        return;
    };
    let first_later_write = first_later_write.unwrap_or(next_write + 1);
    if first_later_write <= next_write || nt::is_synchronous(file) != Ok(true) {
        return;
    }
    let Ok(event) = Event::acquire() else {
        return;
    };
    ResetEvent(event.handle);
    let address = event.handle.addr();
    let mut turns = TURNS.lock();
    if first_write(&turns.writes, origin).is_none_or(|id| first_later_write <= id) {
        return;
    }
    turns.reads.push(WaitingRead {
        origin,
        first_later_write,
        event: address,
    });
    drop(turns);
    if !event.wait_or_interrupt() {
        TURNS.lock().reads.retain(|read| read.event != address);
    }
}
