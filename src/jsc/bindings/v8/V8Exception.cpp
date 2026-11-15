#include "V8Exception.h"
#include "V8Isolate.h"
#include "V8String.h"
#include "V8HandleScope.h"
#include <JavaScriptCore/Error.h>
#include <JavaScriptCore/ErrorInstance.h>

namespace v8 {

// JSC::createError asserts that the message isn't empty, but an addon can pass an empty one.
static Local<Value> makeError(JSC::ErrorType type, Local<String> message)
{
    Isolate* isolate = Isolate::GetCurrent();
    auto* globalObject = isolate->globalObject();
    WTF::String wtfMessage = message->localToJSString()->value(globalObject);
    JSC::JSObject* error = JSC::ErrorInstance::create(globalObject->vm(), globalObject->errorStructure(type), wtfMessage, JSC::JSValue(), nullptr, JSC::TypeNothing, type);
    return isolate->currentHandleScope()->createLocal<Value>(isolate->vm(), error);
}

// The options argument (`cause`) is not read, as before these overloads were added.
Local<Value> Exception::RangeError(Local<String> message, Local<Value> options)
{
    (void)options;
    return makeError(JSC::ErrorType::RangeError, message);
}

Local<Value> Exception::SyntaxError(Local<String> message, Local<Value> options)
{
    (void)options;
    return makeError(JSC::ErrorType::SyntaxError, message);
}

Local<Value> Exception::TypeError(Local<String> message, Local<Value> options)
{
    (void)options;
    return makeError(JSC::ErrorType::TypeError, message);
}

Local<Value> Exception::Error(Local<String> message, Local<Value> options)
{
    (void)options;
    return makeError(JSC::ErrorType::Error, message);
}

} // namespace v8
