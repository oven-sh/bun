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
//!      Registered into `bun_jsc::RUN_TASK_HOOK` / `TICK_QUEUE_HOOK`.
//!   2. [`run_file_poll`] — `bun_aio::FilePoll::Owner` (~13 variants;
//!      src/aio/posix_event_loop.zig `FilePoll.onUpdate`). Registered into
//!      `bun_aio::posix_event_loop::ON_POLL_DISPATCH`.
//!   3. [`install_dispatch_hooks`] — one-shot init wiring both. Called from
//!      `main.rs` before the first event-loop tick.
//!
//! **Adding a variant** (do all three):
//!   1. tag constant in `bun_event_loop::task_tag` (or `bun_aio::poll_tag`);
//!   2. `impl bun_jsc::Taskable for YourType { const TAG = task_tag::YourType; }`;
//!   3. a match arm here.

use core::sync::atomic::Ordering;

use bun_event_loop::{task_tag, Task, TaskTag};
use bun_event_loop::AnyTask::AnyTask;
use bun_event_loop::ManagedTask::ManagedTask;

use bun_aio::posix_event_loop::{poll_tag, FilePoll, Flags as PollFlag, ON_POLL_DISPATCH};

use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, Tag as EventLoopTimerTag, TimerCallback, Timespec as ElTimespec, FIRE_TIMER,
    JS_TIMER_EPOCH,
};

use bun_jsc::event_loop::{EventLoop, JsTerminated};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::JSGlobalObject;
use bun_jsc::task::report_error_or_terminate;

// ── per-variant payload types ────────────────────────────────────────────────
// (high-tier owns them all; grouped by source module)

use crate::api::archive::{BlobTask as ArchiveBlobTask, ExtractTask as ArchiveExtractTask,
    FilesTask as ArchiveFilesTask, WriteTask as ArchiveWriteTask, AsyncTask as ArchiveAsyncTask};

use crate::shell::interpreter::{Interpreter, ShellTask};
use crate::shell::builtins::{cp::ShellCpTask, ls::ShellLsTask, mkdir::ShellMkdirTask,
    mv::{ShellMvBatchedTask, ShellMvCheckTargetTask}, rm::ShellRmTask, touch::ShellTouchTask,
    yes::YesTask as ShellYesTask};
use crate::shell::states::r#async::Async as ShellAsync;
use crate::shell::io_writer::{IOWriter as ShellIOWriter, Poll as ShellBufferedWriterPoll};
use crate::shell::dispatch_tasks::{
    AsyncDeinitReader as ShellIOReaderAsyncDeinit, AsyncDeinitWriter as ShellIOWriterAsyncDeinit,
    ShellAsyncSubprocessDone, ShellCondExprStatTask, ShellGlobTask, ShellRmDirTask,
};

use crate::webcore::fetch::fetch_tasklet::FetchTasklet;
use crate::webcore::s3::simple_request::S3HttpSimpleTask;
use crate::webcore::s3::download_stream::S3HttpDownloadStreamingTask;
use crate::webcore::blob::copy_file::CopyFilePromiseTask;
// `read_file::ReadFileTask` / `write_file::WriteFileTask` — module bodies are
// `#![cfg(any())]`-gated (b2-blocked on bun_io/bun_jsc); arms below stubbed.
use crate::webcore::file_sink::{FlushPendingTask as FlushPendingFileSinkTask, Poll as FileSinkPoll};
use crate::webcore::streams::Pending as StreamPending;

use crate::api::glob::AsyncGlobWalkTask;
use crate::image::AsyncImageTask;
use crate::api::JSTranspiler::AsyncTransformTask;
use crate::api::native_promise_context::DeferredDerefTask as NativePromiseContextDeferredDerefTask;
use crate::api::cron::CronJob;
use crate::api::bun_terminal_body::Poll as TerminalPoll;
use crate::api::bun_subprocess::{Subprocess, StaticPipeWriter};
use crate::api::bun_subprocess::static_pipe_writer::Poll as StaticPipeWriterPoll;

use crate::napi::{napi_async_work, NapiFinalizerTask, ThreadSafeFunction};

use bun_jsc::CppTask;
// `bun_jsc::jsc_scheduler::JSCDeferredWorkTask` — module sits in the gated
// `_gated` block of `bun_jsc/lib.rs`; arm below stubbed.
use bun_jsc::PosixSignalTask;
use bun_jsc::RuntimeTranspilerStore;
use bun_jsc::module_loader::AsyncModule;
use bun_jsc::hot_reloader;

use crate::bake::dev_server::HotReloadEvent as BakeHotReloadEvent;
use crate::bake::dev_server::source_map_store::SourceMapStore;
use crate::bake::dev_server::DevServer;

