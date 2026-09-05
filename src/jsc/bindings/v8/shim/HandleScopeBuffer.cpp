#include "HandleScopeBuffer.h"
#include "GlobalInternals.h"
#include "../v8_handle_scope_data.h"
#include <wtf/TZoneMallocInlines.h>

namespace v8 {
namespace shim {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HandleScopeBuffer);

HandleScopeBuffer::HandleScopeBuffer(Bun::HandleScopeImpl* owner, Isolate* isolate)
    : m_owner(owner)
    , m_isolate(isolate)
{
    auto* data = getHandleScopeData(isolate);
    m_savedNext = data->next;
    m_savedLimit = data->limit;
}

HandleScopeBuffer::~HandleScopeBuffer() = default;

JSC::VM& HandleScopeBuffer::vm() const
{
    return m_isolate->vm();
}

Handle& HandleScopeBuffer::createEmptyHandle()
{
    WTF::Locker locker { m_owner->cellLock() };
    m_storage.append(Handle {});
    return m_storage.last();
}

TaggedPointer* HandleScopeBuffer::createHandle(JSCell* ptr, const Map* map, JSC::VM& vm)
{
    auto& handle = createEmptyHandle();
    handle = Handle(map, ptr, vm, m_owner);
    return handle.slot();
}

TaggedPointer* HandleScopeBuffer::createSmiHandle(int32_t smi)
{
    auto& handle = createEmptyHandle();
    handle = Handle(smi);
    return handle.slot();
}

TaggedPointer* HandleScopeBuffer::createDoubleHandle(double value)
{
    auto& handle = createEmptyHandle();
    handle = Handle(value);
    return handle.slot();
}

TaggedPointer* HandleScopeBuffer::createRawHandleSlot()
{
    WTF::Locker locker { m_owner->cellLock() };
    m_storage.append(Handle {});
    TaggedPointer* slot = m_storage.last().slot();
    m_rawGrants.append({ slot, m_storage.size() - 1 });
    return slot;
}

Handle* HandleScopeBuffer::reserveEscapeHandle()
{
    return &createEmptyHandle();
}

void HandleScopeBuffer::deleteGrantsBack(const uintptr_t* limit)
{
    // (slot to repoint, copy of the layout it pointed at) for every condemned
    // handle a live return-value slot references.
    WTF::Vector<std::pair<TaggedPointer*, ObjectLayout>, 2> rescues;
    {
        WTF::Locker locker { m_owner->cellLock() };
        // Pop grants (and every handle created after each, which V8 semantics also
        // scope to the closing inline HandleScope) until the newest remaining grant
        // is the one the restored limit points one past — i.e. the last grant made
        // before the closing scope opened. A null/foreign limit pops all grants.
        size_t cut = m_storage.size();
        while (!m_rawGrants.isEmpty() && m_rawGrants.last().first->asRawPtrLocation() + 1 != limit) {
            cut = m_rawGrants.last().second;
            m_rawGrants.removeLast();
        }
        if (cut == m_storage.size()) {
            return;
        }
        // V8's inline ReturnValue::Set copied a Local's Address into a callback
        // frame, and the returned value must outlive this scope (in V8 the scope
        // owns only the slot, never the object). Copy out any condemned handle a
        // frame still points at so it can be re-created in the surviving region.
        for (TaggedPointer* returnSlot : m_isolate->globalInternals()->activeReturnValueSlots()) {
            if (const ObjectLayout* layout = findLayoutInRangeLocked(*returnSlot, cut)) {
                rescues.append({ returnSlot, *layout });
            }
        }
        // From here until appendRescuedLayout() re-roots it below, a rescued
        // cell may be referenced only by the copy in `rescues`, which the GC
        // does not visit. That is safe: nothing in this window allocates from
        // the JSC heap or reaches a safepoint, so a collection cannot complete
        // before the copy is re-rooted through the write-barriered Handle
        // constructor.
        while (m_storage.size() > cut) {
            m_storage.last() = Handle();
            m_storage.removeLast();
        }
    }
    for (auto& [returnSlot, layout] : rescues) {
        *returnSlot = appendRescuedLayout(layout);
    }
}

const ObjectLayout* HandleScopeBuffer::findLayoutInRangeLocked(TaggedPointer value, size_t begin) const
{
    const auto* layout = value.getPtr<const ObjectLayout>();
    if (!layout) {
        // empty or Smi
        return nullptr;
    }
    for (size_t i = begin; i < m_storage.size(); i++) {
        if (&m_storage[i].m_object == layout) {
            return layout;
        }
    }
    return nullptr;
}

TaggedPointer HandleScopeBuffer::appendRescuedLayout(const ObjectLayout& layout)
{
    auto& handle = createEmptyHandle();
    if (layout.map() == &Map::heap_number_map()) {
        handle = Handle(layout.asDouble());
    } else {
        // Besides heap numbers, scope buffers only ever own string_map/object_map
        // cells (oddballs live in the isolate's roots and globals in their own
        // buffer), so everything else is a cell.
        handle = Handle(layout.map(), layout.asCell(), vm(), m_owner);
    }
    return *handle.slot();
}

void HandleScopeBuffer::evacuateActiveReturnValues(Bun::HandleScopeImpl* parent)
{
    for (TaggedPointer* returnSlot : m_isolate->globalInternals()->activeReturnValueSlots()) {
        ObjectLayout rescued;
        {
            WTF::Locker locker { m_owner->cellLock() };
            const ObjectLayout* layout = findLayoutInRangeLocked(*returnSlot, 0);
            if (!layout) {
                continue;
            }
            rescued = *layout;
        }
        // The source handle is still alive (this buffer clears after the
        // evacuation), so the cell stays visited across this append.
        *returnSlot = parent->ensureV8Handles(m_isolate).appendRescuedLayout(rescued);
    }
}

TaggedPointer* HandleScopeBuffer::createHandleFromExistingObject(TaggedPointer address, Handle* reuseHandle)
{
    int32_t smi;
    if (address.getSmi(smi)) {
        if (reuseHandle) {
            *reuseHandle = Handle(smi);
            return reuseHandle->slot();
        } else {
            return createSmiHandle(smi);
        }
    } else {
        auto* v8_object = address.getPtr<ObjectLayout>();
        if (v8_object->map()->m_instanceType == InstanceType::Oddball) {
            using Kind = Oddball::Kind;
            // find which oddball this is
            switch (reinterpret_cast<Oddball*>(v8_object)->kind()) {
            case Kind::kNull:
                return m_isolate->nullSlot();
            case Kind::kUndefined:
                return m_isolate->undefinedSlot();
            case Kind::kTrue:
                return m_isolate->trueSlot();
            case Kind::kFalse:
                return m_isolate->falseSlot();
            default:
                RELEASE_ASSERT_NOT_REACHED("HandleScopeBuffer::createHandleFromExistingObject passed an unknown Oddball kind: %d",
                    reinterpret_cast<Oddball*>(v8_object)->kind());
            }
        }
        if (reuseHandle) {
            *reuseHandle = Handle(v8_object->map(), v8_object->asCell(), vm(), m_owner);
            return reuseHandle->slot();
        } else {
            return createHandle(v8_object->asCell(), v8_object->map(), vm());
        }
    }
}

void HandleScopeBuffer::close(Bun::HandleScopeImpl* parent)
{
    auto* internals = m_isolate->globalInternals();
    // Escape reservations in this buffer belong to scopes that are dead or dying (their slots
    // are about to be cleared); purge them so stale stack-address keys can't alias new scopes.
    internals->purgeEscapeReservations(this);
    auto* data = getHandleScopeData(m_isolate);
    data->next = m_savedNext;
    data->limit = m_savedLimit;
    // A live callback frame's return value may point into this buffer (scopes
    // popping mid-callback: old-ABI addon scopes, Bun-internal ones like
    // Array::Iterate's). Move it to the enclosing scope so it survives until
    // the frame is read.
    if (parent && !internals->activeReturnValueSlots().isEmpty()) {
        evacuateActiveReturnValues(parent);
    }
    // The owner frees this (and with it every handle) right after detaching it.
}

} // namespace shim
} // namespace v8
