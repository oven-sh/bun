#pragma once

#include "root.h"

#include "BunClientData.h"
#include <JavaScriptCore/ConsoleClient.h>
#include <JavaScriptCore/InspectorAgentRegistry.h>
#include <JavaScriptCore/InspectorEnvironment.h>
#include <JavaScriptCore/InspectorFrontendRouter.h>
#include <wtf/CheckedPtr.h>
#include <wtf/Stopwatch.h>
#include <wtf/TZoneMalloc.h>
#include <wtf/UniqueRef.h>

namespace Inspector {
struct AgentContext;
class BackendDispatcher;
class FrontendChannel;
class InjectedScriptHost;
class InjectedScriptManager;
class InspectorConsoleAgent;
class JSGlobalObjectConsoleClient;
}

namespace Bun {

class BunInspectorDebugger;
class BunInspectorDebuggerAgent;

// The inspector backend of one VM: the frontend channels, the protocol dispatcher, the debugger and every agent.
//
// JavaScriptCore gives each global object a backend of its own (JSGlobalObjectInspectorController), and that one
// cannot move to another global. `bun test --isolate` replaces the global between test files, so Bun's inspector
// sessions attach here instead, and the session follows the global: see didReplaceGlobalObject().
class BunInspectorController final : public Inspector::InspectorEnvironment, public CanMakeThreadSafeCheckedPtr<BunInspectorController> {
    WTF_MAKE_NONCOPYABLE(BunInspectorController);
    WTF_MAKE_TZONE_ALLOCATED(BunInspectorController);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(BunInspectorController);

public:
    OVERRIDE_ABSTRACT_CAN_MAKE_CHECKEDPTR(CanMakeThreadSafeCheckedPtr);

    BunInspectorController(JSC::JSGlobalObject&, Ref<Inspector::InjectedScriptHost>&&);
    ~BunInspectorController() final;

    // The controller of `vm`. Null until an inspector attaches to the VM or the VM waits for one.
    static BunInspectorController* get(JSC::VM& vm) { return WebCore::clientData(vm)->m_inspectorController.get(); }
    // The controller of `globalObject`'s VM. Makes it, with the host that `createHost` returns, when there is none.
    static BunInspectorController& ensure(JSC::JSGlobalObject&, Ref<Inspector::InjectedScriptHost> (*createHost)());
    // Before the VM goes: the agents and the debugger need its heap.
    static void destroy(JSC::VM&);

    JSC::JSGlobalObject& globalObject() const { return *m_globalObject; }

    // `bun test --isolate` replaced the inspected global. The frontends stay attached and the agents keep what the
    // frontends enabled. What the agents held of the outgoing global is dropped, as for a page that navigates: the
    // frontends get Debugger.globalObjectCleared, and breakpoints set by URL resolve again in the new global.
    void didReplaceGlobalObject(JSC::JSGlobalObject&);

    void connectFrontend(Inspector::FrontendChannel&);
    void disconnectFrontend(Inspector::FrontendChannel&);
    void dispatchMessageFromFrontend(const String&);

    CheckedPtr<JSC::ConsoleClient> consoleClient() const;

    // `--inspect-wait`, `--inspect-brk` and inspector.waitForDebugger() block the JS thread until a frontend sends
    // Inspector.initialized.
    void waitForFrontend() { m_isWaitingForFrontend = true; }

    Inspector::FrontendRouter& frontendRouter() { return m_frontendRouter.get(); }
    Inspector::BackendDispatcher& backendDispatcher() { return m_backendDispatcher.get(); }

    // InspectorEnvironment
    bool developerExtrasEnabled() const final { return true; }
    bool canAccessInspectedScriptState(JSC::JSGlobalObject*) const final { return true; }
    Inspector::InspectorFunctionCallHandler functionCallHandler() const final;
    Inspector::InspectorEvaluateHandler evaluateHandler() const final;
    void frontendInitialized() final;
    WTF::Stopwatch& executionStopwatch() const final { return m_executionStopwatch; }
    JSC::Debugger* debugger() final;
    JSC::VM& vm() final { return m_vm; }

private:
    Inspector::AgentContext agentContext();
    void createLazyAgents();

    JSC::VM& m_vm;
    // The global that the VM runs: protected from collection by its owner for as long as it is that global.
    JSC::JSGlobalObject* m_globalObject;
    const UniqueRef<Inspector::InjectedScriptManager> m_injectedScriptManager;
    const Ref<WTF::Stopwatch> m_executionStopwatch;
    std::unique_ptr<BunInspectorDebugger> m_debugger;
    const Ref<Inspector::FrontendRouter> m_frontendRouter;
    const Ref<Inspector::BackendDispatcher> m_backendDispatcher;

    // Members are destroyed in reverse order. The agents point at the debugger and the router above, and the members
    // below point into the agents.
    Inspector::AgentRegistry m_agents;
    std::unique_ptr<Inspector::JSGlobalObjectConsoleClient> m_consoleClient;
    CheckedPtr<Inspector::InspectorConsoleAgent> m_consoleAgent;
    CheckedPtr<BunInspectorDebuggerAgent> m_debuggerAgent;

    bool m_didCreateLazyAgents { false };
    bool m_isWaitingForFrontend { false };
};

// Where the console calls of `globalObject` go when it is inspectable.
CheckedPtr<JSC::ConsoleClient> inspectorConsoleClient(JSC::JSGlobalObject&);

} // namespace Bun
