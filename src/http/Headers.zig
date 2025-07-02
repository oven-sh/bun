const Headers = @This();
pub const Entry = struct {
    name: Api.StringPointer,
    value: Api.StringPointer,

    pub const List = bun.MultiArrayList(Entry);
};

entries: Entry.List = .{},
buf: std.ArrayListUnmanaged(u8) = .{},
allocator: std.mem.Allocator,

pub fn memoryCost(this: *const Headers) usize {
    return this.buf.items.len + this.entries.memoryCost();
}

pub fn clone(this: *Headers) !Headers {
    return Headers{
        .entries = try this.entries.clone(this.allocator),
        .buf = try this.buf.clone(this.allocator),
        .allocator = this.allocator,
    };
}

pub fn get(this: *const Headers, name: []const u8) ?[]const u8 {
    const entries = this.entries.slice();
    const names = entries.items(.name);
    const values = entries.items(.value);
    for (names, 0..) |name_ptr, i| {
        if (bun.strings.eqlCaseInsensitiveASCII(this.asStr(name_ptr), name, true)) {
            return this.asStr(values[i]);
        }
    }

    return null;
}

pub fn append(this: *Headers, name: []const u8, value: []const u8) !void {
    var offset: u32 = @truncate(this.buf.items.len);
    try this.buf.ensureUnusedCapacity(this.allocator, name.len + value.len);
    const name_ptr = Api.StringPointer{
        .offset = offset,
        .length = @truncate(name.len),
    };
    this.buf.appendSliceAssumeCapacity(name);
    offset = @truncate(this.buf.items.len);
    this.buf.appendSliceAssumeCapacity(value);

    const value_ptr = Api.StringPointer{
        .offset = offset,
        .length = @truncate(value.len),
    };
    try this.entries.append(this.allocator, .{
        .name = name_ptr,
        .value = value_ptr,
    });
}

pub fn deinit(this: *Headers) void {
    this.entries.deinit(this.allocator);
    this.buf.clearAndFree(this.allocator);
}
pub fn getContentType(this: *const Headers) ?[]const u8 {
    if (this.entries.len == 0 or this.buf.items.len == 0) {
        return null;
    }
    const header_entries = this.entries.slice();
    const header_names = header_entries.items(.name);
    const header_values = header_entries.items(.value);

    for (header_names, 0..header_names.len) |name, i| {
        if (bun.strings.eqlCaseInsensitiveASCII(this.asStr(name), "content-type", true)) {
            return this.asStr(header_values[i]);
        }
    }
    return null;
}
pub fn asStr(this: *const Headers, ptr: Api.StringPointer) []const u8 {
    return if (ptr.offset + ptr.length <= this.buf.items.len)
        this.buf.items[ptr.offset..][0..ptr.length]
    else
        "";
}

pub const Options = struct {
    body: ?*const Blob.Any = null,
};

pub fn fromPicoHttpHeaders(headers: []const picohttp.Header, allocator: std.mem.Allocator) !Headers {
    const header_count = headers.len;
    var result = Headers{
        .entries = .{},
        .buf = .{},
        .allocator = allocator,
    };

    var buf_len: usize = 0;
    for (headers) |header| {
        buf_len += header.name.len + header.value.len;
    }
    result.entries.ensureTotalCapacity(allocator, header_count) catch bun.outOfMemory();
    result.entries.len = headers.len;
    result.buf.ensureTotalCapacityPrecise(allocator, buf_len) catch bun.outOfMemory();
    result.buf.items.len = buf_len;
    var offset: u32 = 0;
    for (headers, 0..headers.len) |header, i| {
        const name_offset = offset;
        bun.copy(u8, result.buf.items[offset..][0..header.name.len], header.name);
        offset += @truncate(header.name.len);
        const value_offset = offset;
        bun.copy(u8, result.buf.items[offset..][0..header.value.len], header.value);
        offset += @truncate(header.value.len);

        result.entries.set(i, .{
            .name = .{
                .offset = name_offset,
                .length = @truncate(header.name.len),
            },
            .value = .{
                .offset = value_offset,
                .length = @truncate(header.value.len),
            },
        });
    }
    return result;
}

pub fn from(fetch_headers_ref: ?*FetchHeaders, allocator: std.mem.Allocator, options: Options) !Headers {
    var header_count: u32 = 0;
    var buf_len: u32 = 0;
    if (fetch_headers_ref) |headers_ref|
        headers_ref.count(&header_count, &buf_len);
    var headers = Headers{
        .entries = .{},
        .buf = .{},
        .allocator = allocator,
    };
    const buf_len_before_content_type = buf_len;
    const needs_content_type = brk: {
        if (options.body) |body| {
            if (body.hasContentTypeFromUser() and (fetch_headers_ref == null or !fetch_headers_ref.?.fastHas(.ContentType))) {
                header_count += 1;
                buf_len += @as(u32, @truncate(body.contentType().len + "Content-Type".len));
                break :brk true;
            }
        }
        break :brk false;
    };
    headers.entries.ensureTotalCapacity(allocator, header_count) catch bun.outOfMemory();
    headers.entries.len = header_count;
    headers.buf.ensureTotalCapacityPrecise(allocator, buf_len) catch bun.outOfMemory();
    headers.buf.items.len = buf_len;
    var sliced = headers.entries.slice();
    var names = sliced.items(.name);
    var values = sliced.items(.value);
    if (fetch_headers_ref) |headers_ref|
        headers_ref.copyTo(names.ptr, values.ptr, headers.buf.items.ptr);

    // TODO: maybe we should send Content-Type header first instead of last?
    if (needs_content_type) {
        bun.copy(u8, headers.buf.items[buf_len_before_content_type..], "Content-Type");
        names[header_count - 1] = .{
            .offset = buf_len_before_content_type,
            .length = "Content-Type".len,
        };

        bun.copy(u8, headers.buf.items[buf_len_before_content_type + "Content-Type".len ..], options.body.?.contentType());
        values[header_count - 1] = .{
            .offset = buf_len_before_content_type + @as(u32, "Content-Type".len),
            .length = @as(u32, @truncate(options.body.?.contentType().len)),
        };
    }

    return headers;
}

const Api = @import("../api/schema.zig").Api;
const std = @import("std");
const bun = @import("bun");
const picohttp = bun.picohttp;
const Blob = bun.webcore.Blob;
const FetchHeaders = bun.webcore.FetchHeaders;
