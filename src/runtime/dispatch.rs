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
//!   2. `impl bun_event_loop::BoxedTask for YourType` if it is queued as a `Box`, otherwise `Taskable`;
//!   3. a `run_task` arm and a `release_task_unrun` arm here, both through `in_features!` if only code of removable features (`src/trim/features`) queues it;
//!   4. bump the `task_tag::COUNT` assertion below.

use bun_event_loop::{BoxedTask, Task, task_tag};
use bun_ptr::RefPtr;

#[cfg(not(windows))]
use bun_io::posix_event_loop::Flags as PollFlag;
use bun_io::{IoEvent, Owner, PollTag};

use bun_core::Timespec;
use bun_event_loop::EventLoopTimer::{ImmediateTask, Popped, Tag as EventLoopTimerTag, TimerHeap};

use bun_jsc::event_loop::{EventLoop, Stopped};
use bun_jsc::task::report_error_or_terminate;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

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

// ── per-variant payload types ────────────────────────────────────────────────
// (high-tier owns them all; grouped by source module)

use crate::shell::builtins::{
    cp::ShellCpTask,
    ls::ShellLsTask,
    mkdir::ShellMkdirTask,
    mv::{ShellMvBatchedTask, ShellMvCheckTargetTask},
    touch::ShellTouchTask,
    yes::YesTask as ShellYesTask,
};
use crate::shell::dispatch_tasks::{
    ShellAsyncTask, ShellCondExprStatTask, ShellGlobTask, ShellRmDirTask,
};
use crate::shell::interpreter::{NodeId, PoolTask, ShellInterpreter, ShellTask};
use crate::shell::io_reader::IOReaderId;
use crate::shell::io_writer::IOWriterId;

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
use crate::api::js_bundle_completion_task::JSBundleCompletionTask;
use crate::api::native_promise_context::DeferredDerefTask as NativePromiseContextDeferredDerefTask;

use crate::napi::{NapiFinalizerTask, ThreadSafeFunction, TsfnRefRequest, napi_async_work};

use bun_jsc::PosixSignalTask;
use bun_jsc::RuntimeTranspilerStore;
use bun_jsc::cpp_task::CppTask;
use bun_jsc::hot_reloader;
use bun_jsc::jsc_scheduler::JSCDeferredWorkTask;

use crate::bake::dev_server::{
    DevServer, DevServerTimers, PendingReloadEvent as BakePendingReloadEvent,
};

#[cfg(windows)]
use crate::node::fs::async_ as fs_async;
use crate::node::node_fs_stat_watcher::StatWatcherScheduler;
use crate::node::node_fs_watcher::FSWatchTask;

use crate::dns_jsc::Resolver as DNSResolver;
use crate::server::{FileResponseStream, ServerAllConnectionsClosedTask};

use crate::cli::test::parallel::worker::Worker as TestParallelWorker;
use crate::cli::{filter_run, multi_run};
use bun_install::SecurityScanSubprocess;
use bun_install::buffered_subprocess::OutputReaders;

#[cfg(not(windows))]
use crate::api::bun_process::Process;
#[cfg(unix)]
use crate::api::bun_process::waiter_thread_posix::ResultTask as ProcessWaiterThreadTask;

use bun_bundler::DeferredBatchTask::DeferredBatchTask as BundleV2DeferredBatchTask;
type BundleV2ParseTaskResult = bun_bundler::parse_task::Result<'static>;

#[cfg(windows)]
use crate::socket::windows_named_pipe::WindowsNamedPipe;

use crate::valkey_jsc::js_valkey::JSValkeyClient as Valkey;
use bun_sql_jsc::mysql::js_my_sql_connection::JSMySQLConnection as MySQLConnection;
use bun_sql_jsc::postgres::PostgresSQLConnection;
use bun_sql_jsc::shared::connection_timers::TimedConnection as _;

