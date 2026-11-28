// Qualities 2 to 9 of the encoder in src/brotli. All targets give the same results.

#ifndef __OPTIMIZE__
#error "Unless hwy::ChosenTarget::GetIndex() is inlined, the linker may keep that of a file with other targets."
#endif

#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | HWY_NEON | HWY_NEON_BF16 | HWY_SSE4 | (HWY_AVX2 - 1))

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_brotli_quick.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <algorithm>
#include <array>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <utility>

#ifndef BUN_BROTLI_QUICK_ONCE
#define BUN_BROTLI_QUICK_ONCE
namespace bun::brotli_quick {

constexpr size_t kChunk = 4096;
constexpr size_t kBatch = 128;
constexpr size_t kWalkers = 6;
constexpr size_t kSpan = 32;
constexpr size_t kRounds = kChunk / kWalkers + 22;
constexpr size_t kLookBack = 12;
constexpr size_t kFirstNode = 16;
constexpr size_t kNodes = kFirstNode + kChunk + 80;
constexpr int kNodeBits = 13;
constexpr size_t kMaxWords = kChunk / 2;
constexpr size_t kFar = 1 << 17;
constexpr size_t kMaxHeld = 256;
constexpr size_t kMaxTrees = 8;
constexpr size_t kCommandSymbols = 704;
constexpr size_t kDistanceSlots = 576;
constexpr uint32_t kNoDistance = kDistanceSlots - 1;
constexpr size_t kPath = kChunk / 2 + 352;
constexpr size_t kMaxWeight = 48000;
constexpr size_t kSection = 4000;

constexpr uint32_t kWordRowBits = 10;
constexpr size_t kWordCount = 13504;
alignas(16) constexpr uint8_t kWordSizeBits[32] = { 0, 0, 0, 0, 10, 10, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 7, 7, 8, 7, 7, 6, 6, 5, 5 };
constexpr auto kWordOffsets = [] {
    std::array<uint32_t, 32> offsets {};
    for (uint32_t length = 4; length < 25; ++length)
        offsets[length + 1] = offsets[length] + (length << kWordSizeBits[length]);
    return offsets;
}();

struct alignas(32) Words {
    uint32_t first_four[8 << kWordRowBits];
    uint32_t buckets[8 << kWordRowBits];
    uint32_t next_four[kWordCount + 16];
    uint32_t transforms[2][256];
    uint16_t packed[kWordCount + 16];
    uint8_t omit_last[16];
};

// These three are in src/highway/brotli_quick.rs, too.
struct Settings {
    uint32_t table_bits[3];
    uint32_t grams[3];
    uint32_t table_count;
    uint32_t landmark_bits;
    uint32_t seam_bits;
    uint32_t sparsity;
    uint32_t few_matches;
    uint32_t repeat_gain;
    uint32_t word_toll;
    uint32_t join_toll;
    uint32_t position_bits;
    uint32_t max_backward;
    uint32_t first_word;
    uint32_t postfix_bits[3];
    uint32_t direct_codes;
    uint32_t distance_symbols[3];
    uint32_t distance_symbol_bits[3];
    uint32_t max_trees;
    uint32_t min_insert;
    uint32_t haste;
    uint32_t max_size;
};

struct Input {
    const uint8_t* bytes;
    size_t size;
    size_t origin;
    size_t dictionary_end;
    uint64_t base;
    uint32_t stream_offset;
};

struct Memory {
    uint32_t* landmarks;
    // And then what `Join` keeps in `tried`.
    uint32_t* seams;
    uint32_t* tables[3];
    uint64_t* commands;
    uint64_t* distances;
    uint16_t* literal_ends;
    uint32_t* literals;
    uint8_t* packed;
    const Words* words;
    const uint8_t* dictionary;
    const uint8_t* contexts;
};

struct Match {
    uint32_t start, end, distance;
};

struct Mark {
    uint32_t commands, literals;
    // Where the last command ends.
    uint32_t covered;
};

struct alignas(64) Counts {
    uint32_t commands[kCommandSymbols], distances[kDistanceSlots], literals[64];
};

constexpr Counts kNone {};

struct State {
    // `settled` is where the meta-block may end.
    Mark now, settled;
    // The last match, which may get longer or be replaced.
    Match held;
    uint32_t is_ready;
    uint8_t is_binary, swapped : 1, is_dense : 1, is_fine : 1, has_seams : 1, checks_after, most_matched;
    uint8_t is_barren, leniency, had_contexts, repeats_after;
    int32_t literal_cost, settled_bits;
    uint32_t favorite, trust, word_credit, stride, indexed;
    uint16_t kind, table_bits;
    alignas(16) uint32_t last[4];
    // Before and after `settled`.
    Counts counts[2];

    Counts& Before() { return counts[!swapped]; }
    Counts& After() { return counts[swapped]; }
};

struct Path {
    uint32_t starts[kPath], ends[kPath], distances[kPath];
};

struct alignas(64) ParseScratch {
    uint8_t valid[kChunk + 192];
    int16_t starts[kNodes], ends[kNodes];
    uint32_t distances[kNodes];
    uint16_t list[kNodes], first[kNodes], previous[kNodes];
    Path paths[2];
    size_t listed;
    // One after the other.
    union alignas(64) {
        struct {
            // Of the byte that may be the same, relative to the chunk.
            int32_t sources[kChunk + 192];
            union {
                uint64_t pairs[kChunk / 2 + 32];
                struct {
                    int32_t found[kWalkers * kRounds];
                    uint32_t equal_before[kWalkers * kRounds];
                    uint16_t probes[kWalkers * kRounds], reaches[kWalkers * kRounds];
                };
            };
        };
        struct {
            int32_t at_start[kNodes], at_end[kNodes], cost[kNodes], base[kNodes], best[kNodes];
        };
        struct {
            uint32_t seconds[kPath], equal[kPath], other[kPath];
            uint8_t promising[kPath / 8 + 8];
        };
        struct {
            uint32_t keys[kNodes], results[kMaxWords + 16], around[4 * (kMaxWords + 16)], stops[kMaxWords + 16];
        };
        struct {
            uint32_t inserts[kPath], recent[4 * kPath];
        };
    };
};

struct alignas(64) WriteScratch {
    uint16_t by_context[64 * 256];
    uint32_t counts[kMaxTrees * 256];
    uint64_t literal_codes[kMaxTrees * 256], command_codes[kCommandSymbols], distance_codes[kDistanceSlots];
};

union Scratch {
    ParseScratch parse;
    WriteScratch write;
};

constexpr uint8_t kInsertBits[24] = { 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 12, 14, 24 };
constexpr uint8_t kCopyBits[24] = { 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24 };
constexpr auto kCommandBits = [] {
    constexpr uint8_t insert[11] = { 0, 0, 0, 0, 8, 8, 0, 16, 8, 16, 16 }, copy[11] = { 0, 8, 0, 8, 0, 8, 16, 0, 16, 8, 16 };
    std::array<uint8_t, kCommandSymbols> bits {};
    for (size_t i = 0; i < bits.size(); ++i)
        bits[i] = kInsertBits[insert[i / 64] + i / 8 % 8] + kCopyBits[copy[i / 64] + i % 8];
    return bits;
}();

// Two codes that take little to describe.
template<size_t kSymbols>
struct FixedCodes {
    struct Run {
        uint32_t length, count;
    };
    struct Description {
        uint32_t size;
        // 48 in the first.
        uint64_t bits[2];
    };

    constexpr FixedCodes(const Run (&runs)[2][5], Description a, Description b, int32_t per_symbol, auto extra_bits)
        : descriptions { a, b }
    {
        for (size_t which = 0; which < 2; ++which) {
            uint64_t code = 0;
            for (uint32_t length = 1; length < 16; ++length, code <<= 1) {
                size_t symbol = 0;
                for (const Run run : runs[which]) {
                    for (size_t i = symbol; run.length == length && i < symbol + run.count; ++i) {
                        codes[which][i] = (__builtin_bitreverse64(code++) >> extra_bits(i)) + length + extra_bits(i) - i;
                        lengths[i] |= length << (16 * which);
                    }
                    symbol += run.count;
                }
            }
        }
        for (int32_t count = 1; count < 256; ++count) {
            const int32_t whole = 31 - __builtin_clz(count);
            shares[count] = per_symbol / count - 16 * whole - ((count << 4 >> whole) - 16 + (count != 1 << whole));
        }
    }

    Description descriptions[2];
    uint64_t codes[2][kSymbols] = {};
    uint32_t lengths[kCommandSymbols] = {};
    // In 16ths of a bit, for a symbol with this count: its part of the description of a code that fits, less the logarithm.
    int16_t shares[256] = {};
};

constexpr FixedCodes<kCommandSymbols> kFixedCommandCodes({ { { 9, 448 }, { 11, 256 } }, { { 12, 129 }, { 5, 6 }, { 7, 67 }, { 9, 79 }, { 12, 423 } } },
    { 59, { 0x624416307003, 0x92 } }, { 91, { 0xA9078227083, 0x6C10F967A4B } }, 100, [](size_t symbol) { return kCommandBits[symbol]; });
constexpr FixedCodes<64> kFixedDistanceCodes({ { { 6, 64 } }, { { 8, 19 }, { 6, 3 }, { 4, 10 }, { 6, 14 }, { 9, 18 } } },
    { 28, { 0x369DC03 } }, { 61, { 0x981AA340EC0B, 0x1278 } }, 64, [](size_t symbol) { return symbol < 16 ? 0 : symbol / 2 - 7; });

alignas(32) constexpr auto kUnitVectors = [] {
    std::array<uint16_t, 16 * 16> vectors {};
    for (size_t i = 0; i < 16; ++i)
        vectors[17 * i] = 1;
    return vectors;
}();
constexpr auto kSetBits = [] {
    std::array<std::array<uint8_t, 8>, 256> lists {};
    for (uint32_t bits = 0; bits < 256; ++bits) {
        for (uint32_t left = bits, i = 0; left; left &= left - 1)
            lists[bits][i++] = __builtin_ctz(left);
    }
    return lists;
}();
// For up to four of eight positions, in all bytes.
alignas(16) constexpr auto kFirstFour = [] {
    std::array<uint32_t, 4 * 256> lists {};
    for (uint32_t i = 0; i < lists.size(); ++i)
        lists[i] = kSetBits[i / 4][i % 4] * 0x01010101;
    return lists;
}();
// Up to four tokens, the symbol in the low five bits of each.
constexpr uint32_t RunTokens(uint32_t repeats, uint32_t symbol)
{
    const uint32_t bits = symbol - 14;
    uint32_t left = repeats - 3, tokens = 0;
    for (;;) {
        tokens = tokens << 8 | symbol | (left & ((1 << bits) - 1)) << (8 - bits);
        left >>= bits;
        if (!left--)
            return tokens;
    }
}
constexpr auto kZeroRuns = [] {
    std::array<uint32_t, kCommandSymbols> runs {};
    for (uint32_t i = 3; i < runs.size(); ++i)
        runs[i] = i == 11 ? RunTokens(10, 17) << 8 : RunTokens(i, 17);
    return runs;
}();
constexpr auto kZeroRunSizes = [] {
    std::array<uint8_t, kCommandSymbols> sizes {};
    for (uint32_t i = 0; i < sizes.size(); ++i)
        sizes[i] = i < 3 ? i : 4 - __builtin_clz(kZeroRuns[i]) / 8;
    return sizes;
}();

} // namespace bun::brotli_quick
#endif

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;
using namespace brotli_quick;

using DU8 = hn::CappedTag<uint8_t, 32>;
using DI8 = hn::RebindToSigned<DU8>;
using DU16 = hn::Repartition<uint16_t, DU8>;
using DI16 = hn::Repartition<int16_t, DU8>;
using DU32 = hn::Repartition<uint32_t, DU8>;
using DI32 = hn::Repartition<int32_t, DU8>;
using DF32 = hn::Repartition<float, DU8>;
using VU32 = hn::Vec<DU32>;
using VI32 = hn::Vec<DI32>;
static constexpr size_t kLanes = hn::MaxLanes(DU32());

template<typename T> static HWY_INLINE T Read(const void* from)
{
    T value;
    memcpy(&value, from, sizeof value);
    return value;
}

template<typename T> static HWY_INLINE void Put(void* to, T value) { memcpy(to, &value, sizeof value); }

// A bit for each of 32 bytes.
static HWY_INLINE uint32_t Equal(const uint8_t* a, const uint8_t* b)
{
    const DU8 d;
#if HWY_MAX_BYTES >= 32
    return hn::BitsFromMask(d, hn::LoadU(d, a) == hn::LoadU(d, b));
#elif HWY_ARCH_ARM_A64
    const uint8x16_t weights = vreinterpretq_u8_u64(vdupq_n_u64(0x8040201008040201));
    uint8x16_t bits = vpaddq_u8(vandq_u8(vceqq_u8(vld1q_u8(a), vld1q_u8(b)), weights), vandq_u8(vceqq_u8(vld1q_u8(a + 16), vld1q_u8(b + 16)), weights));
    bits = vpaddq_u8(bits, bits);
    return vgetq_lane_u32(vreinterpretq_u32_u8(vpaddq_u8(bits, bits)), 0);
#else
    return hn::BitsFromMask(d, hn::LoadU(d, a) == hn::LoadU(d, b)) | hn::BitsFromMask(d, hn::LoadU(d, a + 16) == hn::LoadU(d, b + 16)) << 16;
#endif
}

static HWY_INLINE uint32_t LeadingZeros(uint32_t bits)
{
#if HWY_TARGET <= HWY_AVX2
    asm("lzcnt %0, %0" : "+r"(bits) : : "cc");
    return bits;
#else
    return __builtin_clzll(uint64_t { bits } << 32 | 1u << 31);
#endif
}

static HWY_INLINE uint32_t Log2(uint32_t nonzero) { return 31 - __builtin_clz(nonzero); }

// The four bytes at each of the first positions. Reads 16.
static HWY_INLINE VU32 Windows(const uint8_t* from)
{
    alignas(32) static constexpr uint32_t kIndices[8] = { 0x03020100, 0x04030201, 0x05040302, 0x06050403, 0x07060504, 0x08070605, 0x09080706, 0x0A090807 };
    auto indices = hn::Load(DU32(), kIndices);
#if HWY_ARCH_X86
    asm("" : "+x"(indices.raw));
#endif
    return hn::BitCast(DU32(), hn::TableLookupBytes(hn::LoadDup128(DU8(), from), hn::BitCast(DU8(), indices)));
}

// By the low four bits, unless the highest one is set.
static HWY_INLINE hn::Vec<DU8> LookUpOr0(hn::Vec<DU8> table, hn::Vec<DU8> index) { return hn::TableLookupBytesOr0(table, HWY_ARCH_X86 ? index : index & hn::Set(DU8(), 0x8F)); }

static HWY_INLINE VU32 FloatBits(VU32 below_2_24) { return hn::BitCast(DU32(), hn::ConvertTo(DF32(), hn::BitCast(DI32(), below_2_24))); }

static HWY_INLINE size_t MatchEnd(const uint8_t* bytes, size_t at, size_t distance, size_t limit)
{
    while (at < limit) {
        const uint32_t differs = ~Equal(bytes + at, bytes + at - distance);
        if (differs) {
            at += __builtin_ctz(differs);
            break;
        }
        at += kSpan;
    }
    return std::min(at, limit);
}

// Each of `pairs` has an index into `table` above the entry to put there. Returns by how much it exceeds what was there.
template<bool kInOrder>
static HWY_INLINE VU32 Exchange(uint32_t* table, const uint64_t* pairs)
{
    const DU32 d;
    VU32 old = hn::Undefined(d);
    const auto one = [&]<size_t kLane>() HWY_ATTR {
        // Or as interleaving leaves them.
        const uint64_t pair = pairs[kInOrder ? kLane : kLane % 2 + kLane / 4 * 2 + kLane / 2 % 2 * (kLanes / 2)];
#if HWY_TARGET <= HWY_AVX2
        uint64_t index;
        asm("shrx %2, %1, %0" : "=r"(index) : "r"(pair), "r"(uint64_t { 32 }));
        uint32_t* slot = table + index;
        __m256i all = _mm256_set1_epi32(*slot);
        asm("" : "+x"(all));
        old.raw = kLane ? _mm256_blend_epi32(old.raw, all, 1 << kLane) : all;
#else
        uint32_t* slot = table + (pair >> 32);
        old = hn::InsertLane(old, kLane, *slot);
#endif
        *slot = static_cast<uint32_t>(pair);
    };
    [&]<size_t... kLane>(std::index_sequence<kLane...>) HWY_ATTR { (one.template operator()<kLane>(), ...); }(std::make_index_sequence<kLanes>());
    const auto low = hn::Load(d, reinterpret_cast<const uint32_t*>(pairs)), high = hn::Load(d, reinterpret_cast<const uint32_t*>(pairs) + kLanes);
#if HWY_TARGET <= HWY_AVX2
    if (!kInOrder)
        return VU32 { _mm256_castps_si256(_mm256_shuffle_ps(_mm256_castsi256_ps(low.raw), _mm256_castsi256_ps(high.raw), 0x88)) } - old;
#endif
    return hn::ConcatEven(d, high, low) - old;
}

// All lanes of `bits` are the same.
static HWY_INLINE VU32 ShiftUp(VU32 v, VU32 bits)
{
#if HWY_ARCH_X86 && HWY_TARGET > HWY_AVX2
    return hn::ShiftLeftSame(v, hn::GetLane(bits));
#else
    return v << bits;
#endif
}

// A dictionary is past the window.
static HWY_INLINE uint32_t Reach(const Settings& settings, const Input& input) { return input.dictionary_end ? INT32_MAX : settings.max_backward; }

// Which of the last eight bytes to hash, for three and more.
constexpr uint32_t kLast[] = { 0x07060705, 0x07060504, 0x07060504, 0x07060504, 0x07060504, 0x07060504 };
constexpr uint32_t kRest[] = { 0x06070506, 0x06070405, 0x06070503, 0x05070302, 0x03020701, 0x03020100 };

static HWY_INLINE VU32 Mix(hn::Vec<DU8> bytes, hn::Vec<DU8> indices, uint32_t factors)
{
    return hn::BitCast(DU32(), hn::WidenMulPairwiseAdd(DI32(), hn::BitCast(DI16(), hn::TableLookupBytes(bytes, indices)), hn::BitCast(DI16(), hn::Set(DU32(), factors))));
}

static HWY_INLINE hn::Vec<DU8> MasksOfFour(size_t i, const auto& mask_at)
{
    const auto a = mask_at(i), b = mask_at(i + kLanes);
#if HWY_TARGET <= HWY_AVX2
    const __m256i ab = _mm256_packs_epi32(a.raw, b.raw);
    const auto c = mask_at(i + 2 * kLanes), e = mask_at(i + 3 * kLanes);
    return { _mm256_permutevar8x32_epi32(_mm256_packs_epi16(ab, _mm256_packs_epi32(c.raw, e.raw)), _mm256_setr_epi32(0, 4, 1, 5, 2, 6, 3, 7)) };
#else
    const auto c = mask_at(i + 2 * kLanes), e = mask_at(i + 3 * kLanes);
    return hn::BitCast(DU8(), hn::OrderedDemote2To(DI8(), hn::OrderedDemote2To(DI16(), a, b), hn::OrderedDemote2To(DI16(), c, e)));
#endif
}

