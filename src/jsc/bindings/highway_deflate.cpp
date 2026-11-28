// The kernels of the compressor in src/deflate, runtime-dispatched via Google Highway. src/highway/deflate.rs says what each takes.

// The list of highway_webp_decoder.cpp.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | HWY_NEON | HWY_NEON_BF16 | HWY_SSE4 | (HWY_AVX2 - 1))
#ifndef __OPTIMIZE__
#error "Unless hwy::ChosenTarget::GetIndex() is inlined, the linker may keep that of a file with other targets."
#endif

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_deflate.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <algorithm>
#include <bit>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <utility>

#ifndef BUN_DEFLATE_TYPES
#define BUN_DEFLATE_TYPES
namespace bun::deflate {

constexpr size_t maxBatch = 8192, maxOverrun = 288;
constexpr size_t maxMatch = 258, maxTables = 7;
constexpr uint32_t maxDistance = 32768;
// Positions within a batch count from so far in front of the first that is hashed.
constexpr size_t origin = 64;

struct Table {
    uint32_t* entries;
    uint32_t mask, gramLen;
};

struct Batch {
    const uint8_t* bytes;
    uint32_t oldest, hashFrom, hashTo, from, to, end;
    uint32_t window, stamp;
    Table tables[maxTables];
    const uint16_t* known;
    uint16_t* pricePerByte;
    struct Ladder* ladder;
    // A ring with the distance to the candidate of each stamped position.
    uint16_t* links;
    uint32_t linkMask, linkedFrom;
    uint8_t tableCount, finder, endsInput, expectsFewMatches, depth, didLinksPay, wereTokensFew, isHasty, passes;
    uint8_t distanceCosts[16], shortCosts[16], longCosts[16];
};
enum Finder : uint8_t { Nothing,
    Runs,
    Tables,
    Samples,
    Gaps,
    Everything };

struct Parsed {
    uint32_t tokens, position, candidates, runDistance;
    bool isLinked, didLinksPay;
};

// A position, and below it what it is compared with plus `maxDistance`.
using Candidate = uint32_t;
constexpr Candidate candidate(uint32_t position, uint32_t distance) { return position << 16 | (position + maxDistance - distance); }
constexpr Candidate noCandidate = candidate(40, 0);

struct Step {
    Candidate candidate;
    uint16_t beforeStart, equalAhead;
};

constexpr size_t cursors = 5;
constexpr size_t maxSteps = 2048, stepStride = maxSteps + 40;
constexpr size_t indexBits = 13;
constexpr size_t maxMatches = (1 << indexBits) - 1;

struct alignas(64) Scratch {
    union {
        // The last at or in front of each position.
        Candidate candidates[origin + maxBatch + 128];
        struct {
            Candidate none[origin];
            uint8_t ranks[maxBatch + 128];
        };
        // Of matches that overlap, from the one that starts last.
        struct {
            uint16_t beforeStarts[32], starts[maxBatch + 96], ends[maxBatch + 64];
        };
    };
    union {
        Step steps[cursors * stepStride];
        uint8_t folded[maxBatch + 96];
    };
    union {
        // For 32 positions each. If not all are hashed, only those have candidates, from `origin` on.
        struct {
            uint32_t areHashed, lastBefore;
        } groups[(origin + maxBatch) / 32];
        // Half of the token, without the length.
        float distances[maxBatch + 64];
    };
    union {
        uint16_t samples[maxBatch + 64];
        uint16_t unfinished[maxBatch + 64];
        uint16_t next[maxBatch + 64];
    };
};
static_assert(sizeof(Scratch) + 64 <= 164 * 1024);

constexpr size_t rungs = 16, topRung = 2 + rungs;
constexpr size_t atOnce = 128, lag = 128;
constexpr uint8_t noSymbol = 31;
struct alignas(64) Ladder {
    static constexpr size_t len = origin + maxBatch + maxOverrun + 160;
    // Of the nearest match at each position, by its length from 3 on.
    uint16_t distances[len][rungs];
    uint8_t symbols[len][rungs];
    // If it is too long for that. Where it ends, and in the lower half the complement of what `ending` has.
    uint64_t longest[len];
    // The distance above its symbol, of such a match that has `topRung` bytes left.
    uint32_t ending[len];
    uint32_t costs[len];
    uint16_t lens[len];
    Candidate longer[origin + maxBatch + atOnce];
    // For each table, and where those of `atOnce` positions start.
    Candidate news[maxTables][maxBatch + 16];
    uint16_t firstNews[maxTables][len / atOnce + 1];
};
static_assert(sizeof(Ladder) + 64 <= 824 * 1024);

constexpr uint32_t tagMask = 0 - maxDistance;
constexpr uint32_t odd = 0x1E35A7BD;
// Where the bytes behind the first four go, by the length of the gram. 0x80 is a zero.
constexpr uint32_t moreBytes[9] = { 0, 0, 0, 0x80808080, 0x80808080, 0x80808004, 0x80800504, 0x80060504, 0x07060504 };

struct SetBits {
    alignas(64) uint8_t indices[256][8];
};
constexpr SetBits setBits = [] {
    SetBits table {};
    for (size_t byte = 0; byte < 256; byte++) {
        for (size_t bit = 0, count = 0; bit < 8; bit++) {
            if (byte >> bit & 1)
                table.indices[byte][count++] = bit;
        }
    }
    return table;
}();

struct Code {
    uint16_t beforeSymbols[16], symbols[304], lens[304], unusedBefore[304];
    // At the top, with the length at the bottom.
    uint32_t words[304];
    uint16_t counts[16];
    uint32_t used;
};

struct Dynamic {
    Code litlen, offset, precode;
    uint8_t header[896];
};

struct Ones {
    alignas(64) uint16_t at[16][16];
};
constexpr Ones ones = [] {
    Ones table {};
    for (size_t i = 0; i < 16; i++)
        table.at[i][i] = 1;
    return table;
}();

struct Sums {
    int32_t symbols, different, timesLog;
};

struct BitState {
    uint64_t bits;
    size_t count;
};

} // namespace bun::deflate
#endif

#define BUN_INLINED HWY_ATTR __attribute__((always_inline))
#if HWY_ARCH_X86
// Or clang finds something that takes more instructions, or another order.
#define BUN_KEEP(vector) __asm__ volatile("" : "+x"((vector).raw))
#else
#define BUN_KEEP(vector) (void)0
#endif

