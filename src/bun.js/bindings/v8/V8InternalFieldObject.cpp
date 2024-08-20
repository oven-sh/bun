#include "V8InternalFieldObject.h"

namespace v8 {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo InternalFieldObject::s_info = {
    "InternalFieldObject"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(InternalFieldObject)
};

InternalFieldObject* InternalFieldObject::create(JSC::VM& vm, JSC::Structure* structure, Local<ObjectTemplate> objectTemplate)
{
    // TODO figure out how this works with __internals
    // maybe pass a Local<ObjectTemplate>
    auto object = new (NotNull, JSC::allocateCell<InternalFieldObject>(vm)) InternalFieldObject(vm, structure, objectTemplate->InternalFieldCount());
    object->finishCreation(vm);
    return object;
}

template<typename Visitor>
void InternalFieldObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    InternalFieldObject* thisObject = jsCast<InternalFieldObject*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    for (auto& value : thisObject->fields) {
        visitor.append(value);
    }
}

DEFINE_VISIT_CHILDREN(InternalFieldObject);

}
