#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
//! `bun.schema.api` namespace.
//!
//! Ground truth: `src/options_types/schema.zig` (the `pub const api = struct {…}`
//! block — generated from `src/api/schema.peechy`). The full peechy → `.rs`
//! emitter is not landed yet; this crate hand-ports the slice of the schema
//! that downstream crates name today (`bun_ini`, `bun_install`, `bun_runtime`
//! bunfig parser) so they can un-gate against real field shapes.
//!
//! LAYERING: the actual data shapes (`NpmRegistry`, `NpmRegistryMap`, `Ca`,
//! `BunInstall`) were originally hand-ported in two places — here *and* in
//! `bun_options_types::schema::api`. Downstream crates ended up holding values
//! of one and passing them to functions typed against the other (e.g.
//! `bun_options_types::Context::install` vs. `bun_ini::load_npmrc_config`),
//! which type-errors despite identical field layout. The canonical definitions
//! now live in `bun_options_types::schema::api` (the lower / shared crate);
//! this crate re-exports them so existing `bun_api::*` paths keep compiling and
//! there is exactly one `BunInstall` in the type graph.
//!
//! When the peechy `.rs` codegen lands it should overwrite/append to
//! `bun_options_types::schema::api` wholesale — keep additions append-only and
//! field-order-faithful so the diff stays reviewable.

use bun_collections::StringArrayHashMap;
use bun_install_types::NodeLinker::{NodeLinker, PnpmMatcher};

// ──────────────────────────────────────────────────────────────────────────
// Re-exports — canonical definitions live in `bun_options_types::schema::api`.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_options_types::schema::api::{BunInstall, Ca, NpmRegistry, NpmRegistryMap};

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
//   confidence: high (data shapes re-exported + npm_registry::Parser url-string path)
//   todos:      1
//   notes:      Data shapes deduplicated against `bun_options_types::schema::api`
//               (single canonical type). `decode`/`encode` stay stubbed pending
//               the schema Reader/Writer trait. Full peechy `.rs` codegen
//               targets `bun_options_types::schema::api` when it lands.
// ──────────────────────────────────────────────────────────────────────────
