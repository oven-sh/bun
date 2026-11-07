#pragma once

#include "root.h"

#include <JavaScriptCore/AOTPropertyWalk.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/StructureInlines.h>

namespace Bun {

bool haveSameClassForStrictEqualitySlow(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject*, JSC::JSObject*);

// Whether no object of the Structure has an own "constructor". False also where only the method table of an object can say.
ALWAYS_INLINE bool structureRulesOutOwnConstructor(JSC::VM& vm, JSC::Structure* structure)
{
    // A type that makes up properties says so in one of these flags. An Error says so for its stack properties alone.
    constexpr unsigned makesUpProperties = JSC::ProhibitsPropertyCaching | JSC::GetOwnPropertySlotIsImpure | JSC::GetOwnPropertySlotIsImpureForPropertyAbsence;
    JSC::TypeInfo typeInfo = structure->typeInfo();
    if ((typeInfo.flags() & makesUpProperties) && typeInfo.type() != JSC::ErrorInstanceType)
        return false;
    // A Structure that has seen few names answers from its filter of them, without a lookup.
    return structure->get(vm, vm.propertyNames->constructor) == JSC::invalidOffset;
}

ALWAYS_INLINE bool hasNoOwnConstructor(JSC::VM& vm, JSC::JSObject* object)
{
#if ENABLE(AOT)
    // A compiled object keeps its own properties out of its Structure.
    if (JSC::AOT::PropertyWalk::isCompiledObject(object)) [[unlikely]]
        return !JSC::AOT::PropertyWalk::getDirect(vm, object, vm.propertyNames->constructor, nullptr);
#endif
    return structureRulesOutOwnConstructor(vm, object->structure());
}

// The comparisons of these kinds in Bun__deepEquals take no object of another JSType for equal.
ALWAYS_INLINE bool isComparedWithItsOwnJSTypeOnly(JSC::JSType type)
{
    switch (type) {
    case JSC::JSSetType:
    case JSC::JSMapType:
    case JSC::ArrayBufferType:
    case JSC::JSDateType:
    case JSC::RegExpObjectType:
    case JSC::ErrorInstanceType:
    case JSC::NumberObjectType:
    case JSC::BooleanObjectType:
        return true;
    default:
        return JSC::isTypedArrayType(type);
    }
}

// Jest's typeEquality for toStrictEqual() and Bun.deepEquals(a, b, true): one `constructor`, two arrays, or one built-in of two realms. It runs no script.
ALWAYS_INLINE bool haveSameClassForStrictEquality(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSCell* c1, JSC::JSCell* c2)
{
    // Two objects with one prototype and no own "constructor" read it from one chain. One Structure can say both for all its objects.
    if (c1->structureID() == c2->structureID()) {
        JSC::Structure* structure = c1->structure();
        if (structure->hasMonoProto() && structureRulesOutOwnConstructor(vm, structure))
            return true;
    }
    auto isArray = [](JSC::JSCell* cell) {
        return cell->type() == JSC::ArrayType || cell->type() == JSC::DerivedArrayType;
    };
    if (isArray(c1) && isArray(c2))
        return true;
    JSC::JSObject* o1 = asObject(c1);
    JSC::JSObject* o2 = asObject(c2);
    if (o1->getPrototypeDirect() == o2->getPrototypeDirect() && hasNoOwnConstructor(vm, o1) && hasNoOwnConstructor(vm, o2))
        return true;
    // Bun__deepEquals takes these pairs for unequal whatever their classes are. So the step reads no `constructor` for them.
    JSC::JSType type1 = c1->type();
    JSC::JSType type2 = c2->type();
    if (type1 != type2) {
        if (isComparedWithItsOwnJSTypeOnly(type1) || isComparedWithItsOwnJSTypeOnly(type2))
            return false;
        // An array and an object that is none. A Proxy can be an array.
        if ((isArray(c1) || isArray(c2)) && type1 != JSC::ProxyObjectType && type2 != JSC::ProxyObjectType)
            return false;
    }
    bool haveSameClass = haveSameClassForStrictEqualitySlow(globalObject, scope, o1, o2);
    RETURN_IF_EXCEPTION(scope, false);
    return haveSameClass;
}

} // namespace Bun