HWY_BEFORE_NAMESPACE();
namespace bun::deflate {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

constexpr hn::ScalableTag<uint8_t> d8;
constexpr hn::ScalableTag<int16_t> d16;
constexpr hn::ScalableTag<uint16_t> du16;
constexpr hn::ScalableTag<int32_t> d32;
constexpr hn::ScalableTag<uint32_t> du32;
constexpr hn::ScalableTag<uint64_t> du64;
constexpr hn::ScalableTag<float> df;
using V32 = hn::Vec<decltype(du32)>;
constexpr size_t lanes16 = hn::MaxLanes(d16), lanes32 = hn::MaxLanes(d32);

static HWY_INLINE void Fence(const void* memory) { __asm__ volatile("" : : "r"(memory) : "memory"); }

static HWY_INLINE int32_t Larger(int32_t a, int32_t b) { return __builtin_unpredictable(a > b) ? a : b; }

// Not of 0.
static HWY_INLINE size_t LeadingZeros(uint32_t bits)
{
#if HWY_TARGET == HWY_AVX2
    // Highway asks the CPU for it, but not the compiler. BSR is slow on AMD.
    uint64_t zeros;
    __asm__("lzcnt %1, %k0" : "=r"(zeros) : "r"(bits) : "cc");
    return zeros;
#else
    return __builtin_clz(bits);
#endif
}

// A bit for each of 32 bytes.
static HWY_INLINE uint32_t Differing(const uint8_t* a, const uint8_t* b)
{
    uint32_t equal = 0;
    for (size_t i = 0; i < 32; i += hn::MaxLanes(d8))
        equal |= hn::BitsFromMask(d8, hn::Eq(hn::LoadU(d8, a + i), hn::LoadU(d8, b + i))) << i;
    return ~equal;
}

// Where what is like the bytes `distance` in front of it ends, or up to 31 behind `end`.
static HWY_INLINE size_t EndOfMatch(const uint8_t* bytes, size_t at, size_t end, size_t distance)
{
    for (; at < end; at += 32) {
        if (uint32_t differing = Differing(bytes + at, bytes + at - distance))
            return at + std::countr_zero(differing);
    }
    return at;
}

template<size_t lane> static HWY_INLINE V32 WithLane(V32 others, uint32_t value)
{
#if HWY_TARGET == HWY_AVX2
    auto all = hn::Set(du32, value);
    BUN_KEEP(all);
    return lane == 0 ? all : V32 { _mm256_blend_epi32(others.raw, all.raw, 1 << lane) };
#else
    return lane == 0 ? hn::Set(du32, value) : hn::InsertLane(others, lane, value);
#endif
}

// Calls `meanwhile` with 0 to 7.
template<size_t lane = 0> static HWY_INLINE V32 Exchange(uint32_t* table, const uint32_t* slots, const uint32_t* entries, V32 old, auto meanwhile)
{
    constexpr size_t calls = 8 / lanes32;
    uint64_t entry;
    memcpy(&entry, entries + lane, 8);
    old = WithLane<lane>(old, std::exchange(table[slots[lane]], static_cast<uint32_t>(entry)));
    for (size_t i = 0; i < calls; i++)
        meanwhile(lane * calls + i);
    old = WithLane<lane + 1>(old, std::exchange(table[slots[lane + 1]], entry >> 32));
    for (size_t i = calls; i < 2 * calls; i++)
        meanwhile(lane * calls + i);
    if constexpr (lane + 2 < lanes32)
        return Exchange<lane + 2>(table, slots, entries, old, meanwhile);
    return old;
}

// Makes each the largest so far, in three steps.
static HWY_INLINE void Carry(size_t step, V32& values, V32& carried, V32 last)
{
    if (step == 0) {
        values = hn::Max(values, hn::BitCast(du32, hn::ShiftLeft<32>(hn::BitCast(du64, values))));
    } else if (step == 1) {
        values = hn::Max(values, hn::Per4LaneBlockShuffle<1, 1, 1, 0>(values));
    } else {
#if HWY_TARGET == HWY_AVX2
        const auto highest = hn::Broadcast<3>(values);
        V32 lower;
        __asm__("vperm2i128 $8, %1, %1, %0" : "=x"(lower.raw) : "x"(highest.raw));
        values = hn::Max(hn::Max(values, carried), lower);
        carried = hn::TableLookupLanes(values, hn::IndicesFromVec(du32, last));
#else
        values = hn::Max(values, carried);
        carried = hn::Broadcast<3>(values);
#endif
    }
}

static HWY_INLINE V32 LargestSoFar(V32 values, V32& carried)
{
    auto last = hn::Set(du32, lanes32 - 1);
    BUN_KEEP(last);
    for (size_t step = 0; step < 3; step++)
        Carry(step, values, carried, last);
    return values;
}

static HWY_INLINE V32 Candidates(size_t position, uint32_t distance)
{
    return hn::Add(hn::Mul(hn::Iota(du32, 0), hn::Set(du32, 0x10001)), hn::Set(du32, candidate(position, distance)));
}

// Puts every position in the table. An entry is the sum of a tag and the position, so that a difference tells about both.
template<bool isLong, bool isFirst, bool isLast>
static HWY_NOINLINE void Hash(const Batch& batch, Table table, const uint8_t* grams, Candidate* HWY_RESTRICT found)
{
    constexpr size_t ahead = 32, group = 16, stretch = 64;
    const uint8_t* bytes = batch.bytes + batch.hashFrom;
    const size_t len = batch.hashTo - batch.hashFrom, history = batch.hashFrom - batch.oldest;
    const uint32_t stamp = batch.stamp + batch.hashFrom, used = (uint64_t { 1 } << 8 * (std::clamp(table.gramLen, 4u, 8u) - 4)) - 1;
    const auto steps = hn::Mul(hn::Iota(du32, 0), hn::Set(du32, 0x01010101));
    const auto first = hn::BitCast(d8, hn::Add(steps, hn::Set(du32, table.gramLen < 4 ? 0x02010080 : 0x03020100)));
    const auto multiplier = hn::Set(du32, odd);
    struct {
        V32 more, mask, tag, stampStep, candidateStep, last, farthest;
    } constants {
        hn::Add(steps, hn::Set(du32, moreBytes[std::min(table.gramLen, 8u)])), hn::Set(du32, table.mask), hn::Set(du32, tagMask),
        hn::Set(du32, lanes32), hn::Set(du32, lanes32 * 0x10001), hn::Set(du32, lanes32 - 1), steps
    };
    auto* with = &constants;
#if HWY_ARCH_X86
    // There are no registers for them, and like this they become operands.
    __asm__("" : "+r"(with) : : "memory");
#endif
    // Slots of the table, then what goes there.
    alignas(64) uint32_t ring[4 * ahead];
    auto stamps = steps, gram = steps, rest = steps, hashes = steps;
    // In steps, as the scheduler of the CPU fills up if much waits for the same. It completes the ones in front of `from`.
    const auto hash = [&](size_t step, const uint8_t* from, uint32_t* slots) BUN_INLINED {
        if (step == 0) {
            rest = hn::BitCast(du32, hn::LoadDup128(d8, from));
            hashes = hn::ReverseLaneBytes(hashes);
        } else if (step == 1) {
            hn::Store(hn::And(hashes, with->mask), du32, slots);
            hn::Store(hn::Add(stamps, hn::And(gram, with->tag)), du32, slots + 2 * ahead);
            stamps = hn::Add(stamps, with->stampStep);
        } else if (step == 2) {
            gram = hn::BitCast(du32, hn::TableLookupBytesOr0(hn::BitCast(d8, rest), first));
            if (isLong)
                rest = hn::Mul(hn::BitCast(du32, hn::TableLookupBytesOr0(hn::BitCast(d8, rest), hn::BitCast(d8, with->more))), multiplier);
        } else if (step == 7) {
            if (isLong)
                gram = hn::Add(gram, rest);
            hashes = hn::Mul(gram, multiplier);
        }
        if (step == 0 || (step % 4 == 2 && isLong))
            BUN_KEEP(rest);
        if (step == 2)
            BUN_KEEP(gram);
        if (step % 7 == 0)
            BUN_KEEP(hashes);
    };
    const auto startAt = [&](size_t at) BUN_INLINED {
        stamps = hn::Iota(du32, stamp + at - lanes32);
        HWY_UNROLL(1)
        for (size_t i = at; i <= at + ahead; i += lanes32) {
            HWY_UNROLL(8)
            for (size_t step = 0; step < 8; step++)
                hash(step, grams + i, ring + (i - lanes32) % (2 * ahead));
        }
    };
    auto here = Candidates(origin - lanes32, 0), carried = hn::Set(du32, noCandidate), back = hn::Zero(du32), farthest = hn::Not(back);
    // For the positions in front of `to`.
    const auto keep = [&](size_t step, Candidate* to) BUN_INLINED {
        if (step == 3) {
            back = hn::IfThenElseZero(hn::Ge(back, farthest), hn::Add(here, back));
            here = hn::Add(here, with->candidateStep);
            if (!isFirst) {
                const auto better = hn::Load(du32, to - lanes32);
                back = hn::Or(better, hn::IfThenElseZero(hn::Eq(better, hn::Zero(du32)), back));
            }
        } else if (step == 7) {
            hn::Store(back, du32, to - lanes32);
        } else if (step > 3 && isLast) {
            Carry(step - 4, back, carried, with->last);
        }
        if (step >= 3 && step < 7)
            BUN_KEEP(back);
    };

    found += origin;
    size_t at = 0;
    startAt(0);
    while (at + group <= len) {
        const size_t stop = std::min(at + stretch, len & ~(group - 1));
        // A little too far, which `Merge()` sees to.
        with->farthest = hn::Set(du32, 0 - std::min<size_t>(batch.window, history + stop));
        HWY_UNROLL(1)
        do {
            uint32_t *slots = ring + at % (2 * ahead), *later = ring + (at + ahead) % (2 * ahead);
            Candidate* to = found + at;
            // Stores without an index have a port of their own.
            __asm__("" : "+r"(slots), "+r"(later), "+r"(to));
            HWY_UNROLL(4)
            for (size_t i = 0; i < group; i += lanes32) {
                const uint32_t* entries = slots + 2 * ahead + i;
                const auto old = Exchange(table.entries, slots + i, entries, steps, [&](size_t step) BUN_INLINED {
                    hash(step, grams + at + ahead + lanes32 + i, later + i);
                    keep(step, to + i);
                });
                back = hn::Sub(old, hn::Load(du32, entries));
                farthest = with->farthest;
            }
            at += group;
        } while (at < stop);

        const Candidate last = found[at - 9];
        // Little is lost without the middle of a long match.
        size_t distance = (last >> 16) + maxDistance - last % 0x10000;
        if (HWY_LIKELY(last - *(found + at - stretch) != (stretch - 9) * 0x10001)) {
            if (HWY_LIKELY(Differing(bytes + at - 8, bytes + at - 9) != 0))
                continue;
            distance = 1;
        }
        const size_t end = std::min(len, EndOfMatch(bytes, at, len, distance));
        const size_t kept = 8 + (distance < stretch ? distance : 0);
        if (at + stretch + kept > end)
            continue;
        for (size_t step = 3; step < 8; step++)
            keep(step, found + at);
        back = hn::Set(du32, 0 - distance);
        const size_t resume = (end - kept) & ~(group - 1);
        // What it copies gets out of reach.
        for (size_t i = at; i < resume && distance >= stretch; i += 8) {
            uint32_t halves[2];
            memcpy(halves, grams + i, 8);
            const uint32_t gram = (halves[0] << (table.gramLen < 4 ? 8 : 0)) + (halves[1] & used) * odd;
            table.entries[__builtin_bswap32(gram * odd) & table.mask] = stamp + i + (gram & tagMask);
        }
        for (; at < resume; at += lanes32) {
            hn::Store(hn::Add(here, back), du32, found + at);
            here = hn::Add(here, hn::Set(du32, lanes32 * 0x10001));
        }
        here = hn::Sub(here, hn::Set(du32, lanes32 * 0x10001));
        startAt(at);
    }
    for (size_t step = 3; step < 8; step++)
        keep(step, found + at);
    for (; at < len; at++) {
        const uint32_t entry = ring[2 * ahead + at % (2 * ahead)];
        const uint32_t distance = entry - std::exchange(table.entries[ring[at % (2 * ahead)]], entry);
        if (!isFirst && found[at] != 0)
            continue;
        const bool isNear = distance - 1 < std::min<size_t>(batch.window, history + at);
        found[at] = isNear ? candidate(origin + at, distance) : isLast ? *(found + at - 1)
                                                                       : 0;
    }
}

// So that 8 bytes stand for up to 24.
static HWY_NOINLINE const uint8_t* Fold(const Batch& batch, size_t gramLen, Scratch& scratch)
{
    const uint8_t* bytes = batch.bytes + batch.hashFrom;
    if (gramLen <= 8)
        return bytes;
    for (size_t at = 0; at < batch.hashTo - batch.hashFrom + 48; at += hn::MaxLanes(d8)) {
        const auto folded = hn::Add(hn::LoadU(d8, bytes + at + gramLen / 2 - 4), hn::RotateRight<3>(hn::LoadU(d8, bytes + at + gramLen - 8)));
        hn::Store(hn::Add(hn::LoadU(d8, bytes + at), hn::RotateRight<3>(folded)), d8, scratch.folded + at);
    }
    return scratch.folded;
}

// The same for the positions that rank lowest within a radius, which are the same ones in both copies of a string.
static HWY_NOINLINE void HashSome(const Batch& batch, Table table, Scratch& scratch)
{
    constexpr ptrdiff_t radius = 3;
    const uint8_t* bytes = batch.bytes + batch.hashFrom;
    const size_t len = batch.hashTo - batch.hashFrom;
    // In text, words start there.
    for (size_t at = 0; at < len + 64; at += hn::MaxLanes(d8))
        hn::Store(hn::SaturatedAdd(hn::LoadU(d8, bytes + at - 32), hn::And(hn::LoadU(d8, bytes + at - 31), hn::Set(d8, 15))), d8, scratch.ranks + at);
    const hn::Full128<uint16_t> eight;
    auto first = hn::Zero(eight);
    size_t count = 0;
    scratch.groups[0] = scratch.groups[1] = { 0, origin - 1 };
    uint64_t lowest = 0, leading = 0;
    // Long grams are for few different bytes, which tie by chance.
    const uint64_t ties = table.gramLen < 8 ? UINT64_MAX : 0;
    for (size_t at = 0; at < len; at += 32) {
        uint32_t chosen = 0;
        for (size_t i = 0; i < 32; i += hn::MaxLanes(d8)) {
            const uint8_t* middle = scratch.ranks + 32 + at + i;
            auto least = hn::Load(d8, middle);
            for (ptrdiff_t away = 1; away <= radius; away++)
                least = hn::Min(least, hn::Min(hn::LoadU(d8, middle - away), hn::LoadU(d8, middle + away)));
            chosen |= hn::BitsFromMask(d8, hn::Eq(least, hn::Load(d8, middle))) << i;
        }
        // Of those that tie, it takes a few to find a short period.
        lowest = lowest >> 32 | uint64_t { chosen } << 32;
        leading = leading >> 32 | (lowest & ~(lowest << 1 | lowest << 2 | lowest << 3)) >> 32 << 32;
        chosen &= (leading | ((leading << 1 | leading << 2 | leading << 3) & ties)) >> 32;
        chosen = __builtin_unpredictable(chosen == 0) ? 0x10001 : chosen;
        if (HWY_UNLIKELY(len - at < 32))
            chosen &= (1u << (len - at)) - 1;
        scratch.groups[(origin + at) / 32] = { chosen, static_cast<uint32_t>(origin + count - 1) };
        HWY_UNROLL(4)
        for (size_t i = 0; i < 32; i += 8) {
            const uint8_t bits = chosen >> i;
            hn::StoreU(hn::Add(first, hn::PromoteTo(eight, hn::Load(hn::Full64<uint8_t>(), setBits.indices[bits]))), eight, scratch.samples + count);
            first = hn::Add(first, hn::Set(eight, 8));
            count += std::popcount(bits);
        }
    }

    // The last is repeated, and finds itself.
    hn::StoreU(hn::Set(eight, scratch.samples[count - (count != 0)]), eight, scratch.samples + count);
    const hn::Rebind<uint16_t, decltype(du32)> narrow;
    const auto used = hn::Set(du32, (uint64_t { 1 } << 8 * (std::clamp(table.gramLen, 4u, 8u) - 4)) - 1);
    const auto multiplier = hn::Set(du32, odd), mask = hn::Set(du32, table.mask), stamp = hn::Set(du32, batch.stamp + batch.hashFrom);
    const auto history = hn::Set(du32, batch.hashFrom - batch.oldest), window = hn::Set(du32, batch.window);
    auto carried = hn::Set(du32, noCandidate);
    constexpr size_t group = 64;
    struct alignas(64) {
        uint32_t grams[2 * group], slots[group], entries[group];
    } staged;
    for (size_t done = 0; done < count; done += group) {
        const uint16_t* samples = scratch.samples + done;
        const size_t some = std::min(group, (count - done + 7) & ~7);
        HWY_UNROLL(8)
        for (size_t i = 0; i < some; i++)
            memcpy(staged.grams + 2 * i, bytes + samples[i], 8);
        Fence(&staged);
        HWY_UNROLL(1)
        for (size_t i = 0; i < some; i += lanes32) {
            auto gram = used, more = used;
            hn::LoadInterleaved2(du32, staged.grams + 2 * i, gram, more);
            gram = hn::MulAdd(hn::And(more, used), multiplier, hn::ShiftLeftSame(gram, table.gramLen < 4 ? 8 : 0));
            hn::Store(hn::And(hn::ReverseLaneBytes(hn::Mul(gram, multiplier)), mask), du32, staged.slots + i);
            hn::Store(hn::Add(hn::Add(stamp, hn::PromoteTo(du32, hn::Load(narrow, samples + i))), hn::And(gram, hn::Set(du32, tagMask))), du32, staged.entries + i);
        }
        HWY_UNROLL(1)
        for (size_t i = 0; i < some; i += lanes32) {
            const auto back = hn::Sub(Exchange(table.entries, staged.slots + i, staged.entries + i, carried, [](size_t) {}), hn::Load(du32, staged.entries + i));
            const auto at = hn::PromoteTo(du32, hn::Load(narrow, samples + i));
            const auto here = hn::Add(hn::Or(at, hn::ShiftLeft<16>(at)), hn::Set(du32, candidate(origin, 0)));
            const auto isNear = hn::Lt(hn::Not(back), hn::Min(window, hn::Add(history, at)));
            hn::Store(LargestSoFar(hn::IfThenElseZero(isNear, hn::Add(here, back)), carried), du32, scratch.candidates + origin + done + i);
        }
    }
}

static HWY_NOINLINE void FindRuns(const Batch& batch, Candidate* HWY_RESTRICT found)
{
    const uint8_t* bytes = batch.bytes + batch.hashFrom - 1;
    const auto steps = hn::Mul(hn::Iota(du32, 0), hn::Set(du32, 0x01010101));
    const auto four = hn::BitCast(d8, hn::Add(steps, hn::Set(du32, 0x03020100)));
    auto here = Candidates(origin, 1), carried = hn::Set(du32, noCandidate);
    for (size_t at = 0; at < batch.hashTo - batch.hashFrom; at += lanes32) {
        const auto loaded = hn::LoadDup128(d8, bytes + at);
        const auto isRun = hn::Eq(hn::BitCast(du32, hn::TableLookupBytes(loaded, four)), hn::BitCast(du32, hn::TableLookupBytes(loaded, hn::BitCast(d8, steps))));
        hn::Store(LargestSoFar(hn::IfThenElseZero(isRun, here), carried), du32, found + origin + at);
        here = hn::Add(here, hn::Set(du32, lanes32 * 0x10001));
    }
}

// Of the 32 bytes in front of two places, and the 32 from there on.
struct Comparison {
#if HWY_TARGET == HWY_AVX2
    hn::Mask<decltype(d8)> back, ahead;
    HWY_INLINE void start(const uint8_t* a, const uint8_t* b)
    {
        back = hn::Eq(hn::LoadU(d8, a - 32), hn::LoadU(d8, b - 32));
        BUN_KEEP(back);
        ahead = hn::Eq(hn::LoadU(d8, a), hn::LoadU(d8, b));
        BUN_KEEP(ahead);
    }
    HWY_INLINE uint32_t differingBack() const { return ~static_cast<uint32_t>(hn::BitsFromMask(d8, back)); }
    HWY_INLINE uint32_t equalAhead() const { return std::countr_zero(static_cast<uint32_t>(hn::BitsFromMask(d8, ahead)) + 1); }
#else
    uint64_t differing;
    HWY_INLINE void start(const uint8_t* a, const uint8_t* b)
    {
#if HWY_TARGET_IS_NEON
        const auto bit = hn::BitCast(d8, hn::Set(du64, 0x8040201008040201));
        const auto bits = [&](ptrdiff_t at) BUN_INLINED { return hn::IfThenZeroElse(hn::Eq(hn::LoadU(d8, a + at), hn::LoadU(d8, b + at)), bit).raw; };
        const auto halves = vpaddq_u8(vpaddq_u8(bits(-32), bits(-16)), vpaddq_u8(bits(0), bits(16)));
        differing = vgetq_lane_u64(vreinterpretq_u64_u8(vpaddq_u8(halves, halves)), 0);
#else
        differing = Differing(a - 32, b - 32) | uint64_t { Differing(a, b) } << 32;
#endif
    }
    HWY_INLINE uint32_t differingBack() const { return static_cast<uint32_t>(differing); }
    HWY_INLINE uint32_t equalAhead() const { return __builtin_ctzll(differing >> 32 | uint64_t { 1 } << 32); }
#endif
};

struct Reach {
    const uint8_t* bytes;
    size_t from, history;
};

static HWY_NOINLINE size_t BeforeLongMatch(const Reach& reach, Candidate found)
{
    const ptrdiff_t position = found >> 16, distance = position + maxDistance - found % 0x10000;
    const ptrdiff_t lowest = std::max<ptrdiff_t>(reach.from, origin + distance - reach.history);
    ptrdiff_t start = position - 32;
    for (; start > lowest; start -= 32) {
        if (uint32_t differing = Differing(reach.bytes + start - 32, reach.bytes + start - 32 - distance))
            return start - 1 - LeadingZeros(differing);
    }
    return start - 1;
}

struct Segments {
    static constexpr size_t minLen = 64;
    const Step* from[maxBatch / minLen + cursors + 1];
    const Step* to[maxBatch / minLen + cursors + 1];
    size_t count, left;
    size_t lowest[cursors], index[cursors];
};

// From the end, in several parts at once: takes the candidate in front of the match that starts first so far.
template<bool areAllHashed>
static HWY_NOINLINE void Walk(const Reach& reach, size_t hashed, bool isShort, Scratch& scratch, Segments& segments)
{
    constexpr size_t stepsBetweenChecks = 4;
    const uint8_t* bytes = reach.bytes;
    const Candidate* candidates = scratch.candidates;
    Step* step = scratch.steps;
    size_t at[cursors], busy = cursors;
    const auto take = [&](size_t cursor, size_t len) BUN_INLINED {
        segments.index[cursor] = segments.count;
        segments.from[segments.count++] = step + cursor * stepStride;
        at[cursor] = reach.from + segments.left - 1;
        segments.left -= std::min(segments.left, len);
        segments.lowest[cursor] = reach.from + segments.left;
    };
    const size_t len = hashed - reach.from;
    if (areAllHashed && isShort) {
        constexpr size_t few = 2;
        Step* to[few];
        const auto isBusy = [&](size_t c) BUN_INLINED { return (at[c] >= segments.lowest[c]) & (candidates[at[c]] != noCandidate) & (to[c] != step + (2 * c + 2) * stepStride); };
        const auto advance = [&](size_t c) BUN_INLINED {
            const Candidate found = candidates[at[c]];
            Comparison comparison;
            comparison.start(bytes + (found >> 16), bytes + found % 0x10000 - maxDistance);
            const uint32_t differing = comparison.differingBack();
            at[c] = HWY_UNLIKELY(differing == 0) ? BeforeLongMatch(reach, found) : (found >> 16) - 1 - LeadingZeros(differing);
            *to[c]++ = { found, static_cast<uint16_t>(at[c]), static_cast<uint16_t>(comparison.equalAhead()) };
        };
        segments.count = 0;
        segments.left = len;
        HWY_UNROLL(8)
        for (size_t c = 0; c < few; c++) {
            take(c, c + 1 == few || len < 256 ? len : len * 2 / (2 * few + 1));
            segments.from[c] = to[c] = step + 2 * c * stepStride;
        }
        for (;;) {
            bool areBusy = true;
            HWY_UNROLL(8)
            for (size_t c = 0; c < few; c++)
                areBusy &= isBusy(c);
            if (!areBusy)
                break;
            HWY_UNROLL(8)
            for (size_t c = 0; c < few; c++)
                advance(c);
        }
        HWY_UNROLL(8)
        for (size_t c = 0; c < few; c++) {
            while (isBusy(c))
                advance(c);
            segments.to[c] = to[c];
        }
        return;
    }
    segments.count = 0;
    segments.left = len;
    HWY_UNROLL(8)
    for (size_t c = 0; c < cursors; c++)
        take(c, len * 3 / (4 * cursors) + 1);
    do {
        HWY_UNROLL(1)
        for (size_t i = 0; i < stepsBetweenChecks; i++, step++) {
            // Stage by stage, or the scheduler of the CPU fills up with what has to wait.
            HWY_UNROLL(8)
            for (size_t c = 0; c < cursors && !areAllHashed; c++)
                at[c] = scratch.groups[at[c] / 32].lastBefore + std::popcount(scratch.groups[at[c] / 32].areHashed << ~at[c] % 32);
            HWY_UNROLL(8)
            for (size_t c = 0; c < cursors; c++)
                at[c] = step[c * stepStride].candidate = candidates[at[c]];
            __asm__ volatile("");
            Comparison comparisons[cursors];
            HWY_UNROLL(8)
            for (size_t c = 0; c < cursors; c++) {
                const size_t earlier = at[c] % 0x10000;
                at[c] >>= 16;
                comparisons[c].start(bytes + at[c], bytes + earlier - maxDistance);
                __asm__ volatile("");
            }
            HWY_UNROLL(8)
            for (size_t c = 0; c < cursors; c++) {
                const uint32_t differing = comparisons[c].differingBack();
                step[c * stepStride].equalAhead = comparisons[c].equalAhead();
                if (HWY_UNLIKELY(differing == 0))
                    at[c] = BeforeLongMatch(reach, step[c * stepStride].candidate);
                else
                    at[c] -= 1 + LeadingZeros(differing);
                step[c * stepStride].beforeStart = at[c];
            }
        }
        const bool isFull = step == scratch.steps + maxSteps;
        HWY_UNROLL(8)
        for (size_t c = 0; c < cursors; c++) {
            if (HWY_LIKELY(at[c] >= segments.lowest[c] && !isFull))
                continue;
            segments.to[segments.index[c]] = step + c * stepStride;
            segments.left = std::min(segments.left, std::max(at[c] + 1, reach.from) - reach.from);
            if (segments.left != 0 && !isFull) {
                take(c, std::max(Segments::minLen, segments.left / cursors));
            } else {
                // It goes on with something that is thrown away.
                busy -= segments.index[c] != segments.count;
                segments.index[c] = segments.count;
                segments.lowest[c] = reach.from + len / 8;
                at[c] = hashed - 1;
            }
        }
    } while (busy != 0);
}

// Returns how many matches there are, with the empty one at the end.
static HWY_NOINLINE size_t Merge(const Reach& reach, size_t end, Scratch& scratch, const Segments& segments)
{
    size_t count = 1, unfinished = 0;
    std::fill_n(scratch.beforeStarts, std::size(scratch.beforeStarts), 0x7fff);
    scratch.starts[0] = scratch.ends[0] = end;
    scratch.distances[0] = 0;
    const auto history = hn::Set(du16, std::min<size_t>(reach.history, maxDistance));
    const auto one = hn::Set(du16, 1), from = hn::Set(du16, reach.from);
    const auto startOf = [&](Step step) {
        const ptrdiff_t position = step.candidate >> 16, distance = position + maxDistance - step.candidate % 0x10000;
        return std::max<ptrdiff_t>(step.beforeStart + 1, std::min<ptrdiff_t>(origin + distance - reach.history, position));
    };
    for (size_t segment = 0; segment < segments.count && scratch.starts[count - 1] > reach.from; segment++) {
        const Step *step = segments.from[segment], *stop = segments.to[segment];
        while (step < stop && startOf(*step) >= scratch.starts[count - 1])
            step++;
        while (step + 1 < stop && stop[-2].beforeStart < reach.from)
            stop--;
        if (step < stop && stop[-1].candidate == noCandidate)
            stop--;
        const size_t last = std::min<size_t>(count + (stop - step), maxMatches);
        for (; count < last; count += lanes16, step += lanes16) {
            auto earlier = one, positions = one, starts = one, equal = one;
            hn::LoadInterleaved4(du16, reinterpret_cast<const uint16_t*>(step), earlier, positions, starts, equal);
            const auto distances = hn::Xor(hn::Sub(positions, earlier), hn::Set(du16, maxDistance));
            const auto lowest = hn::Add(hn::SaturatedSub(distances, history), hn::Set(du16, origin));
            equal = hn::IfThenZeroElse(hn::RebindMask(du16, hn::Gt(hn::BitCast(d16, lowest), hn::BitCast(d16, positions))), equal);
            hn::StoreU(hn::Max(hn::Max(hn::Add(starts, one), hn::Min(lowest, positions)), from), du16, scratch.starts + count);
            hn::StoreU(hn::Min(hn::Add(positions, equal), hn::Set(du16, end)), du16, scratch.ends + count);
            const auto lessOne = hn::Sub(distances, one), twice = hn::Add(lessOne, lessOne);
            const auto scaled = hn::Or(twice, hn::SaturatedSub(hn::Set(du16, 3), hn::Or(lessOne, twice)));
            hn::StoreU(hn::ConvertTo(df, hn::PromoteLowerTo(d32, scaled)), df, scratch.distances + count);
            hn::StoreU(hn::ConvertTo(df, hn::PromoteUpperTo(d32, scaled)), df, scratch.distances + count + lanes32);
            uint32_t bits = hn::BitsFromMask(d8, hn::Eq(hn::BitCast(d8, equal), hn::Set(d8, 32)));
            do {
                HWY_UNROLL(2)
                for (size_t i = 0; i < 2; i++) {
                    scratch.unfinished[unfinished] = count + std::countr_zero(bits) / 2;
                    unfinished += bits != 0;
                    bits &= bits - 1;
                }
            } while (bits != 0);
        }
        count = last;
        while (unfinished != 0 && scratch.unfinished[unfinished - 1] >= count)
            unfinished--;
    }

    for (size_t round = 0; round < maxOverrun / 32 && unfinished != 0; round++) {
        size_t kept = 0;
        for (size_t i = 0; i < unfinished; i++) {
            const size_t match = scratch.unfinished[i], at = scratch.ends[match];
            const size_t scaled = static_cast<int32_t>(scratch.distances[match]), distance = scaled / 2 + ~scaled % 2;
            const size_t equal = std::countr_zero(Differing(reach.bytes + at, reach.bytes + at - distance));
            scratch.ends[match] = std::min(at + equal, end);
            scratch.unfinished[kept] = match;
            kept += equal / 32;
        }
        unfinished = kept;
    }
    return count;
}

// Returns the first of the matches that save the most. A literal costs 16 and a match 33 or more, so 3 bytes are left of it.
static HWY_NOINLINE size_t Choose(const Batch& batch, size_t count, size_t end, Scratch& scratch)
{
    constexpr size_t group = 16, kept = 512, byteShift = indexBits + 4;
    constexpr int32_t indexMask = (1 << indexBits) - 1;
    // What is saved is above the index of the match with which it starts.
    struct alignas(64) {
        int32_t behindEnd[group], cost[group], behindStart[group];
        uint16_t endsIn[2 * group];
    } prepared[2];
    // With a match but for its length, then without it.
    alignas(64) int32_t saved[2 * kept];
    for (size_t i = count; i < count + group; i += lanes16) {
        hn::StoreU(hn::Zero(du16), du16, scratch.ends + i);
        hn::StoreU(hn::Set(du16, 1), du16, scratch.starts + i);
    }
    for (size_t i = count; i < count + group; i += lanes32)
        hn::StoreU(hn::Zero(df), df, scratch.distances + i);
    const auto distanceCosts = hn::LoadDup128(d8, batch.distanceCosts);
    const auto shortCosts = hn::LoadDup128(d8, batch.shortCosts), longCosts = hn::LoadDup128(d8, batch.longCosts);
    const auto last = hn::Set(du16, end), fifteen = hn::Set(du16, 15);
    auto indices = hn::Iota(d16, 0);
    auto wideIndices = hn::Iota(d32, 0);
    const auto prepare = [&](size_t first) BUN_INLINED {
        auto& to = prepared[first / group % 2];
        for (size_t i = 0; i < group; i += lanes16) {
            const auto starts = hn::Load(du16, scratch.starts + first + i), ends = hn::Load(du16, scratch.ends + first + i);
            const auto behind = hn::Add(hn::BitCast(d16, ends), hn::Set(d16, 1));
            auto endsIn = indices;
            auto later = reinterpret_cast<const int16_t*>(scratch.starts + first + i);
            for (bool overlaps = true; overlaps; later -= 8) {
                auto isInside = hn::MaskFalse(d16);
                HWY_UNROLL(8)
                for (ptrdiff_t back = 1; back <= 8; back++) {
                    isInside = hn::Gt(behind, hn::LoadU(d16, later - back));
                    endsIn = hn::Add(endsIn, hn::VecFromMask(d16, isInside));
                }
                overlaps = !hn::AllFalse(d16, isInside);
            }
            hn::Store(hn::And(hn::BitCast(du16, endsIn), hn::Set(du16, kept - 1)), du16, to.endsIn + i);
            indices = hn::Add(indices, hn::Set(d16, lanes16));

            const auto lens = hn::SaturatedSub(ends, starts);
            const auto lenCosts = hn::Add(hn::TableLookupBytes(shortCosts, hn::Min(lens, fifteen)), hn::TableLookupBytes(longCosts, hn::Min(hn::ShiftRight<4>(lens), fifteen)));
            const auto behindEnd = hn::Sub(last, ends), behindStart = hn::Sub(last, starts);
            HWY_UNROLL(2)
            for (size_t half = 0; half < 2; half++) {
                const auto widen = [&](auto narrow) BUN_INLINED { return half ? hn::PromoteUpperTo(d32, narrow) : hn::PromoteLowerTo(d32, narrow); };
                const size_t at = i + half * lanes32;
                const auto exponents = hn::ShiftRight<23>(hn::BitCast(du32, hn::Load(df, scratch.distances + first + at)));
                const auto costs = hn::Add(widen(lenCosts), hn::BitCast(d32, hn::TableLookupBytesOr0(distanceCosts, hn::Xor(hn::BitCast(d8, exponents), hn::Set(d8, 0x80)))));
                const auto scaled = hn::ShiftLeft<byteShift>(widen(behindEnd));
                hn::Store(scaled, d32, to.behindEnd + at);
                hn::Store(hn::Sub(hn::Add(scaled, hn::ShiftLeft<indexBits>(costs)), wideIndices), d32, to.cost + at);
                hn::Store(hn::ShiftLeft<byteShift>(widen(behindStart)), d32, to.behindStart + at);
                hn::Store(hn::Set(d32, INT32_MIN), d32, saved + first % kept + at);
                wideIndices = hn::Add(wideIndices, hn::Set(d32, lanes32));
            }
        }
    };

    prepare(0);
    int32_t best = 0;
    for (size_t first = 0; first < count; first += group) {
        if (first + group < count)
            prepare(first + group);
        const auto& from = prepared[first / group % 2];
        int32_t* lessLen = saved + first % kept;
        uint16_t* next = scratch.next + first;
        HWY_UNROLL(16)
        for (size_t i = 0; i < group; i++) {
            lessLen[kept + i] = best;
            const size_t other = from.endsIn[i];
            const int32_t behind = Larger(saved[other] + from.behindEnd[i], saved[kept + other]);
            next[i] = behind;
            lessLen[i] = (behind & ~indexMask) - from.cost[i];
            best = Larger(best, lessLen[i] + from.behindStart[i]);
        }
    }
    return best & indexMask;
}

static HWY_INLINE float Scaled(int32_t distance) { return Larger(2 * distance - 2, 5 - 2 * distance); }
static HWY_INLINE uint32_t Unscaled(uint32_t scaled) { return scaled / 2 + ~scaled % 2; }

static HWY_NOINLINE void Link(const Batch& batch, const Candidate* found)
{
    const hn::Rebind<uint16_t, decltype(du32)> narrow;
    for (size_t at = 0, len = batch.hashTo - batch.hashFrom; at < len;) {
        const size_t slot = (batch.stamp + batch.hashFrom + at) & batch.linkMask;
        uint16_t* to = batch.links + slot;
        auto here = Candidates(origin + at, 0);
        const size_t stop = std::min(len, at + batch.linkMask + 1 - slot);
        for (; at < stop; at += lanes32, to += lanes32) {
            hn::StoreU(hn::DemoteTo(narrow, hn::BitCast(d32, hn::Sub(here, hn::LoadU(du32, found + origin + at)))), narrow, to);
            here = hn::Add(here, hn::Set(du32, lanes32 * 0x10001));
        }
        at = stop;
    }
}

// Looks for longer matches among the earlier copies of the bytes where one ends, as long as that pays. Returns whether it has.
static HWY_NOINLINE bool Extend(const Batch& batch, const Reach& reach, size_t match, size_t spare, size_t gramLen, int32_t least, Scratch& scratch)
{
    const size_t hashed = origin + batch.hashTo - batch.hashFrom, last = origin + batch.end - batch.hashFrom;
    const uint32_t stamp = batch.stamp + batch.hashFrom - origin;
    const size_t linked = std::min(batch.hashTo - batch.linkedFrom, batch.linkMask - 8);
    const auto bitsOf = [](float scaled) { return static_cast<int32_t>(std::bit_cast<uint32_t>(scaled) >> 23) - 127 + 14; };
    // In steps.
    const ptrdiff_t full = (batch.to - batch.from) * batch.depth / 32;
    // In bits for each try.
    const int32_t need = batch.depth == 1 ? 3 : 1;
    ptrdiff_t patience = full, credit = need * (batch.didLinksPay ? 256 : 40);
    size_t total = 0;
    for (size_t at = reach.from, next; patience > 0 && credit > 0 && match != 0 && (next = scratch.next[match] % (1 << indexBits));) {
        const size_t first = std::max<size_t>(scratch.starts[match], at), end = scratch.ends[match];
        const size_t start = end - static_cast<uint32_t>(end - first) % maxMatch;
        size_t anchor = std::max(start, end + 1 - gramLen);
        const size_t longest = std::min(last, start + maxMatch), farthest = std::min<size_t>(batch.window, reach.history + start - origin);
        int32_t saved = 0;
        patience -= 2;
        credit -= need;
        if (anchor < hashed && start != end && spare < maxMatches) {
            const uint32_t needed = ~0u << (32 - std::min<size_t>(32, end + 1 - start));
            size_t distance = batch.links[(stamp + anchor) & batch.linkMask];
            // The end of a run tells more.
            if (distance <= 4)
                anchor = std::clamp(EndOfMatch(reach.bytes, anchor, longest, distance) + 1 - gramLen, anchor, hashed - 1);
            distance = 0;
            for (size_t steps = 8 * batch.depth; steps != 0 && distance + hashed - anchor <= linked; steps--, patience--) {
                distance += batch.links[(stamp + anchor - distance) & batch.linkMask];
                if (distance - 1 >= farthest)
                    break;
                if (Differing(reach.bytes + end - 31, reach.bytes + end - 31 - distance) & needed)
                    continue;
                const size_t stop = std::min(longest, EndOfMatch(reach.bytes, start, longest, distance));
                if (stop < std::max(end + 1, start + 4))
                    continue;
                size_t other = next, covered = end;
                saved = bitsOf(scratch.distances[match]) - bitsOf(Scaled(distance));
                for (; other != 0 && covered < stop; other = scratch.next[other] % (1 << indexBits)) {
                    const size_t from = std::clamp<size_t>(scratch.starts[other], covered, stop), to = scratch.ends[other];
                    const int32_t cost = bitsOf(scratch.distances[other]);
                    saved += 6 * (from - covered);
                    if (to >= stop + 4 || from == stop) {
                        saved += cost * static_cast<uint32_t>(stop - from) / static_cast<uint32_t>(std::min(to - from, maxMatch));
                        break;
                    }
                    saved += cost - 8 * static_cast<int32_t>(std::max(to, stop) - stop);
                    covered = to;
                }
                if (saved > least) {
                    if (start != first) {
                        scratch.ends[match] = scratch.starts[spare] = at = start;
                        match = scratch.next[match] = spare++;
                    }
                    scratch.ends[match] = stop;
                    scratch.distances[match] = Scaled(distance);
                    scratch.next[match] = other;
                    break;
                }
            }
        }
        if (saved > least) {
            total += saved;
            credit = std::min<ptrdiff_t>(credit + saved, need * 256);
            patience = std::min(patience + 3 * saved * batch.depth, full);
        } else {
            patience = std::min<ptrdiff_t>(patience + (std::max<size_t>(end - first, 8) - 8) * batch.depth / 4, full);
            match = next;
            at = end;
        }
    }
    return 32 * total * batch.depth * batch.depth > batch.to - batch.from && patience > 0 && credit > 0;
}

// Hashes only what is between matches, and takes what it finds. Returns the first.
template<bool isLong> static HWY_NOINLINE size_t TakeFirst(const Batch& batch, Reach reach, size_t hashed, size_t end, Scratch& scratch)
{
    const Table table = batch.tables[0];
    const uint32_t used = isLong ? (uint64_t { 1 } << 8 * (std::min(table.gramLen, 8u) - 4)) - 1 : 0, stamp = batch.stamp + batch.hashFrom - origin;
    const size_t window = batch.window;
    const auto put = [&](size_t at) BUN_INLINED {
        uint32_t halves[2];
        memcpy(halves, reach.bytes + at, 8);
        const uint32_t gram = halves[0] + (halves[1] & used) * odd, entry = stamp + at + (gram & tagMask);
        return entry - std::exchange(table.entries[__builtin_bswap32(gram * odd) & table.mask], entry);
    };
    for (size_t at = origin; at < reach.from; at++)
        put(at);
    size_t count = 0;
    for (size_t at = reach.from; at < hashed; at++) {
        const size_t distance = put(at);
        const size_t history = reach.history + at - origin;
        if (distance - 1 >= std::min(window, history))
            continue;
        const size_t stop = EndOfMatch(reach.bytes, at, end, distance);
        if (HWY_UNLIKELY(std::min(stop, end) < at + 4))
            continue;
        scratch.next[count] = count + 1;
        count++;
        scratch.starts[count] = at - std::min(history - distance, LeadingZeros(Differing(reach.bytes + at - 32, reach.bytes + at - 32 - distance) | 1));
        scratch.ends[count] = std::min(stop, end);
        scratch.distances[count] = Scaled(distance);
        if (HWY_UNLIKELY(stop > at + 64) && distance >= 64) {
            for (at += 32; at + 1 < std::min(stop, hashed); at += 32)
                put(at);
        }
        at = stop - 1;
        put(std::min(at, hashed - 1));
    }
    scratch.next[count] = 0;
    return count != 0;
}

// Two to a token. Writes up to 8 tokens too many.
static HWY_INLINE uint32_t* PutLiterals(const uint8_t* bytes, size_t len, uint32_t* tokens)
{
    alignas(64) static constexpr uint16_t none[32] = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 511 };
    const hn::Rebind<uint8_t, decltype(du16)> narrow;
    const auto put = [&](auto pairs) BUN_INLINED { hn::StoreU(hn::BitCast(du32, hn::OddEven(hn::ShiftLeft<7>(pairs), pairs)), du32, tokens); };
    for (; HWY_UNLIKELY(len > lanes16); len -= lanes16, bytes += lanes16, tokens += lanes32)
        put(hn::PromoteTo(du16, hn::LoadU(narrow, bytes)));
    put(hn::Or(hn::PromoteTo(du16, hn::LoadU(narrow, bytes)), hn::LoadU(du16, none + 16 - len)));
    return tokens + (len + 1) / 2;
}

