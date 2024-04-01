#include "root.h"
#include "wtf/dtoa.h"
#include <cstring>

/// Must be called with a buffer of exactly 124
/// Find the length by scanning for the 0
extern "C" void WTF__dtoa(char* buf_124_bytes, double number)
{
    NumberToStringBuffer& buf = *reinterpret_cast<NumberToStringBuffer*>(buf_124_bytes);
    WTF::numberToString(number, buf);
}
