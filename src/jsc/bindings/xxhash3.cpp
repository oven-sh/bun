// Runtime-dispatched SIMD xxHash3 (XXH3_64bits) via Google Highway.
//
// Bun.hash.xxHash3 used the twox-hash Rust crate, which selects its SIMD
// backend at compile time. On the linux-x64-baseline build (nehalem / SSE2)
// that meant the long-input stripe loop never reached AVX2, costing ~19% on
// 128 KB inputs versus the haswell build. This file moves the hot path to
// Highway's HWY_DYNAMIC_DISPATCH (the same mechanism as highway_strings.cpp),
// so a single binary picks the widest ISA the CPU actually supports.
//
// Output is bit-identical to the reference XXH3_64bits for every input: only
// the long-keys stripe loop (accumulate_512 + scrambleAcc) is vectorized, and
// that math is per-64-bit-lane, so scalar / SSE2 / AVX2 / AVX-512 all produce
// the same accumulators. The 0..240 byte branches, the merge/avalanche
// finisher, and the seeded-secret derivation are the reference's scalar code
// verbatim; they do not depend on vector width. Verified against the xxHash
// reference test vectors and SMHasher in xxhash.rs.
//
// References (byte-identical constants): vendor/zstd/lib/common/xxhash.h
// (XXH3_kSecret, PRIME*), and the twox-hash crate this replaces.

// Must be first.
#include "root.h"

#undef HWY_TARGET_INCLUDE
// Path relative to the build root (CMakeLists.txt), matching highway_strings.cpp.
#define HWY_TARGET_INCLUDE "xxhash3.cpp"
#include <hwy/foreach_target.h> // Must come before highway.h

#include <hwy/highway.h>

#include <cstddef>
#include <cstdint>
#include <cstring>

// ---------------------------------------------------------------------------
// Target-independent constants and scalar helpers.
//
// Guarded so foreach_target.h (which re-includes this file once per ISA) only
// expands them on the first pass — these do not depend on the SIMD target.
// ---------------------------------------------------------------------------
#ifndef BUN_XXH3_SCALAR_DEFINED
#define BUN_XXH3_SCALAR_DEFINED

