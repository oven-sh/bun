//! Password hashing for `Bun.password` (argon2 / bcrypt). Neither algorithm is
//! provided by BoringSSL, so this module implements the API surface that
//! `PasswordObject` consumes (`str_hash` / `str_verify` / `Params` / `Mode` /
//! `Encoding`) and routes to the pure-Rust `rust-argon2` and `bcrypt` crates
//! from crates.io.
//!
//!   * argon2: PHC string format only (`str_hash` rejects `.crypt`), 32-byte
//!     random salt, 32-byte tag, version 0x13.
//!   * bcrypt: modular-crypt `$2b$…` 60-byte string for hashing; verification
//!     additionally accepts the PHC `$bcrypt$…` form (decoded locally — the
//!     Rust `bcrypt` crate has no PHC codec). `silently_truncate_password` is
//!     asserted `true` (Bun's only caller never sets `false`).

use crate::Error;

/// PHC / modular-crypt strings are 7-bit ASCII by spec; the third-party
/// `argon2`/`bcrypt` crates take `&str`, so view-cast after the cheap
/// `is_ascii` check (no full UTF-8 walk).
#[inline]
fn phc_ascii_str(s: &[u8]) -> Result<&str, Error> {
    if !s.is_ascii() {
        return Err(crate::Error::InvalidEncoding);
    }
    // SAFETY: every byte < 0x80 ⇒ valid UTF-8.
    Ok(unsafe { core::str::from_utf8_unchecked(s) })
}

/// Output string encoding.
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Encoding {
    /// PHC string format (`$argon2id$v=19$...`).
    Phc,
    /// Traditional crypt(3) format (`$2b$...`).
    Crypt,
}

/// callers compare against `crate::Error::PasswordVerificationFailed` etc.
pub type PwhashError = Error;

pub mod argon2 {
    use super::{Encoding, Error};

    // The `rust-argon2` package exports its lib as crate name `argon2`; refer to
    // it via the absolute `::argon2` path so it doesn't collide with this module.
    use ::argon2 as vendor;

    const DEFAULT_SALT_LEN: usize = 32;
    const DEFAULT_HASH_LEN: u32 = 32;

    const MAX_VERIFY_TIME_COST: u32 = 1 << 16;
    const MAX_VERIFY_MEMORY_COST: u32 = 1 << 22;
    const MAX_VERIFY_PARALLELISM: u32 = 64;

    /// Argon2 variant.
    #[derive(Copy, Clone, Eq, PartialEq)]
    pub enum Mode {
        Argon2d,
        Argon2i,
        Argon2id,
    }

    impl Mode {
        fn to_variant(self) -> vendor::Variant {
            match self {
                Mode::Argon2d => vendor::Variant::Argon2d,
                Mode::Argon2i => vendor::Variant::Argon2i,
                Mode::Argon2id => vendor::Variant::Argon2id,
            }
        }
    }

    /// Argon2 parameters — only the fields Bun touches.
    #[derive(Copy, Clone)]
    pub struct Params {
        /// Time cost (iterations).
        pub t: u32,
        /// Memory cost in KiB.
        pub m: u32,
        /// Parallelism degree.
        pub p: u32,
    }

    impl Params {
        /// Interactive argon2id preset: `t=2`, `m=67108864/1024` KiB.
        pub const INTERACTIVE_2ID_T: u32 = 2;
        pub const INTERACTIVE_2ID_M: u32 = 67_108_864 / 1024;

        pub const INTERACTIVE_2ID: Params = Params {
            t: Self::INTERACTIVE_2ID_T,
            m: Self::INTERACTIVE_2ID_M,
            p: 1,
        };
    }

    /// Options for `str_hash`.
    #[derive(Copy, Clone)]
    pub(crate) struct HashOptions {
        pub params: Params,
        pub mode: Mode,
        pub encoding: Encoding,
    }

    /// Options for `str_verify`.
    #[derive(Copy, Clone, Default)]
    pub(crate) struct VerifyOptions;

    fn map_err(e: &vendor::Error) -> Error {
        use vendor::Error as E;
        match e {
            // Keep these tags recognisable so PasswordObject's
            // `errorName(err)` formatting stays stable.
            E::DecodingFail | E::IncorrectType | E::IncorrectVersion => {
                crate::Error::InvalidEncoding
            }
            E::OutputTooShort
            | E::OutputTooLong
            | E::PwdTooShort
            | E::PwdTooLong
            | E::SaltTooShort
            | E::SaltTooLong
            | E::AdTooShort
            | E::AdTooLong
            | E::SecretTooShort
            | E::SecretTooLong
            | E::TimeTooSmall
            | E::TimeTooLarge
            | E::MemoryTooLittle
            | E::MemoryTooMuch
            | E::LanesTooFew
            | E::LanesTooMany => crate::Error::WeakParameters,
        }
    }

