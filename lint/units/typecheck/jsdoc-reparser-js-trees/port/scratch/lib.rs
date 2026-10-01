//! SCRATCH crate root, not delivered: the JavaScript step of the importer against the node table of the worktree.
#![allow(unexpected_cfgs)]
#![cfg_attr(not(test), deny(warnings, dead_code, unreachable_pub, unused_imports, unused_variables, unused_mut))]
pub mod ast;
pub mod core;
pub mod diagnostics;
#[path = "/workspace/wt/typecheck/src/typecheck/importer/mod.rs"]
pub mod importer;
pub mod internal;
pub mod scanner;
#[path = "/workspace/wt/typecheck/src/typecheck/stringutil/mod.rs"]
pub mod stringutil;
pub mod tspath;
#[cfg(test)]
mod corpus;
