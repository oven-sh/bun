use bun_jsc::{JSGlobalObject, JSValue};

pub mod password_object;
pub mod crypto_hasher;
pub mod hmac;
pub mod evp;

pub fn create_crypto_error(global_this: &JSGlobalObject, err_code: u32) -> JSValue {
    bun_boringssl::err_to_js(global_this, err_code)
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

// `comptime { CryptoHasher.Extern.@"export"(); }` — dropped; Rust links what's `pub`.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/crypto/crypto.zig (28 lines)
//   confidence: high
//   todos:      0
//   notes:      thin re-export module; HMAC/EVP whole-module imports become `pub mod hmac/evp`
// ──────────────────────────────────────────────────────────────────────────
