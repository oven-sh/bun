#include "InspectorLifecycleAgent.h"
#include "BunModuleRegistry.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/ModuleRegistryEntry.h>
#include <wtf/text/WTFString.h>
#include <wtf/TZoneMallocInlines.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/IterationKind.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include "BunProcess.h"
#include "headers.h"

namespace Inspector {

WTF_MAKE_TZONE_ALLOCATED_IMPL(InspectorLifecycleAgent);

// Rust bindings implementation
extern "C" {

void Bun__LifecycleAgentEnable(Inspector::InspectorLifecycleAgent* agent);
void Bun__LifecycleAgentDisable(Inspector::InspectorLifecycleAgent* agent);

void Bun__LifecycleAgentReportError(Inspector::InspectorLifecycleAgent* agent, ZigException* exception)
{
    ASSERT(exception);
    ASSERT(agent);

    agent->reportError(*exception);
}
}

InspectorLifecycleAgent::InspectorLifecycleAgent(JSC::JSGlobalObject& globalObject)
    : InspectorAgentBase(globalObject, "LifecycleReporter"_s)
{
}

void InspectorLifecycleAgent::didEnable()
{
    Bun__LifecycleAgentEnable(this);
}

void InspectorLifecycleAgent::didDisable()
{
    Bun__LifecycleAgentDisable(this);
}

std::optional<CommandResult> InspectorLifecycleAgent::runCommand(StringView command)
{
    if (command == "getModuleGraph"_s)
        return getModuleGraph();
    if (command == "preventExit"_s || command == "stopPreventingExit"_s)
        return JSON::Object::create();
    return std::nullopt;
}

void InspectorLifecycleAgent::reportError(ZigException& exception)
{
    if (!isEnabled())
        return;

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

    auto parameters = JSON::Object::create();
    parameters->setString("message"_s, exception.message.toWTFString());
    parameters->setString("name"_s, exception.name.toWTFString());
    parameters->setArray("urls"_s, WTF::move(urls));
    parameters->setArray("lineColumns"_s, WTF::move(lineColumns));
    parameters->setArray("sourceLines"_s, WTF::move(sourceLines));
    sendEvent("error"_s, WTF::move(parameters));
}

CommandResult InspectorLifecycleAgent::getModuleGraph()
{
    auto& vm = globalObject().vm();
    // The caller is the protocol dispatcher, which never does
    // exception checks, so exceptions must not escape this function: report
    // them as a protocol error and clear them (keeping only termination).
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto fail = [&](WTF::ASCIILiteral message) {
        (void)scope.tryClearException();
        return makeUnexpected(ErrorString { message });
    };

    auto* global = defaultGlobalObject(&globalObject());
    auto* cjsMap = global->requireMap();

    Ref<JSON::ArrayOf<String>> esm = JSON::ArrayOf<String>::create();
    {
        Vector<String> keys;
        Bun::forEachModuleRegistrySpecifier(global->moduleLoader(), [&](UniquedStringImpl* specifier, JSC::ModuleRegistryEntry*) {
            keys.append(String { specifier });
        });
        // ModuleMap is hash-ordered; sort so the inspector output is stable.
        std::sort(keys.begin(), keys.end(), WTF::codePointCompareLessThan);
        for (auto& k : keys)
            esm->addItem(k);
    }

    Ref<JSON::ArrayOf<String>> cjs = JSON::ArrayOf<String>::create();
    {
        auto iter2 = JSC::JSMapIterator::create(vm, global->mapIteratorStructure(), cjsMap, JSC::IterationKind::Keys);
        RETURN_IF_EXCEPTION(scope, fail("Failed to create iterator"_s));
        JSC::JSValue value;
        while (iter2->next(global, value)) {
            RETURN_IF_EXCEPTION(scope, fail("Failed to iterate over cjs map"_s));
            cjs->addItem(value.toWTFString(global));
            RETURN_IF_EXCEPTION(scope, fail("Failed to add item to cjs array"_s));
        }
        RETURN_IF_EXCEPTION(scope, fail("Failed to iterate over cjs map"_s));
    }

    auto* process = global->processObject();

    Ref<JSON::ArrayOf<String>> argv = JSON::ArrayOf<String>::create();
    {
        // process.argv is writable, so this can be any value.
        auto argvValue = process->getArgv(global);
        RETURN_IF_EXCEPTION(scope, fail("Failed to get argv"_s));
        if (auto* array = dynamicDowncast<JSC::JSArray>(argvValue)) {
            for (size_t i = 0, length = array->length(); i < length; i++) {
                auto value = array->getIndex(global, i);
                RETURN_IF_EXCEPTION(scope, fail("Failed to get value at index"_s));
                auto string = value.toWTFString(global);
                RETURN_IF_EXCEPTION(scope, fail("Failed to convert value to string"_s));
                argv->addItem(string);
            }
        }
    }

    String main;
    {
        auto& builtinNames = Bun::builtinNames(vm);
        auto value = global->bunObject()->get(global, builtinNames.mainPublicName());
        RETURN_IF_EXCEPTION(scope, fail("Failed to get main"_s));
        main = value.toWTFString(global);
        RETURN_IF_EXCEPTION(scope, fail("Failed to convert value to string"_s));
    }

    String cwd;
    {
        auto cwdValue = JSC::JSValue::decode(Bun__Process__getCwd(&globalObject()));
        RETURN_IF_EXCEPTION(scope, fail("Failed to get cwd"_s));
        cwd = cwdValue.toWTFString(global);
        RETURN_IF_EXCEPTION(scope, fail("Failed to convert value to string"_s));
    }

    auto graph = JSON::Object::create();
    graph->setArray("esm"_s, WTF::move(esm));
    graph->setArray("cjs"_s, WTF::move(cjs));
    graph->setString("cwd"_s, cwd);
    graph->setString("main"_s, main);
    graph->setArray("argv"_s, WTF::move(argv));
    return graph;
}

}
