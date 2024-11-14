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
    ACL,
    BIND,
    CHECKOUT,
    CONNECT,
    COPY,
    DELETE,
    GET,
    HEAD,
    LINK,
    LOCK,
    @"M-SEARCH",
    MERGE,
    MKACTIVITY,
    MKCALENDAR,
    MKCOL,
    MOVE,
    NOTIFY,
    OPTIONS,
    PATCH,
    POST,
    PROPFIND,
    PROPPATCH,
    PURGE,
    PUT,
    /// https://httpwg.org/http-extensions/draft-ietf-httpbis-safe-method-w-body.html
    QUERY,
    REBIND,
    REPORT,
    SEARCH,
    SOURCE,
    SUBSCRIBE,
    TRACE,
    UNBIND,
    UNLINK,
    UNLOCK,
    UNSUBSCRIBE,

    pub const fromJS = Map.fromJS;

    const with_body: std.enums.EnumSet(Method) = brk: {
        var values = std.enums.EnumSet(Method).initFull();
        values.remove(.HEAD);
        values.remove(.TRACE);
        break :brk values;
    };

    const with_request_body: std.enums.EnumSet(Method) = brk: {
        var values = std.enums.EnumSet(Method).initFull();
        values.remove(.GET);
        values.remove(.HEAD);
        values.remove(.OPTIONS);
        values.remove(.TRACE);
        break :brk values;
    };

    pub fn hasBody(this: Method) bool {
        return with_body.contains(this);
    }

    pub fn hasRequestBody(this: Method) bool {
        return with_request_body.contains(this);
    }

    const Map = bun.ComptimeStringMap(Method, .{
        .{ "ACL", Method.ACL },
        .{ "BIND", Method.BIND },
        .{ "CHECKOUT", Method.CHECKOUT },
        .{ "CONNECT", Method.CONNECT },
        .{ "COPY", Method.COPY },
        .{ "DELETE", Method.DELETE },
        .{ "GET", Method.GET },
        .{ "HEAD", Method.HEAD },
        .{ "LINK", Method.LINK },
        .{ "LOCK", Method.LOCK },
        .{ "M-SEARCH", Method.@"M-SEARCH" },
        .{ "MERGE", Method.MERGE },
        .{ "MKACTIVITY", Method.MKACTIVITY },
        .{ "MKCALENDAR", Method.MKCALENDAR },
        .{ "MKCOL", Method.MKCOL },
        .{ "MOVE", Method.MOVE },
        .{ "NOTIFY", Method.NOTIFY },
        .{ "OPTIONS", Method.OPTIONS },
        .{ "PATCH", Method.PATCH },
        .{ "POST", Method.POST },
        .{ "PROPFIND", Method.PROPFIND },
        .{ "PROPPATCH", Method.PROPPATCH },
        .{ "PURGE", Method.PURGE },
        .{ "PUT", Method.PUT },
        .{ "QUERY", Method.QUERY },
        .{ "REBIND", Method.REBIND },
        .{ "REPORT", Method.REPORT },
        .{ "SEARCH", Method.SEARCH },
        .{ "SOURCE", Method.SOURCE },
        .{ "SUBSCRIBE", Method.SUBSCRIBE },
        .{ "TRACE", Method.TRACE },
        .{ "UNBIND", Method.UNBIND },
        .{ "UNLINK", Method.UNLINK },
        .{ "UNLOCK", Method.UNLOCK },
        .{ "UNSUBSCRIBE", Method.UNSUBSCRIBE },

        .{ "acl", Method.ACL },
        .{ "bind", Method.BIND },
        .{ "checkout", Method.CHECKOUT },
        .{ "connect", Method.CONNECT },
        .{ "copy", Method.COPY },
        .{ "delete", Method.DELETE },
        .{ "get", Method.GET },
        .{ "head", Method.HEAD },
        .{ "link", Method.LINK },
        .{ "lock", Method.LOCK },
        .{ "m-search", Method.@"M-SEARCH" },
        .{ "merge", Method.MERGE },
        .{ "mkactivity", Method.MKACTIVITY },
        .{ "mkcalendar", Method.MKCALENDAR },
        .{ "mkcol", Method.MKCOL },
        .{ "move", Method.MOVE },
        .{ "notify", Method.NOTIFY },
        .{ "options", Method.OPTIONS },
        .{ "patch", Method.PATCH },
        .{ "post", Method.POST },
        .{ "propfind", Method.PROPFIND },
        .{ "proppatch", Method.PROPPATCH },
        .{ "purge", Method.PURGE },
        .{ "put", Method.PUT },
        .{ "query", Method.QUERY },
        .{ "rebind", Method.REBIND },
        .{ "report", Method.REPORT },
        .{ "search", Method.SEARCH },
        .{ "source", Method.SOURCE },
        .{ "subscribe", Method.SUBSCRIBE },
        .{ "trace", Method.TRACE },
        .{ "unbind", Method.UNBIND },
        .{ "unlink", Method.UNLINK },
        .{ "unlock", Method.UNLOCK },
        .{ "unsubscribe", Method.UNSUBSCRIBE },
    });

    pub fn which(str: []const u8) ?Method {
        return Map.get(str);
    }
};
