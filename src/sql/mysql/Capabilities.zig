// MySQL capability flags
const Capabilities = @This();
CLIENT_LONG_PASSWORD: bool = false,
CLIENT_FOUND_ROWS: bool = false,
CLIENT_LONG_FLAG: bool = false,
CLIENT_CONNECT_WITH_DB: bool = false,
CLIENT_NO_SCHEMA: bool = false,
CLIENT_COMPRESS: bool = false,
CLIENT_ODBC: bool = false,
CLIENT_LOCAL_FILES: bool = false,
CLIENT_IGNORE_SPACE: bool = false,
CLIENT_PROTOCOL_41: bool = false,
CLIENT_INTERACTIVE: bool = false,
CLIENT_SSL: bool = false,
CLIENT_IGNORE_SIGPIPE: bool = false,
CLIENT_TRANSACTIONS: bool = false,
CLIENT_RESERVED: bool = false,
CLIENT_SECURE_CONNECTION: bool = false,
CLIENT_MULTI_STATEMENTS: bool = false,
CLIENT_MULTI_RESULTS: bool = false,
CLIENT_PS_MULTI_RESULTS: bool = false,
CLIENT_PLUGIN_AUTH: bool = false,
CLIENT_CONNECT_ATTRS: bool = false,
CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA: bool = false,
CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS: bool = false,
CLIENT_SESSION_TRACK: bool = false,
CLIENT_DEPRECATE_EOF: bool = false,
CLIENT_OPTIONAL_RESULTSET_METADATA: bool = false,
CLIENT_ZSTD_COMPRESSION_ALGORITHM: bool = false,
CLIENT_QUERY_ATTRIBUTES: bool = false,
MULTI_FACTOR_AUTHENTICATION: bool = false,
CLIENT_CAPABILITY_EXTENSION: bool = false,
CLIENT_SSL_VERIFY_SERVER_CERT: bool = false,
CLIENT_REMEMBER_OPTIONS: bool = false,

// Constants with correct shift values from MySQL protocol

pub fn reject(this: *Capabilities) void {
    this.CLIENT_ZSTD_COMPRESSION_ALGORITHM = false;
    this.MULTI_FACTOR_AUTHENTICATION = false;
    this.CLIENT_CAPABILITY_EXTENSION = false;
    this.CLIENT_SSL_VERIFY_SERVER_CERT = false;
    this.CLIENT_REMEMBER_OPTIONS = false;
    this.CLIENT_COMPRESS = false;
    this.CLIENT_INTERACTIVE = false;
    this.CLIENT_IGNORE_SIGPIPE = false;
    this.CLIENT_NO_SCHEMA = false;
    this.CLIENT_ODBC = false;
    this.CLIENT_LOCAL_FILES = false;
    this.CLIENT_OPTIONAL_RESULTSET_METADATA = false;
    this.CLIENT_QUERY_ATTRIBUTES = false;
}

pub fn format(self: @This(), comptime _: []const u8, _: anytype, writer: anytype) !void {
    var first = true;
    inline for (comptime std.meta.fieldNames(Capabilities)) |field| {
        if (@TypeOf(@field(self, field)) == bool) {
            if (@field(self, field)) {
                if (!first) {
                    try writer.writeAll(", ");
                }
                first = false;
                try writer.writeAll(field);
            }
        }
    }
}

pub fn toInt(this: Capabilities) u32 {
    var value: u32 = 0;

    const fields = .{
        "CLIENT_LONG_PASSWORD",
        "CLIENT_FOUND_ROWS",
        "CLIENT_LONG_FLAG",
        "CLIENT_CONNECT_WITH_DB",
        "CLIENT_NO_SCHEMA",
        "CLIENT_COMPRESS",
        "CLIENT_ODBC",
        "CLIENT_LOCAL_FILES",
        "CLIENT_IGNORE_SPACE",
        "CLIENT_PROTOCOL_41",
        "CLIENT_INTERACTIVE",
        "CLIENT_SSL",
        "CLIENT_IGNORE_SIGPIPE",
        "CLIENT_TRANSACTIONS",
        "CLIENT_RESERVED",
        "CLIENT_SECURE_CONNECTION",
        "CLIENT_MULTI_STATEMENTS",
        "CLIENT_MULTI_RESULTS",
        "CLIENT_PS_MULTI_RESULTS",
        "CLIENT_PLUGIN_AUTH",
        "CLIENT_CONNECT_ATTRS",
        "CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA",
        "CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS",
        "CLIENT_SESSION_TRACK",
        "CLIENT_DEPRECATE_EOF",
        "CLIENT_OPTIONAL_RESULTSET_METADATA",
        "CLIENT_ZSTD_COMPRESSION_ALGORITHM",
        "CLIENT_QUERY_ATTRIBUTES",
        "MULTI_FACTOR_AUTHENTICATION",
        "CLIENT_CAPABILITY_EXTENSION",
        "CLIENT_SSL_VERIFY_SERVER_CERT",
        "CLIENT_REMEMBER_OPTIONS",
    };
    inline for (fields) |field| {
        if (@field(this, field)) {
            value |= @field(Capabilities, "_" ++ field);
        }
    }

    return value;
}

pub fn fromInt(flags: u32) Capabilities {
    var this: Capabilities = .{};
    inline for (comptime std.meta.fieldNames(Capabilities)) |field| {
        @field(this, field) = (@field(Capabilities, "_" ++ field) & flags) != 0;
    }
    return this;
}

pub fn getDefaultCapabilities(ssl: bool, has_db_name: bool) Capabilities {
    return .{
        .CLIENT_PROTOCOL_41 = true,
        .CLIENT_PLUGIN_AUTH = true,
        .CLIENT_SECURE_CONNECTION = true,
        .CLIENT_CONNECT_WITH_DB = has_db_name,
        .CLIENT_DEPRECATE_EOF = true,
        .CLIENT_SSL = ssl,
        .CLIENT_MULTI_STATEMENTS = true,
        .CLIENT_MULTI_RESULTS = true,
    };
}

const std = @import("std");
