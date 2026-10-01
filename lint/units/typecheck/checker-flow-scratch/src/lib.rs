//! Scratch: type-checks checker/flow.rs of the worktree against the real ast, core, collections, stringutil, tspath modules and stubs for the rest.
#![allow(warnings, unused, unreachable_pub, unexpected_cfgs)]
pub mod tscore;
pub mod internal;
pub mod core;
#[path = "/workspace/wt/typecheck/src/typecheck/collections/mod.rs"] pub mod collections;
#[path = "/workspace/wt/typecheck/src/typecheck/stringutil/mod.rs"] pub mod stringutil;
#[path = "/workspace/wt/typecheck/src/typecheck/tspath/mod.rs"] pub mod tspath;
pub mod ast;
pub mod ast_extra;
pub mod diagnostics;
pub mod scanner;
pub mod evaluator;
pub mod binder;
pub mod checker;
