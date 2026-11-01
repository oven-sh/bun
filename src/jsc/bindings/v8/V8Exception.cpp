#include "V8Exception.h"
#include "V8Isolate.h"
#include "V8String.h"
#include "V8HandleScope.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ErrorInstance.h>

namespace v8 {

// JSC::createError asserts that the message isn't empty, but an addon can pass an empty one.
static JSC::JSObject* createErrorInstance(JSC::JSGlobalObject* globalObject, JSC::ErrorType type, const WTF::String& message)
{
    return JSC::ErrorInstance::create(globalObject->vm(), globalObject->errorStructure(type), message, JSC::JSValue(), nullptr, JSC::TypeNothing, type);
}

Local<Value> Exception::Error(Local<String> message, Local<Value> options)
{
    (void)options;
    Isolate* isolate = Isolate::GetCurrent();
    auto* globalObject = isolate->globalObject();
    WTF::String wtfMessage = message->localToJSString()->value(globalObject);
    JSC::JSObject* error = createErrorInstance(globalObject, JSC::ErrorType::Error, wtfMessage);
    return isolate->currentHandleScope()->createLocal<Value>(isolate->vm(), error);
}

Local<Value> Exception::TypeError(Local<String> message, Local<Value> options)
{
    (void)options;
    Isolate* isolate = Isolate::GetCurrent();
    auto* globalObject = isolate->globalObject();
    WTF::String wtfMessage = message->localToJSString()->value(globalObject);
    JSC::JSObject* error = createErrorInstance(globalObject, JSC::ErrorType::TypeError, wtfMessage);
    return isolate->currentHandleScope()->createLocal<Value>(isolate->vm(), error);
}

} // namespace v8
