//! Errors sent to the HMR client in the browser are serialized. The same format
//! is used for thrown JavaScript exceptions as well as bundler errors.
//! Serialized failures contain a handle on what file or route they came from,
//! which allows the bundler to dismiss or update stale failures via index as
//! opposed to re-sending a new payload.
//!
//! Spec: src/runtime/bake/DevServer/SerializedFailure.zig
//!
//! DISSOLVED — the Phase-A draft that lived here duplicated `SerializedFailure`,
//! `Owner`, `Packed`, `PackedKind`, `ErrorKind`, and the `write_*` helpers
//! against `dev_server/serialized_failure.rs`, with no call sites resolving to
//! this module (`dev_server/mod.rs` never mounted it; every `DevServer.rs`
//! reference already uses the canonical snake_case module). The dup carried one
//! signature divergence — `init_from_log` took an unused `_dev: &mut DevServer`
//! first param the canonical already dropped — and was otherwise byte-identical.
//!
//! This file is no longer mounted; it remains on disk only as the `.rs` sibling
//! of `SerializedFailure.zig` per PORTING.md, and re-exports the canonical items
//! so any stale `super::serialized_failure_body::*` path that reappears resolves
//! to the single real type.

#![allow(unused_imports)]
#![warn(unused_must_use)]

pub use crate::bake::dev_server::serialized_failure::{
    ArrayHashAdapter, ArrayHashContextViaOwner, ErrorKind, Owner, OwnerPacked, Packed, PackedKind,
    SerializedFailure,
};
