//! `crate::dispatch` — the §Dispatch hot-path payoff.
//!
//! Per `docs/PORTING.md` §Dispatch, low-tier crates store
//! `Task = { tag: TaskTag, ptr: *mut () }` and never name a variant type. This
//! crate (highest tier) owns **every** variant type, so the actual `match`
//! loop lives here, and LLVM inlines the per-arm direct calls.
//!
//! Three dispatchers are defined:
//!   1. [`run_task`] — `bun_event_loop::Task` (~96 variants).
//!   2. [`__bun_run_io`] — `bun_io::Owner`.
//!
//! Low-tier crates declare these as `extern "Rust"`; this crate defines them
//! `#[no_mangle]` so the linker resolves the call directly — no runtime
//! registration, no `AtomicPtr`, no init-order hazard.
//!
//! **Adding a variant** (do all four):
//!   1. tag constant in `bun_event_loop::task_tag` (or a `bun_io::PollTag`);
//!   2. `impl bun_event_loop::BoxedTask for YourType` if it is queued as a `Box`, `RefTask` as an `Arc` or `RefPtr`, otherwise `Taskable`;
//!   3. a `run_task` arm and a `release_task_unrun` arm here, both through `in_features!` if only code of removable features (`src/trim/features`) queues it;
//!   4. bump the `task_tag::COUNT` assertion below.

use std::rc::Rc;

use bun_event_loop::{BoxedTask, RefTask, Task, task_tag};
use bun_ptr::RefPtr;

#[cfg(not(windows))]
use bun_io::posix_event_loop::Flags as PollFlag;
use bun_io::{IoEvent, Owner, PollTag};

use bun_core::Timespec;
use bun_event_loop::EventLoopTimer::{EventLoopTimer, Tag as EventLoopTimerTag};

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

/// Runs `$body` in a function of its own, which records itself as a part of each feature listed.
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

/// The box of a [`BoxedTask`], in the arm of its tag.
macro_rules! boxed {
    ($task:ident, $Payload:ty) => {
        // SAFETY: §Dispatch — the tag identifies the type, and the task left its queue once.
        unsafe { $task.into_boxed::<$Payload>() }
    };
}

/// [`in_features!`] for an arm that needs only that box, as `$payload: Box<$Payload>`.
macro_rules! boxed_arm {
    (
        $task:ident,
        $features:tt,
        // `$payload` repeats so that `mut name` matches.
        |$($payload:ident)+: $Payload:ty| $(-> $Result:ty)? $body:block
    ) => {
        in_features!(
            $features,
            (boxed: Box<$Payload> = boxed!($task, $Payload))
            $(-> $Result)?
            {
                let $($payload)+ = boxed;
                $body
            }
        )
    };
}

/// The reference of a [`RefTask`], in the arm of its tag.
macro_rules! counted {
    ($task:ident, $Name:ty) => {
        // SAFETY: as `boxed!`.
        unsafe { $task.into_ref::<$Name>() }
    };
}

