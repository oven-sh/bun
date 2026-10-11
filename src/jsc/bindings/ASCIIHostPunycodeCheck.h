#pragma once

// Decides, without running full UTS #46 ToASCII, whether an all-ASCII host whose only possible problem is its
// "xn--" labels would pass ICU's uidna_nameToASCII(CHECK_BIDI | CHECK_CONTEXTJ | NONTRANSITIONAL_TO_ASCII) with the
// hyphen and length errors ignored. Mirrors icu::UTS46::processLabel for ACE labels: the label must Punycode-decode
// (u_strFromPunycode's rules), the decoding must be unchanged by the uts46 normalizer (valid, NFC), must not contain
// U+FFFD or start with a combining mark. Labels that would then need the BiDi or CONTEXTJ rules are left to ICU.
// Deliberately free of WTF so it can be tested standalone against ICU.

#include <unicode/uchar.h>
#include <cstddef>
#include <cstdint>
#if __has_include(<unicode/unorm2.h>)
#include <unicode/unorm2.h>
#else
// The macOS SDK ships only a subset of the ICU headers; these two entry points are stable C API in libicucore.
struct UNormalizer2;
typedef enum { UNORM2_COMPOSE,
    UNORM2_DECOMPOSE,
    UNORM2_FCD,
    UNORM2_COMPOSE_CONTIGUOUS } UNormalization2Mode;
extern "C" const UNormalizer2* unorm2_getInstance(const char* packageName, const char* name, UNormalization2Mode, UErrorCode*);
extern "C" UBool unorm2_isNormalized(const UNormalizer2*, const UChar*, int32_t length, UErrorCode*);
#endif

