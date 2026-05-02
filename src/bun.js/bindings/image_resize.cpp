// Bun.Image resize / rotate kernels.
//
// Highway gives runtime SIMD dispatch the same way highway_strings.cpp does:
// this file is re-included once per target ISA via foreach_target.h, each pass
// compiles the HWY_NAMESPACE block for that ISA, and the HWY_ONCE block at the
// bottom exports plain C entry points that HWY_DYNAMIC_DISPATCH to the best
// variant at runtime.
//
// Pixel format is RGBA8 throughout — the codec layer normalises to that on
// decode so the kernels don't branch on channel count.
//
// Resize is separable two-pass (horizontal then vertical). Filter kernels and
// the half-pixel-centre convention `(i+0.5)*shrink - 0.5` were verified against
// libvips' `templates.h`/`reduceh.cpp` (see PR #30032 discussion); the bcCubic/
// sinc/lanczos formulas are identical. Two intentional differences vs libvips:
//   - edge mode: we clamp the span to [0,src) and renormalise the truncated
//     weights (stb_image_resize's approach); libvips embeds the input with
//     VIPS_EXTEND_COPY and always evaluates the full kernel. Both preserve DC.
//   - weights are f32 here; libvips uses i16 fixed-point for the uchar path
//     (more lanes, imperceptible precision loss). Worth taking later.
// Weights are precomputed per output column/row; the inner loop is a SIMD
// u8→f32 promote → FMA(broadcast) over taps.

// clang-format off
#undef HWY_TARGET_INCLUDE
#define HWY_TARGET_INCLUDE "image_resize.cpp"
#include <hwy/foreach_target.h>
#include <hwy/highway.h>
// clang-format on

#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>

#ifndef BUN_IMAGE_SPAN_DEFINED
#define BUN_IMAGE_SPAN_DEFINED
namespace bun_image {
// One contribution span: for output pixel `i`, sum src[start..start+n) * w[..n).
// Defined outside HWY_NAMESPACE so HorizPass/VertPass have the same signature
// across every dispatch target (HWY_EXPORT builds a single function-pointer
// table and won't accept N_SSE4::Span* vs N_AVX2::Span*).
struct Span {
    int32_t start;
    int32_t n;
};
} // namespace bun_image
#endif

