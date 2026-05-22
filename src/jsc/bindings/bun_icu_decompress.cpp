// Per-item zstd decompression hook for ICU common data.
//
// oven-sh/WebKit's ICU build (see icu/udata-decompress-hook.patch) inserts a
// weak call to bun_icu_maybe_decompress between TOC lookup and checkDataItem.
// Display-name items (curr/ lang/ region/ unit/ zone/, non-en) are stored as
// raw zstd frames; everything else keeps its 0xda27 header and passes through
// untouched in two byte-compares. Decompressed buffers are cached for the
// process lifetime, keyed by their .rodata address.
//
// The dict symbols are emitted by the repacked libicudata.a; declaring them
// weak here lets this file link against a prebuilt that predates the repack
// (the hook is then never called, since no item is compressed).

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <unordered_map>

#define ZSTD_STATIC_LINKING_ONLY
#include <zstd.h>

static_assert(ZSTD_MAGICNUMBER == 0xFD2FB528);
// Raw ICU items have bytes[2..3] == {0xda, 0x27} (ucmndata.h MAGIC1/MAGIC2),
// so their first u32 is 0x27da'hhhh — cannot collide with zstd's magic.

extern "C" __attribute__((weak)) const unsigned char bun_icu_zstd_dict[];
extern "C" __attribute__((weak)) const unsigned int bun_icu_zstd_dict_size;

namespace {
std::mutex g_mutex;
std::unordered_map<const void*, void*>* g_cache;
ZSTD_DCtx* g_dctx;
ZSTD_DDict* g_ddict;

void ensureInit()
{
    if (g_dctx) return;
    g_cache = new std::unordered_map<const void*, void*>();
    g_cache->reserve(128);
    g_dctx = ZSTD_createDCtx();
    if (&bun_icu_zstd_dict_size && bun_icu_zstd_dict_size)
        g_ddict = ZSTD_createDDict_byReference(bun_icu_zstd_dict, bun_icu_zstd_dict_size);
}
} // namespace

extern "C" const void* bun_icu_maybe_decompress(const void* p, int32_t* length)
{
    if (!p) return p;
    uint32_t magic;
    std::memcpy(&magic, p, sizeof(magic));
    if (magic != ZSTD_MAGICNUMBER) return p;

    std::lock_guard<std::mutex> lock(g_mutex);
    ensureInit();
    if (auto it = g_cache->find(p); it != g_cache->end()) {
        unsigned long long d = ZSTD_getFrameContentSize(p, *length > 0 ? (size_t)*length : 64);
        if (d != ZSTD_CONTENTSIZE_UNKNOWN && d != ZSTD_CONTENTSIZE_ERROR) *length = (int32_t)d;
        return it->second;
    }

    size_t bound = *length > 0 ? (size_t)*length : (size_t)1 << 20;
    size_t clen = ZSTD_findFrameCompressedSize(p, bound);
    if (ZSTD_isError(clen)) return p;
    unsigned long long dlen = ZSTD_getFrameContentSize(p, clen);
    if (dlen == ZSTD_CONTENTSIZE_UNKNOWN || dlen == ZSTD_CONTENTSIZE_ERROR) return p;

    void* buf = nullptr;
    if (posix_memalign(&buf, 16, (size_t)dlen) != 0) return p;
    size_t r = g_ddict
        ? ZSTD_decompress_usingDDict(g_dctx, buf, (size_t)dlen, p, clen, g_ddict)
        : ZSTD_decompressDCtx(g_dctx, buf, (size_t)dlen, p, clen);
    if (ZSTD_isError(r)) {
        free(buf);
        return p;
    }

    (*g_cache)[p] = buf;
    *length = (int32_t)dlen;
    return buf;
}
