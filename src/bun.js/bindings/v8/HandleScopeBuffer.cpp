#include "v8/HandleScopeBuffer.h"

namespace v8 {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo HandleScopeBuffer::s_info = {
    "HandleScopeBuffer"_s,
    &Base::s_info,
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

    for (int i = 0; i < thisObject->size; i++) {
        auto& handle = thisObject->storage[i];
        if (handle.to_v8_object.type() != TaggedPointer::Type::Smi && handle.map.getPtr<Map>() == &Map::object_map) {
            JSCell::visitChildren(reinterpret_cast<JSCell*>(thisObject->storage[i].ptr), visitor);
        }
    }
}

DEFINE_VISIT_CHILDREN(HandleScopeBuffer);

Handle& HandleScopeBuffer::createUninitializedHandle()
{
    RELEASE_ASSERT(size < capacity - 1);
    int index = size;
    size++;
    return storage[index];
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
