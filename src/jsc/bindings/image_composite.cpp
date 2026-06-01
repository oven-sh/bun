// Bun.Image composite (Porter-Duff `over`) kernel.
//
// Same Highway runtime-dispatch shell as image_resize.cpp: re-included once
// per target ISA via foreach_target.h, with the HWY_ONCE block exporting one
// plain C entry point that HWY_DYNAMIC_DISPATCH-es to the best variant.
//
// Blends one RGBA8 overlay onto the base in premultiplied-alpha space the way
// libvips composites (composite.cpp): premultiply both sides (the overlay
// pass is skipped when the caller says its pixels already are), scale the
// overlay by the layer opacity, accumulate `aR = aA + aB·(1−aA)`,
// `cR = cA + cB·(1−aA)`, then unpremultiply back to straight RGBA8.
//
// ── Exactness contract ──────────────────────────────────────────────────────
// All math is exact 255-denominator fixed point: alphas carry denominator
// 255², premultiplied colours 255³/255⁴, and the only rounding is the final
// `round-half-up(num/den)` per channel. Rounding any intermediate to 8 bits
// would put up to half an LSB of premultiplied error over a tiny `aR` and
// blow up in the unpremultiply (e.g. a (53,122,71,2) overlay at opacity 0.7
// over a transparent base must stay (53,122,71,1), not collapse to 0/255 per
// channel). Integer-only ⇒ output is byte-identical on every platform/ISA
// (docs/runtime/image.mdx "byte-identical" guarantee — no FMA, no
// float-rounding divergence), and identical between the SIMD and scalar
// paths below (test/js/bun/image/image-kernels.test.ts sweeps the seam).
//
// ── Two paths ───────────────────────────────────────────────────────────────
// Opaque base pixel (da == 255, the watermark-on-photo case): `aR` collapses
// to the constant 255·65025, so the per-channel quotient reduces to
//   out = ⌊(n_ps + d·(65025 − w) + 32512) / 65025⌋,  w = sa·op ≤ 65025
// (divide both sides of the general quotient by 255; the +32512 vs
// +⌊8290687/255⌋ bias difference can never bridge an integer boundary, so
// the rounded result is identical). Constant divisor ⇒ SIMD via a
// Granlund-Montgomery multiply: ⌊t/65025⌋ == (t·33818121) >> 41 — exact for
// every t ≤ 33,228,287, brute-force-verified over the full range (the path's
// max is 2·255·65025 + 32512 = 33,195,262). One pixel per iteration, RGBA in
// 4 u32 lanes (same FixedTag<.,4> shape image_resize.cpp uses, universal on
// 128-bit targets).
//
// Non-opaque base pixel: `aR` varies per pixel, so the quotient needs a real
// division — scalar u64, exact, identical formula.

// clang-format off
#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "image_composite.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
// clang-format on

#include <cstdint>

