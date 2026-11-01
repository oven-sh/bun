#include "blob.h"
#include "GeneratedBlob.h"

extern "C" void Blob__setAsFile(void* impl, const BunString* filename);

namespace WebCore {

using Bun::Bindgen::Generated::JSBlob;

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, WebCore::Blob& impl)
{
    if (auto* wrapper = impl.wrapper())
        return wrapper;

    BunString filename = Bun::toString(impl.fileName());
    Blob__setAsFile(impl.impl(), &filename);

    JSC::JSValue value = Bun::Bindgen::createWrapper<JSBlob>(lexicalGlobalObject, Blob__dupe(impl.impl()));
    if (value && value.isObject())
        impl.setWrapper(asObject(value));
    return value;
}

size_t Blob::memoryCost() const
{
    return sizeof(Blob) + JSBlob::extraMemorySize(impl());
}

}
