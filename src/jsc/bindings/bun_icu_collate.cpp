// `String.prototype.localeCompare` and `Intl.Collator` for Rust: ICU collators with the attributes that IntlCollator.cpp
// sets, for the root collation ("en") and per BCP 47 tag, read with JSC's locale helpers so the two agree on tags.

#include "root.h"

#include <JavaScriptCore/IntlObject.h>
#include <cstring>
#include <wtf/HashMap.h>
#include <wtf/Lock.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/text/StringHash.h>

#if ASAN_ENABLED
#include <sanitizer/lsan_interface.h>
#endif

#if __has_include(<unicode/ucol.h>)
#include <unicode/ucol.h>
#include <unicode/uloc.h>
#else
// macOS: libicucore has these, under these names, and the SDK has no header for them.
#include <unicode/utypes.h>
extern "C" {
typedef struct UCollator UCollator;
typedef enum { UCOL_CASE_FIRST = 2,
    UCOL_CASE_LEVEL = 3,
    UCOL_NORMALIZATION_MODE = 4,
    UCOL_STRENGTH = 5,
    UCOL_NUMERIC_COLLATION = 7 } UColAttribute;
typedef enum { UCOL_PRIMARY = 0,
    UCOL_TERTIARY = 2,
    UCOL_OFF = 16,
    UCOL_ON = 17 } UColAttributeValue;
typedef enum { UCOL_LESS = -1,
    UCOL_EQUAL = 0,
    UCOL_GREATER = 1 } UCollationResult;
#define ULOC_FULLNAME_CAPACITY 157
#define ULOC_KEYWORDS_CAPACITY 96
UCollator* ucol_open(const char* loc, UErrorCode* status);
void ucol_close(UCollator* coll);
void ucol_setAttribute(UCollator* coll, UColAttribute attr, UColAttributeValue value, UErrorCode* status);
UCollationResult ucol_strcoll(const UCollator* coll, const UChar* source, int32_t sourceLength, const UChar* target, int32_t targetLength);
UCollationResult ucol_strcollUTF8(const UCollator* coll, const char* source, int32_t sourceLength, const char* target, int32_t targetLength, UErrorCode* status);
int32_t uloc_getBaseName(const char* localeID, char* name, int32_t nameCapacity, UErrorCode* err);
int32_t uloc_getKeywordValue(const char* localeID, const char* keywordName, char* buffer, int32_t bufferCapacity, UErrorCode* status);
int32_t uloc_setKeywordValue(const char* keywordName, const char* keywordValue, char* buffer, int32_t bufferCapacity, UErrorCode* status);
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
    // As IntlCollator.cpp: strength and case level are `sensitivity`'s, the rest (`-u-kn-`, `-u-kf-`) is the locale's.
    ucol_setAttribute(collator, UCOL_STRENGTH, isNumericAndBase ? UCOL_PRIMARY : UCOL_TERTIARY, &status);
    ucol_setAttribute(collator, UCOL_CASE_LEVEL, UCOL_OFF, &status);
    if (isNumericAndBase)
        ucol_setAttribute(collator, UCOL_NUMERIC_COLLATION, UCOL_ON, &status);
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

// `new Intl.Collator(tag)`, opened once per tag for the life of the process. Null with `isWellFormed` false for a tag
// that is not well-formed, with it true for one ICU has no collation data for.
static const UCollator* forLanguageTag(const char* tag, size_t tagLength, bool* isWellFormed)
{
    static WTF::Lock lock;
    static WTF::NeverDestroyed<WTF::HashMap<WTF::String, const UCollator*>> byTag;

    *isWellFormed = false;
    WTF::String key = WTF::String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const uint8_t*>(tag), tagLength });
    if (key.isEmpty())
        return nullptr;
    {
        WTF::Locker locker { lock };
        if (auto found = byTag->find(key); found != byTag->end()) {
            *isWellFormed = true;
            return found->value;
        }
    }

    if (!JSC::isStructurallyValidLanguageTag(key))
        return nullptr;
    *isWellFormed = true;

    WTF::String canonical = JSC::canonicalizeUnicodeLocaleID(WTF::StringView(key));
    if (canonical.isNull())
        return nullptr;
    // `BestAvailableLocale`: the tag without its extensions, or a prefix of it, has collation data.
    if (JSC::bestAvailableLocale(JSC::intlCollatorAvailableLocales(), JSC::removeUnicodeLocaleExtension(canonical)).isNull())
        return nullptr;

    // ICU's locale ID of the tag has the extensions as keywords. Only the three `Intl.Collator` honours are kept. An
    // ID or a value that fills its buffer is not terminated (`U_STRING_NOT_TERMINATED_WARNING`, which is not a failure).
    Vector<char, 32> localeID = JSC::localeIDBufferForLanguageTagWithNullTerminator(canonical.ascii());
    if (localeID.isEmpty())
        return nullptr;
    UErrorCode status = U_ZERO_ERROR;
    char locale[ULOC_FULLNAME_CAPACITY];
    int32_t localeLength = uloc_getBaseName(localeID.span().data(), locale, ULOC_FULLNAME_CAPACITY, &status);
    if (U_FAILURE(status) || localeLength < 0 || localeLength >= ULOC_FULLNAME_CAPACITY)
        return nullptr;
    for (const char* keyword : { "collation", "colnumeric", "colcasefirst" }) {
        char value[ULOC_KEYWORDS_CAPACITY];
        status = U_ZERO_ERROR;
        int32_t length = uloc_getKeywordValue(localeID.span().data(), keyword, value, ULOC_KEYWORDS_CAPACITY, &status);
        if (U_FAILURE(status) || length <= 0)
            continue;
        if (length >= ULOC_KEYWORDS_CAPACITY)
            return nullptr;
        // A `co` of `standard` or `search` is not a collation type that a sort collator takes.
        if (!strcmp(keyword, "collation") && (!strcmp(value, "standard") || !strcmp(value, "search")))
            continue;
        status = U_ZERO_ERROR;
        localeLength = uloc_setKeywordValue(keyword, value, locale, ULOC_FULLNAME_CAPACITY, &status);
        if (U_FAILURE(status) || localeLength < 0 || localeLength >= ULOC_FULLNAME_CAPACITY)
            return nullptr;
    }
    const UCollator* collator = open(locale, false);
    if (!collator)
        return nullptr;

    WTF::Locker locker { lock };
    auto result = byTag->add(key, collator);
    if (!result.isNewEntry) {
        // Another thread opened the same tag meanwhile: theirs is the one every caller shares.
        ucol_close(const_cast<UCollator*>(collator));
        return result.iterator->value;
    }
#if ASAN_ENABLED
    // The map's table is in fastMalloc memory, which LeakSanitizer does not scan, so the collator looks unreachable.
    __lsan_ignore_object(collator);
#endif
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

/// The collator of a BCP 47 language tag (`"zh-CN"`), shared and never closed. Null with `isWellFormed` false for a
/// tag that is not well-formed, and with it true for one ICU has no collation data for.
extern "C" [[ZIG_EXPORT(nothrow)]] const void* Bun__collatorForLanguageTag(const char* tag, size_t tagLength, bool* isWellFormed)
{
    return Bun::ICUCollate::forLanguageTag(tag, tagLength, isWellFormed);
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