namespace bun {
namespace xxh3 {

using u8 = uint8_t;
using u32 = uint32_t;
using u64 = uint64_t;

static constexpr u32 PRIME32_1 = 0x9E3779B1u;
static constexpr u32 PRIME32_2 = 0x85EBCA77u;
static constexpr u32 PRIME32_3 = 0xC2B2AE3Du;
static constexpr u64 PRIME64_1 = 0x9E3779B185EBCA87ull;
static constexpr u64 PRIME64_2 = 0xC2B2AE3D27D4EB4Full;
static constexpr u64 PRIME64_3 = 0x165667B19E3779F9ull;
static constexpr u64 PRIME64_4 = 0x85EBCA77C2B2AE63ull;
static constexpr u64 PRIME64_5 = 0x27D4EB2F165667C5ull;
static constexpr u64 PRIME_MX1 = 0x165667919E3779F9ull;
static constexpr u64 PRIME_MX2 = 0x9FB21C651E98DF25ull;

static constexpr size_t kSecretLen = 192;
static constexpr size_t kStripeLen = 64; // XXH_STRIPE_LEN
static constexpr size_t kAccNb = kStripeLen / sizeof(u64); // 8
static constexpr size_t kSecretConsumeRate = 8; // XXH_SECRET_CONSUME_RATE
static constexpr size_t kMidsizeMax = 240; // XXH3_MIDSIZE_MAX

// XXH3_kSecret — byte-for-byte the xxHash reference default secret.
// clang-format off
alignas(64) static constexpr u8 kSecret[kSecretLen] = {
    0xb8, 0xfe, 0x6c, 0x39, 0x23, 0xa4, 0x4b, 0xbe, 0x7c, 0x01, 0x81, 0x2c, 0xf7, 0x21, 0xad, 0x1c,
    0xde, 0xd4, 0x6d, 0xe9, 0x83, 0x90, 0x97, 0xdb, 0x72, 0x40, 0xa4, 0xa4, 0xb7, 0xb3, 0x67, 0x1f,
    0xcb, 0x79, 0xe6, 0x4e, 0xcc, 0xc0, 0xe5, 0x78, 0x82, 0x5a, 0xd0, 0x7d, 0xcc, 0xff, 0x72, 0x21,
    0xb8, 0x08, 0x46, 0x74, 0xf7, 0x43, 0x24, 0x8e, 0xe0, 0x35, 0x90, 0xe6, 0x81, 0x3a, 0x26, 0x4c,
    0x3c, 0x28, 0x52, 0xbb, 0x91, 0xc3, 0x00, 0xcb, 0x88, 0xd0, 0x65, 0x8b, 0x1b, 0x53, 0x2e, 0xa3,
    0x71, 0x64, 0x48, 0x97, 0xa2, 0x0d, 0xf9, 0x4e, 0x38, 0x19, 0xef, 0x46, 0xa9, 0xde, 0xac, 0xd8,
    0xa8, 0xfa, 0x76, 0x3f, 0xe3, 0x9c, 0x34, 0x3f, 0xf9, 0xdc, 0xbb, 0xc7, 0xc7, 0x0b, 0x4f, 0x1d,
    0x8a, 0x51, 0xe0, 0x4b, 0xcd, 0xb4, 0x59, 0x31, 0xc8, 0x9f, 0x7e, 0xc9, 0xd9, 0x78, 0x73, 0x64,
    0xea, 0xc5, 0xac, 0x83, 0x34, 0xd3, 0xeb, 0xc3, 0xc5, 0x81, 0xa0, 0xff, 0xfa, 0x13, 0x63, 0xeb,
    0x17, 0x0d, 0xdd, 0x51, 0xb7, 0xf0, 0xda, 0x49, 0xd3, 0x16, 0x55, 0x26, 0x29, 0xd4, 0x68, 0x9e,
    0x2b, 0x16, 0xbe, 0x58, 0x7d, 0x47, 0xa1, 0xfc, 0x8f, 0xf8, 0xb8, 0xd1, 0x7a, 0xd0, 0x31, 0xce,
    0x45, 0xcb, 0x3a, 0x8f, 0x95, 0x16, 0x04, 0x28, 0xaf, 0xd7, 0xfb, 0xca, 0xbb, 0x4b, 0x40, 0x7e,
};
// clang-format on

static inline u32 ReadLE32(const u8* p)
{
    u32 v;
    std::memcpy(&v, p, sizeof(v));
    return v; // runtime is little-endian (matches every Bun target).
}

static inline u64 ReadLE64(const u8* p)
{
    u64 v;
    std::memcpy(&v, p, sizeof(v));
    return v;
}

static inline u32 Swap32(u32 x) { return __builtin_bswap32(x); }
static inline u64 Swap64(u64 x) { return __builtin_bswap64(x); }
static inline u64 Rotl64(u64 x, int r) { return (x << r) | (x >> (64 - r)); }
static inline u64 Xorshift64(u64 v, int shift) { return v ^ (v >> shift); }

static inline u64 Mult32to64(u64 a, u64 b)
{
    return static_cast<u64>(static_cast<u32>(a)) * static_cast<u64>(static_cast<u32>(b));
}

// 64x64 -> 128, fold halves. Uses the compiler's 128-bit integer.
static inline u64 Mul128Fold64(u64 lhs, u64 rhs)
{
    __extension__ using u128 = unsigned __int128;
    u128 const product = static_cast<u128>(lhs) * static_cast<u128>(rhs);
    return static_cast<u64>(product) ^ static_cast<u64>(product >> 64);
}

static inline u64 XXH64_avalanche(u64 h)
{
    h ^= h >> 33;
    h *= PRIME64_2;
    h ^= h >> 29;
    h *= PRIME64_3;
    h ^= h >> 32;
    return h;
}

static inline u64 Avalanche(u64 h)
{
    h = Xorshift64(h, 37);
    h *= PRIME_MX1;
    h = Xorshift64(h, 32);
    return h;
}

static inline u64 Rrmxmx(u64 h, u64 len)
{
    h ^= Rotl64(h, 49) ^ Rotl64(h, 24);
    h *= PRIME_MX2;
    h ^= (h >> 35) + len;
    h *= PRIME_MX2;
    return Xorshift64(h, 28);
}

// --- Short-key branches (0..240 bytes). Scalar, width-independent. ---

static inline u64 Len1to3(const u8* input, size_t len, const u8* secret, u64 seed)
{
    u8 const c1 = input[0];
    u8 const c2 = input[len >> 1];
    u8 const c3 = input[len - 1];
    u32 const combined = (static_cast<u32>(c1) << 16) | (static_cast<u32>(c2) << 24)
        | (static_cast<u32>(c3) << 0) | (static_cast<u32>(len) << 8);
    u64 const bitflip = (ReadLE32(secret) ^ ReadLE32(secret + 4)) + seed;
    u64 const keyed = static_cast<u64>(combined) ^ bitflip;
    return XXH64_avalanche(keyed);
}

static inline u64 Len4to8(const u8* input, size_t len, const u8* secret, u64 seed)
{
    seed ^= static_cast<u64>(Swap32(static_cast<u32>(seed))) << 32;
    u32 const input1 = ReadLE32(input);
    u32 const input2 = ReadLE32(input + len - 4);
    u64 const bitflip = (ReadLE64(secret + 8) ^ ReadLE64(secret + 16)) - seed;
    u64 const input64 = input2 + (static_cast<u64>(input1) << 32);
    u64 const keyed = input64 ^ bitflip;
    return Rrmxmx(keyed, len);
}

static inline u64 Len9to16(const u8* input, size_t len, const u8* secret, u64 seed)
{
    u64 const bitflip1 = (ReadLE64(secret + 24) ^ ReadLE64(secret + 32)) + seed;
    u64 const bitflip2 = (ReadLE64(secret + 40) ^ ReadLE64(secret + 48)) - seed;
    u64 const input_lo = ReadLE64(input) ^ bitflip1;
    u64 const input_hi = ReadLE64(input + len - 8) ^ bitflip2;
    u64 const acc = len + Swap64(input_lo) + input_hi + Mul128Fold64(input_lo, input_hi);
    return Avalanche(acc);
}

static inline u64 Len0to16(const u8* input, size_t len, const u8* secret, u64 seed)
{
    if (len > 8) return Len9to16(input, len, secret, seed);
    if (len >= 4) return Len4to8(input, len, secret, seed);
    if (len) return Len1to3(input, len, secret, seed);
    return XXH64_avalanche(seed ^ (ReadLE64(secret + 56) ^ ReadLE64(secret + 64)));
}

static inline u64 Mix16B(const u8* input, const u8* secret, u64 seed)
{
    u64 const input_lo = ReadLE64(input);
    u64 const input_hi = ReadLE64(input + 8);
    return Mul128Fold64(
        input_lo ^ (ReadLE64(secret) + seed),
        input_hi ^ (ReadLE64(secret + 8) - seed));
}

static inline u64 Len17to128(const u8* input, size_t len, const u8* secret, u64 seed)
{
    u64 acc = static_cast<u64>(len) * PRIME64_1;
    if (len > 32) {
        if (len > 64) {
            if (len > 96) {
                acc += Mix16B(input + 48, secret + 96, seed);
                acc += Mix16B(input + len - 64, secret + 112, seed);
            }
            acc += Mix16B(input + 32, secret + 64, seed);
            acc += Mix16B(input + len - 48, secret + 80, seed);
        }
        acc += Mix16B(input + 16, secret + 32, seed);
        acc += Mix16B(input + len - 32, secret + 48, seed);
    }
    acc += Mix16B(input + 0, secret + 0, seed);
    acc += Mix16B(input + len - 16, secret + 16, seed);
    return Avalanche(acc);
}

static inline u64 Len129to240(const u8* input, size_t len, const u8* secret, u64 seed)
{
    static constexpr size_t kStartOffset = 3;
    static constexpr size_t kLastOffset = 17;
    static constexpr size_t kSecretSizeMin = 136; // XXH3_SECRET_SIZE_MIN

    u64 acc = static_cast<u64>(len) * PRIME64_1;
    u64 acc_end;
    unsigned int const nbRounds = static_cast<unsigned int>(len) / 16;
    for (unsigned int i = 0; i < 8; i++) {
        acc += Mix16B(input + (16 * i), secret + (16 * i), seed);
    }
    acc_end = Mix16B(input + len - 16, secret + kSecretSizeMin - kLastOffset, seed);
    acc = Avalanche(acc);
    for (unsigned int i = 8; i < nbRounds; i++) {
        acc_end += Mix16B(input + (16 * i), secret + (16 * (i - 8)) + kStartOffset, seed);
    }
    return Avalanche(acc + acc_end);
}

// --- Long-key finisher (scalar) ---

static constexpr u64 kInitAcc[kAccNb] = {
    PRIME32_3, PRIME64_1, PRIME64_2, PRIME64_3, PRIME64_4, PRIME32_2, PRIME64_5, PRIME32_1
};

static inline u64 Mix2Accs(const u64* acc, const u8* secret)
{
    return Mul128Fold64(acc[0] ^ ReadLE64(secret), acc[1] ^ ReadLE64(secret + 8));
}

static inline u64 MergeAccs(const u64* acc, const u8* secret, u64 start)
{
    u64 result64 = start;
    for (size_t i = 0; i < 4; i++) {
        result64 += Mix2Accs(acc + 2 * i, secret + 16 * i);
    }
    return Avalanche(result64);
}

// Seeded custom-secret derivation (XXH3_initCustomSecret_scalar). Rare path
// (seed != 0); scalar is fine and keeps width-independence trivially true.
static inline void InitCustomSecret(u8* customSecret, u64 seed64)
{
    size_t const nbRounds = kSecretLen / 16;
    for (size_t i = 0; i < nbRounds; i++) {
        u64 const lo = ReadLE64(kSecret + 16 * i) + seed64;
        u64 const hi = ReadLE64(kSecret + 16 * i + 8) - seed64;
        std::memcpy(customSecret + 16 * i, &lo, 8);
        std::memcpy(customSecret + 16 * i + 8, &hi, 8);
    }
}

} // namespace xxh3
} // namespace bun

