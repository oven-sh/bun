//! Packed source mapping data for a single file.
//! Owned by one IncrementalGraph file and/or multiple SourceMapStore entries.
//!
//! DISSOLVED — the Phase-A draft that lived here duplicated `PackedMap`,
//! `Shared`, `LineCount`, and `EndState` against `dev_server/packed_map.rs`.
//! Its sole consumer was the (also dissolved) `source_map_store_body` module
//! via `use super::packed_map_body as packed_map`. This file is no longer
//! mounted (`dev_server/mod.rs` dropped the `#[path]` entry); it remains on
//! disk only as a stub.

#![allow(unused_imports)]
#![warn(unused_must_use)]

pub use crate::bake::dev_server::packed_map::{EndState, LineCount, PackedMap, Shared};
