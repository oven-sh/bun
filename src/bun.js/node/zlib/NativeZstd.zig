const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub const js = jsc.Codegen.JSNativeZstd;
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
globalThis: *jsc.JSGlobalObject,
stream: Context = .{},
write_result: ?[*]u32 = null,
poll_ref: CountedKeepAlive = .{},
this_value: jsc.Strong.Optional = .empty,
write_in_progress: bool = false,
pending_close: bool = false,
closed: bool = false,
task: jsc.WorkPoolTask = .{ .callback = undefined },

pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*@This() {
    const arguments = callframe.argumentsAsArray(1);

    var mode = arguments[0];
    if (!mode.isNumber()) {
        return globalThis.throwInvalidArgumentTypeValue("mode", "number", mode);
    }
    const mode_double = mode.asNumber();
    if (@mod(mode_double, 1.0) != 0.0) {
        return globalThis.throwInvalidArgumentTypeValue("mode", "integer", mode);
    }
    const mode_int: i64 = @intFromFloat(mode_double);
    if (mode_int < 10 or mode_int > 11) {
        return globalThis.throwRangeError(mode_int, .{ .field_name = "mode", .min = 10, .max = 11 });
    }

    const ptr = bun.new(@This(), .{
        .ref_count = .init(),
        .globalThis = globalThis,
    });
    ptr.stream.mode = @enumFromInt(mode_int);
    return ptr;
}

pub fn estimatedSize(this: *const @This()) usize {
    return @sizeOf(@This()) + @as(usize, switch (this.stream.mode) {
        .ZSTD_COMPRESS => 5272, // estimate of bun.c.ZSTD_sizeof_CCtx(@ptrCast(this.stream.state)),
        .ZSTD_DECOMPRESS => 95968, // estimate of bun.c.ZSTD_sizeof_DCtx(@ptrCast(this.stream.state)),
        else => 0,
    });
}

pub fn init(this: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.argumentsAsArray(4);
    const this_value = callframe.this();
    if (callframe.argumentsCount() != 4) return globalThis.ERR(.MISSING_ARGS, "init(initParamsArray, pledgedSrcSize, writeState, processCallback)", .{}).throw();

    const initParamsArray_value = arguments[0];
    const pledgedSrcSize_value = arguments[1];
    const writeState_value = arguments[2];
    const processCallback_value = arguments[3];

    const writeState = writeState_value.asArrayBuffer(globalThis) orelse return globalThis.throwInvalidArgumentTypeValue("writeState", "Uint32Array", writeState_value);
    if (writeState.typed_array_type != .Uint32Array) return globalThis.throwInvalidArgumentTypeValue("writeState", "Uint32Array", writeState_value);
    this.write_result = writeState.asU32().ptr;

    const write_js_callback = try validators.validateFunction(globalThis, "processCallback", processCallback_value);
    js.writeCallbackSetCached(this_value, globalThis, write_js_callback.withAsyncContextIfNeeded(globalThis));

    var pledged_src_size: u64 = std.math.maxInt(u64);
    if (pledgedSrcSize_value.isNumber()) {
        pledged_src_size = try validators.validateUint32(globalThis, pledgedSrcSize_value, "pledgedSrcSize", .{}, false);
    }

    var err = this.stream.init(pledged_src_size);
    if (err.isError()) {
        impl.emitError(this, globalThis, this_value, err);
        return .false;
    }

    const params_ = initParamsArray_value.asArrayBuffer(globalThis) orelse return globalThis.throwInvalidArgumentTypeValue("initParamsArray", "Uint32Array", initParamsArray_value);
    if (params_.typed_array_type != .Uint32Array) return globalThis.throwInvalidArgumentTypeValue("initParamsArray", "Uint32Array", initParamsArray_value);
    for (params_.asU32(), 0..) |x, i| {
        if (x == std.math.maxInt(u32)) continue;
        const err_ = this.stream.setParams(@intCast(i), x);
        if (err_.isError()) {
            this.stream.close();
            return globalThis.ERR(.ZLIB_INITIALIZATION_FAILED, "{s}", .{std.mem.sliceTo(err_.msg.?, 0)}).throw();
        }
    }

    return .true;
}

pub fn params(this: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    _ = this;
    _ = globalThis;
    _ = callframe;
    // intentionally left empty
    return .js_undefined;
}

