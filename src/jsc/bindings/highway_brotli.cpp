// The data-parallel parts of the encoder in src/brotli, in the arithmetic of google/brotli (LICENSE.md). All targets give the same results.

// Besides the list in scripts/build/deps/highway.ts: SVE, all above AVX2, and what would compile to the same as the baseline.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | HWY_NEON | HWY_NEON_BF16 | HWY_SSE4 | (HWY_AVX2 - 1))
#ifndef __OPTIMIZE__
#error "Unless hwy::ChosenTarget::GetIndex() is inlined, the linker may keep that of a file with other targets."
#endif

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_brotli.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <array>
#include <iterator>
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <utility>

// The output of the encoder depends on each rounding.
#pragma STDC FP_CONTRACT OFF

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

using DF64 = hn::CappedTag<double, 4>;
using VF64 = hn::Vec<DF64>;
using MF64 = hn::Mask<DF64>;
static constexpr size_t kLanes = hn::MaxLanes(DF64());

static constexpr size_t kGroup = 8;
static constexpr size_t kGroupParts = kGroup / kLanes;

static HWY_INLINE uint32_t BitsOf(const MF64 (&masks)[kGroupParts])
{
    const DF64 d;
    const hn::Repartition<uint32_t, DF64> d32;
    const auto narrowed = [&](size_t part) HWY_ATTR {
        return hn::ConcatEven(d32, hn::BitCast(d32, hn::VecFromMask(d, masks[part + 1])), hn::BitCast(d32, hn::VecFromMask(d, masks[part])));
    };
#if HWY_MAX_BYTES >= 32
    return hn::BitsFromMask(d32, hn::MaskFromVec(narrowed(0)));
#else
    const hn::Repartition<uint16_t, DF64> d16;
    return hn::BitsFromMask(d16, hn::MaskFromVec(hn::ConcatEven(d16, hn::BitCast(d16, narrowed(2)), hn::BitCast(d16, narrowed(0)))));
#endif
}

static void BrotliFindSwitches(const uint16_t* HWY_RESTRICT symbols, size_t length, const double* HWY_RESTRICT symbol_costs,
    size_t alphabet_size, size_t groups, double switch_cost, double* HWY_RESTRICT costs, uint8_t* HWY_RESTRICT switches,
    uint8_t* HWY_RESTRICT cheapest)
{
    constexpr size_t kPrologue = 2000;
    const DF64 d;
    const VF64 too_much = hn::Set(d, 1e99);
    const size_t low_groups = HWY_MIN(groups, size_t { 8 });
    VF64 min_cost = hn::Zero(d);
    VF64 max_cost = too_much;
    uint8_t unused;
    uint8_t* previous_cheapest = &unused;
    for (size_t position = 0; position < length; position++) {
        const double* added = symbol_costs + HWY_MIN(size_t { symbols[position] }, alphabet_size - 1) * groups * kGroup;
        VF64 smallest[2] = { too_much, too_much };
        // Finishes the previous symbol, which had to wait for `min_cost`.
        const auto step = [&](size_t group, uint64_t& zeros) HWY_ATTR {
            MF64 is_high[kGroupParts], is_zero[kGroupParts];
            for (size_t part = 0; part < kGroupParts; part++) {
                const size_t at = group * kGroup + part * kLanes;
                const VF64 relative = hn::Sub(hn::LoadU(d, costs + at), min_cost);
                is_high[part] = hn::Ge(relative, max_cost);
                is_zero[part] = hn::Eq(relative, hn::Zero(d));
                const VF64 next = hn::Add(hn::Min(relative, max_cost), hn::LoadU(d, added + at));
                smallest[part % 2] = hn::Min(next, smallest[part % 2]);
                hn::StoreU(next, d, costs + at);
            }
            switches[group] = BitsOf(is_high);
            zeros = (zeros >> 8) | (uint64_t { BitsOf(is_zero) } << 56);
        };
        uint64_t low_zeros = 0, high_zeros = 0;
        for (size_t group = 0; group < low_groups; group++)
            step(group, low_zeros);
        for (size_t group = 8; group < groups; group++)
            step(group, high_zeros);
        *previous_cheapest = low_zeros ? hwy::Num0BitsBelowLS1Bit_Nonzero64(low_zeros) - 8 * (8 - low_groups)
                                       : 64 + hwy::Num0BitsBelowLS1Bit_Nonzero64(high_zeros | uint64_t { 1 } << 63) - 8 * (16 - groups);
        previous_cheapest = cheapest + position;
        switches += groups;
        min_cost = hn::MinOfLanes(d, hn::Min(smallest[0], smallest[1]));
        double limit = switch_cost;
        if (position < kPrologue)
            limit *= 0.77 + (0.07 / kPrologue) * static_cast<double>(position);
        max_cost = hn::Set(d, limit);
    }
    size_t lane = 0;
    while (lane + 1 < groups * kGroup && costs[lane] != hn::GetLane(min_cost))
        lane++;
    *previous_cheapest = lane;
}

// Four histograms at a time, one in each lane: the sum for each has to be in the order of the symbols.
static constexpr size_t kFourParts = 4 / kLanes;
static constexpr size_t kWord = 64;
// `MAX_SYMBOLS` and `SPARE_LOGARITHMS` in src/highway/brotli.rs.
static constexpr size_t kMaxSymbols = 704, kSpareEntries = 256;
static_assert(4 * kWord <= kSpareEntries);

struct Logged {
    VF64 log[kFourParts], number[kFourParts];
};

// The entry for a number is at twice the number.
static HWY_INLINE Logged LookUp(const double* HWY_RESTRICT table, const uint32_t* HWY_RESTRICT twice, size_t stride)
{
    const DF64 d;
    const auto entry = [&](size_t lane) HWY_ATTR { return hn::LoadU(hn::Full128<double>(), table + twice[lane * stride]); };
#if HWY_MAX_BYTES >= 32
    const auto even = hn::Combine(d, entry(2), entry(0)), odd = hn::Combine(d, entry(3), entry(1));
    return { { hn::InterleaveLower(d, even, odd) }, { hn::InterleaveUpper(d, even, odd) } };
#else
    return { { hn::InterleaveLower(d, entry(0), entry(1)), hn::InterleaveLower(d, entry(2), entry(3)) },
        { hn::InterleaveUpper(d, entry(0), entry(1)), hn::InterleaveUpper(d, entry(2), entry(3)) } };
#endif
}

