#include "V8Exception.h"
#include "V8Isolate.h"
#include "V8HandleScope.h"
#include "JavaScriptCore/Error.h"
#include "JavaScriptCore/ErrorInstance.h"

namespace v8 {

static Local<Value> createError(Local<String> message, JSC::ErrorType type)
{
    Isolate* isolate = Isolate::GetCurrent();
    Zig::GlobalObject* globalObject = isolate->globalObject();
    auto& vm = isolate->vm();
    WTF::String wtfMessage = message->localToJSString()->getString(globalObject);
    JSC::JSObject* error = JSC::ErrorInstance::create(vm, globalObject->errorStructure(type), wtfMessage, JSC::jsUndefined(), nullptr, JSC::TypeNothing, type);
    return isolate->currentHandleScope()->createLocal<Value>(vm, error);
}

Local<Value> Exception::RangeError(Local<String> message, Local<Value>)
{
    return createError(message, JSC::ErrorType::RangeError);
}

Local<Value> Exception::ReferenceError(Local<String> message, Local<Value>)
{
    return createError(message, JSC::ErrorType::ReferenceError);
}

Local<Value> Exception::SyntaxError(Local<String> message, Local<Value>)
{
    return createError(message, JSC::ErrorType::SyntaxError);
}

Local<Value> Exception::TypeError(Local<String> message, Local<Value>)
{
    return createError(message, JSC::ErrorType::TypeError);
}

Local<Value> Exception::Error(Local<String> message, Local<Value>)
{
    return createError(message, JSC::ErrorType::Error);
}

} // namespace v8
