//! `crate::dispatch` — the §Dispatch hot-path payoff.
//!
//! Per `docs/PORTING.md` §Dispatch, low-tier crates store
//! `Task = { tag: TaskTag, ptr: *mut () }` and never name a variant type. This
//! crate (highest tier) owns **every** variant type, so the actual `match`
//! loop lives here, and LLVM inlines the per-arm direct calls.
//!
//! Three dispatchers are defined:
//!   1. [`run_task`] — `bun_event_loop::Task` (~96 variants).
//!   2. [`run_file_poll`] — `bun_io::FilePoll::Owner` (~13 variants).
//!
//! Low-tier crates declare these as `extern "Rust"`; this crate defines them
//! `#[no_mangle]` so the linker resolves the call directly — no runtime
//! registration, no `AtomicPtr`, no init-order hazard.
//!
//! **Adding a task variant** (do all four):
//!   1. tag constant in `bun_event_loop::task_tag`;
//!   2. `impl bun_jsc::Taskable for YourType { const TAG; unsafe fn release_unrun(..) }`;
//!   3. a row in `for_each_task!` and an `impl RunTask for YourType` here;
//!   4. bump the `task_tag::COUNT` assertion below.

// Flat re-export landing pad for `generated_js2native.rs` thunks. Kept in a
// sibling file so this hot-path module stays focused on the task/timer/poll
// match loops.
#[path = "dispatch_js2native.rs"]
pub mod js2native;

use bun_event_loop::ManagedTask::ManagedTask;
use bun_event_loop::{Task, Taskable, task_tag};

// `FilePoll::on_update` dispatch is POSIX-only (the symbol is declared
// `extern "Rust"` in `aio::posix_event_loop` and never referenced on Windows,
// where libuv drives I/O readiness directly).
#[cfg(not(windows))]
use bun_io::posix_event_loop::{FilePoll, Flags as PollFlag, poll_tag};

use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, Tag as EventLoopTimerTag, Timespec as ElTimespec,
};

use bun_jsc::event_loop::{EventLoop, Stopped};
use bun_jsc::task::report_error_or_terminate;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JsResult};

/// X-macro: the `node:fs` ops that are libuv requests on Windows
/// (`UVFSRequest`); they complete on the JS thread and re-enter through the
/// task queue under a per-op tag. Every other async fs op is a `bun_jsc::Job`.
/// Row shape: `$tag $ty;` (`task_tag::*` const, `fs_async::*` alias).
#[cfg(windows)]
macro_rules! for_each_fs_uv_op {
    ($m:ident) => {
        $m! {
            Open Open; Close Close; Read Read; Write Write; Readv Readv;
            Writev Writev; StatFS Statfs;
        }
    };
}
/// Expand the fs-op table to an or-pattern over `task_tag::*` (pattern position).
#[cfg(windows)]
macro_rules! __fs_pat {
    ($($tag:ident $ty:ident;)*) => { $(task_tag::$tag)|* };
}

// ── per-variant payload types ────────────────────────────────────────────────
// (high-tier owns them all; grouped by source module)

use crate::shell::builtins::{
    cp::ShellCpTask,
    ls::ShellLsTask,
    mkdir::ShellMkdirTask,
    mv::{ShellMvBatchedTask, ShellMvCheckTargetTask},
    rm::ShellRmTask,
    touch::ShellTouchTask,
    yes::YesTask as ShellYesTask,
};
use crate::shell::dispatch_tasks::{ShellCondExprStatTask, ShellGlobTask, ShellRmDirTask};
use crate::shell::interpreter::ShellTask;
#[cfg(not(windows))]
use crate::shell::io_writer::Poll as ShellBufferedWriterPoll;
use crate::shell::states::r#async::Async as ShellAsync;

use crate::webcore::fetch::fetch_tasklet::FetchTasklet;
use crate::webcore::file_sink::FlushPendingTask as FlushPendingFileSinkTask;
#[cfg(not(windows))]
use crate::webcore::file_sink::Poll as FileSinkPoll;
use crate::webcore::s3::download_stream::S3HttpDownloadStreamingTask;
use crate::webcore::s3::simple_request::S3HttpSimpleTask;
use crate::webcore::streams::Pending as StreamPending;

use crate::api::bun_subprocess::Subprocess;
#[cfg(not(windows))]
use crate::api::bun_terminal_body::Poll as TerminalPoll;
use crate::api::cron::CronJob;
use crate::api::native_promise_context::DeferredDerefTask as NativePromiseContextDeferredDerefTask;
#[cfg(not(windows))]
use bun_spawn::static_pipe_writer::Poll as StaticPipeWriterPoll;

use crate::napi::{NapiFinalizerTask, ThreadSafeFunction, napi_async_work};

use bun_jsc::PosixSignalTask;
use bun_jsc::RuntimeTranspilerStore;
use bun_jsc::cpp_task::CppTask;
use bun_jsc::hot_reloader;
use bun_jsc::jsc_scheduler::JSCDeferredWorkTask;

use crate::bake::dev_server::DevServer;
use crate::bake::dev_server::HotReloadEvent as BakeHotReloadEvent;
use crate::bake::dev_server::source_map_store::SourceMapStore;

#[cfg(windows)]
use crate::node::fs::async_ as fs_async;
use crate::node::node_fs_stat_watcher::StatWatcherScheduler;
use crate::node::node_fs_watcher::FSWatchTask;
use crate::node::node_zlib_binding;
use crate::node::zlib::{
    native_brotli::NativeBrotli, native_zlib::NativeZlib, native_zstd::NativeZstd,
};

use crate::dns_jsc::Resolver as DNSResolver;
use crate::server::ServerAllConnectionsClosedTask;

#[cfg(not(windows))]
use crate::api::bun_process::Process;
#[cfg(unix)]
use crate::api::bun_process::waiter_thread_posix::ResultTask as ProcessWaiterThreadTask;

use bun_bundler::DeferredBatchTask::DeferredBatchTask as BundleV2DeferredBatchTask;

use crate::socket::upgraded_duplex::UpgradedDuplex;
#[cfg(windows)]
use crate::socket::windows_named_pipe::WindowsNamedPipe;

use crate::valkey_jsc::js_valkey::JSValkeyClient as Valkey;
use bun_sql_jsc::mysql::js_my_sql_connection::JSMySQLConnection as MySQLConnection;
use bun_sql_jsc::postgres::PostgresSQLConnection;

use crate::test_runner::bun_test::{BunTest, BunTestPtr};
use crate::timer::{DateHeaderTimer, EventLoopDelayMonitor};
use bun_jsc::abort_signal::Timeout as AbortSignalTimeout;
use bun_jsc::garbage_collection_controller::GarbageCollectionController;

#[cfg(not(windows))]
use bun_io::pipe_writer::PosixPipeWriter; // brings `on_poll` into scope for FileSinkPoll/StaticPipeWriterPoll/etc.

// ════════════════════════════════════════════════════════════════════════════
// Task dispatch
// ════════════════════════════════════════════════════════════════════════════

/// What the tick loop hands a running task.
pub(crate) struct Tick<'a> {
    pub el: &'a mut EventLoop,
    pub vm: &'a mut VirtualMachine,
    pub global: &'a JSGlobalObject,
}

