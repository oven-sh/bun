const bun = @import("root").bun;
const std = @import("std");

const picohttp = bun.picohttp;
const MutableString = bun.MutableString;
const HTTPResponseMetadata = @import("./result.zig").HTTPResponseMetadata;
const CertificateInfo = @import("./certificate_info.zig").CertificateInfo;
const Zlib = @import("./zlib.zig");
const Brotli = bun.brotli;
const default_allocator = bun.default_allocator;
const assert = bun.assert;
const Output = bun.Output;
const FeatureFlags = bun.FeatureFlags;
const log = bun.Output.scoped(.fetch, false);
const HTTPRequestBody = @import("./request_body.zig").HTTPRequestBody;
pub const extremely_verbose = false;
const http_thread = @import("./thread.zig").getHttpThread();

pub const Encoding = enum {
    identity,
    gzip,
    deflate,
    brotli,
    chunked,

    pub fn canUseLibDeflate(this: Encoding) bool {
        return switch (this) {
            .gzip, .deflate => true,
            else => false,
        };
    }

    pub fn isCompressed(this: Encoding) bool {
        return switch (this) {
            .brotli, .gzip, .deflate => true,
            else => false,
        };
    }
};
const Stage = enum(u8) {
    pending,
    connect,
    done,
    fail,
};

pub const HTTPStage = enum {
    pending,
    headers,
    body,
    body_chunk,
    fail,
    done,
    proxy_handshake,
    proxy_headers,
    proxy_body,
};

const Decompressor = union(enum) {
    zlib: *Zlib.ZlibReaderArrayList,
    brotli: *Brotli.BrotliReaderArrayList,
    none: void,

    pub fn deinit(this: *Decompressor) void {
        switch (this.*) {
            inline .brotli, .zlib => |that| {
                that.deinit();
                this.* = .{ .none = {} };
            },
            .none => {},
        }
    }

    pub fn updateBuffers(this: *Decompressor, encoding: Encoding, buffer: []const u8, body_out_str: *MutableString) !void {
        if (!encoding.isCompressed()) {
            return;
        }

        if (this.* == .none) {
            switch (encoding) {
                .gzip, .deflate => {
                    this.* = .{
                        .zlib = try Zlib.ZlibReaderArrayList.initWithOptionsAndListAllocator(
                            buffer,
                            &body_out_str.list,
                            body_out_str.allocator,
                            default_allocator,
                            .{
                                // zlib.MAX_WBITS = 15
                                // to (de-)compress deflate format, use wbits = -zlib.MAX_WBITS
                                // to (de-)compress deflate format with headers we use wbits = 0 (we can detect the first byte using 120)
                                // to (de-)compress gzip format, use wbits = zlib.MAX_WBITS | 16
                                .windowBits = if (encoding == Encoding.gzip) Zlib.MAX_WBITS | 16 else (if (buffer.len > 1 and buffer[0] == 120) 0 else -Zlib.MAX_WBITS),
                            },
                        ),
                    };
                    return;
                },
                .brotli => {
                    this.* = .{
                        .brotli = try Brotli.BrotliReaderArrayList.newWithOptions(
                            buffer,
                            &body_out_str.list,
                            body_out_str.allocator,
                            .{},
                        ),
                    };
                    return;
                },
                else => @panic("Invalid encoding. This code should not be reachable"),
            }
        }

        switch (this.*) {
            .zlib => |reader| {
                assert(reader.zlib.avail_in == 0);
                reader.zlib.next_in = buffer.ptr;
                reader.zlib.avail_in = @as(u32, @truncate(buffer.len));

                const initial = body_out_str.list.items.len;
                body_out_str.list.expandToCapacity();
                if (body_out_str.list.capacity == initial) {
                    try body_out_str.list.ensureUnusedCapacity(body_out_str.allocator, 4096);
                    body_out_str.list.expandToCapacity();
                }
                reader.list = body_out_str.list;
                reader.zlib.next_out = @ptrCast(&body_out_str.list.items[initial]);
                reader.zlib.avail_out = @as(u32, @truncate(body_out_str.list.capacity - initial));
                // we reset the total out so we can track how much we decompressed this time
                reader.zlib.total_out = @truncate(initial);
            },
            .brotli => |reader| {
                reader.input = buffer;
                reader.total_in = 0;

                const initial = body_out_str.list.items.len;
                reader.list = body_out_str.list;
                reader.total_out = @truncate(initial);
            },
            else => @panic("Invalid encoding. This code should not be reachable"),
        }
    }

    pub fn readAll(this: *Decompressor, is_done: bool) !void {
        switch (this.*) {
            .zlib => |zlib| try zlib.readAll(),
            .brotli => |brotli| try brotli.readAll(is_done),
            .none => {},
        }
    }
};

