#include "root.h"

#include "JavaScriptCore/TypedArrayType.h"
#include "JavaScriptCore/JSArrayBufferViewInlines.h"
#include "JavaScriptCore/JSArrayBufferView.h"
#include "JavaScriptCore/JSTypedArrayViewPrototype.h"
#include "mimalloc.h"

namespace Bun {

extern "C" JSC::EncodedJSValue JSUint8Array__fromDefaultAllocator(JSC::JSGlobalObject* lexicalGlobalObject, uint8_t* ptr, size_t length)
{

    JSC::JSUint8Array* uint8Array = nullptr;

    if (LIKELY(length > 0)) {
        auto buffer = ArrayBuffer::createFromBytes({ ptr, length }, createSharedTask<void(void*)>([](void* p) {
            mi_free(p);
        }));

        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->m_typedArrayUint8.get(lexicalGlobalObject), WTFMove(buffer), 0, length);
    } else {
        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->m_typedArrayUint8.get(lexicalGlobalObject), 0);
    }

    return JSC::JSValue::encode(uint8Array);
}
}