const std = @import("std");
const JSC = @import("root").bun.JSC;
const bun = @import("root").bun;
const Fs = @import("../../fs.zig");
const Path = @import("../../resolver/resolve_path.zig");
const Encoder = JSC.WebCore.Encoder;
const Mutex = @import("../../lock.zig").Lock;

const VirtualMachine = JSC.VirtualMachine;
const EventLoop = JSC.EventLoop;
const PathLike = JSC.Node.PathLike;
const ArgumentsSlice = JSC.Node.ArgumentsSlice;
const Output = bun.Output;
const string = bun.string;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const Environment = bun.Environment;
const Async = bun.Async;

const PathWatcher = if (Environment.isWindows) @import("./win_watcher.zig") else @import("./path_watcher.zig");
pub const FSWatcher = struct {
    ctx: *VirtualMachine,
    verbose: bool = false,

    // JSObject
    mutex: Mutex,
    signal: ?*JSC.AbortSignal,
    persistent: bool,
    path_watcher: ?*PathWatcher.PathWatcher,
    poll_ref: Async.KeepAlive = .{},
    globalThis: *JSC.JSGlobalObject,
    js_this: JSC.JSValue,
    encoding: JSC.Node.Encoding,
    // user can call close and pre-detach so we need to track this
    closed: bool,
    // counts pending tasks so we only deinit after all tasks are done
    task_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    has_pending_activity: std.atomic.Value(bool),
    current_task: FSWatchTask = undefined,
    pub usingnamespace JSC.Codegen.JSFSWatcher;
    pub usingnamespace bun.New(@This());

    pub fn eventLoop(this: FSWatcher) *EventLoop {
        return this.ctx.eventLoop();
    }

    pub fn enqueueTaskConcurrent(this: FSWatcher, task: *JSC.ConcurrentTask) void {
        this.eventLoop().enqueueTaskConcurrent(task);
    }

    pub fn deinit(this: *FSWatcher) void {
        // stop all managers and signals
        this.detach();
        this.destroy();
    }

    pub const FSWatchTask = struct {
        ctx: *FSWatcher,
        count: u8 = 0,

        entries: [8]Entry = undefined,
        concurrent_task: JSC.ConcurrentTask = undefined,

        pub const EventType = enum {
            rename,
            change,
            @"error",
            abort,
        };

        pub const Entry = struct {
            file_path: string,
            event_type: EventType,
            needs_free: bool,
        };

        pub fn append(this: *FSWatchTask, file_path: string, event_type: EventType, needs_free: bool) void {
            if (this.count == 8) {
                this.enqueue();
                const ctx = this.ctx;
                this.* = .{
                    .ctx = ctx,
                    .count = 0,
                };
            }

            this.entries[this.count] = .{
                .file_path = file_path,
                .event_type = event_type,
                .needs_free = needs_free,
            };
            this.count += 1;
        }

        pub fn run(this: *FSWatchTask) void {
            // this runs on JS Context Thread

            for (this.entries[0..this.count]) |entry| {
                switch (entry.event_type) {
                    .rename => {
                        this.ctx.emit(entry.file_path, "rename");
                    },
                    .change => {
                        this.ctx.emit(entry.file_path, "change");
                    },
                    .@"error" => {
                        // file_path is the error message in this case
                        this.ctx.emitError(entry.file_path);
                    },
                    .abort => {
                        this.ctx.emitIfAborted();
                    },
                }
            }

            this.ctx.unrefTask();
        }

        pub fn enqueue(this: *FSWatchTask) void {
            if (this.count == 0)
                return;

            // if false is closed or detached (can still contain valid refs but will not create a new one)
            if (this.ctx.refTask()) {
                var that = FSWatchTask.new(this.*);
                this.count = 0;
                that.concurrent_task.task = JSC.Task.init(that);
                this.ctx.enqueueTaskConcurrent(&that.concurrent_task);
                return;
            }
            // closed or detached so just cleanEntries
            this.cleanEntries();
        }
        pub fn cleanEntries(this: *FSWatchTask) void {
            for (this.entries[0..this.count]) |entry| {
                if (entry.needs_free) {
                    bun.default_allocator.free(entry.file_path);
                }
            }
            this.count = 0;
        }

        pub usingnamespace bun.New(@This());

        pub fn deinit(this: *FSWatchTask) void {
            this.cleanEntries();
            if (comptime Environment.allow_assert) {
                std.debug.assert(&this.ctx.current_task != this);
            }
            this.destroy();
        }
    };

    pub fn onPathUpdate(ctx: ?*anyopaque, path: string, is_file: bool, event_type: PathWatcher.PathWatcher.EventType) void {
        const this = bun.cast(*FSWatcher, ctx.?);

        const relative_path = bun.default_allocator.dupe(u8, path) catch unreachable;

        if (this.verbose and event_type != .@"error") {
            if (is_file) {
                Output.prettyErrorln("<r> <d>File changed: {s}<r>", .{relative_path});
            } else {
                Output.prettyErrorln("<r> <d>Dir changed: {s}<r>", .{relative_path});
            }
        }

        switch (event_type) {
            .rename => {
                this.current_task.append(relative_path, .rename, true);
            },
            .change => {
                this.current_task.append(relative_path, .change, true);
            },
            else => {
                this.current_task.append(relative_path, .@"error", true);
            },
        }
    }

    pub fn onUpdateEnd(ctx: ?*anyopaque) void {
        const this = bun.cast(*FSWatcher, ctx.?);
        if (this.verbose) {
            Output.flush();
        }
        // we only enqueue after all events are processed
        this.current_task.enqueue();
    }

    pub const Arguments = struct {
        path: PathLike,
        listener: JSC.JSValue,
        global_this: JSC.C.JSContextRef,
        signal: ?*JSC.AbortSignal,
        persistent: bool,
        recursive: bool,
        encoding: JSC.Node.Encoding,
        verbose: bool,
        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?Arguments {
            const vm = ctx.vm();
            const path = PathLike.fromJS(ctx, arguments, exception) orelse {
                if (exception.* == null) {
                    JSC.throwInvalidArguments(
                        "filename must be a string or TypedArray",
                        .{},
                        ctx,
                        exception,
                    );
                }
                return null;
            };

            if (exception.* != null) return null;
            var listener: JSC.JSValue = .zero;
            var signal: ?*JSC.AbortSignal = null;
            var persistent: bool = true;
            var recursive: bool = false;
            var encoding: JSC.Node.Encoding = .utf8;
            var verbose = false;
            if (arguments.nextEat()) |options_or_callable| {

                // options
                if (options_or_callable.isObject()) {
                    if (options_or_callable.get(ctx, "persistent")) |persistent_| {
                        if (!persistent_.isBoolean()) {
                            JSC.throwInvalidArguments(
                                "persistent must be a boolean.",
                                .{},
                                ctx,
                                exception,
                            );
                            return null;
                        }
                        persistent = persistent_.toBoolean();
                    }

                    if (options_or_callable.get(ctx, "verbose")) |verbose_| {
                        if (!verbose_.isBoolean()) {
                            JSC.throwInvalidArguments(
                                "verbose must be a boolean.",
                                .{},
                                ctx,
                                exception,
                            );
                            return null;
                        }
                        verbose = verbose_.toBoolean();
                    }

                    if (options_or_callable.get(ctx, "encoding")) |encoding_| {
                        if (!encoding_.isString()) {
                            JSC.throwInvalidArguments(
                                "encoding must be a string.",
                                .{},
                                ctx,
                                exception,
                            );
                            return null;
                        }
                        if (JSC.Node.Encoding.fromJS(encoding_, ctx.ptr())) |node_encoding| {
                            encoding = node_encoding;
                        } else {
                            JSC.throwInvalidArguments(
                                "invalid encoding.",
                                .{},
                                ctx,
                                exception,
                            );
                            return null;
                        }
                    }

                    if (options_or_callable.get(ctx, "recursive")) |recursive_| {
                        if (!recursive_.isBoolean()) {
                            JSC.throwInvalidArguments(
                                "recursive must be a boolean.",
                                .{},
                                ctx,
                                exception,
                            );
                            return null;
                        }
                        recursive = recursive_.toBoolean();
                    }

                    // abort signal
                    if (options_or_callable.get(ctx, "signal")) |signal_| {
                        if (JSC.AbortSignal.fromJS(signal_)) |signal_obj| {
                            //Keep it alive
                            signal_.ensureStillAlive();
                            signal = signal_obj;
                        } else {
                            JSC.throwInvalidArguments(
                                "signal is not of type AbortSignal.",
                                .{},
                                ctx,
                                exception,
                            );

                            return null;
                        }
                    }

                    // listener
                    if (arguments.nextEat()) |callable| {
                        if (!callable.isCell() or !callable.isCallable(vm)) {
                            exception.* = JSC.toInvalidArguments("Expected \"listener\" callback to be a function", .{}, ctx).asObjectRef();
                            return null;
                        }
                        listener = callable;
                    }
                } else {
                    if (!options_or_callable.isCell() or !options_or_callable.isCallable(vm)) {
                        exception.* = JSC.toInvalidArguments("Expected \"listener\" callback to be a function", .{}, ctx).asObjectRef();
                        return null;
                    }
                    listener = options_or_callable;
                }
            }
            if (listener == .zero) {
                exception.* = JSC.toInvalidArguments("Expected \"listener\" callback", .{}, ctx).asObjectRef();
                return null;
            }

            return Arguments{
                .path = path,
                .listener = listener,
                .global_this = ctx,
                .signal = signal,
                .persistent = persistent,
                .recursive = recursive,
                .encoding = encoding,
                .verbose = verbose,
            };
        }

        pub fn createFSWatcher(this: Arguments) !JSC.JSValue {
            const obj = try FSWatcher.init(this);
            if (obj.js_this != .zero) {
                return obj.js_this;
            }
            return JSC.JSValue.jsUndefined();
        }
    };

    pub fn initJS(this: *FSWatcher, listener: JSC.JSValue) void {
        if (this.persistent) {
            this.poll_ref.ref(this.ctx);
        }

        const js_this = FSWatcher.toJS(this, this.globalThis);
        js_this.ensureStillAlive();
        this.js_this = js_this;
        FSWatcher.listenerSetCached(js_this, this.globalThis, listener);

        if (this.signal) |s| {
            // already aborted?
            if (s.aborted()) {
                // safely abort next tick
                this.current_task = .{
                    .ctx = this,
                };
                this.current_task.append("", .abort, false);
                this.current_task.enqueue();
            } else {
                // watch for abortion
                this.signal = s.listen(FSWatcher, this, FSWatcher.emitAbort);
            }
        }
    }

    pub fn emitIfAborted(this: *FSWatcher) void {
        if (this.signal) |s| {
            if (s.aborted()) {
                const err = s.abortReason();
                this.emitAbort(err);
            }
        }
    }

    pub fn emitAbort(this: *FSWatcher, err: JSC.JSValue) void {
        if (this.closed) return;
        defer this.close();

        err.ensureStillAlive();
        if (this.js_this != .zero) {
            const js_this = this.js_this;
            js_this.ensureStillAlive();
            if (FSWatcher.listenerGetCached(js_this)) |listener| {
                listener.ensureStillAlive();
                var args = [_]JSC.JSValue{
                    JSC.ZigString.static("error").toValue(this.globalThis),
                    if (err.isEmptyOrUndefinedOrNull()) JSC.WebCore.AbortSignal.createAbortError(JSC.ZigString.static("The user aborted a request"), &JSC.ZigString.Empty, this.globalThis) else err,
                };
                _ = listener.callWithGlobalThis(
                    this.globalThis,
                    &args,
                );
            }
        }
    }
    pub fn emitError(this: *FSWatcher, err: string) void {
        if (this.closed) return;
        defer this.close();

        if (this.js_this != .zero) {
            const js_this = this.js_this;
            js_this.ensureStillAlive();
            if (FSWatcher.listenerGetCached(js_this)) |listener| {
                listener.ensureStillAlive();
                var args = [_]JSC.JSValue{
                    JSC.ZigString.static("error").toValue(this.globalThis),
                    JSC.ZigString.fromUTF8(err).toErrorInstance(this.globalThis),
                };
                _ = listener.callWithGlobalThis(
                    this.globalThis,
                    &args,
                );
            }
        }
    }

    pub fn emit(this: *FSWatcher, file_name: string, comptime eventType: string) void {
        if (this.js_this != .zero) {
            const js_this = this.js_this;
            js_this.ensureStillAlive();
            if (FSWatcher.listenerGetCached(js_this)) |listener| {
                listener.ensureStillAlive();
                var filename: JSC.JSValue = JSC.JSValue.jsUndefined();
                if (file_name.len > 0) {
                    if (this.encoding == .buffer)
                        filename = JSC.ArrayBuffer.createBuffer(this.globalThis, file_name)
                    else if (this.encoding == .utf8) {
                        filename = JSC.ZigString.fromUTF8(file_name).toValueGC(this.globalThis);
                    } else {
                        // convert to desired encoding
                        filename = Encoder.toStringAtRuntime(file_name.ptr, file_name.len, this.globalThis, this.encoding);
                    }
                }
                var args = [_]JSC.JSValue{
                    JSC.ZigString.static(eventType).toValue(this.globalThis),
                    filename,
                };
                _ = listener.callWithGlobalThis(
                    this.globalThis,
                    &args,
                );
            }
        }
    }

    pub fn doRef(this: *FSWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (!this.closed and !this.persistent) {
            this.persistent = true;
            this.poll_ref.ref(this.ctx);
        }
        return JSC.JSValue.jsUndefined();
    }

    pub fn doUnref(this: *FSWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        if (this.persistent) {
            this.persistent = false;
            this.poll_ref.unref(this.ctx);
        }
        return JSC.JSValue.jsUndefined();
    }

    pub fn hasRef(this: *FSWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.persistent);
    }

    // this can be called from Watcher Thread or JS Context Thread
    pub fn refTask(this: *FSWatcher) bool {
        this.mutex.lock();
        defer this.mutex.unlock();
        // stop new references
        if (this.closed) return false;
        _ = this.task_count.fetchAdd(1, .Monotonic);
        return true;
    }

    pub fn hasPendingActivity(this: *FSWatcher) callconv(.C) bool {
        @fence(.Acquire);
        return this.has_pending_activity.load(.Acquire);
    }
    // only called from Main Thread
    pub fn updateHasPendingActivity(this: *FSWatcher) void {
        @fence(.Release);
        this.has_pending_activity.store(false, .Release);
    }

    // unref is always called on main JS Context Thread
    pub fn unrefTask(this: *FSWatcher) void {
        this.mutex.lock();
        defer this.mutex.unlock();

        const new_count = this.task_count.fetchSub(1, .Monotonic);
        if (this.closed and new_count == 0) {
            this.updateHasPendingActivity();
        }
    }

    pub fn close(
        this: *FSWatcher,
    ) void {
        this.mutex.lock();
        if (!this.closed) {
            this.closed = true;

            // emit should only be called unlocked
            this.mutex.unlock();

            this.emit("", "close");
            // we immediately detach here
            this.detach();

            // no need to lock again, because ref checks closed and unref is only called on main thread
            if (this.task_count.load(.Monotonic) == 0) {
                this.updateHasPendingActivity();
            }
        } else {
            this.mutex.unlock();
        }
    }

    // this can be called multiple times
    pub fn detach(this: *FSWatcher) void {
        if (this.signal) |signal| {
            this.signal = null;
            signal.detach(this);
        }

        if (this.path_watcher) |path_watcher| {
            this.path_watcher = null;
            path_watcher.deinit();
        }

        if (this.persistent) {
            this.persistent = false;
            this.poll_ref.unref(this.ctx);
        }
        this.js_this = .zero;
    }

    pub fn doClose(this: *FSWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        this.close();
        return JSC.JSValue.jsUndefined();
    }

    pub fn finalize(this: *FSWatcher) callconv(.C) void {
        this.deinit();
    }

    pub fn init(args: Arguments) !*FSWatcher {
        var buf: [bun.MAX_PATH_BYTES + 1]u8 = undefined;
        var slice = args.path.slice();
        if (bun.strings.startsWith(slice, "file://")) {
            slice = slice[6..];
        }

        var parts = [_]string{
            slice,
        };

        const cwd = try bun.getcwd(&buf);
        buf[cwd.len] = std.fs.path.sep;

        var joined_buf: [bun.MAX_PATH_BYTES + 1]u8 = undefined;
        const file_path = Path.joinAbsStringBuf(
            buf[0 .. cwd.len + 1],
            &joined_buf,
            &parts,
            .auto,
        );

        joined_buf[file_path.len] = 0;
        const file_path_z = joined_buf[0..file_path.len :0];

        const vm = args.global_this.bunVM();

        var ctx = FSWatcher.new(.{
            .ctx = vm,
            .current_task = .{
                .ctx = undefined,
                .count = 0,
            },
            .mutex = Mutex.init(),
            .signal = if (args.signal) |s| s.ref() else null,
            .persistent = args.persistent,
            .path_watcher = null,
            .globalThis = args.global_this,
            .js_this = .zero,
            .encoding = args.encoding,
            .closed = false,
            .has_pending_activity = std.atomic.Value(bool).init(true),
            .verbose = args.verbose,
        });
        ctx.current_task.ctx = ctx;

        errdefer ctx.deinit();

        ctx.path_watcher = if (args.signal == null or !args.signal.?.aborted())
            try PathWatcher.watch(vm, file_path_z, args.recursive, onPathUpdate, onUpdateEnd, bun.cast(*anyopaque, ctx))
        else
            null;
        ctx.initJS(args.listener);
        return ctx;
    }
};
