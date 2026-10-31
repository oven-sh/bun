#include "V8ArrayBuffer.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSArrayBufferViewInlines.h>
#include <JavaScriptCore/TypedArrayController.h>

#if OS(LINUX)
#include <dlfcn.h>

extern "C" [[noreturn]] void Bun__outOfMemory();
#endif

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::ArrayBuffer)
ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::ArrayBufferView)
ASSERT_V8_ENUM_MATCHES(BackingStoreInitializationMode, kZeroInitialized)
ASSERT_V8_ENUM_MATCHES(BackingStoreInitializationMode, kUninitialized)

namespace v8 {

namespace shim {

static_assert(alignof(BackingStoreImpl) <= __STDCPP_DEFAULT_NEW_ALIGNMENT__, "an addon's ::operator delete(void*) takes no alignment");

void* allocateForAddonDelete(size_t size)
{
#if OS(LINUX)
    // A direct call binds to this executable's own malloc: mimalloc's, or the sanitizer's. That one is not exported, so
    // dlsym() finds the one that an addon's free() pairs with: libc's, or a preloaded allocator's.
    using Malloc = void* (*)(size_t);
    static const Malloc addonMalloc = reinterpret_cast<Malloc>(dlsym(RTLD_DEFAULT, "malloc"));
    RELEASE_ASSERT(addonMalloc, "v8: dlsym() finds no malloc");
    void* storage = addonMalloc(size);
    if (!storage) [[unlikely]]
        Bun__outOfMemory();
    return storage;
#else
    // Elsewhere an addon's operator delete pairs with Bun's operator new: macOS binds the addon to the operators that this
    // executable exports (MimallocOverrideDarwin.cpp), and on Windows and FreeBSD both sides use the same heap.
    return ::operator new(size);
#endif
}

void freeWithAddonAllocator(void* storage)
{
#if OS(LINUX)
    using Free = void (*)(void*);
    static const Free addonFree = reinterpret_cast<Free>(dlsym(RTLD_DEFAULT, "free"));
    RELEASE_ASSERT(addonFree, "v8: dlsym() finds no free");
    addonFree(storage);
#else
    ::operator delete(storage);
#endif
}

} // namespace shim

BackingStore::~BackingStore()
{
    std::destroy_at(reinterpret_cast<shim::BackingStoreImpl*>(this));
}

void* BackingStore::Data() const
{
    auto* impl = reinterpret_cast<const shim::BackingStoreImpl*>(this);
    if (!impl->buffer) return impl->data;
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

Local<ArrayBuffer> ArrayBuffer::New(Isolate* isolate, std::shared_ptr<BackingStore> backing_store)
{
    Zig::GlobalObject* globalObject = isolate->globalObject();
    auto& vm = isolate->vm();
    auto* store = reinterpret_cast<shim::BackingStoreImpl*>(backing_store.get());

    JSC::JSArrayBuffer* jsBuffer;
    if (store->buffer) {
        // JSC has one JS object per JSC::ArrayBuffer: a store from GetBackingStore() gives that buffer's object, not a second one as in V8.
        jsBuffer = vm.m_typedArrayController->toJS(globalObject, globalObject, *store->buffer);
    } else {
        RELEASE_ASSERT(store->data || !store->byteLength, "v8::ArrayBuffer::New: backing store has a length but no data");
        RELEASE_ASSERT(store->byteLength <= MAX_ARRAY_BUFFER_SIZE, "v8::ArrayBuffer::New: backing store is larger than the maximum ArrayBuffer length");
        // JSC reads a null data pointer as "detached", so a store without memory gets an address that is never dereferenced.
        static const uint8_t emptyStoreData = 0;
        std::span<const uint8_t> bytes { store->data ? static_cast<const uint8_t*>(store->data) : &emptyStoreData, store->byteLength };
        // As in V8 the buffer owns a reference to the store. JSC drops it when the buffer is detached or collected, on whichever thread that happens.
        auto buffer = JSC::ArrayBuffer::createFromBytes(bytes,
            createSharedTask<void(void*)>([owner = WTF::move(backing_store)](void*) mutable { owner.reset(); }));
        jsBuffer = JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(JSC::ArrayBufferSharingMode::Default), WTF::move(buffer));
    }
    return isolate->currentHandleScope()->createLocal<ArrayBuffer>(vm, jsBuffer);
}

std::shared_ptr<BackingStore> ArrayBuffer::GetBackingStore()
{
    auto* jsBuffer = localToObjectPointer<JSC::JSArrayBuffer>();
    RefPtr<JSC::ArrayBuffer> impl = jsBuffer ? jsBuffer->impl() : nullptr;

    auto* backing = new shim::BackingStoreImpl { WTF::move(impl) };
    // An addon never deletes this store itself: the deleter of its shared_ptr is Bun's, and does both halves of a `delete`.
    return std::shared_ptr<BackingStore>(reinterpret_cast<BackingStore*>(backing), [](BackingStore* store) {
        store->~BackingStore();
        shim::freeWithAddonAllocator(store);
    });
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
