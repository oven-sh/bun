#include "root.h"
#include <JavaScriptCore/StrongInlines.h>
#include "BunClientData.h"
#include "Weak.h"
namespace Bun {

WTF_MAKE_ISO_ALLOCATED_IMPL(WeakRef);

}

extern "C" void Bun__WeakRef__clear(Bun::WeakRef* weakRef)
{
    weakRef->m_cell.clear();
}

extern "C" void Bun__WeakRef__delete(Bun::WeakRef* weakRef)
{
    Bun__WeakRef__clear(weakRef);
    delete weakRef;
}

extern "C" Bun::WeakRef* Bun__WeakRef__new(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue, Bun::WeakRefType kind, void* ctx)
{
    return new Bun::WeakRef(globalObject->vm(), JSC::JSValue::decode(encodedValue), kind, ctx);
}

extern "C" JSC::EncodedJSValue Bun__WeakRef__get(Bun::WeakRef* weakRef)
{
    if (auto* cell = weakRef->m_cell.get()) {
        return JSC::JSValue::encode(cell);
    }
    return JSC::encodedJSValue();
}
