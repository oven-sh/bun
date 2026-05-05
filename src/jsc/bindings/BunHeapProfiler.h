#pragma once

#include "root.h"
#include <wtf/text/WTFString.h>

namespace JSC {
class VM;
}

namespace Bun {

// Generate a Claude-friendly text-based heap profile
// This format is designed specifically for analysis by LLMs with grep/sed/awk tools
// The output is hierarchical but with clear section markers for easy navigation
WTF::String generateHeapProfile(JSC::VM& vm);

} // namespace Bun
