// The reads the value formatter (src/jsc/formatter/reader.rs) makes on its own
// account. They run no user code (no getter, no Proxy trap, no replaced `toString`),
// except where a comment says so, and there the number of steps is bounded.

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
#include <JavaScriptCore/JSArrayBufferView.h>
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

extern "C" uint32_t Bun__FormatterReads__collections(JSGlobalObject* globalObject)
{
    return getVM(globalObject).heap.objectSpace().newlyAllocatedVersion();
}

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

extern "C" uint64_t Bun__JSObject__endOfPresentIndexes(EncodedJSValue);

// The length of an array, or the own `length` of an `arguments` object. When that is
// gone, an accessor or not a number: one past the last index that is present.
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
    if (hasSlot && slot.isValue()) {
        JSValue length = slot.getValue(globalObject, vm.propertyNames->length);
        if (length.isNumber()) {
            double number = length.asNumber();
            return number > 0 ? static_cast<uint64_t>(std::min(number, maxSafeInteger())) : 0;
        }
    }

    return Bun__JSObject__endOfPresentIndexes(encodedValue);
}

// Whether listing it the way JS would cannot be told apart from reading its storage.
// False for a subclass: quick-lru extends Map, never calls `super.set`, and lists what
// it holds through its own `size` and `Symbol.iterator`.
static bool listsItsStorage(JSValue value)
{
    if (auto* map = dynamicDowncast<JSMap>(value))
        return map->isIteratorProtocolFastAndNonObservable();
    if (auto* set = dynamicDowncast<JSSet>(value))
        return set->isIteratorProtocolFastAndNonObservable();
    return false;
}

// The entry count of a Map or a Set: what a subclass reports as its `size`, which runs
// its getter. 0 for a WeakMap or a WeakSet, which cannot be listed.
extern "C" int32_t Bun__FormatterReads__collectionSize(EncodedJSValue encodedValue, JSGlobalObject* globalObject)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSValue::decode(encodedValue);
    auto* map = dynamicDowncast<JSMap>(value);
    auto* set = dynamicDowncast<JSSet>(value);
    if (!map && !set)
        return 0;
    if (listsItsStorage(value))
        return static_cast<int32_t>(std::min<uint32_t>(map ? map->size() : set->size(), std::numeric_limits<int32_t>::max()));
    JSValue size = asObject(value)->get(globalObject, vm.propertyNames->size);
    RETURN_IF_EXCEPTION(scope, 0);
    RELEASE_AND_RETURN(scope, size.toInt32(globalObject));
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

// Visits at most `limit` entries: printing one can run code that adds another, and the walk
// follows the table as it grows. True when there were more.
template<typename Table>
static bool forEachInStorage(VM& vm, JSCell* storage, typename Table::Helper::Entry entry, uint32_t limit, NOESCAPE const auto& visit)
{
    if (!storage || storage == vm.orderedHashTableSentinel())
        return false;
    while (true) {
        auto next = Table::Helper::transitAndNext(vm, *uncheckedDowncast<typename Table::Storage>(storage), entry);
        if (!next.storage)
            return false;
        if (!limit--)
            return true;
        storage = next.storage;
        entry = next.entry + 1;
        if (!visit(next.key, next.value))
            return false;
    }
}

template<typename Table, typename Iterator>
static bool forEachLeftInIterator(VM& vm, JSGlobalObject* globalObject, Iterator* iterator, void* ctx, EntryCallback callback)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSCell* storage = iterator->tryGetStorage();
    if (storage == vm.orderedHashTableSentinel())
        return false;
    Table* iterated = iterator->iteratedObject();
    if (!storage)
        storage = iterated->storage();
    IterationKind kind = iterator->kind();
    return forEachInStorage<Table>(vm, storage, iterator->entry(), iterated->size(), [&](JSValue key, JSValue value) -> bool {
        // A Set holds its element as the key.
        if (!value)
            value = key;
        JSValue item = kind == IterationKind::Keys ? key : value;
        if (kind == IterationKind::Entries) {
            item = constructArrayPair(globalObject, key, value);
            if (scope.exception()) [[unlikely]]
                return false;
        }
        callback(ctx, JSValue::encode(item), {});
        return !scope.exception();
    });
}

