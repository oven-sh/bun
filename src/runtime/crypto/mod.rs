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
    pub struct EVP;
    #[derive(Copy, Clone, Eq, PartialEq)]
    pub enum Algorithm {
        // TODO(b2-blocked): bun_boringssl_sys::EVP_MD — full variant list gated
        Sha256,
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

pub use evp::EVP;
pub use hmac::HMAC;

// `comptime { CryptoHasher.Extern.@"export"(); }` — dropped; Rust links what's `pub`.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/crypto/crypto.zig (28 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export module; HMAC/EVP whole-module imports become `pub mod hmac/evp`
// ──────────────────────────────────────────────────────────────────────────
