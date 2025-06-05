#include "trace_events.h"
#include "BunClientData.h"
#include <wtf/MonotonicTime.h>
#include <wtf/WallTime.h>
#include <wtf/FileSystem.h>
#include <wtf/text/WTFString.h>
#include <wtf/text/StringBuilder.h>
#include <fcntl.h>
#include <unistd.h>

#if OS(WINDOWS)
#include <windows.h>
#else
#include <sys/types.h>
#endif

namespace Bun {

TraceEventRecorder& TraceEventRecorder::getInstance()
{
    static TraceEventRecorder instance;
    return instance;
}

void TraceEventRecorder::enable(const WTF::String& categories)
{
    WTF::Locker locker(m_lock);
    m_enabled = true;
    m_enabledCategories.clear();
    
    // Parse comma-separated categories
    auto categoriesList = categories.split(',');
    for (const auto& category : categoriesList) {
        // Simple trim - just check if not empty after splitting
        if (!category.isEmpty()) {
            m_enabledCategories.append(category);
        }
    }
}

bool TraceEventRecorder::isCategoryEnabled(const WTF::String& category) const
{
    if (m_enabledCategories.isEmpty())
        return true; // All categories enabled if no specific categories specified
    
    for (const auto& enabled : m_enabledCategories) {
        if (enabled == category)
            return true;
    }
    
    return false;
}

void TraceEventRecorder::recordEvent(const char* name, const char* category)
{
    if (!m_enabled || !isCategoryEnabled(WTF::String::fromUTF8(category)))
        return;
    
    WTF::Locker locker(m_lock);
    TraceEvent event;
    event.name = WTF::String::fromUTF8(name);
    event.cat = WTF::String::fromUTF8(category);
#if OS(WINDOWS)
    event.pid = GetCurrentProcessId();
#else
    event.pid = getpid();
#endif
    // Get timestamp in microseconds
    event.ts = static_cast<uint64_t>(WTF::MonotonicTime::now().secondsSinceEpoch().value() * 1000000.0);
    event.ph = 'I'; // Instant event
    
    m_events.append(event);
}

void TraceEventRecorder::writeToFile()
{
    WTF::Locker locker(m_lock);
    
    if (m_events.isEmpty())
        return;
    
    // Create trace output in Chrome trace format
    WTF::StringBuilder builder;
    builder.append("{\"traceEvents\":["_s);
    
    bool first = true;
    for (const auto& event : m_events) {
        if (!first)
            builder.append(","_s);
        first = false;
        
        builder.append("{"_s);
        builder.append("\"name\":\""_s, event.name, "\","_s);
        builder.append("\"cat\":\""_s, event.cat, "\","_s);
        builder.append("\"ph\":\""_s, event.ph, "\","_s);
        builder.append("\"pid\":"_s, WTF::String::number(event.pid), ","_s);
        builder.append("\"tid\":1,"_s); // Thread ID (using 1 for simplicity)
        builder.append("\"ts\":"_s, WTF::String::number(event.ts));
        builder.append("}"_s);
    }
    
    builder.append("]}"_s);
    
    // Write to node_trace.1.log
    auto str = builder.toString();
    auto utf8 = str.utf8();
    
    // Write to file in current directory
    int fd = open("node_trace.1.log", O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd >= 0) {
        write(fd, utf8.data(), utf8.length());
        close(fd);
    }
}

} // namespace Bun

// C interface
extern "C" {

void Bun__TraceEvent__record(const char* name, const char* category)
{
    Bun::TraceEventRecorder::getInstance().recordEvent(name, category);
}

void Bun__TraceEvent__writeToFile()
{
    Bun::TraceEventRecorder::getInstance().writeToFile();
}

void Bun__TraceEvent__enable(const WTF::StringImpl* categories)
{
    if (categories) {
        Bun::TraceEventRecorder::getInstance().enable(WTF::String(Ref<WTF::StringImpl>(const_cast<WTF::StringImpl&>(*categories))));
    }
}

} // extern "C"