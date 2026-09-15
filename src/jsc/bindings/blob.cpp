#include "blob.h"
#include "BunString.h"
#include "ZigGeneratedClasses.h"

extern "C" JSC::EncodedJSValue SYSV_ABI Blob__create(JSC::JSGlobalObject* globalObject, void* impl);
extern "C" void Blob__setAsFile(void* impl, const BunString* filename);
extern "C" void* Blob__fromBytesWithType(JSC::JSGlobalObject*, const uint8_t* ptr, size_t len, const char* mime);
extern "C" void* Blob__fromBytesWithNormalizedType(JSC::JSGlobalObject*, const uint8_t* ptr, size_t len, const uint8_t* mime, size_t mimeLength);

namespace WebCore {

RefPtr<Blob> Blob::create(std::span<const uint8_t> bytes, const String& type, JSC::JSGlobalObject* globalThis)
{
    Bun::UTF8View mime(type);
    auto mimeBytes = mime.bytes();
    return createAdopted(Blob__fromBytesWithNormalizedType(globalThis, bytes.data(), bytes.size(), mimeBytes.data(), mimeBytes.size()));
}

RefPtr<Blob> Blob::createWithExactType(std::span<const uint8_t> bytes, ASCIILiteral type, JSC::JSGlobalObject* globalThis)
{
    return createAdopted(Blob__fromBytesWithType(globalThis, bytes.data(), bytes.size(), type.characters()));
}

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, WebCore::Blob& impl)
{
    BunString filename = Bun::toString(impl.fileName());
    Blob__setAsFile(impl.impl(), &filename);

    return JSC::JSValue::decode(Blob__create(lexicalGlobalObject, Blob__dupe(impl.impl())));
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
