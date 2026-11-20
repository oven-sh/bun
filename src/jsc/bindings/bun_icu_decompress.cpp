// Per-item zstd decompression hook for ICU common data.
//
// oven-sh/WebKit's ICU build (icu/udata-decompress-hook.patch) inserts a weak
// call to bun_icu_maybe_decompress between TOC lookup and checkDataItem.
// Display-name items (curr/ lang/ region/ unit/ zone/, non-en) are stored as
// raw zstd frames; everything else keeps its 0xda27 header and passes through
// after one u32 compare. Decompressed buffers are cached for the process
// lifetime, keyed by their .rodata address.

#include "root.h"

// The repacked ICU data archive (and the patched udata.cpp that calls this
// hook) are produced by oven-sh/WebKit's Dockerfile / Dockerfile.musl /
// Dockerfile.windows / Dockerfile.freebsd / Dockerfile.android. On macOS ICU is the unmodified system one, so there is
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
#if OS(LINUX) || OS(WINDOWS) || OS(FREEBSD)

#include "MimallocWTFMalloc.h"

#include <wtf/HashMap.h>
#include <wtf/Lock.h>
#include <wtf/NeverDestroyed.h>

#include "../../icu_data/icu_data.h"

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

        int32_t size = Bun__ICUItem__size(p, *length);
        if (size < 0)
            return p;

        if (auto it = m_cache.find(p); it != m_cache.end()) {
            *length = size;
            return it->value;
        }

        // tryAlignedMalloc asserts size is a multiple of alignment in debug
        // builds; ICU item sizes are only 4-aligned, so round up.
        size_t alloc = WTF::roundUpToMultipleOf<16>(static_cast<size_t>(size));
        std::unique_ptr<void, decltype([](void* block) { MimallocMalloc::free(block); })> buf { MimallocMalloc::tryAlignedMalloc(alloc, 16) };
        if (!buf || !decompressICUItem(m_dictionary, p, *length, buf.get(), size))
            return p;

        m_cache.add(p, buf.get());
        *length = size;
        return buf.release();
    }

private:
    ICUDecompressor() = default;

    friend class WTF::LazyNeverDestroyed<ICUDecompressor>;

    WTF::Lock m_lock;
    WTF::HashMap<const void*, void*> m_cache WTF_GUARDED_BY_LOCK(m_lock);
    ICUDictionary* m_dictionary WTF_GUARDED_BY_LOCK(m_lock) { nullptr };
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
    if (!Bun::isCompressedICUItem(p)) [[likely]]
        return p;
    return Bun::ICUDecompressor::get().decompress(p, length);
}

#endif // OS(LINUX) || OS(WINDOWS) || OS(FREEBSD)
