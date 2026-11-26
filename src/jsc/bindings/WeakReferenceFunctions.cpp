#include "WeakReferenceFunctions.h"

#include <JavaScriptCore/JSFinalizationRegistry.h>
#include <JavaScriptCore/JSWeakObjectRef.h>
#include <JavaScriptCore/WeakMapImplInlines.h>

namespace Bun {

using namespace JSC;

// JavaScriptCore keeps the native code of `register`, `unregister` and `deref` to FinalizationRegistryPrototype.cpp and
// WeakObjectRefPrototype.cpp. The three functions here do the same, with the same checks and messages.

static JSFinalizationRegistry* toFinalizationRegistry(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value)
{
    if (auto* registry = dynamicDowncast<JSFinalizationRegistry>(value)) [[likely]]
        return registry;
    throwTypeError(globalObject, scope, value.isObject() ? "Called FinalizationRegistry function on a non-FinalizationRegistry object"_s : "Called FinalizationRegistry function on non-object"_s);
    return nullptr;
}

static JSC_DECLARE_HOST_FUNCTION(jsFinalizationRegistryPrototypeRegister);
static JSC_DECLARE_HOST_FUNCTION(jsFinalizationRegistryPrototypeUnregister);
static JSC_DECLARE_HOST_FUNCTION(jsWeakRefPrototypeDeref);

JSC_DEFINE_HOST_FUNCTION(jsFinalizationRegistryPrototypeRegister, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* registry = toFinalizationRegistry(globalObject, scope, callFrame->thisValue());
    RETURN_IF_EXCEPTION(scope, {});

    JSValue target = callFrame->argument(0);
    if (!canBeHeldWeakly(target)) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "register requires an object or a non-registered symbol as the target"_s);

    JSValue heldValue = callFrame->argument(1);
    if (target == heldValue) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "register expects the target object and the holdings parameter are not the same. Otherwise, the target can never be collected"_s);

    JSValue unregisterToken = callFrame->argument(2);
    if (!unregisterToken.isUndefined() && !canBeHeldWeakly(unregisterToken)) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "register requires an object or a non-registered symbol as the unregistration token"_s);

    registry->registerTarget(vm, target.asCell(), heldValue, unregisterToken);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFinalizationRegistryPrototypeUnregister, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* registry = toFinalizationRegistry(globalObject, scope, callFrame->thisValue());
    RETURN_IF_EXCEPTION(scope, {});

    JSValue unregisterToken = callFrame->argument(0);
    if (!canBeHeldWeakly(unregisterToken)) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "unregister requires an object or a non-registered symbol as the unregistration token"_s);

    return JSValue::encode(jsBoolean(registry->unregister(vm, unregisterToken.asCell())));
}

JSC_DEFINE_HOST_FUNCTION(jsWeakRefPrototypeDeref, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue value = callFrame->thisValue();
    auto* weakRef = dynamicDowncast<JSWeakObjectRef>(value);
    if (!weakRef) [[unlikely]]
        return throwVMTypeError(globalObject, scope, value.isObject() ? "Called WeakRef function on a non-WeakRef object"_s : "Called WeakRef function on non-object"_s);

    auto* target = weakRef->deref(vm);
    return JSValue::encode(target ? JSValue(target) : jsUndefined());
}

template<auto hostFunction>
static JSValue createFunction(VM& vm, JSObject* globalObject, unsigned length, ASCIILiteral name)
{
    return JSFunction::create(vm, globalObject->globalObject(), length, name, JSC::removableFunction<Bun::Feature::WeakReferences, JSC::RemovedFeatureStub::Throw, hostFunction>(), ImplementationVisibility::Public);
}

JSValue finalizationRegistryConstructorCallback(VM&, JSObject* globalObject)
{
    return globalObject->globalObject()->finalizationRegistryConstructor();
}

JSValue finalizationRegistryPrototypeRegisterCallback(VM& vm, JSObject* globalObject)
{
    return createFunction<jsFinalizationRegistryPrototypeRegister>(vm, globalObject, 2, "register"_s);
}

JSValue finalizationRegistryPrototypeUnregisterCallback(VM& vm, JSObject* globalObject)
{
    return createFunction<jsFinalizationRegistryPrototypeUnregister>(vm, globalObject, 1, "unregister"_s);
}

JSValue weakRefConstructorCallback(VM&, JSObject* globalObject)
{
    return globalObject->globalObject()->weakObjectRefConstructor();
}

JSValue weakRefPrototypeDerefCallback(VM& vm, JSObject* globalObject)
{
    return createFunction<jsWeakRefPrototypeDeref>(vm, globalObject, 0, "deref"_s);
}

} // namespace Bun
