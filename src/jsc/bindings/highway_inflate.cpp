// The kernels that decode several parts of a DEFLATE block at once. src/highway/inflate.rs says what each takes.

#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | HWY_NEON | HWY_NEON_BF16 | HWY_SSE4 | (HWY_AVX2 - 1))
#ifndef __OPTIMIZE__
#error "Unless hwy::ChosenTarget::GetIndex() is inlined, the linker may keep that of a file with other targets."
#endif

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_inflate.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#ifndef BUN_INFLATE_TYPES
#define BUN_INFLATE_TYPES
namespace bun {

static constexpr size_t kLanes = 5;
static constexpr size_t kRows = 432;
// Of the links, in bytes from the start of the entries.
static constexpr size_t kLinks = 66 * 1024;
static constexpr size_t kStageLen = 256;

struct InflateLanes {
    uint64_t bits[kLanes];
    uint64_t indices[kLanes];
    const uint8_t* inputs[kLanes];
};

// For each length, the entries of the symbols that have a codeword of it.
template<size_t kSymbols>
struct InflateLists {
    uint32_t entries[16][kSymbols + 16];
    uint16_t ends[16];
};
using InflateLitlens = InflateLists<288>;
using InflateDistances = InflateLists<32>;

// The literals whose codewords have the same length.
struct InflateUsual {
    alignas(16) uint8_t literals[256];
    uint16_t bytes[8][8], factors[8][8];
    uint8_t len, first, last;
};

struct InflateSegment {
    uint32_t* start;
    const uint32_t* end;
};

// Positions count from `out`.
struct InflateSheet {
    uint8_t* out;
    int32_t limit;
    int32_t stage;
    int32_t first;
    int32_t max_distance;
    // Of `out` in a ring.
    int32_t offset;
    int32_t lap;
    // The results.
    int32_t written;
    int32_t token;
    const uint32_t* row;
    // Where the block ends, if it has got there, and the bits of the rest of that group.
    const uint32_t* last;
    size_t dropped, stops;
};

struct InflateReversed {
    uint16_t indices[1024];
};
[[maybe_unused]] static constexpr InflateReversed inflateReversed = [] {
    InflateReversed table {};
    for (uint16_t i = 0; i < 1024; i++)
        table.indices[i] = __builtin_bitreverse16(i);
    return table;
}();

// For each period, where in it each of 32 bytes is, and how many bytes the whole periods take.
struct InflatePeriods {
    alignas(32) uint8_t indices[17][32];
    uint8_t steps[32];
};
[[maybe_unused]] static constexpr InflatePeriods inflatePeriods = [] {
    InflatePeriods table {};
    for (size_t period = 1; period < 32; period++) {
        for (size_t i = 0; i < 32 && period <= 16; i++)
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

static bool InflateIsSupported() { return !HWY_ARCH_X86_64 || HWY_TARGET == HWY_AVX2; }

#if HWY_ARCH_X86_64 && HWY_TARGET != HWY_AVX2

static uint32_t InflateBuild(const InflateLitlens*, const InflateDistances*, uint32_t, uint32_t, uint32_t*, uint32_t*) { return 0; }
static void InflateLookUp(const uint32_t*, uint32_t, InflateLanes*, uint32_t*, size_t) {}
static uint8_t* InflateGuess(const uint32_t*, uint32_t, const InflateUsual*, const uint8_t*, size_t*, uint8_t*, size_t*) { return nullptr; }
static void InflateSeek(const uint32_t*, size_t, const uint16_t*, uint16_t*) {}
static size_t InflateLiterals(const uint32_t*, size_t, uint8_t**) { return 0; }
static void InflateWrite(const InflateSegment*, InflateSheet*) {}

#else

namespace hn = hwy::HWY_NAMESPACE;

using D8 = hn::ScalableTag<uint8_t>;
using D16 = hn::ScalableTag<uint16_t>;
using DI16 = hn::ScalableTag<int16_t>;
using D32 = hn::ScalableTag<uint32_t>;
using DI32 = hn::ScalableTag<int32_t>;
using D64 = hn::ScalableTag<uint64_t>;
using V16 = hn::Vec<DI16>;

using V32 = hn::Vec<D32>;

static constexpr uint32_t kKind = 0xC0, kDistance = 0x40, kLength = 0x80, kStop = 0xC0, kOneByte = 1 << 8, kEnd = kStop | kOneByte;
static constexpr uint32_t kMinBits = 5, kRootBits = 12, kLongBits = 11, kDistanceBits = 9;
// So that two tokens and an index fit in 56 bits.
static constexpr uint32_t kTokenBits = 22;
static constexpr size_t kWords = hn::MaxLanes(D32());

// Keeps the compiler from moving what leads to the vector behind the copies that it is to overlap with.
template<class V>
static HWY_INLINE void Pin(V& v)
{
#if HWY_ARCH_X86_64
    asm volatile("" : "+x"(v.raw));
#else
    (void)v;
#endif
}

static HWY_INLINE void Repeat(uint32_t* to, size_t len, uint32_t entry)
{
    HWY_UNROLL(1)
    for (size_t i = 0; i < len; i += kWords)
        hn::StoreU(hn::Set(D32(), entry), D32(), to + i);
}

// Tables are drafted with the first bit of the stream as the highest of the index, which puts the codewords in order.
template<size_t kSymbols>
struct Code {
    const InflateLists<kSymbols>& lists;
    uint32_t shortest, longest;
    bool is_complete;
    // How many of the longest codewords there are the ones behind each length leave room for.
    uint32_t longer[16];
    uint16_t counts[16];

    HWY_INLINE explicit Code(const InflateLists<kSymbols>* it)
        : lists(*it)
    {
        uint32_t used = 0, space = 0, symbols = 0;
        HWY_UNROLL(15)
        for (uint32_t len = 15; len != 0; len--) {
            counts[len] = lists.ends[len] - len * (kSymbols + 16);
            longer[len] = space;
            used = 2 * used + (counts[len] != 0);
            space += static_cast<uint32_t>(counts[len]) << (15 - len);
            symbols += counts[len];
        }
        shortest = 1 + __builtin_ctzg(used, 0), longest = 32 - __builtin_clzg(used, 32);
        is_complete = space == 1 << 15 && symbols <= kSymbols;
    }

    // Of the table for the codewords that are too long for the root.
    HWY_INLINE uint32_t LongBits(uint32_t root_bits) const
    {
        return 32 - __builtin_clz(((longer[root_bits] >> (15 - longest)) - (longest > root_bits)) | 1 << (kMinBits - 1));
    }

    // Another bit makes one token of two more often, and takes twice as long.
    HWY_INLINE uint32_t BestRootBits(uint32_t input_len) const
    {
        const auto share = [&](uint32_t len) { return static_cast<uint32_t>(counts[len]) << (kRootBits - len); };
        int64_t gain = 0, best = kDistanceBits;
        for (uint32_t bits = kDistanceBits + 1; bits <= kRootBits; bits++) {
            int64_t saved = (share(bits) << kRootBits) + (bits % 2 ? 0 : share(bits / 2) * share(bits / 2) / 2);
            for (uint32_t len = 1; 2 * len < bits; len++)
                saved += share(len) * share(bits - len);
            // The largest does not leave much of the cache.
            saved -= bits == kRootBits ? 1 << 21 : 0;
            gain += (saved * input_len >> 20) - (2 << bits);
            best = HWY_MAX(best, gain * 16 + bits);
        }
        return best % 16;
    }

    // With up to 16 zeros.
    HWY_INLINE uint32_t* Append(uint32_t* to, uint32_t len, uint32_t bits) const
    {
        const D32 d;
        const size_t count = counts[len];
        size_t done = 0;
        do {
            for (size_t i = done; i < done + 16; i += kWords) {
                const auto is_in = hn::RebindMask(d, hn::Lt(hn::Iota(DI32(), i), hn::Set(DI32(), count)));
                hn::StoreU(hn::IfThenElseZero(is_in, hn::Add(hn::LoadU(d, lists.entries[len] + i), hn::Set(d, bits))), d, to + i);
            }
            done += 16;
        } while (done < count);
        return to + count;
    }

    // The level from `1 << bits` on is for so many bits behind the first `skipped`, and has zeros for longer codewords.
    HWY_INLINE void Fill(uint32_t* levels, uint32_t first, uint32_t last, uint32_t skipped) const
    {
        for (uint32_t bits = first; bits <= last; bits++) {
            Double(levels + (1 << bits) / 2, levels + (1 << bits), 1 << bits);
            const uint32_t len = bits + skipped;
            Append(levels + (2 << bits) - (longer[len] >> (15 - len)) - counts[len], len, bits);
        }
    }

    // What comes before the codewords that are too long for the root is only found if the input changes meanwhile.
    HWY_INLINE void FillLong(uint32_t* levels, uint32_t root_bits, uint32_t bits) const
    {
        const uint32_t skipped = longest - bits, before = 1 << (root_bits - skipped);
        Repeat(levels + before, before, kEnd + kOneByte + 1);
        Fill(levels, root_bits - skipped + 1, bits, skipped);
    }

    static HWY_INLINE void Double(const uint32_t* from, uint32_t* to, size_t len)
    {
        const D32 d;
        const auto twice = hn::Add(hn::Mul(hn::ShiftRight<1>(hn::Iota(d, 0)), hn::Set(d, 0x04040404)), hn::Set(d, 0x03020100));
        HWY_UNROLL(1)
        for (const uint32_t* end = to + len; to < end; from += kWords / 2, to += kWords)
            hn::StoreU(hn::TableLookupBytes(hn::LoadDup128(d, from), twice), d, to);
    }
};

// `four(i, lane)` points to the entries from `4 * i` on, which go to that lane of so many vectors, counted from the first. `put(at, offset, v, w)` gets those for `at + offset` and half a table on.
template<class Four, class Put>
static HWY_INLINE void Reverse(uint32_t bits, Four four, Put put)
{
    const D32 d;
    const D64 d64;
    const size_t quarter = (1 << bits) / 4, step = quarter / 4;
    const auto load = [&](size_t i, size_t lane) HWY_ATTR {
        if constexpr (kWords == 4)
            return hn::LoadU(d, four(i, lane));
        else
            return hn::Combine(d, hn::LoadU(hn::Half<D32>(), four(i + step / 2, lane + 4)), hn::LoadU(hn::Half<D32>(), four(i, lane)));
    };
    size_t at = 0;
    HWY_UNROLL(1)
    for (size_t i = 0; i < quarter / kWords;) {
        const auto a = load(i, at), b = load(i + 2 * step, at + 1), c = load(i + step, at + 2), e = load(i + 3 * step, at + 3);
        const auto ab = hn::BitCast(d64, hn::InterleaveLower(d, a, b)), ce = hn::BitCast(d64, hn::InterleaveLower(d, c, e));
        put(at, 0, hn::BitCast(d, hn::InterleaveLower(d64, ab, ce)), hn::BitCast(d, hn::InterleaveUpper(d64, ab, ce)));
        const auto ba = hn::BitCast(d64, hn::InterleaveUpper(d, a, b)), ec = hn::BitCast(d64, hn::InterleaveUpper(d, c, e));
        put(at, quarter, hn::BitCast(d, hn::InterleaveLower(d64, ba, ec)), hn::BitCast(d, hn::InterleaveUpper(d64, ba, ec)));
        // Counts with the bits the other way round.
        at ^= quarter - (quarter / 2 >> __builtin_ctzll(++i));
    }
}

struct Linker {
    uint32_t* entries;
    size_t start, half;
    V16 after_length, linking, after_link;

    HWY_INLINE void operator()(size_t at, size_t offset, V32 first, V32 second) const
    {
        const DI16 d;
        at += start + offset;
        hn::Store(first, D32(), entries + at);
        hn::Store(second, D32(), entries + at + half);
        const auto low = [](V32 v) HWY_ATTR { return hn::And(hn::BitCast(DI32(), v), hn::Set(DI32(), 0x7FC0)); };
        const auto both = hn::OrderedDemote2To(d, low(first), low(second));
        const auto is_length = hn::Eq(hn::And(both, hn::Set(d, kKind)), hn::Set(d, kLength));
        const auto link = hn::Or(hn::IfThenElseZero(is_length, after_length), hn::IfThenElseZero(hn::Eq(both, linking), after_link));
        int16_t* links = reinterpret_cast<int16_t*>(entries) + kLinks / 2 + at;
        hn::Store(hn::LowerHalf(link), hn::Half<DI16>(), links);
        hn::Store(hn::UpperHalf(hn::Half<DI16>(), link), hn::Half<DI16>(), links + half);
    }
};

static HWY_NOINLINE void Publish(const uint32_t* levels, uint32_t bits, uint32_t* entries, size_t start, int16_t after_length, int16_t after_link)
{
    const DI16 d;
    const Linker linker { entries, start, size_t { 1 } << bits >> 1, hn::Set(d, after_length), hn::Set(d, kStop), hn::Set(d, after_link) };
    Reverse(bits, [&](size_t i, size_t) { return levels + (1 << bits) + 4 * i; }, linker);
}

// With complete codes no level overflows.
static uint32_t InflateBuild(const InflateLitlens* litlen_lists, const InflateDistances* distance_lists, uint32_t input_len, uint32_t shortest_length, uint32_t* draft, uint32_t* entries)
{
    const D32 d;
    const Code litlens(litlen_lists);
    const Code distances(distance_lists);
    if (!litlens.is_complete || !distances.is_complete)
        return 0;
    // The most bits that a codeword leaves of an index.
    constexpr uint32_t kLeftBits = 9;
    uint32_t root_bits = HWY_MIN(input_len == ~0u ? kRootBits : litlens.BestRootBits(input_len), litlens.shortest + kLeftBits);
    while (root_bits <= kRootBits && litlens.LongBits(root_bits) > root_bits)
        root_bits++;
    const uint32_t distance_bits = HWY_MIN(HWY_MAX(distances.longest, kMinBits), kDistanceBits), far_bits = distances.LongBits(distance_bits);
    if (root_bits > kRootBits || litlens.LongBits(root_bits) > kLongBits || far_bits > kDistanceBits)
        return 0;
    const uint32_t long_bits = litlens.LongBits(root_bits), first_bits = root_bits - 2;
    const uint32_t literal_left = HWY_MIN(root_bits - HWY_MIN(root_bits, litlens.shortest), kLeftBits);
    const uint32_t length_left = HWY_MIN(root_bits - HWY_MIN(root_bits, shortest_length), kLeftBits);
    const size_t long_start = (2 << root_bits) - (1 << long_bits), distance_start = (3 << root_bits) - (1 << distance_bits), far_start = (4 << root_bits) - (1 << far_bits);

    constexpr size_t kPart = (2 << kLeftBits) + 16;
    // What is added to a literal and to a length with 0 to 2 extra bits, in levels, and what is too long for that.
    uint32_t *seconds = draft, *tail = seconds + 4 * kPart;
    uint32_t *distance_levels = tail + kPart, *offsets = distance_levels, *levels = distance_levels + kPart, *firsts = levels;
    static_assert(8 * kPart <= 4 * kLanes * kRows && 3 * 288 + 16 <= kPart && (2 << kLongBits) + 16 <= 4 * kPart && 1 << (kRootBits - 2) <= kPart);

    levels[1] = distance_levels[1] = 0;
    litlens.Fill(levels, 1, HWY_MAX(first_bits, literal_left), 0);
    distances.Fill(distance_levels, 1, HWY_MAX(distance_bits, length_left), 0);
    if (const size_t far = distances.longer[distance_bits] >> (15 - distance_bits)) {
        Repeat(distance_levels + (2 << distance_bits) - far, far, kStop + distances.longest - far_bits);
        distances.FillLong(seconds, distance_bits, far_bits);
        Publish(seconds, far_bits, entries, far_start, 0, 0);
    }
    Publish(distance_levels, distance_bits, entries, distance_start, 0, far_start);
    for (size_t i = 0; i < 2u << literal_left; i += kWords) {
        const auto entry = hn::LoadU(d, levels + i);
        const auto second = hn::OddEven(hn::BitCast(D16(), hn::ShiftLeft<24>(hn::ShiftRight<16>(entry))), hn::BitCast(D16(), entry));
        hn::StoreU(hn::IfThenElseZero(hn::Eq(hn::And(entry, hn::Set(d, kKind)), hn::Zero(d)), hn::BitCast(d, second)), d, seconds + i);
    }
    memset(seconds, 0, 16);
    for (uint32_t bits = 0; bits <= length_left; bits++) {
        const auto too_long = hn::Set(DI32(), kTokenBits + 1 - root_bits + bits);
        for (size_t i = 0; i < 1 << bits; i += kWords) {
            const auto entry = hn::LoadU(d, distance_levels + (1 << bits) + i);
            const auto fits = hn::RebindMask(d, hn::Lt(hn::BitCast(DI32(), hn::And(hn::Xor(entry, hn::Set(d, kDistance)), hn::Set(d, 255))), too_long));
            const auto put = [&](size_t extra_bits, size_t index, uint32_t extra) HWY_ATTR {
                const auto second = hn::Sub(entry, hn::Set(d, kLength + (1 << 16 << extra_bits) - extra * kOneByte));
                hn::StoreU(hn::IfThenElseZero(fits, second), d, seconds + ((1 + extra_bits) << (kLeftBits + 1)) + (((1 << extra_bits) + index) << bits) + i);
            };
            put(0, 0, 0);
            if (bits + 1 <= length_left)
                put(1, 0, 0), put(1, 1, 1);
            if (bits + 2 <= length_left)
                put(2, 0, 0), put(2, 1, 2), put(2, 2, 1), put(2, 3, 3);
        }
    }
    litlens.Append(offsets, root_bits - 1, root_bits - 1);
    litlens.Double(offsets, tail, 2 * litlens.counts[root_bits - 1]);
    const size_t links = litlens.longer[root_bits] >> (15 - root_bits);
    Repeat(litlens.Append(tail + 2 * litlens.counts[root_bits - 1], root_bits, root_bits), links, litlens.longest - long_bits);

    // Four entries in a row start with the same codeword, or are in the tail.
    const uint32_t* level = levels + (1 << first_bits);
    Reverse(first_bits, [&](size_t i, size_t) { return level + 4 * i; }, [&](size_t at, size_t offset, V32 first, V32 second) HWY_ATTR {
        hn::StoreU(first, d, firsts + at + offset);
        hn::StoreU(second, d, firsts + at + offset + (1 << first_bits) / 2); });
    const uint32_t tail_start = (1 << root_bits) - (litlens.longer[first_bits] >> (15 - root_bits));
    for (size_t i = 0; i < 1 << first_bits; i += kWords) {
        const auto first = hn::LoadU(d, firsts + i);
        const auto index = hn::ShiftRightSame(hn::PromoteTo(d, hn::LoadU(hn::Rebind<uint16_t, D32>(), inflateReversed.indices + i)), 16 - root_bits);
        const auto is = [&](uint32_t mask, uint32_t value) HWY_ATTR { return hn::Eq(hn::And(first, hn::Set(d, mask)), hn::Set(d, value)); };
        const auto is_short = is(0xFFF80000 | kKind, kLength);
        auto extra_bits = hn::IfThenElseZero(is_short, hn::ShiftRight<17>(first));
        Pin(extra_bits);
        const auto range = hn::Shr(hn::Set(d, 1 << root_bits), hn::And(hn::Sub(first, extra_bits), hn::Set(d, 31)));
        const auto most = hn::IfThenElse(is_short, hn::Set(d, 1 << length_left), hn::IfThenElse(is(kKind, 0), hn::Set(d, 1 << literal_left), hn::Set(d, -1)));
        const auto part = hn::Sub(extra_bits, hn::VecFromMask(d, is_short));
        const auto offset = hn::Add(hn::ShiftLeft<kLeftBits + 1>(part), hn::Or(range, hn::And(index, hn::Sub(range, hn::Set(d, 1)))));
        const auto is_alone = hn::RebindMask(d, hn::Gt(hn::BitCast(DI32(), range), hn::BitCast(DI32(), most)));
        const auto is_in_tail = hn::RebindMask(d, hn::Gt(hn::BitCast(DI32(), index), hn::Set(DI32(), tail_start - 1)));
        hn::StoreU(hn::IfThenElse(is_in_tail, hn::Add(index, hn::Set(d, 4 * kPart - tail_start)), hn::IfThenZeroElse(is_alone, offset)), d, offsets + i);
    }
    const Linker linker { entries, 0, size_t { 1 } << root_bits >> 1, hn::Set(DI16(), distance_start), hn::Zero(DI16()), hn::Set(DI16(), long_start) };
    auto sums = hn::Zero(d);
    Reverse(root_bits, [&](size_t, size_t lane) { return seconds + offsets[lane]; }, [&](size_t at, size_t offset, V32 first, V32 second) HWY_ATTR {
        second = hn::Add(second, hn::LoadU(d, firsts + at));
        linker(at, offset, hn::Add(first, hn::LoadU(d, firsts + at)), second);
        if (__builtin_constant_p(offset))
            sums = hn::Add(sums, hn::And(second, hn::Set(d, 63))); });

    if (links != 0) {
        litlens.FillLong(seconds, root_bits, long_bits);
        Publish(seconds, long_bits, entries, long_start, distance_start, 0);
    }
    return root_bits | (32 * hn::ReduceSum(d, sums) >> root_bits << 8);
}

#if HWY_ARCH_X86_64

// The index goes from the register `old` to `now`. There are not enough registers for a compiler.
#define BUN_INDEX(bits, old, now)                \
    "bzhi %k[root], %k[" bits "], %k[" now "]\n" \
    "orw %c[links](%[entries], %[" old "], 2), %w[" now "]\n"
#define BUN_TAKE(lane, column, row, bits, old, now)                                         \
    "mov (%[entries], %[" now "], 4), %k[" old "]\n"                                        \
    "mov %k[" bits "], (4 * " lane " + 2 + " column ") * %c[stride] + 4 * " row "(%[to])\n" \
    "shrx %[" old "], %[" bits "], %[" bits "]\n"                                           \
    "mov %k[" old "], (4 * " lane " + " column ") * %c[stride] + 4 * " row "(%[to])\n"
#define BUN_STEP(lane, column, row, old, now) BUN_INDEX("b" lane, old, now) BUN_TAKE(lane, column, row, "b" lane, old, now)
#define BUN_REFILL_AND_STEP(lane, column, row, old, now) \
    BUN_INDEX("b" lane, old, now)                        \
    "lzcnt %[b" lane "], %[" old "]\n"                   \
    "mov %k[" old "], %k[b" lane "]\n"                   \
    "shr $3, %k[b" lane "]\n"                            \
    "add 8 * " lane " + %[locals], %[b" lane "]\n"       \
    "and $7, %k[" old "]\n"                              \
    "mov %[b" lane "], 8 * " lane " + %[locals]\n"       \
    "mov (%[b" lane "]), %[b" lane "]\n"                 \
    "bts $63, %[b" lane "]\n"                            \
    "shrx %[" old "], %[b" lane "], %[b" lane "]\n" BUN_TAKE(lane, column, row, "b" lane, old, now)
#define BUN_STEPS(EVEN, ODD, column, row, a, b, c, d, e, f) \
    EVEN("0", column, row, b, a)                            \
    ODD("1", column, row, c, b)                             \
    EVEN("2", column, row, d, c)                            \
    ODD("3", column, row, e, d)                             \
    EVEN("4", column, row, f, e)
#define BUN_ROW(row, a, b, c, d, e, f)                                   \
    BUN_STEPS(BUN_REFILL_AND_STEP, BUN_STEP, "0", row, a, b, c, d, e, f) \
    BUN_STEPS(BUN_STEP, BUN_REFILL_AND_STEP, "1", row, f, a, b, c, d, e)

__attribute__((no_sanitize("address"))) static void InflateLookUp(const uint32_t* entries, uint32_t root_bits, InflateLanes* lanes, uint32_t* to, size_t rows)
{
    // The inputs, and where `to` ends. One in front, so that the operand has an offset to add to.
    const void* locals[kLanes + 2];
    memcpy(locals + 1, lanes->inputs, sizeof(lanes->inputs));
    locals[kLanes + 1] = to + rows;
    uint64_t spare;
    asm volatile(
        ".p2align 5\n"
        "1:\n" BUN_ROW("0", "i5", "i0", "i1", "i2", "i3", "i4")
            BUN_ROW("1", "i3", "i4", "i5", "i0", "i1", "i2")
                BUN_ROW("2", "i1", "i2", "i3", "i4", "i5", "i0") "add $12, %[to]\n"
                                                                 ".p2align 4\n"
                                                                 "cmp 40 + %[locals], %[to]\n"
                                                                 "jb 1b\n"
        : [b0] "+r"(lanes->bits[0]), [b1] "+r"(lanes->bits[1]), [b2] "+r"(lanes->bits[2]), [b3] "+r"(lanes->bits[3]), [b4] "+r"(lanes->bits[4]),
        [i0] "+r"(lanes->indices[0]), [i1] "+r"(lanes->indices[1]), [i2] "+r"(lanes->indices[2]), [i3] "+r"(lanes->indices[3]),
        [i4] "+r"(lanes->indices[4]), [i5] "=&r"(spare), [to] "+r"(to)
        : [locals] "m"(locals[1]), [entries] "r"(entries), [root] "r"(root_bits), [links] "i"(kLinks), [stride] "i"(4 * kRows)
        : "cc", "memory");
    memcpy(lanes->inputs, locals + 1, sizeof(lanes->inputs));
}

#else

static void InflateLookUp(const uint32_t* HWY_RESTRICT entries, uint32_t root_bits, InflateLanes* HWY_RESTRICT state, uint32_t* HWY_RESTRICT to, size_t rows)
{
    const uint16_t* links = reinterpret_cast<const uint16_t*>(entries) + kLinks / 2;
    const uint64_t mask = (1 << root_bits) - 1;
    InflateLanes lanes = *state;
    for (; rows != 0; rows--, to++) {
        HWY_UNROLL(10)
        for (size_t step = 0; step < 2 * kLanes; step++) {
            const size_t lane = step % kLanes, column = step / kLanes;
            uint64_t &bits = lanes.bits[lane], &index = lanes.indices[lane];
            index = (bits & mask) | links[index];
            if (column == lane % 2) {
                const uint64_t used = __builtin_clzg(bits, 64);
                lanes.inputs[lane] += used / 8;
                memcpy(&bits, lanes.inputs[lane], 8);
                bits = (bits | 1ull << 63) >> used % 8;
            }
            const uint32_t entry = entries[index];
            to[(4 * lane + column) * kRows] = entry;
            to[(4 * lane + 2 + column) * kRows] = static_cast<uint32_t>(bits);
            bits >>= entry % 64;
        }
    }
    *state = lanes;
}

#endif

static constexpr size_t kGroup = hn::MaxLanes(DI16());
static constexpr size_t kGroupLen = 2 * kGroup;
static constexpr size_t kCopied = 32;
static constexpr size_t kAhead = 1024;
// In bytes of the rings: how far writing is behind the positions, so that it does not wait for their stores.
static constexpr size_t kLag = 64;

static HWY_INLINE void Copy(const uint8_t* from, uint8_t* to)
{
    uint8_t bytes[kCopied];
    memcpy(bytes, from, kCopied);
    memcpy(to, bytes, kCopied);
}

static HWY_INLINE void CopyCarefully(const uint8_t* from, uint8_t* to, const uint8_t* end)
{
    const D8 d;
    const size_t period = to - from;
    if (HWY_LIKELY(period >= kCopied)) {
        HWY_UNROLL(1)
        do {
            __builtin_prefetch(to + kAhead, 1);
            Copy(from, to);
            Copy(from + kCopied, to + kCopied);
            from += 2 * kCopied, to += 2 * kCopied;
        } while (to < end);
        return;
    }
    const auto part = [&](size_t at) HWY_ATTR {
        return period > 16 ? hn::LoadU(d, from + at) : hn::TableLookupBytes(hn::LoadDup128(d, from), hn::Load(d, inflatePeriods.indices[period] + at));
    };
    const auto first = part(0), last = part(kCopied - hn::Lanes(d));
    const size_t step = inflatePeriods.steps[period];
    HWY_UNROLL(1)
    do {
        hn::StoreU(first, d, to);
        hn::StoreU(last, d, to + kCopied - hn::Lanes(d));
        to += step;
    } while (to < end);
}

// Three at a time.
static HWY_INLINE uint8_t* GuessFew(const uint32_t* entries, uint32_t root_bits, uint32_t len, const uint8_t* input, size_t* bit, uint8_t* to, size_t* turns)
{
    const uint32_t usual = kOneByte | len, mask = (1 << root_bits) - 1;
    const uint8_t* next = input + *bit / 8 + 1;
    uint64_t bits = next[-1] >> *bit % 8;
    // In the lowest 6 bits.
    uint32_t count = 8 - *bit % 8;
    const auto take = [&] {
        const uint32_t first = entries[bits & mask], second = entries[bits >> len & mask], third = entries[bits >> 2 * len & mask];
        to[0] = first >> 16, to[1] = second >> 16;
        const bool is_first = static_cast<uint16_t>(first) != usual, is_second = static_cast<uint16_t>(second) != usual;
        uint32_t all = __builtin_unpredictable(is_second) ? second + usual : third + 2 * usual, before = __builtin_unpredictable(is_second) ? usual : 2 * usual;
        all = __builtin_unpredictable(is_first) ? first : all, before = __builtin_unpredictable(is_first) ? 0 : before;
        if (HWY_UNLIKELY((all - before - kOneByte) & 0xFEC0)) {
            count -= before, to += before / kOneByte;
            return false;
        }
        memcpy(to + before / kOneByte, reinterpret_cast<const uint8_t*>(&all) + 2, 2);
        bits >>= all % 64, count -= all, to += all / kOneByte % 8;
        return true;
    };
    size_t left = 7 * *turns;
    for (; left != 0; left--) {
        uint64_t word;
        memcpy(&word, next, 8);
        bits |= word << count % 64, next += ~count / 8 % 8, count |= 56;
        if (!take() || !take())
            break;
    }
    *bit = 8 * (next - input) - count % 64;
    *turns = 3 * (7 * *turns - left) + 8;
    return to;
}

// A turn reads 48 bytes at most, goes on by 40 at most, and writes up to 34. `turns` becomes how many literals take as long one by one.
static uint8_t* InflateGuess(const uint32_t* entries, uint32_t root_bits, const InflateUsual* usual, const uint8_t* input, size_t* bit, uint8_t* to, size_t* turns)
{
    const D8 d;
    const D16 du;
    const size_t len = usual->len;
    if ((usual->last + 1) << (8 - len) < 232)
        return GuessFew(entries, root_bits, len, input, bit, to, turns);
    const auto mask = hn::Set(d, (1 << len) - 1), first = hn::Set(d, usual->first ^ 0x80);
    // Indices start at the least number.
    const hn::RebindToSigned<D8> di;
    const auto last = hn::Set(di, usual->last ^ 0x80);
    const auto reversed = hn::Dup128VecFromValues(d, 0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15);
    const auto low = hn::And(reversed, mask), high = hn::And(hn::ShiftLeft<4>(reversed), mask);
    size_t from = *bit, count = 0;
    uint32_t entry = 0;
    hn::Vec<D8> indices[32 / hn::MaxLanes(d)], next[32 / hn::MaxLanes(d)];
    for (auto& index : indices)
        index = hn::Zero(d);
    // A turn late, so that it does not hold up what the next turn waits for.
    const auto write = [&] HWY_ATTR {
        for (size_t i = 0; i < 32; i += hn::Lanes(d)) {
            auto literals = hn::Zero(d), left = hn::Xor(indices[i / hn::Lanes(d)], hn::Set(d, 0x80));
            HWY_UNROLL(1)
            for (size_t part = 0; part <= usual->last; part += 64) {
                for (size_t j = part; j < part + 64; j += 16, left = hn::Sub(left, hn::Set(d, 16))) {
                    // NEON has zeros for all that is out of range.
                    const auto in_range = HWY_ARCH_X86_64 ? hn::SaturatedAdd(left, hn::Set(d, 0x70)) : left;
                    literals = hn::Or(literals, hn::TableLookupBytesOr0(hn::LoadDup128(d, usual->literals + j), in_range));
                }
            }
            hn::StoreU(literals, d, to + i);
        }
        memcpy(to + count, reinterpret_cast<const uint8_t*>(&entry) + 2, 2);
        to += count + entry / kOneByte % 4;
    };
    size_t left = *turns;
    for (; left != 0; left--) {
        const auto bytes = hn::LoadDup128(du, usual->bytes[from % 8]), factors = hn::LoadDup128(du, usual->factors[from % 8]);
        const auto eight = [&](const uint8_t* at) HWY_ATTR {
            const hn::Full128<uint8_t> d128;
            auto words = hn::ResizeBitCast(d, hn::LoadU(d128, at));
            if constexpr (kWords == 8)
                words = hn::InsertBlock<1>(words, hn::LoadU(d128, at + 2 * len));
            return hn::BitCast(DI16(), hn::ShiftRight<8>(hn::Mul(hn::TableLookupBytes(hn::BitCast(du, words), bytes), factors)));
        };
        uint64_t others = 1ull << 32;
        for (size_t i = 0; i < 32; i += hn::Lanes(d)) {
            const uint8_t* at = input + from / 8 + i / 8 * len;
            const auto codes = hn::ReorderDemote2To(d, eight(at), eight(at + len));
            const auto index = hn::Sub(hn::Or(hn::TableLookupBytes(high, hn::And(codes, hn::Set(d, 15))), hn::TableLookupBytes(low, hn::ShiftRight<4>(codes))), first);
            others |= hn::BitsFromMask(di, hn::Gt(hn::BitCast(di, index), last)) << i;
            next[i / hn::Lanes(d)] = index;
        }
        const size_t next_count = __builtin_ctzll(others);
        from += next_count * len;
        uint32_t word;
        memcpy(&word, input + from / 8, 4);
        uint32_t next_entry = entries[word >> from % 8 & ((1 << root_bits) - 1)];
        asm volatile("" : "+r"(next_entry));
        write();
        memcpy(indices, next, 32);
        count = next_count, entry = 0;
        if (HWY_UNLIKELY((next_entry - kOneByte) & 0xFEC0))
            break;
        entry = next_entry, from += entry % 64;
    }
    write();
    *bit = from;
    *turns = 5 * (*turns - left) + 10;
    return to;
}

static HWY_INLINE V16 Lows(V32 even, V32 odd) { return hn::InterleaveEven(DI16(), hn::BitCast(DI16(), even), hn::BitCast(DI16(), odd)); }

static void InflateSeek(const uint32_t* tokens, size_t rows, const uint16_t* targets, uint16_t* found)
{
    const DI16 d;
    V16 bases[kLanes], reached[kLanes], counts[kLanes];
    for (size_t lane = 0; lane < kLanes; lane++)
        bases[lane] = reached[lane] = counts[lane] = hn::Zero(d);
    for (size_t done = 0; done + kGroup / 2 <= rows; done += kGroup / 2) {
        auto goes_on = hn::Zero(d);
        HWY_UNROLL(5)
        for (size_t lane = 0; lane < kLanes; lane++) {
            // The last lane backwards in place of the first.
            const uint32_t* row = tokens + 4 * kRows * (lane == 0 ? kLanes - 1 : lane) + (lane == 0 ? rows - kGroup / 2 - done : done);
            auto sum = hn::And(Lows(hn::LoadU(D32(), row), hn::LoadU(D32(), row + kRows)), hn::Set(d, 63));
            sum = lane == 0 ? hn::Reverse(d, sum) : sum;
            sum = hn::Add(sum, hn::ShiftLeftLanes<1>(d, sum));
            sum = hn::Add(sum, hn::ShiftLeftLanes<2>(d, sum));
            sum = hn::Add(sum, hn::ShiftLeftLanes<4>(d, sum));
            const auto total = hn::Broadcast<7>(sum);
            sum = hn::Add(sum, bases[lane]);
            bases[lane] = hn::Add(bases[lane], total);
            if constexpr (kGroup == 16) {
                sum = hn::Add(sum, hn::ConcatLowerLower(d, total, hn::Zero(d)));
                bases[lane] = hn::Add(bases[lane], hn::SwapAdjacentBlocks(total));
            }
            const auto target = hn::Set(d, targets[lane] + 1);
            const auto is_before = hn::VecFromMask(d, hn::Lt(sum, target));
            counts[lane] = hn::Sub(counts[lane], is_before);
            reached[lane] = hn::Max(reached[lane], hn::And(sum, is_before));
            goes_on = hn::Or(goes_on, hn::Sub(bases[lane], target));
        }
        if (hn::GetLane(goes_on) >= 0)
            break;
    }
    for (size_t lane = 0; lane < kLanes; lane++)
        found[2 * lane] = hn::ReduceSum(d, counts[lane]), found[2 * lane + 1] = hn::ReduceMax(d, reached[lane]);
}

static size_t InflateLiterals(const uint32_t* row, size_t groups, uint8_t** to)
{
    const DI16 d;
    const hn::Repartition<int8_t, DI16> d8;
    uint8_t* next = *to;
    size_t tokens = 0;
    for (; tokens < 16 * groups; tokens += kGroup, row += kGroup / 2) {
        const auto even = hn::LoadU(D32(), row), odd = hn::LoadU(D32(), row + kRows);
        const auto low = Lows(even, odd), count = hn::And(hn::ShiftRight<8>(low), hn::Set(d, 3));
        const auto literals = hn::BitCast(D8(), hn::InterleaveOdd(d, hn::BitCast(d, even), hn::BitCast(d, odd)));
        const auto counts = hn::RebindMask(D8(), hn::Gt(hn::BitCast(d8, hn::Or(count, hn::ShiftLeft<8>(count))), hn::BitCast(d8, hn::Set(d, 0x100))));
        const auto is_literal = hn::Eq(hn::And(low, hn::Set(d, kKind)), hn::Zero(d));
        if (HWY_UNLIKELY(!hn::AllTrue(d, is_literal))) {
            const size_t before = hn::FindKnownFirstTrue(d, hn::Not(is_literal));
            next += hn::CompressStore(literals, hn::And(counts, hn::FirstN(D8(), 2 * before)), D8(), next);
            tokens += before;
            break;
        }
        next += hn::CompressStore(literals, counts, D8(), next);
    }
    *to = next;
    return tokens;
}

// The lanes from the last of `earlier` on, or from the second.
template<size_t kSkipped>
static HWY_INLINE V16 Shifted(V16 earlier, V16 later)
{
    const DI16 d;
    if constexpr (kGroup == 8)
        return hn::CombineShiftRightBytes<2 * kSkipped>(d, later, earlier);
    else if constexpr (kSkipped < 8)
        return hn::CombineShiftRightBytes<2 * kSkipped>(d, hn::ConcatLowerUpper(d, later, earlier), earlier);
    else
        return hn::CombineShiftRightBytes<2 * kSkipped - 16>(d, later, hn::ConcatLowerUpper(d, later, earlier));
}

template<bool kIsPlain>
static HWY_INLINE void Write(const InflateSegment* segment, InflateSheet* sheet)
{
    const DI16 d;
    const D16 du;
    const D32 d32;
    struct alignas(64) {
        // Plus one.
        int16_t sources[kStageLen / 2];
        // The complement if one copy does not do.
        int16_t targets[kStageLen / 2];
        // Two groups late.
        int16_t literals[kStageLen / 2];
    } rings;
    const auto in_ring = [](int16_t* ring, uint8_t at) { return reinterpret_cast<int16_t*>(reinterpret_cast<uint8_t*>(ring) + at); };
    uint8_t* const out = sheet->out;
    uint8_t* const stage = out + sheet->stage;
    const auto set = [&](size_t number) HWY_ATTR { return hn::Set(d, static_cast<int16_t>(number)); };
    const auto limit = set(sheet->limit), first = set(sheet->first), max = set(sheet->max_distance - 1);
    const auto offset = set(sheet->offset), lap = set(sheet->lap), lap_start = set(-HWY_MIN(sheet->offset, 32768));
    const uint8_t* const origin = out - (kIsPlain ? 0 : sheet->offset);
    const uint8_t* before = origin - 1;
#if HWY_ARCH_ARM_A64
    // A pair of loads cannot subtract 1.
    asm("" : "+r"(before));
#endif
    const auto staged = set(stage - origin + 1);
    for (size_t at = 0; at < kStageLen; at += kGroupLen) {
        hn::Store(hn::Add(staged, hn::ShiftLeft<1>(hn::Iota(d, at / 2))), d, in_ring(rings.literals, at + 2 * kGroupLen));
        hn::StoreU(hn::Zero(D8()), D8(), stage + kCopied + at);
    }
    for (size_t at = kStageLen - kLag; at < kStageLen; at += kGroupLen) {
        hn::Store(staged, d, in_ring(rings.sources, at));
        hn::Store(hn::Zero(d), d, in_ring(rings.targets, at));
    }

    const auto write = [&](uint8_t at, size_t token) HWY_ATTR {
        const ptrdiff_t source = static_cast<std::conditional_t<kIsPlain, int16_t, uint16_t>>(in_ring(rings.sources, at)[token]);
        uintptr_t to;
        if (HWY_LIKELY(!__builtin_add_overflow(static_cast<uintptr_t>(in_ring(rings.targets, at)[token]), reinterpret_cast<uintptr_t>(out), &to))) {
            if (kIsPlain && token % 8 == 0)
                __builtin_prefetch(reinterpret_cast<uint8_t*>(to + kAhead), 1);
            return Copy(before + source, reinterpret_cast<uint8_t*>(to));
        }
        const ptrdiff_t next = *in_ring(rings.targets, at + 2 * token + 2);
        CopyCarefully(before + source, out + ~(to - reinterpret_cast<uintptr_t>(out)), out + (next ^ (next >> 63)));
    };

    uint32_t* row = segment->start;
    const uint32_t *end = segment->end, *placed_row;
    const auto next_group = [&]() {
        placed_row = row;
        row += kGroup / 2;
        if (HWY_UNLIKELY(row >= end)) {
            segment++;
            row = segment->start, end = segment->end;
        }
    };
    // `between(n)` is called with 0 to 5.
    const auto read = [&](uint8_t at, V16& low, V16& number, auto between) HWY_ATTR {
        const auto highs = [&](V32 even, V32 odd) HWY_ATTR { return hn::InterleaveOdd(du, hn::BitCast(du, even), hn::BitCast(du, odd)); };
        auto even = hn::LoadU(d32, row), odd = hn::LoadU(d32, row + kRows);
        // The last bit that an entry stands for becomes the highest but one.
        auto even_bits = hn::Shl(hn::LoadU(d32, row + 2 * kRows), hn::AndNot(even, hn::Set(d32, 31)));
        Pin(even_bits), between(0);
        auto odd_bits = hn::Shl(hn::LoadU(d32, row + 3 * kRows), hn::AndNot(odd, hn::Set(d32, 31)));
        Pin(odd_bits), between(1);
        auto bits = highs(even_bits, odd_bits);
        low = Lows(even, odd);
        Pin(bits), Pin(low), between(2);
        auto high = highs(even, odd);
        hn::StoreU(hn::BitCast(D8(), high), D8(), stage + at);
        bits = hn::Add(bits, bits);
        Pin(bits), between(3);
        const auto lowest = hn::And(high, hn::Sub(hn::Zero(du), high));
        bits = hn::MulHigh(bits, lowest);
        high = hn::Xor(high, lowest);
        Pin(bits), Pin(high), between(4);
        number = hn::BitCast(d, hn::Add(hn::ShiftRight<1>(high), bits));
        Pin(number), between(5);
    };

    V16 low, number, next_low, next_number, rests = hn::Zero(d), position = hn::Zero(d);
    V16 new_rests, new_position, sources, targets, is_right;
    // `between(n)` is called with 6 to 15.
    const auto place = [&](uint8_t at, auto between) HWY_ATTR {
        auto kind = hn::And(low, hn::Set(d, kKind));
        auto len = hn::BitCast(d, hn::ShiftRight<8>(hn::BitCast(du, low)));
        auto is_length = hn::VecFromMask(d, hn::Eq(kind, hn::Set(d, kLength)));
        auto is_literal = hn::VecFromMask(d, hn::Eq(kind, hn::Zero(d)));
        Pin(len), Pin(is_length), Pin(is_literal), between(6);
        new_rests = hn::And(hn::And(is_length, hn::Set(d, 255)), number);
        len = hn::Add(len, Shifted<kGroup - 1>(rests, new_rests));
        Pin(len), between(7);
        // Less one.
        auto distance = hn::IfThenElse(hn::MaskFromVec(is_length), Shifted<1>(number, next_number), number);
        Pin(distance), between(8);
        auto sum = hn::Add(len, hn::BitCast(d, hn::ShiftLeft<16>(hn::BitCast(D64(), len))));
        sum = hn::Add(sum, hn::BitCast(d, hn::ShiftLeft<32>(hn::BitCast(D64(), sum))));
        Pin(sum), between(9);
        auto at_once = hn::Or(distance, is_literal);
        Pin(at_once);
        at_once = hn::BitCast(d, hn::Min(hn::BitCast(du, at_once), hn::Set(du, kCopied)));
        auto is_marked = hn::VecFromMask(d, hn::Gt(len, at_once));
        targets = hn::Sub(position, len);
        Pin(is_marked), Pin(targets), between(10);
        auto fourth = hn::Dup128VecFromValues(d, -1, -1, -1, -1, 0x0706, 0x0706, 0x0706, 0x0706), last = hn::Set(d, 0x0F0E);
        sum = hn::Add(sum, hn::TableLookupBytesOr0(sum, fourth));
        Pin(last);
        auto total = hn::TableLookupBytes(sum, last);
        targets = hn::Add(targets, sum);
        Pin(total), Pin(targets), between(11);
        new_position = hn::Add(position, total);
        if constexpr (kGroup == 16) {
            targets = hn::Add(targets, hn::ConcatLowerLower(d, total, hn::Zero(d)));
            new_position = hn::Add(new_position, hn::SwapAdjacentBlocks(total));
        }
        Pin(targets), Pin(new_position), between(12);
        const auto or_literals = [&] HWY_ATTR { return hn::IfThenElse(hn::MaskFromVec(is_literal), hn::Load(d, in_ring(rings.literals, at)), sources); };
        sources = hn::Sub(targets, distance);
        if constexpr (kIsPlain)
            sources = or_literals();
        targets = hn::Xor(targets, is_marked);
        Pin(sources), Pin(targets), between(13);
        auto stops = hn::Or(hn::And(next_low, hn::Add(next_low, next_low)), hn::VecFromMask(d, hn::Gt(new_position, limit)));
        Pin(stops), between(14);
        is_right = hn::VecFromMask(d, hn::Gt(sources, first));
        if constexpr (!kIsPlain) {
            is_right = hn::Or(is_literal, hn::AndNot(hn::VecFromMask(d, hn::Gt(distance, max)), is_right));
            sources = hn::Add(hn::Add(sources, offset), hn::IfThenZeroElse(hn::Gt(sources, lap_start), lap));
            sources = or_literals();
        }
        is_right = hn::AndNot(hn::And(is_marked, is_literal), is_right);
        auto goes_on = hn::AndNot(stops, is_right);
        Pin(goes_on), Pin(sources), between(15);
#if HWY_ARCH_X86_64
        return _mm256_testc_si256(goes_on.raw, hn::Set(d, 0x80).raw);
#else
        return hn::AllTrue(d, hn::TestBit(goes_on, hn::Set(d, 0x80)));
#endif
    };

    const InflateSegment* const last_segment = segment + kLanes;
    const auto get_past_stop = [&] HWY_ATTR {
        const intptr_t token = hn::FindFirstTrue(d, hn::Eq(hn::And(next_low, hn::Set(d, kKind)), hn::Set(d, kStop)));
        if (token < 0)
            return false;
        uint32_t *stop = row + token / 2 + token % 2 * kRows, *next = row + (token + 1) / 2 + (token + 1) % 2 * kRows;
        if ((*stop & ~63u) == kStop) {
            // One token for a distance that took two.
            *stop = *next + *stop % 64;
            *next = 0;
            sheet->stops++;
            return true;
        }
        if ((*stop & ~63u) != kEnd)
            return false;
        *stop -= kEnd;
        for (size_t column = 0; column < 2; column++) {
            uint32_t* entries = row + column * kRows;
            hn::StoreU(hn::IfThenElseZero(hn::FirstN(d32, (token + 2 - column) / 2), hn::LoadU(d32, entries)), d32, entries);
        }
        sheet->last = row + kGroup / 2;
        sheet->dropped = hn::ReduceSum(d, hn::IfThenZeroElse(hn::FirstN(d, token + 1), hn::And(next_low, hn::Set(d, 63))));
        segment = last_segment - 1, end = row;
        return true;
    };

    const auto nothing = [](size_t) {};
    // The first group does nothing.
    low = number = hn::Zero(d);
    placed_row = nullptr;
    // Where the group that is read goes.
    uint8_t at = 2 * kGroupLen;
    do {
        read(at - kGroupLen, next_low, next_number, nothing);
        for (bool goes_on = place(at, nothing); goes_on;) {
            const uint8_t placed = at - 2 * kGroupLen, written = placed - kLag;
            const auto write_one = [&](size_t step) HWY_ATTR {
                if (step % (16 / kGroup) == 0)
                    write(written, step / (16 / kGroup));
            };
            hn::Store(sources, d, in_ring(rings.sources, placed));
            hn::Store(targets, d, in_ring(rings.targets, placed));
            rests = new_rests, position = new_position, low = next_low, number = next_number;
            next_group();
            read(at, next_low, next_number, write_one);
            at += kGroupLen;
            goes_on = place(at, write_one);
        }
    } while (get_past_stop());

    const uint8_t placed = at - 2 * kGroupLen;
    hn::Store(sources, d, in_ring(rings.sources, placed));
    hn::Store(targets, d, in_ring(rings.targets, placed));
    // What is right of the group that is left, but for its last token, which may need the next.
    const auto ends = Shifted<1>(hn::Xor(targets, hn::ShiftRight<15>(targets)), hn::Set(d, 0x7FFF));
    const size_t more = row == last_segment->start + 8 ? 0 : hn::FindKnownFirstTrue(d, hn::Or(hn::Gt(ends, limit), hn::Eq(is_right, hn::Zero(d))));
    HWY_UNROLL(1)
    for (uint8_t written = placed - kLag; written != static_cast<uint8_t>(placed + 2 * more); written += 2)
        write(written, 0);
    const int16_t next = in_ring(rings.targets, placed)[more];
    sheet->row = placed_row ? placed_row : row;
    sheet->token = placed_row ? more : 0;
    sheet->written = next ^ (next >> 15);
    for (size_t i = 0; kIsPlain && i <= kStageLen + kCopied; i += 64)
        __builtin_prefetch(stage + sheet->written + i, 1);
}

static void InflateWrite(const InflateSegment* segments, InflateSheet* sheet)
{
    if (sheet->lap == 0 && sheet->max_distance == 32768)
        Write<true>(segments, sheet);
    else
        Write<false>(segments, sheet);
}

#endif

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
HWY_EXPORT(InflateIsSupported);
HWY_EXPORT(InflateBuild);
HWY_EXPORT(InflateLookUp);
HWY_EXPORT(InflateGuess);
HWY_EXPORT(InflateSeek);
HWY_EXPORT(InflateLiterals);
HWY_EXPORT(InflateWrite);

extern "C" bool highway_inflate_is_supported()
{
    return BUN_HWY_DISPATCH(InflateIsSupported)();
}

extern "C" uint32_t highway_inflate_build(const InflateLitlens* litlens, const InflateDistances* distances, uint32_t input_len, uint32_t shortest_length, uint32_t* draft, uint32_t* entries)
{
    return BUN_HWY_DISPATCH(InflateBuild)(litlens, distances, input_len, shortest_length, draft, entries);
}

extern "C" void highway_inflate_look_up(const uint32_t* entries, uint32_t root_bits, InflateLanes* lanes, uint32_t* to, size_t rows)
{
    BUN_HWY_DISPATCH(InflateLookUp)(entries, root_bits, lanes, to, rows);
}

extern "C" uint8_t* highway_inflate_guess(const uint32_t* entries, uint32_t root_bits, const InflateUsual* usual, const uint8_t* input, size_t* bit, uint8_t* to, size_t* turns)
{
    return BUN_HWY_DISPATCH(InflateGuess)(entries, root_bits, usual, input, bit, to, turns);
}

extern "C" void highway_inflate_seek(const uint32_t* tokens, size_t rows, const uint16_t* targets, uint16_t* found)
{
    BUN_HWY_DISPATCH(InflateSeek)(tokens, rows, targets, found);
}

extern "C" size_t highway_inflate_literals(const uint32_t* row, size_t groups, uint8_t** to)
{
    return BUN_HWY_DISPATCH(InflateLiterals)(row, groups, to);
}

extern "C" void highway_inflate_write(const InflateSegment* segments, InflateSheet* sheet)
{
    BUN_HWY_DISPATCH(InflateWrite)(segments, sheet);
}
} // namespace bun
#endif
