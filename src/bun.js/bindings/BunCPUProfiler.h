#pragma once

#include "root.h"
#include <wtf/text/WTFString.h>

namespace JSC {
class JSGlobalObject;
class VM;
}

namespace Bun {

void setSamplingInterval(int intervalMicroseconds);
bool isCPUProfilerRunning();

// Start the CPU profiler
void startCPUProfiler(JSC::VM& vm);

// Stop the CPU profiler and convert to Chrome CPU profiler JSON format
// Returns JSON string, or empty string if profiler was never started
WTF::String stopCPUProfilerAndGetJSON(JSC::VM& vm);

// Stop the CPU profiler and convert to text format (grep-friendly, designed for LLM analysis)
// Returns text string, or empty string if profiler was never started
WTF::String stopCPUProfilerAndGetText(JSC::VM& vm);

} // namespace Bun
