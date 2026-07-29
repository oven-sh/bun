use crate::jsc::{JSGlobalObject, JSValue};

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

pub use crypto_hasher::CryptoHasher;
pub use crypto_hasher::MD4;
pub use crypto_hasher::MD5;
pub use crypto_hasher::SHA1;
pub use crypto_hasher::SHA224;
pub use crypto_hasher::SHA256;
pub use crypto_hasher::SHA384;
pub use crypto_hasher::SHA512;
pub use crypto_hasher::SHA512_256;

pub use hmac::HMAC;
