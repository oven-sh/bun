#include "v8/ObjectTemplate.h"
#include "v8/InternalFieldObject.h"

using JSC::JSGlobalObject;
using JSC::JSValue;
using JSC::Structure;

namespace v8 {

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
    Structure* structure = globalObject->ObjectTemplateStructure();
    auto* objectTemplate = new (NotNull, JSC::allocateCell<ObjectTemplate>(vm)) ObjectTemplate(vm, structure);
    // TODO pass constructor
    objectTemplate->finishCreation(vm);
    return Local<ObjectTemplate>(JSValue(objectTemplate));
}

MaybeLocal<Object> ObjectTemplate::NewInstance(Local<Context> context)
{
    // TODO handle constructor
    // TODO handle interceptors?

    auto& vm = (*context)->vm();

    // get a structure
    if (!objectStructure) {
        auto structure = JSC::Structure::create(
            vm,
            *context,
            (*context)->objectPrototype(),
            JSC::TypeInfo(JSC::ObjectType, InternalFieldObject::StructureFlags),
            InternalFieldObject::info());
        objectStructure.set((*context)->vm(), this, structure);
    }
    auto structure = objectStructure.get();

    // create object from it
    auto newInstance = InternalFieldObject::create(vm, structure, this);

    // todo: apply properties

    return MaybeLocal<Object>(Local<Object>(JSValue(newInstance)));
}

void ObjectTemplate::SetInternalFieldCount(int value)
{
    internalFieldCount = value;
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
