#pragma once

#include <JavaScriptCore/ConsoleClient.h>
#include <wtf/Vector.h>
#include <wtf/text/WTFString.h>

namespace Inspector {
class InspectorConsoleAgent;
class InspectorDebuggerAgent;
class InspectorScriptProfilerAgent;
} // namespace Inspector
namespace Zig {
using InspectorConsoleAgent = Inspector::InspectorConsoleAgent;
using InspectorDebuggerAgent = Inspector::InspectorDebuggerAgent;
using InspectorScriptProfilerAgent = Inspector::InspectorScriptProfilerAgent;
using namespace JSC;

class ConsoleClient final : public JSC::ConsoleClient {
    WTF_MAKE_FAST_ALLOCATED;

public:
    ~ConsoleClient() final {}
    ConsoleClient(void* client)
        : JSC::ConsoleClient()
    {
        m_client = client;
    }

    static bool logToSystemConsole();
    static void setLogToSystemConsole(bool);

    void setDebuggerAgent(InspectorDebuggerAgent* agent) { m_debuggerAgent = agent; }
    void setPersistentScriptProfilerAgent(InspectorScriptProfilerAgent* agent)
    {
        m_scriptProfilerAgent = agent;
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

    void warnUnimplemented(const String& method);
    void internalAddMessage(MessageType, MessageLevel, JSC::JSGlobalObject*,
        Ref<Inspector::ScriptArguments>&&);

    void startConsoleProfile();
    void stopConsoleProfile();

    Inspector::InspectorConsoleAgent* m_consoleAgent;
    Inspector::InspectorDebuggerAgent* m_debuggerAgent { nullptr };
    Inspector::InspectorScriptProfilerAgent* m_scriptProfilerAgent { nullptr };
    Vector<String> m_profiles;
    bool m_profileRestoreBreakpointActiveValue { false };
};

} // namespace Zig
