#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
//
// B-1 gate-and-stub: Phase-A draft bodies are preserved on disk but gated behind
// `#[cfg(any())]` so they do not participate in compilation. Each gated module is
// shadowed by an inline stub exposing the minimal surface needed by sibling crates.
// Un-gating happens in B-2.

macro_rules! gated_mod {
    ($name:ident, $path:literal) => {
        #[cfg(any())]
        #[path = $path]
        pub mod $name;
        #[cfg(not(any()))]
        pub mod $name {}
    };
    ($name:ident, $path:literal, { $($body:tt)* }) => {
        #[cfg(any())]
        #[path = $path]
        pub mod $name;
        #[cfg(not(any()))]
        pub mod $name { $($body)* }
    };
}

// ─── top-level modules (all gated) ─────────────────────────────────────────
gated_mod!(properties, "properties/mod.rs");
gated_mod!(rules, "rules/mod.rs");
gated_mod!(values, "values/mod.rs");
gated_mod!(selectors, "selectors/selector.rs");
gated_mod!(logical, "logical.rs");
gated_mod!(sourcemap, "sourcemap.rs");
gated_mod!(compat, "compat.rs");
gated_mod!(dependencies, "dependencies.rs");
gated_mod!(context, "context.rs");
gated_mod!(targets, "targets.rs");
gated_mod!(error, "error.rs");
gated_mod!(css_modules, "css_modules.rs");
gated_mod!(declaration, "declaration.rs");
gated_mod!(printer, "printer.rs");
gated_mod!(generics, "generics.rs");
gated_mod!(small_list, "small_list.rs");
gated_mod!(media_query, "media_query.rs");
gated_mod!(prefixes, "prefixes.rs");
gated_mod!(css_parser, "css_parser.rs");

// ─── stub re-exports referenced cross-crate ────────────────────────────────
// TODO(b1): real types come back when modules are un-gated in B-2.
pub type Printer = ();
pub type PrintErr = ();
pub type Dependency = ();
pub type CustomMedia = ();
