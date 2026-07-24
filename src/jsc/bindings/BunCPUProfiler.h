#pragma once

#include "root.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/text/WTFString.h>

namespace JSC {
class VM;
}

namespace Bun {

void setSamplingInterval(int intervalMicroseconds);
bool isCPUProfilerRunning();

// node:v8 startCpuProfile/stopCpuProfile (v8.startCpuProfile()).
JSC_DECLARE_HOST_FUNCTION(jsFunction_startCpuProfile);
JSC_DECLARE_HOST_FUNCTION(jsFunction_stopCpuProfile);

// Start the CPU profiler
void startCPUProfiler(JSC::VM& vm);

// Stop the CPU profiler and get profile data in requested formats.
// Pass non-null pointers for the formats you want. Null pointers are skipped.
void stopCPUProfiler(JSC::VM& vm, WTF::String* outJSON, WTF::String* outText);

} // namespace Bun
