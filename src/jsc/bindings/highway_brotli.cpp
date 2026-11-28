// The data-parallel parts of the encoder in src/brotli. All targets give the same results.

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

#include <algorithm>
#include <array>
#include <bit>
#include <iterator>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <utility>

#ifndef BUN_HIGHWAY_BROTLI_TYPES
#define BUN_HIGHWAY_BROTLI_TYPES
namespace bun::brotli {

template<class T, size_t N> using Lanes __attribute__((ext_vector_type(N))) = T;
using U8x8 = Lanes<uint8_t, 8>;
using U8x16 = Lanes<uint8_t, 16>;
using U8x32 = Lanes<uint8_t, 32>;
using U16x8 = Lanes<uint16_t, 8>;
using I16x16 = Lanes<int16_t, 16>;
using U16x16 = Lanes<uint16_t, 16>;
using U32x4 = Lanes<uint32_t, 4>;
using U32x8 = Lanes<uint32_t, 8>;
using I8x32 = Lanes<int8_t, 32>;
using I32x4 = Lanes<int32_t, 4>;
using I64x4 = Lanes<int64_t, 4>;
using I32x8 = Lanes<int32_t, 8>;

constexpr size_t kRungs = 7, kChunk = 512, kSpan = 32, kLongest = 352, kRing = 1024, kPrefetched = 24, kPad = 8;
constexpr size_t kMaxHashed = 128, kEntries = kRungs * (kChunk + kPad) + kPad + kPrefetched;

// These two are also in src/highway/brotli.rs.
struct Rung {
    uint32_t length, level, start, size_bits, next;
};

struct Chunk {
    uint32_t mask, from, to, floor, end, origin, max_distance, position_bits;
    int32_t classes[3];
};

struct Work {
    uint64_t found[kEntries];
    uint32_t slots[kEntries], entries[kEntries];
    uint32_t hashes[2][kChunk + kMaxHashed + 16];
    uint16_t seeds[2 * kEntries], below[kEntries], places[2][kChunk + 16];
    int16_t ranks[kChunk + 32];
    uint8_t bytes[kSpan + kChunk + kLongest + kSpan];
};

template<size_t N, class F> constexpr auto Tabulate(F entry)
{
    std::array<decltype(entry(0)), N> all {};
    for (size_t i = 0; i < N; i++)
        all[i] = entry(i);
    return all;
}

// The numbers of the bits that are set.
inline constexpr auto kSetBits = Tabulate<256>([](size_t bits) {
    uint64_t all = 0;
    for (size_t bit = 8; bit--;)
        all = bits >> bit & 1 ? all << 8 | bit : all;
    return all;
});

} // namespace bun::brotli
#endif

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

template<size_t kGroups>
static HWY_INLINE void FindSwitchesIn(const uint16_t* HWY_RESTRICT symbols, size_t steps, size_t stride, const uint16_t* HWY_RESTRICT costs, size_t alphabet_size,
    uint16_t switch_cost, uint16_t* HWY_RESTRICT bits)
{
    const hn::CappedTag<uint16_t, 16> d;
    constexpr size_t kLanes = hn::MaxLanes(d), kParts = 16 / kLanes;
    hn::Vec<decltype(d)> sums[kGroups * kParts];
    for (auto& sum : sums)
        sum = hn::Zero(d);
    const auto limit = hn::Set(d, switch_cost);
    for (size_t step = 0; step < steps; ++step, bits += 2 * kGroups) {
        hn::Vec<decltype(d)> added[kGroups * kParts];
        for (auto& sum : added)
            sum = hn::Zero(d);
        for (size_t i = 0; i < stride; ++i) {
            const uint16_t* row = costs + HWY_MIN(size_t { *symbols }, alphabet_size - 1) * 16 * kGroups;
            ++symbols;
            for (size_t part = 0; part < kGroups * kParts; ++part)
                added[part] = hn::Add(added[part], hn::LoadU(d, row + part * kLanes));
        }
        auto least = sums[0] = hn::Add(sums[0], added[0]);
        for (size_t part = 1; part < kGroups * kParts; ++part)
            least = hn::Min(least, sums[part] = hn::Add(sums[part], added[part]));
        least = hn::MinOfLanes(d, least);
        for (size_t group = 0; group < kGroups; ++group) {
            uint32_t switches = 0, cheapest = 0;
            for (size_t part = 0; part < kParts; ++part) {
                auto& sum = sums[group * kParts + part];
                cheapest |= hn::BitsFromMask(d, hn::Eq(sum, least)) << (part * kLanes);
                sum = hn::Min(hn::Sub(sum, least), limit);
                switches |= hn::BitsFromMask(d, hn::Eq(sum, limit)) << (part * kLanes);
            }
            bits[2 * group] = switches;
            bits[2 * group + 1] = cheapest;
        }
    }
}

