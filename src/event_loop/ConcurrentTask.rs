//! A task that runs concurrently in the work pool.
//!
//! This is used to run tasks that are CPU-intensive or blocking on the work pool.
//! It's also used to run tasks that need to be run on a different thread than the main JavaScript thread.
//!
//! The task is run on a thread pool and then the result is returned to the main JavaScript thread.
//!
//! If `auto_delete` is true, the task is automatically deallocated when it's finished.
//! Otherwise, it's expected that the containing struct will deallocate the task.

use crate::ManagedTask;
// TODO(port): confirm crate for UnboundedQueue (bun.UnboundedQueue) — assuming bun_threading
use bun_threading::unbounded_queue::{Link, Linked};
use bun_threading::UnboundedQueue;

// ─── Module-level constructor forwarders ────────────────────────────────────
// Zig spelled these as namespace calls (`ConcurrentTask.createFrom(...)`,
// `ConcurrentTask.fromCallback(...)`). Several Rust callers import this file
// as a *module* (`use bun_jsc::ConcurrentTask;`) rather than the struct, so
// `ConcurrentTask::create_from(x)` resolves as a free-function lookup, not an
// inherent-method call. Provide thin module-level forwarders so both spellings
// work — the struct's inherent methods remain the canonical impls below.
#[inline]
pub fn create(task: Task) -> *mut ConcurrentTask {
    ConcurrentTask::create(task)
}
#[inline]
pub fn create_from<T: Taskable>(task: *mut T) -> *mut ConcurrentTask {
    ConcurrentTask::create_from(task)
}
#[inline]
pub fn from_callback<T>(
    ptr: *mut T,
    callback: fn(*mut T) -> crate::JsResult<()>,
) -> *mut ConcurrentTask {
    ConcurrentTask::from_callback(ptr, callback)
}

// ─── Task (hot-dispatch tag+ptr, see PORTING.md §Dispatch) ──────────────────
// Low tier (event_loop) stores `(tag, ptr)`; `bun_runtime::dispatch::run_task`
// owns the `match` over ~96 variants. Tag constants live in
// `crate::task_tag::*` below.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct TaskTag(pub u8);

/// Tag constants for `Task` — one per variant of Zig's `jsc.Task`
/// `TaggedPointerUnion` (src/jsc/Task.zig). Values are sequential by source
/// order; `bun_runtime::dispatch::run_task` matches on these. Both sides MUST
/// agree — adding a variant requires updating both this list and the runtime
/// match arm.
// PORT NOTE: Zig `TaggedPointerUnion` derived tags from a comptime type list;
// Rust splits the table (here) from the type→arm mapping (runtime tier-6).
#[allow(non_upper_case_globals)]
pub mod task_tag {
    use super::TaskTag;
    macro_rules! tags {
        ($($name:ident),* $(,)?) => {
            tags!(@ 0u8, $($name,)*);
            /// Number of task tags. `bun_runtime::dispatch::run_task` asserts
            /// exhaustiveness against this.
            pub const COUNT: u8 = tags!(@count 0u8, $($name,)*);
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
        Access,
        AnyTask,
        AppendFile,
        ArchiveExtractTask,
        ArchiveBlobTask,
        ArchiveWriteTask,
        ArchiveFilesTask,
        AsyncGlobWalkTask,
        AsyncImageTask,
        AsyncTransformTask,
        BakeHotReloadEvent,       // bun.bake.DevServer.HotReloadEvent
        BundleV2DeferredBatchTask, // bun.bundle_v2.DeferredBatchTask
        ShellYesTask,             // shell.Interpreter.Builtin.Yes.YesTask
        Chmod,
        Chown,
        Close,
        CopyFile,
        CopyFilePromiseTask,
        CppTask,
        Exists,
        Fchmod,
        FChown,
        Fdatasync,
        FetchTasklet,
        Fstat,
        FSWatchTask,
        Fsync,
        FTruncate,
        Futimes,
        GetAddrInfoRequestTask,
        HotReloadTask,
        ImmediateObject,
        JSCDeferredWorkTask,
        Lchmod,
        Lchown,
        Link,
        Lstat,
        Lutimes,
        ManagedTask,
        Mkdir,
        Mkdtemp,
        NapiAsyncWork,            // napi_async_work
        NapiFinalizerTask,
        NativePromiseContextDeferredDerefTask,
        NativeBrotli,
        NativeZlib,
        NativeZstd,
        Open,
        PollPendingModulesTask,
        PosixSignalTask,
        ProcessWaiterThreadTask,
        Read,
        Readdir,
        ReaddirRecursive,
        ReadFile,
        ReadFileTask,
        Readlink,
        Readv,
        FlushPendingFileSinkTask,
        Realpath,
        RealpathNonNative,
        Rename,
        Rm,
        Rmdir,
        RuntimeTranspilerStore,
        S3HttpDownloadStreamingTask,
        S3HttpSimpleTask,
        ServerAllConnectionsClosedTask,
        ShellAsync,
        ShellAsyncSubprocessDone,
        ShellCondExprStatTask,
        ShellCpTask,
        ShellGlobTask,
        ShellIOReaderAsyncDeinit,
        ShellIOWriterAsyncDeinit,
        ShellIOWriter,
        ShellLsTask,
        ShellMkdirTask,
        ShellMvBatchedTask,
        ShellMvCheckTargetTask,
        ShellRmDirTask,
        ShellRmTask,
        ShellTouchTask,
        Stat,
        StatFS,
        StreamPending,
        Symlink,
        ThreadSafeFunction,
        TimeoutObject,
        Truncate,
        Unlink,
        Utimes,
        Write,
        WriteFile,
        WriteFileTask,
        Writev,
    }
}

#[derive(Copy, Clone)]
pub struct Task {
    pub tag: TaskTag,
    pub ptr: *mut (),
}

/// Type → tag binding for [`Task`]. Implement on every type that can be
/// enqueued; the impl lives in whatever crate owns the type (mirrors Zig's
/// comptime `TaggedPointerUnion` type-list lookup, where the tag was derived
/// from `@typeName(std.meta.Child(@TypeOf(ptr)))`).
///
/// ```ignore
/// impl bun_event_loop::Taskable for FetchTasklet {
///     const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::FetchTasklet;
/// }
/// ```
///
/// Re-exported from `bun_jsc` for ergonomics, but defined here (lowest tier on
/// the hot-dispatch list, see PORTING.md §Dispatch) so that
/// [`Task::init`] can use it without a dep cycle.
pub trait Taskable {
    /// The tag constant from [`task_tag`] for this type. Both this and the
    /// `bun_runtime::dispatch::run_task` match arm MUST agree.
    const TAG: TaskTag;

