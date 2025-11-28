pub const UseDirective = enum(u2) {
    // TODO: Remove this, and provide `UseDirective.Optional` instead
    none,
    /// "use client"
    client,
    /// "use server"
    server,

    pub const Boundering = enum(u2) {
        client = @intFromEnum(UseDirective.client),
        server = @intFromEnum(UseDirective.server),
    };

    pub const Flags = struct {
        has_any_client: bool = false,
    };

    pub fn isBoundary(this: UseDirective, other: UseDirective) bool {
        if (this == other or other == .none)
            return false;

        return true;
    }

    pub fn boundering(this: UseDirective, other: UseDirective) ?Boundering {
        if (this == other or other == .none)
            return null;
        return @enumFromInt(@intFromEnum(other));
    }

    pub fn parse(contents: []const u8) ?UseDirective {
        const truncated = std.mem.trimLeft(u8, contents, " \t\n\r;");

        if (truncated.len < "'use client';".len)
            return .none;

        const directive_string = truncated[0.."'use client';".len].*;

        const first_quote = directive_string[0];
        const last_quote = directive_string[directive_string.len - 2];
        if (first_quote != last_quote or (first_quote != '"' and first_quote != '\'' and first_quote != '`'))
            return .none;

        const unquoted = directive_string[1 .. directive_string.len - 2];

        if (strings.eqlComptime(unquoted, "use client")) {
            return .client;
        }

        if (strings.eqlComptime(unquoted, "use server")) {
            return .server;
        }

        return null;
    }
};

const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;

const js_ast = bun.ast;
const Flags = js_ast.Flags;