static void BrotliFindSwitches(const uint16_t* HWY_RESTRICT symbols, size_t steps, size_t stride, const uint16_t* HWY_RESTRICT costs, size_t alphabet_size,
    size_t groups, uint16_t switch_cost, uint16_t* HWY_RESTRICT bits)
{
    switch (groups) {
    case 1:
        return FindSwitchesIn<1>(symbols, steps, stride, costs, alphabet_size, switch_cost, bits);
    case 2:
        return FindSwitchesIn<2>(symbols, steps, stride, costs, alphabet_size, switch_cost, bits);
    case 3:
        return FindSwitchesIn<3>(symbols, steps, stride, costs, alphabet_size, switch_cost, bits);
    default:
        return FindSwitchesIn<4>(symbols, steps, stride, costs, alphabet_size, switch_cost, bits);
    }
}

// `MAX_SYMBOLS` in src/highway/brotli.rs.
static constexpr size_t kMaxSymbols = 704;

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

static HWY_INLINE uint32_t BrotliShortCodes(const uint8_t* HWY_RESTRICT bytes, uint32_t last_start, uint32_t ring_mask, uint32_t position,
    uint16_t pair, const uint32_t* HWY_RESTRICT distances)
{
    const hn::Full128<uint8_t> d8;
    const hn::Full128<uint16_t> d16;
    const hn::Full128<uint32_t> d32;
    const hn::Full128<int32_t> di32;
    const hn::Full128<uint64_t> d64;
    // From the farthest to the nearest position that each of the last distances stands for.
    const auto span = hn::Dup128VecFromValues(d32, 6, 6, 0, 0);
    const auto nearest = hn::Sub(hn::Add(hn::Set(d32, position), hn::ShiftRight<1>(span)), hn::LoadU(d32, distances));
    const auto start = hn::Sub(hn::And(nearest, hn::Set(d32, ring_mask)), span);
    const auto at = hn::BitCast(d64, hn::Min(start, hn::Set(d32, last_start)));
    const uint64_t low = hn::GetLane(at), high = hn::ExtractLane(at, 1);
    uint64_t near_first, near_second;
    uint16_t at_third, at_fourth;
    hwy::CopyBytes<8>(bytes + (low & 0xFFFFFFFF), &near_first);
    hwy::CopyBytes<8>(bytes + (low >> 32), &near_second);
    hwy::CopyBytes<2>(bytes + (high & 0xFFFFFFFF), &at_third);
    hwy::CopyBytes<2>(bytes + (high >> 32), &at_fourth);
    const auto nearby = hn::BitCast(d8, hn::Dup128VecFromValues(d64, near_first, near_second));
    const auto codes_from_0 = hn::TableLookupBytes(nearby, hn::Dup128VecFromValues(d8, 3, 4, 11, 12, 0, 0, 0, 0, 4, 5, 2, 3, 5, 6, 1, 2));
    const auto codes_from_8 = hn::TableLookupBytes(nearby, hn::Dup128VecFromValues(d8, 6, 7, 0, 1, 12, 13, 10, 11, 13, 14, 9, 10, 14, 15, 8, 9));
    const auto with_all = hn::InsertLane(hn::InsertLane(hn::BitCast(d16, codes_from_0), 2, at_third), 3, at_fourth);
    const auto pairs = hn::Set(d16, pair);
    const uint32_t found = hn::BitsFromMask(d8, hn::OrderedDemote2MasksTo(d8, d16, hn::Eq(with_all, pairs), hn::Eq(hn::BitCast(d16, codes_from_8), pairs)));
    const bool went_around = !hn::AllFalse(di32, hn::IsNegative(hn::BitCast(di32, start)));
    return HWY_UNLIKELY(went_around) ? 0xFFFF : found;
}

