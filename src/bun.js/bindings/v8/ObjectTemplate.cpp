#include "v8/ObjectTemplate.h"
#include "wtf/Assertions.h"

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
    // use structure to create an object template
    ASSERT_NOT_REACHED();
    return Local<ObjectTemplate>();
}

MaybeLocal<Object> ObjectTemplate::NewInstance(Local<Context> context)
{
    ASSERT_NOT_REACHED();
    return MaybeLocal<Object>();
}

void ObjectTemplate::SetInternalFieldCount(int value)
{
    ASSERT_NOT_REACHED();
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
