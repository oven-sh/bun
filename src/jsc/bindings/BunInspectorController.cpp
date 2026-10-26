#include "root.h"

#include "BunInspectorController.h"

#include "InspectorBunFrontendDevServerAgent.h"
#include "InspectorHTTPServerAgent.h"
#include "InspectorLifecycleAgent.h"
#include "InspectorTestReporterAgent.h"

#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/ConsoleMessage.h>
#include <JavaScriptCore/Debugger.h>
#include <JavaScriptCore/InjectedScript.h>
#include <JavaScriptCore/InjectedScriptHost.h>
#include <JavaScriptCore/InjectedScriptManager.h>
#include <JavaScriptCore/InspectorAgent.h>
#include <JavaScriptCore/InspectorAuditAgent.h>
#include <JavaScriptCore/InspectorBackendDispatcher.h>
#include <JavaScriptCore/InspectorConsoleAgent.h>
#include <JavaScriptCore/InspectorDebuggerAgent.h>
#include <JavaScriptCore/InspectorHeapAgent.h>
#include <JavaScriptCore/InspectorRuntimeAgent.h>
#include <JavaScriptCore/InspectorScriptProfilerAgent.h>
#include <JavaScriptCore/JSGlobalObjectConsoleClient.h>
#include <JavaScriptCore/JSGlobalObjectInspectorController.h>
#include <JavaScriptCore/ScriptCallStackFactory.h>
#include <wtf/TZoneMallocInlines.h>

extern "C" void Debugger__didConnect();

namespace Bun {

// JavaScriptCore's JSGlobalObjectDebugger, JSGlobalObjectRuntimeAgent, JSGlobalObjectDebuggerAgent and
// JSGlobalObjectAuditAgent each keep the `JSGlobalObject&` they were made with. The four classes below ask the
// controller for the global instead.

class BunInspectorDebugger final : public JSC::Debugger {
    WTF_MAKE_NONCOPYABLE(BunInspectorDebugger);
    WTF_MAKE_TZONE_ALLOCATED(BunInspectorDebugger);

public:
    explicit BunInspectorDebugger(BunInspectorController& controller)
        : JSC::Debugger(controller.vm())
        , m_controller(controller)
    {
    }

private:
    void attachDebugger() final
    {
        attach(&m_controller.globalObject());
    }

    void detachDebugger(bool isBeingDestroyed) final
    {
        detach(&m_controller.globalObject(), isBeingDestroyed ? GlobalObjectIsDestructing : TerminatingDebuggingSession);
        if (!isBeingDestroyed)
            recompileAllJSFunctions();
    }

    void runEventLoopWhilePaused() final
    {
        runInspectorConnectionsWhilePaused(m_controller.globalObject(), m_doneProcessingDebuggerEvents);
    }

    BunInspectorController& m_controller;
};

// The VM has one execution context for the inspector: the global that the controller inspects.
static Inspector::InjectedScript injectedScriptForInspectedGlobalObject(BunInspectorController& controller, Inspector::InjectedScriptManager& injectedScriptManager, Inspector::Protocol::ErrorString& errorString, std::optional<Inspector::Protocol::Runtime::ExecutionContextId>&& executionContextId)
{
    if (executionContextId) {
        errorString = "executionContextId is not supported for JSContexts as there is only one execution context"_s;
        return Inspector::InjectedScript();
    }

    auto injectedScript = injectedScriptManager.injectedScriptFor(&controller.globalObject());
    if (injectedScript.hasNoValue())
        errorString = "Missing execution context for given executionContextId."_s;
    return injectedScript;
}

class BunInspectorRuntimeAgent final : public Inspector::InspectorRuntimeAgent, public CanMakeThreadSafeCheckedPtr<BunInspectorRuntimeAgent> {
    WTF_MAKE_NONCOPYABLE(BunInspectorRuntimeAgent);
    WTF_MAKE_TZONE_ALLOCATED(BunInspectorRuntimeAgent);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(BunInspectorRuntimeAgent);

public:
    OVERRIDE_ABSTRACT_CAN_MAKE_CHECKEDPTR(CanMakeThreadSafeCheckedPtr);

