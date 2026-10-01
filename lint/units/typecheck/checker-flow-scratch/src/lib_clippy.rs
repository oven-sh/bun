//! Scratch: the same crate for clippy: every module but checker::flow allows every lint.
#[allow(warnings, unused, unreachable_pub, unexpected_cfgs, clippy::all, clippy::pedantic, clippy::nursery, clippy::restriction, clippy::cargo)] pub mod tscore;
#[allow(warnings, unused, unreachable_pub, unexpected_cfgs, clippy::all, clippy::pedantic, clippy::nursery, clippy::restriction, clippy::cargo)] pub mod internal;
#[allow(warnings, unused, unreachable_pub, unexpected_cfgs, clippy::all, clippy::pedantic, clippy::nursery, clippy::restriction, clippy::cargo)] pub mod core;
#[allow(warnings, unused, unreachable_pub, unexpected_cfgs, clippy::all, clippy::pedantic, clippy::nursery, clippy::restriction, clippy::cargo)] #[path = "/workspace/wt/typecheck/src/typecheck/collections/mod.rs"] pub mod collections;
#[allow(warnings, unused, unreachable_pub, unexpected_cfgs, clippy::all, clippy::pedantic, clippy::nursery, clippy::restriction, clippy::cargo)] #[path = "/workspace/wt/typecheck/src/typecheck/stringutil/mod.rs"] pub mod stringutil;
#[allow(warnings, unused, unreachable_pub, unexpected_cfgs, clippy::all, clippy::pedantic, clippy::nursery, clippy::restriction, clippy::cargo)] #[path = "/workspace/wt/typecheck/src/typecheck/tspath/mod.rs"] pub mod tspath;
#[allow(warnings, unused, unreachable_pub, unexpected_cfgs, clippy::all, clippy::pedantic, clippy::nursery, clippy::restriction, clippy::cargo)] pub mod ast;
#[allow(warnings, unused, unreachable_pub, unexpected_cfgs, clippy::all, clippy::pedantic, clippy::nursery, clippy::restriction, clippy::cargo)] pub mod ast_extra;
#[allow(warnings, unused, unreachable_pub, unexpected_cfgs, clippy::all, clippy::pedantic, clippy::nursery, clippy::restriction, clippy::cargo)] pub mod diagnostics;
#[allow(warnings, unused, unreachable_pub, unexpected_cfgs, clippy::all, clippy::pedantic, clippy::nursery, clippy::restriction, clippy::cargo)] pub mod scanner;
#[allow(warnings, unused, unreachable_pub, unexpected_cfgs, clippy::all, clippy::pedantic, clippy::nursery, clippy::restriction, clippy::cargo)] pub mod evaluator;
#[allow(warnings, unused, unreachable_pub, unexpected_cfgs, clippy::all, clippy::pedantic, clippy::nursery, clippy::restriction, clippy::cargo)] pub mod binder;
#[path = "checker/mod_clippy.rs"] pub mod checker;
