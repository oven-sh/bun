#pragma once

#include <wtf/text/WTFString.h>
#include <wtf/JSONValues.h>

namespace Bun {

class NodeTraceEvents {
public:
    static void initialize(const WTF::String& categories, const WTF::String& filePattern = ""_s);
    static bool isEnabled();
    static bool isEnabled(const WTF::String& category);
    static void emit(const WTF::String& name, const WTF::String& category, JSON::Object* args = nullptr, uint64_t timestamp = 0);
    static void emitEnvironmentEvent(const WTF::String& name);
    static void shutdown();
    
private:
    static void writeTraceFile();
};

} // namespace Bun

extern "C" {
    void Bun__NodeTraceEvents__initialize(const char* categories, const char* filePattern);
    bool Bun__NodeTraceEvents__isEnabled();
    void Bun__NodeTraceEvents__emitEnvironmentEvent(const char* name);
    void Bun__NodeTraceEvents__shutdown();
}