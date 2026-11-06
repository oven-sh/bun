#include "root.h"

#include "AsyncContextFrame.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/FunctionExecutable.h>
#include <JavaScriptCore/JSFunction.h>

// JSC's source for a function starts at its parameter list, not at `function` or its name.
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