// A distance up to 32 that serves as well as `distance`, or that.
static HWY_INLINE size_t ShortPeriod(const uint8_t* bytes, size_t at, size_t len, size_t distance)
{
    uint32_t alike = 0;
    for (size_t i = 0; i < 32; i += hn::MaxLanes(d8)) {
        const auto isEqual = [&](size_t ahead) BUN_INLINED { return hn::Eq(hn::LoadU(d8, bytes + at + ahead + i - 32), hn::Set(d8, bytes[at + ahead])); };
        alike |= hn::BitsFromMask(d8, hn::And(hn::And(isEqual(0), isEqual(len / 3)), hn::And(isEqual(len / 2), isEqual(len - 1)))) << i;
    }
    for (size_t tries = 0; tries < 3 && alike != 0; tries++) {
        const size_t period = 1 + LeadingZeros(alike);
        if (period < distance && EndOfMatch(bytes, at, at + len, period) >= at + len)
            return period;
        alike ^= 1u << (32 - period);
    }
    return distance;
}

// Leaves where they end in `beforeStarts`.
static HWY_NOINLINE uint32_t* PutPieces(const Reach& reach, size_t start, size_t at, uint32_t distance, size_t match, size_t cutAt, bool isHasty, Scratch& scratch, uint32_t* tokens, Parsed& parsed)
{
    size_t len = at - start;
    const uint32_t far = Unscaled(std::bit_cast<float>(distance));
    const size_t whole = at - len % maxMatch, next = match ? Unscaled(scratch.distances[match]) : 0;
    if (at == cutAt)
        parsed.runDistance = far;
    // The next match may cover the rest.
    if (at == cutAt || (match != 0 && scratch.starts[match] <= at && next <= reach.history + whole - origin && EndOfMatch(reach.bytes, whole, at, next) >= at)) {
        scratch.starts[match] = at = whole;
        len = at - start;
    }
    for (size_t piece; len != 0; len -= piece) {
        piece = len <= maxMatch ? len : len < maxMatch + 3 ? maxMatch - 3
                                                           : maxMatch;
        const uint32_t period = far > 4 ? ShortPeriod(reach.bytes, at - len, piece, far) : far;
        *tokens++ = 2 * std::bit_cast<uint32_t>(Scaled(period)) + 253 + piece;
        parsed.runDistance = period == far || len == piece || isHasty ? parsed.runDistance : 0;
    }
    scratch.beforeStarts[0] = at;
    return tokens;
}

