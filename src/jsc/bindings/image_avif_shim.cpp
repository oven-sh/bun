// libavif AVIF decode + encode for Bun.Image on Linux. Pattern mirrors
// image_coregraphics_shim.cpp: every libavif call goes through dlsym'd
// function pointers so the binary has no hard dependency on libavif or its
// codec plugins (dav1d for decode; aom/rav1e/SvtAv1Enc for encode). If the
// user hasn't `apt install libavif16` (or equivalent), the first call
// returns `AVIF_UNAVAILABLE` and codecs.zig surfaces
// `error.UnsupportedOnPlatform` — the same failure mode we'd get with no
// static codec at all.
//
// Why dlopen instead of `-lavif -ldav1d -laom -...`: link-time dependencies
// would make bun refuse to start on any host without libavif installed
// — e.g. most minimal Docker images — and would balloon the NEEDED list.
// The feature is AVIF decode+encode; the cost should be paid by users who
// actually hit that path.
//
// Symbol resolution stays lazy (dlsym), so the binary still has no
// libavif/libdav1d load command. dav1d (decode) and the AV1 encoder
// libavif was linked against (aom / rav1e / SvtAv1Enc — distro-dependent)
// are loaded transitively: libavif.so already links against them, so
// RTLD_NOW on libavif pulls them into the process's symbol space.
//
// Pinned struct layouts: we mirror the subset of `avifDecoder`,
// `avifRGBImage`, `avifImage`, `avifRWData`, and `avifEncoder` we actually
// touch, matching the 1.0.0 public ABI (which libavif's own header
// explicitly marks stable via "Version 1.0.0 ends here." markers). Fields
// we don't use are named `_reservedN` to make drift visible at diff-time
// if someone ever bumps the pinned version.

#if defined(__linux__) && !defined(__ANDROID__)

#include <cstddef>
#include <cstdint>
#include <cstdlib> // malloc (ICC-profile copy in bun_avif_decode)
#include <cstring>
#include <dlfcn.h>

