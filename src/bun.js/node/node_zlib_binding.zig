const debug = bun.Output.scoped(.zlib, .hidden);

pub fn crc32(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(2).ptr;

    const data: ZigString.Slice = blk: {
        const data: jsc.JSValue = arguments[0];

        if (data == .zero) {
            return globalThis.throwInvalidArgumentTypeValue("data", "string or an instance of Buffer, TypedArray, or DataView", .js_undefined);
        }
        if (data.isString()) {
            break :blk data.asString().toSlice(globalThis, bun.default_allocator);
        }
        const buffer: Buffer = Buffer.fromJS(globalThis, data) orelse {
            const ty_str = data.jsTypeString(globalThis).toSlice(globalThis, bun.default_allocator);
            defer ty_str.deinit();
            return globalThis.ERR(.INVALID_ARG_TYPE, "The \"data\" property must be an instance of Buffer, TypedArray, DataView, or ArrayBuffer. Received {s}", .{ty_str.slice()}).throw();
        };
        break :blk ZigString.Slice.fromUTF8NeverFree(buffer.slice());
    };
    defer data.deinit();

    const value: u32 = blk: {
        const value: jsc.JSValue = arguments[1];
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
            return globalThis.ERR(.OUT_OF_RANGE, "The value of \"{s}\" is out of range. It must be an integer. Received {}", .{ "value", valuef }).throw();
        }
        if (valuef < min or valuef > max) {
            return globalThis.ERR(.OUT_OF_RANGE, "The value of \"{s}\" is out of range. It must be >= {d} and <= {d}. Received {d}", .{ "value", min, max, valuef }).throw();
        }
        break :blk @intFromFloat(valuef);
    };

    // crc32 returns a u64 but the data will always be within a u32 range so the outer @intCast is always safe.
    const slice_u8 = data.slice();
    return jsc.JSValue.jsNumber(@as(u32, @intCast(bun.zlib.crc32(value, slice_u8.ptr, @intCast(slice_u8.len)))));
}

