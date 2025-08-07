const FrameParser = @This();

const std = @import("std");
const bun = @import("bun");
const h2_frame_parser = @import("../../bun.js/api/bun/h2_frame_parser.zig");

// Re-export types from h2_frame_parser
pub const FrameType = h2_frame_parser.FrameType;
pub const FrameHeader = h2_frame_parser.FrameHeader;
pub const ErrorCode = h2_frame_parser.ErrorCode;

// Frame structure for parsed frames
pub const Frame = struct {
    type: FrameType,
    flags: u8,
    stream_id: u32,
    payload: []const u8,

    // Helper methods for specific frame types
    pub fn isEndStream(self: Frame) bool {
        return switch (self.type) {
            .HTTP_FRAME_HEADERS => (self.flags & 0x01) != 0,
            .HTTP_FRAME_DATA => (self.flags & 0x01) != 0,
            else => false,
        };
    }

    pub fn isEndHeaders(self: Frame) bool {
        return switch (self.type) {
            .HTTP_FRAME_HEADERS => (self.flags & 0x04) != 0,
            else => false,
        };
    }

    pub fn isPadded(self: Frame) bool {
        return switch (self.type) {
            .HTTP_FRAME_HEADERS, .HTTP_FRAME_DATA => (self.flags & 0x08) != 0,
            else => false,
        };
    }

    pub fn isAck(self: Frame) bool {
        return switch (self.type) {
            .HTTP_FRAME_SETTINGS, .HTTP_FRAME_PING => (self.flags & 0x01) != 0,
            else => false,
        };
    }
};

allocator: std.mem.Allocator,
buffer: bun.OffsetByteList,

pub fn init(allocator: std.mem.Allocator) FrameParser {
    return .{
        .allocator = allocator,
        .buffer = bun.OffsetByteList.init(allocator),
    };
}

pub fn deinit(self: *FrameParser) void {
    self.buffer.deinit(self.allocator);
}

pub fn feed(self: *FrameParser, data: []const u8) !void {
    try self.buffer.write(self.allocator, data);
}

pub fn next(self: *FrameParser) !?Frame {
    const readable = self.buffer.slice();

    // Need at least 9 bytes for frame header
    if (readable.len < 9) {
        return null;
    }

    // Parse frame header
    const frame_len = std.mem.readInt(u24, readable[0..3], .big);
    const frame_type = readable[3];
    const flags = readable[4];
    const stream_id = std.mem.readInt(u32, readable[5..9], .big) & 0x7FFFFFFF; // Clear reserved bit

    // Check if we have the complete frame
    if (readable.len < 9 + frame_len) {
        return null;
    }

    // Validate frame type
    const ftype: FrameType = if (frame_type <= 10)
        @enumFromInt(frame_type)
    else {
        return error.InvalidFrameType;
    };

    // Validate stream ID for frame types that require specific restrictions
    switch (ftype) {
        .HTTP_FRAME_SETTINGS, .HTTP_FRAME_PING, .HTTP_FRAME_GOAWAY => {
            if (stream_id != 0) {
                return error.InvalidStreamId;
            }
        },
        .HTTP_FRAME_HEADERS, .HTTP_FRAME_DATA, .HTTP_FRAME_RST_STREAM => {
            if (stream_id == 0) {
                return error.InvalidStreamId;
            }
        },
        else => {},
    }

    // Validate payload size for specific frame types
    switch (ftype) {
        .HTTP_FRAME_SETTINGS => {
            if ((flags & 0x01) == 0 and frame_len % 6 != 0) { // Not an ACK and payload not multiple of 6
                return error.InvalidFrameSize;
            }
        },
        .HTTP_FRAME_WINDOW_UPDATE => {
            if (frame_len != 4) {
                return error.InvalidFrameSize;
            }
        },
        .HTTP_FRAME_PING => {
            if (frame_len != 8) {
                return error.InvalidFrameSize;
            }
        },
        .HTTP_FRAME_RST_STREAM => {
            if (frame_len != 4) {
                return error.InvalidFrameSize;
            }
        },
        .HTTP_FRAME_GOAWAY => {
            if (frame_len < 8) {
                return error.InvalidFrameSize;
            }
        },
        else => {},
    }

    const payload = readable[9 .. 9 + frame_len];

    // Create frame with payload pointing to buffer data
    const frame = Frame{
        .type = ftype,
        .flags = flags,
        .stream_id = stream_id,
        .payload = payload,
    };

    // Skip the consumed bytes
    self.buffer.skip(@intCast(9 + frame_len));

    return frame;
}

pub fn reset(self: *FrameParser) void {
    self.buffer.reset();
}

pub fn hasBufferedData(self: *FrameParser) bool {
    return self.buffer.slice().len > 0;
}
