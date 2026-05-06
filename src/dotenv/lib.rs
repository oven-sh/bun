#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]

pub mod env_loader;

pub use env_loader::{
<<<<<<< Updated upstream
    instance, set_instance, DefineStoreRef, DefineStoreVTable, DotEnvBehavior, DotEnvFileSuffix,
    HashTable, HashTableValue, Kind, Loader, Map, Mode, NullDelimitedEnvMap, S3Credentials,
    StdEnvMapWrapper, Value, HAS_NO_CLEAR_SCREEN_CLI_FLAG, INSTANCE,
||||||| Stash base
    DefineStoreRef, DefineStoreVTable, DotEnvFileSuffix, HashTableValue, Loader, Map,
    NullDelimitedEnvMap, StdEnvMapWrapper, HAS_NO_CLEAR_SCREEN_CLI_FLAG, INSTANCE,
=======
    DefineStoreRef, DefineStoreVTable, DotEnvBehavior, DotEnvFileSuffix, HashTableValue, Loader,
    Map, NullDelimitedEnvMap, StdEnvMapWrapper, HAS_NO_CLEAR_SCREEN_CLI_FLAG, INSTANCE,
>>>>>>> Stashed changes
};

/// `dotenv::map::{HashTable, Entry}` namespace expected by `install_jsc::ini_jsc` et al.
/// Thin re-export module so callers can name the storage type without reaching into
/// `env_loader` directly.
pub mod map {
    pub use crate::env_loader::{HashTable, HashTableValue as Entry};
}
