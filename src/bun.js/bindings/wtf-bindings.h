#pragma once

#include "root.h"
#include "wtf/text/ASCIIFastPath.h"

extern "C" void WTF__copyLCharsFromUCharSource(LChar* destination, const UChar* source, size_t length);

namespace Bun {
    String base64URLEncodeToString(Vector<uint8_t> data);
}