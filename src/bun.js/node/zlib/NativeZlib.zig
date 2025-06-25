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

pub const js = JSC.Codegen.JSNativeZlib;
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

    const ptr = bun.new(@This(), .{
        .ref_count = .init(),
        .globalThis = globalThis,
    });
    ptr.stream.mode = @enumFromInt(mode_int);
    return ptr;
}

//// adding this didnt help much but leaving it here to compare the number with later
pub fn estimatedSize(_: *const @This()) usize {
    const internal_state_size = 3309; // @sizeOf(@cImport(@cInclude("deflate.h")).internal_state) @ cloudflare/zlib @ 92530568d2c128b4432467b76a3b54d93d6350bd
    return @sizeOf(@This()) + internal_state_size;
}

pub fn init(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.argumentsUndef(7).slice();
    const this_value = callframe.this();

    if (arguments.len != 7) {
        return globalThis.ERR(.MISSING_ARGS, "init(windowBits, level, memLevel, strategy, writeResult, writeCallback, dictionary)", .{}).throw();
    }

    const windowBits = try validators.validateInt32(globalThis, arguments[0], "windowBits", .{}, null, null);
    const level = try validators.validateInt32(globalThis, arguments[1], "level", .{}, null, null);
    const memLevel = try validators.validateInt32(globalThis, arguments[2], "memLevel", .{}, null, null);
    const strategy = try validators.validateInt32(globalThis, arguments[3], "strategy", .{}, null, null);
    // this does not get gc'd because it is stored in the JS object's `this._writeState`. and the JS object is tied to the native handle as `_handle[owner_symbol]`.
    const writeResult = arguments[4].asArrayBuffer(globalThis).?.asU32().ptr;
    const writeCallback = try validators.validateFunction(globalThis, "writeCallback", arguments[5]);
    const dictionary = if (arguments[6].isUndefined()) null else arguments[6].asArrayBuffer(globalThis).?.byteSlice();

    this.write_result = writeResult;
    js.writeCallbackSetCached(this_value, globalThis, writeCallback);

    // Keep the dictionary alive by keeping a reference to it in the JS object.
    if (dictionary != null) {
        js.dictionarySetCached(this_value, globalThis, arguments[6]);
    }

    this.stream.init(level, windowBits, memLevel, strategy, dictionary);

    return .js_undefined;
}

pub fn params(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.argumentsUndef(2).slice();

    if (arguments.len != 2) {
        return globalThis.ERR(.MISSING_ARGS, "params(level, strategy)", .{}).throw();
    }

    const level = try validators.validateInt32(globalThis, arguments[0], "level", .{}, null, null);
    const strategy = try validators.validateInt32(globalThis, arguments[1], "strategy", .{}, null, null);

    const err = this.stream.setParams(level, strategy);
    if (err.isError()) {
        try impl.emitError(this, globalThis, callframe.this(), err);
    }
    return .js_undefined;
}

fn deinit(this: *@This()) void {
    this.this_value.deinit();
    this.poll_ref.deinit();
    this.stream.close();
    bun.destroy(this);
}

const Context = struct {
    const c = bun.zlib;
    const GZIP_HEADER_ID1: u8 = 0x1f;
    const GZIP_HEADER_ID2: u8 = 0x8b;

    mode: c.NodeMode = .NONE,
    state: c.z_stream = std.mem.zeroes(c.z_stream),
    err: c.ReturnCode = .Ok,
    flush: c.FlushValue = .NoFlush,
    dictionary: []const u8 = "",
    gzip_id_bytes_read: u8 = 0,

    pub fn init(this: *Context, level: c_int, windowBits: c_int, memLevel: c_int, strategy: c_int, dictionary: ?[]const u8) void {
        this.flush = .NoFlush;
        this.err = .Ok;

        const windowBitsActual = switch (this.mode) {
            .NONE => unreachable,
            .DEFLATE, .INFLATE => windowBits,
            .GZIP, .GUNZIP => windowBits + 16,
            .UNZIP => windowBits + 32,
            .DEFLATERAW, .INFLATERAW => windowBits * -1,
            .BROTLI_DECODE, .BROTLI_ENCODE => unreachable,
            .ZSTD_COMPRESS, .ZSTD_DECOMPRESS => unreachable,
        };

        this.dictionary = dictionary orelse "";

        switch (this.mode) {
            .NONE => unreachable,
            .DEFLATE, .GZIP, .DEFLATERAW => this.err = c.deflateInit2_(&this.state, level, 8, windowBitsActual, memLevel, strategy, c.zlibVersion(), @sizeOf(c.z_stream)),
            .INFLATE, .GUNZIP, .UNZIP, .INFLATERAW => this.err = c.inflateInit2_(&this.state, windowBitsActual, c.zlibVersion(), @sizeOf(c.z_stream)),
            .BROTLI_DECODE, .BROTLI_ENCODE => unreachable,
            .ZSTD_COMPRESS, .ZSTD_DECOMPRESS => unreachable,
        }
        if (this.err != .Ok) {
            this.mode = .NONE;
            return;
        }

        _ = this.setDictionary();
    }

    pub fn setDictionary(this: *Context) Error {
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

    pub fn setParams(this: *Context, level: c_int, strategy: c_int) Error {
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

    fn error_for_message(this: *Context, default: [*:0]const u8) Error {
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

    pub fn reset(this: *Context) Error {
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

    pub fn setBuffers(this: *Context, in: ?[]const u8, out: ?[]u8) void {
        this.state.avail_in = if (in) |p| @intCast(p.len) else 0;
        this.state.next_in = if (in) |p| p.ptr else null;
        this.state.avail_out = if (out) |p| @intCast(p.len) else 0;
        this.state.next_out = if (out) |p| p.ptr else null;
    }

    pub fn setFlush(this: *Context, flush: c_int) void {
        this.flush = @enumFromInt(flush);
    }

    pub fn doWork(this: *Context) void {
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
            .ZSTD_COMPRESS, .ZSTD_DECOMPRESS => {},
        }
    }

    fn doWorkDeflate(this: *Context) void {
        this.err = c.deflate(&this.state, this.flush);
    }

    fn doWorkInflate(this: *Context) void {
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

    pub fn updateWriteResult(this: *Context, avail_in: *u32, avail_out: *u32) void {
        avail_in.* = this.state.avail_in;
        avail_out.* = this.state.avail_out;
    }

    pub fn getErrorInfo(this: *Context) Error {
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

    pub fn close(this: *Context) void {
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
            .ZSTD_COMPRESS, .ZSTD_DECOMPRESS => {},
        }
        bun.assert(status == .Ok or status == .DataError);
        this.mode = .NONE;
    }
};
