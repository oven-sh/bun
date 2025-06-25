/// To add a new task to the task queue:
/// 1. Add the type to the TaggedPointerUnion
/// 2. Update the switch statement in tickQueueWithCount() to run the task
pub const Task = TaggedPointerUnion(.{
    Access,
    AnyTask,
    AppendFile,
    AsyncGlobWalkTask,
    AsyncTransformTask,
    bun.bake.DevServer.HotReloadEvent,
    bun.bundle_v2.DeferredBatchTask,
    shell.Interpreter.Builtin.Yes.YesTask,
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
});

pub fn tickQueueWithCount(this: *EventLoop, virtual_machine: *VirtualMachine) u32 {
    var global = this.global;
    const global_vm = global.vm();
    var counter: u32 = 0;

    if (comptime Environment.isDebug) {
        if (this.debug.js_call_count_outside_tick_queue > this.debug.drain_microtasks_count_outside_tick_queue) {
            if (this.debug.track_last_fn_name) {
                bun.Output.panic(
                    \\<b>{d} JavaScript functions<r> were called outside of the microtask queue without draining microtasks.
                    \\
                    \\Last function name: {}
                    \\
                    \\Use EventLoop.runCallback() to run JavaScript functions outside of the microtask queue.
                    \\
                    \\Failing to do this can lead to a large number of microtasks being queued and not being drained, which can lead to a large amount of memory being used and application slowdown.
                ,
                    .{
                        this.debug.js_call_count_outside_tick_queue - this.debug.drain_microtasks_count_outside_tick_queue,
                        this.debug.last_fn_name,
                    },
                );
            } else {
                bun.Output.panic(
                    \\<b>{d} JavaScript functions<r> were called outside of the microtask queue without draining microtasks. To track the last function name, set the BUN_TRACK_LAST_FN_NAME environment variable.
                    \\
                    \\Use EventLoop.runCallback() to run JavaScript functions outside of the microtask queue.
                    \\
                    \\Failing to do this can lead to a large number of microtasks being queued and not being drained, which can lead to a large amount of memory being used and application slowdown.
                ,
                    .{this.debug.js_call_count_outside_tick_queue - this.debug.drain_microtasks_count_outside_tick_queue},
                );
            }
        }
    }

    while (this.tasks.readItem()) |task| {
        log("run {s}", .{@tagName(task.tag())});
        defer counter += 1;
        switch (task.tag()) {
            @field(Task.Tag, @typeName(ShellAsync)) => {
                var shell_ls_task: *ShellAsync = task.get(ShellAsync).?;
                shell_ls_task.runFromMainThread();
            },
            @field(Task.Tag, @typeName(ShellAsyncSubprocessDone)) => {
                var shell_ls_task: *ShellAsyncSubprocessDone = task.get(ShellAsyncSubprocessDone).?;
                shell_ls_task.runFromMainThread();
            },
            @field(Task.Tag, @typeName(ShellIOWriterAsyncDeinit)) => {
                var shell_ls_task: *ShellIOWriterAsyncDeinit = task.get(ShellIOWriterAsyncDeinit).?;
                shell_ls_task.runFromMainThread();
            },
            @field(Task.Tag, @typeName(ShellIOWriter)) => {
                var shell_io_writer: *ShellIOWriter = task.get(ShellIOWriter).?;
                shell_io_writer.runFromMainThread();
            },
            @field(Task.Tag, @typeName(ShellIOReaderAsyncDeinit)) => {
                var shell_ls_task: *ShellIOReaderAsyncDeinit = task.get(ShellIOReaderAsyncDeinit).?;
                shell_ls_task.runFromMainThread();
            },
            @field(Task.Tag, @typeName(ShellCondExprStatTask)) => {
                var shell_ls_task: *ShellCondExprStatTask = task.get(ShellCondExprStatTask).?;
                shell_ls_task.task.runFromMainThread();
            },
            @field(Task.Tag, @typeName(ShellCpTask)) => {
                var shell_ls_task: *ShellCpTask = task.get(ShellCpTask).?;
                shell_ls_task.runFromMainThread();
            },
            @field(Task.Tag, @typeName(ShellTouchTask)) => {
                var shell_ls_task: *ShellTouchTask = task.get(ShellTouchTask).?;
                shell_ls_task.runFromMainThread();
            },
            @field(Task.Tag, @typeName(ShellMkdirTask)) => {
                var shell_ls_task: *ShellMkdirTask = task.get(ShellMkdirTask).?;
                shell_ls_task.runFromMainThread();
            },
            @field(Task.Tag, @typeName(ShellLsTask)) => {
                var shell_ls_task: *ShellLsTask = task.get(ShellLsTask).?;
                shell_ls_task.runFromMainThread();
            },
            @field(Task.Tag, @typeName(ShellMvBatchedTask)) => {
                var shell_mv_batched_task: *ShellMvBatchedTask = task.get(ShellMvBatchedTask).?;
                shell_mv_batched_task.task.runFromMainThread();
            },
            @field(Task.Tag, @typeName(ShellMvCheckTargetTask)) => {
                var shell_mv_check_target_task: *ShellMvCheckTargetTask = task.get(ShellMvCheckTargetTask).?;
                shell_mv_check_target_task.task.runFromMainThread();
            },
            @field(Task.Tag, @typeName(ShellRmTask)) => {
                var shell_rm_task: *ShellRmTask = task.get(ShellRmTask).?;
                shell_rm_task.runFromMainThread();
            },
            @field(Task.Tag, @typeName(ShellRmDirTask)) => {
                var shell_rm_task: *ShellRmDirTask = task.get(ShellRmDirTask).?;
                shell_rm_task.runFromMainThread();
            },
            @field(Task.Tag, @typeName(ShellGlobTask)) => {
                var shell_glob_task: *ShellGlobTask = task.get(ShellGlobTask).?;
                shell_glob_task.runFromMainThread();
                shell_glob_task.deinit();
            },
            @field(Task.Tag, @typeName(FetchTasklet)) => {
                var fetch_task: *Fetch.FetchTasklet = task.get(Fetch.FetchTasklet).?;
                fetch_task.onProgressUpdate();
            },
            @field(Task.Tag, @typeName(S3HttpSimpleTask)) => {
                var s3_task: *S3HttpSimpleTask = task.get(S3HttpSimpleTask).?;
                s3_task.onResponse();
            },
            @field(Task.Tag, @typeName(S3HttpDownloadStreamingTask)) => {
                var s3_task: *S3HttpDownloadStreamingTask = task.get(S3HttpDownloadStreamingTask).?;
                s3_task.onResponse();
            },
            @field(Task.Tag, @typeName(AsyncGlobWalkTask)) => {
                var globWalkTask: *AsyncGlobWalkTask = task.get(AsyncGlobWalkTask).?;
                globWalkTask.*.runFromJS();
                globWalkTask.deinit();
            },
            @field(Task.Tag, @typeName(AsyncTransformTask)) => {
                var transform_task: *AsyncTransformTask = task.get(AsyncTransformTask).?;
                transform_task.*.runFromJS();
                transform_task.deinit();
            },
            @field(Task.Tag, @typeName(CopyFilePromiseTask)) => {
                var transform_task: *CopyFilePromiseTask = task.get(CopyFilePromiseTask).?;
                transform_task.*.runFromJS();
                transform_task.deinit();
            },
            @field(Task.Tag, @typeName(bun.api.napi.napi_async_work)) => {
                const transform_task: *bun.api.napi.napi_async_work = task.get(bun.api.napi.napi_async_work).?;
                transform_task.runFromJS(virtual_machine, global);
            },
            @field(Task.Tag, @typeName(ThreadSafeFunction)) => {
                var transform_task: *ThreadSafeFunction = task.as(ThreadSafeFunction);
                transform_task.onDispatch();
            },
            @field(Task.Tag, @typeName(ReadFileTask)) => {
                var transform_task: *ReadFileTask = task.get(ReadFileTask).?;
                transform_task.*.runFromJS();
                transform_task.deinit();
            },
            @field(Task.Tag, @typeName(JSCDeferredWorkTask)) => {
                var jsc_task: *JSCDeferredWorkTask = task.get(JSCDeferredWorkTask).?;
                JSC.markBinding(@src());
                jsc_task.run();
            },
            @field(Task.Tag, @typeName(WriteFileTask)) => {
                var transform_task: *WriteFileTask = task.get(WriteFileTask).?;
                transform_task.*.runFromJS();
                transform_task.deinit();
            },
            @field(Task.Tag, @typeName(HotReloadTask)) => {
                const transform_task: *HotReloadTask = task.get(HotReloadTask).?;
                transform_task.run();
                transform_task.deinit();
                // special case: we return
                return 0;
            },
            @field(Task.Tag, @typeName(bun.bake.DevServer.HotReloadEvent)) => {
                const hmr_task: *bun.bake.DevServer.HotReloadEvent = task.get(bun.bake.DevServer.HotReloadEvent).?;
                hmr_task.run();
            },
            @field(Task.Tag, @typeName(FSWatchTask)) => {
                var transform_task: *FSWatchTask = task.get(FSWatchTask).?;
                transform_task.*.run();
                transform_task.deinit();
            },
            @field(Task.Tag, @typeName(AnyTask)) => {
                var any: *AnyTask = task.get(AnyTask).?;
                any.run();
            },
            @field(Task.Tag, @typeName(ManagedTask)) => {
                var any: *ManagedTask = task.get(ManagedTask).?;
                any.run();
            },
            @field(Task.Tag, @typeName(CppTask)) => {
                var any: *CppTask = task.get(CppTask).?;
                any.run(global);
            },
            @field(Task.Tag, @typeName(PollPendingModulesTask)) => {
                virtual_machine.modules.onPoll();
            },
            @field(Task.Tag, @typeName(GetAddrInfoRequestTask)) => {
                if (Environment.os == .windows) @panic("This should not be reachable on Windows");

                var any: *GetAddrInfoRequestTask = task.get(GetAddrInfoRequestTask).?;
                any.runFromJS();
                any.deinit();
            },
            @field(Task.Tag, @typeName(Stat)) => {
                var any: *Stat = task.get(Stat).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Lstat)) => {
                var any: *Lstat = task.get(Lstat).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Fstat)) => {
                var any: *Fstat = task.get(Fstat).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Open)) => {
                var any: *Open = task.get(Open).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(ReadFile)) => {
                var any: *ReadFile = task.get(ReadFile).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(WriteFile)) => {
                var any: *WriteFile = task.get(WriteFile).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(CopyFile)) => {
                var any: *CopyFile = task.get(CopyFile).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Read)) => {
                var any: *Read = task.get(Read).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Write)) => {
                var any: *Write = task.get(Write).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Truncate)) => {
                var any: *Truncate = task.get(Truncate).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Writev)) => {
                var any: *Writev = task.get(Writev).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Readv)) => {
                var any: *Readv = task.get(Readv).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Rename)) => {
                var any: *Rename = task.get(Rename).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(FTruncate)) => {
                var any: *FTruncate = task.get(FTruncate).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Readdir)) => {
                var any: *Readdir = task.get(Readdir).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(ReaddirRecursive)) => {
                var any: *ReaddirRecursive = task.get(ReaddirRecursive).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Close)) => {
                var any: *Close = task.get(Close).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Rm)) => {
                var any: *Rm = task.get(Rm).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Rmdir)) => {
                var any: *Rmdir = task.get(Rmdir).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Chown)) => {
                var any: *Chown = task.get(Chown).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(FChown)) => {
                var any: *FChown = task.get(FChown).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Utimes)) => {
                var any: *Utimes = task.get(Utimes).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Lutimes)) => {
                var any: *Lutimes = task.get(Lutimes).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Chmod)) => {
                var any: *Chmod = task.get(Chmod).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Fchmod)) => {
                var any: *Fchmod = task.get(Fchmod).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Link)) => {
                var any: *Link = task.get(Link).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Symlink)) => {
                var any: *Symlink = task.get(Symlink).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Readlink)) => {
                var any: *Readlink = task.get(Readlink).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Realpath)) => {
                var any: *Realpath = task.get(Realpath).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(RealpathNonNative)) => {
                var any: *RealpathNonNative = task.get(RealpathNonNative).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Mkdir)) => {
                var any: *Mkdir = task.get(Mkdir).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Fsync)) => {
                var any: *Fsync = task.get(Fsync).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Fdatasync)) => {
                var any: *Fdatasync = task.get(Fdatasync).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Access)) => {
                var any: *Access = task.get(Access).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(AppendFile)) => {
                var any: *AppendFile = task.get(AppendFile).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Mkdtemp)) => {
                var any: *Mkdtemp = task.get(Mkdtemp).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Exists)) => {
                var any: *Exists = task.get(Exists).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Futimes)) => {
                var any: *Futimes = task.get(Futimes).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Lchmod)) => {
                var any: *Lchmod = task.get(Lchmod).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Lchown)) => {
                var any: *Lchown = task.get(Lchown).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(Unlink)) => {
                var any: *Unlink = task.get(Unlink).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(NativeZlib)) => {
                var any: *NativeZlib = task.get(NativeZlib).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(NativeBrotli)) => {
                var any: *NativeBrotli = task.get(NativeBrotli).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(NativeZstd)) => {
                var any: *NativeZstd = task.get(NativeZstd).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(ProcessWaiterThreadTask)) => {
                bun.markPosixOnly();
                var any: *ProcessWaiterThreadTask = task.get(ProcessWaiterThreadTask).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(RuntimeTranspilerStore)) => {
                var any: *RuntimeTranspilerStore = task.get(RuntimeTranspilerStore).?;
                any.drain() catch {};
            },
            @field(Task.Tag, @typeName(ServerAllConnectionsClosedTask)) => {
                var any: *ServerAllConnectionsClosedTask = task.get(ServerAllConnectionsClosedTask).?;
                any.runFromJSThread(virtual_machine);
            },
            @field(Task.Tag, @typeName(bun.bundle_v2.DeferredBatchTask)) => {
                var any: *bun.bundle_v2.DeferredBatchTask = task.get(bun.bundle_v2.DeferredBatchTask).?;
                any.runOnJSThread();
            },
            @field(Task.Tag, @typeName(PosixSignalTask)) => {
                PosixSignalTask.runFromJSThread(@intCast(task.asUintptr()), global);
            },
            @field(Task.Tag, @typeName(NapiFinalizerTask)) => {
                task.get(NapiFinalizerTask).?.runOnJSThread();
            },
            @field(Task.Tag, @typeName(StatFS)) => {
                var any: *StatFS = task.get(StatFS).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(FlushPendingFileSinkTask)) => {
                var any: *FlushPendingFileSinkTask = task.get(FlushPendingFileSinkTask).?;
                any.runFromJSThread();
            },
            @field(Task.Tag, @typeName(StreamPending)) => {
                var any: *StreamPending = task.get(StreamPending).?;
                any.runFromJSThread();
            },

            .@"shell.builtin.yes.YesTask", .@"bun.js.api.Timer.ImmediateObject", .@"bun.js.api.Timer.TimeoutObject" => {
                bun.Output.panic("Unexpected tag: {s}", .{@tagName(task.tag())});
            },
            _ => {
                // handle unnamed variants
                bun.Output.panic("Unknown tag: {d}", .{@intFromEnum(task.tag())});
            },
        }

        this.drainMicrotasksWithGlobal(global, global_vm) catch return counter;
    }

    this.tasks.head = if (this.tasks.count == 0) 0 else this.tasks.head;
    return counter;
}

