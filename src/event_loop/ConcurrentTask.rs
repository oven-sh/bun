//! A task that runs concurrently in the work pool.
//!
//! This is used to run tasks that are CPU-intensive or blocking on the work pool.
//! It's also used to run tasks that need to be run on a different thread than the main JavaScript thread.
//!
//! The task is run on a thread pool and then the result is returned to the main JavaScript thread.
//!
//! A heap carrier (`create*`) is deallocated by the event loop once its task is
//! dispatched; an intrusive one is part of the struct that owns it.

use crate::ManagedTask;
use bun_threading::UnboundedQueue;
use bun_threading::unbounded_queue::{Link, Linked};

// ─── Module-level constructor forwarders ────────────────────────────────────
// Several callers import this file
// as a *module* (`use bun_jsc::ConcurrentTask;`) rather than the struct, so
// `ConcurrentTask::create_from(x)` resolves as a free-function lookup, not an
// inherent-method call. Provide thin module-level forwarders so both spellings
// work — the struct's inherent methods remain the canonical impls below.
#[inline]
pub fn create(task: Task) -> core::ptr::NonNull<ConcurrentTask> {
    ConcurrentTask::create(task)
}
#[inline]
pub fn create_from<T: Taskable>(task: *mut T) -> core::ptr::NonNull<ConcurrentTask> {
    ConcurrentTask::create_from(task)
}

// ─── Task (hot-dispatch tag+ptr, see PORTING.md §Dispatch) ──────────────────
// Low tier (event_loop) stores `(tag, ptr)`; `bun_runtime::dispatch::run_task`
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
        AsyncModule,
        BakeHotReloadEvent,       // bun.bake.DevServer.HotReloadEvent
        BundleV2DeferredBatchTask, // bun.bundle_v2.DeferredBatchTask
        BundleV2PluginResolve,    // bun.bundle_v2.Resolve (JS-thread hop)
        BundleV2PluginLoad,       // bun.bundle_v2.Load (JS-thread hop)
        ShellYesTask,             // shell.Interpreter.Builtin.Yes.YesTask
        Close,
        CppTask,
        DuplexUpgradeContext,
        FetchTasklet,
        FetchTaskletDeinit,
        FetchTaskletPromiseSettle,
        FSWatchTask,
        GetAddrInfoLibuvComplete,
        HotReloadTask,
        WatchReloadTask,
        JSBundleCompletionTask,
        JSCDeferredWorkTask,
        ManagedTask,
        NapiAsyncWork,            // napi_async_work
        NapiFinalizerTask,
        NativePromiseContextDeferredDerefTask,
        NativeBrotli,
        NativeZlib,
        NativeZstd,
        Open,
        PollPendingModulesTask,
        PosixSignalTask,
        MemoryPressureTask,
        ProcessWaiterThreadTask,
        Read,
        Readv,
        FlushPendingFileSinkTask,
        RuntimeTranspilerStore,
        S3HttpDownloadStreamingTask,
        S3HttpSimpleTask,
        SendQueueDeferred,        // bun_runtime::ipc::SendQueue (close / after-close hop)
        ServerAllConnectionsClosedTask,
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
        StatFS,
        StatWatcherTimerUpdate,
        StatWatcherHop,
        AsyncCpTask,
        ShellAsyncCpTask,
        StreamPending,
        ThreadSafeFunction,
        ThreadSafeFunctionFinalize,
        ValkeyDeferredClose,
        WindowsNamedPipeContext,
        Write,
        Writev,
    }
}

#[derive(Copy, Clone)]
pub struct Task {
    pub tag: TaskTag,
    pub ptr: *mut (),
}

