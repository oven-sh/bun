//! Serializes pool jobs: jobs with the same [`Key`] run one at a time, in call order.

use core::cell::{Cell, RefCell, RefMut};
use std::collections::VecDeque;
use std::sync::Arc;

use bun_collections::ArrayHashMap;
use bun_iocp::PendingWrite;
use bun_jsc::JsThread;
use bun_jsc::job::UnscheduledJob;
use bun_sys::{self as sys, Fd, File};
use bun_threading::Guarded;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Key {
    Descriptor(u64),
    /// Device reads are queued separately, so that writes do not wait for them.
    DeviceInput(u64),
    /// Paths that differ by links, 8.3 names or non-ASCII case get different keys.
    Path(u64),
}

impl Key {
    pub(crate) fn from_fd(fd: Fd) -> Key {
        Key::Descriptor(sys::windows::fd_identity(fd))
    }

    pub(crate) fn from_device_input(fd: Fd) -> Key {
        Key::DeviceInput(sys::windows::fd_identity(fd))
    }

    pub(crate) fn from_path(full_path: &[u8]) -> Key {
        Key::Path(bun_wyhash::hash_ascii_lowercase(0, full_path))
    }
}

#[derive(Default)]
struct JobQueue {
    /// The jobs behind the scheduled one. `None` while no job is scheduled.
    waiting: Guarded<Option<VecDeque<UnscheduledJob>>>,
}

#[derive(Default)]
pub(crate) struct IoOrder {
    queues: RefCell<ArrayHashMap<Key, Arc<JobQueue>>>,
    prune_threshold: Cell<usize>,
}

impl IoOrder {
    fn get_or_create_queue(&self, key: Key) -> RefMut<'_, Arc<JobQueue>> {
        RefMut::map(self.queues.borrow_mut(), |queues| {
            if queues.len() >= self.prune_threshold.get() {
                queues.retain(|_, queue| Arc::strong_count(queue) > 1);
                self.prune_threshold.set(64 + 2 * queues.len());
            }
            queues.entry(key).or_default()
        })
    }
}

/// Holds back the later jobs of a key. Dropping it schedules the next one after the current task returns.
pub(crate) struct OrderGuard {
    queue: Arc<JobQueue>,
    schedule_next: fn(UnscheduledJob),
    pending_write: Option<PendingWrite>,
}

impl OrderGuard {
    /// The job returned by `create_job` must own the `OrderGuard`.
    pub(crate) fn enqueue_job(
        cx: &JsThread<'_>,
        key: Key,
        is_write: bool,
        create_job: impl FnOnce(OrderGuard) -> UnscheduledJob,
    ) {
        let io_order = &crate::jsc_hooks::runtime_state_of(cx.vm()).io_order;
        let queue = io_order.get_or_create_queue(key);
        let job = create_job(OrderGuard {
            queue: Arc::clone(&queue),
            schedule_next: UnscheduledJob::schedule_as_continuation,
            pending_write: is_write.then(|| cx.vm().uws_loop().port().add_pending_write()),
        });
        let mut waiting = queue.waiting.lock();
        if let Some(jobs) = &mut *waiting {
            return jobs.push_back(job);
        }
        *waiting = Some(VecDeque::new());
        drop(waiting);
        job.schedule();
    }

    /// For a task that is about to block: the next job does not wait for it to return.
    pub(crate) fn release_early(mut self) -> Option<PendingWrite> {
        self.schedule_next = UnscheduledJob::schedule;
        self.pending_write.take()
    }
}

impl Drop for OrderGuard {
    fn drop(&mut self) {
        let mut waiting = self.queue.waiting.lock();
        let Some(next) = waiting.as_mut().and_then(VecDeque::pop_front) else {
            *waiting = None;
            return;
        };
        drop(waiting);
        (self.schedule_next)(next);
    }
}

/// A job's reference to a caller-supplied descriptor. A duplicate stays open after the caller closes its own.
pub(crate) enum RetainedFile {
    Duplicate(File),
    Borrowed(Fd),
}

impl RetainedFile {
    pub(crate) fn new(fd: Fd) -> Self {
        if let Some(tag) = fd.stdio_tag() {
            if tag == bun_core::Stdio::StdIn {
                sys::windows::named_pipe::mark_concurrent_reader();
            }
            return Self::Borrowed(fd);
        }
        match sys::dup(fd) {
            Ok(duplicate) => Self::Duplicate(File::from_fd(duplicate)),
            // A bad descriptor is reported by the job's own system call.
            Err(_) => {
                sys::windows::pin_fd_generation(fd).map_or_else(Self::default, Self::Borrowed)
            }
        }
    }
}

impl Default for RetainedFile {
    fn default() -> Self {
        Self::Borrowed(Fd::from_crt(-1))
    }
}

impl core::ops::Deref for RetainedFile {
    type Target = File;
    fn deref(&self) -> &File {
        match self {
            Self::Duplicate(file) => file,
            Self::Borrowed(fd) => File::borrow(fd),
        }
    }
}
