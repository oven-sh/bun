// This file contains the underlying implementation for sync & async functions
// for interacting with the filesystem from JavaScript.
// The top-level functions assume the arguments are already validated
const std = @import("std");
const bun = @import("root").bun;
const strings = bun.strings;
const windows = bun.windows;
const string = bun.string;
const JSC = bun.JSC;
const PathString = JSC.PathString;
const Environment = bun.Environment;
const C = bun.C;
const Flavor = JSC.Node.Flavor;
const system = std.posix.system;
const Maybe = JSC.Maybe;
const Encoding = JSC.Node.Encoding;
const PosixToWinNormalizer = bun.path.PosixToWinNormalizer;

const FileDescriptor = bun.FileDescriptor;
const FDImpl = bun.FDImpl;

const Syscall = if (Environment.isWindows) bun.sys.sys_uv else bun.sys;

const Constants = @import("./node_fs_constant.zig").Constants;
const builtin = @import("builtin");
const posix = std.posix;
const darwin = std.os.darwin;
const linux = std.os.linux;
const PathLike = JSC.Node.PathLike;
const PathOrFileDescriptor = JSC.Node.PathOrFileDescriptor;
const DirIterator = @import("./dir_iterator.zig");
const Path = @import("../../resolver/resolve_path.zig");
const FileSystem = @import("../../fs.zig").FileSystem;
const ArgumentsSlice = JSC.Node.ArgumentsSlice;
const TimeLike = JSC.Node.TimeLike;
const Mode = bun.Mode;
const uv = bun.windows.libuv;
const E = C.E;
const uid_t = if (Environment.isPosix) std.posix.uid_t else bun.windows.libuv.uv_uid_t;
const gid_t = if (Environment.isPosix) std.posix.gid_t else bun.windows.libuv.uv_gid_t;
const ReadPosition = i64;
const StringOrBuffer = JSC.Node.StringOrBuffer;
const NodeFSFunctionEnum = std.meta.DeclEnum(JSC.Node.NodeFS);
const UvFsCallback = fn (*uv.fs_t) callconv(.C) void;

const Stats = JSC.Node.Stats;
const Dirent = JSC.Node.Dirent;

pub const default_permission = if (Environment.isPosix)
    Syscall.S.IRUSR |
        Syscall.S.IWUSR |
        Syscall.S.IRGRP |
        Syscall.S.IWGRP |
        Syscall.S.IROTH |
        Syscall.S.IWOTH
else
    // Windows does not have permissions
    0;

const ArrayBuffer = JSC.MarkedArrayBuffer;
const Buffer = JSC.Buffer;
const FileSystemFlags = JSC.Node.FileSystemFlags;
pub const Async = struct {
    pub const access = NewAsyncFSTask(Return.Access, Arguments.Access, NodeFS.access);
    pub const appendFile = NewAsyncFSTask(Return.AppendFile, Arguments.AppendFile, NodeFS.appendFile);
    pub const chmod = NewAsyncFSTask(Return.Chmod, Arguments.Chmod, NodeFS.chmod);
    pub const chown = NewAsyncFSTask(Return.Chown, Arguments.Chown, NodeFS.chown);
    pub const close = NewUVFSRequest(Return.Close, Arguments.Close, .close);
    pub const copyFile = NewAsyncFSTask(Return.CopyFile, Arguments.CopyFile, NodeFS.copyFile);
    pub const exists = NewAsyncFSTask(Return.Exists, Arguments.Exists, NodeFS.exists);
    pub const fchmod = NewAsyncFSTask(Return.Fchmod, Arguments.FChmod, NodeFS.fchmod);
    pub const fchown = NewAsyncFSTask(Return.Fchown, Arguments.Fchown, NodeFS.fchown);
    pub const fdatasync = NewAsyncFSTask(Return.Fdatasync, Arguments.FdataSync, NodeFS.fdatasync);
    pub const fstat = NewAsyncFSTask(Return.Fstat, Arguments.Fstat, NodeFS.fstat);
    pub const fsync = NewAsyncFSTask(Return.Fsync, Arguments.Fsync, NodeFS.fsync);
    pub const ftruncate = NewAsyncFSTask(Return.Ftruncate, Arguments.FTruncate, NodeFS.ftruncate);
    pub const futimes = NewAsyncFSTask(Return.Futimes, Arguments.Futimes, NodeFS.futimes);
    pub const lchmod = NewAsyncFSTask(Return.Lchmod, Arguments.LCHmod, NodeFS.lchmod);
    pub const lchown = NewAsyncFSTask(Return.Lchown, Arguments.LChown, NodeFS.lchown);
    pub const link = NewAsyncFSTask(Return.Link, Arguments.Link, NodeFS.link);
    pub const lstat = NewAsyncFSTask(Return.Stat, Arguments.Stat, NodeFS.lstat);
    pub const lutimes = NewAsyncFSTask(Return.Lutimes, Arguments.Lutimes, NodeFS.lutimes);
    pub const mkdir = NewAsyncFSTask(Return.Mkdir, Arguments.Mkdir, NodeFS.mkdir);
    pub const mkdtemp = NewAsyncFSTask(Return.Mkdtemp, Arguments.MkdirTemp, NodeFS.mkdtemp);
    pub const open = NewUVFSRequest(Return.Open, Arguments.Open, .open);
    pub const read = NewUVFSRequest(Return.Read, Arguments.Read, .read);
    pub const readdir = NewAsyncFSTask(Return.Readdir, Arguments.Readdir, NodeFS.readdir);
    pub const readFile = NewAsyncFSTask(Return.ReadFile, Arguments.ReadFile, NodeFS.readFile);
    pub const readlink = NewAsyncFSTask(Return.Readlink, Arguments.Readlink, NodeFS.readlink);
    pub const readv = NewUVFSRequest(Return.Readv, Arguments.Readv, .readv);
    pub const realpath = NewAsyncFSTask(Return.Realpath, Arguments.Realpath, NodeFS.realpath);
    pub const rename = NewAsyncFSTask(Return.Rename, Arguments.Rename, NodeFS.rename);
    pub const rm = NewAsyncFSTask(Return.Rm, Arguments.Rm, NodeFS.rm);
    pub const rmdir = NewAsyncFSTask(Return.Rmdir, Arguments.RmDir, NodeFS.rmdir);
    pub const stat = NewAsyncFSTask(Return.Stat, Arguments.Stat, NodeFS.stat);
    pub const symlink = NewAsyncFSTask(Return.Symlink, Arguments.Symlink, NodeFS.symlink);
    pub const truncate = NewAsyncFSTask(Return.Truncate, Arguments.Truncate, NodeFS.truncate);
    pub const unlink = NewAsyncFSTask(Return.Unlink, Arguments.Unlink, NodeFS.unlink);
    pub const utimes = NewAsyncFSTask(Return.Utimes, Arguments.Utimes, NodeFS.utimes);
    pub const write = NewUVFSRequest(Return.Write, Arguments.Write, .write);
    pub const writeFile = NewAsyncFSTask(Return.WriteFile, Arguments.WriteFile, NodeFS.writeFile);
    pub const writev = NewUVFSRequest(Return.Writev, Arguments.Writev, .writev);

    pub const cp = AsyncCpTask;

    pub const readdir_recursive = AsyncReaddirRecursiveTask;

    /// Used internally. Not from JavaScript.
    pub const AsyncMkdirp = struct {
        completion_ctx: *anyopaque,
        completion: *const fn (*anyopaque, JSC.Maybe(void)) void,

        /// Memory is not owned by this struct
        path: []const u8,

        task: JSC.WorkPoolTask = .{ .callback = &workPoolCallback },

        pub usingnamespace bun.New(@This());

        pub fn workPoolCallback(task: *JSC.WorkPoolTask) void {
            var this: *AsyncMkdirp = @fieldParentPtr("task", task);

            var node_fs = NodeFS{};
            const result = node_fs.mkdirRecursive(
                Arguments.Mkdir{
                    .path = PathLike{ .string = PathString.init(this.path) },
                    .recursive = true,
                },
                .sync,
            );
            switch (result) {
                .err => |err| {
                    this.completion(this.completion_ctx, .{ .err = err.withPath(bun.default_allocator.dupe(u8, err.path) catch bun.outOfMemory()) });
                },
                .result => {
                    this.completion(this.completion_ctx, JSC.Maybe(void).success);
                },
            }
        }

        pub fn schedule(this: *AsyncMkdirp) void {
            JSC.WorkPool.schedule(&this.task);
        }
    };

    fn NewUVFSRequest(comptime ReturnType: type, comptime ArgumentType: type, comptime FunctionEnum: NodeFSFunctionEnum) type {
        if (!Environment.isWindows) {
            return NewAsyncFSTask(ReturnType, ArgumentType, @field(NodeFS, @tagName(FunctionEnum)));
        }
        switch (FunctionEnum) {
            .open,
            .close,
            .read,
            .write,
            .readv,
            .writev,
            => {},
            else => return NewAsyncFSTask(ReturnType, ArgumentType, @field(NodeFS, @tagName(FunctionEnum))),
        }

        comptime bun.assert(Environment.isWindows);
        return struct {
            promise: JSC.JSPromise.Strong,
            args: ArgumentType,
            globalObject: *JSC.JSGlobalObject,
            req: uv.fs_t = std.mem.zeroes(uv.fs_t),
            result: JSC.Maybe(ReturnType),
            ref: bun.Async.KeepAlive = .{},
            tracker: JSC.AsyncTaskTracker,

            pub const Task = @This();

            pub const heap_label = "Async" ++ bun.meta.typeBaseName(@typeName(ArgumentType)) ++ "UvTask";

            pub usingnamespace bun.New(@This());

            pub fn create(globalObject: *JSC.JSGlobalObject, this: *JSC.Node.NodeJSFS, args: ArgumentType, vm: *JSC.VirtualMachine) JSC.JSValue {
                var task = Task.new(.{
                    .promise = JSC.JSPromise.Strong.init(globalObject),
                    .args = args,
                    .result = undefined,
                    .globalObject = globalObject,
                    .tracker = JSC.AsyncTaskTracker.init(vm),
                });
                task.ref.ref(vm);
                task.args.toThreadSafe();

                task.tracker.didSchedule(globalObject);

                const log = bun.sys.syslog;
                const loop = uv.Loop.get();
                task.req.data = task;
                switch (comptime FunctionEnum) {
                    .open => {
                        const args_: Arguments.Open = task.args;
                        const path = if (bun.strings.eqlComptime(args_.path.slice(), "/dev/null")) "\\\\.\\NUL" else args_.path.sliceZ(&this.node_fs.sync_error_buf);

                        var flags: c_int = @intFromEnum(args_.flags);
                        flags = uv.O.fromBunO(flags);

                        var mode: c_int = args_.mode;
                        if (mode == 0) mode = 0o644;

                        const rc = uv.uv_fs_open(loop, &task.req, path.ptr, flags, mode, &uv_callback);
                        bun.debugAssert(rc == .zero);
                        log("uv open({s}, {d}, {d}) = ~~", .{ path, flags, mode });
                    },
                    .close => {
                        const args_: Arguments.Close = task.args;
                        const fd = args_.fd.impl().uv();

                        if (fd == 1 or fd == 2) {
                            log("uv close({}) SKIPPED", .{fd});
                            task.result = Maybe(Return.Close).success;
                            task.globalObject.bunVM().eventLoop().enqueueTask(JSC.Task.init(task));
                            return task.promise.value();
                        }

                        const rc = uv.uv_fs_close(loop, &task.req, fd, &uv_callback);
                        bun.debugAssert(rc == .zero);
                        log("uv close({d}) = ~~", .{fd});
                    },
                    .read => {
                        const args_: Arguments.Read = task.args;
                        const B = uv.uv_buf_t.init;
                        const fd = args_.fd.impl().uv();

                        const rc = uv.uv_fs_read(loop, &task.req, fd, &.{B(args_.buffer.slice()[args_.offset..])}, 1, args_.position orelse -1, &uv_callback);
                        bun.debugAssert(rc == .zero);
                        log("uv read({d}) = ~~", .{fd});
                    },
                    .write => {
                        const args_: Arguments.Write = task.args;
                        const B = uv.uv_buf_t.init;
                        const fd = args_.fd.impl().uv();

                        const rc = uv.uv_fs_write(loop, &task.req, fd, &.{B(args_.buffer.slice()[args_.offset..])}, 1, args_.position orelse -1, &uv_callback);
                        bun.debugAssert(rc == .zero);
                        log("uv write({d}) = ~~", .{fd});
                    },
                    .readv => {
                        const args_: Arguments.Readv = task.args;
                        const fd = args_.fd.impl().uv();
                        const bufs = args_.buffers.buffers.items;
                        const pos: i64 = args_.position orelse -1;

                        var sum: u64 = 0;
                        for (bufs) |b| sum += b.slice().len;

                        const rc = uv.uv_fs_read(loop, &task.req, fd, bufs.ptr, @intCast(bufs.len), pos, &uv_callback);
                        bun.debugAssert(rc == .zero);
                        log("uv readv({d}, {*}, {d}, {d}, {d} total bytes) = ~~", .{ fd, bufs.ptr, bufs.len, pos, sum });
                    },
                    .writev => {
                        const args_: Arguments.Writev = task.args;
                        const fd = args_.fd.impl().uv();
                        const bufs = args_.buffers.buffers.items;
                        const pos: i64 = args_.position orelse -1;

                        var sum: u64 = 0;
                        for (bufs) |b| sum += b.slice().len;

                        const rc = uv.uv_fs_write(loop, &task.req, fd, bufs.ptr, @intCast(bufs.len), pos, &uv_callback);
                        bun.debugAssert(rc == .zero);
                        log("uv writev({d}, {*}, {d}, {d}, {d} total bytes) = ~~", .{ fd, bufs.ptr, bufs.len, pos, sum });
                    },
                    else => comptime unreachable,
                }

                return task.promise.value();
            }

            fn uv_callback(req: *uv.fs_t) callconv(.C) void {
                defer uv.uv_fs_req_cleanup(req);
                const this: *Task = @ptrCast(@alignCast(req.data.?));
                var node_fs = NodeFS{};
                this.result = @field(NodeFS, "uv_" ++ @tagName(FunctionEnum))(&node_fs, this.args, @intFromEnum(req.result));

                if (this.result == .err) {
                    this.result.err.path = bun.default_allocator.dupe(u8, this.result.err.path) catch "";
                    std.mem.doNotOptimizeAway(&node_fs);
                }

                this.globalObject.bunVM().eventLoop().enqueueTask(JSC.Task.init(this));
            }

            pub fn runFromJSThread(this: *Task) void {
                const globalObject = this.globalObject;
                var success = @as(JSC.Maybe(ReturnType).Tag, this.result) == .result;
                const result = switch (this.result) {
                    .err => |err| err.toJSC(globalObject),
                    .result => |*res| brk: {
                        const out = globalObject.toJS(res, .temporary);
                        success = out != .zero;

                        break :brk out;
                    },
                };
                var promise_value = this.promise.value();
                var promise = this.promise.get();
                promise_value.ensureStillAlive();

                const tracker = this.tracker;
                tracker.willDispatch(globalObject);
                defer tracker.didDispatch(globalObject);

                this.deinit();
                switch (success) {
                    false => {
                        promise.reject(globalObject, result);
                    },
                    true => {
                        promise.resolve(globalObject, result);
                    },
                }
            }

            pub fn deinit(this: *Task) void {
                if (this.result == .err) {
                    bun.default_allocator.free(this.result.err.path);
                }

                this.ref.unref(this.globalObject.bunVM());
                if (@hasDecl(ArgumentType, "deinitAndUnprotect")) {
                    this.args.deinitAndUnprotect();
                } else {
                    this.args.deinit();
                }
                this.promise.deinit();
                this.destroy();
            }
        };
    }

    fn NewAsyncFSTask(comptime ReturnType: type, comptime ArgumentType: type, comptime Function: anytype) type {
        return struct {
            promise: JSC.JSPromise.Strong,
            args: ArgumentType,
            globalObject: *JSC.JSGlobalObject,
            task: JSC.WorkPoolTask = .{ .callback = &workPoolCallback },
            result: JSC.Maybe(ReturnType),
            ref: bun.Async.KeepAlive = .{},
            tracker: JSC.AsyncTaskTracker,

            pub const Task = @This();

            pub const heap_label = "Async" ++ bun.meta.typeBaseName(@typeName(ArgumentType)) ++ "Task";

            pub fn create(
                globalObject: *JSC.JSGlobalObject,
                _: *JSC.Node.NodeJSFS,
                args: ArgumentType,
                vm: *JSC.VirtualMachine,
            ) JSC.JSValue {
                var task = bun.new(
                    Task,
                    Task{
                        .promise = JSC.JSPromise.Strong.init(globalObject),
                        .args = args,
                        .result = undefined,
                        .globalObject = globalObject,
                        .tracker = JSC.AsyncTaskTracker.init(vm),
                    },
                );
                task.ref.ref(vm);
                task.args.toThreadSafe();
                task.tracker.didSchedule(globalObject);
                JSC.WorkPool.schedule(&task.task);

                return task.promise.value();
            }

            fn workPoolCallback(task: *JSC.WorkPoolTask) void {
                var this: *Task = @alignCast(@fieldParentPtr("task", task));

                var node_fs = NodeFS{};
                this.result = Function(&node_fs, this.args, .promise);

                if (this.result == .err) {
                    this.result.err.path = bun.default_allocator.dupe(u8, this.result.err.path) catch "";
                    std.mem.doNotOptimizeAway(&node_fs);
                }

                this.globalObject.bunVMConcurrently().eventLoop().enqueueTaskConcurrent(JSC.ConcurrentTask.createFrom(this));
            }

            pub fn runFromJSThread(this: *Task) void {
                const globalObject = this.globalObject;
                var success = @as(JSC.Maybe(ReturnType).Tag, this.result) == .result;
                const result = switch (this.result) {
                    .err => |err| err.toJSC(globalObject),
                    .result => |*res| brk: {
                        const out = globalObject.toJS(res, .temporary);
                        success = out != .zero;

                        break :brk out;
                    },
                };
                var promise_value = this.promise.value();
                var promise = this.promise.get();
                promise_value.ensureStillAlive();

                const tracker = this.tracker;
                tracker.willDispatch(globalObject);
                defer tracker.didDispatch(globalObject);

                this.deinit();
                switch (success) {
                    false => {
                        promise.reject(globalObject, result);
                    },
                    true => {
                        promise.resolve(globalObject, result);
                    },
                }
            }

            pub fn deinit(this: *Task) void {
                if (this.result == .err) {
                    bun.default_allocator.free(this.result.err.path);
                }

                this.ref.unref(this.globalObject.bunVM());
                if (@hasDecl(ArgumentType, "deinitAndUnprotect")) {
                    this.args.deinitAndUnprotect();
                } else {
                    this.args.deinit();
                }
                this.promise.deinit();
                bun.destroy(this);
            }
        };
    }
};

pub const AsyncCpTask = NewAsyncCpTask(false);
pub const ShellAsyncCpTask = NewAsyncCpTask(true);