/// What it takes to be queued as a [`Task`]: a tag, and how the task is
/// freed when it will never run. Implement on every type that can be
/// enqueued; the impl lives in whatever crate owns the type.
///
/// A queued task ends one of two ways: it runs (`bun_runtime::dispatch::
/// run_task`), or its VM stops before running it —
/// [`release_unrun`](Self::release_unrun), required here so no type can be
/// queued without having decided it. (A *weak* poster — `JsPoster` — can also
/// get its task back unqueued once the VM has closed; that task never entered
/// a queue and is the poster's own to free: [`ConcurrentTask::release_refused`].)
///
/// Re-exported from `bun_jsc` for ergonomics, but defined here (lowest tier on
/// the hot-dispatch list, see PORTING.md §Dispatch) so that
/// [`Task::init`] can use it without a dep cycle.
pub trait Taskable {
    /// The tag constant from [`task_tag`] for this type. Both this and the
    /// `bun_runtime::dispatch` match arms MUST agree.
    const TAG: TaskTag;

    /// The task is in its VM's queue and will never be dispatched (the VM is
    /// tearing down: script is forbidden and the loop no longer ticks). Free
    /// it and whatever it holds — keep-alives, JS handles, refs, buffers —
    /// without running it. JS thread, JSC heap still alive. `this` is the
    /// queued [`Task::ptr`] (for the tags whose `ptr` packs an integer, that
    /// value). A type that can never be in a queue at that point says so here
    /// with `unreachable!` and the reason.
    ///
    /// # Safety
    /// `this` came off the queue under `Self::TAG` and is not used afterwards.
    unsafe fn release_unrun(this: *mut Self);
}

/// A task whose queued pointer is a [`ThisPtr`](bun_ptr::ThisPtr) to
/// `Target`, which keeps itself alive for the task; the dispatcher runs it or
/// releases it through here. A zero-sized hop type per tag, declared with
/// [`task_hop!`] next to `Target` so the ref protocol lives there.
///
/// # Safety
/// `TAG` is dispatched (in `bun_runtime::dispatch`) to this impl and no other
/// task type uses it; and `Target`'s protocol keeps the pointee of every
/// [`task`](Self::task) it queues alive until `run` / `release_unrun` (a
/// `RefPtr` slot held for the queued task, or an owner that outlives the queue).
pub unsafe trait TaskHop {
    type Target;
    /// The tag constant from [`task_tag`]; the `bun_runtime::dispatch` match
    /// arms MUST agree.
    const TAG: TaskTag;
    fn run(this: bun_ptr::ThisPtr<Self::Target>) -> crate::JsResult<()>;
    /// As [`Taskable::release_unrun`].
    fn release_unrun(this: bun_ptr::ThisPtr<Self::Target>);

    #[inline]
    fn task(this: bun_ptr::ThisPtr<Self::Target>) -> Task {
        Task::new(Self::TAG, this.as_ptr().cast::<()>())
    }
}

