// CoreGraphics / ImageIO backend for Bun.Image — implemented entirely in C++.
//
// Calling dlsym'd CG/ImageIO functions through Zig function pointers crashed
// on x86_64 macOS (arm64 was fine). Rather than thunking call-by-call, this
// file owns every framework call: clang generates the SysV/AAPCS64 prologues
// natively, and the Zig boundary is two extern-C entry points with only
// scalar/pointer args.
//
// Decode renders to RGBA via vImage rather than CGBitmapContext+DrawImage:
// CGBitmapContext refuses non-premultiplied alpha, so the old draw-then-
// unpremultiply path lost ±1 LSB on RGB wherever α<255 — and worse, the
// default source-over blend composited the image *over* whatever the caller's
// uninitialised buffer held (0xAA in Zig debug). vImageBuffer_InitWithCGImage
// converts to a caller-chosen pixel format directly — including straight
// alpha — so PNG round-trip stays byte-exact and we drop the manual unpremul
// loop. Encode likewise wraps the straight-alpha buffer in a CGImage via
// CGImageCreate(kCGImageAlphaLast) instead of bouncing through a premultiplied
// bitmap context, dropping the per-pixel premultiply scratch copy.
//
// Symbol resolution stays lazy (dlsym), so the binary still has no
// CoreGraphics/ImageIO/Accelerate load command.

#if defined(__APPLE__)

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <dlfcn.h>

