const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const Queue = std.fifo.LinearFifo(JSC.Node.BlobOrStringOrBuffer, .Dynamic);

pub const ZlibEncoder = struct {
    pub usingnamespace bun.New(@This());
    pub usingnamespace JSC.Codegen.JSZlibEncoder;

    globalThis: *JSC.JSGlobalObject,
    stream: bun.zlib.ZlibCompressorStreaming,
    maxOutputLength: usize,

    freelist: Queue = Queue.init(bun.default_allocator),
    freelist_write_lock: bun.Lock = .{},

    input: Queue = Queue.init(bun.default_allocator),
    input_lock: bun.Lock = .{},

    has_called_end: bool = false,
    callback_value: JSC.Strong = .{},

    output: std.ArrayListUnmanaged(u8) = .{},
    output_lock: bun.Lock = .{},

    has_pending_activity: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    pending_encode_job_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    ref_count: u32 = 1,
    write_failure: ?JSC.DeferredError = null,
    poll_ref: bun.Async.KeepAlive = .{},
    closed: bool = false,

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) ?*@This() {
        _ = callframe;
        globalThis.throw("ZlibEncoder is not constructable", .{});
        return null;
    }

    pub fn create(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(4).slice();

        if (arguments.len < 4) {
            globalThis.throwNotEnoughArguments("ZlibEncoder", 4, arguments.len);
            return .zero;
        }

        const opts = arguments[0];
        const callback = arguments[2];
        const mode = arguments[3].to(bun.zlib.NodeMode);

        var options = Options.fromJS(globalThis, mode, opts) orelse return .zero;

        if (mode == .GZIP or mode == .GUNZIP) options.windowBits += 16;
        if (mode == .UNZIP) options.windowBits += 32;
        if (mode == .DEFLATERAW or mode == .INFLATERAW) options.windowBits *= -1;

        // In zlib v1.2.9, 8 become an invalid value for this parameter, so we gracefully fix it.
        // Ref: https://github.com/nodejs/node/commit/241eb6122ee6f36de16ee4ed4a6a291510b1807f
        if (mode == .DEFLATERAW and options.windowBits == -8) options.windowBits = -9;

        var this: *ZlibEncoder = ZlibEncoder.new(.{
            .globalThis = globalThis,
            .maxOutputLength = options.maxOutputLength,
            .stream = .{
                .mode = mode,
                .flush = @enumFromInt(options.flush),
                .finishFlush = @enumFromInt(options.finishFlush),
                .fullFlush = @enumFromInt(options.fullFlush),
                .dictionary = options.dictionary.slice(),
            },
        });
        this.stream.init(options.level, options.windowBits, options.memLevel, options.strategy) catch {
            globalThis.throw("Failed to create ZlibEncoder", .{});
            return .zero;
        };

        const out = this.toJS(globalThis);
        this.callback_value.set(globalThis, callback);

        return out;
    }

    pub fn finalize(this: *@This()) callconv(.C) void {
        this.deinit();
    }

    pub fn deinit(this: *@This()) void {
        this.input.deinit();
        this.output.deinit(bun.default_allocator);
        this.callback_value.deinit();
        this.destroy();
    }

    pub fn transformSync(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(3);

        if (arguments.len < 3) {
            globalThis.throwNotEnoughArguments("ZlibEncoder.encode", 3, arguments.len);
            return .zero;
        }

        if (this.has_called_end) {
            globalThis.throw("ZlibEncoder.encodeSync called after ZlibEncoder.end", .{});
            return .zero;
        }

        const input = callframe.argument(0);
        const optional_encoding = callframe.argument(1);
        const is_last = callframe.argument(2).toBoolean();

        const input_to_queue = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueMaybeAsync(globalThis, bun.default_allocator, input, optional_encoding, true) orelse {
            return globalThis.throwInvalidArgumentTypeValue("buffer", "string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer", input);
        };

        _ = this.has_pending_activity.fetchAdd(1, .monotonic);
        if (is_last)
            this.has_called_end = true;

        var task: EncodeJob = .{
            .encoder = this,
            .is_async = false,
        };

        {
            this.input_lock.lock();
            defer this.input_lock.unlock();

            this.input.writeItem(input_to_queue) catch unreachable;
        }
        task.run();
        if (!is_last and this.output.items.len == 0) {
            return .undefined;
        }
        if (this.write_failure != null) {
            globalThis.vm().throwError(globalThis, this.write_failure.?.toError(globalThis));
            return .zero;
        }
        return this.collectOutputValue();
    }

    pub fn transform(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(3);

        if (arguments.len < 3) {
            globalThis.throwNotEnoughArguments("ZlibEncoder.encode", 3, arguments.len);
            return .zero;
        }

        if (this.has_called_end) {
            globalThis.throw("ZlibEncoder.encode called after ZlibEncoder.end", .{});
            return .zero;
        }

        const input = callframe.argument(0);
        const optional_encoding = callframe.argument(1);
        const is_last = callframe.argument(2).toBoolean();

        const input_to_queue = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueMaybeAsync(globalThis, bun.default_allocator, input, optional_encoding, true) orelse {
            globalThis.throwInvalidArgumentType("ZlibEncoder.encode", "input", "Blob, String, or Buffer");
            return .zero;
        };

        _ = this.has_pending_activity.fetchAdd(1, .monotonic);
        if (is_last)
            this.has_called_end = true;

        var task = EncodeJob.new(.{
            .encoder = this,
            .is_async = true,
        });

        {
            this.input_lock.lock();
            defer this.input_lock.unlock();

            this.input.writeItem(input_to_queue) catch unreachable;
        }
        this.poll_ref.ref(globalThis.bunVM());
        JSC.WorkPool.schedule(&task.task);

        return .undefined;
    }

    pub fn runFromJSThread(this: *@This()) void {
        this.poll_ref.unref(this.globalThis.bunVM());

        defer _ = this.has_pending_activity.fetchSub(1, .monotonic);
        this.drainFreelist();

        const result = this.callback_value.get().?.call(
            this.globalThis,
            .undefined,
            if (this.write_failure != null)
                &.{this.write_failure.?.toError(this.globalThis)}
            else
                &.{ .null, this.collectOutputValue() },
        );

        if (result.toError()) |err| {
            _ = this.globalThis.bunVM().uncaughtException(this.globalThis, err, false);
        }
    }

    pub fn hasPendingActivity(this: *@This()) callconv(.C) bool {
        return this.has_pending_activity.load(.monotonic) > 0;
    }

    fn drainFreelist(this: *ZlibEncoder) void {
        this.freelist_write_lock.lock();
        defer this.freelist_write_lock.unlock();
        const to_free = this.freelist.readableSlice(0);
        for (to_free) |*input| {
            input.deinit();
        }
        this.freelist.discard(to_free.len);
    }

    fn collectOutputValue(this: *ZlibEncoder) JSC.JSValue {
        this.output_lock.lock();
        defer this.output_lock.unlock();

        defer this.output.clearRetainingCapacity();
        return JSC.ArrayBuffer.createBuffer(this.globalThis, this.output.items);
    }

    const EncodeJob = struct {
        task: JSC.WorkPoolTask = .{ .callback = &runTask },
        encoder: *ZlibEncoder,
        is_async: bool,

        pub usingnamespace bun.New(@This());

        pub fn runTask(this: *JSC.WorkPoolTask) void {
            var job: *EncodeJob = @fieldParentPtr("task", this);
            job.run();
            job.destroy();
        }

        pub fn run(this: *EncodeJob) void {
            const vm = this.encoder.globalThis.bunVMConcurrently();
            defer this.encoder.poll_ref.unrefConcurrently(vm);
            defer {
                _ = this.encoder.has_pending_activity.fetchSub(1, .monotonic);
            }

            var any = false;

            if (this.encoder.pending_encode_job_count.fetchAdd(1, .monotonic) >= 0) {
                const is_last = this.encoder.has_called_end;
                outer: while (true) {
                    this.encoder.input_lock.lock();
                    defer this.encoder.input_lock.unlock();
                    const readable = this.encoder.input.readableSlice(0);
                    defer this.encoder.input.discard(readable.len);
                    const pending = readable;

                    const Writer = struct {
                        encoder: *ZlibEncoder,

                        pub const Error = error{OutOfMemory};
                        pub fn writeAll(writer: @This(), chunk: []const u8) Error!void {
                            writer.encoder.output_lock.lock();
                            defer writer.encoder.output_lock.unlock();

                            try writer.encoder.output.appendSlice(bun.default_allocator, chunk);
                        }
                    };

                    defer {
                        this.encoder.freelist_write_lock.lock();
                        this.encoder.freelist.write(pending) catch unreachable;
                        this.encoder.freelist_write_lock.unlock();
                    }
                    for (pending) |input| {
                        var writer = this.encoder.stream.writer(Writer{ .encoder = this.encoder });
                        writer.writeAll(input.slice()) catch |e| {
                            any = true;
                            _ = this.encoder.pending_encode_job_count.fetchSub(1, .monotonic);
                            if (!this.is_async) {
                                this.encoder.closed = true;
                                this.encoder.globalThis.throw("ZlibError: {s}", .{@errorName(e)});
                                return;
                            }
                            this.encoder.write_failure = JSC.DeferredError.from(.plainerror, .ERR_OPERATION_FAILED, "ZlibError: {s}", .{@errorName(e)}); // TODO propogate better error
                            break :outer;
                        };
                        if (this.encoder.output.items.len > this.encoder.maxOutputLength) {
                            any = true;
                            _ = this.encoder.pending_encode_job_count.fetchSub(1, .monotonic);
                            this.encoder.write_failure = JSC.DeferredError.from(.rangeerror, .ERR_BUFFER_TOO_LARGE, "Cannot create a Buffer larger than {d} bytes", .{this.encoder.maxOutputLength});
                            break :outer;
                        }
                    }

                    any = any or pending.len > 0;

                    if (this.encoder.pending_encode_job_count.fetchSub(1, .monotonic) == 0)
                        break;
                }

                if (is_last and any) {
                    const output = &this.encoder.output;
                    this.encoder.output_lock.lock();
                    defer this.encoder.output_lock.unlock();

                    this.encoder.stream.end(output) catch |e| {
                        _ = this.encoder.pending_encode_job_count.fetchSub(1, .monotonic);
                        this.encoder.write_failure = JSC.DeferredError.from(.plainerror, .ERR_OPERATION_FAILED, "ZlibError: {s}", .{@errorName(e)}); // TODO propogate better error
                        return;
                    };
                    if (this.encoder.output.items.len > this.encoder.maxOutputLength) {
                        _ = this.encoder.pending_encode_job_count.fetchSub(1, .monotonic);
                        this.encoder.write_failure = JSC.DeferredError.from(.rangeerror, .ERR_BUFFER_TOO_LARGE, "Cannot create a Buffer larger than {d} bytes", .{this.encoder.maxOutputLength});
                        return;
                    }
                }
            }

            if (this.is_async and any) {
                _ = this.encoder.has_pending_activity.fetchAdd(1, .monotonic);
                this.encoder.poll_ref.refConcurrently(vm);
                this.encoder.poll_ref.refConcurrently(vm);
                vm.enqueueTaskConcurrent(JSC.ConcurrentTask.create(JSC.Task.init(this.encoder)));
            }
        }
    };

    pub fn reset(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = globalThis;
        _ = callframe;
        _ = bun.zlib.deflateReset(&this.stream.state);
        return .undefined;
    }

    pub fn getBytesWritten(this: *@This(), globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        _ = globalObject;
        return JSC.JSValue.jsNumber(@as(u64, this.stream.state.total_in));
    }

    pub fn getLevel(this: *@This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        _ = globalObject;
        return JSC.JSValue.jsNumber(this.stream.level);
    }

    pub fn getStrategy(this: *@This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        _ = globalObject;
        return JSC.JSValue.jsNumber(this.stream.strategy);
    }

    pub fn getClosed(this: *@This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        _ = globalObject;
        return JSC.JSValue.jsBoolean(this.closed);
    }

    pub fn close(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        return .undefined;
    }

    pub fn params(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(3).ptr;
        if (this.stream.mode != .DEFLATE) return .undefined;

        const level = if (arguments[0] != .zero) (globalThis.checkRanges(arguments[0], "level", i16, -1, 9, -1) orelse return .zero) else this.stream.level;
        const strategy = if (arguments[1] != .zero) (globalThis.checkRanges(arguments[1], "strategy", u8, 0, 4, 0) orelse return .zero) else this.stream.strategy;
        this.stream.params(level, strategy);

        if (arguments[2] != .zero) {
            if (!arguments[2].isFunction()) {
                return globalThis.throwInvalidArgumentTypeValue("callback", "function", arguments[2]);
            }
            this.callback_value.set(globalThis, arguments[2]);
        }

        return .undefined;
    }
};