// Makes entries from `limit` on, which is a power of two, for what is not below it. `count` is a multiple of 4 up to `kSpareEntries`.
static HWY_NOINLINE void BrotliAddEntries(double* HWY_RESTRICT table, uint32_t limit, uint32_t* HWY_RESTRICT twice, size_t count)
{
    const hn::Full128<uint32_t> d;
    uint32_t next = limit;
    for (size_t at = 0; at < count; at += 4) {
        const auto high_bits = hn::And(hn::LoadU(d, twice + at), hn::Set(d, 0 - limit));
        for (uint64_t large = hn::BitsFromMask(d, hn::Ne(high_bits, hn::Zero(d))); large; large &= large - 1) {
            uint32_t& index = twice[at + hwy::Num0BitsBelowLS1Bit_Nonzero64(large)];
            table[next + 1] = index / 2;
            table[next] = log2(table[next + 1]);
            index = next;
            next += 2;
        }
    }
}

struct Sums {
    VF64 bits[kFourParts];
    // For the codes that extend a run of zeros.
    VF64 extension_bits[kFourParts];
};

// Returns the end of the `lengths` of the codes, which are negative for symbols that a histogram does not have.
template<bool kHasRuns>
static HWY_INLINE int32_t* SumSymbols(const uint32_t* HWY_RESTRICT common, const uint32_t* const* HWY_RESTRICT others, size_t size,
    const uint64_t* HWY_RESTRICT used, double* HWY_RESTRICT table, uint32_t limit, const Logged& total, Sums& sums,
    int32_t* HWY_RESTRICT lengths)
{
    static constexpr auto kNumbers = [] {
        std::array<double, kWord> numbers {};
        for (size_t i = 0; i < kWord; i++)
            numbers[i] = i;
        return numbers;
    }();
    const DF64 d;
    const hn::Rebind<int32_t, DF64> di;
    const hn::Repartition<uint32_t, DF64> du;
    alignas(32) uint32_t twice[4 * kWord];
    VF64 previous[kFourParts];
    for (auto& symbol : previous)
        symbol = hn::Set(d, kWord - 1);
    for (size_t first = 0; first < size; first += kWord) {
        for (auto& symbol : previous)
            symbol = hn::Sub(symbol, hn::Set(d, kWord));
        const size_t count = HWY_MIN(size - first, kWord);
        uint64_t word = used[first / kWord] & (~uint64_t { 0 } >> (kWord - count));
        if (!word)
            continue;
        auto any = hn::Zero(du);
        for (size_t at = 0; at < count; at += hn::MaxLanes(du)) {
            for (size_t lane = 0; lane < 4; lane++) {
                const auto sum = hn::Add(hn::LoadU(du, common + first + at), hn::LoadU(du, others[lane] + first + at));
                hn::Store(hn::Add(sum, sum), du, twice + lane * kWord + at);
                any = hn::Or(any, sum);
            }
        }
        if (HWY_UNLIKELY(!hn::AllTrue(du, hn::Eq(hn::And(any, hn::Set(du, 0 - limit / 2)), hn::Zero(du))))) {
            for (size_t lane = 0; lane < 4; lane++)
                hwy::ZeroBytes(twice + lane * kWord + count, sizeof(uint32_t) * (kWord - count));
            BrotliAddEntries(table, limit, twice, 4 * kWord);
        }
        do {
            const size_t symbol = hwy::Num0BitsBelowLS1Bit_Nonzero64(word);
            const Logged counts = LookUp(table, twice + symbol, kWord);
            for (size_t part = 0; part < kFourParts; part++) {
                const auto cost = hn::Sub(total.log[part], counts.log[part]);
                if constexpr (kHasRuns) {
                    const auto here = hn::Add(hn::Min(cost, hn::Zero(d)), hn::Set(d, kNumbers[symbol]));
                    const auto gap = hn::Sub(here, previous[part]);
                    previous[part] = hn::Max(previous[part], here);
                    const auto from_zeros = [&](double zeros) HWY_ATTR { return hn::Gt(gap, hn::Set(d, zeros)); };
                    const auto bits_from = [&](double zeros) HWY_ATTR { return hn::IfThenElseZero(from_zeros(zeros), hn::Set(d, 3.0)); };
                    // Like adding 3 twice: with five symbols or more, a sum that can be inexact is above 4.
                    sums.bits[part] = hn::Add(sums.bits[part], hn::Add(bits_from(3), bits_from(10)));
                    sums.extension_bits[part] = hn::Add(sums.extension_bits[part], bits_from(10));
                    if (HWY_UNLIKELY(!hn::AllFalse(d, from_zeros(66)))) {
                        sums.bits[part] = hn::Add(hn::Add(sums.bits[part], bits_from(66)), bits_from(514));
                        sums.extension_bits[part] = hn::Add(sums.extension_bits[part], hn::Add(bits_from(66), bits_from(514)));
                    }
                }
                sums.bits[part] = hn::Add(sums.bits[part], hn::Mul(counts.number[part], cost));
                hn::StoreU(hn::DemoteInRangeTo(di, hn::Add(cost, hn::Set(d, 0.5))), di, lengths + part * kLanes);
            }
            lengths += 4;
            word &= word - 1;
        } while (word);
    }
    return lengths;
}

