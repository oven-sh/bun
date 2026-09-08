#include "root.h"

typedef struct FFIFields {
    uint32_t JSArrayBufferView__offsetOfLength;
    uint32_t JSArrayBufferView__offsetOfByteOffset;
    uint32_t JSArrayBufferView__offsetOfVector;
    uint32_t JSCell__offsetOfType;
    // Register (8-byte slot) indices into a CallFrame, not byte offsets.
    uint32_t CallFrame__argumentCountIncludingThisSlot;
    uint32_t CallFrame__firstArgumentSlot;
} FFIFields;
extern "C" FFIFields Bun__FFI__offsets = { 0 };

static_assert(sizeof(JSC::Register) == sizeof(void*), "the cc() wrapper indexes the CallFrame as an array of pointer-sized slots");

extern "C" void Bun__FFI__ensureOffsetsAreLoaded()
{
    Bun__FFI__offsets.JSArrayBufferView__offsetOfLength = JSC::JSArrayBufferView::offsetOfLength();
    Bun__FFI__offsets.JSArrayBufferView__offsetOfByteOffset = JSC::JSArrayBufferView::offsetOfByteOffset();
    Bun__FFI__offsets.JSArrayBufferView__offsetOfVector = JSC::JSArrayBufferView::offsetOfVector();
    Bun__FFI__offsets.JSCell__offsetOfType = JSC::JSCell::typeInfoTypeOffset();
    Bun__FFI__offsets.CallFrame__argumentCountIncludingThisSlot = static_cast<uint32_t>(JSC::CallFrameSlot::argumentCountIncludingThis);
    Bun__FFI__offsets.CallFrame__firstArgumentSlot = static_cast<uint32_t>(JSC::CallFrame::argumentOffset(0));
}
