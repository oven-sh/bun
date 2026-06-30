//! `crate::dispatch` — the §Dispatch hot-path payoff.
//!
//! Per `docs/PORTING.md` §Dispatch, low-tier crates store
//! `Task = { tag: TaskTag, ptr: *mut () }` and never name a variant type. This
//! crate (highest tier) owns **every** variant type, so the actual `match`
//! loop lives here, and LLVM inlines the per-arm direct calls.
//!
//! Dispatchers defined here:
//!   1. [`run_task`] — `bun_event_loop::Task` (~96 variants).
//!
//! Low-tier crates declare these as `extern "Rust"`; this crate defines them
//! `#[no_mangle]` so the linker resolves the call directly — no runtime
//! registration, no `AtomicPtr`, no init-order hazard.
//!
//! **Adding a variant** (do both): a `bun_event_loop::TaskTag` enum variant
//! and a match arm here; the compiler enforces the pair — [`run_task`]'s
//! `match` is exhaustive over the enum.

use bun_event_loop::AnyTask::AnyTask;
use bun_event_loop::ManagedTask::ManagedTask;
use bun_event_loop::{Task, TaskTag};

use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, Tag as EventLoopTimerTag, TimerCallback, Timespec as ElTimespec,
};

use bun_jsc::JSGlobalObject;
use bun_jsc::event_loop::{EventLoop, JsTerminated};
use bun_jsc::task::report_error_or_terminate;
use bun_jsc::virtual_machine::VirtualMachine;

/// X-macro: the 42 `node:fs` async ops dispatched via `run_from_js_thread`.
///
/// Row shape: `$tag $ty;` — `$tag` is the `bun_event_loop::TaskTag::*` const,
/// `$ty` is the `fs_async::*` alias. They differ in exactly three rows
/// (`FTruncate`/`Ftruncate`, `FChown`/`Fchown`, `StatFS`/`Statfs`), so the
/// macro carries both idents. `ReaddirRecursive` is the bespoke
/// `AsyncReaddirRecursiveTask` (not an `AsyncFSTask<_,_,F>`); `Cp` and
/// `AsyncMkdirp` are intentionally absent — they have bespoke dispatch paths.
macro_rules! for_each_fs_async_op {
    ($m:ident) => {
        $m! {
            Stat Stat; Lstat Lstat; Fstat Fstat; Open Open; ReadFile ReadFile;
            WriteFile WriteFile; CopyFile CopyFile; Read Read; Write Write;
            Truncate Truncate; Writev Writev; Readv Readv; Rename Rename;
            FTruncate Ftruncate; Readdir Readdir; ReaddirRecursive ReaddirRecursive;
            Close Close; Rm Rm; Rmdir Rmdir; Chown Chown; FChown Fchown;
            Utimes Utimes; Lutimes Lutimes; Chmod Chmod; Fchmod Fchmod; Link Link;
            Symlink Symlink; Readlink Readlink; Realpath Realpath;
            RealpathNonNative RealpathNonNative; Mkdir Mkdir; Fsync Fsync;
            Fdatasync Fdatasync; Access Access; AppendFile AppendFile;
            Mkdtemp Mkdtemp; Exists Exists; Futimes Futimes; Lchmod Lchmod;
            Lchown Lchown; Unlink Unlink; StatFS Statfs;
        }
    };
}
/// Expand the fs-op table to an or-pattern over `TaskTag::*` (pattern position).
macro_rules! __fs_pat {
    ($($tag:ident $ty:ident;)*) => { $(TaskTag::$tag)|* };
}

// ── per-variant payload types ────────────────────────────────────────────────
// (high-tier owns them all; grouped by source module)

use crate::api::archive::{
    AsyncTask as ArchiveAsyncTask, BlobTask as ArchiveBlobTask, ExtractTask as ArchiveExtractTask,
    FilesTask as ArchiveFilesTask, WriteTask as ArchiveWriteTask,
};

use crate::shell::builtins::{
    cp::ShellCpTask,
    ls::ShellLsTask,
    mkdir::ShellMkdirTask,
    mv::{ShellMvBatchedTask, ShellMvCheckTargetTask},
    rm::ShellRmTask,
    touch::ShellTouchTask,
};
use crate::shell::dispatch_tasks::{
    AsyncDeinitReader as ShellIOReaderAsyncDeinit, AsyncDeinitWriter as ShellIOWriterAsyncDeinit,
    ShellAsyncSubprocessDone, ShellCondExprStatTask, ShellGlobTask, ShellRmDirTask,
};
use crate::shell::interpreter::ShellTask;
use crate::shell::states::r#async::Async as ShellAsync;

use crate::webcore::blob::copy_file::CopyFilePromiseTask;
use crate::webcore::blob::read_file::ReadFileTask;
use crate::webcore::blob::write_file::WriteFileTask;
use crate::webcore::fetch::fetch_tasklet::FetchTasklet;
use crate::webcore::file_sink::FlushPendingTask as FlushPendingFileSinkTask;
use crate::webcore::s3::download_stream::S3HttpDownloadStreamingTask;
use crate::webcore::s3::simple_request::S3HttpSimpleTask;
use crate::webcore::streams::Pending as StreamPending;

use crate::api::JSTranspiler::AsyncTransformTask;
use crate::api::bun_subprocess::Subprocess;
use crate::api::cron::CronJob;
use crate::api::glob::AsyncGlobWalkTask;
use crate::api::native_promise_context::DeferredDerefTask as NativePromiseContextDeferredDerefTask;
use crate::image::AsyncImageTask;

