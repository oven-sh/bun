// CoreGraphics / ImageIO backend for Bun.Image — implemented entirely in C++.
//
// This file owns every framework call: clang generates the SysV/AAPCS64
// prologues natively, and the FFI boundary is two extern-C entry points with
// only scalar/pointer args.
//
// Decode renders to RGBA via vImage rather than CGBitmapContext+DrawImage:
// CGBitmapContext refuses non-premultiplied alpha, so the old draw-then-
// unpremultiply path lost ±1 LSB on RGB wherever α<255 — and worse, the
// default source-over blend composited the image *over* whatever the caller's
// uninitialised buffer held. vImageBuffer_InitWithCGImage
// converts to a caller-chosen pixel format directly — including straight
// alpha — so PNG round-trip stays byte-exact and we drop the manual unpremul
// loop; the bitmap context survives only as a fallback for layouts vImage
// rejects. Encode likewise wraps the straight-alpha buffer in a CGImage via
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
#include <memory>
#include <mimalloc.h>
#include <mutex>

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
// Same layout/ABI as CGRect (four doubles); the SDK typedef is avoided for the same reason as above.
struct BunRect {
    double x, y, w, h;
};

// One field per dlsym; declared as a struct so the loader is a 5-line for-each
// over an offset/name table. Ordering doesn't matter.
struct Syms {
    // libobjc — ImageIO/vImage internally autorelease CF/NS objects; on a
    // WorkPool thread there is no enclosing pool, so without an explicit one
    // every call leaks a few KB into the thread's never-drained top-level pool.
    void* (*objc_autoreleasePoolPush)();
    void (*objc_autoreleasePoolPop)(void*);
    // libobjc runtime — used only by the NSPasteboard clipboard reader. The
    // actual `objc_msgSend` is variadic-shaped in the ABI but we cast per call
    // site to the receiver/SEL/args signature we need.
    void* (*objc_getClass)(const char*);
    void* (*sel_registerName)(const char*);
    void* objc_msgSend; // cast at use site
    // CoreFoundation
    void (*CFRelease)(CFRef);
    CFRef (*CFAllocatorCreate)(CFRef, const void*);
    CFRef (*CFDataCreateWithBytesNoCopy)(CFRef, const uint8_t*, long, CFRef);
    CFRef (*CFDataCreateMutable)(CFRef, long);
    long (*CFDataGetLength)(CFRef);
    const uint8_t* (*CFDataGetBytePtr)(CFRef);
    CFRef (*CFStringCreateWithCString)(CFRef, const char*, uint32_t);
    CFRef (*CFNumberCreate)(CFRef, int, const void*);
    CFRef (*CFDictionaryCreate)(CFRef, const void**, const void**, long, const void*, const void*);
    // CoreGraphics
    CFRef (*CGColorSpaceCreateDeviceRGB)();
    CFRef (*CGImageCreate)(size_t, size_t, size_t, size_t, size_t, CFRef, uint32_t, CFRef, const double*, bool, int32_t);
    size_t (*CGImageGetWidth)(CFRef);
    size_t (*CGImageGetHeight)(CFRef);
    uint32_t (*CGImageGetAlphaInfo)(CFRef);
    CFRef (*CGImageGetDataProvider)(CFRef);
    CFRef (*CGDataProviderCreateWithData)(void*, const void*, size_t, void*);
    CFRef (*CGDataProviderCopyData)(CFRef);
    CFRef (*CGBitmapContextCreate)(void*, size_t, size_t, size_t, size_t, CFRef, uint32_t);
    void (*CGContextDrawImage)(CFRef, BunRect, CFRef);
    // ImageIO
    CFRef (*CGImageSourceCreateWithData)(CFRef, CFRef);
    CFRef (*CGImageSourceCreateImageAtIndex)(CFRef, size_t, CFRef);
    CFRef (*CGImageDestinationCreateWithData)(CFRef, CFRef, size_t, CFRef);
    void (*CGImageDestinationAddImage)(CFRef, CFRef, CFRef);
    bool (*CGImageDestinationFinalize)(CFRef);
    // Accelerate / vImage
    long (*vImageBuffer_InitWithCGImage)(VBuf*, VFmt*, const double*, CFRef, uint32_t);
    long (*vImageUnpremultiplyData_RGBA8888)(const VBuf*, const VBuf*, uint32_t);
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
    // Not a dlsym: a CFAllocator over mimalloc, made once by load().
    CFRef mimallocAllocator;
};

