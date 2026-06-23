#include "NodeV8Module.h"

#include "JavaScriptCore/ArgList.h"
#include "JavaScriptCore/HeapIterationScope.h"
#include "JavaScriptCore/JSCInlines.h"
#include "JavaScriptCore/JSObject.h"
#include "JavaScriptCore/MarkedSpaceInlines.h"

namespace Bun {

using namespace JSC;

// Backs v8.queryObjects(): returns an array of every live object whose
// prototype chain contains the given prototype, like V8's QueryObjects.
JSC_DEFINE_HOST_FUNCTION(jsFunctionQueryObjects, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue prototypeValue = callFrame->argument(0);
    if (!prototypeValue.isObject()) {
        // The JS wrapper passes ctor.prototype; a non-object prototype can't
        // appear in any prototype chain.
        return JSValue::encode(constructEmptyArray(globalObject, nullptr, 0));
    }

    // Like V8's QueryObjects, settle the heap first so already-collectable
    // instances are not reported as live.
    vm.heap.collectNow(Sync, CollectionScope::Full);

    // No GC allocation may happen while iterating the heap; collect matches
    // into a MarkedArgumentBuffer (malloc-backed) and build the array after.
    MarkedArgumentBuffer matches;
    {
        HeapIterationScope iterationScope(vm.heap);
        vm.heap.objectSpace().forEachLiveCell(iterationScope, [&](HeapCell* cell, HeapCell::Kind kind) -> IterationStatus {
            if (!isJSCellKind(kind))
                return IterationStatus::Continue;
            JSCell* jsCell = static_cast<JSCell*>(cell);
            if (!jsCell->isObject())
                return IterationStatus::Continue;
            JSObject* object = asObject(jsCell);
            // Walk the prototype chain structurally; proxy traps and getters
            // must not run during heap iteration.
            JSValue prototype = object->getPrototypeDirect();
            while (prototype.isObject()) {
                if (prototype == prototypeValue) {
                    matches.append(object);
                    break;
                }
                prototype = asObject(prototype)->getPrototypeDirect();
            }
            return IterationStatus::Continue;
        });
    }

    if (matches.hasOverflowed()) [[unlikely]] {
        throwOutOfMemoryError(globalObject, scope);
        return {};
    }

    JSArray* result = constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), matches);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

}
