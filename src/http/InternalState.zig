const InternalState = @This();

// TODO: reduce the size of this struct
// Many of these fields can be moved to a packed struct and use less space

response_message_buffer: MutableString = undefined,
/// pending response is the temporary storage for the response headers, url and status code
/// this uses shared_response_headers_buf to store the headers
/// this will be turned null once the metadata is cloned
pending_response: ?picohttp.Response = null,

/// This is the cloned metadata containing the response headers, url and status code after the .headers phase are received
/// will be turned null once returned to the user (the ownership is transferred to the user)
/// this can happen after await fetch(...) and the body can continue streaming when this is already null
/// the user will receive only chunks of the body stored in body_out_str
cloned_metadata: ?HTTPResponseMetadata = null,
flags: InternalStateFlags = InternalStateFlags{},

transfer_encoding: Encoding = Encoding.identity,
encoding: Encoding = Encoding.identity,
content_encoding_i: u8 = std.math.maxInt(u8),
chunked_decoder: picohttp.phr_chunked_decoder = .{},
decompressor: Decompressor = .{ .none = {} },
stage: Stage = Stage.pending,
/// This is owned by the user and should not be freed here
body_out_str: ?*MutableString = null,
compressed_body: MutableString = undefined,
content_length: ?usize = null,
total_body_received: usize = 0,
request_body: []const u8 = "",
original_request_body: HTTPRequestBody = .{ .bytes = "" },
request_sent_len: usize = 0,
fail: ?anyerror = null,
request_stage: HTTPStage = .pending,
response_stage: HTTPStage = .pending,
certificate_info: ?CertificateInfo = null,

pub const InternalStateFlags = packed struct(u8) {
    allow_keepalive: bool = true,
    received_last_chunk: bool = false,
    did_set_content_encoding: bool = false,
    is_redirect_pending: bool = false,
    is_libdeflate_fast_path_disabled: bool = false,
    resend_request_body_on_redirect: bool = false,
    _padding: u2 = 0,
};

pub fn init(body: HTTPRequestBody, body_out_str: *MutableString) InternalState {
    return .{
        .original_request_body = body,
        .request_body = if (body == .bytes) body.bytes else "",
        .compressed_body = MutableString{ .allocator = bun.http.default_allocator, .list = .{} },
        .response_message_buffer = MutableString{ .allocator = bun.http.default_allocator, .list = .{} },
        .body_out_str = body_out_str,
        .stage = Stage.pending,
        .pending_response = null,
    };
}

pub fn isChunkedEncoding(this: *InternalState) bool {
    return this.transfer_encoding == Encoding.chunked;
}

pub fn reset(this: *InternalState, allocator: std.mem.Allocator) void {
    this.compressed_body.deinit();
    this.response_message_buffer.deinit();

    const body_msg = this.body_out_str;
    if (body_msg) |body| body.reset();
    this.decompressor.deinit();

    // just in case we check and free to avoid leaks
    if (this.cloned_metadata != null) {
        this.cloned_metadata.?.deinit(allocator);
        this.cloned_metadata = null;
    }

    // if exists we own this info
    if (this.certificate_info) |info| {
        this.certificate_info = null;
        info.deinit(bun.default_allocator);
    }

    this.original_request_body.deinit();
    this.* = .{
        .body_out_str = body_msg,
        .compressed_body = MutableString{ .allocator = bun.http.default_allocator, .list = .{} },
        .response_message_buffer = MutableString{ .allocator = bun.http.default_allocator, .list = .{} },
        .original_request_body = .{ .bytes = "" },
        .request_body = "",
        .certificate_info = null,
        .flags = .{},
        .total_body_received = 0,
    };
}

pub fn getBodyBuffer(this: *InternalState) *MutableString {
    if (this.encoding.isCompressed()) {
        return &this.compressed_body;
    }

    return this.body_out_str.?;
}

pub fn isDone(this: *InternalState) bool {
    if (this.isChunkedEncoding()) {
        return this.flags.received_last_chunk;
    }

    if (this.content_length) |content_length| {
        return this.total_body_received >= content_length;
    }

    // Content-Type: text/event-stream we should be done only when Close/End/Timeout connection
    return this.flags.received_last_chunk;
}

