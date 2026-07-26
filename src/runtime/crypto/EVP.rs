use core::ffi::{CStr, c_uint};

use bun_alloc::AllocError;
use bun_boringssl_sys as boringssl;
use bun_core::{String as BunString, ZigString};

use crate::jsc::JSGlobalObject;

pub struct EVP {
    pub ctx: boringssl::EVP_MD_CTX,
    // FFI: BoringSSL EVP_MD singletons are static for the process lifetime.
    pub md: *const boringssl::EVP_MD,
    pub algorithm: Algorithm,
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
    /// # Safety
    /// `md` must be a valid `EVP_MD` pointer (BoringSSL static singleton) and
    /// `engine` must be either null or a valid `ENGINE` pointer.
    // Forwards `md`/`engine` to BoringSSL without dereferencing; not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn init(
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
    // Forwards `engine` to BoringSSL without dereferencing; not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn reset(&mut self, engine: *mut boringssl::ENGINE) {
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
    // Forwards `engine` to BoringSSL without dereferencing; not_unsafe_ptr_arg_deref is a false positive on opaque-token forwarding.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn hash(
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
    pub fn r#final<'a>(
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

    pub fn update(&mut self, input: &[u8]) {
        // SAFETY: FFI into BoringSSL; ERR_clear_error has no preconditions. self.ctx is
        // initialized; input.as_ptr() is valid for input.len() bytes.
        unsafe {
            boringssl::ERR_clear_error();
            let _ =
                boringssl::EVP_DigestUpdate(&raw mut self.ctx, input.as_ptr().cast(), input.len());
        }
    }

    pub fn size(&self) -> u16 {
        // SAFETY: FFI into BoringSSL; self.ctx was initialized in init() and is valid for
        // the lifetime of EVP.
        unsafe { boringssl::EVP_MD_CTX_size(&raw const self.ctx) as u16 }
    }

    /// # Safety
    /// `engine` must be either null or a valid `ENGINE` pointer.
    pub fn copy(&self, engine: *mut boringssl::ENGINE) -> Result<EVP, AllocError> {
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
    pub fn by_name_and_engine(engine: *mut boringssl::ENGINE, name: &[u8]) -> Option<EVP> {
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

    pub fn by_name(name: &ZigString, global: &JSGlobalObject) -> Option<EVP> {
        let name_str = name.to_slice();
        // `RareData::boring_engine()` returns `*mut` to bun_jsc's local opaque `ENGINE`
        // stub (bun_jsc has no bun_boringssl_sys dep). Both name the same C `ENGINE`
        // struct, so cast to the real bindgen type for the FFI call.
        // SAFETY: `bun_vm()` returns the raw `*mut VirtualMachine` for a Bun-owned
        // global (never null, single-threaded JS heap), so deref-to-&mut is sound here.
        let engine = global
            .bun_vm()
            .as_mut()
            .rare_data()
            .boring_engine()
            .cast::<boringssl::ENGINE>();
        // SAFETY: `boring_engine()` returns the VM's lazily-initialized ENGINE (valid or null).
        Self::by_name_and_engine(engine, name_str.slice())
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
