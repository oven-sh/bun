//! CSRF Token implementation for Bun
//! It provides protection against Cross-Site Request Forgery attacks
//! by generating and validating tokens using HMAC signatures

#![allow(unused, nonstandard_style)]

// TODO(b1): bun_boringssl_sys missing — gated; un-gate in B-2
#[cfg(any())]
use bun_boringssl_sys as boring;
// TODO(b1): bun_sha_hmac missing — gated; un-gate in B-2
#[cfg(any())]
use bun_sha_hmac::hmac;
// TODO(b1): bun_str missing — gated; un-gate in B-2
#[cfg(any())]
use bun_str::strings;

// CYCLEBREAK: TYPE_ONLY — EVP::Algorithm moved down to bun_sha_hmac (move-in pass defines it there)
#[cfg(any())]
use bun_sha_hmac::Algorithm;
// CYCLEBREAK: TYPE_ONLY — node::Encoding moved down to bun_str (move-in pass defines it there)
#[cfg(any())]
use bun_str::Encoding as NodeEncoding;

// ──────────────────────────────────────────────────────────────────────────
// B-1 stub surface (opaque local stand-ins for gated deps; remove in B-2)
// ──────────────────────────────────────────────────────────────────────────
/// TODO(b1): stub for `bun_sha_hmac::Algorithm`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Algorithm(());
impl Algorithm {
    pub const Sha256: Self = Self(());
}
/// TODO(b1): stub for `bun_str::Encoding`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct NodeEncoding(());

/// Default expiration time for tokens (24 hours)
pub const DEFAULT_EXPIRATION_MS: u64 = 24 * 60 * 60 * 1000;

/// Default HMAC algorithm used for token signing
pub const DEFAULT_ALGORITHM: Algorithm = Algorithm::Sha256;

/// Error types for CSRF operations
// TODO(b1): thiserror not in deps — manual Display/Error impl for now
#[derive(strum::IntoStaticStr, Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    InvalidToken,
    ExpiredToken,
    TokenCreationFailed,
    DecodingFailed,
}
impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(<&'static str>::from(*self))
    }
}
impl std::error::Error for Error {}

impl From<Error> for bun_core::Error {
    fn from(e: Error) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

/// Options for generating CSRF tokens
// TODO(port): Zig has per-field defaults; Rust callers must specify all fields
pub struct GenerateOptions<'a> {
    /// Secret key to use for signing
    pub secret: &'a [u8],
    /// How long the token should be valid (in milliseconds)
    pub expires_in_ms: u64, // = DEFAULT_EXPIRATION_MS
    /// Format to encode the token in
    pub encoding: TokenFormat, // = .base64url
    /// Algorithm to use for signing
    pub algorithm: Algorithm, // = DEFAULT_ALGORITHM
}

/// Options for validating CSRF tokens
// TODO(port): Zig has per-field defaults; Rust callers must specify all fields
pub struct VerifyOptions<'a> {
    /// The token to verify
    pub token: &'a [u8],
    /// Secret key used to sign the token
    pub secret: &'a [u8],
    /// Maximum age of the token in milliseconds
    pub max_age_ms: u64, // = DEFAULT_EXPIRATION_MS
    /// Encoding to use for the token
    pub encoding: TokenFormat, // = .base64url
    /// Algorithm to use for signing
    pub algorithm: Algorithm, // = DEFAULT_ALGORITHM
}

/// Token encoding format
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TokenFormat {
    Base64,
    Base64Url,
    Hex,
}

impl TokenFormat {
    pub fn to_node_encoding(self) -> NodeEncoding {
        #[cfg(any())]
        {
            match self {
                TokenFormat::Base64 => NodeEncoding::Base64,
                TokenFormat::Base64Url => NodeEncoding::Base64Url,
                TokenFormat::Hex => NodeEncoding::Hex,
            }
        }
        #[cfg(all())]
        {
            todo!("b1-stub: TokenFormat::to_node_encoding")
        }
    }
}

/// Generate a new CSRF token
///
/// Parameters:
/// - options: Configuration for token generation
/// - out_buffer: caller-provided buffer for the raw token bytes
///
/// Returns: A slice into `out_buffer` containing the raw token
pub fn generate<'a>(
    options: GenerateOptions<'_>,
    out_buffer: &'a mut [u8; 512],
) -> Result<&'a mut [u8], Error> {
    #[cfg(all())]
    {
        let _ = (options, out_buffer);
        return todo!("b1-stub: csrf::generate — gated on bun_sha_hmac/bun_boringssl_sys");
    }
    #[cfg(any())]
    {
    // Generate nonce from entropy
    let mut nonce = [0u8; 16];
    bun_core::csprng(&mut nonce);

    // Current timestamp in milliseconds
    // TODO(port): verify bun_core::time::milli_timestamp() exists (Zig: std.time.milliTimestamp())
    let timestamp: i64 = bun_core::time::milli_timestamp();
    let timestamp_u64: u64 = timestamp as u64; // @bitCast i64 -> u64

    // Write timestamp to out_buffer
    let mut timestamp_bytes = [0u8; 8];
    timestamp_bytes.copy_from_slice(&timestamp_u64.to_be_bytes());
    let mut expires_in_bytes = [0u8; 8];
    expires_in_bytes.copy_from_slice(&options.expires_in_ms.to_be_bytes());
    // Prepare payload for signing: timestamp|nonce
    let mut payload_buf = [0u8; 32]; // 8 (timestamp) + 16 (nonce)
    payload_buf[0..8].copy_from_slice(&timestamp_bytes);
    payload_buf[8..24].copy_from_slice(&nonce);
    payload_buf[24..32].copy_from_slice(&expires_in_bytes);

    // Sign the payload
    let mut digest_buf = [0u8; boring::EVP_MAX_MD_SIZE as usize];
    let digest = match hmac::generate(options.secret, &payload_buf, options.algorithm, &mut digest_buf) {
        Some(d) => d,
        None => return Err(Error::TokenCreationFailed),
    };

    // Create the final token: timestamp|nonce|expires_in|signature in out_buffer
    out_buffer[0..8].copy_from_slice(&timestamp_bytes);
    out_buffer[8..24].copy_from_slice(&nonce);
    out_buffer[24..32].copy_from_slice(&expires_in_bytes);
    out_buffer[32..32 + digest.len()].copy_from_slice(digest);

    // Return slice of the output buffer with the final token
    let len = 32 + digest.len();
    Ok(&mut out_buffer[0..len])
    } // end #[cfg(any())]
}

