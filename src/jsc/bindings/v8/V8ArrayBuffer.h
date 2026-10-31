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

namespace shim {

// Storage for an object that an addon frees with its own `::operator delete`, as V8's headers do for a v8::BackingStore.
// On Linux that ends in libc's free(), so there it is libc's malloc() and not Bun's operator new (mimalloc's, or a sanitizer's).
void* allocateForAddonDelete(size_t size) RETURNS_NONNULL;
// Frees that storage as the addon would, for a store that Bun destroys itself.
void freeWithAddonAllocator(void* storage);

// The object actually allocated and returned as a v8::BackingStore* / std::shared_ptr<BackingStore>.
// v8::BackingStore methods reinterpret_cast `this` to this layout.
struct BackingStoreImpl {
    void* operator new(size_t size) { return allocateForAddonDelete(size); }
    void operator delete(void* storage) { freeWithAddonAllocator(storage); }

    // ArrayBuffer::GetBackingStore(): the buffer this store stands for.
    RefPtr<JSC::ArrayBuffer> buffer;
    // A store that stands for no buffer: memory an addon owns.
    void* data { nullptr };
    size_t byteLength { 0 };
};

} // namespace shim

class BackingStore {
public:
    // Releases what the store holds, not its storage: whoever destroys the store frees that, an addon's `delete` or Bun.
    BUN_EXPORT ~BackingStore();

    BUN_EXPORT void* Data() const;

private:
    BackingStore();
};

class ArrayBuffer : public Object {
public:
    BUN_EXPORT static Local<ArrayBuffer> New(
        Isolate* isolate, size_t byte_length,
        BackingStoreInitializationMode initialization_mode = BackingStoreInitializationMode::kZeroInitialized);
    BUN_EXPORT static Local<ArrayBuffer> New(Isolate* isolate, std::shared_ptr<BackingStore> backing_store);

    BUN_EXPORT std::shared_ptr<BackingStore> GetBackingStore();

private:
    ArrayBuffer();
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
