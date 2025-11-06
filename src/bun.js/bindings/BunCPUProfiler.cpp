#include "root.h"
#include "BunCPUProfiler.h"
#include "ZigGlobalObject.h"
#include "helpers.h"
#include "BunString.h"
#include <JavaScriptCore/SamplingProfiler.h>
#include <JavaScriptCore/VM.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/ScriptExecutable.h>
#include <JavaScriptCore/SourceProvider.h>
#include <wtf/Stopwatch.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/JSONValues.h>
#include <wtf/HashMap.h>
#include <wtf/HashSet.h>
#include <wtf/URL.h>
#include <algorithm>

extern "C" void Bun__startCPUProfiler(JSC::VM* vm);
extern "C" BunString Bun__stopCPUProfilerAndGetJSON(JSC::VM* vm);

namespace Bun {

// Store the profiling start time in microseconds since Unix epoch
static double s_profilingStartTime = 0.0;

void startCPUProfiler(JSC::VM& vm)
{
    // Capture the wall clock time when profiling starts (before creating stopwatch)
    // This will be used as the profile's startTime
    s_profilingStartTime = MonotonicTime::now().approximateWallTime().secondsSinceEpoch().value() * 1000000.0;

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
    int scriptId;
    int lineNumber;
    int columnNumber;
    int hitCount;
    WTF::Vector<int> children;
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

    // releaseStackTraces() calls processUnverifiedStackTraces() internally
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
    rootNode.scriptId = 0;
    rootNode.lineNumber = -1;
    rootNode.columnNumber = -1;
    rootNode.hitCount = 0;
    nodes.append(WTFMove(rootNode));

    int nextNodeId = 2;
    WTF::Vector<int> samples;
    WTF::Vector<long long> timeDeltas;

    // Create an index array to process stack traces in chronological order
    // We can't sort stackTraces directly because StackTrace has deleted copy assignment
    WTF::Vector<size_t> sortedIndices;
    sortedIndices.reserveInitialCapacity(stackTraces.size());
    for (size_t i = 0; i < stackTraces.size(); i++) {
        sortedIndices.append(i);
    }

    // Sort indices by monotonic timestamp to ensure chronological order
    // Use timestamp instead of stopwatchTimestamp for better resolution
    // This is critical for calculating correct timeDeltas between samples
    std::sort(sortedIndices.begin(), sortedIndices.end(), [&stackTraces](size_t a, size_t b) {
        return stackTraces[a].timestamp < stackTraces[b].timestamp;
    });

    // Use the profiling start time that was captured when profiling began
    // This ensures the first timeDelta represents the time from profiling start to first sample
    double startTime = s_profilingStartTime;
    double lastTime = s_profilingStartTime;

    // Process each stack trace in chronological order
    for (size_t idx : sortedIndices) {
        auto& stackTrace = stackTraces[idx];
        if (stackTrace.frames.isEmpty()) {
            samples.append(1); // Root node
            // Use monotonic timestamp converted to wall clock time
            double currentTime = stackTrace.timestamp.approximateWallTime().secondsSinceEpoch().value() * 1000000.0;
            double delta = std::max(0.0, currentTime - lastTime);
            timeDeltas.append(static_cast<long long>(delta));
            lastTime = currentTime;
            continue;
        }

        int currentParentId = 1; // Start from root

        // Process frames from bottom to top (reverse order for Chrome format)
        for (int i = stackTrace.frames.size() - 1; i >= 0; i--) {
            auto& frame = stackTrace.frames[i];

            WTF::String functionName;
            WTF::String url;
            int scriptId = 0;
            int lineNumber = -1;
            int columnNumber = -1;

            // Get function name - displayName works for all frame types
            functionName = frame.displayName(vm);

            if (frame.frameType == JSC::SamplingProfiler::FrameType::Executable && frame.executable) {
                auto sourceProviderAndID = frame.sourceProviderAndID();
                auto* provider = std::get<0>(sourceProviderAndID);
                if (provider) {
                    url = provider->sourceURL();
                    scriptId = static_cast<int>(provider->asID());

                    // Convert absolute paths to file:// URLs
                    // Check for:
                    // - Unix absolute path: /path/to/file
                    // - Windows drive letter: C:\path or C:/path
                    // - Windows UNC path: \\server\share
                    bool isAbsolutePath = false;
                    if (!url.isEmpty()) {
                        if (url[0] == '/') {
                            // Unix absolute path
                            isAbsolutePath = true;
                        } else if (url.length() >= 2 && url[1] == ':') {
                            // Windows drive letter (e.g., C:\)
                            char firstChar = url[0];
                            if ((firstChar >= 'A' && firstChar <= 'Z') || (firstChar >= 'a' && firstChar <= 'z')) {
                                isAbsolutePath = true;
                            }
                        } else if (url.length() >= 2 && url[0] == '\\' && url[1] == '\\') {
                            // Windows UNC path (e.g., \\server\share)
                            isAbsolutePath = true;
                        }
                    }

                    if (isAbsolutePath) {
                        url = WTF::URL::fileURLWithFileSystemPath(url).string();
                    }
                }

                if (frame.hasExpressionInfo()) {
                    // Apply sourcemap if available
                    JSC::LineColumn sourceMappedLineColumn = frame.semanticLocation.lineColumn;
                    if (provider) {
#if USE(BUN_JSC_ADDITIONS)
                        auto& fn = vm.computeLineColumnWithSourcemap();
                        if (fn) {
                            fn(vm, provider, sourceMappedLineColumn);
                        }
#endif
                    }
                    lineNumber = static_cast<int>(sourceMappedLineColumn.line);
                    columnNumber = static_cast<int>(sourceMappedLineColumn.column);
                }
            }

            // Create a unique key for this frame based on parent + callFrame
            // This creates separate nodes for the same function in different call paths
            WTF::StringBuilder keyBuilder;
            keyBuilder.append(currentParentId);
            keyBuilder.append(':');
            keyBuilder.append(functionName);
            keyBuilder.append(':');
            keyBuilder.append(url);
            keyBuilder.append(':');
            keyBuilder.append(scriptId);
            keyBuilder.append(':');
            keyBuilder.append(lineNumber);
            keyBuilder.append(':');
            keyBuilder.append(columnNumber);

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
                node.scriptId = scriptId;
                node.lineNumber = lineNumber;
                node.columnNumber = columnNumber;
                node.hitCount = 0;

                nodes.append(WTFMove(node));

                // Add this node as child of parent
                if (currentParentId > 0) {
                    nodes[currentParentId - 1].children.append(nodeId);
                }
            } else {
                // Node already exists with this parent+callFrame combination
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
        // Use monotonic timestamp converted to wall clock time
        double currentTime = stackTrace.timestamp.approximateWallTime().secondsSinceEpoch().value() * 1000000.0;
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
        callFrame->setString("scriptId"_s, WTF::String::number(node.scriptId));
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

    // Add timing info in microseconds
    // Note: Using setDouble() instead of setInteger() because setInteger() has precision
    // issues with large values (> 2^31). Chrome DevTools expects microseconds since Unix epoch,
    // which are typically 16-digit numbers. JSON numbers can represent these precisely.
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
