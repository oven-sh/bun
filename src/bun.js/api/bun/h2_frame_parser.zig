const getAllocator = @import("../../base.zig").getAllocator;
const bun = @import("root").bun;
const Output = bun.Output;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = bun.JSC;
const MutableString = bun.MutableString;
const native_endian = @import("builtin").target.cpu.arch.endian();

const JSValue = JSC.JSValue;

const BinaryType = JSC.BinaryType;

const FrameType = enum(u8) {
    HTTP_FRAME_DATA = 0x00,
    HTTP_FRAME_HEADERS = 0x01,
    HTTP_FRAME_PRIORITY = 0x02,
    HTTP_FRAME_RST_STREAM = 0x03,
    HTTP_FRAME_SETTINGS = 0x04,
    HTTP_FRAME_PUSH_PROMISE = 0x05,
    HTTP_FRAME_PING = 0x06,
    HTTP_FRAME_GOAWAY = 0x07,
    HTTP_FRAME_WINDOW_UPDATE = 0x08,
    HTTP_FRAME_CONTINUATION = 0x09,
};

const ErrorCode = enum(u32) {
    NO_ERROR = 0x0,
    PROTOCOL_ERROR = 0x1,
    INTERNAL_ERROR = 0x2,
    FLOW_CONTROL_ERROR = 0x3,
    SETTINGS_TIMEOUT = 0x4,
    STREAM_CLOSED = 0x5,
    FRAME_SIZE_ERROR = 0x6,
    REFUSED_STREAM = 0x7,
    CANCEL = 0x8,
    COMPRESSION_ERROR = 0x9,
    CONNECT_ERROR = 0xa,
    ENHANCE_YOUR_CALM = 0xb,
    INADEQUATE_SECURITY = 0xc,
    HTTP_1_1_REQUIRED = 0xd,
};

const SettingsType = enum(u16) {
    SETTINGS_HEADER_TABLE_SIZE = 0x1,
    SETTINGS_ENABLE_PUSH = 0x2,
    SETTINGS_MAX_CONCURRENT_STREAMS = 0x3,
    SETTINGS_INITIAL_WINDOW_SIZE = 0x4,
    SETTINGS_MAX_FRAME_SIZE = 0x5,
    SETTINGS_MAX_HEADER_LIST_SIZE = 0x6,
};

const UInt31WithReserved = packed struct(u32) {
    reserved: bool = false,
    uint31: u31 = 0,

    pub fn from(value: u32) UInt31WithReserved {
        return @bitCast(value);
    }
};

const FrameHeader = packed struct(u72) {
    length: u24 = 0,
    type: u8 = @intFromEnum(FrameType.HTTP_FRAME_SETTINGS),
    flags: u8 = 0,
    streamIdentifier: u32 = 0,

    pub const byteSize: usize = 9;
    pub inline fn write(this: *FrameHeader, comptime Writer: type, writer: Writer) void {
        var swap = this.*;
        if (native_endian != .Big) {
            std.mem.byteSwapAllFields(FrameHeader, &swap);
        }

        _ = writer.write(std.mem.asBytes(&swap)[0..FrameHeader.byteSize]) catch 0;
    }

    pub inline fn from(dst: *FrameHeader, src: []const u8, offset: usize, comptime end: bool) void {
        @memcpy(@as(*[FrameHeader.byteSize]u8, @ptrCast(dst))[offset .. src.len + offset], src);
        if (comptime end) {
            if (native_endian != .Big) {
                std.mem.byteSwapAllFields(FrameHeader, dst);
            }
        }
    }
};

const SettingsPayloadUnit = packed struct(u48) {
    type: u16,
    value: u32,
    pub const byteSize: usize = 6;
    pub inline fn from(dst: *SettingsPayloadUnit, src: []const u8, offset: usize, comptime end: bool) void {
        @memcpy(@as(*[SettingsPayloadUnit.byteSize]u8, @ptrCast(dst))[offset .. src.len + offset], src);
        if (comptime end) {
            if (native_endian != .Big) {
                std.mem.byteSwapAllFields(SettingsPayloadUnit, dst);
            }
        }
    }
};

