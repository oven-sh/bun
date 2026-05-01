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
// Resize is separable two-pass (horizontal then vertical) with three filters:
//   box       — area-average, only correct for downscale
//   bilinear  — triangle, radius 1
//   lanczos3  — sinc-windowed sinc, radius 3 (Sharp's default)
// Weights are precomputed per output column/row; the inner loop is a SIMD
// gather-multiply-accumulate over u8→f32 lanes.

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

static HWY_INLINE uint8_t ClampU8(float v)
{
    // +0.5 for round-to-nearest before truncation.
    if (v <= 0.0f) return 0;
    if (v >= 255.0f) return 255;
    return static_cast<uint8_t>(v + 0.5f);
}

// Horizontal pass: src_w×src_h → dst_w×src_h. spans/weights index by dst x.
//
// One output pixel's RGBA is a 4-lane f32 accumulator; each tap is a 4-byte
// load → u8×4 → i32×4 → f32×4 → FMA(broadcast wk). Fixed to a 4-lane tag so
// the channel vector fits one SSE/NEON register and isn't 12-lanes-wasted on
// AVX-512. (The previous version broadcast each channel into a full vector
// then read lane 0 — effectively scalar with overhead; bughunt flagged it.)
// Vectorising across OUTPUT pixels would need a gather (each x has its own
// span.start); the per-pixel 4-lane body keeps loads contiguous and is the
// same shape libvips' `reduceh` uses.
static void HorizPass(const uint8_t* HWY_RESTRICT src, int32_t src_w, int32_t src_h,
    uint8_t* HWY_RESTRICT dst, int32_t dst_w,
    const Span* HWY_RESTRICT spans, const float* HWY_RESTRICT weights, int32_t wstride)
{
    using D = hn::FixedTag<float, 4>;
    const D df;
    const hn::Rebind<int32_t, D> di32;
    const hn::Rebind<uint8_t, D> du8;
    const auto half = hn::Set(df, 0.5f);
    const auto lo = hn::Zero(df);
    const auto hi = hn::Set(df, 255.0f);

    for (int32_t y = 0; y < src_h; y++) {
        const uint8_t* srow = src + static_cast<size_t>(y) * src_w * 4;
        uint8_t* drow = dst + static_cast<size_t>(y) * dst_w * 4;
        for (int32_t x = 0; x < dst_w; x++) {
            const Span s = spans[x];
            const float* w = weights + static_cast<size_t>(x) * wstride;
            const uint8_t* sp = srow + static_cast<size_t>(s.start) * 4;
            auto acc = hn::Zero(df);
            for (int32_t k = 0; k < s.n; k++) {
                auto v = hn::ConvertTo(df, hn::PromoteTo(di32, hn::LoadU(du8, sp + k * 4)));
                acc = hn::MulAdd(v, hn::Set(df, w[k]), acc);
            }
            acc = hn::Min(hn::Max(hn::Add(acc, half), lo), hi);
            hn::StoreU(hn::DemoteTo(du8, hn::ConvertTo(di32, acc)), du8, drow + x * 4);
        }
    }
    (void)src_w;
}

