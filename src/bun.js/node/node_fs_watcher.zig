const std = @import("std");
const JSC = @import("root").bun.JSC;
const bun = @import("root").bun;
const Fs = @import("../../fs.zig");
const Path = @import("../../resolver/resolve_path.zig");
const Encoder = JSC.WebCore.Encoder;

const FSEvents = @import("./fs_events.zig");

const VirtualMachine = JSC.VirtualMachine;
const EventLoop = JSC.EventLoop;
const PathLike = JSC.Node.PathLike;
const ArgumentsSlice = JSC.Node.ArgumentsSlice;
const Output = bun.Output;
const string = bun.string;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const Environment = bun.Environment;

pub const FSWatcher = struct {
    const watcher = @import("../../watcher.zig");
    const options = @import("../../options.zig");
    pub const Watcher = watcher.NewWatcher(*FSWatcher);
    const log = Output.scoped(.FSWatcher, false);

    pub const ChangeEvent = struct {
        hash: Watcher.HashType = 0,
        event_type: FSWatchTask.EventType = .change,
        time_stamp: i64 = 0,
    };

    onAccept: std.ArrayHashMapUnmanaged(FSWatcher.Watcher.HashType, bun.BabyList(OnAcceptCallback), bun.ArrayIdentityContext, false) = .{},
    ctx: *VirtualMachine,
    js_watcher: ?*JSObject = null,
    watcher_instance: ?*FSWatcher.Watcher = null,
    verbose: bool = false,
    file_paths: bun.BabyList(string) = .{},
    entry_path: ?string = null,
    entry_dir: string = "",
    last_change_event: ChangeEvent = .{},

    pub fn toJS(this: *FSWatcher) JSC.JSValue {
        return if (this.js_watcher) |js| js.js_this else JSC.JSValue.jsUndefined();
    }

    pub fn eventLoop(this: FSWatcher) *EventLoop {
        return this.ctx.eventLoop();
    }

    pub fn enqueueTaskConcurrent(this: FSWatcher, task: *JSC.ConcurrentTask) void {
        this.eventLoop().enqueueTaskConcurrent(task);
    }

    pub fn deinit(this: *FSWatcher) void {
        while (this.file_paths.popOrNull()) |file_path| {
            bun.default_allocator.destroy(file_path);
        }
        this.file_paths.deinitWithAllocator(bun.default_allocator);
        if (this.entry_path) |path| {
            this.entry_path = null;
            bun.default_allocator.destroy(path);
        }
        bun.default_allocator.destroy(this);
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

        pub const EventFreeType = enum {
            destroy,
            free,
            none,
        };

        pub const Entry = struct {
            file_path: string,
            event_type: EventType,
            free_type: EventFreeType,
        };

        pub fn append(this: *FSWatchTask, file_path: string, event_type: EventType, free_type: EventFreeType) void {
            if (this.count == 8) {
                this.enqueue();
                var ctx = this.ctx;
                this.* = .{
                    .ctx = ctx,
                    .count = 0,
                };
            }

            this.entries[this.count] = .{
                .file_path = file_path,
                .event_type = event_type,
                .free_type = free_type,
            };
            this.count += 1;
        }

        pub fn run(this: *FSWatchTask) void {
            // this runs on JS Context
            if (this.ctx.js_watcher) |js_watcher| {
                for (this.entries[0..this.count]) |entry| {
                    switch (entry.event_type) {
                        .rename => {
                            js_watcher.emit(entry.file_path, "rename");
                        },
                        .change => {
                            js_watcher.emit(entry.file_path, "change");
                        },
                        .@"error" => {
                            // file_path is the error message in this case
                            js_watcher.emitError(entry.file_path);
                        },
                        .abort => {
                            js_watcher.emitIfAborted();
                        },
                    }
                }
            }
        }

        pub fn enqueue(this: *FSWatchTask) void {
            if (this.count == 0)
                return;

            var that = bun.default_allocator.create(FSWatchTask) catch unreachable;

            that.* = this.*;
            this.count = 0;
            that.concurrent_task.task = JSC.Task.init(that);
            this.ctx.enqueueTaskConcurrent(&that.concurrent_task);
        }

        pub fn deinit(this: *FSWatchTask) void {
            while (this.count > 0) {
                this.count -= 1;
                switch (this.entries[this.count].free_type) {
                    .destroy => bun.default_allocator.destroy(this.entries[this.count].file_path),
                    .free => bun.default_allocator.free(this.entries[this.count].file_path),
                    else => {},
                }
            }
            bun.default_allocator.destroy(this);
        }
    };

    fn NewCallback(comptime FunctionSignature: type) type {
        return union(enum) {
            javascript_callback: JSC.Strong,
            zig_callback: struct {
                ptr: *anyopaque,
                function: *const FunctionSignature,
            },
        };
    }

    pub const OnAcceptCallback = NewCallback(fn (
        vm: *JSC.VirtualMachine,
        specifier: []const u8,
    ) void);

    fn addDirectory(ctx: *FSWatcher, fs_watcher: *FSWatcher.Watcher, fd: StoredFileDescriptorType, file_path: string, recursive: bool, buf: *[bun.MAX_PATH_BYTES + 1]u8, is_entry_path: bool) !void {
        var dir_path_clone = bun.default_allocator.dupeZ(u8, file_path) catch unreachable;

        if (is_entry_path) {
            ctx.entry_path = dir_path_clone;
            ctx.entry_dir = dir_path_clone;
        } else {
            ctx.file_paths.push(bun.default_allocator, dir_path_clone) catch unreachable;
        }
        fs_watcher.addDirectory(fd, dir_path_clone, FSWatcher.Watcher.getHash(file_path), false) catch |err| {
            ctx.deinit();
            fs_watcher.deinit(true);
            return err;
        };

        var iter = (std.fs.IterableDir{ .dir = std.fs.Dir{
            .fd = fd,
        } }).iterate();

        while (iter.next() catch |err| {
            ctx.deinit();
            fs_watcher.deinit(true);
            return err;
        }) |entry| {
            var parts = [2]string{ dir_path_clone, entry.name };
            var entry_path = Path.joinAbsStringBuf(
                Fs.FileSystem.instance.topLevelDirWithoutTrailingSlash(),
                buf,
                &parts,
                .auto,
            );

            buf[entry_path.len] = 0;
            var entry_path_z = buf[0..entry_path.len :0];

            var fs_info = fdFromAbsolutePathZ(entry_path_z) catch |err| {
                ctx.deinit();
                fs_watcher.deinit(true);
                return err;
            };

            if (fs_info.is_file) {
                const file_path_clone = bun.default_allocator.dupeZ(u8, entry_path) catch unreachable;

                ctx.file_paths.push(bun.default_allocator, file_path_clone) catch unreachable;

                fs_watcher.addFile(fs_info.fd, file_path_clone, FSWatcher.Watcher.getHash(entry_path), options.Loader.file, 0, null, false) catch |err| {
                    ctx.deinit();
                    fs_watcher.deinit(true);
                    return err;
                };
            } else {
                if (recursive) {
                    addDirectory(ctx, fs_watcher, fs_info.fd, entry_path, recursive, buf, false) catch |err| {
                        ctx.deinit();
                        fs_watcher.deinit(true);
                        return err;
                    };
                }
            }
        }
    }

    pub fn onError(
        this: *FSWatcher,
        err: anyerror,
    ) void {
        var current_task: FSWatchTask = .{
            .ctx = this,
        };
        current_task.append(@errorName(err), .@"error", .none);
        current_task.enqueue();
    }

    pub fn onFSEventUpdate(
        ctx: ?*anyopaque,
        path: string,
        _: bool,
        is_rename: bool,
    ) void {
        const this = bun.cast(*FSWatcher, ctx.?);

        var current_task: FSWatchTask = .{
            .ctx = this,
        };
        defer current_task.enqueue();

        const relative_path = bun.default_allocator.alloc(u8, path.len) catch unreachable;
        bun.copy(u8, relative_path, path);
        const event_type: FSWatchTask.EventType = if (is_rename) .rename else .change;

        current_task.append(relative_path, event_type, .free);
    }

    pub fn onFileUpdate(
        this: *FSWatcher,
        events: []watcher.WatchEvent,
        changed_files: []?[:0]u8,
        watchlist: watcher.Watchlist,
    ) void {
        var slice = watchlist.slice();
        const file_paths = slice.items(.file_path);

        var counts = slice.items(.count);
        const kinds = slice.items(.kind);
        const hashes = slice.items(.hash);
        const parents = slice.items(.parent_hash);
        var _on_file_update_path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

        var ctx = this.watcher_instance.?;
        defer ctx.flushEvictions();
        defer Output.flush();

        var bundler = if (@TypeOf(this.ctx.bundler) == *bun.Bundler)
            this.ctx.bundler
        else
            &this.ctx.bundler;

        var fs: *Fs.FileSystem = bundler.fs;

        var current_task: FSWatchTask = .{
            .ctx = this,
        };
        defer current_task.enqueue();

        const time_stamp = std.time.milliTimestamp();
        const time_diff = time_stamp - this.last_change_event.time_stamp;

        for (events) |event| {
            const file_path = file_paths[event.index];
            const update_count = counts[event.index] + 1;
            counts[event.index] = update_count;
            const kind = kinds[event.index];

            // so it's consistent with the rest
            // if we use .extname we might run into an issue with whether or not the "." is included.
            // const path = Fs.PathName.init(file_path);
            const id = hashes[event.index];

            if (comptime Environment.isDebug) {
                if (this.verbose) {
                    Output.prettyErrorln("[watch] {s} ({s}, {})", .{ file_path, @tagName(kind), event.op });
                }
            }

            switch (kind) {
                .file => {
                    if (event.op.delete) {
                        ctx.removeAtIndex(
                            event.index,
                            0,
                            &.{},
                            .file,
                        );
                    }

                    var file_hash: FSWatcher.Watcher.HashType = FSWatcher.Watcher.getHash(file_path);

                    if (event.op.write or event.op.delete or event.op.rename) {
                        const event_type: FSWatchTask.EventType = if (event.op.delete or event.op.rename or event.op.move_to) .rename else .change;
                        // skip consecutive duplicates
                        if ((this.last_change_event.time_stamp == 0 or time_diff > 1) or this.last_change_event.event_type != event_type and this.last_change_event.hash != file_hash) {
                            this.last_change_event.time_stamp = time_stamp;
                            this.last_change_event.event_type = event_type;
                            this.last_change_event.hash = file_hash;

                            const relative_slice = fs.relative(this.entry_dir, file_path);

                            if (this.verbose)
                                Output.prettyErrorln("<r><d>File changed: {s}<r>", .{relative_slice});

                            const relative_path = bun.default_allocator.dupe(u8, relative_slice) catch unreachable;

                            current_task.append(relative_path, event_type, .destroy);
                        }
                    }
                },
                .directory => {
                    // if (comptime Environment.isMac) {
                    //     unreachable;
                    // }
                    var affected_buf: [128][]const u8 = undefined;

                    const affected = brk: {
                        if (comptime Environment.isMac) {
                            var affected_i: usize = 0;

                            // if a file descriptor is stale, we need to close it
                            if (event.op.delete) {
                                for (parents, 0..) |parent_hash, entry_id| {
                                    if (parent_hash == id) {
                                        const affected_path = file_paths[entry_id];
                                        const was_deleted = check: {
                                            std.os.access(affected_path, std.os.F_OK) catch break :check true;
                                            break :check false;
                                        };
                                        if (!was_deleted) continue;

                                        affected_buf[affected_i] = affected_path[file_path.len..];
                                        affected_i += 1;
                                        if (affected_i >= affected_buf.len) break;
                                    }
                                }
                            }

                            break :brk affected_buf[0..affected_i];
                        }

                        break :brk event.names(changed_files);
                    };

                    for (affected) |changed_name_| {
                        const changed_name: []const u8 = if (comptime Environment.isMac)
                            changed_name_
                        else
                            bun.asByteSlice(changed_name_.?);
                        if (changed_name.len == 0 or changed_name[0] == '~' or changed_name[0] == '.') continue;

                        var file_hash: FSWatcher.Watcher.HashType = 0;
                        const relative_slice: string = brk: {
                            var file_path_without_trailing_slash = std.mem.trimRight(u8, file_path, std.fs.path.sep_str);

                            @memcpy(&_on_file_update_path_buf, file_path_without_trailing_slash.ptr, file_path_without_trailing_slash.len);
                            _on_file_update_path_buf[file_path_without_trailing_slash.len] = std.fs.path.sep;

                            @memcpy(_on_file_update_path_buf[file_path_without_trailing_slash.len + 1 ..].ptr, changed_name.ptr, changed_name.len);
                            const path_slice = _on_file_update_path_buf[0 .. file_path_without_trailing_slash.len + changed_name.len + 1];
                            file_hash = FSWatcher.Watcher.getHash(path_slice);

                            const relative = fs.relative(this.entry_dir, path_slice);

                            break :brk relative;
                        };

                        // skip consecutive duplicates
                        const event_type: FSWatchTask.EventType = .rename; // renaming folders, creating folder or files will be always be rename
                        if ((this.last_change_event.time_stamp == 0 or time_diff > 1) or this.last_change_event.event_type != event_type and this.last_change_event.hash != file_hash) {
                            const relative_path = bun.default_allocator.dupe(u8, relative_slice) catch unreachable;

                            this.last_change_event.time_stamp = time_stamp;
                            this.last_change_event.event_type = event_type;
                            this.last_change_event.hash = file_hash;

                            current_task.append(relative_path, event_type, .destroy);

                            if (this.verbose)
                                Output.prettyErrorln("<r> <d>Dir change: {s}<r>", .{relative_path});
                        }
                    }

                    if (this.verbose and affected.len == 0) {
                        Output.prettyErrorln("<r> <d>Dir change: {s}<r>", .{fs.relative(this.entry_dir, file_path)});
                    }
                },
            }
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
            return obj.toJS();
        }
    };

    pub const JSObject = struct {
        signal: ?*JSC.AbortSignal,
        persistent: bool,
        manager: ?*FSWatcher.Watcher,
        fsevents_watcher: ?*FSEvents.FSEventsWatcher,
        poll_ref: JSC.PollRef = .{},
        globalThis: ?*JSC.JSGlobalObject,
        js_this: JSC.JSValue,
        encoding: JSC.Node.Encoding,
        closed: bool,

        pub usingnamespace JSC.Codegen.JSFSWatcher;

        pub fn getFSWatcher(this: *JSObject) *FSWatcher {
            if (this.manager) |manager| return manager.ctx;
            if (this.fsevents_watcher) |manager| return bun.cast(*FSWatcher, manager.ctx.?);

            @panic("No context attached to JSFSWatcher");
        }

        pub fn init(globalThis: *JSC.JSGlobalObject, manager: ?*FSWatcher.Watcher, fsevents_watcher: ?*FSEvents.FSEventsWatcher, signal: ?*JSC.AbortSignal, listener: JSC.JSValue, persistent: bool, encoding: JSC.Node.Encoding) !*JSObject {
            var obj = try globalThis.allocator().create(JSObject);
            obj.* = .{
                .signal = null,
                .persistent = persistent,
                .manager = manager,
                .fsevents_watcher = fsevents_watcher,
                .globalThis = globalThis,
                .js_this = .zero,
                .encoding = encoding,
                .closed = false,
            };
            const instance = obj.getFSWatcher();

            if (persistent) {
                obj.poll_ref.ref(instance.ctx);
            }

            var js_this = JSObject.toJS(obj, globalThis);
            JSObject.listenerSetCached(js_this, globalThis, listener);
            obj.js_this = js_this;
            obj.js_this.protect();

            if (signal) |s| {

                // already aborted?
                if (s.aborted()) {
                    obj.signal = s.ref();
                    // abort next tick
                    var current_task: FSWatchTask = .{
                        .ctx = instance,
                    };
                    current_task.append("", .abort, .none);
                    current_task.enqueue();
                } else {
                    // watch for abortion
                    obj.signal = s.ref().listen(JSObject, obj, JSObject.emitAbort);
                }
            }
            return obj;
        }

        pub fn emitIfAborted(this: *JSObject) void {
            if (this.signal) |s| {
                if (s.aborted()) {
                    const err = s.abortReason();
                    this.emitAbort(err);
                }
            }
        }

        pub fn emitAbort(this: *JSObject, err: JSC.JSValue) void {
            if (this.closed) return;
            defer this.close(true);

            err.ensureStillAlive();

            if (this.globalThis) |globalThis| {
                if (this.js_this != .zero) {
                    if (JSObject.listenerGetCached(this.js_this)) |listener| {
                        var args = [_]JSC.JSValue{
                            JSC.ZigString.static("error").toValue(globalThis),
                            if (err.isEmptyOrUndefinedOrNull()) JSC.WebCore.AbortSignal.createAbortError(JSC.ZigString.static("The user aborted a request"), &JSC.ZigString.Empty, globalThis) else err,
                        };
                        _ = listener.callWithGlobalThis(
                            globalThis,
                            &args,
                        );
                    }
                }
            }
        }
        pub fn emitError(this: *JSObject, err: string) void {
            if (this.closed) return;
            defer this.close(true);

            if (this.globalThis) |globalThis| {
                if (this.js_this != .zero) {
                    if (JSObject.listenerGetCached(this.js_this)) |listener| {
                        var args = [_]JSC.JSValue{
                            JSC.ZigString.static("error").toValue(globalThis),
                            JSC.ZigString.fromUTF8(err).toErrorInstance(globalThis),
                        };
                        _ = listener.callWithGlobalThis(
                            globalThis,
                            &args,
                        );
                    }
                }
            }
        }

        pub fn emit(this: *JSObject, file_name: string, comptime eventType: string) void {
            if (this.globalThis) |globalThis| {
                if (this.js_this != .zero) {
                    if (JSObject.listenerGetCached(this.js_this)) |listener| {
                        var filename: JSC.JSValue = JSC.JSValue.jsUndefined();
                        if (file_name.len > 0) {
                            if (this.encoding == .buffer)
                                filename = JSC.ArrayBuffer.createBuffer(globalThis, file_name)
                            else if (this.encoding == .utf8) {
                                filename = JSC.ZigString.fromUTF8(file_name).toValueGC(globalThis);
                            } else {
                                // convert to desired encoding
                                filename = Encoder.toStringAtRuntime(file_name.ptr, file_name.len, globalThis, this.encoding);
                            }
                        }
                        var args = [_]JSC.JSValue{
                            JSC.ZigString.static(eventType).toValue(globalThis),
                            filename,
                        };
                        _ = listener.callWithGlobalThis(
                            globalThis,
                            &args,
                        );
                    }
                }
            }
        }

        pub fn ref(this: *JSObject) void {
            if (this.closed) return;

            if (!this.persistent) {
                this.persistent = true;
                this.poll_ref.ref(this.getFSWatcher().ctx);
            }
        }

        pub fn doRef(this: *JSObject, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            this.ref();
            return JSC.JSValue.jsUndefined();
        }

        pub fn unref(this: *JSObject) void {
            if (this.persistent) {
                this.persistent = false;
                this.poll_ref.unref(this.getFSWatcher().ctx);
            }
        }

        pub fn doUnref(this: *JSObject, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            this.unref();
            return JSC.JSValue.jsUndefined();
        }

        pub fn hasRef(this: *JSObject, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            return JSC.JSValue.jsBoolean(this.persistent);
        }

        pub fn close(
            this: *JSObject,
            emitEvent: bool,
        ) void {
            if (!this.closed) {
                if (this.signal) |signal| {
                    this.signal = null;
                    signal.detach(this);
                }
                this.closed = true;
                if (emitEvent) {
                    this.emit("", "close");
                }

                this.detach();
            }
        }

        pub fn detach(this: *JSObject) void {
            this.unref();

            if (this.js_this != .zero) {
                this.js_this.unprotect();
                this.js_this = .zero;
            }

            this.globalThis = null;

            if (this.signal) |signal| {
                this.signal = null;
                signal.detach(this);
            }
            if (this.manager) |manager| {
                var ctx = manager.ctx;
                this.manager = null;
                ctx.js_watcher = null;
                ctx.deinit();
                manager.deinit(true);
            }

            if (this.fsevents_watcher) |manager| {
                var ctx = bun.cast(*FSWatcher, manager.ctx.?);
                ctx.js_watcher = null;
                ctx.deinit();
                manager.deinit();
            }
        }

        pub fn doClose(this: *JSObject, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            this.close(true);
            return JSC.JSValue.jsUndefined();
        }

        pub fn finalize(this: *JSObject) callconv(.C) void {
            if (!this.closed) {
                this.detach();
            }

            bun.default_allocator.destroy(this);
        }
    };

    const PathResult = struct {
        fd: StoredFileDescriptorType = 0,
        is_file: bool = true,
    };

    fn fdFromAbsolutePathZ(
        absolute_path_z: [:0]const u8,
    ) !PathResult {
        var stat = try bun.C.lstat_absolute(absolute_path_z);
        var result = PathResult{};

        switch (stat.kind) {
            .SymLink => {
                var file = try std.fs.openFileAbsoluteZ(absolute_path_z, .{ .mode = .read_only });
                result.fd = file.handle;
                const _stat = try file.stat();

                result.is_file = _stat.kind == .Directory;
            },
            .Directory => {
                const dir = (try std.fs.openIterableDirAbsoluteZ(absolute_path_z, .{
                    .access_sub_paths = true,
                })).dir;
                result.fd = dir.fd;
                result.is_file = false;
            },
            else => {
                const file = try std.fs.openFileAbsoluteZ(absolute_path_z, .{ .mode = .read_only });
                result.fd = file.handle;
                result.is_file = true;
            },
        }
        return result;
    }

    pub fn init(args: Arguments) !*FSWatcher {
        var buf: [bun.MAX_PATH_BYTES + 1]u8 = undefined;

        var parts = [_]string{
            args.path.slice(),
        };

        var file_path = Path.joinAbsStringBuf(
            Fs.FileSystem.instance.top_level_dir,
            &buf,
            &parts,
            .auto,
        );

        buf[file_path.len] = 0;
        var file_path_z = buf[0..file_path.len :0];

        var fs_type = try fdFromAbsolutePathZ(file_path_z);

        var ctx = try bun.default_allocator.create(FSWatcher);
        const vm = args.global_this.bunVM();
        ctx.* = .{
            .ctx = vm,
            .verbose = args.verbose,
            .file_paths = bun.BabyList(string).initCapacity(bun.default_allocator, 1) catch |err| {
                ctx.deinit();
                return err;
            },
        };

        if (comptime Environment.isMac) {
            if (!fs_type.is_file) {
                var dir_path_clone = bun.default_allocator.dupeZ(u8, file_path) catch unreachable;
                ctx.entry_path = dir_path_clone;
                ctx.entry_dir = dir_path_clone;

                var fsevents_watcher = FSEvents.watch(dir_path_clone, args.recursive, onFSEventUpdate, bun.cast(*anyopaque, ctx)) catch |err| {
                    ctx.deinit();
                    return err;
                };

                ctx.js_watcher = JSObject.init(args.global_this, null, fsevents_watcher, args.signal, args.listener, args.persistent, args.encoding) catch |err| {
                    ctx.deinit();
                    fsevents_watcher.deinit();
                    return err;
                };

                return ctx;
            }
        }

        var fs_watcher = FSWatcher.Watcher.init(
            ctx,
            vm.bundler.fs,
            bun.default_allocator,
        ) catch |err| {
            ctx.deinit();
            return err;
        };

        ctx.watcher_instance = fs_watcher;

        if (fs_type.is_file) {
            var file_path_clone = bun.default_allocator.dupeZ(u8, file_path) catch unreachable;

            ctx.entry_path = file_path_clone;
            ctx.entry_dir = std.fs.path.dirname(file_path_clone) orelse file_path_clone;

            fs_watcher.addFile(fs_type.fd, file_path_clone, FSWatcher.Watcher.getHash(file_path), options.Loader.file, 0, null, false) catch |err| {
                ctx.deinit();
                fs_watcher.deinit(true);
                return err;
            };
        } else {
            addDirectory(ctx, fs_watcher, fs_type.fd, file_path, args.recursive, &buf, true) catch |err| {
                ctx.deinit();
                fs_watcher.deinit(true);
                return err;
            };
        }

        fs_watcher.start() catch |err| {
            ctx.deinit();

            fs_watcher.deinit(true);
            return err;
        };

        ctx.js_watcher = JSObject.init(args.global_this, fs_watcher, null, args.signal, args.listener, args.persistent, args.encoding) catch |err| {
            ctx.deinit();
            fs_watcher.deinit(true);
            return err;
        };

        return ctx;
    }
};
