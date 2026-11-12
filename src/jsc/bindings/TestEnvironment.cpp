#include "root.h"

#include "TestEnvironment.h"

#include "BunClientData.h"
#include "BunProcess.h"
#include "ConsoleObject.h"
#include "GlobalEventScope.h"
#include "InternalModuleRegistry.h"
#include "Performance.h"
#include "ScriptExecutionContext.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/AOTRealmStartup.h>
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/JSGlobalProxy.h>

const JSC::GlobalObjectMethodTable& methodTableOfProgram(int32_t executionContextId);

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Bun__TestEnvironment__setupFunction(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(Bun::DeclaredModuleLoad::requireForCommandLine(globalObject, Bun::InternalModuleRegistry::InternalTestEnvironment)));
}

extern "C" [[ZIG_EXPORT(zero_is_throw)]] JSC::EncodedJSValue Bun__TestGlobals__getRestoreFunction(Zig::GlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(Bun::DeclaredModuleLoad::requireForCommandLine(globalObject, Bun::InternalModuleRegistry::InternalTestGlobals)));
}

// `bun test --isolate=modules` keeps one global object for every test file. Before each file, what the last one left on it
// where no property shows it goes here. restoreGlobals() of src/js/internal/test/globals.ts, which restores the properties,
// runs next. Runs no script.
extern "C" void Bun__TestGlobals__resetNativeState(Zig::GlobalObject* globalObject)
{
    // Nothing of Bun's listens on either in the main thread.
    globalObject->globalEventScope->removeAllEventListeners();
    if (auto* performance = globalObject->existingPerformance())
        performance->removeAllEventListeners();
    globalObject->processObject()->resetForTestFile(globalObject);
}

namespace Bun {

// Not a derived realm of the test file's global, which would be retired with the file.
static Zig::GlobalObject* lastingRealm(JSC::VM& vm)
{
    auto* clientData = WebCore::clientData(vm);
    if (!clientData->testEnvironmentRealm) {
        // As in Zig__GlobalObject__createForTestIsolation(): the concurrent marker must not see a global that is half initialized.
        JSC::DeferGC deferGC(vm);
        auto identifier = WebCore::ScriptExecutionContext::generateIdentifier();
        auto& methodTable = vm.hasCompiledCode() ? methodTableOfProgram(identifier) : Zig::GlobalObject::globalObjectMethodTable();
        auto* realm = Zig::GlobalObject::create(vm, Zig::GlobalObject::createStructure(vm), identifier, &methodTable);
        realm->setConsole(static_cast<Bun::ConsoleObject&>(*defaultGlobalObject(vm)->consoleClient()).m_client);
#if ENABLE(AOT)
        if (vm.hasCompiledCode())
            JSC::AOT::acceptForeignBinaryData(realm);
#endif
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
JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(jsFunctionShapesOfObjects, __attribute__((minsize)), (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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

JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(jsFunctionIndexesOfChangedObjects, __attribute__((minsize)), (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
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

JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(jsFunctionDeleteOwnProperty, __attribute__((minsize)), (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* object = asObject(callFrame->uncheckedArgument(0));
    auto key = callFrame->uncheckedArgument(1).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::VM::DeletePropertyModeScope ignoreConfigurable(vm, JSC::VM::DeletePropertyMode::IgnoreConfigurable);
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsBoolean(JSC::JSCell::deleteProperty(object, globalObject, key))));
}

// globalThis forwards to the global object, which holds its properties.
static JSC::JSObject* holderOfProperties(JSC::JSValue value)
{
    auto* object = asObject(value);
    if (object->type() == JSC::GlobalProxyType)
        return uncheckedDowncast<JSC::JSGlobalProxy>(object)->target();
    return object;
}

// A custom value is a native getter and setter that script sees as a data property, like globalThis.onerror and
// Error.prepareStackTrace. For one that has a setter, returns what jsFunctionRestoreCustomValue takes. Script cannot read
// the pair out of it. Only the object's own storage is looked at: reifying a static table makes every lazy property.
JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(jsFunctionCustomValueOf, __attribute__((minsize)), (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* holder = holderOfProperties(callFrame->uncheckedArgument(0));
    auto key = callFrame->uncheckedArgument(1).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    unsigned attributes = 0;
    JSC::JSValue customValue = parseIndex(key) ? JSC::JSValue() : holder->getDirect(vm, key, attributes);
    if (!customValue || !(attributes & JSC::PropertyAttribute::CustomValue) || !uncheckedDowncast<JSC::CustomGetterSetter>(customValue)->setter())
        return JSC::JSValue::encode(JSC::jsUndefined());
    return JSC::JSValue::encode(JSC::InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), customValue, JSC::jsNumber(attributes)));
}

// Defining a value over a custom value replaces the pair, and then no write reaches the native setter. This puts the pair
// back where it is gone, and hands `value` to the setter where the getter answers something else. Runs no script.
JSC_DEFINE_HOST_FUNCTION_WITH_ATTRIBUTES(jsFunctionRestoreCustomValue, __attribute__((minsize)), (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* holder = holderOfProperties(callFrame->uncheckedArgument(0));
    auto key = callFrame->uncheckedArgument(1).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto* saved = uncheckedDowncast<JSC::InternalFieldTuple>(callFrame->uncheckedArgument(2));
    auto* customValue = uncheckedDowncast<JSC::CustomGetterSetter>(saved->getInternalField(0));
    JSC::JSValue value = callFrame->uncheckedArgument(3);

    if (holder->getDirect(vm, key) != customValue) {
        {
            // putDirectCustomAccessor() asserts that the property is new.
            JSC::VM::DeletePropertyModeScope ignoreConfigurable(vm, JSC::VM::DeletePropertyMode::IgnoreConfigurable);
            JSC::JSCell::deleteProperty(holder, globalObject, key);
        }
        RETURN_IF_EXCEPTION(scope, {});
        holder->putDirectCustomAccessor(vm, key, customValue, saved->getInternalField(1).asInt32());
    }
    JSC::JSValue current = JSC::JSValue::decode(customValue->getter()(globalObject, JSC::JSValue::encode(holder), key));
    RETURN_IF_EXCEPTION(scope, {});
    if (current != value) {
        customValue->setter()(globalObject, JSC::JSValue::encode(holder), JSC::JSValue::encode(value), key);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSC::JSValue::encode(JSC::jsUndefined());
}

} // namespace Bun
