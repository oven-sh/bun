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
//! **Adding a variant** (do all four):
//!   1. tag constant in `bun_event_loop::task_tag` (or `bun_io::poll_tag`);
//!   2. `impl bun_jsc::Taskable for YourType { const TAG; unsafe fn release_unrun(..) }`;
//!   3. a `run_task` arm and a `release_task_unrun` arm here;
//!   4. bump the `task_tag::COUNT` assertion below.

// Flat re-export landing pad for `generated_js2native.rs` thunks. Kept in a
// sibling file so this hot-path module stays focused on the task/timer/poll
// match loops.
#[path = "dispatch_js2native.rs"]
pub mod js2native;

use bun_event_loop::ManagedTask::ManagedTask;
use bun_event_loop::{Task, task_tag};

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
use bun_jsc::js_secrets::Pending as SecretsPending;

#[cfg(not(windows))]
use bun_io::pipe_writer::PosixPipeWriter; // brings `on_poll` into scope for FileSinkPoll/StaticPipeWriterPoll/etc.

// ════════════════════════════════════════════════════════════════════════════
// Task dispatch
// ════════════════════════════════════════════════════════════════════════════

/// Per-arm result for [`run_task`]: `Continue` means proceed to drain
/// microtasks and the next item; `EarlyReturn` is the HotReloadTask special
/// case — microtasks must NOT drain.
pub(crate) enum RunTaskResult {
    Continue,
    EarlyReturn,
}