// For each position, where the bytes that end there came last.
template<size_t kTables>
static HWY_NOINLINE void Index(const Settings& settings, const Memory& memory, const Input& input, size_t at, size_t length, State& state, ParseScratch& scratch)
{
    const DU8 d8;
    const DU32 d;
    const DI32 di;
    alignas(64) uint64_t pairs[kTables][kBatch];
    const auto up = hn::Set(d, settings.position_bits), step = hn::Set(d, kLanes);
    uint32_t* tables[kTables];
    VU32 mask[kTables];
    for (size_t t = 0; t < kTables; ++t) {
        tables[t] = memory.tables[t];
        mask[t] = hn::Set(d, (1 << std::min<uint32_t>(state.table_bits, settings.table_bits[t])) - 1);
    }
    const auto lanes = hn::Iota(d, 0) * hn::Set(d, 0x01010101);
    const auto last = hn::BitCast(d8, lanes + hn::Set(d, kLast[settings.grams[0] - 3])), rest = hn::BitCast(d8, lanes + hn::Set(d, kRest[settings.grams[0] - 3]));
    const auto first_four = hn::BitCast(d8, lanes + hn::Set(d, 0x03020100)), last_four = first_four + hn::Set(d8, 4);
    const size_t second = settings.grams[1], third = settings.grams[2];
    auto position = hn::Iota(d, static_cast<uint32_t>(input.base + at)), relative = hn::Iota(d, 0);
    for (size_t done = 0, count; done < length; done += count) {
        // Where it starts limits the distances.
        count = std::min(at + done < kSpan + kBatch ? kSpan : kBatch, (length - done + 31) & ~size_t { 31 });
        const uint8_t* after = input.bytes + at + done + 1;
        // The middle of a long run adds nothing new.
        if (const size_t distance = done ? done - 1 - scratch.sources[done - 1] : 0; distance - 1 < 16 && count == kBatch && done + kBatch + kSpan <= length) {
            auto differs = hn::Zero(d8);
            for (size_t i = 0; i < kBatch + kSpan; i += hn::Lanes(d8))
                differs |= hn::LoadU(d8, after + i - 9) ^ hn::LoadU(d8, after + i - 9 - distance);
            if (hn::AllTrue(d8, differs == hn::Zero(d8))) {
                for (size_t i = done; i < done + kBatch; i += kLanes, relative += step)
                    hn::Store(hn::BitCast(di, relative - hn::Set(d, distance)), di, scratch.sources + i);
                memset(scratch.valid + done, 0xFF, kBatch);
                position += hn::Set(d, kBatch);
                continue;
            }
        }
        HWY_UNROLL(2)
        for (size_t i = 0; i < count; i += kLanes, position += step) {
            const auto eight = hn::LoadDup128(d8, after + i - 8);
            auto hash = Mix(eight, last, 0x4F1B79B1) + Mix(eight, rest, 0x62B5356D);
            for (size_t t = 0; t < kTables; ++t) {
                if (t == 1)
                    hash += Mix(hn::LoadDup128(d8, after + i - second), first_four, 0x72B32E3D);
                if (t == 2) {
                    const auto more = hn::LoadDup128(d8, after + i - third);
                    hash += Mix(more, first_four, 0x27D56B2F) + Mix(more, last_four, 0x565767B1);
                }
                const auto index = hn::ShiftRight<8>(hash) & mask[t], entry = ShiftUp(hash, up) + position;
                hn::Store(hn::InterleaveLower(d, entry, index), d, reinterpret_cast<uint32_t*>(pairs[t] + i));
                hn::Store(hn::InterleaveUpper(d, entry, index), d, reinterpret_cast<uint32_t*>(pairs[t] + i) + kLanes);
            }
        }
        // What is past the end goes to a spare slot.
        for (size_t i = length - done; i < count; ++i) {
            const size_t lane = i % kLanes;
            for (size_t t = 0; t < kTables; ++t)
                pairs[t][i - lane + lane % 2 + lane / 4 * 2 + lane / 2 % 2 * (kLanes / 2)] = uint64_t { 1 } << (32 + settings.table_bits[t]);
        }
        const auto limit = hn::Set(d, std::min<size_t>(at + done + 1 - kSpan, Reach(settings, input)));
        const auto look_up = [&](size_t i) HWY_ATTR __attribute__((always_inline)) {
            auto best = hn::Zero(d), any = hn::Zero(d);
            for (size_t t = 0; t < kTables; ++t) {
                const auto distance = Exchange<false>(tables[t], pairs[t] + i);
                const auto good = hn::Min(distance, limit) == distance;
                best = t ? hn::IfThenElse(good, distance, best) : hn::IfThenElseZero(good, distance);
                any |= hn::VecFromMask(d, good);
            }
            hn::Store(hn::BitCast(di, relative - best), di, scratch.sources + done + i);
            relative += step;
            return hn::BitCast(di, any);
        };
        for (size_t i = 0; i < count; i += 4 * kLanes)
            hn::Store(MasksOfFour(i, look_up), d8, scratch.valid + done + i);
    }
}

static HWY_INLINE hn::Vec<DU8> Scramble() { return hn::Dup128VecFromValues(DU8(), 0x9C, 0x35, 0xE2, 0x4B, 0x71, 0xD8, 0x0F, 0xA6, 0x63, 0xCA, 0x1D, 0xB4, 0x8E, 0x27, 0xF0, 0x59); }

static HWY_INLINE size_t AppendSetBits(uint32_t eight, size_t first, uint16_t* list)
{
    const hn::Full128<uint16_t> d;
    hn::StoreU(hn::PromoteTo(d, hn::LoadU(hn::Full64<uint8_t>(), kSetBits[eight].data())) + hn::Set(d, first), d, list);
    return __builtin_popcount(eight);
}

// The same for the positions that stand out among their neighbors, one in 16 or in `sparsity`, as a list of those that have a source.
template<bool kFew>
static HWY_NOINLINE void IndexSome(const Settings& settings, const Memory& memory, const Input& input, size_t at, size_t length, State& state, ParseScratch& scratch)
{
    const DU8 d8;
    const DU32 d;
    const DI32 di;
    const uint8_t* const chunk = input.bytes + at;
    uint8_t* const ranks = reinterpret_cast<uint8_t*>(scratch.first) + 32;
    for (ptrdiff_t i = -16; i < static_cast<ptrdiff_t>(length); i += hn::Lanes(d8)) {
        const auto here = hn::LoadU(d8, chunk + i), before = hn::LoadU(d8, chunk + i - 1), sum = here + before + before;
        hn::StoreU(hn::TableLookupBytes(Scramble(), sum & hn::Set(d8, 15)) + (here ^ before), d8, ranks + i);
    }
    const size_t half = settings.sparsity / 2, oldest = settings.sparsity - 1;
    // A bit for each position, and never two in a row.
    uint8_t* const choices = reinterpret_cast<uint8_t*>(scratch.list);
    for (size_t i = 0; i < length; i += hn::Lanes(d8)) {
        uint32_t chosen;
        if constexpr (!kFew) {
            const auto rank = [&](size_t back) HWY_ATTR { return hn::LoadU(d8, ranks + i - back); };
            const auto middle = rank(half), next = rank(half - 1), least = hn::Min(hn::Min(hn::Min(middle, next), rank(half + 1)), hn::Min(rank(0), rank(oldest)));
            chosen = hn::BitsFromMask(d8, least == middle) & ~(hn::BitsFromMask(d8, next == middle) & 0xEEEEEEEE);
        } else {
            const auto here = hn::LoadU(d8, ranks + i), before = hn::LoadU(d8, ranks + i - 2);
            chosen = hn::BitsFromMask(d8, here - before - hn::Set(d8, 1) < hn::Set(d8, 16)) | (hn::BitsFromMask(d8, here == before) & 0x00010001);
        }
        Put(choices + i / 8, chosen & ~(chosen << 1 & 0xFEFEFEFE));
    }
    choices[length / 8] %= 1 << length % 8;
    memset(choices + length / 8 + 1, 0, 32);
    uint16_t* const groups = scratch.previous;
    size_t group_count = (length + 7) / 8;
    if constexpr (kFew) {
        const size_t all = std::exchange(group_count, 0);
        for (size_t i = 0; i < all; i += 8)
            group_count += AppendSetBits(hn::BitsFromMask(hn::Full64<uint8_t>(), hn::LoadU(hn::Full64<uint8_t>(), choices + i) != hn::Zero(hn::Full64<uint8_t>())), i, groups + group_count);
        groups[group_count] = all;
    }
    uint64_t* const pairs = scratch.pairs;
    const auto last = hn::BitCast(d8, hn::Set(d, kLast[settings.grams[0] - 3])), rest = hn::BitCast(d8, hn::Set(d, kRest[settings.grams[0] - 3]));
    const auto up = hn::Set(d, settings.position_bits), mask = hn::Set(d, (1 << std::min<uint32_t>(state.table_bits, settings.table_bits[0])) - 1);
    const auto start = hn::Set(d, input.base + at);
    auto base = start + hn::ShiftLeft<1>(hn::Iota(d, 0) & hn::Set(d, 4));
    size_t count = 0;
    for (size_t i = 0; i < group_count; i += kLanes / 4, base += hn::Set(d, 2 * kLanes)) {
        const size_t group = kFew ? groups[i] : i, low = choices[group];
#if HWY_TARGET <= HWY_AVX2
        const hn::Half<DU32> dh;
        const size_t next = kFew ? groups[i + 1] : i + 1, high = choices[next];
        const auto offsets = hn::Combine(d, hn::Load(dh, kFirstFour.data() + 4 * high), hn::Load(dh, kFirstFour.data() + 4 * low));
        const auto bytes = hn::Combine(d8, hn::LoadU(hn::Half<DU8>(), chunk + 8 * next - 7), hn::LoadU(hn::Half<DU8>(), chunk + 8 * group - 7));
        if (kFew)
            base = start + hn::Combine(d, hn::Set(dh, 8 * next), hn::Set(dh, 8 * group));
#else
        const auto offsets = hn::Load(d, kFirstFour.data() + 4 * low);
        const auto bytes = hn::LoadU(d8, chunk + 8 * group - 7);
        base = start + hn::Set(d, 8 * group);
#endif
        const auto hash = Mix(bytes, last + hn::BitCast(d8, offsets), 0x4F1B79B1) + Mix(bytes, rest + hn::BitCast(d8, offsets), 0x62B5356D);
        const auto index = hn::ShiftRight<8>(hash) & mask, entry = ShiftUp(hash, up) + base + hn::ShiftRight<24>(offsets);
        const auto a = hn::InterleaveLower(d, entry, index), b = hn::InterleaveUpper(d, entry, index);
#if HWY_TARGET <= HWY_AVX2
        hn::StoreU(hn::ConcatLowerLower(d, b, a), d, reinterpret_cast<uint32_t*>(pairs + count));
        count += __builtin_popcount(low);
        hn::StoreU(hn::ConcatUpperUpper(d, b, a), d, reinterpret_cast<uint32_t*>(pairs + count));
        count += __builtin_popcount(high);
#else
        hn::StoreU(a, d, reinterpret_cast<uint32_t*>(pairs + count));
        hn::StoreU(b, d, reinterpret_cast<uint32_t*>(pairs + count + 2));
        count += __builtin_popcount(low);
#endif
    }
    std::fill_n(pairs + count, kLanes, uint64_t { 1 } << (32 + settings.table_bits[0]));
    uint32_t* const table = memory.tables[0];
    for (size_t i = 0; i < count; i += kLanes)
        hn::Store(Exchange<true>(table, pairs + i), d, scratch.distances + i);
    // Prefers a distance as long as it finds what the table has forgotten.
    for (size_t i = 0; i < count && state.favorite - 1 < at - kSpan; state.favorite *= !!state.trust) {
        state.trust -= state.trust != 0;
        for (const size_t end = std::min(i + 64, count); i < end; ++i) {
            const uint8_t* const eight = chunk + (pairs[i] - input.base - at) % kChunk - 7;
            const bool same = Read<uint64_t>(eight) == Read<uint64_t>(eight - state.favorite);
            state.trust = (same & (scratch.distances[i] > at + kChunk)) ? 4 : state.trust;
            scratch.distances[i] = same ? state.favorite : scratch.distances[i];
        }
    }
    const auto before = hn::Set(d, at - kSpan);
    const auto max_backward = hn::Set(di, settings.max_backward), dictionary_last = hn::Set(di, input.dictionary_end - 1 - at);
    size_t found = 0;
    for (size_t i = 0; i < count; i += kLanes) {
        const uint32_t* halves = reinterpret_cast<const uint32_t*>(pairs + i);
        const auto position = (hn::ConcatEven(d, hn::Load(d, halves + kLanes), hn::Load(d, halves)) - start) & hn::Set(d, kChunk - 1);
        const auto distance = hn::Load(d, scratch.distances + i), less = distance - hn::Set(d, 1);
        const auto source = hn::BitCast(di, position - distance);
        const auto has_left = hn::RebindMask(d, hn::And(hn::BitCast(di, distance) > max_backward, source > dictionary_last));
        const size_t good = hn::BitsFromMask(d, hn::AndNot(has_left, hn::Min(less, position + before) == less));
        const auto order = hn::IndicesFromVec(di, hn::PromoteTo(di, hn::LoadU(hn::Rebind<uint8_t, DI32>(), kSetBits[good].data())));
        hn::StoreU(hn::TableLookupLanes(source, order), di, scratch.sources + found);
        hn::StoreU(hn::DemoteTo(hn::Rebind<int16_t, DI32>(), hn::TableLookupLanes(hn::BitCast(di, position), order)), hn::Rebind<int16_t, DI32>(), scratch.starts + found);
        found += __builtin_popcount(good);
    }
    scratch.listed = found;
}

// How many of the first 32 or 16 bytes come before one that is not zero.
static HWY_INLINE size_t Zeros(const uint8_t* bytes)
{
#if HWY_TARGET <= HWY_AVX2
    return _tzcnt_u32(_mm256_movemask_epi8(hn::LoadU(DU8(), bytes).raw));
#else
    alignas(16) static constexpr uint8_t kZeros[32] = {};
    return __builtin_ctzll(~uint64_t { Equal(bytes, kZeros) });
#endif
}

// How many of 16 ascending positions.
static HWY_INLINE size_t Below(const int16_t* positions, size_t end)
{
    const DI16 d;
#if HWY_TARGET <= HWY_AVX2
    return __builtin_popcount(_mm256_movemask_epi8((hn::LoadU(d, positions) < hn::Set(d, end)).raw)) / 2;
#else
    return hn::CountTrue(d, hn::LoadU(d, positions) < hn::Set(d, end)) + hn::CountTrue(d, hn::LoadU(d, positions + 8) < hn::Set(d, end));
#endif
}

// Prefers `distance` as long as it goes on matching here and there.
static HWY_NOINLINE void Continue(const uint8_t* chunk, size_t at, size_t end, size_t distance, uint32_t& trust, ParseScratch& scratch)
{
    trust -= trust != 0;
    const DI32 d;
    const hn::Rebind<int8_t, DI32> d8;
    const auto bits = hn::Set(d, 1) << hn::Iota(d, 0);
    uint64_t equal = Equal(chunk + at, chunk + at - distance), carry = 0;
    // Unless the tables have forgotten some of it, they know better.
    alignas(32) static constexpr uint8_t kZeros[kSpan] = {};
    uint64_t lost = Equal(scratch.valid + at + 7, kZeros) | uint64_t { Equal(scratch.valid + at + 7 + kSpan, kZeros) } << kSpan;
    for (; at < end; at += kSpan, equal >>= kSpan) {
        equal |= uint64_t { Equal(chunk + at + kSpan, chunk + at + kSpan - distance) } << kSpan;
        uint64_t runs = equal & equal >> 1;
        runs &= runs >> 2;
        runs &= runs >> 4;
        trust = runs & lost ? 8 : trust;
        if (!runs || !trust)
            return;
        lost = 0;
        // Adding the first bit of a run flips all of it.
        runs |= carry & equal;
        runs = (((runs & ~(runs << 1)) + equal) ^ equal) & equal;
        carry = runs >> kSpan & 1;
        for (size_t i = at; i < at + kSpan; i += kLanes, runs >>= kLanes) {
            const auto ours = hn::TestBit(hn::Set(d, runs), bits);
            hn::StoreU(hn::IfThenElse(ours, hn::Iota(d, i - distance), hn::LoadU(d, scratch.sources + i)), d, scratch.sources + i);
            int8_t* valid = reinterpret_cast<int8_t*>(scratch.valid + i);
            hn::StoreU(hn::DemoteTo(d8, hn::VecFromMask(d, ours)) | hn::LoadU(d8, valid), d8, valid);
        }
    }
}

struct Walkers {
    const uint8_t* chunk;
    size_t limit;
    size_t bounds[kWalkers];
    // How many it took to get there. Zero until then.
    size_t rounds[kWalkers];
    State& state;
    ParseScratch& scratch;
};

// For a long match, or none at all. Returns where it ends.
static HWY_NOINLINE __attribute__((preserve_most)) size_t GoFar(Walkers& all, size_t walker, size_t round, size_t at)
{
    ParseScratch& scratch = all.scratch;
    const size_t i = walker * kRounds + round;
    if (all.rounds[walker])
        return at + 1;
    if (const size_t distance = at - scratch.found[i]) {
        at = std::max(at + 1, MatchEnd(all.chunk, at + 1 + kSpan, distance, all.limit));
        if (distance > kFar && distance != all.state.favorite)
            Continue(all.chunk, at, all.bounds[walker], all.state.favorite = distance, all.state.trust, scratch);
        return at;
    }
    while (Zeros(scratch.valid + at + 1) == kSpan)
        at += kSpan;
    scratch.probes[i] = scratch.found[i] = at;
    scratch.equal_before[i] = 0;
    return at + 1;
}

// Follows a match to its end, takes the candidate that has the first byte after it, and so on.
static HWY_NOINLINE void Walk(const uint8_t* chunk, size_t first, size_t length, size_t limit, size_t reach, State& state, ParseScratch& scratch, size_t (&rounds)[kWalkers])
{
    for (size_t i = length; i < length + 64; i += kLanes)
        hn::StoreU(hn::Iota(DI32(), i), DI32(), scratch.sources + i);
    memset(scratch.valid + length, 0xFF, 64);
    Walkers all { chunk, limit, {}, {}, state, scratch };
    size_t at[kWalkers];
    HWY_UNROLL(8)
    for (size_t w = 0; w < kWalkers; ++w) {
        at[w] = first + (length - first) * w / kWalkers;
        all.bounds[w] = first + (length - first) * (w + 1) / kWalkers;
    }
    for (size_t i = first; state.favorite - 1 < reach && i < length; i += 256)
        Continue(chunk, i, std::min(i + 256, length), state.favorite, state.trust, scratch);
    for (size_t round = 0, busy = kWalkers; busy;) {
        HWY_UNROLL(8)
        for (size_t w = 0; w < kWalkers; ++w) {
            at[w] += Zeros(scratch.valid + at[w]);
            scratch.probes[w * kRounds + round] = at[w];
        }
        uint32_t equal[kWalkers];
        HWY_UNROLL(8)
        for (size_t w = 0; w < kWalkers; ++w) {
            const ptrdiff_t source = scratch.found[w * kRounds + round] = scratch.sources[at[w]];
            equal[w] = Equal(chunk + at[w] + 1, chunk + source + 1);
            scratch.equal_before[w * kRounds + round] = Equal(chunk + at[w] + 1 - kSpan, chunk + source + 1 - kSpan);
        }
        HWY_UNROLL(8)
        for (size_t w = 0; w < kWalkers; ++w) {
            at[w] = HWY_UNLIKELY(!++equal[w]) ? GoFar(all, w, round, at[w]) : at[w] + 1 + __builtin_ctz(equal[w]);
            scratch.reaches[w * kRounds + round] = at[w];
        }
        ++round;
        HWY_UNROLL(8)
        for (size_t w = 0; w < kWalkers; ++w) {
            // It keeps the others company.
            if (HWY_UNLIKELY(at[w] >= all.bounds[w])) {
                busy -= !all.rounds[w];
                all.rounds[w] = all.rounds[w] ? all.rounds[w] : round;
                all.bounds[w] = length;
                at[w] = 0;
            }
        }
    }
    memcpy(rounds, all.rounds, sizeof rounds);
}

static HWY_NOINLINE __attribute__((preserve_most)) size_t GoFarInList(Walkers& all, size_t walker, size_t round, size_t k)
{
    if (all.rounds[walker])
        return k + 1;
    ParseScratch& scratch = all.scratch;
    const size_t at = scratch.starts[k], end = std::max(at + 1, MatchEnd(all.chunk, at + 1 + kSpan, at - scratch.sources[k], all.limit));
    scratch.reaches[walker * kRounds + round] = end;
    if (at - scratch.sources[k] > kFar && !all.state.trust)
        all.state.favorite = at - scratch.sources[k];
    while (static_cast<size_t>(scratch.starts[k + 16]) < end)
        k += 16;
    return k + Below(scratch.starts + k, end);
}