/// How a queued task runs. This is the only shape a task's JS-thread entry
/// takes: it returns the exception it left pending as `Err`, and never reports
/// it itself — [`tick_queue_with_count`] folds every task's result in one
/// place (`report_error_or_terminate`: report as uncaught, or stand the loop
/// down if it is the VM's termination).
///
/// Implemented (below, in `run_impls`) for every type that has a
/// [`task_tag`]; the tag→type table [`for_each_task!`] generates both the run
/// and the release dispatch from it, so a tag cannot be dispatched any other
/// way.
pub(crate) trait RunTask: Taskable {
    /// The HotReload tasks: return from the drain loop without draining
    /// microtasks after this task.
    const EARLY_RETURN: bool = false;

    /// # Safety
    /// `this` came off the queue under `Self::TAG` (for the tags whose `ptr`
    /// packs an integer, that value) and is not used by the caller afterwards.
    unsafe fn run(this: *mut Self, tick: &mut Tick<'_>) -> JsResult<()>;
}

/// The tag → type table. One row per `task_tag`; `[cold]` rows are the
/// shell/bake tasks kept off the hot dispatcher's pages (see `run_task`).
macro_rules! for_each_task {
    ($m:ident) => {
        $m! {
            [hot] AnyTaskJob => AnyJob;
            [hot] SendQueueDeferred => crate::ipc::SendQueue;
            [hot] AsyncModule => bun_jsc::async_module::AsyncModule;
            [hot] BundleV2PluginResolve => bun_bundler::bundle_v2::api::JSBundler::Resolve;
            [hot] BundleV2PluginLoad => bun_bundler::bundle_v2::api::JSBundler::Load;
            [hot] JSBundleCompletionTask => crate::api::js_bundle_completion_task::JSBundleCompletionTask;
            [hot] FetchTaskletPromiseSettle => crate::webcore::fetch::fetch_tasklet::FetchTaskletPromiseSettle;
            [hot] FileResponseStreamEof => crate::server::FileResponseStream;
            [hot] DuplexUpgradeContext => crate::socket::DuplexUpgradeContext;
            #[cfg(windows)] [hot] WindowsNamedPipeContext => crate::socket::WindowsNamedPipeContext;
            #[cfg(windows)] [hot] GetAddrInfoLibuvComplete => crate::dns_jsc::LibuvCompleteHolder;
            [hot] ValkeyDeferredClose => crate::valkey_jsc::js_valkey::ValkeyDeferredClose;
            [hot] StatWatcherTimerUpdate => crate::node::node_fs_stat_watcher::StatWatcherTimerUpdate;
            [hot] AsyncCpTask => crate::node::fs::AsyncCpTask;
            [hot] ShellAsyncCpTask => crate::node::fs::ShellAsyncCpTask;
            [hot] StatWatcherHop => crate::node::node_fs_stat_watcher::StatWatcher;
            [hot] ManagedTask => ManagedTask;
            [hot] CppTask => CppTask;
            [cold] ShellAsync => crate::shell::dispatch_tasks::ShellAsyncTask;
            [cold] ShellCondExprStatTask => ShellCondExprStatTask;
            [cold] ShellCpTask => ShellCpTask;
            [cold] ShellTouchTask => ShellTouchTask;
            [cold] ShellMkdirTask => ShellMkdirTask;
            [cold] ShellLsTask => ShellLsTask;
            [cold] ShellMvBatchedTask => ShellMvBatchedTask;
            [cold] ShellMvCheckTargetTask => ShellMvCheckTargetTask;
            [cold] ShellRmTask => ShellRmTask;
            [cold] ShellRmDirTask => ShellRmDirTask;
            [cold] ShellGlobTask => ShellGlobTask;
            [cold] ShellYesTask => ShellYesTask;
            [hot] FetchTasklet => FetchTasklet;
            [hot] FetchTaskletDeinit => crate::webcore::fetch::FetchTaskletDeinitHop;
            [hot] S3HttpSimpleTask => S3HttpSimpleTask;
            [hot] S3HttpDownloadStreamingTask => S3HttpDownloadStreamingTask;
            [hot] NapiAsyncWork => napi_async_work;
            [hot] ThreadSafeFunction => ThreadSafeFunction;
            [hot] NapiFinalizerTask => NapiFinalizerTask;
            [hot] JSCDeferredWorkTask => JSCDeferredWorkTask;
            [hot] PollPendingModulesTask => bun_jsc::async_module::Queue;
            [hot] RuntimeTranspilerStore => RuntimeTranspilerStore;
            [hot] HotReloadTask => hot_reloader::HotReloadTask;
            [hot] WatchReloadTask => hot_reloader::WatchReloadTask;
            [cold] BakeHotReloadEvent => BakeHotReloadEvent;
            [hot] FSWatchTask => FSWatchTask;
            #[cfg(windows)] [hot] Open => fs_async::Open;
            #[cfg(windows)] [hot] Close => fs_async::Close;
            #[cfg(windows)] [hot] Read => fs_async::Read;
            #[cfg(windows)] [hot] Write => fs_async::Write;
            #[cfg(windows)] [hot] Readv => fs_async::Readv;
            #[cfg(windows)] [hot] Writev => fs_async::Writev;
            #[cfg(windows)] [hot] StatFS => fs_async::Statfs;
            [hot] NativeZlib => NativeZlib;
            [hot] NativeBrotli => NativeBrotli;
            [hot] NativeZstd => NativeZstd;
            #[cfg(not(windows))] [hot] ProcessWaiterThreadTask => ProcessWaiterThreadTask<Process>;
            [hot] PosixSignalTask => PosixSignalTask;
            [hot] MemoryPressureTask => crate::node::memory_pressure::MemoryPressureTask;
            [hot] NativePromiseContextDeferredDerefTask => NativePromiseContextDeferredDerefTask;
            [hot] ServerAllConnectionsClosedTask => ServerAllConnectionsClosedTask;
            [hot] BundleV2DeferredBatchTask => BundleV2DeferredBatchTask;
            [hot] FlushPendingFileSinkTask => FlushPendingFileSinkTask;
            [hot] StreamPending => StreamPending;
        }
    };
}

/// Compile-time guard that the table tracks `bun_event_loop::task_tag::COUNT`.
/// Bump when adding a tag — and give it a row in `for_each_task!` and a
/// `RunTask` impl.
const _: () = assert!(
    task_tag::COUNT == 62,
    "dispatch::for_each_task! out of sync with bun_event_loop::task_tag",
);

/// A `[cold]` row's arm: the monomorphized run kept out of `run_task`'s body
/// so lld places the shell/bake clusters after the front-clustered startup
/// window (see `src/startup.order`).
#[cold]
#[inline(never)]
unsafe fn run_cold<T: RunTask>(this: *mut (), tick: &mut Tick<'_>) -> JsResult<()> {
    // SAFETY: forwarded caller contract.
    unsafe { T::run(this.cast::<T>(), tick) }
}

macro_rules! __run_arm {
    (hot, $ty:ty, $task:ident, $tick:ident) => {
        // SAFETY: §Dispatch — `task.tag` was set together with `task.ptr` by
        // `Taskable`; the tag identifies the pointee type, and the task just came
        // off the queue and is not used afterwards.
        unsafe { <$ty as RunTask>::run($task.ptr.cast::<$ty>(), $tick) }
    };
    (cold, $ty:ty, $task:ident, $tick:ident) => {
        // SAFETY: as the `hot` arm.
        unsafe { run_cold::<$ty>($task.ptr, $tick) }
    };
}

macro_rules! __gen_run_task {
    ($( $(#[$attr:meta])* [$temp:ident] $tag:ident => $ty:ty; )*) => {
        /// Dispatch a single `Task` to `<T as RunTask>::run`. `Ok(true)` is the
        /// HotReload early return (see [`RunTask::EARLY_RETURN`]).
        // PERF(startup/dot): `#[inline(never)]` is deliberate. `#[inline]` here
        // bloated `tick_queue_with_count` to ~14 KB of `.text` interleaved with
        // cold shell/bake code, blowing the iTLB fault-around window for
        // `bun <file>`. Keeping `run_task` out-of-line lets
        // `tick_queue_with_count` stay a tight drain-loop wrapper
        // (front-clustered via `src/startup.order`); the `[cold]` rows are
        // further hoisted into `run_cold::<T>` so this hot dispatcher stays off
        // their pages.
        #[inline(never)]
        pub(crate) fn run_task(task: Task, tick: &mut Tick<'_>) -> JsResult<bool> {
            match task.tag {
                $( $(#[$attr])* task_tag::$tag => {
                    __run_arm!($temp, $ty, task, tick)?;
                    Ok(<$ty as RunTask>::EARLY_RETURN)
                } )*
                // A tag with no row on this platform, or a value outside
                // `task_tag::COUNT`: a producer bug, treated as a crash, not UB.
                _ => panic!("Unexpected Task tag: {}", task.tag.0),
            }
        }

        /// `__bun_release_task_unrun` — declared `extern "Rust"` in
        /// `bun_jsc::event_loop`. A queued task that will never be dispatched
        /// (its VM is tearing down: script is forbidden and the loop no longer
        /// ticks) is freed through its type's [`Taskable::release_unrun`].
        /// Generated from the same table as `run_task`: a tag cannot run
        /// without its type having decided how it is released.
        #[unsafe(no_mangle)]
        fn __bun_release_task_unrun(task: Task) {
            match task.tag {
                // SAFETY: as `__run_arm!`.
                $( $(#[$attr])* task_tag::$tag => unsafe {
                    <$ty as Taskable>::release_unrun(task.ptr.cast::<$ty>())
                }, )*
                _ => unreachable!("task tag out of range: {}", task.tag.0),
            }
        }
    };
}
for_each_task!(__gen_run_task);

// ────────────────────────────────────────────────────────────────────────────
// `tick_queue_with_count` — the full drain loop, and the one fold.
// ────────────────────────────────────────────────────────────────────────────

pub(crate) fn tick_queue_with_count(
    el: &mut EventLoop,
    vm: &mut VirtualMachine,
    counter: &mut u32,
) -> Result<(), Stopped> {
    // SAFETY: `el.global` is set by VM init before the first tick; live for
    // the duration of the drain loop.
    let global: &JSGlobalObject = unsafe { el.global.expect("EventLoop.global unset").as_ref() };
    let global_vm = global.vm();

    while let Some(task) = el.tasks.read_item() {
        // Incremented before dispatch so the count includes every task,
        // including the one that takes the HotReloadTask early return.
        *counter += 1;
        let mut tick = Tick {
            el: &mut *el,
            vm: &mut *vm,
            global,
        };
        match run_task(task, &mut tick) {
            Ok(false) => {}
            Ok(true) => {
                // Caller is `while tickWithCount(ctx) > 0` — must keep
                // draining after a hot-reload task, so report exactly one
                // task processed. Do NOT set 0 here.
                *counter = 1;
                return Ok(());
            }
            Err(err) => report_error_or_terminate(global, err)?,
        }
        el.drain_microtasks_with_global(global, global_vm)?;
    }
    el.tasks.reset_head_if_empty();
    Ok(())
}

// ────────────────────────────────────────────────────────────────────────────
// `RunTask` impls — one per row of `for_each_task!`. Each is the type's
// existing JS-thread entry with its result surfaced; none reports.
// ────────────────────────────────────────────────────────────────────────────

mod run_impls {
    use super::*;

    /// The erased `bun_jsc::Job<C>` payloads all queue under `AnyTaskJob` and
    /// are reached through their common header.
    pub(crate) enum AnyJob {}
    impl Taskable for AnyJob {
        const TAG: bun_event_loop::TaskTag = task_tag::AnyTaskJob;
        unsafe fn release_unrun(this: *mut Self) {
            let js = VirtualMachine::get().global().js_thread();
            // SAFETY: forwarded caller contract; every payload is a `Job<C>`.
            unsafe { bun_jsc::job::release_unrun_erased(this.cast(), &js) }
        }
    }
    impl RunTask for AnyJob {
        #[inline]
        unsafe fn run(this: *mut Self, tick: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: `this` is a live heap `Job<C>` posted by its `Completion`;
            // the erased entry runs `then` and frees it.
            unsafe { bun_jsc::job::complete_erased(this.cast(), &tick.global.js_thread()) }
        }
    }

    impl RunTask for crate::ipc::SendQueue {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: the queued pointer is the SendQueue root and the task owns
            // a ref for its duration; `run_deferred` releases it.
            unsafe { crate::ipc::SendQueue::run_deferred(this) };
            Ok(())
        }
    }

    impl RunTask for bun_jsc::async_module::AsyncModule {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: `AsyncModule::done` boxed it; the arm consumes the box.
            bun_jsc::async_module::AsyncModule::on_done(unsafe { bun_core::heap::take(this) })
        }
    }

    impl RunTask for bun_bundler::bundle_v2::api::JSBundler::Resolve {
        #[inline]
        unsafe fn run(this: *mut Self, tick: &mut Tick<'_>) -> JsResult<()> {
            // `bun_bundler` is JSC-free; the C++ hop it calls answers the request
            // itself when the plugin throws, but can return early with an
            // exception pending (argument conversion), so check the scope here.
            // SAFETY: a live `Resolve` owned by the plugin dispatch chain.
            bun_jsc::call_check_slow(tick.global, || unsafe { &mut *this }.run_on_js_thread())
        }
    }

    impl RunTask for bun_bundler::bundle_v2::api::JSBundler::Load {
        #[inline]
        unsafe fn run(this: *mut Self, tick: &mut Tick<'_>) -> JsResult<()> {
            // As `Resolve`.
            // SAFETY: a live `Load` owned by the plugin dispatch chain.
            bun_jsc::call_check_slow(tick.global, || unsafe { &mut *this }.run_on_js_thread())
        }
    }

    impl RunTask for crate::api::js_bundle_completion_task::JSBundleCompletionTask {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            Self::on_complete_anytask(this).map_err(Into::into)
        }
    }

