#include "root.h"
#include "StrongRef.h"
#include <JavaScriptCore/Strong.h>
#include <JavaScriptCore/StrongInlines.h>
#include "BunClientData.h"
#include "wtf/DebugHeap.h"
#include "ZigGlobalObject.h"

extern "C" void Bun__StrongRef__delete(JSC::JSValue* _Nonnull handleSlot)
{
    // deallocate() will correctly remove the handle from the strong list if it's currently on it.
    JSC::HandleSet::heapFor(handleSlot)->deallocate(handleSlot);
}

extern "C" JSC::JSValue* Bun__StrongRef__new(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    auto& vm = globalObject->vm();
    JSC::HandleSet* handleSet = vm.heap.handleSet();
    JSC::HandleSlot handleSlot = handleSet->allocate();
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);

    // The write barrier must be called to add the handle to the strong
    // list if the new value is a cell. We must use <false> because the value
    // might be a primitive.
    handleSet->writeBarrier<false>(handleSlot, value);
    *handleSlot = value;
    return handleSlot;
}

extern "C" void Bun__StrongRef__set(JSC::JSValue* _Nonnull handleSlot, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    auto& vm = globalObject->vm();
    JSC::JSValue value = JSC::JSValue::decode(encodedValue);

    // The write barrier must be called *before* the value in the slot is updated
    // to correctly update the handle's status in the strong list (e.g. moving
    // from strong to not strong or vice versa).
    // Use <false> because the new value can be a primitive.
    vm.heap.handleSet()->writeBarrier<false>(handleSlot, value);
    *handleSlot = value;
}

extern "C" void Bun__StrongRef__clear(JSC::JSValue* _Nonnull handleSlot)
{
    // The write barrier must be called *before* the value is cleared
    // to correctly remove the handle from the strong list if it held a cell.
    JSC::HandleSet::heapFor(handleSlot)->writeBarrier<false>(handleSlot, {});
    *handleSlot = {};
}
