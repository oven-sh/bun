#include "V8HandleScopeBuffer.h"
#include "V8GlobalInternals.h"
#include "V8Isolate.h"

namespace v8 {

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

    WTF::Locker locker { thisObject->gc_lock };

    for (auto& handle : thisObject->storage) {
        if (handle.isCell()) {
            visitor.append(handle.object.contents.cell);
        }
    }
}

DEFINE_VISIT_CHILDREN(HandleScopeBuffer);

Handle& HandleScopeBuffer::createEmptyHandle()
{
    WTF::Locker locker { gc_lock };
    storage.append(Handle {});
    return storage.last();
}

TaggedPointer* HandleScopeBuffer::createHandle(JSCell* ptr, const Map* map, JSC::VM& vm)
{
    auto& handle = createEmptyHandle();
    handle = Handle(map, ptr, vm, this);
    return &handle.to_v8_object;
}

TaggedPointer* HandleScopeBuffer::createSmiHandle(int32_t smi)
{
    auto& handle = createEmptyHandle();
    handle = Handle(smi);
    return &handle.to_v8_object;
}

TaggedPointer* HandleScopeBuffer::createDoubleHandle(double value)
{
    auto& handle = createEmptyHandle();
    handle = Handle(value);
    return &handle.to_v8_object;
}

TaggedPointer* HandleScopeBuffer::createHandleFromExistingObject(TaggedPointer address, Isolate* isolate, Handle* reuseHandle)
{
    int32_t smi;
    if (address.getSmi(smi)) {
        if (reuseHandle) {
            *reuseHandle = Handle(smi);
            return &reuseHandle->to_v8_object;
        } else {
            return createSmiHandle(smi);
        }
    } else {
        auto* v8_object = address.getPtr<ObjectLayout>();
        if (v8_object->tagged_map.getPtr<Map>()->instance_type == InstanceType::Oddball) {
            // find which oddball this is
            for (auto& root : isolate->m_roots) {
                if (root == address) {
                    return &root;
                }
            }
            RELEASE_ASSERT_NOT_REACHED("HandleScopeBuffer::createHandleFromExistingObject passed an Oddball which does not exist in Roots");
        }
        if (reuseHandle) {
            *reuseHandle = Handle(v8_object->map(), v8_object->asCell(), vm(), this);
            return &reuseHandle->to_v8_object;
        } else {
            return createHandle(v8_object->asCell(), v8_object->map(), vm());
        }
    }
}

void HandleScopeBuffer::clear()
{
    // detect use-after-free of handles
    WTF::Locker locker { gc_lock };
    for (auto& handle : storage) {
        handle = Handle();
    }
    storage.clear();
}

}
