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

// Register a consumer of the per-VM sampling profiler and return that
// consumer's start timestamp (microseconds since epoch). The underlying
// JSC::SamplingProfiler is started on the first consumer and shared by the
// rest; the returned timestamp is passed back to stopCPUProfiler() so each
// consumer's profile is scoped to its own window.
double startCPUProfiler(JSC::VM& vm);

// Release a consumer and emit its profile. Samples before sinceTimestampUs (as
// returned by startCPUProfiler) are excluded; 0 means "since the first
// consumer". The underlying profiler is paused and the retained sample buffer
// cleared only when the last consumer releases.
void stopCPUProfiler(JSC::VM& vm, WTF::String* outJSON, WTF::String* outText, double sinceTimestampUs = 0.0);

} // namespace Bun