pub const ZlibDecoder = struct {
    pub usingnamespace bun.New(@This());
    pub usingnamespace JSC.Codegen.JSZlibDecoder;

    globalThis: *JSC.JSGlobalObject,
    stream: bun.zlib.ZlibDecompressorStreaming,
    maxOutputLength: usize,

    freelist: Queue = Queue.init(bun.default_allocator),
    freelist_write_lock: bun.Lock = .{},

    input: Queue = Queue.init(bun.default_allocator),
    input_lock: bun.Lock = .{},

    has_called_end: bool = false,
    callback_value: JSC.Strong = .{},

    output: std.ArrayListUnmanaged(u8) = .{},
    output_lock: bun.Lock = .{},

    has_pending_activity: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    pending_encode_job_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    ref_count: u32 = 1,
    write_failure: ?JSC.DeferredError = null,
    poll_ref: bun.Async.KeepAlive = .{},
    closed: bool = false,

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) ?*@This() {
        _ = callframe;
        globalThis.throw("ZlibDecoder is not constructable", .{});
        return null;
    }

    pub fn create(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(4).slice();

        if (arguments.len < 4) {
            globalThis.throwNotEnoughArguments("ZlibDecoder", 4, arguments.len);
            return .zero;
        }

        const opts = arguments[0];
        const callback = arguments[2];
        const mode = arguments[3].to(bun.zlib.NodeMode);

        var options = Options.fromJS(globalThis, mode, opts) orelse return .zero;

        if (mode == .GZIP or mode == .GUNZIP) options.windowBits += 16;
        if (mode == .UNZIP) options.windowBits += 32;
        if (mode == .DEFLATERAW or mode == .INFLATERAW) options.windowBits *= -1;

        var this: *ZlibDecoder = ZlibDecoder.new(.{
            .globalThis = globalThis,
            .maxOutputLength = options.maxOutputLength,
            .stream = .{
                .mode = mode,
                .flush = @enumFromInt(options.flush),
                .finishFlush = @enumFromInt(options.finishFlush),
                .fullFlush = @enumFromInt(options.fullFlush),
                .dictionary = options.dictionary.slice(),
            },
        });
        this.stream.init(options.windowBits) catch {
            globalThis.throw("Failed to create ZlibDecoder", .{});
            return .zero;
        };

        const out = this.toJS(globalThis);
        this.callback_value.set(globalThis, callback);

        return out;
    }

    pub fn finalize(this: *@This()) callconv(.C) void {
        this.deinit();
    }

    pub fn deinit(this: *@This()) void {
        this.input.deinit();
        this.output.deinit(bun.default_allocator);
        this.callback_value.deinit();
        this.destroy();
    }

    pub fn transformSync(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(3);

        if (arguments.len < 3) {
            globalThis.throwNotEnoughArguments("ZlibDecoder.encode", 3, arguments.len);
            return .zero;
        }

        if (this.has_called_end) {
            globalThis.throw("ZlibDecoder.encodeSync called after ZlibDecoder.end", .{});
            return .zero;
        }

        const input = callframe.argument(0);
        const optional_encoding = callframe.argument(1);
        const is_last = callframe.argument(2).toBoolean();

        const input_to_queue = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueMaybeAsync(globalThis, bun.default_allocator, input, optional_encoding, true) orelse {
            return globalThis.throwInvalidArgumentTypeValue("buffer", "string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer", input);
        };

        _ = this.has_pending_activity.fetchAdd(1, .monotonic);
        if (is_last)
            this.has_called_end = true;

        var task: DecodeJob = .{
            .decoder = this,
            .is_async = false,
        };

        {
            this.input_lock.lock();
            defer this.input_lock.unlock();

            this.input.writeItem(input_to_queue) catch unreachable;
        }
        task.run();
        if (!is_last and this.output.items.len == 0) {
            return .undefined;
        }
        if (this.write_failure != null) {
            globalThis.vm().throwError(globalThis, this.write_failure.?.toError(globalThis));
            return .zero;
        }
        return this.collectOutputValue();
    }

    pub fn transform(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(3);

        if (arguments.len < 3) {
            globalThis.throwNotEnoughArguments("ZlibDecoder.encode", 3, arguments.len);
            return .zero;
        }

        if (this.has_called_end) {
            globalThis.throw("ZlibDecoder.encode called after ZlibDecoder.end", .{});
            return .zero;
        }

        const input = callframe.argument(0);
        const optional_encoding = callframe.argument(1);
        const is_last = callframe.argument(2).toBoolean();

        const input_to_queue = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueMaybeAsync(globalThis, bun.default_allocator, input, optional_encoding, true) orelse {
            globalThis.throwInvalidArgumentType("ZlibDecoder.encode", "input", "Blob, String, or Buffer");
            return .zero;
        };

        _ = this.has_pending_activity.fetchAdd(1, .monotonic);
        if (is_last)
            this.has_called_end = true;

        var task = DecodeJob.new(.{
            .decoder = this,
            .is_async = true,
        });

        {
            this.input_lock.lock();
            defer this.input_lock.unlock();

            this.input.writeItem(input_to_queue) catch unreachable;
        }
        this.poll_ref.ref(globalThis.bunVM());
        JSC.WorkPool.schedule(&task.task);

        return .undefined;
    }

    pub fn runFromJSThread(this: *@This()) void {
        this.poll_ref.unref(this.globalThis.bunVM());

        defer _ = this.has_pending_activity.fetchSub(1, .monotonic);
        this.drainFreelist();

        const result = this.callback_value.get().?.call(
            this.globalThis,
            .undefined,
            if (this.write_failure != null)
                &.{this.write_failure.?.toError(this.globalThis)}
            else
                &.{ .null, this.collectOutputValue() },
        );

        if (result.toError()) |err| {
            _ = this.globalThis.bunVM().uncaughtException(this.globalThis, err, false);
        }
    }

    pub fn hasPendingActivity(this: *@This()) callconv(.C) bool {
        return this.has_pending_activity.load(.monotonic) > 0;
    }

    fn drainFreelist(this: *ZlibDecoder) void {
        this.freelist_write_lock.lock();
        defer this.freelist_write_lock.unlock();
        const to_free = this.freelist.readableSlice(0);
        for (to_free) |*input| {
            input.deinit();
        }
        this.freelist.discard(to_free.len);
    }

    fn collectOutputValue(this: *ZlibDecoder) JSC.JSValue {
        this.output_lock.lock();
        defer this.output_lock.unlock();

        defer this.output.clearRetainingCapacity();
        return JSC.ArrayBuffer.createBuffer(this.globalThis, this.output.items);
    }

    const DecodeJob = struct {
        task: JSC.WorkPoolTask = .{ .callback = &runTask },
        decoder: *ZlibDecoder,
        is_async: bool,

        pub usingnamespace bun.New(@This());

        pub fn runTask(this: *JSC.WorkPoolTask) void {
            var job: *DecodeJob = @fieldParentPtr("task", this);
            job.run();
            job.destroy();
        }

        pub fn run(this: *DecodeJob) void {
            const vm = this.decoder.globalThis.bunVMConcurrently();
            defer this.decoder.poll_ref.unrefConcurrently(vm);
            defer {
                _ = this.decoder.has_pending_activity.fetchSub(1, .monotonic);
            }

            var any = false;

            if (this.decoder.pending_encode_job_count.fetchAdd(1, .monotonic) >= 0) outer: {
                const is_last = this.decoder.has_called_end;
                while (true) {
                    this.decoder.input_lock.lock();
                    defer this.decoder.input_lock.unlock();
                    const readable = this.decoder.input.readableSlice(0);
                    defer this.decoder.input.discard(readable.len);
                    const pending = readable;

                    const Writer = struct {
                        decoder: *ZlibDecoder,

                        pub const Error = error{OutOfMemory};
                        pub fn writeAll(writer: @This(), chunk: []const u8) Error!void {
                            writer.decoder.output_lock.lock();
                            defer writer.decoder.output_lock.unlock();

                            try writer.decoder.output.appendSlice(bun.default_allocator, chunk);
                        }
                    };

                    defer {
                        this.decoder.freelist_write_lock.lock();
                        this.decoder.freelist.write(pending) catch unreachable;
                        this.decoder.freelist_write_lock.unlock();
                    }
                    for (pending) |input| {
                        var writer = this.decoder.stream.writer(Writer{ .decoder = this.decoder });
                        writer.writeAll(input.slice()) catch |e| {
                            any = true;
                            _ = this.decoder.pending_encode_job_count.fetchSub(1, .monotonic);
                            if (!this.is_async) {
                                this.decoder.closed = true;
                                switch (e) {
                                    error.ZlibError => {
                                        const message = std.mem.sliceTo(this.decoder.stream.err_msg.?, 0);
                                        this.decoder.globalThis.throw("{s}", .{message});
                                        return;
                                    },
                                    else => {},
                                }
                                this.decoder.globalThis.throw("ZlibError: {s}", .{@errorName(e)});
                                return;
                            }
                            switch (e) {
                                error.ZlibError => {
                                    const message = std.mem.sliceTo(this.decoder.stream.err_msg.?, 0);
                                    this.decoder.write_failure = JSC.DeferredError.from(.plainerror, .ERR_OPERATION_FAILED, "{s}", .{message});
                                    break :outer;
                                },
                                else => {},
                            }
                            this.decoder.write_failure = JSC.DeferredError.from(.plainerror, .ERR_OPERATION_FAILED, "ZlibError: {s}", .{@errorName(e)}); // TODO propogate better error
                            break :outer;
                        };
                    }

                    any = any or pending.len > 0;

                    if (this.decoder.pending_encode_job_count.fetchSub(1, .monotonic) == 0)
                        break;
                }

                if (is_last and any) {
                    const output = &this.decoder.output;
                    this.decoder.output_lock.lock();
                    defer this.decoder.output_lock.unlock();

                    this.decoder.stream.end(output) catch |e| {
                        any = true;
                        _ = this.decoder.pending_encode_job_count.fetchSub(1, .monotonic);
                        switch (e) {
                            error.ZlibError => {
                                const message = std.mem.sliceTo(this.decoder.stream.err_msg.?, 0);
                                this.decoder.write_failure = JSC.DeferredError.from(.plainerror, .ERR_OPERATION_FAILED, "{s}", .{message});
                                break :outer;
                            },
                            else => {},
                        }
                        this.decoder.write_failure = JSC.DeferredError.from(.plainerror, .ERR_OPERATION_FAILED, "ZlibError: {s}", .{@errorName(e)}); // TODO propogate better error
                        break :outer;
                    };
                    if (output.items.len > this.decoder.maxOutputLength) {
                        any = true;
                        _ = this.decoder.pending_encode_job_count.fetchSub(1, .monotonic);
                        this.decoder.write_failure = JSC.DeferredError.from(.rangeerror, .ERR_BUFFER_TOO_LARGE, "Cannot create a Buffer larger than {d} bytes", .{this.decoder.maxOutputLength});
                        break :outer;
                    }
                }
            }

            if (this.is_async and any) {
                _ = this.decoder.has_pending_activity.fetchAdd(1, .monotonic);
                this.decoder.poll_ref.refConcurrently(vm);
                this.decoder.poll_ref.refConcurrently(vm);
                vm.enqueueTaskConcurrent(JSC.ConcurrentTask.create(JSC.Task.init(this.decoder)));
            }
        }
    };

    pub fn reset(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = globalThis;
        _ = callframe;
        _ = bun.zlib.inflateReset(&this.stream.state);
        return .undefined;
    }

    pub fn getBytesWritten(this: *@This(), globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        _ = globalObject;
        return JSC.JSValue.jsNumber(@as(u64, this.stream.state.total_in));
    }

    pub fn getLevel(this: *@This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        _ = this;
        _ = globalObject;
        return JSC.JSValue.jsUndefined();
    }

    pub fn getStrategy(this: *@This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        _ = this;
        _ = globalObject;
        return JSC.JSValue.jsUndefined();
    }

    pub fn getClosed(this: *@This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        _ = globalObject;
        return JSC.JSValue.jsBoolean(this.closed);
    }

    pub fn close(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        return .undefined;
    }

    pub fn params(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        return .undefined;
    }
};

