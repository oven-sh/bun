// The search for matches of the higher levels of the encoder in src/zstd. All targets give the same results.

#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | HWY_NEON | HWY_NEON_BF16 | HWY_SSE4 | (HWY_AVX2 - 1))
#ifndef __OPTIMIZE__
#error "Unless hwy::ChosenTarget::GetIndex() is inlined, the linker may keep that of a file with other targets."
#endif

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_zstd_ladder.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <algorithm>
#include <array>
#include <bit>
#include <numeric>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <utility>

#ifndef BUN_ZSTD_LADDER_TYPES
#define BUN_ZSTD_LADDER_TYPES
namespace bun::zstd {

template<class T, size_t N> using Lanes __attribute__((ext_vector_type(N))) = T;
using U8x8 = Lanes<uint8_t, 8>;
using U8x16 = Lanes<uint8_t, 16>;
using U8x32 = Lanes<uint8_t, 32>;
using U16x8 = Lanes<uint16_t, 8>;
using U16x16 = Lanes<uint16_t, 16>;
using I16x16 = Lanes<int16_t, 16>;
using U32x4 = Lanes<uint32_t, 4>;
using I32x4 = Lanes<int32_t, 4>;
using U32x8 = Lanes<uint32_t, 8>;
using I32x8 = Lanes<int32_t, 8>;
using F32x8 = Lanes<float, 8>;

// See src/highway/zstd_ladder.rs, which also checks the values.
struct Rung {
    uint32_t len, spacing, log, room_log, used;
    // -1 if all positions climb on, be their bytes new or not.
    int32_t is_open;
};

struct Ladder {
    uint32_t* entries;
    Rung rungs[12];
    uint32_t count, index_bits, room, next;
    // For the length of the first rung: its minimum, in how many bytes it is up for review, and what has happened since the last one.
    uint32_t len_min, term, misses, sequences, literals, shortest, saved;
    // Of the first byte of the prefix.
    uint32_t index;
};

struct Counts {
    uint32_t literals[256], literal_lens[40], match_lens[56], offsets[32];
};

struct Request {
    const uint8_t* prefix;
    size_t end, start;
    const uint8_t* older;
    size_t older_len;
    Ladder *ladder, *attached;
    const uint32_t (*hints)[3];
    size_t hint_count;
    Counts* counts;
    uint32_t (*found)[3];
    size_t room;
    uint32_t repeats[3];
    uint32_t max_distance, nice_len, caution, patience, parser;
};

enum Parser { kBrief,
    kLinked,
    kLinkedWithRepeats,
    kLinkedExactly,
    kOptimalOfOne,
    kOptimalOfTwo,
    kOptimalOfThree };

constexpr size_t kChunk = 2048, kBehind = 320, kAhead = 320, kSpan = kBehind + kChunk + kAhead;
constexpr uint32_t kFraction = 4, kTagBits = 11, kNever = 1u << 30;
constexpr size_t kNear = 18, kLongest = 255;
// Of the exponents of floats.
constexpr size_t kBias = 127;
constexpr uint32_t kFar = (1u << 24) - (1u << 12);

struct Prices {
    // By length, from -1 for those above `kNear` on.
    alignas(64) uint32_t near[kNear + 2][16];
    uint32_t literal[256], one_more_literal[64], match_len[272], offset[3][32], cheapest_literal;
    // How much more a run of literals may have cost than a new one, which has yet to pay for getting long.
    uint32_t leeway[64 + 16];
};

struct Node {
    // The number of literals since the last match, and the recent distances, negated.
    I32x4 state;
    // 0, and the distances of the matches that can start here, negated.
    I32x4 found;
};

constexpr size_t kGuard = 16;

struct Links {
    uint32_t found_distances[kSpan], distances[kSpan], found_same[kSpan], same[kSpan];
    int16_t found_starts[kSpan], found_ends[kSpan], starts[kGuard + kSpan], ends[kSpan], repeat_starts[kSpan], repeat_ends[kSpan];
    int32_t own[kSpan], inside[kSpan + 2], before[kSpan + 2], repeat_price[kSpan], rest[kSpan];
    uint16_t last[kSpan], repeat_last[kSpan], next[kSpan];
    int32_t path_starts[2 * kSpan], path_ends[2 * kSpan], path_distances[2 * kSpan], cuts[kSpan];
    alignas(32) uint8_t match_len[32], offset[32];
    int32_t literal, first_literal, literals[256], mostly_repeats, is_exact;
};

struct Graph {
    Prices prices;
    Node nodes[kSpan];
    // By class of distances: see `Key`.
    uint32_t painted[3][kSpan];
    // Likewise: the code of the offset, the length, and where its row in `Prices::near` is.
    int32_t offers[3][kSpan];
    // What tells if long matches have to be looked at, compared to the first of `Walk::repeats`.
    int32_t alarms[kSpan], longest[kSpan];
    uint32_t arrivals[kSpan], shortest[kSpan], far[1 << 12];
    // The positions that have got to a rung, and what the one below has found.
    uint32_t climbers[kSpan], below[kSpan];
    uint32_t seeds[kSpan], distances[kSpan];
    int32_t path_starts[kSpan / 3], path_ends[kSpan / 3], path_distances[kSpan / 3];
};

struct Work {
    union {
        Links links;
        Graph graph;
    };
    uint32_t first[kSpan], attached[kSpan], slots[kSpan];
    // `Pick` compares each entry to the one before.
    uint32_t before_entries[8], entries[kSpan];
    uint32_t out[kSpan / 3][3];
    uint16_t tags[kSpan], picked[kSpan];
    uint8_t ranks[kSpan], levels[kSpan], valid[kSpan / 8], attached_valid[kSpan / 8];
};

template<size_t N, class F> constexpr auto Tabulate(F entry)
{
    std::array<decltype(entry(0)), N> all {};
    for (size_t i = 0; i < N; i++)
        all[i] = entry(i);
    return all;
}

constexpr uint8_t kLiteralBits[36] = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 };
constexpr uint8_t kMatchBits[53] = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 };
constexpr uint8_t CodeOf(const uint8_t* bits, size_t len)
{
    uint8_t code = 0;
    for (; len >> bits[code]; code++)
        len -= size_t { 1 } << bits[code];
    return code;
}
inline constexpr auto kLiteralCodes = Tabulate<64>([](size_t len) { return CodeOf(kLiteralBits, len); });
inline constexpr auto kMatchCodes = Tabulate<129>([](size_t len) { return CodeOf(kMatchBits, len); });
// The numbers of the bits that are set.
inline constexpr auto kSetBits = Tabulate<256>([](size_t bits) {
    uint64_t all = 0;
    for (size_t bit = 8; bit--;)
        all = bits >> bit & 1 ? all << 8 | bit : all;
    return all;
});

} // namespace bun::zstd
#endif

