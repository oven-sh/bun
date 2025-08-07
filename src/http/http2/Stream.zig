const Stream = @This();

const std = @import("std");
const bun = @import("bun");
const Headers = bun.http.Headers;
const HTTPRequestBody = @import("../HTTPRequestBody.zig").HTTPRequestBody;

// Stream states (RFC 7540, Section 5.1)
pub const StreamState = enum {
    idle,
    reserved_local,
    reserved_remote,
    open,
    half_closed_local,
    half_closed_remote,
    closed,
};

// Header field structure for HTTP/2
pub const HeaderField = struct {
    name: []const u8,
    value: []const u8,
    never_index: bool = false,
    hpack_index: u16 = 255,
};

const DEFAULT_WINDOW_SIZE = 65535;

id: u32,
state: StreamState = .idle,
window_size: i32 = DEFAULT_WINDOW_SIZE,
headers_received: bool = false,
end_stream_received: bool = false,
end_headers_received: bool = false,
request_body: HTTPRequestBody = .{ .bytes = "" },
response_headers: std.ArrayList(HeaderField),
response_data: std.ArrayList(u8),
allocator: std.mem.Allocator,

pub fn init(allocator: std.mem.Allocator, stream_id: u32) Stream {
    return Stream{
        .id = stream_id,
        .allocator = allocator,
        .response_headers = std.ArrayList(HeaderField).init(allocator),
        .response_data = std.ArrayList(u8).init(allocator),
    };
}

pub fn deinit(self: *Stream) void {
    for (self.response_headers.items) |header| {
        self.allocator.free(header.name);
        self.allocator.free(header.value);
    }
    self.response_headers.deinit();
    self.response_data.deinit();
}

pub fn setState(self: *Stream, new_state: StreamState) void {
    self.state = new_state;
}

pub fn isValidTransition(self: *Stream, new_state: StreamState) bool {
    return switch (self.state) {
        .idle => new_state == .reserved_local or new_state == .reserved_remote or new_state == .open,
        .reserved_local => new_state == .half_closed_remote or new_state == .closed,
        .reserved_remote => new_state == .half_closed_local or new_state == .closed,
        .open => new_state == .half_closed_local or new_state == .half_closed_remote or new_state == .closed,
        .half_closed_local => new_state == .closed,
        .half_closed_remote => new_state == .closed,
        .closed => false,
    };
}

pub fn addHeader(self: *Stream, name: []const u8, value: []const u8) !void {
    const owned_name = try self.allocator.dupe(u8, name);
    const owned_value = try self.allocator.dupe(u8, value);

    const header = HeaderField{
        .name = owned_name,
        .value = owned_value,
    };

    try self.response_headers.append(header);
}

pub fn appendData(self: *Stream, data: []const u8) !void {
    try self.response_data.appendSlice(data);
}

pub fn updateWindowSize(self: *Stream, increment: i32) void {
    self.window_size += increment;
}

pub fn canSendData(self: *Stream, data_size: usize) bool {
    return self.window_size >= @as(i32, @intCast(data_size));
}

pub fn consumeWindowSize(self: *Stream, size: usize) void {
    self.window_size -= @intCast(size);
}