    /// Build a [`Task`] from a raw pointer to `Self`. Ownership semantics are
    /// per-variant (most arms `heap::take` on dispatch; a few are borrows).
    #[inline]
    fn into_task(ptr: *mut Self) -> Task {
        Task::new(Self::TAG, ptr.cast::<()>())
    }
}

impl Task {
    #[inline]
    pub const fn new(tag: TaskTag, ptr: *mut ()) -> Task {
        Task { tag, ptr }
    }

    /// Zig: `TaggedPointerUnion.init(_ptr: anytype)` — `@typeInfo` asserted
    /// `_ptr` was a pointer, then `@intFromEnum(@field(Tag, @typeName(Child)))`
    /// resolved the tag from the comptime type list. Rust expresses the
    /// type→tag table as the [`Taskable`] trait; the per-type impl supplies
    /// `T::TAG` and the body is the Zig `TaggedPointer.init(ptr, tag)`.
    // PORT NOTE: Zig accepted `anytype` and reflected on `@TypeOf`; Rust takes
    // `*mut T` directly (the only shape Zig admitted). `&mut T` coerces at
    // call sites.
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

    /// Zig: `TaggedPointerUnion.initWithType(comptime Type, _ptr)` — for the
    /// rare case where the pointer's static type differs from the variant
    /// (Zig used this when `_ptr` was `*anyopaque`).
    #[inline]
    pub fn init_with_type<T: Taskable>(ptr: *mut ()) -> Task {
        Task::new(T::TAG, ptr)
    }
}

// Taskable impls for the low-tier task wrappers defined in this crate.
impl Taskable for crate::AnyTask::AnyTask {
    const TAG: TaskTag = task_tag::AnyTask;
}
impl Taskable for crate::ManagedTask::ManagedTask {
    const TAG: TaskTag = task_tag::ManagedTask;
}
// ────────────────────────────────────────────────────────────────────────────

#[repr(C)]
pub struct ConcurrentTask {
    pub task: Task,
    /// Intrusive MPSC link for [`Queue`]. Plain `AtomicPtr` so the enqueue hot
    /// path (`atomic_store_next`, called once per completed work-pool task via
    /// `enqueue_task_concurrent`) is a single release-store — no read-modify-write.
    pub next: Link<ConcurrentTask>,
    /// If `true`, the task is heap-owned and freed by the event loop after
    /// dispatch. Immutable after construction; read only on the consumer thread,
    /// so it does not need to share a word with the contended `next` link.
    pub auto_delete: bool,
}

impl Default for ConcurrentTask {
    fn default() -> Self {
        Self {
            // SAFETY: matches Zig `task: Task = undefined` — caller must set before use.
            task: unsafe { bun_core::ffi::zeroed_unchecked() },
            next: Link::new(),
            auto_delete: false,
        }
    }
}

// PORT NOTE: Zig packs `auto_delete` into bit 0 of `next` (`PackedNextPtr`) to
// keep `ConcurrentTask` at 16 bytes. The Rust port deliberately splits it back
// out: `Task` is already two words here (tag is not packed into the pointer),
// so the struct was never 16B, and profiling (build/create-next benches) showed
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
pub type Queue = UnboundedQueue<ConcurrentTask>;

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum AutoDeinit {
    ManualDeinit,
    AutoDeinit,
}

impl ConcurrentTask {
    /// `bun.TrivialNew(@This())` — heap-allocate a ConcurrentTask and return a raw pointer.
    /// The pointer is intrusive (linked into `Queue`), so we use `heap::alloc` rather than `Box<T>`.
    #[inline]
    pub fn new(init: ConcurrentTask) -> *mut ConcurrentTask {
        bun_core::heap::into_raw(Box::new(init))
    }

