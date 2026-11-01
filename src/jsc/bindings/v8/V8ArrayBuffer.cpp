#include "V8ArrayBuffer.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSArrayBufferViewInlines.h>

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::ArrayBuffer)
ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::ArrayBufferView)
ASSERT_V8_ENUM_MATCHES(BackingStoreInitializationMode, kZeroInitialized)
ASSERT_V8_ENUM_MATCHES(BackingStoreInitializationMode, kUninitialized)

namespace v8 {

void* BackingStore::Data() const
{
    auto* impl = reinterpret_cast<const shim::BackingStoreImpl*>(this);
    if (!impl->buffer) return nullptr;
    return impl->buffer->data();
}

Local<ArrayBuffer> ArrayBuffer::New(Isolate* isolate, size_t byte_length,
    BackingStoreInitializationMode initialization_mode)
{
    Zig::GlobalObject* globalObject = isolate->globalObject();
    auto& vm = isolate->vm();

    RefPtr<JSC::ArrayBuffer> backing;
    if (initialization_mode == BackingStoreInitializationMode::kUninitialized) {
        backing = JSC::ArrayBuffer::tryCreateUninitialized(byte_length, 1);
    } else {
        backing = JSC::ArrayBuffer::tryCreate(byte_length, 1);
    }
    RELEASE_ASSERT(backing, "v8::ArrayBuffer::New: allocation failed");

    auto* structure = globalObject->arrayBufferStructure(JSC::ArrayBufferSharingMode::Default);
    auto* jsBuffer = JSC::JSArrayBuffer::create(vm, structure, WTF::move(backing));
    return isolate->currentHandleScope()->createLocal<ArrayBuffer>(vm, jsBuffer);
}

std::shared_ptr<BackingStore> ArrayBuffer::GetBackingStore()
{
    auto* jsBuffer = localToObjectPointer<JSC::JSArrayBuffer>();
    RefPtr<JSC::ArrayBuffer> impl = jsBuffer ? jsBuffer->impl() : nullptr;

    auto* backing = new shim::BackingStoreImpl { WTF::move(impl) };
    return std::shared_ptr<BackingStore>(
        reinterpret_cast<BackingStore*>(backing),
        [](BackingStore* p) { delete reinterpret_cast<shim::BackingStoreImpl*>(p); });
}

Local<ArrayBuffer> ArrayBufferView::Buffer()
{
    auto* view = localToObjectPointer<JSC::JSArrayBufferView>();
    RELEASE_ASSERT(view, "v8::ArrayBufferView::Buffer: not an ArrayBufferView");
    auto* globalObject = Isolate::GetCurrent()->globalObject();
    auto& vm = globalObject->vm();

    JSC::JSArrayBuffer* jsBuffer = view->possiblySharedJSBuffer(globalObject);
    if (!jsBuffer) [[unlikely]]
        return Local<ArrayBuffer>();
    auto* handleScope = globalObject->V8GlobalInternals()->currentHandleScope();
    return handleScope->createLocal<ArrayBuffer>(vm, jsBuffer);
}

size_t ArrayBufferView::ByteOffset()
{
    auto* view = localToObjectPointer<JSC::JSArrayBufferView>();
    RELEASE_ASSERT(view, "v8::ArrayBufferView::ByteOffset: not an ArrayBufferView");
    return view->byteOffset();
}

size_t ArrayBufferView::ByteLength()
{
    auto* view = localToObjectPointer<JSC::JSArrayBufferView>();
    RELEASE_ASSERT(view, "v8::ArrayBufferView::ByteLength: not an ArrayBufferView");
    return view->byteLength();
}

} // namespace v8
