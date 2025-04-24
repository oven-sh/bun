const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;

const std = @import("std");

pub const Method = enum(u8) {
    ACL = 0,
    BIND = 1,
    CHECKOUT = 2,
    CONNECT = 3,
    COPY = 4,
    DELETE = 5,
    GET = 6,
    HEAD = 7,
    LINK = 8,
    LOCK = 9,
    @"M-SEARCH" = 10,
    MERGE = 11,
    MKACTIVITY = 12,
    MKCALENDAR = 13,
    MKCOL = 14,
    MOVE = 15,
    NOTIFY = 16,
    OPTIONS = 17,
    PATCH = 18,
    POST = 19,
    PROPFIND = 20,
    PROPPATCH = 21,
    PURGE = 22,
    PUT = 23,
    /// https://httpwg.org/http-extensions/draft-ietf-httpbis-safe-method-w-body.html
    QUERY = 24,
    REBIND = 25,
    REPORT = 26,
    SEARCH = 27,
    SOURCE = 28,
    SUBSCRIBE = 29,
    TRACE = 30,
    UNBIND = 31,
    UNLINK = 32,
    UNLOCK = 33,
    UNSUBSCRIBE = 34,

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

    pub fn find(str: []const u8) ?Method {
        return Map.get(str);
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

    extern "c" fn Bun__HTTPMethod__toJS(method: Method, globalObject: *JSC.JSGlobalObject) JSC.JSValue;

    pub const toJS = Bun__HTTPMethod__toJS;

    const JSC = bun.JSC;
};
