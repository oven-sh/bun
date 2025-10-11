#include "root.h"
#include <JavaScriptCore/ErrorInstance.h>

extern "C" void* JSC__JSErrorInstance__bunErrorData(JSC::EncodedJSValue value)
{
    JSC::JSValue jsValue = JSC::JSValue::decode(value);
    if (!jsValue || !jsValue.isCell())
        return nullptr;

    auto* errorInstance = JSC::jsDynamicCast<JSC::ErrorInstance*>(jsValue);
    if (!errorInstance)
        return nullptr;

    return errorInstance->bunErrorData();
}
