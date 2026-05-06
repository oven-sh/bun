#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! `bun.schema.api` namespace.
//!
//! Ground truth: `src/options_types/schema.zig` (the `pub const api = struct {…}`
//! block — generated from `src/api/schema.peechy`). The full peechy → `.rs`
//! emitter is not landed yet; this crate hand-ports the slice of the schema
//! that downstream crates name today (`bun_ini`, `bun_install`, `bun_runtime`
//! bunfig parser) so they can un-gate against real field shapes.
//!
//! When the peechy `.rs` codegen lands it should overwrite/append to this
//! file wholesale — keep additions append-only and field-order-faithful so the
//! diff stays reviewable.

use bun_collections::StringArrayHashMap;
use bun_install_types::NodeLinker::{NodeLinker, PnpmMatcher};

// ──────────────────────────────────────────────────────────────────────────
// NpmRegistry  (schema.zig:2807)
// ──────────────────────────────────────────────────────────────────────────

/// `api.NpmRegistry` — one npm registry endpoint + auth quad.
///
/// Zig stores arena-borrowed `[]const u8` slices; the Rust port owns each
/// field as `Box<[u8]>` (PORTING.md §Type-map: struct-field `[]const u8` whose
/// `deinit` frees → `Box<[u8]>`). `Default` ⇔ `std.mem.zeroes(NpmRegistry)`
/// (empty slices everywhere).
#[derive(Debug, Default, Clone)]
pub struct NpmRegistry {
    /// url
    pub url: Box<[u8]>,
    /// username
    pub username: Box<[u8]>,
    /// password
    pub password: Box<[u8]>,
    /// token
    pub token: Box<[u8]>,
    /// email
    pub email: Box<[u8]>,
}

impl NpmRegistry {
    /// `NpmRegistry.dupe(allocator)` — Zig packs all five strings into one
    /// contiguous allocation and reslices. Rust can't return five `Box<[u8]>`
    /// views into one buffer without leaking the backing alloc, so this is a
    /// plain field-wise clone.
    // PERF(port): single-buffer pack — profile in Phase B.
    pub fn dupe(&self) -> NpmRegistry {
        self.clone()
    }

    // TODO(port): `decode`/`encode` (peechy reader/writer) — blocked on the
    // schema Reader/Writer trait surface; no caller in the Rust tree yet.
}

// ──────────────────────────────────────────────────────────────────────────
// NpmRegistryMap  (schema.zig:2956)
// ──────────────────────────────────────────────────────────────────────────

/// `api.NpmRegistryMap` — scope name → registry. Zig:
/// `scopes: bun.StringArrayHashMapUnmanaged(NpmRegistry) = .{}`.
#[derive(Default)]
pub struct NpmRegistryMap {
    pub scopes: StringArrayHashMap<NpmRegistry>,
}

// ──────────────────────────────────────────────────────────────────────────
// Ca  (schema.zig:3043 — anonymous `union(enum)` field on BunInstall)
// ──────────────────────────────────────────────────────────────────────────

/// `BunInstall.ca` payload. Zig declares this inline as
/// `?union(enum) { str: []const u8, list: []const []const u8 }`; Rust hoists
/// it to a named type so callers can construct it (`bun_api::Ca::Str(..)`).
#[derive(Debug)]
pub enum Ca {
    Str(Box<[u8]>),
    List(Box<[Box<[u8]>]>),
}

// ──────────────────────────────────────────────────────────────────────────
// BunInstall  (schema.zig:2973)
// ──────────────────────────────────────────────────────────────────────────

/// `api.BunInstall` — the merged install configuration assembled from
/// `bunfig.toml` + `.npmrc` + CLI flags. Field order mirrors the Zig struct
/// exactly so side-by-side diff stays readable.
///
/// `Default` ⇔ `std.mem.zeroes(Api.BunInstall)` (every field `None` / empty).
#[derive(Default)]
pub struct BunInstall {
    /// default_registry
    pub default_registry: Option<NpmRegistry>,

    /// scoped
    pub scoped: Option<NpmRegistryMap>,

    /// lockfile_path
    pub lockfile_path: Option<Box<[u8]>>,

