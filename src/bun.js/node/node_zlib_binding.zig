const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const validators = @import("./util/validators.zig");
const debug = bun.Output.scoped(.zlib, true);

pub fn crc32(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(2).ptr;

    const data: ZigString.Slice = blk: {
        const data: JSC.JSValue = arguments[0];

        if (data == .zero) {
            return globalThis.throwInvalidArgumentTypeValue("data", "string or an instance of Buffer, TypedArray, or DataView", .undefined);
        }
        if (data.isString()) {
            break :blk data.asString().toSlice(globalThis, bun.default_allocator);
        }
        const buffer: JSC.Buffer = JSC.Buffer.fromJS(globalThis, data) orelse {
            const ty_str = data.jsTypeString(globalThis).toSlice(globalThis, bun.default_allocator);
            defer ty_str.deinit();
            return globalThis.ERR_INVALID_ARG_TYPE("The \"data\" property must be an instance of Buffer, TypedArray, DataView, or ArrayBuffer. Received {s}", .{ty_str.slice()}).throw();
        };
        break :blk ZigString.Slice.fromUTF8NeverFree(buffer.slice());
    };
    defer data.deinit();

    const value: u32 = blk: {
        const value: JSC.JSValue = arguments[1];
        if (value == .zero) {
            break :blk 0;
        }
        if (!value.isNumber()) {
            return globalThis.throwInvalidArgumentTypeValue("value", "number", value);
        }
        const valuef = value.asNumber();
        const min = 0;
        const max = std.math.maxInt(u32);

        if (@floor(valuef) != valuef) {
            return globalThis.ERR_OUT_OF_RANGE("The value of \"{s}\" is out of range. It must be an integer. Received {}", .{ "value", valuef }).throw();
        }
        if (valuef < min or valuef > max) {
            return globalThis.ERR_OUT_OF_RANGE("The value of \"{s}\" is out of range. It must be >= {d} and <= {d}. Received {d}", .{ "value", min, max, valuef }).throw();
        }
        break :blk @intFromFloat(valuef);
    };

    // crc32 returns a u64 but the data will always be within a u32 range so the outer @intCast is always safe.
    const slice_u8 = data.slice();
    return JSC.JSValue.jsNumber(@as(u32, @intCast(bun.zlib.crc32(value, slice_u8.ptr, @intCast(slice_u8.len)))));
}

