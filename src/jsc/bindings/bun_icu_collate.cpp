// `String.prototype.localeCompare` and `Intl.Collator` for Rust: ICU's collator for English, which is CLDR's root collation,
// with the attributes that IntlCollator.cpp sets, and one per BCP 47 language tag for `localeCompare(b, locale)`.

#include "root.h"

#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>

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
int32_t ucol_countAvailable(void);
const char* ucol_getAvailable(int32_t localeIndex);
int32_t uloc_forLanguageTag(const char* langtag, char* localeID, int32_t localeIDCapacity, int32_t* parsedLength, UErrorCode* err);
int32_t uloc_canonicalize(const char* localeID, char* name, int32_t nameCapacity, UErrorCode* err);
int32_t uloc_toLanguageTag(const char* localeID, char* langtag, int32_t langtagCapacity, UBool strict, UErrorCode* err);
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

// The result of an ICU function that writes a string into a buffer of the caller's, grown once when the first size
// is not enough. Nothing on failure.
template<typename Produce>
static std::optional<std::string> producedString(Produce&& produce)
{
    std::string result(ULOC_FULLNAME_CAPACITY, '\0');
    UErrorCode status = U_ZERO_ERROR;
    int32_t length = produce(result.data(), static_cast<int32_t>(result.size()), &status);
    if (status == U_BUFFER_OVERFLOW_ERROR || status == U_STRING_NOT_TERMINATED_WARNING) {
        result.assign(static_cast<size_t>(length) + 1, '\0');
        status = U_ZERO_ERROR;
        length = produce(result.data(), static_cast<int32_t>(result.size()), &status);
    }
    if (U_FAILURE(status) || length < 0)
        return std::nullopt;
    result.resize(static_cast<size_t>(length));
    return result;
}

static std::optional<std::string> languageTagForLocaleID(const char* localeID)
{
    return producedString([&](char* buffer, int32_t capacity, UErrorCode* status) {
        return uloc_toLanguageTag(localeID, buffer, capacity, false, status);
    });
}

// The language tags ICU has collation data for, as JSC's `intlCollatorAvailableLocales` lists them: each of
// `ucol_getAvailable` as a tag, and `xx-ZZ` beside each `xx-Yyyy-ZZ`. Built at its first use, for the life of the process.
static const std::unordered_set<std::string>& availableLocales()
{
    static const std::unordered_set<std::string> locales = [] {
        std::unordered_set<std::string> set;
        int32_t count = ucol_countAvailable();
        for (int32_t i = 0; i < count; ++i) {
            const char* localeID = ucol_getAvailable(i);
            if (!localeID)
                continue;
            std::optional<std::string> tag = languageTagForLocaleID(localeID);
            if (!tag || tag->empty())
                continue;
            std::string_view view(*tag);
            size_t afterLanguage = view.find('-');
            size_t afterScript = afterLanguage == std::string_view::npos ? afterLanguage : view.find('-', afterLanguage + 1);
            if (afterScript != std::string_view::npos && view.find('-', afterScript + 1) == std::string_view::npos) {
                std::string_view script = view.substr(afterLanguage + 1, afterScript - afterLanguage - 1);
                std::string_view region = view.substr(afterScript + 1);
                if (script.size() == 4 && region.size() <= 3)
                    set.insert(std::string(view.substr(0, afterLanguage)) + '-' + std::string(region));
            }
            set.insert(std::move(*tag));
        }
        return set;
    }();
    return locales;
}

// Whether `Intl.Collator` resolves a canonical language tag to one of `availableLocales()` (BestAvailableLocale): the
// tag without its extensions, or any prefix of it up to a `-`.
static bool isSupported(std::string_view canonicalTag)
{
    std::string_view candidate = canonicalTag;
    // An extension or private use starts at the first subtag of one character; nothing after it is matched.
    for (size_t start = 0;;) {
        size_t end = candidate.find('-', start);
        size_t subtagLength = (end == std::string_view::npos ? candidate.size() : end) - start;
        if (subtagLength == 1) {
            candidate = candidate.substr(0, start == 0 ? 0 : start - 1);
            break;
        }
        if (end == std::string_view::npos)
            break;
        start = end + 1;
    }
    const auto& available = availableLocales();
    while (!candidate.empty()) {
        if (available.contains(std::string(candidate)))
            return true;
        size_t pos = candidate.rfind('-');
        if (pos == std::string_view::npos)
            return false;
        candidate = candidate.substr(0, pos);
    }
    return false;
}

// `new Intl.Collator(tag)`: the collator of one language tag, opened once per tag for the life of the process. Null
// with `isWellFormed` false for a tag that is not well-formed, which `localeCompare` throws a `RangeError` for; null
// with `isWellFormed` true for a well-formed tag that ICU has no collation data for, which `Intl` passes over for
// the next of a list, or the default locale.
static const UCollator* forLanguageTag(const char* tag, size_t tagLength, bool* isWellFormed)
{
    static std::mutex mutex;
    static std::unordered_map<std::string, const UCollator*> byTag;

    *isWellFormed = false;
    std::string key(tag, tagLength);
    {
        std::lock_guard<std::mutex> guard(mutex);
        if (auto found = byTag.find(key); found != byTag.end()) {
            *isWellFormed = true;
            return found->second;
        }
    }

    int32_t parsedLength = 0;
    std::optional<std::string> locale = producedString([&](char* buffer, int32_t capacity, UErrorCode* status) {
        return uloc_forLanguageTag(key.c_str(), buffer, capacity, &parsedLength, status);
    });
    if (!locale || parsedLength <= 0 || static_cast<size_t>(parsedLength) != key.size())
        return nullptr;
    *isWellFormed = true;

    // As JSC's `canonicalizeUnicodeLocaleID`: ICU's locale ID, canonicalized and made a tag again, is what is matched.
    std::optional<std::string> canonical = producedString([&](char* buffer, int32_t capacity, UErrorCode* status) {
        return uloc_canonicalize(locale->c_str(), buffer, capacity, status);
    });
    std::optional<std::string> canonicalTag = canonical ? languageTagForLocaleID(canonical->c_str()) : std::nullopt;
    if (!canonicalTag || !isSupported(*canonicalTag))
        return nullptr;
    const UCollator* collator = open(locale->c_str(), false);
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