static HWY_NOINLINE void PutTokens(const Reach& reach, size_t match, size_t to, size_t cutAt, bool isHasty, Scratch& scratch, uint32_t* tokens, Parsed& parsed)
{
    const uint32_t* first = tokens;
    size_t at = reach.from;
    while (match != 0) {
        const size_t start = std::max<size_t>(scratch.starts[match], at);
        const uint32_t distance = std::bit_cast<uint32_t>(scratch.distances[match]);
        tokens = PutLiterals(reach.bytes + at, start - at, tokens);
        at = scratch.ends[match];
        match = scratch.next[match] % (1 << indexBits);
        size_t len = at - start;
        if (HWY_UNLIKELY(len >= maxMatch)) {
            tokens = PutPieces(reach, start, at, distance, match, cutAt, isHasty, scratch, tokens, parsed);
            at = scratch.beforeStarts[0];
            continue;
        }
        *tokens++ = 2 * distance + 253 + len;
    }
    if (at < to)
        tokens = PutLiterals(reach.bytes + at, to - at, tokens);
    parsed.tokens = tokens - first;
    parsed.position += std::max(at, to) - reach.from;
}

size_t EndOfRun(const uint8_t* bytes, size_t at, size_t end, size_t distance) { return std::min(end, EndOfMatch(bytes, at, end, distance)); }

