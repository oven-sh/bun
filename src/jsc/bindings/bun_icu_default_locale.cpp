// ICU initializes its default locale lazily, on POSIX from LC_ALL, LC_MESSAGES
// or LANG (Bun never calls setlocale(), so libc's locale is "C" and ICU reads
// the variables directly). When that value does not canonicalize, for example
// LANG=abcdefghijkl (a language subtag of 12+ bytes) or LANG=/usr/lib/locale/en_US,
// the lazy init fails without setting anything and icu::Locale::getDefault()
// returns a null reference. The first ucal_open / ucol_open (Date#toString,
// localeCompare, any Intl constructor) then crashes inside ICU.
//
// Run the same canonicalization up front and, only when it fails, set the
// default to the locale Bun reports anyway. A value ICU accepts is left for
// ICU to read itself, so its behavior is unchanged.

#include "root.h"

#if !OS(WINDOWS)

#include <cstdlib>
#include <initializer_list>
#include <unicode/utypes.h>

// Apple's SDK has no <unicode/uloc.h>; utypes.h supplies U_CAPI + renaming.
U_CAPI int32_t U_EXPORT2 uloc_canonicalize(const char* localeID, char* name, int32_t nameCapacity, UErrorCode* err);
U_CAPI void U_EXPORT2 uloc_setDefault(const char* localeID, UErrorCode* status);

extern "C" void Bun__ensureICUDefaultLocale()
{
    const char* localeID = nullptr;
    for (const char* name : { "LC_ALL", "LC_MESSAGES", "LANG" }) {
        localeID = getenv(name);
        if (localeID)
            break;
    }
    if (!localeID)
        return;

    // Only the status matters. A valid id that does not fit (U_BUFFER_OVERFLOW_ERROR)
    // is pinned too, which is harmless.
    char canonical[256];
    UErrorCode status = U_ZERO_ERROR;
    uloc_canonicalize(localeID, canonical, sizeof(canonical), &status);
    if (U_SUCCESS(status))
        return;

    status = U_ZERO_ERROR;
    uloc_setDefault("en_US", &status);
    RELEASE_ASSERT(U_SUCCESS(status));
}

#else

// ICU derives its default from the user locale of the system here, not from
// environment variables.
extern "C" void Bun__ensureICUDefaultLocale()
{
}

#endif
