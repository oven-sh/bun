#pragma once

#include "root.h"
#include <wtf/text/WTFString.h>

namespace JSC {
class JSGlobalObject;
}

namespace Bun {

void setSamplingInterval(JSC::JSGlobalObject* globalObject, int intervalMicroseconds);
bool isCPUProfilerRunning(JSC::JSGlobalObject* globalObject);

// Start the CPU profiler
void startCPUProfiler(JSC::JSGlobalObject* globalObject);

// Stop the CPU profiler and get profile data in requested formats.
// Pass non-null pointers for the formats you want. Null pointers are skipped.
void stopCPUProfiler(JSC::JSGlobalObject* globalObject, WTF::String* outJSON, WTF::String* outText);

} // namespace Bun
