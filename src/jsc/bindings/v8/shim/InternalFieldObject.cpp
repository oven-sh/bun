#include "InternalFieldObject.h"
#include "ObjectTemplate.h"

namespace v8 {
namespace shim {
// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo InternalFieldObject::s_info = {
    "InternalFieldObject"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(InternalFieldObject)
};

InternalFieldObject* InternalFieldObject::create(JSC::VM& vm, JSC::Structure* structure, int internalFieldCount)
{
    // TODO figure out how this works with __internals
    // maybe pass a Local<ObjectTemplate>
    auto object = new (NotNull, JSC::allocateCell<InternalFieldObject>(vm)) InternalFieldObject(vm, structure, internalFieldCount);
    object->finishCreation(vm);
    return object;
}

InternalFieldObject* InternalFieldObject::createWithFieldsOf(JSC::VM& vm, JSC::Structure* structure, JSC::Butterfly* butterfly, const InternalFieldObject& source)
{
    auto object = new (NotNull, JSC::allocateCell<InternalFieldObject>(vm)) InternalFieldObject(vm, structure, butterfly, source);
    object->finishCreation(vm);
    return object;
}

JSC::Structure* InternalFieldObject::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
}

template<typename Visitor>
void InternalFieldObject::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    InternalFieldObject* thisObject = uncheckedDowncast<InternalFieldObject>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    for (auto& value : thisObject->m_fields) {
        visitor.append(value);
    }
}

DEFINE_VISIT_CHILDREN(InternalFieldObject);

} // namespace shim
} // namespace v8
