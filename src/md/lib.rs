#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]

pub mod ansi_renderer;
pub mod autolinks;
pub(crate) mod blocks;
pub(crate) mod containers;
pub(crate) mod entity;
pub mod helpers;
pub mod html_renderer;
pub mod inlines;
pub mod line_analysis;
pub(crate) mod links;
pub mod output;
pub mod parser;
pub mod ref_defs;
pub(crate) mod render_blocks;
pub mod root;
pub mod types;
pub(crate) mod unicode;

pub(crate) use root::RenderOptions;
