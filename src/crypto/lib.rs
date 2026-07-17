#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![allow(ambiguous_glob_reexports, hidden_glob_reexports)]
#![warn(unused_must_use)]

extern crate self as bun_crypto;
// Self-aliases so mounted sources' sibling extern refs resolve to this crate
// root (satisfied by the flat re-exports below) until Step 5.6's sed.
pub extern crate self as bun_boringssl_sys;
pub extern crate self as bun_boringssl;
pub extern crate self as bun_sha_hmac;

// ──────────────────────────────────────────────────────────────────────────
// §8 Step 5.1 — absorbed-crate #[path] mounts + flat root re-exports.
// Source files stay at their original disk paths; only crate-of-record changes.
// ──────────────────────────────────────────────────────────────────────────
#[path = "../boringssl_sys/lib.rs"]
pub mod boringssl_sys;
#[path = "../boringssl/lib.rs"]
pub mod boringssl;
#[path = "../sha_hmac/lib.rs"]
pub mod sha_hmac;
#[path = "../csrf/lib.rs"]
pub mod csrf;
#[path = "../s3_signing/lib.rs"]
pub mod s3_signing;
#[path = "../exe_format/lib.rs"]
pub mod exe_format;

// Disambiguate glob-vs-glob name collisions (explicit wins over all globs).
pub use sha_hmac::{generate, Algorithm};

pub use boringssl_sys::*;
pub use boringssl::*;
pub use sha_hmac::*;
pub use csrf::*;
pub use s3_signing::*;
pub use exe_format::*;
