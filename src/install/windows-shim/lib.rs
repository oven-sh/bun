//! Shared source of the `.bunx` shim: encoder/decoder (`bin_linking_shim`)
//! and the launcher (`launcher`). Compiled three ways: as `bun_install` /
//! `bun_runtime`'s dependency (feature `host`), as the freestanding PE
//! (feature `shim_standalone`, via `main.rs`), and bare for `cargo check`.
#![cfg_attr(feature = "shim_standalone", no_std)]
#![allow(nonstandard_style, ambiguous_glob_reexports, incomplete_features)]
// `launcher` (windows-only) uses `ConstParamTy`; off-windows the feature would
// be flagged as declared-but-unused.
#![cfg_attr(windows, feature(adt_const_params))]

#[cfg(all(feature = "host", feature = "shim_standalone"))]
compile_error!("the `host` and `shim_standalone` features are mutually exclusive");

#[path = "BinLinkingShim.rs"]
pub mod bin_linking_shim;

#[cfg(windows)]
#[path = "bun_shim_impl.rs"]
pub mod launcher;
