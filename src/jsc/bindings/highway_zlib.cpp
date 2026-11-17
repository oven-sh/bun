// The kernels of src/zlib, runtime-dispatched via Google Highway. src/highway/zlib.rs says what each takes.
//
// No load of a checksum leaves the `len` bytes of the input, and no store those of its copy.

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

// x^exponent modulo the polynomial of CRC-32. The lowest bit stands for x^31.
static constexpr uint32_t CrcPower(size_t exponent)
{
    uint32_t power = 0x80000000;
    for (; exponent != 0; exponent--)
        power = (power >> 1) ^ (power & 1 ? 0xEDB88320 : 0);
    return power;
}

// For the last 8-byte words of a message. The sum of the products is the message times x^32, in 96 bits.
[[maybe_unused]] alignas(64) static constexpr auto kCrcFactors = [] {
    std::array<uint64_t, 64> factors {};
    for (size_t i = 0; i < factors.size(); i++)
        factors[factors.size() - 1 - i] = CrcPower(64 * i + 31);
    return factors;
}();

// For each period below 16, where in it each of 32 bytes is, and how many bytes the whole periods take.
struct Periods {
    alignas(16) uint8_t indices[16][32];
    uint8_t steps[16];
};
[[maybe_unused]] static constexpr Periods periods = [] {
    Periods table {};
    for (size_t period = 1; period < 16; period++) {
        for (size_t i = 0; i < 32; i++)
            table.indices[period][i] = i % period;
        table.steps[period] = 32 - 32 % period;
    }
    return table;
}();

} // namespace bun
#endif

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

#if HWY_TARGET <= HWY_AVX3_DL || HWY_TARGET == HWY_NEON_BF16 || defined(__ARM_FEATURE_DOTPROD)
static constexpr bool kHasDotProduct = true;
#else
static constexpr bool kHasDotProduct = false;
#endif

// What a checksum reads. All of it is read, so with `kCopies` all of it ends up at `copy`.
template<bool kCopies>
struct Input {
    // Told that they do not overlap, the compiler makes a memcpy() of the stores, which is a second pass.
    const uint8_t* bytes;
    uint8_t* copy;

    template<class D>
    HWY_INLINE hn::Vec<D> Load(D d, size_t at) const
    {
        const hn::Repartition<uint8_t, D> d8;
        const auto v = hn::LoadU(d8, bytes + at);
        if constexpr (kCopies) hn::StoreU(v, d8, copy + at);
        return hn::BitCast(d, v);
    }

    template<typename T>
    HWY_INLINE T Load(size_t at) const
    {
        T value;
        hwy::CopyBytes<sizeof(T)>(bytes + at, &value);
        if constexpr (kCopies) hwy::CopyBytes<sizeof(T)>(&value, copy + at);
        return value;
    }

    HWY_INLINE void Advance(size_t count)
    {
        bytes += count;
        if constexpr (kCopies) copy += count;
    }
};

// Halves `v` until it has 128 bits.
template<class D, class Combine>
static HWY_INLINE auto CombineBlocks(D d, hn::Vec<D> v, Combine combine)
{
    if constexpr (d.MaxBytes() == 16) {
        return v;
    } else {
        const hn::Half<D> half;
        return CombineBlocks(half, combine(hn::LowerHalf(half, v), hn::UpperHalf(half, v)), combine);
    }
}

#if HWY_ARCH_ARM_A64
template<class Input>
static HWY_INLINE uint32_t Crc32ByInstruction(uint32_t state, Input input, size_t len)
{
    for (size_t words = len / 8; words != 0; words--, input.Advance(8))
        state = __crc32d(state, input.template Load<uint64_t>(0));
    if (len & 4) state = __crc32w(state, input.template Load<uint32_t>(0));
    if (len & 2) state = __crc32h(state, input.template Load<uint16_t>(len & 4));
    if (len & 1) state = __crc32b(state, input.template Load<uint8_t>(len & 6));
    return state;
}
#endif

#if HWY_TARGET == HWY_SSSE3

template<bool kCopies>
static HWY_INLINE uint64_t Crc32Of(uint32_t, Input<kCopies> input, size_t len)
{
    if constexpr (kCopies) hwy::CopyBytes(input.bytes, input.copy, len);
    return UINT64_MAX;
}

#elif HWY_TARGET == HWY_NEON_WITHOUT_AES