using namespace brotli;

template<class T> static HWY_INLINE T Load(const void* from)
{
    T value;
    memcpy(&value, from, sizeof(T));
    return value;
}
template<class T> static HWY_INLINE void Store(void* to, T value) { memcpy(to, &value, sizeof(T)); }
template<class T, class U> static HWY_INLINE T As(U value) { return __builtin_bit_cast(T, value); }
template<class T> static HWY_INLINE T Min(T a, T b) { return __builtin_elementwise_min(a, b); }
template<class T> static HWY_INLINE T Max(T a, T b) { return __builtin_elementwise_max(a, b); }
static HWY_INLINE uint32_t BitsOf(I32x8 mask) { return As<uint8_t>(__builtin_convertvector(mask, Lanes<bool, 8>)); }

static HWY_INLINE uint32_t Differences(const uint8_t* a, const uint8_t* b)
{
    return ~As<uint32_t>(__builtin_convertvector(Load<U8x32>(a) == Load<U8x32>(b), Lanes<bool, 32>));
}

static constexpr U32x8 kIota = { 0, 1, 2, 3, 4, 5, 6, 7 };

// Stores `first` plus the number of each bit that is set. Returns how many.
static HWY_INLINE size_t Append(uint32_t bits, uint16_t* to, U16x8 first)
{
    Store(to, __builtin_convertvector(As<U8x8>(kSetBits[bits]), U16x8) + first);
    return __builtin_popcount(bits);
}

static HWY_INLINE void HashWords(const uint8_t* bytes, size_t count, uint32_t mask, uint32_t* hashes)
{
    for (size_t i = 0; i < count; i += 8) {
        const U8x16 some = Load<U8x16>(bytes + i);
        const U32x8 words = As<U32x8>(__builtin_shufflevector(some, some, 0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6, 4, 5, 6, 7, 5, 6, 7, 8, 6, 7, 8, 9, 7, 8, 9, 10));
        // Many multiplications in a row make some CPUs lower their clock.
        U32x8 hash = words & mask;
        hash += hash << 13, hash ^= hash >> 7, hash += hash << 17, hash ^= hash >> 11, hash += hash << 9;
        Store(hashes + i, hash ^ hash >> 15);
    }
}

template<class T> static HWY_INLINE T Joined(T first, T last) { return first + (last << 13 | last >> 19); }

constexpr size_t kLevelShift = 12;

// A third of the places have level 1 or above, a fifth 2, a ninth 3, and half of that 4.
static HWY_INLINE void Mark(Work& w, size_t count)
{
    for (size_t i = 0; i < count + 8; i += 16) {
        const uint8_t* at = w.bytes + kSpan + i;
        Store(w.ranks + i, (__builtin_convertvector(Load<U8x16>(at), U16x16) | __builtin_convertvector(Load<U8x16>(at + 1), U16x16) << 8) * 0x9E37);
    }
    I16x16 place = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 };
    for (size_t i = 0; i < count; i += 16, place += 16) {
        const auto rank = [&](size_t offset) HWY_ATTR { return Load<I16x16>(w.ranks + i + offset); };
        const I16x16 middle = rank(4), left = Min(rank(2), rank(3)), right = Min(rank(5), rank(6));
        const auto is_least = [&](I16x16 left, I16x16 right) HWY_ATTR { return (middle < left) & ~(middle > right); };
        const I16x16 ninth = is_least(Min(left, Min(rank(0), rank(1))), Min(right, Min(rank(7), rank(8))));
        Store(w.places[0] + i, place - ((is_least(rank(3), rank(5)) + is_least(left, right) + ninth + (ninth & (rank(0) < rank(8)))) << kLevelShift));
    }
}

template<bool kPrefetches> static HWY_INLINE void Exchange(uint64_t* HWY_RESTRICT tables, Work& w, size_t from, size_t to)
{
#pragma unroll 4
    for (size_t i = from; i < to; i++) {
        if (kPrefetches)
            __builtin_prefetch(tables + w.slots[i + kPrefetched], 1);
        uint64_t& pair = tables[w.slots[i]];
        const uint64_t old = pair;
        w.found[i] = old;
        pair = old << 32 | w.entries[i];
    }
}

