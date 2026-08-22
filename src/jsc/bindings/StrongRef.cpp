#include "root.h"
#include "StrongRef.h"
#include <JavaScriptCore/StrongSet.h>

extern "C" JSC::JSValue* Bun__StrongRef__new(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    JSC::HandleSlot slot = JSC::getVM(globalObject).heap.strongSet()->allocate();
    // No barrier, as in JSC::Strong::set(): marking scans every slot.
    *slot = JSC::JSValue::decode(encodedValue);
    return slot;
}

extern "C" void Bun__StrongRef__delete(JSC::JSValue* _Nonnull slot)
{
    JSC::StrongSet::deallocate(slot);
}