static void BrotliEstimateCosts(const uint32_t* HWY_RESTRICT common, const uint32_t* const* HWY_RESTRICT others, size_t size,
    const uint64_t* HWY_RESTRICT used, const uint32_t* HWY_RESTRICT totals, const uint32_t* HWY_RESTRICT gaps, double* HWY_RESTRICT table,
    uint32_t limit, double* HWY_RESTRICT costs)
{
    const DF64 d;
    const hn::Rebind<int32_t, DF64> di;
    const hn::Repartition<int8_t, DF64> d8;
    const hn::Repartition<int16_t, DF64> d16;
    const hn::Repartition<int32_t, DF64> d32;
    const hn::Full128<uint32_t> d4;
    const auto doubled = [&](const uint32_t* four) HWY_ATTR { return hn::ShiftLeft<1>(hn::LoadU(d4, four)); };

    // How often each length occurs, then the code for runs of zeros, and then the sum.
    alignas(16) uint32_t twice[16 + 2][4];
    hn::Store(doubled(totals), d4, twice[0]);
    BrotliAddEntries(table, limit, twice[0], 4);
    const Logged total = LookUp(table, twice[0], 1);
    const auto lone_zeros = doubled(gaps), runs = doubled(gaps + 4);

    constexpr size_t kBytes = hn::MaxLanes(d8);
    alignas(32) int32_t lengths[4 * kMaxSymbols + kBytes];
    Sums sums;
    for (size_t part = 0; part < kFourParts; part++)
        sums.bits[part] = sums.extension_bits[part] = hn::Zero(d);
    int32_t* const lengths_end = hn::AllTrue(d4, hn::Eq(runs, hn::Zero(d4)))
        ? SumSymbols<false>(common, others, size, used, table, limit, total, sums, lengths)
        : SumSymbols<true>(common, others, size, used, table, limit, total, sums, lengths);
    for (size_t i = 0; i < kBytes; i += kBytes / 4)
        hn::StoreU(hn::Set(d32, -1), d32, lengths_end + i);

    alignas(32) int8_t bytes[4 * kMaxSymbols];
    int8_t* bytes_end = bytes;
    auto longest = hn::Set(d8, 1);
    for (const int32_t* from = lengths; from < lengths_end; from += kBytes, bytes_end += kBytes) {
        const auto half = [&](size_t at) HWY_ATTR { return hn::ReorderDemote2To(d16, hn::Load(d32, from + at), hn::Load(d32, from + at + kBytes / 4)); };
        const auto packed = hn::Min(hn::ReorderDemote2To(d8, half(0), half(kBytes / 2)), hn::Set(d8, 15));
        longest = hn::Max(longest, packed);
        hn::Store(packed, d8, bytes_end);
    }
    const size_t kinds = hn::AllFalse(d8, hn::Gt(longest, hn::Set(d8, 7))) ? 8 : 16;

    auto sum = hn::Add(lone_zeros, runs);
    for (size_t first = 0; first < kinds; first += 8) {
        hn::Vec<decltype(d8)> seen[8];
        for (auto& count : seen)
            count = hn::Zero(d8);
        for (const int8_t* at = bytes; at < bytes_end; at += kBytes) {
            const auto length = hn::Sub(hn::Load(d8, at), hn::Set(d8, static_cast<int8_t>(first)));
            for (size_t i = 0; i < 8; i++)
                seen[i] = hn::Sub(seen[i], hn::VecFromMask(d8, hn::Eq(length, hn::Set(d8, static_cast<int8_t>(i)))));
        }
        for (size_t i = 0; i < 8; i++) {
            const auto by_lane = hn::TableLookupBytes(seen[i], hn::Dup128VecFromValues(d8, 0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15));
            const auto pairs = hn::SatWidenMulPairwiseAdd(d16, hn::BitCast(hn::RebindToUnsigned<decltype(d8)>(), by_lane), hn::Set(d8, 2));
            const auto fours = hn::BitCast(hn::RebindToUnsigned<decltype(d32)>(), hn::WidenMulPairwiseAdd(d32, pairs, hn::Set(d16, 1)));
#if HWY_MAX_BYTES >= 32
            const auto all = hn::Add(hn::LowerHalf(d4, fours), hn::UpperHalf(d4, fours));
#else
            const auto all = fours;
#endif
            sum = hn::Add(sum, all);
            hn::Store(all, d4, twice[first + i]);
        }
    }
    for (size_t part = 0; part < kFourParts; part++) {
        const auto extensions = hn::DemoteInRangeTo(di, hn::Div(sums.extension_bits[part], hn::Set(d, 1.5)));
        hn::StoreU(extensions, di, reinterpret_cast<int32_t*>(twice[kinds]) + part * kLanes);
    }
    hn::Store(hn::Add(sum, hn::Load(d4, twice[kinds])), d4, twice[kinds + 1]);
    hn::Store(hn::Add(runs, hn::Load(d4, twice[kinds])), d4, twice[kinds]);
    hn::Store(hn::Add(lone_zeros, hn::Load(d4, twice[0])), d4, twice[0]);
    const auto any = hn::Or3(hn::Load(d4, twice[kinds + 1]), lone_zeros, runs);
    if (HWY_UNLIKELY(!hn::AllTrue(d4, hn::Lt(any, hn::Set(d4, limit)))))
        BrotliAddEntries(table, limit, twice[0], 4 * (kinds + 2));

    VF64 entropy[kFourParts];
    for (auto& bits : entropy)
        bits = hn::Zero(d);
    for (size_t i = 0; i <= kinds; i++) {
        const Logged count = LookUp(table, twice[i], 1);
        for (size_t part = 0; part < kFourParts; part++)
            entropy[part] = hn::Sub(entropy[part], hn::Mul(count.number[part], count.log[part]));
    }
    const Logged codes = LookUp(table, twice[kinds + 1], 1);

    longest = hn::Max(longest, hn::BitCast(d8, hn::Reverse(d32, hn::BitCast(d32, longest))));
    longest = hn::Max(longest, hn::BitCast(d8, hn::Shuffle1032(hn::BitCast(d32, longest))));
    longest = hn::Max(longest, hn::BitCast(d8, hn::Shuffle2301(hn::BitCast(d32, longest))));
    const auto max_lengths = hn::PromoteTo(hn::Full128<int32_t>(), hn::ResizeBitCast(hn::Full32<int8_t>(), longest));
    alignas(16) int32_t header_bits[4];
    hn::Store(hn::Add(hn::ShiftLeft<1>(max_lengths), hn::Set(hn::Full128<int32_t>(), 18)), hn::Full128<int32_t>(), header_bits);
    for (size_t part = 0; part < kFourParts; part++) {
        const auto header = hn::PromoteTo(d, hn::LoadU(di, header_bits + part * kLanes));
        const auto code_bits = hn::Max(hn::Add(entropy[part], hn::Mul(codes.number[part], codes.log[part])), codes.number[part]);
        hn::StoreU(hn::Add(hn::Add(sums.bits[part], header), code_bits), d, costs + part * kLanes);
    }
}

#if HWY_MAX_BYTES >= 32

