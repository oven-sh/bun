// Scratch root: compiles the leaf packages of src/typecheck in place, with rustc alone.
#[path = "/workspace/wt/typecheck/src/typecheck/collections/mod.rs"]
pub mod collections;
#[path = "/workspace/wt/typecheck/src/typecheck/core/mod.rs"]
pub mod core;
#[path = "/workspace/wt/typecheck/src/typecheck/jsnum/mod.rs"]
pub mod jsnum;
#[path = "/workspace/wt/typecheck/src/typecheck/stringutil/mod.rs"]
pub mod stringutil;
#[path = "/workspace/wt/typecheck/src/typecheck/tspath/mod.rs"]
pub mod tspath;

#[cfg(test)]
mod full;
