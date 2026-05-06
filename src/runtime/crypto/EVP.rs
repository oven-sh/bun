use core::ffi::{c_uint, CStr};

use bun_alloc::AllocError;
use bun_boringssl_sys as boringssl;
use bun_str::{self as bstr, strings, String as BunString, ZigString};

use crate::jsc::JSGlobalObject;
use enum_map::{Enum, EnumMap};
use phf::phf_map;
use strum::IntoStaticStr;

pub struct EVP {
    pub ctx: boringssl::EVP_MD_CTX,
    // FFI: BoringSSL EVP_MD singletons are static for the process lifetime.
    pub md: *const boringssl::EVP_MD,
    pub algorithm: Algorithm,
}

// we do this to avoid asking BoringSSL what the digest name is
// because that API is confusing
#[derive(Copy, Clone, Eq, PartialEq, Enum, IntoStaticStr)]
pub enum Algorithm {
    // @"DSA-SHA",
    // @"DSA-SHA1",
    // @"MD5-SHA1",
    // @"RSA-MD5",
    // @"RSA-RIPEMD160",
    // @"RSA-SHA1",
    // @"RSA-SHA1-2",
    // @"RSA-SHA224",
    // @"RSA-SHA256",
    // @"RSA-SHA384",
    // @"RSA-SHA512",
    // @"ecdsa-with-SHA1",
    #[strum(serialize = "blake2b256")]
    Blake2b256,
    #[strum(serialize = "blake2b512")]
    Blake2b512,
    #[strum(serialize = "blake2s256")]
    Blake2s256,
    #[strum(serialize = "md4")]
    Md4,
    #[strum(serialize = "md5")]
    Md5,
    #[strum(serialize = "ripemd160")]
    Ripemd160,
    #[strum(serialize = "sha1")]
    Sha1,
    #[strum(serialize = "sha224")]
    Sha224,
    #[strum(serialize = "sha256")]
    Sha256,
    #[strum(serialize = "sha384")]
    Sha384,
    #[strum(serialize = "sha512")]
    Sha512,
    #[strum(serialize = "sha512-224")]
    Sha512_224,
    #[strum(serialize = "sha512-256")]
    Sha512_256,

    #[strum(serialize = "sha3-224")]
    Sha3_224,
    #[strum(serialize = "sha3-256")]
    Sha3_256,
    #[strum(serialize = "sha3-384")]
    Sha3_384,
    #[strum(serialize = "sha3-512")]
    Sha3_512,
    #[strum(serialize = "shake128")]
    Shake128,
    #[strum(serialize = "shake256")]
    Shake256,
}

impl Algorithm {
    pub fn md(self) -> Option<*const boringssl::EVP_MD> {
        // SAFETY: BoringSSL digest accessor fns are thread-safe and return static singletons.
        unsafe {
            match self {
                Algorithm::Blake2b256 => Some(boringssl::EVP_blake2b256()),
                Algorithm::Blake2b512 => Some(boringssl::EVP_blake2b512()),
                Algorithm::Md4 => Some(boringssl::EVP_md4()),
                Algorithm::Md5 => Some(boringssl::EVP_md5()),
                Algorithm::Ripemd160 => Some(boringssl::EVP_ripemd160()),
                Algorithm::Sha1 => Some(boringssl::EVP_sha1()),
                Algorithm::Sha224 => Some(boringssl::EVP_sha224()),
                Algorithm::Sha256 => Some(boringssl::EVP_sha256()),
                Algorithm::Sha384 => Some(boringssl::EVP_sha384()),
                Algorithm::Sha512 => Some(boringssl::EVP_sha512()),
                Algorithm::Sha512_224 => Some(boringssl::EVP_sha512_224()),
                Algorithm::Sha512_256 => Some(boringssl::EVP_sha512_256()),
                Algorithm::Sha3_224 => Some(boringssl::EVP_sha3_224()),
                Algorithm::Sha3_256 => Some(boringssl::EVP_sha3_256()),
                Algorithm::Sha3_384 => Some(boringssl::EVP_sha3_384()),
                Algorithm::Sha3_512 => Some(boringssl::EVP_sha3_512()),
                _ => None,
            }
        }
    }

