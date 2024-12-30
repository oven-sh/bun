#include "root.h"

#include "JavaScriptCore/ArgList.h"
#include "headers.h"
#include "ConsoleObject.h"

#include <JavaScriptCore/ConsoleClient.h>
#include <JavaScriptCore/ConsoleMessage.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/ScriptArguments.h>
#include <wtf/text/WTFString.h>

#include <JavaScriptCore/JSGlobalObjectInspectorController.h>
#include <JavaScriptCore/JSGlobalObjectDebuggable.h>
#include <JavaScriptCore/ConsoleClient.h>

#include "GCDefferalContext.h"
#include <JavaScriptCore/InspectorScriptProfilerAgent.h>
#include <JavaScriptCore/InspectorDebuggerAgent.h>
#include <JavaScriptCore/InspectorConsoleAgent.h>

namespace Bun {
using namespace JSC;
using namespace Inspector;

using ScriptArguments = Inspector::ScriptArguments;
using MessageType = JSC::MessageType;
using MessageLevel = JSC::MessageLevel;
using JSGlobalObject = JSC__JSGlobalObject;

using String = WTF::String;

void ConsoleObject::messageWithTypeAndLevel(MessageType type, MessageLevel level,
    JSC::JSGlobalObject* globalObject,
    Ref<ScriptArguments>&& arguments)
{
    if (globalObject->inspectable()) {
        if (auto* client = globalObject->inspectorController().consoleClient().get()) {
            client->messageWithTypeAndLevel(type, level, globalObject, arguments.copyRef());
        }
    }
    JSC::VM& vm = globalObject->vm();
    auto args = arguments.ptr();
    JSC__JSValue jsArgs[255];

    auto count = std::min(args->argumentCount(), (size_t)255);
    for (size_t i = 0; i < count; i++) {
        auto val = args->argumentAt(i);
        jsArgs[i] = JSC::JSValue::encode(val);
    }

    if (UNLIKELY(type == MessageType::Table && count >= 2 && !args->argumentAt(1).isUndefined() && (!args->argumentAt(1).isCell() || args->argumentAt(1).asCell()->type() != JSC::JSType::ArrayType))) {
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSC::throwTypeError(globalObject, scope, "The \"properties\" argument must be an instance of Array."_s);
        return;
    }

    Bun__ConsoleObject__messageWithTypeAndLevel(this->m_client, static_cast<uint32_t>(type), static_cast<uint32_t>(level), globalObject, jsArgs, count);
}
void ConsoleObject::count(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Bun__ConsoleObject__count(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}

void ConsoleObject::countReset(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Bun__ConsoleObject__countReset(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}

void ConsoleObject::takeHeapSnapshot(JSC::JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Bun__ConsoleObject__takeHeapSnapshot(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void ConsoleObject::time(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Bun__ConsoleObject__time(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void ConsoleObject::timeLog(JSGlobalObject* globalObject, const String& label,
    Ref<ScriptArguments>&& arguments)
{
    auto input = label.tryGetUTF8().value();

    auto args = arguments.ptr();
    JSC__JSValue jsArgs[255];
    auto count = std::min(args->argumentCount(), (size_t)255);
    for (size_t i = 0; i < count; i++) {
        auto val = args->argumentAt(i);
        jsArgs[i] = JSC::JSValue::encode(val);
    }

    Bun__ConsoleObject__timeLog(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length(), jsArgs, count);
}
void ConsoleObject::timeEnd(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Bun__ConsoleObject__timeEnd(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void ConsoleObject::timeStamp(JSGlobalObject* globalObject, Ref<ScriptArguments>&& args)
{
    Bun__ConsoleObject__timeStamp(this->m_client, globalObject, args.ptr());
}
void ConsoleObject::record(JSGlobalObject*, Ref<ScriptArguments>&&) {}
void ConsoleObject::recordEnd(JSGlobalObject*, Ref<ScriptArguments>&&) {}
void ConsoleObject::screenshot(JSGlobalObject*, Ref<ScriptArguments>&&)
{
}
void ConsoleObject::warnUnimplemented(const String& method) {}

void ConsoleObject::profile(JSC::JSGlobalObject* globalObject, const String& title)
{
    if (globalObject->inspectable()) {
        if (auto* client = globalObject->inspectorController().consoleClient().get()) {
            client->profile(globalObject, title);
        }
    }
}

void ConsoleObject::profileEnd(JSC::JSGlobalObject* globalObject, const String& title)
{
    if (globalObject->inspectable()) {
        if (auto* client = globalObject->inspectorController().consoleClient().get()) {
            client->profileEnd(globalObject, title);
        }
    }
}

}
