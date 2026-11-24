// The Unicode properties of the ICU that JavaScriptCore uses, for Rust.

#include "root.h"
#include <unicode/uchar.h>

extern "C" bool Bun__isIDStart(uint32_t codePoint)
{
    return u_hasBinaryProperty(codePoint, UCHAR_ID_START);
}

extern "C" bool Bun__isIDContinue(uint32_t codePoint)
{
    return u_hasBinaryProperty(codePoint, UCHAR_ID_CONTINUE);
}
