
#include "root.h"

namespace Bun {

using namespace JSC;

static inline JSValue then(JSGlobalObject* globalObject, JSPromise* promise, NativeFunction resolverFunction, NativeFunction rejecterFunction, JSValue ctx = jsUndefined())
{
    JSFunction* performPromiseThenFunction = globalObject->performPromiseThenFunction();
    auto callData = JSC::getCallData(performPromiseThenFunction);
    ASSERT(callData.type != CallData::Type::None);

    MarkedArgumentBuffer arguments;
    arguments.append(promise);
    arguments.append(globalObject->thenable(resolverFunction));
    arguments.append(globalObject->thenable(rejecterFunction));
    arguments.append(jsUndefined());
    arguments.append(ctx);
    ASSERT(!arguments.hasOverflowed());
    // async context tracking is handled by performPromiseThenFunction internally.
    JSC::profiledCall(globalObject, JSC::ProfilingReason::Microtask, performPromiseThenFunction, callData, jsUndefined(), arguments);
}

}
