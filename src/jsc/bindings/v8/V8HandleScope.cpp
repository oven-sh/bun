#include "V8HandleScope.h"
#include "shim/GlobalInternals.h"
#include "napi_handle_scope.h"
#include "v8_compatibility_assertions.h"
#include "v8_handle_scope_data.h"

// The size must match, because if our HandleScope is too big it'll clobber other stack variables.
// The field offsets matter too since Node 26 (V8 14): the headers fully inline
// HandleScope's constructor, destructor and CreateHandle, so addon code reads and writes the
// three words of a HandleScope frame directly as { Isolate* isolate_; Address* prev_next_;
// Address* prev_limit_; }. Frames constructed by our exported HandleScope(Isolate*) constructor
// are never destroyed by that inline code (old-ABI addons call our exported destructor), so those
// keep Bun meanings for words 1 and 2 (m_scope/m_openedScopeMarker). Frames constructed by the
// exported EscapableHandleScopeBase constructor *are* unwound by the inline destructor, so that
// constructor initializes them with V8's meanings instead -- see V8EscapableHandleScopeBase.cpp
// and the comments in ~HandleScope below.
ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::HandleScope)

namespace v8 {

HandleScope::HandleScope(Isolate* isolate)
    : m_isolate(isolate)
    , m_scope(Bun::HandleScopeImpl::open(isolate->globalObject(), false))
    , m_openedScopeMarker(this)
{
}

HandleScope::~HandleScope()
{
    if (m_openedScopeMarker == this) {
        Bun::HandleScopeImpl::close(m_isolate->globalObject(), m_scope);
        return;
    }
    // A V8-style frame (EscapableHandleScopeBase; old-ABI addons reach this destructor through
    // their inline-defaulted ~EscapableHandleScope): words 1 and 2 are the HandleScopeData
    // next/limit snapshot. Unwind exactly like V8 14's inline ~HandleScope would.
    auto* data = shim::getHandleScopeData(m_isolate);
    data->next = reinterpret_cast<uintptr_t*>(m_scope);
    data->limit = reinterpret_cast<uintptr_t*>(m_openedScopeMarker);
    data->level--;
    // Mirror V8 14's inline ~HandleScope: reclaim the slots Extend granted inside this frame (a
    // no-op when the frame created no handles, since the newest remaining grant then already
    // matches the restored limit).
    if (auto* current = m_isolate->globalObject()->m_currentHandleScopeImpl.get()) {
        if (auto* handles = current->v8Handles()) {
            handles->deleteGrantsBack(data->limit);
        }
    }
    // Drop this escapable scope's reservation if Escape() was never called.
    m_isolate->globalInternals()->escapeReservations().remove(this);
}

uintptr_t* HandleScope::CreateHandle(internal::Isolate* i_isolate, uintptr_t value)
{
    auto* isolate = reinterpret_cast<Isolate*>(i_isolate);
    TaggedPointer* newSlot = isolate->currentHandleScope()->createHandleFromExistingObject(TaggedPointer::fromRaw(value));
    // basically a reinterpret
    return newSlot->asRawPtrLocation();
}

uintptr_t* HandleScope::CreateHandle(Isolate* isolate, uintptr_t value)
{
    // Same object underneath; v8::Isolate* and internal::Isolate* are nominal
    // views of our Isolate.
    return CreateHandle(reinterpret_cast<internal::Isolate*>(isolate), value);
}

void HandleScope::Initialize(Isolate* isolate)
{
    // Mirror V8 14's inline HandleScope::Initialize (v8-local-handle.h):
    // stash the HandleScopeData snapshot in the V8-visible words and bump
    // level. The frame is addon-owned and V8-laid-out, so do not open a Bun
    // scope, and give the words V8's meanings.
    auto* data = shim::getHandleScopeData(isolate);
    m_isolate = isolate;
    m_scope = reinterpret_cast<Bun::HandleScopeImpl*>(data->next);
    m_openedScopeMarker = reinterpret_cast<HandleScope*>(data->limit);
    data->level++;
}

uintptr_t* HandleScope::Extend(Isolate* isolate)
{
    // V8 14's inline HandleScope::CreateHandle (v8-local-handle.h) calls Extend when
    // data->next == data->limit, then stores the value into the returned slot itself and sets
    // data->next to one past the slot. The Isolate's HandleScopeData starts zeroed
    // (next == limit == nullptr), and we always hand out exactly one slot with
    // limit == slot + 1 == the next value the caller will store, so next == limit is reestablished
    // after every inline allocation and every inline handle creation takes this path. The slots
    // come from the innermost open scope, so the values stay alive (and GC-visited, see
    // Handle::isCell) until that scope closes.
    TaggedPointer* slot = isolate->currentHandleScope()->createRawHandleSlot();
    uintptr_t* address = slot->asRawPtrLocation();
    auto* data = shim::getHandleScopeData(isolate);
    data->next = address;
    data->limit = address + 1;
    return address;
}

void HandleScope::DeleteExtensions(Isolate* isolate)
{
    // Called by V8 14's inline ~HandleScope after it restored HandleScopeData::next/limit, when
    // the scope changed the limit (which Extend always does). Free the slots Extend granted inside
    // the closing scope; without this, per-iteration v8::HandleScopes in a long native call would
    // never reclaim memory (everything would live until the enclosing scope closes).
    // `this` is the addon's V8-layout HandleScope, so our members must not be touched.
    auto* current = isolate->globalObject()->m_currentHandleScopeImpl.get();
    if (!current) {
        return;
    }
    if (auto* handles = current->v8Handles()) {
        handles->deleteGrantsBack(shim::getHandleScopeData(isolate)->limit);
    }
}

} // namespace v8