/// Dispatch a single `Task` to its variant's `run`-style entry point.
///
/// Every arm hands back what the task's JS left pending as `Err` and never
/// reports it itself: the surrounding drain loop ([`tick_queue_with_count`])
/// folds each task's result in one place, then flushes microtasks.
// PERF(startup/dot): `#[inline(never)]` is deliberate. `#[inline]` here
// bloated `tick_queue_with_count` to ~14 KB of `.text` interleaved with cold
// shell/bake code, blowing the iTLB fault-around window for `bun <file>`.
// Keeping `run_task` out-of-line lets `tick_queue_with_count` stay a tight
// drain-loop wrapper (front-clustered via `src/startup.order`), and the cold
// Shell*/Bake* clusters are further hoisted into [`run_task_cold`] so this
// hot dispatcher stays off their pages.
#[inline(never)]
pub(crate) fn run_task(
    task: Task,
    el: &mut EventLoop,
    vm: &mut VirtualMachine,
    global: &JSGlobalObject,
) -> JsResult<RunTaskResult> {
    /// `*(task.ptr as *mut T)` with the SAFETY invariant spelled once.
    macro_rules! cast {
        ($ty:ty) => {{
            // SAFETY: §Dispatch — `task.tag` was set together with `task.ptr`
            // by `Taskable::into_task`/`Task::new`; tag uniquely identifies
            // the pointee type and the pointer is live for this dispatch.
            unsafe { &mut *task.ptr.cast::<$ty>() }
        }};
    }
    /// Raw `*mut T` (for `heap::take`/self-consuming entry points).
    macro_rules! cast_ptr {
        ($ty:ty) => {
            task.ptr.cast::<$ty>()
        };
    }
    /// `CompressionStream::<T>::run_from_js_thread` takes `*mut T` (full
    /// allocation provenance — R-2) so its trailing `T::deref()` may free the box.
    macro_rules! compression_arm {
        ($T:ty) => {{
            // SAFETY: §Dispatch — tag identifies pointee; live m_ctx payload.
            unsafe {
                node_zlib_binding::CompressionStream::<$T>::run_from_js_thread(cast_ptr!($T))
            };
        }};
    }
    // NB: `TaskTag` is `#[derive(PartialEq, Eq)]` over `u8` → structural-match
    // eligible, so const patterns work directly.
    match task.tag {
        // ── erased-callback tasks (low-tier types — real) ────────────────
        task_tag::AnyTaskJob => {
            // SAFETY: §Dispatch — `task.ptr` is a live heap `Job<C>` posted by
            // its `Completion`; the erased entry runs `then` and frees it.
            unsafe { bun_jsc::job::complete_erased(task.ptr, &global.js_thread()) }?;
        }
        task_tag::SendQueueDeferred => {
            // SAFETY: §Dispatch — the queued pointer is the SendQueue root and
            // the task owns a ref for its duration; `run_deferred` releases it.
            unsafe { crate::ipc::SendQueue::run_deferred(cast_ptr!(crate::ipc::SendQueue)) };
        }
        task_tag::AsyncModule => {
            // SAFETY: `AsyncModule::done` boxed it; the arm consumes the box.
            bun_jsc::async_module::AsyncModule::on_done(unsafe {
                bun_core::heap::take(cast_ptr!(bun_jsc::async_module::AsyncModule))
            })?;
        }
        task_tag::BundleV2PluginResolve => {
            // `bun_bundler` is JSC-free; the C++ hop it calls answers the request
            // itself when the plugin throws, but can return early with an
            // exception pending (argument conversion), so check the scope here.
            bun_jsc::call_check_slow(global, || {
                // SAFETY: tag identifies pointee — a live `Resolve` owned by the
                // plugin dispatch chain.
                unsafe { &mut *cast_ptr!(bun_bundler::bundle_v2::api::JSBundler::Resolve) }
                    .run_on_js_thread()
            })?;
        }
        task_tag::BundleV2PluginLoad => {
            // As `BundleV2PluginResolve`.
            bun_jsc::call_check_slow(global, || {
                // SAFETY: tag identifies pointee — a live `Load` owned by the plugin
                // dispatch chain.
                unsafe { &mut *cast_ptr!(bun_bundler::bundle_v2::api::JSBundler::Load) }
                    .run_on_js_thread()
            })?;
        }
        task_tag::JSBundleCompletionTask => {
            crate::api::js_bundle_completion_task::JSBundleCompletionTask::on_complete_anytask(
                cast_ptr!(crate::api::js_bundle_completion_task::JSBundleCompletionTask),
            )?;
        }
        task_tag::FetchTaskletPromiseSettle => {
            // SAFETY: boxed at the fetch completion site; the arm consumes it.
            let holder = unsafe {
                bun_core::heap::take(cast_ptr!(
                    crate::webcore::fetch::fetch_tasklet::FetchTaskletPromiseSettle
                ))
            };
            holder.run()?;
        }
        task_tag::DuplexUpgradeContext => {
            // SAFETY: tag identifies pointee; the queue owns the live context
            // until `run_event` (which may free it).
            crate::socket::DuplexUpgradeContext::run_event(unsafe {
                bun_ptr::ThisPtr::new(cast_ptr!(crate::socket::DuplexUpgradeContext))
            });
        }
        #[cfg(windows)]
        task_tag::WindowsNamedPipeContext => {
            // Same shape as `DuplexUpgradeContext`: may free the context.
            // SAFETY: tag identifies the pointee; the queue owns it until here.
            unsafe {
                crate::socket::WindowsNamedPipeContext::run_event(cast_ptr!(
                    crate::socket::WindowsNamedPipeContext
                ))
            };
        }
        #[cfg(windows)]
        task_tag::GetAddrInfoLibuvComplete => {
            // SAFETY: boxed in `on_raw_libuv_complete`; the arm consumes it.
            unsafe { bun_core::heap::take(cast_ptr!(crate::dns_jsc::LibuvCompleteHolder)) }.run();
        }
        task_tag::ValkeyDeferredClose => {
            // SAFETY: boxed at the enqueue site; the arm consumes it.
            unsafe {
                bun_core::heap::take(cast_ptr!(crate::valkey_jsc::js_valkey::ValkeyDeferredClose))
            }
            .run();
        }
        task_tag::StatWatcherTimerUpdate => {
            // SAFETY: boxed in `schedule_timer_update`; the arm consumes it.
            unsafe {
                bun_core::heap::take(cast_ptr!(
                    crate::node::node_fs_stat_watcher::StatWatcherTimerUpdate
                ))
            }
            .run();
        }
        task_tag::AsyncCpTask => {
            // SAFETY: posted by `on_subtask_done` with the count at zero (exclusive).
            unsafe { (*task.ptr.cast::<crate::node::fs::AsyncCpTask>()).run_from_js_thread()? };
        }
        task_tag::ShellAsyncCpTask => {
            // SAFETY: as above.
            unsafe {
                (*task.ptr.cast::<crate::node::fs::ShellAsyncCpTask>()).run_from_js_thread()?
            };
        }
        task_tag::StatWatcherHop => {
            // SAFETY: posted by `StatWatcher::post_to_js_thread` with a ref held.
            unsafe {
                crate::node::node_fs_stat_watcher::StatWatcher::run_hop(cast_ptr!(
                    crate::node::node_fs_stat_watcher::StatWatcher
                ))
            }?;
        }
        task_tag::ManagedTask => {
            // SAFETY: `task.ptr` was produced by `heap::alloc` in `ManagedTask::new`
            // and enqueued under `task_tag::ManagedTask`; `run` consumes/frees it.
            unsafe { ManagedTask::run(cast_ptr!(ManagedTask)) }?;
        }
        task_tag::CppTask => {
            cast!(CppTask).run(global)?;
        }

        // ── shell interpreter (cold — hoisted to `run_task_cold`) ────────
        task_tag::ShellAsync
        | task_tag::ShellCondExprStatTask
        | task_tag::ShellCpTask
        | task_tag::ShellTouchTask
        | task_tag::ShellMkdirTask
        | task_tag::ShellLsTask
        | task_tag::ShellMvBatchedTask
        | task_tag::ShellMvCheckTargetTask
        | task_tag::ShellRmTask
        | task_tag::ShellRmDirTask
        | task_tag::ShellGlobTask
        | task_tag::ShellYesTask => run_task_cold(task),

        // ── fetch / S3 ───────────────────────────────────────────────────
        task_tag::FetchTasklet => {
            cast!(FetchTasklet).on_progress_update()?;
        }
        task_tag::FetchTaskletDeinit => {
            // SAFETY: posted by `deref_from_thread` with the last ref.
            unsafe {
                crate::webcore::fetch::FetchTaskletDeinitHop::run(cast_ptr!(
                    crate::webcore::fetch::FetchTaskletDeinitHop
                ))
            };
        }
        // `cast_ptr!` yields the heap-allocated S3 task; JS-thread dispatch
        // is the sole owner here.
        task_tag::S3HttpSimpleTask => {
            S3HttpSimpleTask::on_response(cast_ptr!(S3HttpSimpleTask))?;
        }
        task_tag::S3HttpDownloadStreamingTask => {
            S3HttpDownloadStreamingTask::on_response(cast_ptr!(S3HttpDownloadStreamingTask));
        }

        // ── napi ─────────────────────────────────────────────────────────
        task_tag::NapiAsyncWork => {
            cast!(napi_async_work).run_from_js(global)?;
        }
        task_tag::ThreadSafeFunction => {
            ThreadSafeFunction::on_dispatch(cast_ptr!(ThreadSafeFunction));
        }
        task_tag::NapiFinalizerTask => {
            NapiFinalizerTask::run_on_js_thread(cast_ptr!(NapiFinalizerTask))?;
        }

        // ── JSC scheduler / module loader ────────────────────────────────
        task_tag::JSCDeferredWorkTask => {
            bun_jsc::mark_binding();
            cast!(JSCDeferredWorkTask).run(global)?;
        }
        task_tag::PollPendingModulesTask => {
            vm.modules.on_poll();
        }
        task_tag::RuntimeTranspilerStore => {
            let store = cast!(RuntimeTranspilerStore);
            store.run_from_js_thread(el.into(), global, vm.into());
        }

        // ── hot-reload (early-returns from the drain loop) ───────────────
        task_tag::HotReloadTask => {
            let t = cast_ptr!(hot_reloader::HotReloadTask);
            // The task was heap-allocated in `Task::enqueue`; `deinit` frees it.
            // SAFETY: tag identifies pointee; live Box'd HotReloadTask.
            unsafe { (*t).run() };
            // SAFETY: paired with heap::alloc in `Task::enqueue`.
            unsafe { hot_reloader::HotReloadTask::deinit(t) };
            return Ok(RunTaskResult::EarlyReturn);
        }
        task_tag::WatchReloadTask => {
            let t = cast_ptr!(hot_reloader::WatchReloadTask);
            // SAFETY: tag identifies pointee; live Box'd WatchReloadTask.
            unsafe { (*t).run() };
            // SAFETY: paired with heap::alloc in `Task::enqueue`.
            unsafe { hot_reloader::WatchReloadTask::deinit(t) };
            return Ok(RunTaskResult::EarlyReturn);
        }
        // ── bake dev-server (cold — hoisted to `run_task_cold`) ──────────
        task_tag::BakeHotReloadEvent => run_task_cold(task),
        task_tag::FSWatchTask => {
            // The task is heap-allocated
            // (cloned from `FSWatcher.current_task` at enqueue). `deinit` is
            // explicit (not `Drop`) so the embedded `current_task` field never
            // runs it.
            let t = cast_ptr!(FSWatchTask);
            // SAFETY: tag identifies pointee; live Box'd FSWatchTask.
            let ran = unsafe { (*t).run() };
            // SAFETY: paired with heap::alloc in `FSWatchTask::enqueue`.
            unsafe { FSWatchTask::deinit(t) };
            ran?;
        }

        // ── node:fs libuv-request ops (Windows) ──────────────────────────
        #[cfg(windows)]
        for_each_fs_uv_op!(__fs_pat) => {
            macro_rules! __fs_run {
                ($($tag:ident $ty:ident;)*) => { match task.tag {
                    $(task_tag::$tag => cast!(fs_async::$ty).run_from_js_thread()?,)*
                    // SAFETY: outer arm guard proves one of the table tags matched.
                    _ => unsafe { core::hint::unreachable_unchecked() },
                }};
            }
            for_each_fs_uv_op!(__fs_run);
        }

        // ── compression streams ──────────────────────────────────────────
        task_tag::NativeZlib => compression_arm!(NativeZlib),
        task_tag::NativeBrotli => compression_arm!(NativeBrotli),
        task_tag::NativeZstd => compression_arm!(NativeZstd),

        // ── process / signals ────────────────────────────────────────────
        task_tag::ProcessWaiterThreadTask => {
            #[cfg(not(windows))]
            {
                // SAFETY: tag identifies pointee; heap-allocated in WaiterThread.
                let t =
                    unsafe { bun_core::heap::take(cast_ptr!(ProcessWaiterThreadTask<Process>)) };
                t.run_from_js_thread();
            }
            #[cfg(windows)]
            unreachable!("posix-only");
        }
        task_tag::PosixSignalTask => {
            // `ptr` here is *not* a pointer but a packed signal number.
            let _ = core::marker::PhantomData::<PosixSignalTask>;
            bun_jsc::posix_signal_handle::PosixSignalTask::run_from_js_thread(
                task.ptr as usize as u8,
                global,
            );
        }
        task_tag::MemoryPressureTask => {
            // `ptr` is the packed level (NOTE_MEMORYSTATUS_PRESSURE_* bits), not a pointer.
            crate::node::memory_pressure::emit(global, task.ptr as usize as i32);
        }
        task_tag::NativePromiseContextDeferredDerefTask => {
            // `ptr` packs an int, not a pointer.
            NativePromiseContextDeferredDerefTask::run_from_js_thread(task.ptr as usize);
        }

        // ── server / bundler / streams ───────────────────────────────────
        task_tag::ServerAllConnectionsClosedTask => {
            ServerAllConnectionsClosedTask::run_from_js_thread(cast_ptr!(
                ServerAllConnectionsClosedTask
            ))?;
        }
        task_tag::BundleV2DeferredBatchTask => {
            // `bun_bundler` is JSC-free so the exception-scope check is hoisted
            // to this dispatch arm; without it, `JSBundlerPlugin__drainDeferred`'s
            // THROW_SCOPE is left unchecked and trips JSC exception validation
            // at the next `drainMicrotasks` scope.
            bun_jsc::call_check_slow(global, || {
                cast!(BundleV2DeferredBatchTask).run_on_js_thread();
            })?;
        }
        // SAFETY: `cast_ptr!` yields the heap-allocated task; sole owner.
        task_tag::FlushPendingFileSinkTask => unsafe {
            FlushPendingFileSinkTask::run_from_js_thread(cast_ptr!(FlushPendingFileSinkTask));
        },
        // `cast_ptr!` yields the heap-allocated task; sole owner.
        task_tag::StreamPending => {
            StreamPending::run_from_js_thread(cast_ptr!(StreamPending));
        }

        _ => {
            // A value outside `task_tag::COUNT` is a producer bug, but it's
            // treated as a recoverable crash, not UB.
            panic!("Unexpected Task tag: {}", task.tag.0);
        }
    }
    Ok(RunTaskResult::Continue)
}

