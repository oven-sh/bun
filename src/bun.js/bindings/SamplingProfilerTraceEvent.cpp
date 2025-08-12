#include "root.h"

#include <JavaScriptCore/SamplingProfiler.h>
#include <JavaScriptCore/VM.h>
#include <wtf/text/WTFString.h>
#include <wtf/Stopwatch.h>
#include <wtf/text/StringBuilder.h>
#include <cstdlib>
#include <cstring>

#include "BunString.h"

namespace Bun {

class SamplingProfilerTraceEvent {
public:
    static void start(JSC::VM& vm)
    {
        auto& samplingProfiler = vm.ensureSamplingProfiler(WTF::Stopwatch::create());
        samplingProfiler.noticeCurrentThreadAsJSCExecutionThread();
        samplingProfiler.start();
    }

    static WTF::String stop(JSC::VM& vm)
    {
        auto* samplingProfiler = vm.samplingProfiler();
        if (!samplingProfiler) {
            return WTF::String();
        }

        // Get the JSC sampling profiler data as JSON string
        auto stackTraces = samplingProfiler->stackTracesAsJSON();
        if (!stackTraces) {
            return WTF::String();
        }

        WTF::String jscJson = stackTraces->toJSONString();

        // Convert JSC format to Chrome DevTools .cpuprofile format
        WTF::String cpuProfileJson = convertToCpuProfile(jscJson);

        // Shutdown the profiler
        samplingProfiler->shutdown();

        return cpuProfileJson;
    }

private:
    static WTF::String convertToCpuProfile(const WTF::String& jscJson)
    {
        // Parse JSC JSON and convert to Chrome DevTools .cpuprofile format
        WTF::StringBuilder builder;

        // Data structures for building the call tree
        WTF::HashMap<WTF::String, int> nodeIdMap; // Stack signature -> node ID
        WTF::Vector<WTF::String> nodes; // JSON representations of nodes
        WTF::Vector<int> samples;
        WTF::Vector<long long> timeDeltas;

        int nextNodeId = 1;
        long long startTime = 0;
        long long endTime = 0;
        long long lastTimestamp = 0;

        // Create root node
        nodes.append("{\"id\":1,\"callFrame\":{\"functionName\":\"(root)\",\"scriptId\":\"0\",\"url\":\"\",\"lineNumber\":-1,\"columnNumber\":-1},\"hitCount\":0,\"children\":[]}"_s);
        nodeIdMap.set("(root)"_s, 1);
        nextNodeId = 2;

        if (!jscJson.isEmpty()) {
            auto currentPos = 0u;

            // Parse each trace sample
            while (true) {
                auto timestampPos = jscJson.find("\"timestamp\":"_s, currentPos);
                if (timestampPos == WTF::notFound) break;

                // Extract timestamp
                auto timestampStart = timestampPos + 12;
                auto timestampEnd = jscJson.find(","_s, timestampStart);
                if (timestampEnd == WTF::notFound) break;

                auto timestampStr = jscJson.substring(timestampStart, timestampEnd - timestampStart);
                double timestampSeconds = timestampStr.toDouble();
                long long timestampMicros = static_cast<long long>(timestampSeconds * 1000000.0);

                if (startTime == 0) {
                    startTime = timestampMicros;
                    lastTimestamp = timestampMicros;
                    timeDeltas.append(0); // First delta is 0
                } else {
                    long long delta = timestampMicros - lastTimestamp;
                    timeDeltas.append(delta);
                    lastTimestamp = timestampMicros;
                }
                endTime = timestampMicros;

                // Extract stack frames
                auto framesPos = jscJson.find("\"frames\":["_s, timestampPos);
                if (framesPos != WTF::notFound) {
                    WTF::Vector<WTF::String> stackFrames;
                    auto frameSearchStart = framesPos + 10;

                    // Parse all frames in this sample
                    while (true) {
                        auto namePos = jscJson.find("\"name\":\""_s, frameSearchStart);
                        if (namePos == WTF::notFound) break;

                        // Check if we've moved to next trace
                        auto nextFramesPos = jscJson.find("\"frames\":["_s, frameSearchStart);
                        if (nextFramesPos != WTF::notFound && namePos > nextFramesPos) break;

                        auto nameStart = namePos + 8;
                        auto nameEnd = jscJson.find("\""_s, nameStart);
                        if (nameEnd == WTF::notFound) break;

                        auto functionName = jscJson.substring(nameStart, nameEnd - nameStart);
                        stackFrames.append(functionName);

                        frameSearchStart = nameEnd + 1;
                    }

                    // Build call tree path and find/create leaf node
                    int leafNodeId = 1; // Start from root
                    WTF::StringBuilder stackPath;
                    stackPath.append("(root)"_s);

                    // Process stack frames in reverse order (root to leaf)
                    for (size_t i = stackFrames.size(); i > 0; i--) {
                        auto functionName = stackFrames[i - 1];
                        stackPath.append("->"_s);
                        stackPath.append(functionName);

                        auto pathKey = stackPath.toString();

                        // Find or create node for this stack path
                        auto it = nodeIdMap.find(pathKey);
                        if (it == nodeIdMap.end()) {
                            // Create new node
                            int nodeId = nextNodeId++;
                            nodeIdMap.set(pathKey, nodeId);

                            // Escape quotes in function name for JSON (simplified)
                            auto escapedName = functionName;

                            WTF::StringBuilder nodeJson;
                            nodeJson.append("{\"id\":"_s);
                            nodeJson.append(WTF::String::number(nodeId));
                            nodeJson.append(",\"callFrame\":{\"functionName\":\""_s);
                            nodeJson.append(escapedName);
                            nodeJson.append("\",\"scriptId\":\"1\",\"url\":\"script\",\"lineNumber\":0,\"columnNumber\":0},\"hitCount\":0,\"children\":[]}"_s);

                            nodes.append(nodeJson.toString());
                            leafNodeId = nodeId;
                        } else {
                            leafNodeId = it->value;
                        }
                    }

                    // Record this sample pointing to the leaf node
                    samples.append(leafNodeId);
                } else {
                    // No frames, point to root
                    samples.append(1);
                }

                currentPos = timestampEnd + 1;
            }
        }

        // Build final .cpuprofile JSON
        builder.append("{"_s);

        // Nodes array
        builder.append("\"nodes\":["_s);
        for (size_t i = 0; i < nodes.size(); i++) {
            if (i > 0) builder.append(","_s);
            builder.append(nodes[i]);
        }
        builder.append("],"_s);

        // Timing info
        builder.append("\"startTime\":"_s);
        builder.append(WTF::String::number(startTime));
        builder.append(",\"endTime\":"_s);
        builder.append(WTF::String::number(endTime));
        builder.append(","_s);

        // Samples array
        builder.append("\"samples\":["_s);
        for (size_t i = 0; i < samples.size(); i++) {
            if (i > 0) builder.append(","_s);
            builder.append(WTF::String::number(samples[i]));
        }
        builder.append("],"_s);

        // Time deltas array
        builder.append("\"timeDeltas\":["_s);
        for (size_t i = 0; i < timeDeltas.size(); i++) {
            if (i > 0) builder.append(","_s);
            builder.append(WTF::String::number(timeDeltas[i]));
        }
        builder.append("]"_s);

        builder.append("}"_s);

        return builder.toString();
    }
};

} // namespace Bun

extern "C" {
void BunSamplingProfilerTraceEvent__start(JSC::VM* vm)
{
    Bun::SamplingProfilerTraceEvent::start(*vm);
}

// Returns the profile data as a UTF8 C string, or nullptr if failed
// Caller is responsible for freeing the string
char* BunSamplingProfilerTraceEvent__stop(JSC::VM* vm)
{
    auto result = Bun::SamplingProfilerTraceEvent::stop(*vm);
    if (result.isEmpty()) {
        return nullptr;
    }

    auto utf8 = result.utf8();
    auto* copy = static_cast<char*>(malloc(utf8.length() + 1));
    if (!copy) {
        return nullptr;
    }

    memcpy(copy, utf8.data(), utf8.length());
    copy[utf8.length()] = '\0';
    return copy;
}
}
