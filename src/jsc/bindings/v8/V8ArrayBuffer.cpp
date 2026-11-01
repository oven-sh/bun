#include "V8ArrayBuffer.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSArrayBufferViewInlines.h>
#include <JavaScriptCore/TypedArrayController.h>
#include <wtf/SharedTask.h>

#if OS(LINUX)
#include <dlfcn.h>
#include <features.h>
#elif OS(WINDOWS)
#include <windows.h>
#endif

extern "C" [[noreturn]] void Bun__outOfMemory();

#if OS(LINUX) && defined(__GNU_LIBRARY__)
// A plain malloc() call binds to Bun's own. These bind like an addon's: glibc's oldest symbol version of the CPU, as in workaround-missing-symbols.cpp.
#if CPU(X86_64)
#define BUN_GLIBC_BASE "GLIBC_2.2.5"
#elif CPU(ARM64)
#define BUN_GLIBC_BASE "GLIBC_2.17"
#endif
__asm__(".symver bunAddonMalloc, malloc@" BUN_GLIBC_BASE);
__asm__(".symver bunAddonFree, free@" BUN_GLIBC_BASE);
extern "C" void* bunAddonMalloc(size_t);
extern "C" void bunAddonFree(void*);
#endif

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::ArrayBuffer)
ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::SharedArrayBuffer)
ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::ArrayBufferView)
ASSERT_V8_ENUM_MATCHES(BackingStoreInitializationMode, kZeroInitialized)
ASSERT_V8_ENUM_MATCHES(BackingStoreInitializationMode, kUninitialized)
static_assert(std::is_same_v<v8::BackingStore::DeleterCallback, real_v8::BackingStore::DeleterCallback>, "BackingStore::DeleterCallback does not match between Bun and V8");

namespace v8 {

namespace shim {

static_assert(alignof(BackingStoreImpl) <= __STDCPP_DEFAULT_NEW_ALIGNMENT__, "an addon's ::operator delete(void*) takes no alignment");

void* allocateForAddonDelete(size_t size)
{
#if OS(LINUX)
#ifdef __GNU_LIBRARY__
    // Not dlsym(): it skips glibc's malloc checker (libc_malloc_debug.so), whose malloc() has a symbol version that is not the default one.
    void* storage = bunAddonMalloc(size);
#else
    // musl and bionic: dlsym() finds the malloc() that an addon's free() pairs with.
    using Malloc = void* (*)(size_t);
    static const Malloc addonMalloc = reinterpret_cast<Malloc>(dlsym(RTLD_DEFAULT, "malloc"));
    RELEASE_ASSERT(addonMalloc, "v8: dlsym() finds no malloc");
    void* storage = addonMalloc(size);
#endif
    if (!storage) [[unlikely]]
        Bun__outOfMemory();
    return storage;
#elif OS(WINDOWS)
    // An addon's operator delete ends in HeapFree() on the process heap. Bun's operator new does not pair with that in a debug build (/MTd).
    void* storage = HeapAlloc(GetProcessHeap(), 0, size);
    if (!storage) [[unlikely]]
        Bun__outOfMemory();
    return storage;
#else
    // macOS binds an addon to the operators that Bun exports (MimallocOverrideDarwin.cpp), and on FreeBSD both sides use the same heap.
    return ::operator new(size);
#endif
}

void freeWithAddonAllocator(void* storage)
{
#if OS(LINUX) && defined(__GNU_LIBRARY__)
    bunAddonFree(storage);
#elif OS(LINUX)
    using Free = void (*)(void*);
    static const Free addonFree = reinterpret_cast<Free>(dlsym(RTLD_DEFAULT, "free"));
    RELEASE_ASSERT(addonFree, "v8: dlsym() finds no free");
    addonFree(storage);
#elif OS(WINDOWS)
    HeapFree(GetProcessHeap(), 0, storage);
#else
    ::operator delete(storage);
#endif
}

BackingStoreImpl::~BackingStoreImpl()
{
    if (buffer)
        buffer->unpin();
    if (data && deleter)
        deleter(data, byteLength, deleterData);
}

} // namespace shim

BackingStore::~BackingStore()
{
    std::destroy_at(reinterpret_cast<shim::BackingStoreImpl*>(this));
}

#if OS(WINDOWS)
void BackingStore::operator delete(void* storage)
{
    shim::freeWithAddonAllocator(storage);
}
#endif

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
        // A store from GetBackingStore(): JSC has one JS object for its buffer, so unlike V8 this returns that one and not a second.
        jsBuffer = vm.m_typedArrayController->toJS(globalObject, globalObject, *store->buffer);
    } else {
        RELEASE_ASSERT(store->data || !store->byteLength, "v8::ArrayBuffer::New: backing store has a length but no data");
        RELEASE_ASSERT(store->byteLength <= MAX_ARRAY_BUFFER_SIZE, "v8::ArrayBuffer::New: backing store is larger than the maximum ArrayBuffer length");
        // JSC reads a null data pointer as "detached", so a store without memory gets an address that is never dereferenced.
        static const uint8_t emptyStoreData = 0;
        std::span<const uint8_t> bytes { store->data ? static_cast<const uint8_t*>(store->data) : &emptyStoreData, store->byteLength };
        // The task only owns the store: JSC destroys it when the buffer gives the memory up (a detach or a collection).
        auto buffer = JSC::ArrayBuffer::createFromBytes(bytes, createSharedTask<void(void*)>([backing_store = WTF::move(backing_store)](void*) {}));
        jsBuffer = JSC::JSArrayBuffer::create(vm, globalObject->arrayBufferStructure(JSC::ArrayBufferSharingMode::Default), WTF::move(buffer));
    }
    return isolate->currentHandleScope()->createLocal<ArrayBuffer>(vm, jsBuffer);
}