/// Cold-path arms hoisted out of [`run_task`].
///
/// Shell* / Bake* (and, when they land, Install*) tags are never seen during
/// `bun <file>` startup or the `dot` benchmark, but their per-arm bodies pull
/// in `bun_shell` / `bun_bake` call sites that LLVM otherwise interleaves with
/// the hot arms. The `#[cold]` boundary lets lld place this whole cluster after the
/// front-clustered startup window (see `src/startup.order`).
///
/// Returns `()` — none of the cold arms can fail or early-return; the caller
/// falls through to `Ok(RunTaskResult::Continue)`.
#[cold]
#[inline(never)]
fn run_task_cold(task: Task) {
    /// Raw `*mut T` (for `heap::take`/self-consuming entry points).
    macro_rules! cast_ptr {
        ($ty:ty) => {
            task.ptr.cast::<$ty>()
        };
    }
    /// Shell builtin tasks: route through `ShellTask::run_from_main_thread`
    /// so the keep-alive ref taken in `ShellTask::schedule` is unref'd before
    /// the per-builtin body runs.
    /// The wrapper recovers `&mut Interpreter` from the embedded
    /// `ShellTask.interp` back-ref.
    macro_rules! shell_dispatch {
        ($ty:ty) => {{
            // SAFETY: §Dispatch — `t` is a live heap-allocated shell task;
            // `interp` was set at schedule time and outlives the task.
            unsafe { ShellTask::run_from_main_thread::<$ty>(cast_ptr!($ty)) };
        }};
        // Cond-expr wraps an inner `task: ShellTask`-embedding struct one
        // level deeper. The type *does* implement `ShellTaskCtx`
        // (with a two-hop `TASK_OFFSET`, needed for `ShellTask::schedule`),
        // so this arm is behaviorally identical to the plain arm; the unref +
        // interp-recovery are inlined here only to keep the `.task.task`
        // shape explicit at the dispatch site.
        (nested $ty:ty) => {{
            let t = cast_ptr!($ty);
            // SAFETY: see above; `task.task` is the embedded ShellTask.
            unsafe {
                let st = &raw mut (*t).task.task;
                (*st).keep_alive.unref((*st).event_loop.as_event_loop_ctx());
                let interp = &*(*st).interp;
                <$ty>::run_from_main_thread(t, interp);
            }
        }};
    }

    match task.tag {
        // ── shell interpreter ────────────────────────────────────────────
        task_tag::ShellAsync => {
            // SAFETY: §Dispatch — tag identifies pointee.
            let t = unsafe { &mut *cast_ptr!(crate::shell::dispatch_tasks::ShellAsyncTask) };
            // SAFETY: `interp` set at enqueue; outlives task.
            let interp = unsafe { &*t.interp };
            ShellAsync::run_from_main_thread(interp, t.node);
        }
        task_tag::ShellCondExprStatTask => {
            shell_dispatch!(nested ShellCondExprStatTask);
        }
        task_tag::ShellCpTask => shell_dispatch!(ShellCpTask),
        task_tag::ShellTouchTask => shell_dispatch!(ShellTouchTask),
        task_tag::ShellMkdirTask => shell_dispatch!(ShellMkdirTask),
        task_tag::ShellLsTask => shell_dispatch!(ShellLsTask),
        task_tag::ShellMvBatchedTask => shell_dispatch!(ShellMvBatchedTask),
        task_tag::ShellMvCheckTargetTask => shell_dispatch!(ShellMvCheckTargetTask),
        task_tag::ShellRmTask => shell_dispatch!(ShellRmTask),
        task_tag::ShellRmDirTask => {
            let t = cast_ptr!(ShellRmDirTask);
            ShellRmDirTask::run_from_main_thread(t);
        }
        task_tag::ShellGlobTask => shell_dispatch!(ShellGlobTask),
        task_tag::ShellYesTask => {
            // SAFETY: §Dispatch — tag identifies pointee; enqueued by
            // `YesTask::enqueue`, storage lives inside `Box<Yes>` in the
            // interpreter arena and is stable until the builtin deinits.
            ShellYesTask::run_from_main_thread(unsafe { &*cast_ptr!(ShellYesTask) });
        }

        // ── bake dev-server ──────────────────────────────────────────────
        task_tag::BakeHotReloadEvent => {
            // SAFETY: §Dispatch — tag identifies pointee; the event lives in a
            // heap `WatcherAtomics` that can outlive its `DevServer`. `run`
            // either re-derives `&mut DevServer` from the BACKREF or (when the
            // owner has been dropped) only reclaims the heap `WatcherAtomics`,
            // so pass the raw pointer to avoid materialising an aliasing
            // `&mut` here.
            unsafe { BakeHotReloadEvent::run(cast_ptr!(BakeHotReloadEvent)) };
        }

        // Any tag the hot path mis-routed: producer bug.
        _ => panic!("Unexpected Task tag: {}", task.tag.0),
    }
}

