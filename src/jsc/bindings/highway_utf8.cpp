// The kernel of src/highway/utf8.rs: from UTF-8 to UTF-16.
//
// It reads at most `len` bytes and writes at most `room` units: a step over n bytes is taken where there is room for
// n units.

// One target for each way to close the gaps between units: a table for 16 or 32 bytes, or an instruction.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | HWY_NEON | HWY_NEON_BF16 | HWY_SSE4 | HWY_AVX3 | (HWY_AVX3_DL - 1))
#ifndef __OPTIMIZE__
#error "Unless hwy::ChosenTarget::GetIndex() is inlined, the linker may keep that of a file with other targets."
#endif

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_utf8.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#ifndef BUN_HIGHWAY_UTF8_TABLES
#define BUN_HIGHWAY_UTF8_TABLES
namespace bun {

struct Utf8Progress {
    size_t read;
    size_t written;
};

// For each set of units among eight: where their bytes come from, and their number.
static constexpr struct Compressions {
    alignas(16) uint8_t sources[256][16] {};
    uint8_t counts[256] {};

    constexpr Compressions()
    {
        for (unsigned set = 0; set < 256; ++set) {
            for (unsigned unit = 0; unit < 8; ++unit) {
                if (set >> unit & 1) {
                    sources[set][2 * counts[set]] = 2 * unit;
                    sources[set][2 * counts[set]++ + 1] = 2 * unit + 1;
                }
            }
        }
    }
} compressions;

static constexpr size_t kBlock = 16;
static constexpr size_t kStride = 64;

} // namespace bun
#endif

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

using Wide = hn::ScalableTag<uint8_t>;
using Block = hn::Full128<uint8_t>;
static_assert(HWY_MAX_BYTES <= kStride);

template<class D>
static HWY_INLINE hn::Mask<D> HasTopBit(D d, hn::Vec<D> bytes)
{
    return hn::RebindMask(d, hn::IsNegative(hn::BitCast(hn::RebindToSigned<D>(), bytes)));
}

// The top bit of a lane says whether it is at least `lowest`, which has its own top bit set.
template<class D>
static HWY_INLINE hn::Vec<D> AtLeast(D d, hn::Vec<D> bytes, uint8_t lowest)
{
    return hn::SaturatedSub(bytes, hn::Set(d, lowest - 0x80));
}

template<class D>
static HWY_INLINE bool AnyAtLeast(D d, hn::Vec<D> bytes, uint8_t lowest)
{
    return !hn::AllFalse(d, HasTopBit(d, AtLeast(d, bytes, lowest)));
}

// For each block of `bytes` the one before it.
template<class D>
static HWY_INLINE hn::Vec<D> BlocksBefore(D d, hn::Vec<D> bytes, hn::Vec<D> previous)
{
    const hn::Repartition<uint64_t, D> words;
    if constexpr (hn::MaxLanes(d) == kBlock)
        return previous;
    else if constexpr (hn::MaxLanes(d) == 2 * kBlock)
        return hn::ConcatLowerUpper(d, bytes, previous);
    else
        return hn::BitCast(d, hn::TwoTablesLookupLanes(words, hn::BitCast(words, previous), hn::BitCast(words, bytes), hn::IndicesFromVec(words, hn::Iota(words, 6))));
}