pub fn NewAsyncCpTask(comptime is_shell: bool) type {
    const ShellTask = bun.shell.Interpreter.Builtin.Cp.ShellCpTask;
    const ShellTaskT = if (is_shell) *ShellTask else u0;
    return struct {
        promise: JSC.JSPromise.Strong = .{},
        args: Arguments.Cp,
        evtloop: JSC.EventLoopHandle,
        task: JSC.WorkPoolTask = .{ .callback = &workPoolCallback },
        result: JSC.Maybe(Return.Cp),
        /// If this task is called by the shell then we shouldn't call this as
        /// it is not threadsafe and is unnecessary as the process will be kept
        /// alive by the shell instance
        ref: if (!is_shell) bun.Async.KeepAlive else struct {} = .{},
        arena: bun.ArenaAllocator,
        tracker: JSC.AsyncTaskTracker,
        has_result: std.atomic.Value(bool),
        /// On each creation of a `AsyncCpSingleFileTask`, this is incremented.
        /// When each task is finished, decrement.
        /// The maintask thread starts this at 1 and decrements it at the end, to avoid the promise being resolved while new tasks may be added.
        subtask_count: std.atomic.Value(usize),
        deinitialized: bool = false,

        shelltask: ShellTaskT,

        const ThisAsyncCpTask = @This();

        /// This task is used by `AsyncCpTask/fs.promises.cp` to copy a single file.
        /// When clonefile cannot be used, this task is started once per file.
        pub const SingleTask = struct {
            cp_task: *ThisAsyncCpTask,
            src: bun.OSPathSliceZ,
            dest: bun.OSPathSliceZ,
            task: JSC.WorkPoolTask = .{ .callback = &SingleTask.workPoolCallback },

            const ThisSingleTask = @This();

            pub fn create(
                parent: *ThisAsyncCpTask,
                src: bun.OSPathSliceZ,
                dest: bun.OSPathSliceZ,
            ) void {
                var task = bun.new(ThisSingleTask, .{
                    .cp_task = parent,
                    .src = src,
                    .dest = dest,
                });

                JSC.WorkPool.schedule(&task.task);
            }

            fn workPoolCallback(task: *JSC.WorkPoolTask) void {
                var this: *ThisSingleTask = @fieldParentPtr("task", task);

                // TODO: error strings on node_fs will die
                var node_fs = NodeFS{};

                const args = this.cp_task.args;
                const result = node_fs._copySingleFileSync(
                    this.src,
                    this.dest,
                    @enumFromInt((if (args.flags.errorOnExist or !args.flags.force) Constants.COPYFILE_EXCL else @as(u8, 0))),
                    null,
                    this.cp_task.args,
                );

                brk: {
                    switch (result) {
                        .err => |err| {
                            if (err.errno == @intFromEnum(E.EXIST) and !args.flags.errorOnExist) {
                                break :brk;
                            }
                            this.cp_task.finishConcurrently(result);
                            this.deinit();
                            return;
                        },
                        .result => {
                            this.cp_task.onCopy(this.src, this.dest);
                        },
                    }
                }

                const old_count = this.cp_task.subtask_count.fetchSub(1, .monotonic);
                if (old_count == 1) {
                    this.cp_task.finishConcurrently(Maybe(Return.Cp).success);
                }

                this.deinit();
            }

            pub fn deinit(this: *ThisSingleTask) void {
                // There is only one path buffer for both paths. 2 extra bytes are the nulls at the end of each
                bun.default_allocator.free(this.src.ptr[0 .. this.src.len + this.dest.len + 2]);

                bun.destroy(this);
            }
        };

        pub fn onCopy(this: *ThisAsyncCpTask, src: anytype, dest: anytype) void {
            if (comptime !is_shell) return;
            const task = this.shelltask;
            task.cpOnCopy(src, dest);
        }

        pub fn onFinish(this: *ThisAsyncCpTask, result: Maybe(void)) void {
            if (comptime !is_shell) return;
            const task = this.shelltask;
            task.cpOnFinish(result);
        }

        pub fn create(
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.Node.NodeJSFS,
            cp_args: Arguments.Cp,
            vm: *JSC.VirtualMachine,
            arena: bun.ArenaAllocator,
        ) JSC.JSValue {
            const task = createWithShellTask(globalObject, cp_args, vm, arena, 0, true);
            return task.promise.value();
        }

        pub fn createWithShellTask(
            globalObject: *JSC.JSGlobalObject,
            cp_args: Arguments.Cp,
            vm: *JSC.VirtualMachine,
            arena: bun.ArenaAllocator,
            shelltask: ShellTaskT,
            comptime enable_promise: bool,
        ) *ThisAsyncCpTask {
            var task = bun.new(
                ThisAsyncCpTask,
                ThisAsyncCpTask{
                    .promise = if (comptime enable_promise) JSC.JSPromise.Strong.init(globalObject) else .{},
                    .args = cp_args,
                    .has_result = .{ .raw = false },
                    .result = undefined,
                    .evtloop = .{ .js = vm.event_loop },
                    .tracker = JSC.AsyncTaskTracker.init(vm),
                    .arena = arena,
                    .subtask_count = .{ .raw = 1 },
                    .shelltask = shelltask,
                },
            );
            if (comptime !is_shell) task.ref.ref(vm);
            task.args.src.toThreadSafe();
            task.args.dest.toThreadSafe();
            task.tracker.didSchedule(globalObject);

            JSC.WorkPool.schedule(&task.task);

            return task;
        }

        pub fn createMini(
            cp_args: Arguments.Cp,
            mini: *JSC.MiniEventLoop,
            arena: bun.ArenaAllocator,
            shelltask: *ShellTask,
        ) *ThisAsyncCpTask {
            var task = bun.new(
                ThisAsyncCpTask,
                ThisAsyncCpTask{
                    .args = cp_args,
                    .has_result = .{ .raw = false },
                    .result = undefined,
                    .evtloop = .{ .mini = mini },
                    .tracker = JSC.AsyncTaskTracker{ .id = 0 },
                    .arena = arena,
                    .subtask_count = .{ .raw = 1 },
                    .shelltask = shelltask,
                },
            );
            if (comptime !is_shell) task.ref.ref(mini);
            task.args.src.toThreadSafe();
            task.args.dest.toThreadSafe();

            JSC.WorkPool.schedule(&task.task);

            return task;
        }

        fn workPoolCallback(task: *JSC.WorkPoolTask) void {
            const this: *ThisAsyncCpTask = @alignCast(@fieldParentPtr("task", task));

            var node_fs = NodeFS{};
            ThisAsyncCpTask.cpAsync(&node_fs, this);
        }

        /// May be called from any thread (the subtasks)
        fn finishConcurrently(this: *ThisAsyncCpTask, result: Maybe(Return.Cp)) void {
            if (this.has_result.cmpxchgStrong(false, true, .monotonic, .monotonic)) |_| {
                return;
            }

            this.result = result;

            if (this.result == .err) {
                this.result.err.path = bun.default_allocator.dupe(u8, this.result.err.path) catch "";
            }

            if (this.evtloop == .js) {
                this.evtloop.enqueueTaskConcurrent(.{ .js = JSC.ConcurrentTask.fromCallback(this, runFromJSThread) });
            } else {
                this.evtloop.enqueueTaskConcurrent(.{ .mini = JSC.AnyTaskWithExtraContext.fromCallbackAutoDeinit(this, "runFromJSThreadMini") });
            }
        }

        pub fn runFromJSThreadMini(this: *ThisAsyncCpTask, _: *void) void {
            this.runFromJSThread();
        }

        fn runFromJSThread(this: *ThisAsyncCpTask) void {
            if (comptime is_shell) {
                this.shelltask.cpOnFinish(this.result);
                this.deinit();
                return;
            }
            const globalObject = this.evtloop.globalObject() orelse {
                @panic("No global object, this indicates a bug in Bun. Please file a GitHub issue.");
            };
            var success = @as(JSC.Maybe(Return.Cp).Tag, this.result) == .result;
            const result = switch (this.result) {
                .err => |err| err.toJSC(globalObject),
                .result => |*res| brk: {
                    const out = globalObject.toJS(res, .temporary);
                    success = out != .zero;

                    break :brk out;
                },
            };
            var promise_value = this.promise.value();
            var promise = this.promise.get();
            promise_value.ensureStillAlive();

            const tracker = this.tracker;
            tracker.willDispatch(globalObject);
            defer tracker.didDispatch(globalObject);

            this.deinit();
            switch (success) {
                false => {
                    promise.reject(globalObject, result);
                },
                true => {
                    promise.resolve(globalObject, result);
                },
            }
        }

        pub fn deinit(this: *ThisAsyncCpTask) void {
            bun.assert(!this.deinitialized);
            this.deinitialized = true;
            if (comptime !is_shell) this.ref.unref(this.evtloop);
            this.args.deinit();
            this.promise.deinit();
            this.arena.deinit();
            bun.destroy(this);
        }

        /// Directory scanning + clonefile will block this thread, then each individual file copy (what the sync version
        /// calls "_copySingleFileSync") will be dispatched as a separate task.
        pub fn cpAsync(
            nodefs: *NodeFS,
            this: *ThisAsyncCpTask,
        ) void {
            const args = this.args;
            var src_buf: bun.OSPathBuffer = undefined;
            var dest_buf: bun.OSPathBuffer = undefined;
            const src = args.src.osPath(@ptrCast(&src_buf));
            const dest = args.dest.osPath(@ptrCast(&dest_buf));

            if (Environment.isWindows) {
                const attributes = windows.GetFileAttributesW(src);
                if (attributes == windows.INVALID_FILE_ATTRIBUTES) {
                    this.finishConcurrently(.{ .err = .{
                        .errno = @intFromEnum(C.SystemErrno.ENOENT),
                        .syscall = .copyfile,
                        .path = nodefs.osPathIntoSyncErrorBuf(src),
                    } });
                    return;
                }
                const file_or_symlink = (attributes & windows.FILE_ATTRIBUTE_DIRECTORY) == 0 or (attributes & windows.FILE_ATTRIBUTE_REPARSE_POINT) != 0;
                if (file_or_symlink) {
                    const r = nodefs._copySingleFileSync(
                        src,
                        dest,
                        if (comptime is_shell)
                            // Shell always forces copy
                            @enumFromInt(Constants.Copyfile.force)
                        else
                            @enumFromInt((if (args.flags.errorOnExist or !args.flags.force) Constants.COPYFILE_EXCL else @as(u8, 0))),
                        attributes,
                        this.args,
                    );
                    if (r == .err and r.err.errno == @intFromEnum(E.EXIST) and !args.flags.errorOnExist) {
                        this.finishConcurrently(Maybe(Return.Cp).success);
                        return;
                    }
                    this.onCopy(src, dest);
                    this.finishConcurrently(r);
                    return;
                }
            } else {
                const stat_ = switch (Syscall.lstat(src)) {
                    .result => |result| result,
                    .err => |err| {
                        @memcpy(nodefs.sync_error_buf[0..src.len], src);
                        this.finishConcurrently(.{ .err = err.withPath(nodefs.sync_error_buf[0..src.len]) });
                        return;
                    },
                };

                if (!bun.S.ISDIR(stat_.mode)) {
                    // This is the only file, there is no point in dispatching subtasks
                    const r = nodefs._copySingleFileSync(
                        src,
                        dest,
                        @enumFromInt((if (args.flags.errorOnExist or !args.flags.force) Constants.COPYFILE_EXCL else @as(u8, 0))),
                        stat_,
                        this.args,
                    );
                    if (r == .err and r.err.errno == @intFromEnum(E.EXIST) and !args.flags.errorOnExist) {
                        this.onCopy(src, dest);
                        this.finishConcurrently(Maybe(Return.Cp).success);
                        return;
                    }
                    this.onCopy(src, dest);
                    this.finishConcurrently(r);
                    return;
                }
            }
            if (!args.flags.recursive) {
                this.finishConcurrently(.{ .err = .{
                    .errno = @intFromEnum(E.ISDIR),
                    .syscall = .copyfile,
                    .path = nodefs.osPathIntoSyncErrorBuf(src),
                } });
                return;
            }

            const success = ThisAsyncCpTask._cpAsyncDirectory(nodefs, args.flags, this, &src_buf, @intCast(src.len), &dest_buf, @intCast(dest.len));
            const old_count = this.subtask_count.fetchSub(1, .monotonic);
            if (success and old_count == 1) {
                this.finishConcurrently(Maybe(Return.Cp).success);
            }
        }

        // returns boolean `should_continue`
        fn _cpAsyncDirectory(
            nodefs: *NodeFS,
            args: Arguments.Cp.Flags,
            this: *ThisAsyncCpTask,
            src_buf: *bun.OSPathBuffer,
            src_dir_len: PathString.PathInt,
            dest_buf: *bun.OSPathBuffer,
            dest_dir_len: PathString.PathInt,
        ) bool {
            const src = src_buf[0..src_dir_len :0];
            const dest = dest_buf[0..dest_dir_len :0];

            if (comptime Environment.isMac) {
                if (Maybe(Return.Cp).errnoSysP(C.clonefile(src, dest, 0), .clonefile, src)) |err| {
                    switch (err.getErrno()) {
                        .ACCES,
                        .NAMETOOLONG,
                        .ROFS,
                        .PERM,
                        .INVAL,
                        => {
                            @memcpy(nodefs.sync_error_buf[0..src.len], src);
                            this.finishConcurrently(.{ .err = err.err.withPath(nodefs.sync_error_buf[0..src.len]) });
                            return false;
                        },
                        // Other errors may be due to clonefile() not being supported
                        // We'll fall back to other implementations
                        else => {},
                    }
                } else {
                    return true;
                }
            }

            const open_flags = bun.O.DIRECTORY | bun.O.RDONLY;
            const fd = switch (Syscall.openatOSPath(bun.FD.cwd(), src, open_flags, 0)) {
                .err => |err| {
                    this.finishConcurrently(.{ .err = err.withPath(nodefs.osPathIntoSyncErrorBuf(src)) });
                    return false;
                },
                .result => |fd_| fd_,
            };
            defer _ = Syscall.close(fd);

            var buf: bun.OSPathBuffer = undefined;

            const normdest: bun.OSPathSliceZ = if (Environment.isWindows)
                switch (bun.sys.normalizePathWindows(u16, bun.invalid_fd, dest, &buf)) {
                    .err => |err| {
                        this.finishConcurrently(.{ .err = err });
                        return false;
                    },
                    .result => |normdest| normdest,
                }
            else
                dest;

            const mkdir_ = nodefs.mkdirRecursiveOSPath(normdest, Arguments.Mkdir.DefaultMode, false);
            switch (mkdir_) {
                .err => |err| {
                    this.finishConcurrently(.{ .err = err });
                    return false;
                },
                .result => {
                    this.onCopy(src, normdest);
                },
            }

            const dir = fd.asDir();
            var iterator = DirIterator.iterate(dir, if (Environment.isWindows) .u16 else .u8);
            var entry = iterator.next();
            while (switch (entry) {
                .err => |err| {
                    // @memcpy(this.sync_error_buf[0..src.len], src);
                    this.finishConcurrently(.{ .err = err.withPath(nodefs.osPathIntoSyncErrorBuf(src)) });
                    return false;
                },
                .result => |ent| ent,
            }) |current| : (entry = iterator.next()) {
                switch (current.kind) {
                    .directory => {
                        const cname = current.name.slice();
                        @memcpy(src_buf[src_dir_len + 1 .. src_dir_len + 1 + cname.len], cname);
                        src_buf[src_dir_len] = std.fs.path.sep;
                        src_buf[src_dir_len + 1 + cname.len] = 0;

                        @memcpy(dest_buf[dest_dir_len + 1 .. dest_dir_len + 1 + cname.len], cname);
                        dest_buf[dest_dir_len] = std.fs.path.sep;
                        dest_buf[dest_dir_len + 1 + cname.len] = 0;

                        const should_continue = ThisAsyncCpTask._cpAsyncDirectory(
                            nodefs,
                            args,
                            this,
                            src_buf,
                            @truncate(src_dir_len + 1 + cname.len),
                            dest_buf,
                            @truncate(dest_dir_len + 1 + cname.len),
                        );
                        if (!should_continue) return false;
                    },
                    else => {
                        _ = this.subtask_count.fetchAdd(1, .monotonic);

                        const cname = current.name.slice();

                        // Allocate a path buffer for the path data
                        var path_buf = bun.default_allocator.alloc(
                            bun.OSPathChar,
                            src_dir_len + 1 + cname.len + 1 + dest_dir_len + 1 + cname.len + 1,
                        ) catch bun.outOfMemory();

                        @memcpy(path_buf[0..src_dir_len], src_buf[0..src_dir_len]);
                        path_buf[src_dir_len] = std.fs.path.sep;
                        @memcpy(path_buf[src_dir_len + 1 .. src_dir_len + 1 + cname.len], cname);
                        path_buf[src_dir_len + 1 + cname.len] = 0;

                        @memcpy(path_buf[src_dir_len + 1 + cname.len + 1 .. src_dir_len + 1 + cname.len + 1 + dest_dir_len], dest_buf[0..dest_dir_len]);
                        path_buf[src_dir_len + 1 + cname.len + 1 + dest_dir_len] = std.fs.path.sep;
                        @memcpy(path_buf[src_dir_len + 1 + cname.len + 1 + dest_dir_len + 1 .. src_dir_len + 1 + cname.len + 1 + dest_dir_len + 1 + cname.len], cname);
                        path_buf[src_dir_len + 1 + cname.len + 1 + dest_dir_len + 1 + cname.len] = 0;

                        SingleTask.create(
                            this,
                            path_buf[0 .. src_dir_len + 1 + cname.len :0],
                            path_buf[src_dir_len + 1 + cname.len + 1 .. src_dir_len + 1 + cname.len + 1 + dest_dir_len + 1 + cname.len :0],
                        );
                    },
                }
            }

            return true;
        }
    };
}

pub const AsyncReaddirRecursiveTask = struct {
    promise: JSC.JSPromise.Strong,
    args: Arguments.Readdir,
    globalObject: *JSC.JSGlobalObject,
    task: JSC.WorkPoolTask = .{ .callback = &workPoolCallback },
    ref: bun.Async.KeepAlive = .{},
    tracker: JSC.AsyncTaskTracker,

    // It's not 100% clear this one is necessary
    has_result: std.atomic.Value(bool),

    subtask_count: std.atomic.Value(usize),

    /// The final result list
    result_list: ResultListEntry.Value = undefined,

    /// When joining the result list, we use this to preallocate the joined array.
    result_list_count: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),

    /// A lockless queue of result lists.
    ///
    /// Using a lockless queue instead of mutex + joining the lists as we go was a meaningful performance improvement
    result_list_queue: ResultListEntry.Queue = ResultListEntry.Queue{},

    /// All the subtasks will use this fd to open files
    root_fd: FileDescriptor = bun.invalid_fd,

    /// This isued when joining the file paths for error messages
    root_path: PathString = PathString.empty,

    pending_err: ?Syscall.Error = null,
    pending_err_mutex: bun.Mutex = .{},

    pub usingnamespace bun.New(@This());

    pub const ResultListEntry = struct {
        pub const Value = union(Return.Readdir.Tag) {
            with_file_types: std.ArrayList(Dirent),
            buffers: std.ArrayList(Buffer),
            files: std.ArrayList(bun.String),

            pub fn deinit(this: *@This()) void {
                switch (this.*) {
                    .with_file_types => |*res| {
                        for (res.items) |item| {
                            item.deref();
                        }
                        res.clearAndFree();
                    },
                    .buffers => |*res| {
                        for (res.items) |item| {
                            bun.default_allocator.free(item.buffer.byteSlice());
                        }
                        res.clearAndFree();
                    },
                    .files => |*res| {
                        for (res.items) |item| {
                            item.deref();
                        }

                        res.clearAndFree();
                    },
                }
            }
        };
        next: ?*ResultListEntry = null,
        value: Value,

        pub const Queue = bun.UnboundedQueue(ResultListEntry, .next);
    };

    pub const Subtask = struct {
        readdir_task: *AsyncReaddirRecursiveTask,
        basename: bun.PathString = bun.PathString.empty,
        task: JSC.WorkPoolTask = .{ .callback = call },

        pub usingnamespace bun.New(@This());

        pub fn call(task: *JSC.WorkPoolTask) void {
            var this: *Subtask = @alignCast(@fieldParentPtr("task", task));
            defer {
                bun.default_allocator.free(this.basename.sliceAssumeZ());
                this.destroy();
            }
            var buf: bun.PathBuffer = undefined;
            this.readdir_task.performWork(this.basename.sliceAssumeZ(), &buf, false);
        }
    };

    pub fn enqueue(
        readdir_task: *AsyncReaddirRecursiveTask,
        basename: [:0]const u8,
    ) void {
        var task = Subtask.new(
            .{
                .readdir_task = readdir_task,
                .basename = bun.PathString.init(bun.default_allocator.dupeZ(u8, basename) catch bun.outOfMemory()),
            },
        );
        bun.assert(readdir_task.subtask_count.fetchAdd(1, .monotonic) > 0);
        JSC.WorkPool.schedule(&task.task);
    }

    pub fn create(
        globalObject: *JSC.JSGlobalObject,
        args: Arguments.Readdir,
        vm: *JSC.VirtualMachine,
    ) JSC.JSValue {
        var task = AsyncReaddirRecursiveTask.new(.{
            .promise = JSC.JSPromise.Strong.init(globalObject),
            .args = args,
            .has_result = .{ .raw = false },
            .globalObject = globalObject,
            .tracker = JSC.AsyncTaskTracker.init(vm),
            .subtask_count = .{ .raw = 1 },
            .root_path = PathString.init(bun.default_allocator.dupeZ(u8, args.path.slice()) catch bun.outOfMemory()),
            .result_list = switch (args.tag()) {
                .files => .{ .files = std.ArrayList(bun.String).init(bun.default_allocator) },
                .with_file_types => .{ .with_file_types = std.ArrayList(Dirent).init(bun.default_allocator) },
                .buffers => .{ .buffers = std.ArrayList(Buffer).init(bun.default_allocator) },
            },
        });
        task.ref.ref(vm);
        task.args.toThreadSafe();
        task.tracker.didSchedule(globalObject);

        JSC.WorkPool.schedule(&task.task);

        return task.promise.value();
    }

    pub fn performWork(this: *AsyncReaddirRecursiveTask, basename: [:0]const u8, buf: *bun.PathBuffer, comptime is_root: bool) void {
        switch (this.args.tag()) {
            inline else => |tag| {
                const ResultType = comptime switch (tag) {
                    .files => bun.String,
                    .with_file_types => Dirent,
                    .buffers => Buffer,
                };
                var stack = std.heap.stackFallback(8192, bun.default_allocator);

                // This is a stack-local copy to avoid resizing heap-allocated arrays in the common case of a small directory
                var entries = std.ArrayList(ResultType).init(stack.get());

                defer entries.deinit();

                switch (NodeFS.readdirWithEntriesRecursiveAsync(
                    buf,
                    this.args,
                    this,
                    basename,
                    ResultType,
                    &entries,
                    is_root,
                )) {
                    .err => |err| {
                        for (entries.items) |*item| {
                            switch (ResultType) {
                                bun.String => item.deref(),
                                Dirent => item.deref(),
                                Buffer => bun.default_allocator.free(item.buffer.byteSlice()),
                                else => @compileError("unreachable"),
                            }
                        }

                        {
                            this.pending_err_mutex.lock();
                            defer this.pending_err_mutex.unlock();
                            if (this.pending_err == null) {
                                const err_path = if (err.path.len > 0) err.path else this.args.path.slice();
                                this.pending_err = err.withPath(bun.default_allocator.dupe(u8, err_path) catch "");
                            }
                        }

                        if (this.subtask_count.fetchSub(1, .monotonic) == 1) {
                            this.finishConcurrently();
                        }
                    },
                    .result => {
                        this.writeResults(ResultType, &entries);
                    },
                }
            },
        }
    }

    fn workPoolCallback(task: *JSC.WorkPoolTask) void {
        var this: *AsyncReaddirRecursiveTask = @alignCast(@fieldParentPtr("task", task));
        var buf: bun.PathBuffer = undefined;
        this.performWork(this.root_path.sliceAssumeZ(), &buf, true);
    }

    pub fn writeResults(this: *AsyncReaddirRecursiveTask, comptime ResultType: type, result: *std.ArrayList(ResultType)) void {
        if (result.items.len > 0) {
            const Field = switch (ResultType) {
                bun.String => .files,
                Dirent => .with_file_types,
                Buffer => .buffers,
                else => @compileError("unreachable"),
            };
            const list = bun.default_allocator.create(ResultListEntry) catch bun.outOfMemory();
            errdefer {
                bun.default_allocator.destroy(list);
            }
            var clone = std.ArrayList(ResultType).initCapacity(bun.default_allocator, result.items.len) catch bun.outOfMemory();
            clone.appendSliceAssumeCapacity(result.items);
            _ = this.result_list_count.fetchAdd(clone.items.len, .monotonic);
            list.* = ResultListEntry{ .next = null, .value = @unionInit(ResultListEntry.Value, @tagName(Field), clone) };
            this.result_list_queue.push(list);
        }

        if (this.subtask_count.fetchSub(1, .monotonic) == 1) {
            this.finishConcurrently();
        }
    }

    /// May be called from any thread (the subtasks)
    pub fn finishConcurrently(this: *AsyncReaddirRecursiveTask) void {
        if (this.has_result.cmpxchgStrong(false, true, .monotonic, .monotonic)) |_| {
            return;
        }

        bun.assert(this.subtask_count.load(.monotonic) == 0);

        const root_fd = this.root_fd;
        if (root_fd != bun.invalid_fd) {
            this.root_fd = bun.invalid_fd;
            _ = Syscall.close(root_fd);
            bun.default_allocator.free(this.root_path.slice());
            this.root_path = PathString.empty;
        }

        if (this.pending_err != null) {
            this.clearResultList();
        }

        {
            var list = this.result_list_queue.popBatch();
            var iter = list.iterator();

            // we have to free only the previous one because the next value will
            // be read by the iterator.
            var to_destroy: ?*ResultListEntry = null;

            switch (this.args.tag()) {
                inline else => |tag| {
                    var results = &@field(this.result_list, @tagName(tag));
                    results.ensureTotalCapacityPrecise(this.result_list_count.swap(0, .monotonic)) catch bun.outOfMemory();
                    while (iter.next()) |val| {
                        if (to_destroy) |dest| {
                            bun.default_allocator.destroy(dest);
                        }
                        to_destroy = val;

                        var to_copy = &@field(val.value, @tagName(tag));
                        results.appendSliceAssumeCapacity(to_copy.items);
                        to_copy.clearAndFree();
                    }

                    if (to_destroy) |dest| {
                        bun.default_allocator.destroy(dest);
                    }
                },
            }
        }

        this.globalObject.bunVMConcurrently().enqueueTaskConcurrent(JSC.ConcurrentTask.create(JSC.Task.init(this)));
    }

    fn clearResultList(this: *AsyncReaddirRecursiveTask) void {
        this.result_list.deinit();
        var batch = this.result_list_queue.popBatch();
        var iter = batch.iterator();
        var to_destroy: ?*ResultListEntry = null;

        while (iter.next()) |val| {
            val.value.deinit();
            if (to_destroy) |dest| {
                bun.default_allocator.destroy(dest);
            }
            to_destroy = val;
        }
        if (to_destroy) |dest| {
            bun.default_allocator.destroy(dest);
        }
        this.result_list_count.store(0, .monotonic);
    }

    pub fn runFromJSThread(this: *AsyncReaddirRecursiveTask) void {
        const globalObject = this.globalObject;
        var success = this.pending_err == null;
        const result = if (this.pending_err) |*err| err.toJSC(globalObject) else brk: {
            const res = switch (this.result_list) {
                .with_file_types => |*res| Return.Readdir{ .with_file_types = res.moveToUnmanaged().items },
                .buffers => |*res| Return.Readdir{ .buffers = res.moveToUnmanaged().items },
                .files => |*res| Return.Readdir{ .files = res.moveToUnmanaged().items },
            };
            const out = res.toJS(globalObject);
            if (out == .zero) {
                success = false;
            }

            break :brk out;
        };
        var promise_value = this.promise.value();
        var promise = this.promise.get();
        promise_value.ensureStillAlive();

        const tracker = this.tracker;
        tracker.willDispatch(globalObject);
        defer tracker.didDispatch(globalObject);

        this.deinit();
        switch (success) {
            false => {
                promise.reject(globalObject, result);
            },
            true => {
                promise.resolve(globalObject, result);
            },
        }
    }

    pub fn deinit(this: *AsyncReaddirRecursiveTask) void {
        bun.assert(this.root_fd == bun.invalid_fd); // should already have closed it
        if (this.pending_err) |*err| {
            bun.default_allocator.free(err.path);
        }

        this.ref.unref(this.globalObject.bunVM());
        this.args.deinit();
        bun.default_allocator.free(this.root_path.slice());
        this.clearResultList();
        this.promise.deinit();
        this.destroy();
    }
};