namespace {

// ── Pinned libavif ABI (v1.0.0, stable through 1.x) ────────────────────────
// Only the fields we read/write are named; the rest are byte-counted reserves
// so field offsets match the real struct. Source of truth: the `typedef
// struct avifDecoder`/`avifRGBImage` blocks in avif.h from libavif 1.0.0.

using avifBool = int;
using avifResult = int;
constexpr avifResult kAvifResultOk = 0;
constexpr int kAvifRgbFormatRGBA = 1; // enum avifRGBFormat index
constexpr uint32_t kAvifStrictPixiRequired = 1 << 0;
// avifPixelFormat enum values from avif.h:283-290.
constexpr int kAvifPixelFormatYuv420 = 3;
constexpr int kAvifSpeedDefault = -1;

// avifRWData — trivial pair matching avif.h:248-252. Forward-declared here
// because `AvifImage` embeds one (for the ICC profile) and the dlsym table
// takes a pointer to it.
struct AvifRwData {
    uint8_t* data;
    size_t size;
};

// Subset of `avifImage` mirrored down through the `icc` RWData field so
// decode() can pull the ICC profile out without going through a setter.
// Names match the real header 1:1; the YUV/alpha pointers are opaque to us
// but have to be laid out so the `icc` offset matches the real struct.
// Matches the 1.0.0 stable ABI (field order frozen by libavif).
struct AvifImage {
    uint32_t width;
    uint32_t height;
    uint32_t depth;
    int yuvFormat; // avifPixelFormat
    int yuvRange;
    int yuvChromaSamplePosition;
    uint8_t* yuvPlanes[3]; // AVIF_PLANE_COUNT_YUV = 3
    uint32_t yuvRowBytes[3];
    avifBool imageOwnsYUVPlanes;
    uint8_t* alphaPlane;
    uint32_t alphaRowBytes;
    avifBool imageOwnsAlphaPlane;
    avifBool alphaPremultiplied;
    // ICC Profile — bun_avif_decode reads this post-parse and hands it to
    // the Zig wrapper; bun_avif_encode uses the setter (avifImageSetProfileICC)
    // instead of writing here directly so libavif copies the bytes under
    // its own allocator.
    AvifRwData icc;
    // ... more fields (CICP, CLLI, transform, exif/xmp, …) we don't touch.
};

// Subset of `avifDecoder` up through the "Version 1.0.0 ends here." marker.
// Names match the real header 1:1 so drifting fields show up in review as
// a struct edit rather than a silent offset shift.
struct AvifDecoder {
    int codecChoice; // avifCodecChoice
    int maxThreads;
    int requestedSource; // avifDecoderSource
    avifBool allowProgressive;
    avifBool allowIncremental;
    avifBool ignoreExif;
    avifBool ignoreXMP;
    uint32_t imageSizeLimit;
    uint32_t imageDimensionLimit;
    uint32_t imageCountLimit;
    uint32_t strictFlags; // avifStrictFlags
    // Outputs
    AvifImage* image;
    // Trailing fields (imageIndex, imageCount, diagnostics, io, …) go here;
    // we never read them so the struct can end.
};

// Subset of `avifRGBImage`. libavif's `avifRGBImageSetDefaults` zero-inits
// the trailing fields so only the ones we overwrite post-defaults matter
// for correctness — but the size has to be right for setDefaults' memset,
// hence the trailing reserve. 96 bytes covers the full 1.x struct with
// ~40 bytes of future headroom.
struct AvifRgbImage {
    uint32_t width;
    uint32_t height;
    uint32_t depth;
    int format; // avifRGBFormat
    int chromaUpsampling;
    int chromaDownsampling;
    avifBool avoidLibYUV;
    avifBool ignoreAlpha;
    avifBool alphaPremultiplied;
    avifBool isFloat;
    int maxThreads;
    uint8_t* pixels;
    uint32_t rowBytes;
    uint8_t _reserved[48]; // slack for trailing 1.x fields (~8 bytes today)
};

// ── Dlsym table ────────────────────────────────────────────────────────────
struct Syms {
    // Decode surface
    AvifDecoder* (*avifDecoderCreate)();
    void (*avifDecoderDestroy)(AvifDecoder*);
    avifResult (*avifDecoderSetIOMemory)(AvifDecoder*, const uint8_t*, size_t);
    avifResult (*avifDecoderParse)(AvifDecoder*);
    avifResult (*avifDecoderNextImage)(AvifDecoder*);
    void (*avifRGBImageSetDefaults)(AvifRgbImage*, const AvifImage*);
    avifResult (*avifImageYUVToRGB)(const AvifImage*, AvifRgbImage*);
    // Encode surface
    AvifImage* (*avifImageCreate)(uint32_t w, uint32_t h, uint32_t depth, int yuvFormat);
    void (*avifImageDestroy)(AvifImage*);
    avifResult (*avifImageRGBToYUV)(AvifImage*, const AvifRgbImage*);
    // Attaches an ICC profile to the image before encode. libavif copies the
    // bytes into its own allocator, so the caller can free the source right
    // after the call returns.
    avifResult (*avifImageSetProfileICC)(AvifImage*, const uint8_t* icc, size_t iccSize);
    // avifEncoder is declared `void*` here because its mirror struct lives
    // further down; bun_avif_encode() reinterpret_casts the create() return
    // and writes quality/speed/etc. directly. Same ABI-pinned-mirror bucket
    // as AvifDecoder / AvifRgbImage — not truly opaque.
    void* (*avifEncoderCreate)();
    void (*avifEncoderDestroy)(void*);
    avifResult (*avifEncoderWrite)(void*, const AvifImage*, AvifRwData*);
    void (*avifRWDataFree)(AvifRwData*);
};

#define SYM(x) { offsetof(Syms, x), #x }
constexpr struct {
    size_t off;
    const char* name;
} kFields[] = {
    SYM(avifDecoderCreate),
    SYM(avifDecoderDestroy),
    SYM(avifDecoderSetIOMemory),
    SYM(avifDecoderParse),
    SYM(avifDecoderNextImage),
    SYM(avifRGBImageSetDefaults),
    SYM(avifImageYUVToRGB),
    SYM(avifImageCreate),
    SYM(avifImageDestroy),
    SYM(avifImageRGBToYUV),
    SYM(avifImageSetProfileICC),
    SYM(avifEncoderCreate),
    SYM(avifEncoderDestroy),
    SYM(avifEncoderWrite),
    SYM(avifRWDataFree),
};
#undef SYM

// Subset of `avifEncoder` — only the fields we set before calling
// avifEncoderWrite. Layout matches avif.h's `typedef struct avifEncoder`
// from line 1507. Same 1.0.0-stable pin rationale as AvifDecoder above.
struct AvifEncoder {
    int codecChoice;
    int maxThreads;
    int speed;
    int keyframeInterval;
    uint64_t timescale;
    int repetitionCount;
    uint32_t extraLayerCount;
    int quality;
    int qualityAlpha;
    int minQuantizer;
    int maxQuantizer;
    int minQuantizerAlpha;
    int maxQuantizerAlpha;
    int tileRowsLog2;
    int tileColsLog2;
    avifBool autoTiling;
    // scalingMode (avifScalingMode = { avifFraction horizontal; avifFraction vertical; }
    // where avifFraction = { int32_t n; int32_t d }) → 16 bytes.
    uint8_t scalingMode[16];
    // Trailing fields (ioStats, diag, data, csOptions, …) — unused.
};

// Debian/Ubuntu/Fedora/Alpine all ship libavif.so.16 (1.0+); libavif.so.15
// (0.11), libavif.so.14 (0.10.x), libavif.so.13 (0.9) were in older LTS
// releases. Our pinned struct layout matches 1.0+, so we only claim 16; if
// a user is on 0.x the decoder just stays unavailable.
const Syms* load()
{
    static const Syms* table = []() -> const Syms* {
        static Syms s {};
        // RTLD_NOW so libavif's own NEEDED entry for libdav1d.so is resolved
        // eagerly — we never dlsym dav1d directly, but libavif does and we
        // want the "is the decoder usable" question answered at load time,
        // not on the first decode().
        // RTLD_GLOBAL so libavif's lazy load of codec_dav1d.c can see dav1d's
        // symbols; libavif 1.x resolves codecs by dlopen(NULL) + dlsym.
        void* lib = dlopen("libavif.so.16", RTLD_NOW | RTLD_GLOBAL);
        if (!lib) return nullptr;
        auto base = reinterpret_cast<char*>(&s);
        for (auto& f : kFields) {
            void* p = dlsym(lib, f.name);
            if (!p) return nullptr;
            *reinterpret_cast<void**>(base + f.off) = p;
        }
        return &s;
    }();
    return table;
}

} // namespace