    impl RunTask for crate::webcore::fetch::fetch_tasklet::FetchTaskletPromiseSettle {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: boxed at the fetch completion site; the arm consumes it.
            unsafe { bun_core::heap::take(this) }.run()
        }
    }

    impl RunTask for crate::server::FileResponseStream {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: `on_read_chunk` took a ref for this task at enqueue time,
            // which this guard adopts; `this` is live for the call.
            let _pin = unsafe { bun_ptr::ScopedRef::<Self>::adopt(this) };
            // SAFETY: pinned above.
            unsafe { (*this).on_reader_done() };
            Ok(())
        }
    }

    impl RunTask for crate::socket::DuplexUpgradeContext {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: `run_event` may free the context, so it takes the raw
            // pointer (no `&mut` at this boundary).
            unsafe { Self::run_event(this) };
            Ok(())
        }
    }

    #[cfg(windows)]
    impl RunTask for crate::socket::WindowsNamedPipeContext {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: as `DuplexUpgradeContext`.
            unsafe { Self::run_event(this) };
            Ok(())
        }
    }

    #[cfg(windows)]
    impl RunTask for crate::dns_jsc::LibuvCompleteHolder {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: boxed in `on_raw_libuv_complete`; the arm consumes it.
            unsafe { bun_core::heap::take(this) }.run();
            Ok(())
        }
    }

    impl RunTask for crate::valkey_jsc::js_valkey::ValkeyDeferredClose {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: boxed at the enqueue site; the arm consumes it.
            unsafe { bun_core::heap::take(this) }.run();
            Ok(())
        }
    }

    impl RunTask for crate::node::node_fs_stat_watcher::StatWatcherTimerUpdate {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: boxed in `schedule_timer_update`; the arm consumes it.
            unsafe { bun_core::heap::take(this) }.run();
            Ok(())
        }
    }

    impl RunTask for crate::node::fs::AsyncCpTask {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: posted by `on_subtask_done` with the count at zero (exclusive).
            unsafe { (*this).run_from_js_thread() }
        }
    }

    impl RunTask for crate::node::fs::ShellAsyncCpTask {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: as `AsyncCpTask`.
            unsafe { (*this).run_from_js_thread() }
        }
    }

    impl RunTask for crate::node::node_fs_stat_watcher::StatWatcher {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: posted by `StatWatcher::post_to_js_thread` with a ref held.
            unsafe { Self::run_hop(this) }.map_err(Into::into)
        }
    }

    impl RunTask for ManagedTask {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: produced by `heap::alloc` in `ManagedTask::new`; `run`
            // consumes/frees it.
            unsafe { ManagedTask::run(this) }.map_err(Into::into)
        }
    }

    impl RunTask for CppTask {
        #[inline]
        unsafe fn run(this: *mut Self, tick: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: a live C++ `EventLoopTask`; `run` consumes it.
            unsafe { &mut *this }.run(tick.global)
        }
    }

    // ── shell interpreter ────────────────────────────────────────────────
    /// Shell builtin tasks: route through `ShellTask::run_from_main_thread`
    /// so the keep-alive ref taken in `ShellTask::schedule` is unref'd before
    /// the per-builtin body runs; the wrapper recovers `&mut Interpreter` from
    /// the embedded `ShellTask.interp` back-ref.
    macro_rules! shell_run_task {
        ($($ty:ty),* $(,)?) => {$(
            impl RunTask for $ty {
                #[inline]
                unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
                    // SAFETY: a live heap-allocated shell task; `interp` was
                    // set at schedule time and outlives the task.
                    unsafe { ShellTask::run_from_main_thread::<$ty>(this) };
                    Ok(())
                }
            }
        )*};
    }
    shell_run_task!(
        ShellCpTask,
        ShellTouchTask,
        ShellMkdirTask,
        ShellLsTask,
        ShellMvBatchedTask,
        ShellMvCheckTargetTask,
        ShellRmTask,
        ShellGlobTask,
    );

    impl RunTask for crate::shell::dispatch_tasks::ShellAsyncTask {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: tag identifies pointee; `interp` set at enqueue and
            // outlives the task.
            let t = unsafe { &mut *this };
            let interp = unsafe { &*t.interp };
            ShellAsync::run_from_main_thread(interp, t.node);
            Ok(())
        }
    }

    impl RunTask for ShellCondExprStatTask {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // Cond-expr wraps an inner `task: ShellTask`-embedding struct one
            // level deeper (two-hop `TASK_OFFSET`), so the unref +
            // interp-recovery are inlined here to keep the `.task.task` shape
            // explicit.
            // SAFETY: as `shell_run_task!`; `task.task` is the embedded ShellTask.
            unsafe {
                let st = &raw mut (*this).task.task;
                (*st).keep_alive.unref((*st).event_loop.as_event_loop_ctx());
                let interp = &*(*st).interp;
                Self::run_from_main_thread(this, interp);
            }
            Ok(())
        }
    }

    impl RunTask for ShellRmDirTask {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            Self::run_from_main_thread(this);
            Ok(())
        }
    }

    impl RunTask for ShellYesTask {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: enqueued by `YesTask::enqueue`; storage lives inside
            // `Box<Yes>` in the interpreter arena and is stable until the
            // builtin deinits.
            Self::run_from_main_thread(unsafe { &*this });
            Ok(())
        }
    }

    // ── fetch / S3 ───────────────────────────────────────────────────────
    impl RunTask for FetchTasklet {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: a live tasklet; the HTTP thread's ref keeps it until deinit.
            unsafe { &mut *this }.on_progress_update()
        }
    }

    impl RunTask for crate::webcore::fetch::FetchTaskletDeinitHop {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: posted by `deref_from_thread` with the last ref.
            unsafe { Self::run(this) };
            Ok(())
        }
    }

    impl RunTask for S3HttpSimpleTask {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // JS-thread dispatch is the sole owner of the heap task here.
            Self::on_response(this)
        }
    }

    impl RunTask for S3HttpDownloadStreamingTask {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            Self::on_response(this)
        }
    }

    // ── napi ─────────────────────────────────────────────────────────────
    impl RunTask for napi_async_work {
        #[inline]
        unsafe fn run(this: *mut Self, tick: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: a live `napi_async_work` posted from its pool completion.
            unsafe { &mut *this }.run_from_js(tick.global)
        }
    }

    impl RunTask for ThreadSafeFunction {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            Self::on_dispatch(this)
        }
    }

    impl RunTask for NapiFinalizerTask {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            Self::run_on_js_thread(this)
        }
    }

    // ── JSC scheduler / module loader ────────────────────────────────────
    impl RunTask for JSCDeferredWorkTask {
        #[inline]
        unsafe fn run(this: *mut Self, tick: &mut Tick<'_>) -> JsResult<()> {
            bun_jsc::mark_binding();
            // SAFETY: a live JSC deferred-work ticket.
            unsafe { &mut *this }.run(tick.global)
        }
    }

    impl RunTask for bun_jsc::async_module::Queue {
        #[inline]
        unsafe fn run(_: *mut Self, tick: &mut Tick<'_>) -> JsResult<()> {
            tick.vm.modules.on_poll();
            Ok(())
        }
    }

    impl RunTask for RuntimeTranspilerStore {
        #[inline]
        unsafe fn run(this: *mut Self, tick: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: the VM's transpiler store, live for the VM.
            unsafe { &mut *this }.run_from_js_thread(
                (&mut *tick.el).into(),
                tick.global,
                (&mut *tick.vm).into(),
            )
        }
    }

    // ── hot-reload (early-returns from the drain loop) ───────────────────
    impl RunTask for hot_reloader::HotReloadTask {
        const EARLY_RETURN: bool = true;
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: heap-allocated in `Task::enqueue`; `deinit` frees it.
            unsafe { (*this).run() };
            unsafe { Self::deinit(this) };
            Ok(())
        }
    }

    impl RunTask for hot_reloader::WatchReloadTask {
        const EARLY_RETURN: bool = true;
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: as `HotReloadTask`.
            unsafe { (*this).run() };
            unsafe { Self::deinit(this) };
            Ok(())
        }
    }

    // ── bake dev-server ──────────────────────────────────────────────────
    impl RunTask for BakeHotReloadEvent {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // The event lives in a heap `WatcherAtomics` that can outlive its
            // `DevServer`. `run` either re-derives `&mut DevServer` from the
            // BACKREF or (when the owner has been dropped) only reclaims the
            // heap `WatcherAtomics`, so pass the raw pointer to avoid
            // materialising an aliasing `&mut` here.
            // SAFETY: tag identifies pointee.
            unsafe { Self::run(this) };
            Ok(())
        }
    }

    impl RunTask for FSWatchTask {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // Heap-allocated (cloned from `FSWatcher.current_task` at enqueue);
            // `deinit` is explicit (not `Drop`) so the embedded `current_task`
            // field never runs it.
            // SAFETY: tag identifies pointee; live Box'd FSWatchTask.
            let emitted = unsafe { (*this).run() };
            // SAFETY: paired with heap::alloc in `FSWatchTask::enqueue`.
            unsafe { Self::deinit(this) };
            emitted
        }
    }

    // ── node:fs libuv-request ops (Windows) ──────────────────────────────
    #[cfg(windows)]
    macro_rules! fs_uv_run_task {
        ($($tag:ident $ty:ident;)*) => {$(
            impl RunTask for fs_async::$ty {
                #[inline]
                unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
                    // SAFETY: a live libuv request completed on the JS thread.
                    unsafe { &mut *this }.run_from_js_thread()
                }
            }
        )*};
    }
    #[cfg(windows)]
    for_each_fs_uv_op!(fs_uv_run_task);

    // ── compression streams ──────────────────────────────────────────────
    /// `CompressionStream::<T>::run_from_js_thread` takes `*mut T` (full
    /// allocation provenance — R-2) so its trailing `T::deref()` may free the box.
    macro_rules! compression_run_task {
        ($($T:ty),*) => {$(
            impl RunTask for $T {
                #[inline]
                unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
                    // SAFETY: tag identifies pointee; live m_ctx payload.
                    unsafe { node_zlib_binding::CompressionStream::<$T>::run_from_js_thread(this) };
                    Ok(())
                }
            }
        )*};
    }
    compression_run_task!(NativeZlib, NativeBrotli, NativeZstd);

    // ── process / signals ────────────────────────────────────────────────
    #[cfg(not(windows))]
    impl RunTask for ProcessWaiterThreadTask<Process> {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: heap-allocated in WaiterThread; the arm consumes it.
            unsafe { bun_core::heap::take(this) }.run_from_js_thread();
            Ok(())
        }
    }

    impl RunTask for PosixSignalTask {
        #[inline]
        unsafe fn run(this: *mut Self, tick: &mut Tick<'_>) -> JsResult<()> {
            // `this` here is *not* a pointer but a packed signal number.
            Self::run_from_js_thread(this as usize as u8, tick.global);
            Ok(())
        }
    }

    impl RunTask for crate::node::memory_pressure::MemoryPressureTask {
        #[inline]
        unsafe fn run(this: *mut Self, tick: &mut Tick<'_>) -> JsResult<()> {
            // `this` is the packed level (NOTE_MEMORYSTATUS_PRESSURE_* bits), not a pointer.
            crate::node::memory_pressure::emit(tick.global, this as usize as i32);
            Ok(())
        }
    }

    impl RunTask for NativePromiseContextDeferredDerefTask {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // `this` packs an int, not a pointer.
            Self::run_from_js_thread(this as usize);
            Ok(())
        }
    }

    // ── server / bundler / streams ───────────────────────────────────────
    impl RunTask for ServerAllConnectionsClosedTask {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            Self::run_from_js_thread(this)
        }
    }

    impl RunTask for BundleV2DeferredBatchTask {
        #[inline]
        unsafe fn run(this: *mut Self, tick: &mut Tick<'_>) -> JsResult<()> {
            // `bun_bundler` is JSC-free so the exception-scope check is hoisted
            // here; without it, `JSBundlerPlugin__drainDeferred`'s THROW_SCOPE
            // is left unchecked and trips JSC exception validation at the next
            // `drainMicrotasks` scope.
            // SAFETY: an intrusive field of a live `BundleV2`.
            bun_jsc::call_check_slow(tick.global, || unsafe { &mut *this }.run_on_js_thread())
        }
    }

    impl RunTask for FlushPendingFileSinkTask {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // SAFETY: the heap-allocated task; sole owner.
            unsafe { Self::run_from_js_thread(this) }
        }
    }

    impl RunTask for StreamPending {
        #[inline]
        unsafe fn run(this: *mut Self, _: &mut Tick<'_>) -> JsResult<()> {
            // The heap-allocated task; sole owner.
            Self::run_from_js_thread(this)
        }
    }
}
use run_impls::AnyJob;

