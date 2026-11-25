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

// Runs no script. False if process.env has not been made, or cannot be listed.
extern "C" bool Bun__MacroHost__forEachEnvVar(Zig::GlobalObject* globalObject, void* context, void (*visit)(void*, const BunString*, const BunString*))
{
    static constexpr unsigned maxObjects = 16;
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
        return false;

    PropertyNameArrayBuilder names(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    for (unsigned i = 0; i < maxObjects && object && object != globalObject->objectPrototype(); ++i) {
        if (auto* proxy = dynamicDowncast<ProxyObject>(object)) {
            object = proxy->isRevoked() ? nullptr : proxy->target();
            if (proxy == native)
                native = object;
            continue;
        }
        if (object != native && object->type() != FinalObjectType)
            break;

        size_t firstNewName = names.size();
        object->methodTable()->getOwnPropertyNames(object, globalObject, names, DontEnumPropertiesMode::Include);
        if (scope.exception()) [[unlikely]] {
            scope.clearException();
            return false;
        }
        for (size_t index = firstNewName; index < names.size(); ++index) {
            const Identifier& name = names[index];
            PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, &vm);
            bool hasProperty = object->methodTable()->getOwnPropertySlot(object, globalObject, name, slot);
            slot.disallowVMEntry.reset();
            String string;
            if (!scope.exception() && hasProperty && (slot.isValue() || (slot.isCustom() && object == native))) {
                JSValue value = slot.getValue(globalObject, name);
                if (!scope.exception() && value.isPrimitive() && !value.isUndefinedOrNull() && !value.isSymbol())
                    string = value.toWTFString(globalObject);
            }
            if (scope.exception()) [[unlikely]] {
                scope.clearException();
                return false;
            }
            if (string.isNull())
                continue;
            BunString nameString = Bun::toString(name.impl());
            BunString valueString = Bun::toString(string);
            visit(context, &nameString, &valueString);
        }
        object = object->getPrototypeDirect().getObject();
    }
    return true;
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

// Another thread may have called process.chdir().
extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__MacroHost__forgetWorkingDirectory(Zig::GlobalObject* globalObject)
{
    if (globalObject->hasProcessObject())
        globalObject->processObject()->clearCachedCwd();
}
