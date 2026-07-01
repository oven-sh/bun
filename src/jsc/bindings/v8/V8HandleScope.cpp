#include "V8HandleScope.h"
#include "shim/GlobalInternals.h"
#include "v8_compatibility_assertions.h"
#include "v8_handle_scope_data.h"

// The size must match, because if our HandleScope is too big it'll clobber other stack variables.
// The field offsets matter too since Node 26 (V8 14): the headers fully inline
// HandleScope's constructor, destructor and CreateHandle, so addon code reads and writes the
// three words of a HandleScope frame directly as { Isolate* isolate_; Address* prev_next_;
// Address* prev_limit_; }. Frames constructed by our exported HandleScope(Isolate*) constructor
// are never destroyed by that inline code (old-ABI addons call our exported destructor), so those
// keep Bun meanings for words 1 and 2 (m_previousHandleScope/m_buffer). Frames constructed by the
// exported EscapableHandleScopeBase constructor *are* unwound by the inline destructor, so that
// constructor initializes them with V8's meanings instead -- see V8EscapableHandleScopeBase.cpp
// and the comments in ~HandleScope below.
ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::HandleScope)

namespace v8 {

HandleScope::HandleScope(Isolate* isolate)
    : m_isolate(isolate)
    , m_previousHandleScope(m_isolate->globalInternals()->currentHandleScope())
    , m_buffer(shim::HandleScopeBuffer::create(
          isolate->vm(),
          isolate->globalInternals()->handleScopeBufferStructure(isolate->globalObject())))
{
    m_isolate->globalInternals()->setCurrentHandleScope(this);
    // Snapshot the isolate's HandleScopeData so the pop can restore it; see
    // the comment on HandleScopeBuffer::saveHandleScopeData.
    auto* data = shim::getHandleScopeData(isolate);
    m_buffer->saveHandleScopeData(data->next, data->limit);
}

HandleScope::~HandleScope()
{
    if (m_isolate->globalInternals()->currentHandleScope() != this) {
        // This frame was not pushed onto Bun's handle scope stack, so it must have been
        // initialized in V8's inline ABI style by the exported EscapableHandleScopeBase
        // constructor (which is the only exported constructor that does not push; plain
        // HandleScope frames built by the exported constructor above always have
        // currentHandleScope() == this here under correct nesting). Old-ABI addons reach this
        // destructor for such frames because their inline-defaulted ~EscapableHandleScopeBase /
        // ~EscapableHandleScope call the out-of-line ~HandleScope. Unwind exactly like V8 14's
        // inline ~HandleScope would: words 1 and 2 hold the constructor-time snapshot of
        // HandleScopeData::next/limit, not Bun pointers.
#if ASSERT_ENABLED
        // A Bun-pushed frame destroyed out of LIFO order would also land here and have its
        // m_previousHandleScope/m_buffer pointers written into HandleScopeData below, silently
        // corrupting the next inline CreateHandle. Fail loudly in debug builds instead.
        for (auto* scope = m_isolate->globalInternals()->currentHandleScope(); scope; scope = scope->m_previousHandleScope) {
            ASSERT_WITH_MESSAGE(scope != this, "v8::HandleScope destroyed out of LIFO order");
        }
#endif
        auto* data = shim::getHandleScopeData(m_isolate);
        data->next = reinterpret_cast<uintptr_t*>(m_previousHandleScope);
        data->limit = reinterpret_cast<uintptr_t*>(m_buffer);
        data->level--;
        // Mirror V8 14's inline ~HandleScope: reclaim the slots Extend granted inside this
        // frame (a no-op when the frame created no handles, since the newest remaining grant
        // then already matches the restored limit).
        if (auto* current = m_isolate->globalInternals()->currentHandleScope()) {
            current->m_buffer->deleteGrantsBack(data->limit);
        }
        // This frame is an escapable scope going through the exported destructor (old ABI);
        // drop its escape reservation if Escape() was never called.
        m_isolate->globalInternals()->escapeReservations().remove(this);
        return;
    }
    m_isolate->globalInternals()->setCurrentHandleScope(m_previousHandleScope);
    // Escape reservations in this buffer belong to scopes that are dead or dying (their slots
    // are about to be cleared); purge them so stale stack-address keys can't alias new scopes.
    m_isolate->globalInternals()->purgeEscapeReservations(m_buffer);
    // Restore HandleScopeData to its push-time snapshot. If Extend granted
    // slots from this buffer while this scope was current, next/limit would
    // otherwise keep pointing into the buffer we are about to clear, and the
    // next inline v8::HandleScope would capture that stale limit as its
    // prev_limit_ — its DeleteExtensions would then pop every grant in the
    // (foreign) enclosing buffer, killing handles of still-open outer scopes.
    auto* data = shim::getHandleScopeData(m_isolate);
    data->next = m_buffer->savedNext();
    data->limit = m_buffer->savedLimit();
    m_buffer->clear();
    m_buffer = nullptr;
}

uintptr_t* HandleScope::CreateHandle(internal::Isolate* i_isolate, uintptr_t value)
{
    auto* isolate = reinterpret_cast<Isolate*>(i_isolate);
    auto* handleScope = isolate->globalInternals()->currentHandleScope();
    TaggedPointer* newSlot = handleScope->m_buffer->createHandleFromExistingObject(TaggedPointer::fromRaw(value), isolate);
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
    // level. The frame is addon-owned and V8-laid-out — do not push a Bun
    // scope and do not touch Bun-meaning members beyond the three words.
    auto* data = shim::getHandleScopeData(isolate);
    m_isolate = isolate;
    m_previousHandleScope = reinterpret_cast<HandleScope*>(data->next);
    m_buffer = reinterpret_cast<shim::HandleScopeBuffer*>(data->limit);
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
    // come from the current Bun handle scope's buffer, so the values stay alive (and GC-visited,
    // see Handle::isCell) until that scope closes.
    auto* handleScope = isolate->globalInternals()->currentHandleScope();
    RELEASE_ASSERT(handleScope);
    TaggedPointer* slot = handleScope->m_buffer->createRawHandleSlot();
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
    // the closing scope — without this, per-iteration v8::HandleScopes in a long native call never
    // reclaim memory (everything would otherwise live until the enclosing Bun scope closes).
    // `this` is the addon's V8-layout HandleScope, so our members must not be touched.
    auto* handleScope = isolate->globalInternals()->currentHandleScope();
    if (!handleScope) {
        return;
    }
    auto* data = shim::getHandleScopeData(isolate);
    handleScope->m_buffer->deleteGrantsBack(data->limit);
}

} // namespace v8
