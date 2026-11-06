#pragma once

#include "root.h"

#include <JavaScriptCore/Identifier.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/PropertySlot.h>
#include <wtf/ScopedLambda.h>

// What node's strict deep equality reads of a pair of objects, in node's order. #L: https://github.com/nodejs/node/blob/v26.12.1/lib/internal/util/comparisons.js
namespace Bun::NodeObjEquiv {

// Whether a value read from the first object and one read from the second are deeply equal.
using CompareValues = WTF::ScopedLambda<bool(JSC::JSValue, JSC::JSValue)>;

// Whether an object of this structure holds a property that is no element.
ALWAYS_INLINE bool hasNamedProperties(JSC::Structure* structure)
{
    return structure->outOfLineSize() || structure->inlineSize();
}

bool listOwnKeysSlow(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* o1, JSC::JSObject* o2, JSC::PropertyNameArrayBuilder& keys1, JSC::PropertyNameArrayBuilder& keys2);

// keyCheck (#L493-L520): the own enumerable keys of both objects, string keys before symbol keys. False where the counts differ.
ALWAYS_INLINE bool listOwnKeys(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, JSC::PropertyNameArrayBuilder& keys1, JSC::PropertyNameArrayBuilder& keys2)
{
    // A type with a listing of its own: a Proxy runs code of the program for each list, and the symbol keys need not be last.
    if (o1->structure()->typeInfo().overridesGetOwnPropertyNames() || o2->structure()->typeInfo().overridesGetOwnPropertyNames()) [[unlikely]]
        return listOwnKeysSlow(globalObject, scope, o1, o2, keys1, keys2);
    o2->methodTable()->getOwnPropertyNames(o2, globalObject, keys2, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, false);
    o1->methodTable()->getOwnPropertyNames(o1, globalObject, keys1, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, false);
    size_t size = keys1.size();
    if (size != keys2.size())
        return false;
    // JSObject::getOwnPropertyNames lists symbol keys last: the lists hold as many string keys when they end in as many symbol keys.
    while (size && keys1[size - 1].isSymbol() && keys2[size - 1].isSymbol())
        size--;
    return !size || (!keys1[size - 1].isSymbol() && !keys2[size - 1].isSymbol());
}

// [[Get]], asking getOwnPropertySlot first: for a type that overrides it, get() makes that call after an index parse.
ALWAYS_INLINE JSC::JSValue getOwnSlotFirst(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* object, JSC::PropertyName key)
{
    JSC::PropertySlot slot(object, JSC::PropertySlot::InternalMethodType::Get);
    bool owns = object->methodTable()->getOwnPropertySlot(object, globalObject, key, slot);
    RETURN_IF_EXCEPTION(scope, {});
    if (owns)
        return slot.getValue(globalObject, key);
    return object->get(globalObject, key);
}

// The key loop of objEquiv (#L1002-L1031). `keys1` is null where node passes none: array-likes. Values of the same bits need no call (#L238-L240).
template<typename Compare>
ALWAYS_INLINE bool ownPropertiesEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, const JSC::PropertyNameArrayBuilder* keys1, const JSC::PropertyNameArrayBuilder& keys2, bool ownSlotFirst, const Compare& compareValues)
{
    const size_t length = keys2.size();
    size_t i = 0;
    if (keys1) {
        for (; i < length; i++) {
            const JSC::Identifier& key = keys2[i];
            if ((*keys1)[i] != key)
                break;
            JSC::JSValue value1 = o1->get(globalObject, key);
            RETURN_IF_EXCEPTION(scope, false);
            JSC::JSValue value2 = o2->get(globalObject, key);
            RETURN_IF_EXCEPTION(scope, false);
            bool equal = value1 == value2 || compareValues(value1, value2);
            RETURN_IF_EXCEPTION(scope, false);
            if (!equal)
                return false;
        }
    }
    for (; i < length; i++) {
        const JSC::Identifier& key = keys2[i];
        JSC::PropertySlot slot1(o1, JSC::PropertySlot::InternalMethodType::GetOwnProperty);
        bool owns = o1->methodTable()->getOwnPropertySlot(o1, globalObject, key, slot1);
        RETURN_IF_EXCEPTION(scope, false);
        if (!owns || (slot1.attributes() & JSC::PropertyAttribute::DontEnum))
            return false;
        // `descriptor.writable !== undefined ? descriptor.value : a[key]`: a getter of an ordinary object is what a[key] calls.
        bool isAccessor = slot1.isAccessor() || (slot1.attributes() & JSC::PropertyAttribute::CustomAccessor);
        JSC::JSValue value1 = isAccessor && JSC::TypeInfo::overridesGetOwnPropertySlot(o1->inlineTypeFlags()) ? o1->get(globalObject, key) : slot1.getValue(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
        JSC::JSValue value2 = ownSlotFirst ? getOwnSlotFirst(globalObject, scope, o2, key) : o2->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
        bool equal = value1 == value2 || compareValues(value1, value2);
        RETURN_IF_EXCEPTION(scope, false);
        if (!equal)
            return false;
    }
    return true;
}

// sparseArrayEquiv (#L985-L998): from the first hole on, every own string key of both arrays, by [[Get]].
bool sparseArraysEqual(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* o1, JSC::JSObject* o2, size_t from, const CompareValues&);

// The element loop of objEquiv (#L1037-L1047). `get` says whether the read ran code of the program: node reads such a pair again to compare it.
template<typename IsBelowLength, typename Get, typename Owns, typename Compare>
ALWAYS_INLINE bool arrayElementsEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, const IsBelowLength& isBelowLength, const Get& get, const Owns& owns, const Compare& compareValues)
{
    for (uint64_t i = 0;; i++) {
        bool inRange = isBelowLength(i);
        RETURN_IF_EXCEPTION(scope, false);
        if (!inRange)
            return true;
        bool ranCode1 = false;
        bool ranCode2 = false;
        JSC::JSValue element2 = get(o2, i, ranCode2);
        RETURN_IF_EXCEPTION(scope, false);
        if (element2.isUndefined()) {
            bool owns2 = owns(o2, i);
            RETURN_IF_EXCEPTION(scope, false);
            if (!owns2)
                return sparseArraysEqual(globalObject, scope, o1, o2, i, compareValues);
            JSC::JSValue element1 = get(o1, i, ranCode1);
            RETURN_IF_EXCEPTION(scope, false);
            if (!element1.isUndefined())
                return false;
            bool owns1 = owns(o1, i);
            RETURN_IF_EXCEPTION(scope, false);
            if (!owns1)
                return false;
            continue;
        }
        JSC::JSValue element1 = get(o1, i, ranCode1);
        RETURN_IF_EXCEPTION(scope, false);
        if (element1.isUndefined())
            return false;
        if (ranCode1 || ranCode2) [[unlikely]] {
            element1 = get(o1, i, ranCode1);
            RETURN_IF_EXCEPTION(scope, false);
            element2 = get(o2, i, ranCode2);
            RETURN_IF_EXCEPTION(scope, false);
        }
        bool equal = element1 == element2 || compareValues(element1, element2);
        RETURN_IF_EXCEPTION(scope, false);
        if (!equal)
            return false;
    }
}