// Same layout as CFAllocatorContext.
struct AllocatorContext {
    long version;
    void* info;
    const void* (*retain)(const void*);
    void (*release)(const void*);
    CFRef (*copyDescription)(const void*);
    void* (*allocate)(long size, unsigned long hint, void* info);
    void* (*reallocate)(void* block, long size, unsigned long hint, void* info);
    void (*deallocate)(void* block, void* info);
    long (*preferredSize)(long size, unsigned long hint, void* info);
};

#define SYM(x) { offsetof(Syms, x), #x }
constexpr struct {
    size_t off;
    const char* name;
} kFields[] = {
    SYM(objc_autoreleasePoolPush),
    SYM(objc_autoreleasePoolPop),
    SYM(objc_getClass),
    SYM(sel_registerName),
    SYM(objc_msgSend),
    SYM(CFRelease),
    SYM(CFAllocatorCreate),
    SYM(CFDataCreateWithBytesNoCopy),
    SYM(CFDataCreateMutable),
    SYM(CFDataGetLength),
    SYM(CFDataGetBytePtr),
    SYM(CFStringCreateWithCString),
    SYM(CFNumberCreate),
    SYM(CFDictionaryCreate),
    SYM(CGColorSpaceCreateDeviceRGB),
    SYM(CGImageCreate),
    SYM(CGImageGetWidth),
    SYM(CGImageGetHeight),
    SYM(CGImageGetAlphaInfo),
    SYM(CGImageGetDataProvider),
    SYM(CGDataProviderCreateWithData),
    SYM(CGDataProviderCopyData),
    SYM(CGBitmapContextCreate),
    SYM(CGContextDrawImage),
    SYM(CGImageSourceCreateWithData),
    SYM(CGImageSourceCreateImageAtIndex),
    SYM(CGImageDestinationCreateWithData),
    SYM(CGImageDestinationAddImage),
    SYM(CGImageDestinationFinalize),
    SYM(vImageBuffer_InitWithCGImage),
    SYM(vImageUnpremultiplyData_RGBA8888),
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
        AllocatorContext context {};
        context.allocate = [](long size, unsigned long, void*) { return mi_malloc(static_cast<size_t>(size)); };
        context.reallocate = [](void* block, long size, unsigned long, void*) { return mi_realloc(block, static_cast<size_t>(size)); };
        context.deallocate = [](void* block, void*) { mi_free(block); };
        s.mimallocAllocator = s.CFAllocatorCreate(nullptr, &context);
        if (!s.mimallocAllocator) return nullptr;
        return &s;
    }();
    return table;
}

// Prefixed: the macOS PCH transitively includes CG headers, so the real
// `kCGImageAlphaLast`/`kCFStringEncodingUTF8` are in scope and an
// anonymous-namespace shadow is ambiguous at the use site.
constexpr uint32_t kBunCGImageAlphaLast = 3; // straight RGBA, A in byte 3
constexpr uint32_t kBunCGImageAlphaPremultipliedLast = 1;
constexpr uint32_t kBunCGImageAlphaNone = 0;
constexpr uint32_t kBunCGImageAlphaNoneSkipLast = 5;
constexpr uint32_t kBunCGImageAlphaNoneSkipFirst = 6;
constexpr uint32_t kBunCFStringEncodingUTF8 = 0x08000100;
constexpr int kBunCFNumberDoubleType = 13;
// vImage_Flags — values copied verbatim from <Accelerate/vImage_Types.h>;
// keep them in sync, a wrong constant silently turns every CG decode into garbage.
constexpr uint32_t kBunVImageEdgeExtend = 8;
constexpr uint32_t kBunVImageDoNotTile = 16;
constexpr uint32_t kBunVImageGetTempBufferSize = 128;
// (kvImageHighQualityResampling = 32 — unused; default kernel is already
// Lanczos-3, which is what we route here.)
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