/// Declares `$hop`, the [`TaskHop`] that `task_tag::$tag` dispatches to for
/// `$target`, forwarding to `$run` / `$release`. The doc comment on the
/// invocation is where `$target`'s liveness protocol for the queued task is
/// stated.
#[macro_export]
macro_rules! task_hop {
    ($(#[$m:meta])* $v:vis $hop:ident for $target:ty => $tag:ident; run = $run:expr; release_unrun = $release:expr $(;)?) => {
        $(#[$m])*
        $v struct $hop;
        // SAFETY: see macro doc — one hop per tag; the invoker documents the liveness protocol.
        unsafe impl $crate::TaskHop for $hop {
            type Target = $target;
            const TAG: $crate::TaskTag = $crate::task_tag::$tag;
            #[inline]
            fn run(this: ::bun_ptr::ThisPtr<$target>) -> $crate::JsResult<()> {
                ($run)(this)
            }
            #[inline]
            fn release_unrun(this: ::bun_ptr::ThisPtr<$target>) {
                ($release)(this)
            }
        }
    };
}

/// A task that owns its payload: queued as the `Box<Self>` leaked into
/// [`Task::ptr`], handed back as that box when the dispatcher runs or
/// releases it. Implement via [`boxed_task!`].
///
/// # Safety
/// `TAG` is dispatched (in `bun_runtime::dispatch`) to this impl and no other
/// task type uses it, so the dispatcher's `Box::<Self>::from_raw` gets back
/// what [`into_task`](Self::into_task) leaked.
pub unsafe trait BoxedTask: Sized {
    /// The tag constant from [`task_tag`]; the `bun_runtime::dispatch` match
    /// arms MUST agree.
    const TAG: TaskTag;
    fn run(self: Box<Self>) -> crate::JsResult<()>;
    /// As [`Taskable::release_unrun`].
    fn release_unrun(self: Box<Self>);
    /// A weak post was refused: the VM this was for has closed (any thread;
    /// its heap may be gone). Free the task without touching that VM.
    fn refused(self: Box<Self>);

    /// The JS thread's own enqueue (`EventLoop::enqueue_task`), which cannot
    /// be refused; off-thread posts go through `ConcurrentTask::create_boxed`.
    #[inline]
    fn into_task(self: Box<Self>) -> Task {
        Task::new(Self::TAG, Box::into_raw(self).cast::<()>())
    }
}

/// Implements [`BoxedTask`] for `$ty` as the task `task_tag::$tag` dispatches
/// to, forwarding to `$run` / `$release` / `$refused` (each `fn(Box<$ty>)`).
#[macro_export]
macro_rules! boxed_task {
    ($ty:ty => $tag:ident; run = $run:expr; release_unrun = $release:expr; refused = $refused:expr $(;)?) => {
        // SAFETY: see macro doc — one boxed task type per tag.
        unsafe impl $crate::BoxedTask for $ty {
            const TAG: $crate::TaskTag = $crate::task_tag::$tag;
            #[inline]
            fn run(self: ::std::boxed::Box<Self>) -> $crate::JsResult<()> {
                ($run)(self)
            }
            #[inline]
            fn release_unrun(self: ::std::boxed::Box<Self>) {
                ($release)(self)
            }
            #[inline]
            fn refused(self: ::std::boxed::Box<Self>) {
                ($refused)(self)
            }
        }
    };
}

impl TaskTag {
    /// The tag's identifier, for diagnostics.
    pub fn name(self) -> &'static str {
        task_tag::NAMES.get(self.0 as usize).copied().unwrap_or("?")
    }
}

impl Task {
    #[inline]
    pub const fn new(tag: TaskTag, ptr: *mut ()) -> Task {
        Task { tag, ptr }
    }

    /// The type→tag table is the [`Taskable`] trait; the per-type impl
    /// supplies `T::TAG`.
    // Takes `*mut T` directly; `&mut T` coerces at call sites.
    #[inline]
    pub fn init<T: Taskable>(ptr: *mut T) -> Task {
        Task::new(T::TAG, ptr.cast::<()>())
    }

    /// Build a [`Task`] from an owned `Box<T>`. The dispatch arm for `T::TAG`
    /// is responsible for reclaiming the allocation (see
    /// `bun_runtime::dispatch::run_task`). This is the typed entry point
    /// callers use instead of open-coding `heap::alloc`.
    #[inline]
    pub fn from_boxed<T: Taskable>(task: Box<T>) -> Task {
        Task::new(T::TAG, bun_core::heap::into_raw(task).cast::<()>())
    }
}

// Taskable impls for the low-tier task wrappers defined in this crate.
impl Taskable for crate::ManagedTask::ManagedTask {
    const TAG: TaskTag = task_tag::ManagedTask;
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — a queued ManagedTask is the heap box `new*` made.
        unsafe { crate::ManagedTask::ManagedTask::release(this) }
    }
}
// ────────────────────────────────────────────────────────────────────────────

/// How a heap carrier (`ConcurrentTask::create*`) frees itself, and the
/// payload if the carrier owns it, when a weak post is refused.
type ReleaseRefused = unsafe fn(core::ptr::NonNull<ConcurrentTask>);

#[repr(C)]
pub struct ConcurrentTask {
    pub task: Task,
    /// Intrusive MPSC link for [`Queue`]. Plain `AtomicPtr` so the enqueue hot
    /// path (`atomic_store_next`, called once per completed work-pool task via
    /// `enqueue_task_concurrent`) is a single release-store — no read-modify-write.
    pub next: Link<ConcurrentTask>,
    /// `Some` on a heap carrier (`create*`): the event loop frees the carrier
    /// after dispatching its task, and a refused weak post frees carrier and
    /// owned payload through it ([`ConcurrentTask::release_refused`]). `None`
    /// on an intrusive carrier, which belongs to its container. Immutable after
    /// construction; read only on the consumer thread, so it does not need to
    /// share a word with the contended `next` link.
    release_refused: Option<ReleaseRefused>,
}

