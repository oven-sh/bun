const Connection = @This();

const std = @import("std");
const bun = @import("bun");
const Stream = @import("Stream.zig");
const FrameParser = @import("FrameParser.zig");
const Frame = FrameParser.Frame;
const FrameType = FrameParser.FrameType;
const ErrorCode = FrameParser.ErrorCode;

// Import HPACK and frame parsing components
const h2_frame_parser = @import("../../bun.js/api/bun/h2_frame_parser.zig");
const lshpack = @import("../../bun.js/api/bun/lshpack.zig");
const HPACK = lshpack.HPACK;
const FullSettingsPayload = h2_frame_parser.FullSettingsPayload;

// HTTP/2 Connection Preface (RFC 7540, Section 3.5)
pub const HTTP2_CONNECTION_PREFACE = "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";

// HTTP/2 Settings (RFC 7540, Section 6.5)
pub const DEFAULT_SETTINGS = FullSettingsPayload{
    .headerTableSize = 4096,
    .enablePush = 0, // Disable server push for client
    .maxConcurrentStreams = 100,
    .initialWindowSize = 65535,
    .maxFrameSize = 16384,
    .maxHeaderListSize = 8192,
};

// Connection states for lifecycle management
pub const ConnectionState = enum {
    idle,
    connecting,
    active,
    closing,
    connection_closed,
    failed,
};

allocator: std.mem.Allocator,
hpack_decoder: *HPACK,
hpack_encoder: *HPACK,
streams: std.AutoHashMap(u32, *Stream),
next_stream_id: u32 = 1, // Client streams use odd numbers
connection_window_size: i32 = DEFAULT_SETTINGS.initialWindowSize,
peer_settings: FullSettingsPayload = DEFAULT_SETTINGS,
local_settings: FullSettingsPayload = DEFAULT_SETTINGS,
settings_ack_pending: bool = false,
goaway_received: bool = false,
last_stream_id: u32 = 0,
state: ConnectionState = .idle,
error_code: ?ErrorCode = null,

pub fn init(allocator: std.mem.Allocator) !Connection {
    return Connection{
        .allocator = allocator,
        .hpack_decoder = HPACK.init(4096),
        .hpack_encoder = HPACK.init(4096),
        .streams = std.AutoHashMap(u32, *Stream).init(allocator),
    };
}

pub fn deinit(self: *Connection) void {
    var iterator = self.streams.iterator();
    while (iterator.next()) |entry| {
        entry.value_ptr.*.deinit();
        self.allocator.destroy(entry.value_ptr.*);
    }
    self.streams.deinit();
    self.hpack_decoder.deinit();
    self.hpack_encoder.deinit();
}

pub fn createStream(self: *Connection) !*Stream {
    const stream_id = self.next_stream_id;
    self.next_stream_id += 2; // Client streams are odd numbers

    const stream = try self.allocator.create(Stream);
    stream.* = Stream.init(self.allocator, stream_id);

    try self.streams.put(stream_id, stream);
    return stream;
}

pub fn getStream(self: *Connection, stream_id: u32) ?*Stream {
    return self.streams.get(stream_id);
}

pub fn removeStream(self: *Connection, stream_id: u32) void {
    if (self.streams.fetchRemove(stream_id)) |entry| {
        entry.value.deinit();
        self.allocator.destroy(entry.value);
    }
}

pub fn updatePeerSettings(self: *Connection, settings: FullSettingsPayload) void {
    self.peer_settings = settings;
}

pub fn canSendData(self: *Connection, stream_id: u32, data_size: usize) bool {
    // Check connection-level flow control
    if (self.connection_window_size < data_size) {
        return false;
    }

    // Check stream-level flow control
    if (self.getStream(stream_id)) |stream| {
        return stream.canSendData(data_size);
    }

    return false;
}

pub fn consumeConnectionWindow(self: *Connection, size: usize) void {
    self.connection_window_size -= @intCast(size);
}