static size_t BrotliRemovePairs(double* HWY_RESTRICT costs, uint32_t* HWY_RESTRICT pairs, size_t count, uint32_t a, uint32_t b)
{
    const DF64 d;
    const hn::RebindToUnsigned<DF64> d64;
    const hn::Repartition<uint32_t, DF64> du;
    const hn::Repartition<int32_t, DF64> di;
    // In all lanes.
    auto best_cost = hn::Set(d, 1e99);
    auto best_pair = hn::Set(du, ~uint32_t { 0 });
    auto best_apart = hn::Zero(di);
    const auto apart_of = [&](hn::Vec<decltype(du)> pair) HWY_ATTR {
        return hn::BitCast(di, hn::Sub(pair, hn::BitCast(du, hn::ShiftLeft<32>(hn::BitCast(d64, pair)))));
    };
    size_t kept = 0;
    for (size_t at = 0; at + kLanes <= count; at += kLanes) {
        auto cost = hn::LoadU(d, costs + at);
        auto pair = hn::LoadU(du, pairs + 2 * at);
        const auto is_gone = hn::VecFromMask(du, hn::Or(hn::Eq(pair, hn::Set(du, a)), hn::Eq(pair, hn::Set(du, b))));
        const auto stays = hn::RebindMask(d, hn::Eq(hn::BitCast(d64, is_gone), hn::Zero(d64)));
        const auto apart = apart_of(pair);
        const auto better = [&]() HWY_ATTR {
            const auto is_nearer = hn::MaskFromVec(hn::BitCast(d, hn::DupOdd(hn::VecFromMask(di, hn::Lt(apart, best_apart)))));
            return hn::And(stays, hn::Or(hn::Lt(cost, best_cost), hn::And(hn::Eq(cost, best_cost), is_nearer)));
        };
        for (auto found = better(); HWY_UNLIKELY(!hn::AllFalse(d, found));) {
            const size_t first = at + hn::FindKnownFirstTrue(d, found);
            const auto lane = hn::SetOnlyFirst(found);
            cost = hn::IfThenElse(lane, best_cost, cost);
            pair = hn::IfVecThenElse(hn::BitCast(du, hn::VecFromMask(d, lane)), best_pair, pair);
            best_cost = hn::Set(d, costs[first]);
            best_pair = hn::OddEven(hn::Set(du, pairs[2 * first + 1]), hn::Set(du, pairs[2 * first]));
            best_apart = apart_of(best_pair);
            found = hn::AndNot(lane, better());
        }
        hn::StoreU(hn::BitCast(du, hn::Compress(hn::BitCast(d, pair), stays)), du, pairs + 2 * kept);
        kept += hn::CompressStore(cost, stays, d, costs + kept);
    }
    costs[0] = hn::GetLane(best_cost);
    pairs[0] = hn::GetLane(best_pair);
    pairs[1] = hn::ExtractLane(best_pair, 1);
    return kept;
}

#else

// For each set of four elements of 8 bytes to leave out, the bytes of the others.
struct Remainders {
    alignas(16) uint8_t bytes[16][32];
    uint8_t counts[16];
};

static constexpr Remainders kRemainders = [] {
    Remainders all {};
    for (size_t gone = 0; gone < 16; gone++) {
        for (size_t byte = 0; byte < 32; byte++) {
            if (gone >> (byte / 8) & 1)
                continue;
            all.bytes[gone][8 * all.counts[gone] + byte % 8] = byte;
            all.counts[gone] += byte % 8 == 7;
        }
    }
    return all;
}();

// `PAIR_GROUP` in src/highway/brotli.rs at a time, since getting bits out of a mask takes long.
static size_t BrotliRemovePairs(double* HWY_RESTRICT costs, uint32_t* HWY_RESTRICT pairs, size_t count, uint32_t a, uint32_t b)
{
    const DF64 d;
    const hn::Repartition<uint32_t, DF64> du;
    const hn::Repartition<int32_t, DF64> di;
    const hn::Repartition<uint8_t, DF64> d8;
    double best_cost = 1e99;
    uint32_t best_first = ~uint32_t { 0 }, best_second = best_first;
    const auto apart = [](uint32_t first, uint32_t second) { return static_cast<int32_t>(second - first); };
    const auto narrowed = [&](MF64 low, MF64 high) HWY_ATTR {
        return hn::MaskFromVec(hn::ConcatEven(du, hn::BitCast(du, hn::VecFromMask(d, high)), hn::BitCast(du, hn::VecFromMask(d, low))));
    };
    const auto keep = [&](const void* from, uint64_t gone, void* to) HWY_ATTR {
        const auto low = hn::LoadU(d8, static_cast<const uint8_t*>(from)), high = hn::LoadU(d8, static_cast<const uint8_t*>(from) + 16);
        for (size_t at = 0; at < 32; at += 16) {
            const auto bytes = hn::IndicesFromVec(d8, hn::Load(d8, kRemainders.bytes[gone] + at));
            hn::StoreU(hn::TwoTablesLookupLanes(d8, low, high, bytes), d8, static_cast<uint8_t*>(to) + at);
        }
    };
    size_t kept = 0;
    for (size_t at = 0; at + 4 <= count; at += 4) {
        const auto low_costs = hn::LoadU(d, costs + at), high_costs = hn::LoadU(d, costs + at + 2), best_costs = hn::Set(d, best_cost);
        const auto low_pairs = hn::LoadU(du, pairs + 2 * at), high_pairs = hn::LoadU(du, pairs + 2 * at + 4);
        const auto firsts = hn::ConcatEven(du, high_pairs, low_pairs), seconds = hn::ConcatOdd(du, high_pairs, low_pairs);
        const auto have = [&](uint32_t id) HWY_ATTR { return hn::Or(hn::Eq(firsts, hn::Set(du, id)), hn::Eq(seconds, hn::Set(du, id))); };
        const auto is_gone = hn::Or(have(a), have(b));
        const auto is_cheaper = narrowed(hn::Lt(low_costs, best_costs), hn::Lt(high_costs, best_costs));
        const auto is_equal = narrowed(hn::Eq(low_costs, best_costs), hn::Eq(high_costs, best_costs));
        const auto is_nearer = hn::RebindMask(du, hn::Lt(hn::BitCast(di, hn::Sub(seconds, firsts)), hn::Set(di, apart(best_first, best_second))));
        const uint64_t gone = hn::BitsFromMask(du, is_gone);
        if (HWY_UNLIKELY(!hn::AllFalse(du, hn::AndNot(is_gone, hn::Or(is_cheaper, hn::And(is_equal, is_nearer)))))) {
            for (size_t i = at; i < at + 4; i++) {
                uint32_t &first = pairs[2 * i], &second = pairs[2 * i + 1];
                const bool is_better = costs[i] < best_cost || (costs[i] == best_cost && apart(first, second) < apart(best_first, best_second));
                if (is_better && !(gone >> (i - at) & 1)) {
                    std::swap(costs[i], best_cost);
                    std::swap(first, best_first);
                    std::swap(second, best_second);
                }
            }
        }
        keep(costs + at, gone, costs + kept);
        keep(pairs + 2 * at, gone, pairs + 2 * kept);
        kept += kRemainders.counts[gone];
    }
    costs[0] = best_cost;
    pairs[0] = best_first;
    pairs[1] = best_second;
    return kept;
}

#endif

// `LEAF_SLACK` in src/highway/brotli.rs.
static constexpr size_t kLeafGroup = 16;

