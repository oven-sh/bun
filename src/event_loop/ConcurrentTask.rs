//! A task that runs concurrently in the work pool.
//!
//! This is used to run tasks that are CPU-intensive or blocking on the work pool.
//! It's also used to run tasks that need to be run on a different thread than the main JavaScript thread.
//!
//! The task is run on a thread pool and then the result is returned to the main JavaScript thread.
//!
//! If `auto_delete` is true, the task is automatically deallocated when it's finished.
//! Otherwise, it's expected that the containing struct will deallocate the task.

use core::mem::MaybeUninit;
use core::ptr::NonNull;

use bun_threading::UnboundedQueue;
use bun_threading::unbounded_queue::{Link, Linked};

// ─── Task (hot-dispatch tag+ptr, see PORTING.md §Dispatch) ──────────────────
// Low tier (event_loop) stores `(tag, payload)`; `bun_runtime::dispatch::run_task`
// owns the `match` over ~96 variants. Tag constants live in
// `crate::task_tag::*` below.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct TaskTag(pub u8);

/// Tag constants for `Task` — one per dispatchable task type. Values are
/// sequential by source
/// order; `bun_runtime::dispatch::run_task` matches on these. Both sides MUST
/// agree — adding a variant requires updating both this list and the runtime
/// match arm.
// The tag table (here) is split from the type→arm mapping (runtime tier-6).
#[allow(non_upper_case_globals)]
pub mod task_tag {
    use super::TaskTag;
    macro_rules! tags {
        ($($name:ident),* $(,)?) => {
            tags!(@ 0u8, $($name,)*);
            /// Number of task tags. `bun_runtime::dispatch::run_task` asserts
            /// exhaustiveness against this.
            pub const COUNT: u8 = tags!(@count 0u8, $($name,)*);
            /// For diagnostics.
            pub const NAMES: [&str; COUNT as usize] = [$(stringify!($name)),*];
        };
        (@ $n:expr, $head:ident, $($rest:ident,)*) => {
            pub const $head: TaskTag = TaskTag($n);
            tags!(@ $n + 1u8, $($rest,)*);
        };
        (@ $n:expr,) => {};
        (@count $n:expr, $head:ident, $($rest:ident,)*) => { tags!(@count $n + 1u8, $($rest,)*) };
        (@count $n:expr,) => { $n };
    }
    tags! {
        AnyTaskJob,               // bun_jsc::Job<C> (typed pool job, one erased tag)
        BakePendingReloadEvent,   // bake::dev_server::PendingReloadEvent
        BundleV2DeferredBatchTask, // bun_bundler::DeferredBatchTask::DeferredBatch
        BundleV2PluginResolve,    // bun.bundle_v2.Resolve (JS-thread hop)
        BundleV2PluginLoad,       // bun.bundle_v2.Load (JS-thread hop)
        BundleV2PluginResolveAnswered, // bun.bundle_v2.Resolve (hop back to the bundle's loop)
        BundleV2PluginLoadAnswered, // bun.bundle_v2.Load (hop back to the bundle's loop)
        BundleV2PluginLoadDeferred, // bun.bundle_v2.Load (`.defer()` notice to the bundle's loop)
        BundleV2ParseTaskResult,  // bun.bundle_v2.ParseTask.Result
        ChromePipeEvent,
        DnsErrorDeferred,
        ShellYesTask,             // shell.Interpreter.Builtin.Yes.YesTask
        CppTask,
        DuplexUpgradeContext,
        DuplexUpgradeContextFree,
        FetchTasklet,
        FetchTaskletDeinit,
        FetchTaskletPromiseSettle,
        FetchTaskletRequestDrain,
        FetchTaskletTrace,
        FSWatchTask,
        GraphContextStopAgain,
        GraphContextStopAndFree,
        DeadContextStopAgain,
        HandledPromise,
        HotReloadTask,
        HTMLRewriterBackgroundPull,
        JSBundleCompletionTask,
        JSCDeferredWorkTask,
        NapiAsyncWork,            // FinishedAsyncWork
        NapiFinalizerTask,
        NativePromiseContextDeferredDerefTask,
        PosixSignalTask,
        MemoryPressureTask,
        ProcessWaiterThreadTask,
        FlushPendingFileSinkTask,
        RunTestsTask,
        RuntimeTranspilerStore,
        S3HttpDownloadStreamingTask,
        S3HttpSimpleTask,
        S3RefusedRequest,
        S3UploadWriterCollected,  // NetworkSink (its `writer()` was collected before `end()`)
        SendQueueDeferred,        // bun_runtime::ipc::SendQueue (close / after-close hop)
        ServerAllConnectionsClosedTask,
        HTTPServerDeinit,
        HTTPSServerDeinit,
        DebugHTTPServerDeinit,
        DebugHTTPSServerDeinit,
        ShellAsync,
        ShellCondExprStatTask,
        ShellCpTask,
        ShellGlobTask,
        ShellLsTask,
        ShellMkdirTask,
        ShellMvBatchedTask,
        ShellMvCheckTargetTask,
        ShellRmDirTask,
        ShellRmTask,
        ShellTouchTask,
        StatWatcherTimerUpdate,
        StatWatcherHop,
        AsyncCpTask,
        ShellAsyncCpTask,
        StreamPending,
        ThreadSafeFunction,
        ThreadSafeFunctionRefRequest,
        UvHandleClose,            // an addon's uv_close
        UvLoopDispatch,           // an addon's uv_async_send
        UvWorkDone,               // work that an addon thread queued
        ValkeyDeferredClose,
        WindowsNamedPipeContext,
    }
}