/// Validate a CSRF token
///
/// Parameters:
/// - options: Configuration for token validation
///
/// Returns: true if valid, false if invalid
pub fn verify(options: VerifyOptions<'_>) -> bool {
    #[cfg(all())]
    {
        let _ = options;
        return todo!("b1-stub: csrf::verify — gated on bun_sha_hmac/bun_boringssl_sys/bun_str");
    }
    #[cfg(any())]
    {
    // Detect the encoding format
    let encoding: TokenFormat = options.encoding;

    // Allocate output buffer for decoded data
    let mut buf = [0u8; boring::EVP_MAX_MD_SIZE as usize + 32];
    let mut token = options.token;
    // check if ends with \0
    if !token.is_empty() && token[token.len() - 1] == 0 {
        token = &token[0..token.len() - 1];
    }

    // PORT NOTE: reshaped for borrowck — compute decoded_len, then borrow buf immutably afterward
    let decoded_len: usize = match encoding {
        // shares same decoder but encoder is different see encoding.zig
        TokenFormat::Base64Url | TokenFormat::Base64 => {
            // do the same as Buffer.from(token, "base64url" | "base64")
            // "\r\n\t " ++ VT (0x0b)
            let slice = strings::trim(token, b"\r\n\t \x0b");
            if slice.is_empty() {
                return false;
            }

            let outlen = bun_base64::decode_len(slice);
            if outlen > buf.len() {
                return false;
            }
            let wrote = bun_base64::decode(&mut buf[0..outlen], slice).count;
            wrote
        }
        TokenFormat::Hex => {
            if token.len() % 2 != 0 {
                return false;
            }
            // decoded len
            let decoded_len = token.len() / 2;
            if decoded_len > buf.len() {
                return false;
            }
            let result = strings::decode_hex_to_bytes_truncate(&mut buf[0..decoded_len], token);
            if result == decoded_len {
                decoded_len
            } else {
                return false;
            }
        }
    };
    let decoded: &[u8] = &buf[0..decoded_len];

    // Minimum token length: 8 (timestamp) + 16 (nonce) + 8 (expires_in) + 32 (minimum HMAC-SHA256 size)
    if decoded.len() < 64 {
        return false;
    }
    // We successfully decoded the token but it could be a bad token
    // base64 and hex can have ambiguity so we need to check for weird cases and reject them
    // it could also be a handcrafted token that is invalid

    // Extract timestamp (first 8 bytes)
    let timestamp = u64::from_be_bytes(decoded[0..8].try_into().unwrap());

    // Check if token has expired
    // TODO(port): verify bun_core::time::milli_timestamp() exists (Zig: std.time.milliTimestamp())
    let current_time: u64 = bun_core::time::milli_timestamp() as u64; // @bitCast i64 -> u64
    // Extract expires_in (last 8 bytes)
    let expires_in = u64::from_be_bytes(decoded[24..32].try_into().unwrap());
    {
        // respect the token's expiration time
        if expires_in > 0 {
            // handle overflow for invalid expiry, which means bad token
            if u64::MAX - timestamp < expires_in {
                return false;
            }
            if current_time > timestamp + expires_in {
                return false;
            }
        }
    }
    {
        // repect options.max_age_ms
        let expiry = options.max_age_ms;
        if expiry > 0 {
            // handle overflow for invalid expiry, which means bad token
            if u64::MAX - timestamp < expiry {
                return false;
            }
            if current_time > timestamp + expiry {
                return false;
            }
        }
    }
    // Extract the parts
    let payload = &decoded[0..32]; // timestamp + nonce + expires_in
    let received_signature = &decoded[32..];

    // Verify the signature
    let mut expected_signature = [0u8; boring::EVP_MAX_MD_SIZE as usize];
    let signature = match hmac::generate(options.secret, payload, options.algorithm, &mut expected_signature) {
        Some(s) => s,
        None => return false,
    };

    // Compare signatures in constant time
    if received_signature.len() != signature.len() {
        return false;
    }

    // Use BoringSSL's constant-time comparison to prevent timing attacks
    // SAFETY: both pointers are valid for `signature.len()` bytes (checked above)
    unsafe {
        boring::CRYPTO_memcmp(
            received_signature.as_ptr().cast(),
            signature.as_ptr().cast(),
            signature.len(),
        ) == 0
    }
    } // end #[cfg(any())]
}

// NOTE: the Zig file re-exports csrf__generate / csrf__verify from
// ../runtime/api/csrf_jsc.zig — per PORTING.md these *_jsc aliases are
// deleted; JS bindings live in the *_jsc crate as extension methods.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/csrf/csrf.zig (220 lines)
//   confidence: medium
//   todos:      4
//   notes:      EVP::Algorithm / Node::Encoding crate paths and milli_timestamp() helper need Phase B verification; option-struct field defaults dropped
// ──────────────────────────────────────────────────────────────────────────