impl Default for ConcurrentTask {
    fn default() -> Self {
        Self {
            // SAFETY: all-zero is a valid bit pattern for `Task` (plain tag
            // byte + raw pointer); caller must set a real task before use.
            task: unsafe { bun_core::ffi::zeroed_unchecked() },
            next: Link::new(),
            release_refused: None,
        }
    }
}

// `release_refused` is deliberately its own field rather than packed into bit 0
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
    "ConcurrentTask = Task + next ptr + release_refused"
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
pub type Queue = UnboundedQueue<ConcurrentTask>;

impl ConcurrentTask {
    /// Heap-allocate a ConcurrentTask and return a raw pointer.
    /// The pointer is intrusive (linked into `Queue`), so we use `heap::alloc` rather than `Box<T>`.
    #[inline]
    pub(crate) fn new(init: ConcurrentTask) -> *mut ConcurrentTask {
        bun_core::heap::into_raw(Box::new(init))
    }

    /// A heap carrier for `task`, whose payload the carrier does not own
    /// (intrusive, or freed by whoever posts it) — except a `ManagedTask`,
    /// which it does.
    pub fn create(task: Task) -> core::ptr::NonNull<ConcurrentTask> {
        /// # Safety
        /// `this` is a refused heap carrier.
        unsafe fn carrier_only(this: core::ptr::NonNull<ConcurrentTask>) {
            // SAFETY: fn contract; `create*` boxed it.
            drop(unsafe { bun_core::heap::take(this.as_ptr()) });
        }
        /// # Safety
        /// `this` is a refused heap carrier whose payload is a `ManagedTask`.
        unsafe fn managed(this: core::ptr::NonNull<ConcurrentTask>) {
            // SAFETY: fn contract; refused ⇒ both boxes are ours.
            unsafe {
                let task = bun_core::heap::take(this.as_ptr()).task;
                crate::ManagedTask::ManagedTask::release(task.ptr.cast());
            }
        }
        let release: ReleaseRefused = if task.tag == task_tag::ManagedTask {
            managed
        } else {
            carrier_only
        };
        Self::create_with(task, release)
    }

    /// A heap carrier owning the boxed `task`: a refused weak post hands it to
    /// [`BoxedTask::refused`].
    pub fn create_boxed<T: BoxedTask>(task: Box<T>) -> core::ptr::NonNull<ConcurrentTask> {
        /// # Safety
        /// `this` is a refused heap carrier built by `create_boxed::<T>`.
        unsafe fn boxed<T: BoxedTask>(this: core::ptr::NonNull<ConcurrentTask>) {
            // SAFETY: fn contract; refused ⇒ both boxes are ours, and the
            // payload is the `Box<T>` `into_task` leaked.
            let task = unsafe {
                let task = bun_core::heap::take(this.as_ptr()).task;
                Box::from_raw(task.ptr.cast::<T>())
            };
            T::refused(task);
        }
        Self::create_with(task.into_task(), boxed::<T>)
    }

    fn create_with(task: Task, release: ReleaseRefused) -> core::ptr::NonNull<ConcurrentTask> {
        let raw = ConcurrentTask::new(ConcurrentTask {
            task,
            next: Link::new(),
            release_refused: Some(release),
        });
        // SAFETY: `new` heap-allocates via `heap::into_raw` — never null.
        unsafe { core::ptr::NonNull::new_unchecked(raw) }
    }

    pub fn create_from<T: Taskable>(task: *mut T) -> core::ptr::NonNull<ConcurrentTask> {
        bun_core::mark_binding!();
        Self::create(Task::init(task))
    }

    // callback returns `JsResult<()>` to match `ManagedTask::new`'s stored ABI;
    // callers that have a `fn(*mut T)` should wrap it as `|p| { f(p); Ok(()) }` at the call site.
    pub fn from_callback<T>(
        ptr: *mut T,
        callback: fn(*mut T) -> crate::JsResult<()>,
    ) -> core::ptr::NonNull<ConcurrentTask> {
        bun_core::mark_binding!();
        Self::create(ManagedTask::ManagedTask::new(ptr, callback))
    }