/// [`in_features!`] for an arm that needs only that reference, as `$payload`.
macro_rules! counted_arm {
    ($task:ident, $features:tt, |$payload:ident: $Name:ty| $(-> $Result:ty)? $body:block) => {
        in_features!(
            $features,
            ($payload: <$Name as RefTask>::Ref = counted!($task, $Name))
            $(-> $Result)?
            $body
        )
    };
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
use crate::shell::interpreter::{PoolTask, ShellTask};
use crate::shell::io_reader::IOReader as ShellIoReader;
use crate::shell::io_writer::IOWriter as ShellIoWriter;
use crate::shell::states::r#async::Async as ShellAsync;
use crate::shell::subproc::{PipeReader as ShellPipeReader, ShellSubprocess};

use crate::webcore::fetch::fetch_tasklet::FetchTasklet;
use crate::webcore::file_reader::{FileReader, Source as FileReaderSource};
use crate::webcore::file_sink::FileSink;
use crate::webcore::s3::download_stream::S3HttpDownloadStreamingTask;
use crate::webcore::s3::multipart::WriterCollected as S3UploadWriterCollected;
use crate::webcore::s3::simple_request::{RefusedRequest as S3RefusedRequest, S3HttpSimpleTask};
use crate::webcore::streams::{PendingRead as StreamPending, StreamResult};

use crate::api::bun_subprocess::Subprocess;
use crate::api::bun_subprocess::subprocess_pipe_reader::PipeReader as SubprocessPipeReader;
use crate::api::bun_terminal_body::Terminal;
use crate::api::cron::CronJob;
use crate::api::cron_os::OsJob;
use crate::api::js_bundle_completion_task::JSBundleCompletionTask;
use crate::api::native_promise_context::DeferredDerefTask as NativePromiseContextDeferredDerefTask;

use crate::napi::{NapiFinalizerTask, ThreadSafeFunction, TsfnRefRequest, napi_async_work};

use bun_jsc::PosixSignalTask;
use bun_jsc::RuntimeTranspilerStore;
use bun_jsc::cpp_task::CppTask;
use bun_jsc::hot_reloader;
use bun_jsc::jsc_scheduler::JSCDeferredWorkTask;

use crate::bake::dev_server::DevServer;
use crate::bake::dev_server::PendingReloadEvent as BakePendingReloadEvent;
use crate::bake::dev_server::source_map_store::SourceMapStore;

#[cfg(windows)]
use crate::node::fs::async_ as fs_async;
use crate::node::node_fs_stat_watcher::StatWatcherScheduler;
use crate::node::node_fs_watcher::FSWatchTask;

use crate::dns_jsc::Resolver as DNSResolver;
use crate::server::{FileResponseStream, ServerAllConnectionsClosedTask};

use crate::cli::test::parallel::worker::Worker as TestParallelWorker;
use crate::cli::{filter_run, multi_run};
use bun_install::git_runner::GitSubprocess;
use bun_install::{LifecycleScriptSubprocess, SecurityScanSubprocess};

#[cfg(not(windows))]
use crate::api::bun_process::Process;
#[cfg(unix)]
use crate::api::bun_process::waiter_thread_posix::ResultTask as ProcessWaiterThreadTask;

use bun_bundler::DeferredBatchTask::DeferredBatchTask as BundleV2DeferredBatchTask;
type BundleV2ParseTaskResult = bun_bundler::parse_task::Result<'static>;

use crate::socket::upgraded_duplex::UpgradedDuplex;
#[cfg(windows)]
use crate::socket::windows_named_pipe::WindowsNamedPipe;

use crate::valkey_jsc::js_valkey::JSValkeyClient as Valkey;
use bun_sql_jsc::mysql::js_my_sql_connection::JSMySQLConnection as MySQLConnection;
use bun_sql_jsc::postgres::PostgresSQLConnection;
use bun_sql_jsc::shared::connection_timers::TimedConnection as _;

use crate::test_runner::bun_test::{BunTest, clone_active_strong};
use crate::timer::{DateHeaderTimer, EventLoopDelayMonitor};
use bun_jsc::abort_signal::Timeout as AbortSignalTimeout;
use bun_jsc::garbage_collection_controller::GarbageCollectionController;
use bun_jsc::web_worker::WebWorker;

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
// Shell* cluster is further hoisted into [`run_task_cold`] so this hot dispatcher stays off its pages.
#[inline(never)]
pub(crate) fn run_task(
    task: Task,
    el: &EventLoop,
    vm: &VirtualMachine,
    global: &JSGlobalObject,
) -> JsResult<RunTaskResult> {
    /// `*(task.ptr as *mut T)` with the SAFETY invariant spelled once.
    macro_rules! cast {
        ($ty:ty) => {{
            // SAFETY: §Dispatch — `task.tag` was set together with `task.ptr`
            // by `Task::init`; tag uniquely identifies
            // the pointee type and the pointer is live for this dispatch.
            unsafe { &mut *task.ptr().cast::<$ty>() }
        }};
    }
    /// Raw `*mut T` (for `heap::take`/self-consuming entry points).
    macro_rules! cast_ptr {
        ($ty:ty) => {
            task.ptr().cast::<$ty>()
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
    // NB: `TaskTag` is `#[derive(PartialEq, Eq)]` over `u8` → structural-match
    // eligible, so const patterns work directly.
    match task.tag() {
        // ── erased-callback tasks (low-tier types — real) ────────────────
        task_tag::AnyTaskJob => {
            // SAFETY: §Dispatch — `task.ptr` is a live heap `Job<C>` posted by
            // its `Completion`; the erased entry runs `then` and frees it.
            unsafe { bun_jsc::job::complete_erased(task.ptr(), global) }?;
        }
        task_tag::SendQueueDeferred => counted_arm!(task, [Ipc], |queue: crate::ipc::SendQueue| {
            queue.run_deferred();
        }),
        task_tag::BundleV2PluginResolve => in_features!(
            [Bundler],
            (
                resolve: Box<bun_bundler::bundle_v2::api::JSBundler::Resolve<'static>> =
                    boxed!(task, bun_bundler::bundle_v2::api::JSBundler::Resolve),
                global: &JSGlobalObject = global,
            ) -> JsResult<()> {
                // `bun_bundler` is JSC-free; the C++ hop it calls answers the request itself when the plugin throws, but can return early with an exception pending (argument conversion), so check the scope here.
                bun_jsc::call_check_slow(global, || resolve.run_on_js_thread())?;
                Ok(())
            }
        )?,
        task_tag::BundleV2PluginLoad => in_features!(
            [Bundler],
            (
                load: Box<bun_bundler::bundle_v2::api::JSBundler::Load<'static>> =
                    boxed!(task, bun_bundler::bundle_v2::api::JSBundler::Load),
                global: &JSGlobalObject = global,
            ) -> JsResult<()> {
                // As `BundleV2PluginResolve`.
                bun_jsc::call_check_slow(global, || load.run_on_js_thread())?;
                Ok(())
            }
        )?,
        task_tag::JSBundleCompletionTask => boxed_arm!(
            task,
            [Bundler],
            |build: JSBundleCompletionTask| -> JsResult<()> { build.on_complete() }
        )?,
        task_tag::FetchTaskletPromiseSettle => boxed_arm!(
            task,
            [Fetch],
            |holder: crate::webcore::fetch::fetch_tasklet::FetchTaskletPromiseSettle|
            -> JsResult<()> {
                holder.run()
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
            boxed!(task, crate::dns_jsc::LibuvRequest).run();
        }
        #[cfg(windows)]
        task_tag::UvDnsPollFree => {
            crate::dns_jsc::UvDnsPoll::destroy(cast_ptr!(crate::dns_jsc::UvDnsPoll));
        }
        task_tag::ValkeyDeferredClose => {
            boxed_arm!(
                task,
                [Valkey],
                |close: crate::valkey_jsc::js_valkey::ValkeyDeferredClose| {
                    close.run();
                }
            )
        }
        task_tag::StatWatcherTimerUpdate => boxed_arm!(
            task,
            [NodeFs],
            |update: crate::node::node_fs_stat_watcher::StatWatcherTimerUpdate| {
                update.run();
            }
        ),
        task_tag::AsyncCpTask => boxed_arm!(
            task,
            [NodeFs],
            |copy: crate::node::fs::AsyncCpTask| -> JsResult<()> { copy.run_from_js_thread() }
        )?,
        task_tag::ShellAsyncCpTask => boxed_arm!(
            task,
            [Shell],
            |copy: crate::node::fs::ShellAsyncCpTask| -> JsResult<()> { copy.run_from_js_thread() }
        )?,
        task_tag::StatWatcherHop => counted_arm!(
            task,
            [NodeFs],
            |watcher: crate::node::node_fs_stat_watcher::StatWatcher| -> JsResult<()> {
                crate::node::node_fs_stat_watcher::StatWatcher::run_hop(watcher)?;
                Ok(())
            }
        )?,
        task_tag::BundleV2PluginResolveAnswered => boxed_arm!(
            task,
            [Bundler],
            |answered: bun_bundler::bundle_v2::api::JSBundler::ResolveAnswered| { answered.run() }
        ),
        task_tag::BundleV2PluginLoadAnswered => boxed_arm!(
            task,
            [Bundler],
            |answered: bun_bundler::bundle_v2::api::JSBundler::LoadAnswered| { answered.run() }
        ),
        task_tag::BundleV2PluginLoadDeferred => {
            cast!(bun_bundler::bundle_v2::api::JSBundler::LoadDeferred).run();
        }
        task_tag::BundleV2ParseTaskResult => {
            boxed_arm!(task, [Bundler], |result: BundleV2ParseTaskResult| {
                // SAFETY: posted to the bundle's thread, which uses no borrow of it across a tick.
                unsafe { bun_bundler::parse_task::on_complete(result) };
            })
        }
        task_tag::FetchTaskletRequestDrain => {
            feature_arm!(
                [Fetch],
                |drain: crate::webcore::fetch::FetchTaskletRequestDrain| {
                    // SAFETY: §Dispatch — tag identifies pointee; the task owns a ref.
                    let tasklet = unsafe { bun_ptr::RefPtr::from_raw(drain.cast()) };
                    FetchTasklet::resume_request_data_stream(&tasklet);
                }
            )
        }
        task_tag::HTMLRewriterBackgroundPull => counted_arm!(
            task,
            [HtmlRewriter],
            |pipe: crate::api::html_rewriter::RewriterPipeBackgroundPull| {
                pipe.run_background_pull();
            }
        ),
        task_tag::RunTestsTask => boxed_arm!(
            task,
            [Test],
            |run: crate::test_runner::bun_test::RunTestsTask| -> JsResult<()> { run.call() }
        )?,
        task_tag::DnsErrorDeferred => boxed_arm!(
            task,
            [Dns],
            |error: crate::dns_jsc::cares_jsc::ErrorDeferredTask| -> JsResult<()> { error.run() }
        )?,
        task_tag::HandledPromise => {
            boxed!(task, bun_jsc::virtual_machine_exports::HandledPromiseTask).run();
        }
        task_tag::GraphContextStopAgain => {
            // `ptr` packs the `ContextId`, not a pointer.
            bun_jsc::virtual_machine::GraphContextStopAgain::run(
                vm,
                bun_jsc::ContextId::from_raw(task.ptr() as usize as u32),
            );
        }
        task_tag::DeadContextStopAgain => {
            bun_jsc::virtual_machine::DeadContextStopAgain::run(vm);
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
        task_tag::HTTPAppClose => {
            feature_arm!([Serve], |app: crate::server::AppCloseTask<false>| {
                crate::server::AppCloseTask::<false>::run(app);
            })
        }
        task_tag::HTTPSAppClose => {
            feature_arm!([TlsSockets], |app: crate::server::AppCloseTask<true>| {
                crate::server::AppCloseTask::<true>::run(app);
            })
        }
        task_tag::HTTPServerDeinit => {
            feature_arm!([Serve], |server: crate::server::ServerDeinitTask<
                false,
                false,
            >| {
                // SAFETY: the unique owning server pointer `schedule_deinit` queued.
                unsafe { crate::server::ServerDeinitTask::<false, false>::run(server) };
            })
        }
        task_tag::HTTPSServerDeinit => {
            feature_arm!([TlsSockets], |server: crate::server::ServerDeinitTask<
                true,
                false,
            >| {
                // SAFETY: the unique owning server pointer `schedule_deinit` queued.
                unsafe { crate::server::ServerDeinitTask::<true, false>::run(server) };
            })
        }
        task_tag::DebugHTTPServerDeinit => {
            feature_arm!([Serve], |server: crate::server::ServerDeinitTask<
                false,
                true,
            >| {
                // SAFETY: the unique owning server pointer `schedule_deinit` queued.
                unsafe { crate::server::ServerDeinitTask::<false, true>::run(server) };
            })
        }
        task_tag::DebugHTTPSServerDeinit => {
            feature_arm!([TlsSockets], |server: crate::server::ServerDeinitTask<
                true,
                true,
            >| {
                // SAFETY: the unique owning server pointer `schedule_deinit` queued.
                unsafe { crate::server::ServerDeinitTask::<true, true>::run(server) };
            })
        }
        #[cfg(windows)]
        task_tag::CopyFileWindowsMkdirp => boxed_arm!(
            task,
            [Bodies],
            |copy: crate::webcore::blob::copy_file::CopyFileWindows| {
                copy.on_mkdirp_complete();
            }
        ),
        #[cfg(windows)]
        task_tag::WriteFileWindowsMkdirp => boxed_arm!(
            task,
            [Bodies],
            |write: crate::webcore::blob::write_file::WriteFileWindows| {
                write.on_mkdirp_complete();
            }
        ),
        #[cfg(windows)]
        task_tag::ChromePipeEvent => boxed_arm!(
            task,
            [WebView],
            |event: crate::webview::chrome_process::QueuedEvent| -> JsResult<()> {
                event.deliver()
            }
        )?,
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
        | task_tag::ShellYesTask => run_task_cold(&task),

        // ── fetch / S3 ───────────────────────────────────────────────────
        task_tag::FetchTasklet => feature_arm!([Fetch], |tasklet: FetchTasklet| -> JsResult<()> {
            // SAFETY: §Dispatch — tag identifies pointee.
            unsafe { FetchTasklet::on_progress_update(tasklet) }
        })?,
        task_tag::FetchTaskletDeinit => {
            feature_arm!(
                [Fetch],
                |hop: crate::webcore::fetch::FetchTaskletDeinitHop| {
                    // SAFETY: posted by `HttpThreadRef` with the last ref.
                    unsafe { crate::webcore::fetch::FetchTaskletDeinitHop::run(hop) };
                }
            )
        }
        // `cast_ptr!` yields the heap-allocated S3 task; JS-thread dispatch
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
        task_tag::S3RefusedRequest => boxed_arm!(
            task,
            [S3Client],
            |refused: S3RefusedRequest| -> JsResult<()> { refused.run() }
        )?,
        task_tag::S3UploadWriterCollected => counted_arm!(
            task,
            [S3Client],
            |upload: S3UploadWriterCollected| -> JsResult<()> {
                S3UploadWriterCollected::run(&upload)?;
                Ok(())
            }
        )?,

        // ── napi ─────────────────────────────────────────────────────────
        task_tag::NapiAsyncWork => in_features!(
            [NativeAddons],
            (
                work: *mut napi_async_work = cast_ptr!(napi_async_work),
                global: &JSGlobalObject = global,
            ) -> JsResult<()> {
                // SAFETY: §Dispatch — tag identifies pointee, which the pool posted back.
                unsafe { napi_async_work::run_from_js(work, global) }
            }
        )?,
        task_tag::ThreadSafeFunction => in_features!(
            [NativeAddons],
            (
                function: std::sync::Arc<ThreadSafeFunction> = counted!(task, ThreadSafeFunction),
                el: &EventLoop = el,
                vm: &VirtualMachine = vm,
            ) {
                ThreadSafeFunction::on_dispatch(function, el, vm);
            }
        ),
        task_tag::ThreadSafeFunctionRefRequest => {
            boxed_arm!(task, [NativeAddons], |request: TsfnRefRequest| {
                request.run()
            })
        }
        task_tag::NapiFinalizerTask => boxed_arm!(
            task,
            [NativeAddons],
            |napi_task: NapiFinalizerTask| -> JsResult<()> { napi_task.finalizer.run() }
        )?,
        task_tag::UvLoopDispatch => {
            #[cfg(unix)]
            in_features!([NativeAddons], (vm: &VirtualMachine = vm) {
                crate::jsc_hooks::runtime_state_of(vm).uv_loop.dispatch(vm);
            });
            #[cfg(not(unix))]
            unreachable!("posix-only");
        }
        task_tag::UvHandleClose => {
            #[cfg(unix)]
            {
                use crate::napi::uv_posix::UvHandle;
                in_features!(
                    [NativeAddons],
                    (
                        uv_handle: *mut UvHandle = cast_ptr!(UvHandle),
                        global: &JSGlobalObject = global,
                    ) -> JsResult<()> {
                        // SAFETY: `uv_close` posted this handle.
                        unsafe { UvHandle::run_close(uv_handle, global) }
                    }
                )?;
            }
            #[cfg(not(unix))]
            unreachable!("posix-only");
        }
        task_tag::UvWorkDone => {
            #[cfg(unix)]
            {
                use crate::napi::uv_posix::UvWork;
                in_features!(
                    [NativeAddons],
                    (
                        uv_work: *mut UvWork = cast_ptr!(UvWork),
                        vm: &VirtualMachine = vm,
                    ) -> JsResult<()> {
                        // SAFETY: the pool posted this request.
                        unsafe { UvWork::run_done(uv_work, vm) }
                    }
                )?;
            }
            #[cfg(not(unix))]
            unreachable!("posix-only");
        }

        // ── JSC scheduler / module loader ────────────────────────────────
        task_tag::JSCDeferredWorkTask => {
            bun_jsc::mark_binding();
            cast!(JSCDeferredWorkTask).run(global)?;
        }
        task_tag::RuntimeTranspilerStore => in_features!(
            [RuntimeTranspiler],
            (
                el: &EventLoop = el,
                global: &JSGlobalObject = global,
                vm: &VirtualMachine = vm,
            ) {
                vm.transpiler_store.run_from_js_thread(el, global, vm.into());
            }
        ),

        // ── hot-reload (early-returns from the drain loop) ───────────────
        task_tag::HotReloadTask => {
            drop(boxed!(task, hot_reloader::HotReloadTask));
            in_features!([HotReload], (vm: &VirtualMachine = vm) {
                hot_reloader::HotReloadTask::run(vm);
            });
            return Ok(RunTaskResult::EarlyReturn);
        }
        // ── bake dev-server ──────────────────────────────────────────────
        task_tag::BakePendingReloadEvent => {
            counted_arm!(task, [Bundler], |event: BakePendingReloadEvent| {
                // SAFETY: this is the dev server's thread, and no borrow of it outlasts a tick.
                unsafe { event.run() };
            })
        }
        task_tag::FSWatchTask => {
            boxed_arm!(task, [NodeFs], |mut watch: FSWatchTask| -> JsResult<()> {
                watch.run()
            })?
        }

        // ── node:fs libuv-request ops (Windows) ──────────────────────────
        #[cfg(windows)]
        for_each_fs_uv_op!(__fs_pat) => {
            macro_rules! __fs_run {
                ($($tag:ident $ty:ident;)*) => { match task.tag() {
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

        // ── process / signals ────────────────────────────────────────────
        task_tag::ProcessWaiterThreadTask => {
            #[cfg(not(windows))]
            boxed_arm!(task, [ChildProcess], |result: ProcessWaiterThreadTask<
                Process,
            >| {
                result.run_from_js_thread();
            });
            #[cfg(windows)]
            unreachable!("posix-only");
        }
        task_tag::PosixSignalTask => {
            // `ptr` here is *not* a pointer but a packed signal number.
            let _ = core::marker::PhantomData::<PosixSignalTask>;
            bun_jsc::posix_signal_handle::PosixSignalTask::run_from_js_thread(
                task.ptr() as usize as u8,
                global,
            );
        }
        task_tag::MemoryPressureTask => {
            // `ptr` is the packed level (NOTE_MEMORYSTATUS_PRESSURE_* bits), not a pointer.
            crate::node::memory_pressure::emit(global, task.ptr() as usize as i32);
        }
        // One feature for each kind of context a `NativePromiseContext` cell holds.
        task_tag::NativePromiseContextDeferredDerefTask => in_features!(
            [Serve, HtmlRewriter, S3Client],
            (packed: usize = task.ptr() as usize) {
                // `ptr` packs an int, not a pointer.
                NativePromiseContextDeferredDerefTask::run_from_js_thread(packed);
            }
        ),

        // ── server / bundler / streams ───────────────────────────────────
        task_tag::ServerAllConnectionsClosedTask => boxed_arm!(
            task,
            [Serve],
            |mut closed: ServerAllConnectionsClosedTask| -> JsResult<()> {
                closed.run_from_js_thread()
            }
        )?,
        task_tag::BundleV2DeferredBatchTask => in_features!(
            [Bundler],
            (
                batch: *mut BundleV2DeferredBatchTask = cast_ptr!(BundleV2DeferredBatchTask),
                global: &JSGlobalObject = global,
            ) -> JsResult<()> {
                // `bun_bundler` is JSC-free so the exception-scope check is hoisted to this dispatch arm; without it, `JSBundlerPlugin__drainDeferred`'s THROW_SCOPE is left unchecked and trips JSC exception validation at the next `drainMicrotasks` scope.
                bun_jsc::call_check_slow(global, || {
                    // SAFETY: §Dispatch — tag identifies pointee; live for this dispatch.
                    unsafe { &mut *batch }.run_on_js_thread();
                })?;
                Ok(())
            }
        )?,
        // A child's stdin pipe is a `FileSink` too, whether or not the program looks at it.
        task_tag::FlushPendingFileSinkTask => {
            counted_arm!(task, [FileSink, Spawn, Shell], |sink: FileSink| {
                sink.run_pending_if_armed();
            })
        }
        task_tag::StreamPending => boxed_arm!(task, [WebStreams], |pending: StreamPending| {
            (*pending).run(StreamResult::Done);
        }),

        _ => {
            // A value outside `task_tag::COUNT` is a producer bug, but it's
            // treated as a recoverable crash, not UB.
            panic!("Unexpected Task tag: {}", task.tag().0);
        }
    }
    Ok(RunTaskResult::Continue)
}

/// Cold-path arms hoisted out of [`run_task`].
///
/// Shell* tags are never seen during `bun <file>` startup, and `--trim` removes the cluster with the shell.
///
/// Returns `()` — none of the cold arms can fail or early-return; the caller
/// falls through to `Ok(RunTaskResult::Continue)`.
#[cold]
#[inline(never)]
fn run_task_cold(task: &Task) {
    bun_removable_features::removable_definition!(Shell, run_task_cold);
    /// Raw `*mut T` (for `heap::take`/self-consuming entry points).
    macro_rules! cast_ptr {
        ($ty:ty) => {
            task.ptr().cast::<$ty>()
        };
    }
    /// The wrapper recovers `&mut Interpreter` from the embedded
    /// `ShellTask.interp` back-ref.
    macro_rules! shell_dispatch {
        ($ty:ty) => {{
            // SAFETY: §Dispatch — `t` is a live heap-allocated shell task;
            // `interp` was set at schedule time and outlives the task.
            unsafe { ShellTask::run_from_main_thread::<$ty>(cast_ptr!($ty)) };
        }};
    }

    match task.tag() {
        // ── shell interpreter ────────────────────────────────────────────
        task_tag::ShellAsync => {
            // SAFETY: §Dispatch — tag identifies pointee.
            let t = unsafe { &*cast_ptr!(crate::shell::dispatch_tasks::ShellAsyncTask) };
            // SAFETY: `interp` set at enqueue; outlives task.
            let interp = unsafe { &*t.interp };
            ShellAsync::run_from_main_thread(interp, t.node.get());
        }
        task_tag::ShellCondExprStatTask => shell_dispatch!(PoolTask<ShellCondExprStatTask>),
        task_tag::ShellCpTask => shell_dispatch!(ShellCpTask),
        task_tag::ShellTouchTask => shell_dispatch!(PoolTask<ShellTouchTask>),
        task_tag::ShellMkdirTask => shell_dispatch!(PoolTask<ShellMkdirTask>),
        task_tag::ShellLsTask => shell_dispatch!(PoolTask<ShellLsTask>),
        task_tag::ShellMvBatchedTask => shell_dispatch!(PoolTask<ShellMvBatchedTask>),
        task_tag::ShellMvCheckTargetTask => shell_dispatch!(PoolTask<ShellMvCheckTargetTask>),
        task_tag::ShellRmTask => shell_dispatch!(ShellRmTask),
        task_tag::ShellRmDirTask => {
            let t = cast_ptr!(ShellRmDirTask);
            ShellRmDirTask::run_from_main_thread(t);
        }
        task_tag::ShellGlobTask => shell_dispatch!(PoolTask<ShellGlobTask>),
        task_tag::ShellYesTask => {
            // SAFETY: §Dispatch — tag identifies pointee; enqueued by `YesTask::enqueue`.
            unsafe { ShellYesTask::run_from_main_thread(cast_ptr!(ShellYesTask)) };
        }

        // Any tag the hot path mis-routed: producer bug.
        _ => panic!("Unexpected Task tag: {}", task.tag().0),
    }
}

/// Compile-time guard that the arm counts in `run_task` and
/// `release_task_unrun` track `bun_event_loop::task_tag::COUNT`. Bump when
/// adding a variant — and give it an arm in both.
const _: () = assert!(
    task_tag::COUNT == 82,
    "dispatch::run_task / release_task_unrun arm count out of sync with bun_event_loop::task_tag",
);

// ────────────────────────────────────────────────────────────────────────────
// `tick_queue_with_count` — the full drain loop.
// ────────────────────────────────────────────────────────────────────────────

pub(crate) fn tick_queue_with_count(
    el: &EventLoop,
    vm: &VirtualMachine,
    counter: &mut u32,
) -> Result<(), Stopped> {
    let global = el.global_ref();
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
    Ok(())
}

// ════════════════════════════════════════════════════════════════════════════
// Poll and pipe dispatch
// ════════════════════════════════════════════════════════════════════════════

/// Hot-path dispatcher for polls and libuv completions. `bun_io` declares it `extern "Rust"` and
/// calls this directly (link-time resolved) so it never names `Subprocess` /
/// `FileSink` / `DNSResolver` / etc.
///
/// # Safety
/// `owner.ptr()` is the live value that the arm of `owner.tag()` casts it to.
#[unsafe(no_mangle)]
unsafe fn __bun_run_io(owner: Owner, event: IoEvent) {
    /// Runs `$body` through [`in_features!`] with `$this = $cast(owner.ptr().cast::<$Ty>())`.
    macro_rules! io_arm {
        ($features:tt, $cast:expr, $Ty:ty, |$this:ident, $kind:pat, $event:ident| $body:expr) => {
            in_features!($features, (owner: Owner = owner, $event: IoEvent = event) {
                // SAFETY: the contract of `__bun_run_io`.
                let $this = unsafe { $cast(owner.ptr().cast::<$Ty>()) };
                let $kind = owner.kind();
                $body
            })
        };
    }

    match owner.tag() {
        #[cfg(not(windows))]
        PollTag::Process => {
            in_features!([ChildProcess], (proc: *mut Process = owner.ptr().cast::<Process>()) {
                // SAFETY: a process frees its poll before it is freed, and `wait` ends with the exit handler.
                Process::wait(unsafe { bun_ptr::ThisPtr::new(proc) }, false);
            })
        }
        #[cfg(not(windows))]
        PollTag::MemoryPressure => {
            crate::node::memory_pressure::on_poll(event.flags, event.size_or_offset);
        }
        #[cfg(target_os = "macos")]
        PollTag::ParentDeathWatchdog => bun_io::parent_death_watchdog::on_parent_exit(),

        #[cfg(not(windows))]
        PollTag::DnsResolver => in_features!(
            [Dns],
            (
                resolver: *const DNSResolver = owner.ptr().cast_const().cast::<DNSResolver>(),
                fd: i32 = event.fd.native(),
                readable: bool = event.flags.contains(PollFlag::Readable),
                writable: bool = event.flags.contains(PollFlag::Writable),
            ) {
                // SAFETY: tag set with this pointee type at `OwnedFilePoll::new`.
                let resolver = unsafe { &*resolver };
                resolver.on_dns_poll(fd, readable, writable);
            }
        ),
        #[cfg(target_os = "macos")]
        PollTag::GetAddrInfoRequest => {
            crate::dns_jsc::dns_sd::SharedConnection::on_readable();
        }

        // A ref is held across the handler, which may release every other one.
        PollTag::FileReader => {
            // SAFETY: fn contract.
            let this = unsafe { RefPtr::init_ref(owner.ptr().cast::<FileReaderSource>()) };
            FileReader::read(&this, Some(event));
        }
        PollTag::FileResponseStream => io_arm!(
            [Serve],
            RefPtr::init_ref,
            FileResponseStream,
            |this, _, event| this.read(Some(event))
        ),
        PollTag::TerminalReader => {
            io_arm!([Terminal], RefPtr::init_ref, Terminal, |this, _, event| {
                this.read(Some(event))
            })
        }
        PollTag::TerminalWriter => {
            io_arm!([Terminal], RefPtr::init_ref, Terminal, |this, _, event| {
                this.on_writer_io(event)
            })
        }
        // A child's stdin pipe is a `FileSink` too, whether or not the program looks at it.
        #[cfg(not(windows))]
        PollTag::FileSink => io_arm!(
            [FileSink, Spawn, Shell],
            RefPtr::init_ref,
            FileSink,
            |this, _, event| this.on_writer_io(event)
        ),
        // Every write completes here, also those of a stream that `Bun.write()` writes to a file.
        #[cfg(windows)]
        PollTag::FileSink => io_arm!(
            [FileSink, Bodies, Spawn, Shell],
            RefPtr::init_ref,
            FileSink,
            |this, _, event| this.on_writer_io(event)
        ),
        #[cfg(windows)]
        PollTag::WindowsNamedPipe => io_arm!(
            [Sockets],
            <*mut _>::as_ref_unchecked,
            WindowsNamedPipe,
            |this, _, event| this.on_writer_io(event)
        ),
        PollTag::ShellIoReader => {
            io_arm!([Shell], clone_rc, ShellIoReader, |this, _, event| {
                this.on_io(event)
            })
        }
        PollTag::ShellPipeReader => {
            io_arm!([Shell], clone_rc, ShellPipeReader, |this, _, event| {
                this.read(Some(event))
            })
        }
        #[cfg(not(windows))]
        PollTag::ShellIoWriter => {
            io_arm!([Shell], clone_rc, ShellIoWriter, |this, _, event| {
                this.on_io(event)
            })
        }
        // Every write completes here, also those of `bun run` and `bun exec`.
        #[cfg(windows)]
        PollTag::ShellIoWriter => {
            io_arm!([Shell, Tools], clone_rc, ShellIoWriter, |this, _, event| {
                this.on_io(event)
            })
        }

        // Neither JS nor a nested tick runs under these.
        PollTag::FilterRunHandle => io_arm!(
            [Tools],
            <*mut _>::as_mut_unchecked,
            filter_run::ProcessHandle<'_>,
            |this, kind, event| this.read(kind, Some(event))
        ),
        PollTag::MultiRunPipeReader => io_arm!(
            [Tools],
            <*mut _>::as_mut_unchecked,
            multi_run::PipeReader<'_>,
            |this, _, event| this.read(Some(event))
        ),
        PollTag::TestParallelWorker => io_arm!(
            [TestCommand],
            <*mut _>::as_mut_unchecked,
            TestParallelWorker,
            |this, kind, event| this.on_io(kind, event)
        ),
        PollTag::SecurityScanReader => io_arm!(
            [Install],
            <*mut _>::as_mut_unchecked,
            SecurityScanSubprocess<'_>,
            |this, _, event| this.on_io(event)
        ),
        PollTag::SecurityScanWriter => io_arm!(
            [Install],
            <*mut _>::as_mut_unchecked,
            SecurityScanSubprocess<'_>,
            |this, _, event| this.on_writer_io(event)
        ),
        PollTag::SubprocessStdinWriter => io_arm!(
            [Spawn],
            <*mut _>::as_ref_unchecked,
            Subprocess<'_>,
            |this, _, event| this.on_stdin_io(event)
        ),

        // Only `Bun.$` redirects stdin from a buffer. `this` is not used once `on_stdin_writer_close` runs, which may free it.
        PollTag::ShellStdinWriter => io_arm!(
            [Shell],
            <*mut _>::as_mut_unchecked,
            ShellSubprocess,
            |this, _, event| if let Some(cmd) = this.on_stdin_io(event) {
                cmd.on_stdin_writer_close();
            }
        ),

        // These free themselves once they have read to the end.
        PollTag::InstallGit => io_arm!(
            [Install],
            bun_ptr::ThisPtr::new,
            GitSubprocess,
            |this, kind, event| GitSubprocess::on_io(this, kind, event)
        ),
        PollTag::SubprocessPipeReader => {
            in_features!([Spawn], (owner: Owner = owner, event: IoEvent = event) {
                // SAFETY: the contract of `__bun_run_io`.
                unsafe { SubprocessPipeReader::on_io(owner.ptr().cast(), event) };
            })
        }
        PollTag::LifecycleScript => {
            in_features!([Install], (owner: Owner = owner, event: IoEvent = event) {
                // SAFETY: the contract of `__bun_run_io`.
                unsafe { LifecycleScriptSubprocess::on_io(owner.ptr().cast(), owner.kind(), event) };
            })
        }
        PollTag::Cron => io_arm!([Cron], bun_ptr::ThisPtr::new, OsJob, |this, _, event| {
            OsJob::on_io(this, event)
        }),

        PollTag::Null => debug_assert!(false, "a poll with no owner fired"),
    }
}

/// # Safety
/// `ptr` is `Rc::as_ptr` of a live `Rc`.
unsafe fn clone_rc<T>(ptr: *mut T) -> Rc<T> {
    // SAFETY: fn contract.
    unsafe {
        Rc::increment_strong_count(ptr);
        Rc::from_raw(ptr)
    }
}

// ════════════════════════════════════════════════════════════════════════════
// io::Poll dispatch
// ════════════════════════════════════════════════════════════════════════════

#[cfg(not(windows))]
use crate::webcore::blob::{fd_job::FdJob, read_file, write_file};
#[cfg(not(windows))]
type ReadFile = FdJob<read_file::ReadFile>;
#[cfg(not(windows))]
type WriteFile = FdJob<write_file::WriteFile>;

/// `bun_io::__bun_io_pollable_on_ready` body — declared `extern "Rust"` in
/// `bun_io`. The owner is recovered from the embedded `io_poll` field.
///
/// # Safety
/// `poll` is the `io_poll` field of a live owner of type `tag`.
#[cfg(not(windows))]
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
#[cfg(not(windows))]
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
                let this = unsafe { &mut *bun_core::from_field_ptr!(WriteFile, io_poll, poll) };
                this.on_io_error(err);
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
/// `timer::ImmediateObject`, and the queue's ref comes with it.
#[unsafe(no_mangle)]
unsafe fn __bun_run_immediate_task(task: *mut (), vm: &VirtualMachine) -> bool {
    // SAFETY: per fn contract — the only producer (`ImmediateObject::init`)
    // stores a `*mut crate::timer::ImmediateObject`, so the cast is the identity.
    let queued = unsafe { bun_ptr::RefPtr::from_raw(task.cast::<crate::timer::ImmediateObject>()) };
    crate::timer::ImmediateObject::run(queued, vm)
}

/// `__bun_cancel_pending_immediate` body — VM-teardown release of the event
/// loop's `+1` ref on a still-queued `ImmediateObject` (low tier stores
/// `*mut ()`, high tier owns the cast). Does not run the callback.
///
/// # Safety
/// `task` was produced by `enqueue_immediate_task` from a live
/// `timer::ImmediateObject` whose event-loop ref has not yet been released;
/// `RuntimeState` is still installed.
#[unsafe(no_mangle)]
unsafe fn __bun_cancel_pending_immediate(task: *mut ()) {
    // SAFETY: per fn contract — the only producer (`ImmediateObject::init`)
    // stores a `*mut crate::timer::ImmediateObject`, so the cast is the identity.
    let queued = unsafe { bun_ptr::RefPtr::from_raw(task.cast::<crate::timer::ImmediateObject>()) };
    queued.release_unrun();
}

/// `__bun_run_wtf_timer` body — cast the low-tier erased `*mut ()` to the real
/// `crate::timer::WTFTimer` and fire it.
///
/// # Safety
/// `timer` was published by `WTFTimer::update` into `imminent_gc_timer` and
/// remains live until consumed; `vm` owns it.
#[unsafe(no_mangle)]
unsafe fn __bun_run_wtf_timer(timer: *mut (), vm: &VirtualMachine) {
    // SAFETY: per fn contract — the only producer (`WTFTimer::update`) stores a
    // `*mut crate::timer::WTFTimer`, so the cast is the identity.
    let real = timer.cast::<crate::timer::WTFTimer>();
    // SAFETY: per fn contract.
    unsafe { crate::timer::WTFTimer::run(real, vm) }
}

// ════════════════════════════════════════════════════════════════════════════
// EventLoopTimer dispatch
// ════════════════════════════════════════════════════════════════════════════

/// The tag→`container_of` match that runs the callback of an [`EventLoopTimer`].
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
/// `now` is the snapshot taken by `All::next`. The handler may free the container — do not touch
/// `t` after the per-arm call returns.
pub(crate) unsafe fn fire_timer(
    t: *mut EventLoopTimer,
    now: &Timespec,
    vm: &VirtualMachine,
) -> bun_event_loop::JsResult<()> {
    use crate::timer::{ImmediateObject, TimeoutObject, WTFTimer};

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

    /// One match-arm body: recover the container as RAW `*mut $Ty` (never
    /// `&mut` — the handler may free it or re-enter), bind `now`/`vm`, and run
    /// `$body` under one `unsafe` covering the per-fn-contract dereferences.
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
                    $now: &Timespec = now,
                    $vm: &VirtualMachine = vm,
                ) -> JsResult<()> {
                    // SAFETY: per fn contract; container derived from a live `$Ty`.
                    let () = unsafe { $body };
                    Ok(())
                }
            )
        };
    }
    let fired: JsResult<()> = match tag {
        // `Bun__JSTimeout__call` reports the callback's exception itself.
        EventLoopTimerTag::TimeoutObject => {
            // SAFETY: per fn contract.
            unsafe { TimeoutObject::fire(t, vm, None) };
            Ok(())
        }
        EventLoopTimerTag::ImmediateObject => {
            // SAFETY: per fn contract.
            unsafe { ImmediateObject::fire(t, vm, None) };
            Ok(())
        }
        EventLoopTimerTag::WTFTimer => {
            timer_arm!(WTFTimer, event_loop_timer, |c, _now, _vm| WTFTimer::fire(c))
        }
        EventLoopTimerTag::AbortSignalTimeout => {
            feature_timer_arm!(
                [AbortSignal],
                AbortSignalTimeout,
                event_loop_timer,
                |c, _now, vm| AbortSignalTimeout::run(c, vm)
            )
        }
        EventLoopTimerTag::WorkerWaitsForRoom => {
            feature_timer_arm!([WorkerConstructor], WebWorker, room_timer, |c, _now, vm| {
                (*c).on_room_timer(vm)
            })
        }
        EventLoopTimerTag::GcRepeating => {
            timer_arm!(
                GarbageCollectionController,
                gc_repeating_timer,
                |c, _now, vm| (*c).on_gc_repeating_timer(vm)
            )
        }
        EventLoopTimerTag::FakeTimersTick => crate::timer::FakeTimers::on_tick_timer(vm.global()),
        EventLoopTimerTag::DateHeaderTimer => {
            timer_arm!(DateHeaderTimer, event_loop_timer, |c, _now, vm| (*c)
                .run(vm))
        }
        EventLoopTimerTag::EventLoopDelayMonitor => {
            feature_timer_arm!(
                [Histogram],
                EventLoopDelayMonitor,
                event_loop_timer,
                |c, now, vm| (*c).on_fire(now, vm)
            )
        }
        EventLoopTimerTag::StatWatcherScheduler => {
            feature_timer_arm!(
                [NodeFs],
                StatWatcherScheduler,
                event_loop_timer,
                |c, _now, _vm| StatWatcherScheduler::timer_callback(bun_ptr::ThisPtr::new(c))
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
                // SAFETY: per fn contract, and the thread has one timer with this tag.
                unsafe { crate::dns_jsc::dns_sd::SharedConnection::on_early_out() };
                Ok(())
            }
            #[cfg(not(target_os = "macos"))]
            {
                if cfg!(debug_assertions) {
                    unreachable!("DnsSdConnection timer on non-macOS");
                }
                Ok(())
            }
        }
        // R-2: shared deref — `check_timeouts` runs script, which re-enters the resolver.
        EventLoopTimerTag::DNSResolver => {
            feature_timer_arm!([Dns], DNSResolver, event_loop_timer, |c, now, vm| {
                (&*c.cast_const()).check_timeouts(now, vm)
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
                unsafe { (*container).on_reconnect_timer() };
                Ok(())
            }
        ),
        EventLoopTimerTag::SubprocessTimeout => {
            feature_timer_arm!([Spawn], Subprocess<'_>, event_loop_timer, |c, _now, _vm| {
                (*c).timeout_callback()
            })
        }
        EventLoopTimerTag::DevServerSweepSourceMaps => in_features!(
            [Bundler],
            (t: *mut EventLoopTimer = t, now: &Timespec = now) -> JsResult<()> {
                // `sweep_weak_refs` takes the raw `*EventLoopTimer` and recovers
                // the store inside.
                SourceMapStore::sweep_weak_refs(t, now);
                Ok(())
            }
        ),
        EventLoopTimerTag::DevServerMemoryVisualizerTick => in_features!(
            [Bundler],
            (t: *mut EventLoopTimer = t) -> JsResult<()> {
                DevServer::emit_memory_visualizer_message_timer(t);
                Ok(())
            }
        ),
        EventLoopTimerTag::BunTest => in_features!(
            [Test],
            (t: *mut EventLoopTimer = t, now: &Timespec = now) -> JsResult<()> {
                if let Some(file) = clone_active_strong()
                    && core::ptr::eq(&raw const *file.timer, t)
                {
                    BunTest::bun_test_timeout_callback(&file, now, VirtualMachine::get());
                } else {
                    // SAFETY: `t` was just popped, and a timer leaves the heap before it is dropped.
                    let timer = unsafe { &*t };
                    timer.next.set(Timespec::EPOCH);
                    timer.state.set(crate::timer::EventLoopTimerState::PENDING);
                }
                Ok(())
            }
        ),
        EventLoopTimerTag::CronJob => in_features!(
            [Cron],
            (c: *mut CronJob = owner!(CronJob, event_loop_timer)) -> JsResult<()> {
                // SAFETY: an armed job roots its JS wrapper, which owns `c`, and this call runs no script.
                if let Some(root) = unsafe { (*c).timer_fired() } {
                    CronJob::tick(&root, VirtualMachine::get());
                }
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
        EventLoopTimerTag::ViWait => in_features!(
            [Test],
            (
                c: *mut crate::test_runner::vi_wait::ViWait =
                    owner!(crate::test_runner::vi_wait::ViWait, timer),
                now: &Timespec = now,
                vm: &VirtualMachine = vm,
            ) -> JsResult<()> {
                // SAFETY: an armed wait roots its JS wrapper, which owns `c`.
                unsafe { (*c).on_timer_fire(now, vm) }
            }
        ),
        EventLoopTimerTag::UvTimer => {
            #[cfg(unix)]
            {
                use crate::napi::uv_posix::UvTimerNode;
                in_features!(
                    [NativeAddons],
                    (
                        c: *mut UvTimerNode = owner!(UvTimerNode, event_loop_timer),
                        vm: &VirtualMachine = vm,
                    ) -> JsResult<()> {
                        // SAFETY: per fn contract, `c` is a started `uv_timer_t`'s node.
                        unsafe { UvTimerNode::on_fire(c, vm) }
                    }
                )
            }
            #[cfg(not(unix))]
            {
                if cfg!(debug_assertions) {
                    unreachable!("UvTimer timer on Windows, where addons get libuv's");
                }
                Ok(())
            }
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

/// `__bun_tick_queue_with_count` body — declared `extern "Rust"` in
/// `bun_jsc::event_loop`. `el` is the queue to drain; for
/// `SpawnSyncEventLoop.tickTasksOnly`
/// this is the isolated loop, **not** `vm.event_loop()`.
#[unsafe(no_mangle)]
fn __bun_tick_queue_with_count(
    el: &EventLoop,
    vm: &VirtualMachine,
    counter: &mut u32,
) -> Result<(), Stopped> {
    tick_queue_with_count(el, vm, counter)
}

// (former duplicate `__bun_run_tasks` removed r6 — `bun_jsc::task::run_tasks`
// had no callers; `__bun_tick_queue_with_count` above is the sole entry point.)

/// `__bun_release_task_unrun` — declared `extern "Rust"` in
/// `bun_jsc::event_loop`. A queued task that will never be dispatched (its VM
/// is tearing down: script is forbidden and the loop no longer ticks) is freed
/// through its type's `release_unrun`.
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
            unsafe { <$ty as Taskable>::release_unrun(task.ptr().cast::<$ty>()) }
        }};
    }
    /// [`release!`] through [`in_features!`], with the features of the tag's arm in [`run_task`].
    macro_rules! release_in {
        ($features:tt, $ty:ty) => {
            in_features!($features, (payload: *mut $ty = task.ptr().cast::<$ty>()) {
                // SAFETY: as `release!`.
                unsafe { <$ty as bun_event_loop::Taskable>::release_unrun(payload) }
            })
        };
    }
    /// [`release_in!`] for a [`BoxedTask`].
    macro_rules! release_boxed_in {
        ($features:tt, $ty:ty) => {
            boxed_arm!(task, $features, |payload: $ty| { payload.release_unrun() })
        };
    }
    /// [`release_in!`] for a [`RefTask`].
    macro_rules! release_counted_in {
        ($features:tt, $ty:ty) => {
            counted_arm!(task, $features, |payload: $ty| {
                <$ty as RefTask>::release_unrun(payload)
            })
        };
    }
    match task.tag() {
        task_tag::AnyTaskJob => {
            // The one erased tag: every payload is a `Job<C>` reached through its header.
            // SAFETY: as `release!`.
            unsafe { bun_jsc::job::release_unrun_erased(task.ptr()) }
        }
        task_tag::BakePendingReloadEvent => release_counted_in!([Bundler], BakePendingReloadEvent),
        task_tag::BundleV2DeferredBatchTask => release_in!([Bundler], BundleV2DeferredBatchTask),
        task_tag::BundleV2PluginResolve => {
            release_boxed_in!(
                [Bundler],
                bun_bundler::bundle_v2::api::JSBundler::Resolve<'static>
            )
        }
        task_tag::BundleV2PluginLoad => {
            release_boxed_in!(
                [Bundler],
                bun_bundler::bundle_v2::api::JSBundler::Load<'static>
            )
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
            release_boxed_in!(
                [Fetch],
                crate::webcore::fetch::fetch_tasklet::FetchTaskletPromiseSettle
            )
        }
        task_tag::FSWatchTask => release_boxed_in!([NodeFs], FSWatchTask),
        task_tag::HotReloadTask => release_boxed_in!([HotReload], hot_reloader::HotReloadTask),
        task_tag::JSBundleCompletionTask => release_boxed_in!([Bundler], JSBundleCompletionTask),
        task_tag::JSCDeferredWorkTask => release!(JSCDeferredWorkTask),
        task_tag::BundleV2PluginResolveAnswered => {
            release_boxed_in!(
                [Bundler],
                bun_bundler::bundle_v2::api::JSBundler::ResolveAnswered
            )
        }
        task_tag::BundleV2PluginLoadAnswered => {
            release_boxed_in!(
                [Bundler],
                bun_bundler::bundle_v2::api::JSBundler::LoadAnswered
            )
        }
        task_tag::BundleV2PluginLoadDeferred => {
            release_in!(
                [Bundler],
                bun_bundler::bundle_v2::api::JSBundler::LoadDeferred
            )
        }
        task_tag::BundleV2ParseTaskResult => {
            release_boxed_in!([Bundler], BundleV2ParseTaskResult)
        }
        task_tag::FetchTaskletRequestDrain => {
            release_in!([Fetch], crate::webcore::fetch::FetchTaskletRequestDrain)
        }
        task_tag::HTMLRewriterBackgroundPull => {
            release_counted_in!(
                [HtmlRewriter],
                crate::api::html_rewriter::RewriterPipeBackgroundPull
            )
        }
        task_tag::RunTestsTask => {
            release_boxed_in!([Test], crate::test_runner::bun_test::RunTestsTask)
        }
        task_tag::DnsErrorDeferred => {
            release_boxed_in!([Dns], crate::dns_jsc::cares_jsc::ErrorDeferredTask)
        }
        task_tag::HandledPromise => {
            boxed!(task, bun_jsc::virtual_machine_exports::HandledPromiseTask).release_unrun()
        }
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
        task_tag::NapiFinalizerTask => release_boxed_in!([NativeAddons], NapiFinalizerTask),
        task_tag::NativePromiseContextDeferredDerefTask => {
            release_in!(
                [Serve, HtmlRewriter, S3Client],
                NativePromiseContextDeferredDerefTask
            )
        }
        task_tag::PosixSignalTask => release!(PosixSignalTask),
        task_tag::MemoryPressureTask => release!(crate::node::memory_pressure::MemoryPressureTask),
        task_tag::ProcessWaiterThreadTask => {
            #[cfg(not(windows))]
            release_boxed_in!([ChildProcess], ProcessWaiterThreadTask<Process>);
            #[cfg(windows)]
            unreachable!("posix-only tag");
        }
        task_tag::FlushPendingFileSinkTask => {
            release_counted_in!([FileSink, Spawn, Shell], FileSink)
        }
        task_tag::RuntimeTranspilerStore => {
            release_in!([RuntimeTranspiler], RuntimeTranspilerStore)
        }
        task_tag::S3HttpDownloadStreamingTask => {
            release_in!([S3Client], S3HttpDownloadStreamingTask)
        }
        task_tag::S3HttpSimpleTask => release_in!([S3Client], S3HttpSimpleTask),
        task_tag::S3RefusedRequest => release_boxed_in!([S3Client], S3RefusedRequest),
        task_tag::S3UploadWriterCollected => {
            release_counted_in!([S3Client], S3UploadWriterCollected)
        }
        task_tag::SendQueueDeferred => release_counted_in!([Ipc], crate::ipc::SendQueue),
        task_tag::ServerAllConnectionsClosedTask => {
            release_boxed_in!([Serve], ServerAllConnectionsClosedTask)
        }
        task_tag::ShellAsync => release_in!([Shell], crate::shell::dispatch_tasks::ShellAsyncTask),
        task_tag::ShellCondExprStatTask => release_in!([Shell], PoolTask<ShellCondExprStatTask>),
        task_tag::ShellCpTask => release_in!([Shell], ShellCpTask),
        task_tag::ShellGlobTask => release_in!([Shell], PoolTask<ShellGlobTask>),
        task_tag::ShellLsTask => release_in!([Shell], PoolTask<ShellLsTask>),
        task_tag::ShellMkdirTask => release_in!([Shell], PoolTask<ShellMkdirTask>),
        task_tag::ShellMvBatchedTask => release_in!([Shell], PoolTask<ShellMvBatchedTask>),
        task_tag::ShellMvCheckTargetTask => release_in!([Shell], PoolTask<ShellMvCheckTargetTask>),
        task_tag::ShellRmDirTask => release_in!([Shell], ShellRmDirTask),
        task_tag::ShellRmTask => release_in!([Shell], ShellRmTask),
        task_tag::ShellTouchTask => release_in!([Shell], PoolTask<ShellTouchTask>),
        task_tag::StatWatcherTimerUpdate => {
            release_boxed_in!(
                [NodeFs],
                crate::node::node_fs_stat_watcher::StatWatcherTimerUpdate
            )
        }
        task_tag::StatWatcherHop => {
            release_counted_in!([NodeFs], crate::node::node_fs_stat_watcher::StatWatcher)
        }
        task_tag::AsyncCpTask => release_boxed_in!([NodeFs], crate::node::fs::AsyncCpTask),
        task_tag::ShellAsyncCpTask => release_boxed_in!([Shell], crate::node::fs::ShellAsyncCpTask),
        task_tag::StreamPending => release_boxed_in!([WebStreams], StreamPending),
        task_tag::ThreadSafeFunction => release_counted_in!([NativeAddons], ThreadSafeFunction),
        task_tag::ThreadSafeFunctionRefRequest => {
            release_boxed_in!([NativeAddons], TsfnRefRequest)
        }
        task_tag::UvLoopDispatch => {
            #[cfg(unix)]
            release_in!([NativeAddons], crate::napi::uv_posix::UvLoop);
            #[cfg(not(unix))]
            unreachable!("posix-only tag");
        }
        task_tag::UvHandleClose => {
            #[cfg(unix)]
            release_in!([NativeAddons], crate::napi::uv_posix::UvHandle);
            #[cfg(not(unix))]
            unreachable!("posix-only tag");
        }
        task_tag::UvWorkDone => {
            #[cfg(unix)]
            release_in!([NativeAddons], crate::napi::uv_posix::UvWork);
            #[cfg(not(unix))]
            unreachable!("posix-only tag");
        }
        task_tag::ValkeyDeferredClose => {
            release_boxed_in!([Valkey], crate::valkey_jsc::js_valkey::ValkeyDeferredClose)
        }
        // ── Windows-only producers ───────────────────────────────────────
        task_tag::GetAddrInfoLibuvComplete => {
            #[cfg(windows)]
            boxed!(task, crate::dns_jsc::LibuvRequest).release_unrun();
            #[cfg(not(windows))]
            unreachable!("windows-only tag");
        }
        task_tag::UvDnsPollFree => {
            #[cfg(windows)]
            release!(crate::dns_jsc::UvDnsPoll);
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
            release_boxed_in!([Bodies], crate::webcore::blob::copy_file::CopyFileWindows);
            #[cfg(not(windows))]
            unreachable!("windows-only tag");
        }
        task_tag::WriteFileWindowsMkdirp => {
            #[cfg(windows)]
            release_boxed_in!([Bodies], crate::webcore::blob::write_file::WriteFileWindows);
            #[cfg(not(windows))]
            unreachable!("windows-only tag");
        }
        task_tag::ChromePipeEvent => {
            #[cfg(windows)]
            release_boxed_in!([WebView], crate::webview::chrome_process::QueuedEvent);
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
                    ($($tag:ident $ty:ident;)*) => { match task.tag() {
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
        _ => unreachable!("task tag out of range: {}", task.tag().0),
    }
}
