#include "root.h"

#include "AsyncContextFrame.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/JSFunction.h>

// The text of a function written in JavaScript, from its parameters to its end. Dead for any other value.
extern "C" BunString Bun__JSFunction__sourceFromParameters(JSC::EncodedJSValue encodedValue, bool* isArrowFunction)
{
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);
    if (auto* frame = dynamicDowncast<AsyncContextFrame>(value))
        value = frame->callback.get();
    auto* function = dynamicDowncast<JSC::JSFunction>(value);
    if (!function)
        return { BunStringTag::Dead };
    const JSC::SourceCode* source = function->sourceCode();
    if (!source || function->jsExecutable()->isClass())
        return { BunStringTag::Dead };
    *isArrowFunction = JSC::isArrowFunctionParseMode(function->jsExecutable()->parseMode());
    return Bun::toStringRef(source->view().toString());
}
