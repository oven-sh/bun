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
        JSCell::visitChildren(thisObject->storage[i].object, visitor);
    }
}

DEFINE_VISIT_CHILDREN(HandleScopeBuffer);

HandleScopeBuffer::Handle& HandleScopeBuffer::createUninitializedHandle()
{
    RELEASE_ASSERT(size < capacity - 1);
    int index = size;
    size++;
    return storage[index];
}

TaggedPointer* HandleScopeBuffer::createHandle(JSCell* object)
{

    // can this work? with the Handle struct, would imply moving out of address into the buffer

    // where does address come from? from our code?
    // can we ensure address is always a JSCell*? but then how do we know what map to use?

    JSC::JSType t = object->type();
    (void)t;

    auto& handle = createUninitializedHandle();
    handle = Handle(&Map::map_map, object);
    return &handle.to_object;
}

TaggedPointer* HandleScopeBuffer::createSmiHandle(int32_t smi)
{
    auto& handle = createUninitializedHandle();
    handle.to_object = TaggedPointer(smi);
    return &handle.to_object;
}

}