pub fn CompressionStream(comptime T: type) type {
    return struct {
        pub fn write(this: *T, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments = callframe.argumentsUndef(7).slice();

            if (arguments.len != 7) {
                return globalThis.ERR_MISSING_ARGS("write(flush, in, in_off, in_len, out, out_off, out_len)", .{}).throw();
            }

            var in_off: u32 = 0;
            var in_len: u32 = 0;
            var out_off: u32 = 0;
            var out_len: u32 = 0;
            var flush: u32 = 0;
            var in: ?[]const u8 = null;
            var out: ?[]u8 = null;

            const this_value = callframe.this();

            bun.assert(!arguments[0].isUndefined()); // must provide flush value
            flush = arguments[0].toU32();
            _ = std.meta.intToEnum(bun.zlib.FlushValue, flush) catch bun.assert(false); // Invalid flush value

            if (arguments[1].isNull()) {
                // just a flush
                in = null;
                in_len = 0;
                in_off = 0;
            } else {
                const in_buf = arguments[1].asArrayBuffer(globalThis).?;
                in_off = arguments[2].toU32();
                in_len = arguments[3].toU32();
                bun.assert(in_buf.byte_len >= in_off + in_len);
                in = in_buf.byteSlice()[in_off..][0..in_len];
            }

            const out_buf = arguments[4].asArrayBuffer(globalThis).?;
            out_off = arguments[5].toU32();
            out_len = arguments[6].toU32();
            bun.assert(out_buf.byte_len >= out_off + out_len);
            out = out_buf.byteSlice()[out_off..][0..out_len];

            bun.assert(!this.write_in_progress);
            bun.assert(!this.pending_close);
            this.write_in_progress = true;
            this.ref();

            this.stream.setBuffers(in, out);
            this.stream.setFlush(@intCast(flush));

            // Only create the strong handle when we have a pending write
            // And make sure to clear it when we are done.
            this.this_value.set(globalThis, this_value);

            const vm = globalThis.bunVM();
            this.task = .{ .callback = &AsyncJob.runTask };
            this.poll_ref.ref(vm);
            JSC.WorkPool.schedule(&this.task);

            return .undefined;
        }

        const AsyncJob = struct {
            pub fn runTask(task: *JSC.WorkPoolTask) void {
                const this: *T = @fieldParentPtr("task", task);
                AsyncJob.run(this);
            }

            pub fn run(this: *T) void {
                const globalThis: *JSC.JSGlobalObject = this.globalThis;
                const vm = globalThis.bunVMConcurrently();

                this.stream.doWork();

                vm.enqueueTaskConcurrent(JSC.ConcurrentTask.create(JSC.Task.init(this)));
            }
        };

        pub fn runFromJSThread(this: *T) void {
            const globalThis: *JSC.JSGlobalObject = this.globalThis;
            const vm = globalThis.bunVM();
            this.poll_ref.unref(vm);
            defer this.deref();

            this.write_in_progress = false;

            // Clear the strong handle before we call any callbacks.
            const this_value = this.this_value.trySwap() orelse {
                debug("this_value is null in runFromJSThread", .{});
                return;
            };

            this_value.ensureStillAlive();

            if (!(this.checkError(globalThis, this_value) catch return globalThis.reportActiveExceptionAsUnhandled(error.JSError))) {
                return;
            }

            this.stream.updateWriteResult(&this.write_result.?[1], &this.write_result.?[0]);
            this_value.ensureStillAlive();

            const write_callback: JSC.JSValue = T.writeCallbackGetCached(this_value).?;
            _ = write_callback.call(globalThis, this_value, &.{}) catch |err| globalThis.reportActiveExceptionAsUnhandled(err);

            if (this.pending_close) _ = this._close();
        }

        pub fn writeSync(this: *T, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const arguments = callframe.argumentsUndef(7).slice();

            if (arguments.len != 7) {
                return globalThis.ERR_MISSING_ARGS("writeSync(flush, in, in_off, in_len, out, out_off, out_len)", .{}).throw();
            }

            var in_off: u32 = 0;
            var in_len: u32 = 0;
            var out_off: u32 = 0;
            var out_len: u32 = 0;
            var flush: u32 = 0;
            var in: ?[]const u8 = null;
            var out: ?[]u8 = null;

            bun.assert(!arguments[0].isUndefined()); // must provide flush value
            flush = arguments[0].toU32();
            _ = std.meta.intToEnum(bun.zlib.FlushValue, flush) catch bun.assert(false); // Invalid flush value

            if (arguments[1].isNull()) {
                // just a flush
                in = null;
                in_len = 0;
                in_off = 0;
            } else {
                const in_buf = arguments[1].asArrayBuffer(globalThis).?;
                in_off = arguments[2].toU32();
                in_len = arguments[3].toU32();
                bun.assert(in_buf.byte_len >= in_off + in_len);
                in = in_buf.byteSlice()[in_off..][0..in_len];
            }

            const out_buf = arguments[4].asArrayBuffer(globalThis).?;
            out_off = arguments[5].toU32();
            out_len = arguments[6].toU32();
            bun.assert(out_buf.byte_len >= out_off + out_len);
            out = out_buf.byteSlice()[out_off..][0..out_len];

            bun.assert(!this.write_in_progress);
            bun.assert(!this.pending_close);
            this.write_in_progress = true;
            this.ref();

            this.stream.setBuffers(in, out);
            this.stream.setFlush(@intCast(flush));
            const this_value = callframe.this();

            this.stream.doWork();
            if (try this.checkError(globalThis, this_value)) {
                this.stream.updateWriteResult(&this.write_result.?[1], &this.write_result.?[0]);
                this.write_in_progress = false;
            }
            this.deref();

            return .undefined;
        }

        pub fn reset(this: *T, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            const err = this.stream.reset();
            if (err.isError()) {
                try this.emitError(globalThis, callframe.this(), err);
            }
            return .undefined;
        }

        pub fn close(this: *T, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
            _ = globalThis;
            _ = callframe;
            this._close();
            return .undefined;
        }

        fn _close(this: *T) void {
            if (this.write_in_progress) {
                this.pending_close = true;
                return;
            }
            this.pending_close = false;
            this.closed = true;
            this.this_value.deinit();
            this.stream.close();
        }

        pub fn setOnError(_: *T, this_value: JSC.JSValue, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) bool {
            if (value.isFunction()) {
                T.errorCallbackSetCached(this_value, globalObject, value);
            }
            return true;
        }

        pub fn getOnError(_: *T, this_value: JSC.JSValue, _: *JSC.JSGlobalObject) JSC.JSValue {
            return T.errorCallbackGetCached(this_value) orelse .undefined;
        }

        /// returns true if no error was detected/emitted
        fn checkError(this: *T, globalThis: *JSC.JSGlobalObject, this_value: JSC.JSValue) !bool {
            const err = this.stream.getErrorInfo();
            if (!err.isError()) return true;
            try this.emitError(globalThis, this_value, err);
            return false;
        }

        fn emitError(this: *T, globalThis: *JSC.JSGlobalObject, this_value: JSC.JSValue, err_: Error) !void {
            var msg_str = bun.String.createFormat("{s}", .{std.mem.sliceTo(err_.msg, 0) orelse ""}) catch bun.outOfMemory();
            const msg_value = msg_str.transferToJS(globalThis);
            const err_value = JSC.jsNumber(err_.err);
            var code_str = bun.String.createFormat("{s}", .{std.mem.sliceTo(err_.code, 0) orelse ""}) catch bun.outOfMemory();
            const code_value = code_str.transferToJS(globalThis);

            const callback: JSC.JSValue = T.errorCallbackGetCached(this_value) orelse Output.panic("Assertion failure: cachedErrorCallback is null in node:zlib binding", .{});
            _ = try callback.call(globalThis, this_value, &.{ msg_value, err_value, code_value });

            this.write_in_progress = false;
            if (this.pending_close) _ = this._close();
        }

        pub fn finalize(this: *T) void {
            this.deref();
        }
    };
}