static HWY_NOINLINE void BrotliMeasureSlowly(const uint8_t* here, const uint8_t* ring, size_t size, size_t there, uint32_t& forth, uint32_t& back)
{
    if (there < kSpan || there + kSpan > size) {
        for (forth = back = 0; back < std::min(there, kSpan) && there <= size && here[~size_t { back }] == ring[there - back - 1];)
            back++;
    }
    size_t length = forth;
    for (; length < kLongest && there + length + kSpan <= size; length += kSpan) {
        if (const uint32_t differences = Differences(here + length, ring + there + length)) {
            forth = length + __builtin_ctz(differences);
            return;
        }
    }
    forth = length;
}

static HWY_NOINLINE void BrotliMeasure(const uint8_t* HWY_RESTRICT ring, size_t size, const Chunk& r, uint32_t behind, Work& w, size_t seeds, int64_t* HWY_RESTRICT starts)
{
    constexpr size_t kBatch = 128;
    alignas(32) uint32_t places[kBatch], distances[kBatch], theres[kBatch], forths[kBatch], backs[kBatch];
    alignas(32) int64_t keys[kBatch];
    const uint32_t last = std::min<size_t>(size - 2 * kSpan, UINT32_MAX);
    Store(w.seeds + seeds, U16x8(w.seeds[0]));
    for (size_t first = 0; first < seeds; first += kBatch) {
        const size_t count = std::min(kBatch, (seeds - first + 7) / 8 * 8);
#pragma unroll 4
        for (size_t i = 0; i < count; i++) {
            const size_t seed = w.seeds[first + i];
            places[i] = w.entries[seed / 2];
            distances[i] = Load<uint32_t>(reinterpret_cast<const uint8_t*>(w.found) + 4 * seed);
        }
        const auto there_at = [&](size_t i) HWY_ATTR { return (Load<U32x8>(places + i) + r.from - Load<U32x8>(distances + i)) & r.mask; };
        for (size_t i = 0; i < count; i += 8) {
            Store(places + i, (Load<U32x8>(places + i) - r.from) % kChunk);
            Store(theres + i, Min(there_at(i) - kSpan, U32x8(last)));
        }
#pragma unroll 2
        for (size_t i = 0; i < count; i++) {
            const uint8_t *here = w.bytes + places[i], *there = ring + theres[i];
            backs[i] = __builtin_clzll(2 * uint64_t { Differences(here, there) } + 1) - 31;
            forths[i] = std::countr_zero(Differences(here + kSpan, there + kSpan));
        }
        for (size_t i = 0; i < count; i += 8) {
            const U32x8 place = Load<U32x8>(places + i), distance = Load<U32x8>(distances + i), there = there_at(i);
            for (uint32_t bits = BitsOf((Load<U32x8>(forths + i) == kSpan) | (Load<U32x8>(theres + i) == last)); bits; bits &= bits - 1) {
                const size_t lane = __builtin_ctz(bits);
                BrotliMeasureSlowly(w.bytes + kSpan + places[i + lane], ring, size, there[lane], forths[i + lane], backs[i + lane]);
            }
            const U32x8 forth = Min(Load<U32x8>(forths + i), r.end - r.from - place), back = Min(Load<U32x8>(backs + i), place + behind);
            const U32x8 low = (-distance << 9) + forth + back, high = ((place + forth + (r.from - r.origin)) << 7) + As<U32x8>(As<I32x8>(-distance) >> 23);
            const U32x8 valid = high | As<U32x8>(distance > place + r.from);
            Store(keys + i, __builtin_shufflevector(low, valid, 0, 8, 1, 9, 4, 12, 5, 13));
            Store(keys + i + 4, __builtin_shufflevector(low, valid, 2, 10, 3, 11, 6, 14, 7, 15));
            const I32x8 far = As<I32x8>(distance);
            Store(theres + i, (((place + r.from - back) << 2) - As<U32x8>((far > r.classes[0]) + (far > r.classes[1]) + (far > r.classes[2]))) % (4 * kRing));
        }
        for (size_t i = 0; i < count; i += 8) {
            for (size_t k = 0; k < 8; k++) {
                int64_t& best = starts[theres[i + k / 4 * 2 + k / 2 % 2 * 4 + k % 2]];
                best = __builtin_unpredictable(keys[i + k] > best) ? keys[i + k] : best;
            }
        }
    }
}

