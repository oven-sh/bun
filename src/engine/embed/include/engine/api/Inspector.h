#pragma once

// The protocol through which tools debug and profile a realm.

#include "engine/api/GlobalObject.h"

namespace Inspector {

using ErrorString = String;
using CommandResult = std::expected<Ref<JSON::Object>, ErrorString>;

enum class AsyncCallType : uint8_t {
    DOMTimer = Engine::AsyncCallType::DomTimer,
    EventListener = Engine::AsyncCallType::EventListener,
    PostMessage = Engine::AsyncCallType::PostMessage,
    RequestAnimationFrame = Engine::AsyncCallType::RequestAnimationFrame,
    Microtask = Engine::AsyncCallType::Microtask,
};

class FrontendChannel {
public:
    virtual ~FrontendChannel() = default;
    // Neither runs scripts nor allocates cells.
    virtual void sendMessageToFrontend(const String&) = 0;
};

// What the engine asks of the embedder while a frontend is connected.
class InspectorClient {
public:
    virtual ~InspectorClient() = default;
    // A string or undefined.
    virtual JSC::JSValue subtype(JSC::JSGlobalObject*, JSC::JSValue) = 0;
    // An array of `{ name, value }`, or nothing if the object is not the embedder's.
    virtual JSC::JSValue getInternalProperties(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue) = 0;
    // Dispatches messages until one of them has set the flag.
    virtual void runWhilePaused(JSC::JSGlobalObject&, bool& isDoneProcessingEvents) = 0;
    virtual void frontendInitialized() = 0;
};

// A domain of the protocol that the embedder implements. It has the commands `enable` and `disable`.
class InspectorAgentBase {
    WTF_MAKE_NONCOPYABLE(InspectorAgentBase);

public:
    virtual ~InspectorAgentBase() = default;

protected:
    InspectorAgentBase(JSC::JSGlobalObject& globalObject, ASCIILiteral domain)
        : m_globalObject(globalObject)
        , m_domain(domain)
    {
    }

    JSC::JSGlobalObject& globalObject() const { return m_globalObject; }
    bool isEnabled() const { return m_isEnabled; }
    void sendEvent(ASCIILiteral name, Ref<JSON::Object>&& parameters);

private:
    friend class JSGlobalObjectInspectorController;

    virtual void didEnable() = 0;
    virtual void didDisable() = 0;
    // Nothing if there is no such command. Leaves no exception.
    virtual std::optional<CommandResult> runCommand(StringView) { return std::nullopt; }

    void setEnabled(bool);
    std::optional<CommandResult> dispatch(StringView command);

    JSC::JSGlobalObject& m_globalObject;
    ASCIILiteral m_domain;
    bool m_isEnabled { false };
};

class JSGlobalObjectInspectorController {
    WTF_MAKE_NONCOPYABLE(JSGlobalObjectInspectorController);
    WTF_MAKE_TZONE_ALLOCATED(JSGlobalObjectInspectorController);

public:
    explicit JSGlobalObjectInspectorController(JSC::JSGlobalObject&);
    ~JSGlobalObjectInspectorController();

    JSC::JSGlobalObject& globalObject() const { return m_globalObject; }

    // The client outlives the realm.
    void connectFrontend(FrontendChannel&, InspectorClient&);
    void disconnectFrontend(FrontendChannel&);
    bool hasFrontend() const { return !m_frontends.isEmpty(); }
    InspectorClient& client() const { return *m_client; }
    void registerAgent(UniqueRef<InspectorAgentBase>&& agent) { m_agents.append(WTF::move(agent)); }
    // Lets go of what is in the heap. No frontend is left.
    void discardValues() { Engine::inspector_discard_values(m_backend); }

    void dispatchMessageFromFrontend(const String& message) { Engine::inspector_dispatch(m_backend, &m_globalObject, message); }
    void sendMessageToFrontends(const String&);
    // False if no agent has registered for the domain.
    bool dispatchToAgent(int requestId, StringView domain, StringView command);

    void addConsoleMessage(JSC::JSGlobalObject* globalObject, JSC::MessageType type, JSC::MessageLevel level, std::span<const JSC::EncodedJSValue> arguments) { Engine::inspector_console_message(m_backend, globalObject, type, level, arguments); }
    void startConsoleProfile(JSC::JSGlobalObject* globalObject, const String& title) { Engine::inspector_console_profile(m_backend, globalObject, title); }
    void stopConsoleProfile(JSC::JSGlobalObject* globalObject, const String& title) { Engine::inspector_console_profile_end(m_backend, globalObject, title); }

    bool isInteractivelyDebugging() const { return Engine::inspector_is_interactively_debugging(m_backend); }
    bool isPaused() const { return Engine::inspector_is_paused(m_backend); }
    void continueProgram() { Engine::inspector_continue_program(m_backend); }
    void sourceParsed(JSC::SourceProvider& provider) { Engine::global_report_source_to_debugger(&m_globalObject, provider); }

    void didScheduleAsyncCall(AsyncCallType type, uint64_t id, bool isSingleShot) { Engine::inspector_did_schedule_async_call(m_backend, &m_globalObject, type, id, isSingleShot); }
    void didCancelAsyncCall(AsyncCallType type, uint64_t id) { Engine::inspector_did_cancel_async_call(m_backend, type, id); }
    void willDispatchAsyncCall(AsyncCallType type, uint64_t id) { Engine::inspector_will_dispatch_async_call(m_backend, type, id); }
    void didDispatchAsyncCall(AsyncCallType type, uint64_t id) { Engine::inspector_did_dispatch_async_call(m_backend, type, id); }

    // When it began, if that is of interest.
    std::optional<double> willEvaluateScript()
    {
        double start;
        return Engine::inspector_will_evaluate_script(m_backend, start) ? std::optional(start) : std::nullopt;
    }
    void didEvaluateScript(double start, JSC::ProfilingReason reason) { Engine::inspector_did_evaluate_script(m_backend, start, reason); }

private:
    JSC::JSGlobalObject& m_globalObject;
    Engine::InspectorBackend& m_backend;
    InspectorClient* m_client { nullptr };
    Vector<FrontendChannel*, 2> m_frontends;
    Vector<UniqueRef<InspectorAgentBase>> m_agents;
};

} // namespace Inspector

namespace JSC {

// A frontend has these calls in its timeline.
JSValue callInInspectedRealm(JSGlobalObject*, ProfilingReason, JSValue function, const CallData&, JSValue thisValue, const ArgList&);
inline JSValue profiledCall(JSGlobalObject* globalObject, ProfilingReason reason, JSValue function, const CallData& callData, JSValue thisValue, const ArgList& arguments)
{
    if (globalObject->hasInspectorController()) [[unlikely]]
        return callInInspectedRealm(globalObject, reason, function, callData, thisValue, arguments);
    return call(globalObject, function, callData, thisValue, arguments);
}
JSValue profiledCall(JSGlobalObject*, ProfilingReason, JSValue function, const CallData&, JSValue thisValue, const ArgList&, NakedPtr<Exception>& returnedException);

} // namespace JSC