pub const NativeZlib = JSC.Codegen.JSNativeZlib.getConstructor;

const CountedKeepAlive = struct {
    keep_alive: bun.Async.KeepAlive = .{},
    ref_count: u32 = 0,

    pub fn ref(this: *@This(), vm: *JSC.VirtualMachine) void {
        if (this.ref_count == 0) {
            this.keep_alive.ref(vm);
        }
        this.ref_count += 1;
    }

    pub fn unref(this: *@This(), vm: *JSC.VirtualMachine) void {
        this.ref_count -= 1;
        if (this.ref_count == 0) {
            this.keep_alive.unref(vm);
        }
    }

    pub fn deinit(this: *@This()) void {
        this.keep_alive.disable();
    }
};

pub const SNativeZlib = struct {
    pub usingnamespace bun.NewRefCounted(@This(), deinit);
    pub usingnamespace JSC.Codegen.JSNativeZlib;
    pub usingnamespace CompressionStream(@This());

    ref_count: u32 = 1,
    mode: bun.zlib.NodeMode,
    globalThis: *JSC.JSGlobalObject,
    stream: ZlibContext = .{},
    write_result: ?[*]u32 = null,
    poll_ref: CountedKeepAlive = .{},
    this_value: JSC.Strong = .{},
    write_in_progress: bool = false,
    pending_close: bool = false,
    closed: bool = false,
    task: JSC.WorkPoolTask = .{ .callback = undefined },

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!*@This() {
        const arguments = callframe.argumentsUndef(4).ptr;

        var mode = arguments[0];
        if (!mode.isNumber()) {
            return globalThis.throwInvalidArgumentTypeValue("mode", "number", mode);
        }
        const mode_double = mode.asNumber();
        if (@mod(mode_double, 1.0) != 0.0) {
            return globalThis.throwInvalidArgumentTypeValue("mode", "integer", mode);
        }
        const mode_int: i64 = @intFromFloat(mode_double);
        if (mode_int < 1 or mode_int > 7) {
            return globalThis.throwRangeError(mode_int, .{ .field_name = "mode", .min = 1, .max = 7 });
        }

        const ptr = SNativeZlib.new(.{
            .mode = @enumFromInt(mode_int),
            .globalThis = globalThis,
        });
        ptr.stream.mode = ptr.mode;
        return ptr;
    }

    //// adding this didnt help much but leaving it here to compare the number with later
    pub fn estimatedSize(_: *const SNativeZlib) usize {
        const internal_state_size = 3309; // @sizeOf(@cImport(@cInclude("deflate.h")).internal_state) @ cloudflare/zlib @ 92530568d2c128b4432467b76a3b54d93d6350bd
        return @sizeOf(SNativeZlib) + internal_state_size;
    }

    pub fn init(this: *SNativeZlib, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const arguments = callframe.argumentsUndef(7).slice();
        const this_value = callframe.this();

        if (arguments.len != 7) {
            return globalThis.ERR_MISSING_ARGS("init(windowBits, level, memLevel, strategy, writeResult, writeCallback, dictionary)", .{}).throw();
        }

        const windowBits = try validators.validateInt32(globalThis, arguments[0], "windowBits", .{}, null, null);
        const level = try validators.validateInt32(globalThis, arguments[1], "level", .{}, null, null);
        const memLevel = try validators.validateInt32(globalThis, arguments[2], "memLevel", .{}, null, null);
        const strategy = try validators.validateInt32(globalThis, arguments[3], "strategy", .{}, null, null);
        // this does not get gc'd because it is stored in the JS object's `this._writeState`. and the JS object is tied to the native handle as `_handle[owner_symbol]`.
        const writeResult = arguments[4].asArrayBuffer(globalThis).?.asU32().ptr;
        const writeCallback = try validators.validateFunction(globalThis, arguments[5], "writeCallback", .{});
        const dictionary = if (arguments[6].isUndefined()) null else arguments[6].asArrayBuffer(globalThis).?.byteSlice();

        this.write_result = writeResult;
        SNativeZlib.writeCallbackSetCached(this_value, globalThis, writeCallback);

        // Keep the dictionary alive by keeping a reference to it in the JS object.
        if (dictionary != null) {
            SNativeZlib.dictionarySetCached(this_value, globalThis, arguments[6]);
        }

        this.stream.init(level, windowBits, memLevel, strategy, dictionary);

        return .undefined;
    }

    pub fn params(this: *SNativeZlib, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const arguments = callframe.argumentsUndef(2).slice();

        if (arguments.len != 2) {
            return globalThis.ERR_MISSING_ARGS("params(level, strategy)", .{}).throw();
        }

        const level = try validators.validateInt32(globalThis, arguments[0], "level", .{}, null, null);
        const strategy = try validators.validateInt32(globalThis, arguments[1], "strategy", .{}, null, null);

        const err = this.stream.setParams(level, strategy);
        if (err.isError()) {
            try this.emitError(globalThis, callframe.this(), err);
        }
        return .undefined;
    }

    pub fn deinit(this: *@This()) void {
        this.this_value.deinit();
        this.poll_ref.deinit();
        this.stream.close();
        this.destroy();
    }
};

