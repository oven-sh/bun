#include "root.h"

typedef struct FFIFields {
    uint32_t JSArrayBufferView__offsetOfLength;
    uint32_t JSArrayBufferView__offsetOfByteOffset;
    uint32_t JSArrayBufferView__offsetOfVector;
    uint32_t JSCell__offsetOfType;
    // An index into the CallFrame's 8-byte slots, not a byte offset.
    uint32_t CallFrame__argumentCountIncludingThisSlot;
} FFIFields;

extern "C" FFIFields Bun__FFI__offsets()
{
    FFIFields offsets;
    offsets.JSArrayBufferView__offsetOfLength = JSC::JSArrayBufferView::offsetOfLength();
    offsets.JSArrayBufferView__offsetOfByteOffset = JSC::JSArrayBufferView::offsetOfByteOffset();
    offsets.JSArrayBufferView__offsetOfVector = JSC::JSArrayBufferView::offsetOfVector();
    offsets.JSCell__offsetOfType = JSC::JSCell::typeInfoTypeOffset();
    offsets.CallFrame__argumentCountIncludingThisSlot = static_cast<uint32_t>(JSC::CallFrameSlot::argumentCountIncludingThis);
    return offsets;
}
