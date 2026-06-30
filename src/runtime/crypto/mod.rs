use bun_jsc::{JSGlobalObject, JSValue};

// ─── submodules ───────────────────────────────────────────────────────────

#[path = "pwhash.rs"]
pub mod pwhash;

#[path = "PasswordObject.rs"]
pub mod password_object;

#[path = "CryptoHasher.rs"]
pub mod crypto_hasher;
#[path = "EVP.rs"]
pub mod evp;
#[path = "HMAC.rs"]
pub mod hmac;

#[path = "PBKDF2.rs"]
pub mod pbkdf2;

#[path = "boringssl_jsc.rs"]
pub mod boringssl_jsc;

pub(crate) fn create_crypto_error(global_this: &JSGlobalObject, err_code: u32) -> JSValue {
    boringssl_jsc::err_to_js(global_this, err_code)
}

/// Returns `Some(output)` on success, `None` on BoringSSL error.
// Stable Rust has no inherent associated types, so `pbkdf2`/`Algorithm` cannot
// nest inside the `EVP` struct; callers reach them via the `evp` module
// re-exported as `EVP` (see `pub use evp as EVP` below) —
// `EVP::pbkdf2(..)` / `EVP::Algorithm::Sha256` resolve through the module.
pub fn pbkdf2<'a>(
    output: &'a mut [u8],
    password: &[u8],
    salt: &[u8],
    iteration_count: u32,
    algorithm: evp::Algorithm,
) -> Option<&'a [u8]> {
    let digest = algorithm.md()?;
    if !bun_sha_hmac::pbkdf2_hmac(password, salt, iteration_count, digest, output) {
        return None;
    }
    Some(output)
}

pub use password_object::JSPasswordObject;
pub use password_object::PasswordObject;

pub use crypto_hasher::CryptoHasher;
pub use crypto_hasher::MD4;
pub use crypto_hasher::MD5;
pub use crypto_hasher::SHA1;
pub use crypto_hasher::SHA224;
pub use crypto_hasher::SHA256;
pub use crypto_hasher::SHA384;
pub use crypto_hasher::SHA512;
pub use crypto_hasher::SHA512_256;

// Stable Rust has no inherent associated types, so re-export the module under
// the struct name. `crypto::EVP::pbkdf2` / `crypto::EVP::Algorithm` resolve via
// the module, and the struct itself is reachable as `crypto::EVP::EVP` if ever needed.
pub use evp as EVP;
pub use hmac::HMAC;