static HWY_NOINLINE void WalkList(const uint8_t* chunk, size_t first, size_t limit, State& state, ParseScratch& scratch, size_t (&rounds)[kWalkers])
{
    const int16_t* const positions = scratch.starts;
    const size_t count = scratch.listed;
    std::fill_n(scratch.starts + count, 32, INT16_MAX);
    Walkers all { chunk, limit, {}, {}, state, scratch };
    size_t skipped = 0, at[kWalkers];
    while (static_cast<size_t>(positions[skipped]) < first)
        ++skipped;
    HWY_UNROLL(8)
    for (size_t w = 0; w < kWalkers; ++w) {
        at[w] = skipped + (count - skipped) * w / kWalkers;
        all.bounds[w] = skipped + (count - skipped) * (w + 1) / kWalkers;
    }
    for (size_t round = 0, busy = count == skipped ? 0 : kWalkers; busy;) {
        uint32_t equal[kWalkers];
        HWY_UNROLL(8)
        for (size_t w = 0; w < kWalkers; ++w) {
            const size_t probe = scratch.probes[w * kRounds + round] = positions[at[w]];
            const ptrdiff_t source = scratch.found[w * kRounds + round] = scratch.sources[at[w]];
            equal[w] = Equal(chunk + probe + 1, chunk + source + 1);
            scratch.equal_before[w * kRounds + round] = Equal(chunk + probe + 1 - kSpan, chunk + source + 1 - kSpan);
        }
        HWY_UNROLL(8)
        for (size_t w = 0; w < kWalkers; ++w) {
            if (HWY_UNLIKELY(!++equal[w]))
                at[w] = GoFarInList(all, w, round, at[w]);
            else
                at[w] += 1 + Below(positions + at[w] + 1, scratch.reaches[w * kRounds + round] = positions[at[w]] + 1 + __builtin_ctz(equal[w]));
        }
        ++round;
        HWY_UNROLL(8)
        for (size_t w = 0; w < kWalkers; ++w) {
            if (HWY_UNLIKELY(at[w] >= all.bounds[w])) {
                busy -= !all.rounds[w];
                all.rounds[w] = all.rounds[w] ? all.rounds[w] : round;
                all.bounds[w] = count;
                at[w] = 0;
            }
        }
    }
    memcpy(rounds, all.rounds, sizeof rounds);
}

// Puts the matches in order, and finds where they start. Returns the index after the last one.
static HWY_NOINLINE size_t LookBack(const uint8_t* chunk, size_t at, size_t count, ptrdiff_t lowest, const size_t (&rounds)[kWalkers], ParseScratch& scratch)
{
    const DI32 d;
    const DU32 du;
    const hn::Rebind<uint16_t, DI32> du16;
    const hn::Rebind<int16_t, DI32> d16;
    size_t unfinished = 0;
    for (size_t w = 0; w < kWalkers; ++w) {
        size_t i = w * kRounds;
        const size_t to = i + rounds[w];
        while (i < to && scratch.reaches[i] <= scratch.ends[count - 1])
            ++i;
        const size_t end = count + to - i;
        for (; count < end; i += kLanes, count += kLanes) {
            const auto probe = hn::PromoteTo(d, hn::LoadU(du16, scratch.probes + i));
            const auto equal = hn::LoadU(du, scratch.equal_before + i), half = hn::ShiftRight<1>(hn::Not(equal));
            // The lowest bit does not count, and none rounds up to the highest.
            const auto exponent = hn::BitCast(d, hn::ShiftRight<23>(FloatBits(hn::AndNot(hn::ShiftRight<1>(half), half))));
            hn::StoreU(hn::DemoteTo(d16, probe + hn::Max(exponent, hn::Set(d, 126)) - hn::Set(d, 156)), d16, scratch.starts + count);
            hn::StoreU(hn::BitCast(d16, hn::LoadU(du16, scratch.reaches + i)), d16, scratch.ends + count);
            hn::StoreU(hn::BitCast(du, probe - hn::LoadU(d, scratch.found + i)), du, scratch.distances + count);
            const uint64_t all = hn::BitsFromMask(du, half == hn::Zero(du)) & ((1 << std::min(end - count, kLanes)) - 1);
            hn::StoreU(hn::PromoteTo(du16, hn::LoadU(hn::Rebind<uint8_t, DI32>(), kSetBits[all].data())) + hn::Set(du16, count), du16, scratch.list + unfinished);
            unfinished += __builtin_popcount(all);
        }
        count = end;
    }
    for (size_t round = 7; round && unfinished; --round) {
        size_t left = 0;
        for (size_t i = 0; i < unfinished; ++i) {
            const size_t node = scratch.list[i], distance = scratch.distances[node];
            const ptrdiff_t start = scratch.starts[node];
            if (HWY_UNLIKELY(at + start < distance + kSpan))
                continue;
            const uint32_t back = LeadingZeros(~Equal(chunk + start - kSpan, chunk + start - kSpan - distance));
            scratch.starts[node] = start - back;
            scratch.list[left] = node;
            left += (back / kSpan) & (start - static_cast<ptrdiff_t>(kSpan) > lowest);
        }
        unfinished = left;
    }
    return count;
}

constexpr size_t kPathStart = 2, kPathEnd = kPath - 16;

// The matches that save the most, where each may lose its start to the one before. Returns the index of the first. They end at `kPathEnd`.
static HWY_NOINLINE size_t Choose(size_t at, size_t available, size_t count, ptrdiff_t lowest, size_t limit, int32_t literal_cost, ParseScratch& scratch)
{
    const DI16 d16;
    const DI32 d;
    const hn::Half<DI16> dh;
    constexpr size_t kLanes16 = 2 * kLanes;
    constexpr int32_t kNodeMask = (1 << kNodeBits) - 1;
    const auto fixed = hn::Set(d, 33 - 127 * 4), repeated = hn::Set(d, 50), before = hn::Set(d, available);
    const auto per_literal = hn::Set(d, literal_cost << kNodeBits);
    auto index = hn::Iota(d16, kFirstNode);
    for (size_t k = kFirstNode; k < count; k += kLanes16, index += hn::Set(d16, kLanes16)) {
        const int32_t* distances = reinterpret_cast<const int32_t*>(scratch.distances + k);
        const auto low = hn::LoadU(d, distances), high = hn::LoadU(d, distances + kLanes);
        const auto end = hn::Min(hn::LoadU(d16, scratch.ends + k), hn::Set(d16, limit));
        const auto start = hn::Max(hn::Max(hn::LoadU(d16, scratch.starts + k), hn::Set(d16, lowest)), hn::Min(hn::OrderedDemote2To(d16, low - before, high - before), end));
        hn::StoreU(start, d16, scratch.starts + k);
        const auto seen = hn::Max(start, hn::LoadU(d16, scratch.ends + k - kLookBack - 1)), below = seen - hn::Set(d16, 1);
        auto first = index;
        for (size_t back = 1; back <= kLookBack; ++back)
            first += hn::VecFromMask(d16, hn::LoadU(d16, scratch.ends + k - back) > below);
        hn::StoreU(first, d16, reinterpret_cast<int16_t*>(scratch.first + k));
        const auto too_short = hn::IfThenElseZero(end - start < hn::Set(d16, 3), hn::Set(d16, 1000));
        const auto half = [&](size_t i, VI32 distance, auto seen, auto end, auto penalty, auto index) HWY_ATTR __attribute__((always_inline)) {
            hn::StoreU(hn::PromoteTo(d, seen) * per_literal, d, scratch.at_start + i);
            hn::StoreU(hn::PromoteTo(d, end) * per_literal, d, scratch.at_end + i);
            const int32_t* others = reinterpret_cast<const int32_t*>(scratch.distances + i);
            const auto same = hn::Or(hn::Or(distance == hn::LoadU(d, others - 1), distance == hn::LoadU(d, others - 2)), distance == hn::LoadU(d, others - 3));
            const auto cost = hn::Min(hn::IfThenZeroElse(same, hn::Set(d, 256)) | repeated, hn::ShiftLeft<2>(hn::ShiftRight<23>(hn::BitCast(d, hn::ConvertTo(DF32(), distance)))) + fixed);
            hn::StoreU(hn::PromoteTo(d, index) - hn::ShiftLeft<kNodeBits>(cost + hn::PromoteTo(d, penalty)), d, scratch.cost + i);
            hn::StoreU(hn::Set(d, INT32_MIN), d, scratch.base + i);
        };
        half(k, low, hn::LowerHalf(dh, seen), hn::LowerHalf(dh, end), hn::LowerHalf(dh, too_short), hn::LowerHalf(dh, index));
        half(k + kLanes, high, hn::UpperHalf(dh, seen), hn::UpperHalf(dh, end), hn::UpperHalf(dh, too_short), hn::UpperHalf(dh, index));
    }
    const auto step = [&](size_t k, int32_t& best) HWY_ATTR __attribute__((always_inline)) {
        const size_t first = scratch.first[k];
        const int32_t before = std::max(scratch.base[first], scratch.best[first - 1] - scratch.at_start[k]);
        scratch.previous[k] = before;
        const int32_t base = (before & ~kNodeMask) + scratch.cost[k];
        scratch.base[k] = base;
        scratch.best[k] = best = std::max(best, base + scratch.at_end[k]);
    };
    // Two halves at once, the second of which starts after a gap if there is one.
    int32_t best[2] = {};
    size_t k = kFirstNode, middle = count;
    scratch.best[kFirstNode - 1] = 0;
    if (count >= kFirstNode + 96) {
        middle = (kFirstNode + count + 1) / 2;
        for (size_t tries = 24; tries && scratch.first[middle] != middle; --tries)
            ++middle;
        scratch.best[middle - 1] = 0;
        for (size_t i = middle; i < middle + kLookBack; ++i) {
            if (scratch.first[i] < middle) {
                scratch.first[i] = middle;
                scratch.at_start[i] = scratch.at_end[middle - 1];
            }
        }
        for (const size_t apart = middle - kFirstNode; k + apart < count; ++k) {
            step(k, best[1]);
            step(k + apart, best[0]);
        }
    }
    for (; k < middle; ++k)
        step(k, best[1]);
    Path& path = scratch.paths[0];
    size_t i = kPathEnd - 1;
    int32_t most = limit;
    for (const int32_t last : best) {
        for (size_t node = last & kNodeMask; node; node = scratch.previous[node] & kNodeMask) {
            const int32_t start = scratch.starts[node], end = std::min<int32_t>(scratch.ends[node], most);
            most = end - 2;
            path.starts[i] = at + start;
            path.ends[i] = at + end;
            path.distances[i] = scratch.distances[node];
            i -= start <= most;
        }
    }
    return i + 1;
}

static HWY_NOINLINE uint64_t LongCommand(uint32_t insert, uint32_t copy)
{
    uint32_t insert_code = 0, copy_code = 0;
    for (; insert >> kInsertBits[insert_code]; ++insert_code)
        insert -= 1 << kInsertBits[insert_code];
    for (copy -= 2; copy >> kCopyBits[copy_code]; ++copy_code)
        copy -= 1 << kCopyBits[copy_code];
    constexpr uint8_t kCells[3][3] = { { 2, 3, 6 }, { 4, 5, 8 }, { 7, 9, 10 } };
    const uint32_t cell = kCells[insert_code / 8][copy_code / 8];
    const uint32_t symbol = cell << 6 | insert_code % 8 << 3 | copy_code % 8;
    const uint64_t extra = insert | uint64_t { copy } << kInsertBits[insert_code];
    return extra << 1 << (63 - kCommandBits[symbol]) | symbol;
}

static HWY_NOINLINE uint64_t FarDistance(uint32_t postfix_bits, uint32_t direct_codes, uint32_t distance)
{
    const uint32_t past = distance - 1 - direct_codes, high = (past >> postfix_bits) + 4, bits = Log2(high) - 1;
    const uint32_t group = 2 * bits + (high >> bits) - 4;
    return uint64_t { high } << (64 - bits) | (16 + direct_codes + (group << postfix_bits) + (past & ((1 << postfix_bits) - 1)));
}

constexpr uint32_t kWord = 1u << 31;

// The symbols at the bottom, and the extra bits at the top.
static HWY_NOINLINE void Encode(const Settings& settings, const Memory& memory, const Path& path, size_t from, size_t count, const ParseScratch& scratch, State& state)
{
    const DU32 d;
    const DI32 di;
    const DU8 d8;
    const auto n = [&](uint32_t value) HWY_ATTR { return hn::Set(d, value); };
    const auto below = [&](VU32 a, uint32_t b) HWY_ATTR { return hn::RebindMask(d, hn::BitCast(di, a) < hn::Set(di, b)); };
    const auto look_up = [&](hn::Vec<DU8> table, VU32 index) HWY_ATTR { return hn::BitCast(d, hn::TableLookupBytes(table, hn::BitCast(d8, index))); };
    const auto cells = hn::Dup128VecFromValues(d8, 0, 1, 4, 0, 2, 3, 6, 0, 5, 7, 8, 0, 0, 0, 0, 0);
    // By the difference plus 4, or 0.
    const auto near_last = hn::Dup128VecFromValues(d8, 16, 8, 6, 4, 0, 5, 7, 9, 16, 0, 0, 0, 0, 0, 0, 0);
    const auto near_second = hn::Dup128VecFromValues(d8, 16, 14, 12, 10, 1, 11, 13, 15, 16, 0, 0, 0, 0, 0, 0, 0);
    uint64_t *commands = memory.commands + state.now.commands, *distances = memory.distances + state.now.commands;
    const int postfix = settings.postfix_bits[state.kind];
    for (size_t i = 0; i < count; i += kLanes) {
        // `starts` has the lengths by now.
        const auto insert = hn::Load(d, scratch.inserts + i), copy = hn::LoadU(d, path.starts + from + i), marked = hn::LoadU(d, path.distances + from + i);
        const auto distance = marked & n(~kWord);
        VU32 last, second, third, fourth;
        hn::LoadInterleaved4(d, scratch.recent + 4 * i, last, second, third, fourth);
        const auto plus4 = marked + n(4);
        auto code = hn::Min(look_up(near_last, hn::Min(plus4 - last, n(8))), look_up(near_second, hn::Min(plus4 - second, n(8)))) & n(0xFF);
        code = hn::Min(code, hn::IfThenElse(marked == third, n(2), hn::IfThenElse(marked == fourth, n(3), n(16))));
        const auto past = distance - n(settings.direct_codes + 1), high = hn::ShiftRightSame(past, postfix) + n(4), far = FloatBits(high);
        const auto is_short = below(code, 16), is_direct = below(past, 0);
        auto distance_symbol = hn::ShiftLeftSame(hn::ShiftRight<22>(far) - n(258), postfix) + (past & n((1 << postfix) - 1));
        distance_symbol = hn::IfThenElse(is_short, code, hn::IfThenElse(is_direct, past, distance_symbol) + n(16 + settings.direct_codes));
        const auto distance_extra = hn::IfThenZeroElse(hn::Or(is_short, is_direct), hn::ShiftLeft<10>(far));

        const auto inserted = FloatBits(hn::Max(insert, n(4)) - n(2));
        const auto insert_code = hn::Min(insert, hn::ShiftRight<22>(inserted) - n(252));
        const auto is_medium = below(copy, 134);
        const auto copied = FloatBits(hn::IfThenElse(is_medium, hn::Max(copy, n(8)) - n(6), copy - n(70))), exponent = hn::ShiftRight<23>(copied);
        const auto copy_code = hn::IfThenElse(is_medium, hn::Min(copy - n(2), hn::ShiftRight<22>(copied) - n(250)), exponent - n(115));
        const auto copy_extra = hn::IfThenElse(is_medium, hn::ShiftLeft<10>(copied), hn::ShiftLeft<9>(copied));
        const auto copy_bits = exponent - n(127) + hn::VecFromMask(d, is_medium);
        const auto cell = look_up(cells, hn::ShiftRight<1>(insert_code & n(24)) + hn::ShiftRight<3>(copy_code));
        const auto is_implied = hn::And(code == n(0), below(cell, 2));
        const auto symbol = hn::ShiftLeft<6>(cell) + hn::IfThenZeroElse(is_implied, n(128)) + hn::ShiftLeft<3>(insert_code & n(7)) + (copy_code & n(7));
        hn::StoreInterleaved2(symbol, copy_extra | (hn::ShiftLeft<10>(inserted) >> copy_bits), d, reinterpret_cast<uint32_t*>(commands + i));
        hn::StoreInterleaved2(hn::IfThenElse(is_implied, n(kNoDistance), distance_symbol), distance_extra, d, reinterpret_cast<uint32_t*>(distances + i));
        const auto is_usual = hn::And(hn::And(below(insert, 130), below(copy, 2118)), hn::Or(below(high, 1 << 24), is_direct));
        if (HWY_UNLIKELY(!hn::AllTrue(d, is_usual))) {
            for (size_t j = i; j < std::min(count, i + kLanes); ++j) {
                if (scratch.inserts[j] >= 130 || path.starts[from + j] >= 2118) {
                    commands[j] = LongCommand(scratch.inserts[j], path.starts[from + j]);
                    if (distances[j] == kNoDistance)
                        distances[j] = 0;
                }
                if ((path.distances[from + j] & ~kWord) >= 1 << 23 && static_cast<uint32_t>(distances[j]) - 16 < kNoDistance - 16)
                    distances[j] = FarDistance(postfix, settings.direct_codes, (path.distances[from + j] & ~kWord));
            }
        }
    }
    Counts& counts = state.After();
    if (!state.now.commands)
        counts = {};
    HWY_UNROLL(2)
    for (size_t i = 0; i < count; ++i) {
        ++counts.commands[static_cast<uint16_t>(commands[i])];
        ++counts.distances[static_cast<uint16_t>(distances[i])];
    }
    state.now.commands += count;
}

// Reads nothing outside of the input.
static HWY_NOINLINE void GatherCarefully(const Input& input, size_t from, size_t to, uint32_t* literals)
{
    const auto byte = [&](size_t at, size_t back) -> uint32_t { return at >= back && input.base + at >= back ? input.bytes[at - back] : 0; };
    for (; from < to && (from < 2 || input.base + from < 2); ++from)
        *literals++ = byte(from, 2) | byte(from, 1) << 8 | byte(from, 0) << 16;
    for (; from < to && from + 14 <= input.size; from += kLanes, literals += kLanes)
        hn::StoreU(Windows(input.bytes + from - 2), DU32(), literals);
    for (; from < to; ++from)
        *literals++ = byte(from, 2) | byte(from, 1) << 8 | byte(from, 0) << 16;
}

// Of a word, `distances` has the length above the address.
constexpr uint32_t kAddressBits = 26;

static HWY_NOINLINE void Emit(const Settings& settings, const Memory& memory, const Input& input, Path& path, size_t from, size_t to, ParseScratch& scratch, State& state)
{
    const DU32 d;
    const size_t count = to - from;
    const uint32_t* const previous_ends = path.ends + from - 1;
    path.ends[from - 1] = state.now.covered;
    const uint64_t offset = input.base + input.stream_offset;
    const auto base = hn::Set(d, offset + state.now.covered >= settings.max_backward ? settings.max_backward : offset);
    for (size_t i = 0; i < count; i += kLanes) {
        const auto previous = hn::LoadU(d, previous_ends + i), start = hn::Max(hn::LoadU(d, path.starts + from + i), previous);
        const auto distance = hn::LoadU(d, path.distances + from + i);
        const auto is_word = hn::RebindMask(d, hn::IsNegative(hn::BitCast(DI32(), distance)));
        const auto past_window = hn::Min(start + base, hn::Set(d, settings.max_backward)) + (distance & hn::Set(d, (1 << kAddressBits) - 1)) + hn::Set(d, kWord + settings.first_word);
        hn::Store(start - previous, d, scratch.inserts + i);
        hn::StoreU(hn::IfThenElse(is_word, hn::ShiftRight<kAddressBits>(distance) & hn::Set(d, 31), hn::LoadU(d, previous_ends + i + 1) - start), d, path.starts + from + i);
        hn::StoreU(hn::IfThenElse(is_word, past_window, distance), d, path.distances + from + i);
    }
    const hn::Full128<int32_t> d4;
    const uint8_t* const before = input.bytes - 2;
    auto recent = hn::Load(d4, reinterpret_cast<int32_t*>(state.last));
    size_t literal_count = state.now.literals;
    uint16_t* const literal_ends = memory.literal_ends + state.now.commands;
    uint32_t* const literals = memory.literals;
    // Only the first can be at the start.
    size_t few = input.base + state.now.covered < 2 || state.now.covered < 2 ? 0 : 9;
    for (size_t i = 0; i < count; ++i, few = 9) {
        const size_t at = previous_ends[i], insert = scratch.inserts[i];
        if (HWY_UNLIKELY(insert >= few)) {
            GatherCarefully(input, at, at + insert, literals + literal_count);
        } else {
            for (size_t j = 0; j < 8; j += kLanes)
                hn::StoreU(Windows(before + at + j), d, literals + literal_count + j);
        }
        literal_ends[i] = literal_count += insert;
        hn::Store(recent, d4, reinterpret_cast<int32_t*>(scratch.recent + 4 * i));
        const auto ours = hn::Set(d4, path.distances[from + i]);
        recent = hn::IfNegativeThenElse(hn::VecFromMask(d4, hn::Broadcast<0>(recent) == ours) | ours, recent, hn::CombineShiftRightBytes<12>(d4, recent, ours));
    }
    hn::Store(recent, d4, reinterpret_cast<int32_t*>(state.last));
    state.now.covered = previous_ends[count];
    state.now.literals = literal_count;
    Encode(settings, memory, path, from, count, scratch, state);
}

