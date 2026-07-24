#include "config.h"

#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayConstructor.h"

#include "ZigGlobalObject.h"
#include "NodeAsyncHooks.h"

namespace Bun {

using namespace JSC;

// `cleanupLayer` is called by js if we set async context in a way we may not
// clear it, specifically within AsyncLocalStorage.prototype.enterWith.  this
// function will not clear the async context until the next tick's microtask,
// where it must inherit the context that scheduled that callback.
JSC_DEFINE_HOST_FUNCTION(jsCleanupLater, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 0);
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    global->asyncHooksNeedsCleanup = true;
    global->resetOnEachMicrotaskTick();
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// internal/async_hooks installs its setImmediate event sink here the first time
// a hook is enabled or an async id is read. Passing a non-function clears it.
JSC_DEFINE_HOST_FUNCTION(jsSetImmediateAsyncHooksEmitter, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    JSC::JSValue value = callFrame->argument(0);
    if (JSC::JSObject* fn = value.getObject(); fn && fn->isCallable()) {
        global->m_asyncHooksImmediateEmitter.set(vm, global, fn);
    } else {
        global->m_asyncHooksImmediateEmitter.clear();
    }
    return JSC::JSValue::encode(JSC::jsUndefined());
}

void emitImmediateAsyncHook(JSC::JSGlobalObject* globalObject, JSC::JSValue timer, ImmediateAsyncHook kind)
{
    auto* global = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    JSC::JSObject* emitter = global->m_asyncHooksImmediateEmitter.get();
    if (!emitter) [[likely]] {
        return;
    }

    JSC::MarkedArgumentBuffer args;
    args.append(JSC::jsNumber(static_cast<unsigned>(kind)));
    args.append(timer);
    JSC::call(globalObject, emitter, JSC::getCallData(emitter), JSC::jsUndefined(), args);
}

// This is called when AsyncLocalStorage is constructed.
JSC_DEFINE_HOST_FUNCTION(jsSetAsyncHooksEnabled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 1);
    globalObject->setAsyncContextTrackingEnabled(callFrame->uncheckedArgument(0).toBoolean(globalObject));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

}