HWY_BEFORE_NAMESPACE();
namespace bun::zstd {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

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
static HWY_INLINE uint32_t Log2(uint32_t value) { return 31 ^ __builtin_clz(value); }
template<class T> static HWY_INLINE T Either(bool is, T a, T b) { return __builtin_unpredictable(is) ? a : b; }

template<class T, size_t N> static HWY_INLINE uint32_t BitsOf(Lanes<T, N> mask)
{
    using Bits = std::conditional_t<N == 32, uint32_t, std::conditional_t<N == 16, uint16_t, uint8_t>>;
    return As<Bits>(__builtin_convertvector(mask, Lanes<bool, N>));
}

static HWY_INLINE I32x8 Wide(const int16_t* from) { return __builtin_convertvector(Load<Lanes<int16_t, 8>>(from), I32x8); }
static HWY_INLINE void StoreNarrow(int16_t* to, I32x8 values) { Store(to, __builtin_convertvector(values, Lanes<int16_t, 8>)); }
static HWY_INLINE U32x8 Log2(I32x8 values) { return (As<U32x8>(__builtin_convertvector(values, F32x8)) >> 23) - static_cast<uint32_t>(kBias); }

// Adds the numbers of the bits that are set to `first`.
static HWY_INLINE void AppendSetBits(uint16_t*& to, uint8_t bits, U16x8 first)
{
    Store(to, __builtin_convertvector(As<U8x8>(kSetBits[bits]), U16x8) + first);
    to += __builtin_popcount(bits);
}

static HWY_INLINE uint32_t SignsOf(I32x4 values)
{
    const hn::Full128<int32_t> d;
    return hn::BitsFromMask(d, hn::IsNegative(As<hn::Vec<decltype(d)>>(values)));
}

static HWY_INLINE uint32_t Differences(const uint8_t* a, const uint8_t* b)
{
    return ~BitsOf<char, 32>(Load<U8x32>(a) == Load<U8x32>(b));
}

static HWY_INLINE size_t CommonLen(const uint8_t* a, const uint8_t* b, size_t max)
{
    size_t len = 0;
    for (; len + 32 <= max; len += 32) {
        if (const uint32_t differences = Differences(a + len, b + len))
            return len + __builtin_ctz(differences);
    }
    for (; len + 8 <= max; len += 8) {
        if (const uint64_t differences = Load<uint64_t>(a + len) ^ Load<uint64_t>(b + len))
            return len + __builtin_ctzll(differences) / 8;
    }
    while (len < max && a[len] == b[len])
        len++;
    return len;
}

static HWY_NOINLINE size_t OlderMatchLen(const Request& r, size_t at, size_t distance, size_t max)
{
    const size_t left = distance - at;
    const size_t len = CommonLen(r.prefix + at, r.older + r.older_len - left, std::min(max, left));
    return len < left ? len : len + CommonLen(r.prefix + distance, r.prefix, max - len);
}

static HWY_INLINE size_t MatchLen(const Request& r, size_t at, size_t distance, size_t max)
{
    max = std::min(max, r.end - at);
    if (HWY_UNLIKELY(distance > at))
        return OlderMatchLen(r, at, distance, max);
    return CommonLen(r.prefix + at, r.prefix + at - distance, max);
}

// Within one run.
static HWY_INLINE size_t MatchLenBefore(const Request& r, size_t at, size_t distance, size_t max)
{
    const bool is_older = distance > at;
    const size_t room = std::min(at, at - distance + (is_older ? r.older_len : 0));
    const uint8_t *a = r.prefix + at, *b = (is_older ? r.older + r.older_len : r.prefix) + static_cast<ptrdiff_t>(at - distance);
    size_t len = 0;
    for (; len < max && len + 32 <= room; len += 32) {
        if (const uint32_t differences = Differences(a - len - 32, b - len - 32))
            return std::min(max, len + __builtin_clz(differences));
    }
    max = std::min(max, room);
    while (len < max && *(a - len - 1) == *(b - len - 1))
        len++;
    return std::min(max, len);
}

// Each byte is an index below 16, or has the highest bit set.
static HWY_INLINE U32x8 LookUpOr0(const uint8_t* table, U32x8 index)
{
    const hn::CappedTag<uint8_t, 32> d;
    const auto look_up = [&](auto some) HWY_ATTR { return As<decltype(some)>(hn::TableLookupBytesOr0(hn::LoadDup128(d, table), As<hn::Vec<decltype(d)>>(some))); };
#if HWY_MAX_BYTES >= 32
    return look_up(index);
#else
    return __builtin_shufflevector(look_up(U32x4(index.lo)), look_up(U32x4(index.hi)), 0, 1, 2, 3, 4, 5, 6, 7);
#endif
}

// In 1/256 of a bit.
static HWY_INLINE U32x8 FineLog2(U32x8 values)
{
    alignas(16) static constexpr uint8_t kCurve[16] = { 0, 8, 13, 17, 19, 21, 22, 22, 21, 20, 19, 16, 14, 10, 7, 3 };
    const U32x8 linear = As<U32x8>(__builtin_convertvector(As<I32x8>(values), F32x8)) >> 15;
    return linear + LookUpOr0(kCurve, linear >> 4 & 15);
}

template<size_t N> static HWY_INLINE void BitsFor(uint32_t (&counts)[N], size_t used, uint32_t sum_log, uint32_t (&bits)[N])
{
    U32x8 sums = 0, seen = 0;
    const auto load = [&](size_t i) HWY_ATTR { return Min(Load<U32x8>(counts + i), U32x8(1 << 16)); };
    for (size_t i = 0; i < N; i += 8)
        sums += load(i), seen += Min(load(i), U32x8(1));
    const uint32_t sum = __builtin_reduce_add(sums), shift = sum >> sum_log != 0;
    const U32x8 all = FineLog2(U32x8(sum + 2 * std::min<uint32_t>(used, 8 * __builtin_reduce_add(seen) + 1)));
    for (size_t i = 0; i < N; i += 8) {
        const U32x8 some = load(i);
        Store(bits + i, Max(As<I32x8>(all - FineLog2(some + 2)), I32x8(0)));
        Store(counts + i, (some + shift) >> shift);
    }
}

template<class T> static HWY_INLINE T Rounded(T bits) { return (bits + (128 >> kFraction)) >> (8 - kFraction) << kTagBits; }

// A few literals are not worth a table.
static HWY_INLINE uint32_t LiteralBitsMin(const Request& r) { return 8 * 256 - std::min<size_t>(6 * (r.end - r.start), 7 * 256); }

static HWY_NOINLINE void BitsFor(const Request& r, size_t at, Counts& bits)
{
    constexpr uint32_t kSumLog = 13;
    Counts& counts = *r.counts;
    BitsFor(counts.literals, 256, kSumLog + (r.parser >= kOptimalOfOne), bits.literals);
    BitsFor(counts.literal_lens, 36, kSumLog, bits.literal_lens);
    BitsFor(counts.match_lens, 53, kSumLog, bits.match_lens);
    BitsFor(counts.offsets, 32, kSumLog, bits.offsets);
    // What has only just come within reach is going to be used like what is below.
    const auto code_for = [&](size_t end) HWY_ATTR { return Log2(std::min<size_t>(end + r.older_len, r.max_distance) + 3); };
    for (uint32_t code = std::max(code_for(at), 6u) - 1, last = code_for(r.end); code <= last; code++)
        bits.offsets[code] = std::min(bits.offsets[code], bits.offsets[code - 1] + 49);
    // Or else matches are cut short just because those before were.
    for (size_t code = 15; code-- > 1;)
        bits.literal_lens[code] = std::min(bits.literal_lens[code], bits.literal_lens[code + 1] + 192);
    for (size_t code = 40; code > 0; code -= 8)
        Store(bits.match_lens + code - 7, Min(Load<U32x8>(bits.match_lens + code - 7), (Load<U32x8>(bits.match_lens + code - 8) << 2) + (code == 8 ? 640 : 512)));
}

static HWY_NOINLINE void Derive(const Request& r, Prices& prices, size_t at)
{
    Counts bits;
    BitsFor(r, at, bits);
    U32x8 cheapest = kNever;
    for (size_t i = 0; i < 256; i += 8) {
        const U32x8 price = Rounded(Min(Max(Load<U32x8>(bits.literals + i), U32x8(LiteralBitsMin(r))), U32x8(11 * 256)));
        Store(prices.literal + i, price);
        cheapest = Min(cheapest, price);
    }
    prices.cheapest_literal = __builtin_reduce_min(cheapest);

    uint32_t at_least[40] = {};
    for (size_t code = 36; code--;)
        at_least[code] = at_least[code + 1] + r.counts->literal_lens[code] + 2;
    for (size_t code = 0; code < 32; code += 8)
        Store(at_least + code, FineLog2(Load<U32x8>(at_least + code)));
    memset(prices.one_more_literal, 0, sizeof(prices.one_more_literal));
    uint32_t before = Rounded(bits.literal_lens[0]);
    for (size_t code = 1, len = 1; len < 64; len += size_t { 1 } << kLiteralBits[code++]) {
        const int32_t all = bits.literal_lens[code] + 256 * kLiteralBits[code], price = Rounded(all);
        const I32x8 leeway = Rounded(static_cast<int32_t>(all + at_least[code] - bits.literal_lens[1] - at_least[1]) / 2);
        Store(prices.leeway + len - 1, leeway), Store(prices.leeway + len + 7, leeway), prices.leeway[63] = leeway[0];
        prices.one_more_literal[len - 1] = price - before;
        before = price;
    }

    const U32x8 iota = { 0, 1, 2, 3, 4, 5, 6, 7 };
    for (uint32_t code = 0; code < 32; code += 8)
        Store(prices.match_len + 3 + code, Rounded(Load<U32x8>(bits.match_lens + code)) | (iota + 3 + code) << 3);
    for (uint32_t code = 32, len = 35; len <= kLongest; code++) {
        const uint32_t price = Rounded(bits.match_lens[code] + 256 * kMatchBits[code]), end = len + (1u << kMatchBits[code]);
        for (; len < end; len += 8)
            Store(prices.match_len + len, price | (iota + len) << 3);
        len = end;
    }
    const U32x8 low = Load<U32x8>(prices.match_len + 3), high = Load<U32x8>(prices.match_len + 11);
    for (uint32_t row = 0; row < kNear + 2; row++) {
        Store(prices.near[row], iota + 3 <= row - 1 ? low : kNever);
        Store(prices.near[row] + 8, iota + 11 <= row - 1 ? high : kNever);
    }

    for (uint32_t code = 0; code < 32; code += 8) {
        const U32x8 price = Rounded(Load<U32x8>(bits.offsets + code) + ((iota + code) << 8) + bits.literal_lens[0] + 30);
        for (uint32_t kind = 0; kind < 3; kind++)
            Store(prices.offset[kind] + code, price | kind);
    }
}

// Of two vectors, stores the lanes for which a bit is set. Returns how many.
static HWY_INLINE size_t Append(uint32_t bits, uint32_t* to_a, U32x8 a, uint32_t* to_b, U32x8 b)
{
#if HWY_MAX_BYTES >= 32
    const hn::Full256<uint32_t> d;
    using V = hn::Vec<decltype(d)>;
    const auto lanes = hn::IndicesFromVec(d, As<V>(__builtin_convertvector(As<U8x8>(kSetBits[bits]), U32x8)));
    hn::StoreU(hn::TableLookupLanes(As<V>(a), lanes), d, to_a);
    hn::StoreU(hn::TableLookupLanes(As<V>(b), lanes), d, to_b);
#else
    alignas(16) static constexpr auto kBytes = Tabulate<256>([](size_t i) { return static_cast<uint8_t>((kSetBits[i / 16] >> i / 4 % 4 * 8 & 3) * 4 + i % 4); });
    const hn::Full128<uint8_t> d;
    using V = hn::Vec<decltype(d)>;
    const V low = hn::Load(d, &kBytes[bits % 16 * 16]), high = hn::Load(d, &kBytes[bits / 16 * 16]);
    const size_t half = __builtin_popcount(bits % 16);
    Store(to_a, hn::TableLookupBytes(As<V>(a.lo), low)), Store(to_a + half, hn::TableLookupBytes(As<V>(a.hi), high));
    Store(to_b, hn::TableLookupBytes(As<V>(b.lo), low)), Store(to_b + half, hn::TableLookupBytes(As<V>(b.hi), high));
#endif
    return __builtin_popcount(bits);
}

static HWY_INLINE U32x8 WordsAt(const uint8_t* at)
{
    const U8x16 bytes = Load<U8x16>(at);
    return As<U32x8>(__builtin_shufflevector(bytes, bytes, 0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 5, 3, 4, 5, 6, 4, 5, 6, 7, 5, 6, 7, 8, 6, 7, 8, 9, 7, 8, 9, 10));
}

// What a search of up to `kChunk` positions has in common. Arrays of `Work` start with the position `origin`.
struct Chunk {
    const Request& r;
    Work& w;
    size_t origin;
    // No match starts before.
    size_t start;
    size_t far_count;
    uint32_t best;
    // Above which distances the second and the third class start.
    int32_t classes[2];
};

// How far back matches of 3 bytes are worth it.
constexpr uint32_t kShortestLog = 18;

static HWY_INLINE uint32_t ReachOf(const Request& r, const Ladder& ladder, const Rung& rung)
{
    return std::min(r.max_distance, 1u << (rung.len == 3 ? kShortestLog : ladder.index_bits - 1));
}

constexpr uint32_t kCachedLog = 16;
constexpr size_t kPrefetched = 24;

// Whether four slots share their entries, which takes less room.
static HWY_INLINE bool Shares(const Ladder& ladder, const Rung& rung) { return rung.log > kCachedLog && &rung != ladder.rungs; }

// Doubles a table that is filling up. The highest bits of a hash tell the place, so an entry goes to both that may be right.
static HWY_INLINE void Grow(const Ladder& ladder, Rung& rung, uint32_t* table, size_t added)
{
    rung.used = std::min<size_t>(rung.used + added, 1u << 28);
    for (; rung.log < rung.room_log && rung.used / 4 * (rung.log > kCachedLog ? ladder.room : 16) >> rung.log; rung.log++) {
        for (size_t i = size_t { 1 } << rung.log; i; i -= 4) {
            const U32x4 four = Load<U32x4>(table + i - 4);
            Store(table + 2 * i - 8, Shares(ladder, rung) ? four.s01230123 : four.s00112233);
        }
    }
}

// Returns the entry for the same bytes, or else the one that has to go.
template<bool kStores, bool kShares>
static HWY_INLINE uint32_t Swap(uint32_t* slot, const uint32_t* entry, U32x4 far)
{
    if (!kShares) {
        const uint32_t old = *slot;
        if (kStores)
            *slot = *entry;
        return old;
    }
    alignas(64) static constexpr auto kToFront = Tabulate<256>([](size_t i) {
        const size_t found = std::countr_zero(i / 16 | 8), lane = i / 4 % 4;
        return static_cast<uint8_t>(4 * (lane ? lane - (lane <= found) : found) + i % 4);
    });
    const hn::Full128<uint8_t> d;
    const U32x4 fresh = *entry, four = Load<U32x4>(slot);
    const size_t found = SignsOf(((fresh - four) & far) == 0);
    const U32x4 sorted = As<U32x4>(hn::TableLookupBytes(As<hn::Vec<decltype(d)>>(four), hn::Load(d, &kToFront[16 * found])).raw);
    if (kStores)
        Store(slot, __builtin_shufflevector(fresh, sorted, 0, 5, 6, 7));
    return sorted[0];
}

// For each of `count` slots, replaces the entry by how much it is above the one in the table.
template<bool kStores, bool kShares>
static HWY_NOINLINE void Exchange(uint32_t* table, uint32_t far, uint32_t* slots, uint32_t* entries, size_t count)
{
    memset(slots + count, 0, kPrefetched * sizeof(*slots));
    for (size_t i = 0; i < count; i++) {
        __builtin_prefetch(table + slots[i + kPrefetched]);
        slots[i] = Swap<kStores, kShares>(table + slots[i], entries + i, far);
    }
    for (size_t i = 0; i < count; i++)
        entries[i] -= slots[i];
}

constexpr uint32_t kFirstFactor = 0x9E3779B1, kLastFactor = 0x85EBCA6A, kWeakBits = 3;

// For all positions, looks up how far back the same bytes were last, and if that is plausible.
template<bool kIsShort, bool kStores, bool kPrefetches>
static HWY_NOINLINE void IndexAll(const Request& r, uint32_t index, const Rung& rung, uint32_t* table, uint32_t index_bits, uint32_t reach, size_t from, size_t to, uint32_t* found, uint8_t* valid)
{
    constexpr size_t kRing = 32, kRead = 24;
    alignas(64) uint32_t slots[kRing], entries[kRing];
    const uint32_t shift = 32 - rung.log, factor = kFirstFactor << (kIsShort ? 32 - 8 * rung.len : 0), weak = rung.len == 3 ? 8 : kWeakBits;
    const size_t last = rung.len - 4, count = to - from;
    U32x8 indices = U32x8 { 0, 1, 2, 3, 4, 5, 6, 7 } + (index + static_cast<uint32_t>(from));
    const auto hash = [&](size_t i, const uint8_t* at) HWY_ATTR {
        U32x8 hashes = WordsAt(at) * factor;
        if (!kIsShort)
            hashes += WordsAt(at + last) * kLastFactor;
        Store(slots + i % kRing, hashes >> shift);
        Store(entries + i % kRing, (hashes >> weak << index_bits) + indices);
        indices += 8;
    };
    const auto exchange = [&](size_t i, size_t some) HWY_ATTR {
        const uint32_t *slot = slots + i % kRing, *entry = entries + i % kRing, *soon = slots + (i + kRing - 16) % kRing;
        U32x8 old = 0;
        for (size_t j = 0; j < 8; j++) {
            if (kPrefetches)
                __builtin_prefetch(table + soon[j]);
            old[j] = j < some ? table[slot[j]] : entry[j];
            if (kStores && j < some)
                table[slot[j]] = entry[j];
        }
        const U32x8 distance = Load<U32x8>(entry) - old;
        Store(found + i, distance);
        valid[i / 8] = BitsOf<int, 8>(distance - 1 < reach);
    };
    const size_t safe = std::max(r.end, from + kRead) - kRead - from;
    uint8_t padded[kRing + 2 * kRead] = {};
    memcpy(padded, r.prefix + from + safe, r.end - from - safe);
    const auto bytes = [&](size_t i) HWY_ATTR { return HWY_LIKELY(i < safe) ? r.prefix + from + i : padded + (i - safe); };
    for (size_t i = 0; i < kRing - 8; i += 8)
        hash(i, bytes(i));
    size_t i = 0;
    for (; i + 8 <= count; i += 8) {
        hash(i + kRing - 8, bytes(i + kRing - 8));
        asm("" : "+m"(slots), "+m"(entries));
        exchange(i, 8);
    }
    exchange(i, count - i);
}

// Returns about how many are valid.
static HWY_INLINE size_t IndexAll(const Request& r, const Ladder& ladder, Rung& rung, uint32_t* table, bool stores, uint32_t reach, size_t from, size_t to, uint32_t* found, uint8_t* valid)
{
    const bool is_short = rung.len <= 4;
    const auto index = !stores  ? is_short ? IndexAll<true, false, true> : IndexAll<false, false, true>
        : rung.log > kCachedLog ? is_short ? IndexAll<true, true, true> : IndexAll<false, true, true>
        : is_short              ? IndexAll<true, true, false>
                                : IndexAll<false, true, false>;
    const size_t count = std::max(from, std::min(to, r.end + 1 - rung.len)) - from;
    index(r, ladder.index, rung, table, rung.len == 3 ? kShortestLog + 1 : ladder.index_bits, reach, from, from + count, found, valid);
    std::fill(found + count, found + (to + 8 - from), 0);
    valid[count / 8 + 1] = 0;
    size_t hits = 0;
    for (size_t i = 0; i + 64 <= count; i += 64)
        hits += std::popcount(Load<uint64_t>(valid + i / 8));
    if (stores)
        Grow(ladder, rung, table, count - hits);
    return hits;
}

constexpr uint32_t kMarkShift = 12, kPlace = (1u << kMarkShift) - 1;

// Marks a third, a fifth and a ninth of the positions by what follows them.
static HWY_NOINLINE void Mark(const Chunk& c, size_t from, size_t to)
{
    using I8x32 = Lanes<int8_t, 32>;
    uint8_t* ranks = c.w.ranks;
    for (size_t i = 0; from + i < to + 8; i += 32) {
        const uint8_t* at = c.r.prefix + from + i;
        uint8_t padded[33];
        if (HWY_UNLIKELY(from + i + 33 > c.r.end)) {
            memset(padded, 0, sizeof(padded));
            memcpy(padded, at, std::max(c.r.end, from + i) - (from + i));
            at = padded;
        }
        const U8x32 first = Load<U8x32>(at), mixed = first + first + first + Load<U8x32>(at + 1);
        Store(ranks + i, mixed ^ mixed << 4);
    }
    for (size_t i = 0; from + i < to; i += 32) {
        const auto rank = [&](size_t offset) HWY_ATTR { return Load<I8x32>(ranks + i + offset); };
        const I8x32 middle = rank(4), left = Min(rank(2), rank(3)), right = Min(rank(5), rank(6));
        const auto is_least = [&](I8x32 left, I8x32 right) HWY_ATTR { return (middle < left) & ~(middle > right); };
        Store(c.w.levels + i, -(is_least(rank(3), rank(5)) + is_least(left, right) + is_least(Min(left, Min(rank(0), rank(1))), Min(right, Min(rank(7), rank(8))))));
    }
}

template<class F> static HWY_INLINE void WithKeyOf(const Rung& rung, F run)
{
    constexpr uint64_t kFactor = 0x9E3779B97F4A7C15u;
    const size_t last = rung.len - 8;
    if (rung.len <= 8)
        run([unused = 64 - 8 * rung.len](const uint8_t* at) HWY_ATTR { return Load<uint64_t>(at) << unused; });
    else if (last <= 8)
        run([=](const uint8_t* at) HWY_ATTR { return Load<uint64_t>(at) * kFactor + Load<uint64_t>(at + last); });
    else
        run([=](const uint8_t* at) HWY_ATTR {
            uint64_t sum = Load<uint64_t>(at + last);
            for (size_t offset = 8; offset < last; offset += 8)
                sum = std::rotl(sum, 11) + Load<uint64_t>(at + offset);
            return Load<uint64_t>(at) * kFactor + sum;
        });
}

template<bool kExchanges, class T>
static HWY_NOINLINE void HashSome(const Chunk& c, const Ladder& ladder, const Rung& rung, uint32_t* table, const T* places, size_t count)
{
    Work& w = c.w;
    const uint8_t* bytes = c.r.prefix + static_cast<ptrdiff_t>(c.origin);
    const uint32_t shift = 64 - rung.log, tag_mask = ~0u << ladder.index_bits, index = ladder.index + static_cast<uint32_t>(c.origin);
    const uint32_t shared = rung.log > kCachedLog ? ~3u : ~0u;
    WithKeyOf(rung, [&](auto key) HWY_ATTR {
        for (size_t i = 0; i < count; i++) {
            const size_t at = sizeof(T) == 2 ? places[i] : places[i] & kPlace;
            const uint64_t hash = key(bytes + at) * 0xC2B2AE3D27D4EB4Fu;
            const uint32_t entry = (static_cast<uint32_t>(std::rotr(hash, 10)) & tag_mask) + index + static_cast<uint32_t>(at);
            if (kExchanges)
                w.entries[i] = entry - std::exchange(table[hash >> shift], entry);
            else
                w.slots[i] = hash >> shift & shared, w.entries[i] = entry;
        }
    });
}

// Leaves the distances in `entries`.
template<class T>
static HWY_INLINE void IndexSome(const Chunk& c, const Ladder& ladder, const Rung& rung, uint32_t* table, bool stores, const T* places, size_t& count, size_t to)
{
    const size_t read = std::max(rung.len, 8u), end = std::min(to, std::max(c.r.end + 1, read) - read);
    while (count && c.origin + (places[count - 1] & kPlace) >= end)
        count--;
    if (stores && rung.log <= kCachedLog)
        return HashSome<true>(c, ladder, rung, table, places, count);
    HashSome<false>(c, ladder, rung, table, places, count);
    (stores ? Exchange<true, true> : rung.log > kCachedLog ? Exchange<false, true>
                                                           : Exchange<false, false>)(table, ~0u << (ladder.index_bits - 1), c.w.slots, c.w.entries, count);
}

constexpr size_t kBack = 8, kForth = 24;

// Lists the new distances as seeds, whose number it returns, and who climbs on.
template<bool kIsFirst, bool kHasOlder>
static HWY_NOINLINE size_t Pick(const Chunk& c, uint32_t reach, uint32_t spacing, uint32_t first, const uint32_t* found, size_t& count, int32_t& is_open, size_t& misses)
{
    const int32_t all = is_open;
    Work& w = c.w;
    const uint32_t origin = c.origin, older_len = c.r.older_len, start = c.start - c.origin;
    const int32_t last = std::min<ptrdiff_t>(c.r.end - kForth - c.origin, kSpan), least = (spacing << kMarkShift) - 1;
    const int32_t second = c.classes[0], third = c.classes[1];
    size_t seeds = 0, climbers = 0, hits = 0;
    U32x8 place = U32x8 { 0, 1, 2, 3, 4, 5, 6, 7 } + first;
    const auto pick = [&](size_t i, uint32_t exist) HWY_ATTR {
        const U32x8 mark = kIsFirst ? __builtin_convertvector(Load<U8x8>(w.levels + i), U32x8) << kMarkShift | place : Load<U32x8>(w.graph.climbers + i);
        const U32x8 distance = Load<U32x8>(found + i);
        const U32x8 at = Max(kIsFirst ? place : mark & kPlace, U32x8(start)), room = at + (origin + older_len);
        place += 8;
        const I32x8 is_valid = distance <= Min(room, U32x8(reach));
        hits += __builtin_popcount(BitsOf<int, 8>(is_valid) & exist);
        I32x8 is_old = (distance == Load<U32x8>(found + i - 1)) | (distance == 0);
        if (!kIsFirst)
            is_old |= distance == Load<U32x8>(w.graph.below + i);
        I32x8 is_special = (distance > Min(Max(room, U32x8(kBack)) - kBack, U32x8(kFar - 1))) | (As<I32x8>(at) > last);
        if (kHasOlder)
            is_special |= (at + origin < kBack) | (at + origin - distance + (kForth - 1) < kForth + kBack - 1);
        const I32x8 lane = As<I32x8>(at | at << 16) + ((As<I32x8>(distance) > second) & kSpan) + ((As<I32x8>(distance) > third) & kSpan);
        seeds += Append(BitsOf<int, 8>(is_valid & ~is_old) & exist, w.graph.seeds + seeds, As<U32x8>(lane ^ is_special), w.graph.distances + seeds, distance);
        climbers += Append(BitsOf<int, 8>((is_valid | all) & (As<I32x8>(mark) > least)) & exist, w.graph.climbers + climbers, mark, w.graph.below + climbers, distance);
    };
    size_t i = 0;
    for (; i + 8 <= count; i += 8)
        pick(i, 0xFF);
    pick(i, (1u << (count - i)) - 1);
    is_open = -(hits * 2 >= count);
    misses = count - hits, count = climbers;
    return seeds;
}

static HWY_INLINE uint32_t Key(Chunk& c, uint32_t len, uint32_t distance)
{
    if (HWY_UNLIKELY(distance >= kFar)) {
        if (c.far_count == std::size(c.w.graph.far) - 1)
            return 0;
        c.w.graph.far[c.far_count] = distance;
        distance = kFar + c.far_count++;
    }
    return ((len + 1) << 24) - distance;
}

// Notes where the matches start that go through the seeds. If it `stops` at a long one, returns its seed.
template<bool kHasOlder, bool kPrefetches>
static HWY_NOINLINE size_t Measure(Chunk& c, size_t count, bool stops)
{
    constexpr size_t kSoon = 12;
    const Request& r = c.r;
    Work& w = c.w;
    uint32_t *keys = w.entries, *lanes = w.slots;
    uint16_t* unfinished = w.tags;
    const uint8_t* bytes = r.prefix + static_cast<ptrdiff_t>(c.origin) - kBack;
    const ptrdiff_t gap = r.older + r.older_len - r.prefix;
    const auto source = [=, prefix = r.prefix](const uint8_t* at, size_t distance) HWY_ATTR {
        return at - distance + (kHasOlder ? Either<ptrdiff_t>(static_cast<size_t>(at - prefix) < distance, gap, 0) : 0);
    };
    for (size_t i = 0; i < count; i++) {
        if (kPrefetches)
            __builtin_prefetch(source(bytes + (w.graph.seeds[i + kSoon] >> 16), w.graph.distances[i + kSoon]) + kBack);
        const uint32_t seed = w.graph.seeds[i];
        keys[i] = HWY_UNLIKELY(static_cast<int32_t>(seed) < 0) ? ~0u : ~Differences(bytes + (seed >> 16), source(bytes + (seed >> 16), w.graph.distances[i]));
    }
    U16x8 number = 0;
    for (size_t i = 0; i < count; i += 8, number += 8) {
        const U32x8 same = Load<U32x8>(keys + i), forth = same >> kBack;
        const I32x8 seed = Load<I32x8>(w.graph.seeds + i), is_special = seed >> 31;
        const U32x8 start = Log2(As<I32x8>((~same & 0xFF) * 2 + 1)), len = Log2(As<I32x8>(~forth & (forth + 1)));
        Store(w.graph.seeds + i, seed ^ is_special);
        Store(lanes + i, (As<U32x8>(seed ^ is_special) & 0xFFFF) + start - static_cast<uint32_t>(kBack));
        Store(keys + i, (((len - start + static_cast<uint32_t>(kBack + 1)) << 24) - Load<U32x8>(w.graph.distances + i)) & ~As<U32x8>(is_special));
        AppendSetBits(unfinished, BitsOf<int, 8>((start == 0) | (len == kForth)), number);
    }
    while (unfinished != w.tags && unfinished[-1] >= count)
        unfinished--;
    size_t stop = ~size_t { 0 }, long_distance = 0, long_end = 0;
    for (const uint16_t* it = w.tags; it != unfinished; it++) {
        const size_t i = *it, at = c.origin + (w.graph.seeds[i] >> 16), distance = w.graph.distances[i];
        if (distance == long_distance && at < long_end)
            continue;
        const size_t len = MatchLen(r, at, distance, kLongest - kBack);
        const size_t back = MatchLenBefore(r, at, distance, std::min(kLongest - len, at - c.start));
        long_distance = distance, long_end = at + len;
        lanes[i] = (w.graph.seeds[i] & 0xFFFF) - back;
        keys[i] = Key(c, len + back, distance);
        if (HWY_UNLIKELY(len == kLongest - kBack) && stops) {
            stop = at, count = i + 1;
            break;
        }
    }
    uint32_t* painted = w.graph.painted[0];
    for (size_t i = 0; i < count; i++)
        painted[lanes[i]] = std::max(painted[lanes[i]], keys[i]);
    for (size_t i = 0; i < count; i++)
        c.best = std::max(c.best, keys[i]);
    return stop;
}

// Turns what a rung has found into keys for matches of its length, unchecked.
static HWY_NOINLINE void Trust(const Chunk& c, uint32_t reach, size_t from, size_t to)
{
    U32x8 room = U32x8 { 0, 1, 2, 3, 4, 5, 6, 7 } + static_cast<uint32_t>(from + c.r.older_len);
    for (uint32_t* found = c.w.graph.shortest + (from - c.origin); from < to; from += 8, found += 8, room += 8) {
        const U32x8 distance = Load<U32x8>(found);
        Store(found, ((4u << 24) - distance) & As<U32x8>(distance - 1 < Min(room, U32x8(reach))));
    }
}

// Spreads the matches over the positions that they cover.
template<size_t kClasses>
static HWY_NOINLINE void Spread(const Chunk& c, size_t from, size_t to)
{
    Graph& g = c.w.graph;
    const auto shorter = [](U32x8 keys, U32x8 by) HWY_ATTR { return As<U32x8>(__builtin_elementwise_sub_sat(As<U8x32>(keys), As<U8x32>(by << 24))); };
    const U32x8 zero = 0, iota = { 1, 2, 3, 4, 5, 6, 7, 8 };
    U32x8 carried[kClasses] = {};
    for (size_t i = from; i < to; i += 8) {
        U32x8 negated[3] = {}, fresh = 0;
        I32x8 longest = 0;
        for (size_t kind = 0; kind < kClasses; kind++) {
            U32x8 keys = Load<U32x8>(g.painted[kind] + i);
            fresh = Max(fresh, keys);
            keys = Max(keys, shorter(__builtin_shufflevector(keys, zero, 8, 0, 1, 2, 8, 4, 5, 6), 1));
            keys = Max(keys, shorter(__builtin_shufflevector(keys, zero, 8, 8, 0, 1, 8, 8, 4, 5), 2));
            keys = Max(keys, shorter(keys.s33333333, U32x8 { 255, 255, 255, 255, 1, 2, 3, 4 }));
            keys = Max(keys, shorter(carried[kind], iota));
            carried[kind] = keys.s77777777;
            if (kind == 0)
                keys = Max(keys, Load<U32x8>(g.shortest + i));
            negated[kind] = keys | 0xFF000000u;
            const U32x8 code = As<U32x8>(__builtin_convertvector(3 - As<I32x8>(negated[kind]), F32x8)) >> 23;
            const I32x8 len = As<I32x8>(keys >> 24);
            Store(g.offers[kind] + i, code | As<U32x8>(len << 8 | (len | (len > int { kNear })) << 22));
            longest = Max(longest, len);
        }
        Store(g.longest + i, longest);
        Store(g.alarms + i, (~(longest > int { kNear }) & INT32_MIN) | ((As<I32x8>(fresh >> 24) > int { kNear }) & INT32_MAX));
        const U32x8 low = __builtin_shufflevector(zero, negated[0], 0, 8, 1, 9, 4, 12, 5, 13), high = __builtin_shufflevector(zero, negated[0], 2, 10, 3, 11, 6, 14, 7, 15);
        const U32x8 low2 = __builtin_shufflevector(negated[1], negated[2], 0, 8, 1, 9, 4, 12, 5, 13), high2 = __builtin_shufflevector(negated[1], negated[2], 2, 10, 3, 11, 6, 14, 7, 15);
        const auto put = [&](size_t at, U32x8 both) HWY_ATTR { g.nodes[at].found = As<I32x4>(both.lo), g.nodes[at + 4].found = As<I32x4>(both.hi); };
        put(i, __builtin_shufflevector(low, low2, 0, 1, 8, 9, 4, 5, 12, 13));
        put(i + 1, __builtin_shufflevector(low, low2, 2, 3, 10, 11, 6, 7, 14, 15));
        put(i + 2, __builtin_shufflevector(high, high2, 0, 1, 8, 9, 4, 5, 12, 13));
        put(i + 3, __builtin_shufflevector(high, high2, 2, 3, 10, 11, 6, 7, 14, 15));
    }
    if (HWY_LIKELY(!c.far_count))
        return;
    for (size_t i = from; i < to; i++) {
        for (size_t kind = 0; kind < kClasses; kind++) {
            if (const uint32_t far = -g.nodes[i].found[kind + 1] - kFar; far < c.far_count) {
                g.nodes[i].found[kind + 1] = -g.far[far];
                g.offers[kind][i] = (g.offers[kind][i] & ~0xFF) | (kBias + Log2(g.far[far] + 3));
            }
        }
    }
}

// The state after a match of that kind from that node.
static HWY_INLINE I32x4 After(const Node* node, size_t kind)
{
    static constexpr uint32_t kLanes[8][4] = { { 4, 5, 1, 2 }, { 4, 6, 1, 2 }, { 4, 7, 1, 2 }, { 4, 4, 4, 4 }, { 4, 1, 2, 3 }, { 4, 2, 1, 3 }, { 4, 3, 1, 2 }, { 4, 4, 4, 4 } };
#if HWY_MAX_BYTES >= 32
    alignas(64) static constexpr auto kIndices = Tabulate<8>([](size_t kind) { return uint64_t { kLanes[kind][0] | kLanes[kind][1] << 8 | kLanes[kind][2] << 16 | kLanes[kind][3] << 24 }; });
    const hn::Full256<int32_t> d;
    const auto indices = hn::PromoteTo(d, hn::LoadU(hn::Full64<uint8_t>(), reinterpret_cast<const uint8_t*>(&kIndices[kind])));
    return As<I32x4>(hn::LowerHalf(hn::TableLookupLanes(hn::Load(d, reinterpret_cast<const int32_t*>(node)), hn::IndicesFromVec(d, indices))).raw);
#else
    alignas(64) static constexpr auto kIndices = Tabulate<128>([](size_t i) { return static_cast<uint8_t>(4 * kLanes[i / 16][i / 4 % 4] + i % 4); });
    const hn::Full128<uint8_t> d;
    const uint8_t* bytes = reinterpret_cast<const uint8_t*>(node);
    return As<I32x4>(hn::TwoTablesLookupLanes(d, hn::Load(d, bytes), hn::Load(d, bytes + 16), hn::SetTableIndices(d, &kIndices[16 * kind])).raw);
#endif
}

struct Match {
    size_t len, distance;
};

struct Walk {
    // The cheapest matches that end 3 to 18, 1 and 2 positions on.
    U32x8 low, high;
    I32x4 in_one, in_two;
    I32x4 price, literal_price, match_price, literal_state, match_state;
    // What can be repeated, after the distance of the match that ends here.
    I32x4 repeats;
    size_t at;

