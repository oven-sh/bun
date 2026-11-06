#pragma once

#include "root.h"

#include "NodeObjEquiv.h"
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

    // Whether a name holds one object here and another object there: a comparison that can run code of the program.
    bool comparesTwoObjects(const OwnEnumerableProperties& other) const
    {
        for (size_t i = 0; i < values.size(); i++) {
            JSC::JSValue value = values.at(i);
            if (!value.isObject())
                continue;
            size_t found = other.indexOf(names[i], i);
            if (found != notFound && other.values.at(found).isObject() && other.values.at(found) != value)
                return true;
        }
        return false;
    }

    // The names as node's keyCheck lists them: string keys, then symbol keys. How many string keys there are.
    size_t appendKeysTo(JSC::PropertyNameArrayBuilder& keys) const
    {
        for (WTF::UniquedStringImpl* name : names) {
            if (!name->isSymbol())
                keys.addUnchecked(name);
        }
        size_t stringKeys = keys.size();
        for (WTF::UniquedStringImpl* name : names) {
            if (name->isSymbol())
                keys.addUnchecked(name);
        }
        return stringKeys;
    }
};

inline bool collectOwnEnumerableProperties(JSC::VM& vm, JSC::JSObject* object, OwnEnumerableProperties& properties)
{
    namespace PropertyWalk = JSC::AOT::PropertyWalk;
    if (PropertyWalk::isCompiledObject(object)) {
        auto visit = [&](const PropertyWalk::OwnProperty& property) {
            if (property.attributes & JSC::PropertyAttribute::DontEnum)
                return IterationStatus::Continue;
            properties.names.append(property.name);
            properties.values.appendWithCrashOnOverflow(property.value);
            return IterationStatus::Continue;
        };
        return PropertyWalk::forEachOwnProperty(vm, object, PropertyWalk::Filter::StringsAndSymbols, visit) == PropertyWalk::Result::Completed;
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

// std::nullopt: the caller compares by its generic path, or an exception is pending.
template<bool isStrict, bool nodeKeyOrder, typename CompareValues>
std::optional<bool> compareCompiledObjectProperties(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, const CompareValues& compareValues)
{
    JSC::VM& vm = globalObject->vm();
    OwnEnumerableProperties properties1;
    OwnEnumerableProperties properties2;
    if (!collectOwnEnumerableProperties(vm, o1, properties1) || !collectOwnEnumerableProperties(vm, o2, properties2))
        return std::nullopt;

    JSC::MarkedArgumentBuffer pairs;
    bool isPaired = false;
    if constexpr (nodeKeyOrder) {
        if (properties1.names == properties2.names) {
            // node compares what is under the string keys, then what is under the symbol keys.
            for (bool underSymbolKeys : { false, true }) {
                for (size_t i = 0; i < properties1.names.size(); i++) {
                    if (properties1.names[i]->isSymbol() != underSymbolKeys)
                        continue;
                    pairs.appendWithCrashOnOverflow(properties1.values.at(i));
                    pairs.appendWithCrashOnOverflow(properties2.values.at(i));
                }
            }
            isPaired = true;
        } else if (properties1.comparesTwoObjects(properties2)) {
            // In another key order node's loop shows only where a comparison runs code: where a name holds two different objects.
            JSC::PropertyNameArrayBuilder keys1(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
            JSC::PropertyNameArrayBuilder keys2(vm, JSC::PropertyNameMode::StringsAndSymbols, JSC::PrivateSymbolMode::Exclude);
            size_t stringKeys1 = properties1.appendKeysTo(keys1);
            size_t stringKeys2 = properties2.appendKeysTo(keys2);
            if (stringKeys1 != stringKeys2 || keys1.size() != keys2.size())
                return false;
            bool isEqual = NodeObjEquiv::ownPropertiesEqual(globalObject, scope, o1, o2, &keys1, keys2, false, compareValues);
            RETURN_IF_EXCEPTION(scope, std::nullopt);
            return isEqual;
        }
    }
    if (!isPaired) {
        for (size_t i = 0; i < properties1.names.size(); i++) {
            WTF::UniquedStringImpl* name = properties1.names[i];
            JSC::JSValue left = properties1.values.at(i);
            JSC::JSValue right;
            if (size_t found = properties2.indexOf(name, i); found != notFound)
                right = properties2.values.at(found);
            else if constexpr (!isStrict)
                right = o2->getDirect(vm, JSC::PropertyName(name));
            if constexpr (!isStrict) {
                if (left.isUndefined() && right.isEmpty())
                    continue;
            }
            if (!right)
                return false;
            pairs.appendWithCrashOnOverflow(left);
            pairs.appendWithCrashOnOverflow(right);
        }
        size_t remain = properties1.names.size();
        for (size_t i = 0; i < properties2.names.size(); i++) {
            if constexpr (!isStrict) {
                if (properties2.values.at(i).isUndefined())
                    continue;
            }
            WTF::UniquedStringImpl* name = properties2.names[i];
            bool isInFirst = properties1.indexOf(name, i) != notFound || o1->getDirect(vm, JSC::PropertyName(name));
            if (!isInFirst || !remain)
                return false;
            remain--;
        }
    }
    for (size_t i = 0; i < pairs.size(); i += 2) {
        JSC::JSValue left = pairs.at(i);
        JSC::JSValue right = pairs.at(i + 1);
        if (left == right)
            continue;
        bool isSame = JSC::sameValue(globalObject, left, right);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        if (isSame)
            continue;
        bool isEqual = compareValues(left, right);
        RETURN_IF_EXCEPTION(scope, std::nullopt);
        if (!isEqual)
            return false;
    }
    return true;
}

} // namespace Bun