    /// NUL-terminated tag name, equivalent to Zig's `@tagName(algorithm)` (which yields
    /// `[:0]const u8`). Needed for `EVP_get_digestbyname` which reads a C string.
    pub fn tag_cstr(self) -> &'static CStr {
        match self {
            Algorithm::Blake2b256 => c"blake2b256",
            Algorithm::Blake2b512 => c"blake2b512",
            Algorithm::Blake2s256 => c"blake2s256",
            Algorithm::Md4 => c"md4",
            Algorithm::Md5 => c"md5",
            Algorithm::Ripemd160 => c"ripemd160",
            Algorithm::Sha1 => c"sha1",
            Algorithm::Sha224 => c"sha224",
            Algorithm::Sha256 => c"sha256",
            Algorithm::Sha384 => c"sha384",
            Algorithm::Sha512 => c"sha512",
            Algorithm::Sha512_224 => c"sha512-224",
            Algorithm::Sha512_256 => c"sha512-256",
            Algorithm::Sha3_224 => c"sha3-224",
            Algorithm::Sha3_256 => c"sha3-256",
            Algorithm::Sha3_384 => c"sha3-384",
            Algorithm::Sha3_512 => c"sha3-512",
            Algorithm::Shake128 => c"shake128",
            Algorithm::Shake256 => c"shake256",
        }
    }

    // TODO(port): Zig built this at comptime via a labeled block iterating EnumArray.
    // bun_str::String is not const-constructible; use a lazy static in Phase B.
    pub fn names() -> &'static EnumMap<Algorithm, BunString> {
        static NAMES: std::sync::OnceLock<EnumMap<Algorithm, BunString>> = std::sync::OnceLock::new();
        NAMES.get_or_init(|| {
            EnumMap::from_fn(|key: Algorithm| BunString::static_(<&'static str>::from(key).as_bytes()))
        })
    }

    pub const MAP: phf::Map<&'static [u8], Algorithm> = phf_map! {
        b"blake2b256" => Algorithm::Blake2b256,
        b"blake2b512" => Algorithm::Blake2b512,
        b"blake2s256" => Algorithm::Blake2s256,
        b"ripemd160" => Algorithm::Ripemd160,
        b"rmd160" => Algorithm::Ripemd160,
        b"md4" => Algorithm::Md4,
        b"md5" => Algorithm::Md5,
        b"sha1" => Algorithm::Sha1,
        b"sha128" => Algorithm::Sha1,
        b"sha224" => Algorithm::Sha224,
        b"sha256" => Algorithm::Sha256,
        b"sha384" => Algorithm::Sha384,
        b"sha512" => Algorithm::Sha512,
        b"sha-1" => Algorithm::Sha1,
        b"sha-224" => Algorithm::Sha224,
        b"sha-256" => Algorithm::Sha256,
        b"sha-384" => Algorithm::Sha384,
        b"sha-512" => Algorithm::Sha512,
        b"sha-512/224" => Algorithm::Sha512_224,
        b"sha-512_224" => Algorithm::Sha512_224,
        b"sha-512224" => Algorithm::Sha512_224,
        b"sha512-224" => Algorithm::Sha512_224,
        b"sha-512/256" => Algorithm::Sha512_256,
        b"sha-512_256" => Algorithm::Sha512_256,
        b"sha-512256" => Algorithm::Sha512_256,
        b"sha512-256" => Algorithm::Sha512_256,
        // duplicate "sha384" entry in Zig source omitted (phf rejects duplicate keys)
        b"sha3-224" => Algorithm::Sha3_224,
        b"sha3-256" => Algorithm::Sha3_256,
        b"sha3-384" => Algorithm::Sha3_384,
        b"sha3-512" => Algorithm::Sha3_512,
        b"shake128" => Algorithm::Shake128,
        b"shake256" => Algorithm::Shake256,
        // b"md5-sha1" => .@"MD5-SHA1",
        // b"dsa-sha" => .@"DSA-SHA",
        // b"dsa-sha1" => .@"DSA-SHA1",
        // b"ecdsa-with-sha1" => .@"ecdsa-with-SHA1",
        // b"rsa-md5" => .@"RSA-MD5",
        // b"rsa-sha1" => .@"RSA-SHA1",
        // b"rsa-sha1-2" => .@"RSA-SHA1-2",
        // b"rsa-sha224" => .@"RSA-SHA224",
        // b"rsa-sha256" => .@"RSA-SHA256",
        // b"rsa-sha384" => .@"RSA-SHA384",
        // b"rsa-sha512" => .@"RSA-SHA512",
        // b"rsa-ripemd160" => .@"RSA-RIPEMD160",
    };
}