// TODO: to improve performance for all of these
// The tagged unions for each type should become regular unions
// and the tags should be passed in as comptime arguments to the functions performing the syscalls
// This would reduce stack size, at the cost of instruction cache misses
pub const Arguments = struct {
    pub const Rename = struct {
        old_path: PathLike,
        new_path: PathLike,

        pub fn deinit(this: @This()) void {
            this.old_path.deinit();
            this.new_path.deinit();
        }

        pub fn deinitAndUnprotect(this: @This()) void {
            this.old_path.deinitAndUnprotect();
            this.new_path.deinitAndUnprotect();
        }

        pub fn toThreadSafe(this: *@This()) void {
            this.old_path.toThreadSafe();
            this.new_path.toThreadSafe();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Rename {
            const old_path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("oldPath must be a string or TypedArray", .{});
            };

            const new_path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("newPath must be a string or TypedArray", .{});
            };

            return Rename{ .old_path = old_path, .new_path = new_path };
        }
    };

    pub const Truncate = struct {
        /// Passing a file descriptor is deprecated and may result in an error being thrown in the future.
        path: PathOrFileDescriptor,
        len: JSC.WebCore.Blob.SizeType = 0,
        flags: i32 = 0,

        pub fn deinit(this: @This()) void {
            this.path.deinit();
        }

        pub fn deinitAndUnprotect(this: *@This()) void {
            this.path.deinitAndUnprotect();
        }

        pub fn toThreadSafe(this: *@This()) void {
            this.path.toThreadSafe();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Truncate {
            const path = try PathOrFileDescriptor.fromJS(ctx, arguments, bun.default_allocator) orelse {
                return ctx.throwInvalidArguments("path must be a string or TypedArray", .{});
            };

            const len: JSC.WebCore.Blob.SizeType = brk: {
                const len_value = arguments.next() orelse break :brk 0;

                if (len_value.isNumber()) {
                    arguments.eat();
                    break :brk len_value.to(JSC.WebCore.Blob.SizeType);
                }

                break :brk 0;
            };

            return Truncate{ .path = path, .len = len };
        }
    };

    pub const Writev = struct {
        fd: FileDescriptor,
        buffers: JSC.Node.VectorArrayBuffer,
        position: ?u52 = 0,

        pub fn deinit(_: *const @This()) void {}

        pub fn deinitAndUnprotect(this: *const @This()) void {
            this.buffers.value.unprotect();
            this.buffers.buffers.deinit();
        }

        pub fn toThreadSafe(this: *@This()) void {
            this.buffers.value.protect();

            const clone = bun.default_allocator.dupe(bun.PlatformIOVec, this.buffers.buffers.items) catch bun.outOfMemory();
            this.buffers.buffers.deinit();
            this.buffers.buffers.items = clone;
            this.buffers.buffers.capacity = clone.len;
            this.buffers.buffers.allocator = bun.default_allocator;
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Writev {
            const fd_value = arguments.nextEat() orelse {
                return ctx.throwInvalidArguments("file descriptor is required", .{});
            };

            const fd = try JSC.Node.fileDescriptorFromJS(ctx, fd_value) orelse {
                return ctx.throwInvalidArguments("file descriptor must be a number", .{});
            };

            const buffers = try JSC.Node.VectorArrayBuffer.fromJS(
                ctx,
                arguments.protectEatNext() orelse {
                    return ctx.throwInvalidArguments("Expected an ArrayBufferView[]", .{});
                },
                arguments.arena.allocator(),
            );

            var position: ?u52 = null;

            if (arguments.nextEat()) |pos_value| {
                if (!pos_value.isUndefinedOrNull()) {
                    if (pos_value.isNumber()) {
                        position = pos_value.to(u52);
                    } else {
                        return ctx.throwInvalidArguments("position must be a number", .{});
                    }
                }
            }

            return Writev{ .fd = fd, .buffers = buffers, .position = position };
        }
    };

    pub const Readv = struct {
        fd: FileDescriptor,
        buffers: JSC.Node.VectorArrayBuffer,
        position: ?u52 = 0,

        pub fn deinit(this: *const @This()) void {
            _ = this;
        }

        pub fn deinitAndUnprotect(this: *const @This()) void {
            this.buffers.value.unprotect();
            this.buffers.buffers.deinit();
        }

        pub fn toThreadSafe(this: *@This()) void {
            this.buffers.value.protect();

            const clone = bun.default_allocator.dupe(bun.PlatformIOVec, this.buffers.buffers.items) catch bun.outOfMemory();
            this.buffers.buffers.deinit();
            this.buffers.buffers.items = clone;
            this.buffers.buffers.capacity = clone.len;
            this.buffers.buffers.allocator = bun.default_allocator;
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Readv {
            const fd_value = arguments.nextEat() orelse {
                return ctx.throwInvalidArguments("file descriptor is required", .{});
            };

            const fd = try JSC.Node.fileDescriptorFromJS(ctx, fd_value) orelse {
                return ctx.throwInvalidArguments("file descriptor must be a number", .{});
            };

            const buffers = try JSC.Node.VectorArrayBuffer.fromJS(
                ctx,
                arguments.protectEatNext() orelse {
                    return ctx.throwInvalidArguments("Expected an ArrayBufferView[]", .{});
                },
                arguments.arena.allocator(),
            );

            var position: ?u52 = null;

            if (arguments.nextEat()) |pos_value| {
                if (!pos_value.isUndefinedOrNull()) {
                    if (pos_value.isNumber()) {
                        position = pos_value.to(u52);
                    } else {
                        return ctx.throwInvalidArguments("position must be a number", .{});
                    }
                }
            }

            return Readv{ .fd = fd, .buffers = buffers, .position = position };
        }
    };

    pub const FTruncate = struct {
        fd: FileDescriptor,
        len: ?JSC.WebCore.Blob.SizeType = null,

        pub fn deinit(this: @This()) void {
            _ = this;
        }

        pub fn deinitAndUnprotect(this: *@This()) void {
            _ = this;
        }

        pub fn toThreadSafe(this: *const @This()) void {
            _ = this;
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!FTruncate {
            const fd = try JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("file descriptor is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("file descriptor must be a number", .{});
            };

            arguments.eat();

            const len: JSC.WebCore.Blob.SizeType = brk: {
                const len_value = arguments.next() orelse break :brk 0;
                if (len_value.isNumber()) {
                    arguments.eat();
                    break :brk len_value.to(JSC.WebCore.Blob.SizeType);
                }

                break :brk 0;
            };

            return FTruncate{ .fd = fd, .len = len };
        }
    };

    pub const Chown = struct {
        path: PathLike,
        uid: uid_t = 0,
        gid: gid_t = 0,

        pub fn deinit(this: @This()) void {
            this.path.deinit();
        }

        pub fn deinitAndUnprotect(this: *@This()) void {
            this.path.deinitAndUnprotect();
        }

        pub fn toThreadSafe(this: *@This()) void {
            this.path.toThreadSafe();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Chown {
            const path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("path must be a string or TypedArray", .{});
            };
            errdefer path.deinit();

            const uid: uid_t = brk: {
                const uid_value = arguments.next() orelse break :brk {
                    return ctx.throwInvalidArguments("uid is required", .{});
                };

                arguments.eat();
                if (!uid_value.isNumber()) {
                    return ctx.throwInvalidArgumentTypeValue("uid", "number", uid_value);
                }
                break :brk @as(uid_t, @intCast(uid_value.toInt32()));
            };

            const gid: gid_t = brk: {
                const gid_value = arguments.next() orelse break :brk {
                    return ctx.throwInvalidArguments("gid is required", .{});
                };

                arguments.eat();
                if (!gid_value.isNumber()) {
                    return ctx.throwInvalidArgumentTypeValue("gid", "number", gid_value);
                }
                break :brk @as(gid_t, @intCast(gid_value.toInt32()));
            };

            return Chown{ .path = path, .uid = uid, .gid = gid };
        }
    };

    pub const Fchown = struct {
        fd: FileDescriptor,
        uid: uid_t,
        gid: gid_t,

        pub fn deinit(_: @This()) void {}

        pub fn toThreadSafe(_: *const @This()) void {}

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Fchown {
            const fd = try JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("file descriptor is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("file descriptor must be a number", .{});
            };

            const uid: uid_t = brk: {
                const uid_value = arguments.next() orelse break :brk {
                    return ctx.throwInvalidArguments("uid is required", .{});
                };

                arguments.eat();
                break :brk @as(uid_t, @intCast(uid_value.toInt32()));
            };

            const gid: gid_t = brk: {
                const gid_value = arguments.next() orelse break :brk {
                    return ctx.throwInvalidArguments("gid is required", .{});
                };

                arguments.eat();
                break :brk @as(gid_t, @intCast(gid_value.toInt32()));
            };

            return Fchown{ .fd = fd, .uid = uid, .gid = gid };
        }
    };

    pub const LChown = Chown;

    pub const Lutimes = struct {
        path: PathLike,
        atime: TimeLike,
        mtime: TimeLike,

        pub fn deinit(this: @This()) void {
            this.path.deinit();
        }

        pub fn deinitAndUnprotect(this: *@This()) void {
            this.path.deinitAndUnprotect();
        }

        pub fn toThreadSafe(this: *@This()) void {
            this.path.toThreadSafe();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Lutimes {
            const path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("path must be a string or TypedArray", .{});
            };
            errdefer path.deinit();

            const atime = JSC.Node.timeLikeFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("atime is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("atime must be a number or a Date", .{});
            };

            arguments.eat();

            const mtime = JSC.Node.timeLikeFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("mtime is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("mtime must be a number or a Date", .{});
            };

            arguments.eat();

            return Lutimes{ .path = path, .atime = atime, .mtime = mtime };
        }
    };

    pub const Chmod = struct {
        path: PathLike,
        mode: Mode = 0x777,

        pub fn deinit(this: @This()) void {
            this.path.deinit();
        }

        pub fn toThreadSafe(this: *@This()) void {
            this.path.toThreadSafe();
        }

        pub fn deinitAndUnprotect(this: *@This()) void {
            this.path.deinitAndUnprotect();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Chmod {
            const path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("path must be a string or TypedArray", .{});
            };
            errdefer path.deinit();

            const mode: Mode = try JSC.Node.modeFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("mode is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("mode must be a string or integer", .{});
            };

            arguments.eat();

            return Chmod{ .path = path, .mode = mode };
        }
    };

    pub const FChmod = struct {
        fd: FileDescriptor,
        mode: Mode = 0x777,

        pub fn deinit(_: *const @This()) void {}

        pub fn toThreadSafe(_: *const @This()) void {}

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!FChmod {
            const fd = try JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("file descriptor is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("file descriptor must be a number", .{});
            };

            arguments.eat();

            const mode: Mode = try JSC.Node.modeFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("mode is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("mode must be a string or integer", .{});
            };

            arguments.eat();

            return FChmod{ .fd = fd, .mode = mode };
        }
    };

    pub const LCHmod = Chmod;

    pub const Stat = struct {
        path: PathLike,
        big_int: bool = false,
        throw_if_no_entry: bool = true,

        pub fn deinit(this: Stat) void {
            this.path.deinit();
        }

        pub fn deinitAndUnprotect(this: Stat) void {
            this.path.deinitAndUnprotect();
        }

        pub fn toThreadSafe(this: *Stat) void {
            this.path.toThreadSafe();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Stat {
            const path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("path must be a string or TypedArray", .{});
            };
            errdefer path.deinit();

            var throw_if_no_entry = true;

            const big_int = brk: {
                if (arguments.next()) |next_val| {
                    if (next_val.isObject()) {
                        if (next_val.isCallable(ctx.vm())) break :brk false;
                        arguments.eat();

                        if (try next_val.getBooleanStrict(ctx, "throwIfNoEntry")) |throw_if_no_entry_val| {
                            throw_if_no_entry = throw_if_no_entry_val;
                        }

                        if (try next_val.getBooleanStrict(ctx, "bigint")) |big_int| {
                            break :brk big_int;
                        }
                    }
                }
                break :brk false;
            };

            return Stat{ .path = path, .big_int = big_int, .throw_if_no_entry = throw_if_no_entry };
        }
    };

    pub const Fstat = struct {
        fd: FileDescriptor,
        big_int: bool = false,

        pub fn deinit(_: @This()) void {}

        pub fn toThreadSafe(_: *@This()) void {}

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Fstat {
            const fd = try JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("file descriptor is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("file descriptor must be a number", .{});
            };

            const big_int = brk: {
                if (arguments.next()) |next_val| {
                    if (next_val.isObject()) {
                        if (next_val.isCallable(ctx.vm())) break :brk false;
                        arguments.eat();

                        if (try next_val.getBooleanStrict(ctx, "bigint")) |big_int| {
                            break :brk big_int;
                        }
                    }
                }
                break :brk false;
            };

            return Fstat{ .fd = fd, .big_int = big_int };
        }
    };

    pub const Lstat = Stat;

    pub const Link = struct {
        old_path: PathLike,
        new_path: PathLike,

        pub fn deinit(this: Link) void {
            this.old_path.deinit();
            this.new_path.deinit();
        }

        pub fn deinitAndUnprotect(this: *Link) void {
            this.old_path.deinitAndUnprotect();
            this.new_path.deinitAndUnprotect();
        }

        pub fn toThreadSafe(this: *Link) void {
            this.old_path.toThreadSafe();
            this.new_path.toThreadSafe();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Link {
            const old_path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("oldPath must be a string or TypedArray", .{});
            };

            const new_path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("newPath must be a string or TypedArray", .{});
            };

            return Link{ .old_path = old_path, .new_path = new_path };
        }
    };

    pub const Symlink = struct {
        old_path: PathLike,
        new_path: PathLike,
        link_type: LinkType,

        const LinkType = if (!Environment.isWindows)
            u0
        else
            LinkTypeEnum;

        const LinkTypeEnum = enum {
            file,
            dir,
            junction,
        };

        pub fn deinit(this: Symlink) void {
            this.old_path.deinit();
            this.new_path.deinit();
        }

        pub fn deinitAndUnprotect(this: Symlink) void {
            this.old_path.deinitAndUnprotect();
            this.new_path.deinitAndUnprotect();
        }

        pub fn toThreadSafe(this: *@This()) void {
            this.old_path.toThreadSafe();
            this.new_path.toThreadSafe();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Symlink {
            const old_path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("oldPath must be a string or TypedArray", .{});
            };

            const new_path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("newPath must be a string or TypedArray", .{});
            };

            const link_type: LinkType = if (!Environment.isWindows)
                0
            else link_type: {
                if (arguments.next()) |next_val| {
                    // The type argument is only available on Windows and
                    // ignored on other platforms. It can be set to 'dir',
                    // 'file', or 'junction'. If the type argument is not set,
                    // Node.js will autodetect target type and use 'file' or
                    // 'dir'. If the target does not exist, 'file' will be used.
                    // Windows junction points require the destination path to
                    // be absolute. When using 'junction', the target argument
                    // will automatically be normalized to absolute path.
                    if (next_val.isString()) {
                        arguments.eat();
                        var str = next_val.toBunString(ctx);
                        defer str.deref();
                        if (str.eqlComptime("dir")) break :link_type .dir;
                        if (str.eqlComptime("file")) break :link_type .file;
                        if (str.eqlComptime("junction")) break :link_type .junction;
                        return ctx.throwInvalidArguments("Symlink type must be one of \"dir\", \"file\", or \"junction\". Received \"{}\"", .{str});
                    }

                    // not a string. fallthrough to auto detect.
                }

                var buf: bun.PathBuffer = undefined;
                const stat = bun.sys.stat(old_path.sliceZ(&buf));

                // if there's an error node defaults to file.
                break :link_type if (stat == .result and bun.C.S.ISDIR(@intCast(stat.result.mode))) .dir else .file;
            };

            return Symlink{
                .old_path = old_path,
                .new_path = new_path,
                .link_type = link_type,
            };
        }
    };

    pub const Readlink = struct {
        path: PathLike,
        encoding: Encoding = Encoding.utf8,

        pub fn deinit(this: Readlink) void {
            this.path.deinit();
        }

        pub fn deinitAndUnprotect(this: *Readlink) void {
            this.path.deinitAndUnprotect();
        }

        pub fn toThreadSafe(this: *Readlink) void {
            this.path.toThreadSafe();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Readlink {
            const path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("path must be a string or TypedArray", .{});
            };
            errdefer path.deinit();

            var encoding = Encoding.utf8;
            if (arguments.next()) |val| {
                arguments.eat();

                switch (val.jsType()) {
                    JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject => {
                        encoding = try Encoding.assert(val, ctx, encoding);
                    },
                    else => {
                        if (val.isObject()) {
                            encoding = try getEncoding(val, ctx, encoding);
                        }
                    },
                }
            }

            return Readlink{ .path = path, .encoding = encoding };
        }
    };

    pub const Realpath = struct {
        path: PathLike,
        encoding: Encoding = Encoding.utf8,

        pub fn deinit(this: Realpath) void {
            this.path.deinit();
        }

        pub fn deinitAndUnprotect(this: *Realpath) void {
            this.path.deinitAndUnprotect();
        }

        pub fn toThreadSafe(this: *Realpath) void {
            this.path.toThreadSafe();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Realpath {
            const path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("path must be a string or TypedArray", .{});
            };
            errdefer path.deinit();

            var encoding = Encoding.utf8;
            if (arguments.next()) |val| {
                arguments.eat();

                switch (val.jsType()) {
                    JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject => {
                        encoding = try Encoding.assert(val, ctx, encoding);
                    },
                    else => {
                        if (val.isObject()) {
                            encoding = try getEncoding(val, ctx, encoding);
                        }
                    },
                }
            }

            return Realpath{ .path = path, .encoding = encoding };
        }
    };

    fn getEncoding(object: JSC.JSValue, globalObject: *JSC.JSGlobalObject, default: Encoding) bun.JSError!Encoding {
        if (object.fastGet(globalObject, .encoding)) |value| {
            return Encoding.assert(value, globalObject, default);
        }

        return default;
    }

    pub const Unlink = struct {
        path: PathLike,

        pub fn deinit(this: Unlink) void {
            this.path.deinit();
        }

        pub fn deinitAndUnprotect(this: *Unlink) void {
            this.path.deinitAndUnprotect();
        }

        pub fn toThreadSafe(this: *Unlink) void {
            this.path.toThreadSafe();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Unlink {
            const path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("path must be a string or TypedArray", .{});
            };
            errdefer path.deinit();

            return Unlink{
                .path = path,
            };
        }
    };

    pub const Rm = RmDir;

    pub const RmDir = struct {
        path: PathLike,

        force: bool = false,

        max_retries: u32 = 0,
        recursive: bool = false,
        retry_delay: c_uint = 100,

        pub fn deinitAndUnprotect(this: *RmDir) void {
            this.path.deinitAndUnprotect();
        }

        pub fn toThreadSafe(this: *RmDir) void {
            this.path.toThreadSafe();
        }

        pub fn deinit(this: RmDir) void {
            this.path.deinit();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!RmDir {
            const path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("path must be a string or TypedArray", .{});
            };
            errdefer path.deinit();

            var recursive = false;
            var force = false;
            if (arguments.next()) |val| {
                arguments.eat();

                if (val.isObject()) {
                    if (try val.getBooleanStrict(ctx, "recursive")) |boolean| {
                        recursive = boolean;
                    }

                    if (try val.getBooleanStrict(ctx, "force")) |boolean| {
                        force = boolean;
                    }
                }
            }

            return RmDir{
                .path = path,
                .recursive = recursive,
                .force = force,
            };
        }
    };

    /// https://github.com/nodejs/node/blob/master/lib/fs.js#L1285
    pub const Mkdir = struct {
        path: PathLike,
        /// Indicates whether parent folders should be created.
        /// If a folder was created, the path to the first created folder will be returned.
        /// @default false
        recursive: bool = false,
        /// A file mode. If a string is passed, it is parsed as an octal integer. If not specified
        mode: Mode = DefaultMode,
        /// If set to true, the return value is never set to a string
        always_return_none: bool = false,

        pub const DefaultMode = 0o777;

        pub fn deinit(this: Mkdir) void {
            this.path.deinit();
        }

        pub fn deinitAndUnprotect(this: *Mkdir) void {
            this.path.deinitAndUnprotect();
        }

        pub fn toThreadSafe(this: *Mkdir) void {
            this.path.toThreadSafe();
        }

        pub fn fromJS(ctx: *JSC.JSGlobalObject, arguments: *ArgumentsSlice) bun.JSError!Mkdir {
            const path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("path must be a string or TypedArray", .{});
            };
            errdefer path.deinit();

            var recursive = false;
            var mode: Mode = 0o777;

            if (arguments.next()) |val| {
                arguments.eat();

                if (val.isObject()) {
                    if (try val.getBooleanStrict(ctx, "recursive")) |boolean| {
                        recursive = boolean;
                    }

                    if (try val.get(ctx, "mode")) |mode_| {
                        mode = try JSC.Node.modeFromJS(ctx, mode_) orelse mode;
                    }
                }
            }

            return Mkdir{
                .path = path,
                .recursive = recursive,
                .mode = mode,
            };
        }
    };

    const MkdirTemp = struct {
        prefix: StringOrBuffer = .{ .buffer = .{ .buffer = JSC.ArrayBuffer.empty } },
        encoding: Encoding = Encoding.utf8,

        pub fn deinit(this: MkdirTemp) void {
            this.prefix.deinit();
        }

        pub fn deinitAndUnprotect(this: *MkdirTemp) void {
            this.prefix.deinit();
        }

        pub fn toThreadSafe(this: *MkdirTemp) void {
            this.prefix.toThreadSafe();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!MkdirTemp {
            const prefix_value = arguments.next() orelse return MkdirTemp{};

            const prefix = StringOrBuffer.fromJS(ctx, bun.default_allocator, prefix_value) orelse {
                return ctx.throwInvalidArguments("prefix must be a string or TypedArray", .{});
            };
            errdefer prefix.deinit();

            arguments.eat();

            var encoding = Encoding.utf8;

            if (arguments.next()) |val| {
                arguments.eat();

                switch (val.jsType()) {
                    JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject => {
                        encoding = try Encoding.assert(val, ctx, encoding);
                    },
                    else => {
                        if (val.isObject()) {
                            encoding = try getEncoding(val, ctx, encoding);
                        }
                    },
                }
            }

            return MkdirTemp{
                .prefix = prefix,
                .encoding = encoding,
            };
        }
    };

    pub const Readdir = struct {
        path: PathLike,
        encoding: Encoding = Encoding.utf8,
        with_file_types: bool = false,
        recursive: bool = false,

        pub fn deinit(this: Readdir) void {
            this.path.deinit();
        }

        pub fn deinitAndUnprotect(this: Readdir) void {
            this.path.deinitAndUnprotect();
        }

        pub fn toThreadSafe(this: *Readdir) void {
            this.path.toThreadSafe();
        }

        pub fn tag(this: *const Readdir) Return.Readdir.Tag {
            return switch (this.encoding) {
                .buffer => .buffers,
                else => if (this.with_file_types)
                    .with_file_types
                else
                    .files,
            };
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Readdir {
            const path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("path must be a string or TypedArray", .{});
            };
            errdefer path.deinit();

            var encoding = Encoding.utf8;
            var with_file_types = false;
            var recursive = false;

            if (arguments.next()) |val| {
                arguments.eat();

                switch (val.jsType()) {
                    .String,
                    .StringObject,
                    .DerivedStringObject,
                    => {
                        encoding = try Encoding.assert(val, ctx, encoding);
                    },
                    else => {
                        if (val.isObject()) {
                            encoding = try getEncoding(val, ctx, encoding);

                            if (try val.getBooleanStrict(ctx, "recursive")) |recursive_| {
                                recursive = recursive_;
                            }

                            if (try val.getBooleanStrict(ctx, "withFileTypes")) |with_file_types_| {
                                with_file_types = with_file_types_;
                            }
                        }
                    },
                }
            }

            return Readdir{
                .path = path,
                .encoding = encoding,
                .with_file_types = with_file_types,
                .recursive = recursive,
            };
        }
    };

    pub const Close = struct {
        fd: FileDescriptor,

        pub fn deinit(_: Close) void {}
        pub fn toThreadSafe(_: Close) void {}

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Close {
            const fd = try JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("file descriptor is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("file descriptor must be a number", .{});
            };

            return Close{ .fd = fd };
        }
    };

    pub const Open = struct {
        path: PathLike,
        flags: FileSystemFlags = FileSystemFlags.r,
        mode: Mode = default_permission,

        pub fn deinit(this: Open) void {
            this.path.deinit();
        }

        pub fn deinitAndUnprotect(this: Open) void {
            this.path.deinitAndUnprotect();
        }

        pub fn toThreadSafe(this: *Open) void {
            this.path.toThreadSafe();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Open {
            const path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("path must be a string or TypedArray", .{});
            };
            errdefer path.deinit();

            var flags = FileSystemFlags.r;
            var mode: Mode = default_permission;

            if (arguments.next()) |val| {
                arguments.eat();

                if (val.isObject()) {
                    if (try val.getTruthy(ctx, "flags")) |flags_| {
                        flags = try FileSystemFlags.fromJS(ctx, flags_) orelse flags;
                    }

                    if (try val.getTruthy(ctx, "mode")) |mode_| {
                        mode = try JSC.Node.modeFromJS(ctx, mode_) orelse mode;
                    }
                } else if (val != .zero) {
                    if (!val.isUndefinedOrNull()) {
                        // error is handled below
                        flags = try FileSystemFlags.fromJS(ctx, val) orelse flags;
                    }

                    if (arguments.nextEat()) |next| {
                        mode = try JSC.Node.modeFromJS(ctx, next) orelse mode;
                    }
                }
            }

            return Open{
                .path = path,
                .flags = flags,
                .mode = mode,
            };
        }
    };

    /// Change the file system timestamps of the object referenced by `path`.
    ///
    /// The `atime` and `mtime` arguments follow these rules:
    ///
    /// * Values can be either numbers representing Unix epoch time in seconds,`Date`s, or a numeric string like `'123456789.0'`.
    /// * If the value can not be converted to a number, or is `NaN`, `Infinity` or`-Infinity`, an `Error` will be thrown.
    /// @since v0.4.2
    pub const Utimes = Lutimes;

    pub const Futimes = struct {
        fd: FileDescriptor,
        atime: TimeLike,
        mtime: TimeLike,

        pub fn deinit(_: Futimes) void {}

        pub fn toThreadSafe(self: *const @This()) void {
            _ = self;
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Futimes {
            const fd = try JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("file descriptor is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("file descriptor must be a number", .{});
            };
            arguments.eat();

            const atime = JSC.Node.timeLikeFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("atime is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("atime must be a number or a Date", .{});
            };
            arguments.eat();

            const mtime = JSC.Node.timeLikeFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("mtime is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("mtime must be a number or a Date", .{});
            };
            arguments.eat();

            return Futimes{
                .fd = fd,
                .atime = atime,
                .mtime = mtime,
            };
        }
    };

    /// Write `buffer` to the file specified by `fd`. If `buffer` is a normal object, it
    /// must have an own `toString` function property.
    ///
    /// `offset` determines the part of the buffer to be written, and `length` is
    /// an integer specifying the number of bytes to write.
    ///
    /// `position` refers to the offset from the beginning of the file where this data
    /// should be written. If `typeof position !== 'number'`, the data will be written
    /// at the current position. See [`pwrite(2)`](http://man7.org/linux/man-pages/man2/pwrite.2.html).
    ///
    /// The callback will be given three arguments `(err, bytesWritten, buffer)` where`bytesWritten` specifies how many _bytes_ were written from `buffer`.
    ///
    /// If this method is invoked as its `util.promisify()` ed version, it returns
    /// a promise for an `Object` with `bytesWritten` and `buffer` properties.
    ///
    /// It is unsafe to use `fs.write()` multiple times on the same file without waiting
    /// for the callback. For this scenario, {@link createWriteStream} is
    /// recommended.
    ///
    /// On Linux, positional writes don't work when the file is opened in append mode.
    /// The kernel ignores the position argument and always appends the data to
    /// the end of the file.
    /// @since v0.0.2
    ///
    pub const Write = struct {
        fd: FileDescriptor,
        buffer: StringOrBuffer,
        // buffer_val: JSC.JSValue = JSC.JSValue.zero,
        offset: u64 = 0,
        length: u64 = std.math.maxInt(u64),
        position: ?ReadPosition = null,
        encoding: Encoding = Encoding.buffer,

        pub fn deinit(this: *const @This()) void {
            this.buffer.deinit();
        }

        pub fn deinitAndUnprotect(this: *@This()) void {
            this.buffer.deinitAndUnprotect();
        }

        pub fn toThreadSafe(self: *@This()) void {
            self.buffer.toThreadSafe();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Write {
            const fd = try JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("file descriptor is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("file descriptor must be a number", .{});
            };
            arguments.eat();

            const buffer_value = arguments.next();
            const buffer = StringOrBuffer.fromJS(ctx, bun.default_allocator, buffer_value orelse {
                return ctx.throwInvalidArguments("data is required", .{});
            }) orelse {
                return ctx.throwInvalidArgumentTypeValue("buffer", "string or TypedArray", buffer_value.?);
            };
            if (buffer_value.?.isString() and !buffer_value.?.isStringLiteral()) {
                return ctx.throwInvalidArgumentTypeValue("buffer", "string or TypedArray", buffer_value.?);
            }

            var args = Write{
                .fd = fd,
                .buffer = buffer,
                .encoding = switch (buffer) {
                    .buffer => Encoding.buffer,
                    inline else => Encoding.utf8,
                },
            };
            errdefer args.deinit();

            arguments.eat();

            // TODO: make this faster by passing argument count at comptime
            if (arguments.next()) |current_| {
                parse: {
                    var current = current_;
                    switch (buffer) {
                        // fs.write(fd, string[, position[, encoding]], callback)
                        else => {
                            if (current.isNumber()) {
                                args.position = current.to(i52);
                                arguments.eat();
                                current = arguments.next() orelse break :parse;
                            }

                            if (current.isString()) {
                                args.encoding = try Encoding.assert(current, ctx, args.encoding);
                                arguments.eat();
                            }
                        },
                        // fs.write(fd, buffer[, offset[, length[, position]]], callback)
                        .buffer => {
                            if (!current.isNumber()) {
                                break :parse;
                            }

                            if (!(current.isNumber() or current.isBigInt())) break :parse;
                            args.offset = current.to(u52);
                            arguments.eat();
                            current = arguments.next() orelse break :parse;

                            if (!(current.isNumber() or current.isBigInt())) break :parse;
                            args.length = current.to(u52);
                            arguments.eat();
                            current = arguments.next() orelse break :parse;

                            if (!(current.isNumber() or current.isBigInt())) break :parse;
                            args.position = current.to(i52);
                            arguments.eat();
                        },
                    }
                }
            }

            return args;
        }
    };

    pub const Read = struct {
        fd: FileDescriptor,
        buffer: Buffer,
        offset: u64 = 0,
        length: u64 = std.math.maxInt(u64),
        position: ?ReadPosition = null,

        pub fn deinit(_: Read) void {}

        pub fn toThreadSafe(this: Read) void {
            this.buffer.buffer.value.protect();
        }

        pub fn deinitAndUnprotect(this: *Read) void {
            this.buffer.buffer.value.unprotect();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Read {
            const fd = try JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("file descriptor is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("file descriptor must be a number", .{});
            };
            arguments.eat();

            const buffer_value = arguments.next();
            const buffer = Buffer.fromJS(ctx, buffer_value orelse {
                return ctx.throwInvalidArguments("buffer is required", .{});
            }) orelse {
                return ctx.throwInvalidArgumentTypeValue("buffer", "TypedArray", buffer_value.?);
            };
            arguments.eat();

            var args = Read{
                .fd = fd,
                .buffer = buffer,
            };

            var defined_length = false;
            if (arguments.next()) |current| {
                arguments.eat();
                if (current.isNumber() or current.isBigInt()) {
                    args.offset = current.to(u52);

                    if (arguments.remaining.len < 1) {
                        return ctx.throwInvalidArguments("length is required", .{});
                    }

                    const arg_length = arguments.next().?;
                    arguments.eat();
                    defined_length = true;

                    if (arg_length.isNumber() or arg_length.isBigInt()) {
                        args.length = arg_length.to(u52);
                    }

                    if (arguments.next()) |arg_position| {
                        arguments.eat();
                        if (arg_position.isNumber() or arg_position.isBigInt()) {
                            args.position = @as(ReadPosition, @intCast(arg_position.to(i52)));
                        }
                    }
                } else if (current.isObject()) {
                    if (try current.getTruthy(ctx, "offset")) |num| {
                        if (num.isNumber() or num.isBigInt()) {
                            args.offset = num.to(u52);
                        }
                    }

                    if (try current.getTruthy(ctx, "length")) |num| {
                        if (num.isNumber() or num.isBigInt()) {
                            args.length = num.to(u52);
                        }
                        defined_length = true;
                    }

                    if (try current.getTruthy(ctx, "position")) |num| {
                        if (num.isNumber() or num.isBigInt()) {
                            args.position = num.to(i52);
                        }
                    }
                }
            }

            if (defined_length and args.length > 0 and buffer.slice().len == 0) {
                var formatter = bun.JSC.ConsoleObject.Formatter{ .globalThis = ctx };
                return ctx.ERR_INVALID_ARG_VALUE("The argument 'buffer' is empty and cannot be written. Received {}", .{buffer_value.?.toFmt(&formatter)}).throw();
            }

            return args;
        }
    };

    /// Asynchronously reads the entire contents of a file.
    /// @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
    /// If a file descriptor is provided, the underlying file will _not_ be closed automatically.
    /// @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
    /// If a flag is not provided, it defaults to `'r'`.
    pub const ReadFile = struct {
        path: PathOrFileDescriptor,
        encoding: Encoding = Encoding.utf8,

        offset: JSC.WebCore.Blob.SizeType = 0,
        max_size: ?JSC.WebCore.Blob.SizeType = null,
        limit_size_for_javascript: bool = false,

        flag: FileSystemFlags = FileSystemFlags.r,

        pub fn deinit(self: ReadFile) void {
            self.path.deinit();
        }

        pub fn deinitAndUnprotect(self: ReadFile) void {
            self.path.deinitAndUnprotect();
        }

        pub fn toThreadSafe(self: *ReadFile) void {
            self.path.toThreadSafe();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!ReadFile {
            const path = try PathOrFileDescriptor.fromJS(ctx, arguments, bun.default_allocator) orelse {
                return ctx.throwInvalidArguments("path must be a string or a file descriptor", .{});
            };
            errdefer path.deinit();

            var encoding = Encoding.buffer;
            var flag = FileSystemFlags.r;

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    encoding = try Encoding.assert(arg, ctx, encoding);
                } else if (arg.isObject()) {
                    encoding = try getEncoding(arg, ctx, encoding);

                    if (try arg.getTruthy(ctx, "flag")) |flag_| {
                        flag = try FileSystemFlags.fromJS(ctx, flag_) orelse {
                            return ctx.throwInvalidArguments("Invalid flag", .{});
                        };
                    }
                }
            }

            // Note: Signal is not implemented
            return ReadFile{
                .path = path,
                .encoding = encoding,
                .flag = flag,
                .limit_size_for_javascript = true,
            };
        }
    };

    pub const WriteFile = struct {
        encoding: Encoding = Encoding.utf8,

        flag: FileSystemFlags = FileSystemFlags.w,
        mode: Mode = 0o666,
        file: PathOrFileDescriptor,

        /// Encoded at the time of construction.
        data: StringOrBuffer,

        dirfd: FileDescriptor,

        pub fn deinit(self: WriteFile) void {
            self.file.deinit();
            self.data.deinit();
        }

        pub fn toThreadSafe(self: *WriteFile) void {
            self.file.toThreadSafe();
            self.data.toThreadSafe();
        }

        pub fn deinitAndUnprotect(self: *WriteFile) void {
            self.file.deinitAndUnprotect();
            self.data.deinitAndUnprotect();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!WriteFile {
            const path = try PathOrFileDescriptor.fromJS(ctx, arguments, bun.default_allocator) orelse {
                return ctx.throwInvalidArguments("path must be a string or a file descriptor", .{});
            };
            errdefer path.deinit();

            const data_value = arguments.nextEat() orelse {
                return ctx.throwInvalidArguments("data is required", .{});
            };

            var encoding = Encoding.buffer;
            var flag = FileSystemFlags.w;
            var mode: Mode = default_permission;

            if (data_value.isString()) {
                encoding = Encoding.utf8;
            }

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    encoding = try Encoding.assert(arg, ctx, encoding);
                } else if (arg.isObject()) {
                    encoding = try getEncoding(arg, ctx, encoding);

                    if (try arg.getTruthy(ctx, "flag")) |flag_| {
                        flag = try FileSystemFlags.fromJS(ctx, flag_) orelse {
                            return ctx.throwInvalidArguments("Invalid flag", .{});
                        };
                    }

                    if (try arg.getTruthy(ctx, "mode")) |mode_| {
                        mode = try JSC.Node.modeFromJS(ctx, mode_) orelse {
                            return ctx.throwInvalidArguments("Invalid mode", .{});
                        };
                    }
                }
            }

            const data = try StringOrBuffer.fromJSWithEncodingMaybeAsync(ctx, bun.default_allocator, data_value, encoding, arguments.will_be_async) orelse {
                return ctx.throwInvalidArguments("data must be a string or TypedArray", .{});
            };

            // Note: Signal is not implemented
            return WriteFile{
                .file = path,
                .encoding = encoding,
                .flag = flag,
                .mode = mode,
                .data = data,
                .dirfd = bun.FD.cwd(),
            };
        }
    };

    pub const AppendFile = WriteFile;

    pub const OpenDir = struct {
        path: PathLike,
        encoding: Encoding = Encoding.utf8,

        /// Number of directory entries that are buffered internally when reading from the directory. Higher values lead to better performance but higher memory usage. Default: 32
        buffer_size: c_int = 32,

        pub fn deinit(self: OpenDir) void {
            self.path.deinit();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!OpenDir {
            const path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("path must be a string or TypedArray", .{});
            };
            errdefer path.deinit();

            var encoding = Encoding.buffer;
            var buffer_size: c_int = 32;

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    encoding = Encoding.assert(arg, ctx, encoding) catch encoding;
                } else if (arg.isObject()) {
                    if (getEncoding(arg, ctx)) |encoding_| {
                        encoding = encoding_;
                    }

                    if (try arg.get(ctx, "bufferSize")) |buffer_size_| {
                        buffer_size = buffer_size_.toInt32();
                        if (buffer_size < 0) {
                            return ctx.throwInvalidArguments("bufferSize must be > 0", .{});
                        }
                    }
                }
            }

            return OpenDir{
                .path = path,
                .encoding = encoding,
                .buffer_size = buffer_size,
            };
        }
    };

    pub const Exists = struct {
        path: ?PathLike,

        pub fn deinit(this: Exists) void {
            if (this.path) |path| {
                path.deinit();
            }
        }

        pub fn toThreadSafe(this: *Exists) void {
            if (this.path) |*path| {
                path.toThreadSafe();
            }
        }

        pub fn deinitAndUnprotect(this: *Exists) void {
            if (this.path) |*path| {
                path.deinitAndUnprotect();
            }
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Exists {
            return Exists{
                .path = try PathLike.fromJS(ctx, arguments),
            };
        }
    };

    pub const Access = struct {
        path: PathLike,
        mode: FileSystemFlags = FileSystemFlags.r,

        pub fn deinit(this: Access) void {
            this.path.deinit();
        }

        pub fn toThreadSafe(this: *Access) void {
            this.path.toThreadSafe();
        }

        pub fn deinitAndUnprotect(this: *Access) void {
            this.path.deinitAndUnprotect();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Access {
            const path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("path must be a string or TypedArray", .{});
            };
            errdefer path.deinit();

            var mode = FileSystemFlags.r;

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    mode = try FileSystemFlags.fromJS(ctx, arg) orelse {
                        return ctx.throwInvalidArguments("Invalid mode", .{});
                    };
                }
            }

            return Access{
                .path = path,
                .mode = mode,
            };
        }
    };

    pub const FdataSync = struct {
        fd: FileDescriptor,

        pub fn deinit(_: FdataSync) void {}
        pub fn toThreadSafe(self: *const @This()) void {
            _ = self;
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!FdataSync {
            const fd = try JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("file descriptor is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("file descriptor must be a number", .{});
            };
            arguments.eat();

            return FdataSync{ .fd = fd };
        }
    };

    pub const CopyFile = struct {
        src: PathLike,
        dest: PathLike,
        mode: Constants.Copyfile,

        pub fn deinit(this: CopyFile) void {
            this.src.deinit();
            this.dest.deinit();
        }

        pub fn toThreadSafe(this: *CopyFile) void {
            this.src.toThreadSafe();
            this.dest.toThreadSafe();
        }

        pub fn deinitAndUnprotect(this: *CopyFile) void {
            this.src.deinitAndUnprotect();
            this.dest.deinitAndUnprotect();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!CopyFile {
            const src = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("src must be a string or TypedArray", .{});
            };
            errdefer src.deinit();

            const dest = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("dest must be a string or TypedArray", .{});
            };
            errdefer dest.deinit();

            var mode: i32 = 0;
            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isNumber()) {
                    mode = arg.coerce(i32, ctx);
                }
            }

            return CopyFile{
                .src = src,
                .dest = dest,
                .mode = @enumFromInt(mode),
            };
        }
    };

    pub const Cp = struct {
        src: PathLike,
        dest: PathLike,
        flags: Flags,

        const Flags = struct {
            mode: Constants.Copyfile,
            recursive: bool,
            errorOnExist: bool,
            force: bool,
            deinit_paths: bool = true,
        };

        fn deinit(this: *Cp) void {
            if (this.flags.deinit_paths) {
                this.src.deinit();
                this.dest.deinit();
            }
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Cp {
            const src = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("src must be a string or TypedArray", .{});
            };
            errdefer src.deinit();

            const dest = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("dest must be a string or TypedArray", .{});
            };
            errdefer dest.deinit();

            var recursive: bool = false;
            var errorOnExist: bool = false;
            var force: bool = true;
            var mode: i32 = 0;

            if (arguments.next()) |arg| {
                arguments.eat();
                recursive = arg.toBoolean();
            }

            if (arguments.next()) |arg| {
                arguments.eat();
                errorOnExist = arg.toBoolean();
            }

            if (arguments.next()) |arg| {
                arguments.eat();
                force = arg.toBoolean();
            }

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isNumber()) {
                    mode = arg.coerce(i32, ctx);
                }
            }

            return Cp{
                .src = src,
                .dest = dest,
                .flags = .{
                    .mode = @enumFromInt(mode),
                    .recursive = recursive,
                    .errorOnExist = errorOnExist,
                    .force = force,
                },
            };
        }
    };

    pub const WriteEv = struct {
        fd: FileDescriptor,
        buffers: []const ArrayBuffer,
        position: ReadPosition,
    };

    pub const ReadEv = struct {
        fd: FileDescriptor,
        buffers: []ArrayBuffer,
        position: ReadPosition,
    };

    pub const UnwatchFile = void;

    pub const Watch = JSC.Node.FSWatcher.Arguments;

    pub const WatchFile = JSC.Node.StatWatcher.Arguments;

    pub const Fsync = struct {
        fd: FileDescriptor,

        pub fn deinit(_: Fsync) void {}
        pub fn toThreadSafe(_: *const @This()) void {}

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Fsync {
            const fd = try JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                return ctx.throwInvalidArguments("file descriptor is required", .{});
            }) orelse {
                return ctx.throwInvalidArguments("file descriptor must be a number", .{});
            };
            arguments.eat();

            return Fsync{ .fd = fd };
        }
    };
};

