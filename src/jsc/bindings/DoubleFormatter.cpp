#include "root.h"
#include "wtf/dtoa.h"
#include "wtf/text/ParsingUtilities.h"
#include "wtf/text/StringView.h"
#include "JavaScriptCore/JSBigIntInlines.h"
#include "JavaScriptCore/JSCJSValueInlines.h"
#include "JavaScriptCore/JSGlobalObjectFunctions.h"
#include "JavaScriptCore/ParseInt.h"
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

// JSC::parseInt is ALWAYS_INLINE. This keeps one copy of it for each character type.
template<typename CharacterType>
static NEVER_INLINE double parseIntCharacters(std::span<const CharacterType> characters)
{
    return JSC::parseInt(characters, 0);
}

/// `parseInt(value)` for a value that is not a Number.
extern "C" [[ZIG_EXPORT(check_slow)]] double Bun__JSValue__parseInt(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    return JSC::toStringView(globalObject, JSC::JSValue::decode(value), [](StringView view) {
        return view.is8Bit() ? parseIntCharacters(view.span8()) : parseIntCharacters(view.span16());
    });
}

/// `parseInt(number)`: what `globalFuncParseInt` returns for a Number, without a JSString of its digits.
extern "C" [[ZIG_EXPORT(nothrow)]] double Bun__parseIntDouble(double number)
{
    if (auto result = JSC::parseIntDouble(number))
        return *result;
    // "NaN", "Infinity" and "-Infinity" have no digits.
    if (!std::isfinite(number))
        return JSC::PNaN;
    NumberToStringBuffer buffer;
    return parseIntCharacters(byteCast<Latin1Character>(numberToStringAndSize(number, buffer)));
}

// Returns what JSC's `parseFloat(StringView)` returns. That function is file-static in runtime/JSGlobalObjectFunctions.cpp.
template<typename CharacterType>
static double parseFloatCharacters(std::span<const CharacterType> data)
{
    skipWhile<JSC::isStrWhiteSpace>(data);
    if (data.empty())
        return JSC::PNaN;

    size_t parsedLength;
    double number = parseDouble(data, parsedLength);
    if (parsedLength)
        return number;

    bool isNegative = data.front() == '-';
    if (isNegative || data.front() == '+')
        skip(data, 1);
    static constexpr std::array<CharacterType, 8> infinity { 'I', 'n', 'f', 'i', 'n', 'i', 't', 'y' };
    if (!spanHasPrefix(data, std::span { infinity }))
        return JSC::PNaN;
    return isNegative ? -std::numeric_limits<double>::infinity() : std::numeric_limits<double>::infinity();
}

/// `parseFloat(value)` for a value that is not a Number.
extern "C" [[ZIG_EXPORT(check_slow)]] double Bun__JSValue__parseFloat(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    return JSC::toStringView(globalObject, JSC::JSValue::decode(value), [](StringView view) {
        return view.is8Bit() ? parseFloatCharacters(view.span8()) : parseFloatCharacters(view.span16());
    });
}

/// `Number(value)`: ToNumber, except that a BigInt converts.
extern "C" [[ZIG_EXPORT(check_slow)]] double Bun__JSValue__toNumberFromNumeric(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSValue numeric = JSC::JSValue::decode(value).toNumeric(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (numeric.isBigInt())
        numeric = JSC::JSBigInt::toNumber(numeric);
    return numeric.asNumber();
}
