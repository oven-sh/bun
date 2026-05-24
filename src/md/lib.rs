#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]

pub mod ansi_renderer;
pub mod autolinks;
pub mod blocks;
pub mod containers;
pub mod entity;
pub mod helpers;
pub mod html_renderer;
pub mod inlines;
pub mod line_analysis;
pub mod links;
pub mod parser;
pub mod ref_defs;
pub mod render_blocks;
pub mod root;
pub mod types;
pub mod unicode;

pub use root::RenderOptions;
