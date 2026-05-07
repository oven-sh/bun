#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]

#![warn(unreachable_pub)]
pub mod sha;
pub mod hmac;

// Convenience re-export matching Phase-A intent (`crate::evp::Algorithm`).
pub use sha::evp;

// Crate-root re-exports mirroring Zig's flat `bun.sha.*` / `bun.hmac.*` surface
// so dependents can write `bun_sha_hmac::SHA256` / `bun_sha_hmac::generate`.
pub use sha::{Algorithm, SHA1, MD5, MD4, SHA224, SHA512, SHA384, SHA256, SHA512_256, MD5_SHA1};
pub use hmac::generate;
