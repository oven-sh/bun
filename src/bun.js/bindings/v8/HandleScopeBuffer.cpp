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

    for (int i = 0; i < capacity; i++) {
        JSC::JSCell* ptr = reinterpret_cast<JSC::JSCell*>(thisObject->storage[i].getPtr());
        if (ptr) {
            printf("HSB visit: cast %p to %p and visiting\n", reinterpret_cast<void*>(thisObject->storage[i].value), ptr);
            JSCell::visitChildren(ptr, visitor);
        }
    }
}

DEFINE_VISIT_CHILDREN(HandleScopeBuffer);

uintptr_t* HandleScopeBuffer::createHandle(uintptr_t address)
{
    RELEASE_ASSERT(size < capacity - 1);

    int index = size;
    size++;
    storage[index] = TaggedPointer::fromRaw(address);
    return reinterpret_cast<uintptr_t*>(&storage[index]);
}

}