using D16 = hn::CappedTag<int16_t, kLeafGroup>;
using V16 = hn::Vec<D16>;

static constexpr size_t kLeafLanes = hn::MaxLanes(D16());
static constexpr size_t kLeafParts = kLeafGroup / kLeafLanes;

// The distances that are no sum of the gaps 4, 10 and 23. After their passes, leaves at all others are in order.
static constexpr ptrdiff_t kLastDistances[] = { 1, 2, 3, 5, 6, 7, 9, 11, 13, 15, 17, 19, 21, 25, 29 };
// The last multiple of 4 that is no sum of the gaps 10, 23, 57 and 132.
static constexpr size_t kReachOfGap4 = 128;

struct LeafRow {
    static constexpr size_t kBefore = 2 * kLeafGroup, kAfter = 3 * kLeafGroup;
    alignas(32) int16_t padded[kBefore + kMaxSymbols + kAfter];
    // Where each count was at first.
    alignas(32) uint16_t origins[kMaxSymbols + kLeafGroup];

    HWY_INLINE int16_t* Counts() { return padded + kBefore; }

    // With what stays before and after all counts.
    HWY_INLINE void Pad(size_t count)
    {
        const D16 d;
        for (size_t i = 0; i < kBefore; i += kLeafLanes)
            hn::Store(hn::Zero(d), d, padded + i);
        for (size_t i = 0; i < kAfter; i += kLeafLanes)
            hn::StoreU(hn::Set(d, INT16_MAX - 1), d, Counts() + count + i);
    }
};

// Finds where a stable sort puts `kLeafGroup` counts, by how many of the others go before each.
struct LeafGroup {
    V16 ours[kLeafParts], above[kLeafParts], negated_rank[kLeafParts];

    HWY_INLINE explicit LeafGroup(const int16_t* at)
    {
        const D16 d;
        for (size_t i = 0; i < kLeafParts; ++i) {
            ours[i] = hn::Load(d, at + i * kLeafLanes);
            above[i] = hn::Add(ours[i], hn::Set(d, 1));
            negated_rank[i] = hn::Zero(d);
        }
    }

    HWY_INLINE void CountBelow(const V16* limits, const int16_t* others)
    {
        const D16 d;
        for (size_t i = 0; i < kLeafParts; ++i) {
            const auto below = hn::Gt(limits[i], hn::LoadU(d, others + i * kLeafLanes));
            negated_rank[i] = hn::Add(negated_rank[i], hn::VecFromMask(d, below));
        }
    }

    HWY_INLINE void CompareWithEarlier(const int16_t* others) { CountBelow(above, others); }
    HWY_INLINE void CompareWithLater(const int16_t* others) { CountBelow(ours, others); }

    // Rank 0 of the first lane is at `base`.
    template<typename Move>
    HWY_INLINE void Finish(size_t first, ptrdiff_t base, size_t gap, size_t count, const Move& move)
    {
        const D16 d;
        const hn::RebindToUnsigned<D16> du;
        alignas(32) uint16_t targets[kLeafGroup];
        for (size_t i = 0; i < kLeafParts; ++i) {
            const V16 bases = hn::Add(hn::Set(d, static_cast<int16_t>(base)), hn::Iota(d, i * kLeafLanes));
            const V16 target = hn::NegMulAdd(negated_rank[i], hn::Set(d, static_cast<int16_t>(gap)), bases);
            const auto last = hn::Set(du, static_cast<uint16_t>(count + kLeafGroup - 1));
            hn::Store(hn::Min(hn::BitCast(du, target), last), du, targets + i * kLeafLanes);
        }
        // Loads are faster than extracting the lanes.
        const uint16_t* stored = targets;
        hwy::PreventElision(stored);
        for (size_t i = 0; i < kLeafGroup; ++i)
            move(first + i, stored[i]);
    }
};

// One pass of a Shell sort. Counts that are more than `reach` apart are in order.
template<typename Move>
static HWY_INLINE void SortWithGap(const int16_t* counts, size_t count, size_t gap, size_t reach, const Move& move)
{
    for (size_t first = 0; first < count; first += kLeafGroup) {
        const int16_t* const ours = counts + first;
        LeafGroup group(ours);
        const int16_t* const lowest = ours - HWY_MIN(first + kLeafGroup - 1, reach);
        const int16_t* const highest = ours + HWY_MIN(count - 1 - first, reach);
        const int16_t* at = ours;
        HWY_UNROLL(1)
        for (; at - lowest >= static_cast<ptrdiff_t>(gap); at -= gap)
            group.CompareWithEarlier(at - gap);
        const ptrdiff_t base = at - counts;
        HWY_UNROLL(1)
        for (at = ours; highest - at >= static_cast<ptrdiff_t>(gap); at += gap)
            group.CompareWithLater(at + gap);
        group.Finish(first, base, gap, count, move);
    }
}

template<typename Move>
static HWY_INLINE void SortAtLastDistances(const int16_t* counts, size_t count, const Move& move)
{
    for (size_t first = 0; first < count; first += kLeafGroup) {
        const int16_t* ours = counts + first;
        LeafGroup group(ours);
        HWY_UNROLL(15)
        for (const ptrdiff_t distance : kLastDistances) {
            group.CompareWithEarlier(ours - distance);
            group.CompareWithLater(ours + distance);
            // Otherwise, all loads come first and take more registers than there are.
            hwy::PreventElision(ours);
        }
        group.Finish(first, first - std::size(kLastDistances), 1, count, move);
    }
}

