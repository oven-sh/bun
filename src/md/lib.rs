#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

pub mod types;
pub mod parser;
pub mod root;
pub mod helpers;
pub mod entity;
pub mod unicode;
#[cfg(any())] pub mod autolinks;
#[cfg(not(any()))] pub mod autolinks {} // TODO(b1): gated — uses EmphDelim fields

// ─── Phase-B1 gate-and-stub ────────────────────────────────────────────────
// The modules below carry Phase-A draft bodies that reference lower-tier
// stub surface not yet exposed (bun_str, bun_core::fmt, bun_jsc, etc.). They
// are gated behind `#[cfg(any())]` so the crate compiles; un-gating happens
// per-module in B-2 once their dependencies are filled in.
#[cfg(any())] pub mod render_blocks;
#[cfg(any())] pub mod containers;
#[cfg(any())] pub mod ref_defs;
#[cfg(any())] pub mod line_analysis;
#[cfg(any())] pub mod links;
#[cfg(any())] pub mod blocks;
#[cfg(any())] pub mod html_renderer;
#[cfg(any())] pub mod inlines;
#[cfg(any())] pub mod ansi_renderer;

// ─── Minimal stub surface for gated modules ────────────────────────────────
// Only the symbols that `parser.rs` / `root.rs` need to name. Bodies are
// `todo!()` / opaque newtypes; real impls live in the gated drafts above.

#[cfg(not(any()))]
pub mod inlines {
    #[derive(Copy, Clone, Default)]
    pub struct EmphDelim(()); // TODO(b1): stub — real def in gated inlines.rs
    pub const MAX_EMPH_MATCHES: usize = 0; // TODO(b1): stub
}

#[cfg(not(any()))]
pub mod ref_defs {
    pub type RefDef = crate::types::RefDef<'static>; // TODO(b1): stub — real def in gated ref_defs.rs
}

#[cfg(not(any()))]
pub mod html_renderer {
    pub struct HtmlRenderer(()); // TODO(b1): stub — real def in gated html_renderer.rs
}

#[cfg(not(any()))]
pub mod ansi_renderer {
    pub struct AnsiRenderer(()); // TODO(b1): stub
    pub struct Theme(()); // TODO(b1): stub
    pub struct ImageUrlCollector(()); // TODO(b1): stub
    pub fn render_to_ansi() { todo!("b1: gated") }
    pub fn detect_light_background() -> bool { todo!("b1: gated") }
    pub fn detect_kitty_graphics() -> bool { todo!("b1: gated") }
}

#[cfg(not(any()))] pub mod render_blocks {}
#[cfg(not(any()))] pub mod containers {}
#[cfg(not(any()))] pub mod line_analysis {}
#[cfg(not(any()))] pub mod links {}
#[cfg(not(any()))] pub mod blocks {}

pub use root::RenderOptions;