const FullSettingsPayload = packed struct(u288) {
    _headerTableSizeType: u16 = @intFromEnum(SettingsType.SETTINGS_HEADER_TABLE_SIZE),
    headerTableSize: u32 = 4096,
    _enablePushType: u16 = @intFromEnum(SettingsType.SETTINGS_ENABLE_PUSH),
    enablePush: u32 = 1,
    _maxConcurrentStreamsType: u16 = @intFromEnum(SettingsType.SETTINGS_MAX_CONCURRENT_STREAMS),
    maxConcurrentStreams: u32 = 100,
    _initialWindowSizeType: u16 = @intFromEnum(SettingsType.SETTINGS_INITIAL_WINDOW_SIZE),
    initialWindowSize: u32 = 65535,
    _maxFrameSizeType: u16 = @intFromEnum(SettingsType.SETTINGS_MAX_FRAME_SIZE),
    maxFrameSize: u32 = 16384,
    _maxHeaderListSizeType: u16 = @intFromEnum(SettingsType.SETTINGS_MAX_HEADER_LIST_SIZE),
    maxHeaderListSize: u32 = 65535,

    pub const byteSize: usize = 36;
    pub fn toJS(this: *FullSettingsPayload, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        var result = JSValue.createEmptyObject(globalObject, 6);
        result.put(globalObject, JSC.ZigString.static("headerTableSize"), JSC.JSValue.jsNumber(this.headerTableSize));
        result.put(globalObject, JSC.ZigString.static("enablePush"), JSC.JSValue.jsNumber(this.enablePush));
        result.put(globalObject, JSC.ZigString.static("maxConcurrentStreams"), JSC.JSValue.jsNumber(this.maxConcurrentStreams));
        result.put(globalObject, JSC.ZigString.static("initialWindowSize"), JSC.JSValue.jsNumber(this.initialWindowSize));
        result.put(globalObject, JSC.ZigString.static("maxFrameSize"), JSC.JSValue.jsNumber(this.maxFrameSize));
        result.put(globalObject, JSC.ZigString.static("maxHeaderListSize"), JSC.JSValue.jsNumber(this.maxHeaderListSize));

        return result;
    }

    pub fn updateWith(this: *FullSettingsPayload, option: SettingsPayloadUnit) void {
        switch (option.type) {
            .SETTINGS_HEADER_TABLE_SIZE => this.headerTableSize = option.value,
            .SETTINGS_ENABLE_PUSH => this.enablePush = option.value,
            .SETTINGS_MAX_CONCURRENT_STREAMS => this.maxConcurrentStreams = option.value,
            .SETTINGS_INITIAL_WINDOW_SIZE => this.initialWindowSize = option.value,
            .SETTINGS_MAX_FRAME_SIZE => this.maxFrameSize = option.value,
            .SETTINGS_MAX_HEADER_LIST_SIZE => this.maxHeaderListSize = option.value,
        }
    }
    pub fn write(this: *FullSettingsPayload, comptime Writer: type, writer: Writer) void {
        var swap = this.*;

        if (native_endian != .Big) {
            std.mem.byteSwapAllFields(FullSettingsPayload, &swap);
        }
        _ = writer.write(std.mem.asBytes(&swap)[0..FullSettingsPayload.byteSize]) catch 0;
    }
};