// ════════════════════════════════════════════════════════════════════════════
// FilePoll dispatch
// ════════════════════════════════════════════════════════════════════════════

/// Hot-path dispatcher for `bun_io::FilePoll::on_update`. Declared
/// `extern "Rust"` in `bun_io::posix_event_loop`; the low-tier `FilePoll`
/// calls this directly (link-time resolved) so it never names `Subprocess` /
/// `FileSink` / `DNSResolver` / etc.
///
/// # Safety
/// `poll` must point at a live [`FilePoll`] for the duration of the call
/// (guaranteed by `FilePoll::on_update`, the only caller).
#[cfg(not(windows))]
#[unsafe(no_mangle)]
pub(crate) unsafe fn __bun_run_file_poll(poll: *mut FilePoll, size_or_offset: i64) {
    // SAFETY: contract above.
    let poll_ref = unsafe { &mut *poll };
    let owner = poll_ref.owner;
    let hup = poll_ref.flags.contains(PollFlag::Hup);

    debug_assert!(!owner.is_null());

    /// `ptr.as(T)` — recover the typed owner.
    macro_rules! owner_as {
        ($ty:ty) => {{
            // SAFETY: tag set with this pointee type at `FilePoll::init`.
            unsafe { &mut *owner.ptr.cast::<$ty>() }
        }};
    }
    /// One match-arm body of the poll-tag dispatch. Recovers the typed owner as
    /// a RAW `*mut $Ty` (never `&mut` — re-entrant callees like `DNSResolver`
    /// pick their own deref mode without aliasing UB) then runs `$body`. The
    /// 1-arg form is the plain `on_poll(size_or_offset, hup)` call that
    /// covers most tags.
    macro_rules! poll_arm {
        ($Ty:ty) => {
            poll_arm!($Ty, |h| {
                // SAFETY: tag matched, so `owner.ptr` was stored as `*mut $Ty` at
                // `FilePoll::init` and the owner outlives this dispatch (caller contract).
                unsafe { (*h).on_poll(size_or_offset as isize, hup) }
            })
        };
        ($Ty:ty, |$h:ident| $body:expr) => {{
            // SAFETY: tag was set together with this pointee type at `FilePoll::init`.
            let $h: *mut $Ty = owner.ptr.cast::<$Ty>();
            $body;
        }};
    }

    match owner.tag() {
        poll_tag::BUFFERED_READER => poll_arm!(bun_io::BufferedReader, |h| {
            // SAFETY: tag matched, so `owner.ptr` is a live `*mut BufferedReader`
            // set at `FilePoll::init`. Passed raw: `on_poll`'s read loops run
            // user JS that can re-enter the reader, so no `&mut` may span the
            // dispatch.
            unsafe { bun_io::BufferedReader::on_poll(h, size_or_offset as isize, hup) }
        }),
        poll_tag::PROCESS => {
            // Bypass `owner_as!` (which yields `&mut`) — `Process` may be freed
            // by the trailing `deref`, so keep raw provenance end-to-end.
            let proc = owner.ptr.cast::<Process>();
            // SAFETY: `proc` carries the +1 ref taken at queue time; this drops it.
            unsafe { Process::on_wait_pid_from_event_loop_task(proc) };
        }
        poll_tag::MEMORY_PRESSURE => {
            // SAFETY: `poll` is live per `__bun_run_file_poll`'s contract.
            crate::node::memory_pressure::on_poll(unsafe { &mut *poll }, size_or_offset);
        }
        poll_tag::PARENT_DEATH_WATCHDOG => {
            let wd = owner_as!(bun_io::parent_death_watchdog::ParentDeathWatchdog);
            // Mac-only — debug-assert elsewhere (Linux uses prctl(PR_SET_PDEATHSIG)).
            #[cfg(target_os = "macos")]
            bun_io::parent_death_watchdog::on_parent_exit(wd);
            #[cfg(not(target_os = "macos"))]
            {
                debug_assert!(false, "ParentDeathWatchdog poll on non-mac");
                let _ = wd;
            }
        }

        poll_tag::FILE_SINK => poll_arm!(FileSinkPoll),
        poll_tag::STATIC_PIPE_WRITER => poll_arm!(StaticPipeWriterPoll<Subprocess<'_>>),
        poll_tag::SHELL_STATIC_PIPE_WRITER => {
            poll_arm!(StaticPipeWriterPoll<crate::shell::subproc::ShellSubprocess>)
        }
        poll_tag::SECURITY_SCAN_STATIC_PIPE_WRITER => {
            poll_arm!(StaticPipeWriterPoll<bun_install::SecurityScanSubprocess<'_>>)
        }
        // `bun.shell.Interpreter.IOWriter.Poll`
        poll_tag::SHELL_BUFFERED_WRITER => poll_arm!(ShellBufferedWriterPoll, |h| {
            // SAFETY: tag matched, so `owner.ptr` is a live `*mut ShellBufferedWriterPoll`
            // set at `FilePoll::init`; exclusive for this dispatch.
            unsafe { crate::shell::io_writer::on_poll(&mut *h, size_or_offset as isize, hup) }
        }),
        poll_tag::DNS_RESOLVER => {
            // R-2: deref as shared (`&*const`) — `on_dns_poll` takes `&self` and
            // `Channel::process` re-enters the resolver via c-ares callbacks.
            // SAFETY: tag set with this pointee type at `FilePoll::init`.
            let resolver = unsafe { &*owner.ptr.cast_const().cast::<DNSResolver>() };
            // SAFETY: `poll` outlives this call (caller contract).
            resolver.on_dns_poll(unsafe { &mut *poll });
        }
        poll_tag::GET_ADDR_INFO_REQUEST => {
            #[cfg(target_os = "macos")]
            {
                let shared = owner.ptr.cast::<crate::dns_jsc::dns_sd::SharedConnection>();
                crate::dns_jsc::dns_sd::SharedConnection::on_readable(shared);
            }
            #[cfg(not(target_os = "macos"))]
            {
                debug_assert!(false, "dns_sd SharedConnection poll on non-mac");
            }
        }
        poll_tag::TERMINAL_POLL => poll_arm!(TerminalPoll),
        // `OutputReader = BufferedReader` in install crate — separate tag for ownership.
        poll_tag::LIFECYCLE_SCRIPT_SUBPROCESS_OUTPUT_READER => {
            poll_arm!(bun_io::BufferedReader, |h| {
                // SAFETY: tag matched, so `owner.ptr` is a live `*mut BufferedReader`
                // set at `FilePoll::init`. Passed raw (see BUFFERED_READER above).
                unsafe { bun_io::BufferedReader::on_poll(h, size_or_offset as isize, hup) }
            })
        }

        poll_tag::NULL => {
            // The low-tier `on_update` already logged before calling the hook
            // when it was null; here we just no-op the unknown tag.
            let _ = (size_or_offset, hup);
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
// io::Poll dispatch
// ════════════════════════════════════════════════════════════════════════════

use crate::webcore::blob::read_file::ReadFile;
use crate::webcore::blob::write_file::WriteFile;

/// `bun_io::__bun_io_pollable_on_ready` body — declared `extern "Rust"` in
/// `bun_io`. The owner is recovered from the embedded `io_poll` field.
///
/// # Safety
/// `poll` is the `io_poll` field of a live owner of type `tag`.
#[unsafe(no_mangle)]
unsafe fn __bun_io_pollable_on_ready(tag: bun_io::PollableTag, poll: *mut bun_io::Poll) {
    match tag {
        bun_io::PollableTag::ReadFile => {
            // SAFETY: per fn contract.
            let this = unsafe { &mut *bun_core::from_field_ptr!(ReadFile, io_poll, poll) };
            this.on_ready();
        }
        bun_io::PollableTag::WriteFile => {
            // SAFETY: per fn contract.
            let this = unsafe { &mut *bun_core::from_field_ptr!(WriteFile, io_poll, poll) };
            this.on_ready();
        }
        bun_io::PollableTag::Empty => {
            // Waker / unblock-only — caller already filtered this out.
            debug_assert!(false, "io::Poll on_ready with Empty tag");
        }
    }
}

/// `bun_io::__bun_io_pollable_on_io_error` body — declared `extern "Rust"` in
/// `bun_io`.
///
/// # Safety
/// `poll` is the `io_poll` field of a live owner of type `tag`.
#[unsafe(no_mangle)]
unsafe fn __bun_io_pollable_on_io_error(
    tag: bun_io::PollableTag,
    poll: *mut bun_io::Poll,
    err: &bun_sys::Error,
) {
    match tag {
        bun_io::PollableTag::ReadFile => {
            // SAFETY: per fn contract.
            let this = unsafe { &mut *bun_core::from_field_ptr!(ReadFile, io_poll, poll) };
            this.on_io_error(err);
        }
        bun_io::PollableTag::WriteFile => {
            // SAFETY: per fn contract.
            let this = unsafe { bun_core::from_field_ptr!(WriteFile, io_poll, poll) };
            // WriteFile::on_io_error already takes `*mut ()` (it
            // self-recovers via the io_request path elsewhere); reuse that
            // shape rather than reborrowing `&mut`.
            WriteFile::on_io_error(this.cast(), err);
        }
        bun_io::PollableTag::Empty => {
            debug_assert!(false, "io::Poll on_io_error with Empty tag");
            let _ = err;
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
// `bun_jsc::event_loop` extern impls (link-time)
// ════════════════════════════════════════════════════════════════════════════

/// `__bun_run_immediate_task` body — cast the low-tier erased `*mut ()` to the
/// real `crate::timer::ImmediateObject` and run the task (low tier stores
/// `*mut ()`, high tier owns the cast).
///
/// # Safety
/// `task` was produced by `enqueue_immediate_task` from a live
/// `timer::ImmediateObject`; `vm` is the live per-thread VM.
#[unsafe(no_mangle)]
unsafe fn __bun_run_immediate_task(
    task: *mut (),
    vm: *mut bun_jsc::virtual_machine::VirtualMachine,
) -> bool {
    // SAFETY: per fn contract — the only producer (`TimerObjectInternals::init`)
    // stores a `*mut crate::timer::ImmediateObject`, so the cast is the identity.
    unsafe {
        crate::timer::ImmediateObject::run_immediate_task(
            task.cast::<crate::timer::ImmediateObject>(),
            vm,
        )
    }
}

/// `__bun_cancel_pending_immediate` body — VM-teardown release of the event
/// loop's `+1` ref on a still-queued `ImmediateObject` (low tier stores
/// `*mut ()`, high tier owns the cast). Does not run the callback.
///
/// # Safety
/// `task` was produced by `enqueue_immediate_task` from a live
/// `timer::ImmediateObject` whose event-loop ref has not yet been released;
/// `vm` is the live per-thread VM with `RuntimeState` still installed.
#[unsafe(no_mangle)]
unsafe fn __bun_cancel_pending_immediate(
    task: *mut (),
    vm: *mut bun_jsc::virtual_machine::VirtualMachine,
) {
    // SAFETY: per fn contract — the only producer (`TimerObjectInternals::init`)
    // stores a `*mut crate::timer::ImmediateObject`, so the cast is the identity.
    unsafe {
        crate::timer::ImmediateObject::cancel_pending(
            task.cast::<crate::timer::ImmediateObject>(),
            vm,
        );
    }
}

/// `__bun_run_wtf_timer` body — cast the low-tier erased `*mut ()` to the real
/// `crate::timer::WTFTimer` and fire it.
///
/// # Safety
/// `timer` was published by `WTFTimer::update` into `imminent_gc_timer` and
/// remains live until consumed; `vm` is the live per-thread VM.
#[unsafe(no_mangle)]
unsafe fn __bun_run_wtf_timer(timer: *mut (), vm: *mut bun_jsc::virtual_machine::VirtualMachine) {
    // SAFETY: per fn contract — the only producer (`WTFTimer::update`) stores a
    // `*mut crate::timer::WTFTimer`, so the cast is the identity.
    let real = timer.cast::<crate::timer::WTFTimer>();
    // SAFETY: per fn contract — `real` is live until consumed; `vm` is the
    // per-thread VM. `run` may re-enter `(*runtime_state()).timer.remove()`;
    // no `&mut` held here.
    unsafe { crate::timer::WTFTimer::run(real, vm) }
}

// ════════════════════════════════════════════════════════════════════════════
// EventLoopTimer dispatch
// ════════════════════════════════════════════════════════════════════════════

/// `__bun_fire_timer` body — the tag→`container_of` match for
/// [`EventLoopTimer::fire`].
///
/// Reached from [`crate::timer::All::drain_timers`] (every due heap timer) and
/// [`crate::timer::All::get_timeout`] (WTFTimer side-effect).
///
/// Each arm is the owner's timer entry with its result surfaced: an owner
/// returns the exception it left pending and never reports it; the drain loop
/// (`All::drain_timers`) folds every timer's result in one place. Owners whose
/// entry cannot enter JS return `()`, lifted to `Ok(())` by [`IntoTimerResult`].
///
/// # Safety
/// `t` points at a live [`EventLoopTimer`] just popped from `All.timers`;
/// `now` is the snapshot taken by `All::next`; `vm` is the erased
/// `*mut VirtualMachine`. The handler may free the container — do not touch
/// `t` after the per-arm call returns.
#[unsafe(no_mangle)]
pub(crate) unsafe fn __bun_fire_timer(
    t: *mut EventLoopTimer,
    now: *const ElTimespec,
    vm: *mut (),
) -> bun_event_loop::JsResult<()> {
    use crate::timer::{ImmediateObject, TimeoutObject, TimerObjectInternals, WTFTimer};

    /// Recover the embedding container from `t` (the popped timer slot).
    macro_rules! owner {
        ($ty:ty, $field:ident) => {{
            // SAFETY: §Dispatch — `t.tag` was set together with the container
            // at construction; tag uniquely identifies the embedding type and
            // `$field` is the `EventLoopTimer` slot `t` points into.
            unsafe { bun_core::from_field_ptr!($ty, $field, t) }
        }};
    }
    // SAFETY: per fn contract — `t` is live for the dispatch read.
    let tag = unsafe { (*t).tag };
    let vm = vm.cast::<VirtualMachine>();

    /// One match-arm body: recover the container as RAW `*mut $Ty` (never
    /// `&mut` — the handler may free it or re-enter), bind `now`/`vm`, and run
    /// `$body` under one `unsafe` covering the per-fn-contract dereferences.
    /// Defined *after* the `vm` cast so the def-site `vm` ident resolves to
    /// the typed `*mut VirtualMachine`, not the erased `*mut ()` param.
    macro_rules! timer_arm {
        ($Ty:ty, $field:ident, |$c:ident, $now:ident, $vm:ident| $body:expr) => {{
            let $c: *mut $Ty = owner!($Ty, $field);
            let ($now, $vm) = (now, vm);
            // SAFETY: per fn contract; container derived from a live `$Ty`.
            IntoTimerResult::into_timer_result(unsafe { $body })
        }};
    }
    let fired: JsResult<()> = match tag {
        // ── JS-exposed timers (TimerObjectInternals::fire) ───────────────
        // `Bun__JSTimeout__call` reports the callback's exception itself.
        EventLoopTimerTag::TimeoutObject => {
            let container = owner!(TimeoutObject, event_loop_timer);
            // SAFETY: container derived from a live `TimeoutObject`; do NOT
            // form `&mut *container` — `internals.fire` may `deref()` and free.
            let internals = unsafe { core::ptr::addr_of_mut!((*container).internals) };
            // SAFETY: per fn contract — `now` is the live snapshot; `vm` is the
            // per-thread VM. `fire` may free the container; `t` is dead after.
            // `fire` takes `*mut Self` (noalias re-entrancy — see its doc).
            unsafe { TimerObjectInternals::fire(internals, &*now, vm) };
            Ok(())
        }
        EventLoopTimerTag::ImmediateObject => {
            let container = owner!(ImmediateObject, event_loop_timer);
            // SAFETY: see TimeoutObject arm.
            let internals = unsafe { core::ptr::addr_of_mut!((*container).internals) };
            // SAFETY: see TimeoutObject arm.
            unsafe { TimerObjectInternals::fire(internals, &*now, vm) };
            Ok(())
        }
        EventLoopTimerTag::WTFTimer => {
            timer_arm!(WTFTimer, event_loop_timer, |c, now, vm| WTFTimer::fire(
                c, &*now, vm
            ))
        }
        EventLoopTimerTag::AbortSignalTimeout => {
            timer_arm!(AbortSignalTimeout, event_loop_timer, |c, _now, vm| {
                AbortSignalTimeout::run(c, vm)
            })
        }
        EventLoopTimerTag::GcRepeating => {
            timer_arm!(
                GarbageCollectionController,
                gc_repeating_timer,
                |c, _now, vm| GarbageCollectionController::on_gc_repeating_timer(c, vm)
            )
        }
        EventLoopTimerTag::DateHeaderTimer => {
            timer_arm!(DateHeaderTimer, event_loop_timer, |c, _now, vm| (*c)
                .run(&mut *vm))
        }
        EventLoopTimerTag::EventLoopDelayMonitor => {
            timer_arm!(EventLoopDelayMonitor, event_loop_timer, |c, now, vm| {
                (*c).on_fire(&mut *vm, &*now)
            })
        }
        EventLoopTimerTag::StatWatcherScheduler => {
            timer_arm!(StatWatcherScheduler, event_loop_timer, |c, _now, _vm| (*c)
                .timer_callback())
        }
        EventLoopTimerTag::UpgradedDuplex => {
            timer_arm!(UpgradedDuplex, event_loop_timer, |c, _now, _vm| (*c)
                .on_timeout())
        }
        EventLoopTimerTag::DnsSdConnection => {
            #[cfg(target_os = "macos")]
            {
                timer_arm!(
                    crate::dns_jsc::dns_sd::SharedConnection,
                    early_out_timer,
                    |c, _now, _vm| crate::dns_jsc::dns_sd::SharedConnection::on_early_out(c)
                )
            }
            #[cfg(not(target_os = "macos"))]
            {
                if cfg!(debug_assertions) {
                    unreachable!("DnsSdConnection timer on non-macOS");
                }
                Ok(())
            }
        }
        // R-2: shared deref — `check_timeouts` re-enters via `ares_process_fd`.
        EventLoopTimerTag::DNSResolver => {
            timer_arm!(DNSResolver, event_loop_timer, |c, now, vm| {
                (&*c.cast_const()).check_timeouts(&*now, &*vm)
            })
        }
        EventLoopTimerTag::WindowsNamedPipe => {
            #[cfg(windows)]
            {
                let container = owner!(WindowsNamedPipe, event_loop_timer);
                // SAFETY: per fn contract.
                IntoTimerResult::into_timer_result(unsafe { (*container).on_timeout() })
            }
            #[cfg(not(windows))]
            {
                if cfg!(debug_assertions) {
                    unreachable!("WindowsNamedPipe timer on non-Windows");
                }
                Ok(())
            }
        }
        EventLoopTimerTag::PostgresSQLConnectionTimeout => {
            // SAFETY: §Dispatch — tag set together with the container at
            // construction; `t` is the connection's `timer` field.
            let container = unsafe { PostgresSQLConnection::from_timer_ptr(t) };
            // SAFETY: per fn contract.
            IntoTimerResult::into_timer_result(unsafe { (*container).on_connection_timeout() })
        }
        EventLoopTimerTag::PostgresSQLConnectionMaxLifetime => {
            // SAFETY: §Dispatch — `t` is the connection's `max_lifetime_timer`.
            let container = unsafe { PostgresSQLConnection::from_max_lifetime_timer_ptr(t) };
            // SAFETY: per fn contract.
            IntoTimerResult::into_timer_result(unsafe { (*container).on_max_lifetime_timeout() })
        }
        EventLoopTimerTag::MySQLConnectionTimeout => {
            // SAFETY: §Dispatch — `t` is the connection's `timer` field.
            let container = unsafe { MySQLConnection::from_timer_ptr(t) };
            // SAFETY: per fn contract.
            IntoTimerResult::into_timer_result(unsafe { (*container).on_connection_timeout() })
        }
        EventLoopTimerTag::MySQLConnectionMaxLifetime => {
            // SAFETY: §Dispatch — `t` is the connection's `max_lifetime_timer`.
            let container = unsafe { MySQLConnection::from_max_lifetime_timer_ptr(t) };
            // SAFETY: per fn contract.
            IntoTimerResult::into_timer_result(unsafe { (*container).on_max_lifetime_timeout() })
        }
        EventLoopTimerTag::ValkeyConnectionTimeout => {
            timer_arm!(Valkey, timer, |c, _now, _vm| (*c).on_connection_timeout())
        }
        EventLoopTimerTag::ValkeyConnectionReconnect => {
            timer_arm!(Valkey, reconnect_timer, |c, _now, _vm| (*c)
                .on_reconnect_timer())
        }
        EventLoopTimerTag::SubprocessTimeout => {
            timer_arm!(Subprocess<'_>, event_loop_timer, |c, _now, _vm| (*c)
                .timeout_callback())
        }
        EventLoopTimerTag::DevServerSweepSourceMaps => {
            // `sweep_weak_refs` takes the raw `*EventLoopTimer` and recovers
            // the store inside.
            // SAFETY: per fn contract.
            SourceMapStore::sweep_weak_refs(t, unsafe { &*now });
            Ok(())
        }
        EventLoopTimerTag::DevServerMemoryVisualizerTick => {
            // SAFETY: per fn contract; `t` is the `memory_visualizer_timer`
            // field of a live DevServer.
            DevServer::emit_memory_visualizer_message_timer(unsafe { &mut *t }, unsafe { &*now });
            Ok(())
        }
        EventLoopTimerTag::BunTest => {
            let container = owner!(BunTest, timer);
            // SAFETY: container is the payload of a live `Rc<BunTestCell>`; the
            // strong count is ≥1 (held by `Jest.active_file`).
            // `BunTestCell` is a `UnsafeCell<BunTest>` newtype — same
            // layout as `BunTest`, so the raw `*mut BunTest` recovered above is
            // also the `Rc` payload pointer.
            let strong: BunTestPtr = unsafe {
                let rc = std::rc::Rc::from_raw(
                    container as *const crate::test_runner::bun_test::BunTestCell,
                );
                let cloned = std::rc::Rc::clone(&rc);
                // Don't drop the original ref — it's borrowed, not owned here.
                let _ = std::rc::Rc::into_raw(rc);
                cloned
            };
            // SAFETY: per fn contract. `bun_test_timeout_callback` takes a
            // `&bun_core::Timespec`; the low-tier `EventLoopTimer::Timespec` is
            // a layout-identical local stub.
            let now_core = unsafe {
                bun_core::Timespec {
                    sec: (*now).sec,
                    nsec: (*now).nsec,
                }
            };
            BunTest::bun_test_timeout_callback(&strong, &now_core, VirtualMachine::get());
            Ok(())
        }
        EventLoopTimerTag::CronJob => {
            let c: *mut CronJob = owner!(CronJob, event_loop_timer);
            CronJob::on_timer_fire(c, VirtualMachine::get())
        }
        EventLoopTimerTag::QuicEndpoint => {
            let c: *mut crate::node::quic::QuicEndpoint =
                owner!(crate::node::quic::QuicEndpoint, event_loop_timer);
            IntoTimerResult::into_timer_result(crate::node::quic::QuicEndpoint::on_timer_fire(c))
        }
    };
    fired.map_err(Into::into)
}

/// Lifts a timer entry's return to the dispatcher's `JsResult`: entries that
/// cannot enter JS return `()`.
trait IntoTimerResult {
    fn into_timer_result(self) -> JsResult<()>;
}
impl IntoTimerResult for () {
    #[inline(always)]
    fn into_timer_result(self) -> JsResult<()> {
        Ok(())
    }
}
impl IntoTimerResult for JsResult<()> {
    #[inline(always)]
    fn into_timer_result(self) -> JsResult<()> {
        self
    }
}

/// `__bun_js_timer_epoch` body — the tag→`container_of` read for
/// [`EventLoopTimer::js_timer_epoch`]. Returns `internals.flags.epoch` for
/// the three JS-timer container types, else `None`. Sits on the heap-compare
/// hot path
/// (`EventLoopTimer::less` → `TimerHeap` meld).
///
/// # Safety
/// `t` points at a live [`EventLoopTimer`] currently linked into a `TimerHeap`.
#[unsafe(no_mangle)]
pub(crate) unsafe fn __bun_js_timer_epoch(
    _tag: EventLoopTimerTag,
    t: *const EventLoopTimer,
) -> Option<u32> {
    // SAFETY: per fn contract — `t` is live in a `TimerHeap`. `_tag` kept for
    // the `extern "Rust"` ABI in `bun_event_loop`; helper re-reads `(*t).tag`
    // (same address the caller loaded it from — folds under LTO).
    unsafe { crate::timer::js_timer_flags_ptr(t).map(|p| (*p.as_ptr()).epoch()) }
}

/// `__bun_tick_queue_with_count` body — declared `extern "Rust"` in
/// `bun_jsc::event_loop`. `el` is the queue to drain; for
/// `SpawnSyncEventLoop.tickTasksOnly`
/// this is the isolated loop, **not** `vm.event_loop()`.
///
/// # Safety
/// `el` and `vm` must point at live `EventLoop`/`VirtualMachine` instances
/// with no other `&mut` held across this call.
#[unsafe(no_mangle)]
unsafe fn __bun_tick_queue_with_count(
    el: *mut EventLoop,
    vm: *mut bun_jsc::virtual_machine::VirtualMachine,
    counter: &mut u32,
) -> Result<(), Stopped> {
    // SAFETY: per fn contract.
    let (el, vm_ref) = unsafe { (&mut *el, &mut *vm) };
    tick_queue_with_count(el, vm_ref, counter)
}

// (former duplicate `__bun_run_tasks` removed r6 — `bun_jsc::task::run_tasks`
// had no callers; `__bun_tick_queue_with_count` above is the sole entry point.)