// For the CoreGraphics types too: their own release functions only add a null check.
using CFPtr = std::unique_ptr<void, void (*)(CFRef)>;
inline CFPtr adopt(const Syms* s, CFRef ref) { return { ref, s->CFRelease }; }

// `id`/`SEL` are already typedef'd via the PCH's objc headers; we erase to
// CFRef everywhere else, so cast objc_msgSend per-site through this template.
template<class R, class... A>
inline R msg(const Syms* s, CFRef recv, CFRef sel, A... a)
{
    return reinterpret_cast<R (*)(CFRef, CFRef, A...)>(s->objc_msgSend)(recv, sel, a...);
}

// Image UTIs in preference order. PNG first (lossless, compact); then formats
// the source app may have placed natively (heic from Photos, jpeg/webp from a
// browser); TIFF last because the system's automatic-PNG→TIFF conversion makes
// it a guaranteed fallback but it's huge. `public.image` isn't a concrete
// type, so we don't list it — apps put concrete UTIs.
constexpr const char* kImageUti[] = {
    "public.png",
    "public.heic",
    "public.heif",
    "public.avif",
    "public.jpeg",
    "org.webmproject.webp",
    "com.compuserve.gif",
    "com.microsoft.bmp",
    "public.tiff",
};

// `[NSPasteboard generalPasteboard]`. AppKit is not auto-loaded in a CLI
// process (only Foundation is), so dlopen it the first time the clipboard is
// touched. RTLD_GLOBAL so its classes register with the objc runtime; RTLD_LAZY
// because AppKit drags in ~40 MB of frameworks and we only need one class.
inline CFRef generalPasteboard(const Syms* s)
{
    CFRef cls = s->objc_getClass("NSPasteboard");
    if (!cls) {
        static std::once_flag once;
        std::call_once(once, [] {
            dlopen("/System/Library/Frameworks/AppKit.framework/AppKit",
                RTLD_LAZY | RTLD_GLOBAL);
        });
        cls = s->objc_getClass("NSPasteboard");
        if (!cls) return nullptr;
    }
    return msg<CFRef>(s, cls, s->sel_registerName("generalPasteboard"));
}

} // namespace