const Handlers = struct {
    onError: JSC.JSValue = .zero,
    onWrite: JSC.JSValue = .zero,
    onStreamError: JSC.JSValue = .zero,
    onStreamStart: JSC.JSValue = .zero,
    onStreamHeaders: JSC.JSValue = .zero,
    onStreamEnd: JSC.JSValue = .zero,
    onStreamData: JSC.JSValue = .zero,
    onRemoteSettings: JSC.JSValue = .zero,
    onLocalSettings: JSC.JSValue = .zero,
    binary_type: BinaryType = .Buffer,

    vm: *JSC.VirtualMachine,
    globalObject: *JSC.JSGlobalObject,

    pub fn callEventHandler(this: *Handlers, comptime event: []const u8, thisValue: JSValue, data: []const JSValue) bool {
        const callback = @field(this, event);
        if (callback == .zero) {
            return false;
        }

        const result = callback.callWithThis(this.globalObject, thisValue, data);
        if (result.isAnyError()) {
            this.vm.onUnhandledError(this.globalObject, result);
        }

        return true;
    }

    pub fn callErrorHandler(this: *Handlers, thisValue: JSValue, err: []const JSValue) bool {
        const onError = this.onError;
        if (onError == .zero) {
            if (err.len > 0)
                this.vm.onUnhandledError(this.globalObject, err[0]);

            return false;
        }

        const result = onError.callWithThis(this.globalObject, thisValue, err);
        if (result.isAnyError()) {
            this.vm.onUnhandledError(this.globalObject, result);
        }

        return true;
    }

    pub fn fromJS(globalObject: *JSC.JSGlobalObject, opts: JSC.JSValue, exception: JSC.C.ExceptionRef) ?Handlers {
        var handlers = Handlers{
            .vm = globalObject.bunVM(),
            .globalObject = globalObject,
        };

        if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
            exception.* = JSC.toInvalidArguments("Expected \"handlers\" to be an object", .{}, globalObject).asObjectRef();
            return null;
        }

        const pairs = .{
            .{ "onStreamStart", "streamStart" },
            .{ "onStreamHeaders", "streamHeaders" },
            .{ "onStreamEnd", "streamEnd" },
            .{ "onStreamData", "streamData" },
            .{ "onStreamError", "streamError" },
            .{ "onRemoteSettings", "remoteSettings" },
            .{ "onLocalSettings", "localSettings" },
            .{ "onError", "error" },
            .{ "onWrite", "write" },
        };
        inline for (pairs) |pair| {
            if (opts.getTruthy(globalObject, pair.@"1")) |callback_value| {
                if (!callback_value.isCell() or !callback_value.isCallable(globalObject.vm())) {
                    exception.* = JSC.toInvalidArguments(comptime std.fmt.comptimePrint("Expected \"{s}\" callback to be a function", .{pair.@"1"}), .{}, globalObject).asObjectRef();
                    return null;
                }

                @field(handlers, pair.@"0") = callback_value;
            }
        }

        if (handlers.onWrite == .zero) {
            exception.* = JSC.toInvalidArguments("Expected at least \"write\" callback", .{}, globalObject).asObjectRef();
            return null;
        }

        if (opts.getTruthy(globalObject, "binaryType")) |binary_type_value| {
            if (!binary_type_value.isString()) {
                exception.* = JSC.toInvalidArguments("Expected \"binaryType\" to be a string", .{}, globalObject).asObjectRef();
                return null;
            }

            handlers.binary_type = BinaryType.fromJSValue(globalObject, binary_type_value) orelse {
                exception.* = JSC.toInvalidArguments("Expected 'binaryType' to be 'arraybuffer', 'uint8array', 'buffer'", .{}, globalObject).asObjectRef();
                return null;
            };
        }

        return handlers;
    }

    pub fn unprotect(this: *Handlers) void {
        this.onError.unprotect();
        this.onWrite.unprotect();
        this.onStreamError.unprotect();
        this.onStreamStart.unprotect();
        this.onStreamHeaders.unprotect();
        this.onStreamEnd.unprotect();
        this.onStreamData.unprotect();
        this.onStreamError.unprotect();
        this.onLocalSettings.unprotect();
        this.onRemoteSettings.unprotect();
    }

    pub fn clear(this: *Handlers) void {
        this.onError = .zero;
        this.onWrite = .zero;
        this.onStreamError = .zero;
        this.onStreamStart = .zero;
        this.onStreamHeaders = .zero;
        this.onStreamEnd = .zero;
        this.onStreamData = .zero;
        this.onStreamError = .zero;
        this.onLocalSettings = .zero;
        this.onRemoteSettings = .zero;
    }

    pub fn protect(this: *Handlers) void {
        this.onError.protect();
        this.onWrite.protect();
        this.onStreamError.protect();
        this.onStreamStart.protect();
        this.onStreamHeaders.protect();
        this.onStreamEnd.protect();
        this.onStreamData.protect();
        this.onStreamError.protect();
        this.onLocalSettings.protect();
        this.onRemoteSettings.protect();
    }
};