    /// Writes the PHC-encoded hash into `out` and returns the populated
    /// subslice.
    pub(crate) fn str_hash<'a>(
        password: &[u8],
        options: HashOptions,
        out: &'a mut [u8],
    ) -> Result<&'a [u8], Error> {
        if options.encoding != Encoding::Phc {
            return Err(crate::Error::InvalidEncoding);
        }

        let mut salt = [0u8; DEFAULT_SALT_LEN];
        getrandom::fill(&mut salt).map_err(|_| crate::Error::Unexpected)?;

        let config = vendor::Config {
            ad: &[],
            secret: &[],
            hash_length: DEFAULT_HASH_LEN,
            lanes: options.params.p,
            mem_cost: options.params.m,
            time_cost: options.params.t,
            // Hashing always runs single-threaded here regardless of `p`:
            // memory is fanned across `p` lanes but they are computed on the
            // calling thread.
            thread_mode: vendor::ThreadMode::Sequential,
            variant: options.mode.to_variant(),
            version: vendor::Version::Version13,
        };

        let encoded = vendor::hash_encoded(password, &salt, &config).map_err(|e| map_err(&e))?;
        let bytes = encoded.as_bytes();

        // Error `NoSpaceLeft` if the encoded hash overflows the caller buffer.
        if bytes.len() > out.len() {
            return Err(crate::Error::Sys(bun_errno::SystemErrno::ENOSPC));
        }
        out[..bytes.len()].copy_from_slice(bytes);
        Ok(&out[..bytes.len()])
    }

    /// Verify a PHC-encoded argon2 hash.
    pub(crate) fn str_verify(
        encoded_hash: &[u8],
        password: &[u8],
        _options: VerifyOptions,
    ) -> Result<(), Error> {
        // PHC strings are 7-bit ASCII; reject non-ASCII input as a decode
        // failure.
        let encoded = super::phc_ascii_str(encoded_hash)?;

        // Only version 0x13 is accepted: an explicit `v=` segment that isn't
        // `19` is `InvalidEncoding`, and a missing `v=` segment still hashes
        // with 0x13.
        // rust-argon2's `verify_encoded` instead accepts `v=16` (computing
        // with Version10) and defaults a missing segment to Version10, so
        // pre-scan and normalise here before delegating.
        let normalised: std::borrow::Cow<'_, str> = 'norm: {
            // Encoded shape is `$<alg>$[v=N$]m=..,t=..,p=..$<salt>$<hash>`.
            // Locate the segment immediately after the alg-id.
            let Some(after_dollar) = encoded.strip_prefix('$') else {
                // Malformed; let rust-argon2 reject it.
                break 'norm std::borrow::Cow::Borrowed(encoded);
            };
            let Some(sep) = after_dollar.find('$') else {
                break 'norm std::borrow::Cow::Borrowed(encoded);
            };
            // Absolute index of the '$' terminating the alg-id.
            let alg_end = 1 + sep;
            let rest = &encoded[alg_end + 1..];
            if let Some(v) = rest.strip_prefix("v=") {
                let end = v.find('$').unwrap_or(v.len());
                if &v[..end] != "19" {
                    return Err(crate::Error::InvalidEncoding);
                }
                std::borrow::Cow::Borrowed(encoded)
            } else {
                // No `v=` segment — splice in `v=19$` so rust-argon2 hashes
                // with Version13.
                let mut s = String::with_capacity(encoded.len() + 5);
                s.push_str(&encoded[..=alg_end]);
                s.push_str("v=19$");
                s.push_str(rest);
                std::borrow::Cow::Owned(s)
            }
        };

        if let Some(after_dollar) = normalised.strip_prefix('$') {
            if let Some(sep) = after_dollar.find('$') {
                let mut rest = &after_dollar[sep + 1..];
                if let Some(after_version) = rest.strip_prefix("v=") {
                    rest = match after_version.find('$') {
                        Some(end) => &after_version[end + 1..],
                        None => "",
                    };
                }
                let params = &rest[..rest.find('$').unwrap_or(rest.len())];
                for pair in params.split(',') {
                    let Some((key, value)) = pair.split_once('=') else {
                        continue;
                    };
                    let Ok(value) = value.parse::<u32>() else {
                        continue;
                    };
                    let limit = match key {
                        "m" => MAX_VERIFY_MEMORY_COST,
                        "t" => MAX_VERIFY_TIME_COST,
                        "p" => MAX_VERIFY_PARALLELISM,
                        _ => continue,
                    };
                    if value > limit {
                        return Err(crate::Error::WeakParameters);
                    }
                }
            }
        }

        match vendor::verify_encoded(&normalised, password) {
            Ok(true) => Ok(()),
            // `rust-argon2` constant-time compares and returns `Ok(false)` on
            // mismatch; surface this as `PasswordVerificationFailed`.
            Ok(false) => Err(crate::Error::PasswordVerificationFailed),
            Err(e) => Err(map_err(&e)),
        }
    }
}

