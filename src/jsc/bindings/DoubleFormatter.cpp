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

/// Round `number` to `significantDigits` significant figures and format it.
/// This uses the same rounding as `Number.prototype.toPrecision`, but trims
/// trailing zeros (so `1.2` stays `"1.2"` rather than padding to `"1.20"`),
/// which keeps snapshot output clean. Snapshot serialization uses this so
/// floating-point results stay stable across CPU architectures (the same double
/// can otherwise format with a differing final digit on different FPUs).
/// `buf_124_bytes` must be 124 bytes; `significantDigits` must be in 1..=100.
/// Returns the written length (no trailing NUL is counted).
extern "C" [[ZIG_EXPORT(nothrow)]] size_t WTF__numberToFixedPrecisionString(char* buf_124_bytes, double number, unsigned significantDigits)
{
    NumberToStringBuffer& buf = *reinterpret_cast<NumberToStringBuffer*>(buf_124_bytes);
    const char* result = WTF::numberToFixedPrecisionString(number, significantDigits, buf, /* truncateTrailingZeros */ true);
    size_t len = std::strlen(result);
    // numberToFixedPrecisionString may write at an offset inside the buffer;
    // normalize so the Rust caller can always read from buf[0..len].
    if (result != buf_124_bytes)
        std::memmove(buf_124_bytes, result, len);
    return len;
}

/// This is the equivalent of the unary '+' operator on a JS string
/// See https://262.ecma-international.org/14.0/#sec-stringtonumber
/// Grammar: https://262.ecma-international.org/14.0/#prod-StringNumericLiteral
extern "C" [[ZIG_EXPORT(nothrow)]] double JSC__jsToNumber(const char* latin1_ptr, size_t len)
{
    return JSC::jsToNumber(WTF::StringView(latin1_ptr, len, true));
}