pub const StatOrNotFound = union(enum) {
    stats: Stats,
    not_found: void,

    pub fn toJS(this: *StatOrNotFound, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        return switch (this.*) {
            .stats => this.stats.toJS(globalObject),
            .not_found => JSC.JSValue.undefined,
        };
    }

    pub fn toJSNewlyCreated(this: *const StatOrNotFound, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        return switch (this.*) {
            .stats => this.stats.toJSNewlyCreated(globalObject),
            .not_found => JSC.JSValue.undefined,
        };
    }
};

pub const StringOrUndefined = union(enum) {
    string: bun.String,
    none: void,

    pub fn toJS(this: *const StringOrUndefined, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        return switch (this.*) {
            .string => this.string.toJS(globalObject),
            .none => JSC.JSValue.undefined,
        };
    }
};

const Return = struct {
    pub const Access = void;
    pub const AppendFile = void;
    pub const Close = void;
    pub const CopyFile = void;
    pub const Cp = void;
    pub const Exists = bool;
    pub const Fchmod = void;
    pub const Chmod = void;
    pub const Fchown = void;
    pub const Fdatasync = void;
    pub const Fstat = Stats;
    pub const Rm = void;
    pub const Fsync = void;
    pub const Ftruncate = void;
    pub const Futimes = void;
    pub const Lchmod = void;
    pub const Lchown = void;
    pub const Link = void;
    pub const Lstat = StatOrNotFound;
    pub const Mkdir = StringOrUndefined;
    pub const Mkdtemp = JSC.ZigString;
    pub const Open = FDImpl;
    pub const WriteFile = void;
    pub const Readv = Read;
    pub const Read = struct {
        bytes_read: u52,

        pub fn toJS(this: Read, _: JSC.C.JSContextRef) JSC.JSValue {
            return JSC.JSValue.jsNumberFromUint64(this.bytes_read);
        }
    };
    pub const ReadPromise = struct {
        bytes_read: u52,
        buffer_val: JSC.JSValue = JSC.JSValue.zero,
        const fields = .{
            .bytesRead = JSC.ZigString.init("bytesRead"),
            .buffer = JSC.ZigString.init("buffer"),
        };
        pub fn toJS(this: *const ReadPromise, ctx: *JSC.JSGlobalObject) JSC.JSValue {
            defer if (!this.buffer_val.isEmptyOrUndefinedOrNull())
                this.buffer_val.unprotect();

            return JSC.JSValue.createObject2(
                ctx,
                &fields.bytesRead,
                &fields.buffer,
                JSC.JSValue.jsNumberFromUint64(@as(u52, @intCast(@min(std.math.maxInt(u52), this.bytes_read)))),
                this.buffer_val,
            );
        }
    };
    pub const WritePromise = struct {
        bytes_written: u52,
        buffer: StringOrBuffer,
        buffer_val: JSC.JSValue = JSC.JSValue.zero,
        const fields = .{
            .bytesWritten = JSC.ZigString.init("bytesWritten"),
            .buffer = JSC.ZigString.init("buffer"),
        };

        // Excited for the issue that's like "cannot read file bigger than 2 GB"
        pub fn toJS(this: *const WritePromise, globalObject: JSC.C.JSContextRef) JSC.C.JSValueRef {
            defer if (!this.buffer_val.isEmptyOrUndefinedOrNull())
                this.buffer_val.unprotect();

            return JSC.JSValue.createObject2(
                globalObject,
                &fields.bytesWritten,
                &fields.buffer,
                JSC.JSValue.jsNumberFromUint64(@as(u52, @intCast(@min(std.math.maxInt(u52), this.bytes_written)))),
                if (this.buffer == .buffer)
                    this.buffer_val
                else
                    this.buffer.toJS(globalObject),
            );
        }
    };
    pub const Write = struct {
        bytes_written: u52,
        const fields = .{
            .bytesWritten = JSC.ZigString.init("bytesWritten"),
        };

        // Excited for the issue that's like "cannot read file bigger than 2 GB"
        pub fn toJS(this: *const Write, _: *JSC.JSGlobalObject) JSC.JSValue {
            return JSC.JSValue.jsNumberFromUint64(this.bytes_written);
        }
    };
    pub const Readdir = union(Tag) {
        with_file_types: []Dirent,
        buffers: []Buffer,
        files: []const bun.String,

        pub const Tag = enum {
            with_file_types,
            buffers,
            files,
        };

        pub fn toJS(this: Readdir, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
            switch (this) {
                .with_file_types => {
                    defer bun.default_allocator.free(this.with_file_types);
                    return JSC.toJS(globalObject, []Dirent, this.with_file_types, .temporary);
                },
                .buffers => {
                    defer bun.default_allocator.free(this.buffers);
                    return JSC.toJS(globalObject, []Buffer, this.buffers, .temporary);
                },
                .files => {
                    // automatically freed
                    return JSC.toJS(globalObject, []const bun.String, this.files, .temporary);
                },
            }
        }
    };
    pub const ReadFile = StringOrBuffer;
    pub const ReadFileWithOptions = union(enum) {
        string: string,
        transcoded_string: bun.String,
        buffer: JSC.Node.Buffer,
        null_terminated: [:0]const u8,
    };
    pub const Readlink = StringOrBuffer;
    pub const Realpath = StringOrBuffer;
    pub const RealpathNative = Realpath;
    pub const Rename = void;
    pub const Rmdir = void;
    pub const Stat = StatOrNotFound;
    pub const Symlink = void;
    pub const Truncate = void;
    pub const Unlink = void;
    pub const UnwatchFile = void;
    pub const Watch = JSC.JSValue;
    pub const WatchFile = JSC.JSValue;
    pub const Utimes = void;
    pub const Chown = void;
    pub const Lutimes = void;
    pub const Writev = Write;
};