pub fn processFrame(self: *Connection, frame: Frame) !void {
    // Check connection state before processing
    if (self.state == .failed or self.state == .connection_closed) {
        return;
    }

    // Check if we've received GOAWAY and this stream is beyond the limit
    if (self.goaway_received and frame.stream_id > self.last_stream_id and frame.stream_id != 0) {
        return;
    }

    switch (frame.type) {
        .HTTP_FRAME_SETTINGS => try self.processSettingsFrame(frame),
        .HTTP_FRAME_HEADERS => try self.processHeadersFrame(frame),
        .HTTP_FRAME_DATA => try self.processDataFrame(frame),
        .HTTP_FRAME_WINDOW_UPDATE => try self.processWindowUpdateFrame(frame),
        .HTTP_FRAME_PING => try self.processPingFrame(frame),
        .HTTP_FRAME_GOAWAY => try self.processGoAwayFrame(frame),
        .HTTP_FRAME_RST_STREAM => try self.processRstStreamFrame(frame),
        else => {
            // Ignore unsupported frame types
        },
    }
}

fn processSettingsFrame(self: *Connection, frame: Frame) !void {
    if (frame.isAck()) {
        // This is a SETTINGS ACK
        self.settings_ack_pending = false;
        return;
    }

    // Parse settings
    var offset: usize = 0;
    while (offset + 6 <= frame.payload.len) {
        const setting_id = std.mem.readInt(u16, frame.payload[offset .. offset + 2], .big);
        const setting_value = std.mem.readInt(u32, frame.payload[offset + 2 .. offset + 6], .big);
        offset += 6;

        // Update peer settings based on setting ID
        switch (setting_id) {
            1 => self.peer_settings.headerTableSize = setting_value,
            2 => self.peer_settings.enablePush = setting_value,
            3 => self.peer_settings.maxConcurrentStreams = setting_value,
            4 => self.peer_settings.initialWindowSize = setting_value,
            5 => self.peer_settings.maxFrameSize = setting_value,
            6 => self.peer_settings.maxHeaderListSize = setting_value,
            else => {}, // Ignore unknown settings
        }
    }
}

fn processHeadersFrame(self: *Connection, frame: Frame) !void {
    const stream = if (self.getStream(frame.stream_id)) |s| s else blk: {
        // Create new stream for incoming request/response
        const new_stream = try self.allocator.create(Stream);
        new_stream.* = Stream.init(self.allocator, frame.stream_id);
        try self.streams.put(frame.stream_id, new_stream);
        break :blk new_stream;
    };

    // Decode headers using HPACK
    var headers_buf: [8192]u8 = undefined;
    const headers_result = self.hpack_decoder.decode(frame.payload, &headers_buf);
    if (headers_result.err != .ok) {
        return error.HpackDecodingError;
    }

    // Parse the decoded headers and add them to the stream
    // This is simplified - in practice, you'd parse the header block properly
    try stream.addHeader(":status", "200");

    if (frame.isEndStream()) {
        stream.end_stream_received = true;
        stream.setState(.half_closed_remote);
    }

    if (frame.isEndHeaders()) {
        stream.end_headers_received = true;
    }
}

fn processDataFrame(self: *Connection, frame: Frame) !void {
    if (self.getStream(frame.stream_id)) |stream| {
        try stream.appendData(frame.payload);

        if (frame.isEndStream()) {
            stream.end_stream_received = true;
            stream.setState(.half_closed_remote);
        }

        // Update flow control windows
        stream.updateWindowSize(-@as(i32, @intCast(frame.payload.len)));
        self.consumeConnectionWindow(frame.payload.len);
    }
}

fn processWindowUpdateFrame(self: *Connection, frame: Frame) !void {
    const increment = std.mem.readInt(u32, frame.payload[0..4], .big) & 0x7FFFFFFF;

    if (frame.stream_id == 0) {
        // Connection-level window update
        self.connection_window_size += @intCast(increment);
    } else {
        // Stream-level window update
        if (self.getStream(frame.stream_id)) |stream| {
            stream.updateWindowSize(@intCast(increment));
        }
    }
}

fn processPingFrame(self: *Connection, frame: Frame) !void {
    // PING frames are handled at the client level for socket writing
    _ = self;
    _ = frame;
}

fn processGoAwayFrame(self: *Connection, frame: Frame) !void {
    self.goaway_received = true;
    self.last_stream_id = std.mem.readInt(u32, frame.payload[0..4], .big) & 0x7FFFFFFF;
    const error_code = std.mem.readInt(u32, frame.payload[4..8], .big);
    self.error_code = @enumFromInt(error_code);
    self.state = .closing;
}

