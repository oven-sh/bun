#include "root.h"

#include "NodeObjEquiv.h"

#include "UtilInspect.h"
#include <JavaScriptCore/ArrayStorage.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/OperationsInlines.h>
#include <JavaScriptCore/SparseArrayValueMap.h>
#include <algorithm>
#include <wtf/Vector.h>

namespace Bun {

JSC::JSString* objectPrototypeToStringOutOfLine(JSC::JSGlobalObject*, JSC::JSValue);

namespace NodeObjEquiv {

static void appendOwnKeys(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* object, JSC::PropertyNameMode mode, JSC::PropertyNameArrayBuilder& keys)
{
    JSC::PropertyNameArrayBuilder listed(globalObject->vm(), mode, JSC::PrivateSymbolMode::Exclude);
    object->methodTable()->getOwnPropertyNames(object, globalObject, listed, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, void());
    for (const auto& key : listed)
        keys.addUnchecked(key.impl());
}

// Whether a listing of the object's own keys can run code of the program, as the ownKeys trap of a Proxy does.
static bool listingRunsCode(JSC::JSObject* object)
{
    if (!object->structure()->typeInfo().overridesGetOwnPropertyNames())
        return false;
    switch (object->type()) {
    case JSC::DirectArgumentsType:
    case JSC::ScopedArgumentsType:
    case JSC::StringObjectType:
    case JSC::DerivedStringObjectType:
#if ENABLE(AOT)
    case JSC::CompiledObjectType:
#endif
        return false;
    default:
        return true;
    }
}

// Moves the string keys of a list before its symbol keys. How many string keys it has.
static size_t moveSymbolKeysLast(JSC::PropertyNameArrayBuilder& keys)
{
    auto& list = keys.data()->propertyNameVector();
    auto firstSymbolKey = std::stable_partition(list.begin(), list.end(), [](const JSC::Identifier& key) { return !key.isSymbol(); });
    return firstSymbolKey - list.begin();
}

// Object.keys of the second object, then of the first, then the enumerable symbol keys of the first, then of the second.
bool listOwnKeysSlow(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, JSC::PropertyNameArrayBuilder& keys1, JSC::PropertyNameArrayBuilder& keys2)
{
    if (!listingRunsCode(o1) && !listingRunsCode(o2)) {
        // Nothing can tell how often such an object is listed: once is enough.
        o2->methodTable()->getOwnPropertyNames(o2, globalObject, keys2, JSC::DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
        o1->methodTable()->getOwnPropertyNames(o1, globalObject, keys1, JSC::DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
        return moveSymbolKeysLast(keys1) == moveSymbolKeysLast(keys2) && keys1.size() == keys2.size();
    }
    appendOwnKeys(globalObject, scope, o2, JSC::PropertyNameMode::Strings, keys2);
    RETURN_IF_EXCEPTION(scope, false);
    appendOwnKeys(globalObject, scope, o1, JSC::PropertyNameMode::Strings, keys1);
    RETURN_IF_EXCEPTION(scope, false);
    if (keys1.size() != keys2.size())
        return false;
    appendOwnKeys(globalObject, scope, o1, JSC::PropertyNameMode::Symbols, keys1);
    RETURN_IF_EXCEPTION(scope, false);
    appendOwnKeys(globalObject, scope, o2, JSC::PropertyNameMode::Symbols, keys2);
    RETURN_IF_EXCEPTION(scope, false);
    return keys1.size() == keys2.size();
}

JSC::JSValue getIndexSlow(JSC::JSGlobalObject* globalObject, JSC::JSObject* array, unsigned index, bool& ranCode)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::PropertySlot slot(array, JSC::PropertySlot::InternalMethodType::Get);
    bool has = array->getPropertySlot(globalObject, index, slot);
    RETURN_IF_EXCEPTION(scope, {});
    ranCode = slot.isTaintedByOpaqueObject() || (has && !slot.isValue());
    if (!has)
        return JSC::jsUndefined();
    RELEASE_AND_RETURN(scope, slot.getValue(globalObject, index));
}

bool ownsIndexSlow(JSC::JSGlobalObject* globalObject, JSC::JSObject* array, uint64_t index)
{
    JSC::PropertySlot slot(array, JSC::PropertySlot::InternalMethodType::GetOwnProperty);
    if (index <= MAX_ARRAY_INDEX) [[likely]]
        return array->methodTable()->getOwnPropertySlotByIndex(array, globalObject, static_cast<unsigned>(index), slot);
    return array->methodTable()->getOwnPropertySlot(array, globalObject, JSC::Identifier::from(globalObject->vm(), index), slot);
}

// The own enumerable index keys of an array, ascending, as numbers.
template<typename Visit>
static void forEachOwnIndex(JSC::JSObject* array, const Visit& visit)
{
    if (!JSC::hasAnyArrayStorage(array->indexingType())) {
        unsigned length = uncheckedDowncast<JSC::JSArray>(array)->length();
        for (unsigned index = 0; index < length; index++) {
            if (array->canGetIndexQuickly(index))
                visit(index);
        }
        return;
    }
    JSC::ArrayStorage* storage = array->butterfly()->arrayStorage();
    unsigned vectorEnd = std::min(storage->length(), storage->vectorLength());
    for (unsigned index = 0; index < vectorEnd; index++) {
        if (storage->m_vector[index])
            visit(index);
    }
    if (JSC::SparseArrayValueMap* map = storage->m_sparseMap.get()) {
        WTF::Vector<unsigned, 16> indices;
        for (auto& entry : *map) {
            if (!(entry.attributes() & JSC::PropertyAttribute::DontEnum))
                indices.append(entry.index());
        }
        std::ranges::sort(indices);
        for (unsigned index : indices)
            visit(index);
    }
}

static bool ownsKey(JSC::JSGlobalObject* globalObject, JSC::JSObject* object, JSC::PropertyName key)
{
    JSC::PropertySlot slot(object, JSC::PropertySlot::InternalMethodType::GetOwnProperty);
    return object->methodTable()->getOwnPropertySlot(object, globalObject, key, slot);
}

bool sparseArraysEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, size_t from, const CompareValues& compareValues)
{
    JSC::VM& vm = globalObject->vm();
    // Object.keys of the first array, then of the second. Index keys of two arrays stay numbers; behind a Proxy the ownKeys trap gives strings.
    size_t indexCount1 = 0;
    WTF::Vector<unsigned, 16> indices2;
    std::optional<JSC::PropertyNameArrayBuilder> names1;
    std::optional<JSC::PropertyNameArrayBuilder> names2;
    bool bothAreArrays = JSC::isJSArray(o1) && JSC::isJSArray(o2);
    if (bothAreArrays) {
        forEachOwnIndex(o1, [&](unsigned) { indexCount1++; });
        forEachOwnIndex(o2, [&](unsigned index) { indices2.append(index); });
    }
    if (!bothAreArrays || hasNamedProperties(o1->structure()) || hasNamedProperties(o2->structure())) {
        names1.emplace(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
        names2.emplace(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
        if (bothAreArrays)
            o1->getOwnNonIndexPropertyNames(globalObject, *names1, JSC::DontEnumPropertiesMode::Exclude);
        else
            o1->methodTable()->getOwnPropertyNames(o1, globalObject, *names1, JSC::DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
        if (bothAreArrays)
            o2->getOwnNonIndexPropertyNames(globalObject, *names2, JSC::DontEnumPropertiesMode::Exclude);
        else
            o2->methodTable()->getOwnPropertyNames(o2, globalObject, *names2, JSC::DontEnumPropertiesMode::Exclude);
        RETURN_IF_EXCEPTION(scope, false);
    }
    const size_t nameCount2 = names2 ? names2->size() : 0;
    if (indexCount1 + (names1 ? names1->size() : 0) != indices2.size() + nameCount2)
        return false;

    // node takes `from`, the index of the first hole, for a place in the list of keys (#L991-L992), and so can step over keys behind the hole.
    size_t i = from;
    for (; i < indices2.size(); i++) {
        unsigned index = indices2[i];
        bool ranCode1 = false;
        bool ranCode2 = false;
        JSC::JSValue value1 = getIndex(globalObject, o1, index, ranCode1);
        RETURN_IF_EXCEPTION(scope, false);
        if (value1.isUndefined()) {
            bool owns = ownsIndex(globalObject, o1, index);
            RETURN_IF_EXCEPTION(scope, false);
            if (!owns)
                return false;
        }
        if (ranCode1) [[unlikely]] {
            value1 = getIndex(globalObject, o1, index, ranCode1);
            RETURN_IF_EXCEPTION(scope, false);
        }
        JSC::JSValue value2 = getIndex(globalObject, o2, index, ranCode2);
        RETURN_IF_EXCEPTION(scope, false);
        bool equal = value1 == value2 || compareValues(value1, value2);
        RETURN_IF_EXCEPTION(scope, false);
        if (!equal)
            return false;
    }
    for (size_t named = i - indices2.size(); named < nameCount2; named++) {
        const JSC::Identifier& key = (*names2)[named];
        JSC::JSValue value1 = o1->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
        if (value1.isUndefined()) {
            bool owns = ownsKey(globalObject, o1, key);
            RETURN_IF_EXCEPTION(scope, false);
            if (!owns)
                return false;
        }
        value1 = o1->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
        JSC::JSValue value2 = o2->get(globalObject, key);
        RETURN_IF_EXCEPTION(scope, false);
        bool equal = value1 == value2 || compareValues(value1, value2);
        RETURN_IF_EXCEPTION(scope, false);
        if (!equal)
            return false;
    }
    return true;
}

static bool isBelowLength(JSC::JSGlobalObject* globalObject, JSC::JSObject* array, uint64_t index)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue length = array->get(globalObject, vm.propertyNames->length);
    RETURN_IF_EXCEPTION(scope, false);
    RELEASE_AND_RETURN(scope, JSC::jsLess<true>(globalObject, JSC::jsNumber(index), length));
}

bool hasUnequalTagSlow(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2)
{
    JSC::VM& vm = globalObject->vm();
    bool isArray1 = JSC::isArray(globalObject, o1);
    RETURN_IF_EXCEPTION(scope, false);
    if (isArray1)
        return false;
    const JSC::Identifier& tagKey = vm.propertyNames->toStringTagSymbol;
    JSC::JSValue tag1 = o1->get(globalObject, tagKey);
    RETURN_IF_EXCEPTION(scope, false);
    if (!tag1.isUndefined()) {
        JSC::JSValue tag2 = o2->get(globalObject, tagKey);
        RETURN_IF_EXCEPTION(scope, false);
        if (!tag2.isUndefined()) {
            bool sameTag = JSC::JSValue::strictEqual(globalObject, tag1, tag2);
            RETURN_IF_EXCEPTION(scope, false);
            return !sameTag;
        }
    }
    JSC::JSString* string1 = objectPrototypeToStringOutOfLine(globalObject, o1);
    RETURN_IF_EXCEPTION(scope, false);
    JSC::JSString* string2 = objectPrototypeToStringOutOfLine(globalObject, o2);
    RETURN_IF_EXCEPTION(scope, false);
    bool sameString = string1->equal(globalObject, string2);
    RETURN_IF_EXCEPTION(scope, false);
    return !sameString;
}

// What node does with two arrays before their elements: nullopt where the elements decide. Not inline, to keep it off the stack of the element loop.
static NEVER_INLINE std::optional<bool> proxiedArrayOtherKeysEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, const CompareValues& compareValues)
{
    JSC::VM& vm = globalObject->vm();
    const JSC::Identifier& lengthKey = vm.propertyNames->length;
    JSC::JSValue length1 = o1->get(globalObject, lengthKey);
    RETURN_IF_EXCEPTION(scope, false);
    JSC::JSValue length2 = o2->get(globalObject, lengthKey);
    RETURN_IF_EXCEPTION(scope, false);
    bool sameLength = JSC::JSValue::strictEqual(globalObject, length1, length2);
    RETURN_IF_EXCEPTION(scope, false);
    if (!sameLength)
        return false;

    const JSC::Identifier& tagKey = vm.propertyNames->toStringTagSymbol;
    JSC::JSValue tag1 = o1->get(globalObject, tagKey);
    RETURN_IF_EXCEPTION(scope, false);
    JSC::JSValue tag2 = o2->get(globalObject, tagKey);
    RETURN_IF_EXCEPTION(scope, false);
    bool sameTag = JSC::JSValue::strictEqual(globalObject, tag1, tag2);
    RETURN_IF_EXCEPTION(scope, false);
    if (!sameTag)
        return false;

    JSC::PropertyNameArrayBuilder keys1(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
    JSC::PropertyNameArrayBuilder keys2(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
    Bun::getOwnNonIndexPropertyNames(globalObject, o2, keys2, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, false);
    Bun::getOwnNonIndexPropertyNames(globalObject, o1, keys1, JSC::DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, false);
    if (keys1.size() != keys2.size())
        return false;

    if (keys2.size()) {
        bool otherKeysEqual = ownPropertiesEqual(globalObject, scope, o1, o2, nullptr, keys2, false, compareValues);
        RETURN_IF_EXCEPTION(scope, false);
        if (!otherKeysEqual)
            return false;
    } else {
        // `val2.length === 0 || val2.size === 0`: with no other key, node calls the arrays equal on either.
        length2 = o2->get(globalObject, lengthKey);
        RETURN_IF_EXCEPTION(scope, false);
        if (length2.isNumber() && !length2.asNumber())
            return true;
        JSC::JSValue size2 = o2->get(globalObject, vm.propertyNames->size);
        RETURN_IF_EXCEPTION(scope, false);
        if (size2.isNumber() && !size2.asNumber())
            return true;
    }
    return std::nullopt;
}

bool proxiedArraysEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, const CompareValues& compareValues)
{
    std::optional<bool> areEqual = proxiedArrayOtherKeysEqual(globalObject, scope, o1, o2, compareValues);
    RETURN_IF_EXCEPTION(scope, false);
    if (areEqual)
        return *areEqual;
    return arrayElementsEqual(
        globalObject, scope, o1, o2,
        [&](uint64_t index) { return isBelowLength(globalObject, o1, index); },
        [&](JSC::JSObject* array, uint64_t index, bool& ranCode) {
            ranCode = true;
            return array->get(globalObject, index);
        },
        [&](JSC::JSObject* array, uint64_t index) { return ownsIndexSlow(globalObject, array, index); },
        compareValues);
}

} // namespace NodeObjEquiv
} // namespace Bun