template<class Input>
static HWY_INLINE uint64_t Crc32Of(uint32_t state, Input input, size_t len)
{
    return Crc32ByInstruction(state, input, len);
}

#else

template<class V>
static HWY_INLINE V AddProducts(V sum, V words, V factors)
{
    return hn::Xor3(hn::CLMulLower(words, factors), hn::CLMulUpper(words, factors), sum);
}

// The factors that turn a vector into what can be added `kDistance` bytes further on in its place.
template<size_t kDistance, class D>
static HWY_INLINE hn::Vec<D> Across(D d)
{
    constexpr uint64_t lower = CrcPower(8 * kDistance + 31), upper = CrcPower(8 * kDistance - 33);
    return hn::Dup128VecFromValues(d, lower, upper);
}

template<class D>
static HWY_INLINE hn::Vec<D> InFront(D d, uint64_t value)
{
    const hn::Full64<uint64_t> word;
    return hn::ZeroExtendResizeBitCast(d, word, hn::Set(word, value));
}

// For the vector that starts so many bytes before the end of the message.
template<class D>
static HWY_INLINE hn::Vec<D> FactorsBeforeEnd(D d, size_t left)
{
    const auto* end = reinterpret_cast<const uint8_t*>(kCrcFactors.data() + kCrcFactors.size());
    return hn::BitCast(d, hn::LoadU(hn::Repartition<uint8_t, D>(), end - left));
}

// Barrett reduction, with x^95 divided by the polynomial and the polynomial itself.
template<class D>
static HWY_INLINE uint32_t Remainder(D d, hn::Vec<D> sum)
{
    const hn::Full128<uint64_t> block;
    const auto dividend = CombineBlocks(d, sum, [](auto a, auto b) HWY_ATTR { return hn::Xor(a, b); });
    const auto quotient = hn::CLMulLower(dividend, hn::Set(block, 0xB4E5B025F7011641));
    const auto product = hn::CLMulLower(quotient, hn::Set(block, 0x1DB710641));
    return hn::ExtractLane(hn::BitCast(hn::Full128<uint32_t>(), hn::Xor(dividend, product)), 2);
}

// Below, `ways` stand for everything up to `kStep` bytes behind the start of `input`. They are so many that a
// multiplication can start while the others take their time.

#if HWY_ARCH_ARM_A64

template<class Input>
static HWY_INLINE uint64_t Crc32Of(uint32_t state, Input input, size_t len)
{
    const hn::Full128<uint64_t> d;
    constexpr size_t N = 16, kWays = 8, kStep = kWays * N;
    // The instruction has a unit of its own, which works on these bytes meanwhile. Newer CPUs multiply faster.
    constexpr size_t kSkipped = kHasDotProduct ? 64 : 128;
    if (len >= 2 * kStep + kSkipped) {
        hn::Vec<decltype(d)> ways[kWays];
        for (size_t i = 0; i < kWays; i++)
            ways[i] = input.Load(d, i * N);
        ways[0] = hn::Xor(ways[0], InFront(d, state));
        do {
            input.Advance(kStep);
            const uint32_t skipped = Crc32ByInstruction(0, input, kSkipped);
            input.Advance(kSkipped);
            for (size_t i = 0; i < kWays; i++)
                ways[i] = AddProducts(input.Load(d, i * N), ways[i], Across<kStep + kSkipped>(d));
            ways[0] = hn::Xor(ways[0], InFront(d, skipped));
            len -= kStep + kSkipped;
        } while (len >= 2 * kStep + kSkipped);
        auto sum = hn::Zero(d);
        for (size_t i = 0; i < kWays; i++)
            sum = AddProducts(sum, ways[i], FactorsBeforeEnd(d, kStep - i * N));
        state = Remainder(d, sum);
        input.Advance(kStep);
        len -= kStep;
    }
    return Crc32ByInstruction(state, input, len);
}

#else