pub mod bcrypt {
    use super::{Encoding, Error};

    use ::bcrypt as vendor;

    /// Length of a modular-crypt bcrypt hash string.
    pub(crate) const HASH_LENGTH: usize = 60;
    const SALT_LENGTH: usize = 16;
    const DK_LENGTH: usize = 23;

    /// bcrypt parameters.
    #[derive(Copy, Clone)]
    pub struct Params {
        /// log2 rounds (clamped 4..=31 by caller).
        pub rounds_log: u8,
        pub silently_truncate_password: bool,
    }

    /// Options for `str_hash`.
    #[derive(Copy, Clone)]
    pub(crate) struct HashOptions {
        pub params: Params,
        pub encoding: Encoding,
    }

    /// Options for `str_verify`.
    #[derive(Copy, Clone)]
    pub(crate) struct VerifyOptions {
        pub silently_truncate_password: bool,
    }

    fn map_err(e: &vendor::BcryptError) -> Error {
        use vendor::BcryptError as E;
        match e {
            E::CostNotAllowed(_) => crate::Error::WeakParameters,
            E::Rand(_) => crate::Error::Unexpected,
            // InvalidHash / InvalidCost / InvalidPrefix / InvalidSaltLen /
            // InvalidBase64 — all map to `InvalidEncoding`.
            _ => crate::Error::InvalidEncoding,
        }
    }

