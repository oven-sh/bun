#include "blob.h"
#include "ZigGeneratedClasses.h"

extern "C" JSC::EncodedJSValue SYSV_ABI Blob__create(JSC::JSGlobalObject* globalObject, void* impl);
extern "C" void Blob__setAsFile(void* impl, const BunString* filename);

namespace WebCore {

// A FormData entry owns its filename, which is never null. A Blob that is
// not an entry (a WebSocket message) has no name to give.
static BunString fileNameOrDead(const String& fileName)
{
    return fileName.isNull() ? BunString { BunStringTag::Dead } : Bun::toString(fileName);
}

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, WebCore::Blob& impl)
{
    const String& entryName = impl.fileName();
    BunString filename = fileNameOrDead(entryName);
    void* dupe = Blob__dupe(impl.impl());
    Blob__setAsFile(dupe, &filename);

    return JSC::JSValue::decode(Blob__create(lexicalGlobalObject, dupe));
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Ref<WebCore::Blob>&& impl)
{
    auto fileNameStr = impl->fileName();
    BunString filename = fileNameOrDead(fileNameStr);

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