const Error = struct {
    msg: ?[*:0]const u8,
    err: c_int,
    code: ?[*:0]const u8,

    pub const ok: Error = init(null, 0, null);

    pub fn init(msg: ?[*:0]const u8, err: c_int, code: ?[*:0]const u8) Error {
        return .{
            .msg = msg,
            .err = err,
            .code = code,
        };
    }

    pub fn isError(this: Error) bool {
        return this.msg != null;
    }
};

const ZlibContext = struct {
    const c = bun.zlib;
    const GZIP_HEADER_ID1: u8 = 0x1f;
    const GZIP_HEADER_ID2: u8 = 0x8b;

    mode: c.NodeMode = .NONE,
    state: c.z_stream = std.mem.zeroes(c.z_stream),
    err: c.ReturnCode = .Ok,
    flush: c.FlushValue = .NoFlush,
    dictionary: []const u8 = "",
    gzip_id_bytes_read: u8 = 0,

    pub fn init(this: *ZlibContext, level: c_int, windowBits: c_int, memLevel: c_int, strategy: c_int, dictionary: ?[]const u8) void {
        this.flush = .NoFlush;
        this.err = .Ok;

        const windowBitsActual = switch (this.mode) {
            .NONE => unreachable,
            .DEFLATE, .INFLATE => windowBits,
            .GZIP, .GUNZIP => windowBits + 16,
            .UNZIP => windowBits + 32,
            .DEFLATERAW, .INFLATERAW => windowBits * -1,
            .BROTLI_DECODE, .BROTLI_ENCODE => unreachable,
        };

        this.dictionary = dictionary orelse "";

        switch (this.mode) {
            .NONE => unreachable,
            .DEFLATE, .GZIP, .DEFLATERAW => this.err = c.deflateInit2_(&this.state, level, 8, windowBitsActual, memLevel, strategy, c.zlibVersion(), @sizeOf(c.z_stream)),
            .INFLATE, .GUNZIP, .UNZIP, .INFLATERAW => this.err = c.inflateInit2_(&this.state, windowBitsActual, c.zlibVersion(), @sizeOf(c.z_stream)),
            .BROTLI_DECODE => @panic("TODO"),
            .BROTLI_ENCODE => @panic("TODO"),
        }
        if (this.err != .Ok) {
            this.mode = .NONE;
            return;
        }

        _ = this.setDictionary();
    }

    pub fn setDictionary(this: *ZlibContext) Error {
        const dict = this.dictionary;
        if (dict.len == 0) return Error.ok;
        this.err = .Ok;
        switch (this.mode) {
            .DEFLATE, .DEFLATERAW => {
                this.err = c.deflateSetDictionary(&this.state, dict.ptr, @intCast(dict.len));
            },
            .INFLATERAW => {
                this.err = c.inflateSetDictionary(&this.state, dict.ptr, @intCast(dict.len));
            },
            else => {},
        }
        if (this.err != .Ok) {
            return this.error_for_message("Failed to set dictionary");
        }
        return Error.ok;
    }

    pub fn setParams(this: *ZlibContext, level: c_int, strategy: c_int) Error {
        this.err = .Ok;
        switch (this.mode) {
            .DEFLATE, .DEFLATERAW => {
                this.err = c.deflateParams(&this.state, level, strategy);
            },
            else => {},
        }
        if (this.err != .Ok and this.err != .BufError) {
            return this.error_for_message("Failed to set parameters");
        }
        return Error.ok;
    }

    fn error_for_message(this: *ZlibContext, default: [*:0]const u8) Error {
        var message = default;
        if (this.state.err_msg) |msg| message = msg;
        return .{
            .msg = message,
            .err = @intFromEnum(this.err),
            .code = switch (this.err) {
                .Ok => "Z_OK",
                .StreamEnd => "Z_STREAM_END",
                .NeedDict => "Z_NEED_DICT",
                .ErrNo => "Z_ERRNO",
                .StreamError => "Z_STREAM_ERROR",
                .DataError => "Z_DATA_ERROR",
                .MemError => "Z_MEM_ERROR",
                .BufError => "Z_BUF_ERROR",
                .VersionError => "Z_VERSION_ERROR",
            },
        };
    }

    pub fn reset(this: *ZlibContext) Error {
        this.err = .Ok;
        switch (this.mode) {
            .DEFLATE, .DEFLATERAW, .GZIP => {
                this.err = c.deflateReset(&this.state);
            },
            .INFLATE, .INFLATERAW, .GUNZIP => {
                this.err = c.inflateReset(&this.state);
            },
            else => {},
        }
        if (this.err != .Ok) {
            return this.error_for_message("Failed to reset stream");
        }
        return this.setDictionary();
    }

    pub fn setBuffers(this: *ZlibContext, in: ?[]const u8, out: ?[]u8) void {
        this.state.avail_in = if (in) |p| @intCast(p.len) else 0;
        this.state.next_in = if (in) |p| p.ptr else null;
        this.state.avail_out = if (out) |p| @intCast(p.len) else 0;
        this.state.next_out = if (out) |p| p.ptr else null;
    }

    pub fn setFlush(this: *ZlibContext, flush: c_int) void {
        this.flush = @enumFromInt(flush);
    }

    pub fn doWork(this: *ZlibContext) void {
        var next_expected_header_byte: ?[*]const u8 = null;

        // If the avail_out is left at 0, then it means that it ran out
        // of room.  If there was avail_out left over, then it means
        // that all of the input was consumed.
        switch (this.mode) {
            .DEFLATE, .GZIP, .DEFLATERAW => {
                return this.doWorkDeflate();
            },
            .UNZIP => {
                if (this.state.avail_in > 0) {
                    next_expected_header_byte = this.state.next_in.?;
                }
                if (this.gzip_id_bytes_read == 0) {
                    if (next_expected_header_byte == null) {
                        return this.doWorkInflate();
                    }
                    if (next_expected_header_byte.?[0] == GZIP_HEADER_ID1) {
                        this.gzip_id_bytes_read = 1;
                        next_expected_header_byte.? += 1;
                        if (this.state.avail_in == 1) { // The only available byte was already read.
                            return this.doWorkInflate();
                        }
                    } else {
                        this.mode = .INFLATE;
                        return this.doWorkInflate();
                    }
                }
                if (this.gzip_id_bytes_read == 1) {
                    if (next_expected_header_byte == null) {
                        return this.doWorkInflate();
                    }
                    if (next_expected_header_byte.?[0] == GZIP_HEADER_ID2) {
                        this.gzip_id_bytes_read = 2;
                        this.mode = .GUNZIP;
                    } else {
                        this.mode = .INFLATE;
                    }
                    return this.doWorkInflate();
                }
                bun.assert(false); // invalid number of gzip magic number bytes read
            },
            .INFLATE, .GUNZIP, .INFLATERAW => {
                return this.doWorkInflate();
            },
            .NONE => {},
            .BROTLI_ENCODE, .BROTLI_DECODE => {},
        }
    }

    fn doWorkDeflate(this: *ZlibContext) void {
        this.err = c.deflate(&this.state, this.flush);
    }

    fn doWorkInflate(this: *ZlibContext) void {
        this.err = c.inflate(&this.state, this.flush);

        if (this.mode != .INFLATERAW and this.err == .NeedDict and this.dictionary.len > 0) {
            this.err = c.inflateSetDictionary(&this.state, this.dictionary.ptr, @intCast(this.dictionary.len));

            if (this.err == .Ok) {
                this.err = c.inflate(&this.state, this.flush);
            } else if (this.err == .DataError) {
                this.err = .NeedDict;
            }
        }
        while (this.state.avail_in > 0 and this.mode == .GUNZIP and this.err == .StreamEnd and this.state.next_in.?[0] != 0) {
            // Bytes remain in input buffer. Perhaps this is another compressed member in the same archive, or just trailing garbage.
            // Trailing zero bytes are okay, though, since they are frequently used for padding.
            _ = this.reset();
            this.err = c.inflate(&this.state, this.flush);
        }
    }

    pub fn updateWriteResult(this: *ZlibContext, avail_in: *u32, avail_out: *u32) void {
        avail_in.* = this.state.avail_in;
        avail_out.* = this.state.avail_out;
    }

    pub fn getErrorInfo(this: *ZlibContext) Error {
        switch (this.err) {
            .Ok, .BufError => {
                if (this.state.avail_out != 0 and this.flush == .Finish) {
                    return this.error_for_message("unexpected end of file");
                }
            },
            .StreamEnd => {},
            .NeedDict => {
                if (this.dictionary.len == 0) {
                    return this.error_for_message("Missing dictionary");
                } else {
                    return this.error_for_message("Bad dictionary");
                }
            },
            else => {
                return this.error_for_message("Zlib error");
            },
        }
        return Error.ok;
    }

    pub fn close(this: *ZlibContext) void {
        var status = c.ReturnCode.Ok;
        switch (this.mode) {
            .DEFLATE, .DEFLATERAW, .GZIP => {
                status = c.deflateEnd(&this.state);
            },
            .INFLATE, .INFLATERAW, .GUNZIP, .UNZIP => {
                status = c.inflateEnd(&this.state);
            },
            .NONE => {},
            .BROTLI_ENCODE, .BROTLI_DECODE => {},
        }
        bun.assert(status == .Ok or status == .DataError);
        this.mode = .NONE;
    }
};

