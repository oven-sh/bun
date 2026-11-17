// The CRC-32 of gzip and the Adler-32 of zlib, derived from libdeflate (LICENSE.md).

// One target for each width of carry-less multiplication, which on Arm only beats the CRC instructions in wide cores. The best targets also have dot products.
#undef HWY_DISABLED_TARGETS
#ifdef __APPLE__
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | HWY_NEON_BF16 | HWY_AVX3 | (HWY_AVX3_DL - 1))
#else
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | HWY_NEON | HWY_AVX3 | (HWY_AVX3_DL - 1))
#endif
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
#include <zlib.h>
#endif

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

template<class D>
static HWY_INLINE hn::Vec<D> Load(D d, const uint8_t* HWY_RESTRICT bytes)
{
    return hn::BitCast(d, hn::LoadU(hn::Repartition<uint8_t, D>(), bytes));
}

#if HWY_TARGET == HWY_SSSE3

static uint32_t Crc32(uint32_t crc, const uint8_t* HWY_RESTRICT bytes, size_t len)
{
    return ~crc32_z(~crc, bytes, len);
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

static uint32_t Crc32(uint32_t crc, const uint8_t* HWY_RESTRICT bytes, size_t len)
{
    const auto step = [](uint32_t crc, const uint8_t* bytes) {
        uint64_t word;
        hwy::CopyBytes<sizeof(word)>(bytes, &word);
        return __crc32d(crc, word);
    };
    // Four independent parts hide the latency of the instruction.
    constexpr size_t part = 512;
    constexpr uint64_t one = PowerOfX(8 * part - 33), two = PowerOfX(16 * part - 33), three = PowerOfX(24 * part - 33);
    for (; len >= 4 * part; len -= 4 * part, bytes += 4 * part) {
        uint32_t second = 0, third = 0, fourth = 0;
        for (size_t i = 0; i < part; i += 8) {
            crc = step(crc, bytes + i);
            second = step(second, bytes + part + i);
            third = step(third, bytes + 2 * part + i);
            fourth = step(fourth, bytes + 3 * part + i);
        }
        crc = fourth ^ __crc32d(0, CarrylessMultiply(crc, three) ^ CarrylessMultiply(second, two) ^ CarrylessMultiply(third, one));
    }
    for (; len >= 8; len -= 8, bytes += 8)
        crc = step(crc, bytes);
    for (; len; len--)
        crc = __crc32b(crc, *bytes++);
    return crc;
}

#else

using Block = hn::FixedTag<uint64_t, 2>;
using BlockBytes = hn::Repartition<uint8_t, Block>;
static constexpr size_t kBlock = 16;
// As many as keep the multipliers busy.
static constexpr size_t kChains = HWY_ARCH_ARM ? 16 : 8;

struct Input {
    const uint8_t* next;
    size_t left;

    HWY_INLINE void skip(size_t count)
    {
        next += count;
        left -= count;
    }
};

// Merges `earlier` into `later`, which starts `kDistance` bytes after it, without changing the CRC.
template<size_t kDistance, class V>
static HWY_INLINE V Fold(V earlier, V later)
{
    constexpr uint64_t lower = PowerOfX(8 * kDistance + 31), upper = PowerOfX(8 * kDistance - 33);
    const V factors = hn::Dup128VecFromValues(hn::DFromV<V>(), lower, upper);
    return hn::Xor3(hn::CLMulLower(earlier, factors), hn::CLMulUpper(earlier, factors), later);
}

// Folds the input, at least `kCount` vectors, into `kCount` chains until less than that is left.
template<size_t kCount, class D>
static HWY_INLINE void FoldVectors(D d, hn::Vec<D>* chains, hn::Vec<Block> crc, Input& input)
{
    constexpr size_t size = d.MaxBytes(), stride = kCount * size;
    if (kCount < kChains && input.left >= 2 * stride) {
        if constexpr (kCount < kChains)
            FoldVectors<2 * kCount>(d, chains, crc, input);
        HWY_UNROLL(16)
        for (size_t i = 0; i < kCount; i++)
            chains[i] = Fold<stride>(chains[i], chains[kCount + i]);
    } else {
        HWY_UNROLL(16)
        for (size_t i = 0; i < kCount; i++)
            chains[i] = Load(d, input.next + i * size);
        chains[0] = hn::Xor(chains[0], hn::ZeroExtendResizeBitCast(d, Block(), crc));
        input.skip(stride);
    }
    while (input.left >= stride) {
        HWY_UNROLL(16)
        for (size_t i = 0; i < kCount; i++)
            chains[i] = Fold<stride>(chains[i], Load(d, input.next + i * size));
        input.skip(stride);
        if (kCount < kChains)
            break;
    }
}

// Folds `v` and the input, less than a vector, into a block until less than that is left.
template<class V>
static HWY_INLINE hn::Vec<Block> FoldHalves(V v, Input& input)
{
    constexpr hn::DFromV<V> d;
    if constexpr (d.MaxBytes() == kBlock)
        return v;
    else {
        constexpr hn::Half<decltype(d)> half;
        constexpr size_t size = half.MaxBytes();
        auto folded = Fold<size>(hn::LowerHalf(v), hn::UpperHalf(half, v));
        if (input.left >= size) {
            folded = Fold<size>(folded, Load(half, input.next));
            input.skip(size);
        }
        return FoldHalves(folded, input);
    }
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

// Barrett reduction
static HWY_INLINE uint32_t Reduce(hn::Vec<Block> v)
{
    const Block d;
    constexpr uint64_t polynomial = 0x1DB710641, quotientOfX95 = 0xB4E5B025F7011641, x95 = PowerOfX(95);
    v = hn::Xor(hn::CLMulLower(v, hn::Set(d, x95)), hn::ShiftRightLanes<1>(d, v));
    const auto multiple = hn::CLMulLower(hn::CLMulLower(v, hn::Set(d, quotientOfX95)), hn::Set(d, polynomial));
    return static_cast<uint32_t>(hn::ExtractLane(hn::Xor(v, multiple), 1));
}

template<class D>
static HWY_INLINE uint32_t Crc32With(D wide, uint32_t crc, const uint8_t* HWY_RESTRICT bytes, size_t len)
{
    const Block block;
    const auto initial = hn::Dup128VecFromValues(block, uint64_t { crc }, 0);
    if (len < kBlock) {
        const auto all = hn::Xor(hn::BitCast(block, hn::LoadN(BlockBytes(), bytes, len)), initial);
        return Reduce(Shift(all, len)) ^ (len < sizeof(crc) ? crc >> (8 * len) : 0);
    }

    Input input { bytes, len };
    hn::Vec<Block> sum;
    if (len >= wide.MaxBytes()) {
        hn::Vec<D> chains[kChains];
        FoldVectors<1>(wide, chains, initial, input);
        sum = FoldHalves(chains[0], input);
    } else {
        sum = hn::Xor(Load(block, bytes), initial);
        for (input.skip(kBlock); input.left >= kBlock; input.skip(kBlock))
            sum = Fold<kBlock>(sum, Load(block, input.next));
    }

    if (const size_t rest = input.left) {
        const hn::Repartition<int8_t, Block> d;
        const auto last = hn::IfNegativeThenElse(Load(d, kShifts + kBlock + rest), Load(d, bytes + len - kBlock),
            hn::BitCast(d, Shift(sum, kBlock + rest)));
        sum = Fold<kBlock>(Shift(sum, rest), hn::BitCast(block, last));
    }
    return Reduce(sum);
}

#if HWY_TARGET == HWY_AVX2

// Highway has no target for Zen 3 and Alder Lake. It multiplies half by half, which the compiler makes one instruction.
__attribute__((target(HWY_TARGET_STR ",vpclmulqdq"))) static uint32_t Crc32Vpclmulqdq(uint32_t crc, const uint8_t* HWY_RESTRICT bytes, size_t len)
{
    return Crc32With(hn::ScalableTag<uint64_t>(), crc, bytes, len);
}

static uint32_t Crc32(uint32_t crc, const uint8_t* HWY_RESTRICT bytes, size_t len)
{
    static const bool hasVpclmulqdq = [] {
        unsigned eax, ebx, ecx, edx;
        return __get_cpuid_count(7, 0, &eax, &ebx, &ecx, &edx) && (ecx & bit_VPCLMULQDQ);
    }();
    return hasVpclmulqdq ? Crc32Vpclmulqdq(crc, bytes, len) : Crc32With(Block(), crc, bytes, len);
}

#else

static uint32_t Crc32(uint32_t crc, const uint8_t* HWY_RESTRICT bytes, size_t len)
{
    return Crc32With(hn::ScalableTag<uint64_t>(), crc, bytes, len);
}

#endif
#endif
#endif

using Bytes = hn::ScalableTag<uint8_t>;
// The signs that dot products take.
using Weights = hn::Repartition<hwy::If<HWY_ARCH_ARM, uint8_t, int8_t>, Bytes>;
using Sums = hn::Repartition<hwy::If<HWY_ARCH_ARM, uint32_t, int32_t>, Bytes>;
static constexpr size_t kVector = Bytes().MaxBytes(), kColumns = 4, kRow = kColumns * kVector;
static constexpr uint32_t kModulus = 65521;
static constexpr size_t kChunk = 5552 / kRow * kRow;
static_assert(255 * kChunk * (kChunk + 1) / 2 + (kChunk + 1) * (kModulus - 1) <= UINT32_MAX);

// How often each byte of a row counts in the upper half of the checksum, less what makes that fit.
static constexpr uint32_t kBias = HWY_ARCH_ARM ? 0 : kRow / 2 + 1;
alignas(64) static constexpr auto kWeights = [] {
    std::array<hn::TFromD<Weights>, kRow + kVector> weights {};
    for (size_t i = 0; i < kRow; i++)
        weights[i] = static_cast<hn::TFromD<Weights>>(kRow - i - kBias);
    return weights;
}();

// For the vector that starts `left` bytes before the end of a row.
static HWY_INLINE hn::Vec<Weights> WeightsBefore(size_t left)
{
    return hn::LoadU(Weights(), kWeights.data() + kRow - left);
}

// Lanes may wrap around, because what they add up to in the end fits.
struct Totals {
    hn::Vec<Sums> plain, weighted;
    // The sum of what `plain` was before each row.
    hn::Vec<Sums> earlier;
};

#if HWY_ARCH_X86 && HWY_TARGET > HWY_AVX3_DL

using Pairs = hn::Repartition<int16_t, Bytes>;
static_assert(255 * kRow <= INT16_MAX, "The sum of two products does not saturate.");

static HWY_INLINE hn::Vec<Pairs> Products(hn::Vec<Bytes> bytes, size_t left)
{
    return hn::SatWidenMulPairwiseAdd(Pairs(), bytes, WeightsBefore(left));
}

static HWY_INLINE void AddProducts(Totals& totals, hn::Vec<Pairs> products)
{
    totals.weighted = hn::Add(totals.weighted, hn::WidenMulPairwiseAdd(Sums(), products, hn::Set(Pairs(), 1)));
}

static HWY_INLINE void AddVector(Totals& totals, hn::Vec<Bytes> bytes, size_t left)
{
    totals.plain = hn::Add(totals.plain, hn::BitCast(Sums(), hn::SumsOf8(bytes)));
    AddProducts(totals, Products(bytes, left));
}

static HWY_INLINE void AddRows(Totals& totals, const uint8_t* HWY_RESTRICT bytes, const uint8_t* end)
{
    for (; bytes != end; bytes += kRow) {
        const auto a = Load(Bytes(), bytes), b = Load(Bytes(), bytes + kVector);
        const auto c = Load(Bytes(), bytes + 2 * kVector), d = Load(Bytes(), bytes + 3 * kVector);
        const auto sum = hn::Add(hn::Add(hn::SumsOf8(a), hn::SumsOf8(b)), hn::Add(hn::SumsOf8(c), hn::SumsOf8(d)));
        totals.earlier = hn::Add(totals.earlier, totals.plain);
        totals.plain = hn::Add(totals.plain, hn::BitCast(Sums(), sum));
        // Their weights have opposite signs, so these sums fit too.
        AddProducts(totals, hn::Add(Products(a, 4 * kVector), Products(d, kVector)));
        AddProducts(totals, hn::Add(Products(b, 3 * kVector), Products(c, 2 * kVector)));
    }
}

#else

static HWY_INLINE void AddVector(Totals& totals, hn::Vec<Bytes> bytes, size_t left)
{
    totals.plain = hn::SumOfMulQuadAccumulate(Sums(), bytes, hn::Set(Weights(), 1), totals.plain);
    totals.weighted = hn::SumOfMulQuadAccumulate(Sums(), bytes, WeightsBefore(left), totals.weighted);
}

#if HWY_ARCH_X86 || HWY_TARGET == HWY_NEON_BF16 || defined(__ARM_FEATURE_DOTPROD)

static HWY_INLINE void AddRows(Totals& totals, const uint8_t* HWY_RESTRICT bytes, const uint8_t* end)
{
    const auto zero = hn::Zero(Sums());
    // Independent sums hide the latency of the instruction.
    hn::Vec<Sums> weighted[kColumns] = { totals.weighted, zero, zero, zero };
    for (; bytes != end; bytes += kRow) {
        auto sum = zero;
        HWY_UNROLL(4)
        for (size_t i = 0; i < kColumns; i++) {
            const auto v = Load(Bytes(), bytes + i * kVector);
            sum = hn::SumOfMulQuadAccumulate(Sums(), v, hn::Set(Weights(), 1), sum);
            weighted[i] = hn::SumOfMulQuadAccumulate(Sums(), v, WeightsBefore(kRow - i * kVector), weighted[i]);
        }
        totals.earlier = hn::Add(totals.earlier, totals.plain);
        totals.plain = hn::Add(totals.plain, sum);
    }
    totals.weighted = hn::Add(hn::Add(weighted[0], weighted[1]), hn::Add(weighted[2], weighted[3]));
}

#else

// Without dot products, it is faster to add the rows up and to multiply once.
static HWY_INLINE void AddRows(Totals& totals, const uint8_t* HWY_RESTRICT bytes, const uint8_t* end)
{
    const hn::Repartition<uint16_t, Bytes> wide;
    static_assert(255 * (kChunk / kRow) <= UINT16_MAX);
    const auto zero = hn::Zero(wide);
    hn::Vec<decltype(wide)> lower[kColumns] = { zero, zero, zero, zero }, upper[kColumns] = { zero, zero, zero, zero };
    for (; bytes != end; bytes += kRow) {
        auto pairs = zero;
        HWY_UNROLL(4)
        for (size_t i = 0; i < kColumns; i++) {
            const auto v = Load(Bytes(), bytes + i * kVector);
            lower[i] = hn::Add(lower[i], hn::PromoteLowerTo(wide, v));
            upper[i] = hn::Add(upper[i], hn::PromoteUpperTo(wide, v));
            pairs = hn::Add(pairs, hn::SumsOf2(v));
        }
        totals.earlier = hn::Add(totals.earlier, totals.plain);
        totals.plain = hn::Add(totals.plain, hn::SumsOf2(pairs));
    }
    HWY_UNROLL(4)
    for (size_t i = 0; i < kColumns; i++) {
        const auto weights = WeightsBefore(kRow - i * kVector);
        totals.weighted = hn::Add(totals.weighted,
            hn::Add(hn::WidenMulPairwiseAdd(Sums(), lower[i], hn::PromoteLowerTo(wide, weights)),
                hn::WidenMulPairwiseAdd(Sums(), upper[i], hn::PromoteUpperTo(wide, weights))));
    }
}

#endif
#endif

static uint32_t Adler32(uint32_t adler, const uint8_t* HWY_RESTRICT bytes, size_t len)
{
    const Bytes d;
    uint32_t low = adler & 0xFFFF, high = adler >> 16;
    while (len) {
        const size_t chunk = HWY_MIN(len, kChunk);
        const uint8_t* const end = bytes + chunk;
        len -= chunk;
        Totals totals { hn::Zero(Sums()), hn::Zero(Sums()), hn::Zero(Sums()) };
        // What is not a whole vector or row comes first, so that a load can reach past it.
        if (size_t left = chunk % kRow) {
            const size_t part = left % kVector;
            AddVector(totals, chunk < kVector ? hn::LoadN(d, bytes, part) : hn::IfThenElseZero(hn::FirstN(d, part), Load(d, bytes)), left);
            HWY_UNROLL(1)
            for (bytes += part, left -= part; left; bytes += kVector, left -= kVector)
                AddVector(totals, Load(d, bytes), left);
        }
        if (bytes != end)
            AddRows(totals, bytes, end);
        bytes = end;
        const uint32_t plain = hn::ReduceSum(Sums(), totals.plain);
        const uint32_t weighted = hn::ReduceSum(Sums(), hn::Add(totals.weighted, hn::ShiftLeft<hwy::FloorLog2(kRow)>(totals.earlier)));
        high = (high + static_cast<uint32_t>(chunk) * low + weighted + kBias * plain) % kModulus;
        low = (low + plain) % kModulus;
    }
    return high << 16 | low;
}

// NOLINTNEXTLINE(google-readability-namespace-comments)
} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
HWY_EXPORT(Crc32);
HWY_EXPORT(Adler32);

static HWY_INLINE uint32_t UpdateAligned(auto update, uint32_t state, const uint8_t* bytes, size_t len)
{
    // In a long input it is worth a call to have no load cross a cache line.
    if (HWY_UNLIKELY(len > 65536)) {
        const size_t head = -reinterpret_cast<uintptr_t>(bytes) % 64;
        return update(update(state, bytes, head), bytes + head, len - head);
    }
    return update(state, bytes, len);
}

extern "C" uint32_t highway_crc32(uint32_t crc, const uint8_t* bytes, size_t len)
{
    return ~UpdateAligned(BUN_HWY_DISPATCH(Crc32), ~crc, bytes, len);
}

extern "C" uint32_t highway_adler32(const uint8_t* bytes, size_t len)
{
    return UpdateAligned(BUN_HWY_DISPATCH(Adler32), 1, bytes, len);
}
} // namespace bun
#endif