template<size_t kWays, class D, class Input>
static HWY_INLINE uint32_t Crc32ByFolding(D d, uint32_t state, Input input, size_t len)
{
    const hn::Repartition<uint8_t, D> d8;
    constexpr size_t N = hn::MaxLanes(d8), kStep = kWays * N;
    static_assert(2 * kStep <= sizeof(kCrcFactors));
    HWY_DASSERT(len >= N);

    auto first = InFront(d, state);
    if (const size_t odd = len % N) {
        // Zeros in front of a message do not change its remainder.
        const auto padded = hn::SlideUpLanes(d8, hn::BitCast(d8, hn::Xor(input.Load(d, 0), first)), N - odd);
        const auto rest_of_state = InFront(d, uint64_t { state } >> HWY_MIN(8 * odd, 32));
        first = AddProducts(rest_of_state, hn::BitCast(d, padded), Across<N>(d));
        input.Advance(odd);
        len -= odd;
    }
    first = hn::Xor(first, input.Load(d, 0));

    auto sum = hn::Zero(d);
    if (len >= 2 * kStep) {
        hn::Vec<D> ways[kWays] = { first };
        for (size_t i = 1; i < kWays; i++)
            ways[i] = input.Load(d, i * N);
#if HWY_TARGET > HWY_AVX3_DL
        // A vector need not be multiplied if it is added to those this far on. https://arxiv.org/abs/2412.16398
        static constexpr size_t kDistances[] = { 15, 17, 20, 23, 26, 28, 46, 50, 53 };
        static_assert([] {
            uint32_t sum = CrcPower(53);
            for (const size_t distance : kDistances)
                sum ^= CrcPower(53 - distance);
            return sum == 0;
        }());
        // More, and the additions take longer than the multiplications on a CPU that starts one in every cycle.
        constexpr size_t kSkipped = 18, kFolded = 54;
        static_assert(kFolded >= 53 && kFolded % kWays == 0);
        for (; len >= kStep + (kSkipped + kFolded) * N; len -= (kSkipped + kFolded) * N) {
            hn::Vec<D> skipped[kSkipped];
            HWY_UNROLL(72)
            for (size_t i = 0; i < kSkipped + kFolded; i++) {
                auto x = input.Load(d, kStep + i * N);
                for (const size_t distance : kDistances) {
                    if (i - distance < kSkipped) x = hn::Xor(x, skipped[i - distance]);
                }
                if (i < kSkipped) {
                    skipped[i] = x;
                } else {
                    auto& way = ways[(i - kSkipped) % kWays];
                    way = AddProducts(x, way, i < kSkipped + kWays ? Across<kStep + kSkipped * N>(d) : Across<kStep>(d));
                }
            }
            input.Advance((kSkipped + kFolded) * N);
        }
#endif
        for (; len >= 2 * kStep; len -= kStep) {
            input.Advance(kStep);
            for (size_t i = 0; i < kWays; i++)
                ways[i] = AddProducts(input.Load(d, i * N), ways[i], Across<kStep>(d));
        }
        for (size_t i = 0; i < kWays; i++)
            sum = AddProducts(sum, ways[i], FactorsBeforeEnd(d, len - i * N));
        input.Advance(kStep);
        len -= kStep;
    } else {
        sum = AddProducts(sum, first, FactorsBeforeEnd(d, len));
        input.Advance(N);
        len -= N;
    }
    HWY_UNROLL(1)
    for (; len != 0; input.Advance(N), len -= N)
        sum = AddProducts(sum, input.Load(d, 0), FactorsBeforeEnd(d, len));
    return Remainder(d, sum);
}

template<class Input>
static HWY_INLINE uint64_t Crc32Of(uint32_t state, Input input, size_t len)
{
#if HWY_TARGET <= HWY_AVX3_DL
    if (len >= 64) return Crc32ByFolding<4>(hn::Full512<uint64_t>(), state, input, len);
#endif
    return Crc32ByFolding<6>(hn::Full128<uint64_t>(), state, input, len);
}

#endif
#endif

uint64_t Crc32(uint32_t state, const uint8_t* bytes, size_t len)
{
    return Crc32Of(state, Input<false> { bytes, nullptr }, len);
}

uint64_t CopyAndCrc32(uint32_t state, const uint8_t* bytes, uint8_t* copy, size_t len)
{
    return Crc32Of(state, Input<true> { bytes, copy }, len);
}

template<class D, class V>
static HWY_INLINE V AddBytes(D d, V sums, hn::Vec<D> bytes)
{
    const hn::Repartition<uint32_t, D> d32;
    if constexpr (HWY_ARCH_X86) {
        return hn::Add(sums, hn::BitCast(d32, hn::SumsOf8(bytes)));
    } else if constexpr (kHasDotProduct) {
        return hn::SumOfMulQuadAccumulate(d32, bytes, hn::Set(d, 1), sums);
    } else {
        return hn::Add(sums, hn::SumsOf4(bytes));
    }
}

