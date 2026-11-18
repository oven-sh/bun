// The kernels of src/highway/text.rs: long runs of Latin-1 characters and UTF-16 code units.
//
// A scan or a copy gets at least kMinimumLength units. A scan returns the highest value if it finds nothing.
// No load or store leaves the lengths that a kernel is given.

// Two loads a cycle feed 256-bit vectors as fast as wider ones. The list is that of highway_png.cpp.
#undef HWY_DISABLED_TARGETS
#define HWY_DISABLED_TARGETS (HWY_ALL_SVE | (HWY_AVX2 - 1))
#ifndef __OPTIMIZE__
#error "Unless hwy::ChosenTarget::GetIndex() is inlined, the linker may keep that of a file with other targets."
#endif

#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "highway_text.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
#include "highway_dispatch.h"

#include <stddef.h>
#include <stdint.h>

#ifndef BUN_HIGHWAY_TEXT_TABLES
#define BUN_HIGHWAY_TEXT_TABLES
namespace bun {

static constexpr size_t kMinimumLength = 64;

// For each set of the units in 8 bytes that get a backslash: where the 16 bytes of the result come from. The units
// are the lower half of the vector to look up, and backslashes its upper half.
template<typename T>
struct BackslashShuffles {
    static constexpr unsigned units = 8 / sizeof(T);
    alignas(16) uint8_t sources[1 << units][16] {};

    constexpr BackslashShuffles()
    {
        for (unsigned set = 0; set < (1u << units); ++set) {
            unsigned at = 0;
            for (unsigned unit = 0; unit < units; ++unit) {
                for (unsigned byte = 0; (set >> unit & 1) && byte < sizeof(T); ++byte)
                    sources[set][at++] = 8 + byte;
                for (unsigned byte = 0; byte < sizeof(T); ++byte)
                    sources[set][at++] = unit * sizeof(T) + byte;
            }
        }
    }
};
template<typename T>
static constexpr BackslashShuffles<T> backslashShuffles;

} // namespace bun
#endif

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

template<typename T>
using Wide = hn::ScalableTag<T>;
static_assert(HWY_MAX_BYTES <= kMinimumLength / 2);

// How many units `at` is past a multiple of the size of a vector.
template<class D>
static HWY_INLINE size_t Misalignment(D d, const hn::TFromD<D>* at)
{
    return reinterpret_cast<uintptr_t>(at) / sizeof(*at) % hn::MaxLanes(d);
}

static constexpr size_t kNone = ~size_t { 0 };

// The first or the last lane that is set in two masks in a row, the first of which is for position `at`.
template<bool forward, class D>
static HWY_INLINE size_t Pick(D d, size_t at, hn::Mask<D> a, hn::Mask<D> b)
{
    const uint64_t bits = hn::BitsFromMask(d, a) | hn::BitsFromMask(d, b) << hn::MaxLanes(d);
    if (bits == 0) return kNone;
    return at + (forward ? hwy::Num0BitsBelowLS1Bit_Nonzero64(bits) : 63 - hwy::Num0BitsAboveMS1Bit_Nonzero64(bits));
}

template<bool forward, class D, class Test>
static HWY_INLINE size_t PickAmongFour(D d, size_t lower, size_t upper, Test test)
{
    constexpr size_t N = hn::MaxLanes(D());
    const auto a = test(lower), b = test(lower + N), c = test(upper), e = test(upper + N);
    if (HWY_LIKELY(hn::AllFalse(d, hn::Or(hn::Or(a, b), hn::Or(c, e))))) return kNone;
    const size_t first = forward ? Pick<forward>(d, lower, a, b) : Pick<forward>(d, upper, c, e);
    if (first != kNone) return first;
    return forward ? Pick<forward>(d, upper, c, e) : Pick<forward>(d, lower, a, b);
}

// The first or the last position that passes. `test(at)` has a lane for each position from `at`. Most loads from
// `units` are aligned.
template<bool forward, class D, class Test>
static HWY_INLINE size_t Find(D d, const hn::TFromD<D>* units, size_t len, Test test)
{
    constexpr size_t N = hn::MaxLanes(D());
    const auto four = [&](size_t at) HWY_ATTR { return PickAmongFour<forward>(d, at, at + 2 * N, test); };
    if (4 * N > kMinimumLength && len <= 4 * N) return PickAmongFour<forward>(d, 0, len - 2 * N, test);
    const size_t last = len - 4 * N;
    if (const size_t found = four(forward ? 0 : last); found != kNone) return found;
    if constexpr (forward) {
        for (size_t at = 4 * N - Misalignment(d, units); at < last; at += 4 * N) {
            if (const size_t found = four(at); found != kNone) return found;
        }
    } else {
        for (size_t end = last + (N - Misalignment(d, units + last)) % N; end > 4 * N; end -= 4 * N) {
            if (const size_t found = four(end - 4 * N); found != kNone) return found;
        }
    }
    return four(forward ? last : 0);
}

