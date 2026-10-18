use bun_alloc::AllocError;
use bun_boringssl_sys as boringssl;

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
// enum here; the higher-tier extras (`lookup`, `name`) live below as an
// extension trait / free fns on the re-exported type.
// ──────────────────────────────────────────────────────────────────────────
pub(crate) use bun_sha_hmac::evp::Algorithm;

/// Higher-tier helpers on the lowered `Algorithm` enum (orphan rules prevent an
/// inherent `impl` on a foreign type, so callers `use evp::AlgorithmExt as _;`).
pub(crate) trait AlgorithmExt: Copy + Sized {
    /// The canonical name, as `Bun.CryptoHasher.algorithms` lists it.
    fn name(self) -> &'static str;
}

impl AlgorithmExt for Algorithm {
    fn name(self) -> &'static str {
        match self {
            Algorithm::Blake2b256 => "blake2b256",
            Algorithm::Blake2b512 => "blake2b512",
            Algorithm::Blake2s256 => "blake2s256",
            Algorithm::Md4 => "md4",
            Algorithm::Md5 => "md5",
            Algorithm::Ripemd160 => "ripemd160",
            Algorithm::Sha1 => "sha1",
            Algorithm::Sha224 => "sha224",
            Algorithm::Sha256 => "sha256",
            Algorithm::Sha384 => "sha384",
            Algorithm::Sha512 => "sha512",
            Algorithm::Sha512_224 => "sha512-224",
            Algorithm::Sha512_256 => "sha512-256",
            Algorithm::Sha3_224 => "sha3-224",
            Algorithm::Sha3_256 => "sha3-256",
            Algorithm::Sha3_384 => "sha3-384",
            Algorithm::Sha3_512 => "sha3-512",
            Algorithm::Shake128 => "shake128",
            Algorithm::Shake256 => "shake256",
            // upstream enum is `#[non_exhaustive]`; the variant set is closed in
            // practice.
            _ => unreachable!("unhandled EVP algorithm variant"),
        }
    }
}

/// Stable iteration order over every `Algorithm` variant — the lowered enum is
/// foreign + `#[non_exhaustive]`, so we can't derive an iterator for it.
pub(crate) const ALL: [Algorithm; 19] = [
    Algorithm::Blake2b256,
    Algorithm::Blake2b512,
    Algorithm::Blake2s256,
    Algorithm::Md4,
    Algorithm::Md5,
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
'ripemd160', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'sha512-224', 'sha512-256', \
'sha3-224', 'sha3-256', 'sha3-384', 'sha3-512', 'shake128' or 'shake256'";

bun_core::comptime_string_map! {
    /// Case-sensitive name → `Algorithm`. Keys must stay lowercase so
    /// `lookup_ignore_case` can use the ASCII-case-insensitive probe.
    static ALGORITHM_MAP: Algorithm = {
        b"md4" => Algorithm::Md4,
        b"md5" => Algorithm::Md5,
        b"sha1" => Algorithm::Sha1,
        b"sha-1" => Algorithm::Sha1,
        b"sha128" => Algorithm::Sha1,
        b"sha224" => Algorithm::Sha224,
        b"sha256" => Algorithm::Sha256,
        b"sha384" => Algorithm::Sha384,
        b"sha512" => Algorithm::Sha512,
        b"rmd160" => Algorithm::Ripemd160,
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
// Aliases the Zig table listed but never wired up:
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

/// ASCII-case-insensitive name → `Algorithm`.
pub(crate) fn lookup_ignore_case(bytes: &[u8]) -> Option<Algorithm> {
    ALGORITHM_MAP.get_ascii_case_insensitive(bytes).copied()
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
}

/// The algorithm a name denotes, and its BoringSSL `EVP_MD` when it has one.
///
/// `None` for an unknown name. The `EVP_MD` is `None` for the algorithms
/// that BoringSSL does not implement (`Blake2s256`, `Shake128`, `Shake256`):
/// `CryptoHasherZig` hashes those.
pub(crate) fn md_by_name(name: &[u8]) -> Option<(Algorithm, Option<*const boringssl::EVP_MD>)> {
    let algorithm = lookup_ignore_case(name)?;
    Some((algorithm, algorithm.md()))
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