extern "C" {

// Status codes match codecs.Error semantics: caller maps these.
enum : int32_t { CG_OK = 0,
    CG_UNAVAILABLE = 1,
    CG_DECODE_FAILED = 2,
    CG_ENCODE_FAILED = 3,
    CG_TOO_MANY_PIXELS = 4,
    CG_NO_IMAGE = 5 };

// backend_coregraphics.rs. `data` goes back to bun_coregraphics_release().
struct OwnedData {
    CFRef data;
    const uint8_t* bytes;
    size_t length;
};

// Decode `bytes[0..len)` into a caller-allocated RGBA8 buffer.
// Two-phase: pass `out=nullptr` to get dimensions; then call again with a
// buffer of `w*h*4` to fill it. Avoids allocating in C++ so the caller owns
// the buffer like every other decode path.
int32_t bun_coregraphics_decode(const uint8_t* bytes, size_t len, uint64_t max_pixels,
    uint32_t* out_w, uint32_t* out_h, uint8_t* out)
{
    auto s = load();
    if (!s) return CG_UNAVAILABLE;
    Pool pool(s);

    auto data = adopt(s, s->CFDataCreateWithBytesNoCopy(nullptr, bytes, static_cast<long>(len), *s->kCFAllocatorNull));
    if (!data) return CG_DECODE_FAILED;
    auto src = adopt(s, s->CGImageSourceCreateWithData(data.get(), nullptr));
    if (!src) return CG_DECODE_FAILED;
    auto img = adopt(s, s->CGImageSourceCreateImageAtIndex(src.get(), 0, nullptr));
    if (!img) return CG_DECODE_FAILED;

    size_t w = s->CGImageGetWidth(img.get());
    size_t h = s->CGImageGetHeight(img.get());
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

    auto cs = adopt(s, s->CGColorSpaceCreateDeviceRGB());
    if (!cs) return CG_UNAVAILABLE;
    // vImage converts directly to the requested format — including
    // non-premultiplied alpha, which CGBitmapContext refuses — so the result
    // is straight RGBA with no premul→unpremul quantisation. kvImageNoAllocate
    // makes it write into the caller's bun.default_allocator buffer.
    VBuf buf { out, h, w, w * 4 };
    VFmt fmt { 8, 32, cs.get(), kBunCGImageAlphaLast, 0, nullptr, 0 };
    auto rc = s->vImageBuffer_InitWithCGImage(&buf, &fmt, nullptr, img.get(), kBunVImageNoAllocate);
    if (rc == 0 && buf.data != out) return CG_DECODE_FAILED;
    if (rc != 0) {
        // vImage rejects the packed 10-bit layout ImageIO returns for 10-bit HEVC; CoreGraphics still draws it.
        std::memset(out, 0, w * h * 4);
        auto ctx = adopt(s, s->CGBitmapContextCreate(out, w, h, 8, w * 4, cs.get(), kBunCGImageAlphaPremultipliedLast));
        if (!ctx) return CG_DECODE_FAILED;
        s->CGContextDrawImage(ctx.get(), BunRect { 0, 0, static_cast<double>(w), static_cast<double>(h) }, img.get());
        if (s->vImageUnpremultiplyData_RGBA8888(&buf, &buf, kBunVImageDoNotTile) != 0) return CG_DECODE_FAILED;
    }
    // ImageIO decodes lazily and a codec failure (eg HEVC) draws every byte as 0 without an error.
    uint32_t alpha = s->CGImageGetAlphaInfo(img.get());
    bool opaque = alpha == kBunCGImageAlphaNone || alpha == kBunCGImageAlphaNoneSkipLast || alpha == kBunCGImageAlphaNoneSkipFirst;
    uint8_t all = 0xFF, any = 0;
    for (size_t i = 3, n = w * h * 4; i < n; i += 4) {
        all &= out[i];
        any |= out[i];
    }
    if (opaque) return all == 0xFF ? CG_OK : CG_DECODE_FAILED;
    if (any) return CG_OK;
    // Fully transparent output from an alpha source: only the provider copy tells "all clear" from "failed".
    return adopt(s, s->CGDataProviderCopyData(s->CGImageGetDataProvider(img.get()))) ? CG_OK : CG_DECODE_FAILED;
}

// Encode RGBA8 → format. format: 0=jpeg, 1=png, 2=webp, 3=heic, 4=avif.
// Quality 1-100.
int32_t bun_coregraphics_encode(const uint8_t* rgba, uint32_t width, uint32_t height,
    int32_t format, int32_t quality, OwnedData* out)
{
    auto s = load();
    if (!s) return CG_UNAVAILABLE;
    Pool pool(s);

    static const char* kUti[] = {
        "public.jpeg", "public.png", "org.webmproject.webp",
        "public.heic", "public.avif"
    };
    if (static_cast<unsigned>(format) >= sizeof(kUti) / sizeof(kUti[0])) return CG_UNAVAILABLE;
    const char* uti = kUti[format];

    auto cs = adopt(s, s->CGColorSpaceCreateDeviceRGB());
    if (!cs) return CG_UNAVAILABLE;

    // Wrap the pipeline's straight-alpha RGBA directly — CGImageCreate (unlike
    // CGBitmapContext) accepts kCGImageAlphaLast, so no premultiply scratch
    // copy and no ±1 quantisation. The provider has a NULL release callback
    // since `rgba` outlives this call.
    size_t n = static_cast<size_t>(width) * height * 4;
    auto prov = adopt(s, s->CGDataProviderCreateWithData(nullptr, rgba, n, nullptr));
    if (!prov) return CG_UNAVAILABLE;
    auto img = adopt(s, s->CGImageCreate(width, height, 8, 32, static_cast<size_t>(width) * 4, cs.get(), kBunCGImageAlphaLast, prov.get(), nullptr, false, 0));
    if (!img) return CG_ENCODE_FAILED;

    auto ustr = adopt(s, s->CFStringCreateWithCString(nullptr, uti, kBunCFStringEncodingUTF8));
    if (!ustr) return CG_UNAVAILABLE;
    auto sink = adopt(s, s->CFDataCreateMutable(s->mimallocAllocator, 0));
    if (!sink) return CG_UNAVAILABLE;
    auto dest = adopt(s, s->CGImageDestinationCreateWithData(sink.get(), ustr.get(), 1, nullptr));
    if (!dest) return CG_UNAVAILABLE; // format not supported by this ImageIO (eg WebP on old macOS)

    auto props = adopt(s, nullptr);
    if (format != 1) { // quality only for lossy
        double q = static_cast<double>(quality < 1 ? 1 : quality > 100 ? 100
                                                                       : quality)
            / 100.0;
        auto num = adopt(s, s->CFNumberCreate(nullptr, kBunCFNumberDoubleType, &q));
        const void* k = *s->kCGImageDestinationLossyCompressionQuality;
        const void* v = num.get();
        // CFType callbacks (NOT null) so CF retains/hashes the CFString key
        // properly — null callbacks mean raw-pointer semantics and ImageIO's
        // lookup would miss.
        props.reset(s->CFDictionaryCreate(nullptr, &k, &v, 1, s->kCFTypeDictionaryKeyCallBacks, s->kCFTypeDictionaryValueCallBacks));
    }

    s->CGImageDestinationAddImage(dest.get(), img.get(), props.get());
    if (!s->CGImageDestinationFinalize(dest.get())) return CG_ENCODE_FAILED;

    out->bytes = s->CFDataGetBytePtr(sink.get());
    out->length = static_cast<size_t>(s->CFDataGetLength(sink.get()));
    out->data = sink.release();
    return CG_OK;
}

void bun_coregraphics_release(CFRef data)
{
    auto s = load();
    Pool pool(s);
    s->CFRelease(data);
}

// ── Geometry via vImage ────────────────────────────────────────────────────
//
// These take packed RGBA8 (rowBytes = w*4) on both ends so the caller can
// keep using its own allocator. The ARGB8888 kernels are
// channel-order agnostic for 4×u8, so RGBA works without a permute. They run
// on Apple's AMX units on M-series — typically 2-4× the Highway path — and we
// already have Accelerate dlopened for decode, so the only cost is four more
// dlsyms. kvImageDoNotTile: this is already a WorkPool thread, and the
// pipeline stages run back-to-back in one task, so vImage's internal
// libdispatch fan-out would oversubscribe (and dominates wall-clock for the
// tiny images the test suite uses). The scratch buffer is ours, like the
// pixels; it is about the size of the image.

int32_t bun_coregraphics_scale(const uint8_t* src, uint32_t sw, uint32_t sh,
    uint8_t* dst, uint32_t dw, uint32_t dh)
{
    auto s = load();
    if (!s) return CG_UNAVAILABLE;
    VBuf in { const_cast<uint8_t*>(src), sh, sw, static_cast<size_t>(sw) * 4 };
    VBuf out { dst, dh, dw, static_cast<size_t>(dw) * 4 };
    // Apple's default vImageScale kernel is Lanczos-3; the high-quality flag
    // widens to Lanczos-5. We only route `.lanczos3` here, so HQ stays off.
    constexpr uint32_t flags = kBunVImageEdgeExtend | kBunVImageDoNotTile;
    long scratchSize = s->vImageScale_ARGB8888(&in, &out, nullptr, flags | kBunVImageGetTempBufferSize);
    if (scratchSize < 0) return CG_UNAVAILABLE;
    std::unique_ptr<void, decltype([](void* block) { mi_free(block); })> scratch { scratchSize ? mi_malloc(static_cast<size_t>(scratchSize)) : nullptr };
    if (scratchSize && !scratch) return CG_UNAVAILABLE;
    return s->vImageScale_ARGB8888(&in, &out, scratch.get(), flags) == 0 ? CG_OK : CG_UNAVAILABLE;
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

// ── NSPasteboard image reader ──────────────────────────────────────────────
//
// `[NSPasteboard generalPasteboard]` lives in AppKit, so it's resolved through
// objc-runtime calls (`objc_getClass` / `objc_msgSend`) rather than adding
// AppKit to the dlopen list — `NSPasteboard` is the only symbol we need from
// it, and AppKit is already loaded in any GUI process. We never decode here:
// the pasteboard hands back a container (PNG, TIFF, HEIC, …) and Bun.Image's
// regular decode path handles it. NSPasteboard is documented as main-thread
// safe to *read*; we still call it on the JS thread (via the static
// `fromClipboard` accessor), not the WorkPool.
//
// `out=nullptr` only asks whether there is an image.

int32_t bun_coregraphics_clipboard(OwnedData* out)
{
    auto s = load();
    if (!s) return CG_UNAVAILABLE;
    Pool pool(s);

    CFRef pb = generalPasteboard(s);
    if (!pb) return CG_UNAVAILABLE;
    CFRef dataForType = s->sel_registerName("dataForType:");

    for (auto uti : kImageUti) {
        auto ustr = adopt(s, s->CFStringCreateWithCString(nullptr, uti, kBunCFStringEncodingUTF8));
        if (!ustr) continue;
        CFRef nsdata = msg<CFRef>(s, pb, dataForType, ustr.get());
        if (!nsdata) continue;
        long n = s->CFDataGetLength(nsdata); // NSData is toll-free bridged
        if (n <= 0) continue;
        if (!out) return CG_OK;
        out->bytes = s->CFDataGetBytePtr(nsdata);
        out->length = static_cast<size_t>(n);
        // dataForType: returns autoreleased; retain so it survives the pool drain.
        out->data = msg<CFRef>(s, nsdata, s->sel_registerName("retain"));
        return CG_OK;
    }
    return CG_NO_IMAGE;
}

// `[[NSPasteboard generalPasteboard] changeCount]` — increments on every
// pasteboard write system-wide. macOS has no clipboard-change notification, so
// the documented pattern is to poll this and act only when it moves. -1 ⇔
// AppKit unavailable (treat as "never changes").
int64_t bun_coregraphics_clipboard_change_count()
{
    auto s = load();
    if (!s) return -1;
    Pool pool(s);
    CFRef pb = generalPasteboard(s);
    return pb ? msg<long>(s, pb, s->sel_registerName("changeCount")) : -1;
}

} // extern "C"

#else
// Non-Apple: stubs so the link succeeds; callers only reference these on
// macOS so they're dead code, but LTO needs the definitions.
extern "C" int bun_coregraphics_decode(const void*, unsigned long, unsigned long long, void*, void*, void*) { return 1; }
extern "C" int bun_coregraphics_encode(const void*, unsigned, unsigned, int, int, void*) { return 1; }
extern "C" void bun_coregraphics_release(void*) {}
extern "C" int bun_coregraphics_scale(const void*, unsigned, unsigned, void*, unsigned, unsigned) { return 1; }
extern "C" int bun_coregraphics_rotate90(const void*, unsigned, unsigned, void*, unsigned) { return 1; }
extern "C" int bun_coregraphics_reflect(const void*, unsigned, unsigned, void*, int) { return 1; }
extern "C" int bun_coregraphics_clipboard(void*) { return 1; }
extern "C" long long bun_coregraphics_clipboard_change_count() { return -1; }
#endif
