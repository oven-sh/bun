#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/JSONObject.h>
#include <JavaScriptCore/Lookup.h>
#include <JavaScriptCore/ObjectConstructor.h>

// `toMatchSnapshot(propertyMatchers)` and a failed `toMatchObject` print the
// matcher that passed in place of the property it was checked against. The
// walk records those matchers and the bun:test formatter reads the record.
// Neither operand is written to.
//
// The record crosses to Rust as a JSMap: object -> null-prototype object that
// maps each matched property of that object to its matcher.

namespace Bun {

using namespace JSC;

// `matchers` is the null-prototype object one recorded object maps to. It
// holds data properties only, so no read of it runs user code or throws.
static JSValue recordedMatcherAtIndex(JSGlobalObject* globalObject, JSObject* matchers, uint32_t index)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
    JSValue matcher = matchers->getDirectIndex(globalObject, index);
    scope.assertNoException();
    return matcher;
}

JSValue recordedMatcher(JSGlobalObject* globalObject, JSObject* matchers, PropertyName property)
{
    if (std::optional<uint32_t> index = parseIndex(property))
        return recordedMatcherAtIndex(globalObject, matchers, index.value());
    return matchers->getDirect(globalObject->vm(), property);
}

static JSObject* matchersOf(JSGlobalObject* globalObject, JSMap* matchedMatchers, JSValue object)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
    JSValue matchers = matchedMatchers->get(globalObject, object);
    // Every key is an object, so the lookup does not resolve a rope or run user code.
    scope.assertNoException();
    return matchers.getObject();
}

}

using namespace JSC;

extern "C" [[ZIG_EXPORT(check_slow)]] bool Bun__JestMatchedMatchers__deepMatch(JSC::EncodedJSValue encodedObject, JSC::EncodedJSValue encodedSubset, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue* matchedMatchers)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    *matchedMatchers = JSValue::encode(JSValue());

    std::set<EncodedJSValue> objVisited;
    std::set<EncodedJSValue> subsetVisited;
    MarkedArgumentBuffer gcBuffer;
    Bun::MatchedMatchers record;
    bool matched = Bun__deepMatch<true>(JSValue::decode(encodedObject), &objVisited, JSValue::decode(encodedSubset), &subsetVisited, globalObject, scope, &gcBuffer, &record, false);
    RETURN_IF_EXCEPTION(scope, false);
    if (record.keys.isEmpty())
        return matched;

    JSMap* byObject = JSMap::create(vm, globalObject->mapStructure());
    for (size_t i = 0; i < record.keys.size(); i++) {
        JSValue object = record.values.at(i * 2);
        JSObject* matchers = Bun::matchersOf(globalObject, byObject, object);
        if (!matchers) {
            matchers = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
            byObject->set(globalObject, object, matchers);
            RETURN_IF_EXCEPTION(scope, false);
        }
        // The first matcher that passed for a property is the one that is printed.
        if (Bun::recordedMatcher(globalObject, matchers, record.keys[i]))
            continue;
        matchers->putDirectMayBeIndex(globalObject, record.keys[i], record.values.at(i * 2 + 1));
        RETURN_IF_EXCEPTION(scope, false);
    }
    *matchedMatchers = JSValue::encode(byObject);
    return matched;
}

// The matchers recorded for `object`, or empty.
extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__JestMatchedMatchers__of(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue matchedMatchers, JSC::EncodedJSValue object)
{
    JSObject* matchers = Bun::matchersOf(globalObject, uncheckedDowncast<JSMap>(JSValue::decode(matchedMatchers)), JSValue::decode(object));
    return JSValue::encode(matchers ? JSValue(matchers) : JSValue());
}

// `matchers` is a result of `Bun__JestMatchedMatchers__of`. Empty when `property` has no matcher.
extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__JestMatchedMatchers__get(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue matchers, const BunString* property)
{
    auto name = Identifier::fromString(globalObject->vm(), property->toWTFString(BunString::ZeroCopy));
    return JSValue::encode(Bun::recordedMatcher(globalObject, asObject(JSValue::decode(matchers)), name));
}

extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__JestMatchedMatchers__getIndex(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue matchers, uint32_t index)
{
    return JSValue::encode(Bun::recordedMatcherAtIndex(globalObject, asObject(JSValue::decode(matchers)), index));
}

// `JSC__JSValue__jsonStringify` for a value that can hold recorded objects:
// each recorded property is serialized as its matcher.
extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__JestMatchedMatchers__jsonStringify(JSC::EncodedJSValue encodedValue, JSC::JSGlobalObject* globalObject, uint32_t indent, JSC::EncodedJSValue encodedMatchedMatchers, BunString* out)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSMap* matchedMatchers = uncheckedDowncast<JSMap>(JSValue::decode(encodedMatchedMatchers));

    // JSC exports no stringify that takes a replacer, and a test can replace
    // `JSON.stringify`. The class table still holds the original function.
    const HashTableValue* stringify = JSONObject::info()->staticPropHashTable->entry(Identifier::fromString(vm, "stringify"_s));
    JSFunction* stringifyFunction = JSFunction::create(vm, globalObject, stringify->functionLength(), "stringify"_s, stringify->function(), ImplementationVisibility::Public, stringify->intrinsic());

    // JSON.stringify calls its replacer with the holder of the property as `this`.
    // The second argument keeps `matchedMatchers` alive for as long as the function is.
    JSNativeStdFunction* replacer = JSNativeStdFunction::create(
        vm, globalObject, 2, String(), [matchedMatchers](JSGlobalObject* globalObject, CallFrame* callFrame) -> EncodedJSValue {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSValue holder = callFrame->thisValue();
            JSValue value = callFrame->argument(1);
            if (!holder.isObject())
                return JSValue::encode(value);
            JSObject* matchers = Bun::matchersOf(globalObject, matchedMatchers, holder);
            if (!matchers)
                return JSValue::encode(value);
            auto property = callFrame->argument(0).toPropertyKey(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            JSValue matcher = Bun::recordedMatcher(globalObject, matchers, property);
            return JSValue::encode(matcher ? matcher : value);
        },
        matchedMatchers);

    MarkedArgumentBuffer arguments;
    arguments.append(JSValue::decode(encodedValue));
    arguments.append(replacer);
    arguments.append(jsNumber(indent));
    JSValue json = JSC::call(globalObject, stringifyFunction, ArgList(arguments), "JSON.stringify"_s);
    RETURN_IF_EXCEPTION(scope, );

    WTF::String string;
    if (json.isString()) {
        string = asString(json)->value(globalObject);
        RETURN_IF_EXCEPTION(scope, );
    }
    *out = Bun::toStringRef(string);
}
