const bun = @import("root").bun;
const JSC = bun.JSC;
const std = @import("std");
const brotli = bun.brotli;

const Queue = std.fifo.LinearFifo(JSC.Node.BlobOrStringOrBuffer, .Dynamic);

// We cannot free outside the JavaScript thread.
const FreeList = struct {
    write_lock: bun.Lock = .{},
    list: std.ArrayListUnmanaged(JSC.Node.BlobOrStringOrBuffer) = .{},

    pub fn append(this: *FreeList, slice: []const JSC.Node.BlobOrStringOrBuffer) void {
        this.write_lock.lock();
        defer this.write_lock.unlock();
        this.list.appendSlice(bun.default_allocator, slice) catch bun.outOfMemory();
    }

    pub fn drain(this: *FreeList) void {
        this.write_lock.lock();
        defer this.write_lock.unlock();
        const out = this.list.items;
        for (out) |*item| {
            item.deinitAndUnprotect();
        }
        this.list.clearRetainingCapacity();
    }

    pub fn deinit(this: *FreeList) void {
        this.drain();
        this.list.deinit(bun.default_allocator);
    }
};

pub const BrotliEncoder = struct {
    pub usingnamespace bun.New(@This());
    pub usingnamespace JSC.Codegen.JSBrotliEncoder;

    stream: brotli.BrotliCompressionStream,
    maxOutputLength: usize,

    freelist: FreeList = .{},

    globalThis: *JSC.JSGlobalObject,
    mode: u8,

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

    pub fn hasPendingActivity(this: *BrotliEncoder) bool {
        return this.has_pending_activity.load(.monotonic) > 0;
    }

    pub fn constructor(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) ?*BrotliEncoder {
        globalThis.throw("BrotliEncoder is not constructable", .{});
        return null;
    }

    pub fn create(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        const arguments = callframe.arguments(4).slice();

        if (arguments.len < 4) {
            globalThis.throwNotEnoughArguments("BrotliEncoder", 4, arguments.len);
            return .zero;
        }

        const opts = arguments[0];
        const callback = arguments[2];
        const mode = arguments[3].to(u8);

        const chunk_size = globalThis.getInteger(opts, u32, 1024 * 48, .{
            .min = 64,
            .field_name = "chunkSize",
        }) orelse return .zero;
        _ = chunk_size; // autofix
        const maxOutputLength = globalThis.getInteger(opts, usize, 0, .{ .max = std.math.maxInt(u52), .field_name = "maxOutputLength" }) orelse return .zero;
        const flush = globalThis.getInteger(opts, u8, 0, .{ .max = 3, .field_name = "flush" }) orelse return .zero;
        const finishFlush = globalThis.getInteger(opts, u8, 2, .{ .max = 3, .field_name = "finishFlush" }) orelse return .zero;
        const fullFlush = globalThis.getInteger(opts, u8, 1, .{ .max = 3, .field_name = "fullFlush" }) orelse return .zero;

        var this: *BrotliEncoder = BrotliEncoder.new(.{
            .globalThis = globalThis,
            .stream = brotli.BrotliCompressionStream.init(@enumFromInt(flush), @enumFromInt(finishFlush), @enumFromInt(fullFlush)) catch {
                globalThis.throw("Failed to create BrotliEncoder", .{});
                return .zero;
            },
            .maxOutputLength = maxOutputLength,
            .mode = mode,
        });

        if (opts.get(globalThis, "params")) |params| {
            inline for (std.meta.fields(bun.brotli.c.BrotliEncoderParameter)) |f| {
                if (params.hasOwnPropertyValue(globalThis, JSC.ZigString.static(std.fmt.comptimePrint("{d}", .{f.value})).toJS(globalThis))) {
                    const idx = params.getIndex(globalThis, f.value);
                    if (!idx.isNumber()) {
                        globalThis.throwValue(globalThis.ERR_INVALID_ARG_TYPE_static(
                            JSC.ZigString.static("options.params[key]"),
                            JSC.ZigString.static("number"),
                            idx,
                        ));
                        this.deinit();
                        return .zero;
                    }
                    const was_set = this.stream.brotli.setParameter(@enumFromInt(f.value), idx.toU32());
                    if (!was_set) {
                        globalThis.ERR_ZLIB_INITIALIZATION_FAILED("Initialization failed", .{}).throw();
                        this.deinit();
                        return .zero;
                    }
                }
            }
        }
        if (globalThis.hasException()) return .zero;

        const out = this.toJS(globalThis);
        this.callback_value.set(globalThis, callback);

        return out;
    }

    pub fn finalize(this: *BrotliEncoder) void {
        this.deinit();
    }

    pub fn deinit(this: *BrotliEncoder) void {
        this.callback_value.deinit();
        this.freelist.deinit();
        this.output.deinit(bun.default_allocator);
        this.stream.deinit();
        this.input.deinit();
        this.destroy();
    }

    fn drainFreelist(this: *BrotliEncoder) void {
        this.freelist.drain();
    }

    fn collectOutputValue(this: *BrotliEncoder) JSC.JSValue {
        this.output_lock.lock();
        defer this.output_lock.unlock();

        defer this.output.clearRetainingCapacity();
        return JSC.ArrayBuffer.createBuffer(this.globalThis, this.output.items);
    }

    pub fn runFromJSThread(this: *BrotliEncoder) void {
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

    // We can only run one encode job at a time
    // But we don't have an idea of a serial dispatch queue
    // So instead, we let you enqueue as many times as you want
    // and if one is already running, we just don't do anything
    const EncodeJob = struct {
        task: JSC.WorkPoolTask = .{ .callback = &runTask },
        encoder: *BrotliEncoder,
        is_async: bool,
        vm: *JSC.VirtualMachine,

        pub usingnamespace bun.New(@This());

        pub fn runTask(this: *JSC.WorkPoolTask) void {
            var job: *EncodeJob = @fieldParentPtr("task", this);
            job.run();
            job.destroy();
        }

        pub fn run(this: *EncodeJob) void {
            defer {
                _ = this.encoder.has_pending_activity.fetchSub(1, .monotonic);
            }

            var any = false;

            if (this.encoder.pending_encode_job_count.fetchAdd(1, .monotonic) >= 0) {
                const is_last = this.encoder.has_called_end;
                while (true) {
                    this.encoder.input_lock.lock();
                    defer this.encoder.input_lock.unlock();
                    const readable = this.encoder.input.readableSlice(0);
                    defer this.encoder.input.discard(readable.len);
                    const pending = readable;

                    const Writer = struct {
                        encoder: *BrotliEncoder,

                        pub const Error = error{OutOfMemory};
                        pub fn writeAll(writer: @This(), chunk: []const u8) Error!void {
                            writer.encoder.output_lock.lock();
                            defer writer.encoder.output_lock.unlock();

                            try writer.encoder.output.appendSlice(bun.default_allocator, chunk);
                        }
                    };

                    defer {
                        this.encoder.freelist.append(pending);
                    }
                    for (pending) |*input| {
                        var writer = this.encoder.stream.writer(Writer{ .encoder = this.encoder });
                        writer.writeAll(input.slice()) catch {
                            _ = this.encoder.pending_encode_job_count.fetchSub(1, .monotonic);
                            if (!this.is_async) {
                                this.encoder.closed = true;
                                this.encoder.globalThis.throw("BrotliError", .{});
                                return;
                            }
                            this.encoder.write_failure = JSC.DeferredError.from(.plainerror, .ERR_OPERATION_FAILED, "BrotliError", .{}); // TODO propogate better error
                            return;
                        };
                        if (this.encoder.output.items.len > this.encoder.maxOutputLength) {
                            _ = this.encoder.pending_encode_job_count.fetchSub(1, .monotonic);
                            this.encoder.write_failure = JSC.DeferredError.from(.rangeerror, .ERR_BUFFER_TOO_LARGE, "Cannot create a Buffer larger than {d} bytes", .{this.encoder.maxOutputLength});
                            return;
                        }
                    }

                    any = any or pending.len > 0;

                    if (this.encoder.pending_encode_job_count.fetchSub(1, .monotonic) == 0)
                        break;
                }

                if (is_last and any) {
                    var output = &this.encoder.output;
                    this.encoder.output_lock.lock();
                    defer this.encoder.output_lock.unlock();

                    output.appendSlice(bun.default_allocator, this.encoder.stream.end() catch {
                        _ = this.encoder.pending_encode_job_count.fetchSub(1, .monotonic);
                        this.encoder.write_failure = JSC.DeferredError.from(.plainerror, .ERR_OPERATION_FAILED, "BrotliError", .{}); // TODO propogate better error
                        return;
                    }) catch {
                        _ = this.encoder.pending_encode_job_count.fetchSub(1, .monotonic);
                        this.encoder.write_failure = JSC.DeferredError.from(.plainerror, .ERR_OPERATION_FAILED, "BrotliError", .{}); // TODO propogate better error
                        return;
                    };
                    if (output.items.len > this.encoder.maxOutputLength) {
                        _ = this.encoder.pending_encode_job_count.fetchSub(1, .monotonic);
                        this.encoder.write_failure = JSC.DeferredError.from(.rangeerror, .ERR_BUFFER_TOO_LARGE, "Cannot create a Buffer larger than {d} bytes", .{this.encoder.maxOutputLength});
                        return;
                    }
                }
            }

            if (this.is_async and any) {
                _ = this.encoder.has_pending_activity.fetchAdd(1, .monotonic);
                this.vm.enqueueTaskConcurrent(JSC.ConcurrentTask.create(JSC.Task.init(this.encoder)));
            }
        }
    };

    pub fn transform(this: *BrotliEncoder, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        const arguments = callframe.arguments(3);

        if (arguments.len < 3) {
            globalThis.throwNotEnoughArguments("BrotliEncoder.encode", 3, arguments.len);
            return .zero;
        }

        if (this.has_called_end) {
            globalThis.throw("BrotliEncoder.encode called after BrotliEncoder.end", .{});
            return .zero;
        }

        const input = callframe.argument(0);
        const optional_encoding = callframe.argument(1);
        const is_last = callframe.argument(2).toBoolean();

        const input_to_queue = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueMaybeAsync(globalThis, bun.default_allocator, input, optional_encoding, true) orelse {
            globalThis.throwInvalidArgumentType("BrotliEncoder.encode", "input", "Blob, String, or Buffer");
            return .zero;
        };

        _ = this.has_pending_activity.fetchAdd(1, .monotonic);
        if (is_last)
            this.has_called_end = true;

        var task = EncodeJob.new(.{
            .encoder = this,
            .is_async = true,
            .vm = this.globalThis.bunVM(),
        });

        {
            this.input_lock.lock();
            defer this.input_lock.unlock();

            // need to protect because no longer on the stack. unprotected in FreeList.deinit
            input_to_queue.protect();
            this.input.writeItem(input_to_queue) catch bun.outOfMemory();
        }
        this.poll_ref.ref(task.vm);
        JSC.WorkPool.schedule(&task.task);

        return .undefined;
    }

    pub fn transformSync(this: *BrotliEncoder, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        const arguments = callframe.arguments(4);

        if (arguments.len < 3) {
            globalThis.throwNotEnoughArguments("BrotliEncoder.encode", 3, arguments.len);
            return .zero;
        }

        if (this.has_called_end) {
            globalThis.throw("BrotliEncoder.encode called after BrotliEncoder.end", .{});
            return .zero;
        }

        const input = callframe.argument(0);
        const optional_encoding = callframe.argument(1);
        const is_last = callframe.argument(2).toBoolean();
        const optional_flushFlag = arguments.ptr[3];

        const old_flushFlag = this.stream.flushOp;
        defer this.stream.flushOp = old_flushFlag;
        blk: {
            if (!optional_flushFlag.isInt32()) break :blk;
            const int = optional_flushFlag.asInt32();
            if (int < 0) break :blk;
            if (int > 3) break :blk;
            this.stream.flushOp = @enumFromInt(int);
        }

        const input_to_queue = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueMaybeAsync(globalThis, bun.default_allocator, input, optional_encoding, true) orelse {
            globalThis.throwInvalidArgumentType("BrotliEncoder.encode", "input", "Blob, String, or Buffer");
            return .zero;
        };

        _ = this.has_pending_activity.fetchAdd(1, .monotonic);
        if (is_last)
            this.has_called_end = true;

        var task: EncodeJob = .{
            .encoder = this,
            .is_async = false,
            .vm = this.globalThis.bunVM(),
        };

        {
            this.input_lock.lock();
            defer this.input_lock.unlock();

            // need to protect because no longer on the stack. unprotected in FreeList.deinit
            input_to_queue.protect();
            this.input.writeItem(input_to_queue) catch bun.outOfMemory();
        }
        task.run();
        if (!is_last and this.output.items.len == 0) {
            return JSC.Buffer.fromBytes(&.{}, bun.default_allocator, .Uint8Array).toNodeBuffer(globalThis);
        }
        if (this.write_failure != null) {
            globalThis.vm().throwError(globalThis, this.write_failure.?.toError(globalThis));
            return .zero;
        }
        return this.collectOutputValue();
    }

    pub fn reset(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        return .undefined;
    }

    pub fn getBytesWritten(this: *@This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        _ = globalObject;
        return JSC.JSValue.jsNumber(this.stream.total_in);
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
};

pub const BrotliDecoder = struct {
    pub usingnamespace bun.New(@This());
    pub usingnamespace JSC.Codegen.JSBrotliDecoder;

    globalThis: *JSC.JSGlobalObject,
    stream: brotli.BrotliReaderArrayList,
    maxOutputLength: usize,
    mode: u8,

    has_pending_activity: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    ref_count: u32 = 1,
    poll_ref: bun.Async.KeepAlive = .{},
    write_failure: ?JSC.DeferredError = null,
    callback_value: JSC.Strong = .{},
    has_called_end: bool = false,
    pending_decode_job_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    closed: bool = false,

    input: Queue = Queue.init(bun.default_allocator),
    input_lock: bun.Lock = .{},

    output: std.ArrayListUnmanaged(u8) = .{},
    output_lock: bun.Lock = .{},

    freelist: FreeList = .{},

    pub fn hasPendingActivity(this: *BrotliDecoder) bool {
        return this.has_pending_activity.load(.monotonic) > 0;
    }

    pub fn deinit(this: *BrotliDecoder) void {
        this.callback_value.deinit();
        this.freelist.deinit();
        this.output.deinit(bun.default_allocator);
        this.stream.brotli.destroyInstance();
        this.input.deinit();
        this.destroy();
    }

    pub fn constructor(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) ?*BrotliDecoder {
        globalThis.throw("BrotliDecoder is not constructable", .{});
        return null;
    }

    pub fn create(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        const arguments = callframe.arguments(4).slice();

        if (arguments.len < 4) {
            globalThis.throwNotEnoughArguments("BrotliDecoder", 4, arguments.len);
            return .zero;
        }

        const opts = arguments[0];
        const callback = arguments[2];
        const mode = arguments[3].to(u8);

        const maxOutputLength = globalThis.getInteger(opts, usize, 0, .{ .max = std.math.maxInt(u52), .field_name = "maxOutputLength" }) orelse return .zero;
        const flush = globalThis.getInteger(opts, u8, 0, .{ .max = 6, .field_name = "flush" }) orelse return .zero;
        const finishFlush = globalThis.getInteger(opts, u8, 2, .{ .max = 6, .field_name = "finishFlush" }) orelse return .zero;
        const fullFlush = globalThis.getInteger(opts, u8, 1, .{ .max = 6, .field_name = "fullFlush" }) orelse return .zero;

        var this: *BrotliDecoder = BrotliDecoder.new(.{
            .globalThis = globalThis,
            .stream = undefined, // &this.output needs to be a stable pointer
            .maxOutputLength = maxOutputLength,
            .mode = mode,
        });
        this.stream = brotli.BrotliReaderArrayList.initWithOptions("", &this.output, bun.default_allocator, .{}) catch {
            globalThis.throw("Failed to create BrotliDecoder", .{});
            return .zero;
        };
        _ = flush;
        _ = finishFlush;
        _ = fullFlush;

        if (opts.get(globalThis, "params")) |params| {
            inline for (std.meta.fields(bun.brotli.c.BrotliDecoderParameter)) |f| {
                const idx = params.getIndex(globalThis, f.value);
                if (!idx.isNumber()) break;
                const was_set = this.stream.brotli.setParameter(@enumFromInt(f.value), idx.toU32());
                if (!was_set) {
                    globalThis.ERR_ZLIB_INITIALIZATION_FAILED("Initialization failed", .{}).throw();
                    this.deinit();
                    return .zero;
                }
            }
        }
        if (globalThis.hasException()) return .zero;

        const out = this.toJS(globalThis);
        this.callback_value.set(globalThis, callback);

        return out;
    }

    pub fn finalize(this: *BrotliDecoder) void {
        this.deinit();
    }

    fn collectOutputValue(this: *BrotliDecoder) JSC.JSValue {
        this.output_lock.lock();
        defer this.output_lock.unlock();

        defer this.output.clearRetainingCapacity();
        return JSC.ArrayBuffer.createBuffer(this.globalThis, this.output.items);
    }

    pub fn runFromJSThread(this: *BrotliDecoder) void {
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

    fn drainFreelist(this: *BrotliDecoder) void {
        this.freelist.drain();
    }

    pub fn transform(this: *BrotliDecoder, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        const arguments = callframe.arguments(3);

        if (arguments.len < 3) {
            globalThis.throwNotEnoughArguments("BrotliEncoder.decode", 3, arguments.len);
            return .zero;
        }

        if (this.has_called_end) {
            globalThis.throw("BrotliEncoder.decode called after BrotliEncoder.end", .{});
            return .zero;
        }

        const input = callframe.argument(0);
        const optional_encoding = callframe.argument(1);
        const is_last = callframe.argument(2).toBoolean();

        const input_to_queue = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueMaybeAsync(globalThis, bun.default_allocator, input, optional_encoding, true) orelse {
            globalThis.throwInvalidArgumentType("BrotliEncoder.decode", "input", "Blob, String, or Buffer");
            return .zero;
        };

        _ = this.has_pending_activity.fetchAdd(1, .monotonic);
        if (is_last)
            this.has_called_end = true;

        var task = DecodeJob.new(.{
            .decoder = this,
            .is_async = true,
            .vm = this.globalThis.bunVM(),
        });

        {
            this.input_lock.lock();
            defer this.input_lock.unlock();

            // need to protect because no longer on the stack. unprotected in FreeList.deinit
            input_to_queue.protect();
            this.input.writeItem(input_to_queue) catch bun.outOfMemory();
        }
        this.poll_ref.ref(task.vm);
        JSC.WorkPool.schedule(&task.task);

        return .undefined;
    }

    pub fn transformSync(this: *BrotliDecoder, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        const arguments = callframe.arguments(4);

        if (arguments.len < 3) {
            globalThis.throwNotEnoughArguments("BrotliEncoder.decode", 3, arguments.len);
            return .zero;
        }

        if (this.has_called_end) {
            globalThis.throw("BrotliEncoder.decode called after BrotliEncoder.end", .{});
            return .zero;
        }

        const input = callframe.argument(0);
        const optional_encoding = callframe.argument(1);
        const is_last = callframe.argument(2).toBoolean();
        // const optional_flushFlag = arguments.ptr[3];

        // const old_flushFlag = this.stream.flushOp;
        // defer this.stream.flushOp = old_flushFlag;
        // blk: {
        //     if (!optional_flushFlag.isInt32()) break :blk;
        //     const int = optional_flushFlag.asInt32();
        //     if (int < 0) break :blk;
        //     if (int > 3) break :blk;
        //     this.stream.flushOp = @enumFromInt(int);
        // }

        const input_to_queue = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueMaybeAsync(globalThis, bun.default_allocator, input, optional_encoding, true) orelse {
            globalThis.throwInvalidArgumentType("BrotliEncoder.decode", "input", "Blob, String, or Buffer");
            return .zero;
        };

        _ = this.has_pending_activity.fetchAdd(1, .monotonic);
        if (is_last)
            this.has_called_end = true;

        var task: DecodeJob = .{
            .decoder = this,
            .is_async = false,
            .vm = this.globalThis.bunVM(),
        };

        {
            this.input_lock.lock();
            defer this.input_lock.unlock();

            // need to protect because no longer on the stack. unprotected in FreeList.deinit
            input_to_queue.protect();
            this.input.writeItem(input_to_queue) catch bun.outOfMemory();
        }
        task.run();
        if (!is_last and this.output.items.len == 0) {
            return JSC.Buffer.fromBytes(&.{}, bun.default_allocator, .Uint8Array).toNodeBuffer(globalThis);
        }
        if (this.write_failure != null) {
            globalThis.throwValue(this.write_failure.?.toError(globalThis));
            return .zero;
        }
        return this.collectOutputValue();
    }

    // We can only run one decode job at a time
    // But we don't have an idea of a serial dispatch queue
    // So instead, we let you enqueue as many times as you want
    // and if one is already running, we just don't do anything
    const DecodeJob = struct {
        task: JSC.WorkPoolTask = .{ .callback = &runTask },
        decoder: *BrotliDecoder,
        is_async: bool,
        vm: *JSC.VirtualMachine,

        pub usingnamespace bun.New(@This());

        pub fn runTask(this: *JSC.WorkPoolTask) void {
            var job: *DecodeJob = @fieldParentPtr("task", this);
            job.run();
            job.destroy();
        }

        pub fn run(this: *DecodeJob) void {
            defer {
                _ = this.decoder.has_pending_activity.fetchSub(1, .monotonic);
            }

            var any = false;

            if (this.decoder.pending_decode_job_count.fetchAdd(1, .monotonic) >= 0) {
                const is_last = this.decoder.has_called_end;
                while (true) {
                    this.decoder.input_lock.lock();
                    defer this.decoder.input_lock.unlock();
                    if (!is_last) break;
                    const pending = this.decoder.input.readableSlice(0);

                    defer {
                        this.decoder.freelist.append(pending);
                    }

                    var input_list = std.ArrayListUnmanaged(u8){};
                    defer input_list.deinit(bun.default_allocator);

                    if (pending.len > 1) {
                        var count: usize = 0;
                        for (pending) |input| {
                            count += input.slice().len;
                        }

                        input_list.ensureTotalCapacityPrecise(bun.default_allocator, count) catch bun.outOfMemory();

                        for (pending) |*input| {
                            input_list.appendSliceAssumeCapacity(input.slice());
                        }
                    }

                    {
                        this.decoder.output_lock.lock();
                        defer this.decoder.output_lock.unlock();

                        const input = if (pending.len <= 1) pending[0].slice() else input_list.items;
                        this.decoder.stream.input = input;
                        this.decoder.stream.readAll(false) catch {
                            any = true;
                            _ = this.decoder.pending_decode_job_count.fetchSub(1, .monotonic);
                            if (!this.is_async) {
                                this.decoder.closed = true;
                                this.decoder.globalThis.throw("BrotliError", .{});
                                return;
                            }
                            this.decoder.write_failure = JSC.DeferredError.from(.plainerror, .ERR_OPERATION_FAILED, "BrotliError", .{}); // TODO propogate better error
                            break;
                        };
                        if (this.decoder.output.items.len > this.decoder.maxOutputLength) {
                            any = true;
                            _ = this.decoder.pending_decode_job_count.fetchSub(1, .monotonic);
                            this.decoder.write_failure = JSC.DeferredError.from(.rangeerror, .ERR_BUFFER_TOO_LARGE, "Cannot create a Buffer larger than {d} bytes", .{this.decoder.maxOutputLength});
                            break;
                        }
                    }

                    any = any or pending.len > 0;

                    if (this.decoder.pending_decode_job_count.fetchSub(1, .monotonic) == 0)
                        break;
                }
            }

            if (this.is_async and any) {
                _ = this.decoder.has_pending_activity.fetchAdd(1, .monotonic);
                this.vm.enqueueTaskConcurrent(JSC.ConcurrentTask.create(JSC.Task.init(this.decoder)));
            }
        }
    };

    pub fn reset(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        return .undefined;
    }

    pub fn getBytesWritten(this: *@This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        _ = globalObject;
        return JSC.JSValue.jsNumber(this.stream.total_in);
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
};
