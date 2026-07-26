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

    visitor.append(thisObject->m_slots.begin(), thisObject->m_slots.end());
}

DEFINE_VISIT_CHILDREN(JSTimerRootSegment);

extern "C" JSC::EncodedJSValue Bun__TimerRootSegment__create(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);
    auto* zigGlobal = defaultGlobalObject(globalObject);
    auto* segment = JSTimerRootSegment::create(vm, zigGlobal->JSTimerRootSegmentStructure());
    return JSC::JSValue::encode(segment);
}

extern "C" void Bun__TimerRootSegment__set(JSC::EncodedJSValue segment, uint32_t index, JSC::EncodedJSValue value)
{
    uncheckedDowncast<JSTimerRootSegment>(JSC::JSValue::decode(segment).asCell())->set(index, JSC::JSValue::decode(value));
}

extern "C" void Bun__TimerRootSegment__clear(JSC::EncodedJSValue segment, uint32_t index)
{
    uncheckedDowncast<JSTimerRootSegment>(JSC::JSValue::decode(segment).asCell())->clear(index);
}

} // namespace Bun