    /// save_lockfile_path
    pub save_lockfile_path: Option<Box<[u8]>>,

    /// cache_directory
    pub cache_directory: Option<Box<[u8]>>,

    /// dry_run
    pub dry_run: Option<bool>,

    /// force
    pub force: Option<bool>,

    /// save_dev
    pub save_dev: Option<bool>,

    /// save_optional
    pub save_optional: Option<bool>,

    /// save_peer
    pub save_peer: Option<bool>,

    /// save_lockfile
    pub save_lockfile: Option<bool>,

    /// production
    pub production: Option<bool>,

    /// save_yarn_lockfile
    pub save_yarn_lockfile: Option<bool>,

    /// native_bin_links
    pub native_bin_links: Vec<Box<[u8]>>,

    /// disable_cache
    pub disable_cache: Option<bool>,

    /// disable_manifest_cache
    pub disable_manifest_cache: Option<bool>,

    /// global_dir
    pub global_dir: Option<Box<[u8]>>,

    /// global_bin_dir
    pub global_bin_dir: Option<Box<[u8]>>,

    /// frozen_lockfile
    pub frozen_lockfile: Option<bool>,

    /// exact
    pub exact: Option<bool>,

    /// concurrent_scripts
    pub concurrent_scripts: Option<u32>,

    pub cafile: Option<Box<[u8]>>,

    pub save_text_lockfile: Option<bool>,

    pub ca: Option<Ca>,

    pub ignore_scripts: Option<bool>,

    pub link_workspace_packages: Option<bool>,

    pub node_linker: Option<NodeLinker>,

    pub global_store: Option<bool>,

    pub security_scanner: Option<Box<[u8]>>,

    pub minimum_release_age_ms: Option<f64>,
    pub minimum_release_age_excludes: Option<Vec<Box<[u8]>>>,

    pub public_hoist_pattern: Option<PnpmMatcher>,
    pub hoist_pattern: Option<PnpmMatcher>,
}

// ──────────────────────────────────────────────────────────────────────────
// npm_registry  — module path for the nested `NpmRegistry::Parser`
// ──────────────────────────────────────────────────────────────────────────

/// Zig nests `pub const Parser = struct {…}` inside `NpmRegistry`. Rust can't
/// nest a type inside a struct, so it lives in a sibling module and the
/// canonical path becomes `bun_api::npm_registry::Parser`.
pub mod npm_registry {
    pub use super::NpmRegistry;

    // TODO(b2-blocked): bun_logger::Log / bun_logger::Source / bun_url::URL
    //
    // The `Parser` body (`parse_registry_url_string_impl` /
    // `parse_registry_object` / `parse_registry`) needs `bun_logger` and
    // `bun_url`, which would drag tier-2+ deps into this leaf schema crate.
    // The struct + method *signatures* are provided so downstream
    // `bun_ini::ScopeIterator` / `load_npmrc` can name them; bodies are
    // `todo!()` until the URL/log surface is wired (or the parser moves up to
    // a crate that already has those deps).
    pub struct Parser<'a, L, S> {
        pub log: &'a mut L,
        pub source: &'a S,
    }

    impl<'a, L, S> Parser<'a, L, S> {
        pub fn parse_registry_url_string_impl(
            &mut self,
            _str: &[u8],
        ) -> Result<NpmRegistry, bun_alloc::AllocError> {
            // TODO(b2-blocked): bun_url::URL::parse + allocPrint port
            todo!("npm_registry::Parser::parse_registry_url_string_impl — blocked on bun_url in bun_api")
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/options_types/schema.zig  api.{NpmRegistry, NpmRegistryMap,
//               BunInstall} + inline `ca` union (lines ~2807–3070)
//   confidence: high (data shapes) / low (npm_registry::Parser bodies)
//   todos:      3
//   notes:      Hand-port of the install-config slice of the peechy schema so
//               bun_ini / bun_install can un-gate. `decode`/`encode` and the
//               registry-URL Parser stay stubbed pending the schema
//               Reader/Writer trait + bun_url wiring. Full peechy `.rs`
//               codegen replaces this file when it lands.
// ──────────────────────────────────────────────────────────────────────────
