#pragma once

#include "root.h"
#include <optional>
#include <utility>
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

// What V8 samples as "(idle)" and "(program)". JSC::SamplingProfiler takes no samples unless the VM is entered.
class UnsampledTime {
public:
    // https://github.com/nodejs/node/blob/v26.12.1/deps/v8/src/profiler/symbolizer.cc#L25-L45
    enum class Kind : uint8_t {
        Idle,
        Program,
    };
    static constexpr size_t kindCount = std::to_underlying(Kind::Program) + 1;
    static constexpr ASCIILiteral functionName(Kind kind) { return kind == Kind::Idle ? "(idle)"_s : "(program)"_s; }

    static void startRecording(JSC::VM&, Seconds samplingInterval);
    static void stopRecording(JSC::VM&);
    // Hands over what was recorded so far, like SamplingProfiler::releaseStackTraces(). `sampleTimes` is sorted.
    static UnsampledTime release(JSC::VM&, MonotonicTime profileStart, MonotonicTime profileEnd, const Vector<MonotonicTime>& sampleTimes);

    MonotonicTime profileEnd() const { return m_profileEnd; }
    Seconds idle() const { return m_idle; }
    Seconds program() const { return m_programBeforeLastWait.duration + m_programAfterLastWait.duration; }
    size_t sampleCount() const { return m_idleSampleCount + m_programBeforeLastWait.count + m_programAfterLastWait.count; }

    // Since the previous sample. One past the last index: after the last sample.
    Seconds before(size_t sampleIndex) const { return m_gaps[sampleIndex].idle + (isLastGap(sampleIndex) ? program() : 0_s); }

    template<typename Functor>
    void forEachSampleBefore(size_t sampleIndex, const Functor& functor) const
    {
        if (isLastGap(sampleIndex))
            m_programBeforeLastWait.forEach(Kind::Program, functor);
        m_gaps[sampleIndex].idleSamples.forEach(Kind::Idle, functor);
        if (isLastGap(sampleIndex))
            m_programAfterLastWait.forEach(Kind::Program, functor);
    }

private:
    struct Samples {
        MonotonicTime end;
        Seconds duration;
        size_t count { 0 };

        template<typename Functor>
        void forEach(Kind kind, const Functor& functor) const
        {
            for (size_t remaining = count; remaining; remaining--)
                functor(kind, end - duration * (static_cast<double>(remaining) / count));
        }
    };

    struct Gap {
        MonotonicTime end;
        Seconds idle;
        Samples idleSamples {};
    };

    bool isLastGap(size_t index) const { return index == m_gaps.size() - 1; }
    void placeSamples(MonotonicTime profileStart, Seconds samplingInterval, bool wasStoppedByScript);

    Vector<Gap> m_gaps;
    MonotonicTime m_profileEnd;
    Seconds m_idle;
    size_t m_idleSampleCount { 0 };
    Samples m_programBeforeLastWait;
    Samples m_programAfterLastWait;
};

// Only the time inside a poll that may block. Node also counts native code after any callback, so a setImmediate() loop is mostly idle: https://github.com/nodejs/node/blob/v26.12.1/src/api/callback.cc#L156
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
    friend class UnsampledTime;

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