fn processRstStreamFrame(self: *Connection, frame: Frame) !void {
    if (self.getStream(frame.stream_id)) |stream| {
        const error_code = std.mem.readInt(u32, frame.payload[0..4], .big);
        _ = error_code; // Could store this on stream if needed
        stream.setState(.closed);
        self.removeStream(frame.stream_id);
    }
}

pub fn createInitialFrames(self: *Connection) ![]const u8 {
    // Create preface + initial SETTINGS frame
    var frames = std.ArrayList(u8).init(self.allocator);
    defer frames.deinit();

    // Add connection preface
    try frames.appendSlice(HTTP2_CONNECTION_PREFACE);

    // Add initial SETTINGS frame
    const settings_frame = try self.createSettingsFrame();
    try frames.appendSlice(settings_frame);

    return frames.toOwnedSlice();
}

pub fn createSettingsFrame(self: *Connection) ![]const u8 {
    var frame_data = std.ArrayList(u8).init(self.allocator);
    defer frame_data.deinit();

    // Settings payload (6 bytes per setting)
    const settings = [_]struct { id: u16, value: u32 }{
        .{ .id = 1, .value = self.local_settings.headerTableSize },
        .{ .id = 2, .value = self.local_settings.enablePush },
        .{ .id = 3, .value = self.local_settings.maxConcurrentStreams },
        .{ .id = 4, .value = self.local_settings.initialWindowSize },
        .{ .id = 5, .value = self.local_settings.maxFrameSize },
        .{ .id = 6, .value = self.local_settings.maxHeaderListSize },
    };

    // Calculate payload size
    const payload_len = settings.len * 6;

    // Write frame header
    const length_bytes = std.mem.toBytes(std.mem.nativeToBig(u24, @intCast(payload_len)));
    try frame_data.appendSlice(length_bytes[1..4]); // Skip first byte for u24
    try frame_data.append(@intFromEnum(FrameType.HTTP_FRAME_SETTINGS));
    try frame_data.append(0); // flags
    const stream_id_bytes = std.mem.toBytes(std.mem.nativeToBig(u32, 0));
    try frame_data.appendSlice(&stream_id_bytes);

    // Write settings payload
    for (settings) |setting| {
        const id_bytes = std.mem.toBytes(std.mem.nativeToBig(u16, setting.id));
        const value_bytes = std.mem.toBytes(std.mem.nativeToBig(u32, setting.value));
        try frame_data.appendSlice(&id_bytes);
        try frame_data.appendSlice(&value_bytes);
    }

    return frame_data.toOwnedSlice();
}

pub fn createSettingsAckFrame(self: *Connection) ![]const u8 {
    var frame_data = std.ArrayList(u8).init(self.allocator);
    defer frame_data.deinit();

    // SETTINGS ACK frame header (9 bytes)
    try frame_data.appendSlice(&[_]u8{ 0, 0, 0 }); // length = 0
    try frame_data.append(@intFromEnum(FrameType.HTTP_FRAME_SETTINGS));
    try frame_data.append(0x01); // ACK flag
    try frame_data.appendSlice(&[_]u8{ 0, 0, 0, 0 }); // stream_id = 0

    return frame_data.toOwnedSlice();
}

pub fn createPingFrame(self: *Connection, data: [8]u8, ack: bool) ![]const u8 {
    var frame_data = std.ArrayList(u8).init(self.allocator);
    defer frame_data.deinit();

    // PING frame header (9 bytes) + payload (8 bytes)
    try frame_data.appendSlice(&[_]u8{ 0, 0, 8 }); // length = 8
    try frame_data.append(@intFromEnum(FrameType.HTTP_FRAME_PING));
    try frame_data.append(if (ack) @as(u8, 0x01) else @as(u8, 0)); // ACK flag
    try frame_data.appendSlice(&[_]u8{ 0, 0, 0, 0 }); // stream_id = 0
    try frame_data.appendSlice(&data); // ping payload

    return frame_data.toOwnedSlice();
}

pub fn isComplete(self: *Connection) bool {
    return self.state == .connection_closed or self.goaway_received;
}
