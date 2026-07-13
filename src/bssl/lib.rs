//! The tree's BoringSSL binding surface.
//!
//! Re-exports the vendored `bssl-sys` crate (`vendor/boringssl/rust/bssl-sys`),
//! whose mechanically generated, fork-synchronized bindings are committed
//! per target under `bindings/` (see `bindings/README.md`). Symbols resolve
//! against the BoringSSL objects compiled by `scripts/build/deps/boringssl.ts`
//! at final-binary link.
//!
//! `bun_boringssl_sys` (`src/boringssl_sys`) is the legacy hand-written extern
//! surface; its consumers are pending migration onto this crate.

pub use bssl_sys::*;
