#include "V8ObjectTemplate.h"
#include "V8InternalFieldObject.h"
#include "V8GlobalInternals.h"
#include "V8HandleScope.h"

#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/LazyPropertyInlines.h"
#include "JavaScriptCore/VMTrapsInlines.h"

using JSC::JSGlobalObject;
using JSC::JSValue;
using JSC::LazyProperty;
using JSC::Structure;

namespace v8 {

void ObjectTemplate::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    __internals.objectStructure.initLater([](const LazyProperty<ObjectTemplate, Structure>::Initializer& init) {
        init.set(JSC::Structure::create(
            init.vm,
            init.owner->globalObject(),
            init.owner->globalObject()->objectPrototype(),
            JSC::TypeInfo(JSC::ObjectType, InternalFieldObject::StructureFlags),
            InternalFieldObject::info()));
    });
}

// for CREATE_METHOD_TABLE
namespace JSCastingHelpers = JSC::JSCastingHelpers;

const JSC::ClassInfo ObjectTemplate::s_info = {
    "ObjectTemplate"_s,
    &Base::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(ObjectTemplate)
};

Local<ObjectTemplate> ObjectTemplate::New(Isolate* isolate, Local<FunctionTemplate> constructor)
{
    RELEASE_ASSERT(constructor.IsEmpty());
    auto* globalObject = isolate->globalObject();
    auto& vm = globalObject->vm();
    auto* globalInternals = globalObject->V8GlobalInternals();
    Structure* structure = globalInternals->objectTemplateStructure(globalObject);
    auto* objectTemplate = new (NotNull, JSC::allocateCell<ObjectTemplate>(vm)) ObjectTemplate(vm, structure);
    // TODO pass constructor
    objectTemplate->finishCreation(vm);
    return globalInternals->currentHandleScope()->createLocal<ObjectTemplate>(vm, objectTemplate);
}

MaybeLocal<Object> ObjectTemplate::NewInstance(Local<Context> context)
{
    // TODO handle constructor
    // TODO handle interceptors?

    auto& vm = context->vm();
    auto thisObj = localToObjectPointer();

    // get a structure
    // must take thisObj because JSC needs the native pointer
    auto structure = internals().objectStructure.get(thisObj);

    // create object from it
    // InternalFieldObject needs a Local<ObjectTemplate>, which we can create using the `this`
    // pointer as we know this method itself was called through a Local
    auto newInstance = InternalFieldObject::create(vm, structure, Local<ObjectTemplate>(reinterpret_cast<TaggedPointer*>(this)));

    // todo: apply properties

    return MaybeLocal<Object>(context->currentHandleScope()->createLocal<Object>(vm, newInstance));
}

template<typename Visitor>
void ObjectTemplate::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    ObjectTemplate* fn = jsCast<ObjectTemplate*>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    Base::visitChildren(fn, visitor);

    fn->__internals.objectStructure.visit(visitor);
}

DEFINE_VISIT_CHILDREN(ObjectTemplate);

void ObjectTemplate::SetInternalFieldCount(int value)
{
    internals().internalFieldCount = value;
}

int ObjectTemplate::InternalFieldCount() const
{
    return internals().internalFieldCount;
}

Structure* ObjectTemplate::createStructure(JSC::VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(
        vm,
        globalObject,
        prototype,
        JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags),
        info());
}

}
