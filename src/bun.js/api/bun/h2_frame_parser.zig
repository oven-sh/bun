const getAllocator = @import("../../base.zig").getAllocator;
const bun = @import("root").bun;
const Output = bun.Output;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = bun.JSC;
const MutableString = bun.MutableString;
const lshpack = @import("./lshpack.zig");

const JSValue = JSC.JSValue;

const BinaryType = JSC.BinaryType;
const MAX_WINDOW_SIZE = 2147483647;
const MAX_HEADER_TABLE_SIZE = 4294967295;
const MAX_STREAM_ID = 2147483647;
const WINDOW_INCREMENT_SIZE = 65536;
const MAX_HPACK_HEADER_SIZE = 65536;
const MAX_FRAME_SIZE = 16777215;

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

const PingFrameFlags = enum(u8) {
    ACK = 0x1,
};
const DataFrameFlags = enum(u8) {
    END_STREAM = 0x1,
    PADDED = 0x8,
};
const HeadersFrameFlags = enum(u8) {
    END_STREAM = 0x1,
    END_HEADERS = 0x4,
    PADDED = 0x8,
    PRIORITY = 0x20,
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
    _, // we can have unsupported extension/custom error codes types
};

const SettingsType = enum(u16) {
    SETTINGS_HEADER_TABLE_SIZE = 0x1,
    SETTINGS_ENABLE_PUSH = 0x2,
    SETTINGS_MAX_CONCURRENT_STREAMS = 0x3,
    SETTINGS_INITIAL_WINDOW_SIZE = 0x4,
    SETTINGS_MAX_FRAME_SIZE = 0x5,
    SETTINGS_MAX_HEADER_LIST_SIZE = 0x6,

    // non standard extension settings here (we still dont support this ones)
    SETTINGS_ENABLE_CONNECT_PROTOCOL = 0x8,
    SETTINGS_NO_RFC7540_PRIORITIES = 0x9,
    _, // we can have more unsupported extension settings types
};

const UInt31WithReserved = packed struct(u32) {
    reserved: bool = false,
    uint31: u31 = 0,

    pub fn from(value: u32) UInt31WithReserved {
        return @bitCast(value);
    }

    pub fn toUInt32(value: UInt31WithReserved) u32 {
        return @bitCast(value);
    }

    pub inline fn fromBytes(src: []const u8) UInt31WithReserved {
        var dst: u32 = 0;
        @memcpy(@as(*[4]u8, @ptrCast(&dst)), src);
        dst = @byteSwap(dst);
        return @bitCast(dst);
    }

    pub inline fn write(this: UInt31WithReserved, comptime Writer: type, writer: Writer) void {
        var value: u32 = @bitCast(this);
        value = @byteSwap(value);

        _ = writer.write(std.mem.asBytes(&value)) catch 0;
    }
};

const StreamPriority = packed struct(u40) {
    streamIdentifier: u32 = 0,
    weight: u8 = 0,

    pub const byteSize: usize = 5;
    pub inline fn write(this: *StreamPriority, comptime Writer: type, writer: Writer) void {
        var swap = this.*;
        std.mem.byteSwapAllFields(StreamPriority, &swap);

        _ = writer.write(std.mem.asBytes(&swap)[0..StreamPriority.byteSize]) catch 0;
    }

    pub inline fn from(dst: *StreamPriority, src: []const u8) void {
        @memcpy(@as(*[StreamPriority.byteSize]u8, @ptrCast(dst)), src);
        std.mem.byteSwapAllFields(StreamPriority, dst);
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
        std.mem.byteSwapAllFields(FrameHeader, &swap);

        _ = writer.write(std.mem.asBytes(&swap)[0..FrameHeader.byteSize]) catch 0;
    }

    pub inline fn from(dst: *FrameHeader, src: []const u8, offset: usize, comptime end: bool) void {
        @memcpy(@as(*[FrameHeader.byteSize]u8, @ptrCast(dst))[offset .. src.len + offset], src);
        if (comptime end) {
            std.mem.byteSwapAllFields(FrameHeader, dst);
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
            std.mem.byteSwapAllFields(SettingsPayloadUnit, dst);
        }
    }
};

const FullSettingsPayload = packed struct(u288) {
    _headerTableSizeType: u16 = @intFromEnum(SettingsType.SETTINGS_HEADER_TABLE_SIZE),
    headerTableSize: u32 = 4096,
    _enablePushType: u16 = @intFromEnum(SettingsType.SETTINGS_ENABLE_PUSH),
    enablePush: u32 = 1,
    _maxConcurrentStreamsType: u16 = @intFromEnum(SettingsType.SETTINGS_MAX_CONCURRENT_STREAMS),
    maxConcurrentStreams: u32 = 2147483647,
    _initialWindowSizeType: u16 = @intFromEnum(SettingsType.SETTINGS_INITIAL_WINDOW_SIZE),
    initialWindowSize: u32 = 65535,
    _maxFrameSizeType: u16 = @intFromEnum(SettingsType.SETTINGS_MAX_FRAME_SIZE),
    maxFrameSize: u32 = 16384,
    _maxHeaderListSizeType: u16 = @intFromEnum(SettingsType.SETTINGS_MAX_HEADER_LIST_SIZE),
    maxHeaderListSize: u32 = 65535,
    pub const byteSize: usize = 36;
    pub fn toJS(this: *FullSettingsPayload, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        var result = JSValue.createEmptyObject(globalObject, 8);
        result.put(globalObject, JSC.ZigString.static("headerTableSize"), JSC.JSValue.jsNumber(this.headerTableSize));
        result.put(globalObject, JSC.ZigString.static("enablePush"), JSC.JSValue.jsBoolean(this.enablePush > 0));
        result.put(globalObject, JSC.ZigString.static("maxConcurrentStreams"), JSC.JSValue.jsNumber(this.maxConcurrentStreams));
        result.put(globalObject, JSC.ZigString.static("initialWindowSize"), JSC.JSValue.jsNumber(this.initialWindowSize));
        result.put(globalObject, JSC.ZigString.static("maxFrameSize"), JSC.JSValue.jsNumber(this.maxFrameSize));
        result.put(globalObject, JSC.ZigString.static("maxHeaderListSize"), JSC.JSValue.jsNumber(this.maxHeaderListSize));
        result.put(globalObject, JSC.ZigString.static("maxHeaderSize"), JSC.JSValue.jsNumber(this.maxHeaderListSize));
        // TODO: we dont support this setting yet see https://nodejs.org/api/http2.html#settings-object
        // we should also support customSettings
        result.put(globalObject, JSC.ZigString.static("enableConnectProtocol"), JSC.JSValue.jsBoolean(false));
        return result;
    }

    pub fn updateWith(this: *FullSettingsPayload, option: SettingsPayloadUnit) void {
        switch (@as(SettingsType, @enumFromInt(option.type))) {
            .SETTINGS_HEADER_TABLE_SIZE => this.headerTableSize = option.value,
            .SETTINGS_ENABLE_PUSH => this.enablePush = option.value,
            .SETTINGS_MAX_CONCURRENT_STREAMS => this.maxConcurrentStreams = option.value,
            .SETTINGS_INITIAL_WINDOW_SIZE => this.initialWindowSize = option.value,
            .SETTINGS_MAX_FRAME_SIZE => this.maxFrameSize = option.value,
            .SETTINGS_MAX_HEADER_LIST_SIZE => this.maxHeaderListSize = option.value,
            else => {}, // we ignore unknown/unsupportd settings its not relevant if we dont apply them
        }
    }
    pub fn write(this: *FullSettingsPayload, comptime Writer: type, writer: Writer) void {
        var swap = this.*;

        std.mem.byteSwapAllFields(FullSettingsPayload, &swap);
        _ = writer.write(std.mem.asBytes(&swap)[0..FullSettingsPayload.byteSize]) catch 0;
    }
};
const ValidPseudoHeaders = bun.ComptimeStringMap(void, .{
    .{":status"},
    .{":method"},
    .{":authority"},
    .{":scheme"},
    .{":path"},
    .{":protocol"},
});
const ValidRequestPseudoHeaders = bun.ComptimeStringMap(void, .{
    .{":method"},
    .{":authority"},
    .{":scheme"},
    .{":path"},
    .{":protocol"},
});

const SingleValueHeaders = bun.ComptimeStringMap(void, .{
    .{":status"},
    .{":method"},
    .{":authority"},
    .{":scheme"},
    .{":path"},
    .{":protocol"},
    .{"access-control-allow-credentials"},
    .{"access-control-max-age"},
    .{"access-control-request-method"},
    .{"age"},
    .{"authorization"},
    .{"content-encoding"},
    .{"content-language"},
    .{"content-length"},
    .{"content-location"},
    .{"content-md5"},
    .{"content-range"},
    .{"content-type"},
    .{"date"},
    .{"dnt"},
    .{"etag"},
    .{"expires"},
    .{"from"},
    .{"host"},
    .{"if-match"},
    .{"if-modified-since"},
    .{"if-none-match"},
    .{"if-range"},
    .{"if-unmodified-since"},
    .{"last-modified"},
    .{"location"},
    .{"max-forwards"},
    .{"proxy-authorization"},
    .{"range"},
    .{"referer"},
    .{"retry-after"},
    .{"tk"},
    .{"upgrade-insecure-requests"},
    .{"user-agent"},
    .{"x-content-type-options"},
});