// The `weights` are signed on x64. Without a dot product they are -64 to 64, so that 16 bits hold two products.
template<class D, class V>
static HWY_INLINE V AddWeighted(D d, V sums, hn::Vec<D> bytes, hn::Vec<D> weights)
{
    const hn::Repartition<uint32_t, D> d32;
    const hn::Repartition<int32_t, D> di32;
    const hn::Repartition<uint16_t, D> d16;
    const hn::Repartition<int16_t, D> di16;
    const auto signed_weights = hn::BitCast(hn::RebindToSigned<D>(), weights);
    if constexpr (HWY_ARCH_X86 && kHasDotProduct) {
        return hn::BitCast(d32, hn::SumOfMulQuadAccumulate(di32, bytes, signed_weights, hn::BitCast(di32, sums)));
    } else if constexpr (HWY_ARCH_X86) {
        const auto pairs = hn::SatWidenMulPairwiseAdd(di16, bytes, signed_weights);
        return hn::Add(sums, hn::BitCast(d32, hn::WidenMulPairwiseAdd(di32, pairs, hn::Set(di16, 1))));
    } else if constexpr (kHasDotProduct) {
        return hn::SumOfMulQuadAccumulate(d32, bytes, weights, sums);
    } else {
        const auto lower = hn::Mul(hn::PromoteLowerTo(d16, bytes), hn::PromoteLowerTo(d16, weights));
        const auto pairs = hn::MulAdd(hn::PromoteUpperTo(d16, bytes), hn::PromoteUpperTo(d16, weights), lower);
        return hn::Add(sums, hn::SumsOf2(pairs));
    }
}

