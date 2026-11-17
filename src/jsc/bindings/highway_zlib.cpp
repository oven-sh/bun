// The checksums of src/zlib, runtime-dispatched via Google Highway. src/highway/zlib.rs says what each takes.
//
// No load leaves the `len` bytes of the input.

// The list in scripts/build/deps/highway.ts and more: the rest of SVE, and what has nothing for these over AVX3_DL.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | (HWY_AVX3_DL - 1))
#ifndef __OPTIMIZE__
#error "Unless hwy::ChosenTarget::GetIndex() is inlined, the linker may keep that of a file with other targets."
#endif

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_zlib.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <array>
#include <stddef.h>
#include <stdint.h>

#if HWY_ARCH_ARM_A64
#include <arm_acle.h>
#endif

#ifndef BUN_ZLIB_TABLES
#define BUN_ZLIB_TABLES
namespace bun {

static constexpr size_t kPowers = 128;
// x^(64 * i + 31) modulo the polynomial of CRC-32, with `i` counting from the end.
[[maybe_unused]] alignas(64) static constexpr auto powers = [] {
    std::array<uint64_t, kPowers> table {};
    uint32_t power = 1;
    for (size_t i = kPowers; i-- != 0;) {
        table[i] = power;
        for (int bit = 0; bit < 64; bit++)
            power = (power >> 1) ^ (power & 1 ? 0xEDB88320 : 0);
    }
    return table;
}();

// What a byte counts for in the second sum of Adler-32, less a constant that makes it fit a signed byte.
static constexpr size_t kWeights = 256;
alignas(64) static constexpr auto weights = [] {
    std::array<uint8_t, kWeights + 64> table {};
    for (size_t i = 0; i < table.size(); i++)
        table[i] = static_cast<uint8_t>(kWeights / 2 - 1 - i);
    return table;
}();

} // namespace bun
#endif

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

#if HWY_ARCH_ARM_A64
static HWY_INLINE uint32_t Crc32ByInstruction(uint32_t state, const uint8_t* HWY_RESTRICT bytes, size_t len)
{
    const auto next = [&]<typename T>(T value) HWY_ATTR {
        hwy::CopyBytes<sizeof(T)>(bytes, &value);
        bytes += sizeof(T);
        return value;
    };
    for (size_t words = len / 8; words != 0; words--)
        state = __crc32d(state, next(uint64_t {}));
    if (len & 4) state = __crc32w(state, next(uint32_t {}));
    if (len & 2) state = __crc32h(state, next(uint16_t {}));
    if (len & 1) state = __crc32b(state, next(uint8_t {}));
    return state;
}
#endif

#if HWY_TARGET == HWY_SSSE3

uint64_t Crc32(uint32_t, const uint8_t*, size_t)
{
    return UINT64_MAX;
}

#elif HWY_TARGET == HWY_NEON_WITHOUT_AES

uint64_t Crc32(uint32_t state, const uint8_t* HWY_RESTRICT bytes, size_t len)
{
    return Crc32ByInstruction(state, bytes, len);
}

#else

template<class V>
static HWY_INLINE V FoldInto(V x, V factors, V sum)
{
    return hn::Xor3(hn::CLMulLower(x, factors), hn::CLMulUpper(x, factors), sum);
}

template<class D>
static HWY_INLINE hn::Vec<hn::Full128<uint64_t>> XorOfBlocks(D d, hn::Vec<D> v)
{
    if constexpr (hn::MaxLanes(d) == 2) {
        return v;
    } else {
        const hn::Half<D> half;
        return XorOfBlocks(half, hn::Xor(hn::LowerHalf(half, v), hn::UpperHalf(half, v)));
    }
}