template<bool forward, typename T>
static HWY_INLINE size_t FindUnit(const T* units, size_t len, T unit)
{
    const Wide<T> d;
    const auto wanted = hn::Set(d, unit);
    const auto test = [=](size_t at) HWY_ATTR { return hn::Eq(hn::LoadU(d, units + at), wanted); };
    return Find<forward>(d, units, len, test);
}

// Where `a` has `x` and `b` has `y`.
template<bool forward, typename T>
static HWY_INLINE size_t FindPair(const T* a, const T* b, size_t len, T x, T y)
{
    const Wide<T> d;
    const auto in_a = hn::Set(d, x), in_b = hn::Set(d, y);
    const auto test = [=](size_t at) HWY_ATTR {
        return hn::And(hn::Eq(hn::LoadU(d, a + at), in_a), hn::Eq(hn::LoadU(d, b + at), in_b));
    };
    return Find<forward>(d, a, len, test);
}

template<typename T>
static HWY_INLINE size_t FindAbove(const T* units, size_t len, T limit)
{
    const Wide<T> d;
    const auto highest = hn::Set(d, limit);
    return Find<true>(d, units, len, [=](size_t at) HWY_ATTR { return hn::Gt(hn::LoadU(d, units + at), highest); });
}

// Not zero for the bytes whose row and column in the 32 bytes of `table` share a bit.
template<class D>
static HWY_INLINE auto LookUpIn(D d, const uint8_t* table)
{
    const auto rows = hn::LoadDup128(d, table), columns = hn::LoadDup128(d, table + 16);
    return [=](hn::Vec<D> bytes) HWY_ATTR {
        const auto row = hn::TableLookupBytes(rows, hn::ShiftRight<4>(bytes));
        return hn::And(row, hn::TableLookupBytes(columns, hn::And(bytes, hn::Set(d, uint8_t { 15 }))));
    };
}

size_t FindInTables8(const uint8_t* units, size_t len, const uint8_t* tables)
{
    const Wide<uint8_t> d;
    const auto look_up = LookUpIn(d, tables);
    return Find<true>(d, units, len, [=](size_t at) HWY_ATTR { return hn::Ne(look_up(hn::LoadU(d, units + at)), hn::Zero(d)); });
}

size_t FindInTables16(const uint16_t* units, size_t len, const uint8_t* tables)
{
    const Wide<uint16_t> d;
    const hn::Repartition<uint8_t, decltype(d)> d8;
    const auto look_up_latin1 = LookUpIn(d8, tables);
    const auto look_up_high = LookUpIn(d8, tables + 32);
    const auto look_up_low = LookUpIn(d8, tables + 64);
    return Find<true>(d, units, len, [=](size_t at) HWY_ATTR {
        const auto loaded = hn::LoadU(d, units + at);
        const auto bytes = hn::BitCast(d8, loaded);
        const auto latin1 = hn::ShiftLeft<8>(hn::BitCast(d, look_up_latin1(bytes)));
        const auto high = hn::ShiftRight<8>(hn::BitCast(d, look_up_high(bytes)));
        const auto low = hn::ShiftLeft<8>(hn::BitCast(d, look_up_low(bytes)));
        const auto wide = hn::Min(high, low);
        return hn::Ne(hn::IfThenElse(hn::Gt(loaded, hn::Set(d, uint16_t { 0xff })), wide, latin1), hn::Zero(d));
    });
}

// The lanes that JSON does not take as they are between quotes.
template<class D>
static HWY_INLINE hn::Mask<D> IsQuoteOrBackslash(D d, hn::Vec<D> units)
{
    return hn::Or(hn::Eq(units, hn::Set(d, '"')), hn::Eq(units, hn::Set(d, '\\')));
}

template<class D>
static HWY_INLINE hn::Mask<D> IsControl(D d, hn::Vec<D> units)
{
    return hn::Eq(hn::Min(units, hn::Set(d, 0x1f)), units);
}