static void BrotliFindMatches(const uint8_t* HWY_RESTRICT ring, size_t size, const Chunk& r, Rung* rungs, size_t rung_count, uint64_t* HWY_RESTRICT tables, Work& w,
    int64_t* HWY_RESTRICT starts)
{
    const size_t count = r.to - r.from, start = std::min<size_t>(r.from & r.mask, size);
    const size_t before = std::min(start, kSpan), after = std::min({ size - start, size_t { r.end - r.from }, count + kLongest + kSpan });
    memcpy(w.bytes + kSpan - before, ring + start - before, before + after);
    memset(w.bytes + kSpan + after, 0, std::min(sizeof(w.bytes) - kSpan - after, kMaxHashed + kSpan));
    Mark(w, count);

    // Where those of each rung are in the lists.
    size_t firsts[kRungs], counts[kRungs], total = kPad, hashed = 0, marked = count;
    const size_t reach = count + rungs[rung_count - 1].length;
    const uint32_t bits = r.position_bits;
    uint32_t *hashes = w.hashes[0], *spare = w.hashes[1];
    uint16_t *places = w.places[0], *next_places = w.places[1];
    for (size_t n = 0; n < rung_count; n++) {
        Rung& rung = rungs[n];
        if (hashed < 4) {
            hashed = std::min<size_t>(rung.length, 4);
            HashWords(w.bytes + kSpan, reach, ~0u >> (32 - 8 * hashed), hashes);
        }
        for (; 2 * hashed < rung.length; hashed *= 2, std::swap(hashes, spare)) {
            for (size_t i = 0; i + 2 * hashed < reach; i += 8)
                Store(spare + i, Joined(Load<U32x8>(hashes + i), Load<U32x8>(hashes + i + hashed)));
        }
        const uint32_t* last = hashes + rung.length - hashed;
        const size_t high = std::min<size_t>(count, std::max(r.end - r.from + 1, rung.length) - rung.length);
        const size_t low = std::min<size_t>(high, std::max(rung.next, r.from) - r.from);
        if (low != high)
            rung.next = r.from + high;
        const uint32_t shift = 32 - rung.size_bits, table = rung.start;
        uint32_t *slots = w.slots + total, *entries = w.entries + total;
        size_t listed = high - low;
        if (!rung.level) {
            U32x8 previous = 1;
            for (size_t i = low; i < high; i += 8) {
                const U32x8 hash = Joined(Load<U32x8>(hashes + i), Load<U32x8>(last + i));
                // The start of a run is worth more than the rest.
                Store(slots + i - low, ((hash >> shift) + table) & ~As<U32x8>(hash + !n == __builtin_shufflevector(previous, hash, 6, 7, 8, 9, 10, 11, 12, 13)));
                previous = hash;
                Store(entries + i - low, (hash << bits) + (kIota + (r.from + static_cast<uint32_t>(i))));
            }
        } else {
            uint16_t* below = w.below + total;
            while (marked && places[marked - 1] % kChunk >= high)
                marked--;
            Store(places + marked, U16x16(0));
            listed = 0;
            for (size_t i = 0; i < marked; i += 16) {
                const uint32_t bits = As<uint16_t>(__builtin_convertvector(Load<I16x16>(places + i) >= static_cast<int16_t>(rung.level << kLevelShift), Lanes<bool, 16>));
                listed += Append(bits % 256, below + listed, i);
                listed += Append(bits / 256, below + listed, i + 8);
            }
            Store(below + listed, U16x8(0));
            for (size_t i = 0; i < listed; i++) {
                const uint32_t place = (next_places[i] = places[below[i]]) % kChunk, hash = Joined(hashes[place], last[place]) * 0x9E3779B1u;
                // What is known goes to the spare slot.
                slots[i] = HWY_UNLIKELY(place < low) ? 0 : (hash >> shift) + table;
                entries[i] = (hash << bits) + r.from + place;
            }
            std::swap(places, next_places);
            marked = listed;
        }
        Store(slots + listed, U32x8(0)), Store(entries + listed, U32x8(0));
        firsts[n] = total, counts[n] = listed;
        total += listed + kPad;
    }
    memset(w.slots + total, 0, kPrefetched * sizeof(uint32_t));
    if (bits > 16)
        Exchange<true>(tables, w, kPad, total);
    else
        Exchange<false>(tables, w, kPad, total);
    if (!r.max_distance)
        return;

    size_t seeds = 0;
    const U32x8 max_distance = r.max_distance;
    for (size_t n = 0; n < rung_count; n++) {
        uint64_t* found = w.found + firsts[n];
        const uint64_t* lower = w.found + firsts[n - !!n];
        const uint32_t* entries = w.entries + firsts[n];
        const uint16_t* below = w.below + firsts[n];
        Store(found + counts[n], U32x8(0));
        U32x8 previous = 0;
        U16x8 index = 2 * firsts[n];
        const auto pick = [&](size_t i, U32x8 known) HWY_ATTR {
            const U32x4 entry = Load<U32x4>(entries + i);
            const U32x8 distance = __builtin_shufflevector(entry, entry, 0, 0, 1, 1, 2, 2, 3, 3) - Load<U32x8>(found + i);
            Store(found + i, distance);
            const U32x8 earlier = __builtin_shufflevector(previous, distance, 6, 7, 8, 9, 10, 11, 12, 13);
            previous = distance;
            const auto is_among = [&](U32x8 pairs) HWY_ATTR { return (distance == pairs) | (distance == __builtin_shufflevector(pairs, pairs, 1, 0, 3, 2, 5, 4, 7, 6)); };
            seeds += Append(BitsOf((distance <= max_distance) & ~(is_among(earlier) | is_among(known) | (distance == 0))), w.seeds + seeds, index);
            index += 8;
        };
        if (!n) {
            for (size_t i = 0; i < counts[n]; i += 4)
                pick(i, 0);
        } else if (!rungs[n].level) {
            for (size_t i = 0; i < counts[n]; i += 4)
                pick(i, Load<U32x8>(lower + i));
        } else {
            for (size_t i = 0; i < counts[n]; i += 4)
                pick(i, As<U32x8>(Lanes<uint64_t, 4> { lower[below[i]], lower[below[i + 1]], lower[below[i + 2]], lower[below[i + 3]] }));
        }
    }

    BrotliMeasure(ring, size, r, std::min<uint32_t>(r.from - r.floor, before), w, seeds, starts);
}

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
HWY_EXPORT(BrotliFindSwitches);
HWY_EXPORT(BrotliFindMatches);
HWY_EXPORT(BrotliSortLeaves);

