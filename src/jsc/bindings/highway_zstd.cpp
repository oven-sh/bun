// What the encoder in src/zstd does for each literal. It takes lookups in 128 bytes and the compression of bytes to beat the scalar code there.

#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_SSE4 | HWY_AVX2 | HWY_AVX3 | (HWY_AVX3_DL - 1))
#ifndef __OPTIMIZE__
#error "Unless hwy::ChosenTarget::GetIndex() is inlined, the linker may keep that of a file with other targets."
#endif

#include <hwy/detect_compiler_arch.h>
#if HWY_ARCH_X86_64

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_zstd.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <array>
#include <stddef.h>
#include <stdint.h>

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

#if HWY_TARGET != HWY_AVX3_DL

static bool ZstdWriteCodes(const uint8_t*, size_t, const uint16_t*, uint8_t*, size_t, uint64_t*)
{
    return false;
}

static bool ZstdCountBytes(const uint8_t*, size_t, uint32_t*)
{
    return false;
}

#else

namespace hn = hwy::HWY_NAMESPACE;

using D8 = hn::Full512<uint8_t>;
using D16 = hn::Full512<uint16_t>;
using D32 = hn::Full512<uint32_t>;
using D64 = hn::Full512<uint64_t>;
using V8 = hn::Vec<D8>;
using V64 = hn::Vec<D64>;
using M8 = hn::Mask<D8>;

template<class T, class F>
static constexpr auto Tabulate(F entry)
{
    std::array<T, 64 / sizeof(T)> all {};
    for (size_t i = 0; i < all.size(); i++)
        all[i] = static_cast<T>(entry(i));
    return all;
}

static HWY_INLINE M8 HasTopBit(V8 bytes)
{
    return hn::RebindMask(D8(), hn::IsNegative(hn::BitCast(hn::RebindToSigned<D8>(), bytes)));
}

static HWY_INLINE void Append(V8 bytes, M8 kept, uint8_t*& to)
{
    hn::StoreU(hn::Compress(bytes, kept), D8(), to);
    to += hn::CountTrue(D8(), kept);
}

