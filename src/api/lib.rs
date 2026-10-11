#![warn(unused_must_use)]
//! Re-exports of the install config types (`BunInstall`, `NpmRegistry`, …)
//! whose canonical definitions live in `bun_options_types::schema::api`.

pub use bun_options_types::schema::api::{
    BunInstall, Ca, NodeLinker, NpmRegistry, NpmRegistryMap, NpmUrlAuth, PnpmMatcher,
};
