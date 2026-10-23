#include "blob.h"
#include "GeneratedBlob.h"

extern "C" void Blob__setAsFile(void* impl, const BunString* filename);

namespace WebCore {

using Bun::Bindgen::Generated::JSBlob;

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, WebCore::Blob& impl)
{
    BunString filename = Bun::toString(impl.fileName());
    Blob__setAsFile(impl.impl(), &filename);

    return Bun::Bindgen::createWrapper<JSBlob>(lexicalGlobalObject, Blob__dupe(impl.impl()));
}

size_t Blob::memoryCost() const
{
    return sizeof(Blob) + JSBlob::extraMemorySize(impl());
}

}