void Count(const uint32_t* tokens, size_t count, uint16_t* HWY_RESTRICT frequencies)
{
    constexpr size_t len = 1024 + 64;
    alignas(64) uint16_t counts[2 * len];
    // So that an addition waits less often for the one before it.
    uint16_t* others = count < 1024 ? counts : counts + len;
    std::fill(counts, others + len, 0);
    const auto add = [](uint16_t* to, uint32_t token) {
        to[token % 512]++;
        to[512 + 32 + (token >> 23)]++;
    };
    HWY_UNROLL(2)
    for (size_t i = 1; i < count; i += 2) {
        add(counts, tokens[i - 1]);
        add(others, tokens[i]);
    }
    if (count % 2)
        add(counts, tokens[count - 1]);
    for (size_t i = 0; i < 512 + 32 + 288 && others != counts; i += lanes16)
        hn::Store(hn::Add(hn::Load(du16, counts + i), hn::Load(du16, others + i)), du16, counts + i);
    const uint16_t* second = counts + 512 + 32;
    for (size_t i = 0; i < 256; i++)
        frequencies[i] = counts[i] + second[i];
    for (size_t i = 0; i < 32; i++)
        frequencies[288 + i] = second[256 + i];
    std::swap(frequencies[288], frequencies[289]);
    // Each time that the lengths are halved, four more symbols are complete.
    uint16_t* lengths = counts + 256;
    frequencies[256] = frequencies[286] = frequencies[287] = 0;
    frequencies[285] = std::exchange(lengths[255], 0);
    for (size_t i = 0; i < 8; i++)
        frequencies[257 + i] = lengths[i];
    HWY_UNROLL(5)
    for (size_t extraBits = 1; extraBits <= 5; extraBits++) {
        for (size_t i = 0; i < std::max<size_t>(256 >> extraBits, lanes16); i += lanes16) {
            const auto a = hn::Load(du16, lengths + 2 * i), b = hn::Load(du16, lengths + 2 * i + lanes16);
            hn::Store(hn::Add(hn::ConcatEven(du16, b, a), hn::ConcatOdd(du16, b, a)), du16, lengths + i);
        }
        for (size_t i = 4; i < 8; i++)
            frequencies[257 + 4 * extraBits + i] = lengths[i];
    }
}

// In 256ths. The bits of a float are nearly it.
static HWY_INLINE hn::Vec<decltype(d32)> Log2(hn::Vec<decltype(d32)> values)
{
    alignas(16) static constexpr uint8_t missing[16] = { 3, 9, 14, 17, 20, 21, 22, 22, 21, 20, 18, 16, 13, 10, 6, 2 };
    const auto bits = hn::ShiftRight<15>(hn::BitCast(d32, hn::ConvertTo(df, values)));
    const auto top = hn::OrAnd(hn::Set(d32, 0x80808000), hn::ShiftRight<4>(bits), hn::Set(d32, 15));
    return hn::Add(hn::Sub(bits, hn::Set(d32, 127 << 8)), hn::BitCast(d32, hn::TableLookupBytesOr0(hn::LoadDup128(d8, missing), hn::BitCast(d8, top))));
}

static HWY_INLINE hn::Vec<decltype(d16)> Log2(hn::Vec<decltype(d16)> values)
{
    const auto even = hn::And(hn::BitCast(d32, values), hn::Set(d32, 0xffff)), odd = hn::ShiftRight<16>(hn::BitCast(d32, values));
    return hn::OddEven(hn::BitCast(d16, hn::ShiftLeft<16>(Log2(odd))), hn::BitCast(d16, Log2(even)));
}

// Keeps the first candidate for each match, unless the table with longer grams has it.
static HWY_NOINLINE void Sift(size_t from, size_t to, const Candidate* found, const Candidate* longer, Candidate* news, uint16_t* first)
{
    size_t count = *first = 0;
    for (size_t at = from; at < to; *++first = count) {
        HWY_UNROLL(2)
        for (const size_t stop = at + atOnce; at != stop; at += lanes32) {
            const auto here = hn::LoadU(du32, found + at), before = hn::Add(hn::LoadU(du32, found + at - 1), hn::Set(du32, 0x10001));
            const auto areKnown = hn::Or(hn::Or(hn::Eq(here, hn::Zero(du32)), hn::Eq(here, before)), hn::Eq(here, hn::LoadU(du32, longer + at)));
            const size_t bits = hn::BitsFromMask(du32, areKnown) ^ ((1 << lanes32) - 1);
            hn::StoreU(hn::TableLookupLanes(here, hn::IndicesFromVec(du32, hn::PromoteTo(du32, hn::Load(hn::Rebind<uint8_t, decltype(du32)>(), setBits.indices[bits])))), du32, news + count);
            count += std::popcount(bits);
        }
    }
}

// Notes where the matches start that have been found from `from` on, which is less than `lag` in front.
static HWY_NOINLINE void Note(const Reach& reach, size_t from, size_t end, size_t tables, Ladder& ladder)
{
    const hn::Full128<uint8_t> sixteen;
    for (size_t at = from; at < from + atOnce; at++) {
        hn::Store(hn::Set(sixteen, ladder.ending[at] % 32), sixteen, ladder.symbols[at]);
        for (size_t rung = 0; rung < rungs; rung += lanes16)
            hn::Store(hn::Set(du16, ladder.ending[at] >> 5), du16, ladder.distances[at] + rung);
    }
    constexpr size_t room = maxTables * atOnce + 16;
    struct alignas(64) {
        Candidate found[room];
        uint32_t equal[room], starts[room], distances[room], symbols[room];
        uint16_t longer[room];
    } news;
    size_t count = 0, longer = 0;
    for (size_t table = 0; table < tables; table++) {
        const uint16_t* first = ladder.firstNews[table] + (from - reach.from) / atOnce;
        for (size_t i = first[0]; i < first[1]; i += lanes32)
            hn::StoreU(hn::LoadU(du32, ladder.news[table] + i), du32, news.found + count + i - first[0]);
        count += first[1] - first[0];
    }
    HWY_UNROLL(2)
    for (size_t i = 0; i < count; i++) {
        Comparison comparison;
        comparison.start(reach.bytes + (news.found[i] >> 16), reach.bytes + news.found[i] % 0x10000 - maxDistance);
        news.starts[i] = LeadingZeros(comparison.differingBack() | 1);
        news.equal[i] = comparison.equalAhead();
    }
    for (uint32_t* rest : { news.found, news.starts, news.equal })
        hn::StoreU(hn::Zero(du32), du32, rest + count);
    const hn::Full128<uint16_t> eight;
    for (size_t i = 0; i < count; i += lanes32) {
        const auto load = [&](const uint32_t* values) BUN_INLINED { return hn::BitCast(d32, hn::Load(du32, values + i)); };
        const auto store = [&](auto values, uint32_t* to) BUN_INLINED { hn::Store(hn::BitCast(du32, values), du32, to + i); };
        const auto at = hn::ShiftRight<16>(load(news.found)), earlier = hn::And(load(news.found), hn::Set(d32, 0xffff));
        const auto distances = hn::Sub(hn::Add(at, hn::Set(d32, maxDistance)), earlier), twice = hn::Add(distances, distances);
        const auto before = hn::Add(earlier, hn::Set(d32, reach.history - origin - maxDistance));
        const auto starts = hn::Max(hn::Sub(at, hn::Min(load(news.starts), hn::Max(before, hn::Zero(d32)))), hn::Set(d32, reach.from));
        const auto lens = hn::IfThenZeroElse(hn::Lt(before, hn::Zero(d32)), hn::Sub(hn::Min(hn::Add(at, load(news.equal)), hn::Set(d32, end)), starts));
        const auto scaled = hn::ConvertTo(df, hn::Max(hn::Sub(twice, hn::Set(d32, 2)), hn::Sub(hn::Set(d32, 5), twice)));
        const auto symbols = hn::And(hn::ShiftRight<22>(hn::BitCast(d32, scaled)), hn::Set(d32, 31)), pairs = hn::Or(symbols, hn::ShiftLeft<8>(symbols));
        store(hn::Or(hn::ShiftLeft<16>(hn::Sub(hn::Set(d32, topRung), hn::Clamp(lens, hn::Set(d32, 2), hn::Set(d32, topRung)))), starts), news.starts);
        store(hn::Add(starts, lens), news.equal);
        store(hn::Or(distances, hn::ShiftLeft<16>(distances)), news.distances);
        store(hn::Or(pairs, hn::ShiftLeft<16>(pairs)), news.symbols);
        const size_t bits = hn::BitsFromMask(d32, hn::Gt(lens, hn::Set(d32, topRung)));
        hn::StoreU(hn::Add(hn::Set(eight, i), hn::PromoteTo(eight, hn::Load(hn::Full64<uint8_t>(), setBits.indices[bits]))), eight, news.longer + longer);
        longer += std::popcount(bits);
    }
    alignas(64) static constexpr uint64_t tooLong[8] = { 0, 0, 0, 0, ~0ull, ~0ull, ~0ull, ~0ull };
    const auto note = [&](size_t i, size_t at, size_t missing) BUN_INLINED {
        const auto symbols = hn::Or(hn::BitCast(sixteen, hn::Set(hn::Full128<uint32_t>(), news.symbols[i])), hn::LoadU(sixteen, reinterpret_cast<const uint8_t*>(tooLong) + rungs + missing));
        hn::Store(hn::Min(symbols, hn::Load(sixteen, ladder.symbols[at])), sixteen, ladder.symbols[at]);
        for (size_t rung = 0; rung < rungs; rung += lanes16) {
            const auto distances = hn::Or(hn::BitCast(du16, hn::Set(du32, news.distances[i])), hn::LoadU(du16, reinterpret_cast<const uint16_t*>(tooLong) + missing + rung));
            hn::Store(hn::Min(distances, hn::Load(du16, ladder.distances[at] + rung)), du16, ladder.distances[at] + rung);
        }
    };
    HWY_UNROLL(2)
    for (size_t i = 0; i < count; i++)
        note(i, news.starts[i] % 0x10000, news.starts[i] >> 16);
    const uint64_t known = ladder.longest[std::max(from - 1, lag) - lag];
    while (longer != 0) {
        const size_t i = news.longer[--longer], distance = news.distances[i] >> 16;
        size_t start = news.starts[i];
        for (size_t more = 31; more == 31 && start + lag >= from + 32; start -= more)
            more = std::min({ LeadingZeros(Differing(reach.bytes + start - 32, reach.bytes + start - 32 - distance) | 1), start - reach.from, reach.history + start - origin - distance });
        note(i, start, 0);
        const uint32_t both = distance << 5 | news.symbols[i] % 32;
        const size_t equal = std::max<size_t>(news.equal[i], both == static_cast<uint32_t>(~known) ? known >> 32 : 0);
        const size_t stop = std::min(end, EndOfMatch(reach.bytes, equal, end, distance));
        ladder.longest[start] = std::max(ladder.longest[start], uint64_t { stop } << 32 | ~both);
        // A longer one from further back may hide it until there.
        ladder.ending[stop - topRung] = std::min(ladder.ending[stop - topRung], both);
        note(i, std::min(stop - topRung, from + atOnce - 1), 0);
    }
}

// The rest of a match is a match.
static HWY_NOINLINE void Spread(size_t from, size_t to, Ladder& ladder)
{
    const hn::Full128<uint8_t> sixteen;
    const hn::Full128<uint16_t> eight;
    auto symbols = hn::Load(sixteen, ladder.symbols[from - 1]);
    auto low = hn::Load(eight, ladder.distances[from - 1]), high = hn::Load(eight, ladder.distances[from - 1] + 8);
    uint64_t longest = ladder.longest[from - 1];
    for (size_t at = from; at < to; at++) {
        ladder.longest[at] = longest = std::max(longest, ladder.longest[at]);
        const uint32_t both = __builtin_unpredictable(longest < (at + topRung) << 32) ? ~0u : ~longest;
        const auto top = hn::InsertLane(hn::Zero(hn::Full128<uint32_t>()), 0, both);
        symbols = hn::Min(hn::CombineShiftRightBytes<1>(sixteen, hn::And(hn::BitCast(sixteen, top), hn::Set(sixteen, 31)), symbols), hn::Load(sixteen, ladder.symbols[at]));
        low = hn::Min(hn::CombineShiftRightLanes<1>(eight, high, low), hn::Load(eight, ladder.distances[at]));
        high = hn::Min(hn::CombineShiftRightLanes<1>(eight, hn::BitCast(eight, hn::ShiftRight<5>(top)), high), hn::Load(eight, ladder.distances[at] + 8));
        hn::Store(symbols, sixteen, ladder.symbols[at]);
        hn::Store(low, eight, ladder.distances[at]);
        hn::Store(high, eight, ladder.distances[at] + 8);
    }
}

// In eighths of a bit.
constexpr uint16_t maxPrice = 13 * 8;
struct alignas(32) Prices {
    uint16_t symbols[320];
    // In 128ths, of what follows the batch.
    uint16_t perByte;
};

static HWY_NOINLINE uint32_t MakeCode(const uint16_t* frequencies, size_t count, size_t maxLen, Code& code);

static HWY_NOINLINE void SetPrices(const uint16_t* known, const uint16_t* latest, Prices& prices)
{
    for (auto [from, to] : { std::pair { 0, 288 }, std::pair { 288, 320 } }) {
        uint32_t total = 0;
        for (int i = from; i < to; i++)
            total += prices.symbols[i] = std::min(known[i] / 2 + latest[i], 0x3fff) * 2 + 1;
        const auto all = hn::DupEven(hn::BitCast(d16, Log2(hn::Set(d32, total))));
        for (int i = from; i < to; i += lanes16) {
            const auto bits = hn::ShiftRight<5>(hn::Sub(all, Log2(hn::BitCast(d16, hn::Load(du16, prices.symbols + i)))));
            hn::Store(hn::BitCast(du16, hn::Clamp(bits, hn::Set(d16, 8), hn::Set(d16, maxPrice))), du16, prices.symbols + i);
        }
    }
    // It matters how short codewords are rounded.
    Code code;
    uint16_t both[288] = {};
    for (size_t i = 0; i < 286; i++)
        both[i] = std::min((known[i] + 1) / 2 + latest[i], 0x7fff);
    both[256] = 1;
    MakeCode(both, 288, 14, code);
    for (size_t i = 0; i < code.used; i++) {
        uint16_t& price = prices.symbols[code.symbols[i]];
        price = code.lens[i] <= 5 ? 6 * code.lens[i] + price / 4 : price;
    }
    // Or what has been out of reach is never tried.
    for (size_t i = 288 + 20; i < 320; i++)
        prices.symbols[i] = std::min<uint16_t>(prices.symbols[i], prices.symbols[i - 2] + 4);
}

