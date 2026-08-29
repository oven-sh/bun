// Mask of an at-most-64-lane vector -> one bit per lane in a uint64_t, on every
// Highway target. Per-target code: include after <hwy/highway.h> from a file that
// foreach_target.h re-includes, like Highway's own *-inl.h headers.

#if defined(BUN_HIGHWAY_MASK_BITS_INL_H_) == defined(HWY_TARGET_TOGGLE)
#ifdef BUN_HIGHWAY_MASK_BITS_INL_H_
#undef BUN_HIGHWAY_MASK_BITS_INL_H_
#else
#define BUN_HIGHWAY_MASK_BITS_INL_H_
#endif

#include <hwy/highway.h>
#include <string.h>

HWY_BEFORE_NAMESPACE();
namespace bun {
namespace HWY_NAMESPACE {

// Bit i = lane i of `m`; bits at and above Lanes(d) are zero.
template<class D, class M>
static HWY_INLINE uint64_t MaskBits(D d, M m)
{
    static_assert(HWY_MAX_LANES_D(D) <= 64, "the bits of one vector must fit a uint64_t");
#if HWY_TARGET <= HWY_AVX3
    // The AVX-512 mask register already is the bit layout (__mmask8..64).
    (void)d;
    return static_cast<uint64_t>(m.raw);
#elif HWY_HAVE_SCALABLE
    // SVE, RVV: the lane count is a runtime value, so Highway has no BitsFromMask.
    // StoreMaskBits fills lane 0 into bit 0 of byte 0 onward and may write up to
    // 8 bytes; what it leaves past Lanes(d) is unspecified.
    static_assert(HWY_IS_LITTLE_ENDIAN, "byte k must land in bits 8k..8k+7");
    uint8_t bytes[8];
    hwy::HWY_NAMESPACE::StoreMaskBits(d, m, bytes);
    uint64_t bits;
    memcpy(&bits, bytes, sizeof(bits));
    const size_t n = hwy::HWY_NAMESPACE::Lanes(d);
    return n < 64 ? bits & ((uint64_t { 1 } << n) - 1) : bits;
#else
    // NEON has no movemask either, but BitsFromMask (~6 instructions) avoids
    // StoreMaskBits' round-trip through memory.
    return hwy::HWY_NAMESPACE::BitsFromMask(d, m);
#endif
}

} // namespace HWY_NAMESPACE
} // namespace bun
HWY_AFTER_NAMESPACE();

#endif // BUN_HIGHWAY_MASK_BITS_INL_H_ toggle
