// The search for matches of the lower levels of the encoder in src/zstd, and what it does for each sequence. All targets give the same results.
//
// Stages go through lists for a chunk of the input without branching on it. Positions that the content picks swap places with what a hash table
// has for them. What that turns up is measured, and a cover is chosen from it. A second round with shorter hashes looks into what is left open.
//
// The input may change at any time: no bound depends on two reads of it giving the same.

#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | HWY_NEON | HWY_NEON_BF16 | HWY_SSE4 | (HWY_AVX2 - 1))
#ifndef __OPTIMIZE__
#error "Unless hwy::ChosenTarget::GetIndex() is inlined, the linker may keep that of a file with other targets."
#endif

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_zstd_stages.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <algorithm>
#include <array>
#include <bit>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <utility>

#ifndef BUN_ZSTD_STAGES_TYPES
#define BUN_ZSTD_STAGES_TYPES
namespace bun::zstd_stages {

template<class T, size_t N> using Lanes __attribute__((ext_vector_type(N))) = T;
using U8x8 = Lanes<uint8_t, 8>;
using U8x16 = Lanes<uint8_t, 16>;
using U8x32 = Lanes<uint8_t, 32>;
using I8x32 = Lanes<int8_t, 32>;
using U16x16 = Lanes<uint16_t, 16>;
using I16x16 = Lanes<int16_t, 16>;
using U32x8 = Lanes<uint32_t, 8>;
using I32x8 = Lanes<int32_t, 8>;
using F32x8 = Lanes<float, 8>;

// See src/highway/zstd_stages.rs, which also checks the values.
struct Effort {
    bool is_single, is_narrow;
    uint8_t short_len, cut;
    uint16_t narrow_from, all_from, second_from, repeats_from, records_from;
};

struct Trend {
    uint32_t repeating, idle;
    uint16_t per_bit;
    bool is_covered, is_poor, is_dense, is_text, is_rich, walks;
};

struct Table {
    uint32_t* entries;
    size_t log;
};

struct Request {
    const uint8_t* bytes;
    size_t len;
    Table tables[2];
    uint32_t* scratch;
    const Effort* efforts;
    uint32_t index, max_distance;
};

struct Sink {
    uint8_t* sequences;
    size_t sequence_count;
    // Where the next ones go.
    uint8_t* literals;
    size_t anchor;
    uint32_t* counts;
    Trend* trend;
    uint32_t repeats[3];
};

struct Codes {
    const uint16_t* next_states;
    const uint16_t (*ranges)[64][2];
    uint32_t logs[3];
};

struct Progress {
    size_t position;
    uint64_t bits;
    uint32_t bit_count, states[3];
};

constexpr uint32_t kIndexBits = 24, kMatchMin = 4, kUnknown = ~0u;
constexpr uint64_t kMultiplier = 0xCF1BBCDCB7A56463;
constexpr size_t kSequenceLen = 12;
constexpr uint32_t kFirstSymbols = 64 << 8 | 128 << 16;

constexpr size_t kChunk = 4096;
// How far positions start before their chunk.
constexpr size_t kMargin = 32;
// Ends fit in 16 bits.
constexpr size_t kEndMax = 0xF000;
// How far before their position the two rounds compare, and a third of how far from it on.
constexpr uint32_t kBackLong = 16, kBackShort = 8;

// The lists in the scratch memory, with an entry per position or per match. One pointer goes through all of them.
constexpr size_t kRoom = kChunk + 5 * kMargin, kFewer = kRoom / 4 + 72;
constexpr size_t kPositions = 16, kDistances = kPositions + kRoom, kOffsets = kDistances + kRoom;
// The start in the low half, and the end in the high one.
constexpr size_t kSpans = kOffsets + kRoom;
constexpr size_t kChosenSpans = kSpans + kRoom, kChosenOffsets = kChosenSpans + kFewer, kSymbols = kChosenOffsets + kFewer;
// A byte per position.
constexpr size_t kRanks = kSymbols + kFewer;
// A bit per position, which tells whether it is listed, and how many are before those of a word.
constexpr size_t kMasks = kRanks + kRoom / 4, kListed = kOffsets;
constexpr size_t kLens = kPositions, kValues = kDistances;
static_assert(kMasks + kRoom / 32 + 32 <= 21700, "SCRATCH_LEN");
// Nothing is found in less.
constexpr size_t kLenMin = 64;

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
alignas(16) inline constexpr auto kKeptBytes = Tabulate<256>([](size_t i) { return uint8_t(4 * (kSetBits[i / 16] >> i / 4 % 4 * 8) + i % 4); });
inline constexpr auto kReversed = Tabulate<256>([](size_t bits) { return __builtin_bitreverse8(bits); });

// By an eighth of the length of a match less 3, or of a number of literals plus 16.
constexpr std::array<uint8_t, 16> kExtraBits = { 0, 0, 0, 0, 1, 2, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5 };
// To add once the extra bits are shifted out.
constexpr std::array<uint8_t, 16> kCodeBases = { 0, 0, 0, 0, 16, 26, 32, 32, 36, 36, 36, 36, 39, 39, 39, 39 };

} // namespace bun::zstd_stages
#endif

