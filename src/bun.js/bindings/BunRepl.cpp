#include "root.h"
#include "ScriptExecutionContext.h"
#include "JavaScriptCore/JSInternalPromise.h"

namespace Bun {

using namespace JSC;
using namespace WebCore;

/*JSC_DEFINE_HOST_FUNCTION(jsFunctionPromiseHandler, (JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)) {
    return JSValue::encode(jsUndefined());
}*/

extern "C" void Bun__startReplThread(Zig::GlobalObject* replGlobalObject) {
    JSC::VM& vm = replGlobalObject->vm();
    JSValue defaultValue = replGlobalObject->internalModuleRegistry()->requireId(replGlobalObject, vm, InternalModuleRegistry::Field::InternalRepl);
    JSValue startFn = defaultValue.getObject()->getDirect(vm, JSC::Identifier::fromString(vm, "start"_s));
    JSFunction* replDefaultFn = jsDynamicCast<JSFunction*>(startFn.asCell());

    MarkedArgumentBuffer arguments;
    //arguments.append(jsNumber(1));
    JSC::call(replGlobalObject, replDefaultFn, JSC::getCallData(replDefaultFn), JSC::jsUndefined(), arguments);

    // in case we ever need to get a return value from the repl, use this:
    /*auto returnValue = ^
    auto* returnCell = returnValue.asCell();
    if (JSC::JSPromise* promise = JSC::jsDynamicCast<JSC::JSPromise*>(returnCell)) {
        JSFunction* performPromiseThenFunction = replGlobalObject->performPromiseThenFunction();
        auto callData = JSC::getCallData(performPromiseThenFunction);
        ASSERT(callData.type != CallData::Type::None);

        MarkedArgumentBuffer arguments;
        arguments.append(promise);
        arguments.append(JSFunction::create(vm, replGlobalObject, 1, String("resolver"_s), jsFunctionPromiseHandler, ImplementationVisibility::Public));
        arguments.append(JSFunction::create(vm, replGlobalObject, 1, String("rejecter"_s), jsFunctionPromiseHandler, ImplementationVisibility::Public));
        arguments.append(jsUndefined());
        arguments.append(jsUndefined()); // "ctx" ?
        ASSERT(!arguments.hasOverflowed());
        // async context tracking is handled by performPromiseThenFunction internally.
        JSC::profiledCall(replGlobalObject, JSC::ProfilingReason::Microtask, performPromiseThenFunction, callData, jsUndefined(), arguments);
    } else if (JSC::JSInternalPromise* promise = JSC::jsDynamicCast<JSC::JSInternalPromise*>(returnCell)) {
        RELEASE_ASSERT(false);
    }*/
}

}
