//! Storage for hashed assets on `/_bun/asset/{hash}.ext`
//!
//! Spec: src/runtime/bake/DevServer/Assets.zig
//!
//! DISSOLVED — the Phase-A draft that lived here duplicated `Assets` and
//! `EntryIndex` against `dev_server/assets.rs`, with no call sites resolving
//! to this module (`DevServer.assets` is typed as the canonical
//! `dev_server::assets::Assets`). The duplicate carried two divergences:
//!
//!   1. `owner()` computed `container_of` against the *body-module* `Assets`
//!      struct, but `DevServer.assets` is typed `dev_server::assets::Assets`;
//!      the `offset_of!` subtraction was UB on the unrelated draft type.
//!   2. `replace_path` widened its error type to `bun_core::Error` where the
//!      spec only fails on allocation; the canonical module narrows to
//!      `bun_alloc::AllocError` per `Assets.zig`.
//!
//! Every spec method (`getHash`, `replacePath`, `putOrIncrementRefCount`,
//! `unrefByHash`, `unrefByIndex`, `unrefByPath`, `reindexIfNeeded`, `get`,
//! `deinit`, `memoryCost`) is fully ported in the canonical module. This file
//! is no longer mounted (`dev_server/mod.rs` dropped the `#[path]` entry); it
//! remains on disk only as the `.rs` sibling of `Assets.zig` per PORTING.md.

#![allow(unused_imports)]
#![warn(unused_must_use)]

pub use crate::bake::dev_server::assets::{Assets, EntryIndex};