pub const H2FrameParser = struct {
    pub const log = Output.scoped(.H2FrameParser, false);
    pub usingnamespace JSC.Codegen.JSH2FrameParser;

    strong_ctx: JSC.Strong = .{},
    allocator: Allocator,
    handlers: Handlers,
    localSettings: FullSettingsPayload = .{},
    // only available after receiving settings or ACK
    remoteSettings: ?FullSettingsPayload = null,
    // current frame being read
    currentFrame: ?FrameHeader = null,
    // remaining bytes to read for the current frame
    remainingLength: i32 = 0,
    // buffer if more data is needed for the current frame
    readBuffer: MutableString,

    pub fn dispatch(this: *H2FrameParser, comptime event: []const u8, value: JSC.JSValue) void {
        JSC.markBinding(@src());
        const ctx_value = this.strong_ctx.get() orelse JSC.JSValue.jsUndefined();
        value.ensureStillAlive();
        _ = this.handlers.callEvent(event, ctx_value, &[_]JSC.JSValue{ ctx_value, value });
    }

    pub fn write(this: *H2FrameParser, bytes: []const u8) void {
        JSC.markBinding(@src());
        log("write", .{});

        const output_value = this.handlers.binary_type.toJS(bytes, this.handlers.globalObject);
        this.dispatch(.onWrite, output_value);
    }

    pub fn detach(this: *H2FrameParser, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        JSC.markBinding(@src());
        log("detach", .{});
        var handler = this.handlers;
        defer handler.unprotect();
        this.handlers.clear();

        return JSC.JSValue.jsUndefined();
    }
    pub fn handleSettingsFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8) usize {
        if (frame.streamIdentifier != 0) {
            // this.#connection.write(createGoAwayFrameBuffer(this.#lastStreamID, ErrorCode.PROTOCOL_ERROR, Buffer.alloc(0)));

            //   throw new Error("PROTOCOL_ERROR");
            log("PROTOCOL_ERROR", .{});
            return data.len;
        }
        const settingByteSize = SettingsPayloadUnit.byteSize;
        if (frame.length > 0) {
            if (frame.flags & 0x1 or frame.length % settingByteSize != 0) {
                // this.#connection.write(
                //   createGoAwayFrameBuffer(this.#lastStreamID, ErrorCode.FRAME_SIZE_ERROR, Buffer.alloc(0)),
                // );
                log("FRAME_SIZE_ERROR", .{});
                return data.len;
            }
        } else {
            if (frame.flags & 0x1) {
                // we received an ACK
                this.remoteSettings = &this.localSettings;
                this.dispatch(.onLocalSettings, this.localSettings.toJS(this.handlers.globalObject));
            }
            return 0;
        }

        const end: i32 = @min(frame.remainingLength, data.len);
        const payload = data[0..end];
        this.remainingLength -= end;
        if (this.remainingLength > 0) {
            // buffer more data
            _ = this.readBuffer.appendSlice(payload) catch @panic("OOM");
            return data.len;
        } else if (this.remainingLength < 0) {
            // this.#connection.write(
            //   createGoAwayFrameBuffer(this.#lastStreamID, ErrorCode.FRAME_SIZE_ERROR, Buffer.alloc(0)),
            // );
            log("FRAME_SIZE_ERROR", .{});
            return data.len;
        }

        this.currentFrame = null;
        var remoteSettings = this.remoteSettings orelse this.localSettings;
        var i: usize = 0;
        while (i < payload.len) {
            defer i += settingByteSize;
            var unit: SettingsPayloadUnit = undefined;
            SettingsPayloadUnit.from(&unit, payload[i .. i + settingByteSize], 0, true);
            remoteSettings.updateWith(unit);
        }
        this.remoteSettings = remoteSettings;
        this.dispatch(.onRemoteSettings, remoteSettings.toJS(this.handlers.globalObject));

        // console.log(this.#settings);
        // this.#compressor = hpack.compressor.create({ table: { size: this.#settings.headerTableSize } });
        // this.#decompressor = hpack.decompressor.create({ table: { size: this.#settings.headerTableSize } });

        return end;
    }

    pub fn readBytes(this: *H2FrameParser, bytes: []u8) usize {
        log("read", .{});
        if (this.currentFrame) |header| {
            log("header {} {} {} {}", .{ header.type, header.length, header.flags, header.streamIdentifier });
            return bytes.len;
        }

        // nothing to do
        if (bytes.len == 0) return bytes.len;

        const buffered_data = this.readBuffer.list.items.len;

        var header: FrameHeader = undefined;
        // we can have less than 9 bytes buffered
        if (buffered_data > 0) {
            const total = buffered_data + bytes.len;
            if (total < FrameHeader.byteSize) {
                // buffer more data
                _ = this.readBuffer.appendSlice(bytes) catch @panic("OOM");
                return bytes.len;
            }
            FrameHeader.from(&header, this.readBuffer.list.items[0..buffered_data], 0, false);
            const needed = FrameHeader.byteSize - buffered_data;
            FrameHeader.from(&header, bytes[0..needed], buffered_data, true);
            // ignore the reserved bit
            const id = UInt31WithReserved.from(header.streamIdentifier);
            header.streamIdentifier = @intCast(id.uint31);
            // reset for later use
            this.readBuffer.reset();

            this.currentFrame = header;
            this.remainingLength = header.length;
            log("header {} {} {} {}", .{ header.type, header.length, header.flags, header.streamIdentifier });

            return switch (@as(FrameType, @enumFromInt(header.type))) {
                FrameType.HTTP_FRAME_SETTINGS => this.handleSettingsFrame(header, bytes[needed..]) + needed,
                else => {
                    log("not implemented {}", .{header.type});
                    return bytes.len;
                },
            };
        }

        if (bytes.len < FrameHeader.byteSize) {
            // buffer more dheaderata
            this.readBuffer.appendSlice(bytes) catch @panic("OOM");
            return bytes.len;
        }

        FrameHeader.from(&header, bytes[0..FrameHeader.byteSize], 0, true);

        log("header {} {} {} {}", .{ header.type, header.length, header.flags, header.streamIdentifier });
        this.currentFrame = header;
        this.remainingLength = header.length;
        return switch (@as(FrameType, @enumFromInt(header.type))) {
            FrameType.HTTP_FRAME_SETTINGS => this.handleSettingsFrame(header, bytes[FrameHeader.byteSize..]) + FrameHeader.byteSize,
            else => {
                log("not implemented {}", .{header.type});
                return bytes.len;
            },
        };
    }

    pub fn read(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(1);
        if (args_list.len < 1) {
            globalObject.throw("Expected 1 argument", .{});
            return .zero;
        }
        const buffer = args_list.ptr[0];
        if (buffer.asArrayBuffer(globalObject)) |array_buffer| {
            var bytes = array_buffer.slice();

            // read all the bytes
            while (bytes.len > 0) {
                const result = this.readBytes(bytes);
                if (result >= bytes.len) {
                    break;
                }
                bytes = bytes[result..];
            }
            return JSC.JSValue.jsUndefined();
        }
        globalObject.throw("Expected data to be a Buffer or ArrayBuffer", .{});
        return .zero;
    }

    pub fn constructor(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) ?*H2FrameParser {
        const args_list = callframe.arguments(1);
        if (args_list.len < 1) {
            globalObject.throw("Expected 1 argument", .{});
            return null;
        }

        const options = args_list.ptr[0];
        if (options.isEmptyOrUndefinedOrNull() or options.isBoolean() or !options.isObject()) {
            globalObject.throwInvalidArguments("expected options as argument", .{});
            return null;
        }

        var exception: JSC.C.JSValueRef = null;
        var context_obj = options.get(globalObject, "context") orelse {
            globalObject.throw("Expected \"context\" option", .{});
            return null;
        };
        const handlers = Handlers.fromJS(globalObject, options, &exception) orelse {
            globalObject.throwValue(exception.?.value());
            return null;
        };
        const allocator = getAllocator(globalObject);
        var this = allocator.create(H2FrameParser) catch unreachable;

        this.* = H2FrameParser{
            .handlers = handlers,
            .allocator = allocator,
            .readBuffer = .{
                .allocator = bun.default_allocator,
                .list = .{
                    .items = &.{},
                    .capacity = 0,
                },
            },
        };
        this.handlers.protect();

        this.strong_ctx.set(globalObject, context_obj);

        // PREFACE + Settings Frame
        var preface_buffer: [24 + FrameHeader.byteSize + FullSettingsPayload.byteSize]u8 = undefined;
        @memset(&preface_buffer, 0);
        var preface_stream = std.io.fixedBufferStream(&preface_buffer);
        const writer = preface_stream.writer();
        _ = writer.write("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n") catch 0;
        var settingsHeader: FrameHeader = .{
            .type = @intFromEnum(FrameType.HTTP_FRAME_SETTINGS),
            .flags = 0,
            .streamIdentifier = 0,
            .length = 36,
        };
        settingsHeader.write(@TypeOf(writer), writer);
        this.localSettings.write(@TypeOf(writer), writer);
        this.write(&preface_buffer);
        return this;
    }

    pub fn finalize(
        this: *H2FrameParser,
    ) callconv(.C) void {
        var allocator = this.allocator;
        this.strong_ctx.deinit();
        this.handlers.unprotect();
        this.readBuffer.deinit();
        allocator.destroy(this);
    }
};
