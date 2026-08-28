#include "V8Exception.h"
#include "V8Isolate.h"
#include "V8String.h"
#include "V8HandleScope.h"
#include <JavaScriptCore/Error.h>

namespace v8 {

Local<Value> Exception::Error(Local<String> message, Local<Value> options)
{
    (void)options;
    Isolate* isolate = Isolate::GetCurrent();
    auto* globalObject = isolate->globalObject();
    WTF::String wtfMessage = message->localToJSString()->value(globalObject);
    JSC::JSObject* error = JSC::createError(globalObject, wtfMessage);
    return isolate->currentHandleScope()->createLocal<Value>(isolate->vm(), error);
}

Local<Value> Exception::TypeError(Local<String> message, Local<Value> options)
{
    (void)options;
    Isolate* isolate = Isolate::GetCurrent();
    auto* globalObject = isolate->globalObject();
    WTF::String wtfMessage = message->localToJSString()->value(globalObject);
    JSC::JSObject* error = JSC::createTypeError(globalObject, wtfMessage);
    return isolate->currentHandleScope()->createLocal<Value>(isolate->vm(), error);
}

} // namespace v8
