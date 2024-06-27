#include "root.h"
#include "wtf/dtoa.h"
#include "wtf/text/StringView.h"
#include "JavaScriptCore/JSGlobalObjectFunctions.h"
#include <cstring>

/// Must be called with a buffer of exactly 124
/// Find the length by scanning for the 0
extern "C" void WTF__dtoa(char* buf_124_bytes, double number)
{
    NumberToStringBuffer& buf = *reinterpret_cast<NumberToStringBuffer*>(buf_124_bytes);
    WTF::numberToString(number, buf);
}

extern "C" double JSC__jsToNumber(char* latin1_ptr, size_t len)
{
    return JSC::jsToNumber(WTF::StringView(latin1_ptr, len, true));
}
