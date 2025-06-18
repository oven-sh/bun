const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const CompressionStream = @import("./../node_zlib_binding.zig").CompressionStream;
const CountedKeepAlive = @import("./../node_zlib_binding.zig").CountedKeepAlive;
const Error = @import("./../node_zlib_binding.zig").Error;
const validators = @import("./../util/validators.zig");

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub const js = JSC.Codegen.JSNativeBrotli;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

const impl = CompressionStream(@This());
pub const write = impl.write;
pub const runFromJSThread = impl.runFromJSThread;
pub const writeSync = impl.writeSync;
pub const reset = impl.reset;
pub const close = impl.close;
pub const setOnError = impl.setOnError;
pub const getOnError = impl.getOnError;
pub const finalize = impl.finalize;

ref_count: RefCount,
globalThis: *JSC.JSGlobalObject,
stream: Context = .{},
write_result: ?[*]u32 = null,
poll_ref: CountedKeepAlive = .{},
this_value: JSC.Strong.Optional = .empty,
write_in_progress: bool = false,
pending_close: bool = false,
closed: bool = false,
task: JSC.WorkPoolTask = .{ .callback = undefined },

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

    const ptr = bun.new(@This(), .{
        .ref_count = .init(),
        .globalThis = globalThis,
    });
    ptr.stream.mode = @enumFromInt(mode_int);
    return ptr;
}

pub fn estimatedSize(this: *const @This()) usize {
    const encoder_state_size: usize = 5143; // @sizeOf(@cImport(@cInclude("brotli/encode.h")).BrotliEncoderStateStruct)
    const decoder_state_size: usize = 855; // @sizeOf(@cImport(@cInclude("brotli/decode.h")).BrotliDecoderStateStruct)
    return @sizeOf(@This()) + switch (this.stream.mode) {
        .BROTLI_ENCODE => encoder_state_size,
        .BROTLI_DECODE => decoder_state_size,
        else => 0,
    };
}

pub fn init(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.argumentsUndef(3).slice();
    const this_value = callframe.this();
    if (arguments.len != 3) {
        return globalThis.ERR(.MISSING_ARGS, "init(params, writeResult, writeCallback)", .{}).throw();
    }

    // this does not get gc'd because it is stored in the JS object's `this._writeState`. and the JS object is tied to the native handle as `_handle[owner_symbol]`.
    const writeResult = arguments[1].asArrayBuffer(globalThis).?.asU32().ptr;
    const writeCallback = try validators.validateFunction(globalThis, "writeCallback", arguments[2]);

    this.write_result = writeResult;

    js.writeCallbackSetCached(this_value, globalThis, writeCallback);

    var err = this.stream.init();
    if (err.isError()) {
        try impl.emitError(this, globalThis, this_value, err);
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
            // try impl.emitError(this, globalThis, this_value, err); //XXX: onerror isn't set yet
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
    return .js_undefined;
}

fn deinit(this: *@This()) void {
    this.this_value.deinit();
    this.poll_ref.deinit();
    switch (this.stream.mode) {
        .BROTLI_ENCODE, .BROTLI_DECODE => this.stream.close(),
        else => {},
    }
    bun.destroy(this);
}

const Context = struct {
    const c = bun.brotli.c;
    const Op = bun.brotli.c.BrotliEncoder.Operation;

    mode: bun.zlib.NodeMode = .NONE,
    state: ?*anyopaque = null,

    next_in: ?[*]const u8 = null,
    next_out: ?[*]u8 = null,
    avail_in: usize = 0,
    avail_out: usize = 0,

    flush: Op = .process,

    last_result: extern union { e: c_int, d: c.BrotliDecoderResult } = @bitCast(@as(u32, 0)),
    error_: c.BrotliDecoderErrorCode2 = .NO_ERROR,

    pub fn init(this: *Context) Error {
        switch (this.mode) {
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

    pub fn setParams(this: *Context, key: c_uint, value: u32) Error {
        switch (this.mode) {
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

    pub fn reset(this: *Context) Error {
        return this.init();
    }

    pub fn setBuffers(this: *Context, in: ?[]const u8, out: ?[]u8) void {
        this.next_in = if (in) |p| p.ptr else null;
        this.next_out = if (out) |p| p.ptr else null;
        this.avail_in = if (in) |p| p.len else 0;
        this.avail_out = if (out) |p| p.len else 0;
    }

    pub fn setFlush(this: *Context, flush: c_int) void {
        this.flush = @enumFromInt(flush);
    }

    pub fn doWork(this: *Context) void {
        switch (this.mode) {
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

    pub fn updateWriteResult(this: *Context, avail_in: *u32, avail_out: *u32) void {
        avail_in.* = @intCast(this.avail_in);
        avail_out.* = @intCast(this.avail_out);
    }

    pub fn getErrorInfo(this: *Context) Error {
        switch (this.mode) {
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

    pub fn close(this: *Context) void {
        switch (this.mode) {
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