// A byte is added to `a` once, and to `b` once for every byte from it to the end: to the end of its group, which is
// its weight, and then `kGroup` times for every group behind it.
template<class D, class Input>
static HWY_INLINE uint32_t Adler32InGroups(D d, uint32_t adler, Input input, size_t len)
{
    const hn::Repartition<uint32_t, D> d32;
    constexpr size_t N = hn::MaxLanes(d);
    constexpr size_t kGroup = (HWY_ARCH_X86 ? 128 : 64) * (kHasDotProduct ? 2 : 1);
    constexpr size_t kVectors = kGroup / N;
    // Taken off the weights to get them into signed bytes.
    constexpr uint32_t kBias = HWY_ARCH_X86 ? kGroup / 2 + 1 : 0;
    // ADLER32_PIECE in src/highway/zlib.rs
    constexpr uint64_t kMostGroups = (HWY_ARCH_X86 ? 65536 : 16384) / kGroup;
    static_assert(255 * kGroup * kMostGroups * kMostGroups / 2 <= UINT32_MAX);
    static_assert(255 * kGroup * (kGroup + 1) / 2 * kMostGroups <= UINT32_MAX);
    HWY_DASSERT(len >= N && len <= kMostGroups * kGroup);
    const auto weights = [&](size_t left) HWY_ATTR {
        return hn::Sub(hn::Set(d, static_cast<uint8_t>(left - kBias)), hn::Iota(d, 0));
    };
    const auto total = [&](auto v) HWY_ATTR {
        return hn::ReduceSum(hn::Full128<uint32_t>(), CombineBlocks(d32, v, [](auto a, auto b) HWY_ATTR { return hn::Add(a, b); }));
    };

    const uint32_t a = adler & 0xFFFF;
    uint64_t b = (adler >> 16) + uint64_t { a } * len;

    // The first group is as short as it takes for the others to be whole.
    size_t left = len % kGroup;
    len -= left;
    auto sum = hn::Zero(d32), weighted = sum;
    if (const size_t odd = left % N) {
        const auto x = hn::IfThenElseZero(hn::FirstN(d, odd), input.Load(d, 0));
        sum = AddBytes(d, sum, x);
        weighted = AddWeighted(d, weighted, x, weights(left));
        input.Advance(odd);
        left -= odd;
    }
    HWY_UNROLL(1)
    for (auto next = weights(left); left != 0; input.Advance(N), left -= N) {
        const auto x = input.Load(d, 0);
        sum = AddBytes(d, sum, x);
        weighted = AddWeighted(d, weighted, x, next);
        next = hn::Sub(next, hn::Set(d, N));
    }

    if (len != 0) {
        auto sums_before = hn::Zero(d32);
        if constexpr (kHasDotProduct) {
            hn::Vec<decltype(d32)> ways[kVectors] = { weighted };
            for (size_t i = 1; i < kVectors; i++)
                ways[i] = hn::Zero(d32);
            for (; len != 0; input.Advance(kGroup), len -= kGroup) {
                auto group = hn::Zero(d32);
                for (size_t i = 0; i < kVectors; i++) {
                    const auto x = input.Load(d, i * N);
                    group = AddBytes(d, group, x);
                    ways[i] = AddWeighted(d, ways[i], x, weights(kGroup - i * N));
                }
                sums_before = hn::Add(sums_before, sum);
                sum = hn::Add(sum, group);
            }
            weighted = ways[0];
            for (size_t i = 1; i < kVectors; i++)
                weighted = hn::Add(weighted, ways[i]);
        } else if constexpr (HWY_ARCH_X86) {
            const hn::Repartition<int32_t, D> di32;
            const hn::Repartition<int16_t, D> di16;
            const auto pairs = [&](auto x, size_t at) HWY_ATTR {
                return hn::SatWidenMulPairwiseAdd(di16, x, hn::BitCast(hn::RebindToSigned<D>(), weights(kGroup - at)));
            };
            for (; len != 0; input.Advance(kGroup), len -= kGroup) {
                sums_before = hn::Add(sums_before, sum);
                hn::Vec<D> x[kVectors];
                for (size_t i = 0; i < kVectors; i++) {
                    x[i] = input.Load(d, i * N);
                    sum = AddBytes(d, sum, x[i]);
                }
                // The weights are positive in one half and negative in the other, so 16 bits hold the sum.
                for (size_t i = 0, j = kVectors / 2; j < kVectors; i++, j++) {
                    const auto both = hn::Add(pairs(x[i], i * N), pairs(x[j], j * N));
                    weighted = hn::Add(weighted, hn::BitCast(d32, hn::WidenMulPairwiseAdd(di32, both, hn::Set(di16, 1))));
                }
            }
        } else {
            // The bytes that have the same weight are added up first.
            const hn::Repartition<uint16_t, D> d16;
            static_assert(255 * kMostGroups <= UINT16_MAX);
            hn::Vec<decltype(d16)> columns[2 * kVectors];
            for (auto& column : columns)
                column = hn::Zero(d16);
            for (; len != 0; input.Advance(kGroup), len -= kGroup) {
                auto group = hn::Zero(d16);
                for (size_t i = 0; i < kVectors; i++) {
                    const auto x = input.Load(d, i * N);
                    group = hn::Add(group, hn::SumsOf2(x));
                    columns[2 * i] = hn::Add(columns[2 * i], hn::PromoteLowerTo(d16, x));
                    columns[2 * i + 1] = hn::Add(columns[2 * i + 1], hn::PromoteUpperTo(d16, x));
                }
                sums_before = hn::Add(sums_before, sum);
                sum = hn::Add(sum, hn::SumsOf2(group));
            }
            auto upper = hn::Zero(d32);
            for (size_t i = 0; i < 2 * kVectors; i++) {
                const auto wide_weights = hn::Sub(hn::Set(d16, kGroup - i * N / 2), hn::Iota(d16, 0));
                weighted = hn::ReorderWidenMulAccumulate(d32, columns[i], wide_weights, weighted, upper);
            }
            weighted = hn::Add(weighted, upper);
        }
        b += uint64_t { kGroup } * total(sums_before);
    }

    constexpr uint32_t kModulus = 65521;
    const uint32_t byte_sum = total(sum);
    b += total(weighted) + kBias * byte_sum;
    // Knowing that the upper bits are zero, the compiler divides in fewer steps.
    b &= (uint64_t { 1 } << 41) - 1;
    return (a + byte_sum) % kModulus | static_cast<uint32_t>(b % kModulus) << 16;
}

template<bool kCopies>
static HWY_INLINE uint32_t Adler32Of(uint32_t adler, Input<kCopies> input, size_t len)
{
    // The stores hold up either size, and half as many of 32 bytes cross a cache line.
    const hn::CappedTag<uint8_t, kCopies && kHasDotProduct ? 32 : 64> d;
    if constexpr (hn::MaxLanes(d) > 16) {
        if (len < hn::MaxLanes(d)) return Adler32InGroups(hn::Full128<uint8_t>(), adler, input, len);
    }
    return Adler32InGroups(d, adler, input, len);
}

