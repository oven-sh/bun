// MySQL capability flags
//
// Modeled as a plain struct of `bool` fields (NOT a `packed struct(u32)`-style
// bitfield). Field names stay SCREAMING_SNAKE_CASE because `Display` emits them
// verbatim. (non_snake_case / non_upper_case_globals allowed at crate root.)

use core::fmt;

macro_rules! capabilities {
    ($($name:ident = $bit:literal),* $(,)?) => {
        #[derive(Default, Clone, Copy, PartialEq, Eq)]
        pub struct Capabilities {
            $(pub $name: bool,)*
        }

        impl Capabilities {
            pub fn to_int(self) -> u32 {
                0 $(| ((self.$name as u32) << $bit))*
            }

            pub fn from_int(flags: u32) -> Capabilities {
                Capabilities {
                    $($name: (flags & (1u32 << $bit)) != 0,)*
                }
            }
        }

        impl fmt::Display for Capabilities {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                let mut first = true;
                $(
                    if self.$name {
                        if !first {
                            f.write_str(", ")?;
                        }
                        first = false;
                        f.write_str(stringify!($name))?;
                    }
                )*
                let _ = first;
                Ok(())
            }
        }
    };
}

// Bit positions from the MySQL protocol.
capabilities! {
    CLIENT_LONG_PASSWORD                   = 0,
    CLIENT_FOUND_ROWS                      = 1,
    CLIENT_LONG_FLAG                       = 2,
    CLIENT_CONNECT_WITH_DB                 = 3,
    CLIENT_NO_SCHEMA                       = 4,
    CLIENT_COMPRESS                        = 5,
    CLIENT_ODBC                            = 6,
    CLIENT_LOCAL_FILES                     = 7,
    CLIENT_IGNORE_SPACE                    = 8,
    CLIENT_PROTOCOL_41                     = 9,
    CLIENT_INTERACTIVE                     = 10,
    CLIENT_SSL                             = 11,
    CLIENT_IGNORE_SIGPIPE                  = 12,
    CLIENT_TRANSACTIONS                    = 13,
    CLIENT_RESERVED                        = 14,
    CLIENT_SECURE_CONNECTION               = 15,
    CLIENT_MULTI_STATEMENTS                = 16,
    CLIENT_MULTI_RESULTS                   = 17,
    CLIENT_PS_MULTI_RESULTS                = 18,
    CLIENT_PLUGIN_AUTH                     = 19,
    CLIENT_CONNECT_ATTRS                   = 20,
    CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA  = 21,
    CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS    = 22,
    CLIENT_SESSION_TRACK                   = 23,
    CLIENT_DEPRECATE_EOF                   = 24,
    CLIENT_OPTIONAL_RESULTSET_METADATA     = 25,
    CLIENT_ZSTD_COMPRESSION_ALGORITHM      = 26,
    CLIENT_QUERY_ATTRIBUTES                = 27,
    MULTI_FACTOR_AUTHENTICATION            = 28,
    CLIENT_CAPABILITY_EXTENSION            = 29,
    CLIENT_SSL_VERIFY_SERVER_CERT          = 30,
    CLIENT_REMEMBER_OPTIONS                = 31,
}

impl Capabilities {
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