const Options = struct {
    chunkSize: usize,
    level: c_int,
    windowBits: c_int,
    memLevel: c_int,
    strategy: c_int,
    dictionary: JSC.Buffer,
    maxOutputLength: usize,
    flush: u8,
    finishFlush: u8,
    fullFlush: u8,

    pub fn fromJS(globalThis: *JSC.JSGlobalObject, mode: bun.zlib.NodeMode, opts: JSC.JSValue) ?Options {
        const chunkSize = globalThis.checkMinOrGetDefault(opts, "chunkSize", usize, 64, 1024 * 16) orelse return null;
        const level = globalThis.checkRangesOrGetDefault(opts, "level", i16, -1, 9, -1) orelse return null;
        const memLevel = globalThis.checkRangesOrGetDefault(opts, "memLevel", u8, 1, 9, 8) orelse return null;
        const strategy = globalThis.checkRangesOrGetDefault(opts, "strategy", u8, 0, 4, 0) orelse return null;
        const maxOutputLength = globalThis.checkMinOrGetDefaultU64(opts, "maxOutputLength", usize, 0, std.math.maxInt(u52)) orelse return null;
        const flush = globalThis.checkRangesOrGetDefault(opts, "flush", u8, 0, 5, 0) orelse return null;
        const finishFlush = globalThis.checkRangesOrGetDefault(opts, "finishFlush", u8, 0, 5, 4) orelse return null;
        const fullFlush = globalThis.checkRangesOrGetDefault(opts, "fullFlush", u8, 0, 5, 3) orelse return null;

        const windowBits = switch (mode) {
            .NONE,
            .BROTLI_DECODE,
            .BROTLI_ENCODE,
            => unreachable,
            .DEFLATE, .DEFLATERAW => globalThis.checkRangesOrGetDefault(opts, "windowBits", u8, 8, 15, 15) orelse return null,
            .INFLATE, .INFLATERAW => getWindowBits(globalThis, opts, "windowBits", u8, 8, 15, 15) orelse return null,
            .GZIP => globalThis.checkRangesOrGetDefault(opts, "windowBits", i16, 9, 15, 15) orelse return null,
            .GUNZIP, .UNZIP => getWindowBits(globalThis, opts, "windowBits", i16, 9, 15, 15) orelse return null,
        };

        const dictionary = blk: {
            var exceptionref: JSC.C.JSValueRef = null;
            const value: JSC.JSValue = opts.get(globalThis, "dictionary") orelse {
                if (globalThis.hasException()) return null;
                break :blk JSC.Buffer.fromBytes(&.{}, bun.default_allocator, .Uint8Array);
            };
            const buffer = JSC.Buffer.fromJS(globalThis, value, &exceptionref) orelse {
                const ty_str = value.jsTypeString(globalThis).toSlice(globalThis, bun.default_allocator);
                defer ty_str.deinit();
                globalThis.ERR_INVALID_ARG_TYPE("The \"options.dictionary\" property must be an instance of Buffer, TypedArray, DataView, or ArrayBuffer. Received {s}", .{ty_str.slice()}).throw();
                return null;
            };
            if (exceptionref) |ptr| {
                globalThis.throwValue(JSC.JSValue.c(ptr));
                return null;
            }
            break :blk buffer;
        };

        return .{
            .chunkSize = chunkSize,
            .level = level,
            .windowBits = windowBits,
            .memLevel = memLevel,
            .strategy = strategy,
            .dictionary = dictionary,
            .maxOutputLength = maxOutputLength,
            .flush = flush,
            .finishFlush = finishFlush,
            .fullFlush = fullFlush,
        };
    }

    // Specialization of globalThis.checkRangesOrGetDefault since windowBits also allows 0 when decompressing
    fn getWindowBits(this: *JSC.JSGlobalObject, obj: JSC.JSValue, comptime field_name: []const u8, comptime T: type, min: T, max: T, default: T) ?T {
        if (obj.get(this, field_name)) |level_val| {
            if (!level_val.isNumber()) {
                _ = this.throwInvalidPropertyTypeValue("options." ++ field_name, "number", level_val);
                return null;
            }
            const level_f64 = level_val.asNumber();
            if (level_f64 == 0) return 0;
            if (std.math.isNan(level_f64)) return default;
            if (level_f64 == std.math.inf(f64)) {
                this.ERR_OUT_OF_RANGE("The value of \"options.{s}\" is out of range. It must be >= {d}. Received Infinity", .{ field_name, min }).throw();
                return null;
            }
            if (level_f64 == -std.math.inf(f64)) {
                this.ERR_OUT_OF_RANGE("The value of \"options.{s}\" is out of range. It must be >= {d}. Received -Infinity", .{ field_name, min }).throw();
                return null;
            }
            if (@floor(level_f64) != level_f64) {
                _ = this.throwInvalidPropertyTypeValue("options." ++ field_name, "integer", level_val);
                return null;
            }
            if (level_f64 > std.math.maxInt(i32)) {
                this.ERR_OUT_OF_RANGE("The value of \"options.{s}\" is out of range. It must be >= {d} and <= {d}. Received {d}", .{ field_name, min, max, level_f64 }).throw();
                return null;
            }
            const level_i32 = level_val.toInt32();
            if (level_i32 < min or level_i32 > max) {
                this.ERR_OUT_OF_RANGE("The value of \"options.{s}\" is out of range. It must be >= {d} and <= {d}. Received {d}", .{ field_name, min, max, level_i32 }).throw();
                return null;
            }
            return @intCast(level_i32);
        }
        if (this.hasException()) return null;
        return default;
    }
};
