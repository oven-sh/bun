//! The TypeScript type checker behind `bun --lint`: a port of typescript-go onto `bun_ast`.

pub mod ast;
pub mod binder;
pub mod collections;
pub mod core;
pub mod diagnostics;
pub mod importer;
pub mod internal;
pub mod jsnum;
pub mod lowering;
pub mod module;
pub mod scanner;
pub mod stringutil;
pub mod tspath;