pub const NativeBrotli = JSC.Codegen.JSNativeBrotli.getConstructor;

pub const SNativeBrotli = struct {
    pub usingnamespace bun.NewRefCounted(@This(), deinit);
    pub usingnamespace JSC.Codegen.JSNativeBrotli;
    pub usingnamespace CompressionStream(@This());

    ref_count: u32 = 1,
    mode: bun.zlib.NodeMode,
    globalThis: *JSC.JSGlobalObject,
    stream: BrotliContext = .{},
    write_result: ?[*]u32 = null,
    poll_ref: CountedKeepAlive = .{},
    this_value: JSC.Strong = .{},
    write_in_progress: bool = false,
    pending_close: bool = false,
    closed: bool = false,
    task: JSC.WorkPoolTask = .{
        .callback = undefined,
    },

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!*@This() {
        const arguments = callframe.argumentsUndef(1).ptr;

        var mode = arguments[0];
        if (!mode.isNumber()) {
            return globalThis.throwInvalidArgumentTypeValue("mode", "number", mode);
        }
        const mode_double = mode.asNumber();
        if (@mod(mode_double, 1.0) != 0.0) {
            return globalThis.throwInvalidArgumentTypeValue("mode", "integer", mode);
        }
        const mode_int: i64 = @intFromFloat(mode_double);
        if (mode_int < 8 or mode_int > 9) {
            return globalThis.throwRangeError(mode_int, .{ .field_name = "mode", .min = 8, .max = 9 });
        }

        const ptr = @This().new(.{
            .mode = @enumFromInt(mode_int),
            .globalThis = globalThis,
        });
        ptr.stream.mode = ptr.mode;
        ptr.stream.mode_ = ptr.mode;
        return ptr;
    }

    pub fn estimatedSize(this: *const SNativeBrotli) usize {
        const encoder_state_size: usize = 5143; // @sizeOf(@cImport(@cInclude("brotli/encode.h")).BrotliEncoderStateStruct)
        const decoder_state_size: usize = 855; // @sizeOf(@cImport(@cInclude("brotli/decode.h")).BrotliDecoderStateStruct)
        return @sizeOf(SNativeBrotli) + switch (this.mode) {
            .BROTLI_ENCODE => encoder_state_size,
            .BROTLI_DECODE => decoder_state_size,
            else => 0,
        };
    }

    pub fn init(this: *SNativeBrotli, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const arguments = callframe.argumentsUndef(3).slice();
        const this_value = callframe.this();
        if (arguments.len != 3) {
            return globalThis.ERR_MISSING_ARGS("init(params, writeResult, writeCallback)", .{}).throw();
        }

        // this does not get gc'd because it is stored in the JS object's `this._writeState`. and the JS object is tied to the native handle as `_handle[owner_symbol]`.
        const writeResult = arguments[1].asArrayBuffer(globalThis).?.asU32().ptr;
        const writeCallback = try validators.validateFunction(globalThis, arguments[2], "writeCallback", .{});

        this.write_result = writeResult;

        SNativeBrotli.writeCallbackSetCached(this_value, globalThis, writeCallback);

        var err = this.stream.init();
        if (err.isError()) {
            try this.emitError(globalThis, this_value, err);
            return JSC.jsBoolean(false);
        }

        const params_ = arguments[0].asArrayBuffer(globalThis).?.asU32();

        for (params_, 0..) |d, i| {
            // (d == -1) {
            if (d == std.math.maxInt(u32)) {
                continue;
            }
            err = this.stream.setParams(@intCast(i), d);
            if (err.isError()) {
                // try this.emitError(globalThis, err); //XXX: onerror isn't set yet
                return JSC.jsBoolean(false);
            }
        }
        return JSC.jsBoolean(true);
    }

    pub fn params(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        _ = this;
        _ = globalThis;
        _ = callframe;
        // intentionally left empty
        return .undefined;
    }

    pub fn deinit(this: *@This()) void {
        this.this_value.deinit();
        this.poll_ref.deinit();
        switch (this.stream.mode) {
            .BROTLI_ENCODE, .BROTLI_DECODE => this.stream.close(),
            else => {},
        }
        this.destroy();
    }
};

