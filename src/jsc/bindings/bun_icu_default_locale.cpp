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

extern "C" void Bun__ensureICUDefaultLocale()
{
    UErrorCode status = U_ZERO_ERROR;
    uloc_setDefault("en_US", &status);
    uloc_setDefault(nullptr, &status);
}
