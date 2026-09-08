use core::ffi::CStr;

use bun_alloc::AllocError;
use bun_boringssl_sys as boringssl;
use bun_core::String as BunString;

use crate::jsc::JSGlobalObject;

pub struct EVP {
    ctx: boringssl::DigestCtx,
    algorithm: Algorithm,
}

// ──────────────────────────────────────────────────────────────────────────
// The `Algorithm` enum + `md()` live in
// `bun_sha_hmac::evp` so lower-tier crates (`bun_csrf`, `bun_sha_hmac::hmac`)
// can name it without depending upward on bun_runtime. Re-export the canonical
// enum here; the higher-tier extras (`names`, `lookup`, `tag_cstr`) that need
// bun_str live below as an extension trait / free fns on the re-exported type.
// ──────────────────────────────────────────────────────────────────────────
pub use bun_sha_hmac::evp::Algorithm;

/// Higher-tier helpers on the lowered `Algorithm` enum (orphan rules prevent an
/// inherent `impl` on a foreign type, so callers `use evp::AlgorithmExt as _;`).
pub(crate) trait AlgorithmExt: Copy + Sized {
    /// NUL-terminated tag name. Needed for `EVP_get_digestbyname` which reads
    /// a C string.
    fn tag_cstr(self) -> &'static CStr;

    /// `bun.String` view of every algorithm tag name; returned as a flat slice
    /// since the enum is foreign and cannot derive `enum_map::Enum`.
    fn names() -> &'static [BunString];
}

impl AlgorithmExt for Algorithm {
    fn tag_cstr(self) -> &'static CStr {
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
            // upstream enum is `#[non_exhaustive]`; the variant set is closed in
            // practice.
            _ => unreachable!("unhandled EVP algorithm variant"),
        }
    }

    fn names() -> &'static [BunString] {
        static NAMES: std::sync::OnceLock<[BunString; ALL.len()]> = std::sync::OnceLock::new();
        NAMES
            .get_or_init(|| {
                core::array::from_fn(|i| BunString::static_(ALL[i].tag_cstr().to_bytes()))
            })
            .as_slice()
    }
}

/// Stable iteration order over every `Algorithm` variant — the lowered enum is
/// foreign + `#[non_exhaustive]`, so we can't derive an iterator for it.
const ALL: [Algorithm; 19] = [
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
    pub fn algorithm(&self) -> Algorithm {
        self.algorithm
    }

    pub(crate) fn init(
        algorithm: Algorithm,
        md: &'static boringssl::EVP_MD,
        engine: Option<&boringssl::ENGINE>,
    ) -> EVP {
        bun_boringssl::load();

        EVP {
            ctx: boringssl::DigestCtx::new(md, engine),
            algorithm,
        }
    }

    pub fn reset(&mut self, engine: Option<&boringssl::ENGINE>) {
        boringssl::ERR_clear_error();
        let _ = self.ctx.init(self.ctx.md(), engine);
    }

    pub(crate) fn hash(
        &mut self,
        engine: Option<&boringssl::ENGINE>,
        input: &[u8],
        output: &mut [u8],
    ) -> Option<u32> {
        boringssl::ERR_clear_error();
        boringssl::digest(self.ctx.md(), input, output, engine)
    }

    pub(crate) fn r#final<'a>(
        &mut self,
        engine: Option<&boringssl::ENGINE>,
        output: &'a mut [u8],
    ) -> &'a mut [u8] {
        boringssl::ERR_clear_error();
        let Some(outsize) = self.ctx.final_(output) else {
            return &mut output[..0];
        };

        self.reset(engine);

        &mut output[..outsize as usize]
    }

    pub(crate) fn update(&mut self, input: &[u8]) {
        boringssl::ERR_clear_error();
        let _ = self.ctx.update(input);
    }

    pub(crate) fn size(&self) -> u16 {
        self.ctx.size() as u16
    }

    pub(crate) fn copy(&self, engine: Option<&boringssl::ENGINE>) -> Result<EVP, AllocError> {
        boringssl::ERR_clear_error();
        let mut new = EVP::init(self.algorithm, self.ctx.md(), engine);
        if !new.ctx.copy_from(&self.ctx) {
            return Err(AllocError);
        }
        Ok(new)
    }

    pub(crate) fn by_name_and_engine(
        engine: Option<&boringssl::ENGINE>,
        name: &[u8],
    ) -> Option<EVP> {
        if let Some(algorithm) = lookup_ignore_case(name) {
            if let Some(md) = algorithm.md() {
                return Some(EVP::init(algorithm, md, engine));
            }

            // strum's `<&'static str>::from(algorithm)` is NOT NUL-terminated, so use the
            // explicit `tag_cstr()` table for the C-string lookup.
            if let Some(md) = boringssl::digest_by_name(algorithm.tag_cstr()) {
                return Some(EVP::init(algorithm, md, engine));
            }
        }

        None
    }

    pub(crate) fn by_name(name: &[u8], global: &JSGlobalObject) -> Option<EVP> {
        let engine = global.bun_vm().as_mut().rare_data().boring_engine();
        Self::by_name_and_engine(engine, name)
    }
}

pub(crate) type Digest = [u8; boringssl::EVP_MAX_MD_SIZE as usize];
