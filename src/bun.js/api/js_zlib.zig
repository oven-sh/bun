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
                .chunkSize = options.chunkSize,
                .flush = @enumFromInt(options.flush),
                .finishFlush = @enumFromInt(options.finishFlush),
                .fullFlush = @enumFromInt(options.fullFlush),
                .level = options.level,
                .windowBits = options.windowBits,
                .memLevel = options.memLevel,
                .strategy = options.strategy,
                .dictionary = options.dictionary.slice(),
            },
        });
        this.stream.init() catch {
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
        const arguments = callframe.arguments(4);

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
        const optional_flushFlag = arguments.ptr[3];

        const old_flushFlag = this.stream.flush;
        defer this.stream.flush = old_flushFlag;
        blk: {
            if (!optional_flushFlag.isInt32()) break :blk;
            const int = optional_flushFlag.asInt32();
            if (int < 0) break :blk;
            if (int > 5) break :blk;
            this.stream.flush = @enumFromInt(int);
        }

        const input_to_queue = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueMaybeAsync(globalThis, bun.default_allocator, input, optional_encoding, false) orelse {
            return globalThis.throwInvalidArgumentTypeValue("buffer", "string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer", input);
        };
        defer input_to_queue.deinit();

        if (is_last)
            this.has_called_end = true;

        {
            this.stream.write(input_to_queue.slice(), &this.output, true) catch |err| return handleTransformSyncStreamError(err, globalThis, this.stream.err_msg, &this.closed);
        }
        if (this.output.items.len > this.maxOutputLength) {
            globalThis.ERR_BUFFER_TOO_LARGE("Cannot create a Buffer larger than {d} bytes", .{this.maxOutputLength}).throw();
            return .zero;
        }
        if (is_last) {
            this.stream.end(&this.output) catch |err| return handleTransformSyncStreamError(err, globalThis, this.stream.err_msg, &this.closed);
        }
        if (this.output.items.len > this.maxOutputLength) {
            globalThis.ERR_BUFFER_TOO_LARGE("Cannot create a Buffer larger than {d} bytes", .{this.maxOutputLength}).throw();
            return .zero;
        }

        if (!is_last and this.output.items.len == 0) {
            return JSC.Buffer.fromBytes(&.{}, bun.default_allocator, .Uint8Array).toNodeBuffer(globalThis);
        }
        if (this.write_failure != null) {
            globalThis.vm().throwError(globalThis, this.write_failure.?.toError(globalThis));
            return .zero;
        }
        return this.collectOutputValue();
    }

    pub fn transformWith(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(4);

        if (arguments.len < 4) {
            globalThis.throwNotEnoughArguments("ZlibEncoder.encode", 4, arguments.len);
            return .zero;
        }

        if (this.has_called_end) {
            globalThis.throw("ZlibEncoder.encodeSync called after ZlibEncoder.end", .{});
            return .zero;
        }

        const input = callframe.argument(0);
        const optional_encoding = callframe.argument(1);
        const thisctx = arguments.ptr[2];
        const is_last = callframe.argument(3).toBoolean();

        const push_fn = thisctx.get(globalThis, "push") orelse {
            globalThis.throw("are you sure this is a stream.Transform?", .{});
            return .zero;
        };
        if (globalThis.hasException()) return .zero;

        const input_to_queue = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueMaybeAsync(globalThis, bun.default_allocator, input, optional_encoding, false) orelse {
            return globalThis.throwInvalidArgumentTypeValue("buffer", "string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer", input);
        };
        defer input_to_queue.deinit();

        if (is_last)
            this.has_called_end = true;

        const err_buffer_too_large = globalThis.ERR_BUFFER_TOO_LARGE("Cannot create a Buffer larger than {d} bytes", .{this.maxOutputLength});

        {
            this.stream.write(input_to_queue.slice(), &this.output, false) catch |err| return handleTransformSyncStreamError(err, globalThis, this.stream.err_msg, &this.closed);
            if (this.output.items.len > this.maxOutputLength) {
                err_buffer_too_large.throw();
                return .zero;
            }
            while (true) {
                const done = this.stream.doWork(&this.output, this.stream.flush) catch |err| return handleTransformSyncStreamError(err, globalThis, this.stream.err_msg, &this.closed);
                if (this.output.items.len > this.maxOutputLength) {
                    err_buffer_too_large.throw();
                    return .zero;
                }
                if (this.output.items.len > 0) runCallback(push_fn, globalThis, thisctx, &.{this.collectOutputValue()}) orelse return .zero;
                if (done) break;
            }
        }
        if (is_last) {
            this.stream.end(&this.output) catch |err| return handleTransformSyncStreamError(err, globalThis, this.stream.err_msg, &this.closed);
            if (this.output.items.len > this.maxOutputLength) {
                globalThis.ERR_BUFFER_TOO_LARGE("Cannot create a Buffer larger than {d} bytes", .{this.maxOutputLength}).throw();
                return .zero;
            }
            if (this.output.items.len > 0) runCallback(push_fn, globalThis, thisctx, &.{this.collectOutputValue()}) orelse return .zero;
        }
        return .undefined;
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

                    defer {
                        this.encoder.freelist_write_lock.lock();
                        this.encoder.freelist.write(pending) catch unreachable;
                        this.encoder.freelist_write_lock.unlock();
                    }
                    for (pending) |input| {
                        const output = &this.encoder.output;
                        this.encoder.stream.write(input.slice(), output, true) catch |e| {
                            any = true;
                            _ = this.encoder.pending_encode_job_count.fetchSub(1, .monotonic);
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

            if (any) {
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

        const level = if (arguments[0] != .zero) (globalThis.validateIntegerRange(arguments[0], i16, -1, .{ .max = 9, .min = -1, .field_name = "level" }) orelse return .zero) else this.stream.level;
        const strategy = if (arguments[1] != .zero) (globalThis.validateIntegerRange(arguments[1], u8, 0, .{ .max = 4, .min = 0, .field_name = "strategy" }) orelse return .zero) else this.stream.strategy;
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
                .chunkSize = options.chunkSize,
                .flush = @enumFromInt(options.flush),
                .finishFlush = @enumFromInt(options.finishFlush),
                .fullFlush = @enumFromInt(options.fullFlush),
                .windowBits = options.windowBits,
                .dictionary = options.dictionary.slice(),
            },
        });
        this.stream.init() catch {
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
        const arguments = callframe.arguments(4);

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
        const optional_flushFlag = arguments.ptr[3];

        const old_flushFlag = this.stream.flush;
        defer this.stream.flush = old_flushFlag;
        blk: {
            if (!optional_flushFlag.isInt32()) break :blk;
            const int = optional_flushFlag.asInt32();
            if (int < 0) break :blk;
            if (int > 5) break :blk;
            this.stream.flush = @enumFromInt(int);
        }

        const input_to_queue = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueMaybeAsync(globalThis, bun.default_allocator, input, optional_encoding, true) orelse {
            return globalThis.throwInvalidArgumentTypeValue("buffer", "string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer", input);
        };

        if (is_last)
            this.has_called_end = true;

        {
            this.stream.writeAll(input_to_queue.slice(), &this.output, true) catch |err| return handleTransformSyncStreamError(err, globalThis, this.stream.err_msg, &this.closed);
        }
        if (this.output.items.len > this.maxOutputLength) {
            globalThis.ERR_BUFFER_TOO_LARGE("Cannot create a Buffer larger than {d} bytes", .{this.maxOutputLength}).throw();
            return .zero;
        }
        if (is_last) {
            this.stream.end(&this.output) catch |err| return handleTransformSyncStreamError(err, globalThis, this.stream.err_msg, &this.closed);
        }
        if (this.output.items.len > this.maxOutputLength) {
            globalThis.ERR_BUFFER_TOO_LARGE("Cannot create a Buffer larger than {d} bytes", .{this.maxOutputLength}).throw();
            return .zero;
        }

        if (!is_last and this.output.items.len == 0) {
            return JSC.Buffer.fromBytes(&.{}, bun.default_allocator, .Uint8Array).toNodeBuffer(globalThis);
        }
        if (this.write_failure != null) {
            globalThis.vm().throwError(globalThis, this.write_failure.?.toError(globalThis));
            return .zero;
        }
        return this.collectOutputValue();
    }

    pub fn transformWith(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(4);

        if (arguments.len < 4) {
            globalThis.throwNotEnoughArguments("ZlibEncoder.encode", 4, arguments.len);
            return .zero;
        }

        if (this.has_called_end) {
            globalThis.throw("ZlibEncoder.encodeSync called after ZlibEncoder.end", .{});
            return .zero;
        }

        const input = callframe.argument(0);
        const optional_encoding = callframe.argument(1);
        const thisctx = arguments.ptr[2];
        const is_last = callframe.argument(3).toBoolean();

        const push_fn = thisctx.get(globalThis, "push") orelse {
            globalThis.throw("are you sure this is a stream.Transform?", .{});
            return .zero;
        };
        if (globalThis.hasException()) return .zero;

        const input_to_queue = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValue(globalThis, bun.default_allocator, input, optional_encoding) orelse {
            return globalThis.throwInvalidArgumentTypeValue("buffer", "string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer", input);
        };
        defer input_to_queue.deinit();
        if (is_last)
            this.has_called_end = true;

        const err_buffer_too_large = globalThis.ERR_BUFFER_TOO_LARGE("Cannot create a Buffer larger than {d} bytes", .{this.maxOutputLength});

        {
            const input_slice = input_to_queue.slice();
            this.stream.writeAll(input_slice, &this.output, false) catch |err| return handleTransformSyncStreamError(err, globalThis, this.stream.err_msg, &this.closed);
            if (this.output.items.len > this.maxOutputLength) {
                err_buffer_too_large.throw();
                return .zero;
            }
            while (this.stream.do_inflate_loop) {
                const done = this.stream.doWork(&this.output, this.stream.flush) catch |err| return handleTransformSyncStreamError(err, globalThis, this.stream.err_msg, &this.closed);
                if (this.output.items.len > this.maxOutputLength) {
                    err_buffer_too_large.throw();
                    return .zero;
                }
                if (this.output.items.len > 0) runCallback(push_fn, globalThis, thisctx, &.{this.collectOutputValue()}) orelse return .zero;
                if (done) break;
            }
        }
        if (is_last) {
            this.stream.end(&this.output) catch |err| return handleTransformSyncStreamError(err, globalThis, this.stream.err_msg, &this.closed);
            if (this.output.items.len > this.maxOutputLength) {
                globalThis.ERR_BUFFER_TOO_LARGE("Cannot create a Buffer larger than {d} bytes", .{this.maxOutputLength}).throw();
                return .zero;
            }
            if (this.output.items.len > 0) runCallback(push_fn, globalThis, thisctx, &.{this.collectOutputValue()}) orelse return .zero;
        }
        return .undefined;
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

                    defer {
                        this.decoder.freelist_write_lock.lock();
                        this.decoder.freelist.write(pending) catch unreachable;
                        this.decoder.freelist_write_lock.unlock();
                    }
                    for (pending) |input| {
                        const output = &this.decoder.output;
                        this.decoder.stream.writeAll(input.slice(), output, true) catch |e| {
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
                            else => {
                                this.decoder.write_failure = JSC.DeferredError.from(.plainerror, .ERR_OPERATION_FAILED, "ZlibError: {s}", .{@errorName(e)}); // TODO propogate better error
                                break :outer;
                            },
                        }
                    };
                    if (output.items.len > this.decoder.maxOutputLength) {
                        any = true;
                        _ = this.decoder.pending_encode_job_count.fetchSub(1, .monotonic);
                        this.decoder.write_failure = JSC.DeferredError.from(.rangeerror, .ERR_BUFFER_TOO_LARGE, "Cannot create a Buffer larger than {d} bytes", .{this.decoder.maxOutputLength});
                        break :outer;
                    }
                }
            }

            if (any) {
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
    chunkSize: c_uint,
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
        const chunkSize = globalThis.getInteger(opts, c_uint, 48 * 1024, .{
            .field_name = "chunkSize",
            .min = 64,
        }) orelse return null;
        const level = globalThis.getInteger(opts, i16, -1, .{ .field_name = "level", .min = -1, .max = 9 }) orelse return null;
        const memLevel = globalThis.getInteger(opts, u8, 8, .{ .field_name = "memLevel", .min = 8, .max = 255 }) orelse return null;
        const strategy = globalThis.getInteger(opts, u8, 0, .{ .field_name = "strategy", .min = 0, .max = 4 }) orelse return null;
        const maxOutputLength = globalThis.getInteger(opts, usize, std.math.maxInt(u52), .{ .field_name = "maxOutputLength", .min = 0, .max = std.math.maxInt(u52) }) orelse return null;
        const flush = globalThis.getInteger(opts, u8, 0, .{ .field_name = "flush", .min = 0, .max = 5 }) orelse return null;
        const finishFlush = globalThis.getInteger(opts, u8, 4, .{ .field_name = "finishFlush", .min = 0, .max = 5 }) orelse return null;
        const fullFlush = globalThis.getInteger(opts, u8, 3, .{ .field_name = "fullFlush", .min = 0, .max = 5 }) orelse return null;

        const windowBits = switch (mode) {
            .NONE,
            .BROTLI_DECODE,
            .BROTLI_ENCODE,
            => unreachable,
            .DEFLATE, .DEFLATERAW => globalThis.getInteger(opts, u8, 15, .{ .min = 8, .max = 15, .field_name = "windowBits" }) orelse return null,
            .INFLATE, .INFLATERAW => getWindowBits(globalThis, opts, "windowBits", u8, 8, 15, 15) orelse return null,
            .GZIP => globalThis.getInteger(opts, i16, 15, .{ .min = 9, .max = 15, .field_name = "windowBits" }) orelse return null,
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
    fn getWindowBits(this: *JSC.JSGlobalObject, obj: JSC.JSValue, comptime field_name: []const u8, comptime T: type, comptime min: T, comptime max: T, comptime default: T) ?T {
        return this.getInteger(obj, T, default, .{
            .field_name = field_name,
            .min = min,
            .max = max,
            .always_allow_zero = true,
        });
    }
};

fn handleTransformSyncStreamError(err: anyerror, globalThis: *JSC.JSGlobalObject, err_msg: ?[*:0]const u8, closed: *bool) JSC.JSValue {
    switch (err) {
        error.ZlibError => {
            globalThis.throw("{s}", .{std.mem.sliceTo(err_msg.?, 0)});
        },
        else => {
            globalThis.throw("ZlibError: {s}", .{@errorName(err)});
        },
    }
    closed.* = true;
    return .zero;
}

fn runCallback(callback: JSC.JSValue, globalObject: *JSC.JSGlobalObject, thisValue: JSC.JSValue, arguments: []const JSC.JSValue) ?void {
    _ = callback.call(globalObject, thisValue, arguments);
    if (globalObject.hasException()) return null;
    return;
}