struct Recent {
    size_t last, second;

    HWY_INLINE void Add(size_t distance)
    {
        second = distance == last ? second : last;
        last = distance;
    }
};

// Of bits in a row, at least two or three.
static HWY_INLINE uint32_t Runs(uint32_t bits, uint32_t least)
{
    const uint32_t starts = bits & bits >> 1 & bits >> (least - 1);
    return starts | starts << 1 | starts << (least - 1);
}

static HWY_INLINE uint32_t Matches(const Input& input, size_t at, size_t distance)
{
    const size_t early = std::clamp<ptrdiff_t>(input.origin + distance - at, 0, kSpan);
    return distance - 1 < at ? Runs(Equal(input.bytes + at, input.bytes + at - distance) & ~uint64_t { 0 } << early, 2) : 0;
}

static HWY_INLINE size_t AddRuns(size_t at, uint32_t first, uint32_t second, Recent distances, Recent& recent, Path& out, size_t count)
{
    for (uint32_t left = first | second; left;) {
        const size_t start = __builtin_ctz(left);
        const bool is_first = first >> start & 1;
        const size_t after = start + __builtin_ctzll(~uint64_t { (is_first ? first : second) >> start });
        recent.Add(is_first ? distances.last : distances.second);
        out.starts[count] = at + start;
        out.ends[count] = at + after;
        out.distances[count++] = recent.last;
        left &= ~uint64_t { 0 } << after;
    }
    return count;
}

// Looks for short copies among many literals, as in an array of numbers. Leaves less than `least` bytes before `end`.
static HWY_NOINLINE size_t FillGap(const Input& input, size_t& at, size_t end, size_t least, Recent& recent, Path& out, size_t count, State& state)
{
    while (at + least <= end) {
        Recent tried { state.stride, recent.last == state.stride ? recent.second : recent.last };
        uint32_t first = Matches(input, at, tried.last), second = Matches(input, at, tried.second);
        if (__builtin_popcount(second) > __builtin_popcount(first) + 3) {
            std::swap(first, second);
            tried.Add(state.stride = tried.second);
        }
        const size_t length = std::min(end - at, kSpan), before = count;
        const uint32_t inside = __builtin_popcount(first) < 4 ? 0 : (uint64_t { 1 } << length) - 1;
        count = AddRuns(at, Runs(first & inside, 2), Runs(second & ~first & inside, 3), tried, recent, out, count);
        at += length;
        if (count != before && out.ends[count - 1] == at)
            out.ends[count - 1] = at = MatchEnd(input.bytes, at, recent.last, end);
        else
            --at;
    }
    return count;
}

// A bit for each match after the first that `Repeat` has to look at even if it leaves those before alone.
static HWY_NOINLINE void FindPromising(const uint8_t* bytes, const Path& path, size_t from, size_t to, Recent recent, bool is_binary, ParseScratch& scratch)
{
    for (size_t i = from + 1; i < to; ++i) {
        recent.Add(path.distances[i - 1]);
        const uint8_t* const at = bytes + path.ends[i - 1];
        scratch.seconds[i] = recent.second;
        scratch.equal[i] = Equal(at, at - recent.last);
        scratch.other[i] = Equal(at, at - recent.second);
    }
    const DU32 d;
    const auto n = [&](uint32_t value) HWY_ATTR { return hn::Set(d, value); };
    for (size_t i = (from + 1) & ~size_t { 7 }; i < to; i += 8) {
        uint32_t dull = 0;
        for (size_t j = i; j < i + 8; j += kLanes) {
            const auto at = hn::LoadU(d, path.ends + j - 1), start = hn::Max(hn::LoadU(d, path.starts + j), at), gap = hn::Min(start - at, n(31));
            const auto length = hn::LoadU(d, path.ends + j) - start, distance = hn::LoadU(d, path.distances + j);
            const auto equal = hn::Load(d, scratch.equal + j), other = hn::Load(d, scratch.other + j);
            const auto first = n(1) << gap, inside = first - n(1), some = equal & inside, more = other & inside & n(-is_binary);
            // Without both ends.
            const auto needed = (n(1) << hn::Min(gap + length - n(1), n(31))) - first - first;
            const auto covers = hn::Or(hn::AndNot(equal, needed) == n(0), hn::AndNot(distance == hn::Load(d, scratch.seconds + j), hn::AndNot(other, needed) == n(0)));
            const auto runs = (some & hn::ShiftRight<1>(some) & hn::ShiftRightSame(some, 2 - is_binary)) | (more & hn::ShiftRight<1>(more) & hn::ShiftRight<2>(more));
            dull |= hn::BitsFromMask(d, hn::AndNot(hn::Or(hn::AndNot(distance == hn::LoadU(d, path.distances + j - 1), covers), gap == n(31)), runs == n(0))) << j % 8;
        }
        scratch.promising[i / 8] = ~dull;
    }
}

static HWY_INLINE void CopyMatches(const Path& path, size_t from, size_t count, Path& out, size_t to)
{
    const DU32 d;
    size_t i = 0;
    do {
        hn::StoreU(hn::LoadU(d, path.starts + from + i), d, out.starts + to + i);
        hn::StoreU(hn::LoadU(d, path.ends + from + i), d, out.ends + to + i);
        hn::StoreU(hn::LoadU(d, path.distances + from + i), d, out.distances + to + i);
    } while ((i += kLanes) < count);
}

// Tries the last two distances. Returns where the result ends in `out`, where it starts at `kPathStart`.
static HWY_NOINLINE size_t Repeat(const Settings& settings, const Input& input, size_t begin, size_t stop, const Path& path, size_t from, size_t to, Path& out, ParseScratch& scratch, State& state)
{
    const uint8_t* const bytes = input.bytes;
    size_t at = state.now.covered, count = kPathStart, tried = to - from, used = 0;
    const auto within_reach = [](Recent any, size_t reach) { return Recent { any.last <= reach ? any.last : 0, any.second <= reach ? any.second : 0 }; };
    Recent recent = within_reach({ state.last[0], state.last[1] }, std::min<size_t>(Reach(settings, input), at - input.origin));
    const auto fill = [&](size_t end, size_t least) HWY_ATTR {
        at = std::max(at, std::min(begin, end + 1) - kSpan);
        tried += (end - at) / 8;
        used -= count;
        used += count = FillGap(input, at, end, least, recent, out, count, state);
    };
    state.stride = std::min(state.stride, Reach(settings, input));
    size_t strides = 0;
    for (size_t i = 1; i < 16; i += 2) {
        const uint32_t matches = Matches(input, begin + (stop - begin) * i / 16, state.stride);
        strides += __builtin_popcount(matches & ~(matches << 1));
    }
    const bool has_stride = strides >= 24;
    const uint32_t least = state.is_binary || has_stride ? 2 : 3, others = state.is_binary ? ~0u : 0;
    if (!has_stride)
        FindPromising(bytes, path, from, to, recent, state.is_binary, scratch);
    for (; from < to; ++from) {
        size_t start = std::max<size_t>(path.starts[from], at), end = path.ends[from], distance = path.distances[from];
        const uint32_t within = (uint64_t { 1 } << std::min(end - start, kSpan)) - 1;
        if (has_stride && start >= begin && end - start < 10 && __builtin_popcount(~Matches(input, start - 1, state.stride) >> 1 & within) <= 2) {
            recent = { state.stride, distance };
            continue;
        }
        if (HWY_UNLIKELY(start >= at + kSpan))
            fill(start, kSpan);
        if (has_stride) {
            recent.Add(state.stride);
            recent = within_reach(recent, at - input.origin);
        }
        const size_t gap = start - at, last = recent.last, second = recent.second;
        const uint32_t equal = Equal(bytes + at, bytes + at - last), other = Equal(bytes + at, bytes + at - second), inside = (1u << gap) - 1;
        const uint32_t some = equal & inside, more = other & inside & others;
        // A literal costs less than a new distance.
        const uint32_t needed = ((end - start >= 4) & (distance != second)) ? within >> 1 & ~1u : within;
        const bool covers = !(~equal >> gap & needed), other_covers = !(~other >> gap & needed) & (distance != second);
        if (HWY_UNLIKELY(((covers | other_covers) & (distance != last)) | (((some & some >> 1 & some >> (least - 1)) | (more & more >> 1 & more >> 2)) != 0))) {
            ++used;
            const auto replace = [&](size_t by, uint32_t same) HWY_ATTR {
                const size_t late = ~same >> gap & 1, reach = MatchEnd(bytes, start + 1, by, end);
                if (!by || late + end - reach > (needed != within))
                    return false;
                start = late ? start + 1 : start - std::min<size_t>(gap, LeadingZeros(~(same << 1 << (kSpan - 1 - gap))));
                end = reach;
                distance = by;
                return true;
            };
            if (distance != last && end - start < kChunk && !(covers && replace(last, equal)) && other_covers)
                replace(second, other);
            const uint32_t left = (uint64_t { 1 } << (start - at)) - 1, runs = last ? Runs(some & left, least) : 0;
            count = AddRuns(at, runs, second ? Runs(more & left & ~runs, 3) : 0, recent, recent, out, count);
        }
        out.starts[count] = start;
        out.ends[count] = at = end;
        out.distances[count++] = distance;
        recent.Add(distance);
        if (const size_t next = from + 1; !has_stride && next + 1 < to && ((at == path.ends[from]) & (distance == path.distances[from]) & (recent.second == scratch.seconds[next]))) {
            const size_t skipped = std::min<size_t>(__builtin_ctzll(Read<uint64_t>(scratch.promising + next / 8) >> next % 8 | uint64_t { 1 } << 56), to - 1 - next);
            CopyMatches(path, next, skipped, out, count);
            count += skipped;
            from += skipped;
            at = path.ends[from];
            recent = { path.distances[from], scratch.seconds[from + 1] };
        }
    }
    if (stop >= at + 2)
        fill(stop, 2);
    state.repeats_after = used * settings.repeat_gain + 48 < tried ? 8 : 0;
    return count;
}

// How many bytes to skip until `distance` matches again.
static HWY_INLINE size_t Pause(const uint8_t* at, size_t distance)
{
    const uint32_t equal = Equal(at, at - distance), two = equal & equal >> 1;
    return __builtin_ctz((two & two >> 2 & two >> 4) | 1 << 8);
}

// Replaces matches by others that go on where those meet. Returns where the result ends in `out`, where it starts at `kPathStart`.
static HWY_NOINLINE size_t Join(const Settings& settings, const Memory& memory, const Input& input, size_t limit, size_t stop, int32_t literal_cost, Path& path, size_t from, size_t to, Path& out, State& state)
{
    const uint8_t* const bytes = input.bytes;
    const bool is_first = !state.has_seams;
    if (is_first)
        memset(memory.seams, 0, 4 * ((1 << settings.seam_bits) + 16));
    // Some that depend on the place, and then the latest.
    constexpr size_t kLatest = 4;
    uint32_t tried[16];
    memcpy(tried, memory.seams + (1 << settings.seam_bits), sizeof tried);
    state.has_seams = true;
    constexpr int32_t kRepeated = 28;
    const auto cost = [&](uint32_t distance, const uint32_t* a, const uint32_t* b) -> int32_t { return distance == *a ? kRepeated : distance == *b ? 36
                                                                                                                                                   : 40 + 4 * Log2(distance | 1); };
    const auto hash = [&](size_t at) { return Read<uint64_t>(bytes + at - 8) * 0x9E3779B97F4A7C15 + Read<uint64_t>(bytes + at) * 0xC2B2AE3D27D4EB4F; };
    const size_t lowest = std::max<size_t>(state.now.covered, input.origin + kSpan);
    size_t count = kPathStart, next = from;
    const int32_t toll = std::min<size_t>(settings.join_toll, 2 + (to - from) / 24);
    // What it has saved, and an allowance, less the effort. The first time, there is little to find.
    const int32_t allowance = 12 * toll, failures = tried[1];
    int32_t credit = std::min<int32_t>((is_first ? (to - from > 128 ? -allowance - 1 : 4 * allowance) : tried[0]) + std::max<int32_t>(allowance, (200 - 3 * (to - from)) * toll), 1500);
    out.ends[count - 1] = state.now.covered;
    out.distances[0] = path.distances[from - 2] = state.last[1], out.distances[1] = path.distances[from - 1] = state.last[0];
    if (credit >= 0)
        path.ends[to - 1] = MatchEnd(bytes, path.ends[to - 1], path.distances[to - 1], stop);
    path.distances[to] = 0;
    while (next < to && credit >= 0) {
        out.starts[count] = std::max(path.starts[next], out.ends[count - 1]);
        out.ends[count] = path.ends[next];
        out.distances[count++] = path.distances[next++];
        for (size_t at; (at = out.ends[count - 1]) + 8 <= stop && at >= lowest;) {
            const uint32_t distance = out.distances[count - 1], position = input.base + at;
            const uint64_t near = hash(at);
            const uint64_t far = near + (distance | uint64_t { at - out.starts[count - 1] } << 32) * 0x165667B19E3779F9;
            tried[0] = position - std::exchange(memory.seams[near >> (64 - settings.seam_bits)], position);
            tried[1] = position - std::exchange(memory.seams[far >> (64 - settings.seam_bits)], position);
            credit -= toll;
            tried[2] = distance + path.distances[next];
            tried[3] = tried[kLatest] + distance;
            uint32_t moved = distance;
            for (size_t i = kLatest; i < 16 && (std::swap(tried[i], moved), moved != distance); ++i) {
            }
            const size_t reach = std::min<size_t>(at - input.origin - kSpan, settings.max_backward);
            const size_t early = std::min(std::max<size_t>(out.starts[count - 1] + 1, at - kSpan), at - 2), late = next < to ? path.ends[next] - 5 : at;
            const auto same = [&](size_t i, size_t other) { return Read<uint32_t>(bytes + i) == Read<uint32_t>(bytes + i - other); };
            uint32_t good = (distance - 1 < reach && Pause(bytes + at, distance) < 8) << kLatest;
            HWY_UNROLL(16)
            for (size_t i = 0; i < 16; ++i) {
                const bool is_valid = tried[i] - 1 < reach;
                good |= (is_valid & same(at - 2, is_valid ? tried[i] : 0)) << i;
            }
            int32_t best = 16;
            size_t first = 0, last = 0;
            Match chosen {};
            for (; good; good &= good - 1) {
                const uint32_t other = tried[__builtin_ctz(good)];
                if (other == path.distances[next] || !(same(early, other) | same(late, other)))
                    continue;
                const size_t floor = std::max(lowest, input.origin + other + kSpan);
                size_t start = at, before = count, after = next, end = at;
                int32_t gain = 0;
                if (other != distance) {
                    if (other == chosen.distance || (chosen.end > at + 64 && Read<uint64_t>(bytes + chosen.end - 7) != Read<uint64_t>(bytes + chosen.end - 7 - other)))
                        continue;
                    end = MatchEnd(bytes, at, other, stop);
                    const size_t own = out.starts[count - 1] + 1;
                    for (size_t back = own + 4 * kSpan > at || (own >= floor && !~Equal(bytes + own, bytes + own - other)) ? kSpan : 0; back == kSpan && start > floor && at - start < 8 * kChunk; start -= back)
                        back = LeadingZeros(~Equal(bytes + start - kSpan, bytes + start - kSpan - other));
                    start = std::min(std::max(start, floor), at);
                    for (; before > kPathStart && out.starts[before - 1] + 1 >= start; --before)
                        gain += cost(out.distances[before - 1], out.distances + before - 2, out.distances + std::max<size_t>(before, 3) - 3) + (out.starts[before - 1] - std::max<ptrdiff_t>(out.ends[before - 2], start)) * literal_cost;
                    gain -= cost(other, out.distances + before - 1, out.distances + before - 2);
                }
                for (ptrdiff_t covered = at, most = gain;;) {
                    for (; after < to && path.ends[after] <= end + 1; covered = path.ends[after++])
                        gain += cost(path.distances[after], path.distances + after - 1, path.distances + after - 2) + std::max<ptrdiff_t>(path.starts[after] - covered, 0) * literal_cost;
                    // Past the path, there would be another match.
                    const int32_t all = gain + (std::min<ptrdiff_t>(end, after < to ? std::max<ptrdiff_t>(path.starts[after], covered) : covered + 4) - covered) * literal_cost;
                    if (all + (end > chosen.end) > best && end >= at + 2 && (at <= limit || before < count)) {
                        best = all, first = before, last = after;
                        chosen = { static_cast<uint32_t>(start), static_cast<uint32_t>(end), other };
                    }
                    credit -= toll;
                    most = std::max<ptrdiff_t>(most, all);
                    const size_t pause = Pause(bytes + end, other);
                    if (pause == 8 || end + 16 > limit || all + 80 < most)
                        break;
                    gain -= kRepeated + pause * literal_cost;
                    end = std::max(end + 6, MatchEnd(bytes, end + pause, other, stop));
                }
            }
            if (!chosen.distance)
                break;
            credit += best;
            count = first, next = last;
            size_t start = std::max(chosen.start, out.ends[count - 1]);
            if (chosen.distance == distance)
                start = at += std::min(Pause(bytes + at, distance), chosen.end - 2 - at);
            for (;; start = at += std::min(Pause(bytes + at, chosen.distance), chosen.end - 2 - at)) {
                at = std::max(at + 2, MatchEnd(bytes, at, chosen.distance, chosen.end));
                at = at + 6 > chosen.end || at + 16 > limit ? chosen.end : at;
                out.starts[count] = start;
                out.ends[count] = at;
                out.distances[count++] = chosen.distance;
                if (at == chosen.end)
                    break;
            }
            if (at > limit) {
                next = to;
                break;
            }
        }
    }
    const bool failed = next > from && next < to;
    tried[0] = failed ? -allowance * (3 << failures) : credit < 0 && credit + allowance >= 0 ? 5 * allowance
                                                                                             : credit;
    tried[1] = std::clamp(failures + failed - (credit > 8 * allowance), 0, state.is_binary ? 1 : 4);
    memcpy(memory.seams + (1 << settings.seam_bits), tried, sizeof tried);
    for (size_t i = next; i + 1 < to && path.ends[i] + 8 <= stop; ++i)
        memory.seams[hash(path.ends[i]) >> (64 - settings.seam_bits)] = input.base + path.ends[i];
    CopyMatches(path, next, to - next, out, count);
    count += to - next;
    out.ends[count - 1] = std::min<size_t>(out.ends[count - 1], std::max<size_t>({ limit, out.starts[count - 1] + 2, out.ends[count - 2] + 2 }));
    return count;
}

