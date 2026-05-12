// MySQL capability flags
//
// PORT NOTE: The Zig original is a file-level struct of `bool` fields (NOT a
// `packed struct(u32)`), with explicit bit-value constants and comptime field
// iteration for `toInt`/`fromInt`/`format`. We keep the same shape — a plain
// struct of bools — and unroll the comptime loops explicitly. Field names stay
// SCREAMING_SNAKE_CASE because `format` emits them verbatim.
// (non_snake_case / non_upper_case_globals allowed at crate root.)

use core::fmt;

#[derive(Default, Clone, Copy, PartialEq, Eq)]
pub struct Capabilities {
    pub CLIENT_LONG_PASSWORD: bool,
    pub CLIENT_FOUND_ROWS: bool,
    pub CLIENT_LONG_FLAG: bool,
    pub CLIENT_CONNECT_WITH_DB: bool,
    pub CLIENT_NO_SCHEMA: bool,
    pub CLIENT_COMPRESS: bool,
    pub CLIENT_ODBC: bool,
    pub CLIENT_LOCAL_FILES: bool,
    pub CLIENT_IGNORE_SPACE: bool,
    pub CLIENT_PROTOCOL_41: bool,
    pub CLIENT_INTERACTIVE: bool,
    pub CLIENT_SSL: bool,
    pub CLIENT_IGNORE_SIGPIPE: bool,
    pub CLIENT_TRANSACTIONS: bool,
    pub CLIENT_RESERVED: bool,
    pub CLIENT_SECURE_CONNECTION: bool,
    pub CLIENT_MULTI_STATEMENTS: bool,
    pub CLIENT_MULTI_RESULTS: bool,
    pub CLIENT_PS_MULTI_RESULTS: bool,
    pub CLIENT_PLUGIN_AUTH: bool,
    pub CLIENT_CONNECT_ATTRS: bool,
    pub CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA: bool,
    pub CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS: bool,
    pub CLIENT_SESSION_TRACK: bool,
    pub CLIENT_DEPRECATE_EOF: bool,
    pub CLIENT_OPTIONAL_RESULTSET_METADATA: bool,
    pub CLIENT_ZSTD_COMPRESSION_ALGORITHM: bool,
    pub CLIENT_QUERY_ATTRIBUTES: bool,
    pub MULTI_FACTOR_AUTHENTICATION: bool,
    pub CLIENT_CAPABILITY_EXTENSION: bool,
    pub CLIENT_SSL_VERIFY_SERVER_CERT: bool,
    pub CLIENT_REMEMBER_OPTIONS: bool,
}

impl Capabilities {
    // Constants with correct shift values from MySQL protocol
    const _CLIENT_LONG_PASSWORD: u32 = 1; // 1 << 0
    const _CLIENT_FOUND_ROWS: u32 = 2; // 1 << 1
    const _CLIENT_LONG_FLAG: u32 = 4; // 1 << 2
    const _CLIENT_CONNECT_WITH_DB: u32 = 8; // 1 << 3
    const _CLIENT_NO_SCHEMA: u32 = 16; // 1 << 4
    const _CLIENT_COMPRESS: u32 = 32; // 1 << 5
    const _CLIENT_ODBC: u32 = 64; // 1 << 6
    const _CLIENT_LOCAL_FILES: u32 = 128; // 1 << 7
    const _CLIENT_IGNORE_SPACE: u32 = 256; // 1 << 8
    const _CLIENT_PROTOCOL_41: u32 = 512; // 1 << 9
    const _CLIENT_INTERACTIVE: u32 = 1024; // 1 << 10
    const _CLIENT_SSL: u32 = 2048; // 1 << 11
    const _CLIENT_IGNORE_SIGPIPE: u32 = 4096; // 1 << 12
    const _CLIENT_TRANSACTIONS: u32 = 8192; // 1 << 13
    const _CLIENT_RESERVED: u32 = 16384; // 1 << 14
    const _CLIENT_SECURE_CONNECTION: u32 = 32768; // 1 << 15
    const _CLIENT_MULTI_STATEMENTS: u32 = 65536; // 1 << 16
    const _CLIENT_MULTI_RESULTS: u32 = 131072; // 1 << 17
    const _CLIENT_PS_MULTI_RESULTS: u32 = 262144; // 1 << 18
    const _CLIENT_PLUGIN_AUTH: u32 = 524288; // 1 << 19
    const _CLIENT_CONNECT_ATTRS: u32 = 1048576; // 1 << 20
    const _CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA: u32 = 2097152; // 1 << 21
    const _CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS: u32 = 4194304; // 1 << 22
    const _CLIENT_SESSION_TRACK: u32 = 8388608; // 1 << 23
    const _CLIENT_DEPRECATE_EOF: u32 = 16777216; // 1 << 24
    const _CLIENT_OPTIONAL_RESULTSET_METADATA: u32 = 33554432; // 1 << 25
    const _CLIENT_ZSTD_COMPRESSION_ALGORITHM: u32 = 67108864; // 1 << 26
    const _CLIENT_QUERY_ATTRIBUTES: u32 = 134217728; // 1 << 27
    const _MULTI_FACTOR_AUTHENTICATION: u32 = 268435456; // 1 << 28
    const _CLIENT_CAPABILITY_EXTENSION: u32 = 536870912; // 1 << 29
    const _CLIENT_SSL_VERIFY_SERVER_CERT: u32 = 1073741824; // 1 << 30
    const _CLIENT_REMEMBER_OPTIONS: u32 = 2147483648; // 1 << 31