fn jsGetUnpackedSettings(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {
    JSC.markBinding(@src());
    var settings: FullSettingsPayload = .{};

    const args_list = callframe.arguments(1);
    if (args_list.len < 1) {
        return settings.toJS(globalObject);
    }

    const data_arg = args_list.ptr[0];

    if (data_arg.asArrayBuffer(globalObject)) |array_buffer| {
        var payload = array_buffer.byteSlice();
        const settingByteSize = SettingsPayloadUnit.byteSize;
        if (payload.len < settingByteSize or payload.len % settingByteSize != 0) {
            globalObject.throw("Expected buf to be a Buffer of at least 6 bytes and a multiple of 6 bytes", .{});
            return .zero;
        }

        var i: usize = 0;
        while (i < payload.len) {
            defer i += settingByteSize;
            var unit: SettingsPayloadUnit = undefined;
            SettingsPayloadUnit.from(&unit, payload[i .. i + settingByteSize], 0, true);
            settings.updateWith(unit);
        }
        return settings.toJS(globalObject);
    } else if (!data_arg.isEmptyOrUndefinedOrNull()) {
        globalObject.throw("Expected buf to be a Buffer", .{});
        return .zero;
    } else {
        return settings.toJS(globalObject);
    }
}

fn jsGetPackedSettings(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSValue {
    var settings: FullSettingsPayload = .{};
    const args_list = callframe.arguments(1);

    if (args_list.len > 0 and !args_list.ptr[0].isEmptyOrUndefinedOrNull()) {
        const options = args_list.ptr[0];

        if (!options.isObject()) {
            globalObject.throw("Expected settings to be a object", .{});
            return .zero;
        }

        if (options.get(globalObject, "headerTableSize")) |headerTableSize| {
            if (headerTableSize.isNumber()) {
                const headerTableSizeValue = headerTableSize.toInt32();
                if (headerTableSizeValue > MAX_HEADER_TABLE_SIZE or headerTableSizeValue < 0) {
                    globalObject.throw("Expected headerTableSize to be a number between 0 and 2^32-1", .{});
                    return .zero;
                }
                settings.headerTableSize = @intCast(headerTableSizeValue);
            } else if (!headerTableSize.isEmptyOrUndefinedOrNull()) {
                globalObject.throw("Expected headerTableSize to be a number", .{});
                return .zero;
            }
        }

        if (options.get(globalObject, "enablePush")) |enablePush| {
            if (enablePush.isBoolean()) {
                settings.enablePush = if (enablePush.asBoolean()) 1 else 0;
            } else if (!enablePush.isEmptyOrUndefinedOrNull()) {
                globalObject.throw("Expected enablePush to be a boolean", .{});
                return .zero;
            }
        }

        if (options.get(globalObject, "initialWindowSize")) |initialWindowSize| {
            if (initialWindowSize.isNumber()) {
                const initialWindowSizeValue = initialWindowSize.toInt32();
                if (initialWindowSizeValue > MAX_HEADER_TABLE_SIZE or initialWindowSizeValue < 0) {
                    globalObject.throw("Expected initialWindowSize to be a number between 0 and 2^32-1", .{});
                    return .zero;
                }
                settings.initialWindowSize = @intCast(initialWindowSizeValue);
            } else if (!initialWindowSize.isEmptyOrUndefinedOrNull()) {
                globalObject.throw("Expected initialWindowSize to be a number", .{});
                return .zero;
            }
        }

        if (options.get(globalObject, "maxFrameSize")) |maxFrameSize| {
            if (maxFrameSize.isNumber()) {
                const maxFrameSizeValue = maxFrameSize.toInt32();
                if (maxFrameSizeValue > MAX_FRAME_SIZE or maxFrameSizeValue < 16384) {
                    globalObject.throw("Expected maxFrameSize to be a number between 16,384 and 2^24-1", .{});
                    return .zero;
                }
                settings.maxFrameSize = @intCast(maxFrameSizeValue);
            } else if (!maxFrameSize.isEmptyOrUndefinedOrNull()) {
                globalObject.throw("Expected maxFrameSize to be a number", .{});
                return .zero;
            }
        }

        if (options.get(globalObject, "maxConcurrentStreams")) |maxConcurrentStreams| {
            if (maxConcurrentStreams.isNumber()) {
                const maxConcurrentStreamsValue = maxConcurrentStreams.toInt32();
                if (maxConcurrentStreamsValue > MAX_HEADER_TABLE_SIZE or maxConcurrentStreamsValue < 0) {
                    globalObject.throw("Expected maxConcurrentStreams to be a number between 0 and 2^32-1", .{});
                    return .zero;
                }
                settings.maxConcurrentStreams = @intCast(maxConcurrentStreamsValue);
            } else if (!maxConcurrentStreams.isEmptyOrUndefinedOrNull()) {
                globalObject.throw("Expected maxConcurrentStreams to be a number", .{});
                return .zero;
            }
        }

        if (options.get(globalObject, "maxHeaderListSize")) |maxHeaderListSize| {
            if (maxHeaderListSize.isNumber()) {
                const maxHeaderListSizeValue = maxHeaderListSize.toInt32();
                if (maxHeaderListSizeValue > MAX_HEADER_TABLE_SIZE or maxHeaderListSizeValue < 0) {
                    globalObject.throw("Expected maxHeaderListSize to be a number between 0 and 2^32-1", .{});
                    return .zero;
                }
                settings.maxHeaderListSize = @intCast(maxHeaderListSizeValue);
            } else if (!maxHeaderListSize.isEmptyOrUndefinedOrNull()) {
                globalObject.throw("Expected maxHeaderListSize to be a number", .{});
                return .zero;
            }
        }

        if (options.get(globalObject, "maxHeaderSize")) |maxHeaderSize| {
            if (maxHeaderSize.isNumber()) {
                const maxHeaderSizeValue = maxHeaderSize.toInt32();
                if (maxHeaderSizeValue > MAX_HEADER_TABLE_SIZE or maxHeaderSizeValue < 0) {
                    globalObject.throw("Expected maxHeaderSize to be a number between 0 and 2^32-1", .{});
                    return .zero;
                }
                settings.maxHeaderListSize = @intCast(maxHeaderSizeValue);
            } else if (!maxHeaderSize.isEmptyOrUndefinedOrNull()) {
                globalObject.throw("Expected maxHeaderSize to be a number", .{});
                return .zero;
            }
        }
    }

    std.mem.byteSwapAllFields(FullSettingsPayload, &settings);
    const bytes = std.mem.asBytes(&settings)[0..FullSettingsPayload.byteSize];
    const binary_type: BinaryType = .Buffer;
    return binary_type.toJS(bytes, globalObject);
}

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
    onWantTrailers: JSC.JSValue = .zero,
    onPing: JSC.JSValue = .zero,
    onEnd: JSC.JSValue = .zero,
    onGoAway: JSC.JSValue = .zero,
    onAborted: JSC.JSValue = .zero,

    binary_type: BinaryType = .Buffer,

    vm: *JSC.VirtualMachine,
    globalObject: *JSC.JSGlobalObject,
    strong_ctx: JSC.Strong = .{},

    pub fn callEventHandler(this: *Handlers, comptime event: @Type(.EnumLiteral), thisValue: JSValue, data: []const JSValue) bool {
        const callback = @field(this, @tagName(event));
        if (callback == .zero) {
            return false;
        }

        this.vm.eventLoop().runCallback(callback, this.globalObject, thisValue, data);

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
            .{ "onWantTrailers", "wantTrailers" },
            .{ "onPing", "ping" },
            .{ "onEnd", "end" },
            .{ "onError", "error" },
            .{ "onGoAway", "goaway" },
            .{ "onAborted", "aborted" },
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

        handlers.strong_ctx.set(globalObject, opts);

        return handlers;
    }

    pub fn deinit(this: *Handlers) void {
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
        this.onWantTrailers = .zero;
        this.onPing = .zero;
        this.onEnd = .zero;
        this.onGoAway = .zero;
        this.onAborted = .zero;
        this.strong_ctx.deinit();
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
    // current window size for the connection
    windowSize: u32 = 65535,
    // used window size for the connection
    usedWindowSize: u32 = 0,
    lastStreamID: u32 = 0,
    firstSettingsACK: bool = false,
    // we buffer requests until we get the first settings ACK
    writeBuffer: bun.ByteList = .{},

    streams: bun.U32HashMap(Stream),

    hpack: ?*lshpack.HPACK = null,

    threadlocal var shared_request_buffer: [16384]u8 = undefined;

    const Stream = struct {
        id: u32 = 0,
        state: enum(u8) {
            IDLE = 1,
            RESERVED_LOCAL = 3,
            RESERVED_REMOTE = 4,
            OPEN = 2,
            HALF_CLOSED_LOCAL = 5,
            HALF_CLOSED_REMOTE = 6,
            CLOSED = 7,
        } = .IDLE,
        waitForTrailers: bool = false,
        endAfterHeaders: bool = false,
        isWaitingMoreHeaders: bool = false,
        padding: ?u8 = 0,
        rstCode: u32 = 0,
        streamDependency: u32 = 0,
        exclusive: bool = false,
        weight: u16 = 36,
        // current window size for the stream
        windowSize: u32 = 65535,
        // used window size for the stream
        usedWindowSize: u32 = 0,

        signal: ?*JSC.WebCore.AbortSignal = null,
        client: *H2FrameParser,

        pub fn init(streamIdentifier: u32, initialWindowSize: u32, client: *H2FrameParser) Stream {
            const stream = Stream{
                .id = streamIdentifier,
                .state = .OPEN,
                .windowSize = initialWindowSize,
                .usedWindowSize = 0,
                .weight = 36,
                .client = client,
            };
            return stream;
        }

        pub fn canReceiveData(this: *Stream) bool {
            return switch (this.state) {
                .IDLE, .RESERVED_LOCAL, .RESERVED_REMOTE, .OPEN, .HALF_CLOSED_LOCAL => false,
                .HALF_CLOSED_REMOTE, .CLOSED => true,
            };
        }

        pub fn canSendData(this: *Stream) bool {
            return switch (this.state) {
                .IDLE, .RESERVED_LOCAL, .RESERVED_REMOTE, .OPEN, .HALF_CLOSED_REMOTE => false,
                .HALF_CLOSED_LOCAL, .CLOSED => true,
            };
        }

        pub fn attachSignal(this: *Stream, signal: *JSC.WebCore.AbortSignal) void {
            this.signal = signal.ref().listen(Stream, this, Stream.abortListener);
        }

        pub fn abortListener(this: *Stream, reason: JSValue) void {
            log("abortListener", .{});
            reason.ensureStillAlive();
            if (this.canReceiveData() or this.canSendData()) {
                this.state = .CLOSED;
                this.client.endStream(this, .CANCEL);
                this.client.dispatchWithExtra(.onAborted, JSC.JSValue.jsNumber(this.id), reason);
            }
        }

        pub fn deinit(this: *Stream) void {
            if (this.signal) |signal| {
                this.signal = null;
                signal.detach(this);
            }
        }
    };

    const HeaderValue = lshpack.HPACK.DecodeResult;

    pub fn decode(this: *H2FrameParser, src_buffer: []const u8) !HeaderValue {
        if (this.hpack) |hpack| {
            return try hpack.decode(src_buffer);
        }
        return error.UnableToDecode;
    }

    pub fn encode(this: *H2FrameParser, dst_buffer: []u8, dst_offset: usize, name: []const u8, value: []const u8, never_index: bool) !usize {
        if (this.hpack) |hpack| {
            return try hpack.encode(name, value, never_index, dst_buffer, dst_offset);
        }
        return error.UnableToEncode;
    }

    /// Calculate the new window size for the connection and the stream
    /// https://datatracker.ietf.org/doc/html/rfc7540#section-6.9.1
    fn ajustWindowSize(this: *H2FrameParser, stream: ?*Stream, payloadSize: u32) void {
        this.usedWindowSize += payloadSize;
        if (this.usedWindowSize >= this.windowSize) {
            var increment_size: u32 = WINDOW_INCREMENT_SIZE;
            var new_size = this.windowSize +| increment_size;
            if (new_size > MAX_WINDOW_SIZE) {
                new_size = MAX_WINDOW_SIZE;
                increment_size = this.windowSize -| MAX_WINDOW_SIZE;
            }
            if (new_size == this.windowSize) {
                this.sendGoAway(0, .FLOW_CONTROL_ERROR, "Window size overflow", this.lastStreamID);
                return;
            }
            this.windowSize = new_size;
            this.sendWindowUpdate(0, UInt31WithReserved.from(increment_size));
        }

        if (stream) |s| {
            s.usedWindowSize += payloadSize;
            if (s.usedWindowSize >= s.windowSize) {
                var increment_size: u32 = WINDOW_INCREMENT_SIZE;
                var new_size = s.windowSize +| increment_size;
                if (new_size > MAX_WINDOW_SIZE) {
                    new_size = MAX_WINDOW_SIZE;
                    increment_size = s.windowSize -| MAX_WINDOW_SIZE;
                }
                s.windowSize = new_size;
                this.sendWindowUpdate(s.id, UInt31WithReserved.from(increment_size));
            }
        }
    }

    pub fn setSettings(this: *H2FrameParser, settings: FullSettingsPayload) void {
        var buffer: [FrameHeader.byteSize + FullSettingsPayload.byteSize]u8 = undefined;
        @memset(&buffer, 0);
        var stream = std.io.fixedBufferStream(&buffer);
        const writer = stream.writer();
        var settingsHeader: FrameHeader = .{
            .type = @intFromEnum(FrameType.HTTP_FRAME_SETTINGS),
            .flags = 0,
            .streamIdentifier = 0,
            .length = 36,
        };
        settingsHeader.write(@TypeOf(writer), writer);
        this.localSettings = settings;
        this.localSettings.write(@TypeOf(writer), writer);
        this.write(&buffer);
        this.ajustWindowSize(null, @intCast(buffer.len));
    }

    pub fn endStream(this: *H2FrameParser, stream: *Stream, rstCode: ErrorCode) void {
        var buffer: [FrameHeader.byteSize + 4]u8 = undefined;
        @memset(&buffer, 0);
        var writerStream = std.io.fixedBufferStream(&buffer);
        const writer = writerStream.writer();

        var frame: FrameHeader = .{
            .type = @intFromEnum(FrameType.HTTP_FRAME_RST_STREAM),
            .flags = 0,
            .streamIdentifier = stream.id,
            .length = 4,
        };
        frame.write(@TypeOf(writer), writer);
        var value: u32 = @intFromEnum(rstCode);
        stream.rstCode = value;
        value = @byteSwap(value);
        _ = writer.write(std.mem.asBytes(&value)) catch 0;

        stream.state = .CLOSED;
        if (rstCode == .NO_ERROR) {
            this.dispatchWithExtra(.onStreamEnd, JSC.JSValue.jsNumber(stream.id), .undefined);
        } else {
            this.dispatchWithExtra(.onStreamError, JSC.JSValue.jsNumber(stream.id), JSC.JSValue.jsNumber(@intFromEnum(rstCode)));
        }

        this.write(&buffer);
    }

    pub fn sendGoAway(this: *H2FrameParser, streamIdentifier: u32, rstCode: ErrorCode, debug_data: []const u8, lastStreamID: u32) void {
        var buffer: [FrameHeader.byteSize + 8]u8 = undefined;
        @memset(&buffer, 0);
        var stream = std.io.fixedBufferStream(&buffer);
        const writer = stream.writer();

        var frame: FrameHeader = .{
            .type = @intFromEnum(FrameType.HTTP_FRAME_GOAWAY),
            .flags = 0,
            .streamIdentifier = streamIdentifier,
            .length = @intCast(8 + debug_data.len),
        };
        frame.write(@TypeOf(writer), writer);
        var last_id = UInt31WithReserved.from(lastStreamID);
        last_id.write(@TypeOf(writer), writer);
        var value: u32 = @intFromEnum(rstCode);
        value = @byteSwap(value);
        _ = writer.write(std.mem.asBytes(&value)) catch 0;

        this.write(&buffer);
        if (debug_data.len > 0) {
            this.write(debug_data);
        }
        const chunk = this.handlers.binary_type.toJS(debug_data, this.handlers.globalObject);
        if (rstCode != .NO_ERROR) {
            this.dispatchWith2Extra(.onError, JSC.JSValue.jsNumber(@intFromEnum(rstCode)), JSC.JSValue.jsNumber(this.lastStreamID), chunk);
        }
        this.dispatchWithExtra(.onEnd, JSC.JSValue.jsNumber(this.lastStreamID), chunk);
    }

    pub fn sendPing(this: *H2FrameParser, ack: bool, payload: []const u8) void {
        var buffer: [FrameHeader.byteSize + 8]u8 = undefined;
        @memset(&buffer, 0);
        var stream = std.io.fixedBufferStream(&buffer);
        const writer = stream.writer();
        var frame = FrameHeader{
            .type = @intFromEnum(FrameType.HTTP_FRAME_PING),
            .flags = if (ack) @intFromEnum(PingFrameFlags.ACK) else 0,
            .streamIdentifier = 0,
            .length = 8,
        };
        frame.write(@TypeOf(writer), writer);
        _ = writer.write(payload) catch 0;
        this.write(&buffer);
    }

    pub fn sendPrefaceAndSettings(this: *H2FrameParser) void {
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
        this.ajustWindowSize(null, @intCast(preface_buffer.len));
    }

    pub fn sendWindowUpdate(this: *H2FrameParser, streamIdentifier: u32, windowSize: UInt31WithReserved) void {
        log("sendWindowUpdate stream {} size {}", .{ streamIdentifier, windowSize.uint31 });
        var buffer: [FrameHeader.byteSize + 4]u8 = undefined;
        @memset(&buffer, 0);
        var stream = std.io.fixedBufferStream(&buffer);
        const writer = stream.writer();
        var settingsHeader: FrameHeader = .{
            .type = @intFromEnum(FrameType.HTTP_FRAME_WINDOW_UPDATE),
            .flags = 0,
            .streamIdentifier = streamIdentifier,
            .length = 4,
        };
        settingsHeader.write(@TypeOf(writer), writer);
        // always clear reserved bit
        const cleanWindowSize: UInt31WithReserved = .{
            .reserved = false,
            .uint31 = windowSize.uint31,
        };
        cleanWindowSize.write(@TypeOf(writer), writer);
        this.write(&buffer);
    }

    pub fn dispatch(this: *H2FrameParser, comptime event: @Type(.EnumLiteral), value: JSC.JSValue) void {
        JSC.markBinding(@src());
        const ctx_value = this.strong_ctx.get() orelse return;
        value.ensureStillAlive();
        _ = this.handlers.callEventHandler(event, ctx_value, &[_]JSC.JSValue{ ctx_value, value });
    }

    pub fn dispatchWithExtra(this: *H2FrameParser, comptime event: @Type(.EnumLiteral), value: JSC.JSValue, extra: JSC.JSValue) void {
        JSC.markBinding(@src());
        const ctx_value = this.strong_ctx.get() orelse return;
        value.ensureStillAlive();
        extra.ensureStillAlive();
        _ = this.handlers.callEventHandler(event, ctx_value, &[_]JSC.JSValue{ ctx_value, value, extra });
    }

    pub fn dispatchWith2Extra(this: *H2FrameParser, comptime event: @Type(.EnumLiteral), value: JSC.JSValue, extra: JSC.JSValue, extra2: JSC.JSValue) void {
        JSC.markBinding(@src());
        const ctx_value = this.strong_ctx.get() orelse return;
        value.ensureStillAlive();
        extra.ensureStillAlive();
        extra2.ensureStillAlive();
        _ = this.handlers.callEventHandler(event, ctx_value, &[_]JSC.JSValue{ ctx_value, value, extra, extra2 });
    }

    fn bufferWrite(this: *H2FrameParser, bytes: []const u8) void {
        log("bufferWrite", .{});
        _ = this.writeBuffer.write(this.allocator, bytes) catch 0;
    }

    pub fn write(this: *H2FrameParser, bytes: []const u8) void {
        JSC.markBinding(@src());
        log("write", .{});
        const output_value = this.handlers.binary_type.toJS(bytes, this.handlers.globalObject);
        this.dispatch(.onWrite, output_value);
    }

    const Payload = struct {
        data: []const u8,
        end: usize,
    };

    // Default handling for payload is buffering it
    // for data frames we use another strategy
    pub fn handleIncommingPayload(this: *H2FrameParser, data: []const u8, streamIdentifier: u32) ?Payload {
        const end: usize = @min(@as(usize, @intCast(this.remainingLength)), data.len);
        const payload = data[0..end];
        this.remainingLength -= @intCast(end);
        if (this.remainingLength > 0) {
            // buffer more data
            _ = this.readBuffer.appendSlice(payload) catch bun.outOfMemory();
            return null;
        } else if (this.remainingLength < 0) {
            this.sendGoAway(streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "Invalid frame size", this.lastStreamID);
            return null;
        }

        this.currentFrame = null;

        if (this.readBuffer.list.items.len > 0) {
            // return buffered data
            _ = this.readBuffer.appendSlice(payload) catch bun.outOfMemory();
            return .{
                .data = this.readBuffer.list.items,
                .end = end,
            };
        }

        return .{
            .data = payload,
            .end = end,
        };
    }

    pub fn handleWindowUpdateFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream: ?*Stream) usize {
        // must be always 4 bytes (https://datatracker.ietf.org/doc/html/rfc7540#section-6.9)
        if (frame.length != 4) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "Invalid dataframe frame size", this.lastStreamID);
            return data.len;
        }

        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            const payload = content.data;
            const windowSizeIncrement = UInt31WithReserved.fromBytes(payload);
            this.readBuffer.reset();
            // we automatically send a window update when receiving one
            this.sendWindowUpdate(frame.streamIdentifier, windowSizeIncrement);
            if (stream) |s| {
                s.windowSize += windowSizeIncrement.uint31;
            } else {
                this.windowSize += windowSizeIncrement.uint31;
            }
            log("windowSizeIncrement stream {} value {}", .{ frame.streamIdentifier, windowSizeIncrement.uint31 });
            return content.end;
        }
        // needs more data
        return data.len;
    }

    pub fn decodeHeaderBlock(this: *H2FrameParser, payload: []const u8, stream_id: u32, flags: u8) void {
        log("decodeHeaderBlock", .{});

        var offset: usize = 0;

        const globalObject = this.handlers.globalObject;

        const headers = JSC.JSValue.createEmptyObject(globalObject, 0);
        while (true) {
            const header = this.decode(payload[offset..]) catch break;
            offset += header.next;
            log("header {s} {s}", .{ header.name, header.value });

            if (headers.getTruthy(globalObject, header.name)) |current_value| {
                // Duplicated of single value headers are discarded
                if (SingleValueHeaders.has(header.name)) {
                    continue;
                }

                const value = JSC.ZigString.fromUTF8(header.value).toJS(globalObject);

                if (current_value.jsType().isArray()) {
                    current_value.push(globalObject, value);
                } else {
                    const array = JSC.JSValue.createEmptyArray(globalObject, 2);
                    array.putIndex(globalObject, 0, current_value);
                    array.putIndex(globalObject, 1, value);
                    // TODO: check for well-known headers and use pre-allocated static strings (see lshpack.c)
                    const name = JSC.ZigString.fromUTF8(header.name);
                    headers.put(globalObject, &name, array);
                }
            } else {
                // TODO: check for well-known headers and use pre-allocated static strings (see lshpack.c)
                const name = JSC.ZigString.fromUTF8(header.name);
                const value = JSC.ZigString.fromUTF8(header.value).toJS(globalObject);
                headers.put(globalObject, &name, value);
            }

            if (offset >= payload.len) {
                break;
            }
        }

        this.dispatchWith2Extra(.onStreamHeaders, JSC.JSValue.jsNumber(stream_id), headers, JSC.JSValue.jsNumber(flags));
    }

    pub fn handleDataFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream_: ?*Stream) usize {
        var stream = stream_ orelse {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Data frame on connection stream", this.lastStreamID);
            return data.len;
        };

        const settings = this.remoteSettings orelse this.localSettings;

        if (frame.length > settings.maxFrameSize) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "Invalid dataframe frame size", this.lastStreamID);
            return data.len;
        }

        // we actually dont want to process any if endAfterHeaders is set
        if (stream.endAfterHeaders) {
            return data.len;
        }
        this.readBuffer.reset();

        const end: usize = @min(@as(usize, @intCast(this.remainingLength)), data.len);
        var payload = data[0..end];

        var data_needed: isize = this.remainingLength;

        this.remainingLength -= @intCast(end);
        var padding: u8 = 0;
        if (frame.flags & @intFromEnum(DataFrameFlags.PADDED) != 0) {
            if (stream.padding) |p| {
                padding = p;
            } else {
                if (payload.len == 0) {
                    // await more data because we need to know the padding length
                    return data.len;
                }
                padding = payload[0];
                stream.padding = payload[0];
                payload = payload[1..];
            }
        }

        if (this.remainingLength < 0) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "Invalid data frame size", this.lastStreamID);
            return data.len;
        }

        // ignore padding
        if (data_needed > padding) {
            data_needed -= padding;
            payload = payload[0..@min(@as(usize, @intCast(data_needed)), payload.len)];
            const chunk = this.handlers.binary_type.toJS(payload, this.handlers.globalObject);
            this.dispatchWithExtra(.onStreamData, JSC.JSValue.jsNumber(frame.streamIdentifier), chunk);
        } else {
            data_needed = 0;
        }

        if (this.remainingLength == 0) {
            this.currentFrame = null;
            if (frame.flags & @intFromEnum(DataFrameFlags.END_STREAM) != 0) {
                stream.state = .HALF_CLOSED_REMOTE;
                this.dispatch(.onStreamEnd, JSC.JSValue.jsNumber(frame.streamIdentifier));
            }
        }

        return end;
    }
    pub fn handleGoAwayFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream_: ?*Stream) usize {
        if (stream_ != null) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "GoAway frame on stream", this.lastStreamID);
            return data.len;
        }
        const settings = this.remoteSettings orelse this.localSettings;

        if (frame.length < 8 or frame.length > settings.maxFrameSize) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "invalid GoAway frame size", this.lastStreamID);
            return data.len;
        }

        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            const payload = content.data;
            const last_stream_id: u32 = @intCast(UInt31WithReserved.fromBytes(payload[0..4]).uint31);
            const error_code = UInt31WithReserved.fromBytes(payload[4..8]).toUInt32();
            const chunk = this.handlers.binary_type.toJS(payload[8..], this.handlers.globalObject);
            this.readBuffer.reset();
            if (error_code != @intFromEnum(ErrorCode.NO_ERROR)) {
                this.dispatchWith2Extra(.onGoAway, JSC.JSValue.jsNumber(error_code), JSC.JSValue.jsNumber(last_stream_id), chunk);
            } else {
                this.dispatchWithExtra(.onGoAway, JSC.JSValue.jsNumber(last_stream_id), chunk);
            }
            return content.end;
        }
        return data.len;
    }
    pub fn handleRSTStreamFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream_: ?*Stream) usize {
        var stream = stream_ orelse {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "RST_STREAM frame on connection stream", this.lastStreamID);
            return data.len;
        };

        if (frame.length != 4) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "invalid RST_STREAM frame size", this.lastStreamID);
            return data.len;
        }

        if (stream.isWaitingMoreHeaders) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Headers frame without continuation", this.lastStreamID);
            return data.len;
        }

        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            const payload = content.data;
            const rst_code = UInt31WithReserved.fromBytes(payload).toUInt32();
            stream.rstCode = rst_code;
            this.readBuffer.reset();
            if (rst_code != @intFromEnum(ErrorCode.NO_ERROR)) {
                this.dispatchWithExtra(.onStreamError, JSC.JSValue.jsNumber(stream.id), JSC.JSValue.jsNumber(rst_code));
            }
            this.endStream(stream, ErrorCode.NO_ERROR);

            return content.end;
        }
        return data.len;
    }
    pub fn handlePingFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream_: ?*Stream) usize {
        if (stream_ != null) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Ping frame on stream", this.lastStreamID);
            return data.len;
        }

        if (frame.length != 8) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "Invalid ping frame size", this.lastStreamID);
            return data.len;
        }

        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            const payload = content.data;
            const isNotACK = frame.flags & @intFromEnum(PingFrameFlags.ACK) == 0;
            // if is not ACK send response
            if (isNotACK) {
                this.sendPing(true, payload);
            }
            const buffer = this.handlers.binary_type.toJS(payload, this.handlers.globalObject);
            this.readBuffer.reset();
            this.dispatchWithExtra(.onPing, buffer, JSC.JSValue.jsBoolean(!isNotACK));
            return content.end;
        }
        return data.len;
    }
    pub fn handlePriorityFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream_: ?*Stream) usize {
        var stream = stream_ orelse {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Priority frame on connection stream", this.lastStreamID);
            return data.len;
        };

        if (frame.length != StreamPriority.byteSize) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "invalid Priority frame size", this.lastStreamID);
            return data.len;
        }

        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            const payload = content.data;

            var priority: StreamPriority = undefined;
            priority.from(payload);

            const stream_identifier = UInt31WithReserved.from(priority.streamIdentifier);
            stream.streamDependency = stream_identifier.uint31;
            stream.exclusive = stream_identifier.reserved;
            stream.weight = priority.weight;

            this.readBuffer.reset();
            return content.end;
        }
        return data.len;
    }
    pub fn handleContinuationFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream_: ?*Stream) usize {
        var stream = stream_ orelse {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Continuation on connection stream", this.lastStreamID);
            return data.len;
        };

        if (!stream.isWaitingMoreHeaders) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Continuation without headers", this.lastStreamID);
            return data.len;
        }
        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            const payload = content.data;
            this.decodeHeaderBlock(payload[0..payload.len], stream.id, frame.flags);
            this.readBuffer.reset();
            if (frame.flags & @intFromEnum(HeadersFrameFlags.END_HEADERS) != 0) {
                if (stream.state == .HALF_CLOSED_REMOTE) {
                    // no more continuation headers we can call it closed
                    stream.state = .CLOSED;
                    this.dispatch(.onStreamEnd, JSC.JSValue.jsNumber(frame.streamIdentifier));
                }
                stream.isWaitingMoreHeaders = false;
            }

            return content.end;
        }

        // needs more data
        return data.len;
    }

    pub fn handleHeadersFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream_: ?*Stream) usize {
        var stream = stream_ orelse {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Headers frame on connection stream", this.lastStreamID);
            return data.len;
        };

        const settings = this.remoteSettings orelse this.localSettings;
        if (frame.length > settings.maxFrameSize) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "invalid Headers frame size", this.lastStreamID);
            return data.len;
        }

        if (stream.isWaitingMoreHeaders) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Headers frame without continuation", this.lastStreamID);
            return data.len;
        }

        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            const payload = content.data;
            var offset: usize = 0;
            var padding: usize = 0;
            if (frame.flags & @intFromEnum(HeadersFrameFlags.PADDED) != 0) {
                // padding length
                padding = payload[0];
                offset += 1;
            }
            if (frame.flags & @intFromEnum(HeadersFrameFlags.PRIORITY) != 0) {
                // skip priority (client dont need to care about it)
                offset += 5;
            }
            const end = payload.len - padding;
            if (offset > end) {
                this.readBuffer.reset();
                this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "invalid Headers frame size", this.lastStreamID);
                return data.len;
            }
            this.decodeHeaderBlock(payload[offset..end], stream.id, frame.flags);
            this.readBuffer.reset();
            stream.isWaitingMoreHeaders = frame.flags & @intFromEnum(HeadersFrameFlags.END_HEADERS) == 0;
            if (frame.flags & @intFromEnum(HeadersFrameFlags.END_STREAM) != 0) {
                if (stream.isWaitingMoreHeaders) {
                    stream.state = .HALF_CLOSED_REMOTE;
                } else {
                    // no more continuation headers we can call it closed
                    stream.state = .CLOSED;
                    this.dispatch(.onStreamEnd, JSC.JSValue.jsNumber(frame.streamIdentifier));
                }
            }

            if (stream.endAfterHeaders) {
                this.endStream(stream, ErrorCode.NO_ERROR);
            }
            return content.end;
        }

        // needs more data
        return data.len;
    }
    pub fn handleSettingsFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8) usize {
        if (frame.streamIdentifier != 0) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Settings frame on connection stream", this.lastStreamID);
            return data.len;
        }

        const settingByteSize = SettingsPayloadUnit.byteSize;
        if (frame.length > 0) {
            if (frame.flags & 0x1 != 0 or frame.length % settingByteSize != 0) {
                log("invalid settings frame size", .{});
                this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "Invalid settings frame size", this.lastStreamID);
                return data.len;
            }
        } else {
            if (frame.flags & 0x1 != 0) {
                // we received an ACK
                log("settings frame ACK", .{});
                // we can now write any request
                this.firstSettingsACK = true;
                this.flush();
                this.remoteSettings = this.localSettings;
                this.dispatch(.onLocalSettings, this.localSettings.toJS(this.handlers.globalObject));
            }
            this.currentFrame = null;
            return 0;
        }

        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            var remoteSettings = this.remoteSettings orelse this.localSettings;
            var i: usize = 0;
            const payload = content.data;
            while (i < payload.len) {
                defer i += settingByteSize;
                var unit: SettingsPayloadUnit = undefined;
                SettingsPayloadUnit.from(&unit, payload[i .. i + settingByteSize], 0, true);
                remoteSettings.updateWith(unit);
            }
            this.readBuffer.reset();
            this.remoteSettings = remoteSettings;
            this.dispatch(.onRemoteSettings, remoteSettings.toJS(this.handlers.globalObject));
            return content.end;
        }
        // needs more data
        return data.len;
    }

    fn handleReceivedStreamID(this: *H2FrameParser, streamIdentifier: u32) ?*Stream {
        // connection stream
        if (streamIdentifier == 0) {
            return null;
        }

        // already exists
        if (this.streams.getEntry(streamIdentifier)) |entry| {
            return entry.value_ptr;
        }

        if (streamIdentifier > this.lastStreamID) {
            this.lastStreamID = streamIdentifier;
        }

        // new stream open
        const settings = this.remoteSettings orelse this.localSettings;
        const entry = this.streams.getOrPut(streamIdentifier) catch bun.outOfMemory();
        entry.value_ptr.* = Stream.init(streamIdentifier, settings.initialWindowSize, this);

        this.dispatch(.onStreamStart, JSC.JSValue.jsNumber(streamIdentifier));
        return entry.value_ptr;
    }

    pub fn readBytes(this: *H2FrameParser, bytes: []u8) usize {
        log("read", .{});
        if (this.currentFrame) |header| {
            log("current frame {} {} {} {}", .{ header.type, header.length, header.flags, header.streamIdentifier });

            const stream = this.handleReceivedStreamID(header.streamIdentifier);
            return switch (header.type) {
                @intFromEnum(FrameType.HTTP_FRAME_SETTINGS) => this.handleSettingsFrame(header, bytes),
                @intFromEnum(FrameType.HTTP_FRAME_WINDOW_UPDATE) => this.handleWindowUpdateFrame(header, bytes, stream),
                @intFromEnum(FrameType.HTTP_FRAME_HEADERS) => this.handleHeadersFrame(header, bytes, stream),
                @intFromEnum(FrameType.HTTP_FRAME_DATA) => this.handleDataFrame(header, bytes, stream),
                @intFromEnum(FrameType.HTTP_FRAME_CONTINUATION) => this.handleContinuationFrame(header, bytes, stream),
                @intFromEnum(FrameType.HTTP_FRAME_PRIORITY) => this.handlePriorityFrame(header, bytes, stream),
                @intFromEnum(FrameType.HTTP_FRAME_PING) => this.handlePingFrame(header, bytes, stream),
                @intFromEnum(FrameType.HTTP_FRAME_GOAWAY) => this.handleGoAwayFrame(header, bytes, stream),
                @intFromEnum(FrameType.HTTP_FRAME_RST_STREAM) => this.handleRSTStreamFrame(header, bytes, stream),
                else => {
                    this.sendGoAway(header.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Unknown frame type", this.lastStreamID);
                    return bytes.len;
                },
            };
        }

        // nothing to do
        if (bytes.len == 0) return bytes.len;

        const buffered_data = this.readBuffer.list.items.len;

        var header: FrameHeader = .{};
        // we can have less than 9 bytes buffered
        if (buffered_data > 0) {
            const total = buffered_data + bytes.len;
            if (total < FrameHeader.byteSize) {
                // buffer more data
                _ = this.readBuffer.appendSlice(bytes) catch bun.outOfMemory();
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
            log("new frame {} {} {} {}", .{ header.type, header.length, header.flags, header.streamIdentifier });
            const stream = this.handleReceivedStreamID(header.streamIdentifier);
            this.ajustWindowSize(stream, header.length);
            return switch (header.type) {
                @intFromEnum(FrameType.HTTP_FRAME_SETTINGS) => this.handleSettingsFrame(header, bytes[needed..]) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_WINDOW_UPDATE) => this.handleWindowUpdateFrame(header, bytes[needed..], stream) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_HEADERS) => this.handleHeadersFrame(header, bytes[needed..], stream) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_DATA) => this.handleDataFrame(header, bytes[needed..], stream) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_CONTINUATION) => this.handleContinuationFrame(header, bytes[needed..], stream) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_PRIORITY) => this.handlePriorityFrame(header, bytes[needed..], stream) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_PING) => this.handlePingFrame(header, bytes[needed..], stream) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_GOAWAY) => this.handleGoAwayFrame(header, bytes[needed..], stream) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_RST_STREAM) => this.handleRSTStreamFrame(header, bytes[needed..], stream) + needed,
                else => {
                    this.sendGoAway(header.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Unknown frame type", this.lastStreamID);
                    return bytes.len;
                },
            };
        }

        if (bytes.len < FrameHeader.byteSize) {
            // buffer more dheaderata
            this.readBuffer.appendSlice(bytes) catch bun.outOfMemory();
            return bytes.len;
        }

        FrameHeader.from(&header, bytes[0..FrameHeader.byteSize], 0, true);

        log("new frame {} {} {} {}", .{ header.type, header.length, header.flags, header.streamIdentifier });
        this.currentFrame = header;
        this.remainingLength = header.length;
        const stream = this.handleReceivedStreamID(header.streamIdentifier);
        this.ajustWindowSize(stream, header.length);
        return switch (header.type) {
            @intFromEnum(FrameType.HTTP_FRAME_SETTINGS) => this.handleSettingsFrame(header, bytes[FrameHeader.byteSize..]) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_WINDOW_UPDATE) => this.handleWindowUpdateFrame(header, bytes[FrameHeader.byteSize..], stream) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_HEADERS) => this.handleHeadersFrame(header, bytes[FrameHeader.byteSize..], stream) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_DATA) => this.handleDataFrame(header, bytes[FrameHeader.byteSize..], stream) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_CONTINUATION) => this.handleContinuationFrame(header, bytes[FrameHeader.byteSize..], stream) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_PRIORITY) => this.handlePriorityFrame(header, bytes[FrameHeader.byteSize..], stream) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_PING) => this.handlePingFrame(header, bytes[FrameHeader.byteSize..], stream) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_GOAWAY) => this.handleGoAwayFrame(header, bytes[FrameHeader.byteSize..], stream) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_RST_STREAM) => this.handleRSTStreamFrame(header, bytes[FrameHeader.byteSize..], stream) + FrameHeader.byteSize,
            else => {
                this.sendGoAway(header.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Unknown frame type", this.lastStreamID);
                return bytes.len;
            },
        };
    }

    const DirectWriterStruct = struct {
        writer: *H2FrameParser,
        shouldBuffer: bool = true,
        pub fn write(this: *const DirectWriterStruct, data: []const u8) !bool {
            if (this.shouldBuffer) {
                _ = this.writer.writeBuffer.write(this.writer.allocator, data) catch return false;
                return true;
            }
            this.writer.write(data);
            return true;
        }
    };

    fn toWriter(this: *H2FrameParser) DirectWriterStruct {
        return DirectWriterStruct{ .writer = this, .shouldBuffer = false };
    }

    fn getBufferWriter(this: *H2FrameParser) DirectWriterStruct {
        return DirectWriterStruct{ .writer = this, .shouldBuffer = true };
    }

    fn flush(this: *H2FrameParser) void {
        if (this.writeBuffer.len > 0) {
            const slice = this.writeBuffer.slice();
            this.write(slice);
            // we will only flush one time
            this.writeBuffer.deinitWithAllocator(this.allocator);
        }
    }

    pub fn setEncoding(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(1);
        if (args_list.len < 1) {
            globalObject.throw("Expected encoding argument", .{});
            return .zero;
        }
        this.handlers.binary_type = BinaryType.fromJSValue(globalObject, args_list.ptr[0]) orelse {
            const err = JSC.toInvalidArguments("Expected 'binaryType' to be 'arraybuffer', 'uint8array', 'buffer'", .{}, globalObject).asObjectRef();
            globalObject.throwValue(err);
            return .zero;
        };

        return .undefined;
    }

    pub fn loadSettingsFromJSValue(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, options: JSC.JSValue) bool {
        if (options.isEmptyOrUndefinedOrNull() or !options.isObject()) {
            globalObject.throw("Expected settings to be a object", .{});
            return false;
        }

        if (options.get(globalObject, "headerTableSize")) |headerTableSize| {
            if (headerTableSize.isNumber()) {
                const headerTableSizeValue = headerTableSize.toInt32();
                if (headerTableSizeValue > MAX_HEADER_TABLE_SIZE or headerTableSizeValue < 0) {
                    globalObject.throw("Expected headerTableSize to be a number between 0 and 2^32-1", .{});
                    return false;
                }
                this.localSettings.headerTableSize = @intCast(headerTableSizeValue);
            } else if (!headerTableSize.isEmptyOrUndefinedOrNull()) {
                globalObject.throw("Expected headerTableSize to be a number", .{});
                return false;
            }
        }

        if (options.get(globalObject, "enablePush")) |enablePush| {
            if (enablePush.isBoolean()) {
                this.localSettings.enablePush = if (enablePush.asBoolean()) 1 else 0;
            } else if (!enablePush.isEmptyOrUndefinedOrNull()) {
                globalObject.throw("Expected enablePush to be a boolean", .{});
                return false;
            }
        }

        if (options.get(globalObject, "initialWindowSize")) |initialWindowSize| {
            if (initialWindowSize.isNumber()) {
                const initialWindowSizeValue = initialWindowSize.toInt32();
                if (initialWindowSizeValue > MAX_HEADER_TABLE_SIZE or initialWindowSizeValue < 0) {
                    globalObject.throw("Expected initialWindowSize to be a number between 0 and 2^32-1", .{});
                    return false;
                }
                this.localSettings.initialWindowSize = @intCast(initialWindowSizeValue);
            } else if (!initialWindowSize.isEmptyOrUndefinedOrNull()) {
                globalObject.throw("Expected initialWindowSize to be a number", .{});
                return false;
            }
        }

        if (options.get(globalObject, "maxFrameSize")) |maxFrameSize| {
            if (maxFrameSize.isNumber()) {
                const maxFrameSizeValue = maxFrameSize.toInt32();
                if (maxFrameSizeValue > MAX_FRAME_SIZE or maxFrameSizeValue < 16384) {
                    globalObject.throw("Expected maxFrameSize to be a number between 16,384 and 2^24-1", .{});
                    return false;
                }
                this.localSettings.maxFrameSize = @intCast(maxFrameSizeValue);
            } else if (!maxFrameSize.isEmptyOrUndefinedOrNull()) {
                globalObject.throw("Expected maxFrameSize to be a number", .{});
                return false;
            }
        }

        if (options.get(globalObject, "maxConcurrentStreams")) |maxConcurrentStreams| {
            if (maxConcurrentStreams.isNumber()) {
                const maxConcurrentStreamsValue = maxConcurrentStreams.toInt32();
                if (maxConcurrentStreamsValue > MAX_HEADER_TABLE_SIZE or maxConcurrentStreamsValue < 0) {
                    globalObject.throw("Expected maxConcurrentStreams to be a number between 0 and 2^32-1", .{});
                    return false;
                }
                this.localSettings.maxConcurrentStreams = @intCast(maxConcurrentStreamsValue);
            } else if (!maxConcurrentStreams.isEmptyOrUndefinedOrNull()) {
                globalObject.throw("Expected maxConcurrentStreams to be a number", .{});
                return false;
            }
        }

        if (options.get(globalObject, "maxHeaderListSize")) |maxHeaderListSize| {
            if (maxHeaderListSize.isNumber()) {
                const maxHeaderListSizeValue = maxHeaderListSize.toInt32();
                if (maxHeaderListSizeValue > MAX_HEADER_TABLE_SIZE or maxHeaderListSizeValue < 0) {
                    globalObject.throw("Expected maxHeaderListSize to be a number between 0 and 2^32-1", .{});
                    return false;
                }
                this.localSettings.maxHeaderListSize = @intCast(maxHeaderListSizeValue);
            } else if (!maxHeaderListSize.isEmptyOrUndefinedOrNull()) {
                globalObject.throw("Expected maxHeaderListSize to be a number", .{});
                return false;
            }
        }

        if (options.get(globalObject, "maxHeaderSize")) |maxHeaderSize| {
            if (maxHeaderSize.isNumber()) {
                const maxHeaderSizeValue = maxHeaderSize.toInt32();
                if (maxHeaderSizeValue > MAX_HEADER_TABLE_SIZE or maxHeaderSizeValue < 0) {
                    globalObject.throw("Expected maxHeaderSize to be a number between 0 and 2^32-1", .{});
                    return false;
                }
                this.localSettings.maxHeaderListSize = @intCast(maxHeaderSizeValue);
            } else if (!maxHeaderSize.isEmptyOrUndefinedOrNull()) {
                globalObject.throw("Expected maxHeaderSize to be a number", .{});
                return false;
            }
        }
        return true;
    }

    pub fn updateSettings(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(1);
        if (args_list.len < 1) {
            globalObject.throw("Expected settings argument", .{});
            return .zero;
        }

        const options = args_list.ptr[0];

        if (this.loadSettingsFromJSValue(globalObject, options)) {
            this.setSettings(this.localSettings);
            return .undefined;
        }

        return .zero;
    }

    pub fn getCurrentState(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        var result = JSValue.createEmptyObject(globalObject, 9);
        result.put(globalObject, JSC.ZigString.static("effectiveLocalWindowSize"), JSC.JSValue.jsNumber(this.windowSize));
        result.put(globalObject, JSC.ZigString.static("effectiveRecvDataLength"), JSC.JSValue.jsNumber(this.windowSize - this.usedWindowSize));
        result.put(globalObject, JSC.ZigString.static("nextStreamID"), JSC.JSValue.jsNumber(this.getNextStreamID()));
        result.put(globalObject, JSC.ZigString.static("lastProcStreamID"), JSC.JSValue.jsNumber(this.lastStreamID));

        const settings = this.remoteSettings orelse this.localSettings;
        result.put(globalObject, JSC.ZigString.static("remoteWindowSize"), JSC.JSValue.jsNumber(settings.initialWindowSize));
        result.put(globalObject, JSC.ZigString.static("localWindowSize"), JSC.JSValue.jsNumber(this.localSettings.initialWindowSize));
        result.put(globalObject, JSC.ZigString.static("deflateDynamicTableSize"), JSC.JSValue.jsNumber(settings.headerTableSize));
        result.put(globalObject, JSC.ZigString.static("inflateDynamicTableSize"), JSC.JSValue.jsNumber(settings.headerTableSize));

        // TODO: make this  real?
        result.put(globalObject, JSC.ZigString.static("outboundQueueSize"), JSC.JSValue.jsNumber(0));
        return result;
    }
    pub fn goaway(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(3);
        if (args_list.len < 1) {
            globalObject.throw("Expected errorCode argument", .{});
            return .zero;
        }

        const error_code_arg = args_list.ptr[0];

        if (!error_code_arg.isNumber()) {
            globalObject.throw("Expected errorCode to be a number", .{});
            return .zero;
        }
        const errorCode = error_code_arg.toInt32();
        if (errorCode < 1 and errorCode > 13) {
            globalObject.throw("invalid errorCode", .{});
        }

        var lastStreamID = this.lastStreamID;
        if (args_list.len >= 2) {
            const last_stream_arg = args_list.ptr[1];
            if (!last_stream_arg.isEmptyOrUndefinedOrNull()) {
                if (!last_stream_arg.isNumber()) {
                    globalObject.throw("Expected lastStreamId to be a number", .{});
                    return .zero;
                }
                const id = last_stream_arg.toInt32();
                if (id < 0 and id > MAX_STREAM_ID) {
                    globalObject.throw("Expected lastStreamId to be a number between 1 and 2147483647", .{});
                    return .zero;
                }
                lastStreamID = @intCast(id);
            }
            if (args_list.len >= 3) {
                const opaque_data_arg = args_list.ptr[2];
                if (!opaque_data_arg.isEmptyOrUndefinedOrNull()) {
                    if (opaque_data_arg.asArrayBuffer(globalObject)) |array_buffer| {
                        const slice = array_buffer.byteSlice();
                        this.sendGoAway(0, @enumFromInt(errorCode), slice, lastStreamID);
                        return .undefined;
                    }
                }
            }
        }

        this.sendGoAway(0, @enumFromInt(errorCode), "", lastStreamID);
        return .undefined;
    }

    pub fn ping(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(1);
        if (args_list.len < 1) {
            globalObject.throw("Expected payload argument", .{});
            return .zero;
        }

        if (args_list.ptr[0].asArrayBuffer(globalObject)) |array_buffer| {
            const slice = array_buffer.slice();
            this.sendPing(false, slice);
            return .undefined;
        }

        globalObject.throw("Expected payload to be a Buffer", .{});
        return .zero;
    }

    pub fn getEndAfterHeaders(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(1);
        if (args_list.len < 1) {
            globalObject.throw("Expected stream argument", .{});
            return .zero;
        }
        const stream_arg = args_list.ptr[0];

        if (!stream_arg.isNumber()) {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0) {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        }

        const stream = this.streams.getPtr(stream_id) orelse {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        };

        return JSC.JSValue.jsBoolean(stream.endAfterHeaders);
    }

    pub fn setEndAfterHeaders(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(2);
        if (args_list.len < 2) {
            globalObject.throw("Expected stream and endAfterHeaders arguments", .{});
            return .zero;
        }
        const stream_arg = args_list.ptr[0];
        const end_arg = args_list.ptr[1];

        if (!stream_arg.isNumber()) {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0 or stream_id > MAX_STREAM_ID) {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        }

        var stream = this.streams.getPtr(stream_id) orelse {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        };

        if (!stream.canSendData() and !stream.canReceiveData()) {
            return JSC.JSValue.jsBoolean(false);
        }

        stream.endAfterHeaders = end_arg.toBoolean();
        return JSC.JSValue.jsBoolean(true);
    }

    pub fn isStreamAborted(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(1);
        if (args_list.len < 1) {
            globalObject.throw("Expected stream argument", .{});
            return .zero;
        }
        const stream_arg = args_list.ptr[0];

        if (!stream_arg.isNumber()) {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0) {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        }

        const stream = this.streams.getPtr(stream_id) orelse {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        };

        if (stream.signal) |_signal| {
            return JSC.JSValue.jsBoolean(_signal.aborted());
        }
        return JSC.JSValue.jsBoolean(true);
    }
    pub fn getStreamState(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(1);
        if (args_list.len < 1) {
            globalObject.throw("Expected stream argument", .{});
            return .zero;
        }
        const stream_arg = args_list.ptr[0];

        if (!stream_arg.isNumber()) {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0) {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        }

        var stream = this.streams.getPtr(stream_id) orelse {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        };
        var state = JSC.JSValue.createEmptyObject(globalObject, 7);

        state.put(globalObject, JSC.ZigString.static("localWindowSize"), JSC.JSValue.jsNumber(stream.windowSize));
        state.put(globalObject, JSC.ZigString.static("state"), JSC.JSValue.jsNumber(@intFromEnum(stream.state)));
        state.put(globalObject, JSC.ZigString.static("localClose"), JSC.JSValue.jsNumber(@as(i32, if (stream.canSendData()) 1 else 0)));
        state.put(globalObject, JSC.ZigString.static("remoteClose"), JSC.JSValue.jsNumber(@as(i32, if (stream.canReceiveData()) 1 else 0)));
        // TODO: sumDependencyWeight
        state.put(globalObject, JSC.ZigString.static("sumDependencyWeight"), JSC.JSValue.jsNumber(0));
        state.put(globalObject, JSC.ZigString.static("weight"), JSC.JSValue.jsNumber(stream.weight));

        return state;
    }

    pub fn setStreamPriority(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(2);
        if (args_list.len < 2) {
            globalObject.throw("Expected stream and options arguments", .{});
            return .zero;
        }
        const stream_arg = args_list.ptr[0];
        const options = args_list.ptr[1];

        if (!stream_arg.isNumber()) {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0) {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        }

        var stream = this.streams.getPtr(stream_id) orelse {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        };

        if (!stream.canSendData() and !stream.canReceiveData()) {
            return JSC.JSValue.jsBoolean(false);
        }

        if (!options.isObject()) {
            globalObject.throw("Invalid priority", .{});
            return .zero;
        }
        var weight = stream.weight;
        var exclusive = stream.exclusive;
        var parent_id = stream.streamDependency;
        var silent = false;
        if (options.get(globalObject, "weight")) |js_weight| {
            if (js_weight.isNumber()) {
                const weight_u32 = js_weight.toU32();
                if (weight_u32 > 255) {
                    globalObject.throw("Invalid weight", .{});
                    return .zero;
                }
                weight = @intCast(weight_u32);
            }
        }

        if (options.get(globalObject, "parent")) |js_parent| {
            if (js_parent.isNumber()) {
                parent_id = js_parent.toU32();
                if (parent_id == 0 or parent_id > MAX_STREAM_ID) {
                    globalObject.throw("Invalid stream id", .{});
                    return .zero;
                }
            }
        }

        if (options.get(globalObject, "exclusive")) |js_exclusive| {
            exclusive = js_exclusive.toBoolean();
        }

        if (options.get(globalObject, "silent")) |js_silent| {
            silent = js_silent.toBoolean();
        }

        stream.streamDependency = parent_id;
        stream.exclusive = exclusive;
        stream.weight = @intCast(weight);

        if (!silent) {
            var stream_identifier: UInt31WithReserved = .{
                .reserved = stream.exclusive,
                .uint31 = @truncate(stream.streamDependency),
            };

            var priority: StreamPriority = .{
                .streamIdentifier = stream_identifier.toUInt32(),
                .weight = @truncate(stream.weight),
            };
            var frame: FrameHeader = .{
                .type = @intFromEnum(FrameType.HTTP_FRAME_PRIORITY),
                .flags = 0,
                .streamIdentifier = stream.id,
                .length = @intCast(StreamPriority.byteSize),
            };

            const writer = this.toWriter();
            frame.write(@TypeOf(writer), writer);
            priority.write(@TypeOf(writer), writer);
        }
        return JSC.JSValue.jsBoolean(true);
    }
    pub fn rstStream(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(2);
        if (args_list.len < 2) {
            globalObject.throw("Expected stream and code arguments", .{});
            return .zero;
        }
        const stream_arg = args_list.ptr[0];
        const error_arg = args_list.ptr[1];

        if (!stream_arg.isNumber()) {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0 or stream_id > MAX_STREAM_ID) {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        }

        var stream = this.streams.getPtr(stream_id) orelse {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        };

        if (!stream.canSendData() and !stream.canReceiveData()) {
            return JSC.JSValue.jsBoolean(false);
        }

        if (!error_arg.isNumber()) {
            globalObject.throw("Invalid ErrorCode", .{});
            return .zero;
        }
        const error_code = error_arg.toU32();
        if (error_code > 13) {
            globalObject.throw("Invalid ErrorCode", .{});
            return .zero;
        }

        this.endStream(stream, @enumFromInt(error_code));

        return JSC.JSValue.jsBoolean(true);
    }
    fn sendData(this: *H2FrameParser, stream_id: u32, payload: []const u8, close: bool) void {
        log("sendData({}, {}, {})", .{ stream_id, payload.len, close });

        const writer = if (this.firstSettingsACK) this.toWriter() else this.getBufferWriter();
        if (payload.len == 0) {
            // empty payload we still need to send a frame
            var dataHeader: FrameHeader = .{
                .type = @intFromEnum(FrameType.HTTP_FRAME_DATA),
                .flags = if (close) @intFromEnum(DataFrameFlags.END_STREAM) else 0,
                .streamIdentifier = @intCast(stream_id),
                .length = 0,
            };
            dataHeader.write(@TypeOf(writer), writer);
        } else {
            // max frame size will always be at least 16384
            const max_size = 16384 - FrameHeader.byteSize - 1;

            var offset: usize = 0;

            while (offset < payload.len) {
                const size = @min(payload.len - offset, max_size);
                const slice = payload[offset..(size + offset)];
                offset += size;
                var dataHeader: FrameHeader = .{
                    .type = @intFromEnum(FrameType.HTTP_FRAME_DATA),
                    .flags = if (offset >= payload.len and close) @intFromEnum(DataFrameFlags.END_STREAM) else 0,
                    .streamIdentifier = @intCast(stream_id),
                    .length = size,
                };
                dataHeader.write(@TypeOf(writer), writer);
                _ = writer.write(slice) catch 0;
            }
        }
    }

    pub fn sendTrailers(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(3);
        if (args_list.len < 3) {
            globalObject.throw("Expected stream, headers and sensitiveHeaders arguments", .{});
            return .zero;
        }

        const stream_arg = args_list.ptr[0];
        const headers_arg = args_list.ptr[1];
        const sensitive_arg = args_list.ptr[2];

        if (!stream_arg.isNumber()) {
            globalObject.throw("Expected stream to be a number", .{});
            return .zero;
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0 or stream_id > MAX_STREAM_ID) {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        }

        var stream = this.streams.getPtr(@intCast(stream_id)) orelse {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        };

        if (!headers_arg.isObject()) {
            globalObject.throw("Expected headers to be an object", .{});
            return .zero;
        }

        if (!sensitive_arg.isObject()) {
            globalObject.throw("Expected sensitiveHeaders to be an object", .{});
            return .zero;
        }

        // max frame size will be always at least 16384
        var buffer = shared_request_buffer[0 .. shared_request_buffer.len - FrameHeader.byteSize];

        var encoded_size: usize = 0;

        var iter = JSC.JSPropertyIterator(.{
            .skip_empty_name = false,
            .include_value = true,
        }).init(globalObject, headers_arg);
        defer iter.deinit();

        // TODO: support CONTINUE for more headers if headers are too big
        while (iter.next()) |header_name| {
            const name_slice = header_name.toUTF8(bun.default_allocator);
            defer name_slice.deinit();
            const name = name_slice.slice();

            if (header_name.charAt(0) == ':') {
                const exception = JSC.toTypeError(.ERR_HTTP2_INVALID_PSEUDOHEADER, "\"{s}\" is an invalid pseudoheader or is used incorrectly", .{name}, globalObject);
                globalObject.throwValue(exception);
                return .zero;
            }

            var js_value = headers_arg.getTruthy(globalObject, name) orelse {
                const exception = JSC.toTypeError(.ERR_HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{name}, globalObject);
                globalObject.throwValue(exception);
                return .zero;
            };

            if (js_value.jsType().isArray()) {
                // https://github.com/oven-sh/bun/issues/8940
                var value_iter = js_value.arrayIterator(globalObject);

                if (SingleValueHeaders.has(name) and value_iter.len > 1) {
                    const exception = JSC.toTypeError(.ERR_HTTP2_INVALID_SINGLE_VALUE_HEADER, "Header field \"{s}\" must only have a single value", .{name}, globalObject);
                    globalObject.throwValue(exception);
                    return .zero;
                }

                while (value_iter.next()) |item| {
                    if (item.isEmptyOrUndefinedOrNull()) {
                        const exception = JSC.toTypeError(.ERR_HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{name}, globalObject);
                        globalObject.throwValue(exception);
                        return .zero;
                    }

                    const value_str = item.toStringOrNull(globalObject) orelse {
                        const exception = JSC.toTypeError(.ERR_HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{name}, globalObject);
                        globalObject.throwValue(exception);
                        return .zero;
                    };

                    const never_index = sensitive_arg.getTruthy(globalObject, "neverIndex") != null;

                    const value_slice = value_str.toSlice(globalObject, bun.default_allocator);
                    defer value_slice.deinit();
                    const value = value_slice.slice();
                    log("encode header {s} {s}", .{ name, value });
                    encoded_size += this.encode(buffer, encoded_size, name, value, never_index) catch {
                        stream.state = .CLOSED;
                        stream.rstCode = @intFromEnum(ErrorCode.COMPRESSION_ERROR);
                        this.dispatchWithExtra(.onStreamError, JSC.JSValue.jsNumber(stream_id), JSC.JSValue.jsNumber(stream.rstCode));
                        return .undefined;
                    };
                }
            } else {
                const value_str = js_value.toStringOrNull(globalObject) orelse {
                    const exception = JSC.toTypeError(.ERR_HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{name}, globalObject);
                    globalObject.throwValue(exception);
                    return .zero;
                };

                const never_index = sensitive_arg.getTruthy(globalObject, "neverIndex") != null;

                const value_slice = value_str.toSlice(globalObject, bun.default_allocator);
                defer value_slice.deinit();
                const value = value_slice.slice();
                log("encode header {s} {s}", .{ name, value });
                encoded_size += this.encode(buffer, encoded_size, name, value, never_index) catch {
                    stream.state = .CLOSED;
                    stream.rstCode = @intFromEnum(ErrorCode.COMPRESSION_ERROR);
                    this.dispatchWithExtra(.onStreamError, JSC.JSValue.jsNumber(stream_id), JSC.JSValue.jsNumber(stream.rstCode));
                    return .undefined;
                };
            }
        }
        const flags: u8 = @intFromEnum(HeadersFrameFlags.END_HEADERS) | @intFromEnum(HeadersFrameFlags.END_STREAM);

        log("trailers encoded_size {}", .{encoded_size});
        var frame: FrameHeader = .{
            .type = @intFromEnum(FrameType.HTTP_FRAME_HEADERS),
            .flags = flags,
            .streamIdentifier = stream.id,
            .length = @intCast(encoded_size),
        };
        const writer = if (this.firstSettingsACK) this.toWriter() else this.getBufferWriter();
        frame.write(@TypeOf(writer), writer);
        _ = writer.write(buffer[0..encoded_size]) catch 0;

        return .undefined;
    }
    pub fn writeStream(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(3);
        if (args_list.len < 3) {
            globalObject.throw("Expected stream, data and endStream arguments", .{});
            return .zero;
        }

        const stream_arg = args_list.ptr[0];
        const data_arg = args_list.ptr[1];
        const close_arg = args_list.ptr[2];

        if (!stream_arg.isNumber()) {
            globalObject.throw("Expected stream to be a number", .{});
            return .zero;
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0 or stream_id > MAX_STREAM_ID) {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        }
        const close = close_arg.toBoolean();

        var stream = this.streams.getPtr(@intCast(stream_id)) orelse {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        };
        if (stream.canSendData()) {
            return JSC.JSValue.jsBoolean(false);
        }

        // TODO: check padding strategy here

        if (data_arg.asArrayBuffer(globalObject)) |array_buffer| {
            const payload = array_buffer.slice();
            this.sendData(stream_id, payload, close and !stream.waitForTrailers);
        } else if (bun.String.tryFromJS(data_arg, globalObject)) |bun_str| {
            defer bun_str.deref();
            var zig_str = bun_str.toUTF8WithoutRef(bun.default_allocator);
            defer zig_str.deinit();
            const payload = zig_str.slice();
            this.sendData(stream_id, payload, close and !stream.waitForTrailers);
        } else {
            if (!globalObject.hasException())
                globalObject.throw("Expected data to be an ArrayBuffer or a string", .{});
            return .zero;
        }

        if (close) {
            if (stream.waitForTrailers) {
                this.dispatch(.onWantTrailers, JSC.JSValue.jsNumber(stream.id));
            }
        }

        return JSC.JSValue.jsBoolean(true);
    }

    fn getNextStreamID(this: *H2FrameParser) u32 {
        var stream_id: u32 = this.lastStreamID;
        if (stream_id % 2 == 0) {
            stream_id += 1;
        } else if (stream_id == 0) {
            stream_id = 1;
        } else {
            stream_id += 2;
        }

        return stream_id;
    }

    pub fn request(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        // we use PADDING_STRATEGY_NONE with is default
        // TODO: PADDING_STRATEGY_MAX AND PADDING_STRATEGY_ALIGNED

        const args_list = callframe.arguments(3);
        if (args_list.len < 2) {
            globalObject.throw("Expected headers and sensitiveHeaders arguments", .{});
            return .zero;
        }

        const headers_arg = args_list.ptr[0];
        const sensitive_arg = args_list.ptr[1];

        if (!headers_arg.isObject()) {
            globalObject.throw("Expected headers to be an object", .{});
            return .zero;
        }

        if (!sensitive_arg.isObject()) {
            globalObject.throw("Expected sensitiveHeaders to be an object", .{});
            return .zero;
        }

        // max frame size will be always at least 16384
        var buffer = shared_request_buffer[0 .. shared_request_buffer.len - FrameHeader.byteSize - 5];

        var encoded_size: usize = 0;

        const stream_id: u32 = this.getNextStreamID();
        if (stream_id > MAX_STREAM_ID) {
            return JSC.JSValue.jsNumber(-1);
        }

        // we iterate twice, because pseudo headers must be sent first, but can appear anywhere in the headers object
        var iter = JSC.JSPropertyIterator(.{
            .skip_empty_name = false,
            .include_value = true,
        }).init(globalObject, headers_arg);
        defer iter.deinit();
        for (0..2) |ignore_pseudo_headers| {
            iter.reset();

            while (iter.next()) |header_name| {
                const name_slice = header_name.toUTF8(bun.default_allocator);
                defer name_slice.deinit();
                const name = name_slice.slice();

                if (header_name.charAt(0) == ':') {
                    if (ignore_pseudo_headers == 1) continue;

                    if (!ValidRequestPseudoHeaders.has(name)) {
                        const exception = JSC.toTypeError(.ERR_HTTP2_INVALID_PSEUDOHEADER, "\"{s}\" is an invalid pseudoheader or is used incorrectly", .{name}, globalObject);
                        globalObject.throwValue(exception);
                        return .zero;
                    }
                } else if (ignore_pseudo_headers == 0) {
                    continue;
                }

                var js_value = headers_arg.getTruthy(globalObject, name) orelse {
                    const exception = JSC.toTypeError(.ERR_HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{name}, globalObject);
                    globalObject.throwValue(exception);
                    return .zero;
                };

                if (js_value.jsType().isArray()) {
                    log("array header {s}", .{name});
                    // https://github.com/oven-sh/bun/issues/8940
                    var value_iter = js_value.arrayIterator(globalObject);

                    if (SingleValueHeaders.has(name) and value_iter.len > 1) {
                        const exception = JSC.toTypeError(.ERR_HTTP2_INVALID_HEADER_VALUE, "Header field \"{s}\" must only have a single value", .{name}, globalObject);
                        globalObject.throwValue(exception);
                        return .zero;
                    }

                    while (value_iter.next()) |item| {
                        if (item.isEmptyOrUndefinedOrNull()) {
                            const exception = JSC.toTypeError(.ERR_HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{name}, globalObject);
                            globalObject.throwValue(exception);
                            return .zero;
                        }

                        const value_str = item.toStringOrNull(globalObject) orelse {
                            const exception = JSC.toTypeError(.ERR_HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{name}, globalObject);
                            globalObject.throwValue(exception);
                            return .zero;
                        };

                        const never_index = sensitive_arg.getTruthy(globalObject, "neverIndex") != null;

                        const value_slice = value_str.toSlice(globalObject, bun.default_allocator);
                        defer value_slice.deinit();
                        const value = value_slice.slice();
                        log("encode header {s} {s}", .{ name, value });
                        encoded_size += this.encode(buffer, encoded_size, name, value, never_index) catch {
                            const stream = this.handleReceivedStreamID(stream_id) orelse {
                                return JSC.JSValue.jsNumber(-1);
                            };
                            stream.state = .CLOSED;
                            stream.rstCode = @intFromEnum(ErrorCode.COMPRESSION_ERROR);
                            this.dispatchWithExtra(.onStreamError, JSC.JSValue.jsNumber(stream_id), JSC.JSValue.jsNumber(stream.rstCode));
                            return .undefined;
                        };
                    }
                } else {
                    log("single header {s}", .{name});
                    const value_str = js_value.toStringOrNull(globalObject) orelse {
                        const exception = JSC.toTypeError(.ERR_HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{name}, globalObject);
                        globalObject.throwValue(exception);
                        return .zero;
                    };

                    const never_index = sensitive_arg.getTruthy(globalObject, "neverIndex") != null;

                    const value_slice = value_str.toSlice(globalObject, bun.default_allocator);
                    defer value_slice.deinit();
                    const value = value_slice.slice();
                    log("encode header {s} {s}", .{ name, value });
                    encoded_size += this.encode(buffer, encoded_size, name, value, never_index) catch {
                        const stream = this.handleReceivedStreamID(stream_id) orelse {
                            return JSC.JSValue.jsNumber(-1);
                        };
                        stream.state = .CLOSED;
                        stream.rstCode = @intFromEnum(ErrorCode.COMPRESSION_ERROR);
                        this.dispatchWithExtra(.onStreamError, JSC.JSValue.jsNumber(stream_id), JSC.JSValue.jsNumber(stream.rstCode));
                        return JSC.JSValue.jsNumber(stream.id);
                    };
                }
            }
        }
        const stream = this.handleReceivedStreamID(stream_id) orelse {
            return JSC.JSValue.jsNumber(-1);
        };

        var flags: u8 = @intFromEnum(HeadersFrameFlags.END_HEADERS);
        var exclusive: bool = false;
        var has_priority: bool = false;
        var weight: i32 = 0;
        var parent: i32 = 0;
        var waitForTrailers: bool = false;
        var end_stream: bool = false;
        if (args_list.len > 2 and !args_list.ptr[2].isEmptyOrUndefinedOrNull()) {
            const options = args_list.ptr[2];
            if (!options.isObject()) {
                stream.state = .CLOSED;
                stream.rstCode = @intFromEnum(ErrorCode.INTERNAL_ERROR);
                this.dispatchWithExtra(.onStreamError, JSC.JSValue.jsNumber(stream_id), JSC.JSValue.jsNumber(stream.rstCode));
                return JSC.JSValue.jsNumber(stream.id);
            }

            if (options.get(globalObject, "waitForTrailers")) |trailes_js| {
                if (trailes_js.isBoolean()) {
                    waitForTrailers = trailes_js.asBoolean();
                    stream.waitForTrailers = waitForTrailers;
                }
            }

            if (options.get(globalObject, "endStream")) |end_stream_js| {
                if (end_stream_js.isBoolean()) {
                    if (end_stream_js.asBoolean()) {
                        end_stream = true;
                        // will end the stream after trailers
                        if (!waitForTrailers) {
                            flags |= @intFromEnum(HeadersFrameFlags.END_STREAM);
                        }
                    }
                }
            }

            if (options.get(globalObject, "exclusive")) |exclusive_js| {
                if (exclusive_js.isBoolean()) {
                    if (exclusive_js.asBoolean()) {
                        exclusive = true;
                        stream.exclusive = true;
                        has_priority = true;
                    }
                }
            }

            if (options.get(globalObject, "parent")) |parent_js| {
                if (parent_js.isNumber() or parent_js.isInt32()) {
                    has_priority = true;
                    parent = parent_js.toInt32();
                    if (parent <= 0 or parent > MAX_STREAM_ID) {
                        stream.state = .CLOSED;
                        stream.rstCode = @intFromEnum(ErrorCode.INTERNAL_ERROR);
                        this.dispatchWithExtra(.onStreamError, JSC.JSValue.jsNumber(stream_id), JSC.JSValue.jsNumber(stream.rstCode));
                        return JSC.JSValue.jsNumber(stream.id);
                    }
                    stream.streamDependency = @intCast(parent);
                }
            }

            if (options.get(globalObject, "weight")) |weight_js| {
                if (weight_js.isNumber() or weight_js.isInt32()) {
                    has_priority = true;
                    weight = weight_js.toInt32();
                    if (weight < 1 or weight > 256) {
                        stream.state = .CLOSED;
                        stream.rstCode = @intFromEnum(ErrorCode.INTERNAL_ERROR);
                        this.dispatchWithExtra(.onStreamError, JSC.JSValue.jsNumber(stream_id), JSC.JSValue.jsNumber(stream.rstCode));
                        return JSC.JSValue.jsNumber(stream.id);
                    }
                    stream.weight = @intCast(weight);
                }

                if (weight < 1 or weight > 256) {
                    stream.state = .CLOSED;
                    stream.rstCode = @intFromEnum(ErrorCode.INTERNAL_ERROR);
                    this.dispatchWithExtra(.onStreamError, JSC.JSValue.jsNumber(stream_id), JSC.JSValue.jsNumber(stream.rstCode));
                    return JSC.JSValue.jsNumber(stream.id);
                }
                stream.weight = @intCast(weight);
            }

            if (options.get(globalObject, "signal")) |signal_arg| {
                if (signal_arg.as(JSC.WebCore.AbortSignal)) |signal_| {
                    if (signal_.aborted()) {
                        stream.state = .CLOSED;
                        stream.rstCode = @intFromEnum(ErrorCode.CANCEL);
                        this.dispatchWithExtra(.onAborted, JSC.JSValue.jsNumber(stream.id), signal_.abortReason());
                        return JSC.JSValue.jsNumber(stream.id);
                    }
                    stream.attachSignal(signal_);
                }
            }
        }

        var length: usize = encoded_size;
        if (has_priority) {
            length += 5;
            flags |= @intFromEnum(HeadersFrameFlags.PRIORITY);
        }

        log("request encoded_size {}", .{encoded_size});
        var frame: FrameHeader = .{
            .type = @intFromEnum(FrameType.HTTP_FRAME_HEADERS),
            .flags = flags,
            .streamIdentifier = stream.id,
            .length = @intCast(encoded_size),
        };

        const writer = if (this.firstSettingsACK) this.toWriter() else this.getBufferWriter();
        frame.write(@TypeOf(writer), writer);
        //https://datatracker.ietf.org/doc/html/rfc7540#section-6.2
        if (has_priority) {
            var stream_identifier: UInt31WithReserved = .{
                .reserved = exclusive,
                .uint31 = @intCast(parent),
            };

            var priority: StreamPriority = .{
                .streamIdentifier = stream_identifier.toUInt32(),
                .weight = @intCast(weight),
            };

            priority.write(@TypeOf(writer), writer);
        }

        _ = writer.write(buffer[0..encoded_size]) catch 0;

        if (end_stream) {
            stream.state = .HALF_CLOSED_LOCAL;

            if (waitForTrailers) {
                this.dispatch(.onWantTrailers, JSC.JSValue.jsNumber(stream.id));
            }
        } else {
            stream.waitForTrailers = waitForTrailers;
        }

        return JSC.JSValue.jsNumber(stream.id);
    }

    pub fn read(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(1);
        if (args_list.len < 1) {
            globalObject.throw("Expected 1 argument", .{});
            return .zero;
        }
        const buffer = args_list.ptr[0];
        buffer.ensureStillAlive();
        if (buffer.asArrayBuffer(globalObject)) |array_buffer| {
            var bytes = array_buffer.byteSlice();
            // read all the bytes
            while (bytes.len > 0) {
                const result = this.readBytes(bytes);
                bytes = bytes[result..];
            }
            return .undefined;
        }
        globalObject.throw("Expected data to be a Buffer or ArrayBuffer", .{});
        return .zero;
    }

    pub fn constructor(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) ?*H2FrameParser {
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
        const context_obj = options.get(globalObject, "context") orelse {
            globalObject.throw("Expected \"context\" option", .{});
            return null;
        };
        var handler_js = JSC.JSValue.zero;
        if (options.get(globalObject, "handlers")) |handlers_| {
            handler_js = handlers_;
        }
        var handlers = Handlers.fromJS(globalObject, handler_js, &exception) orelse {
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
            .streams = bun.U32HashMap(Stream).init(bun.default_allocator),
        };
        if (options.get(globalObject, "settings")) |settings_js| {
            if (!settings_js.isEmptyOrUndefinedOrNull()) {
                if (!this.loadSettingsFromJSValue(globalObject, settings_js)) {
                    this.deinit();
                    handlers.deinit();
                    return null;
                }
            }
        }

        this.strong_ctx.set(globalObject, context_obj);

        this.hpack = lshpack.HPACK.init(this.localSettings.headerTableSize);
        this.sendPrefaceAndSettings();
        return this;
    }

    pub fn deinit(this: *H2FrameParser) void {
        var allocator = this.allocator;
        defer allocator.destroy(this);
        this.strong_ctx.deinit();
        this.handlers.deinit();
        this.readBuffer.deinit();
        this.writeBuffer.deinitWithAllocator(allocator);

        if (this.hpack) |hpack| {
            hpack.deinit();
            this.hpack = null;
        }

        var it = this.streams.iterator();
        while (it.next()) |*entry| {
            var stream = entry.value_ptr.*;
            stream.deinit();
        }

        this.streams.deinit();
    }

    pub fn finalize(
        this: *H2FrameParser,
    ) void {
        log("finalize", .{});
        this.deinit();
    }
};

pub fn createNodeHttp2Binding(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSArray.create(global, &.{
        H2FrameParser.getConstructor(global),
        JSC.JSFunction.create(global, "getPackedSettings", jsGetPackedSettings, 0, .{}),
        JSC.JSFunction.create(global, "getUnpackedSettings", jsGetUnpackedSettings, 0, .{}),
    });
}
