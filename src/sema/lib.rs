//! A TypeScript type checker: resolves types on demand and reports TypeScript's errors by code and position.

pub mod atom;
pub mod bind;
pub mod check;
pub mod describe;
pub mod hir;
pub mod json;
pub mod program;
pub mod resolve;
pub mod sites;
pub mod types;
pub mod util;
pub mod verify;