const TaggedPointerUnion = bun.TaggedPointerUnion;
const AsyncGlobWalkTask = JSC.API.Glob.WalkTask.AsyncGlobWalkTask;
const CopyFilePromiseTask = bun.webcore.Blob.copy_file.CopyFilePromiseTask;
const AsyncTransformTask = JSC.API.JSTranspiler.TransformTask.AsyncTransformTask;
const ReadFileTask = bun.webcore.Blob.read_file.ReadFileTask;
const WriteFileTask = bun.webcore.Blob.write_file.WriteFileTask;
const napi_async_work = bun.api.napi.napi_async_work;
const FetchTasklet = Fetch.FetchTasklet;
const S3 = bun.S3;
const S3HttpSimpleTask = S3.S3HttpSimpleTask;
const S3HttpDownloadStreamingTask = S3.S3HttpDownloadStreamingTask;
const NapiFinalizerTask = bun.api.napi.NapiFinalizerTask;

const ThreadSafeFunction = bun.api.napi.ThreadSafeFunction;
const HotReloadTask = JSC.hot_reloader.HotReloader.Task;
const FSWatchTask = bun.api.node.fs.Watcher.FSWatchTask;
const PollPendingModulesTask = JSC.ModuleLoader.AsyncModule.Queue;
// const PromiseTask = JSInternalPromise.Completion.PromiseTask;
const GetAddrInfoRequestTask = bun.api.DNS.GetAddrInfoRequest.Task;
const JSCDeferredWorkTask = JSCScheduler.JSCDeferredWorkTask;