/// No `Drop`: a dropped task leaks its payload.
pub struct Task {
    tag: TaskTag,
    payload: MaybeUninit<*mut ()>,
    // [`Task::context`], in the padding `tag` leaves.
    context: ContextId,
}
const _: () = assert!(core::mem::size_of::<Task>() == 2 * core::mem::size_of::<usize>());

/// Identifies a script execution context within its VM (`bun_jsc` hands them out, counting up).
/// What outlived its context (a pool job, a queued task, a timer that was not swept) holds an id
/// no live context has.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Default, Debug)]
pub struct ContextId(u32);

impl ContextId {
    /// No script's context. Never handed out to one.
    pub const NONE: ContextId = ContextId(0);

    /// `VirtualMachine::dead_context`'s, in every VM. Never handed out to another: the
    /// identifiers contexts are given count up from 1.
    pub const DEAD: ContextId = ContextId(u32::MAX);

    #[inline]
    pub const fn from_raw(raw: u32) -> ContextId {
        ContextId(raw)
    }
}

/// What it takes to be queued as a [`Task`]: a tag, what the task owns, and how that is released unrun.
///
/// A queued task ends one of two ways: it runs (`bun_runtime::dispatch::
/// run_task`), or its VM stops before running it —
/// [`release_unrun`](Self::release_unrun), required here so no type can be
/// queued without having decided it. (A *weak* poster — `JsPoster` — can also
/// get its task back unqueued once the VM has closed; that task never entered
/// a queue and is the poster's own to free.)
///
/// Re-exported from `bun_jsc` for ergonomics, but defined here (lowest tier on
/// the hot-dispatch list, see PORTING.md §Dispatch) so that
/// [`Task::new`] can use it without a dep cycle.
pub trait Taskable: 'static {
    /// The tag constant from [`task_tag`] for this type. Both this and the
    /// `bun_runtime::dispatch` match arms MUST agree.
    const TAG: TaskTag;

    /// At most one word.
    type Payload: 'static;

    /// The task is in its VM's queue and will never be dispatched (the VM is
    /// tearing down: script is forbidden and the loop no longer ticks). Free
    /// it and whatever it holds — keep-alives, JS handles, refs, buffers —
    /// without running it. JS thread, JSC heap still alive. A type that can never be in a queue at that point says so here
    /// with `unreachable!` and the reason.
    fn release_unrun(payload: Self::Payload);

    /// Whose script the task continues: the context that was current when the work was started.
    /// Required, so that no type can be queued without having decided it: [`Task::new`] asks
    /// when the task is made and the task carries the answer. The event loop runs the task inside
    /// that context, and [releases it unrun](Self::release_unrun) if the context (a
    /// `Bun.ModuleGraph`'s) has stopped. [`ContextId::NONE`]: no script's. The task runs whenever
    /// the VM runs script, inside nothing: work that serves the whole realm, and a step of a
    /// larger operation that enters its own context before it reaches script (the impl says
    /// which, and where).
    fn context(payload: &Self::Payload) -> ContextId;
}

/// The short form of [`Taskable`] for a type that is queued as a `Box`.
pub trait BoxedTask: 'static {
    const TAG: TaskTag;
    fn release_unrun(self: Box<Self>);
    fn context(&self) -> ContextId;
}

impl<T: BoxedTask> Taskable for T {
    const TAG: TaskTag = <T as BoxedTask>::TAG;
    type Payload = Box<T>;
    fn release_unrun(task: Box<T>) {
        task.release_unrun();
    }
    fn context(task: &Box<T>) -> ContextId {
        task.context()
    }
}