// For 1 to 4 `groups`. Reads `steps * stride` symbols and `alphabet_size * groups * 16` costs, writes `steps * groups * 2` numbers.
extern "C" void highway_brotli_find_switches(const uint16_t* symbols, size_t steps, size_t stride, const uint16_t* costs, size_t alphabet_size, size_t groups, uint16_t switch_cost, uint16_t* bits)
{
    BUN_HWY_DISPATCH(BrotliFindSwitches)(symbols, steps, stride, costs, alphabet_size, groups, switch_cost, bits);
}

// Touches less than `count + 16` elements of both. `count` is at most 704.
extern "C" bool highway_brotli_sort_leaves(const uint64_t* leaves, size_t count, bool like_shell_sort, uint64_t* sorted)
{
    return BUN_HWY_DISPATCH(BrotliSortLeaves)(leaves, count, like_shell_sort, sorted);
}

// Reads up to `last_start + 8` bytes.
extern "C" __attribute__((always_inline)) uint32_t highway_brotli_short_codes(const uint8_t* bytes, uint32_t last_start, uint32_t ring_mask,
    uint32_t position, uint16_t pair, const uint32_t* distances)
{
    return HWY_STATIC_DISPATCH(BrotliShortCodes)(bytes, last_start, ring_mask, position, pair, distances);
}

using namespace brotli;
static_assert(sizeof(Work) == 8 * 11270);

