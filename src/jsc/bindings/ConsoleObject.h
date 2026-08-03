#pragma once

#include "root.h"

#include <JavaScriptCore/ConsoleClient.h>
#include <wtf/text/WTFString.h>

namespace Bun {
using namespace JSC;

class ConsoleObject final : public JSC::ConsoleClient {
    WTF_DEPRECATED_MAKE_FAST_ALLOCATED(ConsoleObject);

public:
    ~ConsoleObject() final {}
    ConsoleObject(void* client)
        : JSC::ConsoleClient()
    {
        m_client = client;
    }

    void* m_client;

private:
    void messageWithTypeAndLevel(MessageType, MessageLevel, JSC::JSGlobalObject*,
        Ref<Inspector::ScriptArguments>&&);
    void count(JSC::JSGlobalObject*, const String& label);
    void countReset(JSC::JSGlobalObject*, const String& label);
    void profile(JSC::JSGlobalObject*, const String& title);
    void profileEnd(JSC::JSGlobalObject*, const String& title);
    void takeHeapSnapshot(JSC::JSGlobalObject*, const String& title);
    void time(JSC::JSGlobalObject*, const String& label);
    void timeLog(JSC::JSGlobalObject*, const String& label, Ref<Inspector::ScriptArguments>&&);
    void timeEnd(JSC::JSGlobalObject*, const String& label);
    void timeStamp(JSC::JSGlobalObject*, Ref<Inspector::ScriptArguments>&&);
    void record(JSC::JSGlobalObject*, Ref<Inspector::ScriptArguments>&&);
    void recordEnd(JSC::JSGlobalObject*, Ref<Inspector::ScriptArguments>&&);
    void screenshot(JSC::JSGlobalObject*, Ref<Inspector::ScriptArguments>&&);
};

} // namespace Zig
