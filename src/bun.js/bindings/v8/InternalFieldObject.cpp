#include "InternalFieldObject.h"

namespace v8 {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo InternalFieldObject::s_info = {
    "InternalFieldObject"_s,
    &JSC::JSDestructibleObject::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(InternalFieldObject)
};

InternalFieldObject* InternalFieldObject::create(JSC::VM& vm, JSC::Structure* structure, ObjectTemplate* objectTemplate)
{
    // TODO figure out how this works with __internals
    // maybe pass a Local<ObjectTemplate>
    auto object = new (NotNull, JSC::allocateCell<InternalFieldObject>(vm)) InternalFieldObject(vm, structure, objectTemplate->getInternalFieldCount());
    object->finishCreation(vm);
    return object;
}

}
