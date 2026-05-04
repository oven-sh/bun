//! To add a new task to the task queue:
//! 1. Add the type to the TaggedPtrUnion
//! 2. Update the match statement in tick_queue_with_count() to run the task

use bun_collections::TaggedPtrUnion;
use bun_core::Output;
use bun_jsc::{self as jsc, EventLoop, JSGlobalObject, JsError, JsTerminated, VirtualMachine};

// ─── task type imports ────────────────────────────────────────────────────
// TODO(port): verify crate paths in Phase B — many of these are best-effort
// mappings from Zig `@import` namespaces to the Rust crate map.

use bun_jsc::{AnyTask, CppTask, ManagedTask, PosixSignalTask};
use bun_jsc::hot_reloader::HotReloader::Task as HotReloadTask;
use bun_jsc::web_core::streams::Result::Pending as StreamPending;
use bun_jsc::module_loader::{AsyncModule::Queue as PollPendingModulesTask, RuntimeTranspilerStore};

use bun_jsc::api::{NativeBrotli, NativeZlib, NativeZstd};
use bun_jsc::api::Image::AsyncImageTask;
use bun_jsc::api::NativePromiseContext::DeferredDerefTask as NativePromiseContextDeferredDerefTask;
use bun_jsc::api::Glob::WalkTask::AsyncGlobWalkTask;
use bun_jsc::api::JSTranspiler::TransformTask::AsyncTransformTask;
use bun_jsc::api::Archive::{
    BlobTask as ArchiveBlobTask, ExtractTask as ArchiveExtractTask, FilesTask as ArchiveFilesTask,
    WriteTask as ArchiveWriteTask,
};
use bun_jsc::api::Timer::{self, ImmediateObject, TimeoutObject};

use bun_jsc::jsc_scheduler::JSCDeferredWorkTask;

use bun_runtime::webcore::fetch::{self as Fetch, FetchTasklet};
use bun_runtime::webcore::FileSink::FlushPendingTask as FlushPendingFileSinkTask;
use bun_runtime::webcore::Blob::copy_file::CopyFilePromiseTask;
use bun_runtime::webcore::Blob::read_file::ReadFileTask;
use bun_runtime::webcore::Blob::write_file::WriteFileTask;

use bun_runtime::api::server::ServerAllConnectionsClosedTask;
use bun_runtime::api::dns::GetAddrInfoRequest::Task as GetAddrInfoRequestTask;
use bun_runtime::api::napi::{napi_async_work, NapiFinalizerTask, ThreadSafeFunction};

use bun_runtime::node::fs::Watcher::FSWatchTask;
use bun_runtime::node::fs::Async as AsyncFS;
// TODO(port): these are Zig decl-literal aliases (lowercase fields on AsyncFS);
// Phase B: confirm the Rust-side names once node::fs::Async is ported.
use AsyncFS::{
    access as Access, appendFile as AppendFile, chmod as Chmod, chown as Chown, close as Close,
    copyFile as CopyFile, exists as Exists, fchown as FChown, ftruncate as FTruncate,
    fchmod as Fchmod, fdatasync as Fdatasync, fstat as Fstat, fsync as Fsync, futimes as Futimes,
    lchmod as Lchmod, lchown as Lchown, link as Link, lstat as Lstat, lutimes as Lutimes,
    mkdir as Mkdir, mkdtemp as Mkdtemp, open as Open, read as Read, readFile as ReadFile,
    readdir as Readdir, readdir_recursive as ReaddirRecursive, readlink as Readlink,
    readv as Readv, realpath as Realpath, realpathNonNative as RealpathNonNative, rename as Rename,
    rm as Rm, rmdir as Rmdir, stat as Stat, statfs as StatFS, symlink as Symlink,
    truncate as Truncate, unlink as Unlink, utimes as Utimes, write as Write,
    writeFile as WriteFile, writev as Writev,
};

use bun_s3::{S3HttpDownloadStreamingTask, S3HttpSimpleTask};

