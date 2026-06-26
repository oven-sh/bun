#pragma once

#include "root.h"
#include <wtf/text/ASCIIFastPath.h>

namespace JSC {
class VM;
}

namespace Bun {
String base64URLEncodeToString(Vector<uint8_t> data);
size_t toISOString(JSC::VM& vm, double date, char buffer[64]);
}
