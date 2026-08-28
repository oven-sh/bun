#include "HandleScopeBuffer.h"
#include "GlobalInternals.h"
#include "../V8Isolate.h"

namespace v8 {
namespace shim {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo HandleScopeBuffer::s_info = {
    "HandleScopeBuffer"_s,
    nullptr,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(HandleScopeBuffer)
};

HandleScopeBuffer* HandleScopeBuffer::create(JSC::VM& vm, JSC::Structure* structure)
{
    HandleScopeBuffer* buffer = new (NotNull, JSC::allocateCell<HandleScopeBuffer>(vm)) HandleScopeBuffer(vm, structure);
    buffer->finishCreation(vm);
    return buffer;
}

template<typename Visitor>
void HandleScopeBuffer::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    HandleScopeBuffer* thisObject = uncheckedDowncast<HandleScopeBuffer>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    WTF::Locker locker { thisObject->m_gcLock };

    for (auto& handle : thisObject->m_storage) {
        if (handle.isCell()) {
            visitor.append(handle.asCell());
        }
    }
}

DEFINE_VISIT_CHILDREN(HandleScopeBuffer);

Handle& HandleScopeBuffer::createEmptyHandle()
{
    WTF::Locker locker { m_gcLock };
    m_storage.append(Handle {});
    return m_storage.last();
}

TaggedPointer* HandleScopeBuffer::createHandle(JSCell* ptr, const Map* map, JSC::VM& vm)
{
    auto& handle = createEmptyHandle();
    handle = Handle(map, ptr, vm, this);
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
    WTF::Locker locker { m_gcLock };
    m_storage.append(Handle {});
    TaggedPointer* slot = m_storage.last().slot();
    m_rawGrants.append({ slot, m_storage.size() - 1 });
    return slot;
}

Handle* HandleScopeBuffer::reserveEscapeHandle()
{
    return &createEmptyHandle();
}

void HandleScopeBuffer::deleteGrantsBack(Isolate* isolate, const uintptr_t* limit)
{
    // (slot to repoint, copy of the layout it pointed at) for every condemned
    // handle a live return-value slot references.
    WTF::Vector<std::pair<TaggedPointer*, ObjectLayout>, 2> rescues;
    {
        WTF::Locker locker { m_gcLock };
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
        for (TaggedPointer* returnSlot : isolate->globalInternals()->activeReturnValueSlots()) {
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
        handle = Handle(layout.map(), layout.asCell(), vm(), this);
    }
    return *handle.slot();
}

void HandleScopeBuffer::evacuateActiveReturnValues(Isolate* isolate, HandleScopeBuffer* target)
{
    ASSERT(target != this);
    for (TaggedPointer* returnSlot : isolate->globalInternals()->activeReturnValueSlots()) {
        ObjectLayout rescued;
        {
            WTF::Locker locker { m_gcLock };
            const ObjectLayout* layout = findLayoutInRangeLocked(*returnSlot, 0);
            if (!layout) {
                continue;
            }
            rescued = *layout;
        }
        // The source handle is still alive (this buffer clears after the
        // evacuation), so the cell stays visited across this append.
        *returnSlot = target->appendRescuedLayout(rescued);
    }
}

TaggedPointer* HandleScopeBuffer::createHandleFromExistingObject(TaggedPointer address, Isolate* isolate, Handle* reuseHandle)
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
                return isolate->nullSlot();
            case Kind::kUndefined:
                return isolate->undefinedSlot();
            case Kind::kTrue:
                return isolate->trueSlot();
            case Kind::kFalse:
                return isolate->falseSlot();
            default:
                RELEASE_ASSERT_NOT_REACHED("HandleScopeBuffer::createHandleFromExistingObject passed an unknown Oddball kind: %d",
                    reinterpret_cast<Oddball*>(v8_object)->kind());
            }
        }
        if (reuseHandle) {
            *reuseHandle = Handle(v8_object->map(), v8_object->asCell(), vm(), this);
            return reuseHandle->slot();
        } else {
            return createHandle(v8_object->asCell(), v8_object->map(), vm());
        }
    }
}

void HandleScopeBuffer::clear()
{
    // detect use-after-free of handles
    WTF::Locker locker { m_gcLock };
    for (auto& handle : m_storage) {
        handle = Handle();
    }
    m_storage.clear();
    m_rawGrants.clear();
}

} // namespace shim
} // namespace v8