pub fn CompressionStream(comptime T: type) type {
    return struct {
        pub fn write(this: *T, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            const arguments = callframe.argumentsUndef(7).slice();

            if (arguments.len != 7) {
                return globalThis.ERR(.MISSING_ARGS, "write(flush, in, in_off, in_len, out, out_off, out_len)", .{}).throw();
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
            jsc.WorkPool.schedule(&this.task);

            return .js_undefined;
        }

        const AsyncJob = struct {
            pub fn runTask(task: *jsc.WorkPoolTask) void {
                const this: *T = @fieldParentPtr("task", task);
                AsyncJob.run(this);
            }

            pub fn run(this: *T) void {
                const globalThis: *jsc.JSGlobalObject = this.globalThis;
                const vm = globalThis.bunVMConcurrently();

                this.stream.doWork();

                vm.enqueueTaskConcurrent(jsc.ConcurrentTask.create(jsc.Task.init(this)));
            }
        };

        pub fn runFromJSThread(this: *T) void {
            const global: *jsc.JSGlobalObject = this.globalThis;
            const vm = global.bunVM();
            defer this.deref();
            defer this.poll_ref.unref(vm);

            this.write_in_progress = false;

            // Clear the strong handle before we call any callbacks.
            const this_value = this.this_value.trySwap() orelse {
                debug("this_value is null in runFromJSThread", .{});
                return;
            };

            this_value.ensureStillAlive();

            if (!(checkError(this, global, this_value))) {
                return;
            }

            this.stream.updateWriteResult(&this.write_result.?[1], &this.write_result.?[0]);
            this_value.ensureStillAlive();

            const write_callback: jsc.JSValue = T.js.writeCallbackGetCached(this_value).?;

            vm.eventLoop().runCallback(write_callback, global, this_value, &.{});

            if (this.pending_close) _ = closeInternal(this);
        }

        pub fn writeSync(this: *T, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            const arguments = callframe.argumentsUndef(7).slice();

            if (arguments.len != 7) {
                return globalThis.ERR(.MISSING_ARGS, "writeSync(flush, in, in_off, in_len, out, out_off, out_len)", .{}).throw();
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
            if (checkError(this, globalThis, this_value)) {
                this.stream.updateWriteResult(&this.write_result.?[1], &this.write_result.?[0]);
                this.write_in_progress = false;
            }
            this.deref();

            return .js_undefined;
        }

        pub fn reset(this: *T, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) jsc.JSValue {
            const err = this.stream.reset();
            if (err.isError()) {
                emitError(this, globalThis, callframe.this(), err);
            }
            return .js_undefined;
        }

        pub fn close(this: *T, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            _ = globalThis;
            _ = callframe;
            closeInternal(this);
            return .js_undefined;
        }

        fn closeInternal(this: *T) void {
            if (this.write_in_progress) {
                this.pending_close = true;
                return;
            }
            this.pending_close = false;
            this.closed = true;
            this.this_value.deinit();
            this.stream.close();
        }

        pub fn setOnError(_: *T, this_value: jsc.JSValue, globalObject: *jsc.JSGlobalObject, value: jsc.JSValue) void {
            if (value.isFunction()) {
                T.js.errorCallbackSetCached(this_value, globalObject, value.withAsyncContextIfNeeded(globalObject));
            }
        }

        pub fn getOnError(_: *T, this_value: jsc.JSValue, _: *jsc.JSGlobalObject) jsc.JSValue {
            return T.js.errorCallbackGetCached(this_value) orelse .js_undefined;
        }

        /// returns true if no error was detected/emitted
        fn checkError(this: *T, globalThis: *jsc.JSGlobalObject, this_value: jsc.JSValue) bool {
            const err = this.stream.getErrorInfo();
            if (!err.isError()) return true;
            emitError(this, globalThis, this_value, err);
            return false;
        }

        pub fn emitError(this: *T, globalThis: *jsc.JSGlobalObject, this_value: jsc.JSValue, err_: Error) void {
            var msg_str = bun.handleOom(bun.String.createFormat("{s}", .{std.mem.sliceTo(err_.msg, 0) orelse ""}));
            const msg_value = msg_str.transferToJS(globalThis) catch return;
            const err_value: jsc.JSValue = .jsNumber(err_.err);
            var code_str = bun.handleOom(bun.String.createFormat("{s}", .{std.mem.sliceTo(err_.code, 0) orelse ""}));
            const code_value = code_str.transferToJS(globalThis) catch return;

            const callback: jsc.JSValue = T.js.errorCallbackGetCached(this_value) orelse
                Output.panic("Assertion failure: cachedErrorCallback is null in node:zlib binding", .{});

            const vm = globalThis.bunVM();
            vm.eventLoop().runCallback(callback, globalThis, this_value, &.{ msg_value, err_value, code_value });

            this.write_in_progress = false;
            if (this.pending_close) _ = closeInternal(this);
        }

        pub fn finalize(this: *T) void {
            this.deref();
        }
    };
}

pub const NativeZlib = jsc.Codegen.JSNativeZlib.getConstructor;

pub const NativeBrotli = jsc.Codegen.JSNativeBrotli.getConstructor;

pub const NativeZstd = jsc.Codegen.JSNativeZstd.getConstructor;

pub const CountedKeepAlive = struct {
    keep_alive: bun.Async.KeepAlive = .{},
    ref_count: u32 = 0,

    pub fn ref(this: *@This(), vm: *jsc.VirtualMachine) void {
        if (this.ref_count == 0) {
            this.keep_alive.ref(vm);
        }
        this.ref_count += 1;
    }

    pub fn unref(this: *@This(), vm: *jsc.VirtualMachine) void {
        this.ref_count -= 1;
        if (this.ref_count == 0) {
            this.keep_alive.unref(vm);
        }
    }

    pub fn deinit(this: *@This()) void {
        this.keep_alive.disable();
    }
};

pub const Error = struct {
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

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Output = bun.Output;
const Buffer = bun.api.node.Buffer;

const jsc = bun.jsc;
const ZigString = jsc.ZigString;
