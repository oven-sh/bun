#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
//! Re-exports of the install config types (`BunInstall`, `NpmRegistry`, …)
//! whose canonical definitions live in `bun_options_types::schema::api`, plus
//! the `Parser` handle used by the bunfig and npmrc loaders.

// ──────────────────────────────────────────────────────────────────────────
// Re-exports — canonical definitions live in `bun_options_types::schema::api`.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_options_types::schema::api::{
    BunInstall, Ca, NodeLinker, NpmRegistry, NpmRegistryMap, NpmUrlAuth, PnpmMatcher,
};

// ──────────────────────────────────────────────────────────────────────────
// npm_registry  — module path for the nested `NpmRegistry::Parser`
// ──────────────────────────────────────────────────────────────────────────

/// `Parser` lives in a sibling module of `NpmRegistry`; the canonical path
/// is `bun_api::npm_registry::Parser`.
pub mod npm_registry {
    pub use super::NpmRegistry;

    // `Parser` stays generic over `L` (Log) / `S` (Source) so this leaf
    // schema crate doesn't need to name `bun_logger`. The lone live body
    // (`parse_registry_url_string_impl`) doesn't touch log/source — only
    // `parse_registry_object` / `parse_registry` would, and those need
    // `js_ast::Expr` so they belong upstream in the bunfig parser anyway.
    pub struct Parser<'a, L, S> {
        pub log: &'a mut L,
        pub source: &'a S,
    }

    impl<'a, L, S> Parser<'a, L, S> {
        pub fn parse_registry_url_string_impl(
            &mut self,
            str: &[u8],
        ) -> Result<NpmRegistry, bun_alloc::AllocError> {
            Ok(NpmRegistry::from_url(str))
        }
    }
}
