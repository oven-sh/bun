// For the diff a failed `toEqual`, `toStrictEqual` or `toHaveProperty` prints: `Bun__deepEquals` stops at the first difference and keeps no record, so this finds the asymmetric matchers that passed.

#include "root.h"

#include "JestPassedMatchers.h"
#include "GeneratedExpect.h"
#include "headers.h"
#include <JavaScriptCore/DisallowVMEntry.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/RegExpObject.h>
#include <wtf/HashMap.h>

extern "C" bool Expect_asymmetricMatcherSettlesPromise(JSC::EncodedJSValue matcher, JSC::JSGlobalObject*);

namespace Bun {
using namespace JSC;

// Finds each asymmetric matcher that passes on the value at the same place in the other operand.
// A failed assertion must call nothing it did not call before, so this reads own data properties only and leaves a matcher that can call user code to print as a difference.
class PassedMatcherFinder {
    WTF_FORBID_HEAP_ALLOCATION;

public:
    PassedMatcherFinder(JSGlobalObject* globalObject, ThrowScope& scope)
        : m_globalObject(globalObject)
        , m_vm(globalObject->vm())
        , m_scope(scope)
    {
    }

    void walk(JSValue received, JSValue expected);
    // Hands over what `walk` found: for each key, the object to put the matcher in and the matcher.
    void moveTo(Vector<Identifier, 8>& keys, MarkedArgumentBuffer& targetsAndMatchers);

private:
    static bool isEnumerableData(unsigned attributes)
    {
        return !(attributes & (PropertyAttribute::DontEnum | PropertyAttribute::AccessorOrCustomAccessorOrValue));
    }

    bool enter(JSObject* received, JSObject* expected);
    void walkObject(JSObject* received, JSObject* expected);
    void walkArray(JSArray* received, JSArray* expected);
    void visit(JSObject* received, JSObject* expected, UniquedStringImpl* name, unsigned index, JSValue receivedValue, JSValue expectedValue);
    JSValue ownElement(JSObject*, unsigned index);
    bool matchCallsNoUserCode(JSValue matcher, JSValue other);
    bool instanceOfCallsNoUserCode(JSObject* constructor, JSValue other);

