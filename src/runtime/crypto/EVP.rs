use core::ffi::{CStr, c_uint};

use bun_alloc::AllocError;
use bun_boringssl_sys as boringssl;
use bun_core::String as BunString;

pub(crate) struct EVP {
    pub ctx: boringssl::EVP_MD_CTX,
    // FFI: BoringSSL EVP_MD singletons are static for the process lifetime.
    md: *const boringssl::EVP_MD,
    algorithm: Algorithm,
}

// ──────────────────────────────────────────────────────────────────────────
// The `Algorithm` enum + `md()` live in
// `bun_sha_hmac::evp` so lower-tier crates (`bun_csrf`, `bun_sha_hmac::hmac`)
// can name it without depending upward on bun_runtime. Re-export the canonical
// enum here; the higher-tier extras (`lookup`, `tag_cstr`) live below as an
// extension trait / free fns on the re-exported type.
// ──────────────────────────────────────────────────────────────────────────
pub(crate) use bun_sha_hmac::evp::Algorithm;

/// Higher-tier helpers on the lowered `Algorithm` enum (orphan rules prevent an
/// inherent `impl` on a foreign type, so callers `use evp::AlgorithmExt as _;`).
pub(crate) trait AlgorithmExt: Copy + Sized {
    /// NUL-terminated tag name. Needed for `EVP_get_digestbyname` which reads
    /// a C string.
    fn tag_cstr(self) -> &'static CStr;
}