// Keiser and Lemire, "Validating UTF-8 in less than one instruction per byte" (2021): each bit stands for a kind of
// error, which is there if three half bytes in a row allow it. The top bit is for two continuation bytes.
template<class D>
static HWY_INLINE hn::Vec<D> ErrorsOfPairs(D d, hn::Vec<D> first, hn::Vec<D> second)
{
    constexpr uint8_t tooShort = 1, tooLong = 2, overlong3 = 4, tooLarge = 8, surrogate = 16, overlong2 = 32;
    constexpr uint8_t overlong4 = 64, tooLarge8 = 64, continues = 128;
    constexpr uint8_t any = tooShort | tooLong | continues, above4 = any | tooLarge | tooLarge8;
    constexpr uint8_t continuation = tooLong | overlong2 | continues;
    const auto ofFirstHigh = hn::Dup128VecFromValues(d,
        tooLong, tooLong, tooLong, tooLong, tooLong, tooLong, tooLong, tooLong, continues, continues, continues, continues,
        tooShort | overlong2, tooShort, tooShort | overlong3 | surrogate, tooShort | tooLarge | tooLarge8 | overlong4);
    const auto ofFirstLow = hn::Dup128VecFromValues(d,
        any | overlong2 | overlong3 | overlong4, any | overlong2, any, any, any | tooLarge, above4, above4, above4,
        above4, above4, above4, above4, above4, above4 | surrogate, above4, above4);
    const auto ofSecondHigh = hn::Dup128VecFromValues(d,
        tooShort, tooShort, tooShort, tooShort, tooShort, tooShort, tooShort, tooShort,
        continuation | overlong3 | overlong4 | tooLarge8, continuation | overlong3 | tooLarge,
        continuation | surrogate | tooLarge, continuation | surrogate | tooLarge, tooShort, tooShort, tooShort, tooShort);
    const auto ofFirst = hn::And(hn::TableLookupBytes(ofFirstHigh, hn::ShiftRight<4>(first)), hn::TableLookupBytes(ofFirstLow, hn::And(first, hn::Set(d, 15))));
    return hn::And(ofFirst, hn::TableLookupBytes(ofSecondHigh, hn::ShiftRight<4>(second)));
}

// The units for the lower or the upper half of the lanes: of each block, or of all if an instruction closes the gaps.
template<bool upper, class D>
static HWY_INLINE hn::Vec<D> Zip(D d, hn::Vec<D> low, hn::Vec<D> high)
{
    if constexpr (hn::MaxLanes(d) == kStride)
        return upper ? hn::InterleaveWholeUpper(d, low, high) : hn::InterleaveWholeLower(d, low, high);
    else
        return upper ? hn::InterleaveUpper(d, low, high) : hn::InterleaveLower(d, low, high);
}

template<class D>
static HWY_INLINE uint16_t* StoreKept(D d, hn::Vec<D> lower, hn::Vec<D> upper, uint64_t kept, uint16_t* out)
{
    const auto set = [=](int eight) { return kept >> 8 * eight & 0xff; };
    const auto sources = [=](int eight) HWY_ATTR { return hn::Load(Block(), compressions.sources[set(eight)]); };
    const auto store = [&](hn::Vec<Block> units, int eight) HWY_ATTR {
        hn::StoreU(units, Block(), reinterpret_cast<uint8_t*>(out));
        out += HWY_ARCH_X86 ? hwy::PopCount(set(eight)) : compressions.counts[set(eight)];
    };
    if constexpr (hn::MaxLanes(d) == kBlock) {
        store(hn::TableLookupBytes(lower, sources(0)), 0);
        store(hn::TableLookupBytes(upper, sources(1)), 1);
    } else if constexpr (hn::MaxLanes(d) == 2 * kBlock) {
        lower = hn::TableLookupBytes(lower, hn::Combine(d, sources(2), sources(0)));
        upper = hn::TableLookupBytes(upper, hn::Combine(d, sources(3), sources(1)));
        store(hn::LowerHalf(Block(), lower), 0);
        store(hn::LowerHalf(Block(), upper), 1);
        store(hn::UpperHalf(Block(), lower), 2);
        store(hn::UpperHalf(Block(), upper), 3);
    } else {
        const hn::RepartitionToWide<D> wide;
        for (const auto units : { lower, upper }) {
            hn::StoreU(hn::Compress(hn::BitCast(wide, units), hn::Mask<decltype(wide)> { static_cast<uint32_t>(kept) }), wide, out);
            out += hwy::PopCount(static_cast<uint32_t>(kept));
            kept >>= 32;
        }
    }
    return out;
}