static bool ZstdWriteCodes(const uint8_t* HWY_RESTRICT symbols, size_t count, const uint16_t* HWY_RESTRICT codes, uint8_t* HWY_RESTRICT out,
    size_t room, uint64_t* HWY_RESTRICT written)
{
    const D8 d8;
    const D16 d16;
    const D32 d32;
    const D64 d64;
    const hn::RebindToSigned<D16> di16;
    // Backwards. Those that come first are in the lower halves of the blocks.
    alignas(64) static constexpr auto kOrder = Tabulate<uint8_t>([](size_t i) { return 63 - (i / 16 * 8 + i % 8 + i % 16 / 8 * 32); });
    // By the length of the first of two codes.
    alignas(64) static constexpr auto kFactors = Tabulate<uint32_t>([](size_t len) { return 0x10000u << len | 1; });
    // For each lane: the lowest byte of the last lane of the second vector, those of the lanes before, and zeros.
    alignas(64) static constexpr auto kBefore = Tabulate<uint8_t>([](size_t i) {
        const size_t lane = i / 8, other = i % 8;
        return other == 7 ? 64 + 56 : 8 * other + (other >= lane);
    });
    alignas(64) static constexpr auto kPrevious = Tabulate<uint64_t>([](size_t lane) { return lane + 7; });

    // With each code right above its length.
    const auto half_of = [&](size_t symbol) HWY_ATTR {
        const auto listed = hn::LoadU(d16, codes + symbol), lens = hn::And(listed, hn::Set(d16, 15));
        return hn::BitCast(d8, hn::Or(hn::Shr(hn::Xor(listed, lens), hn::Sub(hn::Set(d16, 12), lens)), lens));
    };
    const auto low_from = [&](size_t symbol) HWY_ATTR { return hn::ConcatEven(d8, half_of(symbol + 32), half_of(symbol)); };
    const auto high_from = [&](size_t symbol) HWY_ATTR { return hn::ConcatOdd(d8, half_of(symbol + 32), half_of(symbol)); };
    const V8 low[] = { low_from(0), low_from(64), low_from(128), low_from(192) };
    const V8 high[] = { high_from(0), high_from(64), high_from(128), high_from(192) };

    // By lane: where its codes end, and the bits behind its last whole byte, without and with those of the lane before.
    V64 end = hn::Zero(d64), own_rest = end, rest = end;
    uint8_t* to = out;
    const auto write = [&](V8 bytes) HWY_ATTR {
        const auto lens = hn::And(hn::BitCast(d16, bytes), hn::Set(d16, 15));
        const auto values = hn::BitCast(di16, hn::Xor(hn::BitCast(d16, bytes), lens));
        const auto first_lens = hn::IndicesFromVec(d32, hn::And(hn::BitCast(d32, bytes), hn::Set(d32, 15)));
        const auto factors = hn::BitCast(di16, hn::TableLookupLanes(hn::Load(d32, kFactors.data()), first_lens));
        const auto pairs = hn::BitCast(d64, hn::WidenMulPairwiseAdd(hn::RebindToSigned<D32>(), values, factors));
        const auto first = hn::Set(d64, 0xFFFFFFFF);
        const auto gap = hn::SumsOf8AbsDiff(hn::BitCast(d8, hn::And(hn::BitCast(d64, lens), first)), hn::BitCast(d8, hn::Set(d64, 0x00100010)));
        const auto fours = hn::OrAnd(hn::Shr(hn::AndNot(first, pairs), gap), pairs, first);

        const auto len = hn::SumsOf8(hn::BitCast(d8, lens));
        const auto before = hn::TwoTablesLookupLanes(d8, hn::BitCast(d8, len), hn::BitCast(d8, end), hn::SetTableIndices(d8, kBefore.data()));
        const auto start = hn::And(hn::SumsOf8(before), hn::Set(d64, 7));
        end = hn::Add(start, len);
        const auto whole = hn::AndNot(hn::Set(d64, 7), end);
        // The lowest 4 bits were those of the length.
        const auto own = hn::Rol(fours, hn::Sub(start, hn::Set(d64, 4)));

        // Four codes are at least 4 bits, so that a byte has bits from at most three lanes.
        const auto with_previous = [&](V64& earlier, V64 current) HWY_ATTR {
            const auto previous = hn::TwoTablesLookupLanes(d64, earlier, current, hn::SetTableIndices(d64, kPrevious.data()));
            earlier = current;
            return hn::Or(own, previous);
        };
        const auto all = with_previous(rest, hn::Shr(with_previous(own_rest, hn::Shr(own, whole)), whole));
        Append(hn::BitCast(d8, all), hn::Eq(hn::BitCast(d8, hn::Shl(hn::Not(hn::Zero(d64)), whole)), hn::Zero(d8)), to);
    };

    // If they are less than 64, the first ones follow codes without bits.
    for (size_t taken = (count - 1) % 64 + 1; count; count -= taken, taken = 64) {
        if (room - static_cast<size_t>(to - out) < 128)
            return false;
        const auto order = hn::Load(d8, kOrder.data());
        const auto ordered = hn::TableLookupLanes(hn::LoadN(d8, symbols + count - taken, taken), hn::IndicesFromVec(d8, order));
        const auto exists = hn::Lt(order, hn::Set(d8, static_cast<uint8_t>(taken)));
        const auto index = hn::IndicesFromVec(d8, hn::And(ordered, hn::Set(d8, 127)));
        auto lows = hn::IfThenElseZero(exists, hn::TwoTablesLookupLanes(d8, low[0], low[1], index));
        auto highs = hn::IfThenElseZero(exists, hn::TwoTablesLookupLanes(d8, high[0], high[1], index));
        if (const auto from_128 = HasTopBit(ordered); !hn::AllFalse(d8, from_128)) {
            lows = hn::IfThenElse(from_128, hn::TwoTablesLookupLanes(d8, low[2], low[3], index), lows);
            highs = hn::IfThenElse(from_128, hn::TwoTablesLookupLanes(d8, high[2], high[3], index), highs);
        }
        write(hn::InterleaveLower(d8, lows, highs));
        write(hn::InterleaveUpper(d8, lows, highs));
    }
    written[0] = to - out;
    written[1] = hn::ExtractLane(rest, 7);
    written[2] = hn::ExtractLane(end, 7) % 8;
    return true;
}