    /// Writes the crypt-encoded hash into `out` and returns the populated
    /// subslice.
    pub(crate) fn str_hash<'a>(
        password: &[u8],
        options: HashOptions,
        out: &'a mut [u8],
    ) -> Result<&'a [u8], Error> {
        if out.len() < HASH_LENGTH {
            return Err(crate::Error::Sys(bun_errno::SystemErrno::ENOSPC));
        }
        // Bun only ever requests `.crypt`. A `.phc` request would need the
        // `$bcrypt$…` PHC serializer, which the Rust `bcrypt` crate does not
        // implement; surface that as an encoding error rather than silently
        // returning the wrong format.
        if options.encoding != Encoding::Crypt {
            return Err(crate::Error::InvalidEncoding);
        }

        let cost = u32::from(options.params.rounds_log);

        // A `silently_truncate_password == false` implementation would need to
        // pre-hash >72-byte passwords via HMAC-SHA512 keyed by the salt without
        // erroring; the `bcrypt` crate's `non_truncating_*` instead returns
        // `Err(Truncation)` (and trips at `>=72`, not `>72`). Bun's only caller
        // (`PasswordObject`) always passes `true` and pre-hashes long passwords
        // itself, so hard-assert here rather than ship a divergent codepath.
        debug_assert!(
            options.params.silently_truncate_password,
            "bcrypt: silently_truncate_password=false is unreachable from Bun \
             and not implemented in this shim",
        );

        // `hash_with_result` → `_hash_password(.., err_on_truncation = false)`:
        // null-terminates then clamps to 72 bytes.
        let parts = vendor::hash_with_result(password, cost).map_err(|e| map_err(&e))?;

        // `format_for_version(TwoB)` yields the canonical `$2b$cc$<22 salt><31 hash>`
        // 60-byte string.
        let encoded = parts.format_for_version(vendor::Version::TwoB);
        let bytes = encoded.as_bytes();
        debug_assert_eq!(bytes.len(), HASH_LENGTH);

        out[..bytes.len()].copy_from_slice(bytes);
        Ok(&out[..bytes.len()])
    }

    /// Verify a bcrypt hash (modular-crypt or PHC form).
    pub(crate) fn str_verify(
        encoded_hash: &[u8],
        password: &[u8],
        options: VerifyOptions,
    ) -> Result<(), Error> {
        // Both the modular-crypt and PHC alphabets are pure ASCII; non-ASCII
        // input is a decode failure either way.
        let encoded = super::phc_ascii_str(encoded_hash)?;

        // See `str_hash`: the `false` path's HMAC-SHA512 pre-hash is not
        // implemented in this shim and is unreachable from Bun.
        debug_assert!(
            options.silently_truncate_password,
            "bcrypt: silently_truncate_password=false is unreachable from Bun \
             and not implemented in this shim",
        );
        let _ = options;

        // Dispatch on prefix:
        //   `$2…`      → modular-crypt verify
        //   otherwise  → PHC verify (`$bcrypt$r=N$<salt>$<hash>`)
        // `PasswordObject::Algorithm::get` sniffs both `$2` *and* `$bcrypt`
        // (PasswordObject.rs:268), so PHC-encoded bcrypt hashes do reach here.
        if !encoded.starts_with("$2") {
            return verify_phc(encoded, password);
        }

        // Crypt path: the crate checks `str.len == hash_length` inside
        // `split_hash`.
        match vendor::verify(password, encoded) {
            Ok(true) => Ok(()),
            // The crate compares only the 23-byte raw digest (constant-time)
            // and ignores the version prefix — any `$2a/b/x/y$` hash with
            // matching salt+digest passes.
            Ok(false) => Err(crate::Error::PasswordVerificationFailed),
            Err(e) => Err(map_err(&e)),
        }
    }

    /// Verify a PHC-encoded bcrypt hash: `$bcrypt$r=N$<b64 salt>$<b64 hash>`.
    ///
    /// The Rust `bcrypt` crate has no PHC codec, so parse the string here,
    /// recompute via the raw block cipher, and compare the 23-byte digests.
    fn verify_phc(encoded: &str, password: &[u8]) -> Result<(), Error> {
        let invalid = || crate::Error::InvalidEncoding;

        // alg_id
        let rest = encoded.strip_prefix('$').ok_or_else(invalid)?;
        let (alg_id, rest) = rest.split_once('$').ok_or_else(invalid)?;
        if alg_id != "bcrypt" {
            return Err(crate::Error::PasswordVerificationFailed);
        }

        // r=N (rounds must fit in 6 bits; checked below)
        let (params, rest) = rest.split_once('$').ok_or_else(invalid)?;
        let rounds_str = params.strip_prefix("r=").ok_or_else(invalid)?;
        let rounds_log: u8 = rounds_str.parse().map_err(|_| invalid())?;
        if rounds_log > 63 {
            return Err(invalid());
        }

        // salt / hash — standard no-pad base64.
        let (salt_b64, hash_b64) = rest.split_once('$').ok_or_else(invalid)?;
        let decoder = &bun_base64::zig_base64::STANDARD_NO_PAD.decoder;

        let mut salt = [0u8; SALT_LENGTH];
        if decoder
            .calc_size_for_slice(salt_b64.as_bytes())
            .map_err(|_| invalid())?
            != SALT_LENGTH
        {
            return Err(invalid());
        }
        decoder
            .decode(&mut salt, salt_b64.as_bytes())
            .map_err(|_| invalid())?;

        let mut expected = [0u8; DK_LENGTH];
        if decoder
            .calc_size_for_slice(hash_b64.as_bytes())
            .map_err(|_| invalid())?
            != DK_LENGTH
        {
            return Err(invalid());
        }
        decoder
            .decode(&mut expected, hash_b64.as_bytes())
            .map_err(|_| invalid())?;

        // The crate's raw `bcrypt()` asserts `cost < 32`, so reject the
        // out-of-range tail here rather than panic. (Values <4 or ≥32 never
        // appear in hashes Bun produced.)
        if !(4..=31).contains(&rounds_log) {
            return Err(crate::Error::WeakParameters);
        }

        // Replicate the crate's `_hash_password`: null-terminate then clamp
        // to 72 bytes before feeding the cipher.
        let mut buf = [0u8; 72];
        let copy_len = password.len().min(72);
        buf[..copy_len].copy_from_slice(&password[..copy_len]);
        let used = (copy_len + 1).min(72);

        let computed = vendor::bcrypt(u32::from(rounds_log), salt, &buf[..used]);

        // Compare in constant time like the `$2b$` path (BoringSSL `CRYPTO_memcmp`).
        if bun_boringssl_sys::constant_time_eq(&computed[..DK_LENGTH], &expected) {
            Ok(())
        } else {
            Err(crate::Error::PasswordVerificationFailed)
        }
    }
}
