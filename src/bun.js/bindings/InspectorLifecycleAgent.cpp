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

void Bun__LifecycleAgentReportError(Inspector::InspectorLifecycleAgent* agent, ZigException* exception)
{
    ASSERT(exception);
    ASSERT(agent);

    agent->reportError(*exception);
}

void Bun__LifecycleAgentPreventExit(Inspector::InspectorLifecycleAgent* agent);
void Bun__LifecycleAgentStopPreventingExit(Inspector::InspectorLifecycleAgent* agent);
}

InspectorLifecycleAgent::InspectorLifecycleAgent(JSC::JSGlobalObject& globalObject)
    : InspectorAgentBase("LifecycleReporter"_s)
    , m_globalObject(globalObject)
    , m_backendDispatcher(LifecycleReporterBackendDispatcher::create(m_globalObject.inspectorController().backendDispatcher(), this))
    , m_frontendDispatcher(makeUnique<LifecycleReporterFrontendDispatcher>(const_cast<FrontendRouter&>(m_globalObject.inspectorController().frontendRouter())))
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
    if (!m_enabled)
        return;

    m_frontendDispatcher->reload();
}

void InspectorLifecycleAgent::reportError(ZigException& exception)
{
    if (!m_enabled)
        return;

    String message = exception.message.toWTFString();
    String name = exception.name.toWTFString();

    Ref<JSON::ArrayOf<String>> urls = JSON::ArrayOf<String>::create();
    Ref<JSON::ArrayOf<int>> lineColumns = JSON::ArrayOf<int>::create();
    Ref<JSON::ArrayOf<String>> sourceLines = JSON::ArrayOf<String>::create();

    for (size_t i = 0; i < exception.stack.source_lines_len; i++) {
        sourceLines->addItem(exception.stack.source_lines_ptr[i].toWTFString());
    }

    for (size_t i = 0; i < exception.stack.frames_len; i++) {
        ZigStackFrame* frame = &exception.stack.frames_ptr[i];
        lineColumns->addItem(frame->position.line_zero_based + 1);
        lineColumns->addItem(frame->position.column_zero_based + 1);
        urls->addItem(frame->source_url.toWTFString());
    }

    // error(const String& message, const String& name, Ref<JSON::ArrayOf<String>>&& urls, Ref<JSON::ArrayOf<int>>&& lineColumns, Ref<JSON::ArrayOf<String>>&& sourceLines);
    m_frontendDispatcher->error(WTFMove(message), WTFMove(name), WTFMove(urls), WTFMove(lineColumns), WTFMove(sourceLines));
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
