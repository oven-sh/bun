#include "root.h"
#include "wtf/dtoa.h"

// What `Number.prototype.toFixed`, `toPrecision` and `toExponential` call in NumberPrototype.cpp, for Rust. The buffer
// has 124 bytes, which hold the longest result: `-`, 21 digits, `.`, 100 digits and the NUL of toFixed.

/// `number.toFixed(fractionDigits)` for a finite number below 1e21 and at most 100 digits
extern "C" [[ZIG_EXPORT(nothrow)]] size_t WTF__numberToFixed(char* buf_124_bytes, double number, unsigned fractionDigits)
{
    auto& buf = *reinterpret_cast<WTF::NumberToStringBuffer*>(buf_124_bytes);
    return WTF::numberToFixedWidthString(number, fractionDigits, buf).size();
}

/// `number.toPrecision(precision)` for a finite number and a precision from 1 to 100
extern "C" [[ZIG_EXPORT(nothrow)]] size_t WTF__numberToPrecision(char* buf_124_bytes, double number, unsigned precision)
{
    auto& buf = *reinterpret_cast<WTF::NumberToStringBuffer*>(buf_124_bytes);
    return WTF::numberToFixedPrecisionString(number, precision, buf).size();
}

/// `number.toExponential(fractionDigits)` for a finite number and at most 100 digits. -1: as many as it takes.
extern "C" [[ZIG_EXPORT(nothrow)]] size_t WTF__numberToExponential(char* buf_124_bytes, double number, int fractionDigits)
{
    auto& buf = *reinterpret_cast<WTF::NumberToStringBuffer*>(buf_124_bytes);
    WTF::double_conversion::StringBuilder builder { std::span<char> { buf } };
    WTF::double_conversion::DoubleToStringConverter::EcmaScriptConverter().ToExponential(number, fractionDigits, &builder);
    return builder.Finalize().size();
}
