//! `std.crypto.pwhash` shim.
//!
//! Zig's `Bun.password` is built on `std.crypto.pwhash.{argon2, bcrypt}`. Neither
//! algorithm is provided by BoringSSL, so this module mirrors the Zig stdlib API
//! surface that `PasswordObject` consumes (`strHash` / `strVerify` / `Params` /
//! `Mode` / `Encoding`) and routes to the pure-Rust `rust-argon2` and `bcrypt`
//! crates from crates.io.
//!
//! API shape is locked to `vendor/zig/lib/std/crypto/{argon2, bcrypt}.zig` so
//! the bodies below are a drop-in for the Zig stdlib semantics:
//!   * argon2: PHC string format only (Zig `strHash` rejects `.crypt`), 32-byte
//!     random salt, 32-byte tag, version 0x13.
//!   * bcrypt: modular-crypt `$2b$…` 60-byte string for hashing; verification
//!     additionally accepts the PHC `$bcrypt$…` form (decoded locally — the
//!     Rust `bcrypt` crate has no PHC codec). `silently_truncate_password` is
//!     asserted `true` (Bun's only caller never sets `false`).

use bun_core::Error;

/// PHC / modular-crypt strings are 7-bit ASCII by spec; the third-party
/// `argon2`/`bcrypt` crates take `&str`, so view-cast after the cheap
/// `is_ascii` check (no full UTF-8 walk).
#[inline]
fn phc_ascii_str(s: &[u8]) -> Result<&str, Error> {
    if !s.is_ascii() {
        return Err(bun_core::err!("InvalidEncoding"));
    }
    // SAFETY: every byte < 0x80 ⇒ valid UTF-8.
    Ok(unsafe { core::str::from_utf8_unchecked(s) })
}

/// `std.crypto.pwhash.Encoding`
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Encoding {
    /// PHC string format (`$argon2id$v=19$...`).
    Phc,
    /// Traditional crypt(3) format (`$2b$...`).
    Crypt,
}

/// callers compare against `bun_core::err!("PasswordVerificationFailed")` etc.
pub type PwhashError = Error;

pub mod argon2 {
    use super::{Encoding, Error};

    // The `rust-argon2` package exports its lib as crate name `argon2`; refer to
    // it via the absolute `::argon2` path so it doesn't collide with this module.
    use ::argon2 as vendor;

    /// Zig `default_salt_len` / `default_hash_len` (vendor/zig/lib/std/crypto/argon2.zig).
    const DEFAULT_SALT_LEN: usize = 32;
    const DEFAULT_HASH_LEN: u32 = 32;

    const MAX_VERIFY_TIME_COST: u32 = 1 << 16;
    const MAX_VERIFY_MEMORY_COST: u32 = 1 << 22;
    const MAX_VERIFY_PARALLELISM: u32 = 64;

    /// `std.crypto.pwhash.argon2.Mode`
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
    pub(crate) struct HashOptions {
        pub params: Params,
        pub mode: Mode,
        pub encoding: Encoding,
    }

    /// `std.crypto.pwhash.argon2.VerifyOptions` (allocator field dropped).
    #[derive(Copy, Clone, Default)]
    pub(crate) struct VerifyOptions;

    fn map_err(e: &vendor::Error) -> Error {
        use vendor::Error as E;
        match e {
            // Zig's PhcFormatHasher emits these tags; keep them recognisable so
            // PasswordObject's `errorName(err)` formatting stays stable.
            E::DecodingFail | E::IncorrectType | E::IncorrectVersion => {
                bun_core::err!("InvalidEncoding")
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
            | E::LanesTooMany => bun_core::err!("WeakParameters"),
        }
    }

    /// `std.crypto.pwhash.argon2.strHash` — writes the PHC-encoded hash into
    /// `out` and returns the populated subslice.
    pub(crate) fn str_hash<'a>(
        password: &[u8],
        options: HashOptions,
        out: &'a mut [u8],
    ) -> Result<&'a [u8], Error> {
        // Zig: `switch (options.encoding) { .crypt => return Error.InvalidEncoding, .phc => … }`
        if options.encoding != Encoding::Phc {
            return Err(bun_core::err!("InvalidEncoding"));
        }

