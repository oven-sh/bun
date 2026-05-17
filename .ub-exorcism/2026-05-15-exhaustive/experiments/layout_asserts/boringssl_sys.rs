// Layout-assert authoring file for `bun_boringssl_sys`'s 15 `#[repr(C)]`
// structs / unions, per Phase-10 finding F-10-5.
//
// PROPOSED INSERTION SITE: `src/boringssl_sys/boringssl.rs` (end of file).
// Pattern follows the bun_libuv_sys gold standard at
// `src/libuv_sys/libuv.rs:3480-3599` (74 asserts cross-validated against
// runtime `uv_*_size()` reflection).
//
// Rationale (Phase-4 F-10-5): the BoringSSL POD structs are stored
// **by-value** in Bun's Rust crates — `EVP_MD_CTX`, the 4 hash CTXs, `BIO`
// — instead of going through `EVP_MD_CTX_new()` / `BIO_new()`. That means
// a layout drift between our Rust definition and the running BoringSSL
// shared object **silently corrupts the digest/HMAC/BIO state machine**.
// The crypto layer is the most security-sensitive ABI in Bun; missing
// these asserts is on par with NAPI for blast radius.
//
// CROSS-REFERENCE — `vendor/boringssl/` is NOT checked out on this
// machine (only `vendor/lolhtml` ships in the workspace tree per F-10-1).
// Offsets below were derived from:
//   - `src/boringssl_sys/boringssl.zig` (the translate-c source-of-truth,
//     867 KB; field order/types are 1:1 with the headers)
//   - The C constants in `boringssl.rs` itself (`EVP_MAX_MD_SIZE = 64`,
//     `RIPEMD160_DIGEST_LENGTH = 20`)
//   - Upstream BoringSSL public API at https://commondatastorage.googleapis.com/chromium-boringssl-docs/
//     (the `include/openssl/{digest.h,sha.h,ripemd.h,x509v3.h,asn1.h,bio.h,stack.h}` headers)
//   - SysV AMD64 ABI padding rules
//
// SCOPE: `#[cfg(all(target_arch = "x86_64", any(target_os = "linux", target_os = "macos")))]`
// — BoringSSL's POD layout is ABI-stable across Linux/macOS x64 (both
// LP64). Windows MSVC uses LLP64 (long = 32-bit), which changes
// `asn1_string_st.flags` from 8B to 4B. A follow-up patch can add a
// Windows-gated block once cl.exe-measured numbers are in hand.
//
// PASTING this block at the end of `boringssl.rs` requires no `use`
// changes — every type referenced is at module root.