impl AlgorithmExt for Algorithm {
    fn tag_cstr(self) -> &'static CStr {
        match self {
            Algorithm::Blake2b256 => c"blake2b256",
            Algorithm::Blake2b512 => c"blake2b512",
            Algorithm::Blake2s256 => c"blake2s256",
            Algorithm::Md4 => c"md4",
            Algorithm::Md5 => c"md5",
            Algorithm::Md5Sha1 => c"md5-sha1",
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
}

/// Stable iteration order over every `Algorithm` variant — the lowered enum is
/// foreign, so we can't derive an iterator for it.
pub(crate) const ALL: [Algorithm; 20] = [
    Algorithm::Blake2b256,
    Algorithm::Blake2b512,
    Algorithm::Blake2s256,
    Algorithm::Md4,
    Algorithm::Md5,
    Algorithm::Md5Sha1,
    Algorithm::Ripemd160,
    Algorithm::Sha1,
    Algorithm::Sha224,
    Algorithm::Sha256,
    Algorithm::Sha384,
    Algorithm::Sha512,
    Algorithm::Sha512_224,
    Algorithm::Sha512_256,
    Algorithm::Sha3_224,
    Algorithm::Sha3_256,
    Algorithm::Sha3_384,
    Algorithm::Sha3_512,
    Algorithm::Shake128,
    Algorithm::Shake256,
];

/// Algorithm names joined as `"'a', 'b', … 'y' or 'z'"` (declaration order),
/// for "must be one of" error messages.
pub(crate) const ALGORITHM_ONE_OF: &str = "'blake2b256', 'blake2b512', 'blake2s256', 'md4', 'md5', \
'md5-sha1', 'ripemd160', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'sha512-224', 'sha512-256', \
'sha3-224', 'sha3-256', 'sha3-384', 'sha3-512', 'shake128' or 'shake256'";

bun_core::comptime_string_map! {
    /// Case-sensitive name → `Algorithm`. Keys must stay lowercase so
    /// `lookup_ignore_case` can use the ASCII-case-insensitive probe.
    static ALGORITHM_MAP: Algorithm = {
        b"md4" => Algorithm::Md4,
        b"md5" => Algorithm::Md5,
        b"md5-sha1" => Algorithm::Md5Sha1,
        b"sha1" => Algorithm::Sha1,
        b"sha-1" => Algorithm::Sha1,
        b"sha128" => Algorithm::Sha1,
        b"sha224" => Algorithm::Sha224,
        b"sha256" => Algorithm::Sha256,
        b"sha384" => Algorithm::Sha384,
        b"sha512" => Algorithm::Sha512,
        b"sha-224" => Algorithm::Sha224,
        b"sha-256" => Algorithm::Sha256,
        b"sha-384" => Algorithm::Sha384,
        b"sha-512" => Algorithm::Sha512,
        b"sha3-224" => Algorithm::Sha3_224,
        b"sha3-256" => Algorithm::Sha3_256,
        b"sha3-384" => Algorithm::Sha3_384,
        b"sha3-512" => Algorithm::Sha3_512,
        b"shake128" => Algorithm::Shake128,
        b"shake256" => Algorithm::Shake256,
        b"shake-128" => Algorithm::Shake128,
        b"shake-256" => Algorithm::Shake256,
        b"ripemd160" => Algorithm::Ripemd160,
        b"blake2b256" => Algorithm::Blake2b256,
        b"blake2b512" => Algorithm::Blake2b512,
        b"blake2s256" => Algorithm::Blake2s256,
        b"sha-512224" => Algorithm::Sha512_224,
        b"sha512-224" => Algorithm::Sha512_224,
        b"sha-512256" => Algorithm::Sha512_256,
        b"sha512-256" => Algorithm::Sha512_256,
        b"sha-512/224" => Algorithm::Sha512_224,
        b"sha-512_224" => Algorithm::Sha512_224,
        b"sha-512/256" => Algorithm::Sha512_256,
        b"sha-512_256" => Algorithm::Sha512_256,
    };
}

/// Node digest names that OpenSSL registers as aliases and BoringSSL does not.
/// A `listed` name appears in `crypto.getHashes()`.
struct DigestAlias {
    name: &'static str,
    algorithm: Algorithm,
    listed: bool,
}

#[rustfmt::skip]
static DIGEST_ALIASES: &[DigestAlias] = &[
    DigestAlias { name: "RSA-MD5", algorithm: Algorithm::Md5, listed: true },
    DigestAlias { name: "RSA-RIPEMD160", algorithm: Algorithm::Ripemd160, listed: true },
    DigestAlias { name: "RSA-SHA1", algorithm: Algorithm::Sha1, listed: true },
    DigestAlias { name: "RSA-SHA1-2", algorithm: Algorithm::Sha1, listed: true },
    DigestAlias { name: "RSA-SHA224", algorithm: Algorithm::Sha224, listed: true },
    DigestAlias { name: "RSA-SHA256", algorithm: Algorithm::Sha256, listed: true },
    DigestAlias { name: "RSA-SHA3-224", algorithm: Algorithm::Sha3_224, listed: true },
    DigestAlias { name: "RSA-SHA3-256", algorithm: Algorithm::Sha3_256, listed: true },
    DigestAlias { name: "RSA-SHA3-384", algorithm: Algorithm::Sha3_384, listed: true },
    DigestAlias { name: "RSA-SHA3-512", algorithm: Algorithm::Sha3_512, listed: true },
    DigestAlias { name: "RSA-SHA384", algorithm: Algorithm::Sha384, listed: true },
    DigestAlias { name: "RSA-SHA512", algorithm: Algorithm::Sha512, listed: true },
    DigestAlias { name: "RSA-SHA512/224", algorithm: Algorithm::Sha512_224, listed: true },
    DigestAlias { name: "RSA-SHA512/256", algorithm: Algorithm::Sha512_256, listed: true },
    DigestAlias { name: "id-rsassa-pkcs1-v1_5-with-sha3-224", algorithm: Algorithm::Sha3_224, listed: true },
    DigestAlias { name: "id-rsassa-pkcs1-v1_5-with-sha3-256", algorithm: Algorithm::Sha3_256, listed: true },
    DigestAlias { name: "id-rsassa-pkcs1-v1_5-with-sha3-384", algorithm: Algorithm::Sha3_384, listed: true },
    DigestAlias { name: "id-rsassa-pkcs1-v1_5-with-sha3-512", algorithm: Algorithm::Sha3_512, listed: true },
    DigestAlias { name: "md5WithRSAEncryption", algorithm: Algorithm::Md5, listed: true },
    DigestAlias { name: "ripemd", algorithm: Algorithm::Ripemd160, listed: true },
    DigestAlias { name: "ripemd160WithRSA", algorithm: Algorithm::Ripemd160, listed: true },
    DigestAlias { name: "rmd160", algorithm: Algorithm::Ripemd160, listed: true },
    DigestAlias { name: "sha1WithRSAEncryption", algorithm: Algorithm::Sha1, listed: true },
    DigestAlias { name: "sha224WithRSAEncryption", algorithm: Algorithm::Sha224, listed: true },
    DigestAlias { name: "sha256WithRSAEncryption", algorithm: Algorithm::Sha256, listed: true },
    DigestAlias { name: "sha384WithRSAEncryption", algorithm: Algorithm::Sha384, listed: true },
    DigestAlias { name: "sha512WithRSAEncryption", algorithm: Algorithm::Sha512, listed: true },
    DigestAlias { name: "sha512-224WithRSAEncryption", algorithm: Algorithm::Sha512_224, listed: true },
    DigestAlias { name: "sha512-256WithRSAEncryption", algorithm: Algorithm::Sha512_256, listed: true },
    DigestAlias { name: "ssl3-md5", algorithm: Algorithm::Md5, listed: true },
    DigestAlias { name: "ssl3-sha1", algorithm: Algorithm::Sha1, listed: true },
    // Node resolves dss1 in ncrypto but does not list it.
    DigestAlias { name: "dss1", algorithm: Algorithm::Sha1, listed: false },
];

/// ASCII-case-insensitive name → `Algorithm`.
pub(crate) fn lookup_ignore_case(bytes: &[u8]) -> Option<Algorithm> {
    if let Some(algorithm) = ALGORITHM_MAP.get_ascii_case_insensitive(bytes) {
        return Some(*algorithm);
    }
    DIGEST_ALIASES
        .iter()
        .find(|alias| alias.name.as_bytes().eq_ignore_ascii_case(bytes))
        .map(|alias| alias.algorithm)
}

/// `crypto.getHashes()`, byte-ordered like node. Only names with an `EVP_MD`;
/// `Blake2b256` is bun-only and node's tests gate cSHAKE/DEP0198 on `shake128`.
pub(crate) fn node_hash_names() -> &'static [BunString] {
    static NAMES: std::sync::OnceLock<Vec<BunString>> = std::sync::OnceLock::new();
    NAMES
        .get_or_init(|| {
            let mut names: Vec<&'static [u8]> = ALL
                .iter()
                .filter(|algorithm| {
                    **algorithm != Algorithm::Blake2b256 && algorithm.md().is_some()
                })
                .map(|algorithm| algorithm.tag_cstr().to_bytes())
                .chain(
                    DIGEST_ALIASES
                        .iter()
                        .filter(|alias| alias.listed)
                        .map(|alias| alias.name.as_bytes()),
                )
                .collect();
            names.sort_unstable();
            names.into_iter().map(BunString::static_).collect()
        })
        .as_slice()
}