std::unique_ptr<BackingStore> ArrayBuffer::NewBackingStore(void* data, size_t byte_length,
    BackingStore::DeleterCallback deleter, void* deleter_data)
{
    // The addon that gets the store destroys it: ~BackingStore(), then its own `::operator delete` on storage from BackingStoreImpl's operator new.
    auto* backing = new shim::BackingStoreImpl {
        .data = data,
        .byteLength = byte_length,
        .deleter = deleter,
        .deleterData = deleter_data,
    };
    return std::unique_ptr<BackingStore>(reinterpret_cast<BackingStore*>(backing));
}

void ArrayBuffer::Detach()
{
    auto* jsBuffer = localToObjectPointer<JSC::JSArrayBuffer>();
    RELEASE_ASSERT(jsBuffer, "v8::ArrayBuffer::Detach: not an ArrayBuffer");
    JSC::ArrayBuffer* buffer = jsBuffer->impl();
    // V8 aborts for a buffer that is not detachable. JSC::ArrayBuffer::detach() does not check.
    if (buffer->isDetached() || !buffer->isDetachable() || buffer->isWasmMemory())
        return;
    buffer->detach(jsBuffer->vm());
}

std::shared_ptr<BackingStore> ArrayBuffer::GetBackingStore()
{
    auto* jsBuffer = localToObjectPointer<JSC::JSArrayBuffer>();
    RefPtr<JSC::ArrayBuffer> impl = jsBuffer ? jsBuffer->impl() : nullptr;
    // As in V8, the store keeps the memory: JSC does not detach a pinned buffer, and copies it for a transfer.
    if (impl)
        impl->pin();

    auto* backing = new shim::BackingStoreImpl { WTF::move(impl) };
    return std::shared_ptr<BackingStore>(
        reinterpret_cast<BackingStore*>(backing),
        [](BackingStore* p) { delete reinterpret_cast<shim::BackingStoreImpl*>(p); });
}

size_t ArrayBuffer::ByteLength() const
{
    auto* jsBuffer = localToObjectPointer<JSC::JSArrayBuffer>();
    RELEASE_ASSERT(jsBuffer, "v8::ArrayBuffer::ByteLength: not an ArrayBuffer");
    return jsBuffer->impl()->byteLength();
}

void* ArrayBuffer::Data() const
{
    auto* jsBuffer = localToObjectPointer<JSC::JSArrayBuffer>();
    RELEASE_ASSERT(jsBuffer, "v8::ArrayBuffer::Data: not an ArrayBuffer");
    return jsBuffer->impl()->data();
}

size_t SharedArrayBuffer::ByteLength() const
{
    // JSC has one cell type for ArrayBuffer and SharedArrayBuffer.
    auto* jsBuffer = localToObjectPointer<JSC::JSArrayBuffer>();
    RELEASE_ASSERT(jsBuffer, "v8::SharedArrayBuffer::ByteLength: not a SharedArrayBuffer");
    return jsBuffer->impl()->byteLength();
}

void* SharedArrayBuffer::Data() const
{
    auto* jsBuffer = localToObjectPointer<JSC::JSArrayBuffer>();
    RELEASE_ASSERT(jsBuffer, "v8::SharedArrayBuffer::Data: not a SharedArrayBuffer");
    return jsBuffer->impl()->data();
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
