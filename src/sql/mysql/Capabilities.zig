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
const _CLIENT_LONG_PASSWORD = 1; // 1 << 0
const _CLIENT_FOUND_ROWS = 2; // 1 << 1
const _CLIENT_LONG_FLAG = 4; // 1 << 2
const _CLIENT_CONNECT_WITH_DB = 8; // 1 << 3
const _CLIENT_NO_SCHEMA = 16; // 1 << 4
const _CLIENT_COMPRESS = 32; // 1 << 5
const _CLIENT_ODBC = 64; // 1 << 6
const _CLIENT_LOCAL_FILES = 128; // 1 << 7
const _CLIENT_IGNORE_SPACE = 256; // 1 << 8
const _CLIENT_PROTOCOL_41 = 512; // 1 << 9
const _CLIENT_INTERACTIVE = 1024; // 1 << 10
const _CLIENT_SSL = 2048; // 1 << 11
const _CLIENT_IGNORE_SIGPIPE = 4096; // 1 << 12
const _CLIENT_TRANSACTIONS = 8192; // 1 << 13
const _CLIENT_RESERVED = 16384; // 1 << 14
const _CLIENT_SECURE_CONNECTION = 32768; // 1 << 15
const _CLIENT_MULTI_STATEMENTS = 65536; // 1 << 16
const _CLIENT_MULTI_RESULTS = 131072; // 1 << 17
const _CLIENT_PS_MULTI_RESULTS = 262144; // 1 << 18
const _CLIENT_PLUGIN_AUTH = 524288; // 1 << 19
const _CLIENT_CONNECT_ATTRS = 1048576; // 1 << 20
const _CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA = 2097152; // 1 << 21
const _CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS = 4194304; // 1 << 22
const _CLIENT_SESSION_TRACK = 8388608; // 1 << 23
const _CLIENT_DEPRECATE_EOF = 16777216; // 1 << 24
const _CLIENT_OPTIONAL_RESULTSET_METADATA = 33554432; // 1 << 25
const _CLIENT_ZSTD_COMPRESSION_ALGORITHM = 67108864; // 1 << 26
const _CLIENT_QUERY_ATTRIBUTES = 134217728; // 1 << 27
const _MULTI_FACTOR_AUTHENTICATION = 268435456; // 1 << 28
const _CLIENT_CAPABILITY_EXTENSION = 536870912; // 1 << 29
const _CLIENT_SSL_VERIFY_SERVER_CERT = 1073741824; // 1 << 30
const _CLIENT_REMEMBER_OPTIONS = 2147483648; // 1 << 31

comptime {
    _ = .{
        .CLIENT_LONG_PASSWORD = _CLIENT_LONG_PASSWORD,
        .CLIENT_FOUND_ROWS = _CLIENT_FOUND_ROWS,
        .CLIENT_LONG_FLAG = _CLIENT_LONG_FLAG,
        .CLIENT_CONNECT_WITH_DB = _CLIENT_CONNECT_WITH_DB,
        .CLIENT_NO_SCHEMA = _CLIENT_NO_SCHEMA,
        .CLIENT_COMPRESS = _CLIENT_COMPRESS,
        .CLIENT_ODBC = _CLIENT_ODBC,
        .CLIENT_LOCAL_FILES = _CLIENT_LOCAL_FILES,
        .CLIENT_IGNORE_SPACE = _CLIENT_IGNORE_SPACE,
        .CLIENT_PROTOCOL_41 = _CLIENT_PROTOCOL_41,
        .CLIENT_INTERACTIVE = _CLIENT_INTERACTIVE,
        .CLIENT_SSL = _CLIENT_SSL,
        .CLIENT_IGNORE_SIGPIPE = _CLIENT_IGNORE_SIGPIPE,
        .CLIENT_TRANSACTIONS = _CLIENT_TRANSACTIONS,
        .CLIENT_RESERVED = _CLIENT_RESERVED,
        .CLIENT_SECURE_CONNECTION = _CLIENT_SECURE_CONNECTION,
        .CLIENT_MULTI_STATEMENTS = _CLIENT_MULTI_STATEMENTS,
        .CLIENT_MULTI_RESULTS = _CLIENT_MULTI_RESULTS,
        .CLIENT_PS_MULTI_RESULTS = _CLIENT_PS_MULTI_RESULTS,
        .CLIENT_PLUGIN_AUTH = _CLIENT_PLUGIN_AUTH,
        .CLIENT_CONNECT_ATTRS = _CLIENT_CONNECT_ATTRS,
        .CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA = _CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA,
        .CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS = _CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS,
        .CLIENT_SESSION_TRACK = _CLIENT_SESSION_TRACK,
        .CLIENT_DEPRECATE_EOF = _CLIENT_DEPRECATE_EOF,
        .CLIENT_OPTIONAL_RESULTSET_METADATA = _CLIENT_OPTIONAL_RESULTSET_METADATA,
        .CLIENT_ZSTD_COMPRESSION_ALGORITHM = _CLIENT_ZSTD_COMPRESSION_ALGORITHM,
        .CLIENT_QUERY_ATTRIBUTES = _CLIENT_QUERY_ATTRIBUTES,
        .MULTI_FACTOR_AUTHENTICATION = _MULTI_FACTOR_AUTHENTICATION,
        .CLIENT_CAPABILITY_EXTENSION = _CLIENT_CAPABILITY_EXTENSION,
        .CLIENT_SSL_VERIFY_SERVER_CERT = _CLIENT_SSL_VERIFY_SERVER_CERT,
        .CLIENT_REMEMBER_OPTIONS = _CLIENT_REMEMBER_OPTIONS,
    };
}

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

pub fn format(self: @This(), writer: *std.Io.Writer) std.Io.Writer.Error!void {
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
