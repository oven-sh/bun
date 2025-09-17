#include "config.h"
#include "Profiler.h"

#include "Event.h"
#include "EventNames.h"
#include "JSDOMPromiseDeferred.h"
#include "JSProfilerTrace.h"
#include "ScriptExecutionContext.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/SamplingProfiler.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/JSLock.h>
#include <wtf/Lock.h>
#include <wtf/Locker.h>
#include <wtf/TZoneMallocInlines.h>
#include <wtf/Stopwatch.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/JSONValues.h>

namespace WebCore {

WTF_MAKE_TZONE_ALLOCATED_IMPL(Profiler);

ExceptionOr<Ref<Profiler>> Profiler::create(ScriptExecutionContext& context, ProfilerInitOptions&& options)
{
    if (options.sampleInterval < 0)
        return Exception { RangeError, "sampleInterval must be non-negative"_s };

    // In a browser, we'd check document policy for js-profiling here
    // For Bun, we can skip this check

    auto profiler = adoptRef(*new Profiler(context, options.sampleInterval, options.maxBufferSize));
    profiler->startSampling();
    return profiler;
}

Profiler::Profiler(ScriptExecutionContext& context, double sampleInterval, unsigned maxBufferSize)
    : ContextDestructionObserver(&context)
    , m_sampleInterval(sampleInterval)
    , m_maxBufferSize(maxBufferSize)
    , m_stopwatch(Stopwatch::create())
{
    m_startTime = MonotonicTime::now();
}

Profiler::~Profiler()
{
    if (m_state != State::Stopped)
        stopSampling();
}

void Profiler::startSampling()
{
    auto* context = scriptExecutionContext();
    if (!context)
        return;

    auto& vm = context->vm();

    // Ensure the sampling profiler exists
    auto& samplingProfiler = vm.ensureSamplingProfiler(m_stopwatch.copyRef());
    m_samplingProfiler = &samplingProfiler;

    // Set the sampling interval (convert from milliseconds to microseconds)
    samplingProfiler.setTimingInterval(Seconds::fromMilliseconds(m_sampleInterval));

    // Start profiling
    samplingProfiler.noticeCurrentThreadAsJSCExecutionThread();
    samplingProfiler.start();

    m_state = State::Started;
}

void Profiler::stopSampling()
{
    if (!m_samplingProfiler || m_state == State::Stopped)
        return;

    auto* context = scriptExecutionContext();
    if (!context)
        return;

    // Pause the profiler
    {
        Locker locker { m_samplingProfiler->getLock() };
        m_samplingProfiler->pause();
    }

    m_state = State::Stopped;
}

ProfilerTrace Profiler::collectTrace()
{
    ProfilerTrace trace;

    if (!m_samplingProfiler)
        return trace;

    auto* context = scriptExecutionContext();
    if (!context)
        return trace;

    auto& vm = context->vm();
    JSC::JSLockHolder lock(vm);

    // Use the JSON export which is safer than accessing raw stack frames
    Ref<JSON::Value> json = m_samplingProfiler->stackTracesAsJSON();

    // Get the first timestamp to calculate relative times
    double firstTimestamp = -1;

    // Debug output disabled - uncomment to see JSON structure
    // auto jsonString = json->toJSONString();
    // WTFLogAlways("Profiler JSON: %s", jsonString.utf8().data());

    // Parse the JSON to extract profiling data
    RefPtr<JSON::Object> rootObject = json->asObject();
    if (!rootObject) {
        WTFLogAlways("Failed to get root object from JSON");
        return trace;
    }

    // Get the traces array - JSC returns "traces" not "samples"
    RefPtr<JSON::Array> tracesArray = rootObject->getArray("traces"_s);
    if (!tracesArray) {
        WTFLogAlways("Failed to find traces array in JSON");
        return trace;
    }

    // Process resources, frames, and stacks from the JSON
    HashMap<String, uint64_t> resourceMap;
    HashMap<String, uint64_t> frameMap;
    HashMap<String, uint64_t> stackMap;

    // Process each trace
    for (size_t i = 0; i < tracesArray->length(); ++i) {
        RefPtr<JSON::Object> traceObject = tracesArray->get(i)->asObject();
        if (!traceObject)
            continue;

        ProfilerSample sample;

        // Get timestamp (JSC returns seconds) and convert to relative milliseconds
        auto timestampOpt = traceObject->getDouble("timestamp"_s);
        if (timestampOpt) {
            if (firstTimestamp < 0)
                firstTimestamp = *timestampOpt;
            // Convert from seconds to milliseconds
            sample.timestamp = (*timestampOpt - firstTimestamp) * 1000.0;
        }

        // Get the frames array
        RefPtr<JSON::Array> framesArray = traceObject->getArray("frames"_s);
        if (framesArray && framesArray->length() > 0) {
            std::optional<uint64_t> parentStackId;

            // Process frames from innermost to outermost
            for (size_t j = framesArray->length(); j > 0; --j) {
                RefPtr<JSON::Object> frameObject = framesArray->get(j - 1)->asObject();
                if (!frameObject)
                    continue;

                // Extract frame information
                String functionName = frameObject->getString("name"_s);
                if (functionName.isNull() || functionName.isEmpty())
                    functionName = "(anonymous)"_s;

                String sourceURL = frameObject->getString("sourceURL"_s);

                auto lineOpt = frameObject->getInteger("lineNumber"_s);
                int lineNumber = lineOpt ? *lineOpt : 0;

                auto colOpt = frameObject->getInteger("columnNumber"_s);
                int columnNumber = colOpt ? *colOpt : 0;

                // Create frame key
                StringBuilder frameKeyBuilder;
                frameKeyBuilder.append(functionName);
                if (lineNumber > 0) {
                    frameKeyBuilder.append(":"_s);
                    frameKeyBuilder.append(String::number(lineNumber));
                    frameKeyBuilder.append(":"_s);
                    frameKeyBuilder.append(String::number(columnNumber));
                }
                String frameKey = frameKeyBuilder.toString();

                // Find or create resource
                std::optional<uint64_t> resourceId;
                if (!sourceURL.isEmpty()) {
                    auto resourceIt = resourceMap.find(sourceURL);
                    if (resourceIt == resourceMap.end()) {
                        resourceId = trace.resources.size();
                        resourceMap.set(sourceURL, resourceId.value());
                        trace.resources.append(sourceURL);
                    } else {
                        resourceId = resourceIt->value;
                    }
                }

                // Find or create frame
                auto frameIt = frameMap.find(frameKey);
                uint64_t frameId;
                if (frameIt == frameMap.end()) {
                    frameId = trace.frames.size();
                    frameMap.set(frameKey, frameId);

                    ProfilerFrame profilerFrame;
                    profilerFrame.name = functionName;
                    profilerFrame.resourceId = resourceId;
                    if (lineNumber > 0) {
                        profilerFrame.line = lineNumber;
                        profilerFrame.column = columnNumber;
                    }
                    trace.frames.append(profilerFrame);
                } else {
                    frameId = frameIt->value;
                }

                // Create stack entry
                StringBuilder stackKeyBuilder;
                stackKeyBuilder.append(String::number(frameId));
                stackKeyBuilder.append(":"_s);
                stackKeyBuilder.append(parentStackId ? String::number(parentStackId.value()) : "null"_s);
                String stackKey = stackKeyBuilder.toString();

                auto stackIt = stackMap.find(stackKey);
                uint64_t stackId;
                if (stackIt == stackMap.end()) {
                    stackId = trace.stacks.size();
                    stackMap.set(stackKey, stackId);

                    ProfilerStack stack;
                    stack.frameId = frameId;
                    stack.parentId = parentStackId;
                    trace.stacks.append(stack);
                } else {
                    stackId = stackIt->value;
                }

                parentStackId = stackId;
            }

            sample.stackId = parentStackId.value_or(0);
        } else {
            sample.stackId = 0;
        }

        trace.samples.append(sample);
    }

    // Ensure we have at least one frame if we have samples
    if (!trace.samples.isEmpty() && trace.frames.isEmpty()) {
        ProfilerFrame frame;
        frame.name = "(profiled code)"_s;
        trace.frames.append(frame);

        ProfilerStack stack;
        stack.frameId = 0;
        trace.stacks.append(stack);
    }

    return trace;
}

void Profiler::processSamplingProfilerTrace(JSC::SamplingProfiler::StackTrace& stackTrace, ProfilerTrace& profilerTrace)
{
    auto* context = scriptExecutionContext();
    if (!context)
        return;

    auto& vm = context->vm();

    // Create a sample
    ProfilerSample sample;
    sample.timestamp = (stackTrace.timestamp - m_startTime).milliseconds();

    // Process the stack frames
    if (!stackTrace.frames.isEmpty()) {
        Vector<uint64_t> frameIds;

        for (auto& frame : stackTrace.frames) {
            ProfilerFrame profilerFrame;

            // Get function name
            profilerFrame.name = frame.displayName(vm);
            if (profilerFrame.name.isEmpty())
                profilerFrame.name = "(anonymous)"_s;

            // Get source location
            String url = frame.url();
            if (!url.isEmpty()) {
                // Find or add resource
                auto resourceIndex = profilerTrace.resources.find(url);
                if (resourceIndex == notFound) {
                    profilerTrace.resources.append(url);
                    resourceIndex = profilerTrace.resources.size() - 1;
                }
                profilerFrame.resourceId = static_cast<uint64_t>(resourceIndex);

                // Get line and column if available
                if (frame.hasExpressionInfo()) {
                    profilerFrame.line = frame.lineNumber();
                    profilerFrame.column = frame.columnNumber();
                }
            }

            // Find or add frame
            uint64_t frameId = profilerTrace.frames.size();
            bool foundExisting = false;
            for (size_t i = 0; i < profilerTrace.frames.size(); ++i) {
                auto& existingFrame = profilerTrace.frames[i];
                if (existingFrame.name == profilerFrame.name
                    && existingFrame.resourceId == profilerFrame.resourceId
                    && existingFrame.line == profilerFrame.line
                    && existingFrame.column == profilerFrame.column) {
                    frameId = i;
                    foundExisting = true;
                    break;
                }
            }

            if (!foundExisting) {
                profilerTrace.frames.append(profilerFrame);
            }

            frameIds.append(frameId);
        }

        // Build the stack chain
        std::optional<uint64_t> parentId;
        for (auto frameId : frameIds) {
            ProfilerStack stack;
            stack.parentId = parentId;
            stack.frameId = frameId;

            // Find or add stack
            uint64_t stackId = profilerTrace.stacks.size();
            bool foundExisting = false;
            for (size_t i = 0; i < profilerTrace.stacks.size(); ++i) {
                auto& existingStack = profilerTrace.stacks[i];
                if (existingStack.frameId == stack.frameId && existingStack.parentId == stack.parentId) {
                    stackId = i;
                    foundExisting = true;
                    break;
                }
            }

            if (!foundExisting) {
                profilerTrace.stacks.append(stack);
            }

            parentId = stackId;
        }

        sample.stackId = parentId;
    }

    // Check buffer size limit
    if (profilerTrace.samples.size() >= m_maxBufferSize) {
        // Fire samplebufferfull event
        dispatchEvent(Event::create(eventNames().errorEvent, Event::CanBubble::No, Event::IsCancelable::No));
        m_state = State::Stopped;
        return;
    }

    profilerTrace.samples.append(sample);
}

void Profiler::stop(Ref<DeferredPromise>&& promise)
{
    if (m_state == State::Stopped) {
        promise->reject(Exception { InvalidStateError, "Profiler is already stopped"_s });
        return;
    }

    stopSampling();

    // Collect the trace
    ProfilerTrace trace = collectTrace();

    // Resolve the promise with the trace
    promise->resolve<IDLDictionary<ProfilerTrace>>(trace);
}

ScriptExecutionContext* Profiler::scriptExecutionContext() const
{
    return ContextDestructionObserver::scriptExecutionContext();
}

void Profiler::contextDestroyed()
{
    if (m_state != State::Stopped)
        stopSampling();
    ContextDestructionObserver::contextDestroyed();
}

} // namespace WebCore
