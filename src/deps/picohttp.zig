const std = @import("std");
const c = @import("picohttpparser.zig");
const ExactSizeMatcher = @import("root").bun.ExactSizeMatcher;
const Match = ExactSizeMatcher(2);
const Output = @import("root").bun.Output;
const Environment = @import("root").bun.Environment;
const StringBuilder = @import("root").bun.StringBuilder;

const fmt = std.fmt;

const assert = std.debug.assert;

pub const Header = struct {
    name: []const u8,
    value: []const u8,

    pub fn isMultiline(self: Header) bool {
        return @intFromPtr(self.name.ptr) == 0;
    }

    pub fn format(self: Header, comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
        if (Output.enable_ansi_colors) {
            if (self.isMultiline()) {
                try fmt.format(writer, comptime Output.prettyFmt("<r><cyan>{s}", true), .{self.value});
            } else {
                try fmt.format(writer, comptime Output.prettyFmt("<r><cyan>{s}<r><d>: <r>{s}", true), .{ self.name, self.value });
            }
        } else {
            if (self.isMultiline()) {
                try fmt.format(writer, comptime Output.prettyFmt("<r><cyan>{s}", false), .{self.value});
            } else {
                try fmt.format(writer, comptime Output.prettyFmt("<r><cyan>{s}<r><d>: <r>{s}", false), .{ self.name, self.value });
            }
        }
    }

    pub fn count(this: *const Header, builder: *StringBuilder) void {
        builder.count(this.name);
        builder.count(this.value);
    }

    pub fn clone(this: *const Header, builder: *StringBuilder) Header {
        return .{
            .name = builder.append(this.name),
            .value = builder.append(this.value),
        };
    }

    comptime {
        assert(@sizeOf(Header) == @sizeOf(c.phr_header));
        assert(@alignOf(Header) == @alignOf(c.phr_header));
    }
};

pub const Request = struct {
    method: []const u8,
    path: []const u8,
    minor_version: usize,
    headers: []const Header,
    bytes_read: u32 = 0,

    pub fn clone(this: *const Request, headers: []Header, builder: *StringBuilder) Request {
        for (this.headers, 0..) |header, i| {
            headers[i] = header.clone(builder);
        }

        return .{
            .method = builder.append(this.method),
            .path = builder.append(this.path),
            .minor_version = this.minor_version,
            .headers = headers,
            .bytes_read = this.bytes_read,
        };
    }

    pub fn format(self: Request, comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
        try fmt.format(writer, "{s} {s}\n", .{ self.method, self.path });
        for (self.headers) |header| {
            _ = try writer.write("\t");
            try fmt.format(writer, "{s}\n", .{header});
        }
    }

    pub fn parse(buf: []const u8, src: []Header) !Request {
        var method: []const u8 = undefined;
        var path: []const u8 = undefined;
        var minor_version: c_int = undefined;
        var num_headers: usize = src.len;

        const rc = c.phr_parse_request(
            buf.ptr,
            buf.len,
            @ptrCast([*c][*c]const u8, &method.ptr),
            &method.len,
            @ptrCast([*c][*c]const u8, &path.ptr),
            &path.len,
            &minor_version,
            @ptrCast([*c]c.phr_header, src.ptr),
            &num_headers,
            0,
        );

        // Leave a sentinel value, for JavaScriptCore support.
        if (rc > -1) @ptrFromInt([*]u8, @intFromPtr(path.ptr))[path.len] = 0;

        return switch (rc) {
            -1 => error.BadRequest,
            -2 => error.ShortRead,
            else => Request{
                .method = method,
                .path = path,
                .minor_version = @intCast(usize, minor_version),
                .headers = src[0..num_headers],
                .bytes_read = @intCast(u32, rc),
            },
        };
    }
};

