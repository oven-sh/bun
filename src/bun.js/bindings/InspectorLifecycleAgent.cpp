#include "InspectorLifecycleAgent.h"
#include "ZigGlobalObject.h"
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
#include <wtf/TZoneMallocInlines.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/IterationKind.h>
#include "BunProcess.h"
#include "headers.h"

namespace Inspector {

WTF_MAKE_TZONE_ALLOCATED_IMPL(InspectorLifecycleAgent);

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

using ModuleGraph = std::tuple<Ref<JSON::ArrayOf<String>> /* esm */, Ref<JSON::ArrayOf<String>> /* cjs */, String /* cwd */, String /* main */, Ref<JSON::ArrayOf<String>> /* argv */>;

Protocol::ErrorStringOr<ModuleGraph> InspectorLifecycleAgent::getModuleGraph()
{
    auto& vm = m_globalObject.vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* global = defaultGlobalObject(&m_globalObject);
    auto* esmMap = global->esmRegistryMap();
    auto* cjsMap = global->requireMap();

    if (!esmMap || !cjsMap) {
        return makeUnexpected(ErrorString("Module graph not available"_s));
    }

    Ref<JSON::ArrayOf<String>> esm = JSON::ArrayOf<String>::create();
    {
        auto iter1 = JSC::JSMapIterator::create(global, global->mapIteratorStructure(), esmMap, JSC::IterationKind::Keys);
        RETURN_IF_EXCEPTION(scope, makeUnexpected(ErrorString("Failed to create iterator"_s)));
        JSC::JSValue value;
        while (iter1->next(global, value)) {
            esm->addItem(value.toWTFString(global));
            RETURN_IF_EXCEPTION(scope, makeUnexpected(ErrorString("Failed to add item to esm array"_s)));
        }
    }

    Ref<JSON::ArrayOf<String>> cjs = JSON::ArrayOf<String>::create();
    {
        auto iter2 = JSC::JSMapIterator::create(global, global->mapIteratorStructure(), cjsMap, JSC::IterationKind::Keys);
        RETURN_IF_EXCEPTION(scope, makeUnexpected(ErrorString("Failed to create iterator"_s)));
        JSC::JSValue value;
        while (iter2->next(global, value)) {
            cjs->addItem(value.toWTFString(global));
            RETURN_IF_EXCEPTION(scope, makeUnexpected(ErrorString("Failed to add item to cjs array"_s)));
        }
    }

    auto* process = global->processObject();

    Ref<JSON::ArrayOf<String>> argv = JSON::ArrayOf<String>::create();
    {

        auto* array = jsCast<JSC::JSArray*>(process->getArgv(global));
        RETURN_IF_EXCEPTION(scope, makeUnexpected(ErrorString("Failed to get argv"_s)));
        for (size_t i = 0, length = array->length(); i < length; i++) {
            auto value = array->getIndex(global, i);
            RETURN_IF_EXCEPTION(scope, makeUnexpected(ErrorString("Failed to get value at index"_s)));
            auto string = value.toWTFString(global);
            RETURN_IF_EXCEPTION(scope, makeUnexpected(ErrorString("Failed to convert value to string"_s)));
            argv->addItem(string);
        }
    }

    String main;
    {
        auto& builtinNames = Bun::builtinNames(vm);
        auto value = global->bunObject()->get(global, builtinNames.mainPublicName());
        RETURN_IF_EXCEPTION(scope, makeUnexpected(ErrorString("Failed to get main"_s)));
        main = value.toWTFString(global);
        RETURN_IF_EXCEPTION(scope, makeUnexpected(ErrorString("Failed to convert value to string"_s)));
    }

    String cwd;
    {
        auto cwdValue = JSC::JSValue::decode(Bun__Process__getCwd(&m_globalObject));
        RETURN_IF_EXCEPTION(scope, makeUnexpected(ErrorString("Failed to get cwd"_s)));
        cwd = cwdValue.toWTFString(global);
        RETURN_IF_EXCEPTION(scope, makeUnexpected(ErrorString("Failed to convert value to string"_s)));
    }

    return ModuleGraph { WTFMove(esm), WTFMove(cjs), WTFMove(cwd), WTFMove(main), WTFMove(argv) };
}

}
