#include "root.h"
#include <JavaScriptCore/Strong.h>
#include <JavaScriptCore/StrongInlines.h>
#include "BunClientData.h"
#include "wtf/DebugHeap.h"
#include "ZigGlobalObject.h"

extern "C" void Bun__StrongRef__delete(JSC::JSValue* handleSlot)
{
    if (handleSlot) {
        *handleSlot = JSC::JSValue();
        JSC::HandleSet::heapFor(handleSlot)->deallocate(handleSlot);
    }
}

extern "C" JSC::JSValue* Bun__StrongRef__new(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    auto& vm = globalObject->vm();
    auto handleSlot = vm.heap.handleSet()->allocate();
    auto value = JSC::JSValue::decode(encodedValue);

    vm.heap.handleSet()->heapFor(handleSlot)->writeBarrier<true>(handleSlot, value);
    *handleSlot = value;
    return handleSlot;
}

extern "C" JSC::EncodedJSValue Bun__StrongRef__get(JSC::JSValue* handleSlot)
{
    return handleSlot && *handleSlot ? JSC::JSValue::encode(*handleSlot) : JSC::JSValue::encode(JSC::JSValue());
}

extern "C" void Bun__StrongRef__set(JSC::JSValue* handleSlot, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    auto& vm = globalObject->vm();
    auto decodedValue = JSC::JSValue::decode(value);
    vm.heap.handleSet()->heapFor(handleSlot)->writeBarrier<true>(handleSlot, decodedValue);
    *handleSlot = decodedValue;
}

extern "C" void Bun__StrongRef__clear(JSC::JSValue* handleSlot)
{
    if (handleSlot && *handleSlot) {
        auto& vm = handleSlot->asCell()->vm();
        *handleSlot = JSC::JSValue();
        vm.heap.handleSet()->heapFor(handleSlot)->writeBarrier<true>(handleSlot, JSC::JSValue());
    }
}
