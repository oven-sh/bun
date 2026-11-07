#include "root.h"
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSPromisePrototype.h>

// `then` of the promise is a function or an accessor that is not a property of a `Promise.prototype`, or a Proxy hides it.
extern "C" [[ZIG_EXPORT(nothrow)]] bool JSC__JSPromise__hasCustomThen(JSC::JSGlobalObject* globalObject, JSC::JSPromise* promise)
{
    if (promise->structure() == globalObject->promiseStructure()) [[likely]]
        return false;
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    // VMInquiry: the lookup runs no script. A Proxy on the way taints the slot instead.
    JSC::PropertySlot slot(promise, JSC::PropertySlot::InternalMethodType::VMInquiry, &vm);
    bool found = promise->getNonIndexPropertySlot(globalObject, vm.propertyNames->then, slot);
    scope.assertNoExceptionExceptTermination();
    if (slot.isTaintedByOpaqueObject())
        return true;
    if (!found || slot.slotBase()->inherits<JSC::JSPromisePrototype>())
        return false;
    return !slot.isValue() || slot.getPureResult().isCallable();
}

static_assert(JSC::JSCell::structureIDOffset() == 0, "AnyPromise::structure_id reads the StructureID at offset 0");
static_assert(sizeof(JSC::StructureID) == sizeof(uint32_t), "AnyPromise::structure_id reads the StructureID as a u32");

// What `AnyPromise::structure_id` reads for a promise of this realm that no class and no own property has reshaped.
extern "C" [[ZIG_EXPORT(nothrow)]] uint32_t JSC__JSGlobalObject__promiseStructureID(JSC::JSGlobalObject* globalObject)
{
    return globalObject->promiseStructure()->id().bits();
}