namespace Bun {

enum class ASCIIHostPunycodeVerdict : uint8_t { Valid,
    Invalid,
    NeedsFullCheck };

namespace PunycodeDetail {

static constexpr int32_t base = 36;
static constexpr int32_t tMin = 1;
static constexpr int32_t tMax = 26;
static constexpr int32_t skew = 38;
static constexpr int32_t damp = 700;
static constexpr int32_t initialBias = 72;
static constexpr int32_t initialN = 0x80;
static constexpr size_t maxCodePoints = 256; // A DNS label is at most 63 bytes; anything this long is left to ICU.

inline int32_t adaptBias(int32_t delta, int32_t length, bool firstTime)
{
    delta = firstTime ? delta / damp : delta / 2;
    delta += delta / length;
    int32_t count = 0;
    for (; delta > ((base - tMin) * tMax) / 2; count += base)
        delta /= (base - tMin);
    return count + (((base - tMin + 1) * delta) / (delta + skew));
}

inline int32_t digitValue(unsigned c)
{
    if (c - 'a' < 26)
        return c - 'a';
    if (c - '0' < 10)
        return c - '0' + 26;
    if (c - 'A' < 26)
        return c - 'A';
    return -1;
}

// RFC 3492 decoding with u_strFromPunycode's failure conditions. Returns the number of code points, -1 if the input is
// not valid Punycode, or -2 if it is merely too long to judge here.
template<typename CharacterType>
inline int32_t decode(const CharacterType* source, size_t sourceLength, char32_t (&destination)[maxCodePoints])
{
    if (sourceLength > maxCodePoints)
        return -2;
    // Everything before the last '-' (if any) is literal; a '-' at index 0 leaves nothing literal and is then
    // itself read as a digit, which fails, as in u_strFromPunycode.
    size_t basicLength = sourceLength;
    while (basicLength > 0) {
        if (source[--basicLength] == '-')
            break;
    }
    int32_t destLength = 0;
    for (size_t j = 0; j < basicLength; ++j) {
        unsigned c = source[j];
        if (c >= 0x80)
            return -1;
        destination[destLength++] = c - 'A' < 26 ? c | 0x20 : c; // ICU lowercases ASCII before it gets here.
    }
    int32_t n = initialN;
    int32_t i = 0;
    int32_t bias = initialBias;
    int32_t destCPCount = basicLength;
    for (size_t in = basicLength > 0 ? basicLength + 1 : 0; in < sourceLength;) {
        int32_t oldi = i;
        int32_t w = 1;
        for (int32_t k = base;; k += base) {
            if (in >= sourceLength)
                return -1;
            int32_t digit = digitValue(source[in++]);
            if (digit < 0)
                return -1;
            if (digit > (0x7fffffff - i) / w)
                return -1;
            i += digit * w;
            int32_t t = k - bias;
            if (t < tMin)
                t = tMin;
            else if (k >= bias + tMax)
                t = tMax;
            if (digit < t)
                break;
            if (w > 0x7fffffff / (base - t))
                return -1;
            w *= base - t;
        }
        ++destCPCount;
        bias = adaptBias(i - oldi, destCPCount, oldi == 0);
        if (i / destCPCount > 0x7fffffff - n)
            return -1;
        n += i / destCPCount;
        i %= destCPCount;
        if (n > 0x10ffff || (n & 0xfffff800) == 0xd800)
            return -1;
        if (static_cast<size_t>(destLength) >= maxCodePoints)
            return -2;
        for (int32_t move = destLength; move > i; --move)
            destination[move] = destination[move - 1];
        destination[i] = n;
        ++destLength;
        ++i;
    }
    return destLength;
}

inline const UNormalizer2* uts46Normalizer()
{
    static const UNormalizer2* instance = [] {
        UErrorCode status = U_ZERO_ERROR;
        const UNormalizer2* normalizer = unorm2_getInstance(nullptr, "uts46", UNORM2_COMPOSE, &status);
        return U_SUCCESS(status) ? normalizer : nullptr;
    }();
    return instance;
}

template<typename CharacterType>
inline ASCIIHostPunycodeVerdict checkLabel(const CharacterType* label, size_t length)
{
    if (length < 4 || (label[0] | 0x20) != 'x' || (label[1] | 0x20) != 'n' || label[2] != '-' || label[3] != '-')
        return ASCIIHostPunycodeVerdict::Valid; // Nothing about an ASCII non-ACE label is an error we report.
    // "xn--" alone and "xn--ascii-" are alternate encodings of ASCII labels.
    if (length == 4 || (length > 5 && label[length - 1] == '-'))
        return ASCIIHostPunycodeVerdict::Invalid;
    char32_t codePoints[maxCodePoints];
    int32_t count = decode(label + 4, length - 4, codePoints);
    if (count < 0)
        return count == -2 ? ASCIIHostPunycodeVerdict::NeedsFullCheck : ASCIIHostPunycodeVerdict::Invalid;
    if (!count)
        return ASCIIHostPunycodeVerdict::NeedsFullCheck;

    UChar utf16[maxCodePoints * 2];
    int32_t utf16Length = 0;
    bool needsContextRules = false;
    for (int32_t k = 0; k < count; ++k) {
        char32_t c = codePoints[k];
        if (c == 0xfffd)
            return ASCIIHostPunycodeVerdict::Invalid;
        if (c >= 0x80) {
            // ZWNJ/ZWJ need the CONTEXTJ rules and right-to-left characters the BiDi rule; let ICU judge those.
            if (c == 0x200c || c == 0x200d)
                needsContextRules = true;
            else {
                switch (u_charDirection(c)) {
                case U_RIGHT_TO_LEFT:
                case U_RIGHT_TO_LEFT_ARABIC:
                case U_ARABIC_NUMBER:
                    needsContextRules = true;
                    break;
                default:
                    break;
                }
            }
        }
        if (c < 0x10000)
            utf16[utf16Length++] = static_cast<UChar>(c);
        else {
            utf16[utf16Length++] = static_cast<UChar>((c >> 10) + 0xd7c0);
            utf16[utf16Length++] = static_cast<UChar>((c & 0x3ff) | 0xdc00);
        }
    }
    const UNormalizer2* normalizer = uts46Normalizer();
    if (!normalizer)
        return ASCIIHostPunycodeVerdict::NeedsFullCheck;
    UErrorCode status = U_ZERO_ERROR;
    if (!unorm2_isNormalized(normalizer, utf16, utf16Length, &status) || U_FAILURE(status))
        return U_FAILURE(status) ? ASCIIHostPunycodeVerdict::NeedsFullCheck : ASCIIHostPunycodeVerdict::Invalid;
    if (U_GET_GC_MASK(codePoints[0]) & U_GC_M_MASK)
        return ASCIIHostPunycodeVerdict::Invalid;
    return needsContextRules ? ASCIIHostPunycodeVerdict::NeedsFullCheck : ASCIIHostPunycodeVerdict::Valid;
}

} // namespace PunycodeDetail

// `host` must be ASCII. Labels are separated by '.'.
template<typename CharacterType>
inline ASCIIHostPunycodeVerdict checkASCIIHostPunycode(const CharacterType* host, size_t length)
{
    auto verdict = ASCIIHostPunycodeVerdict::Valid;
    size_t labelStart = 0;
    for (size_t i = 0; i <= length; ++i) {
        if (i != length && host[i] != '.')
            continue;
        switch (PunycodeDetail::checkLabel(host + labelStart, i - labelStart)) {
        case ASCIIHostPunycodeVerdict::Invalid:
            return ASCIIHostPunycodeVerdict::Invalid;
        case ASCIIHostPunycodeVerdict::NeedsFullCheck:
            verdict = ASCIIHostPunycodeVerdict::NeedsFullCheck;
            break;
        case ASCIIHostPunycodeVerdict::Valid:
            break;
        }
        labelStart = i + 1;
    }
    return verdict;
}

} // namespace Bun
