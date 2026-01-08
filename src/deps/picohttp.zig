pub const Header = struct {
    name: []const u8,
    value: []const u8,

    pub const List = struct {
        list: []Header = &.{},

        pub fn get(this: *const List, name: string) ?string {
            for (this.list) |header| {
                if (strings.eqlCaseInsensitiveASCII(header.name, name, true)) {
                    return header.value;
                }
            }
            return null;
        }

        pub fn getIfOtherIsAbsent(this: *const List, name: string, other: string) ?string {
            var value: ?string = null;
            for (this.list) |header| {
                if (strings.eqlCaseInsensitiveASCII(header.name, other, true)) {
                    return null;
                }

                if (value == null and strings.eqlCaseInsensitiveASCII(header.name, name, true)) {
                    value = header.value;
                }
            }

            return value;
        }
    };

    pub fn isMultiline(self: Header) bool {
        return self.name.len == 0;
    }

    pub fn format(self: Header, writer: *std.Io.Writer) !void {
        if (Output.enable_ansi_colors_stderr) {
            if (self.isMultiline()) {
                try writer.print(comptime Output.prettyFmt("<r><cyan>{s}", true), .{self.value});
            } else {
                try writer.print(comptime Output.prettyFmt("<r><cyan>{s}<r><d>: <r>{s}", true), .{ self.name, self.value });
            }
        } else {
            if (self.isMultiline()) {
                try writer.print(comptime Output.prettyFmt("<r><cyan>{s}", false), .{self.value});
            } else {
                try writer.print(comptime Output.prettyFmt("<r><cyan>{s}<r><d>: <r>{s}", false), .{ self.name, self.value });
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

    pub const CURLFormatter = struct {
        header: *const Header,

        pub fn format(self: @This(), writer: *std.Io.Writer) !void {
            const header = self.header;
            if (header.value.len > 0) {
                try writer.print("-H \"{s}: {s}\"", .{ header.name, header.value });
            } else {
                try writer.print("-H \"{s}\"", .{header.name});
            }
        }
    };

    pub fn curl(self: *const Header) Header.CURLFormatter {
        return .{ .header = self };
    }
};

pub const Request = struct {
    method: []const u8,
    path: []const u8,
    minor_version: usize,
    headers: []const Header,
    bytes_read: u32 = 0,

    pub const CURLFormatter = struct {
        request: *const Request,
        ignore_insecure: bool = false,
        body: []const u8 = "",

        fn isPrintableBody(content_type: []const u8) bool {
            if (content_type.len == 0) return false;

            return bun.strings.hasPrefixComptime(content_type, "text/") or
                bun.strings.hasPrefixComptime(content_type, "application/json") or
                bun.strings.containsComptime(content_type, "json") or
                bun.strings.hasPrefixComptime(content_type, "application/x-www-form-urlencoded");
        }

        pub fn format(self: @This(), writer: *std.Io.Writer) !void {
            const request = self.request;
            if (Output.enable_ansi_colors_stderr) {
                _ = try writer.write(Output.prettyFmt("<r><d>[fetch] $<r> ", true));

                try writer.print(Output.prettyFmt("<b><cyan>curl<r> <d>--http1.1<r> <b>\"{s}\"<r>", true), .{request.path});
            } else {
                try writer.print("curl --http1.1 \"{s}\"", .{request.path});
            }

            if (!bun.strings.eqlComptime(request.method, "GET")) {
                try writer.print(" -X {s}", .{request.method});
            }

            if (self.ignore_insecure) {
                _ = try writer.writeAll(" -k");
            }

            var content_type: []const u8 = "";

            for (request.headers) |*header| {
                _ = try writer.writeAll(" ");
                if (content_type.len == 0) {
                    if (bun.strings.eqlCaseInsensitiveASCII("content-type", header.name, true)) {
                        content_type = header.value;
                    }
                }

                try header.curl().format(writer);

                if (bun.strings.eqlCaseInsensitiveASCII("accept-encoding", header.name, true)) {
                    _ = try writer.writeAll(" --compressed");
                }
            }

            if (self.body.len > 0 and isPrintableBody(content_type)) {
                _ = try writer.writeAll(" --data-raw ");
                try bun.js_printer.writeJSONString(self.body, @TypeOf(writer), writer, .utf8);
            }
        }
    };

    pub fn curl(self: *const Request, ignore_insecure: bool, body: []const u8) Request.CURLFormatter {
        return .{
            .request = self,
            .ignore_insecure = ignore_insecure,
            .body = body,
        };
    }

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

    pub fn format(self: Request, writer: *std.Io.Writer) !void {
        if (Output.enable_ansi_colors_stderr) {
            _ = try writer.write(Output.prettyFmt("<r><d>[fetch]<r> ", true));
        }
        try writer.print("> HTTP/1.1 {s} {s}\n", .{ self.method, self.path });
        for (self.headers) |header| {
            if (Output.enable_ansi_colors_stderr) {
                _ = try writer.write(Output.prettyFmt("<r><d>[fetch]<r> ", true));
            }
            _ = try writer.write("> ");
            try writer.print("{f}\n", .{header});
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
            @as([*c][*c]const u8, @ptrCast(&method.ptr)),
            &method.len,
            @as([*c][*c]const u8, @ptrCast(&path.ptr)),
            &path.len,
            &minor_version,
            @as([*c]c.phr_header, @ptrCast(src.ptr)),
            &num_headers,
            0,
        );

        // Leave a sentinel value, for JavaScriptCore support.
        if (rc > -1) @as([*]u8, @ptrFromInt(@intFromPtr(path.ptr)))[path.len] = 0;

        return switch (rc) {
            -1 => error.BadRequest,
            -2 => error.ShortRead,
            else => Request{
                .method = method,
                .path = path,
                .minor_version = @as(usize, @intCast(minor_version)),
                .headers = src[0..num_headers],
                .bytes_read = @as(u32, @intCast(rc)),
            },
        };
    }
};

const StatusCodeFormatter = struct {
    code: usize,

    pub fn format(self: @This(), writer: *std.Io.Writer) !void {
        if (Output.enable_ansi_colors_stderr) {
            switch (self.code) {
                101, 200...299 => try writer.print(comptime Output.prettyFmt("<r><green>{d}<r>", true), .{self.code}),
                300...399 => try writer.print(comptime Output.prettyFmt("<r><yellow>{d}<r>", true), .{self.code}),
                else => try writer.print(comptime Output.prettyFmt("<r><red>{d}<r>", true), .{self.code}),
            }
        } else {
            try writer.print("{d}", .{self.code});
        }
    }
};

pub const Response = struct {
    minor_version: usize = 0,
    status_code: u32 = 0,
    status: []const u8 = "",
    headers: Header.List = .{},
    bytes_read: c_int = 0,

    pub fn format(self: Response, writer: *std.Io.Writer) !void {
        if (Output.enable_ansi_colors_stderr) {
            _ = try writer.write(Output.prettyFmt("<r><d>[fetch]<r> ", true));
        }

        try writer.print(
            "< {f} {s}\n",
            .{
                StatusCodeFormatter{
                    .code = self.status_code,
                },
                self.status,
            },
        );
        for (self.headers.list) |header| {
            if (Output.enable_ansi_colors_stderr) {
                _ = try writer.write(Output.prettyFmt("<r><d>[fetch]<r> ", true));
            }

            _ = try writer.write("< ");
            try writer.print("{f}\n", .{header});
        }
    }

    pub fn count(this: *const Response, builder: *StringBuilder) void {
        builder.count(this.status);

        for (this.headers.list) |header| {
            header.count(builder);
        }
    }

    pub fn clone(this: *const Response, headers: []Header, builder: *StringBuilder) Response {
        var that = this.*;
        that.status = builder.append(this.status);

        for (this.headers.list, 0..) |header, i| {
            headers[i] = header.clone(builder);
        }

        that.headers.list = headers[0..this.headers.list.len];

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
            @as([*c][*c]const u8, @ptrCast(&status.ptr)),
            &status.len,
            @as([*c]c.phr_header, @ptrCast(src.ptr)),
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
                .minor_version = @as(usize, @intCast(minor_version)),
                .status_code = @as(u32, @intCast(status_code)),
                .status = status,
                .headers = .{ .list = src[0..@min(num_headers, src.len)] },
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

pub const Headers = struct {
    headers: []const Header,

    pub fn format(self: Headers, writer: *std.Io.Writer) !void {
        for (self.headers) |header| {
            try writer.print("{s}: {s}\r\n", .{ header.name, header.value });
        }
    }

    pub fn parse(buf: []const u8, src: []Header) !Headers {
        var num_headers: usize = src.len;

        const rc = c.phr_parse_headers(
            buf.ptr,
            buf.len,
            @as([*c]c.phr_header, @ptrCast(src.ptr)),
            @as([*c]usize, @ptrCast(&num_headers)),
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

pub const phr_header = c.phr_header;
pub const phr_chunked_decoder = c.phr_chunked_decoder;
pub const struct_phr_header = c.struct_phr_header;
pub const struct_phr_chunked_decoder = c.struct_phr_chunked_decoder;
pub const phr_parse_request = c.phr_parse_request;
pub const phr_parse_response = c.phr_parse_response;
pub const phr_parse_headers = c.phr_parse_headers;
pub const phr_decode_chunked = c.phr_decode_chunked;
pub const phr_decode_chunked_is_in_data = c.phr_decode_chunked_is_in_data;

const string = []const u8;

const c = @import("./picohttpparser.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const StringBuilder = bun.StringBuilder;
const assert = bun.assert;
const strings = bun.strings;