    HWY_INLINE void Arrive(Work& w, I32x4 by_match, I32x4 by_literal)
    {
        const size_t tag = static_cast<uint32_t>(by_match[0]);
        Node* node = w.graph.nodes + at;
        match_state = After(reinterpret_cast<Node*>(reinterpret_cast<uint8_t*>(node) - (tag << 2 & kLongest << 5)), tag & 7);
        const I32x4 is_match = by_literal > by_match;
        node->state = is_match ? match_state : literal_state;
        repeats = is_match ? match_state.yzww : literal_state;
        w.tags[at] = tag;
        literal_price = by_literal, match_price = by_match & -(1 << kTagBits);
        price = Min(match_price, literal_price);
    }

    HWY_INLINE void Step(Work& w, uint8_t literal)
    {
        const I32x4 by_match = in_one;
        in_one = in_two, in_two = As<I32x4>(low.s0000);
        low = __builtin_shufflevector(low, high, 1, 2, 3, 4, 5, 6, 7, 8);
        high = __builtin_shufflevector(high, U32x8(w.graph.arrivals[at + kNear + 1]), 1, 2, 3, 4, 5, 6, 7, 8);
        const uint32_t literals = Min(As<U32x4>(literal_state), U32x4(63))[0];
        const I32x4 more = literal_price + w.graph.prices.one_more_literal[literals], anew = match_price + w.graph.prices.one_more_literal[0];
        const I32x4 is_anew = more > anew + w.graph.prices.leeway[literals];
        literal_state = (is_anew ? match_state : literal_state) + I32x4 { 1, 0, 0, 0 };
        at++;
        Arrive(w, by_match, (is_anew ? anew : more) + w.graph.prices.literal[literal]);
    }
};

static HWY_INLINE void OfferLong(Work& w, size_t at, size_t len, uint32_t price)
{
    uint32_t* arrivals = w.graph.arrivals + at;
    if (price + w.graph.prices.match_len[len] >= arrivals[len])
        return;
    const auto offer = [&](size_t from) HWY_ATTR { Store(arrivals + from, Min(Load<U32x8>(arrivals + from), Load<U32x8>(w.graph.prices.match_len + from) + price)); };
    for (size_t from = kNear + 1; from + 8 <= len; from += 8)
        offer(from);
    offer(len - 7);
}

// For positions with long matches or repeats. Returns a match that is long enough to be taken right away.
template<size_t kClasses>
static HWY_NOINLINE Match Linger(const Chunk& c, Walk& walk, uint32_t hits, size_t from, size_t to)
{
    Work& w = c.w;
    const size_t at = walk.at;
    const uint32_t price = walk.price[0];
    const uint32_t follows_match = w.graph.nodes[at].state[0] == 0;
    Match repeated = {};
    for (uint32_t left = hits >> 1 & 7 >> follows_match; left; left &= left - 1) {
        const uint32_t number = __builtin_ctz(left);
        const size_t distance = -static_cast<ptrdiff_t>(walk.repeats[number + 1]), len = MatchLen(c.r, c.origin + at, distance, kLongest);
        const uint32_t base = price + (w.graph.prices.offset[0][(number + 1) / 2] | (4 + number + follows_match));
        const uint32_t* row = w.graph.prices.near[1 + std::min(len, kNear)];
        walk.low = Min(walk.low, Load<U32x8>(row) + base), walk.high = Min(walk.high, Load<U32x8>(row + 8) + base);
        if (len > kNear) {
            OfferLong(w, at, len, base);
            if (len > repeated.len)
                repeated = { len, distance };
        }
    }
    const size_t len = w.graph.longest[at];
    if (HWY_UNLIKELY(std::max(len, repeated.len) >= c.r.nice_len)) {
        size_t kind = 0;
        while ((w.graph.offers[kind][at] >> 8 & 0xFF) != len)
            kind++;
        const size_t distance = repeated.len + 2 >= len ? repeated.distance : -w.graph.nodes[at].found[kind + 1];
        const size_t whole = std::max<size_t>(MatchLen(c.r, c.origin + at, distance, c.r.end), 4), recent = -w.graph.nodes[at].state[1];
        // A literal and a repeat may go as far.
        if (!follows_match || MatchLen(c.r, c.origin + at, recent, 1) || MatchLen(c.r, c.origin + at + 1, recent, whole) + 3 < whole)
            return { whole, distance };
        walk.Step(w, c.r.prefix[c.origin + at]);
        return {};
    }
    for (size_t kind = 0; kind < kClasses; kind++) {
        if (const int32_t offer = w.graph.offers[kind][at]; offer < 0)
            OfferLong(w, at, offer >> 8 & 0xFF, price + w.graph.prices.offset[kind][(offer & 0xFF) - kBias]);
    }
    // Within a match, little happens until it ends, or one starts that goes further than those so far.
    if (follows_match && at != from) {
        const size_t most = MatchLen(c.r, c.origin + at, -static_cast<ptrdiff_t>(walk.repeats[0]), std::min(kLongest, to - at));
        if (const size_t spared = most >= len ? 2 : c.r.caution; most >= 2 * spared + 2) {
            size_t skipped = 1;
            I32x8 left = static_cast<int32_t>(std::max(len, most)) - I32x8 { 1, 2, 3, 4, 5, 6, 7, 8 };
            for (; skipped < most; skipped += 16, left -= 16) {
                const int32_t* lens = w.graph.longest + at + skipped;
                if (const uint32_t further = BitsOf<int, 8>(Load<I32x8>(lens) > left) | BitsOf<int, 8>(Load<I32x8>(lens + 8) > left - 8) << 8) {
                    skipped += __builtin_ctz(further);
                    break;
                }
            }
            skipped = std::min(skipped, most - spared);
            uint32_t* arrivals = w.graph.arrivals + at;
            arrivals[1] = walk.in_one[0], arrivals[2] = walk.in_two[0];
            Store(arrivals + 3, walk.low), Store(arrivals + 11, walk.high);
            if (arrivals += skipped; *arrivals < kNever) {
                walk.at += skipped;
                walk.in_one = arrivals[1], walk.in_two = arrivals[2];
                walk.low = Load<U32x8>(arrivals + 3), walk.high = Load<U32x8>(arrivals + 11);
                walk.Arrive(w, *arrivals, kNever);
                return {};
            }
        }
    }
    walk.Step(w, c.r.prefix[c.origin + at]);
    return {};
}

// Finds the cheapest ways from `from` to all positions up to `to`, or up to a long match, where `to` is then.
template<size_t kClasses, bool kHasOlder>
static HWY_NOINLINE Match Parse(const Chunk& c, size_t from, size_t& to, I32x4 state)
{
    Work& w = c.w;
    constexpr int32_t kFirstPrice = 1 << 24;
    std::fill(w.graph.arrivals + from, w.graph.arrivals + to + kAhead, kNever);
    w.graph.nodes[from].state = state;
    Walk walk = { kNever, kNever, kNever, kNever, kFirstPrice, kFirstPrice, kNever, state, state, state[0] ? state : state.yzww, from };
    walk.repeats[0] = INT32_MIN;
    const uint8_t* bytes = c.r.prefix + static_cast<ptrdiff_t>(c.origin);
    const uint8_t* rows = reinterpret_cast<const uint8_t*>(w.graph.prices.near[1]);
    const size_t last = std::min(to, c.r.end - 3 - c.origin);
    while (walk.at < last) {
        U32x8 low = ~0u, high = ~0u;
        for (size_t kind = 0; kind < kClasses; kind++) {
            const uint8_t* offer = reinterpret_cast<const uint8_t*>(w.graph.offers[kind] + walk.at);
            const U32x8 base = w.graph.prices.offset[kind][*offer - kBias];
            const uint8_t* row = rows + Load<int16_t>(offer + 2);
            const U32x8 a = Load<U32x8>(row) + base, b = Load<U32x8>(row + 32) + base;
            low = Min(low, a), high = Min(high, b);
        }
        const U32x8 price = As<U32x4>(walk.price).s01230123;
        walk.low = Min(walk.low, low + price), walk.high = Min(walk.high, high + price);

        int32_t repeats[4];
        Store(repeats, walk.repeats);
        asm("" : "+m"(repeats));
        const uint8_t* before = bytes + walk.at - 1;
        const auto word = [&](ptrdiff_t offset) HWY_ATTR {
            if (!kHasOlder)
                return Load<int32_t>(before + offset);
            const ptrdiff_t position = before - c.r.prefix + offset;
            return Load<int32_t>(Either(position <= -4, c.r.older + c.r.older_len + position, c.r.prefix + std::max<ptrdiff_t>(position, 0)));
        };
        I32x4 words = word(repeats[1]);
        for (size_t number = 2; number <= 3; number++)
            words[number] = word(repeats[number]);
        // Further into a run of literals, what could have been repeated a byte earlier was.
        const U32x4 differences = As<U32x4>((words ^ Load<int32_t>(before)) + (walk.repeats.xxxx > 1)) >> 8;
        const I32x4 hits = I32x4 { w.graph.alarms[walk.at], 1, 1, 1 } > __builtin_shufflevector(walk.repeats, As<I32x4>(differences), 0, 5, 6, 7);
        if (HWY_UNLIKELY(SignsOf(hits))) {
            Walk saved = walk;
            const Match match = Linger<kClasses>(c, saved, SignsOf(hits), from, to);
            if (match.len) {
                to = saved.at;
                return match;
            }
            walk = saved;
        } else
            walk.Step(w, before[1]);
    }
    while (walk.at < to)
        walk.Step(w, bytes[walk.at]);

    // Where long runs of literals are unheard of, they do not survive until they pay off.
    const uint32_t price = walk.price[0] - kFirstPrice;
    if (price > (to - from) * w.graph.prices.cheapest_literal) {
        uint32_t sum = 0;
        for (size_t i = from; i < to; i++)
            sum += w.graph.prices.literal[bytes[i]];
        if (sum < price)
            w.graph.nodes[to].state[0] = to - from;
    }
    return {};
}

struct Writer {
    Request& r;
    uint32_t (*discarded)[3];
    size_t anchor;
    uint32_t (*first)[3] = r.found;

