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
template<bool isStrict, typename CompareValues>
std::optional<bool> compareCompiledObjectProperties(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSObject* o1, JSC::JSObject* o2, const CompareValues& compareValues)
{
    JSC::VM& vm = globalObject->vm();
    OwnEnumerableProperties properties1;
    OwnEnumerableProperties properties2;
    if (!collectOwnEnumerableProperties(vm, o1, properties1) || !collectOwnEnumerableProperties(vm, o2, properties2))
        return std::nullopt;

    JSC::MarkedArgumentBuffer pairs;
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
