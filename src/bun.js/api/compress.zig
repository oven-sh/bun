const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const Queue = std.fifo.LinearFifo(JSC.Node.BlobOrStringOrBuffer, .Dynamic);
const brotli = bun.brotli;
const zlib = bun.zlib;

const Z_NO_FLUSH = 0;
const Z_FINISH = 4;

pub fn StreamingCodec(comptime JSEncoder: type, comptime T: type) type {
    return struct {
        globalThis: *JSC.JSGlobalObject,
        stream: T,
        maxOutputLength: usize,

        freelist: Queue = Queue.init(bun.default_allocator),
        freelist_write_lock: bun.Lock = bun.Lock.init(),

        input: Queue = Queue.init(bun.default_allocator),
        input_lock: bun.Lock = bun.Lock.init(),

        has_called_end: bool = false,
        callback_value: JSC.Strong = .{},

        output: std.ArrayListUnmanaged(u8) = .{},
        output_lock: bun.Lock = bun.Lock.init(),

        has_pending_activity: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
        pending_encode_job_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
        ref_count: u32 = 1,
        write_failure: ?JSC.DeferredError = null,
        poll_ref: bun.Async.KeepAlive = .{},

        pub usingnamespace JSEncoder;
        pub usingnamespace bun.New(@This());

        pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) ?*@This() {
            _ = callframe;
            globalThis.throw("DeflateEncoder is not constructable", .{});
            return null;
        }

        pub fn create(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            const arguments = callframe.arguments(3).slice();

            if (arguments.len < 3) {
                globalThis.throwNotEnoughArguments("DeflateEncoder", 3, arguments.len);
                return .zero;
            }

            var this: *@This() = @This().new(.{
                .globalThis = globalThis,
                .maxOutputLength = undefined,
                .stream = undefined,
            });

            if (!T.create(&this.stream, &this.output, &this.maxOutputLength, globalThis, arguments)) {
                this.destroy();
                return .zero;
            }

            const out = this.toJS(globalThis);
            @This().callbackSetCached(out, globalThis, arguments[2]);
            this.callback_value.set(globalThis, arguments[2]);

            return out;
        }

        pub fn finalize(this: *@This()) callconv(.C) void {
            this.deinit();
        }

        pub fn deinit(this: *@This()) void {
            this.input.deinit();
            this.callback_value.deinit();
            this.destroy();
        }

        pub fn writeSync(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            const arguments = callframe.arguments(3);

            if (arguments.len < 2) {
                globalThis.throwNotEnoughArguments("DeflateEncoder.encode", 2, arguments.len);
                return .zero;
            }

            if (this.has_called_end) {
                globalThis.throw("DeflateEncoder.encodeSync called after DeflateEncoder.end", .{});
                return .zero;
            }

            const input = callframe.argument(0);
            const optional_encoding = callframe.argument(1);
            const is_last = callframe.argument(2).toBoolean();

            const input_to_queue = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueMaybeAsync(globalThis, bun.default_allocator, input, optional_encoding, true) orelse {
                globalThis.throwInvalidArgumentType("DeflateEncoder.encode", "input", "Blob, String, or Buffer");
                return .zero;
            };

            _ = this.has_pending_activity.fetchAdd(1, .monotonic);
            if (is_last)
                this.has_called_end = true;

            var task: EncodeJob = .{
                .codec = this,
                .is_async = false,
            };

            {
                this.input_lock.lock();
                defer this.input_lock.unlock();

                this.input.writeItem(input_to_queue) catch unreachable;
            }
            task.run();
            if (!is_last) {
                return .undefined;
            }
            if (this.write_failure) |*err| {
                globalThis.vm().throwError(globalThis, err.toJS(globalThis));
                return .zero;
            }
            return this.collectOutputValue();
        }

        pub fn write(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            const arguments = callframe.arguments(3);

            if (arguments.len < 2) {
                globalThis.throwNotEnoughArguments("DeflateEncoder.encode", 2, arguments.len);
                return .zero;
            }

            if (this.has_called_end) {
                globalThis.throw("DeflateEncoder.encode called after DeflateEncoder.end", .{});
                return .zero;
            }

            const input = callframe.argument(0);
            const optional_encoding = callframe.argument(1);
            const is_last = callframe.argument(2).toBoolean();

            const input_to_queue = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueMaybeAsync(globalThis, bun.default_allocator, input, optional_encoding, true) orelse {
                globalThis.throwInvalidArgumentType("DeflateEncoder.encode", "input", "Blob, String, or Buffer");
                return .zero;
            };

            _ = this.has_pending_activity.fetchAdd(1, .monotonic);
            if (is_last)
                this.has_called_end = true;

            var task = EncodeJob.new(.{
                .codec = this,
                .is_async = true,
            });

            {
                this.input_lock.lock();
                defer this.input_lock.unlock();

                this.input.writeItem(input_to_queue) catch unreachable;
            }
            JSC.WorkPool.schedule(&task.task);

            return .undefined;
        }

        pub fn runFromJSThread(this: *@This()) void {
            this.poll_ref.unref(this.globalThis.bunVM());

            defer _ = this.has_pending_activity.fetchSub(1, .monotonic);
            this.drainFreelist();

            const result = this.callback_value.get().?.call(
                this.globalThis,
                if (this.write_failure) |*err|
                    &.{err.toJS(this.globalThis)}
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

        fn drainFreelist(this: *@This()) void {
            this.freelist_write_lock.lock();
            defer this.freelist_write_lock.unlock();
            const to_free = this.freelist.readableSlice(0);
            for (to_free) |*input| {
                input.deinit();
            }
            this.freelist.discard(to_free.len);
        }

        fn collectOutputValue(this: *@This()) JSC.JSValue {
            this.output_lock.lock();
            defer this.output_lock.unlock();

            defer this.output.clearRetainingCapacity();
            return JSC.ArrayBuffer.createBuffer(this.globalThis, this.output.items);
        }

        const Codec = @This();

        const EncodeJob = struct {
            task: JSC.WorkPoolTask = .{ .callback = &runTask },
            codec: *Codec,
            is_async: bool,

            pub usingnamespace bun.New(@This());

            pub fn runTask(this: *JSC.WorkPoolTask) void {
                var job: *EncodeJob = @fieldParentPtr("task", this);
                job.run();
                job.destroy();
            }

            pub fn run(this: *EncodeJob) void {
                var codec = this.codec;
                defer {
                    _ = codec.has_pending_activity.fetchSub(1, .monotonic);
                }

                var any = false;

                if (codec.pending_encode_job_count.fetchAdd(1, .monotonic) >= 0) {
                    const is_last = codec.has_called_end;
                    outer: while (true) {
                        codec.input_lock.lock();
                        defer codec.input_lock.unlock();
                        const readable = codec.input.readableSlice(0);
                        defer codec.input.discard(readable.len);
                        const pending = readable;

                        defer {
                            codec.freelist_write_lock.lock();
                            codec.freelist.write(pending) catch unreachable;
                            codec.freelist_write_lock.unlock();
                        }
                        for (pending) |input| {
                            const output = &codec.output;
                            codec.output_lock.lock();
                            defer codec.output_lock.unlock();

                            codec.stream.writeAll(
                                output,
                                input.slice(),
                            ) catch {
                                any = true;
                                _ = codec.pending_encode_job_count.fetchSub(1, .monotonic);
                                codec.write_failure = JSC.DeferredError.from(.Error, .ERR_OPERATION_FAILED, "DeflateError", .{}); // TODO propogate better error
                                break :outer;
                            };
                            if (codec.output.items.len > codec.maxOutputLength) {
                                any = true;
                                _ = codec.pending_encode_job_count.fetchSub(1, .monotonic);
                                codec.write_failure = JSC.DeferredError.from(.RangeError, .ERR_BUFFER_TOO_LARGE, "Cannot create a Buffer larger than {d} bytes", .{codec.maxOutputLength});
                                break :outer;
                            }
                        }

                        any = any or pending.len > 0;

                        if (codec.pending_encode_job_count.fetchSub(1, .monotonic) == 0)
                            break;
                    }

                    if (is_last and any) {
                        const output = &codec.output;
                        codec.output_lock.lock();
                        defer codec.output_lock.unlock();

                        codec.stream.end(output) catch {
                            _ = codec.pending_encode_job_count.fetchSub(1, .monotonic);
                            codec.write_failure = JSC.DeferredError.from(.Error, .ERR_OPERATION_FAILED, "DeflateError", .{}); // TODO propogate better error
                            return;
                        };
                        if (codec.output.items.len > codec.maxOutputLength) {
                            _ = codec.pending_encode_job_count.fetchSub(1, .monotonic);
                            codec.write_failure = JSC.DeferredError.from(.RangeError, .ERR_BUFFER_TOO_LARGE, "Cannot create a Buffer larger than {d} bytes", .{codec.maxOutputLength});
                            return;
                        }
                    }
                }

                if (this.is_async and any) {
                    var vm = codec.globalThis.bunVMConcurrently();
                    _ = codec.has_pending_activity.fetchAdd(1, .monotonic);
                    codec.poll_ref.refConcurrently(vm);
                    vm.enqueueTaskConcurrent(JSC.ConcurrentTask.create(JSC.Task.init(codec)));
                }
            }
        };

        pub fn reset(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            _ = globalThis;
            _ = callframe;
            this.stream.reset();
            return .undefined;
        }

        pub fn getBytesWritten(this: *@This(), globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
            _ = globalObject;
            return JSC.JSValue.jsNumber(@as(u64, this.stream.getBytesWritten()));
        }
    };
}

pub const DeflateEncoder = StreamingCodec(JSC.Codegen.JSDeflateEncoder, DeflateEncoderImpl);

pub const DeflateEncoderImpl = struct {
    impl: bun.zlib.ZlibCompressorStreaming,

    const Stream = @This();

    pub fn create(this: *Stream, output: *std.ArrayListUnmanaged(u8), maxOutputLength: *usize, globalThis: *JSC.JSGlobalObject, arguments: []const JSC.JSValue) bool {
        _ = output; // autofix
        const opts = arguments[0];

        _ = globalThis.checkMinOrGetDefault(opts, "chunkSize", u32, 64, 1024 * 14) orelse return false;
        const level = globalThis.checkRangesOrGetDefault(opts, "level", u8, 0, 9, 6) orelse return false;
        const windowBits = globalThis.checkRangesOrGetDefault(opts, "windowBits", u8, 8, 15, 15) orelse return false;
        const memLevel = globalThis.checkRangesOrGetDefault(opts, "memLevel", u8, 1, 9, 8) orelse return false;
        const strategy = globalThis.checkRangesOrGetDefault(opts, "strategy", u8, 0, 4, 0) orelse return false;
        maxOutputLength.* = globalThis.checkMinOrGetDefaultU64(opts, "maxOutputLength", usize, 0, std.math.maxInt(u52)) orelse return false;
        const flush = globalThis.checkRangesOrGetDefault(opts, "flush", u8, 0, 6, 0) orelse return false;
        const finishFlush = globalThis.checkRangesOrGetDefault(opts, "finishFlush", u8, 0, 6, 4) orelse return false;

        this.impl = .{
            .flush = @enumFromInt(flush),
            .finishFlush = @enumFromInt(finishFlush),
        };

        this.impl.init(level, windowBits, memLevel, strategy) catch {
            globalThis.throw("Failed to create DeflateEncoder", .{});
            return false;
        };

        return true;
    }

    pub fn deinit(this: *Stream) void {
        _ = this; // autofix
    }

    pub fn getBytesWritten(this: *const Stream) u64 {
        return this.impl.state.total_in;
    }

    pub fn reset(this: *Stream) void {
        this.impl.reset() catch {};
    }

    pub fn writeAll(this: *Stream, output: *std.ArrayListUnmanaged(u8), chunk: []const u8) !void {
        const out_writer = output.writer(bun.default_allocator);
        var writer = this.impl.writer(out_writer);
        try writer.writeAll(chunk);
    }

    pub fn end(this: *Stream, output: *std.ArrayListUnmanaged(u8)) !void {
        try this.impl.end(output);
    }
};

pub const DeflateDecoder = StreamingCodec(JSC.Codegen.JSDeflateDecoder, DeflateDecoderImpl);

pub const DeflateDecoderImpl = struct {
    stream: bun.zlib.ZlibDecompressorStreaming,

    const Stream = @This();

    pub fn create(this: *Stream, output: *std.ArrayListUnmanaged(u8), maxOutputLength: *usize, globalThis: *JSC.JSGlobalObject, arguments: []const JSC.JSValue) bool {
        _ = output; // autofix
        const opts = arguments[0];

        _ = globalThis.checkMinOrGetDefault(opts, "chunkSize", u32, 64, 1024 * 14) orelse return false;
        maxOutputLength.* = globalThis.checkMinOrGetDefaultU64(opts, "maxOutputLength", usize, 0, std.math.maxInt(u52)) orelse return false;
        const flush = globalThis.checkRangesOrGetDefault(opts, "flush", u8, 0, 6, 0) orelse return false;
        const finishFlush = globalThis.checkRangesOrGetDefault(opts, "finishFlush", u8, 0, 6, 4) orelse return false;

        this.stream = .{
            .flush = @enumFromInt(flush),
            .finishFlush = @enumFromInt(finishFlush),
        };
        this.stream.init() catch {
            globalThis.throw("Failed to create DeflateDecoder", .{});
            return false;
        };

        return true;
    }

    pub fn deinit(this: *Stream) void {
        _ = this; // autofix
    }

    pub fn getBytesWritten(this: *const Stream) u64 {
        return this.stream.state.total_in;
    }

    pub fn reset(this: *Stream) void {
        this.stream.reset() catch {};
    }

    pub fn writeAll(this: *Stream, output: *std.ArrayListUnmanaged(u8), chunk: []const u8) !void {
        const out_writer = output.writer(bun.default_allocator);
        var writer = this.stream.writer(out_writer);
        try writer.writeAll(chunk);
    }

    pub fn end(this: *Stream, output: *std.ArrayListUnmanaged(u8)) !void {
        try this.stream.end(output);
    }
};

pub const BrotliDecoder = StreamingCodec(JSC.Codegen.JSBrotliDecoder, BrotliDecoderImpl);

pub const BrotliDecoderImpl = struct {
    stream: brotli.BrotliReaderArrayList,

    const Stream = @This();

    pub fn create(this: *Stream, output: *std.ArrayListUnmanaged(u8), maxOutputLength: *usize, globalThis: *JSC.JSGlobalObject, arguments: []const JSC.JSValue) bool {
        const opts = arguments[0];

        _ = globalThis.checkMinOrGetDefault(opts, "chunkSize", u32, 64, 1024 * 14) orelse return false;
        maxOutputLength.* = globalThis.checkMinOrGetDefaultU64(opts, "maxOutputLength", usize, 0, std.math.maxInt(u52)) orelse return false;

        this.stream = brotli.BrotliReaderArrayList.initWithOptions("", output, bun.default_allocator, .{}) catch {
            globalThis.throw("Failed to create BrotliDecoder", .{});
            return false;
        };

        if (opts.get(globalThis, "params")) |params| {
            inline for (std.meta.fields(bun.brotli.c.BrotliDecoderParameter)) |f| {
                const idx = params.getIndex(globalThis, f.value);
                if (!idx.isNumber()) break;
                const was_set = this.stream.brotli.setParameter(@enumFromInt(f.value), idx.toU32());
                if (!was_set) {
                    globalThis.throwValue(globalThis.createErrorInstanceWithCode(.ERR_ZLIB_INITIALIZATION_FAILED, "Initialization failed", .{}));
                    this.deinit();
                    return false;
                }
            }
        }

        return true;
    }

    pub fn deinit(this: *Stream) void {
        this.stream.deinit();
    }

    pub fn getBytesWritten(this: *const Stream) u64 {
        return this.stream.total_in;
    }

    pub fn reset(this: *Stream) void {
        _ = this; // autofix
    }

    pub fn writeAll(this: *Stream, output: *std.ArrayListUnmanaged(u8), chunk: []const u8) !void {
        _ = output; // autofix
        this.stream.input = chunk;
        this.stream.total_in = 0;
        try this.stream.readAll(false);
    }

    pub fn end(this: *Stream, output: *std.ArrayListUnmanaged(u8)) !void {
        _ = this; // autofix
        _ = output; // autofix
    }
};

pub const BrotliEncoder = StreamingCodec(JSC.Codegen.JSBrotliEncoder, BrotliEncoderImpl);

pub const BrotliEncoderImpl = struct {
    stream: brotli.BrotliCompressionStream,

    const Stream = @This();

    pub fn create(this: *Stream, output: *std.ArrayListUnmanaged(u8), maxOutputLength: *usize, globalThis: *JSC.JSGlobalObject, arguments: []const JSC.JSValue) bool {
        _ = output; // autofix
        const opts = arguments[0];

        _ = globalThis.checkMinOrGetDefault(opts, "chunkSize", u32, 64, 1024 * 14) orelse return false;
        maxOutputLength.* = globalThis.checkMinOrGetDefaultU64(opts, "maxOutputLength", usize, 0, std.math.maxInt(u52)) orelse return false;

        this.stream = brotli.BrotliCompressionStream.init() catch {
            globalThis.throw("Failed to create BrotliEncoder", .{});
            return false;
        };

        if (opts.get(globalThis, "params")) |params| {
            inline for (std.meta.fields(bun.brotli.c.BrotliEncoderParameter)) |f| {
                if (params.hasOwnPropertyValue(globalThis, JSC.ZigString.static(std.fmt.comptimePrint("{d}", .{f.value})).toValue(globalThis))) {
                    const idx = params.getIndex(globalThis, f.value);
                    if (!idx.isNumber()) {
                        var typestring = idx.jsTypeString(globalThis).toSlice(globalThis, bun.default_allocator);
                        defer typestring.deinit();
                        globalThis.vm().throwError(globalThis, globalThis.createTypeErrorInstanceWithCode(.ERR_INVALID_ARG_TYPE, "The \"options.params[key]\" property must be of type number. Received type {s}", .{typestring.slice()}));
                        return false;
                    }
                    const was_set = this.stream.brotli.setParameter(@enumFromInt(f.value), idx.toU32());
                    if (!was_set) {
                        globalThis.throwValue(globalThis.createErrorInstanceWithCode(.ERR_ZLIB_INITIALIZATION_FAILED, "Initialization failed", .{}));
                        this.deinit();
                        return false;
                    }
                }
            }
        }

        return true;
    }

    pub fn deinit(this: *Stream) void {
        this.stream.deinit();
    }

    pub fn getBytesWritten(this: *const Stream) u64 {
        return this.stream.total_in;
    }

    pub fn reset(this: *Stream) void {
        _ = this; // autofix
    }

    pub fn writeAll(this: *Stream, output: *std.ArrayListUnmanaged(u8), chunk: []const u8) !void {
        try output.appendSlice(bun.default_allocator, try this.stream.writeChunk(chunk, false));
    }

    pub fn end(this: *Stream, output: *std.ArrayListUnmanaged(u8)) !void {
        try output.appendSlice(bun.default_allocator, try this.stream.end());
    }
};
