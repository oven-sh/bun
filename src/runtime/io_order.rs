//! A pool runs several tasks at once. Jobs with the same [`Key`] run one after the other, in the order of the calls.

use core::cell::OnceCell;
use std::collections::VecDeque;
use std::sync::Arc;

use bun_collections::ArrayHashMap;
use bun_iocp::PendingWrite;
use bun_jsc::JsThread;
use bun_jsc::job::Unstarted;
use bun_sys::{self as sys, Fd, File};
use bun_threading::Guarded;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Key {
    Descriptor(u64),
    /// What is written to a device does not wait for what is read from it.
    DeviceInput(u64),
    /// Links, short names and the case of letters outside of ASCII are not seen through.
    Path(u64),
}

impl Key {
    pub(crate) fn descriptor(fd: Fd) -> Key {
        Key::Descriptor(sys::windows::identity(fd))
    }

    pub(crate) fn device_input(fd: Fd) -> Key {
        Key::DeviceInput(sys::windows::identity(fd))
    }

    pub(crate) fn path(full_path: &[u8]) -> Key {
        Key::Path(bun_wyhash::hash_ascii_lowercase(0, full_path))
    }
}

/// The jobs behind the one that has the [`Turn`].
type Queues = Arc<Guarded<ArrayHashMap<Key, VecDeque<Unstarted>>>>;

#[derive(Default)]
pub(crate) struct IoOrder(OnceCell<Queues>);

/// The next job starts when the task that drops this returns.
pub(crate) struct Turn {
    queues: Queues,
    key: Key,
    start_next: fn(Unstarted),
    _pending: Option<PendingWrite>,
}

impl Turn {
    /// The job that `create` returns owns the `Turn`.
    pub(crate) fn after_earlier(
        cx: &JsThread<'_>,
        key: Key,
        is_write: bool,
        create: impl FnOnce(Turn) -> Unstarted,
    ) {
        let order = &crate::jsc_hooks::runtime_state_of(cx.vm()).io_order;
        let queues = order.0.get_or_init(Queues::default);
        let turn = Turn {
            queues: Arc::clone(queues),
            key,
            start_next: Unstarted::start_after_this_task,
            _pending: is_write.then(|| cx.vm().uws_loop().port().pending_write()),
        };
        start_or_queue(queues, key, create(turn));
    }

    /// For a task that goes on to wait.
    pub(crate) fn pass_on_now(mut self) {
        self.start_next = Unstarted::start;
    }
}

fn start_or_queue(queues: &Queues, key: Key, job: Unstarted) {
    let mut queues = queues.lock();
    if let Some(queue) = queues.get_mut(&key) {
        return queue.push_back(job);
    }
    queues.insert(key, VecDeque::new());
    drop(queues);
    job.start();
}

impl Drop for Turn {
    fn drop(&mut self) {
        let mut queues = self.queues.lock();
        let Some(next) = queues.get_mut(&self.key).and_then(VecDeque::pop_front) else {
            queues.swap_remove(&self.key);
            return;
        };
        drop(queues);
        (self.start_next)(next);
    }
}

/// The file of a job that was given a descriptor.
pub(crate) enum KeptOpen {
    Duplicate(File),
    Borrowed(Fd),
}

impl KeptOpen {
    pub(crate) fn new(fd: Fd) -> KeptOpen {
        if fd.stdio_tag().is_some() {
            return KeptOpen::Borrowed(fd);
        }
        match sys::dup(fd) {
            Ok(duplicate) => Self::Duplicate(File::from_fd(duplicate)),
            // The job reports a bad descriptor.
            Err(_) => sys::windows::pinned(fd).map_or_else(Self::default, Self::Borrowed),
        }
    }
}

impl Default for KeptOpen {
    fn default() -> Self {
        Self::Borrowed(Fd::from_crt(-1))
    }
}

impl core::ops::Deref for KeptOpen {
    type Target = File;
    fn deref(&self) -> &File {
        match self {
            KeptOpen::Duplicate(file) => file,
            KeptOpen::Borrowed(fd) => File::borrow(fd),
        }
    }
}
