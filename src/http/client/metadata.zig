const bun = @import("root").bun;
const picohttp = bun.picohttp;
const std = @import("std");
pub const HTTPResponseMetadata = struct {
    url: []const u8 = "",
    owned_buf: []u8 = "",
    response: picohttp.Response = .{},
    pub fn deinit(this: *HTTPResponseMetadata, allocator: std.mem.Allocator) void {
        if (this.owned_buf.len > 0) allocator.free(this.owned_buf);
        if (this.response.headers.list.len > 0) allocator.free(this.response.headers.list);
        this.owned_buf = &.{};
        this.url = "";
        this.response.headers = .{};
        this.response.status = "";
    }
};