static bool BrotliSortLeaves(const uint64_t* HWY_RESTRICT leaves, size_t count, bool like_shell_sort, uint64_t* HWY_RESTRICT sorted)
{
    const D16 d;
    const hn::RebindToUnsigned<D16> du;
    const hn::Repartition<int32_t, D16> d32;
    LeafRow rows[2];
    LeafRow *from = rows, *to = rows + 1;
    const auto counts_at = [&](size_t i) HWY_ATTR {
        const int32_t* const halves = reinterpret_cast<const int32_t*>(leaves + i);
        return hn::ConcatOdd(d32, hn::LoadU(d32, halves + kLeafLanes / 2), hn::LoadU(d32, halves));
    };
    for (size_t i = 0; i < count; i += kLeafLanes)
        hn::Store(hn::OrderedDemote2To(d, counts_at(i), counts_at(i + kLeafLanes / 2)), d, from->Counts() + i);
    from->Pad(count);
    // What does not fit is INT16_MAX or negative now.
    V16 signs = hn::Zero(d);
    for (size_t i = 0; i < count; i += kLeafLanes) {
        const V16 counts = hn::Load(d, from->Counts() + i);
        signs = hn::Or3(signs, counts, hn::Add(counts, hn::Set(d, 1)));
    }
    if (!hn::AllFalse(d, hn::IsNegative(signs)))
        return false;

    if (!like_shell_sort) {
        SortWithGap(from->Counts(), count, 1, count, [&](size_t i, size_t target) HWY_ATTR { sorted[target] = leaves[i]; });
        return true;
    }
    to->Pad(count);
    for (size_t i = 0; i < count + kLeafGroup; i += kLeafLanes)
        hn::Store(hn::Iota(du, i), du, from->origins + i);
    for (const size_t gap : { 132, 57, 23, 10, 4 }) {
        if (gap >= count)
            continue;
        int16_t* HWY_RESTRICT const counts = to->Counts();
        uint16_t* HWY_RESTRICT const origins = to->origins;
        SortWithGap(from->Counts(), count, gap, gap == 4 ? kReachOfGap4 : count, [&](size_t i, size_t target) HWY_ATTR {
            counts[target] = from->Counts()[i];
            origins[target] = from->origins[i];
        });
        std::swap(from, to);
    }
    SortAtLastDistances(from->Counts(), count, [&](size_t i, size_t target) HWY_ATTR {
        sorted[target] = leaves[HWY_MIN(from->origins[i], count + kLeafGroup - 1)];
    });
    return true;
}

// The rest does too little for a call through a table. It is for the baseline, and LTO puts it into the loops of the caller.

using DF32 = hn::Full128<float>;
using DU32 = hn::Full128<uint32_t>;
using DI32 = hn::Full128<int32_t>;
using DU16 = hn::Full128<uint16_t>;
using DU8 = hn::Full128<uint8_t>;
using DU64 = hn::Full128<uint64_t>;

// `SLOT_SHIFT` and `LENGTH_SHIFT` in src/highway/brotli.rs.
static constexpr int kSlotShift = 4, kLengthShift = 37;

class ShortCodes {
public:
    HWY_INLINE ShortCodes(const uint8_t* bytes, uint32_t last_start, uint32_t ring_mask, uint32_t position, uint16_t pair)
        : m_bytes(bytes)
        , m_from(hn::Add(hn::Set(DU32(), position), hn::ShiftRight<1>(Span())))
        , m_mask(hn::Set(DU32(), ring_mask))
        , m_last(hn::Set(DU32(), last_start))
        , m_all(hn::Zero(DU32()))
        , m_pairs(hn::Set(DU16(), pair))
    {
    }

    HWY_INLINE uint64_t For(hn::Vec<DU32> distances)
    {
        const DU8 d8;
        const DU16 d16;
        const DU64 d64;
        const auto start = hn::Sub(hn::And(hn::Sub(m_from, distances), m_mask), Span());
        m_all = hn::Or(m_all, start);
        const auto at = hn::BitCast(d64, hn::Min(start, m_last));
        const uint64_t low = hn::GetLane(at), high = hn::ExtractLane(at, 1);
        uint64_t near_first, near_second;
        uint16_t at_third, at_fourth;
        hwy::CopyBytes<8>(m_bytes + (low & 0xFFFFFFFF), &near_first);
        hwy::CopyBytes<8>(m_bytes + (low >> 32), &near_second);
        hwy::CopyBytes<2>(m_bytes + (high & 0xFFFFFFFF), &at_third);
        hwy::CopyBytes<2>(m_bytes + (high >> 32), &at_fourth);
        const auto nearby = hn::BitCast(d8, hn::Dup128VecFromValues(d64, near_first, near_second));
        const auto codes_from_0 = hn::TableLookupBytes(nearby, hn::Dup128VecFromValues(d8, 3, 4, 11, 12, 0, 0, 0, 0, 4, 5, 2, 3, 5, 6, 1, 2));
        const auto codes_from_8 = hn::TableLookupBytes(nearby, hn::Dup128VecFromValues(d8, 6, 7, 0, 1, 12, 13, 10, 11, 13, 14, 9, 10, 14, 15, 8, 9));
        const auto with_all = hn::InsertLane(hn::InsertLane(hn::BitCast(d16, codes_from_0), 2, at_third), 3, at_fourth);
        return hn::BitsFromMask(d8, hn::OrderedDemote2MasksTo(d8, d16, hn::Eq(with_all, m_pairs), hn::Eq(hn::BitCast(d16, codes_from_8), m_pairs)));
    }

    HWY_INLINE bool WentAround() const { return !hn::AllFalse(DI32(), hn::IsNegative(hn::BitCast(DI32(), m_all))); }

private:
    // From the farthest to the nearest position that each of the last distances stands for.
    static HWY_INLINE hn::Vec<DU32> Span() { return hn::Dup128VecFromValues(DU32(), 6, 6, 0, 0); }

    const uint8_t* m_bytes;
    hn::Vec<DU32> m_from, m_mask, m_last, m_all;
    hn::Vec<DU16> m_pairs;
};

static HWY_INLINE uint32_t BrotliShortCodes(const uint8_t* HWY_RESTRICT bytes, uint32_t last_start, uint32_t ring_mask, uint32_t position,
    uint16_t pair, const uint32_t* HWY_RESTRICT distances)
{
    ShortCodes codes(bytes, last_start, ring_mask, position, pair);
    const uint32_t found = codes.For(hn::LoadU(DU32(), distances));
    return HWY_UNLIKELY(codes.WentAround()) ? 0xFFFF : found;
}

