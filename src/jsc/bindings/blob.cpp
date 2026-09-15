#include "blob.h"
#include "ZigGeneratedClasses.h"

extern "C" JSC::EncodedJSValue SYSV_ABI Blob__create(JSC::JSGlobalObject* globalObject, void* impl);
extern "C" void Blob__setAsFile(void* impl, const BunString* filename);
extern "C" void Blob__calculateEstimatedByteSize(void* impl);

namespace WebCore {

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, WebCore::Blob& impl)
{
    BunString filename = Bun::toString(impl.fileName());
    Blob__setAsFile(impl.impl(), &filename);

    // The dupe shares impl's store, so what Blob__create reports to the GC
    // must be computed for the dupe, not copied from impl.
    void* dupe = Blob__dupe(impl.impl());
    Blob__calculateEstimatedByteSize(dupe);
    return JSC::JSValue::decode(Blob__create(lexicalGlobalObject, dupe));
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Ref<WebCore::Blob>&& impl)
{
    auto fileNameStr = impl->fileName();
    BunString filename = Bun::toString(fileNameStr);

    JSC::EncodedJSValue encoded = Blob__create(lexicalGlobalObject, impl->impl());
    JSBlob* blob = uncheckedDowncast<JSBlob>(JSC::JSValue::decode(encoded));
    Blob__setAsFile(blob->wrapped(), &filename);

    return JSC::JSValue::decode(encoded);
}

size_t Blob::memoryCost() const
{
    return sizeof(Blob) + JSBlob::memoryCost(impl());
}

}
