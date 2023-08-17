#include "helpers.h"
#include "headers.h"

#include "JavaScriptCore/ConsoleClient.h"
#include "JavaScriptCore/ConsoleMessage.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/ScriptArguments.h"
#include "ZigConsoleClient.h"
#include "wtf/text/WTFString.h"

#undef ENABLE_INSPECTOR_ALTERNATE_DISPATCHERS

#include "JavaScriptCore/JSGlobalObjectInspectorController.h"
#include "JavaScriptCore/JSGlobalObjectDebuggable.h"
#include "JavaScriptCore/ConsoleClient.h"

#include "GCDefferalContext.h"

using ScriptArguments = Inspector::ScriptArguments;
using MessageType = JSC::MessageType;
using MessageLevel = JSC::MessageLevel;
using JSGlobalObject = JSC__JSGlobalObject;

using String = WTF::String;

extern "C" {
}

void Zig::ConsoleClient::messageWithTypeAndLevel(MessageType type, MessageLevel level,
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

    auto scope = DECLARE_CATCH_SCOPE(vm);
    Zig__ConsoleClient__messageWithTypeAndLevel(this->m_client, static_cast<uint32_t>(type),
        static_cast<uint32_t>(level), globalObject, jsArgs,
        count);
    scope.clearException();
}
void Zig::ConsoleClient::count(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Zig__ConsoleClient__count(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}

void Zig::ConsoleClient::countReset(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Zig__ConsoleClient__countReset(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void Zig::ConsoleClient::profile(JSC::JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Zig__ConsoleClient__profile(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void Zig::ConsoleClient::profileEnd(JSC::JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Zig__ConsoleClient__profileEnd(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void Zig::ConsoleClient::takeHeapSnapshot(JSC::JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Zig__ConsoleClient__takeHeapSnapshot(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void Zig::ConsoleClient::time(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Zig__ConsoleClient__time(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void Zig::ConsoleClient::timeLog(JSGlobalObject* globalObject, const String& label,
    Ref<ScriptArguments>&& arguments)
{
    auto input = label.tryGetUTF8().value();
    Zig__ConsoleClient__timeLog(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length(), arguments.ptr());
}
void Zig::ConsoleClient::timeEnd(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUTF8().value();
    Zig__ConsoleClient__timeEnd(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void Zig::ConsoleClient::timeStamp(JSGlobalObject* globalObject, Ref<ScriptArguments>&& args)
{
    Zig__ConsoleClient__timeStamp(this->m_client, globalObject, args.ptr());
}
void Zig::ConsoleClient::record(JSGlobalObject*, Ref<ScriptArguments>&&) {}
void Zig::ConsoleClient::recordEnd(JSGlobalObject*, Ref<ScriptArguments>&&) {}
void Zig::ConsoleClient::screenshot(JSGlobalObject*, Ref<ScriptArguments>&&) {}
void Zig::ConsoleClient::warnUnimplemented(const String& method) {}