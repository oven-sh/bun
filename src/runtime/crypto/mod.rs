use crate::jsc::{JSGlobalObject, JSValue};

// ─── submodules ───────────────────────────────────────────────────────────
// `bun_boringssl_sys` bindgen output now exists; `hmac` compiles standalone.
// Remaining submodules blocked on `bun_jsc` method surface (stub types have
// no `.err()`/`.to_js()` etc.). Phase-A drafts preserved on disk via `#[path]`.

#[path = "pwhash.rs"]
pub mod pwhash;
#[cfg(any())]
#[path = "PasswordObject.rs"]
pub mod password_object;
#[cfg(any())]
#[path = "CryptoHasher.rs"]
pub mod crypto_hasher;
#[path = "HMAC.rs"]
pub mod hmac;
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

// ─── real type surface (B-2 struct/state un-gate) ─────────────────────────
// Full method bodies (host fns, `from_js`, WorkPool jobs) stay in the gated
// drafts above — they need `bun_jsc::{host_fn, JSGlobalObject method surface,
// node::StringOrBuffer}` and `bun_crypto_std::{sha3, blake2}`. The pwhash shim
// (argon2/bcrypt API surface) now lives at `super::pwhash`; vendor impl pending.
pub mod password_object {
    /// Namespace marker — `Bun.password` is a plain JS object whose methods
    /// dispatch to `JSPasswordObject` host fns; no native fields.
    pub struct PasswordObject;
    pub struct JSPasswordObject;

    #[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
    #[repr(u8)]
    pub enum Algorithm {
        #[strum(serialize = "argon2i")]
        Argon2i,
        #[strum(serialize = "argon2d")]
        Argon2d,
        #[strum(serialize = "argon2id")]
        Argon2id,
        #[strum(serialize = "bcrypt")]
        Bcrypt,
    }

    #[derive(Copy, Clone)]
    pub struct Argon2Params {
        pub time_cost: u32,
        pub memory_cost: u32,
    }
    impl Argon2Params {
        pub const DEFAULT: Self = Self {
            time_cost: super::pwhash::argon2::Params::INTERACTIVE_2ID_T,
            memory_cost: super::pwhash::argon2::Params::INTERACTIVE_2ID_M,
        };
    }

    /// Zig: `Algorithm.Value = union(Algorithm)`.
    #[derive(Copy, Clone)]
    pub enum AlgorithmValue {
        Argon2i(Argon2Params),
        Argon2d(Argon2Params),
        Argon2id(Argon2Params),
        /// bcrypt cost (Zig: u6).
        Bcrypt(u8),
    }
    impl AlgorithmValue {
        pub const BCRYPT_DEFAULT: u8 = 10;
        pub const DEFAULT: Self = Self::Argon2id(Argon2Params::DEFAULT);
    }

    impl Algorithm {
        pub const LABEL: phf::Map<&'static [u8], Algorithm> = phf::phf_map! {
            b"argon2i" => Algorithm::Argon2i,
            b"argon2d" => Algorithm::Argon2d,
            b"argon2id" => Algorithm::Argon2id,
            b"bcrypt" => Algorithm::Bcrypt,
        };
    }
}
pub mod crypto_hasher {
    use super::{evp, hmac};

    /// `union(enum)` → Rust enum with payload variants. `.classes.ts`
    /// payload (the C++ JSCell wrapper stays generated; this is `m_ctx`).
    pub enum CryptoHasher {
        /// HMAC_CTX contains 3 EVP_CTX, so store as a pointer.
        Hmac(Option<Box<hmac::HMAC>>),
        Evp(evp::EVP),
        Zig(CryptoHasherZig),
    }

    /// Wraps the Zig-stdlib hashers BoringSSL doesn't ship (sha3-*, blake2,
    /// shake). `algorithm` discriminates; `state` is the in-progress digest
    /// boxed behind an erased pointer because the variant set isn't closed
    /// at this tier.
    pub struct CryptoHasherZig {
        pub algorithm: evp::Algorithm,
        // TODO(b2-blocked): bun_crypto_std::{sha3,blake2} state union.
        // Erased until the std-crypto shim crate exists.
        pub state: *mut core::ffi::c_void,
        pub digest_length: u16,
    }

    /// `bun.sha.Hashers.*` newtype hashers exposed as `Bun.SHA1` etc.
    /// Each is a `.classes.ts` payload over the BoringSSL one-shot ctx.
    macro_rules! decl_hasher {
        ($($name:ident => $ctx:ty, $len:expr);* $(;)?) => {$(
            pub struct $name {
                pub ctx: $ctx,
            }
            impl $name {
                pub const DIGEST_LENGTH: usize = $len;
            }
        )*};
    }
    // PORT NOTE: Zig `bun.sha.Hashers.*` all wrap `BoringSSL.EVP_MD_CTX`, NOT
    // the per-algorithm `SHA*_CTX` one-shot structs (see src/sha_hmac/sha.zig).
    decl_hasher! {
        MD4        => bun_boringssl_sys::EVP_MD_CTX, 16;
        MD5        => bun_boringssl_sys::EVP_MD_CTX, 16;
        SHA1       => bun_boringssl_sys::EVP_MD_CTX, 20;
        SHA224     => bun_boringssl_sys::EVP_MD_CTX, 28;
        SHA256     => bun_boringssl_sys::EVP_MD_CTX, 32;
        SHA384     => bun_boringssl_sys::EVP_MD_CTX, 48;
        SHA512     => bun_boringssl_sys::EVP_MD_CTX, 64;
        SHA512_256 => bun_boringssl_sys::EVP_MD_CTX, 32;
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
    algorithm: evp::Algorithm,
) -> Option<&'a [u8]> {
    use bun_boringssl_sys as boringssl;
    use core::ffi::c_uint;

    output.fill(0);
    // SAFETY: FFI into BoringSSL; ERR_clear_error has no preconditions.
    unsafe { boringssl::ERR_clear_error() };
    let digest = algorithm.md()?;
    // SAFETY: password/salt/output are valid for the given lengths; digest is a
    // static EVP_MD singleton returned by BoringSSL above.
    let rc = unsafe {
        boringssl::PKCS5_PBKDF2_HMAC(
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