// `find_matches` in src/highway/brotli.rs asserts what this takes for granted.
extern "C" void highway_brotli_find_matches(const uint8_t* ring, size_t size, const Chunk* chunk, Rung* rungs, size_t rung_count, uint64_t* tables, Work* work, int64_t* starts)
{
    BUN_HWY_DISPATCH(BrotliFindMatches)(ring, size, *chunk, rungs, rung_count, tables, *work, starts);
}

// The rest is for any target. It gets the instructions of the function that it is inlined in.
#define INLINED extern "C" __attribute__((always_inline))
using namespace HWY_STATIC_NAMESPACE;

INLINED uint32_t highway_brotli_differences(const uint8_t* a, const uint8_t* b) { return Differences(a, b); }

INLINED uint32_t highway_brotli_differences_in_case(const uint8_t* word, const uint8_t* changes, const uint8_t* bytes)
{
    const U8x32 spelling = Load<U8x32>(word), spelled = spelling ^ (As<U8x32>(As<I8x32>(spelling + (127 - 'z')) > 127 - 26) & Load<U8x32>(changes));
    return ~As<uint32_t>(__builtin_convertvector(spelled == Load<U8x32>(bytes), Lanes<bool, 32>));
}

INLINED uint32_t highway_brotli_tagged(const uint16_t* all, const uint16_t* tags)
{
    const U16x16 tag = Load<U16x16>(all) >> 2;
    return As<uint16_t>(__builtin_convertvector((tag == tags[0]) | (tag == tags[1]) | (tag == tags[2]) | (tag == tags[3]) | (tag == tags[4]), Lanes<bool, 16>));
}

INLINED void highway_brotli_lower(int32_t* costs, const int32_t* added, const int32_t* barred, const int32_t* by_context, int32_t base, int32_t is_from_first)
{
    const I32x4 bases = Load<I32x4>(by_context) + base;
    const I32x8 last = bases[3], first = last + ((__builtin_shufflevector(bases, bases, 0, 1, 2, 3, 3, 3, 3, 3) - last) & is_from_first);
    const I32x8 low = Min(Load<I32x8>(costs), (first + Load<I32x8>(added)) | Load<I32x8>(barred));
    const I32x8 high = Min(Load<I32x8>(costs + 8), (last + Load<I32x8>(added + 8)) | Load<I32x8>(barred + 8));
    Store(costs, low), Store(costs + 8, high);
}

INLINED bool highway_brotli_all_above(const int32_t* costs, int32_t limit) { return BitsOf(Load<I32x8>(costs) > limit) == 0xFF; }

INLINED int32_t highway_brotli_least_sum(const int32_t* a, const int32_t* b, const int32_t* barred)
{
    return __builtin_reduce_min(((Load<I32x8>(a) + Load<I32x8>(b)) & ~7) | As<I32x8>(kIota) | Load<I32x8>(barred));
}

INLINED uint64_t highway_brotli_spread_matches(int64_t* HWY_RESTRICT starts, int64_t* HWY_RESTRICT matches, int32_t first, int32_t enough, int32_t* HWY_RESTRICT summaries)
{
    I64x4 latest = Load<I64x4>(matches + 4 * 63);
    uint64_t are_short = 0;
    for (size_t i = 0; i < 64; i += 8) {
        I32x8 rows[8];
        for (size_t k = 0; k < 8; k++) {
            latest = Max(latest, Load<I64x4>(starts + 4 * (i + k)));
            Store(starts + 4 * (i + k), I64x4(0)), Store(matches + 4 * (i + k), latest);
            rows[k] = As<I32x8>(latest);
        }
        const auto odd = [](I32x8 a, I32x8 b) { return __builtin_shufflevector(a, b, 1, 3, 9, 11, 5, 7, 13, 15); };
        const auto even = [](I32x8 a, I32x8 b) { return __builtin_shufflevector(a, b, 0, 2, 8, 10, 4, 6, 12, 14); };
        const auto low = [](I32x8 a, I32x8 b) { return __builtin_shufflevector(a, b, 0, 1, 2, 3, 8, 9, 10, 11) >> 7; };
        const auto high = [](I32x8 a, I32x8 b) { return __builtin_shufflevector(a, b, 4, 5, 6, 7, 12, 13, 14, 15) >> 7; };
        const I32x8 a = odd(rows[0], rows[1]), b = odd(rows[2], rows[3]), c = odd(rows[4], rows[5]), d = odd(rows[6], rows[7]);
        const I32x8 lasts[4] = { low(even(a, b), even(c, d)), low(odd(a, b), odd(c, d)), high(even(a, b), even(c, d)), high(odd(a, b), odd(c, d)) };
        const I32x8 place = As<I32x8>(kIota) + (first + static_cast<int32_t>(i));
        I32x8 record = place, bits = 0;
        for (int32_t k = 0; k < 4; k++) {
            bits |= (lasts[k] > record) & (1 << 2 * k);
            record = Max(record, lasts[k]);
        }
        const I32x8 longest = record - place + 1;
        Store(summaries + i, longest << 8 | bits);
        are_short |= uint64_t { BitsOf(longest < enough) } << i;
    }
    return are_short;
}

