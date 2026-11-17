#include "root.h"

#include "JavaScriptCore/JSArrayBuffer.h"
#include "JavaScriptCore/TypedArrayType.h"
#include "JSBuffer.h"
#include "MimallocWTFMalloc.h"

namespace Bun {

static void freeDefaultAllocatorBytes(void* bytes, void*)
{
    Bun::defaultAllocatorFree(bytes);
}

template<typename JSByteArray>
static JSC::EncodedJSValue byteArrayFromDefaultAllocator(JSC::JSGlobalObject* lexicalGlobalObject, uint8_t* ptr, size_t length)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* structure = lexicalGlobalObject->typedArrayStructureWithTypedArrayType<JSByteArray::Adaptor::typeValue>();
    JSByteArray* array;

    if (length > 0) [[likely]] {
        if (Bun::rejectBytesNoCopyAboveArrayBufferLimit(lexicalGlobalObject, scope, ptr, length, freeDefaultAllocatorBytes, nullptr)) [[unlikely]]
            return {};

        auto buffer = ArrayBuffer::createFromBytes({ ptr, length }, createSharedTask<void(void*)>([](void* p) {
            freeDefaultAllocatorBytes(p, nullptr);
        }));

        array = JSByteArray::create(lexicalGlobalObject, structure, WTF::move(buffer), 0, length);
    } else {
        array = JSByteArray::create(lexicalGlobalObject, structure, 0);
    }
    RETURN_IF_EXCEPTION(scope, {});

    return JSC::JSValue::encode(array);
}

extern "C" JSC::EncodedJSValue JSUint8Array__fromDefaultAllocator(JSC::JSGlobalObject* lexicalGlobalObject, uint8_t* ptr, size_t length)
{
    return byteArrayFromDefaultAllocator<JSC::JSUint8Array>(lexicalGlobalObject, ptr, length);
}

extern "C" JSC::EncodedJSValue JSUint8ClampedArray__fromDefaultAllocator(JSC::JSGlobalObject* lexicalGlobalObject, uint8_t* ptr, size_t length)
{
    return byteArrayFromDefaultAllocator<JSC::JSUint8ClampedArray>(lexicalGlobalObject, ptr, length);
}

extern "C" JSC::EncodedJSValue JSArrayBuffer__fromDefaultAllocator(JSC::JSGlobalObject* lexicalGlobalObject, uint8_t* ptr, size_t length)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RefPtr<ArrayBuffer> buffer;

    if (length > 0) [[likely]] {
        if (Bun::rejectBytesNoCopyAboveArrayBufferLimit(lexicalGlobalObject, scope, ptr, length, freeDefaultAllocatorBytes, nullptr)) [[unlikely]]
            return {};

        buffer = ArrayBuffer::createFromBytes({ ptr, length }, createSharedTask<void(void*)>([](void* p) {
            freeDefaultAllocatorBytes(p, nullptr);
        }));
    } else {
        buffer = ArrayBuffer::create(0, 1);
    }

    auto arrayBuffer = JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), WTF::move(buffer));
    return JSC::JSValue::encode(arrayBuffer);
}

}
