#pragma once

#include "root.h"
#include <optional>
#include <wtf/MonotonicTime.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

#if OS(WINDOWS)
#include <uv.h>
#endif

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

// What V8 samples as "(idle)". JSC::SamplingProfiler takes no samples unless the VM is entered.
class IdleTime {
public:
    static constexpr ASCIILiteral functionName = "(idle)"_s;

    static void startRecording(JSC::VM&, Seconds samplingInterval);
    static void stopRecording(JSC::VM&);
    // Hands over what was recorded so far, like SamplingProfiler::releaseStackTraces(). `sampleTimes` is sorted.
    static IdleTime release(JSC::VM&, MonotonicTime profileStart, const Vector<MonotonicTime>& sampleTimes);

    Seconds total() const { return m_total; }
    size_t sampleCount() const { return m_sampleCount; }
    // The last sample or the end of the last wait.
    MonotonicTime profileEnd() const { return m_gaps.last().end; }

    // Since the previous sample.
    Seconds before(size_t sampleIndex) const { return m_gaps[sampleIndex].idle; }

    // One past the last index: after the last sample.
    template<typename Functor>
    void forEachSampleBefore(size_t sampleIndex, const Functor& functor) const
    {
        const Gap& gap = m_gaps[sampleIndex];
        for (size_t remaining = gap.sampleCount; remaining; remaining--)
            functor(gap.end - gap.sampledTime * (static_cast<double>(remaining) / gap.sampleCount));
    }

    // For (root), so that what went on between the last sample and the last wait is not billed to that sample.
    template<typename Functor>
    void forEachUnattributedSample(const Functor& functor) const
    {
        for (size_t i = 1; i < m_unattributed.partCount; i++)
            functor(m_unattributed.begin + m_unattributed.duration * (static_cast<double>(i) / m_unattributed.partCount));
    }

private:
    struct Gap {
        MonotonicTime end;
        Seconds idle;
        Seconds sampledTime {};
        size_t sampleCount { 0 };
    };

    void placeSamples(MonotonicTime profileStart, Seconds samplingInterval);

    Vector<Gap> m_gaps;
    Seconds m_total;
    size_t m_sampleCount { 0 };
    struct {
        MonotonicTime begin;
        Seconds duration;
        size_t partCount { 0 };
    } m_unattributed;
};

class IdleTimeRecorder {
    WTF_MAKE_NONCOPYABLE(IdleTimeRecorder);
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(IdleTimeRecorder);

public:
    IdleTimeRecorder() = default;

#if OS(WINDOWS)
    void willWait(uv_loop_t*);
#else
    void willWait();
#endif
    void didWait();

private:
    friend class IdleTime;

    // One wait, or several that fit in one sampling interval.
    struct Span {
        MonotonicTime begin;
        MonotonicTime end;
        Seconds idle;
    };

    Seconds m_samplingInterval;
    Vector<Span> m_spans;
    std::optional<MonotonicTime> m_waitBegin;
#if OS(WINDOWS)
    uv_loop_t* m_loop { nullptr };
    uint64_t m_loopIdleNanosecondsBeforeWait { 0 };
#endif
};

} // namespace Bun