INLINED void highway_brotli_tally(const uint32_t* old, uint32_t added, const uint32_t* signs, uint32_t mask, uint32_t* products, uint32_t* sums)
{
    // For each eighth of an octave, the slope of the chord, and above it how far below zero it starts.
    constexpr U32x8 kChords = U32x8 { 24, 28, 29, 31, 34, 35, 37, 38 } * 8 + (U32x8 { 192, 228, 238, 260, 296, 309, 337, 352 } << 16);
    const U32x8 before = Load<U32x8>(old), count = before + ((Load<U32x8>(signs) ^ added) - Load<U32x8>(signs)), positive = Max(count, U32x8(1));
    const U32x8 bits = As<U32x8>(__builtin_convertvector(As<I32x8>(positive), Lanes<float, 8>));
    const U32x8 eighth = bits >> 20 & 7, exponent = (bits >> 23) - 127;
#if HWY_ARCH_ARM_A64
    const U8x32 bytes = As<U8x32>(eighth * 0x04040404 + 0x03020100);
    const U32x8 chord = As<U32x8>(uint8x16x2_t { vqtbl2q_u8(As<uint8x16x2_t>(kChords), As<uint8x16_t>(bytes.lo)), vqtbl2q_u8(As<uint8x16x2_t>(kChords), As<uint8x16_t>(bytes.hi)) });
#else
    const U32x8 chord = { kChords[eighth[0]], kChords[eighth[1]], kChords[eighth[2]], kChords[eighth[3]], kChords[eighth[4]], kChords[eighth[5]], kChords[eighth[6]], kChords[eighth[7]] };
#endif
    const U32x8 product = ((positive & mask) * ((chord + (exponent << 7)) & 0x7FFF) - (chord >> 16 << exponent % 32)) >> 3;
    const U32x8 more = Load<U32x8>(sums) + (product - Load<U32x8>(old + 8));
    Store(products, product), Store(sums, more);
    Store(sums + 8, Load<U32x8>(sums + 8) + As<U32x8>((count == 0) - (before == 0)));
    Store(sums + 16, Max(Load<U32x8>(sums + 16), count));
}

INLINED uint32_t highway_brotli_replace_matches(int64_t* known, const int64_t* matches)
{
    const I64x4 old = Load<I64x4>(known), all = Load<I64x4>(matches);
    Store(known, all);
    return BitsOf(As<I32x8>(all == old));
}

INLINED uint32_t highway_brotli_short_code_for(int32_t distance, const int32_t* last_distances)
{
    const I32x4 differences = distance - Load<I32x4>(last_distances);
    const I32x8 low = __builtin_shufflevector(differences, differences, 0, 1, 2, 3, 0, 0, 0, 0), high = __builtin_shufflevector(differences, differences, 0, 0, 1, 1, 1, 1, 1, 1);
    return std::countr_zero(BitsOf(low == I32x8 { 0, 0, 0, 0, -1, 1, -2, 2 }) | BitsOf(high == I32x8 { -3, 3, -1, 1, -2, 2, -3, 3 }) << 8);
}

INLINED void highway_brotli_push_front(const int32_t* values, int32_t first, bool is_new, int32_t* to)
{
    const I32x4 old = Load<I32x4>(values), pushed = __builtin_shufflevector(old, I32x4(first), 4, 0, 1, 2);
    Store(to, I32x4(-is_new) ? pushed : old);
}
} // namespace bun
#endif
