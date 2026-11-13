// Copyright (c) Meta Platforms, Inc. and affiliates. MIT license: what src/runtime/test_runner/equality_testers.rs is ported from.

#include "root.h"

#include "GeneratedExpect.h"
#include <JavaScriptCore/ArrayConstructor.h>
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSFunctionInlines.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/Operations.h>

// What `iterableEquality` and `subsetEquality` of src/runtime/test_runner/equality_testers.rs ask of the values they compare.

using namespace JSC;

namespace Bun {
JSString* objectPrototypeToStringOutOfLine(JSGlobalObject*, JSValue);
}

// `!!(value != null && value[Symbol.iterator])`
static bool hasIterator(JSGlobalObject* globalObject, JSValue value)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (value.isUndefinedOrNull())
        return false;
    JSValue method = value.get(globalObject, vm.propertyNames->iteratorSymbol);
    RETURN_IF_EXCEPTION(scope, false);
    return method.toBoolean(globalObject);
}

// Whether iterableEquality() compares the two: both are iterable objects, and neither is an array, a typed array or a DataView.
extern "C" bool ExpectEqualityTesters__areIterables(JSGlobalObject* globalObject, EncodedJSValue encodedA, EncodedJSValue encodedB)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue a = JSValue::decode(encodedA);
    JSValue b = JSValue::decode(encodedB);
    if (!jsTypeofIsObject(globalObject, a) || !jsTypeofIsObject(globalObject, b))
        return false;
    bool isArrayA = isArray(globalObject, a);
    RETURN_IF_EXCEPTION(scope, false);
    if (isArrayA)
        return false;
    bool isArrayB = isArray(globalObject, b);
    RETURN_IF_EXCEPTION(scope, false);
    if (isArrayB)
        return false;
    auto isView = [](JSValue value) { return value.isCell() && isTypedArrayTypeIncludingDataView(value.asCell()->type()); };
    if (isView(a) || isView(b))
        return false;
    bool hasIteratorA = hasIterator(globalObject, a);
    RETURN_IF_EXCEPTION(scope, false);
    if (!hasIteratorA)
        return false;
    RELEASE_AND_RETURN(scope, hasIterator(globalObject, b));
}

// Jest's isNativeFunction(): `typeof value === "function" && Function.prototype.toString.call(value).includes("[native code]")`
extern "C" bool ExpectEqualityTesters__isNativeFunction(JSGlobalObject* globalObject, EncodedJSValue encodedValue)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue value = JSValue::decode(encodedValue);
    if (!jsTypeofIsFunction(globalObject, value))
        return false;
    // Function.prototype.toString() prints every other callable as native code.
    auto* function = dynamicDowncast<JSFunction>(value);
    if (!function)
        return true;
    JSString* text = function->toString(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    auto view = text->view(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    return view->find("[native code]"_s) != notFound;
}

// The search of iterableEquality() for a pair that an outer call is comparing: -1 if `a` is new, and the pair is pushed. Else whether `b` is what `a` is compared with there.
extern "C" int8_t ExpectEqualityTesters__enter(JSGlobalObject* globalObject, EncodedJSValue encodedAStack, EncodedJSValue encodedBStack, EncodedJSValue encodedA, EncodedJSValue encodedB)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    auto* aStack = uncheckedDowncast<JSArray>(JSValue::decode(encodedAStack));
    auto* bStack = uncheckedDowncast<JSArray>(JSValue::decode(encodedBStack));
    JSValue a = JSValue::decode(encodedA);
    JSValue b = JSValue::decode(encodedB);
    for (unsigned length = aStack->length(); length--;) {
        JSValue seen = aStack->getIndex(globalObject, length);
        RETURN_IF_EXCEPTION(scope, 0);
        if (seen != a)
            continue;
        JSValue comparedWith = bStack->getIndex(globalObject, length);
        RETURN_IF_EXCEPTION(scope, 0);
        return comparedWith == b;
    }
    aStack->push(globalObject, a);
    RETURN_IF_EXCEPTION(scope, 0);
    bStack->push(globalObject, b);
    RETURN_IF_EXCEPTION(scope, 0);
    return -1;
}