const AsyncFS = bun.api.node.fs.Async;
const Stat = AsyncFS.stat;
const Lstat = AsyncFS.lstat;
const Fstat = AsyncFS.fstat;
const Open = AsyncFS.open;
const ReadFile = AsyncFS.readFile;
const WriteFile = AsyncFS.writeFile;
const CopyFile = AsyncFS.copyFile;
const Read = AsyncFS.read;
const Write = AsyncFS.write;
const Truncate = AsyncFS.truncate;
const FTruncate = AsyncFS.ftruncate;
const Readdir = AsyncFS.readdir;
const ReaddirRecursive = AsyncFS.readdir_recursive;
const Readv = AsyncFS.readv;
const Writev = AsyncFS.writev;
const Close = AsyncFS.close;
const Rm = AsyncFS.rm;
const Rmdir = AsyncFS.rmdir;
const Chown = AsyncFS.chown;
const FChown = AsyncFS.fchown;
const Utimes = AsyncFS.utimes;
const Lutimes = AsyncFS.lutimes;
const Chmod = AsyncFS.chmod;
const Fchmod = AsyncFS.fchmod;
const Link = AsyncFS.link;
const Symlink = AsyncFS.symlink;
const Readlink = AsyncFS.readlink;
const Realpath = AsyncFS.realpath;
const RealpathNonNative = AsyncFS.realpathNonNative;
const Mkdir = AsyncFS.mkdir;
const Fsync = AsyncFS.fsync;
const Rename = AsyncFS.rename;
const Fdatasync = AsyncFS.fdatasync;
const Access = AsyncFS.access;
const AppendFile = AsyncFS.appendFile;
const Mkdtemp = AsyncFS.mkdtemp;
const Exists = AsyncFS.exists;
const Futimes = AsyncFS.futimes;
const Lchmod = AsyncFS.lchmod;
const Lchown = AsyncFS.lchown;
const StatFS = AsyncFS.statfs;
const Unlink = AsyncFS.unlink;
const NativeZlib = JSC.API.NativeZlib;
const NativeBrotli = JSC.API.NativeBrotli;
const NativeZstd = JSC.API.NativeZstd;
const StreamPending = JSC.WebCore.streams.Result.Pending;

