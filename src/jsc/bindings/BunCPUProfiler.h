#pragma once

#include "root.h"
#include <JavaScriptCore/SamplingProfiler.h>
#include <utility>
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

void startSampling(JSC::VM&, Seconds samplingInterval);
void stopSampling(JSC::SamplingProfiler& profiler) WTF_REQUIRES_LOCK(profiler.getLock());

// Takes the samples since `start`, in the order of time. GC has to stay deferred: nothing marks the cells of its stack traces.
class SampleTimeline {
public:
    using StackTrace = JSC::SamplingProfiler::StackTrace;
    using ThreadState = JSC::SamplingProfiler::ThreadState;
    static constexpr size_t stateCount = std::to_underlying(ThreadState::JavaScript) + 1;

    // Samples with the same leaf node: the top frame of `stackTrace`, or else the child of the root for `state`.
    struct Run {
        StackTrace* stackTrace;
        ThreadState state;
        MonotonicTime first;
        MonotonicTime last;
        size_t count;
        MonotonicTime end; // A sample lasts until the next one.
    };

    static ASCIILiteral functionName(ThreadState);

    enum class Sampler : bool { Keep,
        Stop };
    SampleTimeline(JSC::SamplingProfiler&, Sampler, MonotonicTime start);

    bool isEmpty() const { return m_runs.isEmpty(); }
    MonotonicTime end() const { return m_end; }
    const Vector<Run>& runs() const LIFETIME_BOUND { return m_runs; }

    // All `count` of them, unless the profile is very long.
    template<typename Functor>
    void forEachTimestamp(const Run& run, const Functor& functor) const
    {
        size_t lastIndex = (run.count - 1) / m_samplesPerTimestamp;
        for (size_t i = 0; i < lastIndex; i++)
            functor(run.first + (run.last - run.first) * (static_cast<double>(i) / lastIndex));
        functor(lastIndex ? run.last : run.first);
    }

private:
    Vector<StackTrace> m_stackTraces;
    Vector<Run> m_runs;
    MonotonicTime m_end;
    size_t m_samplesPerTimestamp { 1 };
};

} // namespace Bun