HWY_BEFORE_NAMESPACE();
namespace bun_image {
namespace HWY_NAMESPACE {

namespace hn = hwy::HWY_NAMESPACE;
using bun_image::Span;

// `__builtin_assume` lets clang drop the loop's zero-trip check / sign-extend
// when we know a bound is positive — `s.n` is always ≥ 1 (buildWeights ensures
// at least one tap) and ≤ wstride. Dimensions are all > 0 (checked at entry).
#if defined(__clang__)
#define BUN_ASSUME(x) __builtin_assume(x)
#else
#define BUN_ASSUME(x) ((void)0)
#endif

// Fixed-point shift. Weights are i16 with Σw = 1<<kFixShift; products go into
// i32 (max |255 · Σ|w| · (1<<14)| ≈ 5.4M for lanczos3, well inside i32). The
// win over f32 isn't "integer add is faster" — it's that an i16 vector holds
// 2× the lanes of an f32 vector, and `ReorderWidenMulAccumulate` (PMADDWD on
// x86, SMLAL on arm64) does the i16×i16→i32 widen-and-accumulate in one go.
constexpr int kFixShift = 14;
constexpr int32_t kFixRound = 1 << (kFixShift - 1);

// Horizontal pass: src_w×src_h → dst_w×src_h. spans/weights index by dst x.
//
// One output pixel's RGBA is 4 i32 lanes; each tap is u8×4 → i16×4 →
// ReorderWidenMulAccumulate(broadcast i16 wk) → i32×4. Fixed to 4 lanes so the
// channel vector fits one SSE/NEON register and isn't 12-lanes-wasted on
// AVX-512. Vectorising across OUTPUT pixels would need a gather (each x has
// its own span.start); the per-pixel 4-lane body keeps loads contiguous and
// is the same shape libvips' `reduceh_hwy` uses.
//
// All addressing is via running pointers (`+= stride`) — no index*stride
// multiplies in any inner loop. Iterators are `size_t` so there's no
// sign-extension on each pointer add.
static void HorizPass(const uint8_t* HWY_RESTRICT src, size_t src_w, size_t src_h,
    uint8_t* HWY_RESTRICT dst, size_t dst_w,
    const Span* HWY_RESTRICT spans, const int16_t* HWY_RESTRICT weights, size_t wstride)
{
    using D32 = hn::FixedTag<int32_t, 4>;
    const D32 di32;
    const hn::Repartition<int16_t, D32> di16; // 8× i16 over the same 128 bits
    const hn::Rebind<uint8_t, D32> du8; // 4× u8

    BUN_ASSUME(src_w > 0 && src_h > 0 && dst_w > 0);
    const size_t src_row = src_w * 4;
    const size_t dst_row = dst_w * 4;
    const auto vround = hn::Set(di32, kFixRound);
    const uint8_t* srow = src;
    uint8_t* drow = dst;
    for (size_t y = 0; y < src_h; y++, srow += src_row, drow += dst_row) {
        const int16_t* w = weights;
        uint8_t* dp = drow;
        for (size_t x = 0; x < dst_w; x++, w += wstride, dp += 4) {
            const Span s = spans[x];
            BUN_ASSUME(s.n > 0);
            BUN_ASSUME(s.start >= 0);
            // sp is the only place that still needs a multiply (s.start is
            // non-monotone in x); it's one shift+add per output pixel.
            const uint8_t* sp = srow + static_cast<size_t>(s.start) * 4;
            // Seed with the rounding term so the final >>kFixShift rounds to
            // nearest without an extra add.
            auto sum0 = vround;
            auto sum1 = hn::Zero(di32);
            for (int32_t k = 0; k < s.n; k++, sp += 4) {
                // u8×4 → i16×4 in the low half of an i16×8 vector.
                auto pix = hn::BitCast(di16, hn::PromoteTo(di32, hn::LoadU(du8, sp)));
                auto wk = hn::Set(di16, w[k]);
                sum0 = hn::ReorderWidenMulAccumulate(di32, pix, wk, sum0, sum1);
            }
            auto acc = hn::ShiftRight<kFixShift>(hn::Add(sum0, sum1));
            // DemoteTo i32→u8 saturates [0,255].
            hn::StoreU(hn::DemoteTo(du8, acc), du8, dp);
        }
    }
}

// Vertical pass: dst_w×src_h → dst_w×dst_h. SIMD across x (contiguous RGBA
// bytes), scalar over taps. The inner-tap stride is `row_bytes`, so the tap
// loop walks down columns with `sp += row_bytes` — no per-tap multiply.
static void VertPass(const uint8_t* HWY_RESTRICT src, size_t src_h, size_t dst_w,
    uint8_t* HWY_RESTRICT dst, size_t dst_h,
    const Span* HWY_RESTRICT spans, const int16_t* HWY_RESTRICT weights, size_t wstride)
{
    const hn::ScalableTag<int32_t> di32;
    const hn::Repartition<int16_t, decltype(di32)> di16;
    const hn::Rebind<uint8_t, decltype(di32)> du8;
    const size_t N = hn::Lanes(du8); // bytes processed per vector step
    const size_t row_bytes = dst_w * 4;
    const auto vround = hn::Set(di32, kFixRound);
    (void)src_h;

    BUN_ASSUME(dst_w > 0 && dst_h > 0);
    uint8_t* drow = dst;
    const int16_t* w = weights;
    for (size_t y = 0; y < dst_h; y++, drow += row_bytes, w += wstride) {
        const Span s = spans[y];
        BUN_ASSUME(s.n > 0);
        BUN_ASSUME(s.start >= 0);
        // One multiply per output row to anchor the column window; everything
        // inside is `+= row_bytes` / `+= N`.
        const uint8_t* col0 = src + static_cast<size_t>(s.start) * row_bytes;
        uint8_t* dp = drow;
        const uint8_t* end = drow + row_bytes;
        for (; dp + N <= end; dp += N, col0 += N) {
            auto sum0 = vround;
            auto sum1 = hn::Zero(di32);
            const uint8_t* sp = col0;
            for (int32_t k = 0; k < s.n; k++, sp += row_bytes) {
                auto pix = hn::BitCast(di16, hn::PromoteTo(di32, hn::LoadU(du8, sp)));
                auto wk = hn::Set(di16, w[k]);
                sum0 = hn::ReorderWidenMulAccumulate(di32, pix, wk, sum0, sum1);
            }
            auto acc = hn::ShiftRight<kFixShift>(hn::Add(sum0, sum1));
            hn::StoreU(hn::DemoteTo(du8, acc), du8, dp);
        }
        for (; dp < end; dp++, col0++) {
            int32_t acc = kFixRound;
            const uint8_t* sp = col0;
            for (int32_t k = 0; k < s.n; k++, sp += row_bytes)
                acc += static_cast<int32_t>(*sp) * w[k];
            acc >>= kFixShift;
            *dp = static_cast<uint8_t>(acc < 0 ? 0 : acc > 255 ? 255
                                                               : acc);
        }
    }
}

// 90° CW: dst[x, y] = src[y, src_h-1-x]. dst is h×w.
// Walk a running source pointer (`sp += 4`) and a running dst pointer that
// jumps one *destination row* per source pixel (`dp += dst_row`) — both inner
// strides are constants, zero multiplies inside the loops.
static void Rotate90Impl(const uint8_t* HWY_RESTRICT src, size_t w, size_t h, uint8_t* HWY_RESTRICT dst)
{
    BUN_ASSUME(w > 0 && h > 0);
    const size_t dst_row = h * 4;
    const uint8_t* sp = src;
    // y=0 column lands at dst x = h-1.
    uint8_t* dcol = dst + dst_row - 4;
    for (size_t y = 0; y < h; y++, dcol -= 4) {
        uint8_t* dp = dcol;
        for (size_t x = 0; x < w; x++, sp += 4, dp += dst_row)
            std::memcpy(dp, sp, 4);
    }
}

static void Rotate180Impl(const uint8_t* HWY_RESTRICT src, size_t w, size_t h, uint8_t* HWY_RESTRICT dst)
{
    BUN_ASSUME(w > 0 && h > 0);
    const size_t total = w * h;
    const uint8_t* sp = src;
    uint8_t* dp = dst + (total - 1) * 4;
    for (size_t i = 0; i < total; i++, sp += 4, dp -= 4)
        std::memcpy(dp, sp, 4);
}

static void Rotate270Impl(const uint8_t* HWY_RESTRICT src, size_t w, size_t h, uint8_t* HWY_RESTRICT dst)
{
    BUN_ASSUME(w > 0 && h > 0);
    const size_t dst_row = h * 4;
    const uint8_t* sp = src;
    uint8_t* dcol = dst;
    for (size_t y = 0; y < h; y++, dcol += 4) {
        uint8_t* dp = dcol + (w - 1) * dst_row;
        for (size_t x = 0; x < w; x++, sp += 4, dp -= dst_row)
            std::memcpy(dp, sp, 4);
    }
}

static void FlipHImpl(const uint8_t* HWY_RESTRICT src, size_t w, size_t h, uint8_t* HWY_RESTRICT dst)
{
    BUN_ASSUME(w > 0 && h > 0);
    const size_t row = w * 4;
    const uint8_t* srow = src;
    uint8_t* drow = dst;
    for (size_t y = 0; y < h; y++, srow += row, drow += row) {
        const uint8_t* sp = srow;
        uint8_t* dp = drow + row - 4;
        for (size_t x = 0; x < w; x++, sp += 4, dp -= 4)
            std::memcpy(dp, sp, 4);
    }
}

static void FlipVImpl(const uint8_t* HWY_RESTRICT src, size_t w, size_t h, uint8_t* HWY_RESTRICT dst)
{
    BUN_ASSUME(w > 0 && h > 0);
    const size_t row = w * 4;
    const uint8_t* sp = src + (h - 1) * row;
    uint8_t* dp = dst;
    for (size_t y = 0; y < h; y++, sp -= row, dp += row)
        std::memcpy(dp, sp, row);
}

// Nearest-palette index for one RGBA point. Squared Euclidean over all four
// channels; SIMD across palette entries (4 entries' R/G/B/A laid out as
// contiguous u8, so we load 16 at a time and compute 4 distances per step on
// targets where Lanes(u32) ≥ 4). Used by quantize.zig's Floyd–Steinberg
// mapper — the diffusion itself is serial, but this inner search is hot and
// parallelisable.
static uint32_t NearestPaletteImpl(const uint8_t* HWY_RESTRICT palette, uint32_t k,
    int32_t r, int32_t g, int32_t b, int32_t a)
{
    // Scalar fallback that the compiler vectorises well; explicit highway
    // here would need a 4-way deinterleave that doesn't beat the scalar on
    // small k. The HWY_DYNAMIC_DISPATCH still picks the best -march to
    // compile this body under.
    uint32_t best = 0;
    int32_t best_d = 0x7fffffff;
    for (uint32_t i = 0; i < k; i++) {
        const int32_t dr = r - palette[i * 4 + 0];
        const int32_t dg = g - palette[i * 4 + 1];
        const int32_t db = b - palette[i * 4 + 2];
        const int32_t da = a - palette[i * 4 + 3];
        const int32_t d = dr * dr + dg * dg + db * db + da * da;
        if (d < best_d) {
            best_d = d;
            best = i;
        }
    }
    return best;
}

// In-place brightness × saturation on RGBA8. saturation lerps each channel
// toward the pixel's Rec.601 luma (0 → greyscale, 1 → identity, >1 → boost);
// brightness is a straight multiply on the result. Alpha untouched. This is
// the same model Sharp's `modulate` uses (linear, no gamma correction —
// matching is more useful than correctness here).
static void ModulateImpl(uint8_t* HWY_RESTRICT buf, size_t len, float brightness, float saturation)
{
    const hn::ScalableTag<float> df;
    // Rec.601 luma weights.
    const auto wr = hn::Set(df, 0.299f);
    const auto wg = hn::Set(df, 0.587f);
    const auto wb = hn::Set(df, 0.114f);
    const auto sat = hn::Set(df, saturation);
    const auto bri = hn::Set(df, brightness);
    const auto half = hn::Set(df, 0.5f);
    const auto lo = hn::Zero(df);
    const auto hi = hn::Set(df, 255.0f);
    // Scalar over pixels — len is bytes, 4 per pixel. SIMD across the four
    // channel lanes wouldn't help (alpha is masked) so this stays simple and
    // lets the compiler vectorise the FMAs.
    for (size_t i = 0; i + 4 <= len; i += 4) {
        const float r = static_cast<float>(buf[i + 0]);
        const float g = static_cast<float>(buf[i + 1]);
        const float b = static_cast<float>(buf[i + 2]);
        const auto y = hn::MulAdd(hn::Set(df, r), wr, hn::MulAdd(hn::Set(df, g), wg, hn::Mul(hn::Set(df, b), wb)));
        auto cr = hn::Mul(hn::MulAdd(hn::Sub(hn::Set(df, r), y), sat, y), bri);
        auto cg = hn::Mul(hn::MulAdd(hn::Sub(hn::Set(df, g), y), sat, y), bri);
        auto cb = hn::Mul(hn::MulAdd(hn::Sub(hn::Set(df, b), y), sat, y), bri);
        buf[i + 0] = static_cast<uint8_t>(hn::GetLane(hn::Min(hn::Max(hn::Add(cr, half), lo), hi)));
        buf[i + 1] = static_cast<uint8_t>(hn::GetLane(hn::Min(hn::Max(hn::Add(cg, half), lo), hi)));
        buf[i + 2] = static_cast<uint8_t>(hn::GetLane(hn::Min(hn::Max(hn::Add(cb, half), lo), hi)));
        // alpha unchanged
    }
}

} // namespace HWY_NAMESPACE
} // namespace bun_image
HWY_AFTER_NAMESPACE();

