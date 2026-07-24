#pragma once

#include "root.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/text/WTFString.h>

namespace JSC {
class VM;
}

namespace Bun {

// Generate a Claude-friendly text-based heap profile
// This format is designed specifically for analysis by LLMs with grep/sed/awk tools
// The output is hierarchical but with clear section markers for easy navigation
WTF::String generateHeapProfile(JSC::VM& vm);

// Backs node:v8's v8.startHeapProfile()/handle.stop().
JSC_DECLARE_HOST_FUNCTION(jsFunction_takeSamplingHeapProfile);

} // namespace Bun
