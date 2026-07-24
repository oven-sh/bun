#include "blob.h"
#include "ZigGeneratedClasses.h"

extern "C" JSC::EncodedJSValue SYSV_ABI Blob__create(JSC::JSGlobalObject* globalObject, void* impl);
extern "C" SYSV_ABI JSC::EncodedJSValue BUN__createJSDOMFileUnsafely(JSC::JSGlobalObject* globalObject, void* impl);
extern "C" void Blob__setAsFile(void* impl, BunString* filename);

namespace WebCore {

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, WebCore::Blob& impl)
{
    auto fileNameStr = impl.fileName();
    // WebSocket binaryType="blob" reaches here with a null fileName and must
    // stay a plain Blob; DOMFormData entries set fileName and become Files.
    if (fileNameStr.isNull()) {
        return JSC::JSValue::decode(Blob__create(lexicalGlobalObject, Blob__dupe(impl.impl())));
    }
    BunString filename = Bun::toString(fileNameStr);
    Blob__setAsFile(impl.impl(), &filename);

    return JSC::JSValue::decode(BUN__createJSDOMFileUnsafely(lexicalGlobalObject, Blob__dupe(impl.impl())));
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Ref<WebCore::Blob>&& impl)
{
    auto fileNameStr = impl->fileName();
    if (fileNameStr.isNull()) {
        return JSC::JSValue::decode(Blob__create(lexicalGlobalObject, impl->impl()));
    }
    BunString filename = Bun::toString(fileNameStr);

    JSC::EncodedJSValue encoded = BUN__createJSDOMFileUnsafely(lexicalGlobalObject, impl->impl());
    JSBlob* blob = uncheckedDowncast<JSBlob>(JSC::JSValue::decode(encoded));
    Blob__setAsFile(blob->wrapped(), &filename);

    return JSC::JSValue::decode(encoded);
}

size_t Blob::memoryCost() const
{
    return sizeof(Blob) + JSBlob::memoryCost(impl());
}

}