extern "C" void ExpectEqualityTesters__leave(JSGlobalObject* globalObject, EncodedJSValue encodedAStack, EncodedJSValue encodedBStack)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    uncheckedDowncast<JSArray>(JSValue::decode(encodedAStack))->pop(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    scope.release();
    uncheckedDowncast<JSArray>(JSValue::decode(encodedBStack))->pop(globalObject);
}

// `list.filter(item => item !== without)` when there is something to leave out, else `[...list]`.
extern "C" EncodedJSValue ExpectEqualityTesters__copy(JSGlobalObject* globalObject, EncodedJSValue encodedList, EncodedJSValue encodedWithout)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    auto* list = uncheckedDowncast<JSArray>(JSValue::decode(encodedList));
    JSValue without = JSValue::decode(encodedWithout);
    MarkedArgumentBuffer items;
    // filter() reads the length once and skips a hole. Spreading reads the length at every step, and a hole as undefined.
    unsigned lengthAtStart = list->length();
    for (unsigned i = 0; i < (without ? lengthAtStart : list->length()); i++) {
        if (without) {
            bool isThere = list->hasProperty(globalObject, i);
            RETURN_IF_EXCEPTION(scope, {});
            if (!isThere)
                continue;
        }
        JSValue item = list->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        if (item != without)
            items.append(item);
    }
    if (items.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), items)));
}

// The tester that a call hands to the comparison of its members: it calls `target` with `bound` ahead of the two values.
extern "C" EncodedJSValue ExpectEqualityTesters__bind(JSGlobalObject* globalObject, EncodedJSValue encodedTarget, EncodedJSValue boundThis, const EncodedJSValue* bound, size_t count)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* target = asObject(JSValue::decode(encodedTarget));
    RELEASE_AND_RETURN(scope, JSValue::encode(JSBoundFunction::create(vm, globalObject, target, JSValue::decode(boundThis), ArgList(const_cast<EncodedJSValue*>(bound), count), 2, nullptr, SourceTaintedOrigin::Untainted)));
}

// 1 if Object.prototype.toString() names `value` a Set, 2 if a Map.
extern "C" uint8_t ExpectEqualityTesters__collectionTag(JSGlobalObject* globalObject, EncodedJSValue encodedValue)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSString* tag = Bun::objectPrototypeToStringOutOfLine(globalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(scope, 0);
    auto view = tag->view(globalObject);
    RETURN_IF_EXCEPTION(scope, 0);
    if (view == "[object Set]"_s)
        return 1;
    return view == "[object Map]"_s ? 2 : 0;
}

// `for (const value of iterable)`. `each` answers false to break. Breaking or throwing closes the iterator, as the statement does.
extern "C" void ExpectEqualityTesters__forOf(JSGlobalObject* globalObject, EncodedJSValue encodedIterable, void* context, bool (*each)(void* context, EncodedJSValue value))
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    IterationRecord record = iteratorForIterable(globalObject, JSValue::decode(encodedIterable));
    RETURN_IF_EXCEPTION(scope, );
    while (true) {
        JSValue step = iteratorStep(globalObject, record);
        RETURN_IF_EXCEPTION(scope, );
        if (step.isFalse())
            return;
        JSValue value = iteratorValue(globalObject, step);
        RETURN_IF_EXCEPTION(scope, );
        bool goesOn = each(context, JSValue::encode(value));
        if (scope.exception() || !goesOn) [[unlikely]] {
            scope.release();
            iteratorClose(globalObject, record.iterator);
            return;
        }
    }
}