        // Zig: `var salt: [default_salt_len]u8 = undefined; crypto.random.bytes(&salt);`
        let mut salt = [0u8; DEFAULT_SALT_LEN];
        getrandom::fill(&mut salt).map_err(|_| bun_core::err!("Unexpected"))?;

        let config = vendor::Config {
            ad: &[],
            secret: &[],
            hash_length: DEFAULT_HASH_LEN,
            lanes: options.params.p,
            mem_cost: options.params.m,
            time_cost: options.params.t,
            // Hashing always runs single-threaded here regardless of `p` —
            // matches the Zig stdlib, which fans memory across `p` lanes but
            // computes them on the calling thread.
            thread_mode: vendor::ThreadMode::Sequential,
            variant: options.mode.to_variant(),
            version: vendor::Version::Version13,
        };

        let encoded = vendor::hash_encoded(password, &salt, &config).map_err(|e| map_err(&e))?;
        let bytes = encoded.as_bytes();

        // Zig: `phc_format.serialize(…, buf)` writes into the caller buffer and
        // errors `NoSpaceLeft` on overflow.
        if bytes.len() > out.len() {
            return Err(bun_core::err!("NoSpaceLeft"));
        }
        out[..bytes.len()].copy_from_slice(bytes);
        Ok(&out[..bytes.len()])
    }

    /// `std.crypto.pwhash.argon2.strVerify`.
    pub(crate) fn str_verify(
        encoded_hash: &[u8],
        password: &[u8],
        _options: VerifyOptions,
    ) -> Result<(), Error> {
        // Zig accepts the encoded hash as `[]const u8` but PHC strings are
        // 7-bit ASCII; reject non-ASCII input as a decode failure to match
        // `phc_format.deserialize` behaviour.
        let encoded = super::phc_ascii_str(encoded_hash)?;

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
                    return Err(bun_core::err!("InvalidEncoding"));
                }
                std::borrow::Cow::Borrowed(encoded)
            } else {
                // No `v=` segment — splice in `v=19$` so rust-argon2 hashes
                // with Version13 like Zig's kdf does.
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
                        return Err(bun_core::err!("WeakParameters"));
                    }
                }
            }
        }

        match vendor::verify_encoded(&normalised, password) {
            Ok(true) => Ok(()),
            // `rust-argon2` constant-time compares and returns `Ok(false)` on
            // mismatch; Zig surfaces this as `error.PasswordVerificationFailed`.
            Ok(false) => Err(bun_core::err!("PasswordVerificationFailed")),
            Err(e) => Err(map_err(&e)),
        }
    }
}

pub mod bcrypt {
    use super::{Encoding, Error};

    use ::bcrypt as vendor;

    /// `std.crypto.pwhash.bcrypt.hash_length`
    pub(crate) const HASH_LENGTH: usize = 60;
    /// Zig `salt_length` / `dk_length` (vendor/zig/lib/std/crypto/bcrypt.zig).
    const SALT_LENGTH: usize = 16;
    const DK_LENGTH: usize = 23;

    /// `std.crypto.pwhash.bcrypt.Params`
    #[derive(Copy, Clone)]
    pub struct Params {
        /// log2 rounds (Zig: u6; clamped 4..=31 by caller).
        pub rounds_log: u8,
        pub silently_truncate_password: bool,
    }

    /// `std.crypto.pwhash.bcrypt.HashOptions` (allocator field dropped).
    #[derive(Copy, Clone)]
    pub(crate) struct HashOptions {
        pub params: Params,
        pub encoding: Encoding,
    }

    /// `std.crypto.pwhash.bcrypt.VerifyOptions` (allocator field dropped).
    #[derive(Copy, Clone)]
    pub(crate) struct VerifyOptions {
        pub silently_truncate_password: bool,
    }

    fn map_err(e: &vendor::BcryptError) -> Error {
        use vendor::BcryptError as E;
        match e {
            E::CostNotAllowed(_) => bun_core::err!("WeakParameters"),
            E::Rand(_) => bun_core::err!("Unexpected"),
            // InvalidHash / InvalidCost / InvalidPrefix / InvalidSaltLen /
            // InvalidBase64 — all map to Zig's `InvalidEncoding`.
            _ => bun_core::err!("InvalidEncoding"),
        }
    }

