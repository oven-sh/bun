#include "root.h"
#include "wtf/dtoa.h"
#include "wtf/text/StringView.h"
#include "JavaScriptCore/JSGlobalObjectFunctions.h"
#include <cstring>

/// Must be called with a buffer of exactly 124
/// Find the length by scanning for the 0
extern "C" size_t WTF__dtoa(char* buf_124_bytes, double number)
{
    NumberToStringBuffer& buf = *reinterpret_cast<NumberToStringBuffer*>(buf_124_bytes);
    return WTF::numberToStringAndSize(number, buf);
}

/// This is the equivalent of the unary '+' operator on a JS string
/// See https://262.ecma-international.org/14.0/#sec-stringtonumber
/// Grammar: https://262.ecma-international.org/14.0/#prod-StringNumericLiteral
extern "C" double JSC__jsToNumber(char* latin1_ptr, size_t len)
{
    return JSC::jsToNumber(WTF::StringView(latin1_ptr, len, true));
}