HWY_BEFORE_NAMESPACE();
namespace bun::zstd_stages {
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
template<class T, class U> static HWY_INLINE T To(U lanes) { return __builtin_convertvector(lanes, T); }
template<class T> static HWY_INLINE T Min(T a, std::type_identity_t<T> b) { return __builtin_elementwise_min(a, b); }
template<class T> static HWY_INLINE T Max(T a, std::type_identity_t<T> b) { return __builtin_elementwise_max(a, b); }
template<class T> static HWY_INLINE T Less(T a, std::type_identity_t<T> b) { return __builtin_elementwise_sub_sat(a, b); }
template<class T> static HWY_INLINE T Either(bool is, T a, std::type_identity_t<T> b) { return __builtin_unpredictable(is) ? a : b; }
template<class T = U32x8> static HWY_INLINE T Eight(const uint32_t* from) { return Load<T>(from); }
static HWY_INLINE size_t LowHalf(const uint32_t* of) { return Load<uint16_t>(of); }
static HWY_INLINE size_t HighHalf(const uint32_t* of) { return Load<uint16_t>(reinterpret_cast<const uint8_t*>(of) + 2); }
static HWY_INLINE U16x16 Pair(uint16_t low, uint16_t high) { return As<U16x16>(U32x8(low | uint32_t { high } << 16)); }
static HWY_INLINE I32x8 Shr(I32x8 lanes, int by) { return As<I32x8>(As<U32x8>(lanes) >> by); }
static HWY_INLINE uint32_t LowBits(uint32_t value, uint32_t count) { return value & ((1u << count) - 1); }
static HWY_INLINE U32x8 SetBits(size_t mask) { return To<U32x8>(As<U8x8>(kSetBits.data()[mask])); }
static HWY_INLINE I32x8 LaneNumbers() { return I32x8 { 0, 1, 2, 3, 4, 5, 6, 7 }; }
template<size_t N> static HWY_INLINE I8x32 OneInEvery()
{
    return As<I8x32>(Tabulate<32>([](size_t i) { return int8_t(i % N == 0); }));
}

// Or else the compiler makes a loop count, and addresses with an index take Intel's CPUs more steps.
template<class T> static HWY_INLINE T Opaque(T value)
{
    asm("" : "+r"(value));
    return value;
}

template<class T> static HWY_INLINE T LeadingZeros(T value)
{
#if HWY_TARGET == HWY_AVX2
    // Highway checks for it, but does not tell the compiler.
    T count;
    asm("lzcnt %1, %0" : "=r"(count) : "r"(value) : "cc");
    return count;
#else
    return std::countl_zero(value);
#endif
}
static HWY_INLINE uint32_t Log2(uint32_t value) { return 31 ^ LeadingZeros(value | 1); }

template<class T> using D = hn::CappedTag<T, 32 / sizeof(T)>;
template<class T> using V = hn::Vec<D<T>>;

// Half by half, if that is the size of vectors.
template<class R, class A, size_t kA, class B, size_t kB, class F> static HWY_INLINE R Natively(Lanes<A, kA> a, Lanes<B, kB> b, F op)
{
#if HWY_TARGET == HWY_AVX2
    return As<R>(op(As<V<A>>(a), As<V<B>>(b)));
#else
    U8x32 result;
    result.lo = As<U8x16>(op(As<V<A>>(Lanes<A, kA / 2>(a.lo)), As<V<B>>(Lanes<B, kB / 2>(b.lo))));
    result.hi = As<U8x16>(op(As<V<A>>(Lanes<A, kA / 2>(a.hi)), As<V<B>>(Lanes<B, kB / 2>(b.hi))));
    return As<R>(result);
#endif
}

static HWY_INLINE I32x8 Select(I32x8 mask, I32x8 yes, I32x8 no)
{
#if HWY_TARGET == HWY_AVX2
    return As<I32x8>(hn::IfNegativeThenElse(As<V<int8_t>>(mask), As<V<int8_t>>(yes), As<V<int8_t>>(no)));
#else
    return (yes & mask) | (no & ~mask);
#endif
}

static HWY_INLINE uint32_t Signs(I32x8 of) { return As<uint8_t>(To<Lanes<bool, 8>>(of < 0)); }

#if HWY_ARCH_ARM_A64
// Every byte has the bits of two, which are 0 or -1.
static HWY_INLINE V<uint8_t> PairBits(I8x32 of)
{
    const U8x32 bits = As<U8x32>(of) & As<U8x32>(Lanes<uint64_t, 4>(0x8040201008040201));
    return V<uint8_t>(vpaddq_u8(As<uint8x16_t>(U8x16(bits.lo)), As<uint8x16_t>(U8x16(bits.hi))));
}
static HWY_INLINE uint64_t Signs(I8x32 low, I8x32 high)
{
    const uint8x16_t bits = vpaddq_u8(PairBits(low >> 7).raw, PairBits(high >> 7).raw);
    return vgetq_lane_u64(vreinterpretq_u64_u8(vpaddq_u8(bits, bits)), 0);
}
static HWY_INLINE uint32_t Signs(I8x32 of) { return Signs(of, of); }
#else
static HWY_INLINE uint32_t Signs(I8x32 of) { return As<uint32_t>(To<Lanes<bool, 32>>(of < 0)); }
static HWY_INLINE uint64_t Signs(I8x32 low, I8x32 high) { return Signs(low) | uint64_t { Signs(high) } << 32; }
#endif

static HWY_INLINE I8x32 Same(I8x32 a, I8x32 b) { return As<I8x32>(a == b); }
static HWY_INLINE I8x32 Above(I8x32 a, I8x32 b) { return As<I8x32>(a > b); }
static HWY_INLINE I8x32 Same(const void* a, const void* b) { return Same(Load<I8x32>(a), Load<I8x32>(b)); }

// Which lanes to keep.
struct Kept {
#if HWY_TARGET == HWY_AVX2
    U32x8 lanes;
    HWY_INLINE Kept(size_t mask)
        : lanes(SetBits(mask))
    {
    }
    // Writes 8 lanes, those to keep first.
    HWY_INLINE void Put(uint32_t* to, U32x8 all) const
    {
        Store(to, hn::TableLookupLanes(As<V<uint32_t>>(all), hn::IndicesFromVec(D<uint32_t>(), As<V<uint32_t>>(lanes))));
    }
#else
    U8x32 bytes;
    size_t low_count;
    HWY_INLINE Kept(size_t mask)
        : low_count(0x4332322132212110 >> mask % 16 * 4 & 7)
    {
        bytes.lo = Load<U8x16>(kKeptBytes.data() + mask % 16 * 16);
        bytes.hi = Load<U8x16>(kKeptBytes.data() + mask / 16 * 16);
    }
    HWY_INLINE void Put(uint32_t* to, const U32x8& all) const
    {
        const auto kept = Natively<U8x32>(As<U8x32>(all), bytes, [](auto a, auto b) HWY_ATTR { return hn::TableLookupBytes(a, b); });
        Store<U8x16>(to, kept.lo);
        Store<U8x16>(to + low_count, kept.hi);
    }
#endif
};

// By up to 63.
static HWY_INLINE U32x8 Shl(U32x8 lanes, U32x8 by)
{
#if HWY_TARGET == HWY_AVX2 || HWY_ARCH_ARM_A64
    return Natively<U32x8>(lanes, by, [](auto a, auto b) HWY_ATTR { return a << b; });
#else
    return lanes << (by & 31) & As<U32x8>(As<I32x8>(by) < 32);
#endif
}
static HWY_INLINE U32x8 Shr(U32x8 lanes, U32x8 by)
{
#if HWY_TARGET == HWY_AVX2 || HWY_ARCH_ARM_A64
    return Natively<U32x8>(lanes, by, [](auto a, auto b) HWY_ATTR { return a >> b; });
#else
    return lanes >> (by & 31) & As<U32x8>(As<I32x8>(by) < 32);
#endif
}

// Of positive numbers with no more than 24 significant bits.
template<class T> static HWY_INLINE T Log2(Lanes<decltype(T {}.x), 8> of) { return As<T>((As<U32x8>(To<F32x8>(As<I32x8>(of))) >> 23) - 127); }

// 0 for indices from 128 on. The others are below 16.
static HWY_INLINE U16x16 LookUp(std::array<uint8_t, 16> table, U16x16 indices)
{
    const auto twice = As<U8x32>(std::array { table, table });
    return Natively<U16x16>(twice, As<U8x32>(indices), [](auto a, auto b) HWY_ATTR { return hn::TableLookupBytesOr0(a, b); });
}

// The sums of the products of neighbours, which fit in 16 bits.
static HWY_INLINE I32x8 Dot(I16x16 a, I16x16 b)
{
#if HWY_ARCH_X86
    return Natively<I32x8>(a, b, [](auto a, auto b) HWY_ATTR { return hn::WidenMulPairwiseAdd(D<int32_t>(), a, b); });
#else
    const auto products = As<U32x8>(a * b);
    return As<I32x8>(products + (products << 16)) >> 16;
#endif
}

// For every two bytes, of which one may be -1 and not 0: -1 less its number, or 0.
static HWY_INLINE I16x16 NumberPairs(I8x32 marks)
{
    const auto numbers = As<U8x32>(Tabulate<32>([](size_t i) { return uint8_t(i + 1); }));
#if HWY_ARCH_X86
    return Natively<I16x16>(numbers, marks, [](auto a, auto b) HWY_ATTR { return hn::SatWidenMulPairwiseAdd(D<int16_t>(), a, b); });
#else
    const auto marked = As<U16x16>(numbers & As<U8x32>(marks));
    return -As<I16x16>((marked | marked << 8) >> 8);
#endif
}

#if HWY_TARGET == HWY_AVX2
// Every third lane of each.
static HWY_INLINE U32x8 Thirds(U32x8 a, U32x8 b, U32x8 c)
{
    U32x8 all = __builtin_shufflevector(__builtin_shufflevector(a, b, 0, 9, 2, 3, 12, 5, 6, 15), c, 0, 1, 10, 3, 4, 13, 6, 7);
    asm("" : "+x"(all));
    return all;
}
#endif

static HWY_INLINE std::array<U32x8, 3> LoadSequences(const uint8_t* from)
{
#if HWY_TARGET == HWY_AVX2
    const auto a = Load<U32x8>(from), b = Load<U32x8>(from + 32), c = Load<U32x8>(from + 64);
    return { Thirds(a, b, c).s03614725, Thirds(c, a, b).s14725036, Thirds(b, c, a).s25036147 };
#else
    std::array<U32x8, 3> fields;
    for (size_t i = 0; i < 24; i++)
        fields[i % 3][i / 3] = Load<uint32_t>(from + 4 * i);
    return fields;
#endif
}

static HWY_INLINE void StoreSequences(uint8_t* to, U32x8 a, U32x8 b, U32x8 c)
{
#if HWY_TARGET == HWY_AVX2
    a = a.s03614725, b = b.s50361472, c = c.s25036147;
    asm("" : "+x"(a), "+x"(b), "+x"(c));
    Store(to, Thirds(a, b, c));
    Store(to + 32, Thirds(c, a, b));
    Store(to + 64, Thirds(b, c, a));
#else
    const auto ab = __builtin_shufflevector(a, b, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
    const auto cc = __builtin_shufflevector(c, c, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
    Store(to, __builtin_shufflevector(ab, cc, 0, 8, 16, 1, 9, 17, 2, 10));
    Store(to + 32, __builtin_shufflevector(ab, cc, 18, 3, 11, 19, 4, 12, 20, 5));
    Store(to + 64, __builtin_shufflevector(ab, cc, 13, 21, 6, 14, 22, 7, 15, 23));
#endif
}

// Positions in lists count from `origin` on.
struct Chunk {
    const uint8_t* origin;
    uint32_t* scratch;
    // How many bytes are before the origin, and from it on.
    size_t base, limit;
    // 8 bytes follow the end. For what looks at ranks or repeats, it is at most `kChunk + kMargin`.
    uint32_t start, end;
    // Of the origin. Positions include it until they are filtered.
    uint32_t index;

    HWY_INLINE Chunk(const Request& r, size_t from, size_t len)
        : scratch(r.scratch + -reinterpret_cast<uintptr_t>(r.scratch) % 64 / 4)
        , base(Less(from, kMargin))
    {
        origin = r.bytes + base, limit = r.len - base;
        index = r.index + base;
        start = from - base, end = std::min(limit - 8, start + len);
    }
    // Whether what gets compared around positions may be outside of the input.
    HWY_INLINE bool IsAtEdge() const { return base == 0 || end + 80 > limit; }
    HWY_INLINE void Clear(size_t from, size_t len) const { memset(scratch + from, 0, 4 * len); }
    template<class T> HWY_INLINE T* Bytes(size_t list) const { return reinterpret_cast<T*>(scratch + list); }
};

// Where a match ends that got to `at`.
static HWY_INLINE size_t Extend(const Chunk& c, size_t at, uint32_t offset, size_t limit)
{
    for (; at + 32 <= limit; at += 32) {
        if (const uint32_t differ = ~Signs(Same(c.origin + at, c.origin + at - offset)))
            return at + __builtin_ctz(differ);
    }
    while (at < limit && c.origin[at] == *(c.origin + at - offset))
        at++;
    return at;
}

// Up to 71 entries past the end.
static HWY_NOINLINE void Rank(const Chunk& c)
{
    const auto rank = [bytes = c.origin, ranks = c.Bytes<int8_t>(kRanks)](size_t at) HWY_ATTR { Store(ranks + at, Load<U8x32>(bytes + at) - Load<U8x32>(bytes + at + 1)); };
    const size_t end = c.end + 7, last = std::min(end, c.limit - 33);
    for (size_t at = 0; at < last; at += 32)
        rank(at);
    rank(end - 32);
    memset(c.Bytes<int8_t>(kRanks) + end, 0, 64);
}

// Lists the positions for which the lowest of the ranks from `kBefore` earlier on is in the middle. Returns how many there are.
template<size_t kRadius, size_t kBefore = kRadius + 1> static HWY_NOINLINE size_t Pick(const Chunk& c)
{
    const uint32_t first = std::max<uint32_t>(c.start, kBefore);
    const int8_t* ranks = c.Bytes<int8_t>(kRanks) - kBefore;
    uint32_t *const list = c.scratch + kPositions, *to = list;
    U32x8 before = c.index + first - 1, waiting = 0, pending = 0;
    I32x8 waiting_numbers = 0;
    Kept kept(0);
    size_t kept_count = 0;
    const auto add = [&](I32x8 numbers) HWY_ATTR {
        // In later steps, or the CPU would fill up with instructions that wait.
        kept.Put(to, pending);
        to += kept_count;
        const uint32_t mask = Signs(waiting_numbers);
        pending = waiting, kept = Kept(mask), kept_count = std::popcount(mask);
        waiting = before - As<U32x8>(numbers), waiting_numbers = numbers;
    };
    uintptr_t ahead = reinterpret_cast<uintptr_t>(c.origin) + kChunk;
    for (const int8_t *at = ranks + first, *end = ranks + c.end; at < end; at = Opaque(at + 32), before += 32, ahead += 32) {
        I8x32 left = Load<I8x32>(at), middle = Load<I8x32>(at + kRadius), right = Load<I8x32>(at + kRadius + 1);
        for (size_t next = 1; next < kRadius; next++)
            left = Min(left, Load<I8x32>(at + next)), right = Min(right, Load<I8x32>(at + kRadius + 1 + next));
        // Where all are the same, some win. They come first in their lane, so no two winners share one.
        I8x32 wins = Above(left, Less(middle, OneInEvery<8>())) & ~Above(middle, right);
        const I16x16 numbers = NumberPairs(wins);
        if (kRadius >= 3) {
            add(Dot(numbers, 1));
        } else {
            add(To<I32x8>(numbers.lo));
            add(To<I32x8>(numbers.hi));
        }
        __builtin_prefetch(reinterpret_cast<const void*>(ahead), 0, 2);
    }
    add(0);
    add(0);
    while (to != list && to[-1] - c.index >= c.end)
        to--;
    return to - list;
}

// One in every `step`. At random, or a copy could be tried wherever the original was not.
static HWY_NOINLINE size_t PickAny(const Chunk& c, uint16_t step)
{
    U32x8 firsts = c.index + c.start + As<U32x8>(As<U16x16>(LaneNumbers()) * step);
    U16x16 random = (As<U16x16>(LaneNumbers()) + uint16_t(c.base)) * uint16_t(0x9E37);
    const size_t count = (c.end - c.start) / step;
    for (size_t i = 0; i < count; i += 8, firsts += 8u * step, random = random * 0x6255 + 0x3619)
        Store(c.scratch + kPositions + i, firsts + As<U32x8>((random >> 8) * Pair(step, 0) >> 8));
    return count;
}

// Lists the distances, which are negative unless the hashes differ.
template<uint32_t kLen> static HWY_NOINLINE void Exchange(const Chunk& c, Table table, size_t count)
{
    const auto one = [bytes = reinterpret_cast<uintptr_t>(c.origin) - c.index, entries = table.entries, shift = 64 - table.log](uint32_t* at) HWY_ATTR {
        const uint32_t index = at[kPositions];
        const auto* from = reinterpret_cast<const void*>(bytes + index);
        const uint64_t word = kLen == 4 ? Load<uint32_t>(from) : Load<uint64_t>(from) & ~uint64_t { 0 } >> (64 - 8 * kLen), hash = word * kMultiplier;
        const uint32_t entry = (uint32_t(hash) & ~0u << kIndexBits) + index;
        at[kDistances] = std::exchange(entries[hash >> shift], entry) - entry;
    };
    uint32_t* at = c.scratch;
    for (uint32_t* end = at + count / 4 * 4; at != end; at = Opaque(at + 4))
        one(at), one(at + 1), one(at + 2), one(at + 3);
    for (size_t i = 0; i < count % 4; i++)
        one(at + i);
}

// Leaves the positions with a new candidate, which is earlier, and listed in place of the offset. There are `kBack` bytes before it, except at an edge.
template<uint32_t kBack> static HWY_NOINLINE size_t Filter(const Chunk& c, uint32_t max_distance, size_t count)
{
    c.Clear(kDistances + count, 8);
    c.Clear(kDistances - 1, 1);
    const I32x8 lowest = int32_t((c.IsAtEdge() ? 0 : kBack) - c.base), farthest = -int32_t(max_distance);
    const U32x8 index = c.index;
    uint32_t* to = c.scratch;
    for (uint32_t *at = to, *end = at + count; at < end; at = Opaque(at + 8)) {
        const auto entries = As<I32x8>(Eight(at + kPositions) - index), distances = Eight<I32x8>(at + kDistances);
        I32x8 positions = entries, is_known = distances == Eight<I32x8>(at + kDistances - 1);
        if (kBack == kBackShort)
            positions &= 0xFFFF, is_known &= entries == positions;
        const auto candidates = As<U32x8>(positions) + As<U32x8>(distances);
        const uint32_t mask = Signs(distances & ~((farthest > distances) | (lowest > As<I32x8>(candidates)) | is_known));
        const Kept kept(mask);
        kept.Put(to + kPositions, As<U32x8>(entries));
        kept.Put(to + kOffsets, candidates);
        to += std::popcount(mask);
    }
    return to - c.scratch;
}

template<uint32_t kBack> static HWY_INLINE uint64_t SameAround(const uint8_t* a, const uint8_t* b)
{
    return kBack == kBackShort ? Signs(Same(a, b)) : Signs(Same(a, b), Same(a + 32, b + 32));
}

// With nothing the same outside of the input.
template<uint32_t kBack> static HWY_NOINLINE uint64_t SameAtEdge(const Chunk& c, ptrdiff_t position, ptrdiff_t offset)
{
    const ptrdiff_t from = position - kBack, first = offset - c.base, last = c.limit - 4 * kBack;
    if (first <= last) {
        const ptrdiff_t later = std::max(from, first), earlier = std::min(from, last);
        const uint8_t* at = c.origin + std::min(later, last);
        return SameAround<kBack>(at, at - offset) << (later - from) >> (from - earlier);
    }
    uint64_t same = 0;
    for (ptrdiff_t at = std::max(from, first); at < std::min<ptrdiff_t>(from, last) + 4 * kBack; at++)
        same |= uint64_t { c.origin[at] == c.origin[at - offset] } << (at - from);
    return same;
}

// Lists in place of the spans how many bytes are the same before and from each position.
template<uint32_t kBack, bool kIsAtEdge> static HWY_NOINLINE void Compare(const Chunk& c, size_t count)
{
    using Bits = std::conditional_t<kBack == kBackShort, uint32_t, uint64_t>;
    const auto one = [&c, bytes = c.origin, lowest = ptrdiff_t(kBack - c.base), highest = ptrdiff_t(c.limit - 3 * kBack)](uint32_t* at) HWY_ATTR {
        const ptrdiff_t position = LowHalf(at + kPositions), candidate = int32_t(at[kOffsets]);
        Bits same;
        if (kIsAtEdge && HWY_UNLIKELY(candidate < lowest || position > highest))
            same = SameAtEdge<kBack>(c, position, position - candidate);
        else
            same = SameAround<kBack>(bytes + position - kBack, bytes + candidate - kBack);
        const Bits differ = std::rotr(Bits(~same), kBack);
        Store<uint16_t>(at + kSpans, LeadingZeros(differ));
        Store<uint16_t>(reinterpret_cast<uint8_t*>(at + kSpans) + 2, std::countr_zero(differ));
    };
    uint32_t* at = c.scratch;
    for (uint32_t* end = at + count / 2 * 2; at != end; at = Opaque(at + 2))
        one(at), one(at + 1);
    if (count % 2)
        one(at);
}

// Makes spans and offsets what they are called. One new span at most ends more than 48 bytes behind the chunk.
template<uint32_t kBack> static HWY_NOINLINE void Span(const Chunk& c, size_t count)
{
    const U16x16 most = Pair(kBack, 3 * kBack);
    const size_t limit = std::min(c.limit, kEndMax), far = c.end + 48;
    for (size_t list : { kPositions, kOffsets, kSpans })
        c.Clear(list + count, 24);
    size_t covered = 0;
    for (uint32_t *at = c.scratch, *end = at + count; at < end;) {
        uint32_t* const group = at;
        uint64_t go_on = 0;
        for (size_t shift = 0; shift < 64 && at < end; shift += 8, at = Opaque(at + 8)) {
            const U32x8 entries = Eight(at + kPositions), positions = kBack == kBackShort ? entries & 0xFFFF : entries;
            const U16x16 lens = Min(Eight<U16x16>(at + kSpans), most);
            U16x16 spans = As<U16x16>(positions | entries << 16) + lens * Pair(0xFFFF, 1);
            auto goes_on = As<I32x8>(lens == most);
            if (kBack == kBackShort)
                spans = Max(spans, As<U16x16>(entries ^ positions)), goes_on &= entries == positions;
            Store(at + kSpans, spans);
            Store(at + kOffsets, positions - Eight(at + kOffsets));
            go_on |= uint64_t { Signs(goes_on) } << shift;
        }
        for (; go_on && covered <= far; go_on &= go_on - 1) {
            uint32_t* entry = group + __builtin_ctzll(go_on);
            // No byte is compared again and again.
            const size_t known = HighHalf(entry + kSpans), start = Either(known < covered, covered, LowHalf(entry + kSpans));
            covered = Extend(c, std::max(known, covered), entry[kOffsets], limit);
            entry[kSpans] = start | covered << 16;
        }
    }
}

template<uint32_t kBack> static HWY_INLINE size_t Measure(const Chunk& c, uint32_t max_distance, size_t count)
{
    count = Filter<kBack>(c, max_distance, count);
    (c.IsAtEdge() ? Compare<kBack, true> : Compare<kBack, false>)(c, count);
    Span<kBack>(c, count);
    return count;
}

// Each of the chosen matches ends at least `kMatchMin` behind its start, the one before, and `covered`.
template<bool kIsFinal> static HWY_NOINLINE size_t Choose(const Chunk& c, uint16_t per_bit, uint32_t covered, size_t count)
{
    constexpr size_t kLimits = kPositions, kEnds = kDistances;
    const auto prepare = [per_bit = Pair(per_bit, 0)](uint32_t* at) HWY_ATTR {
        const I32x8 spans = Eight<I32x8>(at + kSpans), ends = Shr(spans, 16);
        // A match has to cover more than `len` bytes, and more than `own` that no later one does.
        I32x8 len = 7, own = 5;
        if (kIsFinal) {
            own = As<I32x8>(As<U16x16>(Log2<U32x8>(Eight(at + kOffsets) | 1) + 5) * per_bit >> 8);
            len = Max(own, kMatchMin - 1);
        }
        I32x8 limits = ends - len;
        for (size_t next = 1; next <= 2 + kIsFinal; next++) {
            const I32x8 later = Eight<I32x8>(at + kSpans + next), further = Shr(later, 16) - (ends + 1);
            limits = further < 0 ? limits : Min(limits, (later & 0xFFFF) - Min(further, own));
        }
        Store(at + kLimits, limits & (limits > (spans & 0xFFFF)));
        Store(at + kEnds, ends);
    };
    uint32_t* to = c.scratch;
    prepare(to);
    for (uint32_t *at = to, *end = at + count; at < end; at = Opaque(at + 8)) {
        prepare(at + 8);
        size_t taken = 0;
#if HWY_ARCH_X86_64
        asm(".irp entry, 0, 4, 8, 12, 16, 20, 24, 28\n"
            "cmpl %c3 + \\entry(%2), %1\n"
            "cmovbl %c4 + \\entry(%2), %1\n"
            "adcl %k0, %k0\n"
            ".endr"
            : "+r"(taken), "+r"(covered)
            : "r"(at), "i"(4 * kLimits), "i"(4 * kEnds)
            : "cc", "memory");
        taken = kReversed.data()[taken];
#else
        for (size_t i = 0; i < 8; i++) {
            taken |= size_t { covered < at[kLimits + i] } << i;
            covered = Either(covered < at[kLimits + i], at[kEnds + i], covered);
        }
#endif
        const Kept kept(taken);
        kept.Put(to + kChosenSpans, Eight(at + kSpans));
        kept.Put(to + kChosenOffsets, Eight(at + kOffsets));
        to += std::popcount(taken);
    }
    return to - c.scratch;
}

// Extends the first of the chosen matches backwards. Returns how far before the origin it gets.
static HWY_NOINLINE size_t StartSooner(const Chunk& c, size_t lowest)
{
    const size_t offset = c.scratch[kChosenOffsets];
    const uint8_t *at = c.origin + LowHalf(c.scratch + kChosenSpans), *first = c.origin - c.base + std::max(lowest, offset);
    while (at - first >= 32 && Signs(Same(at - 32, at - 32 - offset)) == ~0u)
        at -= 32;
    while (at > first && at[-1] == *(at - 1 - offset))
        at--;
    Store<uint16_t>(c.scratch + kChosenSpans, std::max(at, c.origin) - c.origin);
    return c.origin - std::min(at, c.origin);
}

// How many bytes from `from` on the chosen matches leave open.
static HWY_INLINE uint32_t OpenLen(const Chunk& c, uint32_t from, size_t count)
{
    uint32_t* spans = c.scratch + kChosenSpans;
    spans[-1] = from << 16, spans[count] = c.end;
    c.Clear(kChosenSpans + count + 1, 8);
    U32x8 sums = 0;
    for (size_t i = 0; i <= count; i += 8)
        sums += As<U32x8>(Less(Eight<U16x16>(spans + i), As<U16x16>(Eight(spans + i - 1) >> 16 | 0xFFFF0000)));
    return __builtin_reduce_add(sums);
}

// Each is a part of the one before.
enum Share { kAll,
    kHalf,
    kEighth };

// Lists open positions from `from` to `to`, and one for each of the chosen matches, which is noted in place of its symbols.
// `from` and the ends of all but the last match are before the end of the chunk.
template<Share kShare> static HWY_NOINLINE size_t ListOpen(const Chunk& c, uint32_t from, uint32_t to, uint8_t cut, size_t count)
{
    uint32_t *spans = c.scratch + kChosenSpans, *starts = c.scratch + kOffsets, *stops = c.scratch + kSymbols;
    spans[-1] = from << 16, spans[count] = to + cut;
    for (size_t i = 0; i <= count; i += 8) {
        const U32x8 start = Min(Eight(spans + i - 1) >> 16, c.end);
        Store(starts + i, start);
        Store(stops + i, Max(Min(As<U32x8>(Less(Eight<U16x16>(spans + i), Pair(cut, 0xFFFF))), c.end - 1), start));
    }
    uint8_t* borders = c.Bytes<uint8_t>(kSpans);
    memset(borders, 0, c.end + 64);
    for (size_t i = 0; i < count; i++)
        borders[starts[i]] = 128, borders[stops[i] + size_t { 1 }] = 64;
    borders[starts[count]] |= 128, borders[stops[count] + 1] = 64;

    uint32_t* words = c.scratch + kMasks;
    uint32_t before = 0;
    int64_t borrow = 0;
    for (const uint8_t *at = borders, *end = at + c.end; at <= end; at = Opaque(at + 32)) {
        const auto rank = [&](size_t next) HWY_ATTR { return Load<I8x32>(at + 4 * (kRanks - kSpans) + next); };
        I8x32 share = kShare == kAll ? I8x32(-1) : Above(rank(0), Less(rank(1), OneInEvery<4>()));
        if (kShare == kEighth)
            share &= ~Above(rank(1), rank(2)) & Same((rank(0) ^ rank(2)) & 3, 0);
        const uint32_t last = Signs(As<I8x32>(Load<U8x32>(at + 1) << 1));
        const int64_t open = int64_t { last } - Signs(Load<I8x32>(at)) + borrow;
        borrow = open >> 63;
        *(words - (kMasks - kListed)) = before;
        before += std::popcount(*words++ = (open & Signs(share)) | last);
    }
    memset(words, 0, 64);

    const uint8_t* masks = c.Bytes<uint8_t>(kMasks);
    uint32_t* const scratch = c.scratch;
    const uint32_t index = c.index;
    size_t listed = 0;
    const auto list = [&](size_t at, U32x8 first) HWY_ATTR {
        const size_t mask = masks[at];
        Store(scratch + kPositions + listed, SetBits(mask) + first);
        listed += std::popcount(mask);
    };
    for (size_t first = 0; first <= c.end / 8; first += 64) {
        uint64_t used = ~Signs(Same(Load<I8x32>(masks + first), 0), Same(Load<I8x32>(masks + first + 32), 0));
        if (std::popcount(used) > 32) {
            U32x8 positions = uint32_t(index + 8 * first);
            for (size_t at = first; at < first + 64; at++, positions += 8)
                list(at, positions);
            continue;
        }
        for (; used; used &= used - 1) {
            const size_t at = first + __builtin_ctzll(used);
            list(at, uint32_t(index + 8 * at));
        }
    }
    return listed - 1;
}

// The chosen matches become candidates whose end is known.
static HWY_NOINLINE void Rejoin(const Chunk& c, size_t count)
{
    uint32_t* const scratch = c.scratch;
    const uint32_t index = c.index;
    for (uint32_t *at = scratch, *end = at + count; at != end; at = Opaque(at + 1)) {
        const size_t position = at[kSymbols];
        uint32_t* to = scratch + (scratch[kListed + position / 32] + std::popcount(LowBits(scratch[kMasks + position / 32], position % 32)));
        to[kPositions] = at[kChosenSpans] + index;
        to[kDistances] = -at[kChosenOffsets];
    }
}

// The short distance at which most bytes repeat, or 0.
static HWY_NOINLINE uint32_t FindPeriod(const Chunk& c)
{
    if (c.end < c.start + 256)
        return 0;
    const size_t step = (c.end - c.start - 40) / 4;
    uint32_t best = 80 << 4;
    for (const uint32_t period : { 1, 2, 3, 4, 8 }) {
        const auto same = [&](size_t i) HWY_ATTR { return Same(c.origin + c.start + 8 + i * step, c.origin + c.start + 8 + i * step - period); };
        best = std::max(best, (std::popcount(Signs(same(1), same(2))) + std::popcount(Signs(same(3), same(4)))) << 4 | (15 - period));
    }
    return (15 - best % 16) % 15;
}

// Moves the chosen matches to the spans and offsets, but prefers the last two offsets, or the last one and `period`. Each lane goes through a part of them.
static HWY_NOINLINE size_t PreferRepeats(const Chunk& c, const Sink& sink, int32_t period, size_t count)
{
    constexpr int32_t kWindow = 30, kBonus = 16;
    constexpr size_t kStepsMax = 2 * kRoom / 24 - 1;
    uint32_t *const scratch = c.scratch, *const notes = scratch + kSymbols, *const steps = scratch + kPositions, *step = steps;
    const uint8_t* const bytes = c.origin;
    const size_t limit = std::min(c.limit, kEndMax), anchor = std::max({ sink.anchor, c.base, size_t { 1 } });
    uint32_t covered = anchor - c.base;
    scratch[kChosenSpans - 1] = covered << 16;
    for (size_t i = 0; i < 2; i++)
        scratch[kChosenOffsets - 1 - i] = sink.repeats[i] - 1 < anchor ? sink.repeats[i] : 1;
    scratch[kChosenSpans + count] = scratch[kChosenOffsets + count] = 0;
    const auto gather = [&](size_t list, const uint32_t* indices) HWY_ATTR {
        I32x8 all = 0;
        for (size_t lane = 0; lane < 8; lane++)
            all[lane] = scratch[list + indices[lane]];
        return all;
    };

    const int32_t each = std::max<int32_t>((count + 7) / 8, 4);
    I32x8 next = Min(LaneNumbers() * each, count);
    const I32x8 stop = Min(next + each, count), last = std::min<int32_t>(limit - 31, c.end + 64);
    Store(notes, next);
    I32x8 at = Shr(gather(kChosenSpans - 1, notes), 16), recent = gather(kChosenOffsets - 1, notes), second = gather(kChosenOffsets - 2, notes);
    I32x8 is_useful = 0;
    const int32_t from = period - c.base, late = std::clamp(period - 1, 0, 2);
    for (; step != steps + 24 * kStepsMax; step += 24) {
        if (period)
            second = Select(is_useful | (recent == period) | (from > at), second, period);
        const I32x8 is_active = (stop > next) & (last > at);
        if (!Signs(is_active))
            break;
        Store(notes, at & is_active);
        Store(notes + 8, (at - recent) & is_active);
        Store(notes + 16, (at - second) & is_active);
        Store(notes + 24, next);
        // Through memory, which is quicker than taking vectors apart.
        asm volatile("" : : : "memory");
        for (size_t lane = 0; lane < 8; lane++) {
            const auto window = Load<I8x32>(bytes + notes[lane]);
            notes[32 + lane] = Signs(Same(window, Load<I8x32>(bytes + int32_t(notes[8 + lane]))));
            notes[40 + lane] = Signs(Same(window, Load<I8x32>(bytes + int32_t(notes[16 + lane]))));
        }
        const I32x8 spans = gather(kChosenSpans, notes + 24), offsets = gather(kChosenOffsets, notes + 24);
        asm volatile("" : : : "memory");
        // The bit where four bytes in a row start that are the same.
        const auto run_in = [](I32x8 same) HWY_ATTR {
            const I32x8 twos = same & Shr(same, 1), fours = (twos & Shr(twos, 2) & ((1 << (kWindow - 3)) - 1)) | 1 << (kWindow - 1);
            return fours & -fours;
        };
        const auto by_recent = Eight<I32x8>(notes + 32), by_second = Eight<I32x8>(notes + 40);
        const I32x8 recent_run = run_in(by_recent), second_run = run_in(by_second);
        const I32x8 is_second = recent_run > second_run, run = Min(recent_run, second_run);
        const I32x8 same = Select(is_second, by_second, by_recent) & ((1 << kWindow) - 1);
        const I32x8 repeated = Select(is_second, second, recent), after = (same + run) & ~same;
        const I32x8 match_start = Max(spans & 0xFFFF, at), match_end = Shr(spans, 16);
        I32x8 start = at + Log2<I32x8>(run), end = at + Log2<I32x8>(after);
        const I32x8 is_early = is_active & (Min(match_start + 2 + ((repeated == period) & late), at + (kWindow - 2)) > start);
        const I32x8 is_match = (repeated == offsets) & (end > match_start);
        end = Max(end, match_end & is_match);
        for (uint32_t go_on = Signs(after << 1 & is_early & ~is_match); go_on; go_on &= go_on - 1) {
            const size_t lane = __builtin_ctz(go_on);
            end[lane] = Extend(c, end[lane], repeated[lane], limit);
        }
        const I32x8 repeats = is_early & ((match_start > start) | (end > match_end - (kBonus + 1)));
        const I32x8 fits = is_active & (match_end > match_start + 3);
        const I32x8 offset = Select(repeats, repeated, Select(fits, offsets, recent));
        at = Select(repeats, end, Max(match_end & fits, at));
        Store(step, Select(repeats, start, match_start) | at << 16);
        Store(step + 8, offset);
        Store(step + 16, (repeats | fits) & 1);
        is_useful = repeats;
        second = Select(offset == recent, second, recent), recent = offset;
        next -= is_active & (at + 4 > match_end);
    }

    uint32_t* to = scratch;
    for (size_t lane = 0; lane < 8; lane++) {
        uint32_t *from = steps + lane, *const before = to;
        while (from < step && *from >> 16 < covered + kMatchMin)
            from += 24;
        for (; from < step; to += from[16], from += 24)
            to[kSpans] = from[0], to[kOffsets] = from[8];
        covered = Either(to != before, uint32_t(at[lane]), covered);
        for (from = scratch + next[lane]; from < scratch + stop[lane]; from++) {
            if (from[kChosenSpans] >> 16 >= covered + kMatchMin) {
                to[kSpans] = from[kChosenSpans], to[kOffsets] = from[kChosenOffsets];
                covered = to++[kSpans] >> 16;
            }
        }
    }
    return to - scratch;
}

// Fills the spans and offsets by going from match to match, which leaves in the tables where matches start and end.
template<size_t ways>
static HWY_NOINLINE size_t Walk(Chunk& c, const Request& r, const Sink& sink, uint32_t short_len)
{
    using Offsets = std::array<uint32_t, ways>;
    const uint8_t* const bytes = c.origin;
    const size_t limit = std::min(c.limit, kEndMax);
    const uint64_t short_mask = ~uint64_t { 0 } >> (64 - 8 * short_len);
    const auto entry_of = [&](uint64_t hash, size_t at) HWY_ATTR { return uint32_t((uint32_t(hash) & ~0u << kIndexBits) + c.index + at); };
    const auto exchange_short = [&](size_t at) HWY_ATTR {
        const uint64_t hash = (Load<uint64_t>(bytes + at) & short_mask) * kMultiplier;
        return entry_of(hash, at) - std::exchange(r.tables[1].entries[hash >> (64 - r.tables[1].log)], entry_of(hash, at));
    };
    // The latest entry is where the stages look for it.
    const auto exchange_long = [&](size_t at) HWY_ATTR {
        const uint64_t hash = Load<uint64_t>(bytes + at) * kMultiplier;
        Offsets offsets;
        for (uint32_t way = 0, moved = entry_of(hash, at); way < ways; way++)
            offsets[way] = entry_of(hash, at) - (moved = std::exchange(r.tables[0].entries[hash >> (64 - r.tables[0].log) ^ way], moved));
        return offsets;
    };
    const auto is_same = [&](size_t at, uint32_t offset) HWY_ATTR { return Load<uint32_t>(bytes + at) == Load<uint32_t>(bytes + at - offset); };
    uint32_t recent = sink.repeats[0], second = sink.repeats[1], *to = c.scratch;
    Offsets across = {};
    size_t anchor = Less(sink.anchor, c.base);
    for (size_t at = std::max<size_t>(anchor, c.start); at + 1 < c.end;) {
        const Offsets by_long = exchange_long(at);
        const uint32_t by_short = exchange_short(at);
        size_t start = at, end = 0;
        uint32_t offset = 0;
        int32_t best = 0;
        const auto offer = [&](size_t from, uint32_t candidate, int32_t cost) HWY_ATTR {
            if (candidate - 1 >= std::min<size_t>(r.max_distance, c.base + from) || !is_same(from, candidate))
                return;
            if (best && (end == limit || !is_same(end - 3, candidate)))
                return;
            const size_t until = Extend(c, from + kMatchMin, candidate, limit);
            if (const int32_t gain = 4 * int32_t(until - from) - cost; gain > best)
                best = gain, start = from, end = until, offset = candidate;
        };
        const auto offer_all = [&](size_t from, const Offsets& candidates, int32_t cost) HWY_ATTR {
            for (const uint32_t candidate : candidates)
                offer(from, candidate, Log2(candidate | 1) + cost);
        };
        if (at == anchor)
            offer(at, second, 0);
        offer(at + 1, recent, 0);
        // What follows is likely to repeat the offset again.
        const int32_t loss = best ? 40 : 0;
        if (at == anchor)
            offer_all(at, across, loss);
        offer_all(at, by_long, loss);
        if (!best || ways > 1) {
            offer(at, by_short, Log2(by_short | 1) + loss);
            if (!best) {
                // The stages are faster at finding nothing.
                if (++at - std::max<size_t>(anchor, c.start) == 128)
                    c.end = at;
                continue;
            }
            offer_all(at + 1, exchange_long(at + 1), loss);
        }
        while (start > anchor && c.base + start > offset && bytes[start - 1] == *(bytes + start - 1 - offset))
            start--;
        to[kSpans] = start | end << 16, to++[kOffsets] = offset;
        second = Either(offset == recent, second, recent), recent = offset;
        if (end + 8 <= c.limit) {
            exchange_long(at + 2), across = exchange_long(end - 2);
            exchange_short(at + 2), exchange_short(end - 1);
        }
        at = anchor = end;
    }
    return to - c.scratch;
}

// Lists the lengths of literals, as far as they are behind the origin, and matches, and the offsets as the format has them.
// Returns how many repeat. It may miss some in the chosen matches.
template<size_t kFromSpans, size_t kFromOffsets> static HWY_NOINLINE uint32_t Number(const Chunk& c, size_t anchor, uint32_t (&repeats)[3], size_t count)
{
    uint32_t *const scratch = c.scratch, *const end = scratch + count, second = repeats[1], third = repeats[2];
    for (size_t i = 0; i < 3; i++)
        scratch[kFromOffsets - 1 - i] = repeats[i];
    scratch[kFromSpans - 1] = Less(anchor, c.base) << 16;
    Store(end + kFromSpans, U32x8(end[kFromSpans - 1] & 0xFFFF0000));
    Store(end + kFromOffsets, U32x8(end[kFromOffsets - 1]));
    U32x8 earlier = { anchor < c.base };
    I32x8 repeating = 0;
    for (uint32_t* at = scratch; at < end; at = Opaque(at + 8), earlier = 0) {
        const U32x8 before = Eight(at + kFromSpans - 1) >> 16;
        const U16x16 spans = Max(Eight<U16x16>(at + kFromSpans), As<U16x16>(before));
        const auto lens = As<U32x8>(spans - As<U16x16>(before | As<U32x8>(spans) << 16));
        const auto back = [&](size_t by) HWY_ATTR { return Eight<I32x8>(at + kFromOffsets - by); };
        const I32x8 follows = (lens << 16 | earlier) == 0, is_recent = back(0) == back(1);
        Store(at + kLens, lens);
        if (kFromSpans == kSpans) {
            Store(at + kValues, 3 + follows + 2 * (is_recent & ~follows));
        } else {
            const I32x8 is_second = back(0) == back(2), is_third = (back(0) == back(3)) & ~(is_recent | is_second | (back(1) == back(2)));
            const I32x8 is_older = (is_second & ~is_recent) | is_third, is_repeat = (is_recent & ~follows) | is_older;
            repeating -= is_repeat;
            Store(at + kValues, Select(is_repeat, 1 - is_third - (is_older & ~follows), back(0) + 3));
        }
    }

    if (kFromSpans == kSpans) {
        constexpr size_t kSeconds = kChosenSpans, kThirds = kChosenOffsets;
        for (uint32_t* at = scratch; at != end; at = Opaque(at + 1)) {
            at[kSeconds] = second, at[kThirds] = third;
            const uint32_t pushed = Either(at[kOffsets] == second, third, second), recent = at[kOffsets - 1];
            second = Either(at[kValues] == 1, second, recent), third = Either(at[kValues] == 1, third, pushed);
        }
        c.Clear(kSeconds + count, 8);
        c.Clear(kThirds + count, 8);
        for (uint32_t* at = scratch; at < end; at = Opaque(at + 8)) {
            const auto offsets = Eight<I32x8>(at + kOffsets), numbers = Eight<I32x8>(at + kValues);
            const I32x8 stays = numbers == 1, is_second = offsets == Eight<I32x8>(at + kSeconds);
            const I32x8 is_repeat = stays | is_second | (offsets == Eight<I32x8>(at + kThirds));
            repeating -= is_repeat;
            Store(at + kValues, Select(is_repeat, numbers + (is_second & ~stays), offsets + 3));
        }
    } else {
        // What is before three new offsets in a row does not matter.
        uint32_t* at = end;
        for (size_t in_a_row = 0; at != scratch && in_a_row < 3;)
            in_a_row = (--at)[kValues] > 3 ? in_a_row + 1 : 0;
        for (; at != end; at++) {
            const uint32_t offset = at[kFromOffsets], recent = at[kFromOffsets - 1];
            third = Either((at[kValues] > 3) | ((offset != recent) & (offset != second)), second, third);
            second = Either((at[kValues] > 3) | (offset != recent), recent, second);
        }
    }
    repeats[0] = end[kFromOffsets - 1], repeats[1] = second, repeats[2] = third;
    return __builtin_reduce_add(repeating);
}

// And the number of extra bits.
static HWY_INLINE std::pair<uint32_t, uint32_t> LengthCode(uint32_t len, uint32_t raised_by, uint32_t long_from, uint32_t long_base)
{
    const uint32_t raised = len + raised_by, log = Log2(len), bits = kExtraBits[raised / 8 % 16];
    const uint32_t code = kCodeBases[raised / 8 % 16] + (raised >> bits) - raised_by;
    return { Either(len < long_from, code, long_base + log), Either(len < long_from, bits, log) };
}

// Also lists the symbols. `spans` is the list that was numbered. The first match starts `sooner` bytes before the origin, behind a literal.
static HWY_NOINLINE void Emit(const Chunk& c, Sink& sink, size_t spans, size_t sooner, size_t count)
{
    constexpr size_t kCopied = 32;
    const uint8_t* const bytes = c.origin;
    const size_t before = Less(c.base, sink.anchor), earlier = before - sooner;
    if (earlier)
        memcpy(sink.literals, bytes - before, earlier);
    uint8_t *literals = sink.literals + earlier, *to = sink.sequences + kSequenceLen * sink.sequence_count;
    uint32_t *const scratch = c.scratch, *const end = scratch + count;
    const uint32_t* ends = scratch + spans - 1;
    const size_t last_end = HighHalf(ends + count), anchor = last_end == kEndMax ? Extend(c, last_end, sink.repeats[0], c.limit) : last_end;
    const size_t careful_within = last_end + kCopied > c.limit ? 16 : 0;
    uint64_t redone = before != 0;
    for (uint32_t* at = scratch; at < end;) {
        uint32_t* const first = at;
        uint8_t *const first_to = to, *groups[8];
        for (size_t group = 0; group < 8 && at < end; group++, at = Opaque(at + 8), ends += 8, to += 8 * kSequenceLen) {
            U16x16 lens = Eight<U16x16>(at + kLens);
            redone |= uint64_t { Signs(As<I32x8>(Less(lens, Pair(kCopied, 130))) == 0) ^ 255 } << 8 * group;
            lens = Min(lens + Pair(16, -3), 127);
            const U16x16 eighths = lens >> 3 | 0x8000;
            const U16x16 shifted = lens * LookUp(Tabulate<16>([](size_t i) { return uint8_t(128 >> kExtraBits[i]); }), eighths) >> 7;
            const U16x16 masks = LookUp(Tabulate<16>([](size_t i) { return uint8_t((1 << kExtraBits[i]) - 1); }), eighths);
            const auto extra = As<U32x8>(Dot(As<I16x16>(lens & masks), As<I16x16>(As<U32x8>(masks) << 16) + 1));
            const auto bits = As<U32x8>(Dot(As<I16x16>(LookUp(kExtraBits, eighths)), 1));
            const U32x8 logs = Log2<U32x8>(Eight(at + kValues)), values = Eight(at + kValues) ^ Shl(1, logs);
            const U32x8 symbols = As<U32x8>(shifted + LookUp(kCodeBases, eighths)) + (kFirstSymbols - 16) + (logs << 8 | (bits + logs) << 24);
            Store(at + kSymbols, symbols);
            StoreSequences(to, extra | Shl(values, bits), Shr(values, 32 - bits), symbols);
            groups[group] = literals;
            if (HWY_UNLIKELY(at + careful_within > end)) {
                const size_t tail_start = c.limit - kCopied;
                const U8x32 tail[2] = { Load<U8x32>(bytes + tail_start) };
                for (size_t i = 0; i < 8; literals += LowHalf(at + kLens + i++)) {
                    const size_t from = HighHalf(ends + i);
                    Store(literals, Load<U8x32>(from > tail_start ? reinterpret_cast<const uint8_t*>(tail) + (from - tail_start) : bytes + from));
                }
            } else {
                for (size_t i = 0; i < 8; i++) {
                    Store(literals, Load<U8x32>(bytes + HighHalf(ends + i)));
                    literals = Opaque(literals + LowHalf(at + kLens + i));
                }
            }
        }
        if (at >= end && anchor != last_end)
            redone |= uint64_t { 1 } << (end - first - 1);
        for (; redone; redone &= redone - 1) {
            const size_t i = __builtin_ctzll(redone);
            uint32_t* const entry = first + i;
            const size_t len = LowHalf(entry + kLens);
            if (len > kCopied) {
                uint8_t* copy = groups[i / 8] + __builtin_reduce_add(Eight<I32x8>(first + kLens + i / 8 * 8) & Shr(int32_t(i % 8) > LaneNumbers(), 16));
                const uint8_t* from = bytes + HighHalf(entry + spans - 1);
                for (size_t done = kCopied; done + kCopied < len; done += kCopied)
                    Store(Opaque(copy + done), Load<U8x32>(from + done));
                Store(copy + len - kCopied, Load<U8x32>(from + len - kCopied));
            }
            const uint32_t literal_len = len + Either(entry == scratch, earlier, 0), value = entry[kValues], log = Log2(value);
            const uint32_t match_base = HighHalf(entry + kLens) - 3 + Either(entry + 1 == end, anchor - last_end, 0) + Either(entry == scratch, sooner, 0);
            const auto [literal_code, literal_bits] = LengthCode(literal_len, 16, 64, 19);
            const auto [match_code, match_bits] = LengthCode(match_base, 0, 128, 36);
            const uint32_t bits = literal_bits + match_bits;
            entry[kSymbols] = kFirstSymbols | literal_code | log << 8 | match_code << 16 | (bits + log) << 24;
            Store(first_to + kSequenceLen * i, LowBits(literal_len, literal_bits) | LowBits(match_base, match_bits) << literal_bits | uint64_t { LowBits(value, log) } << bits);
            Store(first_to + kSequenceLen * i + 8, entry[kSymbols]);
        }
    }
    sink.anchor = c.base + anchor, sink.literals = literals, sink.sequence_count += count;
}

constexpr size_t kSampleLen = 256;

// In 16ths, going by how often some of them occur among others.
static HWY_NOINLINE uint32_t BitsPerLiteral(const uint8_t* sample)
{
    // 16 * (6 - digamma(index + 1) / ln(2))
    static constexpr uint8_t kBits[65] = { 109, 86, 75, 67, 61, 57, 53, 49, 47, 44, 42, 40, 38, 36, 34, 33, 31, 30, 29, 27, 26, 25, 24, 23, 22, 21, 20, 19, 19, 18, 17, 16, 16, 15, 14, 14, 13, 12, 12, 11, 11, 10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 5, 4, 4, 3, 3, 2, 2, 2, 1, 1, 1, 0, 0 };
    const auto low = Load<I8x32>(sample), high = Load<I8x32>(sample + 32);
    I8x32 same[2] = {};
    for (const uint8_t* at = sample + 3; at <= sample + 3 * 64; at += 3)
        same[0] -= Same(low, Load<I8x32>(at)), same[1] -= Same(high, Load<I8x32>(at + 32));
    uint32_t bits = 0;
    for (const uint8_t count : Load<std::array<uint8_t, 64>>(same))
        bits += kBits[count];
    return bits / 64;
}

struct Tally {
    // A bit for each symbol.
    U32x8 seen[5];
    uint32_t more[192];
};

static HWY_NOINLINE void Count(const Chunk& c, Sink& sink, Tally& tally, size_t count)
{
    constexpr size_t kSampledFrom = 700;
    uint32_t *const counts = sink.counts, *const more = tally.more;
    const auto add = [](uint32_t* to, const uint8_t* symbols, uint32_t weight) HWY_ATTR {
        for (size_t kind = 0; kind < 3; kind++)
            to[symbols[kind]] += weight;
    };
    const uint8_t *at = c.Bytes<uint8_t>(kSymbols), *end = at + 4 * count;
    if (sink.sequence_count > kSampledFrom) {
        auto [a, b, d, e, f] = tally.seen;
        for (; at + 128 <= end; at += 128) {
            for (size_t i = 0; i < 128; i += 32) {
                const U32x8 symbols = Load<U32x8>(at + i), literals = symbols & 63, matches = symbols >> 16 & 63;
                a |= Shl(1, literals), b |= Shl(1, literals ^ 32), d |= Shl(1, symbols >> 8 & 63), e |= Shl(1, matches), f |= Shl(1, matches ^ 32);
            }
            for (size_t i = 0; i < 32; i += 8)
                add(counts, at + i, 4), add(more, at + i + 4, 4);
        }
        Store(tally.seen, std::array { a, b, d, e, f });
    }
    for (; at + 8 <= end; at += 8)
        add(counts, at, 1), add(more, at + 4, 1);
    if (at != end)
        add(counts, at, 1);
}

// Symbols that are not in the samples take from the most frequent ones.
static HWY_INLINE void Settle(uint32_t* counts, const Tally& tally)
{
    for (size_t i = 0; i < 192; i += 8)
        Store(counts + i, Eight(counts + i) + Eight(tally.more + i));
    const auto all = [&](size_t i) HWY_ATTR { return uint64_t { __builtin_reduce_or(tally.seen[i]) }; };
    for (uint64_t seen : { all(0) | all(1) << 32, all(2), all(3) | all(4) << 32 }) {
        uint32_t missed = 0;
        for (; seen; seen &= seen - 1) {
            uint32_t& count = counts[__builtin_ctzll(seen)];
            missed += count == 0;
            count = std::max(count, 1u);
        }
        for (uint32_t taken = 1; missed && taken; missed -= taken) {
            uint32_t& most = *std::max_element(counts, counts + 64);
            most -= taken = std::min(missed, most / 2);
        }
        counts += 64;
    }
}

static void Index(const Request* r, size_t from)
{
    for (; from + 8 < r->len; from += kChunk) {
        const Chunk c(*r, from, kChunk);
        Rank(c);
        Exchange<8>(c, r->tables[0], (r->efforts->is_narrow ? Pick<1> : Pick<3>)(c));
    }
}

constexpr size_t kLongLen = 256;

// One that the end of the last block has cut off, or a pattern at the very start.
static HWY_INLINE void TakeLongMatch(const Chunk& c, Sink& sink, Tally& tally)
{
    const auto take = [&](size_t start, uint32_t offset) HWY_ATTR {
        const size_t end = Extend(c, start, offset, std::min(c.limit, kEndMax));
        if (end < kLongLen)
            return false;
        c.scratch[kChosenSpans] = start | end << 16, c.scratch[kChosenOffsets] = offset;
        StartSooner(c, sink.anchor);
        Number<kChosenSpans, kChosenOffsets>(c, sink.anchor, sink.repeats, 1);
        Emit(c, sink, kChosenSpans, 0, 1);
        Count(c, sink, tally, 1);
        return true;
    };
    if (sink.repeats[0] - 1 < sink.anchor)
        take(c.start, sink.repeats[0]);
    for (size_t first = 1; first < 128 && !sink.anchor; first += 32) {
        constexpr size_t kHeader = 16;
        const auto same = [&](size_t at) HWY_ATTR { return Same(Load<I8x32>(c.origin + at + first), c.origin[at]); };
        uint32_t periods = Signs(same(kHeader) & same(kHeader + 1) & same(kHeader + 40));
        while (periods && !take(kHeader + first + __builtin_ctz(periods), first + __builtin_ctz(periods)))
            periods &= periods - 1;
    }
}

static void Search(const Request* r, Sink* out)
{
    Sink& sink = *out;
    Trend& trend = *sink.trend;
    Tally tally = {};
    const uint8_t* const first_literal = sink.literals;
    const size_t first = sink.anchor;
    if (r->len - sink.anchor >= kLongLen)
        TakeLongMatch(Chunk(*r, sink.anchor, 0), sink, tally);
    if (r->len - sink.anchor >= kSampleLen) {
        uint32_t others = 0;
        for (size_t at = sink.anchor, step = (r->len - at) / 8; at + step <= r->len; at += step)
            others += Signs(Above(9, Load<I8x32>(r->bytes + at))) != 0;
        trend.is_text = others <= (trend.is_text ? 4 : 1);
    }
    const Effort& effort = r->efforts[trend.is_text];
    const auto exchange_short = effort.short_len == 4 ? Exchange<4> : effort.short_len == 5 ? Exchange<5>
                                                                                            : Exchange<6>;
    // Indexes a little of what the last match covers, for when what it copies is out of reach.
    const auto cover = [&](size_t from) HWY_ATTR {
        for (from = std::max(from, Less(sink.anchor, sink.repeats[0])); from + kLongLen <= sink.anchor; from += 1536) {
            const Chunk c(*r, from, 96);
            Rank(c);
            effort.is_single ? exchange_short(c, r->tables[1], Pick<1, 0>(c)) : Exchange<8>(c, r->tables[0], Pick<3>(c));
        }
    };
    cover(first);
    bool looks_random = false;
    if (trend.repeating == kUnknown && trend.idle == 0 && r->len - sink.anchor >= kSampleLen) {
        const uint8_t *first = r->bytes + sink.anchor, *last = r->bytes + r->len - 64;
        const auto signs = [](const uint8_t* at) HWY_ATTR { return std::popcount(Signs(Load<I8x32>(at), Load<I8x32>(at + 32))); };
        const uint32_t high = signs(first + (last - first) / 2) + signs(last);
        // What is not text has its matches further apart.
        trend.is_dense = effort.is_single && 4 * high >= effort.all_from;
        const uint32_t bits = last - first > 512 ? BitsPerLiteral(first + std::min<size_t>((last - first) / 4, kChunk / 4)) : 80;
        looks_random = last - first > 2048 && bits >= 100;
        trend.idle = looks_random;
        // Runs do not end up as literals.
        if (bits >= 14)
            trend.per_bit = std::max(4096 / (bits + 10), 48u);
    }
    size_t sampled_at = kSampleLen;
    for (size_t from = Less(sink.anchor, 8), open_from = from; from + 8 < r->len;) {
        const bool is_probe = std::exchange(looks_random, false) || (trend.idle > 2 && trend.idle % 4 == 0), is_thin = trend.idle >= 2 && !is_probe && r->len - from >= kChunk / 2;
        const uint32_t step = 2 << std::min(trend.idle, 5u + (trend.idle > 12));
        Chunk c(*r, from, is_thin ? 256 * step : is_probe ? kChunk / 4
                                                          : kChunk);
        const uint32_t len = c.end - c.start, covered = Less(sink.anchor, c.base);
        const bool has_second = !is_thin && !effort.is_single && covered < c.end && (!trend.is_covered || trend.repeating >= effort.records_from);

        const uint8_t* const literals_before = sink.literals;
        const size_t anchor_before = sink.anchor;
        // Whether there are that many bytes per match, as which 8 literals count.
        const auto is_sparse = [&](size_t count, size_t bytes) HWY_ATTR {
            const size_t end = std::max(sink.anchor, c.base + c.end);
            return (8 * count + (sink.literals - literals_before) + end - sink.anchor) * bytes <= 8 * (end - anchor_before);
        };
        if (trend.walks) {
            const size_t found = (effort.is_narrow ? Walk<4> : Walk<1>)(c, *r, sink, effort.short_len);
            if (found) {
                trend.repeating = Number<kSpans, kOffsets>(c, sink.anchor, sink.repeats, found) * 256 / uint32_t(found);
                Emit(c, sink, kSpans, 0, found);
                Count(c, sink, tally, found);
            }
            trend.walks = c.end - c.start == len && is_sparse(found, 32);
            from = open_from = c.base + c.end;
            if (sink.anchor > from + 64)
                cover(std::exchange(from, sink.anchor - 32));
            continue;
        }
        if (!is_thin)
            Rank(c);
        size_t count;
        if (effort.is_single || is_thin)
            exchange_short(c, r->tables[1], count = is_thin || trend.is_dense ? PickAny(c, is_thin ? step : 1) : Pick<1, 0>(c));
        else
            Exchange<8>(c, r->tables[0], count = (trend.is_dense || effort.is_narrow ? Pick<1> : Pick<3>)(c));
        count = Measure<kBackLong>(c, r->max_distance, count);
        size_t chosen = (has_second ? Choose<false> : Choose<true>)(c, trend.per_bit, covered, count);
        if (is_thin && chosen) {
            // Where there are some, there are more. A long one may only be found like this.
            const uint32_t start = LowHalf(c.scratch + kChosenSpans), end = HighHalf(c.scratch + kChosenSpans);
            if (std::exchange(chosen, end - start >= 64) >= 3 || end - start >= (effort.all_from > 256 ? 8 : 6))
                c.end = std::max(c.start + 1, chosen ? std::min(end, c.end) : Less(start, 64 * step));
        }
        const uint32_t open_len = OpenLen(c, std::max(covered, c.start), chosen), open = open_len * 256 / len;
        // The demands of a first round leave more.
        trend.is_covered = open_len * 64 < effort.second_from * (has_second ? 4 : 3) * chosen;

        if (has_second) {
            while (chosen > 1 && c.scratch[kChosenSpans + chosen - 2] >> 16 >= c.end)
                chosen--;
            // The next chunk may have long matches that start here.
            const uint32_t to = c.end - (c.end + 8 == c.limit ? 0 : kBackLong);
            const uint32_t first = std::max({ uint32_t(Less(open_from, c.base)), covered, c.start / 4 });
            count = (trend.is_poor ? ListOpen<kEighth> : open >= effort.all_from || (trend.is_rich && open >= 190) ? ListOpen<kAll>
                                                                                                                   : ListOpen<kHalf>)(c, first, to, effort.cut, chosen);
            exchange_short(c, r->tables[1], count);
            Rejoin(c, chosen);
            const size_t had = std::exchange(chosen, Choose<true>(c, trend.per_bit, covered, Measure<kBackShort>(c, r->max_distance, count)));
            trend.is_poor = Less(chosen, had) * 32 + had < count;
            trend.is_rich = !trend.is_text && Less(chosen, had) * 9 >= len;
            open_from = c.base + to;
        }

        size_t spans = kChosenSpans, sooner = 0;
        const uint32_t period = chosen * 128 >= len || trend.repeating >= effort.repeats_from ? FindPeriod(c) : 0;
        if (chosen && trend.repeating == kUnknown) {
            uint32_t repeats[3] = { sink.repeats[0], sink.repeats[1], sink.repeats[2] };
            trend.repeating = Number<kChosenSpans, kChosenOffsets>(c, sink.anchor, repeats, chosen) * 384 / uint32_t(chosen);
        }
        if (chosen && trend.idle >= 2)
            sooner = StartSooner(c, sink.anchor + 1);
        else if (chosen && (period || trend.repeating >= effort.repeats_from))
            spans = kSpans, chosen = PreferRepeats(c, sink, period, chosen);
        if (chosen) {
            trend.repeating = (spans == kSpans ? Number<kSpans, kOffsets> : Number<kChosenSpans, kChosenOffsets>)(c, sink.anchor, sink.repeats, chosen) * 256 / uint32_t(chosen);
            Emit(c, sink, spans, sooner, chosen);
            Count(c, sink, tally, chosen);
            if (size_t(sink.literals - first_literal) >= sampled_at && len == kChunk) {
                sampled_at = sink.literals - first_literal + 4 * kSampleLen;
                trend.per_bit = (trend.per_bit + 4096 / std::max(BitsPerLiteral(sink.literals - kSampleLen), 16u)) / 2;
            }
        }

        if (effort.is_single)
            trend.is_dense = open >= effort.all_from && chosen * 64 >= len;
        else
            trend.is_dense = open >= effort.narrow_from >> trend.is_dense && chosen * 12 >= len;
        trend.idle = (is_thin ? !chosen && c.end - c.start == len : chosen <= len / 512 && open > 240) ? trend.idle + 1 : 0;
        // Nothing else tells what literals are like here.
        if (trend.idle && !is_thin && len >= kSampleLen)
            trend.per_bit = 4096 / (BitsPerLiteral(c.origin + c.end - kSampleLen) + 10);
        trend.walks = !trend.idle && is_sparse(chosen, 48);
        from = c.base + c.end;
        if (sink.anchor > from + 64)
            cover(std::exchange(from, sink.anchor - 32));
    }
    Settle(sink.counts, tally);
}

// The three states of the stream of sequences go ahead by a batch, and vectors put together what they leave behind.
constexpr size_t kBatch = 64, kStates = kBatch + 8, kCounts = 3 * kStates, kLow = kCounts + kBatch, kHigh = kLow + kBatch;
// A cell has the next state above this many bits, which tell how many bits of the old one to write.
constexpr uint32_t kStateShift = 4, kLogMax = 9;

struct Cells {
    // By kind and symbol. The lowest 5 bits of an address tell how far to shift a cell for the index of the next one.
    uintptr_t rows[3][256];
    // A code takes up to 31 bytes, and 4 per state.
    uint8_t cells[3 * (64 + 64 * 32 + (4 << kLogMax)) + 64];
};

// Whatever the symbol, a cell with a state of a table leads to another one.
static HWY_INLINE bool Fill(Cells& all, const Codes& codes)
{
    uint8_t* unused = all.cells;
    const auto take = [&](size_t alignment, size_t len) HWY_ATTR {
        unused += (alignment - reinterpret_cast<uintptr_t>(unused)) % 32 + len;
        return unused - len;
    };
    for (size_t kind = 0; kind < 3; kind++) {
        if (codes.logs[kind] > kLogMax)
            return false;
        const uint16_t size = 1 << codes.logs[kind];
        uint8_t* none = take(31, 2);
        Store<uint16_t>(none, size << kStateShift);
        std::fill_n(all.rows[kind], 256, reinterpret_cast<uintptr_t>(none));
        for (size_t code = 0, sum = 0; code < 64; code++) {
            const size_t first = codes.ranges[kind][code][0], count = codes.ranges[kind][code][1];
            if (!count)
                continue;
            if ((sum += count) > size || first + count + 16 > 2048)
                return false;
            const uint32_t log = Log2(2 * count - 1), len = 1 << log, bits = codes.logs[kind] - log;
            uint8_t* start = take(bits + kStateShift + 2 * len, 2 * len);
            all.rows[kind][64 * kind + code] = reinterpret_cast<uintptr_t>(start) - 2 * len;
            const auto cells = [&](size_t at, uint32_t bits) HWY_ATTR {
                return (Load<U16x16>(codes.next_states + first + at) & uint16_t(size - 1)) << kStateShift | uint16_t(size << kStateShift | bits);
            };
            // From the higher states, a bit more is written, which makes no difference for the next one.
            const size_t once = 2 * count - len, twice = len - count;
            for (size_t at = 0; at < once; at += 16)
                Store(start + 2 * at, cells(twice + at, bits));
            for (size_t at = 0; at < twice; at += 8)
                Store(start + 2 * once + 4 * at, cells(at, bits + 1).s0011223344556677);
        }
    }
    return true;
}

static size_t WriteSequences(const Codes* codes, const uint8_t* sequences, size_t left, uint8_t* out, size_t room, Progress* progress)
{
    Cells all;
    // Without a shift per lane, it does not pay.
    if ((HWY_ARCH_X86 && HWY_TARGET != HWY_AVX2) || progress->position > room || !Fill(all, *codes))
        return left;
    alignas(32) uint32_t batch[kHigh + kBatch], cells[3];
    memset(batch + kCounts, 0, 3 * kBatch * 4);
    for (size_t kind = 0; kind < 3; kind++)
        cells[kind] = (LowBits(progress->states[kind], codes->logs[kind]) | 1 << codes->logs[kind]) << kStateShift;
    uint8_t* to = out + progress->position;
    uint64_t bits = progress->bits, bit_count = progress->bit_count % 8;
    // Up to 56.
    const auto add = [&](uint64_t more, uint32_t count) HWY_ATTR {
        Store(to, bits |= more << bit_count);
        bit_count += count;
        to = Opaque(to + bit_count / 8);
        bits >>= bit_count & 56;
        bit_count %= 8;
    };
    const auto add_entry = [&](const uint32_t* group, size_t i) HWY_ATTR { add(Load<uint64_t>(group + (i & 2 ? kHigh : kLow) + i / 4 * 4 + i % 2 * 2), group[kCounts + i]); };

    bool has_pending = false;
    // With room for this batch, and for the one before.
    for (; left >= kBatch && size_t(out + room - to) >= kBatch * (7 + 12) + 8; left -= kBatch, has_pending = true) {
        const uint8_t* from = sequences + kSequenceLen * left;
        for (size_t kind = 0; kind < 3; kind++)
            batch[kind * kStates + kBatch] = cells[kind];
        for (uint32_t* group = batch + kBatch; group != batch;) {
            group -= 8, from -= 8 * kSequenceLen;
#pragma unroll
            for (size_t i = 8; i--;) {
                group = Opaque(group);
                for (size_t kind = 0; kind < 3; kind++) {
                    const uintptr_t row = all.rows[kind][from[kSequenceLen * i + 8 + kind]];
                    group[kind * kStates + i] = cells[kind] = Load<uint16_t>(reinterpret_cast<const void*>(row + 2 * size_t { cells[kind] >> row % 32 }));
                }
                add_entry(group, i);
            }
        }

        U32x8 most = 0;
        for (size_t at = 0; at < kBatch; at += 8) {
            uint32_t* group = batch + at;
            U32x8 value = 0, count = 0;
            for (size_t kind : { 1, 2, 0 }) {
                const U32x8 more = Eight(group + kind * kStates) & 15;
                value |= Shl(Eight(group + kind * kStates + 1) >> kStateShift & ~Shl(~0u, more), count);
                count += more;
            }
            auto [low, high, symbols] = LoadSequences(from + kSequenceLen * at);
            high = Shr(low, 32 - count) | Shl(high, count), low = value | Shl(low, count);
            most = Max(most, count += symbols >> 24);
            Store(group + kCounts, count);
            Store(group + kLow, __builtin_shufflevector(low, high, 0, 8, 1, 9, 4, 12, 5, 13));
            Store(group + kHigh, __builtin_shufflevector(low, high, 2, 10, 3, 11, 6, 14, 7, 15));
        }
        if (HWY_UNLIKELY(Signs(most > 56))) {
            for (size_t at = kBatch; at--;) {
                for (size_t kind : { 1, 2, 0 })
                    add(LowBits(batch[kind * kStates + at + 1] >> kStateShift, batch[kind * kStates + at] % 16), batch[kind * kStates + at] % 16);
                const uint8_t* sequence = from + kSequenceLen * at;
                add(Load<uint32_t>(sequence), std::min(sequence[11] % 64, 32));
                add(Load<uint32_t>(sequence + 4), std::max(sequence[11] % 64, 32) - 32);
            }
            memset(batch + kCounts, 0, 3 * kBatch * 4);
        }
    }
    for (size_t at = has_pending ? kBatch : 0; at--;)
        add_entry(batch + at / 8 * 8, at % 8);
    *progress = { size_t(to - out), bits, uint32_t(bit_count), { cells[0] >> kStateShift, cells[1] >> kStateShift, cells[2] >> kStateShift } };
    return left;
}

static uint32_t EstimateCounts(const uint8_t* bytes, size_t len, size_t weight, uint32_t* counts)
{
    alignas(32) uint16_t tables[4][256];
    for (size_t i = 0; i < 256; i += 16)
        Store<U16x16>(tables[0] + i, 0), Store<U16x16>(tables[1] + i, 0), Store<U16x16>(tables[2] + i, 0), Store<U16x16>(Opaque(tables[3] + i), 0);
    const size_t shift = weight > 1 ? 7 : 0;
    size_t at = 0;
    // Out of step with records.
    for (size_t turn = 0; at + 16 + 2 * shift < len; at += 16 * weight, turn += shift) {
        for (uint64_t word : Load<std::array<uint64_t, 2>>(bytes + at + turn % 16)) {
            for (size_t i = 0; i < 8; i += 2, word = Opaque(word >> 16))
                tables[i % 4][word & 255]++, tables[i % 4 + 1][word >> 8 & 255]++;
        }
    }
    for (; weight == 1 && at < len; at++)
        tables[at % 4][bytes[at]]++;
    // By the highest bit and the lowest 4, with a bit for the value of the others.
    std::array<uint8_t, 16> seen[2];
    U16x16 most = 0, last = 0, symbols = As<U16x16>(Tabulate<16>([](size_t i) { return uint16_t(240 + i); }));
    for (size_t half = 2; half--;) {
        U16x16 bits = 0;
        for (size_t i = 128 * half + 128; i != 128 * half; symbols -= 16) {
            i -= 16;
            const auto of = [&](size_t table) HWY_ATTR { return Load<U16x16>(tables[table] + i); };
            const U16x16 sum = of(0) + of(1) + of(2) + of(3);
            Store(counts + i, To<U32x8>(sum.lo) * uint32_t(weight));
            Store(counts + i + 8, To<U32x8>(sum.hi) * uint32_t(weight));
            bits += bits + Min(sum, 1);
            most = Max(most, sum), last = Max(last, symbols & ~As<U16x16>(sum == 0));
        }
        Store(seen + half, To<U8x16>(bits));
    }
    uint32_t largest = __builtin_reduce_max(most) * weight, last_byte = __builtin_reduce_max(last);
    if (weight == 1 || Signs(Same(Load<I8x32>(seen), -1)) == ~0u)
        return largest << 8 | last_byte;
    if (largest + 1024 >= len)
        return 0;
    for (at = 0; at < len; at += 64) {
        const uint8_t* from = bytes + std::min(at, len - 64);
        const auto known = [&](U16x16 some) HWY_ATTR {
            const U16x16 bit = LookUp({ 1, 2, 4, 8, 16, 32, 64, 128 }, some >> 4 & 0x0707), index = some & 0x8F8F;
            return As<I8x32>(bit & (LookUp(seen[0], index) | LookUp(seen[1], index ^ 0x8080)));
        };
        const I8x32 low = known(Load<U16x16>(from)), high = known(Load<U16x16>(from + 32));
        if (HWY_UNLIKELY(Signs(Same(As<I8x32>(Min(As<U8x32>(low), As<U8x32>(high))), 0)))) {
            for (uint64_t missed = Signs(Same(low, 0), Same(high, 0)); missed; missed &= missed - 1) {
                const uint8_t byte = from[__builtin_ctzll(missed)];
                seen[byte / 128][byte % 16] |= 1 << byte / 16 % 8;
                counts[byte] = weight / 2;
                last_byte = std::max<uint32_t>(last_byte, byte);
            }
        }
    }
    return largest << 8 | last_byte;
}

// Each of the four streams of literals has a lane, and a quarter of the room until it is complete.
static size_t WriteLiterals(const uint8_t* symbols, size_t len, const uint64_t* codes, uint8_t* out, size_t room)
{
#if HWY_TARGET == HWY_AVX2
    using U64x4 = Lanes<uint64_t, 4>;
    constexpr size_t kGroup = 5, kGroupLenMax = 10, kJumpsLen = 6, kReserve = 32;
    const size_t each = (len + 3) / 4, last = len - 3 * each, share = (room - kJumpsLen) / 4;
    const U64x4 starts = U64x4 { 0, 1, 2, 3 } * share + reinterpret_cast<uintptr_t>(out + kJumpsLen);
    U64x4 to = starts, bits = 0, count = 0;
    const auto shr = [](U64x4 lanes, U64x4 by) HWY_ATTR { return Natively<U64x4>(lanes, by, [](auto a, auto b) HWY_ATTR { return a >> b; }); };
    const auto add = [&](U64x4 more, bool is_roomy) HWY_ATTR {
        bits = shr(bits, more & 15) | (is_roomy ? more : more & ~uint64_t { 15 });
        count += more & 15;
    };
    const auto flush = [&] HWY_ATTR {
        alignas(32) void* ends[4];
        Store(ends, to);
        asm volatile("" : "+m"(ends));
        const auto words = As<Lanes<double, 4>>(shr(bits, 64 - count));
        for (size_t lane = 0; lane < 4; lane++)
            Store(ends[lane], words[lane]);
        to += count >> 3;
        count &= 7;
    };
    size_t left = each;
    for (const size_t whole = last / kGroup * kGroup; left > whole; flush()) {
        const uint8_t* at = symbols + --left;
        add(U64x4 { codes[at[0]], codes[at[each]], codes[at[2 * each]], left < last ? codes[at[3 * each]] : 0 }, false);
    }
    while (left) {
        const size_t used = __builtin_reduce_max(to - starts) + kReserve, groups = std::min(left / kGroup, Less(share, used) / kGroupLenMax);
        if (!groups)
            return 0;
        const uint8_t *at = symbols + left, *fourth = at + 3 * each;
        left -= kGroup * groups;
        for (const uint8_t* end = symbols + left; at != end; flush()) {
            at = Opaque(at - kGroup), fourth = Opaque(fourth - kGroup);
            for (size_t i = kGroup; i--;) {
                U64x4 a = codes[at[i]], b = codes[at[each + i]], c = codes[at[2 * each + i]], d = codes[fourth[i]];
                asm("" : "+x"(a), "+x"(b), "+x"(c), "+x"(d));
                add(__builtin_shufflevector(__builtin_shufflevector(a, b, 0, 5, 2, 7), __builtin_shufflevector(c, d, 0, 5, 2, 7), 0, 1, 6, 7), i != 0);
            }
        }
    }
    add(uint64_t { 1 } << 63 | 1, false);
    flush();
    const U64x4 lens = to - starts + ((count + 7) >> 3);
    Store(out, To<Lanes<uint16_t, 4>>(lens).s01);
    Store<uint16_t>(out + 4, lens[2]);
    size_t written = kJumpsLen + lens[0];
    for (size_t lane = 1; lane < 4; written += lens[lane++])
        memmove(out + written, out + kJumpsLen + lane * share, lens[lane]);
    return written;
#else
    return 0;
#endif
}

// Lengths start as the ideal ones rounded up. As long as there are codes left, those get shorter that were rounded the most.
static uint32_t AssignCodes(const uint32_t* counts, size_t used, uint32_t limit, uint64_t* codes, uint8_t* lens, uint16_t* per_len)
{
    constexpr uint16_t kStepLog = 4, kSteps = 1 << kStepLog, kAbsent = 127;
    // In steps, and with an offset. 0 for 0.
    const auto log = [](Lanes<int32_t, 16> of) HWY_ATTR { return To<U16x16>(As<Lanes<uint32_t, 16>>(To<Lanes<float, 16>>(of)) >> (23 - kStepLog)); };
    const auto below = [](U16x16 values, uint16_t limit) HWY_ATTR { return As<U16x16>(As<I16x16>(values) < int16_t(limit)); };
    // How much of all codes each one takes, and how far it is from deserving twice as much.
    alignas(32) uint16_t shares[256], lacks[256];
    U32x8 sums = 0;
    for (size_t at = 0; at < used; at += 8)
        sums += Eight(counts + at);
    int32_t left = -1;
    for (uint16_t top = log(__builtin_reduce_add(sums)).x + kSteps; left < 0; top += kSteps / 2) {
        if (top > 200 * kSteps)
            return 0;
        U16x16 taken = 0;
        for (size_t at = 0; at < used; at += 16) {
            const U16x16 logs = log(Load<Lanes<int32_t, 16>>(counts + at)), is_absent = As<U16x16>(logs == 0);
            const U16x16 steps = Min(Max(Less(U16x16(top), logs), kSteps), (limit + 1) * kSteps - 1);
            const U16x16 share_logs = (uint16_t(limit) - (steps >> kStepLog)) | (is_absent & 128);
            const U16x16 share = LookUp({ 1, 2, 4, 8, 16, 32, 64, 128 }, share_logs | (share_logs ^ 8) << 8);
            Store(shares + at, share);
            Store(lacks + at, (steps & (kSteps - 1)) | (is_absent & kAbsent));
            taken += share;
        }
        left = (1 << limit) - __builtin_reduce_add(To<Lanes<int32_t, 16>>(taken));
    }

    uint16_t granted = 0, taken = 0;
    for (uint16_t step = kSteps / 2; step; step /= 2) {
        U16x16 wanted = 0;
        for (size_t at = 0; at < used; at += 16)
            wanted += Load<U16x16>(shares + at) & below(Load<U16x16>(lacks + at), granted + step);
        const uint16_t sum = __builtin_reduce_add(wanted);
        granted += Either<uint16_t>(sum <= left, step, 0), taken = Either(sum <= left, sum, taken);
    }
    left -= taken;
    uint16_t next[16] = {};
    for (size_t at = 0; at < used; at += 16) {
        const U16x16 share = Load<U16x16>(shares + at), lack = Load<U16x16>(lacks + at), is_granted = below(lack, granted);
        next[at / 16] = As<uint16_t>(To<Lanes<bool, 16>>(lack == granted));
        Store(shares + at, share + (share & is_granted));
        Store(lacks + at, lack + (is_granted & kSteps));
    }
    const auto grant = [&](size_t symbol) HWY_ATTR {
        const uint16_t more = Either<uint16_t>(shares[symbol] <= left, shares[symbol], 0);
        shares[symbol] += more, left -= more;
        lacks[symbol] = std::min(lacks[symbol] + kSteps, kAbsent - 1);
    };
    for (size_t at = 0; at < used; at += 64) {
        for (uint64_t symbols = Load<uint64_t>(next + at / 16); symbols && left; symbols &= symbols - 1)
            grant(at + __builtin_ctzll(symbols));
    }
    while (left) {
        U16x16 symbols = As<U16x16>(Tabulate<16>([](size_t i) { return uint16_t(i); })), first = 0xFFFF;
        for (size_t at = 0; at < used; at += 16, symbols += 16)
            first = Min(first, Load<U16x16>(lacks + at) << 8 | symbols | ~below(Load<U16x16>(shares + at), left + 1));
        const uint16_t best = __builtin_reduce_min(first);
        if (best >> 8 >= kAbsent)
            return 0;
        grant(best % 256);
    }

    memset(lens, 0, 256);
    for (size_t at = 0; at < used; at += 16) {
        const U16x16 logs = log(To<Lanes<int32_t, 16>>(Load<U16x16>(shares + at))) >> kStepLog;
        Store(lens + at, To<U8x16>((uint16_t(limit + 127) - logs) & As<U16x16>(logs != 0) & 15));
    }
    const auto with_len = [&](size_t at, int8_t len) HWY_ATTR { return Signs(Same(Load<I8x32>(lens + at), len), Same(Load<I8x32>(lens + at + 32), len)); };
    uint64_t next_codes[16] = {}, code = 0;
    uint32_t longest = 0;
    Store<U16x16>(per_len, 0);
    for (uint32_t len = limit; len; len--) {
        uint64_t count = 0;
        for (size_t at = 0; at < used; at += 64)
            count += std::popcount(with_len(at, len));
        per_len[len] = count, next_codes[len] = code | len;
        longest = Either(code == 0 && count, len, longest);
        code += count << (64 - len);
    }
    for (size_t at = 0; at < used; at += 64) {
        for (uint64_t symbols = ~with_len(at, 0); symbols; symbols &= symbols - 1) {
            const size_t symbol = at + __builtin_ctzll(symbols), len = lens[symbol];
            codes[symbol] = next_codes[len];
            next_codes[len] += uint64_t { 1 } << -len % 64;
        }
    }
    return longest;
}

static uint32_t EstimateCost(const uint32_t* counts)
{
    // In 16ths, times the value.
    const auto log = [](U32x8 of) HWY_ATTR { return ((As<U32x8>(To<F32x8>(As<I32x8>(of))) >> 19) - 127 * 16) * of; };
    U32x8 sums = 0, logs = 0;
    uint64_t absent = 0;
    for (size_t at = 0; at < 64; at += 8) {
        sums += Eight(counts + at), logs += log(Eight(counts + at));
        absent |= uint64_t { Signs(Eight(counts + at) == 0) } << at;
    }
    const uint32_t total = __builtin_reduce_add(sums), gaps = std::popcount(absent & ~absent >> 1);
    return (log(total).x - __builtin_reduce_add(logs)) / 16 + 5 * (std::popcount(~absent) + gaps) + 24;
}

static size_t BuildTable(const uint32_t* counts, size_t symbol_count, uint32_t log, size_t first_state, uint16_t* next_states, uint8_t* transforms, uint8_t* out)
{
    constexpr uint32_t kFraction = 22, kBitsShift = 28;
    const uint32_t size = 1 << log;
    U32x8 sums = 0, largest = 0;
    uint64_t present = 0;
    for (size_t at = 0; at < symbol_count; at += 8) {
        sums += Eight(counts + at);
        present |= uint64_t { Signs(Eight(counts + at) == 0) ^ 255 } << at;
    }
    const uint32_t used = 64 - LeadingZeros(present), scale = (size << kFraction) / std::max(__builtin_reduce_add(sums), 1u);
    alignas(32) uint32_t shares[64], starts[64] = {}, ends[64];
    sums = 0;
    for (size_t at = 0; at < used; at += 8) {
        const U32x8 some = Eight(counts + at), exact = some * scale;
        // Large ones make up for the rare ones.
        const U32x8 share = Max((exact + Less(U32x8(9 << kFraction >> 4), exact >> 5)) >> kFraction, Min(some, 1));
        Store(shares + at, share);
        sums += share, largest = Max(largest, share << 6 | (As<U32x8>(LaneNumbers()) + uint32_t(at)));
    }
    const int32_t left = size - __builtin_reduce_add(sums), most = __builtin_reduce_max(largest);
    if (-left >= most >> 7 || !present)
        return 0;
    shares[most % 64] += left;

    uint8_t sorted[(1 << kLogMax) + 32];
    uint64_t bits = log - 5;
    uint32_t bit_count = 4, total = 0;
    const auto add = [&](uint64_t more, uint32_t count) HWY_ATTR {
        Store(out + bit_count / 8, bits |= more << bit_count % 8);
        bits >>= (bit_count % 8 + count) & 56;
        bit_count += count;
    };
    for (size_t expected = 0; present; present &= present - 1) {
        const uint32_t symbol = __builtin_ctzll(present), share = shares[symbol], zeros = symbol - std::exchange(expected, symbol + 1);
        const uint32_t remaining = size + 1 - total, width = Log2(remaining), short_below = (2 << width) - 1 - remaining;
        // Behind the first of several zeros, 2 bits tell how many of the next three are zeros as well.
        const uint32_t threes = (zeros + 2) * 171 >> 9, zero_width = width + (short_below <= 1);
        const uint64_t flags = (uint64_t { zeros + 3 - 3 * threes } << 2 * threes >> 2) - 1;
        add(Either<uint64_t>(zeros, 1 | flags << zero_width, 0), Either(zeros, zero_width + 2 * threes, 0));
        add(share + 1 + Either((share + 1) >> width, short_below, 0), width + (share + 1 >= short_below));
        uint32_t filled = 0;
        do
            Store(sorted + total + filled, U8x32(symbol));
        while ((filled += 32) < share);
        starts[symbol] = total, ends[symbol] = total += share;
    }
    for (size_t at = 0; at < used; at += 8) {
        const U32x8 share = Eight(shares + at), is_absent = As<U32x8>(share == 0), most_bits = log - is_absent - Log2<U32x8>((Max(share, 1) - 1) | 1);
        const U32x8 state_delta = Eight(starts + at) - share + uint32_t(first_state), bits_delta = (most_bits << kBitsShift) - (Shl(share, most_bits) | (is_absent & size));
        Store(transforms + 8 * at, __builtin_shufflevector(state_delta, bits_delta, 0, 8, 1, 9, 2, 10, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15));
    }
    // The inverse of the step with which symbols are spread.
    const uint32_t step = size / 2 + size / 8 + 3, inverse = step * (2 - step * step), back = inverse * (2 - step * inverse);
    // From both ends, a symbol that repeats waits half as long.
    for (uint32_t low = size, high = 2 * size - 1, at = 0; low < high; low++, high--) {
        next_states[starts[sorted[at]]++] = low;
        at = (at + back) & (size - 1);
        next_states[--ends[sorted[size - at]]] = high;
    }
    return (bit_count + 7) / 8;
}

} // namespace HWY_NAMESPACE
} // namespace bun::zstd_stages
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun::zstd_stages {
HWY_EXPORT(Index);
HWY_EXPORT(Search);
HWY_EXPORT(WriteSequences);
HWY_EXPORT(EstimateCounts);
HWY_EXPORT(WriteLiterals);
HWY_EXPORT(AssignCodes);
HWY_EXPORT(EstimateCost);
HWY_EXPORT(BuildTable);

// Whatever the bytes, the tables and the scratch memory hold, these stay within them.
extern "C" void highway_zstd_stages_index(const Request* request, size_t from)
{
    if (request->len >= kLenMin)
        BUN_HWY_DISPATCH(Index)(request, from);
}

// Writes up to a sequence per 4 bytes and a literal per byte from the anchor on, and 32 more of each.
extern "C" void highway_zstd_stages_search(const Request* request, Sink* sink)
{
    if (request->len >= kLenMin)
        BUN_HWY_DISPATCH(Search)(request, sink);
}

// Whatever the codes, the sequences and the progress are, writes up to `room` bytes.
extern "C" size_t highway_zstd_write_sequences(const Codes* codes, const uint8_t* sequences, size_t count, uint8_t* out, size_t room, Progress* progress)
{
    return BUN_HWY_DISPATCH(WriteSequences)(codes, sequences, count, out, room, progress);
}

// Reads `len` bytes, of which there are at least 64 unless the weight is 1, and writes 256 counts.
extern "C" uint32_t highway_zstd_estimate_counts(const uint8_t* bytes, size_t len, size_t weight, uint32_t* counts)
{
    return BUN_HWY_DISPATCH(EstimateCounts)(bytes, len, weight, counts);
}

// Reads `len` symbols and 256 codes. Whatever these are, writes up to `room` bytes.
extern "C" size_t highway_zstd_write_literals(const uint8_t* symbols, size_t len, const uint64_t* codes, uint8_t* out, size_t room)
{
    return len >= 12 && room >= 256 ? BUN_HWY_DISPATCH(WriteLiterals)(symbols, len, codes, out, std::min<size_t>(room, 1 << 18)) : 0;
}

// There are 256 counts, codes and lengths, and 16 numbers per length.
extern "C" uint32_t highway_zstd_assign_codes(const uint32_t* counts, size_t used, uint32_t limit, uint64_t* codes, uint8_t* lens, uint16_t* per_len)
{
    return used <= 256 && limit - 1 < 12 ? BUN_HWY_DISPATCH(AssignCodes)(counts, used, limit, codes, lens, per_len) : 0;
}

// Reads 64 counts.
extern "C" uint32_t highway_zstd_estimate_cost(const uint32_t* counts)
{
    return BUN_HWY_DISPATCH(EstimateCost)(counts);
}

// For 16 or 64 symbols. Whatever the counts are, writes as many transforms, `1 << log` states, and 96 bytes at most.
extern "C" size_t highway_zstd_build_table(const uint32_t* counts, size_t symbol_count, uint32_t log, size_t first_state, uint16_t* next_states, uint8_t* transforms, uint8_t* out)
{
    return log - 5 < 5 ? BUN_HWY_DISPATCH(BuildTable)(counts, symbol_count, log, first_state, next_states, transforms, out) : 0;
}
} // namespace bun::zstd_stages
#endif
