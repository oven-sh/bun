use crate::jsc::{JSGlobalObject, JSValue};

// ─── submodules ───────────────────────────────────────────────────────────

#[path = "pwhash.rs"]
pub(crate) mod pwhash;

#[path = "PasswordObject.rs"]
pub(crate) mod password_object;

#[path = "CryptoHasher.rs"]
pub(crate) mod crypto_hasher;
#[path = "EVP.rs"]
pub(crate) mod evp;
#[path = "HMAC.rs"]
pub(crate) mod hmac;

#[path = "PBKDF2.rs"]
pub(crate) mod pbkdf2;

#[path = "boringssl_jsc.rs"]
pub(crate) mod boringssl_jsc;

pub(crate) fn create_crypto_error(global_this: &JSGlobalObject, err_code: u32) -> JSValue {
    boringssl_jsc::err_to_js(global_this, err_code)
}

pub(crate) use hmac::HMAC;