HWY_BEFORE_NAMESPACE();
namespace bun_image {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;

// ⌊t/65025⌋ for t ≤ 33,228,287 (< 2^25.99): (t · 33818121) >> 41.
// M = ⌈2^41/65025⌉ = 33818121; M·65025 − 2^41 = 23,021 ≤ 2^(41−26) ⇒ exact
// over the range (Granlund-Montgomery), brute-force-verified end-to-end
// against the u64 reference for all 65536 (sa·op) products × c/d grids.
constexpr uint64_t kDivM = 33818121;
constexpr int kDivS = 41;

// One pixel: Porter-Duff over, general (any base alpha). Exact u64
// fixed-point; the single rounding is round-half-up via +den/2 then floor.
static HWY_INLINE void BlendPixelScalar(uint8_t* HWY_RESTRICT d, const uint8_t* HWY_RESTRICT s,
    uint64_t opacity, bool premultiplied)
{
    constexpr uint64_t D2 = 255 * 255;
    const uint64_t sa = s[3];
    // Source alpha (denom 255²) and premultiplied colour (denom 255³), both
    // scaled by the layer opacity. Straight input premultiplies here
    // (×alpha); already-premultiplied input keeps its colour and only
    // rescales the denominator (×255) so both paths agree.
    const uint64_t n_as = sa * opacity;
    const uint64_t cmul = premultiplied ? opacity * 255 : sa * opacity;
    const uint64_t n_psr = s[0] * cmul;
    const uint64_t n_psg = s[1] * cmul;
    const uint64_t n_psb = s[2] * cmul;
    // Fully transparent overlay pixel ⇒ identity. (For straight input,
    // `n_as == 0` already implies zero premultiplied colour.)
    if ((n_as | n_psr | n_psg | n_psb) == 0) return;
    const uint64_t da = d[3];
    const uint64_t inv = D2 - n_as; // 1 − aA, denom 255²
    // aR = aA + aB·(1−aA), denom 255³. `n_as ≤ 255²` ⇒ `n_ar ≤ 255³`, so the
    // rounded byte below never exceeds 255.
    const uint64_t n_ar = n_as * 255 + da * inv;
    const auto blend1 = [&](uint64_t n_ps, uint64_t dc) -> uint8_t {
        // cR = cA + cB·(1−aA) in premultiplied space (denom 255⁴), then
        // unpremultiply with one round-half-up division: 255·cR/aR =
        // n_pr/n_ar exactly. Clamp: a hostile `premultiplied: true` layer
        // can claim colour > alpha.
        const uint64_t n_pr = n_ps * 255 + dc * da * inv;
        if (n_ar == 0) return 0;
        const uint64_t q = (n_pr + n_ar / 2) / n_ar;
        return static_cast<uint8_t>(q > 255 ? 255 : q);
    };
    d[0] = blend1(n_psr, d[0]);
    d[1] = blend1(n_psg, d[1]);
    d[2] = blend1(n_psb, d[2]);
    d[3] = static_cast<uint8_t>((n_ar + D2 / 2) / D2);
}

static void CompositeOverImpl(uint8_t* HWY_RESTRICT base, uint32_t bw, uint32_t bh,
    const uint8_t* HWY_RESTRICT overlay, uint32_t ow, uint32_t oh,
    int64_t left, int64_t top, uint32_t opacity, int32_t premultiplied)
{
    // Clip the overlay to the base — offsets may be negative or overhang.
    const int64_t x0 = left > 0 ? left : 0;
    const int64_t y0 = top > 0 ? top : 0;
    const int64_t x1 = (left + static_cast<int64_t>(ow)) < static_cast<int64_t>(bw)
        ? left + static_cast<int64_t>(ow)
        : static_cast<int64_t>(bw);
    const int64_t y1 = (top + static_cast<int64_t>(oh)) < static_cast<int64_t>(bh)
        ? top + static_cast<int64_t>(oh)
        : static_cast<int64_t>(bh);
    if (x0 >= x1 || y0 >= y1 || opacity == 0) return;

    // i32 lanes (not u32): every intermediate is ≤ 33,195,262 < 2^31, and the
    // i32 flavours of Mul/MulEven/DemoteTo are the universally-supported set
    // (same FixedTag<.,4>-per-pixel shape image_resize.cpp uses).
    using D32 = hn::FixedTag<int32_t, 4>;
    const D32 di32;
    const hn::Rebind<uint8_t, D32> du8; // 4× u8 ⇄ 4× i32

    const auto vop = hn::Set(di32, static_cast<int32_t>(opacity));
    // Premultiplied input keeps its colour and only rescales the denominator:
    // n_ps = c·op·255 instead of c·sa·op (both ≤ 255³, exact in i32).
    const auto vpremul = hn::Set(di32, static_cast<int32_t>(opacity * 255));
    const auto vd2 = hn::Set(di32, 255 * 255);
    const auto vbias = hn::Set(di32, 32512); // ⌊65025/2⌋, round-half-up
    const auto v255 = hn::Set(di32, 255);
    const auto vmagic = hn::Set(di32, static_cast<int32_t>(kDivM));
    // Lane 3 is alpha: the colour formula in that lane is garbage (bounded —
    // sa·sa·op ≤ 255³ — so no overflow, just meaningless); an opaque base
    // stays opaque, so patch the lane to 255 before the demote.
    const auto alpha_lane = hn::Eq(hn::Iota(di32, 0), hn::Set(di32, 3));

    const size_t span = static_cast<size_t>(x1 - x0);
    const uint8_t* srow0 = overlay + ((static_cast<size_t>(y0 - top) * ow) + static_cast<size_t>(x0 - left)) * 4;
    uint8_t* drow0 = base + ((static_cast<size_t>(y0) * bw) + static_cast<size_t>(x0)) * 4;
    const bool premul = premultiplied != 0;

    for (int64_t y = y0; y < y1; y++, srow0 += static_cast<size_t>(ow) * 4, drow0 += static_cast<size_t>(bw) * 4) {
        const uint8_t* sp = srow0;
        uint8_t* dp = drow0;
        for (size_t i = 0; i < span; i++, sp += 4, dp += 4) {
            if (dp[3] != 255) {
                // General path: variable aR ⇒ real division. Rare in the
                // watermark case; exact and shared with the tail/edge cases.
                BlendPixelScalar(dp, sp, opacity, premul);
                continue;
            }
            // Opaque-base SIMD path: one pixel across 4 i32 lanes.
            const auto vs = hn::PromoteTo(di32, hn::LoadU(du8, sp)); // [c_r c_g c_b sa]
            const auto vd = hn::PromoteTo(di32, hn::LoadU(du8, dp)); // [d_r d_g d_b 255]
            const auto vsa = hn::Broadcast<3>(vs);
            const auto vw = hn::Mul(vsa, vop); // sa·op ≤ 65025
            // n_ps per colour lane; ≤ 255·65025.
            const auto vnps = premul ? hn::Mul(vs, vpremul) : hn::Mul(vs, vw);
            const auto vinv = hn::Sub(vd2, vw); // 65025 − w
            // t = n_ps + d·inv + 32512 ≤ 2·255·65025 + 32512 < 2^25.99.
            const auto vt = hn::Add(hn::Add(vnps, hn::Mul(vd, vinv)), vbias);
            // ⌊t/65025⌋ via (t·M) >> 41: 32×32→64 widening MulEven/MulOdd
            // (PMULDQ/SMULL — universal), shift, then OR the odd results
            // (each i64's low i32, value < 512) back up one i32 lane.
            const auto qe = hn::ShiftRight<kDivS>(hn::MulEven(vt, vmagic));
            const auto qo = hn::ShiftRight<kDivS>(hn::MulOdd(vt, vmagic));
            const auto q32 = hn::Or(hn::BitCast(di32, qe),
                hn::ShiftLeftLanes<1>(hn::BitCast(di32, qo)));
            // Clamp (hostile premultiplied colour > alpha ⇒ q ≤ 510), then
            // force the alpha lane to 255.
            const auto out = hn::IfThenElse(alpha_lane, v255, hn::Min(q32, v255));
            hn::StoreU(hn::DemoteTo(du8, out), du8, dp);
        }
    }
}

} // namespace HWY_NAMESPACE
} // namespace bun_image
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun_image {

HWY_EXPORT(CompositeOverImpl);

extern "C" {

// In-place Porter-Duff `over` of `overlay` (ow×oh RGBA8) onto `base`
// (bw×bh RGBA8) at (left, top). `opacity` is the per-layer alpha multiplier
// in 1/255 steps (0..=255); `premultiplied` ≠ 0 skips the overlay
// premultiply pass. Negative/overhanging offsets clip to the intersection.
void bun_image_composite_over_rgba8(uint8_t* base, uint32_t bw, uint32_t bh,
    const uint8_t* overlay, uint32_t ow, uint32_t oh,
    int64_t left, int64_t top, uint32_t opacity, int32_t premultiplied)
{
    HWY_DYNAMIC_DISPATCH(CompositeOverImpl)(base, bw, bh, overlay, ow, oh, left, top, opacity, premultiplied);
}

} // extern "C"

} // namespace bun_image
#endif // HWY_ONCE