use crate::napi::{NapiFinalizerTask, ThreadSafeFunction, napi_async_work};

use bun_jsc::PosixSignalTask;
use bun_jsc::RuntimeTranspilerStore;
use bun_jsc::cpp_task::CppTask;
use bun_jsc::hot_reloader;
use bun_jsc::jsc_scheduler::JSCDeferredWorkTask;

use crate::bake::dev_server::DevServer;
use crate::bake::dev_server::HotReloadEvent as BakeHotReloadEvent;
use crate::bake::dev_server::source_map_store::SourceMapStore;

use crate::node::fs::async_ as fs_async;
use crate::node::node_fs_stat_watcher::StatWatcherScheduler;
use crate::node::node_fs_watcher::FSWatchTask;
use crate::node::node_zlib_binding;
use crate::node::zlib::{
    native_brotli::NativeBrotli, native_zlib::NativeZlib, native_zstd::NativeZstd,
};

use crate::dns_jsc::Resolver as DNSResolver;
#[cfg(not(windows))]
use crate::dns_jsc::get_addr_info_request;
use crate::server::ServerAllConnectionsClosedTask;

#[cfg(not(windows))]
use ::bun_spawn::process::Process;
#[cfg(unix)]
use ::bun_spawn::process::waiter_thread_posix::ResultTask as ProcessWaiterThreadTask;

use bun_bundler::DeferredBatchTask::DeferredBatchTask as BundleV2DeferredBatchTask;

use crate::socket::upgraded_duplex::UpgradedDuplex;
#[cfg(windows)]
use crate::socket::windows_named_pipe::WindowsNamedPipe;

use crate::sql_jsc::mysql::js_mysql_connection::JSMySQLConnection as MySQLConnection;
use crate::sql_jsc::postgres::PostgresSQLConnection;
use crate::valkey_jsc::js_valkey::JSValkeyClient as Valkey;

use crate::test_runner::bun_test::{BunTest, BunTestPtr};
use bun_jsc::abort_signal::Timeout as AbortSignalTimeout;
use bun_jsc::timer::{DateHeaderTimer, EventLoopDelayMonitor};

// ════════════════════════════════════════════════════════════════════════════
// Task dispatch
// ════════════════════════════════════════════════════════════════════════════

/// Per-arm result for [`run_task`]: `Continue` means proceed to drain
/// microtasks and the next item; `EarlyReturn` is the HotReloadTask special
/// case — microtasks must NOT drain.
pub enum RunTaskResult {
    Continue,
    EarlyReturn,
}

