#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod hmac;
pub mod sha;

// Convenience re-export so dependents can write `crate::evp::Algorithm`.
pub use sha::evp;

// Crate-root re-exports
// so dependents can write `bun_sha_hmac::SHA256` / `bun_sha_hmac::generate`.
pub use hmac::generate;
pub use sha::{Algorithm, MD4, MD5, MD5_SHA1, SHA1, SHA224, SHA256, SHA384, SHA512, SHA512_256};