    // PORT NOTE: the Zig `comptime { _ = .{...} }` block only force-referenced
    // the constants above; dropped per PORTING.md §Don't translate.

    pub fn reject(&mut self) {
        self.CLIENT_ZSTD_COMPRESSION_ALGORITHM = false;
        self.MULTI_FACTOR_AUTHENTICATION = false;
        self.CLIENT_CAPABILITY_EXTENSION = false;
        self.CLIENT_SSL_VERIFY_SERVER_CERT = false;
        self.CLIENT_REMEMBER_OPTIONS = false;
        self.CLIENT_COMPRESS = false;
        self.CLIENT_INTERACTIVE = false;
        self.CLIENT_IGNORE_SIGPIPE = false;
        self.CLIENT_NO_SCHEMA = false;
        self.CLIENT_ODBC = false;
        self.CLIENT_LOCAL_FILES = false;
        self.CLIENT_OPTIONAL_RESULTSET_METADATA = false;
        self.CLIENT_QUERY_ATTRIBUTES = false;
    }

    pub fn to_int(self) -> u32 {
        let mut value: u32 = 0;

        // PORT NOTE: unrolled `inline for (fields) |field| { if @field(this, field) value |= @field(Capabilities, "_" ++ field) }`
        if self.CLIENT_LONG_PASSWORD {
            value |= Self::_CLIENT_LONG_PASSWORD;
        }
        if self.CLIENT_FOUND_ROWS {
            value |= Self::_CLIENT_FOUND_ROWS;
        }
        if self.CLIENT_LONG_FLAG {
            value |= Self::_CLIENT_LONG_FLAG;
        }
        if self.CLIENT_CONNECT_WITH_DB {
            value |= Self::_CLIENT_CONNECT_WITH_DB;
        }
        if self.CLIENT_NO_SCHEMA {
            value |= Self::_CLIENT_NO_SCHEMA;
        }
        if self.CLIENT_COMPRESS {
            value |= Self::_CLIENT_COMPRESS;
        }
        if self.CLIENT_ODBC {
            value |= Self::_CLIENT_ODBC;
        }
        if self.CLIENT_LOCAL_FILES {
            value |= Self::_CLIENT_LOCAL_FILES;
        }
        if self.CLIENT_IGNORE_SPACE {
            value |= Self::_CLIENT_IGNORE_SPACE;
        }
        if self.CLIENT_PROTOCOL_41 {
            value |= Self::_CLIENT_PROTOCOL_41;
        }
        if self.CLIENT_INTERACTIVE {
            value |= Self::_CLIENT_INTERACTIVE;
        }
        if self.CLIENT_SSL {
            value |= Self::_CLIENT_SSL;
        }
        if self.CLIENT_IGNORE_SIGPIPE {
            value |= Self::_CLIENT_IGNORE_SIGPIPE;
        }
        if self.CLIENT_TRANSACTIONS {
            value |= Self::_CLIENT_TRANSACTIONS;
        }
        if self.CLIENT_RESERVED {
            value |= Self::_CLIENT_RESERVED;
        }
        if self.CLIENT_SECURE_CONNECTION {
            value |= Self::_CLIENT_SECURE_CONNECTION;
        }
        if self.CLIENT_MULTI_STATEMENTS {
            value |= Self::_CLIENT_MULTI_STATEMENTS;
        }
        if self.CLIENT_MULTI_RESULTS {
            value |= Self::_CLIENT_MULTI_RESULTS;
        }
        if self.CLIENT_PS_MULTI_RESULTS {
            value |= Self::_CLIENT_PS_MULTI_RESULTS;
        }
        if self.CLIENT_PLUGIN_AUTH {
            value |= Self::_CLIENT_PLUGIN_AUTH;
        }
        if self.CLIENT_CONNECT_ATTRS {
            value |= Self::_CLIENT_CONNECT_ATTRS;
        }
        if self.CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA {
            value |= Self::_CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA;
        }
        if self.CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS {
            value |= Self::_CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS;
        }
        if self.CLIENT_SESSION_TRACK {
            value |= Self::_CLIENT_SESSION_TRACK;
        }
        if self.CLIENT_DEPRECATE_EOF {
            value |= Self::_CLIENT_DEPRECATE_EOF;
        }
        if self.CLIENT_OPTIONAL_RESULTSET_METADATA {
            value |= Self::_CLIENT_OPTIONAL_RESULTSET_METADATA;
        }
        if self.CLIENT_ZSTD_COMPRESSION_ALGORITHM {
            value |= Self::_CLIENT_ZSTD_COMPRESSION_ALGORITHM;
        }
        if self.CLIENT_QUERY_ATTRIBUTES {
            value |= Self::_CLIENT_QUERY_ATTRIBUTES;
        }
        if self.MULTI_FACTOR_AUTHENTICATION {
            value |= Self::_MULTI_FACTOR_AUTHENTICATION;
        }
        if self.CLIENT_CAPABILITY_EXTENSION {
            value |= Self::_CLIENT_CAPABILITY_EXTENSION;
        }
        if self.CLIENT_SSL_VERIFY_SERVER_CERT {
            value |= Self::_CLIENT_SSL_VERIFY_SERVER_CERT;
        }
        if self.CLIENT_REMEMBER_OPTIONS {
            value |= Self::_CLIENT_REMEMBER_OPTIONS;
        }

        value
    }