    /// `bun.TrivialDeinit(@This())` — free a ConcurrentTask previously returned by `new`.
    ///
    /// # Safety
    /// `this` must have been produced by `ConcurrentTask::new` and not yet freed.
    #[inline]
    pub unsafe fn destroy(this: *mut ConcurrentTask) {
        // SAFETY: caller contract above.
        drop(unsafe { bun_core::heap::take(this) });
    }

    pub fn create(task: Task) -> *mut ConcurrentTask {
        ConcurrentTask::new(ConcurrentTask {
            task,
            next: Link::new(),
            auto_delete: true,
        })
    }

    pub fn create_from<T: Taskable>(task: *mut T) -> *mut ConcurrentTask {
        // TODO(port): re-enable once `mark_binding!` macro arity matches
        // `ScopedLogger::log` (concurrent bun_core edit changed it to 1-arg).
        // bun_core::mark_binding!();
        Self::create(Task::init(task))
    }

    /// Typed `Box<T>`-taking constructor: the scheduler owns the
    /// `Box` ↔ `*mut` round-trip so callers never write `heap::alloc`.
    /// The matching `heap::take` lives in `bun_runtime::dispatch::run_task`
    /// (or the variant's own `run_from_js_thread`), keyed by `T::TAG`.
    #[inline]
    pub fn create_boxed<T: Taskable>(task: Box<T>) -> *mut ConcurrentTask {
        Self::create(Task::from_boxed(task))
    }

    // TODO(port): `comptime callback: anytype` + `std.meta.Child(@TypeOf(ptr))` is comptime
    // reflection. Modeled here as a generic over the pointee type `T` with a plain fn-pointer
    // callback. Zig's `ManagedTask.New(T, cb).init(ptr)` collapses to `ManagedTask::new(ptr, cb)`.
    // PORT NOTE: callback returns `JsResult<()>` to match `ManagedTask::new`'s stored ABI;
    // Zig accepted both `fn(*T) void` and `fn(*T) JSError!void` via comptime — Rust callers
    // that have a `fn(*mut T)` should wrap it as `|p| { f(p); Ok(()) }` at the call site.
    pub fn from_callback<T>(
        ptr: *mut T,
        callback: fn(*mut T) -> crate::JsResult<()>,
    ) -> *mut ConcurrentTask {
        // TODO(port): re-enable once `mark_binding!` macro arity matches
        // `ScopedLogger::log` (concurrent bun_core edit changed it to 1-arg).
        // bun_core::mark_binding!();
        Self::create(ManagedTask::ManagedTask::new(ptr, callback))
    }

    pub fn from<T: Taskable>(
        &mut self,
        of: *mut T,
        auto_deinit: AutoDeinit,
    ) -> &mut ConcurrentTask {
        // TODO(port): re-enable once `mark_binding!` macro arity matches
        // `ScopedLogger::log` (concurrent bun_core edit changed it to 1-arg).
        // bun_core::mark_binding!();
        *self = ConcurrentTask {
            task: Task::init(of),
            next: Link::new(),
            auto_delete: auto_deinit == AutoDeinit::AutoDeinit,
        };
        self
    }

    /// Returns whether this task should be automatically deallocated after execution.
    #[inline]
    pub fn auto_delete(&self) -> bool {
        self.auto_delete
    }
}

// ported from: src/event_loop/ConcurrentTask.zig
