// The CRC-32 of gzip and the Adler-32 of zlib, derived from libdeflate (LICENSE.md).

// The list in scripts/build/deps/highway.ts and more: the rest of SVE, and what has nothing for these over AVX3_DL.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | (HWY_AVX3_DL - 1))
#ifndef __OPTIMIZE__
#error "Unless hwy::ChosenTarget::GetIndex() is inlined, the linker may keep that of a file with other targets."
#endif

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_checksums.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <array>
#include <stddef.h>
#include <stdint.h>
#if HWY_ARCH_ARM_A64
#include <arm_acle.h>
#else
#include <cpuid.h>
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

// What a checksum reads: all of its bytes and no more. With `kCopies` they end up at `copy`.
template<bool kCopies>
struct Input {
    // With HWY_RESTRICT the stores become a memcpy(): a second pass, which may read other bytes than were summed.
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

    // Whether less than a vector can be loaded as fast as a whole one.
    static constexpr bool kLoadsParts = HWY_TARGET <= HWY_AVX3 && !kCopies;

    // Zeros behind `count` bytes. Unless `kLoadsParts`, there is a whole vector.
    template<class D>
    HWY_INLINE hn::Vec<D> LoadFirst(D d, size_t count) const
    {
        if constexpr (kLoadsParts) return hn::LoadN(d, bytes, count);
        return hn::IfThenElseZero(hn::FirstN(d, count), Load(d, 0));
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

#if HWY_TARGET == HWY_SSSE3

template<bool kCopies>
static HWY_INLINE uint64_t Crc32Of(uint32_t, Input<kCopies> input, size_t len)
{
    if constexpr (kCopies) hwy::CopyBytes(input.bytes, input.copy, len);
    return UINT64_MAX;
}

#else

// Modulo the polynomial of the CRC, with the highest power in the lowest bit.
static constexpr uint64_t PowerOfX(size_t exponent)
{
    uint32_t power = 0x80000000;
    while (exponent--)
        power = (power >> 1) ^ (power & 1 ? 0xEDB88320 : 0);
    return power;
}

#if HWY_ARCH_ARM_A64
template<class Input>
static HWY_INLINE uint32_t Crc32ByInstruction(uint32_t crc, Input input, size_t len)
{
    for (size_t words = len / 8; words != 0; words--, input.Advance(8))
        crc = __crc32d(crc, input.template Load<uint64_t>(0));
    if (len & 4) crc = __crc32w(crc, input.template Load<uint32_t>(0));
    if (len & 2) crc = __crc32h(crc, input.template Load<uint16_t>(len & 4));
    if (len & 1) crc = __crc32b(crc, input.template Load<uint8_t>(len & 6));
    return crc;
}
#endif

#if HWY_TARGET == HWY_NEON_WITHOUT_AES

// Multiplies every fourth bit at a time, so that no carry reaches a bit that is kept.
static HWY_INLINE uint64_t CarrylessMultiply(uint64_t a, uint64_t b)
{
    constexpr uint64_t mask = 0x1111111111111111;
    uint64_t product = 0;
    for (int i = 0; i < 4; i++) {
        uint64_t part = 0;
        for (int j = 0; j < 4; j++)
            part ^= (a & (mask << j)) * (b & (mask << ((i - j) & 3)));
        product |= part & (mask << i);
    }
    return product;
}

template<class Input>
static HWY_INLINE uint64_t Crc32Of(uint32_t crc, Input input, size_t len)
{
    const auto step = [&](uint32_t crc, size_t at) { return __crc32d(crc, input.template Load<uint64_t>(at)); };
    // Four independent parts hide the latency of the instruction.
    constexpr size_t part = 512;
    constexpr uint64_t one = PowerOfX(8 * part - 33), two = PowerOfX(16 * part - 33), three = PowerOfX(24 * part - 33);
    for (; len >= 4 * part; len -= 4 * part, input.Advance(4 * part)) {
        uint32_t second = 0, third = 0, fourth = 0;
        for (size_t i = 0; i < part; i += 8) {
            crc = step(crc, i);
            second = step(second, part + i);
            third = step(third, 2 * part + i);
            fourth = step(fourth, 3 * part + i);
        }
        crc = fourth ^ __crc32d(0, CarrylessMultiply(crc, three) ^ CarrylessMultiply(second, two) ^ CarrylessMultiply(third, one));
    }
    return Crc32ByInstruction(crc, input, len);
}

#else

using Block = hn::FixedTag<uint64_t, 2>;
using BlockBytes = hn::Repartition<uint8_t, Block>;
static constexpr size_t kBlock = 16;

// For the last 8-byte words of the input. The sum of the products is the input times x^32, in 96 bits.
alignas(64) static constexpr auto kFactors = [] {
    std::array<uint64_t, 64> factors {};
    for (size_t i = 0; i < factors.size(); i++)
        factors[factors.size() - 1 - i] = PowerOfX(64 * i + 31);
    return factors;
}();

// For the vector that starts `left` bytes before the end of the input.
template<class D>
static HWY_INLINE hn::Vec<D> FactorsBefore(D d, size_t left)
{
    const auto* end = reinterpret_cast<const uint8_t*>(kFactors.data() + kFactors.size());
    return hn::BitCast(d, hn::LoadU(hn::Repartition<uint8_t, D>(), end - left));
}

template<class V>
static HWY_INLINE V Products(V words, V factors)
{
    return hn::Xor(hn::CLMulLower(words, factors), hn::CLMulUpper(words, factors));
}

template<class V>
static HWY_INLINE V AddProducts(V sum, V words, V factors)
{
    return hn::Xor3(hn::CLMulLower(words, factors), hn::CLMulUpper(words, factors), sum);
}

// Merges `earlier` into `later`, which starts `kDistance` bytes after it, without changing the CRC.
template<size_t kDistance, class V>
static HWY_INLINE V Fold(V earlier, V later)
{
    constexpr uint64_t lower = PowerOfX(8 * kDistance + 31), upper = PowerOfX(8 * kDistance - 33);
    return AddProducts(later, earlier, hn::Dup128VecFromValues(hn::DFromV<V>(), lower, upper));
}

template<class D>
static HWY_INLINE hn::Vec<D> InFront(D d, uint64_t value)
{
    const hn::Full64<uint64_t> word;
    return hn::ZeroExtendResizeBitCast(d, word, hn::Set(word, value));
}

// Shuffles: the one at `count` moves the first `count` bytes to the end, the one at `kBlock + count` the others to the start.
alignas(64) static constexpr uint8_t kShifts[3 * kBlock] = {
    0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80
};

static HWY_INLINE hn::Vec<Block> Shift(hn::Vec<Block> v, size_t from)
{
    const BlockBytes d;
    return hn::BitCast(Block(), hn::TableLookupBytesOr0(hn::BitCast(d, v), hn::LoadU(d, kShifts + from)));
}

// Barrett reduction, once the `last` vector is added.
template<class D>
static HWY_INLINE uint32_t Reduce(D d, hn::Vec<D> sum, hn::Vec<D> last)
{
    const Block block;
    constexpr uint64_t polynomial = 0x1DB710641, quotientOfX95 = 0xB4E5B025F7011641;
    if constexpr (d.MaxBytes() == kBlock) {
        // The last factor is 1.
        sum = hn::Xor(sum, hn::Xor(hn::CLMulLower(last, FactorsBefore(d, kBlock)), hn::ShiftRightLanes<1>(d, last)));
    } else {
        sum = AddProducts(sum, last, FactorsBefore(d, d.MaxBytes()));
    }
    const auto v = CombineBlocks(d, sum, [](auto a, auto b) HWY_ATTR { return hn::Xor(a, b); });
    const auto multiple = hn::CLMulLower(hn::CLMulLower(v, hn::Set(block, quotientOfX95)), hn::Set(block, polynomial));
    return static_cast<uint32_t>(hn::ExtractLane(hn::Xor(v, multiple), 1));
}

// `chains` stand for everything up to `kStride` bytes behind the start of `input`. At least as much is left afterwards.
template<size_t kChains, class D, bool kCopies>
static HWY_INLINE void FoldStrides(D d, hn::Vec<D>* chains, Input<kCopies>& input, size_t& len)
{
    constexpr size_t N = d.MaxBytes(), kStride = kChains * N;
#if HWY_ARCH_ARM_A64
    // The instruction has a unit of its own, which works on these bytes meanwhile. Newer CPUs multiply faster.
    constexpr size_t kSkipped = kHasDotProduct ? 64 : 128;
    static_assert(2 * kStride + kSkipped <= sizeof(kFactors));
    for (; len >= 2 * kStride + kSkipped; len -= kStride + kSkipped) {
        input.Advance(kStride);
        const uint32_t skipped = Crc32ByInstruction(0, input, kSkipped);
        input.Advance(kSkipped);
        for (size_t i = 0; i < kChains; i++)
            chains[i] = Fold<kStride + kSkipped>(chains[i], input.Load(d, i * N));
        chains[0] = hn::Xor(chains[0], InFront(d, skipped));
    }
#else
    // What does not fit the registers would wait in line with the stores of a copy.
    if constexpr (N == kBlock && HWY_TARGET > HWY_AVX3_DL && !kCopies) {
        // A vector need not be multiplied if it is added to those this far on. https://arxiv.org/abs/2412.16398
        static constexpr size_t kDistances[] = { 15, 17, 20, 23, 26, 28, 46, 50, 53 };
        static_assert([] {
            uint64_t sum = PowerOfX(53);
            for (const size_t distance : kDistances)
                sum ^= PowerOfX(53 - distance);
            return sum == 0;
        }());
        // More, and the additions take longer than the multiplications on a CPU that starts one in every cycle.
        constexpr size_t kSkipped = HWY_TARGET == HWY_AVX3 ? 18 : 12, kFolded = 54;
        static_assert(kFolded >= 53 && kFolded % kChains == 0);
        for (; len >= kStride + (kSkipped + kFolded) * N; len -= (kSkipped + kFolded) * N) {
            hn::Vec<D> skipped[kSkipped];
            HWY_UNROLL(72)
            for (size_t i = 0; i < kSkipped + kFolded; i++) {
                auto v = input.Load(d, kStride + i * N);
                for (const size_t distance : kDistances) {
                    if (i - distance < kSkipped) v = hn::Xor(v, skipped[i - distance]);
                }
                if (i < kSkipped) {
                    skipped[i] = v;
                } else {
                    auto& chain = chains[(i - kSkipped) % kChains];
                    chain = i < kSkipped + kChains ? Fold<kStride + kSkipped * N>(chain, v) : Fold<kStride>(chain, v);
                }
            }
            input.Advance((kSkipped + kFolded) * N);
        }
    }
    static_assert(2 * kStride <= sizeof(kFactors));
    for (; len >= 2 * kStride; len -= kStride) {
        input.Advance(kStride);
        for (size_t i = 0; i < kChains; i++)
            chains[i] = Fold<kStride>(chains[i], input.Load(d, i * N));
    }
#endif
}

// `len` is at least a vector.
template<size_t kChains, class D, class Input>
static HWY_INLINE uint32_t Crc32With(D d, uint32_t crc, Input input, size_t len)
{
    const hn::Repartition<uint8_t, D> d8;
    constexpr size_t N = d.MaxBytes(), kStride = kChains * N;
    HWY_DASSERT(len >= N);

    auto sum = hn::Zero(d), next = InFront(d, crc);
    if (const size_t part = len % N) {
        // Zeros in front of the input do not change its CRC.
        auto padded = hn::Xor(input.Load(d, 0), next);
        if constexpr (N == kBlock) {
            padded = Shift(padded, part);
            next = Shift(next, kBlock + part);
        } else {
            padded = hn::BitCast(d, hn::SlideUpLanes(d8, hn::BitCast(d8, padded), N - part));
            next = InFront(d, uint64_t { crc } >> HWY_MIN(8 * part, 32));
        }
        input.Advance(part);
        len -= part;
        if (len >= 2 * kStride) {
            next = Fold<N>(padded, next);
        } else {
            sum = Products(padded, FactorsBefore(d, len + N));
        }
    }
    next = hn::Xor(next, input.Load(d, 0));

    if (len >= 2 * kStride) {
        hn::Vec<D> chains[kChains] = { next };
        for (size_t i = 1; i < kChains; i++)
            chains[i] = input.Load(d, i * N);
        FoldStrides<kChains>(d, chains, input, len);
        for (size_t i = 0; i < kChains - 1; i++)
            sum = AddProducts(sum, chains[i], FactorsBefore(d, len - i * N));
        next = chains[kChains - 1];
        input.Advance(kStride - N);
        len -= kStride - N;
    }
    if (len != N) {
        sum = AddProducts(sum, next, FactorsBefore(d, len));
        HWY_UNROLL(1)
        for (size_t at = N; at != len - N; at += N) {
            auto products = Products(input.Load(d, at), FactorsBefore(d, len - at));
            // Or the compiler adds the two to `sum` one after the other, and the next turn waits twice as long.
#if HWY_ARCH_X86 && HWY_TARGET > HWY_AVX3
            asm("" : "+x"(products.raw));
#elif HWY_ARCH_ARM_A64 && !defined(__ARM_FEATURE_SHA3)
            asm("" : "+w"(products.raw));
#endif
            sum = hn::Xor(sum, products);
        }
        next = input.Load(d, len - N);
    }
    return Reduce(d, sum, next);
}

#if HWY_ARCH_ARM_A64

template<class Input>
static HWY_INLINE uint64_t Crc32Of(uint32_t crc, Input input, size_t len)
{
    const Block d;
    if constexpr (kHasDotProduct) {
        if (len >= 128) return Crc32With<8>(d, crc, input, len);
    } else if (len >= 384) {
        // What the loop leaves is faster by the instruction.
        const size_t folded = len - (len - 128) % 256;
        crc = Crc32With<8>(d, crc, input, folded);
        input.Advance(folded);
        len -= folded;
    }
    return Crc32ByInstruction(crc, input, len);
}

#else

// For each length from 4 on, the shuffle that turns four overlapping words into those bytes at the end of a block.
alignas(64) static constexpr auto kGathers = [] {
    std::array<std::array<uint8_t, kBlock>, kBlock> gathers {};
    for (size_t len = 4; len < kBlock; len++) {
        gathers[len].fill(0x80);
        for (size_t i = 0; i < kBlock; i++)
            gathers[len][kBlock - len + HWY_MIN(i / 4 * 4, len - 4) + i % 4] = i;
    }
    return gathers;
}();

// `len` is 4 to 15.
template<class Input>
static HWY_INLINE uint32_t ShortCrc32(uint32_t crc, Input input, size_t len)
{
    const Block d;
    const BlockBytes d8;
    if constexpr (Input::kLoadsParts) {
        const auto all = hn::Xor(hn::BitCast(d, input.LoadFirst(d8, len)), InFront(d, crc));
        return Reduce(d, hn::Zero(d), Shift(all, len));
    }
    const auto word = [&](size_t at) HWY_ATTR { return input.template Load<uint32_t>(HWY_MIN(at, len - 4)); };
    const uint32_t first = word(0), second = word(4), third = word(8), fourth = word(12);
    const auto words = hn::Dup128VecFromValues(hn::Repartition<uint32_t, Block>(), first, second, third, fourth);
    const auto padded = hn::TableLookupBytesOr0(hn::BitCast(d8, words), hn::Load(d8, kGathers[len].data()));
    return Reduce(d, hn::Zero(d), hn::Xor(hn::BitCast(d, padded), Shift(InFront(d, crc), len)));
}

template<class Input, class D = hn::CappedTag<uint64_t, HWY_TARGET <= HWY_AVX3_DL ? 8 : 2>>
static HWY_INLINE uint64_t Crc32Of(uint32_t crc, Input input, size_t len, D wide = {})
{
    if (len < kBlock) return ShortCrc32(crc, input, len);
    if constexpr (wide.MaxBytes() > kBlock) {
        if (len >= 64) return Crc32With<4>(wide, crc, input, len);
    }
    return Crc32With<6>(Block(), crc, input, len);
}

#if HWY_TARGET == HWY_AVX2
// Highway has no target for Zen 3 and Alder Lake. It multiplies half by half, which the compiler makes one instruction.
__attribute__((target(HWY_TARGET_STR ",vpclmulqdq"))) static uint64_t Crc32Vpclmulqdq(uint32_t crc, const uint8_t* bytes, size_t len)
{
    return Crc32Of(crc, Input<false> { bytes, nullptr }, len, hn::ScalableTag<uint64_t>());
}

__attribute__((target(HWY_TARGET_STR ",vpclmulqdq"))) static uint64_t CopyAndCrc32Vpclmulqdq(uint32_t crc, const uint8_t* bytes, uint8_t* copy, size_t len)
{
    return Crc32Of(crc, Input<true> { bytes, copy }, len, hn::ScalableTag<uint64_t>());
}
#endif

#endif
#endif
#endif

static uint64_t Crc32(uint32_t crc, const uint8_t* bytes, size_t len)
{
    return Crc32Of(crc, Input<false> { bytes, nullptr }, len);
}

static uint64_t CopyAndCrc32(uint32_t crc, const uint8_t* bytes, uint8_t* copy, size_t len)
{
    return Crc32Of(crc, Input<true> { bytes, copy }, len);
}

template<class D, class V>
static HWY_INLINE V AddBytes(D d, V sums, hn::Vec<D> bytes)
{
    const hn::Repartition<uint32_t, D> d32;
    if constexpr (HWY_ARCH_X86 && kHasDotProduct) {
        const hn::Repartition<int32_t, D> di32;
        return hn::BitCast(d32, hn::SumOfMulQuadAccumulate(di32, bytes, hn::Set(hn::RebindToSigned<D>(), 1), hn::BitCast(di32, sums)));
    } else if constexpr (HWY_ARCH_X86) {
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

// A byte counts in `b` once for every byte up to the end of its group, and `kGroup` times for every group behind it.
template<class D, class Input>
static HWY_INLINE uint32_t Adler32InGroups(D d, uint32_t adler, Input input, size_t len)
{
    const hn::Repartition<uint32_t, D> d32;
    constexpr size_t N = hn::MaxLanes(d);
    constexpr size_t kGroup = (HWY_ARCH_X86 ? 128 : 64) * (kHasDotProduct ? 2 : 1);
    constexpr size_t kVectors = kGroup / N;
    // Taken off the weights to get them into signed bytes.
    constexpr uint32_t kBias = HWY_ARCH_X86 ? kGroup / 2 + 1 : 0;
    // ADLER32_PIECE in src/highway/checksums.rs
    constexpr uint64_t kMostGroups = (HWY_ARCH_X86 ? 65536 : 16384) / kGroup;
    static_assert(255 * kGroup * kMostGroups * kMostGroups / 2 <= UINT32_MAX);
    static_assert(255 * kGroup * (kGroup + 1) / 2 * kMostGroups + UINT16_MAX <= UINT32_MAX);
    HWY_DASSERT((input.kLoadsParts || len >= N) && len <= kMostGroups * kGroup);
    const auto weights = [&](size_t left) HWY_ATTR {
        return hn::Sub(hn::Set(d, static_cast<uint8_t>(left - kBias)), hn::Iota(d, 0));
    };
    const auto total = [&](auto v) HWY_ATTR {
        return hn::ReduceSum(hn::Full128<uint32_t>(), CombineBlocks(d32, v, [](auto a, auto b) HWY_ATTR { return hn::Add(a, b); }));
    };

    constexpr uint32_t kModulus = 65521;
    const uint32_t a = adler & 0xFFFF;
    uint64_t b = (adler >> 16) + uint64_t { a } * len;

    // Whether the upper half fits 32 bits before it is reduced.
    constexpr uint64_t kShort = 5552;
    static_assert(255 * kShort * (kShort + 1) / 2 + (kShort + 1) * UINT16_MAX <= UINT32_MAX);
    const bool is_short = len <= kShort;
    // The first group is as short as it takes for the others to be whole.
    size_t left = len % kGroup;
    len -= left;
    auto sum = hn::Zero(d32), weighted = sum;
    if (const size_t odd = left % N) {
        const auto x = input.LoadFirst(d, odd);
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
                hn::Vec<D> x[kVectors];
                const hn::Repartition<uint64_t, D> d64;
                auto group = hn::Zero(d64);
                for (size_t i = 0; i < kVectors; i++) {
                    x[i] = input.Load(d, i * N);
                    group = hn::Add(group, hn::SumsOf8(x[i]));
                }
                sums_before = hn::Add(sums_before, sum);
                sum = hn::Add(sum, hn::BitCast(d32, group));
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
        if (is_short) {
            weighted = hn::Add(weighted, hn::ShiftLeft<hwy::FloorLog2(kGroup)>(sums_before));
        } else {
            b = (b + uint64_t { kGroup } * total(sums_before)) % kModulus;
        }
    }

    const uint32_t byte_sum = total(sum);
    // What `weighted` adds up to may be negative, so this is meant to wrap.
    const uint32_t high = static_cast<uint32_t>(b) + total(weighted) + kBias * byte_sum;
    return (a + byte_sum) % kModulus | high % kModulus << 16;
}

template<bool kCopies>
static HWY_INLINE uint32_t Adler32Of(uint32_t adler, Input<kCopies> input, size_t len)
{
    // The stores hold up either size, and half as many of 32 bytes cross a cache line.
    const hn::CappedTag<uint8_t, kCopies && kHasDotProduct ? 32 : 64> d;
    if constexpr (hn::MaxLanes(d) > 16 && !input.kLoadsParts) {
        if (len < hn::MaxLanes(d)) return Adler32InGroups(hn::Full128<uint8_t>(), adler, input, len);
    }
    return Adler32InGroups(d, adler, input, len);
}

static uint32_t Adler32(uint32_t adler, const uint8_t* bytes, size_t len)
{
    return Adler32Of(adler, Input<false> { bytes, nullptr }, len);
}

static uint32_t CopyAndAdler32(uint32_t adler, const uint8_t* bytes, uint8_t* copy, size_t len)
{
    return Adler32Of(adler, Input<true> { bytes, copy }, len);
}

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

#if (HWY_TARGETS & HWY_AVX2) && (HWY_TARGETS & HWY_AVX3)
template<typename Function>
static Function OrWider(Function chosen, Function avx2, Function avx3, Function wider)
{
    unsigned eax, ebx, ecx, edx;
    const bool hasVpclmulqdq = __get_cpuid_count(7, 0, &eax, &ebx, &ecx, &edx) && (ecx & bit_VPCLMULQDQ);
    return hasVpclmulqdq && (chosen == avx2 || chosen == avx3) ? wider : chosen;
}
#define DISPATCH_CRC32(FUNC) BUN_HWY_DISPATCH_TO(OrWider(HWY_DYNAMIC_POINTER(FUNC), &N_AVX2::FUNC, &N_AVX3::FUNC, &N_AVX2::FUNC##Vpclmulqdq))
#else
#define DISPATCH_CRC32 BUN_HWY_DISPATCH
#endif

// On x64 `len` is at least 4, and more than 32 bits are returned if the CPU has no instruction for it.
extern "C" uint64_t highway_crc32(uint32_t state, const uint8_t* bytes, size_t len)
{
    return DISPATCH_CRC32(Crc32)(state, bytes, len);
}

// The same, and `copy` has room for `len` bytes. They are written whatever is returned.
extern "C" uint64_t highway_copy_and_crc32(uint32_t state, const uint8_t* bytes, uint8_t* copy, size_t len)
{
    return DISPATCH_CRC32(CopyAndCrc32)(state, bytes, copy, len);
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
} // namespace bun
#endif