// Looks for a better stride among the shortest distances. Returns how many of 128 bytes it covers.
static HWY_NOINLINE size_t FindStride(const Input& input, size_t at, uint32_t least, size_t max_backward, State& state)
{
    const auto covered = [&](size_t distance, size_t from, size_t to) HWY_ATTR {
        size_t sum = 0;
        for (const uint8_t* some = input.bytes + at + 512 + 1001 * from; from < to; ++from, some += 1001) {
            const uint32_t equal = Equal(some, some - distance), three = equal & equal >> 1 & equal >> 2, starts = three & three >> (least - 3);
            sum += __builtin_popcount(starts | starts << 1 | starts << 2 | starts << (least - 1));
        }
        return sum;
    };
    size_t most = state.stride <= at - input.origin ? covered(state.stride, 0, 4) : 0;
    for (size_t distance = 1; distance <= kSpan; distance += distance < 16 ? 1 : 4) {
        if (const size_t some = covered(distance, 3, 4); some >= 8) {
            if (const size_t all = some + covered(distance, 0, 3); all + (distance < state.stride) * 4 > most + 3 && all >= 40)
                most = all, state.stride = distance;
        }
    }
    // What is left of a counter is its slower byte.
    if (const size_t distance = size_t { 256 } * state.stride; most >= 64 && distance <= std::min<size_t>({ kChunk, at - input.origin, max_backward }) && covered(distance, 0, 4) >= most)
        state.stride = distance;
    return most;
}

// How many of the last 1024 bytes the path leaves out although copies of four bytes from nearby would cover them.
static HWY_NOINLINE size_t Missed(const uint8_t* bytes, size_t stop, const Path& path, size_t from, size_t to)
{
    uint16_t seen[2048] = {};
    size_t missed = 0;
    for (size_t at = stop - 1024, end = at; at < stop - (missed ? 4 : 700); ++at) {
        while (from < to && path.ends[from] <= at)
            ++from;
        const uint32_t hash = Read<uint32_t>(bytes + at) * 0x9E3779B1;
        const bool same = (std::exchange<uint16_t>(seen[hash >> 21], hash >> 5) == static_cast<uint16_t>(hash >> 5)) & (from == to || at + 4 <= path.starts[from]);
        missed += same ? at + 4 - std::max(at, end) : 0;
        end = same ? at + 4 : end;
    }
    return missed;
}

// How many of the eight are not the same in all bytes.
static HWY_INLINE int32_t BitsInUse(const uint8_t* bytes, size_t length)
{
    const hn::Full128<uint8_t> d;
    auto differs = hn::Zero(d);
    for (size_t i = 0; i < length; i += length / 64 + 16)
        differs |= hn::LoadU(d, bytes + i) ^ hn::Set(d, *bytes);
    uint64_t any = hn::GetLane(hn::BitCast(hn::Full128<uint64_t>(), differs | hn::ShiftRightBytes<8>(d, differs)));
    any |= any >> 32;
    any |= any >> 16;
    return __builtin_popcount((any | any >> 8) % 256);
}

// In percent of a sample, what text does not have.
static HWY_NOINLINE size_t OddBytes(const uint8_t* bytes, size_t length)
{
    const hn::Full128<uint8_t> d;
    auto odd = hn::Zero(d);
    size_t seen = 0;
    for (size_t i = 0; i + 16 < length; i += length / 64 + 32, seen += 16) {
        const auto v = hn::LoadU(d, bytes + i);
        odd -= hn::VecFromMask(d, hn::Or(v - hn::Set(d, 9) > hn::Set(d, 0xF4 - 9), v - hn::Set(d, 14) < hn::Set(d, 18)));
        const auto continues = hn::LoadU(d, bytes + i + 1) - hn::Set(d, 0x80) < hn::Set(d, 0x40);
        odd -= hn::IfThenElse(continues, hn::VecFromMask(d, v < hn::Set(d, 0x80)), hn::VecFromMask(d, v > hn::Set(d, 0xBF)));
    }
    return hn::ReduceSum(hn::Full128<uint64_t>(), hn::SumsOf8(odd)) * 100 / (seen | 1);
}

static bool BrotliQuickLooksBinary(const uint8_t* bytes, size_t length) { return OddBytes(bytes, length) >= 10; }

// Replaces literals by words. Returns where the result ends in `out`, where it starts at `kPathStart`.
static HWY_NOINLINE size_t AddWords(const Settings& settings, const Memory& memory, const Input& input, size_t begin, size_t end, Path& path, size_t from, size_t to, Path& out, ParseScratch& scratch, State& state)
{
    const DU8 d8;
    const DU32 d;
    const DI32 di;
    const hn::Rebind<uint16_t, DU32> du16;
    const Words& words = *memory.words;
    const uint8_t* const bytes = input.bytes;
    // By where the bytes start that were hashed.
    uint8_t* const valid = scratch.valid + settings.grams[0] - 1;
    for (size_t i = from; i < to; ++i) {
        Put<uint32_t>(valid + std::max<ptrdiff_t>(path.ends[i] - begin, 2) - 4, ~0u);
        Put<uint16_t>(valid + std::max<ptrdiff_t>(path.starts[i] - begin, 0) - 2, 0xFFFF);
    }
    // What is new, and not in the middle of a word or a character.
    uint16_t* const positions = scratch.list;
    size_t looked_up = 0;
    for (size_t i = 0; begin + i < end; i += hn::Lanes(d8)) {
        const auto here = hn::LoadU(d8, bytes + begin + i), before = hn::LoadU(d8, bytes + begin + i - 1);
        const auto in_word = hn::And(here - hn::Set(d8, 'a') < hn::Set(d8, 26), (before | hn::Set(d8, 32)) - hn::Set(d8, 'a') < hn::Set(d8, 26));
        const auto above = [&](size_t j) HWY_ATTR { return hn::LoadU(d8, bytes + begin + i + j) - hn::Set(d8, ' '); };
        const auto highest = hn::Max(hn::Max(here - hn::Set(d8, '!'), above(1)), hn::Max(above(2), above(3)));
        const auto never = hn::Or(here - hn::Set(d8, 0x80) < hn::Set(d8, 0x40), highest > hn::Set(d8, (state.is_binary ? '~' : 0xF4) - ' '));
        uint32_t others = hn::BitsFromMask(d8, hn::Or(hn::Or(in_word, never), hn::MaskFromVec(hn::LoadU(d8, valid + i))));
        for (size_t j = i; j < i + hn::Lanes(d8); j += 8, others >>= 8)
            looked_up += AppendSetBits(~others % 256, j, positions + looked_up);
    }
    // The position above the number of the bucket.
    uint32_t *const keys = scratch.keys, *const results = scratch.results;
    const uint8_t* const chunk = bytes + begin;
    size_t count = 0;
    for (size_t i = 0; i < looked_up; ++i) {
        const uint32_t position = positions[i], four = Read<uint32_t>(chunk + position) | 32, row = (four * 0x1E35A7BD >> (32 - kWordRowBits)) * 8;
        uint32_t same = 256;
        for (size_t j = 0; j < 8; j += kLanes)
            same |= hn::BitsFromMask(d, hn::Load(d, words.first_four + row + j) == hn::Set(d, four)) << j;
        keys[count] = position << 16 | (row + __builtin_ctz(same));
        count += same != 256;
    }
    size_t found = 0, long_count = 0;
    uint16_t* const long_ones = scratch.previous;
    for (size_t i = 0; i < std::min(count, kMaxWords); ++i) {
        const uint32_t position = keys[i] >> 16, bucket = words.buckets[keys[i] % std::size(words.buckets)], first = std::min<uint32_t>(bucket % (1 << 14), kWordCount);
        const auto next_four = hn::BitCast(d8, hn::Set(d, Read<uint32_t>(chunk + position + 4)));
        uint32_t alike = 0;
        for (size_t j = 0; j < 8; j += kLanes) {
            const auto theirs = hn::BitCast(d8, hn::LoadU(d, words.next_four + first + j));
            // Zeros stand for what is after the end.
            alike |= hn::BitsFromMask(d, hn::BitCast(d, hn::Min(theirs ^ next_four, theirs)) == hn::Zero(d)) << j;
        }
        const uint32_t byte = chunk[position], with_bit = bucket >> 24, other_case = with_bit ^ -(byte / 32 % 2);
        alike &= ((1u << (bucket >> 14) % 32) - 1) & ~(other_case & -(byte - 'A' >= 26));
        const uint32_t short_ones = alike & ~0u << (bucket >> 19) % 32, longest = __builtin_ctz(alike | 256), other = __builtin_ctz(short_ones | 256);
        positions[found] = position;
        // Whether to change the case, above the word.
        keys[found] = words.packed[first + longest] | (other_case >> longest & 1) << 16;
        results[found] = (words.packed[first + other] | (other_case >> other & 1) << 16) & (other / 8 - 1);
        long_ones[long_count] = found;
        long_count += alike != short_ones;
        found += alike != 0;
    }
    for (size_t i = 0; i < long_count; ++i) {
        const uint32_t j = long_ones[i], longest = keys[j], length = longest % 32;
        const uint8_t* const spelling = memory.dictionary + std::min(kWordOffsets[length] + longest % 65536 / 32 * length, kWordOffsets[25]);
        const uint32_t omitted = length - __builtin_ctz(~(Equal(chunk + positions[j], spelling) | 1) | 1 << length);
        const bool is_best = !omitted | ((longest < 65536) & (omitted <= 9) & (length - omitted > results[j] % 32 + 1));
        results[j] = __builtin_unpredictable(is_best) ? longest | omitted << 17 : results[j];
    }
    path.ends[from - 1] = state.now.covered;
    path.starts[to] = end;
    path.ends[to] = path.ends[to + 1] = end + 2;
    uint16_t* const followers = scratch.first;
    for (size_t i = 0, next = from, before; i < found; ++i) {
        const uint32_t omitted = results[i] >> 17, position = positions[i];
        do
            next += before = __builtin_ctz(hn::BitsFromMask(di, hn::BitCast(di, hn::LoadU(d, path.starts + next)) > hn::Set(di, begin + position)) | 1 << kLanes);
        while (before == kLanes);
        followers[i] = next;
        hn::Store(hn::InsertLane(hn::LoadU(hn::Full128<uint32_t>(), path.ends + next - 1), 3, path.starts[next]), hn::Full128<uint32_t>(), scratch.around + 4 * i);
        // With and without a space before, and with and without the byte after.
        const uint32_t all = words.transforms[(results[i] >> 16) % 2][chunk[position + results[i] % 32]];
        keys[i] = __builtin_unpredictable(omitted) ? words.omit_last[omitted % 16] * 0x01010101 : __builtin_unpredictable(chunk[position - ptrdiff_t { 1 }] == ' ') ? all
                                                                                                                                                                    : all % 65536 * 0x10001;
    }
    const auto n = [&](uint32_t value) HWY_ATTR { return hn::Set(d, value); };
    const auto above = [&](VU32 a, VU32 b) HWY_ATTR { return hn::RebindMask(d, hn::BitCast(di, a) > hn::BitCast(di, b)); };
    const auto first_word = n(std::min<uint64_t>(input.base + input.stream_offset + (begin + end) / 2, settings.max_backward) + settings.first_word);
    uint32_t *const starts = scratch.distances, *const stops = scratch.stops + 1;
    stops[-1] = 0;
    for (size_t i = 0; i < found; i += kLanes) {
        const auto result = hn::Load(d, results + i);
        hn::StoreU(hn::PromoteTo(d, hn::LoadU(du16, positions + i)) + n(begin) + (result & n(31)) - hn::ShiftRight<17>(result), d, stops + i);
    }
    for (size_t i = (found + kLanes - 1) / kLanes * kLanes; i;) {
        i -= kLanes;
        VU32 free, next_end, second_end, gap_end;
        hn::LoadInterleaved4(d, scratch.around + 4 * i, free, next_end, second_end, gap_end);
        const auto result = hn::Load(d, results + i), length = result & n(31), all = hn::Load(d, keys + i), low = all & n(0xFFFF), high = hn::ShiftRight<16>(all);
        auto start = hn::PromoteTo(d, hn::LoadU(du16, positions + i)) + n(begin), stop = hn::LoadU(d, stops + i);
        // A space between two words belongs to the first.
        const auto has_prefix = hn::AndNot(hn::Or(low == high, hn::LoadU(d, stops + i - 1) + n(1) == start), above(start, free));
        const auto both = hn::IfThenElse(has_prefix, high, low), without = both & n(255), with = hn::ShiftRight<8>(both);
        const auto has_suffix = hn::AndNot(with == without, above(gap_end, stop));
        const auto size_bits = [&](size_t half) HWY_ATTR { return hn::BitCast(d, hn::TableLookupBytes(hn::LoadDup128(d8, kWordSizeBits + half), hn::BitCast(d8, length & n(15)))) & n(255); };
        const auto address = hn::ShiftRight<5>(result & n(0xFFFF)) + (hn::IfThenElse(has_suffix, with, without) << hn::IfThenElse(above(length, n(15)), size_bits(16), size_bits(0)));
        start += hn::VecFromMask(d, has_prefix);
        stop -= hn::VecFromMask(d, has_suffix);
        const auto swallows = above(stop + n(2), next_end);
        const auto gain = (hn::Min(stop, gap_end) - start) * n(state.literal_cost) + hn::IfThenElseZero(swallows, n(64));
        const auto cost = hn::ShiftLeft<2>(hn::ShiftRight<23>(FloatBits(hn::ShiftRight<1>(first_word + address)))) - n(126 * 4 - 34);
        const auto is_bad = hn::Or(hn::Or(above(free, start), above(stop + n(2), second_end)), length == n(0));
        hn::StoreU(hn::IfThenElseZero(hn::AndNot(is_bad, above(gain, cost)), start), d, starts + i);
        hn::StoreU(stop, d, stops + i);
        hn::Store(hn::ShiftLeft<kAddressBits>(length) | address | n(kWord), d, results + i);
        hn::Store(hn::PromoteTo(d, hn::LoadU(du16, followers + i)) - hn::VecFromMask(d, swallows), d, keys + i);
    }
    size_t used = 0;
    for (size_t i = 0, free = 1, next = from; i < found; ++i) {
        const bool fits = (starts[i] >= free) & (followers[i] >= next);
        long_ones[used] = i;
        used += fits;
        free = __builtin_unpredictable(fits) ? stops[i] : free;
        next = __builtin_unpredictable(fits) ? keys[i] : next;
    }
    long_ones[used] = found;
    followers[found] = to;
    size_t written = kPathStart;
    for (size_t k = 0, next = from; k <= used; ++k) {
        const size_t i = long_ones[k], before = followers[i] - next;
        CopyMatches(path, next, before, out, written);
        written += before;
        out.starts[written] = starts[i];
        out.ends[written] = stops[i];
        out.distances[written++] = results[i];
        next = keys[i];
    }
    state.word_credit = std::clamp<int32_t>(state.word_credit + 16 * used - looked_up - (end - begin) * settings.word_toll / kChunk, 0, 1024);
    return written - 1;
}

// 256 times the logarithm of `value`, which is not zero.
static HWY_INLINE VI32 Log2Times256(VI32 value)
{
    const DI32 d;
    const DI16 d16;
    const auto fixed = hn::ShiftRight<15>(hn::BitCast(d, hn::ConvertTo(DF32(), value))), fraction = fixed & hn::Set(d, 255);
    const auto bulge = hn::BitCast(d16, fraction) * hn::BitCast(d16, hn::Set(d, 256) - fraction);
    return fixed - hn::Set(d, 127 * 256) + hn::BitCast(d, hn::MulHigh(bulge, hn::Set(d16, 88)));
}

// About what the sums of `a` and `b` take with a code of their own.
static HWY_NOINLINE int32_t Bits(const uint32_t* a, const uint32_t* b, size_t size, int32_t per_symbol)
{
    const DI32 d;
    auto total = hn::Zero(d), sum = hn::Zero(d);
    for (size_t i = 0; i < size; i += kLanes) {
        const auto count = hn::BitCast(d, hn::Load(DU32(), a + i) + hn::Load(DU32(), b + i));
        total += count;
        sum += count * Log2Times256(count) - hn::IfThenZeroElse(count == hn::Zero(d), hn::Set(d, 256 * per_symbol));
    }
    const int32_t all = hn::ReduceSum(d, total);
    return (all * hn::GetLane(Log2Times256(hn::Set(d, all))) - hn::ReduceSum(d, sum)) / 256;
}

// About what they take.
template<size_t kStride>
static HWY_NOINLINE size_t BitsOf(const uint8_t* bytes, size_t count)
{
    alignas(32) uint32_t counts[256] = {};
    const size_t step = count / 4096 * 2 + 1;
    for (size_t i = 0; i < count; i += step)
        ++counts[bytes[i * kStride]];
    return Bits(counts, kNone.commands, 256, step == 1 ? 2 : 1) * step;
}

static HWY_INLINE int32_t LiteralCost(size_t bits, size_t count) { return std::min(bits * 3 / count + 6, bits * 4 / count + 1); }

static HWY_INLINE size_t DistanceSlots(const Settings& settings, const State& state) { return (settings.distance_symbols[state.kind] + 31) & ~31u; }

// Adds the latest commands to the meta-block, unless it had better end before them.
static HWY_NOINLINE void Settle(const Settings& settings, const Memory& memory, State& state, bool is_end)
{
    if (state.settled.commands || !is_end) {
        // One in four, in turns.
        alignas(32) uint32_t some[4 * 64] = {};
        for (size_t i = state.settled.literals; i + 12 < state.now.literals; i += 16) {
            for (size_t j = 0; j < 4; ++j)
                some[64 * j + (memory.literals[i + 4 * j] >> 18 & 63)] += 4;
        }
        for (size_t i = 0; i < 64; ++i)
            state.After().literals[i] = some[i] + some[i + 64] + some[i + 128] + some[i + 192];
        const auto bits = [&](const Counts& other) HWY_ATTR {
            return Bits(state.After().commands, other.commands, kCommandSymbols, 4) + Bits(state.After().distances, other.distances, DistanceSlots(settings, state), 4)
                + Bits(state.After().literals, other.literals, 64, 15);
        };
        const int32_t alone = bits(kNone), joined = state.settled.commands ? bits(state.Before()) : alone;
        if ((state.is_ready = state.settled_bits + alone + 300 < joined))
            return;
        state.settled_bits = joined;
    }
    if (state.settled.commands) {
        uint32_t *before = reinterpret_cast<uint32_t*>(&state.Before()), *after = reinterpret_cast<uint32_t*>(&state.After());
        for (size_t i = 0; i < sizeof(Counts) / sizeof(uint32_t); i += kLanes)
            hn::Store(hn::Load(DU32(), before + i) + hn::Load(DU32(), after + i), DU32(), before + i);
    } else {
        state.swapped ^= 1;
    }
    state.settled = state.now;
    // What follows does not depend on whether the meta-block is stored as is.
    if (!is_end) {
        std::fill_n(state.last, 4, 0xFFFFFFF0);
        state.After() = {};
    }
}

static HWY_NOINLINE void DropWhatLeftTheWindow(const Settings& settings, const Input& input, size_t at, size_t length, State& state, ParseScratch& scratch)
{
    const int32_t end = input.dictionary_end - at, reach = settings.max_backward;
    for (int32_t i = 0; i < static_cast<int32_t>(length); ++i) {
        const bool has_left = (scratch.sources[i] >= end) & (i - scratch.sources[i] > reach);
        scratch.sources[i] = has_left ? i : scratch.sources[i];
        scratch.valid[i] = has_left ? 0 : scratch.valid[i];
    }
    if (state.favorite > settings.max_backward && input.dictionary_end + state.favorite < at)
        state.favorite = state.trust = 0;
}

// A copy cannot go on from the dictionary into the stream. Returns where the result ends in `out`, where it starts at `kPathStart`.
static HWY_NOINLINE size_t SplitAtDictionaryEnd(const Settings& settings, const Input& input, const Path& path, size_t from, size_t to, Path& out, size_t at)
{
    size_t count = kPathStart;
    for (; from < to; at = path.ends[from++]) {
        const size_t start = std::max<size_t>(path.starts[from], at), end = path.ends[from], distance = path.distances[from];
        const size_t middle = std::clamp(input.dictionary_end + distance, start, end);
        out.starts[count] = start;
        out.ends[count] = middle;
        out.distances[count] = distance;
        count += middle >= start + 2;
        out.starts[count] = middle;
        out.ends[count] = end;
        out.distances[count] = distance;
        count += end >= middle + 2 && distance <= settings.max_backward;
    }
    return count;
}