// Vertical pass: dst_w×src_h → dst_w×dst_h. SIMD across x (contiguous RGBA
// bytes), scalar over taps.
static void VertPass(const uint8_t* HWY_RESTRICT src, int32_t src_h, int32_t dst_w,
    uint8_t* HWY_RESTRICT dst, int32_t dst_h,
    const Span* HWY_RESTRICT spans, const float* HWY_RESTRICT weights, int32_t wstride)
{
    const hn::ScalableTag<float> df;
    const hn::Rebind<int32_t, decltype(df)> di32;
    const hn::Rebind<uint8_t, decltype(df)> du8;
    const size_t N = hn::Lanes(df);
    const size_t row_bytes = static_cast<size_t>(dst_w) * 4;
    (void)src_h;

    for (int32_t y = 0; y < dst_h; y++) {
        const Span s = spans[y];
        const float* w = weights + static_cast<size_t>(y) * wstride;
        uint8_t* drow = dst + static_cast<size_t>(y) * row_bytes;
        size_t i = 0;
        for (; i + N <= row_bytes; i += N) {
            auto acc = hn::Zero(df);
            for (int32_t k = 0; k < s.n; k++) {
                const uint8_t* sp = src + static_cast<size_t>(s.start + k) * row_bytes + i;
                // u8 → i32 → f32; highway has no direct u8→f32 PromoteTo.
                auto v = hn::ConvertTo(df, hn::PromoteTo(di32, hn::LoadU(du8, sp)));
                acc = hn::MulAdd(v, hn::Set(df, w[k]), acc);
            }
            acc = hn::Min(hn::Max(hn::Add(acc, hn::Set(df, 0.5f)), hn::Zero(df)), hn::Set(df, 255.0f));
            hn::StoreU(hn::DemoteTo(du8, hn::ConvertTo(di32, acc)), du8, drow + i);
        }
        for (; i < row_bytes; i++) {
            float acc = 0.0f;
            for (int32_t k = 0; k < s.n; k++)
                acc += static_cast<float>(src[static_cast<size_t>(s.start + k) * row_bytes + i]) * w[k];
            drow[i] = ClampU8(acc);
        }
    }
}

// 90° CW: dst[x, y] = src[y, src_h-1-x]. Works on RGBA8; dst is src_h×src_w.
static void Rotate90Impl(const uint8_t* HWY_RESTRICT src, int32_t w, int32_t h, uint8_t* HWY_RESTRICT dst)
{
    for (int32_t y = 0; y < h; y++) {
        const uint8_t* srow = src + static_cast<size_t>(y) * w * 4;
        for (int32_t x = 0; x < w; x++) {
            uint8_t* dp = dst + (static_cast<size_t>(x) * h + (h - 1 - y)) * 4;
            std::memcpy(dp, srow + x * 4, 4);
        }
    }
}

static void Rotate180Impl(const uint8_t* HWY_RESTRICT src, int32_t w, int32_t h, uint8_t* HWY_RESTRICT dst)
{
    const size_t total = static_cast<size_t>(w) * h;
    for (size_t i = 0; i < total; i++)
        std::memcpy(dst + (total - 1 - i) * 4, src + i * 4, 4);
}

static void Rotate270Impl(const uint8_t* HWY_RESTRICT src, int32_t w, int32_t h, uint8_t* HWY_RESTRICT dst)
{
    for (int32_t y = 0; y < h; y++) {
        const uint8_t* srow = src + static_cast<size_t>(y) * w * 4;
        for (int32_t x = 0; x < w; x++) {
            uint8_t* dp = dst + (static_cast<size_t>(w - 1 - x) * h + y) * 4;
            std::memcpy(dp, srow + x * 4, 4);
        }
    }
}

static void FlipHImpl(const uint8_t* HWY_RESTRICT src, int32_t w, int32_t h, uint8_t* HWY_RESTRICT dst)
{
    for (int32_t y = 0; y < h; y++) {
        const uint8_t* srow = src + static_cast<size_t>(y) * w * 4;
        uint8_t* drow = dst + static_cast<size_t>(y) * w * 4;
        for (int32_t x = 0; x < w; x++)
            std::memcpy(drow + x * 4, srow + (w - 1 - x) * 4, 4);
    }
}

static void FlipVImpl(const uint8_t* HWY_RESTRICT src, int32_t w, int32_t h, uint8_t* HWY_RESTRICT dst)
{
    const size_t row = static_cast<size_t>(w) * 4;
    for (int32_t y = 0; y < h; y++)
        std::memcpy(dst + static_cast<size_t>(y) * row, src + static_cast<size_t>(h - 1 - y) * row, row);
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
    default: // lanczos3
        return 3.0;
    }
}

