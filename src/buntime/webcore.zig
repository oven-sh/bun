//! Web APIs implemented in Zig live here

comptime {
    if (bun.Environment.export_cpp_apis) {
        _ = &@import("./webcore/prompt.zig");
    }
    _ = &@import("./web/encoding/TextEncoder.zig");
}

pub const DOMExceptionCode = @import("./api/error/JSErrorCode.zig").DOMExceptionCode;

// TODO: make this JSGlobalObject local for better security
pub const ByteListPool = bun.ObjectPool(bun.ByteList, null, true, 8);

pub const Crypto = @import("./webcore/webcrypto/Crypto.zig");
pub const AbortSignal = @import("./web/events/AbortSignal.zig").AbortSignal;
pub const WebWorker = @import("./web_worker.zig");
pub const AutoFlusher = @import("./webcore/AutoFlusher.zig");
pub const EncodingLabel = @import("./web/encoding/EncodingLabel.zig").EncodingLabel;
pub const Fetch = @import("./web/fetch/fetch.zig");
pub const Response = @import("./web/http/Response.zig");
pub const BakeResponse = @import("./web/http/BakeResponse.zig");
pub const TextDecoder = @import("./web/encoding/TextDecoder.zig");
pub const TextEncoder = @import("./web/encoding/TextEncoder.zig");
pub const TextEncoderStreamEncoder = @import("./web/encoding/TextEncoderStreamEncoder.zig");
pub const encoding = @import("./web/encoding/encoding.zig");
pub const ReadableStream = @import("./web/streams/ReadableStream.zig");
pub const Blob = @import("./web/blob/Blob.zig");
pub const S3Stat = @import("./api/s3/S3Stat.zig").S3Stat;
pub const ResumableFetchSink = @import("./web/streams/ResumableSink.zig").ResumableFetchSink;
pub const ResumableS3UploadSink = @import("./web/streams/ResumableSink.zig").ResumableS3UploadSink;
pub const ResumableSinkBackpressure = @import("./web/streams/ResumableSink.zig").ResumableSinkBackpressure;
pub const S3Client = @import("./api/s3/S3Client.zig").S3Client;
pub const Request = @import("./web/http/Request.zig");
pub const Body = @import("./web/http/Body.zig");
pub const CookieMap = @import("./api/cookie/CookieMap.zig").CookieMap;
pub const ObjectURLRegistry = @import("./web/url/ObjectURLRegistry.zig");
pub const Sink = @import("./web/streams/Sink.zig");
pub const FileSink = @import("./web/streams/FileSink.zig");
pub const FetchHeaders = @import("./web/fetch/FetchHeaders.zig").FetchHeaders;
pub const ByteBlobLoader = @import("./web/blob/ByteBlobLoader.zig");
pub const ByteStream = @import("./web/streams/ByteStream.zig");
pub const FileReader = @import("./web/blob/FileReader.zig");
pub const ScriptExecutionContext = @import("./webcore/ScriptExecutionContext.zig");

pub const streams = @import("./web/streams/streams.zig");
pub const NetworkSink = streams.NetworkSink;
pub const HTTPResponseSink = streams.HTTPResponseSink;
pub const HTTPSResponseSink = streams.HTTPSResponseSink;
pub const HTTPServerWritable = streams.HTTPServerWritable;

comptime {
    WebSocketClient.exportAll();
    WebSocketClientTLS.exportAll();
    WebSocketHTTPClient.exportAll();
    WebSocketHTTPSClient.exportAll();
}

pub const PathOrFileDescriptor = union(enum) {
    path: jsc.ZigString.Slice,
    fd: bun.FileDescriptor,

    pub fn deinit(this: *const PathOrFileDescriptor) void {
        if (this.* == .path) this.path.deinit();
    }
};

pub const Pipe = struct {
    ctx: ?*anyopaque = null,
    onPipe: ?Function = null,

    pub inline fn isEmpty(this: *const Pipe) bool {
        return this.ctx == null and this.onPipe == null;
    }

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
        list: std.array_list.Managed(u8),
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

const WebSocketClient = @import("../http/websocket_http_client.zig").WebSocketClient;
const WebSocketClientTLS = @import("../http/websocket_http_client.zig").WebSocketClientTLS;
const WebSocketHTTPClient = @import("../http/websocket_http_client.zig").WebSocketHTTPClient;
const WebSocketHTTPSClient = @import("../http/websocket_http_client.zig").WebSocketHTTPSClient;

const bun = @import("bun");
const jsc = bun.jsc;
