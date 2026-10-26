#![warn(unused_must_use)]
//! JSC bridge for `bun_shared_struct`. Keeps `src/shared_struct/` free of JSC types.

pub(crate) mod generated_bindgen;
pub(crate) mod registry;
pub mod shared_struct_classes;
pub mod structured_clone;
