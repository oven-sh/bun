const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");

pub const Method = enum {
    GET,
    HEAD,
    PATCH,
    PUT,
    POST,
    OPTIONS,
    CONNECT,
    TRACE,
    DELETE,

    const with_body: std.enums.EnumSet(Method) = brk: {
        var values = std.enums.EnumSet(Method).initFull();
        values.remove(.HEAD);
        values.remove(.TRACE);
        values.remove(.OPTIONS);
        break :brk values;
    };

    const with_request_body: std.enums.EnumSet(Method) = brk: {
        var values = std.enums.EnumSet(Method).initFull();
        values.remove(.HEAD);
        values.remove(.TRACE);
        values.remove(.OPTIONS);
        values.remove(.GET);
        break :brk values;
    };

    pub fn hasBody(this: Method) bool {
        return with_body.contains(this);
    }

    pub fn hasRequestBody(this: Method) bool {
        return with_request_body.contains(this);
    }

    const Map = bun.ComptimeStringMap(Method, .{
        .{ "CONNECT", Method.CONNECT },
        .{ "DELETE", Method.DELETE },
        .{ "GET", Method.GET },
        .{ "HEAD", Method.HEAD },
        .{ "OPTIONS", Method.OPTIONS },
        .{ "PATCH", Method.PATCH },
        .{ "POST", Method.POST },
        .{ "PUT", Method.PUT },
        .{ "TRACE", Method.TRACE },
        .{ "connect", Method.CONNECT },
        .{ "delete", Method.DELETE },
        .{ "get", Method.GET },
        .{ "head", Method.HEAD },
        .{ "options", Method.OPTIONS },
        .{ "patch", Method.PATCH },
        .{ "post", Method.POST },
        .{ "put", Method.PUT },
        .{ "trace", Method.TRACE },
    });

    pub fn which(str: []const u8) ?Method {
        return Map.get(str);
    }
};