#endif // BUN_XXH3_SCALAR_DEFINED

// ---------------------------------------------------------------------------
// Per-target SIMD kernels (re-compiled once per ISA by foreach_target.h).
// ---------------------------------------------------------------------------
HWY_BEFORE_NAMESPACE();
namespace bun {
namespace xxh3 {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

// One 64-byte stripe (XXH3_accumulate_512). Processes the eight u64 lanes in
// whatever width the target provides; the per-lane math is identical to the
// scalar reference so output does not depend on the lane count. The tag is
// capped at kAccNb (8) lanes so a wider-than-512-bit target can't over-read the
// stripe, and 8 is divisible by every resulting width (1/2/4/8).
static HWY_INLINE void Accumulate512(u64* HWY_RESTRICT acc, const u8* HWY_RESTRICT input, const u8* HWY_RESTRICT secret)
{
    const hn::CappedTag<u64, kAccNb> d64;
    const hn::Repartition<u32, decltype(d64)> d32;
    const size_t N = hn::Lanes(d64);
    for (size_t i = 0; i < kAccNb; i += N) {
        const auto data = hn::LoadU(d64, reinterpret_cast<const u64*>(input + i * 8));
        const auto key = hn::LoadU(d64, reinterpret_cast<const u64*>(secret + i * 8));
        const auto data_key = hn::Xor(data, key);
        // product[lane] = (data_key & 0xffffffff) * (data_key >> 32)
        const auto dk_lo = hn::BitCast(d32, data_key);
        const auto dk_hi = hn::BitCast(d32, hn::ShiftRight<32>(data_key));
        const auto product = hn::MulEven(dk_lo, dk_hi);
        // acc[lane] += swap-adjacent-64(data)[lane]; Shuffle01 swaps the two
        // u64 within each 128-bit block == the reference's `acc[lane ^ 1]`.
        const auto swapped = hn::Shuffle01(data);
        auto a = hn::LoadU(d64, acc + i);
        a = hn::Add(hn::Add(a, swapped), product);
        hn::StoreU(a, d64, acc + i);
    }
}

// XXH3_scrambleAcc: acc ^= acc >> 47; acc ^= secret; acc *= PRIME32_1 (32-bit).
static HWY_INLINE void ScrambleAcc(u64* HWY_RESTRICT acc, const u8* HWY_RESTRICT secret)
{
    const hn::CappedTag<u64, kAccNb> d64;
    const hn::Repartition<u32, decltype(d64)> d32;
    const size_t N = hn::Lanes(d64);
    const auto prime = hn::Set(d32, PRIME32_1);
    for (size_t i = 0; i < kAccNb; i += N) {
        auto a = hn::LoadU(d64, acc + i);
        const auto key = hn::LoadU(d64, reinterpret_cast<const u64*>(secret + i * 8));
        a = hn::Xor(a, hn::ShiftRight<47>(a));
        a = hn::Xor(a, key);
        // a *= PRIME32_1 as a 64-bit multiply by a 32-bit constant:
        //   lo = (a & 0xffffffff) * prime; hi = (a >> 32) * prime; a = lo + (hi << 32)
        const auto a_lo = hn::BitCast(d32, a);
        const auto a_hi = hn::BitCast(d32, hn::ShiftRight<32>(a));
        const auto prod_lo = hn::MulEven(a_lo, prime);
        const auto prod_hi = hn::MulEven(a_hi, prime);
        a = hn::Add(prod_lo, hn::ShiftLeft<32>(prod_hi));
        hn::StoreU(a, d64, acc + i);
    }
}

// Full long-input hash (len > 240): the stripe loop + finisher. Dispatched
// once per call so the ISA is resolved a single time, not per stripe.
u64 HashLong(const u8* HWY_RESTRICT input, size_t len, const u8* HWY_RESTRICT secret)
{
    HWY_ALIGN u64 acc[kAccNb];
    std::memcpy(acc, kInitAcc, sizeof(acc));

    size_t const nbStripesPerBlock = (kSecretLen - kStripeLen) / kSecretConsumeRate;
    size_t const block_len = kStripeLen * nbStripesPerBlock;
    size_t const nb_blocks = (len - 1) / block_len;

    for (size_t n = 0; n < nb_blocks; n++) {
        const u8* const blockInput = input + n * block_len;
        for (size_t s = 0; s < nbStripesPerBlock; s++) {
            Accumulate512(acc, blockInput + s * kStripeLen, secret + s * kSecretConsumeRate);
        }
        ScrambleAcc(acc, secret + kSecretLen - kStripeLen);
    }

    // Last partial block.
    size_t const nbStripes = ((len - 1) - (block_len * nb_blocks)) / kStripeLen;
    const u8* const lastBlockInput = input + nb_blocks * block_len;
    for (size_t s = 0; s < nbStripes; s++) {
        Accumulate512(acc, lastBlockInput + s * kStripeLen, secret + s * kSecretConsumeRate);
    }

    // Last stripe (always the final 64 bytes).
    static constexpr size_t kLastAccStart = 7; // XXH_SECRET_LASTACC_START
    Accumulate512(acc, input + len - kStripeLen, secret + kSecretLen - kStripeLen - kLastAccStart);

    static constexpr size_t kMergeAccsStart = 11; // XXH_SECRET_MERGEACCS_START
    return MergeAccs(acc, secret + kMergeAccsStart, static_cast<u64>(len) * PRIME64_1);
}

} // namespace HWY_NAMESPACE
} // namespace xxh3
} // namespace bun
HWY_AFTER_NAMESPACE();

