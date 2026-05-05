use crate::jsc::{JSGlobalObject, JSValue};

// ─── submodules ───────────────────────────────────────────────────────────
// All submodules currently blocked on `bun_boringssl_sys` (bindgen output not
// yet generated — see src/boringssl_sys/boringssl.rs) and on `bun_jsc` method
// surface (stub types have no `.err()`/`.to_js()` etc.). Phase-A drafts are
// preserved on disk via `#[path]`; un-gate per-file once the sys crate lands.

#[cfg(any())]
#[path = "PasswordObject.rs"]
pub mod password_object;
#[cfg(any())]
#[path = "CryptoHasher.rs"]
pub mod crypto_hasher;
#[cfg(any())]
#[path = "HMAC.rs"]
pub mod hmac;
#[cfg(any())]
#[path = "EVP.rs"]
pub mod evp;
#[cfg(any())]
#[path = "PBKDF2.rs"]
pub mod pbkdf2;
#[cfg(any())]
#[path = "boringssl_jsc.rs"]
pub mod boringssl_jsc;

pub fn create_crypto_error(global_this: &JSGlobalObject, err_code: u32) -> JSValue {
    #[cfg(any())]
    {
        return boringssl_jsc::err_to_js(global_this, err_code);
    }
    // TODO(b2-blocked): bun_boringssl_sys::ERR_error_string_n
    // TODO(b2-blocked): bun_jsc::JSGlobalObject::err
    let _ = (global_this, err_code);
    todo!("create_crypto_error: blocked on bun_boringssl_sys + bun_jsc")
}

// ─── stub re-exports (replace with real ones as submodules un-gate) ───────
pub mod password_object {
    pub struct PasswordObject;
    pub struct JSPasswordObject;
}
pub mod crypto_hasher {
    pub struct CryptoHasher;
    macro_rules! stub_hasher { ($($n:ident),*) => { $(pub struct $n;)* } }
    stub_hasher!(MD4, MD5, SHA1, SHA224, SHA256, SHA384, SHA512, SHA512_256);
}
pub mod hmac {
    pub struct HMAC;
}
pub mod evp {
    use core::ffi::{c_int, c_uint, c_void};

    pub struct EVP;
    #[derive(Copy, Clone, Eq, PartialEq)]
    pub enum Algorithm {
        // TODO(b2-blocked): bun_boringssl_sys::EVP_MD — full variant list gated
        Sha256,
    }

    // TODO(b2-blocked): bun_boringssl_sys — bindgen output not yet generated;
    // declare the minimal BoringSSL surface needed for `pbkdf2` locally. Signatures
    // match vendor/boringssl/include/openssl/evp.h and src/boringssl_sys/boringssl.zig.
    unsafe extern "C" {
        fn ERR_clear_error();
        fn EVP_sha256() -> *const c_void;
        fn PKCS5_PBKDF2_HMAC(
            password: *const u8,
            password_len: usize,
            salt: *const u8,
            salt_len: usize,
            iterations: c_uint,
            digest: *const c_void,
            key_len: usize,
            out_key: *mut u8,
        ) -> c_int;
    }

    impl Algorithm {
        pub fn md(self) -> Option<*const c_void> {
            // SAFETY: BoringSSL digest accessor fns are thread-safe and return static singletons.
            unsafe {
                match self {
                    Algorithm::Sha256 => Some(EVP_sha256()),
                }
            }
        }
    }

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
        algorithm: Algorithm,
    ) -> Option<&'a [u8]> {
        output.fill(0);
        // SAFETY: FFI into BoringSSL; ERR_clear_error has no preconditions.
        unsafe { ERR_clear_error() };
        let digest = algorithm.md()?;
        // SAFETY: password/salt/output are valid for the given lengths; digest is a
        // static EVP_MD singleton returned by BoringSSL above.
        let rc = unsafe {
            PKCS5_PBKDF2_HMAC(
                if password.is_empty() { core::ptr::null() } else { password.as_ptr() },
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
}

pub use password_object::PasswordObject;
pub use password_object::JSPasswordObject;

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/crypto/crypto.zig (28 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export module; HMAC/EVP whole-module imports become `pub mod hmac/evp`
// ──────────────────────────────────────────────────────────────────────────
