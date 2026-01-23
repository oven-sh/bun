const MAX_PAYLOAD_SIZE_WITHOUT_FRAME = 16384 - FrameHeader.byteSize - 1;
const BunSocket = union(enum) {
    none: void,
    tls: *TLSSocket,
    tls_writeonly: *TLSSocket,
    tcp: *TCPSocket,
    tcp_writeonly: *TCPSocket,
};
extern fn JSC__JSGlobalObject__getHTTP2CommonString(globalObject: *jsc.JSGlobalObject, hpack_index: u32) jsc.JSValue;

pub fn getHTTP2CommonString(globalObject: *jsc.JSGlobalObject, hpack_index: u32) ?jsc.JSValue {
    if (hpack_index == 255) return null;
    const value = JSC__JSGlobalObject__getHTTP2CommonString(globalObject, hpack_index);
    if (value.isEmptyOrUndefinedOrNull()) return null;
    return value;
}

const MAX_WINDOW_SIZE = std.math.maxInt(i32);
const MAX_HEADER_TABLE_SIZE = std.math.maxInt(u32);
const MAX_STREAM_ID = std.math.maxInt(i32);
const MAX_FRAME_SIZE = std.math.maxInt(u24);
const DEFAULT_WINDOW_SIZE = std.math.maxInt(u16);
// Float versions for range validation before integer conversion
const MAX_WINDOW_SIZE_F64: f64 = @floatFromInt(MAX_WINDOW_SIZE);
const MAX_HEADER_TABLE_SIZE_F64: f64 = @floatFromInt(MAX_HEADER_TABLE_SIZE);
const MAX_FRAME_SIZE_F64: f64 = @floatFromInt(MAX_FRAME_SIZE);
// RFC 7541 Section 4.1: Each header entry has 32 bytes of overhead
// for the HPACK dynamic table entry structure
const HPACK_ENTRY_OVERHEAD = 32;
// Maximum number of custom settings (same as Node.js MAX_ADDITIONAL_SETTINGS)
const MAX_CUSTOM_SETTINGS = 10;
// Maximum custom setting ID (0xFFFF per RFC 7540)
const MAX_CUSTOM_SETTING_ID: f64 = 0xFFFF;

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
    HTTP_FRAME_CONTINUATION = 0x09, // RFC 7540 Section 6.10: Continues header block fragments
    HTTP_FRAME_ALTSVC = 0x0A, // https://datatracker.ietf.org/doc/html/rfc7838#section-7.2
    HTTP_FRAME_ORIGIN = 0x0C, // https://datatracker.ietf.org/doc/html/rfc8336#section-2
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
    MAX_PENDING_SETTINGS_ACK = 0xe,
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

inline fn u32FromBytes(src: []const u8) u32 {
    bun.debugAssert(src.len == 4);
    return std.mem.readInt(u32, src[0..4], .big);
}

