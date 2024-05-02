const bun = @import("root").bun;
const JSC = bun.JSC;
const std = @import("std");
const brotli = bun.brotli;

const Queue = std.fifo.LinearFifo(JSC.Node.BlobOrStringOrBuffer, .Dynamic);

fn ConcurrentByteProcessor(comptime Processor: type) type {
    _ = Processor; // autofix
    return struct {};
}

pub const BrotliEncoder = struct {
    pub usingnamespace bun.NewRefCounted(@This(), deinit);
    pub usingnamespace JSC.Codegen.JSBrotliEncoder;

    stream: brotli.BrotliCompressionStream,

    freelist: Queue = Queue.init(bun.default_allocator),
    freelist_write_lock: bun.Lock = bun.Lock.init(),

    globalThis: *JSC.JSGlobalObject,

    input: Queue = Queue.init(bun.default_allocator),
    input_lock: bun.Lock = bun.Lock.init(),

    has_called_end: bool = false,
    callback_value: JSC.Strong = .{},

    output: std.ArrayListUnmanaged(u8) = .{},
    output_lock: bun.Lock = bun.Lock.init(),

    has_pending_activity: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    pending_encode_job_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    ref_count: u32 = 1,
    write_failed: bool = false,
    poll_ref: bun.Async.KeepAlive = .{},

    pub fn hasPendingActivity(this: *BrotliEncoder) callconv(.C) bool {
        return this.has_pending_activity.load(.Monotonic) > 0;
    }

    pub fn constructor(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) ?*BrotliEncoder {
        globalThis.throw("BrotliEncoder is not constructable", .{});
        return null;
    }

    pub fn create(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(3).slice();

        if (arguments.len < 3) {
            globalThis.throwNotEnoughArguments("BrotliEncoder", 3, arguments.len);
            return .zero;
        }

        const callback = arguments[2];

        if (!callback.isCallable(globalThis.vm())) {
            globalThis.throwInvalidArguments("BrotliEncoder callback is not callable", .{});
            return .zero;
        }

        var this: *BrotliEncoder = BrotliEncoder.new(.{
            .globalThis = globalThis,
            .stream = brotli.BrotliCompressionStream.init() catch {
                globalThis.throw("Failed to create BrotliEncoder", .{});
                return .zero;
            },
        });

        const out = this.toJS(globalThis);
        @This().callbackSetCached(out, globalThis, callback);
        this.callback_value.set(globalThis, callback);

        return out;
    }

    pub fn finalize(this: *BrotliEncoder) callconv(.C) void {
        this.deref();
    }

    pub fn deinit(this: *BrotliEncoder) void {
        this.callback_value.deinit();
        this.drainFreelist();
        this.output.deinit(bun.default_allocator);
        this.stream.deinit();
        this.input.deinit();
    }

    fn drainFreelist(this: *BrotliEncoder) void {
        this.freelist_write_lock.lock();
        defer this.freelist_write_lock.unlock();
        const to_free = this.freelist.readableSlice(0);
        for (to_free) |*input| {
            input.deinit();
        }
        this.freelist.discard(to_free.len);
    }

    fn collectOutputValue(this: *BrotliEncoder) ?JSC.JSValue {
        this.output_lock.lock();
        defer this.output_lock.unlock();

        if (this.output.items.len == 0)
            return null;

        if (this.output.items.len > 16 * 1024) {
            defer this.output.clearRetainingCapacity();
            return JSC.JSValue.createBuffer(this.globalThis, this.output.items, bun.default_allocator);
        } else {
            defer this.output.clearRetainingCapacity();
            return JSC.ArrayBuffer.createBuffer(this.globalThis, this.output.items);
        }
    }

    pub fn runFromJSThread(this: *BrotliEncoder) void {
        this.poll_ref.unref(this.globalThis.bunVM());

        defer this.deref();
        this.drainFreelist();

        const result = this.callback_value.get().?.call(this.globalThis, &.{
            if (this.write_failed)
                this.globalThis.createErrorInstance("BrotliError", .{})
            else
                JSC.JSValue.null,
            this.collectOutputValue() orelse return,
        });

        if (result.toError()) |err| {
            this.globalThis.bunVM().runErrorHandler(err, null);
        }
    }

    // We can only run one encode job at a time
    // But we don't have an idea of a serial dispatch queue
    // So instead, we let you enqueue as many times as you want
    // and if one is already running, we just don't do anything
    const EncodeJob = struct {
        task: JSC.WorkPoolTask = .{ .callback = &runTask },
        encoder: *BrotliEncoder,

        pub usingnamespace bun.New(@This());

        pub fn run(this: *EncodeJob) void {
            defer {
                _ = this.encoder.has_pending_activity.fetchSub(1, .Monotonic);
                this.encoder.deref();
                this.destroy();
            }

            var any = false;

            if (this.encoder.pending_encode_job_count.fetchAdd(1, .Monotonic) == 0) {
                var is_last = false;
                while (true) {
                    const pending: []bun.JSC.Node.BlobOrStringOrBuffer = brk: {
                        this.encoder.input_lock.lock();
                        defer this.encoder.input_lock.unlock();
                        is_last = this.encoder.has_called_end;
                        const readable = this.encoder.input.readableSlice(0);
                        const out = bun.default_allocator.dupe(std.meta.Child(@TypeOf(readable)), readable) catch bun.outOfMemory();
                        this.encoder.input.discard(readable.len);
                        break :brk out;
                    };
                    defer bun.default_allocator.free(pending);
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
                        this.encoder.freelist_write_lock.lock();
                        this.encoder.freelist.write(pending) catch unreachable;
                        this.encoder.freelist_write_lock.unlock();
                    }
                    for (pending) |input| {
                        var writer = this.encoder.stream.writer(Writer{ .encoder = this.encoder });
                        writer.writeAll(input.slice()) catch {
                            _ = this.encoder.pending_encode_job_count.fetchSub(1, .Monotonic);
                            this.encoder.write_failed = true;
                            return;
                        };
                    }

                    any = any or pending.len > 0;

                    if (this.encoder.pending_encode_job_count.fetchSub(1, .Monotonic) == 0)
                        break;
                }

                if (is_last and any) {
                    var output = &this.encoder.output;
                    this.encoder.output_lock.lock();
                    defer {
                        this.encoder.output_lock.unlock();
                    }

                    output.appendSlice(bun.default_allocator, this.encoder.stream.end() catch {
                        _ = this.encoder.pending_encode_job_count.fetchSub(1, .Monotonic);
                        this.encoder.write_failed = true;
                        return;
                    }) catch {
                        _ = this.encoder.pending_encode_job_count.fetchSub(1, .Monotonic);
                        this.encoder.write_failed = true;
                        return;
                    };
                }
            }

            if (any) {
                var vm = this.encoder.globalThis.bunVMConcurrently();
                this.encoder.ref();
                this.encoder.poll_ref.refConcurrently(vm);
                vm.enqueueTaskConcurrent(JSC.ConcurrentTask.create(JSC.Task.init(this.encoder)));
            }
        }

        pub fn runTask(this: *JSC.WorkPoolTask) void {
            var job: *EncodeJob = @fieldParentPtr(EncodeJob, "task", this);
            job.run();
        }
    };

    pub fn encode(this: *BrotliEncoder, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(3);

        if (arguments.len < 2) {
            globalThis.throwNotEnoughArguments("BrotliEncoder.encode", 2, arguments.len);
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

        _ = this.has_pending_activity.fetchAdd(1, .Monotonic);
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
        this.ref();
        JSC.WorkPool.schedule(&task.task);

        return .undefined;
    }

    pub fn encodeSync(this: *BrotliEncoder, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;

        return .zero;
    }

    pub fn end(this: *BrotliEncoder, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;

        return .zero;
    }

    pub fn endSync(this: *BrotliEncoder, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;

        return .zero;
    }
};

