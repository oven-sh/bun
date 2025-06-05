#pragma once

#include "root.h"
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>
#include <wtf/JSONValues.h>

namespace Bun {

struct TraceEvent {
    WTF::String name;
    WTF::String cat;
    pid_t pid;
    uint64_t ts; // timestamp in microseconds
    char ph = 'I'; // phase: 'I' for instant event
};

class TraceEventRecorder {
public:
    static TraceEventRecorder& getInstance();
    
    void recordEvent(const char* name, const char* category);
    void enable(const WTF::String& categories);
    bool isEnabled() const { return m_enabled; }
    bool isCategoryEnabled(const WTF::String& category) const;
    void writeToFile();
    
private:
    TraceEventRecorder() = default;
    
    bool m_enabled = false;
    WTF::Vector<WTF::String> m_enabledCategories;
    WTF::Vector<TraceEvent> m_events;
    WTF::Lock m_lock;
};

} // namespace Bun