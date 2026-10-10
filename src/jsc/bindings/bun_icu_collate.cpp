// `String.prototype.localeCompare` and `Intl.Collator` for Rust: ICU's collator for English, which is CLDR's root collation,
// with the attributes that IntlCollator.cpp sets.

#include "root.h"

#include <unicode/ucol.h>

namespace Bun {
namespace ICUCollate {

static const UCollator* open(bool isNumericAndBase)
{
    UErrorCode status = U_ZERO_ERROR;
    UCollator* collator = ucol_open("en", &status);
    RELEASE_ASSERT(U_SUCCESS(status));
    if (isNumericAndBase) {
        ucol_setAttribute(collator, UCOL_STRENGTH, UCOL_PRIMARY, &status);
        ucol_setAttribute(collator, UCOL_NUMERIC_COLLATION, UCOL_ON, &status);
    }
    // Texts that are canonically equivalent are equal.
    ucol_setAttribute(collator, UCOL_NORMALIZATION_MODE, UCOL_ON, &status);
    RELEASE_ASSERT(U_SUCCESS(status));
    return collator;
}

// Each is opened at its first use (150 us for the first) and never closed. Many threads may compare with one collator at once.
static const UCollator* get(bool isNumericAndBase)
{
    if (isNumericAndBase) {
        static const UCollator* const collator = open(true);
        return collator;
    }
    static const UCollator* const collator = open(false);
    return collator;
}

} // namespace ICUCollate
} // namespace Bun

/// Less than, equal to or greater than 0. What is not UTF-8 counts as U+FFFD.
extern "C" [[ZIG_EXPORT(nothrow)]] int32_t Bun__collateUTF8(bool isNumericAndBase, const char* a, size_t aLength, const char* b, size_t bLength)
{
    UErrorCode status = U_ZERO_ERROR;
    return ucol_strcollUTF8(Bun::ICUCollate::get(isNumericAndBase), a, static_cast<int32_t>(aLength), b, static_cast<int32_t>(bLength), &status);
}

/// The same for UTF-16, in which half of a surrogate pair is what JavaScript compares.
extern "C" [[ZIG_EXPORT(nothrow)]] int32_t Bun__collateUTF16(bool isNumericAndBase, const uint16_t* a, size_t aLength, const uint16_t* b, size_t bLength)
{
    return ucol_strcoll(Bun::ICUCollate::get(isNumericAndBase), reinterpret_cast<const UChar*>(a), static_cast<int32_t>(aLength), reinterpret_cast<const UChar*>(b), static_cast<int32_t>(bLength));
}
