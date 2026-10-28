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

static constexpr uint32_t ZSTD_MAGICNUMBER = 0xFD2FB528;
// Raw ICU items have bytes[2..3] == {0xda, 0x27} (ucmndata.h MAGIC1/MAGIC2),
// so their first u32 is 0x27da'hhhh — cannot collide with zstd's magic.

extern "C" __attribute__((weak)) const unsigned char bun_icu_zstd_dict[];
extern "C" __attribute__((weak)) const unsigned int bun_icu_zstd_dict_size;

// src/runtime/icu_decompress.rs
struct IcuDecompressor;
extern "C" IcuDecompressor* Bun__IcuDecompressor__create(const unsigned char* dict, size_t dictSize);
extern "C" bool Bun__IcuDecompressor__frameSizes(const void* src, size_t bound, size_t* compressedSize, uint64_t* contentSize);
extern "C" bool Bun__IcuDecompressor__decompress(IcuDecompressor*, void* dst, size_t dstSize, const void* src, size_t srcSize);

namespace Bun {

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
            *length = it->value.second;
            return it->value.first;
        }

        size_t clen;
        uint64_t dlen;
        if (!Bun__IcuDecompressor__frameSizes(p, frameBound(*length), &clen, &dlen))
            return p;

        // tryAlignedMalloc asserts size is a multiple of alignment in debug
        // builds; ICU item sizes are only 4-aligned, so round up.
        size_t alloc = WTF::roundUpToMultipleOf<16>(static_cast<size_t>(dlen));
        void* buf = MimallocMalloc::tryAlignedMalloc(alloc, 16);
        if (!buf)
            return p;
        // The decoder takes initialized memory.
        std::memset(buf, 0, alloc);
        if (!Bun__IcuDecompressor__decompress(m_decompressor, buf, static_cast<size_t>(dlen), p, clen)) {
            MimallocMalloc::free(buf);
            return p;
        }

        *length = static_cast<int32_t>(dlen);
        m_cache.add(p, std::pair { buf, *length });
        return buf;
    }

private:
    ICUDecompressor()
        : m_decompressor(&bun_icu_zstd_dict_size && bun_icu_zstd_dict_size
                  ? Bun__IcuDecompressor__create(bun_icu_zstd_dict, bun_icu_zstd_dict_size)
                  : Bun__IcuDecompressor__create(nullptr, 0))
    {
    }

    static size_t frameBound(int32_t tocLength) { return tocLength > 0 ? static_cast<size_t>(tocLength) : (1u << 20); }

    friend class WTF::LazyNeverDestroyed<ICUDecompressor>;

    WTF::Lock m_lock;
    WTF::HashMap<const void*, std::pair<void*, int32_t>> m_cache WTF_GUARDED_BY_LOCK(m_lock);
    IcuDecompressor* const m_decompressor;
};

} // namespace Bun

extern "C" const void* bun_icu_maybe_decompress(const void* p, int32_t* length)
{
    if (!p)
        return p;
    uint32_t magic;
    std::memcpy(&magic, p, sizeof(magic));
    // "BUNI": the 16 bytes `--trim` leaves where it removed a language's items.
    if (magic == 0x494E5542u && !std::memcmp(p, "BUNICUREMOVED\0\0\0", 16)) [[unlikely]]
        Bun__abortForRemovedLocaleData();
    if (magic != ZSTD_MAGICNUMBER) [[likely]]
        return p;
    return Bun::ICUDecompressor::get().decompress(p, length);
}

#endif // OS(LINUX)
