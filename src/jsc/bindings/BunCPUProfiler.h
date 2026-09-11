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

// Fold the samples taken since the last drain into the profile and release
// the JS objects those samples reference. The event loop calls this on the JS
// thread once per tick. It is a no-op when the profiler is not running or when
// the last drain was less than 100ms ago.
void drainCPUProfilerIfNeeded(JSC::VM& vm);

// Stop the CPU profiler and get profile data in requested formats.
// Pass non-null pointers for the formats you want. Null pointers are skipped.
void stopCPUProfiler(JSC::VM& vm, WTF::String* outJSON, WTF::String* outText);

} // namespace Bun
