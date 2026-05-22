// Per-item zstd decompression hook for ICU common data.
//
// oven-sh/WebKit's ICU build (icu/udata-decompress-hook.patch) inserts a weak
// call to bun_icu_maybe_decompress between TOC lookup and checkDataItem.
// Display-name items (curr/ lang/ region/ unit/ zone/, non-en) are stored as
// raw zstd frames; everything else keeps its 0xda27 header and passes through
// after one u32 compare. Decompressed buffers are cached for the process
// lifetime, keyed by their .rodata address.
//
// The dict symbols are emitted by the repacked libicudata.a; declaring them
// weak here lets this file link against a prebuilt that predates the repack
// (the hook is then never called, since no item is compressed).

#include "root.h"
#include "MimallocWTFMalloc.h"

#include <wtf/HashMap.h>
#include <wtf/Lock.h>
#include <wtf/NeverDestroyed.h>

#define ZSTD_STATIC_LINKING_ONLY
#include <zstd.h>

static_assert(ZSTD_MAGICNUMBER == 0xFD2FB528);
// Raw ICU items have bytes[2..3] == {0xda, 0x27} (ucmndata.h MAGIC1/MAGIC2),
// so their first u32 is 0x27da'hhhh — cannot collide with zstd's magic.

extern "C" __attribute__((weak)) const unsigned char bun_icu_zstd_dict[];
extern "C" __attribute__((weak)) const unsigned int bun_icu_zstd_dict_size;

namespace {

WTF::Lock g_lock;
ZSTD_DCtx* g_dctx WTF_GUARDED_BY_LOCK(g_lock);
ZSTD_DDict* g_ddict WTF_GUARDED_BY_LOCK(g_lock);

WTF::HashMap<const void*, void*>& cache() WTF_REQUIRES_LOCK(g_lock)
{
    static NeverDestroyed<WTF::HashMap<const void*, void*>> map;
    return map;
}

void ensureInit() WTF_REQUIRES_LOCK(g_lock)
{
    if (g_dctx) [[likely]]
        return;
    g_dctx = ZSTD_createDCtx();
    if (&bun_icu_zstd_dict_size && bun_icu_zstd_dict_size)
        g_ddict = ZSTD_createDDict_byReference(bun_icu_zstd_dict, bun_icu_zstd_dict_size);
}

} // namespace

extern "C" const void* bun_icu_maybe_decompress(const void* p, int32_t* length)
{
    if (!p)
        return p;
    uint32_t magic;
    std::memcpy(&magic, p, sizeof(magic));
    if (magic != ZSTD_MAGICNUMBER) [[likely]]
        return p;

    Locker locker { g_lock };
    ensureInit();

    if (auto it = cache().find(p); it != cache().end()) {
        auto d = ZSTD_getFrameContentSize(p, *length > 0 ? static_cast<size_t>(*length) : 64);
        if (d != ZSTD_CONTENTSIZE_UNKNOWN && d != ZSTD_CONTENTSIZE_ERROR)
            *length = static_cast<int32_t>(d);
        return it->value;
    }

    size_t bound = *length > 0 ? static_cast<size_t>(*length) : (1u << 20);
    size_t clen = ZSTD_findFrameCompressedSize(p, bound);
    if (ZSTD_isError(clen))
        return p;
    auto dlen = ZSTD_getFrameContentSize(p, clen);
    if (dlen == ZSTD_CONTENTSIZE_UNKNOWN || dlen == ZSTD_CONTENTSIZE_ERROR)
        return p;

    void* buf = Bun::MimallocMalloc::tryAlignedMalloc(static_cast<size_t>(dlen), 16);
    if (!buf)
        return p;
    size_t r = g_ddict
        ? ZSTD_decompress_usingDDict(g_dctx, buf, static_cast<size_t>(dlen), p, clen, g_ddict)
        : ZSTD_decompressDCtx(g_dctx, buf, static_cast<size_t>(dlen), p, clen);
    if (ZSTD_isError(r)) {
        Bun::MimallocMalloc::free(buf);
        return p;
    }

    cache().add(p, buf);
    *length = static_cast<int32_t>(dlen);
    return buf;
}