/// `ncrypto::getDigestByName`. Null for an unknown name or a digest without an `EVP_MD`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__Crypto__digestByName(
    name: *const u8,
    len: usize,
) -> *const boringssl::EVP_MD {
    // SAFETY: caller passes a valid (ptr, len) byte slice that outlives the call.
    let name = unsafe { bun_core::ffi::slice(name, len) };
    match lookup_ignore_case(name).and_then(Algorithm::md) {
        Some(md) => md,
        None => core::ptr::null(),
    }
}

impl EVP {
    pub(crate) fn algorithm(&self) -> Algorithm {
        self.algorithm
    }

    /// # Safety
    /// `md` must be a valid `EVP_MD` pointer (BoringSSL static singleton) and
    /// `engine` must be either null or a valid `ENGINE` pointer.
    pub(crate) fn init(
        algorithm: Algorithm,
        md: *const boringssl::EVP_MD,
        engine: *mut boringssl::ENGINE,
    ) -> EVP {
        bun_boringssl::load();

        let mut ctx: boringssl::EVP_MD_CTX = bun_core::ffi::zeroed();
        boringssl::EVP_MD_CTX_init(&mut ctx);
        // SAFETY: FFI into BoringSSL; ctx is initialised above. md/engine are
        // caller-validated (md is a static singleton, engine may be null).
        unsafe {
            let _ = boringssl::EVP_DigestInit_ex(&raw mut ctx, md, engine);
        }
        EVP { ctx, md, algorithm }
    }

    /// # Safety
    /// `engine` must be either null or a valid `ENGINE` pointer.
    pub(crate) fn reset(&mut self, engine: *mut boringssl::ENGINE) {
        // SAFETY: FFI into BoringSSL; ERR_clear_error has no preconditions. self.ctx was
        // initialized in init() and remains valid for the lifetime of EVP; self.md is a
        // static singleton.
        unsafe {
            boringssl::ERR_clear_error();
            let _ = boringssl::EVP_DigestInit_ex(&raw mut self.ctx, self.md, engine);
        }
    }

    /// # Safety
    /// `engine` must be either null or a valid `ENGINE` pointer.
    pub(crate) fn hash(
        &mut self,
        engine: *mut boringssl::ENGINE,
        input: &[u8],
        output: &mut [u8],
    ) -> Option<u32> {
        boringssl::ERR_clear_error();
        let mut outsize: c_uint = (output.len() as u16).min(self.size()) as c_uint;
        // SAFETY: input/output point to valid slices of the given lengths; outsize bounded by output.len().
        if unsafe {
            boringssl::EVP_Digest(
                input.as_ptr().cast(),
                input.len(),
                output.as_mut_ptr(),
                &raw mut outsize,
                self.md,
                engine,
            )
        } != 1
        {
            return None;
        }

        Some(outsize)
    }

