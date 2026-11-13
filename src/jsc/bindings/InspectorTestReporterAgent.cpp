#include "InspectorTestReporterAgent.h"

#include <JavaScriptCore/InspectorFrontendRouter.h>
#include <JavaScriptCore/InspectorBackendDispatcher.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/text/WTFString.h>
#include <JavaScriptCore/ScriptCallStack.h>
#include <JavaScriptCore/JSGlobalObjectDebuggable.h>
#include <JavaScriptCore/JSGlobalObjectInspectorController.h>
#include "ZigGlobalObject.h"

#include "ModuleLoader.h"
#include <wtf/TZoneMallocInlines.h>

using namespace JSC;
using namespace Inspector;

namespace Inspector {

WTF_MAKE_TZONE_ALLOCATED_IMPL(InspectorTestReporterAgent);

// Rust bindings implementation
extern "C" {

void Bun__TestReporterAgentEnable(Inspector::InspectorTestReporterAgent* agent);
void Bun__TestReporterAgentDisable(Inspector::InspectorTestReporterAgent* agent);

enum class BunTestType : uint8_t {
    Test,
    Describe,
};

void Bun__TestReporterAgentReportTestFoundWithLocation(Inspector::InspectorTestReporterAgent* agent, int testId, const BunString* name, BunTestType item_type, int parentId, const BunString* sourceURL, int line)
{
    auto str = name->toWTFString(BunString::ZeroCopy);
    auto sourceURLStr = sourceURL->toWTFString(BunString::ZeroCopy);

    Protocol::TestReporter::TestType type;
    switch (item_type) {
    case BunTestType::Test:
        type = Protocol::TestReporter::TestType::Test;
        break;
    case BunTestType::Describe:
        type = Protocol::TestReporter::TestType::Describe;
        break;
    default:
        ASSERT_NOT_REACHED();
    }

    agent->reportTestFoundWithLocation(testId, str, type, parentId, sourceURLStr, line);
}

void Bun__TestReporterAgentReportTestStart(Inspector::InspectorTestReporterAgent* agent, int testId)
{
    agent->reportTestStart(testId);
}

enum class BunTestStatus : uint8_t {
    // this enum is kept in sync with `TestStatus` in src/jsc/Debugger.rs
    Pass,
    Fail,
    Timeout,
    Skip,
    Todo,
    SkippedBecauseLabel,
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
    case BunTestStatus::SkippedBecauseLabel:
        status = Protocol::TestReporter::TestStatus::Skipped_because_label;
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
    , m_backendDispatcher(TestReporterBackendDispatcher::create(m_globalObject.inspectorController().backendDispatcher(), this))
    , m_frontendDispatcher(makeUnique<TestReporterFrontendDispatcher>(const_cast<FrontendRouter&>(m_globalObject.inspectorController().frontendRouter())))
{
}

InspectorTestReporterAgent::~InspectorTestReporterAgent()
{
    if (m_enabled) {
        Bun__TestReporterAgentDisable(this);
    }
}

void InspectorTestReporterAgent::didCreateFrontendAndBackend()
{
}

void InspectorTestReporterAgent::willDestroyFrontendAndBackend(DisconnectReason)
{
    (void)disable();
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

void InspectorTestReporterAgent::reportTestFoundWithLocation(int testId, const String& name, Protocol::TestReporter::TestType type, int parentId, const String& sourceURL, int line)
{
    if (!m_enabled)
        return;

    m_frontendDispatcher->found(
        testId,
        String(), // scriptId. The url is always sent.
        sourceURL,
        line,
        name,
        type,
        parentId > 0 ? parentId : std::optional<int>());
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