static HWY_NOINLINE void FindPath(const uint8_t* bytes, size_t from, size_t to, size_t end, Prices& prices, Ladder& ladder)
{
    // Costs are above the number of a lane. In 16 bits, they count from `base`.
    constexpr uint32_t shift = 4, margin = 640 << shift, group = 8;
    alignas(32) uint32_t lengths[256];
    alignas(32) uint16_t literals[256], shortLengths[rungs];
    alignas(32) uint8_t distances[32];
    for (uint32_t i = 0; i < 256; i++) {
        const uint32_t extraBits = 29 - __builtin_clz(i | 4);
        lengths[i] = (prices.symbols[257 + 4 * extraBits + (i >> extraBits)] + 8 * extraBits) << shift | ~i % 8;
        literals[i] = prices.symbols[i] << shift;
    }
    lengths[255] = prices.symbols[285] << shift;
    for (uint32_t i = 0; i < rungs; i++)
        shortLengths[i] = (lengths[i] & ~15) | i;
    for (int i = 0; i < 32; i++)
        distances[i ^ (i < 2)] = prices.symbols[288 + i] + 8 * std::max(i / 2 - 1, 0);
    distances[noSymbol] = 0;

    const hn::Full128<uint16_t> eight;
    const auto lowLengths = hn::LoadDup128(du16, shortLengths), highLengths = hn::LoadDup128(du16, shortLengths + 8);
    const auto nearDistances = hn::LoadDup128(d8, distances), farDistances = hn::LoadDup128(d8, distances + 16);
    for (size_t at = end + topRung, sum = margin; at >= to; at--, sum += prices.perByte) {
        ladder.costs[at] = sum & ~15;
        Fence(&ladder);
    }
    uint32_t base = ladder.costs[to + topRung] - margin;
    uint16_t relative[topRung];
    for (size_t i = 0; i < topRung; i++)
        relative[i] = ladder.costs[to + i] - base;
    auto low = hn::LoadU(eight, relative + 2), high = hn::LoadU(eight, relative + 10);
    int32_t cost = relative[0], later = relative[1];
    alignas(32) uint16_t matches[2][2][group][8];
    const auto prepare = [&](size_t at) BUN_INLINED {
        for (size_t i = 0; i < group; i += lanes16 / 8) {
            const auto symbols = hn::LoadU(d8, ladder.symbols[at - group + i]);
            const auto some = hn::Or(hn::TableLookupBytesOr0(nearDistances, hn::Add(symbols, hn::Set(d8, HWY_ARCH_X86 ? 0x70 : 0))), hn::TableLookupBytesOr0(farDistances, hn::Sub(symbols, hn::Set(d8, 16))));
            const auto none = hn::VecFromMask(d8, hn::Eq(symbols, hn::Set(d8, noSymbol)));
            hn::Store(hn::Add(lowLengths, hn::ShiftLeft<shift>(hn::BitCast(du16, hn::InterleaveLower(d8, some, none)))), du16, matches[at / group % 2][0][i]);
            hn::Store(hn::Add(highLengths, hn::ShiftLeft<shift>(hn::BitCast(du16, hn::InterleaveUpper(d8, some, none)))), du16, matches[at / group % 2][1][i]);
        }
    };
    prepare(to);
    ladder.lens[to] = 0;
    // Up to 7 too far.
    for (size_t at = to; at > from;) {
        const auto& prepared = matches[at / group % 2];
        // Far from the end of a match, nothing else is tried.
        const bool isInside = ladder.longest[at - group] == ladder.longest[at] && ladder.lens[at] >= 24;
        if (!isInside || ladder.longest[at - 2 * group] != ladder.longest[at])
            prepare(at - group);
        if (isInside) {
            const size_t len = ladder.lens[at], stop = ladder.longest[at] >> 32;
            const uint32_t distance = distances[~ladder.longest[at] % 32] << shift;
            for (size_t i = 1; i <= group; i++) {
                const size_t longer = stop - at + i >= maxMatch ? maxMatch : len + i;
                ladder.lens[at - i] = longer;
                ladder.costs[at - i] = ladder.costs[at - i + longer] + (lengths[longer - 3] & ~15) + distance;
                relative[group - i] = ladder.costs[at - i] - base;
            }
            relative[group] = cost;
            relative[group + 1] = later;
            high = low;
            low = hn::LoadU(eight, relative + 2);
            at -= group;
            cost = ladder.costs[at] - base;
            later = ladder.costs[at + 1] - base;
        }
        HWY_UNROLL(8)
        for (size_t i = group; i-- > 0 && !isInside;) {
            at--;
            const int32_t least = hn::ReduceMin(eight, hn::Min(hn::SaturatedAdd(low, hn::Load(eight, prepared[0][i])), hn::SaturatedAdd(high, hn::Load(eight, prepared[1][i]))));
            int32_t withMatch = least & ~15, len = least % 16 + 3;
            if (const uint64_t longest = ladder.longest[at]; longest >= (at + topRung + 1) << 32) {
                // The lanes are for the 8 longest.
                const size_t first = std::min<size_t>((longest >> 32) - at, maxMatch) - 7;
                auto sums = hn::Set(du32, UINT32_MAX);
                for (size_t lane = 0; lane < 8; lane += lanes32)
                    sums = hn::Min(sums, hn::Add(hn::LoadU(du32, ladder.costs + at + first + lane), hn::LoadU(du32, lengths + first - 3 + lane)));
                const uint32_t sum = hn::ReduceMin(du32, sums);
                const int32_t withLong = (sum & ~15) + (distances[~longest % 32] << shift) - base;
                len = withLong < withMatch ? first + (2 - sum - first) % 8 : len;
                withMatch = std::min(withMatch, withLong);
            }
            high = hn::CombineShiftRightLanes<7>(eight, high, low);
            low = hn::InsertLane(hn::ShiftLeftLanes<1>(eight, low), 0, static_cast<uint16_t>(later));
            later = cost;
            cost += literals[bytes[at]];
            ladder.lens[at] = __builtin_unpredictable(cost <= withMatch) ? 1 : len;
            cost = __builtin_unpredictable(cost <= withMatch) ? cost : withMatch;
            ladder.costs[at] = base + cost;
        }
        const int32_t excess = ladder.costs[at + topRung] - margin - base;
        low = hn::Sub(low, hn::Set(eight, excess));
        high = hn::Sub(high, hn::Set(eight, excess));
        base += excess;
        cost -= excess;
        later -= excess;
    }
    prices.perByte = (ladder.costs[from] - std::min(ladder.costs[from], ladder.costs[to])) / (to - from);
}

// Returns the first match.
static HWY_NOINLINE size_t FollowPath(size_t at, size_t to, const Ladder& ladder, Scratch& scratch)
{
    size_t count = 1;
    while (at < to) {
        size_t len = ladder.lens[at];
        const uint32_t distance = len > topRung ? static_cast<uint32_t>(~ladder.longest[at]) >> 5 : ladder.distances[at][(len - 3) % rungs];
        // Costs that are far apart do not fit in 16 bits.
        if (HWY_UNLIKELY((len > 1) & (distance > maxDistance))) {
            Fence(&ladder);
            len = 1;
        }
        scratch.next[count - 1] = count;
        scratch.starts[count] = at;
        scratch.ends[count] = at += len;
        scratch.distances[count] = Scaled(distance);
        count += len > 1;
    }
    scratch.next[count - 1] = 0;
    return count > 1;
}

static HWY_NOINLINE void ParseThoroughly(const Batch& batch, const Reach& reach, Scratch& scratch, uint32_t* tokens, Parsed& parsed)
{
    Ladder& ladder = *batch.ladder;
    const size_t hashed = origin + batch.hashTo - batch.hashFrom, to = origin + batch.to - batch.hashFrom, end = origin + batch.end - batch.hashFrom;
    memset(ladder.distances, 0xff, reach.from * sizeof *ladder.distances);
    memset(ladder.symbols, noSymbol, reach.from * sizeof *ladder.symbols);
    std::fill_n(ladder.longest, end + atOnce, 0);
    std::fill_n(ladder.ending, end + atOnce, UINT32_MAX);
    Candidate *found = scratch.candidates, *longer = ladder.longer;
    std::fill_n(longer, hashed + atOnce, 0);
    for (size_t i = 0; i < batch.tableCount; i++, std::swap(found, longer)) {
        Hash<true, true, false>(batch, batch.tables[i], Fold(batch, batch.tables[i].gramLen, scratch), found);
        if (batch.links && i + 2 == batch.tableCount)
            Link(batch, found);
        found[reach.from - 1] = 0;
        std::fill_n(found + hashed, atOnce, 0);
        Sift(reach.from, hashed, found, longer, ladder.news[i], ladder.firstNews[i]);
    }
    for (size_t at = reach.from; at < to; at += atOnce) {
        Note(reach, at, end, at < hashed ? batch.tableCount : 0, ladder);
        Spread(std::max(at, reach.from + lag) - lag, at + atOnce < to ? at + atOnce - lag : to, ladder);
    }

    const size_t len = to - reach.from;
    const uint16_t none[320] = {};
    uint16_t latest[320] = {};
    const auto sum = [&](auto price) BUN_INLINED {
        size_t sum = 0;
        for (size_t i = 0; i < 320; i++) {
            sum += latest[i] * price(i);
            Fence(latest);
        }
        return sum;
    };
    for (size_t at = reach.from; at < to; at++)
        latest[reach.bytes[at]]++;
    Prices guessed;
    SetPrices(none, latest, guessed);
    const size_t asLiterals = 16 * sum([&](size_t i) { return guessed.symbols[i]; }) / len;
    for (size_t i = 0; i < 256; i++)
        guessed.symbols[i] = std::min<size_t>(guessed.symbols[i] / 2 + asLiterals / 32 + 8, maxPrice);
    std::fill_n(guessed.symbols + 256, 32, 44);
    guessed.perByte = *batch.pricePerByte;

    Prices prices = guessed;
    const auto doMatchesPay = [&] { return prices.perByte * 63u / 64 <= asLiterals; };
    const uint16_t* known = batch.known;
    if (known) {
        SetPrices(known, none, prices);
        FindPath(reach.bytes, reach.from, to, end, prices, ladder);
    }
    size_t pass = 1;
    // The input may have changed.
    if (!known || !doMatchesPay()) {
        FindPath(reach.bytes, reach.from, to, end, prices = guessed, ladder);
        known = none;
        pass = 0;
    }
    for (;; pass++) {
        const bool isGood = pass == 0 || doMatchesPay();
        parsed.position = batch.from;
        const size_t first = isGood ? FollowPath(reach.from, to, ladder, scratch) : 0;
        if ((parsed.isLinked = batch.links && batch.tableCount > 1))
            parsed.didLinksPay = Extend(batch, reach, first, maxMatches / 2, batch.tables[batch.tableCount - 2].gramLen, 14, scratch);
        PutTokens(reach, first, to, 0, false, scratch, tokens, parsed);
        if (pass >= batch.passes || parsed.tokens * 64 > 31 * len + 256 || parsed.tokens * 64 < pass * len)
            break;
        const Prices before = prices;
        Count(tokens, parsed.tokens, latest);
        SetPrices(known, latest, prices);
        const size_t change = sum([&](size_t i) { return std::abs(before.symbols[i] - prices.symbols[i]); });
        if (!isGood || change * 10 * (batch.passes + 1) < sum([&](size_t i) { return before.symbols[i]; }))
            break;
        FindPath(reach.bytes, reach.from, to, end, prices, ladder);
    }
    *batch.pricePerByte = prices.perByte;
}

void Parse(const Batch& batch, Scratch& scratch, uint32_t* tokens, Parsed& parsed)
{
    if (batch.finder != Gaps)
        std::fill_n(scratch.candidates, origin, noCandidate);
    if (batch.finder == Runs) {
        FindRuns(batch, scratch.candidates);
    } else if (batch.finder == Samples) {
        HashSome(batch, batch.tables[0], scratch);
    } else if (batch.finder == Tables) {
        for (size_t i = 0, last = batch.tableCount - 1; i <= last; i++) {
            const Table table = batch.tables[i];
            const auto alone = table.gramLen > 4 ? Hash<true, true, true> : Hash<false, true, true>;
            const auto later = i == last ? Hash<true, false, true> : Hash<true, false, false>;
            const auto first = i == last ? alone : Hash<true, true, false>;
            (i == 0 ? first : later)(batch, table, Fold(batch, table.gramLen, scratch), scratch.candidates);
        }
    }

    const ptrdiff_t zero = ptrdiff_t { batch.hashFrom } - origin;
    const Reach reach { batch.bytes + zero, batch.from - static_cast<size_t>(zero), batch.hashFrom - batch.oldest };
    const size_t end = batch.end - zero;
    size_t first = 0;
    parsed = { 0, batch.from, 0, 0, false, false };
    if (batch.finder == Everything && batch.from < batch.to)
        return ParseThoroughly(batch, reach, scratch, tokens, parsed);
    if (batch.finder == Gaps) {
        first = (batch.tables[0].gramLen > 4 ? TakeFirst<true> : TakeFirst<false>)(batch, reach, batch.hashTo - zero, end, scratch);
    } else if (batch.finder != Nothing && batch.finder != Everything && batch.from < batch.hashTo) {
        Segments segments;
        (batch.finder != Samples ? Walk<true> : Walk<false>)(reach, batch.hashTo - zero, batch.expectsFewMatches || batch.hashTo - batch.from < 1536, scratch, segments);
        if (batch.finder == Tables && batch.links) {
            size_t steps = 0;
            for (size_t i = 0; i < segments.count; i++)
                steps += segments.to[i] - segments.from[i];
            if ((parsed.isLinked = batch.wereTokensFew || 11 * steps + 768 < batch.hashTo - batch.from))
                Link(batch, scratch.candidates);
        }
        const size_t count = Merge(reach, end, scratch, segments);
        first = Choose(batch, count, end, scratch);
        parsed.candidates = count - 1;
        if (parsed.isLinked)
            parsed.didLinksPay = Extend(batch, reach, first, count, batch.tables[batch.tableCount - 1].gramLen, 0, scratch);
    }
    PutTokens(reach, first, batch.to - zero, batch.endsInput ? 0 : end, batch.isHasty, scratch, tokens, parsed);
}

