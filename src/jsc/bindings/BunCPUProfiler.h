#pragma once

#include "root.h"
#include <JavaScriptCore/SamplingProfiler.h>
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

// Stop the CPU profiler and get profile data in requested formats.
// Pass non-null pointers for the formats you want. Null pointers are skipped.
void stopCPUProfiler(JSC::VM& vm, WTF::String* outJSON, WTF::String* outText);

// The name of a frame in a profile. Every profile writer calls this, not frame.displayName().
WTF::String functionName(JSC::VM&, JSC::SamplingProfiler::StackFrame&);

} // namespace Bun