    BunInspectorRuntimeAgent(Inspector::AgentContext& context, BunInspectorController& controller)
        : Inspector::InspectorRuntimeAgent(context)
        , m_backendDispatcher(Inspector::RuntimeBackendDispatcher::create(context.backendDispatcher, this))
        , m_controller(controller)
    {
    }

private:
    Inspector::InjectedScript injectedScriptForEval(Inspector::Protocol::ErrorString& errorString, std::optional<Inspector::Protocol::Runtime::ExecutionContextId>&& executionContextId) final
    {
        return injectedScriptForInspectedGlobalObject(m_controller, injectedScriptManager(), errorString, WTF::move(executionContextId));
    }

    void muteConsole() final {}
    void unmuteConsole() final {}

    const Ref<Inspector::RuntimeBackendDispatcher> m_backendDispatcher;
    BunInspectorController& m_controller;
};

class BunInspectorDebuggerAgent final : public Inspector::InspectorDebuggerAgent, public CanMakeThreadSafeCheckedPtr<BunInspectorDebuggerAgent> {
    WTF_MAKE_NONCOPYABLE(BunInspectorDebuggerAgent);
    WTF_MAKE_TZONE_ALLOCATED(BunInspectorDebuggerAgent);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(BunInspectorDebuggerAgent);

public:
    OVERRIDE_ABSTRACT_CAN_MAKE_CHECKEDPTR(CanMakeThreadSafeCheckedPtr);

    BunInspectorDebuggerAgent(Inspector::AgentContext& context, BunInspectorController& controller, Inspector::InspectorConsoleAgent& consoleAgent)
        : Inspector::InspectorDebuggerAgent(context)
        , m_controller(controller)
        , m_consoleAgent(&consoleAgent)
    {
    }

    // Forgets the scripts and the resolved breakpoints of the outgoing global and tells the frontends. Breakpoints
    // set by URL stay, and resolve again when the new global parses a script that matches.
    void didReplaceGlobalObject() { didClearGlobalObject(); }

    // The registry destroys the console agent before this one.
    void discardAgent() final { m_consoleAgent = nullptr; }

    void breakpointActionLog(JSC::JSGlobalObject* globalObject, const String& message) final
    {
        m_consoleAgent->addMessageToConsole(makeUnique<Inspector::ConsoleMessage>(JSC::MessageSource::JS, JSC::MessageType::Log, JSC::MessageLevel::Log, message, Inspector::createScriptCallStack(globalObject), 0));
    }

private:
    Inspector::InjectedScript injectedScriptForEval(Inspector::Protocol::ErrorString& errorString, std::optional<Inspector::Protocol::Runtime::ExecutionContextId>&& executionContextId) final
    {
        return injectedScriptForInspectedGlobalObject(m_controller, injectedScriptManager(), errorString, WTF::move(executionContextId));
    }

    void muteConsole() final {}
    void unmuteConsole() final {}

    BunInspectorController& m_controller;
    CheckedPtr<Inspector::InspectorConsoleAgent> m_consoleAgent;
};

class BunInspectorAuditAgent final : public Inspector::InspectorAuditAgent, public CanMakeThreadSafeCheckedPtr<BunInspectorAuditAgent> {
    WTF_MAKE_NONCOPYABLE(BunInspectorAuditAgent);
    WTF_MAKE_TZONE_ALLOCATED(BunInspectorAuditAgent);
    WTF_OVERRIDE_DELETE_FOR_CHECKED_PTR(BunInspectorAuditAgent);

public:
    OVERRIDE_ABSTRACT_CAN_MAKE_CHECKEDPTR(CanMakeThreadSafeCheckedPtr);

    BunInspectorAuditAgent(Inspector::AgentContext& context, BunInspectorController& controller)
        : Inspector::InspectorAuditAgent(context)
        , m_controller(controller)
    {
    }

private:
    Inspector::InjectedScript injectedScriptForEval(Inspector::Protocol::ErrorString& errorString, std::optional<Inspector::Protocol::Runtime::ExecutionContextId>&& executionContextId) final
    {
        return injectedScriptForInspectedGlobalObject(m_controller, injectedScriptManager(), errorString, WTF::move(executionContextId));
    }

