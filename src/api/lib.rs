#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]

// ──────────────────────────────────────────────────────────────────────────
// Re-exports — canonical definitions live in `bun_options_types::schema::api`.
// ──────────────────────────────────────────────────────────────────────────

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
