const uws = @This();

pub const us_socket_t = @import("uws/us_socket_t.zig").us_socket_t;
pub const SocketTLS = @import("./uws/socket.zig").SocketTLS;
pub const SocketTCP = @import("./uws/socket.zig").SocketTCP;
pub const InternalSocket = @import("./uws/socket.zig").InternalSocket;
pub const Socket = us_socket_t;
pub const Timer = @import("./uws/Timer.zig").Timer;
pub const SocketContext = @import("./uws/SocketContext.zig").SocketContext;
pub const ConnectingSocket = @import("./uws/ConnectingSocket.zig").ConnectingSocket;
pub const InternalLoopData = @import("./uws/InternalLoopData.zig").InternalLoopData;
pub const WindowsNamedPipe = @import("./uws/WindowsNamedPipe.zig");
pub const PosixLoop = @import("./uws/Loop.zig").PosixLoop;
pub const WindowsLoop = @import("./uws/Loop.zig").WindowsLoop;
pub const Request = @import("./uws/Request.zig").Request;
pub const AnyResponse = @import("./uws/Response.zig").AnyResponse;
pub const NewApp = @import("./uws/App.zig").NewApp;
pub const uws_res = @import("./uws/Response.zig").uws_res;
pub const RawWebSocket = @import("./uws/WebSocket.zig").RawWebSocket;
pub const AnyWebSocket = @import("./uws/WebSocket.zig").AnyWebSocket;
pub const WebSocketBehavior = @import("./uws/WebSocket.zig").WebSocketBehavior;
pub const AnySocket = @import("./uws/socket.zig").AnySocket;
pub const NewSocketHandler = @import("./uws/socket.zig").NewSocketHandler;
pub const UpgradedDuplex = @import("./uws/UpgradedDuplex.zig");
pub const ListenSocket = @import("./uws/ListenSocket.zig").ListenSocket;
pub const State = @import("./uws/Response.zig").State;
pub const Loop = @import("./uws/Loop.zig").Loop;
pub const udp = @import("./uws/udp.zig");
pub const BodyReaderMixin = @import("./uws/BodyReaderMixin.zig").BodyReaderMixin;

pub const LIBUS_TIMEOUT_GRANULARITY = @as(i32, 4);
pub const LIBUS_RECV_BUFFER_PADDING = @as(i32, 32);
pub const LIBUS_EXT_ALIGNMENT = @as(i32, 16);

pub const _COMPRESSOR_MASK: i32 = 255;
pub const _DECOMPRESSOR_MASK: i32 = 3840;
pub const DISABLED: i32 = 0;
pub const SHARED_COMPRESSOR: i32 = 1;
pub const SHARED_DECOMPRESSOR: i32 = 256;
pub const DEDICATED_DECOMPRESSOR_32KB: i32 = 3840;
pub const DEDICATED_DECOMPRESSOR_16KB: i32 = 3584;
pub const DEDICATED_DECOMPRESSOR_8KB: i32 = 3328;
pub const DEDICATED_DECOMPRESSOR_4KB: i32 = 3072;
pub const DEDICATED_DECOMPRESSOR_2KB: i32 = 2816;
pub const DEDICATED_DECOMPRESSOR_1KB: i32 = 2560;
pub const DEDICATED_DECOMPRESSOR_512B: i32 = 2304;
pub const DEDICATED_DECOMPRESSOR: i32 = 3840;
pub const DEDICATED_COMPRESSOR_3KB: i32 = 145;
pub const DEDICATED_COMPRESSOR_4KB: i32 = 146;
pub const DEDICATED_COMPRESSOR_8KB: i32 = 163;
pub const DEDICATED_COMPRESSOR_16KB: i32 = 180;
pub const DEDICATED_COMPRESSOR_32KB: i32 = 197;
pub const DEDICATED_COMPRESSOR_64KB: i32 = 214;
pub const DEDICATED_COMPRESSOR_128KB: i32 = 231;
pub const DEDICATED_COMPRESSOR_256KB: i32 = 248;
pub const DEDICATED_COMPRESSOR: i32 = 248;

pub const LIBUS_LISTEN_DEFAULT: i32 = 0;
pub const LIBUS_LISTEN_EXCLUSIVE_PORT: i32 = 1;
pub const LIBUS_SOCKET_ALLOW_HALF_OPEN: i32 = 2;
pub const LIBUS_LISTEN_REUSE_PORT: i32 = 4;
pub const LIBUS_SOCKET_IPV6_ONLY: i32 = 8;
pub const LIBUS_LISTEN_REUSE_ADDR: i32 = 16;
pub const LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE: i32 = 32;

// TODO: refactor to error union
pub const create_bun_socket_error_t = enum(c_int) {
    none = 0,
    load_ca_file,
    invalid_ca_file,
    invalid_ca,

    pub fn toJS(this: create_bun_socket_error_t, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        return switch (this) {
            .none => brk: {
                bun.debugAssert(false);
                break :brk .null;
            },
            .load_ca_file => globalObject.ERR(.BORINGSSL, "Failed to load CA file", .{}).toJS(),
            .invalid_ca_file => globalObject.ERR(.BORINGSSL, "Invalid CA file", .{}).toJS(),
            .invalid_ca => globalObject.ERR(.BORINGSSL, "Invalid CA", .{}).toJS(),
        };
    }
};

pub const us_bun_verify_error_t = extern struct {
    error_no: i32 = 0,
    code: [*c]const u8 = null,
    reason: [*c]const u8 = null,

    pub fn toJS(this: *const us_bun_verify_error_t, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        const code = if (this.code == null) "" else this.code[0..bun.len(this.code)];
        const reason = if (this.reason == null) "" else this.reason[0..bun.len(this.reason)];

        const fallback = JSC.SystemError{
            .code = bun.String.createUTF8(code),
            .message = bun.String.createUTF8(reason),
        };

        return fallback.toErrorInstance(globalObject);
    }
};

pub const SocketAddress = struct {
    ip: []const u8,
    port: i32,
    is_ipv6: bool,
};

pub const Opcode = enum(i32) {
    continuation = 0,
    text = 1,
    binary = 2,
    close = 8,
    ping = 9,
    pong = 10,
    _,

    const CONTINUATION: i32 = 0;
    const TEXT: i32 = 1;
    const BINARY: i32 = 2;
    const CLOSE: i32 = 8;
    const PING: i32 = 9;
    const PONG: i32 = 10;
};

pub const SendStatus = enum(c_uint) {
    backpressure = 0,
    success = 1,
    dropped = 2,
};

extern fn bun_clear_loop_at_thread_exit() void;
pub fn onThreadExit() void {
    bun_clear_loop_at_thread_exit();
}

export fn BUN__warn__extra_ca_load_failed(filename: [*c]const u8, error_msg: [*c]const u8) void {
    bun.Output.warn("ignoring extra certs from {s}, load failed: {s}", .{ filename, error_msg });
}

pub const LIBUS_SOCKET_DESCRIPTOR = switch (bun.Environment.isWindows) {
    true => *anyopaque,
    false => i32,
};

const bun = @import("bun");
const Environment = bun.Environment;
const JSC = bun.JSC;
