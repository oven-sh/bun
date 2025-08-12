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

        // Convert JSC format to Chrome Trace Event format
        WTF::String chromeTraceJson = convertToChromeTraceEvents(jscJson);

        // Shutdown the profiler
        samplingProfiler->shutdown();

        return chromeTraceJson;
    }

private:
    static WTF::String convertToChromeTraceEvents(const WTF::String& jscJson)
    {
        WTF::StringBuilder builder;

        // Start the trace event JSON object
        builder.append("{\n  \"traceEvents\": [\n"_s);

        // Add metadata events
        builder.append("    {\"name\": \"process_name\", \"ph\": \"M\", \"pid\": 1, \"ts\": 0, \"args\": {\"name\": \"Bun\"}},\n"_s);
        builder.append("    {\"name\": \"thread_name\", \"ph\": \"M\", \"pid\": 1, \"tid\": 1, \"ts\": 0, \"args\": {\"name\": \"JSCExecutionThread\"}}"_s);

        if (!jscJson.isEmpty()) {
            // Simple approach: split the JSON into trace objects using pattern matching
            // Look for timestamp and frame name patterns

            WTF::Vector<WTF::String> traces;
            auto currentPos = 0u;

            while (true) {
                auto timestampPos = jscJson.find("\"timestamp\":"_s, currentPos);
                if (timestampPos == WTF::notFound) break;

                // Find the timestamp value
                auto timestampStart = timestampPos + 12;
                auto timestampEnd = jscJson.find(","_s, timestampStart);
                if (timestampEnd == WTF::notFound) break;

                auto timestampStr = jscJson.substring(timestampStart, timestampEnd - timestampStart);
                double timestampSeconds = timestampStr.toDouble();
                long long timestampMicros = static_cast<long long>(timestampSeconds * 1000000.0);

                // Find frames in this trace
                auto framesPos = jscJson.find("\"frames\":["_s, timestampPos);
                if (framesPos != WTF::notFound) {
                    WTF::Vector<WTF::String> frameNames;
                    auto frameSearchStart = framesPos + 10;

                    // Find all function names in this frames array
                    while (true) {
                        auto namePos = jscJson.find("\"name\":\""_s, frameSearchStart);
                        if (namePos == WTF::notFound) break;

                        // Check if this name is still within the current frames array
                        auto nextFramesPos = jscJson.find("\"frames\":["_s, frameSearchStart);
                        if (nextFramesPos != WTF::notFound && namePos > nextFramesPos) break;

                        auto nameStart = namePos + 8;
                        auto nameEnd = jscJson.find("\""_s, nameStart);
                        if (nameEnd == WTF::notFound) break;

                        auto functionName = jscJson.substring(nameStart, nameEnd - nameStart);
                        frameNames.append(functionName);

                        frameSearchStart = nameEnd + 1;
                    }

                    // Create Chrome trace event
                    builder.append(",\n    {\"name\": \"sample\", \"ph\": \"P\", \"cat\": \"bun\", \"pid\": 1, \"tid\": 1, \"ts\": "_s);
                    builder.append(WTF::String::number(timestampMicros));

                    // Add stack trace if we have frame names
                    if (!frameNames.isEmpty()) {
                        builder.append(", \"stack\": ["_s);
                        for (size_t i = 0; i < frameNames.size(); i++) {
                            if (i > 0) builder.append(", "_s);
                            builder.append("\""_s);
                            builder.append(frameNames[i]);
                            builder.append("\""_s);
                        }
                        builder.append("]"_s);
                    }

                    builder.append("}"_s);
                }

                currentPos = timestampEnd + 1;
            }
        }

        builder.append("\n  ]\n}"_s);
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