// Adds the bits of each position. Returns the carries.
static HWY_INLINE V64 AddBits(V64& sum, V64 a, V64 b)
{
    const auto different = hn::Xor(a, b);
    const auto carry = hn::BitwiseIfThenElse(different, sum, a);
    sum = hn::Xor(sum, different);
    return carry;
}

// For each position in a lane, adds in how many lanes the bit is set.
static HWY_INLINE V8 CountBits(V64 bits, V8 counts)
{
    alignas(64) uint8_t lanes[64];
    hn::Store(hn::BitCast(D8(), bits), D8(), lanes);
    auto one = hn::Set(D8(), 1);
    // Or else the compiler extracts the masks, and turns them into vectors.
    asm("" : "+m"(lanes), "+v"(one.raw));
    for (size_t lane = 0; lane < 8; lane++)
        counts = hn::MaskedAddOr(counts, hn::LoadMaskBits(D8(), lanes + 8 * lane), counts, one);
    return counts;
}

template<int kShift>
static HWY_INLINE void AddCounts(V8 counts, uint32_t* HWY_RESTRICT to)
{
    alignas(64) uint8_t bytes[64];
    hn::Store(counts, D8(), bytes);
    for (size_t i = 0; i < 64; i += 16) {
        const auto wide = hn::PromoteTo(D32(), hn::Load(hn::Full128<uint8_t>(), bytes + i));
        hn::StoreU(hn::Add(hn::LoadU(D32(), to + i), hn::ShiftLeft<kShift>(wide)), D32(), to + i);
    }
}

static constexpr size_t kGroup = 128;
static constexpr size_t kBatch = 29 * kGroup;
static_assert(kBatch / kGroup * 8 <= UINT8_MAX, "A group adds up to 8 to a byte.");

// The bytes with the same 2 highest bits. The other 6 are the position of a bit in a lane.
struct Bin {
    // Less than a group is left from the batch before, and vectors go beyond the end.
    alignas(64) uint8_t bytes[kBatch + 3 * kGroup];
    size_t len;
    // What is counted, as far as it is not in multiples of 16: ones, twos, fours and eights.
    V64 digits[4];
};

// Leaves the rest at the start, with zeros up to the end of the group.
static HWY_NOINLINE void CountGroups(Bin& bin, uint32_t* HWY_RESTRICT counts)
{
    hn::StoreU(hn::Zero(D8()), D8(), bin.bytes + bin.len);
    hn::StoreU(hn::Zero(D8()), D8(), bin.bytes + bin.len + 64);
    auto [ones, twos, fours, eights] = bin.digits;
    auto sixteens = hn::Zero(D8());
    const uint8_t* group = bin.bytes;
    for (const uint8_t* end = group + bin.len / kGroup * kGroup; group != end; group += kGroup) {
        // Only the lowest byte of each lane counts.
        const auto bit = [&](size_t at) HWY_ATTR { return hn::Rol(hn::Set(D64(), 1), hn::BitCast(D64(), hn::LoadU(D8(), group + at))); };
        const auto four = [&](size_t at) HWY_ATTR {
            const auto a = AddBits(ones, bit(at), bit(at + 1)), b = AddBits(ones, bit(at + 2), bit(at + 3));
            return AddBits(twos, a, b);
        };
        const auto eight = [&](size_t at) HWY_ATTR {
            const auto a = four(at), b = four(at + 4);
            return AddBits(fours, a, b);
        };
        const auto a = eight(0), b = eight(64);
        sixteens = CountBits(AddBits(eights, a, b), sixteens);
    }
    AddCounts<4>(sixteens, counts);
    bin.digits[0] = ones, bin.digits[1] = twos, bin.digits[2] = fours, bin.digits[3] = eights;
    bin.len %= kGroup;
    hn::Store(hn::Load(D8(), group), D8(), bin.bytes);
    hn::Store(hn::Load(D8(), group + 64), D8(), bin.bytes + 64);
}

