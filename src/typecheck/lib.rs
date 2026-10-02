//! The TypeScript type checker behind `bun --lint`: a port of typescript-go onto `bun_ast`.

#![allow(dead_code)]

pub mod ast;
pub mod binder;
pub mod checker;
pub mod collections;
pub mod core;
pub mod diagnostics;
pub mod evaluator;
pub mod importer;
pub mod internal;
pub mod jsnum;
pub mod lowering;
pub mod module;
pub mod modulespecifiers;
pub mod nodebuilder;
pub mod printer;
pub mod pseudochecker;
pub mod scanner;
pub mod stringutil;
pub mod tspath;
