#include "root.h"

#include "TestEnvironment.h"

#include "BunClientData.h"
#include "ConsoleObject.h"
#include "InternalModuleRegistry.h"
#include "ScriptExecutionContext.h"
#include "ZigGlobalObject.h"

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Bun__TestEnvironment__setupFunction(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(globalObject->internalModuleRegistry()->requireId(globalObject, vm, Bun::InternalModuleRegistry::InternalTestEnvironment)));
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Bun__TestGlobals__getRestoreFunction(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(globalObject->internalModuleRegistry()->requireId(globalObject, vm, Bun::InternalModuleRegistry::InternalTestGlobals)));
}

namespace Bun {

// Not a derived realm of the test file's global, which would be retired with the file.
static Zig::GlobalObject* lastingRealm(JSC::VM& vm)
{
    auto* clientData = WebCore::clientData(vm);
    if (!clientData->testEnvironmentRealm) {
        // As in Zig__GlobalObject__createForTestIsolation(): the concurrent marker must not see a global that is half initialized.
        JSC::DeferGC deferGC(vm);
        auto* realm = Zig::GlobalObject::create(vm, Zig::GlobalObject::createStructure(vm), WebCore::ScriptExecutionContext::generateIdentifier());
        realm->setConsole(static_cast<Bun::ConsoleObject&>(*defaultGlobalObject(vm)->consoleClient()).m_client);
        JSC::gcProtect(realm);
        clientData->testEnvironmentRealm = realm;
    }
    return static_cast<Zig::GlobalObject*>(clientData->testEnvironmentRealm);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionTestEnvironmentModuleOfLastingRealm, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    return Bun__TestEnvironment__setupFunction(lastingRealm(JSC::getVM(globalObject)));
}

// Whether every change to an own property of `object` changes its structure or one of its property slots.
static bool showsChangesInSlots(JSC::VM& vm, JSC::JSObject* object, JSC::Structure* structure)
{
    if (structure->isDictionary() || JSC::hasIndexedProperties(structure->indexingType()))
        return false;
    // Such as globalThis, which forwards to the global object. A function only makes `name`, `length` and `prototype` late.
    if (structure->typeInfo().overridesGetOwnPropertySlot() && object->type() != JSC::JSFunctionType)
        return false;

    // A write to a custom value goes to a native setter.
    bool hasCustomValue = false;
    structure->forEachProperty(vm, [&](const auto& entry) {
        hasCustomValue = !!(entry.attributes() & JSC::PropertyAttribute::CustomValue);
        return !hasCustomValue;
    });
    if (structure->hasNonReifiedStaticProperties()) {
        for (auto* info = object->classInfo(); info && !hasCustomValue; info = info->parentClass) {
            if (auto* table = info->staticPropHashTable) {
                for (auto& entry : *table)
                    hasCustomValue |= !!(entry.attributes() & JSC::PropertyAttribute::CustomValue);
            }
        }
    }
    return !hasCustomValue;
}

template<typename Functor>
static void forEachPropertySlot(JSC::JSObject* object, JSC::Structure* structure, const Functor& functor)
{
    auto visit = [&](JSC::PropertyOffset offset) {
        JSC::JSValue value = object->getDirect(offset);
        functor(value ? value : JSC::jsUndefined());
    };
    for (unsigned i = 0, size = structure->inlineSize(); i < size; ++i)
        visit(i);
    for (unsigned i = 0, size = structure->outOfLineSize(); i < size; ++i)
        visit(JSC::firstOutOfLineOffset + i);
}

// For each object its structure and then its property slots, or null if those do not tell whether it has changed.
JSC_DEFINE_HOST_FUNCTION(jsFunctionShapesOfObjects, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto* objects = uncheckedDowncast<JSC::JSArray>(callFrame->uncheckedArgument(0));
    JSC::MarkedArgumentBuffer shapes;
    for (unsigned i = 0, length = objects->length(); i < length; ++i) {
        auto* object = asObject(objects->getIndexQuickly(i));
        auto* structure = object->structure();
        if (!showsChangesInSlots(vm, object, structure)) {
            shapes.append(JSC::jsNull());
            continue;
        }
        shapes.append(structure);
        forEachPropertySlot(object, structure, [&](JSC::JSValue value) { shapes.append(value); });
    }
    return JSC::JSValue::encode(JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), shapes));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionIndexesOfChangedObjects, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto* objects = uncheckedDowncast<JSC::JSArray>(callFrame->uncheckedArgument(0));
    auto* shapes = uncheckedDowncast<JSC::JSArray>(callFrame->uncheckedArgument(1));
    JSC::MarkedArgumentBuffer changed;
    unsigned next = 0;
    for (unsigned i = 0, length = objects->length(); i < length; ++i) {
        JSC::JSValue shape = shapes->getIndexQuickly(next++);
        if (shape.isNull()) {
            changed.append(JSC::jsNumber(i));
            continue;
        }
        auto* object = asObject(objects->getIndexQuickly(i));
        auto* structure = uncheckedDowncast<JSC::Structure>(shape.asCell());
        unsigned slot = next;
        next += structure->inlineSize() + structure->outOfLineSize();
        bool isSame = object->structure() == structure;
        if (isSame)
            forEachPropertySlot(object, structure, [&](JSC::JSValue value) { isSame &= value == shapes->getIndexQuickly(slot++); });
        if (!isSame)
            changed.append(JSC::jsNumber(i));
    }
    return JSC::JSValue::encode(JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), changed));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDeleteOwnProperty, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* object = asObject(callFrame->uncheckedArgument(0));
    auto key = callFrame->uncheckedArgument(1).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::VM::DeletePropertyModeScope ignoreConfigurable(vm, JSC::VM::DeletePropertyMode::IgnoreConfigurable);
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsBoolean(JSC::JSCell::deleteProperty(object, globalObject, key))));
}

} // namespace Bun
