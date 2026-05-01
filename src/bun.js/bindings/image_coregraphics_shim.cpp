// CoreGraphics / ImageIO backend for Bun.Image — implemented entirely in C++.
//
// Calling dlsym'd CG/ImageIO functions through Zig function pointers crashed
// on x86_64 macOS (arm64 was fine). The first failure was the by-value 32-byte
// CGRect to CGContextDrawImage (SysV passes it MEMORY-class; arm64 passes it
// as a 4-double HFA). Thunking that one call moved the crash from a garbage
// address into a real ImageIO frame, so at least one MORE call was wrong —
// and bisecting via CI is slow. Instead of thunking call-by-call, this file
// owns every framework call: clang generates the SysV/AAPCS64 prologues
// natively, and the Zig boundary is two extern-C entry points with only
// scalar/pointer args.
//
// Symbol resolution stays lazy (dlsym), so the binary still has no
// CoreGraphics/ImageIO load command.

#if defined(__APPLE__)

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <dlfcn.h>

namespace {

using CFRef = void*;
struct CGRect {
    double x, y, w, h;
};

// One field per dlsym; declared as a struct so the loader is a 5-line for-each
// over an offset/name table. Ordering doesn't matter.
struct Syms {
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
    CFRef (*CGBitmapContextCreate)(void*, size_t, size_t, size_t, size_t, CFRef, uint32_t);
    CFRef (*CGBitmapContextCreateImage)(CFRef);
    void (*CGContextDrawImage)(CFRef, CGRect, CFRef);
    void (*CGContextRelease)(CFRef);
    size_t (*CGImageGetWidth)(CFRef);
    size_t (*CGImageGetHeight)(CFRef);
    void (*CGImageRelease)(CFRef);
    // ImageIO
    CFRef (*CGImageSourceCreateWithData)(CFRef, CFRef);
    CFRef (*CGImageSourceCreateImageAtIndex)(CFRef, size_t, CFRef);
    CFRef (*CGImageDestinationCreateWithData)(CFRef, CFRef, size_t, CFRef);
    void (*CGImageDestinationAddImage)(CFRef, CFRef, CFRef);
    bool (*CGImageDestinationFinalize)(CFRef);
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
    SYM(CGBitmapContextCreate),
    SYM(CGBitmapContextCreateImage),
    SYM(CGContextDrawImage),
    SYM(CGContextRelease),
    SYM(CGImageGetWidth),
    SYM(CGImageGetHeight),
    SYM(CGImageRelease),
    SYM(CGImageSourceCreateWithData),
    SYM(CGImageSourceCreateImageAtIndex),
    SYM(CGImageDestinationCreateWithData),
    SYM(CGImageDestinationAddImage),
    SYM(CGImageDestinationFinalize),
    SYM(kCFAllocatorNull),
    SYM(kCGImageDestinationLossyCompressionQuality),
    SYM(kCFTypeDictionaryKeyCallBacks),
    SYM(kCFTypeDictionaryValueCallBacks),
};
#undef SYM

Syms g {};
int g_state = 0; // 0=unloaded, 1=ok, -1=unavailable

const Syms* load()
{
    if (__builtin_expect(g_state, 1) != 0) return g_state > 0 ? &g : nullptr;
    void* cf = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", RTLD_NOW);
    void* cg = dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", RTLD_NOW);
    void* io = dlopen("/System/Library/Frameworks/ImageIO.framework/ImageIO", RTLD_NOW);
    if (!cf || !cg || !io) {
        g_state = -1;
        return nullptr;
    }
    auto base = reinterpret_cast<char*>(&g);
    for (auto& f : kFields) {
        void* p = dlsym(io, f.name);
        if (!p) p = dlsym(cg, f.name);
        if (!p) p = dlsym(cf, f.name);
        if (!p) {
            g_state = -1;
            return nullptr;
        }
        *reinterpret_cast<void**>(base + f.off) = p;
    }
    g_state = 1;
    return &g;
}

constexpr uint32_t kCGImageAlphaPremultipliedLast = 1;
constexpr uint32_t kCFStringEncodingUTF8 = 0x08000100;
constexpr int kCFNumberDoubleType = 13;

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

    CFRef data = s->CFDataCreateWithBytesNoCopy(nullptr, bytes, static_cast<long>(len), *s->kCFAllocatorNull);
    if (!data) return CG_DECODE_FAILED;
    struct R {
        const Syms* s;
        CFRef d, src, img, cs, ctx;
        ~R()
        {
            if (ctx) s->CGContextRelease(ctx);
            if (cs) s->CGColorSpaceRelease(cs);
            if (img) s->CGImageRelease(img);
            if (src) s->CFRelease(src);
            if (d) s->CFRelease(d);
        }
    } r { s, data, nullptr, nullptr, nullptr, nullptr };

    r.src = s->CGImageSourceCreateWithData(data, nullptr);
    if (!r.src) return CG_DECODE_FAILED;
    r.img = s->CGImageSourceCreateImageAtIndex(r.src, 0, nullptr);
    if (!r.img) return CG_DECODE_FAILED;