template<typename T>
static HWY_INLINE size_t FindJsonSpecial(const T* units, size_t len)
{
    const Wide<T> d;
    return Find<true>(d, units, len, [=](size_t at) HWY_ATTR {
        const auto loaded = hn::LoadU(d, units + at);
        return hn::Or(IsQuoteOrBackslash(d, loaded), IsControl(d, loaded));
    });
}

size_t FindUnit8(const uint8_t* units, size_t len, uint8_t unit) { return FindUnit<true>(units, len, unit); }
size_t FindUnit16(const uint16_t* units, size_t len, uint16_t unit) { return FindUnit<true>(units, len, unit); }
size_t FindLastUnit8(const uint8_t* units, size_t len, uint8_t unit) { return FindUnit<false>(units, len, unit); }
size_t FindLastUnit16(const uint16_t* units, size_t len, uint16_t unit) { return FindUnit<false>(units, len, unit); }
size_t FindPair8(const uint8_t* a, const uint8_t* b, size_t len, uint8_t x, uint8_t y) { return FindPair<true>(a, b, len, x, y); }
size_t FindPair16(const uint16_t* a, const uint16_t* b, size_t len, uint16_t x, uint16_t y) { return FindPair<true>(a, b, len, x, y); }
size_t FindLastPair8(const uint8_t* a, const uint8_t* b, size_t len, uint8_t x, uint8_t y) { return FindPair<false>(a, b, len, x, y); }
size_t FindLastPair16(const uint16_t* a, const uint16_t* b, size_t len, uint16_t x, uint16_t y) { return FindPair<false>(a, b, len, x, y); }
size_t FindAbove8(const uint8_t* units, size_t len, uint8_t limit) { return FindAbove(units, len, limit); }
size_t FindAbove16(const uint16_t* units, size_t len, uint16_t limit) { return FindAbove(units, len, limit); }
size_t FindJsonSpecial8(const uint8_t* units, size_t len) { return FindJsonSpecial(units, len); }
size_t FindJsonSpecial16(const uint16_t* units, size_t len) { return FindJsonSpecial(units, len); }

size_t FindDifference8(const uint8_t* a, const uint8_t* b, size_t len)
{
    const Wide<uint8_t> d;
    return Find<true>(d, a, len, [=](size_t at) HWY_ATTR { return hn::Ne(hn::LoadU(d, a + at), hn::LoadU(d, b + at)); });
}

size_t FindDifference16And8(const uint16_t* a, const uint8_t* b, size_t len)
{
    const Wide<uint16_t> d;
    const hn::Rebind<uint8_t, decltype(d)> narrow;
    return Find<true>(d, a, len, [=](size_t at) HWY_ATTR {
        return hn::Ne(hn::LoadU(d, a + at), hn::PromoteTo(d, hn::LoadU(narrow, b + at)));
    });
}

// Calls `step(at)` for the positions from which `stride` units cover all. Most stores to `out` are aligned.
template<size_t stride, class D, class Step>
static HWY_INLINE void Cover(D d, const hn::TFromD<D>* out, size_t len, Step step)
{
    static_assert(stride <= kMinimumLength);
    step(0);
    for (size_t at = stride - Misalignment(d, out); at < len - stride; at += stride)
        step(at);
    step(len - stride);
}

void Widen(const uint8_t* HWY_RESTRICT in, size_t len, uint16_t* HWY_RESTRICT out)
{
    const Wide<uint16_t> d;
    const hn::Rebind<uint8_t, decltype(d)> narrow;
    constexpr size_t N = hn::MaxLanes(d);
    Cover<4 * N>(d, out, len, [=](size_t at) HWY_ATTR {
        for (size_t i = at; i < at + 4 * N; i += N)
            hn::StoreU(hn::PromoteTo(d, hn::LoadU(narrow, in + i)), d, out + i);
    });
}

void Narrow(const uint16_t* HWY_RESTRICT in, size_t len, uint8_t* HWY_RESTRICT out)
{
    const Wide<uint8_t> d;
    const hn::RepartitionToWide<decltype(d)> wide;
    constexpr size_t N = hn::MaxLanes(d);
    Cover<2 * N>(d, out, len, [=](size_t at) HWY_ATTR {
        for (size_t i = at; i < at + 2 * N; i += N)
            hn::StoreU(hn::OrderedTruncate2To(d, hn::LoadU(wide, in + i), hn::LoadU(wide, in + i + N / 2)), d, out + i);
    });
}