fn deinit(this: *@This()) void {
    this.poll_ref.deinit();
    switch (this.stream.mode) {
        .ZSTD_COMPRESS, .ZSTD_DECOMPRESS => this.stream.close(),
        else => {},
    }
    bun.destroy(this);
}

const Context = struct {
    const c = bun.c;

    mode: bun.zlib.NodeMode = .NONE,
    state: ?*anyopaque = null,
    flush: c_int = c.ZSTD_e_continue,
    input: c.ZSTD_inBuffer = .{ .src = null, .size = 0, .pos = 0 },
    output: c.ZSTD_outBuffer = .{ .dst = null, .size = 0, .pos = 0 },
    pledged_src_size: u64 = std.math.maxInt(u64),
    remaining: u64 = 0,

    pub fn init(this: *Context, pledged_src_size: u64) Error {
        switch (this.mode) {
            .ZSTD_COMPRESS => {
                this.pledged_src_size = pledged_src_size;
                const state = c.ZSTD_createCCtx();
                if (state == null) return .init("Could not initialize zstd instance", -1, "ERR_ZLIB_INITIALIZATION_FAILED");
                this.state = state.?;
                const result = c.ZSTD_CCtx_setPledgedSrcSize(state, pledged_src_size);
                if (c.ZSTD_isError(result) > 0) {
                    _ = c.ZSTD_freeCCtx(state);
                    this.state = null;
                    return .init("Could not set pledged src size", -1, "ERR_ZLIB_INITIALIZATION_FAILED");
                }
                return .ok;
            },
            .ZSTD_DECOMPRESS => {
                const state = c.ZSTD_createDCtx();
                if (state == null) return .init("Could not initialize zstd instance", -1, "ERR_ZLIB_INITIALIZATION_FAILED");
                this.state = state.?;
                return .ok;
            },
            else => @panic("unreachable"),
        }
    }

    pub fn setParams(this: *Context, key: c_uint, value: u32) Error {
        switch (this.mode) {
            .ZSTD_COMPRESS => {
                const result = c.ZSTD_CCtx_setParameter(@ptrCast(this.state), key, @bitCast(value));
                if (c.ZSTD_isError(result) > 0) return .init("Setting parameter failed", -1, "ERR_ZSTD_PARAM_SET_FAILED");
                return .ok;
            },
            .ZSTD_DECOMPRESS => {
                const result = c.ZSTD_DCtx_setParameter(@ptrCast(this.state), key, @bitCast(value));
                if (c.ZSTD_isError(result) > 0) return .init("Setting parameter failed", -1, "ERR_ZSTD_PARAM_SET_FAILED");
                return .ok;
            },
            else => @panic("unreachable"),
        }
    }

    pub fn reset(this: *Context) Error {
        if (this.state != null) {
            this.deinitState();
        }
        return this.init(this.pledged_src_size);
    }

    /// Frees the Zstd encoder/decoder state without changing mode.
    /// Use close() for full cleanup that also sets mode to NONE.
    fn deinitState(this: *Context) void {
        _ = switch (this.mode) {
            .ZSTD_COMPRESS => c.ZSTD_freeCCtx(@ptrCast(this.state)),
            .ZSTD_DECOMPRESS => c.ZSTD_freeDCtx(@ptrCast(this.state)),
            else => unreachable,
        };
        this.state = null;
    }

    pub fn setBuffers(this: *Context, in: ?[]const u8, out: ?[]u8) void {
        this.input.src = if (in) |p| p.ptr else null;
        this.input.size = if (in) |p| p.len else 0;
        this.input.pos = 0;
        this.output.dst = if (out) |p| p.ptr else null;
        this.output.size = if (out) |p| p.len else 0;
        this.output.pos = 0;
    }

    pub fn setFlush(this: *Context, flush: c_int) void {
        this.flush = flush;
    }

    pub fn doWork(this: *Context) void {
        this.remaining = switch (this.mode) {
            .ZSTD_COMPRESS => c.ZSTD_compressStream2(@ptrCast(this.state), &this.output, &this.input, @intCast(this.flush)),
            .ZSTD_DECOMPRESS => c.ZSTD_decompressStream(@ptrCast(this.state), &this.output, &this.input),
            else => @panic("unreachable"),
        };
    }

    pub fn updateWriteResult(this: *Context, avail_in: *u32, avail_out: *u32) void {
        avail_in.* = @intCast(this.input.size - this.input.pos);
        avail_out.* = @intCast(this.output.size - this.output.pos);
    }

    pub fn getErrorInfo(this: *Context) Error {
        defer this.remaining = 0;
        const err = c.ZSTD_getErrorCode(this.remaining);
        if (err == 0) {
            return .ok;
        }
        return Error{
            .err = @intCast(err),
            .msg = c.ZSTD_getErrorString(err),
            .code = switch (err) {
                c.ZSTD_error_no_error => "ZSTD_error_no_error",
                c.ZSTD_error_GENERIC => "ZSTD_error_GENERIC",
                c.ZSTD_error_prefix_unknown => "ZSTD_error_prefix_unknown",
                c.ZSTD_error_version_unsupported => "ZSTD_error_version_unsupported",
                c.ZSTD_error_frameParameter_unsupported => "ZSTD_error_frameParameter_unsupported",
                c.ZSTD_error_frameParameter_windowTooLarge => "ZSTD_error_frameParameter_windowTooLarge",
                c.ZSTD_error_corruption_detected => "ZSTD_error_corruption_detected",
                c.ZSTD_error_checksum_wrong => "ZSTD_error_checksum_wrong",
                c.ZSTD_error_literals_headerWrong => "ZSTD_error_literals_headerWrong",
                c.ZSTD_error_dictionary_corrupted => "ZSTD_error_dictionary_corrupted",
                c.ZSTD_error_dictionary_wrong => "ZSTD_error_dictionary_wrong",
                c.ZSTD_error_dictionaryCreation_failed => "ZSTD_error_dictionaryCreation_failed",
                c.ZSTD_error_parameter_unsupported => "ZSTD_error_parameter_unsupported",
                c.ZSTD_error_parameter_combination_unsupported => "ZSTD_error_parameter_combination_unsupported",
                c.ZSTD_error_parameter_outOfBound => "ZSTD_error_parameter_outOfBound",
                c.ZSTD_error_tableLog_tooLarge => "ZSTD_error_tableLog_tooLarge",
                c.ZSTD_error_maxSymbolValue_tooLarge => "ZSTD_error_maxSymbolValue_tooLarge",
                c.ZSTD_error_maxSymbolValue_tooSmall => "ZSTD_error_maxSymbolValue_tooSmall",
                c.ZSTD_error_stabilityCondition_notRespected => "ZSTD_error_stabilityCondition_notRespected",
                c.ZSTD_error_stage_wrong => "ZSTD_error_stage_wrong",
                c.ZSTD_error_init_missing => "ZSTD_error_init_missing",
                c.ZSTD_error_memory_allocation => "ZSTD_error_memory_allocation",
                c.ZSTD_error_workSpace_tooSmall => "ZSTD_error_workSpace_tooSmall",
                c.ZSTD_error_dstSize_tooSmall => "ZSTD_error_dstSize_tooSmall",
                c.ZSTD_error_srcSize_wrong => "ZSTD_error_srcSize_wrong",
                c.ZSTD_error_dstBuffer_null => "ZSTD_error_dstBuffer_null",
                c.ZSTD_error_noForwardProgress_destFull => "ZSTD_error_noForwardProgress_destFull",
                c.ZSTD_error_noForwardProgress_inputEmpty => "ZSTD_error_noForwardProgress_inputEmpty",
                else => "ZSTD_error_GENERIC",
            },
        };
    }

    pub fn close(this: *Context) void {
        _ = switch (this.mode) {
            .ZSTD_COMPRESS => c.ZSTD_CCtx_reset(@ptrCast(this.state), c.ZSTD_reset_session_and_parameters),
            .ZSTD_DECOMPRESS => c.ZSTD_DCtx_reset(@ptrCast(this.state), c.ZSTD_reset_session_and_parameters),
            else => unreachable,
        };
        this.deinitState();
        this.mode = .NONE;
    }
};

const std = @import("std");
const validators = @import("../util/validators.zig");

const CompressionStream = @import("../node_zlib_binding.zig").CompressionStream;
const CountedKeepAlive = @import("../node_zlib_binding.zig").CountedKeepAlive;
const Error = @import("../node_zlib_binding.zig").Error;

const bun = @import("bun");
const jsc = bun.jsc;