template<class D, size_t kWays>
static HWY_INLINE uint32_t Fold(D d, uint32_t state, const uint8_t* HWY_RESTRICT bytes, size_t len)
{
    const hn::Repartition<uint8_t, D> d8;
    const hn::Full128<uint64_t> block;
    constexpr size_t N = hn::MaxLanes(d8);
    const auto load = [&](const uint8_t* at) HWY_ATTR { return hn::BitCast(d, hn::LoadU(d8, at)); };
    const auto first_lane = [&](uint64_t value) HWY_ATTR { return hn::ZeroExtendResizeBitCast(d, hn::Full64<uint64_t>(), hn::Set(hn::Full64<uint64_t>(), value)); };
    // For the vector that starts `left` bytes before the end.
    const auto factors = [&](size_t left) HWY_ATTR { return hn::LoadU(d, powers.data() + kPowers - left / 8); };

    const size_t odd = len % N;
    // Zeros in front of a message do not change its remainder.
    auto head = hn::Zero(d);
    auto first = first_lane(state);
    if (odd != 0) {
        head = hn::BitCast(d, hn::SlideUpLanes(d8, hn::BitCast(d8, hn::Xor(load(bytes), first)), N - odd));
        first = first_lane(uint64_t { state } >> HWY_MIN(8 * odd, 32));
        bytes += odd;
        len -= odd;
    }
    first = hn::Xor(first, load(bytes));

    auto sum = hn::Zero(d);
    if (len >= 2 * kWays * N) {
        hn::Vec<D> ways[kWays];
        ways[0] = FoldInto(head, hn::LoadDup128(d, powers.data() + kPowers - 1 - N / 8), first);
        for (size_t i = 1; i < kWays; i++)
            ways[i] = load(bytes + i * N);
        const auto across = hn::LoadDup128(d, powers.data() + kPowers - 1 - kWays * N / 8);
        do {
            bytes += kWays * N;
            len -= kWays * N;
            for (size_t i = 0; i < kWays; i++)
                ways[i] = FoldInto(ways[i], across, load(bytes + i * N));
        } while (len >= 2 * kWays * N);
        for (size_t i = 0; i < kWays; i++)
            sum = FoldInto(ways[i], factors(len - i * N), sum);
        bytes += kWays * N;
        len -= kWays * N;
    } else {
        sum = FoldInto(first, factors(len), FoldInto(head, factors(len + N), sum));
        bytes += N;
        len -= N;
    }
    for (; len != 0; bytes += N, len -= N)
        sum = FoldInto(load(bytes), factors(len), sum);

    const auto remainder = XorOfBlocks(d, sum);
    const auto quotient = hn::CLMulLower(remainder, hn::Set(block, 0xB4E5B025F7011641));
    const auto product = hn::CLMulLower(quotient, hn::Set(block, 0x1DB710641));
    return hn::ExtractLane(hn::BitCast(hn::Full128<uint32_t>(), hn::Xor(remainder, product)), 2);
}

uint64_t Crc32(uint32_t state, const uint8_t* HWY_RESTRICT bytes, size_t len)
{
#if HWY_ARCH_ARM_A64
    if (len < 128) return Crc32ByInstruction(state, bytes, len);
#endif
#if HWY_TARGET <= HWY_AVX3_DL
    if (len >= 64) return Fold<hn::Full512<uint64_t>, 4>({}, state, bytes, len);
#endif
    return Fold<hn::Full128<uint64_t>, 8>({}, state, bytes, len);
}
#endif

