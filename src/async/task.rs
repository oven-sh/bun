//! The futures of one event loop. See `README.md`.
//!
//! [`Tasks`] owns them. Everything else (a `Waker`, an entry in the loop's queue) holds a [`TaskId`],
//! which is a number: one that outlives its task finds nothing.

use core::cell::{Cell, RefCell};
use core::future::Future;
use core::mem::ManuallyDrop;
use core::pin::Pin;
use core::sync::atomic::{AtomicU64, Ordering};
use core::task::{Context, Poll, RawWaker, RawWakerVTable, Waker};

/// How a task gets back into its loop's queue. Stored in each task.
pub trait Schedule: Copy + 'static {
    /// What the futures of this loop resolve to. [`Tasks::run`] hands it back.
    type Output;

    /// The tasks of the loop that runs on this thread, if one does.
    fn with_tasks<R>(f: impl FnOnce(&Tasks<Self>) -> R) -> Option<R>;

    /// Queue `id` for [`Tasks::run`]. Called on the loop's thread, at most once until it runs.
    fn schedule(self, id: TaskId);
}

const _: () = assert!(usize::BITS == 64, "a TaskId is carried in a pointer");

const INDEX_BITS: u32 = 24;
const GENERATION_BITS: u32 = 27;
const TABLE_BITS: u32 = 12;
const INDEX_MASK: u64 = (1 << INDEX_BITS) - 1;
const GENERATION_MASK: u64 = (1 << GENERATION_BITS) - 1;
const TABLE_MASK: u64 = (1 << TABLE_BITS) - 1;
/// On a `Waker` only: it is one of its task's [`Task::wakers`].
const COUNTED: u64 = 1 << 63;

/// Names a task for as long as it exists, and nothing afterwards.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct TaskId(u64);

impl TaskId {
    fn new(table: u64, index: usize, generation: u64) -> Self {
        Self(table << (INDEX_BITS + GENERATION_BITS) | generation << INDEX_BITS | index as u64)
    }
    fn index(self) -> usize {
        (self.0 & INDEX_MASK) as usize
    }
    fn generation(self) -> u64 {
        self.0 >> INDEX_BITS & GENERATION_MASK
    }
    fn table(self) -> u64 {
        self.0 >> (INDEX_BITS + GENERATION_BITS) & TABLE_MASK
    }

    /// For a queue that stores a pointer. Never null, never dereferenced.
    #[inline]
    pub fn into_ptr(self) -> *mut () {
        core::ptr::without_provenance_mut(self.0 as usize)
    }
    #[inline]
    pub fn from_ptr(ptr: *const ()) -> Self {
        Self(ptr.addr() as u64 & !COUNTED)
    }
}

type BoxedFuture<S> = Pin<Box<dyn Future<Output = <S as Schedule>::Output>>>;

struct Task<S: Schedule> {
    /// `None` while it is being polled.
    future: Option<BoxedFuture<S>>,
    scheduler: S,
    /// How many `Waker`s could still resume it.
    wakers: u32,
    /// In its loop's queue.
    scheduled: bool,
    /// The last `Waker` went away while it was suspended. It is queued once more, to be dropped.
    orphaned: bool,
    /// [`Tasks::run`] was entered again from inside the poll (a nested tick of the loop).
    run_again: bool,
    /// [`Tasks::cancel`] was called from inside the poll.
    cancelled: bool,
}

struct Entry<S: Schedule> {
    generation: u64,
    task: Option<Task<S>>,
    next_free: usize,
}

const NONE_FREE: usize = usize::MAX;

/// Why [`Tasks::spawn`] dropped the future it was given.
#[derive(Debug, PartialEq, Eq)]
pub enum Refused {
    /// The table is [`close`](Tasks::close)d.
    Closed,
    /// It holds as many tasks as an id can tell apart.
    Full,
}

/// Nothing of a task is dropped, polled or scheduled while `entries` is borrowed: all three run code
/// that may come back here.
pub struct Tasks<S: Schedule> {
    table: u64,
    entries: RefCell<Vec<Entry<S>>>,
    first_free: Cell<usize>,
    len: Cell<usize>,
    closed: Cell<bool>,
    running: Cell<Option<TaskId>>,
}

impl<S: Schedule> Default for Tasks<S> {
    fn default() -> Self {
        Self::new()
    }
}

impl<S: Schedule> Tasks<S> {
    pub fn new() -> Self {
        static TABLES: AtomicU64 = AtomicU64::new(0);
        Self {
            // Not 0, so that no id is a null pointer.
            table: TABLES.fetch_add(1, Ordering::Relaxed) % TABLE_MASK + 1,
            entries: RefCell::new(Vec::new()),
            first_free: Cell::new(NONE_FREE),
            len: Cell::new(0),
            closed: Cell::new(false),
            running: Cell::new(None),
        }
    }

