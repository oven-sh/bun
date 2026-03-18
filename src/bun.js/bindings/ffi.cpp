#include "root.h"
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSArrayBufferViewInlines.h>
#include <JavaScriptCore/JSCInlines.h>

// Ensure the typed array's backing store is externalized (not inline in the GC heap).
// This prevents FFI buffer overflows from corrupting JSC's GC metadata.
// For FastTypedArray (inline GC storage), this calls slowDownAndWasteMemory()
// which copies data to an external allocation. For already-external arrays, this is a no-op.
extern "C" void* Bun__FFI__ensureExternalBackingStore(JSC::EncodedJSValue val)
{
    JSC::JSValue jsVal = JSC::JSValue::decode(val);
    auto* view = JSC::jsDynamicCast<JSC::JSArrayBufferView*>(jsVal);
    if (!view)
        return nullptr;
    view->possiblySharedBuffer();
    return view->vector();
}

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
