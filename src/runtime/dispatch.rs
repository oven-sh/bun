//! `crate::dispatch` — the §Dispatch hot-path payoff.
//!
//! Per `docs/PORTING.md` §Dispatch, low-tier crates store
//! `Task = { tag: TaskTag, ptr: *mut () }` and never name a variant type. This
//! crate (highest tier) owns **every** variant type, so the actual `match`
//! loop lives here. LLVM inlines the per-arm direct calls exactly as Zig's
//! `switch (task.tag()) { inline else => |p| p.run() }` did.
//!
//! Three dispatchers are defined:
//!   1. [`run_task`] — `bun_event_loop::Task` (~96 variants; src/jsc/Task.zig).
//!   2. [`run_file_poll`] — `bun_io::FilePoll::Owner` (~13 variants;
//!      src/aio/posix_event_loop.zig `FilePoll.onUpdate`).
//!
//! Low-tier crates declare these as `extern "Rust"`; this crate defines them
//! `#[no_mangle]` so the linker resolves the call directly — no runtime
//! registration, no `AtomicPtr`, no init-order hazard.
//!
//! **Adding a variant** (do all three):
//!   1. tag constant in `bun_event_loop::task_tag` (or `bun_io::poll_tag`);
//!   2. `impl bun_jsc::Taskable for YourType { const TAG = task_tag::YourType; }`;
//!   3. a match arm here.

// Flat re-export landing pad for `generated_js2native.rs` thunks whose source
// `.zig` file lives outside `src/runtime/`. Kept in a sibling file so this
// hot-path module stays focused on the task/timer/poll match loops.
#[path = "dispatch_js2native.rs"]
pub mod js2native;

use bun_event_loop::AnyTask::AnyTask;
use bun_event_loop::ManagedTask::ManagedTask;
use bun_event_loop::{Task, TaskTag, task_tag};

// `FilePoll::on_update` dispatch is POSIX-only (the symbol is declared
// `extern "Rust"` in `aio::posix_event_loop` and never referenced on Windows,
// where libuv drives I/O readiness directly).
#[cfg(not(windows))]
use bun_io::posix_event_loop::{FilePoll, Flags as PollFlag, poll_tag};

use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, Tag as EventLoopTimerTag, TimerCallback, Timespec as ElTimespec,
};

use bun_jsc::JSGlobalObject;
use bun_jsc::event_loop::{EventLoop, JsTerminated};
use bun_jsc::task::report_error_or_terminate;
use bun_jsc::virtual_machine::VirtualMachine;

