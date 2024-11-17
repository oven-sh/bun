#include "InspectorTestReporterAgent.h"

#include <JavaScriptCore/InspectorFrontendRouter.h>
#include <JavaScriptCore/InspectorBackendDispatcher.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/text/WTFString.h>
#include <JavaScriptCore/ScriptCallStack.h>
#include <JavaScriptCore/JSGlobalObjectDebuggable.h>
#include <JavaScriptCore/JSGlobalObjectInspectorController.h>
#include "ErrorStackTrace.h"
#include "ZigGlobalObject.h"

#include "ModuleLoader.h"

namespace Inspector {

// Zig bindings implementation
extern "C" {

void Bun__TestReporterAgentEnable(Inspector::InspectorTestReporterAgent* agent);
void Bun__TestReporterAgentDisable(Inspector::InspectorTestReporterAgent* agent);

void Bun__TestReporterAgentReportTestFound(Inspector::InspectorTestReporterAgent* agent, JSC::CallFrame* callFrame, int testId, int line, BunString* name)
{
    auto str = name->toWTFString(BunString::ZeroCopy);
    agent->reportTestFound(callFrame, testId, line, str);
}

void Bun__TestReporterAgentReportTestStart(Inspector::InspectorTestReporterAgent* agent, int testId)
{
    agent->reportTestStart(testId);
}

enum class BunTestStatus : uint8_t {
    Pass,
    Fail,
    Timeout,
    Skip,
    Todo,
};

void Bun__TestReporterAgentReportTestEnd(Inspector::InspectorTestReporterAgent* agent, int testId, BunTestStatus bunTestStatus, double elapsed)
{
    Protocol::TestReporter::TestStatus status;
    switch (bunTestStatus) {
    case BunTestStatus::Pass:
        status = Protocol::TestReporter::TestStatus::Pass;
        break;
    case BunTestStatus::Fail:
        status = Protocol::TestReporter::TestStatus::Fail;
        break;
    case BunTestStatus::Timeout:
        status = Protocol::TestReporter::TestStatus::Timeout;
        break;
    case BunTestStatus::Skip:
        status = Protocol::TestReporter::TestStatus::Skip;
        break;
    case BunTestStatus::Todo:
        status = Protocol::TestReporter::TestStatus::Todo;
        break;
    default:
        ASSERT_NOT_REACHED();
    }
    agent->reportTestEnd(testId, status, elapsed);
}
}

InspectorTestReporterAgent::InspectorTestReporterAgent(JSC::JSGlobalObject& globalObject)
    : InspectorAgentBase("TestReporter"_s)
    , m_globalObject(globalObject)
{
}

InspectorTestReporterAgent::~InspectorTestReporterAgent()
{
    if (m_enabled) {
        Bun__TestReporterAgentDisable(this);
    }
}

void InspectorTestReporterAgent::didCreateFrontendAndBackend(FrontendRouter* frontendRouter, BackendDispatcher* backendDispatcher)
{
    this->m_frontendDispatcher = makeUnique<TestReporterFrontendDispatcher>(const_cast<FrontendRouter&>(m_globalObject.inspectorController().frontendRouter()));
}

void InspectorTestReporterAgent::willDestroyFrontendAndBackend(DisconnectReason)
{
    disable();
    m_frontendDispatcher = nullptr;
}

Protocol::ErrorStringOr<void> InspectorTestReporterAgent::enable()
{
    if (m_enabled)
        return {};

    m_enabled = true;
    Bun__TestReporterAgentEnable(this);
    return {};
}

Protocol::ErrorStringOr<void> InspectorTestReporterAgent::disable()
{
    if (!m_enabled)
        return {};

    m_enabled = false;
    Bun__TestReporterAgentDisable(this);
    return {};
}

void InspectorTestReporterAgent::reportTestFound(JSC::CallFrame* callFrame, int testId, int line, const String& name)
{
    if (!m_enabled || !m_frontendDispatcher)
        return;

    JSC::LineColumn lineColumn;
    JSC::SourceID sourceID = 0;

    auto stackTrace = Zig::JSCStackTrace::captureCurrentJSStackTrace(defaultGlobalObject(&m_globalObject), callFrame, 1, {});
    if (stackTrace.size() > 0) {
        auto& frame = stackTrace.at(0);
        auto* sourcePositions = frame.getSourcePositions();
        if (sourcePositions) {
            lineColumn.line = sourcePositions->line.oneBasedInt();
            lineColumn.column = sourcePositions->column.oneBasedInt();
        }
        sourceID = frame.sourceID();
    }

    m_frontendDispatcher->found(testId, String::number(sourceID), sourceID != 0 ? lineColumn.line : -1, name);
}

void InspectorTestReporterAgent::reportTestStart(int testId)
{
    if (!m_enabled || !m_frontendDispatcher)
        return;

    m_frontendDispatcher->start(testId);
}

void InspectorTestReporterAgent::reportTestEnd(int testId, Protocol::TestReporter::TestStatus status, double elapsed)
{
    if (!m_enabled || !m_frontendDispatcher)
        return;

    m_frontendDispatcher->end(testId, status, elapsed);
}

} // namespace Inspector
