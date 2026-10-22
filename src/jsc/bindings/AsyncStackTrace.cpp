#include "root.h"

#include "AsyncStackTrace.h"

#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/Interpreter.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/Options.h>
#include <JavaScriptCore/StackFrame.h>

extern "C" void Bun__attachAsyncStackFromPromise(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue errorValue, JSC::JSPromise* promise)
{
    auto& vm = JSC::getVM(globalObject);
    auto* instance = dynamicDowncast<JSC::ErrorInstance>(JSC::JSValue::decode(errorValue));
    if (!instance || !promise)
        return;

    // Don't overwrite an existing stack trace. User-provided errors (e.g. via
    // StreamError.JSValue or Body.ValueError.JSValue) may already have a
    // meaningful synchronous stack from where they were created. Also skip if
    // .stack was already accessed — setStackFrames after materialization
    // would desync m_stackTrace from the cached property.
    if (instance->hasMaterializedErrorInfo())
        return;
    if (auto* existing = instance->stackTrace(); existing && !existing->isEmpty())
        return;

    size_t limit = globalObject->stackTraceLimit().value_or(10);
    if (!limit || !JSC::Options::useAsyncStackTrace())
        return;

    WTF::Vector<JSC::StackFrame> frames;
    vm.interpreter.getAsyncStackTrace(instance, frames, promise, limit);
    if (frames.isEmpty())
        return;

    instance->setStackFrames(vm, WTF::move(frames));
}
