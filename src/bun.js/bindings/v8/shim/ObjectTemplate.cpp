#include "ObjectTemplate.h"

#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/LazyPropertyInlines.h"
#include "JavaScriptCore/VMTrapsInlines.h"

using JSC::LazyProperty;
using JSC::Structure;

namespace v8 {
namespace shim {

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo ObjectTemplate::s_info = {
    "ObjectTemplate"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(ObjectTemplate)
};

ObjectTemplate* ObjectTemplate::create(JSC::VM& vm, JSC::Structure* structure)
{
    // TODO take a constructor
    auto* objectTemplate = new (NotNull, JSC::allocateCell<ObjectTemplate>(vm)) ObjectTemplate(vm, structure);
    objectTemplate->finishCreation(vm);
    return objectTemplate;
}

void ObjectTemplate::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    m_objectStructure.initLater([](const LazyProperty<ObjectTemplate, Structure>::Initializer& init) {
        init.set(JSC::Structure::create(
            init.vm,
            init.owner->globalObject(),
            init.owner->globalObject()->objectPrototype(),
            JSC::TypeInfo(JSC::ObjectType, InternalFieldObject::StructureFlags),
            InternalFieldObject::info()));
    });
}

template<typename Visitor>
void ObjectTemplate::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    ObjectTemplate* tmp = jsCast<ObjectTemplate*>(cell);
    ASSERT_GC_OBJECT_INHERITS(tmp, info());
    Base::visitChildren(tmp, visitor);

    tmp->m_objectStructure.visit(visitor);
}

DEFINE_VISIT_CHILDREN(ObjectTemplate);

Structure* ObjectTemplate::createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
{
    return Structure::create(
        vm,
        globalObject,
        prototype,
        JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags),
        info());
}

InternalFieldObject* ObjectTemplate::newInstance()
{
    auto* structure = m_objectStructure.get(this);
    auto* newInstance = InternalFieldObject::create(globalObject()->vm(), structure, m_internalFieldCount);
    // todo: apply properties
    return newInstance;
}

} // namespace shim
} // namespace v8
