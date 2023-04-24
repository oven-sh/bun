const HeaderBuilder = @This();
const StringBuilder = @import("../string_builder.zig");
const Headers = @import("./headers.zig");
const string = @import("root").bun.string;
const HTTPClient = @import("../http_client_async.zig");
const Api = @import("../api/schema.zig").Api;
const std = @import("std");

content: StringBuilder = StringBuilder{},
header_count: u64 = 0,
entries: Headers.Entries = Headers.Entries{},

pub fn count(this: *HeaderBuilder, name: string, value: string) void {
    this.header_count += 1;
    this.content.count(name);
    this.content.count(value);
}

pub fn allocate(this: *HeaderBuilder, allocator: std.mem.Allocator) !void {
    try this.content.allocate(allocator);
    try this.entries.ensureTotalCapacity(allocator, this.header_count);
}
pub fn append(this: *HeaderBuilder, name: string, value: string) void {
    const name_ptr = Api.StringPointer{
        .offset = @truncate(u32, this.content.len),
        .length = @truncate(u32, name.len),
    };

    _ = this.content.append(name);

    const value_ptr = Api.StringPointer{
        .offset = @truncate(u32, this.content.len),
        .length = @truncate(u32, value.len),
    };
    _ = this.content.append(value);
    this.entries.appendAssumeCapacity(Headers.Kv{ .name = name_ptr, .value = value_ptr });
}

pub fn appendFmt(this: *HeaderBuilder, name: string, comptime fmt: string, args: anytype) void {
    const name_ptr = Api.StringPointer{
        .offset = @truncate(u32, this.content.len),
        .length = @truncate(u32, name.len),
    };

    _ = this.content.append(name);

    const value = this.content.fmt(fmt, args);

    const value_ptr = Api.StringPointer{
        .offset = @truncate(u32, this.content.len - value.len),
        .length = @truncate(u32, value.len),
    };

    this.entries.appendAssumeCapacity(Headers.Kv{ .name = name_ptr, .value = value_ptr });
}

pub fn apply(this: *HeaderBuilder, client: *HTTPClient) void {
    client.header_entries = this.entries;
    client.header_buf = this.content.ptr.?[0..this.content.len];
}
