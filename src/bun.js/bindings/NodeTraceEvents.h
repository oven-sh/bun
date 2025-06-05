#pragma once

#include <wtf/text/WTFString.h>
#include <wtf/Vector.h>
#include <mutex>
#include <chrono>
#include <memory>

namespace JSC {
class JSGlobalObject;
}

namespace Bun {

class NodeTraceEvents {
public:
    static NodeTraceEvents& getInstance();
    
    void enable(const WTF::String& categories);
    void disable();
    void emitEvent(const WTF::String& name, const WTF::String& category, const char phase = 'I');
    bool isEnabled() const { return m_enabled; }
    
private:
    NodeTraceEvents() : m_startTime(std::chrono::steady_clock::now()), m_rotation(1) {}
    
    struct TraceEvent {
        WTF::String name;
        WTF::String cat;
        WTF::String ph; // phase
        int pid;
        long tid;
        uint64_t ts; // timestamp in microseconds
        // args can be added later if needed
    };
    
    void writeTraceFile();
    
    bool m_enabled = false;
    WTF::String m_categories;
    WTF::String m_filename;
    WTF::Vector<TraceEvent> m_events;
    std::chrono::steady_clock::time_point m_startTime;
    std::mutex m_mutex;
    int m_rotation;
};

} // namespace Bun

// C interface for Zig
extern "C" {
void Bun__enableTraceEvents(const char* categories);
void Bun__disableTraceEvents();
void Bun__emitTraceEvent(const char* name, const char* category);
}