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

    globalObject: *JSC.JSGlobalObject,

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
    poll_ref: bun.Async.KeepAlive = bun.Async.KeepAlive{},

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
            .globalObject = globalThis,
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

    pub fn runFromJSThread(this: *BrotliEncoder) void {
        this.poll_ref.unref(this.globalObject.bunVM());

        defer {
            this.deref();
        }
        this.drainFreelist();

        const value = brk: {
            this.output_lock.lock();
            defer this.output_lock.unlock();

            if (this.output.items.len == 0)
                return;

            if (this.output.items.len > 16 * 1024) {
                defer this.output.items = &.{};
                break :brk JSC.JSValue.createBuffer(this.globalObject, this.output.items, bun.default_allocator);
            } else {
                defer this.output.clearRetainingCapacity();
                break :brk JSC.ArrayBuffer.createBuffer(this.globalObject, this.output.items);
            }
        };

        const result = this.callback_value.get().?.call(this.globalObject, &.{
            if (this.write_failed)
                this.globalObject.createErrorInstance("BrotliError", .{})
            else
                JSC.JSValue.null,
            value,
        });

        if (result.toError()) |err| {
            this.globalObject.bunVM().runErrorHandler(err, null);
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
                var vm = this.encoder.globalObject.bunVMConcurrently();
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

    pub fn encode(this: *BrotliEncoder, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        const arguments = callframe.arguments(3);

        if (arguments.len < 2) {
            globalObject.throwNotEnoughArguments("BrotliEncoder.encode", 2, arguments.len);
            return .zero;
        }

        if (this.has_called_end) {
            globalObject.throw("BrotliEncoder.encode called after BrotliEncoder.end", .{});
            return .zero;
        }

        const input = callframe.argument(0);
        const optional_encoding = callframe.argument(1);
        const is_last = callframe.argument(2).toBoolean();

        const input_to_queue = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueMaybeAsync(globalObject, bun.default_allocator, input, optional_encoding, true) orelse {
            globalObject.throwInvalidArgumentType("BrotliEncoder.encode", "input", "Blob, String, or Buffer");
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
    pub fn encodeSync(this: *BrotliEncoder, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalObject;
        _ = callframe;

        return .zero;
    }
    pub fn end(this: *BrotliEncoder, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalObject;
        _ = callframe;

        return .zero;
    }
    pub fn endSync(this: *BrotliEncoder, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalObject;
        _ = callframe;

        return .zero;
    }
};

pub const BrotliDecoder = struct {
    pub usingnamespace bun.NewRefCounted(@This(), deinit);
    pub usingnamespace JSC.Codegen.JSBrotliDecoder;

    has_pending_activity: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    ref_count: u32 = 1,

    pub fn hasPendingActivity(this: *BrotliDecoder) callconv(.C) bool {
        return this.has_pending_activity.load(.Monotonic) > 0;
    }

    pub fn deinit(this: *BrotliDecoder) void {
        this.destroy();
    }

    pub fn constructor(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) ?*BrotliDecoder {
        globalThis.throw("Crypto is not constructable", .{});
        return null;
    }

    pub fn finalize(this: *BrotliDecoder) callconv(.C) void {
        this.destroy();
    }

    pub fn decode(this: *BrotliDecoder, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalObject;
        _ = callframe;

        return .zero;
    }
    pub fn decodeSync(this: *BrotliDecoder, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalObject;
        _ = callframe;

        return .zero;
    }
    pub fn end(this: *BrotliDecoder, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalObject;
        _ = callframe;

        return .zero;
    }
    pub fn endSync(this: *BrotliDecoder, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = this;
        _ = globalObject;
        _ = callframe;

        return .zero;
    }
};

pub fn exportAll() void {
    @export(BrotliEncoder.create, .{ .name = "BrotliEncoder__createFromJS" });
}
