#pragma once

#include "root.h"
#include <wtf/text/WTFString.h>
#include <wtf/Vector.h>

namespace JSC {
class JSGlobalObject;
class VM;
}

namespace Bun {

struct CPUProfileFrame {
    WTF::String functionName;
    WTF::String url;
    int scriptId;
    int lineNumber;
    int columnNumber;
    int sampleLine;
};

struct CPUProfilerState {
    double startTime = 0;
    double monotonicStartTime = 0;
    double initialSampleTime = 0;
    bool running = false;
    WTF::Vector<CPUProfileFrame> initialFrames;
};

void setSamplingInterval(int intervalMicroseconds);
bool isCPUProfilerRunning(JSC::VM&);

// Start the CPU profiler
void startCPUProfiler(JSC::VM& vm, bool captureInitialStack = false);

// Stop the CPU profiler and get profile data in requested formats.
// Pass non-null pointers for the formats you want. Null pointers are skipped.
void stopCPUProfiler(JSC::VM& vm, WTF::String* outJSON, WTF::String* outText);

} // namespace Bun