    pub fn from_int(flags: u32) -> Capabilities {
        // PORT NOTE: unrolled `inline for (std.meta.fieldNames(Capabilities)) |field| { @field(this, field) = (_CONST & flags) != 0 }`
        Capabilities {
            CLIENT_LONG_PASSWORD: (Self::_CLIENT_LONG_PASSWORD & flags) != 0,
            CLIENT_FOUND_ROWS: (Self::_CLIENT_FOUND_ROWS & flags) != 0,
            CLIENT_LONG_FLAG: (Self::_CLIENT_LONG_FLAG & flags) != 0,
            CLIENT_CONNECT_WITH_DB: (Self::_CLIENT_CONNECT_WITH_DB & flags) != 0,
            CLIENT_NO_SCHEMA: (Self::_CLIENT_NO_SCHEMA & flags) != 0,
            CLIENT_COMPRESS: (Self::_CLIENT_COMPRESS & flags) != 0,
            CLIENT_ODBC: (Self::_CLIENT_ODBC & flags) != 0,
            CLIENT_LOCAL_FILES: (Self::_CLIENT_LOCAL_FILES & flags) != 0,
            CLIENT_IGNORE_SPACE: (Self::_CLIENT_IGNORE_SPACE & flags) != 0,
            CLIENT_PROTOCOL_41: (Self::_CLIENT_PROTOCOL_41 & flags) != 0,
            CLIENT_INTERACTIVE: (Self::_CLIENT_INTERACTIVE & flags) != 0,
            CLIENT_SSL: (Self::_CLIENT_SSL & flags) != 0,
            CLIENT_IGNORE_SIGPIPE: (Self::_CLIENT_IGNORE_SIGPIPE & flags) != 0,
            CLIENT_TRANSACTIONS: (Self::_CLIENT_TRANSACTIONS & flags) != 0,
            CLIENT_RESERVED: (Self::_CLIENT_RESERVED & flags) != 0,
            CLIENT_SECURE_CONNECTION: (Self::_CLIENT_SECURE_CONNECTION & flags) != 0,
            CLIENT_MULTI_STATEMENTS: (Self::_CLIENT_MULTI_STATEMENTS & flags) != 0,
            CLIENT_MULTI_RESULTS: (Self::_CLIENT_MULTI_RESULTS & flags) != 0,
            CLIENT_PS_MULTI_RESULTS: (Self::_CLIENT_PS_MULTI_RESULTS & flags) != 0,
            CLIENT_PLUGIN_AUTH: (Self::_CLIENT_PLUGIN_AUTH & flags) != 0,
            CLIENT_CONNECT_ATTRS: (Self::_CLIENT_CONNECT_ATTRS & flags) != 0,
            CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA: (Self::_CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA
                & flags)
                != 0,
            CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS: (Self::_CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS
                & flags)
                != 0,
            CLIENT_SESSION_TRACK: (Self::_CLIENT_SESSION_TRACK & flags) != 0,
            CLIENT_DEPRECATE_EOF: (Self::_CLIENT_DEPRECATE_EOF & flags) != 0,
            CLIENT_OPTIONAL_RESULTSET_METADATA: (Self::_CLIENT_OPTIONAL_RESULTSET_METADATA & flags)
                != 0,
            CLIENT_ZSTD_COMPRESSION_ALGORITHM: (Self::_CLIENT_ZSTD_COMPRESSION_ALGORITHM & flags)
                != 0,
            CLIENT_QUERY_ATTRIBUTES: (Self::_CLIENT_QUERY_ATTRIBUTES & flags) != 0,
            MULTI_FACTOR_AUTHENTICATION: (Self::_MULTI_FACTOR_AUTHENTICATION & flags) != 0,
            CLIENT_CAPABILITY_EXTENSION: (Self::_CLIENT_CAPABILITY_EXTENSION & flags) != 0,
            CLIENT_SSL_VERIFY_SERVER_CERT: (Self::_CLIENT_SSL_VERIFY_SERVER_CERT & flags) != 0,
            CLIENT_REMEMBER_OPTIONS: (Self::_CLIENT_REMEMBER_OPTIONS & flags) != 0,
        }
    }

