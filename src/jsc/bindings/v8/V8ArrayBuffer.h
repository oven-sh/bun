#pragma once

#include "v8.h"
#include "V8Object.h"

namespace v8 {

enum class BackingStoreInitializationMode { kZeroInitialized,
    kUninitialized };

class ArrayBuffer : public Object {
public:
    BUN_EXPORT static Local<ArrayBuffer> New(Isolate* isolate, size_t byte_length,
        BackingStoreInitializationMode initialization_mode = BackingStoreInitializationMode::kZeroInitialized);
    BUN_EXPORT size_t ByteLength() const;
    BUN_EXPORT void* Data() const;
};

} // namespace v8
