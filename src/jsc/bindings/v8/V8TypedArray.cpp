#include "V8TypedArray.h"
#include "V8HandleScope.h"
#include "V8Isolate.h"
#include "v8_compatibility_assertions.h"

#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSTypedArrays.h>
#include <JavaScriptCore/JSGenericTypedArrayViewInlines.h>

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::TypedArray)
ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Uint8Array)
ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::Uint32Array)

namespace v8 {

template<typename ResultType, typename JSCType, JSC::TypedArrayType typedArrayType>
static Local<ResultType> newTypedArray(Local<ArrayBuffer> array_buffer, size_t byte_offset, size_t length)
{
    auto* jsBuffer = array_buffer->localToObjectPointer<JSC::JSArrayBuffer>();
    RELEASE_ASSERT(jsBuffer, "v8::TypedArray::New: not an ArrayBuffer");
    auto* globalObject = Isolate::GetCurrent()->globalObject();
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    RefPtr<JSC::ArrayBuffer> backing = jsBuffer->impl();
    JSC::Structure* structure = globalObject->typedArrayStructure(typedArrayType, backing->isResizableOrGrowableShared());
    auto* view = JSCType::create(globalObject, structure, WTF::move(backing), byte_offset, length);
    RETURN_IF_EXCEPTION(scope, Local<ResultType>());

    auto* handleScope = globalObject->V8GlobalInternals()->currentHandleScope();
    return handleScope->createLocal<ResultType>(vm, view);
}

Local<Uint8Array> Uint8Array::New(Local<ArrayBuffer> array_buffer, size_t byte_offset, size_t length)
{
    return newTypedArray<Uint8Array, JSC::JSUint8Array, JSC::TypedArrayType::TypeUint8>(array_buffer, byte_offset, length);
}

Local<Uint32Array> Uint32Array::New(Local<ArrayBuffer> array_buffer, size_t byte_offset, size_t length)
{
    return newTypedArray<Uint32Array, JSC::JSUint32Array, JSC::TypedArrayType::TypeUint32>(array_buffer, byte_offset, length);
}

} // namespace v8