// `array[index]` and `hasOwn(array, index)` for an index that is no plain element: a hole, an accessor, an element of the prototype.
JSC::JSValue getIndexSlow(JSC::JSGlobalObject*, JSC::JSObject* array, unsigned index, bool& ranCode);
bool ownsIndexSlow(JSC::JSGlobalObject*, JSC::JSObject* array, uint64_t index);

ALWAYS_INLINE JSC::JSValue getIndex(JSC::JSGlobalObject* globalObject, JSC::JSObject* array, unsigned index, bool& ranCode)
{
    JSC::JSValue element = array->tryGetIndexQuickly(index);
    return element ? element : getIndexSlow(globalObject, array, index, ranCode);
}

ALWAYS_INLINE bool ownsIndex(JSC::JSGlobalObject* globalObject, JSC::JSObject* array, unsigned index)
{
    return array->canGetIndexQuickly(index) || ownsIndexSlow(globalObject, array, index);
}

// slowHasUnequalTag (#L274-L279) for a pair that holds a Proxy. False for an array: node compares its tag after its length.
bool hasUnequalTagSlow(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* o1, JSC::JSObject* o2);

// The array arm for a pair that holds a Proxy: lengths (#L294-L295), tags (#L296), other keys (#L300-L305), the empty case (#L523-L528), elements.
bool proxiedArraysEqual(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject* o1, JSC::JSObject* o2, const CompareValues&);

} // namespace Bun::NodeObjEquiv