// A character is written for the lane of its last byte, and a lead surrogate for the one before that, if `counted`
// has the lane. What is wrong is added to `errors`, or found by the next step if the sequence has only begun.
template<bool hasFourBytes, class D>
static HWY_INLINE uint16_t* Step(D d, hn::Vec<D> bytes, hn::Vec<D> previous, uint64_t counted, hn::Vec<D>& errors, uint16_t* out)
{
    const hn::RebindToSigned<D> di;
    const hn::RepartitionToWide<D> wide;
    const auto before = BlocksBefore(d, bytes, previous);
    const auto back1 = hn::CombineShiftRightBytes<15>(d, bytes, before);
    const auto back2 = hn::CombineShiftRightBytes<14>(d, bytes, before);
    const auto isFourth = hasFourBytes ? AtLeast(d, hn::CombineShiftRightBytes<13>(d, bytes, before), 0xf0) : hn::Zero(d);
    const auto mustContinue = hn::And(hn::Or(AtLeast(d, back2, 0xe0), isFourth), hn::Set(d, 0x80));
    errors = hn::Or(errors, hn::Xor(mustContinue, ErrorsOfPairs(d, back1, bytes)));
    const uint64_t kept = ~hn::BitsFromMask(d, HasTopBit(d, hn::Or(AtLeast(d, bytes, 0xc0), AtLeast(d, back1, 0xe0)))) & counted;

    const auto middle = hn::IfThenElseZero(hn::RebindMask(d, hn::Lt(hn::BitCast(di, bytes), hn::Set(di, -0x40))), back1);
    const auto low = hn::Or(hn::And(bytes, hn::Set(d, 0x7f)), hn::ShiftLeft<6>(middle));
    const auto top = hn::SaturatedSub(back2, hn::Set(d, 0xe0));
    auto high = hn::And(hn::BitCast(d, hn::ShiftRight<2>(hn::BitCast(wide, middle))), hn::Set(d, 15));
    if constexpr (!hasFourBytes) {
        high = hn::Or(high, hn::BitCast(d, hn::ShiftLeft<4>(hn::BitCast(wide, top))));
        return StoreKept(d, Zip<false>(d, low, high), Zip<true>(d, low, high), kept, out);
    }
    high = hn::Or3(high, hn::ShiftLeft<4>(top), hn::IfThenElseZero(HasTopBit(d, isFourth), hn::Set(d, 0xdc)));
    const auto isThird = hn::VecFromMask(d, HasTopBit(d, AtLeast(d, back2, 0xf0)));
    const auto leads = [=](hn::Vec<D> units, hn::Vec<D> where) HWY_ATTR {
        const auto lead = hn::Add(hn::ShiftRight<4>(hn::BitCast(wide, units)), hn::Set(wide, 0xd800 - 0x40));
        return hn::IfVecThenElse(where, hn::BitCast(d, lead), units);
    };
    return StoreKept(d, leads(Zip<false>(d, low, high), Zip<false>(d, isThird, isThird)), leads(Zip<true>(d, low, high), Zip<true>(d, isThird, isThird)), kept, out);
}

// 1 to 15 bytes, and zeros.
static HWY_INLINE hn::Vec<Block> LoadFew(const uint8_t* in, size_t len)
{
    const auto load = [=]<typename Word>(size_t at) -> uint64_t { Word word; hwy::CopyBytes<sizeof(word)>(in + at, &word); return word; };
    uint64_t lower = 0, upper = 0;
    if (len >= 8) {
        lower = load.operator()<uint64_t>(0);
        upper = load.operator()<uint64_t>(len - 8) >> 8 * (15 - len) >> 8;
    } else if (len >= 4) {
        lower = load.operator()<uint32_t>(0) | load.operator()<uint32_t>(len - 4) << 8 * (len - 4);
    } else {
        lower = in[0] | uint64_t { in[len / 2] } << 8 * (len / 2) | uint64_t { in[len - 1] } << 8 * (len - 1);
    }
    return hn::BitCast(Block(), hn::Dup128VecFromValues(hn::Full128<uint64_t>(), lower, upper));
}

template<class D, size_t stride>
struct Decoder {
    static constexpr D d {};
    static constexpr size_t N = hn::MaxLanes(d);
    const uint8_t* const in;
    const size_t len;
    uint16_t* const start;
    const size_t room;
    size_t at = 0;
    uint16_t* out = start;
    hn::Vec<D> previous = hn::Zero(d);

    HWY_INLINE bool HasRoom() const { return static_cast<size_t>(start + room - out) >= stride; }