// How far `match` can be extended.
static HWY_INLINE size_t Limit(const Input& input, const Match& match, size_t end)
{
    const size_t middle = input.dictionary_end + match.distance;
    return match.start < middle ? std::min(middle, end) : end;
}

// One position in 2048 or so, or more if there are none, which is remembered for much longer than the others.
static HWY_NOINLINE void FindLandmarks(const Settings& settings, const Memory& memory, const Input& input, size_t at, size_t length, State& state)
{
    const DU8 d;
    const size_t reach = std::min<size_t>(at - kSpan, Reach(settings, input));
    const auto mask = hn::Set(d, 7 >> state.leniency);
    size_t count = 0;
    const auto mixed = [&](size_t i) HWY_ATTR {
        const auto here = hn::LoadU(d, input.bytes + i), before = hn::LoadU(d, input.bytes + i - 1), other = here ^ hn::LoadU(d, input.bytes + i - 3);
        return (hn::TableLookupBytes(Scramble(), other & hn::Set(d, 15)) + here + before + before) | ((other + before) & mask);
    };
    for (size_t i = at; i + kBatch <= at + length; i += kBatch) {
        auto least = mixed(i);
        for (size_t j = hn::Lanes(d); j < kBatch; j += hn::Lanes(d))
            least = hn::Min(least, mixed(i + j));
        if (HWY_LIKELY(hn::AllFalse(d, least == hn::Zero(d))))
            continue;
        ++count;
        size_t found = i;
        for (size_t j = i; j < i + kBatch; j += hn::Lanes(d)) {
            const uint32_t zeros = hn::BitsFromMask(d, mixed(j) == hn::Zero(d));
            found = zeros ? j + Log2(zeros) : found;
        }
        const uint8_t* const span = input.bytes + found + 1 - kSpan;
        uint64_t hash = 0;
        for (size_t j = 0; j < kSpan; j += 8)
            hash = (hash + Read<uint64_t>(span + j)) * 0x1FE35A7BD3579BD3;
        const uint32_t position = input.base + found, distance = position - std::exchange(memory.landmarks[hash >> (64 - settings.landmark_bits)], position);
        if (const size_t end = distance > kFar ? found : found + 256; distance > kChunk && distance <= reach && !state.trust && MatchEnd(input.bytes, found + 1 - kSpan, distance, std::min(end, at + length)) == end) {
            state.favorite = distance;
            state.trust = 16;
        }
    }
    if (length == kChunk)
        state.leniency = std::clamp(state.leniency + !count - (count > 6), 0, 3);
}

static HWY_INLINE void IndexAll(const Settings& settings, const Memory& memory, const Input& input, size_t at, size_t length, bool is_barren, State& state, ParseScratch& scratch)
{
    // The tables are as large as what they have calls for. Both halves start with what there was.
    state.indexed = std::min<uint32_t>(state.indexed + (is_barren ? length / 16 : length), 1 << 24);
    if (!state.table_bits) {
        state.table_bits = 12;
        state.has_seams = false;
        memset(memory.landmarks, 0, 4 << settings.landmark_bits);
        for (size_t t = 0; t < settings.table_count; ++t) {
            memset(memory.tables[t], 0x80, 4 << std::min<uint32_t>(state.table_bits, settings.table_bits[t]));
            memory.tables[t][1 << settings.table_bits[t]] = 0;
        }
    } else if ((state.kind == 2 ? state.indexed * 2 : state.indexed / 2) > 1u << state.table_bits) {
        for (size_t t = 0; t < settings.table_count; ++t) {
            if (state.table_bits < settings.table_bits[t])
                memcpy(memory.tables[t] + (1 << state.table_bits), memory.tables[t], 4 << state.table_bits);
        }
        ++state.table_bits;
    }
    if (settings.landmark_bits)
        FindLandmarks(settings, memory, input, at, length, state);
    using Function = decltype(&Index<1>);
    static constexpr Function kDense[] = { Index<1>, Index<2>, Index<3> };
    const Function usual = settings.sparsity ? IndexSome<false> : kDense[settings.table_count - 1];
    (is_barren ? IndexSome<true> : usual)(settings, memory, input, at, length, state, scratch);
}

static HWY_INLINE Settings Adapt(Settings settings, const State& state)
{
    const uint32_t less = state.is_fine ? std::max(settings.grams[0], 4u) - 4 : 0;
    for (uint32_t& gram : settings.grams)
        gram -= less;
    settings.sparsity *= !state.is_dense && !state.is_fine;
    return settings;
}

static void BrotliQuickIndex(const Settings& settings, const Memory& memory, const Input& input, size_t at, size_t end, State& state, Scratch& scratch)
{
    for (; at < end; at += kChunk)
        IndexAll(Adapt(settings, state), memory, input, at, std::min(end - at, kChunk), false, state, scratch.parse);
}

static HWY_INLINE void EmitAll(const Settings& settings, const Memory& memory, const Input& input, Path& path, size_t from, size_t to, ParseScratch& scratch, State& state)
{
    // Together, these lengths would have too many extra bits for one write.
    if (const uint32_t start = path.starts[from]; from < to && start >= state.now.covered + 6210 && path.ends[from] >= start + 2118) {
        path.starts[--from] = start;
        path.ends[from] = start + 2000;
        path.distances[from] = path.distances[from + 1];
    }
    for (size_t i = from, at = state.now.covered; input.dictionary_end && i < to; at = path.ends[i++]) {
        const size_t position = std::max<size_t>(path.starts[i], at) - input.dictionary_end;
        if (path.distances[i] < kWord && path.distances[i] > position)
            path.distances[i] += std::min<size_t>(position + input.stream_offset, settings.max_backward) - position;
    }
    Emit(settings, memory, input, path, from, to, scratch, state);
}

// A meta-block is ready after that. It goes up to `end`, or else there is another one to come.
static void BrotliQuickClose(const Settings& settings, const Memory& memory, const Input& input, size_t end, State& state, Scratch& scratch)
{
    state.favorite = state.trust = 0;
    if (Match& held = state.held; held.distance) {
        while (held.end < Limit(input, held, end) && input.bytes[held.end] == input.bytes[held.end - held.distance])
            ++held.end;
        Path& path = scratch.parse.paths[0];
        path.starts[kPathStart] = held.start;
        path.ends[kPathStart] = held.end;
        path.distances[kPathStart] = std::exchange(held.distance, 0);
        EmitAll(settings, memory, input, path, kPathStart, kPathStart + 1, scratch.parse, state);
    }
    if (Mark& now = state.now; end > now.covered) {
        const size_t insert = end - now.covered;
        // Without commands, it is stored as is.
        if (!now.commands && insert >= 256 && BitsOf<1>(input.bytes + now.covered, insert) * 100 >= insert * settings.max_size) {
            state.settled.covered = now.covered = end;
            state.settled_bits = 0;
            state.literal_cost = 30;
            state.is_ready = true;
            return;
        }
        GatherCarefully(input, now.covered, end, memory.literals + now.literals);
        memory.literal_ends[now.commands] = now.literals += insert;
        if (!now.commands)
            state.After() = {};
        memory.commands[now.commands] = LongCommand(insert, 4);
        ++state.After().commands[static_cast<uint16_t>(memory.commands[now.commands])];
        memory.distances[now.commands++] = kNoDistance;
        now.covered = end;
    }
    if (state.now.commands != state.settled.commands)
        Settle(settings, memory, state, true);
    state.is_ready = true;
}

static HWY_INLINE size_t Matched(const Path& path, size_t from, size_t to)
{
    uint32_t sum = 0;
    for (; from < to; ++from)
        sum += path.ends[from] - path.starts[from];
    return sum;
}

// What may be one for `4 * most` bytes, or else zero.
static HWY_INLINE size_t Period(const uint8_t* bytes, size_t most)
{
    const hn::Full128<uint8_t> d;
    for (size_t i = 1; i <= most; i += hn::Lanes(d)) {
        const auto same = [&](size_t offset) HWY_ATTR { return hn::LoadU(d, bytes + offset + i) == hn::Set(d, bytes[offset]); };
        if (const uint64_t all = hn::BitsFromMask(d, hn::And(hn::And(same(0), same(most - 3)), hn::And(same(2 * most - 2), same(3 * most - 1)))))
            return i + __builtin_ctzll(all);
    }
    return 0;
}

// Returns how far it got before a meta-block was ready.
static size_t BrotliQuickParse(const Settings& given, const Memory& memory, const Input& input, size_t at, size_t end, State& state, Scratch& both)
{
    Settings settings = Adapt(given, state);
    ParseScratch& scratch = both.parse;
    Match& held = state.held;
    const Mark &now = state.now, &settled = state.settled;
    while (at < end) {
        const size_t pending = held.distance ? held.start - now.covered + at - std::min<size_t>(at, held.end) : at - std::min<size_t>(at, now.covered);
        const bool is_full = now.literals + pending + 2 * now.commands >= kMaxWeight;
        const auto bits_of = [&](size_t back, size_t count) HWY_ATTR { return BitsOf<1>(input.bytes + at - back * kChunk, count * kChunk); };
        if (!now.commands && (is_full || (pending / kChunk == 2 && !held.distance && state.literal_cost < 29 && bits_of(2, 1) + bits_of(1, 1) + 2000 < bits_of(2, 2)))) {
            BrotliQuickClose(settings, memory, input, at, state, both);
            break;
        }
        const size_t odd = now.literals + pending + 2 * now.commands >= 1500 && end - at >= kChunk / 2 ? OddBytes(input.bytes + at, std::min(end - at, kChunk)) : 10;
        const bool changes = state.is_binary ? odd < 4 : odd > 20;
        state.is_barren &= !changes;
        if (changes && state.is_binary && now.covered <= at) {
            // In one piece, because nothing can follow its last command.
            state.settled_bits = INT32_MAX / 2;
            BrotliQuickClose(settings, memory, input, std::max<size_t>(at, held.distance ? held.end : 0), state, both);
            break;
        }
        const bool is_end = is_full || (changes && now.commands) || (pending >= 2 * kSection && now.commands);
        if (is_end ? now.commands != settled.commands : now.literals - settled.literals + 2 * (now.commands - settled.commands) >= kSection)
            Settle(settings, memory, state, is_end);
        if ((state.is_ready |= is_end))
            break;
        if (!now.commands && !state.is_barren) {
            const size_t odd = OddBytes(input.bytes + at, std::min<size_t>(end - at, 8192));
            if (std::exchange(state.is_binary, odd >= 10) != (odd >= 10))
                state.literal_cost = state.repeats_after = state.checks_after = 0;
            state.is_dense = odd > (state.is_dense ? 3 : 20);
            settings = Adapt(given, state);
            state.kind = end - at < 8192 ? 2 : state.is_binary;
            if (!state.literal_cost || state.kind == 2)
                state.literal_cost = (state.is_binary ? 24 : 20 + state.kind * (state.indexed < 8192 ? 1 : 3)) + 2048 / (end - at + 128);
        }
        // What a flush cut off may go on.
        if (const uint32_t last = state.last[0]; !now.commands && now.covered == at && !input.dictionary_end && last - 1 < std::min<size_t>(at - input.origin, settings.max_backward) && end - at >= kSpan && !~Equal(input.bytes + at, input.bytes + at - last))
            held = { now.covered, now.covered + 2, last };
        // It may be all one match.
        const uint32_t period = !state.indexed && now.covered <= at && !held.distance && end - at >= 64 ? Period(input.bytes + at, end - at >= 512 ? 128 : 16) : 0;
        if (const uint32_t start = at + period, stop = std::min<size_t>(start + 256, end); period - 1 < 16 && MatchEnd(input.bytes, start, period, stop) == stop)
            held = { start, stop, period };
        size_t first = 0;
        if (held.distance && held.end >= at) {
            held.end = MatchEnd(input.bytes, held.end, held.distance, Limit(input, held, end));
            // Its source is going to be forgotten first.
            for (size_t i = std::max<size_t>(at, held.end - held.distance); settings.landmark_bits && i + 256 < held.end; i += kChunk)
                IndexAll(settings, memory, input, i, std::min(held.end - kSpan - i, kChunk), true, state, scratch);
            if (held.end == end && end - held.start >= 48)
                return end;
            at = std::max<size_t>(at, held.end - kSpan);
            first = held.end - at;
        } else if (state.now.covered > at) {
            first = state.now.covered - at;
        }
        const size_t length = period > 16 ? period + 64 : std::min(end - at, kChunk), limit = std::min(end - at, length + kSpan);
        IndexAll(settings, memory, input, at, length, state.is_barren, state, scratch);
        if (state.is_barren && scratch.listed >= 16)
            IndexAll(settings, memory, input, at, length, state.is_barren = state.checks_after = 0, state, scratch);
        // Whether the distances into the dictionary are not what they are here.
        const bool is_apart = input.dictionary_end && (input.stream_offset || at + limit > input.dictionary_end + settings.max_backward);
        size_t rounds[kWalkers];
        if (state.is_barren || settings.sparsity) {
            WalkList(input.bytes + at, first, limit, state, scratch, rounds);
        } else {
            if (is_apart)
                DropWhatLeftTheWindow(settings, input, at, length, state, scratch);
            Walk(input.bytes + at, std::min(first, length), length, limit, at + 1 - kSpan, state, scratch, rounds);
        }

        size_t count = kFirstNode;
        for (size_t i = 0; i < kFirstNode; ++i)
            scratch.ends[i] = INT16_MIN, scratch.distances[i] = 0;
        const bool competes = held.distance && held.start + kMaxHeld > at;
        if (competes) {
            scratch.starts[count] = held.start - at;
            scratch.ends[count] = held.end - at;
            scratch.distances[count++] = held.distance;
        }
        const ptrdiff_t lowest = std::max<ptrdiff_t>((held.distance && !competes ? held.end : state.now.covered) - at, -1024);
        count = LookBack(input.bytes + at, at, count, lowest, rounds, scratch);
        const int32_t bits = BitsInUse(input.bytes + at, length), literal_cost = std::min(state.literal_cost, bits ? 4 * bits + 1 : 32);
        size_t from = Choose(at, at - input.origin, count, lowest, limit, literal_cost, scratch), to = kPathEnd;
        Path *path = &scratch.paths[0], *spare = &scratch.paths[1];
        if (held.distance && !competes) {
            path->starts[--from] = held.start;
            path->ends[from] = held.end;
            path->distances[from] = held.distance;
        }
        const size_t matched = std::min(Matched(*path, from, to), kChunk);
        state.most_matched = std::max<size_t>(state.most_matched, matched / 32);
        // Now and then, and when the matches dry up.
        if (state.checks_after && matched + 1200 > state.most_matched * 32) {
            --state.checks_after;
        } else if (length >= kChunk / 2) {
            state.checks_after = (settings.repeat_gain ? 3 : 7) + (state.is_barren && state.literal_cost >= 29) * 8;
            state.most_matched = matched / 32;
            if (matched < kChunk / 4 && (state.literal_cost < 18 || (state.is_barren && state.literal_cost >= 29)))
                state.literal_cost = LiteralCost(BitsOf<1>(input.bytes + at + length - 512, 512), 512);
            if ((state.is_barren || settings.grams[0] > 4) && state.literal_cost >= 18 && bits > 4 && matched < kChunk * 3 / 4 && Missed(input.bytes, at + length, *path, from, to) > (state.literal_cost < 24 ? 220 : 120)) {
                state.is_fine = true;
                state.is_barren = false;
                settings = Adapt(given, state);
                continue;
            }
            if (state.is_fine) {
                size_t few = 0;
                for (size_t i = from; i < to; ++i)
                    few += path->ends[i] - path->starts[i] < given.grams[0] + given.sparsity / 2;
                state.is_fine = few * 3 > to - from;
                settings = Adapt(given, state);
            }
        }
        held.distance = 0;
        if (settings.seam_bits && from < to && (to - from) * (10 + settings.join_toll) < matched && matched * 10 >= length * 8 && length >= 1024 && !input.dictionary_end) {
            to = Join(settings, memory, input, at + limit, std::min(end, at + 16 * kChunk), literal_cost, *path, from, to, *spare, state);
            from = kPathStart;
            std::swap(path, spare);
        }
        bool repeats = settings.repeat_gain && !state.repeats_after;
        state.repeats_after -= state.repeats_after != 0;
        if (length == kChunk && (state.is_binary || state.is_barren))
            repeats |= 32 * FindStride(input, at, settings.repeat_gain ? 3 : 4, settings.max_backward, state) > std::min<size_t>(matched + 1024, to - from > 400 ? 3000 : kChunk);
        if (repeats && literal_cost >= 12 && !is_apart) {
            to = Repeat(settings, input, at, at + length, *path, from, to, *spare, scratch, state);
            from = kPathStart;
            std::swap(path, spare);
        }
        if (input.dictionary_end) {
            to = SplitAtDictionaryEnd(settings, input, *path, from, to, *spare, now.covered);
            from = kPathStart;
            std::swap(path, spare);
        }
        if (state.word_credit && !state.is_barren && !settings.sparsity) {
            to = AddWords(settings, memory, input, at, at + length, *path, from, to, *spare, scratch, state);
            from = kPathStart;
            std::swap(path, spare);
        }
        at += length;
        const size_t few = state.is_barren ? 8 : settings.few_matches;
        state.is_barren = length == kChunk && to - from < few && Matched(*path, from, to) < 5 * few + 64;
        if (from == to)
            continue;
        if (path->distances[to - 1] < kWord && path->ends[to - 1] + kMaxHeld > at) {
            --to;
            held = { path->starts[to], path->ends[to], path->distances[to] };
        }
        const size_t before = now.literals;
        EmitAll(settings, memory, input, *path, from, to, scratch, state);
        if (constexpr size_t kSome = 512; before < kSome && now.literals >= kSome && at < end)
            state.literal_cost = std::min(state.literal_cost, LiteralCost(BitsOf<4>(reinterpret_cast<const uint8_t*>(memory.literals) + 2, kSome), kSome));
        else if (state.literal_cost < 16 && before / (4 * kSome) != now.literals / (4 * kSome))
            state.literal_cost = std::max(state.literal_cost, LiteralCost(BitsOf<4>(reinterpret_cast<const uint8_t*>(memory.literals + now.literals - kSome) + 2, kSome), kSome) - 4);
        held.start = std::max(held.start, now.covered);
    }
    return at;
}

struct Writer {
    uint8_t* at;
    // At the top.
    uint64_t bits;
    // In the low byte.
    uint64_t count;

    Writer(uint8_t* out, size_t position)
        : at(out + position / 8)
        , bits(uint64_t { *at } << 56 << (8 - position % 8))
        , count(position % 8)
    {
    }

    // The bits are at the top, and their number at the bottom.
    HWY_INLINE void Add(uint64_t code)
    {
        bits = bits >> (code % 64) | code;
        count += code;
    }

    HWY_INLINE void AddFour(uint64_t a, uint64_t b, uint64_t c, uint64_t d)
    {
        uint64_t all = (a >> (b % 64) | b) >> ((c + d) % 64) | c >> (d % 64) | d, sum = a + b + c + d;
        asm("" : "+r"(all), "+r"(sum));
        bits = bits >> (sum % 64) | all;
        count += sum;
    }

    HWY_INLINE void AddLow(uint64_t value, uint64_t length)
    {
        bits = bits >> length | value << 1 << (63 - length);
        count += length;
    }

    // For up to 58 bits.
    HWY_INLINE void Flush()
    {
        Put(at, bits >> (-count % 64));
        at += count % 64 / 8;
        count %= 8;
    }

    HWY_INLINE void Write(uint64_t length, uint64_t value)
    {
        AddLow(value, length);
        Flush();
    }

    size_t Finish(uint8_t* out)
    {
        Put(at, bits >> 56 >> (8 - count));
        return (at - out) * 8 + count;
    }
};

// Of numbers up to 15, in a table that starts with zero.
static HWY_INLINE hn::Vec<DI16> LookUp(const uint8_t (&low)[16], const uint8_t (&high)[16], hn::Vec<DI16> index)
{
    return hn::TableLookupBytes(hn::LoadDup128(DU8(), low), index) | hn::TableLookupBytes(hn::LoadDup128(DU8(), high), hn::ShiftLeft<8>(index));
}

