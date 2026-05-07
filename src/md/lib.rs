#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// PORTING.md crate-map name is `bun_str`; workspace crate is `bun_string`.
#![warn(unreachable_pub)]
extern crate bun_string as bun_str;

pub mod types;
pub mod parser;
pub mod root;
pub mod helpers;
pub mod entity;
pub mod unicode;
pub mod autolinks;
pub mod render_blocks;
pub mod containers;
pub mod ref_defs;
pub mod line_analysis;
pub mod links;
pub mod blocks;
pub mod html_renderer;
pub mod inlines;
pub mod ansi_renderer;

pub use root::RenderOptions;
