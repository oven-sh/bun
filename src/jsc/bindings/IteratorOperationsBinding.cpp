#include "root.h"

#include <JavaScriptCore/IteratorOperations.h>

using namespace JSC;

using ForEachCallback = void (*)(VM*, JSGlobalObject*, void* ctx, EncodedJSValue);

// Visits at most `limit` elements of `iterable` through the iterator protocol. When the iterator has more, closes it like `break` in a for-of and returns true.
static bool forEachInIteratorProtocolWithLimit(JSGlobalObject* globalObject, JSValue iterable, uint32_t limit, void* ctx, ForEachCallback callback)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    IterationRecord iterationRecord = iteratorForIterable(globalObject, iterable);
    RETURN_IF_EXCEPTION(scope, false);

    for (uint32_t visited = 0;; visited++) {
        JSValue next = iteratorStep(globalObject, iterationRecord);
        RETURN_IF_EXCEPTION(scope, false);
        if (next.isFalse())
            return false;
        if (visited == limit)
            break;

        JSValue nextValue = iteratorValue(globalObject, next);
        RETURN_IF_EXCEPTION(scope, false);

        callback(&vm, globalObject, ctx, JSValue::encode(nextValue));
        if (scope.exception()) [[unlikely]]
            break;
    }

    scope.release();
    iteratorClose(globalObject, iterationRecord.iterator);
    return true;
}

// True when the iterator of `iterable` reports done on its first step. Takes that one step only.
extern "C" bool JSC__JSValue__isIterableEmpty(EncodedJSValue encodedIterable, JSGlobalObject* globalObject)
{
    return !forEachInIteratorProtocolWithLimit(globalObject, JSValue::decode(encodedIterable), 0, nullptr, nullptr);
}

// `JSC::forEachInIterable`, except that an iterator user code can observe gives at most `limit` elements.
extern "C" void JSC__JSValue__forEachWithLimit(EncodedJSValue encodedIterable, JSGlobalObject* globalObject, uint32_t limit, void* ctx, ForEachCallback callback)
{
    JSValue iterable = JSValue::decode(encodedIterable);

    bool isObservable = true;
    if (getIterationMode(iterable) == IterationMode::FastArray)
        isObservable = false;
    else if (auto* map = dynamicDowncast<JSMap>(iterable))
        isObservable = !map->isIteratorProtocolFastAndNonObservable();
    else if (auto* set = dynamicDowncast<JSSet>(iterable))
        isObservable = !set->isIteratorProtocolFastAndNonObservable();

    if (!isObservable) {
        // forEachInIterable reads the collection's own storage here, so the collection bounds the walk.
        forEachInIterable(globalObject, iterable, [&](VM& vm, JSGlobalObject* global, JSValue value) {
            callback(&vm, global, ctx, JSValue::encode(value));
        });
        return;
    }

    forEachInIteratorProtocolWithLimit(globalObject, iterable, limit, ctx, callback);
}
