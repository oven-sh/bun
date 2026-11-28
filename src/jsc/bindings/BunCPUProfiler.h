#pragma once

#include "root.h"
#include <JavaScriptCore/SamplingProfiler.h>
#include <limits>
#include <utility>
#include <wtf/WallTime.h>
#include <wtf/text/WTFString.h>

namespace JSC {
class JSGlobalObject;
class VM;
}

namespace Bun {

// https://github.com/nodejs/node/blob/v26.12.1/deps/v8/src/profiler/profile-generator.h#L597
static constexpr size_t maximumSimultaneousCPUProfiles = 100;

static constexpr uint32_t noCPUProfileSampleLimit = std::numeric_limits<uint32_t>::max();

// Returns what to pass to stopCPUProfiler(). Never 0.
uint32_t startCPUProfiler(JSC::VM&, uint32_t intervalMicroseconds, uint32_t sampleLimit = noCPUProfileSampleLimit);

// Returns JSON, or a null string if there is no such profile.
WTF::String stopCPUProfiler(JSC::VM&, uint32_t id);

// The samples in the order of time. GC has to stay deferred: nothing marks the cells of its stack traces.
class SampleTimeline {
public:
    using StackTrace = JSC::SamplingProfiler::StackTrace;
    using ThreadState = JSC::SamplingProfiler::ThreadState;
    static constexpr size_t stateCount = std::to_underlying(ThreadState::GarbageCollector) + 1;

    // One sample with a `stackTrace`, or else any number of samples in `state`.
    struct Run {
        StackTrace* stackTrace;
        ThreadState state;
        MonotonicTime first;
        MonotonicTime last;
        size_t count;
        MonotonicTime end; // A sample lasts until the next one.
    };

    static ASCIILiteral functionName(ThreadState);
    static WTF::String functionName(JSC::VM&, JSC::SamplingProfiler::StackFrame&);

    SampleTimeline(JSC::SamplingProfiler::Samples&&, MonotonicTime end);

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

// Samples from its construction on, whatever other profiles do.
class RunningCPUProfile {
    WTF_MAKE_NONCOPYABLE(RunningCPUProfile);
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(RunningCPUProfile);

public:
    // 0 is the default interval.
    RunningCPUProfile(JSC::VM&, uint32_t intervalMicroseconds, uint32_t sampleLimit = noCPUProfileSampleLimit);
    ~RunningCPUProfile();

    MonotonicTime startTime() const { return m_startTime; }
    WallTime startWallTime() const { return m_startWallTime; }
    uint32_t intervalMicroseconds() const { return m_intervalMicroseconds; }
    // How many samples to list. Like in V8, the hit counts have all of them.
    uint32_t sampleLimit() const { return m_sampleLimit; }
    SampleTimeline stop();

private:
    MonotonicTime m_startTime { MonotonicTime::now() };
    WallTime m_startWallTime { WallTime::now() };
    uint32_t m_intervalMicroseconds;
    uint32_t m_sampleLimit;
    Ref<JSC::SamplingProfiler> m_sampler;
};

} // namespace Bun
