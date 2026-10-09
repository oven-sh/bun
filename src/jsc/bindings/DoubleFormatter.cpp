#include "root.h"
#include "wtf/dtoa.h"
#include "wtf/text/StringView.h"
#include "JavaScriptCore/JSGlobalObjectFunctions.h"
#include <cstring>

using namespace WTF;

/// Must be called with a buffer of exactly 124
/// Find the length by scanning for the 0
extern "C" [[ZIG_EXPORT(nothrow)]] size_t WTF__dtoa(char* buf_124_bytes, double number)
{
    NumberToStringBuffer& buf = *reinterpret_cast<NumberToStringBuffer*>(buf_124_bytes);
    return WTF::numberToStringAndSize(number, buf).size();
}

/// `number.toFixed(fractionDigits)` for a finite number below 1e21 and at most 100 digits
extern "C" [[ZIG_EXPORT(nothrow)]] size_t WTF__numberToFixed(char* buf_124_bytes, double number, unsigned fractionDigits)
{
    NumberToStringBuffer& buf = *reinterpret_cast<NumberToStringBuffer*>(buf_124_bytes);
    return WTF::numberToFixedWidthString(number, fractionDigits, buf).size();
}

/// `number.toPrecision(precision)` for a finite number and a precision from 1 to 100
extern "C" [[ZIG_EXPORT(nothrow)]] size_t WTF__numberToPrecision(char* buf_124_bytes, double number, unsigned precision)
{
    NumberToStringBuffer& buf = *reinterpret_cast<NumberToStringBuffer*>(buf_124_bytes);
    return WTF::numberToFixedPrecisionString(number, precision, buf).size();
}

/// `number.toExponential(fractionDigits)` for a finite number and at most 100 digits. -1: as many as it takes.
extern "C" [[ZIG_EXPORT(nothrow)]] size_t WTF__numberToExponential(char* buf_124_bytes, double number, int fractionDigits)
{
    NumberToStringBuffer& buf = *reinterpret_cast<NumberToStringBuffer*>(buf_124_bytes);
    WTF::double_conversion::StringBuilder builder { std::span<char> { buf } };
    WTF::double_conversion::DoubleToStringConverter::EcmaScriptConverter().ToExponential(number, fractionDigits, &builder);
    return builder.Finalize().size();
}

/// This is the equivalent of the unary '+' operator on a JS string
/// See https://262.ecma-international.org/14.0/#sec-stringtonumber
/// Grammar: https://262.ecma-international.org/14.0/#prod-StringNumericLiteral
extern "C" [[ZIG_EXPORT(nothrow)]] double JSC__jsToNumber(const char* latin1_ptr, size_t len)
{
    return JSC::jsToNumber(WTF::StringView(latin1_ptr, len, true));
}
