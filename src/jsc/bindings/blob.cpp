#include "blob.h"
#include "ZigGeneratedClasses.h"

extern "C" JSC::EncodedJSValue SYSV_ABI Blob__create(JSC::JSGlobalObject* globalObject, void* impl);
extern "C" void Blob__setAsFile(void* impl, const BunString* filename);

namespace WebCore {

void Blob::setWrapper(JSC::VM& vm, const JSC::JSCell* owner, JSC::JSObject* wrapper)
{
    JSC::Weak<JSC::JSObject> weak { wrapper };
    WTF::storeStoreFence();
    m_wrapper = WTF::move(weak);
    if (owner)
        vm.writeBarrier(owner, wrapper);
}

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, WebCore::Blob& impl)
{
    if (auto* wrapper = impl.wrapper())
        return wrapper;

    BunString filename = Bun::toString(impl.fileName());
    Blob__setAsFile(impl.impl(), &filename);

    JSC::JSValue value = JSC::JSValue::decode(Blob__create(lexicalGlobalObject, Blob__dupe(impl.impl())));
    if (auto* object = value.getObject())
        impl.setWrapper(lexicalGlobalObject->vm(), nullptr, object);
    return value;
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
