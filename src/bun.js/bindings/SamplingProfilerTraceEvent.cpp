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
        // For now, return a simple Chrome trace format with the JSC data embedded
        // This is a simplified version - a full implementation would parse the JSC JSON
        // and convert each sample to Chrome format

        WTF::StringBuilder builder;
        builder.append("{\"traceEvents\":["_s);

        // Add metadata event
        builder.append("{\"name\":\"thread_name\",\"ph\":\"M\",\"pid\":1,\"tid\":1,\"ts\":0,\"args\":{\"name\":\"JSCExecutionThread\"}},"_s);

        // Add a simple instant event with the JSC data
        builder.append("{\"name\":\"SamplingProfilerData\",\"ph\":\"i\",\"cat\":\"JSC\",\"pid\":1,\"tid\":1,\"ts\":1000,\"args\":{\"jscData\":"_s);
        builder.append(jscJson);
        builder.append("}}"_s);

        builder.append("]}"_s);

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