    // Returns true at a stride that is for the other kind of step, and false if none can be taken.
    template<bool hasFourBytes>
    HWY_INLINE bool Strides()
    {
        const hn::RepartitionToWide<D> wide;
        for (; len - at >= stride && HasRoom(); at += stride) {
            auto highest = previous;
            for (size_t i = 0; i < stride; i += N)
                highest = hn::Max(highest, hn::LoadU(d, in + at + i));
            // Whether a block is ASCII is hard to predict, whether four of them are is easier.
            if (stride == kStride && !AnyAtLeast(d, highest, 0x80)) {
                for (size_t i = 0; HWY_ARCH_X86 && i < stride; i += N / 2)
                    hn::StoreU(hn::PromoteTo(wide, hn::LoadU(hn::Half<D>(), in + at + i)), wide, out + i);
                for (size_t i = 0; !HWY_ARCH_X86 && i < stride; i += N)
                    hn::StoreInterleaved2(hn::LoadU(d, in + at + i), hn::Zero(d), d, reinterpret_cast<uint8_t*>(out + i));
                out += stride;
                continue;
            }
            if (AnyAtLeast(d, highest, 0xf0) != hasFourBytes)
                return true;
            auto errors = hn::Zero(d), last = previous;
            uint16_t* end = out;
            for (size_t i = 0; i < stride; i += N) {
                const auto bytes = hn::LoadU(d, in + at + i);
                end = Step<hasFourBytes>(d, bytes, last, ~uint64_t { 0 }, errors, end);
                last = bytes;
            }
            if (!hn::AllBits0(d, errors))
                return false;
            out = end;
            previous = last;
        }
        return false;
    }

    // Fewer bytes than a vector has, followed by zeros, which end a sequence that is not complete.
    HWY_INLINE bool Last(size_t rest)
    {
        hn::Vec<D> bytes;
        if constexpr (N == kBlock)
            bytes = len < N ? LoadFew(in, len) : hn::SlideDownLanes(d, hn::LoadU(d, in + len - N), N - rest);
        else
            bytes = hn::LoadN(d, in + at, rest);
        const uint64_t counted = (uint64_t { 1 } << rest) - 1;
        auto errors = hn::Zero(d);
        uint16_t* end = AnyAtLeast(d, hn::Max(bytes, previous), 0xf0) ? Step<true>(d, bytes, previous, counted, errors, out) : Step<false>(d, bytes, previous, counted, errors, out);
        if (!hn::AllBits0(d, errors))
            return false;
        out = end;
        return true;
    }

    HWY_INLINE Utf8Progress Run()
    {
        while (Strides<false>() && Strides<true>()) { }
        if constexpr (N == stride) {
            if (const size_t rest = len - at; rest != 0 && rest < N && HasRoom() && Last(rest))
                return { len, static_cast<size_t>(out - start) };
        }
        // Back to the start of a sequence that has only begun. Of four bytes, the third has left a unit.
        const auto limits = hn::Dup128VecFromValues(Block(), 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xf0 - 0x80, 0xe0 - 0x80, 0xc0 - 0x80);
        const auto unfinished = HasTopBit(Block(), hn::SaturatedSub(hn::ExtractBlock<N / kBlock - 1>(previous), limits));
        const size_t begun = kBlock - hwy::Num0BitsBelowLS1Bit_Nonzero64(hn::BitsFromMask(Block(), unfinished) | 1u << kBlock);
        return { at - begun, static_cast<size_t>(out - start) - (begun == 3 && out != start) };
    }
};

static HWY_INLINE Utf8Progress DecodeBlocks(const uint8_t* in, size_t len, uint16_t* out, size_t room) { return Decoder<Block, kBlock> { in, len, out, room }.Run(); }
static Utf8Progress DecodeStrides(const uint8_t* in, size_t len, uint16_t* out, size_t room) { return Decoder<Wide, kStride> { in, len, out, room }.Run(); }

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {

HWY_EXPORT(DecodeStrides);

extern "C" Utf8Progress highway_utf8_decode(const uint8_t* in, size_t len, uint16_t* out, size_t room)
{
    const auto done = len < 2 * kBlock ? Utf8Progress {} : BUN_HWY_DISPATCH(DecodeStrides)(in, len, out, room);
    if (done.read == len)
        return done;
    const auto rest = HWY_STATIC_DISPATCH(DecodeBlocks)(in + done.read, len - done.read, out + done.written, room - done.written);
    return { done.read + rest.read, done.written + rest.written };
}

} // namespace bun
#endif
