#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// TODO(b1): bun_boringssl / bun_boringssl_sys crates missing — Phase-A drafts gated
// behind `#[cfg(any())]` until those FFI crates exist. Stub surface below mirrors
// the public types/fns so dependents can compile.

#[cfg(any())]
pub mod sha;
#[cfg(any())]
pub mod hmac;

// ──────────────────────────────────────────────────────────────────────────
// Stub surface (B-1 gate-and-stub). Un-gating happens in B-2.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(any()))]
pub mod sha {
    pub mod evp {
        // Opaque hasher newtypes — real impls in gated sha.rs `new_evp!` expansions.
        pub struct SHA1(());
        pub struct MD5(());
        pub struct MD4(());
        pub struct SHA224(());
        pub struct SHA512(());
        pub struct SHA384(());
        pub struct SHA256(());
        pub struct SHA512_256(());
        pub struct MD5_SHA1(());
        pub struct Blake2(());

        // CYCLEBREAK MOVE_DOWN: bun_jsc::api::bun::crypto::evp::Algorithm
        // Kept un-gated so `csrf` / `hmac` can name it without depending upward.
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
        #[non_exhaustive]
        pub enum Algorithm {
            Blake2b256,
            Blake2b512,
            Blake2s256,
            Md4,
            Md5,
            Ripemd160,
            Sha1,
            Sha224,
            Sha256,
            Sha384,
            Sha512,
            Sha512_224,
            Sha512_256,
            Sha3_224,
            Sha3_256,
            Sha3_384,
            Sha3_512,
            Shake128,
            Shake256,
        }

        impl Algorithm {
            // TODO(b1): real return is Option<*const bun_boringssl_sys::EVP_MD>
            pub fn md(self) -> Option<*const core::ffi::c_void> {
                todo!("gated: bun_boringssl_sys missing")
            }
        }
    }

    pub use evp::Algorithm;
    pub use evp::SHA1;
    pub use evp::MD5;
    pub use evp::MD4;
    pub use evp::SHA224;
    pub use evp::SHA512;
    pub use evp::SHA384;
    pub use evp::SHA256;
    pub use evp::SHA512_256;
    pub use evp::MD5_SHA1;

    pub mod hashers {
        pub struct SHA1(());
        pub struct SHA512(());
        pub struct SHA384(());
        pub struct SHA256(());
        pub struct SHA512_256(());
        pub struct RIPEMD160(());
    }
}

#[cfg(not(any()))]
pub mod hmac {
    use crate::sha::evp::Algorithm;

    // TODO(b1): real `out` is &mut [u8; bun_boringssl_sys::EVP_MAX_MD_SIZE as usize]
    pub fn generate<'a>(
        _key: &[u8],
        _data: &[u8],
        _algorithm: Algorithm,
        _out: &'a mut [u8],
    ) -> Option<&'a [u8]> {
        todo!("gated: bun_boringssl_sys missing")
    }
}

// Convenience re-export matching Phase-A intent (`crate::evp::Algorithm`).
pub use sha::evp;