size_t CountUnit16(const uint16_t* units, size_t len, uint16_t unit)
{
    const Wide<uint16_t> d;
    constexpr size_t N = hn::MaxLanes(d);
    const auto wanted = hn::Set(d, unit);
    const auto ones = [=](size_t at) HWY_ATTR { return hn::VecFromMask(d, hn::Eq(hn::LoadU(d, units + at), wanted)); };
    size_t count = 0;
    size_t at = 0;
    while (at + 2 * N <= len) {
        // A lane that is equal has the value -1. The sum of all lanes fits in one.
        const size_t end = at + HWY_MIN((len - at) / (2 * N), 0xffff / (2 * N)) * (2 * N);
        auto even = hn::Zero(d), odd = hn::Zero(d);
        for (; at < end; at += 2 * N) {
            even = hn::Sub(even, ones(at));
            odd = hn::Sub(odd, ones(at + N));
        }
        count += hn::ReduceSum(d, hn::Add(even, odd));
    }
    if (at + N <= len) {
        count += hn::CountTrue(d, hn::MaskFromVec(ones(at)));
        at += N;
    }
    return count + hn::CountTrue(d, hn::AndNot(hn::FirstN(d, N - (len - at)), hn::MaskFromVec(ones(len - N))));
}

static constexpr size_t kJsonStride = 64;

template<typename T>
using Block = hn::FixedTag<T, 16 / sizeof(T)>;

// What follows the backslash of a control character, or zero if that is `u` and four digits.
template<class D>
static HWY_INLINE hn::Vec<D> LettersOfControls(D d, hn::Vec<D> units)
{
    alignas(16) static constexpr uint8_t letters[16] = { 0, 0, 0, 0, 0, 0, 0, 0, 'b', 't', 'n', 0, 'f', 'r', 0, 0 };
    const hn::Repartition<uint8_t, D> bytes;
    // The last entry, or the first for the upper byte of a wide unit.
    const auto indices = hn::BitCast(bytes, hn::Min(units, hn::Set(d, 15)));
    return hn::BitCast(d, hn::TableLookupBytes(hn::LoadDup128(bytes, letters), indices));
}

// The lanes that may not stand for themselves.
template<typename Out, class D>
static HWY_INLINE hn::Mask<D> NeedsALook(D d, hn::Vec<D> units)
{
    const auto special = hn::Or(IsQuoteOrBackslash(d, units), IsControl(d, units));
    if constexpr (sizeof(hn::TFromD<D>) == 1) {
        return special;
    } else if constexpr (sizeof(Out) == 1) {
        return hn::Or(special, hn::Gt(units, hn::Set(d, 0xff)));
    } else {
        return hn::Or(special, hn::Eq(hn::And(units, hn::Set(d, 0xf800)), hn::Set(d, 0xd800)));
    }
}

// The lanes that take more than a backslash and one unit, or whose next does. `next` has the unit after each lane.
template<typename Out, class D>
static HWY_INLINE hn::Mask<D> IsLeftToCaller(D d, hn::Vec<D> units, hn::Vec<D> next)
{
    const auto long_form = hn::And(IsControl(d, units), hn::Eq(LettersOfControls(d, units), hn::Zero(d)));
    if constexpr (sizeof(hn::TFromD<D>) == 1) {
        return long_form;
    } else if constexpr (sizeof(Out) == 1) {
        return hn::Or(long_form, hn::Gt(units, hn::Set(d, 0xff)));
    } else {
        const auto kind = hn::Set(d, 0xfc00);
        const auto is_lead = hn::Eq(hn::And(units, kind), hn::Set(d, 0xd800));
        const auto has_trail_next = hn::Eq(hn::And(next, kind), hn::Set(d, 0xdc00));
        return hn::Or(long_form, hn::Xor(is_lead, has_trail_next));
    }
}

template<class D, typename Out>
static HWY_INLINE void StoreAs(D d, hn::Vec<D> units, Out* out)
{
    if constexpr (sizeof(Out) == sizeof(hn::TFromD<D>)) {
        hn::StoreU(units, d, out);
    } else if constexpr (sizeof(Out) == 2) {
        const hn::RepartitionToWide<D> wide;
        hn::StoreU(hn::PromoteLowerTo(wide, units), wide, out);
        hn::StoreU(hn::PromoteUpperTo(wide, units), wide, out + hn::Lanes(wide));
    } else {
        const hn::Rebind<uint8_t, D> narrow;
        hn::StoreU(hn::TruncateTo(narrow, units), narrow, out);
    }
}

