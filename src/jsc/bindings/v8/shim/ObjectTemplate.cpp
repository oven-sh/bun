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
    ObjectTemplate* tmp = uncheckedDowncast<ObjectTemplate>(cell);
    ASSERT_GC_OBJECT_INHERITS(tmp, info());
    Base::visitChildren(tmp, visitor);

    tmp->m_objectStructure.visit(visitor);

    WTF::Locker locker { tmp->cellLock() };
    for (auto& prop : tmp->m_properties) {
        visitor.append(prop.name);
        visitor.append(prop.value);
    }
    for (auto& acc : tmp->m_accessors) {
        visitor.append(acc.name);
        visitor.append(acc.data);
    }
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
    applyTemplateProperties(globalObject(), newInstance, m_properties, m_accessors);
    return newInstance;
}

void ObjectTemplate::addProperty(JSC::VM& vm, JSC::JSValue name, JSC::JSValue value, unsigned attributes)
{
    TemplateProperty prop;
    prop.name.set(vm, this, name);
    prop.value.set(vm, this, value);
    prop.attributes = attributes;
    WTF::Locker locker { cellLock() };
    m_properties.append(WTF::move(prop));
}

void ObjectTemplate::addAccessor(JSC::VM& vm, JSC::JSValue name, AccessorNameGetterCallback getter, AccessorNameSetterCallback setter, JSC::JSValue data, unsigned attributes)
{
    TemplateAccessor acc;
    acc.name.set(vm, this, name);
    acc.data.set(vm, this, data);
    acc.getter = getter;
    acc.setter = setter;
    acc.attributes = attributes;
    WTF::Locker locker { cellLock() };
    m_accessors.append(WTF::move(acc));
}

} // namespace shim
} // namespace v8