const ShellGlobTask = shell.interpret.Interpreter.Expansion.ShellGlobTask;
const ShellRmTask = shell.Interpreter.Builtin.Rm.ShellRmTask;
const ShellRmDirTask = shell.Interpreter.Builtin.Rm.ShellRmTask.DirTask;
const ShellLsTask = shell.Interpreter.Builtin.Ls.ShellLsTask;
const ShellMvCheckTargetTask = shell.Interpreter.Builtin.Mv.ShellMvCheckTargetTask;
const ShellMvBatchedTask = shell.Interpreter.Builtin.Mv.ShellMvBatchedTask;
const ShellMkdirTask = shell.Interpreter.Builtin.Mkdir.ShellMkdirTask;
const ShellTouchTask = shell.Interpreter.Builtin.Touch.ShellTouchTask;
const ShellCpTask = shell.Interpreter.Builtin.Cp.ShellCpTask;
const ShellCondExprStatTask = shell.Interpreter.CondExpr.ShellCondExprStatTask;
const ShellAsync = shell.Interpreter.Async;
// const ShellIOReaderAsyncDeinit = shell.Interpreter.IOReader.AsyncDeinit;
const ShellIOReaderAsyncDeinit = shell.Interpreter.AsyncDeinitReader;
const ShellIOWriterAsyncDeinit = shell.Interpreter.AsyncDeinitWriter;
const ShellIOWriter = shell.Interpreter.IOWriter;
const TimeoutObject = Timer.TimeoutObject;
const ImmediateObject = Timer.ImmediateObject;
const ProcessWaiterThreadTask = if (Environment.isPosix) bun.spawn.process.WaiterThread.ProcessQueue.ResultTask else opaque {};
const ProcessMiniEventLoopWaiterThreadTask = if (Environment.isPosix) bun.spawn.WaiterThread.ProcessMiniEventLoopQueue.ResultTask else opaque {};
const ShellAsyncSubprocessDone = shell.Interpreter.Cmd.ShellAsyncSubprocessDone;
const RuntimeTranspilerStore = JSC.ModuleLoader.RuntimeTranspilerStore;
const ServerAllConnectionsClosedTask = @import("../api/server.zig").ServerAllConnectionsClosedTask;
const FlushPendingFileSinkTask = bun.webcore.FileSink.FlushPendingTask;

const bun = @import("bun");
const JSC = bun.JSC;
const Async = bun.Async;
const VirtualMachine = JSC.VirtualMachine;
const JSCScheduler = @import("./JSCScheduler.zig");
const Environment = bun.Environment;
const Timer = JSC.API.Timer;
const Fetch = @import("../webcore/fetch.zig");
const AnyTask = JSC.AnyTask;
const CppTask = JSC.CppTask;
const ManagedTask = JSC.ManagedTask;
const PosixSignalTask = JSC.PosixSignalTask;
const EventLoop = JSC.EventLoop;
const shell = bun.shell;
const log = bun.Output.scoped(.Task, true);