    /// Load this intrusive carrier with `of`'s task, ready to post.
    pub fn from<T: Taskable>(&mut self, of: *mut T) -> &mut ConcurrentTask {
        self.from_task(Task::init(of))
    }

    /// An intrusive carrier loaded with `task`, ready to post.
    pub const fn intrusive(task: Task) -> ConcurrentTask {
        ConcurrentTask {
            task,
            next: Link::new(),
            release_refused: None,
        }
    }

    /// Load this intrusive carrier with `task`, ready to post.
    pub fn from_task(&mut self, task: Task) -> &mut ConcurrentTask {
        bun_core::mark_binding!();
        *self = Self::intrusive(task);
        self
    }

    /// Consuming thread: unwrap the payload, freeing the carrier if it was
    /// heap-allocated (`create*`); an intrusive carrier stays with its container.
    ///
    /// # Safety
    /// `this` came off a queue (or was never queued) and is not used afterwards.
    pub unsafe fn into_task(this: core::ptr::NonNull<ConcurrentTask>) -> Task {
        // SAFETY: fn contract.
        unsafe {
            let (task, auto_delete) = (this.as_ref().task, this.as_ref().auto_delete());
            if auto_delete {
                drop(bun_core::heap::take(this.as_ptr()));
            }
            task
        }
    }

    /// A weak poster got `task` back because the target VM has closed: free
    /// it if it is a heap carrier (`create*`), with the payload if the carrier
    /// owns it; an intrusive one belongs to its container.
    ///
    /// # Safety
    /// `task` was just refused and is not queued anywhere.
    pub unsafe fn release_refused(task: core::ptr::NonNull<ConcurrentTask>) {
        // SAFETY: fn contract; `release_refused` was installed by the
        // constructor that knows the carrier's and payload's ownership.
        unsafe {
            if let Some(release) = task.as_ref().release_refused {
                release(task);
            }
        }
    }

    /// Whether this is a heap carrier (`create*`) the event loop frees after
    /// dispatching its task.
    #[inline]
    pub fn auto_delete(&self) -> bool {
        self.release_refused.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::sync::atomic::{AtomicUsize, Ordering};

    static REFUSED: AtomicUsize = AtomicUsize::new(0);
    static DROPPED: AtomicUsize = AtomicUsize::new(0);

    struct Payload {
        _buf: Box<[u8; 64]>,
    }
    impl Drop for Payload {
        fn drop(&mut self) {
            DROPPED.fetch_add(1, Ordering::SeqCst);
        }
    }
    crate::boxed_task! {
        Payload => NapiFinalizerTask;
        run = |_task: Box<Payload>| Ok(());
        release_unrun = |_task: Box<Payload>| {};
        refused = |_task: Box<Payload>| { REFUSED.fetch_add(1, Ordering::SeqCst); };
    }

    #[test]
    fn refused_boxed_carrier_releases_its_payload() {
        let carrier = ConcurrentTask::create_boxed(Box::new(Payload {
            _buf: Box::new([7; 64]),
        }));
        // SAFETY: never queued; ours.
        unsafe { ConcurrentTask::release_refused(carrier) };
        assert_eq!(REFUSED.load(Ordering::SeqCst), 1);
        assert_eq!(DROPPED.load(Ordering::SeqCst), 1);

        let mut intrusive = ConcurrentTask::intrusive(
            Box::new(Payload {
                _buf: Box::new([7; 64]),
            })
            .into_task(),
        );
        // SAFETY: never queued; an intrusive carrier is left alone.
        unsafe { ConcurrentTask::release_refused(core::ptr::NonNull::from(&mut intrusive)) };
        assert_eq!(DROPPED.load(Ordering::SeqCst), 1);
        // SAFETY: the payload leaked into the intrusive carrier above.
        drop(unsafe { Box::from_raw(intrusive.task.ptr.cast::<Payload>()) });
        assert_eq!(DROPPED.load(Ordering::SeqCst), 2);
    }
}