// `value[Symbol.iterator]()`
static JSValue openIterator(JSGlobalObject* globalObject, JSValue value)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue method = value.get(globalObject, vm.propertyNames->iteratorSymbol);
    RETURN_IF_EXCEPTION(scope, {});
    auto callData = getCallData(method);
    if (callData.type == CallData::Type::None) {
        throwTypeError(globalObject, scope, "object[Symbol.iterator] is not a function"_s);
        return {};
    }
    RELEASE_AND_RETURN(scope, call(globalObject, method, callData, value, ArgList()));
}

// Empty with nothing thrown if that throws, as after the `catch` of Jest's. A stack overflow stays thrown: equals() would go on and take the two for equal.
extern "C" EncodedJSValue ExpectEqualityTesters__tryOpenIterator(JSGlobalObject* globalObject, EncodedJSValue encodedValue)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(getVM(globalObject));
    JSValue iterator = openIterator(globalObject, JSValue::decode(encodedValue));
    if (auto* exception = scope.exception()) [[unlikely]] {
        auto* error = dynamicDowncast<ErrorInstance>(exception->value());
        if (!error || !error->isStackOverflowError())
            (void)scope.tryClearException();
        return {};
    }
    return JSValue::encode(iterator);
}

// Jest's entries(): `[key, object[key]]` of every own symbol but Symbol.iterator, then Object.entries(object).
extern "C" EncodedJSValue ExpectEqualityTesters__entries(JSGlobalObject* globalObject, EncodedJSValue encodedObject)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* object = asObject(JSValue::decode(encodedObject));
    MarkedArgumentBuffer entries;
    for (bool isOfObjectEntries : { false, true }) {
        JSArray* keys = ownPropertyKeys(globalObject, object, isOfObjectEntries ? PropertyNameMode::Strings : PropertyNameMode::Symbols, DontEnumPropertiesMode::Include);
        RETURN_IF_EXCEPTION(scope, {});
        for (unsigned i = 0; i < keys->length(); i++) {
            JSValue key = keys->getIndex(globalObject, i);
            RETURN_IF_EXCEPTION(scope, {});
            auto name = key.toPropertyKey(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (name == vm.propertyNames->iteratorSymbol)
                continue;
            // Object.entries() looks at each property again before it reads it: the getter of one before it can have deleted it.
            if (isOfObjectEntries) {
                PropertyDescriptor descriptor;
                bool isOwn = object->getOwnPropertyDescriptor(globalObject, name, descriptor);
                RETURN_IF_EXCEPTION(scope, {});
                if (!isOwn || !descriptor.enumerable())
                    continue;
            }
            JSValue value = object->get(globalObject, name);
            RETURN_IF_EXCEPTION(scope, {});
            entries.append(constructArrayPair(globalObject, key, value));
            RETURN_IF_EXCEPTION(scope, {});
        }
    }
    if (entries.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), entries)));
}

// Jest's getObjectKeys(): Object.keys(object), then the enumerable own symbols.
extern "C" EncodedJSValue ExpectEqualityTesters__keys(JSGlobalObject* globalObject, EncodedJSValue encodedObject)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSObject* object = asObject(JSValue::decode(encodedObject));
    JSArray* keys = ownPropertyKeys(globalObject, object, PropertyNameMode::Strings, DontEnumPropertiesMode::Exclude);
    RETURN_IF_EXCEPTION(scope, {});
    JSArray* symbols = ownPropertyKeys(globalObject, object, PropertyNameMode::Symbols, DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, {});
    for (unsigned i = 0; i < symbols->length(); i++) {
        JSValue symbol = symbols->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        auto name = symbol.toPropertyKey(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        PropertyDescriptor descriptor;
        bool isOwn = object->getOwnPropertyDescriptor(globalObject, name, descriptor);
        RETURN_IF_EXCEPTION(scope, {});
        if (!isOwn || !descriptor.enumerable())
            continue;
        keys->push(globalObject, symbol);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(keys);
}

// What subsetEquality() compares key by key: an object that is no Error, array, Date, Set or Map.
extern "C" bool ExpectEqualityTesters__isObjectWithKeys(JSGlobalObject* globalObject, EncodedJSValue encodedValue)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue value = JSValue::decode(encodedValue);
    if (value.isNull() || !jsTypeofIsObject(globalObject, value))
        return false;
    auto isInstanceOf = [&](JSObject* prototype) { return JSObject::defaultHasInstance(globalObject, value, prototype); };
    bool isError = isInstanceOf(globalObject->errorPrototype());
    RETURN_IF_EXCEPTION(scope, false);
    if (isError)
        return false;
    bool isList = isArray(globalObject, value);
    RETURN_IF_EXCEPTION(scope, false);
    if (isList)
        return false;
    for (JSObject* prototype : { globalObject->datePrototype(), globalObject->jsSetPrototype(), globalObject->mapPrototype() }) {
        bool isInstance = isInstanceOf(prototype);
        RETURN_IF_EXCEPTION(scope, false);
        if (isInstance)
            return false;
    }
    return true;
}

