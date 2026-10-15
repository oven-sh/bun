#include "V8EscapableHandleScopeBase.h"
#include "shim/GlobalInternals.h"
#include "v8_compatibility_assertions.h"
#include "v8_handle_scope_data.h"

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::EscapableHandleScopeBase)

namespace v8 {

EscapableHandleScopeBase::EscapableHandleScopeBase(Isolate* isolate)
{
    // This constructor must be ABI-neutral between header generations (see the comment in
    // V8EscapableHandleScopeBase.h): with Node 26 headers the object is destroyed by V8's inline
    // ~HandleScope, with older headers by Bun's exported ~HandleScope, and neither path can pop a
    // Bun handle scope. So do not push one. Instead initialize the three V8-visible base words
    // exactly like V8 14's inline HandleScope::Initialize (v8-local-handle.h):
    //   isolate_    <- isolate
    //   prev_next_  <- HandleScopeData::next
    //   prev_limit_ <- HandleScopeData::limit
    //   HandleScopeData::level++
    // The inline destructor then restores HandleScopeData from those words (our exported
    // ~HandleScope does the same for old-ABI frames, see V8HandleScope.cpp). Outside of a running
    // inline CreateHandle, next == limit always holds (Extend hands out one slot at a time and
    // CreateHandle advances next past it), so the snapshot we restore preserves that invariant.
    auto* data = shim::getHandleScopeData(isolate);
    m_isolate = isolate;
    m_previousHandleScope = reinterpret_cast<HandleScope*>(data->next);
    m_buffer = reinterpret_cast<shim::HandleScopeBuffer*>(data->limit);
    data->level++;

    // Handles created while this scope is alive land in the surrounding Bun scope's buffer (we
    // did not push), so they outlive this scope; that is safe, just slightly longer-lived than
    // real V8. An Escape()d value must survive this scope, which that same buffer provides --
    // capture it now so Escape still targets it even if (with old-ABI addons) a deeper scope is
    // current by then.
    //
    // Reserve the escape slot NOW, like real V8: its storage index must be below every handle
    // created inside this scope, or HandleScope::DeleteExtensions (run by V8 14's inline
    // ~HandleScope) would sweep the just-escaped handle together with the scope's grants. The
    // reservation is kept in a side registry keyed by `this` because the V8 ABI leaves exactly
    // one Bun-usable word in this object (m_escapeBuffer).
    auto* current = isolate->globalInternals()->currentHandleScope();
    RELEASE_ASSERT(current, "EscapableHandleScope created without an active handle scope");
    m_escapeBuffer = current->m_buffer;
    shim::Handle* reserved = current->m_buffer->reserveEscapeHandle();
    isolate->globalInternals()->escapeReservations().set(this, shim::GlobalInternals::EscapeReservation { reserved, current->m_buffer });
}

// Fill the escape slot reserved at construction with escape_value and return its location.
uintptr_t* EscapableHandleScopeBase::EscapeSlot(uintptr_t* escape_value)
{
    RELEASE_ASSERT(m_escapeBuffer != nullptr, "EscapableHandleScope::Escape called multiple times");
    auto reservation = m_isolate->globalInternals()->escapeReservations().take(this);
    RELEASE_ASSERT(reservation.handle && reservation.buffer == m_escapeBuffer,
        "EscapableHandleScope escape reservation missing");
    TaggedPointer* newHandle = m_escapeBuffer->createHandleFromExistingObject(
        TaggedPointer::fromRaw(*escape_value),
        m_isolate,
        reservation.handle);
    m_escapeBuffer = nullptr;
    return newHandle->asRawPtrLocation();
}

} // namespace v8
