#pragma once

#include "root.h"
#include <wtf/text/WTFString.h>

namespace JSC {
class JSGlobalObject;
class VM;
}

namespace Bun {

// Start the CPU profiler
void startCPUProfiler(JSC::VM& vm);

// Stop the CPU profiler and convert to Chrome CPU profiler JSON format
// Returns JSON string, or empty string on failure
WTF::String stopCPUProfilerAndGetJSON(JSC::VM& vm);

} // namespace Bun
