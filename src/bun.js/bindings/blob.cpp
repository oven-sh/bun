#include "blob.h"

extern "C" JSC::EncodedJSValue Blob__create(JSC::JSGlobalObject* globalObject, void* impl);

namespace WebCore {

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, WebCore::Blob& impl)
{
    return JSC::JSValue::decode(Blob__create(lexicalGlobalObject, Blob__dupe(impl.impl())));
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Ref<WebCore::Blob>&& impl)
{
    return JSC::JSValue::decode(Blob__create(lexicalGlobalObject, impl->impl()));
}

}