template<class D>
static HWY_INLINE uint32_t AddUp(D d, uint32_t adler, const uint8_t* HWY_RESTRICT bytes, size_t len)
{
    const hn::Repartition<int8_t, D> di8;
    const hn::Repartition<int16_t, D> di16;
    const hn::Repartition<int32_t, D> di32;
    const hn::Repartition<uint64_t, D> d64;
    constexpr size_t N = hn::MaxLanes(d);
    constexpr bool has_dot = HWY_TARGET <= HWY_AVX3_DL;
    constexpr size_t kGroup = has_dot ? 256 : 128;
    constexpr size_t kVectors = kGroup / N;
    constexpr size_t kChunk = 128 * 1024;
    const int8_t* group_weights = reinterpret_cast<const int8_t*>(weights.data()) + (kWeights - kGroup) / 2;
    const auto ones = hn::Set(di16, 1);
    const auto weigh = [&](auto x, const int8_t* at, auto sum) HWY_ATTR {
        if constexpr (has_dot)
            return hn::SumOfMulQuadAccumulate(di32, x, hn::LoadU(di8, at), sum);
        else
            return hn::Add(sum, hn::WidenMulPairwiseAdd(di32, hn::SatWidenMulPairwiseAdd(di16, x, hn::LoadU(di8, at)), ones));
    };

    uint64_t a = adler & 0xFFFF;
    uint64_t b = adler >> 16;
    do {
        size_t n = len % kChunk;
        if (n < N) n = HWY_MIN(len, kChunk / 2);
        len -= n;
        b += a * n;

        size_t odd = n % kGroup;
        n -= odd;
        const size_t partial = odd % N;
        const auto first = hn::IfThenElseZero(hn::FirstN(d, partial), hn::LoadU(d, bytes));
        auto sum = hn::SumsOf8(first);
        auto weighted = weigh(first, group_weights + kGroup - odd, hn::Zero(di32));
        bytes += partial;
        for (odd -= partial; odd != 0; odd -= N, bytes += N) {
            const auto x = hn::LoadU(d, bytes);
            sum = hn::Add(sum, hn::SumsOf8(x));
            weighted = weigh(x, group_weights + kGroup - odd, weighted);
        }

        auto sums = hn::Zero(d64);
        if (n != 0) {
            hn::Vec<decltype(di32)> ways[kVectors];
            for (size_t i = 0; i < kVectors; i++)
                ways[i] = hn::Zero(di32);
            for (; n != 0; n -= kGroup, bytes += kGroup) {
                sums = hn::Add(sums, sum);
                for (size_t i = 0; i < kVectors / 2; i++) {
                    const size_t j = i + kVectors / 2;
                    const auto x = hn::LoadU(d, bytes + i * N);
                    const auto y = hn::LoadU(d, bytes + j * N);
                    sum = hn::Add(sum, hn::Add(hn::SumsOf8(x), hn::SumsOf8(y)));
                    if constexpr (has_dot) {
                        ways[i] = weigh(x, group_weights + i * N, ways[i]);
                        ways[j] = weigh(y, group_weights + j * N, ways[j]);
                    } else {
                        const auto both = hn::Add(hn::SatWidenMulPairwiseAdd(di16, x, hn::LoadU(di8, group_weights + i * N)),
                            hn::SatWidenMulPairwiseAdd(di16, y, hn::LoadU(di8, group_weights + j * N)));
                        weighted = hn::Add(weighted, hn::WidenMulPairwiseAdd(di32, both, ones));
                    }
                }
            }
            if constexpr (has_dot)
                for (size_t i = 0; i < kVectors; i++)
                    weighted = hn::Add(weighted, ways[i]);
        }
        const uint64_t total = hn::ReduceSum(d64, sum);
        b += kGroup * hn::ReduceSum(d64, sums) + (kGroup / 2 + 1) * total + static_cast<int64_t>(hn::ReduceSum(di32, weighted));
        a = static_cast<uint32_t>(a + total) % 65521;
        b %= 65521;
    } while (len != 0);
    return static_cast<uint32_t>(a | b << 16);
}

uint32_t Adler32(uint32_t adler, const uint8_t* HWY_RESTRICT bytes, size_t len)
{
    const hn::ScalableTag<uint8_t> d;
    if (len < hn::MaxLanes(d)) return AddUp(hn::Full128<uint8_t>(), adler, bytes, len);
    return AddUp(d, adler, bytes, len);
}

// NOLINTNEXTLINE(google-readability-namespace-comments)
} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
HWY_EXPORT(Crc32);
HWY_EXPORT(Adler32);

// `len` is at least 16. Returns more than 32 bits if the CPU has no instruction for it.
extern "C" uint64_t highway_crc32(uint32_t state, const uint8_t* bytes, size_t len)
{
    return BUN_HWY_DISPATCH(Crc32)(state, bytes, len);
}

// `len` is at least 16.
extern "C" uint32_t highway_adler32(uint32_t adler, const uint8_t* bytes, size_t len)
{
    return BUN_HWY_DISPATCH(Adler32)(adler, bytes, len);
}
} // namespace bun
#endif
