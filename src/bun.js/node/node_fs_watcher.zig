const std = @import("std");
const JSC = bun.JSC;
const bun = @import("root").bun;
const Fs = @import("../../fs.zig");
const Path = @import("../../resolver/resolve_path.zig");
const Encoder = JSC.WebCore.Encoder;
const Mutex = bun.Mutex;

const VirtualMachine = JSC.VirtualMachine;
const EventLoop = JSC.EventLoop;
const PathLike = JSC.Node.PathLike;
const ArgumentsSlice = JSC.Node.ArgumentsSlice;
const Output = bun.Output;
const string = bun.string;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const Environment = bun.Environment;
const Async = bun.Async;
const log = Output.scoped(.@"fs.watch", true);
const PathWatcher = if (Environment.isWindows) @import("./win_watcher.zig") else @import("./path_watcher.zig");

pub const FSWatcher = struct {
    ctx: *VirtualMachine,
    verbose: bool = false,

    mutex: Mutex,
    signal: ?*JSC.AbortSignal,
    persistent: bool,
    path_watcher: ?*PathWatcher.PathWatcher,
    poll_ref: Async.KeepAlive = .{},
    globalThis: *JSC.JSGlobalObject,
    js_this: JSC.JSValue,
    encoding: JSC.Node.Encoding,

    /// User can call close and pre-detach so we need to track this
    closed: bool,

    /// While it's not closed, the pending activity
    pending_activity_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),
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

    pub const FSWatchTask = if (Environment.isWindows) FSWatchTaskWindows else FSWatchTaskPosix;
    pub const FSWatchTaskPosix = struct {
        ctx: *FSWatcher,
        count: u8 = 0,

        entries: [8]Entry = undefined,
        concurrent_task: JSC.ConcurrentTask = undefined,

        pub const Entry = struct {
            event: Event,
            needs_free: bool,
        };

        pub fn append(this: *FSWatchTask, event: Event, needs_free: bool) void {
            if (this.count == 8) {
                this.enqueue();
                const ctx = this.ctx;
                this.* = .{
                    .ctx = ctx,
                    .count = 0,
                };
            }

            this.entries[this.count] = .{
                .event = event,
                .needs_free = needs_free,
            };
            this.count += 1;
        }

        pub fn run(this: *FSWatchTask) void {
            // this runs on JS Context Thread

            for (this.entries[0..this.count]) |entry| {
                switch (entry.event) {
                    inline .rename, .change => |file_path, t| {
                        this.ctx.emit(file_path, t);
                    },
                    .@"error" => |err| {
                        this.ctx.emitError(err);
                    },
                    .abort => {
                        this.ctx.emitIfAborted();
                    },
                    .close => {
                        this.ctx.emit("", .close);
                    },
                }
            }

            this.ctx.unrefTask();
        }

        pub fn appendAbort(this: *FSWatchTask) void {
            this.append(.abort, false);
            this.enqueue();
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
            for (this.entries[0..this.count]) |*entry| {
                if (entry.needs_free) {
                    entry.event.deinit();
                }
            }
            this.count = 0;
        }

        pub usingnamespace bun.New(@This());

        pub fn deinit(this: *FSWatchTask) void {
            this.cleanEntries();
            if (comptime Environment.allow_assert) {
                bun.assert(&this.ctx.current_task != this);
            }
            this.destroy();
        }
    };

    pub const EventPathString = switch (Environment.os) {
        .windows => FSWatchTaskWindows.StringOrBytesToDecode,
        else => []const u8,
    };

    pub const Event = union(EventType) {
        rename: EventPathString,
        change: EventPathString,
        @"error": bun.sys.Error,
        abort: void,
        close: void,

        pub fn dupe(event: Event) !Event {
            return switch (event) {
                inline .rename, .change => |path, t| @unionInit(Event, @tagName(t), try bun.default_allocator.dupe(u8, path)),
                inline else => |value, t| @unionInit(Event, @tagName(t), value),
            };
        }

        pub fn deinit(event: *Event) void {
            switch (event.*) {
                .rename, .change => |*path| switch (Environment.os) {
                    else => bun.default_allocator.free(path.*),
                    .windows => path.deinit(),
                },
                else => {},
            }
        }
    };

    pub const EventType = enum(u8) {
        rename = 0,
        change = 1,
        @"error" = 2,
        abort = 3,
        close = 4,

        pub fn toJS(
            this: EventType,
            globalObject: *JSC.JSGlobalObject,
        ) JSC.JSValue {
            return Bun__domEventNameToJS(globalObject, this);
        }

        extern fn Bun__domEventNameToJS(*JSC.JSGlobalObject, EventType) JSC.JSValue;
    };

    pub const FSWatchTaskWindows = struct {
        event: Event = .{ .@"error" = .{ .errno = @intFromEnum(bun.C.SystemErrno.EINVAL), .syscall = .watch } },
        ctx: *FSWatcher,

        /// Unused: To match the API of the posix version
        count: u0 = 0,

        pub usingnamespace bun.New(@This());

        pub const StringOrBytesToDecode = union(enum) {
            string: bun.String,
            bytes_to_free: []const u8,

            pub fn deinit(this: *StringOrBytesToDecode) void {
                switch (this.*) {
                    .string => this.string.deref(),
                    .bytes_to_free => {
                        bun.default_allocator.free(this.bytes_to_free);
                        this.bytes_to_free = "";
                    },
                }
            }

            pub fn format(this: *const StringOrBytesToDecode, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                switch (this.*) {
                    .string => |str| try writer.print("{}", .{str}),
                    .bytes_to_free => |utf8| try writer.print("{s}", .{utf8}),
                }
            }
        };

        pub fn appendAbort(this: *FSWatchTaskWindows) void {
            const ctx = this.ctx;
            const task = FSWatchTaskWindows.new(.{
                .ctx = ctx,
                .event = .abort,
            });

            ctx.eventLoop().enqueueTask(JSC.Task.init(task));
        }

        /// this runs on JS Context Thread
        pub fn run(this: *FSWatchTaskWindows) void {
            var ctx = this.ctx;

            switch (this.event) {
                inline .rename, .change => |*path, event_type| {
                    if (ctx.encoding == .utf8) {
                        ctx.emitWithFilename(path.string.transferToJS(ctx.globalThis), event_type);
                    } else {
                        const bytes = path.bytes_to_free;
                        path.bytes_to_free = "";
                        ctx.emit(bytes, event_type);
                        bun.default_allocator.free(bytes);
                    }
                },
                .@"error" => |err| {
                    ctx.emitError(err);
                },
                .abort => {
                    ctx.emitIfAborted();
                },
                .close => {
                    ctx.emit("", .close);
                },
            }

            ctx.unrefTask();
        }

        pub fn deinit(this: *FSWatchTaskWindows) void {
            this.event.deinit();
            this.destroy();
        }
    };

    pub fn onPathUpdatePosix(ctx: ?*anyopaque, event: Event, is_file: bool) void {
        const this = bun.cast(*FSWatcher, ctx.?);

        if (this.verbose) {
            switch (event) {
                .rename, .change => |value| {
                    if (is_file) {
                        Output.prettyErrorln("<r> <d>File changed: {s}<r>", .{value});
                    } else {
                        Output.prettyErrorln("<r> <d>Dir changed: {s}<r>", .{value});
                    }
                },
                else => {},
            }
        }

        const cloned = event.dupe() catch bun.outOfMemory();
        this.current_task.append(cloned, true);
    }

    pub fn onPathUpdateWindows(ctx: ?*anyopaque, event: Event, is_file: bool) void {
        const this = bun.cast(*FSWatcher, ctx.?);

        if (this.verbose) {
            switch (event) {
                .rename, .change => |value| {
                    if (is_file) {
                        Output.prettyErrorln("<r> <d>File changed: {}<r>", .{value});
                    } else {
                        Output.prettyErrorln("<r> <d>Dir changed: {}<r>", .{value});
                    }
                },
                else => {},
            }
        }

        if (!this.refTask()) {
            return;
        }

        const task = FSWatchTaskWindows.new(.{
            .ctx = this,
            .event = event,
        });
        this.eventLoop().enqueueTask(JSC.Task.init(task));
    }

    pub const onPathUpdate = if (Environment.isWindows) onPathUpdateWindows else onPathUpdatePosix;

    pub fn onUpdateEnd(ctx: ?*anyopaque) void {
        const this = bun.cast(*FSWatcher, ctx.?);
        if (this.verbose) {
            Output.flush();
        }
        if (comptime Environment.isPosix) {
            // we only enqueue after all events are processed
            this.current_task.enqueue();
        }
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

        pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice) bun.JSError!Arguments {
            const vm = ctx.vm();
            const path = try PathLike.fromJS(ctx, arguments) orelse {
                return ctx.throwInvalidArguments("filename must be a string or TypedArray", .{});
            };
            var should_deinit_path = true;
            defer if (should_deinit_path) path.deinit();

            var listener: JSC.JSValue = .zero;
            var signal: ?*JSC.AbortSignal = null;
            var persistent: bool = true;
            var recursive: bool = false;
            var encoding: JSC.Node.Encoding = .utf8;
            var verbose = false;
            if (arguments.nextEat()) |options_or_callable| {

                // options
                if (options_or_callable.isObject()) {
                    if (try options_or_callable.getTruthy(ctx, "persistent")) |persistent_| {
                        if (!persistent_.isBoolean()) {
                            return ctx.throwInvalidArguments("persistent must be a boolean", .{});
                        }
                        persistent = persistent_.toBoolean();
                    }

                    if (try options_or_callable.getTruthy(ctx, "verbose")) |verbose_| {
                        if (!verbose_.isBoolean()) {
                            return ctx.throwInvalidArguments("verbose must be a boolean", .{});
                        }
                        verbose = verbose_.toBoolean();
                    }

                    if (options_or_callable.fastGet(ctx, .encoding)) |encoding_| {
                        encoding = try JSC.Node.Encoding.assert(encoding_, ctx, encoding);
                    }

                    if (try options_or_callable.getTruthy(ctx, "recursive")) |recursive_| {
                        if (!recursive_.isBoolean()) {
                            return ctx.throwInvalidArguments("recursive must be a boolean", .{});
                        }
                        recursive = recursive_.toBoolean();
                    }

                    // abort signal
                    if (try options_or_callable.getTruthy(ctx, "signal")) |signal_| {
                        if (JSC.AbortSignal.fromJS(signal_)) |signal_obj| {
                            //Keep it alive
                            signal_.ensureStillAlive();
                            signal = signal_obj;
                        } else {
                            return ctx.throwInvalidArguments("signal is not of type AbortSignal", .{});
                        }
                    }

                    // listener
                    if (arguments.nextEat()) |callable| {
                        if (!callable.isCell() or !callable.isCallable(vm)) {
                            return ctx.throwInvalidArguments("Expected \"listener\" callback to be a function", .{});
                        }
                        listener = callable;
                    }
                } else {
                    if (!options_or_callable.isCell() or !options_or_callable.isCallable(vm)) {
                        return ctx.throwInvalidArguments("Expected \"listener\" callback to be a function", .{});
                    }
                    listener = options_or_callable;
                }
            }
            if (listener == .zero) {
                return ctx.throwInvalidArguments("Expected \"listener\" callback", .{});
            }

            should_deinit_path = false;

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

        pub fn createFSWatcher(this: Arguments) JSC.Maybe(JSC.JSValue) {
            return switch (FSWatcher.init(this)) {
                .result => |result| .{ .result = result.js_this },
                .err => |err| .{ .err = err },
            };
        }
    };

    pub fn initJS(this: *FSWatcher, listener: JSC.JSValue) void {
        if (this.persistent) {
            this.poll_ref.ref(this.ctx);
            _ = this.pending_activity_count.fetchAdd(1, .monotonic);
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
                this.current_task.appendAbort();
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
        _ = this.pending_activity_count.fetchAdd(1, .monotonic);
        defer this.close();
        defer this.unrefTask();

        err.ensureStillAlive();
        if (this.js_this != .zero) {
            const js_this = this.js_this;
            js_this.ensureStillAlive();
            if (FSWatcher.listenerGetCached(js_this)) |listener| {
                listener.ensureStillAlive();
                var args = [_]JSC.JSValue{
                    EventType.@"error".toJS(this.globalThis),
                    if (err.isEmptyOrUndefinedOrNull()) JSC.CommonAbortReason.UserAbort.toJS(this.globalThis) else err,
                };
                _ = listener.callWithGlobalThis(
                    this.globalThis,
                    &args,
                ) catch this.globalThis.clearException();
            }
        }
    }
    pub fn emitError(this: *FSWatcher, err: bun.sys.Error) void {
        if (this.closed) return;
        defer this.close();

        if (this.js_this != .zero) {
            const js_this = this.js_this;
            js_this.ensureStillAlive();
            if (FSWatcher.listenerGetCached(js_this)) |listener| {
                listener.ensureStillAlive();
                const globalObject = this.globalThis;
                var args = [_]JSC.JSValue{
                    EventType.@"error".toJS(globalObject),
                    err.toJSC(globalObject),
                };
                _ = listener.callWithGlobalThis(
                    globalObject,
                    &args,
                ) catch |e| this.globalThis.reportActiveExceptionAsUnhandled(e);
            }
        }
    }

    pub fn emitWithFilename(this: *FSWatcher, file_name: JSC.JSValue, comptime eventType: EventType) void {
        const js_this = this.js_this;
        if (js_this == .zero) return;
        const listener = FSWatcher.listenerGetCached(js_this) orelse return;
        emitJS(listener, this.globalThis, file_name, eventType);
    }

    pub fn emit(this: *FSWatcher, file_name: string, comptime event_type: EventType) void {
        bun.assert(event_type != .@"error");
        const js_this = this.js_this;
        if (js_this == .zero) return;
        const listener = FSWatcher.listenerGetCached(js_this) orelse return;
        const globalObject = this.globalThis;
        var filename: JSC.JSValue = .undefined;
        if (file_name.len > 0) {
            if (this.encoding == .buffer)
                filename = JSC.ArrayBuffer.createBuffer(globalObject, file_name)
            else if (this.encoding == .utf8) {
                filename = JSC.ZigString.fromUTF8(file_name).toJS(globalObject);
            } else {
                // convert to desired encoding
                filename = Encoder.toStringAtRuntime(file_name.ptr, file_name.len, globalObject, this.encoding);
            }
        }

        emitJS(listener, globalObject, filename, event_type);
    }

    fn emitJS(listener: JSC.JSValue, globalObject: *JSC.JSGlobalObject, filename: JSC.JSValue, comptime event_type: EventType) void {
        var args = [_]JSC.JSValue{
            event_type.toJS(globalObject),
            filename,
        };

        _ = listener.callWithGlobalThis(
            globalObject,
            &args,
        ) catch |err| globalObject.reportActiveExceptionAsUnhandled(err);
    }

    pub fn doRef(this: *FSWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        if (!this.closed and !this.persistent) {
            this.persistent = true;
            this.poll_ref.ref(this.ctx);
        }
        return .undefined;
    }

    pub fn doUnref(this: *FSWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        if (this.persistent) {
            this.persistent = false;
            this.poll_ref.unref(this.ctx);
        }
        return .undefined;
    }

    pub fn hasRef(this: *FSWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.persistent);
    }

    // this can be called from Watcher Thread or JS Context Thread
    pub fn refTask(this: *FSWatcher) bool {
        @fence(.acquire);
        this.mutex.lock();
        defer this.mutex.unlock();
        if (this.closed) return false;
        _ = this.pending_activity_count.fetchAdd(1, .monotonic);

        return true;
    }

    pub fn hasPendingActivity(this: *FSWatcher) bool {
        @fence(.acquire);
        return this.pending_activity_count.load(.acquire) > 0;
    }

    pub fn unrefTask(this: *FSWatcher) void {
        this.mutex.lock();
        defer this.mutex.unlock();
        // JSC eventually will free it
        _ = this.pending_activity_count.fetchSub(1, .monotonic);
    }

    pub fn close(this: *FSWatcher) void {
        this.mutex.lock();
        if (!this.closed) {
            this.closed = true;
            const js_this = this.js_this;
            this.mutex.unlock();
            this.detach();

            if (js_this != .zero) {
                if (FSWatcher.listenerGetCached(js_this)) |listener| {
                    _ = this.refTask();
                    log("emit('close')", .{});
                    emitJS(listener, this.globalThis, .undefined, .close);
                    this.unrefTask();
                }
            }

            this.unrefTask();
        } else {
            this.mutex.unlock();
        }
    }

    // this can be called multiple times
    pub fn detach(this: *FSWatcher) void {
        if (this.path_watcher) |path_watcher| {
            this.path_watcher = null;
            path_watcher.detach(this);
        }

        if (this.persistent) {
            this.persistent = false;
            this.poll_ref.unref(this.ctx);
        }

        if (this.signal) |signal| {
            this.signal = null;
            signal.detach(this);
        }

        this.js_this = .zero;
    }

    pub fn doClose(this: *FSWatcher, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        this.close();
        return .undefined;
    }

    pub fn finalize(this: *FSWatcher) void {
        this.deinit();
    }

    pub fn init(args: Arguments) bun.JSC.Maybe(*FSWatcher) {
        var buf: bun.PathBuffer = undefined;
        var slice = args.path.slice();
        if (bun.strings.startsWith(slice, "file://")) {
            slice = slice[6..];
        }

        var parts = [_]string{
            slice,
        };

        const cwd = switch (bun.sys.getcwd(&buf)) {
            .result => |r| r,
            .err => |err| return .{ .err = err },
        };
        buf[cwd.len] = std.fs.path.sep;

        var joined_buf: bun.PathBuffer = undefined;
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
            .mutex = .{},
            .signal = if (args.signal) |s| s.ref() else null,
            .persistent = args.persistent,
            .path_watcher = null,
            .globalThis = args.global_this,
            .js_this = .zero,
            .encoding = args.encoding,
            .closed = false,
            .verbose = args.verbose,
        });
        ctx.current_task.ctx = ctx;

        ctx.path_watcher = if (args.signal == null or !args.signal.?.aborted())
            switch (PathWatcher.watch(vm, file_path_z, args.recursive, onPathUpdate, onUpdateEnd, bun.cast(*anyopaque, ctx))) {
                .result => |r| r,
                .err => |err| {
                    ctx.deinit();
                    return .{ .err = err };
                },
            }
        else
            null;
        ctx.initJS(args.listener);
        return .{ .result = ctx };
    }
};
