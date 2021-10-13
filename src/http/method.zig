usingnamespace @import("../global.zig");

pub const Method = enum {
    GET,
    HEAD,
    PATCH,
    PUT,
    POST,
    OPTIONS,
    CONNECT,
    TRACE,

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
            else => {
                return null;
            },
        }
    }
};
