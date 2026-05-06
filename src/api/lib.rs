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
    use std::io::Write as _;

    use bun_string::strings;
    use bun_url::URL;

    pub use super::NpmRegistry;

    // PORT NOTE: `Parser` stays generic over `L` (Log) / `S` (Source) so this
    // leaf schema crate doesn't need to name `bun_logger`. The lone live body
    // (`parse_registry_url_string_impl`) doesn't touch log/source — only the
    // not-yet-ported `parse_registry_object` / `parse_registry` paths do, and
    // those need `js_ast::Expr` so they belong upstream in the bunfig parser
    // anyway.
    pub struct Parser<'a, L, S> {
        pub log: &'a mut L,
        pub source: &'a S,
    }

    impl<'a, L, S> Parser<'a, L, S> {
        pub fn parse_registry_url_string_impl(
            &mut self,
            str: &[u8],
        ) -> Result<NpmRegistry, bun_alloc::AllocError> {
            let url = URL::parse(str);
            let mut registry = NpmRegistry::default();

            // Token
            if url.username.is_empty() && !url.password.is_empty() {
                registry.token = Box::<[u8]>::from(url.password);
                registry.url = format_url_without_auth(&url);
            } else if !url.username.is_empty() && !url.password.is_empty() {
                registry.username = Box::<[u8]>::from(url.username);
                registry.password = Box::<[u8]>::from(url.password);

                registry.url = format_url_without_auth(&url);
            } else {
                // Do not include a trailing slash. There might be parameters at the end.
                registry.url = Box::<[u8]>::from(url.href);
            }

            Ok(registry)
        }
    }

    /// Zig: `std.fmt.allocPrint(alloc, "{s}://{f}/{s}/", .{
    ///     url.displayProtocol(), url.displayHost(),
    ///     std.mem.trim(u8, url.pathname, "/") })`.
    ///
    /// `display_host()` yields a `bun_core::fmt::HostFormatter` (impls
    /// `Display`); the other two pieces are raw byte slices, so we assemble
    /// into a `Vec<u8>` directly rather than going through `format!` and
    /// risking lossy UTF-8 round-trips.
    fn format_url_without_auth(url: &URL<'_>) -> Box<[u8]> {
        let proto = url.display_protocol();
        let path = strings::trim(url.pathname, b"/");

        let mut buf: Vec<u8> = Vec::with_capacity(proto.len() + 3 + url.host.len() + 1 + path.len() + 1);
        buf.extend_from_slice(proto);
        buf.extend_from_slice(b"://");
        // io::Write on Vec<u8> is infallible.
        let _ = write!(&mut buf, "{}", url.display_host());
        buf.push(b'/');
        buf.extend_from_slice(path);
        buf.push(b'/');
        buf.into_boxed_slice()
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
