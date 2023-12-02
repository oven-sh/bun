#include "root.h"
#include <JavaScriptCore/StrongInlines.h>
#include "BunClientData.h"
#include "Strong.h"
namespace Bun {

WTF_MAKE_ISO_ALLOCATED_IMPL(StrongRef);

}

extern "C" void Bun__StrongRef__delete(Bun::StrongRef* strongRef)
{
    delete strongRef;
}

extern "C" Bun::StrongRef* Bun__StrongRef__new(JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue encodedValue)
{
    return new Bun::StrongRef(globalObject->vm(), JSC::JSValue::decode(encodedValue));
}

extern "C" JSC::EncodedJSValue Bun__StrongRef__get(Bun::StrongRef* strongRef)
{
    return JSC::JSValue::encode(strongRef->m_cell.get());
}

extern "C" void Bun__StrongRef__set(Bun::StrongRef* strongRef, JSC::JSGlobalObject* globalObject, JSC::EncodedJSValue value)
{
    strongRef->m_cell.set(globalObject->vm(), JSC::JSValue::decode(value));
}

extern "C" void Bun__StrongRef__clear(Bun::StrongRef* strongRef)
{
    strongRef->m_cell.clear();
}
