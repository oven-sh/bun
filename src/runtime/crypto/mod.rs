use crate::jsc::{JSGlobalObject, JSValue};

// ─── submodules ───────────────────────────────────────────────────────────
// `bun_boringssl_sys` bindgen output now exists; `hmac` compiles standalone.
// Remaining submodules blocked on `bun_jsc` method surface (stub types have
// no `.err()`/`.to_js()` etc.). Phase-A drafts preserved on disk via `#[path]`.

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

pub fn create_crypto_error(global_this: &JSGlobalObject, err_code: u32) -> JSValue {
    boringssl_jsc::err_to_js(global_this, err_code)
}

// ─── B-2 type-surface stubs removed ──────────────────────────────────────
// The inline `password_object`/`crypto_hasher` stub modules that lived here
// during phase-B (struct/state un-gate) are now superseded by the full
// `#[path = "PasswordObject.rs"]` / `#[path = "CryptoHasher.rs"]` drafts
// un-gated above. Re-exports below resolve through those files.

/// For usage in Rust (`src/runtime/crypto/PBKDF2.zig` `pub fn pbkdf2`).
///
/// Returns `Some(output)` on success, `None` on BoringSSL error.
// PORT NOTE: Zig nests `pbkdf2`/`Algorithm` inside the `EVP` struct. Stable
// Rust has no inherent associated types, so callers reach them via the
// `evp` module re-exported as `EVP` (see `pub use evp as EVP` below) —
// `EVP::pbkdf2(..)` / `EVP::Algorithm::Sha256` resolve through the module.
pub fn pbkdf2<'a>(
    output: &'a mut [u8],
    password: &[u8],
    salt: &[u8],
    iteration_count: u32,
    algorithm: evp::Algorithm,
) -> Option<&'a [u8]> {
    use bun_boringssl_sys as boringssl;
    use core::ffi::c_uint;

    output.fill(0);
    boringssl::ERR_clear_error();
    // `Algorithm::md()` lives in the lowered `bun_sha_hmac` crate and returns its
    // own opaque `EVP_MD` newtype; both name the same BoringSSL `env_md_st`, so
    // cast through to the `bun_boringssl_sys` spelling that `PKCS5_PBKDF2_HMAC`
    // is declared against.
    let digest = algorithm.md()?.cast::<boringssl::EVP_MD>();
    // SAFETY: password/salt/output are valid for the given lengths; digest is a
    // static EVP_MD singleton returned by BoringSSL above.
    let rc = unsafe {
        boringssl::PKCS5_PBKDF2_HMAC(
            if password.is_empty() {
                core::ptr::null()
            } else {
                password.as_ptr()
            },
            password.len(),
            salt.as_ptr(),
            salt.len(),
            iteration_count as c_uint,
            digest,
            output.len(),
            output.as_mut_ptr(),
        )
    };
    if rc <= 0 {
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

// Zig nests `Algorithm`/`pbkdf2`/`PBKDF2` inside the `EVP` struct; stable Rust
// has no inherent associated types, so re-export the module under the struct
// name. `crypto::EVP::pbkdf2` / `crypto::EVP::Algorithm` resolve via the module,
// and the struct itself is reachable as `crypto::EVP::EVP` if ever needed.
pub use evp as EVP;
pub use hmac::HMAC;

// `comptime { CryptoHasher.Extern.@"export"(); }` — dropped; Rust links what's `pub`.

// ported from: src/runtime/crypto/crypto.zig
