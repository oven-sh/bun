#include "InspectorLifecycleAgent.h"

#include <JavaScriptCore/InspectorFrontendRouter.h>
#include <JavaScriptCore/InspectorBackendDispatcher.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/text/WTFString.h>
#include <JavaScriptCore/ScriptCallStackFactory.h>
#include <JavaScriptCore/ScriptArguments.h>
#include <JavaScriptCore/ConsoleMessage.h>
#include <JavaScriptCore/InspectorConsoleAgent.h>
#include <JavaScriptCore/JSGlobalObjectDebuggable.h>
#include <JavaScriptCore/JSGlobalObjectInspectorController.h>
#include "ConsoleObject.h"
namespace Inspector {

// Zig bindings implementation
extern "C" {

void Bun__LifecycleAgentEnable(Inspector::InspectorLifecycleAgent* agent);
void Bun__LifecycleAgentDisable(Inspector::InspectorLifecycleAgent* agent);

void Bun__LifecycleAgentReportReload(Inspector::InspectorLifecycleAgent* agent)
{
    agent->reportReload();
}

void Bun__LifecycleAgentReportError(Inspector::InspectorLifecycleAgent* agent, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue errorOrExceptionEncoded)
{
    JSC::JSValue errorOrException = JSC::JSValue::decode(errorOrExceptionEncoded);
    ASSERT(errorOrException);

    agent->reportError(*globalObject, errorOrException);
}

void Bun__LifecycleAgentPreventExit(Inspector::InspectorLifecycleAgent* agent);
void Bun__LifecycleAgentStopPreventingExit(Inspector::InspectorLifecycleAgent* agent);
}

InspectorLifecycleAgent::InspectorLifecycleAgent(JSC::JSGlobalObject& globalObject)
    : InspectorAgentBase("LifecycleReporter"_s)
    , m_globalObject(globalObject)
{
}

InspectorLifecycleAgent::~InspectorLifecycleAgent()
{
    if (m_enabled) {
        Bun__LifecycleAgentDisable(this);
    }
}

void InspectorLifecycleAgent::didCreateFrontendAndBackend(FrontendRouter*, BackendDispatcher*)
{
    this->m_frontendDispatcher = makeUnique<LifecycleReporterFrontendDispatcher>(const_cast<FrontendRouter&>(m_globalObject.inspectorController().frontendRouter()));
}

void InspectorLifecycleAgent::willDestroyFrontendAndBackend(DisconnectReason)
{
    disable();
}

Protocol::ErrorStringOr<void> InspectorLifecycleAgent::enable()
{
    if (m_enabled)
        return {};

    m_enabled = true;
    Bun__LifecycleAgentEnable(this);
    return {};
}

Protocol::ErrorStringOr<void> InspectorLifecycleAgent::disable()
{
    if (!m_enabled)
        return {};

    m_enabled = false;
    Bun__LifecycleAgentDisable(this);
    return {};
}

void InspectorLifecycleAgent::reportReload()
{
    if (!m_enabled || !m_frontendDispatcher)
        return;

    m_frontendDispatcher->reload();
}

void InspectorLifecycleAgent::reportError(JSC::JSGlobalObject& globalObject, JSC::JSValue errorOrException)
{
    if (!m_enabled || !m_frontendDispatcher)
        return;

    auto* cell = errorOrException.asCell();

    Ref<ScriptCallStack> callStack = ScriptCallStack::create();

    WTF::String message;
    JSC::JSValue valueForMessage = errorOrException;

    if (cell) {
        if (cell->inherits<JSC::Exception>()) {
            auto* exception = static_cast<JSC::Exception*>(cell);
            callStack = Inspector::createScriptCallStackFromException(&globalObject, exception);
            JSC::JSValue value = exception->value();
            valueForMessage = value;
        } else if (auto* error = JSC::jsDynamicCast<JSC::ErrorInstance*>(cell)) {
            if (error->stackTrace()) {
                auto& stackTrace = *error->stackTrace();
                callStack = Inspector::createScriptCallStackFromStackTrace(&globalObject, { stackTrace.begin(), stackTrace.end() }, error);
                message = error->sanitizedToString(&globalObject);
            }
        }
    }

    if (!message) {
        message = valueForMessage.toWTFStringForConsole(&globalObject);
    }

    auto consoleMessage = Protocol::Console::ConsoleMessage::create()
                              .setLevel(Protocol::Console::ConsoleMessage::Level::Error)
                              .setText(message)
                              .setSource(Protocol::Console::ChannelSource::Other)
                              .release();

    consoleMessage->setStackTrace(callStack->buildInspectorObject());

    m_frontendDispatcher->error(WTFMove(consoleMessage));
}

Protocol::ErrorStringOr<void> InspectorLifecycleAgent::preventExit()
{
    m_preventingExit = true;
    return {};
}

Protocol::ErrorStringOr<void> InspectorLifecycleAgent::stopPreventingExit()
{
    m_preventingExit = false;
    return {};
}

} // namespace Inspector