use bun_bake::dev_server::HotReloadEvent as BakeHotReloadEvent;
use bun_bundler::DeferredBatchTask;

use bun_shell as shell;
use shell::interpret::Interpreter::Expansion::ShellGlobTask;
use shell::Interpreter::{
    Async as ShellAsync, AsyncDeinitReader as ShellIOReaderAsyncDeinit,
    AsyncDeinitWriter as ShellIOWriterAsyncDeinit, IOWriter as ShellIOWriter,
};
use shell::Interpreter::Cmd::ShellAsyncSubprocessDone;
use shell::Interpreter::CondExpr::ShellCondExprStatTask;
use shell::Interpreter::Builtin::Cp::ShellCpTask;
use shell::Interpreter::Builtin::Ls::ShellLsTask;
use shell::Interpreter::Builtin::Mkdir::ShellMkdirTask;
use shell::Interpreter::Builtin::Touch::ShellTouchTask;
use shell::Interpreter::Builtin::Mv::{ShellMvBatchedTask, ShellMvCheckTargetTask};
use shell::Interpreter::Builtin::Rm::ShellRmTask;
use shell::Interpreter::Builtin::Rm::ShellRmTask::DirTask as ShellRmDirTask;
use shell::Interpreter::Builtin::Yes::YesTask;

bun_output::declare_scope!(Task, hidden);

// ─── ProcessWaiterThreadTask: posix-only ──────────────────────────────────
#[cfg(unix)]
type ProcessWaiterThreadTask = bun_spawn::process::WaiterThread::ProcessQueue::ResultTask;
#[cfg(not(unix))]
// TODO(port): Zig used `opaque {}` as a never-constructed placeholder so the
// tag still exists in the union on Windows; an uninhabited enum mirrors that.
enum ProcessWaiterThreadTask {}

// ─── Task union ───────────────────────────────────────────────────────────
// TODO(port): `TaggedPtrUnion` over 96 types needs a macro (`tagged_ptr_union!`)
// that emits both the `#[repr(transparent)] u64` wrapper and a `Tag` enum with
// one variant per type. Phase B: define that macro in bun_collections.
pub type Task = TaggedPtrUnion<(
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
    BakeHotReloadEvent,
    DeferredBatchTask,
    YesTask,
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
    napi_async_work,
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
)>;

/// Tag enum generated by `TaggedPtrUnion` — one variant per type above.
// TODO(port): emitted by the union macro; named here for match readability.
use self::Task::Tag as TaskTag;