// Writes the first `count` lanes with their backslashes, and anything up to twice the lanes of a block.
template<typename T, typename Out>
static HWY_INLINE Out* StoreWithBackslashes(hn::Vec<Block<T>> units, size_t count, Out* out)
{
    const Block<T> d;
    const Block<uint8_t> bytes;
    constexpr size_t half = hn::MaxLanes(d) / 2;
    const auto is_control = IsControl(d, units);
    const uint64_t escaped = hn::BitsFromMask(d, hn::Or(IsQuoteOrBackslash(d, units), is_control));
    const auto shown = hn::IfThenElse(is_control, LettersOfControls(d, units), units);
    const auto backslashes = hn::Set(d, '\\');
    const auto spread = [&](hn::Vec<Block<T>> source, uint64_t set, Out* to) HWY_ATTR {
        const auto sources = hn::Load(bytes, backslashShuffles<T>.sources[set]);
        StoreAs(d, hn::BitCast(d, hn::TableLookupBytes(hn::BitCast(bytes, source), sources)), to);
    };
    const uint64_t lower = escaped & ((1u << half) - 1);
    spread(hn::ConcatLowerLower(d, backslashes, shown), lower, out);
    spread(hn::ConcatUpperUpper(d, backslashes, shown), escaped >> half, out + half + hwy::PopCount(lower));
    return out + count + hwy::PopCount(escaped);
}

// Copies a stride. Returns whether each unit stands for itself.
template<typename In, typename Out>
static HWY_INLINE bool CopyPlainStride(const In* HWY_RESTRICT in, Out* HWY_RESTRICT out)
{
    const Wide<In> d;
    auto suspects = hn::MaskFalse(d);
    for (size_t i = 0; i < kJsonStride; i += hn::MaxLanes(d)) {
        const auto units = hn::LoadU(d, in + i);
        StoreAs(d, units, out + i);
        suspects = hn::Or(suspects, NeedsALook<Out>(d, units));
    }
    return hn::AllFalse(d, suspects);
}

static constexpr size_t kJsonStep = 16;

// Sixteen units, and the one after each.
template<typename T>
struct JsonStep;

template<>
struct JsonStep<uint8_t> {
    hn::Vec<Block<uint8_t>> units;

    static HWY_INLINE JsonStep Load(const uint8_t* in) { return { hn::LoadU(Block<uint8_t>(), in) }; }
    static HWY_INLINE JsonStep LoadLast(const uint8_t* in, size_t count)
    {
        const Block<uint8_t> d;
        return { hn::LoadNOr(hn::Set(d, ' '), d, in, count) };
    }

    template<typename Out>
    HWY_INLINE bool IsLeft() const
    {
        const Block<uint8_t> d;
        return !hn::AllFalse(d, IsLeftToCaller<Out>(d, units, units));
    }

    template<typename Out>
    HWY_INLINE Out* Store(size_t count, Out* out, bool) const { return StoreWithBackslashes<uint8_t>(units, count, out); }
};

template<>
struct JsonStep<uint16_t> {
    static constexpr size_t half = kJsonStep / 2;
    hn::Vec<Block<uint16_t>> lower, upper, after_lower, after_upper;

    static HWY_INLINE JsonStep Load(const uint16_t* in)
    {
        const Block<uint16_t> d;
        return { hn::LoadU(d, in), hn::LoadU(d, in + half), hn::LoadU(d, in + 1), hn::LoadU(d, in + half + 1) };
    }
    static HWY_INLINE JsonStep LoadLast(const uint16_t* in, size_t count)
    {
        const Block<uint16_t> d;
        const auto spaces = hn::Set(d, ' ');
        const size_t in_lower = HWY_MIN(count, half);
        const auto lower = hn::LoadNOr(spaces, d, in, in_lower);
        const auto upper = hn::LoadNOr(spaces, d, in + in_lower, count - in_lower);
        return { lower, upper, hn::CombineShiftRightLanes<1>(d, upper, lower), hn::CombineShiftRightLanes<1>(d, spaces, upper) };
    }

