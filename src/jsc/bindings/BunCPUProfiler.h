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

// The per-VM JSC::SamplingProfiler is shared by --cpu-prof, node:inspector
// sessions, and Worker.{start,stop}CpuProfile, so startCPUProfiler()/
// stopCPUProfiler() refcount it: the sampler starts on the first consumer and
// is paused/cleared on the last. startCPUProfiler() returns this consumer's
// start timestamp (microseconds since epoch), which is passed back as
// sinceTimestampUs so each consumer's profile is scoped to its own window
// (0 = since the first consumer).
double startCPUProfiler(JSC::VM& vm);
void stopCPUProfiler(JSC::VM& vm, WTF::String* outJSON, WTF::String* outText, double sinceTimestampUs = 0.0);

} // namespace Bun