// ── C ABI for Zig ──────────────────────────────────────────────────────────
// Return codes mirror the CoreGraphics shim so codecs.zig's Error mapping is
// uniform across backends.
constexpr int kAvifUnavailable = 1;
constexpr int kAvifDecodeFailed = 2;
constexpr int kAvifEncodeFailed = 3;
constexpr int kAvifTooManyPixels = 4; // match CG_TOO_MANY_PIXELS

extern "C" {

// Common decoder setup. Split out so probe() and decode() apply the exact
// same knobs. Both of libavif's pre-parse limits fire inside
// `avifDecoderParse` *before* w/h are exposed, so if they trip the
// rejection comes through as DecodeFailed — masking the shim's own pixel-
// count check. We want the rejection outcome to come from codecs.guard
// (ERR_IMAGE_TOO_MANY_PIXELS, matching jpeg/png/webp), so:
//
//   • `imageDimensionLimit` (default 32768 per side) → set to 0 to
//     disable. Panoramas/wide UI banners can legitimately cross 32768
//     on one side while staying under the total-pixel cap.
//   • `imageSizeLimit` (default 16384² = 268MP) → left at default. The
//     API explicitly documents that it can only be *reduced*, not
//     raised; the header warns about uint32 arithmetic overflow at
//     larger values. So for `maxPixels` opt-ins above 268MP the AVIF
//     path still rejects with DecodeFailed — a known gap the Zig guard
//     can't help with. In practice 268MP is ~16k × 16k, well above the
//     input a Sharp-style web pipeline sees; users past that point are
//     in "custom libavif build" territory anyway.
static void configureDecoder(AvifDecoder* dec)
{
    dec->maxThreads = 1;
    dec->ignoreExif = 1;
    dec->ignoreXMP = 1;
    dec->strictFlags &= ~kAvifStrictPixiRequired;
    dec->imageDimensionLimit = 0;
}

// Probe: fill out_w/out_h from the AVIF container header. No AV1 decode.
int32_t bun_avif_probe(const uint8_t* bytes, size_t len, uint64_t max_pixels,
    uint32_t* out_w, uint32_t* out_h)
{
    auto s = load();
    if (!s) return kAvifUnavailable;

    AvifDecoder* dec = s->avifDecoderCreate();
    if (!dec) return kAvifDecodeFailed;
    struct R {
        const Syms* s;
        AvifDecoder* d;
        ~R() { s->avifDecoderDestroy(d); }
    } r { s, dec };

    configureDecoder(dec);

    if (s->avifDecoderSetIOMemory(dec, bytes, len) != kAvifResultOk) return kAvifDecodeFailed;
    if (s->avifDecoderParse(dec) != kAvifResultOk) return kAvifDecodeFailed;

    AvifImage* img = dec->image;
    if (!img || img->width == 0 || img->height == 0) return kAvifDecodeFailed;

    uint64_t pixels = static_cast<uint64_t>(img->width) * img->height;
    if (pixels > max_pixels) return kAvifTooManyPixels;

    *out_w = img->width;
    *out_h = img->height;
    return 0;
}

// Full decode: fill `out` (w*h*4 bytes, caller-allocated) with straight-alpha
// RGBA8 pixels, and write the source's ICC profile (from the `colr` box)
// into a freshly `malloc`'d buffer at `*out_icc_ptr` with `*out_icc_size`
// bytes — `NULL`/`0` when the container had no profile. The Zig wrapper
// re-homes those bytes into bun.default_allocator and then calls `free()`
// on the libavif-malloc'd source.
//
// Two-phase: the Zig side calls this twice — once with `out=nullptr` to
// read dims from the container (so it can allocate the RGBA buffer), then
// once with `out=buf` to run the AV1 decode + YUV→RGB into that buffer.
// The first call stops at `avifDecoderParse` (ispe-box cheap), the second
// runs `avifDecoderNextImage` + `avifImageYUVToRGB`. Cheap to re-create
// the decoder relative to the AV1 decode itself.
int32_t bun_avif_decode(const uint8_t* bytes, size_t len, uint64_t max_pixels,
    uint32_t* out_w, uint32_t* out_h, uint8_t* out,
    uint8_t** out_icc_ptr, size_t* out_icc_size)
{
    auto s = load();
    if (!s) return kAvifUnavailable;

    AvifDecoder* dec = s->avifDecoderCreate();
    if (!dec) return kAvifDecodeFailed;
    struct R {
        const Syms* s;
        AvifDecoder* d;
        ~R() { s->avifDecoderDestroy(d); }
    } r { s, dec };

    configureDecoder(dec);

    if (s->avifDecoderSetIOMemory(dec, bytes, len) != kAvifResultOk) return kAvifDecodeFailed;
    if (s->avifDecoderParse(dec) != kAvifResultOk) return kAvifDecodeFailed;

    AvifImage* img = dec->image;
    if (!img || img->width == 0 || img->height == 0) return kAvifDecodeFailed;

    uint64_t pixels = static_cast<uint64_t>(img->width) * img->height;
    if (pixels > max_pixels) return kAvifTooManyPixels;

    // Phase 1: just return dims so Zig can allocate.
    *out_w = img->width;
    *out_h = img->height;
    if (!out) return 0;

    if (s->avifDecoderNextImage(dec) != kAvifResultOk) return kAvifDecodeFailed;

    AvifRgbImage rgb;
    std::memset(&rgb, 0, sizeof(rgb));
    s->avifRGBImageSetDefaults(&rgb, img);
    rgb.depth = 8;
    rgb.format = kAvifRgbFormatRGBA;
    rgb.maxThreads = 1;
    rgb.alphaPremultiplied = 0;
    rgb.pixels = out;
    rgb.rowBytes = img->width * 4;
    if (s->avifImageYUVToRGB(img, &rgb) != kAvifResultOk) return kAvifDecodeFailed;

    // Copy out the ICC profile if one was present. The decoder owns
    // `img->icc.data` (it's freed by avifDecoderDestroy when the RAII
    // guard above fires), so hand the caller a separate malloc'd buffer —
    // matches the ownership contract for the RGBA buffer.
    *out_icc_ptr = nullptr;
    *out_icc_size = 0;
    if (img->icc.data != nullptr && img->icc.size > 0) {
        uint8_t* icc_copy = static_cast<uint8_t*>(std::malloc(img->icc.size));
        if (icc_copy == nullptr) {
            // Pixels are already filled in; treat an ICC OOM as "no profile"
            // rather than failing the whole decode — jpeg/png do the same.
            return 0;
        }
        std::memcpy(icc_copy, img->icc.data, img->icc.size);
        *out_icc_ptr = icc_copy;
        *out_icc_size = img->icc.size;
    }
    return 0;
}

// Encode RGBA8 → AVIF bitstream. YUV420 + 8-bit depth + straight alpha —
// the subsampling/depth combo distros' libavif reliably supports across
// every bundled encoder (aom / rav1e / SVT-AV1). Quality is libavif's
// native 0-100 scale (0 = worst, 100 = best); whatever encoder libavif
// picks at runtime honours it natively. On success, `*out_data` points at
// a libavif-malloc'd buffer that the caller must free via
// `bun_avif_free_output`; `*out_size` is its length.
//
// If libavif has no encoder registered (a decode-only build, e.g. Alpine's
// minimal libavif without aom/rav1e/SvtAv1Enc), `avifEncoderWrite` returns
// AVIF_RESULT_NO_CODEC_AVAILABLE and we surface EncodeFailed. The caller
// (Zig codecs.encode → .avif arm) maps that through to
// `ERR_IMAGE_ENCODE_FAILED`, which is the right contract for "the codec
// is present but can't encode this input".
int32_t bun_avif_encode(const uint8_t* rgba, uint32_t w, uint32_t h,
    int quality, const uint8_t* icc, size_t icc_size,
    uint8_t** out_data, size_t* out_size)
{
    auto s = load();
    if (!s) return kAvifUnavailable;

    // Build an empty 8-bit YUV420 image at the caller's dimensions.
    AvifImage* img = s->avifImageCreate(w, h, 8, kAvifPixelFormatYuv420);
    if (!img) return kAvifEncodeFailed;
    struct RImg {
        const Syms* s;
        AvifImage* i;
        ~RImg() { s->avifImageDestroy(i); }
    } rimg { s, img };

    // Attach the source ICC profile before encode so it lands in the
    // output's `colr` box. libavif copies the bytes into its own allocator,
    // so the caller can free `icc` right after this returns. A non-zero
    // return here means the profile allocation failed inside libavif —
    // drop it rather than fail the encode; an AVIF without a profile is
    // still valid (implicitly sRGB via CICP). Same contract as jpeg/png.
    if (icc != nullptr && icc_size > 0) {
        (void)s->avifImageSetProfileICC(img, icc, icc_size);
    }

    // Feed in the straight-alpha RGBA8 source. libavif allocates the YUV+A
    // planes itself during avifImageRGBToYUV.
    AvifRgbImage rgb;
    std::memset(&rgb, 0, sizeof(rgb));
    s->avifRGBImageSetDefaults(&rgb, img);
    rgb.depth = 8;
    rgb.format = kAvifRgbFormatRGBA;
    rgb.maxThreads = 1;
    rgb.alphaPremultiplied = 0;
    rgb.pixels = const_cast<uint8_t*>(rgba); // avifRGBImage.pixels is non-const in the header; we never write
    rgb.rowBytes = w * 4;
    if (s->avifImageRGBToYUV(img, &rgb) != kAvifResultOk) return kAvifEncodeFailed;

    AvifEncoder* enc = reinterpret_cast<AvifEncoder*>(s->avifEncoderCreate());
    if (!enc) return kAvifEncodeFailed;
    struct REnc {
        const Syms* s;
        AvifEncoder* e;
        ~REnc() { s->avifEncoderDestroy(e); }
    } renc { s, enc };

    // Single-threaded on purpose: Bun.Image runs on WorkPool and each task
    // already owns a job slot, so multi-threaded AV1 encode inside a single
    // slot would oversubscribe. autoTiling would pick 1×1 tiles at
    // maxThreads=1 anyway, so it's left at the avifEncoderCreate default.
    enc->maxThreads = 1;
    enc->quality = quality;
    enc->qualityAlpha = quality;
    enc->speed = kAvifSpeedDefault; // defer to whichever encoder; rav1e/aom both have reasonable defaults
    // The remaining (deprecated) quantizer fields stay at avifEncoderCreate's
    // defaults — libavif derives them from `quality` when left alone.

    AvifRwData output { nullptr, 0 };
    if (s->avifEncoderWrite(enc, img, &output) != kAvifResultOk) {
        s->avifRWDataFree(&output);
        return kAvifEncodeFailed;
    }
    *out_data = output.data;
    *out_size = output.size;
    return 0;
}

// Matches bun_avif_encode's output lifetime. Wraps libavif's own
// allocator-aware deallocator so encode() can hand the buffer straight to
// JS via ArrayBuffer.toJSWithContext without a dupe — same ownership
// pattern as WebPFree / tj3Free.
void bun_avif_free_output(uint8_t* data)
{
    if (!data) return;
    auto s = load();
    if (!s) return;
    AvifRwData d { data, 0 };
    s->avifRWDataFree(&d);
}

} // extern "C"

#else

// Non-Linux (or Android): stub so the link succeeds. Zig only calls these
// under `Environment.isLinux and !isAndroid` so they're dead code, but LTO
// needs the definitions.
#include <cstddef>
#include <cstdint>
extern "C" int32_t bun_avif_probe(const uint8_t*, size_t, uint64_t, uint32_t*, uint32_t*) { return 1; }
extern "C" int32_t bun_avif_decode(const uint8_t*, size_t, uint64_t, uint32_t*, uint32_t*, uint8_t*, uint8_t**, size_t*) { return 1; }
extern "C" int32_t bun_avif_encode(const uint8_t*, uint32_t, uint32_t, int, const uint8_t*, size_t, uint8_t**, size_t*) { return 1; }
extern "C" void bun_avif_free_output(uint8_t*) {}

#endif