/// Compile-time guard that the arm counts in `run_task` and
/// `release_task_unrun` track `bun_event_loop::task_tag::COUNT`. Bump when
/// adding a variant — and give it an arm in both.
const _: () = assert!(
    task_tag::COUNT == 61,
    "dispatch::run_task / release_task_unrun arm count out of sync with bun_event_loop::task_tag",
);

// ────────────────────────────────────────────────────────────────────────────
// `tick_queue_with_count` — the full drain loop.
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
        match run_task(task, el, vm, global) {
            Ok(RunTaskResult::Continue) => {}
            Ok(RunTaskResult::EarlyReturn) => {
                // Caller is `while tickWithCount(ctx) > 0` — must keep
                // draining after a hot-reload task, so report exactly one
                // task processed. Do NOT set 0 here.
                *counter = 1;
                return Ok(());
            }
            // The one fold for every queued task: report what it left as
            // uncaught, or stand the loop down if it is the VM's termination.
            Err(err) => report_error_or_terminate(global, err)?,
        }
        el.drain_microtasks_with_global(global, global_vm)?;
    }
    el.tasks.reset_head_if_empty();
    Ok(())
}

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
/// entry cannot enter JS return `()` (`timer_arm!` makes that `Ok(())`).
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
    // An owner that cannot enter JS: its `()` return is `Ok(())` here.
    macro_rules! timer_arm {
        ($Ty:ty, $field:ident, |$c:ident, $now:ident, $vm:ident| $body:expr) => {{
            let $c: *mut $Ty = owner!($Ty, $field);
            let ($now, $vm) = (now, vm);
            // SAFETY: per fn contract; container derived from a live `$Ty`.
            let () = unsafe { $body };
            Ok(())
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
                unsafe { (*container).on_timeout() };
                Ok(())
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
            unsafe { (*container).on_connection_timeout() };
            Ok(())
        }
        EventLoopTimerTag::PostgresSQLConnectionMaxLifetime => {
            // SAFETY: §Dispatch — `t` is the connection's `max_lifetime_timer`.
            let container = unsafe { PostgresSQLConnection::from_max_lifetime_timer_ptr(t) };
            // SAFETY: per fn contract.
            unsafe { (*container).on_max_lifetime_timeout() };
            Ok(())
        }
        EventLoopTimerTag::MySQLConnectionTimeout => {
            // SAFETY: §Dispatch — `t` is the connection's `timer` field.
            let container = unsafe { MySQLConnection::from_timer_ptr(t) };
            // SAFETY: per fn contract.
            unsafe { (*container).on_connection_timeout() };
            Ok(())
        }
        EventLoopTimerTag::MySQLConnectionMaxLifetime => {
            // SAFETY: §Dispatch — `t` is the connection's `max_lifetime_timer`.
            let container = unsafe { MySQLConnection::from_max_lifetime_timer_ptr(t) };
            // SAFETY: per fn contract.
            unsafe { (*container).on_max_lifetime_timeout() };
            Ok(())
        }
        EventLoopTimerTag::ValkeyConnectionTimeout => {
            let container = owner!(Valkey, timer);
            // SAFETY: per fn contract.
            unsafe { (*container).on_connection_timeout() }
        }
        EventLoopTimerTag::ValkeyConnectionReconnect => {
            let container = owner!(Valkey, reconnect_timer);
            // SAFETY: per fn contract.
            unsafe { (*container).on_reconnect_timer() }
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
            // SAFETY: a scheduled job's JS wrapper keeps it alive; `t` was just popped.
            CronJob::on_timer_fire(unsafe { bun_ptr::ThisPtr::new(c) }, VirtualMachine::get());
            Ok(())
        }
        EventLoopTimerTag::QuicEndpoint => {
            let c: *mut crate::node::quic::QuicEndpoint =
                owner!(crate::node::quic::QuicEndpoint, event_loop_timer);
            crate::node::quic::QuicEndpoint::on_timer_fire(c);
            Ok(())
        }
        EventLoopTimerTag::SecretsTimeout => {
            // SAFETY: §Dispatch — `t` is the `event_loop_timer` of a live
            // `SecretsPending` (its job unlinks the node before freeing it).
            let c = unsafe { SecretsPending::from_timer_ptr(t) };
            // SAFETY: per fn contract.
            unsafe { SecretsPending::on_timeout(c, vm) }
        }
    };
    fired
}

