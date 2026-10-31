// ICU derives its default locale lazily (on POSIX from LC_ALL / LC_MESSAGES /
// LANG). When that value does not parse, for example LANG=abcdefghijkl or a
// modifier too long to become a variant, the derivation leaves the default
// unset and icu::Locale::getDefault() returns a null reference, so the first
// ucal_open / ucol_open (Date#toString, localeCompare, any Intl constructor)
// crashes inside ICU.
//
// Set the default to en_US, the locale Bun reports anyway, then let ICU derive
// it from the environment as it would have done lazily. A failed derivation
// keeps the previous default, so the environment is only ever parsed by ICU's
// own code and a value it accepts behaves exactly as before.

#include "root.h"

#include <unicode/utypes.h>

// Apple's SDK has no <unicode/uloc.h>; utypes.h supplies U_CAPI + renaming.
U_CAPI void U_EXPORT2 uloc_setDefault(const char* localeID, UErrorCode* status);

// The platforms on which `--trim` removes locale data: see bun_icu_decompress.cpp.
#if OS(LINUX) || OS(WINDOWS)

#include <cstring>
#include <string_view>

U_CAPI const char* U_EXPORT2 uloc_getDefault(void);
extern "C" const unsigned char U_ICUDATA_ENTRY_POINT[];

// `--trim` leaves 16 bytes in the place of the items of a language that the program does not name, and whoever opens one ends the process.
static bool isBundleOfLocaleRemoved(std::string_view locale)
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
    auto findItem = [&](std::string_view stem) -> const unsigned char* {
        char name[192];
        constexpr std::string_view prefix = U_ICUDATA_NAME "/";
        constexpr std::string_view suffix = ".res";
        if (prefix.size() + stem.size() + suffix.size() >= sizeof(name))
            return nullptr;
        char* end = name;
        for (std::string_view part : { prefix, stem, suffix }) {
            std::memcpy(end, part.data(), part.size());
            end += part.size();
        }
        *end = 0;
        uint32_t low = 0;
        uint32_t high = wordAt(0);
        while (low < high) {
            uint32_t middle = low + (high - low) / 2;
            int order = std::strcmp(name, reinterpret_cast<const char*>(contents + wordAt(4 + 8 * middle)));
            if (!order)
                return contents + wordAt(8 + 8 * middle);
            if (order < 0)
                high = middle;
            else
                low = middle + 1;
        }
        return nullptr;
    };

    locale = locale.substr(0, locale.find('@'));
    while (!locale.empty()) {
        if (const unsigned char* item = findItem(locale))
            return !std::memcmp(item, "BUNICUREMOVED\0\0\0", 16);
        size_t underscore = locale.rfind('_');
        locale = locale.substr(0, underscore == std::string_view::npos ? 0 : underscore);
    }
    return false;
}

#endif

extern "C" void Bun__ensureICUDefaultLocale()
{
    UErrorCode status = U_ZERO_ERROR;
    uloc_setDefault("en_US", &status);
    uloc_setDefault(nullptr, &status);
#if OS(LINUX) || OS(WINDOWS)
    // en and en_US are never removed.
    if (isBundleOfLocaleRemoved(uloc_getDefault())) [[unlikely]]
        uloc_setDefault("en_US", &status);
#endif
}