use crate::jsc_hooks::timer_all;
use crate::test_runner::bun_test::{BunTest, BunTestRoot, clone_active_strong};
use crate::timer::{EventLoopDelayMonitor, ImmediateObject, TimeoutObject};
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
        task_tag::SendQueueDeferred => feature_arm!([Ipc], |queue: crate::ipc::SendQueue| {
            // SAFETY: §Dispatch — tag identifies pointee; the task owns a ref.
            unsafe { bun_ptr::RefPtr::from_raw(queue) }.run_deferred();
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
        task_tag::WindowsNamedPipeDeinit => {
            // SAFETY: tag identifies the pointee; the queue owns it until here.
            unsafe { bun_core::heap::destroy(cast_ptr!(WindowsNamedPipe)) };
        }
        #[cfg(windows)]
        task_tag::GetAddrInfoLibuvComplete => {
            boxed!(task, crate::dns_jsc::LibuvRequest).run();
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
        task_tag::StatWatcherHop => feature_arm!(
            [NodeFs],
            |watcher: crate::node::node_fs_stat_watcher::StatWatcher| -> JsResult<()> {
                // SAFETY: posted by `StatWatcher::post_to_js_thread` with a ref held.
                unsafe { crate::node::node_fs_stat_watcher::StatWatcher::run_hop(watcher) }?;
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
        task_tag::HTMLRewriterBackgroundPull => feature_arm!(
            [HtmlRewriter],
            |pipe: crate::api::html_rewriter::RewriterPipe| {
                // SAFETY: §Dispatch — tag identifies pointee; the task owns a ref.
                unsafe { bun_ptr::RefPtr::from_raw(pipe) }.run_background_pull();
            }
        ),
        task_tag::RunTestsTask => boxed_arm!(
            task,
            [Test],
            |run: crate::test_runner::bun_test::RunTestsTask| -> JsResult<()> { run.call() }
        )?,
        task_tag::ValkeyDeferredFailure => boxed_arm!(
            task,
            [Valkey],
            |failure: crate::valkey_jsc::valkey::DeferredFailure| -> JsResult<()> { failure.run() }
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
        | task_tag::ShellRmDirTask
        | task_tag::ShellGlobTask
        | task_tag::ShellYesTask => run_task_cold(task),

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
        task_tag::S3UploadWriterCollected => feature_arm!(
            [S3Client],
            |collected: S3UploadWriterCollected| -> JsResult<()> {
                S3UploadWriterCollected::run(collected)?;
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
                function: *mut ThreadSafeFunction = cast_ptr!(ThreadSafeFunction),
                el: &EventLoop = el,
                vm: &VirtualMachine = vm,
            ) {
                // SAFETY: §Dispatch — tag identifies pointee; the task owns a ref.
                let function = unsafe { std::sync::Arc::from_raw(function) };
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
            // SAFETY: §Dispatch — the tag identifies the type, and the task left its queue once.
            unsafe { JSCDeferredWorkTask::run(cast_ptr!(JSCDeferredWorkTask), global) }?;
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
        task_tag::BakeFinishBundle => {
            // SAFETY: §Dispatch — tag identifies pointee.
            unsafe { DevServer::finish_bundle(cast_ptr!(DevServer)) }?;
        }
        task_tag::BakePendingReloadEvent => {
            // SAFETY: §Dispatch — tag identifies pointee.
            unsafe { BakePendingReloadEvent::run(cast_ptr!(BakePendingReloadEvent)) };
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
            [Serve, HtmlRewriter, S3Client, Cron],
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
        // A child's stdin pipe and a stream written to a file make a `FileSink` that the program need not name.
        task_tag::FlushPendingFileSinkTask => {
            feature_arm!([FileSink, Bodies, Spawn], |sink: FileSink| {
                // SAFETY: §Dispatch — tag identifies pointee; the task owns a ref.
                unsafe { RefPtr::from_raw(sink) }.run_pending_if_armed();
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
fn run_task_cold(task: Task) {
    bun_removable_features::removable_definition!(Shell, run_task_cold);
    macro_rules! shell_dispatch {
        ($ty:ty) => {{
            let task = boxed!(task, $ty);
            // SAFETY: `ShellTask::on_finish` posted it to this loop.
            unsafe { ShellTask::run_from_main_thread(task) };
        }};
    }

    match task.tag() {
        // ── shell interpreter ────────────────────────────────────────────
        task_tag::ShellAsync => {
            let task = boxed!(task, ShellAsyncTask);
            // SAFETY: `Async::enqueue_self` queued it on this loop.
            unsafe { task.run_from_main_thread() };
        }
        task_tag::ShellCondExprStatTask => shell_dispatch!(PoolTask<ShellCondExprStatTask>),
        task_tag::ShellCpTask => shell_dispatch!(ShellCpTask),
        task_tag::ShellTouchTask => shell_dispatch!(PoolTask<ShellTouchTask>),
        task_tag::ShellMkdirTask => shell_dispatch!(PoolTask<ShellMkdirTask>),
        task_tag::ShellLsTask => shell_dispatch!(ShellLsTask),
        task_tag::ShellMvBatchedTask => shell_dispatch!(PoolTask<ShellMvBatchedTask>),
        task_tag::ShellMvCheckTargetTask => shell_dispatch!(PoolTask<ShellMvCheckTargetTask>),
        task_tag::ShellRmDirTask => shell_dispatch!(ShellRmDirTask),
        task_tag::ShellGlobTask => shell_dispatch!(PoolTask<ShellGlobTask>),
        task_tag::ShellYesTask => {
            let task = boxed!(task, ShellYesTask);
            // SAFETY: `YesTask::enqueue` queued it on this loop.
            unsafe { task.run_from_main_thread() };
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
        ($features:tt, $cast:expr, $Ty:ty, |$this:ident, $owner:pat, $event:ident| $body:expr) => {
            in_features!($features, (owner: Owner = owner, $event: IoEvent = event) {
                // SAFETY: the contract of `__bun_run_io`.
                let $this = unsafe { $cast(owner.ptr().cast::<$Ty>()) };
                let $owner = owner;
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
                // R-2: deref as shared (`&*const`) — `on_dns_poll` takes `&self` and
                // `Channel::process` re-enters the resolver via c-ares callbacks.
                // SAFETY: tag set with this pointee type at `OwnedFilePoll::new`.
                let resolver = unsafe { &*resolver };
                resolver.on_dns_poll(fd, readable, writable);
            }
        ),
        #[cfg(target_os = "macos")]
        PollTag::GetAddrInfoRequest => {
            crate::dns_jsc::dns_sd::SharedConnection::on_readable(owner.ptr().cast());
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
        // A child's stdin pipe and a stream written to a file make a `FileSink` that the program need not name.
        PollTag::FileSink => io_arm!(
            [FileSink, Bodies, Spawn],
            RefPtr::init_ref,
            FileSink,
            |this, _, event| this.on_writer_io(event)
        ),
        // `on_io` takes the ref.
        #[cfg(windows)]
        PollTag::WindowsNamedPipe => io_arm!(
            [Sockets],
            <*mut _>::as_ref_unchecked,
            WindowsNamedPipe,
            |this, _, event| this.on_io(event)
        ),

        // Its owner keeps it until the task that reports the close has run.
        #[cfg(windows)]
        PollTag::SendQueue => io_arm!(
            [Ipc],
            <*mut _>::as_ref_unchecked,
            crate::ipc::SendQueue,
            |this, _, event| this.on_io(event)
        ),
        // Not refcounted: `on_io` runs no code of the owner.
        #[cfg(windows)]
        PollTag::TestParallelChannel => io_arm!(
            [TestCommand],
            <*mut _>::as_ref_unchecked,
            crate::cli::test::parallel::channel::Channel,
            |this, _, event| this.on_io(event)
        ),
        // `bun run` and `bun exec` run the interpreter too. The handlers keep the JS wrapper alive.
        PollTag::ShellIoReader => io_arm!(
            [Shell, Tools],
            <*mut _>::as_ref_unchecked,
            ShellInterpreter,
            |this, owner, event| this.on_reader_io(IOReaderId::init(owner.key()), event)
        ),
        PollTag::ShellIoWriter => io_arm!(
            [Shell, Tools],
            <*mut _>::as_ref_unchecked,
            ShellInterpreter,
            |this, owner, event| this.on_writer_io(IOWriterId::init(owner.key()), event)
        ),
        PollTag::ShellPipeReader => io_arm!(
            [Shell, Tools],
            <*mut _>::as_ref_unchecked,
            ShellInterpreter,
            |this, owner, event| this.on_pipe_reader_io(NodeId(owner.key()), owner.kind(), event)
        ),
        // Only `Bun.$` redirects stdin from a buffer.
        PollTag::ShellStdinWriter => io_arm!(
            [Shell],
            <*mut _>::as_ref_unchecked,
            ShellInterpreter,
            |this, owner, event| this.on_subproc_stdin_io(NodeId(owner.key()), event)
        ),

        // Neither JS nor a nested tick runs under these.
        PollTag::FilterRunHandle => io_arm!(
            [Tools],
            <*mut _>::as_mut_unchecked,
            filter_run::ProcessHandle<'_>,
            |this, owner, event| this.read(owner.kind(), Some(event))
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
            |this, owner, event| this.on_io(owner.kind(), event)
        ),
        PollTag::SecurityScanReader => io_arm!(
            [Install],
            <*mut _>::as_mut_unchecked,
            SecurityScanSubprocess,
            |this, _, event| this.on_io(event)
        ),
        PollTag::SecurityScanWriter => io_arm!(
            [Install],
            <*mut _>::as_mut_unchecked,
            SecurityScanSubprocess,
            |this, _, event| this.on_writer_io(event)
        ),
        PollTag::InstallSubprocess => io_arm!(
            [Install],
            <*mut _>::as_ref_unchecked,
            OutputReaders,
            |this, owner, event| this.on_io(owner.kind(), event)
        ),
        PollTag::SubprocessStdinWriter => io_arm!(
            [Spawn],
            <*mut _>::as_ref_unchecked,
            Subprocess<'_>,
            |this, _, event| this.on_stdin_io(event)
        ),

        // These free themselves once they have read to the end.
        PollTag::SubprocessPipeReader => {
            in_features!([Spawn], (owner: Owner = owner, event: IoEvent = event) {
                // SAFETY: the contract of `__bun_run_io`.
                unsafe { SubprocessPipeReader::on_io(owner.ptr().cast(), event) };
            })
        }
        PollTag::CronRegister | PollTag::CronRemove => {
            in_features!([Cron], (owner: Owner = owner, event: IoEvent = event) {
                // SAFETY: the contract of `__bun_run_io`.
                unsafe { crate::api::cron::on_io(owner, event) };
            })
        }

        PollTag::Null => debug_assert!(false, "a poll with no owner fired"),
    }
}

// ════════════════════════════════════════════════════════════════════════════
// `bun_jsc::event_loop` extern impls (link-time)
// ════════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
fn __bun_run_immediate_task(task: ImmediateTask, vm: &VirtualMachine) -> bool {
    ImmediateObject::run_immediate_task(task.into_owner_ref(), vm)
}

/// VM-teardown release of the event loop's `+1` ref on a still-queued `ImmediateObject`. Does not run the callback.
#[unsafe(no_mangle)]
fn __bun_cancel_pending_immediate(task: ImmediateTask, vm: &VirtualMachine) {
    task.into_owner_ref::<ImmediateObject>()
        .cancel_pending_immediate(vm);
}

/// `__bun_run_wtf_timer` body — cast the low-tier erased `*mut ()` to the real
/// `crate::timer::WTFTimer` and fire it.
///
/// # Safety
/// `timer` was published by `WTFTimer::update` into `imminent_gc_timer` and
/// remains live until consumed.
#[unsafe(no_mangle)]
unsafe fn __bun_run_wtf_timer(timer: *mut ()) {
    // SAFETY: per fn contract — the only producer (`WTFTimer::update`) stores a
    // `*mut crate::timer::WTFTimer`, so the cast is the identity.
    let real = timer.cast::<crate::timer::WTFTimer>();
    // SAFETY: per fn contract.
    unsafe { crate::timer::WTFTimer::run(real) }
}

// ════════════════════════════════════════════════════════════════════════════
// EventLoopTimer dispatch
// ════════════════════════════════════════════════════════════════════════════

/// `Popped::$into` for the tag of the arm.
macro_rules! timer_owner {
    ($timer:ident.$into:ident::<$tag:ident>()) => {{
        // Infers the owner from the only `OwnedBy` impl, so a second owner of the tag does not compile.
        let _ = Popped::$into::<{ EventLoopTimerTag::$tag }, _>;
        $timer.$into::<{ EventLoopTimerTag::$tag }, _>()
    }};
}

/// Pops the first timer of `heap` and runs its callback. `thrown` receives the exception of a JS timer's callback.
///
/// Each arm is the owner's timer entry with its result surfaced: an owner
/// returns the exception it left pending and never reports it; the drain loop
/// (`All::drain_timers`) folds every timer's result in one place.
pub(crate) fn fire_first_timer(
    heap: &TimerHeap,
    now: &Timespec,
    vm: &VirtualMachine,
    thrown: Option<&mut JSValue>,
) -> bun_event_loop::JsResult<()> {
    let Some(timer) = heap.delete_min() else {
        return Ok(());
    };

    /// `$owner` is the ref that the heap held, or points at the pinned owner, which is live when `$body` starts.
    macro_rules! feature_timer_arm {
        ($features:tt, $into:ident::<$tag:ident>, |$owner:ident: $Ptr:ty, $now:ident, $vm:ident| $body:expr) => {
            in_features!(
                $features,
                (
                    $owner: $Ptr = timer_owner!(timer.$into::<$tag>()),
                    $now: &Timespec = now,
                    $vm: &VirtualMachine = vm,
                ) -> JsResult<()> { $body }
            )
        };
    }
    match timer.tag() {
        // `Bun__JSTimeout__call` reports the callback's exception itself.
        EventLoopTimerTag::TimeoutObject => {
            let timeout = timer_owner!(timer.into_owner_ref::<TimeoutObject>());
            TimeoutObject::fire_catching(timeout, vm, thrown);
            Ok(())
        }
        EventLoopTimerTag::ImmediateObject => in_features!(
            [Test],
            (
                immediate: RefPtr<ImmediateObject> =
                    timer_owner!(timer.into_owner_ref::<ImmediateObject>()),
                vm: &VirtualMachine = vm,
                thrown: Option<&mut JSValue> = thrown,
            ) -> JsResult<()> {
                ImmediateObject::fire_catching(immediate, vm, thrown);
                Ok(())
            }
        ),
        EventLoopTimerTag::AbortSignalTimeout => feature_timer_arm!(
            [AbortSignal],
            into_owner_ptr::<AbortSignalTimeout>,
            |timeout: *mut AbortSignalTimeout, _now, vm| {
                // SAFETY: live, see `feature_timer_arm!`.
                unsafe { AbortSignalTimeout::run(timeout, vm) };
                Ok(())
            }
        ),
        EventLoopTimerTag::WorkerWaitsForRoom => feature_timer_arm!(
            [WorkerConstructor],
            into_owner_ref::<WorkerWaitsForRoom>,
            |worker: RefPtr<WebWorker>, _now, vm| {
                WebWorker::on_room_timer(worker, vm);
                Ok(())
            }
        ),
        EventLoopTimerTag::GcRepeating => {
            let _ = timer_owner!(timer.into_owner_ptr::<GcRepeating>());
            GarbageCollectionController::on_gc_repeating_timer();
            Ok(())
        }
        EventLoopTimerTag::FakeTimersTick => {
            let _ = timer_owner!(timer.into_owner_ptr::<FakeTimersTick>());
            crate::timer::FakeTimers::on_tick_timer(vm.global())
        }
        EventLoopTimerTag::DateHeaderTimer => {
            let _ = timer_owner!(timer.into_owner_ptr::<DateHeaderTimer>());
            timer_all().date_header_timer.run(vm);
            Ok(())
        }
        EventLoopTimerTag::EventLoopDelayMonitor => feature_timer_arm!(
            [Histogram],
            into_owner_ptr::<EventLoopDelayMonitor>,
            |_monitor: *mut EventLoopDelayMonitor, now, vm| {
                timer_all().event_loop_delay.on_fire(now, vm);
                Ok(())
            }
        ),
        EventLoopTimerTag::StatWatcherScheduler => feature_timer_arm!(
            [NodeFs],
            into_owner_ref::<StatWatcherScheduler>,
            |scheduler: RefPtr<StatWatcherScheduler>, _now, _vm| {
                StatWatcherScheduler::timer_callback(scheduler);
                Ok(())
            }
        ),
        EventLoopTimerTag::UpgradedDuplex => feature_timer_arm!(
            [Sockets],
            into_owner_ptr::<UpgradedDuplex>,
            |context: *mut crate::socket::DuplexUpgradeContext, _now, _vm| {
                // SAFETY: only a queued task frees it.
                unsafe { &(*context).upgrade }.on_timeout();
                Ok(())
            }
        ),
        EventLoopTimerTag::DnsSdConnection => {
            #[cfg(target_os = "macos")]
            {
                let _ = timer_owner!(timer.into_owner_ptr::<DnsSdConnection>());
                crate::dns_jsc::dns_sd::SharedConnection::on_early_out();
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
        EventLoopTimerTag::DNSResolver => feature_timer_arm!(
            [Dns],
            into_owner_ref::<DNSResolver>,
            |resolver: RefPtr<DNSResolver>, now, vm| {
                resolver.check_timeouts(now, vm);
                Ok(())
            }
        ),
        EventLoopTimerTag::WindowsNamedPipe => {
            #[cfg(windows)]
            {
                let pipe: *mut WindowsNamedPipe =
                    timer_owner!(timer.into_owner_ptr::<WindowsNamedPipe>());
                // SAFETY: only a queued task frees it.
                unsafe { &*pipe }.on_timeout();
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
        EventLoopTimerTag::PostgresSQLConnectionTimeout => feature_timer_arm!(
            [Sql],
            into_owner_ptr::<PostgresSQLConnectionTimeout>,
            |connection: *mut PostgresSQLConnection, _now, _vm| {
                // SAFETY: it roots its wrapper until it fails. What runs script holds a `ref_guard()` or is the last use.
                unsafe { &*connection }.on_connection_timeout();
                Ok(())
            }
        ),
        EventLoopTimerTag::PostgresSQLConnectionMaxLifetime => feature_timer_arm!(
            [Sql],
            into_owner_ptr::<PostgresSQLConnectionMaxLifetime>,
            |connection: *mut PostgresSQLConnection, _now, _vm| {
                // SAFETY: as above.
                unsafe { &*connection }.on_max_lifetime_timeout();
                Ok(())
            }
        ),
        EventLoopTimerTag::MySQLConnectionTimeout => feature_timer_arm!(
            [Sql],
            into_owner_ptr::<MySQLConnectionTimeout>,
            |connection: *mut MySQLConnection, _now, _vm| {
                // SAFETY: as above.
                unsafe { &*connection }.on_connection_timeout();
                Ok(())
            }
        ),
        EventLoopTimerTag::MySQLConnectionMaxLifetime => feature_timer_arm!(
            [Sql],
            into_owner_ptr::<MySQLConnectionMaxLifetime>,
            |connection: *mut MySQLConnection, _now, _vm| {
                // SAFETY: as above.
                unsafe { &*connection }.on_max_lifetime_timeout();
                Ok(())
            }
        ),
        EventLoopTimerTag::ValkeyConnectionTimeout => feature_timer_arm!(
            [Valkey],
            into_owner_ref::<ValkeyConnectionTimeout>,
            |client: RefPtr<Valkey>, _now, _vm| client.on_connection_timeout()
        ),
        EventLoopTimerTag::ValkeyConnectionReconnect => feature_timer_arm!(
            [Valkey],
            into_owner_ref::<ValkeyConnectionReconnect>,
            |client: RefPtr<Valkey>, _now, _vm| client.on_reconnect_timer()
        ),
        EventLoopTimerTag::SubprocessTimeout => feature_timer_arm!(
            [Spawn],
            into_owner_ref::<SubprocessTimeout>,
            |subprocess: RefPtr<Subprocess<'static>>, _now, _vm| {
                subprocess.timeout_callback();
                Ok(())
            }
        ),
        EventLoopTimerTag::DevServerSweepSourceMaps => feature_timer_arm!(
            [Bundler],
            into_owner_ptr::<DevServerSweepSourceMaps>,
            |timers: *mut DevServerTimers, now, _vm| {
                // SAFETY: `timers` drops with the state of the `DevServer`, which stays in its box.
                let dev = &mut *unsafe { &*(*timers).dev }.state_mut();
                dev.source_maps
                    .sweep_weak_refs(now, dev.timers.as_pin_ref());
                Ok(())
            }
        ),
        EventLoopTimerTag::DevServerMemoryVisualizerTick => feature_timer_arm!(
            [Bundler],
            into_owner_ptr::<DevServerMemoryVisualizerTick>,
            |timers: *mut DevServerTimers, _now, _vm| {
                // SAFETY: as above.
                let mut dev = unsafe { &*(*timers).dev }.state_mut();
                dev.emit_memory_visualizer_message_timer();
                Ok(())
            }
        ),
        EventLoopTimerTag::BunTest => feature_timer_arm!(
            [Test],
            into_owner_ptr::<BunTest>,
            |_root: *mut BunTestRoot, now, vm| {
                if let Some(file) = clone_active_strong() {
                    BunTest::bun_test_timeout_callback(&file, now, vm);
                }
                Ok(())
            }
        ),
        EventLoopTimerTag::CronJob => feature_timer_arm!(
            [Cron],
            into_owner_ref::<CronJob>,
            |job: RefPtr<CronJob>, _now, vm| {
                CronJob::on_timer_fire(&job, vm);
                Ok(())
            }
        ),
        EventLoopTimerTag::QuicEndpoint => feature_timer_arm!(
            [NodeQuic],
            into_owner_ptr::<QuicEndpoint>,
            |endpoint: *mut crate::node::quic::QuicEndpoint, _now, _vm| {
                // SAFETY: what runs script keeps the JS wrapper, which owns `endpoint`, on the stack, and is the last use.
                unsafe { &*endpoint }.on_timer_fire();
                Ok(())
            }
        ),
        EventLoopTimerTag::ViWait => feature_timer_arm!(
            [Test],
            into_owner_ptr::<ViWait>,
            |wait: *mut crate::test_runner::vi_wait::ViWait, now, vm| {
                // SAFETY: it keeps the JS wrapper, which owns `wait`, on the stack.
                unsafe { &*wait }.on_timer_fire(now, vm)
            }
        ),
        EventLoopTimerTag::UvTimer => {
            #[cfg(unix)]
            {
                use crate::napi::uv_posix::UvTimerNode;
                feature_timer_arm!(
                    [NativeAddons],
                    into_owner_ptr::<UvTimer>,
                    |node: *mut UvTimerNode, _now, vm| {
                        // SAFETY: live, and only a started `uv_timer_t` is armed.
                        unsafe { UvTimerNode::on_fire(node, vm) }
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
    }
}

/// Releases the ref that the heap held for a timer that will never fire.
pub(crate) fn release_timer_unfired(timer: Popped) {
    macro_rules! release_in {
        ($features:tt, $tag:ident, $Owner:ty) => {
            in_features!(
                $features,
                (owner: RefPtr<$Owner> = timer_owner!(timer.into_owner_ref::<$tag>())) {
                    drop(owner)
                }
            )
        };
    }
    match timer.tag() {
        EventLoopTimerTag::TimeoutObject => {
            drop(timer_owner!(timer.into_owner_ref::<TimeoutObject>()))
        }
        EventLoopTimerTag::ImmediateObject => {
            drop(timer_owner!(timer.into_owner_ref::<ImmediateObject>()))
        }
        EventLoopTimerTag::StatWatcherScheduler => {
            release_in!([NodeFs], StatWatcherScheduler, StatWatcherScheduler)
        }
        EventLoopTimerTag::DNSResolver => release_in!([Dns], DNSResolver, DNSResolver),
        EventLoopTimerTag::ValkeyConnectionTimeout => {
            release_in!([Valkey], ValkeyConnectionTimeout, Valkey)
        }
        EventLoopTimerTag::ValkeyConnectionReconnect => {
            release_in!([Valkey], ValkeyConnectionReconnect, Valkey)
        }
        EventLoopTimerTag::SubprocessTimeout => {
            release_in!([Spawn], SubprocessTimeout, Subprocess<'static>)
        }
        EventLoopTimerTag::CronJob => release_in!([Cron], CronJob, CronJob),
        EventLoopTimerTag::WorkerWaitsForRoom => {
            release_in!([WorkerConstructor], WorkerWaitsForRoom, WebWorker)
        }
        tag => debug_assert!(!tag.is_ref_counted()),
    }
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
    match task.tag() {
        task_tag::AnyTaskJob => {
            // The one erased tag: every payload is a `Job<C>` reached through its header.
            // SAFETY: as `release!`.
            unsafe { bun_jsc::job::release_unrun_erased(task.ptr()) }
        }
        task_tag::BakeFinishBundle => release!(DevServer),
        task_tag::BakePendingReloadEvent => release_in!([Bundler], BakePendingReloadEvent),
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
        task_tag::ShellYesTask => release_boxed_in!([Shell], ShellYesTask),
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
            release_in!(
                [HtmlRewriter],
                crate::api::html_rewriter::RewriterPipeBackgroundPull
            )
        }
        task_tag::RunTestsTask => {
            release_boxed_in!([Test], crate::test_runner::bun_test::RunTestsTask)
        }
        task_tag::ValkeyDeferredFailure => {
            release_boxed_in!([Valkey], crate::valkey_jsc::valkey::DeferredFailure)
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
                [Serve, HtmlRewriter, S3Client, Cron],
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
            release_in!([FileSink, Bodies, Spawn], FileSink)
        }
        task_tag::RuntimeTranspilerStore => {
            release_in!([RuntimeTranspiler], RuntimeTranspilerStore)
        }
        task_tag::S3HttpDownloadStreamingTask => {
            release_in!([S3Client], S3HttpDownloadStreamingTask)
        }
        task_tag::S3HttpSimpleTask => release_in!([S3Client], S3HttpSimpleTask),
        task_tag::S3RefusedRequest => release_boxed_in!([S3Client], S3RefusedRequest),
        task_tag::S3UploadWriterCollected => release_in!([S3Client], S3UploadWriterCollected),
        task_tag::SendQueueDeferred => release_in!([Ipc], crate::ipc::SendQueue),
        task_tag::ServerAllConnectionsClosedTask => {
            release_boxed_in!([Serve], ServerAllConnectionsClosedTask)
        }
        task_tag::ShellAsync => release_boxed_in!([Shell], ShellAsyncTask),
        task_tag::ShellCondExprStatTask => {
            release_boxed_in!([Shell], PoolTask<ShellCondExprStatTask>)
        }
        task_tag::ShellCpTask => release_boxed_in!([Shell], ShellCpTask),
        task_tag::ShellGlobTask => release_boxed_in!([Shell], PoolTask<ShellGlobTask>),
        task_tag::ShellLsTask => release_boxed_in!([Shell], ShellLsTask),
        task_tag::ShellMkdirTask => release_boxed_in!([Shell], PoolTask<ShellMkdirTask>),
        task_tag::ShellMvBatchedTask => release_boxed_in!([Shell], PoolTask<ShellMvBatchedTask>),
        task_tag::ShellMvCheckTargetTask => {
            release_boxed_in!([Shell], PoolTask<ShellMvCheckTargetTask>)
        }
        task_tag::ShellRmDirTask => release_boxed_in!([Shell], ShellRmDirTask),
        task_tag::ShellTouchTask => release_boxed_in!([Shell], PoolTask<ShellTouchTask>),
        task_tag::StatWatcherTimerUpdate => {
            release_boxed_in!(
                [NodeFs],
                crate::node::node_fs_stat_watcher::StatWatcherTimerUpdate
            )
        }
        task_tag::StatWatcherHop => {
            release_in!([NodeFs], crate::node::node_fs_stat_watcher::StatWatcher)
        }
        task_tag::AsyncCpTask => release_boxed_in!([NodeFs], crate::node::fs::AsyncCpTask),
        task_tag::ShellAsyncCpTask => release_boxed_in!([Shell], crate::node::fs::ShellAsyncCpTask),
        task_tag::StreamPending => release_boxed_in!([WebStreams], StreamPending),
        task_tag::ThreadSafeFunction => release_in!([NativeAddons], ThreadSafeFunction),
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
        task_tag::WindowsNamedPipeDeinit => {
            #[cfg(windows)]
            release!(WindowsNamedPipe);
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
