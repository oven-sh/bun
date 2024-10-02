const getAllocator = @import("../../base.zig").getAllocator;
const bun = @import("root").bun;
const Output = bun.Output;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = bun.JSC;
const MutableString = bun.MutableString;
const lshpack = @import("./lshpack.zig");
const strings = bun.strings;
pub const AutoFlusher = @import("../../webcore/streams.zig").AutoFlusher;
const TLSSocket = @import("./socket.zig").TLSSocket;
const TCPSocket = @import("./socket.zig").TCPSocket;
const JSTLSSocket = JSC.Codegen.JSTLSSocket;
const JSTCPSocket = JSC.Codegen.JSTCPSocket;
const MAX_PAYLOAD_SIZE_WITHOUT_FRAME = 16384 - FrameHeader.byteSize - 1;
const BunSocket = union(enum) {
    none: void,
    tls: *TLSSocket,
    tls_writeonly: *TLSSocket,
    tcp: *TCPSocket,
    tcp_writeonly: *TCPSocket,
};

pub const WellKnowHeaders = bun.ComptimeStringMap(bun.String, .{
    .{ ":authority", bun.String.static(":authority") },
    .{ ":method", bun.String.static(":method") },
    .{ ":path", bun.String.static(":path") },
    .{ ":scheme", bun.String.static(":scheme") },
    .{ ":status", bun.String.static(":status") },
    .{ "accept-charset", bun.String.static("accept-charset") },
    .{ "accept-encoding", bun.String.static("accept-encoding") },
    .{ "accept-language", bun.String.static("accept-language") },
    .{ "accept-ranges", bun.String.static("accept-ranges") },
    .{ "accept", bun.String.static("accept") },
    .{ "access-control-allow-origin", bun.String.static("access-control-allow-origin") },
    .{ "age", bun.String.static("age") },
    .{ "allow", bun.String.static("allow") },
    .{ "authorization", bun.String.static("authorization") },
    .{ "cache-control", bun.String.static("cache-control") },
    .{ "content-disposition", bun.String.static("content-disposition") },
    .{ "content-encoding", bun.String.static("content-encoding") },
    .{ "content-language", bun.String.static("content-language") },
    .{ "content-length", bun.String.static("content-length") },
    .{ "content-location", bun.String.static("content-location") },
    .{ "content-range", bun.String.static("content-range") },
    .{ "content-type", bun.String.static("content-type") },
    .{ "cookie", bun.String.static("cookie") },
    .{ "date", bun.String.static("date") },
    .{ "etag", bun.String.static("etag") },
    .{ "expect", bun.String.static("expect") },
    .{ "expires", bun.String.static("expires") },
    .{ "from", bun.String.static("from") },
    .{ "host", bun.String.static("host") },
    .{ "if-match", bun.String.static("if-match") },
    .{ "if-modified-since", bun.String.static("if-modified-since") },
    .{ "if-none-match", bun.String.static("if-none-match") },
    .{ "if-range", bun.String.static("if-range") },
    .{ "if-unmodified-since", bun.String.static("if-unmodified-since") },
    .{ "last-modified", bun.String.static("last-modified") },
    .{ "link", bun.String.static("link") },
    .{ "location", bun.String.static("location") },
    .{ "max-forwards", bun.String.static("max-forwards") },
    .{ "proxy-authenticate", bun.String.static("proxy-authenticate") },
    .{ "proxy-authorization", bun.String.static("proxy-authorization") },
    .{ "range", bun.String.static("range") },
    .{ "referer", bun.String.static("referer") },
    .{ "refresh", bun.String.static("refresh") },
    .{ "retry-after", bun.String.static("retry-after") },
    .{ "server", bun.String.static("server") },
    .{ "set-cookie", bun.String.static("set-cookie") },
    .{ "strict-transport-security", bun.String.static("strict-transport-security") },
    .{ "transfer-encoding", bun.String.static("transfer-encoding") },
    .{ "user-agent", bun.String.static("user-agent") },
    .{ "vary", bun.String.static("vary") },
    .{ "via", bun.String.static("via") },
    .{ "www-authenticate", bun.String.static("www-authenticate") },
});

const JSValue = JSC.JSValue;

const BinaryType = JSC.BinaryType;
const MAX_WINDOW_SIZE = 2147483647;
const MAX_HEADER_TABLE_SIZE = 4294967295;
const MAX_STREAM_ID = 2147483647;
const WINDOW_INCREMENT_SIZE = 65536;
const MAX_HPACK_HEADER_SIZE = 65536;
const MAX_FRAME_SIZE = 16777215;

const PaddingStrategy = enum {
    none,
    aligned,
    max,
};
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
const SettingsFlags = enum(u8) {
    ACK = 0x1,
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

    pub inline fn write(this: UInt31WithReserved, comptime Writer: type, writer: Writer) bool {
        var value: u32 = @bitCast(this);
        value = @byteSwap(value);

        return (writer.write(std.mem.asBytes(&value)) catch 0) != 0;
    }
};

