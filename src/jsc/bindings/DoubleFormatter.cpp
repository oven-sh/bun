#include "root.h"
#include "wtf/dtoa.h"
#include <cstring>

using namespace WTF;

/// Must be called with a buffer of exactly 124
/// Find the length by scanning for the 0
extern "C" [[ZIG_EXPORT(nothrow)]] size_t WTF__dtoa(char* buf_124_bytes, double number)
{
    NumberToStringBuffer& buf = *reinterpret_cast<NumberToStringBuffer*>(buf_124_bytes);
    return WTF::numberToStringAndSize(number, buf).size();
}
