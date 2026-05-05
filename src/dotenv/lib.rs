#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]

pub mod env_loader;

pub use env_loader::{
    DefineStoreRef, DefineStoreVTable, DotEnvFileSuffix, HashTableValue, Loader, Map, INSTANCE,
};
