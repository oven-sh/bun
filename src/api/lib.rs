#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]
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
//! `bun_options_types::context::install` vs. `bun_ini::load_npmrc_config`),
//! which type-errors despite identical field layout. The canonical definitions
//! now live in `bun_options_types::schema::api` (the lower / shared crate);
//! this crate re-exports them so existing `bun_api::*` paths keep compiling and
//! there is exactly one `BunInstall` in the type graph.
//!
//! When the peechy `.rs` codegen lands it should overwrite/append to
//! `bun_options_types::schema::api` wholesale — keep additions append-only and
//! field-order-faithful so the diff stays reviewable.

// ──────────────────────────────────────────────────────────────────────────
// Re-exports — canonical definitions live in `bun_options_types::schema::api`.
// ──────────────────────────────────────────────────────────────────────────

#![warn(unreachable_pub)]
pub use bun_options_types::schema::api::{
    BunInstall, Ca, NodeLinker, NpmRegistry, NpmRegistryMap, PnpmMatcher,
};

// ──────────────────────────────────────────────────────────────────────────
// npm_registry  — module path for the nested `NpmRegistry::Parser`
// ──────────────────────────────────────────────────────────────────────────

/// Zig nests `pub const Parser = struct {…}` inside `NpmRegistry`. Rust can't
/// nest a type inside a struct, so it lives in a sibling module and the
/// canonical path becomes `bun_api::npm_registry::Parser`.
pub mod npm_registry {
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
                registry.url = url.href_without_auth();
            } else if !url.username.is_empty() && !url.password.is_empty() {
                registry.username = Box::<[u8]>::from(url.username);
                registry.password = Box::<[u8]>::from(url.password);

                registry.url = url.href_without_auth();
            } else {
                // Do not include a trailing slash. There might be parameters at the end.
                registry.url = Box::<[u8]>::from(url.href);
            }

            Ok(registry)
        }
    }
}

// ported from: src/options_types/schema.zig
