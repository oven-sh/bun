#include "blob.h"
#include "GeneratedBlob.h"

extern "C" void Blob__setAsFile(void* impl, const BunString* filename);

namespace WebCore {

using Bun::Bindgen::Generated::JSBlob;

static JSBlob* createJSBlob(JSC::JSGlobalObject* globalObject, void* impl)
{
    return JSBlob::create(JSC::getVM(globalObject), Bun::Bindgen::structureForClass<JSBlob>(globalObject), impl);
}

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, WebCore::Blob& impl)
{
    BunString filename = Bun::toString(impl.fileName());
    Blob__setAsFile(impl.impl(), &filename);

    return createJSBlob(lexicalGlobalObject, Blob__dupe(impl.impl()));
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Ref<WebCore::Blob>&& impl)
{
    auto fileNameStr = impl->fileName();
    BunString filename = Bun::toString(fileNameStr);

    JSBlob* blob = createJSBlob(lexicalGlobalObject, impl->impl());
    Blob__setAsFile(blob->wrapped(), &filename);

    return blob;
}

size_t Blob::memoryCost() const
{
    return sizeof(Blob) + Bun__Bindgen__Blob__structSize + Bun__Bindgen__Blob__estimatedSize(impl());
}

}
