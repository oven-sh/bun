#include "WeakReferenceFunctions.h"

#include <JavaScriptCore/JSFinalizationRegistry.h>
#include <JavaScriptCore/JSWeakObjectRef.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/WeakMapImplInlines.h>

namespace Bun {

using namespace JSC;

// The checks and the messages are those of FinalizationRegistryPrototype.cpp and WeakObjectRefPrototype.cpp.

static JSFinalizationRegistry* toFinalizationRegistry(JSGlobalObject* globalObject, ThrowScope& scope, JSValue value)
{
    if (auto* registry = dynamicDowncast<JSFinalizationRegistry>(value)) [[likely]]
        return registry;
    throwTypeError(globalObject, scope, value.isObject() ? "Called FinalizationRegistry function on a non-FinalizationRegistry object"_s : "Called FinalizationRegistry function on non-object"_s);
    return nullptr;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionFinalizationRegistryRegister, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* registry = toFinalizationRegistry(globalObject, scope, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});

    JSValue target = callFrame->argument(1);
    if (!canBeHeldWeakly(target)) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "register requires an object or a non-registered symbol as the target"_s);

    JSValue heldValue = callFrame->argument(2);
    if (target == heldValue) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "register expects the target object and the holdings parameter are not the same. Otherwise, the target can never be collected"_s);

    JSValue unregisterToken = callFrame->argument(3);
    if (!unregisterToken.isUndefined() && !canBeHeldWeakly(unregisterToken)) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "register requires an object or a non-registered symbol as the unregistration token"_s);

    registry->registerTarget(vm, target.asCell(), heldValue, unregisterToken);
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionFinalizationRegistryUnregister, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* registry = toFinalizationRegistry(globalObject, scope, callFrame->argument(0));
    RETURN_IF_EXCEPTION(scope, {});

    JSValue unregisterToken = callFrame->argument(1);
    if (!canBeHeldWeakly(unregisterToken)) [[unlikely]]
        return throwVMTypeError(globalObject, scope, "unregister requires an object or a non-registered symbol as the unregistration token"_s);

    return JSValue::encode(jsBoolean(registry->unregister(vm, unregisterToken.asCell())));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionWeakRefDeref, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue value = callFrame->argument(0);
    auto* weakRef = dynamicDowncast<JSWeakObjectRef>(value);
    if (!weakRef) [[unlikely]]
        return throwVMTypeError(globalObject, scope, value.isObject() ? "Called WeakRef function on a non-WeakRef object"_s : "Called WeakRef function on non-object"_s);

    auto* target = weakRef->deref(vm);
    return JSValue::encode(target ? JSValue(target) : jsUndefined());
}

JSValue createWeakReferenceFunctions(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto* functions = constructEmptyObject(globalObject);

    functions->putDirect(vm, Identifier::fromString(vm, "FinalizationRegistryPrototypeRegister"_s), JSFunction::create(vm, globalObject, 4, "register"_s, jsFunctionFinalizationRegistryRegister, ImplementationVisibility::Public), 0);
    functions->putDirect(vm, Identifier::fromString(vm, "FinalizationRegistryPrototypeUnregister"_s), JSFunction::create(vm, globalObject, 2, "unregister"_s, jsFunctionFinalizationRegistryUnregister, ImplementationVisibility::Public), 0);
    functions->putDirect(vm, Identifier::fromString(vm, "WeakRefPrototypeDeref"_s), JSFunction::create(vm, globalObject, 1, "deref"_s, jsFunctionWeakRefDeref, ImplementationVisibility::Public), 0);

    return functions;
}

} // namespace Bun
