#include "config.h"

#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "JavaScriptCore/ArrayConstructor.h"

#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;
 
JSC_DEFINE_HOST_FUNCTION(asyncHooksCleanupLater, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // assumptions and notes:
    // - nobody else uses setOnEachMicrotaskTick
    // - this is called by js if we set async context in a way we may not clear it
    // - AsyncLocalStorage.prototype.run cleans up after itself and does not call this cb
    auto* global = jsCast<Zig::GlobalObject*>(globalObject);
    global->asyncHooksNeedsCleanup = true;
    global->resetOnEachMicrotaskTick();
    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(asyncHooksSetEnabled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    // assumptions and notes:
    // - nobody else uses setOnEachMicrotaskTick
    // - this is called by js if we set async context in a way we may not clear it
    // - AsyncLocalStorage.prototype.run cleans up after itself and does not call this cb
    globalObject->setAsyncContextTrackingEnabled(callFrame->uncheckedArgument(0).toBoolean(globalObject));
    return JSC::JSValue::encode(JSC::jsUndefined());
}
 
JSC::JSValue createAsyncHooksBinding(Zig::GlobalObject* globalObject) {
    VM& vm = globalObject->vm();
    auto binding = constructEmptyArray(globalObject, nullptr, 2);
    binding->putByIndexInline(
        globalObject,
        (unsigned)0,
        JSC::JSFunction::create(vm, globalObject, 0, "setAsyncHooksEnabled"_s, asyncHooksSetEnabled, ImplementationVisibility::Public),
        false
    );
    binding->putByIndexInline(
        globalObject,
        (unsigned)1,
        JSC::JSFunction::create(vm, globalObject, 0, "cleanupLater"_s, asyncHooksCleanupLater, ImplementationVisibility::Public),
        false
    );
    return binding;
}

}