//! Heap tasks handed to a pool by a job that outlives them: the group counts
//! what it has queued and its `Drop` waits for every one to have run, so a
//! task type may borrow what the group's owner keeps alive (`T` need not be
//! `'static`).

use crate::WaitGroup;
use crate::thread_pool::{Batch, Node, Task, ThreadPool};

/// The intrusive pool node of a [`GroupTask`]: a [`Task`] plus the counter of
/// the group it was queued through.
#[repr(C)]
pub struct GroupedTask {
    /// First, so the pool's `*mut Task` is also this struct's address.
    task: Task,
    group: *const WaitGroup,
}

// SAFETY: `group` points at a `TaskGroup`'s `WaitGroup` (itself `Sync`) and
// is only dereferenced by the pool thread that runs the task; the node is
// otherwise plain data.
unsafe impl Send for GroupedTask {}
// SAFETY: as above — nothing is reachable through `&GroupedTask`.
unsafe impl Sync for GroupedTask {}

impl Default for GroupedTask {
    fn default() -> Self {
        Self {
            task: Task {
                node: Node::default(),
                callback: |_| unreachable!("GroupedTask run without a TaskGroup"),
            },
            group: core::ptr::null(),
        }
    }
}

/// A `Box`-owned, `Send` value the pool runs once via [`TaskGroup::schedule`]:
/// [`run`](GroupTask::run) receives the box on a worker thread.
/// [`bun_core::IntrusiveField<GroupedTask>`] (from `bun_core::intrusive_field!`)
/// names the embedded node.
pub trait GroupTask: bun_core::IntrusiveField<GroupedTask> + Send + Sized {
    fn run(self: Box<Self>);
}

fn run_grouped<T: GroupTask>(task: *mut Task) {
    let node = task.cast::<GroupedTask>();
    // SAFETY: `task` is the `GroupedTask` (its first member) inside the
    // `Box<T>` `TaskGroup::push` leaked; the pool runs this once for it.
    let (group, this) = unsafe { ((*node).group, Box::from_raw(T::from_field_ptr(node))) };
    this.run();
    // SAFETY: `group` is the `TaskGroup`'s boxed `WaitGroup`, counted for this
    // task; `finish_raw` is this thread's last access to it.
    unsafe { WaitGroup::finish_raw(group) };
}

/// Counts the [`GroupTask`]s it has queued; [`wait`](Self::wait) (and `Drop`)
/// block until every one has run.
pub struct TaskGroup {
    /// Boxed so queued tasks can point at it while `self` moves.
    group: Box<WaitGroup>,
}

impl Default for TaskGroup {
    fn default() -> Self {
        Self::new()
    }
}

impl TaskGroup {
    pub fn new() -> Self {
        Self {
            group: Box::new(WaitGroup::init()),
        }
    }

    /// Block until every task queued so far has run.
    pub fn wait(&self) {
        self.group.wait();
    }

    /// Add `task` to `batch`; the pool that runs the batch owns the box until
    /// `T::run` receives it.
    pub fn push<T: GroupTask>(&self, batch: &mut Batch, mut task: Box<T>) {
        let node: &mut GroupedTask = task.field_mut();
        node.task.callback = run_grouped::<T>;
        node.group = &raw const *self.group;
        self.group.add_one();
        let raw = Box::into_raw(task);
        // SAFETY: `raw` is the live allocation just leaked; `field_of` projects
        // to its embedded node, whose first member is the `Task`.
        batch.push(Batch::from(unsafe { T::field_of(raw) }.cast::<Task>()));
    }

    /// Queue `task` on `pool`.
    pub fn schedule<T: GroupTask>(&self, pool: &ThreadPool, task: Box<T>) {
        let mut batch = Batch::default();
        self.push(&mut batch, task);
        pool.schedule(batch);
    }

    /// [`schedule`](Self::schedule) from one of `pool`'s own threads (may run
    /// on this thread's local queue).
    pub fn schedule_inside_thread_pool<T: GroupTask>(&self, pool: &ThreadPool, task: Box<T>) {
        let mut batch = Batch::default();
        self.push(&mut batch, task);
        pool.schedule_inside_thread_pool(batch);
    }
}

impl Drop for TaskGroup {
    fn drop(&mut self) {
        self.group.wait();
    }
}
