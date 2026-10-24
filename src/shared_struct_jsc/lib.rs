#![warn(unused_must_use)]
//! JSC bridge for `bun_shared_struct`. Keeps `src/shared_struct/` free of JSC types.

pub(crate) mod generated_bindgen;
pub mod shared_struct_classes;
