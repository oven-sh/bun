// This file contains the underlying implementation for sync & async functions
// for interacting with the filesystem from JavaScript.
// The top-level functions assume the arguments are already validated
const std = @import("std");
const bun = @import("root").bun;
const strings = bun.strings;
const string = bun.string;
const AsyncIO = @import("root").bun.AsyncIO;
const JSC = @import("root").bun.JSC;
const PathString = JSC.PathString;
const Environment = bun.Environment;
const C = bun.C;
const Flavor = JSC.Node.Flavor;
const system = std.os.system;
const Maybe = JSC.Maybe;
const Encoding = JSC.Node.Encoding;
const Syscall = bun.sys;
const Constants = @import("./node_fs_constant.zig").Constants;
const builtin = @import("builtin");
const os = @import("std").os;
const darwin = os.darwin;
const linux = os.linux;
const PathOrBuffer = JSC.Node.PathOrBuffer;
const PathLike = JSC.Node.PathLike;
const PathOrFileDescriptor = JSC.Node.PathOrFileDescriptor;
const FileDescriptor = bun.FileDescriptor;
const DirIterator = @import("./dir_iterator.zig");
const Path = @import("../../resolver/resolve_path.zig");
const FileSystem = @import("../../fs.zig").FileSystem;
const StringOrBuffer = JSC.Node.StringOrBuffer;
const ArgumentsSlice = JSC.Node.ArgumentsSlice;
const TimeLike = JSC.Node.TimeLike;
const Mode = bun.Mode;
const E = C.E;
const uid_t = if (Environment.isPosix) std.os.uid_t else i32;
const gid_t = if (Environment.isPosix) std.os.gid_t else i32;
/// u63 to allow one null bit
const ReadPosition = i64;

const Stats = JSC.Node.Stats;
const Dirent = JSC.Node.Dirent;

pub const FlavoredIO = struct {
    io: *AsyncIO,
};

pub const default_permission = if (Environment.isPosix)
    Syscall.S.IRUSR |
        Syscall.S.IWUSR |
        Syscall.S.IRGRP |
        Syscall.S.IWGRP |
        Syscall.S.IROTH |
        Syscall.S.IWOTH
else
    // TODO:
    0;

const ArrayBuffer = JSC.MarkedArrayBuffer;
const Buffer = JSC.Buffer;
const FileSystemFlags = JSC.Node.FileSystemFlags;

pub const AsyncReaddirTask = struct {
    promise: JSC.JSPromise.Strong,
    args: Arguments.Readdir,
    globalObject: *JSC.JSGlobalObject,
    task: JSC.WorkPoolTask = .{ .callback = &workPoolCallback },
    result: JSC.Maybe(Return.Readdir),
    ref: JSC.PollRef = .{},
    arena: bun.ArenaAllocator,
    tracker: JSC.AsyncTaskTracker,

    pub fn create(globalObject: *JSC.JSGlobalObject, readdir_args: Arguments.Readdir, vm: *JSC.VirtualMachine, arena: bun.ArenaAllocator) JSC.JSValue {
        var task = bun.default_allocator.create(AsyncReaddirTask) catch @panic("out of memory");
        task.* = AsyncReaddirTask{
            .promise = JSC.JSPromise.Strong.init(globalObject),
            .args = readdir_args,
            .result = undefined,
            .globalObject = globalObject,
            .arena = arena,
            .tracker = JSC.AsyncTaskTracker.init(vm),
        };
        task.ref.ref(vm);
        task.args.path.toThreadSafe();
        task.tracker.didSchedule(globalObject);
        JSC.WorkPool.schedule(&task.task);

        return task.promise.value();
    }

    fn workPoolCallback(task: *JSC.WorkPoolTask) void {
        var this: *AsyncReaddirTask = @fieldParentPtr(AsyncReaddirTask, "task", task);

        var node_fs = NodeFS{};
        this.result = node_fs.readdir(this.args, .promise);

        this.globalObject.bunVMConcurrently().eventLoop().enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(this, runFromJSThread));
    }

    fn runFromJSThread(this: *AsyncReaddirTask) void {
        var globalObject = this.globalObject;

        var success = @as(JSC.Maybe(Return.Readdir).Tag, this.result) == .result;
        const result = switch (this.result) {
            .err => |err| err.toJSC(globalObject),
            .result => |res| brk: {
                var exceptionref: JSC.C.JSValueRef = null;
                const out = JSC.JSValue.c(JSC.To.JS.withType(Return.Readdir, res, globalObject, &exceptionref));
                const exception = JSC.JSValue.c(exceptionref);
                if (exception != .zero) {
                    success = false;
                    break :brk exception;
                }

                break :brk out;
            },
        };
        var promise_value = this.promise.value();
        var promise = this.promise.get();
        promise_value.ensureStillAlive();

        const tracker = this.tracker;
        this.deinit();

        tracker.willDispatch(globalObject);
        defer tracker.didDispatch(globalObject);
        switch (success) {
            false => {
                promise.reject(globalObject, result);
            },
            true => {
                promise.resolve(globalObject, result);
            },
        }
    }

    pub fn deinit(this: *AsyncReaddirTask) void {
        this.ref.unref(this.globalObject.bunVM());
        this.args.deinitAndUnprotect();
        this.promise.strong.deinit();
        this.arena.deinit();
        bun.default_allocator.destroy(this);
    }
};

