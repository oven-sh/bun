use core::ffi::{c_int, c_void};
use core::ptr;

use bun_boringssl as boringssl;
use bun_boringssl_sys as boringssl_sys;

// ──────────────────────────────────────────────────────────────────────────
// Digest-length constants (Zig pulled these from `std.crypto.hash.*.digest_length`;
// Rust has no stdlib equivalents, so the literal values are inlined here).
// ──────────────────────────────────────────────────────────────────────────
const SHA1_DIGEST_LENGTH: usize = 20;
const SHA256_DIGEST_LENGTH: usize = 32;
const SHA384_DIGEST_LENGTH: usize = 48;
const SHA512_DIGEST_LENGTH: usize = 64;
const SHA512_256_DIGEST_LENGTH: usize = 32;

/// Zig: `fn NewHasher(comptime digest_size, comptime ContextType, Full, Init, Update, Final) type`
///
/// The Zig function returns an anonymous struct type parameterised by a context
/// type and four FFI function *values* (passed as `anytype`). Stable Rust cannot
/// take function items as const-generic parameters, and the call sites are pure
/// token-pasting of BoringSSL symbol names, so this is expressed as a
/// `macro_rules!` type-generator.
// TODO(port): inherent associated type `Digest = [u8; N]` requires nightly
// `inherent_associated_types`; callers should use `[u8; <Name>::DIGEST]` for now.
macro_rules! new_hasher {
    (
        $name:ident,
        $digest_size:expr,
        $ctx:ty,
        $full:path,
        $init:path,
        $update:path,
        $final_:path
    ) => {
        #[repr(C)]
        pub struct $name {
            hasher: $ctx,
        }

        impl $name {
            pub const DIGEST: usize = $digest_size;

            pub fn init() -> Self {
                boringssl::load();
                // SAFETY: BoringSSL *_Init fully initialises the context; we never
                // read `hasher` before the call below writes it.
                let mut this: Self = unsafe { core::mem::zeroed() };
                let rc: c_int = unsafe { $init(&mut this.hasher) };
                debug_assert!(rc == 1);
                this
            }

            pub fn hash(bytes: &[u8], out: &mut [u8; $digest_size]) {
                // SAFETY: `out` is exactly DIGEST bytes; BoringSSL one-shot hashers
                // accept (ptr, len, out) and never read past `len`.
                unsafe {
                    let _ = $full(bytes.as_ptr(), bytes.len(), out.as_mut_ptr());
                }
            }

            pub fn update(&mut self, data: &[u8]) {
                // SAFETY: `self.hasher` was initialised in `init()`; BoringSSL
                // *_Update reads exactly `len` bytes from `data`.
                let rc: c_int =
                    unsafe { $update(&mut self.hasher, data.as_ptr().cast::<c_void>(), data.len()) };
                debug_assert!(rc == 1);
            }

            pub fn r#final(&mut self, out: &mut [u8; $digest_size]) {
                // SAFETY: `out` is exactly DIGEST bytes; *_Final writes that many.
                let rc: c_int = unsafe { $final_(out.as_mut_ptr(), &mut self.hasher) };
                debug_assert!(rc == 1);
            }
        }
    };
}

/// Zig: `fn NewEVP(comptime digest_size, comptime MDName: []const u8) type`
///
/// `MDName` is used via `@field(BoringSSL, MDName)()` — comptime reflection to
/// resolve a function by string name. That is token-pasting; expressed here by
/// passing the BoringSSL `EVP_*` md-getter as an ident.
macro_rules! new_evp {
    ($name:ident, $digest_size:expr, $md_fn:ident) => {
        #[repr(C)]
        pub struct $name {
            ctx: boringssl_sys::EVP_MD_CTX,
        }

        impl $name {
            pub const DIGEST: usize = $digest_size;

            pub fn init() -> Self {
                boringssl::load();

                // SAFETY: EVP md getters are infallible and take no arguments.
                let md = unsafe { boringssl_sys::$md_fn() };
                // SAFETY: EVP_MD_CTX_init zero-initialises; reading zeroed POD is fine.
                let mut this: Self = unsafe { core::mem::zeroed() };

                // SAFETY: ctx is zeroed POD; EVP_MD_CTX_init writes it in place.
                unsafe { boringssl_sys::EVP_MD_CTX_init(&mut this.ctx) };

                // SAFETY: ctx initialised by EVP_MD_CTX_init above; md is non-null.
                let rc: c_int = unsafe { boringssl_sys::EVP_DigestInit(&mut this.ctx, md) };
                debug_assert!(rc == 1);

                this
            }

            pub fn hash(
                bytes: &[u8],
                out: &mut [u8; $digest_size],
                engine: Option<&mut boringssl_sys::ENGINE>,
            ) {
                // SAFETY: see `init()` re: md getter.
                let md = unsafe { boringssl_sys::$md_fn() };

                let engine_ptr = match engine {
                    Some(e) => e as *mut boringssl_sys::ENGINE,
                    None => ptr::null_mut(),
                };

                // SAFETY: `out` is DIGEST bytes; `size` out-param is nullable.
                let rc: c_int = unsafe {
                    boringssl_sys::EVP_Digest(
                        bytes.as_ptr().cast::<c_void>(),
                        bytes.len(),
                        out.as_mut_ptr(),
                        ptr::null_mut(),
                        md,
                        engine_ptr,
                    )
                };
                debug_assert!(rc == 1);
            }

            pub fn update(&mut self, data: &[u8]) {
                // SAFETY: ctx initialised in `init()`; EVP_DigestUpdate reads `len` bytes.
                let rc: c_int = unsafe {
                    boringssl_sys::EVP_DigestUpdate(
                        &mut self.ctx,
                        data.as_ptr().cast::<c_void>(),
                        data.len(),
                    )
                };
                debug_assert!(rc == 1);
            }

            pub fn r#final(&mut self, out: &mut [u8; $digest_size]) {
                // SAFETY: `out` is DIGEST bytes; `out_size` is nullable.
                let rc: c_int = unsafe {
                    boringssl_sys::EVP_DigestFinal(&mut self.ctx, out.as_mut_ptr(), ptr::null_mut())
                };
                debug_assert!(rc == 1);
            }
        }

        impl Drop for $name {
            fn drop(&mut self) {
                // SAFETY: ctx was EVP_MD_CTX_init'd; cleanup is idempotent on a
                // zeroed/initialised ctx.
                unsafe {
                    let _ = boringssl_sys::EVP_MD_CTX_cleanup(&mut self.ctx);
                }
            }
        }
    };
}

