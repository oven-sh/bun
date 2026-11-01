#include "HandleScopeBuffer.h"
#include "GlobalInternals.h"
#include "../v8_handle_scope_data.h"
#include <atomic>
#include <wtf/HashSet.h>
#include <wtf/Lock.h>
#include <wtf/NeverDestroyed.h>
#include <wtf/TZoneMallocInlines.h>

namespace v8 {
namespace shim {

WTF_MAKE_TZONE_ALLOCATED_IMPL(HandleScopeBuffer);

// The handles of v8::Globals, by state. A handle is in at most one of these.
struct GlobalHandleLists {
    WTF_MAKE_STRUCT_TZONE_ALLOCATED(GlobalHandleLists);
    WTF::HashSet<Handle*> live;
    // Each keeps its value until no open scope has V8 handles: see createGlobalHandle().
    WTF::Vector<Handle*> disposed;
    // Empty handles, for the next v8::Global.
    WTF::Vector<Handle*> free;
};

WTF_MAKE_STRUCT_TZONE_ALLOCATED_IMPL(GlobalHandleLists);

// See releaseRetiredGlobalHandle(). Process-wide, because the v8::Global that points to a retired
// handle is disposed in another VM, or on a thread that has none.
struct RetiredGlobalHandles {
    WTF::Lock lock;
    WTF::HashSet<Handle*> handles WTF_GUARDED_BY_LOCK(lock);
    // handles.size(), so that the lock is only taken once a buffer was freed with live handles.
    std::atomic<unsigned> count { 0 };
};

static RetiredGlobalHandles& retiredGlobalHandles()
{
    static WTF::NeverDestroyed<RetiredGlobalHandles> retired;
    return retired;
}

HandleScopeBuffer::HandleScopeBuffer(Bun::HandleScopeImpl* owner, Isolate* isolate)
    : m_owner(owner)
    , m_isolate(isolate)
{
    auto* data = getHandleScopeData(isolate);
    m_savedNext = data->next;
    m_savedLimit = data->limit;
}

NEVER_INLINE void HandleScopeBuffer::destroyGlobalHandleLists()
{
    std::unique_ptr<GlobalHandleLists> lists { std::exchange(m_globalHandleLists, nullptr) };
    if (lists->live.isEmpty()) {
        return;
    }
    // v8::Globals still point to these handles.
    auto& retired = retiredGlobalHandles();
    WTF::Locker locker { retired.lock };
    retired.handles.addAll(lists->live);
    retired.count.store(retired.handles.size());
}

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
        if (v8_object->map()->m_instanceType == InstanceType::HeapNumber) {
            if (reuseHandle) {
                *reuseHandle = Handle(v8_object->asDouble());
                return reuseHandle->slot();
            } else {
                return createDoubleHandle(v8_object->asDouble());
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

// Whether `scope` or a scope around it has V8 handles.
static bool hasV8Handles(Bun::HandleScopeImpl* scope)
{
    for (; scope; scope = scope->parent()) {
        if (scope->v8Handles()) {
            return true;
        }
    }
    return false;
}

static bool isRetiredGlobalHandle(Handle* handle)
{
    auto& retired = retiredGlobalHandles();
    // Zero proves it without the lock: an address is retired, and counted, before its storage is freed.
    if (!retired.count.load()) {
        return false;
    }
    WTF::Locker locker { retired.lock };
    return retired.handles.contains(handle);
}

TaggedPointer* HandleScopeBuffer::createGlobalHandle(TaggedPointer address)
{
    if (!m_globalHandleLists) {
        m_globalHandleLists = new GlobalHandleLists;
    }
    auto& lists = *m_globalHandleLists;
    Handle* handle = lists.free.isEmpty() ? &createEmptyHandle() : lists.free.takeLast();
    // A v8::Global still points to a retired address, and disposing it would dispose this handle,
    // so the handle stays unused.
    while (isRetiredGlobalHandle(handle)) {
        handle = &createEmptyHandle();
    }
    TaggedPointer* slot;
    {
        // The GC visits the handles under this lock. Without it, a visit between the write barrier of the new value
        // and the write of the handle sees an empty handle, and nothing makes the GC visit it again.
        WTF::Locker locker { m_owner->cellLock() };
        slot = createHandleFromExistingObject(address, handle);
    }
    if (slot != handle->slot()) {
        // undefined, null, true or false: the slot is one of the isolate's roots
        lists.free.append(handle);
        return slot;
    }
    lists.live.add(handle);
    return slot;
}

void HandleScopeBuffer::disposeGlobalHandle(TaggedPointer* slot)
{
    auto* handle = reinterpret_cast<Handle*>(slot);
    if (!m_globalHandleLists || !m_globalHandleLists->live.remove(handle)) {
        return;
    }
    m_globalHandleLists->disposed.append(handle);
    m_isolate->globalInternals()->setHasDisposedGlobalHandles(true);
    if (hasV8Handles(m_isolate->globalObject()->m_currentHandleScopeImpl.get())) {
        return;
    }
    // Never waits: a static v8::Global is destroyed at exit, when the thread that holds the lock may be gone.
    if (auto locker = WTF::Locker<JSC::JSCellLock>::tryLock(m_owner->cellLock())) {
        releaseDisposedGlobalHandles(locker);
    }
}

bool HandleScopeBuffer::releaseRetiredGlobalHandle(TaggedPointer* slot)
{
    auto& retired = retiredGlobalHandles();
    if (!retired.count.load()) {
        return false;
    }
    // Never waits, like disposeGlobalHandle(). An address that stays retired is just never used again.
    if (!retired.lock.tryLock()) {
        return false;
    }
    WTF::Locker locker { WTF::AdoptLock, retired.lock };
    if (!retired.handles.remove(reinterpret_cast<Handle*>(slot))) {
        return false;
    }
    retired.count.store(retired.handles.size());
    return true;
}

NEVER_INLINE void HandleScopeBuffer::releaseDisposedGlobalHandlesOutside(GlobalInternals* internals, Bun::HandleScopeImpl* scope)
{
    if (hasV8Handles(scope)) {
        return;
    }
    if (auto* globalHandles = internals->globalHandlesIfCreated()) {
        WTF::Locker locker { globalHandles->m_owner->cellLock() };
        globalHandles->releaseDisposedGlobalHandles(locker);
    }
}

void HandleScopeBuffer::releaseDisposedGlobalHandles(const WTF::AbstractLocker&)
{
    auto& lists = *m_globalHandleLists;
    for (Handle* handle : lists.disposed) {
        *handle = Handle();
    }
    lists.free.appendVector(lists.disposed);
    lists.disposed.shrink(0);
    m_isolate->globalInternals()->setHasDisposedGlobalHandles(false);
}

void HandleScopeBuffer::close(Bun::HandleScopeImpl* parent)
{
    auto* internals = m_isolate->globalInternals();
    // Escape reservations in this buffer belong to scopes that are dead or dying (their slots
    // are about to be cleared). Purge them so stale stack-address keys can't alias new scopes.
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
    if (internals->hasDisposedGlobalHandles()) [[unlikely]] {
        releaseDisposedGlobalHandlesOutside(internals, parent);
    }
    // The owner detaches this buffer and then frees it, along with every handle.
}

} // namespace shim
} // namespace v8