#[cfg(all(
    target_arch = "x86_64",
    any(target_os = "linux", target_os = "macos")
))]
const _: () = {
    use core::mem;

    macro_rules! assert_size {
        ($t:ty, $n:expr) => {
            assert!(
                mem::size_of::<$t>() == $n,
                concat!("layout drift: sizeof(", stringify!($t), ")")
            );
        };
    }
    macro_rules! assert_offset {
        ($t:ty, $f:ident, $n:expr) => {
            assert!(
                mem::offset_of!($t, $f) == $n,
                concat!(
                    "layout drift: offsetof(",
                    stringify!($t),
                    ".",
                    stringify!($f),
                    ")"
                )
            );
        };
    }
    macro_rules! assert_align {
        ($t:ty, $n:expr) => {
            assert!(
                mem::align_of::<$t>() == $n,
                concat!("layout drift: alignof(", stringify!($t), ")")
            );
        };
    }

    // ── asn1_string_st (openssl/asn1.h) ─────────────────────────────────
    // src/boringssl_sys/boringssl.rs:57-64
    // Layout (LP64): c_int(4) + c_int(4) + ptr(8) + c_long(8) = 24
    assert_size!(asn1_string_st, 24);
    assert_align!(asn1_string_st, 8);
    assert_offset!(asn1_string_st, length, 0);
    // NOTE: `type` is a Rust keyword; the struct field is declared `r#type`,
    // so the `assert_offset!` macro must match `r#type` to expand correctly.
    assert_offset!(asn1_string_st, r#type, 4);
    assert_offset!(asn1_string_st, data, 8);
    assert_offset!(asn1_string_st, flags, 16);

    // ── env_md_ctx_md_data union (openssl/digest.h) ─────────────────────
    // src/boringssl_sys/boringssl.rs:148-153
    // `union { uint8_t[240]; uint64_t alignment; }` → size 240 / align 8.
    // 240 = EVP_MAX_MD_DATA_SIZE in the BoringSSL header; the byte array
    // dominates, the u64 just enforces 8-byte alignment.
    assert_size!(env_md_ctx_md_data, 240);
    assert_align!(env_md_ctx_md_data, 8);

    // ── EVP_MD_CTX (openssl/digest.h) ───────────────────────────────────
    // src/boringssl_sys/boringssl.rs:158-165
    // Layout: union(240) + ptr(8) + ptr(8) + ptr(8) = 264
    assert_size!(EVP_MD_CTX, 264);
    assert_align!(EVP_MD_CTX, 8);
    assert_offset!(EVP_MD_CTX, md_data, 0);
    assert_offset!(EVP_MD_CTX, digest, 240);
    assert_offset!(EVP_MD_CTX, pctx, 248);
    assert_offset!(EVP_MD_CTX, pctx_ops, 256);

    // ── HMAC_CTX (openssl/hmac.h) ───────────────────────────────────────
    // src/boringssl_sys/boringssl.rs:171-178
    // Layout: ptr(8) + 3 × EVP_MD_CTX(264) = 8 + 792 = 800
    assert_size!(HMAC_CTX, 800);
    assert_align!(HMAC_CTX, 8);
    assert_offset!(HMAC_CTX, md, 0);
    assert_offset!(HMAC_CTX, md_ctx, 8);
    assert_offset!(HMAC_CTX, i_ctx, 8 + 264);
    assert_offset!(HMAC_CTX, o_ctx, 8 + 264 + 264);

    // ── SHA_CTX (openssl/sha.h) ─────────────────────────────────────────
    // src/boringssl_sys/boringssl.rs:185-193
    // Layout: [u32;5](20) + u32(4) + u32(4) + [u8;64](64) + c_uint(4) = 96
    assert_size!(SHA_CTX, 96);
    assert_align!(SHA_CTX, 4);
    assert_offset!(SHA_CTX, h, 0);
    assert_offset!(SHA_CTX, Nl, 20);
    assert_offset!(SHA_CTX, Nh, 24);
    assert_offset!(SHA_CTX, data, 28);
    assert_offset!(SHA_CTX, num, 92);

    // ── SHA256_CTX (openssl/sha.h) ──────────────────────────────────────
    // src/boringssl_sys/boringssl.rs:196-205
    // Layout: [u32;8](32) + u32(4) + u32(4) + [u8;64](64) + c_uint(4) + c_uint(4) = 112
    assert_size!(SHA256_CTX, 112);
    assert_align!(SHA256_CTX, 4);
    assert_offset!(SHA256_CTX, h, 0);
    assert_offset!(SHA256_CTX, Nl, 32);
    assert_offset!(SHA256_CTX, Nh, 36);
    assert_offset!(SHA256_CTX, data, 40);
    assert_offset!(SHA256_CTX, num, 104);
    assert_offset!(SHA256_CTX, md_len, 108);

    // ── SHA512_CTX (openssl/sha.h) ──────────────────────────────────────
    // src/boringssl_sys/boringssl.rs:208-217
    // Layout: [u64;8](64) + u16(2) + u16(2) + u32(4) + u64(8) + [u8;128](128) = 208
    // u64 alignment forces 8-byte align overall.
    assert_size!(SHA512_CTX, 208);
    assert_align!(SHA512_CTX, 8);
    assert_offset!(SHA512_CTX, h, 0);
    assert_offset!(SHA512_CTX, num, 64);
    assert_offset!(SHA512_CTX, md_len, 66);
    assert_offset!(SHA512_CTX, bytes_so_far_high, 68);
    assert_offset!(SHA512_CTX, bytes_so_far_low, 72);
    assert_offset!(SHA512_CTX, p, 80);

    // ── RIPEMD160_CTX (openssl/ripemd.h) ────────────────────────────────
    // src/boringssl_sys/boringssl.rs:220-228
    // Layout matches SHA_CTX exactly: [u32;5]+u32+u32+[u8;64]+c_uint = 96
    assert_size!(RIPEMD160_CTX, 96);
    assert_align!(RIPEMD160_CTX, 4);
    assert_offset!(RIPEMD160_CTX, h, 0);
    assert_offset!(RIPEMD160_CTX, Nl, 20);
    assert_offset!(RIPEMD160_CTX, Nh, 24);
    assert_offset!(RIPEMD160_CTX, data, 28);
    assert_offset!(RIPEMD160_CTX, num, 92);

    // ── OTHERNAME (openssl/x509v3.h) ────────────────────────────────────
    // src/boringssl_sys/boringssl.rs:234-239
    // Layout: 2 × ptr(8) = 16
    assert_size!(OTHERNAME, 16);
    assert_align!(OTHERNAME, 8);
    assert_offset!(OTHERNAME, type_id, 0);
    assert_offset!(OTHERNAME, value, 8);

    // ── GENERAL_NAME_d union (openssl/x509v3.h) ─────────────────────────
    // src/boringssl_sys/boringssl.rs:243-262
    // Every arm is a raw pointer → size 8, align 8.
    assert_size!(GENERAL_NAME_d, 8);
    assert_align!(GENERAL_NAME_d, 8);

    // ── GENERAL_NAME (openssl/x509v3.h) ─────────────────────────────────
    // src/boringssl_sys/boringssl.rs:265-271
    // Layout: c_int(4) + pad(4) + union(8) = 16
    assert_size!(GENERAL_NAME, 16);
    assert_align!(GENERAL_NAME, 8);
    assert_offset!(GENERAL_NAME, name_type, 0);
    assert_offset!(GENERAL_NAME, d, 8);

    // ── OPENSSL_STACK (openssl/stack.h) ─────────────────────────────────
    // src/boringssl_sys/boringssl.rs:284-291
    // Layout: usize(8) + ptr(8) + c_int(4) + pad(4) + usize(8) + fn-ptr(8) = 40
    assert_size!(OPENSSL_STACK, 40);
    assert_align!(OPENSSL_STACK, 8);
    assert_offset!(OPENSSL_STACK, num, 0);
    assert_offset!(OPENSSL_STACK, data, 8);
    assert_offset!(OPENSSL_STACK, sorted, 16);
    assert_offset!(OPENSSL_STACK, num_alloc, 24);
    assert_offset!(OPENSSL_STACK, comp, 32);

    // ── BIO_METHOD (openssl/bio.h) ──────────────────────────────────────
    // src/boringssl_sys/boringssl.rs:586-599
    // Layout: c_int(4) + pad(4) + ptr(8) + 8 × fn-ptr(64) = 80
    assert_size!(BIO_METHOD, 80);
    assert_align!(BIO_METHOD, 8);
    // Same `r#type` raw-identifier rationale as `asn1_string_st`.
    assert_offset!(BIO_METHOD, r#type, 0);
    assert_offset!(BIO_METHOD, name, 8);
    assert_offset!(BIO_METHOD, bwrite, 16);
    assert_offset!(BIO_METHOD, bread, 24);
    assert_offset!(BIO_METHOD, bputs, 32);
    assert_offset!(BIO_METHOD, bgets, 40);
    assert_offset!(BIO_METHOD, ctrl, 48);
    assert_offset!(BIO_METHOD, create, 56);
    assert_offset!(BIO_METHOD, destroy, 64);
    assert_offset!(BIO_METHOD, callback_ctrl, 72);

    // ── BIO (openssl/bio.h) ─────────────────────────────────────────────
    // src/boringssl_sys/boringssl.rs:603-617
    // Layout:
    //   method        ptr     @ 0   (8)
    //   init          c_int   @ 8   (4)
    //   shutdown      c_int   @ 12  (4)
    //   flags         c_int   @ 16  (4)
    //   retry_reason  c_int   @ 20  (4)
    //   num           c_int   @ 24  (4)
    //   references    CRYPTO_refcount_t = u32 @ 28 (4)
    //   ptr           *mut    @ 32  (8)
    //   next_bio      *mut    @ 40  (8)
    //   num_read      usize   @ 48  (8)
    //   num_write     usize   @ 56  (8)
    //   total = 64
    assert_size!(BIO, 64);
    assert_align!(BIO, 8);
    assert_offset!(BIO, method, 0);
    assert_offset!(BIO, init, 8);
    assert_offset!(BIO, shutdown, 12);
    assert_offset!(BIO, flags, 16);
    assert_offset!(BIO, retry_reason, 20);
    assert_offset!(BIO, num, 24);
    assert_offset!(BIO, references, 28);
    assert_offset!(BIO, ptr, 32);
    assert_offset!(BIO, next_bio, 40);
    assert_offset!(BIO, num_read, 48);
    assert_offset!(BIO, num_write, 56);
};

// ── Cross-validation work still required before merging upstream ────────────
//
// The size/offset values above were derived analytically from
// `boringssl.zig` (translate-c output) + the SysV AMD64 ABI; the BoringSSL
// headers are not present in this workspace tree. Maintainer cross-validation:
//
// 1. Build a tiny C program (`scripts/boringssl_layout_dump.c`) that includes
//    the live BoringSSL headers from `build/<profile>/deps/boringssl/`:
//
//      #include <openssl/digest.h>
//      #include <openssl/hmac.h>
//      #include <openssl/sha.h>
//      #include <openssl/ripemd.h>
//      #include <openssl/x509v3.h>
//      #include <openssl/asn1.h>
//      #include <openssl/bio.h>
//      #include <openssl/stack.h>
//      #include <stdio.h>
//      #include <stddef.h>
//      int main(void) {
//          printf("EVP_MD_CTX %zu %zu\n", sizeof(EVP_MD_CTX), _Alignof(EVP_MD_CTX));
//          printf("  digest=%zu pctx=%zu pctx_ops=%zu\n",
//              offsetof(EVP_MD_CTX, digest),
//              offsetof(EVP_MD_CTX, pctx),
//              offsetof(EVP_MD_CTX, pctx_ops));
//          // ... HMAC_CTX, SHA_CTX, SHA256_CTX, SHA512_CTX, RIPEMD160_CTX,
//          //     asn1_string_st, OTHERNAME, GENERAL_NAME, OPENSSL_STACK,
//          //     BIO_METHOD, BIO
//          return 0;
//      }
//
// 2. Run on x86_64 Linux + macOS + Windows (MSVC).
//
// 3. // TODO(cross-validate): BoringSSL is **vendored** (`vendor/boringssl/`
//    per CLAUDE.md), but the worktree on this machine has only
//    `vendor/lolhtml`. A future commit that restores the vendored
//    submodule will let CI run #1 automatically. Until then these numbers
//    are analytical-only and the Phase-10 audit report should mark
//    boringssl as "asserts authored but not header-verified".
//
// 4. // TODO(cross-validate): The 9 opaque handles (`ENGINE`, `EVP_MD`, `SSL`,
//    `SSL_CTX`, `CRYPTO_BUFFER_POOL`, `X509`, `X509_NAME`, `X509_NAME_ENTRY`,
//    `X509_EXTENSION`, `X509V3_EXT_METHOD`, `ASN1_OBJECT`, `ASN1_TYPE`,
//    `EVP_PKEY_CTX`, `evp_md_pctx_ops`, `struct_stack_st_*`,
//    `CRYPTO_EX_DATA`, `SSL_METHOD`, `X509_STORE`, `X509_STORE_CTX`, `RSA`)
//    are zero-size by construction (via `bun_opaque::opaque_ffi!`) — they
//    are pointed-to only, never stored by value, so no struct layout
//    assert is required for them. The macro itself can be tripwired
//    separately (see `src/opaque/` for its existing tests).
//
// 5. Windows (MSVC LLP64) note: `asn1_string_st.flags` is `c_long` =
//    4B (not 8B) under MSVC. The struct shrinks from 24 → 20 bytes; tail
//    padding will round it back to 24 because of the 8-byte pointer
//    alignment. A `#[cfg(windows)]` block can be added once cl.exe-
//    measured. The four hash CTXs (SHA*, RIPEMD160), GENERAL_NAME, BIO,
//    BIO_METHOD, OPENSSL_STACK all have stable layouts across both LP64
//    and LLP64 because none of their fields are `c_long`.
//
// Once #1 / #2 are green on the per-OS Bun CI runners, this PoC is ready
// to be applied as a single-file patch to `src/boringssl_sys/boringssl.rs`.