static HWY_INLINE uint32_t BrotliShortCodesOfFive(const uint8_t* HWY_RESTRICT bytes, uint32_t last_start, uint32_t ring_mask, uint32_t position,
    uint16_t pair, const uint32_t* HWY_RESTRICT distances, const uint64_t* HWY_RESTRICT ranked, float hopeless, uint64_t* HWY_RESTRICT others)
{
    const DU8 d8;
    const DU16 d16;
    const DU32 d32;
    const DF32 df;
    const auto distances_of = [&](size_t rank) HWY_ATTR { return hn::LoadU(d32, distances + (ranked[rank] >> kSlotShift) % 8 * 4); };
    ShortCodes codes(bytes, last_start, ring_mask, position, pair);
    uint32_t best = codes.For(distances_of(0));
    uint64_t found = 0;
    for (size_t rank = 1; rank < 5; rank++)
        found |= codes.For(distances_of(rank)) << (16 * rank - 16);
    if (HWY_UNLIKELY(codes.WentAround())) {
        best = 0xFFFF;
        found = ~uint64_t { 0 };
    }
    const auto like_best = [&](size_t rank) HWY_ATTR {
        return hn::OrderedDemote2MasksTo(d16, d32, hn::Eq(distances_of(rank), distances_of(0)), hn::Eq(distances_of(rank + 1), distances_of(0)));
    };
    const auto equal_bytes = hn::VecFromMask(d8, hn::OrderedDemote2MasksTo(d8, d16, like_best(1), like_best(3)));
    const auto halves = [&](size_t rank) HWY_ATTR { return hn::BitCast(df, hn::LoadU(DU64(), ranked + rank)); };
    const auto costs = hn::ConcatOdd(df, halves(3), halves(1));
    const auto is_like_best = hn::RebindMask(df, hn::Eq(hn::BitCast(d32, equal_bytes), hn::Set(d32, ~uint32_t { 0 })));
    const auto dropped = hn::RebindMask(d32, hn::Or(hn::And(is_like_best, hn::Ge(costs, hn::Set(df, hopeless))), hn::Gt(costs, hn::Zero(df))));
    *others = found & ~hn::GetLane(hn::BitCast(DU64(), hn::VecFromMask(d16, hn::OrderedDemote2MasksTo(d16, d32, dropped, dropped))));
    return best;
}

template<class Distance, class Insert>
static HWY_INLINE hn::Mask<DF32> Improve(float* HWY_RESTRICT costs, uint32_t* HWY_RESTRICT nodes, size_t stride, hn::Vec<DI32> lengths, hn::Vec<DI32> end,
    hn::Vec<DF32> cost, const Distance& distance, const Insert& insert)
{
    const DF32 df;
    const DU32 du;
    const auto old = hn::LoadU(df, costs);
    const auto better = hn::And(hn::Lt(cost, old), hn::RebindMask(df, hn::Lt(lengths, end)));
    if (hn::AllFalse(df, better))
        return better;
    hn::StoreU(hn::IfThenElse(better, cost, old), df, costs);
    const auto put = [&](uint32_t* to, hn::Vec<DU32> value) HWY_ATTR {
        hn::StoreU(hn::IfThenElse(hn::RebindMask(du, better), value, hn::LoadU(du, to)), du, to);
    };
    put(nodes, hn::BitCast(du, lengths));
    put(nodes + stride, distance());
    put(nodes + 2 * stride, insert());
    return better;
}

static HWY_INLINE void BrotliTryLengths(float* HWY_RESTRICT costs, uint32_t* HWY_RESTRICT nodes, size_t stride, size_t length, size_t end,
    const float* HWY_RESTRICT extra_bits, const float* HWY_RESTRICT symbol_costs, float base, uint32_t distance, uint32_t insert)
{
    const DF32 df;
    const DU32 du;
    const DI32 di;
    auto lengths = hn::Iota(di, static_cast<int32_t>(length));
    for (; length < end; length += 4, lengths = hn::Add(lengths, hn::Set(di, 4))) {
        const auto cost = hn::Add(hn::Add(hn::Set(df, base), hn::LoadU(df, extra_bits + length)), hn::LoadU(df, symbol_costs + length));
        Improve(
            costs + length, nodes + length, stride, lengths, hn::Set(di, static_cast<int32_t>(end)), cost,
            [&]() HWY_ATTR { return hn::Set(du, distance); }, [&]() HWY_ATTR { return hn::Set(du, insert); });
    }
}

static HWY_INLINE size_t BrotliTryLengthsAtCost(float* HWY_RESTRICT costs, uint32_t* HWY_RESTRICT nodes, size_t stride, size_t length, size_t end,
    float cost, uint32_t distance, uint32_t insert)
{
    const DU32 du;
    const DI32 di;
    auto lengths = hn::Iota(di, static_cast<int32_t>(length)), longest = hn::Zero(di);
    for (; length < end; length += 4, lengths = hn::Add(lengths, hn::Set(di, 4))) {
        const auto better = Improve(
            costs + length, nodes + length, stride, lengths, hn::Set(di, static_cast<int32_t>(end)), hn::Set(DF32(), cost),
            [&]() HWY_ATTR { return hn::Set(du, distance); }, [&]() HWY_ATTR { return hn::Set(du, insert); });
        longest = hn::IfThenElse(hn::RebindMask(di, better), lengths, longest);
    }
    return hn::ReduceMax(di, longest);
}

