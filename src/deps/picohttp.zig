const std = @import("std");
const c = @cImport(@cInclude("picohttpparser.h"));
const ExactSizeMatcher = @import("../exact_size_matcher.zig").ExactSizeMatcher;
const Match = ExactSizeMatcher(2);

const fmt = std.fmt;

const assert = std.debug.assert;

pub const Header = struct {
    name: []const u8,
    value: []const u8,

    pub fn isMultiline(self: Header) bool {
        return @ptrToInt(self.name.ptr) == 0;
    }

    pub fn format(self: Header, comptime layout: []const u8, opts: fmt.FormatOptions, writer: anytype) !void {
        if (self.isMultiline()) {
            try fmt.format(writer, "{s}", .{self.value});
        } else {
            try fmt.format(writer, "{s}: {s}", .{ self.name, self.value });
        }
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
        @intToPtr([*]u8, @ptrToInt(path.ptr))[path.len] = 0;

        return switch (rc) {
            -1 => error.BadRequest,
            -2 => error.ShortRead,
            else => |bytes_read| Request{
                .method = method,
                .path = path,
                .minor_version = @intCast(usize, minor_version),
                .headers = src[0..num_headers],
            },
        };
    }
};

test "pico_http: parse request" {
    const REQ = "GET /wp-content/uploads/2010/03/hello-kitty-darth-vader-pink.jpg HTTP/1.1\r\n" ++
        "Host: www.kittyhell.com\r\n" ++
        "User-Agent: Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10.6; ja-JP-mac; rv:1.9.2.3) Gecko/20100401 Firefox/3.6.3 " ++
        "Pathtraq/0.9\r\n" ++
        "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8\r\n" ++
        "Accept-Language: ja,en-us;q=0.7,en;q=0.3\r\n" ++
        "Accept-Encoding: gzip,deflate\r\n" ++
        "Accept-Charset: Shift_JIS,utf-8;q=0.7,*;q=0.7\r\n" ++
        "Keep-Alive: 115\r\n" ++
        "Connection: keep-alive\r\n" ++
        "TestMultiline: Hello world\r\n" ++
        "   This is a second line in the header!\r\n" ++
        "Cookie: wp_ozh_wsa_visits=2; wp_ozh_wsa_visit_lasttime=xxxxxxxxxx; " ++
        "__utma=xxxxxxxxx.xxxxxxxxxx.xxxxxxxxxx.xxxxxxxxxx.xxxxxxxxxx.x; " ++
        "__utmz=xxxxxxxxx.xxxxxxxxxx.x.x.utmccn=(referral)|utmcsr=reader.livedoor.com|utmcct=/reader/|utmcmd=referral\r\n" ++
        "\r\n";

    var headers: [32]Header = undefined;

    const req = try Request.parse(REQ, &headers);

    std.debug.print("Method: {s}\n", .{req.method});
    std.debug.print("Path: {s}\n", .{req.path});
    std.debug.print("Minor Version: {}\n", .{req.minor_version});

    for (req.headers) |header| {
        std.debug.print("{}\n", .{header});
    }
}

pub const Response = struct {
    minor_version: usize,
    status_code: usize,
    status: []const u8,
    headers: []const Header,

    pub fn parse(buf: []const u8, src: []Header) !Response {
        var minor_version: c_int = undefined;
        var status_code: c_int = undefined;
        var status: []const u8 = undefined;
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
            0,
        );

        return switch (rc) {
            -1 => error.BadResponse,
            -2 => error.ShortRead,
            else => |bytes_read| Response{
                .minor_version = @intCast(usize, minor_version),
                .status_code = @intCast(usize, status_code),
                .status = status,
                .headers = src[0..num_headers],
            },
        };
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
            else => |bytes_read| Headers{
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