// Rounds what each symbol should take, all at the lowest fraction that makes a code, and shortens those that were next as far as
// there is room. `counts` are followed by zeros up to a multiple of 16. The codes are at the top.
static HWY_NOINLINE void MakeCode(const uint32_t* counts, size_t size, size_t limit, int16_t* lengths, uint16_t* codes)
{
    const DI16 d;
    const DI32 d32;
    constexpr size_t kLanes16 = 2 * kLanes;
    constexpr int32_t kStep = 16;
    alignas(32) int16_t ideal[kCommandSymbols], more[kCommandSymbols];
    const auto n = [&](int32_t value) HWY_ATTR { return hn::Set(d, value); };
    const auto load = [&](size_t i) HWY_ATTR { return hn::BitCast(d32, hn::Load(DU32(), counts + i)); };
    const auto sum_of = [&](hn::Vec<DI16> v) HWY_ATTR { return hn::ReduceSum(d32, hn::WidenMulPairwiseAdd(d32, v, n(1))); };
    const auto rounded = [&](size_t i, int32_t added) HWY_ATTR { return hn::Clamp(hn::ShiftRight<8>(hn::SaturatedAdd(hn::Load(d, ideal + i), n(added))), n(1), n(limit)); };
    // Of all codes, relative to that of one with 14 bits.
    const auto share = [&](hn::Vec<DI16> length) HWY_ATTR {
        alignas(16) static constexpr uint8_t kLow[16] = { 0, 0, 0, 0, 0, 0, 0, 128, 64, 32, 16, 8, 4, 2, 1 }, kHigh[16] = { 0, 32, 16, 8, 4, 2, 1 };
        return LookUp(kLow, kHigh, length);
    };
    auto total = hn::Zero(d32);
    for (size_t i = 0; i < size; i += kLanes)
        total += load(i);
    const auto all = Log2Times256(hn::SumOfLanes(d32, total));
    auto least = hn::Zero(d);
    for (size_t i = 0; i < size; i += kLanes16) {
        hn::Store(hn::OrderedDemote2To(d, all - Log2Times256(load(i)), all - Log2Times256(load(i + kLanes))), d, ideal + i);
        const auto up = share(rounded(i, 256));
        hn::Store(share(rounded(i, 0)) - up, d, more + i);
        least += up;
    }
    // The lanes after the end get the longest codes.
    const int32_t room = (1 << 14) + (-size % kLanes16 << (14 - limit));
    int32_t below = 0, left = room - sum_of(least);
    for (const int32_t stride : { 4 * kStep, kStep }) {
        hn::Vec<DI16> sums[3] = { hn::Zero(d), hn::Zero(d), hn::Zero(d) };
        for (size_t i = 0; i < size; i += kLanes16) {
            for (size_t j = 0; j < 3; ++j)
                sums[j] += hn::IfThenElseZero((hn::Load(d, ideal + i) & n(255)) < n(below + (j + 1) * stride), hn::Load(d, more + i));
        }
        for (const auto sum : sums)
            below += sum_of(sum) <= left ? stride : 0;
    }
    int32_t added = 256 - kStep - below;
    do {
        added += kStep;
        auto sum = hn::Zero(d);
        for (size_t i = 0; i < size; i += kLanes16) {
            hn::Store(rounded(i, added), d, lengths + i);
            sum = hn::SaturatedAdd(sum, share(rounded(i, added)));
        }
        left = room - sum_of(sum);
    } while (left < 0);
    for (int32_t less = 2 * kStep; left; less = std::min(4 * less, 1 << 14)) {
        for (size_t first = 0; first < size; first += 64) {
            uint64_t next = 0;
            for (size_t i = first; i < std::min(first + 64, size); i += kLanes16) {
                const auto length = hn::Load(d, lengths + i);
                next |= hn::BitsFromMask(d, hn::AndNot(share(length) > n(left), length > rounded(i, added - less))) << i % 64;
            }
            for (; next && left; next &= next - 1) {
                int16_t& length = lengths[first + __builtin_ctzll(next)];
                const int32_t taken = 1 << (14 - length);
                length -= taken <= left;
                left -= taken <= left ? taken : 0;
            }
        }
    }
    const DU16 du;
    alignas(32) uint16_t by_length[16];
    hn::Vec<DU16> seen[16 / kLanes16];
    const auto store = [&]() HWY_ATTR __attribute__((always_inline)) {
        for (size_t j = 0; j < std::size(seen); ++j)
            hn::Store(seen[j], du, by_length + j * kLanes16);
        asm("" : "+m"(by_length));
    };
    for (auto& part : seen)
        part = hn::Zero(du);
    HWY_UNROLL(4)
    for (size_t i = 0; i < size; ++i) {
        store();
        codes[i] = by_length[lengths[i]];
        for (size_t j = 0; j < std::size(seen); ++j)
            seen[j] += hn::Load(du, kUnitVectors.data() + 16 * lengths[i] + j * kLanes16);
    }
    store();
    alignas(16) uint8_t low[16] = {}, high[16] = {};
    for (uint32_t length = 2, first = 0; length < 15; ++length) {
        low[length] = first = (first + by_length[length - 1]) << 1;
        high[length] = first >> 8;
    }
    for (size_t i = 0; i < size; i += kLanes16)
        hn::Store(hn::ReverseBits(hn::BitCast(du, LookUp(low, high, hn::Load(d, lengths + i))) + hn::Load(du, codes + i)), du, codes + i);
}

// A bit for each group of eight among 32 symbols that had better have codes of one length.
static HWY_INLINE uint32_t FlatGroups(const uint32_t* counts, uint32_t (&sums)[4])
{
    const hn::Full128<uint8_t> d8;
    const hn::Full128<int16_t> d16;
    const hn::Full128<int32_t> d;
    const auto load = [&](size_t i) HWY_ATTR { return hn::Load(d, reinterpret_cast<const int32_t*>(counts) + i); };
    const auto narrow = [&](size_t i) HWY_ATTR {
        return hn::Min(hn::OrderedDemote2To(d8, hn::OrderedDemote2To(d16, load(i), load(i + 4)), hn::OrderedDemote2To(d16, load(i + 8), load(i + 12))), hn::Set(d8, 15));
    };
    const auto low = narrow(0), high = narrow(16);
    const auto sum = [&](auto a, auto b) HWY_ATTR { return hn::ConcatEven(d, hn::BitCast(d, hn::SumsOf8(b)), hn::BitCast(d, hn::SumsOf8(a))); };
    // 4 * n * log2(n), and less what it takes to describe a length.
    const auto table = hn::Dup128VecFromValues(d8, 10, 0, 8, 19, 32, 46, 62, 79, 96, 114, 133, 152, 172, 192, 213, 255);
    const auto total = sum(low, high), spread = sum(hn::TableLookupBytes(table, low), hn::TableLookupBytes(table, high));
    const auto log = hn::ShiftRight<18>(hn::BitCast(d, hn::ConvertTo(hn::Full128<float>(), total))) - hn::Set(d, (127 + 3) * 32 - 2);
    const auto full = sum(hn::VecFromMask(d8, low == hn::Set(d8, 15)), hn::VecFromMask(d8, high == hn::Set(d8, 15)));
    hn::StoreU(total, d, reinterpret_cast<int32_t*>(sums));
    return hn::BitsFromMask(d, hn::ShiftLeft<3>(spread + full) - total * log < hn::Set(d, 8 * 70));
}

// `size` is a multiple of 32. With `extra_bits`, a code is to be added to its symbol, which has the extra bits at the top.
static HWY_NOINLINE void WriteCode(uint32_t* counts, size_t size, size_t flattened, uint32_t symbol_bits, const uint8_t* extra_bits, uint64_t* codes, Writer& out)
{
    Writer writer = out;
    alignas(32) uint32_t keys[kCommandSymbols + 32];
    alignas(32) uint16_t symbols[kCommandSymbols + 16], words[kCommandSymbols];
    alignas(32) int16_t lengths[kCommandSymbols + 16];
    size_t used = 0;
    for (size_t first = 0; first < size; first += 32) {
        uint32_t zeros = 0, sums[4];
        for (size_t i = 0; i < 32; i += kLanes)
            zeros |= hn::BitsFromMask(DU32(), hn::Load(DU32(), counts + first + i) == hn::Zero(DU32())) << i;
        if (!~zeros)
            continue;
        for (uint32_t flat = first < flattened ? FlatGroups(counts + first, sums) : 0; flat; flat &= flat - 1) {
            std::fill_n(counts + first + 8 * __builtin_ctz(flat), 8, std::max(1u, (sums[__builtin_ctz(flat)] + 4) / 8));
            zeros &= ~(255u << 8 * __builtin_ctz(flat));
        }
        for (size_t i = first; i < first + 32; i += 8)
            used += AppendSetBits((~zeros >> i % 32) % 256, i, symbols + used);
    }
    if (used <= 1) {
        const size_t symbol = used ? symbols[0] : 0;
        codes[symbol] = extra_bits ? extra_bits[symbol] - symbol : 0;
        writer.Write(4 + symbol_bits, 1 | symbol << 4);
        out = writer;
        return;
    }
    HWY_UNROLL(4)
    for (size_t i = 0; i < used; ++i)
        keys[i] = counts[symbols[i]];
    std::fill_n(keys + used, 16, 0);
    // So that four literals fit in one write.
    MakeCode(keys, used, used <= 4 ? 3 : extra_bits ? 14
                                                    : 12,
        lengths, words);
    if (extra_bits) {
        for (size_t i = 0; i < used; ++i)
            codes[symbols[i]] = (uint64_t { words[i] } << 48 >> extra_bits[symbols[i]]) + lengths[i] + extra_bits[symbols[i]] - symbols[i];
    } else {
        HWY_UNROLL(4)
        for (size_t i = 0; i < used; ++i)
            codes[symbols[i]] = (uint64_t { words[i] } << 48) + lengths[i];
    }
    if (used <= 4) {
        writer.Write(4, 1 | (used - 1) << 2);
        for (size_t length = 1; length < 4; ++length) {
            for (size_t i = 0; i < used; ++i) {
                if (lengths[i] == length)
                    writer.Write(symbol_bits, symbols[i]);
            }
        }
        writer.Write(used == 4, lengths[0] != 2 || lengths[1] != 2);
        out = writer;
        return;
    }

    alignas(32) uint8_t tokens[kCommandSymbols + 32];
    size_t count = 0, expected = 0, previous = 8;
    symbols[used] = symbols[used + 1] = symbols[used + 2] = 0;
    for (size_t i = 0; i < used; ++i) {
        const size_t zeros = symbols[i] - expected;
        Put(tokens + count, kZeroRuns[zeros]);
        count += kZeroRunSizes[zeros];
        if (HWY_UNLIKELY((Read<uint64_t>(lengths + i) << 16 == previous * 0x0001000100010000) & (symbols[i + 2] == symbols[i] + 2))) {
            size_t run = 3;
            while (run < 86 && lengths[i + run] == lengths[i] && symbols[i + run] == symbols[i] + run)
                ++run;
            const uint32_t repeats = RunTokens(run -= run == 7, 16);
            Put(tokens + count, repeats);
            count += 4 - __builtin_clz(repeats) / 8;
            i += run - 1;
            previous = 0;
        } else {
            tokens[count++] = previous = lengths[i];
        }
        expected = symbols[i] + 1;
    }
    memset(tokens + count, 31, 32);
    used = 0;
    for (size_t symbol = 0; symbol < 18; ++symbol) {
        auto same = hn::Zero(DU8());
        for (size_t i = 0; i < count; i += hn::Lanes(DU8()))
            same -= hn::VecFromMask(DU8(), (hn::Load(DU8(), tokens + i) & hn::Set(DU8(), 31)) == hn::Set(DU8(), symbol));
        symbols[used] = symbol;
        keys[used] = hn::ReduceSum(hn::Repartition<uint64_t, DU8>(), hn::SumsOf8(same));
        used += keys[used] != 0;
    }
    std::fill_n(keys + used, 16, 0);
    uint8_t token_lengths[18] = {};
    uint64_t token_codes[32];
    if (used == 1) {
        token_lengths[symbols[0]] = 1;
        token_codes[symbols[0]] = symbols[0] == 16 ? 2 : 0;
    } else {
        MakeCode(keys, used, 5, lengths, words);
        for (size_t i = 0; i < used; ++i) {
            const size_t extra = symbols[i] < 16 ? 0 : symbols[i] - 14;
            token_lengths[symbols[i]] = lengths[i];
            token_codes[symbols[i]] = (uint64_t { words[i] } << 48 >> extra) + lengths[i] + extra;
        }
    }
    static constexpr uint8_t kOrder[18] = { 1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15 };
    static constexpr uint64_t kCodes[6] = { 2, 7ull << 60 | 4, 3ull << 61 | 3, 2ull << 62 | 2, 1ull << 62 | 2, 15ull << 60 | 4 };
    const size_t skipped = token_lengths[1] | token_lengths[2] ? 0 : token_lengths[3] ? 2
                                                                                      : 3;
    size_t stored = 18;
    while (used > 1 && !token_lengths[kOrder[stored - 1]])
        --stored;
    writer.AddLow(skipped, 2);
    for (size_t i = skipped; i < stored; ++i) {
        writer.Add(kCodes[token_lengths[kOrder[i]]]);
        if (i == 9)
            writer.Flush();
    }
    writer.Flush();
    token_codes[31] = 0;
    for (size_t i = 0; i < count; i += 6) {
        for (size_t j = i; j < i + 6; ++j)
            writer.Add(token_codes[tokens[j] % 32] + (uint64_t { tokens[j] } >> 5 << 61));
        writer.Flush();
    }
    out = writer;
}

// Null if it pays to build one.
template<size_t kSymbols>
static HWY_NOINLINE const uint64_t* WriteFixedCode(const FixedCodes<kSymbols>& fixed, const uint64_t* tokens, size_t count, uint32_t* counts, int32_t haste, Writer& writer)
{
    if (count - 5 > 250)
        return nullptr;
    const int32_t used = count - (kSymbols == 64 ? std::exchange(counts[kNoDistance], 0) : 0);
    int32_t fitted = used * hn::GetLane(Log2Times256(hn::Set(DI32(), used))) / 16;
    uint32_t both = fixed.descriptions[0].size | fixed.descriptions[1].size << 16;
    for (size_t i = 0; i < count; ++i) {
        const size_t symbol = static_cast<uint16_t>(tokens[i]);
        both += fixed.lengths[symbol];
        fitted += fixed.shares[counts[symbol] % 256];
    }
    const size_t which = both / 65536 < both % 65536;
    if (static_cast<int32_t>((both >> (16 * which)) % 65536) > fitted / 16 + haste)
        return nullptr;
    const auto& [size, bits] = fixed.descriptions[which];
    writer.Write(std::min(size, 48u), bits[0]);
    writer.Write(std::max(size, 48u) - 48, bits[1]);
    return fixed.codes[which];
}

// Groups the contexts. Returns the number of groups.
static HWY_NOINLINE size_t Cluster(WriteScratch& scratch, size_t max_trees, int32_t step, uint8_t (&map)[64])
{
    const DU16 du;
    const DI16 d16;
    const DI32 d;
    constexpr size_t kLanes16 = 2 * kLanes;
    alignas(32) uint16_t all[256];
    alignas(32) int16_t bits[256];
    uint8_t parts[256 / kLanes16], live[64];
    int32_t totals[64], own[64], cost[64], other[64];
    size_t part_count = 0, live_count = 0, used = 0;
    for (size_t i = 0; i < 256; i += kLanes16) {
        auto sum = hn::Zero(du);
        for (size_t context = 0; context < 64; ++context)
            sum += hn::Load(du, scratch.by_context + 256 * context + i);
        hn::Store(sum, du, all + i);
        parts[part_count] = i;
        part_count += !hn::AllTrue(du, sum == hn::Zero(du));
    }
    const auto log = [&](int32_t value) HWY_ATTR { return hn::GetLane(Log2Times256(hn::Set(d, value))); };
    int32_t total = 0;
    for (size_t context = 0; context < 64; ++context) {
        auto sum = hn::Zero(du);
        for (size_t i = 0; i < part_count; ++i)
            sum += hn::Load(du, scratch.by_context + 256 * context + parts[i]);
        totals[live_count] = hn::ReduceSum(du, sum);
        total += totals[live_count];
        live[live_count] = context;
        live_count += totals[live_count] != 0;
    }
    // In 16ths of a bit.
    const auto set_bits = [&](const uint16_t* counts, int32_t sum) HWY_ATTR {
        const auto whole = hn::Set(d16, log(4 * sum + 32) / 16 + 127 * 16);
        const auto bulge = hn::Dup128VecFromValues(DU8(), 0, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1);
        auto nonzero = hn::Zero(du);
        for (size_t i = 0; i < part_count; ++i) {
            const auto both = hn::BitCast(DU32(), hn::Load(du, counts + parts[i])), one = hn::Set(DU32(), 1 << 13);
            nonzero += hn::Min(hn::BitCast(du, both), hn::Set(du, 1));
            // Four times the count, plus one.
            const auto of = [&](VU32 high) HWY_ATTR { return FloatBits(hn::ShiftRight<1>(high) | one) - hn::Set(DU32(), 13 << 23); };
            const auto rough = hn::OddEven(hn::BitCast(d16, hn::ShiftRight<3>(of(both & hn::Set(DU32(), 0xFFFF0000)))), hn::BitCast(d16, hn::ShiftRight<19>(of(hn::ShiftLeft<16>(both)))));
            hn::Store(whole - rough - hn::TableLookupBytes(bulge, rough & hn::Set(d16, 15)), d16, bits + parts[i]);
        }
        return hn::ReduceSum(du, nonzero);
    };
    const auto cost_of = [&](size_t context) HWY_ATTR {
        auto sum = hn::Zero(d);
        for (size_t i = 0; i < part_count; ++i)
            sum += hn::WidenMulPairwiseAdd(d, hn::BitCast(d16, hn::Load(du, scratch.by_context + 256 * context + parts[i])), hn::Load(d16, bits + parts[i]));
        return hn::ReduceSum(d, sum);
    };
    for (size_t i = 0; i < live_count; ++i) {
        own[i] = INT32_MAX / 2;
        if (totals[i] * (total < 6000 ? 32 : 64) > total)
            own[i] = set_bits(scratch.by_context + 256 * live[i], totals[i]) * 40, own[i] += cost_of(live[i]);
    }
    set_bits(all, total);
    uint8_t group[64] = {};
    for (size_t i = 0; i < live_count; ++i)
        cost[i] = cost_of(live[i]);
    for (size_t trees = 1; trees < max_trees; ++trees) {
        size_t seed = 0;
        for (size_t i = 1; i < live_count; ++i)
            seed = cost[i] - own[i] > cost[seed] - own[seed] ? i : seed;
        int32_t gain = -16 * 150 / step - total * (step - 1) / 8 - (24 + 40 / step) * set_bits(scratch.by_context + 256 * live[seed], totals[seed]);
        for (size_t i = 0; i < live_count; ++i) {
            other[i] = cost_of(live[i]);
            gain += std::max(cost[i] - other[i], 0);
        }
        if (gain < 0)
            break;
        own[seed] = INT32_MAX / 2;
        for (size_t i = 0; i < live_count; ++i) {
            group[i] = other[i] < cost[i] ? trees : group[i];
            cost[i] = std::min(cost[i], other[i]);
        }
    }
    uint8_t numbers[kMaxTrees];
    memset(numbers, 0xFF, sizeof numbers);
    memset(map, 0, sizeof map);
    uint16_t* sums[kMaxTrees];
    for (size_t i = 0; i < live_count; ++i) {
        uint16_t* const counts = scratch.by_context + 256 * live[i];
        if (numbers[group[i]] == 0xFF) {
            sums[numbers[group[i]] = used++] = counts;
        } else {
            uint16_t* const sum = sums[numbers[group[i]]];
            for (size_t j = 0; j < part_count; ++j)
                hn::Store(hn::Load(du, sum + parts[j]) + hn::Load(du, counts + parts[j]), du, sum + parts[j]);
        }
        memset(map + live[i], numbers[group[i]], (i + 1 < live_count ? live[i + 1] : 64) - live[i]);
    }
    for (size_t i = 0; i < 256 * used; i += kLanes)
        hn::Store(hn::PromoteTo(DU32(), hn::Load(hn::Half<DU16>(), sums[i / 256] + i % 256)), DU32(), scratch.counts + i);
    return used;
}

