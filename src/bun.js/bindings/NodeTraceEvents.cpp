#include "root.h"
#include "NodeTraceEvents.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSONObject.h>
#include <filesystem>
#include <fstream>
#include <chrono>
#include <unistd.h>
#include <pthread.h>
#include <sstream>
#include <iomanip>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/JSCInlines.h>
#include "ZigGlobalObject.h"

namespace Bun {

static std::unique_ptr<NodeTraceEvents> s_instance;
static std::mutex s_mutex;

NodeTraceEvents& NodeTraceEvents::getInstance()
{
    std::lock_guard<std::mutex> lock(s_mutex);
    if (!s_instance) {
        s_instance = std::unique_ptr<NodeTraceEvents>(new NodeTraceEvents());
    }
    return *s_instance;
}

void NodeTraceEvents::enable(const WTF::String& categories)
{
    std::lock_guard<std::mutex> lock(m_mutex);
    m_enabled = true;
    m_categories = categories;
    
    // Create trace file with rotation number
    m_filename = WTF::String::format("node_trace.%d.log", m_rotation);
    
    // Initialize with empty trace events array
    m_events.clear();
    
    // Reset start time
    m_startTime = std::chrono::steady_clock::now();
}

void NodeTraceEvents::disable()
{
    std::lock_guard<std::mutex> lock(m_mutex);
    if (!m_enabled)
        return;
        
    m_enabled = false;
    writeTraceFile();
    m_events.clear();
}

void NodeTraceEvents::emitEvent(const WTF::String& name, const WTF::String& category, const char phase)
{
    if (!m_enabled)
        return;
        
    std::lock_guard<std::mutex> lock(m_mutex);
    
    auto now = std::chrono::steady_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::microseconds>(now - m_startTime);
    
    TraceEvent event;
    event.name = name;
    event.cat = category;
    event.ph = WTF::String(&phase, 1);
    event.pid = getpid();
    event.tid = static_cast<long>(pthread_self());
    event.ts = duration.count();
    
    m_events.append(WTFMove(event));
}

void NodeTraceEvents::writeTraceFile()
{
    if (m_events.isEmpty())
        return;
        
    std::ostringstream json;
    json << "{\"traceEvents\":[";
    
    bool first = true;
    for (const auto& event : m_events) {
        if (!first) {
            json << ",";
        }
        first = false;
        
        json << "{";
        json << "\"name\":\"" << event.name.utf8().data() << "\",";
        json << "\"cat\":\"" << event.cat.utf8().data() << "\",";
        json << "\"ph\":\"" << event.ph.utf8().data() << "\",";
        json << "\"pid\":" << event.pid << ",";
        json << "\"tid\":" << event.tid << ",";
        json << "\"ts\":" << event.ts;
        json << "}";
    }
    
    json << "]}";
    
    // Write to file
    std::ofstream file(m_filename.utf8().data());
    if (file.is_open()) {
        file << json.str();
        file.close();
    }
}

JSC::JSValue createNodeTraceEventsBindings(Zig::GlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto* obj = JSC::constructEmptyObject(globalObject);
    
    obj->putDirect(vm, JSC::Identifier::fromString(vm, "enableTraceEvents"_s),
        JSC::JSFunction::create(vm, globalObject, 1, "enableTraceEvents"_s, 
            [](JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame) -> JSC::EncodedJSValue {
                auto& vm = globalObject->vm();
                auto scope = DECLARE_THROW_SCOPE(vm);
                
                if (callFrame->argumentCount() < 1) {
                    return JSC::JSValue::encode(JSC::jsUndefined());
                }
                
                auto categories = callFrame->argument(0).toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                
                Bun__enableTraceEvents(categories.utf8().data());
                return JSC::JSValue::encode(JSC::jsUndefined());
            }));
    
    obj->putDirect(vm, JSC::Identifier::fromString(vm, "disableTraceEvents"_s),
        JSC::JSFunction::create(vm, globalObject, 0, "disableTraceEvents"_s,
            [](JSC::JSGlobalObject*, JSC::CallFrame*) -> JSC::EncodedJSValue {
                Bun__disableTraceEvents();
                return JSC::JSValue::encode(JSC::jsUndefined());
            }));
    
    obj->putDirect(vm, JSC::Identifier::fromString(vm, "emitTraceEvent"_s),
        JSC::JSFunction::create(vm, globalObject, 2, "emitTraceEvent"_s,
            [](JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame) -> JSC::EncodedJSValue {
                auto& vm = globalObject->vm();
                auto scope = DECLARE_THROW_SCOPE(vm);
                
                if (callFrame->argumentCount() < 2) {
                    return JSC::JSValue::encode(JSC::jsUndefined());
                }
                
                auto name = callFrame->argument(0).toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                
                auto category = callFrame->argument(1).toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                
                Bun__emitTraceEvent(name.utf8().data(), category.utf8().data());
                return JSC::JSValue::encode(JSC::jsUndefined());
            }));
    
    return obj;
}

} // namespace Bun

extern "C" {

void Bun__enableTraceEvents(const char* categories)
{
    if (categories && strlen(categories) > 0) {
        Bun::NodeTraceEvents::getInstance().enable(WTF::String::fromUTF8(categories));
    }
}

void Bun__disableTraceEvents()
{
    Bun::NodeTraceEvents::getInstance().disable();
}

void Bun__emitTraceEvent(const char* name, const char* category)
{
    if (name && category) {
        Bun::NodeTraceEvents::getInstance().emitEvent(
            WTF::String::fromUTF8(name),
            WTF::String::fromUTF8(category)
        );
    }
}

} // extern "C"