const UInt31WithReserved = packed struct(u32) {
    reserved: bool = false,
    uint31: u31 = 0,

    const log = Output.scoped(.UInt31WithReserved, .visible);

    pub inline fn from(value: u32) UInt31WithReserved {
        return .{ .uint31 = @truncate(value & 0x7fffffff), .reserved = value & 0x80000000 != 0 };
    }

    pub inline fn init(value: u31, reserved: bool) UInt31WithReserved {
        return .{ .uint31 = value, .reserved = reserved };
    }

    pub inline fn toUInt32(value: UInt31WithReserved) u32 {
        return @bitCast(value);
    }

    pub inline fn fromBytes(src: []const u8) UInt31WithReserved {
        const value: u32 = u32FromBytes(src);
        return .{ .uint31 = @truncate(value & 0x7fffffff), .reserved = value & 0x80000000 != 0 };
    }

    pub inline fn write(this: UInt31WithReserved, comptime Writer: type, writer: Writer) bool {
        var value: u32 = this.uint31;
        if (this.reserved) {
            value |= 0x80000000;
        }

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
    pub fn toJS(this: *FullSettingsPayload, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
        var result = JSValue.createEmptyObject(globalObject, 8);
        result.put(globalObject, jsc.ZigString.static("headerTableSize"), jsc.JSValue.jsNumber(this.headerTableSize));
        result.put(globalObject, jsc.ZigString.static("enablePush"), jsc.JSValue.jsBoolean(this.enablePush > 0));
        result.put(globalObject, jsc.ZigString.static("maxConcurrentStreams"), jsc.JSValue.jsNumber(this.maxConcurrentStreams));
        result.put(globalObject, jsc.ZigString.static("initialWindowSize"), jsc.JSValue.jsNumber(this.initialWindowSize));
        result.put(globalObject, jsc.ZigString.static("maxFrameSize"), jsc.JSValue.jsNumber(this.maxFrameSize));
        result.put(globalObject, jsc.ZigString.static("maxHeaderListSize"), jsc.JSValue.jsNumber(this.maxHeaderListSize));
        result.put(globalObject, jsc.ZigString.static("maxHeaderSize"), jsc.JSValue.jsNumber(this.maxHeaderListSize));
        // TODO: we dont support this setting yet see https://nodejs.org/api/http2.html#settings-object
        // we should also support customSettings
        result.put(globalObject, jsc.ZigString.static("enableConnectProtocol"), .false);
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

const ValidResponsePseudoHeaders = bun.ComptimeStringMap(void, .{
    .{":status"},
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

pub fn jsGetUnpackedSettings(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    jsc.markBinding(@src());
    var settings: FullSettingsPayload = .{};

    const args_list = callframe.arguments_old(1);
    if (args_list.len < 1) {
        return settings.toJS(globalObject);
    }

    const data_arg = args_list.ptr[0];

    if (data_arg.asArrayBuffer(globalObject)) |array_buffer| {
        var payload = array_buffer.byteSlice();
        const settingByteSize = SettingsPayloadUnit.byteSize;
        if (payload.len < settingByteSize or payload.len % settingByteSize != 0) {
            return globalObject.throw("Expected buf to be a Buffer of at least 6 bytes and a multiple of 6 bytes", .{});
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
        return globalObject.throw("Expected buf to be a Buffer", .{});
    } else {
        return settings.toJS(globalObject);
    }
}

pub fn jsAssertSettings(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args_list = callframe.arguments_old(1);
    if (args_list.len < 1) {
        return globalObject.throw("Expected settings to be a object", .{});
    }

    if (args_list.len > 0 and !args_list.ptr[0].isEmptyOrUndefinedOrNull()) {
        const options = args_list.ptr[0];
        if (!options.isObject()) {
            return globalObject.throw("Expected settings to be a object", .{});
        }

        if (try options.get(globalObject, "headerTableSize")) |headerTableSize| {
            if (headerTableSize.isNumber()) {
                const value = headerTableSize.asNumber();
                if (value < 0 or value > MAX_HEADER_TABLE_SIZE_F64) {
                    return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected headerTableSize to be a number between 0 and 2^32-1", .{}).throw();
                }
            } else if (!headerTableSize.isEmptyOrUndefinedOrNull()) {
                return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected headerTableSize to be a number", .{}).throw();
            }
        }

        if (try options.get(globalObject, "enablePush")) |enablePush| {
            if (!enablePush.isBoolean() and !enablePush.isUndefined()) {
                return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE, "Expected enablePush to be a boolean", .{}).throw();
            }
        }

        if (try options.get(globalObject, "initialWindowSize")) |initialWindowSize| {
            if (initialWindowSize.isNumber()) {
                const value = initialWindowSize.asNumber();
                if (value < 0 or value > MAX_WINDOW_SIZE_F64) {
                    return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected initialWindowSize to be a number between 0 and 2^32-1", .{}).throw();
                }
            } else if (!initialWindowSize.isEmptyOrUndefinedOrNull()) {
                return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected initialWindowSize to be a number", .{}).throw();
            }
        }

        if (try options.get(globalObject, "maxFrameSize")) |maxFrameSize| {
            if (maxFrameSize.isNumber()) {
                const value = maxFrameSize.asNumber();
                if (value < 16384 or value > MAX_FRAME_SIZE_F64) {
                    return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxFrameSize to be a number between 16,384 and 2^24-1", .{}).throw();
                }
            } else if (!maxFrameSize.isEmptyOrUndefinedOrNull()) {
                return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxFrameSize to be a number", .{}).throw();
            }
        }

        if (try options.get(globalObject, "maxConcurrentStreams")) |maxConcurrentStreams| {
            if (maxConcurrentStreams.isNumber()) {
                const value = maxConcurrentStreams.asNumber();
                if (value < 0 or value > MAX_HEADER_TABLE_SIZE_F64) {
                    return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxConcurrentStreams to be a number between 0 and 2^32-1", .{}).throw();
                }
            } else if (!maxConcurrentStreams.isEmptyOrUndefinedOrNull()) {
                return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxConcurrentStreams to be a number", .{}).throw();
            }
        }

        if (try options.get(globalObject, "maxHeaderListSize")) |maxHeaderListSize| {
            if (maxHeaderListSize.isNumber()) {
                const value = maxHeaderListSize.asNumber();
                if (value < 0 or value > MAX_HEADER_TABLE_SIZE_F64) {
                    return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxHeaderListSize to be a number between 0 and 2^32-1", .{}).throw();
                }
            } else if (!maxHeaderListSize.isEmptyOrUndefinedOrNull()) {
                return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxHeaderListSize to be a number", .{}).throw();
            }
        }

        if (try options.get(globalObject, "maxHeaderSize")) |maxHeaderSize| {
            if (maxHeaderSize.isNumber()) {
                const value = maxHeaderSize.asNumber();
                if (value < 0 or value > MAX_HEADER_TABLE_SIZE_F64) {
                    return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxHeaderSize to be a number between 0 and 2^32-1", .{}).throw();
                }
            } else if (!maxHeaderSize.isEmptyOrUndefinedOrNull()) {
                return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxHeaderSize to be a number", .{}).throw();
            }
        }
    }
    return .js_undefined;
}

pub fn jsGetPackedSettings(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var settings: FullSettingsPayload = .{};
    const args_list = callframe.arguments_old(1);

    if (args_list.len > 0 and !args_list.ptr[0].isEmptyOrUndefinedOrNull()) {
        const options = args_list.ptr[0];

        if (!options.isObject()) {
            return globalObject.throw("Expected settings to be a object", .{});
        }

        if (try options.get(globalObject, "headerTableSize")) |headerTableSize| {
            if (headerTableSize.isNumber()) {
                const headerTableSizeValue = headerTableSize.toInt32();
                if (headerTableSizeValue > MAX_HEADER_TABLE_SIZE or headerTableSizeValue < 0) {
                    return globalObject.throw("Expected headerTableSize to be a number between 0 and 2^32-1", .{});
                }
                settings.headerTableSize = @intCast(headerTableSizeValue);
            } else if (!headerTableSize.isEmptyOrUndefinedOrNull()) {
                return globalObject.throw("Expected headerTableSize to be a number", .{});
            }
        }

        if (try options.get(globalObject, "enablePush")) |enablePush| {
            if (enablePush.isBoolean()) {
                settings.enablePush = if (enablePush.asBoolean()) 1 else 0;
            } else if (!enablePush.isEmptyOrUndefinedOrNull()) {
                return globalObject.throw("Expected enablePush to be a boolean", .{});
            }
        }

        if (try options.get(globalObject, "initialWindowSize")) |initialWindowSize| {
            if (initialWindowSize.isNumber()) {
                const initialWindowSizeValue = initialWindowSize.toInt32();
                if (initialWindowSizeValue > MAX_HEADER_TABLE_SIZE or initialWindowSizeValue < 0) {
                    return globalObject.throw("Expected initialWindowSize to be a number between 0 and 2^32-1", .{});
                }
                settings.initialWindowSize = @intCast(initialWindowSizeValue);
            } else if (!initialWindowSize.isEmptyOrUndefinedOrNull()) {
                return globalObject.throw("Expected initialWindowSize to be a number", .{});
            }
        }

        if (try options.get(globalObject, "maxFrameSize")) |maxFrameSize| {
            if (maxFrameSize.isNumber()) {
                const maxFrameSizeValue = maxFrameSize.toInt32();
                if (maxFrameSizeValue > MAX_FRAME_SIZE or maxFrameSizeValue < 16384) {
                    return globalObject.throw("Expected maxFrameSize to be a number between 16,384 and 2^24-1", .{});
                }
                settings.maxFrameSize = @intCast(maxFrameSizeValue);
            } else if (!maxFrameSize.isEmptyOrUndefinedOrNull()) {
                return globalObject.throw("Expected maxFrameSize to be a number", .{});
            }
        }

        if (try options.get(globalObject, "maxConcurrentStreams")) |maxConcurrentStreams| {
            if (maxConcurrentStreams.isNumber()) {
                const maxConcurrentStreamsValue = maxConcurrentStreams.toInt32();
                if (maxConcurrentStreamsValue > MAX_HEADER_TABLE_SIZE or maxConcurrentStreamsValue < 0) {
                    return globalObject.throw("Expected maxConcurrentStreams to be a number between 0 and 2^32-1", .{});
                }
                settings.maxConcurrentStreams = @intCast(maxConcurrentStreamsValue);
            } else if (!maxConcurrentStreams.isEmptyOrUndefinedOrNull()) {
                return globalObject.throw("Expected maxConcurrentStreams to be a number", .{});
            }
        }

        if (try options.get(globalObject, "maxHeaderListSize")) |maxHeaderListSize| {
            if (maxHeaderListSize.isNumber()) {
                const maxHeaderListSizeValue = maxHeaderListSize.toInt32();
                if (maxHeaderListSizeValue > MAX_HEADER_TABLE_SIZE or maxHeaderListSizeValue < 0) {
                    return globalObject.throw("Expected maxHeaderListSize to be a number between 0 and 2^32-1", .{});
                }
                settings.maxHeaderListSize = @intCast(maxHeaderListSizeValue);
            } else if (!maxHeaderListSize.isEmptyOrUndefinedOrNull()) {
                return globalObject.throw("Expected maxHeaderListSize to be a number", .{});
            }
        }

        if (try options.get(globalObject, "maxHeaderSize")) |maxHeaderSize| {
            if (maxHeaderSize.isNumber()) {
                const maxHeaderSizeValue = maxHeaderSize.toInt32();
                if (maxHeaderSizeValue > MAX_HEADER_TABLE_SIZE or maxHeaderSizeValue < 0) {
                    return globalObject.throw("Expected maxHeaderSize to be a number between 0 and 2^32-1", .{});
                }
                settings.maxHeaderListSize = @intCast(maxHeaderSizeValue);
            } else if (!maxHeaderSize.isEmptyOrUndefinedOrNull()) {
                return globalObject.throw("Expected maxHeaderSize to be a number", .{});
            }
        }
    }

    std.mem.byteSwapAllFields(FullSettingsPayload, &settings);
    const bytes = std.mem.asBytes(&settings)[0..FullSettingsPayload.byteSize];
    const binary_type: BinaryType = .Buffer;
    return binary_type.toJS(bytes, globalObject);
}

const Handlers = struct {
    binary_type: BinaryType = .Buffer,

    vm: *jsc.VirtualMachine,
    globalObject: *jsc.JSGlobalObject,

    pub fn callEventHandler(this: *Handlers, comptime event: H2FrameParser.js.gc, thisValue: JSValue, context: jsc.JSValue, data: []const JSValue) bool {
        const callback = event.get(thisValue) orelse return false;

        this.vm.eventLoop().runCallback(callback, this.globalObject, context, data);
        return true;
    }

    pub fn callWriteCallback(this: *Handlers, callback: jsc.JSValue, data: []const JSValue) bool {
        if (!callback.isCallable()) return false;
        this.vm.eventLoop().runCallback(callback, this.globalObject, .js_undefined, data);
        return true;
    }

    pub fn callEventHandlerWithResult(this: *Handlers, comptime event: H2FrameParser.js.gc, thisValue: JSValue, data: []const JSValue) JSValue {
        const callback = event.get(thisValue) orelse return .zero;

        return this.vm.eventLoop().runCallbackWithResult(callback, this.globalObject, thisValue, data);
    }

    pub fn fromJS(globalObject: *jsc.JSGlobalObject, opts: jsc.JSValue, thisValue: jsc.JSValue) bun.JSError!Handlers {
        var handlers = Handlers{
            .vm = globalObject.bunVM(),
            .globalObject = globalObject,
        };

        if (opts.isEmptyOrUndefinedOrNull() or opts.isBoolean() or !opts.isObject()) {
            return globalObject.throwInvalidArguments("Expected \"handlers\" to be an object", .{});
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
            .{ "onAltSvc", "altsvc" },
            .{ "onOrigin", "origin" },
            .{ "onFrameError", "frameError" },
        };

        inline for (pairs) |pair| {
            if (try opts.getTruthy(globalObject, pair.@"1")) |callback_value| {
                if (!callback_value.isCell() or !callback_value.isCallable()) {
                    return globalObject.throwInvalidArguments("Expected \"{s}\" callback to be a function", .{pair[1]});
                }

                @field(H2FrameParser.js.gc, pair.@"0").set(thisValue, globalObject, callback_value.withAsyncContextIfNeeded(globalObject));
            }
        }

        if (try opts.fastGet(globalObject, .@"error")) |callback_value| {
            if (!callback_value.isCell() or !callback_value.isCallable()) {
                return globalObject.throwInvalidArguments("Expected \"error\" callback to be a function", .{});
            }

            H2FrameParser.js.gc.onError.set(thisValue, globalObject, callback_value.withAsyncContextIfNeeded(globalObject));
        }

        // onWrite is required for duplex support or if more than 1 parser is attached to the same socket (unliked)
        if (H2FrameParser.js.gc.onWrite.get(thisValue) == .zero) {
            return globalObject.throwInvalidArguments("Expected at least \"write\" callback", .{});
        }

        if (try opts.getTruthy(globalObject, "binaryType")) |binary_type_value| {
            if (!binary_type_value.isString()) {
                return globalObject.throwInvalidArguments("Expected \"binaryType\" to be a string", .{});
            }

            handlers.binary_type = try BinaryType.fromJSValue(globalObject, binary_type_value) orelse {
                return globalObject.throwInvalidArguments("Expected 'binaryType' to be 'ArrayBuffer', 'Uint8Array', or 'Buffer'", .{});
            };
        }

        return handlers;
    }
};

pub const H2FrameParserConstructor = H2FrameParser.js.getConstructor;

pub const H2FrameParser = struct {
    pub const log = Output.scoped(.H2FrameParser, .visible);
    const Self = @This();
    pub const js = jsc.Codegen.JSH2FrameParser;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;
    const ENABLE_AUTO_CORK = false; // ENABLE CORK OPTIMIZATION
    const ENABLE_ALLOCATOR_POOL = true; // ENABLE HIVE ALLOCATOR OPTIMIZATION

    const MAX_BUFFER_SIZE = 32768;
    threadlocal var CORK_BUFFER: [16386]u8 = undefined;
    threadlocal var CORK_OFFSET: u16 = 0;
    threadlocal var CORKED_H2: ?*H2FrameParser = null;

    const H2FrameParserHiveAllocator = bun.HiveArray(H2FrameParser, 256).Fallback;
    pub threadlocal var pool: if (ENABLE_ALLOCATOR_POOL) ?*H2FrameParserHiveAllocator else u0 = if (ENABLE_ALLOCATOR_POOL) null else 0;

    strong_this: jsc.JSRef = .empty(),
    globalThis: *jsc.JSGlobalObject,
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

    // local Window limits the download of data

    // current window size for the connection
    windowSize: u64 = DEFAULT_WINDOW_SIZE,
    // used window size for the connection
    usedWindowSize: u64 = 0,

    // remote Window limits the upload of data
    // remote window size for the connection
    remoteWindowSize: u64 = DEFAULT_WINDOW_SIZE,
    // remote used window size for the connection
    remoteUsedWindowSize: u64 = 0,

    maxHeaderListPairs: u32 = 128,
    maxRejectedStreams: u32 = 100,
    maxOutstandingSettings: u32 = 10,
    outstandingSettings: u32 = 0,
    rejectedStreams: u32 = 0,
    maxSessionMemory: u32 = 10, //this limit is in MB
    queuedDataSize: u64 = 0, // this is in bytes
    maxOutstandingPings: u64 = 10,
    outStandingPings: u64 = 0,
    maxSendHeaderBlockLength: u32 = 0,
    lastStreamID: u32 = 0,
    isServer: bool = false,
    prefaceReceivedLen: u8 = 0,
    // we buffer requests until we get the first settings ACK
    writeBuffer: bun.ByteList = .{},
    writeBufferOffset: usize = 0,
    // TODO: this will be removed when I re-add header and data priorization
    outboundQueueSize: usize = 0,

    streams: bun.U32HashMap(Stream),

    hpack: ?*lshpack.HPACK = null,

    has_nonnative_backpressure: bool = false,
    ref_count: RefCount,

    auto_flusher: AutoFlusher = .{},
    paddingStrategy: PaddingStrategy = .none,

    threadlocal var shared_request_buffer: [16384]u8 = undefined;

    /// Encodes a single header into the ArrayList, growing if needed.
    /// Returns the number of bytes written, or error on failure.
    ///
    /// Capacity estimation: name.len + value.len + HPACK_ENTRY_OVERHEAD
    ///
    /// Per RFC 7541, the HPACK wire format for a literal header field is:
    ///   - 1 byte: type indicator (literal with/without indexing, never indexed)
    ///   - 1-6 bytes: name length as variable-length integer (7-bit prefix)
    ///   - N bytes: name string (raw or Huffman-encoded)
    ///   - 1-6 bytes: value length as variable-length integer (7-bit prefix)
    ///   - M bytes: value string (raw or Huffman-encoded)
    ///
    /// For most headers (name/value < 127 bytes), this is ~3 bytes overhead.
    /// Using HPACK_ENTRY_OVERHEAD (32 bytes, from RFC 7541 Section 4.1) is a
    /// conservative estimate that accounts for worst-case variable integer
    /// encoding and ensures we never underallocate, even with very large headers.
    fn encodeHeaderIntoList(
        this: *H2FrameParser,
        encoded_headers: *std.ArrayListUnmanaged(u8),
        alloc: std.mem.Allocator,
        name: []const u8,
        value: []const u8,
        never_index: bool,
    ) !usize {
        const required = encoded_headers.items.len + name.len + value.len + HPACK_ENTRY_OVERHEAD;
        try encoded_headers.ensureTotalCapacity(alloc, required);
        const bytes_written = try this.encode(encoded_headers.allocatedSlice(), encoded_headers.items.len, name, value, never_index);
        encoded_headers.items.len += bytes_written;
        return bytes_written;
    }

    /// The streams hashmap may mutate when growing we use this when we need to make sure its safe to iterate over it
    pub const StreamResumableIterator = struct {
        parser: *H2FrameParser,
        index: u32 = 0,
        pub fn init(parser: *H2FrameParser) StreamResumableIterator {
            return .{ .index = 0, .parser = parser };
        }
        pub fn next(this: *StreamResumableIterator) ?*Stream {
            var it = this.parser.streams.iterator();
            if (it.index > it.hm.capacity() or this.index > it.hm.capacity()) return null;
            // resume the iterator from the same index if possible
            it.index = this.index;
            while (it.next()) |item| {
                this.index = it.index;
                return item.value_ptr;
            }
            this.index = it.index;
            return null;
        }
    };

    pub const FlushState = enum {
        no_action,
        flushed,
        backpressure,
    };

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
        jsContext: jsc.Strong.Optional = .empty,
        waitForTrailers: bool = false,
        closeAfterDrain: bool = false,
        endAfterHeaders: bool = false,
        isWaitingMoreHeaders: bool = false,
        padding: ?u8 = null,
        paddingStrategy: PaddingStrategy = .none,
        rstCode: u32 = 0,
        streamDependency: u32 = 0,
        exclusive: bool = false,
        weight: u16 = 36,
        // current window size for the stream
        windowSize: u64 = 65535,
        // used window size for the stream
        usedWindowSize: u64 = 0,
        // remote window size for the stream
        remoteWindowSize: u64,
        // remote used window size for the stream
        remoteUsedWindowSize: u64 = 0,
        signal: ?*SignalRef = null,

        // when we have backpressure we queue the data e round robin the Streams
        dataFrameQueue: PendingQueue,
        const SignalRef = struct {
            signal: *jsc.WebCore.AbortSignal,
            parser: *H2FrameParser,
            stream_id: u32,

            pub const new = bun.TrivialNew(SignalRef);

            pub fn isAborted(this: *SignalRef) bool {
                return this.signal.aborted();
            }

            pub fn abortListener(this: *SignalRef, reason: JSValue) void {
                log("abortListener", .{});
                reason.ensureStillAlive();
                const stream = this.parser.streams.getEntry(this.stream_id) orelse return;
                const value = stream.value_ptr;
                if (value.state != .CLOSED) {
                    this.parser.abortStream(value, Bun__wrapAbortError(this.parser.globalThis, reason));
                }
            }

            pub fn deinit(this: *SignalRef) void {
                this.signal.detach(this);
                this.parser.deref();
                bun.destroy(this);
            }
        };
        const PendingQueue = struct {
            data: std.ArrayListUnmanaged(PendingFrame) = .{},
            front: usize = 0,
            len: usize = 0,

            pub fn deinit(self: *PendingQueue, allocator: Allocator) void {
                self.front = 0;
                self.len = 0;
                var data = self.data;
                if (data.capacity > 0) {
                    self.data = .{};
                    data.clearAndFree(allocator);
                }
            }

            pub fn enqueue(self: *PendingQueue, value: PendingFrame, allocator: Allocator) void {
                bun.handleOom(self.data.append(allocator, value));
                self.len += 1;
                log("PendingQueue.enqueue {}", .{self.len});
            }

            pub fn peek(self: *PendingQueue) ?*PendingFrame {
                if (self.len == 0) {
                    return null;
                }
                return &self.data.items[0];
            }

            pub fn peekLast(self: *PendingQueue) ?*PendingFrame {
                if (self.len == 0) {
                    return null;
                }
                return &self.data.items[self.data.items.len - 1];
            }

            pub fn slice(self: *PendingQueue) []PendingFrame {
                if (self.len == 0) return &.{};
                return self.data.items[self.front..][0..self.len];
            }
            pub fn peekFront(self: *PendingQueue) ?*PendingFrame {
                if (self.len == 0) return null;
                return &self.data.items[self.front];
            }
            pub fn dequeue(self: *PendingQueue) ?PendingFrame {
                if (self.len == 0) {
                    log("PendingQueue.dequeue null", .{});
                    return null;
                }
                const value = self.data.items[self.front];
                self.data.items[self.front] = .{};
                self.len -= 1;
                if (self.len == 0) {
                    self.front = 0;
                    self.data.clearRetainingCapacity();
                } else {
                    self.front += 1;
                }
                log("PendingQueue.dequeue {}", .{self.len});

                return value;
            }

            pub fn isEmpty(self: *PendingQueue) bool {
                return self.len == 0;
            }
        };
        const PendingFrame = struct {
            end_stream: bool = false, // end_stream flag
            len: u32 = 0, // actually payload size
            offset: u32 = 0, // offset into the buffer (if partial flush due to flow control)
            buffer: []u8 = "", // allocated buffer if len > 0
            callback: jsc.Strong.Optional = .empty, // JSCallback for done

            pub fn deinit(this: *PendingFrame, allocator: Allocator) void {
                if (this.buffer.len > 0) {
                    allocator.free(this.buffer);
                    this.buffer = "";
                }
                this.len = 0;
                this.callback.deinit();
            }

            pub fn slice(this: *const PendingFrame) []u8 {
                return this.buffer[this.offset..this.len];
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
                    return @min(paddedLen -| frameLen, 255);
                },
                .max => return @min(maxLen -| frameLen, 255),
            }
        }
        pub fn flushQueue(this: *Stream, client: *H2FrameParser, written: *usize) FlushState {
            if (this.canSendData()) {
                // try to flush one frame
                if (this.dataFrameQueue.peekFront()) |frame| {
                    const no_backpressure = brk: {
                        var is_flow_control_limited = false;
                        defer {
                            if (!is_flow_control_limited) {
                                // only call the callback + free the frame if we write to the socket the full frame
                                var _frame = this.dataFrameQueue.dequeue().?;
                                client.outboundQueueSize -= 1;

                                if (_frame.callback.get()) |callback_value| client.dispatchWriteCallback(callback_value);
                                if (this.dataFrameQueue.isEmpty()) {
                                    if (_frame.end_stream) {
                                        if (this.waitForTrailers) {
                                            client.dispatch(.onWantTrailers, this.getIdentifier());
                                        } else {
                                            const identifier = this.getIdentifier();
                                            identifier.ensureStillAlive();
                                            if (this.state == .HALF_CLOSED_REMOTE) {
                                                this.state = .CLOSED;
                                            } else {
                                                this.state = .HALF_CLOSED_LOCAL;
                                            }
                                            client.dispatchWithExtra(.onStreamEnd, identifier, jsc.JSValue.jsNumber(@intFromEnum(this.state)));
                                        }
                                    }
                                }
                                _frame.deinit(client.allocator);
                            }
                        }

                        const writer = client.toWriter();

                        if (frame.len == 0) {

                            // flush a zero payload frame
                            var dataHeader: FrameHeader = .{
                                .type = @intFromEnum(FrameType.HTTP_FRAME_DATA),
                                .flags = if (frame.end_stream and !this.waitForTrailers) @intFromEnum(DataFrameFlags.END_STREAM) else 0,
                                .streamIdentifier = @intCast(this.id),
                                .length = 0,
                            };
                            break :brk dataHeader.write(@TypeOf(writer), writer);
                        } else {
                            const frame_slice = frame.slice();
                            const max_size = @min(@min(frame_slice.len, this.remoteWindowSize -| this.remoteUsedWindowSize, client.remoteWindowSize -| client.remoteUsedWindowSize), MAX_PAYLOAD_SIZE_WITHOUT_FRAME);
                            if (max_size == 0) {
                                is_flow_control_limited = true;
                                log("dataFrame flow control limited {} {} {} {} {} {}", .{ frame_slice.len, this.remoteWindowSize, this.remoteUsedWindowSize, client.remoteWindowSize, client.remoteUsedWindowSize, max_size });
                                // we are flow control limited lets return backpressure if is limited in the connection so we short circuit the flush
                                return if (client.remoteWindowSize == client.remoteUsedWindowSize) .backpressure else .no_action;
                            }
                            if (max_size < frame_slice.len) {
                                is_flow_control_limited = true;
                                // we need to break the frame into smaller chunks
                                frame.offset += @intCast(max_size);
                                const able_to_send = frame_slice[0..max_size];
                                client.queuedDataSize -= able_to_send.len;
                                written.* += able_to_send.len;

                                const padding = this.getPadding(able_to_send.len, max_size - 1);
                                const payload_size = able_to_send.len + (if (padding != 0) @as(usize, @intCast(padding)) + 1 else 0);
                                log("padding: {d} size: {d} max_size: {d} payload_size: {d}", .{ padding, able_to_send.len, max_size, payload_size });
                                this.remoteUsedWindowSize += payload_size;
                                client.remoteUsedWindowSize += payload_size;

                                var flags: u8 = 0; // we ignore end_stream for now because we know we have more data to send
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
                                    bun.memmove(buffer[1..][0..able_to_send.len], able_to_send);
                                    buffer[0] = padding;
                                    break :brk (writer.write(buffer[0..payload_size]) catch 0) != 0;
                                } else {
                                    break :brk (writer.write(able_to_send) catch 0) != 0;
                                }
                            } else {

                                // flush with some payload
                                client.queuedDataSize -= frame_slice.len;
                                written.* += frame_slice.len;

                                const padding = this.getPadding(frame_slice.len, max_size - 1);
                                const payload_size = frame_slice.len + (if (padding != 0) @as(usize, @intCast(padding)) + 1 else 0);
                                log("padding: {d} size: {d} max_size: {d} payload_size: {d}", .{ padding, frame_slice.len, max_size, payload_size });
                                this.remoteUsedWindowSize += payload_size;
                                client.remoteUsedWindowSize += payload_size;
                                var flags: u8 = if (frame.end_stream and !this.waitForTrailers) @intFromEnum(DataFrameFlags.END_STREAM) else 0;
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
                                    bun.memmove(buffer[1..][0..frame_slice.len], frame_slice);
                                    buffer[0] = padding;
                                    break :brk (writer.write(buffer[0..payload_size]) catch 0) != 0;
                                } else {
                                    break :brk (writer.write(frame_slice) catch 0) != 0;
                                }
                            }
                        }
                    };

                    return if (no_backpressure) .flushed else .backpressure;
                }
            }
            // empty or cannot send data
            return .no_action;
        }

        pub fn queueFrame(this: *Stream, client: *H2FrameParser, bytes: []const u8, callback: jsc.JSValue, end_stream: bool) void {
            const globalThis = client.globalThis;

            if (this.dataFrameQueue.peekLast()) |last_frame| {
                if (bytes.len == 0) {
                    // just merge the end_stream
                    last_frame.end_stream = end_stream;
                    // we can only hold 1 callback at a time so we conclude the last one, and keep the last one as pending
                    // this is fine is like a per-stream CORKING in a frame level
                    if (last_frame.callback.get()) |old_callback| {
                        client.dispatchWriteCallback(old_callback);
                        last_frame.callback.deinit();
                    }
                    last_frame.callback = .create(callback, globalThis);
                    return;
                }
                if (last_frame.len == 0) {
                    // we have an empty frame with means we can just use this frame with a new buffer
                    last_frame.buffer = bun.handleOom(client.allocator.alloc(u8, MAX_PAYLOAD_SIZE_WITHOUT_FRAME));
                }
                const max_size = MAX_PAYLOAD_SIZE_WITHOUT_FRAME;
                const remaining = max_size - last_frame.len;
                if (remaining > 0) {
                    // ok we can cork frames
                    const consumed_len = @min(remaining, bytes.len);
                    const merge = bytes[0..consumed_len];
                    @memcpy(last_frame.buffer[last_frame.len .. last_frame.len + consumed_len], merge);
                    last_frame.len += @intCast(consumed_len);
                    log("dataFrame merged {}", .{consumed_len});

                    client.queuedDataSize += consumed_len;
                    //lets fallthrough if we still have some data
                    const more_data = bytes[consumed_len..];
                    if (more_data.len == 0) {
                        last_frame.end_stream = end_stream;
                        // we can only hold 1 callback at a time so we conclude the last one, and keep the last one as pending
                        // this is fine is like a per-stream CORKING in a frame level
                        if (last_frame.callback.get()) |old_callback| {
                            client.dispatchWriteCallback(old_callback);
                            last_frame.callback.deinit();
                        }
                        last_frame.callback = .create(callback, globalThis);
                        return;
                    }
                    // we keep the old callback because the new will be part of another frame
                    return this.queueFrame(client, more_data, callback, end_stream);
                }
            }
            log("{s} queued {} {}", .{ if (client.isServer) "server" else "client", bytes.len, end_stream });

            const frame: PendingFrame = .{
                .end_stream = end_stream,
                .len = @intCast(bytes.len),
                // we need to clone this data to send it later
                .buffer = if (bytes.len == 0) "" else bun.handleOom(client.allocator.alloc(u8, MAX_PAYLOAD_SIZE_WITHOUT_FRAME)),
                .callback = if (callback.isCallable()) jsc.Strong.Optional.create(callback, globalThis) else .empty,
            };
            if (bytes.len > 0) {
                @memcpy(frame.buffer[0..bytes.len], bytes);
                client.globalThis.vm().reportExtraMemory(bytes.len);
            }
            log("dataFrame enqueued {}", .{frame.len});
            this.dataFrameQueue.enqueue(frame, client.allocator);
            client.outboundQueueSize += 1;
            client.queuedDataSize += frame.len;
        }

        pub fn init(streamIdentifier: u32, initialWindowSize: u32, remoteWindowSize: u32, paddingStrategy: PaddingStrategy) Stream {
            const stream = Stream{
                .id = streamIdentifier,
                .state = .OPEN,
                .windowSize = initialWindowSize,
                .remoteWindowSize = remoteWindowSize,
                .usedWindowSize = 0,
                .weight = 36,
                .dataFrameQueue = .{},
                .paddingStrategy = paddingStrategy,
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

        pub fn setContext(this: *Stream, value: JSValue, globalObject: *jsc.JSGlobalObject) void {
            var context = this.jsContext;
            defer context.deinit();
            this.jsContext = .create(value, globalObject);
        }

        pub fn getIdentifier(this: *const Stream) JSValue {
            return this.jsContext.get() orelse return jsc.JSValue.jsNumber(this.id);
        }

        pub fn attachSignal(this: *Stream, parser: *H2FrameParser, signal: *jsc.WebCore.AbortSignal) void {
            // we need a stable pointer to know what signal points to what stream_id + parser
            var signal_ref = SignalRef.new(.{
                .signal = signal,
                .parser = parser,
                .stream_id = this.id,
            });
            signal_ref.signal = signal.ref().listen(SignalRef, signal_ref, SignalRef.abortListener);
            //TODO: We should not need this ref counting here, since Parser owns Stream
            parser.ref();
            this.signal = signal_ref;
        }

        pub fn detachContext(this: *Stream) void {
            this.jsContext.deinit();
        }

        fn cleanQueue(this: *Stream, client: *H2FrameParser, comptime finalizing: bool) void {
            log("cleanQueue len: {} front: {} outboundQueueSize: {}", .{ this.dataFrameQueue.len, this.dataFrameQueue.front, client.outboundQueueSize });

            var queue = this.dataFrameQueue;
            this.dataFrameQueue = .{};
            defer {
                queue.deinit(client.allocator);
            }
            while (queue.dequeue()) |item| {
                var frame = item;
                const len = frame.slice().len;
                log("dataFrame dropped {}", .{len});
                client.queuedDataSize -= len;
                if (!finalizing) {
                    if (frame.callback.get()) |callback_value| client.dispatchWriteCallback(callback_value);
                }
                frame.deinit(client.allocator);
                client.outboundQueueSize -= 1;
            }
        }
        /// this can be called multiple times
        pub fn freeResources(this: *Stream, client: *H2FrameParser, comptime finalizing: bool) void {
            this.detachContext();
            this.cleanQueue(client, finalizing);
            if (this.signal) |signal| {
                this.signal = null;
                signal.deinit();
            }
            // unsafe to ask GC to run if we are already inside GC
            if (!finalizing) {
                jsc.VirtualMachine.get().eventLoop().processGCTimer();
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
            // lets make sure the name is lowercase
            return try hpack.encode(name, value, never_index, dst_buffer, dst_offset);
        }
        return error.UnableToEncode;
    }

    /// Calculate the new window size for the connection and the stream
    /// https://datatracker.ietf.org/doc/html/rfc7540#section-6.9.1
    fn adjustWindowSize(this: *H2FrameParser, stream: ?*Stream, payloadSize: u32) void {
        this.usedWindowSize +|= payloadSize;
        log("adjustWindowSize {} {} {} {}", .{ this.usedWindowSize, this.windowSize, this.isServer, payloadSize });
        if (this.usedWindowSize > this.windowSize) {
            // we are receiving more data than we are allowed to
            this.sendGoAway(0, .FLOW_CONTROL_ERROR, "Window size overflow", this.lastStreamID, true);
            this.usedWindowSize -= payloadSize;
        }

        if (stream) |s| {
            s.usedWindowSize += payloadSize;
            if (s.usedWindowSize > s.windowSize) {
                // we are receiving more data than we are allowed to
                this.sendGoAway(s.id, .FLOW_CONTROL_ERROR, "Window size overflow", this.lastStreamID, true);
                s.usedWindowSize -= payloadSize;
            }
        }
    }

    fn incrementWindowSizeIfNeeded(this: *H2FrameParser) void {
        var it = this.streams.valueIterator();
        while (it.next()) |stream| {
            log("incrementWindowSizeIfNeeded stream {} {} {} {}", .{ stream.id, stream.usedWindowSize, stream.windowSize, this.isServer });
            if (stream.usedWindowSize >= stream.windowSize / 2 and stream.usedWindowSize > 0) {
                const consumed = stream.usedWindowSize;
                stream.usedWindowSize = 0;
                log("incrementWindowSizeIfNeeded stream {} {} {}", .{ stream.id, stream.windowSize, this.isServer });
                this.sendWindowUpdate(stream.id, UInt31WithReserved.init(@truncate(consumed), false));
            }
        }
        log("incrementWindowSizeIfNeeded connection {} {} {}", .{ this.usedWindowSize, this.windowSize, this.isServer });
        if (this.usedWindowSize >= this.windowSize / 2 and this.usedWindowSize > 0) {
            const consumed = this.usedWindowSize;
            this.usedWindowSize = 0;
            this.sendWindowUpdate(0, UInt31WithReserved.init(@truncate(consumed), false));
        }
    }

    pub fn setSettings(this: *H2FrameParser, settings: FullSettingsPayload) bool {
        log("HTTP_FRAME_SETTINGS ack false", .{});

        if (this.outstandingSettings >= this.maxOutstandingSettings) {
            this.sendGoAway(0, .MAX_PENDING_SETTINGS_ACK, "Maximum number of pending settings acknowledgements", this.lastStreamID, true);
            return false;
        }

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

        this.outstandingSettings += 1;

        this.localSettings = settings;
        _ = this.localSettings.write(@TypeOf(writer), writer);
        _ = this.write(&buffer);
        return true;
    }

    pub fn abortStream(this: *H2FrameParser, stream: *Stream, abortReason: jsc.JSValue) void {
        log("HTTP_FRAME_RST_STREAM id: {} code: CANCEL", .{stream.id});

        abortReason.ensureStillAlive();
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
        var value: u32 = @intFromEnum(ErrorCode.CANCEL);
        stream.rstCode = value;
        value = @byteSwap(value);
        _ = writer.write(std.mem.asBytes(&value)) catch 0;
        const old_state = stream.state;
        stream.state = .CLOSED;
        const identifier = stream.getIdentifier();
        identifier.ensureStillAlive();
        stream.freeResources(this, false);
        this.dispatchWith2Extra(.onAborted, identifier, abortReason, jsc.JSValue.jsNumber(@intFromEnum(old_state)));
        _ = this.write(&buffer);
    }

    pub fn endStream(this: *H2FrameParser, stream: *Stream, rstCode: ErrorCode) void {
        log("HTTP_FRAME_RST_STREAM id: {} code: {}", .{ stream.id, @intFromEnum(rstCode) });
        if (stream.state == .CLOSED) {
            return;
        }
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
        const identifier = stream.getIdentifier();
        identifier.ensureStillAlive();
        stream.freeResources(this, false);
        if (rstCode == .NO_ERROR) {
            this.dispatchWithExtra(.onStreamEnd, identifier, jsc.JSValue.jsNumber(@intFromEnum(stream.state)));
        } else {
            this.dispatchWithExtra(.onStreamError, identifier, jsc.JSValue.jsNumber(@intFromEnum(rstCode)));
        }

        _ = this.write(&buffer);
    }

    pub fn sendGoAway(this: *H2FrameParser, streamIdentifier: u32, rstCode: ErrorCode, debug_data: []const u8, lastStreamID: u32, emitError: bool) void {
        log("HTTP_FRAME_GOAWAY {} code {} debug_data {s} emitError {}", .{ streamIdentifier, rstCode, debug_data, emitError });
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
        var last_id = UInt31WithReserved.init(@truncate(lastStreamID), false);
        _ = last_id.write(@TypeOf(writer), writer);
        var value: u32 = @intFromEnum(rstCode);
        value = @byteSwap(value);
        _ = writer.write(std.mem.asBytes(&value)) catch 0;

        _ = this.write(&buffer);
        if (debug_data.len > 0) {
            _ = this.write(debug_data);
        }
        const chunk = this.handlers.binary_type.toJS(debug_data, this.handlers.globalObject) catch |err| {
            this.dispatch(.onError, this.globalThis.takeException(err));
            return;
        };

        if (emitError) {
            if (rstCode != .NO_ERROR) {
                this.dispatchWith2Extra(.onError, jsc.JSValue.jsNumber(@intFromEnum(rstCode)), jsc.JSValue.jsNumber(this.lastStreamID), chunk);
            }
            this.dispatchWithExtra(.onEnd, jsc.JSValue.jsNumber(this.lastStreamID), chunk);
        }
    }

    pub fn sendAltSvc(this: *H2FrameParser, streamIdentifier: u32, origin_str: []const u8, alt: []const u8) void {
        log("HTTP_FRAME_ALTSVC stream {} origin {s} alt {s}", .{ streamIdentifier, origin_str, alt });

        var buffer: [FrameHeader.byteSize + 2]u8 = undefined;
        @memset(&buffer, 0);
        var stream = std.io.fixedBufferStream(&buffer);
        const writer = stream.writer();

        var frame: FrameHeader = .{
            .type = @intFromEnum(FrameType.HTTP_FRAME_ALTSVC),
            .flags = 0,
            .streamIdentifier = streamIdentifier,
            .length = @intCast(origin_str.len + alt.len + 2),
        };
        _ = frame.write(@TypeOf(writer), writer);
        _ = writer.writeInt(u16, @intCast(origin_str.len), .big) catch 0;
        _ = this.write(&buffer);
        if (origin_str.len > 0) {
            _ = this.write(origin_str);
        }
        if (alt.len > 0) {
            _ = this.write(alt);
        }
    }

    pub fn sendPing(this: *H2FrameParser, ack: bool, payload: []const u8) void {
        log("HTTP_FRAME_PING ack {} payload {s}", .{ ack, payload });

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
        log("sendPrefaceAndSettings", .{});
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
        this.outstandingSettings += 1;
        _ = settingsHeader.write(@TypeOf(writer), writer);
        _ = this.localSettings.write(@TypeOf(writer), writer);
        _ = this.write(&preface_buffer);
    }

    pub fn sendSettingsACK(this: *H2FrameParser) void {
        log("send HTTP_FRAME_SETTINGS ack true", .{});
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
    }

    pub fn sendWindowUpdate(this: *H2FrameParser, streamIdentifier: u32, windowSize: UInt31WithReserved) void {
        log("HTTP_FRAME_WINDOW_UPDATE stream {} size {}", .{ streamIdentifier, windowSize.uint31 });
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
        _ = windowSize.write(@TypeOf(writer), writer);
        _ = this.write(&buffer);
    }

    pub fn dispatch(this: *H2FrameParser, comptime event: js.gc, value: jsc.JSValue) void {
        jsc.markBinding(@src());

        value.ensureStillAlive();
        const this_value = this.strong_this.tryGet() orelse return;
        const ctx_value = js.gc.context.get(this_value) orelse return;
        _ = this.handlers.callEventHandler(event, this_value, ctx_value, &[_]jsc.JSValue{ ctx_value, value });
    }

    pub fn call(this: *H2FrameParser, comptime event: js.gc, value: jsc.JSValue) JSValue {
        jsc.markBinding(@src());

        const this_value = this.strong_this.tryGet() orelse return .zero;
        const ctx_value = js.gc.context.get(this_value) orelse return .zero;
        value.ensureStillAlive();
        return this.handlers.callEventHandlerWithResult(event, this_value, &[_]jsc.JSValue{ ctx_value, value });
    }

    pub fn dispatchWriteCallback(this: *H2FrameParser, callback: jsc.JSValue) void {
        jsc.markBinding(@src());

        _ = this.handlers.callWriteCallback(callback, &[_]jsc.JSValue{});
    }

    pub fn dispatchWithExtra(this: *H2FrameParser, comptime event: js.gc, value: jsc.JSValue, extra: jsc.JSValue) void {
        jsc.markBinding(@src());

        const this_value = this.strong_this.tryGet() orelse return;
        const ctx_value = js.gc.context.get(this_value) orelse return;
        value.ensureStillAlive();
        extra.ensureStillAlive();
        _ = this.handlers.callEventHandler(event, this_value, ctx_value, &[_]jsc.JSValue{ ctx_value, value, extra });
    }

    pub fn dispatchWith2Extra(this: *H2FrameParser, comptime event: js.gc, value: jsc.JSValue, extra: jsc.JSValue, extra2: jsc.JSValue) void {
        jsc.markBinding(@src());

        const this_value = this.strong_this.tryGet() orelse return;
        const ctx_value = js.gc.context.get(this_value) orelse return;
        value.ensureStillAlive();
        extra.ensureStillAlive();
        extra2.ensureStillAlive();
        _ = this.handlers.callEventHandler(event, this_value, ctx_value, &[_]jsc.JSValue{ ctx_value, value, extra, extra2 });
    }

    pub fn dispatchWith3Extra(this: *H2FrameParser, comptime event: js.gc, value: jsc.JSValue, extra: jsc.JSValue, extra2: jsc.JSValue, extra3: jsc.JSValue) void {
        jsc.markBinding(@src());

        const this_value = this.strong_this.tryGet() orelse return;
        const ctx_value = js.gc.context.get(this_value) orelse return;
        value.ensureStillAlive();
        extra.ensureStillAlive();
        extra2.ensureStillAlive();
        extra3.ensureStillAlive();
        _ = this.handlers.callEventHandler(event, this_value, ctx_value, &[_]jsc.JSValue{ ctx_value, value, extra, extra2, extra3 });
    }

    fn cork(this: *H2FrameParser) void {
        if (CORKED_H2) |corked| {
            if (@intFromPtr(corked) == @intFromPtr(this)) {
                // already corked
                return;
            }
            // force uncork
            corked.uncork();
        }
        // cork
        CORKED_H2 = this;
        this.ref();
        this.registerAutoFlush();
        log("cork {*}", .{this});
        CORK_OFFSET = 0;
    }

    pub fn _genericFlush(this: *H2FrameParser, comptime T: type, socket: T) usize {
        const buffer = this.writeBuffer.slice()[this.writeBufferOffset..];
        if (buffer.len > 0) {
            const result: i32 = socket.writeMaybeCorked(buffer);
            const written: u32 = if (result < 0) 0 else @intCast(result);

            if (written < buffer.len) {
                this.writeBufferOffset += written;
                log("_genericFlush {}", .{written});
                return written;
            }

            // all the buffer was written! reset things
            this.writeBufferOffset = 0;
            this.writeBuffer.len = 0;
            // lets keep size under control
            if (this.writeBuffer.cap > MAX_BUFFER_SIZE) {
                this.writeBuffer.len = MAX_BUFFER_SIZE;
                this.writeBuffer.shrinkAndFree(this.allocator, MAX_BUFFER_SIZE);
                this.writeBuffer.clearRetainingCapacity();
            }
            log("_genericFlush {}", .{buffer.len});
        } else {
            log("_genericFlush 0", .{});
        }
        return buffer.len;
    }

    pub fn _genericWrite(this: *H2FrameParser, comptime T: type, socket: T, bytes: []const u8) bool {
        log("_genericWrite {}", .{bytes.len});

        const buffer = this.writeBuffer.slice()[this.writeBufferOffset..];
        if (buffer.len > 0) {
            {
                const result: i32 = socket.writeMaybeCorked(buffer);
                const written: u32 = if (result < 0) 0 else @intCast(result);
                if (written < buffer.len) {
                    this.writeBufferOffset += written;

                    // we still have more to buffer and even more now
                    _ = bun.handleOom(this.writeBuffer.write(this.allocator, bytes));
                    this.globalThis.vm().reportExtraMemory(bytes.len);

                    log("_genericWrite flushed {} and buffered more {}", .{ written, bytes.len });
                    return false;
                }
            }
            // all the buffer was written!
            this.writeBufferOffset = 0;
            this.writeBuffer.len = 0;
            {
                const result: i32 = socket.writeMaybeCorked(bytes);
                const written: u32 = if (result < 0) 0 else @intCast(result);
                if (written < bytes.len) {
                    const pending = bytes[written..];
                    // ops not all data was sent, lets buffer again
                    _ = bun.handleOom(this.writeBuffer.write(this.allocator, pending));
                    this.globalThis.vm().reportExtraMemory(pending.len);

                    log("_genericWrite buffered more {}", .{pending.len});
                    return false;
                }
            }
            // lets keep size under control
            if (this.writeBuffer.cap > MAX_BUFFER_SIZE) {
                this.writeBuffer.len = MAX_BUFFER_SIZE;
                this.writeBuffer.shrinkAndFree(this.allocator, MAX_BUFFER_SIZE);
                this.writeBuffer.clearRetainingCapacity();
            }
            return true;
        }
        const result: i32 = socket.writeMaybeCorked(bytes);
        const written: u32 = if (result < 0) 0 else @intCast(result);
        if (written < bytes.len) {
            const pending = bytes[written..];
            // ops not all data was sent, lets buffer again
            _ = bun.handleOom(this.writeBuffer.write(this.allocator, pending));
            this.globalThis.vm().reportExtraMemory(pending.len);

            return false;
        }
        return true;
    }

    /// be sure that we dont have any backpressure/data queued on writerBuffer before calling this
    fn flushStreamQueue(this: *H2FrameParser) usize {
        log("flushStreamQueue {}", .{this.outboundQueueSize});
        var written: usize = 0;
        var something_was_flushed = true;

        // try to send as much as we can until we reach backpressure or until we can't flush anymore
        while (this.outboundQueueSize > 0 and something_was_flushed) {
            var it = StreamResumableIterator.init(this);
            something_was_flushed = false;
            while (it.next()) |stream| {
                // reach backpressure
                const result = stream.flushQueue(this, &written);
                switch (result) {
                    .flushed => something_was_flushed = true,
                    .no_action => continue, // we can continue
                    .backpressure => return written, // backpressure we need to return
                }
            }
        }
        return written;
    }

    pub fn flush(this: *H2FrameParser) usize {
        log("flush", .{});
        this.ref();
        defer this.deref();
        this.uncork();
        var written = switch (this.native_socket) {
            .tls_writeonly, .tls => |socket| this._genericFlush(*TLSSocket, socket),
            .tcp_writeonly, .tcp => |socket| this._genericFlush(*TCPSocket, socket),
            else => {
                // consider that backpressure is gone and flush data queue
                this.has_nonnative_backpressure = false;
                const bytes = this.writeBuffer.slice();
                if (bytes.len > 0) {
                    defer {
                        // all the buffer was written/queued! reset things
                        this.writeBufferOffset = 0;
                        this.writeBuffer.len = 0;
                        // lets keep size under control
                        if (this.writeBuffer.cap > MAX_BUFFER_SIZE) {
                            this.writeBuffer.len = MAX_BUFFER_SIZE;
                            this.writeBuffer.shrinkAndFree(this.allocator, MAX_BUFFER_SIZE);
                            this.writeBuffer.clearRetainingCapacity();
                        }
                    }
                    const output_value = this.handlers.binary_type.toJS(bytes, this.handlers.globalObject) catch .zero; // TODO: properly propagate exception upwards
                    const result = this.call(.onWrite, output_value);
                    if (result.isBoolean() and !result.toBoolean()) {
                        this.has_nonnative_backpressure = true;
                        return bytes.len;
                    }
                }

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
        this.ref();
        defer this.deref();
        return switch (this.native_socket) {
            .tls_writeonly, .tls => |socket| this._genericWrite(*TLSSocket, socket, bytes),
            .tcp_writeonly, .tcp => |socket| this._genericWrite(*TCPSocket, socket, bytes),
            else => {
                if (this.has_nonnative_backpressure) {
                    // we should not invoke JS when we have backpressure is cheaper to keep it queued here
                    _ = bun.handleOom(this.writeBuffer.write(this.allocator, bytes));
                    this.globalThis.vm().reportExtraMemory(bytes.len);

                    return false;
                }
                // fallback to onWrite non-native callback
                const output_value = this.handlers.binary_type.toJS(bytes, this.handlers.globalObject) catch .zero; // TODO: properly propagate exception upwards
                const result = this.call(.onWrite, output_value);
                const code = if (result.isNumber()) result.to(i32) else -1;
                switch (code) {
                    -1 => {
                        // dropped
                        _ = bun.handleOom(this.writeBuffer.write(this.allocator, bytes));
                        this.globalThis.vm().reportExtraMemory(bytes.len);
                        this.has_nonnative_backpressure = true;
                    },
                    0 => {
                        // queued
                        this.has_nonnative_backpressure = true;
                    },
                    else => {
                        // sended!
                        return true;
                    },
                }
                return false;
            },
        };
    }

    fn hasBackpressure(this: *H2FrameParser) bool {
        return this.writeBuffer.len > 0 or this.has_nonnative_backpressure;
    }

    fn uncork(_: *H2FrameParser) void {
        if (CORKED_H2) |corked| {
            defer corked.deref();
            corked.unregisterAutoFlush();
            log("uncork {*}", .{corked});

            const bytes = CORK_BUFFER[0..CORK_OFFSET];
            CORK_OFFSET = 0;
            CORKED_H2 = null;

            if (bytes.len > 0) {
                _ = corked._write(bytes);
            }
        }
    }

    fn registerAutoFlush(this: *H2FrameParser) void {
        if (this.auto_flusher.registered) return;
        this.ref();
        AutoFlusher.registerDeferredMicrotaskWithTypeUnchecked(H2FrameParser, this, this.globalThis.bunVM());
    }

    fn unregisterAutoFlush(this: *H2FrameParser) void {
        if (!this.auto_flusher.registered) return;
        AutoFlusher.unregisterDeferredMicrotaskWithTypeUnchecked(H2FrameParser, this, this.globalThis.bunVM());
        this.deref();
    }

    pub fn onAutoFlush(this: *@This()) bool {
        this.ref();
        defer this.deref();
        _ = this.flush();
        // we will unregister ourselves when the buffer is empty
        return true;
    }

    pub fn write(this: *H2FrameParser, bytes: []const u8) bool {
        jsc.markBinding(@src());
        log("write {}", .{bytes.len});
        if (comptime ENABLE_AUTO_CORK) {
            this.cork();
            const available = CORK_BUFFER[CORK_OFFSET..];
            if (bytes.len > available.len) {
                // not worth corking
                if (CORK_OFFSET != 0) {
                    // clean already corked data
                    this.uncork();
                }
                return this._write(bytes);
            } else {
                // write at the cork buffer
                CORK_OFFSET += @truncate(bytes.len);
                @memcpy(available[0..bytes.len], bytes);
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
            _ = bun.handleOom(this.readBuffer.appendSlice(payload));
            this.globalThis.vm().reportExtraMemory(payload.len);

            return null;
        } else if (this.remainingLength < 0) {
            this.sendGoAway(streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "Invalid frame size", this.lastStreamID, true);
            return null;
        }

        this.currentFrame = null;

        if (this.readBuffer.list.items.len > 0) {
            // return buffered data
            _ = bun.handleOom(this.readBuffer.appendSlice(payload));
            this.globalThis.vm().reportExtraMemory(payload.len);

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
        log("handleWindowUpdateFrame {}", .{frame.streamIdentifier});
        // must be always 4 bytes (https://datatracker.ietf.org/doc/html/rfc7540#section-6.9)
        if (frame.length != 4) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "Invalid dataframe frame size", this.lastStreamID, true);
            return data.len;
        }

        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            // at this point we try to send more data because we received a window update
            defer _ = this.flush();
            const payload = content.data;
            const windowSizeIncrement = UInt31WithReserved.fromBytes(payload);
            this.readBuffer.reset();
            if (stream) |s| {
                s.remoteWindowSize += windowSizeIncrement.uint31;
            } else {
                this.remoteWindowSize += windowSizeIncrement.uint31;
            }
            log("windowSizeIncrement stream {} value {}", .{ frame.streamIdentifier, windowSizeIncrement });
            return content.end;
        }
        // needs more data
        return data.len;
    }

    pub fn decodeHeaderBlock(this: *H2FrameParser, payload: []const u8, stream: *Stream, flags: u8) bun.JSError!?*Stream {
        log("decodeHeaderBlock isSever: {}", .{this.isServer});

        var offset: usize = 0;
        const globalObject = this.handlers.globalObject;
        if (this.handlers.vm.isShuttingDown()) {
            return null;
        }

        const stream_id = stream.id;
        const headers = try jsc.JSValue.createEmptyArray(globalObject, 0);
        headers.ensureStillAlive();

        var sensitiveHeaders: JSValue = .js_undefined;
        var count: usize = 0;
        // RFC 7540 Section 6.5.2: Track cumulative header list size
        var headerListSize: usize = 0;

        while (true) {
            const header = this.decode(payload[offset..]) catch break;
            offset += header.next;
            log("header {s} {s}", .{ header.name, header.value });
            if (this.isServer and strings.eqlComptime(header.name, ":status")) {
                this.sendGoAway(stream_id, ErrorCode.PROTOCOL_ERROR, "Server received :status header", this.lastStreamID, true);

                if (this.streams.getEntry(stream_id)) |entry| return entry.value_ptr;
                return null;
            }

            // RFC 7540 Section 6.5.2: Calculate header list size
            // Size = name length + value length + HPACK entry overhead per header
            headerListSize += header.name.len + header.value.len + HPACK_ENTRY_OVERHEAD;

            // Check against maxHeaderListSize setting
            if (headerListSize > this.localSettings.maxHeaderListSize) {
                this.rejectedStreams += 1;
                if (this.maxRejectedStreams <= this.rejectedStreams) {
                    this.sendGoAway(stream_id, ErrorCode.ENHANCE_YOUR_CALM, "ENHANCE_YOUR_CALM", this.lastStreamID, true);
                } else {
                    this.endStream(stream, ErrorCode.ENHANCE_YOUR_CALM);
                }
                if (this.streams.getEntry(stream_id)) |entry| return entry.value_ptr;
                return null;
            }

            count += 1;
            if (this.maxHeaderListPairs < count) {
                this.rejectedStreams += 1;
                if (this.maxRejectedStreams <= this.rejectedStreams) {
                    this.sendGoAway(stream_id, ErrorCode.ENHANCE_YOUR_CALM, "ENHANCE_YOUR_CALM", this.lastStreamID, true);
                } else {
                    this.endStream(stream, ErrorCode.ENHANCE_YOUR_CALM);
                }
                if (this.streams.getEntry(stream_id)) |entry| return entry.value_ptr;
                return null;
            }

            if (getHTTP2CommonString(globalObject, header.well_know)) |js_header_name| {
                try headers.push(globalObject, js_header_name);
                try headers.push(globalObject, try bun.String.createUTF8ForJS(globalObject, header.value));
                if (header.never_index) {
                    if (sensitiveHeaders.isUndefined()) {
                        sensitiveHeaders = try jsc.JSValue.createEmptyArray(globalObject, 0);
                        sensitiveHeaders.ensureStillAlive();
                    }
                    try sensitiveHeaders.push(globalObject, js_header_name);
                }
            } else {
                const js_header_name = try bun.String.createUTF8ForJS(globalObject, header.name);
                const js_header_value = try bun.String.createUTF8ForJS(globalObject, header.value);

                if (header.never_index) {
                    if (sensitiveHeaders.isUndefined()) {
                        sensitiveHeaders = try jsc.JSValue.createEmptyArray(globalObject, 0);
                        sensitiveHeaders.ensureStillAlive();
                    }
                    try sensitiveHeaders.push(globalObject, js_header_name);
                }

                try headers.push(globalObject, js_header_name);
                try headers.push(globalObject, js_header_value);

                js_header_name.ensureStillAlive();
                js_header_value.ensureStillAlive();
            }

            if (offset >= payload.len) {
                break;
            }
        }

        this.dispatchWith3Extra(.onStreamHeaders, stream.getIdentifier(), headers, sensitiveHeaders, jsc.JSValue.jsNumber(flags));
        // callbacks can change the Stream ptr in this case we always return the new one
        if (this.streams.getEntry(stream_id)) |entry| return entry.value_ptr;
        return null;
    }

    pub fn handleDataFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream_: ?*Stream) usize {
        log("handleDataFrame {s} data.len: {d}", .{ if (this.isServer) "server" else "client", data.len });
        this.readBuffer.reset();

        var stream = stream_ orelse {
            log("received data frame on stream that does not exist", .{});
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Data frame on connection stream", this.lastStreamID, true);
            return data.len;
        };

        const settings = this.remoteSettings orelse this.localSettings;

        if (frame.length > settings.maxFrameSize) {
            log("received data frame with length: {d} and max frame size: {d}", .{ frame.length, settings.maxFrameSize });
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "Invalid dataframe frame size", this.lastStreamID, true);
            return data.len;
        }

        const end: usize = @min(@as(usize, @intCast(this.remainingLength)), data.len);
        var payload = data[0..end];
        // window size considering the full frame.length received so far
        this.adjustWindowSize(stream, @truncate(payload.len));
        const previous_remaining_length: isize = this.remainingLength;

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
            }
        }
        if (this.remainingLength < 0) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "Invalid data frame size", this.lastStreamID, true);
            return data.len;
        }
        var emitted = false;

        const start_idx = frame.length - @as(usize, @intCast(previous_remaining_length));
        if (start_idx < 1 and padding > 0 and payload.len > 0) {
            // we need to skip the padding byte
            payload = payload[1..];
        }

        if (payload.len > 0) {
            // amount of data received so far
            const received_size = frame.length - this.remainingLength;
            // max size possible for the chunk without padding and skipping the start_idx
            const max_payload_size: usize = frame.length - padding - @as(usize, if (padding > 0) 1 else 0) - start_idx;
            payload = payload[0..@min(payload.len, max_payload_size)];
            log("received_size: {d} max_payload_size: {d} padding: {d} payload.len: {d}", .{
                received_size,
                max_payload_size,
                padding,
                payload.len,
            });

            if (payload.len > 0) {
                // no padding, just emit the data
                const chunk = this.handlers.binary_type.toJS(payload, this.handlers.globalObject) catch .zero; // TODO: properly propagate exception upwards
                this.dispatchWithExtra(.onStreamData, stream.getIdentifier(), chunk);
                emitted = true;
            }
        }
        if (this.remainingLength == 0) {
            this.currentFrame = null;
            stream.padding = null;
            if (emitted) {
                // we need to revalidate the stream ptr after emitting onStreamData
                const entry = this.streams.getEntry(frame.streamIdentifier) orelse return end;
                stream = entry.value_ptr;
            }
            if (frame.flags & @intFromEnum(DataFrameFlags.END_STREAM) != 0) {
                const identifier = stream.getIdentifier();
                identifier.ensureStillAlive();

                if (stream.state == .HALF_CLOSED_LOCAL) {
                    stream.state = .CLOSED;
                    stream.freeResources(this, false);
                } else {
                    stream.state = .HALF_CLOSED_REMOTE;
                }
                this.dispatchWithExtra(.onStreamEnd, identifier, jsc.JSValue.jsNumber(@intFromEnum(stream.state)));
            }
        }

        return end;
    }

    pub fn handleGoAwayFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream_: ?*Stream) usize {
        log("handleGoAwayFrame {} {s}", .{ frame.streamIdentifier, data });
        if (stream_ != null) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "GoAway frame on stream", this.lastStreamID, true);
            return data.len;
        }
        const settings = this.remoteSettings orelse this.localSettings;

        if (frame.length < 8 or frame.length > settings.maxFrameSize) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "invalid GoAway frame size", this.lastStreamID, true);
            return data.len;
        }

        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            const payload = content.data;
            const error_code = u32FromBytes(payload[4..8]);
            const chunk = this.handlers.binary_type.toJS(payload[8..], this.handlers.globalObject) catch .zero; // TODO: properly propagate exception upwards
            this.readBuffer.reset();
            this.dispatchWith2Extra(.onGoAway, jsc.JSValue.jsNumber(error_code), jsc.JSValue.jsNumber(this.lastStreamID), chunk);
            return content.end;
        }
        return data.len;
    }

    fn stringOrEmptyToJS(this: *H2FrameParser, payload: []const u8) bun.JSError!jsc.JSValue {
        if (payload.len == 0) {
            return bun.String.empty.toJS(this.handlers.globalObject);
        }
        return bun.String.createUTF8ForJS(this.handlers.globalObject, payload);
    }

    pub fn handleOriginFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, _: ?*Stream) bun.JSError!usize {
        log("handleOriginFrame {s}", .{data});
        if (this.isServer) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "ORIGIN frame on server", this.lastStreamID, true);
            return data.len;
        }
        if (frame.streamIdentifier != 0) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "ORIGIN frame on stream", this.lastStreamID, true);
            return data.len;
        }
        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            var payload = content.data;
            var originValue: JSValue = .js_undefined;
            var count: usize = 0;
            this.readBuffer.reset();

            while (payload.len > 0) {
                var stream = std.io.fixedBufferStream(payload);
                const origin_length = stream.reader().readInt(u16, .big) catch |err| {
                    log("error reading ORIGIN frame size: {s}", .{@errorName(err)});
                    // origin length is the first 2 bytes of the payload
                    this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "invalid ORIGIN frame size", this.lastStreamID, true);
                    return content.end;
                };
                var origin_str = payload[2..];
                if (origin_str.len < origin_length) {
                    this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "invalid ORIGIN frame size", this.lastStreamID, true);
                    return content.end;
                }
                origin_str = origin_str[0..origin_length];
                if (count == 0) {
                    originValue = try this.stringOrEmptyToJS(origin_str);
                    originValue.ensureStillAlive();
                } else if (count == 1) {
                    // need to create an array
                    const array = try jsc.JSValue.createEmptyArray(this.handlers.globalObject, 0);
                    array.ensureStillAlive();
                    try array.push(this.handlers.globalObject, originValue);
                    try array.push(this.handlers.globalObject, try this.stringOrEmptyToJS(origin_str));
                    originValue = array;
                } else {
                    // we already have an array, just add the origin to it
                    try originValue.push(this.handlers.globalObject, try this.stringOrEmptyToJS(origin_str));
                }
                count += 1;
                payload = payload[origin_length + 2 ..];
            }

            this.dispatch(.onOrigin, originValue);
            return content.end;
        }
        return data.len;
    }

    pub fn handleAltsvcFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream_: ?*Stream) bun.JSError!usize {
        log("handleAltsvcFrame {s}", .{data});
        if (this.isServer) {
            // client should not send ALTSVC frame
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "ALTSVC frame on server", this.lastStreamID, true);
            return data.len;
        }
        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            const payload = content.data;

            var stream = std.io.fixedBufferStream(payload);
            this.readBuffer.reset();

            const origin_length = stream.reader().readInt(u16, .big) catch {
                // origin length is the first 2 bytes of the payload
                this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "invalid ALTSVC frame size", this.lastStreamID, true);
                return content.end;
            };
            const origin_and_value = payload[2..];

            if (origin_and_value.len < origin_length) {
                this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "invalid ALTSVC frame size", this.lastStreamID, true);
                return content.end;
            }
            if (frame.streamIdentifier != 0 and stream_ == null) {
                // dont error but stream dont exist so we can ignore it
                return content.end;
            }

            this.dispatchWith2Extra(.onAltSvc, try this.stringOrEmptyToJS(origin_and_value[0..origin_length]), try this.stringOrEmptyToJS(origin_and_value[origin_length..]), jsc.JSValue.jsNumber(frame.streamIdentifier));
            return content.end;
        }
        return data.len;
    }

    pub fn handleRSTStreamFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream_: ?*Stream) usize {
        log("handleRSTStreamFrame {s}", .{data});
        var stream = stream_ orelse {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "RST_STREAM frame on connection stream", this.lastStreamID, true);
            return data.len;
        };

        if (frame.length != 4) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "invalid RST_STREAM frame size", this.lastStreamID, true);
            return data.len;
        }

        if (stream.isWaitingMoreHeaders) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Headers frame without continuation", this.lastStreamID, true);
            return data.len;
        }

        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            const payload = content.data;
            const rst_code = u32FromBytes(payload);
            stream.rstCode = rst_code;
            this.readBuffer.reset();
            stream.state = .CLOSED;
            const identifier = stream.getIdentifier();
            identifier.ensureStillAlive();
            stream.freeResources(this, false);
            if (rst_code == @intFromEnum(ErrorCode.NO_ERROR)) {
                this.dispatchWithExtra(.onStreamEnd, identifier, jsc.JSValue.jsNumber(@intFromEnum(stream.state)));
            } else {
                this.dispatchWithExtra(.onStreamError, identifier, jsc.JSValue.jsNumber(rst_code));
            }
            return content.end;
        }
        return data.len;
    }

    pub fn handlePingFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream_: ?*Stream) usize {
        if (stream_ != null) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Ping frame on stream", this.lastStreamID, true);
            return data.len;
        }

        if (frame.length != 8) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "Invalid ping frame size", this.lastStreamID, true);
            return data.len;
        }

        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            const payload = content.data;
            const isNotACK = frame.flags & @intFromEnum(PingFrameFlags.ACK) == 0;
            this.readBuffer.reset();

            // if is not ACK send response
            if (isNotACK) {
                this.sendPing(true, payload);
            } else {
                this.outStandingPings -|= 1;
            }
            const buffer = this.handlers.binary_type.toJS(payload, this.handlers.globalObject) catch .zero; // TODO: properly propagate exception upwards
            this.dispatchWithExtra(.onPing, buffer, jsc.JSValue.jsBoolean(!isNotACK));
            return content.end;
        }
        return data.len;
    }

    pub fn handlePriorityFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream_: ?*Stream) usize {
        var stream = stream_ orelse {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Priority frame on connection stream", this.lastStreamID, true);
            return data.len;
        };

        if (frame.length != StreamPriority.byteSize) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "invalid Priority frame size", this.lastStreamID, true);
            return data.len;
        }

        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            const payload = content.data;

            var priority: StreamPriority = undefined;
            priority.from(payload);
            this.readBuffer.reset();

            const stream_identifier = UInt31WithReserved.from(priority.streamIdentifier);
            if (stream_identifier.uint31 == stream.id) {
                this.sendGoAway(stream.id, ErrorCode.PROTOCOL_ERROR, "Priority frame with self dependency", this.lastStreamID, true);
                return content.end;
            }
            stream.streamDependency = stream_identifier.uint31;
            stream.exclusive = stream_identifier.reserved;
            stream.weight = priority.weight;

            return content.end;
        }
        return data.len;
    }

    /// RFC 7540 Section 6.10: Handle CONTINUATION frame (type=0x9).
    /// CONTINUATION frames continue header block fragments that don't fit in a single HEADERS frame.
    /// - Must follow a HEADERS, PUSH_PROMISE, or CONTINUATION frame without END_HEADERS flag
    /// - No padding allowed (unlike HEADERS frames)
    /// - Must have same stream identifier as the initiating frame
    pub fn handleContinuationFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream_: ?*Stream) bun.JSError!usize {
        log("handleContinuationFrame", .{});
        var stream = stream_ orelse {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Continuation on connection stream", this.lastStreamID, true);
            return data.len;
        };

        if (!stream.isWaitingMoreHeaders) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Continuation without headers", this.lastStreamID, true);
            return data.len;
        }
        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            const payload = content.data;
            this.readBuffer.reset();
            stream.endAfterHeaders = frame.flags & @intFromEnum(HeadersFrameFlags.END_STREAM) != 0;
            stream = (try this.decodeHeaderBlock(payload[0..payload.len], stream, frame.flags)) orelse {
                return content.end;
            };
            if (stream.endAfterHeaders) {
                stream.isWaitingMoreHeaders = false;
                if (frame.flags & @intFromEnum(HeadersFrameFlags.END_STREAM) != 0) {
                    const identifier = stream.getIdentifier();
                    identifier.ensureStillAlive();
                    if (stream.state == .HALF_CLOSED_REMOTE) {
                        // no more continuation headers we can call it closed
                        stream.state = .CLOSED;
                        stream.freeResources(this, false);
                    } else {
                        stream.state = .HALF_CLOSED_LOCAL;
                    }
                    this.dispatchWithExtra(.onStreamEnd, identifier, jsc.JSValue.jsNumber(@intFromEnum(stream.state)));
                }
            }

            return content.end;
        }

        // needs more data
        return data.len;
    }

    pub fn handleHeadersFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8, stream_: ?*Stream) bun.JSError!usize {
        log("handleHeadersFrame {s}", .{if (this.isServer) "server" else "client"});
        var stream = stream_ orelse {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Headers frame on connection stream", this.lastStreamID, true);
            return data.len;
        };

        const settings = this.remoteSettings orelse this.localSettings;
        if (frame.length > settings.maxFrameSize) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "invalid Headers frame size", this.lastStreamID, true);
            return data.len;
        }

        if (stream.isWaitingMoreHeaders) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Headers frame without continuation", this.lastStreamID, true);
            return data.len;
        }

        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            const payload = content.data;
            var offset: usize = 0;
            var padding: usize = 0;
            this.readBuffer.reset();

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
                this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "invalid Headers frame size", this.lastStreamID, true);
                return content.end;
            }
            stream.endAfterHeaders = frame.flags & @intFromEnum(HeadersFrameFlags.END_STREAM) != 0;
            stream = (try this.decodeHeaderBlock(payload[offset..end], stream, frame.flags)) orelse {
                return content.end;
            };
            stream.isWaitingMoreHeaders = frame.flags & @intFromEnum(HeadersFrameFlags.END_HEADERS) == 0;
            if (stream.endAfterHeaders) {
                const identifier = stream.getIdentifier();
                identifier.ensureStillAlive();

                if (stream.isWaitingMoreHeaders) {
                    stream.state = .HALF_CLOSED_REMOTE;
                } else {
                    // no more continuation headers we can call it closed
                    if (stream.state == .HALF_CLOSED_LOCAL) {
                        stream.state = .CLOSED;
                        stream.freeResources(this, false);
                    } else {
                        stream.state = .HALF_CLOSED_REMOTE;
                    }
                }
                this.dispatchWithExtra(.onStreamEnd, identifier, jsc.JSValue.jsNumber(@intFromEnum(stream.state)));
            }
            return content.end;
        }

        // needs more data
        return data.len;
    }

    pub fn handleSettingsFrame(this: *H2FrameParser, frame: FrameHeader, data: []const u8) usize {
        const isACK = frame.flags & @intFromEnum(SettingsFlags.ACK) != 0;

        log("handleSettingsFrame {s} isACK {}", .{ if (this.isServer) "server" else "client", isACK });
        if (frame.streamIdentifier != 0) {
            this.sendGoAway(frame.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Settings frame on connection stream", this.lastStreamID, true);
            return data.len;
        }
        defer if (!isACK) this.sendSettingsACK();

        const settingByteSize = SettingsPayloadUnit.byteSize;
        if (frame.length > 0) {
            if (isACK or frame.length % settingByteSize != 0) {
                log("invalid settings frame size", .{});
                this.sendGoAway(frame.streamIdentifier, ErrorCode.FRAME_SIZE_ERROR, "Invalid settings frame size", this.lastStreamID, true);
                return data.len;
            }
        } else {
            if (isACK) {
                // we received an ACK
                log("settings frame ACK", .{});

                // we can now write any request
                if (this.outstandingSettings > 0) {
                    this.outstandingSettings -= 1;

                    // Per RFC 7540 Section 6.9.2: When INITIAL_WINDOW_SIZE changes, adjust
                    // all existing stream windows by the difference. Now that our SETTINGS
                    // is ACKed, the peer knows about our window size, so we can enforce it.
                    if (this.outstandingSettings == 0 and this.localSettings.initialWindowSize != DEFAULT_WINDOW_SIZE) {
                        const old_size: i64 = DEFAULT_WINDOW_SIZE;
                        const new_size: i64 = this.localSettings.initialWindowSize;
                        const delta = new_size - old_size;
                        var it = this.streams.valueIterator();
                        while (it.next()) |stream| {
                            // Adjust the stream's local window size by the delta
                            if (delta >= 0) {
                                stream.windowSize +|= @intCast(@as(u64, @intCast(delta)));
                            } else {
                                stream.windowSize -|= @intCast(@as(u64, @intCast(-delta)));
                            }
                        }
                        log("adjusted stream windows by delta {} (old: {}, new: {})", .{ delta, old_size, new_size });
                    }
                }

                this.dispatch(.onLocalSettings, this.localSettings.toJS(this.handlers.globalObject));
            } else {
                defer _ = this.flush();
                defer this.incrementWindowSizeIfNeeded();
                log("empty settings has remoteSettings? {}", .{this.remoteSettings != null});
                if (this.remoteSettings == null) {

                    // ok empty settings so default settings
                    var remoteSettings: FullSettingsPayload = .{};
                    this.remoteSettings = remoteSettings;
                    log("remoteSettings.initialWindowSize: {} {} {}", .{ remoteSettings.initialWindowSize, this.remoteUsedWindowSize, this.remoteWindowSize });

                    if (remoteSettings.initialWindowSize >= this.remoteWindowSize) {
                        var it = this.streams.valueIterator();
                        while (it.next()) |stream| {
                            if (remoteSettings.initialWindowSize >= stream.remoteWindowSize) {
                                stream.remoteWindowSize = remoteSettings.initialWindowSize;
                            }
                        }
                    }
                    this.dispatch(.onRemoteSettings, remoteSettings.toJS(this.handlers.globalObject));
                }
            }

            this.currentFrame = null;
            return 0;
        }
        if (handleIncommingPayload(this, data, frame.streamIdentifier)) |content| {
            defer _ = this.flush();
            defer this.incrementWindowSizeIfNeeded();
            var remoteSettings: FullSettingsPayload = this.remoteSettings orelse .{};
            var i: usize = 0;
            const payload = content.data;
            while (i < payload.len) {
                defer i += settingByteSize;
                var unit: SettingsPayloadUnit = undefined;
                SettingsPayloadUnit.from(&unit, payload[i .. i + settingByteSize], 0, true);
                remoteSettings.updateWith(unit);
                log("remoteSettings: {} {} isServer: {}", .{ @as(SettingsType, @enumFromInt(unit.type)), unit.value, this.isServer });
            }
            this.readBuffer.reset();
            this.remoteSettings = remoteSettings;
            log("remoteSettings.initialWindowSize: {} {} {}", .{ remoteSettings.initialWindowSize, this.remoteUsedWindowSize, this.remoteWindowSize });
            if (remoteSettings.initialWindowSize >= this.remoteWindowSize) {
                var it = this.streams.valueIterator();
                while (it.next()) |stream| {
                    if (remoteSettings.initialWindowSize >= stream.remoteWindowSize) {
                        stream.remoteWindowSize = remoteSettings.initialWindowSize;
                    }
                }
            }
            this.dispatch(.onRemoteSettings, remoteSettings.toJS(this.handlers.globalObject));
            return content.end;
        }
        // needs more data
        return data.len;
    }

    /// We need to be very carefull because this is not a stable ptr
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
        const entry = bun.handleOom(this.streams.getOrPut(streamIdentifier));

        // Per RFC 7540 Section 6.5.1: The sender of SETTINGS can only rely on the
        // setting being applied AFTER receiving SETTINGS_ACK. Until then, the peer
        // hasn't seen our settings and uses the default window size.
        // So we must accept data up to DEFAULT_WINDOW_SIZE until our SETTINGS is ACKed.
        const local_window_size = if (this.outstandingSettings > 0)
            DEFAULT_WINDOW_SIZE
        else
            this.localSettings.initialWindowSize;
        entry.value_ptr.* = Stream.init(
            streamIdentifier,
            local_window_size,
            if (this.remoteSettings) |s| s.initialWindowSize else DEFAULT_WINDOW_SIZE,
            this.paddingStrategy,
        );
        const this_value = this.strong_this.tryGet() orelse return entry.value_ptr;
        const ctx_value = js.gc.context.get(this_value) orelse return entry.value_ptr;
        const callback = js.gc.onStreamStart.get(this_value) orelse return entry.value_ptr;

        // we assume that onStreamStart will never mutate the stream hash map
        _ = callback.call(this.handlers.globalObject, ctx_value, &[_]jsc.JSValue{ ctx_value, jsc.JSValue.jsNumber(streamIdentifier) }) catch |err| {
            this.handlers.globalObject.reportActiveExceptionAsUnhandled(err);
        };
        return entry.value_ptr;
    }

    fn readBytes(this: *H2FrameParser, bytes: []const u8) bun.JSError!usize {
        log("read {}", .{bytes.len});
        if (this.isServer and this.prefaceReceivedLen < 24) {
            // Handle Server Preface
            const preface_missing: usize = 24 - this.prefaceReceivedLen;
            const preface_available = @min(preface_missing, bytes.len);
            if (!strings.eql(bytes[0..preface_available], "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"[this.prefaceReceivedLen .. preface_available + this.prefaceReceivedLen])) {
                // invalid preface
                log("invalid preface", .{});
                this.sendGoAway(0, ErrorCode.PROTOCOL_ERROR, "Invalid preface", this.lastStreamID, true);
                return preface_available;
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
                @intFromEnum(FrameType.HTTP_FRAME_ALTSVC) => this.handleAltsvcFrame(header, bytes, stream),
                @intFromEnum(FrameType.HTTP_FRAME_ORIGIN) => this.handleOriginFrame(header, bytes, stream),
                else => {
                    this.sendGoAway(header.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Unknown frame type", this.lastStreamID, true);
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
                _ = bun.handleOom(this.readBuffer.appendSlice(bytes));
                this.globalThis.vm().reportExtraMemory(bytes.len);

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

            return switch (header.type) {
                @intFromEnum(FrameType.HTTP_FRAME_SETTINGS) => this.handleSettingsFrame(header, bytes[needed..]) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_WINDOW_UPDATE) => this.handleWindowUpdateFrame(header, bytes[needed..], stream) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_HEADERS) => (try this.handleHeadersFrame(header, bytes[needed..], stream)) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_DATA) => this.handleDataFrame(header, bytes[needed..], stream) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_CONTINUATION) => (try this.handleContinuationFrame(header, bytes[needed..], stream)) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_PRIORITY) => this.handlePriorityFrame(header, bytes[needed..], stream) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_PING) => this.handlePingFrame(header, bytes[needed..], stream) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_GOAWAY) => this.handleGoAwayFrame(header, bytes[needed..], stream) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_RST_STREAM) => this.handleRSTStreamFrame(header, bytes[needed..], stream) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_ALTSVC) => (try this.handleAltsvcFrame(header, bytes[needed..], stream)) + needed,
                @intFromEnum(FrameType.HTTP_FRAME_ORIGIN) => (try this.handleOriginFrame(header, bytes[needed..], stream)) + needed,
                else => {
                    this.sendGoAway(header.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Unknown frame type", this.lastStreamID, true);
                    return bytes.len;
                },
            };
        }

        if (bytes.len < FrameHeader.byteSize) {
            // buffer more dheaderata
            bun.handleOom(this.readBuffer.appendSlice(bytes));
            this.globalThis.vm().reportExtraMemory(bytes.len);

            return bytes.len;
        }

        FrameHeader.from(&header, bytes[0..FrameHeader.byteSize], 0, true);

        log("new frame {s} {} {} {} {}", .{ if (this.isServer) "server" else "client", header.type, header.length, header.flags, header.streamIdentifier });
        this.currentFrame = header;
        this.remainingLength = header.length;
        const stream = this.handleReceivedStreamID(header.streamIdentifier);
        return switch (header.type) {
            @intFromEnum(FrameType.HTTP_FRAME_SETTINGS) => this.handleSettingsFrame(header, bytes[FrameHeader.byteSize..]) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_WINDOW_UPDATE) => this.handleWindowUpdateFrame(header, bytes[FrameHeader.byteSize..], stream) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_HEADERS) => (try this.handleHeadersFrame(header, bytes[FrameHeader.byteSize..], stream)) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_DATA) => this.handleDataFrame(header, bytes[FrameHeader.byteSize..], stream) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_CONTINUATION) => (try this.handleContinuationFrame(header, bytes[FrameHeader.byteSize..], stream)) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_PRIORITY) => this.handlePriorityFrame(header, bytes[FrameHeader.byteSize..], stream) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_PING) => this.handlePingFrame(header, bytes[FrameHeader.byteSize..], stream) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_GOAWAY) => this.handleGoAwayFrame(header, bytes[FrameHeader.byteSize..], stream) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_RST_STREAM) => this.handleRSTStreamFrame(header, bytes[FrameHeader.byteSize..], stream) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_ALTSVC) => (try this.handleAltsvcFrame(header, bytes[FrameHeader.byteSize..], stream)) + FrameHeader.byteSize,
            @intFromEnum(FrameType.HTTP_FRAME_ORIGIN) => (try this.handleOriginFrame(header, bytes[FrameHeader.byteSize..], stream)) + FrameHeader.byteSize,
            else => {
                this.sendGoAway(header.streamIdentifier, ErrorCode.PROTOCOL_ERROR, "Unknown frame type", this.lastStreamID, true);
                return bytes.len;
            },
        };
    }

    const DirectWriterStruct = struct {
        writer: *H2FrameParser,
        pub fn write(this: *const DirectWriterStruct, data: []const u8) !usize {
            return if (this.writer.write(data)) data.len else 0;
        }
    };

    fn toWriter(this: *H2FrameParser) DirectWriterStruct {
        return DirectWriterStruct{ .writer = this };
    }

    pub fn setEncoding(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(1);
        if (args_list.len < 1) {
            return globalObject.throw("Expected encoding argument", .{});
        }
        this.handlers.binary_type = BinaryType.fromJSValue(globalObject, args_list.ptr[0]) orelse {
            const err = jsc.toInvalidArguments("Expected 'binaryType' to be 'arraybuffer', 'uint8array', 'buffer'", .{}, globalObject).asObjectRef();
            return globalObject.throwValue(err);
        };

        return .js_undefined;
    }

    pub fn loadSettingsFromJSValue(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, options: jsc.JSValue) bun.JSError!void {
        if (options.isEmptyOrUndefinedOrNull() or !options.isObject()) {
            return globalObject.throw("Expected settings to be a object", .{});
        }

        if (try options.get(globalObject, "headerTableSize")) |headerTableSize| {
            if (headerTableSize.isNumber()) {
                const value = headerTableSize.asNumber();
                if (value < 0 or value > MAX_HEADER_TABLE_SIZE_F64) {
                    return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected headerTableSize to be a number between 0 and 2^32-1", .{}).throw();
                }
                this.localSettings.headerTableSize = @intFromFloat(value);
            } else if (!headerTableSize.isEmptyOrUndefinedOrNull()) {
                return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected headerTableSize to be a number", .{}).throw();
            }
        }

        if (try options.get(globalObject, "enablePush")) |enablePush| {
            if (enablePush.isBoolean()) {
                this.localSettings.enablePush = if (enablePush.asBoolean()) 1 else 0;
            } else if (!enablePush.isUndefined()) {
                return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE, "Expected enablePush to be a boolean", .{}).throw();
            }
        }

        if (try options.get(globalObject, "initialWindowSize")) |initialWindowSize| {
            if (initialWindowSize.isNumber()) {
                const value = initialWindowSize.asNumber();
                if (value < 0 or value > MAX_WINDOW_SIZE_F64) {
                    return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected initialWindowSize to be a number between 0 and 2^32-1", .{}).throw();
                }
                log("initialWindowSize: {d}", .{@as(u32, @intFromFloat(value))});
                this.localSettings.initialWindowSize = @intFromFloat(value);
            } else if (!initialWindowSize.isEmptyOrUndefinedOrNull()) {
                return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected initialWindowSize to be a number", .{}).throw();
            }
        }

        if (try options.get(globalObject, "maxFrameSize")) |maxFrameSize| {
            if (maxFrameSize.isNumber()) {
                const value = maxFrameSize.asNumber();
                if (value < 16384 or value > MAX_FRAME_SIZE_F64) {
                    return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxFrameSize to be a number between 16,384 and 2^24-1", .{}).throw();
                }
                this.localSettings.maxFrameSize = @intFromFloat(value);
            } else if (!maxFrameSize.isEmptyOrUndefinedOrNull()) {
                return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxFrameSize to be a number", .{}).throw();
            }
        }

        if (try options.get(globalObject, "maxConcurrentStreams")) |maxConcurrentStreams| {
            if (maxConcurrentStreams.isNumber()) {
                const value = maxConcurrentStreams.asNumber();
                if (value < 0 or value > MAX_HEADER_TABLE_SIZE_F64) {
                    return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxConcurrentStreams to be a number between 0 and 2^32-1", .{}).throw();
                }
                this.localSettings.maxConcurrentStreams = @intFromFloat(value);
            } else if (!maxConcurrentStreams.isEmptyOrUndefinedOrNull()) {
                return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxConcurrentStreams to be a number", .{}).throw();
            }
        }

        if (try options.get(globalObject, "maxHeaderListSize")) |maxHeaderListSize| {
            if (maxHeaderListSize.isNumber()) {
                const value = maxHeaderListSize.asNumber();
                if (value < 0 or value > MAX_HEADER_TABLE_SIZE_F64) {
                    return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxHeaderListSize to be a number between 0 and 2^32-1", .{}).throw();
                }
                this.localSettings.maxHeaderListSize = @intFromFloat(value);
            } else if (!maxHeaderListSize.isEmptyOrUndefinedOrNull()) {
                return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxHeaderListSize to be a number", .{}).throw();
            }
        }

        if (try options.get(globalObject, "maxHeaderSize")) |maxHeaderSize| {
            if (maxHeaderSize.isNumber()) {
                const value = maxHeaderSize.asNumber();
                if (value < 0 or value > MAX_HEADER_TABLE_SIZE_F64) {
                    return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxHeaderSize to be a number between 0 and 2^32-1", .{}).throw();
                }
                this.localSettings.maxHeaderListSize = @intFromFloat(value);
            } else if (!maxHeaderSize.isEmptyOrUndefinedOrNull()) {
                return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected maxHeaderSize to be a number", .{}).throw();
            }
        }

        // Validate customSettings
        if (try options.get(globalObject, "customSettings")) |customSettings| {
            if (!customSettings.isUndefined()) {
                const custom_settings_obj = customSettings.getObject() orelse {
                    return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE, "Expected customSettings to be an object", .{}).throw();
                };

                var count: usize = 0;
                var iter = try jsc.JSPropertyIterator(.{
                    .skip_empty_name = false,
                    .include_value = true,
                }).init(globalObject, custom_settings_obj);
                defer iter.deinit();

                while (try iter.next()) |prop_name| {
                    count += 1;
                    if (count > MAX_CUSTOM_SETTINGS) {
                        return globalObject.ERR(.HTTP2_TOO_MANY_CUSTOM_SETTINGS, "Number of custom settings exceeds MAX_ADDITIONAL_SETTINGS", .{}).throw();
                    }

                    // Validate setting ID (key) is in range [0, 0xFFFF]
                    const setting_id_str = prop_name.toUTF8(bun.default_allocator);
                    defer setting_id_str.deinit();
                    const setting_id = std.fmt.parseInt(u32, setting_id_str.slice(), 10) catch {
                        return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Invalid custom setting identifier", .{}).throw();
                    };
                    if (setting_id > 0xFFFF) {
                        return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Invalid custom setting identifier", .{}).throw();
                    }

                    // Validate setting value is in range [0, 2^32-1]
                    const setting_value = iter.value;
                    if (setting_value.isNumber()) {
                        const value = setting_value.asNumber();
                        if (value < 0 or value > MAX_HEADER_TABLE_SIZE_F64) {
                            return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Invalid custom setting value", .{}).throw();
                        }
                    } else {
                        return globalObject.ERR(.HTTP2_INVALID_SETTING_VALUE_RangeError, "Expected custom setting value to be a number", .{}).throw();
                    }
                }
            }
        }
        return;
    }

    pub fn updateSettings(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(1);
        if (args_list.len < 1) {
            return globalObject.throw("Expected settings argument", .{});
        }

        const options = args_list.ptr[0];

        try this.loadSettingsFromJSValue(globalObject, options);

        return JSValue.jsBoolean(this.setSettings(this.localSettings));
    }

    pub fn setLocalWindowSize(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(1);
        if (args_list.len < 1) {
            return globalObject.throwInvalidArguments("Expected windowSize argument", .{});
        }
        const windowSize = args_list.ptr[0];
        if (!windowSize.isNumber()) {
            return globalObject.throwInvalidArguments("Expected windowSize to be a number", .{});
        }
        const windowSizeValue: u32 = windowSize.to(u32);
        if (this.usedWindowSize > windowSizeValue) {
            return globalObject.throwInvalidArguments("Expected windowSize to be greater than usedWindowSize", .{});
        }
        this.windowSize = windowSizeValue;
        if (this.localSettings.initialWindowSize < windowSizeValue) {
            this.localSettings.initialWindowSize = windowSizeValue;
        }
        var it = this.streams.valueIterator();
        while (it.next()) |stream| {
            if (stream.usedWindowSize > windowSizeValue) {
                continue;
            }
            stream.windowSize = windowSizeValue;
        }
        return .js_undefined;
    }

    pub fn getCurrentState(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        var result = JSValue.createEmptyObject(globalObject, 9);
        result.put(globalObject, jsc.ZigString.static("effectiveLocalWindowSize"), jsc.JSValue.jsNumber(this.windowSize));
        result.put(globalObject, jsc.ZigString.static("effectiveRecvDataLength"), jsc.JSValue.jsNumber(this.windowSize - this.usedWindowSize));
        result.put(globalObject, jsc.ZigString.static("nextStreamID"), jsc.JSValue.jsNumber(this.getNextStreamID()));
        result.put(globalObject, jsc.ZigString.static("lastProcStreamID"), jsc.JSValue.jsNumber(this.lastStreamID));

        const settings: FullSettingsPayload = this.remoteSettings orelse .{};
        result.put(globalObject, jsc.ZigString.static("remoteWindowSize"), jsc.JSValue.jsNumber(settings.initialWindowSize));
        result.put(globalObject, jsc.ZigString.static("localWindowSize"), jsc.JSValue.jsNumber(this.localSettings.initialWindowSize));
        result.put(globalObject, jsc.ZigString.static("deflateDynamicTableSize"), jsc.JSValue.jsNumber(this.localSettings.headerTableSize));
        result.put(globalObject, jsc.ZigString.static("inflateDynamicTableSize"), jsc.JSValue.jsNumber(this.localSettings.headerTableSize));
        result.put(globalObject, jsc.ZigString.static("outboundQueueSize"), jsc.JSValue.jsNumber(this.outboundQueueSize));
        return result;
    }

    pub fn goaway(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(3);
        if (args_list.len < 1) {
            return globalObject.throw("Expected errorCode argument", .{});
        }

        const error_code_arg = args_list.ptr[0];

        if (!error_code_arg.isNumber()) {
            return globalObject.throw("Expected errorCode to be a number", .{});
        }
        const errorCode = error_code_arg.toInt32();
        if (errorCode < 1 and errorCode > 13) {
            return globalObject.throw("invalid errorCode", .{});
        }

        var lastStreamID = this.lastStreamID;
        if (args_list.len >= 2) {
            const last_stream_arg = args_list.ptr[1];
            if (!last_stream_arg.isEmptyOrUndefinedOrNull()) {
                if (!last_stream_arg.isNumber()) {
                    return globalObject.throw("Expected lastStreamId to be a number", .{});
                }
                const id = last_stream_arg.toInt32();
                if (id < 0 and id > MAX_STREAM_ID) {
                    return globalObject.throw("Expected lastStreamId to be a number between 1 and 2147483647", .{});
                }
                lastStreamID = @intCast(id);
            }
            if (args_list.len >= 3) {
                const opaque_data_arg = args_list.ptr[2];
                if (!opaque_data_arg.isEmptyOrUndefinedOrNull()) {
                    if (opaque_data_arg.asArrayBuffer(globalObject)) |array_buffer| {
                        const slice = array_buffer.byteSlice();
                        this.sendGoAway(0, @enumFromInt(errorCode), slice, lastStreamID, false);
                        return .js_undefined;
                    }
                }
            }
        }

        this.sendGoAway(0, @enumFromInt(errorCode), "", lastStreamID, false);
        return .js_undefined;
    }

    pub fn ping(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(1);
        if (args_list.len < 1) {
            return globalObject.throw("Expected payload argument", .{});
        }

        if (this.outStandingPings >= this.maxOutstandingPings) {
            const exception = globalObject.toTypeError(.HTTP2_PING_CANCEL, "HTTP2 ping cancelled", .{});
            return globalObject.throwValue(exception);
        }

        if (args_list.ptr[0].asArrayBuffer(globalObject)) |array_buffer| {
            const slice = array_buffer.slice();
            this.sendPing(false, slice);
            return .js_undefined;
        }

        return globalObject.throw("Expected payload to be a Buffer", .{});
    }

    pub fn origin(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const origin_arg = callframe.argument(0);
        if (origin_arg.isEmptyOrUndefinedOrNull()) {
            // empty origin frame
            var buffer: [FrameHeader.byteSize]u8 = undefined;
            @memset(&buffer, 0);
            var stream = std.io.fixedBufferStream(&buffer);
            const writer = stream.writer();

            var frame: FrameHeader = .{
                .type = @intFromEnum(FrameType.HTTP_FRAME_ORIGIN),
                .flags = 0,
                .streamIdentifier = 0,
                .length = 0,
            };
            _ = frame.write(@TypeOf(writer), writer);
            _ = this.write(&buffer);
            return .js_undefined;
        }

        if (origin_arg.isString()) {
            const origin_string = try origin_arg.toSlice(globalObject, bun.default_allocator);
            defer origin_string.deinit();
            const slice = origin_string.slice();
            if (slice.len + 2 > 16384) {
                const exception = globalObject.toTypeError(.HTTP2_ORIGIN_LENGTH, "HTTP/2 ORIGIN frames are limited to 16382 bytes", .{});
                return globalObject.throwValue(exception);
            }

            var buffer: [FrameHeader.byteSize + 2]u8 = undefined;
            @memset(&buffer, 0);
            var stream = std.io.fixedBufferStream(&buffer);
            const writer = stream.writer();

            var frame: FrameHeader = .{
                .type = @intFromEnum(FrameType.HTTP_FRAME_ORIGIN),
                .flags = 0,
                .streamIdentifier = 0,
                .length = @intCast(slice.len + 2),
            };
            _ = frame.write(@TypeOf(writer), writer);
            _ = writer.writeInt(u16, @intCast(slice.len), .big) catch 0;
            _ = this.write(&buffer);
            if (slice.len > 0) {
                _ = this.write(slice);
            }
        } else if (origin_arg.isArray()) {
            var buffer: [FrameHeader.byteSize + 16384]u8 = undefined;
            @memset(&buffer, 0);
            var stream = std.io.fixedBufferStream(&buffer);
            const writer = stream.writer();
            stream.seekTo(FrameHeader.byteSize) catch {};
            var value_iter = try origin_arg.arrayIterator(globalObject);

            while (try value_iter.next()) |item| {
                if (!item.isString()) {
                    return globalObject.throwInvalidArguments("Expected origin to be a string or an array of strings", .{});
                }
                const origin_string = try item.toSlice(globalObject, bun.default_allocator);
                defer origin_string.deinit();
                const slice = origin_string.slice();
                _ = writer.writeInt(u16, @intCast(slice.len), .big) catch {
                    const exception = globalObject.toTypeError(.HTTP2_ORIGIN_LENGTH, "HTTP/2 ORIGIN frames are limited to 16382 bytes", .{});
                    return globalObject.throwValue(exception);
                };

                _ = writer.write(slice) catch {
                    const exception = globalObject.toTypeError(.HTTP2_ORIGIN_LENGTH, "HTTP/2 ORIGIN frames are limited to 16382 bytes", .{});
                    return globalObject.throwValue(exception);
                };
            }

            const total_length: u32 = @intCast(stream.getPos() catch FrameHeader.byteSize);
            var frame: FrameHeader = .{
                .type = @intFromEnum(FrameType.HTTP_FRAME_ORIGIN),
                .flags = 0,
                .streamIdentifier = 0,
                .length = @intCast(total_length - FrameHeader.byteSize), // payload length
            };
            stream.reset();
            _ = frame.write(@TypeOf(writer), writer);
            _ = this.write(buffer[0..total_length]);
        }
        return .js_undefined;
    }

    pub fn altsvc(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        var origin_slice: ?bun.String.Slice = null;
        var value_slice: ?bun.String.Slice = null;
        defer {
            if (origin_slice) |slice| {
                slice.deinit();
            }
            if (value_slice) |slice| {
                slice.deinit();
            }
        }

        var origin_str: []const u8 = "";
        var value_str: []const u8 = "";
        var stream_id: u32 = 0;
        const origin_string = callframe.argument(0);
        if (!origin_string.isEmptyOrUndefinedOrNull()) {
            if (!origin_string.isString()) {
                return globalObject.throwInvalidArgumentTypeValue("origin", "origin", origin_string);
            }

            origin_slice = try origin_string.toSlice(globalObject, bun.default_allocator);
            origin_str = origin_slice.?.slice();
        }

        const value_string = callframe.argument(1);
        if (!value_string.isEmptyOrUndefinedOrNull()) {
            if (!value_string.isString()) {
                return globalObject.throwInvalidArgumentTypeValue("value", "value", value_string);
            }
            value_slice = try value_string.toSlice(globalObject, bun.default_allocator);
            value_str = value_slice.?.slice();
        }

        const stream_id_js = callframe.argument(2);
        if (!stream_id_js.isEmptyOrUndefinedOrNull()) {
            if (!stream_id_js.isNumber()) {
                return globalObject.throw("Expected streamId to be a number", .{});
            }
            stream_id = stream_id_js.toU32();
        }
        if (stream_id > 0) {
            // dont error but dont send frame to invalid stream id
            _ = this.streams.getPtr(stream_id) orelse {
                return .js_undefined;
            };
        }
        this.sendAltSvc(stream_id, origin_str, value_str);
        return .js_undefined;
    }

    pub fn getEndAfterHeaders(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(1);
        if (args_list.len < 1) {
            return globalObject.throw("Expected stream argument", .{});
        }
        const stream_arg = args_list.ptr[0];

        if (!stream_arg.isNumber()) {
            return globalObject.throw("Invalid stream id", .{});
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0) {
            return globalObject.throw("Invalid stream id", .{});
        }

        const stream = this.streams.getPtr(stream_id) orelse {
            return globalObject.throw("Invalid stream id", .{});
        };

        return jsc.JSValue.jsBoolean(stream.endAfterHeaders);
    }

    pub fn isStreamAborted(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(1);
        if (args_list.len < 1) {
            return globalObject.throw("Expected stream argument", .{});
        }
        const stream_arg = args_list.ptr[0];

        if (!stream_arg.isNumber()) {
            return globalObject.throw("Invalid stream id", .{});
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0) {
            return globalObject.throw("Invalid stream id", .{});
        }

        const stream = this.streams.getPtr(stream_id) orelse {
            return globalObject.throw("Invalid stream id", .{});
        };

        if (stream.signal) |signal_ref| {
            return jsc.JSValue.jsBoolean(signal_ref.isAborted());
        }
        // closed with cancel = aborted
        return jsc.JSValue.jsBoolean(stream.state == .CLOSED and stream.rstCode == @intFromEnum(ErrorCode.CANCEL));
    }

    pub fn getStreamState(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(1);
        if (args_list.len < 1) {
            return globalObject.throw("Expected stream argument", .{});
        }
        const stream_arg = args_list.ptr[0];

        if (!stream_arg.isNumber()) {
            return globalObject.throw("Invalid stream id", .{});
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0) {
            return globalObject.throw("Invalid stream id", .{});
        }

        var stream = this.streams.getPtr(stream_id) orelse {
            return globalObject.throw("Invalid stream id", .{});
        };
        var state = jsc.JSValue.createEmptyObject(globalObject, 6);

        state.put(globalObject, jsc.ZigString.static("localWindowSize"), jsc.JSValue.jsNumber(stream.windowSize));
        state.put(globalObject, jsc.ZigString.static("state"), jsc.JSValue.jsNumber(@intFromEnum(stream.state)));
        state.put(globalObject, jsc.ZigString.static("localClose"), jsc.JSValue.jsNumber(@as(i32, if (stream.canSendData()) 0 else 1)));
        state.put(globalObject, jsc.ZigString.static("remoteClose"), jsc.JSValue.jsNumber(@as(i32, if (stream.canReceiveData()) 0 else 1)));
        // TODO: sumDependencyWeight
        state.put(globalObject, jsc.ZigString.static("sumDependencyWeight"), jsc.JSValue.jsNumber(0));
        state.put(globalObject, jsc.ZigString.static("weight"), jsc.JSValue.jsNumber(stream.weight));

        return state;
    }

    pub fn setStreamPriority(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(2);
        if (args_list.len < 2) {
            return globalObject.throw("Expected stream and options arguments", .{});
        }
        const stream_arg = args_list.ptr[0];
        const options = args_list.ptr[1];

        if (!stream_arg.isNumber()) {
            return globalObject.throw("Invalid stream id", .{});
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0) {
            return globalObject.throw("Invalid stream id", .{});
        }

        var stream = this.streams.getPtr(stream_id) orelse {
            return globalObject.throw("Invalid stream id", .{});
        };

        if (!stream.canSendData() and !stream.canReceiveData()) {
            return .false;
        }

        if (!options.isObject()) {
            return globalObject.throw("Invalid priority", .{});
        }

        var weight = stream.weight;
        var exclusive = stream.exclusive;
        var parent_id = stream.streamDependency;
        var silent = false;
        if (try options.get(globalObject, "weight")) |js_weight| {
            if (js_weight.isNumber()) {
                const weight_u32 = js_weight.toU32();
                if (weight_u32 > 255) {
                    return globalObject.throw("Invalid weight", .{});
                }
                weight = @intCast(weight_u32);
            }
        }

        if (try options.get(globalObject, "parent")) |js_parent| {
            if (js_parent.isNumber()) {
                parent_id = js_parent.toU32();
                if (parent_id == 0 or parent_id > MAX_STREAM_ID) {
                    return globalObject.throw("Invalid stream id", .{});
                }
            }
        }

        if (try options.get(globalObject, "exclusive")) |js_exclusive| {
            exclusive = js_exclusive.toBoolean();
        }

        if (try options.get(globalObject, "silent")) |js_silent| {
            if (js_silent.isBoolean()) {
                silent = js_silent.asBoolean();
            } else {
                return globalObject.ERR(.INVALID_ARG_TYPE, "options.silent must be a boolean", .{}).throw();
            }
        }
        if (parent_id == stream.id) {
            this.sendGoAway(stream.id, ErrorCode.PROTOCOL_ERROR, "Stream with self dependency", this.lastStreamID, true);
            return .false;
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
        return .true;
    }

    pub fn rstStream(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        log("rstStream", .{});
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(2);
        if (args_list.len < 2) {
            return globalObject.throw("Expected stream and code arguments", .{});
        }
        const stream_arg = args_list.ptr[0];
        const error_arg = args_list.ptr[1];

        if (!stream_arg.isNumber()) {
            return globalObject.throw("Invalid stream id", .{});
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0 or stream_id > MAX_STREAM_ID) {
            return globalObject.throw("Invalid stream id", .{});
        }

        const stream = this.streams.getPtr(stream_id) orelse {
            return globalObject.throw("Invalid stream id", .{});
        };
        if (!error_arg.isNumber()) {
            return globalObject.throw("Invalid ErrorCode", .{});
        }

        const error_code = error_arg.toU32();

        this.endStream(stream, @enumFromInt(error_code));

        return .true;
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
        return (this.writeBuffer.len + this.queuedDataSize) / 1024 / 1024;
    }

    // get memory in bytes
    pub fn getBufferSize(this: *H2FrameParser, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        return jsc.JSValue.jsNumber(this.writeBuffer.len + this.queuedDataSize);
    }

    fn sendData(this: *H2FrameParser, stream: *Stream, payload: []const u8, close: bool, callback: jsc.JSValue) void {
        log("HTTP_FRAME_DATA {s} sendData({}, {}, {})", .{ if (this.isServer) "server" else "client", stream.id, payload.len, close });

        const writer = this.toWriter();
        const stream_id = stream.id;
        var enqueued = false;
        this.ref();

        defer {
            if (!enqueued) {
                this.dispatchWriteCallback(callback);
                if (close) {
                    if (stream.waitForTrailers) {
                        this.dispatch(.onWantTrailers, stream.getIdentifier());
                    } else {
                        const identifier = stream.getIdentifier();
                        identifier.ensureStillAlive();
                        if (stream.state == .HALF_CLOSED_REMOTE) {
                            stream.state = .CLOSED;
                            stream.freeResources(this, false);
                        } else {
                            stream.state = .HALF_CLOSED_LOCAL;
                        }
                        this.dispatchWithExtra(.onStreamEnd, identifier, jsc.JSValue.jsNumber(@intFromEnum(stream.state)));
                    }
                }
            }
            this.deref();
        }
        const can_close = close and !stream.waitForTrailers;
        if (payload.len == 0) {
            // empty payload we still need to send a frame
            var dataHeader: FrameHeader = .{
                .type = @intFromEnum(FrameType.HTTP_FRAME_DATA),
                .flags = if (can_close) @intFromEnum(DataFrameFlags.END_STREAM) else 0,
                .streamIdentifier = @intCast(stream_id),
                .length = 0,
            };
            if (this.hasBackpressure() or this.outboundQueueSize > 0) {
                enqueued = true;
                stream.queueFrame(this, "", callback, close);
            } else {
                _ = dataHeader.write(@TypeOf(writer), writer);
            }
        } else {
            var offset: usize = 0;

            while (offset < payload.len) {
                // max frame size will always be at least 16384 (but we need to respect the flow control)
                var max_size = @min(@min(MAX_PAYLOAD_SIZE_WITHOUT_FRAME, this.remoteWindowSize -| this.remoteUsedWindowSize), stream.remoteWindowSize -| stream.remoteUsedWindowSize);
                var is_flow_control_limited = false;
                if (max_size == 0) {
                    is_flow_control_limited = true;
                    // this will be handled later if cannot send the entire payload in one frame
                    max_size = MAX_PAYLOAD_SIZE_WITHOUT_FRAME;
                }
                const size = @min(payload.len - offset, max_size);

                const slice = payload[offset..(size + offset)];
                offset += size;
                const end_stream = offset >= payload.len and can_close;

                if (this.hasBackpressure() or this.outboundQueueSize > 0 or is_flow_control_limited) {
                    enqueued = true;
                    // write the full frame in memory and queue the frame
                    // the callback will only be called after the last frame is sended
                    stream.queueFrame(this, slice, if (offset >= payload.len) callback else .js_undefined, offset >= payload.len and close);
                } else {
                    const padding = stream.getPadding(size, max_size - 1);
                    const payload_size = size + (if (padding != 0) @as(usize, @intCast(padding)) + 1 else 0);
                    log("padding: {d} size: {d} max_size: {d} payload_size: {d}", .{ padding, size, max_size, payload_size });
                    stream.remoteUsedWindowSize += payload_size;
                    this.remoteUsedWindowSize += payload_size;
                    var flags: u8 = if (end_stream) @intFromEnum(DataFrameFlags.END_STREAM) else 0;
                    if (padding != 0) {
                        flags |= @intFromEnum(DataFrameFlags.PADDED);
                    }
                    var dataHeader: FrameHeader = .{
                        .type = @intFromEnum(FrameType.HTTP_FRAME_DATA),
                        .flags = flags,
                        .streamIdentifier = @intCast(stream_id),
                        .length = @truncate(payload_size),
                    };
                    _ = dataHeader.write(@TypeOf(writer), writer);
                    if (padding != 0) {
                        var buffer = shared_request_buffer[0..];
                        bun.memmove(buffer[1..][0..slice.len], slice);
                        buffer[0] = padding;
                        _ = writer.write(buffer[0..payload_size]) catch 0;
                    } else {
                        _ = writer.write(slice) catch 0;
                    }
                }
            }
        }
    }

    pub fn noTrailers(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(1);
        if (args_list.len < 1) {
            return globalObject.throw("Expected stream, headers and sensitiveHeaders arguments", .{});
        }

        const stream_arg = args_list.ptr[0];

        if (!stream_arg.isNumber()) {
            return globalObject.throw("Expected stream to be a number", .{});
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0 or stream_id > MAX_STREAM_ID) {
            return globalObject.throw("Invalid stream id", .{});
        }

        var stream = this.streams.getPtr(@intCast(stream_id)) orelse {
            return globalObject.throw("Invalid stream id", .{});
        };

        stream.waitForTrailers = false;
        this.sendData(stream, "", true, .js_undefined);

        const identifier = stream.getIdentifier();
        identifier.ensureStillAlive();
        if (stream.state == .HALF_CLOSED_REMOTE) {
            stream.state = .CLOSED;
            stream.freeResources(this, false);
        } else {
            stream.state = .HALF_CLOSED_LOCAL;
        }
        this.dispatchWithExtra(.onStreamEnd, identifier, jsc.JSValue.jsNumber(@intFromEnum(stream.state)));
        return .js_undefined;
    }

    /// validate header name and convert to lowecase if needed
    fn toValidHeaderName(in: []const u8, out: []u8) ![]const u8 {
        var in_slice = in;
        var out_slice = out;
        var any = false;
        if (in.len > 4096) return error.InvalidHeaderName;
        bun.assert(out.len >= in.len);
        // lets validate and convert to lowercase in one pass
        begin: while (true) {
            for (in_slice, 0..) |c, i| {
                switch (c) {
                    'A'...'Z' => {
                        bun.copy(u8, out_slice, in_slice[0..i]);
                        out_slice[i] = std.ascii.toLower(c);
                        const end = i + 1;
                        in_slice = in_slice[end..];
                        out_slice = out_slice[end..];
                        any = true;
                        continue :begin;
                    },
                    'a'...'z', '0'...'9', '!', '#', '$', '%', '&', '\'', '*', '+', '-', '.', '^', '_', '`', '|', '~' => {},
                    ':' => {
                        // only allow pseudoheaders at the beginning
                        if (i != 0 or any) {
                            return error.InvalidHeaderName;
                        }
                        continue;
                    },
                    else => return error.InvalidHeaderName,
                }
            }

            if (any) bun.copy(u8, out_slice, in_slice);
            break :begin;
        }

        return if (any) out[0..in.len] else in;
    }

    pub fn sendTrailers(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(3);
        if (args_list.len < 3) {
            return globalObject.throw("Expected stream, headers and sensitiveHeaders arguments", .{});
        }

        const stream_arg = args_list.ptr[0];
        const headers_arg = args_list.ptr[1];
        const sensitive_arg = args_list.ptr[2];

        if (!stream_arg.isNumber()) {
            return globalObject.throw("Expected stream to be a number", .{});
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0 or stream_id > MAX_STREAM_ID) {
            return globalObject.throw("Invalid stream id", .{});
        }

        var stream = this.streams.getPtr(@intCast(stream_id)) orelse {
            return globalObject.throw("Invalid stream id", .{});
        };

        const headers_obj = headers_arg.getObject() orelse {
            return globalObject.throw("Expected headers to be an object", .{});
        };

        if (!sensitive_arg.isObject()) {
            return globalObject.throw("Expected sensitiveHeaders to be an object", .{});
        }

        // Use remote settings maxFrameSize if available, otherwise default to localSettings
        const settings = this.remoteSettings orelse this.localSettings;
        _ = settings;
        // Use shared buffer when possible, fall back to heap for large headers
        var buf_fallback = bun.allocators.BufferFallbackAllocator.init(&shared_request_buffer, bun.default_allocator);
        const alloc = buf_fallback.allocator();
        // Use ArrayList with initial capacity of shared buffer size, doubling when needed
        var encoded_headers = std.ArrayListUnmanaged(u8){};
        // IMPORTANT: defer cleanup immediately after init to prevent memory leaks on early returns
        defer encoded_headers.deinit(alloc);
        // Pre-allocate to shared buffer size (this uses the stack buffer via BufferFallbackAllocator)
        encoded_headers.ensureTotalCapacity(alloc, shared_request_buffer.len) catch {
            return globalObject.throw("Failed to allocate header buffer", .{});
        };
        // max header name length for lshpack
        var name_buffer: [4096]u8 = undefined;
        @memset(&name_buffer, 0);

        var iter = try jsc.JSPropertyIterator(.{
            .skip_empty_name = false,
            .include_value = true,
        }).init(globalObject, headers_obj);
        defer iter.deinit();

        var single_value_headers: [SingleValueHeaders.keys().len]bool = undefined;
        @memset(&single_value_headers, false);

        // Encode trailer headers using HPACK
        while (try iter.next()) |header_name| {
            if (header_name.length() == 0) continue;

            const name_slice = header_name.toUTF8(bun.default_allocator);
            defer name_slice.deinit();
            const name = name_slice.slice();

            if (header_name.charAt(0) == ':') {
                const exception = globalObject.toTypeError(.HTTP2_INVALID_PSEUDOHEADER, "\"{s}\" is an invalid pseudoheader or is used incorrectly", .{name});
                return globalObject.throwValue(exception);
            }

            var js_value = iter.value;
            if (js_value.isUndefinedOrNull()) {
                const exception = globalObject.toTypeError(.HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{name});
                return globalObject.throwValue(exception);
            }
            const validated_name = toValidHeaderName(name, name_buffer[0..name.len]) catch {
                const exception = globalObject.toTypeError(.INVALID_HTTP_TOKEN, "The arguments Header name is invalid. Received {s}", .{name});
                return globalObject.throwValue(exception);
            };

            if (js_value.jsType().isArray()) {
                // https://github.com/oven-sh/bun/issues/8940
                var value_iter = try js_value.arrayIterator(globalObject);

                if (SingleValueHeaders.indexOf(validated_name)) |idx| {
                    if (value_iter.len > 1 or single_value_headers[idx]) {
                        const exception = globalObject.toTypeError(.HTTP2_HEADER_SINGLE_VALUE, "Header field \"{s}\" must only have a single value", .{validated_name});
                        return globalObject.throwValue(exception);
                    }
                    single_value_headers[idx] = true;
                }

                while (try value_iter.next()) |item| {
                    if (item.isEmptyOrUndefinedOrNull()) {
                        const exception = globalObject.toTypeError(.HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{validated_name});
                        return globalObject.throwValue(exception);
                    }

                    const value_str = item.toJSString(globalObject) catch {
                        globalObject.clearException();
                        const exception = globalObject.toTypeError(.HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{validated_name});
                        return globalObject.throwValue(exception);
                    };

                    const never_index = (try sensitive_arg.getTruthyPropertyValue(globalObject, validated_name) orelse try sensitive_arg.getTruthyPropertyValue(globalObject, name)) != null;

                    const value_slice = value_str.toSlice(globalObject, bun.default_allocator);
                    defer value_slice.deinit();
                    const value = value_slice.slice();
                    log("encode header {s} {s}", .{ validated_name, value });

                    _ = this.encodeHeaderIntoList(&encoded_headers, alloc, validated_name, value, never_index) catch |err| {
                        if (err == error.OutOfMemory) {
                            return globalObject.throw("Failed to allocate header buffer", .{});
                        }
                        stream.state = .CLOSED;
                        const identifier = stream.getIdentifier();
                        identifier.ensureStillAlive();
                        stream.freeResources(this, false);
                        stream.rstCode = @intFromEnum(ErrorCode.FRAME_SIZE_ERROR);
                        this.dispatchWith2Extra(
                            .onFrameError,
                            identifier,
                            jsc.JSValue.jsNumber(@intFromEnum(FrameType.HTTP_FRAME_HEADERS)),
                            jsc.JSValue.jsNumber(@intFromEnum(ErrorCode.FRAME_SIZE_ERROR)),
                        );
                        this.dispatchWithExtra(.onStreamError, identifier, jsc.JSValue.jsNumber(stream.rstCode));
                        return .js_undefined;
                    };
                }
            } else {
                if (SingleValueHeaders.indexOf(validated_name)) |idx| {
                    if (single_value_headers[idx]) {
                        const exception = globalObject.toTypeError(.HTTP2_HEADER_SINGLE_VALUE, "Header field \"{s}\" must only have a single value", .{validated_name});
                        return globalObject.throwValue(exception);
                    }
                    single_value_headers[idx] = true;
                }
                const value_str = js_value.toJSString(globalObject) catch {
                    globalObject.clearException();
                    const exception = globalObject.toTypeError(.HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{validated_name});
                    return globalObject.throwValue(exception);
                };

                const never_index = (try sensitive_arg.getTruthyPropertyValue(globalObject, validated_name) orelse try sensitive_arg.getTruthyPropertyValue(globalObject, name)) != null;

                const value_slice = value_str.toSlice(globalObject, bun.default_allocator);
                defer value_slice.deinit();
                const value = value_slice.slice();
                log("encode header {s} {s}", .{ name, value });

                _ = this.encodeHeaderIntoList(&encoded_headers, alloc, validated_name, value, never_index) catch |err| {
                    if (err == error.OutOfMemory) {
                        return globalObject.throw("Failed to allocate header buffer", .{});
                    }
                    stream.state = .CLOSED;
                    const identifier = stream.getIdentifier();
                    identifier.ensureStillAlive();
                    stream.freeResources(this, false);
                    stream.rstCode = @intFromEnum(ErrorCode.FRAME_SIZE_ERROR);
                    this.dispatchWith2Extra(
                        .onFrameError,
                        identifier,
                        jsc.JSValue.jsNumber(@intFromEnum(FrameType.HTTP_FRAME_HEADERS)),
                        jsc.JSValue.jsNumber(@intFromEnum(ErrorCode.FRAME_SIZE_ERROR)),
                    );
                    this.dispatchWithExtra(.onStreamError, identifier, jsc.JSValue.jsNumber(stream.rstCode));
                    return .js_undefined;
                };
            }
        }
        const encoded_data = encoded_headers.items;
        const encoded_size = encoded_data.len;

        // RFC 7540 Section 8.1: Trailers are sent as a HEADERS frame with END_STREAM flag
        const base_flags: u8 = @intFromEnum(HeadersFrameFlags.END_STREAM);
        // RFC 7540 Section 4.2: SETTINGS_MAX_FRAME_SIZE determines max frame payload
        const actual_max_frame_size = (this.remoteSettings orelse this.localSettings).maxFrameSize;

        log("trailers encoded_size {}", .{encoded_size});

        const writer = this.toWriter();

        // RFC 7540 Section 6.2 & 6.10: Check if we need CONTINUATION frames
        if (encoded_size <= actual_max_frame_size) {
            // Single HEADERS frame - header block fits in one frame
            var frame: FrameHeader = .{
                .type = @intFromEnum(FrameType.HTTP_FRAME_HEADERS),
                .flags = base_flags | @intFromEnum(HeadersFrameFlags.END_HEADERS),
                .streamIdentifier = stream.id,
                .length = @intCast(encoded_size),
            };
            _ = frame.write(@TypeOf(writer), writer);
            _ = writer.write(encoded_data) catch 0;
        } else {
            // RFC 7540 Section 6.2 & 6.10: Header block exceeds MAX_FRAME_SIZE.
            // Must split into HEADERS frame followed by one or more CONTINUATION frames.
            // Note: CONTINUATION frames cannot have padding (Section 6.10) - they carry
            // only header block fragments. END_HEADERS must be set on the last frame.
            log("Using CONTINUATION frames for trailers: encoded_size={d} max_frame_size={d}", .{ encoded_size, actual_max_frame_size });

            // RFC 7540 Section 6.2: First chunk goes in HEADERS frame (without END_HEADERS flag)
            // Trailers use END_STREAM but NOT END_HEADERS when more frames follow
            const first_chunk_size = actual_max_frame_size;

            var headers_frame: FrameHeader = .{
                .type = @intFromEnum(FrameType.HTTP_FRAME_HEADERS),
                .flags = base_flags, // END_STREAM but NOT END_HEADERS
                .streamIdentifier = stream.id,
                .length = @intCast(first_chunk_size),
            };
            _ = headers_frame.write(@TypeOf(writer), writer);
            _ = writer.write(encoded_data[0..first_chunk_size]) catch 0;

            // RFC 7540 Section 6.10: CONTINUATION frames carry remaining header block fragments.
            // They have no padding, no priority - just frame header + header block fragment.
            var offset: usize = first_chunk_size;
            while (offset < encoded_size) {
                const remaining = encoded_size - offset;
                const chunk_size = @min(remaining, actual_max_frame_size);
                const is_last = (offset + chunk_size >= encoded_size);

                // RFC 7540 Section 6.10: END_HEADERS flag must be set on the last frame
                var cont_frame: FrameHeader = .{
                    .type = @intFromEnum(FrameType.HTTP_FRAME_CONTINUATION),
                    .flags = if (is_last) @intFromEnum(HeadersFrameFlags.END_HEADERS) else 0,
                    .streamIdentifier = stream.id,
                    .length = @intCast(chunk_size),
                };
                _ = cont_frame.write(@TypeOf(writer), writer);
                _ = writer.write(encoded_data[offset..][0..chunk_size]) catch 0;

                offset += chunk_size;
            }
        }
        const identifier = stream.getIdentifier();
        identifier.ensureStillAlive();
        if (stream.state == .HALF_CLOSED_REMOTE) {
            stream.state = .CLOSED;
            stream.freeResources(this, false);
        } else {
            stream.state = .HALF_CLOSED_LOCAL;
        }
        this.dispatchWithExtra(.onStreamEnd, identifier, jsc.JSValue.jsNumber(@intFromEnum(stream.state)));
        return .js_undefined;
    }

    pub fn writeStream(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const args = callframe.argumentsUndef(5);
        const stream_arg, const data_arg, const encoding_arg, const close_arg, const callback_arg = args.ptr;

        if (!stream_arg.isNumber()) {
            return globalObject.throw("Expected stream to be a number", .{});
        }

        const stream_id = stream_arg.toU32();
        if (stream_id == 0 or stream_id > MAX_STREAM_ID) {
            return globalObject.throw("Invalid stream id", .{});
        }
        const close = close_arg.toBoolean();

        var stream = this.streams.getPtr(@intCast(stream_id)) orelse {
            return globalObject.throw("Invalid stream id", .{});
        };
        if (!stream.canSendData()) {
            this.dispatchWriteCallback(callback_arg);
            return .false;
        }

        const encoding: jsc.Node.Encoding = brk: {
            if (encoding_arg.isUndefined()) {
                break :brk .utf8;
            }

            if (!encoding_arg.isString()) {
                return globalObject.throwInvalidArgumentTypeValue("write", "encoding", encoding_arg);
            }

            break :brk try jsc.Node.Encoding.fromJS(encoding_arg, globalObject) orelse {
                return globalObject.throwInvalidArgumentTypeValue("write", "encoding", encoding_arg);
            };
        };

        var buffer: jsc.Node.StringOrBuffer = try jsc.Node.StringOrBuffer.fromJSWithEncoding(
            globalObject,
            bun.default_allocator,
            data_arg,
            encoding,
        ) orelse {
            return globalObject.throwInvalidArgumentTypeValue("write", "Buffer or String", data_arg);
        };
        defer buffer.deinit();

        this.sendData(stream, buffer.slice(), close, callback_arg);

        return .true;
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

    pub fn setNextStreamID(this: *H2FrameParser, _: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments();
        bun.debugAssert(args_list.len >= 1);
        const stream_id_arg = args_list.ptr[0];
        bun.debugAssert(stream_id_arg.isNumber());
        this.lastStreamID = stream_id_arg.to(u32);
        // to set the next stream id we need to decrement because we only keep the last stream id
        if (this.isServer) {
            if (this.lastStreamID % 2 == 0) {
                this.lastStreamID -= 2;
            } else {
                this.lastStreamID -= 1;
            }
        } else {
            if (this.lastStreamID % 2 == 0) {
                this.lastStreamID -= 1;
            } else if (this.lastStreamID == 1) {
                this.lastStreamID = 0;
            } else {
                this.lastStreamID -= 2;
            }
        }
        return .js_undefined;
    }

    pub fn hasNativeRead(this: *H2FrameParser, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
        return jsc.JSValue.jsBoolean(this.native_socket == .tcp or this.native_socket == .tls);
    }

    pub fn getNextStream(this: *H2FrameParser, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());

        const id = this.getNextStreamID();
        if (id > MAX_STREAM_ID) {
            return jsc.JSValue.jsNumber(-1);
        }
        _ = this.handleReceivedStreamID(id) orelse {
            return jsc.JSValue.jsNumber(-1);
        };

        return jsc.JSValue.jsNumber(id);
    }

    pub fn getStreamContext(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(1);
        if (args_list.len < 1) {
            return globalObject.throw("Expected stream_id argument", .{});
        }

        const stream_id_arg = args_list.ptr[0];
        if (!stream_id_arg.isNumber()) {
            return globalObject.throw("Expected stream_id to be a number", .{});
        }

        var stream = this.streams.getPtr(stream_id_arg.to(u32)) orelse {
            return globalObject.throw("Invalid stream id", .{});
        };

        return stream.jsContext.get() orelse .js_undefined;
    }

    pub fn setStreamContext(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(2);
        if (args_list.len < 2) {
            return globalObject.throw("Expected stream_id and context arguments", .{});
        }

        const stream_id_arg = args_list.ptr[0];
        if (!stream_id_arg.isNumber()) {
            return globalObject.throw("Expected stream_id to be a number", .{});
        }
        var stream = this.streams.getPtr(stream_id_arg.to(u32)) orelse {
            return globalObject.throw("Invalid stream id", .{});
        };
        const context_arg = args_list.ptr[1];
        if (!context_arg.isObject()) {
            return globalObject.throw("Expected context to be an object", .{});
        }

        stream.setContext(context_arg, globalObject);
        return .js_undefined;
    }

    pub fn forEachStream(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());
        const args = callframe.arguments();
        if (args.len < 1 or !args[0].isCallable()) {
            return .js_undefined;
        }
        const callback = args[0];
        const thisValue: JSValue = if (args.len > 1) args[1] else .js_undefined;
        var count: u32 = 0;
        var it = this.streams.valueIterator();
        while (it.next()) |stream| {
            const value = stream.jsContext.get() orelse continue;
            this.handlers.vm.eventLoop().runCallback(callback, globalObject, thisValue, &[_]jsc.JSValue{value});
            count += 1;
        }
        return .js_undefined;
    }

    pub fn emitAbortToAllStreams(this: *H2FrameParser, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());
        var it = StreamResumableIterator.init(this);
        while (it.next()) |stream| {

            // this is the oposite logic of emitErrorToallStreams, in this case we wanna to cancel this streams
            if (this.isServer) {
                if (stream.id % 2 == 0) continue;
            } else if (stream.id % 2 != 0) continue;
            if (stream.state != .CLOSED) {
                const old_state = stream.state;
                stream.state = .CLOSED;
                stream.rstCode = @intFromEnum(ErrorCode.CANCEL);
                const identifier = stream.getIdentifier();
                identifier.ensureStillAlive();
                stream.freeResources(this, false);
                this.dispatchWith2Extra(.onAborted, identifier, .js_undefined, jsc.JSValue.jsNumber(@intFromEnum(old_state)));
            }
        }
        return .js_undefined;
    }

    pub fn emitErrorToAllStreams(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());

        const args_list = callframe.arguments_old(1);
        if (args_list.len < 1) {
            return globalObject.throw("Expected error argument", .{});
        }

        var it = StreamResumableIterator.init(this);
        while (it.next()) |stream| {
            // if (this.isServer) {
            //     if (stream.id % 2 == 0) continue;
            // } else if (stream.id % 2 != 0) continue;
            if (stream.state != .CLOSED) {
                stream.state = .CLOSED;
                stream.rstCode = args_list.ptr[0].to(u32);
                const identifier = stream.getIdentifier();
                identifier.ensureStillAlive();
                stream.freeResources(this, false);
                this.dispatchWithExtra(.onStreamError, identifier, args_list.ptr[0]);
            }
        }
        return .js_undefined;
    }

    pub fn flushFromJS(this: *H2FrameParser, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());

        return jsc.JSValue.jsNumber(this.flush());
    }

    pub fn request(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        log("request", .{});

        const args_list = callframe.arguments_old(5);
        if (args_list.len < 4) {
            return globalObject.throw("Expected stream_id, stream_ctx, headers and sensitiveHeaders arguments", .{});
        }

        const stream_id_arg = args_list.ptr[0];
        const stream_ctx_arg = args_list.ptr[1];

        const headers_arg = args_list.ptr[2];
        const sensitive_arg = args_list.ptr[3];

        const headers_obj = headers_arg.getObject() orelse {
            return globalObject.throw("Expected headers to be an object", .{});
        };

        if (!sensitive_arg.isObject()) {
            return globalObject.throw("Expected sensitiveHeaders to be an object", .{});
        }
        // Use remote settings maxFrameSize if available, otherwise use localSettings.
        const settings = this.remoteSettings orelse this.localSettings;
        _ = settings;
        // Use shared buffer when possible, fall back to heap for large headers
        var buf_fallback = bun.allocators.BufferFallbackAllocator.init(&shared_request_buffer, bun.default_allocator);
        const alloc = buf_fallback.allocator();
        // Use ArrayList with initial capacity of shared buffer size, doubling when needed
        var encoded_headers = std.ArrayListUnmanaged(u8){};
        // IMPORTANT: defer cleanup immediately after init to prevent memory leaks on early returns
        defer encoded_headers.deinit(alloc);
        // Pre-allocate to shared buffer size (this uses the stack buffer via BufferFallbackAllocator)
        encoded_headers.ensureTotalCapacity(alloc, shared_request_buffer.len) catch {
            return globalObject.throw("Failed to allocate header buffer", .{});
        };
        // max header name length for lshpack
        var name_buffer: [4096]u8 = undefined;
        @memset(&name_buffer, 0);
        const stream_id: u32 = if (!stream_id_arg.isEmptyOrUndefinedOrNull() and stream_id_arg.isNumber()) stream_id_arg.to(u32) else this.getNextStreamID();
        if (stream_id > MAX_STREAM_ID) {
            return jsc.JSValue.jsNumber(-1);
        }

        // we iterate twice, because pseudo headers must be sent first, but can appear anywhere in the headers object
        var iter = try jsc.JSPropertyIterator(.{
            .skip_empty_name = false,
            .include_value = true,
        }).init(globalObject, headers_obj);
        defer iter.deinit();
        var single_value_headers: [SingleValueHeaders.keys().len]bool = undefined;
        @memset(&single_value_headers, false);

        for (0..2) |ignore_pseudo_headers| {
            iter.reset();

            while (try iter.next()) |header_name| {
                if (header_name.length() == 0) continue;

                const name_slice = header_name.toUTF8(bun.default_allocator);
                defer name_slice.deinit();
                const name = name_slice.slice();

                const validated_name = toValidHeaderName(name, name_buffer[0..name.len]) catch {
                    const exception = globalObject.toTypeError(.INVALID_HTTP_TOKEN, "The arguments Header name is invalid. Received \"{s}\"", .{name});
                    return globalObject.throwValue(exception);
                };

                if (header_name.charAt(0) == ':') {
                    if (ignore_pseudo_headers == 1) continue;

                    if (this.isServer) {
                        if (!ValidResponsePseudoHeaders.has(validated_name)) {
                            if (!globalObject.hasException()) {
                                return globalObject.ERR(.HTTP2_INVALID_PSEUDOHEADER, "\"{s}\" is an invalid pseudoheader or is used incorrectly", .{name}).throw();
                            }
                            return .zero;
                        }
                    } else {
                        if (!ValidRequestPseudoHeaders.has(validated_name)) {
                            if (!globalObject.hasException()) {
                                return globalObject.ERR(.HTTP2_INVALID_PSEUDOHEADER, "\"{s}\" is an invalid pseudoheader or is used incorrectly", .{name}).throw();
                            }
                            return .zero;
                        }
                    }
                } else if (ignore_pseudo_headers == 0) {
                    continue;
                }

                const js_value = iter.value;
                if (js_value.isUndefinedOrNull()) {
                    const exception = globalObject.toTypeError(.HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{name});
                    return globalObject.throwValue(exception);
                }

                if (js_value.jsType().isArray()) {
                    log("array header {s}", .{name});
                    // https://github.com/oven-sh/bun/issues/8940
                    var value_iter = try js_value.arrayIterator(globalObject);

                    if (SingleValueHeaders.indexOf(validated_name)) |idx| {
                        if (value_iter.len > 1 or single_value_headers[idx]) {
                            if (!globalObject.hasException()) {
                                const exception = globalObject.toTypeError(.HTTP2_HEADER_SINGLE_VALUE, "Header field \"{s}\" must only have a single value", .{validated_name});
                                return globalObject.throwValue(exception);
                            }
                            return .zero;
                        }
                        single_value_headers[idx] = true;
                    }

                    while (try value_iter.next()) |item| {
                        if (item.isEmptyOrUndefinedOrNull()) {
                            if (!globalObject.hasException()) {
                                return globalObject.ERR(.HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{validated_name}).throw();
                            }
                            return .zero;
                        }

                        const value_str = item.toJSString(globalObject) catch {
                            globalObject.clearException();
                            return globalObject.ERR(.HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{validated_name}).throw();
                        };

                        const never_index = (try sensitive_arg.getTruthyPropertyValue(globalObject, validated_name) orelse try sensitive_arg.getTruthyPropertyValue(globalObject, name)) != null;

                        const value_slice = value_str.toSlice(globalObject, bun.default_allocator);
                        defer value_slice.deinit();
                        const value = value_slice.slice();
                        log("encode header {s} {s}", .{ validated_name, value });

                        _ = this.encodeHeaderIntoList(&encoded_headers, alloc, validated_name, value, never_index) catch |err| {
                            if (err == error.OutOfMemory) {
                                return globalObject.throw("Failed to allocate header buffer", .{});
                            }
                            const stream = this.handleReceivedStreamID(stream_id) orelse {
                                return jsc.JSValue.jsNumber(-1);
                            };
                            if (!stream_ctx_arg.isEmptyOrUndefinedOrNull() and stream_ctx_arg.isObject()) {
                                stream.setContext(stream_ctx_arg, globalObject);
                            }
                            stream.state = .CLOSED;
                            stream.rstCode = @intFromEnum(ErrorCode.COMPRESSION_ERROR);
                            this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), jsc.JSValue.jsNumber(stream.rstCode));
                            return .js_undefined;
                        };
                    }
                } else if (!js_value.isEmptyOrUndefinedOrNull()) {
                    log("single header {s}", .{name});
                    if (SingleValueHeaders.indexOf(validated_name)) |idx| {
                        if (single_value_headers[idx]) {
                            const exception = globalObject.toTypeError(.HTTP2_HEADER_SINGLE_VALUE, "Header field \"{s}\" must only have a single value", .{validated_name});
                            return globalObject.throwValue(exception);
                        }
                        single_value_headers[idx] = true;
                    }
                    const value_str = js_value.toJSString(globalObject) catch {
                        globalObject.clearException();
                        return globalObject.ERR(.HTTP2_INVALID_HEADER_VALUE, "Invalid value for header \"{s}\"", .{name}).throw();
                    };

                    const never_index = (try sensitive_arg.getTruthyPropertyValue(globalObject, validated_name) orelse try sensitive_arg.getTruthyPropertyValue(globalObject, name)) != null;

                    const value_slice = value_str.toSlice(globalObject, bun.default_allocator);
                    defer value_slice.deinit();
                    const value = value_slice.slice();
                    log("encode header {s} {s}", .{ validated_name, value });

                    _ = this.encodeHeaderIntoList(&encoded_headers, alloc, validated_name, value, never_index) catch |err| {
                        if (err == error.OutOfMemory) {
                            return globalObject.throw("Failed to allocate header buffer", .{});
                        }
                        const stream = this.handleReceivedStreamID(stream_id) orelse {
                            return jsc.JSValue.jsNumber(-1);
                        };
                        stream.state = .CLOSED;
                        if (!stream_ctx_arg.isEmptyOrUndefinedOrNull() and stream_ctx_arg.isObject()) {
                            stream.setContext(stream_ctx_arg, globalObject);
                        }
                        stream.rstCode = @intFromEnum(ErrorCode.COMPRESSION_ERROR);
                        this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), jsc.JSValue.jsNumber(stream.rstCode));
                        return jsc.JSValue.jsNumber(stream_id);
                    };
                }
            }
        }
        const encoded_data = encoded_headers.items;
        const encoded_size = encoded_data.len;

        const stream = this.handleReceivedStreamID(stream_id) orelse {
            return jsc.JSValue.jsNumber(-1);
        };
        if (!stream_ctx_arg.isEmptyOrUndefinedOrNull() and stream_ctx_arg.isObject()) {
            stream.setContext(stream_ctx_arg, globalObject);
        }
        var flags: u8 = @intFromEnum(HeadersFrameFlags.END_HEADERS);
        var exclusive: bool = false;
        var has_priority: bool = false;
        var weight: i32 = 0;
        var parent: i32 = 0;
        var silent: bool = false;
        var waitForTrailers: bool = false;
        var end_stream: bool = false;
        if (args_list.len > 4 and !args_list.ptr[4].isEmptyOrUndefinedOrNull()) {
            const options = args_list.ptr[4];
            if (!options.isObject()) {
                stream.state = .CLOSED;
                stream.rstCode = @intFromEnum(ErrorCode.INTERNAL_ERROR);
                this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), jsc.JSValue.jsNumber(stream.rstCode));
                return jsc.JSValue.jsNumber(stream_id);
            }

            if (try options.get(globalObject, "paddingStrategy")) |padding_js| {
                if (padding_js.isNumber()) {
                    stream.paddingStrategy = switch (padding_js.to(u32)) {
                        1 => .aligned,
                        2 => .max,
                        else => .none,
                    };
                }
            }

            if (try options.get(globalObject, "waitForTrailers")) |trailes_js| {
                if (trailes_js.isBoolean()) {
                    waitForTrailers = trailes_js.asBoolean();
                    stream.waitForTrailers = waitForTrailers;
                }
            }

            if (try options.get(globalObject, "silent")) |silent_js| {
                if (silent_js.isBoolean()) {
                    silent = silent_js.asBoolean();
                } else {
                    return globalObject.throwInvalidArgumentTypeValue("options.silent", "boolean", silent_js);
                }
            }

            if (try options.get(globalObject, "endStream")) |end_stream_js| {
                if (end_stream_js.isBoolean()) {
                    if (end_stream_js.asBoolean()) {
                        end_stream = true;
                        // will end the stream after trailers
                        if (!waitForTrailers or this.isServer) {
                            flags |= @intFromEnum(HeadersFrameFlags.END_STREAM);
                        }
                    }
                } else {
                    return globalObject.throwInvalidArgumentTypeValue("options.endStream", "boolean", end_stream_js);
                }
            }

            if (try options.get(globalObject, "exclusive")) |exclusive_js| {
                if (exclusive_js.isBoolean()) {
                    if (exclusive_js.asBoolean()) {
                        exclusive = true;
                        stream.exclusive = true;
                        has_priority = true;
                    }
                } else {
                    return globalObject.throwInvalidArgumentTypeValue("options.exclusive", "boolean", exclusive_js);
                }
            }

            if (try options.get(globalObject, "parent")) |parent_js| {
                if (parent_js.isNumber() or parent_js.isInt32()) {
                    has_priority = true;
                    parent = parent_js.toInt32();
                    if (parent <= 0 or parent > MAX_STREAM_ID) {
                        stream.state = .CLOSED;
                        stream.rstCode = @intFromEnum(ErrorCode.INTERNAL_ERROR);
                        this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), jsc.JSValue.jsNumber(stream.rstCode));
                        return jsc.JSValue.jsNumber(stream.id);
                    }
                    stream.streamDependency = @intCast(parent);
                } else {
                    return globalObject.throwInvalidArgumentTypeValue("options.parent", "number", parent_js);
                }
            }

            if (try options.get(globalObject, "weight")) |weight_js| {
                if (weight_js.isNumber() or weight_js.isInt32()) {
                    has_priority = true;
                    weight = weight_js.toInt32();
                    if (weight < 1 or weight > std.math.maxInt(u8)) {
                        stream.state = .CLOSED;
                        stream.rstCode = @intFromEnum(ErrorCode.INTERNAL_ERROR);
                        this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), jsc.JSValue.jsNumber(stream.rstCode));
                        return jsc.JSValue.jsNumber(stream_id);
                    }
                    stream.weight = @intCast(weight);
                } else {
                    return globalObject.throwInvalidArgumentTypeValue("options.weight", "number", weight_js);
                }

                if (weight < 1 or weight > std.math.maxInt(u8)) {
                    stream.state = .CLOSED;
                    stream.rstCode = @intFromEnum(ErrorCode.INTERNAL_ERROR);
                    this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), jsc.JSValue.jsNumber(stream.rstCode));
                    return jsc.JSValue.jsNumber(stream_id);
                }

                stream.weight = @intCast(weight);
            }

            if (try options.get(globalObject, "signal")) |signal_arg| {
                if (signal_arg.as(jsc.WebCore.AbortSignal)) |signal_| {
                    if (signal_.aborted()) {
                        stream.state = .IDLE;
                        this.abortStream(stream, Bun__wrapAbortError(globalObject, signal_.abortReason()));
                        return jsc.JSValue.jsNumber(stream_id);
                    }
                    stream.attachSignal(this, signal_);
                } else {
                    return globalObject.throwInvalidArgumentTypeValue("options.signal", "AbortSignal", signal_arg);
                }
            }
        }

        // too much memory being use
        if (this.getSessionMemoryUsage() > this.maxSessionMemory) {
            stream.state = .CLOSED;
            stream.rstCode = @intFromEnum(ErrorCode.ENHANCE_YOUR_CALM);
            this.rejectedStreams += 1;
            this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), jsc.JSValue.jsNumber(stream.rstCode));
            if (this.rejectedStreams >= this.maxRejectedStreams) {
                const chunk = try this.handlers.binary_type.toJS("ENHANCE_YOUR_CALM", this.handlers.globalObject);
                this.dispatchWith2Extra(.onError, jsc.JSValue.jsNumber(@intFromEnum(ErrorCode.ENHANCE_YOUR_CALM)), jsc.JSValue.jsNumber(this.lastStreamID), chunk);
            }
            return jsc.JSValue.jsNumber(stream_id);
        }
        var length: usize = encoded_size;
        if (has_priority) {
            length += 5;
            flags |= @intFromEnum(HeadersFrameFlags.PRIORITY);
        }

        log("request encoded_size {}", .{encoded_size});

        // Check if headers block exceeds maxSendHeaderBlockLength
        if (this.maxSendHeaderBlockLength != 0 and encoded_size > this.maxSendHeaderBlockLength) {
            stream.state = .CLOSED;
            stream.rstCode = @intFromEnum(ErrorCode.REFUSED_STREAM);

            this.dispatchWith2Extra(
                .onFrameError,
                stream.getIdentifier(),
                jsc.JSValue.jsNumber(@intFromEnum(FrameType.HTTP_FRAME_HEADERS)),
                jsc.JSValue.jsNumber(@intFromEnum(ErrorCode.FRAME_SIZE_ERROR)),
            );

            this.dispatchWithExtra(.onStreamError, stream.getIdentifier(), jsc.JSValue.jsNumber(stream.rstCode));
            return jsc.JSValue.jsNumber(stream_id);
        }

        // RFC 7540 Section 4.2: SETTINGS_MAX_FRAME_SIZE determines max frame payload (default 16384)
        const actual_max_frame_size = (this.remoteSettings orelse this.localSettings).maxFrameSize;

        // RFC 7540 Section 6.2: HEADERS frame can include optional PRIORITY (5 bytes)
        const priority_overhead: usize = if (has_priority) StreamPriority.byteSize else 0;

        // Compute available payload budget for HEADERS frame (before padding is applied)
        const available_payload = actual_max_frame_size - priority_overhead;

        // RFC 7540 Section 6.10: CONTINUATION frames carry ONLY header block fragments.
        // Unlike HEADERS frames, CONTINUATION frames CANNOT have padding or priority fields.
        // When we need CONTINUATION frames, disable padding to keep the logic simple.
        // Pass available_payload as maxLen so getPadding can apply padding when headers fit in one frame.
        const padding: u8 = if (encoded_size > available_payload) 0 else stream.getPadding(encoded_size, available_payload);
        const padding_overhead: usize = if (padding != 0) @as(usize, @intCast(padding)) + 1 else 0;

        // Max payload for HEADERS frame (accounting for priority and padding overhead)
        const headers_frame_max_payload = available_payload - padding_overhead;

        const writer = this.toWriter();

        // Check if we need CONTINUATION frames
        if (encoded_size <= headers_frame_max_payload) {
            // Single HEADERS frame - fits in one frame
            const payload_size = encoded_size + priority_overhead + padding_overhead;
            log("padding: {d} size: {d} max_size: {d} payload_size: {d}", .{ padding, encoded_size, encoded_data.len, payload_size });

            if (padding != 0) {
                flags |= @intFromEnum(HeadersFrameFlags.PADDED);
            }

            var frame: FrameHeader = .{
                .type = @intFromEnum(FrameType.HTTP_FRAME_HEADERS),
                .flags = flags,
                .streamIdentifier = stream.id,
                .length = @intCast(payload_size),
            };
            _ = frame.write(@TypeOf(writer), writer);

            // Write priority data if present
            if (has_priority) {
                var stream_identifier: UInt31WithReserved = .{
                    .reserved = exclusive,
                    .uint31 = @intCast(parent),
                };
                var priority_data: StreamPriority = .{
                    .streamIdentifier = stream_identifier.toUInt32(),
                    .weight = @intCast(weight),
                };
                _ = priority_data.write(@TypeOf(writer), writer);
            }

            // Handle padding
            if (padding != 0) {
                // Need extra capacity for padding length byte and padding bytes
                encoded_headers.ensureTotalCapacity(alloc, encoded_size + padding_overhead) catch {
                    return globalObject.throw("Failed to allocate padding buffer", .{});
                };
                const buffer = encoded_headers.allocatedSlice();
                bun.memmove(buffer[1..][0..encoded_size], buffer[0..encoded_size]);
                buffer[0] = padding;
                _ = writer.write(buffer[0 .. encoded_size + padding_overhead]) catch 0;
            } else {
                _ = writer.write(encoded_data) catch 0;
            }
        } else {
            // RFC 7540 Section 6.2 & 6.10: Header blocks exceeding MAX_FRAME_SIZE must be split
            // into HEADERS frame followed by one or more CONTINUATION frames.
            // - HEADERS frame without END_HEADERS flag indicates more frames follow
            // - CONTINUATION frames carry remaining header block fragments
            // - Last frame (HEADERS or CONTINUATION) must have END_HEADERS flag set
            // - All frames must have the same stream identifier
            // - No other frames can be interleaved on this stream until END_HEADERS
            log("Using CONTINUATION frames: encoded_size={d} max_frame_payload={d}", .{ encoded_size, actual_max_frame_size });

            // RFC 7540 Section 6.2: First chunk goes in HEADERS frame (without END_HEADERS flag)
            // HEADERS frame can carry PRIORITY but CONTINUATION frames cannot.
            const first_chunk_size = actual_max_frame_size - priority_overhead;
            const headers_flags = flags & ~@as(u8, @intFromEnum(HeadersFrameFlags.END_HEADERS));

            var headers_frame: FrameHeader = .{
                .type = @intFromEnum(FrameType.HTTP_FRAME_HEADERS),
                .flags = headers_flags | (if (has_priority) @intFromEnum(HeadersFrameFlags.PRIORITY) else 0),
                .streamIdentifier = stream.id,
                .length = @intCast(first_chunk_size + priority_overhead),
            };
            _ = headers_frame.write(@TypeOf(writer), writer);

            // Write priority data if present (only in HEADERS frame, not CONTINUATION)
            if (has_priority) {
                var stream_identifier: UInt31WithReserved = .{
                    .reserved = exclusive,
                    .uint31 = @intCast(parent),
                };
                var priority_data: StreamPriority = .{
                    .streamIdentifier = stream_identifier.toUInt32(),
                    .weight = @intCast(weight),
                };
                _ = priority_data.write(@TypeOf(writer), writer);
            }

            // Write first chunk of header block fragment
            _ = writer.write(encoded_data[0..first_chunk_size]) catch 0;

            // RFC 7540 Section 6.10: CONTINUATION frames carry remaining header block fragments.
            // CONTINUATION frame format: just frame header + header block fragment (no padding, no priority)
            var offset: usize = first_chunk_size;
            while (offset < encoded_size) {
                const remaining = encoded_size - offset;
                const chunk_size = @min(remaining, actual_max_frame_size);
                const is_last = (offset + chunk_size >= encoded_size);

                // RFC 7540 Section 6.10: END_HEADERS flag must be set on the last frame
                var cont_frame: FrameHeader = .{
                    .type = @intFromEnum(FrameType.HTTP_FRAME_CONTINUATION),
                    .flags = if (is_last) @intFromEnum(HeadersFrameFlags.END_HEADERS) else 0,
                    .streamIdentifier = stream.id,
                    .length = @intCast(chunk_size),
                };
                _ = cont_frame.write(@TypeOf(writer), writer);
                _ = writer.write(encoded_data[offset..][0..chunk_size]) catch 0;

                offset += chunk_size;
            }
        }

        if (end_stream) {
            stream.endAfterHeaders = true;
            stream.state = .HALF_CLOSED_LOCAL;

            if (waitForTrailers) {
                this.dispatch(.onWantTrailers, stream.getIdentifier());
                return jsc.JSValue.jsNumber(stream_id);
            }
        } else {
            stream.waitForTrailers = waitForTrailers;
        }

        if (silent) {
            // TODO: should we make use of this in the future? We validate it.
        }

        return jsc.JSValue.jsNumber(stream_id);
    }

    pub fn read(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(1);
        if (args_list.len < 1) {
            return globalObject.throw("Expected 1 argument", .{});
        }
        defer this.incrementWindowSizeIfNeeded();
        const buffer = args_list.ptr[0];
        buffer.ensureStillAlive();
        if (buffer.asArrayBuffer(globalObject)) |array_buffer| {
            var bytes = array_buffer.byteSlice();
            // read all the bytes
            while (bytes.len > 0) {
                const result = try this.readBytes(bytes);
                bytes = bytes[result..];
            }
            return .js_undefined;
        }
        return globalObject.throw("Expected data to be a Buffer or ArrayBuffer", .{});
    }

    pub fn onNativeRead(this: *H2FrameParser, data: []const u8) bun.JSError!void {
        log("onNativeRead", .{});
        this.ref();
        defer this.deref();
        defer this.incrementWindowSizeIfNeeded();
        var bytes = data;
        while (bytes.len > 0) {
            const result = try this.readBytes(bytes);
            bytes = bytes[result..];
        }
    }

    pub fn onNativeWritable(this: *H2FrameParser) void {
        _ = this.flush();
    }

    pub fn onNativeClose(this: *H2FrameParser) void {
        log("onNativeClose", .{});
        this.detachNativeSocket();
    }

    pub fn setNativeSocketFromJS(this: *H2FrameParser, globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        jsc.markBinding(@src());
        const args_list = callframe.arguments_old(1);
        if (args_list.len < 1) {
            return globalObject.throw("Expected socket argument", .{});
        }

        const socket_js = args_list.ptr[0];
        this.detachNativeSocket();
        if (JSTLSSocket.fromJS(socket_js)) |socket| {
            log("TLSSocket attached", .{});
            defer _ = this.flush();
            if (socket.attachNativeCallback(.{ .h2 = this })) {
                this.native_socket = .{ .tls = socket };
            } else {
                socket.ref();

                this.native_socket = .{ .tls_writeonly = socket };
            }
            // if we started with non native and go to native we now control the backpressure internally
            this.has_nonnative_backpressure = false;
        } else if (JSTCPSocket.fromJS(socket_js)) |socket| {
            log("TCPSocket attached", .{});
            defer _ = this.flush();

            if (socket.attachNativeCallback(.{ .h2 = this })) {
                this.native_socket = .{ .tcp = socket };
            } else {
                socket.ref();

                this.native_socket = .{ .tcp_writeonly = socket };
            }
            // if we started with non native and go to native we now control the backpressure internally
            this.has_nonnative_backpressure = false;
        }
        return .js_undefined;
    }

    pub fn detachNativeSocket(this: *H2FrameParser) void {
        const native_socket = this.native_socket;
        this.native_socket = .{ .none = {} };

        switch (native_socket) {
            inline .tcp, .tls => |socket| {
                socket.detachNativeCallback();
            },
            inline .tcp_writeonly, .tls_writeonly => |socket| {
                socket.deref();
            },
            .none => {},
        }
    }

    pub fn constructor(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, thisValue: jsc.JSValue) bun.JSError!*H2FrameParser {
        const args_list = callframe.arguments_old(1);
        if (args_list.len < 1) {
            return globalObject.throw("Expected 1 argument", .{});
        }

        const options = args_list.ptr[0];
        if (options.isEmptyOrUndefinedOrNull() or options.isBoolean() or !options.isObject()) {
            return globalObject.throwInvalidArguments("expected options as argument", .{});
        }

        const context_obj = try options.get(globalObject, "context") orelse {
            return globalObject.throw("Expected \"context\" option", .{});
        };
        var handler_js = jsc.JSValue.zero;
        if (try options.get(globalObject, "handlers")) |handlers_| {
            handler_js = handlers_;
        }
        const handlers = try Handlers.fromJS(globalObject, handler_js, thisValue);

        var this = brk: {
            if (ENABLE_ALLOCATOR_POOL) {
                if (H2FrameParser.pool == null) {
                    H2FrameParser.pool = bun.handleOom(bun.default_allocator.create(H2FrameParser.H2FrameParserHiveAllocator));
                    H2FrameParser.pool.?.* = H2FrameParser.H2FrameParserHiveAllocator.init(bun.default_allocator);
                }
                const self = bun.handleOom(H2FrameParser.pool.?.tryGet());

                self.* = H2FrameParser{
                    .ref_count = .init(),
                    .handlers = handlers,
                    .globalThis = globalObject,
                    .allocator = bun.default_allocator,
                    .readBuffer = .{
                        .allocator = bun.default_allocator,
                        .list = .{
                            .items = &.{},
                            .capacity = 0,
                        },
                    },
                    .streams = bun.U32HashMap(Stream).init(bun.default_allocator),
                };
                break :brk self;
            } else {
                break :brk bun.new(H2FrameParser, .{
                    .ref_count = .init(),
                    .handlers = handlers,
                    .globalThis = globalObject,
                    .allocator = bun.default_allocator,
                    .readBuffer = .{
                        .allocator = bun.default_allocator,
                        .list = .{
                            .items = &.{},
                            .capacity = 0,
                        },
                    },
                    .streams = bun.U32HashMap(Stream).init(bun.default_allocator),
                });
            }
        };
        errdefer this.deinit();

        // check if socket is provided, and if it is a valid native socket
        if (try options.get(globalObject, "native")) |socket_js| {
            if (JSTLSSocket.fromJS(socket_js)) |socket| {
                log("TLSSocket attached", .{});
                defer _ = this.flush();
                if (socket.attachNativeCallback(.{ .h2 = this })) {
                    this.native_socket = .{ .tls = socket };
                } else {
                    socket.ref();

                    this.native_socket = .{ .tls_writeonly = socket };
                }
            } else if (JSTCPSocket.fromJS(socket_js)) |socket| {
                log("TCPSocket attached", .{});
                defer _ = this.flush();
                if (socket.attachNativeCallback(.{ .h2 = this })) {
                    this.native_socket = .{ .tcp = socket };
                } else {
                    socket.ref();

                    this.native_socket = .{ .tcp_writeonly = socket };
                }
            }
        }
        if (try options.get(globalObject, "settings")) |settings_js| {
            if (!settings_js.isEmptyOrUndefinedOrNull()) {
                log("settings received in the constructor", .{});
                try this.loadSettingsFromJSValue(globalObject, settings_js);

                if (try settings_js.get(globalObject, "maxOutstandingPings")) |max_pings| {
                    if (max_pings.isNumber()) {
                        this.maxOutstandingPings = max_pings.to(u64);
                    }
                }
                if (try settings_js.get(globalObject, "maxSessionMemory")) |max_memory| {
                    if (max_memory.isNumber()) {
                        this.maxSessionMemory = @truncate(max_memory.to(u64));
                        if (this.maxSessionMemory < 1) {
                            this.maxSessionMemory = 1;
                        }
                    }
                }
                if (try settings_js.get(globalObject, "maxHeaderListPairs")) |max_header_list_pairs| {
                    if (max_header_list_pairs.isNumber()) {
                        this.maxHeaderListPairs = @truncate(max_header_list_pairs.to(u64));
                        if (this.maxHeaderListPairs < 4) {
                            this.maxHeaderListPairs = 4;
                        }
                    }
                }
                if (try settings_js.get(globalObject, "maxSessionRejectedStreams")) |max_rejected_streams| {
                    if (max_rejected_streams.isNumber()) {
                        this.maxRejectedStreams = @truncate(max_rejected_streams.to(u64));
                    }
                }
                if (try settings_js.get(globalObject, "maxOutstandingSettings")) |max_outstanding_settings| {
                    if (max_outstanding_settings.isNumber()) {
                        this.maxOutstandingSettings = @max(1, @as(u32, @truncate(max_outstanding_settings.to(u64))));
                    }
                }
                if (try settings_js.get(globalObject, "maxSendHeaderBlockLength")) |max_send_header_block_length| {
                    if (max_send_header_block_length.isNumber()) {
                        this.maxSendHeaderBlockLength = @bitCast(max_send_header_block_length.toInt32());
                    }
                }
                if (try settings_js.get(globalObject, "paddingStrategy")) |padding_strategy| {
                    if (padding_strategy.isNumber()) {
                        this.paddingStrategy = switch (padding_strategy.to(u32)) {
                            1 => .aligned,
                            2 => .max,
                            else => .none,
                        };
                    }
                }
            }
        }
        var is_server = false;
        if (try options.get(globalObject, "type")) |type_js| {
            is_server = type_js.isNumber() and type_js.to(u32) == 0;
        }

        this.isServer = is_server;
        js.gc.context.set(thisValue, globalObject, context_obj);

        this.strong_this.setStrong(thisValue, globalObject);

        this.hpack = lshpack.HPACK.init(this.localSettings.headerTableSize);
        if (is_server) {
            _ = this.setSettings(this.localSettings);
        } else {
            // consider that we need to queue until the first flush
            this.has_nonnative_backpressure = true;
            this.sendPrefaceAndSettings();
        }
        return this;
    }

    pub fn detachFromJS(this: *H2FrameParser, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
        jsc.markBinding(@src());
        var it = this.streams.valueIterator();
        while (it.next()) |stream| {
            stream.freeResources(this, false);
        }
        this.detach();
        if (this.strong_this.tryGet()) |this_value| {
            js.gc.context.clear(this_value, this.globalThis);
            this.strong_this.setWeak(this_value);
        }
        return .js_undefined;
    }

    /// be careful when calling detach be sure that the socket is closed and the parser not accesible anymore
    /// this function can be called multiple times, it will erase stream info
    pub fn detach(this: *H2FrameParser) void {
        this.uncork();
        this.unregisterAutoFlush();
        this.detachNativeSocket();

        this.readBuffer.deinit();
        this.writeBuffer.clearAndFree(this.allocator);
        this.writeBufferOffset = 0;

        if (this.hpack) |hpack| {
            hpack.deinit();
            this.hpack = null;
        }
    }

    fn deinit(this: *H2FrameParser) void {
        log("deinit", .{});

        defer {
            if (ENABLE_ALLOCATOR_POOL) {
                H2FrameParser.pool.?.put(this);
            } else {
                bun.destroy(this);
            }
        }
        this.detach();
        this.strong_this.deinit();
        var it = this.streams.valueIterator();
        while (it.next()) |stream| {
            stream.freeResources(this, true);
        }
        var streams = this.streams;
        defer streams.deinit();
        this.streams = bun.U32HashMap(Stream).init(bun.default_allocator);
    }

    pub fn finalize(this: *H2FrameParser) void {
        log("finalize", .{});
        this.strong_this.deinit();
        this.deref();
    }
};

extern fn Bun__wrapAbortError(globalObject: *jsc.JSGlobalObject, cause: jsc.JSValue) jsc.JSValue;

const lshpack = @import("./lshpack.zig");
const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const MutableString = bun.MutableString;
const Output = bun.Output;
const strings = bun.strings;

const TCPSocket = bun.api.socket.TCPSocket;
const TLSSocket = bun.api.socket.TLSSocket;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const AutoFlusher = jsc.WebCore.AutoFlusher;
const BinaryType = jsc.ArrayBuffer.BinaryType;

const JSTCPSocket = jsc.Codegen.JSTCPSocket;
const JSTLSSocket = jsc.Codegen.JSTLSSocket;