// TODO: reduce the size of this struct
// Many of these fields can be moved to a packed struct and use less space
pub const InternalState = struct {
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

    pub const InternalStateFlags = packed struct {
        allow_keepalive: bool = true,
        received_last_chunk: bool = false,
        did_set_content_encoding: bool = false,
        is_redirect_pending: bool = false,
        is_libdeflate_fast_path_disabled: bool = false,
        resend_request_body_on_redirect: bool = false,
    };

    pub fn init(body: HTTPRequestBody, body_out_str: *MutableString) InternalState {
        return .{
            .original_request_body = body,
            .request_body = if (body == .bytes) body.bytes else "",
            .compressed_body = MutableString{ .allocator = default_allocator, .list = .{} },
            .response_message_buffer = MutableString{ .allocator = default_allocator, .list = .{} },
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
            info.deinit(default_allocator);
        }

        this.original_request_body.deinit();
        this.* = .{
            .body_out_str = body_msg,
            .compressed_body = MutableString{ .allocator = default_allocator, .list = .{} },
            .response_message_buffer = MutableString{ .allocator = default_allocator, .list = .{} },
            .original_request_body = .{ .bytes = "" },
            .request_body = "",
            .certificate_info = null,
            .flags = .{},
        };
    }

    pub fn getBodyBuffer(this: *InternalState) *MutableString {
        if (this.encoding.isCompressed()) {
            return &this.compressed_body;
        }

        return this.body_out_str.?;
    }

    fn isDone(this: *InternalState) bool {
        if (this.isChunkedEncoding()) {
            return this.flags.received_last_chunk;
        }

        if (this.content_length) |content_length| {
            return this.total_body_received >= content_length;
        }

        // Content-Type: text/event-stream we should be done only when Close/End/Timeout connection
        return this.flags.received_last_chunk;
    }

    fn decompressBytes(this: *InternalState, buffer: []const u8, body_out_str: *MutableString, is_final_chunk: bool) !void {
        defer this.compressed_body.reset();
        var gzip_timer: std.time.Timer = undefined;

        if (extremely_verbose)
            gzip_timer = std.time.Timer.start() catch @panic("Timer failure");

        var still_needs_to_decompress = true;

        if (FeatureFlags.isLibdeflateEnabled()) {
            // Fast-path: use libdeflate
            if (is_final_chunk and !this.flags.is_libdeflate_fast_path_disabled and this.encoding.canUseLibDeflate() and this.isDone()) libdeflate: {
                this.flags.is_libdeflate_fast_path_disabled = true;

                log("Decompressing {d} bytes with libdeflate\n", .{buffer.len});
                var deflater = http_thread.deflater();

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

        if (extremely_verbose)
            this.gzip_elapsed = gzip_timer.read();
    }

    fn decompress(this: *InternalState, buffer: MutableString, body_out_str: *MutableString, is_final_chunk: bool) !void {
        try this.decompressBytes(buffer.list.items, body_out_str, is_final_chunk);
    }

    pub fn processBodyBuffer(this: *InternalState, buffer: MutableString, is_final_chunk: bool) !bool {
        if (this.flags.is_redirect_pending) return false;

        var body_out_str = this.body_out_str.?;

        switch (this.encoding) {
            Encoding.brotli, Encoding.gzip, Encoding.deflate => {
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
};