// Jest's hasPropertyInObject(). Like it, it calls itself for each prototype, so that a Proxy that is its own prototype ends in a RangeError.
static bool hasPropertyInObject(JSGlobalObject* globalObject, JSValue value, PropertyName key)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (value.isNull() || !jsTypeofIsObject(globalObject, value) || value == globalObject->objectPrototype())
        return false;
    if (!vm.isSafeToRecurse()) [[unlikely]] {
        throwStackOverflowError(globalObject, scope);
        return false;
    }
    JSObject* object = asObject(value);
    bool hasOwn = object->hasOwnProperty(globalObject, key);
    RETURN_IF_EXCEPTION(scope, false);
    if (hasOwn)
        return true;
    JSValue prototype = object->getPrototype(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    bool isInherited = hasPropertyInObject(globalObject, prototype, key);
    RETURN_IF_EXCEPTION(scope, false);
    return isInherited;
}

extern "C" bool ExpectEqualityTesters__hasPropertyInObject(JSGlobalObject* globalObject, EncodedJSValue encodedValue, EncodedJSValue encodedKey)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    auto key = JSValue::decode(encodedKey).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    RELEASE_AND_RETURN(scope, hasPropertyInObject(globalObject, JSValue::decode(encodedValue), key));
}

static bool isSubsetTester(JSValue tester)
{
    auto* function = dynamicDowncast<JSFunction>(tester);
    if (auto* bound = dynamicDowncast<JSBoundFunction>(tester))
        function = dynamicDowncast<JSFunction>(bound->targetFunction());
    if (!function || !function->isHostFunction())
        return false;
    auto hostFunction = function->nativeFunction();
    return hostFunction == toTagged(Bun__ExpectMatcherUtils__subsetEquality) || hostFunction == toTagged(Bun__ExpectMatcherUtils__subsetEqualityWithContext);
}

// `list` without subsetEquality() of `this.utils` and what a call of it hands to its properties. Empty, with nothing thrown, if it has neither.
extern "C" EncodedJSValue ExpectEqualityTesters__withoutSubsetTesters(JSGlobalObject* globalObject, EncodedJSValue encodedList)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    auto* list = uncheckedDowncast<JSArray>(JSValue::decode(encodedList));
    MarkedArgumentBuffer others;
    unsigned length = list->length();
    for (unsigned i = 0; i < length; i++) {
        JSValue tester = list->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        if (!isSubsetTester(tester))
            others.append(tester);
    }
    if (others.size() == length)
        return {};
    if (others.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), others)));
}

extern "C" bool ExpectEqualityTesters__hasSubsetTester(JSGlobalObject* globalObject, EncodedJSValue encodedList)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    auto* list = uncheckedDowncast<JSArray>(JSValue::decode(encodedList));
    for (unsigned i = 0; i < list->length(); i++) {
        JSValue tester = list->getIndex(globalObject, i);
        RETURN_IF_EXCEPTION(scope, false);
        if (isSubsetTester(tester))
            return true;
    }
    return false;
}
