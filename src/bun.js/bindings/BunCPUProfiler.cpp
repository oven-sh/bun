#include "BunCPUProfiler.h"
#include "ZigGlobalObject.h"
#include "helpers.h"
#include "BunString.h"
#include <JavaScriptCore/SamplingProfiler.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ScriptExecutable.h>
#include <JavaScriptCore/SourceProvider.h>
#include <JavaScriptCore/HeapIterationScope.h>
#include <wtf/Stopwatch.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/JSONValues.h>
#include <wtf/HashMap.h>

extern "C" void Bun__startCPUProfiler(JSC::VM* vm);
extern "C" BunString Bun__stopCPUProfilerAndGetJSON(JSC::VM* vm);

namespace Bun {

void startCPUProfiler(JSC::VM& vm)
{
    // Create a stopwatch and start it
    auto stopwatch = WTF::Stopwatch::create();
    stopwatch->start();

    JSC::SamplingProfiler& samplingProfiler = vm.ensureSamplingProfiler(WTFMove(stopwatch));

    // Set sampling interval to 1ms (1000 microseconds) to match Node.js
    samplingProfiler.setTimingInterval(WTF::Seconds::fromMicroseconds(1000));

    samplingProfiler.noticeCurrentThreadAsJSCExecutionThread();
    samplingProfiler.start();
}

struct ProfileNode {
    int id;
    WTF::String functionName;
    WTF::String url;
    int lineNumber;
    int columnNumber;
    int hitCount;
    WTF::Vector<int> children;
    WTF::HashMap<WTF::String, int> positionTicks;
};

WTF::String stopCPUProfilerAndGetJSON(JSC::VM& vm)
{
    JSC::SamplingProfiler* profiler = vm.samplingProfiler();
    if (!profiler)
        return WTF::String();

    // Shut down the profiler thread first - this is critical!
    profiler->shutdown();

    // Need to hold the VM lock to safely access stack traces
    JSC::JSLockHolder locker(vm);

    // Defer GC while we're working with stack traces
    JSC::DeferGC deferGC(vm);

    auto& lock = profiler->getLock();
    WTF::Locker profilerLocker { lock };

    // Process stack traces within a heap iteration scope to safely access JSCells
    {
        JSC::HeapIterationScope heapIterationScope(vm.heap);
        profiler->processUnverifiedStackTraces();
    }

    auto stackTraces = profiler->releaseStackTraces();

    if (stackTraces.isEmpty())
        return WTF::String();

    // Build Chrome CPU Profiler format
    // Map from stack frame signature to node ID
    WTF::HashMap<WTF::String, int> nodeMap;
    WTF::Vector<ProfileNode> nodes;

    // Create root node
    ProfileNode rootNode;
    rootNode.id = 1;
    rootNode.functionName = "(root)"_s;
    rootNode.url = ""_s;
    rootNode.lineNumber = -1;
    rootNode.columnNumber = -1;
    rootNode.hitCount = 0;
    nodes.append(WTFMove(rootNode));

    int nextNodeId = 2;
    WTF::Vector<int> samples;
    WTF::Vector<long long> timeDeltas;

    // Get the wall clock time for the first sample
    // We use approximateWallTime to convert MonotonicTime to wall clock time
    double wallClockStart = stackTraces[0].timestamp.approximateWallTime().secondsSinceEpoch().value() * 1000000.0;

    // The stopwatchTimestamp for the first sample (elapsed time from profiler start)
    double stopwatchStart = stackTraces[0].stopwatchTimestamp.seconds() * 1000000.0;

    // Calculate the offset to convert stopwatch times to wall clock times
    // startTime will be the wall clock time when profiling started
    double startTime = wallClockStart - stopwatchStart;
    // lastTime should also start from the converted first sample time
    double lastTime = startTime + stopwatchStart;

    // Process each stack trace
    for (const auto& stackTrace : stackTraces) {
        if (stackTrace.frames.isEmpty()) {
            samples.append(1); // Root node
            // Convert stopwatch time to wall clock time
            double currentTime = startTime + (stackTrace.stopwatchTimestamp.seconds() * 1000000.0);
            double delta = std::max(0.0, currentTime - lastTime);
            timeDeltas.append(static_cast<long long>(delta));
            lastTime = currentTime;
            continue;
        }

        int currentParentId = 1; // Start from root

        // Process frames from bottom to top (reverse order for Chrome format)
        for (int i = stackTrace.frames.size() - 1; i >= 0; i--) {
            const auto& frame = stackTrace.frames[i];

            WTF::String functionName;
            WTF::String url;
            int lineNumber = -1;
            int columnNumber = -1;

            if (frame.frameType == JSC::SamplingProfiler::FrameType::Executable && frame.executable) {
                functionName = const_cast<JSC::SamplingProfiler::StackFrame*>(&frame)->displayName(vm);

                auto sourceProviderAndID = const_cast<JSC::SamplingProfiler::StackFrame*>(&frame)->sourceProviderAndID();
                if (std::get<0>(sourceProviderAndID)) {
                    url = std::get<0>(sourceProviderAndID)->sourceURL();
                }

                if (frame.hasExpressionInfo()) {
                    lineNumber = frame.lineNumber();
                    columnNumber = frame.columnNumber();
                }
            } else if (frame.frameType == JSC::SamplingProfiler::FrameType::Host) {
                functionName = "(native)"_s;
            } else if (frame.frameType == JSC::SamplingProfiler::FrameType::C || frame.frameType == JSC::SamplingProfiler::FrameType::Unknown) {
                functionName = "(program)"_s;
            } else {
                functionName = "(anonymous)"_s;
            }

            // Create a unique key for this frame
            WTF::StringBuilder keyBuilder;
            keyBuilder.append(functionName);
            keyBuilder.append(':');
            keyBuilder.append(url);
            keyBuilder.append(':');
            keyBuilder.append(lineNumber);
            keyBuilder.append(':');
            keyBuilder.append(columnNumber);
            keyBuilder.append(':');
            keyBuilder.append(currentParentId);

            WTF::String key = keyBuilder.toString();

            int nodeId;
            auto it = nodeMap.find(key);
            if (it == nodeMap.end()) {
                // Create new node
                nodeId = nextNodeId++;
                nodeMap.add(key, nodeId);

                ProfileNode node;
                node.id = nodeId;
                node.functionName = functionName;
                node.url = url;
                node.lineNumber = lineNumber;
                node.columnNumber = columnNumber;
                node.hitCount = 0;

                nodes.append(WTFMove(node));

                // Add this node as child of parent
                nodes[currentParentId - 1].children.append(nodeId);
            } else {
                nodeId = it->value;
            }

            currentParentId = nodeId;

            // If this is the top frame, increment hit count
            if (i == 0) {
                nodes[nodeId - 1].hitCount++;
            }
        }

        // Add sample pointing to the top frame
        samples.append(currentParentId);

        // Add time delta
        // Convert stopwatch time to wall clock time
        double currentTime = startTime + (stackTrace.stopwatchTimestamp.seconds() * 1000000.0);
        double delta = std::max(0.0, currentTime - lastTime);
        timeDeltas.append(static_cast<long long>(delta));
        lastTime = currentTime;
    }

    // endTime is the wall clock time of the last sample
    double endTime = lastTime;

    // Build JSON using WTF::JSON
    using namespace WTF;
    auto json = JSON::Object::create();

    // Add nodes array
    auto nodesArray = JSON::Array::create();
    for (const auto& node : nodes) {
        auto nodeObj = JSON::Object::create();
        nodeObj->setInteger("id"_s, node.id);

        auto callFrame = JSON::Object::create();
        callFrame->setString("functionName"_s, node.functionName);
        callFrame->setString("scriptId"_s, "0"_s);
        callFrame->setString("url"_s, node.url);
        callFrame->setInteger("lineNumber"_s, node.lineNumber);
        callFrame->setInteger("columnNumber"_s, node.columnNumber);

        nodeObj->setValue("callFrame"_s, callFrame);
        nodeObj->setInteger("hitCount"_s, node.hitCount);

        if (!node.children.isEmpty()) {
            auto childrenArray = JSON::Array::create();
            WTF::HashSet<int> seenChildren;
            for (int childId : node.children) {
                if (seenChildren.add(childId).isNewEntry) {
                    childrenArray->pushInteger(childId);
                }
            }
            nodeObj->setValue("children"_s, childrenArray);
        }

        nodesArray->pushValue(nodeObj);
    }
    json->setValue("nodes"_s, nodesArray);

    // Add timing info
    json->setDouble("startTime"_s, startTime);
    json->setDouble("endTime"_s, endTime);

    // Add samples array
    auto samplesArray = JSON::Array::create();
    for (int sample : samples) {
        samplesArray->pushInteger(sample);
    }
    json->setValue("samples"_s, samplesArray);

    // Add timeDeltas array
    auto timeDeltasArray = JSON::Array::create();
    for (long long delta : timeDeltas) {
        timeDeltasArray->pushInteger(delta);
    }
    json->setValue("timeDeltas"_s, timeDeltasArray);

    return json->toJSONString();
}

} // namespace Bun

extern "C" void Bun__startCPUProfiler(JSC::VM* vm)
{
    Bun::startCPUProfiler(*vm);
}

extern "C" BunString Bun__stopCPUProfilerAndGetJSON(JSC::VM* vm)
{
    WTF::String result = Bun::stopCPUProfilerAndGetJSON(*vm);
    return Bun::toStringRef(result);
}
