//! A TypeScript type checker: resolves types on demand and reports TypeScript's errors by code and position.
//!
//! The rules it applies are TypeScript's. Large parts of `check` and `bind` are ports of the checker and binder of
//! typescript-go (https://github.com/microsoft/typescript-go, Copyright Microsoft Corporation, Apache License 2.0), and comments
//! name the function a piece of code corresponds to.

pub mod atom;
pub mod bind;
pub mod check;
pub mod config;
pub mod config_options;
pub mod describe;
pub mod hir;
pub mod json;
pub mod json_places;
pub mod local;
pub mod messages;
pub mod program;
pub mod resolve;
pub mod sites;
pub mod table;
pub mod types;
pub mod util;
pub mod verify;
