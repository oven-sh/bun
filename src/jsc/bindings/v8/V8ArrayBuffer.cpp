#include "V8ArrayBuffer.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::ArrayBuffer)
ASSERT_V8_ENUM_MATCHES(BackingStoreInitializationMode, kZeroInitialized)
ASSERT_V8_ENUM_MATCHES(BackingStoreInitializationMode, kUninitialized)

namespace v8 {

Local<ArrayBuffer> ArrayBuffer::New(Isolate*, size_t, BackingStoreInitializationMode)
{
    V8_UNIMPLEMENTED();
    return Local<ArrayBuffer>();
}

size_t ArrayBuffer::ByteLength() const
{
    V8_UNIMPLEMENTED();
    return 0;
}

void* ArrayBuffer::Data() const
{
    V8_UNIMPLEMENTED();
    return nullptr;
}

} // namespace v8
