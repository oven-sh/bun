const HeaderBuilder = @This();
const StringBuilder = bun.StringBuilder;
const Headers = bun.http.Headers;
const string = bun.string;
const HTTPClient = @import("../http.zig");
const Api = @import("../api/schema.zig").Api;
const std = @import("std");
const bun = @import("bun");

content: StringBuilder = .{},
header_count: u64 = 0,
entries: Headers.Entry.List = .empty,

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
        .offset = @as(u32, @truncate(this.content.len)),
        .length = @as(u32, @truncate(name.len)),
    };

    _ = this.content.append(name);

    const value_ptr = Api.StringPointer{
        .offset = @as(u32, @truncate(this.content.len)),
        .length = @as(u32, @truncate(value.len)),
    };
    _ = this.content.append(value);
    this.entries.appendAssumeCapacity(.{ .name = name_ptr, .value = value_ptr });
}

pub fn appendFmt(this: *HeaderBuilder, name: string, comptime fmt: string, args: anytype) void {
    const name_ptr = Api.StringPointer{
        .offset = @as(u32, @truncate(this.content.len)),
        .length = @as(u32, @truncate(name.len)),
    };

    _ = this.content.append(name);

    const value = this.content.fmt(fmt, args);

    const value_ptr = Api.StringPointer{
        .offset = @as(u32, @truncate(this.content.len - value.len)),
        .length = @as(u32, @truncate(value.len)),
    };

    this.entries.appendAssumeCapacity(.{ .name = name_ptr, .value = value_ptr });
}

pub fn apply(this: *HeaderBuilder, client: *HTTPClient) void {
    client.header_entries = this.entries;
    client.header_buf = this.content.ptr.?[0..this.content.len];
}