    JSGlobalObject* m_globalObject;
    VM& m_vm;
    ThrowScope& m_scope;
    // Each container and the one at the same place in the other operand. Null for one that is at two places or in both operands: it prints one text at every place, and a matcher passed at one of them.
    UncheckedKeyHashMap<JSObject*, JSObject*> m_partners;
    Vector<Identifier, 8> m_keys; // the property each matcher passed on
    MarkedArgumentBuffer m_found; // the (container, matcher) of each
};

// True the first time this pair is reached.
bool PassedMatcherFinder::enter(JSObject* received, JSObject* expected)
{
    if (received == expected) {
        m_partners.set(received, nullptr);
        return false;
    }
    auto isNew = [&](JSObject* container, JSObject* partner) {
        auto result = m_partners.add(container, partner);
        if (!result.isNewEntry && result.iterator->value != partner)
            result.iterator->value = nullptr;
        return result.isNewEntry;
    };
    bool receivedIsNew = isNew(received, expected);
    bool expectedIsNew = isNew(expected, received);
    return receivedIsNew && expectedIsNew;
}

// Goes into two values that hold their entries under keys and print one entry a line.
void PassedMatcherFinder::walk(JSValue receivedValue, JSValue expectedValue)
{
    bool areArrays = isJSArray(receivedValue) && isJSArray(expectedValue);
    bool areObjects = !areArrays && receivedValue.isCell() && expectedValue.isCell() && receivedValue.asCell()->type() == FinalObjectType && expectedValue.asCell()->type() == FinalObjectType;
    if (!areArrays && !areObjects)
        return;
    JSObject* received = asObject(receivedValue);
    JSObject* expected = asObject(expectedValue);
    if (!enter(received, expected) || !m_vm.isSafeToRecurse())
        return;
    if (areArrays)
        return walkArray(uncheckedDowncast<JSArray>(received), uncheckedDowncast<JSArray>(expected));
    walkObject(received, expected);
}

void PassedMatcherFinder::walkObject(JSObject* received, JSObject* expected)
{
    // The pairs are collected first: nothing may run while the property table is walked.
    Vector<UniquedStringImpl*, 16> names;
    MarkedArgumentBuffer values;
    expected->structure()->forEachProperty(m_vm, [&](const PropertyTableEntry& entry) -> bool {
        PropertyName name(entry.key());
        if (!isEnumerableData(entry.attributes()) || name.isPrivateName())
            return true;
        unsigned attributes;
        PropertyOffset offset = received->getDirectOffset(m_vm, name, attributes);
        if (offset == invalidOffset || !isEnumerableData(attributes))
            return true;
        names.append(entry.key());
        values.append(received->getDirect(offset));
        values.append(expected->getDirect(entry.offset()));
        return true;
    });
    for (size_t i = 0; i < names.size(); i++) {
        visit(received, expected, names[i], 0, values.at(i * 2), values.at(i * 2 + 1));
        RETURN_IF_EXCEPTION(m_scope, );
    }

    // The structure does not hold the index keys.
    if (!hasIndexedProperties(expected->indexingType()) || !hasIndexedProperties(received->indexingType()))
        return;
    PropertyNameArrayBuilder keys(m_vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
    expected->getOwnIndexedPropertyNames(m_globalObject, keys, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(m_scope, );
    for (const Identifier& key : keys) {
        std::optional<uint32_t> index = parseIndex(key);
        if (!index)
            continue;
        JSValue receivedValue = ownElement(received, *index);
        RETURN_IF_EXCEPTION(m_scope, );
        JSValue expectedValue = ownElement(expected, *index);
        RETURN_IF_EXCEPTION(m_scope, );
        if (!receivedValue || !expectedValue)
            continue;
        visit(received, expected, nullptr, *index, receivedValue, expectedValue);
        RETURN_IF_EXCEPTION(m_scope, );
    }
}

void PassedMatcherFinder::walkArray(JSArray* received, JSArray* expected)
{
    auto holdsOnlyNumbers = [](JSArray* array) {
        return hasInt32(array->indexingType()) || hasDouble(array->indexingType());
    };
    if (holdsOnlyNumbers(received) && holdsOnlyNumbers(expected))
        return;
    // `length` can be far more than what a sparse array holds. An element outside the vector is not paired.
    unsigned length = std::min({ received->length(), expected->length(), received->getVectorLength(), expected->getVectorLength() });
    for (unsigned index = 0; index < length; index++) {
        if (!received->canGetIndexQuickly(index) || !expected->canGetIndexQuickly(index))
            continue;
        visit(received, expected, nullptr, index, received->getIndexQuickly(index), expected->getIndexQuickly(index));
        RETURN_IF_EXCEPTION(m_scope, );
    }
}

// One place that both operands own a value at: the property `name`, or the element `index` if `name` is null.
void PassedMatcherFinder::visit(JSObject* received, JSObject* expected, UniquedStringImpl* name, unsigned index, JSValue receivedValue, JSValue expectedValue)
{
    // `Bun__deepEquals` asks the expected value first, and the received one only if the expected one cannot be a matcher.
    bool matcherIsExpected = mayBeAsymmetricMatcher(expectedValue);
    if (!matcherIsExpected && !mayBeAsymmetricMatcher(receivedValue))
        return walk(receivedValue, expectedValue);

    JSValue matcher = matcherIsExpected ? expectedValue : receivedValue;
    bool callsNoUserCode = matchCallsNoUserCode(matcher, matcherIsExpected ? receivedValue : expectedValue);
    RETURN_IF_EXCEPTION(m_scope, );
    if (!callsNoUserCode)
        return;
    // The two values are equal only if the matcher passes.
    bool passed = JSC__JSValue__jestDeepEquals(JSValue::encode(receivedValue), JSValue::encode(expectedValue), m_globalObject);
    RETURN_IF_EXCEPTION(m_scope, );
    if (!passed)
        return;
    m_keys.append(name ? Identifier::fromUid(m_vm, name) : Identifier::from(m_vm, index));
    m_found.append(matcherIsExpected ? received : expected);
    m_found.append(matcher);
}

// The own enumerable data property at `index`, as it is stored. Empty if there is none.
JSValue PassedMatcherFinder::ownElement(JSObject* object, unsigned index)
{
    if (object->canGetIndexQuickly(index))
        return object->getIndexQuickly(index);
    PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, &m_vm);
    bool hasElement = JSObject::getOwnPropertySlotByIndex(object, m_globalObject, index, slot);
    RETURN_IF_EXCEPTION(m_scope, {});
    if (!hasElement || !slot.isValue() || !isEnumerableData(slot.attributes()))
        return {};
    return slot.getValue(m_globalObject, index);
}

// True if `Bun__deepEquals` decides this pair with no call to user code and no write to what the user holds.
bool PassedMatcherFinder::matchCallsNoUserCode(JSValue matcherValue, JSValue other)
{
    using namespace Bun::Bindgen::Generated;
    // `expect.resolvesTo` and `expect.rejectsTo` wait for the promise they get.
    if (Expect_asymmetricMatcherSettlesPromise(JSValue::encode(matcherValue), m_globalObject))
        return false;

    JSCell* matcher = matcherValue.asCell();
    if (dynamicDowncast<JSExpectAnything>(matcher))
        return true;
    // A String or Number object is converted through its `toString` or `valueOf`.
    if (auto* closeTo = dynamicDowncast<JSExpectCloseTo>(matcher))
        return closeTo->m_numberValue.get().isNumber() && closeTo->m_digitsValue.get().isNumber();
    if (auto* stringContaining = dynamicDowncast<JSExpectStringContaining>(matcher))
        return stringContaining->m_stringValue.get().isString();
    if (auto* stringMatching = dynamicDowncast<JSExpectStringMatching>(matcher)) {
        auto* regExp = dynamicDowncast<RegExpObject>(stringMatching->m_testValue.get());
        // A global or sticky regular expression moves its `lastIndex`. Every other one still converts it to a number.
        return !regExp || (!regExp->regExp()->globalOrSticky() && regExp->getLastIndex().isNumber());
    }
    if (auto* any = dynamicDowncast<JSExpectAny>(matcher))
        return instanceOfCallsNoUserCode(asObject(any->m_constructorValue.get()), other);
    // `expect.objectContaining`, `expect.arrayContaining` and an `expect.extend` matcher read and call what the user wrote.
    return false;
}

// True if `other instanceof constructor` calls no user code and cannot throw: `Symbol.hasInstance` is the built-in one, `prototype` is an object, and no Proxy is asked for its prototype.
bool PassedMatcherFinder::instanceOfCallsNoUserCode(JSObject* constructor, JSValue other)
{
    if (!constructor->structure()->typeInfo().implementsDefaultHasInstance())
        return false;

    auto valueOf = [&](PropertyName name) -> JSValue {
        PropertySlot slot(constructor, PropertySlot::InternalMethodType::VMInquiry, &m_vm);
        bool hasProperty = constructor->getNonIndexPropertySlot(m_globalObject, name, slot);
        RETURN_IF_EXCEPTION(m_scope, {});
        if (!hasProperty || !slot.isValue() || slot.isTaintedByOpaqueObject())
            return {};
        return slot.getValue(m_globalObject, name);
    };
    JSValue hasInstance = valueOf(m_vm.propertyNames->hasInstanceSymbol);
    RETURN_IF_EXCEPTION(m_scope, false);
    if (hasInstance != JSValue(m_globalObject->functionProtoHasInstanceSymbolFunction()))
        return false;
    JSValue prototype = valueOf(m_vm.propertyNames->prototype);
    RETURN_IF_EXCEPTION(m_scope, false);
    if (!prototype || !prototype.isObject())
        return false;

    for (JSObject* object = other.getObject(); object; object = object->getPrototypeDirect().getObject()) {
        if (object->structure()->typeInfo().overridesGetPrototype())
            return false;
    }
    return true;
}

void PassedMatcherFinder::moveTo(Vector<Identifier, 8>& keys, MarkedArgumentBuffer& targetsAndMatchers)
{
    for (size_t i = 0; i < m_keys.size(); i++) {
        JSObject* target = asObject(m_found.at(i * 2));
        if (!m_partners.get(target))
            continue;
        keys.append(WTF::move(m_keys[i]));
        targetsAndMatchers.append(target);
        targetsAndMatchers.append(m_found.at(i * 2 + 1));
    }
}

} // namespace Bun

// Runs `format` with each matcher that passed in both values, in place of the value it passed on. Does not run it if no matcher passed.
// `format` is called as `JSC__JSValue__jestDeepMatch` calls it, and its second argument means nothing here.
extern "C" void JSC__JSValue__jestFormatWithPassedMatchers(JSC::EncodedJSValue received, JSC::EncodedJSValue expected, JSC::JSGlobalObject* globalObject, void* ctx, void (*format)(void* ctx, bool))
{
    JSC::ThrowScope scope = DECLARE_THROW_SCOPE(globalObject->vm());
    Vector<JSC::Identifier, 8> keys;
    JSC::MarkedArgumentBuffer targetsAndMatchers;
    {
        // Makes a call to user code from the finder a crash in a build with assertions.
        JSC::DisallowVMEntry disallowVMEntry(scope.vm());
        Bun::PassedMatcherFinder finder(globalObject, scope);
        finder.walk(JSC::JSValue::decode(received), JSC::JSValue::decode(expected));
        RETURN_IF_EXCEPTION(scope, );
        finder.moveTo(keys, targetsAndMatchers);
    }
    if (keys.isEmpty())
        return;
    Bun::formatWithPassedMatchers(globalObject, scope, keys.span(), targetsAndMatchers, ctx, format);
}
