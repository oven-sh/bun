#include "blob.h"
#include "GeneratedBlob.h"

namespace WebCore {

using Bun::Bindgen::Generated::JSBlob;

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, WebCore::Blob& impl)
{
    if (auto* wrapper = impl.wrapper())
        return wrapper;

    // A FormData entry is a File already. A WebSocket message becomes one here.
    JSC::JSValue value = Bun::Bindgen::createWrapper<JSBlob>(lexicalGlobalObject, Blob__dupeAsFile(impl.impl(), nullptr));
    if (value && value.isObject())
        impl.setWrapper(asObject(value));
    return value;
}

Blob::~Blob() = default;

size_t Blob::memoryCost() const
{
    return sizeof(Blob) + JSBlob::extraMemorySize(impl());
}

}
