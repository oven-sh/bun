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

// The repacked ICU data archive (and the patched udata.cpp that calls this
// hook) are produced by oven-sh/WebKit's Dockerfile / Dockerfile.musl /
// Dockerfile.windows. On macOS ICU is the unmodified system one, so there is
// nothing to decompress and the weak externs below would have no definer —
// gate the implementation to the platforms whose prebuilts carry compressed
// items.
//
// Windows note: COFF has no true weak-undefined symbols — clang lowers each
// declaration to a per-TU weak external with an absolute-0 default, which is
// fine here because this is the only TU referencing the dict symbols and the
// repacked sicudt.lib defines them anyway (an unresolved weak external only
// becomes a problem when two TUs reference it, see the WTFTimer__* notes in
// oven-sh/WebKit).
#if OS(LINUX) || OS(WINDOWS)

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

namespace Bun {

// Replacement uts46.nrm carrying the Unicode 16.0 IdnaMappingTable (UTS #46
// rev. 33) in Nrm2 format version 4, readable by the ICU 73/75 the prebuilts
// bundle. Regenerate via scripts/regenerate-uts46-override.sh.
alignas(16) static constexpr uint8_t s_uts46Override[] = {
#embed "icu_uts46_override.nrm"
};

// The bundled prebuilts' uts46.nrm predates Unicode 16.0, which reclassified
// U+04C0, U+10A0..10C5, U+2132, U+2183 et al. from "disallowed" to "mapped".
// Match by 48-byte prefix (DataHeader + first four Nrm2 indexes, unique per *.nrm).
static const void* maybeOverrideUTS46(const void* p, int32_t* length)
{
    // clang-format off
    static constexpr uint8_t kUTS46Prefix75[48] = {
        0x20, 0x00, 0xda, 0x27, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x4e, 0x72, 0x6d, 0x32,
        0x04, 0x00, 0x00, 0x00, 0x0f, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x50, 0x00, 0x00, 0x00, 0xc0, 0x93, 0x00, 0x00, 0x8c, 0xe8, 0x00, 0x00, 0x8c, 0xe9, 0x00, 0x00,
    };
    static constexpr uint8_t kUTS46Prefix73[48] = {
        0x20, 0x00, 0xda, 0x27, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x4e, 0x72, 0x6d, 0x32,
        0x04, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x50, 0x00, 0x00, 0x00, 0x84, 0x93, 0x00, 0x00, 0x4c, 0xe8, 0x00, 0x00, 0x4c, 0xe9, 0x00, 0x00,
    };
    // clang-format on
    static_assert(s_uts46Override[12] == 'N' && s_uts46Override[13] == 'r' && s_uts46Override[16] == 4,
        "icu_uts46_override.nrm must be Nrm2 format version 4");

    if (*length >= static_cast<int32_t>(sizeof(kUTS46Prefix75))
        && (std::memcmp(p, kUTS46Prefix75, sizeof(kUTS46Prefix75)) == 0
            || std::memcmp(p, kUTS46Prefix73, sizeof(kUTS46Prefix73)) == 0)) {
        *length = static_cast<int32_t>(sizeof(s_uts46Override));
        return s_uts46Override;
    }
    return p;
}

class ICUDecompressor {
public:
    static ICUDecompressor& get()
    {
        static LazyNeverDestroyed<ICUDecompressor> instance;
        static std::once_flag once;
        std::call_once(once, [] { instance.construct(); });
        return instance.get();
    }

    const void* decompress(const void* p, int32_t* length)
    {
        Locker locker { m_lock };

        if (auto it = m_cache.find(p); it != m_cache.end()) {
            *length = static_cast<int32_t>(ZSTD_getFrameContentSize(p, frameBound(*length)));
            return it->value;
        }

        size_t clen = ZSTD_findFrameCompressedSize(p, frameBound(*length));
        if (ZSTD_isError(clen))
            return p;
        auto dlen = ZSTD_getFrameContentSize(p, clen);
        if (dlen == ZSTD_CONTENTSIZE_UNKNOWN || dlen == ZSTD_CONTENTSIZE_ERROR)
            return p;

        // tryAlignedMalloc asserts size is a multiple of alignment in debug
        // builds; ICU item sizes are only 4-aligned, so round up.
        size_t alloc = WTF::roundUpToMultipleOf<16>(static_cast<size_t>(dlen));
        void* buf = MimallocMalloc::tryAlignedMalloc(alloc, 16);
        if (!buf)
            return p;
        size_t r = m_ddict
            ? ZSTD_decompress_usingDDict(m_dctx, buf, static_cast<size_t>(dlen), p, clen, m_ddict)
            : ZSTD_decompressDCtx(m_dctx, buf, static_cast<size_t>(dlen), p, clen);
        if (ZSTD_isError(r)) {
            MimallocMalloc::free(buf);
            return p;
        }

        m_cache.add(p, buf);
        *length = static_cast<int32_t>(dlen);
        return buf;
    }

private:
    ICUDecompressor()
        : m_dctx(ZSTD_createDCtx())
        , m_ddict(&bun_icu_zstd_dict_size && bun_icu_zstd_dict_size
                  ? ZSTD_createDDict_byReference(bun_icu_zstd_dict, bun_icu_zstd_dict_size)
                  : nullptr)
    {
    }

    static size_t frameBound(int32_t tocLength) { return tocLength > 0 ? static_cast<size_t>(tocLength) : (1u << 20); }

    friend class WTF::LazyNeverDestroyed<ICUDecompressor>;

    WTF::Lock m_lock;
    WTF::HashMap<const void*, void*> m_cache WTF_GUARDED_BY_LOCK(m_lock);
    ZSTD_DCtx* const m_dctx;
    ZSTD_DDict* const m_ddict;
};

} // namespace Bun

extern "C" const void* bun_icu_maybe_decompress(const void* p, int32_t* length)
{
    if (!p)
        return p;
    uint32_t magic;
    std::memcpy(&magic, p, sizeof(magic));
    if (magic != ZSTD_MAGICNUMBER) [[likely]]
        return Bun::maybeOverrideUTS46(p, length);
    return Bun::ICUDecompressor::get().decompress(p, length);
}

#endif // OS(LINUX)