    template<typename Out>
    HWY_INLINE bool IsLeft() const
    {
        const Block<uint16_t> d;
        return !hn::AllFalse(d, hn::Or(IsLeftToCaller<Out>(d, lower, after_lower), IsLeftToCaller<Out>(d, upper, after_upper)));
    }

    HWY_INLINE bool FitsBytes() const
    {
        const Block<uint16_t> d;
        return hn::AllTrue(d, hn::Eq(hn::ShiftRight<8>(hn::Or(lower, upper)), hn::Zero(d)));
    }

    template<typename Out>
    HWY_INLINE Out* Store(size_t count, Out* out, bool fits_bytes) const
    {
        if (sizeof(Out) == 1 || fits_bytes)
            return StoreWithBackslashes<uint8_t>(hn::OrderedTruncate2To(Block<uint8_t>(), lower, upper), count, out);
        if constexpr (sizeof(Out) == 2) {
            const size_t in_lower = HWY_MIN(count, half);
            return StoreWithBackslashes<uint16_t>(upper, count - in_lower, StoreWithBackslashes<uint16_t>(lower, in_lower, out));
        }
        return out;
    }
};

// A window tells of an unpaired trail surrogate through the lane before it, which its own first lane does not have.
template<typename In, typename Out>
static HWY_INLINE bool OpensWithLoneTrail(const In* HWY_RESTRICT in, size_t at)
{
    if constexpr (sizeof(In) == 2 && sizeof(Out) == 2) {
        return at != 0 && (in[at] & 0xfc00) == 0xdc00 && (in[at - 1] & 0xfc00) != 0xd800;
    } else {
        return false;
    }
}

// Copies units with the escapes of JSON until they end, the room gets short, or a step has a unit that it leaves to
// the caller. Returns how many it read. The first unit is no trail surrogate.
template<typename In, typename Out>
static HWY_INLINE size_t EscapeJson(const In* HWY_RESTRICT in, size_t len, Out* HWY_RESTRICT out, size_t room, size_t* written)
{
    const Wide<In> wide;
    constexpr size_t lookahead = sizeof(In) - 1;
    Out* const start = out;
    Out* const limit = out + room;
    size_t at = 0;
    bool was_plain = false;

    // Whether a vector has something to escape is hard to predict, whether one of a stride has is easier.
    for (; at + kJsonStride + lookahead <= len && static_cast<size_t>(limit - out) >= 2 * kJsonStride; at += kJsonStride) {
        if (OpensWithLoneTrail<In, Out>(in, at))
            break;
        was_plain = CopyPlainStride(in + at, out);
        if (was_plain) {
            out += kJsonStride;
            continue;
        }
        auto special = hn::MaskFalse(wide), left = hn::MaskFalse(wide);
        auto all = hn::Zero(wide);
        for (size_t i = at; i < at + kJsonStride; i += hn::MaxLanes(wide)) {
            const auto units = hn::LoadU(wide, in + i);
            all = hn::Or(all, units);
            special = hn::Or(special, hn::Or(IsQuoteOrBackslash(wide, units), IsControl(wide, units)));
            left = hn::Or(left, IsLeftToCaller<Out>(wide, units, hn::LoadU(wide, in + i + lookahead)));
        }
        if (!hn::AllFalse(wide, left)) break;
        if (sizeof(In) == 2 && hn::AllFalse(wide, special)) {
            out += kJsonStride;
            continue;
        }
        const bool fits_bytes = hn::AllFalse(wide, hn::Gt(all, hn::Set(wide, 0xff)));
        for (size_t i = at; i < at + kJsonStride; i += kJsonStep)
            out = JsonStep<In>::Load(in + i).Store(kJsonStep, out, fits_bytes);
    }

    // The last stride overlaps the one before it, if that is there as it was.
    if (const size_t rest = len - at; was_plain && rest <= kJsonStride && static_cast<size_t>(limit - out) >= rest && CopyPlainStride(in + len - kJsonStride, out + rest - kJsonStride)) {
        *written = static_cast<size_t>(out - start) + rest;
        return len;
    }

    while (at < len && static_cast<size_t>(limit - out) >= 2 * kJsonStep) {
        if (OpensWithLoneTrail<In, Out>(in, at))
            break;
        const size_t count = HWY_MIN(len - at, kJsonStep);
        const auto step = at + kJsonStep + lookahead <= len ? JsonStep<In>::Load(in + at) : JsonStep<In>::LoadLast(in + at, count);
        if (step.template IsLeft<Out>()) break;
        if constexpr (sizeof(In) == 2) {
            out = step.Store(count, out, step.FitsBytes());
        } else {
            out = step.Store(count, out, true);
        }
        at += count;
    }

    // The caller goes on at a whole character.
    if constexpr (sizeof(In) == 2) {
        const size_t lead = at != 0 && at != len && (in[at - 1] & 0xfc00) == 0xd800;
        at -= lead;
        out -= lead;
    }
    *written = static_cast<size_t>(out - start);
    return at;
}