static HWY_NOINLINE void WriteContextMap(const uint8_t (&map)[64], size_t trees, Writer& writer)
{
    constexpr uint32_t kRunCodes = 4;
    const uint32_t bits = Log2(trees - 1);
    writer.Write(4 + bits + 5, bits << 1 | 1 | (trees - 1 - (1 << bits)) << 4 | ((kRunCodes - 1) << 1 | 1) << (4 + bits));
    alignas(32) uint32_t counts[32] = {};
    uint64_t tokens[64], codes[32], order = 0x0706050403020100;
    size_t count = 0;
    for (size_t i = 0; i < 64;) {
        const uint64_t same = order ^ map[i] * 0x0101010101010101;
        const size_t index = __builtin_ctzll((same - 0x0101010101010101) & ~same & 0x8080808080808080) / 8;
        if (index) {
            const uint64_t moved = (uint64_t { 0x100 } << 8 * index) - 1;
            order = (order & ~moved) | (order << 8 & moved) | map[i++];
            tokens[count] = kRunCodes + index;
        } else {
            size_t run = 1;
            while (i + run < 64 && run < (2 << kRunCodes) - 1 && map[i + run] == map[i])
                ++run;
            tokens[count] = uint64_t { run } << 1 << (63 - Log2(run)) | Log2(run);
            i += run;
        }
        ++counts[tokens[count++] % 32];
    }
    static constexpr uint8_t kExtra[32] = { 0, 1, 2, 3, 4 };
    WriteCode(counts, 32, 0, Log2(trees + kRunCodes - 1) + 1, kExtra, codes, writer);
    for (size_t i = 0; i < count; ++i) {
        writer.Add(tokens[i] + codes[tokens[i] % 32]);
        writer.Flush();
    }
    writer.Write(1, 1);
}

static HWY_NOINLINE void CountSomeByContext(const uint8_t* lut, const uint32_t* literals, size_t count, size_t step, WriteScratch& scratch)
{
    memset(scratch.by_context, 0, sizeof scratch.by_context);
    for (size_t i = 0; i < count; i += step) {
        const uint32_t four = literals[i];
        ++scratch.by_context[(lut[four >> 8 & 255] | lut[256 + four % 256]) << 8 | (four >> 16 & 255)];
    }
}

// Replaces the bytes around each literal by its context.
template<bool kIsBinary>
static HWY_NOINLINE void CountByContext(const uint8_t* lut, uint32_t* literals, size_t count, WriteScratch& scratch)
{
    const DU8 d8;
    const DU16 d16;
    const DU32 d;
    memset(scratch.by_context, 0, sizeof scratch.by_context);
    // For ASCII, both tables in one, as differences between rows.
    hn::Vec<DU8> rows[8];
    for (size_t i = 0; i < 8; ++i)
        rows[i] = hn::LoadDup128(d8, lut + 16 * i) | hn::LoadDup128(d8, lut + 256 + 16 * i);
    for (size_t i = 7; i; --i)
        rows[i] ^= rows[i - 1];
    for (size_t done = 0; done < count; done += 512) {
        const size_t end = std::min(done + 512, count);
        for (size_t i = done; i < end; i += 2 * kLanes) {
            const auto a = hn::LoadU(d, literals + i), b = hn::LoadU(d, literals + i + kLanes);
            const auto before = hn::BitCast(d8, hn::OddEven(hn::BitCast(d16, hn::ShiftLeft<16>(b)), hn::BitCast(d16, a)));
            const auto high = hn::ShiftRight<4>(before);
            hn::Vec<DU16> context;
            if constexpr (kIsBinary) {
                const auto range = hn::TableLookupBytes(hn::Dup128VecFromValues(d8, 1, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 6), high);
                const auto both = hn::BitCast(d16, range + hn::VecFromMask(d8, before == hn::Zero(d8)) - hn::VecFromMask(d8, before == hn::Set(d8, 255)));
                context = hn::ShiftLeft<8>(hn::ShiftRight<5>(both) | both);
            } else {
                // Beyond ASCII, what the last byte adds is in the two highest bits.
                const auto beyond = hn::TableLookupBytes(hn::Dup128VecFromValues(d8, 0, 0, 0, 0, 0, 0, 0, 0, 64, 64, 64, 64, 192, 192, 194, 194), high);
                auto ascii = hn::Zero(d8), left = before;
                for (size_t row = 0; row < 8; ++row, left = hn::BitCast(d8, hn::SaturatedSub(hn::BitCast(DI8(), left), hn::Set(DI8(), 16))))
                    ascii ^= LookUpOr0(rows[row], left);
                const auto both = hn::BitCast(d16, ascii | hn::AndNot(hn::AndNot(hn::BitCast(d8, hn::ShiftLeft<6>(hn::BitCast(d16, before))), hn::Set(d8, 64)), beyond));
                context = (both & hn::Set(d16, 0x3C00)) | ((hn::ShiftLeft<8>(both) | hn::ShiftRight<6>(both)) & hn::Set(d16, 0x0300));
            }
            const auto bytes = hn::OddEven(hn::BitCast(d16, b), hn::BitCast(d16, hn::ShiftRight<16>(a)));
            const auto index = hn::BitCast(d, hn::OddEven(hn::BitCast(d8, context), hn::BitCast(d8, bytes)));
            hn::StoreU(index & hn::Set(d, 0xFFFF), d, literals + i);
            hn::StoreU(hn::ShiftRight<16>(index), d, literals + i + kLanes);
        }
        HWY_UNROLL(8)
        for (size_t i = done; i < end; ++i)
            ++scratch.by_context[literals[i]];
    }
}

// After a continuation byte, after a lead byte and after ASCII.
static HWY_NOINLINE size_t CountByUtf8(const uint8_t* lut, uint8_t (&map)[64], uint32_t* literals, size_t count, WriteScratch& scratch)
{
    memset(map, 2, sizeof map);
    Put<uint32_t>(map, 0x01010000);
    memset(scratch.counts, 0, 3 * 256 * sizeof *scratch.counts);
    uint32_t* const counts = scratch.counts;
    for (size_t i = 0; i < count; ++i) {
        const uint32_t four = literals[i];
        ++counts[literals[i] = map[lut[four >> 8 & 255] | lut[256 + four % 256]] << 8 | (four >> 16 & 255)];
    }
    return 3;
}

static HWY_NOINLINE void Regroup(const uint8_t (&map)[64], uint32_t* literals, size_t count)
{
    const DU8 d8;
    const DU32 d;
    const auto pair = [&](size_t at) HWY_ATTR { return hn::LoadDup128(d8, map + at) | hn::ShiftLeft<4>(hn::LoadDup128(d8, map + at + 32)); };
    const auto even = pair(0), odd = pair(16);
    for (size_t i = 0; i < count; i += kLanes) {
        const auto v = hn::LoadU(d, literals + i);
        const auto index = hn::BitCast(d8, v & hn::Set(d, 0x0F00));
        const auto both = hn::IfThenElse(hn::TestBit(v, hn::Set(d, 0x1000)), hn::BitCast(d, hn::TableLookupBytes(odd, index)), hn::BitCast(d, hn::TableLookupBytes(even, index)));
        const auto group = hn::IfThenElse(hn::TestBit(v, hn::Set(d, 0x2000)), hn::ShiftRight<4>(both), both);
        hn::StoreU((group & hn::Set(d, 0x0700)) | (v & hn::Set(d, 0xFF)), d, literals + i);
    }
}

// Of many, a sample will do.
static HWY_NOINLINE void Count(uint32_t* literals, size_t count, WriteScratch& scratch)
{
    const DU32 d;
    const size_t ways = count < 2048 ? 2 : 4, mask = ways * 256 - 1, step = count < 8000 ? 8 : 29;
    memset(scratch.counts, 0, ways * 256 * sizeof *scratch.counts);
    uint32_t *const a = scratch.counts, *const b = a + 256, *const c = a + (512 & mask), *const e = a + (768 & mask);
    std::fill_n(literals + count, 8, literals[0]);
    auto least = hn::Set(d, 255), most = hn::Zero(d);
    for (size_t done = 0, i = 0; done < count; done += 512) {
        const size_t end = std::min(done + 512, count);
        for (size_t j = done; j < end; j += kLanes) {
            const auto byte = hn::ShiftRight<16>(hn::LoadU(d, literals + j)) & hn::Set(d, 255);
            least = hn::Min(least, byte);
            most = hn::Max(most, byte);
            hn::StoreU(byte, d, literals + j);
        }
        for (; i + 8 <= end; i += step) {
            const uint32_t* const eight = literals + i;
            ++a[eight[0]], ++b[eight[1]], ++c[eight[2]], ++e[eight[3]], ++a[eight[4]], ++b[eight[5]], ++c[eight[6]], ++e[eight[7]];
        }
    }
    for (size_t i = count / 8 * 8; i < count; ++i)
        ++a[literals[i]];
    for (size_t i = mask + 1 - kLanes; i >= 256; i -= kLanes)
        hn::Store(hn::Load(d, a + i - 256) + hn::Load(d, a + i), d, a + i - 256);
    for (size_t i = hn::ReduceMin(d, least), last = hn::ReduceMax(d, most); step != 8 && i <= last; ++i)
        a[i] = 2 * a[i] + 1;
}

static HWY_INLINE size_t CountBeyondAscii(const uint32_t* literals, size_t count)
{
    auto sum = hn::Zero(DU32());
    for (size_t i = 0; i < count / 8 * 8; i += kLanes)
        sum += hn::ShiftRight<31>(hn::ShiftLeft<8>(hn::LoadU(DU32(), literals + i)));
    return hn::ReduceSum(DU32(), sum);
}

// Replaces each literal by where its code ends in `packed`.
static HWY_NOINLINE void Pack(uint32_t* literals, size_t count, const uint64_t* codes, uint8_t* packed)
{
    uint64_t bits = 0;
    uint32_t end = 0;
    for (size_t i = 0; i < count; i += 4) {
        const uint32_t start = end & ~7u;
        const uint64_t a = codes[literals[i]], b = codes[literals[i + 1]], c = codes[literals[i + 2]], e = codes[literals[i + 3]];
        uint64_t last_two = c >> (e % 64) | e;
        asm("" : "+r"(last_two));
        bits = ((bits >> (a % 64) | a) >> (b % 64) | b) >> ((c + e) % 64) | last_two;
        literals[i] = end += a;
        literals[i + 1] = end += b;
        literals[i + 2] = end += c;
        literals[i + 3] = end += e;
        Put(packed + start / 8, bits >> ((start - end) % 64));
    }
}

static HWY_NOINLINE void WriteCommands(const Memory& memory, size_t count, const uint64_t* command_codes, const WriteScratch& scratch, Writer& out)
{
    Writer writer = out;
    const uint32_t* ends = memory.literals - 1;
    uint64_t from = 0;
    const uint64_t *const commands = memory.commands, *const distances = memory.distances;
    const uint16_t* const literal_ends = memory.literal_ends;
    const uint8_t* const packed = memory.packed;
    for (size_t i = 0; i < count; ++i) {
        const uint64_t command = commands[i], distance = distances[i], to = ends[literal_ends[i]];
        writer.Add(command + command_codes[static_cast<uint16_t>(command)]);
        if (HWY_UNLIKELY(writer.count % 64 + to - from > 56)) {
            writer.Flush();
            for (; to - from > 48; from += 48)
                writer.Write(48, Read<uint64_t>(packed + from / 8) >> (from % 8));
        }
        writer.Write(to - from, Read<uint64_t>(packed + from / 8) >> (from % 8));
        from = to;
        writer.Add(distance + scratch.distance_codes[static_cast<uint16_t>(distance)]);
        writer.Flush();
    }
    out = writer;
}

// The same without packing. Returns how many bits the literals take.
static HWY_NOINLINE size_t WriteLongInserts(const Memory& memory, size_t count, const uint64_t* command_codes, const WriteScratch& scratch, Writer& out)
{
    Writer writer = out;
    const uint32_t* literal = memory.literals;
    const uint64_t* const codes = scratch.literal_codes;
    size_t others = 0;
    for (size_t i = 0; i < count; ++i) {
        const uint64_t command = memory.commands[i] + command_codes[static_cast<uint16_t>(memory.commands[i])];
        const uint64_t distance = memory.distances[i] + scratch.distance_codes[static_cast<uint16_t>(memory.distances[i])];
        const uint32_t* const end = memory.literals + memory.literal_ends[i];
        writer.Add(command);
        writer.Flush();
        for (const uint32_t* const last = end - 3; literal < last; literal += 4) {
            writer.AddFour(codes[literal[0]], codes[literal[1]], codes[literal[2]], codes[literal[3]]);
            writer.Flush();
        }
        for (size_t j = 0; j < 3; ++j)
            writer.Add(literal + j < end ? codes[literal[j] % (kMaxTrees * 256)] : 0);
        literal = end;
        writer.Flush();
        writer.Add(distance);
        writer.Flush();
        others += command % 64 + distance % 64;
    }
    std::swap(out, writer);
    return (out.at - writer.at) * 8 + 8 - others;
}

static HWY_INLINE size_t Write(const Settings& settings, const Memory& memory, State& state, WriteScratch& scratch, uint8_t* out, size_t position)
{
    const size_t count = state.settled.literals, postfix = settings.postfix_bits[state.kind];
    uint32_t* const literals = memory.literals;
    const auto following = Read<std::array<uint32_t, 16>>(literals + count);
    Writer writer(out, position);
    writer.Write(11, postfix << 3 | settings.direct_codes >> postfix << 5 | (2 + state.is_binary) << 9);
    size_t trees = 1;
    uint8_t map[64];
    const uint8_t* const lut = memory.contexts + 512 * state.is_binary;
    const bool may_have_contexts = settings.max_trees > 1 && count >= settings.min_insert * state.settled.commands;
    bool has_contexts = may_have_contexts && count >= (state.is_binary ? 4000 : 1100);
    if (constexpr size_t kStep = 7; has_contexts && count >= 12000 && !state.had_contexts) {
        CountSomeByContext(lut, literals, count, kStep, scratch);
        has_contexts = Cluster(scratch, 2, kStep, map) > 1;
    }
    if (has_contexts) {
        (state.is_binary ? CountByContext<true> : CountByContext<false>)(lut, literals, count, scratch);
        trees = Cluster(scratch, settings.max_trees, 1, map);
        Regroup(map, literals, count);
    } else if (may_have_contexts && count < 1100 && !state.is_binary && CountBeyondAscii(literals, count) >= 100) {
        trees = CountByUtf8(lut, map, literals, count, scratch);
    } else {
        Count(literals, count, scratch);
        // Eight bits for each take next to nothing to describe.
        if (state.is_binary && count - 16 < 400 && Bits(scratch.counts, kNone.commands, 256, 4) >= static_cast<int32_t>(8 * count))
            std::fill_n(scratch.counts, 256, 1);
    }
    if ((state.had_contexts = trees > 1))
        WriteContextMap(map, trees, writer);
    writer.Write(1 + (trees == 1), 0);
    for (size_t tree = 0; tree < trees; ++tree)
        WriteCode(scratch.counts + 256 * tree, 256, 256, 8, nullptr, scratch.literal_codes + 256 * tree, writer);
    Counts& counts = state.Before();
    const size_t command_count = state.settled.commands, symbols = settings.distance_symbols[state.kind];
    const uint64_t* command_codes = WriteFixedCode(kFixedCommandCodes, memory.commands, command_count, counts.commands, settings.haste, writer);
    if (!command_codes) {
        WriteCode(counts.commands, kCommandSymbols, 0, 10, kCommandBits.data(), scratch.command_codes, writer);
        command_codes = scratch.command_codes;
    }
    if (const uint64_t* fixed = symbols == 64 ? WriteFixedCode(kFixedDistanceCodes, memory.distances, command_count, counts.distances, settings.haste, writer) : nullptr) {
        memcpy(scratch.distance_codes, fixed, 64 * sizeof *fixed);
    } else {
        uint8_t distance_bits[kDistanceSlots];
        const uint32_t first = 16 + settings.direct_codes, slots = DistanceSlots(settings, state);
        memset(distance_bits, 0, 136);
        for (uint32_t i = first, bits = 1; i < slots; i += 2 << postfix)
            memset(distance_bits + i, bits++, 16);
        WriteCode(counts.distances, slots, symbols & ~31u, settings.distance_symbol_bits[state.kind], distance_bits, scratch.distance_codes, writer);
    }
    scratch.distance_codes[kNoDistance] = -uint64_t { kNoDistance };
    size_t literal_bits;
    if (count > 12 * state.settled.commands) {
        literal_bits = WriteLongInserts(memory, command_count, command_codes, scratch, writer);
    } else {
        literals[-1] = 0;
        literals[count] = literals[count + 1] = literals[count + 2] = literals[0];
        Pack(literals, count, scratch.literal_codes, memory.packed);
        literal_bits = (literals + count)[-1];
        WriteCommands(memory, command_count, command_codes, scratch, writer);
    }
    if (count > 256)
        state.literal_cost = LiteralCost(literal_bits, count);
    Put(literals + count, following);
    return writer.Finish(out);
}

// What follows the header of the meta-block that is ready, which has `length` bytes. Nothing if they hardly shrink.
static size_t BrotliQuickWrite(const Settings& settings, const Memory& memory, State& state, Scratch& scratch, size_t length, uint8_t* out, size_t position)
{
    const size_t count = state.settled.literals, most = length * settings.max_size;
    uint32_t* const literals = memory.literals;
    if (count < 4096 || count * 800 < most || BitsOf<4>(reinterpret_cast<const uint8_t*>(literals) + 2, count) * 100 < most)
        position = Write(settings, memory, state, scratch.write, out, position);
    state.now.commands -= state.settled.commands;
    state.now.literals -= count;
    memmove(literals, literals + count, state.now.literals * sizeof *literals);
    memmove(memory.commands, memory.commands + state.settled.commands, state.now.commands * sizeof *memory.commands);
    memmove(memory.distances, memory.distances + state.settled.commands, state.now.commands * sizeof *memory.distances);
    for (size_t i = 0; i < state.now.commands; ++i)
        memory.literal_ends[i] = memory.literal_ends[i + state.settled.commands] - count;
    state.settled.commands = state.settled.literals = state.settled_bits = 0;
    return position;
}

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
using namespace brotli_quick;
HWY_EXPORT(BrotliQuickIndex);
HWY_EXPORT(BrotliQuickParse);
HWY_EXPORT(BrotliQuickClose);
HWY_EXPORT(BrotliQuickWrite);
HWY_EXPORT(BrotliQuickLooksBinary);

static_assert(sizeof(State) == 170 * 64 && sizeof(Scratch) <= 3210 * 64 && alignof(Scratch) == 64);

extern "C" void highway_brotli_quick_index(const Settings* settings, const Memory* memory, const Input* input, size_t at, size_t end, State* state, Scratch* scratch)
{
    BUN_HWY_DISPATCH(BrotliQuickIndex)(*settings, *memory, *input, at, end, *state, *scratch);
}

extern "C" size_t highway_brotli_quick_parse(const Settings* settings, const Memory* memory, const Input* input, size_t at, size_t end, State* state, Scratch* scratch)
{
    return BUN_HWY_DISPATCH(BrotliQuickParse)(*settings, *memory, *input, at, end, *state, *scratch);
}

extern "C" void highway_brotli_quick_close(const Settings* settings, const Memory* memory, const Input* input, size_t end, State* state, Scratch* scratch)
{
    BUN_HWY_DISPATCH(BrotliQuickClose)(*settings, *memory, *input, end, *state, *scratch);
}

extern "C" size_t highway_brotli_quick_write(const Settings* settings, const Memory* memory, State* state, Scratch* scratch, size_t length, uint8_t* out, size_t position)
{
    return BUN_HWY_DISPATCH(BrotliQuickWrite)(*settings, *memory, *state, *scratch, length, out, position);
}

extern "C" bool highway_brotli_quick_looks_binary(const uint8_t* bytes, size_t length)
{
    return BUN_HWY_DISPATCH(BrotliQuickLooksBinary)(bytes, length);
}
} // namespace bun
#endif
