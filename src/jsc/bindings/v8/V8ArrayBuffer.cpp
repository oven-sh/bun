#include "V8ArrayBuffer.h"
#include "V8HandleScope.h"
#include "BunProcess.h"
#include "ScriptExecutionContext.h"
#include "v8_compatibility_assertions.h"

#include <JavaScriptCore/ArrayBuffer.h>
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSArrayBufferViewInlines.h>
#include <wtf/SharedTask.h>

#if OS(LINUX)
#include <dlfcn.h>
#include <features.h>
#elif OS(WINDOWS)
#include <windows.h>
#endif

extern "C" [[noreturn]] void Bun__outOfMemory();

#if OS(LINUX) && defined(__GNU_LIBRARY__)
// A plain malloc() call binds to Bun's own. This one binds like an addon's: glibc's oldest symbol version of the CPU, as in workaround-missing-symbols.cpp.
#if CPU(X86_64)
#define BUN_GLIBC_BASE "GLIBC_2.2.5"
#elif CPU(ARM64)
#define BUN_GLIBC_BASE "GLIBC_2.17"
#endif
__asm__(".symver bunAddonMalloc, malloc@" BUN_GLIBC_BASE);
extern "C" void* bunAddonMalloc(size_t);
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

BackingStoreImpl::~BackingStoreImpl()
{
    if (buffer && !buffer->isShared())
        buffer->unpin();
    if (data)
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
    HeapFree(GetProcessHeap(), 0, storage);
}
#endif

void* BackingStore::Data() const
{
    auto* impl = reinterpret_cast<const shim::BackingStoreImpl*>(this);
    if (!impl->buffer) return impl->data;
    return impl->buffer->data();
}

size_t BackingStore::ByteLength() const
{
    auto* impl = reinterpret_cast<const shim::BackingStoreImpl*>(this);
    if (!impl->buffer) return impl->byteLength;
    // Not synchronized: another thread can read the length of a resizable buffer while its JS thread resizes it. V8's store has an atomic length.
    return impl->buffer->byteLength();
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
    auto& vm = isolate->vm();
    auto* store = reinterpret_cast<shim::BackingStoreImpl*>(backing_store.get());

    if (store->buffer) [[unlikely]]
        BUN_PANIC("v8::ArrayBuffer::New: a BackingStore from GetBackingStore() is not supported");
    if (!store->data && store->byteLength) [[unlikely]]
        BUN_PANIC("v8::ArrayBuffer::New: the BackingStore has a length but no data");
    if (store->byteLength > MAX_ARRAY_BUFFER_SIZE) [[unlikely]] {
        auto message = WTF::makeString("v8::ArrayBuffer::New: the BackingStore has "_s, store->byteLength, " bytes, and the largest ArrayBuffer that Bun supports has "_s, MAX_ARRAY_BUFFER_SIZE).utf8();
        auto bytes = byteCast<char>(message.span());
        Bun__panic(bytes.data(), bytes.size());
    }
    // JSC reads a null data pointer as "detached", so a store without memory gets an address that is never dereferenced.
    static const uint8_t emptyStoreData = 0;
    std::span<const uint8_t> bytes { store->data ? static_cast<const uint8_t*>(store->data) : &emptyStoreData, store->byteLength };
    // The task only owns the store: JSC destroys it when the buffer gives the memory up (a detach or a collection).
    auto buffer = JSC::ArrayBuffer::createFromBytes(bytes, createSharedTask<void(void*)>([backing_store = WTF::move(backing_store)](void*) {}));
    auto* jsBuffer = JSC::JSArrayBuffer::create(vm, isolate->globalObject()->arrayBufferStructure(JSC::ArrayBufferSharingMode::Default), WTF::move(buffer));
    return isolate->currentHandleScope()->createLocal<ArrayBuffer>(vm, jsBuffer);
}

std::unique_ptr<BackingStore> ArrayBuffer::NewBackingStore(void* data, size_t byte_length,
    BackingStore::DeleterCallback deleter, void* deleter_data)
{
    // The addon that gets the store destroys it: ~BackingStore(), then its own `::operator delete` on this storage.
    auto* backing = new (shim::allocateForAddonDelete(sizeof(shim::BackingStoreImpl))) shim::BackingStoreImpl {
        .data = data,
        .byteLength = byte_length,
        .deleter = deleter,
        .deleterData = deleter_data,
    };
    return std::unique_ptr<BackingStore>(reinterpret_cast<BackingStore*>(backing));
}

