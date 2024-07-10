#include "blob.h"
#include "ZigGeneratedClasses.h"

extern "C" JSC::EncodedJSValue SYSV_ABI Blob__create(JSC::JSGlobalObject* globalObject, void* impl);
extern "C" void* Blob__setAsFile(void* impl, BunString* filename);

namespace WebCore {

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, WebCore::Blob& impl)
{
    BunString filename = Bun::toString(impl.fileName());
    impl.m_impl = Blob__setAsFile(impl.impl(), &filename);

    return JSC::JSValue::decode(Blob__create(lexicalGlobalObject, Blob__dupe(impl.impl())));
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Ref<WebCore::Blob>&& impl)
{
    auto fileNameStr = impl->fileName();
    BunString filename = Bun::toString(fileNameStr);

    JSC::EncodedJSValue encoded = Blob__create(lexicalGlobalObject, impl->impl());
    JSBlob* blob = jsCast<JSBlob*>(JSC::JSValue::decode(encoded));
    Blob__setAsFile(blob->wrapped(), &filename);

    return JSC::JSValue::decode(encoded);
}

}