// Precompute spans + normalised weights for one axis. Returns max taps so the
// caller can lay weights out as a dense [out_len × wstride] matrix.
int buildWeights(int kind, int32_t src_len, int32_t dst_len,
    Span* spans, float* weights, int32_t wstride)
{
    const double scale = static_cast<double>(dst_len) / static_cast<double>(src_len);
    // When downscaling, stretch the kernel by 1/scale so it covers the whole
    // source footprint of a destination pixel (this is what makes box → area
    // average and lanczos antialiased).
    const double fscale = scale < 1.0 ? scale : 1.0;
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
        double sum = 0.0;
        float* w = weights + static_cast<size_t>(i) * wstride;
        for (int32_t k = 0; k < n; k++) {
            const double v = filter(kind, ((start + k) - center) * fscale);
            w[k] = static_cast<float>(v);
            sum += v;
        }
        // Normalise so brightness is preserved even where the kernel was
        // clipped at the image edge.
        if (sum != 0.0)
            for (int32_t k = 0; k < n; k++)
                w[k] = static_cast<float>(w[k] / sum);
        spans[i] = { start, n };
        if (n > max_n) max_n = n;
    }
    return max_n;
}

// Stack-with-heap-fallback for the small per-axis tables. spans + weights for
// a typical thumbnail (≤ 800 px, lanczos3 at 4× downscale ≈ 26 taps) fits in
// well under 32 KB; only very large or extreme-ratio outputs spill to malloc.
template <typename T, size_t N>
struct StackOr {
    alignas(16) T stack[N];
    T* p;
    bool heap;
    explicit StackOr(size_t n)
        : p(n <= N ? stack : static_cast<T*>(std::malloc(sizeof(T) * n)))
        , heap(n > N)
    {
    }
    ~StackOr()
    {
        if (heap) std::free(p);
    }
};

} // namespace

extern "C" {

// Resize RGBA8. Allocates one intermediate (dst_w × src_h × 4) internally.
// Returns 0 on success, -1 on alloc failure.
int bun_image_resize_rgba8(const uint8_t* src, int32_t src_w, int32_t src_h,
    uint8_t* dst, int32_t dst_w, int32_t dst_h, int32_t filter_kind)
{
    if (src_w <= 0 || src_h <= 0 || dst_w <= 0 || dst_h <= 0) return -1;

    const double xs = static_cast<double>(dst_w) / src_w;
    const double ys = static_cast<double>(dst_h) / src_h;
    const int wsx = static_cast<int>(std::ceil(radius(filter_kind) / (xs < 1.0 ? xs : 1.0))) * 2 + 2;
    const int wsy = static_cast<int>(std::ceil(radius(filter_kind) / (ys < 1.0 ? ys : 1.0))) * 2 + 2;

    StackOr<Span, 1024> xspans(dst_w);
    StackOr<Span, 1024> yspans(dst_h);
    StackOr<float, 4096> xw(static_cast<size_t>(dst_w) * wsx);
    StackOr<float, 4096> yw(static_cast<size_t>(dst_h) * wsy);
    // The intermediate row buffer is dst_w × src_h × 4 — usually too big for
    // stack (e.g. 400×1080×4 ≈ 1.7 MB), so this stays on the heap.
    auto* tmp = static_cast<uint8_t*>(std::malloc(static_cast<size_t>(dst_w) * src_h * 4));
    if (!xspans.p || !yspans.p || !xw.p || !yw.p || !tmp) {
        std::free(tmp);
        return -1;
    }

    buildWeights(filter_kind, src_w, dst_w, xspans.p, xw.p, wsx);
    buildWeights(filter_kind, src_h, dst_h, yspans.p, yw.p, wsy);

    HWY_DYNAMIC_DISPATCH(HorizPass)(src, src_w, src_h, tmp, dst_w, xspans.p, xw.p, wsx);
    HWY_DYNAMIC_DISPATCH(VertPass)(tmp, src_h, dst_w, dst, dst_h, yspans.p, yw.p, wsy);

    std::free(tmp);
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
