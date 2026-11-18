#include "engine/Engine.h"

namespace Inspector {

using namespace JSC;

void InspectorAgentBase::sendEvent(ASCIILiteral name, Ref<JSON::Object>&& parameters)
{
    auto message = JSON::Object::create();
    message->setString("method"_s, makeString(m_domain, '.', name));
    message->setObject("params"_s, WTF::move(parameters));
    m_globalObject.inspectorController().sendMessageToFrontends(message->toJSONString());
}

void InspectorAgentBase::setEnabled(bool isEnabled)
{
    if (std::exchange(m_isEnabled, isEnabled) == isEnabled)
        return;
    if (isEnabled)
        didEnable();
    else
        didDisable();
}

std::optional<CommandResult> InspectorAgentBase::dispatch(StringView command)
{
    if (command != "enable"_s && command != "disable"_s)
        return runCommand(command);
    setEnabled(command == "enable"_s);
    return JSON::Object::create();
}

JSGlobalObjectInspectorController::JSGlobalObjectInspectorController(JSGlobalObject& globalObject)
    : m_globalObject(globalObject)
    , m_backend(*Engine::inspector_create(&globalObject, this))
{
}

JSGlobalObjectInspectorController::~JSGlobalObjectInspectorController()
{
    for (auto& agent : m_agents)
        agent->setEnabled(false);
    Engine::inspector_destroy(&m_backend);
}

void JSGlobalObjectInspectorController::connectFrontend(FrontendChannel& frontend, InspectorClient& client)
{
    ASSERT(!m_frontends.contains(&frontend));
    m_client = &client;
    m_frontends.append(&frontend);
    if (m_frontends.size() == 1)
        Engine::inspector_did_connect_first_frontend(m_backend, &m_globalObject);
}

void JSGlobalObjectInspectorController::disconnectFrontend(FrontendChannel& frontend)
{
    ASSERT(m_frontends.contains(&frontend));
    Engine::inspector_will_disconnect_frontend(m_backend, &m_globalObject);
    for (auto& agent : m_agents)
        agent->setEnabled(false);
    m_frontends.removeFirstMatching([&](auto* it) { return it == &frontend; });
    if (m_frontends.isEmpty())
        Engine::inspector_did_disconnect_last_frontend(m_backend);
}

void JSGlobalObjectInspectorController::sendMessageToFrontends(const String& message)
{
    for (auto* frontend : m_frontends)
        frontend->sendMessageToFrontend(message);
}

// JSON-RPC 2.0, section 5.1.
static Ref<JSON::Object> protocolError(int code, const String& message)
{
    auto describe = [&] {
        auto error = JSON::Object::create();
        error->setInteger("code"_s, code);
        error->setString("message"_s, message);
        return error;
    };
    auto causes = JSON::Array::create();
    causes->pushValue(describe());
    auto error = describe();
    error->setArray("data"_s, WTF::move(causes));
    return error;
}

bool JSGlobalObjectInspectorController::dispatchToAgent(int requestId, StringView domain, StringView command)
{
    constexpr int methodNotFound = -32601;
    constexpr int serverError = -32000;

    size_t index = m_agents.findIf([&](auto& agent) { return domain == agent->m_domain; });
    if (index == notFound)
        return false;
    auto result = m_agents[index]->dispatch(command);
    auto response = JSON::Object::create();
    if (!result)
        response->setObject("error"_s, protocolError(methodNotFound, makeString('\'', domain, '.', command, "' was not found"_s)));
    else if (!*result)
        response->setObject("error"_s, protocolError(serverError, result->error()));
    else
        response->setObject("result"_s, WTF::move(**result));
    response->setInteger("id"_s, requestId);
    sendMessageToFrontends(response->toJSONString());
    return true;
}

extern "C" void engine_host_inspector_send(JSGlobalObjectInspectorController* controller, StringImpl* message)
{
    controller->sendMessageToFrontends(message);
}

extern "C" bool engine_host_inspector_has_frontend(JSGlobalObjectInspectorController* controller)
{
    return controller->hasFrontend();
}

extern "C" bool engine_host_inspector_dispatch(JSGlobalObjectInspectorController* controller, int requestId, StringImpl* domain, StringImpl* command)
{
    return controller->dispatchToAgent(requestId, *domain, *command);
}

extern "C" void engine_host_inspector_run_while_paused(JSGlobalObjectInspectorController* controller, bool* isDone)
{
    controller->client().runWhilePaused(controller->globalObject(), *isDone);
}

extern "C" void engine_host_inspector_frontend_initialized(JSGlobalObjectInspectorController* controller)
{
    controller->client().frontendInitialized();
}

extern "C" EncodedJSValue engine_host_inspector_subtype(JSGlobalObjectInspectorController* controller, JSGlobalObject* globalObject, EncodedJSValue value)
{
    return JSValue::encode(controller->client().subtype(globalObject, JSValue::decode(value)));
}

extern "C" EncodedJSValue engine_host_inspector_internal_properties(JSGlobalObjectInspectorController* controller, JSGlobalObject* globalObject, EncodedJSValue value)
{
    return JSValue::encode(controller->client().getInternalProperties(globalObject->vm(), globalObject, JSValue::decode(value)));
}

} // namespace Inspector

namespace JSC {

Inspector::JSGlobalObjectInspectorController& JSGlobalObject::inspectorController()
{
    if (!m_inspectorController)
        m_inspectorController = makeUnique<Inspector::JSGlobalObjectInspectorController>(*this);
    return *m_inspectorController;
}

class ScriptProfilingScope {
    WTF_MAKE_NONCOPYABLE(ScriptProfilingScope);

public:
    ScriptProfilingScope(JSGlobalObject* globalObject, ProfilingReason reason)
        : m_globalObject(globalObject)
        , m_reason(reason)
    {
        if (globalObject->hasInspectorController()) [[unlikely]]
            m_start = globalObject->inspectorController().willEvaluateScript();
    }
    ~ScriptProfilingScope()
    {
        if (m_start) [[unlikely]]
            m_globalObject->inspectorController().didEvaluateScript(*m_start, m_reason);
    }

private:
    JSGlobalObject* m_globalObject;
    ProfilingReason m_reason;
    std::optional<double> m_start;
};

JSValue callInInspectedRealm(JSGlobalObject* globalObject, ProfilingReason reason, JSValue function, const CallData& callData, JSValue thisValue, const ArgList& arguments)
{
    ScriptProfilingScope scope(globalObject, reason);
    return call(globalObject, function, callData, thisValue, arguments);
}

JSValue profiledCall(JSGlobalObject* globalObject, ProfilingReason reason, JSValue function, const CallData& callData, JSValue thisValue, const ArgList& arguments, NakedPtr<Exception>& returnedException)
{
    ScriptProfilingScope scope(globalObject, reason);
    return call(globalObject, function, callData, thisValue, arguments, returnedException);
}

} // namespace JSC