    /// # Safety
    /// `engine` must be either null or a valid `ENGINE` pointer.
    pub(crate) fn r#final<'a>(
        &mut self,
        engine: *mut boringssl::ENGINE,
        output: &'a mut [u8],
    ) -> &'a mut [u8] {
        boringssl::ERR_clear_error();
        let mut outsize: u32 = (output.len() as u16).min(self.size()) as u32;
        // SAFETY: output points to a valid mutable slice; outsize bounded by output.len().
        if unsafe {
            boringssl::EVP_DigestFinal_ex(&raw mut self.ctx, output.as_mut_ptr(), &raw mut outsize)
        } != 1
        {
            return &mut output[..0];
        }

        self.reset(engine);

        &mut output[..outsize as usize]
    }

    pub(crate) fn update(&mut self, input: &[u8]) {
        // SAFETY: FFI into BoringSSL; ERR_clear_error has no preconditions. self.ctx is
        // initialized; input.as_ptr() is valid for input.len() bytes.
        unsafe {
            boringssl::ERR_clear_error();
            let _ =
                boringssl::EVP_DigestUpdate(&raw mut self.ctx, input.as_ptr().cast(), input.len());
        }
    }

    pub(crate) fn size(&self) -> u16 {
        // SAFETY: FFI into BoringSSL; self.ctx was initialized in init() and is valid for
        // the lifetime of EVP.
        unsafe { boringssl::EVP_MD_CTX_size(&raw const self.ctx) as u16 }
    }

    /// # Safety
    /// `engine` must be either null or a valid `ENGINE` pointer.
    pub(crate) fn copy(&self, engine: *mut boringssl::ENGINE) -> Result<EVP, AllocError> {
        boringssl::ERR_clear_error();
        // SAFETY: self.md is a static singleton; caller upholds `engine`.
        let mut new = EVP::init(self.algorithm, self.md, engine);
        // SAFETY: FFI into BoringSSL; both new.ctx and self.ctx are initialized EVP_MD_CTX
        // values (new.ctx via EVP::init above, self.ctx via the invariant on EVP).
        if unsafe { boringssl::EVP_MD_CTX_copy_ex(&raw mut new.ctx, &raw const self.ctx) } == 0 {
            return Err(AllocError);
        }
        Ok(new)
    }

    /// # Safety
    /// `engine` must be either null or a valid `ENGINE` pointer.
    pub(crate) fn by_name_and_engine(engine: *mut boringssl::ENGINE, name: &[u8]) -> Option<EVP> {
        if let Some(algorithm) = lookup_ignore_case(name) {
            if let Some(md) = algorithm.md() {
                // `Algorithm::md()` lives in `bun_sha_hmac`
                // and returns that crate's opaque `EVP_MD`; both name the same C
                // `struct env_md_st`, so a pointer cast is the correct unification.
                // SAFETY: md is a BoringSSL static singleton; caller upholds `engine`.
                return Some(EVP::init(algorithm, md.cast::<boringssl::EVP_MD>(), engine));
            }

            // strum's `<&'static str>::from(algorithm)` is NOT NUL-terminated, so use the
            // explicit `tag_cstr()` table for the C-string FFI.
            // SAFETY: FFI into BoringSSL; EVP_get_digestbyname expects a NUL-terminated
            // C string, which `tag_cstr()` guarantees.
            let md = unsafe { boringssl::EVP_get_digestbyname(algorithm.tag_cstr().as_ptr()) };
            if !md.is_null() {
                // SAFETY: md is non-null from EVP_get_digestbyname; caller upholds `engine`.
                return Some(EVP::init(algorithm, md, engine));
            }
        }

        None
    }
}

impl Drop for EVP {
    fn drop(&mut self) {
        // https://github.com/oven-sh/bun/issues/3250
        // SAFETY: FFI into BoringSSL; self.ctx is valid for the lifetime of EVP and
        // EVP_MD_CTX_cleanup is safe to call on any initialized ctx (idempotent).
        unsafe {
            let _ = boringssl::EVP_MD_CTX_cleanup(&raw mut self.ctx);
        }
    }
}

pub(crate) type Digest = [u8; boringssl::EVP_MAX_MD_SIZE as usize];