    BunInspectorController& m_controller;
};

WTF_MAKE_TZONE_ALLOCATED_IMPL(BunInspectorDebugger);
WTF_MAKE_TZONE_ALLOCATED_IMPL(BunInspectorRuntimeAgent);
WTF_MAKE_TZONE_ALLOCATED_IMPL(BunInspectorDebuggerAgent);
WTF_MAKE_TZONE_ALLOCATED_IMPL(BunInspectorAuditAgent);
WTF_MAKE_TZONE_ALLOCATED_IMPL(BunInspectorController);

BunInspectorController::BunInspectorController(JSC::JSGlobalObject& globalObject, Ref<Inspector::InjectedScriptHost>&& host)
    : m_vm(globalObject.vm())
    , m_globalObject(&globalObject)
    , m_injectedScriptManager(makeUniqueRef<Inspector::InjectedScriptManager>(*this, WTF::move(host)))
    , m_executionStopwatch(Stopwatch::create())
    , m_frontendRouter(Inspector::FrontendRouter::create())
    , m_backendDispatcher(Inspector::BackendDispatcher::create(m_frontendRouter.copyRef()))
{
    auto context = agentContext();

    // From the start, not with the lazy agents: it keeps the messages of an inspectable global for the frontend that
    // enables the Console domain later.
    auto consoleAgent = makeUniqueRef<Inspector::InspectorConsoleAgent>(context);
    m_consoleAgent = consoleAgent.ptr();
    m_agents.append(WTF::move(consoleAgent));

    m_consoleClient = makeUnique<Inspector::JSGlobalObjectConsoleClient>(m_consoleAgent.get());

    m_executionStopwatch->start();
}

BunInspectorController::~BunInspectorController()
{
    ASSERT(!m_frontendRouter->hasFrontends());

    m_injectedScriptManager->disconnect();
    m_agents.discardValues();
}

BunInspectorController& BunInspectorController::ensure(JSC::JSGlobalObject& globalObject, Ref<Inspector::InjectedScriptHost> (*createHost)())
{
    auto& controller = WebCore::clientData(globalObject.vm())->m_inspectorController;
    if (!controller)
        controller = makeUnique<BunInspectorController>(globalObject, createHost());
    return *controller;
}

void BunInspectorController::destroy(JSC::VM& vm)
{
    auto controller = std::exchange(WebCore::clientData(vm)->m_inspectorController, nullptr);
    if (!controller)
        return;
    // Nothing takes the console calls of the global from here on.
    controller->m_globalObject->setInspectable(false);
}

void BunInspectorController::didReplaceGlobalObject(JSC::JSGlobalObject& globalObject)
{
    JSC::JSGlobalObject& outgoing = *m_globalObject;

    // The remote objects and the saved results of the frontends, and the console messages kept for a frontend that
    // enables Console later, are values of the outgoing global. They would keep it alive.
    m_injectedScriptManager->discardInjectedScripts();
    m_consoleAgent->discardValues();

    // The debugger observes a global only while the Debugger domain is enabled.
    bool isDebugging = m_debuggerAgent && m_debuggerAgent->enabled();
    if (isDebugging) {
        m_debuggerAgent->didReplaceGlobalObject();
        // Detaches from the outgoing global and forgets which sources it reported: the modules of the new global
        // come from the same SourceProviders. Its code does not run again, so nothing is compiled again for it.
        m_debugger->removeObserver(*m_debuggerAgent, true);
    }

    m_globalObject = &globalObject;
    if (outgoing.inspectable())
        globalObject.setInspectable(true);

    if (isDebugging)
        m_debugger->addObserver(*m_debuggerAgent);
}

void BunInspectorController::connectFrontend(Inspector::FrontendChannel& frontendChannel)
{
    JSC::JSLockHolder locker(m_vm);

    createLazyAgents();

    bool connectedFirstFrontend = !m_frontendRouter->hasFrontends();
    m_frontendRouter->connectFrontend(frontendChannel);
    m_globalObject->setInspectable(true);

    if (connectedFirstFrontend)
        m_agents.didCreateFrontendAndBackend();
}

void BunInspectorController::disconnectFrontend(Inspector::FrontendChannel& frontendChannel)
{
    JSC::JSLockHolder locker(m_vm);

    // One set of agents serves every frontend, as in JSGlobalObjectInspectorController: when one frontend leaves,
    // the agents forget what any frontend enabled.
    m_agents.willDestroyFrontendAndBackend(Inspector::DisconnectReason::InspectorDestroyed);
    m_frontendRouter->disconnectFrontend(frontendChannel);
}

void BunInspectorController::dispatchMessageFromFrontend(const String& message)
{
    JSC::JSLockHolder locker(m_vm);

    m_backendDispatcher->dispatch(message);
}

CheckedPtr<JSC::ConsoleClient> BunInspectorController::consoleClient() const
{
    return m_consoleClient.get();
}

Inspector::InspectorFunctionCallHandler BunInspectorController::functionCallHandler() const
{
    return JSC::call;
}

Inspector::InspectorEvaluateHandler BunInspectorController::evaluateHandler() const
{
    return JSC::evaluate;
}

void BunInspectorController::frontendInitialized()
{
    if (std::exchange(m_isWaitingForFrontend, false))
        Debugger__didConnect();
}

JSC::Debugger* BunInspectorController::debugger()
{
    return m_debugger.get();
}

Inspector::AgentContext BunInspectorController::agentContext()
{
    return { *this, m_injectedScriptManager.get(), m_frontendRouter.get(), m_backendDispatcher };
}

void BunInspectorController::createLazyAgents()
{
    if (m_didCreateLazyAgents)
        return;
    m_didCreateLazyAgents = true;

    m_debugger = makeUnique<BunInspectorDebugger>(*this);

    auto context = agentContext();

    m_agents.append(makeUniqueRef<Inspector::InspectorLifecycleAgent>(*this));
    m_agents.append(makeUniqueRef<Inspector::InspectorTestReporterAgent>(*this));
    m_agents.append(makeUniqueRef<Inspector::InspectorBunFrontendDevServerAgent>(*this));
    m_agents.append(makeUniqueRef<Inspector::InspectorHTTPServerAgent>(*this));

    m_agents.append(makeUniqueRef<Inspector::InspectorAgent>(context));
    m_agents.append(makeUniqueRef<BunInspectorRuntimeAgent>(context, *this));

    auto debuggerAgent = makeUniqueRef<BunInspectorDebuggerAgent>(context, *this, *m_consoleAgent);
    m_debuggerAgent = debuggerAgent.ptr();
    m_consoleClient->setDebuggerAgent(debuggerAgent.ptr());
    m_agents.append(WTF::move(debuggerAgent));

    auto scriptProfilerAgent = makeUniqueRef<Inspector::InspectorScriptProfilerAgent>(context);
    m_consoleClient->setPersistentScriptProfilerAgent(scriptProfilerAgent.ptr());
    m_agents.append(WTF::move(scriptProfilerAgent));

    auto heapAgent = makeUniqueRef<Inspector::InspectorHeapAgent>(context);
    m_consoleClient->setPersistentHeapAgent(heapAgent.ptr());
    m_agents.append(WTF::move(heapAgent));

    m_agents.append(makeUniqueRef<BunInspectorAuditAgent>(context, *this));
}

CheckedPtr<JSC::ConsoleClient> inspectorConsoleClient(JSC::JSGlobalObject& globalObject)
{
    if (auto* controller = BunInspectorController::get(globalObject.vm()))
        return controller->consoleClient();
    // A global that bun:jsc's startRemoteDebugger() made inspectable: JavaScriptCore's remote inspector attaches
    // to the global's own controller.
    return globalObject.inspectorController().consoleClient();
}

} // namespace Bun
