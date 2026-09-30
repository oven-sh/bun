// The reads the value formatter (src/jsc/formatter/reader.rs) makes on its own
// account. None of them runs user code: no getter, no Proxy trap, no replaced
// `size`, `toString` or iterator. `util.inspect` holds itself to the same rule.

#include "root.h"

#include "BunString.h"
#include "headers-handwritten.h"
#include "JSErrorEvent.h"
#include "JSEvent.h"
#include "JSMessageEvent.h"

#include <JavaScriptCore/BigIntObject.h>
#include <JavaScriptCore/BooleanObject.h>
#include <JavaScriptCore/IteratorOperations.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSMap.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/JSSet.h>
#include <JavaScriptCore/JSSetIterator.h>
#include <JavaScriptCore/JSWrapperObject.h>
#include <JavaScriptCore/NumberObject.h>
#include <JavaScriptCore/RegExpObject.h>
#include <JavaScriptCore/StringObject.h>
#include <JavaScriptCore/SymbolObject.h>

using namespace JSC;

// An own data property. Empty for an accessor, a Proxy or a module namespace export.
extern "C" EncodedJSValue Bun__FormatterReads__ownData(EncodedJSValue encodedValue, JSGlobalObject* globalObject, const BunString* propertyName)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSObject* object = JSValue::decode(encodedValue).getObject();
    if (!object)
        return {};
    auto property = PropertyName(Identifier::fromString(vm, propertyName->toWTFString(BunString::ZeroCopy)));
    PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, &vm);
    bool hasSlot = object->methodTable()->getOwnPropertySlot(object, globalObject, property, slot);
    scope.assertNoExceptionExceptTermination();
    if (!hasSlot || !slot.isValue())
        return {};
    return JSValue::encode(slot.getValue(globalObject, property));
}

// [[NumberData]], [[StringData]], [[BooleanData]], [[SymbolData]] or [[BigIntData]].
extern "C" EncodedJSValue Bun__FormatterReads__boxedPrimitive(EncodedJSValue encodedValue)
{
    JSValue value = JSValue::decode(encodedValue);
    // JSWrapperObject has no ClassInfo of its own, so a downcast to it accepts any object.
    if (value.inherits<NumberObject>() || value.inherits<StringObject>() || value.inherits<BooleanObject>() || value.inherits<SymbolObject>() || value.inherits<BigIntObject>())
        return JSValue::encode(uncheckedDowncast<JSWrapperObject>(value)->internalValue());
    return encodedValue;
}

// `/source/flags` from [[OriginalSource]] and [[OriginalFlags]].
extern "C" BunString Bun__FormatterReads__regExpSource(EncodedJSValue encodedValue)
{
    if (auto* object = dynamicDowncast<RegExpObject>(JSValue::decode(encodedValue)))
        return Bun::toStringRef(object->regExp()->toSourceString());
    return BunStringEmpty;
}

// The length of an array, or the own `length` of an `arguments` object.
// 0 when that is gone or is not a number.
extern "C" uint64_t Bun__FormatterReads__arrayLength(EncodedJSValue encodedValue, JSGlobalObject* globalObject)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    JSObject* object = JSValue::decode(encodedValue).getObject();
    if (!object)
        return 0;
    if (auto* array = dynamicDowncast<JSArray>(object))
        return array->length();
    PropertySlot slot(object, PropertySlot::InternalMethodType::VMInquiry, &vm);
    bool hasSlot = object->methodTable()->getOwnPropertySlot(object, globalObject, vm.propertyNames->length, slot);
    scope.assertNoExceptionExceptTermination();
    if (!hasSlot || !slot.isValue())
        return 0;
    JSValue length = slot.getValue(globalObject, vm.propertyNames->length);
    if (!length.isNumber())
        return 0;
    double number = length.asNumber();
    return number > 0 ? static_cast<uint64_t>(std::min(number, maxSafeInteger())) : 0;
}

// The entry count of a Map or a Set. 0 for a WeakMap or a WeakSet, which cannot be listed.
extern "C" uint32_t Bun__FormatterReads__collectionSize(EncodedJSValue encodedValue)
{
    JSValue value = JSValue::decode(encodedValue);
    if (auto* map = dynamicDowncast<JSMap>(value))
        return map->size();
    if (auto* set = dynamicDowncast<JSSet>(value))
        return set->size();
    return 0;
}

enum class EventField : uint8_t {
    Type,
    Message,
    Data,
    Error,
};