namespace {

using CFRef = void*;

// Accelerate's vImage structs, mirrored locally so we don't pull in the SDK
// header (whose CG typedefs would collide with our CFRef erasure).
struct VBuf {
    void* data;
    unsigned long height;
    unsigned long width;
    size_t rowBytes;
};
struct VFmt {
    uint32_t bitsPerComponent;
    uint32_t bitsPerPixel;
    CFRef colorSpace;
    uint32_t bitmapInfo;
    uint32_t version;
    const double* decode;
    int32_t renderingIntent;
};

// One field per dlsym; declared as a struct so the loader is a 5-line for-each
// over an offset/name table. Ordering doesn't matter.
struct Syms {
    // libobjc — ImageIO/vImage internally autorelease CF/NS objects; on a
    // WorkPool thread there is no enclosing pool, so without an explicit one
    // every call leaks a few KB into the thread's never-drained top-level pool.
    void* (*objc_autoreleasePoolPush)();
    void (*objc_autoreleasePoolPop)(void*);
    // CoreFoundation
    void (*CFRelease)(CFRef);
    CFRef (*CFDataCreateWithBytesNoCopy)(CFRef, const uint8_t*, long, CFRef);
    CFRef (*CFDataCreateMutable)(CFRef, long);
    long (*CFDataGetLength)(CFRef);
    const uint8_t* (*CFDataGetBytePtr)(CFRef);
    CFRef (*CFStringCreateWithCString)(CFRef, const char*, uint32_t);
    CFRef (*CFNumberCreate)(CFRef, int, const void*);
    CFRef (*CFDictionaryCreate)(CFRef, const void**, const void**, long, const void*, const void*);
    // CoreGraphics
    CFRef (*CGColorSpaceCreateDeviceRGB)();
    void (*CGColorSpaceRelease)(CFRef);
    CFRef (*CGImageCreate)(size_t, size_t, size_t, size_t, size_t, CFRef, uint32_t, CFRef, const double*, bool, int32_t);
    size_t (*CGImageGetWidth)(CFRef);
    size_t (*CGImageGetHeight)(CFRef);
    void (*CGImageRelease)(CFRef);
    CFRef (*CGDataProviderCreateWithData)(void*, const void*, size_t, void*);
    void (*CGDataProviderRelease)(CFRef);
    // ImageIO
    CFRef (*CGImageSourceCreateWithData)(CFRef, CFRef);
    CFRef (*CGImageSourceCreateImageAtIndex)(CFRef, size_t, CFRef);
    CFRef (*CGImageDestinationCreateWithData)(CFRef, CFRef, size_t, CFRef);
    void (*CGImageDestinationAddImage)(CFRef, CFRef, CFRef);
    bool (*CGImageDestinationFinalize)(CFRef);
    // Accelerate / vImage
    long (*vImageBuffer_InitWithCGImage)(VBuf*, VFmt*, const double*, CFRef, uint32_t);
    long (*vImageScale_ARGB8888)(const VBuf*, const VBuf*, void*, uint32_t);
    long (*vImageRotate90_ARGB8888)(const VBuf*, const VBuf*, uint8_t, const uint8_t*, uint32_t);
    long (*vImageHorizontalReflect_ARGB8888)(const VBuf*, const VBuf*, uint32_t);
    long (*vImageVerticalReflect_ARGB8888)(const VBuf*, const VBuf*, uint32_t);
    // Data symbols (dlsym returns the *address* of the global; we store that
    // address and dereference at use-site).
    CFRef* kCFAllocatorNull;
    CFRef* kCGImageDestinationLossyCompressionQuality;
    const void* kCFTypeDictionaryKeyCallBacks;
    const void* kCFTypeDictionaryValueCallBacks;
};

#define SYM(x) { offsetof(Syms, x), #x }
constexpr struct {
    size_t off;
    const char* name;
} kFields[] = {
    SYM(objc_autoreleasePoolPush),
    SYM(objc_autoreleasePoolPop),
    SYM(CFRelease),
    SYM(CFDataCreateWithBytesNoCopy),
    SYM(CFDataCreateMutable),
    SYM(CFDataGetLength),
    SYM(CFDataGetBytePtr),
    SYM(CFStringCreateWithCString),
    SYM(CFNumberCreate),
    SYM(CFDictionaryCreate),
    SYM(CGColorSpaceCreateDeviceRGB),
    SYM(CGColorSpaceRelease),
    SYM(CGImageCreate),
    SYM(CGImageGetWidth),
    SYM(CGImageGetHeight),
    SYM(CGImageRelease),
    SYM(CGDataProviderCreateWithData),
    SYM(CGDataProviderRelease),
    SYM(CGImageSourceCreateWithData),
    SYM(CGImageSourceCreateImageAtIndex),
    SYM(CGImageDestinationCreateWithData),
    SYM(CGImageDestinationAddImage),
    SYM(CGImageDestinationFinalize),
    SYM(vImageBuffer_InitWithCGImage),
    SYM(vImageScale_ARGB8888),
    SYM(vImageRotate90_ARGB8888),
    SYM(vImageHorizontalReflect_ARGB8888),
    SYM(vImageVerticalReflect_ARGB8888),
    SYM(kCFAllocatorNull),
    SYM(kCGImageDestinationLossyCompressionQuality),
    SYM(kCFTypeDictionaryKeyCallBacks),
    SYM(kCFTypeDictionaryValueCallBacks),
};
#undef SYM

// Called from WorkPool threads. Function-local static init is thread-safe in
// C++11 (Itanium/MSVC ABI both guarantee it), so the dlopen/dlsym pass runs
// exactly once with proper happens-before for the populated table.
const Syms* load()
{
    static const Syms* table = []() -> const Syms* {
        static Syms s {};
        void* libs[] = {
            dlopen("/usr/lib/libobjc.A.dylib", RTLD_LAZY | RTLD_LOCAL),
            dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", RTLD_LAZY | RTLD_LOCAL),
            dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", RTLD_LAZY | RTLD_LOCAL),
            dlopen("/System/Library/Frameworks/ImageIO.framework/ImageIO", RTLD_LAZY | RTLD_LOCAL),
            dlopen("/System/Library/Frameworks/Accelerate.framework/Accelerate", RTLD_LAZY | RTLD_LOCAL),
        };
        for (auto l : libs)
            if (!l) return nullptr;
        auto base = reinterpret_cast<char*>(&s);
        for (auto& f : kFields) {
            void* p = nullptr;
            for (auto l : libs)
                if ((p = dlsym(l, f.name))) break;
            if (!p) return nullptr;
            *reinterpret_cast<void**>(base + f.off) = p;
        }
        return &s;
    }();
    return table;
}

// Prefixed: the macOS PCH transitively includes CG headers, so the real
// `kCGImageAlphaLast`/`kCFStringEncodingUTF8` are in scope and an
// anonymous-namespace shadow is ambiguous at the use site.
constexpr uint32_t kBunCGImageAlphaLast = 3; // straight RGBA, A in byte 3
constexpr uint32_t kBunCFStringEncodingUTF8 = 0x08000100;
constexpr int kBunCFNumberDoubleType = 13;
// vImage_Flags — values copied verbatim from <Accelerate/vImage_Types.h>;
// keep them in sync, the kvImageNoAllocate one used to be wrong (4 vs 512)
// and silently turned every CG decode into 0xAA garbage in debug builds.
constexpr uint32_t kBunVImageEdgeExtend = 8;
constexpr uint32_t kBunVImageDoNotTile = 16;
constexpr uint32_t kBunVImageHighQualityResampling = 32;
constexpr uint32_t kBunVImageNoAllocate = 512;

// RAII pool so every early-return drains. Declared first in each entry point —
// the framework calls beneath autorelease into it, and the WorkPool thread has
// no enclosing pool of its own.
struct Pool {
    const Syms* s;
    void* p;
    explicit Pool(const Syms* s)
        : s(s)
        , p(s->objc_autoreleasePoolPush())
    {
    }
    ~Pool() { s->objc_autoreleasePoolPop(p); }
};

} // namespace

