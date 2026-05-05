#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// Phase-A draft bodies preserved on disk; gated until B-2 un-gating.
// TODO(b1): bun_jsc, bun_str, bun_runtime, thiserror crates missing from workspace deps;
// TODO(b1): bun_js_parser::{ExprData, E::*, G::*, S::*} stub surface incomplete;
// TODO(b1): bun_resolver::{package_json::MacroImportReplacementMap, package_json::MacroMap, resolver} missing;
// TODO(b1): bun_bundler::entry_points missing.
#[cfg(any())]
#[path = "expr_jsc.rs"]
pub mod expr_jsc;
#[cfg(any())]
#[path = "Macro.rs"]
pub mod Macro;

// ---- minimal stub surface (B-1) ----

#[cfg(not(any()))]
pub mod expr_jsc {
    #[derive(Debug)]
    pub struct ToJSError(());
}

#[cfg(not(any()))]
pub mod Macro {
    pub const NAMESPACE: &[u8] = b"macro";
    pub const NAMESPACE_WITH_COLON: &[u8] = b"macro:";

    pub fn is_macro_path(str: &[u8]) -> bool {
        // TODO(b1): bun_string::has_prefix_comptime missing from stub surface
        str.len() >= NAMESPACE_WITH_COLON.len()
            && &str[..NAMESPACE_WITH_COLON.len()] == NAMESPACE_WITH_COLON
    }

    pub struct MacroContext<'a>(core::marker::PhantomData<&'a ()>);
    pub type MacroMap<'a> = bun_collections::ArrayHashMap<i32, Macro<'a>>;
    pub struct Macro<'a>(core::marker::PhantomData<&'a ()>);
    pub struct MacroResult(());
    pub struct Runner;
    #[derive(Debug)]
    pub enum MacroError {}
    pub struct Run<'a>(core::marker::PhantomData<&'a ()>);
}