/// Dispatch a single `Task` to its variant's `run`-style entry point.
///
/// The surrounding drain loop + microtask flush
/// lives in [`tick_queue_with_count`] below.
// PERF(startup/dot): `#[inline(never)]` is deliberate. `#[inline]` here
// bloated `tick_queue_with_count` to ~14 KB of `.text` interleaved with cold
// shell/bake code, blowing the iTLB fault-around window for `bun <file>`.
// Keeping `run_task` out-of-line lets `tick_queue_with_count` stay a tight
// drain-loop wrapper (front-clustered via `src/startup.order`), and the cold
// Shell*/Bake* clusters are further hoisted into [`run_task_cold`] so this
// function's hot residue (AnyTask/ManagedTask/CppTask + fs/napi) fits in 1-2
// pages.
#[inline(never)]
pub fn run_task(
    task: Task,
    el: &mut EventLoop,
    vm: &mut VirtualMachine,
    global: &JSGlobalObject,
) -> Result<RunTaskResult, JsTerminated> {
    /// `*(task.ptr as *mut T)` with the SAFETY invariant spelled once, plus a
    /// compile-time check that `$ty`'s `Taskable::TAG` matches the arm's tag.
    /// `@unchecked` skips the assert for types whose `Taskable` impl lives in
    /// a crate this one cannot impl for (orphan rule) or that have none.
    macro_rules! cast {
        ($tag:ident, $ty:ty) => {{
            const _: () =
                assert!(<$ty as bun_event_loop::Taskable>::TAG as u8 == TaskTag::$tag as u8);
            // SAFETY: §Dispatch — `task.tag` was set together with `task.ptr`
            // by `Taskable::into_task`/`Task::new`; the const assert above ties
            // the pointee type to the tag and the pointer is live for this dispatch.
            unsafe { &mut *task.ptr.cast::<$ty>() }
        }};
        (@unchecked $ty:ty) => {{
            // SAFETY: §Dispatch — `task.tag` was set together with `task.ptr`
            // by `Taskable::into_task`/`Task::new`; tag uniquely identifies
            // the pointee type and the pointer is live for this dispatch.
            unsafe { &mut *task.ptr.cast::<$ty>() }
        }};
    }
    /// Raw `*mut T` (for `heap::take`/self-consuming entry points).
    macro_rules! cast_ptr {
        ($tag:ident, $ty:ty) => {{
            const _: () =
                assert!(<$ty as bun_event_loop::Taskable>::TAG as u8 == TaskTag::$tag as u8);
            task.ptr.cast::<$ty>()
        }};
        (@unchecked $ty:ty) => {
            task.ptr.cast::<$ty>()
        };
    }
    /// `CompressionStream::<T>::run_from_js_thread` takes `*mut T` (full
    /// allocation provenance — R-2) so its trailing `T::deref()` may free the box.
    macro_rules! compression_arm {
        ($tag:ident, $T:ty) => {{
            // SAFETY: §Dispatch — tag identifies pointee; live m_ctx payload.
            unsafe {
                node_zlib_binding::CompressionStream::<$T>::run_from_js_thread(cast_ptr!($tag, $T))
            };
        }};
    }
    /// Run the task, destroy it unconditionally (whether or not it errored),
    /// then propagate. `JsTerminated` tears down the VM, so destroying before
    /// propagating is safe.
    macro_rules! run_then_destroy {
        ($tag:ident, $ty:ty) => {{
            let t = cast_ptr!($tag, $ty);
            // SAFETY: tag identifies pointee; heap-allocated at schedule time.
            let r = unsafe { (*t).run_from_js() };
            // SAFETY: paired with `create_on_js_thread` heap::alloc.
            unsafe { <$ty>::destroy(t) };
            r?;
        }};
        (work $tag:ident, $ty:ty) => {{
            let t = cast_ptr!($tag, $ty);
            // SAFETY: tag identifies pointee; heap-allocated at schedule time.
            let r = bun_jsc::work_task::WorkTask::run_from_js(unsafe { &mut *t });
            // SAFETY: paired with `create_on_js_thread` heap::alloc.
            unsafe { bun_jsc::work_task::WorkTask::destroy(t) };
            r?;
        }};
    }

    // NB: `TaskTag` is a `#[repr(u8)]` enum — this match is exhaustive (no
    // wildcard), so adding a variant without an arm here fails to compile.
    match task.tag {
        // ── erased-callback tasks (low-tier types — real) ────────────────
        TaskTag::AnyTask => {
            let any = cast!(AnyTask, AnyTask);
            if let Err(err) = any.run() {
                report_error_or_terminate(global, err)?;
            }
        }
        TaskTag::ManagedTask => {
            // SAFETY: `task.ptr` was produced by `heap::alloc` in `ManagedTask::new`
            // and enqueued under `TaskTag::ManagedTask`; `run` consumes/frees it.
            if let Err(err) = unsafe { ManagedTask::run(cast_ptr!(ManagedTask, ManagedTask)) } {
                report_error_or_terminate(global, err)?;
            }
        }
        TaskTag::CppTask => {
            if let Err(err) = cast!(CppTask, CppTask).run(global) {
                report_error_or_terminate(global, err)?;
            }
        }

        // ── archive ──────────────────────────────────────────────────────
        // `cast_ptr!` yields the heap-allocated task registered with this
        // tag; the JS-thread dispatch is the sole owner at this point.
        TaskTag::ArchiveExtractTask => {
            ArchiveAsyncTask::run_from_js(cast_ptr!(ArchiveExtractTask, ArchiveExtractTask))?;
        }
        TaskTag::ArchiveBlobTask => {
            ArchiveAsyncTask::run_from_js(cast_ptr!(ArchiveBlobTask, ArchiveBlobTask))?;
        }
        TaskTag::ArchiveWriteTask => {
            ArchiveAsyncTask::run_from_js(cast_ptr!(ArchiveWriteTask, ArchiveWriteTask))?;
        }
        TaskTag::ArchiveFilesTask => {
            ArchiveAsyncTask::run_from_js(cast_ptr!(ArchiveFilesTask, ArchiveFilesTask))?;
        }

        // ── shell interpreter (cold — hoisted to `run_task_cold`) ────────
        TaskTag::ShellAsync
        | TaskTag::ShellAsyncSubprocessDone
        | TaskTag::ShellIOWriterAsyncDeinit
        | TaskTag::ShellIOReaderAsyncDeinit
        | TaskTag::ShellCondExprStatTask
        | TaskTag::ShellCpTask
        | TaskTag::ShellTouchTask
        | TaskTag::ShellMkdirTask
        | TaskTag::ShellLsTask
        | TaskTag::ShellMvBatchedTask
        | TaskTag::ShellMvCheckTargetTask
        | TaskTag::ShellRmTask
        | TaskTag::ShellRmDirTask
        | TaskTag::ShellGlobTask
        | TaskTag::ShellYesTask => run_task_cold(task),

        // ── fetch / S3 ───────────────────────────────────────────────────
        TaskTag::FetchTasklet => {
            cast!(FetchTasklet, FetchTasklet).on_progress_update()?;
        }
        // `cast_ptr!` yields the heap-allocated S3 task; JS-thread dispatch
        // is the sole owner here.
        TaskTag::S3HttpSimpleTask => {
            S3HttpSimpleTask::on_response(cast_ptr!(S3HttpSimpleTask, S3HttpSimpleTask))?;
        }
        TaskTag::S3HttpDownloadStreamingTask => {
            S3HttpDownloadStreamingTask::on_response(cast_ptr!(
                S3HttpDownloadStreamingTask,
                S3HttpDownloadStreamingTask
            ));
        }

        // ── glob / image / transpiler ────────────────────────────────────
        TaskTag::AsyncGlobWalkTask => {
            run_then_destroy!(AsyncGlobWalkTask, AsyncGlobWalkTask<'_>)
        }
        TaskTag::AsyncImageTask => run_then_destroy!(AsyncImageTask, AsyncImageTask<'_>),
        TaskTag::AsyncTransformTask => {
            run_then_destroy!(AsyncTransformTask, AsyncTransformTask<'_>)
        }

        // ── blob copy/read/write promise tasks ───────────────────────────
        TaskTag::CopyFilePromiseTask => {
            run_then_destroy!(CopyFilePromiseTask, CopyFilePromiseTask<'_>)
        }
        TaskTag::ReadFileTask => run_then_destroy!(work ReadFileTask, ReadFileTask),
        TaskTag::WriteFileTask => run_then_destroy!(work WriteFileTask, WriteFileTask),

        // ── napi ─────────────────────────────────────────────────────────
        TaskTag::NapiAsyncWork => {
            cast!(NapiAsyncWork, napi_async_work).run_from_js(vm, global);
        }
        TaskTag::ThreadSafeFunction => {
            ThreadSafeFunction::on_dispatch(cast_ptr!(ThreadSafeFunction, ThreadSafeFunction));
        }
        TaskTag::NapiFinalizerTask => {
            NapiFinalizerTask::run_on_js_thread(cast_ptr!(NapiFinalizerTask, NapiFinalizerTask));
        }

        // ── JSC scheduler / module loader ────────────────────────────────
        TaskTag::JSCDeferredWorkTask => {
            bun_jsc::mark_binding();
            cast!(JSCDeferredWorkTask, JSCDeferredWorkTask).run()?;
        }
        TaskTag::PollPendingModulesTask => {
            vm.modules.on_poll();
        }
        TaskTag::RuntimeTranspilerStore => {
            let store = cast!(RuntimeTranspilerStore, RuntimeTranspilerStore);
            store.run_from_js_thread(el.into(), global, vm.into());
        }

        // ── hot-reload (early-returns from the drain loop) ───────────────
        TaskTag::HotReloadTask => {
            // TODO(layering): `hot_reloader::HotReloadTask` (bun_jsc) has no
            // `Taskable` impl, so the type→tag binding cannot be const-asserted here.
            let t = cast_ptr!(@unchecked hot_reloader::HotReloadTask);
            // The task was heap-allocated in `Task::enqueue`; `deinit` frees it.
            // SAFETY: tag identifies pointee; live Box'd HotReloadTask.
            unsafe { (*t).run() };
            // SAFETY: paired with heap::alloc in `Task::enqueue`.
            unsafe { hot_reloader::HotReloadTask::deinit(t) };
            return Ok(RunTaskResult::EarlyReturn);
        }
        // ── bake dev-server (cold — hoisted to `run_task_cold`) ──────────
        TaskTag::BakeHotReloadEvent => run_task_cold(task),
        TaskTag::FSWatchTask => {
            // The task is heap-allocated
            // (cloned from `FSWatcher.current_task` at enqueue). `deinit` is
            // explicit (not `Drop`) so the embedded `current_task` field never
            // runs it.
            let t = cast_ptr!(FSWatchTask, FSWatchTask);
            // SAFETY: tag identifies pointee; live Box'd FSWatchTask.
            unsafe { (*t).run() };
            // SAFETY: paired with heap::alloc in `FSWatchTask::enqueue`.
            unsafe { FSWatchTask::deinit(t) };
        }

        // ── DNS ──────────────────────────────────────────────────────────
        TaskTag::GetAddrInfoRequestTask => {
            #[cfg(windows)]
            panic!("This should not be reachable on Windows");
            #[cfg(not(windows))]
            run_then_destroy!(work GetAddrInfoRequestTask, get_addr_info_request::Task);
        }

        // ── node:fs async ops (`runFromJSThread`) ────────────────────────
        // 42 arms stamped from `for_each_fs_async_op!` (module scope). The
        // outer or-pattern proves the inner re-match is exhaustive over the
        // table, so the trailing wildcard is genuinely unreachable.
        for_each_fs_async_op!(__fs_pat) => {
            macro_rules! __fs_run {
                ($($tag:ident $ty:ident;)*) => { match task.tag {
                    $(TaskTag::$tag => cast!($tag, fs_async::$ty).run_from_js_thread()?,)*
                    // SAFETY: outer arm guard proves one of the 42 tags matched.
                    _ => unsafe { core::hint::unreachable_unchecked() },
                }};
            }
            for_each_fs_async_op!(__fs_run);
        }

        // ── compression streams ──────────────────────────────────────────
        TaskTag::NativeZlib => compression_arm!(NativeZlib, NativeZlib),
        TaskTag::NativeBrotli => compression_arm!(NativeBrotli, NativeBrotli),
        TaskTag::NativeZstd => compression_arm!(NativeZstd, NativeZstd),

        // ── process / signals ────────────────────────────────────────────
        TaskTag::ProcessWaiterThreadTask => {
            #[cfg(not(windows))]
            {
                // TODO(layering): `bun_spawn::ResultTask<Process>` has no
                // `Taskable` impl, so the type→tag binding cannot be const-asserted here.
                // SAFETY: tag identifies pointee; heap-allocated in WaiterThread.
                let t = unsafe {
                    bun_core::heap::take(cast_ptr!(@unchecked ProcessWaiterThreadTask<Process>))
                };
                t.run_from_js_thread();
            }
            #[cfg(windows)]
            unreachable!("posix-only");
        }
        TaskTag::PosixSignalTask => {
            // `ptr` here is *not* a pointer but a packed signal number.
            let _ = core::marker::PhantomData::<PosixSignalTask>;
            bun_jsc::posix_signal_handle::PosixSignalTask::run_from_js_thread(
                task.ptr as usize as u8,
                global,
            );
        }
        TaskTag::MemoryPressureTask => {
            // `ptr` is the packed level (NOTE_MEMORYSTATUS_PRESSURE_* bits), not a pointer.
            crate::node::memory_pressure::emit(global, task.ptr as usize as i32);
        }
        TaskTag::NativePromiseContextDeferredDerefTask => {
            // `ptr` packs an int, not a pointer.
            NativePromiseContextDeferredDerefTask::run_from_js_thread(task.ptr as usize);
        }

        // ── server / bundler / streams ───────────────────────────────────
        TaskTag::ServerAllConnectionsClosedTask => {
            ServerAllConnectionsClosedTask::run_from_js_thread(
                cast_ptr!(
                    ServerAllConnectionsClosedTask,
                    ServerAllConnectionsClosedTask
                ),
                vm,
            )?;
        }
        TaskTag::BundleV2DeferredBatchTask => {
            // `bun_bundler` is JSC-free so the exception-scope check is hoisted
            // to this dispatch arm; without it, `JSBundlerPlugin__drainDeferred`'s
            // THROW_SCOPE is left unchecked and trips JSC exception validation
            // at the next `drainMicrotasks` scope.
            // TODO(layering): `bun_bundler::DeferredBatchTask` has no `Taskable`
            // impl, so the type→tag binding cannot be const-asserted here.
            let _ = bun_jsc::call_check_slow(global, || {
                cast!(@unchecked BundleV2DeferredBatchTask).run_on_js_thread();
            });
        }
        // SAFETY: `cast_ptr!` yields the heap-allocated task; sole owner.
        TaskTag::FlushPendingFileSinkTask => unsafe {
            FlushPendingFileSinkTask::run_from_js_thread(cast_ptr!(
                FlushPendingFileSinkTask,
                FlushPendingFileSinkTask
            ));
        },
        // `cast_ptr!` yields the heap-allocated task; sole owner.
        TaskTag::StreamPending => {
            StreamPending::run_from_js_thread(cast_ptr!(StreamPending, StreamPending));
        }

        // ── timer wrappers (declared in the union but never dispatched) ──
        TaskTag::ImmediateObject | TaskTag::TimeoutObject => {
            // This is a *reachable* producer bug (timer object enqueued as Task),
            // not provable-unreachable — `unreachable_unchecked()` here would be
            // release-build UB. PORTING.md §Dispatch only sanctions UB for the
            // truly-unreachable wildcard.
            panic!("Unexpected Task tag: {}", task.tag as u8);
        }
    }
    Ok(RunTaskResult::Continue)
}

/// Cold-path arms hoisted out of [`run_task`].
///
/// Shell* / Bake* (and, when they land, Install*) tags are never seen during
/// `bun <file>` startup or the `dot` benchmark, but their per-arm bodies pull
/// in `bun_shell` / `bun_bake` call sites that LLVM otherwise interleaves with
/// the hot AnyTask/ManagedTask/CppTask jump table. Splitting them behind a
/// `#[cold]` boundary lets lld place this whole cluster after the
/// front-clustered startup window (see `src/startup.order`).
///
/// Returns `()` — none of the cold arms can fail or early-return; the caller
/// falls through to `Ok(RunTaskResult::Continue)`.
#[cold]
#[inline(never)]
fn run_task_cold(task: Task) {
    /// Raw `*mut T` (for `heap::take`/self-consuming entry points), plus a
    /// compile-time check that `$ty`'s `Taskable::TAG` matches the arm's tag.
    macro_rules! cast_ptr {
        ($tag:ident, $ty:ty) => {{
            const _: () =
                assert!(<$ty as bun_event_loop::Taskable>::TAG as u8 == TaskTag::$tag as u8);
            task.ptr.cast::<$ty>()
        }};
    }
    /// Shell builtin tasks: route through `ShellTask::run_from_main_thread`
    /// so the keep-alive ref taken in `ShellTask::schedule` is unref'd before
    /// the per-builtin body runs.
    /// The wrapper recovers `&mut Interpreter` from the embedded
    /// `ShellTask.interp` back-ref.
    macro_rules! shell_dispatch {
        ($tag:ident, $ty:ty) => {{
            // SAFETY: §Dispatch — `t` is a live heap-allocated shell task;
            // `interp` was set at schedule time and outlives the task.
            unsafe { ShellTask::run_from_main_thread::<$ty>(cast_ptr!($tag, $ty)) };
        }};
        // Cond-expr wraps an inner `task: ShellTask`-embedding struct one
        // level deeper. The type *does* implement `ShellTaskCtx`
        // (with a two-hop `TASK_OFFSET`, needed for `ShellTask::schedule`),
        // so this arm is behaviorally identical to the plain arm; the unref +
        // interp-recovery are inlined here only to keep the `.task.task`
        // shape explicit at the dispatch site.
        (nested $tag:ident, $ty:ty) => {{
            let t = cast_ptr!($tag, $ty);
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
        TaskTag::ShellAsync => {
            // SAFETY: §Dispatch — tag identifies pointee.
            let t = unsafe {
                &mut *cast_ptr!(ShellAsync, crate::shell::dispatch_tasks::ShellAsyncTask)
            };
            // SAFETY: `interp` set at enqueue; outlives task.
            let interp = unsafe { &*t.interp };
            ShellAsync::run_from_main_thread(interp, t.node);
        }
        TaskTag::ShellAsyncSubprocessDone => {
            let t = cast_ptr!(ShellAsyncSubprocessDone, ShellAsyncSubprocessDone);
            ShellAsyncSubprocessDone::run_from_main_thread(t);
        }
        TaskTag::ShellIOWriterAsyncDeinit => {
            let t = cast_ptr!(ShellIOWriterAsyncDeinit, ShellIOWriterAsyncDeinit);
            ShellIOWriterAsyncDeinit::run_from_main_thread(t);
        }
        TaskTag::ShellIOReaderAsyncDeinit => {
            let t = cast_ptr!(ShellIOReaderAsyncDeinit, ShellIOReaderAsyncDeinit);
            ShellIOReaderAsyncDeinit::run_from_main_thread(t);
        }
        TaskTag::ShellCondExprStatTask => {
            shell_dispatch!(nested ShellCondExprStatTask, ShellCondExprStatTask);
        }
        TaskTag::ShellCpTask => shell_dispatch!(ShellCpTask, ShellCpTask),
        TaskTag::ShellTouchTask => shell_dispatch!(ShellTouchTask, ShellTouchTask),
        TaskTag::ShellMkdirTask => shell_dispatch!(ShellMkdirTask, ShellMkdirTask),
        TaskTag::ShellLsTask => shell_dispatch!(ShellLsTask, ShellLsTask),
        TaskTag::ShellMvBatchedTask => shell_dispatch!(ShellMvBatchedTask, ShellMvBatchedTask),
        TaskTag::ShellMvCheckTargetTask => {
            shell_dispatch!(ShellMvCheckTargetTask, ShellMvCheckTargetTask)
        }
        TaskTag::ShellRmTask => shell_dispatch!(ShellRmTask, ShellRmTask),
        TaskTag::ShellRmDirTask => {
            let t = cast_ptr!(ShellRmDirTask, ShellRmDirTask);
            ShellRmDirTask::run_from_main_thread(t);
        }
        TaskTag::ShellGlobTask => shell_dispatch!(ShellGlobTask, ShellGlobTask),

        // ── bake dev-server ──────────────────────────────────────────────
        TaskTag::BakeHotReloadEvent => {
            // SAFETY: §Dispatch — tag identifies pointee; the event is an inline
            // element of `DevServer.watcher_atomics.events[_]` and `run` itself
            // re-derives `&mut DevServer` from the BACKREF, so pass the raw
            // pointer to avoid materialising an aliasing `&mut` here.
            unsafe { BakeHotReloadEvent::run(cast_ptr!(BakeHotReloadEvent, BakeHotReloadEvent)) };
        }

        // ShellYesTask + any tag the hot path mis-routed: producer bug.
        _ => panic!("Unexpected Task tag: {}", task.tag as u8),
    }
}

// ────────────────────────────────────────────────────────────────────────────
// `tick_queue_with_count` — the full drain loop.
// ────────────────────────────────────────────────────────────────────────────

pub fn tick_queue_with_count(
    el: &mut EventLoop,
    vm: &mut VirtualMachine,
    counter: &mut u32,
) -> Result<(), JsTerminated> {
    // SAFETY: `el.global` is set by VM init before the first tick; live for
    // the duration of the drain loop.
    let global: &JSGlobalObject = unsafe { el.global.expect("EventLoop.global unset").as_ref() };
    let global_vm = global.vm();

    while let Some(task) = el.tasks.read_item() {
        // Incremented before dispatch so the count includes every task,
        // including the one that takes the HotReloadTask early return.
        *counter += 1;
        match run_task(task, el, vm, global)? {
            RunTaskResult::Continue => {}
            RunTaskResult::EarlyReturn => {
                // Caller is `while tickWithCount(ctx) > 0` — must keep
                // draining after a hot-reload task, so report exactly one
                // task processed. Do NOT set 0 here.
                *counter = 1;
                return Ok(());
            }
        }
        el.drain_microtasks_with_global(global, global_vm)?;
    }
    el.tasks.reset_head_if_empty();
    Ok(())
}

// ════════════════════════════════════════════════════════════════════════════
// `bun_jsc::event_loop` extern impls (link-time)
// ════════════════════════════════════════════════════════════════════════════

/// `__bun_run_immediate_task` body — run the queued
/// `bun_jsc::timer::ImmediateObject` (link-time hook for `bun_jsc::event_loop`).
///
/// # Safety
/// `task` was produced by `enqueue_immediate_task` from a live
/// `timer::ImmediateObject`; `vm` is the live per-thread VM.
#[unsafe(no_mangle)]
pub(crate) unsafe fn __bun_run_immediate_task(
    task: *mut bun_jsc::timer::ImmediateObject,
    vm: *mut bun_jsc::virtual_machine::VirtualMachine,
) -> bool {
    // SAFETY: per fn contract.
    unsafe { bun_jsc::timer::ImmediateObject::run_immediate_task(task, vm) }
}

/// `__bun_cancel_pending_immediate` body — VM-teardown release of the event
/// loop's `+1` ref on a still-queued `ImmediateObject` (link-time hook for
/// `bun_jsc::event_loop`). Does not run the callback.
///
/// # Safety
/// `task` was produced by `enqueue_immediate_task` from a live
/// `timer::ImmediateObject` whose event-loop ref has not yet been released;
/// `vm` is the live per-thread VM with `RuntimeState` still installed.
#[unsafe(no_mangle)]
pub(crate) unsafe fn __bun_cancel_pending_immediate(
    task: *mut bun_jsc::timer::ImmediateObject,
    vm: *mut bun_jsc::virtual_machine::VirtualMachine,
) {
    // SAFETY: per fn contract.
    unsafe { bun_jsc::timer::ImmediateObject::cancel_pending(task, vm) }
}

/// `__bun_run_wtf_timer` body — cast the low tier's opaque
/// [`bun_jsc::event_loop::WTFTimerHandle`] back to the real
/// `crate::wtf_timer::WTFTimer` and fire it.
///
/// # Safety
/// `timer` was published by `WTFTimer::update` into `imminent_gc_timer` and
/// remains live until consumed; `vm` is the live per-thread VM.
#[unsafe(no_mangle)]
pub(crate) unsafe fn __bun_run_wtf_timer(
    timer: *mut bun_jsc::event_loop::WTFTimerHandle,
    vm: *mut bun_jsc::virtual_machine::VirtualMachine,
) {
    // SAFETY: per fn contract — the only producer (`WTFTimer::update`) stores a
    // `*mut crate::wtf_timer::WTFTimer` as the opaque handle, so the cast is
    // the identity.
    let real = timer.cast::<crate::wtf_timer::WTFTimer>();
    // SAFETY: per fn contract — `real` is live until consumed; `vm` is the
    // per-thread VM. `run` may re-enter `(*timer_all()).remove()`;
    // no `&mut` held here.
    unsafe { crate::wtf_timer::WTFTimer::run(real, vm) }
}

// ════════════════════════════════════════════════════════════════════════════
// EventLoopTimer dispatch
// ════════════════════════════════════════════════════════════════════════════

/// `__bun_fire_timer` body — the tag→`container_of` match for
/// [`EventLoopTimer::fire`].
///
/// Reached from [`bun_jsc::timer::All::drain_timers`] (every due heap timer) and
/// [`bun_jsc::timer::All::get_timeout`] (WTFTimer side-effect).
///
/// # Safety
/// `t` points at a live [`EventLoopTimer`] just popped from `All.timers`;
/// `now` is the snapshot taken by `All::next`; `vm` is the erased
/// `*mut VirtualMachine`. The handler may free the container — do not touch
/// `t` after the per-arm call returns.
#[unsafe(no_mangle)]
pub unsafe fn __bun_fire_timer(t: *mut EventLoopTimer, now: *const ElTimespec, vm: *mut ()) {
    use bun_jsc::timer::{ImmediateObject, TimeoutObject, TimerObjectInternals};

    use crate::wtf_timer::WTFTimer;

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
            unsafe { $body };
        }};
    }
    match tag {
        // ── JS-exposed timers (TimerObjectInternals::fire) ───────────────
        EventLoopTimerTag::TimeoutObject => {
            let container = owner!(TimeoutObject, event_loop_timer);
            // SAFETY: container derived from a live `TimeoutObject`; do NOT
            // form `&mut *container` — `internals.fire` may `deref()` and free.
            let internals = unsafe { core::ptr::addr_of_mut!((*container).internals) };
            // SAFETY: per fn contract — `now` is the live snapshot; `vm` is the
            // per-thread VM. `fire` may free the container; `t` is dead after.
            // `fire` takes `*mut Self` (noalias re-entrancy — see its doc).
            unsafe { TimerObjectInternals::fire(internals, &*now, vm) };
        }
        EventLoopTimerTag::ImmediateObject => {
            let container = owner!(ImmediateObject, event_loop_timer);
            // SAFETY: see TimeoutObject arm.
            let internals = unsafe { core::ptr::addr_of_mut!((*container).internals) };
            // SAFETY: see TimeoutObject arm.
            unsafe { TimerObjectInternals::fire(internals, &*now, vm) };
        }
        // Spec `inline else` fallthrough: `container.callback(container)`.
        EventLoopTimerTag::TimerCallback => {
            timer_arm!(TimerCallback, event_loop_timer, |c, _now, _vm| ((*c)
                .callback)(
                c
            ))
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
            }
            #[cfg(not(windows))]
            {
                if cfg!(debug_assertions) {
                    unreachable!("WindowsNamedPipe timer on non-Windows");
                }
            }
        }
        EventLoopTimerTag::PostgresSQLConnectionTimeout => {
            // SAFETY: §Dispatch — tag set together with the container at
            // construction; `t` is the connection's `timer` field.
            let container = unsafe { PostgresSQLConnection::from_timer_ptr(t) };
            // SAFETY: per fn contract.
            unsafe { (*container).on_connection_timeout() };
        }
        EventLoopTimerTag::PostgresSQLConnectionMaxLifetime => {
            // SAFETY: §Dispatch — `t` is the connection's `max_lifetime_timer`.
            let container = unsafe { PostgresSQLConnection::from_max_lifetime_timer_ptr(t) };
            // SAFETY: per fn contract.
            unsafe { (*container).on_max_lifetime_timeout() };
        }
        EventLoopTimerTag::MySQLConnectionTimeout => {
            // SAFETY: §Dispatch — `t` is the connection's `timer` field.
            let container = unsafe { MySQLConnection::from_timer_ptr(t) };
            // SAFETY: per fn contract.
            unsafe { (*container).on_connection_timeout() };
        }
        EventLoopTimerTag::MySQLConnectionMaxLifetime => {
            // SAFETY: §Dispatch — `t` is the connection's `max_lifetime_timer`.
            let container = unsafe { MySQLConnection::from_max_lifetime_timer_ptr(t) };
            // SAFETY: per fn contract.
            unsafe { (*container).on_max_lifetime_timeout() };
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
        }
        EventLoopTimerTag::DevServerMemoryVisualizerTick => {
            // SAFETY: per fn contract; `t` is the `memory_visualizer_timer`
            // field of a live DevServer.
            DevServer::emit_memory_visualizer_message_timer(unsafe { &mut *t }, unsafe { &*now });
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
        }
        EventLoopTimerTag::CronJob => {
            let c: *mut CronJob = owner!(CronJob, event_loop_timer);
            CronJob::on_timer_fire(c, VirtualMachine::get());
        }
    }
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
pub(crate) unsafe fn __bun_tick_queue_with_count(
    el: *mut EventLoop,
    vm: *mut bun_jsc::virtual_machine::VirtualMachine,
    counter: &mut u32,
) -> Result<(), JsTerminated> {
    // SAFETY: per fn contract.
    let (el, vm_ref) = unsafe { (&mut *el, &mut *vm) };
    tick_queue_with_count(el, vm_ref, counter)
}

// (former duplicate `__bun_run_tasks` removed r6 — `bun_jsc::task::run_tasks`
// had no callers; `__bun_tick_queue_with_count` above is the sole entry point.)

/// `__bun_release_task_at_shutdown` body — declared `extern "Rust"` in
/// `bun_jsc::event_loop`. Called from `release_queued_tasks_for_shutdown` on
/// the JS thread for every queued task that will never be dispatched (the JS
/// thread is past `global_exit`'s `is_shutting_down` flip and the loop will
/// not tick again), after the HTTP daemon has parked and before
/// `destructOnExit`. Releases the boxes and JSC handles the dispatch path
/// would have dropped. Tags not yet listed leak their box at exit; add them
/// as LSan surfaces them.
#[unsafe(no_mangle)]
pub(crate) fn __bun_release_task_at_shutdown(task: bun_event_loop::Task) -> bool {
    match task.tag {
        // `callback` (HTTP thread) won the `has_schedule_callback` CAS and
        // posted this entry, then deref'd its own +1 if final; the JS-side
        // +1 it expected `on_progress_update` to drop is the one we release
        // here. Runs on the JS thread, so the plain `deref` (→ `deinit` on
        // 1→0) is the right teardown path; the HTTP daemon is already
        // parked (`shutdown_for_exit` precedes `destroy`), so the
        // `Box<AsyncHTTP>` and any `metadata` it owns are exclusively ours.
        TaskTag::FetchTasklet => {
            // SAFETY: `task.ptr` is the live heap `FetchTasklet`; HTTP daemon is
            // already parked so we hold the sole reference.
            FetchTasklet::deref(task.ptr.cast::<FetchTasklet>());
            true
        }
        // `AsyncFSTask`s are `Box::leak`'d in `create()` and freed by
        // `destroy()` (called from `run_from_js_thread`'s scopeguard).
        // `destroy()` resets `JSPromiseStrong` (touches the JSC HandleSet)
        // and unrefs the loop `KeepAlive`, both of which are still valid
        // here — we're before `destructOnExit`. Before
        // `release_queued_tasks_for_shutdown` existed these boxes stayed
        // reachable via `concurrent_tasks` (rooted by the static `VMHolder`),
        // so LSan didn't flag them; the drain unhooks that root and surfaces
        // the real leak.
        for_each_fs_async_op!(__fs_pat) => {
            macro_rules! __fs_destroy {
                ($($tag:ident $ty:ident;)*) => { match task.tag {
                    $(TaskTag::$tag => {
                        // SAFETY: tag identifies pointee; `Box::leak`'d in
                        // `AsyncFSTask::create`. The work-pool callback ran
                        // (it posted this entry) so the threadpool no longer
                        // holds the embedded `task` field.
                        unsafe { fs_async::$ty::destroy(task.ptr.cast::<fs_async::$ty>()) };
                    })*
                    // SAFETY: outer arm guard proves one of the table tags matched.
                    _ => unsafe { core::hint::unreachable_unchecked() },
                }};
            }
            for_each_fs_async_op!(__fs_destroy);
            true
        }
        // Re-queued by the caller; the box stays reachable from the
        // static-rooted VM. Dispatching the type-erased `AnyTask` callback
        // is not generally safe at shutdown (e.g. `AsyncModule::on_done`,
        // `dns::Holder::run` call straight into JS).
        _ => false,
    }
}

// ─── Type→tag bindings for bun_runtime-local task types ────────────────────
// Lives beside the dispatch match so the table and the arms are one file;
// each binding is const-asserted by the cast!/cast_ptr! arms above.
impl bun_event_loop::Taskable for ShellAsyncSubprocessDone {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::TaskTag::ShellAsyncSubprocessDone;
}
impl bun_event_loop::Taskable for ShellIOWriterAsyncDeinit {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::TaskTag::ShellIOWriterAsyncDeinit;
}
impl bun_event_loop::Taskable for ShellIOReaderAsyncDeinit {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::TaskTag::ShellIOReaderAsyncDeinit;
}
impl bun_event_loop::Taskable for FlushPendingFileSinkTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::TaskTag::FlushPendingFileSinkTask;
}
