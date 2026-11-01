// Checks the kernels of src/jsc/bindings/highway_jpeg.cpp against the formulas of libjpeg: rows of 0 to 300 samples between
// pages that cannot be touched, then every (Y, Cb, Cr) and every (R, G, B).
//
//   tools/kernels.sh            builds ./kernels and, with the cross libraries, ./kernels-arm64
//   ./kernels targets           the n of every target that the CPU has
//   ./kernels <1 << n>          n as in vendor/highway/hwy/detect_targets.h; 0 is the best the CPU has
//   ./kernels <1 << n> time
#include <hwy/targets.h>
#include <sys/mman.h>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <chrono>
#include <vector>
extern "C" {
bool highway_jpeg_from_ycc(const uint8_t*, const uint8_t*, const uint8_t*, const uint8_t*, uint8_t*, size_t);
bool highway_jpeg_to_ycc(const uint8_t*, uint8_t*, uint8_t*, uint8_t*, size_t);
bool highway_jpeg_h2v2_downsample(const uint8_t*, const uint8_t*, uint8_t*, size_t);
bool highway_jpeg_h2v1_fancy(const uint8_t*, uint8_t*, size_t);
bool highway_jpeg_h2v2_fancy(const uint8_t*, const uint8_t*, uint8_t*, size_t);
}
// A buffer of exactly n bytes with an inaccessible page before and after (data flush with the end, or with the start).
struct Guarded {
    uint8_t* base; size_t total; uint8_t* p; size_t n;
    Guarded(size_t n_, bool atEnd) : n(n_) {
        size_t pages = (n + 4095) / 4096 + 1;
        total = (pages + 2) * 4096;
        base = (uint8_t*)mmap(nullptr, total, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
        mprotect(base, 4096, PROT_NONE);
        mprotect(base + total - 4096, 4096, PROT_NONE);
        p = atEnd ? base + total - 4096 - n : base + 4096;
        memset(base + 4096, 0xCD, total - 8192);
    }
    // everything outside [p, p+n) still 0xCD
    bool intact() const { for (uint8_t* q = base + 4096; q < base + total - 4096; q++) if ((q < p || q >= p + n) && *q != 0xCD) return false; return true; }
    ~Guarded() { munmap(base, total); }
};
static uint64_t rng = 88172645463325252ull;
static uint32_t rnd() { rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17; return (uint32_t)(rng >> 16); }
static void fill(Guarded& g, int mode) { for (size_t i = 0; i < g.n; i++) g.p[i] = mode == 0 ? rnd() : mode == 1 ? (rnd() & 1 ? 255 : 0) : mode == 2 ? 255 : 0; }
static int FIX(double x) { return (int)(x * 65536 + 0.5); }
static uint8_t clampb(int v) { return v < 0 ? 0 : v > 255 ? 255 : v; }
static void ref_ycc(int y, int cb, int cr, uint8_t* o) {
    cb -= 128; cr -= 128;
    o[0] = clampb(y + ((FIX(1.40200) * cr + 32768) >> 16));
    o[1] = clampb(y + ((-FIX(0.34414) * cb + 32768 - FIX(0.71414) * cr) >> 16));
    o[2] = clampb(y + ((FIX(1.77200) * cb + 32768) >> 16));
}
static void ref_rgb(int r, int g, int b, uint8_t* o) {
    o[0] = (FIX(0.29900) * r + FIX(0.58700) * g + FIX(0.11400) * b + 32768) >> 16;
    o[1] = (-FIX(0.16874) * r - FIX(0.33126) * g + FIX(0.50000) * b + (128 << 16) + 32767) >> 16;
    o[2] = (FIX(0.50000) * r - FIX(0.41869) * g - FIX(0.08131) * b + (128 << 16) + 32767) >> 16;
}
static long fails = 0;
#define CHECK(c, ...) do { if (!(c)) { if (fails++ < 20) { printf(__VA_ARGS__); printf("\n"); } } } while (0)
static size_t handledFrom[6] = {~0ul,~0ul,~0ul,~0ul,~0ul,~0ul};
static void note(int k, bool done, size_t n) { if (done && n < handledFrom[k]) handledFrom[k] = n; CHECK(done || n < handledFrom[k] , "kernel %d refuses n=%zu but took %zu", k, n, handledFrom[k]); }

static void widths(size_t maxn) {
    for (size_t n = 0; n <= maxn; n++) for (int atEnd = 0; atEnd < 2; atEnd++) for (int mode = 0; mode < 4; mode++) {
        { // ycc, ycck
            Guarded y(n, atEnd), cb(n, atEnd), cr(n, atEnd), k(n, atEnd), o(n * 4, atEnd), o2(n * 4, atEnd);
            fill(y, mode); fill(cb, mode == 0 ? 0 : (mode + 1) % 4); fill(cr, mode); fill(k, 0);
            bool d = highway_jpeg_from_ycc(y.p, cb.p, cr.p, nullptr, o.p, n); note(0, d, n);
            bool d2 = highway_jpeg_from_ycc(y.p, cb.p, cr.p, k.p, o2.p, n); note(1, d2, n);
            CHECK(o.intact() && o2.intact(), "ycc wrote outside n=%zu", n);
            for (size_t i = 0; i < n; i++) { uint8_t e[3]; ref_ycc(y.p[i], cb.p[i], cr.p[i], e);
                if (d) CHECK(!memcmp(e, o.p + 4 * i, 3) && o.p[4 * i + 3] == 255, "ycc n=%zu i=%zu", n, i);
                else CHECK(o.p[4*i] == 0xCD, "ycc refused but wrote");
                if (d2) CHECK(o2.p[4*i] == 255 - e[0] && o2.p[4*i+1] == 255 - e[1] && o2.p[4*i+2] == 255 - e[2] && o2.p[4*i+3] == k.p[i], "ycck n=%zu i=%zu", n, i); }
        }
        { // rgba
            Guarded in(n * 4, atEnd), y(n, atEnd), cb(n, atEnd), cr(n, atEnd); fill(in, mode);
            bool d = highway_jpeg_to_ycc(in.p, y.p, cb.p, cr.p, n); note(2, d, n);
            CHECK(y.intact() && cb.intact() && cr.intact(), "rgba wrote outside n=%zu", n);
            if (d) for (size_t i = 0; i < n; i++) { uint8_t e[3]; ref_rgb(in.p[4*i], in.p[4*i+1], in.p[4*i+2], e);
                CHECK(e[0] == y.p[i] && e[1] == cb.p[i] && e[2] == cr.p[i], "rgba n=%zu i=%zu", n, i); }
        }
        { // downsample
            Guarded a(n * 2, atEnd), b(n * 2, atEnd), o(n, atEnd); fill(a, mode); fill(b, mode == 1 ? 1 : mode);
            bool d = highway_jpeg_h2v2_downsample(a.p, b.p, o.p, n);
            if (n % 2) CHECK(!d, "down took an odd n=%zu", n); else note(3, d, n);
            CHECK(o.intact(), "down wrote outside n=%zu", n);
            if (d) for (size_t i = 0; i < n; i++) CHECK(o.p[i] == ((a.p[2*i] + a.p[2*i+1] + b.p[2*i] + b.p[2*i+1] + 1 + (i & 1)) >> 2), "down n=%zu i=%zu", n, i);
        }
        { // fancy
            Guarded a(n, atEnd), b(n, atEnd), o(n * 2, atEnd), o2(n * 2, atEnd); fill(a, mode); fill(b, mode == 0 ? 0 : (mode + 1) % 4);
            bool d = highway_jpeg_h2v1_fancy(a.p, o.p, n); note(4, d, n);
            bool d2 = highway_jpeg_h2v2_fancy(a.p, b.p, o2.p, n); note(5, d2, n);
            CHECK(o.intact() && o2.intact(), "fancy wrote outside n=%zu", n);
            for (size_t i = 0; i < n; i++) {
                size_t l = i ? i - 1 : 0, r = i + 1 < n ? i + 1 : i;
                if (d) CHECK(o.p[2*i] == ((a.p[i] * 3 + a.p[l] + 1) >> 2) && o.p[2*i+1] == ((a.p[i] * 3 + a.p[r] + 2) >> 2), "h2v1 n=%zu i=%zu", n, i);
                auto s = [&](size_t j) { return a.p[j] * 3 + b.p[j]; };
                if (d2) CHECK(o2.p[2*i] == ((s(i) * 3 + s(l) + 8) >> 4) && o2.p[2*i+1] == ((s(i) * 3 + s(r) + 7) >> 4), "h2v2 n=%zu i=%zu", n, i);
            }
        }
    }
}
static void exhaustive() {
    const size_t n = 1 << 16;
    std::vector<uint8_t> a(n), b(n), c(n), o(n * 4), in(n * 4), y(n), cb(n), cr(n);
    for (int v = 0; v < 256; v++) {
        for (size_t i = 0; i < n; i++) { a[i] = v; b[i] = i >> 8; c[i] = i; in[4*i] = v; in[4*i+1] = i >> 8; in[4*i+2] = i; in[4*i+3] = rnd(); }
        CHECK(highway_jpeg_from_ycc(a.data(), b.data(), c.data(), nullptr, o.data(), n), "refused");
        CHECK(highway_jpeg_to_ycc(in.data(), y.data(), cb.data(), cr.data(), n), "refused");
        for (size_t i = 0; i < n; i++) { uint8_t e[3]; ref_ycc(a[i], b[i], c[i], e); CHECK(!memcmp(e, &o[4*i], 3), "ycc %d %d %d", a[i], b[i], c[i]);
            ref_rgb(in[4*i], in[4*i+1], in[4*i+2], e); CHECK(e[0] == y[i] && e[1] == cb[i] && e[2] == cr[i], "rgb %d %d %d", in[4*i], in[4*i+1], in[4*i+2]); }
    }
}
template<class F> static double bench(F f) { double best = 1e9; for (int r = 0; r < 15; r++) { auto t0 = std::chrono::steady_clock::now(); f(); double t = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count(); if (t < best) best = t; } return best; }
int main(int argc, char** argv) {
    if (argc > 1 && !strcmp(argv[1], "targets")) {
        for (int bit = 0; bit < 63; bit++) if (hwy::SupportedTargets() >> bit & 1) printf("%d ", bit);
        printf("\n");
        return 0;
    }
    int64_t t = argc > 1 ? strtoll(argv[1], 0, 0) : 0;
    if (t) hwy::SetSupportedTargetsForTest(t);
    if (argc > 2) { // timing: 3000x2000 image worth of rows
        const size_t w = 3000, h = 2000; std::vector<uint8_t> y(w), cb(w), cr(w), o(w * h * 4), s(w / 2), s2(w / 2), up(w);
        for (auto& v : y) v = rnd(); for (auto& v : cb) v = rnd(); for (auto& v : cr) v = rnd(); for (auto& v : s) v = rnd(); for (auto& v : s2) v = rnd();
        printf("ycc->rgba %.2f ms  ", bench([&] { for (size_t r = 0; r < h; r++) highway_jpeg_from_ycc(y.data(), cb.data(), cr.data(), nullptr, &o[r * w * 4], w); }));
        printf("rgba->ycc %.2f ms  ", bench([&] { for (size_t r = 0; r < h; r++) highway_jpeg_to_ycc(&o[r * w * 4], y.data(), cb.data(), cr.data(), w); }));
        printf("h2v2 fancy (2 comps) %.2f ms  ", bench([&] { for (size_t r = 0; r < h * 2; r++) highway_jpeg_h2v2_fancy(s.data(), s2.data(), up.data(), w / 2); }));
        printf("h2v1 fancy %.2f ms  ", bench([&] { for (size_t r = 0; r < h * 2; r++) highway_jpeg_h2v1_fancy(s.data(), up.data(), w / 2); }));
        printf("down (2 comps) %.2f ms\n", bench([&] { for (size_t r = 0; r < h; r++) highway_jpeg_h2v2_downsample(y.data(), cb.data(), s.data(), w / 2); }));
        return 0;
    }
    widths(300); exhaustive();
    printf("target %s: taken from n =", hwy::TargetName(t ? t : 0)); for (auto v : handledFrom) printf(" %zu", v);
    printf("; failures %ld\n", fails);
    return fails != 0;
}
