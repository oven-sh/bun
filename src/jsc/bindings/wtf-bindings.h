#pragma once

#include "root.h"
#include <wtf/FailureAction.h>
#include <wtf/text/ASCIIFastPath.h>

namespace JSC {
class VM;
}

namespace Bun {
// Returns a null String if the encoded length exceeds the max string length, or to report a failed allocation.
String base64URLEncodeToString(const Vector<uint8_t>& data, WTF::FailureAction = WTF::FailureAction::Crash);
size_t toISOString(JSC::VM& vm, double date, char buffer[64]);
}