/// X-macro: the 42 `node:fs` async ops dispatched via `run_from_js_thread`.
///
/// Row shape: `$tag $ty;` — `$tag` is the `bun_event_loop::task_tag::*` const,
/// `$ty` is the `fs_async::*` alias. They differ in exactly three rows
/// (`FTruncate`/`Ftruncate`, `FChown`/`Fchown`, `StatFS`/`Statfs`), so the
/// macro carries both idents. `ReaddirRecursive` is the bespoke
/// `AsyncReaddirRecursiveTask` (not an `AsyncFSTask<_,_,F>`); `Cp` and
/// `AsyncMkdirp` are intentionally absent — they have bespoke dispatch paths.
macro_rules! for_each_fs_async_op {
    ($m:ident) => { $m! {
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
    }};
}
/// Expand the fs-op table to an or-pattern over `task_tag::*` (pattern position).
macro_rules! __fs_pat {
    ($($tag:ident $ty:ident;)*) => { $(task_tag::$tag)|* };
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
use crate::shell::io_writer::{IOWriter as ShellIOWriter, Poll as ShellBufferedWriterPoll};
use crate::shell::states::r#async::Async as ShellAsync;

use crate::webcore::blob::copy_file::CopyFilePromiseTask;
use crate::webcore::blob::read_file::ReadFileTask;
use crate::webcore::blob::write_file::WriteFileTask;
use crate::webcore::fetch::fetch_tasklet::FetchTasklet;
use crate::webcore::file_sink::{
    FlushPendingTask as FlushPendingFileSinkTask, Poll as FileSinkPoll,
};
use crate::webcore::s3::download_stream::S3HttpDownloadStreamingTask;
use crate::webcore::s3::simple_request::S3HttpSimpleTask;
use crate::webcore::streams::Pending as StreamPending;

use crate::api::JSTranspiler::AsyncTransformTask;
use crate::api::bun_subprocess::Subprocess;
use crate::api::bun_terminal_body::Poll as TerminalPoll;
use crate::api::cron::CronJob;
use crate::api::glob::AsyncGlobWalkTask;
use crate::api::native_promise_context::DeferredDerefTask as NativePromiseContextDeferredDerefTask;
use crate::image::AsyncImageTask;
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

use crate::node::fs::async_ as fs_async;
use crate::node::node_fs_stat_watcher::StatWatcherScheduler;
use crate::node::node_fs_watcher::FSWatchTask;
use crate::node::node_zlib_binding;
use crate::node::zlib::{
    native_brotli::NativeBrotli, native_zlib::NativeZlib, native_zstd::NativeZstd,
};

#[allow(unused_imports)]
use crate::dns_jsc::{GetAddrInfoRequest, Resolver as DNSResolver, get_addr_info_request};
use crate::server::ServerAllConnectionsClosedTask;

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

#[allow(unused_imports)]
use bun_io::pipe_writer::PosixPipeWriter; // brings `on_poll` into scope for FileSinkPoll/StaticPipeWriterPoll/etc.

// ════════════════════════════════════════════════════════════════════════════
// Task dispatch (src/jsc/Task.zig `tickQueueWithCount` switch)
// ════════════════════════════════════════════════════════════════════════════

/// Per-arm result for [`run_task`]: `Continue` means proceed to drain
/// microtasks and the next item; `EarlyReturn` is the HotReloadTask special
/// case (Zig: `counter.* = 0; return;` — microtasks must NOT drain).
pub enum RunTaskResult {
    Continue,
    EarlyReturn,
}

/// Dispatch a single `Task` to its variant's `run`-style entry point.
///
/// This is the body of one iteration of Zig `tickQueueWithCount`'s `while`
/// loop (the per-item `switch`). The surrounding drain loop + microtask flush
/// lives in [`tick_queue_with_count`] below.
// PERF(startup/dot): `#[inline(never)]` is deliberate. Zig's `inline else`
// monomorphized every arm into the drain loop, but in Rust `#[inline]` here
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
    /// Zig: `var t = task.get(T).?; defer t.deinit(); try t.runFromJS();`.
    /// `defer` runs after `try` whether it errored or not, so destroy
    /// unconditionally then propagate. `JsTerminated` tears down the VM,
    /// so the destroy ordering is observably equivalent.
    macro_rules! run_then_destroy {
        ($ty:ty) => {{
            let t = cast_ptr!($ty);
            // SAFETY: tag identifies pointee; heap-allocated at schedule time.
            let r = unsafe { (*t).run_from_js() };
            // SAFETY: paired with `create_on_js_thread` heap::alloc.
            unsafe { <$ty>::destroy(t) };
            r?;
        }};
        (work $ty:ty) => {{
            let t = cast_ptr!($ty);
            let r = bun_jsc::work_task::WorkTask::run_from_js(t);
            // SAFETY: paired with `create_on_js_thread` heap::alloc.
            unsafe { bun_jsc::work_task::WorkTask::destroy(t) };
            r?;
        }};
    }

    // NB: `TaskTag` is `#[derive(PartialEq, Eq)]` over `u8` → structural-match
    // eligible, so const patterns work directly.
    match task.tag {
        // ── erased-callback tasks (low-tier types — real) ────────────────
        task_tag::AnyTask => {
            let any = cast!(AnyTask);
            // Zig: `any.run() catch |err| reportErrorOrTerminate(global, err)`.
            // `bun_event_loop::ErasedJsError` carries the discriminant; recover
            // the real `JsError` so `Terminated` short-circuits correctly.
            if let Err(err) = any.run() {
                report_error_or_terminate(global, bun_jsc::JsError::from(err))?;
            }
        }
        task_tag::ManagedTask => {
            // Zig: `any.run() catch |err| reportErrorOrTerminate(global, err)`.
            if let Err(err) = ManagedTask::run(cast_ptr!(ManagedTask)) {
                report_error_or_terminate(global, bun_jsc::JsError::from(err))?;
            }
        }
        task_tag::CppTask => {
            // Zig: `any.run(global) catch |err| reportErrorOrTerminate(global, err)`.
            if let Err(err) = cast!(CppTask).run(global) {
                report_error_or_terminate(global, err)?;
            }
        }

        // ── archive ──────────────────────────────────────────────────────
        task_tag::ArchiveExtractTask => {
            ArchiveAsyncTask::run_from_js(cast_ptr!(ArchiveExtractTask))?;
        }
        task_tag::ArchiveBlobTask => {
            ArchiveAsyncTask::run_from_js(cast_ptr!(ArchiveBlobTask))?;
        }
        task_tag::ArchiveWriteTask => {
            ArchiveAsyncTask::run_from_js(cast_ptr!(ArchiveWriteTask))?;
        }
        task_tag::ArchiveFilesTask => {
            ArchiveAsyncTask::run_from_js(cast_ptr!(ArchiveFilesTask))?;
        }

        // ── shell interpreter (cold — hoisted to `run_task_cold`) ────────
        task_tag::ShellAsync
        | task_tag::ShellAsyncSubprocessDone
        | task_tag::ShellIOWriterAsyncDeinit
        | task_tag::ShellIOWriter
        | task_tag::ShellIOReaderAsyncDeinit
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
        task_tag::S3HttpSimpleTask => {
            S3HttpSimpleTask::on_response(cast_ptr!(S3HttpSimpleTask))?;
        }
        task_tag::S3HttpDownloadStreamingTask => {
            S3HttpDownloadStreamingTask::on_response(cast_ptr!(S3HttpDownloadStreamingTask));
        }

        // ── glob / image / transpiler ────────────────────────────────────
        task_tag::AsyncGlobWalkTask => run_then_destroy!(AsyncGlobWalkTask<'_>),
        task_tag::AsyncImageTask => run_then_destroy!(AsyncImageTask<'_>),
        task_tag::AsyncTransformTask => run_then_destroy!(AsyncTransformTask<'_>),

        // ── blob copy/read/write promise tasks ───────────────────────────
        task_tag::CopyFilePromiseTask => run_then_destroy!(CopyFilePromiseTask<'_>),
        task_tag::ReadFileTask => run_then_destroy!(work ReadFileTask),
        task_tag::WriteFileTask => run_then_destroy!(work WriteFileTask),

        // ── napi ─────────────────────────────────────────────────────────
        task_tag::NapiAsyncWork => {
            cast!(napi_async_work).run_from_js(vm, global);
        }
        task_tag::ThreadSafeFunction => {
            ThreadSafeFunction::on_dispatch(cast_ptr!(ThreadSafeFunction));
        }
        task_tag::NapiFinalizerTask => {
            NapiFinalizerTask::run_on_js_thread(cast_ptr!(NapiFinalizerTask));
        }

        // ── JSC scheduler / module loader ────────────────────────────────
        task_tag::JSCDeferredWorkTask => {
            bun_jsc::mark_binding();
            cast!(JSCDeferredWorkTask).run()?;
        }
        task_tag::PollPendingModulesTask => {
            // Zig: `virtual_machine.modules.onPoll()`.
            vm.modules.on_poll();
        }
        task_tag::RuntimeTranspilerStore => {
            cast!(RuntimeTranspilerStore).run_from_js_thread(el, global, vm);
        }

        // ── hot-reload (Zig early-returns from the drain loop) ───────────
        task_tag::HotReloadTask => {
            let t = cast_ptr!(hot_reloader::HotReloadTask);
            // Zig: `defer t.deinit(); t.run(); counter.* = 0; return;`.
            // The task was heap-allocated in `Task::enqueue` (`bun.new`);
            // `deinit` frees it (`bun.destroy`).
            // SAFETY: tag identifies pointee; live Box'd HotReloadTask.
            unsafe { (*t).run() };
            // SAFETY: paired with heap::alloc in `Task::enqueue`.
            unsafe { hot_reloader::HotReloadTask::deinit(t) };
            return Ok(RunTaskResult::EarlyReturn);
        }
        // ── bake dev-server (cold — hoisted to `run_task_cold`) ──────────
        task_tag::BakeHotReloadEvent => run_task_cold(task),
        task_tag::FSWatchTask => {
            // Zig: `defer t.deinit(); t.run();` — the task is heap-allocated
            // (cloned from `FSWatcher.current_task` at enqueue). `deinit` is
            // explicit (not `Drop`) so the embedded `current_task` field never
            // runs it.
            let t = cast_ptr!(FSWatchTask);
            // SAFETY: tag identifies pointee; live Box'd FSWatchTask.
            unsafe { (*t).run() };
            // SAFETY: paired with heap::alloc in `FSWatchTask::enqueue`.
            unsafe { FSWatchTask::deinit(t) };
        }

        // ── DNS ──────────────────────────────────────────────────────────
        task_tag::GetAddrInfoRequestTask => {
            #[cfg(windows)]
            panic!("This should not be reachable on Windows");
            #[cfg(not(windows))]
            run_then_destroy!(work get_addr_info_request::Task);
        }

        // ── node:fs async ops (`runFromJSThread`) ────────────────────────
        // 42 arms stamped from `for_each_fs_async_op!` (module scope). The
        // outer or-pattern proves the inner re-match is exhaustive over the
        // table, so the trailing wildcard is genuinely unreachable.
        for_each_fs_async_op!(__fs_pat) => {
            macro_rules! __fs_run {
                ($($tag:ident $ty:ident;)*) => { match task.tag {
                    $(task_tag::$tag => cast!(fs_async::$ty).run_from_js_thread()?,)*
                    // SAFETY: outer arm guard proves one of the 42 tags matched.
                    _ => unsafe { core::hint::unreachable_unchecked() },
                }};
            }
            for_each_fs_async_op!(__fs_run);
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
            // Zig: `PosixSignalTask.runFromJSThread(@intCast(task.asUintptr()), global)`
            // — `ptr` here is *not* a pointer but a packed signal number.
            let _ = core::marker::PhantomData::<PosixSignalTask>;
            bun_jsc::posix_signal_handle::PosixSignalTask::run_from_js_thread(
                task.ptr as usize as u8,
                global,
            );
        }
        task_tag::NativePromiseContextDeferredDerefTask => {
            // Zig: `runFromJSThread(@intCast(task.asUintptr()))` — `ptr` packs an int.
            NativePromiseContextDeferredDerefTask::run_from_js_thread(task.ptr as usize);
        }

        // ── server / bundler / streams ───────────────────────────────────
        task_tag::ServerAllConnectionsClosedTask => {
            ServerAllConnectionsClosedTask::run_from_js_thread(
                cast_ptr!(ServerAllConnectionsClosedTask),
                vm,
            )?;
        }
        task_tag::BundleV2DeferredBatchTask => {
            // Zig: `Plugin.drainDeferred` is wrapped in `fromJSHostCallGeneric`
            // (== `call_check_slow`) and the only caller does `catch return`.
            // `bun_bundler` is JSC-free so the exception-scope check is hoisted
            // to this dispatch arm; without it, `JSBundlerPlugin__drainDeferred`'s
            // THROW_SCOPE is left unchecked and trips JSC exception validation
            // at the next `drainMicrotasks` scope.
            let _ = bun_jsc::call_check_slow(global, || {
                cast!(BundleV2DeferredBatchTask).run_on_js_thread();
            });
        }
        task_tag::FlushPendingFileSinkTask => {
            FlushPendingFileSinkTask::run_from_js_thread(cast_ptr!(FlushPendingFileSinkTask));
        }
        task_tag::StreamPending => {
            StreamPending::run_from_js_thread(cast_ptr!(StreamPending));
        }

        // ── timer wrappers (declared in the union but never dispatched
        //    here in Zig either — see Task.zig trailing `else`) ───────────
        task_tag::ImmediateObject | task_tag::TimeoutObject => {
            // Spec Task.zig:529-535: `bun.Output.panic("Unexpected Task tag: {d}")`.
            // This is a *reachable* producer bug (timer object enqueued as Task),
            // not provable-unreachable — `unreachable_unchecked()` here would be
            // release-build UB. PORTING.md §Dispatch only sanctions UB for the
            // truly-unreachable wildcard.
            panic!("Unexpected Task tag: {}", task.tag.0);
        }

        _ => {
            // Spec Task.zig:529-535: controlled `bun.Output.panic` with
            // diagnostic. A value outside `task_tag::COUNT` is a producer bug,
            // but the spec treats it as a recoverable crash, not UB.
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
/// the hot AnyTask/ManagedTask/CppTask jump table. Splitting them behind a
/// `#[cold]` boundary lets lld place this whole cluster after the
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
    /// the per-builtin body runs (Zig: `InnerShellTask.runFromMainThread`).
    /// The wrapper recovers `&mut Interpreter` from the embedded
    /// `ShellTask.interp` back-ref.
    macro_rules! shell_dispatch {
        ($ty:ty) => {{
            // SAFETY: §Dispatch — `t` is a live heap-allocated shell task;
            // `interp` was set at schedule time and outlives the task.
            unsafe { ShellTask::run_from_main_thread::<$ty>(cast_ptr!($ty)) };
        }};
        // `.task.task.runFromMainThread()` shape (cond-expr wraps an inner
        // `task: ShellTask`-embedding struct one level deeper). Not a
        // `ShellTaskCtx` implementor, so unref + interp-recovery are inlined.
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
            // Spec Task.zig:161 `runFromMainThread()` — Rust port routes via
            // (interp, NodeId).
            // SAFETY: §Dispatch — tag identifies pointee.
            let t = unsafe { &mut *cast_ptr!(crate::shell::dispatch_tasks::ShellAsyncTask) };
            // SAFETY: `interp` set at enqueue; outlives task.
            let interp = unsafe { &*t.interp };
            ShellAsync::run_from_main_thread(interp, t.node);
        }
        task_tag::ShellAsyncSubprocessDone => {
            let t = cast_ptr!(ShellAsyncSubprocessDone);
            // SAFETY: live Box'd task.
            unsafe { ShellAsyncSubprocessDone::run_from_main_thread(t) };
        }
        task_tag::ShellIOWriterAsyncDeinit => {
            let t = cast_ptr!(ShellIOWriterAsyncDeinit);
            // SAFETY: live Box'd task.
            unsafe { ShellIOWriterAsyncDeinit::run_from_main_thread(t) };
        }
        task_tag::ShellIOWriter => {
            let t = cast_ptr!(ShellIOWriter);
            // SAFETY: live IOWriter (ref-counted).
            unsafe { ShellIOWriter::run_from_main_thread(t) };
        }
        task_tag::ShellIOReaderAsyncDeinit => {
            let t = cast_ptr!(ShellIOReaderAsyncDeinit);
            // SAFETY: live Box'd task.
            unsafe { ShellIOReaderAsyncDeinit::run_from_main_thread(t) };
        }
        task_tag::ShellCondExprStatTask => {
            // Spec: `task.get(..).?.task.runFromMainThread()` — one level of
            // `.task` indirection in Zig too.
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
            // SAFETY: live DirTask child of a ShellRmTask tree.
            unsafe { ShellRmDirTask::run_from_main_thread(t) };
        }
        task_tag::ShellGlobTask => shell_dispatch!(ShellGlobTask),

        // ── bake dev-server ──────────────────────────────────────────────
        task_tag::BakeHotReloadEvent => {
            // SAFETY: §Dispatch — tag identifies pointee; the event is an inline
            // element of `DevServer.watcher_atomics.events[_]` and `run` itself
            // re-derives `&mut DevServer` from the BACKREF, so pass the raw
            // pointer to avoid materialising an aliasing `&mut` here.
            unsafe { BakeHotReloadEvent::run(cast_ptr!(BakeHotReloadEvent)) };
        }

        // ShellYesTask + any tag the hot path mis-routed: producer bug.
        // Spec Task.zig:529-535 `bun.Output.panic("Unexpected Task tag: {d}")`.
        _ => panic!("Unexpected Task tag: {}", task.tag.0),
    }
}

/// Compile-time guard that the arm count above tracks
/// `bun_event_loop::task_tag::COUNT`. Bump when adding a variant.
const _: () = assert!(
    task_tag::COUNT == 96,
    "dispatch::run_task arm count out of sync with bun_event_loop::task_tag",
);

// ────────────────────────────────────────────────────────────────────────────
// `tick_queue_with_count` — the full drain loop (Zig `tickQueueWithCount`).
// ────────────────────────────────────────────────────────────────────────────

pub fn tick_queue_with_count(
    el: &mut EventLoop,
    vm: &mut VirtualMachine,
    counter: &mut u32,
) -> Result<(), JsTerminated> {
    // SAFETY: `el.global` is set by VM init before the first tick; live for
    // the duration of the drain loop (Zig: `this.global`).
    let global: &JSGlobalObject = unsafe { el.global.expect("EventLoop.global unset").as_ref() };
    let global_vm: *mut bun_jsc::VM = std::ptr::from_ref::<bun_jsc::VM>(global.vm()).cast_mut();

    #[cfg(debug_assertions)]
    if el.debug.js_call_count_outside_tick_queue
        > el.debug.drain_microtasks_count_outside_tick_queue
    {
        // PORT NOTE: Zig `bun.Output.panic` with the long advisory string.
        // We keep the assert + short message; the full text is debug-only and
        // can be expanded when `Output::panic` lands.
        panic!(
            "{} JavaScript functions were called outside of the microtask queue without draining microtasks. Use EventLoop.runCallback().",
            el.debug.js_call_count_outside_tick_queue
                - el.debug.drain_microtasks_count_outside_tick_queue
        );
    }

    while let Some(task) = el.tasks.read_item() {
        // PORT NOTE: Zig increments `counter` via `defer counter.* += 1;` at
        // the top of the loop body, so it fires on every scope exit including
        // the HotReloadTask `return`. Hoisting it before dispatch keeps the
        // Continue path identical and avoids a scopeguard.
        *counter += 1;
        match run_task(task, el, vm, global)? {
            RunTaskResult::Continue => {}
            RunTaskResult::EarlyReturn => {
                // Zig: `counter.* = 0; return;` followed by the deferred
                // `counter.* += 1` (defers run after `return`, LIFO), so the
                // observable result is `counter == 1`. Caller is
                // `while tickWithCount(ctx) > 0` — must keep draining after a
                // hot-reload task. Do NOT set 0 here.
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
// FilePoll dispatch (src/aio/posix_event_loop.zig `FilePoll.onUpdate` switch)
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
pub unsafe fn __bun_run_file_poll(poll: *mut FilePoll, size_or_offset: i64) {
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
    /// 1-arg form is the Zig `ptr.as(T).onPoll(size_or_offset, hup)` shape that
    /// covers most tags.
    macro_rules! poll_arm {
        ($Ty:ty) => {
            poll_arm!($Ty, |h| unsafe { (*h).on_poll(size_or_offset as isize, hup) })
        };
        ($Ty:ty, |$h:ident| $body:expr) => {{
            // SAFETY: tag was set together with this pointee type at `FilePoll::init`.
            let $h: *mut $Ty = owner.ptr.cast::<$Ty>();
            $body;
        }};
    }

    match owner.tag() {
        poll_tag::BUFFERED_READER => poll_arm!(bun_io::BufferedReader, |h| unsafe {
            bun_io::BufferedReader::on_poll(&mut *h, size_or_offset as isize, hup)
        }),
        poll_tag::PROCESS => {
            // Bypass `owner_as!` (which yields `&mut`) — `Process` may be freed
            // by the trailing `deref`, so keep raw provenance end-to-end.
            let proc = owner.ptr.cast::<Process>();
            // SAFETY: `proc` carries the +1 ref taken at queue time; this drops it.
            unsafe { Process::on_wait_pid_from_event_loop_task(proc) };
        }
        poll_tag::PARENT_DEATH_WATCHDOG => {
            let wd = owner_as!(bun_io::parent_death_watchdog::ParentDeathWatchdog);
            // Zig gates this `comptime !Environment.isMac => unreachable`;
            // mirror with a debug-assert (Linux uses prctl(PR_SET_PDEATHSIG)).
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
        poll_tag::SHELL_BUFFERED_WRITER => poll_arm!(ShellBufferedWriterPoll, |h| unsafe {
            crate::shell::io_writer::on_poll(&mut *h, size_or_offset as isize, hup)
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
                let loader = owner.ptr as *mut GetAddrInfoRequest;
                get_addr_info_request::BackendLibInfo::on_machport_change(loader);
            }
            #[cfg(not(target_os = "macos"))]
            {
                debug_assert!(false, "GetAddrInfoRequest poll on non-mac");
            }
        }
        poll_tag::REQUEST => {
            #[cfg(target_os = "macos")]
            {
                let req = owner.ptr as *mut crate::dns_jsc::internal::Request;
                crate::dns_jsc::internal::MacAsyncDNS::on_machport_change(req);
            }
            #[cfg(not(target_os = "macos"))]
            {
                debug_assert!(false, "InternalDNSRequest poll on non-mac");
            }
        }
        poll_tag::TERMINAL_POLL => poll_arm!(TerminalPoll),
        // `OutputReader = BufferedReader` in install crate — separate tag for ownership.
        poll_tag::LIFECYCLE_SCRIPT_SUBPROCESS_OUTPUT_READER => {
            poll_arm!(bun_io::BufferedReader, |h| unsafe {
                bun_io::BufferedReader::on_poll(&mut *h, size_or_offset as isize, hup)
            })
        }

        poll_tag::NULL | _ => {
            // Zig: `else => log("onUpdate ... disconnected? (maybe: {s})")`.
            // The low-tier `on_update` already logged before calling the hook
            // when it was null; here we just no-op the unknown tag.
            let _ = (size_or_offset, hup);
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
// io::Poll dispatch (src/io/io.zig `Poll.onUpdateKqueue`/`onUpdateEpoll` switch)
// ════════════════════════════════════════════════════════════════════════════

use crate::webcore::blob::read_file::ReadFile;
use crate::webcore::blob::write_file::WriteFile;

/// `bun_io::__bun_io_pollable_on_ready` body — declared `extern "Rust"` in
/// `bun_io`. Spec `io.zig:626`: `inline else => |t| this.onReady()` where
/// `this` is recovered from the embedded `io_poll` field.
///
/// # Safety
/// `poll` is the `io_poll` field of a live owner of type `tag`.
#[unsafe(no_mangle)]
pub unsafe fn __bun_io_pollable_on_ready(tag: bun_io::PollableTag, poll: *mut bun_io::Poll) {
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
/// `bun_io`. Spec `io.zig:629`: `this.onIOError(err)`.
///
/// # Safety
/// `poll` is the `io_poll` field of a live owner of type `tag`.
#[unsafe(no_mangle)]
pub unsafe fn __bun_io_pollable_on_io_error(
    tag: bun_io::PollableTag,
    poll: *mut bun_io::Poll,
    err: bun_sys::Error,
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
            // PORT NOTE: WriteFile::on_io_error already takes `*mut ()` (it
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
pub unsafe fn __bun_run_immediate_task(
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

/// `__bun_run_wtf_timer` body — cast the low-tier erased `*mut ()` to the real
/// `crate::timer::WTFTimer` and fire it (spec event_loop.zig:302-306
/// `imminent_gc_timer.swap(null).?.run(vm)`).
///
/// # Safety
/// `timer` was published by `WTFTimer::update` into `imminent_gc_timer` and
/// remains live until consumed; `vm` is the live per-thread VM.
#[unsafe(no_mangle)]
pub unsafe fn __bun_run_wtf_timer(
    timer: *mut (),
    vm: *mut bun_jsc::virtual_machine::VirtualMachine,
) {
    // SAFETY: per fn contract — the only producer (`WTFTimer::update`) stores a
    // `*mut crate::timer::WTFTimer`, so the cast is the identity.
    let real = timer.cast::<crate::timer::WTFTimer>();
    // SAFETY: per fn contract — `real` is live until consumed; `vm` is the
    // per-thread VM. `run` may re-enter `(*runtime_state()).timer.remove()`;
    // no `&mut` held here.
    unsafe { crate::timer::WTFTimer::run(real, vm) }
}

// ════════════════════════════════════════════════════════════════════════════
// EventLoopTimer dispatch (src/event_loop/EventLoopTimer.zig `fire` switch)
// ════════════════════════════════════════════════════════════════════════════

/// `__bun_fire_timer` body — the tag→`container_of` match for
/// [`EventLoopTimer::fire`]. Spec EventLoopTimer.zig:170-223.
///
/// Reached from [`crate::timer::All::drain_timers`] (every due heap timer) and
/// [`crate::timer::All::get_timeout`] (WTFTimer side-effect).
///
/// # Safety
/// `t` points at a live [`EventLoopTimer`] just popped from `All.timers`;
/// `now` is the snapshot taken by `All::next`; `vm` is the erased
/// `*mut VirtualMachine`. The handler may free the container — do not touch
/// `t` after the per-arm call returns.
#[unsafe(no_mangle)]
pub unsafe fn __bun_fire_timer(t: *mut EventLoopTimer, now: *const ElTimespec, vm: *mut ()) {
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
            #[allow(unused_variables)]
            let ($now, $vm) = (now, vm);
            // SAFETY: per fn contract; container derived from a live `$Ty`.
            #[allow(unused_unsafe)]
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
            timer_arm!(TimerCallback, event_loop_timer, |c, _now, _vm| ((*c).callback)(c))
        }
        EventLoopTimerTag::WTFTimer => {
            timer_arm!(WTFTimer, event_loop_timer, |c, now, vm| WTFTimer::fire(c, &*now, vm))
        }
        EventLoopTimerTag::AbortSignalTimeout => {
            timer_arm!(AbortSignalTimeout, event_loop_timer, |c, _now, vm| {
                AbortSignalTimeout::run(c, vm)
            })
        }
        EventLoopTimerTag::DateHeaderTimer => {
            timer_arm!(DateHeaderTimer, event_loop_timer, |c, _now, vm| (*c).run(&mut *vm))
        }
        EventLoopTimerTag::EventLoopDelayMonitor => {
            timer_arm!(EventLoopDelayMonitor, event_loop_timer, |c, now, vm| {
                (*c).on_fire(&mut *vm, &*now)
            })
        }
        EventLoopTimerTag::StatWatcherScheduler => {
            timer_arm!(StatWatcherScheduler, event_loop_timer, |c, _now, _vm| (*c).timer_callback())
        }
        EventLoopTimerTag::UpgradedDuplex => {
            timer_arm!(UpgradedDuplex, event_loop_timer, |c, _now, _vm| (*c).on_timeout())
        }
        // R-2: shared deref — `check_timeouts` re-enters via `ares_process_fd`.
        EventLoopTimerTag::DNSResolver => timer_arm!(DNSResolver, event_loop_timer, |c, now, vm| {
            (&*c.cast_const()).check_timeouts(&*now, &*vm)
        }),
        EventLoopTimerTag::WindowsNamedPipe => {
            #[cfg(windows)]
            {
                let container = owner!(WindowsNamedPipe, event_loop_timer);
                // SAFETY: per fn contract.
                unsafe { (*container).on_timeout() };
            }
            #[cfg(not(windows))]
            {
                // Spec: `UnreachableTimer` on non-Windows.
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
            timer_arm!(Valkey, reconnect_timer, |c, _now, _vm| (*c).on_reconnect_timer())
        }
        EventLoopTimerTag::SubprocessTimeout => {
            timer_arm!(Subprocess<'_>, event_loop_timer, |c, _now, _vm| (*c).timeout_callback())
        }
        EventLoopTimerTag::DevServerSweepSourceMaps => {
            // Spec: `bun.bake.DevServer.SourceMapStore.sweepWeakRefs(self, now)`
            // — takes the raw `*EventLoopTimer` and recovers the store inside.
            // SAFETY: per fn contract.
            SourceMapStore::sweep_weak_refs(t, unsafe { &*now });
        }
        EventLoopTimerTag::DevServerMemoryVisualizerTick => {
            // SAFETY: per fn contract; `t` is the `memory_visualizer_timer`
            // field of a live DevServer.
            DevServer::emit_memory_visualizer_message_timer(unsafe { &mut *t }, unsafe { &*now });
        }
        EventLoopTimerTag::BunTest => {
            // Spec: `BunTestPtr.cloneFromRawUnsafe(@fieldParentPtr("timer", self))`
            // — bumps the Rc refcount around the callback so the timer can
            // safely re-enter `BunTest::run`.
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
                let cloned = rc.clone();
                // Don't drop the original ref — it's borrowed, not owned here.
                let _ = std::rc::Rc::into_raw(rc);
                cloned
            };
            // SAFETY: per fn contract. `bun_test_timeout_callback` takes a
            // `&bun_core::Timespec`; the low-tier `EventLoopTimer::Timespec` is
            // a layout-identical local stub (see EventLoopTimer.rs TODO(b1)).
            let now_core = unsafe {
                bun_core::Timespec {
                    sec: (*now).sec,
                    nsec: (*now).nsec,
                }
            };
            BunTest::bun_test_timeout_callback(strong, &now_core, VirtualMachine::get());
        }
        EventLoopTimerTag::CronJob => timer_arm!(CronJob, event_loop_timer, |c, _now, _vm| {
            CronJob::on_timer_fire(c, VirtualMachine::get())
        }),
    }
}

/// `__bun_js_timer_epoch` body — the tag→`container_of` read for
/// [`EventLoopTimer::js_timer_epoch`]. Spec EventLoopTimer.zig
/// `jsTimerInternalsFlags` (returns `internals.flags.epoch` for the three
/// JS-timer container types, else null). Sits on the heap-compare hot path
/// (`EventLoopTimer::less` → `TimerHeap` meld).
///
/// # Safety
/// `t` points at a live [`EventLoopTimer`] currently linked into a `TimerHeap`.
#[unsafe(no_mangle)]
pub unsafe fn __bun_js_timer_epoch(
    _tag: EventLoopTimerTag,
    t: *const EventLoopTimer,
) -> Option<u32> {
    // SAFETY: per fn contract — `t` is live in a `TimerHeap`. `_tag` kept for
    // the `extern "Rust"` ABI in `bun_event_loop`; helper re-reads `(*t).tag`
    // (same address the caller loaded it from — folds under LTO).
    unsafe { crate::timer::js_timer_flags_ptr(t).map(|p| (*p.as_ptr()).epoch()) }
}

/// `__bun_tick_queue_with_count` body — declared `extern "Rust"` in
/// `bun_jsc::event_loop`. `el` is the queue to drain (Zig
/// `tickQueueWithCount(this, ...)`); for `SpawnSyncEventLoop.tickTasksOnly`
/// this is the isolated loop, **not** `vm.event_loop()`.
#[unsafe(no_mangle)]
pub fn __bun_tick_queue_with_count(
    el: *mut EventLoop,
    vm: *mut bun_jsc::virtual_machine::VirtualMachine,
    counter: &mut u32,
) -> Result<(), JsTerminated> {
    // SAFETY: `el`/`vm` are live per caller contract; no other `&mut` to either
    // is held across this call.
    let (el, vm_ref) = unsafe { (&mut *el, &mut *vm) };
    tick_queue_with_count(el, vm_ref, counter)
}

// (former duplicate `__bun_run_tasks` removed r6 — `bun_jsc::task::run_tasks`
// had no callers; `__bun_tick_queue_with_count` above is the sole entry point.)

// ported from: src/jsc/Task.zig
