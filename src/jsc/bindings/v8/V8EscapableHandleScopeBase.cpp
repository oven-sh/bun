#include "V8EscapableHandleScopeBase.h"
#include "v8_compatibility_assertions.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::EscapableHandleScopeBase)

namespace v8 {

EscapableHandleScopeBase::EscapableHandleScopeBase(Isolate* isolate)
    : HandleScope(isolate)
{
    // at this point isolate->currentHandleScope() would just be this, so instead we have to get the
    // previous one
    auto& handle = m_previousHandleScope->m_buffer->createEmptyHandle();
    m_escapeSlot = &handle;
}

// Store the handle escape_value in the escape slot that we have allocated from the parent
// HandleScope, and return the escape slot
uintptr_t* EscapableHandleScopeBase::EscapeSlot(uintptr_t* escape_value)
{
    RELEASE_ASSERT(m_escapeSlot != nullptr, "EscapableHandleScope::Escape called multiple times");
    TaggedPointer* newHandle = m_previousHandleScope->m_buffer->createHandleFromExistingObject(
        TaggedPointer::fromRaw(*escape_value),
        m_isolate,
        m_escapeSlot);
    m_escapeSlot = nullptr;
    return newHandle->asRawPtrLocation();
}

} // namespace v8
