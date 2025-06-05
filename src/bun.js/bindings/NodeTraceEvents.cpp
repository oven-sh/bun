#include "NodeTraceEvents.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSCInlines.h>
#include <wtf/JSONValues.h>
#include <wtf/FileSystem.h>
#include <wtf/text/StringBuilder.h>
#include <wtf/text/StringView.h>
#include <chrono>
#include <mutex>
#include <unistd.h>
#include <pthread.h>
#include <stdio.h>

namespace Bun {

static std::atomic<uint32_t> s_rotation{1};
static bool s_tracingEnabled = false;
static WTF::String s_categories;
static WTF::String s_filePattern;
static Vector<Ref<JSON::Object>> s_traceEvents;
static std::mutex s_traceEventsMutex;
static uint32_t s_processId = 0;
static uint64_t s_startTime = 0;

void NodeTraceEvents::initialize(const WTF::String& categories, const WTF::String& filePattern)
{
    s_tracingEnabled = true;
    s_categories = categories;
    s_filePattern = filePattern.isEmpty() ? "node_trace.${rotation}.log"_s : filePattern;
    s_processId = static_cast<uint32_t>(getpid());
    s_startTime = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::high_resolution_clock::now().time_since_epoch()
    ).count();
}

bool NodeTraceEvents::isEnabled()
{
    return s_tracingEnabled;
}

bool NodeTraceEvents::isEnabled(const WTF::String& category)
{
    if (!s_tracingEnabled) {
        return false;
    }
    
    // Check if category is in the list
    Vector<String> categories = s_categories.split(',');
    for (const auto& cat : categories) {
        auto trimmed = StringView(cat).trim([](UChar ch) { return isASCIIWhitespace(ch); });
        if (trimmed == category) {
            return true;
        }
    }
    return false;
}

void NodeTraceEvents::emit(const WTF::String& name, const WTF::String& category, JSON::Object* args, uint64_t timestamp)
{
    if (!s_tracingEnabled || !isEnabled(category)) {
        return;
    }

    if (timestamp == 0) {
        timestamp = std::chrono::duration_cast<std::chrono::microseconds>(
            std::chrono::high_resolution_clock::now().time_since_epoch()
        ).count() - s_startTime;
    }

    auto event = JSON::Object::create();
    event->setString("name"_s, name);
    event->setString("cat"_s, category);
    event->setString("ph"_s, "X"_s); // Complete event
    event->setDouble("ts"_s, static_cast<double>(timestamp));
    event->setDouble("dur"_s, 0.0);
    event->setInteger("pid"_s, s_processId);
    event->setInteger("tid"_s, static_cast<int>(pthread_self()));
    
    if (args) {
        // Create a Ref from the raw pointer
        event->setObject("args"_s, Ref { *args });
    }

    {
        std::lock_guard<std::mutex> lock(s_traceEventsMutex);
        s_traceEvents.append(WTFMove(event));
    }
}

void NodeTraceEvents::emitEnvironmentEvent(const WTF::String& name)
{
    emit(name, "node.environment"_s);
}

void NodeTraceEvents::shutdown()
{
    if (!s_tracingEnabled) {
        return;
    }
    
    // Emit final events
    emitEnvironmentEvent("RunCleanup"_s);
    emitEnvironmentEvent("AtExit"_s);
    
    writeTraceFile();
    
    s_tracingEnabled = false;
}

void NodeTraceEvents::writeTraceFile()
{
    std::lock_guard<std::mutex> lock(s_traceEventsMutex);
    
    // Generate filename
    uint32_t rotation = s_rotation.fetch_add(1);
    WTF::String filename = s_filePattern;
    
    // Simple string replacement - since WTF::String doesn't have replace, we'll build it manually
    StringBuilder builder;
    unsigned start = 0;
    
    // Replace ${rotation}
    auto rotationPos = filename.find("${rotation}"_s);
    if (rotationPos != notFound) {
        builder.append(filename.substring(0, rotationPos));
        builder.append(String::number(rotation));
        start = rotationPos + 11; // length of "${rotation}"
    }
    
    // Replace ${pid}
    auto pidPos = filename.find("${pid}"_s, start);
    if (pidPos != notFound) {
        builder.append(filename.substring(start, pidPos - start));
        builder.append(String::number(s_processId));
        builder.append(filename.substring(pidPos + 6)); // length of "${pid}"
    } else {
        builder.append(filename.substring(start));
    }
    
    filename = builder.toString();
    
    // Create root object
    auto root = JSON::Object::create();
    auto traceEventsArray = JSON::Array::create();
    
    for (const auto& event : s_traceEvents) {
        traceEventsArray->pushObject(event.copyRef());
    }
    
    root->setArray("traceEvents"_s, WTFMove(traceEventsArray));
    
    // Write to file
    String jsonString = root->toJSONString();
    CString utf8 = jsonString.utf8();
    
    // Use standard C++ file operations
    CString filenameCString = filename.utf8();
    FILE* file = fopen(filenameCString.data(), "w");
    if (file) {
        fwrite(utf8.data(), 1, utf8.length(), file);
        fclose(file);
    }
}

} // namespace Bun

extern "C" void Bun__NodeTraceEvents__initialize(const char* categories, const char* filePattern)
{
    Bun::NodeTraceEvents::initialize(
        WTF::String::fromUTF8(categories),
        filePattern && filePattern[0] ? WTF::String::fromUTF8(filePattern) : ""_s
    );
}

extern "C" bool Bun__NodeTraceEvents__isEnabled()
{
    return Bun::NodeTraceEvents::isEnabled();
}

extern "C" void Bun__NodeTraceEvents__emitEnvironmentEvent(const char* name)
{
    Bun::NodeTraceEvents::emitEnvironmentEvent(WTF::String::fromUTF8(name));
}

extern "C" void Bun__NodeTraceEvents__shutdown()
{
    Bun::NodeTraceEvents::shutdown();
}