    // Positions count from `origin` on. Where matches overlap, the first one prevails. Only one in `stride` gets counted, if any.
    HWY_NOINLINE void Write(size_t origin, const int32_t* starts, const int32_t* ends, const int32_t* distances, size_t count, size_t stride)
    {
        const size_t kept = count <= r.room ? count : 0;
        const auto out = kept ? r.found : discarded;
        r.found += kept, r.room -= kept;
        auto [recent, second, third] = r.repeats;
        int32_t end = anchor - origin, unmatched = 0;
        for (size_t i = 0; i < count; i++) {
            const int32_t start = std::max(starts[i], end);
            const uint32_t literals = start - end, distance = distances[i], has_literals = literals != 0;
            end = ends[i];
            out[i][0] = literals, out[i][1] = end - start - 3, unmatched += literals;
            const bool is_recent = distance == (recent & -has_literals);
            uint32_t value = Either(distance == third, 2 + has_literals, distance + 3);
            value = Either(distance == second, 1 + has_literals, value);
            out[i][2] = Either(is_recent, 1u, value);
            third = Either(is_recent, third, Either(distance == second, third, second));
            second = Either(is_recent, second, recent);
            recent = distance;
        }
        r.repeats[0] = recent, r.repeats[1] = second, r.repeats[2] = third;
        anchor = origin + end;
        r.ladder->misses -= unmatched, r.ladder->sequences += count;

        constexpr uint32_t kWeight = 8;
        Counts& counts = *r.counts;
        for (size_t i = 0; stride && i < count; i += stride) {
            const auto [literals, base, value] = out[i];
            const uint8_t* from = r.prefix + (origin + ends[i] - 3 - base - literals);
            for (uint32_t j = 0; j < 3; j++)
                counts.literals[from[j]] += kWeight * (literals > j);
            for (uint32_t j = 3, most = std::min<uint32_t>(literals, stride == 1 ? 256 : 0); j < most; j++)
                counts.literals[from[j]] += kWeight;
            r.ladder->literals += stride * std::min(literals, 8u), r.ladder->shortest += stride * (base + 3 <= r.ladder->rungs[0].len);
            counts.literal_lens[kLiteralCodes[std::min(literals, 63u)]] += kWeight;
            counts.match_lens[kMatchCodes[std::min(base, 128u)]] += kWeight;
            counts.offsets[Log2(value)] += kWeight;
        }
    }

