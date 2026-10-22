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
//!   2. `impl bun_jsc::Taskable for YourType { const TAG; unsafe fn release_unrun(..); unsafe fn context(..) }`;
//!   3. a `run_task` arm and a `release_task_unrun` arm here, both through
//!      `in_features!` if only code of removable features (`src/trim/features`)
//!      queues it;
//!   4. bump the `task_tag::COUNT` assertion below.

// Flat re-export landing pad for `generated_js2native.rs` thunks. Kept in a
// sibling file so this hot-path module stays focused on the task/timer/poll
// match loops.
#[path = "dispatch_js2native.rs"]
pub(crate) mod js2native;

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

/// Runs `$body` in a function of its own, which records itself as a part of each
/// feature listed. Nothing is tested at run time: `--trim` cuts the function, and
/// what only it reaches, out of an executable that has none of those features
/// left, and nothing in such an executable queues what the arm handles. List
/// every feature whose native code can queue it.
macro_rules! in_features {
    (
        [$($feature:ident),+ $(,)?],
        ($($parameter:ident: $Parameter:ty = $argument:expr),* $(,)?)
        $(-> $Result:ty)?
        $body:block
    ) => {{
        #[inline(never)]
        fn handle($($parameter: $Parameter),*) $(-> $Result)? {
            $(bun_removable_features::removable_definition!($feature, handle);)+
            $body
        }
        handle($($argument),*)
    }};
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
use crate::webcore::s3::multipart::WriterCollected as S3UploadWriterCollected;
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
use bun_sql_jsc::shared::connection_timers::TimedConnection as _;

use crate::test_runner::bun_test::{BunTest, BunTestPtr};
use crate::timer::{DateHeaderTimer, EventLoopDelayMonitor};
use bun_jsc::abort_signal::Timeout as AbortSignalTimeout;
use bun_jsc::garbage_collection_controller::GarbageCollectionController;

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
// Shell* cluster is further hoisted into [`run_shell_task`] so this
// hot dispatcher stays off its pages.
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
    /// [`in_features!`] for an arm that needs only its payload, as `$payload: *mut $Payload`.
    macro_rules! feature_arm {
        ($features:tt, |$payload:ident: $Payload:ty| $(-> $Result:ty)? $body:block) => {
            in_features!(
                $features,
                ($payload: *mut $Payload = cast_ptr!($Payload))
                $(-> $Result)?
                $body
            )
        };
    }
    /// `CompressionStream::<T>::run_from_js_thread` takes `*mut T` (full
    /// allocation provenance — R-2) so its trailing `T::deref()` may free the box.
    macro_rules! compression_arm {
        ($feature:ident, $T:ty) => {
            feature_arm!([$feature], |stream: $T| {
                // SAFETY: §Dispatch — tag identifies pointee; live m_ctx payload.
                unsafe { node_zlib_binding::CompressionStream::<$T>::run_from_js_thread(stream) };
            })
        };
    }
    // NB: `TaskTag` is `#[derive(PartialEq, Eq)]` over `u8` → structural-match
    // eligible, so const patterns work directly.
    match task.tag {
        // ── erased-callback tasks (low-tier types — real) ────────────────
        task_tag::AnyTaskJob => {
            // SAFETY: §Dispatch — `task.ptr` is a live heap `Job<C>` posted by
            // its `Completion`; the erased entry runs `then` and frees it.
            unsafe { bun_jsc::job::complete_erased(task.ptr, global) }?;
        }
        task_tag::SendQueueDeferred => feature_arm!([Ipc], |queue: crate::ipc::SendQueue| {
            // SAFETY: §Dispatch — the queued pointer is the SendQueue root and
            // the task owns a ref for its duration; `run_deferred` releases it.
            unsafe { crate::ipc::SendQueue::run_deferred(queue) };
        }),
        task_tag::AsyncModule => feature_arm!(
            [Install],
            |module: bun_jsc::async_module::AsyncModule| -> JsResult<()> {
                // SAFETY: `AsyncModule::done` boxed it; the arm consumes the box.
                let module = unsafe { bun_core::heap::take(module) };
                bun_jsc::async_module::AsyncModule::on_done(module)?;
                Ok(())
            }
        )?,
        task_tag::BundleV2PluginResolve => in_features!(
            [Bundler],
            (
                resolve: *mut bun_bundler::bundle_v2::api::JSBundler::Resolve =
                    cast_ptr!(bun_bundler::bundle_v2::api::JSBundler::Resolve),
                global: &JSGlobalObject = global,
            ) -> JsResult<()> {
                // `bun_bundler` is JSC-free; the C++ hop it calls answers the request
                // itself when the plugin throws, but can return early with an
                // exception pending (argument conversion), so check the scope here.
                bun_jsc::call_check_slow(global, || {
                    // SAFETY: tag identifies pointee — a live `Resolve` owned by the
                    // plugin dispatch chain.
                    unsafe { &mut *resolve }.run_on_js_thread()
                })?;
                Ok(())
            }
        )?,
        task_tag::BundleV2PluginLoad => in_features!(
            [Bundler],
            (
                load: *mut bun_bundler::bundle_v2::api::JSBundler::Load =
                    cast_ptr!(bun_bundler::bundle_v2::api::JSBundler::Load),
                global: &JSGlobalObject = global,
            ) -> JsResult<()> {
                // As `BundleV2PluginResolve`.
                bun_jsc::call_check_slow(global, || {
                    // SAFETY: tag identifies pointee — a live `Load` owned by the plugin
                    // dispatch chain.
                    unsafe { &mut *load }.run_on_js_thread()
                })?;
                Ok(())
            }
        )?,
        task_tag::JSBundleCompletionTask => {
            crate::api::js_bundle_completion_task::JSBundleCompletionTask::on_complete_anytask(
                cast_ptr!(crate::api::js_bundle_completion_task::JSBundleCompletionTask),
            )?;
        }
        task_tag::FetchTaskletPromiseSettle => feature_arm!(
            [Fetch],
            |holder: crate::webcore::fetch::fetch_tasklet::FetchTaskletPromiseSettle|
            -> JsResult<()> {
                // SAFETY: boxed at the fetch completion site; the arm consumes it.
                unsafe { bun_core::heap::take(holder) }.run()?;
                Ok(())
            }
        )?,
        task_tag::DuplexUpgradeContext => {
            feature_arm!([Sockets], |context: crate::socket::DuplexUpgradeContext| {
                // SAFETY: tag identifies pointee; the queue owns the live context
                // until `run_event` (which may free it).
                crate::socket::DuplexUpgradeContext::run_event(unsafe {
                    bun_ptr::ThisPtr::new(context)
                });
            })
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
            feature_arm!([Valkey], |close: crate::valkey_jsc::js_valkey::ValkeyDeferredClose| {
                // SAFETY: boxed at the enqueue site; the arm consumes it.
                unsafe { bun_core::heap::take(close) }.run();
            })
        }
        task_tag::StatWatcherTimerUpdate => feature_arm!(
            [NodeFs],
            |update: crate::node::node_fs_stat_watcher::StatWatcherTimerUpdate| {
                // SAFETY: boxed in `schedule_timer_update`; the arm consumes it.
                unsafe { bun_core::heap::take(update) }.run();
            }
        ),
        task_tag::AsyncCpTask => {
            feature_arm!([NodeFs], |copy: crate::node::fs::AsyncCpTask| -> JsResult<()> {
                // SAFETY: posted by `on_subtask_done` with the count at zero (exclusive).
                unsafe { (*copy).run_from_js_thread()? };
                Ok(())
            })?
        }
        task_tag::ShellAsyncCpTask => {
            feature_arm!([Shell], |copy: crate::node::fs::ShellAsyncCpTask| -> JsResult<()> {
                // SAFETY: as above.
                unsafe { (*copy).run_from_js_thread()? };
                Ok(())
            })?
        }
        task_tag::StatWatcherHop => feature_arm!(
            [NodeFs],
            |watcher: crate::node::node_fs_stat_watcher::StatWatcher| -> JsResult<()> {
                // SAFETY: posted by `StatWatcher::post_to_js_thread` with a ref held.
                unsafe { crate::node::node_fs_stat_watcher::StatWatcher::run_hop(watcher) }?;
                Ok(())
            }
        )?,
        task_tag::BundleV2PluginResolveAnswered => feature_arm!(
            [Bundler],
            |answered: bun_bundler::bundle_v2::api::JSBundler::ResolveAnswered| {
                // SAFETY: §Dispatch — tag identifies pointee; live for this dispatch.
                unsafe { &mut *answered }.run();
            }
        ),
        task_tag::BundleV2PluginLoadAnswered => feature_arm!(
            [Bundler],
            |answered: bun_bundler::bundle_v2::api::JSBundler::LoadAnswered| {
                // SAFETY: §Dispatch — tag identifies pointee; live for this dispatch.
                unsafe { &mut *answered }.run();
            }
        ),
        task_tag::BundleV2PluginLoadDeferred => {
            cast!(bun_bundler::bundle_v2::api::JSBundler::LoadDeferred).run();
        }
        task_tag::BundleV2ParseTaskResult => {
            feature_arm!([Bundler], |result: bun_bundler::parse_task::Result| {
                // SAFETY: boxed by the parse worker; `on_complete` consumes it.
                unsafe { bun_bundler::parse_task::on_complete(result) };
            })
        }
        task_tag::FetchTaskletRequestDrain => {
            feature_arm!([Fetch], |drain: crate::webcore::fetch::FetchTaskletRequestDrain| {
                crate::webcore::fetch::FetchTaskletRequestDrain::run(drain);
            })
        }
        task_tag::HTMLRewriterBackgroundPull => feature_arm!(
            [HtmlRewriter],
            |pipe: crate::api::html_rewriter::RewriterPipe| -> JsResult<()> {
                crate::api::html_rewriter::RewriterPipe::run_background_pull(pipe)?;
                Ok(())
            }
        )?,
        task_tag::RunTestsTask => feature_arm!(
            [Test],
            |run: crate::test_runner::bun_test::RunTestsTask| -> JsResult<()> {
                // SAFETY: boxed in `run_next_tick`; the arm consumes it.
                unsafe { bun_core::heap::take(run) }.call()?;
                Ok(())
            }
        )?,
        task_tag::ValkeyDeferredFailure => feature_arm!(
            [Valkey],
            |failure: crate::valkey_jsc::valkey::DeferredFailure| -> JsResult<()> {
                // SAFETY: boxed at the enqueue site; the arm consumes it.
                unsafe { bun_core::heap::take(failure) }.run()?;
                Ok(())
            }
        )?,
        task_tag::DnsErrorDeferred => feature_arm!(
            [Dns],
            |error: crate::dns_jsc::cares_jsc::ErrorDeferredTask| -> JsResult<()> {
                // SAFETY: boxed in `reject_later`; the arm consumes it.
                unsafe { bun_core::heap::take(error) }.run()?;
                Ok(())
            }
        )?,
        task_tag::HandledPromise => {
            // SAFETY: boxed in `handle_handled_promise`; the arm consumes it.
            unsafe {
                bun_core::heap::take(cast_ptr!(
                    bun_jsc::virtual_machine_exports::HandledPromiseTask
                ))
            }
            .run();
        }
        task_tag::GraphContextStopAgain => {
            // `ptr` packs the `ContextId`, not a pointer.
            bun_jsc::virtual_machine::GraphContextStopAgain::run(
                vm,
                bun_jsc::ContextId::from_raw(task.ptr as usize as u32),
            );
        }
        task_tag::DeadContextStopAgain => {
            // SAFETY: the VM that queued this task on its own loop.
            unsafe {
                bun_jsc::virtual_machine::DeadContextStopAgain::run(cast_ptr!(
                    bun_jsc::virtual_machine::DeadContextStopAgain
                ))
            };
        }
        task_tag::GraphContextStopAndFree => {
            // SAFETY: queued by `release_graph_context`; still registered.
            unsafe {
                bun_jsc::virtual_machine::GraphContextStopAndFree::run(
                    vm,
                    cast_ptr!(bun_jsc::virtual_machine::GraphContextStopAndFree),
                )
            };
        }
        // A server that speaks TLS was given TLS options, which is what retains `TlsSockets`.
        task_tag::HTTPAppClose => feature_arm!([Serve], |app: crate::server::AppCloseTask<false>| {
            crate::server::AppCloseTask::<false>::run(app);
        }),
        task_tag::HTTPSAppClose => {
            feature_arm!([TlsSockets], |app: crate::server::AppCloseTask<true>| {
                crate::server::AppCloseTask::<true>::run(app);
            })
        }
        task_tag::HTTPServerDeinit => {
            feature_arm!([Serve], |server: crate::server::ServerDeinitTask<false, false>| {
                // SAFETY: the unique owning server pointer `schedule_deinit` queued.
                unsafe { crate::server::ServerDeinitTask::<false, false>::run(server) };
            })
        }
        task_tag::HTTPSServerDeinit => {
            feature_arm!([TlsSockets], |server: crate::server::ServerDeinitTask<true, false>| {
                // SAFETY: the unique owning server pointer `schedule_deinit` queued.
                unsafe { crate::server::ServerDeinitTask::<true, false>::run(server) };
            })
        }
        task_tag::DebugHTTPServerDeinit => {
            feature_arm!([Serve], |server: crate::server::ServerDeinitTask<false, true>| {
                // SAFETY: the unique owning server pointer `schedule_deinit` queued.
                unsafe { crate::server::ServerDeinitTask::<false, true>::run(server) };
            })
        }
        task_tag::DebugHTTPSServerDeinit => {
            feature_arm!([TlsSockets], |server: crate::server::ServerDeinitTask<true, true>| {
                // SAFETY: the unique owning server pointer `schedule_deinit` queued.
                unsafe { crate::server::ServerDeinitTask::<true, true>::run(server) };
            })
        }
        #[cfg(windows)]
        task_tag::CopyFileWindowsMkdirp => feature_arm!(
            [Bodies],
            |copy: crate::webcore::blob::copy_file::CopyFileWindowsMkdirp<'_>| {
                // SAFETY: the live copy `on_mkdirp_complete_concurrent` posted.
                unsafe { crate::webcore::blob::copy_file::CopyFileWindowsMkdirp::run(copy) };
            }
        ),
        #[cfg(windows)]
        task_tag::WriteFileWindowsMkdirp => feature_arm!(
            [Bodies],
            |write: crate::webcore::blob::write_file::WriteFileWindowsMkdirp| {
                // SAFETY: the live write `on_mkdirp_complete_concurrent` posted.
                unsafe { crate::webcore::blob::write_file::WriteFileWindowsMkdirp::run(write) };
            }
        ),
        #[cfg(windows)]
        task_tag::ChromePipeEvent => feature_arm!(
            [WebView],
            |event: crate::webview::chrome_process::QueuedEvent| -> JsResult<()> {
                // SAFETY: boxed in `PipeEvent::post`; the arm consumes it.
                unsafe { bun_core::heap::take(event) }.deliver()?;
                Ok(())
            }
        )?,
        task_tag::CppTask => {
            cast!(CppTask).run(global)?;
        }

        // ── shell interpreter (cold — hoisted to `run_shell_task`) ───────
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
        | task_tag::ShellYesTask => run_shell_task(task),

        // ── fetch / S3 ───────────────────────────────────────────────────
        task_tag::FetchTasklet => feature_arm!([Fetch], |tasklet: FetchTasklet| -> JsResult<()> {
            // SAFETY: §Dispatch — tag identifies pointee; live for this dispatch.
            unsafe { &mut *tasklet }.on_progress_update()?;
            Ok(())
        })?,
        task_tag::FetchTaskletDeinit => {
            feature_arm!([Fetch], |hop: crate::webcore::fetch::FetchTaskletDeinitHop| {
                // SAFETY: posted by `deref_from_thread` with the last ref.
                unsafe { crate::webcore::fetch::FetchTaskletDeinitHop::run(hop) };
            })
        }
        // The payload is the heap-allocated S3 task; JS-thread dispatch
        // is the sole owner here.
        task_tag::S3HttpSimpleTask => {
            feature_arm!([S3Client], |request: S3HttpSimpleTask| -> JsResult<()> {
                S3HttpSimpleTask::on_response(request)?;
                Ok(())
            })?
        }
        task_tag::S3HttpDownloadStreamingTask => {
            feature_arm!([S3Client], |download: S3HttpDownloadStreamingTask| {
                S3HttpDownloadStreamingTask::on_response(download);
            })
        }
        task_tag::S3UploadWriterCollected => {
            feature_arm!([S3Client], |collected: S3UploadWriterCollected| -> JsResult<()> {
                S3UploadWriterCollected::run(collected)?;
                Ok(())
            })?
        }

        // ── napi ─────────────────────────────────────────────────────────
        task_tag::NapiAsyncWork => in_features!(
            [NativeAddons],
            (
                work: *mut napi_async_work = cast_ptr!(napi_async_work),
                global: &JSGlobalObject = global,
            ) -> JsResult<()> {
                // SAFETY: §Dispatch — tag identifies pointee; live for this dispatch.
                unsafe { &mut *work }.run_from_js(global)?;
                Ok(())
            }
        )?,
        task_tag::ThreadSafeFunction => {
            feature_arm!([NativeAddons], |function: ThreadSafeFunction| {
                ThreadSafeFunction::on_dispatch(function);
            })
        }
        task_tag::NapiFinalizerTask => {
            feature_arm!([NativeAddons], |finalizer: NapiFinalizerTask| -> JsResult<()> {
                NapiFinalizerTask::run_on_js_thread(finalizer)?;
                Ok(())
            })?
        }

        // ── JSC scheduler / module loader ────────────────────────────────
        task_tag::JSCDeferredWorkTask => {
            bun_jsc::mark_binding();
            cast!(JSCDeferredWorkTask).run(global)?;
        }
        task_tag::PollPendingModulesTask => {
            vm.modules.on_poll();
        }
        task_tag::RuntimeTranspilerStore => in_features!(
            [RuntimeTranspiler],
            (
                store: *mut RuntimeTranspilerStore = cast_ptr!(RuntimeTranspilerStore),
                el: &mut EventLoop = el,
                global: &JSGlobalObject = global,
                vm: &mut VirtualMachine = vm,
            ) {
                // SAFETY: §Dispatch — tag identifies pointee; live for this dispatch.
                unsafe { &mut *store }.run_from_js_thread(el.into(), global, vm.into());
            }
        ),

        // ── hot-reload (early-returns from the drain loop) ───────────────
        task_tag::HotReloadTask => {
            feature_arm!([HotReload], |reload: hot_reloader::HotReloadTask| {
                // The task was heap-allocated in `Task::enqueue`; `deinit` frees it.
                // SAFETY: tag identifies pointee; live Box'd HotReloadTask.
                unsafe { (*reload).run() };
                // SAFETY: paired with heap::alloc in `Task::enqueue`.
                unsafe { hot_reloader::HotReloadTask::deinit(reload) };
            });
            return Ok(RunTaskResult::EarlyReturn);
        }
        task_tag::WatchReloadTask => {
            feature_arm!([HotReload], |reload: hot_reloader::WatchReloadTask| {
                // SAFETY: tag identifies pointee; live Box'd WatchReloadTask.
                unsafe { (*reload).run() };
                // SAFETY: paired with heap::alloc in `Task::enqueue`.
                unsafe { hot_reloader::WatchReloadTask::deinit(reload) };
            });
            return Ok(RunTaskResult::EarlyReturn);
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
        task_tag::FSWatchTask => feature_arm!([NodeFs], |watch: FSWatchTask| -> JsResult<()> {
            // The task is heap-allocated
            // (cloned from `FSWatcher.current_task` at enqueue). `deinit` is
            // explicit (not `Drop`) so the embedded `current_task` field never
            // runs it.
            // SAFETY: tag identifies pointee; live Box'd FSWatchTask.
            let ran = unsafe { (*watch).run() };
            // SAFETY: paired with heap::alloc in `FSWatchTask::enqueue`.
            unsafe { FSWatchTask::deinit(watch) };
            ran?;
            Ok(())
        })?,

        // ── node:fs libuv-request ops (Windows) ──────────────────────────
        #[cfg(windows)]
        for_each_fs_uv_op!(__fs_pat) => {
            macro_rules! __fs_run {
                ($($tag:ident $ty:ident;)*) => { match task.tag {
                    $(task_tag::$tag => feature_arm!([NodeFs], |request: fs_async::$ty| -> JsResult<()> {
                        // SAFETY: §Dispatch — tag identifies pointee. The task frees itself, so it takes the raw pointer.
                        unsafe { fs_async::$ty::run_from_js_thread(request) }?;
                        Ok(())
                    })?,)*
                    // SAFETY: outer arm guard proves one of the table tags matched.
                    _ => unsafe { core::hint::unreachable_unchecked() },
                }};
            }
            for_each_fs_uv_op!(__fs_run);
        }

        // ── compression streams ──────────────────────────────────────────
        task_tag::NativeZlib => compression_arm!(NodeZlib, NativeZlib),
        task_tag::NativeBrotli => compression_arm!(NodeZlibBrotli, NativeBrotli),
        task_tag::NativeZstd => compression_arm!(NodeZlibZstd, NativeZstd),

        // ── process / signals ────────────────────────────────────────────
        task_tag::ProcessWaiterThreadTask => {
            #[cfg(not(windows))]
            feature_arm!([ChildProcess], |result: ProcessWaiterThreadTask<Process>| {
                // SAFETY: tag identifies pointee; heap-allocated in WaiterThread.
                unsafe { bun_core::heap::take(result) }.run_from_js_thread();
            });
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
        // One feature for each kind of context a `NativePromiseContext` cell holds.
        task_tag::NativePromiseContextDeferredDerefTask => in_features!(
            [Serve, HtmlRewriter, S3Client, Cron],
            (packed: usize = task.ptr as usize) {
                // `ptr` packs an int, not a pointer.
                NativePromiseContextDeferredDerefTask::run_from_js_thread(packed);
            }
        ),

        // ── server / bundler / streams ───────────────────────────────────
        task_tag::ServerAllConnectionsClosedTask => {
            feature_arm!([Serve], |closed: ServerAllConnectionsClosedTask| -> JsResult<()> {
                ServerAllConnectionsClosedTask::run_from_js_thread(closed)?;
                Ok(())
            })?
        }
        task_tag::BundleV2DeferredBatchTask => in_features!(
            [Bundler],
            (
                batch: *mut BundleV2DeferredBatchTask = cast_ptr!(BundleV2DeferredBatchTask),
                global: &JSGlobalObject = global,
            ) -> JsResult<()> {
                // `bun_bundler` is JSC-free so the exception-scope check is hoisted
                // to this dispatch arm; without it, `JSBundlerPlugin__drainDeferred`'s
                // THROW_SCOPE is left unchecked and trips JSC exception validation
                // at the next `drainMicrotasks` scope.
                bun_jsc::call_check_slow(global, || {
                    // SAFETY: §Dispatch — tag identifies pointee; live for this dispatch.
                    unsafe { &mut *batch }.run_on_js_thread();
                })?;
                Ok(())
            }
        )?,
        // A child's stdin pipe is a `FileSink` too, whether or not the program looks at it.
        task_tag::FlushPendingFileSinkTask => {
            feature_arm!([FileSink, Spawn, Shell], |flush: FlushPendingFileSinkTask| {
                // SAFETY: the payload is the heap-allocated task; sole owner.
                unsafe { FlushPendingFileSinkTask::run_from_js_thread(flush) };
            })
        }
        // The payload is the heap-allocated task; sole owner.
        task_tag::StreamPending => feature_arm!([WebStreams], |pending: StreamPending| {
            StreamPending::run_from_js_thread(pending);
        }),

        _ => {
            // A value outside `task_tag::COUNT` is a producer bug, but it's
            // treated as a recoverable crash, not UB.
            panic!("Unexpected Task tag: {}", task.tag.0);
        }
    }
    Ok(RunTaskResult::Continue)
}

/// The shell's arms, hoisted out of [`run_task`].
///
/// Shell* tags are never seen during `bun <file>` startup or the `dot`
/// benchmark, but their per-arm bodies pull in `bun_shell` call sites that LLVM
/// otherwise interleaves with the hot arms. The `#[cold]` boundary lets lld
/// place this whole cluster after the front-clustered startup window (see
/// `src/startup.order`), and `--trim` removes it with the shell.
///
/// Returns `()` — none of these arms can fail or early-return; the caller
/// falls through to `Ok(RunTaskResult::Continue)`.
#[cold]
#[inline(never)]
fn run_shell_task(task: Task) {
    bun_removable_features::removable_definition!(Shell, run_shell_task);
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

        // Any tag the hot path mis-routed: producer bug.
        _ => panic!("Unexpected Task tag: {}", task.tag.0),
    }
}