pub mod evp {
    use super::*;

    new_evp!(SHA1, SHA1_DIGEST_LENGTH, EVP_sha1);
    new_evp!(MD5, 16, EVP_md5);
    new_evp!(MD4, 16, EVP_md4);
    new_evp!(SHA224, 28, EVP_sha224);
    new_evp!(SHA512, SHA512_DIGEST_LENGTH, EVP_sha512);
    new_evp!(SHA384, SHA384_DIGEST_LENGTH, EVP_sha384);
    new_evp!(SHA256, SHA256_DIGEST_LENGTH, EVP_sha256);
    new_evp!(SHA512_256, SHA512_256_DIGEST_LENGTH, EVP_sha512_256);
    // PORT NOTE: Zig passes `Sha1.digest_length` (20) here, which is faithfully
    // preserved even though MD5+SHA1 is conventionally 36 bytes.
    new_evp!(MD5_SHA1, SHA1_DIGEST_LENGTH, EVP_md5_sha1);
    new_evp!(Blake2, 256 / 8, EVP_blake2b256);
}

pub use evp::SHA1;
pub use evp::MD5;
pub use evp::MD4;
pub use evp::SHA224;
pub use evp::SHA512;
pub use evp::SHA384;
pub use evp::SHA256;
pub use evp::SHA512_256;
pub use evp::MD5_SHA1;

/// API that OpenSSL 3 deprecated
pub mod hashers {
    use super::*;

    new_hasher!(
        SHA1,
        SHA1_DIGEST_LENGTH,
        boringssl_sys::SHA_CTX,
        boringssl_sys::SHA1,
        boringssl_sys::SHA1_Init,
        boringssl_sys::SHA1_Update,
        boringssl_sys::SHA1_Final
    );

    new_hasher!(
        SHA512,
        SHA512_DIGEST_LENGTH,
        boringssl_sys::SHA512_CTX,
        boringssl_sys::SHA512,
        boringssl_sys::SHA512_Init,
        boringssl_sys::SHA512_Update,
        boringssl_sys::SHA512_Final
    );

    new_hasher!(
        SHA384,
        SHA384_DIGEST_LENGTH,
        boringssl_sys::SHA512_CTX,
        boringssl_sys::SHA384,
        boringssl_sys::SHA384_Init,
        boringssl_sys::SHA384_Update,
        boringssl_sys::SHA384_Final
    );

    new_hasher!(
        SHA256,
        SHA256_DIGEST_LENGTH,
        boringssl_sys::SHA256_CTX,
        boringssl_sys::SHA256,
        boringssl_sys::SHA256_Init,
        boringssl_sys::SHA256_Update,
        boringssl_sys::SHA256_Final
    );

    new_hasher!(
        SHA512_256,
        SHA512_256_DIGEST_LENGTH,
        boringssl_sys::SHA512_CTX,
        boringssl_sys::SHA512_256,
        boringssl_sys::SHA512_256_Init,
        boringssl_sys::SHA512_256_Update,
        boringssl_sys::SHA512_256_Final
    );

    new_hasher!(
        RIPEMD160,
        boringssl_sys::RIPEMD160_DIGEST_LENGTH as usize,
        boringssl_sys::RIPEMD160_CTX,
        boringssl_sys::RIPEMD160,
        boringssl_sys::RIPEMD160_Init,
        boringssl_sys::RIPEMD160_Update,
        boringssl_sys::RIPEMD160_Final
    );
}

// TODO(port): `boring`, `zig`, `evp` below were Zig `[_]type{...}` comptime type
// lists (with `void` sentinels) used for ad-hoc benchmarking against Zig's
// `std.crypto.hash`. Rust has no type-list value equivalent and no `std.crypto`
// counterpart; they are private and unreferenced in the Zig source, so only
// `labels` is kept.

#[allow(dead_code)]
const LABELS: [&[u8]; 7] = [
    b"SHA1",
    b"SHA512",
    b"SHA384",
    b"SHA256",
    b"SHA512_256",
    b"Blake2",
    b"Blake3",
];

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sha_hmac/sha.zig (199 lines)
//   confidence: medium
//   todos:      2
//   notes:      NewHasher/NewEVP comptime type-ctors → macro_rules! (fn-value generics + @field reflection not expressible as Rust generics); `Digest` assoc type alias dropped (inherent_associated_types is nightly) — callers use `[u8; T::DIGEST]`; FFI calls hoisted out of debug_assert! so they run in release; private comptime type-list benchmark arrays dropped.
// ──────────────────────────────────────────────────────────────────────────