pub const Response = struct {
    minor_version: usize = 0,
    status_code: usize = 0,
    status: []const u8 = "",
    headers: []Header = &.{},
    bytes_read: c_int = 0,

    pub fn format(self: Response, comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
        try fmt.format(writer, "< {d} {s}\n", .{ self.status_code, self.status });
        for (self.headers) |header| {
            _ = try writer.write("< \t");
            try fmt.format(writer, "{s}\n", .{header});
        }
    }

    pub fn count(this: *const Response, builder: *StringBuilder) void {
        builder.count(this.status);

        for (this.headers) |header| {
            header.count(builder);
        }
    }

    pub fn clone(this: *const Response, headers: []Header, builder: *StringBuilder) Response {
        var that = this.*;
        that.status = builder.append(this.status);

        for (this.headers, 0..) |header, i| {
            headers[i] = header.clone(builder);
        }

        that.headers = headers[0..this.headers.len];

        return that;
    }

    pub fn parseParts(buf: []const u8, src: []Header, offset: ?*usize) !Response {
        var minor_version: c_int = 1;
        var status_code: c_int = 0;
        var status: []const u8 = "";
        var num_headers: usize = src.len;

        const rc = c.phr_parse_response(
            buf.ptr,
            buf.len,
            &minor_version,
            &status_code,
            @ptrCast([*c][*c]const u8, &status.ptr),
            &status.len,
            @ptrCast([*c]c.phr_header, src.ptr),
            &num_headers,
            offset.?.*,
        );

        return switch (rc) {
            -1 => if (comptime Environment.allow_assert) brk: {
                Output.debug("Malformed HTTP response:\n{s}", .{buf});
                break :brk error.Malformed_HTTP_Response;
            } else error.Malformed_HTTP_Response,
            -2 => brk: {
                offset.?.* += buf.len;

                break :brk error.ShortRead;
            },
            else => Response{
                .minor_version = @intCast(usize, minor_version),
                .status_code = @intCast(usize, status_code),
                .status = status,
                .headers = src[0..@min(num_headers, src.len)],
                .bytes_read = rc,
            },
        };
    }

    pub fn parse(buf: []const u8, src: []Header) !Response {
        var offset: usize = 0;
        const response = try parseParts(buf, src, &offset);
        return response;
    }
};

test "pico_http: parse response" {
    const RES = "HTTP/1.1 200 OK\r\n" ++
        "Date: Mon, 22 Mar 2021 08:15:54 GMT\r\n" ++
        "Content-Type: text/html; charset=utf-8\r\n" ++
        "Content-Length: 9593\r\n" ++
        "Connection: keep-alive\r\n" ++
        "Server: gunicorn/19.9.0\r\n" ++
        "Access-Control-Allow-Origin: *\r\n" ++
        "Access-Control-Allow-Credentials: true\r\n" ++
        "\r\n";

    var headers: [32]Header = undefined;

    const res = try Response.parse(RES, &headers);

    std.debug.print("Minor Version: {}\n", .{res.minor_version});
    std.debug.print("Status Code: {}\n", .{res.status_code});
    std.debug.print("Status: {s}\n", .{res.status});

    for (res.headers) |header| {
        std.debug.print("{}\n", .{header});
    }
}

pub const Headers = struct {
    headers: []const Header,

    pub fn format(self: Headers, comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
        for (self.headers) |header| {
            try fmt.format(writer, "{s}: {s}\r\n", .{ header.name, header.value });
        }
    }

    pub fn parse(buf: []const u8, src: []Header) !Headers {
        var num_headers: usize = src.len;

        const rc = c.phr_parse_headers(
            buf.ptr,
            buf.len,
            @ptrCast([*c]c.phr_header, src.ptr),
            @ptrCast([*c]usize, &num_headers),
            0,
        );

        return switch (rc) {
            -1 => error.BadHeaders,
            -2 => error.ShortRead,
            else => Headers{
                .headers = src[0..num_headers],
            },
        };
    }
};

test "pico_http: parse headers" {
    const HEADERS = "Date: Mon, 22 Mar 2021 08:15:54 GMT\r\n" ++
        "Content-Type: text/html; charset=utf-8\r\n" ++
        "Content-Length: 9593\r\n" ++
        "Connection: keep-alive\r\n" ++
        "Server: gunicorn/19.9.0\r\n" ++
        "Access-Control-Allow-Origin: *\r\n" ++
        "Access-Control-Allow-Credentials: true\r\n" ++
        "\r\n";

    var headers: [32]Header = undefined;

    const result = try Headers.parse(HEADERS, &headers);
    for (result.headers) |header| {
        std.debug.print("{}\n", .{header});
    }
}

pub usingnamespace c;