/// The fold for a foreign dispatcher's landing frame — a uSockets / uWS /
/// lsquic / pipe-reader callback that returns `void`, so what its JS left
/// pending has nowhere to go but here: reported as uncaught (or, for the VM's
/// termination, left for the loop to stand down on), on the JS thread this
/// dispatch runs on, rather than left pending for whatever enters JS next.
#[inline]
pub(crate) fn fold(result: JsResult<()>) {
    #[cold]
    #[inline(never)]
    fn report(err: bun_jsc::JsError) {
        let global = VirtualMachine::get().global();
        let _ = report_error_or_terminate(global, err);
    }
    if let Err(err) = result {
        report(err);
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

/// `__bun_release_task_unrun` — declared `extern "Rust"` in
/// `bun_jsc::event_loop`. A queued task that will never be dispatched (its VM
/// is tearing down: script is forbidden and the loop no longer ticks) is freed
/// through its type's [`Taskable::release_unrun`](bun_event_loop::Taskable).
/// One arm per tag, no fallthrough: a tag cannot exist without its type
/// having decided how it is released. JS thread, JSC heap alive.
#[unsafe(no_mangle)]
fn __bun_release_task_unrun(task: bun_event_loop::Task) {
    use bun_event_loop::{Taskable, task_tag};
    /// `<T as Taskable>::release_unrun(task.ptr as *mut T)`, SAFETY spelled once.
    macro_rules! release {
        ($ty:ty) => {{
            // SAFETY: §Dispatch — `task.tag` was set together with `task.ptr`
            // through `Taskable`; the tag identifies the pointee type, and the
            // task just came off the queue and is not used afterwards.
            unsafe { <$ty as Taskable>::release_unrun(task.ptr.cast::<$ty>()) }
        }};
    }
    match task.tag {
        task_tag::AnyTaskJob => {
            // The one erased tag: every payload is a `Job<C>` reached through its header.
            // SAFETY: as `release!`.
            unsafe { bun_jsc::job::release_unrun_erased(task.ptr) }
        }
        task_tag::AsyncModule => release!(bun_jsc::async_module::AsyncModule),
        task_tag::BakeHotReloadEvent => release!(BakeHotReloadEvent),
        task_tag::BundleV2DeferredBatchTask => release!(BundleV2DeferredBatchTask),
        task_tag::BundleV2PluginResolve => {
            release!(bun_bundler::bundle_v2::api::JSBundler::Resolve)
        }
        task_tag::BundleV2PluginLoad => release!(bun_bundler::bundle_v2::api::JSBundler::Load),
        task_tag::ShellYesTask => release!(ShellYesTask),
        task_tag::CppTask => release!(CppTask),
        task_tag::DuplexUpgradeContext => release!(crate::socket::DuplexUpgradeContext),
        task_tag::FetchTasklet => release!(FetchTasklet),
        task_tag::FetchTaskletDeinit => release!(crate::webcore::fetch::FetchTaskletDeinitHop),
        task_tag::FetchTaskletPromiseSettle => {
            release!(crate::webcore::fetch::fetch_tasklet::FetchTaskletPromiseSettle)
        }
        task_tag::FSWatchTask => release!(FSWatchTask),
        task_tag::HotReloadTask => release!(hot_reloader::HotReloadTask),
        task_tag::WatchReloadTask => release!(hot_reloader::WatchReloadTask),
        task_tag::JSBundleCompletionTask => {
            release!(crate::api::js_bundle_completion_task::JSBundleCompletionTask)
        }
        task_tag::JSCDeferredWorkTask => release!(JSCDeferredWorkTask),
        task_tag::ManagedTask => release!(ManagedTask),
        task_tag::NapiAsyncWork => release!(napi_async_work),
        task_tag::NapiFinalizerTask => release!(NapiFinalizerTask),
        task_tag::NativePromiseContextDeferredDerefTask => {
            release!(NativePromiseContextDeferredDerefTask)
        }
        task_tag::NativeBrotli => release!(NativeBrotli),
        task_tag::NativeZlib => release!(NativeZlib),
        task_tag::NativeZstd => release!(NativeZstd),
        task_tag::PollPendingModulesTask => release!(bun_jsc::async_module::Queue),
        task_tag::PosixSignalTask => release!(PosixSignalTask),
        task_tag::MemoryPressureTask => release!(crate::node::memory_pressure::MemoryPressureTask),
        task_tag::ProcessWaiterThreadTask => {
            #[cfg(not(windows))]
            release!(ProcessWaiterThreadTask<Process>);
            #[cfg(windows)]
            unreachable!("posix-only tag");
        }
        task_tag::FlushPendingFileSinkTask => release!(FlushPendingFileSinkTask),
        task_tag::RuntimeTranspilerStore => release!(RuntimeTranspilerStore),
        task_tag::S3HttpDownloadStreamingTask => release!(S3HttpDownloadStreamingTask),
        task_tag::S3HttpSimpleTask => release!(S3HttpSimpleTask),
        task_tag::SendQueueDeferred => release!(crate::ipc::SendQueue),
        task_tag::ServerAllConnectionsClosedTask => release!(ServerAllConnectionsClosedTask),
        task_tag::ShellAsync => release!(crate::shell::dispatch_tasks::ShellAsyncTask),
        task_tag::ShellCondExprStatTask => release!(ShellCondExprStatTask),
        task_tag::ShellCpTask => release!(ShellCpTask),
        task_tag::ShellGlobTask => release!(ShellGlobTask),
        task_tag::ShellLsTask => release!(ShellLsTask),
        task_tag::ShellMkdirTask => release!(ShellMkdirTask),
        task_tag::ShellMvBatchedTask => release!(ShellMvBatchedTask),
        task_tag::ShellMvCheckTargetTask => release!(ShellMvCheckTargetTask),
        task_tag::ShellRmDirTask => release!(ShellRmDirTask),
        task_tag::ShellRmTask => release!(ShellRmTask),
        task_tag::ShellTouchTask => release!(ShellTouchTask),
        task_tag::StatWatcherTimerUpdate => {
            release!(crate::node::node_fs_stat_watcher::StatWatcherTimerUpdate)
        }
        task_tag::StatWatcherHop => release!(crate::node::node_fs_stat_watcher::StatWatcher),
        task_tag::AsyncCpTask => release!(crate::node::fs::AsyncCpTask),
        task_tag::ShellAsyncCpTask => release!(crate::node::fs::ShellAsyncCpTask),
        task_tag::StreamPending => release!(StreamPending),
        task_tag::ThreadSafeFunction => release!(ThreadSafeFunction),
        task_tag::ValkeyDeferredClose => {
            release!(crate::valkey_jsc::js_valkey::ValkeyDeferredClose)
        }
        // ── Windows-only producers ───────────────────────────────────────
        task_tag::GetAddrInfoLibuvComplete => {
            #[cfg(windows)]
            release!(crate::dns_jsc::LibuvCompleteHolder);
            #[cfg(not(windows))]
            unreachable!("windows-only tag");
        }
        task_tag::WindowsNamedPipeContext => {
            #[cfg(windows)]
            release!(crate::socket::WindowsNamedPipeContext);
            #[cfg(not(windows))]
            unreachable!("windows-only tag");
        }
        task_tag::Open
        | task_tag::Close
        | task_tag::Read
        | task_tag::Readv
        | task_tag::Write
        | task_tag::Writev
        | task_tag::StatFS => {
            #[cfg(windows)]
            {
                macro_rules! __fs_release {
                    ($($tag:ident $ty:ident;)*) => { match task.tag {
                        $(task_tag::$tag => release!(fs_async::$ty),)*
                        // SAFETY: the outer arm proves one of the table tags matched.
                        _ => unsafe { core::hint::unreachable_unchecked() },
                    }};
                }
                for_each_fs_uv_op!(__fs_release);
            }
            #[cfg(not(windows))]
            unreachable!("windows-only tag (libuv fs request)");
        }
        // Every tag has an arm above (`task_tag::COUNT` is asserted); a value
        // outside the range is a producer bug.
        _ => unreachable!("task tag out of range: {}", task.tag.0),
    }
}