impl EVP {
    pub fn init(algorithm: Algorithm, md: *const boringssl::EVP_MD, engine: *mut boringssl::ENGINE) -> EVP {
        bun_boringssl::load();

        // SAFETY: ctx is fully initialized by EVP_MD_CTX_init before any read.
        let mut ctx: boringssl::EVP_MD_CTX = unsafe { core::mem::zeroed() };
        // SAFETY: FFI into BoringSSL; ctx is zeroed above and EVP_MD_CTX_init has no
        // preconditions on a zeroed ctx. md/engine are caller-validated (md is a static
        // singleton, engine may be null).
        unsafe {
            boringssl::EVP_MD_CTX_init(&mut ctx);
            let _ = boringssl::EVP_DigestInit_ex(&mut ctx, md, engine);
        }
        EVP { ctx, md, algorithm }
    }

    pub fn reset(&mut self, engine: *mut boringssl::ENGINE) {
        // SAFETY: FFI into BoringSSL; ERR_clear_error has no preconditions. self.ctx was
        // initialized in init() and remains valid for the lifetime of EVP; self.md is a
        // static singleton.
        unsafe {
            boringssl::ERR_clear_error();
            let _ = boringssl::EVP_DigestInit_ex(&mut self.ctx, self.md, engine);
        }
    }

    pub fn hash(&mut self, engine: *mut boringssl::ENGINE, input: &[u8], output: &mut [u8]) -> Option<u32> {
        // SAFETY: FFI into BoringSSL; ERR_clear_error has no preconditions.
        unsafe { boringssl::ERR_clear_error() };
        let mut outsize: c_uint = (output.len() as u16).min(self.size()) as c_uint;
        // SAFETY: input/output point to valid slices of the given lengths; outsize bounded by output.len().
        if unsafe {
            boringssl::EVP_Digest(
                input.as_ptr().cast(),
                input.len(),
                output.as_mut_ptr(),
                &mut outsize,
                self.md,
                engine,
            )
        } != 1
        {
            return None;
        }

        Some(outsize)
    }

    pub fn r#final<'a>(&mut self, engine: *mut boringssl::ENGINE, output: &'a mut [u8]) -> &'a mut [u8] {
        // SAFETY: FFI into BoringSSL; ERR_clear_error has no preconditions.
        unsafe { boringssl::ERR_clear_error() };
        let mut outsize: u32 = (output.len() as u16).min(self.size()) as u32;
        // SAFETY: output points to a valid mutable slice; outsize bounded by output.len().
        if unsafe { boringssl::EVP_DigestFinal_ex(&mut self.ctx, output.as_mut_ptr(), &mut outsize) } != 1 {
            return &mut output[..0];
        }

        self.reset(engine);

