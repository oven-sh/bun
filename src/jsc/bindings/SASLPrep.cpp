// SASLprep (RFC 4013) as PostgreSQL's pg_saslprep() does it, which made the stored verifier: the prohibited, unassigned
// and bidi checks look at the mapped input, not at the NFKC output, and a password that maps to nothing is refused.

#include "root.h"

#include <openssl/mem.h>
#include <unicode/uchar.h>
#include <unicode/unorm2.h>
#include <unicode/ustring.h>
#include <unicode/utf16.h>
#include <unicode/utf8.h>
#include <wtf/Vector.h>

namespace Bun {
namespace SASLPrep {

struct Range {
    UChar32 first;
    UChar32 last;
};

template<size_t N>
static bool contains(const Range (&table)[N], UChar32 c)
{
    for (const Range& range : table) {
        if (c <= range.last)
            return c >= range.first;
    }
    return false;
}

// RFC 3454 C.1.2
static constexpr Range nonASCIISpace[] = {
    { 0x00A0, 0x00A0 },
    { 0x1680, 0x1680 },
    { 0x2000, 0x200B },
    { 0x202F, 0x202F },
    { 0x205F, 0x205F },
    { 0x3000, 0x3000 },
};

// RFC 3454 B.1
static constexpr Range mappedToNothing[] = {
    { 0x00AD, 0x00AD },
    { 0x034F, 0x034F },
    { 0x1806, 0x1806 },
    { 0x180B, 0x180D },
    { 0x200B, 0x200D },
    { 0x2060, 0x2060 },
    { 0xFE00, 0xFE0F },
    { 0xFEFF, 0xFEFF },
};

// RFC 3454 C.1.2, C.2.1, C.2.2 and C.3 to C.9, merged
static constexpr Range prohibited[] = {
    { 0x0000, 0x001F },
    { 0x007F, 0x00A0 },
    { 0x0340, 0x0341 },
    { 0x06DD, 0x06DD },
    { 0x070F, 0x070F },
    { 0x1680, 0x1680 },
    { 0x180E, 0x180E },
    { 0x2000, 0x200F },
    { 0x2028, 0x202F },
    { 0x205F, 0x2063 },
    { 0x206A, 0x206F },
    { 0x2FF0, 0x2FFB },
    { 0x3000, 0x3000 },
    { 0xD800, 0xF8FF },
    { 0xFDD0, 0xFDEF },
    { 0xFEFF, 0xFEFF },
    { 0xFFF9, 0xFFFF },
    { 0x1D173, 0x1D17A },
    { 0x1FFFE, 0x1FFFF },
    { 0x2FFFE, 0x2FFFF },
    { 0x3FFFE, 0x3FFFF },
    { 0x4FFFE, 0x4FFFF },
    { 0x5FFFE, 0x5FFFF },
    { 0x6FFFE, 0x6FFFF },
    { 0x7FFFE, 0x7FFFF },
    { 0x8FFFE, 0x8FFFF },
    { 0x9FFFE, 0x9FFFF },
    { 0xAFFFE, 0xAFFFF },
    { 0xBFFFE, 0xBFFFF },
    { 0xCFFFE, 0xCFFFF },
    { 0xDFFFE, 0xDFFFF },
    { 0xE0001, 0xE0001 },
    { 0xE0020, 0xE007F },
    { 0xEFFFE, 0xEFFFF },
    { 0xF0000, 0xFFFFF },
    { 0x100000, 0x10FFFF },
};

// RFC 3454 A.1
static bool isUnassignedInUnicode32(UChar32 c)
{
    UVersionInfo age;
    u_charAge(c, age);
    return !age[0] || age[0] > 3 || (age[0] == 3 && age[1] > 2);
}

// Holds a form of the password. It only ever grows, so nothing was written past its size.
struct Wiped : WTF::Vector<char16_t, 128> {
    ~Wiped() { OPENSSL_cleanse(mutableSpan().data(), mutableSpan().size_bytes()); }
};

} // namespace SASLPrep
} // namespace Bun

// Writes the prepared password to `out` in UTF-8 and returns its length: at most 11 times `inputLength` (U+FDFA).
// -1: not UTF-8, or SASLprep refuses it. libpq then uses the password as it is.
extern "C" int64_t Bun__saslprep(const uint8_t* input, size_t inputLength, uint8_t* out, size_t outCapacity)
{
    using namespace Bun::SASLPrep;
    // How many times as long NFKC can make UTF-16 (U+FDFA).
    constexpr size_t maxExpansion = 18;
    if (inputLength > static_cast<size_t>(INT32_MAX) / maxExpansion || outCapacity > static_cast<size_t>(INT32_MAX))
        return -1;
    const int32_t length = static_cast<int32_t>(inputLength);

    Wiped mapped;
    // Never more UTF-16 units than UTF-8 bytes: it does not grow and leave a copy behind.
    mapped.reserveInitialCapacity(inputLength);
    bool hasRandAL = false, hasL = false, startsWithRandAL = false, endsWithRandAL = false;
    for (int32_t i = 0; i < length;) {
        UChar32 c;
        U8_NEXT(input, i, length, c);
        if (c < 0)
            return -1;
        if (contains(nonASCIISpace, c))
            c = ' ';
        else if (contains(mappedToNothing, c))
            continue;
        if (contains(prohibited, c) || isUnassignedInUnicode32(c))
            return -1;

        // RFC 3454 D.1 and D.2
        const UCharDirection direction = u_charDirection(c);
        endsWithRandAL = direction == U_RIGHT_TO_LEFT || direction == U_RIGHT_TO_LEFT_ARABIC;
        if (mapped.isEmpty())
            startsWithRandAL = endsWithRandAL;
        hasRandAL |= endsWithRandAL;
        hasL |= direction == U_LEFT_TO_RIGHT;

        if (U_IS_BMP(c))
            mapped.append(static_cast<char16_t>(c));
        else {
            mapped.append(U16_LEAD(c));
            mapped.append(U16_TRAIL(c));
        }
    }
    if (mapped.isEmpty())
        return -1;
    if (hasRandAL && (hasL || !startsWithRandAL || !endsWithRandAL))
        return -1;

    Wiped normalized;
    normalized.grow(mapped.size() * maxExpansion);
    UErrorCode status = U_ZERO_ERROR;
    const UNormalizer2* nfkc = unorm2_getNFKCInstance(&status);
    const int32_t normalizedLength = unorm2_normalize(nfkc, mapped.span().data(), static_cast<int32_t>(mapped.size()), normalized.mutableSpan().data(), static_cast<int32_t>(normalized.size()), &status);
    int32_t utf8Length = 0;
    u_strToUTF8(reinterpret_cast<char*>(out), static_cast<int32_t>(outCapacity), &utf8Length, normalized.span().data(), normalizedLength, &status);
    return U_FAILURE(status) ? -1 : utf8Length;
}
