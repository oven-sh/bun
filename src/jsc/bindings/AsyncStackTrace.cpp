#include "root.h"

#include "AsyncStackTrace.h"

#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/Interpreter.h>
#include <JavaScriptCore/Options.h>
#include <JavaScriptCore/StackFrame.h>

using namespace JSC;

// Used when an error is created from native code at the top of the event loop
// (e.g. run_from_js_thread in node_fs.rs) where there's no JS call stack, but the
// promise being rejected has an await chain that tells us where the user's code is.
// Promise combinators (all/race/any) are not traced through.
extern "C" void Bun__attachAsyncStackFromPromise(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue errorValue, JSC::JSPromise* promise)
{
    auto& vm = JSC::getVM(globalObject);
    auto* instance = dynamicDowncast<JSC::ErrorInstance>(JSC::JSValue::decode(errorValue));
    if (!instance || !promise || !JSC::Options::useAsyncStackTrace())
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
    if (!limit)
        return;

    WTF::Vector<JSC::StackFrame> frames;
    vm.interpreter.getStackTraceOfAwaiters(promise, frames, limit);
    if (frames.isEmpty())
        return;

    instance->setStackFrames(vm, WTF::move(frames));
}
