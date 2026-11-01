#pragma once

#include "v8.h"
#include "V8Object.h"
#include "V8Local.h"
#include "V8Isolate.h"

#include <memory>

namespace JSC {
class ArrayBuffer;
}

namespace v8 {

enum class BackingStoreInitializationMode { kZeroInitialized,
    kUninitialized };

class BackingStore {
public:
    using DeleterCallback = void (*)(void* data, size_t length, void* deleter_data);

    // Releases what the store holds, not its storage: whoever destroys the store frees that, an addon's `delete` or Bun.
    BUN_EXPORT ~BackingStore();

#if OS(WINDOWS)
    // V8's header defines this inline. An addon built with MSVC /Ob0 (`node-gyp --debug`) imports it instead.
    BUN_EXPORT void operator delete(void* storage);
#endif

    BUN_EXPORT void* Data() const;

private:
    BackingStore();
};

namespace shim {

// Storage that an addon frees with its own `::operator delete`, so it comes from the allocator that pairs with that, not from Bun's.
void* allocateForAddonDelete(size_t size) RETURNS_NONNULL;
void freeWithAddonAllocator(void* storage);

// The object actually allocated and returned as a v8::BackingStore* / std::shared_ptr<BackingStore>.
// v8::BackingStore methods reinterpret_cast `this` to this layout.
struct BackingStoreImpl {
    void* operator new(size_t size) { return allocateForAddonDelete(size); }
    void operator delete(void* storage) { freeWithAddonAllocator(storage); }

    ~BackingStoreImpl();

    // Set by ArrayBuffer::GetBackingStore(): the buffer that has the memory.
    RefPtr<JSC::ArrayBuffer> buffer;
    // Set by ArrayBuffer::NewBackingStore(): memory the addon owns.
    void* data { nullptr };
    size_t byteLength { 0 };
    BackingStore::DeleterCallback deleter { nullptr };
    void* deleterData { nullptr };
};

} // namespace shim

class ArrayBuffer : public Object {
public:
    BUN_EXPORT static Local<ArrayBuffer> New(
        Isolate* isolate, size_t byte_length,
        BackingStoreInitializationMode initialization_mode = BackingStoreInitializationMode::kZeroInitialized);
    BUN_EXPORT static Local<ArrayBuffer> New(Isolate* isolate, std::shared_ptr<BackingStore> backing_store);

    BUN_EXPORT static std::unique_ptr<BackingStore> NewBackingStore(
        void* data, size_t byte_length, BackingStore::DeleterCallback deleter, void* deleter_data);

    BUN_EXPORT void Detach();

    BUN_EXPORT std::shared_ptr<BackingStore> GetBackingStore();

    BUN_EXPORT size_t ByteLength() const;
    BUN_EXPORT void* Data() const;

private:
    ArrayBuffer();
};

class SharedArrayBuffer : public Object {
public:
    BUN_EXPORT size_t ByteLength() const;
    BUN_EXPORT void* Data() const;

private:
    SharedArrayBuffer();
};

class ArrayBufferView : public Object {
public:
    BUN_EXPORT Local<ArrayBuffer> Buffer();
    BUN_EXPORT size_t ByteOffset();
    BUN_EXPORT size_t ByteLength();

private:
    ArrayBufferView();
};

} // namespace v8
