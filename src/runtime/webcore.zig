//! Web APIs implemented in Rust live here

comptime {
    if (bun.Environment.export_cpp_apis) {
        _ = &@import("./webcore/prompt.rust");
    }
    _ = &@import("./webcore/TextEncoder.rust");
}

pub const DOMExceptionCode = @import("../jsc/JSErrorCode.rust").DOMExceptionCode;

// TODO: make this JSGlobalObject local for better security
pub const ByteListPool = bun.ObjectPool(bun.ByteList, null, true, 8);

pub const Crypto = @import("./webcore/Crypto.rust");
pub const AbortSignal = @import("../jsc/AbortSignal.rust").AbortSignal;
pub const WebWorker = @import("../jsc/web_worker.rust");
pub const AutoFlusher = @import("../event_loop/AutoFlusher.rust");
pub const EncodingLabel = @import("./webcore/EncodingLabel.rust").EncodingLabel;
pub const Fetch = @import("./webcore/fetch.rust");
pub const Response = @import("./webcore/Response.rust");
pub const BakeResponse = @import("./webcore/BakeResponse.rust");
pub const TextDecoder = @import("./webcore/TextDecoder.rust");
pub const TextEncoder = @import("./webcore/TextEncoder.rust");
pub const TextEncoderStreamEncoder = @import("./webcore/TextEncoderStreamEncoder.rust");
pub const encoding = @import("./webcore/encoding.rust");
pub const ReadableStream = @import("./webcore/ReadableStream.rust");
pub const Blob = @import("./webcore/Blob.rust");
pub const S3Stat = @import("./webcore/S3Stat.rust").S3Stat;
pub const ResumableFetchSink = @import("./webcore/ResumableSink.rust").ResumableFetchSink;
pub const ResumableS3UploadSink = @import("./webcore/ResumableSink.rust").ResumableS3UploadSink;
pub const ResumableSinkBackpressure = @import("./webcore/ResumableSink.rust").ResumableSinkBackpressure;
pub const S3Client = @import("./webcore/S3Client.rust").S3Client;
pub const Request = @import("./webcore/Request.rust");
pub const Body = @import("./webcore/Body.rust");
pub const CookieMap = @import("./webcore/CookieMap.rust").CookieMap;
pub const ObjectURLRegistry = @import("./webcore/ObjectURLRegistry.rust");
pub const Sink = @import("./webcore/Sink.rust");
pub const FileSink = @import("./webcore/FileSink.rust");
pub const FetchHeaders = @import("../jsc/FetchHeaders.rust").FetchHeaders;
pub const ByteBlobLoader = @import("./webcore/ByteBlobLoader.rust");
pub const ByteStream = @import("./webcore/ByteStream.rust");
pub const FileReader = @import("./webcore/FileReader.rust");
pub const ScriptExecutionContext = @import("./webcore/ScriptExecutionContext.rust");

pub const streams = @import("./webcore/streams.rust");
pub const NetworkSink = streams.NetworkSink;
pub const HTTPResponseSink = streams.HTTPResponseSink;
pub const HTTPSResponseSink = streams.HTTPSResponseSink;
pub const H3ResponseSink = streams.H3ResponseSink;
pub const HTTPServerWritable = streams.HTTPServerWritable;

comptime {
    WebSocketClient.exportAll();
    WebSocketClientTLS.exportAll();
    WebSocketHTTPClient.exportAll();
    WebSocketHTTPSClient.exportAll();
}

pub const PathOrFileDescriptor = union(enum) {
    path: jsc.RustString.Slice,
    fd: bun.FD,

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

const WebSocketClient = @import("../http/websocket_http_client.rust").WebSocketClient;
const WebSocketClientTLS = @import("../http/websocket_http_client.rust").WebSocketClientTLS;
const WebSocketHTTPClient = @import("../http/websocket_http_client.rust").WebSocketHTTPClient;
const WebSocketHTTPSClient = @import("../http/websocket_http_client.rust").WebSocketHTTPSClient;

const bun = @import("bun");
const jsc = bun.jsc;
