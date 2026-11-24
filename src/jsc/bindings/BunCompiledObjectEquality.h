#pragma once

#include "root.h"

#include <JavaScriptCore/AOTPropertyWalk.h>
#include <JavaScriptCore/ArgList.h>
#include <JavaScriptCore/JSObject.h>
#include <JavaScriptCore/Structure.h>
#include <optional>
#include <wtf/Vector.h>

namespace Bun {

struct OwnEnumerableProperties {
    WTF::Vector<WTF::UniquedStringImpl*, 16> names;
    JSC::MarkedArgumentBuffer values;

    size_t indexOf(WTF::UniquedStringImpl* name, size_t expected) const
    {
        if (expected < names.size() && names[expected] == name)
            return expected;
        return names.find(name);
    }
};

inline bool collectOwnEnumerableProperties(JSC::VM& vm, JSC::JSObject* object, OwnEnumerableProperties& properties)
{
    namespace PropertyWalk = JSC::AOT::PropertyWalk;
    if (PropertyWalk::isCompiledObject(object)) {
        auto visit = [&](const PropertyWalk::OwnProperty& property) {
            // Structure::canPerformFastPropertyEnumeration() refuses it too, enumerable or not.
            if (property.name == vm.propertyNames->underscoreProto.impl())
                return IterationStatus::Done;
            if (property.attributes & JSC::PropertyAttribute::DontEnum)
                return IterationStatus::Continue;
            properties.names.append(property.name);
            properties.values.appendWithCrashOnOverflow(property.value);
            return IterationStatus::Continue;
        };
        return PropertyWalk::forEachOwnPropertyAsCreated(vm, object, visit) == PropertyWalk::Result::Completed;
    }
    JSC::Structure* structure = object->structure();
    if (structure->hasNonReifiedStaticProperties() || !structure->canPerformFastPropertyEnumeration())
        return false;
    structure->forEachProperty(vm, [&](const JSC::PropertyTableEntry& entry) -> bool {
        if (entry.attributes() & JSC::PropertyAttribute::DontEnum || JSC::PropertyName(entry.key()).isPrivateName())
            return true;
        properties.names.append(entry.key());
        properties.values.appendWithCrashOnOverflow(object->getDirect(entry.offset()));
        return true;
    });
    return true;
}

// The Structure of a compiled object doesn't say which properties it has.
inline bool onlyOneCompiledObjectHasOwn(JSC::VM& vm, JSC::JSCell* first, JSC::JSCell* second, JSC::PropertyName name)
{
    namespace PropertyWalk = JSC::AOT::PropertyWalk;
    if (PropertyWalk::structureGuaranteesAbsence(first->structure(), name.uid()))
        return false;
    return !PropertyWalk::getDirect(vm, JSC::asObject(first), name, nullptr) != !PropertyWalk::getDirect(vm, JSC::asObject(second), name, nullptr);
}

template<typename CompareValues>
bool areCompiledValuesEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue left, JSC::JSValue right, bool sameIsEqual, const CompareValues& compareValues)
{
    if (sameIsEqual) [[likely]] {
        if (left == right)
            return true;
        bool isSame = JSC::sameValue(globalObject, left, right);
        RETURN_IF_EXCEPTION(scope, false);
        if (isSame)
            return true;
    }
    bool isEqual = compareValues(left, right);
    RETURN_IF_EXCEPTION(scope, false);
    return isEqual;
}

// std::nullopt: an exception is pending.
template<typename CompareValues>
std::optional<bool> areCompiledPairsEqual(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, const JSC::MarkedArgumentBuffer& pairs, bool sameIsEqual, const CompareValues& compareValues)
{
    for (size_t i = 0; i < pairs.size(); i += 2) {
        bool isEqual = areCompiledValuesEqual(globalObject, scope, pairs.at(i), pairs.at(i + 1), sameIsEqual, compareValues);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        if (!isEqual)
            return false;
    }
    return true;
}

using CompareCompiledObjects = bool (*)(JSC::JSGlobalObject*, JSC::ThrowScope&, JSC::JSObject*, JSC::JSObject*);

// std::nullopt: the caller compares by its generic path, or an exception is pending.
template<bool isStrict, CompareCompiledObjects compareWhatIsNotListed, typename CompareValues>
std::optional<bool> compareCompiledObjectProperties(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, bool sameIsEqual, const CompareValues& compareValues)
{
    JSC::VM& vm = globalObject->vm();
    JSC::MarkedArgumentBuffer pairs;
    namespace PropertyWalk = JSC::AOT::PropertyWalk;
    if (PropertyWalk::appendDifferingValues(o1, o2, sameIsEqual ? PropertyWalk::IdenticalValues::Skip : PropertyWalk::IdenticalValues::Append, pairs))
        return areCompiledPairsEqual(globalObject, scope, pairs, sameIsEqual, compareValues);

    if constexpr (compareWhatIsNotListed != nullptr) {
        bool isSame = compareWhatIsNotListed(globalObject, scope, o1, o2);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        if (!isSame)
            return false;
    }

    OwnEnumerableProperties properties1;
    OwnEnumerableProperties properties2;
    if (!collectOwnEnumerableProperties(vm, o1, properties1) || !collectOwnEnumerableProperties(vm, o2, properties2))
        return std::nullopt;
    if (properties1.names == properties2.names) {
        for (size_t i = 0; i < properties1.names.size(); i++) {
            bool isEqual = areCompiledValuesEqual(globalObject, scope, properties1.values.at(i), properties2.values.at(i), sameIsEqual, compareValues);
            RETURN_IF_EXCEPTION(scope, std::nullopt);
            if (!isEqual)
                return false;
        }
        return true;
    }

    // How many of the properties that the second loop counts are in `pairs`.
    size_t remain = 0;
    for (size_t i = 0; i < properties1.names.size(); i++) {
        JSC::JSValue left = properties1.values.at(i);
        JSC::JSValue right;
        if (size_t found = properties2.indexOf(properties1.names[i], i); found != notFound)
            right = properties2.values.at(found);
        if constexpr (!isStrict) {
            if (left.isUndefined() && right.isEmpty())
                continue;
        }
        if (!right)
            return false;
        if (isStrict || !right.isUndefined())
            remain++;
        pairs.appendWithCrashOnOverflow(left);
        pairs.appendWithCrashOnOverflow(right);
    }
    for (size_t i = 0; i < properties2.names.size(); i++) {
        if constexpr (!isStrict) {
            if (properties2.values.at(i).isUndefined())
                continue;
        }
        if (!remain)
            return false;
        remain--;
    }
    return areCompiledPairsEqual(globalObject, scope, pairs, sameIsEqual, compareValues);
}

} // namespace Bun
