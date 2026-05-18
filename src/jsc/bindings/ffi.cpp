#include "root.h"

typedef struct FFIFields {
    uint32_t JSArrayBufferView__offsetOfLength;
    uint32_t JSArrayBufferView__offsetOfByteOffset;
    uint32_t JSArrayBufferView__offsetOfVector;
    uint32_t JSCell__offsetOfType;
} FFIFields;
extern "C" FFIFields Bun__FFI__offsets = { 0 };

extern "C" void Bun__FFI__ensureOffsetsAreLoaded()
{
    Bun__FFI__offsets.JSArrayBufferView__offsetOfLength = JSC::JSArrayBufferView::offsetOfLength();
    Bun__FFI__offsets.JSArrayBufferView__offsetOfByteOffset = JSC::JSArrayBufferView::offsetOfByteOffset();
    Bun__FFI__offsets.JSArrayBufferView__offsetOfVector = JSC::JSArrayBufferView::offsetOfVector();
    Bun__FFI__offsets.JSCell__offsetOfType = JSC::JSCell::typeInfoTypeOffset();
}