    HWY_INLINE void Write(size_t start, int32_t len, int32_t distance)
    {
        const int32_t zero = 0;
        Write(start, &zero, &len, &distance, 1, r.parser != kBrief);
    }
};

// Writes the matches on the cheapest way to `to` that end until `firm`. Returns where to go on.
static HWY_NOINLINE size_t Retrace(const Chunk& c, Writer& writer, size_t from, size_t to, size_t firm)
{
    Graph& g = c.w.graph;
    size_t first = std::size(g.path_starts), end = first;
    for (size_t at = to; at - from > static_cast<uint32_t>(g.nodes[at].state[0]);) {
        const uint32_t distance = -g.nodes[at].state[1];
        at -= g.nodes[at].state[0];
        end -= at > firm;
        g.path_ends[--first] = at, g.path_distances[first] = distance;
        g.path_starts[first] = at -= c.w.tags[at] >> 3 & kLongest;
        const uint8_t* bytes = c.r.prefix + (c.origin + at);
        if (HWY_UNLIKELY(distance > c.origin + at) ? OlderMatchLen(c.r, c.origin + at, distance, 3) != 3 : HWY_UNLIKELY((Load<uint32_t>(bytes) ^ Load<uint32_t>(bytes - distance)) << 8))
            end = std::max(end, ++first);
    }
    if (end != std::size(g.path_starts) && (firm = std::min<size_t>(firm, g.path_starts[end])) == from)
        end++;
    writer.Write(c.origin, g.path_starts + first, g.path_ends + first, g.path_distances + first, end - first, 1);
    return std::max(c.origin + firm, writer.anchor);
}

// In the first table, and what to put there.
static HWY_INLINE std::pair<uint32_t&, uint32_t> FirstSlot(const Request& r, const Ladder& ladder, size_t at)
{
    const Rung& rung = ladder.rungs[0];
    const uint32_t last = rung.len > 4 ? Load<uint32_t>(r.prefix + at + rung.len - 4) : 0;
    const uint32_t hash = Load<uint32_t>(r.prefix + at) * (kFirstFactor << 8 * (rung.len == 3)) + last * kLastFactor;
    const uint32_t tag = rung.len == 3 ? hash >> 8 << (kShortestLog + 1) : hash >> kWeakBits << ladder.index_bits;
    return { ladder.entries[hash >> (32 - rung.log)], tag + ladder.index + static_cast<uint32_t>(at) };
}

// The longer there has been no match, the fewer positions it looks at: those that the bytes pick, and some for what is periodic.
// Returns where to search again.
static HWY_NOINLINE size_t Skip(const Request& r, size_t at, size_t unmatched)
{
    constexpr size_t kWorthIt = 5;
    Ladder& ladder = *r.ladder;
    Rung& rung = ladder.rungs[0];
    const uint32_t reach = ReachOf(r, ladder, rung), stage = std::min<size_t>(unmatched / 4096, 3);
    const uint8_t mask = (32 << stage) - 1;
    size_t added = 0;
    for (const size_t end = std::min(r.end, at + (2048 << stage)); at + 64 <= end; at += 32) {
        const U8x32 first = Load<U8x32>(r.prefix + at), second = Load<U8x32>(r.prefix + at + 1);
        for (uint32_t picked = BitsOf<char, 32>(((first ^ second) & mask) == 0) | !(at & 0xE0); picked; picked &= picked - 1, added++) {
            const size_t position = at + __builtin_ctz(picked);
            const auto [slot, entry] = FirstSlot(r, ladder, position);
            const uint32_t distance = entry - slot;
            if (HWY_UNLIKELY(distance - 1 < reach) && distance <= position + r.older_len && MatchLen(r, position, distance, kWorthIt) == kWorthIt)
                return position;
            slot = entry;
        }
    }
    Grow(ladder, rung, ladder.entries, added);
    return at;
}

// What the first rung has found for the positions up to `end`.
struct Lookahead {
    size_t origin, end;
};

// Paints the matches through the positions from `from` on. Returns up to where, which is less than `to` if a long match is there.
template<bool kHasOlder>
static HWY_NOINLINE size_t Climb(Chunk& c, Ladder& ladder, bool stores, Lookahead& ahead, size_t from, size_t to)
{
    constexpr size_t kCaughtUp = 96;
    const Request& r = c.r;
    Work& w = c.w;
    const size_t behind = static_cast<uint32_t>(ladder.index + from - ladder.next), start = from - std::min({ behind, from, kCaughtUp });
    const auto measure = kHasOlder || r.end >> 18 ? Measure<kHasOlder, true> : Measure<false, false>;
    uint32_t *table = ladder.entries, *first = stores ? w.first : w.attached;
    size_t count = to - start, longest = 0, misses;
    for (size_t k = 0; k < ladder.count; table += size_t { 1 } << ladder.rungs[k++].room_log) {
        Rung& rung = ladder.rungs[k];
        const uint32_t reach = ReachOf(r, ladder, rung), spacing = ladder.rungs[k + 1].spacing;
        longest = std::max<size_t>(longest, rung.len);
        if (k == 0) {
            if (from >= ahead.end) {
                ahead = { c.origin, to };
                IndexAll(r, ladder, rung, table, stores, reach, start, to, first + (start - c.origin), w.valid);
            }
            uint32_t* const found = first + (start - ahead.origin);
            found[-1] = (found - 1)[from - start] = 0;
            Mark(c, start, to);
            const size_t seeds = Pick<true, kHasOlder>(c, reach, spacing, start - c.origin, found, count, rung.is_open, misses);
            to = std::min(to - 1, measure(c, seeds, stores)) + 1;
        } else if (rung.len == 3) {
            if (!stores)
                continue;
            IndexAll(r, ladder, rung, table, stores, reach, start, to, w.graph.shortest + (start - c.origin), w.valid);
            Trust(c, reach, from, to + 2);
        } else {
            IndexSome(c, ladder, rung, table, stores, w.graph.climbers, count, to);
            if (!count)
                continue;
            w.before_entries[7] = 0;
            const size_t seeds = Pick<false, kHasOlder>(c, reach, spacing, 0, w.entries, count, rung.is_open, misses);
            measure(c, seeds, false);
            if (stores)
                Grow(ladder, rung, table, misses);
        }
    }
    ladder.next = ladder.index + std::min(to, std::max(r.end + 1, longest) - longest);
    return to;
}

// Where matches do not pay off, that may be because of what was learned from other data. Looks at the bytes before `at`.
static HWY_NOINLINE void Forget(const Request& r, size_t at, uint32_t shift)
{
    Counts& counts = *r.counts;
    const auto fade = [&](auto& counts, uint32_t hope) HWY_ATTR {
        for (uint32_t& count : counts)
            count >>= shift;
        for (size_t i = 0; i < 4; i++)
            counts[i] += hope >> i;
    };
    fade(counts.literals, 0), fade(counts.literal_lens, 16 << shift), fade(counts.match_lens, 16 << shift), fade(counts.offsets, 16 << shift);
    for (size_t i = at - std::min<size_t>(at, 512); i < at; i += 3)
        counts.literals[r.prefix[i]] += 8;
}

constexpr size_t kCoveredMin = 256;
static void Cover(const Request&, Work&, size_t from, size_t end);

// What has ended a match may have ended an earlier one. The tables have what is nearest, which is not the longer period.
static HWY_NOINLINE void Recall(Writer& writer, Work& w)
{
    const Request& r = writer.r;
    const Ladder& ladder = *r.ladder;
    const auto word = [&](size_t at) HWY_ATTR { return Load<uint64_t>(r.prefix + at); };
    // How far a few literals and a repeat or a run go.
    const auto cheaply = [&](size_t at) HWY_ATTR {
        size_t len = 0;
        for (const size_t distance : { r.repeats[0], uint32_t { r.repeats[0] != 1 } }) {
            if (distance - 1 < at && Differences(r.prefix + at, r.prefix + (at - distance)) < 1 << 12)
                len = std::max(len, 32 + MatchLen(r, at + 32, distance, r.end));
        }
        return len;
    };
    for (size_t at; r.found != writer.first && (at = writer.anchor) + kCoveredMin <= r.end;) {
        const size_t repeated = cheaply(at);
        if (at + repeated + 32 > r.end)
            return;
        Match best = { std::max<size_t>(200, repeated + 8) };
        const auto consider = [&](size_t distance) HWY_ATTR {
            if (distance - 1 >= std::min<size_t>(at, r.max_distance) || at + best.len >= r.end)
                return;
            if (word(at) == word(at - distance) && word(at + best.len - 7) == word(at + best.len - 7 - distance)) {
                if (const size_t len = MatchLen(r, at, distance, r.end); len > best.len)
                    best = { len, distance };
            }
        };
        size_t distance = 0;
        for (auto it = r.found, last = it - std::min<size_t>(it - writer.first, 32); it-- != last;)
            consider(distance += (*it)[0] + (*it)[1] + 3);
        // The first table has room for what is at both ends of the repeat.
        if (repeated) {
            const uint64_t hash = ((word(at) * 0x9E3779B97F4A7C15u + word(at + repeated)) * 0xC2B2AE3D27D4EB4Fu + repeated) * 0x9E3779B97F4A7C15u;
            const uint32_t entry = (static_cast<uint32_t>(hash >> 8) << ladder.index_bits) + ladder.index + at;
            consider(entry - std::exchange(ladder.entries[hash >> (64 - ladder.rungs[0].log)], entry));
        }
        const auto [slot, entry] = FirstSlot(r, ladder, at);
        consider(entry - slot);
        if (!best.distance || (repeated && best.len < repeated + cheaply(at + repeated)))
            return;
        writer.Write(at, best.len, best.distance);
        Cover(r, w, at, writer.anchor);
    }
}

template<bool kHasOlder>
static HWY_INLINE size_t SearchOptimal(Request& r, Work& w)
{
    Writer writer = { r, w.out, r.start };
    Chunk c = { r, w };
    const int32_t classes = r.parser - kOptimalOfOne + 1, top = Log2(std::min<size_t>(r.end + r.older_len, r.max_distance) - 1);
    for (int32_t i = 1; i < 3; i++)
        c.classes[i - 1] = i < classes ? 1 << std::max(0, top + 1 - (top + 2) / (classes + 1) * (classes - i)) : INT32_MAX;
    const auto spread = classes == 3 ? Spread<3> : classes == 2 ? Spread<2>
                                                                : Spread<1>;
    const auto parse = classes == 3 ? Parse<3, kHasOlder> : classes == 2 ? Parse<2, kHasOlder>
                                                                         : Parse<1, kHasOlder>;

    size_t at = std::max<size_t>(r.start, r.older_len ? 1 : 2), known = 0, priced = 0, hint = 0, retry = 0;
    Lookahead ahead = {};
    bool is_used_up = true;
    while (at < r.end) {
        if (is_used_up) {
            const size_t from = std::max(known, at), kept = at <= known ? known + 1 - at : 0;
            size_t to = from < ahead.end ? ahead.end : std::min(from + kChunk, r.end);
            const size_t old = at - c.origin;
            c.origin = from - kBehind, c.start = at, c.far_count = c.best = 0;
            for (int32_t kind = 0; kind < classes; kind++) {
                uint32_t* painted = w.graph.painted[kind] + (at - c.origin);
                memset(painted - kBack, 0, (to + 16 + kBack - at) * sizeof(*painted));
                for (size_t i = 0; i < kept; i++) {
                    if (const uint32_t len = w.graph.offers[kind][old + i] >> 8 & 0xFF)
                        painted[i] = Key(c, len, -w.graph.nodes[old + i].found[kind + 1]);
                }
            }
            to = Climb<kHasOlder>(c, *r.ladder, true, ahead, from, to);
            if (kHasOlder && r.attached) {
                Lookahead none = {};
                r.attached->next = r.attached->index + from;
                Climb<kHasOlder>(c, *r.attached, false, none, from, to);
            }
            for (; hint < r.hint_count && r.hints[hint][0] < to; hint++) {
                const size_t start = std::max<size_t>(r.hints[hint][0], at), distance = r.hints[hint][2];
                if (distance - 1 < std::min<size_t>(start + r.older_len, r.max_distance))
                    w.graph.painted[classes - 1][start - c.origin] = std::max(w.graph.painted[classes - 1][start - c.origin], Key(c, MatchLen(r, start, distance, kLongest), distance));
                if (r.hints[hint][1] > to)
                    break;
            }
            // Where there have been no matches for a while, short ones are not going to pay off.
            if (at - writer.anchor >= r.patience && at >= retry) {
                Forget(r, priced = at, 3);
                retry = at + std::min<size_t>(2 * (at - writer.anchor), 32768);
            } else if (at - writer.anchor >= r.patience && c.best < 5 << 24 && hint == r.hint_count) {
                at = to, known = 0;
                continue;
            }
            const bool has_shortest = r.ladder->count > 1 && r.ladder->rungs[r.ladder->count - 1].len == 3;
            std::fill(w.graph.shortest + (at - kBack - c.origin), w.graph.shortest + ((has_shortest ? from : to + 8) - c.origin), 0);
            spread(c, at - kBack - c.origin, to + 1 - c.origin);
            known = to;
        }
        const size_t step = at - r.start < 2048 ? 256 : 1024;
        if (at >= priced) {
            Derive(r, w.graph.prices, at);
            priced = at + step / 2;
        }
        const size_t planned = at + step + 128 >= known ? known : at + step;
        size_t to = planned - c.origin;
        I32x4 state = at - writer.anchor;
        for (size_t i = 0; i < 3; i++)
            state[i + 1] = r.repeats[i] - 1 < std::min<size_t>(at - 1 + r.older_len, r.max_distance) ? -r.repeats[i] : -1;
        const Match match = parse(c, at - c.origin, to, state);
        const size_t margin = match.len || planned == r.end ? 0 : std::min<size_t>(14, planned - at - 1);
        const size_t before = at;
        r.ladder->sequences = 0;
        at = Retrace(c, writer, at - c.origin, to, to - margin);
        // Neither is anything learned about literals where short matches take their place.
        if (at - before >= 128 && r.ladder->sequences * 10 > at - before) {
            uint64_t kinds = 0, price = 0;
            for (size_t i = at - 128; i < at; i++)
                kinds |= uint64_t { 1 } << r.prefix[i] % 64, price += w.graph.prices.literal[r.prefix[i]];
            if (const uint32_t count = std::popcount(kinds); count <= 8 && price / 128 > Rounded(Log2(2 * count - 1) * 256 + 128))
                Forget(r, priced = at, 3);
        }
        if (match.len) {
            writer.Write(at, match.len, match.distance);
            at = writer.anchor;
            if (at >= ahead.end + kCoveredMin)
                Cover(r, w, ahead.end, at);
            Recall(writer, w), at = writer.anchor;
        }
        is_used_up = at >= known || (!match.len && planned == known);
    }
    if (r.end - writer.anchor >= 256)
        Forget(r, r.end, 3);
    return writer.anchor;
}

constexpr uint32_t kLinkBits = 13, kRepeated = 1u << 12, kLiteralMax = 46;
static_assert(kSpan * kLiteralMax << kLinkBits < kNever);

static HWY_NOINLINE void DeriveRoughly(const Request& r, Links& l, size_t at)
{
    Counts& counts = *r.counts;
    Counts bits;
    BitsFor(r, at, bits);
    uint32_t sum = 0, total = 1;
    // Up to Cascade Lake, vector multiplications in a row lower the clock.
#pragma clang loop vectorize(disable)
    for (size_t i = 0; i < 256; i++)
        sum += counts.literals[i] * bits.literals[i], total += counts.literals[i];
    // In quarters of a bit
    for (uint32_t i = 0; i < 32; i++) {
        l.offset[i] = (bits.offsets[i] + 256 * i + bits.literal_lens[0] + 96) / 64;
        l.match_len[i] = i < 3 ? 255 : (bits.match_lens[i - 3] + 32) / 64;
    }
    l.mostly_repeats = bits.offsets[0] < 256;
    // The line that fits the prices for numbers of literals best
    int64_t n = 0, x = 0, y = 0, xx = 0, xy = 0;
#pragma clang loop vectorize(disable)
    for (int64_t code = 1, len = 1; code < 25; len += 1 << kLiteralBits[code++]) {
        const int64_t count = counts.literal_lens[code] + 1, price = bits.literal_lens[code] + 256 * kLiteralBits[code];
        n += count, x += count * len, y += count * price, xx += count * len * len, xy += count * len * price;
    }
    const int32_t slope = std::max<int64_t>(n * xy - x * y, 0) / (n * xx - x * x), base = (y - slope * x) / n;
    // In 1/16 of a bit
    l.literal = std::clamp((static_cast<int32_t>(std::max(sum / total, LiteralBitsMin(r))) + slope) / 16, 16, 160);
    // The average says little if one is much cheaper.
    if ((l.is_exact = r.parser == kLinkedExactly || (r.ladder->saved && r.ladder->count > 2 && bits.literals[0] < 512))) {
        for (size_t i = 0; i < 256; i++)
            l.literals[i] = std::min((std::max(bits.literals[i], LiteralBitsMin(r)) + 32 + slope) / 64, kLiteralMax) << kLinkBits;
    }
    l.first_literal = (base - static_cast<int32_t>(bits.literal_lens[0])) / 64 << kLinkBits;
}

// Goes backwards from match to match. Each has the byte before the last one, or else the next that has a distance. Returns their number.
template<bool kHasOlder>
static HWY_NOINLINE size_t Link(const Chunk& c, ptrdiff_t floor, ptrdiff_t from, ptrdiff_t to)
{
    constexpr size_t kLanes = 8;
    const Request& r = c.r;
    Work& w = c.w;
    Links& l = w.links;
    struct Lane {
        uint32_t at, distance, out;
        int16_t limit, number;
    } lanes[kLanes];
    uint32_t ends[kLanes];
    const uint8_t* bytes = r.prefix + static_cast<ptrdiff_t>(c.origin);
    const ptrdiff_t gap = r.older + r.older_len - r.prefix, margin = c.origin - 32, last = r.end - 32 - c.origin, older_len = r.older_len;
    const ptrdiff_t share = std::max<ptrdiff_t>((to - from + kLanes - 1) / kLanes, 64), ceiling = std::min<ptrdiff_t>(to + 64, last + 32);
    const auto source = [&](ptrdiff_t at, ptrdiff_t distance) HWY_ATTR {
        return bytes + at - distance + (kHasOlder ? Either<ptrdiff_t>(distance > at + margin, gap, 0) : 0);
    };
    // Where there is none for a while, the distance is invalid.
    const auto aim = [&](Lane& lane, size_t end) HWY_ATTR {
        const uint64_t valid = Load<uint64_t>(w.valid + (end - 1) / 8 - 7) << (-end & 7) >> 7;
        lane.at = end - 58 + (63 ^ __builtin_clzll(2 * valid + 1));
        lane.distance = w.first[lane.at] | -!valid;
        __builtin_prefetch(source(lane.at, lane.distance));
    };
    const auto step_slowly = [&](Lane& lane) HWY_ATTR -> ptrdiff_t {
        const ptrdiff_t at = lane.at, distance = lane.distance;
        if (distance > at + margin + 32 + older_len)
            return at + (lane.distance == ~0u);
        l.found_ends[lane.out] = at + MatchLen(r, c.origin + at, distance, ceiling - at), l.found_same[lane.out] = 0, l.found_distances[lane.out] = distance;
        return l.found_starts[lane.out++] = at - MatchLenBefore(r, c.origin + at, distance, at - floor);
    };
    Lane* live = lanes;
    size_t shares = 0;
    for (ptrdiff_t end = to; end > from; end -= share, shares++) {
        *live = { 0, 0, uint32_t(to - end), int16_t(std::max(from, end - share)), int16_t(shares) };
        ptrdiff_t start = end;
        while (start > live->limit && (aim(*live, start), live->at > last))
            start = step_slowly(*live);
        ends[shares] = live->out;
        live += start > live->limit;
    }
    while (live != lanes) {
        for (Lane* lane = lanes; lane < live; lane++) {
            const ptrdiff_t at = lane->at, distance = lane->distance;
            bool is_inside = distance <= at + margin;
            if (kHasOlder)
                is_inside |= (distance >= at + margin + 64) & (distance <= at + margin + older_len) & (at + margin >= 0);
            ptrdiff_t start;
            if (HWY_LIKELY(is_inside)) {
                const uint8_t *a = bytes + at, *b = source(at, distance);
                const size_t out = lane->out++;
                l.found_ends[out] = at, l.found_same[out] = ~Differences(a, b), l.found_distances[out] = distance;
                if (const uint32_t back = Differences(a - 32, b - 32); HWY_LIKELY(back))
                    start = at - 31 + Log2(back);
                else
                    start = at - MatchLenBefore(r, c.origin + at, distance, at - floor);
                l.found_starts[out] = start;
            } else
                start = step_slowly(*lane);
            lane->at = start;
        }
        for (Lane* lane = lanes; lane < live; lane++) {
            if (const ptrdiff_t start = lane->at; HWY_LIKELY(start > lane->limit))
                aim(*lane, start);
            else {
                ends[lane->number] = lane->out;
                *lane-- = *--live;
            }
        }
    }

    // Leaves in `same` which of the bytes from the end on are the same again.
    constexpr uint32_t kSure = 18;
    size_t count = 0;
    int16_t* starts = l.starts + kGuard;
    uint16_t* unsure = w.tags;
    Store(l.starts, I16x16(INT16_MAX));
    for (size_t number = 0; number < shares; number++) {
        size_t first = number * share;
        while (first < ends[number] && std::max<int16_t>(l.found_starts[first], floor) >= (starts - 1)[count])
            first++;
        U16x8 place = static_cast<uint16_t>(count);
        for (size_t i = 0; first + i < ends[number]; i += 8, place += 8) {
            const U32x8 same = Load<U32x8>(l.found_same + first + i), some = same & ~(1u << kSure), len = Log2(As<I32x8>(~some & (some + 1)));
            Store(starts + count + i, Max(Load<Lanes<int16_t, 8>>(l.found_starts + first + i), Lanes<int16_t, 8>(floor)));
            StoreNarrow(l.ends + count + i, Wide(l.found_ends + first + i) + As<I32x8>(len));
            Store(l.distances + count + i, Load<U32x8>(l.found_distances + first + i));
            Store(l.same + count + i, same >> len);
            AppendSetBits(unsure, BitsOf<int, 8>(len == kSure), place);
        }
        count += ends[number] - first;
        while (unsure != w.tags && unsure[-1] >= count)
            unsure--;
    }
    for (const uint16_t* it = w.tags; it != unsure; it++) {
        const ptrdiff_t distance = l.distances[*it], end = l.ends[*it] += MatchLen(r, c.origin + l.ends[*it], distance, ceiling - l.ends[*it]);
        l.same[*it] = HWY_LIKELY(end <= last && distance <= end + margin) ? ~Differences(bytes + end, bytes + end - distance) : 0;
    }
    return count;
}

static HWY_INLINE U32x8 LookUp(const uint8_t (&table)[32], U32x8 index)
{
    return LookUpOr0(table, (index + 0x80808070) & 0x8080808F) | LookUpOr0(table + 16, (index - 16) | 0x80808000);
}

// For each match, finds the last one that starts until its end.
static HWY_INLINE void FindLast(const Links& l, size_t count, const int16_t* ends, uint16_t* last)
{
    constexpr size_t kTried = 8;
    const int16_t* starts = l.starts + kGuard;
    I16x16 number = I16x16 { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15 } - static_cast<int16_t>(kTried);
    for (size_t i = 0; i < count; i += 16, number += 16) {
        const I16x16 end = Load<I16x16>(ends + i);
        I16x16 found = number;
        for (size_t tried = 1; tried <= kTried; tried++)
            found -= Load<I16x16>(starts + i - tried) > end;
        Store(last + i, found);
        uint32_t more = BitsOf<char, 32>(As<Lanes<int8_t, 32>>(found == number) < 0) & 0x55555555;
        for (; HWY_UNLIKELY(more) && i + __builtin_ctz(more) / 2 < count; more &= more - 1) {
            const size_t at = i + __builtin_ctz(more) / 2;
            while (starts[last[at] - 1] <= ends[at])
                last[at]--;
        }
    }
}

// Returns the first match on the cheapest way, and above it the price, less that for nothing but literals.
template<Parser kParser>
static HWY_NOINLINE int32_t Choose(const Chunk& c, size_t count, size_t floor, size_t to)
{
    constexpr bool kRepeats = kParser != kLinked, kIsExact = kParser == kLinkedExactly;
    Links& l = c.w.links;
    const int32_t literal = l.literal << (kLinkBits - 2), first_literal = l.first_literal;
    const size_t even = kIsExact ? to : floor;
    I32x8 rest = (static_cast<int32_t>(to - even) - I32x8 { 0, 1, 2, 3, 4, 5, 6, 7 }) * literal;
    for (size_t at = even; at < to + 128; at += 8, rest -= 8 * literal)
        Store(l.rest + at, rest & -(1 << kLinkBits));
    const uint8_t* bytes = c.r.prefix + static_cast<ptrdiff_t>(c.origin);
    for (size_t at = even, sum = 0; at-- > floor;)
        l.rest[at] = sum += l.literals[bytes[at]];

    const int32_t repeat = (l.offset[0] << kLinkBits) + first_literal + kRepeated;
    I32x8 number = { 0, 1, 2, 3, 4, 5, 6, 7 };
    const int16_t* starts = l.starts + kGuard;
    int32_t *inside = l.inside + 2, *before = l.before + 2;
    for (size_t i = 0; i < count + 2; i += 8, number += 8) {
        const I32x8 start = Wide(starts + i), end = Wide(l.ends + i);
        const U32x8 code = Log2(Load<I32x8>(l.distances + i) + 3);
        Store(l.own + i, As<I32x8>((LookUp(l.offset, code) + LookUp(l.match_len, Min(As<U32x8>(end - start), U32x8(31)))) << kLinkBits) | number);
        Store(inside + i, I32x8(kNever));
        if (kRepeats) {
            const U32x8 same = Load<U32x8>(l.same + i) & ~1u, three = same & same >> 1 & same >> 2 & 0x1FF;
            const U32x8 gap = As<U32x8>(Max(As<I32x8>(Log2(As<I32x8>(three & -three))), I32x8(0)));
            const U32x8 rest = same >> gap & ~(1u << 30), len = Log2(As<I32x8>(~rest & (rest + 1)));
            StoreNarrow(l.repeat_starts + i, end + As<I32x8>(gap)), StoreNarrow(l.repeat_ends + i, end + As<I32x8>(gap + len));
            Store(l.repeat_price + i, repeat + As<I32x8>(LookUp(l.match_len, len) << kLinkBits));
        }
    }
    FindLast(l, count, l.ends, l.last);
    if (kRepeats)
        FindLast(l, count, l.repeat_ends, l.repeat_last);

    constexpr int32_t kNone = kRepeated - 1;
    int32_t cheapest = before[0] = kNone;
    for (size_t i = 0; i < count; i++) {
        const size_t last = l.last[i], end = l.ends[i];
        int32_t best = std::min(before[last] + l.rest[end], std::min(inside[last], inside[last + 1]));
        if (kRepeats) {
            const size_t other = l.repeat_last[i], start = l.repeat_starts[i];
            const int32_t price = l.repeat_price[i] + l.rest[end] - l.rest[start];
            best = std::min(best, std::min(before[other] + l.rest[l.repeat_ends[i]], inside[other]) + price);
        }
        l.next[i] = best;
        const int32_t price = (best & -(1 << kLinkBits)) + l.own[i], gain = price - l.rest[starts[i]] + first_literal;
        inside[i] = price;
        before[i + 1] = cheapest = std::min(cheapest, gain);
    }
    return cheapest;
}

// `Choose` does not see that what is repeated can be repeated again. For a few matches. Returns how many there are now.
template<bool kHasTime>
static HWY_NOINLINE size_t PreferRepeats(const Chunk& c, int32_t end, size_t count, int32_t ceiling)
{
    Links& l = c.w.links;
    int32_t *starts = l.path_starts, *ends = l.path_ends + 8, *distances = l.path_distances;
    const uint8_t* bytes = c.r.prefix + static_cast<ptrdiff_t>(c.origin);
    const int32_t last = std::min<ptrdiff_t>(c.r.end - 33 - c.origin, ceiling);
    const auto repeat = [&](size_t i) HWY_ATTR { return end >= 0 && c.r.repeats[i] - 1 < c.r.max_distance ? c.r.repeats[i] : ~0u; };
    uint32_t recent = repeat(0), second = repeat(1), third = repeat(2);
    for (int32_t* list : { starts, ends, distances })
        memcpy(list + kSpan, list, count * sizeof(*list));
    const int32_t enough = l.mostly_repeats ? 8 : 16;
    int32_t covered = end + 3;
    size_t kept = 0;
    for (size_t i = kSpan; i < kSpan + count; i++) {
        int32_t start = starts[i], stop = ends[i], distance = distances[i];
        if (HWY_UNLIKELY(stop < covered) || stop - start < 3)
            continue;
        if (HWY_LIKELY(end < last && recent <= c.origin + end)) {
            const uint8_t* next = bytes + end + 1;
            const uint64_t differences = Differences(next, next - recent) | uint64_t { 1 } << 32, two = differences | differences >> 1;
            const int32_t gap = l.mostly_repeats && static_cast<uint32_t>(distance) > recent ? __builtin_ctz(~(two | two >> 2) | 4) : 0, needed = std::max(stop - end - 1 - gap, enough / 2);
            if (HWY_UNLIKELY(__builtin_ctzll(differences >> gap) >= std::min(needed - l.mostly_repeats, enough))) {
                next += gap;
                if (const int32_t len = CommonLen(next, next - recent, last + 32 - end - gap); len >= 3 && (len + 4 >= needed || (covered == end + 3 && 3 * len >= needed)))
                    start = end + gap + (next[-1] != next[-1 - static_cast<ptrdiff_t>(recent)]), stop = end + gap + 1 + len, distance = recent, covered = stop + 3, i--;
            }
        }
        // Those that go further are worth some literals.
        for (const uint32_t other : { recent, second, third }) {
            if (!kHasTime || covered == stop + 3 || static_cast<uint32_t>(distance) == recent || end >= last || other > c.origin + end)
                continue;
            const uint8_t* next = bytes + end;
            if (const uint32_t differences = Differences(next, next - other) & 0xFFFFF; HWY_UNLIKELY(differences < 16)) {
                const int32_t gap = Log2(2 * differences + 1), len = CommonLen(next + gap, next + gap - other, last + 32 - end - gap);
                if (len >= 3 && end + gap + len >= stop + 8 * std::max(end + gap - std::max(start, end) - 1, 0))
                    start = end + gap, stop = start + len, distance = other, covered = stop + 3;
            }
        }
        const bool is_recent = static_cast<uint32_t>(distance) == recent;
        third = Either(is_recent | (static_cast<uint32_t>(distance) == second), third, second), second = Either(is_recent, second, recent);
        if (kept && start <= end && is_recent)
            start = starts[--kept], stop = std::max(stop, end);
        starts[kept] = start, ends[kept] = end = stop, distances[kept++] = recent = distance;
    }
    return kept;
}

template<bool kRepeats>
static HWY_NOINLINE size_t Follow(const Chunk& c, Writer& writer, size_t first, int32_t firm)
{
    Request& r = writer.r;
    Links& l = c.w.links;
    int32_t *starts = l.path_starts, *ends = l.path_ends + 8, *distances = l.path_distances, *cuts = l.cuts + 8;
    size_t count = 0;
    for (size_t i = first; i != kRepeated - 1;) {
        const size_t next = l.next[i];
        starts[count] = l.starts[kGuard + i], ends[count] = l.ends[i];
        Store(distances + count, I32x4(l.distances[i]).lo);
        count++;
        if (kRepeats) {
            starts[count] = l.repeat_starts[i], ends[count] = l.repeat_ends[i];
            count += next / kRepeated & 1;
        }
        i = next & (kRepeated - 1);
    }
    // Where repeats are common or matches long, and now and then to see if they could be.
    const auto is_below = [&](size_t share) HWY_ATTR { return count * share + kBehind < std::min<size_t>(firm + 64, kSpan); };
    if (is_below(l.mostly_repeats || c.start / kChunk % 32 < 2 ? 4 : l.offset[0] < 18 ? 16
                                                                                      : 40))
        count = (is_below(16) ? PreferRepeats<true> : PreferRepeats<false>)(c, writer.anchor - c.origin, count, firm + 64);
    // Leaves room for those that follow, and drops those that get too short.
    constexpr int32_t least = 3;
    int32_t latest = starts[count] = ends[count] = INT16_MAX;
    size_t kept = count, unsure = 0;
    for (size_t i = count; i--;) {
        const int32_t start = starts[i], end = std::min(ends[i], latest - least);
        if (HWY_UNLIKELY(end - start < least))
            continue;
        kept--, unsure += end > firm;
        starts[kept] = start, ends[kept] = latest = end, distances[kept] = distances[i];
    }
    starts += kept, ends += kept, distances += kept, count -= kept + unsure;
    cuts[-1] = ends[-1] = writer.anchor - c.origin;
    // The last offset can only be repeated after a literal.
    if (starts[0] == cuts[-1] && static_cast<uint32_t>(distances[0]) == r.repeats[0] && ends[0] - starts[0] > least)
        starts[0]++;
    const auto price = [&](I32x8 len) HWY_ATTR { return As<I32x8>(LookUp(l.match_len, Min(As<U32x8>(len), U32x8(31)))); };
    for (size_t i = 0; i < count; i += 8) {
        const I32x8 late = Load<I32x8>(ends + i), start = Max(Load<I32x8>(starts + i), Load<I32x8>(ends + i - 1)), next_end = Load<I32x8>(ends + i + 1);
        const I32x8 early = Min(Max(Load<I32x8>(starts + i + 1), start + least), late);
        Store(cuts + i, price(early - start) + price(next_end - early) < price(late - start) + price(next_end - late) ? early : late);
    }
    writer.Write(c.origin, starts, cuts, distances, count, r.parser == kLinkedExactly ? 1 : c.start < 8192 ? 2
                                                                                                           : 8);
    if (unsure) {
        const int32_t start = std::max(starts[count], (cuts - 1)[count]), len = ends[count] - start;
        if (len >= 64 || c.origin + start <= c.start)
            writer.Write(c.origin + start, std::max<size_t>(MatchLen(r, c.origin + start, distances[count], r.end), len), distances[count]);
        firm = std::min(firm, start);
    }
    return std::max(c.origin + firm, writer.anchor);
}

static HWY_NOINLINE size_t PickMarked(Work& w, uint8_t spacing, uint32_t all, size_t from, size_t to)
{
    uint16_t* picked = w.picked;
    U16x8 place = static_cast<uint16_t>(from);
    for (size_t i = 0; from + i < to; i += 32) {
        uint32_t bits = BitsOf<char, 32>(Load<Lanes<int8_t, 32>>(w.levels + i) > static_cast<int8_t>(spacing - 1)) & (Load<uint32_t>(w.valid + (from + i) / 8) | all);
        for (size_t j = 0; j < 4; j++, bits >>= 8, place += 8)
            AppendSetBits(picked, bits, place);
    }
    return picked - w.picked;
}

// The last rung may be only for where matches are long.
constexpr uint32_t kRare = 4, kSpare = 5;

// Needs no marks.
static HWY_NOINLINE size_t PickRare(const Chunk& c, size_t from, size_t to)
{
    uint16_t* picked = c.w.picked;
    const uint8_t mask = 0x78;
    for (; from < to && from + 36 <= c.r.end; from += 32) {
        const auto bytes = [&](size_t offset) HWY_ATTR { return Load<U8x32>(c.r.prefix + from + offset); };
        U8x32 mixed = bytes(0);
        for (size_t offset = 1; offset < 4; offset++)
            mixed += mixed + mixed + bytes(offset);
        const uint64_t bits = BitsOf<char, 32>((mixed & mask) == 0x48) | uint64_t { 3 } << 32;
        picked[0] = from - c.origin + __builtin_ctzll(bits), picked[1] = from - c.origin + __builtin_ctzll(bits & (bits - 1));
        picked += std::min(std::popcount(bits) - 2, 2);
    }
    return picked - c.w.picked;
}

// Indexes a little of what the last match has covered from `from` to `end`, for when what it copies is out of reach.
static HWY_NOINLINE void Cover(const Request& r, Work& w, size_t from, size_t end)
{
    Chunk c = { r, w };
    Ladder& ladder = *r.ladder;
    const size_t rungs = ladder.count - (ladder.rungs[ladder.count - 1].spacing == kSpare);
    const bool is_rare = rungs == 1 || ladder.rungs[rungs - 1].spacing == kRare;
    for (from = std::max(from, end - std::min<size_t>(end, r.repeats[0])); from + kCoveredMin <= end; from += kChunk) {
        const size_t to = from + std::min(kChunk, (end - from - kCoveredMin / 2) & ~31);
        c.origin = from - kBehind;
        if (!is_rare)
            Mark(c, from, to);
        size_t count = (is_rare ? PickRare(c, from, to) : PickMarked(w, kRare - 1, ~0u, kBehind, to - c.origin)) / 4;
        for (size_t i = 0; i < count; i++) {
            const auto [slot, entry] = FirstSlot(r, ladder, c.origin + (w.picked[i] = w.picked[4 * i]));
            slot = entry;
        }
        uint32_t* table = ladder.entries;
        for (size_t k = 1; k < rungs; k++) {
            table += size_t { 1 } << ladder.rungs[k - 1].room_log;
            if (ladder.rungs[k].len != 3 && is_rare == (ladder.rungs[k].spacing == kRare))
                IndexSome(c, ladder, ladder.rungs[k], table, true, w.picked, count, to);
        }
    }
}

// Returns how many are valid.
template<class V> static HWY_NOINLINE size_t Override(Work& w, size_t count, uint32_t reach)
{
    size_t hits = 0;
    for (size_t i = 0; i < count; i++) {
        const uint32_t distance = w.entries[i];
        Store(w.first + Either<size_t>(distance - 1 < reach, w.picked[i], 0), V(distance));
        hits += distance - 1 < reach;
    }
    return hits;
}

// What longer bytes find takes precedence. Returns how long the longest are.
static HWY_INLINE size_t IndexAbove(const Chunk& c, Ladder& ladder, bool stores, uint32_t all, size_t from, size_t to, bool has_time = false)
{
    const Request& r = c.r;
    uint32_t* table = ladder.entries;
    size_t longest = ladder.rungs[0].len;
    for (size_t k = 1; k < ladder.count; k++) {
        table += size_t { 1 } << ladder.rungs[k - 1].room_log;
        Rung& rung = ladder.rungs[k];
        if (rung.len == 3 || (rung.spacing == kSpare && !has_time))
            continue;
        longest = std::max<size_t>(longest, rung.len);
        size_t count = rung.spacing == kRare ? PickRare(c, from, to) : 0;
        // There may be too few kinds of bytes.
        count *= count * 48 >= to - from;
        if (!count && ladder.rungs[1].spacing >= kRare)
            Mark(c, from, to);
        if (!count)
            count = PickMarked(c.w, rung.spacing == kSpare ? 1 + (!ladder.saved || k == 1) : std::min(rung.spacing, kRare - 1), all, from - c.origin, to - c.origin);
        IndexSome(c, ladder, rung, table, stores, c.w.picked, count, to);
        const uint32_t reach = std::min<size_t>(ReachOf(r, ladder, rung), to + r.older_len);
        const size_t hits = (rung.spacing == 0 ? Override<uint32_t> : rung.spacing < 2 ? Override<U32x4>
                                                                                       : Override<U32x8>)(c.w, count, reach);
        if (stores)
            Grow(ladder, rung, table, count - hits);
    }
    return longest;
}

// The longer the first rung, the more of what spans the end of a match is new to it. About half is best.
static HWY_NOINLINE void Review(const Request& r, size_t at)
{
    Ladder& ladder = *r.ladder;
    Rung& rung = ladder.rungs[0];
    const auto sum = [](const uint32_t* counts, size_t from, size_t to) HWY_ATTR { return std::accumulate(counts + from, counts + to, 0u); };
    const size_t horizon = std::min<size_t>(r.max_distance, 1 << 19), seen = std::min(at + (r.attached ? 0 : r.older_len), horizon);
    const int64_t count = int64_t { ladder.sequences } + 1, shortest = int64_t { 100 } * ladder.shortest / count;
    const int64_t missed = int64_t { 100 } * static_cast<int32_t>(ladder.misses + ladder.literals) / ((rung.len - 1) * count + ladder.literals);
    // Less is going to be new once more has been seen.
    const int64_t score = missed + shortest / 2 - 9 * std::min(Log2(horizon / (seen + 1) + 1), 3u);
    const bool is_worth_it = count >= 64 && (seen * 5 < r.max_distance || seen == horizon || score < 25);
    const uint32_t wanted = rung.len + (is_worth_it && score < 38) + (is_worth_it && score < 18) - (score > 85 && shortest > 12);
    const uint32_t *literals = r.counts->literals, all = sum(literals, 0, 256);
    const bool is_binary = 16 * (sum(literals, 1, 9) + sum(literals, 14, 32)) > all, is_wide = 8 * literals[0] > all;
    const uint32_t len = std::max(count == 1 ? 0 : std::min(wanted, is_binary ? 5u : 6u + 2 * is_wide), ladder.len_min);
    // The table takes all its room only for short matches from afar.
    if (rung.log + 1 == rung.room_log && rung.log > kCachedLog && (len > ladder.len_min || 4 * sum(r.counts->offsets, rung.log - 1, 32) < sum(r.counts->offsets, 0, 32)))
        rung.used = 0;
    ladder.term = std::max<size_t>(1024, seen / 4), ladder.sequences = ladder.literals = ladder.shortest = 0;
    if (len == std::exchange(rung.len, len))
        return;
    const size_t again = std::min<size_t>(seen, 1 << 18);
    const auto fill = [&](const uint8_t* bytes, uint32_t index, size_t from, size_t to) HWY_ATTR {
        const uint32_t shift = 32 - rung.log, factor = len > 4 ? kLastFactor : 0, index_bits = ladder.index_bits;
#pragma clang loop vectorize(disable)
        for (uint32_t* const table = ladder.entries; from < to; from++) {
            const uint32_t hash = Load<uint32_t>(bytes + from) * kFirstFactor + Load<uint32_t>(bytes + from + len - 4) * factor;
            __builtin_prefetch(table + (hash >> shift));
            table[hash >> shift] = (hash >> kWeakBits << index_bits) + index + from;
        }
    };
    ladder.term = std::max<size_t>(ladder.term, again);
    if (again > at)
        fill(r.older, ladder.index - r.older_len, r.older_len - (again - at), r.older_len - 8);
    fill(r.prefix, ladder.index, at - std::min(again, at), std::min(at, r.end - 8));
}

// Likewise, the first rung may be too long.
static HWY_NOINLINE void Probe(const Request& r, Work& w, size_t at)
{
    Ladder& ladder = *r.ladder;
    const size_t from = at - std::min<size_t>(at, 512);
    if (ladder.rungs[0].len <= ladder.len_min || w.links.literal < 80)
        return;
    uint32_t* const seen = w.slots;
    memset(seen, 0, 1024 * sizeof(*seen));
    size_t hits = 0;
    for (size_t i = from; i + 8 <= at; i++) {
        const uint32_t hash = (Load<uint64_t>(r.prefix + i) << (64 - 8 * ladder.len_min)) * 0x9E3779B97F4A7C15u >> 32;
        hits += std::exchange(seen[hash >> 22], hash) == hash;
    }
    if (hits >= 8)
        ladder.term = -1, ladder.sequences = 0;
}

template<bool kHasOlder>
static HWY_INLINE size_t SearchLinked(Request& r, Work& w)
{
    constexpr size_t kKept = 128, kCaughtUp = 64;
    Writer writer = { r, w.out, r.start };
    Chunk c = { r, w };
    Ladder& ladder = *r.ladder;
    r.max_distance = std::min(r.max_distance, kFar);
    size_t at = std::max<size_t>(r.start, 1), known = 0, len = 256, priced = 0, parser = 0, idle = 0, favorite = 0, has_time = 0;
    // The tables lack most of what long matches cover.
    if (const size_t recent = r.repeats[0]; recent - 1 < std::min<size_t>(at + r.older_len, r.max_distance)) {
        if (const size_t more = MatchLen(r, r.start + 1, recent, r.end); more >= std::min<size_t>(32, r.end - r.start - 1)) {
            writer.Write(r.start + 1, more, recent);
            Cover(r, w, r.start, at = writer.anchor);
            ladder.saved += more;
        }
    }
    while (at < r.end) {
        const size_t from = std::max(known, at);
        len = at > known + 256 ? 256 : len;
        const size_t to = std::min(from + len + len / 2 >= r.end ? r.end : from + len, from + kChunk);
        len = std::min(2 * len, kChunk);
        memset(w.valid, 0, kBehind / 8);
        if (at <= known) {
            memcpy(w.first + kBehind - kKept, w.first + (known - kKept - c.origin), kKept * sizeof(*w.first));
            memcpy(w.valid + (kBehind - kKept) / 8, w.valid + (known - kKept - c.origin) / 8, kKept / 8);
        }
        c.origin = from - kBehind, c.start = at;
        const size_t behind = static_cast<uint32_t>(ladder.index + from - ladder.next), start = from - (std::min({ behind + 7, from, kCaughtUp }) & ~7);
        uint32_t* found = w.first + (start - c.origin);
        uint8_t* valid = w.valid + (start - c.origin) / 8;
        const auto index_all = [&](Ladder& ladder, bool stores, uint32_t* found, uint8_t* valid) HWY_ATTR {
            const uint32_t reach = std::min<size_t>(ReachOf(r, ladder, ladder.rungs[0]), to + r.older_len);
            return IndexAll(r, ladder, ladder.rungs[0], ladder.entries, stores, reach, start, to, found, valid);
        };
        if (static_cast<int32_t>(ladder.term) < 0 && ladder.len_min > 3)
            Review(r, start), ladder.misses = at - writer.anchor;
        const size_t hits = index_all(ladder, true, found, valid);
        ladder.term -= to - from, ladder.misses += ((to - start) & ~63) - hits;
        if ((ladder.count > 1 && ladder.rungs[1].spacing < kRare) || r.attached)
            Mark(c, start, to);
        if (kHasOlder && r.attached) {
            index_all(*r.attached, false, w.attached, w.attached_valid);
            for (size_t i = 0; start + i < to; i += 8) {
                const U32x8 bits = { 1, 2, 4, 8, 16, 32, 64, 128 };
                Store(found + i, (bits & valid[i / 8]) == 0 ? Load<U32x8>(w.attached + i) : Load<U32x8>(found + i));
                valid[i / 8] |= w.attached_valid[i / 8];
            }
            IndexAbove(c, *r.attached, false, 0, start, to);
        }
        memset(valid, 0xFF, (from - start) / 8);
        const size_t longest = IndexAbove(c, ladder, true, -(hits * 2 >= to - start), start, to, has_time);
        // What has made a long match may do so again.
        for (size_t i = from; ladder.saved && favorite - 1 < i && i + 64 <= to; i += 32) {
            const uint8_t* bytes = r.prefix + i;
            if (HWY_UNLIKELY(!Differences(bytes, bytes - favorite)) && !Differences(bytes + 32, bytes + 32 - favorite) && Differences(bytes, bytes + 1))
                std::fill_n(w.first + (i - c.origin), 56, favorite);
        }
        if (at > known)
            memset(w.valid, 0, kBehind / 8);
        ladder.next = ladder.index + (to < r.end ? to : std::max(r.end + 1, longest) - longest);
        known = to;
        if (at >= priced) {
            DeriveRoughly(r, w.links, at);
            // Unless they are rare.
            parser = r.parser == kLinkedWithRepeats && w.links.offset[0] > 24 && !w.links.mostly_repeats ? kLinked : r.parser;
            parser = w.links.is_exact ? kLinkedExactly : parser;
            priced = at + std::min<size_t>(at / 4, r.parser == kLinkedExactly ? 2048 : 16384);
        }
        const size_t floor = std::max({ writer.anchor, from - std::min(from, kBehind - 64), size_t { 1 } }) - c.origin;
        for (size_t i = kBehind - kKept; i < floor; i += 8)
            w.valid[i / 8] &= 0xFF << std::min<size_t>(floor - i, 8);
        const size_t links = Link<kHasOlder>(c, floor, at - c.origin, to - c.origin);
        const size_t firm = to - c.origin - (to == r.end ? 0 : 16);
        const auto choose = parser == kLinked ? Choose<kLinked> : parser == kLinkedWithRepeats ? Choose<kLinkedWithRepeats>
                                                                                               : Choose<kLinkedExactly>;
        const int32_t cheapest = choose(c, links, floor, to - c.origin);
        at = (parser == kLinked ? Follow<false> : Follow<true>)(c, writer, cheapest & (kRepeated - 1), firm);
        if (at >= known + kCoveredMin)
            Cover(r, w, known, at);
        has_time = links * (ladder.saved && ladder.count > 2 ? 4 : 20) < hits && !w.links.mostly_repeats;
        if (links * (ladder.saved ? 4 : 12) < to - from + 256)
            Recall(writer, w), at = std::max(at, writer.anchor);
        // The time that long matches save is for what is between them.
        ladder.saved = std::clamp<ptrdiff_t>(ladder.saved + std::max<ptrdiff_t>(at - known, 0) - (to - from), 0, 1 << 20);
        if (at >= known + 100 && r.repeats[0] > 32)
            favorite = r.repeats[0];
        const bool is_poor = static_cast<size_t>(-(cheapest >> kLinkBits)) * 2 <= to - from;
        idle = is_poor ? idle + (to - from) : at - writer.anchor;
        if (is_poor && at <= known)
            Forget(r, priced = at, 1), Probe(r, w, at);
        if (idle >= r.patience && !r.attached) {
            at = Skip(r, std::max(at, known + 1), idle);
            ladder.misses += at - known, idle += at - known;
        }
    }
    return writer.anchor;
}

// For so little that getting ready would take most of the time.
static HWY_NOINLINE size_t SearchBriefly(Request& r, Work& w)
{
    Writer writer = { r, w.out, r.start };
    Ladder& ladder = *r.ladder;
    const size_t behind = static_cast<uint32_t>(ladder.index + r.start - ladder.next), from = r.start - std::min<size_t>({ behind, r.start, 64 });
    const size_t end = r.end + 1 - std::max({ ladder.rungs[0].len, r.attached ? r.attached->rungs[0].len : 0, 4u });
    for (size_t at = from; at < end; at++) {
        const auto [slot, entry] = FirstSlot(r, ladder, at);
        const uint32_t own = entry - std::exchange(slot, entry);
        if (at < writer.anchor)
            continue;
        // The first one has to pay for the headers.
        Match best = { writer.anchor == r.start && r.end - at < 16 ? 7u : 3u };
        const auto consider = [&](uint32_t distance, size_t reach) HWY_ATTR {
            if (distance - 1 >= std::min(reach, at + r.older_len))
                return;
            if (const size_t len = MatchLen(r, at, distance, r.end); len > best.len)
                best = { len, distance };
        };
        consider(own, ReachOf(r, ladder, ladder.rungs[0]));
        if (r.attached) {
            const auto [slot, entry] = FirstSlot(r, *r.attached, at);
            consider(entry - slot, ReachOf(r, *r.attached, r.attached->rungs[0]));
        }
        if (at - writer.anchor < 2)
            consider(r.repeats[0], r.max_distance);
        if (best.distance) {
            const size_t back = MatchLenBefore(r, at, best.distance, at - writer.anchor);
            writer.Write(at - back, best.len + back, best.distance);
        }
    }
    Grow(ladder, ladder.rungs[0], ladder.entries, (end - from) / 2);
    ladder.next = ladder.index + end;
    return writer.anchor;
}

static size_t Search(Request* r, Work* w)
{
    if (r->parser == kBrief)
        return SearchBriefly(*r, *w);
    if (r->parser < kOptimalOfOne)
        return r->older_len ? SearchLinked<true>(*r, *w) : SearchLinked<false>(*r, *w);
    return r->older_len ? SearchOptimal<true>(*r, *w) : SearchOptimal<false>(*r, *w);
}

static void Fill(Request* r, Work* w, size_t to)
{
    Chunk c = { *r, *w };
    Ladder& ladder = *r->ladder;
    for (size_t from = r->start; from < to; from += kChunk) {
        const size_t end = std::min(from + kChunk, to);
        c.origin = from - kBehind;
        uint32_t* table = ladder.entries;
        for (size_t k = 0; k < ladder.count; table += size_t { 1 } << ladder.rungs[k++].room_log) {
            if (k == 0 || ladder.rungs[k].len == 3)
                IndexAll(*r, ladder, ladder.rungs[k], table, true, ReachOf(*r, ladder, ladder.rungs[k]), from, end, w->first, w->valid);
        }
        Mark(c, from, end);
        IndexAbove(c, ladder, true, ~0u, from, end);
    }
}

} // namespace HWY_NAMESPACE
} // namespace bun::zstd
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun::zstd {
HWY_EXPORT(Search);
HWY_EXPORT(Fill);

extern "C" const size_t highway_zstd_ladder_work_len = sizeof(Work);

// Whatever the bytes, the tables, the hints, the counts, the repeats and `work` hold, these stay within them.
extern "C" size_t highway_zstd_ladder_search(Request* request, Work* work)
{
    return BUN_HWY_DISPATCH(Search)(request, work);
}

extern "C" void highway_zstd_ladder_fill(Request* request, Work* work, size_t to)
{
    BUN_HWY_DISPATCH(Fill)(request, work, to);
}
} // namespace bun::zstd
#endif
