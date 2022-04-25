#include "wtf-bindings.h"

extern "C" void WTF__copyLCharsFromUCharSource(LChar* destination, const UChar* source, size_t length)
{
    WTF::copyLCharsFromUCharSource(destination, source, length);
}