pub const BrotliDecoder = struct {
    pub usingnamespace bun.NewRefCounted(@This(), deinit);
    pub usingnamespace JSC.Codegen.JSBrotliDecoder;

    globalThis: *JSC.JSGlobalObject,
    stream: brotli.BrotliReaderArrayList,

    has_pending_activity: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    ref_count: u32 = 1,
    poll_ref: bun.Async.KeepAlive = .{},
    write_failed: bool = false,
    callback_value: JSC.Strong = .{},
    has_called_end: bool = false,
    pending_decode_job_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

    input: Queue = Queue.init(bun.default_allocator),
    input_lock: bun.Lock = bun.Lock.init(),

    output: std.ArrayListUnmanaged(u8) = .{},
    output_lock: bun.Lock = bun.Lock.init(),

    freelist: Queue = Queue.init(bun.default_allocator),
    freelist_write_lock: bun.Lock = bun.Lock.init(),

    pub fn hasPendingActivity(this: *BrotliDecoder) callconv(.C) bool {
        return this.has_pending_activity.load(.Monotonic) > 0;
    }

    pub fn deinit(this: *BrotliDecoder) void {
        this.callback_value.deinit();
        this.drainFreelist();
        this.output.deinit(bun.default_allocator);
        this.stream.brotli.destroyInstance();
        this.input.deinit();
    }

    pub fn constructor(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) ?*BrotliDecoder {
        globalThis.throw("Crypto is not constructable", .{});
        return null;
    }

    pub fn create(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(3).slice();

        if (arguments.len < 3) {
            globalThis.throwNotEnoughArguments("BrotliDecoder", 3, arguments.len);
            return .zero;
        }

        const callback = arguments[2];

        if (!callback.isCallable(globalThis.vm())) {
            globalThis.throwInvalidArguments("BrotliDecoder callback is not callable", .{});
            return .zero;
        }

        var this: *BrotliDecoder = BrotliDecoder.new(.{
            .globalThis = globalThis,
            .stream = undefined, // &this.output needs to be a stable pointer
        });
        this.stream = brotli.BrotliReaderArrayList.initWithOptions("", &this.output, bun.default_allocator, .{}) catch {
            globalThis.throw("Failed to create BrotliDecoder", .{});
            return .zero;
        };

        const out = this.toJS(globalThis);
        @This().callbackSetCached(out, globalThis, callback);
        this.callback_value.set(globalThis, callback);

        return out;
    }

    pub fn finalize(this: *BrotliDecoder) callconv(.C) void {
        this.deref();
    }

    fn collectOutputValue(this: *BrotliDecoder) ?JSC.JSValue {
        this.output_lock.lock();
        defer this.output_lock.unlock();

        if (this.output.items.len == 0)
            return null;

        if (this.output.items.len > 16 * 1024) {
            defer this.output.clearRetainingCapacity();
            return JSC.JSValue.createBuffer(this.globalThis, this.output.items, bun.default_allocator);
        } else {
            defer this.output.clearRetainingCapacity();
            return JSC.ArrayBuffer.createBuffer(this.globalThis, this.output.items);
        }
    }

    pub fn runFromJSThread(this: *BrotliDecoder) void {
        this.poll_ref.unref(this.globalThis.bunVM());

        defer this.deref();
        this.drainFreelist();

        const result = this.callback_value.get().?.call(this.globalThis, &.{
            if (this.write_failed)
                this.globalThis.createErrorInstance("BrotliError", .{})
            else
                JSC.JSValue.null,
            this.collectOutputValue() orelse return,
        });

        if (result.toError()) |err| {
            this.globalThis.bunVM().runErrorHandler(err, null);
        }
    }

    fn drainFreelist(this: *BrotliDecoder) void {
        this.freelist_write_lock.lock();
        defer this.freelist_write_lock.unlock();
        const to_free = this.freelist.readableSlice(0);
        for (to_free) |*input| {
            input.deinit();
        }
        this.freelist.discard(to_free.len);
    }

    pub fn decode(this: *BrotliDecoder, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(3);

        if (arguments.len < 2) {
            globalThis.throwNotEnoughArguments("BrotliEncoder.decode", 2, arguments.len);
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

        _ = this.has_pending_activity.fetchAdd(1, .Monotonic);
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
        this.ref();
        JSC.WorkPool.schedule(&task.task);

        return .undefined;
    }

    pub fn decodeSync(this: *BrotliDecoder, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;

        return .zero;
    }

    // We can only run one decode job at a time
    // But we don't have an idea of a serial dispatch queue
    // So instead, we let you enqueue as many times as you want
    // and if one is already running, we just don't do anything
    const DecodeJob = struct {
        task: JSC.WorkPoolTask = .{ .callback = &runTask },
        decoder: *BrotliDecoder,

        pub usingnamespace bun.New(@This());

        pub fn runTask(this: *JSC.WorkPoolTask) void {
            var job: *DecodeJob = @fieldParentPtr(DecodeJob, "task", this);
            job.run();
        }

        pub fn run(this: *DecodeJob) void {
            defer {
                _ = this.decoder.has_pending_activity.fetchSub(1, .Monotonic);
                this.decoder.deref();
                this.destroy();
            }

            var any = false;

            if (this.decoder.pending_decode_job_count.fetchAdd(1, .Monotonic) == 0) {
                var is_last = false;
                while (true) {
                    const pending: []bun.JSC.Node.BlobOrStringOrBuffer = brk: {
                        this.decoder.input_lock.lock();
                        defer this.decoder.input_lock.unlock();
                        is_last = this.decoder.has_called_end;
                        const readable = this.decoder.input.readableSlice(0);
                        const out = bun.default_allocator.dupe(std.meta.Child(@TypeOf(readable)), readable) catch bun.outOfMemory();
                        this.decoder.input.discard(readable.len);
                        break :brk out;
                    };
                    defer bun.default_allocator.free(pending);

                    defer {
                        this.decoder.freelist_write_lock.lock();
                        this.decoder.freelist.write(pending) catch unreachable;
                        this.decoder.freelist_write_lock.unlock();
                    }
                    for (pending) |input| {
                        this.decoder.output_lock.lock();
                        defer this.decoder.output_lock.unlock();

                        this.decoder.stream.input = input.slice();
                        this.decoder.stream.readAll(false) catch {
                            _ = this.decoder.pending_decode_job_count.fetchSub(1, .Monotonic);
                            this.decoder.write_failed = true;
                            return;
                        };
                    }

                    any = any or pending.len > 0;

                    if (this.decoder.pending_decode_job_count.fetchSub(1, .Monotonic) == 0)
                        break;
                }
            }

            if (any) {
                var vm = this.decoder.globalThis.bunVMConcurrently();
                this.decoder.ref();
                this.decoder.poll_ref.refConcurrently(vm);
                vm.enqueueTaskConcurrent(JSC.ConcurrentTask.create(JSC.Task.init(this.decoder)));
            }
        }
    };

    pub fn end(this: *BrotliDecoder, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;

        return .zero;
    }

    pub fn endSync(this: *BrotliDecoder, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;

        return .zero;
    }
};