pub const AsyncStatTask = struct {
    promise: JSC.JSPromise.Strong,
    args: Arguments.Stat,
    globalObject: *JSC.JSGlobalObject,
    task: JSC.WorkPoolTask = .{ .callback = &workPoolCallback },
    result: JSC.Maybe(Return.Stat),
    ref: JSC.PollRef = .{},
    is_lstat: bool = false,
    arena: bun.ArenaAllocator,
    tracker: JSC.AsyncTaskTracker,

    pub fn create(
        globalObject: *JSC.JSGlobalObject,
        readdir_args: Arguments.Stat,
        vm: *JSC.VirtualMachine,
        is_lstat: bool,
        arena: bun.ArenaAllocator,
    ) JSC.JSValue {
        var task = bun.default_allocator.create(AsyncStatTask) catch @panic("out of memory");
        task.* = AsyncStatTask{
            .promise = JSC.JSPromise.Strong.init(globalObject),
            .args = readdir_args,
            .result = undefined,
            .globalObject = globalObject,
            .is_lstat = is_lstat,
            .tracker = JSC.AsyncTaskTracker.init(vm),
            .arena = arena,
        };
        task.ref.ref(vm);
        task.args.path.toThreadSafe();
        task.tracker.didSchedule(globalObject);

        JSC.WorkPool.schedule(&task.task);

        return task.promise.value();
    }

    fn workPoolCallback(task: *JSC.WorkPoolTask) void {
        var this: *AsyncStatTask = @fieldParentPtr(AsyncStatTask, "task", task);

        var node_fs = NodeFS{};
        this.result = if (this.is_lstat)
            node_fs.lstat(this.args, .promise)
        else
            node_fs.stat(this.args, .promise);

        this.globalObject.bunVMConcurrently().eventLoop().enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(this, runFromJSThread));
    }

    fn runFromJSThread(this: *AsyncStatTask) void {
        var globalObject = this.globalObject;
        var success = @as(JSC.Maybe(Return.Lstat).Tag, this.result) == .result;
        const result = switch (this.result) {
            .err => |err| err.toJSC(globalObject),
            .result => |res| brk: {
                var exceptionref: JSC.C.JSValueRef = null;
                const out = JSC.JSValue.c(JSC.To.JS.withType(Return.Lstat, res, globalObject, &exceptionref));
                const exception = JSC.JSValue.c(exceptionref);
                if (exception != .zero) {
                    success = false;
                    break :brk exception;
                }

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

    pub fn deinit(this: *AsyncStatTask) void {
        this.ref.unref(this.globalObject.bunVM());
        this.args.deinitAndUnprotect();
        this.promise.strong.deinit();
        this.arena.deinit();
        bun.default_allocator.destroy(this);
    }
};

pub const AsyncRealpathTask = struct {
    promise: JSC.JSPromise.Strong,
    args: Arguments.Realpath,
    globalObject: *JSC.JSGlobalObject,
    task: JSC.WorkPoolTask = .{ .callback = &workPoolCallback },
    result: JSC.Maybe(Return.Realpath),
    ref: JSC.PollRef = .{},
    arena: bun.ArenaAllocator,
    tracker: JSC.AsyncTaskTracker,

    pub fn create(
        globalObject: *JSC.JSGlobalObject,
        args: Arguments.Realpath,
        vm: *JSC.VirtualMachine,
        arena: bun.ArenaAllocator,
    ) JSC.JSValue {
        var task = bun.default_allocator.create(AsyncRealpathTask) catch @panic("out of memory");
        task.* = AsyncRealpathTask{
            .promise = JSC.JSPromise.Strong.init(globalObject),
            .args = args,
            .result = undefined,
            .globalObject = globalObject,
            .arena = arena,
            .tracker = JSC.AsyncTaskTracker.init(vm),
        };
        task.ref.ref(vm);
        task.args.path.toThreadSafe();
        task.tracker.didSchedule(globalObject);
        JSC.WorkPool.schedule(&task.task);

        return task.promise.value();
    }

    fn workPoolCallback(task: *JSC.WorkPoolTask) void {
        var this: *AsyncRealpathTask = @fieldParentPtr(AsyncRealpathTask, "task", task);

        var node_fs = NodeFS{};
        this.result = node_fs.realpath(this.args, .promise);

        if (this.result == .err) {
            this.result.err.path = bun.default_allocator.dupe(u8, this.result.err.path) catch "";
        }

        this.globalObject.bunVMConcurrently().eventLoop().enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(this, runFromJSThread));
    }

    fn runFromJSThread(this: *AsyncRealpathTask) void {
        var globalObject = this.globalObject;
        var success = @as(JSC.Maybe(Return.Realpath).Tag, this.result) == .result;
        const result = switch (this.result) {
            .err => |err| err.toJSC(globalObject),
            .result => |res| brk: {
                var exceptionref: JSC.C.JSValueRef = null;
                const out = JSC.JSValue.c(JSC.To.JS.withType(Return.Realpath, res, globalObject, &exceptionref));
                const exception = JSC.JSValue.c(exceptionref);
                if (exception != .zero) {
                    success = false;
                    break :brk exception;
                }

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

    pub fn deinit(this: *AsyncRealpathTask) void {
        if (this.result == .err) {
            bun.default_allocator.free(this.result.err.path);
        }

        this.ref.unref(this.globalObject.bunVM());
        this.args.deinitAndUnprotect();
        this.promise.strong.deinit();
        this.arena.deinit();
        bun.default_allocator.destroy(this);
    }
};

pub const AsyncReadFileTask = struct {
    promise: JSC.JSPromise.Strong,
    args: Arguments.ReadFile,
    globalObject: *JSC.JSGlobalObject,
    task: JSC.WorkPoolTask = .{ .callback = &workPoolCallback },
    result: JSC.Maybe(Return.ReadFile),
    ref: JSC.PollRef = .{},
    arena: bun.ArenaAllocator,
    tracker: JSC.AsyncTaskTracker,

    pub fn create(
        globalObject: *JSC.JSGlobalObject,
        args: Arguments.ReadFile,
        vm: *JSC.VirtualMachine,
        arena: bun.ArenaAllocator,
    ) JSC.JSValue {
        var task = bun.default_allocator.create(AsyncReadFileTask) catch @panic("out of memory");
        task.* = AsyncReadFileTask{
            .promise = JSC.JSPromise.Strong.init(globalObject),
            .args = args,
            .result = undefined,
            .globalObject = globalObject,
            .arena = arena,
            .tracker = JSC.AsyncTaskTracker.init(vm),
        };
        task.ref.ref(vm);
        task.args.path.toThreadSafe();
        task.tracker.didSchedule(globalObject);
        JSC.WorkPool.schedule(&task.task);

        return task.promise.value();
    }

    fn workPoolCallback(task: *JSC.WorkPoolTask) void {
        var this: *AsyncReadFileTask = @fieldParentPtr(AsyncReadFileTask, "task", task);

        var node_fs = NodeFS{};
        this.result = node_fs.readFile(this.args, .promise);

        this.globalObject.bunVMConcurrently().eventLoop().enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(this, runFromJSThread));
    }

    fn runFromJSThread(this: *AsyncReadFileTask) void {
        var globalObject = this.globalObject;

        var success = @as(JSC.Maybe(Return.ReadFile).Tag, this.result) == .result;
        const result = switch (this.result) {
            .err => |err| err.toJSC(globalObject),
            .result => |res| brk: {
                var exceptionref: JSC.C.JSValueRef = null;
                const out = JSC.JSValue.c(JSC.To.JS.withType(Return.ReadFile, res, globalObject, &exceptionref));
                const exception = JSC.JSValue.c(exceptionref);
                if (exception != .zero) {
                    success = false;
                    break :brk exception;
                }

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

    pub fn deinit(this: *AsyncReadFileTask) void {
        this.ref.unref(this.globalObject.bunVM());
        this.args.deinitAndUnprotect();
        this.promise.strong.deinit();
        this.arena.deinit();
        bun.default_allocator.destroy(this);
    }
};

pub const AsyncCopyFileTask = struct {
    promise: JSC.JSPromise.Strong,
    args: Arguments.CopyFile,
    globalObject: *JSC.JSGlobalObject,
    task: JSC.WorkPoolTask = .{ .callback = &workPoolCallback },
    result: JSC.Maybe(Return.CopyFile),
    ref: JSC.PollRef = .{},
    arena: bun.ArenaAllocator,
    tracker: JSC.AsyncTaskTracker,

    pub fn create(
        globalObject: *JSC.JSGlobalObject,
        copyfile_args: Arguments.CopyFile,
        vm: *JSC.VirtualMachine,
        arena: bun.ArenaAllocator,
    ) JSC.JSValue {
        var task = bun.default_allocator.create(AsyncCopyFileTask) catch @panic("out of memory");
        task.* = AsyncCopyFileTask{
            .promise = JSC.JSPromise.Strong.init(globalObject),
            .args = copyfile_args,
            .result = undefined,
            .globalObject = globalObject,
            .tracker = JSC.AsyncTaskTracker.init(vm),
            .arena = arena,
        };
        task.ref.ref(vm);
        task.args.src.toThreadSafe();
        task.args.dest.toThreadSafe();
        task.tracker.didSchedule(globalObject);

        JSC.WorkPool.schedule(&task.task);

        return task.promise.value();
    }

    fn workPoolCallback(task: *JSC.WorkPoolTask) void {
        var this: *AsyncCopyFileTask = @fieldParentPtr(AsyncCopyFileTask, "task", task);

        var node_fs = NodeFS{};
        this.result = node_fs.copyFile(this.args, .promise);

        this.globalObject.bunVMConcurrently().eventLoop().enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(this, runFromJSThread));
    }

    fn runFromJSThread(this: *AsyncCopyFileTask) void {
        var globalObject = this.globalObject;
        var success = @as(JSC.Maybe(Return.CopyFile).Tag, this.result) == .result;
        const result = switch (this.result) {
            .err => |err| err.toJSC(globalObject),
            .result => |res| brk: {
                var exceptionref: JSC.C.JSValueRef = null;
                const out = JSC.JSValue.c(JSC.To.JS.withType(Return.CopyFile, res, globalObject, &exceptionref));
                const exception = JSC.JSValue.c(exceptionref);
                if (exception != .zero) {
                    success = false;
                    break :brk exception;
                }

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

    pub fn deinit(this: *AsyncCopyFileTask) void {
        this.ref.unref(this.globalObject.bunVM());
        this.args.deinit();
        this.promise.strong.deinit();
        this.arena.deinit();
        bun.default_allocator.destroy(this);
    }
};

pub const AsyncCpTask = struct {
    promise: JSC.JSPromise.Strong,
    args: Arguments.Cp,
    globalObject: *JSC.JSGlobalObject,
    task: JSC.WorkPoolTask = .{ .callback = &workPoolCallback },
    result: JSC.Maybe(Return.Cp),
    ref: JSC.PollRef = .{},
    arena: bun.ArenaAllocator,
    tracker: JSC.AsyncTaskTracker,
    has_result: bool = false,
    subtask_count: usize,
    subtasks_completed: usize,

    pub fn create(
        globalObject: *JSC.JSGlobalObject,
        cp_args: Arguments.Cp,
        vm: *JSC.VirtualMachine,
        arena: bun.ArenaAllocator,
    ) JSC.JSValue {
        var task = bun.default_allocator.create(AsyncCpTask) catch @panic("out of memory");
        task.* = AsyncCpTask{
            .promise = JSC.JSPromise.Strong.init(globalObject),
            .args = cp_args,
            .has_result = false,
            .result = undefined,
            .globalObject = globalObject,
            .tracker = JSC.AsyncTaskTracker.init(vm),
            .arena = arena,
            .subtask_count = 0,
            .subtasks_completed = 0,
        };
        task.ref.ref(vm);
        task.args.src.toThreadSafe();
        task.args.dest.toThreadSafe();
        task.tracker.didSchedule(globalObject);

        JSC.WorkPool.schedule(&task.task);

        return task.promise.value();
    }

    fn workPoolCallback(task: *JSC.WorkPoolTask) void {
        var this: *AsyncCpTask = @fieldParentPtr(AsyncCpTask, "task", task);

        var node_fs = NodeFS{};
        node_fs.cpAsync(this);
    }

    fn finishConcurrently(this: *AsyncCpTask, result: Maybe(Return.Cp)) void {
        // TODO: i am not confident this is correct
        if (@atomicLoad(bool, &this.has_result, .Acquire)) {
            return;
        }
        @atomicStore(bool, &this.has_result, true, .Release);

        this.result = result;
        this.globalObject.bunVMConcurrently().eventLoop().enqueueTaskConcurrent(JSC.ConcurrentTask.fromCallback(this, runFromJSThread));
    }

    fn runFromJSThread(this: *AsyncCpTask) void {
        var globalObject = this.globalObject;
        var success = @as(JSC.Maybe(Return.Cp).Tag, this.result) == .result;
        const result = switch (this.result) {
            .err => |err| err.toJSC(globalObject),
            .result => |res| brk: {
                var exceptionref: JSC.C.JSValueRef = null;
                const out = JSC.JSValue.c(JSC.To.JS.withType(Return.Cp, res, globalObject, &exceptionref));
                const exception = JSC.JSValue.c(exceptionref);
                if (exception != .zero) {
                    success = false;
                    break :brk exception;
                }

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

    pub fn deinit(this: *AsyncCpTask) void {
        this.ref.unref(this.globalObject.bunVM());
        this.args.deinit();
        this.promise.strong.deinit();
        this.arena.deinit();
        bun.default_allocator.destroy(this);
    }
};

/// This task is used by `AsyncCpTask/fs.promises.cp` to copy a single file.
/// When clonefile cannot be used, this task is started once per file.
pub const AsyncCpSingleFileTask = struct {
    cp_task: *AsyncCpTask,
    src: [:0]const u8,
    dest: [:0]const u8,
    task: JSC.WorkPoolTask = .{ .callback = &workPoolCallback },

    pub fn create(
        parent: *AsyncCpTask,
        src: [:0]const u8,
        dest: [:0]const u8,
    ) void {
        var task = bun.default_allocator.create(AsyncCpSingleFileTask) catch @panic("out of memory");
        task.* = AsyncCpSingleFileTask{
            .cp_task = parent,
            .src = src,
            .dest = dest,
        };

        JSC.WorkPool.schedule(&task.task);
    }

    fn workPoolCallback(task: *JSC.WorkPoolTask) void {
        var this: *AsyncCpSingleFileTask = @fieldParentPtr(AsyncCpSingleFileTask, "task", task);

        // TODO: error strings on node_fs will die
        var node_fs = NodeFS{};

        const args = this.cp_task.args;
        const result = node_fs._copySingleFileSync(
            this.src,
            this.dest,
            @enumFromInt((if (args.flags.errorOnExist or !args.flags.force) Constants.COPYFILE_EXCL else @as(u8, 0))),
            null,
        );

        brk: {
            switch (result) {
                .err => |err| {
                    if (err.errno == @intFromEnum(os.E.EXIST) and !args.flags.errorOnExist) {
                        break :brk;
                    }
                    this.cp_task.finishConcurrently(result);
                    this.deinit();
                    return;
                },
                .result => {},
            }
        }

        // TODO: the atomics are not right here
        _ = @atomicRmw(usize, &this.cp_task.subtasks_completed, .Add, 1, .Monotonic);

        if (this.cp_task.subtasks_completed == this.cp_task.subtask_count) {
            this.cp_task.finishConcurrently(Maybe(Return.Cp).success);
        }

        this.deinit();
    }

    pub fn deinit(this: *AsyncCpSingleFileTask) void {
        bun.default_allocator.destroy(this);

        // There is only one path buffer for both paths. 2 extra bytes are the nulls at the end of each
        bun.default_allocator.free(this.src.ptr[0 .. this.src.len + this.dest.len + 2]);
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

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Rename {
            const old_path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "oldPath must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            const new_path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "newPath must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            return Rename{ .old_path = old_path, .new_path = new_path };
        }
    };

    pub const Truncate = struct {
        /// Passing a file descriptor is deprecated and may result in an error being thrown in the future.
        path: PathOrFileDescriptor,
        len: JSC.WebCore.Blob.SizeType = 0,

        pub fn deinit(this: @This()) void {
            this.path.deinit();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Truncate {
            const path = PathOrFileDescriptor.fromJS(ctx, arguments, arguments.arena.allocator(), exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
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

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Writev {
            const fd_value = arguments.nextEat() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            const fd = JSC.Node.fileDescriptorFromJS(ctx, fd_value, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            const buffers = JSC.Node.VectorArrayBuffer.fromJS(
                ctx,
                arguments.protectEatNext() orelse {
                    JSC.throwInvalidArguments("Expected an ArrayBufferView[]", .{}, ctx, exception);
                    return null;
                },
                exception,
                arguments.arena.allocator(),
            ) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "buffers must be an array of TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            var position: ?u52 = null;

            if (arguments.nextEat()) |pos_value| {
                if (!pos_value.isUndefinedOrNull()) {
                    if (pos_value.isNumber()) {
                        position = pos_value.to(u52);
                    } else {
                        JSC.throwInvalidArguments(
                            "position must be a number",
                            .{},
                            ctx,
                            exception,
                        );
                        return null;
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

        pub fn deinit(_: *const @This()) void {}

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Readv {
            const fd_value = arguments.nextEat() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            const fd = JSC.Node.fileDescriptorFromJS(ctx, fd_value, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            const buffers = JSC.Node.VectorArrayBuffer.fromJS(
                ctx,
                arguments.protectEatNext() orelse {
                    JSC.throwInvalidArguments("Expected an ArrayBufferView[]", .{}, ctx, exception);
                    return null;
                },
                exception,
                arguments.arena.allocator(),
            ) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "buffers must be an array of TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            var position: ?u52 = null;

            if (arguments.nextEat()) |pos_value| {
                if (!pos_value.isUndefinedOrNull()) {
                    if (pos_value.isNumber()) {
                        position = pos_value.to(u52);
                    } else {
                        JSC.throwInvalidArguments(
                            "position must be a number",
                            .{},
                            ctx,
                            exception,
                        );
                        return null;
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

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?FTruncate {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            arguments.eat();

            if (exception.* != null) return null;

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

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Chown {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            const uid: uid_t = brk: {
                const uid_value = arguments.next() orelse break :brk {
                    if (exception.* == null) {
                        JSC.throwInvalidArguments(
                            "uid is required",
                            .{},
                            ctx,
                            exception,
                        );
                    }
                    return null;
                };

                arguments.eat();
                break :brk @as(uid_t, @intCast(uid_value.toInt32()));
            };

            const gid: gid_t = brk: {
                const gid_value = arguments.next() orelse break :brk {
                    if (exception.* == null) {
                        JSC.throwInvalidArguments(
                            "gid is required",
                            .{},
                            ctx,
                            exception,
                        );
                    }
                    return null;
                };

                arguments.eat();
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

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Fchown {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const uid: uid_t = brk: {
                const uid_value = arguments.next() orelse break :brk {
                    if (exception.* == null) {
                        JSC.throwInvalidArguments(
                            "uid is required",
                            .{},
                            ctx,
                            exception,
                        );
                    }
                    return null;
                };

                arguments.eat();
                break :brk @as(uid_t, @intCast(uid_value.toInt32()));
            };

            const gid: gid_t = brk: {
                const gid_value = arguments.next() orelse break :brk {
                    if (exception.* == null) {
                        JSC.throwInvalidArguments(
                            "gid is required",
                            .{},
                            ctx,
                            exception,
                        );
                    }
                    return null;
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

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Lutimes {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            const atime = JSC.Node.timeLikeFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "atime is required",
                        .{},
                        ctx,
                        exception,
                    );
                }

                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "atime must be a number or a Date",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            arguments.eat();

            const mtime = JSC.Node.timeLikeFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mtime is required",
                        .{},
                        ctx,
                        exception,
                    );
                }

                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mtime must be a number or a Date",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
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

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Chmod {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            const mode: Mode = JSC.Node.modeFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mode is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mode must be a string or integer",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            arguments.eat();

            return Chmod{ .path = path, .mode = mode };
        }
    };

    pub const FChmod = struct {
        fd: FileDescriptor,
        mode: Mode = 0x777,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?FChmod {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;
            arguments.eat();

            const mode: Mode = JSC.Node.modeFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mode is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mode must be a string or integer",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
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

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Stat {
            const path = PathLike.fromJSWithAllocator(ctx, arguments, bun.default_allocator, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var throw_if_no_entry = true;

            const big_int = brk: {
                if (arguments.next()) |next_val| {
                    if (next_val.isObject()) {
                        if (next_val.isCallable(ctx.ptr().vm())) break :brk false;
                        arguments.eat();

                        if (next_val.getOptional(ctx.ptr(), "throwIfNoEntry", bool) catch {
                            path.deinit();
                            return null;
                        }) |throw_if_no_entry_val| {
                            throw_if_no_entry = throw_if_no_entry_val;
                        }

                        if (next_val.getOptional(ctx.ptr(), "bigint", bool) catch {
                            path.deinit();
                            return null;
                        }) |big_int| {
                            break :brk big_int;
                        }
                    }
                }
                break :brk false;
            };

            if (exception.* != null) return null;

            return Stat{ .path = path, .big_int = big_int, .throw_if_no_entry = throw_if_no_entry };
        }
    };

    pub const Fstat = struct {
        fd: FileDescriptor,
        big_int: bool = false,

        pub fn deinit(_: @This()) void {}

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Fstat {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "file descriptor must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const big_int = brk: {
                if (arguments.next()) |next_val| {
                    if (next_val.isObject()) {
                        if (next_val.isCallable(ctx.ptr().vm())) break :brk false;
                        arguments.eat();

                        if (next_val.getOptional(ctx.ptr(), "bigint", bool) catch false) |big_int| {
                            break :brk big_int;
                        }
                    }
                }
                break :brk false;
            };

            if (exception.* != null) return null;

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

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Link {
            const old_path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "oldPath must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const new_path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "newPath must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            return Link{ .old_path = old_path, .new_path = new_path };
        }
    };

    pub const Symlink = struct {
        old_path: PathLike,
        new_path: PathLike,

        pub fn deinit(this: Symlink) void {
            this.old_path.deinit();
            this.new_path.deinit();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Symlink {
            const old_path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "target must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const new_path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

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
                    if (comptime Environment.isWindows) {
                        bun.todo(@src(), {});
                    }
                    arguments.eat();
                }
            }

            return Symlink{ .old_path = old_path, .new_path = new_path };
        }
    };

    pub const Readlink = struct {
        path: PathLike,
        encoding: Encoding = Encoding.utf8,

        pub fn deinit(this: Readlink) void {
            this.path.deinit();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Readlink {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;
            var encoding = Encoding.utf8;
            if (arguments.next()) |val| {
                arguments.eat();

                switch (val.jsType()) {
                    JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject => {
                        encoding = Encoding.fromJS(val, ctx.ptr()) orelse Encoding.utf8;
                    },
                    else => {
                        if (val.isObject()) {
                            if (val.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding_| {
                                encoding = Encoding.fromJS(encoding_, ctx.ptr()) orelse Encoding.utf8;
                            }
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

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Realpath {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;
            var encoding = Encoding.utf8;
            if (arguments.next()) |val| {
                arguments.eat();

                switch (val.jsType()) {
                    JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject => {
                        encoding = Encoding.fromJS(val, ctx.ptr()) orelse Encoding.utf8;
                    },
                    else => {
                        if (val.isObject()) {
                            if (val.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding_| {
                                encoding = Encoding.fromJS(encoding_, ctx.ptr()) orelse Encoding.utf8;
                            }
                        }
                    },
                }
            }

            return Realpath{ .path = path, .encoding = encoding };
        }
    };

    pub const Unlink = struct {
        path: PathLike,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Unlink {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            return Unlink{
                .path = path,
            };
        }
    };

    pub const Rm = struct {
        path: PathLike,
        force: bool = false,
        max_retries: u32 = 0,
        recursive: bool = false,
        retry_delay: c_uint = 100,
    };

    pub const RmDir = struct {
        path: PathLike,

        force: bool = false,

        max_retries: u32 = 0,
        recursive: bool = false,
        retry_delay: c_uint = 100,

        pub fn deinit(this: RmDir) void {
            this.path.deinit();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?RmDir {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var recursive = false;
            var force = false;
            if (arguments.next()) |val| {
                arguments.eat();

                if (val.isObject()) {
                    if (val.getOptional(ctx.ptr(), "recursive", bool) catch {
                        path.deinit();
                        return null;
                    }) |boolean| {
                        recursive = boolean;
                    }

                    if (val.getOptional(ctx.ptr(), "force", bool) catch {
                        path.deinit();
                        return null;
                    }) |boolean| {
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
        /// @default
        mode: Mode = 0o777,

        pub fn deinit(this: Mkdir) void {
            this.path.deinit();
        }

        pub fn fromJS(ctx: *JSC.JSGlobalObject, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Mkdir {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var recursive = false;
            var mode: Mode = 0o777;

            if (arguments.next()) |val| {
                arguments.eat();

                if (val.isObject()) {
                    if (val.getOptional(ctx.ptr(), "recursive", bool) catch {
                        path.deinit();
                        return null;
                    }) |boolean| {
                        recursive = boolean;
                    }

                    if (val.getIfPropertyExists(ctx.ptr(), "mode")) |mode_| {
                        mode = JSC.Node.modeFromJS(ctx, mode_, exception) orelse mode;
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
        prefix: JSC.Node.SliceOrBuffer = .{ .buffer = .{ .buffer = JSC.ArrayBuffer.empty } },
        encoding: Encoding = Encoding.utf8,

        pub fn deinit(this: MkdirTemp) void {
            this.prefix.deinit();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?MkdirTemp {
            const prefix_value = arguments.next() orelse return MkdirTemp{};

            var prefix = JSC.Node.SliceOrBuffer.fromJS(ctx, arguments.arena.allocator(), prefix_value) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "prefix must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            arguments.eat();

            var encoding = Encoding.utf8;

            if (arguments.next()) |val| {
                arguments.eat();

                switch (val.jsType()) {
                    JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject => {
                        encoding = Encoding.fromJS(val, ctx.ptr()) orelse Encoding.utf8;
                    },
                    else => {
                        if (val.isObject()) {
                            if (val.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding_| {
                                encoding = Encoding.fromJS(encoding_, ctx.ptr()) orelse Encoding.utf8;
                            }
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

        pub fn deinit(this: Readdir) void {
            this.path.deinit();
        }

        pub fn deinitAndUnprotect(this: Readdir) void {
            this.path.deinitAndUnprotect();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Readdir {
            const path = PathLike.fromJSWithAllocator(ctx, arguments, bun.default_allocator, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var encoding = Encoding.utf8;
            var with_file_types = false;

            if (arguments.next()) |val| {
                arguments.eat();

                switch (val.jsType()) {
                    JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject => {
                        encoding = Encoding.fromJS(val, ctx.ptr()) orelse Encoding.utf8;
                    },
                    else => {
                        if (val.isObject()) {
                            if (val.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding_| {
                                encoding = Encoding.fromJS(encoding_, ctx.ptr()) orelse Encoding.utf8;
                            }

                            if (val.getOptional(ctx.ptr(), "withFileTypes", bool) catch {
                                path.deinit();
                                return null;
                            }) |with_file_types_| {
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
            };
        }
    };

    pub const Close = struct {
        fd: FileDescriptor,

        pub fn deinit(_: Close) void {}

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Close {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "File descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "fd must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            return Close{
                .fd = fd,
            };
        }
    };

    pub const Open = struct {
        path: PathLike,
        flags: FileSystemFlags = FileSystemFlags.r,
        mode: Mode = default_permission,

        pub fn deinit(this: Open) void {
            this.path.deinit();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Open {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var flags = FileSystemFlags.r;
            var mode: Mode = default_permission;

            if (arguments.next()) |val| {
                arguments.eat();

                if (val.isObject()) {
                    if (val.getTruthy(ctx.ptr(), "flags")) |flags_| {
                        flags = FileSystemFlags.fromJS(ctx, flags_, exception) orelse flags;
                    }

                    if (val.getTruthy(ctx.ptr(), "mode")) |mode_| {
                        mode = JSC.Node.modeFromJS(ctx, mode_, exception) orelse mode;
                    }
                } else if (!val.isEmpty()) {
                    if (!val.isUndefinedOrNull())
                        // error is handled below
                        flags = FileSystemFlags.fromJS(ctx, val, exception) orelse flags;

                    if (arguments.nextEat()) |next| {
                        mode = JSC.Node.modeFromJS(ctx, next, exception) orelse mode;
                    }
                }
            }

            if (exception.* != null) return null;

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

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Futimes {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "File descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "fd must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };
            arguments.eat();
            if (exception.* != null) return null;

            const atime = JSC.Node.timeLikeFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "atime is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "atime must be a number, Date or string",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const mtime = JSC.Node.timeLikeFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mtime is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "mtime must be a number, Date or string",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            return Futimes{
                .fd = fd,
                .atime = atime,
                .mtime = mtime,
            };
        }
    };

    pub const FSync = struct {
        fd: FileDescriptor,

        pub fn deinit(_: FSync) void {}

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?FSync {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "File descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "fd must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            return FSync{
                .fd = fd,
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

        pub fn deinit(_: Write) void {}

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Write {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "File descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "fd must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            arguments.eat();

            if (exception.* != null) return null;

            const buffer = StringOrBuffer.fromJS(ctx.ptr(), arguments.arena.allocator(), arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "data is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "data must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };
            if (exception.* != null) return null;

            var args = Write{
                .fd = fd,
                .buffer = buffer,
                .encoding = switch (buffer) {
                    .string => Encoding.utf8,
                    .buffer => Encoding.buffer,
                },
            };

            arguments.eat();

            // TODO: make this faster by passing argument count at comptime
            if (arguments.next()) |current_| {
                parse: {
                    var current = current_;
                    switch (buffer) {
                        // fs.write(fd, string[, position[, encoding]], callback)
                        .string => {
                            if (current.isNumber()) {
                                args.position = current.to(i52);
                                arguments.eat();
                                current = arguments.next() orelse break :parse;
                            }

                            if (current.isString()) {
                                args.encoding = Encoding.fromJS(current, ctx.ptr()) orelse Encoding.utf8;
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

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Read {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "File descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "fd must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            arguments.eat();

            if (exception.* != null) return null;

            const buffer = Buffer.fromJS(ctx.ptr(), arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "buffer is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "buffer must be a TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            arguments.eat();

            var args = Read{
                .fd = fd,
                .buffer = buffer,
            };

            if (arguments.next()) |current| {
                arguments.eat();
                if (current.isNumber() or current.isBigInt()) {
                    args.offset = current.to(u52);

                    if (arguments.remaining.len < 2) {
                        JSC.throwInvalidArguments(
                            "length and position are required",
                            .{},
                            ctx,
                            exception,
                        );

                        return null;
                    }
                    if (arguments.remaining[0].isNumber() or arguments.remaining[0].isBigInt())
                        args.length = arguments.remaining[0].to(u52);

                    if (args.length == 0) {
                        JSC.throwInvalidArguments(
                            "length must be greater than 0",
                            .{},
                            ctx,
                            exception,
                        );

                        return null;
                    }

                    if (arguments.remaining[1].isNumber() or arguments.remaining[1].isBigInt())
                        args.position = @as(ReadPosition, @intCast(arguments.remaining[1].to(i52)));

                    arguments.remaining = arguments.remaining[2..];
                } else if (current.isObject()) {
                    if (current.getTruthy(ctx.ptr(), "offset")) |num| {
                        if (num.isNumber() or num.isBigInt()) {
                            args.offset = num.to(u52);
                        }
                    }

                    if (current.getTruthy(ctx.ptr(), "length")) |num| {
                        if (num.isNumber() or num.isBigInt()) {
                            args.length = num.to(u52);
                        }
                    }

                    if (current.getTruthy(ctx.ptr(), "position")) |num| {
                        if (num.isNumber() or num.isBigInt()) {
                            args.position = num.to(i52);
                        }
                    }
                }
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

        flag: FileSystemFlags = FileSystemFlags.r,

        pub fn deinit(self: ReadFile) void {
            self.path.deinit();
        }

        pub fn deinitAndUnprotect(self: ReadFile) void {
            self.path.deinitAndUnprotect();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?ReadFile {
            const path = PathOrFileDescriptor.fromJS(ctx, arguments, bun.default_allocator, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or a file descriptor",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var encoding = Encoding.buffer;
            var flag = FileSystemFlags.r;

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    encoding = Encoding.fromJS(arg, ctx.ptr()) orelse {
                        if (exception.* == null) {
                            JSC.throwInvalidArguments(
                                "Invalid encoding",
                                .{},
                                ctx,
                                exception,
                            );
                        }
                        return null;
                    };
                } else if (arg.isObject()) {
                    if (arg.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding_| {
                        if (!encoding_.isUndefinedOrNull()) {
                            encoding = Encoding.fromJS(encoding_, ctx.ptr()) orelse {
                                if (exception.* == null) {
                                    JSC.throwInvalidArguments(
                                        "Invalid encoding",
                                        .{},
                                        ctx,
                                        exception,
                                    );
                                }
                                return null;
                            };
                        }
                    }

                    if (arg.getTruthy(ctx.ptr(), "flag")) |flag_| {
                        flag = FileSystemFlags.fromJS(ctx, flag_, exception) orelse {
                            if (exception.* == null) {
                                JSC.throwInvalidArguments(
                                    "Invalid flag",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }
                }
            }

            // Note: Signal is not implemented
            return ReadFile{
                .path = path,
                .encoding = encoding,
                .flag = flag,
            };
        }
    };

    pub const WriteFile = struct {
        encoding: Encoding = Encoding.utf8,
        flag: FileSystemFlags = FileSystemFlags.w,
        mode: Mode = 0o666,
        file: PathOrFileDescriptor,
        data: StringOrBuffer,
        dirfd: FileDescriptor,

        pub fn deinit(self: WriteFile) void {
            self.file.deinit();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?WriteFile {
            const file = PathOrFileDescriptor.fromJS(ctx, arguments, arguments.arena.allocator(), exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or a file descriptor",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const data = StringOrBuffer.fromJS(ctx.ptr(), arguments.arena.allocator(), arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "data is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "data must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;
            arguments.eat();

            var encoding = Encoding.buffer;
            var flag = FileSystemFlags.w;
            var mode: Mode = default_permission;

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    encoding = Encoding.fromJS(arg, ctx.ptr()) orelse {
                        if (exception.* == null) {
                            JSC.throwInvalidArguments(
                                "Invalid encoding",
                                .{},
                                ctx,
                                exception,
                            );
                        }
                        return null;
                    };
                } else if (arg.isObject()) {
                    if (arg.getTruthy(ctx.ptr(), "encoding")) |encoding_| {
                        encoding = Encoding.fromJS(encoding_, ctx.ptr()) orelse {
                            if (exception.* == null) {
                                JSC.throwInvalidArguments(
                                    "Invalid encoding",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getTruthy(ctx.ptr(), "flag")) |flag_| {
                        flag = FileSystemFlags.fromJS(ctx, flag_, exception) orelse {
                            if (exception.* == null) {
                                JSC.throwInvalidArguments(
                                    "Invalid flag",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getTruthy(ctx.ptr(), "mode")) |mode_| {
                        mode = JSC.Node.modeFromJS(ctx, mode_, exception) orelse {
                            if (exception.* == null) {
                                JSC.throwInvalidArguments(
                                    "Invalid flag",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }
                }
            }

            // Note: Signal is not implemented
            return WriteFile{
                .file = file,
                .encoding = encoding,
                .flag = flag,
                .mode = mode,
                .data = data,
                .dirfd = bun.toFD(std.fs.cwd().fd),
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

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?OpenDir {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or a file descriptor",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var encoding = Encoding.buffer;
            var buffer_size: c_int = 32;

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    encoding = Encoding.fromJS(arg, ctx.ptr()) orelse {
                        if (exception.* == null) {
                            JSC.throwInvalidArguments(
                                "Invalid encoding",
                                .{},
                                ctx,
                                exception,
                            );
                        }
                        return null;
                    };
                } else if (arg.isObject()) {
                    if (arg.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding_| {
                        if (!encoding_.isUndefinedOrNull()) {
                            encoding = Encoding.fromJS(encoding_, ctx.ptr()) orelse {
                                if (exception.* == null) {
                                    JSC.throwInvalidArguments(
                                        "Invalid encoding",
                                        .{},
                                        ctx,
                                        exception,
                                    );
                                }
                                return null;
                            };
                        }
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "bufferSize")) |buffer_size_| {
                        buffer_size = buffer_size_.toInt32();
                        if (buffer_size < 0) {
                            if (exception.* == null) {
                                JSC.throwInvalidArguments(
                                    "bufferSize must be > 0",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
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

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Exists {
            return Exists{
                .path = PathLike.fromJS(ctx, arguments, exception),
            };
        }
    };

    pub const Access = struct {
        path: PathLike,
        mode: FileSystemFlags = FileSystemFlags.r,

        pub fn deinit(this: Access) void {
            this.path.deinit();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Access {
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "path must be a string or buffer",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var mode = FileSystemFlags.r;

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    mode = FileSystemFlags.fromJS(ctx, arg, exception) orelse {
                        if (exception.* == null) {
                            JSC.throwInvalidArguments(
                                "Invalid mode",
                                .{},
                                ctx,
                                exception,
                            );
                        }
                        return null;
                    };
                }
            }

            return Access{
                .path = path,
                .mode = mode,
            };
        }
    };

    pub const CreateReadStream = struct {
        file: PathOrFileDescriptor,
        flags: FileSystemFlags = FileSystemFlags.r,
        encoding: Encoding = Encoding.utf8,
        mode: Mode = default_permission,
        autoClose: bool = true,
        emitClose: bool = true,
        start: i32 = 0,
        end: i32 = std.math.maxInt(i32),
        highwater_mark: u32 = 64 * 1024,
        global_object: *JSC.JSGlobalObject,

        pub fn deinit(this: CreateReadStream) void {
            this.file.deinit();
        }

        pub fn copyToState(this: CreateReadStream, state: *JSC.Node.Readable.State) void {
            state.encoding = this.encoding;
            state.highwater_mark = this.highwater_mark;
            state.start = this.start;
            state.end = this.end;
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?CreateReadStream {
            var path = PathLike.fromJS(ctx, arguments, exception);
            if (exception.* != null) return null;
            if (path == null) arguments.eat();

            var stream = CreateReadStream{
                .file = undefined,
                .global_object = ctx.ptr(),
            };
            var fd: FileDescriptor = bun.invalid_fd;

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    stream.encoding = Encoding.fromJS(arg, ctx.ptr()) orelse {
                        if (exception.* != null) {
                            JSC.throwInvalidArguments(
                                "Invalid encoding",
                                .{},
                                ctx,
                                exception,
                            );
                        }
                        return null;
                    };
                } else if (arg.isObject()) {
                    if (arg.getIfPropertyExists(ctx.ptr(), "mode")) |mode_| {
                        stream.mode = JSC.Node.modeFromJS(ctx, mode_, exception) orelse {
                            if (exception.* != null) {
                                JSC.throwInvalidArguments(
                                    "Invalid mode",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding| {
                        stream.encoding = Encoding.fromJS(encoding, ctx.ptr()) orelse {
                            if (exception.* != null) {
                                JSC.throwInvalidArguments(
                                    "Invalid encoding",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getTruthy(ctx.ptr(), "flags")) |flags| {
                        stream.flags = FileSystemFlags.fromJS(ctx, flags, exception) orelse {
                            if (exception.* == null) {
                                JSC.throwInvalidArguments(
                                    "Invalid flags",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "fd")) |flags| {
                        fd = JSC.Node.fileDescriptorFromJS(ctx, flags, exception) orelse {
                            if (exception.* != null) {
                                JSC.throwInvalidArguments(
                                    "Invalid file descriptor",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "autoClose")) |autoClose| {
                        stream.autoClose = autoClose.toBoolean();
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "emitClose")) |emitClose| {
                        stream.emitClose = emitClose.toBoolean();
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "start")) |start| {
                        stream.start = start.coerce(i32, ctx);
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "end")) |end| {
                        stream.end = end.coerce(i32, ctx);
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "highWaterMark")) |highwaterMark| {
                        stream.highwater_mark = highwaterMark.toU32();
                    }
                }
            }

            if (fd != bun.invalid_fd) {
                stream.file = .{ .fd = fd };
            } else if (path) |path_| {
                stream.file = .{ .path = path_ };
            } else {
                JSC.throwInvalidArguments("Missing path or file descriptor", .{}, ctx, exception);
                return null;
            }
            return stream;
        }
    };

    pub const CreateWriteStream = struct {
        file: PathOrFileDescriptor,
        flags: FileSystemFlags = FileSystemFlags.w,
        encoding: Encoding = Encoding.utf8,
        mode: Mode = default_permission,
        autoClose: bool = true,
        emitClose: bool = true,
        start: i32 = 0,
        highwater_mark: u32 = 256 * 1024,
        global_object: *JSC.JSGlobalObject,

        pub fn deinit(this: @This()) void {
            this.file.deinit();
        }

        pub fn copyToState(this: CreateWriteStream, state: *JSC.Node.Writable.State) void {
            state.encoding = this.encoding;
            state.highwater_mark = this.highwater_mark;
            state.start = this.start;
            state.emit_close = this.emitClose;
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?CreateWriteStream {
            var path = PathLike.fromJS(ctx, arguments, exception);
            if (exception.* != null) return null;
            if (path == null) arguments.eat();

            var stream = CreateWriteStream{
                .file = undefined,
                .global_object = ctx.ptr(),
            };
            var fd: FileDescriptor = bun.invalid_fd;

            if (arguments.next()) |arg| {
                arguments.eat();
                if (arg.isString()) {
                    stream.encoding = Encoding.fromJS(arg, ctx.ptr()) orelse {
                        if (exception.* != null) {
                            JSC.throwInvalidArguments(
                                "Invalid encoding",
                                .{},
                                ctx,
                                exception,
                            );
                        }
                        return null;
                    };
                } else if (arg.isObject()) {
                    if (arg.getIfPropertyExists(ctx.ptr(), "mode")) |mode_| {
                        stream.mode = JSC.Node.modeFromJS(ctx, mode_, exception) orelse {
                            if (exception.* != null) {
                                JSC.throwInvalidArguments(
                                    "Invalid mode",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "encoding")) |encoding| {
                        stream.encoding = Encoding.fromJS(encoding, ctx.ptr()) orelse {
                            if (exception.* != null) {
                                JSC.throwInvalidArguments(
                                    "Invalid encoding",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getTruthy(ctx.ptr(), "flags")) |flags| {
                        stream.flags = FileSystemFlags.fromJS(ctx, flags, exception) orelse {
                            if (exception.* == null) {
                                JSC.throwInvalidArguments(
                                    "Invalid flags",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "fd")) |flags| {
                        fd = JSC.Node.fileDescriptorFromJS(ctx, flags, exception) orelse {
                            if (exception.* != null) {
                                JSC.throwInvalidArguments(
                                    "Invalid file descriptor",
                                    .{},
                                    ctx,
                                    exception,
                                );
                            }
                            return null;
                        };
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "autoClose")) |autoClose| {
                        stream.autoClose = autoClose.toBoolean();
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "emitClose")) |emitClose| {
                        stream.emitClose = emitClose.toBoolean();
                    }

                    if (arg.getIfPropertyExists(ctx.ptr(), "start")) |start| {
                        stream.start = start.toInt32();
                    }
                }
            }

            if (fd != bun.invalid_fd) {
                stream.file = .{ .fd = fd };
            } else if (path) |path_| {
                stream.file = .{ .path = path_ };
            } else {
                JSC.throwInvalidArguments("Missing path or file descriptor", .{}, ctx, exception);
                return null;
            }
            return stream;
        }
    };

    pub const FdataSync = struct {
        fd: FileDescriptor,

        pub fn deinit(_: FdataSync) void {}

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?FdataSync {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "File descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "fd must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            return FdataSync{
                .fd = fd,
            };
        }
    };

    pub const CopyFile = struct {
        src: PathLike,
        dest: PathLike,
        mode: Constants.Copyfile,

        fn deinit(this: CopyFile) void {
            this.src.deinit();
            this.dest.deinit();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?CopyFile {
            const src = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "src must be a string or buffer",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const dest = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "dest must be a string or buffer",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

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
        };

        fn deinit(this: Cp) void {
            this.src.deinit();
            this.dest.deinit();
        }

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Cp {
            const src = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "src must be a string or buffer",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            const dest = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "dest must be a string or buffer",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            var recursive: bool = false;
            var errorOnExist: bool = false;
            var force: bool = true;
            var mode: i32 = 0;

            if (arguments.next()) |arg| {
                arguments.eat();
                recursive = arg.asBoolean();
            }

            if (arguments.next()) |arg| {
                arguments.eat();
                errorOnExist = arg.asBoolean();
            }

            if (arguments.next()) |arg| {
                arguments.eat();
                force = arg.asBoolean();
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
    pub const WatchFile = void;
    pub const Fsync = struct {
        fd: FileDescriptor,

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Fsync {
            const fd = JSC.Node.fileDescriptorFromJS(ctx, arguments.next() orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "File descriptor is required",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            }, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "fd must be a number",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;

            return Fsync{
                .fd = fd,
            };
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
    pub const Mkdir = bun.String;
    pub const Mkdtemp = JSC.ZigString;
    pub const Open = FileDescriptor;
    pub const WriteFile = void;
    pub const Readv = Read;
    pub const Read = struct {
        bytes_read: u52,

        pub fn toJS(this: Read, _: JSC.C.JSContextRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            return JSC.JSValue.jsNumberFromUint64(this.bytes_read).asObjectRef();
        }
    };
    pub const ReadPromise = struct {
        bytes_read: u52,
        buffer_val: JSC.JSValue = JSC.JSValue.zero,
        const fields = .{
            .bytesRead = JSC.ZigString.init("bytesRead"),
            .buffer = JSC.ZigString.init("buffer"),
        };
        pub fn toJS(this: Read, ctx: JSC.C.JSContextRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            defer if (!this.buffer_val.isEmptyOrUndefinedOrNull())
                JSC.C.JSValueUnprotect(ctx, this.buffer_val.asObjectRef());

            return JSC.JSValue.createObject2(
                ctx.ptr(),
                &fields.bytesRead,
                &fields.buffer,
                JSC.JSValue.jsNumberFromUint64(@as(u52, @intCast(@min(std.math.maxInt(u52), this.bytes_read)))),
                this.buffer_val,
            ).asObjectRef();
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
        pub fn toJS(this: Write, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            defer if (!this.buffer_val.isEmptyOrUndefinedOrNull() and this.buffer == .buffer)
                JSC.C.JSValueUnprotect(ctx, this.buffer_val.asObjectRef());

            return JSC.JSValue.createObject2(
                ctx.ptr(),
                &fields.bytesWritten,
                &fields.buffer,
                JSC.JSValue.jsNumberFromUint64(@as(u52, @intCast(@min(std.math.maxInt(u52), this.bytes_written)))),
                if (this.buffer == .buffer)
                    this.buffer_val
                else
                    JSC.JSValue.fromRef(this.buffer.toJS(ctx, exception)),
            ).asObjectRef();
        }
    };
    pub const Write = struct {
        bytes_written: u52,
        const fields = .{
            .bytesWritten = JSC.ZigString.init("bytesWritten"),
        };

        // Excited for the issue that's like "cannot read file bigger than 2 GB"
        pub fn toJS(this: Write, _: JSC.C.JSContextRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            return JSC.JSValue.jsNumberFromUint64(this.bytes_written).asObjectRef();
        }
    };

    pub const Readdir = union(Tag) {
        with_file_types: []Dirent,
        buffers: []const Buffer,
        files: []const bun.String,

        pub const Tag = enum {
            with_file_types,
            buffers,
            files,
        };

        pub fn toJS(this: Readdir, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            switch (this) {
                .with_file_types => {
                    defer bun.default_allocator.free(this.with_file_types);
                    return JSC.To.JS.withType([]const Dirent, this.with_file_types, ctx, exception);
                },
                .buffers => {
                    defer bun.default_allocator.free(this.buffers);
                    return JSC.To.JS.withType([]const Buffer, this.buffers, ctx, exception);
                },
                .files => {
                    // automatically freed
                    return JSC.To.JS.withType([]const bun.String, this.files, ctx, exception);
                },
            }
        }
    };
    pub const ReadFile = JSC.Node.StringOrNodeBuffer;
    pub const ReadFileWithOptions = union(enum) {
        string: string,
        buffer: JSC.Node.Buffer,
        null_terminated: [:0]const u8,
    };
    pub const Readlink = JSC.Node.StringOrBunStringOrBuffer;
    pub const Realpath = JSC.Node.StringOrBunStringOrBuffer;
    pub const RealpathNative = Realpath;
    pub const Rename = void;
    pub const Rmdir = void;
    pub const Stat = StatOrNotFound;

    pub const Symlink = void;
    pub const Truncate = void;
    pub const Unlink = void;
    pub const UnwatchFile = void;
    pub const Watch = JSC.JSValue;
    pub const WatchFile = void;
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
    sync_error_buf: [bun.MAX_PATH_BYTES]u8 = undefined,
    vm: ?*JSC.VirtualMachine = null,

    pub const ReturnType = Return;

    pub fn access(this: *NodeFS, args: Arguments.Access, comptime _: Flavor) Maybe(Return.Access) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Access).todo;
        }

        var path = args.path.sliceZ(&this.sync_error_buf);
        const rc = Syscall.system.access(path, @intFromEnum(args.mode));
        return Maybe(Return.Access).errnoSysP(rc, .access, path) orelse Maybe(Return.Access).success;
    }

    pub fn appendFile(this: *NodeFS, args: Arguments.AppendFile, comptime flavor: Flavor) Maybe(Return.AppendFile) {
        var data = args.data.slice();

        switch (args.file) {
            .fd => |fd| {
                switch (comptime flavor) {
                    .sync => {
                        while (data.len > 0) {
                            const written = switch (Syscall.write(fd, data)) {
                                .result => |result| result,
                                .err => |err| return .{ .err = err },
                            };
                            data = data[written..];
                        }

                        return Maybe(Return.AppendFile).success;
                    },
                    else => {
                        @compileError("Not implemented yet");
                    },
                }
            },
            .path => |path_| {
                const path = path_.sliceZ(&this.sync_error_buf);
                switch (comptime flavor) {
                    .sync => {
                        const fd = switch (Syscall.open(path, @intFromEnum(FileSystemFlags.a), 0o000666)) {
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
                    else => {
                        @compileError("Not implemented yet");
                    },
                }
            },
        }

        return Maybe(Return.AppendFile).todo;
    }

    pub fn close(_: *NodeFS, args: Arguments.Close, comptime flavor: Flavor) Maybe(Return.Close) {
        switch (comptime flavor) {
            .sync => {
                return if (Syscall.close(args.fd)) |err| .{ .err = err } else Maybe(Return.Close).success;
            },
            else => {},
        }

        return .{ .err = Syscall.Error.todo };
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

                var buf_ = bun.default_allocator.alloc(u8, clamped_size) catch break :maybe_allocate_large_temp_buf;
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

    /// https://github.com/libuv/libuv/pull/2233
    /// https://github.com/pnpm/pnpm/issues/2761
    /// https://github.com/libuv/libuv/pull/2578
    /// https://github.com/nodejs/node/issues/34624
    pub fn copyFile(_: *NodeFS, args: Arguments.CopyFile, comptime flavor: Flavor) Maybe(Return.CopyFile) {
        const ret = Maybe(Return.CopyFile);

        switch (comptime flavor) {
            .sync => {
                var src_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var dest_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var src = args.src.sliceZ(&src_buf);
                var dest = args.dest.sliceZ(&dest_buf);

                // TODO: do we need to fchown?
                if (comptime Environment.isMac) {
                    if (args.mode.isForceClone()) {
                        // https://www.manpagez.com/man/2/clonefile/
                        return ret.errnoSysP(C.clonefile(src, dest, 0), .clonefile, src) orelse ret.success;
                    } else {
                        const stat_ = switch (Syscall.stat(src)) {
                            .result => |result| result,
                            .err => |err| return Maybe(Return.CopyFile){ .err = err.withPath(src) },
                        };

                        if (!os.S.ISREG(stat_.mode)) {
                            return Maybe(Return.CopyFile){ .err = .{ .errno = @intFromEnum(C.SystemErrno.ENOTSUP) } };
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
                            const src_fd = switch (Syscall.open(src, std.os.O.RDONLY, 0o644)) {
                                .result => |result| result,
                                .err => |err| return .{ .err = err.withPath(args.src.slice()) },
                            };
                            defer {
                                _ = Syscall.close(src_fd);
                            }

                            var flags: Mode = std.os.O.CREAT | std.os.O.WRONLY;
                            var wrote: usize = 0;
                            if (args.mode.shouldntOverwrite()) {
                                flags |= std.os.O.EXCL;
                            }

                            const dest_fd = switch (Syscall.open(dest, flags, JSC.Node.default_permission)) {
                                .result => |result| result,
                                .err => |err| return Maybe(Return.CopyFile){ .err = err },
                            };
                            defer {
                                _ = std.c.ftruncate(dest_fd, @as(std.c.off_t, @intCast(@as(u63, @truncate(wrote)))));
                                _ = C.fchmod(dest_fd, stat_.mode);
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
                    // https://manpages.debian.org/testing/manpages-dev/ioctl_ficlone.2.en.html
                    if (args.mode.isForceClone()) {
                        return Maybe(Return.CopyFile).todo;
                    }

                    const src_fd = switch (Syscall.open(src, std.os.O.RDONLY, 0o644)) {
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

                    if (!os.S.ISREG(stat_.mode)) {
                        return Maybe(Return.CopyFile){ .err = .{ .errno = @intFromEnum(C.SystemErrno.ENOTSUP) } };
                    }

                    var flags: Mode = std.os.O.CREAT | std.os.O.WRONLY;
                    var wrote: usize = 0;
                    if (args.mode.shouldntOverwrite()) {
                        flags |= std.os.O.EXCL;
                    }

                    const dest_fd = switch (Syscall.open(dest, flags, JSC.Node.default_permission)) {
                        .result => |result| result,
                        .err => |err| return Maybe(Return.CopyFile){ .err = err },
                    };

                    var size: usize = @intCast(@max(stat_.size, 0));

                    defer {
                        _ = linux.ftruncate(dest_fd, @as(i64, @intCast(@as(u63, @truncate(wrote)))));
                        _ = linux.fchmod(dest_fd, stat_.mode);
                        _ = Syscall.close(dest_fd);
                    }

                    var off_in_copy = @as(i64, @bitCast(@as(u64, 0)));
                    var off_out_copy = @as(i64, @bitCast(@as(u64, 0)));

                    if (!bun.canUseCopyFileRangeSyscall()) {
                        return copyFileUsingReadWriteLoop(src, dest, src_fd, dest_fd, size, &wrote);
                    }

                    if (size == 0) {
                        // copy until EOF
                        while (true) {

                            // Linux Kernel 5.3 or later
                            const written = linux.copy_file_range(src_fd, &off_in_copy, dest_fd, &off_out_copy, std.mem.page_size, 0);
                            if (ret.errnoSysP(written, .copy_file_range, dest)) |err| {
                                return switch (err.getErrno()) {
                                    .XDEV, .NOSYS => copyFileUsingReadWriteLoop(src, dest, src_fd, dest_fd, size, &wrote),
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
                            const written = linux.copy_file_range(src_fd, &off_in_copy, dest_fd, &off_out_copy, size, 0);
                            if (ret.errnoSysP(written, .copy_file_range, dest)) |err| {
                                return switch (err.getErrno()) {
                                    .XDEV, .NOSYS => copyFileUsingReadWriteLoop(src, dest, src_fd, dest_fd, size, &wrote),
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
            },
            else => {},
        }

        return Maybe(Return.CopyFile).todo;
    }

    pub fn exists(this: *NodeFS, args: Arguments.Exists, comptime flavor: Flavor) Maybe(Return.Exists) {
        const Ret = Maybe(Return.Exists);
        switch (comptime flavor) {
            .sync => {
                const path = args.path orelse return Ret{ .result = false };
                const slice = path.sliceZ(&this.sync_error_buf);
                // access() may not work correctly on NFS file systems with UID
                // mapping enabled, because UID mapping is done on the server and
                // hidden from the client, which checks permissions. Similar
                // problems can occur to FUSE mounts.
                const rc = (system.access(slice, std.os.F_OK));
                return Ret{ .result = rc == 0 };
            },
            else => {},
        }

        return Ret.todo;
    }

    pub fn chown(this: *NodeFS, args: Arguments.Chown, comptime flavor: Flavor) Maybe(Return.Chown) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Fchmod).todo;
        }

        const path = args.path.sliceZ(&this.sync_error_buf);

        switch (comptime flavor) {
            .sync => return Syscall.chown(path, args.uid, args.gid),
            else => {},
        }

        return Maybe(Return.Chown).todo;
    }

    /// This should almost never be async
    pub fn chmod(this: *NodeFS, args: Arguments.Chmod, comptime flavor: Flavor) Maybe(Return.Chmod) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Fchmod).todo;
        }

        const path = args.path.sliceZ(&this.sync_error_buf);

        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Chmod).errnoSysP(C.chmod(path, args.mode), .chmod, path) orelse
                    Maybe(Return.Chmod).success;
            },
            else => {},
        }

        return Maybe(Return.Chmod).todo;
    }

    /// This should almost never be async
    pub fn fchmod(_: *NodeFS, args: Arguments.FChmod, comptime flavor: Flavor) Maybe(Return.Fchmod) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Fchmod).todo;
        }

        switch (comptime flavor) {
            .sync => {
                return Syscall.fchmod(args.fd, args.mode);
            },
            else => {},
        }

        return Maybe(Return.Fchmod).todo;
    }
    pub fn fchown(_: *NodeFS, args: Arguments.Fchown, comptime flavor: Flavor) Maybe(Return.Fchown) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Fchown).todo;
        }

        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Fchown).errnoSys(C.fchown(args.fd, args.uid, args.gid), .fchown) orelse
                    Maybe(Return.Fchown).success;
            },
            else => {},
        }

        return Maybe(Return.Fchown).todo;
    }
    pub fn fdatasync(_: *NodeFS, args: Arguments.FdataSync, comptime flavor: Flavor) Maybe(Return.Fdatasync) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Fdatasync).todo;
        }
        switch (comptime flavor) {
            .sync => return Maybe(Return.Fdatasync).errnoSys(system.fdatasync(args.fd), .fdatasync) orelse
                Maybe(Return.Fdatasync).success,
            else => {},
        }

        return Maybe(Return.Fdatasync).todo;
    }
    pub fn fstat(_: *NodeFS, args: Arguments.Fstat, comptime flavor: Flavor) Maybe(Return.Fstat) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Fstat).todo;
        }

        switch (comptime flavor) {
            .sync => {
                if (comptime Environment.isPosix) {
                    return switch (Syscall.fstat(args.fd)) {
                        .result => |result| Maybe(Return.Fstat){ .result = Stats.init(result, false) },
                        .err => |err| Maybe(Return.Fstat){ .err = err },
                    };
                }
            },
            else => {},
        }

        return Maybe(Return.Fstat).todo;
    }

    pub fn fsync(_: *NodeFS, args: Arguments.Fsync, comptime flavor: Flavor) Maybe(Return.Fsync) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Fsync).todo;
        }

        switch (comptime flavor) {
            .sync => return Maybe(Return.Fsync).errnoSys(system.fsync(args.fd), .fsync) orelse
                Maybe(Return.Fsync).success,
            else => {},
        }

        return Maybe(Return.Fsync).todo;
    }

    pub fn ftruncateSync(args: Arguments.FTruncate) Maybe(Return.Ftruncate) {
        return Syscall.ftruncate(args.fd, args.len orelse 0);
    }

    pub fn ftruncate(_: *NodeFS, args: Arguments.FTruncate, comptime flavor: Flavor) Maybe(Return.Ftruncate) {
        switch (comptime flavor) {
            .sync => return ftruncateSync(args),
            else => {},
        }

        return Maybe(Return.Ftruncate).todo;
    }
    pub fn futimes(_: *NodeFS, args: Arguments.Futimes, comptime flavor: Flavor) Maybe(Return.Futimes) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Futimes).todo;
        }

        var times = [2]std.os.timespec{
            .{
                .tv_sec = args.mtime,
                .tv_nsec = 0,
            },
            .{
                .tv_sec = args.atime,
                .tv_nsec = 0,
            },
        };

        switch (comptime flavor) {
            .sync => return if (Maybe(Return.Futimes).errnoSys(system.futimens(args.fd, &times), .futimens)) |err|
                err
            else
                Maybe(Return.Futimes).success,
            else => {},
        }

        return Maybe(Return.Futimes).todo;
    }

    pub fn lchmod(this: *NodeFS, args: Arguments.LCHmod, comptime flavor: Flavor) Maybe(Return.Lchmod) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Lchmod).todo;
        }

        const path = args.path.sliceZ(&this.sync_error_buf);

        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Lchmod).errnoSysP(C.lchmod(path, args.mode), .lchmod, path) orelse
                    Maybe(Return.Lchmod).success;
            },
            else => {},
        }

        return Maybe(Return.Lchmod).todo;
    }

    pub fn lchown(this: *NodeFS, args: Arguments.LChown, comptime flavor: Flavor) Maybe(Return.Lchown) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Lchown).todo;
        }

        const path = args.path.sliceZ(&this.sync_error_buf);

        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Lchown).errnoSysP(C.lchown(path, args.uid, args.gid), .lchown, path) orelse
                    Maybe(Return.Lchown).success;
            },
            else => {},
        }

        return Maybe(Return.Lchown).todo;
    }
    pub fn link(this: *NodeFS, args: Arguments.Link, comptime flavor: Flavor) Maybe(Return.Link) {
        var new_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const from = args.old_path.sliceZ(&this.sync_error_buf);
        const to = args.new_path.sliceZ(&new_path_buf);

        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Link).errnoSysP(system.link(from, to, 0), .link, from) orelse
                    Maybe(Return.Link).success;
            },
            else => {},
        }

        return Maybe(Return.Link).todo;
    }
    pub fn lstat(this: *NodeFS, args: Arguments.Lstat, comptime flavor: Flavor) Maybe(Return.Lstat) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Lstat).todo;
        }

        _ = flavor;
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
    fn mkdirNonRecursive(this: *NodeFS, args: Arguments.Mkdir, comptime flavor: Flavor) Maybe(Return.Mkdir) {
        switch (comptime flavor) {
            .sync => {
                const path = args.path.sliceZ(&this.sync_error_buf);
                return switch (Syscall.mkdir(path, args.mode)) {
                    .result => Maybe(Return.Mkdir){ .result = bun.String.empty },
                    .err => |err| Maybe(Return.Mkdir){ .err = err },
                };
            },
            else => {},
        }

        return Maybe(Return.Mkdir).todo;
    }

    // TODO: windows
    // TODO: verify this works correctly with unicode codepoints
    pub fn mkdirRecursive(this: *NodeFS, args: Arguments.Mkdir, comptime flavor: Flavor) Maybe(Return.Mkdir) {
        const Option = Maybe(Return.Mkdir);
        if (comptime Environment.isWindows) return Option.todo;

        switch (comptime flavor) {
            // The sync version does no allocation except when returning the path
            .sync => {
                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const path = args.path.sliceZWithForceCopy(&buf, true);
                const len = @as(u16, @truncate(path.len));

                // First, attempt to create the desired directory
                // If that fails, then walk back up the path until we have a match
                switch (Syscall.mkdir(path, args.mode)) {
                    .err => |err| {
                        switch (err.getErrno()) {
                            else => {
                                @memcpy(this.sync_error_buf[0..len], path[0..len]);
                                return .{ .err = err.withPath(this.sync_error_buf[0..len]) };
                            },

                            .EXIST => {
                                return Option{ .result = bun.String.empty };
                            },
                            // continue
                            .NOENT => {},
                        }
                    },
                    .result => {
                        return Option{
                            .result = if (args.path == .slice_with_underlying_string)
                                args.path.slice_with_underlying_string.underlying
                            else
                                bun.String.create(args.path.slice()),
                        };
                    },
                }

                var working_mem = &this.sync_error_buf;
                @memcpy(working_mem[0..len], path[0..len]);

                var i: u16 = len - 1;

                // iterate backwards until creating the directory works successfully
                while (i > 0) : (i -= 1) {
                    if (path[i] == std.fs.path.sep) {
                        working_mem[i] = 0;
                        var parent: [:0]u8 = working_mem[0..i :0];

                        switch (Syscall.mkdir(parent, args.mode)) {
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
                                    else => return .{ .err = err.withPath(parent) },
                                }
                            },
                            .result => {
                                // We found a parent that worked
                                working_mem[i] = std.fs.path.sep;
                                break;
                            },
                        }
                    }
                }
                var first_match: u16 = i;
                i += 1;
                // after we find one that works, we go forward _after_ the first working directory
                while (i < len) : (i += 1) {
                    if (path[i] == std.fs.path.sep) {
                        working_mem[i] = 0;
                        var parent: [:0]u8 = working_mem[0..i :0];

                        switch (Syscall.mkdir(parent, args.mode)) {
                            .err => |err| {
                                working_mem[i] = std.fs.path.sep;
                                switch (err.getErrno()) {
                                    .EXIST => {
                                        if (Environment.allow_assert) std.debug.assert(false);
                                        continue;
                                    },
                                    else => return .{ .err = err },
                                }
                            },

                            .result => {
                                working_mem[i] = std.fs.path.sep;
                            },
                        }
                    }
                }

                working_mem[len] = 0;

                // Our final directory will not have a trailing separator
                // so we have to create it once again
                switch (Syscall.mkdir(working_mem[0..len :0], args.mode)) {
                    .err => |err| {
                        switch (err.getErrno()) {
                            // handle the race condition
                            .EXIST => {
                                var display_path = bun.String.empty;
                                if (first_match != std.math.maxInt(u16)) {
                                    display_path = bun.String.create(working_mem[0..first_match]);
                                }
                                return Option{ .result = display_path };
                            },

                            // NOENT shouldn't happen here
                            else => return .{
                                .err = err.withPath(path),
                            },
                        }
                    },
                    .result => {
                        return Option{
                            .result = if (first_match != std.math.maxInt(u16))
                                bun.String.create(working_mem[0..first_match])
                            else if (args.path == .slice_with_underlying_string)
                                args.path.slice_with_underlying_string.underlying
                            else
                                bun.String.create(args.path.slice()),
                        };
                    },
                }
            },
            else => {},
        }

        return Maybe(Return.Mkdir).todo;
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

        const rc = C.mkdtemp(prefix_buf);
        if (rc) |ptr| {
            return .{
                .result = JSC.ZigString.dupeForJS(bun.sliceTo(ptr, 0), bun.default_allocator) catch unreachable,
            };
        }
        // std.c.getErrno(rc) returns SUCCESS if rc is null so we call std.c._errno() directly
        const errno = @as(std.c.E, @enumFromInt(std.c._errno().*));
        return .{ .err = Syscall.Error{ .errno = @as(Syscall.Error.Int, @truncate(@intFromEnum(errno))), .syscall = .mkdtemp } };
    }
    pub fn open(this: *NodeFS, args: Arguments.Open, comptime flavor: Flavor) Maybe(Return.Open) {
        switch (comptime flavor) {
            // The sync version does no allocation except when returning the path
            .sync => {
                const path = args.path.sliceZ(&this.sync_error_buf);
                return switch (Syscall.open(path, @intFromEnum(args.flags), args.mode)) {
                    .err => |err| .{
                        .err = err.withPath(args.path.slice()),
                    },
                    .result => |fd| .{ .result = fd },
                };
            },
            else => {},
        }

        return Maybe(Return.Open).todo;
    }
    pub fn openDir(_: *NodeFS, _: Arguments.OpenDir, comptime _: Flavor) Maybe(Return.OpenDir) {
        return Maybe(Return.OpenDir).todo;
    }

    fn _read(_: *NodeFS, args: Arguments.Read, comptime flavor: Flavor) Maybe(Return.Read) {
        if (Environment.allow_assert) std.debug.assert(args.position == null);

        switch (comptime flavor) {
            // The sync version does no allocation except when returning the path
            .sync => {
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
            },
            else => {},
        }

        return Maybe(Return.Read).todo;
    }

    fn _pread(_: *NodeFS, args: Arguments.Read, comptime flavor: Flavor) Maybe(Return.Read) {
        switch (comptime flavor) {
            .sync => {
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
            },
            else => {},
        }

        return Maybe(Return.Read).todo;
    }

    pub fn read(this: *NodeFS, args: Arguments.Read, comptime flavor: Flavor) Maybe(Return.Read) {
        if (comptime Environment.isWindows) return Maybe(Return.Read).todo;
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

    pub fn readv(this: *NodeFS, args: Arguments.Readv, comptime flavor: Flavor) Maybe(Return.Read) {
        if (comptime Environment.isWindows) return Maybe(Return.Read).todo;
        return if (args.position != null) _preadv(this, args, flavor) else _readv(this, args, flavor);
    }

    pub fn writev(this: *NodeFS, args: Arguments.Writev, comptime flavor: Flavor) Maybe(Return.Write) {
        if (comptime Environment.isWindows) return Maybe(Return.Write).todo;
        return if (args.position != null) _pwritev(this, args, flavor) else _writev(this, args, flavor);
    }

    pub fn write(this: *NodeFS, args: Arguments.Write, comptime flavor: Flavor) Maybe(Return.Write) {
        if (comptime Environment.isWindows) return Maybe(Return.Write).todo;
        return if (args.position != null) _pwrite(this, args, flavor) else _write(this, args, flavor);
    }
    fn _write(_: *NodeFS, args: Arguments.Write, comptime flavor: Flavor) Maybe(Return.Write) {
        switch (comptime flavor) {
            .sync => {
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
            },
            else => {},
        }

        return Maybe(Return.Write).todo;
    }

    fn _pwrite(_: *NodeFS, args: Arguments.Write, comptime flavor: Flavor) Maybe(Return.Write) {
        const position = args.position.?;

        switch (comptime flavor) {
            .sync => {
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
            },
            else => {},
        }

        return Maybe(Return.Write).todo;
    }

    fn _preadv(_: *NodeFS, args: Arguments.Readv, comptime flavor: Flavor) Maybe(Return.Readv) {
        const position = args.position.?;

        switch (comptime flavor) {
            .sync => {
                return switch (Syscall.preadv(args.fd, args.buffers.buffers.items, position)) {
                    .err => |err| .{
                        .err = err,
                    },
                    .result => |amt| .{ .result = .{
                        .bytes_read = @as(u52, @truncate(amt)),
                    } },
                };
            },
            else => {},
        }

        return Maybe(Return.Write).todo;
    }

    fn _readv(_: *NodeFS, args: Arguments.Readv, comptime flavor: Flavor) Maybe(Return.Readv) {
        switch (comptime flavor) {
            .sync => {
                return switch (Syscall.readv(args.fd, args.buffers.buffers.items)) {
                    .err => |err| .{
                        .err = err,
                    },
                    .result => |amt| .{ .result = .{
                        .bytes_read = @as(u52, @truncate(amt)),
                    } },
                };
            },
            else => {},
        }

        return Maybe(Return.Write).todo;
    }

    fn _pwritev(_: *NodeFS, args: Arguments.Writev, comptime flavor: Flavor) Maybe(Return.Write) {
        const position = args.position.?;

        switch (comptime flavor) {
            .sync => {
                return switch (Syscall.pwritev(args.fd, args.buffers.buffers.items, position)) {
                    .err => |err| .{
                        .err = err,
                    },
                    .result => |amt| .{ .result = .{
                        .bytes_written = @as(u52, @truncate(amt)),
                    } },
                };
            },
            else => {},
        }

        return Maybe(Return.Write).todo;
    }

    fn _writev(_: *NodeFS, args: Arguments.Writev, comptime flavor: Flavor) Maybe(Return.Write) {
        switch (comptime flavor) {
            .sync => {
                return switch (Syscall.writev(args.fd, args.buffers.buffers.items)) {
                    .err => |err| .{
                        .err = err,
                    },
                    .result => |amt| .{ .result = .{
                        .bytes_written = @as(u52, @truncate(amt)),
                    } },
                };
            },
            else => {},
        }

        return Maybe(Return.Write).todo;
    }

    pub fn readdir(this: *NodeFS, args: Arguments.Readdir, comptime flavor: Flavor) Maybe(Return.Readdir) {
        return switch (args.encoding) {
            .buffer => _readdir(
                &this.sync_error_buf,
                args,
                Buffer,
                flavor,
            ),
            else => {
                if (!args.with_file_types) {
                    return _readdir(
                        &this.sync_error_buf,
                        args,
                        bun.String,
                        flavor,
                    );
                }

                return _readdir(
                    &this.sync_error_buf,
                    args,
                    Dirent,
                    flavor,
                );
            },
        };
    }

    pub fn _readdir(
        buf: *[bun.MAX_PATH_BYTES]u8,
        args: Arguments.Readdir,
        comptime ExpectedType: type,
        comptime _: Flavor,
    ) Maybe(Return.Readdir) {
        const file_type = comptime switch (ExpectedType) {
            Dirent => "with_file_types",
            bun.String => "files",
            Buffer => "buffers",
            else => unreachable,
        };

        var path = args.path.sliceZ(buf);
        const flags = os.O.DIRECTORY | os.O.RDONLY;
        const fd = switch (Syscall.open(path, flags, 0)) {
            .err => |err| return .{
                .err = err.withPath(args.path.slice()),
            },
            .result => |fd_| fd_,
        };
        defer {
            _ = Syscall.close(fd);
        }

        var entries = std.ArrayList(ExpectedType).init(bun.default_allocator);
        var dir = std.fs.Dir{ .fd = bun.fdcast(fd) };
        var iterator = DirIterator.iterate(dir);
        var entry = iterator.next();
        while (switch (entry) {
            .err => |err| {
                for (entries.items) |*item| {
                    switch (comptime ExpectedType) {
                        Dirent => {
                            item.name.deref();
                        },
                        Buffer => {
                            item.destroy();
                        },
                        bun.String => {
                            item.deref();
                        },
                        else => unreachable,
                    }
                }

                entries.deinit();

                return .{
                    .err = err.withPath(args.path.slice()),
                };
            },
            .result => |ent| ent,
        }) |current| : (entry = iterator.next()) {
            const utf8_name = current.name.slice();
            switch (comptime ExpectedType) {
                Dirent => {
                    entries.append(.{
                        .name = bun.String.create(utf8_name),
                        .kind = current.kind,
                    }) catch unreachable;
                },
                Buffer => {
                    entries.append(Buffer.fromString(utf8_name, bun.default_allocator) catch unreachable) catch unreachable;
                },
                bun.String => {
                    entries.append(bun.String.create(utf8_name)) catch unreachable;
                },
                else => unreachable,
            }
        }

        return .{ .result = @unionInit(Return.Readdir, file_type, entries.items) };
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
                .string => .{
                    .result = .{
                        .string = ret.result.string,
                    },
                },
                else => unreachable,
            },
        };
    }

    pub fn readFileWithOptions(this: *NodeFS, args: Arguments.ReadFile, comptime _: Flavor, comptime string_type: StringType) Maybe(Return.ReadFileWithOptions) {
        var path: [:0]const u8 = undefined;
        const fd = switch (args.path) {
            .path => brk: {
                path = args.path.path.sliceZ(&this.sync_error_buf);
                if (this.vm) |vm| {
                    if (vm.standalone_module_graph) |graph| {
                        if (graph.find(path)) |file| {
                            if (args.encoding == .buffer) {
                                return .{
                                    .result = .{
                                        .buffer = Buffer.fromBytes(
                                            bun.default_allocator.dupe(u8, file.contents) catch @panic("out of memory"),
                                            bun.default_allocator,
                                            .Uint8Array,
                                        ),
                                    },
                                };
                            } else if (comptime string_type == .default)
                                return .{
                                    .result = .{
                                        .string = bun.default_allocator.dupe(u8, file.contents) catch @panic("out of memory"),
                                    },
                                }
                            else
                                return .{
                                    .result = .{
                                        .null_terminated = bun.default_allocator.dupeZ(u8, file.contents) catch @panic("out of memory"),
                                    },
                                };
                        }
                    }
                }

                break :brk switch (Syscall.open(
                    path,
                    os.O.RDONLY | os.O.NOCTTY,
                    0,
                )) {
                    .err => |err| return .{
                        .err = err.withPath(if (args.path == .path) args.path.path.slice() else ""),
                    },
                    .result => |fd_| fd_,
                };
            },
            .fd => |_fd| _fd,
        };

        defer {
            if (args.path == .path)
                _ = Syscall.close(fd);
        }

        const stat_ = switch (Syscall.fstat(fd)) {
            .err => |err| return .{
                .err = err,
            },
            .result => |stat_| stat_,
        };

        // Only used in DOMFormData
        if (args.offset > 0) {
            _ = Syscall.setFileOffset(fd, args.offset);
        }
        // For certain files, the size might be 0 but the file might still have contents.
        const size = @as(
            u64,
            @intCast(@max(
                @min(
                    stat_.size,
                    @as(
                        @TypeOf(stat_.size),
                        // Only used in DOMFormData
                        @intCast(args.max_size orelse std.math.maxInt(
                            JSC.WebCore.Blob.SizeType,
                        )),
                    ),
                ),
                0,
            )),
        ) + if (comptime string_type == .null_terminated) 1 else 0;

        var buf = std.ArrayList(u8).init(bun.default_allocator);
        buf.ensureTotalCapacityPrecise(size + 16) catch unreachable;
        buf.expandToCapacity();
        var total: usize = 0;

        while (total < size) {
            switch (Syscall.read(fd, buf.items.ptr[total..buf.capacity])) {
                .err => |err| return .{
                    .err = err,
                },
                .result => |amt| {
                    total += amt;
                    // There are cases where stat()'s size is wrong or out of date
                    if (total > size and amt != 0) {
                        buf.ensureUnusedCapacity(8096) catch unreachable;
                        buf.expandToCapacity();
                        continue;
                    }

                    if (amt == 0) {
                        break;
                    }
                },
            }
        } else {
            // https://github.com/oven-sh/bun/issues/1220
            while (true) {
                switch (Syscall.read(fd, buf.items.ptr[total..buf.capacity])) {
                    .err => |err| return .{
                        .err = err,
                    },
                    .result => |amt| {
                        total += amt;
                        // There are cases where stat()'s size is wrong or out of date
                        if (total > size and amt != 0) {
                            buf.ensureUnusedCapacity(8096) catch unreachable;
                            buf.expandToCapacity();
                            continue;
                        }

                        if (amt == 0) {
                            break;
                        }
                    },
                }
            }
        }

        buf.items.len = if (comptime string_type == .null_terminated) total + 1 else total;
        if (total == 0) {
            buf.deinit();
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
                            .null_terminated = buf.toOwnedSliceSentinel(0) catch unreachable,
                        },
                    };
                }
            },
        };
    }

    pub fn writeFileWithPathBuffer(pathbuf: *[bun.MAX_PATH_BYTES]u8, args: Arguments.WriteFile) Maybe(Return.WriteFile) {
        var path: [:0]const u8 = undefined;

        const fd = switch (args.file) {
            .path => brk: {
                path = args.file.path.sliceZ(pathbuf);
                break :brk switch (Syscall.openat(
                    args.dirfd,
                    path,
                    @intFromEnum(args.flag) | os.O.NOCTTY,
                    args.mode,
                )) {
                    .err => |err| return .{
                        .err = err.withPath(path),
                    },
                    .result => |fd_| fd_,
                };
            },
            .fd => |_fd| _fd,
        };

        defer {
            if (args.file == .path)
                _ = Syscall.close(fd);
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
                        // on linux, it's absolutely positioned
                        const pos = bun.sys.system.lseek(
                            fd,
                            @as(std.os.off_t, @intCast(0)),
                            std.os.linux.SEEK.CUR,
                        );

                        switch (bun.sys.getErrno(pos)) {
                            .SUCCESS => break :brk @as(usize, @intCast(pos)),
                            else => break :preallocate,
                        }
                    };

                    bun.C.preallocate_file(
                        fd,
                        @as(std.os.off_t, @intCast(offset)),
                        @as(std.os.off_t, @intCast(buf.len)),
                    ) catch {};
                }
            }
        }

        while (buf.len > 0) {
            switch (Syscall.write(fd, buf)) {
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
        if ((@intFromEnum(args.flag) & std.os.O.APPEND) == 0) {
            _ = ftruncateSync(.{ .fd = fd, .len = @as(JSC.WebCore.Blob.SizeType, @truncate(written)) });
        }

        return Maybe(Return.WriteFile).success;
    }

    pub fn writeFile(this: *NodeFS, args: Arguments.WriteFile, comptime flavor: Flavor) Maybe(Return.WriteFile) {
        switch (comptime flavor) {
            .sync => return writeFileWithPathBuffer(&this.sync_error_buf, args),
            else => {},
        }

        return Maybe(Return.WriteFile).todo;
    }

    pub fn readlink(this: *NodeFS, args: Arguments.Readlink, comptime flavor: Flavor) Maybe(Return.Readlink) {
        var outbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var inbuf = &this.sync_error_buf;
        switch (comptime flavor) {
            .sync => {
                const path = args.path.sliceZ(inbuf);

                const len = switch (Syscall.readlink(path, &outbuf)) {
                    .err => |err| return .{
                        .err = err.withPath(args.path.slice()),
                    },
                    .result => |buf_| buf_,
                };

                return .{
                    .result = switch (args.encoding) {
                        .buffer => .{
                            .buffer = Buffer.fromString(outbuf[0..len], bun.default_allocator) catch unreachable,
                        },
                        else => if (args.path == .slice_with_underlying_string and
                            strings.eqlLong(args.path.slice_with_underlying_string.slice(), outbuf[0..len], true))
                            .{
                                .BunString = args.path.slice_with_underlying_string.underlying.dupeRef(),
                            }
                        else
                            .{
                                .BunString = bun.String.create(outbuf[0..len]),
                            },
                    },
                };
            },
            else => {},
        }

        return Maybe(Return.Readlink).todo;
    }
    pub fn realpath(this: *NodeFS, args: Arguments.Realpath, comptime _: Flavor) Maybe(Return.Realpath) {
        var outbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var inbuf = &this.sync_error_buf;
        if (comptime Environment.allow_assert) std.debug.assert(FileSystem.instance_loaded);

        var path_slice = args.path.slice();

        var parts = [_]string{ FileSystem.instance.top_level_dir, path_slice };
        var path_ = FileSystem.instance.absBuf(&parts, inbuf);
        inbuf[path_.len] = 0;
        var path: [:0]u8 = inbuf[0..path_.len :0];

        const flags = if (comptime Environment.isLinux)
            // O_PATH is faster
            std.os.O.PATH
        else
            std.os.O.RDONLY;

        const fd = switch (Syscall.open(path, flags, 0)) {
            .err => |err| return .{
                .err = err.withPath(path),
            },
            .result => |fd_| fd_,
        };

        defer {
            _ = Syscall.close(fd);
        }

        const buf = switch (Syscall.getFdPath(fd, &outbuf)) {
            .err => |err| return .{
                .err = err.withPath(path),
            },
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
                        .BunString = args.path.slice_with_underlying_string.underlying.dupeRef(),
                    }
                else
                    .{
                        .BunString = bun.String.create(buf),
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
        var from_buf = &this.sync_error_buf;
        var to_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

        switch (comptime flavor) {
            .sync => {
                var from = args.old_path.sliceZ(from_buf);
                var to = args.new_path.sliceZ(&to_buf);
                return Syscall.rename(from, to);
            },
            else => {},
        }

        return Maybe(Return.Rename).todo;
    }
    pub fn rmdir(this: *NodeFS, args: Arguments.RmDir, comptime flavor: Flavor) Maybe(Return.Rmdir) {
        switch (comptime flavor) {
            .sync => {
                if (comptime Environment.isMac) {
                    if (args.recursive) {
                        var dest = args.path.sliceZ(&this.sync_error_buf);

                        var flags: u32 = bun.C.darwin.RemoveFileFlags.cross_mount |
                            bun.C.darwin.RemoveFileFlags.allow_long_paths |
                            bun.C.darwin.RemoveFileFlags.recursive;

                        while (true) {
                            if (Maybe(Return.Rmdir).errnoSys(bun.C.darwin.removefileat(std.os.AT.FDCWD, dest, null, flags), .rmdir)) |errno| {
                                switch (@as(os.E, @enumFromInt(errno.err.errno))) {
                                    .AGAIN, .INTR => continue,
                                    .NOENT => return Maybe(Return.Rmdir).success,
                                    .MLINK => {
                                        var copy: [bun.MAX_PATH_BYTES]u8 = undefined;
                                        @memcpy(copy[0..dest.len], dest);
                                        copy[dest.len] = 0;
                                        var dest_copy = copy[0..dest.len :0];
                                        switch (Syscall.unlink(dest_copy).getErrno()) {
                                            .AGAIN, .INTR => continue,
                                            .NOENT => return errno,
                                            .SUCCESS => continue,
                                            else => return errno,
                                        }
                                    },
                                    .SUCCESS => unreachable,
                                    else => return errno,
                                }
                            }

                            return Maybe(Return.Rmdir).success;
                        }
                    }

                    return Maybe(Return.Rmdir).errnoSysP(system.rmdir(args.path.sliceZ(&this.sync_error_buf)), .rmdir, args.path.slice()) orelse
                        Maybe(Return.Rmdir).success;
                } else if (comptime Environment.isLinux) {
                    if (args.recursive) {
                        std.fs.cwd().deleteTree(args.path.slice()) catch |err| {
                            const errno: std.os.E = switch (err) {
                                error.InvalidHandle => .BADF,
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

                    return Maybe(Return.Rmdir).errnoSysP(system.rmdir(args.path.sliceZ(&this.sync_error_buf)), .rmdir, args.path.slice()) orelse
                        Maybe(Return.Rmdir).success;
                }
            },
            else => {},
        }

        return Maybe(Return.Rmdir).todo;
    }
    pub fn rm(this: *NodeFS, args: Arguments.RmDir, comptime flavor: Flavor) Maybe(Return.Rm) {
        switch (comptime flavor) {
            .sync => {
                if (comptime Environment.isMac) {
                    var dest = args.path.sliceZ(&this.sync_error_buf);

                    while (true) {
                        var flags: u32 = 0;
                        if (args.recursive) {
                            flags |= bun.C.darwin.RemoveFileFlags.cross_mount;
                            flags |= bun.C.darwin.RemoveFileFlags.allow_long_paths;
                            flags |= bun.C.darwin.RemoveFileFlags.recursive;
                        }

                        if (Maybe(Return.Rm).errnoSys(bun.C.darwin.removefileat(std.os.AT.FDCWD, dest, null, flags), .unlink)) |errno| {
                            switch (@as(os.E, @enumFromInt(errno.err.errno))) {
                                .AGAIN, .INTR => continue,
                                .NOENT => {
                                    if (args.force) {
                                        return Maybe(Return.Rm).success;
                                    }

                                    return errno;
                                },

                                .MLINK => {
                                    var copy: [bun.MAX_PATH_BYTES]u8 = undefined;
                                    @memcpy(copy[0..dest.len], dest);
                                    copy[dest.len] = 0;
                                    var dest_copy = copy[0..dest.len :0];
                                    switch (Syscall.unlink(dest_copy).getErrno()) {
                                        .AGAIN, .INTR => continue,
                                        .NOENT => {
                                            if (args.force) {
                                                continue;
                                            }

                                            return errno;
                                        },
                                        .SUCCESS => continue,
                                        else => return errno,
                                    }
                                },
                                .SUCCESS => unreachable,
                                else => return errno,
                            }
                        }

                        return Maybe(Return.Rm).success;
                    }
                } else if (comptime Environment.isLinux or Environment.isWindows) {
                    if (args.recursive) {
                        std.fs.cwd().deleteTree(args.path.slice()) catch |err| {
                            const errno: E = switch (err) {
                                error.InvalidHandle => .BADF,
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
                }

                if (comptime Environment.isPosix) {
                    var dest = args.path.osPath(&this.sync_error_buf);
                    std.os.unlinkZ(dest) catch |er| {
                        // empircally, it seems to return AccessDenied when the
                        // file is actually a directory on macOS.
                        if (args.recursive and
                            (er == error.IsDir or er == error.NotDir or er == error.AccessDenied))
                        {
                            std.os.rmdirZ(dest) catch |err| {
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

                if (comptime Environment.isWindows) {
                    var dest = args.path.osPath(&this.sync_error_buf);
                    std.os.windows.DeleteFile(dest, .{
                        .dir = null,
                        .remove_dir = brk: {
                            const file_attrs = std.os.windows.GetFileAttributesW(dest.ptr) catch |err| {
                                if (args.force) {
                                    return Maybe(Return.Rm).success;
                                }

                                const code: E = switch (err) {
                                    error.FileNotFound => .NOENT,
                                    error.PermissionDenied => .PERM,
                                    else => .INVAL,
                                };

                                return .{
                                    .err = bun.sys.Error.fromCode(
                                        code,
                                        .unlink,
                                    ),
                                };
                            };
                            // TODO: check FILE_ATTRIBUTE_INVALID
                            break :brk (file_attrs & std.os.windows.FILE_ATTRIBUTE_DIRECTORY) != 0;
                        },
                    }) catch |er| {
                        // empircally, it seems to return AccessDenied when the
                        // file is actually a directory on macOS.

                        if (args.force) {
                            return Maybe(Return.Rm).success;
                        }

                        {
                            const code: E = switch (er) {
                                error.FileNotFound => .NOENT,
                                error.AccessDenied => .PERM,
                                error.NameTooLong => .INVAL,
                                error.FileBusy => .BUSY,
                                error.NotDir => .NOTDIR,
                                error.IsDir => .ISDIR,
                                error.DirNotEmpty => .INVAL,
                                error.NetworkNotFound => .NOENT,
                                else => .UNKNOWN,
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
            },
            else => {},
        }

        return Maybe(Return.Rm).todo;
    }
    pub fn stat(this: *NodeFS, args: Arguments.Stat, comptime flavor: Flavor) Maybe(Return.Stat) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Stat).todo;
        }
        _ = flavor;

        return @as(Maybe(Return.Stat), switch (Syscall.stat(
            args.path.sliceZ(
                &this.sync_error_buf,
            ),
        )) {
            .result => |result| Maybe(Return.Stat){ .result = .{ .stats = Stats.init(result, args.big_int) } },
            .err => |err| brk: {
                if (!args.throw_if_no_entry and err.getErrno() == .NOENT) {
                    return Maybe(Return.Stat){ .result = .{ .not_found = {} } };
                }
                break :brk Maybe(Return.Stat){ .err = err };
            },
        });
    }

    pub fn symlink(this: *NodeFS, args: Arguments.Symlink, comptime flavor: Flavor) Maybe(Return.Symlink) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Symlink).todo;
        }

        var to_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

        switch (comptime flavor) {
            .sync => {
                return Syscall.symlink(
                    args.old_path.sliceZ(&this.sync_error_buf),
                    args.new_path.sliceZ(&to_buf),
                );
            },
            else => {},
        }

        return Maybe(Return.Symlink).todo;
    }
    fn _truncate(this: *NodeFS, path: PathLike, len: JSC.WebCore.Blob.SizeType, comptime flavor: Flavor) Maybe(Return.Truncate) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Truncate).todo;
        }

        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Truncate).errno(C.truncate(path.sliceZ(&this.sync_error_buf), len)) orelse
                    Maybe(Return.Truncate).success;
            },
            else => {},
        }

        return Maybe(Return.Truncate).todo;
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
                flavor,
            ),
        };
    }
    pub fn unlink(this: *NodeFS, args: Arguments.Unlink, comptime flavor: Flavor) Maybe(Return.Unlink) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Unlink).todo;
        }

        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Unlink).errnoSysP(system.unlink(args.path.sliceZ(&this.sync_error_buf)), .unlink, args.path.slice()) orelse
                    Maybe(Return.Unlink).success;
            },
            else => {},
        }

        return Maybe(Return.Unlink).todo;
    }
    pub fn unwatchFile(_: *NodeFS, _: Arguments.UnwatchFile, comptime _: Flavor) Maybe(Return.UnwatchFile) {
        return Maybe(Return.UnwatchFile).todo;
    }
    pub fn utimes(this: *NodeFS, args: Arguments.Utimes, comptime flavor: Flavor) Maybe(Return.Utimes) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Utimes).todo;
        }

        var times = [2]std.c.timeval{
            .{
                .tv_sec = args.mtime,
                // TODO: is this correct?
                .tv_usec = 0,
            },
            .{
                .tv_sec = args.atime,
                // TODO: is this correct?
                .tv_usec = 0,
            },
        };

        switch (comptime flavor) {
            // futimes uses the syscall version
            // we use libc because here, not for a good reason
            // just missing from the linux syscall interface in zig and I don't want to modify that right now
            .sync => return if (Maybe(Return.Utimes).errnoSysP(std.c.utimes(args.path.sliceZ(&this.sync_error_buf), &times), .utimes, args.path.slice())) |err|
                err
            else
                Maybe(Return.Utimes).success,
            else => {},
        }

        return Maybe(Return.Utimes).todo;
    }

    pub fn lutimes(this: *NodeFS, args: Arguments.Lutimes, comptime flavor: Flavor) Maybe(Return.Lutimes) {
        if (comptime Environment.isWindows) {
            return Maybe(Return.Lutimes).todo;
        }

        var times = [2]std.c.timeval{
            .{
                .tv_sec = args.mtime,
                // TODO: is this correct?
                .tv_usec = 0,
            },
            .{
                .tv_sec = args.atime,
                // TODO: is this correct?
                .tv_usec = 0,
            },
        };

        switch (comptime flavor) {
            // futimes uses the syscall version
            // we use libc because here, not for a good reason
            // just missing from the linux syscall interface in zig and I don't want to modify that right now
            .sync => return if (Maybe(Return.Lutimes).errnoSysP(C.lutimes(args.path.sliceZ(&this.sync_error_buf), &times), .lutimes, args.path.slice())) |err|
                err
            else
                Maybe(Return.Lutimes).success,
            else => {},
        }

        return Maybe(Return.Lutimes).todo;
    }
    pub fn watch(_: *NodeFS, args: Arguments.Watch, comptime _: Flavor) Maybe(Return.Watch) {
        if (comptime Environment.isWindows) {
            args.global_this.throwTODO("watch is not supported on Windows yet");
            return Maybe(Return.Watch){ .result = JSC.JSValue.undefined };
        }

        const watcher = args.createFSWatcher() catch |err| {
            var buf = std.fmt.allocPrint(bun.default_allocator, "{s} watching {}", .{ @errorName(err), strings.QuotedFormatter{ .text = args.path.slice() } }) catch unreachable;
            defer bun.default_allocator.free(buf);
            args.global_this.throwValue((JSC.SystemError{
                .message = bun.String.init(buf),
                .path = bun.String.init(args.path.slice()),
            }).toErrorInstance(args.global_this));
            return Maybe(Return.Watch){ .result = JSC.JSValue.undefined };
        };
        return Maybe(Return.Watch){ .result = watcher };
    }
    pub fn createReadStream(_: *NodeFS, _: Arguments.CreateReadStream, comptime _: Flavor) Maybe(Return.CreateReadStream) {
        return Maybe(Return.CreateReadStream).todo;
    }
    pub fn createWriteStream(_: *NodeFS, _: Arguments.CreateWriteStream, comptime _: Flavor) Maybe(Return.CreateWriteStream) {
        return Maybe(Return.CreateWriteStream).todo;
    }

    /// This function is `cpSync`, but only if you pass `{ recursive: ..., force: ..., errorOnExist: ..., mode: ... }'
    /// The other options like `filter` use a JS fallback, see `src/js/internal/fs/cp.ts`
    pub fn cp(this: *NodeFS, args: Arguments.Cp, comptime flavor: Flavor) Maybe(Return.Cp) {
        comptime std.debug.assert(flavor == .sync);

        var src_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var dest_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var src = args.src.sliceZ(&src_buf);
        var dest = args.dest.sliceZ(&dest_buf);

        return this._cpSync(&src_buf, @intCast(src.len), &dest_buf, @intCast(dest.len), args.flags);
    }

    fn _cpSync(
        this: *NodeFS,
        src_buf: *[bun.MAX_PATH_BYTES]u8,
        src_dir_len: PathString.PathInt,
        dest_buf: *[bun.MAX_PATH_BYTES]u8,
        dest_dir_len: PathString.PathInt,
        args: Arguments.Cp.Flags,
    ) Maybe(Return.Cp) {
        const src = src_buf[0..src_dir_len :0];
        const dest = dest_buf[0..dest_dir_len :0];

        const stat_ = switch (Syscall.lstat(src)) {
            .result => |result| result,
            .err => |err| {
                @memcpy(this.sync_error_buf[0..src.len], src);
                return .{ .err = err.withPath(this.sync_error_buf[0..src.len]) };
            },
        };

        if (!os.S.ISDIR(stat_.mode)) {
            const r = this._copySingleFileSync(
                src,
                dest,
                @enumFromInt((if (args.errorOnExist or !args.force) Constants.COPYFILE_EXCL else @as(u8, 0))),
                stat_,
            );
            if (r == .err and r.err.errno == @intFromEnum(os.E.EXIST) and !args.errorOnExist) {
                return Maybe(Return.Cp).success;
            }
            return r;
        }

        if (!args.recursive) {
            @memcpy(this.sync_error_buf[0..src.len], src);
            return .{
                .err = .{
                    .errno = @intFromEnum(std.os.E.ISDIR),
                    .syscall = .copyfile,
                    .path = this.sync_error_buf[0..src.len],
                },
            };
        }

        if (comptime Environment.isMac) {
            if (Maybe(Return.Cp).errnoSysP(C.clonefile(src, dest, 0), .clonefile, src)) |err| {
                switch (err.getErrno()) {
                    .ACCES,
                    .NAMETOOLONG,
                    .ROFS,
                    .NOENT,
                    .PERM,
                    .INVAL,
                    => {
                        @memcpy(this.sync_error_buf[0..src.len], dest);
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

        const flags = os.O.DIRECTORY | os.O.RDONLY;
        const fd = switch (Syscall.open(src, flags, 0)) {
            .err => |err| {
                @memcpy(this.sync_error_buf[0..src.len], src);
                return .{ .err = err.withPath(this.sync_error_buf[0..src.len]) };
            },
            .result => |fd_| fd_,
        };
        defer _ = Syscall.close(fd);

        const mkdir_ = this.mkdirRecursive(.{
            .path = PathLike{ .string = PathString.init(dest) },
            .recursive = true,
        }, .sync);

        switch (mkdir_) {
            .err => |err| return Maybe(Return.Cp){ .err = err },
            .result => {},
        }

        var dir = std.fs.Dir{ .fd = fd };
        var iterator = DirIterator.iterate(dir);
        var entry = iterator.next();
        while (switch (entry) {
            .err => |err| {
                @memcpy(this.sync_error_buf[0..src.len], src);
                return .{ .err = err.withPath(this.sync_error_buf[0..src.len]) };
            },
            .result => |ent| ent,
        }) |current| : (entry = iterator.next()) {
            @memcpy(src_buf[src_dir_len + 1 .. src_dir_len + 1 + current.name.len], current.name.slice());
            src_buf[src_dir_len] = std.fs.path.sep;
            src_buf[src_dir_len + 1 + current.name.len] = 0;

            @memcpy(dest_buf[dest_dir_len + 1 .. dest_dir_len + 1 + current.name.len], current.name.slice());
            dest_buf[dest_dir_len] = std.fs.path.sep;
            dest_buf[dest_dir_len + 1 + current.name.len] = 0;

            switch (current.kind) {
                .directory => {
                    const r = this._cpSync(
                        src_buf,
                        src_dir_len + 1 + current.name.len,
                        dest_buf,
                        dest_dir_len + 1 + current.name.len,
                        args,
                    );
                    switch (r) {
                        .err => return r,
                        .result => {},
                    }
                },
                else => {
                    const r = this._copySingleFileSync(
                        src_buf[0 .. src_dir_len + 1 + current.name.len :0],
                        dest_buf[0 .. dest_dir_len + 1 + current.name.len :0],
                        @enumFromInt((if (args.errorOnExist or !args.force) Constants.COPYFILE_EXCL else @as(u8, 0))),
                        null,
                    );
                    switch (r) {
                        .err => {
                            if (r.err.errno == @intFromEnum(os.E.EXIST) and !args.errorOnExist) {
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

    /// This is `copyFile`, but it copies symlinks as-is
    pub fn _copySingleFileSync(
        this: *NodeFS,
        src: [:0]const u8,
        dest: [:0]const u8,
        mode: Constants.Copyfile,
        reuse_stat: ?std.os.Stat,
    ) Maybe(Return.CopyFile) {
        const ret = Maybe(Return.CopyFile);

        // TODO: do we need to fchown?
        if (comptime Environment.isMac) {
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

                if (!os.S.ISREG(stat_.mode)) {
                    if (os.S.ISLNK(stat_.mode)) {
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
                    const src_fd = switch (Syscall.open(src, std.os.O.RDONLY, 0o644)) {
                        .result => |result| result,
                        .err => |err| {
                            @memcpy(this.sync_error_buf[0..src.len], src);
                            return .{ .err = err.withPath(this.sync_error_buf[0..src.len]) };
                        },
                    };
                    defer {
                        _ = Syscall.close(src_fd);
                    }

                    var flags: Mode = std.os.O.CREAT | std.os.O.WRONLY;
                    var wrote: usize = 0;
                    if (mode.shouldntOverwrite()) {
                        flags |= std.os.O.EXCL;
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
                        _ = std.c.ftruncate(dest_fd, @as(std.c.off_t, @intCast(@as(u63, @truncate(wrote)))));
                        _ = C.fchmod(dest_fd, stat_.mode);
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

            return ret.errnoSysP(C.copyfile(src, dest, null, mode_), .copyfile, src) orelse ret.success;
        }

        if (comptime Environment.isLinux) {
            // https://manpages.debian.org/testing/manpages-dev/ioctl_ficlone.2.en.html
            if (mode.isForceClone()) {
                return Maybe(Return.CopyFile).todo;
            }

            const src_fd = switch (Syscall.open(src, std.os.O.RDONLY | std.os.O.NOFOLLOW, 0o644)) {
                .result => |result| result,
                .err => |err| {
                    if(err.getErrno() == .LOOP) {
                        // ELOOP is returned when you open a symlink with NOFOLLOW.
                        // as in, it does not actually let you open it.
return Syscall.symlink(
                    src,
                    dest
                );
                    }


                    return .{ .err = err };
                },
            };
            defer {
                _ = Syscall.close(src_fd);
            }

            const stat_: linux.Stat = switch (Syscall.fstat(src_fd)) {
                .result => |result| result,
                .err => |err| return Maybe(Return.CopyFile){ .err = err },
            };

            if (!os.S.ISREG(stat_.mode)) {
                return Maybe(Return.CopyFile){ .err = .{ .errno = @intFromEnum(C.SystemErrno.ENOTSUP) } };
            }

            var flags: Mode = std.os.O.CREAT | std.os.O.WRONLY;
            var wrote: usize = 0;
            if (mode.shouldntOverwrite()) {
                flags |= std.os.O.EXCL;
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

            defer {
                _ = linux.ftruncate(dest_fd, @as(i64, @intCast(@as(u63, @truncate(wrote)))));
                _ = linux.fchmod(dest_fd, stat_.mode);
                _ = Syscall.close(dest_fd);
            }

            var off_in_copy = @as(i64, @bitCast(@as(u64, 0)));
            var off_out_copy = @as(i64, @bitCast(@as(u64, 0)));

            if (!bun.canUseCopyFileRangeSyscall()) {
                return copyFileUsingReadWriteLoop(src, dest, src_fd, dest_fd, size, &wrote);
            }

            if (size == 0) {
                // copy until EOF
                while (true) {
                    // Linux Kernel 5.3 or later
                    const written = linux.copy_file_range(src_fd, &off_in_copy, dest_fd, &off_out_copy, std.mem.page_size, 0);
                    if (ret.errnoSysP(written, .copy_file_range, dest)) |err| {
                        return switch (err.getErrno()) {
                            .XDEV, .NOSYS => copyFileUsingReadWriteLoop(src, dest, src_fd, dest_fd, size, &wrote),
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
                    const written = linux.copy_file_range(src_fd, &off_in_copy, dest_fd, &off_out_copy, size, 0);
                    if (ret.errnoSysP(written, .copy_file_range, dest)) |err| {
                        return switch (err.getErrno()) {
                            .XDEV, .NOSYS => copyFileUsingReadWriteLoop(src, dest, src_fd, dest_fd, size, &wrote),
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

        return ret.todo;
    }

    /// Directory scanning + clonefile will block this thread, then each individual file copy (what the sync version
    /// calls "_copySingleFileSync") will be dispatched as a separate task.
    pub fn cpAsync(this: *NodeFS, task: *AsyncCpTask) void {
        const args = task.args;
        var src_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var dest_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var src = args.src.sliceZ(&src_buf);
        var dest = args.dest.sliceZ(&dest_buf);

        const stat_ = switch (Syscall.lstat(src)) {
            .result => |result| result,
            .err => |err| {
                @memcpy(this.sync_error_buf[0..src.len], src);
                task.finishConcurrently(.{ .err = err.withPath(this.sync_error_buf[0..src.len]) });
                return;
            },
        };

        if (!os.S.ISDIR(stat_.mode)) {
            // This is the only file, there is no point in dispatching subtasks
            const r = this._copySingleFileSync(
                src,
                dest,
                @enumFromInt((if (args.flags.errorOnExist or !args.flags.force) Constants.COPYFILE_EXCL else @as(u8, 0))),
                stat_,
            );
            if (r == .err and r.err.errno == @intFromEnum(os.E.EXIST) and !args.flags.errorOnExist) {
                task.finishConcurrently(Maybe(Return.Cp).success);
                return;
            }
            task.finishConcurrently(r);
            return;
        }

        if (!args.flags.recursive) {
            @memcpy(this.sync_error_buf[0..src.len], src);
            task.finishConcurrently(.{ .err = .{
                .errno = @intFromEnum(std.os.E.ISDIR),
                .syscall = .copyfile,
                .path = this.sync_error_buf[0..src.len],
            } });
            return;
        }

        const success = this._cpAsyncDirectory(args.flags, task, &src_buf, @intCast(src.len), &dest_buf, @intCast(dest.len));
        if (task.subtask_count == 0 and success) {
            task.finishConcurrently(Maybe(Return.Cp).success);
        }
    }

    // returns boolean `should_continue`
    fn _cpAsyncDirectory(
        this: *NodeFS,
        args: Arguments.Cp.Flags,
        task: *AsyncCpTask,
        src_buf: *[bun.MAX_PATH_BYTES]u8,
        src_dir_len: PathString.PathInt,
        dest_buf: *[bun.MAX_PATH_BYTES]u8,
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
                    .NOENT,
                    .PERM,
                    .INVAL,
                    => {
                        @memcpy(this.sync_error_buf[0..src.len], dest);
                        task.finishConcurrently(.{ .err = err.err.withPath(this.sync_error_buf[0..src.len]) });
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

        const open_flags = os.O.DIRECTORY | os.O.RDONLY;
        const fd = switch (Syscall.open(src, open_flags, 0)) {
            .err => |err| {
                @memcpy(this.sync_error_buf[0..src.len], src);
                task.finishConcurrently(.{ .err = err.withPath(this.sync_error_buf[0..src.len]) });
                return false;
            },
            .result => |fd_| fd_,
        };
        defer _ = Syscall.close(fd);

        const mkdir_ = this.mkdirRecursive(.{
            .path = PathLike{ .string = PathString.init(dest) },
            .recursive = true,
        }, .sync);
        switch (mkdir_) {
            .err => |err| {
                task.finishConcurrently(.{ .err = err });
                return false;
            },
            .result => {},
        }

        var dir = std.fs.Dir{ .fd = fd };
        var iterator = DirIterator.iterate(dir);
        var entry = iterator.next();
        while (switch (entry) {
            .err => |err| {
                @memcpy(this.sync_error_buf[0..src.len], src);
                task.finishConcurrently(.{ .err = err.withPath(this.sync_error_buf[0..src.len]) });
                return false;
            },
            .result => |ent| ent,
        }) |current| : (entry = iterator.next()) {
            switch (current.kind) {
                .directory => {
                    @memcpy(src_buf[src_dir_len + 1 .. src_dir_len + 1 + current.name.len], current.name.slice());
                    src_buf[src_dir_len] = std.fs.path.sep;
                    src_buf[src_dir_len + 1 + current.name.len] = 0;

                    @memcpy(dest_buf[dest_dir_len + 1 .. dest_dir_len + 1 + current.name.len], current.name.slice());
                    dest_buf[dest_dir_len] = std.fs.path.sep;
                    dest_buf[dest_dir_len + 1 + current.name.len] = 0;

                    const should_continue = this._cpAsyncDirectory(
                        args,
                        task,
                        src_buf,
                        src_dir_len + 1 + current.name.len,
                        dest_buf,
                        dest_dir_len + 1 + current.name.len,
                    );
                    if (!should_continue) return false;
                },
                else => {
                    _ = @atomicRmw(usize, &task.subtask_count, .Add, 1, .Monotonic);

                    // Allocate a path buffer for the path data
                    var path_buf = bun.default_allocator.alloc(
                        u8,
                        src_dir_len + 1 + current.name.len + 1 + dest_dir_len + 1 + current.name.len + 1,
                    ) catch @panic("Out of memory");

                    // TODO: make this more readable
                    @memcpy(path_buf[0..src_dir_len], src_buf[0..src_dir_len]);
                    path_buf[src_dir_len] = std.fs.path.sep;
                    @memcpy(path_buf[src_dir_len + 1 .. src_dir_len + 1 + current.name.len], current.name.slice());
                    path_buf[src_dir_len + 1 + current.name.len] = 0;

                    @memcpy(path_buf[src_dir_len + 1 + current.name.len + 1 .. src_dir_len + 1 + current.name.len + 1 + dest_dir_len], dest_buf[0..dest_dir_len]);
                    path_buf[src_dir_len + 1 + current.name.len + 1 + dest_dir_len] = std.fs.path.sep;
                    @memcpy(path_buf[src_dir_len + 1 + current.name.len + 1 + dest_dir_len + 1 .. src_dir_len + 1 + current.name.len + 1 + dest_dir_len + 1 + current.name.len], current.name.slice());
                    path_buf[src_dir_len + 1 + current.name.len + 1 + dest_dir_len + 1 + current.name.len] = 0;

                    AsyncCpSingleFileTask.create(
                        task,
                        path_buf[0 .. src_dir_len + 1 + current.name.len :0],
                        path_buf[src_dir_len + 1 + current.name.len + 1 .. src_dir_len + 1 + current.name.len + 1 + dest_dir_len + 1 + current.name.len :0],
                    );
                },
            }
        }

        return true;
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
