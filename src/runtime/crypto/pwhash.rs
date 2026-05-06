//! `std.crypto.pwhash` shim.
//!
//! Zig's `Bun.password` is built on `std.crypto.pwhash.{argon2, bcrypt}`. Neither
//! algorithm is provided by BoringSSL, so this module mirrors the Zig stdlib API
//! surface that `PasswordObject` consumes (`strHash` / `strVerify` / `Params` /
//! `Mode` / `Encoding`) and routes to a vendored implementation.
//!
//! Phase B vendor target: pure-Rust `argon2` + `bcrypt` crates (or the Zig
//! stdlib compiled as a static lib). Until the vendor lands, the bodies below
//! are explicit `todo!()`s rather than a silent no-op so misuse fails loudly.
//!
//! API shape is locked to `vendor/zig/lib/std/crypto/{argon2, bcrypt}.zig` so
//! the eventual vendor swap is a body-only change.

#![allow(dead_code)]

use bun_core::Error;

/// `std.crypto.pwhash.Encoding`
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Encoding {
    /// PHC string format (`$argon2id$v=19$...`).
    Phc,
    /// Traditional crypt(3) format (`$2b$...`).
    Crypt,
}

/// `std.crypto.pwhash.Error` collapses into `bun_core::Error` (NonZeroU16 tag);
/// callers compare against `bun_core::err!("PasswordVerificationFailed")` etc.
pub type PwhashError = Error;

pub mod argon2 {
    use super::{Encoding, Error};

    /// `std.crypto.pwhash.argon2.Mode`
    #[derive(Copy, Clone, Eq, PartialEq)]
    pub enum Mode {
        Argon2d,
        Argon2i,
        Argon2id,
    }

    /// `std.crypto.pwhash.argon2.Params` — only the fields Bun touches.
    #[derive(Copy, Clone)]
    pub struct Params {
        /// Time cost (iterations).
        pub t: u32,
        /// Memory cost in KiB.
        pub m: u32,
        /// Parallelism degree (Zig: u24).
        pub p: u32,
    }

    impl Params {
        /// `Params.interactive_2id = fromLimits(2, 67108864)` → `t=2, m=67108864/1024`.
        pub const INTERACTIVE_2ID_T: u32 = 2;
        pub const INTERACTIVE_2ID_M: u32 = 67_108_864 / 1024;

        pub const INTERACTIVE_2ID: Params = Params {
            t: Self::INTERACTIVE_2ID_T,
            m: Self::INTERACTIVE_2ID_M,
            p: 1,
        };
    }

    /// `std.crypto.pwhash.argon2.HashOptions` (allocator field dropped).
    #[derive(Copy, Clone)]
    pub struct HashOptions {
        pub params: Params,
        pub mode: Mode,
        pub encoding: Encoding,
    }

    /// `std.crypto.pwhash.argon2.VerifyOptions` (allocator field dropped).
    #[derive(Copy, Clone, Default)]
    pub struct VerifyOptions;

    /// `std.crypto.pwhash.argon2.strHash` — writes the PHC-encoded hash into
    /// `out` and returns the populated subslice.
    pub fn str_hash<'a>(
        password: &[u8],
        options: HashOptions,
        out: &'a mut [u8],
    ) -> Result<&'a [u8], Error> {
        let _ = (password, options, out);
        // TODO(vendor): wire to vendored argon2 (Rust `argon2` crate or Zig stdlib
        // staticlib). BoringSSL has no argon2 KDF.
        todo!("pwhash::argon2::str_hash — vendor argon2 not yet linked")
    }

    /// `std.crypto.pwhash.argon2.strVerify`.
    pub fn str_verify(
        encoded_hash: &[u8],
        password: &[u8],
        _options: VerifyOptions,
    ) -> Result<(), Error> {
        let _ = (encoded_hash, password);
        // TODO(vendor): wire to vendored argon2.
        todo!("pwhash::argon2::str_verify — vendor argon2 not yet linked")
    }
}

pub mod bcrypt {
    use super::{Encoding, Error};

    /// `std.crypto.pwhash.bcrypt.hash_length`
    pub const HASH_LENGTH: usize = 60;

    /// `std.crypto.pwhash.bcrypt.Params`
    #[derive(Copy, Clone)]
    pub struct Params {
        /// log2 rounds (Zig: u6; clamped 4..=31 by caller).
        pub rounds_log: u8,
        pub silently_truncate_password: bool,
    }

    /// `std.crypto.pwhash.bcrypt.HashOptions` (allocator field dropped).
    #[derive(Copy, Clone)]
    pub struct HashOptions {
        pub params: Params,
        pub encoding: Encoding,
    }

    /// `std.crypto.pwhash.bcrypt.VerifyOptions` (allocator field dropped).
    #[derive(Copy, Clone)]
    pub struct VerifyOptions {
        pub silently_truncate_password: bool,
    }

    /// `std.crypto.pwhash.bcrypt.strHash` — writes the crypt-encoded hash into
    /// `out` and returns the populated subslice.
    pub fn str_hash<'a>(
        password: &[u8],
        options: HashOptions,
        out: &'a mut [u8],
    ) -> Result<&'a [u8], Error> {
        let _ = (password, options, out);
        // TODO(vendor): wire to vendored bcrypt (Rust `bcrypt` crate or Zig stdlib
        // staticlib). BoringSSL has no bcrypt KDF.
        todo!("pwhash::bcrypt::str_hash — vendor bcrypt not yet linked")
    }

    /// `std.crypto.pwhash.bcrypt.strVerify`.
    pub fn str_verify(
        encoded_hash: &[u8],
        password: &[u8],
        options: VerifyOptions,
    ) -> Result<(), Error> {
        let _ = (encoded_hash, password, options);
        // TODO(vendor): wire to vendored bcrypt.
        todo!("pwhash::bcrypt::str_verify — vendor bcrypt not yet linked")
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     vendor/zig/lib/std/crypto/{argon2,bcrypt}.zig (API surface only)
//   confidence: high (types) / low (impl — vendor pending)
//   todos:      4
//   notes:      type/const surface matches Zig stdlib exactly so PasswordObject
//               compiles; bodies are loud todo!()s (NOT silent no-ops) until the
//               argon2/bcrypt vendor is linked. BoringSSL provides neither KDF.
// ──────────────────────────────────────────────────────────────────────────
