#include "V8HandleScopeBuffer.h"

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
            JSCell::visitChildren(reinterpret_cast<JSCell*>(handle.object.ptr), visitor);
        }
    }
}

DEFINE_VISIT_CHILDREN(HandleScopeBuffer);

Handle& HandleScopeBuffer::createUninitializedHandle()
{
    WTF::Locker locker { gc_lock };
    storage.append(Handle {});
    return storage.last();
}

TaggedPointer* HandleScopeBuffer::createHandle(void* ptr, const Map* map)
{
    // TODO(@190n) specify the map more correctly
    auto& handle = createUninitializedHandle();
    handle = Handle(map, ptr);
    return &handle.to_v8_object;
}

TaggedPointer* HandleScopeBuffer::createSmiHandle(int32_t smi)
{
    auto& handle = createUninitializedHandle();
    handle.to_v8_object = TaggedPointer(smi);
    return &handle.to_v8_object;
}

}