static HWY_INLINE void BrotliTryMatches(float* HWY_RESTRICT costs, uint32_t* HWY_RESTRICT nodes, size_t stride, size_t length, size_t end,
    const float* HWY_RESTRICT extra_bits, const uint64_t* HWY_RESTRICT matches, size_t count, const float* HWY_RESTRICT distance_costs,
    const float* HWY_RESTRICT symbol_costs, float base, uint32_t insert, const float* HWY_RESTRICT symbol_costs2, float base2, uint32_t insert2)
{
    const DF32 df;
    const DU32 du;
    const DI32 di;
    const DU8 d8;
    alignas(16) static constexpr uint32_t kMissing[8] = { 0, 0, 0, 0, INT32_MAX, INT32_MAX, INT32_MAX, INT32_MAX };
    const auto low = hn::BitCast(du, hn::LoadU(DU64(), matches)), high = hn::BitCast(du, hn::LoadU(DU64(), matches + 2));
    const auto distances = hn::ConcatEven(du, high, low);
    const auto longest = hn::BitCast(di, hn::Or(hn::ShiftRight<kLengthShift - 32>(hn::ConcatOdd(du, high, low)), hn::LoadU(du, kMissing + 4 - (count - 1) % 4)));

    // The exponent is the number of extra bits, and the next bit tells the two symbols for it apart. The zero after that stops a carry.
    const auto half = hn::ShiftRight<1>(hn::Add(distances, hn::Set(du, 3)));
    const auto as_float = hn::ConvertTo(df, hn::BitCast(di, hn::AndNot(hn::ShiftRight<2>(half), half)));
    const auto top = hn::ShiftRight<22>(hn::BitCast(du, as_float));
    const auto symbols = hn::BitCast(DU64(), hn::And(top, hn::Set(du, 63)));
    const uint64_t symbols01 = hn::GetLane(symbols), symbols23 = hn::ExtractLane(symbols, 1);
    const auto distance_cost = hn::Dup128VecFromValues(df, distance_costs[symbols01 & 0xFFFFFFFF], distance_costs[symbols01 >> 32],
        distance_costs[symbols23 & 0xFFFFFFFF], distance_costs[symbols23 >> 32]);
    const auto distance_bits = hn::ConvertTo(df, hn::Sub(hn::BitCast(di, hn::ShiftRight<1>(top)), hn::Set(di, 127)));
    const auto with_distance = [&](float cost) HWY_ATTR { return hn::Add(hn::Add(hn::Set(df, cost), distance_bits), distance_cost); };
    const auto bases = with_distance(base), bases2 = with_distance(base2);

    auto lengths = hn::Iota(di, static_cast<int32_t>(length));
    do {
        const auto exceeds = [&](hn::Vec<DI32> limit) HWY_ATTR { return hn::BitCast(d8, hn::VecFromMask(di, hn::Gt(lengths, limit))); };
        const auto minus_index = hn::Add(hn::Add(exceeds(hn::Broadcast<0>(longest)), exceeds(hn::Broadcast<1>(longest))), exceeds(hn::Broadcast<2>(longest)));
        const auto twice = hn::Add(minus_index, minus_index);
        const auto bytes = hn::Sub(hn::BitCast(d8, hn::Set(du, 0x03020100)), hn::Add(twice, twice));
        const auto of_match = [&](auto v) HWY_ATTR { return hn::BitCast(hn::DFromV<decltype(v)>(), hn::TableLookupBytes(hn::BitCast(d8, v), bytes)); };
        const auto extra = hn::LoadU(df, extra_bits + length);
        const auto cost = hn::Add(hn::Add(of_match(bases), extra), hn::LoadU(df, symbol_costs + length));
        const auto cost2 = hn::Add(hn::Add(of_match(bases2), extra), hn::LoadU(df, symbol_costs2 + length));
        Improve(
            costs + length, nodes + length, stride, lengths, hn::Set(di, static_cast<int32_t>(end)), hn::Min(cost, cost2),
            [&]() HWY_ATTR { return of_match(distances); },
            [&]() HWY_ATTR { return hn::IfThenElse(hn::RebindMask(du, hn::Lt(cost2, cost)), hn::Set(du, insert2), hn::Set(du, insert)); });
        lengths = hn::Add(lengths, hn::Set(di, 4));
        length += 4;
    } while (length < end);
}

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
HWY_EXPORT(BrotliFindSwitches);
HWY_EXPORT(BrotliEstimateCosts);
HWY_EXPORT(BrotliRemovePairs);
HWY_EXPORT(BrotliSortLeaves);

// For 1 to 16 `groups`. Reads `length` symbols and `alphabet_size * groups * 8` costs, updates `groups * 8`, writes `groups` and 1 bytes for each symbol.
extern "C" void highway_brotli_find_switches(const uint16_t* symbols, size_t length, const double* symbol_costs, size_t alphabet_size,
    size_t groups, double switch_cost, double* costs, uint8_t* switches, uint8_t* cheapest)
{
    BUN_HWY_DISPATCH(BrotliFindSwitches)(symbols, length, symbol_costs, alphabet_size, groups, switch_cost, costs, switches, cheapest);
}

// Reads `size` counts of each, a multiple of 8 up to 704. Uses `limit + 512` numbers of `table`, where `limit` is a power of two from 2 on.
extern "C" void highway_brotli_estimate_costs(const uint32_t* common, const uint32_t* const* others, size_t size, const uint64_t* used,
    const uint32_t* totals, const uint32_t* gaps, double* table, uint32_t limit, double* costs)
{
    BUN_HWY_DISPATCH(BrotliEstimateCosts)(common, others, size, used, totals, gaps, table, limit, costs);
}

// Updates `count` costs and pairs, and the first ones in any case.
extern "C" size_t highway_brotli_remove_pairs(double* costs, uint32_t* pairs, size_t count, uint32_t a, uint32_t b)
{
    return BUN_HWY_DISPATCH(BrotliRemovePairs)(costs, pairs, count, a, b);
}

// Touches less than `count + 16` elements of both. `count` is at most 704.
extern "C" bool highway_brotli_sort_leaves(const uint64_t* leaves, size_t count, bool like_shell_sort, uint64_t* sorted)
{
    return BUN_HWY_DISPATCH(BrotliSortLeaves)(leaves, count, like_shell_sort, sorted);
}

// These two read up to `last_start + 8` bytes.
extern "C" __attribute__((always_inline)) uint32_t highway_brotli_short_codes(const uint8_t* bytes, uint32_t last_start, uint32_t ring_mask,
    uint32_t position, uint16_t pair, const uint32_t* distances)
{
    return HWY_STATIC_DISPATCH(BrotliShortCodes)(bytes, last_start, ring_mask, position, pair, distances);
}

extern "C" __attribute__((always_inline)) uint32_t highway_brotli_short_codes_of_five(const uint8_t* bytes, uint32_t last_start,
    uint32_t ring_mask, uint32_t position, uint16_t pair, const uint32_t* distances, const uint64_t* ranked, float hopeless, uint64_t* others)
{
    return HWY_STATIC_DISPATCH(BrotliShortCodesOfFive)(bytes, last_start, ring_mask, position, pair, distances, ranked, hopeless, others);
}

// These three touch up to `end + 3` numbers of `costs`, of three rows of `nodes`, and of the tables by length that they take.
extern "C" __attribute__((always_inline)) void highway_brotli_try_lengths(float* costs, uint32_t* nodes, size_t stride, size_t length,
    size_t end, const float* extra_bits, const float* symbol_costs, float base, uint32_t distance, uint32_t insert)
{
    HWY_STATIC_DISPATCH(BrotliTryLengths)(costs, nodes, stride, length, end, extra_bits, symbol_costs, base, distance, insert);
}

extern "C" __attribute__((always_inline)) size_t highway_brotli_try_lengths_at_cost(float* costs, uint32_t* nodes, size_t stride,
    size_t length, size_t end, float cost, uint32_t distance, uint32_t insert)
{
    return HWY_STATIC_DISPATCH(BrotliTryLengthsAtCost)(costs, nodes, stride, length, end, cost, distance, insert);
}

// `length` is below `end`.
extern "C" __attribute__((always_inline)) void highway_brotli_try_matches(float* costs, uint32_t* nodes, size_t stride, size_t length,
    size_t end, const float* extra_bits, const uint64_t* matches, size_t count, const float* distance_costs, const float* symbol_costs,
    float base, uint32_t insert, const float* symbol_costs2, float base2, uint32_t insert2)
{
    HWY_STATIC_DISPATCH(BrotliTryMatches)(costs, nodes, stride, length, end, extra_bits, matches, count, distance_costs, symbol_costs, base,
        insert, symbol_costs2, base2, insert2);
}
} // namespace bun
#endif
