#include "root.h"

#include <JavaScriptCore/IteratorOperations.h>

using namespace JSC;

// True when the iterator of `iterable` reports done on its first step. Takes that one step only. Closes an iterator that has more, like `break` in a for-of.
extern "C" bool JSC__JSValue__isIterableEmpty(EncodedJSValue encodedIterable, JSGlobalObject* globalObject)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    IterationRecord iterationRecord = iteratorForIterable(globalObject, JSValue::decode(encodedIterable));
    RETURN_IF_EXCEPTION(scope, false);

    JSValue next = iteratorStep(globalObject, iterationRecord);
    RETURN_IF_EXCEPTION(scope, false);
    if (next.isFalse())
        return true;

    scope.release();
    iteratorClose(globalObject, iterationRecord.iterator);
    return false;
}