// Of 16 bytes, the first of which is 0.
static HWY_INLINE hn::Vec<decltype(du16)> LookUp(const uint8_t* table, hn::Vec<decltype(du16)> indices)
{
    return hn::TableLookupBytes(hn::LoadDup128(d8, table), indices);
}

static HWY_INLINE hn::Vec<decltype(du16)> LookUp(const uint8_t (&lowAndHigh)[2][16], hn::Vec<decltype(du16)> indices)
{
    return hn::Or(LookUp(lowAndHigh[0], indices), LookUp(lowAndHigh[1], hn::ShiftLeft<8>(indices)));
}

// Rounds the ideal lengths at the lowest fraction that makes a code, then shortens those next in line until it is complete.
static HWY_INLINE void ChooseLens(const int16_t* frequencies, size_t len, int32_t total, size_t maxLen, uint16_t* lens)
{
    alignas(32) int16_t ideal[304], fractions[304], more[304];
    const auto all = hn::DupEven(hn::BitCast(d16, Log2(hn::Set(d32, total))));
    const auto one = hn::Set(d16, 1), longest = hn::Set(d16, maxLen);
    const auto rounded = [&](size_t at, auto added) BUN_INLINED { return hn::ShiftRight<8>(hn::SaturatedAdd(hn::Load(d16, ideal + at), added)); };
    // Of all codes, in units of what one of 14 bits takes up.
    const auto share = [&](auto lens) BUN_INLINED {
        alignas(16) static constexpr uint8_t shares[2][16] = { { 0, 0, 0, 0, 0, 0, 0, 128, 64, 32, 16, 8, 4, 2, 1 }, { 0, 32, 16, 8, 4, 2, 1 } };
        return hn::BitCast(d16, LookUp(shares, hn::BitCast(du16, lens)));
    };
    auto least = hn::Zero(d16);
    HWY_UNROLL(1)
    for (size_t i = 0; i < len; i += lanes16) {
        const auto bits = hn::SaturatedSub(all, Log2(hn::Load(d16, frequencies + i))), whole = hn::ShiftRight<8>(bits);
        const auto roundedUp = share(hn::Clamp(hn::Add(whole, one), one, longest));
        hn::Store(bits, d16, ideal + i);
        hn::Store(hn::And(bits, hn::Set(d16, 255)), d16, fractions + i);
        hn::Store(hn::Sub(share(hn::Clamp(whole, one, longest)), roundedUp), d16, more + i);
        least = hn::Add(least, roundedUp);
    }
    // The lanes behind the last symbol get the longest codewords.
    const int32_t room = (1 << 14) + ((0 - len) % lanes16 << (14 - maxLen));
    constexpr int32_t step = 16;
    int32_t below = 0, left = room - hn::ReduceSum(d16, least);
    for (int32_t stride : { 4 * step, step }) {
        auto a = hn::Zero(d16), b = a, c = a;
        HWY_UNROLL(1)
        for (size_t i = 0; i < len; i += lanes16) {
            const auto add = [&](auto& sum, int32_t below) BUN_INLINED { sum = hn::Add(sum, hn::IfThenElseZero(hn::Lt(hn::Load(d16, fractions + i), hn::Set(d16, below)), hn::Load(d16, more + i))); };
            add(a, below + stride);
            add(b, below + 2 * stride);
            add(c, below + 3 * stride);
        }
        for (auto sum : { a, b, c })
            below += hn::ReduceSum(d16, sum) <= left ? stride : 0;
    }
    int32_t added = 256 - step - below;
    do {
        added += step;
        auto sum = hn::Zero(d16);
        HWY_UNROLL(1)
        for (size_t i = 0; i < len; i += lanes16) {
            const auto some = hn::Clamp(rounded(i, hn::Set(d16, added)), one, longest);
            hn::StoreU(hn::BitCast(du16, some), du16, lens + i);
            sum = hn::SaturatedAdd(sum, share(some));
        }
        left = room - hn::ReduceSum(d32, hn::WidenMulPairwiseAdd(d32, sum, one));
    } while (left < 0);
    for (int32_t less = 2 * step; left != 0; less = std::min(4 * less, 1 << 14)) {
        for (size_t first = 0; first < len; first += 64) {
            uint64_t next = 0;
            HWY_UNROLL(1)
            for (size_t i = first; i < std::min(first + 64, len); i += lanes16) {
                const auto some = hn::BitCast(d16, hn::LoadU(du16, lens + i));
                next |= hn::BitsFromMask(d16, hn::AndNot(hn::Gt(share(some), hn::Set(d16, left)), hn::Gt(some, hn::Max(rounded(i, hn::Set(d16, added - less)), one)))) << i % 64;
            }
            for (; next != 0 && left != 0; next &= next - 1) {
                uint16_t& shortened = lens[first + std::countr_zero(next)];
                const int32_t more = 1 << (14 - shortened);
                shortened -= more <= left;
                left -= more <= left ? more : 0;
            }
        }
    }
}

// Returns what all symbols take.
static HWY_NOINLINE uint32_t MakeCode(const uint16_t* frequencies, size_t count, size_t maxLen, Code& code)
{
    alignas(32) int16_t used[std::size(code.symbols)];
    const hn::Full128<uint16_t> eight;
    auto first = hn::Zero(eight);
    size_t len = 0;
    HWY_UNROLL(4)
    for (size_t at = 0; at < count; at += 8) {
        const size_t bits = hn::BitsFromMask(eight, hn::Eq(hn::ShiftLeft<1>(hn::LoadU(eight, frequencies + at)), hn::Zero(eight))) ^ 0xff;
        hn::StoreU(hn::Add(first, hn::PromoteTo(eight, hn::Load(hn::Full64<uint8_t>(), setBits.indices[bits]))), eight, code.symbols + len);
        first = hn::Add(first, hn::Set(eight, 8));
        len += std::popcount(bits);
    }
    // Some decoders refuse a code that is not complete.
    if (len < 2) {
        code.symbols[1] = len == 0 ? 1 : std::max<uint16_t>(code.symbols[0], 1);
        code.symbols[0] = 0;
        len = 2;
    }
    code.used = len;
    // The last is reserved.
    hn::StoreU(hn::Set(du16, count - 1), du16, code.symbols + len);
    int32_t total = 0;
    for (size_t i = 0; i < len; i += 8) {
        for (size_t at = i; at < i + 8; at++)
            total += used[at] = frequencies[code.symbols[at]] & 0x7fff;
        Fence(used);
    }
    hn::StoreU(hn::Zero(d16), d16, used + len);
    if (len == 2)
        code.lens[0] = code.lens[1] = 1;
    else
        ChooseLens(used, len, total, maxLen, code.lens);
    hn::StoreU(hn::Zero(du16), du16, code.lens + len);

    // RFC 1951 3.2.2
    alignas(32) uint16_t ranks[std::size(code.symbols)];
    auto low = hn::Zero(du16), high = low;
    const auto storeCounts = [&]() BUN_INLINED {
        hn::StoreU(high, du16, code.counts + 16 - lanes16);
        if (lanes16 < 16)
            hn::StoreU(low, du16, code.counts);
        Fence(code.counts);
    };
    for (size_t i = 0; i < len; i += 8) {
        for (size_t at = i; at < i + 8; at++) {
            storeCounts();
            ranks[at] = code.counts[code.lens[at]];
            low = hn::Add(low, hn::Load(du16, ones.at[code.lens[at]]));
            high = hn::Add(high, hn::Load(du16, ones.at[code.lens[at]] + 16 - lanes16));
        }
    }
    storeCounts();
    hn::StoreU(hn::Zero(du16), du16, ranks + len);
    alignas(16) uint8_t firsts[2][16] = {};
    for (uint32_t bits = 2, word = 0; bits < 15; bits++) {
        word = (word + code.counts[bits - 1]) << 1;
        firsts[0][bits] = word;
        firsts[1][bits] = word >> 8;
    }
    auto bits = hn::Zero(d32);
    HWY_UNROLL(1)
    for (size_t i = 0; i < len; i += lanes16) {
        const auto lens = hn::LoadU(du16, code.lens + i);
        bits = hn::Add(bits, hn::WidenMulPairwiseAdd(d32, hn::Load(d16, used + i), hn::BitCast(d16, lens)));
        hn::StoreInterleaved2(lens, hn::ReverseBits(hn::Add(LookUp(firsts, lens), hn::Load(du16, ranks + i))), du16, reinterpret_cast<uint16_t*>(code.words + i));
    }
    return hn::ReduceSum(d32, bits);
}

constexpr size_t maxZeros = 138;

// Three bits each, in the order of the header.
static HWY_INLINE uint64_t PrecodeLens(const Code& precode)
{
    static constexpr uint8_t ranks[19] = { 3, 17, 15, 13, 11, 9, 7, 5, 4, 6, 8, 10, 12, 14, 16, 18, 0, 1, 2 };
    uint64_t lens = 0;
    for (size_t i = 0; i < precode.used; i++)
        lens |= uint64_t { precode.lens[i] } << 3 * ranks[precode.symbols[i]];
    return lens;
}

static HWY_INLINE size_t PrecodeSymbols(uint64_t lens) { return (63 - __builtin_clzll(lens | 1 << 9)) / 3 + 1; }

// Only zeros are told in runs. Others would save 0.05 % of a short block.
uint32_t MakeCodes(const uint16_t* frequencies, Dynamic& dynamic)
{
    const uint32_t bits = MakeCode(frequencies, 288, 14, dynamic.litlen) + MakeCode(frequencies + 288, 32, 14, dynamic.offset);
    auto zeros = hn::Zero(d16), runs = zeros, longRuns = zeros;
    for (Code* code : { &dynamic.litlen, &dynamic.offset }) {
        code->beforeSymbols[15] = -1;
        const uint16_t* symbols = code->symbols;
        HWY_UNROLL(1)
        for (size_t i = 0; i < code->used; i += lanes16) {
            const auto all = hn::IfThenZeroElse(hn::Eq(hn::LoadU(du16, code->lens + i), hn::Zero(du16)), hn::Add(hn::LoadU(du16, symbols + i), hn::Not(hn::LoadU(du16, symbols + i - 1))));
            hn::StoreU(all, du16, code->unusedBefore + i);
            const auto areTooMany = hn::Gt(hn::BitCast(d16, all), hn::Set(d16, maxZeros));
            const auto rest = hn::Sub(hn::BitCast(d16, all), hn::IfThenElseZero(areTooMany, hn::Set(d16, maxZeros)));
            const auto isRun = hn::Gt(rest, hn::Set(d16, 2)), isLong = hn::Gt(rest, hn::Set(d16, 10));
            zeros = hn::Add(zeros, hn::IfThenZeroElse(isRun, rest));
            runs = hn::Sub(runs, hn::VecFromMask(d16, hn::AndNot(isLong, isRun)));
            longRuns = hn::Sub(longRuns, hn::Add(hn::VecFromMask(d16, isLong), hn::VecFromMask(d16, areTooMany)));
        }
    }
    uint16_t told[24] = {};
    for (size_t i = 0; i < 16; i++)
        told[i] = dynamic.litlen.counts[i] + dynamic.offset.counts[i];
    told[0] = hn::ReduceSum(d16, zeros);
    told[17] = hn::ReduceSum(d16, runs);
    told[18] = hn::ReduceSum(d16, longRuns);
    const uint32_t header = MakeCode(told, 24, 7, dynamic.precode) + 3 * told[17] + 7 * told[18];
    return bits + header + 5 + 5 + 4 + 3 * PrecodeSymbols(PrecodeLens(dynamic.precode));
}

static HWY_INLINE size_t WriteHeader(Dynamic& dynamic, BitState& state)
{
    uint8_t* out = dynamic.header;
    uint64_t held = state.bits;
    size_t count = state.count;
    const auto put = [&](uint64_t bits, size_t len) BUN_INLINED {
        held |= bits << count;
        memcpy(out, &held, 8);
        count += len;
        out += count / 8;
        held >>= count & 56;
        count %= 8;
    };
    const auto last = [](const Code& code) { return *(code.symbols + code.used - 1) % 32; };
    const uint64_t precodeLens = PrecodeLens(dynamic.precode);
    const size_t precodeSymbols = PrecodeSymbols(precodeLens);
    put(last(dynamic.litlen) | last(dynamic.offset) << 5 | (precodeSymbols - 4) << 10 | precodeLens % 4096 << 14, 14 + 12);
    put(precodeLens >> 12, 3 * precodeSymbols - 12);

    alignas(16) uint8_t words[32] = {}, lens[32] = {};
    for (size_t i = 0; i < dynamic.precode.used; i++) {
        lens[dynamic.precode.symbols[i]] = dynamic.precode.lens[i];
        words[dynamic.precode.symbols[i]] = dynamic.precode.words[i] >> (32 - dynamic.precode.lens[i]);
    }
    // For no zeros, one, two, a short run and a long one.
    const uint32_t zero = std::exchange(words[0], 0), zeroLen = std::exchange(lens[0], 0);
    const uint32_t bits[5] = { 0, zero, zero | zero << zeroLen, words[17] - (3u << lens[17]), words[18] - (11u << lens[18]) };
    const uint32_t bitCounts[5] = { 0, zeroLen, 2 * zeroLen, lens[17] + 3u, lens[18] + 7u };
    alignas(16) uint8_t runWords[2][16] = {}, runLens[16] = {}, behindWord[16] = {}, behindRun[2][16] = {};
    for (size_t i = 1; i < 5; i++) {
        runWords[0][i] = bits[i];
        runWords[1][i] = bits[i] >> 8;
        runLens[i] = bitCounts[i];
        behindRun[0][i] = 1 << bitCounts[i];
        behindRun[1][i] = 1 << bitCounts[i] >> 8;
    }
    behindWord[3] = 1 << lens[17];
    behindWord[4] = 1 << lens[18];

    // The zeros in front of a length and that, with the number of bits at the top.
    uint32_t items[288 + 32 + 2 + 16];
    size_t len = 0;
    for (const Code* code : { &dynamic.litlen, &dynamic.offset }) {
        HWY_UNROLL(1)
        for (size_t i = 0; i < code->used; i += lanes16) {
            const auto all = hn::BitCast(d16, hn::LoadU(du16, code->unusedBefore + i));
            const auto areTooMany = hn::Gt(all, hn::Set(d16, maxZeros));
            const auto rest = hn::Sub(all, hn::IfThenElseZero(areTooMany, hn::Set(d16, maxZeros)));
            const auto kinds = hn::BitCast(du16, hn::Sub(hn::Min(rest, hn::Set(d16, 3)), hn::VecFromMask(d16, hn::Gt(rest, hn::Set(d16, 10)))));
            const auto told = hn::LoadU(du16, code->lens + i), word = LookUp(words, told), factor = hn::Max(LookUp(behindRun, kinds), hn::Set(du16, 1));
            const auto run = hn::MulAdd(hn::BitCast(du16, rest), LookUp(behindWord, kinds), LookUp(runWords, kinds));
            const auto top = hn::ShiftLeft<11>(hn::Add(LookUp(lens, told), LookUp(runLens, kinds)));
            uint32_t* to = items + len + i;
            hn::StoreInterleaved2(hn::MulAdd(word, factor, run), hn::Or(top, hn::MulHigh(word, factor)), du16, reinterpret_cast<uint16_t*>(to));
            if (HWY_UNLIKELY(!hn::AllFalse(d16, areTooMany))) {
                const size_t lane = hn::FindKnownFirstTrue(d16, areTooMany);
                memmove(to + lane + 1, to + lane, 4 * (lanes16 - lane));
                to[lane] = (bits[4] + (maxZeros << lens[18])) % 0x10000 | bitCounts[4] << 27;
                len++;
            }
        }
        len += code->used;
    }
    items[len] = 0;
    for (size_t i = 0; i < len; i += 2)
        put(items[i] % (1 << 27) | uint64_t { items[i + 1] % (1 << 27) } << (items[i] >> 27), (items[i] >> 27) + (items[i + 1] >> 27));
    state = { held, count };
    return out - dynamic.header;
}