uint32_t Adler32(uint32_t adler, const uint8_t* bytes, size_t len)
{
    return Adler32Of(adler, Input<false> { bytes, nullptr }, len);
}

uint32_t CopyAndAdler32(uint32_t adler, const uint8_t* bytes, uint8_t* copy, size_t len)
{
    return Adler32Of(adler, Input<true> { bytes, copy }, len);
}

void SubtractSaturating(uint16_t* HWY_RESTRICT values, size_t groups, uint16_t amount)
{
    const hn::ScalableTag<uint16_t> d;
    const auto subtrahend = hn::Set(d, amount);
    for (; groups != 0; groups--, values += 64) {
        for (size_t i = 0; i < 64; i += hn::MaxLanes(d))
            hn::StoreU(hn::SaturatedSub(hn::LoadU(d, values + i), subtrahend), d, values + i);
    }
}

#if HWY_TARGET == HWY_STATIC_TARGET
static HWY_INLINE void Repeat(const uint8_t* from, uint8_t* to, size_t period, size_t len)
{
    const hn::Full128<uint8_t> d;
    auto first = hn::Undefined(d), second = hn::Undefined(d);
    size_t second_at = 16, step = period;
    if (period == 1) {
        // A byte is sure to come from one store, and so without delay.
        first = second = hn::Set(d, *from);
        step = 32;
    } else if (period < 16) {
        const auto bytes = hn::LoadU(d, from);
        first = hn::TableLookupBytes(bytes, hn::Load(d, periods.indices[period]));
        second = hn::TableLookupBytes(bytes, hn::Load(d, periods.indices[period] + 16));
        step = periods.steps[period];
    } else {
        second_at = period - 16;
        first = hn::LoadU(d, from);
        second = hn::LoadU(d, from + second_at);
    }
    const uint8_t* end = to + len;
    HWY_UNROLL(1)
    do {
        hn::StoreU(first, d, to);
        hn::StoreU(second, d, to + second_at);
        to += step;
    } while (to < end);
}
#endif

// NOLINTNEXTLINE(google-readability-namespace-comments)
} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
HWY_EXPORT(Crc32);
HWY_EXPORT(CopyAndCrc32);
HWY_EXPORT(Adler32);
HWY_EXPORT(CopyAndAdler32);
HWY_EXPORT(SubtractSaturating);

// On x64 `len` is at least 16, and more than 32 bits are returned if the CPU has no instruction for it.
extern "C" uint64_t highway_crc32(uint32_t state, const uint8_t* bytes, size_t len)
{
    return BUN_HWY_DISPATCH(Crc32)(state, bytes, len);
}

// The same, and `copy` has room for `len` bytes. They are written whatever is returned.
extern "C" uint64_t highway_copy_and_crc32(uint32_t state, const uint8_t* bytes, uint8_t* copy, size_t len)
{
    return BUN_HWY_DISPATCH(CopyAndCrc32)(state, bytes, copy, len);
}

// `len` is 16 to ADLER32_PIECE.
extern "C" uint32_t highway_adler32(uint32_t adler, const uint8_t* bytes, size_t len)
{
    return BUN_HWY_DISPATCH(Adler32)(adler, bytes, len);
}

// The same, and `copy` has room for `len` bytes.
extern "C" uint32_t highway_copy_and_adler32(uint32_t adler, const uint8_t* bytes, uint8_t* copy, size_t len)
{
    return BUN_HWY_DISPATCH(CopyAndAdler32)(adler, bytes, copy, len);
}

// `period` is 1 to 31. Reads up to 32 bytes, then writes up to `len + 31`. Not dispatched, so that LTO inlines it.
extern "C" HWY_ATTR void highway_repeat(const uint8_t* from, uint8_t* to, size_t period, size_t len)
{
    HWY_STATIC_DISPATCH(Repeat)(from, to, period, len);
}

// A group has 64 values.
extern "C" void highway_subtract_saturating(uint16_t* values, size_t groups, uint16_t amount)
{
    BUN_HWY_DISPATCH(SubtractSaturating)(values, groups, amount);
}
} // namespace bun
#endif
