#include "root.h"

#include "JavaScriptCore/JSArrayBuffer.h"
#include "JavaScriptCore/TypedArrayType.h"
#include "mimalloc.h"

namespace Bun {

extern "C" JSC::EncodedJSValue JSUint8Array__fromDefaultAllocator(JSC::JSGlobalObject* lexicalGlobalObject, uint8_t* ptr, size_t length)
{
    JSC::JSUint8Array* uint8Array;

    if (LIKELY(length > 0)) {
        auto buffer = ArrayBuffer::createFromBytes({ ptr, length }, createSharedTask<void(void*)>([](void* p) {
            mi_free(p);
        }));

        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructure(JSC::TypeUint8, false), WTFMove(buffer), 0, length);
    } else {
        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructure(JSC::TypeUint8, false), 0);
    }

    return JSC::JSValue::encode(uint8Array);
}

extern "C" JSC::EncodedJSValue JSArrayBuffer__fromDefaultAllocator(JSC::JSGlobalObject* lexicalGlobalObject, uint8_t* ptr, size_t length)
{

    JSC::JSArrayBuffer* arrayBuffer;

    if (LIKELY(length > 0)) {
        RefPtr<ArrayBuffer> buffer = ArrayBuffer::createFromBytes({ ptr, length }, createSharedTask<void(void*)>([](void* p) {
            mi_free(p);
        }));

        arrayBuffer = JSC::JSArrayBuffer::create(lexicalGlobalObject->vm(), lexicalGlobalObject->arrayBufferStructure(), WTFMove(buffer));
    } else {
        arrayBuffer = JSC::JSArrayBuffer::create(lexicalGlobalObject->vm(), lexicalGlobalObject->arrayBufferStructure(), nullptr);
    }

    return JSC::JSValue::encode(arrayBuffer);
}

}