const StreamPriority = packed struct(u40) {
    streamIdentifier: u32 = 0,
    weight: u8 = 0,

    pub const byteSize: usize = 5;
    pub inline fn write(this: *StreamPriority, comptime Writer: type, writer: Writer) bool {
        var swap = this.*;
        std.mem.byteSwapAllFields(StreamPriority, &swap);

        return (writer.write(std.mem.asBytes(&swap)[0..StreamPriority.byteSize]) catch 0) != 0;
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
    pub inline fn write(this: *FrameHeader, comptime Writer: type, writer: Writer) bool {
        var swap = this.*;
        std.mem.byteSwapAllFields(FrameHeader, &swap);

        return (writer.write(std.mem.asBytes(&swap)[0..FrameHeader.byteSize]) catch 0) != 0;
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
    enablePush: u32 = 0,
    _maxConcurrentStreamsType: u16 = @intFromEnum(SettingsType.SETTINGS_MAX_CONCURRENT_STREAMS),
    maxConcurrentStreams: u32 = 4294967295,
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
    pub fn write(this: *FullSettingsPayload, comptime Writer: type, writer: Writer) bool {
        var swap = this.*;

        std.mem.byteSwapAllFields(FullSettingsPayload, &swap);
        return (writer.write(std.mem.asBytes(&swap)[0..FullSettingsPayload.byteSize]) catch 0) != 0;
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

    pub fn callArbitraryCallBack(this: *Handlers, callback: JSC.JSValue, thisValue: JSValue, data: []const JSValue) bool {
        if (!callback.isCallable(this.globalObject.vm())) return false;
        this.vm.eventLoop().runCallback(callback, this.globalObject, thisValue, data);
        return true;
    }

    pub fn callEventHandlerWithResult(this: *Handlers, comptime event: @Type(.EnumLiteral), thisValue: JSValue, data: []const JSValue) JSValue {
        const callback = @field(this, @tagName(event));
        if (callback == .zero) {
            return JSC.JSValue.zero;
        }

        return this.vm.eventLoop().runCallbackWithResult(callback, this.globalObject, thisValue, data);
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
            // .{ "onError", "error" } using fastGet(.error) now
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

        if (opts.fastGet(globalObject, .@"error")) |callback_value| {
            if (!callback_value.isCell() or !callback_value.isCallable(globalObject.vm())) {
                exception.* = JSC.toInvalidArguments("Expected \"error\" callback to be a function", .{}, globalObject).asObjectRef();
                return null;
            }

            handlers.onError = callback_value;
        }

        // onWrite is required for duplex support or if more than 1 parser is attached to the same socket (unliked)
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

const MAX_BUFFER_SIZE = 32768;
var CORK_BUFFER: [16386]u8 = undefined;
var CORK_OFFSET: u16 = 0;
var CORKED_H2: ?*H2FrameParser = null;

const ENABLE_AUTO_CORK = false;
const H2FrameParserHiveAllocator = bun.HiveArray(H2FrameParser, 256).Fallback;

var h2frameparser_allocator = H2FrameParserHiveAllocator.init(bun.default_allocator);

pub const H2FrameParser = struct {
    pub const log = Output.scoped(.H2FrameParser, false);
    pub usingnamespace JSC.Codegen.JSH2FrameParser;

    strong_ctx: JSC.Strong = .{},
    globalThis: *JSC.JSGlobalObject,
    allocator: Allocator,
    handlers: Handlers,
    native_socket: BunSocket = .{ .none = {} },
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
    maxHeaderListPairs: u32 = 128,
    maxRejectedStreams: u32 = 100,
    rejectedStreams: u32 = 0,
    maxSessionMemory: u32 = 10, //this limit is in MB
    queuedDataSize: u64 = 0, // this is in bytes
    maxOutstandingPings: u64 = 10,
    outStandingPings: u64 = 0,
    lastStreamID: u32 = 0,
    firstSettingsACK: bool = false,
    isServer: bool = false,
    prefaceReceivedLen: u8 = 0,
    // we buffer requests until we get the first settings ACK
    writeBuffer: bun.ByteList = .{},
    writeBufferOffset: usize = 0,
    // TODO: this will be removed when I re-add header and data priorization
    pendingBuffer: bun.ByteList = .{},
    outboundQueueSize: usize = 0,

    streams: bun.U32HashMap(Stream),

    hpack: ?*lshpack.HPACK = null,

    autouncork_registered: bool = false,
    has_nonnative_backpressure: bool = false,
    ref_count: u8 = 1,

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
        jsContext: JSC.Strong = .{},
        waitForTrailers: bool = false,
        closeAfterDrain: bool = false,
        endAfterHeaders: bool = false,
        isWaitingMoreHeaders: bool = false,
        padding: ?u8 = 0,
        paddingStrategy: PaddingStrategy = .none,
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

        // when we have backpressure we queue the data e round robin the Streams
        dataFrameQueue: PendingQueue,
        const PendingQueue = struct {
            data: std.ArrayListUnmanaged(PendingFrame) = .{},
            front: usize = 0,
            len: usize = 0,

            pub fn deinit(self: *PendingQueue, allocator: Allocator) void {
                self.front = 0;
                self.len = 0;
                if (self.data.capacity > 0) {
                    self.data.clearAndFree(allocator);
                }
            }

            pub fn enqueue(self: *PendingQueue, value: PendingFrame, allocator: Allocator) void {
                self.data.append(allocator, value) catch bun.outOfMemory();
                self.len += 1;
            }

            pub fn peek(self: *PendingQueue) ?*PendingFrame {
                if (self.len == 0) {
                    return null;
                }
                return &self.data.items[0];
            }

            pub fn peekLast(self: *PendingQueue) ?*PendingFrame {
                if (self.len == 0 or self.data.items.len == 0) {
                    return null;
                }
                return &self.data.items[self.data.items.len - 1];
            }

            pub fn slice(self: *PendingQueue) []PendingFrame {
                if (self.len == 0) return &.{};
                return self.data.items;
            }

            pub fn dequeue(self: *PendingQueue) ?PendingFrame {
                if (self.len == 0) {
                    return null;
                }
                const value = self.data.items[self.front];
                self.len -= 1;
                if (self.len == 0) {
                    self.front = 0;
                    self.data.clearRetainingCapacity();
                } else {
                    self.front += 1;
                }
                return value;
            }

            pub fn isEmpty(self: *PendingQueue) bool {
                return self.len == 0;
            }
        };
        const PendingFrame = struct {
            end_stream: bool = false, // end_stream flag
            len: u32 = 0, // actually payload size
            buffer: []u8, // allocated buffer if len > 0
            callback: JSC.Strong, // JSCallback for done

            pub fn deinit(this: *PendingFrame, allocator: Allocator) void {
                this.callback.deinit();
                if (this.buffer.len > 0) {
                    allocator.free(this.buffer);
                }
            }
        };

        pub fn getPadding(
            this: *Stream,
            frameLen: usize,
            maxLen: usize,
        ) u8 {
            switch (this.paddingStrategy) {
                .none => return 0,
                .aligned => {
                    const diff = (frameLen + 9) % 8;
                    // already multiple of 8
                    if (diff == 0) return 0;

                    var paddedLen = frameLen + (8 - diff);
                    // limit to maxLen
                    paddedLen = @min(maxLen, paddedLen);
                    return @min(paddedLen - frameLen, 255);
                },
                .max => return @min(maxLen - frameLen, 255),
            }
        }
        pub fn flushQueue(this: *Stream, written: *usize) bool {
            const client = this.client;
            if (this.canSendData()) {
                // flush one frame
                if (this.dataFrameQueue.dequeue()) |frame| {
                    defer {
                        var _frame = frame;
                        if (_frame.callback.get()) |callback_value| client.dispatchArbitrary(callback_value);
                        _frame.deinit(client.allocator);
                    }
                    const no_backpressure = brk: {
                        const writer = client.toWriter();

                        if (frame.len == 0) {
                            // flush a zero payload frame
                            var dataHeader: FrameHeader = .{
                                .type = @intFromEnum(FrameType.HTTP_FRAME_DATA),
                                .flags = if (frame.end_stream) @intFromEnum(DataFrameFlags.END_STREAM) else 0,
                                .streamIdentifier = @intCast(this.id),
                                .length = 0,
                            };
                            break :brk dataHeader.write(@TypeOf(writer), writer);
                        } else {
                            // flush with some payload
                            client.queuedDataSize -= frame.len;
                            const padding = this.getPadding(frame.len, MAX_PAYLOAD_SIZE_WITHOUT_FRAME - 1);
                            const payload_size = frame.len + (if (padding != 0) padding + 1 else 0);
                            var flags: u8 = if (frame.end_stream) @intFromEnum(DataFrameFlags.END_STREAM) else 0;
                            if (padding != 0) {
                                flags |= @intFromEnum(DataFrameFlags.PADDED);
                            }
                            var dataHeader: FrameHeader = .{
                                .type = @intFromEnum(FrameType.HTTP_FRAME_DATA),
                                .flags = flags,
                                .streamIdentifier = @intCast(this.id),
                                .length = @intCast(payload_size),
                            };
                            _ = dataHeader.write(@TypeOf(writer), writer);
                            if (padding != 0) {
                                var buffer = shared_request_buffer[0..];
                                bun.memmove(buffer[1..frame.len], buffer[0..frame.len]);
                                buffer[0] = padding;
                                break :brk (writer.write(buffer[0 .. FrameHeader.byteSize + payload_size]) catch 0) != 0;
                            } else {
                                break :brk (writer.write(frame.buffer[0..frame.len]) catch 0) != 0;
                            }
                        }
                    };
                    written.* += frame.len;
                    log("frame flushed {} {}", .{ frame.len, frame.end_stream });
                    client.outboundQueueSize -= 1;
                    if (this.dataFrameQueue.isEmpty()) {
                        if (this.closeAfterDrain) {
                            if (this.state == .HALF_CLOSED_REMOTE) {
                                this.state = .CLOSED;
                            } else {
                                this.state = .HALF_CLOSED_LOCAL;
                            }
                            this.cleanQueue();
                            if (this.waitForTrailers) {
                                client.dispatch(.onWantTrailers, this.getIdentifier());
                            }
                            if (this.state == .CLOSED) {
                                client.dispatchWithExtra(.onStreamEnd, this.getIdentifier(), JSC.JSValue.jsNumber(@intFromEnum(this.state)));
                            }
                        }
                    }
                    return no_backpressure;
                }
            }
            // empty or cannot send data
            return true;
        }

        pub fn queueFrame(this: *Stream, bytes: []const u8, callback: JSC.JSValue, end_stream: bool) void {
            const client = this.client;
            const globalThis = client.globalThis;

            if (this.dataFrameQueue.peekLast()) |last_frame| {
                if (bytes.len == 0) {
                    // just merge the end_stream
                    last_frame.end_stream = end_stream;
                    // we can only hold 1 callback at a time so we conclude the last one, and keep the last one as pending
                    // this is fine is like a per-stream CORKING in a frame level
                    if (last_frame.callback.get()) |old_callback| {
                        client.dispatchArbitrary(old_callback);
                        last_frame.callback.deinit();
                    }
                    last_frame.callback = JSC.Strong.create(callback, globalThis);
                    return;
                }
                if (last_frame.len == 0) {
                    // we have an empty frame with means we can just use this frame with a new buffer
                    last_frame.buffer = client.allocator.alloc(u8, MAX_PAYLOAD_SIZE_WITHOUT_FRAME) catch bun.outOfMemory();
                }
                const max_size = MAX_PAYLOAD_SIZE_WITHOUT_FRAME;
                const remaining = max_size - last_frame.len;
                if (remaining > 0) {
                    // ok we can cork frames
                    const consumed_len = @min(remaining, bytes.len);
                    const merge = bytes[0..consumed_len];
                    @memcpy(last_frame.buffer[last_frame.len .. last_frame.len + consumed_len], merge);
                    last_frame.len += @intCast(consumed_len);
                    client.queuedDataSize += consumed_len;
                    //lets fallthrough if we still have some data
                    const more_data = bytes[consumed_len..];
                    if (more_data.len == 0) {
                        last_frame.end_stream = end_stream;
                        // we can only hold 1 callback at a time so we conclude the last one, and keep the last one as pending
                        // this is fine is like a per-stream CORKING in a frame level
                        if (last_frame.callback.get()) |old_callback| {
                            client.dispatchArbitrary(old_callback);
                            last_frame.callback.deinit();
                        }
                        last_frame.callback = JSC.Strong.create(callback, globalThis);
                        return;
                    }
                    // we keep the old callback because the new will be part of another frame
                    return this.queueFrame(more_data, callback, end_stream);
                }
            }
            log("{s} queued {} {}", .{ if (client.isServer) "server" else "client", bytes.len, end_stream });

            const frame: PendingFrame = .{
                .end_stream = end_stream,
                .len = @intCast(bytes.len),
                // we need to clone this data to send it later
                .buffer = if (bytes.len == 0) "" else client.allocator.alloc(u8, MAX_PAYLOAD_SIZE_WITHOUT_FRAME) catch bun.outOfMemory(),
                .callback = if (callback.isCallable(globalThis.vm())) JSC.Strong.create(callback, globalThis) else .{},
            };
            if (bytes.len > 0) {
                @memcpy(frame.buffer[0..bytes.len], bytes);
            }
            this.dataFrameQueue.enqueue(frame, client.allocator);
            client.outboundQueueSize += 1;
            client.queuedDataSize += frame.buffer.len;
        }

        pub fn init(streamIdentifier: u32, initialWindowSize: u32, client: *H2FrameParser) Stream {
            const stream = Stream{
                .id = streamIdentifier,
                .state = .OPEN,
                .windowSize = initialWindowSize,
                .usedWindowSize = 0,
                .weight = 36,
                .client = client,
                .dataFrameQueue = .{},
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
                .IDLE, .RESERVED_LOCAL, .RESERVED_REMOTE, .OPEN, .HALF_CLOSED_REMOTE => true,
                .HALF_CLOSED_LOCAL, .CLOSED => false,
            };
        }

        pub fn setContext(this: *Stream, value: JSValue, globalObject: *JSC.JSGlobalObject) void {
            var context = this.jsContext;
            defer context.deinit();
            this.jsContext = JSC.Strong.create(value, globalObject);
        }

        pub fn getIdentifier(this: *const Stream) JSValue {
            return this.jsContext.get() orelse return JSC.JSValue.jsNumber(this.id);
        }

        pub fn attachSignal(this: *Stream, signal: *JSC.WebCore.AbortSignal) void {
            this.signal = signal.ref().listen(Stream, this, Stream.abortListener);
        }

        pub fn detachContext(this: *Stream) void {
            var context = this.jsContext;
            defer context.deinit();
            this.jsContext = .{};
        }

        pub fn abortListener(this: *Stream, reason: JSValue) void {
            log("abortListener", .{});
            reason.ensureStillAlive();
            if (this.canReceiveData() or this.canSendData()) {
                this.state = .CLOSED;
                this.client.endStream(this, .CANCEL);
                this.client.dispatchWithExtra(.onAborted, this.getIdentifier(), reason);
            }
        }

        pub fn cleanQueue(this: *Stream) void {
            if (this.dataFrameQueue.data.capacity > 0) {
                const client = this.client;
                var dataFrameQueue = this.dataFrameQueue;
                this.dataFrameQueue = .{};

                defer dataFrameQueue.deinit(client.allocator);
                for (dataFrameQueue.slice()) |item| {
                    var frame = item;
                    client.queuedDataSize -= item.buffer.len;
                    frame.deinit(client.allocator);
                }
            }
        }
        pub fn deinit(this: *Stream) void {
            this.detachContext();
            this.cleanQueue();
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
        _ = settingsHeader.write(@TypeOf(writer), writer);
        this.localSettings = settings;
        _ = this.localSettings.write(@TypeOf(writer), writer);
        _ = this.write(&buffer);
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
        _ = frame.write(@TypeOf(writer), writer);
        var value: u32 = @intFromEnum(rstCode);
        stream.rstCode = value;
        value = @byteSwap(value);
        _ = writer.write(std.mem.asBytes(&value)) catch 0;

        stream.state = .CLOSED;
        stream.cleanQueue();
        if (rstCode == .NO_ERROR) {
            this.dispatchWithExtra(.onStreamEnd, stream.getIdentifier(), JSC.JSValue.jsNumber(@intFromEnum(stream.state)));
        } else {
            this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), JSC.JSValue.jsNumber(@intFromEnum(rstCode)));
        }

        _ = this.write(&buffer);
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
        _ = frame.write(@TypeOf(writer), writer);
        var last_id = UInt31WithReserved.from(lastStreamID);
        _ = last_id.write(@TypeOf(writer), writer);
        var value: u32 = @intFromEnum(rstCode);
        value = @byteSwap(value);
        _ = writer.write(std.mem.asBytes(&value)) catch 0;

        _ = this.write(&buffer);
        if (debug_data.len > 0) {
            _ = this.write(debug_data);
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
        if (!ack) {
            this.outStandingPings += 1;
        }
        var frame = FrameHeader{
            .type = @intFromEnum(FrameType.HTTP_FRAME_PING),
            .flags = if (ack) @intFromEnum(PingFrameFlags.ACK) else 0,
            .streamIdentifier = 0,
            .length = 8,
        };
        _ = frame.write(@TypeOf(writer), writer);
        _ = writer.write(payload) catch 0;
        _ = this.write(&buffer);
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
        _ = settingsHeader.write(@TypeOf(writer), writer);
        _ = this.localSettings.write(@TypeOf(writer), writer);
        _ = this.write(&preface_buffer);
        this.ajustWindowSize(null, @intCast(preface_buffer.len));
    }

    pub fn sendSettingsACK(this: *H2FrameParser) void {
        log("sendSettingsACK", .{});
        var buffer: [FrameHeader.byteSize]u8 = undefined;
        @memset(&buffer, 0);
        var stream = std.io.fixedBufferStream(&buffer);
        const writer = stream.writer();
        var settingsHeader: FrameHeader = .{
            .type = @intFromEnum(FrameType.HTTP_FRAME_SETTINGS),
            .flags = @intFromEnum(SettingsFlags.ACK),
            .streamIdentifier = 0,
            .length = 0,
        };
        _ = settingsHeader.write(@TypeOf(writer), writer);
        _ = this.write(&buffer);
        this.firstSettingsACK = true;
        this.ajustWindowSize(null, @intCast(buffer.len));
        this.flushPending();
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
        _ = settingsHeader.write(@TypeOf(writer), writer);
        // always clear reserved bit
        const cleanWindowSize: UInt31WithReserved = .{
            .reserved = false,
            .uint31 = windowSize.uint31,
        };
        _ = cleanWindowSize.write(@TypeOf(writer), writer);
        _ = this.write(&buffer);
    }

    pub fn dispatch(this: *H2FrameParser, comptime event: @Type(.EnumLiteral), value: JSC.JSValue) void {
        JSC.markBinding(@src());
        const ctx_value = this.strong_ctx.get() orelse return;
        value.ensureStillAlive();
        _ = this.handlers.callEventHandler(event, ctx_value, &[_]JSC.JSValue{ ctx_value, value });
    }

    pub fn call(this: *H2FrameParser, comptime event: @Type(.EnumLiteral), value: JSC.JSValue) JSValue {
        JSC.markBinding(@src());
        const ctx_value = this.strong_ctx.get() orelse return .zero;
        value.ensureStillAlive();
        return this.handlers.callEventHandlerWithResult(event, ctx_value, &[_]JSC.JSValue{ ctx_value, value });
    }
    pub fn dispatchArbitrary(this: *H2FrameParser, callback: JSC.JSValue) void {
        JSC.markBinding(@src());
        _ = this.handlers.callArbitraryCallBack(callback, .undefined, &[_]JSC.JSValue{});
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

    fn cork(this: *H2FrameParser) void {
        if (CORKED_H2) |corked| {
            if (@intFromPtr(corked) == @intFromPtr(this)) {
                // already corked
                return;
            }
            // force uncork
            corked.flushCorked();
        }
        // cork
        CORKED_H2 = this;
        log("cork {*}", .{this});
        CORK_OFFSET = 0;
    }

    pub fn _genericFlush(this: *H2FrameParser, comptime T: type, socket: T) usize {
        const buffer = this.writeBuffer.slice()[this.writeBufferOffset..];
        if (buffer.len > 0) {
            const result: i32 = socket.writeMaybeCorked(buffer, false);
            const written: u32 = if (result < 0) 0 else @intCast(result);

            if (written < buffer.len) {
                this.writeBufferOffset += written;
                return written;
            }

            // all the buffer was written! reset things
            this.writeBufferOffset = 0;
            this.writeBuffer.len = 0;
            // lets keep size under control
            if (this.writeBuffer.cap > MAX_BUFFER_SIZE) {
                this.writeBuffer.shrinkAndFree(this.allocator, MAX_BUFFER_SIZE);
            }
        }
        return buffer.len;
    }

    pub fn _genericWrite(this: *H2FrameParser, comptime T: type, socket: T, bytes: []const u8) bool {
        log("_genericWrite {}", .{bytes.len});
        const buffer = this.writeBuffer.slice()[this.writeBufferOffset..];
        if (buffer.len > 0) {
            {
                const result: i32 = socket.writeMaybeCorked(buffer, false);
                const written: u32 = if (result < 0) 0 else @intCast(result);
                if (written < buffer.len) {
                    this.writeBufferOffset += written;

                    // we still have more to buffer and even more now
                    _ = this.writeBuffer.write(this.allocator, bytes) catch bun.outOfMemory();
                    log("_genericWrite flushed {} and buffered more {}", .{ written, bytes.len });
                    return false;
                }
            }
            // all the buffer was written!
            this.writeBufferOffset = 0;
            this.writeBuffer.len = 0;
            {
                const result: i32 = socket.writeMaybeCorked(bytes, false);
                const written: u32 = if (result < 0) 0 else @intCast(result);
                if (written < bytes.len) {
                    // ops not all data was sent, lets buffer again
                    _ = this.writeBuffer.write(this.allocator, bytes[written..]) catch bun.outOfMemory();
                    log("_genericWrite buffered more {}", .{bytes[written..].len});
                    return false;
                }
            }
            // lets keep size under control
            if (this.writeBuffer.cap > MAX_BUFFER_SIZE and this.writeBuffer.len <= MAX_BUFFER_SIZE) {
                this.writeBuffer.shrinkAndFree(this.allocator, MAX_BUFFER_SIZE);
            }
            return true;
        }
        const result: i32 = socket.writeMaybeCorked(bytes, false);
        const written: u32 = if (result < 0) 0 else @intCast(result);
        if (written < bytes.len) {
            // ops not all data was sent, lets buffer again
            _ = this.writeBuffer.write(this.allocator, bytes[written..]) catch bun.outOfMemory();
            return false;
        }
        return true;
    }

    fn flushStreamQueue(this: *H2FrameParser) usize {
        log("flushStreamQueue {}", .{this.outboundQueueSize});
        // we still need to wait the first ACK before sending the data frames.
        if (this.pendingBuffer.len > 0) return 0;
        var written: usize = 0;
        // try to send as much as we can until we reach backpressure
        while (this.outboundQueueSize > 0) {
            var it = this.streams.iterator();
            while (it.next()) |*entry| {
                var stream = entry.value_ptr.*;
                // reach backpressure
                if (!stream.flushQueue(&written)) return written;
            }
        }
        return written;
    }

    pub fn flush(this: *H2FrameParser) usize {
        var written = switch (this.native_socket) {
            .tls_writeonly, .tls => |socket| this._genericFlush(*TLSSocket, socket),
            .tcp_writeonly, .tcp => |socket| this._genericFlush(*TCPSocket, socket),
            else => {
                // consider that backpressure is gone and flush data queue
                this.has_nonnative_backpressure = false;
                return this.flushStreamQueue();
            },
        };
        // if no backpressure flush data queue
        if (!this.hasBackpressure()) {
            written += this.flushStreamQueue();
        }
        return written;
    }

    pub fn _write(this: *H2FrameParser, bytes: []const u8) bool {
        return switch (this.native_socket) {
            .tls_writeonly, .tls => |socket| this._genericWrite(*TLSSocket, socket, bytes),
            .tcp_writeonly, .tcp => |socket| this._genericWrite(*TCPSocket, socket, bytes),
            else => {
                // fallback to onWrite non-native callback
                const output_value = this.handlers.binary_type.toJS(bytes, this.handlers.globalObject);
                const result = this.call(.onWrite, output_value);
                if (result.isBoolean() and result.toBoolean()) {
                    this.has_nonnative_backpressure = false;
                    return true;
                }
                // wait for flushing
                this.has_nonnative_backpressure = true;
                return false;
            },
        };
    }

    fn hasBackpressure(this: *H2FrameParser) bool {
        return this.pendingBuffer.len > 0 or this.writeBuffer.len > 0 or this.has_nonnative_backpressure;
    }

    fn flushCorked(this: *H2FrameParser) void {
        if (CORKED_H2) |corked| {
            if (@intFromPtr(corked) == @intFromPtr(this)) {
                log("uncork {*}", .{this});

                const bytes = CORK_BUFFER[0..CORK_OFFSET];
                CORK_OFFSET = 0;
                if (bytes.len > 0) {
                    _ = this._write(bytes);
                }
            }
        }
    }

    fn onAutoUncork(this: *H2FrameParser) void {
        this.autouncork_registered = false;
        this.flushCorked();
        this.unref();
    }

    pub fn write(this: *H2FrameParser, bytes: []const u8) bool {
        JSC.markBinding(@src());
        log("write {}", .{bytes.len});
        if (comptime ENABLE_AUTO_CORK) {
            this.cork();
            const available = CORK_BUFFER[CORK_OFFSET..];
            if (bytes.len > available.len) {
                // not worth corking
                if (CORK_OFFSET != 0) {
                    // clean already corked data
                    this.flushCorked();
                }
                return this._write(bytes);
            } else {
                // write at the cork buffer
                CORK_OFFSET += @truncate(bytes.len);
                @memcpy(available[0..bytes.len], bytes);

                // register auto uncork
                if (!this.autouncork_registered) {
                    this.autouncork_registered = true;
                    this.ref();
                    bun.uws.Loop.get().nextTick(*H2FrameParser, this, H2FrameParser.onAutoUncork);
                }
                // corked
                return true;
            }
        } else {
            return this._write(bytes);
        }
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
            // we automatically send a window update when receiving one if we are a client
            if (!this.isServer) {
                this.sendWindowUpdate(frame.streamIdentifier, windowSizeIncrement);
            }
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

    pub fn decodeHeaderBlock(this: *H2FrameParser, payload: []const u8, stream: *Stream, flags: u8) void {
        log("decodeHeaderBlock isSever: {}", .{this.isServer});

        var offset: usize = 0;

        const globalObject = this.handlers.globalObject;

        const headers = JSC.JSValue.createEmptyObject(globalObject, 0);
        headers.ensureStillAlive();
        const stream_id = stream.id;
        var count: u32 = 0;
        while (true) {
            const header = this.decode(payload[offset..]) catch break;
            offset += header.next;
            log("header {s} {s}", .{ header.name, header.value });
            if (this.isServer and strings.eqlComptime(header.name, ":status")) {
                this.sendGoAway(stream_id, ErrorCode.PROTOCOL_ERROR, "Server received :status header", this.lastStreamID);
                return;
            }

            if (headers.getTruthy(globalObject, header.name)) |current_value| {
                // Duplicated of single value headers are discarded
                if (SingleValueHeaders.has(header.name)) {
                    continue;
                }
                count += 1;

                if (this.maxHeaderListPairs < count) {
                    this.rejectedStreams += 1;
                    if (this.maxRejectedStreams <= this.rejectedStreams) {
                        this.sendGoAway(stream_id, ErrorCode.ENHANCE_YOUR_CALM, "ENHANCE_YOUR_CALM", this.lastStreamID);
                    } else {
                        this.endStream(stream, ErrorCode.ENHANCE_YOUR_CALM);
                    }
                    return;
                }

                var value_str = bun.String.fromUTF8(header.value);
                const value = value_str.transferToJS(globalObject);

                if (current_value.jsType().isArray()) {
                    current_value.push(globalObject, value);
                } else {
                    const array = JSC.JSValue.createEmptyArray(globalObject, 2);
                    array.putIndex(globalObject, 0, current_value);
                    array.putIndex(globalObject, 1, value);
                    const name = WellKnowHeaders.get(header.name) orelse bun.String.fromUTF8(header.name);
                    defer name.deref();

                    headers.put(globalObject, &name, array);
                }
            } else {
                count += 1;

                if (this.maxHeaderListPairs < count) {
                    this.rejectedStreams += 1;
                    if (this.maxRejectedStreams <= this.rejectedStreams) {
                        this.sendGoAway(stream_id, ErrorCode.ENHANCE_YOUR_CALM, "ENHANCE_YOUR_CALM", this.lastStreamID);
                    } else {
                        this.endStream(stream, ErrorCode.ENHANCE_YOUR_CALM);
                    }
                    return;
                }
                const name = WellKnowHeaders.get(header.name) orelse bun.String.fromUTF8(header.name);
                defer name.deref();
                var value_str = bun.String.fromUTF8(header.value);
                const value = value_str.transferToJS(globalObject);
                headers.put(globalObject, &name, value);
            }
            if (offset >= payload.len) {
                break;
            }
        }

        this.dispatchWith2Extra(.onStreamHeaders, stream.getIdentifier(), headers, JSC.JSValue.jsNumber(flags));
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
            this.dispatchWithExtra(.onStreamData, stream.getIdentifier(), chunk);
        } else {
            data_needed = 0;
        }

        if (this.remainingLength == 0) {
            this.currentFrame = null;
            if (frame.flags & @intFromEnum(DataFrameFlags.END_STREAM) != 0) {
                if (stream.state == .HALF_CLOSED_LOCAL) {
                    stream.state = .CLOSED;
                } else {
                    stream.state = .HALF_CLOSED_REMOTE;
                }
                this.dispatchWithExtra(.onStreamEnd, stream.getIdentifier(), JSC.JSValue.jsNumber(@intFromEnum(stream.state)));
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
            } else {
                this.outStandingPings -|= 1;
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
            if (stream_identifier.uint31 == stream.id) {
                this.sendGoAway(stream.id, ErrorCode.PROTOCOL_ERROR, "Priority frame with self dependency", this.lastStreamID);
                return data.len;
            }
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
            this.decodeHeaderBlock(payload[0..payload.len], stream, frame.flags);
            this.readBuffer.reset();
            if (frame.flags & @intFromEnum(HeadersFrameFlags.END_HEADERS) != 0) {
                if (stream.state == .HALF_CLOSED_REMOTE) {
                    // no more continuation headers we can call it closed
                    stream.state = .CLOSED;
                } else {
                    stream.state = .HALF_CLOSED_LOCAL;
                }
                this.dispatchWithExtra(.onStreamEnd, stream.getIdentifier(), JSC.JSValue.jsNumber(@intFromEnum(stream.state)));
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
            this.decodeHeaderBlock(payload[offset..end], stream, frame.flags);
            this.readBuffer.reset();
            stream.isWaitingMoreHeaders = frame.flags & @intFromEnum(HeadersFrameFlags.END_HEADERS) == 0;
            if (frame.flags & @intFromEnum(HeadersFrameFlags.END_STREAM) != 0) {
                if (stream.isWaitingMoreHeaders) {
                    stream.state = .HALF_CLOSED_REMOTE;
                } else {
                    // no more continuation headers we can call it closed
                    if (stream.state == .HALF_CLOSED_LOCAL) {
                        stream.state = .CLOSED;
                    } else {
                        stream.state = .HALF_CLOSED_REMOTE;
                    }
                    this.dispatchWithExtra(.onStreamEnd, stream.getIdentifier(), JSC.JSValue.jsNumber(@intFromEnum(stream.state)));
                    return content.end;
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
            if (frame.flags & @intFromEnum(SettingsFlags.ACK) != 0 or frame.length % settingByteSize != 0) {
                log("invalid settings frame size", .{});
                this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "Invalid settings frame size", this.lastStreamID);
                return data.len;
            }
        } else {
            if (frame.flags & @intFromEnum(SettingsFlags.ACK) != 0) {
                // we received an ACK
                log("settings frame ACK", .{});

                // we can now write any request
                this.firstSettingsACK = true;
                this.flushPending();
                this.remoteSettings = this.localSettings;
                this.dispatch(.onLocalSettings, this.localSettings.toJS(this.handlers.globalObject));
            }
            this.currentFrame = null;
            return 0;
        }

        defer if (this.isServer) this.sendSettingsACK();

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

    pub fn readBytes(this: *H2FrameParser, bytes: []const u8) usize {
        log("read", .{});
        if (this.isServer and this.prefaceReceivedLen < 24) {
            // Handle Server Preface
            const preface_missing: usize = 24 - this.prefaceReceivedLen;
            const preface_available = @min(preface_missing, bytes.len);
            if (!strings.eql(bytes[0..preface_available], "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"[this.prefaceReceivedLen .. preface_available + this.prefaceReceivedLen])) {
                // invalid preface
                this.dispatchWithExtra(.onError, JSC.JSValue.jsNumber(@intFromEnum(ErrorCode.PROTOCOL_ERROR)), JSC.JSValue.jsNumber(this.lastStreamID));
                return bytes.len;
            }
            this.prefaceReceivedLen += @intCast(preface_available);
            return preface_available;
        }
        if (this.currentFrame) |header| {
            log("current frame {s} {} {} {} {}", .{ if (this.isServer) "server" else "client", header.type, header.length, header.flags, header.streamIdentifier });

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

        var header: FrameHeader = .{ .flags = 0 };
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

        log("new frame {s} {} {} {} {}", .{ if (this.isServer) "server" else "client", header.type, header.length, header.flags, header.streamIdentifier });
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
        pub fn write(this: *const DirectWriterStruct, data: []const u8) !usize {
            if (this.shouldBuffer) {
                return this.writer.pendingBuffer.write(this.writer.allocator, data) catch 0;
            }
            return if (this.writer.write(data)) data.len else 0;
        }
    };

    fn toWriter(this: *H2FrameParser) DirectWriterStruct {
        return DirectWriterStruct{ .writer = this, .shouldBuffer = false };
    }

    fn getBufferWriter(this: *H2FrameParser) DirectWriterStruct {
        return DirectWriterStruct{ .writer = this, .shouldBuffer = true };
    }

    fn flushPending(this: *H2FrameParser) void {
        if (this.pendingBuffer.len > 0) {
            const slice = this.pendingBuffer.slice();
            _ = this.write(slice);
            // we will only flush one time
            this.pendingBuffer.deinitWithAllocator(this.allocator);
            _ = this.flushStreamQueue();
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
        result.put(globalObject, JSC.ZigString.static("outboundQueueSize"), JSC.JSValue.jsNumber(this.outboundQueueSize));
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

        if (this.outStandingPings >= this.maxOutstandingPings) {
            const exception = JSC.toTypeError(.ERR_HTTP2_PING_CANCEL, "HTTP2 ping cancelled", .{}, globalObject);
            globalObject.throwValue(exception);
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
        if (parent_id == stream.id) {
            this.sendGoAway(stream.id, ErrorCode.PROTOCOL_ERROR, "Stream with self dependency", this.lastStreamID);
            return JSC.JSValue.jsBoolean(false);
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
            _ = frame.write(@TypeOf(writer), writer);
            _ = priority.write(@TypeOf(writer), writer);
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

    const MemoryWriter = struct {
        buffer: []u8,
        offset: usize = 0,
        pub fn slice(this: *MemoryWriter) []const u8 {
            return this.buffer[0..this.offset];
        }
        pub fn write(this: *MemoryWriter, data: []const u8) !usize {
            const pending = this.buffer[this.offset..];
            bun.debugAssert(pending.len >= data.len);
            @memcpy(pending[0..data.len], data);
            this.offset += data.len;
            return data.len;
        }
    };
    // get memory usage in MB
    fn getSessionMemoryUsage(this: *H2FrameParser) usize {
        return (this.pendingBuffer.len + this.writeBuffer.len + this.queuedDataSize) / 1024 / 1024;
    }

    fn sendData(this: *H2FrameParser, stream: *Stream, payload: []const u8, close: bool, callback: JSC.JSValue) void {
        log("{s} sendData({}, {}, {})", .{ if (stream.client.isServer) "server" else "client", stream.id, payload.len, close });

        const writer = if (this.firstSettingsACK) this.toWriter() else this.getBufferWriter();
        const stream_id = stream.id;
        if (close) {
            stream.closeAfterDrain = close;
        }
        var enqueued = false;
        defer if (!enqueued) {
            this.dispatchArbitrary(callback);
            if (close) {
                if (stream.state == .HALF_CLOSED_REMOTE) {
                    stream.state = .CLOSED;
                } else {
                    stream.state = .HALF_CLOSED_LOCAL;
                }
                if (stream.waitForTrailers) {
                    this.dispatch(.onWantTrailers, stream.getIdentifier());
                }
                if (stream.state == .CLOSED) {
                    this.dispatchWithExtra(.onStreamEnd, stream.getIdentifier(), JSC.JSValue.jsNumber(@intFromEnum(stream.state)));
                }
            }
        };
        if (payload.len == 0) {
            // empty payload we still need to send a frame
            var dataHeader: FrameHeader = .{
                .type = @intFromEnum(FrameType.HTTP_FRAME_DATA),
                .flags = if (close) @intFromEnum(DataFrameFlags.END_STREAM) else 0,
                .streamIdentifier = @intCast(stream_id),
                .length = 0,
            };
            if (this.hasBackpressure() or this.outboundQueueSize > 0) {
                enqueued = true;
                stream.queueFrame("", callback, close);
            } else {
                _ = dataHeader.write(@TypeOf(writer), writer);
            }
        } else {
            // max frame size will always be at least 16384
            const max_size = MAX_PAYLOAD_SIZE_WITHOUT_FRAME;

            var offset: usize = 0;

            while (offset < payload.len) {
                const size = @min(payload.len - offset, max_size);
                const slice = payload[offset..(size + offset)];
                offset += size;
                const end_stream = offset >= payload.len and close;

                if (this.hasBackpressure() or this.outboundQueueSize > 0) {
                    enqueued = true;
                    // write the full frame in memory and queue the frame
                    stream.queueFrame(slice, callback, end_stream);
                } else {
                    const padding = stream.getPadding(size, max_size - 1);
                    const payload_size = size + (if (padding != 0) padding + 1 else 0);
                    var flags: u8 = if (end_stream) @intFromEnum(DataFrameFlags.END_STREAM) else 0;
                    if (padding != 0) {
                        flags |= @intFromEnum(DataFrameFlags.PADDED);
                    }
                    var dataHeader: FrameHeader = .{
                        .type = @intFromEnum(FrameType.HTTP_FRAME_DATA),
                        .flags = flags,
                        .streamIdentifier = @intCast(stream_id),
                        .length = payload_size,
                    };
                    _ = dataHeader.write(@TypeOf(writer), writer);
                    if (padding != 0) {
                        var buffer = shared_request_buffer[0..];
                        bun.memmove(buffer[1..size], buffer[0..size]);
                        buffer[0] = padding;
                        _ = writer.write(buffer[0 .. FrameHeader.byteSize + payload_size]) catch 0;
                    } else {
                        _ = writer.write(slice) catch 0;
                    }
                }
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
            if (header_name.length() == 0) continue;

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
                        this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), JSC.JSValue.jsNumber(stream.rstCode));
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
                    this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), JSC.JSValue.jsNumber(stream.rstCode));
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
        _ = frame.write(@TypeOf(writer), writer);
        _ = writer.write(buffer[0..encoded_size]) catch 0;

        return .undefined;
    }
    pub fn writeStream(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(4);
        if (args_list.len < 4) {
            globalObject.throw("Expected stream, data, endStream and callback arguments", .{});
            return .zero;
        }

        const stream_arg = args_list.ptr[0];
        const data_arg = args_list.ptr[1];
        const close_arg = args_list.ptr[2];
        const callback_arg = args_list.ptr[3];

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
        if (!stream.canSendData() or stream.closeAfterDrain) {
            this.dispatchArbitrary(callback_arg);
            return JSC.JSValue.jsBoolean(false);
        }

        if (data_arg.asArrayBuffer(globalObject)) |array_buffer| {
            const payload = array_buffer.slice();
            this.sendData(stream, payload, close and !stream.waitForTrailers, callback_arg);
        } else if (bun.String.tryFromJS(data_arg, globalObject)) |bun_str| {
            defer bun_str.deref();
            var zig_str = bun_str.toUTF8WithoutRef(bun.default_allocator);
            defer zig_str.deinit();
            const payload = zig_str.slice();
            this.sendData(stream, payload, close and !stream.waitForTrailers, callback_arg);
        } else {
            if (!globalObject.hasException())
                globalObject.throw("Expected data to be an ArrayBuffer or a string", .{});
            return .zero;
        }

        return JSC.JSValue.jsBoolean(true);
    }

    fn getNextStreamID(this: *H2FrameParser) u32 {
        var stream_id: u32 = this.lastStreamID;
        if (this.isServer) {
            if (stream_id % 2 == 0) {
                stream_id += 2;
            } else {
                stream_id += 1;
            }
        } else {
            if (stream_id % 2 == 0) {
                stream_id += 1;
            } else if (stream_id == 0) {
                stream_id = 1;
            } else {
                stream_id += 2;
            }
        }
        return stream_id;
    }

    pub fn hasNativeRead(this: *H2FrameParser, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSValue {
        return JSC.JSValue.jsBoolean(this.native_socket == .tcp or this.native_socket == .tls);
    }

    pub fn getNextStream(this: *H2FrameParser, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const id = this.getNextStreamID();
        _ = this.handleReceivedStreamID(id) orelse {
            return JSC.JSValue.jsNumber(-1);
        };

        return JSC.JSValue.jsNumber(id);
    }

    pub fn getStreamContext(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(1);
        if (args_list.len < 1) {
            globalObject.throw("Expected stream_id argument", .{});
            return .zero;
        }

        const stream_id_arg = args_list.ptr[0];
        if (!stream_id_arg.isNumber()) {
            globalObject.throw("Expected stream_id to be a number", .{});
            return .zero;
        }

        var stream = this.streams.getPtr(stream_id_arg.to(u32)) orelse {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        };

        return stream.jsContext.get() orelse .undefined;
    }

    pub fn setStreamContext(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(2);
        if (args_list.len < 2) {
            globalObject.throw("Expected stream_id and context arguments", .{});
            return .zero;
        }

        const stream_id_arg = args_list.ptr[0];
        if (!stream_id_arg.isNumber()) {
            globalObject.throw("Expected stream_id to be a number", .{});
            return .zero;
        }
        var stream = this.streams.getPtr(stream_id_arg.to(u32)) orelse {
            globalObject.throw("Invalid stream id", .{});
            return .zero;
        };
        const context_arg = args_list.ptr[1];
        if (!context_arg.isObject()) {
            globalObject.throw("Expected context to be an object", .{});
            return .zero;
        }

        stream.setContext(context_arg, globalObject);
        return .undefined;
    }

    pub fn getAllStreams(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());

        const array = JSC.JSValue.createEmptyArray(globalObject, this.streams.count());
        var count: u32 = 0;
        var it = this.streams.iterator();
        while (it.next()) |*entry| {
            var stream = entry.value_ptr.*;
            const value = stream.jsContext.get() orelse continue;
            array.putIndex(globalObject, count, value);
            count += 1;
        }
        return array;
    }

    pub fn emitErrorToAllStreams(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());

        const args_list = callframe.arguments(1);
        if (args_list.len < 1) {
            globalObject.throw("Expected error argument", .{});
            return .undefined;
        }
        var it = this.streams.iterator();
        while (it.next()) |*entry| {
            var stream = entry.value_ptr.*;
            if (stream.state != .CLOSED) {
                stream.state = .CLOSED;
                stream.rstCode = args_list.ptr[0].to(u32);
                this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), args_list.ptr[0]);
            }
        }
        return .undefined;
    }

    pub fn flushFromJS(this: *H2FrameParser, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());

        return JSC.JSValue.jsNumber(this.flush());
    }

    pub fn request(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
        JSC.markBinding(@src());

        const args_list = callframe.arguments(5);
        if (args_list.len < 4) {
            globalObject.throw("Expected stream_id, stream_ctx, headers and sensitiveHeaders arguments", .{});
            return .zero;
        }

        const stream_id_arg = args_list.ptr[0];
        const stream_ctx_arg = args_list.ptr[1];

        const headers_arg = args_list.ptr[2];
        const sensitive_arg = args_list.ptr[3];

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

        const stream_id: u32 = if (!stream_id_arg.isEmptyOrUndefinedOrNull() and stream_id_arg.isNumber()) stream_id_arg.to(u32) else this.getNextStreamID();
        if (stream_id > MAX_STREAM_ID) {
            return JSC.JSValue.jsNumber(-1);
        }

        // we iterate twice, because pseudo headers must be sent first, but can appear anywhere in the headers object
        var iter = JSC.JSPropertyIterator(.{
            .skip_empty_name = false,
            .include_value = true,
        }).init(globalObject, headers_arg);
        defer iter.deinit();
        var header_count: u32 = 0;
        for (0..2) |ignore_pseudo_headers| {
            iter.reset();

            while (iter.next()) |header_name| {
                const name_slice = header_name.toUTF8(bun.default_allocator);
                defer name_slice.deinit();
                const name = name_slice.slice();
                defer header_count += 1;
                if (this.maxHeaderListPairs < header_count) {
                    this.rejectedStreams += 1;
                    const stream = this.handleReceivedStreamID(stream_id) orelse {
                        return JSC.JSValue.jsNumber(-1);
                    };
                    if (!stream_ctx_arg.isEmptyOrUndefinedOrNull() and stream_ctx_arg.isObject()) {
                        stream.setContext(stream_ctx_arg, globalObject);
                    }
                    stream.state = .CLOSED;
                    stream.rstCode = @intFromEnum(ErrorCode.ENHANCE_YOUR_CALM);
                    this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), JSC.JSValue.jsNumber(stream.rstCode));
                    return JSC.JSValue.jsNumber(stream.id);
                }

                if (header_name.charAt(0) == ':') {
                    if (ignore_pseudo_headers == 1) continue;

                    if (this.isServer) {
                        if (!ValidPseudoHeaders.has(name)) {
                            const exception = JSC.toTypeError(.ERR_HTTP2_INVALID_PSEUDOHEADER, "\"{s}\" is an invalid pseudoheader or is used incorrectly", .{name}, globalObject);
                            globalObject.throwValue(exception);
                            return .zero;
                        }
                    } else {
                        if (!ValidRequestPseudoHeaders.has(name)) {
                            const exception = JSC.toTypeError(.ERR_HTTP2_INVALID_PSEUDOHEADER, "\"{s}\" is an invalid pseudoheader or is used incorrectly", .{name}, globalObject);
                            globalObject.throwValue(exception);
                            return .zero;
                        }
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
                            if (!stream_ctx_arg.isEmptyOrUndefinedOrNull() and stream_ctx_arg.isObject()) {
                                stream.setContext(stream_ctx_arg, globalObject);
                            }
                            stream.state = .CLOSED;
                            stream.rstCode = @intFromEnum(ErrorCode.COMPRESSION_ERROR);
                            this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), JSC.JSValue.jsNumber(stream.rstCode));
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
                        if (!stream_ctx_arg.isEmptyOrUndefinedOrNull() and stream_ctx_arg.isObject()) {
                            stream.setContext(stream_ctx_arg, globalObject);
                        }
                        stream.rstCode = @intFromEnum(ErrorCode.COMPRESSION_ERROR);
                        this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), JSC.JSValue.jsNumber(stream.rstCode));
                        return JSC.JSValue.jsNumber(stream.id);
                    };
                }
            }
        }
        const stream = this.handleReceivedStreamID(stream_id) orelse {
            return JSC.JSValue.jsNumber(-1);
        };
        if (!stream_ctx_arg.isEmptyOrUndefinedOrNull() and stream_ctx_arg.isObject()) {
            stream.setContext(stream_ctx_arg, globalObject);
        }
        var flags: u8 = @intFromEnum(HeadersFrameFlags.END_HEADERS);
        var exclusive: bool = false;
        var has_priority: bool = false;
        var weight: i32 = 0;
        var parent: i32 = 0;
        var waitForTrailers: bool = false;
        var end_stream: bool = false;
        if (args_list.len > 3 and !args_list.ptr[3].isEmptyOrUndefinedOrNull()) {
            const options = args_list.ptr[3];
            if (!options.isObject()) {
                stream.state = .CLOSED;
                stream.rstCode = @intFromEnum(ErrorCode.INTERNAL_ERROR);
                this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), JSC.JSValue.jsNumber(stream.rstCode));
                return JSC.JSValue.jsNumber(stream.id);
            }

            if (options.get(globalObject, "paddingStrategy")) |padding_js| {
                if (padding_js.isNumber()) {
                    stream.paddingStrategy = switch (padding_js.to(u32)) {
                        1 => .aligned,
                        2 => .max,
                        else => .none,
                    };
                }
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
                        this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), JSC.JSValue.jsNumber(stream.rstCode));
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
                        this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), JSC.JSValue.jsNumber(stream.rstCode));
                        return JSC.JSValue.jsNumber(stream.id);
                    }
                    stream.weight = @intCast(weight);
                }

                if (weight < 1 or weight > 256) {
                    stream.state = .CLOSED;
                    stream.rstCode = @intFromEnum(ErrorCode.INTERNAL_ERROR);
                    this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), JSC.JSValue.jsNumber(stream.rstCode));
                    return JSC.JSValue.jsNumber(stream.id);
                }
                stream.weight = @intCast(weight);
            }

            if (options.get(globalObject, "signal")) |signal_arg| {
                if (signal_arg.as(JSC.WebCore.AbortSignal)) |signal_| {
                    if (signal_.aborted()) {
                        stream.state = .CLOSED;
                        stream.rstCode = @intFromEnum(ErrorCode.CANCEL);
                        this.dispatchWithExtra(.onAborted, stream.getIdentifier(), signal_.abortReason());
                        return JSC.JSValue.jsNumber(stream.id);
                    }
                    stream.attachSignal(signal_);
                }
            }
        }
        // too much memory being use
        if (this.getSessionMemoryUsage() > this.maxSessionMemory) {
            stream.state = .CLOSED;
            stream.rstCode = @intFromEnum(ErrorCode.ENHANCE_YOUR_CALM);
            this.rejectedStreams += 1;
            this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), JSC.JSValue.jsNumber(stream.rstCode));
            if (this.rejectedStreams >= this.maxRejectedStreams) {
                const chunk = this.handlers.binary_type.toJS("ENHANCE_YOUR_CALM", this.handlers.globalObject);
                this.dispatchWith2Extra(.onError, JSC.JSValue.jsNumber(@intFromEnum(ErrorCode.ENHANCE_YOUR_CALM)), JSC.JSValue.jsNumber(this.lastStreamID), chunk);
            }
            return .zero;
        }
        var length: usize = encoded_size;
        if (has_priority) {
            length += 5;
            flags |= @intFromEnum(HeadersFrameFlags.PRIORITY);
        }

        log("request encoded_size {}", .{encoded_size});
        const padding = stream.getPadding(encoded_size, buffer.len - 1);
        const payload_size = encoded_size + (if (padding != 0) padding + 1 else 0);
        if (padding != 0) {
            flags |= @intFromEnum(HeadersFrameFlags.PADDED);
        }
        var frame: FrameHeader = .{
            .type = @intFromEnum(FrameType.HTTP_FRAME_HEADERS),
            .flags = flags,
            .streamIdentifier = stream.id,
            .length = @intCast(payload_size),
        };

        const writer = if (this.firstSettingsACK) this.toWriter() else this.getBufferWriter();
        _ = frame.write(@TypeOf(writer), writer);
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

            _ = priority.write(@TypeOf(writer), writer);
        }
        if (padding != 0) {
            bun.memmove(buffer[1..encoded_size], buffer[0..encoded_size]);
            buffer[0] = padding;
        }
        _ = writer.write(buffer[0..payload_size]) catch 0;

        if (end_stream) {
            stream.state = .HALF_CLOSED_LOCAL;

            if (waitForTrailers) {
                this.dispatch(.onWantTrailers, stream.getIdentifier());
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

    pub fn onNativeRead(ctx: ?*anyopaque, data: []const u8) void {
        const self = ctx orelse return;
        const this = bun.cast(*H2FrameParser, self);
        var bytes = data;
        while (bytes.len > 0) {
            const result = this.readBytes(bytes);
            bytes = bytes[result..];
        }
    }

    pub fn onNativeWritable(ctx: ?*anyopaque) void {
        const self = ctx orelse return;
        const this = bun.cast(*H2FrameParser, self);
        _ = this.flush();
    }

    pub fn onNativeClose(ctx: ?*anyopaque) void {
        const self = ctx orelse return;
        const this = bun.cast(*H2FrameParser, self);
        this.detachNativeSocket();
    }

    pub fn setNativeSocketFromJS(this: *H2FrameParser, globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        JSC.markBinding(@src());
        const args_list = callframe.arguments(1);
        if (args_list.len < 1) {
            globalObject.throw("Expected socket argument", .{});
            return .zero;
        }

        const socket_js = args_list.ptr[0];
        if (JSTLSSocket.fromJS(socket_js)) |socket| {
            log("TLSSocket attached", .{});

            if (socket.native_callbacks.ctx == null) {
                socket.native_callbacks.onData = H2FrameParser.onNativeRead;
                socket.native_callbacks.onClose = H2FrameParser.onNativeClose;
                socket.native_callbacks.onWritable = H2FrameParser.onNativeWritable;
                socket.native_callbacks.ctx = bun.cast(*anyopaque, this);
                this.native_socket = .{ .tls = socket };
            } else {
                this.native_socket = .{ .tls_writeonly = socket };
            }
            // if we started with non native and go to native we now control the backpressure internally
            this.has_nonnative_backpressure = false;
        } else if (JSTCPSocket.fromJS(socket_js)) |socket| {
            log("TCPSocket attached", .{});
            if (socket.native_callbacks.ctx == null) {
                socket.native_callbacks.onData = H2FrameParser.onNativeRead;
                socket.native_callbacks.onClose = H2FrameParser.onNativeClose;
                socket.native_callbacks.onWritable = H2FrameParser.onNativeWritable;
                socket.native_callbacks.ctx = bun.cast(*anyopaque, this);
                this.native_socket = .{ .tcp = socket };
            } else {
                this.native_socket = .{ .tcp_writeonly = socket };
            }
            // if we started with non native and go to native we now control the backpressure internally
            this.has_nonnative_backpressure = false;
        }
        return .undefined;
    }

    pub fn detachNativeSocket(this: *H2FrameParser) void {
        switch (this.native_socket) {
            .tls => |socket| {
                if (socket.native_callbacks.ctx != null) {
                    socket.native_callbacks.ctx = null;
                    socket.native_callbacks.onData = null;
                    socket.native_callbacks.onClose = null;
                    socket.native_callbacks.onWritable = null;
                }
            },
            .tcp => |socket| {
                if (socket.native_callbacks.ctx != null) {
                    socket.native_callbacks.ctx = null;
                    socket.native_callbacks.onData = null;
                    socket.native_callbacks.onWritable = null;
                }
            },
            else => {},
        }
        this.native_socket = .{ .none = {} };
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
        var this = h2frameparser_allocator.tryGet() catch bun.outOfMemory();

        this.* = H2FrameParser{
            .handlers = handlers,
            .globalThis = globalObject,
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
        // check if socket is provided, and if it is a valid native socket
        if (options.get(globalObject, "native")) |socket_js| {
            if (JSTLSSocket.fromJS(socket_js)) |socket| {
                log("TLSSocket attached", .{});

                if (socket.native_callbacks.ctx == null) {
                    socket.native_callbacks.onData = H2FrameParser.onNativeRead;
                    socket.native_callbacks.onClose = H2FrameParser.onNativeClose;
                    socket.native_callbacks.onWritable = H2FrameParser.onNativeWritable;
                    socket.native_callbacks.ctx = bun.cast(*anyopaque, this);
                    this.native_socket = .{ .tls = socket };
                } else {
                    this.native_socket = .{ .tls_writeonly = socket };
                }
            } else if (JSTCPSocket.fromJS(socket_js)) |socket| {
                log("TCPSocket attached", .{});
                if (socket.native_callbacks.ctx == null) {
                    socket.native_callbacks.onData = H2FrameParser.onNativeRead;
                    socket.native_callbacks.onClose = H2FrameParser.onNativeClose;
                    socket.native_callbacks.onWritable = H2FrameParser.onNativeWritable;
                    socket.native_callbacks.ctx = bun.cast(*anyopaque, this);
                    this.native_socket = .{ .tcp = socket };
                } else {
                    this.native_socket = .{ .tcp_writeonly = socket };
                }
            }
        }
        if (options.get(globalObject, "settings")) |settings_js| {
            if (!settings_js.isEmptyOrUndefinedOrNull()) {
                if (!this.loadSettingsFromJSValue(globalObject, settings_js)) {
                    this.deinit();
                    handlers.deinit();
                    return null;
                }

                if (settings_js.get(globalObject, "maxOutstandingPings")) |max_pings| {
                    if (max_pings.isNumber()) {
                        this.maxOutstandingPings = max_pings.to(u64);
                    }
                }
                if (settings_js.get(globalObject, "maxSessionMemory")) |max_memory| {
                    if (max_memory.isNumber()) {
                        this.maxSessionMemory = @truncate(max_memory.to(u64));
                        if (this.maxSessionMemory < 1) {
                            this.maxSessionMemory = 1;
                        }
                    }
                }
                if (settings_js.get(globalObject, "maxHeaderListPairs")) |max_header_list_pairs| {
                    if (max_header_list_pairs.isNumber()) {
                        this.maxHeaderListPairs = @truncate(max_header_list_pairs.to(u64));
                        if (this.maxHeaderListPairs < 4) {
                            this.maxHeaderListPairs = 4;
                        }
                    }
                }
                if (settings_js.get(globalObject, "maxSessionRejectedStreams")) |max_rejected_streams| {
                    if (max_rejected_streams.isNumber()) {
                        this.maxRejectedStreams = @truncate(max_rejected_streams.to(u64));
                    }
                }
            }
        }
        var is_server = false;
        if (options.get(globalObject, "type")) |type_js| {
            is_server = type_js.isNumber() and type_js.to(u32) == 0;
        }

        this.isServer = is_server;
        this.strong_ctx.set(globalObject, context_obj);

        this.hpack = lshpack.HPACK.init(this.localSettings.headerTableSize);
        if (is_server) {
            this.setSettings(this.localSettings);
        } else {
            this.sendPrefaceAndSettings();
        }
        return this;
    }

    pub fn deinit(this: *H2FrameParser) void {
        defer h2frameparser_allocator.put(this);
        this.detachNativeSocket();
        this.strong_ctx.deinit();
        this.handlers.deinit();
        this.readBuffer.deinit();
        this.writeBuffer.deinitWithAllocator(this.allocator);
        this.writeBufferOffset = 0;
        this.pendingBuffer.deinitWithAllocator(this.allocator);

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
    fn ref(this: *H2FrameParser) void {
        this.ref_count += 1;
    }

    fn unref(this: *H2FrameParser) void {
        const ref_count = this.ref_count;
        bun.assert(ref_count > 0);
        this.ref_count -= 1;
        if (ref_count == 1) {
            this.deinit();
        }
    }

    pub fn finalize(
        this: *H2FrameParser,
    ) void {
        log("finalize", .{});
        this.unref();
    }
};

pub fn createNodeHttp2Binding(global: *JSC.JSGlobalObject) JSC.JSValue {
    return JSC.JSArray.create(global, &.{
        H2FrameParser.getConstructor(global),
        JSC.JSFunction.create(global, "getPackedSettings", jsGetPackedSettings, 0, .{}),
        JSC.JSFunction.create(global, "getUnpackedSettings", jsGetUnpackedSettings, 0, .{}),
    });
}