static HWY_INLINE void CountRest(Bin& bin, uint32_t* HWY_RESTRICT counts)
{
    counts[0] -= kGroup - bin.len;
    bin.len = kGroup;
    CountGroups(bin, counts);
    auto few = hn::Zero(D8());
    for (size_t digit = 4; digit--;)
        few = CountBits(bin.digits[digit], hn::Add(few, few));
    AddCounts<0>(few, counts);
}

// By Harold Aptroot's method: https://bitmath.blogspot.com/2024/11/histogramming-bytes-with-positional.html
static bool ZstdCountBytes(const uint8_t* HWY_RESTRICT bytes, size_t len, uint32_t* HWY_RESTRICT counts)
{
    const D8 d8;
    Bin bins[4];
    for (Bin& bin : bins) {
        bin.len = 0;
        for (V64& digit : bin.digits)
            digit = hn::Zero(D64());
    }
    do {
        const size_t batch = HWY_MIN(len, kBatch);
        uint8_t* ends[4];
        for (size_t i = 0; i < 4; i++)
            ends[i] = bins[i].bytes + bins[i].len;
        const auto sort = [&](V8 some, M8 exists) HWY_ATTR {
            const auto bit7 = HasTopBit(some), bit6 = HasTopBit(hn::Add(some, some));
            Append(some, hn::AndNot(hn::Or(bit7, bit6), exists), ends[0]);
            Append(some, hn::AndNot(bit7, bit6), ends[1]);
            Append(some, hn::AndNot(bit6, bit7), ends[2]);
            Append(some, hn::And(bit7, bit6), ends[3]);
        };
        const size_t whole = batch / 64 * 64;
        for (size_t i = 0; i < whole; i += 64)
            sort(hn::LoadU(d8, bytes + i), hn::SetMask(d8, true));
        sort(hn::LoadN(d8, bytes + whole, batch - whole), hn::FirstN(d8, batch - whole));
        for (size_t i = 0; i < 4; i++) {
            bins[i].len = ends[i] - bins[i].bytes;
            CountGroups(bins[i], counts + 64 * i);
        }
        bytes += batch;
        len -= batch;
    } while (len);
    for (size_t i = 0; i < 4; i++)
        CountRest(bins[i], counts + 64 * i);
    return true;
}

#endif

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {
HWY_EXPORT(ZstdWriteCodes);
HWY_EXPORT(ZstdCountBytes);

// Reads `count` symbols and 256 codes. Whatever these are, writes up to `room` bytes, and 3 numbers.
extern "C" bool highway_zstd_write_codes(const uint8_t* symbols, size_t count, const uint16_t* codes, uint8_t* out, size_t room, uint64_t* written)
{
    return BUN_HWY_DISPATCH(ZstdWriteCodes)(symbols, count, codes, out, room, written);
}

// Reads `len` bytes, and updates 256 counts.
extern "C" bool highway_zstd_count_bytes(const uint8_t* bytes, size_t len, uint32_t* counts)
{
    return BUN_HWY_DISPATCH(ZstdCountBytes)(bytes, len, counts);
}
} // namespace bun
#endif

#endif