// Every entry of a Map (key, value) or a Set (element, empty), and what a Map or Set
// iterator has left to give (item, empty). The iterator does not advance.
//
// A Map or a Set that does not list its storage is listed by its own iterator. Either way it
// gets as many steps as `size`, the entry count the caller read. True when it had more.
extern "C" bool Bun__FormatterReads__forEachEntry(EncodedJSValue encodedValue, JSGlobalObject* globalObject, int32_t size, void* ctx, EntryCallback callback)
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue value = JSValue::decode(encodedValue);

    auto visit = [&](JSValue key, JSValue entryValue) -> bool {
        callback(ctx, JSValue::encode(key), JSValue::encode(entryValue));
        return !scope.exception();
    };

    if (auto* mapIterator = dynamicDowncast<JSMapIterator>(value))
        RELEASE_AND_RETURN(scope, forEachLeftInIterator<JSMap>(vm, globalObject, mapIterator, ctx, callback));
    if (auto* setIterator = dynamicDowncast<JSSetIterator>(value))
        RELEASE_AND_RETURN(scope, forEachLeftInIterator<JSSet>(vm, globalObject, setIterator, ctx, callback));

    auto* map = dynamicDowncast<JSMap>(value);
    auto* set = dynamicDowncast<JSSet>(value);
    if (!map && !set)
        return false;
    if (listsItsStorage(value)) {
        uint32_t limit = std::max(size, 0);
        bool truncated = map
            ? forEachInStorage<JSMap>(vm, map->storage(), 0, limit, visit)
            : forEachInStorage<JSSet>(vm, set->storage(), 0, limit, visit);
        RETURN_IF_EXCEPTION(scope, false);
        return truncated;
    }

    // `size` is then whatever its getter returned. What it holds is not.
    uint32_t held = map ? map->size() : set->size();
    size = static_cast<int32_t>(std::min<uint32_t>(std::max(size, 0), std::max<uint32_t>(held, 1 << 20)));

    IterationRecord iterationRecord = iteratorForIterable(globalObject, value);
    RETURN_IF_EXCEPTION(scope, false);

    bool truncated = false;
    for (int32_t visited = 0;; visited++) {
        JSValue next = iteratorStep(globalObject, iterationRecord);
        RETURN_IF_EXCEPTION(scope, false);
        if (next.isFalse())
            return false;
        if (visited >= size) {
            truncated = true;
            break;
        }
        JSValue item = iteratorValue(globalObject, next);
        RETURN_IF_EXCEPTION(scope, false);
        JSValue entryValue;
        if (map) {
            JSValue pair = item;
            item = pair.get(globalObject, 0u);
            RETURN_IF_EXCEPTION(scope, false);
            entryValue = pair.get(globalObject, 1u);
            RETURN_IF_EXCEPTION(scope, false);
        }
        if (!visit(item, entryValue))
            break;
    }

    scope.release();
    iteratorClose(globalObject, iterationRecord.iterator);
    return truncated;
}

// `forEachInIterable` with the steps bounded: by the length of a typed array, and by `budget`
// for an iterable only its own iterator can list, such as a generator. True when it had more to give.
extern "C" bool Bun__FormatterReads__forEachLimited(EncodedJSValue encodedIterable, JSGlobalObject* globalObject, uint32_t budget, void* ctx, void (*callback)(VM*, JSGlobalObject*, void* ctx, EncodedJSValue))
{
    VM& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue iterable = JSValue::decode(encodedIterable);

    uint64_t bound = budget;
    if (auto* view = dynamicDowncast<JSArrayBufferView>(iterable))
        bound = view->length();

    IterationRecord iterationRecord = iteratorForIterable(globalObject, iterable);
    RETURN_IF_EXCEPTION(scope, false);

    bool truncated = false;
    for (uint64_t visited = 0;; visited++) {
        JSValue next = iteratorStep(globalObject, iterationRecord);
        RETURN_IF_EXCEPTION(scope, false);
        if (next.isFalse())
            return false;
        if (visited >= bound) {
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
