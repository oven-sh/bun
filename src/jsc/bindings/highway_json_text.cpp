// The kernels of src/highway/json_text.rs: steps of a JSON parser over a few characters. LTO has to inline them,
// because a call takes longer than they do.

#include <hwy/highway.h>

#include <stddef.h>
#include <stdint.h>

namespace bun {

// From `ones + 32 - n` on, `n` bytes are clear and the others are set.
struct LeadingZeros {
    uint8_t ones[64] {};

    constexpr LeadingZeros()
    {
        for (unsigned at = 32; at < 64; ++at)
            ones[at] = 0xff;
    }
};
alignas(64) static constexpr LeadingZeros leadingZeros;

} // namespace bun

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

using Bytes = hn::Full128<uint8_t>;

// 16 if none is set.
static HWY_INLINE uint32_t FirstSet(hn::Mask<Bytes> mask)
{
#if HWY_ARCH_X86
    return hwy::Num0BitsBelowLS1Bit_Nonzero32(static_cast<uint32_t>(hn::BitsFromMask(Bytes {}, mask)) | 1u << 16);
#else
    const intptr_t found = hn::FindFirstTrue(Bytes {}, mask);
    return found < 0 ? 16 : static_cast<uint32_t>(found);
#endif
}

static HWY_INLINE uint32_t FirstClear(hn::Mask<Bytes> mask)
{
#if HWY_ARCH_X86
    return hwy::Num0BitsBelowLS1Bit_Nonzero32(~static_cast<uint32_t>(hn::BitsFromMask(Bytes {}, mask)));
#else
    return FirstSet(hn::Not(mask));
#endif
}

static HWY_INLINE bool StartsWith(const uint8_t* text, const uint8_t* prefix, size_t len)
{
    const Bytes d;
    const uint8_t* ignored = leadingZeros.ones + 32 - len;
    const auto agrees = [&](size_t at) HWY_ATTR {
        const auto same = hn::Eq(hn::LoadU(d, text + at), hn::Load(d, prefix + at));
        return hn::Or(hn::VecFromMask(d, same), hn::LoadU(d, ignored + at));
    };
    return hn::AllTrue(d, hn::MaskFromVec(hn::And(agrees(0), agrees(16))));
}

// With bit 1 flipped, the quotation mark comes right after the control characters.
static HWY_INLINE uint32_t PlainAsciiLength(const uint8_t* text)
{
    const Bytes d;
    const hn::RebindToSigned<Bytes> di;
    const auto bytes = hn::LoadU(d, text);
    const auto flipped = hn::BitCast(di, hn::Xor(bytes, hn::Set(d, 2)));
    const auto is_low = hn::RebindMask(d, hn::Lt(flipped, hn::Set(di, 0x21)));
    return FirstSet(hn::Or(is_low, hn::Eq(bytes, hn::Set(d, '\\'))));
}

static HWY_INLINE uint32_t WhiteSpaceLength(const uint8_t* text)
{
    // The one with these low four bits, or a byte that has others.
    alignas(16) static constexpr uint8_t blanks[16] = { ' ', 0, 0, 0, 0, 0, 0, 0, 0, '\t', '\n', 0, 0, '\r', 0, 0 };
    const Bytes d;
    const auto bytes = hn::LoadU(d, text);
    return FirstClear(hn::Eq(hn::TableLookupBytes(hn::Load(d, blanks), hn::And(bytes, hn::Set(d, 15))), bytes));
}

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

namespace bun {

#define BUN_JSON_KERNEL extern "C" __attribute__((always_inline))

// Both have 32 bytes, `prefix` is aligned to 16, and `len` is at most 32.
BUN_JSON_KERNEL bool highway_json_starts_with(const uint8_t* text, const uint8_t* prefix, size_t len)
{
    return HWY_STATIC_DISPATCH(StartsWith)(text, prefix, len);
}

BUN_JSON_KERNEL uint32_t highway_json_plain_ascii_length(const uint8_t* text)
{
    return HWY_STATIC_DISPATCH(PlainAsciiLength)(text);
}

BUN_JSON_KERNEL uint32_t highway_json_white_space_length(const uint8_t* text)
{
    return HWY_STATIC_DISPATCH(WhiteSpaceLength)(text);
}

} // namespace bun
