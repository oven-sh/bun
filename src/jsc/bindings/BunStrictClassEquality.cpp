#include "root.h"

#include "BunStrictClassEquality.h"

#include <JavaScriptCore/AOTPropertyWalk.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSFunction.h>
#include <JavaScriptCore/PropertySlot.h>

namespace Bun {
namespace StrictClassEquality {

// A function equals itself alone, a Proxy answers with its traps, and a global object has a comparison of its own.
static bool isTypedByItsConstructor(JSC::JSObject* object)
{
    JSC::JSType type = object->type();
    return !JSC::isFunctionType(type) && type != JSC::ProxyObjectType && type != JSC::GlobalProxyType && type != JSC::GlobalObjectType;
}

struct Constructor {
    // Empty where only script can answer.
    JSC::JSValue value;
    bool isOwn { false };
};

static Constructor constructorWithoutScript(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* object)
{
    JSC::VM& vm = globalObject->vm();
    const JSC::Identifier& name = vm.propertyNames->constructor;
    JSC::PropertySlot slot(object, JSC::PropertySlot::InternalMethodType::VMInquiry, &vm);
    // The object is asked by itself: one of compiled code keeps some own properties in a second object, which is then the slotBase().
    bool isOwn = object->methodTable()->getOwnPropertySlot(object, globalObject, name, slot);
    RETURN_IF_EXCEPTION(scope, {});
    bool found = isOwn;
    if (!found && !slot.isTaintedByOpaqueObject()) {
        JSC::JSValue prototype = object->getPrototypeDirect();
        found = prototype.isObject() && asObject(prototype)->getNonIndexPropertySlot(globalObject, name, slot);
        RETURN_IF_EXCEPTION(scope, {});
    }
    if (slot.isTaintedByOpaqueObject() || slot.isAccessor())
        return {};
    if (!found)
        return { JSC::jsUndefined(), false };
    JSC::JSValue value = slot.getValue(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    return { value, isOwn };
}

// Jest takes a function that prints as native code for a built-in. Here that is a host function or a builtin of the engine, not a class of a module in src/js.
static bool isBuiltinConstructor(JSC::JSCell* cell)
{
    if (cell->type() == JSC::InternalFunctionType)
        return true;
    return cell->type() == JSC::JSFunctionType && uncheckedDowncast<JSC::JSFunction>(cell)->isHostOrPrivateBuiltinFunction();
}

static WTF::String builtinConstructorName(JSC::VM& vm, JSC::JSCell* cell)
{
    if (cell->type() == JSC::InternalFunctionType)
        return uncheckedDowncast<JSC::InternalFunction>(cell)->name();
    return uncheckedDowncast<JSC::JSFunction>(cell)->name(vm);
}

// Map of a node:vm context and Map of the main realm. Jest compares the names alone, which also makes two mock functions of one realm one class.
static bool areSameBuiltinOfTwoRealms(JSC::VM& vm, JSC::JSValue constructor1, JSC::JSValue constructor2)
{
    if (!constructor1.isCell() || !constructor2.isCell())
        return false;
    JSC::JSCell* cell1 = constructor1.asCell();
    JSC::JSCell* cell2 = constructor2.asCell();
    if (!isBuiltinConstructor(cell1) || !isBuiltinConstructor(cell2))
        return false;
    if (asObject(cell1)->realmMayBeNull() == asObject(cell2)->realmMayBeNull())
        return false;
    return builtinConstructorName(vm, cell1) == builtinConstructorName(vm, cell2);
}

} // namespace StrictClassEquality

bool haveSameClassForStrictEqualitySlow(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2)
{
    using namespace StrictClassEquality;
    JSC::VM& vm = globalObject->vm();

    if (!isTypedByItsConstructor(o1) || !isTypedByItsConstructor(o2))
        return true;

    Constructor constructor1 = constructorWithoutScript(globalObject, scope, o1);
    RETURN_IF_EXCEPTION(scope, false);
    Constructor constructor2 = constructorWithoutScript(globalObject, scope, o2);
    RETURN_IF_EXCEPTION(scope, false);
    if (!constructor1.value || !constructor2.value) {
        // Only script can say. The class names decide here, because a Map or an Error never gets to the comparison of them that follows.
        JSC::AOT::PropertyWalk::materializeLazyProperties(vm, o1);
        JSC::AOT::PropertyWalk::materializeLazyProperties(vm, o2);
        return equal(JSC::JSObject::calculatedClassName(o1), JSC::JSObject::calculatedClassName(o2));
    }

    bool haveOneConstructor = JSC::JSValue::strictEqual(globalObject, constructor1.value, constructor2.value);
    RETURN_IF_EXCEPTION(scope, false);
    if (haveOneConstructor || areSameBuiltinOfTwoRealms(vm, constructor1.value, constructor2.value))
        return true;

    // An own "constructor" that is no function is a key of the data, as in JSON.parse('{"constructor":{}}').
    return constructor1.isOwn && constructor2.isOwn && !constructor1.value.isCallable() && !constructor2.value.isCallable() && o1->getPrototypeDirect() == o2->getPrototypeDirect();
}

} // namespace Bun
