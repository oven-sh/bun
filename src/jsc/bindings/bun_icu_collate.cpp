// `String.prototype.localeCompare` and `Intl.Collator` for Rust: ICU's collator for English, which is CLDR's root collation,
// with the attributes that IntlCollator.cpp sets.

#include "root.h"

#if __has_include(<unicode/ucol.h>)
#include <unicode/ucol.h>
#else
// macOS: libicucore has these, under these names, and the SDK has no header for them.
#include <unicode/utypes.h>
extern "C" {
typedef struct UCollator UCollator;
typedef enum { UCOL_NORMALIZATION_MODE = 4, UCOL_STRENGTH = 5, UCOL_NUMERIC_COLLATION = 7 } UColAttribute;
typedef enum { UCOL_PRIMARY = 0, UCOL_ON = 17 } UColAttributeValue;
typedef enum { UCOL_LESS = -1, UCOL_EQUAL = 0, UCOL_GREATER = 1 } UCollationResult;
UCollator* ucol_open(const char* loc, UErrorCode* status);
void ucol_setAttribute(UCollator* coll, UColAttribute attr, UColAttributeValue value, UErrorCode* status);
UCollationResult ucol_strcoll(const UCollator* coll, const UChar* source, int32_t sourceLength, const UChar* target, int32_t targetLength);
UCollationResult ucol_strcollUTF8(const UCollator* coll, const char* source, int32_t sourceLength, const char* target, int32_t targetLength, UErrorCode* status);
}
#endif

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