    pub fn len(&self) -> usize {
        self.len.get()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Take ownership of `future`. Nothing has polled it: the caller [`run`](Self::run)s it now (it
    /// starts inside the call that spawned it, as an `async function` does) or queues it.
    pub fn spawn(
        &self,
        future: impl Future<Output = S::Output> + 'static,
        scheduler: S,
    ) -> Result<TaskId, Refused> {
        if self.closed.get() {
            return Err(Refused::Closed);
        }
        if self.len.get() > INDEX_MASK as usize {
            return Err(Refused::Full);
        }
        let task = Task {
            future: Some(Box::pin(future)),
            scheduler,
            wakers: 0,
            scheduled: true,
            orphaned: false,
            run_again: false,
            cancelled: false,
        };
        let mut entries = self.entries.borrow_mut();
        let index = self.first_free.get();
        let index = if index == NONE_FREE {
            entries.push(Entry {
                generation: 0,
                task: Some(task),
                next_free: NONE_FREE,
            });
            entries.len() - 1
        } else {
            self.first_free.set(entries[index].next_free);
            entries[index].task = Some(task);
            index
        };
        self.len.set(self.len.get() + 1);
        Ok(TaskId::new(self.table, index, entries[index].generation))
    }

    /// The task whose poll the caller is inside, for what it awaits to remember who awaits it.
    pub fn running(&self) -> Option<TaskId> {
        self.running.get()
    }

    fn get(entries: &mut [Entry<S>], id: TaskId) -> Option<&mut Task<S>> {
        let entry = entries.get_mut(id.index())?;
        if entry.generation != id.generation() {
            return None;
        }
        entry.task.as_mut()
    }

    /// The caller drops what this returns once `entries` is released.
    #[must_use]
    fn remove(&self, entries: &mut [Entry<S>], index: usize) -> Option<Task<S>> {
        let entry = &mut entries[index];
        entry.generation = (entry.generation + 1) & GENERATION_MASK;
        entry.next_free = self.first_free.replace(index);
        self.len.set(self.len.get() - 1);
        entry.task.take()
    }

    pub fn scheduler_of(&self, id: TaskId) -> Option<S> {
        self.on_this_table(id, |task| task.scheduler).flatten()
    }

    /// The loop reached `id` in its queue: poll it. `Some` once it has finished.
    ///
    /// Also for a caller that cannot wait for the queue. An entry `id` has there then polls it once
    /// more, or finds nothing.
    pub fn run(&self, id: TaskId) -> Option<S::Output> {
        let mut future = {
            let mut entries = self.entries.borrow_mut();
            let task = Self::get(&mut entries, id)?;
            task.scheduled = false;
            if task.orphaned {
                let task = self.remove(&mut entries, id.index());
                drop(entries);
                drop(task);
                return None;
            }
            let Some(future) = task.future.take() else {
                task.run_again = true;
                return None;
            };
            future
        };

        // SAFETY: `VTable`'s functions take a number. Never dropped, so it is not one of `wakers`;
        // `COUNTED` so that `will_wake` is true of its clones.
        let waker = ManuallyDrop::new(unsafe { Waker::from_raw(raw_waker::<S>(id.0 | COUNTED)) });
        let outer = self.running.replace(Some(id));
        let poll = future.as_mut().poll(&mut Context::from_waker(&waker));
        self.running.set(outer);

        let mut entries = self.entries.borrow_mut();
        let task = Self::get(&mut entries, id).expect("only `run` removes what it is polling");
        let nothing_can_resume_it = task.wakers == 0 && !task.scheduled && !task.run_again;
        if poll.is_ready() || task.cancelled || nothing_can_resume_it {
            let task = self.remove(&mut entries, id.index());
            drop(entries);
            drop(future);
            drop(task);
            return match poll {
                Poll::Ready(output) => Some(output),
                Poll::Pending => None,
            };
        }
        task.future = Some(future);
        let schedule = core::mem::take(&mut task.run_again) && !task.scheduled;
        task.scheduled |= schedule;
        let scheduler = task.scheduler;
        drop(entries);
        if schedule {
            scheduler.schedule(id);
        }
        None
    }

    /// Drop a task's future now, wherever the task is: suspended, queued, or (from inside its own
    /// poll) as soon as that poll returns. Whether it was dropped by this call.
    pub fn cancel(&self, id: TaskId) -> bool {
        let mut entries = self.entries.borrow_mut();
        let Some(task) = Self::get(&mut entries, id) else {
            return false;
        };
        if task.future.is_none() {
            task.cancelled = true;
            return false;
        }
        let task = self.remove(&mut entries, id.index());
        drop(entries);
        drop(task);
        true
    }

    pub fn any(&self, mut which: impl FnMut(&S) -> bool) -> bool {
        !self.is_empty()
            && (self.entries.borrow().iter()).any(|entry| {
                entry
                    .task
                    .as_ref()
                    .is_some_and(|task| which(&task.scheduler))
            })
    }

    /// [`cancel`](Self::cancel) every task whose scheduler `which` picks. How many were dropped.
    pub fn cancel_where(&self, mut which: impl FnMut(&S) -> bool) -> usize {
        let (mut index, mut cancelled) = (0, 0);
        loop {
            if self.is_empty() {
                return cancelled;
            }
            let id = match self.entries.borrow().get(index) {
                None => return cancelled,
                Some(entry) => (entry.task.as_ref())
                    .filter(|task| which(&task.scheduler))
                    .map(|_| TaskId::new(self.table, index, entry.generation)),
            };
            if let Some(id) = id {
                cancelled += usize::from(self.cancel(id));
            }
            index += 1;
        }
    }

    /// The loop is going away: cancel everything, take nothing more, and keep no memory.
    pub fn close(&self) {
        self.closed.set(true);
        self.cancel_where(|_| true);
        if self.is_empty() {
            self.entries.take();
        }
    }

    /// `None`: `id` is of another loop's table.
    fn on_this_table<R>(&self, id: TaskId, f: impl FnOnce(&mut Task<S>) -> R) -> Option<Option<R>> {
        (id.table() == self.table).then(|| Self::get(&mut self.entries.borrow_mut(), id).map(f))
    }

    fn wake(&self, id: TaskId) -> Option<()> {
        let scheduler = self.on_this_table(id, |task| {
            (!core::mem::replace(&mut task.scheduled, true)).then_some(task.scheduler)
        })?;
        if let Some(scheduler) = scheduler.flatten() {
            scheduler.schedule(id);
        }
        Some(())
    }

    fn waker_cloned(&self, id: TaskId) -> bool {
        self.on_this_table(id, |task| task.wakers += 1)
            .flatten()
            .is_some()
    }

    fn waker_dropped(&self, id: TaskId) {
        let orphan = self.on_this_table(id, |task| {
            task.wakers -= 1;
            // It may be a collector's sweep that drops it, so the future is not dropped from here.
            let is_orphan = task.wakers == 0 && !task.scheduled && task.future.is_some();
            task.orphaned = is_orphan;
            task.scheduled |= is_orphan;
            is_orphan.then_some(task.scheduler)
        });
        if let Some(scheduler) = orphan.flatten().flatten() {
            scheduler.schedule(id);
        }
    }
}

impl<S: Schedule> Drop for Tasks<S> {
    fn drop(&mut self) {
        self.close();
    }
}

// A `Waker` has to be `Send + Sync`, and a number is. What it does on a thread other than its loop's:
// cloned, the clone is not counted; dropped, it stays counted, so its task waits for `cancel`; woken,
// it panics. What another thread has for a task goes through the loop's own cross-thread queue.

struct VTable<S>(core::marker::PhantomData<S>);
impl<S: Schedule> VTable<S> {
    const VTABLE: RawWakerVTable =
        RawWakerVTable::new(clone::<S>, wake::<S>, wake_by_ref::<S>, drop_waker::<S>);
}

#[inline]
fn raw_waker<S: Schedule>(id: u64) -> RawWaker {
    RawWaker::new(
        core::ptr::without_provenance(id as usize),
        &VTable::<S>::VTABLE,
    )
}

fn clone<S: Schedule>(data: *const ()) -> RawWaker {
    let id = TaskId::from_ptr(data);
    let counted = S::with_tasks(|tasks| tasks.waker_cloned(id)) == Some(true);
    raw_waker::<S>(if counted { id.0 | COUNTED } else { id.0 })
}

fn wake<S: Schedule>(data: *const ()) {
    wake_by_ref::<S>(data);
    drop_waker::<S>(data);
}

fn wake_by_ref<S: Schedule>(data: *const ()) {
    S::with_tasks(|tasks| tasks.wake(TaskId::from_ptr(data)))
        .flatten()
        .expect("a task was woken on a thread other than its loop's");
}

fn drop_waker<S: Schedule>(data: *const ()) {
    if data.addr() as u64 & COUNTED != 0 {
        S::with_tasks(|tasks| tasks.waker_dropped(TaskId::from_ptr(data)));
    }
}
