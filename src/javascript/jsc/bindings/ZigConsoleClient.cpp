#include "helpers.h"

#include "JavaScriptCore/ConsoleClient.h"
#include "JavaScriptCore/ConsoleMessage.h"
#include "JavaScriptCore/JSString.h"
#include "JavaScriptCore/ScriptArguments.h"
#include "ZigConsoleClient.h"
#include "wtf/text/WTFString.h"

#include "GCDefferalContext.h"
#include "JavaScriptCore/JSCInlines.h"

using ScriptArguments = Inspector::ScriptArguments;
using MessageType = JSC::MessageType;
using MessageLevel = JSC::MessageLevel;
using JSGlobalObject = JSC__JSGlobalObject;

using String = WTF::String;

extern "C" {
JSC__JSValue Inspector__ScriptArguments__argumentAt(Inspector__ScriptArguments* arg0, size_t i)
{
    return JSC::JSValue::encode(arg0->argumentAt(i));
}
size_t Inspector__ScriptArguments__argumentCount(Inspector__ScriptArguments* arg0)
{
    return arg0->argumentCount();
}
bWTF__String
Inspector__ScriptArguments__getFirstArgumentAsString(Inspector__ScriptArguments* arg0)
{
    auto scope = DECLARE_CATCH_SCOPE(arg0->globalObject()->vm());
    JSC::JSValue val0 = arg0->argumentAt(0);
    auto type = val0.asCell()->type();
    Wrap<WTF::String, bWTF__String> wrap;
    wrap.cpp = new (wrap.alignedBuffer()) WTF::String(val0.getString(arg0->globalObject()));
    scope.clearException();
    return wrap.result;
}

bool Inspector__ScriptArguments__isEqual(Inspector__ScriptArguments* arg0,
    Inspector__ScriptArguments* arg1)
{
    return arg0->isEqual(*arg1);
}

void Inspector__ScriptArguments__release(Inspector__ScriptArguments* arg0)
{
    auto count = arg0->argumentCount();
    for (int i = 0; i < count; i++) {
        JSC::gcUnprotect(arg0->argumentAt(i));
    }
    arg0->deref();
}
}
void Zig::ConsoleClient::messageWithTypeAndLevel(MessageType type, MessageLevel level,
    JSC::JSGlobalObject* globalObject,
    Ref<ScriptArguments>&& arguments)
{
    JSC::VM& vm = globalObject->vm();
    JSC::GCDeferralContext deferralContext(vm);
    JSC::DisallowGC disallowGC;
    auto args = arguments.ptr();
    JSC__JSValue jsArgs[255];

    auto count = std::min(args->argumentCount(), (size_t)255);
    for (size_t i = 0; i < count; i++) {
        auto val = args->argumentAt(i);
        // JSC::gcProtect(val);
        jsArgs[i] = JSC::JSValue::encode(val);
    }

    auto scope = DECLARE_THROW_SCOPE(vm);
    Zig__ConsoleClient__messageWithTypeAndLevel(this->m_client, static_cast<uint32_t>(type),
        static_cast<uint32_t>(level), globalObject, jsArgs,
        count);
    scope.clearException();

    // for (size_t i = 0; i < count; i++) {
    //     JSC::gcUnprotect(JSC::JSValue::decode(jsArgs[i]));
    // }
}
void Zig::ConsoleClient::count(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUtf8().value();
    Zig__ConsoleClient__count(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}

void Zig::ConsoleClient::countReset(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUtf8().value();
    Zig__ConsoleClient__countReset(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void Zig::ConsoleClient::profile(JSC::JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUtf8().value();
    Zig__ConsoleClient__profile(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void Zig::ConsoleClient::profileEnd(JSC::JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUtf8().value();
    Zig__ConsoleClient__profileEnd(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void Zig::ConsoleClient::takeHeapSnapshot(JSC::JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUtf8().value();
    Zig__ConsoleClient__takeHeapSnapshot(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void Zig::ConsoleClient::time(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUtf8().value();
    Zig__ConsoleClient__time(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length());
}
void Zig::ConsoleClient::timeLog(JSGlobalObject* globalObject, const String& label,
    Ref<ScriptArguments>&& arguments)
{
    auto input = label.tryGetUtf8().value();
    Zig__ConsoleClient__timeLog(this->m_client, globalObject, reinterpret_cast<const unsigned char*>(input.data()), input.length(), arguments.ptr());
}
void Zig::ConsoleClient::timeEnd(JSGlobalObject* globalObject, const String& label)
{
    auto input = label.tryGetUtf8().value();
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