// A field of the native event, whatever a subclass put in front of the prototype's getter.
// Empty when this kind of event has no such field.
extern "C" EncodedJSValue Bun__FormatterReads__eventField(EncodedJSValue encodedValue, JSGlobalObject* globalObject, EventField field)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSValue::decode(encodedValue);

    switch (field) {
    case EventField::Type:
        if (auto* event = dynamicDowncast<WebCore::JSEvent>(value))
            return JSValue::encode(jsString(vm, event->wrapped().type().string()));
        break;
    case EventField::Message:
        if (auto* event = dynamicDowncast<WebCore::JSErrorEvent>(value))
            return JSValue::encode(jsString(vm, event->wrapped().message()));
        break;
    case EventField::Data:
        if (auto* event = dynamicDowncast<WebCore::JSMessageEvent>(value))
            RELEASE_AND_RETURN(scope, JSValue::encode(event->data(*globalObject)));
        break;
    case EventField::Error:
        if (auto* event = dynamicDowncast<WebCore::JSErrorEvent>(value))
            RELEASE_AND_RETURN(scope, JSValue::encode(event->wrapped().error(*globalObject)));
        break;
    }
    return {};
}

using EntryCallback = void (*)(void* ctx, EncodedJSValue key, EncodedJSValue value);

template<typename Table>
static void forEachInStorage(VM& vm, JSCell* storage, typename Table::Helper::Entry entry, NOESCAPE const auto& visit)
{
    if (!storage || storage == vm.orderedHashTableSentinel())
        return;
    while (true) {
        auto next = Table::Helper::transitAndNext(vm, *uncheckedDowncast<typename Table::Storage>(storage), entry);
        if (!next.storage)
            return;
        storage = next.storage;
        entry = next.entry + 1;
        if (!visit(next.key, next.value))
            return;
    }
}

template<typename Table, typename Iterator>
static void forEachLeftInIterator(VM& vm, JSGlobalObject* globalObject, Iterator* iterator, void* ctx, EntryCallback callback)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSCell* storage = iterator->tryGetStorage();
    if (!storage)
        storage = iterator->iteratedObject()->storage();
    IterationKind kind = iterator->kind();
    forEachInStorage<Table>(vm, storage, iterator->entry(), [&](JSValue key, JSValue value) -> bool {
        // A Set holds its element as the key.
        if (!value)
            value = key;
        JSValue item = kind == IterationKind::Keys ? key : value;
        if (kind == IterationKind::Entries) {
            item = constructArrayPair(globalObject, key, value);
            RETURN_IF_EXCEPTION(scope, false);
        }
        callback(ctx, JSValue::encode(item), {});
        return !scope.exception();
    });
}

// Every entry of a Map (key, value) or a Set (element, empty), and what a Map or Set
// iterator has left to give (item, empty). The iterator does not advance.
extern "C" void Bun__FormatterReads__forEachEntry(EncodedJSValue encodedValue, JSGlobalObject* globalObject, void* ctx, EntryCallback callback)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSValue::decode(encodedValue);

    auto visit = [&](JSValue key, JSValue entryValue) -> bool {
        callback(ctx, JSValue::encode(key), JSValue::encode(entryValue));
        return !scope.exception();
    };

    scope.release();
    if (auto* map = dynamicDowncast<JSMap>(value))
        forEachInStorage<JSMap>(vm, map->storage(), 0, visit);
    else if (auto* set = dynamicDowncast<JSSet>(value))
        forEachInStorage<JSSet>(vm, set->storage(), 0, visit);
    else if (auto* mapIterator = dynamicDowncast<JSMapIterator>(value))
        forEachLeftInIterator<JSMap>(vm, globalObject, mapIterator, ctx, callback);
    else if (auto* setIterator = dynamicDowncast<JSSetIterator>(value))
        forEachLeftInIterator<JSSet>(vm, globalObject, setIterator, ctx, callback);
}

// `forEachInIterable` for an iterable only its own iterator can list, such as a generator.
// It gets `budget` steps. True when it had more to give.
extern "C" bool Bun__FormatterReads__forEachLimited(EncodedJSValue encodedIterable, JSGlobalObject* globalObject, uint32_t budget, void* ctx, void (*callback)(VM*, JSGlobalObject*, void* ctx, EncodedJSValue))
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue iterable = JSValue::decode(encodedIterable);

    if (getIterationMode(iterable) == IterationMode::FastArray) {
        forEachInFastArray(globalObject, iterable, uncheckedDowncast<JSArray>(iterable), [&](VM&, JSGlobalObject*, JSValue item) {
            callback(&vm, globalObject, ctx, JSValue::encode(item));
        });
        RETURN_IF_EXCEPTION(scope, false);
        return false;
    }

    IterationRecord iterationRecord = iteratorForIterable(globalObject, iterable);
    RETURN_IF_EXCEPTION(scope, false);

    bool truncated = false;
    for (uint32_t visited = 0;; visited++) {
        JSValue next = iteratorStep(globalObject, iterationRecord);
        RETURN_IF_EXCEPTION(scope, false);
        if (next.isFalse())
            return false;
        if (visited >= budget) {
            truncated = true;
            break;
        }
        JSValue item = iteratorValue(globalObject, next);
        RETURN_IF_EXCEPTION(scope, false);
        callback(&vm, globalObject, ctx, JSValue::encode(item));
        if (scope.exception()) [[unlikely]]
            break;
    }

    scope.release();
    iteratorClose(globalObject, iterationRecord.iterator);
    return truncated;
}