size_t EscapeJson8To8(const uint8_t* in, size_t len, uint8_t* out, size_t room, size_t* written) { return EscapeJson(in, len, out, room, written); }
size_t EscapeJson8To16(const uint8_t* in, size_t len, uint16_t* out, size_t room, size_t* written) { return EscapeJson(in, len, out, room, written); }
size_t EscapeJson16To8(const uint16_t* in, size_t len, uint8_t* out, size_t room, size_t* written) { return EscapeJson(in, len, out, room, written); }
size_t EscapeJson16To16(const uint16_t* in, size_t len, uint16_t* out, size_t room, size_t* written) { return EscapeJson(in, len, out, room, written); }

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun {

#define BUN_TEXT_KERNEL(name, Kernel, parameters, arguments) \
    HWY_EXPORT(Kernel);                                      \
    extern "C" auto highway_text_##name parameters -> decltype(HWY_STATIC_DISPATCH(Kernel) arguments) { return BUN_HWY_DISPATCH(Kernel) arguments; }

#define BUN_TEXT_KERNELS(bits)                                                                                                                                                                             \
    BUN_TEXT_KERNEL(find_unit##bits, FindUnit##bits, (const uint##bits##_t* units, size_t len, uint##bits##_t unit), (units, len, unit))                                                                   \
    BUN_TEXT_KERNEL(find_last_unit##bits, FindLastUnit##bits, (const uint##bits##_t* units, size_t len, uint##bits##_t unit), (units, len, unit))                                                          \
    BUN_TEXT_KERNEL(find_pair##bits, FindPair##bits, (const uint##bits##_t* a, const uint##bits##_t* b, size_t len, uint##bits##_t x, uint##bits##_t y), (a, b, len, x, y))                                \
    BUN_TEXT_KERNEL(find_last_pair##bits, FindLastPair##bits, (const uint##bits##_t* a, const uint##bits##_t* b, size_t len, uint##bits##_t x, uint##bits##_t y), (a, b, len, x, y))                       \
    BUN_TEXT_KERNEL(find_above##bits, FindAbove##bits, (const uint##bits##_t* units, size_t len, uint##bits##_t limit), (units, len, limit))                                                               \
    BUN_TEXT_KERNEL(find_in_tables##bits, FindInTables##bits, (const uint##bits##_t* units, size_t len, const uint8_t* tables), (units, len, tables))                                                      \
    BUN_TEXT_KERNEL(find_json_special##bits, FindJsonSpecial##bits, (const uint##bits##_t* units, size_t len), (units, len))                                                                               \
    BUN_TEXT_KERNEL(escape_json##bits##_to8, EscapeJson##bits##To8, (const uint##bits##_t* in, size_t len, uint8_t* out, size_t room, size_t* written), (in, len, out, room, written))                     \
    BUN_TEXT_KERNEL(escape_json##bits##_to16, EscapeJson##bits##To16, (const uint##bits##_t* in, size_t len, uint16_t* out, size_t room, size_t* written), (in, len, out, room, written))

BUN_TEXT_KERNELS(8)
BUN_TEXT_KERNELS(16)
BUN_TEXT_KERNEL(find_difference8, FindDifference8, (const uint8_t* a, const uint8_t* b, size_t len), (a, b, len))
BUN_TEXT_KERNEL(find_difference16_and8, FindDifference16And8, (const uint16_t* a, const uint8_t* b, size_t len), (a, b, len))
BUN_TEXT_KERNEL(widen, Widen, (const uint8_t* in, size_t len, uint16_t* out), (in, len, out))
BUN_TEXT_KERNEL(narrow, Narrow, (const uint16_t* in, size_t len, uint8_t* out), (in, len, out))
BUN_TEXT_KERNEL(count_unit16, CountUnit16, (const uint16_t* units, size_t len, uint16_t unit), (units, len, unit))

} // namespace bun
#endif
