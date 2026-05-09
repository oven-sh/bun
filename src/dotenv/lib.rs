#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use)]

#![warn(unreachable_pub)]
pub mod env_loader;

pub use env_loader::{
    instance, set_instance, DirEntryProbe, DotEnvBehavior, DotEnvFileSuffix, HashTable,
    HashTableValue, Kind, Loader, Map, Mode, NullDelimitedEnvMap, S3Credentials, StdEnvMapWrapper,
    Value, HAS_NO_CLEAR_SCREEN_CLI_FLAG, INSTANCE,
};

// `Loader::copy_for_define` (T2) inserts into bundler-owned `DefineData` /
// `RawDefines` maps (T5). Variants live in `bun_bundler::defines`.
bun_dispatch::link_interface! {
    pub DefineStore[String, Json] {
        fn contains(key: &[u8]) -> bool;
        fn put_string_define(key: &[u8], value: &[u8]) -> Result<(), bun_core::Error>;
        fn put_raw(key: &[u8], value: &[u8]) -> Result<(), bun_core::Error>;
    }
}

/// `dotenv::map::{HashTable, Entry}` namespace expected by `install_jsc::ini_jsc` et al.
/// Thin re-export module so callers can name the storage type without reaching into
/// `env_loader` directly.
pub mod map {
    pub use crate::env_loader::{HashTable, HashTableValue as Entry};
}