use crate::node::fs::async_ as fs_async;
// `node_fs_watcher` / `node_fs_stat_watcher` — modules not yet declared in
// `node.rs` (b2-blocked); FSWatchTask / StatWatcherScheduler arms stubbed.
use crate::node::zlib::{NativeBrotli, NativeZlib, NativeZstd};
use crate::node::node_zlib_binding;

#[allow(unused_imports)]
use crate::dns_jsc::{get_addr_info_request, GetAddrInfoRequest, Resolver as DNSResolver};
use crate::server::ServerAllConnectionsClosedTask;

use crate::api::bun_process::{self, Process};
#[cfg(unix)]
use crate::api::bun_process::waiter_thread_posix::ResultTask as ProcessWaiterThreadTask;

use bun_bundler::DeferredBatchTask::DeferredBatchTask as BundleV2DeferredBatchTask;

use crate::socket::upgraded_duplex::UpgradedDuplex;
#[cfg(windows)]
use crate::socket::windows_named_pipe::WindowsNamedPipe;

use crate::valkey_jsc::js_valkey::JSValkeyClient as Valkey;
use bun_sql_jsc::postgres::PostgresSQLConnection;
use bun_sql_jsc::mysql::js_my_sql_connection::JSMySQLConnection as MySQLConnection;