/// Compile-time guard that the arm counts in `run_task` and
/// `release_task_unrun` track `bun_event_loop::task_tag::COUNT`. Bump when
/// adding a variant — and give it an arm in both.
const _: () = assert!(
    task_tag::COUNT == 83,
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

    while let Some(task) = el.next_task() {
        // Incremented before dispatch so the count includes every task,
        // including the one that takes the HotReloadTask early return.
        *counter += 1;
        // A task continues what the script of some context started: it runs inside that context
        // (what it opens next, and the script it calls, are that context's), and once that context
        // has stopped it is released unrun. Not live either: the context of a file
        // `bun test --isolate` has since retired (the swap was that file's exit), and any context
        // once the VM was asked to stop (a parent's terminate() while the worker still ticks).
        let _context = match task.context() {
            bun_event_loop::ContextId::NONE => None,
            context => {
                let vm = global.bun_vm();
                let entered = vm.enter_context(context);
                if !(vm.script_allowed() && vm.is_context_live(context)) {
                    __bun_release_task_unrun(task);
                    if global.has_exception() {
                        report_error_or_terminate(global, bun_jsc::JsError::Thrown)?;
                    }
                    continue;
                }
                Some(entered)
            }
        };
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
    /// pick their own deref mode without aliasing UB) then runs `$body`.
    macro_rules! poll_arm {
        ($Ty:ty, |$h:ident| $body:expr) => {{
            // SAFETY: tag was set together with this pointee type at `FilePoll::init`.
            let $h: *mut $Ty = owner.ptr.cast::<$Ty>();
            $body;
        }};
    }
    /// The plain `on_poll(size_or_offset, hup)` call that covers most tags,
    /// through [`in_features!`].
    macro_rules! feature_poll_arm {
        ($features:tt, $Ty:ty) => {
            in_features!(
                $features,
                (
                    h: *mut $Ty = owner.ptr.cast::<$Ty>(),
                    size: isize = size_or_offset as isize,
                    hup: bool = hup,
                ) {
                    // SAFETY: tag matched, so `owner.ptr` was stored as `*mut $Ty` at
                    // `FilePoll::init` and the owner outlives this dispatch (caller contract).
                    unsafe { (*h).on_poll(size, hup) };
                }
            )
        };
    }

    match owner.tag() {
        poll_tag::BUFFERED_READER => poll_arm!(bun_io::BufferedReader, |h| {
            // SAFETY: tag matched, so `owner.ptr` is a live `*mut BufferedReader`
            // set at `FilePoll::init`. Passed raw: `on_poll`'s read loops run
            // user JS that can re-enter the reader, so no `&mut` may span the
            // dispatch.
            unsafe { bun_io::BufferedReader::on_poll(h, size_or_offset as isize, hup) }
        }),
        // Bypass `owner_as!` (which yields `&mut`) — `Process` may be freed
        // by the trailing `deref`, so keep raw provenance end-to-end.
        poll_tag::PROCESS => {
            in_features!([ChildProcess], (proc: *mut Process = owner.ptr.cast::<Process>()) {
                // SAFETY: `proc` carries the +1 ref taken at queue time; this drops it.
                unsafe { Process::on_wait_pid_from_event_loop_task(proc) };
            })
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

        // A child's stdin pipe is a `FileSink` too, whether or not the program looks at it.
        poll_tag::FILE_SINK => feature_poll_arm!([FileSink, Spawn, Shell], FileSinkPoll),
        poll_tag::STATIC_PIPE_WRITER => {
            feature_poll_arm!([Spawn], StaticPipeWriterPoll<Subprocess<'_>>)
        }
        poll_tag::SHELL_STATIC_PIPE_WRITER => {
            feature_poll_arm!(
                [Shell],
                StaticPipeWriterPoll<crate::shell::subproc::ShellSubprocess>
            )
        }
        poll_tag::SECURITY_SCAN_STATIC_PIPE_WRITER => {
            feature_poll_arm!(
                [Install],
                StaticPipeWriterPoll<bun_install::SecurityScanSubprocess<'_>>
            )
        }
        // `bun.shell.Interpreter.IOWriter.Poll`
        poll_tag::SHELL_BUFFERED_WRITER => in_features!(
            [Shell],
            (
                h: *mut ShellBufferedWriterPoll = owner.ptr.cast::<ShellBufferedWriterPoll>(),
                size: isize = size_or_offset as isize,
                hup: bool = hup,
            ) {
                // SAFETY: tag matched, so `owner.ptr` is a live `*mut ShellBufferedWriterPoll`
                // set at `FilePoll::init`; exclusive for this dispatch.
                unsafe { crate::shell::io_writer::on_poll(&mut *h, size, hup) };
            }
        ),
        poll_tag::DNS_RESOLVER => in_features!(
            [Dns],
            (
                resolver: *const DNSResolver = owner.ptr.cast_const().cast::<DNSResolver>(),
                poll: *mut FilePoll = poll,
            ) {
                // R-2: deref as shared (`&*const`) — `on_dns_poll` takes `&self` and
                // `Channel::process` re-enters the resolver via c-ares callbacks.
                // SAFETY: tag set with this pointee type at `FilePoll::init`.
                let resolver = unsafe { &*resolver };
                // SAFETY: `poll` outlives this call (caller contract).
                resolver.on_dns_poll(unsafe { &mut *poll });
            }
        ),
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
        poll_tag::TERMINAL_POLL => feature_poll_arm!([Terminal], TerminalPoll),
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
        bun_io::PollableTag::ReadFile => in_features!([Bodies], (poll: *mut bun_io::Poll = poll) {
            // SAFETY: per fn contract.
            let this = unsafe { &mut *bun_core::from_field_ptr!(ReadFile, io_poll, poll) };
            this.on_ready();
        }),
        bun_io::PollableTag::WriteFile => in_features!([Bodies], (poll: *mut bun_io::Poll = poll) {
            // SAFETY: per fn contract.
            let this = unsafe { &mut *bun_core::from_field_ptr!(WriteFile, io_poll, poll) };
            this.on_ready();
        }),
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
        bun_io::PollableTag::ReadFile => in_features!(
            [Bodies],
            (poll: *mut bun_io::Poll = poll, err: &bun_sys::Error = err) {
                // SAFETY: per fn contract.
                let this = unsafe { &mut *bun_core::from_field_ptr!(ReadFile, io_poll, poll) };
                this.on_io_error(err);
            }
        ),
        bun_io::PollableTag::WriteFile => in_features!(
            [Bodies],
            (poll: *mut bun_io::Poll = poll, err: &bun_sys::Error = err) {
                // SAFETY: per fn contract.
                let this = unsafe { bun_core::from_field_ptr!(WriteFile, io_poll, poll) };
                // WriteFile::on_io_error already takes `*mut ()` (it
                // self-recovers via the io_request path elsewhere); reuse that
                // shape rather than reborrowing `&mut`.
                WriteFile::on_io_error(this.cast(), err);
            }
        ),
        bun_io::PollableTag::Empty => {
            debug_assert!(false, "io::Poll on_io_error with Empty tag");
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
    // The same through `in_features!`.
    macro_rules! feature_timer_arm {
        ($features:tt, $Ty:ty, $field:ident, |$c:ident, $now:ident, $vm:ident| $body:expr) => {
            in_features!(
                $features,
                (
                    $c: *mut $Ty = owner!($Ty, $field),
                    $now: *const ElTimespec = now,
                    $vm: *mut VirtualMachine = vm,
                ) -> JsResult<()> {
                    // SAFETY: per fn contract; container derived from a live `$Ty`.
                    let () = unsafe { $body };
                    Ok(())
                }
            )
        };
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
            feature_timer_arm!(
                [AbortSignal],
                AbortSignalTimeout,
                event_loop_timer,
                |c, _now, vm| AbortSignalTimeout::run(c, vm)
            )
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
            feature_timer_arm!(
                [Histogram],
                EventLoopDelayMonitor,
                event_loop_timer,
                |c, now, vm| (*c).on_fire(&mut *vm, &*now)
            )
        }
        EventLoopTimerTag::StatWatcherScheduler => {
            feature_timer_arm!(
                [NodeFs],
                StatWatcherScheduler,
                event_loop_timer,
                |c, _now, _vm| (*c).timer_callback()
            )
        }
        EventLoopTimerTag::UpgradedDuplex => {
            feature_timer_arm!(
                [Sockets],
                UpgradedDuplex,
                event_loop_timer,
                |c, _now, _vm| (*c).on_timeout()
            )
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
            feature_timer_arm!([Dns], DNSResolver, event_loop_timer, |c, now, vm| {
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
            in_features!([Sql], (t: *mut EventLoopTimer = t) -> JsResult<()> {
                // SAFETY: §Dispatch — tag set together with the container at
                // construction; `t` is the connection's `timer` field.
                let container = unsafe { PostgresSQLConnection::from_timer_ptr(t) };
                // SAFETY: per fn contract.
                unsafe { (*container).on_connection_timeout() };
                Ok(())
            })
        }
        EventLoopTimerTag::PostgresSQLConnectionMaxLifetime => {
            in_features!([Sql], (t: *mut EventLoopTimer = t) -> JsResult<()> {
                // SAFETY: §Dispatch — `t` is the connection's `max_lifetime_timer`.
                let container = unsafe { PostgresSQLConnection::from_max_lifetime_timer_ptr(t) };
                // SAFETY: per fn contract.
                unsafe { (*container).on_max_lifetime_timeout() };
                Ok(())
            })
        }
        EventLoopTimerTag::MySQLConnectionTimeout => {
            in_features!([Sql], (t: *mut EventLoopTimer = t) -> JsResult<()> {
                // SAFETY: §Dispatch — `t` is the connection's `timer` field.
                let container = unsafe { MySQLConnection::from_timer_ptr(t) };
                // SAFETY: per fn contract.
                unsafe { (*container).on_connection_timeout() };
                Ok(())
            })
        }
        EventLoopTimerTag::MySQLConnectionMaxLifetime => {
            in_features!([Sql], (t: *mut EventLoopTimer = t) -> JsResult<()> {
                // SAFETY: §Dispatch — `t` is the connection's `max_lifetime_timer`.
                let container = unsafe { MySQLConnection::from_max_lifetime_timer_ptr(t) };
                // SAFETY: per fn contract.
                unsafe { (*container).on_max_lifetime_timeout() };
                Ok(())
            })
        }
        EventLoopTimerTag::ValkeyConnectionTimeout => in_features!(
            [Valkey],
            (container: *mut Valkey = owner!(Valkey, timer)) -> JsResult<()> {
                // SAFETY: per fn contract.
                unsafe { (*container).on_connection_timeout() }
            }
        ),
        EventLoopTimerTag::ValkeyConnectionReconnect => in_features!(
            [Valkey],
            (container: *mut Valkey = owner!(Valkey, reconnect_timer)) -> JsResult<()> {
                // SAFETY: per fn contract.
                unsafe { (*container).on_reconnect_timer() }
            }
        ),
        EventLoopTimerTag::SubprocessTimeout => {
            feature_timer_arm!(
                [Spawn],
                Subprocess<'_>,
                event_loop_timer,
                |c, _now, _vm| (*c).timeout_callback()
            )
        }
        EventLoopTimerTag::DevServerSweepSourceMaps => in_features!(
            [Bundler],
            (t: *mut EventLoopTimer = t, now: *const ElTimespec = now) -> JsResult<()> {
                // `sweep_weak_refs` takes the raw `*EventLoopTimer` and recovers
                // the store inside.
                // SAFETY: per fn contract.
                SourceMapStore::sweep_weak_refs(t, unsafe { &*now });
                Ok(())
            }
        ),
        EventLoopTimerTag::DevServerMemoryVisualizerTick => in_features!(
            [Bundler],
            (t: *mut EventLoopTimer = t, now: *const ElTimespec = now) -> JsResult<()> {
                // SAFETY: per fn contract; `t` is the `memory_visualizer_timer`
                // field of a live DevServer.
                DevServer::emit_memory_visualizer_message_timer(unsafe { &mut *t }, unsafe {
                    &*now
                });
                Ok(())
            }
        ),
        EventLoopTimerTag::BunTest => in_features!(
            [Test],
            (container: *mut BunTest = owner!(BunTest, timer), now: *const ElTimespec = now)
            -> JsResult<()> {
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
        ),
        EventLoopTimerTag::CronJob => in_features!(
            [Cron],
            (c: *mut CronJob = owner!(CronJob, event_loop_timer)) -> JsResult<()> {
                // SAFETY: a scheduled job's JS wrapper keeps it alive; `t` was just popped.
                CronJob::on_timer_fire(unsafe { bun_ptr::ThisPtr::new(c) }, VirtualMachine::get());
                Ok(())
            }
        ),
        EventLoopTimerTag::QuicEndpoint => in_features!(
            [NodeQuic],
            (
                c: *mut crate::node::quic::QuicEndpoint =
                    owner!(crate::node::quic::QuicEndpoint, event_loop_timer),
            ) -> JsResult<()> {
                crate::node::quic::QuicEndpoint::on_timer_fire(c);
                Ok(())
            }
        ),
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
    /// [`release!`] through [`in_features!`], with the features of the tag's arm in [`run_task`].
    macro_rules! release_in {
        ($features:tt, $ty:ty) => {
            in_features!($features, (payload: *mut $ty = task.ptr.cast::<$ty>()) {
                // SAFETY: as `release!`.
                unsafe { <$ty as bun_event_loop::Taskable>::release_unrun(payload) }
            })
        };
    }
    match task.tag {
        task_tag::AnyTaskJob => {
            // The one erased tag: every payload is a `Job<C>` reached through its header.
            // SAFETY: as `release!`.
            unsafe { bun_jsc::job::release_unrun_erased(task.ptr) }
        }
        task_tag::AsyncModule => release_in!([Install], bun_jsc::async_module::AsyncModule),
        task_tag::BakeHotReloadEvent => release_in!([Bundler], BakeHotReloadEvent),
        task_tag::BundleV2DeferredBatchTask => release_in!([Bundler], BundleV2DeferredBatchTask),
        task_tag::BundleV2PluginResolve => {
            release_in!([Bundler], bun_bundler::bundle_v2::api::JSBundler::Resolve)
        }
        task_tag::BundleV2PluginLoad => {
            release_in!([Bundler], bun_bundler::bundle_v2::api::JSBundler::Load)
        }
        task_tag::ShellYesTask => release_in!([Shell], ShellYesTask),
        task_tag::CppTask => release!(CppTask),
        task_tag::DuplexUpgradeContext => {
            release_in!([Sockets], crate::socket::DuplexUpgradeContext)
        }
        task_tag::FetchTasklet => release_in!([Fetch], FetchTasklet),
        task_tag::FetchTaskletDeinit => {
            release_in!([Fetch], crate::webcore::fetch::FetchTaskletDeinitHop)
        }
        task_tag::FetchTaskletPromiseSettle => {
            release_in!([Fetch], crate::webcore::fetch::fetch_tasklet::FetchTaskletPromiseSettle)
        }
        task_tag::FSWatchTask => release_in!([NodeFs], FSWatchTask),
        task_tag::HotReloadTask => release_in!([HotReload], hot_reloader::HotReloadTask),
        task_tag::WatchReloadTask => release_in!([HotReload], hot_reloader::WatchReloadTask),
        task_tag::JSBundleCompletionTask => {
            release_in!([Bundler], crate::api::js_bundle_completion_task::JSBundleCompletionTask)
        }
        task_tag::JSCDeferredWorkTask => release!(JSCDeferredWorkTask),
        task_tag::BundleV2PluginResolveAnswered => {
            release_in!([Bundler], bun_bundler::bundle_v2::api::JSBundler::ResolveAnswered)
        }
        task_tag::BundleV2PluginLoadAnswered => {
            release_in!([Bundler], bun_bundler::bundle_v2::api::JSBundler::LoadAnswered)
        }
        task_tag::BundleV2PluginLoadDeferred => {
            release_in!([Bundler], bun_bundler::bundle_v2::api::JSBundler::LoadDeferred)
        }
        task_tag::BundleV2ParseTaskResult => {
            release_in!([Bundler], bun_bundler::parse_task::Result)
        }
        task_tag::FetchTaskletRequestDrain => {
            release_in!([Fetch], crate::webcore::fetch::FetchTaskletRequestDrain)
        }
        task_tag::HTMLRewriterBackgroundPull => {
            release_in!([HtmlRewriter], crate::api::html_rewriter::RewriterPipeBackgroundPull)
        }
        task_tag::RunTestsTask => release_in!([Test], crate::test_runner::bun_test::RunTestsTask),
        task_tag::ValkeyDeferredFailure => {
            release_in!([Valkey], crate::valkey_jsc::valkey::DeferredFailure)
        }
        task_tag::DnsErrorDeferred => {
            release_in!([Dns], crate::dns_jsc::cares_jsc::ErrorDeferredTask)
        }
        task_tag::HandledPromise => release!(bun_jsc::virtual_machine_exports::HandledPromiseTask),
        task_tag::GraphContextStopAgain => {
            release!(bun_jsc::virtual_machine::GraphContextStopAgain)
        }
        task_tag::DeadContextStopAgain => release!(bun_jsc::virtual_machine::DeadContextStopAgain),
        task_tag::GraphContextStopAndFree => {
            release!(bun_jsc::virtual_machine::GraphContextStopAndFree)
        }
        task_tag::HTTPAppClose => release_in!([Serve], crate::server::AppCloseTask<false>),
        task_tag::HTTPSAppClose => release_in!([TlsSockets], crate::server::AppCloseTask<true>),
        task_tag::HTTPServerDeinit => {
            release_in!([Serve], crate::server::ServerDeinitTask<false, false>)
        }
        task_tag::HTTPSServerDeinit => {
            release_in!([TlsSockets], crate::server::ServerDeinitTask<true, false>)
        }
        task_tag::DebugHTTPServerDeinit => {
            release_in!([Serve], crate::server::ServerDeinitTask<false, true>)
        }
        task_tag::DebugHTTPSServerDeinit => {
            release_in!([TlsSockets], crate::server::ServerDeinitTask<true, true>)
        }
        task_tag::NapiAsyncWork => release_in!([NativeAddons], napi_async_work),
        task_tag::NapiFinalizerTask => release_in!([NativeAddons], NapiFinalizerTask),
        task_tag::NativePromiseContextDeferredDerefTask => {
            release_in!(
                [Serve, HtmlRewriter, S3Client, Cron],
                NativePromiseContextDeferredDerefTask
            )
        }
        task_tag::NativeBrotli => release_in!([NodeZlibBrotli], NativeBrotli),
        task_tag::NativeZlib => release_in!([NodeZlib], NativeZlib),
        task_tag::NativeZstd => release_in!([NodeZlibZstd], NativeZstd),
        task_tag::PollPendingModulesTask => release!(bun_jsc::async_module::Queue),
        task_tag::PosixSignalTask => release!(PosixSignalTask),
        task_tag::MemoryPressureTask => release!(crate::node::memory_pressure::MemoryPressureTask),
        task_tag::ProcessWaiterThreadTask => {
            #[cfg(not(windows))]
            release_in!([ChildProcess], ProcessWaiterThreadTask<Process>);
            #[cfg(windows)]
            unreachable!("posix-only tag");
        }
        task_tag::FlushPendingFileSinkTask => {
            release_in!([FileSink, Spawn, Shell], FlushPendingFileSinkTask)
        }
        task_tag::RuntimeTranspilerStore => {
            release_in!([RuntimeTranspiler], RuntimeTranspilerStore)
        }
        task_tag::S3HttpDownloadStreamingTask => {
            release_in!([S3Client], S3HttpDownloadStreamingTask)
        }
        task_tag::S3HttpSimpleTask => release_in!([S3Client], S3HttpSimpleTask),
        task_tag::S3UploadWriterCollected => release_in!([S3Client], S3UploadWriterCollected),
        task_tag::SendQueueDeferred => release_in!([Ipc], crate::ipc::SendQueue),
        task_tag::ServerAllConnectionsClosedTask => {
            release_in!([Serve], ServerAllConnectionsClosedTask)
        }
        task_tag::ShellAsync => release_in!([Shell], crate::shell::dispatch_tasks::ShellAsyncTask),
        task_tag::ShellCondExprStatTask => release_in!([Shell], ShellCondExprStatTask),
        task_tag::ShellCpTask => release_in!([Shell], ShellCpTask),
        task_tag::ShellGlobTask => release_in!([Shell], ShellGlobTask),
        task_tag::ShellLsTask => release_in!([Shell], ShellLsTask),
        task_tag::ShellMkdirTask => release_in!([Shell], ShellMkdirTask),
        task_tag::ShellMvBatchedTask => release_in!([Shell], ShellMvBatchedTask),
        task_tag::ShellMvCheckTargetTask => release_in!([Shell], ShellMvCheckTargetTask),
        task_tag::ShellRmDirTask => release_in!([Shell], ShellRmDirTask),
        task_tag::ShellRmTask => release_in!([Shell], ShellRmTask),
        task_tag::ShellTouchTask => release_in!([Shell], ShellTouchTask),
        task_tag::StatWatcherTimerUpdate => {
            release_in!([NodeFs], crate::node::node_fs_stat_watcher::StatWatcherTimerUpdate)
        }
        task_tag::StatWatcherHop => {
            release_in!([NodeFs], crate::node::node_fs_stat_watcher::StatWatcher)
        }
        task_tag::AsyncCpTask => release_in!([NodeFs], crate::node::fs::AsyncCpTask),
        task_tag::ShellAsyncCpTask => release_in!([Shell], crate::node::fs::ShellAsyncCpTask),
        task_tag::StreamPending => release_in!([WebStreams], StreamPending),
        task_tag::ThreadSafeFunction => release_in!([NativeAddons], ThreadSafeFunction),
        task_tag::ValkeyDeferredClose => {
            release_in!([Valkey], crate::valkey_jsc::js_valkey::ValkeyDeferredClose)
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
        task_tag::CopyFileWindowsMkdirp => {
            #[cfg(windows)]
            release_in!([Bodies], crate::webcore::blob::copy_file::CopyFileWindowsMkdirp<'_>);
            #[cfg(not(windows))]
            unreachable!("windows-only tag");
        }
        task_tag::WriteFileWindowsMkdirp => {
            #[cfg(windows)]
            release_in!([Bodies], crate::webcore::blob::write_file::WriteFileWindowsMkdirp);
            #[cfg(not(windows))]
            unreachable!("windows-only tag");
        }
        task_tag::ChromePipeEvent => {
            #[cfg(windows)]
            release_in!([WebView], crate::webview::chrome_process::QueuedEvent);
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
                        $(task_tag::$tag => release_in!([NodeFs], fs_async::$ty),)*
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
