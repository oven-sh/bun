//! Storage for source maps on `/_bun/client/{id}.js.map`
//!
//! Spec: src/runtime/bake/DevServer/SourceMapStore.zig
//!
//! DISSOLVED — the Phase-A draft that lived here duplicated every public type
//! (`Key`, `SourceId`, `Entry`, `WeakRef`, `SourceMapStore`, `GetResult`, …)
//! against `dev_server/source_map_store.rs`, with no call sites resolving to
//! this module. The duplicate carried three spec divergences:
//!
//!   1. `owner()` computed `container_of` against the *body-module* struct,
//!      but `DevServer.source_maps` is typed `dev_server::source_map_store::
//!      SourceMapStore`; the pointer subtraction was UB.
//!   2. `impl Drop for Entry` asserted `ref_count == 0`, which the Zig spec
//!      only checks on the explicit `unrefAtIndex` release path — store
//!      teardown and `*gop.value_ptr = Entry { .. }` overwrites legitimately
//!      drop nonzero counts.
//!   3. `Entry.paths: Box<[&'static [u8]]>` lied about the inner-slice
//!      lifetime (borrowed from IncrementalGraph, not `'static`).
//!
//! All three are fixed in the canonical module. This file is no longer mounted
//! (`dev_server/mod.rs` dropped the `#[path]` entry); it remains on disk only
//! as the `.rs` sibling of `SourceMapStore.zig` per PORTING.md, and re-exports
//! the canonical items so any stale `super::source_map_store_body::*` path
//! that reappears resolves to the single real type.

#![allow(unused_imports)]
#![warn(unused_must_use)]

pub use crate::bake::dev_server::source_map_store::{
    EncodeSourceMapPathError, Entry, EntryIndex, GetResult, Key, LocateWeakRefResult,
    PutOrIncrementRefCount, RemoveOrUpgradeMode, SourceId, SourceMapStore, WeakRef,
    WEAK_REF_ENTRY_MAX, WEAK_REF_EXPIRY_SECONDS,
};
