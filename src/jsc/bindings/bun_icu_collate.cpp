// `String.prototype.localeCompare` and `Intl.Collator` for Rust: ICU's collator for English, which is CLDR's root collation,
// with the attributes that IntlCollator.cpp sets, and one per BCP 47 language tag for `localeCompare(b, locale)`.

#include "root.h"

#include <mutex>
#include <string>
#include <unordered_map>

#if __has_include(<unicode/ucol.h>)
#include <unicode/ucol.h>
#include <unicode/uloc.h>
#else
// macOS: libicucore has these, under these names, and the SDK has no header for them.
#include <unicode/utypes.h>
extern "C" {
typedef struct UCollator UCollator;
typedef enum { UCOL_NORMALIZATION_MODE = 4,
    UCOL_STRENGTH = 5,
    UCOL_NUMERIC_COLLATION = 7 } UColAttribute;
typedef enum { UCOL_PRIMARY = 0,
    UCOL_ON = 17 } UColAttributeValue;
typedef enum { UCOL_LESS = -1,
    UCOL_EQUAL = 0,
    UCOL_GREATER = 1 } UCollationResult;
#define ULOC_FULLNAME_CAPACITY 157
UCollator* ucol_open(const char* loc, UErrorCode* status);
void ucol_close(UCollator* coll);
void ucol_setAttribute(UCollator* coll, UColAttribute attr, UColAttributeValue value, UErrorCode* status);
UCollationResult ucol_strcoll(const UCollator* coll, const UChar* source, int32_t sourceLength, const UChar* target, int32_t targetLength);
UCollationResult ucol_strcollUTF8(const UCollator* coll, const char* source, int32_t sourceLength, const char* target, int32_t targetLength, UErrorCode* status);
int32_t uloc_forLanguageTag(const char* langtag, char* localeID, int32_t localeIDCapacity, int32_t* parsedLength, UErrorCode* err);
}
#endif

namespace Bun {
namespace ICUCollate {

static const UCollator* open(const char* locale, bool isNumericAndBase)
{
    UErrorCode status = U_ZERO_ERROR;
    UCollator* collator = ucol_open(locale, &status);
    if (U_FAILURE(status))
        return nullptr;
    if (isNumericAndBase) {
        ucol_setAttribute(collator, UCOL_STRENGTH, UCOL_PRIMARY, &status);
        ucol_setAttribute(collator, UCOL_NUMERIC_COLLATION, UCOL_ON, &status);
    }
    // Texts that are canonically equivalent are equal.
    ucol_setAttribute(collator, UCOL_NORMALIZATION_MODE, UCOL_ON, &status);
    if (U_FAILURE(status)) {
        ucol_close(collator);
        return nullptr;
    }
    return collator;
}

// Each is opened at its first use (150 us for the first) and never closed. Many threads may compare with one collator at once.
static const UCollator* get(bool isNumericAndBase)
{
    if (isNumericAndBase) {
        static const UCollator* const collator = open("en", true);
        RELEASE_ASSERT(collator);
        return collator;
    }
    static const UCollator* const collator = open("en", false);
    RELEASE_ASSERT(collator);
    return collator;
}

// `new Intl.Collator(tag)`: the collator of one language tag, opened once per tag for the life of the process. Null for
// a tag that is not well-formed, which `localeCompare` throws a `RangeError` for; a well-formed tag that ICU has no
// data for gets the root collation, as `Intl` falls back to the default locale.
static const UCollator* forLanguageTag(const char* tag, size_t tagLength)
{
    static std::mutex mutex;
    static std::unordered_map<std::string, const UCollator*> byTag;

    std::string key(tag, tagLength);
    {
        std::lock_guard<std::mutex> guard(mutex);
        if (auto found = byTag.find(key); found != byTag.end())
            return found->second;
    }

    char locale[ULOC_FULLNAME_CAPACITY];
    int32_t parsedLength = 0;
    UErrorCode status = U_ZERO_ERROR;
    uloc_forLanguageTag(key.c_str(), locale, sizeof(locale), &parsedLength, &status);
    if (U_FAILURE(status) || parsedLength <= 0 || static_cast<size_t>(parsedLength) != key.size())
        return nullptr;
    const UCollator* collator = open(locale, false);
    if (!collator)
        return nullptr;

    std::lock_guard<std::mutex> guard(mutex);
    auto [entry, inserted] = byTag.try_emplace(std::move(key), collator);
    if (!inserted) {
        // Another thread opened the same tag meanwhile: theirs is the one every caller shares.
        ucol_close(const_cast<UCollator*>(collator));
    }
    return entry->second;
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

/// The collator of a BCP 47 language tag (`"zh-CN"`), shared and never closed, or null for a tag that is not well-formed.
extern "C" [[ZIG_EXPORT(nothrow)]] const void* Bun__collatorForLanguageTag(const char* tag, size_t tagLength)
{
    return Bun::ICUCollate::forLanguageTag(tag, tagLength);
}

/// `Bun__collateUTF8` with a collator from `Bun__collatorForLanguageTag`.
extern "C" [[ZIG_EXPORT(nothrow)]] int32_t Bun__collatorCollateUTF8(const void* collator, const char* a, size_t aLength, const char* b, size_t bLength)
{
    UErrorCode status = U_ZERO_ERROR;
    return ucol_strcollUTF8(static_cast<const UCollator*>(collator), a, static_cast<int32_t>(aLength), b, static_cast<int32_t>(bLength), &status);
}

/// `Bun__collateUTF16` with a collator from `Bun__collatorForLanguageTag`.
extern "C" [[ZIG_EXPORT(nothrow)]] int32_t Bun__collatorCollateUTF16(const void* collator, const uint16_t* a, size_t aLength, const uint16_t* b, size_t bLength)
{
    return ucol_strcoll(static_cast<const UCollator*>(collator), reinterpret_cast<const UChar*>(a), static_cast<int32_t>(aLength), reinterpret_cast<const UChar*>(b), static_cast<int32_t>(bLength));
}