// Once per realm, from the realm's event loop: Process::emitWarning() calls process.nextTick(), which is JavaScript, and V8's Detach() runs none.
static NEVER_INLINE void warnThatDetachLeftBufferAttached(JSC::VM& vm)
{
    Zig::GlobalObject* globalObject = defaultGlobalObject(vm);
    if (!globalObject->V8GlobalInternals()->shouldWarnThatDetachLeftBufferAttached())
        return;
    globalObject->scriptExecutionContext()->postTask([](WebCore::ScriptExecutionContext& context) {
        JSC::JSGlobalObject* globalObject = context.jsGlobalObject();
        auto& vm = JSC::getVM(globalObject);
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        Bun::Process::emitWarning(globalObject, JSC::jsString(vm, WTF::String("v8::ArrayBuffer::Detach() left an ArrayBuffer attached, because an asynchronous operation or a v8::BackingStore still uses its memory, or because it is the buffer of a WebAssembly.Memory. JavaScript can still read and write that memory. Copy the data before it goes to an asynchronous API."_s)), JSC::jsString(vm, WTF::String("Warning"_s)), JSC::jsUndefined(), JSC::jsUndefined());
        CLEAR_IF_EXCEPTION(scope);
    });
}

void ArrayBuffer::Detach()
{
    auto* jsBuffer = localToObjectPointer<JSC::JSArrayBuffer>();
    RELEASE_ASSERT(jsBuffer, "v8::ArrayBuffer::Detach: not an ArrayBuffer");
    JSC::ArrayBuffer* buffer = jsBuffer->impl();
    if (buffer->isDetached() || buffer->isShared())
        return;
    // V8 aborts for a buffer that is not detachable. Bun leaves it attached and warns: it is a WebAssembly.Memory's, or a Bun job or a held store has a pointer into it.
    if (!buffer->isDetachable()) {
        warnThatDetachLeftBufferAttached(jsBuffer->vm());
        return;
    }
    buffer->detach(jsBuffer->vm());
}

// The root context of this thread's VM, from the thread's first store on: a store's deleter compares it to know its JS thread with one load.
static thread_local WebCore::ScriptExecutionContextIdentifier contextOfThisThread;

// Deletes a store on the JS thread that took it, and leaves it allocated on any other thread.
struct DeleteOnItsJSThread {
    WebCore::ScriptExecutionContextIdentifier context;
    void operator()(shim::BackingStoreImpl* store) const
    {
        if (context == contextOfThisThread)
            delete store;
    }
};

// Another thread dropped the store. The buffer's pin and reference counts are not atomic, so the store goes to its JS thread, a shared buffer's store too: the posted task owns it, and that thread deletes it when the task ends or when the teardown of its VM drops the task unrun.
static NEVER_INLINE void destroyOnJSThread(shim::BackingStoreImpl* store, WebCore::ScriptExecutionContextIdentifier context)
{
    // A refused post (the VM is gone or terminating, or the context is not registered) destroys the task on this thread, which does not delete the store: the buffer's counts are not atomic, and its JS thread can still be in its teardown.
    WebCore::ScriptExecutionContext::postTaskTo(context, BunLoopKind::Regular, [owned = std::unique_ptr<shim::BackingStoreImpl, DeleteOnItsJSThread>(store, DeleteOnItsJSThread { context })](WebCore::ScriptExecutionContext&) {});
}

static ALWAYS_INLINE std::shared_ptr<BackingStore> backingStoreOf(JSC::JSArrayBuffer* jsBuffer)
{
    RefPtr<JSC::ArrayBuffer> impl = jsBuffer ? jsBuffer->impl() : nullptr;
    // The pin keeps JSC's memory with the store: Detach() leaves the buffer attached and a JS transfer copies it. A shared buffer needs no pin, and grow() detaches a WebAssembly.Memory buffer in spite of it.
    if (impl && !impl->isShared())
        impl->pin();
    if (contextOfThisThread == WebCore::ScriptExecutionContextIdentifier {} && jsBuffer) [[unlikely]]
        contextOfThisThread = defaultGlobalObject(jsBuffer->vm())->scriptExecutionContext()->identifier();

    auto* backing = new shim::BackingStoreImpl { WTF::move(impl) };
    return std::shared_ptr<BackingStore>(
        reinterpret_cast<BackingStore*>(backing),
        [context = contextOfThisThread](BackingStore* p) {
            auto* store = reinterpret_cast<shim::BackingStoreImpl*>(p);
            if (context == contextOfThisThread || !store->buffer) [[likely]]
                delete store;
            else
                destroyOnJSThread(store, context);
        });
}

std::shared_ptr<BackingStore> ArrayBuffer::GetBackingStore()
{
    return backingStoreOf(localToObjectPointer<JSC::JSArrayBuffer>());
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

// JSC has one cell type for ArrayBuffer and SharedArrayBuffer.
std::shared_ptr<BackingStore> SharedArrayBuffer::GetBackingStore()
{
    return backingStoreOf(localToObjectPointer<JSC::JSArrayBuffer>());
}

size_t SharedArrayBuffer::ByteLength() const
{
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