/// Bun's implementation of the Node.js "fs" module
/// https://nodejs.org/api/fs.html
/// https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/node/fs.d.ts
pub const NodeFS = struct {
    /// Buffer to store a temporary file path that might appear in a returned error message.
    ///
    /// We want to avoid allocating a new path buffer for every error message so that JSC can clone + GC it.
    /// That means a stack-allocated buffer won't suffice. Instead, we re-use
    /// the heap allocated buffer on the NodefS struct
    sync_error_buf: bun.PathBuffer = undefined,
    vm: ?*JSC.VirtualMachine = null,

    pub const ReturnType = Return;

    pub fn access(this: *NodeFS, args: Arguments.Access, comptime _: Flavor) Maybe(Return.Access) {
        const path = args.path.sliceZ(&this.sync_error_buf);
        return Syscall.access(path, @intFromEnum(args.mode));
    }

    pub fn appendFile(this: *NodeFS, args: Arguments.AppendFile, comptime flavor: Flavor) Maybe(Return.AppendFile) {
        _ = flavor;
        var data = args.data.slice();

        switch (args.file) {
            .fd => |fd| {
                while (data.len > 0) {
                    const written = switch (Syscall.write(fd, data)) {
                        .result => |result| result,
                        .err => |err| return .{ .err = err },
                    };
                    data = data[written..];
                }

                return Maybe(Return.AppendFile).success;
            },
            .path => |path_| {
                const path = path_.sliceZ(&this.sync_error_buf);

                const fd = switch (Syscall.open(path, @intFromEnum(FileSystemFlags.a), 0o666)) {
                    .result => |result| result,
                    .err => |err| return .{ .err = err },
                };

                defer {
                    _ = Syscall.close(fd);
                }

                while (data.len > 0) {
                    const written = switch (Syscall.write(fd, data)) {
                        .result => |result| result,
                        .err => |err| return .{ .err = err },
                    };
                    data = data[written..];
                }

                return Maybe(Return.AppendFile).success;
            },
        }
    }

    pub fn close(_: *NodeFS, args: Arguments.Close, comptime flavor: Flavor) Maybe(Return.Close) {
        _ = flavor;
        return if (Syscall.close(args.fd)) |err| .{ .err = err } else Maybe(Return.Close).success;
    }

    pub fn uv_close(_: *NodeFS, args: Arguments.Close, rc: i64) Maybe(Return.Close) {
        if (rc < 0) {
            return Maybe(Return.Close){ .err = .{
                .errno = @intCast(-rc),
                .syscall = .close,
                .fd = args.fd,
                .from_libuv = true,
            } };
        }
        return Maybe(Return.Close).success;
    }

    // since we use a 64 KB stack buffer, we should not let this function get inlined
    pub noinline fn copyFileUsingReadWriteLoop(src: [:0]const u8, dest: [:0]const u8, src_fd: FileDescriptor, dest_fd: FileDescriptor, stat_size: usize, wrote: *u64) Maybe(Return.CopyFile) {
        var stack_buf: [64 * 1024]u8 = undefined;
        var buf_to_free: []u8 = &[_]u8{};
        var buf: []u8 = &stack_buf;

        maybe_allocate_large_temp_buf: {
            if (stat_size > stack_buf.len * 16) {
                // Don't allocate more than 8 MB at a time
                const clamped_size: usize = @min(stat_size, 8 * 1024 * 1024);

                const buf_ = bun.default_allocator.alloc(u8, clamped_size) catch break :maybe_allocate_large_temp_buf;
                buf = buf_;
                buf_to_free = buf_;
            }
        }

        defer {
            if (buf_to_free.len > 0) bun.default_allocator.free(buf_to_free);
        }

        var remain = @as(u64, @intCast(@max(stat_size, 0)));
        toplevel: while (remain > 0) {
            const amt = switch (Syscall.read(src_fd, buf[0..@min(buf.len, remain)])) {
                .result => |result| result,
                .err => |err| return Maybe(Return.CopyFile){ .err = if (src.len > 0) err.withPath(src) else err },
            };
            // 0 == EOF
            if (amt == 0) {
                break :toplevel;
            }
            wrote.* += amt;
            remain -|= amt;

            var slice = buf[0..amt];
            while (slice.len > 0) {
                const written = switch (Syscall.write(dest_fd, slice)) {
                    .result => |result| result,
                    .err => |err| return Maybe(Return.CopyFile){ .err = if (dest.len > 0) err.withPath(dest) else err },
                };
                if (written == 0) break :toplevel;
                slice = slice[written..];
            }
        } else {
            outer: while (true) {
                const amt = switch (Syscall.read(src_fd, buf)) {
                    .result => |result| result,
                    .err => |err| return Maybe(Return.CopyFile){ .err = if (src.len > 0) err.withPath(src) else err },
                };
                // we don't know the size
                // so we just go forever until we get an EOF
                if (amt == 0) {
                    break;
                }
                wrote.* += amt;

                var slice = buf[0..amt];
                while (slice.len > 0) {
                    const written = switch (Syscall.write(dest_fd, slice)) {
                        .result => |result| result,
                        .err => |err| return Maybe(Return.CopyFile){ .err = if (dest.len > 0) err.withPath(dest) else err },
                    };
                    slice = slice[written..];
                    if (written == 0) break :outer;
                }
            }
        }

        return Maybe(Return.CopyFile).success;
    }

    // copy_file_range() is frequently not supported across devices, such as tmpfs.
    // This is relevant for `bun install`
    // However, sendfile() is supported across devices.
    // Only on Linux. There are constraints though. It cannot be used if the file type does not support
    pub noinline fn copyFileUsingSendfileOnLinuxWithReadWriteFallback(src: [:0]const u8, dest: [:0]const u8, src_fd: FileDescriptor, dest_fd: FileDescriptor, stat_size: usize, wrote: *u64) Maybe(Return.CopyFile) {
        while (true) {
            const amt = switch (bun.sys.sendfile(src_fd, dest_fd, std.math.maxInt(i32) - 1)) {
                .err => {
                    return copyFileUsingReadWriteLoop(src, dest, src_fd, dest_fd, stat_size, wrote);
                },
                .result => |amount| amount,
            };

            wrote.* += amt;
            if (amt == 0) {
                break;
            }
        }

        return Maybe(Return.CopyFile).success;
    }

    /// https://github.com/libuv/libuv/pull/2233
    /// https://github.com/pnpm/pnpm/issues/2761
    /// https://github.com/libuv/libuv/pull/2578
    /// https://github.com/nodejs/node/issues/34624
    pub fn copyFile(this: *NodeFS, args: Arguments.CopyFile, comptime flavor: Flavor) Maybe(Return.CopyFile) {
        _ = flavor;
        const ret = Maybe(Return.CopyFile);

        // TODO: do we need to fchown?
        if (comptime Environment.isMac) {
            var src_buf: bun.PathBuffer = undefined;
            var dest_buf: bun.PathBuffer = undefined;

            const src = args.src.sliceZ(&src_buf);
            const dest = args.dest.sliceZ(&dest_buf);

            if (args.mode.isForceClone()) {
                // https://www.manpagez.com/man/2/clonefile/
                return ret.errnoSysP(C.clonefile(src, dest, 0), .clonefile, src) orelse ret.success;
            } else {
                const stat_ = switch (Syscall.stat(src)) {
                    .result => |result| result,
                    .err => |err| return Maybe(Return.CopyFile){ .err = err.withPath(src) },
                };

                if (!posix.S.ISREG(stat_.mode)) {
                    return Maybe(Return.CopyFile){ .err = .{
                        .errno = @intFromEnum(C.SystemErrno.ENOTSUP),
                        .syscall = .copyfile,
                    } };
                }

                // 64 KB is about the break-even point for clonefile() to be worth it
                // at least, on an M1 with an NVME SSD.
                if (stat_.size > 128 * 1024) {
                    if (!args.mode.shouldntOverwrite()) {
                        // clonefile() will fail if it already exists
                        _ = Syscall.unlink(dest);
                    }

                    if (ret.errnoSysP(C.clonefile(src, dest, 0), .clonefile, src) == null) {
                        _ = C.chmod(dest, stat_.mode);
                        return ret.success;
                    }
                } else {
                    const src_fd = switch (Syscall.open(src, bun.O.RDONLY, 0o644)) {
                        .result => |result| result,
                        .err => |err| return .{ .err = err.withPath(args.src.slice()) },
                    };
                    defer {
                        _ = Syscall.close(src_fd);
                    }

                    var flags: Mode = bun.O.CREAT | bun.O.WRONLY;
                    var wrote: usize = 0;
                    if (args.mode.shouldntOverwrite()) {
                        flags |= bun.O.EXCL;
                    }

                    const dest_fd = switch (Syscall.open(dest, flags, JSC.Node.default_permission)) {
                        .result => |result| result,
                        .err => |err| return Maybe(Return.CopyFile){ .err = err.withPath(args.dest.slice()) },
                    };
                    defer {
                        _ = std.c.ftruncate(dest_fd.int(), @as(std.c.off_t, @intCast(@as(u63, @truncate(wrote)))));
                        _ = C.fchmod(dest_fd.int(), stat_.mode);
                        _ = Syscall.close(dest_fd);
                    }

                    return copyFileUsingReadWriteLoop(src, dest, src_fd, dest_fd, @intCast(@max(stat_.size, 0)), &wrote);
                }
            }

            // we fallback to copyfile() when the file is > 128 KB and clonefile fails
            // clonefile() isn't supported on all devices
            // nor is it supported across devices
            var mode: Mode = C.darwin.COPYFILE_ACL | C.darwin.COPYFILE_DATA;
            if (args.mode.shouldntOverwrite()) {
                mode |= C.darwin.COPYFILE_EXCL;
            }

            return ret.errnoSysP(C.copyfile(src, dest, null, mode), .copyfile, src) orelse ret.success;
        }

        if (comptime Environment.isLinux) {
            var src_buf: bun.PathBuffer = undefined;
            var dest_buf: bun.PathBuffer = undefined;
            const src = args.src.sliceZ(&src_buf);
            const dest = args.dest.sliceZ(&dest_buf);

            const src_fd = switch (Syscall.open(src, bun.O.RDONLY, 0o644)) {
                .result => |result| result,
                .err => |err| return .{ .err = err },
            };
            defer {
                _ = Syscall.close(src_fd);
            }

            const stat_: linux.Stat = switch (Syscall.fstat(src_fd)) {
                .result => |result| result,
                .err => |err| return Maybe(Return.CopyFile){ .err = err },
            };

            if (!posix.S.ISREG(stat_.mode)) {
                return Maybe(Return.CopyFile){ .err = .{ .errno = @intFromEnum(C.SystemErrno.ENOTSUP), .syscall = .copyfile } };
            }

            var flags: Mode = bun.O.CREAT | bun.O.WRONLY;
            var wrote: usize = 0;
            if (args.mode.shouldntOverwrite()) {
                flags |= bun.O.EXCL;
            }

            const dest_fd = switch (Syscall.open(dest, flags, JSC.Node.default_permission)) {
                .result => |result| result,
                .err => |err| return Maybe(Return.CopyFile){ .err = err },
            };

            var size: usize = @intCast(@max(stat_.size, 0));

            // https://manpages.debian.org/testing/manpages-dev/ioctl_ficlone.2.en.html
            if (args.mode.isForceClone()) {
                if (ret.errnoSysP(bun.C.linux.ioctl_ficlone(dest_fd, src_fd), .ioctl_ficlone, dest)) |err| {
                    _ = Syscall.close(dest_fd);
                    // This is racey, but it's the best we can do
                    _ = bun.sys.unlink(dest);
                    return err;
                }
                _ = C.fchmod(dest_fd.cast(), stat_.mode);
                _ = Syscall.close(dest_fd);
                return ret.success;
            }

            // If we know it's a regular file and ioctl_ficlone is available, attempt to use it.
            if (posix.S.ISREG(stat_.mode) and bun.can_use_ioctl_ficlone()) {
                const rc = bun.C.linux.ioctl_ficlone(dest_fd, src_fd);
                if (rc == 0) {
                    _ = C.fchmod(dest_fd.cast(), stat_.mode);
                    _ = Syscall.close(dest_fd);
                    return ret.success;
                }

                // If this fails for any reason, we say it's disabled
                // We don't want to add the system call overhead of running this function on a lot of files that don't support it
                bun.disable_ioctl_ficlone();
            }

            defer {
                _ = linux.ftruncate(dest_fd.cast(), @as(i64, @intCast(@as(u63, @truncate(wrote)))));
                _ = linux.fchmod(dest_fd.cast(), stat_.mode);
                _ = Syscall.close(dest_fd);
            }

            var off_in_copy = @as(i64, @bitCast(@as(u64, 0)));
            var off_out_copy = @as(i64, @bitCast(@as(u64, 0)));

            if (!bun.canUseCopyFileRangeSyscall()) {
                return copyFileUsingSendfileOnLinuxWithReadWriteFallback(src, dest, src_fd, dest_fd, size, &wrote);
            }

            if (size == 0) {
                // copy until EOF
                while (true) {
                    // Linux Kernel 5.3 or later
                    // Not supported in gVisor
                    const written = linux.copy_file_range(src_fd.cast(), &off_in_copy, dest_fd.cast(), &off_out_copy, std.mem.page_size, 0);
                    if (ret.errnoSysP(written, .copy_file_range, dest)) |err| {
                        return switch (err.getErrno()) {
                            .INTR => continue,
                            inline .XDEV, .NOSYS => |errno| brk: {
                                if (comptime errno == .NOSYS) {
                                    bun.disableCopyFileRangeSyscall();
                                }
                                break :brk copyFileUsingSendfileOnLinuxWithReadWriteFallback(src, dest, src_fd, dest_fd, size, &wrote);
                            },
                            else => return err,
                        };
                    }
                    // wrote zero bytes means EOF
                    if (written == 0) break;
                    wrote +|= written;
                }
            } else {
                while (size > 0) {
                    // Linux Kernel 5.3 or later
                    // Not supported in gVisor
                    const written = linux.copy_file_range(src_fd.cast(), &off_in_copy, dest_fd.cast(), &off_out_copy, size, 0);
                    if (ret.errnoSysP(written, .copy_file_range, dest)) |err| {
                        return switch (err.getErrno()) {
                            .INTR => continue,
                            inline .XDEV, .NOSYS => |errno| brk: {
                                if (comptime errno == .NOSYS) {
                                    bun.disableCopyFileRangeSyscall();
                                }
                                break :brk copyFileUsingSendfileOnLinuxWithReadWriteFallback(src, dest, src_fd, dest_fd, size, &wrote);
                            },
                            else => return err,
                        };
                    }
                    // wrote zero bytes means EOF
                    if (written == 0) break;
                    wrote +|= written;
                    size -|= written;
                }
            }

            return ret.success;
        }

        if (comptime Environment.isWindows) {
            if (args.mode.isForceClone()) {
                return Maybe(Return.CopyFile).todo();
            }

            const src_buf = bun.OSPathBufferPool.get();
            defer bun.OSPathBufferPool.put(src_buf);
            const dest_buf = bun.OSPathBufferPool.get();
            defer bun.OSPathBufferPool.put(dest_buf);
            const src = strings.toWPathNormalizeAutoExtend(src_buf, args.src.sliceZ(&this.sync_error_buf));
            const dest = strings.toWPathNormalizeAutoExtend(dest_buf, args.dest.sliceZ(&this.sync_error_buf));
            if (windows.CopyFileW(src.ptr, dest.ptr, if (args.mode.shouldntOverwrite()) 1 else 0) == windows.FALSE) {
                if (ret.errnoSysP(0, .copyfile, args.src.slice())) |rest| {
                    return shouldIgnoreEbusy(args.src, args.dest, rest);
                }
            }

            return ret.success;
        }

        return Maybe(Return.CopyFile).todo();
    }

    pub fn exists(this: *NodeFS, args: Arguments.Exists, comptime flavor: Flavor) Maybe(Return.Exists) {
        _ = flavor;
        const Ret = Maybe(Return.Exists);
        const path = args.path orelse return Ret{ .result = false };
        const slice = path.sliceZ(&this.sync_error_buf);

        // Use libuv access on windows
        if (Environment.isWindows) {
            return .{ .result = Syscall.access(slice, std.posix.F_OK) != .err };
        }

        // access() may not work correctly on NFS file systems with UID
        // mapping enabled, because UID mapping is done on the server and
        // hidden from the client, which checks permissions. Similar
        // problems can occur to FUSE mounts.
        const rc = (system.access(slice, std.posix.F_OK));
        return Ret{ .result = rc == 0 };
    }

    pub fn chown(this: *NodeFS, args: Arguments.Chown, comptime flavor: Flavor) Maybe(Return.Chown) {
        _ = flavor;
        if (comptime Environment.isWindows) {
            return Syscall.chown(args.path.sliceZ(&this.sync_error_buf), args.uid, args.gid);
        }

        const path = args.path.sliceZ(&this.sync_error_buf);

        return Syscall.chown(path, args.uid, args.gid);
    }

    /// This should almost never be async
    pub fn chmod(this: *NodeFS, args: Arguments.Chmod, comptime flavor: Flavor) Maybe(Return.Chmod) {
        _ = flavor;
        if (comptime Environment.isWindows) {
            return Syscall.chmod(args.path.sliceZ(&this.sync_error_buf), args.mode);
        }

        const path = args.path.sliceZ(&this.sync_error_buf);

        return Maybe(Return.Chmod).errnoSysP(C.chmod(path, args.mode), .chmod, path) orelse
            Maybe(Return.Chmod).success;
    }

    /// This should almost never be async
    pub fn fchmod(_: *NodeFS, args: Arguments.FChmod, comptime flavor: Flavor) Maybe(Return.Fchmod) {
        _ = flavor;
        return Syscall.fchmod(args.fd, args.mode);
    }

    pub fn fchown(_: *NodeFS, args: Arguments.Fchown, comptime flavor: Flavor) Maybe(Return.Fchown) {
        _ = flavor;
        if (comptime Environment.isWindows) {
            return Syscall.fchown(args.fd, args.uid, args.gid);
        }

        return Maybe(Return.Fchown).errnoSys(C.fchown(args.fd.int(), args.uid, args.gid), .fchown) orelse
            Maybe(Return.Fchown).success;
    }

    pub fn fdatasync(_: *NodeFS, args: Arguments.FdataSync, comptime _: Flavor) Maybe(Return.Fdatasync) {
        if (Environment.isWindows) {
            return Syscall.fdatasync(args.fd);
        }
        return Maybe(Return.Fdatasync).errnoSysFd(system.fdatasync(args.fd.int()), .fdatasync, args.fd) orelse Maybe(Return.Fdatasync).success;
    }

    pub fn fstat(_: *NodeFS, args: Arguments.Fstat, comptime _: Flavor) Maybe(Return.Fstat) {
        return switch (Syscall.fstat(args.fd)) {
            .result => |result| Maybe(Return.Fstat){ .result = Stats.init(result, false) },
            .err => |err| Maybe(Return.Fstat){ .err = err },
        };
    }

    pub fn fsync(_: *NodeFS, args: Arguments.Fsync, comptime _: Flavor) Maybe(Return.Fsync) {
        if (Environment.isWindows) {
            return Syscall.fsync(args.fd);
        }
        return Maybe(Return.Fsync).errnoSys(system.fsync(args.fd.int()), .fsync) orelse
            Maybe(Return.Fsync).success;
    }

    pub fn ftruncateSync(args: Arguments.FTruncate) Maybe(Return.Ftruncate) {
        return Syscall.ftruncate(args.fd, args.len orelse 0);
    }

    pub fn ftruncate(_: *NodeFS, args: Arguments.FTruncate, comptime flavor: Flavor) Maybe(Return.Ftruncate) {
        _ = flavor;
        return ftruncateSync(args);
    }

    pub fn futimes(_: *NodeFS, args: Arguments.Futimes, comptime _: Flavor) Maybe(Return.Futimes) {
        if (comptime Environment.isWindows) {
            var req: uv.fs_t = uv.fs_t.uninitialized;
            defer req.deinit();
            const rc = uv.uv_fs_futime(uv.Loop.get(), &req, bun.uvfdcast(args.fd), args.mtime, args.atime, null);
            return if (rc.errno()) |e|
                Maybe(Return.Futimes){ .err = .{ .errno = e, .syscall = .futime } }
            else
                Maybe(Return.Futimes).success;
        }

        var times = [2]std.posix.timespec{
            args.mtime,
            args.atime,
        };

        return if (Maybe(Return.Futimes).errnoSys(system.futimens(args.fd.int(), &times), .futimens)) |err|
            err
        else
            Maybe(Return.Futimes).success;
    }

    pub fn lchmod(this: *NodeFS, args: Arguments.LCHmod, comptime flavor: Flavor) Maybe(Return.Lchmod) {
        _ = flavor;
        if (comptime Environment.isWindows) {
            return Maybe(Return.Lchmod).todo();
        }

        const path = args.path.sliceZ(&this.sync_error_buf);

        return Maybe(Return.Lchmod).errnoSysP(C.lchmod(path, args.mode), .lchmod, path) orelse
            Maybe(Return.Lchmod).success;
    }

    pub fn lchown(this: *NodeFS, args: Arguments.LChown, comptime flavor: Flavor) Maybe(Return.Lchown) {
        _ = flavor;
        if (comptime Environment.isWindows) {
            return Maybe(Return.Lchown).todo();
        }

        const path = args.path.sliceZ(&this.sync_error_buf);

        return Maybe(Return.Lchown).errnoSysP(C.lchown(path, args.uid, args.gid), .lchown, path) orelse
            Maybe(Return.Lchown).success;
    }

    pub fn link(this: *NodeFS, args: Arguments.Link, comptime _: Flavor) Maybe(Return.Link) {
        var new_path_buf: bun.PathBuffer = undefined;
        const from = args.old_path.sliceZ(&this.sync_error_buf);
        const to = args.new_path.sliceZ(&new_path_buf);

        if (Environment.isWindows) {
            return Syscall.link(from, to);
        }

        return Maybe(Return.Link).errnoSysP(system.link(from, to, 0), .link, from) orelse
            Maybe(Return.Link).success;
    }

    pub fn lstat(this: *NodeFS, args: Arguments.Lstat, comptime _: Flavor) Maybe(Return.Lstat) {
        return switch (Syscall.lstat(
            args.path.sliceZ(
                &this.sync_error_buf,
            ),
        )) {
            .result => |result| Maybe(Return.Lstat){ .result = .{ .stats = Stats.init(result, args.big_int) } },
            .err => |err| brk: {
                if (!args.throw_if_no_entry and err.getErrno() == .NOENT) {
                    return Maybe(Return.Lstat){ .result = .{ .not_found = {} } };
                }
                break :brk Maybe(Return.Lstat){ .err = err };
            },
        };
    }

    pub fn mkdir(this: *NodeFS, args: Arguments.Mkdir, comptime flavor: Flavor) Maybe(Return.Mkdir) {
        return if (args.recursive) mkdirRecursive(this, args, flavor) else mkdirNonRecursive(this, args, flavor);
    }

    // Node doesn't absolute the path so we don't have to either
    pub fn mkdirNonRecursive(this: *NodeFS, args: Arguments.Mkdir, comptime flavor: Flavor) Maybe(Return.Mkdir) {
        _ = flavor;

        const path = args.path.sliceZ(&this.sync_error_buf);
        return switch (Syscall.mkdir(path, args.mode)) {
            .result => Maybe(Return.Mkdir){ .result = .{ .none = {} } },
            .err => |err| Maybe(Return.Mkdir){ .err = err.withPath(path) },
        };
    }

    pub const MkdirDummyVTable = struct {
        pub fn onCreateDir(_: @This(), _: bun.OSPathSliceZ) void {
            return;
        }
    };

    pub fn mkdirRecursive(this: *NodeFS, args: Arguments.Mkdir, comptime flavor: Flavor) Maybe(Return.Mkdir) {
        return mkdirRecursiveImpl(this, args, flavor, MkdirDummyVTable, .{});
    }

    // TODO: verify this works correctly with unicode codepoints
    pub fn mkdirRecursiveImpl(this: *NodeFS, args: Arguments.Mkdir, comptime flavor: Flavor, comptime Ctx: type, ctx: Ctx) Maybe(Return.Mkdir) {
        _ = flavor;
        const buf = bun.OSPathBufferPool.get();
        defer bun.OSPathBufferPool.put(buf);
        const path: bun.OSPathSliceZ = if (Environment.isWindows)
            strings.toNTPath(buf, args.path.slice())
        else
            args.path.osPath(buf);

        // TODO: remove and make it always a comptime argument
        return switch (args.always_return_none) {
            inline else => |always_return_none| this.mkdirRecursiveOSPathImpl(Ctx, ctx, path, args.mode, !always_return_none),
        };
    }

    pub fn _isSep(char: bun.OSPathChar) bool {
        return if (Environment.isWindows)
            char == '/' or char == '\\'
        else
            char == '/';
    }

    pub fn mkdirRecursiveOSPath(this: *NodeFS, path: bun.OSPathSliceZ, mode: Mode, comptime return_path: bool) Maybe(Return.Mkdir) {
        return mkdirRecursiveOSPathImpl(this, MkdirDummyVTable, .{}, path, mode, return_path);
    }

    pub fn mkdirRecursiveOSPathImpl(
        this: *NodeFS,
        comptime Ctx: type,
        ctx: Ctx,
        path: bun.OSPathSliceZ,
        mode: Mode,
        comptime return_path: bool,
    ) Maybe(Return.Mkdir) {
        const VTable = struct {
            pub fn onCreateDir(c: Ctx, dirpath: bun.OSPathSliceZ) void {
                if (Ctx != void) {
                    c.onCreateDir(dirpath);
                }
                return;
            }
        };

        const Char = bun.OSPathChar;
        const len = @as(u16, @truncate(path.len));

        // First, attempt to create the desired directory
        // If that fails, then walk back up the path until we have a match
        switch (Syscall.mkdirOSPath(path, mode)) {
            .err => |err| {
                switch (err.getErrno()) {
                    else => {
                        return .{ .err = err.withPath(this.osPathIntoSyncErrorBuf(path[0..len])) };
                    },
                    .EXIST => {
                        return .{ .result = .{ .none = {} } };
                    },
                    // continue
                    .NOENT => {
                        if (len == 0) {
                            // no path to copy
                            return .{ .err = err };
                        }
                    },
                }
            },
            .result => {
                VTable.onCreateDir(ctx, path);
                if (!return_path) {
                    return .{ .result = .{ .none = {} } };
                }
                return .{
                    .result = .{ .string = bun.String.createFromOSPath(path) },
                };
            },
        }

        var working_mem: *bun.OSPathBuffer = @alignCast(@ptrCast(&this.sync_error_buf));

        @memcpy(working_mem[0..len], path[0..len]);

        var i: u16 = len - 1;

        // iterate backwards until creating the directory works successfully
        while (i > 0) : (i -= 1) {
            if (_isSep(path[i])) {
                working_mem[i] = 0;
                const parent: [:0]Char = working_mem[0..i :0];

                switch (Syscall.mkdirOSPath(parent, mode)) {
                    .err => |err| {
                        working_mem[i] = std.fs.path.sep;
                        switch (err.getErrno()) {
                            .EXIST => {
                                // Handle race condition
                                break;
                            },
                            .NOENT => {
                                continue;
                            },
                            else => return .{ .err = err.withPath(
                                if (Environment.isWindows)
                                    this.osPathIntoSyncErrorBufOverlap(parent)
                                else
                                    parent,
                            ) },
                        }
                    },
                    .result => {
                        VTable.onCreateDir(ctx, parent);
                        // We found a parent that worked
                        working_mem[i] = std.fs.path.sep;
                        break;
                    },
                }
            }
        }
        const first_match: u16 = i;
        i += 1;
        // after we find one that works, we go forward _after_ the first working directory
        while (i < len) : (i += 1) {
            if (_isSep(path[i])) {
                working_mem[i] = 0;
                const parent: [:0]Char = working_mem[0..i :0];

                switch (Syscall.mkdirOSPath(parent, mode)) {
                    .err => |err| {
                        working_mem[i] = std.fs.path.sep;
                        switch (err.getErrno()) {
                            // handle the race condition
                            .EXIST => {},

                            // NOENT shouldn't happen here
                            else => return .{
                                .err = err.withPath(this.osPathIntoSyncErrorBuf(path)),
                            },
                        }
                    },

                    .result => {
                        VTable.onCreateDir(ctx, parent);
                        working_mem[i] = std.fs.path.sep;
                    },
                }
            }
        }

        working_mem[len] = 0;

        // Our final directory will not have a trailing separator
        // so we have to create it once again
        switch (Syscall.mkdirOSPath(working_mem[0..len :0], mode)) {
            .err => |err| {
                switch (err.getErrno()) {
                    // handle the race condition
                    .EXIST => {},

                    // NOENT shouldn't happen here
                    else => return .{
                        .err = err.withPath(this.osPathIntoSyncErrorBuf(path)),
                    },
                }
            },
            .result => {},
        }

        VTable.onCreateDir(ctx, working_mem[0..len :0]);
        if (!return_path) {
            return .{ .result = .{ .none = {} } };
        }
        return .{
            .result = .{ .string = bun.String.createFromOSPath(working_mem[0..first_match]) },
        };
    }

    pub fn mkdtemp(this: *NodeFS, args: Arguments.MkdirTemp, comptime _: Flavor) Maybe(Return.Mkdtemp) {
        var prefix_buf = &this.sync_error_buf;
        const prefix_slice = args.prefix.slice();
        const len = @min(prefix_slice.len, prefix_buf.len -| 7);
        if (len > 0) {
            @memcpy(prefix_buf[0..len], prefix_slice[0..len]);
        }
        prefix_buf[len..][0..6].* = "XXXXXX".*;
        prefix_buf[len..][6] = 0;

        // The mkdtemp() function returns  a  pointer  to  the  modified  template
        // string  on  success, and NULL on failure, in which case errno is set to
        // indicate the error

        if (Environment.isWindows) {
            var req: uv.fs_t = uv.fs_t.uninitialized;
            defer req.deinit();
            const rc = uv.uv_fs_mkdtemp(bun.Async.Loop.get(), &req, @ptrCast(prefix_buf.ptr), null);
            if (rc.errno()) |errno| {
                return .{ .err = .{ .errno = errno, .syscall = .mkdtemp, .path = prefix_buf[0 .. len + 6] } };
            }
            return .{
                .result = JSC.ZigString.dupeForJS(bun.sliceTo(req.path, 0), bun.default_allocator) catch bun.outOfMemory(),
            };
        }

        const rc = C.mkdtemp(prefix_buf);
        if (rc) |ptr| {
            return .{
                .result = JSC.ZigString.dupeForJS(bun.sliceTo(ptr, 0), bun.default_allocator) catch bun.outOfMemory(),
            };
        }

        // bun.C.getErrno(rc) returns SUCCESS if rc is -1 so we call std.c._errno() directly
        const errno = @as(std.c.E, @enumFromInt(std.c._errno().*));
        return .{
            .err = Syscall.Error{
                .errno = @as(Syscall.Error.Int, @truncate(@intFromEnum(errno))),
                .syscall = .mkdtemp,
            },
        };
    }

    pub fn open(this: *NodeFS, args: Arguments.Open, comptime _: Flavor) Maybe(Return.Open) {
        const path = if (Environment.isWindows and bun.strings.eqlComptime(args.path.slice(), "/dev/null"))
            "\\\\.\\NUL"
        else
            args.path.sliceZ(&this.sync_error_buf);

        return switch (Syscall.open(path, @intFromEnum(args.flags), args.mode)) {
            .err => |err| .{
                .err = err.withPath(args.path.slice()),
            },
            .result => |fd| fd: {
                break :fd .{ .result = FDImpl.decode(fd) };
            },
        };
    }

    pub fn uv_open(this: *NodeFS, args: Arguments.Open, rc: i64) Maybe(Return.Open) {
        _ = this;
        if (rc < 0) {
            return Maybe(Return.Open){ .err = .{
                .errno = @intCast(-rc),
                .syscall = .open,
                .path = args.path.slice(),
                .from_libuv = true,
            } };
        }
        return Maybe(Return.Open).initResult(FDImpl.decode(bun.toFD(@as(u32, @intCast(rc)))));
    }

    pub fn openDir(_: *NodeFS, _: Arguments.OpenDir, comptime _: Flavor) Maybe(Return.OpenDir) {
        return Maybe(Return.OpenDir).todo();
    }

    fn _read(_: *NodeFS, args: Arguments.Read, comptime _: Flavor) Maybe(Return.Read) {
        if (Environment.allow_assert) bun.assert(args.position == null);
        var buf = args.buffer.slice();
        buf = buf[@min(args.offset, buf.len)..];
        buf = buf[0..@min(buf.len, args.length)];

        return switch (Syscall.read(args.fd, buf)) {
            .err => |err| .{
                .err = err,
            },
            .result => |amt| .{
                .result = .{
                    .bytes_read = @as(u52, @truncate(amt)),
                },
            },
        };
    }

    fn _pread(_: *NodeFS, args: Arguments.Read, comptime flavor: Flavor) Maybe(Return.Read) {
        _ = flavor;
        var buf = args.buffer.slice();
        buf = buf[@min(args.offset, buf.len)..];
        buf = buf[0..@min(buf.len, args.length)];

        return switch (Syscall.pread(args.fd, buf, args.position.?)) {
            .err => |err| .{
                .err = err,
            },
            .result => |amt| .{
                .result = .{
                    .bytes_read = @as(u52, @truncate(amt)),
                },
            },
        };
    }

    pub fn read(this: *NodeFS, args: Arguments.Read, comptime flavor: Flavor) Maybe(Return.Read) {
        const len1 = args.buffer.slice().len;
        const len2 = args.length;
        if (len1 == 0 or len2 == 0) {
            return Maybe(Return.Read).initResult(.{ .bytes_read = 0 });
        }
        return if (args.position != null)
            this._pread(
                args,
                comptime flavor,
            )
        else
            this._read(
                args,
                comptime flavor,
            );
    }

    pub fn uv_read(this: *NodeFS, args: Arguments.Read, rc: i64) Maybe(Return.Read) {
        _ = this;
        if (rc < 0) {
            return Maybe(Return.Read){ .err = .{
                .errno = @intCast(-rc),
                .syscall = .read,
                .fd = args.fd,
                .from_libuv = true,
            } };
        }
        return Maybe(Return.Read).initResult(.{ .bytes_read = @intCast(rc) });
    }

    pub fn uv_readv(this: *NodeFS, args: Arguments.Readv, rc: i64) Maybe(Return.Readv) {
        _ = this;
        if (rc < 0) {
            return Maybe(Return.Readv){ .err = .{
                .errno = @intCast(-rc),
                .syscall = .readv,
                .fd = args.fd,
                .from_libuv = true,
            } };
        }
        return Maybe(Return.Readv).initResult(.{ .bytes_read = @intCast(rc) });
    }

    pub fn readv(this: *NodeFS, args: Arguments.Readv, comptime flavor: Flavor) Maybe(Return.Readv) {
        return if (args.position != null) _preadv(this, args, flavor) else _readv(this, args, flavor);
    }

    pub fn writev(this: *NodeFS, args: Arguments.Writev, comptime flavor: Flavor) Maybe(Return.Writev) {
        return if (args.position != null) _pwritev(this, args, flavor) else _writev(this, args, flavor);
    }

    pub fn write(this: *NodeFS, args: Arguments.Write, comptime flavor: Flavor) Maybe(Return.Write) {
        return if (args.position != null) _pwrite(this, args, flavor) else _write(this, args, flavor);
    }

    pub fn uv_write(this: *NodeFS, args: Arguments.Write, rc: i64) Maybe(Return.Write) {
        _ = this;
        if (rc < 0) {
            return Maybe(Return.Write){ .err = .{
                .errno = @intCast(-rc),
                .syscall = .write,
                .fd = args.fd,
                .from_libuv = true,
            } };
        }
        return Maybe(Return.Write).initResult(.{ .bytes_written = @intCast(rc) });
    }

    pub fn uv_writev(this: *NodeFS, args: Arguments.Writev, rc: i64) Maybe(Return.Writev) {
        _ = this;
        if (rc < 0) {
            return Maybe(Return.Writev){ .err = .{
                .errno = @intCast(-rc),
                .syscall = .writev,
                .fd = args.fd,
                .from_libuv = true,
            } };
        }
        return Maybe(Return.Writev).initResult(.{ .bytes_written = @intCast(rc) });
    }

    fn _write(_: *NodeFS, args: Arguments.Write, comptime flavor: Flavor) Maybe(Return.Write) {
        _ = flavor;

        var buf = args.buffer.slice();
        buf = buf[@min(args.offset, buf.len)..];
        buf = buf[0..@min(buf.len, args.length)];

        return switch (Syscall.write(args.fd, buf)) {
            .err => |err| .{
                .err = err,
            },
            .result => |amt| .{
                .result = .{
                    .bytes_written = @as(u52, @truncate(amt)),
                },
            },
        };
    }

    fn _pwrite(_: *NodeFS, args: Arguments.Write, comptime flavor: Flavor) Maybe(Return.Write) {
        _ = flavor;
        const position = args.position.?;

        var buf = args.buffer.slice();
        buf = buf[@min(args.offset, buf.len)..];
        buf = buf[0..@min(args.length, buf.len)];

        return switch (Syscall.pwrite(args.fd, buf, position)) {
            .err => |err| .{
                .err = err,
            },
            .result => |amt| .{ .result = .{
                .bytes_written = @as(u52, @truncate(amt)),
            } },
        };
    }

    fn _preadv(_: *NodeFS, args: Arguments.Readv, comptime flavor: Flavor) Maybe(Return.Readv) {
        _ = flavor;
        const position = args.position.?;

        return switch (Syscall.preadv(args.fd, args.buffers.buffers.items, position)) {
            .err => |err| .{
                .err = err,
            },
            .result => |amt| .{ .result = .{
                .bytes_read = @as(u52, @truncate(amt)),
            } },
        };
    }

    fn _readv(_: *NodeFS, args: Arguments.Readv, comptime flavor: Flavor) Maybe(Return.Readv) {
        _ = flavor;
        return switch (Syscall.readv(args.fd, args.buffers.buffers.items)) {
            .err => |err| .{
                .err = err,
            },
            .result => |amt| .{ .result = .{
                .bytes_read = @as(u52, @truncate(amt)),
            } },
        };
    }

    fn _pwritev(_: *NodeFS, args: Arguments.Writev, comptime flavor: Flavor) Maybe(Return.Write) {
        _ = flavor;
        const position = args.position.?;
        return switch (Syscall.pwritev(args.fd, @ptrCast(args.buffers.buffers.items), position)) {
            .err => |err| .{
                .err = err,
            },
            .result => |amt| .{ .result = .{
                .bytes_written = @as(u52, @truncate(amt)),
            } },
        };
    }

    fn _writev(_: *NodeFS, args: Arguments.Writev, comptime flavor: Flavor) Maybe(Return.Write) {
        _ = flavor;
        return switch (Syscall.writev(args.fd, @ptrCast(args.buffers.buffers.items))) {
            .err => |err| .{
                .err = err,
            },
            .result => |amt| .{ .result = .{
                .bytes_written = @as(u52, @truncate(amt)),
            } },
        };
    }

    pub fn readdir(this: *NodeFS, args: Arguments.Readdir, comptime flavor: Flavor) Maybe(Return.Readdir) {
        if (comptime flavor != .sync) {
            if (args.recursive) {
                @panic("Assertion failure: this code path should never be reached.");
            }
        }

        return switch (args.recursive) {
            inline else => |recursive| switch (args.tag()) {
                .buffers => _readdir(&this.sync_error_buf, args, Buffer, recursive, flavor),
                .with_file_types => _readdir(&this.sync_error_buf, args, Dirent, recursive, flavor),
                .files => _readdir(&this.sync_error_buf, args, bun.String, recursive, flavor),
            },
        };
    }

    fn readdirWithEntries(
        args: Arguments.Readdir,
        fd: bun.FileDescriptor,
        basename: [:0]const u8,
        comptime ExpectedType: type,
        entries: *std.ArrayList(ExpectedType),
    ) Maybe(void) {
        const dir = fd.asDir();
        const is_u16 = comptime Environment.isWindows and (ExpectedType == bun.String or ExpectedType == Dirent);

        var dirent_path: bun.String = bun.String.dead;
        defer {
            dirent_path.deref();
        }

        var iterator = DirIterator.iterate(dir, comptime if (is_u16) .u16 else .u8);
        var entry = iterator.next();

        while (switch (entry) {
            .err => |err| {
                for (entries.items) |*item| {
                    switch (ExpectedType) {
                        Dirent => {
                            item.deref();
                        },
                        Buffer => {
                            item.destroy();
                        },
                        bun.String => {
                            item.deref();
                        },
                        else => @compileError("unreachable"),
                    }
                }

                entries.deinit();

                return .{
                    .err = err.withPath(args.path.slice()),
                };
            },
            .result => |ent| ent,
        }) |current| : (entry = iterator.next()) {
            if (ExpectedType == Dirent) {
                if (dirent_path.isEmpty()) {
                    dirent_path = bun.String.createUTF8(basename);
                }
            }
            if (comptime !is_u16) {
                const utf8_name = current.name.slice();
                switch (ExpectedType) {
                    Dirent => {
                        dirent_path.ref();
                        entries.append(.{
                            .name = bun.String.createUTF8(utf8_name),
                            .path = dirent_path,
                            .kind = current.kind,
                        }) catch bun.outOfMemory();
                    },
                    Buffer => {
                        entries.append(Buffer.fromString(utf8_name, bun.default_allocator) catch bun.outOfMemory()) catch bun.outOfMemory();
                    },
                    bun.String => {
                        entries.append(bun.String.createUTF8(utf8_name)) catch bun.outOfMemory();
                    },
                    else => @compileError("unreachable"),
                }
            } else {
                const utf16_name = current.name.slice();
                switch (ExpectedType) {
                    Dirent => {
                        dirent_path.ref();
                        entries.append(.{
                            .name = bun.String.createUTF16(utf16_name),
                            .path = dirent_path,
                            .kind = current.kind,
                        }) catch bun.outOfMemory();
                    },
                    bun.String => {
                        entries.append(bun.String.createUTF16(utf16_name)) catch bun.outOfMemory();
                    },
                    else => @compileError("unreachable"),
                }
            }
        }

        return Maybe(void).success;
    }

    pub fn readdirWithEntriesRecursiveAsync(
        buf: *bun.PathBuffer,
        args: Arguments.Readdir,
        async_task: *AsyncReaddirRecursiveTask,
        basename: [:0]const u8,
        comptime ExpectedType: type,
        entries: *std.ArrayList(ExpectedType),
        comptime is_root: bool,
    ) Maybe(void) {
        const root_basename = async_task.root_path.slice();
        const flags = bun.O.DIRECTORY | bun.O.RDONLY;
        const atfd = if (comptime is_root) bun.FD.cwd() else async_task.root_fd;
        const fd = switch (switch (Environment.os) {
            else => Syscall.openat(atfd, basename, flags, 0),
            // windows bun.sys.open does not pass iterable=true,
            .windows => bun.sys.openDirAtWindowsA(atfd, basename, .{ .no_follow = true, .iterable = true, .read_only = true }),
        }) {
            .err => |err| {
                if (comptime !is_root) {
                    switch (err.getErrno()) {
                        // These things can happen and there's nothing we can do about it.
                        //
                        // This is different than what Node does, at the time of writing.
                        // Node doesn't gracefully handle errors like these. It fails the entire operation.
                        .NOENT, .NOTDIR, .PERM => {
                            return Maybe(void).success;
                        },
                        else => {},
                    }

                    const path_parts = [_]string{ root_basename, basename };
                    return .{
                        .err = err.withPath(bun.path.joinZBuf(buf, &path_parts, .auto)),
                    };
                }
                return .{
                    .err = err.withPath(args.path.slice()),
                };
            },
            .result => |fd_| fd_,
        };

        if (comptime is_root) {
            async_task.root_fd = fd;
        }

        defer {
            if (comptime !is_root) {
                _ = Syscall.close(fd);
            }
        }

        var iterator = DirIterator.iterate(fd.asDir(), .u8);
        var entry = iterator.next();
        var dirent_path_prev: bun.String = bun.String.empty;
        defer {
            dirent_path_prev.deref();
        }

        while (switch (entry) {
            .err => |err| {
                if (comptime !is_root) {
                    const path_parts = [_]string{ root_basename, basename };
                    return .{
                        .err = err.withPath(bun.path.joinZBuf(buf, &path_parts, .auto)),
                    };
                }

                return .{
                    .err = err.withPath(args.path.slice()),
                };
            },
            .result => |ent| ent,
        }) |current| : (entry = iterator.next()) {
            const utf8_name = current.name.slice();

            const name_to_copy: [:0]const u8 = brk: {
                if (async_task.root_path.sliceAssumeZ().ptr == basename.ptr) {
                    break :brk @ptrCast(utf8_name);
                }

                const path_parts = [_]string{ basename, utf8_name };
                break :brk bun.path.joinZBuf(buf, &path_parts, .auto);
            };

            enqueue: {
                switch (current.kind) {
                    // a symlink might be a directory or might not be
                    // if it's not a directory, the task will fail at that point.
                    .sym_link,

                    // we know for sure it's a directory
                    .directory,
                    => {
                        // if the name is too long, we can't enqueue it regardless
                        // the operating system would just return ENAMETOOLONG
                        //
                        // Technically, we could work around that due to the
                        // usage of openat, but then we risk leaving too many
                        // file descriptors open.
                        if (current.name.len + 1 + name_to_copy.len > bun.MAX_PATH_BYTES) break :enqueue;

                        async_task.enqueue(name_to_copy);
                    },
                    else => {},
                }
            }

            switch (comptime ExpectedType) {
                Dirent => {
                    const path_u8 = bun.path.dirname(bun.path.join(&[_]string{ root_basename, name_to_copy }, .auto), .auto);
                    if (dirent_path_prev.isEmpty() or !bun.strings.eql(dirent_path_prev.byteSlice(), path_u8)) {
                        dirent_path_prev.deref();
                        dirent_path_prev = bun.String.createUTF8(path_u8);
                    }
                    dirent_path_prev.ref();

                    entries.append(.{
                        .name = bun.String.createUTF8(utf8_name),
                        .path = dirent_path_prev,
                        .kind = current.kind,
                    }) catch bun.outOfMemory();
                },
                Buffer => {
                    entries.append(Buffer.fromString(name_to_copy, bun.default_allocator) catch bun.outOfMemory()) catch bun.outOfMemory();
                },
                bun.String => {
                    entries.append(bun.String.createUTF8(name_to_copy)) catch bun.outOfMemory();
                },
                else => bun.outOfMemory(),
            }
        }

        return Maybe(void).success;
    }

    fn readdirWithEntriesRecursiveSync(
        buf: *bun.PathBuffer,
        args: Arguments.Readdir,
        root_basename: [:0]const u8,
        comptime ExpectedType: type,
        entries: *std.ArrayList(ExpectedType),
    ) Maybe(void) {
        var iterator_stack = std.heap.stackFallback(128, bun.default_allocator);
        var stack = std.fifo.LinearFifo([:0]const u8, .{ .Dynamic = {} }).init(iterator_stack.get());
        var basename_stack = std.heap.stackFallback(8192 * 2, bun.default_allocator);
        const basename_allocator = basename_stack.get();
        defer {
            while (stack.readItem()) |name| {
                basename_allocator.free(name);
            }
            stack.deinit();
        }

        stack.writeItem(root_basename) catch unreachable;
        var root_fd: bun.FileDescriptor = bun.invalid_fd;

        defer {
            // all other paths are relative to the root directory
            // so we can only close it once we're 100% done
            if (root_fd != bun.invalid_fd) {
                _ = Syscall.close(root_fd);
            }
        }

        while (stack.readItem()) |basename| {
            defer {
                if (root_basename.ptr != basename.ptr) {
                    basename_allocator.free(basename);
                }
            }

            const flags = bun.O.DIRECTORY | bun.O.RDONLY;
            const fd = switch (Syscall.openat(if (root_fd == bun.invalid_fd) bun.FD.cwd() else root_fd, basename, flags, 0)) {
                .err => |err| {
                    if (root_fd == bun.invalid_fd) {
                        return .{
                            .err = err.withPath(args.path.slice()),
                        };
                    }

                    switch (err.getErrno()) {
                        // These things can happen and there's nothing we can do about it.
                        //
                        // This is different than what Node does, at the time of writing.
                        // Node doesn't gracefully handle errors like these. It fails the entire operation.
                        .NOENT, .NOTDIR, .PERM => continue,
                        else => {
                            const path_parts = [_]string{ args.path.slice(), basename };
                            return .{
                                .err = err.withPath(bun.default_allocator.dupe(u8, bun.path.joinZBuf(buf, &path_parts, .auto)) catch ""),
                            };
                        },
                    }
                },
                .result => |fd_| fd_,
            };
            if (root_fd == bun.invalid_fd) {
                root_fd = fd;
            }

            defer {
                if (fd != root_fd) {
                    _ = Syscall.close(fd);
                }
            }

            var iterator = DirIterator.iterate(fd.asDir(), .u8);
            var entry = iterator.next();
            var dirent_path_prev: bun.String = bun.String.dead;
            defer {
                dirent_path_prev.deref();
            }

            while (switch (entry) {
                .err => |err| {
                    return .{
                        .err = err.withPath(args.path.slice()),
                    };
                },
                .result => |ent| ent,
            }) |current| : (entry = iterator.next()) {
                const utf8_name = current.name.slice();

                const name_to_copy = brk: {
                    if (root_basename.ptr == basename.ptr) {
                        break :brk utf8_name;
                    }

                    const path_parts = [_]string{ basename, utf8_name };
                    break :brk bun.path.joinZBuf(buf, &path_parts, .auto);
                };

                enqueue: {
                    switch (current.kind) {
                        // a symlink might be a directory or might not be
                        // if it's not a directory, the task will fail at that point.
                        .sym_link,

                        // we know for sure it's a directory
                        .directory,
                        => {
                            if (current.name.len + 1 + name_to_copy.len > bun.MAX_PATH_BYTES) break :enqueue;
                            stack.writeItem(basename_allocator.dupeZ(u8, name_to_copy) catch break :enqueue) catch break :enqueue;
                        },
                        else => {},
                    }
                }

                switch (comptime ExpectedType) {
                    Dirent => {
                        const path_u8 = bun.path.dirname(bun.path.join(&[_]string{ root_basename, name_to_copy }, .auto), .auto);
                        if (dirent_path_prev.isEmpty() or !bun.strings.eql(dirent_path_prev.byteSlice(), path_u8)) {
                            dirent_path_prev.deref();
                            dirent_path_prev = bun.String.createUTF8(path_u8);
                        }
                        dirent_path_prev.ref();
                        entries.append(.{
                            .name = bun.String.createUTF8(utf8_name),
                            .path = dirent_path_prev,
                            .kind = current.kind,
                        }) catch bun.outOfMemory();
                    },
                    Buffer => {
                        entries.append(Buffer.fromString(name_to_copy, bun.default_allocator) catch bun.outOfMemory()) catch bun.outOfMemory();
                    },
                    bun.String => {
                        entries.append(bun.String.createUTF8(name_to_copy)) catch bun.outOfMemory();
                    },
                    else => @compileError("Impossible"),
                }
            }
        }

        return Maybe(void).success;
    }

    fn shouldThrowOutOfMemoryEarlyForJavaScript(encoding: Encoding, size: usize, syscall: Syscall.Tag) ?Syscall.Error {
        // Strings & typed arrays max out at 4.7 GB.
        // But, it's **string length**
        // So you can load an 8 GB hex string, for example, it should be fine.
        const adjusted_size = switch (encoding) {
            .utf16le, .ucs2, .utf8 => size / 4 -| 1,
            .hex => size / 2 -| 1,
            .base64, .base64url => size / 3 -| 1,
            .ascii, .latin1, .buffer => size,
        };

        if (
        // Typed arrays in JavaScript are limited to 4.7 GB.
        adjusted_size > JSC.synthetic_allocation_limit or
            // If they do not have enough memory to open the file and they're on Linux, let's throw an error instead of dealing with the OOM killer.
            (Environment.isLinux and size >= bun.getTotalMemorySize()))
        {
            return Syscall.Error.fromCode(.NOMEM, syscall);
        }

        return null;
    }

    fn _readdir(
        buf: *bun.PathBuffer,
        args: Arguments.Readdir,
        comptime ExpectedType: type,
        comptime recursive: bool,
        comptime flavor: Flavor,
    ) Maybe(Return.Readdir) {
        const file_type = switch (ExpectedType) {
            Dirent => "with_file_types",
            bun.String => "files",
            Buffer => "buffers",
            else => @compileError("unreachable"),
        };

        const path = args.path.sliceZ(buf);

        if (comptime recursive and flavor == .sync) {
            var buf_to_pass: bun.PathBuffer = undefined;

            var entries = std.ArrayList(ExpectedType).init(bun.default_allocator);
            return switch (readdirWithEntriesRecursiveSync(&buf_to_pass, args, path, ExpectedType, &entries)) {
                .err => |err| {
                    for (entries.items) |*result| {
                        switch (ExpectedType) {
                            Dirent => {
                                result.name.deref();
                            },
                            Buffer => {
                                result.destroy();
                            },
                            bun.String => {
                                result.deref();
                            },
                            else => @compileError("unreachable"),
                        }
                    }

                    entries.deinit();

                    return .{
                        .err = err,
                    };
                },
                .result => .{ .result = @unionInit(Return.Readdir, file_type, entries.items) },
            };
        }

        if (comptime recursive) {
            @panic("This code path should never be reached. It should only go through readdirWithEntriesRecursiveAsync.");
        }

        const flags = bun.O.DIRECTORY | bun.O.RDONLY;
        const fd = switch (switch (Environment.os) {
            else => Syscall.open(path, flags, 0),
            // windows bun.sys.open does not pass iterable=true,
            .windows => bun.sys.openDirAtWindowsA(bun.FD.cwd(), path, .{ .iterable = true, .read_only = true }),
        }) {
            .err => |err| return .{
                .err = err.withPath(args.path.slice()),
            },
            .result => |fd_| fd_,
        };

        defer _ = Syscall.close(fd);

        var entries = std.ArrayList(ExpectedType).init(bun.default_allocator);
        return switch (readdirWithEntries(args, fd, path, ExpectedType, &entries)) {
            .err => |err| return .{
                .err = err,
            },
            .result => .{ .result = @unionInit(Return.Readdir, file_type, entries.items) },
        };
    }

    pub const StringType = enum {
        default,
        null_terminated,
    };

    pub fn readFile(this: *NodeFS, args: Arguments.ReadFile, comptime flavor: Flavor) Maybe(Return.ReadFile) {
        const ret = readFileWithOptions(this, args, flavor, .default);
        return switch (ret) {
            .err => .{ .err = ret.err },
            .result => switch (ret.result) {
                .buffer => .{
                    .result = .{
                        .buffer = ret.result.buffer,
                    },
                },
                .transcoded_string => |str| {
                    if (str.tag == .Dead) {
                        return .{ .err = Syscall.Error.fromCode(.NOMEM, .read).withPathLike(args.path) };
                    }

                    return .{
                        .result = .{
                            .string = .{
                                .underlying = str,
                            },
                        },
                    };
                },
                .string => brk: {
                    const str = bun.SliceWithUnderlyingString.transcodeFromOwnedSlice(@constCast(ret.result.string), args.encoding);

                    if (str.underlying.tag == .Dead and str.utf8.len == 0) {
                        return .{ .err = Syscall.Error.fromCode(.NOMEM, .read).withPathLike(args.path) };
                    }

                    break :brk .{ .result = .{ .string = str } };
                },
                else => unreachable,
            },
        };
    }

    pub fn readFileWithOptions(this: *NodeFS, args: Arguments.ReadFile, comptime flavor: Flavor, comptime string_type: StringType) Maybe(Return.ReadFileWithOptions) {
        var path: [:0]const u8 = undefined;
        const fd_maybe_windows: FileDescriptor = switch (args.path) {
            .path => brk: {
                path = args.path.path.sliceZ(&this.sync_error_buf);
                if (this.vm) |vm| {
                    if (vm.standalone_module_graph) |graph| {
                        if (graph.find(path)) |file| {
                            if (args.encoding == .buffer) {
                                return .{
                                    .result = .{
                                        .buffer = Buffer.fromBytes(
                                            bun.default_allocator.dupe(u8, file.contents) catch bun.outOfMemory(),
                                            bun.default_allocator,
                                            .Uint8Array,
                                        ),
                                    },
                                };
                            } else if (comptime string_type == .default)
                                return .{
                                    .result = .{
                                        .string = bun.default_allocator.dupe(u8, file.contents) catch bun.outOfMemory(),
                                    },
                                }
                            else
                                return .{
                                    .result = .{
                                        .null_terminated = bun.default_allocator.dupeZ(u8, file.contents) catch bun.outOfMemory(),
                                    },
                                };
                        }
                    }
                }

                break :brk switch (bun.sys.open(
                    path,
                    @intFromEnum(args.flag) | bun.O.NOCTTY,
                    default_permission,
                )) {
                    .err => |err| return .{
                        .err = err.withPath(if (args.path == .path) args.path.path.slice() else ""),
                    },
                    .result => |fd| fd,
                };
            },
            .fd => |fd| fd,
        };
        const fd = bun.toLibUVOwnedFD(fd_maybe_windows) catch {
            if (args.path == .path)
                _ = Syscall.close(fd_maybe_windows);

            return .{
                .err = .{
                    .errno = @intFromEnum(posix.E.MFILE),
                    .syscall = .open,
                },
            };
        };

        defer {
            if (args.path == .path)
                _ = Syscall.close(fd);
        }

        // Only used in DOMFormData
        if (args.offset > 0) {
            _ = Syscall.setFileOffset(fd, args.offset);
        }

        var did_succeed = false;
        var total: usize = 0;
        var async_stack_buffer: [if (flavor == .sync) 0 else 256 * 1024]u8 = undefined;

        // --- Optimization: attempt to read up to 256 KB before calling stat()
        // If we manage to read the entire file, we don't need to call stat() at all.
        // This will make it slightly slower to read e.g. 512 KB files, but usually the OS won't return a full 512 KB in one read anyway.
        const temporary_read_buffer_before_stat_call = brk: {
            const temporary_read_buffer = temporary_read_buffer: {
                var temporary_read_buffer: []u8 = &async_stack_buffer;

                if (comptime flavor == .sync) {
                    if (this.vm) |vm| {
                        temporary_read_buffer = vm.rareData().pipeReadBuffer();
                    }
                }

                var available = temporary_read_buffer;
                while (available.len > 0) {
                    switch (Syscall.read(fd, available)) {
                        .err => |err| return .{
                            .err = err,
                        },
                        .result => |amt| {
                            if (amt == 0) {
                                did_succeed = true;
                                break;
                            }
                            total += amt;
                            available = available[amt..];
                        },
                    }
                }
                break :temporary_read_buffer temporary_read_buffer[0..total];
            };

            if (did_succeed) {
                switch (args.encoding) {
                    .buffer => {
                        if (comptime flavor == .sync and string_type == .default) {
                            if (this.vm) |vm| {
                                // Attempt to create the buffer in JSC's heap.
                                // This avoids creating a WastefulTypedArray.
                                const array_buffer = JSC.ArrayBuffer.createBuffer(vm.global, temporary_read_buffer);
                                array_buffer.ensureStillAlive();
                                return .{
                                    .result = .{
                                        .buffer = JSC.MarkedArrayBuffer{
                                            .buffer = array_buffer.asArrayBuffer(vm.global) orelse {
                                                // This case shouldn't really happen.
                                                return .{
                                                    .err = Syscall.Error.fromCode(.NOMEM, .read).withPathLike(args.path),
                                                };
                                            },
                                        },
                                    },
                                };
                            }
                        }

                        return .{
                            .result = .{
                                .buffer = Buffer.fromBytes(
                                    bun.default_allocator.dupe(u8, temporary_read_buffer) catch return .{
                                        .err = Syscall.Error.fromCode(.NOMEM, .read).withPathLike(args.path),
                                    },
                                    bun.default_allocator,
                                    .Uint8Array,
                                ),
                            },
                        };
                    },
                    else => {
                        if (comptime string_type == .default) {
                            return .{
                                .result = .{
                                    .transcoded_string = JSC.WebCore.Encoder.toWTFString(temporary_read_buffer, args.encoding),
                                },
                            };
                        } else {
                            return .{
                                .result = .{
                                    .null_terminated = bun.default_allocator.dupeZ(u8, temporary_read_buffer) catch return .{
                                        .err = Syscall.Error.fromCode(.NOMEM, .read).withPathLike(args.path),
                                    },
                                },
                            };
                        }
                    },
                }
            }

            break :brk temporary_read_buffer;
        };
        // ----------------------------

        const stat_ = switch (Syscall.fstat(fd)) {
            .err => |err| return .{
                .err = err,
            },
            .result => |stat_| stat_,
        };

        // For certain files, the size might be 0 but the file might still have contents.
        // https://github.com/oven-sh/bun/issues/1220
        const max_size = args.max_size orelse std.math.maxInt(JSC.WebCore.Blob.SizeType);
        const has_max_size = args.max_size != null;

        const size = @as(
            u64,
            @max(
                @min(
                    stat_.size,
                    // Only used in DOMFormData
                    max_size,
                ),
                @as(i64, @intCast(total)),
                0,
            ),
        ) + @intFromBool(comptime string_type == .null_terminated);

        if (args.limit_size_for_javascript and
            // assume that anything more than 40 bits is not trustworthy.
            (size < std.math.maxInt(u40)))
        {
            if (shouldThrowOutOfMemoryEarlyForJavaScript(args.encoding, size, .read)) |err| {
                return .{ .err = err.withPathLike(args.path) };
            }
        }

        var buf = std.ArrayList(u8).init(bun.default_allocator);
        defer if (!did_succeed) buf.clearAndFree();
        buf.ensureTotalCapacityPrecise(
            @min(
                @max(temporary_read_buffer_before_stat_call.len, size) + 16,
                max_size,
                1024 * 1024 * 1024 * 8,
            ),
        ) catch return .{
            .err = Syscall.Error.fromCode(.NOMEM, .read).withPathLike(args.path),
        };
        if (temporary_read_buffer_before_stat_call.len > 0) {
            buf.appendSlice(temporary_read_buffer_before_stat_call) catch return .{
                .err = Syscall.Error.fromCode(.NOMEM, .read).withPathLike(args.path),
            };
        }
        buf.expandToCapacity();

        while (total < size) {
            switch (Syscall.read(fd, buf.items.ptr[total..@min(buf.capacity, max_size)])) {
                .err => |err| return .{
                    .err = err,
                },
                .result => |amt| {
                    total += amt;

                    if (args.limit_size_for_javascript) {
                        if (shouldThrowOutOfMemoryEarlyForJavaScript(args.encoding, total, .read)) |err| {
                            return .{
                                .err = err.withPathLike(args.path),
                            };
                        }
                    }

                    // There are cases where stat()'s size is wrong or out of date
                    if (total > size and amt != 0 and !has_max_size) {
                        buf.items.len = total;
                        buf.ensureUnusedCapacity(8192) catch {
                            return .{ .err = Syscall.Error.fromCode(.NOMEM, .read).withPathLike(args.path) };
                        };
                        continue;
                    }

                    if (amt == 0) {
                        did_succeed = true;
                        break;
                    }
                },
            }
        } else {
            while (true) {
                switch (Syscall.read(fd, buf.items.ptr[total..@min(buf.capacity, max_size)])) {
                    .err => |err| return .{
                        .err = err,
                    },
                    .result => |amt| {
                        total += amt;

                        if (args.limit_size_for_javascript) {
                            if (shouldThrowOutOfMemoryEarlyForJavaScript(args.encoding, total, .read)) |err| {
                                return .{ .err = err.withPathLike(args.path) };
                            }
                        }

                        if (total > size and amt != 0 and !has_max_size) {
                            buf.items.len = total;
                            buf.ensureUnusedCapacity(8192) catch {
                                return .{ .err = Syscall.Error.fromCode(.NOMEM, .read).withPathLike(args.path) };
                            };
                            continue;
                        }

                        if (amt == 0) {
                            did_succeed = true;
                            break;
                        }
                    },
                }
            }
        }

        buf.items.len = if (comptime string_type == .null_terminated) total + 1 else total;
        if (total == 0) {
            buf.clearAndFree();
            return switch (args.encoding) {
                .buffer => .{
                    .result = .{
                        .buffer = Buffer.empty,
                    },
                },
                else => brk: {
                    if (comptime string_type == .default) {
                        break :brk .{
                            .result = .{
                                .string = "",
                            },
                        };
                    } else {
                        break :brk .{
                            .result = .{
                                .null_terminated = "",
                            },
                        };
                    }
                },
            };
        }

        return switch (args.encoding) {
            .buffer => .{
                .result = .{
                    .buffer = Buffer.fromBytes(buf.items, bun.default_allocator, .Uint8Array),
                },
            },
            else => brk: {
                if (comptime string_type == .default) {
                    break :brk .{
                        .result = .{
                            .string = buf.items,
                        },
                    };
                } else {
                    break :brk .{
                        .result = .{
                            .null_terminated = buf.toOwnedSliceSentinel(0) catch return .{
                                // Since we are expecting a null-terminated string, we can't just ignore the resize failure.
                                .err = Syscall.Error.fromCode(.NOMEM, .read).withPathLike(args.path),
                            },
                        },
                    };
                }
            },
        };
    }

    pub fn writeFileWithPathBuffer(pathbuf: *bun.PathBuffer, args: Arguments.WriteFile) Maybe(Return.WriteFile) {
        const fd = switch (args.file) {
            .path => brk: {
                const path = args.file.path.sliceZWithForceCopy(pathbuf, true);

                const open_result = Syscall.openat(
                    args.dirfd,
                    path,
                    @intFromEnum(args.flag) | bun.O.NOCTTY,
                    args.mode,
                );

                break :brk switch (open_result) {
                    .err => |err| return .{
                        .err = err.withPath(path),
                    },
                    .result => |fd| fd,
                };
            },
            .fd => |fd| fd,
        };

        defer {
            if (args.file == .path)
                _ = bun.sys.close(fd);
        }

        var buf = args.data.slice();
        var written: usize = 0;

        // Attempt to pre-allocate large files
        if (Environment.isLinux) {
            preallocate: {
                // Worthwhile after 6 MB at least on ext4 linux
                if (buf.len >= bun.C.preallocate_length) {
                    const offset: usize = if (args.file == .path)
                        // on mac, it's relatively positioned
                        0
                    else brk: {
                        // on linux, it's absolutely positione

                        switch (Syscall.lseek(
                            fd,
                            @as(std.posix.off_t, @intCast(0)),
                            std.os.linux.SEEK.CUR,
                        )) {
                            .err => break :preallocate,
                            .result => |pos| break :brk @as(usize, @intCast(pos)),
                        }
                    };

                    bun.C.preallocate_file(
                        fd.cast(),
                        @as(std.posix.off_t, @intCast(offset)),
                        @as(std.posix.off_t, @intCast(buf.len)),
                    ) catch {};
                }
            }
        }

        while (buf.len > 0) {
            switch (bun.sys.write(fd, buf)) {
                .err => |err| return .{
                    .err = err,
                },
                .result => |amt| {
                    buf = buf[amt..];
                    written += amt;
                    if (amt == 0) {
                        break;
                    }
                },
            }
        }

        // https://github.com/oven-sh/bun/issues/2931
        // https://github.com/oven-sh/bun/issues/10222
        // Only truncate if we're not appending and writing to a path
        if ((@intFromEnum(args.flag) & bun.O.APPEND) == 0 and args.file != .fd) {
            // If this errors, we silently ignore it.
            // Not all files are seekable (and thus, not all files can be truncated).
            if (Environment.isWindows) {
                _ = std.os.windows.kernel32.SetEndOfFile(fd.cast());
            } else {
                _ = ftruncateSync(.{ .fd = fd, .len = @as(JSC.WebCore.Blob.SizeType, @truncate(written)) });
            }
        }

        return Maybe(Return.WriteFile).success;
    }

    pub fn writeFile(this: *NodeFS, args: Arguments.WriteFile, comptime _: Flavor) Maybe(Return.WriteFile) {
        return writeFileWithPathBuffer(&this.sync_error_buf, args);
    }

    pub fn readlink(this: *NodeFS, args: Arguments.Readlink, comptime _: Flavor) Maybe(Return.Readlink) {
        var outbuf: bun.PathBuffer = undefined;
        const inbuf = &this.sync_error_buf;

        const path = args.path.sliceZ(inbuf);

        const link_path = switch (Syscall.readlink(path, &outbuf)) {
            .err => |err| return .{ .err = err.withPath(args.path.slice()) },
            .result => |result| result,
        };

        return .{
            .result = switch (args.encoding) {
                .buffer => .{
                    .buffer = Buffer.fromString(link_path, bun.default_allocator) catch unreachable,
                },
                else => if (args.path == .slice_with_underlying_string and
                    strings.eqlLong(args.path.slice_with_underlying_string.slice(), link_path, true))
                    .{
                        .string = args.path.slice_with_underlying_string.dupeRef(),
                    }
                else
                    .{
                        .string = .{ .utf8 = .{}, .underlying = bun.String.createUTF8(link_path) },
                    },
            },
        };
    }

    pub fn realpath(this: *NodeFS, args: Arguments.Realpath, comptime _: Flavor) Maybe(Return.Realpath) {
        if (Environment.isWindows) {
            var req: uv.fs_t = uv.fs_t.uninitialized;
            defer req.deinit();
            const rc = uv.uv_fs_realpath(bun.Async.Loop.get(), &req, args.path.sliceZ(&this.sync_error_buf).ptr, null);

            if (rc.errno()) |errno|
                return .{ .err = Syscall.Error{
                    .errno = errno,
                    .syscall = .realpath,
                    .path = args.path.slice(),
                } };

            // Seems like `rc` does not contain the errno?
            bun.assert(rc.errEnum() == null);
            const buf = bun.span(req.ptrAs([*:0]u8));

            return .{
                .result = switch (args.encoding) {
                    .buffer => .{
                        .buffer = Buffer.fromString(buf, bun.default_allocator) catch unreachable,
                    },
                    else => if (args.path == .slice_with_underlying_string and
                        strings.eqlLong(args.path.slice_with_underlying_string.slice(), buf, true))
                        .{
                            .string = args.path.slice_with_underlying_string.dupeRef(),
                        }
                    else
                        .{
                            .string = .{ .utf8 = .{}, .underlying = bun.String.createUTF8(buf) },
                        },
                },
            };
        }

        var outbuf: bun.PathBuffer = undefined;
        var inbuf = &this.sync_error_buf;
        if (comptime Environment.allow_assert) bun.assert(FileSystem.instance_loaded);

        const path_slice = args.path.slice();

        var parts = [_]string{ FileSystem.instance.top_level_dir, path_slice };
        const path_ = FileSystem.instance.absBuf(&parts, inbuf);
        inbuf[path_.len] = 0;
        const path: [:0]u8 = inbuf[0..path_.len :0];

        const flags = if (comptime Environment.isLinux)
            // O_PATH is faster
            bun.O.PATH
        else
            bun.O.RDONLY;

        const fd = switch (bun.sys.open(path, flags, 0)) {
            .err => |err| return .{ .err = err.withPath(path) },
            .result => |fd_| fd_,
        };

        defer {
            _ = Syscall.close(fd);
        }

        const buf = switch (Syscall.getFdPath(fd, &outbuf)) {
            .err => |err| return .{ .err = err.withPath(path) },
            .result => |buf_| buf_,
        };

        return .{
            .result = switch (args.encoding) {
                .buffer => .{
                    .buffer = Buffer.fromString(buf, bun.default_allocator) catch unreachable,
                },
                else => if (args.path == .slice_with_underlying_string and
                    strings.eqlLong(args.path.slice_with_underlying_string.slice(), buf, true))
                    .{
                        .string = args.path.slice_with_underlying_string.dupeRef(),
                    }
                else
                    .{
                        .string = .{ .utf8 = .{}, .underlying = bun.String.createUTF8(buf) },
                    },
            },
        };
    }

    pub const realpathNative = realpath;
    // pub fn realpathNative(this: *NodeFS,  args: Arguments.Realpath, comptime flavor: Flavor) Maybe(Return.Realpath) {
    //     _ = args;
    //
    //
    //     return error.NotImplementedYet;
    // }

    pub fn rename(this: *NodeFS, args: Arguments.Rename, comptime flavor: Flavor) Maybe(Return.Rename) {
        _ = flavor;
        const from_buf = &this.sync_error_buf;
        var to_buf: bun.PathBuffer = undefined;

        const from = args.old_path.sliceZ(from_buf);
        const to = args.new_path.sliceZ(&to_buf);
        return Syscall.rename(from, to);
    }

    pub fn rmdir(this: *NodeFS, args: Arguments.RmDir, comptime _: Flavor) Maybe(Return.Rmdir) {
        if (args.recursive) {
            std.fs.cwd().deleteTree(args.path.slice()) catch |err| {
                const errno: bun.C.E = switch (err) {
                    error.AccessDenied => .PERM,
                    error.FileTooBig => .FBIG,
                    error.SymLinkLoop => .LOOP,
                    error.ProcessFdQuotaExceeded => .NFILE,
                    error.NameTooLong => .NAMETOOLONG,
                    error.SystemFdQuotaExceeded => .MFILE,
                    error.SystemResources => .NOMEM,
                    error.ReadOnlyFileSystem => .ROFS,
                    error.FileSystem => .IO,
                    error.FileBusy => .BUSY,
                    error.DeviceBusy => .BUSY,

                    // One of the path components was not a directory.
                    // This error is unreachable if `sub_path` does not contain a path separator.
                    error.NotDir => .NOTDIR,
                    // On Windows, file paths must be valid Unicode.
                    error.InvalidUtf8 => .INVAL,
                    error.InvalidWtf8 => .INVAL,

                    // On Windows, file paths cannot contain these characters:
                    // '/', '*', '?', '"', '<', '>', '|'
                    error.BadPathName => .INVAL,

                    else => .FAULT,
                };
                return Maybe(Return.Rm){
                    .err = bun.sys.Error.fromCode(errno, .rmdir),
                };
            };

            return Maybe(Return.Rmdir).success;
        }

        if (comptime Environment.isWindows) {
            return Syscall.rmdir(args.path.sliceZ(&this.sync_error_buf));
        }

        return Maybe(Return.Rmdir).errnoSysP(system.rmdir(args.path.sliceZ(&this.sync_error_buf)), .rmdir, args.path.slice()) orelse
            Maybe(Return.Rmdir).success;
    }

    pub fn rm(this: *NodeFS, args: Arguments.RmDir, comptime _: Flavor) Maybe(Return.Rm) {
        // We cannot use removefileat() on macOS because it does not handle write-protected files as expected.
        if (args.recursive) {
            // TODO: switch to an implementation which does not use any "unreachable"
            std.fs.cwd().deleteTree(args.path.slice()) catch |err| {
                const errno: E = switch (err) {
                    // error.InvalidHandle => .BADF,
                    error.AccessDenied => .PERM,
                    error.FileTooBig => .FBIG,
                    error.SymLinkLoop => .LOOP,
                    error.ProcessFdQuotaExceeded => .NFILE,
                    error.NameTooLong => .NAMETOOLONG,
                    error.SystemFdQuotaExceeded => .MFILE,
                    error.SystemResources => .NOMEM,
                    error.ReadOnlyFileSystem => .ROFS,
                    error.FileSystem => .IO,
                    error.FileBusy => .BUSY,
                    error.DeviceBusy => .BUSY,

                    // One of the path components was not a directory.
                    // This error is unreachable if `sub_path` does not contain a path separator.
                    error.NotDir => .NOTDIR,
                    // On Windows, file paths must be valid WTF-8.
                    error.InvalidUtf8 => .INVAL,
                    error.InvalidWtf8 => .INVAL,

                    // On Windows, file paths cannot contain these characters:
                    // '/', '*', '?', '"', '<', '>', '|'
                    error.BadPathName => .INVAL,

                    else => .FAULT,
                };
                if (args.force) {
                    return Maybe(Return.Rm).success;
                }
                return Maybe(Return.Rm){
                    .err = bun.sys.Error.fromCode(errno, .unlink),
                };
            };
            return Maybe(Return.Rm).success;
        }

        const dest = args.path.sliceZ(&this.sync_error_buf);

        std.posix.unlinkZ(dest) catch |er| {
            // empircally, it seems to return AccessDenied when the
            // file is actually a directory on macOS.
            if (args.recursive and
                (er == error.IsDir or er == error.NotDir or er == error.AccessDenied))
            {
                std.posix.rmdirZ(dest) catch |err| {
                    if (args.force) {
                        return Maybe(Return.Rm).success;
                    }

                    const code: E = switch (err) {
                        error.AccessDenied => .PERM,
                        error.SymLinkLoop => .LOOP,
                        error.NameTooLong => .NAMETOOLONG,
                        error.SystemResources => .NOMEM,
                        error.ReadOnlyFileSystem => .ROFS,
                        error.FileBusy => .BUSY,
                        error.FileNotFound => .NOENT,
                        error.InvalidUtf8 => .INVAL,
                        error.InvalidWtf8 => .INVAL,
                        error.BadPathName => .INVAL,
                        else => .FAULT,
                    };

                    return .{
                        .err = bun.sys.Error.fromCode(
                            code,
                            .rmdir,
                        ),
                    };
                };

                return Maybe(Return.Rm).success;
            }

            if (args.force) {
                return Maybe(Return.Rm).success;
            }

            {
                const code: E = switch (er) {
                    error.AccessDenied => .PERM,
                    error.SymLinkLoop => .LOOP,
                    error.NameTooLong => .NAMETOOLONG,
                    error.SystemResources => .NOMEM,
                    error.ReadOnlyFileSystem => .ROFS,
                    error.FileBusy => .BUSY,
                    error.InvalidUtf8 => .INVAL,
                    error.InvalidWtf8 => .INVAL,
                    error.BadPathName => .INVAL,
                    error.FileNotFound => .NOENT,
                    else => .FAULT,
                };

                return .{
                    .err = bun.sys.Error.fromCode(
                        code,
                        .unlink,
                    ),
                };
            }
        };

        return Maybe(Return.Rm).success;
    }

    pub fn stat(this: *NodeFS, args: Arguments.Stat, comptime _: Flavor) Maybe(Return.Stat) {
        const path = args.path.sliceZ(&this.sync_error_buf);
        return switch (Syscall.stat(path)) {
            .result => |result| .{
                .result = .{ .stats = Stats.init(result, args.big_int) },
            },
            .err => |err| brk: {
                if (!args.throw_if_no_entry and err.getErrno() == .NOENT) {
                    return .{ .result = .{ .not_found = {} } };
                }
                break :brk .{ .err = err.withPath(path) };
            },
        };
    }

    pub fn symlink(this: *NodeFS, args: Arguments.Symlink, comptime _: Flavor) Maybe(Return.Symlink) {
        var to_buf: bun.PathBuffer = undefined;

        if (Environment.isWindows) {
            const target: [:0]u8 = args.old_path.sliceZWithForceCopy(&this.sync_error_buf, true);
            // UV does not normalize slashes in symlink targets, but Node does
            // See https://github.com/oven-sh/bun/issues/8273
            bun.path.dangerouslyConvertPathToWindowsInPlace(u8, target);

            return Syscall.symlinkUV(
                target,
                args.new_path.sliceZ(&to_buf),
                switch (args.link_type) {
                    .file => 0,
                    .dir => uv.UV_FS_SYMLINK_DIR,
                    .junction => uv.UV_FS_SYMLINK_JUNCTION,
                },
            );
        }

        return Syscall.symlink(
            args.old_path.sliceZ(&this.sync_error_buf),
            args.new_path.sliceZ(&to_buf),
        );
    }

    fn _truncate(this: *NodeFS, path: PathLike, len: JSC.WebCore.Blob.SizeType, flags: i32, comptime _: Flavor) Maybe(Return.Truncate) {
        if (comptime Environment.isWindows) {
            const file = bun.sys.open(
                path.sliceZ(&this.sync_error_buf),
                bun.O.WRONLY | flags,
                0o644,
            );
            if (file == .err)
                return .{ .err = file.err.withPath(path.slice()) };
            defer _ = Syscall.close(file.result);
            return Syscall.ftruncate(file.result, len);
        }

        return Maybe(Return.Truncate).errnoSys(C.truncate(path.sliceZ(&this.sync_error_buf), len), .truncate) orelse
            Maybe(Return.Truncate).success;
    }

    pub fn truncate(this: *NodeFS, args: Arguments.Truncate, comptime flavor: Flavor) Maybe(Return.Truncate) {
        return switch (args.path) {
            .fd => |fd| this.ftruncate(
                Arguments.FTruncate{ .fd = fd, .len = args.len },
                flavor,
            ),
            .path => this._truncate(
                args.path.path,
                args.len,
                args.flags,
                flavor,
            ),
        };
    }

    pub fn unlink(this: *NodeFS, args: Arguments.Unlink, comptime _: Flavor) Maybe(Return.Unlink) {
        if (Environment.isWindows) {
            return Syscall.unlink(args.path.sliceZ(&this.sync_error_buf));
        }
        return Maybe(Return.Unlink).errnoSysP(system.unlink(args.path.sliceZ(&this.sync_error_buf)), .unlink, args.path.slice()) orelse
            Maybe(Return.Unlink).success;
    }

    pub fn watchFile(_: *NodeFS, args: Arguments.WatchFile, comptime flavor: Flavor) Maybe(Return.WatchFile) {
        bun.assert(flavor == .sync);

        const watcher = args.createStatWatcher() catch |err| {
            const buf = std.fmt.allocPrint(bun.default_allocator, "Failed to watch file {}", .{bun.fmt.QuotedFormatter{ .text = args.path.slice() }}) catch bun.outOfMemory();
            defer bun.default_allocator.free(buf);
            args.global_this.throwValue((JSC.SystemError{
                .message = bun.String.init(buf),
                .code = bun.String.init(@errorName(err)),
                .path = bun.String.init(args.path.slice()),
            }).toErrorInstance(args.global_this)) catch {};
            return Maybe(Return.Watch){ .result = JSC.JSValue.undefined };
        };
        return Maybe(Return.Watch){ .result = watcher };
    }

    pub fn unwatchFile(_: *NodeFS, _: Arguments.UnwatchFile, comptime _: Flavor) Maybe(Return.UnwatchFile) {
        return Maybe(Return.UnwatchFile).todo();
    }

    pub fn utimes(this: *NodeFS, args: Arguments.Utimes, comptime _: Flavor) Maybe(Return.Utimes) {
        if (comptime Environment.isWindows) {
            var req: uv.fs_t = uv.fs_t.uninitialized;
            defer req.deinit();
            const rc = uv.uv_fs_utime(
                bun.Async.Loop.get(),
                &req,
                args.path.sliceZ(&this.sync_error_buf).ptr,
                args.atime,
                args.mtime,
                null,
            );
            return if (rc.errno()) |errno|
                .{ .err = Syscall.Error{
                    .errno = errno,
                    .syscall = .utimes,
                } }
            else
                Maybe(Return.Utimes).success;
        }

        bun.assert(args.mtime.tv_nsec <= 1e9);
        bun.assert(args.atime.tv_nsec <= 1e9);
        var times = [2]std.c.timeval{
            .{
                .tv_sec = args.atime.tv_sec,
                .tv_usec = @intCast(@divTrunc(args.atime.tv_nsec, std.time.ns_per_us)),
            },
            .{
                .tv_sec = args.mtime.tv_sec,
                .tv_usec = @intCast(@divTrunc(args.mtime.tv_nsec, std.time.ns_per_us)),
            },
        };

        return if (Maybe(Return.Utimes).errnoSysP(std.c.utimes(args.path.sliceZ(&this.sync_error_buf), &times), .utimes, args.path.slice())) |err|
            err
        else
            Maybe(Return.Utimes).success;
    }

    pub fn lutimes(this: *NodeFS, args: Arguments.Lutimes, comptime _: Flavor) Maybe(Return.Lutimes) {
        if (comptime Environment.isWindows) {
            var req: uv.fs_t = uv.fs_t.uninitialized;
            defer req.deinit();
            const rc = uv.uv_fs_lutime(
                bun.Async.Loop.get(),
                &req,
                args.path.sliceZ(&this.sync_error_buf).ptr,
                args.atime,
                args.mtime,
                null,
            );
            return if (rc.errno()) |errno|
                .{ .err = Syscall.Error{
                    .errno = errno,
                    .syscall = .utimes,
                } }
            else
                Maybe(Return.Utimes).success;
        }

        bun.assert(args.mtime.tv_nsec <= 1e9);
        bun.assert(args.atime.tv_nsec <= 1e9);
        var times = [2]std.c.timeval{
            .{
                .tv_sec = args.atime.tv_sec,
                .tv_usec = @intCast(@divTrunc(args.atime.tv_nsec, std.time.ns_per_us)),
            },
            .{
                .tv_sec = args.mtime.tv_sec,
                .tv_usec = @intCast(@divTrunc(args.mtime.tv_nsec, std.time.ns_per_us)),
            },
        };

        return if (Maybe(Return.Lutimes).errnoSysP(C.lutimes(args.path.sliceZ(&this.sync_error_buf), &times), .lutimes, args.path.slice())) |err|
            err
        else
            Maybe(Return.Lutimes).success;
    }

    pub fn watch(_: *NodeFS, args: Arguments.Watch, comptime _: Flavor) Maybe(Return.Watch) {
        return args.createFSWatcher();
    }

    /// This function is `cpSync`, but only if you pass `{ recursive: ..., force: ..., errorOnExist: ..., mode: ... }'
    /// The other options like `filter` use a JS fallback, see `src/js/internal/fs/cp.ts`
    pub fn cp(this: *NodeFS, args: Arguments.Cp, comptime flavor: Flavor) Maybe(Return.Cp) {
        comptime bun.assert(flavor == .sync);

        var src_buf: bun.PathBuffer = undefined;
        var dest_buf: bun.PathBuffer = undefined;

        const src = args.src.osPath(&src_buf);
        const dest = args.dest.osPath(&dest_buf);

        return this._cpSync(
            @as(*bun.OSPathBuffer, @alignCast(@ptrCast(&src_buf))),
            @intCast(src.len),
            @as(*bun.OSPathBuffer, @alignCast(@ptrCast(&dest_buf))),
            @intCast(dest.len),
            args,
        );
    }

    pub fn osPathIntoSyncErrorBuf(this: *NodeFS, slice: anytype) []const u8 {
        if (Environment.isWindows) {
            return bun.strings.fromWPath(&this.sync_error_buf, slice);
        } else {
            @memcpy(this.sync_error_buf[0..slice.len], slice);
            return this.sync_error_buf[0..slice.len];
        }
    }

    pub fn osPathIntoSyncErrorBufOverlap(this: *NodeFS, slice: anytype) []const u8 {
        if (Environment.isWindows) {
            const tmp = bun.OSPathBufferPool.get();
            defer bun.OSPathBufferPool.put(tmp);
            @memcpy(tmp[0..slice.len], slice);
            return bun.strings.fromWPath(&this.sync_error_buf, tmp[0..slice.len]);
        } else {}
    }

    fn _cpSync(
        this: *NodeFS,
        src_buf: *bun.OSPathBuffer,
        src_dir_len: PathString.PathInt,
        dest_buf: *bun.OSPathBuffer,
        dest_dir_len: PathString.PathInt,
        args: Arguments.Cp,
    ) Maybe(Return.Cp) {
        const cp_flags = args.flags;
        const src = src_buf[0..src_dir_len :0];
        const dest = dest_buf[0..dest_dir_len :0];

        if (Environment.isWindows) {
            const attributes = windows.GetFileAttributesW(src);
            if (attributes == windows.INVALID_FILE_ATTRIBUTES) {
                return .{ .err = .{
                    .errno = @intFromEnum(C.SystemErrno.ENOENT),
                    .syscall = .copyfile,
                    .path = this.osPathIntoSyncErrorBuf(src),
                } };
            }

            if ((attributes & windows.FILE_ATTRIBUTE_DIRECTORY) == 0) {
                const r = this._copySingleFileSync(
                    src,
                    dest,
                    @enumFromInt((if (cp_flags.errorOnExist or !cp_flags.force) Constants.COPYFILE_EXCL else @as(u8, 0))),
                    attributes,
                    args,
                );
                if (r == .err and r.err.errno == @intFromEnum(E.EXIST) and !cp_flags.errorOnExist) {
                    return Maybe(Return.Cp).success;
                }
                return r;
            }
        } else {
            const stat_ = switch (Syscall.lstat(src)) {
                .result => |result| result,
                .err => |err| {
                    @memcpy(this.sync_error_buf[0..src.len], src);
                    return .{ .err = err.withPath(this.sync_error_buf[0..src.len]) };
                },
            };

            if (!posix.S.ISDIR(stat_.mode)) {
                const r = this._copySingleFileSync(
                    src,
                    dest,
                    @enumFromInt((if (cp_flags.errorOnExist or !cp_flags.force) Constants.COPYFILE_EXCL else @as(u8, 0))),
                    stat_,
                    args,
                );
                if (r == .err and r.err.errno == @intFromEnum(E.EXIST) and !cp_flags.errorOnExist) {
                    return Maybe(Return.Cp).success;
                }
                return r;
            }
        }

        if (!cp_flags.recursive) {
            return .{
                .err = .{
                    .errno = @intFromEnum(E.ISDIR),
                    .syscall = .copyfile,
                    .path = this.osPathIntoSyncErrorBuf(src),
                },
            };
        }

        if (comptime Environment.isMac) try_with_clonefile: {
            if (Maybe(Return.Cp).errnoSysP(C.clonefile(src, dest, 0), .clonefile, src)) |err| {
                switch (err.getErrno()) {
                    .NAMETOOLONG, .ROFS, .INVAL, .ACCES, .PERM => |errno| {
                        if (errno == .ACCES or errno == .PERM) {
                            if (args.flags.force) {
                                break :try_with_clonefile;
                            }
                        }

                        @memcpy(this.sync_error_buf[0..src.len], src);
                        return .{ .err = err.err.withPath(this.sync_error_buf[0..src.len]) };
                    },

                    // Other errors may be due to clonefile() not being supported
                    // We'll fall back to other implementations
                    else => {},
                }
            } else {
                return Maybe(Return.Cp).success;
            }
        }

        const fd = switch (Syscall.openatOSPath(
            bun.toFD((std.fs.cwd().fd)),
            src,
            bun.O.DIRECTORY | bun.O.RDONLY,
            0,
        )) {
            .err => |err| {
                return .{ .err = err.withPath(this.osPathIntoSyncErrorBuf(src)) };
            },
            .result => |fd_| fd_,
        };
        defer _ = Syscall.close(fd);

        switch (this.mkdirRecursiveOSPath(dest, Arguments.Mkdir.DefaultMode, false)) {
            .err => |err| return Maybe(Return.Cp){ .err = err },
            .result => {},
        }

        var iterator = iterator: {
            const dir = fd.asDir();
            break :iterator DirIterator.iterate(dir, if (Environment.isWindows) .u16 else .u8);
        };
        var entry = iterator.next();
        while (switch (entry) {
            .err => |err| {
                return .{ .err = err.withPath(this.osPathIntoSyncErrorBuf(src)) };
            },
            .result => |ent| ent,
        }) |current| : (entry = iterator.next()) {
            const name_slice = current.name.slice();

            @memcpy(src_buf[src_dir_len + 1 .. src_dir_len + 1 + name_slice.len], name_slice);
            src_buf[src_dir_len] = std.fs.path.sep;
            src_buf[src_dir_len + 1 + name_slice.len] = 0;

            @memcpy(dest_buf[dest_dir_len + 1 .. dest_dir_len + 1 + name_slice.len], name_slice);
            dest_buf[dest_dir_len] = std.fs.path.sep;
            dest_buf[dest_dir_len + 1 + name_slice.len] = 0;

            switch (current.kind) {
                .directory => {
                    const r = this._cpSync(
                        src_buf,
                        src_dir_len + @as(PathString.PathInt, @intCast(1 + name_slice.len)),
                        dest_buf,
                        dest_dir_len + @as(PathString.PathInt, @intCast(1 + name_slice.len)),
                        args,
                    );
                    switch (r) {
                        .err => return r,
                        .result => {},
                    }
                },
                else => {
                    const r = this._copySingleFileSync(
                        src_buf[0 .. src_dir_len + 1 + name_slice.len :0],
                        dest_buf[0 .. dest_dir_len + 1 + name_slice.len :0],
                        @enumFromInt((if (cp_flags.errorOnExist or !cp_flags.force) Constants.COPYFILE_EXCL else @as(u8, 0))),
                        null,
                        args,
                    );
                    switch (r) {
                        .err => {
                            if (r.err.errno == @intFromEnum(E.EXIST) and !cp_flags.errorOnExist) {
                                continue;
                            }
                            return r;
                        },
                        .result => {},
                    }
                },
            }
        }
        return Maybe(Return.Cp).success;
    }

    /// On Windows, copying a file onto itself will return EBUSY, which is an
    /// unintuitive and cryptic error to return to the user for an operation
    /// that should seemingly be a no-op.
    ///
    /// So we check if the source and destination are the same file, and if they
    /// are, we return success.
    ///
    /// This is copied directly from libuv's implementation of `uv_fs_copyfile`
    /// for Windows:
    ///
    /// https://github.com/libuv/libuv/blob/497f3168d13ea9a92ad18c28e8282777ec2acf73/src/win/fs.c#L2069
    ///
    /// **This function does nothing on non-Windows platforms**.
    fn shouldIgnoreEbusy(src: PathLike, dest: PathLike, result: Maybe(Return.CopyFile)) Maybe(Return.CopyFile) {
        if (comptime !Environment.isWindows) return result;
        if (result != .err or result.err.getErrno() != .BUSY) return result;

        var buf: bun.PathBuffer = undefined;
        const statbuf = switch (Syscall.stat(src.sliceZ(&buf))) {
            .result => |b| b,
            .err => return result,
        };
        const new_statbuf = switch (Syscall.stat(dest.sliceZ(&buf))) {
            .result => |b| b,
            .err => return result,
        };

        if (statbuf.dev == new_statbuf.dev and statbuf.ino == new_statbuf.ino) {
            return Maybe(Return.CopyFile).success;
        }

        return result;
    }

    /// This is `copyFile`, but it copies symlinks as-is
    pub fn _copySingleFileSync(
        this: *NodeFS,
        src: bun.OSPathSliceZ,
        dest: bun.OSPathSliceZ,
        mode: Constants.Copyfile,
        /// Stat on posix, file attributes on windows
        reuse_stat: ?if (Environment.isWindows) windows.DWORD else std.posix.Stat,
        args: Arguments.Cp,
    ) Maybe(Return.CopyFile) {
        const ret = Maybe(Return.CopyFile);

        // TODO: do we need to fchown?
        if (Environment.isMac) {
            if (mode.isForceClone()) {
                // https://www.manpagez.com/man/2/clonefile/
                return ret.errnoSysP(C.clonefile(src, dest, 0), .clonefile, src) orelse ret.success;
            } else {
                const stat_ = reuse_stat orelse switch (Syscall.lstat(src)) {
                    .result => |result| result,
                    .err => |err| {
                        @memcpy(this.sync_error_buf[0..src.len], src);
                        return .{ .err = err.withPath(this.sync_error_buf[0..src.len]) };
                    },
                };

                if (!posix.S.ISREG(stat_.mode)) {
                    if (posix.S.ISLNK(stat_.mode)) {
                        var mode_: Mode = C.darwin.COPYFILE_ACL | C.darwin.COPYFILE_DATA | C.darwin.COPYFILE_NOFOLLOW_SRC;
                        if (mode.shouldntOverwrite()) {
                            mode_ |= C.darwin.COPYFILE_EXCL;
                        }

                        return ret.errnoSysP(C.copyfile(src, dest, null, mode_), .copyfile, src) orelse ret.success;
                    }
                    @memcpy(this.sync_error_buf[0..src.len], src);
                    return Maybe(Return.CopyFile){ .err = .{
                        .errno = @intFromEnum(C.SystemErrno.ENOTSUP),
                        .path = this.sync_error_buf[0..src.len],
                        .syscall = .copyfile,
                    } };
                }

                // 64 KB is about the break-even point for clonefile() to be worth it
                // at least, on an M1 with an NVME SSD.
                if (stat_.size > 128 * 1024) {
                    if (!mode.shouldntOverwrite()) {
                        // clonefile() will fail if it already exists
                        _ = Syscall.unlink(dest);
                    }

                    if (ret.errnoSysP(C.clonefile(src, dest, 0), .clonefile, src) == null) {
                        _ = C.chmod(dest, stat_.mode);
                        return ret.success;
                    }
                } else {
                    const src_fd = switch (Syscall.open(src, bun.O.RDONLY, 0o644)) {
                        .result => |result| result,
                        .err => |err| {
                            @memcpy(this.sync_error_buf[0..src.len], src);
                            return .{ .err = err.withPath(this.sync_error_buf[0..src.len]) };
                        },
                    };
                    defer {
                        _ = Syscall.close(src_fd);
                    }

                    var flags: Mode = bun.O.CREAT | bun.O.WRONLY;
                    var wrote: usize = 0;
                    if (mode.shouldntOverwrite()) {
                        flags |= bun.O.EXCL;
                    }

                    const dest_fd = dest_fd: {
                        switch (Syscall.open(dest, flags, JSC.Node.default_permission)) {
                            .result => |result| break :dest_fd result,
                            .err => |err| {
                                if (err.getErrno() == .NOENT) {
                                    // Create the parent directory if it doesn't exist
                                    var len = dest.len;
                                    while (len > 0 and dest[len - 1] != std.fs.path.sep) {
                                        len -= 1;
                                    }
                                    const mkdirResult = this.mkdirRecursive(.{
                                        .path = PathLike{ .string = PathString.init(dest[0..len]) },
                                        .recursive = true,
                                    }, .sync);
                                    if (mkdirResult == .err) {
                                        return Maybe(Return.CopyFile){ .err = mkdirResult.err };
                                    }

                                    switch (Syscall.open(dest, flags, JSC.Node.default_permission)) {
                                        .result => |result| break :dest_fd result,
                                        .err => {},
                                    }
                                }

                                @memcpy(this.sync_error_buf[0..dest.len], dest);
                                return Maybe(Return.CopyFile){ .err = err.withPath(this.sync_error_buf[0..dest.len]) };
                            },
                        }
                    };
                    defer {
                        _ = std.c.ftruncate(dest_fd.int(), @as(std.c.off_t, @intCast(@as(u63, @truncate(wrote)))));
                        _ = C.fchmod(dest_fd.int(), stat_.mode);
                        _ = Syscall.close(dest_fd);
                    }

                    return copyFileUsingReadWriteLoop(src, dest, src_fd, dest_fd, @intCast(@max(stat_.size, 0)), &wrote);
                }
            }

            // we fallback to copyfile() when the file is > 128 KB and clonefile fails
            // clonefile() isn't supported on all devices
            // nor is it supported across devices
            var mode_: Mode = C.darwin.COPYFILE_ACL | C.darwin.COPYFILE_DATA | C.darwin.COPYFILE_NOFOLLOW_SRC;
            if (mode.shouldntOverwrite()) {
                mode_ |= C.darwin.COPYFILE_EXCL;
            }

            const first_try = ret.errnoSysP(C.copyfile(src, dest, null, mode_), .copyfile, src) orelse return ret.success;
            if (first_try == .err and first_try.err.errno == @intFromEnum(C.E.NOENT)) {
                bun.makePath(std.fs.cwd(), bun.path.dirname(dest, .auto)) catch {};
                return ret.errnoSysP(C.copyfile(src, dest, null, mode_), .copyfile, src) orelse ret.success;
            }
            return first_try;
        }

        if (Environment.isLinux) {
            // https://manpages.debian.org/testing/manpages-dev/ioctl_ficlone.2.en.html
            if (mode.isForceClone()) {
                return Maybe(Return.CopyFile).todo();
            }

            const src_fd = switch (Syscall.open(src, bun.O.RDONLY | bun.O.NOFOLLOW, 0o644)) {
                .result => |result| result,
                .err => |err| {
                    if (err.getErrno() == .LOOP) {
                        // ELOOP is returned when you open a symlink with NOFOLLOW.
                        // as in, it does not actually let you open it.
                        return Syscall.symlink(src, dest);
                    }

                    return .{ .err = err };
                },
            };
            defer {
                _ = Syscall.close(src_fd);
            }

            const stat_: linux.Stat = switch (Syscall.fstat(src_fd)) {
                .result => |result| result,
                .err => |err| return Maybe(Return.CopyFile){ .err = err.withFd(src_fd) },
            };

            if (!posix.S.ISREG(stat_.mode)) {
                return Maybe(Return.CopyFile){ .err = .{
                    .errno = @intFromEnum(C.SystemErrno.ENOTSUP),
                    .syscall = .copyfile,
                } };
            }

            var flags: Mode = bun.O.CREAT | bun.O.WRONLY;
            var wrote: usize = 0;
            if (mode.shouldntOverwrite()) {
                flags |= bun.O.EXCL;
            }

            const dest_fd = dest_fd: {
                switch (Syscall.open(dest, flags, JSC.Node.default_permission)) {
                    .result => |result| break :dest_fd result,
                    .err => |err| {
                        if (err.getErrno() == .NOENT) {
                            // Create the parent directory if it doesn't exist
                            var len = dest.len;
                            while (len > 0 and dest[len - 1] != std.fs.path.sep) {
                                len -= 1;
                            }
                            const mkdirResult = this.mkdirRecursive(.{
                                .path = PathLike{ .string = PathString.init(dest[0..len]) },
                                .recursive = true,
                            }, .sync);
                            if (mkdirResult == .err) {
                                return Maybe(Return.CopyFile){ .err = mkdirResult.err };
                            }

                            switch (Syscall.open(dest, flags, JSC.Node.default_permission)) {
                                .result => |result| break :dest_fd result,
                                .err => {},
                            }
                        }

                        @memcpy(this.sync_error_buf[0..dest.len], dest);
                        return Maybe(Return.CopyFile){ .err = err.withPath(this.sync_error_buf[0..dest.len]) };
                    },
                }
            };

            var size: usize = @intCast(@max(stat_.size, 0));

            if (posix.S.ISREG(stat_.mode) and bun.can_use_ioctl_ficlone()) {
                const rc = bun.C.linux.ioctl_ficlone(dest_fd, src_fd);
                if (rc == 0) {
                    _ = C.fchmod(dest_fd.cast(), stat_.mode);
                    _ = Syscall.close(dest_fd);
                    return ret.success;
                }

                bun.disable_ioctl_ficlone();
            }

            defer {
                _ = linux.ftruncate(dest_fd.cast(), @as(i64, @intCast(@as(u63, @truncate(wrote)))));
                _ = linux.fchmod(dest_fd.cast(), stat_.mode);
                _ = Syscall.close(dest_fd);
            }

            var off_in_copy = @as(i64, @bitCast(@as(u64, 0)));
            var off_out_copy = @as(i64, @bitCast(@as(u64, 0)));

            if (!bun.canUseCopyFileRangeSyscall()) {
                return copyFileUsingSendfileOnLinuxWithReadWriteFallback(src, dest, src_fd, dest_fd, size, &wrote);
            }

            if (size == 0) {
                // copy until EOF
                while (true) {
                    // Linux Kernel 5.3 or later
                    // Not supported in gVisor
                    const written = linux.copy_file_range(src_fd.cast(), &off_in_copy, dest_fd.cast(), &off_out_copy, std.mem.page_size, 0);
                    if (ret.errnoSysP(written, .copy_file_range, dest)) |err| {
                        return switch (err.getErrno()) {
                            inline .XDEV, .NOSYS => |errno| brk: {
                                if (comptime errno == .NOSYS) {
                                    bun.disableCopyFileRangeSyscall();
                                }
                                break :brk copyFileUsingSendfileOnLinuxWithReadWriteFallback(src, dest, src_fd, dest_fd, size, &wrote);
                            },
                            else => return err,
                        };
                    }
                    // wrote zero bytes means EOF
                    if (written == 0) break;
                    wrote +|= written;
                }
            } else {
                while (size > 0) {
                    // Linux Kernel 5.3 or later
                    // Not supported in gVisor
                    const written = linux.copy_file_range(src_fd.cast(), &off_in_copy, dest_fd.cast(), &off_out_copy, size, 0);
                    if (ret.errnoSysP(written, .copy_file_range, dest)) |err| {
                        return switch (err.getErrno()) {
                            inline .XDEV, .NOSYS => |errno| brk: {
                                if (comptime errno == .NOSYS) {
                                    bun.disableCopyFileRangeSyscall();
                                }
                                break :brk copyFileUsingSendfileOnLinuxWithReadWriteFallback(src, dest, src_fd, dest_fd, size, &wrote);
                            },
                            else => return err,
                        };
                    }
                    // wrote zero bytes means EOF
                    if (written == 0) break;
                    wrote +|= written;
                    size -|= written;
                }
            }

            return ret.success;
        }

        if (Environment.isWindows) {
            const src_enoent_maybe = ret.initErrWithP(.ENOENT, .copyfile, this.osPathIntoSyncErrorBuf(src));
            const dst_enoent_maybe = ret.initErrWithP(.ENOENT, .copyfile, this.osPathIntoSyncErrorBuf(dest));
            const stat_ = reuse_stat orelse switch (windows.GetFileAttributesW(src)) {
                windows.INVALID_FILE_ATTRIBUTES => return ret.errnoSysP(0, .copyfile, this.osPathIntoSyncErrorBuf(src)).?,
                else => |result| result,
            };
            if (stat_ & windows.FILE_ATTRIBUTE_REPARSE_POINT == 0) {
                if (windows.CopyFileW(src, dest, @intFromBool(mode.shouldntOverwrite())) == 0) {
                    var err = windows.GetLastError();
                    var errpath: bun.OSPathSliceZ = undefined;
                    switch (err) {
                        .FILE_EXISTS, .ALREADY_EXISTS => errpath = dest,
                        .PATH_NOT_FOUND => {
                            bun.makePathW(std.fs.cwd(), bun.path.dirnameW(dest)) catch {};
                            const second_try = windows.CopyFileW(src, dest, @intFromBool(mode.shouldntOverwrite()));
                            if (second_try > 0) return ret.success;
                            err = windows.GetLastError();
                            errpath = dest;
                            if (err == .FILE_EXISTS or err == .ALREADY_EXISTS) errpath = src;
                        },
                        else => errpath = src,
                    }
                    const result = ret.errnoSysP(0, .copyfile, this.osPathIntoSyncErrorBuf(dest)) orelse src_enoent_maybe;
                    return shouldIgnoreEbusy(args.src, args.dest, result);
                }
                return ret.success;
            } else {
                const handle = switch (bun.sys.openatWindows(bun.invalid_fd, src, bun.O.RDONLY)) {
                    .err => |err| return .{ .err = err },
                    .result => |src_fd| src_fd,
                };
                const wbuf = bun.OSPathBufferPool.get();
                defer bun.OSPathBufferPool.put(wbuf);
                const len = bun.windows.GetFinalPathNameByHandleW(handle.cast(), wbuf, wbuf.len, 0);
                if (len == 0) {
                    return ret.errnoSysP(0, .copyfile, this.osPathIntoSyncErrorBuf(dest)) orelse dst_enoent_maybe;
                }
                const flags = if (stat_ & windows.FILE_ATTRIBUTE_DIRECTORY != 0)
                    std.os.windows.SYMBOLIC_LINK_FLAG_DIRECTORY
                else
                    0;
                if (windows.CreateSymbolicLinkW(dest, wbuf[0..len :0], flags) == 0) {
                    return ret.errnoSysP(0, .copyfile, this.osPathIntoSyncErrorBuf(dest)) orelse dst_enoent_maybe;
                }
                return ret.success;
            }
        }

        return ret.todo();
    }

    /// Directory scanning + clonefile will block this thread, then each individual file copy (what the sync version
    /// calls "_copySingleFileSync") will be dispatched as a separate task.
    pub fn cpAsync(this: *NodeFS, task: *AsyncCpTask) void {
        AsyncCpTask.cpAsync(this, task);
    }

    // returns boolean `should_continue`
    fn _cpAsyncDirectory(
        this: *NodeFS,
        args: Arguments.Cp.Flags,
        task: *AsyncCpTask,
        src_buf: *bun.OSPathBuffer,
        src_dir_len: PathString.PathInt,
        dest_buf: *bun.OSPathBuffer,
        dest_dir_len: PathString.PathInt,
    ) bool {
        return AsyncCpTask._cpAsyncDirectory(this, args, task, src_buf, src_dir_len, dest_buf, dest_dir_len);
    }
};

pub export fn Bun__mkdirp(globalThis: *JSC.JSGlobalObject, path: [*:0]const u8) bool {
    return globalThis.bunVM().nodeFS().mkdirRecursive(
        Arguments.Mkdir{
            .path = PathLike{ .string = PathString.init(bun.span(path)) },
            .recursive = true,
        },
        .sync,
    ) != .err;
}

comptime {
    if (!JSC.is_bindgen)
        _ = Bun__mkdirp;
}
