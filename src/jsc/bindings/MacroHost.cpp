#include "root.h"

#include "BunClientData.h"
#include "BunProcess.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/DeferTermination.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/ProxyObject.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/WaiterListManager.h>

using namespace JSC;

// Sleeps like Atomics.wait(), so whatever terminates script ends the wait.
extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__MacroHost__wait(JSC::JSGlobalObject* globalObject, int32_t* isOver)
{
    auto& waiters = WaiterListManager::singleton();
    waiters.waitSync(globalObject->vm(), isOver, 0, Seconds::infinity());
    waiters.unregister(reinterpret_cast<uint8_t*>(isOver), sizeof(*isOver));
}

extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__MacroHost__wake(int32_t* isOver)
{
    WaiterListManager::singleton().notifyWaiter(isOver, 1);
}

using VisitEnvVar = void (*)(void*, const BunString*, const BunString*);

static bool isListedWithoutScript(JSObject* object)
{
    auto typeInfo = object->structure()->typeInfo();
    return object->type() == CompiledObjectType
        || !(typeInfo.overridesGetOwnPropertySlot() || typeInfo.overridesAnyFormOfGetOwnPropertyNames() || typeInfo.hasStaticPropertyTable());
}

static bool forEachEnvVar(JSGlobalObject* globalObject, JSObject* object, JSObject* native, void* context, VisitEnvVar visit)
{
    // A Proxy can be the prototype of its own target.
    static constexpr unsigned maxObjects = 128;
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    bool isPrototype = false;
    for (unsigned i = 0; object && object != globalObject->objectPrototype(); ++i) {
        if (i == maxObjects)
            return false;
        if (auto* proxy = dynamicDowncast<ProxyObject>(object)) {
            if (proxy->isRevoked())
                return false;
            object = proxy->target();
            if (proxy == native)
                native = object;
            continue;
        }
        // Such as the prototype of a built-in class, which holds methods.
        if (object != native && !isListedWithoutScript(object))
            return isPrototype;

        size_t firstNewName = names.size();
        object->methodTable()->getOwnPropertyNames(object, globalObject, names, DontEnumPropertiesMode::Include);
        RETURN_IF_EXCEPTION(scope, false);
        for (size_t index = firstNewName; index < names.size(); ++index) {
            const Identifier& name = names[index];
            PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, &vm);
            bool hasProperty = object->methodTable()->getOwnPropertySlot(object, globalObject, name, slot);
            slot.disallowVMEntry.reset();
            RETURN_IF_EXCEPTION(scope, false);
            if (!hasProperty || !(slot.isValue() || (slot.isCustom() && object == native)))
                continue;
            JSValue value = slot.getValue(globalObject, name);
            RETURN_IF_EXCEPTION(scope, false);
            if (!value.isPrimitive() || value.isUndefinedOrNull() || value.isSymbol())
                continue;
            String string = value.toWTFString(globalObject);
            RETURN_IF_EXCEPTION(scope, false);
            BunString nameString = Bun::toString(name.impl());
            BunString valueString = Bun::toString(string);
            visit(context, &nameString, &valueString);
        }
        object = object->getPrototypeDirect().getObject();
        isPrototype = true;
    }
    return true;
}

enum class EnvListing : uint8_t {
    Listed,
    NotMade,
    Failed,
};

// Runs no script.
extern "C" EnvListing Bun__MacroHost__forEachEnvVar(Zig::GlobalObject* globalObject, void* context, VisitEnvVar visit)
{
    auto& vm = globalObject->vm();
    DeferTerminationForAWhile deferTermination(vm);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    JSObject* native = globalObject->m_processEnvObject.get();
    JSObject* object = native;
    if (globalObject->hasProcessObject()) {
        JSValue env = globalObject->processObject()->getDirect(vm, WebCore::builtinNames(vm).envPublicName());
        if (env && env.isObject() && !env.isGetterSetter())
            object = asObject(env);
    }
    if (!object)
        return EnvListing::NotMade;

    bool isListed = forEachEnvVar(globalObject, object, native, context, visit);
    // The failure becomes the error of each macro call, so that a build which has none still succeeds.
    (void)scope.tryClearException();
    return isListed ? EnvListing::Listed : EnvListing::Failed;
}

// A dead `value` deletes the variable.
extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__MacroHost__setEnvVar(Zig::GlobalObject* globalObject, const BunString* name, const BunString* value)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* env = globalObject->processEnvObject();
    RETURN_IF_EXCEPTION(scope, );
    auto identifier = Identifier::fromString(vm, name->toWTFString(BunString::NonNull));
    if (value->isDead()) {
        scope.release();
        JSCell::deleteProperty(env, globalObject, identifier);
        return;
    }
    PutPropertySlot slot(env);
    scope.release();
    env->methodTable()->put(env, globalObject, identifier, jsString(vm, value->toWTFString(BunString::NonNull)), slot);
}