// Leaves anything where no token of the block looks.
size_t StartBlock(Dynamic& dynamic, uint32_t* codes, BitState& state)
{
    const Code &litlen = dynamic.litlen, &offset = dynamic.offset;
    for (size_t i = 0; i < litlen.used; i += 8) {
        for (size_t at = i; at < i + 8; at++)
            codes[litlen.symbols[at]] = codes[512 + litlen.symbols[at]] = litlen.words[at];
    }
    const uint32_t* symbols = codes + 512;
    const auto withRoom = [](uint32_t word, uint32_t extraBits) { return (word >> extraBits & ~31u) + word % 32 + extraBits; };
    uint32_t* lengths = codes + 256;
    for (size_t i = 0; i < 8; i++)
        *lengths++ = symbols[257 + i];
    HWY_UNROLL(5)
    for (size_t extraBits = 1; extraBits <= 5; extraBits++) {
        for (size_t i = 4; i < 8; i++, lengths += 1 << extraBits) {
            auto some = hn::Add(hn::Set(du32, withRoom(symbols[257 + 4 * extraBits + i], extraBits)), hn::ShiftLeftSame(hn::Iota(du32, 0), 32 - extraBits));
            for (size_t at = 0; at < 1u << extraBits; at += lanes32, some = hn::Add(some, hn::Set(du32, lanes32 << (32 - extraBits))))
                hn::StoreU(some, du32, lengths + at);
        }
    }
    codes[511] = symbols[285];
    codes[1024] = symbols[256];
    for (size_t i = 0; i < offset.used; i += 4) {
        for (size_t at = i; at < i + 4; at++)
            codes[768 + offset.symbols[at]] = withRoom(offset.words[at], std::max(offset.symbols[at] / 2, 1) - 1);
    }
    std::swap(codes[768], codes[769]);
    return WriteHeader(dynamic, state);
}

void Sum(const uint16_t* frequencies, Sums* sums)
{
    for (size_t len : { 256, 32, 32 }) {
        auto total = hn::Zero(d32), sum = total;
        auto unused = hn::Zero(d16);
        HWY_UNROLL(1)
        for (const uint16_t* end = frequencies + len; frequencies != end; frequencies += lanes16) {
            const auto both = hn::BitCast(d16, hn::LoadU(du16, frequencies));
            sum = hn::Add(sum, hn::WidenMulPairwiseAdd(d32, both, Log2(both)));
            total = hn::Add(total, hn::SumsOf2(both));
            unused = hn::Add(unused, hn::VecFromMask(d16, hn::Eq(both, hn::Zero(d16))));
        }
        *sums++ = { hn::ReduceSum(d32, total), static_cast<int32_t>(len) + hn::ReduceSum(d16, unused), hn::ReduceSum(d32, sum) };
    }
}

#if HWY_TARGET == HWY_AVX2
template<size_t lane = 0> static HWY_INLINE void LookUp(const uint32_t* codes, const uint16_t* indices, V32& first, V32& second)
{
    first = WithLane<lane>(first, codes[indices[2 * lane]]);
    second = WithLane<lane>(second, codes[512 + indices[2 * lane + 1]]);
    if constexpr (lane + 1 < lanes32)
        LookUp<lane + 1>(codes, indices, first, second);
}

// Returns false, and has not moved on, unless each pair of tokens takes 7 to 57 bits. Stores start no later than at `last`.
static HWY_INLINE bool WriteGroups(const uint32_t* tokens, size_t groups, const uint32_t* codes, uint8_t* out, size_t last, uint64_t& held, size_t& position)
{
    struct alignas(32) {
        uint16_t indices[16];
        uint64_t bits[4], at[4];
    } staged[2 + 8], *group = staged + 2;
    for (size_t i = 0; i < groups; i++) {
        const auto halves = hn::BitCast(du16, hn::LoadU(du32, tokens + 8 * i));
        hn::Store(hn::OddEven(hn::ShiftRight<7>(halves), hn::And(halves, hn::Set(du16, 511))), du16, group[i].indices);
    }
    const auto zero = hn::Zero(du32), limit = hn::Set(du32, last);
    const auto wide = [](auto vector) BUN_INLINED { return hn::BitCast(du64, vector); };
    for (size_t i = 0; i < 2; i++) {
        hn::Store(wide(zero), du64, staged[i].bits);
        hn::Store(hn::Set(du64, std::min(last, position / 8)), du64, staged[i].at);
    }
    Fence(&staged);
    const auto store = [&](const auto& words) BUN_INLINED {
        for (size_t i = 0; i < 4; i++)
            memcpy(out + words.at[i], words.bits + i, 8);
    };
    auto longest = hn::Zero(d8);
    auto before = hn::Set(du64, held), end = hn::Set(du64, position);
    HWY_UNROLL(1)
    for (; groups != 0; groups--, group++, tokens += 8) {
        auto first = zero, second = zero;
        LookUp(codes, group->indices, first, second);
        store(group[-2]);
        auto firstLens = hn::And(first, hn::Set(du32, 31)), secondLens = hn::And(second, hn::Set(du32, 31));
        auto extra = hn::ShiftRight<10>(hn::LoadU(du32, tokens));
        BUN_KEEP(firstLens);
        BUN_KEEP(secondLens);
        BUN_KEEP(extra);
        const auto both = hn::Add(firstLens, secondLens);
        first = hn::Xor(first, firstLens);
        second = hn::Or(hn::Xor(second, secondLens), hn::ShiftLeft<19>(extra));
        const auto odd = hn::Or(wide(hn::OddEven(second, zero)), hn::Shr(wide(hn::OddEven(first, zero)), hn::ShiftRight<32>(wide(secondLens))));
        const auto even = hn::Or(hn::ShiftLeft<32>(wide(second)), hn::Shr(hn::ShiftLeft<32>(wide(first)), wide(hn::OddEven(zero, secondLens))));
        const auto bits = hn::Or(odd, hn::Shr(even, hn::ShiftRight<32>(wide(both)))), lens = hn::SumsOf8(hn::BitCast(d8, both));
        longest = hn::Max(longest, hn::Sub(hn::BitCast(d8, lens), hn::BitCast(d8, hn::Set(du64, 7))));

        auto sums = hn::Add(lens, hn::ShiftLeftLanes<1>(du64, lens));
        sums = hn::Add(sums, hn::ConcatUpperLower(du64, hn::BroadcastLane<1>(sums), wide(zero)));
        BUN_KEEP(sums);
        const auto starts = hn::Add(end, hn::Sub(sums, lens));
        end = hn::Add(end, hn::BroadcastLane<3>(sums));
        // A shift by 64 leaves nothing.
        const auto room = hn::Sub(hn::Set(du64, 64), hn::And(starts, hn::Set(du64, 7)));
        const auto rotated = hn::Per4LaneBlockShuffle<2, 1, 0, 3>(bits);
        const decltype(bits) previous { _mm256_blend_epi32(rotated.raw, before.raw, 3) };
        hn::Store(hn::Or(hn::Shr(bits, hn::Sub(room, lens)), hn::Shr(previous, room)), du64, group->bits);
        hn::Store(wide(hn::Min(hn::BitCast(du32, hn::ShiftRight<3>(starts)), limit)), du64, group->at);
        before = rotated;
    }
    if (HWY_UNLIKELY(!hn::AllFalse(d32, hn::Gt(hn::BitCast(d32, longest), hn::Set(d32, 57 - 7)))))
        return false;
    Fence(&staged);
    store(group[-2]);
    store(group[-1]);
    held = hn::GetLane(before);
    position = hn::GetLane(end);
    return true;
}
#endif

size_t Write(const uint32_t* tokens, size_t count, const uint32_t* codes, uint8_t* out, size_t room, BitState& state)
{
    // The latest bits, from the top.
    uint64_t held = state.bits << 1 << (63 - state.count);
    size_t position = state.count;
    if (room < 8)
        return SIZE_MAX;
    memcpy(out, &state.bits, 8);
    const size_t last = std::min<size_t>(room - 8, INT32_MAX);
    const auto bitsOf = [&](uint32_t token, uint32_t& len) BUN_INLINED {
        const uint32_t first = codes[token % 512], second = codes[512 + (token >> 23)];
        len = first % 32 + second % 32;
        return uint64_t { first & ~31u } << 32 >> second % 32 | uint64_t { (second & ~31u) | token >> 10 << 19 } << 32;
    };
    const auto put = [&](uint64_t bits, uint32_t len) BUN_INLINED {
        held = held >> len | bits;
        const uint64_t word = held >> (0 - len - position % 8) % 64;
        memcpy(out + std::min(position / 8, last), &word, 8);
        position += len;
    };
    for (const uint32_t* end = tokens + count; tokens != end && position / 8 <= last;) {
        size_t some = std::min<size_t>(64, end - tokens);
        __builtin_prefetch(out + position / 8 + 256, 1);
        __builtin_prefetch(out + position / 8 + 320, 1);
#if HWY_TARGET == HWY_AVX2
        if (some >= 8 && WriteGroups(tokens, some / 8, codes, out, last, held, position)) {
            tokens += some & ~7;
            continue;
        }
#endif
        uint32_t len, nextLen;
        for (; some >= 2; some -= 2, tokens += 2) {
            const uint64_t bits = bitsOf(tokens[0], len), next = bitsOf(tokens[1], nextLen);
            if (HWY_LIKELY(len + nextLen <= 57)) {
                put(bits >> nextLen | next, len + nextLen);
            } else {
                put(bits, len);
                put(next, nextLen);
            }
        }
        if (some != 0) {
            const uint64_t bits = bitsOf(*tokens++, len);
            put(bits, len);
        }
    }
    if (position / 8 > last)
        return SIZE_MAX;
    put(uint64_t { codes[1024] & ~31u } << 32, codes[1024] % 32);
    state = { held >> 1 >> (63 - position % 8), position % 8 };
    return position / 8;
}

// NOLINTNEXTLINE(google-readability-namespace-comments)
} // namespace HWY_NAMESPACE
} // namespace bun::deflate
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun::deflate {
HWY_EXPORT(Parse);
HWY_EXPORT(EndOfRun);
HWY_EXPORT(Count);
HWY_EXPORT(MakeCodes);
HWY_EXPORT(StartBlock);
HWY_EXPORT(Sum);
HWY_EXPORT(Write);

extern "C" void highway_deflate_parse(const Batch* batch, Scratch* scratch, uint32_t* tokens, Parsed* parsed)
{
    BUN_HWY_DISPATCH(Parse)(*batch, *scratch, tokens, *parsed);
}

extern "C" size_t highway_deflate_end_of_run(const uint8_t* bytes, size_t at, size_t end, size_t distance)
{
    return BUN_HWY_DISPATCH(EndOfRun)(bytes, at, end, distance);
}

extern "C" void highway_deflate_count(const uint32_t* tokens, size_t count, uint16_t* frequencies)
{
    BUN_HWY_DISPATCH(Count)(tokens, count, frequencies);
}

extern "C" uint32_t highway_deflate_make_codes(const uint16_t* frequencies, Dynamic* dynamic)
{
    return BUN_HWY_DISPATCH(MakeCodes)(frequencies, *dynamic);
}

extern "C" size_t highway_deflate_start_block(Dynamic* dynamic, uint32_t* codes, BitState* state)
{
    return BUN_HWY_DISPATCH(StartBlock)(*dynamic, codes, *state);
}

extern "C" void highway_deflate_sum(const uint16_t* frequencies, Sums* sums)
{
    BUN_HWY_DISPATCH(Sum)(frequencies, sums);
}

extern "C" size_t highway_deflate_write(const uint32_t* tokens, size_t count, const uint32_t* codes, uint8_t* out, size_t room, BitState* state)
{
    return BUN_HWY_DISPATCH(Write)(tokens, count, codes, out, room, *state);
}
} // namespace bun::deflate
#endif
