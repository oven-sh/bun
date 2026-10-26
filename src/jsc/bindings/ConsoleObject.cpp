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
using JSGlobalObject = JSC::JSGlobalObject;

using String = WTF::String;

// A call with at most this many arguments copies them to the stack and allocates nothing.
static constexpr size_t stackArgumentCapacity = 255;

// Copies every argument into `values`, which the GC scans.
static void copyArguments(JSC::JSGlobalObject* globalObject, const ScriptArguments& arguments, JSC::MarkedVector<JSC::JSValue>& values)
{
    size_t count = arguments.argumentCount();
    // Crashes if it cannot allocate, as the Vector inside `arguments` does.
    values.fill(JSC::getVM(globalObject), count, [&](JSC::JSValue* slots) {
        for (size_t i = 0; i < count; i++)
            slots[i] = arguments.argumentAt(i);
    });
}

static NEVER_INLINE void messageWithHeapArguments(void* client, MessageType type, MessageLevel level, JSC::JSGlobalObject* globalObject, const ScriptArguments& arguments)
{
    JSC::MarkedVector<JSC::JSValue> values;
    copyArguments(globalObject, arguments, values);
    Bun__ConsoleObject__messageWithTypeAndLevel(client, static_cast<uint32_t>(type), static_cast<uint32_t>(level), globalObject, values.data<JSC::EncodedJSValue>(), values.size());
}

static NEVER_INLINE void timeLogWithHeapArguments(void* client, JSC::JSGlobalObject* globalObject, const BunString* label, const ScriptArguments& arguments)
{
    JSC::MarkedVector<JSC::JSValue> values;
    copyArguments(globalObject, arguments, values);
    Bun__ConsoleObject__timeLog(client, globalObject, label, values.data<JSC::EncodedJSValue>(), values.size());
}

void ConsoleObject::messageWithTypeAndLevel(MessageType type, MessageLevel level,
    JSC::JSGlobalObject* globalObject,
    Ref<ScriptArguments>&& arguments)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (globalObject->inspectable()) {
        if (auto client = globalObject->inspectorController().consoleClient()) {
            client->messageWithTypeAndLevel(type, level, globalObject, arguments.copyRef());
            RETURN_IF_EXCEPTION(scope, );
        }
    }
    auto args = arguments.ptr();
    auto count = args->argumentCount();

    if (type == MessageType::Table && count >= 2 && !args->argumentAt(1).isUndefined() && (!args->argumentAt(1).isCell() || args->argumentAt(1).asCell()->type() != JSC::JSType::ArrayType)) [[unlikely]] {
        JSC::throwTypeError(globalObject, scope, "The \"properties\" argument must be an instance of Array."_s);
        return;
    }

    if (count > stackArgumentCapacity) [[unlikely]]
        RELEASE_AND_RETURN(scope, messageWithHeapArguments(this->m_client, type, level, globalObject, *args));

    JSC::EncodedJSValue jsArgs[stackArgumentCapacity];
    for (size_t i = 0; i < count; i++) {
        auto val = args->argumentAt(i);
        jsArgs[i] = JSC::JSValue::encode(val);
    }

    RELEASE_AND_RETURN(scope, Bun__ConsoleObject__messageWithTypeAndLevel(this->m_client, static_cast<uint32_t>(type), static_cast<uint32_t>(level), globalObject, jsArgs, count));
}
void ConsoleObject::count(JSGlobalObject* globalObject, const String& label)
{
    auto input = Bun::toString(label);
    Bun__ConsoleObject__count(this->m_client, globalObject, &input);
}

void ConsoleObject::countReset(JSGlobalObject* globalObject, const String& label)
{
    auto input = Bun::toString(label);
    Bun__ConsoleObject__countReset(this->m_client, globalObject, &input);
}

void ConsoleObject::takeHeapSnapshot(JSC::JSGlobalObject* globalObject, const String&)
{
    Bun__ConsoleObject__takeHeapSnapshot(this->m_client, globalObject);
}
void ConsoleObject::time(JSGlobalObject* globalObject, const String& label)
{
    auto input = Bun::toString(label);
    Bun__ConsoleObject__time(this->m_client, globalObject, &input);
}
void ConsoleObject::timeLog(JSGlobalObject* globalObject, const String& label,
    Ref<ScriptArguments>&& arguments)
{
    auto input = Bun::toString(label);

    auto args = arguments.ptr();
    auto count = args->argumentCount();
    if (count > stackArgumentCapacity) [[unlikely]] {
        timeLogWithHeapArguments(this->m_client, globalObject, &input, *args);
        return;
    }

    JSC::EncodedJSValue jsArgs[stackArgumentCapacity];
    for (size_t i = 0; i < count; i++) {
        auto val = args->argumentAt(i);
        jsArgs[i] = JSC::JSValue::encode(val);
    }

    Bun__ConsoleObject__timeLog(this->m_client, globalObject, &input, jsArgs, count);
}
void ConsoleObject::timeEnd(JSGlobalObject* globalObject, const String& label)
{
    auto input = Bun::toString(label);
    Bun__ConsoleObject__timeEnd(this->m_client, globalObject, &input);
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

void ConsoleObject::profile(JSC::JSGlobalObject* globalObject, const String& title)
{
    if (globalObject->inspectable()) {
        if (auto client = globalObject->inspectorController().consoleClient()) {
            client->profile(globalObject, title);
        }
    }
}

void ConsoleObject::profileEnd(JSC::JSGlobalObject* globalObject, const String& title)
{
    if (globalObject->inspectable()) {
        if (auto client = globalObject->inspectorController().consoleClient()) {
            client->profileEnd(globalObject, title);
        }
    }
}

}