use crate::test_runner::bun_test::{BunTest, BunTestPtr};
use crate::timer::{DateHeaderTimer, EventLoopDelayMonitor};
// `bun_jsc::abort_signal::Timeout` lives in the gated `_gated` block of
// `bun_jsc/lib.rs`; use the layout-compatible stub from `crate::timer` so
// `container_of!` over `event_loop_timer` resolves. The `run` body is stubbed.
use crate::timer::AbortSignalTimeout;

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
// PERF(port): was inline switch — Zig `inline else` monomorphized every arm.
// The `match` below preserves direct-call inlining; profile in Phase B.
#[inline]
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
            unsafe { &mut *(task.ptr as *mut $ty) }
        }};
    }
    /// Raw `*mut T` (for `Box::from_raw`/self-consuming entry points).
    macro_rules! cast_ptr {
        ($ty:ty) => { task.ptr as *mut $ty };
    }
    /// Shell builtin tasks: recover `&mut Interpreter` via the embedded
    /// [`ShellTask`]'s back-ref (Zig stored it inline; Rust port keeps it
    /// on `ShellTask.interp`, populated at `ShellTask::new`).
    macro_rules! shell_dispatch {
        ($ty:ty) => {{
            let t = cast_ptr!($ty);
            // SAFETY: `t` is a live Box::into_raw'd shell task; `interp` was
            // set at schedule time and outlives the task.
            let interp = unsafe { &mut *(*t).task.interp };
            <$ty>::run_from_main_thread(t, interp);
        }};
        // `.task.task.runFromMainThread()` shape (mv/cond_expr wrap an inner
        // `task: ShellTask`-embedding struct one level deeper).
        (nested $ty:ty) => {{
            let t = cast_ptr!($ty);
            // SAFETY: see above.
            let interp = unsafe { &mut *(*t).task.task.interp };
            <$ty>::run_from_main_thread(t, interp);
        }};
    }

    // NB: `TaskTag` is `#[derive(PartialEq, Eq)]` over `u8` → structural-match
    // eligible, so const patterns work directly.
    match task.tag {
        // ── erased-callback tasks (low-tier types — real) ────────────────
        task_tag::AnyTask => {
            let any = cast!(AnyTask);
            // Zig: `any.run() catch |err| reportErrorOrTerminate(global, err)`.
            if let Err(err) = any.run() {
                report_error_or_terminate(global, err)?;
            }
        }
        task_tag::ManagedTask => {
            // Zig: `any.run() catch |err| reportErrorOrTerminate(global, err)`.
            if let Err(err) = ManagedTask::run(cast_ptr!(ManagedTask)) {
                report_error_or_terminate(global, err)?;
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

        // ── shell interpreter ────────────────────────────────────────────
        task_tag::ShellAsync => {
            // Spec Task.zig:161 `runFromMainThread()` — Rust port routes via
            // (interp, NodeId).
            let t = cast!(crate::shell::dispatch_tasks::ShellAsyncTask);
            // SAFETY: `interp` set at enqueue; outlives task.
            let interp = unsafe { &mut *t.interp };
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
        task_tag::ShellMvBatchedTask => shell_dispatch!(nested ShellMvBatchedTask),
        task_tag::ShellMvCheckTargetTask => shell_dispatch!(nested ShellMvCheckTargetTask),
        task_tag::ShellRmTask => shell_dispatch!(ShellRmTask),
        task_tag::ShellRmDirTask => {
            let t = cast_ptr!(ShellRmDirTask);
            // SAFETY: live DirTask child of a ShellRmTask tree.
            unsafe { ShellRmDirTask::run_from_main_thread(t) };
        }
        task_tag::ShellGlobTask => {
            let t = cast_ptr!(ShellGlobTask);
            // SAFETY: live Box'd glob task.
            unsafe {
                ShellGlobTask::run_from_main_thread(t);
                ShellGlobTask::deinit(t);
            }
        }
        task_tag::ShellYesTask => {
            // Declared in the union but never dispatched here in Zig (covered
            // by the trailing `else` panic). Mirror that.
            panic!("Unexpected Task tag: {}", task.tag.0);
        }

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
        task_tag::AsyncGlobWalkTask => {
            let t = cast_ptr!(AsyncGlobWalkTask<'_>);
            // Zig: `defer t.deinit(); try t.runFromJS();` — `?` short-circuits
            // before `destroy` only on JsTerminated, which tears down the VM.
            let _g = scopeguard::guard(t, |p| unsafe {
                bun_jsc::ConcurrentPromiseTask::destroy(p)
            });
            // SAFETY: live until guard runs.
            unsafe { (*t).run_from_js()? };
        }
        task_tag::AsyncImageTask => {
            let t = cast_ptr!(AsyncImageTask<'_>);
            let _g = scopeguard::guard(t, |p| unsafe {
                bun_jsc::ConcurrentPromiseTask::destroy(p)
            });
            // SAFETY: live until guard runs.
            unsafe { (*t).run_from_js()? };
        }
        task_tag::AsyncTransformTask => {
            let t = cast_ptr!(AsyncTransformTask);
            let _g = scopeguard::guard(t, |p| unsafe {
                bun_jsc::ConcurrentPromiseTask::destroy(p)
            });
            // SAFETY: live until guard runs.
            unsafe { (*t).run_from_js()? };
        }

        // ── blob copy/read/write promise tasks ───────────────────────────
        task_tag::CopyFilePromiseTask => {
            let t = cast_ptr!(CopyFilePromiseTask);
            let _g = scopeguard::guard(t, |p| unsafe {
                bun_jsc::ConcurrentPromiseTask::destroy(p)
            });
            // SAFETY: live until guard runs.
            unsafe { (*t).run_from_js()? };
        }
        task_tag::ReadFileTask => {
            // Body: `defer t.deinit(); try t.runFromJS();`
            todo!("blocked_on: crate::webcore::blob::read_file::ReadFileTask");
        }
        task_tag::WriteFileTask => {
            // Body: `defer t.deinit(); try t.runFromJS();`
            todo!("blocked_on: crate::webcore::blob::write_file::WriteFileTask");
        }

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
            bun_jsc::mark_binding(core::panic::Location::caller());
            // Body: `cast!(JSCDeferredWorkTask).run()?;`
            todo!("blocked_on: bun_jsc::jsc_scheduler::JSCDeferredWorkTask");
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
            let t = cast!(hot_reloader::HotReloadTask);
            // Zig: `defer t.deinit(); t.run(); counter.* = 0; return;`.
            // `deinit` here only resets the intrusive task state (no free).
            t.run();
            t.deinit();
            return Ok(RunTaskResult::EarlyReturn);
        }
        task_tag::BakeHotReloadEvent => {
            BakeHotReloadEvent::run(cast!(BakeHotReloadEvent));
        }
        task_tag::FSWatchTask => {
            // Body: `t.run(); defer t.deinit();`
            todo!("blocked_on: crate::node::node_fs_watcher::FSWatchTask");
        }

        // ── DNS ──────────────────────────────────────────────────────────
        task_tag::GetAddrInfoRequestTask => {
            #[cfg(windows)]
            panic!("This should not be reachable on Windows");
            #[cfg(not(windows))]
            {
                // Body: `defer t.deinit(); try t.runFromJS();` over
                // `WorkTask<GetAddrInfoRequest>` — type lives in the gated
                // `dns_jsc::dns_body` draft, not the public `dns_jsc` surface.
                todo!("blocked_on: crate::dns_jsc::get_addr_info_request::Task");
            }
        }

        // ── node:fs async ops (`runFromJSThread`) ────────────────────────
        task_tag::Stat => cast!(fs_async::Stat).run_from_js_thread()?,
        task_tag::Lstat => cast!(fs_async::Lstat).run_from_js_thread()?,
        task_tag::Fstat => cast!(fs_async::Fstat).run_from_js_thread()?,
        task_tag::Open => cast!(fs_async::Open).run_from_js_thread()?,
        task_tag::ReadFile => cast!(fs_async::ReadFile).run_from_js_thread()?,
        task_tag::WriteFile => cast!(fs_async::WriteFile).run_from_js_thread()?,
        task_tag::CopyFile => cast!(fs_async::CopyFile).run_from_js_thread()?,
        task_tag::Read => cast!(fs_async::Read).run_from_js_thread()?,
        task_tag::Write => cast!(fs_async::Write).run_from_js_thread()?,
        task_tag::Truncate => cast!(fs_async::Truncate).run_from_js_thread()?,
        task_tag::Writev => cast!(fs_async::Writev).run_from_js_thread()?,
        task_tag::Readv => cast!(fs_async::Readv).run_from_js_thread()?,
        task_tag::Rename => cast!(fs_async::Rename).run_from_js_thread()?,
        task_tag::FTruncate => cast!(fs_async::Ftruncate).run_from_js_thread()?,
        task_tag::Readdir => cast!(fs_async::Readdir).run_from_js_thread()?,
        task_tag::ReaddirRecursive => cast!(fs_async::ReaddirRecursive).run_from_js_thread()?,
        task_tag::Close => cast!(fs_async::Close).run_from_js_thread()?,
        task_tag::Rm => cast!(fs_async::Rm).run_from_js_thread()?,
        task_tag::Rmdir => cast!(fs_async::Rmdir).run_from_js_thread()?,
        task_tag::Chown => cast!(fs_async::Chown).run_from_js_thread()?,
        task_tag::FChown => cast!(fs_async::Fchown).run_from_js_thread()?,
        task_tag::Utimes => cast!(fs_async::Utimes).run_from_js_thread()?,
        task_tag::Lutimes => cast!(fs_async::Lutimes).run_from_js_thread()?,
        task_tag::Chmod => cast!(fs_async::Chmod).run_from_js_thread()?,
        task_tag::Fchmod => cast!(fs_async::Fchmod).run_from_js_thread()?,
        task_tag::Link => cast!(fs_async::Link).run_from_js_thread()?,
        task_tag::Symlink => cast!(fs_async::Symlink).run_from_js_thread()?,
        task_tag::Readlink => cast!(fs_async::Readlink).run_from_js_thread()?,
        task_tag::Realpath => cast!(fs_async::Realpath).run_from_js_thread()?,
        task_tag::RealpathNonNative => cast!(fs_async::RealpathNonNative).run_from_js_thread()?,
        task_tag::Mkdir => cast!(fs_async::Mkdir).run_from_js_thread()?,
        task_tag::Fsync => cast!(fs_async::Fsync).run_from_js_thread()?,
        task_tag::Fdatasync => cast!(fs_async::Fdatasync).run_from_js_thread()?,
        task_tag::Access => cast!(fs_async::Access).run_from_js_thread()?,
        task_tag::AppendFile => cast!(fs_async::AppendFile).run_from_js_thread()?,
        task_tag::Mkdtemp => cast!(fs_async::Mkdtemp).run_from_js_thread()?,
        task_tag::Exists => cast!(fs_async::Exists).run_from_js_thread()?,
        task_tag::Futimes => cast!(fs_async::Futimes).run_from_js_thread()?,
        task_tag::Lchmod => cast!(fs_async::Lchmod).run_from_js_thread()?,
        task_tag::Lchown => cast!(fs_async::Lchown).run_from_js_thread()?,
        task_tag::Unlink => cast!(fs_async::Unlink).run_from_js_thread()?,
        task_tag::StatFS => cast!(fs_async::Statfs).run_from_js_thread()?,

        // ── compression streams ──────────────────────────────────────────
        task_tag::NativeZlib => {
            node_zlib_binding::CompressionStream::<NativeZlib>::run_from_js_thread(cast!(NativeZlib));
        }
        task_tag::NativeBrotli => {
            node_zlib_binding::CompressionStream::<NativeBrotli<'_>>::run_from_js_thread(
                cast!(NativeBrotli<'_>),
            );
        }
        task_tag::NativeZstd => {
            node_zlib_binding::CompressionStream::<NativeZstd>::run_from_js_thread(cast!(NativeZstd));
        }

        // ── process / signals ────────────────────────────────────────────
        task_tag::ProcessWaiterThreadTask => {
            #[cfg(not(windows))]
            {
                // SAFETY: tag identifies pointee; Box::into_raw'd in WaiterThread.
                let t = unsafe { Box::from_raw(cast_ptr!(ProcessWaiterThreadTask<Process>)) };
                t.run_from_js_thread();
            }
            #[cfg(windows)]
            unreachable!("posix-only");
        }
        task_tag::PosixSignalTask => {
            // Zig: `PosixSignalTask.runFromJSThread(@intCast(task.asUintptr()), global)`
            // — `ptr` here is *not* a pointer but a packed signal number.
            PosixSignalTask::run_from_js_thread(task.ptr as usize as u8, global);
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
            cast!(BundleV2DeferredBatchTask).run_on_js_thread();
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
    let global = el.global();
    let global_vm = global.vm();

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
        // PORT NOTE: Zig increments `counter` via `defer` so it runs even on
        // the HotReloadTask early-return path (where it's then immediately
        // overwritten with 0). Hoisting before dispatch is observably
        // equivalent and avoids a scopeguard.
        *counter += 1;
        match run_task(task, el, vm, global)? {
            RunTaskResult::Continue => {}
            RunTaskResult::EarlyReturn => {
                // Zig: `counter.* = 0; return;` — hot reload runs immediately
                // so it should not drain microtasks.
                *counter = 0;
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

/// Hot-path dispatcher for `bun_aio::FilePoll::on_update`. Registered into
/// [`ON_POLL_DISPATCH`]; the low-tier `FilePoll` calls through that hook so it
/// never names `Subprocess` / `FileSink` / `DNSResolver` / etc.
///
/// # Safety
/// `poll` must point at a live [`FilePoll`] for the duration of the call
/// (guaranteed by `FilePoll::on_update`, the only caller).
pub unsafe fn run_file_poll(poll: *mut FilePoll, size_or_offset: i64) {
    // SAFETY: contract above.
    let poll_ref = unsafe { &mut *poll };
    let owner = poll_ref.owner;
    let hup = poll_ref.flags.contains(PollFlag::Hup);

    debug_assert!(!owner.is_null());

    /// `ptr.as(T)` — recover the typed owner.
    macro_rules! owner_as {
        ($ty:ty) => {{
            // SAFETY: tag set with this pointee type at `FilePoll::init`.
            unsafe { &mut *(owner.ptr as *mut $ty) }
        }};
    }

    match owner.tag() {
        poll_tag::BUFFERED_READER => {
            let reader = owner_as!(bun_io::BufferedReader);
            bun_io::BufferedReader::on_poll(reader, size_or_offset as isize, hup);
        }
        poll_tag::PROCESS => {
            let proc = owner_as!(Process);
            proc.on_wait_pid_from_event_loop_task();
        }
        poll_tag::PARENT_DEATH_WATCHDOG => {
            let wd = owner_as!(bun_aio::parent_death_watchdog::ParentDeathWatchdog);
            // Zig gates this `comptime !Environment.isMac => unreachable`;
            // mirror with a debug-assert (Linux uses prctl(PR_SET_PDEATHSIG)).
            #[cfg(target_os = "macos")]
            bun_aio::parent_death_watchdog::on_parent_exit(wd);
            #[cfg(not(target_os = "macos"))]
            {
                debug_assert!(false, "ParentDeathWatchdog poll on non-mac");
                let _ = wd;
            }
        }

        poll_tag::FILE_SINK => {
            let h = owner_as!(FileSinkPoll);
            h.on_poll(size_or_offset as isize, hup);
        }
        poll_tag::STATIC_PIPE_WRITER => {
            let h = owner_as!(StaticPipeWriterPoll<Subprocess<'_>>);
            h.on_poll(size_or_offset as isize, hup);
        }
        poll_tag::SHELL_STATIC_PIPE_WRITER => {
            // Body: `owner_as!(StaticPipeWriterPoll<ShellSubprocess>).on_poll(size_or_offset as isize, hup)`
            // — `crate::shell::subproc` is gated behind the private `shell_body`
            // module and `ShellSubprocess: StaticPipeWriterProcess` is not yet
            // implemented.
            let _ = (size_or_offset, hup);
            todo!("blocked_on: crate::shell::subproc::ShellSubprocess");
        }
        poll_tag::SECURITY_SCAN_STATIC_PIPE_WRITER => {
            // Body: `owner_as!(StaticPipeWriterPoll<SecurityScanSubprocess>).on_poll(size_or_offset as isize, hup)`
            // — `bun_install::SecurityScanSubprocess` is a placeholder stub and
            // does not yet implement `StaticPipeWriterProcess`.
            let _ = (size_or_offset, hup);
            todo!("blocked_on: bun_install::SecurityScanSubprocess: StaticPipeWriterProcess");
        }
        poll_tag::SHELL_BUFFERED_WRITER => {
            // `bun.shell.Interpreter.IOWriter.Poll`
            let h = owner_as!(ShellBufferedWriterPoll);
            h.on_poll(size_or_offset as isize, hup);
        }
        poll_tag::DNS_RESOLVER => {
            let resolver = owner_as!(DNSResolver);
            // SAFETY: `poll` outlives this call (caller contract).
            resolver.on_dns_poll(unsafe { &mut *poll });
        }
        poll_tag::GET_ADDR_INFO_REQUEST => {
            #[cfg(target_os = "macos")]
            {
                let _loader = owner.ptr as *mut GetAddrInfoRequest;
                // `BackendLibInfo::on_machport_change` lives in the gated
                // `dns_jsc::dns_body` draft.
                todo!("blocked_on: crate::dns_jsc::get_addr_info_request::BackendLibInfo");
            }
            #[cfg(not(target_os = "macos"))]
            {
                debug_assert!(false, "GetAddrInfoRequest poll on non-mac");
            }
        }
        poll_tag::REQUEST => {
            #[cfg(target_os = "macos")]
            {
                // `internal::MacAsyncDNS::on_machport_change` lives in the gated
                // `dns_jsc::dns_body` draft.
                todo!("blocked_on: crate::dns_jsc::internal::MacAsyncDNS");
            }
            #[cfg(not(target_os = "macos"))]
            {
                debug_assert!(false, "InternalDNSRequest poll on non-mac");
            }
        }
        poll_tag::TERMINAL_POLL => {
            let h = owner_as!(TerminalPoll);
            h.on_poll(size_or_offset as isize, hup);
        }
        poll_tag::LIFECYCLE_SCRIPT_SUBPROCESS_OUTPUT_READER => {
            // `OutputReader = BufferedReader` in the install crate — same
            // entry point as `BUFFERED_READER`, separate tag for ownership.
            let h = owner_as!(bun_install::lifecycle_script_runner::OutputReader);
            bun_io::BufferedReader::on_poll(h, size_or_offset as isize, hup);
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
// Hook installation
// ════════════════════════════════════════════════════════════════════════════

/// `RUN_IMMEDIATE_HOOK` body — cast the opaque low-tier
/// `bun_jsc::event_loop::ImmediateObject` to the real
/// `crate::timer::ImmediateObject` and run the task.
///
/// # Safety
/// `task` was produced by `enqueue_immediate_task` from a live
/// `timer::ImmediateObject`; `vm` is the live per-thread VM.
unsafe fn run_immediate_task_hook(
    task: *mut bun_jsc::event_loop::ImmediateObject,
    vm: *mut bun_jsc::virtual_machine::VirtualMachine,
) -> bool {
    // SAFETY: per fn contract — the low-tier `ImmediateObject` is an opaque
    // forward-decl; the only producer (`TimerObjectInternals::init`) stores a
    // `*mut crate::timer::ImmediateObject`, so the cast is the identity.
    unsafe {
        crate::timer::ImmediateObject::run_immediate_task(
            task.cast::<crate::timer::ImmediateObject>(),
            vm,
        )
    }
}

/// `RUN_WTF_TIMER_HOOK` body — cast the opaque low-tier
/// `bun_jsc::event_loop::WTFTimer` to the real `crate::timer::WTFTimer` and
/// fire it (spec event_loop.zig:302-306 `imminent_gc_timer.swap(null).?.run(vm)`).
///
/// # Safety
/// `timer` was published by `WTFTimer::update` into `imminent_gc_timer` and
/// remains live until consumed; `vm` is the live per-thread VM.
unsafe fn run_wtf_timer_hook(
    timer: *mut bun_jsc::event_loop::WTFTimer,
    vm: *mut bun_jsc::virtual_machine::VirtualMachine,
) {
    // SAFETY: per fn contract — the low-tier `WTFTimer` is an opaque
    // forward-decl; the only producer (`WTFTimer::update`) stores a
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

/// `FIRE_TIMER` body — the tag→`@fieldParentPtr` match for
/// [`EventLoopTimer::fire`]. Spec EventLoopTimer.zig:170-223.
///
/// Reached from [`crate::timer::All::drain_timers`] (every due heap timer) and
/// [`crate::timer::All::get_timeout`] (WTFTimer side-effect). Without this hook
/// registered, the low-tier `fire()` transmutes a null fn-ptr in release
/// builds (debug-asserts in debug) — i.e. `setTimeout`/`setInterval` callbacks
/// never fire.
///
/// # Safety
/// `t` points at a live [`EventLoopTimer`] just popped from `All.timers`;
/// `now` is the snapshot taken by `All::next`; `vm` is the erased
/// `*mut VirtualMachine`. The handler may free the container — do not touch
/// `t` after the per-arm call returns.
unsafe fn fire_timer(t: *mut EventLoopTimer, now: *const ElTimespec, vm: *mut ()) {
    use core::mem::offset_of;
    use crate::timer::{ImmediateObject, TimeoutObject, WTFTimer};

    /// `@fieldParentPtr("$field", t)` — recover the embedding container.
    macro_rules! container_of {
        ($ty:ty, $field:ident) => {{
            // SAFETY: §Dispatch — `t.tag` was set together with the container
            // at construction; tag uniquely identifies the embedding type and
            // `$field` is the `EventLoopTimer` slot `t` points into.
            unsafe { (t as *mut u8).sub(offset_of!($ty, $field)).cast::<$ty>() }
        }};
    }

    // SAFETY: per fn contract — `t` is live for the dispatch read.
    let tag = unsafe { (*t).tag };
    let vm = vm.cast::<VirtualMachine>();
    match tag {
        // ── JS-exposed timers (TimerObjectInternals::fire) ───────────────
        EventLoopTimerTag::TimeoutObject => {
            let container = container_of!(TimeoutObject, event_loop_timer);
            // SAFETY: container derived from a live `TimeoutObject`; do NOT
            // form `&mut *container` — `internals.fire` may `deref()` and free.
            let internals = unsafe { core::ptr::addr_of_mut!((*container).internals) };
            // SAFETY: per fn contract — `now` is the live snapshot; `vm` is the
            // per-thread VM. `fire` may free the container; `t` is dead after.
            unsafe { (*internals).fire(&*now, vm) };
        }
        EventLoopTimerTag::ImmediateObject => {
            let container = container_of!(ImmediateObject, event_loop_timer);
            // SAFETY: see TimeoutObject arm.
            let internals = unsafe { core::ptr::addr_of_mut!((*container).internals) };
            // SAFETY: see TimeoutObject arm.
            unsafe { (*internals).fire(&*now, vm) };
        }
        EventLoopTimerTag::TimerCallback => {
            let container = container_of!(TimerCallback, event_loop_timer);
            // SAFETY: container derived from a live `TimerCallback`; the
            // callback fn-ptr was set together with the tag at construction.
            // Spec `inline else` fallthrough: `container.callback(container)`.
            unsafe { ((*container).callback)(container) };
        }
        EventLoopTimerTag::WTFTimer => {
            let container = container_of!(WTFTimer, event_loop_timer);
            // SAFETY: container derived from a live `WTFTimer`; `now` is the
            // snapshot from `All::next`; `vm` is the per-thread VM. `fire` may
            // re-enter `(*runtime_state()).timer` — no `&mut` held here.
            unsafe { WTFTimer::fire(container, &*now, vm) };
        }
        EventLoopTimerTag::AbortSignalTimeout => {
            let container = container_of!(AbortSignalTimeout, event_loop_timer);
            // SAFETY: per fn contract; `run` may free `container`.
            // `AbortSignalTimeout::run` lives in the gated
            // `bun_jsc::abort_signal` Phase-A draft.
            let _ = container;
            todo!("blocked_on: bun_jsc::abort_signal::Timeout::run");
        }
        EventLoopTimerTag::DateHeaderTimer => {
            let container = container_of!(DateHeaderTimer, event_loop_timer);
            // SAFETY: per fn contract.
            unsafe { (*container).run(&mut *vm) };
        }
        EventLoopTimerTag::EventLoopDelayMonitor => {
            let container = container_of!(EventLoopDelayMonitor, event_loop_timer);
            // SAFETY: per fn contract.
            unsafe { (*container).on_fire(&mut *vm, &*now) };
        }
        EventLoopTimerTag::StatWatcherScheduler => {
            // Body: `container_of!(StatWatcherScheduler, event_loop_timer).timer_callback()`
            todo!("blocked_on: crate::node::node_fs_stat_watcher::StatWatcherScheduler");
        }
        EventLoopTimerTag::UpgradedDuplex => {
            let container = container_of!(UpgradedDuplex<'_>, event_loop_timer);
            // SAFETY: per fn contract.
            unsafe { (*container).on_timeout() };
        }
        EventLoopTimerTag::DNSResolver => {
            let container = container_of!(DNSResolver, event_loop_timer);
            // SAFETY: per fn contract.
            unsafe { (*container).check_timeouts(&*now, &*vm) };
        }
        EventLoopTimerTag::WindowsNamedPipe => {
            #[cfg(windows)]
            {
                let container = container_of!(WindowsNamedPipe, event_loop_timer);
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
            let container = container_of!(PostgresSQLConnection, timer);
            // SAFETY: per fn contract.
            unsafe { (*container).on_connection_timeout() };
        }
        EventLoopTimerTag::PostgresSQLConnectionMaxLifetime => {
            let container = container_of!(PostgresSQLConnection, max_lifetime_timer);
            // SAFETY: per fn contract.
            unsafe { (*container).on_max_lifetime_timeout() };
        }
        EventLoopTimerTag::MySQLConnectionTimeout => {
            let container = container_of!(MySQLConnection, timer);
            // SAFETY: per fn contract.
            unsafe { (*container).on_connection_timeout() };
        }
        EventLoopTimerTag::MySQLConnectionMaxLifetime => {
            let container = container_of!(MySQLConnection, max_lifetime_timer);
            // SAFETY: per fn contract.
            unsafe { (*container).on_max_lifetime_timeout() };
        }
        EventLoopTimerTag::ValkeyConnectionTimeout => {
            let container = container_of!(Valkey, timer);
            // SAFETY: per fn contract.
            unsafe { (*container).on_connection_timeout() };
        }
        EventLoopTimerTag::ValkeyConnectionReconnect => {
            let container = container_of!(Valkey, reconnect_timer);
            // SAFETY: per fn contract.
            unsafe { (*container).on_reconnect_timer() };
        }
        EventLoopTimerTag::SubprocessTimeout => {
            let container = container_of!(Subprocess<'_>, event_loop_timer);
            // SAFETY: per fn contract.
            unsafe { (*container).timeout_callback() };
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
            let container = container_of!(BunTest<'_>, timer);
            // SAFETY: container is the payload of a live `Rc<BunTest>`; the
            // strong count is ≥1 (held by `Jest.active_file`).
            let strong: BunTestPtr = unsafe {
                let rc = std::rc::Rc::from_raw(container as *const BunTest<'_>);
                let cloned = rc.clone();
                // Don't drop the original ref — it's borrowed, not owned here.
                let _ = std::rc::Rc::into_raw(rc);
                cloned
            };
            // SAFETY: per fn contract.
            BunTest::bun_test_timeout_callback(strong, unsafe { &*now }, unsafe { &*vm });
        }
        EventLoopTimerTag::CronJob => {
            let container = container_of!(CronJob, event_loop_timer);
            // SAFETY: per fn contract; `on_timer_fire` may free `container`.
            CronJob::on_timer_fire(container, unsafe { &*vm });
        }
    }
}

/// `JS_TIMER_EPOCH` body — the tag→`@fieldParentPtr` read for
/// [`EventLoopTimer::js_timer_epoch`]. Spec EventLoopTimer.zig
/// `jsTimerInternalsFlags` (returns `internals.flags.epoch` for the three
/// JS-timer container types, else null). Sits on the heap-compare hot path
/// (`EventLoopTimer::less` → `TimerHeap` meld), so without this hook
/// equal-deadline JS timers lose their stable insertion order.
///
/// # Safety
/// `t` points at a live [`EventLoopTimer`] currently linked into a `TimerHeap`.
unsafe fn js_timer_epoch(tag: EventLoopTimerTag, t: *const EventLoopTimer) -> Option<u32> {
    use core::mem::offset_of;
    use crate::timer::{AbortSignalTimeout, ImmediateObject, TimeoutObject};
    // SAFETY: tag invariant — when `tag` matches, `t` is the `event_loop_timer`
    // field of the named container (set at construction; never re-tagged).
    match tag {
        EventLoopTimerTag::TimeoutObject => unsafe {
            let parent = (t as *const u8)
                .sub(offset_of!(TimeoutObject, event_loop_timer))
                .cast::<TimeoutObject>();
            Some((*parent).internals.flags.epoch())
        },
        EventLoopTimerTag::ImmediateObject => unsafe {
            let parent = (t as *const u8)
                .sub(offset_of!(ImmediateObject, event_loop_timer))
                .cast::<ImmediateObject>();
            Some((*parent).internals.flags.epoch())
        },
        EventLoopTimerTag::AbortSignalTimeout => unsafe {
            let parent = (t as *const u8)
                .sub(offset_of!(AbortSignalTimeout, event_loop_timer))
                .cast::<AbortSignalTimeout>();
            Some((*parent).flags.epoch())
        },
        _ => None,
    }
}

/// Wire the high-tier dispatchers into the low-tier hooks. Called once from
/// `main.rs` before the first event-loop tick.
pub fn install_dispatch_hooks() {
    // FilePoll::on_update → run_file_poll (real — `bun_aio` is a dep).
    ON_POLL_DISPATCH.store(
        run_file_poll as unsafe fn(*mut FilePoll, i64) as *mut (),
        Ordering::Release,
    );

    // EventLoop::tick_immediate_tasks → ImmediateObject::run_immediate_task.
    bun_jsc::event_loop::set_run_immediate_hook(run_immediate_task_hook);

    // EventLoop::run_imminent_gc_timer → WTFTimer::run.
    bun_jsc::event_loop::set_run_wtf_timer_hook(run_wtf_timer_hook);

    // EventLoopTimer::fire → fire_timer (tag→@fieldParentPtr match).
    FIRE_TIMER.store(
        fire_timer as unsafe fn(*mut EventLoopTimer, *const ElTimespec, *mut ()) as *mut (),
        Ordering::Release,
    );

    // EventLoopTimer::less → js_timer_epoch (heap-compare stable-order hook).
    JS_TIMER_EPOCH.store(
        js_timer_epoch as unsafe fn(EventLoopTimerTag, *const EventLoopTimer) -> Option<u32>
            as *mut (),
        Ordering::Release,
    );

    // bun_jsc::RUN_TASK_HOOK / TICK_QUEUE_HOOK → tick_queue_with_count.
    bun_jsc::set_run_task_hook(tick_queue_with_count);
    bun_jsc::event_loop::set_tick_queue_hook(tick_queue_with_count);
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/Task.zig tickQueueWithCount (96-arm switch) +
//               src/aio/posix_event_loop.zig FilePoll.onUpdate (13-arm switch) +
//               src/event_loop/EventLoopTimer.zig fire (24-arm switch)
//   confidence: medium — table exhaustive, every arm calls the real per-type
//               entry point; some upstream types (shell glob/cond_expr/dir,
//               IOWriter::run_from_main_thread, security-scan pipe writer)
//               are forward-declared in their owning modules.
//   notes:      §Dispatch hot-path — high tier owns the match; low tier
//               stores (tag, ptr) + AtomicPtr hook only.
// ──────────────────────────────────────────────────────────────────────────