pub fn decompressBytes(this: *InternalState, buffer: []const u8, body_out_str: *MutableString, is_final_chunk: bool) !void {
    defer this.compressed_body.reset();
    var gzip_timer: std.time.Timer = undefined;

    if (bun.http.extremely_verbose)
        gzip_timer = std.time.Timer.start() catch @panic("Timer failure");

    var still_needs_to_decompress = true;

    if (FeatureFlags.isLibdeflateEnabled()) {
        // Fast-path: use libdeflate
        if (is_final_chunk and !this.flags.is_libdeflate_fast_path_disabled and this.encoding.canUseLibDeflate() and this.isDone()) libdeflate: {
            this.flags.is_libdeflate_fast_path_disabled = true;

            log("Decompressing {d} bytes with libdeflate\n", .{buffer.len});
            var deflater = bun.http.http_thread.deflater();

            // gzip stores the size of the uncompressed data in the last 4 bytes of the stream
            // But it's only valid if the stream is less than 4.7 GB, since it's 4 bytes.
            // If we know that the stream is going to be larger than our
            // pre-allocated buffer, then let's dynamically allocate the exact
            // size.
            if (this.encoding == Encoding.gzip and buffer.len > 16 and buffer.len < 1024 * 1024 * 1024) {
                const estimated_size: u32 = @bitCast(buffer[buffer.len - 4 ..][0..4].*);
                // Since this is arbtirary input from the internet, let's set an upper bound of 32 MB for the allocation size.
                if (estimated_size > deflater.shared_buffer.len and estimated_size < 32 * 1024 * 1024) {
                    try body_out_str.list.ensureTotalCapacityPrecise(body_out_str.allocator, estimated_size);
                    const result = deflater.decompressor.decompress(buffer, body_out_str.list.allocatedSlice(), .gzip);

                    if (result.status == .success) {
                        body_out_str.list.items.len = result.written;
                        still_needs_to_decompress = false;
                    }

                    break :libdeflate;
                }
            }

            const result = deflater.decompressor.decompress(buffer, &deflater.shared_buffer, switch (this.encoding) {
                .gzip => .gzip,
                .deflate => .deflate,
                else => unreachable,
            });

            if (result.status == .success) {
                try body_out_str.list.ensureTotalCapacityPrecise(body_out_str.allocator, result.written);
                body_out_str.list.appendSliceAssumeCapacity(deflater.shared_buffer[0..result.written]);
                still_needs_to_decompress = false;
            }
        }
    }

    // Slow path, or brotli: use the .decompressor
    if (still_needs_to_decompress) {
        log("Decompressing {d} bytes\n", .{buffer.len});
        if (body_out_str.list.capacity == 0) {
            const min = @min(@ceil(@as(f64, @floatFromInt(buffer.len)) * 1.5), @as(f64, 1024 * 1024 * 2));
            try body_out_str.growBy(@max(@as(usize, @intFromFloat(min)), 32));
        }

        try this.decompressor.updateBuffers(this.encoding, buffer, body_out_str);

        this.decompressor.readAll(this.isDone()) catch |err| {
            if (this.isDone() or error.ShortRead != err) {
                Output.prettyErrorln("<r><red>Decompression error: {s}<r>", .{bun.asByteSlice(@errorName(err))});
                Output.flush();
                return err;
            }
        };
    }

    if (bun.http.extremely_verbose)
        this.gzip_elapsed = gzip_timer.read();
}

pub fn decompress(this: *InternalState, buffer: MutableString, body_out_str: *MutableString, is_final_chunk: bool) !void {
    try this.decompressBytes(buffer.list.items, body_out_str, is_final_chunk);
}

pub fn processBodyBuffer(this: *InternalState, buffer: MutableString, is_final_chunk: bool) !bool {
    if (this.flags.is_redirect_pending) return false;

    var body_out_str = this.body_out_str.?;

    switch (this.encoding) {
        Encoding.brotli, Encoding.gzip, Encoding.deflate, Encoding.zstd => {
            try this.decompress(buffer, body_out_str, is_final_chunk);
        },
        else => {
            if (!body_out_str.owns(buffer.list.items)) {
                body_out_str.append(buffer.list.items) catch |err| {
                    Output.prettyErrorln("<r><red>Failed to append to body buffer: {s}<r>", .{bun.asByteSlice(@errorName(err))});
                    Output.flush();
                    return err;
                };
            }
        },
    }

    return this.body_out_str.?.list.items.len > 0;
}

const log = Output.scoped(.HTTPInternalState, .hidden);

const HTTPStage = enum {
    pending,

    /// The `onOpen` callback has been called for the first time.
    opened,

    headers,
    body,
    body_chunk,
    fail,
    done,
    proxy_handshake,
    proxy_headers,
    proxy_body,
};

const Stage = enum(u8) {
    pending,
    connect,
    done,
    fail,
};

const std = @import("std");

const bun = @import("bun");
const FeatureFlags = bun.FeatureFlags;
const MutableString = bun.MutableString;
const Output = bun.Output;
const picohttp = bun.picohttp;

const HTTPClient = bun.http;
const CertificateInfo = HTTPClient.CertificateInfo;
const Decompressor = HTTPClient.Decompressor;
const Encoding = HTTPClient.Encoding;
const HTTPRequestBody = HTTPClient.HTTPRequestBody;
const HTTPResponseMetadata = HTTPClient.HTTPResponseMetadata;
