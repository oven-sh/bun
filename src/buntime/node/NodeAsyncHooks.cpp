#include "config.h"

#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayConstructor.h"

#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

// `cleanupLayer` is called by js if we set async context in a way we may not
// clear it, specifically within AsyncLocalStorage.prototype.enterWith.  this
// function will not clear the async context until the next tick's microtask,
// where it must inherit the context that scheduled that callback.
JSC_DEFINE_HOST_FUNCTION(jsCleanupLater, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 0);
    auto* global = jsCast<Zig::GlobalObject*>(globalObject);
    global->asyncHooksNeedsCleanup = true;
    global->resetOnEachMicrotaskTick();
    return JSC::JSValue::encode(JSC::jsUndefined());
}

// This is called when AsyncLocalStorage is constructed.
JSC_DEFINE_HOST_FUNCTION(jsSetAsyncHooksEnabled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    ASSERT(callFrame->argumentCount() == 1);
    globalObject->setAsyncContextTrackingEnabled(callFrame->uncheckedArgument(0).toBoolean(globalObject));
    return JSC::JSValue::encode(JSC::jsUndefined());
}

}
