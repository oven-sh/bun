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

// Whether profiles on this thread also build the per-function stats for the markdown report.
void setCollectMarkdown(bool collect);

// Start the CPU profiler
void startCPUProfiler(JSC::VM& vm);

// Folds pending samples into the profile and releases their GC roots. Called from the event loop tick, at most once per 100ms.
void drainCPUProfilerIfNeeded(JSC::VM& vm);

// Stop the CPU profiler and get profile data in requested formats.
// Pass non-null pointers for the formats you want. Null pointers are skipped.
void stopCPUProfiler(JSC::VM& vm, WTF::String* outJSON, WTF::String* outText);

} // namespace Bun
