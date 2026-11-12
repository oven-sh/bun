// ICU's default locale is never the host's: JS can see it (#48695), and a host value that ICU cannot parse crashes ICU (#39704).

#include "root.h"

#include <mutex>
#include <unicode/utypes.h>

// Apple's SDK has no <unicode/uloc.h>; utypes.h supplies U_CAPI + renaming.
U_CAPI void U_EXPORT2 uloc_setDefault(const char* localeID, UErrorCode* status);

// The platforms on which `--trim` removes locale data: see bun_icu_decompress.cpp.
#if OS(LINUX) || OS(WINDOWS) || OS(FREEBSD)

#include <cstring>

extern "C" const unsigned char U_ICUDATA_ENTRY_POINT[];

// `--trim` leaves 16 bytes in the place of the items of a language that the program does not name, and whoever opens one ends the process.
static bool isItemRemovedByTrim(const char* name)
{
    const unsigned char* package = U_ICUDATA_ENTRY_POINT;
    uint16_t headerSize;
    std::memcpy(&headerSize, package, sizeof(headerSize));
    const unsigned char* contents = package + headerSize;
    auto wordAt = [&](size_t offset) {
        uint32_t word;
        std::memcpy(&word, contents + offset, sizeof(word));
        return word;
    };
    uint32_t low = 0;
    uint32_t high = wordAt(0);
    while (low < high) {
        uint32_t middle = low + (high - low) / 2;
        int order = std::strcmp(name, reinterpret_cast<const char*>(contents + wordAt(4 + 8 * middle)));
        if (!order)
            return !std::memcmp(contents + wordAt(8 + 8 * middle), "BUNICUREMOVED\0\0\0", 16);
        if (order < 0)
            high = middle;
        else
            low = middle + 1;
    }
    return true;
}

#endif

extern "C" void Bun__ensureICUDefaultLocale()
{
    static std::once_flag once;
    std::call_once(once, [] {
        UErrorCode status = U_ZERO_ERROR;
#if OS(LINUX) || OS(WINDOWS) || OS(FREEBSD)
        // ICU opens curr/<default locale>.res for dates in other locales. No item of the root locale is removed by language.
        if (isItemRemovedByTrim(U_ICUDATA_NAME "/curr/en.res")) [[unlikely]] {
            uloc_setDefault("", &status);
            return;
        }
#endif
        uloc_setDefault("en_US", &status);
    });
}
