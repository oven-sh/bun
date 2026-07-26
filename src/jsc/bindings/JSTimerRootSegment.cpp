#include "JSTimerRootSegment.h"
#include "ZigGlobalObject.h"

namespace Bun {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo JSTimerRootSegment::s_info = {
    "TimerRootSegment"_s,
    nullptr,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(JSTimerRootSegment)
};

JSTimerRootSegment* JSTimerRootSegment::create(JSC::VM& vm, JSC::Structure* structure)
{
    JSTimerRootSegment* segment = new (NotNull, JSC::allocateCell<JSTimerRootSegment>(vm))
        JSTimerRootSegment(vm, structure);
    segment->finishCreation(vm);
    return segment;
}

template<typename Visitor>
void JSTimerRootSegment::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSTimerRootSegment* thisObject = uncheckedDowncast<JSTimerRootSegment>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    visitor.append(thisObject->m_next);
    visitor.append(thisObject->m_slots.begin(), thisObject->m_slots.end());
}

DEFINE_VISIT_CHILDREN(JSTimerRootSegment);

// Returns a segment with at least one free slot. Walks the active list from
// the head, reuses the parked spare if nothing has room, and allocates only as
// a last resort. JSC does not relocate cells, so the returned pointer is
// stable while the segment is on the active list.
extern "C" JSTimerRootSegment* Bun__TimerRootSegment__acquire(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto* zigGlobal = defaultGlobalObject(globalObject);

    for (auto* seg = zigGlobal->m_timerRootSegmentHead.get(); seg; seg = seg->next()) {
        if (seg->findFreeSlot() < JSTimerRootSegment::capacity)
            return seg;
    }

    JSTimerRootSegment* segment = zigGlobal->m_timerRootSegmentFree.get();
    if (segment)
        zigGlobal->m_timerRootSegmentFree.clear();
    else
        segment = JSTimerRootSegment::create(vm, zigGlobal->JSTimerRootSegmentStructure());

    segment->setNext(vm, zigGlobal->m_timerRootSegmentHead.get());
    zigGlobal->m_timerRootSegmentHead.set(vm, zigGlobal, segment);
    return segment;
}

extern "C" void Bun__TimerRootSegment__set(JSTimerRootSegment* segment, uint32_t index, JSC::EncodedJSValue value)
{
    segment->set(index, JSC::JSValue::decode(value));
}

// Unlink `segment` from the active list and either park it in the free slot
// (one segment of slack) or leave it unreachable so GC reclaims it.
static void release(Zig::GlobalObject* zigGlobal, JSTimerRootSegment* segment)
{
    auto& vm = JSC::getVM(zigGlobal);
    JSTimerRootSegment* head = zigGlobal->m_timerRootSegmentHead.get();
    if (head == segment) {
        zigGlobal->m_timerRootSegmentHead.setMayBeNull(vm, zigGlobal, segment->next());
    } else {
        for (auto* prev = head; prev; prev = prev->next()) {
            if (prev->next() == segment) {
                prev->setNext(vm, segment->next());
                break;
            }
        }
    }
    segment->setNext(vm, nullptr);

    if (!zigGlobal->m_timerRootSegmentFree.get())
        zigGlobal->m_timerRootSegmentFree.set(vm, zigGlobal, segment);
}

extern "C" bool Bun__TimerRootSegment__clear(JSC::JSGlobalObject* globalObject, JSTimerRootSegment* segment, uint32_t index)
{
    if (segment->clear(index) > 0)
        return false;
    release(defaultGlobalObject(globalObject), segment);
    return true;
}

extern "C" uint32_t Bun__TimerRootSegment__findFreeSlot(JSTimerRootSegment* segment)
{
    return segment->findFreeSlot();
}

extern "C" void Bun__TimerRootSegment__clearAll(JSC::JSGlobalObject* globalObject)
{
    auto* zigGlobal = defaultGlobalObject(globalObject);
    zigGlobal->m_timerRootSegmentHead.clear();
    zigGlobal->m_timerRootSegmentFree.clear();
}

} // namespace Bun