    size_t w = s->CGImageGetWidth(r.img);
    size_t h = s->CGImageGetHeight(r.img);
    if (w == 0 || h == 0) return CG_DECODE_FAILED;
    if (static_cast<uint64_t>(w) * h > max_pixels) return CG_TOO_MANY_PIXELS;
    *out_w = static_cast<uint32_t>(w);
    *out_h = static_cast<uint32_t>(h);
    if (!out) return CG_OK; // dimensions-only probe

    r.cs = s->CGColorSpaceCreateDeviceRGB();
    if (!r.cs) return CG_UNAVAILABLE;
    // CG bitmap contexts won't render to non-premultiplied; draw premultiplied
    // and undo it below so the rest of the pipeline sees straight alpha.
    r.ctx = s->CGBitmapContextCreate(out, w, h, 8, w * 4, r.cs, kCGImageAlphaPremultipliedLast);
    if (!r.ctx) return CG_DECODE_FAILED;
    s->CGContextDrawImage(r.ctx, CGRect { 0, 0, static_cast<double>(w), static_cast<double>(h) }, r.img);

    for (size_t i = 0, n = w * h * 4; i + 4 <= n; i += 4) {
        uint32_t a = out[i + 3];
        if (a != 0 && a != 255) {
            for (int c = 0; c < 3; c++) {
                uint32_t v = (static_cast<uint32_t>(out[i + c]) * 255 + a / 2) / a;
                out[i + c] = static_cast<uint8_t>(v < 255 ? v : 255);
            }
        }
    }
    return CG_OK;
}

// Encode RGBA8 → format. format: 0=jpeg, 1=png, 2=webp. Quality 1-100.
// Two-phase like decode: pass `out=nullptr` to get the encoded size into
// `*out_len`; the encoded bytes are held in a static-thread-local CFData
// until the next call so the second call can copy them out without
// re-encoding. (One encode, one memcpy — same allocation count as the static
// codecs after the recent Encoded refactor.)
int32_t bun_coregraphics_encode(const uint8_t* rgba, uint32_t width, uint32_t height,
    int32_t format, int32_t quality, uint8_t* out, size_t* out_len)
{
    auto s = load();
    if (!s) return CG_UNAVAILABLE;
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

    // Features ImageIO can't match the static codecs on — let the caller fall
    // through. (Palette PNG and lossless WebP are handled in Zig.)
    static const char* kUti[] = {
        "public.jpeg", "public.png", "org.webmproject.webp",
        "public.heic", "public.avif"
    };
    if (static_cast<unsigned>(format) >= sizeof(kUti) / sizeof(kUti[0])) return CG_UNAVAILABLE;
    const char* uti = kUti[format];

    struct R {
        const Syms* s;
        CFRef cs, ctx, img, ustr, sink, dest, num, props;
        uint8_t* premul;
        ~R()
        {
            if (props) s->CFRelease(props);
            if (num) s->CFRelease(num);
            if (dest) s->CFRelease(dest);
            // sink is NOT released here on success — it becomes `pending`.
            if (ustr) s->CFRelease(ustr);
            if (img) s->CGImageRelease(img);
            if (ctx) s->CGContextRelease(ctx);
            if (cs) s->CGColorSpaceRelease(cs);
            delete[] premul;
        }
    } r {};
    r.s = s;

    r.cs = s->CGColorSpaceCreateDeviceRGB();
    if (!r.cs) return CG_UNAVAILABLE;

    // Pipeline carries straight alpha; CG bitmap contexts only accept
    // premultiplied. Pre-multiply into a scratch buffer so ImageIO writes the
    // right thing.
    size_t n = static_cast<size_t>(width) * height * 4;
    r.premul = new (std::nothrow) uint8_t[n];
    if (!r.premul) return CG_UNAVAILABLE;
    for (size_t i = 0; i + 4 <= n; i += 4) {
        uint32_t a = rgba[i + 3];
        for (int c = 0; c < 3; c++)
            r.premul[i + c] = static_cast<uint8_t>((static_cast<uint32_t>(rgba[i + c]) * a + 127) / 255);
        r.premul[i + 3] = static_cast<uint8_t>(a);
    }

    r.ctx = s->CGBitmapContextCreate(r.premul, width, height, 8, static_cast<size_t>(width) * 4, r.cs, kCGImageAlphaPremultipliedLast);
    if (!r.ctx) return CG_ENCODE_FAILED;
    r.img = s->CGBitmapContextCreateImage(r.ctx);
    if (!r.img) return CG_ENCODE_FAILED;

    r.ustr = s->CFStringCreateWithCString(nullptr, uti, kCFStringEncodingUTF8);
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
        r.num = s->CFNumberCreate(nullptr, kCFNumberDoubleType, &q);
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

} // extern "C"

#else
// Non-Apple: stubs so the link succeeds; Zig only references these under
// Environment.isMac so they're dead code, but LTO needs the definitions.
extern "C" int bun_coregraphics_decode(const void*, unsigned long, unsigned long long, void*, void*, void*) { return 1; }
extern "C" int bun_coregraphics_encode(const void*, unsigned, unsigned, int, int, void*, void*) { return 1; }
#endif
