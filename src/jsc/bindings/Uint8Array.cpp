#include "root.h"

#include "JavaScriptCore/JSArrayBuffer.h"
#include "JavaScriptCore/TypedArrayType.h"
#include "mimalloc.h"

namespace Bun {

extern "C" JSC::EncodedJSValue JSUint8Array__fromDefaultAllocator(JSC::JSGlobalObject* lexicalGlobalObject, uint8_t* ptr, size_t length)
{
    JSC::JSUint8Array* uint8Array;

    if (length > 0) [[likely]] {
        auto buffer = ArrayBuffer::createFromBytes({ ptr, length }, createSharedTask<void(void*)>([](void* p) {
            mi_free(p);
        }));

        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructureWithTypedArrayType<JSC::TypeUint8>(), WTF::move(buffer), 0, length);
    } else {
        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructureWithTypedArrayType<JSC::TypeUint8>(), 0);
    }

    return JSC::JSValue::encode(uint8Array);
}

extern "C" JSC::EncodedJSValue JSArrayBuffer__fromDefaultAllocator(JSC::JSGlobalObject* lexicalGlobalObject, uint8_t* ptr, size_t length)
{

    RefPtr<ArrayBuffer> buffer;

    if (length > 0) [[likely]] {
        buffer = ArrayBuffer::createFromBytes({ ptr, length }, createSharedTask<void(void*)>([](void* p) {
            mi_free(p);
        }));
    } else {
        buffer = ArrayBuffer::create(0, 1);
    }

    auto arrayBuffer = JSC::JSArrayBuffer::create(lexicalGlobalObject->vm(), lexicalGlobalObject->arrayBufferStructure(), WTF::move(buffer));
    return JSC::JSValue::encode(arrayBuffer);
}

}