        &mut output[..outsize as usize]
    }

    pub fn update(&mut self, input: &[u8]) {
        // SAFETY: FFI into BoringSSL; ERR_clear_error has no preconditions. self.ctx is
        // initialized; input.as_ptr() is valid for input.len() bytes.
        unsafe {
            boringssl::ERR_clear_error();
            let _ = boringssl::EVP_DigestUpdate(&mut self.ctx, input.as_ptr().cast(), input.len());
        }
    }

    pub fn size(&self) -> u16 {
        // SAFETY: FFI into BoringSSL; self.ctx was initialized in init() and is valid for
        // the lifetime of EVP.
        unsafe { boringssl::EVP_MD_CTX_size(&self.ctx) as u16 }
    }

    pub fn copy(&self, engine: *mut boringssl::ENGINE) -> Result<EVP, AllocError> {
        // SAFETY: FFI into BoringSSL; ERR_clear_error has no preconditions.
        unsafe { boringssl::ERR_clear_error() };
        let mut new = EVP::init(self.algorithm, self.md, engine);
        // SAFETY: FFI into BoringSSL; both new.ctx and self.ctx are initialized EVP_MD_CTX
        // values (new.ctx via EVP::init above, self.ctx via the invariant on EVP).
        if unsafe { boringssl::EVP_MD_CTX_copy_ex(&mut new.ctx, &self.ctx) } == 0 {
            return Err(AllocError);
        }
        Ok(new)
    }

    pub fn by_name_and_engine(engine: *mut boringssl::ENGINE, name: &[u8]) -> Option<EVP> {
        // TODO(port): phf custom hasher — Zig used getWithEql(name, eqlCaseInsensitiveASCIIIgnoreLength).
        // Phase B: either lowercase `name` before lookup or switch to a case-insensitive phf.
        // Stack-lowercase: longest key in MAP is 11 bytes ("sha-512/256" / "blake2b256");
        // 32 is comfortable headroom.
        let mut buf = [0u8; 32];
        let lookup_key: &[u8] = if name.len() <= buf.len() {
            for (i, &b) in name.iter().enumerate() {
                buf[i] = b.to_ascii_lowercase();
            }
            &buf[..name.len()]
        } else {
            name
        };
        if let Some(&algorithm) = Algorithm::MAP.get(lookup_key) {
            if let Some(md) = algorithm.md() {
                return Some(EVP::init(algorithm, md, engine));
            }

            // PORT NOTE: Zig's `@tagName(algorithm)` is `[:0]const u8` (NUL-terminated).
            // strum's `<&'static str>::from(algorithm)` is NOT NUL-terminated, so use the
            // explicit `tag_cstr()` table for the C-string FFI.
            // SAFETY: FFI into BoringSSL; EVP_get_digestbyname expects a NUL-terminated
            // C string, which `tag_cstr()` guarantees.
            let md = unsafe { boringssl::EVP_get_digestbyname(algorithm.tag_cstr().as_ptr()) };
            if !md.is_null() {
                return Some(EVP::init(algorithm, md, engine));
            }
        }

        None
    }

    pub fn by_name(name: &ZigString, global: &JSGlobalObject) -> Option<EVP> {
        let name_str = name.to_slice();
        // `RareData::boring_engine()` returns `*mut` to bun_jsc's local opaque `ENGINE`
        // stub (bun_jsc has no bun_boringssl_sys dep). Both name the same C `ENGINE`
        // struct, so cast to the real bindgen type for the FFI call.
        let engine = global
            .bun_vm()
            .rare_data()
            .boring_engine()
            .cast::<boringssl::ENGINE>();
        Self::by_name_and_engine(engine, name_str.slice())
    }
}

impl Drop for EVP {
    fn drop(&mut self) {
        // https://github.com/oven-sh/bun/issues/3250
        // SAFETY: FFI into BoringSSL; self.ctx is valid for the lifetime of EVP and
        // EVP_MD_CTX_cleanup is safe to call on any initialized ctx (idempotent).
        unsafe {
            let _ = boringssl::EVP_MD_CTX_cleanup(&mut self.ctx);
        }
    }
}

pub type Digest = [u8; boringssl::EVP_MAX_MD_SIZE as usize];

// PORT NOTE: Zig nests `PBKDF2`/`pbkdf2` inside the `EVP` struct; the
// `crypto::EVP` re-export (module alias) lets `crypto::EVP::pbkdf2` resolve
// through this module. The `pbkdf2` submodule is gated (blocked on bun_jsc
// arg-parsing surface), so re-export the standalone helper from the parent
// stub for now.
// TODO(b2-blocked): bun_jsc — un-gate `super::pbkdf2` and swap to `pub use super::pbkdf2 as PBKDF2;`.
pub use super::pbkdf2;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/crypto/EVP.zig (222 lines)
//   confidence: medium
//   todos:      3
//   notes:      case-insensitive phf lookup + NUL-terminated @tagName for EVP_get_digestbyname need Phase B fixes; names() moved from comptime to OnceLock; `final` renamed to r#final (reserved keyword)
// ──────────────────────────────────────────────────────────────────────────
