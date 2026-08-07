#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
//! Re-exports of the install config types (`BunInstall`, `NpmRegistry`, …)
//! whose canonical definitions live in `bun_options_types::schema::api`, plus
//! the registry-URL parser shared by the bunfig and npmrc loaders.

// ──────────────────────────────────────────────────────────────────────────
// Re-exports — canonical definitions live in `bun_options_types::schema::api`.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_options_types::schema::api::{
    BunInstall, Ca, NodeLinker, NpmRegistry, NpmRegistryMap, PnpmMatcher,
};

// ──────────────────────────────────────────────────────────────────────────
// npm_registry  — module path for the nested `NpmRegistry::Parser`
// ──────────────────────────────────────────────────────────────────────────

/// `Parser` lives in a sibling module of `NpmRegistry`; the canonical path
/// is `bun_api::npm_registry::Parser`.
pub mod npm_registry {
    use bun_url::URL;

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
