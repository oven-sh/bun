#include "InspectorTestReporterAgent.h"

#include <JavaScriptCore/JSGlobalObject.h>
#include <wtf/text/WTFString.h>
#include "ErrorStackTrace.h"
#include "ZigGlobalObject.h"

#include "ModuleLoader.h"
#include <wtf/TZoneMallocInlines.h>

using namespace JSC;
using namespace Inspector;

namespace Inspector {

WTF_MAKE_TZONE_ALLOCATED_IMPL(InspectorTestReporterAgent);

enum class BunTestType : uint8_t {
    Test,
    Describe,
};

static ASCIILiteral protocolName(BunTestType type)
{
    return type == BunTestType::Test ? "test"_s : "describe"_s;
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

static ASCIILiteral protocolName(BunTestStatus status)
{
    switch (status) {
    case BunTestStatus::Pass:
        return "pass"_s;
    case BunTestStatus::Fail:
        return "fail"_s;
    case BunTestStatus::Timeout:
        return "timeout"_s;
    case BunTestStatus::Skip:
        return "skip"_s;
    case BunTestStatus::Todo:
        return "todo"_s;
    case BunTestStatus::SkippedBecauseLabel:
        return "skipped_because_label"_s;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

// Rust bindings implementation
extern "C" {

void Bun__TestReporterAgentEnable(Inspector::InspectorTestReporterAgent* agent);
void Bun__TestReporterAgentDisable(Inspector::InspectorTestReporterAgent* agent);

void Bun__TestReporterAgentReportTestFound(Inspector::InspectorTestReporterAgent* agent, int testId, const BunString* name, BunTestType item_type, int parentId)
{
    agent->reportTestFound(testId, name->toWTFString(BunString::ZeroCopy), protocolName(item_type), parentId);
}

void Bun__TestReporterAgentReportTestFoundWithLocation(Inspector::InspectorTestReporterAgent* agent, int testId, const BunString* name, BunTestType item_type, int parentId, const BunString* sourceURL, int line)
{
    // The script is not known of a test that is reported in retrospect.
    agent->reportTestFoundWithLocation(testId, name->toWTFString(BunString::ZeroCopy), protocolName(item_type), parentId, String(), sourceURL->toWTFString(BunString::ZeroCopy), line);
}

void Bun__TestReporterAgentReportTestStart(Inspector::InspectorTestReporterAgent* agent, int testId)
{
    agent->reportTestStart(testId);
}

void Bun__TestReporterAgentReportTestEnd(Inspector::InspectorTestReporterAgent* agent, int testId, BunTestStatus bunTestStatus, double elapsed)
{
    agent->reportTestEnd(testId, protocolName(bunTestStatus), elapsed);
}
}

InspectorTestReporterAgent::InspectorTestReporterAgent(JSC::JSGlobalObject& globalObject)
    : InspectorAgentBase(globalObject, "TestReporter"_s)
{
}

void InspectorTestReporterAgent::didEnable()
{
    Bun__TestReporterAgentEnable(this);
}

void InspectorTestReporterAgent::didDisable()
{
    Bun__TestReporterAgentDisable(this);
}

void InspectorTestReporterAgent::reportTestFound(int testId, const String& name, ASCIILiteral type, int parentId)
{
    if (!isEnabled())
        return;

    JSC::LineColumn lineColumn;
    JSC::SourceID sourceID = 0;
    String sourceURL;

    auto* globalObject = &this->globalObject();
    auto& vm = JSC::getVM(globalObject);

    JSC::StackVisitor::visit(vm.topCallFrame, vm, [&](JSC::StackVisitor& visitor) -> WTF::IterationStatus {
        if (Zig::isImplementationVisibilityPrivate(visitor))
            return WTF::IterationStatus::Continue;

        if (visitor->hasLineAndColumnInfo()) {
            lineColumn = visitor->computeLineAndColumn();

            String sourceURLForFrame = Zig::sourceURL(visitor);

            // Sometimes, the sourceURL is empty.
            // For example, pages in Next.js.
            if (auto* codeBlock = sourceURLForFrame.isEmpty() ? visitor->codeBlock() : nullptr) {
                const auto& source = codeBlock->source();

                // source.isNull() is true when the SourceProvider is a null pointer.
                if (!source.isNull()) {
                    auto* provider = source.provider();
                    sourceID = provider->asID();
                }
            }

            sourceURL = sourceURLForFrame;

            return WTF::IterationStatus::Done;
        }

        return WTF::IterationStatus::Continue;
    });

    if (!sourceURL.isEmpty() and lineColumn.line > 0) {
        OrdinalNumber originalLine = OrdinalNumber::fromOneBasedInt(lineColumn.line);
        OrdinalNumber originalColumn = OrdinalNumber::fromOneBasedInt(lineColumn.column);

        ZigStackFrame remappedFrame;
        remappedFrame.position.line_zero_based = originalLine.zeroBasedInt();
        remappedFrame.position.column_zero_based = originalColumn.zeroBasedInt();
        remappedFrame.source_url = Bun::toStringRef(sourceURL);

        Bun__remapStackFramePositions(Bun::vm(globalObject), &remappedFrame, 1);

        sourceURL = remappedFrame.source_url.toWTFString();
        lineColumn.line = OrdinalNumber::fromZeroBasedInt(remappedFrame.position.line_zero_based).oneBasedInt();
        lineColumn.column = OrdinalNumber::fromZeroBasedInt(remappedFrame.position.column_zero_based).oneBasedInt();
    }

    reportTestFoundWithLocation(testId, name, type, parentId, sourceID > 0 ? String::number(sourceID) : String(), sourceURL, lineColumn.line);
}

void InspectorTestReporterAgent::reportTestFoundWithLocation(int testId, const String& name, ASCIILiteral type, int parentId, const String& scriptId, const String& sourceURL, int line)
{
    if (!isEnabled())
        return;

    auto parameters = JSON::Object::create();
    parameters->setInteger("id"_s, testId);
    if (!scriptId.isNull())
        parameters->setString("scriptId"_s, scriptId);
    if (!sourceURL.isNull())
        parameters->setString("url"_s, sourceURL);
    parameters->setInteger("line"_s, line);
    if (!name.isNull())
        parameters->setString("name"_s, name);
    parameters->setString("type"_s, type);
    if (parentId > 0)
        parameters->setInteger("parentId"_s, parentId);
    sendEvent("found"_s, WTF::move(parameters));
}

void InspectorTestReporterAgent::reportTestStart(int testId)
{
    if (!isEnabled())
        return;

    auto parameters = JSON::Object::create();
    parameters->setInteger("id"_s, testId);
    sendEvent("start"_s, WTF::move(parameters));
}

void InspectorTestReporterAgent::reportTestEnd(int testId, ASCIILiteral status, double elapsed)
{
    if (!isEnabled())
        return;

    auto parameters = JSON::Object::create();
    parameters->setInteger("id"_s, testId);
    parameters->setString("status"_s, status);
    parameters->setInteger("elapsed"_s, clampTo<int>(elapsed));
    sendEvent("end"_s, WTF::move(parameters));
}

} // namespace Inspector
