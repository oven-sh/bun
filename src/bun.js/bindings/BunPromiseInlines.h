#pragma once

namespace Bun {

static inline JSC::JSPromise* createFulfilledPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    JSC::JSPromise* promise = JSC::JSPromise::create(globalObject->vm(), globalObject->promiseStructure());
    promise->fulfill(globalObject, value);
    return promise;
}

}
