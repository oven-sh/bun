#include "v8/ObjectTemplate.h"
#include "v8/InternalFieldObject.h"
#include "v8/GlobalInternals.h"

#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/LazyPropertyInlines.h"

using JSC::JSGlobalObject;
using JSC::JSValue;
using JSC::LazyProperty;
using JSC::Structure;

namespace v8 {

void ObjectTemplate::finishCreation(JSC::VM& vm)
{
    JSC::InternalFunction::finishCreation(vm);
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
    &JSC::InternalFunction::s_info,
    nullptr,
    nullptr,
    CREATE_METHOD_TABLE(ObjectTemplate)
};

Local<ObjectTemplate> ObjectTemplate::New(Isolate* isolate, Local<FunctionTemplate> constructor)
{
    RELEASE_ASSERT(constructor.IsEmpty());
    auto globalObject = isolate->globalObject();
    auto& vm = globalObject->vm();
    Structure* structure = globalObject->V8GlobalInternals()->objectTemplateStructure(globalObject);
    auto* objectTemplate = new (NotNull, JSC::allocateCell<ObjectTemplate>(vm)) ObjectTemplate(vm, structure);
    // TODO pass constructor
    objectTemplate->finishCreation(vm);
    return isolate->currentHandleScope()->createLocal<ObjectTemplate>(objectTemplate);
}

MaybeLocal<Object> ObjectTemplate::NewInstance(Local<Context> context)
{
    // TODO handle constructor
    // TODO handle interceptors?

    auto& vm = context->vm();
    auto thisObj = Data::locationToObjectPointer<ObjectTemplate>(this);

    // get a structure
    // must take thisObj because JSC needs the native pointer
    auto structure = internals().objectStructure.get(thisObj);

    // create object from it
    // InternalFieldObject needs a Local<ObjectTemplate>, which we can create using the `this`
    // pointer as we know this method itself was called through a Local
    auto newInstance = InternalFieldObject::create(vm, structure, Local<ObjectTemplate>(reinterpret_cast<TaggedPointer*>(this)));

    // todo: apply properties

    return MaybeLocal<Object>(context->currentHandleScope()->createLocal<Object>(newInstance));
}

template<typename Visitor>
void ObjectTemplate::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    ObjectTemplate* fn = jsCast<ObjectTemplate*>(cell);
    ASSERT_GC_OBJECT_INHERITS(fn, info());
    JSC::InternalFunction::visitChildren(fn, visitor);

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

JSC::EncodedJSValue ObjectTemplate::DummyCallback(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    ASSERT_NOT_REACHED();
    return JSC::JSValue::encode(JSC::jsUndefined());
}

}