extern "C" {

// Status codes match codecs.Error semantics: caller maps these.
enum : int32_t { CG_OK = 0,
    CG_UNAVAILABLE = 1,
    CG_DECODE_FAILED = 2,
    CG_ENCODE_FAILED = 3,
    CG_TOO_MANY_PIXELS = 4 };

// Decode `bytes[0..len)` into a caller-allocated RGBA8 buffer.
// Two-phase: pass `out=nullptr` to get dimensions; then call again with a
// buffer of `w*h*4` to fill it. Avoids allocating in C++ so the Zig side owns
// the buffer in `bun.default_allocator` like every other decode path.
int32_t bun_coregraphics_decode(const uint8_t* bytes, size_t len, uint64_t max_pixels,
    uint32_t* out_w, uint32_t* out_h, uint8_t* out)
{
    auto s = load();
    if (!s) return CG_UNAVAILABLE;
    Pool pool(s);

    CFRef data = s->CFDataCreateWithBytesNoCopy(nullptr, bytes, static_cast<long>(len), *s->kCFAllocatorNull);
    if (!data) return CG_DECODE_FAILED;
    struct R {
        const Syms* s;
        CFRef d, src, img, cs;
        ~R()
        {
            if (cs) s->CGColorSpaceRelease(cs);
            if (img) s->CGImageRelease(img);
            if (src) s->CFRelease(src);
            if (d) s->CFRelease(d);
        }
    } r { s, data, nullptr, nullptr, nullptr };

    r.src = s->CGImageSourceCreateWithData(data, nullptr);
    if (!r.src) return CG_DECODE_FAILED;
    r.img = s->CGImageSourceCreateImageAtIndex(r.src, 0, nullptr);
    if (!r.img) return CG_DECODE_FAILED;

    size_t w = s->CGImageGetWidth(r.img);
    size_t h = s->CGImageGetHeight(r.img);
    if (w == 0 || h == 0) return CG_DECODE_FAILED;
    if (static_cast<uint64_t>(w) * h > max_pixels) return CG_TOO_MANY_PIXELS;
    if (!out) {
        *out_w = static_cast<uint32_t>(w);
        *out_h = static_cast<uint32_t>(h);
        return CG_OK; // dimensions-only probe
    }
    // TOCTOU guard: the input is a borrowed-but-mutable JS slice and this runs
    // on a WorkPool thread, so JS could rewrite it with a *larger* image
    // between the size probe and this render. The caller's `out` is sized for
    // *out_w × *out_h from phase 1; refuse to draw past it.
    if (w != *out_w || h != *out_h) return CG_DECODE_FAILED;

    r.cs = s->CGColorSpaceCreateDeviceRGB();
    if (!r.cs) return CG_UNAVAILABLE;
    // vImage converts directly to the requested format — including
    // non-premultiplied alpha, which CGBitmapContext refuses — so the result
    // is straight RGBA with no premul→unpremul quantisation. kvImageNoAllocate
    // makes it write into the caller's bun.default_allocator buffer.
    VBuf buf { out, h, w, w * 4 };
    VFmt fmt { 8, 32, r.cs, kBunCGImageAlphaLast, 0, nullptr, 0 };
    auto rc = s->vImageBuffer_InitWithCGImage(&buf, &fmt, nullptr, r.img, kBunVImageNoAllocate);
    // The contract is that kvImageNoAllocate honours buf.data exactly, but be
    // defensive: an OS that ignored the flag would set buf.data to its own
    // malloc and leave `out` uninitialised, which on a Zig debug build is
    // 0xAA — that's the garbage we shipped before the constant was fixed.
    if (rc != 0 || buf.data != out) return CG_DECODE_FAILED;
    return CG_OK;
}

// Encode RGBA8 → format. format: 0=jpeg, 1=png, 2=webp, 3=heic, 4=avif.
// Quality 1-100. Two-phase like decode: pass `out=nullptr` to get the encoded
// size into `*out_len`; the encoded bytes are held in a static-thread-local
// CFData until the next call so the second call can copy them out without
// re-encoding. (One encode, one memcpy — same allocation count as the static
// codecs after the recent Encoded refactor.)
int32_t bun_coregraphics_encode(const uint8_t* rgba, uint32_t width, uint32_t height,
    int32_t format, int32_t quality, uint8_t* out, size_t* out_len)
{
    auto s = load();
    if (!s) return CG_UNAVAILABLE;
    Pool pool(s);
    // Thread-local pending result so the size-probe and the copy-out share one
    // encode. Safe: each WorkPool thread runs at most one PipelineTask at a
    // time, and the two calls are back-to-back in codecs.zig.
    thread_local CFRef pending = nullptr;
    if (out && pending) {
        long n = s->CFDataGetLength(pending);
        std::memcpy(out, s->CFDataGetBytePtr(pending), static_cast<size_t>(n));
        *out_len = static_cast<size_t>(n);
        s->CFRelease(pending);
        pending = nullptr;
        return CG_OK;
    }
    if (pending) {
        s->CFRelease(pending);
        pending = nullptr;
    }

    static const char* kUti[] = {
        "public.jpeg", "public.png", "org.webmproject.webp",
        "public.heic", "public.avif"
    };
    if (static_cast<unsigned>(format) >= sizeof(kUti) / sizeof(kUti[0])) return CG_UNAVAILABLE;
    const char* uti = kUti[format];

    struct R {
        const Syms* s;
        CFRef cs, prov, img, ustr, sink, dest, num, props;
        ~R()
        {
            if (props) s->CFRelease(props);
            if (num) s->CFRelease(num);
            if (dest) s->CFRelease(dest);
            // sink is NOT released here on success — it becomes `pending`.
            if (ustr) s->CFRelease(ustr);
            if (img) s->CGImageRelease(img);
            if (prov) s->CGDataProviderRelease(prov);
            if (cs) s->CGColorSpaceRelease(cs);
        }
    } r {};
    r.s = s;

    r.cs = s->CGColorSpaceCreateDeviceRGB();
    if (!r.cs) return CG_UNAVAILABLE;

    // Wrap the pipeline's straight-alpha RGBA directly — CGImageCreate (unlike
    // CGBitmapContext) accepts kCGImageAlphaLast, so no premultiply scratch
    // copy and no ±1 quantisation. The provider has a NULL release callback
    // since `rgba` outlives this call.
    size_t n = static_cast<size_t>(width) * height * 4;
    r.prov = s->CGDataProviderCreateWithData(nullptr, rgba, n, nullptr);
    if (!r.prov) return CG_UNAVAILABLE;
    r.img = s->CGImageCreate(width, height, 8, 32, static_cast<size_t>(width) * 4,
        r.cs, kBunCGImageAlphaLast, r.prov, nullptr, false, 0);
    if (!r.img) return CG_ENCODE_FAILED;

    r.ustr = s->CFStringCreateWithCString(nullptr, uti, kBunCFStringEncodingUTF8);
    if (!r.ustr) return CG_UNAVAILABLE;
    r.sink = s->CFDataCreateMutable(nullptr, 0);
    if (!r.sink) return CG_UNAVAILABLE;
    r.dest = s->CGImageDestinationCreateWithData(r.sink, r.ustr, 1, nullptr);
    if (!r.dest) {
        s->CFRelease(r.sink);
        return CG_UNAVAILABLE; // format not supported by this ImageIO (eg WebP on old macOS)
    }

    CFRef props = nullptr;
    if (format != 1) { // quality only for lossy
        double q = static_cast<double>(quality < 1 ? 1 : quality > 100 ? 100
                                                                       : quality)
            / 100.0;
        r.num = s->CFNumberCreate(nullptr, kBunCFNumberDoubleType, &q);
        const void* k = *s->kCGImageDestinationLossyCompressionQuality;
        const void* v = r.num;
        // CFType callbacks (NOT null) so CF retains/hashes the CFString key
        // properly — null callbacks mean raw-pointer semantics and ImageIO's
        // lookup would miss.
        r.props = s->CFDictionaryCreate(nullptr, &k, &v, 1, s->kCFTypeDictionaryKeyCallBacks, s->kCFTypeDictionaryValueCallBacks);
        props = r.props;
    }

    s->CGImageDestinationAddImage(r.dest, r.img, props);
    if (!s->CGImageDestinationFinalize(r.dest)) {
        s->CFRelease(r.sink);
        return CG_ENCODE_FAILED;
    }

    *out_len = static_cast<size_t>(s->CFDataGetLength(r.sink));
    pending = r.sink; // released on the copy-out call
    return CG_OK;
}

// ── Geometry via vImage ────────────────────────────────────────────────────
//
// These take packed RGBA8 (rowBytes = w*4) on both ends so the Zig side can
// keep allocating with `bun.default_allocator`. The ARGB8888 kernels are
// channel-order agnostic for 4×u8, so RGBA works without a permute. They run
// on Apple's AMX units on M-series — typically 2-4× the Highway path — and we
// already have Accelerate dlopened for decode, so the only cost is four more
// dlsyms. kvImageDoNotTile: this is already a WorkPool thread, and the
// pipeline stages run back-to-back in one task, so vImage's internal
// libdispatch fan-out would oversubscribe (and dominates wall-clock for the
// tiny images the test suite uses). tempBuffer = nullptr lets vImage manage
// its own scratch.

int32_t bun_coregraphics_scale(const uint8_t* src, uint32_t sw, uint32_t sh,
    uint8_t* dst, uint32_t dw, uint32_t dh, int32_t high_quality)
{
    auto s = load();
    if (!s) return CG_UNAVAILABLE;
    VBuf in { const_cast<uint8_t*>(src), sh, sw, static_cast<size_t>(sw) * 4 };
    VBuf out { dst, dh, dw, static_cast<size_t>(dw) * 4 };
    uint32_t flags = kBunVImageEdgeExtend | kBunVImageDoNotTile
        | (high_quality ? kBunVImageHighQualityResampling : 0);
    return s->vImageScale_ARGB8888(&in, &out, nullptr, flags) == 0 ? CG_OK : CG_UNAVAILABLE;
}

// `quarters` is in CW quarter-turns (matching Sharp/CSS); vImage's constant is
// CCW, so map 90→3, 180→2, 270→1.
int32_t bun_coregraphics_rotate90(const uint8_t* src, uint32_t w, uint32_t h,
    uint8_t* dst, uint32_t quarters)
{
    auto s = load();
    if (!s) return CG_UNAVAILABLE;
    static constexpr uint8_t kCcw[4] = { 0, 3, 2, 1 };
    static constexpr uint8_t kBg[4] = { 0, 0, 0, 0 };
    bool swap = quarters & 1;
    VBuf in { const_cast<uint8_t*>(src), h, w, static_cast<size_t>(w) * 4 };
    VBuf out { dst, swap ? w : h, swap ? h : w, static_cast<size_t>(swap ? h : w) * 4 };
    return s->vImageRotate90_ARGB8888(&in, &out, kCcw[quarters & 3], kBg, kBunVImageDoNotTile) == 0
        ? CG_OK
        : CG_UNAVAILABLE;
}

int32_t bun_coregraphics_reflect(const uint8_t* src, uint32_t w, uint32_t h,
    uint8_t* dst, int32_t horizontal)
{
    auto s = load();
    if (!s) return CG_UNAVAILABLE;
    VBuf in { const_cast<uint8_t*>(src), h, w, static_cast<size_t>(w) * 4 };
    VBuf out { dst, h, w, static_cast<size_t>(w) * 4 };
    auto fn = horizontal ? s->vImageHorizontalReflect_ARGB8888 : s->vImageVerticalReflect_ARGB8888;
    return fn(&in, &out, kBunVImageDoNotTile) == 0 ? CG_OK : CG_UNAVAILABLE;
}

} // extern "C"

#else
// Non-Apple: stubs so the link succeeds; Zig only references these under
// Environment.isMac so they're dead code, but LTO needs the definitions.
extern "C" int bun_coregraphics_decode(const void*, unsigned long, unsigned long long, void*, void*, void*) { return 1; }
extern "C" int bun_coregraphics_encode(const void*, unsigned, unsigned, int, int, void*, void*) { return 1; }
extern "C" int bun_coregraphics_scale(const void*, unsigned, unsigned, void*, unsigned, unsigned, int) { return 1; }
extern "C" int bun_coregraphics_rotate90(const void*, unsigned, unsigned, void*, unsigned) { return 1; }
extern "C" int bun_coregraphics_reflect(const void*, unsigned, unsigned, void*, int) { return 1; }
#endif
