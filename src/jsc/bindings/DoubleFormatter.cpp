#include "root.h"
#include "wtf/dtoa.h"
#include "wtf/text/StringView.h"
#include "JavaScriptCore/JSGlobalObjectFunctions.h"
#include "JavaScriptCore/ParseInt.h"
#include "BunString.h"
#include <cstring>

using namespace WTF;

/// Must be called with a buffer of exactly 124
/// Find the length by scanning for the 0
extern "C" [[ZIG_EXPORT(nothrow)]] size_t WTF__dtoa(char* buf_124_bytes, double number)
{
    NumberToStringBuffer& buf = *reinterpret_cast<NumberToStringBuffer*>(buf_124_bytes);
    return WTF::numberToStringAndSize(number, buf).size();
}

/// This is the equivalent of the unary '+' operator on a JS string
/// See https://262.ecma-international.org/14.0/#sec-stringtonumber
/// Grammar: https://262.ecma-international.org/14.0/#prod-StringNumericLiteral
extern "C" [[ZIG_EXPORT(nothrow)]] double JSC__jsToNumber(const char* latin1_ptr, size_t len)
{
    return JSC::jsToNumber(WTF::StringView(latin1_ptr, len, true));
}

/// `parseInt(string, radix)` on an already-converted string.
extern "C" [[ZIG_EXPORT(nothrow)]] double Bun__parseInt(const BunString* str, int radix)
{
    return JSC::parseInt(str->toWTFString(BunString::ZeroCopy), radix);
}

/// `parseFloat(string)`, as JSGlobalObjectFunctions.cpp implements it.
template<typename CharacterType>
static double parseFloatSpan(std::span<const CharacterType> data)
{
    size_t i = 0;
    while (i < data.size() && JSC::isStrWhiteSpace(data[i]))
        i++;
    data = data.subspan(i);
    if (data.empty())
        return JSC::PNaN;

    size_t parsedLength = 0;
    double number = WTF::parseDouble(data, parsedLength);
    if (parsedLength)
        return number;

    auto isInfinity = [](std::span<const CharacterType> s) {
        static constexpr std::array<char, 8> infinity { 'I', 'n', 'f', 'i', 'n', 'i', 't', 'y' };
        if (s.size() < infinity.size())
            return false;
        for (size_t j = 0; j < infinity.size(); j++) {
            if (s[j] != static_cast<CharacterType>(infinity[j]))
                return false;
        }
        return true;
    };
    switch (data[0]) {
    case 'I':
        return isInfinity(data) ? std::numeric_limits<double>::infinity() : JSC::PNaN;
    case '+':
        return isInfinity(data.subspan(1)) ? std::numeric_limits<double>::infinity() : JSC::PNaN;
    case '-':
        return isInfinity(data.subspan(1)) ? -std::numeric_limits<double>::infinity() : JSC::PNaN;
    default:
        return JSC::PNaN;
    }
}

extern "C" [[ZIG_EXPORT(nothrow)]] double Bun__parseFloat(const BunString* str)
{
    WTF::String string = str->toWTFString(BunString::ZeroCopy);
    if (string.is8Bit())
        return parseFloatSpan(string.span8());
    return parseFloatSpan(string.span16());
}