    /// `std.crypto.pwhash.bcrypt.strHash` — writes the crypt-encoded hash into
    /// `out` and returns the populated subslice.
    pub(crate) fn str_hash<'a>(
        password: &[u8],
        options: HashOptions,
        out: &'a mut [u8],
    ) -> Result<&'a [u8], Error> {
        // Zig's `CryptFormatHasher.create` checks `buf.len < hash_length` first.
        if out.len() < HASH_LENGTH {
            return Err(bun_core::err!("NoSpaceLeft"));
        }
        if options.encoding != Encoding::Crypt {
            return Err(bun_core::err!("InvalidEncoding"));
        }

        let cost = u32::from(options.params.rounds_log);

        debug_assert!(
            options.params.silently_truncate_password,
            "bcrypt: silently_truncate_password=false is unreachable from Bun \
             and not implemented in this shim",
        );

        // `hash_with_result` → `_hash_password(.., err_on_truncation = false)`:
        // null-terminates then clamps to 72 bytes, exactly matching Zig's
        // `State.init` when `silently_truncate_password == true`.
        let parts = vendor::hash_with_result(password, cost).map_err(|e| map_err(&e))?;

        // `format_for_version(TwoB)` yields the canonical `$2b$cc$<22 salt><31 hash>`
        // 60-byte string — identical to Zig's `crypt_format.strHashInternal`.
        let encoded = parts.format_for_version(vendor::Version::TwoB);
        let bytes = encoded.as_bytes();
        debug_assert_eq!(bytes.len(), HASH_LENGTH);

        out[..bytes.len()].copy_from_slice(bytes);
        Ok(&out[..bytes.len()])
    }

    /// `std.crypto.pwhash.bcrypt.strVerify`.
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

        if !encoded.starts_with("$2") {
            return verify_phc(encoded, password);
        }

        // Crypt path: `CryptFormatHasher.verify` checks `str.len == hash_length`;
        // the Rust crate does the same inside `split_hash`.
        match vendor::verify(password, encoded) {
            Ok(true) => Ok(()),
            Ok(false) => Err(bun_core::err!("PasswordVerificationFailed")),
            Err(e) => Err(map_err(&e)),
        }
    }

    fn verify_phc(encoded: &str, password: &[u8]) -> Result<(), Error> {
        let invalid = || bun_core::err!("InvalidEncoding");

        // alg_id
        let rest = encoded.strip_prefix('$').ok_or_else(invalid)?;
        let (alg_id, rest) = rest.split_once('$').ok_or_else(invalid)?;
        // Zig: `if (!mem.eql(u8, hash_result.alg_id, alg_id)) return PasswordVerificationFailed`
        if alg_id != "bcrypt" {
            return Err(bun_core::err!("PasswordVerificationFailed"));
        }

        // r=N (Zig field is u6; phc_format would reject anything that doesn't fit)
        let (params, rest) = rest.split_once('$').ok_or_else(invalid)?;
        let rounds_str = params.strip_prefix("r=").ok_or_else(invalid)?;
        let rounds_log: u8 = rounds_str.parse().map_err(|_| invalid())?;
        if rounds_log > 63 {
            return Err(invalid());
        }

        // salt / hash — `phc_format.BinValue` uses `std.base64.standard_no_pad`.
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

        if !(4..=31).contains(&rounds_log) {
            return Err(bun_core::err!("WeakParameters"));
        }

        // Replicate Zig `bcryptWithTruncation` / the crate's `_hash_password`:
        // null-terminate then clamp to 72 bytes before feeding the cipher.
        let mut buf = [0u8; 72];
        let copy_len = password.len().min(72);
        buf[..copy_len].copy_from_slice(&password[..copy_len]);
        let used = (copy_len + 1).min(72);

        let computed = vendor::bcrypt(u32::from(rounds_log), salt, &buf[..used]);

        // Zig: `if (!mem.eql(u8, &hash, expected_hash)) return PasswordVerificationFailed`.
        // Compare in constant time like the `$2b$` path (BoringSSL `CRYPTO_memcmp`).
        if bun_boringssl_sys::constant_time_eq(&computed[..DK_LENGTH], &expected) {
            Ok(())
        } else {
            Err(bun_core::err!("PasswordVerificationFailed"))
        }
    }
}

// ported from: vendor/zig/lib/std/crypto/{argon2,bcrypt}.zig
