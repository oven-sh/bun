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

// Register a new profiler owner and start the VM's SamplingProfiler if this
// is the first one. Returns a nonzero owner token for releaseCPUProfilerOwner.
uint32_t acquireCPUProfilerOwner(JSC::VM& vm);

// Release an owner returned by acquireCPUProfilerOwner(). Writes the profile
// (covering only this owner's window) to the requested non-null out-params,
// and stops the underlying SamplingProfiler once the last owner releases.
void releaseCPUProfilerOwner(JSC::VM& vm, uint32_t owner, WTF::String* outJSON, WTF::String* outText);

// Single-implicit-owner convenience wrappers (CLI `--cpu-prof`, per-Worker
// profiling). startCPUProfiler is a no-op if the implicit owner is already
// held; stopCPUProfiler releases it.
void startCPUProfiler(JSC::VM& vm);
void stopCPUProfiler(JSC::VM& vm, WTF::String* outJSON, WTF::String* outText);

} // namespace Bun