const BrotliContext = struct {
    const c = bun.brotli.c;
    const Op = bun.brotli.c.BrotliEncoder.Operation;

    mode: bun.zlib.NodeMode = .NONE,
    mode_: bun.zlib.NodeMode = .NONE,
    state: *anyopaque = undefined,

    next_in: ?[*]const u8 = null,
    next_out: ?[*]u8 = null,
    avail_in: usize = 0,
    avail_out: usize = 0,

    flush: Op = .process,

    last_result: extern union { e: c_int, d: c.BrotliDecoderResult } = @bitCast(@as(u32, 0)),
    error_: c.BrotliDecoderErrorCode2 = .NO_ERROR,

    pub fn init(this: *BrotliContext) Error {
        switch (this.mode_) {
            .BROTLI_ENCODE => {
                const alloc = &bun.brotli.BrotliAllocator.alloc;
                const free = &bun.brotli.BrotliAllocator.free;
                const state = c.BrotliEncoderCreateInstance(alloc, free, null);
                if (state == null) {
                    return Error.init("Could not initialize Brotli instance", -1, "ERR_ZLIB_INITIALIZATION_FAILED");
                }
                this.state = @ptrCast(state.?);
                return Error.ok;
            },
            .BROTLI_DECODE => {
                const alloc = &bun.brotli.BrotliAllocator.alloc;
                const free = &bun.brotli.BrotliAllocator.free;
                const state = c.BrotliDecoderCreateInstance(alloc, free, null);
                if (state == null) {
                    return Error.init("Could not initialize Brotli instance", -1, "ERR_ZLIB_INITIALIZATION_FAILED");
                }
                this.state = @ptrCast(state.?);
                return Error.ok;
            },
            else => unreachable,
        }
    }

    pub fn setParams(this: *BrotliContext, key: c_uint, value: u32) Error {
        switch (this.mode_) {
            .BROTLI_ENCODE => {
                if (c.BrotliEncoderSetParameter(@ptrCast(this.state), key, value) == 0) {
                    return Error.init("Setting parameter failed", -1, "ERR_BROTLI_PARAM_SET_FAILED");
                }
                return Error.ok;
            },
            .BROTLI_DECODE => {
                if (c.BrotliDecoderSetParameter(@ptrCast(this.state), key, value) == 0) {
                    return Error.init("Setting parameter failed", -1, "ERR_BROTLI_PARAM_SET_FAILED");
                }
                return Error.ok;
            },
            else => unreachable,
        }
    }

    pub fn reset(this: *BrotliContext) Error {
        return this.init();
    }

    pub fn setBuffers(this: *BrotliContext, in: ?[]const u8, out: ?[]u8) void {
        this.next_in = if (in) |p| p.ptr else null;
        this.next_out = if (out) |p| p.ptr else null;
        this.avail_in = if (in) |p| p.len else 0;
        this.avail_out = if (out) |p| p.len else 0;
    }

    pub fn setFlush(this: *BrotliContext, flush: c_int) void {
        this.flush = @enumFromInt(flush);
    }

    pub fn doWork(this: *BrotliContext) void {
        switch (this.mode_) {
            .BROTLI_ENCODE => {
                var next_in = this.next_in;
                this.last_result.e = c.BrotliEncoderCompressStream(@ptrCast(this.state), this.flush, &this.avail_in, &next_in, &this.avail_out, &this.next_out, null);
                this.next_in.? += @intFromPtr(next_in.?) - @intFromPtr(this.next_in.?);
            },
            .BROTLI_DECODE => {
                var next_in = this.next_in;
                this.last_result.d = c.BrotliDecoderDecompressStream(@ptrCast(this.state), &this.avail_in, &next_in, &this.avail_out, &this.next_out, null);
                this.next_in.? += @intFromPtr(next_in.?) - @intFromPtr(this.next_in.?);
                if (this.last_result.d == .err) {
                    this.error_ = c.BrotliDecoderGetErrorCode(@ptrCast(this.state));
                }
            },
            else => unreachable,
        }
    }

    pub fn updateWriteResult(this: *BrotliContext, avail_in: *u32, avail_out: *u32) void {
        avail_in.* = @intCast(this.avail_in);
        avail_out.* = @intCast(this.avail_out);
    }

    pub fn getErrorInfo(this: *BrotliContext) Error {
        switch (this.mode_) {
            .BROTLI_ENCODE => {
                if (this.last_result.e == 0) {
                    return Error.init("Compression failed", -1, "ERR_BROTLI_COMPRESSION_FAILED");
                }
                return Error.ok;
            },
            .BROTLI_DECODE => {
                if (this.error_ != .NO_ERROR) {
                    return Error.init("Decompression failed", @intFromEnum(this.error_), code_for_error(this.error_));
                } else if (this.flush == .finish and this.last_result.d == .needs_more_input) {
                    return Error.init("unexpected end of file", @intFromEnum(bun.zlib.ReturnCode.BufError), "Z_BUF_ERROR");
                }
                return Error.ok;
            },
            else => unreachable,
        }
    }

    pub fn close(this: *BrotliContext) void {
        switch (this.mode_) {
            .BROTLI_ENCODE => c.BrotliEncoderDestroyInstance(@ptrCast(@alignCast(this.state))),
            .BROTLI_DECODE => c.BrotliDecoderDestroyInstance(@ptrCast(@alignCast(this.state))),
            else => unreachable,
        }
        this.mode = .NONE;
    }

    fn code_for_error(err: c.BrotliDecoderErrorCode2) [:0]const u8 {
        const E = c.BrotliDecoderErrorCode2;
        const names = comptime std.meta.fieldNames(E);
        const values = comptime std.enums.values(E);
        inline for (names, values) |n, v| {
            if (err == v) {
                return "ERR_BROTLI_DECODER_" ++ n;
            }
        }
        unreachable;
    }
};
