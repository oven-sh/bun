#include "root.h"

#include "JavaScriptCore/JSArrayBuffer.h"
#include "JavaScriptCore/TypedArrayType.h"
#include "JSBuffer.h"
#include "MimallocWTFMalloc.h"
#include "ZigGlobalObject.h"

namespace Bun {

static void freeDefaultAllocatorBytes(void* bytes, void*)
{
    Bun::defaultAllocatorFree(bytes);
}

// Does not take `ptr` if `length` is zero.
static JSC::EncodedJSValue adoptAsUint8Array(JSC::JSGlobalObject* lexicalGlobalObject, JSC::Structure* structure, uint8_t* ptr, size_t length)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (!length) [[unlikely]]
        RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::JSUint8Array::create(lexicalGlobalObject, structure, 0)));

    if (Bun::rejectBytesNoCopyAboveArrayBufferLimit(lexicalGlobalObject, scope, ptr, length, freeDefaultAllocatorBytes, nullptr)) [[unlikely]]
        return {};

    return JSC::JSValue::encode(JSC::JSUint8Array::createAdopted(vm, structure, { ptr, length }));
}

extern "C" JSC::EncodedJSValue JSUint8Array__fromDefaultAllocator(JSC::JSGlobalObject* lexicalGlobalObject, uint8_t* ptr, size_t length)
{
    return adoptAsUint8Array(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructureWithTypedArrayType<JSC::TypeUint8>(), ptr, length);
}

extern "C" JSC::EncodedJSValue JSBuffer__fromDefaultAllocator(JSC::JSGlobalObject* lexicalGlobalObject, uint8_t* ptr, size_t length)
{
    return adoptAsUint8Array(lexicalGlobalObject, defaultGlobalObject(lexicalGlobalObject)->JSBufferSubclassStructure(), ptr, length);
}

extern "C" JSC::EncodedJSValue JSArrayBuffer__fromDefaultAllocator(JSC::JSGlobalObject* lexicalGlobalObject, uint8_t* ptr, size_t length)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    RefPtr<ArrayBuffer> buffer;

    if (length > 0) [[likely]] {
        if (Bun::rejectBytesNoCopyAboveArrayBufferLimit(lexicalGlobalObject, scope, ptr, length, freeDefaultAllocatorBytes, nullptr)) [[unlikely]]
            return {};

        buffer = ArrayBuffer::createAdopted({ ptr, length });
    } else {
        buffer = ArrayBuffer::create(0, 1);
    }

    auto arrayBuffer = JSC::JSArrayBuffer::create(vm, lexicalGlobalObject->arrayBufferStructure(), WTF::move(buffer));
    return JSC::JSValue::encode(arrayBuffer);
}

}
