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
    HandleScopeBuffer* thisObject = jsCast<HandleScopeBuffer*>(cell);
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
}

} // namespace shim
} // namespace v8