impl TaskTag {
    /// A bundle asks its plugins to resolve or load something.
    #[inline]
    pub fn is_plugin_request(self) -> bool {
        self == task_tag::BundleV2PluginResolve || self == task_tag::BundleV2PluginLoad
    }

    /// The tag's identifier, for diagnostics.
    pub fn name(self) -> &'static str {
        task_tag::NAMES.get(self.0 as usize).copied().unwrap_or("?")
    }
}

impl Task {
    #[inline]
    pub fn new<T: Taskable>(payload: T::Payload) -> Task {
        const {
            assert!(size_of::<T::Payload>() <= size_of::<*mut ()>());
            assert!(align_of::<T::Payload>() <= align_of::<*mut ()>());
        }
        let mut task = Task {
            tag: T::TAG,
            payload: MaybeUninit::uninit(),
            context: T::context(&payload),
        };
        // SAFETY: it fits, see above.
        unsafe {
            task.payload
                .as_mut_ptr()
                .cast::<T::Payload>()
                .write(payload)
        };
        task
    }

    #[inline]
    pub const fn tag(&self) -> TaskTag {
        self.tag
    }

    /// Whose script the task continues: what its type's `context` said when the task
    /// was made. The event loop checks it before it runs the task.
    #[inline]
    pub const fn context(&self) -> ContextId {
        self.context
    }

    #[inline]
    pub fn from_boxed<T: BoxedTask>(task: Box<T>) -> Task {
        Task::new::<T>(task)
    }

    /// # Safety
    /// `self` came from `new::<T>`, and no bitwise copy of it is used.
    #[inline]
    pub unsafe fn into_payload<T: Taskable>(self) -> T::Payload {
        debug_assert!(self.tag == T::TAG);
        // SAFETY: fn contract.
        unsafe { self.payload.as_ptr().cast::<T::Payload>().read() }
    }
}

// ────────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct ConcurrentTask {
    task: Task,
    /// Intrusive MPSC link for [`Queue`]. Plain `AtomicPtr` so the enqueue hot
    /// path (`atomic_store_next`, called once per completed work-pool task via
    /// `Queue::push`) is a single release-store — no read-modify-write.
    next: Link<ConcurrentTask>,
    /// If `true`, the task is heap-owned and freed by the event loop after
    /// dispatch. Immutable after construction; read only on the consumer thread,
    /// so it does not need to share a word with the contended `next` link.
    auto_delete: bool,
}

impl Default for ConcurrentTask {
    fn default() -> Self {
        const {
            Self {
                // A placeholder: no queue takes a node before `in_place` has filled it.
                task: Task {
                    tag: TaskTag(0),
                    payload: MaybeUninit::zeroed(),
                    context: ContextId::NONE,
                },
                next: Link::new(),
                auto_delete: false,
            }
        }
    }
}

// `auto_delete` is deliberately its own field rather than packed into bit 0
// of `next`: `Task` is already two words here (tag is not packed into the
// pointer), so the struct was never 16B, and profiling (build/create-next
// benches) showed
// the packed form costs a Relaxed load + OR on every `atomic_store_next` —
// turning the MPSC enqueue's single release-store into a load-then-store on a
// cache line that is bouncing between producer threads and the JS-thread
// consumer. The extra word of padding is cheap; the contended RMW is not.
const _: () = assert!(
    core::mem::size_of::<ConcurrentTask>()
        == core::mem::size_of::<Task>() + 2 * core::mem::size_of::<usize>(),
    "ConcurrentTask = Task + next ptr + auto_delete (padded)"
);

// SAFETY: `link()` always projects to the same embedded `next: Link<Self>`
// field; `UnboundedQueue` only calls it with a valid, non-null, aligned `item`.
// The blanket `impl<T: Linked> Node for T` supplies the four accessors as
// straight `AtomicPtr` load/store — no bit-masking, no preservation load.
unsafe impl Linked for ConcurrentTask {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const Link<Self> {
        // SAFETY: caller (UnboundedQueue) guarantees `item` is valid; we only
        // form a raw pointer to the field, no intermediate `&`/`&mut`.
        unsafe { core::ptr::addr_of!((*item).next) }
    }
}

/// A node that is in no [`Queue`]. No `Drop`, as [`Task`].
pub struct OwnedConcurrentTask(NonNull<ConcurrentTask>);