// ---------------------------------------------------------------------------
// Dispatch table + C entry point (compiled once).
//
// This TU intentionally pulls in no JSC/WebKit headers — it stays a lean SIMD
// unit. The `bun:internal-for-testing` host wrapper that needs JSC types lives
// in xxhash3_testing.cpp and calls the C symbol below.
// ---------------------------------------------------------------------------
#if HWY_ONCE

namespace bun {
namespace xxh3 {

HWY_EXPORT(HashLong);

// XXH3_64bits_withSeed. `seed` is the full 64-bit seed; callers that need the
// JS `@truncate(seed)` semantics truncate before calling (HashObject does).
static u64 Hash64(const u8* input, size_t len, u64 seed)
{
    if (len <= 16) {
        return Len0to16(input, len, kSecret, seed);
    }
    if (len <= 128) {
        return Len17to128(input, len, kSecret, seed);
    }
    if (len <= kMidsizeMax) {
        return Len129to240(input, len, kSecret, seed);
    }
    // Long input: seed == 0 uses the default secret directly; otherwise derive
    // a per-seed secret (matches XXH3_hashLong_64b_withSeed_internal).
    if (seed == 0) {
        return HWY_DYNAMIC_DISPATCH(HashLong)(input, len, kSecret);
    }
    alignas(64) u8 customSecret[kSecretLen];
    InitCustomSecret(customSecret, seed);
    return HWY_DYNAMIC_DISPATCH(HashLong)(input, len, customSecret);
}

} // namespace xxh3

extern "C" {

// Runtime-dispatched XXH3_64bits_withSeed. `input` may be null only when
// `len == 0`. Output is bit-identical to the xxHash reference.
uint64_t highway_xxhash3_64(const uint8_t* input, size_t len, uint64_t seed)
{
    return bun::xxh3::Hash64(input, len, seed);
}

} // extern "C"

} // namespace bun

#endif // HWY_ONCE
