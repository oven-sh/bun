#pragma once

#include "root.h"
#include <wtf/text/ASCIIFastPath.h>

extern "C" void WTF__copyLCharsFromUCharSource(LChar* destination, const UChar* source, size_t length);

namespace JSC {
class VM;
}

namespace Bun {
String base64URLEncodeToString(Vector<uint8_t> data);
size_t toISOString(JSC::VM& vm, double date, char buffer[64]);
}
