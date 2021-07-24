#include "helpers.h"

#include "ZigConsoleClient.h"
#include <JavaScriptCore/ConsoleClient.h>
#include <JavaScriptCore/ConsoleMessage.h>
#include <JavaScriptCore/ScriptArguments.h>
#include <wtf/text/WTFString.h>

using ScriptArguments = Inspector::ScriptArguments;
using MessageType = JSC::MessageType;
using MessageLevel = JSC::MessageLevel;
using JSGlobalObject = JSC__JSGlobalObject;

using String = WTF::String;

JSC__JSValue Inspector__ScriptArguments__argumentAt(const Inspector__ScriptArguments* arg0, size_t i) {
return JSC::JSValue::encode(arg0->argumentAt(i));
}
size_t Inspector__ScriptArguments__argumentCount(const Inspector__ScriptArguments* arg0) {
    return arg0->argumentCount();
}
bWTF__String Inspector__ScriptArguments__getFirstArgumentAsString(const Inspector__ScriptArguments* arg0) {
    WTF::String str;
    arg0->getFirstArgumentAsString(str);
    Wrap<WTF::String, bWTF__String> wrap = Wrap<WTF::String, bWTF__String>(str);
    return wrap.result;
}

bool Inspector__ScriptArguments__isEqual(const Inspector__ScriptArguments* arg0, const Inspector__ScriptArguments* arg1) {
    return arg0->isEqual(*arg1);
}
void Inspector__ScriptArguments__release(Inspector__ScriptArguments* arg0) {
    arg0->deref();
}

void Zig::ConsoleClient::messageWithTypeAndLevel(MessageType type, MessageLevel level, JSC::JSGlobalObject* globalObject, Ref<ScriptArguments>&& arguments) {
    Zig__ConsoleClient__messageWithTypeAndLevel(static_cast<uint32_t>(type), static_cast<uint32_t>(level), globalObject, arguments.ptr()); 
}
void Zig::ConsoleClient::count(JSGlobalObject* globalObject, const String& label) 
{
    const char* ptr = reinterpret_cast<const char*>(label.characters8());
    Zig__ConsoleClient__count(globalObject, ptr, label.length());
}

void Zig::ConsoleClient::countReset(JSGlobalObject* globalObject, const String& label) 
{
    const char* ptr = reinterpret_cast<const char*>(label.characters8());
    Zig__ConsoleClient__countReset(globalObject, ptr, label.length());
}
void Zig::ConsoleClient::profile(JSC::JSGlobalObject* globalObject, const String& label) 
{
    const char* ptr = reinterpret_cast<const char*>(label.characters8());
    Zig__ConsoleClient__profile(globalObject, ptr, label.length());
}
void Zig::ConsoleClient::profileEnd(JSC::JSGlobalObject* globalObject, const String& label) 
{
    const char* ptr = reinterpret_cast<const char*>(label.characters8());
    Zig__ConsoleClient__profileEnd(globalObject, ptr, label.length());
}
void Zig::ConsoleClient::takeHeapSnapshot(JSC::JSGlobalObject* globalObject, const String& label) 
{
    const char* ptr = reinterpret_cast<const char*>(label.characters8());
    Zig__ConsoleClient__takeHeapSnapshot(globalObject, ptr, label.length());
}
void Zig::ConsoleClient::time(JSGlobalObject* globalObject, const String& label) 
{
    const char* ptr = reinterpret_cast<const char*>(label.characters8());
    Zig__ConsoleClient__time(globalObject, ptr, label.length());
}
void Zig::ConsoleClient::timeLog(JSGlobalObject* globalObject, const String& label, Ref<ScriptArguments>&& arguments) 
{
    const char* ptr = reinterpret_cast<const char*>(label.characters8());
    Zig__ConsoleClient__timeLog(globalObject, ptr, label.length(), arguments.ptr());
}
void Zig::ConsoleClient::timeEnd(JSGlobalObject* globalObject, const String& label) 
{
    const char* ptr = reinterpret_cast<const char*>(label.characters8());
    Zig__ConsoleClient__timeEnd(globalObject, ptr, label.length());
}
void Zig::ConsoleClient::timeStamp(JSGlobalObject* globalObject, Ref<ScriptArguments>&& args) 
{
    Zig__ConsoleClient__timeStamp(globalObject, args.ptr());
}
void Zig::ConsoleClient::record(JSGlobalObject*, Ref<ScriptArguments>&&) 
{
   
}
void Zig::ConsoleClient::recordEnd(JSGlobalObject*, Ref<ScriptArguments>&&) 
{

}
void Zig::ConsoleClient::screenshot(JSGlobalObject*, Ref<ScriptArguments>&&) 
{
  
}
void Zig::ConsoleClient::warnUnimplemented(const String& method) 
{

}