pub fn tick_queue_with_count(
    this: &mut EventLoop,
    virtual_machine: &mut VirtualMachine,
    counter: &mut u32,
) -> Result<(), JsTerminated> {
    let global = this.global;
    let global_vm = global.vm();

    #[cfg(debug_assertions)]
    {
        if this.debug.js_call_count_outside_tick_queue
            > this.debug.drain_microtasks_count_outside_tick_queue
        {
            if this.debug.track_last_fn_name {
                Output::panic(
                    format_args!(
                        "<b>{} JavaScript functions<r> were called outside of the microtask queue without draining microtasks.\n\
                         \n\
                         Last function name: {}\n\
                         \n\
                         Use EventLoop.runCallback() to run JavaScript functions outside of the microtask queue.\n\
                         \n\
                         Failing to do this can lead to a large number of microtasks being queued and not being drained, which can lead to a large amount of memory being used and application slowdown.",
                        this.debug.js_call_count_outside_tick_queue
                            - this.debug.drain_microtasks_count_outside_tick_queue,
                        this.debug.last_fn_name,
                    ),
                );
            } else {
                Output::panic(
                    format_args!(
                        "<b>{} JavaScript functions<r> were called outside of the microtask queue without draining microtasks. To track the last function name, set the BUN_TRACK_LAST_FN_NAME environment variable.\n\
                         \n\
                         Use EventLoop.runCallback() to run JavaScript functions outside of the microtask queue.\n\
                         \n\
                         Failing to do this can lead to a large number of microtasks being queued and not being drained, which can lead to a large amount of memory being used and application slowdown.",
                        this.debug.js_call_count_outside_tick_queue
                            - this.debug.drain_microtasks_count_outside_tick_queue,
                    ),
                );
            }
        }
    }

    while let Some(task) = this.tasks.read_item() {
        bun_output::scoped_log!(Task, "run {}", <&'static str>::from(task.tag()));

        // PORT NOTE: reshaped for borrowck — Zig `defer counter.* += 1;` is
        // hoisted to the top of the loop body. It fires on every exit path
        // (normal, `?`, early return) just as the Zig defer did.
        *counter += 1;

        match task.tag() {
            TaskTag::ArchiveExtractTask => {
                let archive_task = task.get_mut::<ArchiveExtractTask>().unwrap();
                archive_task.run_from_js()?;
            }
            TaskTag::ArchiveBlobTask => {
                let archive_task = task.get_mut::<ArchiveBlobTask>().unwrap();
                archive_task.run_from_js()?;
            }
            TaskTag::ArchiveWriteTask => {
                let archive_task = task.get_mut::<ArchiveWriteTask>().unwrap();
                archive_task.run_from_js()?;
            }
            TaskTag::ArchiveFilesTask => {
                let archive_task = task.get_mut::<ArchiveFilesTask>().unwrap();
                archive_task.run_from_js()?;
            }
            TaskTag::ShellAsync => {
                let shell_ls_task = task.get_mut::<ShellAsync>().unwrap();
                shell_ls_task.run_from_main_thread();
            }
            TaskTag::ShellAsyncSubprocessDone => {
                let shell_ls_task = task.get_mut::<ShellAsyncSubprocessDone>().unwrap();
                shell_ls_task.run_from_main_thread();
            }
            TaskTag::ShellIOWriterAsyncDeinit => {
                let shell_ls_task = task.get_mut::<ShellIOWriterAsyncDeinit>().unwrap();
                shell_ls_task.run_from_main_thread();
            }
            TaskTag::ShellIOWriter => {
                let shell_io_writer = task.get_mut::<ShellIOWriter>().unwrap();
                shell_io_writer.run_from_main_thread();
            }
            TaskTag::ShellIOReaderAsyncDeinit => {
                let shell_ls_task = task.get_mut::<ShellIOReaderAsyncDeinit>().unwrap();
                shell_ls_task.run_from_main_thread();
            }
            TaskTag::ShellCondExprStatTask => {
                let shell_ls_task = task.get_mut::<ShellCondExprStatTask>().unwrap();
                shell_ls_task.task.run_from_main_thread();
            }
            TaskTag::ShellCpTask => {
                let shell_ls_task = task.get_mut::<ShellCpTask>().unwrap();
                shell_ls_task.run_from_main_thread();
            }
            TaskTag::ShellTouchTask => {
                let shell_ls_task = task.get_mut::<ShellTouchTask>().unwrap();
                shell_ls_task.run_from_main_thread();
            }
            TaskTag::ShellMkdirTask => {
                let shell_ls_task = task.get_mut::<ShellMkdirTask>().unwrap();
                shell_ls_task.run_from_main_thread();
            }
            TaskTag::ShellLsTask => {
                let shell_ls_task = task.get_mut::<ShellLsTask>().unwrap();
                shell_ls_task.run_from_main_thread();
            }
            TaskTag::ShellMvBatchedTask => {
                let shell_mv_batched_task = task.get_mut::<ShellMvBatchedTask>().unwrap();
                shell_mv_batched_task.task.run_from_main_thread();
            }
            TaskTag::ShellMvCheckTargetTask => {
                let shell_mv_check_target_task = task.get_mut::<ShellMvCheckTargetTask>().unwrap();
                shell_mv_check_target_task.task.run_from_main_thread();
            }
            TaskTag::ShellRmTask => {
                let shell_rm_task = task.get_mut::<ShellRmTask>().unwrap();
                shell_rm_task.run_from_main_thread();
            }
            TaskTag::ShellRmDirTask => {
                let shell_rm_task = task.get_mut::<ShellRmDirTask>().unwrap();
                shell_rm_task.run_from_main_thread();
            }
            TaskTag::ShellGlobTask => {
                let shell_glob_task = task.get_mut::<ShellGlobTask>().unwrap();
                shell_glob_task.run_from_main_thread();
                shell_glob_task.deinit();
            }
            TaskTag::FetchTasklet => {
                let fetch_task = task.get_mut::<Fetch::FetchTasklet>().unwrap();
                fetch_task.on_progress_update()?;
            }
            TaskTag::S3HttpSimpleTask => {
                let s3_task = task.get_mut::<S3HttpSimpleTask>().unwrap();
                s3_task.on_response()?;
            }
            TaskTag::S3HttpDownloadStreamingTask => {
                let s3_task = task.get_mut::<S3HttpDownloadStreamingTask>().unwrap();
                s3_task.on_response();
            }
            TaskTag::AsyncGlobWalkTask => {
                let glob_walk_task = task.get_mut::<AsyncGlobWalkTask>().unwrap();
                // PORT NOTE: Zig `defer .deinit(); try .runFromJS();` — reordered
                // so deinit fires regardless of run_from_js result.
                let r = glob_walk_task.run_from_js();
                glob_walk_task.deinit();
                r?;
            }
            TaskTag::AsyncImageTask => {
                let image_task = task.get_mut::<AsyncImageTask>().unwrap();
                let r = image_task.run_from_js();
                image_task.deinit();
                r?;
            }
            TaskTag::AsyncTransformTask => {
                let transform_task = task.get_mut::<AsyncTransformTask>().unwrap();
                let r = transform_task.run_from_js();
                transform_task.deinit();
                r?;
            }
            TaskTag::CopyFilePromiseTask => {
                let transform_task = task.get_mut::<CopyFilePromiseTask>().unwrap();
                let r = transform_task.run_from_js();
                transform_task.deinit();
                r?;
            }
            TaskTag::NapiAsyncWork => {
                let transform_task = task.get_mut::<napi_async_work>().unwrap();
                transform_task.run_from_js(virtual_machine, global);
            }
            TaskTag::ThreadSafeFunction => {
                let transform_task = task.as_mut::<ThreadSafeFunction>();
                transform_task.on_dispatch();
            }
            TaskTag::ReadFileTask => {
                let transform_task = task.get_mut::<ReadFileTask>().unwrap();
                let r = transform_task.run_from_js();
                transform_task.deinit();
                r?;
            }
            TaskTag::JSCDeferredWorkTask => {
                let jsc_task = task.get_mut::<JSCDeferredWorkTask>().unwrap();
                bun_jsc::mark_binding!();
                jsc_task.run()?;
            }
            TaskTag::WriteFileTask => {
                let transform_task = task.get_mut::<WriteFileTask>().unwrap();
                let r = transform_task.run_from_js();
                transform_task.deinit();
                r?;
            }
            TaskTag::HotReloadTask => {
                let transform_task = task.get_mut::<HotReloadTask>().unwrap();
                transform_task.run();
                transform_task.deinit();
                // special case: we return
                // hot reload runs immediately so it should not drain microtasks
                //
                // PORT NOTE: Zig sets `counter.* = 0` then the outer defer bumps
                // it to 1 on return. We hoisted the increment to the loop top,
                // so set 1 here to preserve the observable value.
                *counter = 1;
                return Ok(());
            }
            TaskTag::BakeHotReloadEvent => {
                let hmr_task = task.get_mut::<BakeHotReloadEvent>().unwrap();
                hmr_task.run();
            }
            TaskTag::FSWatchTask => {
                let transform_task = task.get_mut::<FSWatchTask>().unwrap();
                transform_task.run();
                transform_task.deinit();
            }
            TaskTag::AnyTask => {
                let any = task.get_mut::<AnyTask>().unwrap();
                if let Err(err) = any.run() {
                    report_error_or_terminate(global, err)?;
                }
            }
            TaskTag::ManagedTask => {
                let any = task.get_mut::<ManagedTask>().unwrap();
                if let Err(err) = any.run() {
                    report_error_or_terminate(global, err)?;
                }
            }
            TaskTag::CppTask => {
                let any = task.get_mut::<CppTask>().unwrap();
                if let Err(err) = any.run(global) {
                    report_error_or_terminate(global, err)?;
                }
            }
            TaskTag::PollPendingModulesTask => {
                virtual_machine.modules.on_poll();
            }
            TaskTag::GetAddrInfoRequestTask => {
                #[cfg(windows)]
                panic!("This should not be reachable on Windows");
                #[cfg(not(windows))]
                {
                    let any = task.get_mut::<GetAddrInfoRequestTask>().unwrap();
                    let r = any.run_from_js();
                    any.deinit();
                    r?;
                }
            }
            TaskTag::Stat => {
                let any = task.get_mut::<Stat>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Lstat => {
                let any = task.get_mut::<Lstat>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Fstat => {
                let any = task.get_mut::<Fstat>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Open => {
                let any = task.get_mut::<Open>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::ReadFile => {
                let any = task.get_mut::<ReadFile>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::WriteFile => {
                let any = task.get_mut::<WriteFile>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::CopyFile => {
                let any = task.get_mut::<CopyFile>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Read => {
                let any = task.get_mut::<Read>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Write => {
                let any = task.get_mut::<Write>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Truncate => {
                let any = task.get_mut::<Truncate>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Writev => {
                let any = task.get_mut::<Writev>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Readv => {
                let any = task.get_mut::<Readv>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Rename => {
                let any = task.get_mut::<Rename>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::FTruncate => {
                let any = task.get_mut::<FTruncate>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Readdir => {
                let any = task.get_mut::<Readdir>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::ReaddirRecursive => {
                let any = task.get_mut::<ReaddirRecursive>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Close => {
                let any = task.get_mut::<Close>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Rm => {
                let any = task.get_mut::<Rm>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Rmdir => {
                let any = task.get_mut::<Rmdir>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Chown => {
                let any = task.get_mut::<Chown>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::FChown => {
                let any = task.get_mut::<FChown>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Utimes => {
                let any = task.get_mut::<Utimes>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Lutimes => {
                let any = task.get_mut::<Lutimes>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Chmod => {
                let any = task.get_mut::<Chmod>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Fchmod => {
                let any = task.get_mut::<Fchmod>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Link => {
                let any = task.get_mut::<Link>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Symlink => {
                let any = task.get_mut::<Symlink>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Readlink => {
                let any = task.get_mut::<Readlink>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Realpath => {
                let any = task.get_mut::<Realpath>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::RealpathNonNative => {
                let any = task.get_mut::<RealpathNonNative>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Mkdir => {
                let any = task.get_mut::<Mkdir>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Fsync => {
                let any = task.get_mut::<Fsync>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Fdatasync => {
                let any = task.get_mut::<Fdatasync>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Access => {
                let any = task.get_mut::<Access>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::AppendFile => {
                let any = task.get_mut::<AppendFile>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Mkdtemp => {
                let any = task.get_mut::<Mkdtemp>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Exists => {
                let any = task.get_mut::<Exists>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Futimes => {
                let any = task.get_mut::<Futimes>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Lchmod => {
                let any = task.get_mut::<Lchmod>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Lchown => {
                let any = task.get_mut::<Lchown>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::Unlink => {
                let any = task.get_mut::<Unlink>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::NativeZlib => {
                let any = task.get_mut::<NativeZlib>().unwrap();
                any.run_from_js_thread();
            }
            TaskTag::NativeBrotli => {
                let any = task.get_mut::<NativeBrotli>().unwrap();
                any.run_from_js_thread();
            }
            TaskTag::NativeZstd => {
                let any = task.get_mut::<NativeZstd>().unwrap();
                any.run_from_js_thread();
            }
            TaskTag::ProcessWaiterThreadTask => {
                bun_core::mark_posix_only();
                let any = task.get_mut::<ProcessWaiterThreadTask>().unwrap();
                any.run_from_js_thread();
            }
            TaskTag::RuntimeTranspilerStore => {
                let any = task.get_mut::<RuntimeTranspilerStore>().unwrap();
                any.run_from_js_thread(this, global, virtual_machine);
            }
            TaskTag::ServerAllConnectionsClosedTask => {
                let any = task.get_mut::<ServerAllConnectionsClosedTask>().unwrap();
                any.run_from_js_thread(virtual_machine)?;
            }
            TaskTag::DeferredBatchTask => {
                let any = task.get_mut::<DeferredBatchTask>().unwrap();
                any.run_on_js_thread();
            }
            TaskTag::PosixSignalTask => {
                PosixSignalTask::run_from_js_thread(
                    // TODO(port): @intCast target type — Phase B confirm signature
                    task.as_uintptr().try_into().unwrap(),
                    global,
                );
            }
            TaskTag::NapiFinalizerTask => {
                let any = task.get_mut::<NapiFinalizerTask>().unwrap();
                any.run_on_js_thread();
            }
            TaskTag::NativePromiseContextDeferredDerefTask => {
                NativePromiseContextDeferredDerefTask::run_from_js_thread(
                    // TODO(port): @intCast target type
                    task.as_uintptr().try_into().unwrap(),
                );
            }
            TaskTag::StatFS => {
                let any = task.get_mut::<StatFS>().unwrap();
                any.run_from_js_thread()?;
            }
            TaskTag::FlushPendingFileSinkTask => {
                let any = task.get_mut::<FlushPendingFileSinkTask>().unwrap();
                any.run_from_js_thread();
            }
            TaskTag::StreamPending => {
                let any = task.get_mut::<StreamPending>().unwrap();
                any.run_from_js_thread();
            }

            // YesTask / ImmediateObject / TimeoutObject are declared in the
            // tagged union but never dispatched here; the `_` arm covers
            // them along with unnamed (non-exhaustive) variants. Using `_`
            // instead of explicit per-type arms avoids hard-coding
            // path-derived `@typeName(T)` strings that change when files move.
            _ => {
                Output::panic(format_args!(
                    "Unexpected Task tag: {}",
                    task.tag() as u16
                ));
            }
        }

        this.drain_microtasks_with_global(global, global_vm)?;
    }

    this.tasks.head = if this.tasks.count == 0 { 0 } else { this.tasks.head };
    Ok(())
}

#[cold]
pub fn report_error_or_terminate(
    global: &JSGlobalObject,
    proof: JsError,
) -> Result<(), JsTerminated> {
    if proof == JsError::Terminated {
        return Err(JsTerminated);
    }
    let vm = global.vm();
    let ex = global.take_exception(proof).as_exception(vm).unwrap();
    let is_termination_exception = vm.is_termination_exception(ex);
    if is_termination_exception {
        return Err(JsTerminated);
    }
    let _ = global.report_uncaught_exception(ex);
    Ok(())
}

// const PromiseTask = JSInternalPromise.Completion.PromiseTask;
// const ShellIOReaderAsyncDeinit = shell.Interpreter.IOReader.AsyncDeinit;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/Task.zig (679 lines)
//   confidence: medium
//   todos:      7
//   notes:      TaggedPtrUnion needs a macro emitting Tag enum for 96 types; defer-counter hoisted (see PORT NOTEs); .deinit() kept explicit on raw-ptr payloads
// ──────────────────────────────────────────────────────────────────────────