impl ConcurrentTask {
    pub fn create<T: Taskable>(payload: T::Payload) -> OwnedConcurrentTask {
        OwnedConcurrentTask(bun_core::heap::alloc_nn(ConcurrentTask {
            task: Task::new::<T>(payload),
            next: Link::new(),
            auto_delete: true,
        }))
    }

    pub fn create_boxed<T: BoxedTask>(task: Box<T>) -> OwnedConcurrentTask {
        Self::create::<T>(task)
    }

    /// For a task that `node` returns a field of.
    pub fn in_box<T: BoxedTask>(
        task: Box<T>,
        node: impl FnOnce(&mut T) -> &mut ConcurrentTask,
    ) -> OwnedConcurrentTask {
        let task = Task::from_boxed(task);
        // SAFETY: the box that `task` owns, which nothing else can reach before `task` has left the node.
        unsafe { Self::in_place(node(&mut *task.payload.assume_init().cast()), task) }
    }

    /// # Safety
    /// `node` is live, and nothing uses or frees it until `task` runs or is released.
    pub unsafe fn in_place(node: *mut ConcurrentTask, task: Task) -> OwnedConcurrentTask {
        // SAFETY: fn contract.
        unsafe {
            *node = ConcurrentTask {
                task,
                next: Link::new(),
                auto_delete: false,
            };
            OwnedConcurrentTask(NonNull::new_unchecked(node))
        }
    }
}

impl OwnedConcurrentTask {
    pub fn tag(&self) -> TaskTag {
        // SAFETY: live until `self` is consumed.
        unsafe { self.0.as_ref() }.task.tag
    }

    /// Frees the node if `create` made it.
    pub(crate) fn into_task(self) -> Task {
        // SAFETY: as `tag`, and nothing reads the node's copy of the task afterwards.
        unsafe {
            let task = core::ptr::read(&raw const (*self.0.as_ptr()).task);
            if self.0.as_ref().auto_delete {
                bun_core::heap::destroy(self.0.as_ptr());
            }
            task
        }
    }
}

#[derive(Default)]
pub struct Queue(UnboundedQueue<ConcurrentTask>);

impl Queue {
    pub fn push(&self, OwnedConcurrentTask(node): OwnedConcurrentTask) {
        self.0.push(node);
    }

    pub fn pop_batch(&self) -> impl ExactSizeIterator<Item = Task> + use<> {
        let batch = self.0.pop_batch();
        let mut nodes = batch.iterator();
        (0..batch.count).map(move |_| {
            // SAFETY: the batch holds `count` nodes, and the iterator is past the one it returns.
            OwnedConcurrentTask(unsafe { NonNull::new_unchecked(nodes.next()) }).into_task()
        })
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    struct Level;
    impl Taskable for Level {
        const TAG: TaskTag = TaskTag(1);
        type Payload = u8;
        fn release_unrun(_: u8) {}
        fn context(level: &u8) -> ContextId {
            ContextId::from_raw((*level).into())
        }
    }

    struct Boxed {
        node: ConcurrentTask,
        alive: Arc<()>,
    }
    impl BoxedTask for Boxed {
        const TAG: TaskTag = TaskTag(2);
        fn release_unrun(self: Box<Self>) {}
        fn context(&self) -> ContextId {
            ContextId::NONE
        }
    }

    #[test]
    fn payload_smaller_than_a_word() {
        let task = Task::new::<Level>(7);
        assert!(task.tag() == Level::TAG);
        assert_eq!(task.context(), ContextId::from_raw(7));
        // SAFETY: made above.
        assert_eq!(unsafe { task.into_payload::<Level>() }, 7);
    }

    #[test]
    fn queue_hands_over_what_other_threads_push() {
        let (queue, alive) = (Queue::default(), Arc::new(()));
        let boxed = || {
            Box::new(Boxed {
                node: ConcurrentTask::default(),
                alive: Arc::clone(&alive),
            })
        };
        let mut left = 4;
        std::thread::scope(|scope| {
            for _ in 0..2 {
                scope.spawn(|| {
                    queue.push(ConcurrentTask::create_boxed(boxed()));
                    queue.push(ConcurrentTask::in_box(boxed(), |task| &mut task.node));
                });
            }
            while left > 0 {
                for task in queue.pop_batch() {
                    // SAFETY: nothing else is pushed.
                    let task = unsafe { task.into_payload::<Boxed>() };
                    assert!(Arc::ptr_eq(&task.alive, &alive));
                    left -= 1;
                }
                std::thread::yield_now();
            }
        });
        assert!(queue.is_empty());
        assert_eq!(Arc::strong_count(&alive), 1);
    }
}
