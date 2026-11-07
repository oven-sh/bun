#pragma once

#include "root.h"
#include <JavaScriptCore/SamplingProfiler.h>
#include <wtf/Seconds.h>
#include <wtf/Vector.h>

namespace JSC {
class JSGlobalObject;
}

namespace Bun {

// Sets the sampling interval. Every Bun caller sets the interval through this
// function, because JSC::SamplingProfiler has no getter and the result of
// samplingProfilerStackTraces() reports the interval.
void setSamplingProfilerTimingInterval(JSC::SamplingProfiler&, WTF::Seconds);
// The interval that was last set on this thread's profiler. Before any call to
// setSamplingProfilerTimingInterval() it is JSC's default (Options::sampleInterval).
WTF::Seconds samplingProfilerTimingInterval();

// Takes every sample the profiler has collected so far and clears them from
// the profiler. When `pause` is set the profiler stops sampling first.
//
// The caller must hold the JSLock and a JSC::DeferGC for as long as it reads
// the returned vector: a StackFrame holds raw JSCell pointers that only the
// profiler's live cell set kept alive, and releaseStackTraces() clears that set.
WTF::Vector<JSC::SamplingProfiler::StackTrace> takeSamplingProfilerStackTraces(JSC::SamplingProfiler&, bool pause);

// Builds the `stackTraces` value that bun:jsc's profile() and
// samplingProfilerStackTraces() return: `{ interval, traces, sources }`, with
// the same keys and values as JSC::SamplingProfiler::stackTracesAsJSON(), but
// as JS objects built directly from the samples. The caller must still hold
// the JSC::DeferGC it took for takeSamplingProfilerStackTraces().
JSC::JSValue samplingProfilerStackTracesToJS(JSC::JSGlobalObject*, WTF::Vector<JSC::SamplingProfiler::StackTrace>&&, WTF::Seconds interval);

} // namespace Bun
