#include "root.h"

#include <JavaScriptCore/JSPromise.h>
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

static inline JSValue then(JSGlobalObject* globalObject, JSPromise* promise, Zig::GlobalObject::PromiseHandler resolverFunction, Zig::GlobalObject::PromiseHandler rejecterFunction, JSValue ctx = jsUndefined())
{
    JSFunction* performPromiseThenFunction = globalObject->performPromiseThenFunction();
    auto callData = JSC::getCallData(performPromiseThenFunction);
    ASSERT(callData.type != CallData::Type::None);

    MarkedArgumentBuffer arguments;
    arguments.append(promise);
    auto* bunGlobalObject = jsDynamicCast<Zig::GlobalObject*>(globalObject);
    arguments.append(bunGlobalObject->thenable(resolverFunction));
    arguments.append(bunGlobalObject->thenable(rejecterFunction));
    arguments.append(jsUndefined());
    arguments.append(ctx);
    ASSERT(!arguments.hasOverflowed());
    // async context tracking is handled by performPromiseThenFunction internally.
    return JSC::profiledCall(globalObject, JSC::ProfilingReason::Microtask, performPromiseThenFunction, callData, jsUndefined(), arguments);
}

static inline JSValue then(JSGlobalObject* globalObject, JSPromise* promise, JSValue resolverFunction, JSValue rejecterFunction, JSValue ctx = jsUndefined())
{
    JSFunction* performPromiseThenFunction = globalObject->performPromiseThenFunction();
    auto callData = JSC::getCallData(performPromiseThenFunction);
    ASSERT(callData.type != CallData::Type::None);

    MarkedArgumentBuffer arguments;
    arguments.append(promise);
    arguments.append(resolverFunction);
    arguments.append(rejecterFunction);
    arguments.append(jsUndefined());
    arguments.append(ctx);
    ASSERT(!arguments.hasOverflowed());
    // async context tracking is handled by performPromiseThenFunction internally.
    return JSC::profiledCall(globalObject, JSC::ProfilingReason::Microtask, performPromiseThenFunction, callData, jsUndefined(), arguments);
}

}
