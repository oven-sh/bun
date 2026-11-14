#pragma once

#include "root.h"
#include <JavaScriptCore/SamplingProfiler.h>
#include <wtf/Seconds.h>
#include <wtf/Vector.h>

namespace JSC {
class JSGlobalObject;
}

namespace Bun {

// JSC::SamplingProfiler has no getter for its interval, so every caller sets it here.
void setSamplingProfilerTimingInterval(JSC::SamplingProfiler&, WTF::Seconds);
WTF::Seconds samplingProfilerTimingInterval();

// Drains the profiler. The caller holds the JSLock and a JSC::DeferGC while it
// reads the result: a StackFrame holds raw JSCell pointers.
WTF::Vector<JSC::SamplingProfiler::StackTrace> takeSamplingProfilerStackTraces(JSC::SamplingProfiler&, bool pause);

// `{ interval, traces, sources }` with the shape of JSC::SamplingProfiler::stackTracesAsJSON().
JSC::JSValue samplingProfilerStackTracesToJS(JSC::JSGlobalObject*, WTF::Vector<JSC::SamplingProfiler::StackTrace>&&, WTF::Seconds interval);

} // namespace Bun
