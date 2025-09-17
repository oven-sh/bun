#pragma once

#include "EventTarget.h"
#include "ExceptionOr.h"
#include "ContextDestructionObserver.h"
#include <wtf/RefCounted.h>
#include <JavaScriptCore/SamplingProfiler.h>
#include <wtf/MonotonicTime.h>
#include <wtf/Stopwatch.h>
#include <wtf/text/WTFString.h>

namespace JSC {
class JSPromise;
class JSValue;
class VM;
}

namespace WebCore {

class ScriptExecutionContext;
class DeferredPromise;

struct ProfilerInitOptions {
    double sampleInterval;
    unsigned maxBufferSize;
};

struct ProfilerSample {
    double timestamp;
    std::optional<uint64_t> stackId;
};

struct ProfilerFrame {
    String name;
    std::optional<uint64_t> resourceId;
    std::optional<uint64_t> line;
    std::optional<uint64_t> column;
};

struct ProfilerStack {
    std::optional<uint64_t> parentId;
    uint64_t frameId;
};

struct ProfilerTrace {
    Vector<String> resources;
    Vector<ProfilerFrame> frames;
    Vector<ProfilerStack> stacks;
    Vector<ProfilerSample> samples;
};

class Profiler final : public RefCounted<Profiler>, public EventTargetWithInlineData, public ContextDestructionObserver {
    WTF_MAKE_TZONE_ALLOCATED(Profiler);

public:
    enum class State {
        Started,
        Paused,
        Stopped
    };

    static ExceptionOr<Ref<Profiler>> create(ScriptExecutionContext&, ProfilerInitOptions&&);
    ~Profiler();

    double sampleInterval() const { return m_sampleInterval; }
    bool stopped() const { return m_state == State::Stopped; }

    void stop(Ref<DeferredPromise>&&);

    // EventTarget
    EventTargetInterface eventTargetInterface() const final { return ProfilerEventTargetInterfaceType; }
    ScriptExecutionContext* scriptExecutionContext() const final;
    void refEventTarget() final { ref(); }
    void derefEventTarget() final { deref(); }

    // ContextDestructionObserver
    void contextDestroyed() override;

    using RefCounted::ref;
    using RefCounted::deref;

private:
    Profiler(ScriptExecutionContext&, double sampleInterval, unsigned maxBufferSize);
    void startSampling();
    void stopSampling();
    ProfilerTrace collectTrace();
    void processSamplingProfilerTrace(JSC::SamplingProfiler::StackTrace&, ProfilerTrace&);

    double m_sampleInterval;
    unsigned m_maxBufferSize;
    State m_state { State::Started };
    RefPtr<JSC::SamplingProfiler> m_samplingProfiler;
    Ref<Stopwatch> m_stopwatch;
    MonotonicTime m_startTime;
    RefPtr<DeferredPromise> m_pendingPromise;
};

} // namespace WebCore