    /// Returns the intersection of two capability sets (AND).
    /// Per MySQL protocol, the client should only request capabilities
    /// that the server also advertises.
    pub fn intersect(self, other: Capabilities) -> Capabilities {
        Self::from_int(self.to_int() & other.to_int())
    }

    pub fn get_default_capabilities(ssl: bool, has_db_name: bool) -> Capabilities {
        Capabilities {
            CLIENT_PROTOCOL_41: true,
            CLIENT_PLUGIN_AUTH: true,
            CLIENT_SECURE_CONNECTION: true,
            CLIENT_CONNECT_WITH_DB: has_db_name,
            CLIENT_DEPRECATE_EOF: true,
            CLIENT_SSL: ssl,
            CLIENT_MULTI_STATEMENTS: true,
            CLIENT_MULTI_RESULTS: true,
            ..Default::default()
        }
    }
}

// Zig: pub fn format(self, writer: *std.Io.Writer) !void
impl fmt::Display for Capabilities {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut first = true;
        // PORT NOTE: unrolled `inline for (std.meta.fieldNames(Capabilities)) |field| { if @field(self, field) { ... writer.writeAll(field) } }`
        macro_rules! emit {
            ($field:ident) => {
                if self.$field {
                    if !first {
                        f.write_str(", ")?;
                    }
                    first = false;
                    f.write_str(stringify!($field))?;
                }
            };
        }
        emit!(CLIENT_LONG_PASSWORD);
        emit!(CLIENT_FOUND_ROWS);
        emit!(CLIENT_LONG_FLAG);
        emit!(CLIENT_CONNECT_WITH_DB);
        emit!(CLIENT_NO_SCHEMA);
        emit!(CLIENT_COMPRESS);
        emit!(CLIENT_ODBC);
        emit!(CLIENT_LOCAL_FILES);
        emit!(CLIENT_IGNORE_SPACE);
        emit!(CLIENT_PROTOCOL_41);
        emit!(CLIENT_INTERACTIVE);
        emit!(CLIENT_SSL);
        emit!(CLIENT_IGNORE_SIGPIPE);
        emit!(CLIENT_TRANSACTIONS);
        emit!(CLIENT_RESERVED);
        emit!(CLIENT_SECURE_CONNECTION);
        emit!(CLIENT_MULTI_STATEMENTS);
        emit!(CLIENT_MULTI_RESULTS);
        emit!(CLIENT_PS_MULTI_RESULTS);
        emit!(CLIENT_PLUGIN_AUTH);
        emit!(CLIENT_CONNECT_ATTRS);
        emit!(CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA);
        emit!(CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS);
        emit!(CLIENT_SESSION_TRACK);
        emit!(CLIENT_DEPRECATE_EOF);
        emit!(CLIENT_OPTIONAL_RESULTSET_METADATA);
        emit!(CLIENT_ZSTD_COMPRESSION_ALGORITHM);
        emit!(CLIENT_QUERY_ATTRIBUTES);
        emit!(MULTI_FACTOR_AUTHENTICATION);
        emit!(CLIENT_CAPABILITY_EXTENSION);
        emit!(CLIENT_SSL_VERIFY_SERVER_CERT);
        emit!(CLIENT_REMEMBER_OPTIONS);
        let _ = first;
        Ok(())
    }
}

// ported from: src/sql/mysql/Capabilities.zig
