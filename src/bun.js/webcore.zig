//! Web APIs implemented in Zig live here

comptime {
    if (bun.Environment.export_cpp_apis) {
        _ = &@import("webcore/prompt.zig");
    }
    _ = &@import("webcore/TextEncoder.zig");
}

pub const DOMExceptionCode = @import("bindings/JSErrorCode.zig").DOMExceptionCode;

// TODO: make this JSGlobalObject local for better security
pub const ByteListPool = bun.ObjectPool(bun.ByteList, null, true, 8);

pub const Crypto = @import("webcore/Crypto.zig");
pub const AbortSignal = @import("bindings/AbortSignal.zig").AbortSignal;
pub const WebWorker = @import("web_worker.zig");
pub const AutoFlusher = @import("webcore/AutoFlusher.zig");
pub const EncodingLabel = @import("webcore/EncodingLabel.zig").EncodingLabel;
pub const Fetch = @import("webcore/fetch.zig");
pub const Response = @import("webcore/Response.zig");
pub const TextDecoder = @import("webcore/TextDecoder.zig");
pub const TextEncoder = @import("webcore/TextEncoder.zig");
pub const TextEncoderStreamEncoder = @import("webcore/TextEncoderStreamEncoder.zig");
pub const encoding = @import("webcore/encoding.zig");
pub const ReadableStream = @import("webcore/ReadableStream.zig");
pub const Blob = @import("webcore/Blob.zig");
pub const S3Stat = @import("webcore/S3Stat.zig").S3Stat;
pub const S3Client = @import("webcore/S3Client.zig").S3Client;
pub const Request = @import("webcore/Request.zig");
pub const Body = @import("webcore/Body.zig");
pub const CookieMap = @import("webcore/CookieMap.zig").CookieMap;
pub const ObjectURLRegistry = @import("webcore/ObjectURLRegistry.zig");
pub const Sink = @import("webcore/Sink.zig");
pub const FileSink = @import("webcore/FileSink.zig");
pub const FetchHeaders = @import("bindings/FetchHeaders.zig").FetchHeaders;
pub const ByteBlobLoader = @import("webcore/ByteBlobLoader.zig");
pub const ByteStream = @import("webcore/ByteStream.zig");
pub const FileReader = @import("webcore/FileReader.zig");
pub const ScriptExecutionContext = @import("webcore/ScriptExecutionContext.zig");

pub const streams = @import("webcore/streams.zig");
pub const NetworkSink = streams.NetworkSink;
pub const HTTPResponseSink = streams.HTTPResponseSink;
pub const HTTPSResponseSink = streams.HTTPSResponseSink;
pub const HTTPServerWritable = streams.HTTPServerWritable;

const WebSocketHTTPClient = @import("../http/websocket_http_client.zig").WebSocketHTTPClient;
const WebSocketHTTPSClient = @import("../http/websocket_http_client.zig").WebSocketHTTPSClient;
const WebSocketClient = @import("../http/websocket_http_client.zig").WebSocketClient;
const WebSocketClientTLS = @import("../http/websocket_http_client.zig").WebSocketClientTLS;
comptime {
    WebSocketClient.exportAll();
    WebSocketClientTLS.exportAll();
    WebSocketHTTPClient.exportAll();
    WebSocketHTTPSClient.exportAll();
}

pub const PathOrFileDescriptor = union(enum) {
    path: JSC.ZigString.Slice,
    fd: bun.FileDescriptor,

    pub fn deinit(this: *const PathOrFileDescriptor) void {
        if (this.* == .path) this.path.deinit();
    }
};

pub const Pipe = struct {
    ctx: ?*anyopaque = null,
    onPipe: ?Function = null,

    pub const Function = *const fn (
        ctx: *anyopaque,
        stream: streams.Result,
        allocator: std.mem.Allocator,
    ) void;

    pub fn Wrap(comptime Type: type, comptime function: anytype) type {
        return struct {
            pub fn pipe(self: *anyopaque, stream: streams.Result, allocator: std.mem.Allocator) void {
                function(
                    @as(*Type, @ptrCast(@alignCast(self))),
                    stream,
                    allocator,
                );
            }

            pub fn init(self: *Type) Pipe {
                return Pipe{
                    .ctx = self,
                    .onPipe = pipe,
                };
            }
        };
    }
};

pub const DrainResult = union(enum) {
    owned: struct {
        list: std.ArrayList(u8),
        size_hint: usize,
    },
    estimated_size: usize,
    empty: void,
    aborted: void,
};

pub const Lifetime = enum {
    clone,
    transfer,
    share,
    /// When reading from a fifo like STDIN/STDERR
    temporary,
};

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
