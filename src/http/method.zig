const bun = @import("../global.zig");
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

    pub fn which(str: []const u8) ?Method {
        if (str.len < 3) {
            return null;
        }
        const Match = strings.ExactSizeMatcher(2);
        // we already did the length check
        switch (Match.match(str[0..2])) {
            Match.case("GE"), Match.case("ge") => {
                return .GET;
            },
            Match.case("HE"), Match.case("he") => {
                return .HEAD;
            },
            Match.case("PA"), Match.case("pa") => {
                return .PATCH;
            },
            Match.case("PO"), Match.case("po") => {
                return .POST;
            },
            Match.case("PU"), Match.case("pu") => {
                return .PUT;
            },
            Match.case("OP"), Match.case("op") => {
                return .OPTIONS;
            },
            Match.case("CO"), Match.case("co") => {
                return .CONNECT;
            },
            Match.case("TR"), Match.case("tr") => {
                return .TRACE;
            },
            Match.case("DE"), Match.case("de") => {
                return .DELETE;
            },
            else => {
                return null;
            },
        }
    }
};
