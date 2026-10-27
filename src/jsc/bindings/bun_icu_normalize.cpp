// `String.prototype.normalize` for Rust. It calls the same ICU normalizers as StringPrototype.cpp.

#include "root.h"

#if __has_include(<unicode/unorm2.h>)
#include <unicode/unorm2.h>
#else
// macOS: libicucore exports these functions under these names, but the SDK has no header for them.
#include <unicode/utypes.h>
extern "C" {
typedef struct UNormalizer2 UNormalizer2;
const UNormalizer2* unorm2_getNFCInstance(UErrorCode* status);
const UNormalizer2* unorm2_getNFDInstance(UErrorCode* status);
const UNormalizer2* unorm2_getNFKCInstance(UErrorCode* status);
const UNormalizer2* unorm2_getNFKDInstance(UErrorCode* status);
int32_t unorm2_normalize(const UNormalizer2* normalizer, const UChar* source, int32_t length, UChar* destination, int32_t capacity, UErrorCode* status);
}
#endif

/// `form`: 0 is NFC, 1 is NFD, 2 is NFKC, 3 is NFKD. Returns the length of the normalized text, which is written to
/// `out` if it fits in `capacity`. Returns a negative number on failure.
extern "C" [[ZIG_EXPORT(nothrow)]] int32_t Bun__normalizeUTF16(uint8_t form, const uint16_t* text, size_t length, uint16_t* out, size_t capacity)
{
    UErrorCode status = U_ZERO_ERROR;
    const UNormalizer2* normalizer = form == 0 ? unorm2_getNFCInstance(&status)
        : form == 1                            ? unorm2_getNFDInstance(&status)
        : form == 2                            ? unorm2_getNFKCInstance(&status)
                                               : unorm2_getNFKDInstance(&status);
    if (U_FAILURE(status))
        return -1;
    int32_t written = unorm2_normalize(normalizer, reinterpret_cast<const UChar*>(text), static_cast<int32_t>(length), reinterpret_cast<UChar*>(out), static_cast<int32_t>(capacity), &status);
    return U_SUCCESS(status) || status == U_BUFFER_OVERFLOW_ERROR ? written : -1;
}