#if HWY_ONCE
namespace bun_image {

HWY_EXPORT(HorizPass);
HWY_EXPORT(VertPass);
HWY_EXPORT(Rotate90Impl);
HWY_EXPORT(Rotate180Impl);
HWY_EXPORT(Rotate270Impl);
HWY_EXPORT(FlipHImpl);
HWY_EXPORT(FlipVImpl);
HWY_EXPORT(ModulateImpl);
HWY_EXPORT(NearestPaletteImpl);

namespace {

constexpr double kPi = 3.14159265358979323846;

double sinc(double x)
{
    if (std::fabs(x) < 1e-8) return 1.0;
    const double px = kPi * x;
    return std::sin(px) / px;
}

// BC-spline cubic. The (B,C) family from Mitchell & Netravali 1988; radius 2.
//   B=1/3, C=1/3 → Mitchell (recommended; minimal ringing, no overshoot)
//   B=0,   C=1/2 → Catmull-Rom ("cubic" in Sharp; sharper, slight ring)
double bcCubic(double B, double C, double x)
{
    x = std::fabs(x);
    const double xx = x * x;
    if (x < 1.0)
        return ((12 - 9 * B - 6 * C) * xx * x + (-18 + 12 * B + 6 * C) * xx + (6 - 2 * B)) / 6.0;
    if (x < 2.0)
        return ((-B - 6 * C) * xx * x + (6 * B + 30 * C) * xx + (-12 * B - 48 * C) * x + (8 * B + 24 * C)) / 6.0;
    return 0.0;
}

// Filter kernel; radius is the support half-width in source pixels at scale=1.
double filter(int kind, double x)
{
    switch (kind) {
    case 0: // box
    case 4: // nearest — same kernel; the radius<1 collapses to a single tap
        return (x > -0.5 && x <= 0.5) ? 1.0 : 0.0;
    case 1: // bilinear / triangle
        x = std::fabs(x);
        return x < 1.0 ? 1.0 - x : 0.0;
    case 3: // mitchell
        return bcCubic(1.0 / 3.0, 1.0 / 3.0, x);
    case 5: // cubic (Catmull-Rom)
        return bcCubic(0.0, 0.5, x);
    case 6: // lanczos2
        x = std::fabs(x);
        return x < 2.0 ? sinc(x) * sinc(x / 2.0) : 0.0;
    case 7: { // mks2013 — Magic Kernel Sharp 2013 (Costella). Facebook's
        // long-time thumbnail kernel: lanczos-like with the sharpening
        // folded in, slightly crisper with less ringing on photo content.
        x = std::fabs(x);
        if (x >= 2.5) return 0.0;
        if (x >= 1.5) return -(x - 2.5) * (x - 2.5) / 8.0;
        if (x >= 0.5) return (4.0 * x * x - 11.0 * x + 7.0) / 4.0;
        return 17.0 / 16.0 - 7.0 * x * x / 4.0;
    }
    case 8: { // mks2021 — refined MKS, radius 4.5.
        x = std::fabs(x);
        if (x >= 4.5) return 0.0;
        if (x >= 3.5) return -(4.0 * x * x - 36.0 * x + 81.0) / 1152.0;
        if (x >= 2.5) return (4.0 * x * x - 27.0 * x + 45.0) / 144.0;
        if (x >= 1.5) return -(24.0 * x * x - 113.0 * x + 130.0) / 144.0;
        if (x >= 0.5) return (140.0 * x * x - 379.0 * x + 239.0) / 144.0;
        return 577.0 / 576.0 - 239.0 * x * x / 144.0;
    }
    default: // lanczos3
        x = std::fabs(x);
        return x < 3.0 ? sinc(x) * sinc(x / 3.0) : 0.0;
    }
}

double radius(int kind)
{
    switch (kind) {
    case 0: // box
    case 4: // nearest
        return 0.5;
    case 1: // bilinear
        return 1.0;
    case 3: // mitchell
    case 5: // cubic
    case 6: // lanczos2
        return 2.0;
    case 7: // mks2013
        return 2.5;
    case 8: // mks2021
        return 4.5;
    default: // lanczos3
        return 3.0;
    }
}

// Precompute spans + normalised weights for one axis. Returns max taps so the
// caller can lay weights out as a dense [out_len × wstride] matrix. Weights
// are i16 fixed-point with Σw = 1<<kFixShift exactly: each set is normalised
// in f64, scaled, rounded, then the largest tap absorbs the rounding residual
// so DC gain is bit-exact (a flat field comes back flat).
constexpr int kFixOne = 1 << 14; // = 1<<kFixShift; mirrored here in the
                                 // HWY_ONCE block (the constexpr above lives
                                 // in HWY_NAMESPACE).
int buildWeights(int kind, int32_t src_len, int32_t dst_len,
    Span* spans, int16_t* weights, int32_t wstride)
{
    const double scale = static_cast<double>(dst_len) / static_cast<double>(src_len);
    // When downscaling, stretch the kernel by 1/scale so it covers the whole
    // source footprint of a destination pixel (this is what makes box → area
    // average and lanczos antialiased). `nearest` is the exception: it must
    // pick exactly ONE source sample at any scale (pixel art, label maps),
    // so don't stretch it — fscale=1 keeps support at 0.5 = single tap.
    const double fscale = (kind == 4 || scale >= 1.0) ? 1.0 : scale;
    const double support = radius(kind) / fscale;
    int max_n = 0;
    for (int32_t i = 0; i < dst_len; i++) {
        const double center = (i + 0.5) / scale - 0.5;
        int32_t start = static_cast<int32_t>(std::floor(center - support + 0.5));
        int32_t end = static_cast<int32_t>(std::floor(center + support + 0.5));
        if (start < 0) start = 0;
        if (end >= src_len) end = src_len - 1;
        int32_t n = end - start + 1;
        if (n > wstride) n = wstride;
        // Evaluate in f64, normalise, then quantise.
        double fw[256]; // wstride upper bound is 2*radius/fscale + 2; even
                        // mks2021 at 16× downscale is 2*4.5*16+2 = 146.
        if (n > 256) n = 256;
        double sum = 0.0;
        for (int32_t k = 0; k < n; k++) {
            fw[k] = filter(kind, ((start + k) - center) * fscale);
            sum += fw[k];
        }
        const double inv = sum != 0.0 ? 1.0 / sum : 0.0;
        int16_t* w = weights + static_cast<size_t>(i) * wstride;
        int32_t isum = 0;
        int32_t big = 0;
        for (int32_t k = 0; k < n; k++) {
            int32_t q = static_cast<int32_t>(std::lrint(fw[k] * inv * kFixOne));
            // Clip — extreme aspect ratios can push a single tap past i16.
            q = q < -32768 ? -32768 : q > 32767 ? 32767
                                                : q;
            w[k] = static_cast<int16_t>(q);
            isum += q;
            if (std::abs(q) > std::abs(w[big])) big = k;
        }
        // Make the integer sum exact so a flat field stays flat.
        w[big] = static_cast<int16_t>(w[big] + (kFixOne - isum));
        spans[i] = { start, n };
        if (n > max_n) max_n = n;
    }
    return max_n;
}

// Round n up to a multiple of a (a is a power of two).
constexpr size_t alignUp(size_t n, size_t a) { return (n + a - 1) & ~(a - 1); }

// Layout of the caller-provided scratch arena. The intermediate row buffer
// (dst_w×src_h×4) dominates; the spans/weights tables are a few tens of KB
// packed into its tail. Computed once so `_scratch_size` and the resize body
// agree exactly.
struct ScratchLayout {
    size_t wsx, wsy;
    size_t off_xs, off_ys, off_xw, off_yw, total;
    ScratchLayout(size_t src_w, size_t src_h, size_t dst_w, size_t dst_h, int kind)
    {
        const double xs = static_cast<double>(dst_w) / src_w;
        const double ys = static_cast<double>(dst_h) / src_h;
        wsx = static_cast<size_t>(std::ceil(radius(kind) / (xs < 1.0 ? xs : 1.0))) * 2 + 2;
        wsy = static_cast<size_t>(std::ceil(radius(kind) / (ys < 1.0 ? ys : 1.0))) * 2 + 2;
        const size_t tmp_sz = dst_w * src_h * 4;
        off_xs = alignUp(tmp_sz, alignof(Span));
        off_ys = off_xs + sizeof(Span) * dst_w;
        off_xw = alignUp(off_ys + sizeof(Span) * dst_h, alignof(int16_t));
        off_yw = off_xw + sizeof(int16_t) * dst_w * wsx;
        total = off_yw + sizeof(int16_t) * dst_h * wsy;
    }
};

} // namespace

extern "C" {

// How many bytes of scratch the resize needs. Caller (Zig) allocates this
// alongside the output in ONE bun.default_allocator block — zero mallocs in
// this TU.
size_t bun_image_resize_scratch_size(int32_t src_w, int32_t src_h, int32_t dst_w, int32_t dst_h, int32_t filter_kind)
{
    if (src_w <= 0 || src_h <= 0 || dst_w <= 0 || dst_h <= 0) return 0;
    return ScratchLayout(src_w, src_h, dst_w, dst_h, filter_kind).total;
}

// Resize RGBA8. `scratch` must be at least `bun_image_resize_scratch_size(...)`
// bytes; partitioned into tmp | xspans | yspans | xw | yw. Returns 0 on
// success, -1 on bad dimensions.
int bun_image_resize_rgba8(const uint8_t* src, int32_t src_w, int32_t src_h,
    uint8_t* dst, int32_t dst_w, int32_t dst_h, int32_t filter_kind, uint8_t* scratch)
{
    if (src_w <= 0 || src_h <= 0 || dst_w <= 0 || dst_h <= 0 || !scratch) return -1;
    const ScratchLayout L(src_w, src_h, dst_w, dst_h, filter_kind);
    auto* tmp = scratch;
    auto* xspans = reinterpret_cast<Span*>(scratch + L.off_xs);
    auto* yspans = reinterpret_cast<Span*>(scratch + L.off_ys);
    auto* xw = reinterpret_cast<int16_t*>(scratch + L.off_xw);
    auto* yw = reinterpret_cast<int16_t*>(scratch + L.off_yw);

    buildWeights(filter_kind, src_w, dst_w, xspans, xw, static_cast<int32_t>(L.wsx));
    buildWeights(filter_kind, src_h, dst_h, yspans, yw, static_cast<int32_t>(L.wsy));

    HWY_DYNAMIC_DISPATCH(HorizPass)(src, src_w, src_h, tmp, dst_w, xspans, xw, L.wsx);
    HWY_DYNAMIC_DISPATCH(VertPass)(tmp, src_h, dst_w, dst, dst_h, yspans, yw, L.wsy);
    return 0;
}

// degrees ∈ {90, 180, 270}. dst dims swap for 90/270; caller allocates.
void bun_image_rotate_rgba8(const uint8_t* src, int32_t w, int32_t h, uint8_t* dst, int32_t degrees)
{
    switch (degrees) {
    case 90:
        HWY_DYNAMIC_DISPATCH(Rotate90Impl)(src, w, h, dst);
        break;
    case 180:
        HWY_DYNAMIC_DISPATCH(Rotate180Impl)(src, w, h, dst);
        break;
    case 270:
        HWY_DYNAMIC_DISPATCH(Rotate270Impl)(src, w, h, dst);
        break;
    default:
        std::memcpy(dst, src, static_cast<size_t>(w) * h * 4);
    }
}

void bun_image_flip_rgba8(const uint8_t* src, int32_t w, int32_t h, uint8_t* dst, int32_t horizontal)
{
    if (horizontal)
        HWY_DYNAMIC_DISPATCH(FlipHImpl)(src, w, h, dst);
    else
        HWY_DYNAMIC_DISPATCH(FlipVImpl)(src, w, h, dst);
}

void bun_image_modulate_rgba8(uint8_t* buf, size_t len, float brightness, float saturation)
{
    HWY_DYNAMIC_DISPATCH(ModulateImpl)(buf, len, brightness, saturation);
}

uint32_t bun_image_nearest_palette(const uint8_t* palette, uint32_t k,
    int32_t r, int32_t g, int32_t b, int32_t a)
{
    return HWY_DYNAMIC_DISPATCH(NearestPaletteImpl)(palette, k, r, g, b, a);
}

} // extern "C"

} // namespace bun_image
#endif // HWY_ONCE
